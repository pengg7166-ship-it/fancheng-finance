/**
 * 日收盘价自动同步调度 '日盘/夜盘收盘后触'+ 启动回补
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getDataDir, getUserDataDir, getLogsDir } = require('./data-paths');
const cnSession = require('./cn-futures-session-calendar');
const {
  syncDailyCloses,
  backfillRecentCloses,
  initDiskCache,
  readState,
  saveState,
  todayKey,
  todayCloseFileComplete,
  needsInstrumentRefresh,
  getOutlookInstrumentIds,
} = require('./daily-close-sync');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 0;
const STATE_FILE = 'daily-close-scheduler-state.json';
const LOG_FILE = 'daily-close-sync-scheduler.jsonl';
const LOCK_MAX_MS = 90 * 60 * 1000;

/** 各交易段收盘后缓冲触发（CN 时间'*/
const CLOSE_WAVES = [
  { id: 'day', hour: 15, minute: 5, label: '日盘收盘' },
  { id: 'night2300', hour: 23, minute: 5, label: '23:00夜盘' },
  { id: 'night0100', hour: 1, minute: 5, label: '01:00夜盘' },
  { id: 'night0230', hour: 2, minute: 45, label: '02:30夜盘' },
];

let schedulerTimer = null;
let startupTimer = null;
let syncPromise = null;
let onCompleteFn = null;
let lastStatus = { running: false, lastRunAt: null, lastSuccessAt: null, lastTrigger: null };

function statePath() {
  const dataDir = getDataDir();
  return dataDir ? path.join(dataDir, 'history', STATE_FILE) : null;
}

function logPath() {
  const logsDir = getLogsDir();
  return logsDir ? path.join(logsDir, LOG_FILE) : null;
}

function lockPath() {
  const dataDir = getDataDir();
  return dataDir ? path.join(dataDir, 'history', '.daily-close-sync-lock.json') : null;
}

function readJsonSafe(fp, fallback = null) {
  try {
    if (fp && fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    // ignore
  }
  return fallback;
}

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function waveKey(waveId, dateKey = todayKey()) {
  return `${dateKey}|${waveId}`;
}

function wasWaveDone(waveId, dateKey = todayKey()) {
  const state = readState();
  return Boolean(state.waves?.[waveKey(waveId, dateKey)]);
}

function markWaveDone(waveId, result, dateKey = todayKey()) {
  const state = readState();
  state.waves = state.waves || {};
  state.waves[waveKey(waveId, dateKey)] = {
    at: new Date().toISOString(),
    fetched: result.fetched || 0,
    skipped: result.skipped || 0,
    failed: result.failed || 0,
    trigger: result.trigger || waveId,
  };
  saveState(state);
}

function appendLog(entry) {
  const fp = logPath();
  if (!fp) return;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.appendFileSync(fp, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
}

function acquireLock(trigger) {
  const lp = lockPath();
  if (!lp) return { ok: false, reason: 'no_data_dir' };
  const existing = readJsonSafe(lp);
  if (existing?.startedAt && Date.now() - existing.startedAt < LOCK_MAX_MS) {
    return { ok: false, reason: 'lock_held', lock: existing };
  }
  writeJson(lp, { pid: process.pid, trigger, startedAt: Date.now() });
  return { ok: true };
}

function releaseLock() {
  try {
    const lp = lockPath();
    if (lp && fs.existsSync(lp)) fs.unlinkSync(lp);
  } catch {
    // ignore
  }
}

function cnNowMinutes(cnParts) {
  return cnParts.hour * 60 + cnParts.minute;
}

function waveTriggerMinutes(wave) {
  return wave.hour * 60 + wave.minute;
}

function isPastWaveTrigger(wave, cnParts) {
  const nowMin = cnNowMinutes(cnParts);
  const triggerMin = waveTriggerMinutes(wave);
  if (wave.id === 'night0100' || wave.id === 'night0230') {
    if (nowMin < 8 * 60) return nowMin >= triggerMin;
    return true;
  }
  return nowMin >= triggerMin;
}

function findDueWave(cnParts) {
  for (const wave of CLOSE_WAVES) {
    if (!isPastWaveTrigger(wave, cnParts)) continue;
    if (wasWaveDone(wave.id)) continue;
    return wave;
  }
  return null;
}

function sampleStaleInstrumentCount(limit = 12) {
  const ids = getOutlookInstrumentIds();
  let stale = 0;
  let checked = 0;
  for (const id of ids) {
    if (checked >= limit) break;
    if (needsInstrumentRefresh(id, { maxLagDays: 1 })) stale += 1;
    checked += 1;
  }
  return stale;
}

function needsStartupBackfill() {
  if (!todayCloseFileComplete()) return true;
  const state = readState();
  if (state.lastStartupDate !== todayKey()) return true;
  return sampleStaleInstrumentCount(16) > 0;
}

async function runDailyCloseSync({ trigger = 'manual', waveId = null, force = false } = {}) {
  if (syncPromise) return syncPromise;

  const cfg = config.readConfig();
  if (cfg.dailyCloseSyncEnabled === false) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!initDiskCache()) {
    return { skipped: true, reason: 'no_data_dir' };
  }

  syncPromise = (async () => {
    const lock = acquireLock(trigger);
    if (!lock.ok) {
      return { skipped: true, reason: lock.reason, lock: lock.lock || null };
    }

    const startedAt = Date.now();
    lastStatus = { ...lastStatus, running: true, lastTrigger: trigger };

    try {
      appendLog({ event: 'start', trigger, waveId });
      const result = await syncDailyCloses({
        force,
        trigger,
        includeCrossMarket: true,
        rateMs: 220,
      });

      const summary = {
        ok: result.failed === 0,
        trigger,
        waveId,
        date: todayKey(),
        durationMs: Date.now() - startedAt,
        fetched: result.fetched,
        skipped: result.skipped,
        failed: result.failed,
        crossMarket: result.crossMarket?.status,
      };

      if (waveId) markWaveDone(waveId, result);
      appendLog({ event: 'done', ...summary });
      saveState({
        lastSuccessAt: new Date().toISOString(),
        lastTrigger: trigger,
        lastFetched: result.fetched,
        lastSkipped: result.skipped,
        lastFailed: result.failed,
      });

      lastStatus = {
        running: false,
        lastRunAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastTrigger: trigger,
        ...summary,
      };

      if (typeof onCompleteFn === 'function') onCompleteFn(summary);
      return summary;
    } catch (err) {
      appendLog({ event: 'error', trigger, error: err.message });
      lastStatus = { ...lastStatus, running: false, lastError: err.message };
      throw err;
    } finally {
      releaseLock();
      syncPromise = null;
    }
  })();

  return syncPromise;
}

function schedulerTick() {
  const cnParts = cnSession.getCnNowParts();
  const wave = findDueWave(cnParts);
  if (wave) {
    void runDailyCloseSync({ trigger: `wave:${wave.id}`, waveId: wave.id, force: false });
  }
}

function startDailyCloseScheduler({ onComplete } = {}) {
  onCompleteFn = onComplete || null;
  if (schedulerTimer) return { alreadyRunning: true };

  const runStartupBackfill = () => {
    if (!needsStartupBackfill()) return;
    saveState({ lastStartupDate: todayKey() });
    void backfillRecentCloses({ days: 3 })
      .then((result) => {
        if (typeof onCompleteFn === 'function') {
          onCompleteFn({ ...result, trigger: 'startup-backfill' });
        }
      })
      .catch((err) => {
        console.warn('[daily-close-scheduler] startup backfill error:', err.message);
      });
  };
  if (STARTUP_DELAY_MS > 0) {
    startupTimer = setTimeout(runStartupBackfill, STARTUP_DELAY_MS);
  } else {
    setImmediate(runStartupBackfill);
  }

  schedulerTimer = setInterval(() => {
    try {
      schedulerTick();
    } catch (err) {
      console.warn('[daily-close-scheduler] tick error:', err.message);
    }
  }, CHECK_INTERVAL_MS);

  setTimeout(() => schedulerTick(), 8000);
  return { started: true, waves: CLOSE_WAVES.map((w) => w.id) };
}

function stopDailyCloseScheduler() {
  if (startupTimer) clearTimeout(startupTimer);
  if (schedulerTimer) clearInterval(schedulerTimer);
  startupTimer = null;
  schedulerTimer = null;
}

function getDailyCloseSchedulerStatus() {
  return {
    ...lastStatus,
    waves: CLOSE_WAVES,
    state: readState(),
  };
}

module.exports = {
  CLOSE_WAVES,
  runDailyCloseSync,
  startDailyCloseScheduler,
  stopDailyCloseScheduler,
  getDailyCloseSchedulerStatus,
};
