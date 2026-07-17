/**
 * 分钟 K 线自动增量补—应用运行期间按交易时段收盘后触发
 * 覆盖 outlook 全品'catalog（~74），复用 daily-data-sync.syncIntradayKlines
 */
const fs = require('fs');
const path = require('path');
const diskCache = require('./disk-cache');
const config = require('./config');
const { getDataDir, getUserDataDir, getLogsDir } = require('./data-paths');
const cnSession = require('./cn-futures-session-calendar');
const {
  syncIntradayKlines,
  getOutlookIntradayInstrumentIds,
  INTRADAY_SCHEDULER_TFS,
  readIntradayKlines,
  isStale,
} = require('./daily-data-sync');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;
const STATE_FILE = 'intraday-kline-scheduler-state.json';
const LOG_FILE = 'intraday-kline-backfill.jsonl';
const LOCK_MAX_MS = 90 * 60 * 1000;

/** 各交易段收盘后缓冲触发（CN 时间'*/
const BACKFILL_WAVES = [
  { id: 'day', hour: 15, minute: 30, label: '日盘收盘' },
  { id: 'night2300', hour: 23, minute: 5, label: '23:00夜盘' },
  { id: 'night0100', hour: 1, minute: 5, label: '01:00夜盘' },
  { id: 'night0230', hour: 2, minute: 45, label: '02:30夜盘' },
];

let schedulerTimer = null;
let startupTimer = null;
let backfillPromise = null;
let onCompleteFn = null;
let lastStatus = { running: false, lastRunAt: null, lastSuccessAt: null, lastTrigger: null };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

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
  return dataDir ? path.join(dataDir, 'history', '.intraday-kline-backfill-lock.json') : null;
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

function readState() {
  return readJsonSafe(statePath(), { waves: {}, lastStartupDate: null, lastSuccessAt: null });
}

function saveState(patch) {
  const fp = statePath();
  if (!fp) return;
  const prev = readState();
  writeJson(fp, { ...prev, ...patch, updatedAt: new Date().toISOString() });
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
    // 凌晨波：00:00'8:00 视为当日凌晨；其余时段视为前一日跨夜尚未到'
    if (nowMin < 8 * 60) return nowMin >= triggerMin;
    return true;
  }
  return nowMin >= triggerMin;
}

function findDueWave(cnParts) {
  for (const wave of BACKFILL_WAVES) {
    if (!isPastWaveTrigger(wave, cnParts)) continue;
    if (wasWaveDone(wave.id)) continue;
    return wave;
  }
  return null;
}

function sampleStaleCount(limit = 8) {
  const ids = getOutlookIntradayInstrumentIds();
  let stale = 0;
  let checked = 0;
  for (const id of ids) {
    if (checked >= limit) break;
    for (const tf of INTRADAY_SCHEDULER_TFS) {
      const klines = readIntradayKlines(id, tf);
      const last = klines.length ? String(klines[klines.length - 1].date || '').slice(0, 10) : null;
      if (isStale(last, 0)) stale += 1;
    }
    checked += 1;
  }
  return stale;
}

function needsStartupBackfill() {
  const state = readState();
  if (state.lastStartupDate !== todayKey()) return true;
  return sampleStaleCount(12) > 0;
}

function initDiskCache() {
  const dataDir = getDataDir();
  if (!dataDir) return false;
  diskCache.init(getUserDataDir() || dataDir);
  return true;
}

async function runIntradayBackfill({ trigger = 'manual', waveId = null, force = false } = {}) {
  if (backfillPromise) return backfillPromise;

  const cfg = config.readConfig();
  if (cfg.intradayKlineAutoBackfillEnabled === false) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!initDiskCache()) {
    return { skipped: true, reason: 'no_data_dir' };
  }

  backfillPromise = (async () => {
    const lock = acquireLock(trigger);
    if (!lock.ok) {
      return { skipped: true, reason: lock.reason, lock: lock.lock || null };
    }

    const startedAt = Date.now();
    lastStatus = { ...lastStatus, running: true, lastTrigger: trigger };

    try {
      const instrumentIds = getOutlookIntradayInstrumentIds();
      appendLog({
        event: 'start',
        trigger,
        waveId,
        instrumentCount: instrumentIds.length,
        timeframes: INTRADAY_SCHEDULER_TFS,
      });

      const result = await syncIntradayKlines({
        dryRun: false,
        force,
        instrumentIds,
        timeframes: INTRADAY_SCHEDULER_TFS,
        rateMs: 280,
      });

      const summary = {
        ok: result.failed === 0,
        trigger,
        waveId,
        date: todayKey(),
        durationMs: Date.now() - startedAt,
        instrumentCount: instrumentIds.length,
        fetched: result.fetched,
        skipped: result.skipped,
        failed: result.failed,
        status: result.status,
      };

      appendLog({ event: 'done', ...summary });
      saveState({
        lastSuccessAt: new Date().toISOString(),
        lastTrigger: trigger,
        lastFetched: result.fetched,
        lastSkipped: result.skipped,
        lastFailed: result.failed,
      });

      if (waveId) markWaveDone(waveId, summary);
      if (trigger === 'startup') saveState({ lastStartupDate: todayKey() });

      lastStatus = {
        running: false,
        lastRunAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastTrigger: trigger,
        lastWaveId: waveId,
        ...summary,
      };

      if (typeof onCompleteFn === 'function') {
        try {
          onCompleteFn(summary);
        } catch {
          // non-fatal
        }
      }

      return summary;
    } catch (err) {
      appendLog({ event: 'error', trigger, waveId, error: err.message });
      lastStatus = { ...lastStatus, running: false, lastError: err.message, lastRunAt: new Date().toISOString() };
      throw err;
    } finally {
      releaseLock();
      backfillPromise = null;
    }
  })();

  return backfillPromise;
}

async function tickIntradayKlineScheduler(opts = {}) {
  const cfg = config.readConfig();
  if (cfg.intradayKlineAutoBackfillEnabled === false) return { skipped: true, reason: 'disabled' };

  const cnParts = cnSession.getCnNowParts(opts.now);
  const dueWave = findDueWave(cnParts);
  if (dueWave) {
    return runIntradayBackfill({ trigger: `wave-${dueWave.id}`, waveId: dueWave.id, force: false });
  }

  if (opts.startupCheck && needsStartupBackfill()) {
    return runIntradayBackfill({ trigger: 'startup', force: false });
  }

  return { skipped: true, reason: 'nothing_due' };
}

function startIntradayKlineScheduler(options = {}) {
  onCompleteFn = options.onComplete || onCompleteFn;

  if (schedulerTimer) clearInterval(schedulerTimer);
  if (startupTimer) clearTimeout(startupTimer);

  startupTimer = setTimeout(() => {
    tickIntradayKlineScheduler({ startupCheck: true }).catch((err) => {
      console.warn('[intraday-kline-scheduler] startup backfill error:', err.message);
    });
  }, STARTUP_DELAY_MS);

  schedulerTimer = setInterval(() => {
    tickIntradayKlineScheduler({ startupCheck: false }).catch((err) => {
      console.warn('[intraday-kline-scheduler] tick error:', err.message);
    });
  }, CHECK_INTERVAL_MS);

  return { started: true, intervalMs: CHECK_INTERVAL_MS, waves: BACKFILL_WAVES.map((w) => w.id) };
}

function stopIntradayKlineScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
}

function getIntradayKlineSchedulerStatus() {
  const state = readState();
  const instrumentIds = getOutlookIntradayInstrumentIds();
  return {
    enabled: config.readConfig().intradayKlineAutoBackfillEnabled !== false,
    running: Boolean(backfillPromise) || lastStatus.running,
    instrumentCount: instrumentIds.length,
    timeframes: INTRADAY_SCHEDULER_TFS,
    waves: BACKFILL_WAVES,
    state,
    ...lastStatus,
  };
}

module.exports = {
  CHECK_INTERVAL_MS,
  BACKFILL_WAVES,
  startIntradayKlineScheduler,
  stopIntradayKlineScheduler,
  tickIntradayKlineScheduler,
  runIntradayBackfill,
  getIntradayKlineSchedulerStatus,
  needsStartupBackfill,
};
