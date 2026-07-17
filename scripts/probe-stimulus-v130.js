/** v1.30 刺激衰减 — 2025+ 子集 walk-forward 快速探针 */
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

const PROBE_IDS = ['c', 'm', 'p', 'WH', 'cu', 'sc', 'FG', 'au'];
const BASELINE_OVERALL = 0.57;
const PROBE_FROM = '2024-01-01';

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function testPhilosophyUnit() {
  console.log('[unit] eventStimulusDecay:', {
    first: philosophy.eventStimulusDecay('macro_fomc_cut', 0),
    second: philosophy.eventStimulusDecay('macro_fomc_cut', 1),
    third: philosophy.eventStimulusDecay('macro_fomc_cut', 2),
  });
  const agriPath = philosophy.classifyEventPath(
    { title: '华北干旱影响玉米单产', eventType: 'agri_drought' },
    'agriculture'
  );
  const geoPath = philosophy.classifyEventPath(
    { title: '霍尔木兹海峡风险升温', eventType: 'geo_hormuz' },
    'energy'
  );
  console.log('[unit] classifyEventPath agri:', agriPath, 'geo:', geoPath);
}

async function main() {
  const dataDir = getDataDir();
  diskCache.init(dataDir || getUserDataDir() || path.join(process.cwd(), 'data'));
  console.log(`[v1.30 probe] cacheRoot: ${diskCache.getRoot()}`);
  await historicalContext.ensureFredDailyCache();
  testPhilosophyUnit();
  console.log(`[v1.30 probe] news-tagged rows: ${newsTagged.getRowCount()}`);

  const weights = calibration.getCompositeWeights();
  const specs = INSTRUMENT_REGISTRY.filter((s) => PROBE_IDS.includes(s.id));

  let hits = 0;
  let total = 0;
  let agriHits = 0;
  let agriTotal = 0;
  let era2025Hits = 0;
  let era2025Total = 0;

  for (const spec of specs) {
    const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b) >= '2018-10-01');
    if (bars.length < 60) {
      console.log(`  skip ${spec.id}: insufficient bars (${bars.length})`);
      continue;
    }
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
      if (spec.sector === 'agriculture') {
        agriTotal += 1;
        if (row.hitDirection) agriHits += 1;
      }
      if (barDate >= '2025-01-01') {
        era2025Total += 1;
        if (row.hitDirection) era2025Hits += 1;
      }
    }
    console.log(`  ${spec.id}: ${iTotal ? Math.round((iHits / iTotal) * 100) : '—'}% (${iHits}/${iTotal})`);
  }

  const overall = total > 0 ? hits / total : null;
  const agri = agriTotal > 0 ? agriHits / agriTotal : null;
  const era2025 = era2025Total > 0 ? era2025Hits / era2025Total : null;

  console.log('\n=== v1.30 probe (2024+ bars) ===');
  console.log(`subset overall: ${overall != null ? Math.round(overall * 100) : '—'}% (${hits}/${total})`);
  console.log(`agriculture: ${agri != null ? Math.round(agri * 100) : '—'}% (${agriHits}/${agriTotal})`);
  console.log(`2025-2026 epoch: ${era2025 != null ? Math.round(era2025 * 100) : '—'}% (${era2025Hits}/${era2025Total})`);
  console.log(`baseline v1.29 full longrun: ${Math.round(BASELINE_OVERALL * 100)}%`);
  if (overall != null) {
    const delta = Math.round((overall - BASELINE_OVERALL) * 100);
    console.log(`note: 2024+ 子集 vs 全量57%基线 ${delta >= 0 ? '+' : ''}${delta}pp（口径不同，全量需 tune-sector-weights-longrun.js）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
