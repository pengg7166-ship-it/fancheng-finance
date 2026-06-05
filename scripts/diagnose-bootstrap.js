/**
 * Full bootstrap probe using real IPC handlers + renderer app.js
 * Usage: npx electron scripts/diagnose-bootstrap.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { getUserDataDir, migrateUserDataFromRoaming } = require('../services/data-paths');
const config = require('../services/config');
const { warmAllCaches, getStartupSnapshot, getPushStartupPayload } = require('../services/cache-store');
const {
  fetchAllData,
  fetchIndicesQuick,
  getCachedAllData,
  scheduleBackgroundRefresh,
} = require('../services/data-fetcher');
const { getAllCommodities } = require('../services/commodities-catalog');
const { localizeErrorMessage } = require('../services/translate');
const { version: APP_VERSION } = require('../package.json');
const {
  INSTRUMENT_REGISTRY,
  buildCommodityOutlookFromSources,
} = require('../services/commodity-outlook-engine');

function bootstrapUserDataPath() {
  const externalUserData = getUserDataDir();
  if (externalUserData) {
    app.setPath('userData', externalUserData);
    migrateUserDataFromRoaming(externalUserData);
  }
}

function registerIpc() {
  ipcMain.handle('get-app-version', async () => APP_VERSION);
  ipcMain.handle('get-startup-snapshot', async () => getStartupSnapshot());
  ipcMain.handle('get-config', async () => {
    const cfg = config.readConfig();
    return { ...cfg, fredApiKeyConfigured: config.isFredApiKeyConfigured() };
  });
  ipcMain.handle('fetch-indices-quick', async () => {
    try {
      return await fetchIndicesQuick();
    } catch (err) {
      return { error: localizeErrorMessage(err.message || '指数加载失败') };
    }
  });
  ipcMain.handle('fetch-all', async (_event, options = {}) => {
    try {
      if (!options.force) {
        const cached = getCachedAllData();
        if (cached) {
          if (!options.skipBackground) scheduleBackgroundRefresh();
          return cached;
        }
      }
      return await fetchAllData(options);
    } catch (err) {
      return { error: localizeErrorMessage(err.message || '数据获取失败') };
    }
  });
  ipcMain.handle('get-commodity-catalog', async () => {
    const { listCommodityCatalogFlat } = require('../services/commodities-catalog');
    return listCommodityCatalogFlat();
  });
  ipcMain.handle('warm-commodity-news-cache', async () => {
    const { warmNewsCache } = require('../services/commodities-news');
    warmNewsCache();
    return { ok: true };
  });
  ipcMain.handle('list-indices-history', async () => {
    const { listIndicesWithHistory } = require('../services/history-fetcher');
    return listIndicesWithHistory();
  });
  ipcMain.handle('fetch-index-history', async (_e, id, tf) => {
    const { fetchIndexHistory } = require('../services/history-fetcher');
    return fetchIndexHistory(id, tf);
  });
  ipcMain.handle('get-outlook-history', async (_event, instrumentId, days = 7) => {
    const { getOutlookHistory } = require('../services/commodity-outlook-history');
    return getOutlookHistory(instrumentId, days);
  });
  ipcMain.handle('bootstrap-outlook-daily', async () => {
    const { bootstrapDailyOutlook } = require('../services/commodity-outlook-history');
    const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
    const src = getCachedCommodityOutlookSource();
    return bootstrapDailyOutlook(src?.instruments);
  });
  ipcMain.handle('fetch-outlook-live', async (_event, options = {}) => {
    try {
      const { fetchCommodityOutlookLive } = require('../services/commodity-outlook-engine');
      const sources = getCachedAllData()?.sources;
      return await fetchCommodityOutlookLive({ force: options.force !== false, sources });
    } catch (err) {
      const cached = require('../services/commodity-outlook-engine').getCachedCommodityOutlookSource();
      if (cached?.instruments?.length || cached?.categories?.length) return { ...cached, fromCache: true };
      return { error: localizeErrorMessage(err.message || '大宗走势研判更新失败') };
    }
  });
}

bootstrapUserDataPath();
registerIpc();

app.whenReady().then(async () => {
  config.init(app.getPath('userData'));
  warmAllCaches(app.getPath('userData'));

  const registryCount = INSTRUMENT_REGISTRY.length;
  const catalogCount = getAllCommodities().length;
  let probeSources = getCachedAllData()?.sources || {};
  try {
    const { fetchCommoditiesLive } = require('../services/commodities-fetcher');
    const live = await fetchCommoditiesLive();
    if (live?.exchanges?.length) {
      probeSources = { ...probeSources, commodities: live };
      console.log(`[diagnose] commodities live loaded exchanges=${live.exchanges.length}`);
    }
  } catch (err) {
    console.log(`[diagnose] commodities live fetch skipped: ${err.message}`);
  }
  const engineProbe = buildCommodityOutlookFromSources(probeSources);
  const firstThree = (engineProbe.instruments || []).slice(0, 3);
  const firstInst = firstThree[0];
  const firstHasPriceOrRange = Boolean(
    (firstInst?.price != null && !Number.isNaN(Number(firstInst.price))) ||
      (firstInst?.nextDayRangePct &&
        firstInst.nextDayRangePct.low != null &&
        firstInst.nextDayRangePct.high != null)
  );
  const rangeStrings = firstThree.map((i) =>
    i?.nextDayRangePct ? `${i.nextDayRangePct.low}|${i.nextDayRangePct.mid}|${i.nextDayRangePct.high}` : ''
  );
  const compositeScores = firstThree.map((i) => i?.compositeScore);
  const rangesDistinct = new Set(rangeStrings.filter(Boolean)).size >= 2;
  const scoresDistinct = new Set(compositeScores.filter((s) => s != null)).size >= 2;
  const hasCommodities = Boolean(getCachedAllData()?.sources?.commodities?.exchanges?.some((e) => e.items?.length));
  const noPendingDirection = !hasCommodities || firstThree.every((i) => !String(i?.directionLabel || '').includes('研判积累中'));
  const auInst = (engineProbe.instruments || []).find((i) => String(i.id).toLowerCase() === 'au');
  const cuInst = (engineProbe.instruments || []).find((i) => String(i.id).toLowerCase() === 'cu');
  const saInst = (engineProbe.instruments || []).find((i) => String(i.id).toLowerCase() === 'sa');
  const auRange = auInst?.nextDayRangePct;
  const auRangeSpan = auRange ? Number(auRange.high) - Number(auRange.low) : null;
  const auRangeOk = auRangeSpan == null || auRangeSpan <= 1.25;
  const auVolForecast = auInst?.volForecastPct ?? auInst?.smoothedVol?.volForecastPct;
  const cuVolForecast = cuInst?.volForecastPct ?? cuInst?.smoothedVol?.volForecastPct;
  const volForecastNumeric =
    auVolForecast != null &&
    !Number.isNaN(Number(auVolForecast)) &&
    cuVolForecast != null &&
    !Number.isNaN(Number(cuVolForecast));
  const scenariosOk =
    auInst?.scenarios?.base?.low != null &&
    cuInst?.scenarios?.bull != null &&
    cuInst?.scenarios?.bear != null;
  const regimeOk = Boolean(engineProbe.globalRegime);
  if (auVolForecast != null && Number.isNaN(Number(auVolForecast))) {
    console.error(`[diagnose] au volForecastPct is not numeric: ${auVolForecast}`);
  }
  const factorSig = (inst) => JSON.stringify(inst?.factorBreakdown || {});
  const factorBreakdownDistinct =
    auInst?.factorBreakdown &&
    cuInst?.factorBreakdown &&
    saInst?.factorBreakdown &&
    (factorSig(auInst) !== factorSig(cuInst) || factorSig(cuInst) !== factorSig(saInst));
  if (auRangeSpan != null && !auRangeOk) {
    console.error(`[diagnose] au next-day range span ${auRangeSpan.toFixed(2)}% exceeds 1.5% cap`);
  }
  const adaptiveOk =
    auInst?.wInstant != null &&
    auInst?.latencyState != null &&
    typeof auInst?.factorBreakdown?.instant === 'number';
  const auRationaleLen = (auInst?.predictionRationale || '').length;
  const rationaleOk = auRationaleLen > 20 && (auInst?.predictionRationale || '').includes('\n');
  const predBoxesOk = Boolean(auInst?.scenarios?.base?.low != null && auInst?.nextDayRangePct?.expectedMovePct != null);
  const sectorSet = new Set((engineProbe.instruments || []).map((i) => i.sector));
  const sectorsOk = ['energy', 'chemical', 'black', 'metals', 'precious', 'agriculture'].every((s) =>
    sectorSet.has(s)
  );
  const catalog74 = catalogCount >= 74 && registryCount >= 74;
  const capitalOk =
    auInst?.capitalAttention?.score != null &&
    cuInst?.capitalAttention?.score != null &&
    auInst.capitalAttention.score >= 0 &&
    auInst.capitalAttention.score <= 100;
  const newsOk = cuInst?.factors?.news != null && typeof cuInst.factors.news.hitCount === 'number';
  const oiOk = (engineProbe.instruments || []).some((i) => {
    const oi = i?.factors?.oi;
    if (oi?.deltaPct != null && Math.abs(oi.deltaPct) >= 0.05) return true;
    if (oi?.current > 0 && oi?.label && !/待更新/.test(oi.label)) return true;
    return (i?.techBadges || []).some((b) => /持仓/.test(b.label || '') && !/待更新/.test(b.label || ''));
  });
  const scenarioSpreadOk =
    cuInst?.scenarios?.base?.mid != null &&
    cuInst?.scenarios?.bull?.mid != null &&
    Math.abs(Number(cuInst.scenarios.bull.mid) - Number(cuInst.scenarios.base.mid)) >= 0.02;
  const latencyUiOk = Boolean(auInst?.latencyState && auInst?.latencyLabel);
  const versionOk = APP_VERSION === '1.24.0';
  const scInst = (engineProbe.instruments || []).find((i) => String(i.id).toLowerCase() === 'sc');
  const fgInst = (engineProbe.instruments || []).find((i) => String(i.id).toLowerCase() === 'fg');
  const niInst = (engineProbe.instruments || []).find((i) => String(i.id).toLowerCase() === 'ni');
  const philosophyFieldOk = (inst) =>
    inst?.philosophy?.supplyDemand?.state != null &&
    inst?.philosophy?.financialEnvironment?.regime != null &&
    inst?.philosophy?.sdFinance?.score != null &&
    inst?.philosophy?.ranked?.primaryChip;
  const philosophyOk =
    philosophyFieldOk(auInst) &&
    philosophyFieldOk(scInst) &&
    philosophyFieldOk(fgInst) &&
    philosophyFieldOk(niInst);
  const philosophyMatrixOk = Boolean(engineProbe.framework?.philosophyMatrix?.demandStrong?.loose?.paradigm0820);
  const {
    countTodayArchiveEntries,
    getOutlookHistoryRoot,
    bootstrapDailyOutlook,
    getDailySummaryPath,
  } = require('../services/commodity-outlook-history');
  const archiveRoot = getOutlookHistoryRoot();
  const todayArchive = countTodayArchiveEntries();
  const dailyBootstrap = bootstrapDailyOutlook(engineProbe.instruments);
  const dailySummaryPath = getDailySummaryPath();
  const dailyFolderOk = Boolean(dailyBootstrap?.dailyDir && dailySummaryPath);
  const histCtxLen = (auInst?.historicalContext?.precedentSummary || '').length;
  const historicalOk = histCtxLen > 10;
  const techTagCount = (auInst?.techBadges || []).length;
  const techTagsOk = techTagCount >= 4;

  const engineChecks = {
    catalog74,
    sectorsOk,
    rangesDistinct,
    scoresDistinct,
    factorBreakdownDistinct,
    volForecastNumeric,
    scenariosOk,
    scenarioSpreadOk,
    regimeOk,
    adaptiveOk,
    latencyUiOk,
    auRangeOk,
    rationaleOk,
    predBoxesOk,
    capitalOk,
    newsOk,
    oiOk,
    versionOk,
    historicalOk,
    techTagsOk,
    dailyFolderOk,
    philosophyOk,
    philosophyMatrixOk,
  };
  const enginePass = Object.values(engineChecks).every(Boolean);
  if (!enginePass) {
    console.error(`[diagnose] engine checks FAILED ${JSON.stringify(engineChecks)} auSpan=${auRangeSpan}`);
  }
  console.log(
    `[diagnose] catalog=${catalogCount} registry=${registryCount} engineInstruments=${engineProbe.instruments?.length || 0} firstPriceOrRange=${firstHasPriceOrRange} version=${APP_VERSION}`
  );

  const logs = [];
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('console-message', (_e, _level, message) => {
    if (/failed|error|Error|exception/i.test(message)) logs.push(message);
  });

  win.webContents.on('did-finish-load', () => {
    const payload = getPushStartupPayload();
    if (payload) win.webContents.send('startup-data', payload);
  });

  await win.loadFile(path.join(__dirname, '../src/index.html'));
  await new Promise((r) => setTimeout(r, 10000));

  let ipcOutlook = null;
  try {
    ipcOutlook = await win.webContents.executeJavaScript(`
      (async () => window.fancheng?.fetchOutlookLive?.({ force: true }))()
    `);
    console.log(
      `[diagnose] ipcOutlook instruments=${ipcOutlook?.instruments?.length || 0} categories=${ipcOutlook?.categories?.length || 0} error=${ipcOutlook?.error || 'none'}`
    );
  } catch (err) {
    console.log(`[diagnose] ipcOutlook failed: ${err.message}`);
  }

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const outlookTab = document.querySelector('.tab[data-tab="outlook"]');
      outlookTab?.click();
      await new Promise((r) => setTimeout(r, 6000));
      const panels = document.getElementById('panels');
      const panelIds = [...document.querySelectorAll('.panel')].map(p => p.id);
      const activePanel = document.querySelector('.panel.active');
      const outlookPanel = document.getElementById('panel-outlook');
      const outlookText = outlookPanel?.innerText || '';
      const firstRow = outlookPanel?.querySelector('.outlook-instrument-row');
      const firstTitle = firstRow?.querySelector('.outlook-inst-title');
      const firstPriceBox = firstRow?.querySelector('.outlook-price-box');
      const firstChgBox = firstRow?.querySelector('.outlook-chg-box');
      const firstPredSmooth = firstRow?.querySelector('.outlook-pred-smooth');
      const firstPredExtreme = firstRow?.querySelector('.outlook-pred-extreme');
      const firstPredBox = firstRow?.querySelector('.outlook-pred-box');
      const volLine = firstRow?.querySelector('.outlook-vol-line');
      const techTags = firstRow?.querySelector('.outlook-tech-tags');
      const techTagCountUi = techTags?.querySelectorAll('.outlook-tech-badge')?.length || 0;
      const volFontPx = volLine ? parseFloat(getComputedStyle(volLine).fontSize) : 0;
      const volWeight = volLine ? getComputedStyle(volLine).fontWeight : '';
      firstRow?.querySelector('.outlook-instrument-main')?.click();
      await new Promise((r) => setTimeout(r, 800));
      const detailPanel = outlookPanel?.querySelector('.outlook-detail-panel:not([hidden])');
      const firstRationale = detailPanel?.querySelector('.outlook-prediction-rationale') || outlookPanel?.querySelector('.outlook-prediction-rationale');
      const historicalBlock = detailPanel?.querySelector('.outlook-historical-precedent');
      const historicalText = historicalBlock?.textContent?.trim() || '';
      const accuracyTable = detailPanel?.querySelector('.outlook-accuracy-table');
      const accuracyEmpty = detailPanel?.querySelector('.outlook-accuracy-empty');
      const latencyChip = firstRow?.querySelector('.outlook-latency-chip');
      const toolbarStamp = outlookPanel?.querySelector('.outlook-toolbar-stamp');
      const rowMain = firstRow?.querySelector('.outlook-instrument-main');
      const rowStyle = rowMain ? getComputedStyle(rowMain) : null;
      const titleLen = firstTitle?.textContent?.trim().length || 0;
      const priceText = firstPriceBox?.textContent?.trim() || '';
      const chgText = firstChgBox?.textContent?.trim() || '';
      const predText = firstPredBox?.textContent?.trim() || '';
      const rationaleText = firstRationale?.textContent?.trim() || '';
      const titleFontPx = firstTitle ? parseFloat(getComputedStyle(firstTitle).fontSize) : 0;
      const predFontPx = firstPredBox ? parseFloat(getComputedStyle(firstPredBox).fontSize) : 0;
      const blurOnPred = firstPredBox ? getComputedStyle(firstPredBox).filter !== 'none' : false;
      return {
        lastUpdated: document.getElementById('lastUpdated')?.textContent,
        panelsHidden: panels?.classList.contains('hidden'),
        panelCount: panelIds.length,
        panelIds,
        activePanel: activePanel?.id,
        activeText: activePanel?.innerText?.slice(0, 160),
        outlookHasContent: Boolean(outlookPanel?.querySelector('.outlook-panel')),
        outlookHasInstruments: Boolean(outlookPanel?.querySelector('.outlook-instrument-row')),
        outlookInstrumentCount: outlookPanel?.querySelectorAll('.outlook-instrument-row').length || 0,
        outlookSectorTabCount: outlookPanel?.querySelectorAll('.outlook-sector-tab').length || 0,
        outlookStuckLoading: /正在加载大宗走势研判/.test(outlookText),
        outlookHasEmptyState: /数据积累中|加载失败|刷新研判/.test(outlookText),
        outlookText: outlookText.slice(0, 320),
        outlookFirstRow: {
          titleLen,
          titleFontPx,
          titleLegible: titleLen >= 2 && titleFontPx >= 13,
          priceText: priceText.slice(0, 40),
          predText: predText.slice(0, 60),
          predBoxesVisible: Boolean(firstPredBox),
          predSmoothVisible: Boolean(firstPredSmooth),
          predExtremeVisible: Boolean(firstPredExtreme),
          priceBoxVisible: Boolean(firstPriceBox),
          chgBoxVisible: Boolean(firstChgBox),
          detailPanelVisible: Boolean(detailPanel),
          accuracyTableVisible: Boolean(accuracyTable),
          accuracyPendingVisible: /等待收盘校验/.test(accuracyEmpty?.textContent || ''),
          latencyChipVisible: Boolean(latencyChip),
          toolbarStampVisible: Boolean(toolbarStamp?.textContent?.trim()),
          rowMinHeightPx: rowStyle ? parseFloat(rowStyle.minHeight) : 0,
          predFontPx,
          predLegible: predFontPx >= 13 && !blurOnPred,
          volLineVisible: Boolean(volLine),
          volFontPx,
          volLegible: volFontPx >= 15 && (volWeight === '700' || parseInt(volWeight, 10) >= 700),
          techTagCountUi,
          techTagsNoOverlap: techTagCountUi >= 4,
          historicalLen: historicalText.length,
          historicalOk: historicalText.length > 10,
          rationaleLen: rationaleText.length,
          rationaleOk: rationaleText.length > 20 && !/研判积累中/.test(rationaleText),
          rationaleMultiline: (rationaleText.match(/\\n/g) || []).length >= 1 || rationaleText.split('·').length >= 4,
          hasPriceOrPredText: /[\\d.%+]/.test(priceText) || /[%~±]/.test(predText),
          chgText: chgText.slice(0, 20),
        },
        errorBanner: document.getElementById('errorBanner')?.innerText,
        version: document.getElementById('appVersion')?.textContent,
      };
    })()
  `);

  const ui = result?.outlookFirstRow || {};
  const uiChecks = {
    outlook74: (result?.outlookInstrumentCount || 0) >= 74,
    sectorTabs: (result?.outlookSectorTabCount || 0) >= 7,
    priceBox: ui.priceBoxVisible,
    chgBox: ui.chgBoxVisible,
    predDualBox: ui.predSmoothVisible && ui.predExtremeVisible,
    predLegible: ui.predLegible,
    detailBelow: ui.detailPanelVisible,
    rationaleUi: ui.rationaleOk && ui.rationaleMultiline,
    accuracyUi:
      ui.accuracyTableVisible ||
      ui.accuracyPendingVisible ||
      /等待收盘校验|昨日存档/.test(
        (detailPanel?.querySelector('.outlook-detail-col-accuracy') || detailPanel)?.textContent || ''
      ),
    latencyChip: ui.latencyChipVisible,
    toolbar: ui.toolbarStampVisible,
    rowHeight: ui.rowMinHeightPx >= 72,
    versionUi: result?.version === 'v1.23.0',
    volLineUi: ui.volLineVisible && ui.volLegible,
    techTagsUi: ui.techTagsNoOverlap,
    historicalUi: ui.historicalOk,
    notStuck: !result?.outlookStuckLoading,
  };
  const uiPass = Object.values(uiChecks).every(Boolean);

  const checklist = [
    { id: 'A1', name: '74+品种六板块', pass: engineChecks.catalog74 && engineChecks.sectorsOk },
    { id: 'A2', name: '铜金区间/分差异', pass: engineChecks.rangesDistinct && engineChecks.scoresDistinct },
    { id: 'A3', name: '因子分解差异', pass: engineChecks.factorBreakdownDistinct },
    { id: 'A4', name: '资金关注0-100', pass: engineChecks.capitalOk },
    { id: 'A5', name: '资讯影响力', pass: engineChecks.newsOk },
    { id: 'A6', name: '持仓非零展示', pass: engineChecks.oiOk },
    { id: 'A7', name: '波动率数值', pass: engineChecks.volForecastNumeric },
    { id: 'A8', name: '双速反射', pass: engineChecks.adaptiveOk && engineChecks.latencyUiOk },
    { id: 'A9', name: '黄金区间≤1.25%', pass: engineChecks.auRangeOk },
    { id: 'B1', name: '预测双框', pass: engineChecks.predBoxesOk && uiChecks.predDualBox },
    { id: 'B2', name: '预测缘由多行', pass: engineChecks.rationaleOk && uiChecks.rationaleUi },
    { id: 'B3', name: '四情景差异', pass: engineChecks.scenariosOk && engineChecks.scenarioSpreadOk },
    { id: 'B4', name: '预测校验UI', pass: uiChecks.accuracyUi },
    { id: 'C1', name: '现价涨跌框', pass: uiChecks.priceBox && uiChecks.chgBox },
    { id: 'D1', name: '详情面板排版', pass: uiChecks.detailBelow && uiChecks.predLegible && uiChecks.rowHeight },
    { id: 'D2', name: '工具栏板块时间戳', pass: uiChecks.sectorTabs && uiChecks.toolbar },
    { id: 'E1', name: '版本1.23.0', pass: engineChecks.versionOk && uiChecks.versionUi },
    { id: 'E2', name: '存档目录', pass: Boolean(archiveRoot) },
    { id: 'E3', name: '每日快照目录', pass: engineChecks.dailyFolderOk },
    { id: 'E4', name: '历史对照文案', pass: engineChecks.historicalOk && uiChecks.historicalUi },
    { id: 'E5', name: '预测波动行', pass: uiChecks.volLineUi },
    { id: 'E6', name: '技术标签≥4', pass: engineChecks.techTagsOk && uiChecks.techTagsUi },
  ];

  const allPass = enginePass && uiPass && checklist.every((c) => c.pass);

  console.log(
    JSON.stringify(
      {
        appVersion: APP_VERSION,
        catalogCount,
        registryCount,
        engineInstrumentCount: engineProbe.instruments?.length || 0,
        engineFirstHasPriceOrRange: firstHasPriceOrRange,
        engineChecks,
        uiChecks,
        checklist,
        allPass,
        todayArchiveCount: todayArchive,
        archiveRoot,
        dailySummaryPath,
        dailyBootstrap,
        histCtxLen,
        techTagCount,
        auRangeSpan,
        ipcInstrumentCount: ipcOutlook?.instruments?.length || 0,
        result,
        consoleErrors: logs,
      },
      null,
      2
    )
  );

  for (const row of checklist) {
    console.log(`[diagnose] ${row.pass ? 'PASS' : 'FAIL'} ${row.id} ${row.name}`);
  }

  if (!allPass) {
    console.error('[diagnose] CHECKLIST FAILED — fix before release');
    process.exitCode = 1;
  } else {
    console.log('[diagnose] CHECKLIST ALL PASS');
  }
  app.quit();
});
