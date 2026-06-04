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
  const engineProbe = buildCommodityOutlookFromSources(getCachedAllData()?.sources || {});
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
  const auRangeOk = auRangeSpan == null || auRangeSpan <= 1.5;
  const factorSig = (inst) => JSON.stringify(inst?.factorBreakdown || {});
  const factorBreakdownDistinct =
    auInst?.factorBreakdown &&
    cuInst?.factorBreakdown &&
    saInst?.factorBreakdown &&
    (factorSig(auInst) !== factorSig(cuInst) || factorSig(cuInst) !== factorSig(saInst));
  if (auRangeSpan != null && !auRangeOk) {
    console.error(`[diagnose] au next-day range span ${auRangeSpan.toFixed(2)}% exceeds 1.5% cap`);
  }
  if (firstThree.length >= 3 && hasCommodities && (!rangesDistinct || !scoresDistinct || !noPendingDirection || !auRangeOk || !factorBreakdownDistinct)) {
    console.error(
      `[diagnose] outlook diversity check FAILED rangesDistinct=${rangesDistinct} scoresDistinct=${scoresDistinct} noPendingDirection=${noPendingDirection} auRangeOk=${auRangeOk} factorBreakdownDistinct=${factorBreakdownDistinct} auSpan=${auRangeSpan}`
    );
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
      const firstPrice = firstRow?.querySelector('.outlook-inst-price');
      const firstRange = firstRow?.querySelector('.outlook-range-value');
      const titleLen = firstTitle?.textContent?.trim().length || 0;
      const priceText = firstPrice?.textContent?.trim() || '';
      const rangeText = firstRange?.textContent?.trim() || '';
      const titleFontPx = firstTitle ? parseFloat(getComputedStyle(firstTitle).fontSize) : 0;
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
          rangeText: rangeText.slice(0, 40),
          hasPriceOrRangeText: /[\d.%+]/.test(priceText) || /[%~]/.test(rangeText),
        },
        errorBanner: document.getElementById('errorBanner')?.innerText,
        version: document.getElementById('appVersion')?.textContent,
      };
    })()
  `);

  console.log(
    JSON.stringify(
      {
        appVersion: APP_VERSION,
        catalogCount,
        registryCount,
        engineInstrumentCount: engineProbe.instruments?.length || 0,
        engineFirstHasPriceOrRange: firstHasPriceOrRange,
        outlookRangesDistinct: rangesDistinct,
        outlookScoresDistinct: scoresDistinct,
        outlookNoPendingDirection: noPendingDirection,
        auRangeSpan,
        auRangeOk,
        factorBreakdownDistinct,
        auFactorBreakdown: auInst?.factorBreakdown,
        cuFactorBreakdown: cuInst?.factorBreakdown,
        saFactorBreakdown: saInst?.factorBreakdown,
        ipcInstrumentCount: ipcOutlook?.instruments?.length || 0,
        result,
        consoleErrors: logs,
      },
      null,
      2
    )
  );
  app.quit();
});
