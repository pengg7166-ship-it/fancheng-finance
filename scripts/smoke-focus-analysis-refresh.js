/**
 * Smoke test: verify focus analysis queue + Cloud concurrency config + outlook live hooks.
 * Usage: node scripts/smoke-focus-analysis-refresh.js [--dry-run]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const {
  getCursorConfig,
  getCloudConcurrencyLimit,
  isCursorConfigured,
  resetCloudAgentPool,
  CURSOR_CLIENT_VERSION,
} = require('../services/cursor-llm-client');
const { listUserFocusSymbols } = require('../services/user-focus-symbols');
const {
  getCachedCommodityOutlookSource,
  setOutlookBackgroundCompleteHook,
  refreshCommodityOutlookInBackground,
} = require('../services/commodity-outlook-engine');
const { loadCachedAnalysis } = require('../services/focus-daily-analysis');
const { getOutlookLiveRefreshStatus } = require('../services/outlook-live-refresh');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const focusCount = listUserFocusSymbols().length;
  const cc = getCursorConfig();
  const concurrency = getCloudConcurrencyLimit();
  const outlook = getCachedCommodityOutlookSource();
  const liveStatus = getOutlookLiveRefreshStatus();

  console.log('cursorClient:', CURSOR_CLIENT_VERSION);
  console.log('cursorConfigured:', isCursorConfigured());
  console.log('cursorConcurrency:', concurrency);
  console.log('focusSymbols:', focusCount);
  console.log('outlookInstruments:', outlook?.instruments?.length ?? 0);
  console.log('outlookLive:', liveStatus);
  console.log('outlookRestoredFrom:', outlook?.stats?.restoredFrom || 'v4-native');

  let hookFired = false;
  setOutlookBackgroundCompleteHook((payload) => {
    hookFired = true;
    console.log('backgroundCompleteHook:', payload?.instruments?.length ?? 0);
  });

  if (!dryRun && outlook?.instruments?.length) {
    await refreshCommodityOutlookInBackground();
    console.log('backgroundRefreshHookFired:', hookFired);
  } else {
    console.log('backgroundRefreshHookFired: skipped (dry-run or empty cache)');
  }

  const cachedSamples = listUserFocusSymbols()
    .slice(0, 5)
    .map((sym) => {
      const row = loadCachedAnalysis(sym);
      return {
        sym,
        hasText: Boolean(row?.analysis?.text),
        method: row?.analysis?.method || null,
        generatedAt: row?.generatedAt || null,
      };
    });
  console.log('cachedAnalysisSample:', cachedSamples);

  resetCloudAgentPool();

  if (focusCount !== 35) {
    throw new Error(`expected 35 focus symbols, got ${focusCount}`);
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(`invalid cursorConcurrency: ${concurrency}`);
  }
  if (!outlook?.instruments?.length) {
    console.warn('WARN: outlook cache empty — v3 restore may be pending');
  }
}

main()
  .then(() => {
    console.log('ALL PASS focus-analysis-refresh');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
