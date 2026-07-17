/**
 * 贵金属 4 品种 T+3 walk-forward 探针（2019→今，非 74 品种 longrun）
 * 用法: node scripts/probe-precious-longrun-t3.js [--use-ensemble-stub] [--use-onnx]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const { hitDirection } = require('../services/outlook-labels');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');

const PRECIOUS_IDS = ['au', 'ag', 'pt', 'pd'];
const FROM = '2019-01-01';

function parseArgs() {
  const args = process.argv.slice(2);
  let useEnsembleStub = false;
  let useOnnx = false;
  let step = 1;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--use-ensemble-stub') useEnsembleStub = true;
    else if (args[i] === '--use-onnx') useOnnx = true;
    else if (args[i] === '--step' && args[i + 1]) {
      step = Math.max(1, Number(args[i + 1]) || 1);
      i += 1;
    }
  }
  return { useEnsembleStub, useOnnx, step };
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function scoreT3(rows, predictFn) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred || pred === 'neutral' || !row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDirT3)) hits += 1;
  }
  return { hits, scored, hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null };
}

async function main() {
  const opts = parseArgs();
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const weights = calibration.getCompositeWeights();
  const perInstrument = {};
  const allRows = [];

  for (const id of PRECIOUS_IDS) {
    const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
    if (!spec) continue;
    const bars = readCachedKlines(id).filter((b) => normBarDate(b) >= '2018-10-01');
    const rows = [];
    let prev = 'neutral';
    for (let t = 60; t < bars.length - 3; t += opts.step) {
      if (normBarDate(bars[t]) < FROM) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {
        useEnsembleStub: opts.useEnsembleStub,
        useOnnxEnsemble: opts.useOnnx,
      });
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      rows.push({ ...row, instrumentId: id });
    }
    perInstrument[id] = rows;
    allRows.push(...rows);
  }

  const mode = opts.useOnnx
    ? 'logistic-json'
    : opts.useEnsembleStub
      ? 'ensemble-stub'
      : 'full-engine';

  const predictFn = (row) => row.predictedDir;

  const overall = scoreT3(allRows, predictFn);
  const auAgRows = allRows.filter((r) => r.instrumentId === 'au' || r.instrumentId === 'ag');
  const auAg = scoreT3(auAgRows, predictFn);
  const perId = {};
  for (const id of PRECIOUS_IDS) {
    perId[id] = scoreT3(perInstrument[id] || [], predictFn);
  }

  const outDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'outlook-backtest');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'precious-longrun-t3-probe.json');

  const payload = {
    version: 'v1.34.1-precious-t3-probe',
    mode,
    window: `${FROM}..today`,
    step: opts.step,
    instruments: PRECIOUS_IDS,
    overall,
    auAg,
    perInstrument: perId,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
