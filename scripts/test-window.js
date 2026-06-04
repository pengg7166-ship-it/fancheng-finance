/**
 * Open real app window and probe renderer fancheng APIs.
 * Usage: npx electron scripts/test-window.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const config = require('../services/config');
const { warmAllCaches, getPushStartupPayload, getStartupSnapshot } = require('../services/cache-store');
const { fetchAllData, fetchIndicesQuick, getCachedAllData, scheduleBackgroundRefresh } = require('../services/data-fetcher');
const { localizeErrorMessage } = require('../services/translate');

app.whenReady().then(async () => {
  config.init(app.getPath('userData'));
  warmAllCaches(app.getPath('userData'));

  ipcMain.handle('get-startup-snapshot', async () => getStartupSnapshot());
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

  const payload = getPushStartupPayload();
  console.log('main push payload indices:', payload?.sources?.indices?.indexStats);

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let pushCount = 0;
  win.webContents.on('did-finish-load', () => {
    pushCount += 1;
    console.log('did-finish-load', pushCount);
    const p = getPushStartupPayload();
    if (p) win.webContents.send('startup-data', p);
  });

  await win.loadFile(path.join(__dirname, '../src/index.html'));

  await new Promise((r) => setTimeout(r, 3000));

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const out = { fancheng: !!window.fancheng, version: null };
      if (window.fancheng?.getAppVersion) {
        const v = await window.fancheng.getAppVersion();
        out.version = v?.error ? null : v;
      }
      try {
        const snap = await window.fancheng.getStartupSnapshot();
        out.snapshot = {
          hasAllData: !!snap?.allData,
          indexStats: snap?.allData?.sources?.indices?.indexStats,
          indexCount: snap?.allData?.sources?.indices?.regions?.reduce((n,r)=>n+(r.indices?.length||0),0)
        };
      } catch (e) { out.snapshotError = e.message; }
      try {
        const q = await window.fancheng.fetchIndicesQuick();
        out.quick = { error: q?.error, indexCount: q?.regions?.reduce((n,r)=>n+(r.indices?.length||0),0) };
      } catch (e) { out.quickError = e.message; }
      try {
        const all = await window.fancheng.fetchAll({ force: false, fast: true });
        out.fetchAll = { error: all?.error, fromCache: all?.fromCache, indexCount: all?.sources?.indices?.regions?.reduce((n,r)=>n+(r.indices?.length||0),0) };
      } catch (e) { out.fetchAllError = e.message; }
      out.pendingStartup = window.__pendingStartupData ? window.__pendingStartupData.sources?.indices?.indexStats : null;
      out.panelText = document.getElementById('panel-indices')?.innerText?.slice(0,80);
      out.errorBanner = document.getElementById('errorBanner')?.innerText;
      return out;
    })()
  `);

  console.log('\n--- renderer probe ---');
  console.log(JSON.stringify(result, null, 2));

  app.quit();
});
