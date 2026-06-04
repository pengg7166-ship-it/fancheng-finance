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
  const engineProbe = buildCommodityOutlookFromSources(getCachedAllData()?.sources || {});
  console.log(
    `[diagnose] registry=${registryCount} engineInstruments=${engineProbe.instruments?.length || 0} categories=${engineProbe.categories?.length || 0} version=${APP_VERSION}`
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
        errorBanner: document.getElementById('errorBanner')?.innerText,
        version: document.getElementById('appVersion')?.textContent,
      };
    })()
  `);

  console.log(
    JSON.stringify(
      {
        appVersion: APP_VERSION,
        registryCount,
        engineInstrumentCount: engineProbe.instruments?.length || 0,
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
