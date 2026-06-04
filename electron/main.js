const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const { getUserDataDir, migrateUserDataFromRoaming } = require('../services/data-paths');
const { version: APP_VERSION } = require('../package.json');
const { fetchAllData, fetchIndicesLive, fetchIndicesQuick, invalidateDataCache, getCachedAllData, scheduleBackgroundRefresh, setDataRefreshListener, fetchFedLive, refreshFedInBackground, patchSourceInCache } = require('../services/data-fetcher');
const config = require('../services/config');
const { warmAllCaches, getStartupSnapshot, getPushStartupPayload, prefetchAfterStartup, flushAllCaches } = require('../services/cache-store');
const { localizeErrorMessage } = require('../services/translate');
const { fetchIndexHistory, refreshIndexKline, listIndicesWithHistory } = require('../services/history-fetcher');
const { fetchCommoditiesLive, refreshCommoditiesLiveInBackground } = require('../services/commodities-fetcher');
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
const { fetchClimateLive, refreshClimateInBackground } = require('../services/climate-fetcher');
const {
  fetchCommodityOutlookLive,
  refreshCommodityOutlookInBackground,
} = require('../services/commodity-outlook-engine');
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
let unifiedPushTimer = null;
let pushCycleIndex = 0;
let windowInteractive = true;
let pushLoopsPaused = false;
const lastPushHashByChannel = {};
const lastPushAtByChannel = {};
const pendingPushByChannel = {};
const pushFlushTimers = {};
const MIN_PUSH_INTERVAL_MS = 2500;

function hashLiveItemsPayload(data) {
  if (!data) return '';
  const stamp = data.liveRefreshedAt || data.updatedAt || '';
  const count = data.items?.length || data.pairs?.length || 0;
  const head = data.items?.[0]?.id || data.pairs?.[0]?.id || '';
  return `${stamp}|${count}|${head}`;
}

function hashCentralBankPayload(data) {
  if (!data) return '';
  const stamp = data.liveRefreshedAt || data.updatedAt || '';
  return `${stamp}|${data.news?.length || 0}|${data.speeches?.length || 0}|${data.indicators?.length || 0}`;
}

function hashCommoditiesPayload(data) {
  if (!data?.exchanges?.length) return '';
  const stamp = data.fetchedAt || data.liveRefreshedAt || '';
  const items = data.exchanges.flatMap((ex) => ex.items || []);
  const priceSig = items
    .filter((i) => i.price != null)
    .slice(0, 12)
    .map((i) => `${i.id}:${i.price}:${i.changePct}`)
    .join('|');
  return `${stamp}|${items.length}|${priceSig}`;
}

function pushToRenderer(channel, data, hashFn) {
  if (!mainWindow || mainWindow.isDestroyed() || !data || !windowInteractive) return;
  if (mainWindow.webContents.isLoading()) return;
  const hash = hashFn(data);
  if (!hash || lastPushHashByChannel[channel] === hash) return;

  pendingPushByChannel[channel] = { data, hash };

  const flush = () => {
    const pending = pendingPushByChannel[channel];
    if (!pending) return;
    delete pendingPushByChannel[channel];
    delete pushFlushTimers[channel];
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (lastPushHashByChannel[channel] === pending.hash) return;
    lastPushHashByChannel[channel] = pending.hash;
    lastPushAtByChannel[channel] = Date.now();
    mainWindow.webContents.send(channel, pending.data);
  };

  const now = Date.now();
  const elapsed = now - (lastPushAtByChannel[channel] || 0);
  if (elapsed >= MIN_PUSH_INTERVAL_MS && !pushFlushTimers[channel]) {
    flush();
  } else if (!pushFlushTimers[channel]) {
    pushFlushTimers[channel] = setTimeout(flush, Math.max(50, MIN_PUSH_INTERVAL_MS - elapsed));
  }
}

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
  const resolved = Number.isFinite(seconds) ? seconds : 15;
  return Math.max(15, Math.min(60, resolved)) * 1000;
}

function pushForexLiveToRenderer(data) {
  if (!data?.pairs?.length) return;
  pushToRenderer('forex-live', data, hashLiveItemsPayload);
}

function makePushTick(fetchFn, refreshFn, pushFn) {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      try {
        const data = await fetchFn({ force: false });
        if (hasLivePushPayload(data)) {
          pushFn(data);
          return;
        }
      } catch {
        // fall through to background refresh
      }
      const data = await refreshFn();
      if (hasLivePushPayload(data)) {
        pushFn(data);
      }
    } catch {
      // ignore
    } finally {
      busy = false;
    }
  };
}

function clearUnifiedPushTimer() {
  if (unifiedPushTimer) clearInterval(unifiedPushTimer);
  unifiedPushTimer = null;
}

function setWindowInteractive(active) {
  windowInteractive = active;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setBackgroundThrottling(!active);
  }
  if (active && !pushLoopsPaused) {
    runPushCycle(true);
  }
}

function pausePushLoops() {
  pushLoopsPaused = true;
  clearUnifiedPushTimer();
  for (const key of Object.keys(pushFlushTimers)) {
    clearTimeout(pushFlushTimers[key]);
    delete pushFlushTimers[key];
  }
}

function resumePushLoops() {
  if (!pushLoopsPaused) return;
  pushLoopsPaused = false;
  startUnifiedPushLoop();
}

function makeCentralBankPushTick() {
  let busy = false;
  return async () => {
    if (busy || !windowInteractive) return;
    busy = true;
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
    } finally {
      busy = false;
    }
  };
}

const pushCycleSteps = [
  { name: 'commodities', run: null },
  { name: 'forex', run: null },
  { name: 'policy', run: null },
  { name: 'geopolitics', run: null },
  { name: 'climate', run: null },
  { name: 'outlook', run: null },
  { name: 'centralBank', run: null },
];

function initPushCycleSteps() {
  pushCycleSteps[0].run = makePushTick(
    fetchCommoditiesLive,
    refreshCommoditiesLiveInBackground,
    pushCommoditiesLiveToRenderer
  );
  pushCycleSteps[1].run = makePushTick(fetchForexLive, refreshForexLiveInBackground, pushForexLiveToRenderer);
  pushCycleSteps[2].run = makePushTick(fetchPolicyLive, refreshPolicyLiveInBackground, pushPolicyLiveToRenderer);
  pushCycleSteps[3].run = makePushTick(
    fetchGeopoliticsLive,
    refreshGeopoliticsInBackground,
    pushGeopoliticsLiveToRenderer
  );
  pushCycleSteps[4].run = makePushTick(fetchClimateLive, refreshClimateInBackground, pushClimateLiveToRenderer);
  pushCycleSteps[5].run = makePushTick(
    fetchCommodityOutlookLive,
    refreshCommodityOutlookInBackground,
    pushOutlookLiveToRenderer
  );
  pushCycleSteps[6].run = makeCentralBankPushTick();
}

async function runPushCycle(force = false) {
  if (pushLoopsPaused || !windowInteractive) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!force && mainWindow.isMinimized() && !mainWindow.isFocused()) return;
  if (!pushCycleSteps[0].run) initPushCycleSteps();
  const step = pushCycleSteps[pushCycleIndex % pushCycleSteps.length];
  pushCycleIndex += 1;
  try {
    await step.run();
  } catch {
    // ignore
  }
}

function startUnifiedPushLoop() {
  clearUnifiedPushTimer();
  if (pushLoopsPaused) return;
  initPushCycleSteps();
  const baseMs =
    Math.max(getForexRefreshMs(), getPolicyRefreshMs(), getCentralBankRefreshMs()) + 12000;
  const stepMs = Math.max(8000, Math.floor(baseMs / pushCycleSteps.length));
  setTimeout(() => runPushCycle(true), 5000);
  unifiedPushTimer = setInterval(() => runPushCycle(false), stepMs);
}

function startForexPushLoop() {
  startUnifiedPushLoop();
}

function startGeopoliticsPushLoop() {
  startUnifiedPushLoop();
}

function startClimatePushLoop() {
  startUnifiedPushLoop();
}

function startPolicyPushLoop() {
  startUnifiedPushLoop();
}

function startCentralBankPushLoop() {
  startUnifiedPushLoop();
}

function getPolicyRefreshMs() {
  const seconds = config.readConfig().policyRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 45;
  return Math.max(30, Math.min(300, resolved)) * 1000;
}

function pushPolicyLiveToRenderer(data) {
  if (!data?.items?.length) return;
  pushToRenderer('policy-live', data, hashLiveItemsPayload);
}

function pushGeopoliticsLiveToRenderer(data) {
  if (!data?.items?.length) return;
  pushToRenderer('geopolitics-live', data, hashLiveItemsPayload);
}

function pushClimateLiveToRenderer(data) {
  if (!data?.items?.length) return;
  pushToRenderer('climate-live', data, hashLiveItemsPayload);
}

function pushOutlookLiveToRenderer(data) {
  if (!data?.categories?.length && !data?.instruments?.length) return;
  pushToRenderer('outlook-live', data, hashLiveItemsPayload);
}

function pushCommoditiesLiveToRenderer(data) {
  if (!data?.exchanges?.some((ex) => ex.items?.length)) return;
  pushToRenderer('commodities-live', data, hashCommoditiesPayload);
}

function getCentralBankRefreshMs() {
  const seconds = config.readConfig().policyRefreshSeconds;
  const resolved = Number.isFinite(seconds) ? seconds : 30;
  return Math.max(15, Math.min(300, resolved)) * 1000;
}

function hasCentralBankPayload(data) {
  return Boolean(data?.news?.length || data?.indicators?.length || data?.speeches?.length);
}

function hasLivePushPayload(data) {
  return Boolean(
    data?.pairs?.length ||
    data?.items?.length ||
    data?.exchanges?.some((ex) => ex.items?.length) ||
    data?.categories?.length ||
    data?.instruments?.length ||
    hasCentralBankPayload(data)
  );
}

function pushFedLiveToRenderer(data) {
  if (!hasCentralBankPayload(data)) return;
  pushToRenderer('fed-live', data, hashCentralBankPayload);
}

function pushBojLiveToRenderer(data) {
  if (!hasCentralBankPayload(data)) return;
  pushToRenderer('boj-live', data, hashCentralBankPayload);
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
  mainWindow.webContents.setBackgroundThrottling(false);

  const notifyFocus = (focused) => {
    setWindowInteractive(focused);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-focus-changed', { focused });
    }
  };
  mainWindow.on('focus', () => notifyFocus(true));
  mainWindow.on('blur', () => notifyFocus(false));
  mainWindow.on('minimize', () => pausePushLoops());
  mainWindow.on('restore', () => {
    resumePushLoops();
    notifyFocus(true);
  });
  mainWindow.on('hide', () => pausePushLoops());
  mainWindow.on('show', () => {
    resumePushLoops();
    notifyFocus(true);
  });

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
  setTimeout(() => startUnifiedPushLoop(), 3000);
  setTimeout(() => prefetchAfterStartup(), 12000);
  setInterval(() => flushAllCaches(), 5 * 60 * 1000);
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
  if (partial.forexRefreshSeconds != null || partial.policyRefreshSeconds != null) {
    startUnifiedPushLoop();
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
    const data = await fetchCommoditiesLive(options);
    if (!data?.error) pushCommoditiesLiveToRenderer(data);
    return data;
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

ipcMain.handle('fetch-climate-live', async (_event, options = {}) => {
  try {
    return await withIpcTimeout(
      fetchClimateLive({ force: options.force !== false }),
      40000,
      '天气气候更新超时'
    );
  } catch (err) {
    const cached = require('../services/climate-fetcher').getCachedClimateSource();
    if (cached?.items?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '天气气候更新失败') };
  }
});

ipcMain.handle('fetch-outlook-live', async (_event, options = {}) => {
  try {
    const sources = getCachedAllData()?.sources;
    return await withIpcTimeout(
      fetchCommodityOutlookLive({ force: options.force !== false, sources }),
      15000,
      '大宗走势研判更新超时'
    );
  } catch (err) {
    const cached = require('../services/commodity-outlook-engine').getCachedCommodityOutlookSource();
    if (cached?.instruments?.length || cached?.categories?.length) return { ...cached, fromCache: true };
    return { error: localizeErrorMessage(err.message || '大宗走势研判更新失败') };
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

ipcMain.handle('get-outlook-history', async (_event, instrumentId, days = 7) => {
  try {
    const { getOutlookHistory } = require('../services/commodity-outlook-history');
    return getOutlookHistory(instrumentId, days);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '研判存档读取失败') };
  }
});

ipcMain.handle('export-outlook-history', async (_event, instrumentId, days = 30) => {
  try {
    const { exportOutlookHistory } = require('../services/commodity-outlook-history');
    return exportOutlookHistory(instrumentId, days);
  } catch (err) {
    return { error: localizeErrorMessage(err.message || '研判存档导出失败') };
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
