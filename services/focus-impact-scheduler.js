/**
 * 重大影响资讯 · 高频扫描（10min）+ 日更流动性 + ①② 全量 Cursor 解读
 */
const { scanAndMergeImpactPins } = require('./focus-impact-pins');
const { buildOutlookHeadlinesPackage } = require('./focus-outlook-headlines');
const { mergeOutlookWithSources } = require('./outlook-context-merge');
const { loadCachedLiquidityDaily } = require('./focus-liquidity-daily-cursor');
const { todaySessionDate } = require('./focus-read-state');
const { isCursorConfigured } = require('./cursor-llm-client');

const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const INITIAL_DELAY_MS = 8 * 1000;

let scanTimer = null;
let busy = false;
let hooks = {};
let lastScanAt = null;
let lastHeadlinesAt = null;
let cycleCount = 0;
let liquidityGeneratedForSession = null;

function needsLiquidityDaily() {
  const session = todaySessionDate();
  if (liquidityGeneratedForSession === session) return false;
  const cached = loadCachedLiquidityDaily(session);
  return !cached?.text || cached.stale === true;
}

function buildCycleOptions() {
  cycleCount += 1;
  const cursorOn = isCursorConfigured();
  return {
    enrichCursor: cursorOn,
    forceLiquidity: cursorOn && needsLiquidityDaily(),
  };
}

async function runImpactScanCycle(options = {}) {
  if (busy) return null;
  busy = true;
  try {
    let releaseBoost = { boost: false, reason: null, imminent: [] };
    let releaseSurprises = [];
    try {
      const { getReleaseScanBoost, getActiveReleaseEvents } = require('./commodity-release-calendar');
      const { fetchFundamentalsSource } = require('./commodity-fundamentals-fetcher');
      releaseBoost = getReleaseScanBoost();
      const active = getActiveReleaseEvents();
      const eiaPost = active.find((r) => r.id === 'eia-weekly' && r.phase === 'post_release');
      if (eiaPost) {
        try {
          await fetchFundamentalsSource();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    if (cycleCount % 3 === 0 || releaseBoost.boost) {
      try {
        const { fetchAllFlashNews } = require('./flash-news-fetcher');
        await fetchAllFlashNews({ appendInbox: true, parallel: true });
      } catch {
        // ignore
      }
      try {
        const { warmNewsCache } = require('./commodities-news');
        warmNewsCache();
      } catch {
        // ignore
      }
    }

    try {
      const { fetchPolicyLive } = require('./policy-fetcher');
      await fetchPolicyLive({ force: cycleCount % 2 === 0 });
    } catch {
      // ignore
    }

    if (cycleCount % 6 === 0) {
      try {
        const { auditNewsCoverage, persistCoverageAudit } = require('./news-coverage-audit');
        persistCoverageAudit(auditNewsCoverage());
      } catch {
        // ignore
      }
      try {
        const { fetchExchangeNoticeBundle } = require('./exchange-notice-fetcher');
        await fetchExchangeNoticeBundle();
      } catch {
        // ignore
      }
    }

    let outlookPayload = options.outlookPayload || {};
    try {
      const { getCachedCommodityOutlookSource } = require('./commodity-outlook-engine');
      outlookPayload = mergeOutlookWithSources(getCachedCommodityOutlookSource() || outlookPayload);
    } catch {
      // ignore
    }

    if (cycleCount % 6 === 0 || releaseBoost.boost) {
      try {
        const { buildReleaseCalendarWithSurprise, persistReleaseCalendar } = require('./commodity-release-calendar');
        const { collectReleaseNewsPool } = require('./release-data-surprise');
        const fundamentals = require('./commodity-fundamentals-fetcher').getCachedFundamentalsSource();
        const newsPool = collectReleaseNewsPool();
        const cal = buildReleaseCalendarWithSurprise(fundamentals, outlookPayload, newsPool);
        releaseSurprises = cal.releaseSurprises || [];
        persistReleaseCalendar(cal);
      } catch {
        // ignore
      }
    }

    const scan = scanAndMergeImpactPins(outlookPayload);
    lastScanAt = new Date().toISOString();
    const cycleOpts = options.manual === true ? options : { ...buildCycleOptions(), ...options };
    const headlines = await buildOutlookHeadlinesPackage(outlookPayload, {
      skipScan: true,
      enrichCursor: cycleOpts.enrichCursor !== false,
      forceLiquidity: cycleOpts.forceLiquidity === true,
    });
    if (headlines?.liquidityDaily?.text) {
      liquidityGeneratedForSession = todaySessionDate();
    }
    lastHeadlinesAt = new Date().toISOString();
    const payload = { scan, headlines, ranAt: lastHeadlinesAt, cycleCount, releaseBoost, releaseSurprises };
    hooks.onHeadlinesUpdated?.(payload);
    if (scan.newAlerts?.length) {
      hooks.onImpactAlert?.({ alerts: scan.newAlerts, at: lastScanAt });
    }
    return payload;
  } catch (err) {
    return { error: err.message || String(err) };
  } finally {
    busy = false;
  }
}

function startImpactHeadlinesScheduler(nextHooks = {}) {
  hooks = { ...hooks, ...nextHooks };
  if (scanTimer) clearInterval(scanTimer);
  cycleCount = 0;
  setTimeout(() => void runImpactScanCycle(), INITIAL_DELAY_MS);
  scanTimer = setInterval(() => void runImpactScanCycle(), SCAN_INTERVAL_MS);
}

function stopImpactHeadlinesScheduler() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
}

function getImpactHeadlinesSchedulerStatus() {
  return {
    running: Boolean(scanTimer),
    busy,
    lastScanAt,
    lastHeadlinesAt,
    intervalMs: SCAN_INTERVAL_MS,
    cycleCount,
    liquidityGeneratedForSession,
    cursorConfigured: isCursorConfigured(),
  };
}

module.exports = {
  startImpactHeadlinesScheduler,
  stopImpactHeadlinesScheduler,
  runImpactScanCycle,
  getImpactHeadlinesSchedulerStatus,
  SCAN_INTERVAL_MS,
};
