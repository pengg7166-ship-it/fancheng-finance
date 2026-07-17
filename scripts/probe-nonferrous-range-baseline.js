/**
 * 有色金属 baseline OOS range coverage 探针（校准前/后对比）
 * FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-nonferrous-range-baseline.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const { predictNextDayHighLowFromBars } = require('../services/intraday-range-predictor');
const cnSession = require('../services/cn-futures-session-calendar');
const crossMarket = require('../services/cross-market-precious-inference');
const nonferrousCal = require('../services/nonferrous-range-calibration');

const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';

const NONFERROUS_IDS = [...nonferrousCal.CALIBRATED_IDS];
const PENDING_IDS = ['si', 'lc', 'ps', 'ss'];
const PRECIOUS_IDS = ['au', 'ag'];

function loadBars(id) {
  const fp = path.join(getDataDir() || 'E:\\FanchengFinance\\data', 'history', 'trading', `${id}.json`);
  if (!fs.existsSync(fp)) return [];
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return (Array.isArray(raw) ? raw : raw.series || [])
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function mae(arr) {
  return arr.length ? +(arr.reduce((s, e) => s + Math.abs(e.actual - e.pred), 0) / arr.length).toFixed(4) : null;
}

function withinBand(actualHigh, actualLow, predLow, predHigh) {
  return actualHigh <= predHigh && actualLow >= predLow;
}

function probeInstrument(id) {
  const bars = loadBars(id);
  if (bars.length < 30) return { id, error: 'insufficient_bars', n: bars.length };

  const highErrs = [];
  const lowErrs = [];
  const rangeErrs = [];
  let within = 0;
  let scored = 0;

  for (let i = 20; i < bars.length - 1; i += 1) {
    const asOf = cnSession.normBarDate(bars[i]);
    if (asOf < TEST_FROM || asOf > TEST_TO) continue;
    const pair = cnSession.getSessionPair(bars, i);
    if (!pair) continue;

    let crossCtx = null;
    if (id === 'au' || id === 'ag') {
      try {
        crossCtx = crossMarket.inferPointChangeFromClose(asOf, id);
      } catch {
        crossCtx = null;
      }
    }

    const pred = predictNextDayHighLowFromBars({
      instrumentId: id,
      klines: bars.slice(0, i + 1),
      asOfDate: asOf,
      crossMarketCtx: crossCtx,
    });
    if (!pred || pred.highDelta == null || pred.lowDelta == null) continue;

    highErrs.push({ actual: pair.target.highDelta, pred: pred.highDelta });
    lowErrs.push({ actual: pair.target.lowDelta, pred: pred.lowDelta });
    rangeErrs.push({ actual: pair.target.range, pred: pred.rangeDelta });
    if (withinBand(pair.target.high, pair.target.low, pred.predictedLow, pred.predictedHigh)) within += 1;
    scored += 1;
  }

  return {
    id,
    calibrated: nonferrousCal.isCalibrated(id) || id === 'au' || id === 'ag',
    scored,
    highMae: mae(highErrs),
    lowMae: mae(lowErrs),
    rangeMae: mae(rangeErrs),
    rangeCoveragePct: scored ? +((within / scored) * 100).toFixed(2) : null,
    method: 'predictNextDayHighLowFromBars+cn-session',
  };
}

function main() {
  const ids = [...PRECIOUS_IDS, ...NONFERROUS_IDS, ...PENDING_IDS];
  const results = ids.map((id) => probeInstrument(id));

  const payload = {
    version: 'probe-nonferrous-range-v1',
    testFrom: TEST_FROM,
    testTo: TEST_TO,
    instruments: results,
    summary: {
      nonferrous: results.filter((r) => NONFERROUS_IDS.includes(r.id)),
      precious: results.filter((r) => PRECIOUS_IDS.includes(r.id)),
    },
  };

  const outJson = path.join(__dirname, '..', '_probe-nonferrous-range-out.json');
  const outTxt = path.join(__dirname, '..', '_probe-nonferrous-range-out.txt');
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const lines = [
    '=== Nonferrous Range Calibration Probe ===',
    `Test: ${TEST_FROM} → ${TEST_TO}`,
    '',
    'Instrument | scored | high MAE | low MAE | range MAE | coverage%',
    ...results.map(
      (r) =>
        `${r.id} | ${r.scored ?? '—'} | ${r.highMae ?? '—'} | ${r.lowMae ?? '—'} | ${r.rangeMae ?? '—'} | ${r.rangeCoveragePct ?? '—'}%`,
    ),
  ];
  fs.writeFileSync(outTxt, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log('\nWrote', outJson);
}

main();
