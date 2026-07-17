/**
 * Hot-patch production app.asar with current src UI files.
 * Cleans accidental dist/_asar junk baked into asar (shrinks ~3GB → ~50MB).
 */
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const ASAR_CANDIDATES = [
  'F:/FanchengFinance/app/win-unpacked/resources/app.asar',
  'E:/FanchengFinance/app/win-unpacked/resources/app.asar',
];
const ASAR = ASAR_CANDIDATES.find((p) => fs.existsSync(p)) || ASAR_CANDIDATES[0];
const STAGING = path.join(path.dirname(ASAR), '_extract-check');

const UI_FILES = ['src/app.js', 'src/commodities.js', 'src/price-tick-browser.js', 'src/styles.css', 'src/reading-layout.css', 'src/index.html', 'app.js', 'package.json'];

const SERVICE_FILES = [
  'services/price-tick.js',
  'services/futures-contract-specs.js',
  'services/commodity-outlook-engine.js',
  'services/trading-session-calendar.js',
  'services/range-prediction-archive.js',
  'services/commodity-outlook-history.js',
  'services/outlook-slot-snapshot.js',
  'services/outlook-slot-scheduler.js',
  'services/direction-prediction-archive.js',
  'services/outlook-prediction-slots.js',
  'services/intraday-kline-scheduler.js',
  'services/daily-close-sync.js',
  'services/daily-close-scheduler.js',
  'services/daily-data-sync.js',
  'services/outlook-live-refresh.js',
  'services/daily-brief-synthesis.js',
  'services/commodities-fetcher.js',
  'services/chemical-range-calibration.js',
  'services/nonferrous-range-calibration.js',
  'services/precious-range-calibration.js',
  'services/next-day-range-predictor.js',
  'services/cn-futures-session-calendar.js',
  'services/basis-regime-overrides.js',
  'services/range-bias-correction.js',
  'services/startup-data-heal.js',
  'services/data-quality-guard.js',
  'services/data-quality-heal.js',
  'services/commodity-outlook-backtest.js',
  'services/data-paths.js',
  'services/config.js',
  'services/user-focus-symbols.js',
  'services/cursor-llm-client.js',
  'services/focus-daily-analysis.js',
  'services/focus-news-articles.js',
  'services/focus-top5-deep-brief.js',
  'services/focus-intelligence-brief.js',
  'services/focus-anysearch-news.js',
  'services/focus-news-scheduler.js',
  'services/focus-news-zh.js',
  'services/focus-impact-pins.js',
  'services/focus-expectation-factors.js',
  'services/commodity-fundamentals-fetcher.js',
  'services/data-fetcher.js',
  'services/data-paths.js',
  'services/focus-impact-dimensions.js',
  'services/focus-news-relevance.js',
  'services/focus-news-source-quality.js',
  'services/policy-commodity-map.js',
  'services/policy-fetcher.js',
  'services/policy-sources.js',
  'services/policy-us-sources.js',
  'services/focus-outlook-headlines.js',
  'services/focus-surprise-radar.js',
  'services/outlook-context-merge.js',
  'services/focus-liquidity-daily-cursor.js',
  'services/focus-impact-scheduler.js',
  'services/flash-news-fetcher.js',
  'services/flash-news-sources.js',
  'services/opinion-news.js',
  'services/opinion-logic-gate.js',
  'services/commodity-release-calendar.js',
  'services/release-data-surprise.js',
  'services/exchange-notice-fetcher.js',
  'services/exchange-symbol-match.js',
  'services/dce-portal-api-fetcher.js',
  'services/czce-warehouse-fetcher.js',
  'services/gfex-warehouse-fetcher.js',
  'services/shfe-warehouse-fetcher.js',
  'services/shfe-member-ranking-fetcher.js',
  'services/czce-member-ranking-fetcher.js',
  'services/gfex-member-ranking-fetcher.js',
  'services/member-oi-features.js',
  'services/sector-fundamentals-loader.js',
  'services/lange-iron-port-fetcher.js',
  'services/eastmoney-exchange-inventory.js',
  'services/westmetall-lme-stocks-fetcher.js',
  'services/lme-inventory-fetcher.js',
  'services/contradiction-matrix.js',
  'services/inventory-capital-joint.js',
  'services/capital-attitude.js',
  'services/thesis-registry.js',
  'services/thesis-synthesis.js',
  'services/term-structure-fetcher.js',
  'services/outlook-trading-guidance.js',
  'services/exchange-hard-policy.js',
  'services/cn-trading-calendar.js',
  'services/news-coverage-audit.js',
  'services/http-client.js',
  'services/outlook-prediction-utils.js',
  'services/focus-opportunity-ranker.js',
  'services/focus-read-state.js',
  'services/outlook-trading-guidance.js',
  'services/commodity-outlook-calibration.js',
  'services/data-quality-guard.js',
  'services/commodities-catalog.js',
  'services/commodities-history-fetcher.js',
  'electron/main.js',
  'electron/preload.js',
  'scripts/verify-deploy-ready.js',
  'scripts/run-data-quality-audit.js',
  'scripts/smoke-focus-analysis-refresh.js',
];

const DATA_FILES = ['data/commodity-release-dates.json'];

const JUNK_DIR_PREFIXES = [
  '_asar-',
  '_verify-',
  '_tmp-trading-probe',
  'dist-out',
  'dist-build',
  'dist-v',
  '.deploy-verify',
];

function rmDir(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

async function main() {
  if (!fs.existsSync(ASAR)) {
    console.error('Missing:', ASAR);
    process.exit(1);
  }

  require('./generate-price-tick-browser.js');

  if (!fs.existsSync(STAGING)) {
    console.log('Extracting asar (first run)...');
    fs.mkdirSync(STAGING, { recursive: true });
    asar.extractAll(ASAR, STAGING);
  }

  for (const rel of [...UI_FILES, ...SERVICE_FILES, ...DATA_FILES]) {
    const src = path.join(ROOT, rel);
    const dest = path.join(STAGING, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('patched', rel);
  }

  for (const name of fs.readdirSync(STAGING)) {
    const full = path.join(STAGING, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (JUNK_DIR_PREFIXES.some((p) => name === p || name.startsWith(p))) {
      console.log('remove junk dir', name);
      rmDir(full);
    }
  }

  const backup = ASAR + '.bak-ui-' + Date.now();
  fs.copyFileSync(ASAR, backup);
  console.log('Backup:', backup);

  const tmp = ASAR + '.tmp';
  rmDir(tmp);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

  console.log('Repacking asar...');
  await asar.createPackage(STAGING, tmp);

  // Windows: app.asar is locked while FanchengFinance.exe runs — Copy overwrites in place.
  try {
    fs.copyFileSync(tmp, ASAR);
    fs.unlinkSync(tmp);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EBUSY') {
      console.error('Cannot replace app.asar — quit all FanchengFinance.exe instances and rerun.');
      process.exit(1);
    }
    throw err;
  }

  const verify = asar.extractFile(ASAR, 'src/app.js').toString('utf8');
  const sessionCal = asar.extractFile(ASAR, 'services/trading-session-calendar.js').toString('utf8');
  const rangeArchive = asar.extractFile(ASAR, 'services/range-prediction-archive.js').toString('utf8');
  const intradaySched = asar.extractFile(ASAR, 'services/intraday-kline-scheduler.js').toString('utf8');
  const mainJs = asar.extractFile(ASAR, 'electron/main.js').toString('utf8');
  const chemCal = asar.extractFile(ASAR, 'services/chemical-range-calibration.js').toString('utf8');
  const startupHeal = asar.extractFile(ASAR, 'services/startup-data-heal.js').toString('utf8');
  const css = asar.extractFile(ASAR, 'src/reading-layout.css').toString('utf8');
  const stylesCss = asar.extractFile(ASAR, 'src/styles.css').toString('utf8');
  const indexHtml = asar.extractFile(ASAR, 'src/index.html').toString('utf8');
  const cursorClient = asar.extractFile(ASAR, 'services/cursor-llm-client.js').toString('utf8');
  const pkgJson = asar.extractFile(ASAR, 'package.json').toString('utf8');
  const ok =
    verify.includes('function renderOutlookVerifyPanel') &&
    verify.includes('deriveOutlookVolatilityDisplay') &&
    verify.includes('renderImpactDimensionsBadge') &&
    verify.includes('summaryIsEnglish') &&
    verify.includes('setupFocusNewsReaderDelegation') &&
    verify.includes('openFocusNewsModal') &&
    verify.includes('renderFocusTop5CursorDeepBlock') &&
    verify.includes('renderFocusTop5Card') &&
    verify.includes('getFocusDashboard') &&
    verify.includes('renderFocusDashboardSection') &&
    verify.includes('applyFocusAnalysisLiveUpdate') &&
    verify.includes('refreshFocusAnalysisProgressUI') &&
    verify.includes('saveCursorSettings') &&
    indexHtml.includes('cursorSaveBtn') &&
    indexHtml.includes('cursorConcurrencyInput') &&
    stylesCss.includes('settings-section-priority') &&
    mainJs.includes('get-focus-dashboard') &&
    mainJs.includes('focus-intel-updated') &&
    mainJs.includes('focus-analysis-updated') &&
    mainJs.includes('mark-impact-alerts-read') &&
    mainJs.includes('renderer-outlook-bridge') &&
    mainJs.includes('get-focus-news-article') &&
    mainJs.includes('setOutlookBackgroundCompleteHook') &&
    mainJs.includes('test-cursor-connection') &&
    (cursorClient.includes('v1.56.24-capital-attitude') ||
      cursorClient.includes('v1.56.23-capital-attitude')) &&
    cursorClient.includes('资金是终极态度') &&
    cursorClient.includes('getCloudConcurrencyLimit') &&
    pkgJson.includes('"version": "1.55.0"') &&
    asar.extractFile(ASAR, 'services/focus-impact-pins.js').toString('utf8').includes('v1.56.2-content-type') &&
    asar.extractFile(ASAR, 'services/news-coverage-audit.js').toString('utf8').includes('v1.56.9-coverage-audit') &&
    asar.extractFile(ASAR, 'services/commodity-release-calendar.js').toString('utf8').includes('v1.56.7-release-cal') &&
    asar.extractFile(ASAR, 'services/exchange-notice-fetcher.js').toString('utf8').includes('v1.56.9-exchange-notice') &&
    asar.extractFile(ASAR, 'services/dce-portal-api-fetcher.js').toString('utf8').includes('v1.56.19-inventory-gaps-closed') &&
    (asar.extractFile(ASAR, 'services/capital-attitude.js').toString('utf8').includes('v1.56.24-capital-attitude') ||
      asar.extractFile(ASAR, 'services/capital-attitude.js').toString('utf8').includes('v1.56.23-capital-attitude')) &&
    asar.extractFile(ASAR, 'services/commodities-history-fetcher.js').toString('utf8').includes('sina-daily-p') &&
    asar.extractFile(ASAR, 'services/commodities-history-fetcher.js').toString('utf8').includes('f63') &&
    asar.extractFile(ASAR, 'services/commodities-history-fetcher.js').toString('utf8').includes('persist === false') &&
    asar.extractFile(ASAR, 'services/data-quality-guard.js').toString('utf8').includes('tipSpreadOk') &&
    asar.extractFile(ASAR, 'services/commodity-outlook-backtest.js').toString('utf8').includes('buildStockFlowJoint') &&
    asar.extractFile(ASAR, 'services/commodity-outlook-engine.js').toString('utf8').includes('hydrateCapitalAttitudeOnOutlook') &&
    asar.extractFile(ASAR, 'src/app.js').toString('utf8').includes('仓单·资金合证') &&
    asar.extractFile(ASAR, 'src/app.js').toString('utf8').includes('持仓1周') &&
    asar.extractFile(ASAR, 'services/contradiction-matrix.js').toString('utf8').includes('v1.56.22-stock-flow-joint') &&
    asar.extractFile(ASAR, 'services/inventory-capital-joint.js').toString('utf8').includes('v1.56.22-stock-flow-joint') &&

    asar.extractFile(ASAR, 'services/czce-warehouse-fetcher.js').toString('utf8').includes('v1.56.19-czce-warehouse') &&
    asar.extractFile(ASAR, 'services/gfex-warehouse-fetcher.js').toString('utf8').includes('v1.56.19-gfex-warehouse') &&
    asar.extractFile(ASAR, 'services/thesis-registry.js').toString('utf8').includes('v1.56.22-stock-flow-joint') &&
    asar.extractFile(ASAR, 'services/thesis-registry.js').toString('utf8').includes('requireStockFlowJoint') &&
    asar.extractFile(ASAR, 'services/daily-data-sync.js').toString('utf8').includes('czce_warehouse') &&
    asar.extractFile(ASAR, 'services/daily-data-sync.js').toString('utf8').includes('member_ranking') &&
    asar.extractFile(ASAR, 'services/member-oi-features.js').toString('utf8').includes('v1.56.21-gfex-member-rank') &&
    asar.extractFile(ASAR, 'services/shfe-member-ranking-fetcher.js').toString('utf8').includes('shfe-official-pm.dat') &&
    asar.extractFile(ASAR, 'services/czce-member-ranking-fetcher.js').toString('utf8').includes('czce-official-holding') &&
    asar.extractFile(ASAR, 'services/gfex-member-ranking-fetcher.js').toString('utf8').includes('gfex-official-member') &&
    asar.extractFile(ASAR, 'services/focus-intelligence-brief.js').toString('utf8').includes('competingHypotheses') &&
    asar.extractFile(ASAR, 'services/outlook-trading-guidance.js').toString('utf8').includes('矛盾矩阵') &&
    mainJs.includes('get-commodity-release-calendar') &&
    verify.includes('renderFocusReleaseCalendarSection') &&
    verify.includes('renderContradictionMatrixBlock') &&
    asar.extractFile(ASAR, 'services/opinion-logic-gate.js').toString('utf8').includes('v1.56.4-opinion-logic') &&
    asar.extractFile(ASAR, 'services/focus-expectation-factors.js').toString('utf8').includes('v1.55.0-fundamentals-lane') &&
    asar.extractFile(ASAR, 'services/commodity-fundamentals-fetcher.js').toString('utf8').includes('v1.54.0-fundamentals') &&
    asar.extractFile(ASAR, 'services/focus-outlook-headlines.js').toString('utf8').includes('v1.55.0-headlines-surprise') &&
    asar.extractFile(ASAR, 'services/policy-fetcher.js').toString('utf8').includes('fetchPolicyHtmlFeed') &&
    asar.extractFile(ASAR, 'services/policy-sources.js').toString('utf8').includes('POLICY_HTML_FEEDS') &&
    asar.extractFile(ASAR, 'services/focus-news-relevance.js').toString('utf8').includes('v1.56.15-cu-strategic-watch') &&
    asar.extractFile(ASAR, 'services/user-focus-symbols.js').toString('utf8').includes('v1.56.15-cu-strategic-watch') &&
    asar.extractFile(ASAR, 'services/focus-news-source-quality.js').toString('utf8').includes('v1.56.0-source-quality') &&
    asar.extractFile(ASAR, 'services/focus-impact-dimensions.js').toString('utf8').includes('GLOBAL_SYMBOL_CAP') &&
    asar.extractFile(ASAR, 'services/focus-surprise-radar.js').toString('utf8').includes('surprise_high') &&
    asar.extractFile(ASAR, 'services/focus-news-zh.js').toString('utf8').includes('polishNewsFields') &&
    asar.extractFile(ASAR, 'services/focus-top5-deep-brief.js').toString('utf8').includes('buildRichBattleContext') &&
    asar.extractFile(ASAR, 'services/focus-intelligence-brief.js').toString('utf8').includes('buildBattleIntel') &&
    asar.extractFile(ASAR, 'services/outlook-prediction-utils.js').toString('utf8').includes('hasOutlookVolatilityForecast') &&
    sessionCal.includes('function getSessionWindow') &&
    rangeArchive.includes('resolveSlotActualHighLow') &&
    intradaySched.includes('startIntradayKlineScheduler') &&
    mainJs.includes('startIntradayKlineSchedulerMain') &&
    mainJs.includes('get-data-quality-status') &&
    css.includes('.outlook-focus-news-modal') &&
    css.includes('.outlook-top5-cursor');
  console.log('Verify:', {
    v1502: verify.includes('v1.50.2-news-reader'),
    newsReader: verify.includes('openFocusNewsModal'),
    top5DeepCursor: verify.includes('renderFocusTop5CursorDeepBlock'),
    outlookPctMode: verify.includes('deriveOutlookVolatilityDisplay'),
    focusDashboard: verify.includes('renderFocusDashboardSection'),
    focusAnalysisLive: verify.includes('applyFocusAnalysisLiveUpdate'),
    focusProgress: verify.includes('refreshFocusAnalysisProgressUI'),
    cursorIpc: mainJs.includes('test-cursor-connection'),
    focusIntelPush: mainJs.includes('focus-intel-updated'),
    newsIpc: mainJs.includes('get-focus-news-article'),
    top5DeepIpc: mainJs.includes('generate-top5-deep-brief'),
    pkgVersion1502: pkgJson.includes('"version": "1.50.2"'),
    newsReaderCss: css.includes('.outlook-focus-news-modal'),
    top5DeepCss: css.includes('.outlook-top5-cursor'),
    cursorConcurrency: indexHtml.includes('cursorConcurrencyInput'),
    cursorSaveBtn: indexHtml.includes('cursorSaveBtn'),
    cursorSettingsScroll: stylesCss.includes('settings-section-priority'),
    cursorCss: css.includes('.outlook-cursor-analysis-block'),
    getSessionWindow: sessionCal.includes('function getSessionWindow'),
    resolveSlotActualHighLow: rangeArchive.includes('resolveSlotActualHighLow'),
    intradayKlineScheduler: intradaySched.includes('startIntradayKlineScheduler'),
    mainSchedulerHook: mainJs.includes('startIntradayKlineSchedulerMain'),
    dataQualityStatus: mainJs.includes('get-data-quality-status'),
    outlookVerifyPanelCss: css.includes('.outlook-verify-panel'),
    asarBytes: fs.statSync(ASAR).size,
    ok,
  });

  if (!ok) {
    fs.copyFileSync(backup, ASAR);
    console.error('VERIFY FAILED — restored backup');
    process.exit(1);
  }

  console.log('Running deploy readiness gate (live data audit)...');
  const gate = require('child_process').spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'verify-deploy-ready.js'), '--asar', ASAR],
    {
      cwd: ROOT,
      env: { ...process.env, FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE || 'E' },
      stdio: 'inherit',
    }
  );
  if (gate.status !== 0 && !process.argv.includes('--force')) {
    console.error('Deploy gate failed — restoring backup');
    fs.copyFileSync(backup, ASAR);
    process.exit(gate.status || 1);
  }

  console.log('Done — quit and relaunch FanchengFinance.exe');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
