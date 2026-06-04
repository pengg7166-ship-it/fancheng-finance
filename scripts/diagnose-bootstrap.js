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

function bootstrapUserDataPath() {
  const externalUserData = getUserDataDir();
  if (externalUserData) {
    app.setPath('userData', externalUserData);
    migrateUserDataFromRoaming(externalUserData);
  }
}

bootstrapUserDataPath();

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
}

registerIpc();

app.whenReady().then(async () => {
  config.init(app.getPath('userData'));
  warmAllCaches(app.getPath('userData'));

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

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const panels = document.getElementById('panels');
      const panelIds = [...document.querySelectorAll('.panel')].map(p => p.id);
      const activePanel = document.querySelector('.panel.active');
      return {
        lastUpdated: document.getElementById('lastUpdated')?.textContent,
        panelsHidden: panels?.classList.contains('hidden'),
        panelCount: panelIds.length,
        panelIds,
        activePanel: activePanel?.id,
        activeText: activePanel?.innerText?.slice(0, 160),
        errorBanner: document.getElementById('errorBanner')?.innerText,
        version: document.getElementById('appVersion')?.textContent,
      };
    })()
  `);

  console.log(JSON.stringify({ result, consoleErrors: logs }, null, 2));
  app.quit();
});
