/** v1.30.2 事件 vs 叙事 — 2024+ walk-forward 探针 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getUserDataDir, getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const philosophy = require('../services/commodity-outlook-philosophy');

const PROBE_IDS = ['cu', 'au', 'ag', 'sc', 'al'];
const PROBE_FROM = '2024-01-01';
const BASELINE_CU = 0.49;

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function testUnit() {
  console.log('[unit] classifyNewsArchetype:');
  console.log('  tariff:', philosophy.classifyNewsArchetype('美国对华加征关税', '贸易战升级', 'us_china_tariff_2019'));
  console.log('  ai:', philosophy.classifyNewsArchetype('AI数据中心铜需求', '算力基建', 'ai_copper'));
  console.log('  fomc:', philosophy.classifyNewsArchetype('美联储 FOMC 维持利率', '决议日', 'fomc_20250129'));
}

async function main() {
  const dataDir = getDataDir();
  diskCache.init(dataDir || getUserDataDir() || path.join(process.cwd(), 'data'));
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged();
  testUnit();

  const weights = calibration.getCompositeWeights();
  const specs = INSTRUMENT_REGISTRY.filter((s) => PROBE_IDS.includes(s.id));
  let hits = 0;
  let total = 0;
  let shockDays = 0;
  let shockHits = 0;
  let narrativeDays = 0;
  let narrativeHits = 0;

  for (const spec of specs) {
    const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b) >= '2018-10-01');
    if (bars.length < 60) continue;
    let prevFinance = 'neutral';
    let iHits = 0;
    let iTotal = 0;

    for (let t = 60; t < bars.length - 1; t += 1) {
      const barDate = normBarDate(bars[t]);
      if (barDate < PROBE_FROM) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance);
      if (!row) continue;
      prevFinance = row.financeRegimeNext || prevFinance;
      if (!row.predictedDir || row.predictedDir === 'neutral' || !row.actualDir) continue;
      iTotal += 1;
      total += 1;
      if (row.hitDirection) {
        iHits += 1;
        hits += 1;
      }
      const arch = row.philosophyMeta?.newsArchetype;
      if (arch?.dominantArchetype === 'shock_event') {
        shockDays += 1;
        if (row.hitDirection) shockHits += 1;
      }
      if (arch?.dominantArchetype === 'narrative_theme') {
        narrativeDays += 1;
        if (row.hitDirection) narrativeHits += 1;
      }
    }
    if (iTotal) console.log(`  ${spec.id}: ${iHits}/${iTotal} = ${(iHits / iTotal * 100).toFixed(1)}%`);
  }

  const rate = total ? hits / total : 0;
  console.log(`\n[v1.30.2 probe] 2024+ overall: ${hits}/${total} = ${(rate * 100).toFixed(1)}%`);
  console.log(`  shock_event days: ${shockHits}/${shockDays} = ${shockDays ? (shockHits / shockDays * 100).toFixed(1) : '—'}%`);
  console.log(`  narrative_theme days: ${narrativeHits}/${narrativeDays} = ${narrativeDays ? (narrativeHits / narrativeDays * 100).toFixed(1) : '—'}%`);
  console.log(`  CU longrun baseline (pre-change): ~${(BASELINE_CU * 100).toFixed(0)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
