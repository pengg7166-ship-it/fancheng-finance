/**
 * Simulate renderer bootstrap IPC sequence in Electron main.
 * Usage: npx electron scripts/diagnose-renderer.js
 */
const { app, ipcMain } = require('electron');
const path = require('path');

// Re-use same handlers as main.js
const config = require('../services/config');
const diskCache = require('../services/disk-cache');
const {
  fetchAllData,
  fetchIndicesQuick,
  getCachedAllData,
} = require('../services/data-fetcher');
const { getStartupSnapshot } = require('../services/cache-store');
const { localizeErrorMessage } = require('../services/translate');

async function invokeFetchAll(options = {}) {
  if (!options.force) {
    const cached = getCachedAllData();
    if (cached) {
      return cached;
    }
  }
  return fetchAllData(options);
}

app.whenReady().then(async () => {
  config.init(app.getPath('userData'));
  diskCache.init(app.getPath('userData'));

  console.log('cacheRoot:', diskCache.getRoot());

  const snap = getStartupSnapshot();
  console.log('\n--- getStartupSnapshot ---');
  console.log('hasCache:', snap.hasCache);
  console.log('allData sources keys:', snap.allData ? Object.keys(snap.allData.sources || {}) : null);
  const idx = snap.allData?.sources?.indices;
  console.log('indices stats:', idx?.indexStats);
  console.log('indices count:', idx?.regions?.reduce((n, r) => n + (r.indices?.length || 0), 0));

  console.log('\n--- fetchIndicesQuick ---');
  try {
    const q = await fetchIndicesQuick();
    console.log('error?', q.error);
    console.log('regions:', q.regions?.map((r) => `${r.name}:${r.indices?.length}`).join(', '));
  } catch (e) {
    console.error('THROW', e);
  }

  console.log('\n--- fetchAll fast ---');
  try {
    const data = await invokeFetchAll({ force: false, fast: true });
    console.log('error?', data.error);
    console.log('fromCache?', data.fromCache);
    console.log('partial?', data.partial);
    if (data.sources?.indices) {
      const s = data.sources.indices.indexStats;
      console.log('index stats:', s);
    }
  } catch (e) {
    console.error('THROW', e.message, e.stack);
  }

  app.quit();
});
