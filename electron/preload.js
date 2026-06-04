const { contextBridge, ipcRenderer } = require('electron');

async function safeInvoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

contextBridge.exposeInMainWorld('fancheng', {
  getAppVersion: () => safeInvoke('get-app-version'),
  fetchAll: (options) => safeInvoke('fetch-all', options),
  fetchIndicesQuick: () => safeInvoke('fetch-indices-quick'),
  getStartupSnapshot: () => safeInvoke('get-startup-snapshot'),
  onStartupData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('startup-data', handler);
    return () => ipcRenderer.removeListener('startup-data', handler);
  },
  onDataRefreshed: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('data-refreshed', handler);
    return () => ipcRenderer.removeListener('data-refreshed', handler);
  },
  fetchIndicesLive: () => safeInvoke('fetch-indices-live'),
  refreshIndexKline: (id, tf, klines) => safeInvoke('refresh-index-kline', id, tf, klines),
  fetchIndexHistory: (id, timeframe) => safeInvoke('fetch-index-history', id, timeframe),
  listIndicesHistory: () => safeInvoke('list-indices-history'),
  fetchCommoditiesLive: (options) => safeInvoke('fetch-commodities-live', options),
  fetchMacroLive: () => safeInvoke('fetch-macro-live'),
  fetchFedLive: () => safeInvoke('fetch-fed-live'),
  fetchBojLive: () => safeInvoke('fetch-boj-live'),
  fetchForexLive: (options) => safeInvoke('fetch-forex-live', options),
  fetchPolicyLive: (options) => safeInvoke('fetch-policy-live', options),
  fetchGeopoliticsLive: (options) => safeInvoke('fetch-geopolitics-live', options),
  fetchClimateLive: (options) => safeInvoke('fetch-climate-live', options),
  fetchOutlookLive: (options) => safeInvoke('fetch-outlook-live', options),
  onForexLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('forex-live', handler);
    return () => ipcRenderer.removeListener('forex-live', handler);
  },
  onPolicyLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('policy-live', handler);
    return () => ipcRenderer.removeListener('policy-live', handler);
  },
  onGeopoliticsLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('geopolitics-live', handler);
    return () => ipcRenderer.removeListener('geopolitics-live', handler);
  },
  onClimateLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('climate-live', handler);
    return () => ipcRenderer.removeListener('climate-live', handler);
  },
  onOutlookLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('outlook-live', handler);
    return () => ipcRenderer.removeListener('outlook-live', handler);
  },
  onWindowFocusChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('window-focus-changed', handler);
    return () => ipcRenderer.removeListener('window-focus-changed', handler);
  },
  onFedLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('fed-live', handler);
    return () => ipcRenderer.removeListener('fed-live', handler);
  },
  onBojLive: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('boj-live', handler);
    return () => ipcRenderer.removeListener('boj-live', handler);
  },
  fetchCommodityHistory: (id, timeframe) => safeInvoke('fetch-commodity-history', id, timeframe),
  refreshCommodityKline: (id, tf, klines) => safeInvoke('refresh-commodity-kline', id, tf, klines),
  listCommoditiesHistory: () => safeInvoke('list-commodities-history'),
  fetchCommodityNews: (id) => safeInvoke('fetch-commodity-news', id),
  fetchCommodityCatalog: () => safeInvoke('get-commodity-catalog'),
  refreshCommodityNews: (id) => safeInvoke('refresh-commodity-news', id),
  warmCommodityNewsCache: () => safeInvoke('warm-commodity-news-cache'),
  invalidateCommodityNewsCache: () => safeInvoke('invalidate-commodity-news-cache'),
  getConfig: () => safeInvoke('get-config'),
  saveConfig: (partial) => safeInvoke('save-config', partial),
  openExternal: (url) => safeInvoke('open-external', url),
  showNotification: (payload) => safeInvoke('show-notification', payload),
});
