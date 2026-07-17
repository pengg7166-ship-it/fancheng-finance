/**
 * 黑色系 baseline OOS range coverage（网格 baseline upMult=downMult=1.0）
 * FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/probe-black-range-baseline-fast.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const cnSession = require('../services/cn-futures-session-calendar');
const crossVol = require('../services/cross-vol-magnitude');
const blackCal = require('../services/black-range-calibration');

const OOS_FROM = '2023-01-01';
const OOS_TO = '2026-12-31';

function loadBars(id) {
  const base = getDataDir() || 'E:\\FanchengFinance\\data';
  for (const key of [id, id.toUpperCase()]) {
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

function buildDateIndex(bars) {
  const idx = new Map();
  for (let i = 0; i < bars.length; i += 1) idx.set(cnSession.normBarDate(bars[i]), i);
  return idx;
}

function crossPointDelta(crossBars, crossDateIdx, asOf) {
  const idx = crossDateIdx.get(asOf);
  if (idx == null || idx < 1) return 0;
  const prev = crossBars[idx - 1]?.close;
  const cur = crossBars[idx]?.close;
  return prev && cur ? cur - prev : 0;
}

function resolveCrossSource(id) {
  const cal = blackCal.DEFAULT_PARAMS[id];
  if (!cal) return null;
  if (cal.rbCrossBias) return 'rb';
  if (cal.iCrossBias) return 'i';
  if (cal.jmCrossBias) return 'jm';
  if (cal.jCrossBias) return 'j';
  return null;
}

function evalBaseline(id, bars, crossBars) {
  const crossId = resolveCrossSource(id);
  const crossDateIdx = crossBars?.length ? buildDateIndex(crossBars) : null;
  let scored = 0;
  let covered = 0;
  const cal = { ...blackCal.DEFAULT_PARAMS[id], upMult: 1.0, downMult: 1.0 };

  for (let i = 20; i < bars.length - 1; i += 1) {
    const asOf = cnSession.normBarDate(bars[i]);
    if (asOf < OOS_FROM || asOf > OOS_TO) continue;
    const pair = cnSession.getSessionPair(bars, i);
    if (!pair) continue;
    const volWindow = cal.volWindow || 20;
    const sigma = crossVol.computeRealizedVol(bars, i, volWindow);
    const extents = cnSession.collectSessionExtents(bars, i, 15);
    const pointDelta = crossDateIdx && crossId ? crossPointDelta(crossBars, crossDateIdx, asOf) : 0;
    const band = blackCal.computeBlackRangeBand({
      instrumentId: id,
      baselineClose: pair.baseline.close,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta,
      sigma,
      cal,
    });
    if (!band) continue;
    scored += 1;
    if (pair.target.high <= band.predictedHigh && pair.target.low >= band.predictedLow) covered += 1;
  }
  return { id, scored, covered, rangeCoveragePct: scored ? +((covered / scored) * 100).toFixed(2) : null };
}

function main() {
  const crossCache = {};
  for (const cid of ['rb', 'i', 'j', 'jm']) crossCache[cid] = loadBars(cid);

  const results = blackCal.CALIBRATED_IDS.map((id) => {
    const bars = loadBars(id);
    const crossId = resolveCrossSource(id);
    return evalBaseline(id, bars, crossId ? crossCache[crossId] : null);
  });

  const payload = { version: 'probe-black-baseline-fast-v1', oosFrom: OOS_FROM, oosTo: OOS_TO, instruments: results };
  const outJson = path.join(__dirname, '..', '_probe-black-range-baseline.json');
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  console.log('=== Black Baseline OOS (extents×1.0) ===');
  for (const r of results) {
    console.log(`${r.id}: ${r.rangeCoveragePct}% (${r.covered}/${r.scored})`);
  }
  console.log('\nWrote', outJson);
}

main();
