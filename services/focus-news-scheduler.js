/**
 * 关注品种 AnySearch 新闻 · 30min 调度
 */
const { listUserFocusSymbols } = require('./user-focus-symbols');
const { refreshWebNewsForSymbols } = require('./focus-anysearch-news');
const { buildTop5IntelPackage } = require('./focus-intelligence-brief');

const INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;

let timer = null;
let busy = false;
let hooks = {};
let lastRunAt = null;
let lastError = null;

async function runFocusNewsCycle(options = {}) {
  if (busy) return null;
  busy = true;
  try {
    const { getCachedCommodityOutlookSource } = require('./commodity-outlook-engine');
    const outlook = getCachedCommodityOutlookSource();
    const instruments = outlook?.instruments || [];
    let symbols = listUserFocusSymbols();
    if (instruments.length) {
      const intel = buildTop5IntelPackage(instruments, outlook);
      const topSyms = (intel.top5 || []).map((t) => t.symbol);
      const majorSyms = (intel.majorOpportunities || []).map((t) => t.symbol);
      symbols = [...new Set([...majorSyms, ...topSyms, ...symbols])];
    }
    const results = await refreshWebNewsForSymbols(symbols.slice(0, 35), {
      force: options.force === true,
      concurrency: 3,
    });
    lastRunAt = new Date().toISOString();
    lastError = null;
    const payload = { ranAt: lastRunAt, count: results.length, results };
    hooks.onNewsRefreshed?.(payload);
    return payload;
  } catch (err) {
    lastError = err.message || String(err);
    return null;
  } finally {
    busy = false;
  }
}

function startFocusNewsScheduler(nextHooks = {}) {
  hooks = { ...hooks, ...nextHooks };
  if (timer) clearInterval(timer);
  setTimeout(() => void runFocusNewsCycle(), INITIAL_DELAY_MS);
  timer = setInterval(() => void runFocusNewsCycle(), INTERVAL_MS);
}

function stopFocusNewsScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

function getFocusNewsSchedulerStatus() {
  return { running: Boolean(timer), busy, lastRunAt, lastError, intervalMs: INTERVAL_MS };
}

module.exports = {
  startFocusNewsScheduler,
  stopFocusNewsScheduler,
  runFocusNewsCycle,
  getFocusNewsSchedulerStatus,
  INTERVAL_MS,
};
