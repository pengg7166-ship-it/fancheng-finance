/**

 * Intraday range predictor OOS probe — CN session-aligned high / low / range MAE

 * 用法: FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-intraday-range-predictor.js

 *

 * 标签：close[t]（T 日 15:00 昨收）→ high/low[t+1]（T 日 21:00 夜盘起至 T+1 日 15:00）

 */

const fs = require('fs');

const path = require('path');



process.chdir(path.join(__dirname, '..'));

process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';



const { getDataDir } = require('../services/data-paths');

const { readCachedKlines } = require('../services/commodity-technical-analyzer');

const { predictNextDayHighLowFromBars } = require('../services/intraday-range-predictor');

const cnSession = require('../services/cn-futures-session-calendar');

const crossMarket = require('../services/cross-market-precious-inference');



const TEST_FROM = '2023-01-01';

const TEST_TO = '2026-12-31';



const SAMPLE_IDS = [

  { id: 'au', sector: 'precious' },

  { id: 'ag', sector: 'precious' },

  { id: 'cu', sector: 'metals' },

  { id: 'sc', sector: 'energy' },

  { id: 'FG', sector: 'chemicals' },

  { id: 'rb', sector: 'metals' },

  { id: 'i', sector: 'metals' },

  { id: 'm', sector: 'agri' },

];



function loadBars(id) {

  const klines = readCachedKlines(id);

  if (klines.length >= 60) return klines;

  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');

  const fp = path.join(historyDir, 'trading', `${id}.json`);

  if (!fs.existsSync(fp)) return klines;

  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));

  return Array.isArray(raw) ? raw : raw.series || [];

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

  let highHit = 0;

  let lowHit = 0;

  let scored = 0;



  for (let i = 20; i < bars.length - 1; i += 1) {

    const asOf = cnSession.normBarDate(bars[i]);

    if (asOf < TEST_FROM || asOf > TEST_TO) continue;



    const pair = cnSession.getSessionPair(bars, i);

    if (!pair) continue;



    const actualHighDelta = pair.target.highDelta;

    const actualLowDelta = pair.target.lowDelta;

    const actualRange = pair.target.range;



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



    highErrs.push({ actual: actualHighDelta, pred: pred.highDelta });

    lowErrs.push({ actual: actualLowDelta, pred: pred.lowDelta });

    rangeErrs.push({ actual: actualRange, pred: pred.rangeDelta });

    if (withinBand(pair.target.high, pair.target.low, pred.predictedLow, pred.predictedHigh)) within += 1;

    if (pair.target.high <= pred.predictedHigh) highHit += 1;

    if (pair.target.low >= pred.predictedLow) lowHit += 1;

    scored += 1;

  }



  return {

    id,

    scored,

    highMae: mae(highErrs),

    lowMae: mae(lowErrs),

    rangeMae: mae(rangeErrs),

    rangeCoveragePct: scored ? +((within / scored) * 100).toFixed(2) : null,

    highBoundHitPct: scored ? +((highHit / scored) * 100).toFixed(2) : null,

    lowBoundHitPct: scored ? +((lowHit / scored) * 100).toFixed(2) : null,

    highWithinBandPct: scored ? +((within / scored) * 100).toFixed(2) : null,

    method: 'predictNextDayHighLowFromBars+cn-session',

  };

}



function loadPriorBaseline() {

  const fp = path.join(__dirname, '..', '_probe-intraday-range-predictor-out.json');

  if (!fs.existsSync(fp)) return null;

  try {

    return JSON.parse(fs.readFileSync(fp, 'utf8'));

  } catch {

    return null;

  }

}



function main() {

  const prior = loadPriorBaseline();

  const results = SAMPLE_IDS.map(({ id, sector }) => ({ sector, ...probeInstrument(id) }));

  const bySector = {};

  for (const r of results) {

    if (!bySector[r.sector]) bySector[r.sector] = [];

    bySector[r.sector].push(r);

  }



  const payload = {

    version: 'probe-intraday-range-v2-cn-session',

    testFrom: TEST_FROM,

    testTo: TEST_TO,

    sessionCalendar: cnSession.SESSION_META,

    labelConvention: 'close[t] @15:00 → high/low[t+1] night21:00+day15:00',

    instruments: results,

    bySector,

    priorBaseline: prior

      ? {

          version: prior.version,

          instruments: prior.instruments?.map((p) => ({

            id: p.id,

            scored: p.scored,

            highMae: p.highMae,

            lowMae: p.lowMae,

            rangeMae: p.rangeMae,

            highWithinBandPct: p.highWithinBandPct,

          })),

        }

      : null,

    summary: {

      note: 'MAE on delta-from-15:00-close for high/low; range MAE on session (high-low) points',

    },

  };



  const outJson = path.join(__dirname, '..', '_probe-intraday-range-predictor-out.json');

  const outTxt = path.join(__dirname, '..', '_probe-intraday-range-predictor.txt');

  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));



  const lines = [

    '=== Intraday Range Predictor OOS Probe (CN Session) ===',

    `Test: ${TEST_FROM} → ${TEST_TO}`,

    `Convention: ${payload.labelConvention}`,

    '',

    'Instrument | scored | high MAE | low MAE | range MAE | coverage% | hi-bound% | lo-bound%',

    ...results.map(

      (r) =>

        `${r.id} | ${r.scored ?? '—'} | ${r.highMae ?? '—'} | ${r.lowMae ?? '—'} | ${r.rangeMae ?? '—'} | ${r.rangeCoveragePct ?? r.highWithinBandPct ?? '—'}% | ${r.highBoundHitPct ?? '—'}% | ${r.lowBoundHitPct ?? '—'}%`,

    ),

  ];



  if (prior?.instruments) {

    lines.push('', '--- vs prior baseline ---');

    for (const r of results) {

      const p = prior.instruments.find((x) => x.id === r.id);

      if (!p) continue;

      lines.push(

        `${r.id}: high ${p.highMae}→${r.highMae} · low ${p.lowMae}→${r.lowMae} · range ${p.rangeMae}→${r.rangeMae} · band ${p.highWithinBandPct}%→${r.highWithinBandPct}%`,

      );

    }

  }



  fs.writeFileSync(outTxt, lines.join('\n'));

  console.log(lines.join('\n'));

  console.log('\nWrote', outJson);

}



main();

