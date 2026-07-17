/** v1.31.1 历史锲合校准 — 贵金属/黑色/有色网格 vs v1.31.0 基线 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getUserDataDir, getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const philosophy = require('../services/commodity-outlook-philosophy');

const PROBE_FROM = '2019-01-01';
const TARGET_SECTORS = new Set(['precious', 'black', 'metals']);
const BASELINE = {
  overall: 0.5644,
  precious: 0.5495,
  black: 0.5534,
  metals: 0.5464,
};
const V130_BASELINE = {
  overall: 0.57,
  precious: 0.5771,
};

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function buildGrid() {
  const preciousSoft = {
    postShockPullbackMult: 0.90,
    postShockPullbackStarsMult: 0.92,
    postShockBounceMult: 0.86,
    skipPullbackDirectionDowngrade: true,
    narrativeExtendCap: 1.2,
  };
  const blackSoft = { postShockPullbackMult: 0.86, postShockPullbackStarsMult: 0.88, postShockBounceMult: 0.82 };
  const metalsCap = { narrativeExtendCap: 1.18, postShockPullbackMult: 0.82, postShockPullbackStarsMult: 0.86 };
  return [
    { id: 'ablation-precious-only', precious: preciousSoft },
    { id: 'ablation-metals-cap-only', metals: metalsCap },
    { id: 'ablation-black-only', black: blackSoft },
    { id: 'ablation-precious-metals', precious: preciousSoft, metals: metalsCap },
    { id: 'ablation-all-three', precious: preciousSoft, black: blackSoft, metals: metalsCap },
    {
      id: 'grid-pp0.88',
      precious: { ...preciousSoft, postShockPullbackMult: 0.88, postShockPullbackStarsMult: 0.90 },
      black: blackSoft,
      metals: metalsCap,
    },
    {
      id: 'grid-pp0.92',
      precious: { ...preciousSoft, postShockPullbackMult: 0.92, postShockPullbackStarsMult: 0.94 },
      black: blackSoft,
      metals: metalsCap,
    },
  ];
}

async function runProbe(label, fitOverride, { sectorsOnly = true } = {}) {
  philosophy.setPhilosophyFitCalibration(fitOverride);
  const weights = calibration.getCompositeWeights();
  let specs = INSTRUMENT_REGISTRY.filter((s) => readCachedKlines(s.id).length >= 60);
  if (sectorsOnly) specs = specs.filter((s) => TARGET_SECTORS.has(s.sector));
  const bySector = {};
  let hits = 0;
  let total = 0;

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
    }
    if (!bySector[spec.sector]) bySector[spec.sector] = { hits: 0, total: 0 };
    bySector[spec.sector].hits += iHits;
    bySector[spec.sector].total += iTotal;
  }

  philosophy.setPhilosophyFitCalibration(null);
  const rate = total ? hits / total : 0;
  const focusHits = TARGET_SECTORS.size
    ? [...TARGET_SECTORS].reduce((s, id) => s + (bySector[id]?.hits || 0), 0)
    : 0;
  const focusTotal = [...TARGET_SECTORS].reduce((s, id) => s + (bySector[id]?.total || 0), 0);
  const focusRate = focusTotal ? focusHits / focusTotal : 0;
  const preciousRate = bySector.precious?.total ? bySector.precious.hits / bySector.precious.total : 0;

  return {
    label,
    overall: rate,
    focus: focusRate,
    precious: preciousRate,
    bySector,
    hits,
    total,
  };
}

async function main() {
  const dataDir = getDataDir();
  diskCache.init(dataDir || getUserDataDir() || path.join(process.cwd(), 'data'));
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged();

  console.log(`[calibrate] philosophy ${philosophy.PHILOSOPHY_VERSION}`);
  console.log(`[calibrate] v1.31.0 longrun baseline overall ${(BASELINE.overall * 100).toFixed(1)}% precious ${(BASELINE.precious * 100).toFixed(1)}%`);
  console.log(`[calibrate] v1.30 target overall ${(V130_BASELINE.overall * 100).toFixed(0)}% precious ${(V130_BASELINE.precious * 100).toFixed(1)}%\n`);

  const defaultResult = await runProbe('v1.31.1-default', philosophy.PHILOSOPHY_FIT_SECTOR_CALIBRATION, { sectorsOnly: false });
  const defaultFocus = await runProbe('v1.31.1-default-focus', philosophy.PHILOSOPHY_FIT_SECTOR_CALIBRATION, { sectorsOnly: true });
  console.log(
    `DEFAULT ${defaultResult.label}: overall ${(defaultResult.overall * 100).toFixed(2)}% (${defaultResult.hits}/${defaultResult.total})`
  );
  console.log(
    `  focus ${(defaultResult.focus * 100).toFixed(2)}% · precious ${(defaultResult.precious * 100).toFixed(2)}%`
  );
  for (const id of ['precious', 'black', 'metals']) {
    const s = defaultResult.bySector[id];
    if (!s?.total) continue;
    const r = s.hits / s.total;
    const delta = (r - (BASELINE[id] || 0)) * 100;
    console.log(`  ${id}: ${(r * 100).toFixed(2)}% (${s.hits}/${s.total}) ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp vs v1.31.0`);
  }

  const grid = buildGrid();
  const results = [defaultResult];
  for (const combo of grid) {
    const r = await runProbe(combo.id, combo, { sectorsOnly: true });
    results.push(r);
    process.stdout.write(
      `\r  grid ${results.length - 1}/${grid.length} best precious ${(Math.max(...results.map((x) => x.precious)) * 100).toFixed(1)}%    `
    );
  }
  console.log('');

  results.sort((a, b) => {
    const scoreA = a.overall * 100 + (a.precious >= 0.58 ? 2 : 0) + a.precious * 50;
    const scoreB = b.overall * 100 + (b.precious >= 0.58 ? 2 : 0) + b.precious * 50;
    return scoreB - scoreA;
  });

  console.log('\n=== TOP 5 combos ===');
  for (const r of results.slice(0, 5)) {
    console.log(
      `${r.label}: overall ${(r.overall * 100).toFixed(2)}% · precious ${(r.precious * 100).toFixed(2)}% · focus ${(r.focus * 100).toFixed(2)}%`
    );
  }

  const best = results[0];
  const outPath = path.join(process.cwd(), '_philosophy-calibrate-v1311.json');
  require('fs').writeFileSync(
    outPath,
    JSON.stringify({ baseline: BASELINE, v130: V130_BASELINE, default: defaultResult, top5: results.slice(0, 5), best }, null, 2)
  );
  console.log('\nWrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
