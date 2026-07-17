/** v1.30.1 攻城台阶/回踩突破 — agri/metals/energy 子集 walk-forward 探针 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getUserDataDir, getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const calibration = require('../services/commodity-outlook-calibration');
const philosophy = require('../services/commodity-outlook-philosophy');

const PROBE_SECTORS = new Set(['agriculture', 'metals', 'energy']);
const BASELINE_OVERALL = 0.57;
const PROBE_FROM = '2024-01-01';

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function testTrendStructureUnit() {
  const bars = readCachedKlines('cu').filter((b) => normBarDate(b) >= '2023-01-01');
  if (bars.length < 60) {
    console.log('[unit] skip trendStructure: insufficient cu bars', bars.length);
    return;
  }
  const ts = philosophy.trendStructureAnalyzer(bars.slice(-120), 'medium');
  console.log('[unit] trendStructure cu:', {
    stepBias: ts.stepBias,
    trendPhase: ts.trendPhase,
    stepCount: ts.stepCount,
    summary: ts.summary,
  });
  const filter = philosophy.applyTrendStructureDirectionFilter({
    fundScore: 0.35,
    trendStructure: ts,
    directionTier: { direction: 'strong_bullish', label: '强多', arrow: '↑↑' },
    compositeScore: 0.42,
  });
  console.log('[unit] filter opposed→', filter.directionTier.direction, filter.filters);
}

async function main() {
  const dataDir = getDataDir();
  diskCache.init(dataDir || getUserDataDir() || path.join(process.cwd(), 'data'));
  console.log(`[v1.30.1 trend probe] cacheRoot: ${diskCache.getRoot()}`);
  await historicalContext.ensureFredDailyCache();
  testTrendStructureUnit();

  const weights = calibration.getCompositeWeights();
  const specs = INSTRUMENT_REGISTRY.filter((s) => PROBE_SECTORS.has(s.sector));

  let hits = 0;
  let total = 0;
  const bySector = {};

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
      if (!bySector[spec.sector]) bySector[spec.sector] = { hits: 0, total: 0 };
      bySector[spec.sector].total += 1;
      if (row.hitDirection) bySector[spec.sector].hits += 1;
    }
    console.log(`  ${spec.id}: ${iTotal ? Math.round((iHits / iTotal) * 100) : '—'}% (${iHits}/${iTotal})`);
  }

  const overall = total > 0 ? hits / total : null;

  console.log('\n=== v1.30.1 trend-structure probe (agri+metals+energy, 2024+) ===');
  console.log(`subset overall: ${overall != null ? Math.round(overall * 100) : '—'}% (${hits}/${total})`);
  for (const [sec, s] of Object.entries(bySector)) {
    const rate = s.total > 0 ? s.hits / s.total : null;
    console.log(`  ${sec}: ${rate != null ? Math.round(rate * 100) : '—'}% (${s.hits}/${s.total})`);
  }
  console.log(`baseline v1.29 full longrun: ${Math.round(BASELINE_OVERALL * 100)}%`);
  if (overall != null) {
    const delta = Math.round((overall - BASELINE_OVERALL) * 100);
    console.log(`delta vs 57% baseline: ${delta >= 0 ? '+' : ''}${delta}pp（子集口径，非全品种）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
