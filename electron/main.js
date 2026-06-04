const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const { getUserDataDir, migrateUserDataFromRoaming } = require('../services/data-paths');
const { version: APP_VERSION } = require('../package.json');
const { fetchAllData, fetchIndicesLive, fetchIndicesQuick, invalidateDataCache, getCachedAllData, scheduleBackgroundRefresh, setDataRefreshListener, fetchFedLive, refreshFedInBackground, patchSourceInCache } = require('../services/data-fetcher');
const config = require('../services/config');
const { warmAllCaches, getStartupSnapshot, getPushStartupPayload, prefetchAfterStartup, flushAllCaches } = require('../services/cache-store');
const { localizeErrorMessage } = require('../services/translate');
const { fetchIndexHistory, refreshIndexKline, listIndicesWithHistory } = require('../services/history-fetcher');
const { fetchCommoditiesLive } = require('../services/commodities-fetcher');
const {
  fetchCommodityHistory,
  refreshCommodityKline,
  listCommoditiesWithHistory,
} = require('../services/commodities-history-fetcher');
const { listCommodityCatalogFlat } = require('../services/commodities-catalog');
const { fetchMacroLive } = require('../services/macro-fetcher');
const { fetchForexLive, refreshForexLiveInBackground } = require('../services/forex-fetcher');
const { fetchPolicyLive, refreshPolicyLiveInBackground } = require('../services/policy-fetcher');
const { fetchGeopoliticsLive, refreshGeopoliticsInBackground } = require('../services/geopolitics-fetcher');
const { fetchBojLive, refreshBojInBackground } = require('../services/boj-fetcher');
const {
  fetchCommodityNews,
  fetchCommodityNewsRefresh,
  fetchCommoditiesNewsOverview,
  getCachedCommodityNews,
  warmNewsCache,
  invalidateNewsCache,
} = require('../services/commodities-news');

let mainWindow;
let forexPushTimer = null;
let policyPushTimer = null;
let geopoliticsPushTimer = null;
let centralBankPushTimer = null;

function bootstrapUserDataPath() {
  const externalUserData = getUserDataDir();
  if (externalUserData) {
    app.setPath('userData', externalUserData);
    migrateUserDataFromRoaming(externalUserData);
  }
}

bootstrapUserDataPath();

function getForexRefreshMs() {
  const seconds = config.readConfig().forexRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 10;
  return Math.max(5, Math.min(60, resolved)) * 1000;
}

function pushForexLiveToRenderer(data) {
  if (!mainWindow || mainWindow.isDestroyed() || !data?.pairs?.length) return;
  mainWindow.webContents.send('forex-live', data);
}

function startForexPushLoop() {
  if (forexPushTimer) clearInterval(forexPushTimer);
  const tick = async () => {
    try {
      const data = await fetchForexLive({ force: true });
      if (data?.pairs?.length) pushForexLiveToRenderer(data);
    } catch {
      refreshForexLiveInBackground().then((data) => {
        if (data?.pairs?.length) pushForexLiveToRenderer(data);
      });
    }
  };
  tick();
  forexPushTimer = setInterval(tick, getForexRefreshMs());
}

function getPolicyRefreshMs() {
  const seconds = config.readConfig().policyRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 30;
  return Math.max(15, Math.min(300, resolved)) * 1000;
}

function pushPolicyLiveToRenderer(data) {
  if (!mainWindow || mainWindow.isDestroyed() || !data?.items?.length) return;
  mainWindow.webContents.send('policy-live', data);
}

function pushGeopoliticsLiveToRenderer(data) {
  if (!mainWindow || mainWindow.isDestroyed() || !data?.items?.length) return;
  mainWindow.webContents.send('geopolitics-live', data);
}

function startGeopoliticsPushLoop() {
  if (geopoliticsPushTimer) clearInterval(geopoliticsPushTimer);
  const tick = async () => {
    try {
      const data = await fetchGeopoliticsLive({ force: true });
      if (data?.items?.length) pushGeopoliticsLiveToRenderer(data);
    } catch {
      refreshGeopoliticsInBackground().then((data) => {
        if (data?.items?.length) pushGeopoliticsLiveToRenderer(data);
      });
    }
  };
  setTimeout(tick, 8000);
  geopoliticsPushTimer = setInterval(tick, getPolicyRefreshMs());
}

function startPolicyPushLoop() {
  if (policyPushTimer) clearInterval(policyPushTimer);
  const tick = async () => {
    try {
      const data = await fetchPolicyLive({ force: true });
      if (data?.items?.length) pushPolicyLiveToRenderer(data);
    } catch {
      refreshPolicyLiveInBackground().then((data) => {
        if (data?.items?.length) pushPolicyLiveToRenderer(data);
      });
    }
  };
  tick();
  setTimeout(tick, 5000);
  policyPushTimer = setInterval(tick, getPolicyRefreshMs());
}

function getCentralBankRefreshMs() {
  const seconds = config.readConfig().policyRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 30;
  return Math.max(15, Math.min(300, resolved)) * 1000;
}

function hasCentralBankPayload(data) {
  return Boolean(data?.news?.length || data?.indicators?.length || data?.speeches?.length);
}

function pushFedLiveToRenderer(data) {
  if (!mainWindow || mainWindow.isDestroyed() || !hasCentralBankPayload(data)) return;
  mainWindow.webContents.send('fed-live', data);
}

function pushBojLiveToRenderer(data) {
  if (!mainWindow || mainWindow.isDestroyed() || !hasCentralBankPayload(data)) return;
  mainWindow.webContents.send('boj-live', data);
}

function startCentralBankPushLoop() {
  if (centralBankPushTimer) clearInterval(centralBankPushTimer);
  const tick = async () => {
    try {
      const [fed, boj] = await Promise.allSettled([fetchFedLive(), fetchBojLive()]);
      if (fed.status === 'fulfilled' && fed.value) {
        pushFedLiveToRenderer(fed.value);
      } else {
        refreshFedInBackground().then((data) => data && pushFedLiveToRenderer(data));
      }
      if (boj.status === 'fulfilled' && boj.value) {
        patchSourceInCache('boj', boj.value);
        pushBojLiveToRenderer(boj.value);
      } else {
        refreshBojInBackground().then((data) => {
          if (data) {
            patchSourceInCache('boj', data);
            pushBojLiveToRenderer(data);
          }
        });
      }
    } catch {
      // ignore
    }
  };
  setTimeout(tick, 3000);
  centralBankPushTimer = setInterval(tick, getCentralBankRefreshMs());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '梵澄金融',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('did-finish-load', () => {
    const payload = getPushStartupPayload();
    if (payload && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('startup-data', payload);
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  config.init(app.getPath('userData'));
  warmAllCaches(app.getPath('userData'));
  setDataRefreshListener((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('data-refreshed', payload);
    }
  });
  createWindow();
  startForexPushLoop();
  startPolicyPushLoop();
  startGeopoliticsPushLoop();
  startCentralBankPushLoop();
  setTimeout(() => prefetchAfterStartup(), 4000);
  setInterval(() => flushAllCaches(), 2 * 60 * 1000);
});

app.on('before-quit', () => {
  flushAllCaches();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-app-version', async () => APP_VERSION);

ipcMain.handle('get-startup-snapshot', async () => getStartupSnapshot());

ipcMain.handle('fetch-all', async (_event, options = {}) => {
  try {
    if (!options.force) {
      const cached = getCachedAllData();
      if (cached) {
        if (!options.skipBackground) scheduleBackgroundRefresh();
        return cached;
      }
    }
    return await Promise.race([
      fetchAllData(options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('数据加载超时，请检查网络')), 30000)
      ),
    ]);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '数据获取失败') };
  }
});

ipcMain.handle('get-config', async () => {
  const cfg = config.readConfig();
  return {
    ...cfg,
    fredApiKeyConfigured: config.isFredApiKeyConfigured(),
    fredApiKeyMasked: maskKey(cfg.fredApiKey),
    stooqApiKeyConfigured: config.isStooqApiKeyConfigured(),
    stooqApiKeyMasked: maskKey(cfg.stooqApiKey),
  };
});

ipcMain.handle('save-config', async (_event, partial) => {
  const saved = config.writeConfig(partial);
  if (partial.forexRefreshSeconds != null) {
    startForexPushLoop();
  }
  if (partial.policyRefreshSeconds != null) {
    startPolicyPushLoop();
    startGeopoliticsPushLoop();
  }
  return {
    ...saved,
    fredApiKeyConfigured: config.isFredApiKeyConfigured(),
    fredApiKeyMasked: maskKey(saved.fredApiKey),
    stooqApiKeyConfigured: config.isStooqApiKeyConfigured(),
    stooqApiKeyMasked: maskKey(saved.stooqApiKey),
  };
});

ipcMain.handle('fetch-indices-quick', async () => {
  try {
    return await fetchIndicesQuick();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '指数加载失败') };
  }
});

ipcMain.handle('fetch-indices-live', async () => {
  try {
    return await fetchIndicesLive();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '行情更新失败') };
  }
});

ipcMain.handle('refresh-index-kline', async (_event, indexId, timeframe, existingKlines) => {
  try {
    return await refreshIndexKline(indexId, timeframe, existingKlines || []);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线更新失败') };
  }
});

ipcMain.handle('fetch-index-history', async (_event, indexId, timeframe) => {
  try {
    return await fetchIndexHistory(indexId, timeframe || 'day');
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线数据获取失败') };
  }
});

ipcMain.handle('list-indices-history', async () => listIndicesWithHistory());

ipcMain.handle('fetch-commodities-live', async (_event, options = {}) => {
  try {
    return await fetchCommoditiesLive(options);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '大宗商品行情更新失败') };
  }
});

ipcMain.handle('fetch-commodity-history', async (_event, commodityId, timeframe) => {
  try {
    return await fetchCommodityHistory(commodityId, timeframe || 'day');
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线数据获取失败') };
  }
});

ipcMain.handle('refresh-commodity-kline', async (_event, commodityId, timeframe, existingKlines) => {
  try {
    return await refreshCommodityKline(commodityId, timeframe, existingKlines || []);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || 'K线更新失败') };
  }
});

ipcMain.handle('list-commodities-history', async () => listCommoditiesWithHistory());

function withIpcTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

ipcMain.handle('fetch-macro-live', async () => {
  try {
    return await fetchMacroLive();
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '宏观指标更新失败') };
  }
});

ipcMain.handle('fetch-geopolitics-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchGeopoliticsLive({ force: options.force !== false }),
      40000,
      '地缘政治更新超时'
    );
  } catch (err) {
    const cached = require('../services/geopolitics-fetcher').getCachedGeopoliticsSource();
    if (cached?.items?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '地缘政治更新失败') };
  }
});

ipcMain.handle('fetch-policy-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchPolicyLive({ force: options.force !== false }),
      35000,
      '政策雷达更新超时'
    );
  } catch (err) {
    const cached = require('../services/policy-fetcher').getCachedPolicySource();
    if (cached?.items?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '政策雷达更新失败') };
  }
});

ipcMain.handle('fetch-boj-live', async () => {
  try {
    const data = await fetchBojLive();
    if (hasCentralBankPayload(data)) patchSourceInCache('boj', data);
    return data;
  } catch (err) {
    const cached = require('../services/boj-fetcher').getCachedBojSource();
    if (cached?.indicators?.length || cached?.news?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '日本央行数据更新失败') };
  }
});

ipcMain.handle('fetch-fed-live', async () => {
  try {
    return await fetchFedLive();
  } catch (err) {
    const cached = getCachedAllData()?.sources?.fed;
    if (cached?.news?.length || cached?.indicators?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '美联储数据更新失败') };
  }
});

ipcMain.handle('fetch-forex-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchForexLive({ force: options.force !== false }),
      12000,
      '外汇行情更新超时'
    );
  } catch (err) {
    const cached = require('../services/forex-fetcher').getCachedForexSource();
    if (cached?.pairs?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '外汇行情更新失败') };
  }
});

ipcMain.handle('get-commodity-catalog', async () => listCommodityCatalogFlat());

ipcMain.handle('fetch-commodity-news', async (_event, commodityId) => {
  try {
    return await withIpcTimeout(
      commodityId ? fetchCommodityNews(commodityId) : fetchCommoditiesNewsOverview(),
      18000,
      '资讯加载超时'
    );
  } catch (err) {
    if (commodityId) {
      const fallback = getCachedCommodityNews(commodityId);
      if (fallback) return { ...fallback, fromCache: true };
    }
    return { error: localizeErrorMessage(err.message || '关联资讯获取失败') };
  }
});

ipcMain.handle('invalidate-commodity-news-cache', async () => {
  invalidateNewsCache();
  return true;
});

ipcMain.handle('warm-commodity-news-cache', async () => {
  warmNewsCache();
  return true;
});

ipcMain.handle('refresh-commodity-news', async (_event, commodityId) => {
  try {
    return await withIpcTimeout(
      commodityId ? fetchCommodityNewsRefresh(commodityId) : fetchCommoditiesNewsOverview(),
      20000,
      '资讯刷新超时'
    );
  } catch (err) {
    if (commodityId) {
      const fallback = getCachedCommodityNews(commodityId);
      if (fallback) return { ...fallback, fromCache: true };
    }
    return { error: localizeErrorMessage(err.message || '关联资讯刷新失败') };
  }
});

ipcMain.handle('open-external', async (_event, url) => {
  if (url && typeof url === 'string') {
    await shell.openExternal(url);
  }
});

ipcMain.handle('show-notification', async (_event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || '梵澄金融', body: body || '' }).show();
  }
});

function maskKey(key) {
  if (!key || key.length < 8) return '';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
