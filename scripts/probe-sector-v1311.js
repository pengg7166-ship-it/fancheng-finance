/** v1.31.1 三板块快速探针（precious/black/metals） */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const philosophy = require('../services/commodity-outlook-philosophy');

const SECTORS = ['precious', 'black', 'metals'];
const FROM = '2019-01-01';

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged();
  const weights = calibration.getCompositeWeights();
  const specs = INSTRUMENT_REGISTRY.filter(
    (s) => SECTORS.includes(s.sector) && readCachedKlines(s.id).length >= 60
  );
  const bySector = {};
  let hits = 0;
  let total = 0;

  for (const spec of specs) {
    const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b) >= '2018-10-01');
    let prevFinance = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 1) {
      if (normBarDate(bars[t]) < FROM) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance);
      if (!row) continue;
      prevFinance = row.financeRegimeNext || prevFinance;
      if (!row.predictedDir || row.predictedDir === 'neutral' || !row.actualDir) continue;
      if (!bySector[spec.sector]) bySector[spec.sector] = { hits: 0, total: 0 };
      bySector[spec.sector].total += 1;
      total += 1;
      if (row.hitDirection) {
        bySector[spec.sector].hits += 1;
        hits += 1;
      }
    }
  }

  console.log(`[v1.31.1 sector probe] philosophy ${philosophy.PHILOSOPHY_VERSION}`);
  console.log(`focus ${hits}/${total} = ${total ? ((hits / total) * 100).toFixed(2) : '—'}%`);
  for (const id of SECTORS) {
    const s = bySector[id];
    if (!s?.total) continue;
    console.log(`  ${id}: ${s.hits}/${s.total} = ${((s.hits / s.total) * 100).toFixed(2)}%`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
