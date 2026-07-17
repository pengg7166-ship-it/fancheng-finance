/**

 * 化工系 baseline OOS range coverage 探针（校准前/后对比）

 * FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/probe-chemical-range-baseline.js

 */

const fs = require('fs');

const path = require('path');



process.chdir(path.join(__dirname, '..'));

process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';



const { getDataDir } = require('../services/data-paths');

const { predictNextDayHighLowFromBars } = require('../services/intraday-range-predictor');

const cnSession = require('../services/cn-futures-session-calendar');

const chemicalCal = require('../services/chemical-range-calibration');

const blackCal = require('../services/black-range-calibration');

const nonferrousCal = require('../services/nonferrous-range-calibration');



const TEST_FROM = '2023-01-01';

const TEST_TO = '2026-12-31';



const CHEMICAL_IDS = [...chemicalCal.CALIBRATED_IDS];

const REGRESSION_IDS = ['au', 'cu', 'rb'];



function loadBars(id) {

  const base = getDataDir() || 'E:\\FanchengFinance\\data';

  const candidates = [id, id.toUpperCase()];

  for (const key of candidates) {

    const fp = path.join(base, 'history', 'trading', `${key}.json`);

    if (fs.existsSync(fp)) {

      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));

      return (Array.isArray(raw) ? raw : raw.series || [])

        .filter((b) => b.date && b.close > 0)

        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    }

  }

  return [];

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



    const pred = predictNextDayHighLowFromBars({

      instrumentId: id,

      klines: bars.slice(0, i + 1),

      asOfDate: asOf,

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

    calibrated:

      chemicalCal.isCalibrated(id) ||

      blackCal.isCalibrated(id) ||

      nonferrousCal.isCalibrated(id) ||

      id === 'au' ||

      id === 'ag',

    scored,

    highMae: mae(highErrs),

    lowMae: mae(lowErrs),

    rangeMae: mae(rangeErrs),

    rangeCoveragePct: scored ? +((within / scored) * 100).toFixed(2) : null,

    method: predMethod(id),

  };

}



function predMethod(id) {

  if (id === 'au' || id === 'ag') return 'precious-range';

  if (nonferrousCal.isCalibrated(id)) return 'nonferrous-range-calibrated';

  if (blackCal.isCalibrated(id)) return 'black-range-calibrated';

  if (chemicalCal.isCalibrated(id)) return 'chemical-range-calibrated';

  return 'default';

}



function main() {

  const ids = [...CHEMICAL_IDS, ...REGRESSION_IDS];

  const results = ids.map((id) => probeInstrument(id));



  const payload = {

    version: 'probe-chemical-range-v1',

    testFrom: TEST_FROM,

    testTo: TEST_TO,

    instruments: results,

    summary: {

      chemical: results.filter((r) => CHEMICAL_IDS.includes(r.id)),

      regression: results.filter((r) => REGRESSION_IDS.includes(r.id)),

    },

  };



  const outJson = path.join(__dirname, '..', '_probe-chemical-range-out.json');

  const outTxt = path.join(__dirname, '..', '_probe-chemical-range-out.txt');

  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));



  const lines = [

    '=== Chemical Range Calibration Probe ===',

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


