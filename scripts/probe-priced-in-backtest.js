/** v1.32.0 贵金属 + 全量 longrun 快速探针（无网格） */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const philosophy = require('../services/commodity-outlook-philosophy');

const BASELINE = { overall: 0.565, precious: 0.545 };
const FROM = '2019-01-01';

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

async function runSector(sector) {
  const weights = calibration.getCompositeWeights();
  const specs = INSTRUMENT_REGISTRY.filter(
    (s) => s.sector === sector && readCachedKlines(s.id).length >= 60
  );
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
      total += 1;
      if (row.hitDirection) hits += 1;
    }
  }
  return { sector, hits, total, rate: total ? hits / total : null };
}

async function runOverall() {
  const weights = calibration.getCompositeWeights();
  let hits = 0;
  let total = 0;
  for (const spec of INSTRUMENT_REGISTRY) {
    const bars = readCachedKlines(spec.id);
    if (bars.length < 60) continue;
    let prevFinance = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 1) {
      if (normBarDate(bars[t]) < FROM) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance);
      if (!row) continue;
      prevFinance = row.financeRegimeNext || prevFinance;
      if (!row.predictedDir || row.predictedDir === 'neutral' || !row.actualDir) continue;
      total += 1;
      if (row.hitDirection) hits += 1;
    }
  }
  return { hits, total, rate: total ? hits / total : null };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged();
  console.log(`philosophy ${philosophy.PHILOSOPHY_VERSION} · baseline precious ${(BASELINE.precious * 100).toFixed(1)}% overall ${(BASELINE.overall * 100).toFixed(1)}%`);
  const precious = await runSector('precious');
  const overall = await runOverall();
  console.log(JSON.stringify({ precious, overall, delta: {
    precious: precious.rate != null ? +(precious.rate - BASELINE.precious).toFixed(4) : null,
    overall: overall.rate != null ? +(overall.rate - BASELINE.overall).toFixed(4) : null,
  } }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
