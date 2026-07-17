/**
 * Startup self-heal 'sync missing closes, invalidate stale outlook cache, log results.
 */
const fs = require('fs');
const path = require('path');
const { getLogsDir } = require('./data-paths');
const dailyClose = require('./daily-close-sync');
const { getInstrumentBaselineDate } = require('./outlook-prediction-utils');

const OUTLOOK_DISK_KEY = 'commodity-outlook-v4.json';

function appendHealLog(entry) {
  const logsDir = getLogsDir();
  if (!logsDir) return;
  const fp = path.join(logsDir, 'startup-heal.jsonl');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(fp, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
}

function readOutlookCacheData() {
  try {
    const diskCache = require('./disk-cache');
    const stored = diskCache.readStale(OUTLOOK_DISK_KEY);
    return { savedAt: stored?.savedAt || null, data: stored?.data || null };
  } catch {
    return { savedAt: null, data: null };
  }
}

function outlookCacheIsStale(data) {
  if (!data?.instruments?.length) return true;

  try {
    const staleBaseline = data.instruments.some((inst) => {
      const latest = dailyClose.getLatestBarClose(inst.id);
      const baselineDate = getInstrumentBaselineDate(inst);
      if (!latest?.tradeDate || !baselineDate) return false;
      return String(baselineDate).slice(0, 10) < String(latest.tradeDate).slice(0, 10);
    });
    if (staleBaseline) return true;
  } catch {
    return true;
  }

  const updated = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
  const live = data.liveRefreshedAt ? new Date(data.liveRefreshedAt).getTime() : 0;
  if (live && updated && updated - live > 24 * 60 * 60 * 1000) return true;

  const stamp = Math.max(updated, live);
  if (!stamp || Number.isNaN(stamp)) return true;
  if (Date.now() - stamp > 12 * 60 * 60 * 1000) return true;

  return false;
}

async function runStartupDataHeal({ trigger = 'app-startup', syncDays = 3 } = {}) {
  const result = { trigger, steps: [], ok: true, startedAt: new Date().toISOString() };

  if (!dailyClose.initDiskCache()) {
    result.ok = false;
    result.error = 'no_data_dir';
    appendHealLog(result);
    return result;
  }

  try {
    const needClose = !dailyClose.todayCloseFileComplete() || dailyClose.needsInstrumentRefresh('fg', { maxLagDays: 1 });
    if (needClose) {
      const closeResult = await dailyClose.syncAllDailyCloses({
        force: !dailyClose.todayCloseFileComplete(),
        trigger: 'startup-heal',
        includeCrossMarket: true,
        rateMs: 200,
      });
      result.steps.push({ step: 'sync_closes', ...closeResult });
    } else {
      const closeResult = await dailyClose.backfillRecentCloses({ days: syncDays });
      result.steps.push({ step: 'sync_closes', mode: 'backfill', ...closeResult });
    }
  } catch (err) {
    result.steps.push({ step: 'sync_closes', error: err.message });
    result.ok = false;
  }

  try {
    const { data, savedAt } = readOutlookCacheData();
    const stale = outlookCacheIsStale(data);
    if (stale) {
      const engine = require('./commodity-outlook-engine');
      engine.invalidateOutlookDiskCache?.();
      result.steps.push({
        step: 'invalidate_outlook',
        stale: true,
        savedAt,
        updatedAt: data?.updatedAt || null,
        liveRefreshedAt: data?.liveRefreshedAt || null,
      });
    } else {
      result.steps.push({ step: 'invalidate_outlook', stale: false, skipped: true });
    }
  } catch (err) {
    result.steps.push({ step: 'invalidate_outlook', error: err.message });
  }

  try {
    const slotSched = require('./outlook-slot-scheduler');
    const catchUp = await slotSched.tickOutlookSlotScheduler({ catchUp: true });
    result.steps.push({
      step: 'slot_catch_up',
      captured: Boolean(catchUp?.captured),
      reason: catchUp?.reason || null,
      count: catchUp?.count || 0,
    });
  } catch (err) {
    result.steps.push({ step: 'slot_catch_up', error: err.message });
  }

  result.finishedAt = new Date().toISOString();
  appendHealLog(result);
  return result;
}

async function runStartupDataHealWithAudit(options = {}) {
  const healResult = await runStartupDataHeal(options);
  let auditResult = null;
  let healRetry = null;

  try {
    const { runHealThenAudit } = require('./data-quality-heal');
    const bundle = await runHealThenAudit({
      auditOptions: { mode: 'full', trigger: 'post-startup-heal' },
      maxRetries: 2,
      trigger: 'startup-heal-audit',
    });
    auditResult = bundle.audit;
    healRetry = bundle.heal;
    healResult.qualityAudit = {
      ok: auditResult.ok,
      criticalCount: auditResult.criticalCount,
      warningCount: auditResult.warningCount,
      latestCloseDate: auditResult.latestCloseDate,
      checks: (auditResult.checks || []).map((c) => ({
        id: c.id,
        passed: c.passed,
        severity: c.severity,
      })),
      retries: bundle.retries,
    };
    if (!auditResult.ok) healResult.ok = false;
  } catch (err) {
    healResult.qualityAudit = { error: err.message };
  }

  appendHealLog(healResult);
  return healResult;
}

module.exports = {
  runStartupDataHeal,
  runStartupDataHealWithAudit,
  outlookCacheIsStale,
  readOutlookCacheData,
};
