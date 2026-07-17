/**
 * 贵金属 AU/AG 区间宽度网格校准 — 目标 OOS range coverage ≥ 75%
 * 训练 2019-2022 · 评估 2023-2026
 *
 * FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/calibrate-precious-range.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const cnSession = require('../services/cn-futures-session-calendar');
const crossMarket = require('../services/cross-market-precious-inference');
const crossVol = require('../services/cross-vol-magnitude');
const preciousCal = require('../services/precious-range-calibration');
const { RECENT_FROM, RECENT_TO, scoreCalibration, maeHighLow } = require('./lib/range-cal-score');

const TRAIN_FROM = '2019-01-01';
const TRAIN_TO = '2022-12-31';
const OOS_FROM = '2023-01-01';
const OOS_TO = '2026-12-31';
const TARGET_COVERAGE = 0.75;

function loadBars(id) {
  const base = getDataDir() || 'E:\\FanchengFinance\\data';
  for (const key of [id, id.toUpperCase()]) {
    const fp = path.join(base, 'history', 'trading', `${key}.json`);
    if (!fs.existsSync(fp)) continue;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return (Array.isArray(raw) ? raw : raw.series || [])
      .filter((b) => b.date && b.close > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  return [];
}

function rangeCovered(actualHigh, actualLow, predHigh, predLow) {
  return actualHigh <= predHigh && actualLow >= predLow;
}

function precomputeSamples(id, bars) {
  const samples = [];
  for (let i = 20; i < bars.length - 1; i += 1) {
    const asOf = cnSession.normBarDate(bars[i]);
    const pair = cnSession.getSessionPair(bars, i);
    if (!pair) continue;

    let crossCtx = null;
    try {
      crossCtx = crossMarket.inferPointChangeFromClose(asOf, id);
    } catch {
      crossCtx = { gated: true };
    }

    const mag = crossVol.predictMagnitude({
      instrumentId: id,
      close: pair.baseline.close,
      asOfDate: asOf,
      crossMarketCtx: crossCtx,
      priceHistory: bars.slice(0, i + 1),
    });

    const extents = cnSession.collectSessionExtents(bars, i, 15);
    samples.push({
      asOf,
      baselineClose: pair.baseline.close,
      actualHigh: pair.target.high,
      actualLow: pair.target.low,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta: mag.pointDelta,
      sigma: mag.sigma,
    });
  }
  return samples;
}

function evalCoverage(samples, cal, from, to) {
  let scored = 0;
  let covered = 0;
  for (const s of samples) {
    if (s.asOf < from || s.asOf > to) continue;
    const band = preciousCal.computePreciousRangeBand({
      instrumentId: cal._id,
      baselineClose: s.baselineClose,
      upExtents: s.upExtents,
      downExtents: s.downExtents,
      pointDelta: s.pointDelta,
      sigma: s.sigma,
      cal,
    });
    if (!band) continue;
    scored += 1;
    if (rangeCovered(s.actualHigh, s.actualLow, band.predictedHigh, band.predictedLow)) covered += 1;
  }
  return { scored, covered, pct: scored ? covered / scored : 0 };
}

function gridSearch(id, samples) {
  let best = null;
  const upRange = [];
  const downRange = [];
  const lowBiasRange = [0, 0.005, 0.01, 0.015, 0.02];
  for (let u = 1.0; u <= 2.5; u += 0.05) upRange.push(+u.toFixed(2));
  for (let d = 1.0; d <= 2.5; d += 0.05) downRange.push(+d.toFixed(2));

  for (const upMult of upRange) {
    for (const downMult of downRange) {
      for (const lowBiasPct of lowBiasRange) {
        const cal = {
          ...preciousCal.DEFAULT_PARAMS[id],
          upMult,
          downMult,
          lowBiasPct,
          _id: id,
        };
        const train = evalCoverage(samples, cal, TRAIN_FROM, TRAIN_TO);
        const oos = evalCoverage(samples, cal, OOS_FROM, OOS_TO);
        const recent = evalCoverage(samples, cal, RECENT_FROM, RECENT_TO);
        const mae = maeHighLow(
          samples,
          (s) =>
            preciousCal.computePreciousRangeBand({
              instrumentId: cal._id,
              baselineClose: s.baselineClose,
              upExtents: s.upExtents,
              downExtents: s.downExtents,
              pointDelta: s.pointDelta,
              sigma: s.sigma,
              cal,
            }),
          RECENT_FROM,
          RECENT_TO,
        );
        const score = scoreCalibration({ oos, recent, cal, mae, targetCoverage: TARGET_COVERAGE });
        if (score == null) continue;
        if (!best || score > best.score) {
          best = { cal, train, oos, recent, score };
        }
      }
    }
  }

  if (!best) {
    let fallback = null;
    for (const upMult of upRange) {
      for (const downMult of downRange) {
        for (const lowBiasPct of lowBiasRange) {
          const cal = { ...preciousCal.DEFAULT_PARAMS[id], upMult, downMult, lowBiasPct, _id: id };
          const oos = evalCoverage(samples, cal, OOS_FROM, OOS_TO);
          const recent = evalCoverage(samples, cal, RECENT_FROM, RECENT_TO);
          const score = (recent?.pct || 0) * 2 + oos.pct;
          if (!fallback || score > fallback.score) fallback = { cal, oos, recent, score };
        }
      }
    }
    return { ...fallback, hitTarget: false };
  }
  return { ...best, hitTarget: true };
}

function main() {
  const results = {};
  for (const id of ['au', 'ag']) {
    const bars = loadBars(id);
    console.log(`\n=== Calibrating ${id.toUpperCase()} (${bars.length} bars) ===`);
    console.log('Precomputing samples...');
    const samples = precomputeSamples(id, bars);
    console.log(`Samples: ${samples.length}`);
    const search = gridSearch(id, samples);
    const { _id, ...calParams } = search.cal;
    results[id] = { ...search, cal: calParams };
    console.log(
      `${id}: upMult=${calParams.upMult} downMult=${calParams.downMult} lowBiasPct=${calParams.lowBiasPct || 0} ` +
        `OOS=${(search.oos.pct * 100).toFixed(2)}% recent=${search.recent ? (search.recent.pct * 100).toFixed(2) : '—'}% ` +
        `target=${search.hitTarget !== false ? 'HIT' : 'MISS'}`,
    );
  }

  const payload = {
    version: preciousCal.CAL_VERSION,
    generatedAt: new Date().toISOString(),
    trainFrom: TRAIN_FROM,
    trainTo: TRAIN_TO,
    oosFrom: OOS_FROM,
    oosTo: OOS_TO,
    targetCoveragePct: TARGET_COVERAGE * 100,
    au: results.au.cal,
    ag: results.ag.cal,
    metrics: {
      au: {
        oosCoveragePct: +(results.au.oos.pct * 100).toFixed(2),
        oosScored: results.au.oos.scored,
        trainCoveragePct: results.au.train ? +(results.au.train.pct * 100).toFixed(2) : null,
        hitTarget: results.au.hitTarget !== false,
      },
      ag: {
        oosCoveragePct: +(results.ag.oos.pct * 100).toFixed(2),
        oosScored: results.ag.oos.scored,
        trainCoveragePct: results.ag.train ? +(results.ag.train.pct * 100).toFixed(2) : null,
        hitTarget: results.ag.hitTarget !== false,
      },
    },
  };

  const fp = preciousCal.saveCalParams(payload);
  console.log('\nSaved', fp);
  console.log(JSON.stringify(payload.metrics, null, 2));
}

main();
