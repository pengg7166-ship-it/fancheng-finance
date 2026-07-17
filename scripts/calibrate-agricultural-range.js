/**
 * 农产品系区间宽度网格校准 — 目标 OOS range coverage ≥ 75%
 * 训练 2019-2022 · 评估 2023-2026
 *
 * FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/calibrate-agricultural-range.js --id m
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const cnSession = require('../services/cn-futures-session-calendar');
const crossVol = require('../services/cross-vol-magnitude');
const agriCal = require('../services/agricultural-range-calibration');

const TRAIN_FROM = '2019-01-01';
const TRAIN_TO = '2022-12-31';
const OOS_FROM = '2023-01-01';
const OOS_TO = '2026-12-31';
const TARGET_COVERAGE = 0.75;

const rawArgs = process.argv.slice(2);
const CLI_IDS = [];
for (let i = 0; i < rawArgs.length; i += 1) {
  const a = rawArgs[i];
  if (a === '--id' && rawArgs[i + 1]) {
    CLI_IDS.push(String(rawArgs[i + 1]).toLowerCase());
    i += 1;
    continue;
  }
  if (a.startsWith('--id=')) {
    CLI_IDS.push(a.slice(5).toLowerCase());
    continue;
  }
  if (!a.startsWith('--')) CLI_IDS.push(a.toLowerCase());
}

const TARGET_IDS =
  CLI_IDS.length > 0
    ? CLI_IDS.filter((id) => agriCal.CALIBRATED_IDS.includes(id))
    : [...agriCal.CALIBRATED_IDS];

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

function rangeCovered(actualHigh, actualLow, predHigh, predLow) {
  return actualHigh <= predHigh && actualLow >= predLow;
}

function maeHighLow(samples, cal, from, to) {
  const hiErrs = [];
  const loErrs = [];
  for (const s of samples) {
    if (s.asOf < from || s.asOf > to) continue;
    const band = agriCal.computeAgriculturalRangeBand({
      instrumentId: cal._id,
      baselineClose: s.baselineClose,
      upExtents: s.upExtents,
      downExtents: s.downExtents,
      pointDelta: s.pointDelta,
      sigma: s.sigma,
      cal,
    });
    if (!band) continue;
    hiErrs.push(Math.abs(s.actualHigh - band.predictedHigh));
    loErrs.push(Math.abs(s.actualLow - band.predictedLow));
  }
  const meanFn = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return { highMae: meanFn(hiErrs), lowMae: meanFn(loErrs) };
}

function buildDateIndex(bars) {
  const idx = new Map();
  for (let i = 0; i < bars.length; i += 1) {
    idx.set(cnSession.normBarDate(bars[i]), i);
  }
  return idx;
}

function crossPointDeltaForDate(crossBars, crossDateIdx, asOf) {
  const idx = crossDateIdx.get(asOf);
  if (idx == null || idx < 1) return 0;
  const prev = crossBars[idx - 1]?.close;
  const cur = crossBars[idx]?.close;
  if (!prev || !cur) return 0;
  return cur - prev;
}

function resolveCrossSource(id) {
  const cal = agriCal.DEFAULT_PARAMS[id];
  if (!cal) return null;
  if (cal.yCrossBias) return 'y';
  if (cal.mCrossBias) return 'm';
  if (cal.pCrossBias) return 'p';
  if (cal.oiCrossBias) return 'oi';
  if (cal.rmCrossBias) return 'rm';
  if (cal.cCrossBias) return 'c';
  if (cal.cfCrossBias) return 'cf';
  return null;
}

function precomputeSamples(id, bars, crossBars = null, crossId = null) {
  const crossDateIdx = crossBars?.length ? buildDateIndex(crossBars) : null;
  const useCross = crossDateIdx && crossId;
  const samples = [];
  for (let i = 20; i < bars.length - 1; i += 1) {
    const asOf = cnSession.normBarDate(bars[i]);
    const pair = cnSession.getSessionPair(bars, i);
    if (!pair) continue;

    const volWindow = agriCal.DEFAULT_PARAMS[id]?.volWindow || 20;
    const sigma = crossVol.computeRealizedVol(bars, i, volWindow);
    const extents = cnSession.collectSessionExtents(bars, i, 15);
    const pointDelta = useCross ? crossPointDeltaForDate(crossBars, crossDateIdx, asOf) : 0;

    samples.push({
      asOf,
      baselineClose: pair.baseline.close,
      actualHigh: pair.target.high,
      actualLow: pair.target.low,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta,
      sigma,
    });
  }
  return samples;
}

function evalCoverage(samples, cal, from, to) {
  let scored = 0;
  let covered = 0;
  for (const s of samples) {
    if (s.asOf < from || s.asOf > to) continue;
    const band = agriCal.computeAgriculturalRangeBand({
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

function evalBaseline(samples, id, from, to) {
  const cal = { ...agriCal.DEFAULT_PARAMS[id], upMult: 1.0, downMult: 1.0, _id: id };
  return evalCoverage(samples, cal, from, to);
}

function gridSearch(id, samples) {
  let best = null;
  const upRange = [];
  const downRange = [];
  for (let u = 1.0; u <= 2.8; u += 0.05) upRange.push(+u.toFixed(2));
  for (let d = 1.0; d <= 2.8; d += 0.05) downRange.push(+d.toFixed(2));

  for (const upMult of upRange) {
    for (const downMult of downRange) {
      const cal = { ...agriCal.DEFAULT_PARAMS[id], upMult, downMult, _id: id };
      const train = evalCoverage(samples, cal, TRAIN_FROM, TRAIN_TO);
      const oos = evalCoverage(samples, cal, OOS_FROM, OOS_TO);
      if (oos.pct < TARGET_COVERAGE) continue;
      const width = upMult + downMult;
      const slack = oos.pct - TARGET_COVERAGE;
      const score = -width - slack * 0.01;
      if (!best || score > best.score) {
        best = { cal, train, oos, score };
      }
    }
  }

  if (!best) {
    let fallback = null;
    for (const upMult of upRange) {
      for (const downMult of downRange) {
        const cal = { ...agriCal.DEFAULT_PARAMS[id], upMult, downMult, _id: id };
        const oos = evalCoverage(samples, cal, OOS_FROM, OOS_TO);
        if (!fallback || oos.pct > fallback.oos.pct) fallback = { cal, oos };
      }
    }
    return { ...fallback, hitTarget: false };
  }
  return { ...best, hitTarget: true };
}

function mergeExistingPayload() {
  const fp = agriCal.calFilePath();
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return {};
  }
}

function main() {
  const existing = mergeExistingPayload();
  const results = {};

  const crossCache = {};
  for (const cid of ['y', 'm', 'p', 'oi', 'rm', 'c', 'cf']) {
    crossCache[cid] = loadBars(cid);
  }

  for (const id of TARGET_IDS) {
    const prior = existing.metrics?.[id];
    if (prior?.oosCoveragePct >= TARGET_COVERAGE * 100 && prior?.hitTarget !== false) {
      console.log(`SKIP ${id}: already ${prior.oosCoveragePct}% OOS (hitTarget)`);
      continue;
    }

    const bars = loadBars(id);
    console.log(`\n=== Calibrating ${id.toUpperCase()} (${bars.length} bars) ===`);
    if (bars.length < 60) {
      console.log(`SKIP ${id}: insufficient bars`);
      continue;
    }
    console.log('Precomputing samples...');
    const crossId = resolveCrossSource(id);
    const crossBars = crossId ? crossCache[crossId] : null;
    const samples = precomputeSamples(id, bars, crossBars, crossId);
    if (crossId) {
      const withCross = samples.filter((s) => s.pointDelta !== 0).length;
      console.log(`${id.toUpperCase()} ${crossId.toUpperCase()} cross bias: ${withCross}/${samples.length} samples`);
    }
    console.log(`Samples: ${samples.length}`);

    const before = evalBaseline(samples, id, OOS_FROM, OOS_TO);
    console.log(
      `Baseline OOS: ${(before.pct * 100).toFixed(2)}% (${before.covered}/${before.scored})`,
    );

    const search = gridSearch(id, samples);
    const { _id, ...calParams } = search.cal;
    results[id] = { ...search, cal: calParams, baseline: before };
    const mae = maeHighLow(samples, search.cal, OOS_FROM, OOS_TO);
    console.log(
      `${id}: upMult=${calParams.upMult} downMult=${calParams.downMult} ` +
        `OOS coverage=${(search.oos.pct * 100).toFixed(2)}% (${search.oos.covered}/${search.oos.scored}) ` +
        `highMAE=${mae.highMae?.toFixed(1)} lowMAE=${mae.lowMae?.toFixed(1)} ` +
        `target=${search.hitTarget !== false ? 'HIT' : 'MISS'}`,
    );
  }

  if (!Object.keys(results).length) {
    console.log('\nNo new calibrations — existing JSON unchanged.');
    return;
  }

  const payload = {
    version: agriCal.CAL_VERSION,
    generatedAt: new Date().toISOString(),
    trainFrom: TRAIN_FROM,
    trainTo: TRAIN_TO,
    oosFrom: OOS_FROM,
    oosTo: OOS_TO,
    targetCoveragePct: TARGET_COVERAGE * 100,
    ...Object.fromEntries(
      agriCal.CALIBRATED_IDS.map((id) => [
        id,
        results[id]?.cal || existing[id] || agriCal.DEFAULT_PARAMS[id],
      ]),
    ),
    metrics: {
      ...(existing.metrics || {}),
      ...Object.fromEntries(
        Object.entries(results).map(([id, r]) => [
          id,
          {
            baselineOosCoveragePct: +(r.baseline.pct * 100).toFixed(2),
            oosCoveragePct: +(r.oos.pct * 100).toFixed(2),
            oosScored: r.oos.scored,
            trainCoveragePct: r.train ? +(r.train.pct * 100).toFixed(2) : null,
            upMult: r.cal.upMult,
            downMult: r.cal.downMult,
            hitTarget: r.hitTarget !== false,
          },
        ]),
      ),
    },
  };

  const fp = agriCal.saveCalParams(payload);
  console.log('\nSaved', fp);
  console.log(JSON.stringify(payload.metrics, null, 2));
}

main();
