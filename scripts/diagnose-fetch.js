/**
 * Run in Electron main process to diagnose fetch-all.
 * Usage: npx electron scripts/diagnose-fetch.js
 */
const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const config = require('../services/config');
  const diskCache = require('../services/disk-cache');
  const { fetchAllData, getCachedAllData } = require('../services/data-fetcher');
  const { fetchGlobalIndices } = require('../services/indices-fetcher');

  config.init(app.getPath('userData'));
  diskCache.init(app.getPath('userData'));
  console.log('cacheRoot:', diskCache.getRoot());

  console.log('\n--- fetchGlobalIndices ---');
  const t0 = Date.now();
  try {
    const idx = await fetchGlobalIndices();
    console.log('ok in', Date.now() - t0, 'ms', 'success', idx.success, '/', idx.total);
    console.log('regions', idx.regions.map((r) => `${r.name}:${r.indices.length}`).join(', '));
  } catch (e) {
    console.error('FAIL', e.message);
  }

  console.log('\n--- fetchAllData fast ---');
  const t1 = Date.now();
  try {
    const data = await fetchAllData({ force: true, fast: true });
    const s = data.sources?.indices?.indexStats;
    console.log('ok in', Date.now() - t1, 'ms', 'partial', data.partial, 'stats', s);
    console.log('errors', data.errors);
  } catch (e) {
    console.error('FAIL', e.message);
  }

  app.quit();
});
