/** 沪金 AU 单品种快速探针 — step=3 采样 */
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

const FROM = '2019-01-01';
const STEP = 3;
const INST = 'au';

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

async function runAu() {
  const spec = INSTRUMENT_REGISTRY.find((s) => s.id === INST);
  if (!spec) throw new Error(`instrument ${INST} not in registry`);
  const weights = calibration.getCompositeWeights();
  const bars = readCachedKlines(INST).filter((b) => normBarDate(b) >= '2018-10-01');
  let hits = 0;
  let total = 0;
  let prev = 'neutral';
  for (let t = 60; t < bars.length - 1; t += STEP) {
    if (normBarDate(bars[t]) < FROM) continue;
    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev);
    if (!row) continue;
    prev = row.financeRegimeNext || prev;
    if (!row.predictedDir || row.predictedDir === 'neutral' || !row.actualDir) continue;
    total += 1;
    if (row.hitDirection) hits += 1;
  }
  return {
    instrument: INST,
    rate: total ? +(hits / total).toFixed(4) : 0,
    ratePct: total ? +((hits / total) * 100).toFixed(1) : 0,
    hits,
    total,
  };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });
  const result = await runAu();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runAu };
