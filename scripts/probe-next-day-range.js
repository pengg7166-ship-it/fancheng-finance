/**
 * OOS MAE for next-day HIGH / LOW / spread point predictions
 * 用法: FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-next-day-range.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { predictNextDayRange } = require('../services/next-day-range-predictor');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');

const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';
const MIN_HISTORY = 25;

const PROBE_IDS = [
  'au',
  'ag',
  'cu',
  'rb',
  'sc',
  'i',
  'al',
  'p',
  'TA',
  'MA',
];

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadTradingBars(id) {
  const klines = readCachedKlines(id);
  if (klines.length >= MIN_HISTORY) return klines;
  try {
    const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
    const fp = path.join(historyDir, 'trading', `${id}.json`);
    if (!fs.existsSync(fp)) return klines;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const series = Array.isArray(raw) ? raw : raw.series || [];
    return series.length > klines.length ? series : klines;
  } catch {
    return klines;
  }
}

function mae(errors) {
  if (!errors.length) return null;
  return +(errors.reduce((s, e) => s + Math.abs(e.actual - e.pred), 0) / errors.length).toFixed(4);
}

function coverage(errors) {
  if (!errors.length) return null;
  const hit = errors.filter((e) => e.actual >= e.predLow && e.actual <= e.predHigh).length;
  return +((hit / errors.length) * 100).toFixed(2);
}

function evaluateInstrument(id) {
  const bars = loadTradingBars(id);
  const highErr = [];
  const lowErr = [];
  const spreadErr = [];
  const rangeCover = [];

  for (let t = MIN_HISTORY; t < bars.length; t += 1) {
    const targetDate = normBarDate(bars[t]);
    if (targetDate < TEST_FROM || targetDate > TEST_TO) continue;

    const history = bars.slice(0, t);
    const asOfDate = normBarDate(bars[t - 1]);
    const pred = predictNextDayRange({ instrumentId: id, klines: history, asOfDate });
    if (pred?.predictedHigh == null || pred.predictedLow == null) continue;

    const actualHigh = Number(bars[t].high ?? bars[t].close);
    const actualLow = Number(bars[t].low ?? bars[t].close);
    if (!actualHigh || !actualLow) continue;

    highErr.push({ actual: actualHigh, pred: pred.predictedHigh });
    lowErr.push({ actual: actualLow, pred: pred.predictedLow });
    spreadErr.push({
      actual: actualHigh - actualLow,
      pred: pred.rangeSpread ?? pred.predictedHigh - pred.predictedLow,
    });
    rangeCover.push({
      actual: actualHigh,
      predLow: pred.predictedLow,
      predHigh: pred.predictedHigh,
    });
  }

  return {
    id,
    n: highErr.length,
    highMae: mae(highErr),
    lowMae: mae(lowErr),
    spreadMae: mae(spreadErr),
    rangeCoveragePct: coverage(rangeCover),
  };
}

function pickProbeInstruments() {
  const want = new Set(['au', 'ag', 'cu', 'rb', 'sc', 'i', 'al', 'p', 'TA', 'MA']);
  const eligible = INSTRUMENT_REGISTRY.filter((s) => loadTradingBars(s.id).length >= MIN_HISTORY + 5);
  const picked = [];
  for (const id of want) {
    const spec = eligible.find((s) => String(s.id).toLowerCase() === id.toLowerCase());
    if (spec) picked.push(spec.id);
  }
  for (const spec of eligible.sort((a, b) => a.priority - b.priority)) {
    if (picked.length >= 12) break;
    if (!picked.some((p) => String(p).toLowerCase() === String(spec.id).toLowerCase())) {
      picked.push(spec.id);
    }
  }
  return picked;
}

async function main() {
  diskCache.init(getDataDir());
  const ids = pickProbeInstruments();
  const byInstrument = {};
  for (const id of ids) {
    byInstrument[id] = evaluateInstrument(id);
    console.log(
      `${id}: n=${byInstrument[id].n} highMAE=${byInstrument[id].highMae} lowMAE=${byInstrument[id].lowMae} spreadMAE=${byInstrument[id].spreadMae} cover=${byInstrument[id].rangeCoveragePct}%`,
    );
  }

  const focus = ['au', 'ag', 'cu'].map((id) => byInstrument[id]).filter(Boolean);
  const payload = {
    generatedAt: new Date().toISOString(),
    window: `${TEST_FROM}..${TEST_TO}`,
    instruments: ids,
    byInstrument,
    summary: {
      au: byInstrument.au || null,
      ag: byInstrument.ag || null,
      cu: byInstrument.cu || null,
      avgHighMae:
        focus.length && focus.every((f) => f.highMae != null)
          ? +(focus.reduce((s, f) => s + f.highMae, 0) / focus.length).toFixed(4)
          : null,
      avgLowMae:
        focus.length && focus.every((f) => f.lowMae != null)
          ? +(focus.reduce((s, f) => s + f.lowMae, 0) / focus.length).toFixed(4)
          : null,
      avgSpreadMae:
        focus.length && focus.every((f) => f.spreadMae != null)
          ? +(focus.reduce((s, f) => s + f.spreadMae, 0) / focus.length).toFixed(4)
          : null,
    },
  };

  const outJson = path.join(__dirname, '..', '_probe-next-day-range-out.json');
  const outTxt = path.join(__dirname, '..', '_probe-next-day-range.txt');
  const lines = [
    '=== Next-Day Range Point Predictor Probe ===',
    `Window: ${TEST_FROM}..${TEST_TO}`,
    '',
    '--- Focus (AU / AG / CU) ---',
    ...['au', 'ag', 'cu'].map((id) => {
      const r = byInstrument[id];
      if (!r) return `${id}: no data`;
      return `${id}: n=${r.n} · highMAE=${r.highMae} · lowMAE=${r.lowMae} · spreadMAE=${r.spreadMae} · rangeCover=${r.rangeCoveragePct}%`;
    }),
    '',
    '--- All probed ---',
    ...ids.map((id) => {
      const r = byInstrument[id];
      return `${id}: n=${r.n} high=${r.highMae} low=${r.lowMae} spread=${r.spreadMae} cover=${r.rangeCoveragePct}%`;
    }),
  ];

  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));
  fs.writeFileSync(outTxt, lines.join('\n'));
  console.log('\n' + lines.join('\n'));
  console.log(`\nWrote ${outJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
