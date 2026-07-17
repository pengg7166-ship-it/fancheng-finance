/**
 * Auto-heal data-quality failures 'sync closes, rebuild outlook, repair archives.
 */
const fs = require('fs');
const path = require('path');
const { getLogsDir } = require('./data-paths');
const dailyClose = require('./daily-close-sync');
const { getAppDir } = require('./data-paths');
const { runQualityAudit, ACTIVE_INSTRUMENT_COUNT } = require('./data-quality-guard');

function getHealSpawnCwd() {
  if (process.versions?.electron) {
    const appDir = getAppDir();
    if (appDir && fs.existsSync(appDir)) return appDir;
  }
  return path.join(__dirname, '..');
}

function logPathForToday() {
  const logsDir = getLogsDir();
  if (!logsDir) return null;
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `data-quality-${date}.jsonl`);
}

function appendQualityLog(entry) {
  const fp = logPathForToday();
  if (!fp) return;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.appendFileSync(fp, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
}

function failedCriticalChecks(report) {
  return (report?.checks || []).filter((c) => !c.passed && c.severity === 'critical');
}

function healStepsForCheck(checkId) {
  switch (checkId) {
    case 'closing_price_freshness':
    case 'closing_price_accuracy':
      return ['sync_closes'];
    case 'outlook_cache_freshness':
      return ['rebuild_outlook'];
    case 'outlook_prediction_sanity':
      return ['repair_archives', 'rebuild_outlook'];
    case 'archive_integrity':
      return ['repair_archives', 'invalidate_outlook'];
    case 'display_price_logic':
      return ['sync_closes'];
    case 'kline_completeness':
      return ['sync_closes'];
    default:
      return [];
  }
}

async function runHealStep(step, options = {}) {
  switch (step) {
    case 'sync_closes': {
      if (!dailyClose.initDiskCache()) return { step, ok: false, error: 'no_data_dir' };
      const result = await dailyClose.syncAllDailyCloses({
        force: options.forceClose !== false,
        trigger: 'quality-heal',
        includeCrossMarket: true,
        rateMs: 200,
      });
      return { step, ok: true, ...result };
    }
    case 'invalidate_outlook': {
      try {
        const engine = require('./commodity-outlook-engine');
        engine.invalidateOutlookDiskCache?.();
        return { step, ok: true, invalidated: true };
      } catch (err) {
        return { step, ok: false, error: err.message };
      }
    }
    case 'rebuild_outlook': {
      try {
        const commoditiesFetcher = require('./commodities-fetcher');
        const commodities = await commoditiesFetcher.fetchCommoditiesLive({ force: true });
        const engine = require('./commodity-outlook-engine');
        const data = await engine.fetchCommodityOutlookLive({
          force: true,
          sources: { commodities },
        });
        const count = data?.instruments?.length || 0;
        return { step, ok: count >= ACTIVE_INSTRUMENT_COUNT - 2, instrumentCount: count };
      } catch (err) {
        return { step, ok: false, error: err.message };
      }
    }
    case 'repair_archives': {
      try {
        const { execFileSync } = require('child_process');
        const script = path.join(__dirname, '..', 'scripts', 'repair-slot-prediction-prices.js');
        execFileSync(process.execPath, [script], {
          cwd: getHealSpawnCwd(),
          env: { ...process.env, FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE || 'E' },
          stdio: options.silent ? 'pipe' : 'inherit',
          windowsHide: true,
        });
        return { step, ok: true, repaired: true };
      } catch (err) {
        return { step, ok: false, error: err.message };
      }
    }
  default:
      return { step, ok: false, error: 'unknown_step' };
  }
}

async function runQualityHeal(report, options = {}) {
  const failures = failedCriticalChecks(report);
  const result = {
    trigger: options.trigger || 'quality-heal',
    failures: failures.map((f) => f.id),
    steps: [],
    ok: failures.length === 0,
  };

  if (!failures.length) {
    appendQualityLog({ type: 'heal_skip', reason: 'no_critical_failures', reportSummary: { ok: report.ok } });
    return result;
  }

  const stepsNeeded = new Set();
  for (const f of failures) {
    for (const s of healStepsForCheck(f.id)) stepsNeeded.add(s);
  }

  for (const step of stepsNeeded) {
    try {
      const stepResult = await runHealStep(step, options);
      result.steps.push(stepResult);
      if (stepResult.ok === false) result.ok = false;
    } catch (err) {
      result.steps.push({ step, ok: false, error: err.message });
      result.ok = false;
    }
  }

  appendQualityLog({ type: 'heal', ...result });
  return result;
}

async function runHealThenAudit(options = {}) {
  const {
    auditOptions = {},
    maxRetries = 1,
    trigger = 'heal-then-audit',
  } = options;

  let audit = await runQualityAudit({ ...auditOptions, trigger: `${trigger}-initial` });
  appendQualityLog({ type: 'audit', phase: 'initial', summary: { ok: audit.ok, criticalCount: audit.criticalCount } });

  if (audit.ok) {
    return { audit, heal: null, retries: 0 };
  }

  let heal = await runQualityHeal(audit, { trigger });
  let retries = 0;

  while (!audit.ok && retries < maxRetries) {
    retries += 1;
    audit = await runQualityAudit({ ...auditOptions, trigger: `${trigger}-retry-${retries}` });
    appendQualityLog({
      type: 'audit',
      phase: `retry-${retries}`,
      summary: { ok: audit.ok, criticalCount: audit.criticalCount },
    });
    if (!audit.ok && retries < maxRetries) {
      heal = await runQualityHeal(audit, { trigger: `${trigger}-retry-${retries}` });
    }
  }

  return { audit, heal, retries };
}

module.exports = {
  appendQualityLog,
  runQualityHeal,
  runHealThenAudit,
  failedCriticalChecks,
};
