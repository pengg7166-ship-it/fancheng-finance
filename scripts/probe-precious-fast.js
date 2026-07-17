/** 贵金属 AU/AG 快速探针 — step=3 采样 */
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

const FROM = '2019-01-01';
const STEP = 3;
const V312 = {
  precious: {
    postShockPullbackMult: 0.88,
    postShockPullbackStarsMult: 0.9,
    postShockBounceMult: 0.86,
    skipPullbackDirectionDowngrade: true,
    narrativeExtendCap: 1.15,
    philosophyBlendWeight: 0.74,
    byInstrument: {
      au: { postShockPullbackMult: 0.88, narrativeExtendCap: 1.15, philosophyBlendWeight: 0.72 },
      ag: { postShockPullbackMult: 0.88, narrativeExtendCap: 1.15, philosophyBlendWeight: 0.72 },
    },
  },
};

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

async function run(label, fitOverride) {
  philosophy.setPhilosophyFitCalibration(fitOverride);
  const weights = calibration.getCompositeWeights();
  let hits = 0;
  let total = 0;
  for (const spec of INSTRUMENT_REGISTRY.filter((s) => s.sector === 'precious')) {
    const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b) >= '2018-10-01');
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
  }
  philosophy.setPhilosophyFitCalibration(null);
  return { label, rate: total ? hits / total : 0, hits, total };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged();
  const v312 = await run('v1.31.2', V312);
  const v313 = await run('v1.31.3-default', philosophy.PHILOSOPHY_FIT_SECTOR_CALIBRATION);
  console.log(JSON.stringify({ v312, v313, deltaPp: +((v313.rate - v312.rate) * 100).toFixed(2) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
