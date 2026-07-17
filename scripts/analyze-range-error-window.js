/**
 * Per-instrument range prediction error analysis for a date window.
 * FANCHENG_DATA_DRIVE=E node scripts/analyze-range-error-window.js [--from 2026-06-01] [--to 2026-06-27]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getInstrumentProfile } = require('../services/commodity-instrument-profiles');
const archive = require('../services/range-prediction-archive');

const rawArgs = process.argv.slice(2);
let FROM = '2026-06-01';
let TO = '2026-06-27';
for (let i = 0; i < rawArgs.length; i += 1) {
  if (rawArgs[i] === '--from' && rawArgs[i + 1]) {
    FROM = rawArgs[i + 1].slice(0, 10);
    i += 1;
  } else if (rawArgs[i] === '--to' && rawArgs[i + 1]) {
    TO = rawArgs[i + 1].slice(0, 10);
    i += 1;
  }
}

const PREDICTOR_MAP = {
  precious: 'precious-range-calibration',
  nonferrous: 'nonferrous-range-calibration',
  black: 'black-range-calibration',
  chemical: 'chemical-range-calibration',
  energy: 'energy-range-calibration',
  agriculture: 'agricultural-range-calibration',
  shipping: 'shipping-range-calibration',
};

function resolveArchiveIds() {
  const root = archive.getArchiveRoot();
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith('-daily.jsonl'))
    .map((f) => f.replace(/-daily\.jsonl$/, ''))
    .sort();
}

function pctErr(err, baseClose) {
  if (err == null || !baseClose) return null;
  return +((err / baseClose) * 100).toFixed(4);
}

function analyzeInstrument(id, dateRange) {
  const rows = archive.loadArchive(id, dateRange).filter((r) => r.bandHit != null);
  if (!rows.length) return null;

  const profile = getInstrumentProfile(id);
  const sector = profile.sector || 'agriculture';
  const highErrors = rows.map((r) => r.highError);
  const lowErrors = rows.map((r) => r.lowError);
  const absHigh = highErrors.map((e) => Math.abs(e));
  const absLow = lowErrors.map((e) => Math.abs(e));
  const maeHigh = absHigh.reduce((s, v) => s + v, 0) / absHigh.length;
  const maeLow = absLow.reduce((s, v) => s + v, 0) / absLow.length;
  const meanHigh = highErrors.reduce((s, v) => s + v, 0) / highErrors.length;
  const meanLow = lowErrors.reduce((s, v) => s + v, 0) / lowErrors.length;
  const pctHigh = rows.map((r) => pctErr(r.highError, r.baseClose)).filter((v) => v != null);
  const pctLow = rows.map((r) => pctErr(r.lowError, r.baseClose)).filter((v) => v != null);
  const maeHighPct = pctHigh.length ? pctHigh.reduce((s, v) => s + Math.abs(v), 0) / pctHigh.length : null;
  const maeLowPct = pctLow.length ? pctLow.reduce((s, v) => s + Math.abs(v), 0) / pctLow.length : null;
  const bandHits = rows.filter((r) => r.bandHit).length;
  const highMissLow = rows.filter((r) => !r.lowHit).length;
  const highMissHigh = rows.filter((r) => !r.highHit).length;

  return {
    instrumentId: id,
    sector,
    predictor: PREDICTOR_MAP[sector] || 'intraday-range-predictor (pct-vol fallback)',
    count: rows.length,
    bandHitRate: +(bandHits / rows.length).toFixed(4),
    highHitRate: +((rows.length - highMissHigh) / rows.length).toFixed(4),
    lowHitRate: +((rows.length - highMissLow) / rows.length).toFixed(4),
    meanHighError: +meanHigh.toFixed(4),
    meanLowError: +meanLow.toFixed(4),
    maeHigh: +maeHigh.toFixed(4),
    maeLow: +maeLow.toFixed(4),
    maeHighPct: maeHighPct != null ? +maeHighPct.toFixed(4) : null,
    maeLowPct: maeLowPct != null ? +maeLowPct.toFixed(4) : null,
    maeCombined: +((maeHigh + maeLow) / 2).toFixed(4),
    biasHigh: meanHigh > 0 ? 'actual_above_pred' : meanHigh < 0 ? 'pred_high_too_high' : 'neutral',
    biasLow: meanLow > 0 ? 'pred_low_too_low' : meanLow < 0 ? 'actual_below_pred' : 'neutral',
    lowMissCount: highMissLow,
    highMissCount: highMissHigh,
  };
}

function main() {
  const dateRange = { from: FROM, to: TO };
  const ids = resolveArchiveIds();
  const perInstrument = ids.map((id) => analyzeInstrument(id, dateRange)).filter(Boolean);

  const perSector = {};
  for (const inst of perInstrument) {
    if (!perSector[inst.sector]) {
      perSector[inst.sector] = { sector: inst.sector, instruments: 0, count: 0, bandHits: 0, maeHighSum: 0, maeLowSum: 0 };
    }
    const s = perSector[inst.sector];
    s.instruments += 1;
    s.count += inst.count;
    s.bandHits += Math.round(inst.bandHitRate * inst.count);
    s.maeHighSum += inst.maeHigh * inst.count;
    s.maeLowSum += inst.maeLow * inst.count;
  }

  const sectorSummary = Object.values(perSector)
    .map((s) => ({
      sector: s.sector,
      instruments: s.instruments,
      count: s.count,
      bandHitRate: s.count ? +((s.bandHits / s.count).toFixed(4)) : null,
      maeHigh: s.count ? +((s.maeHighSum / s.count).toFixed(4)) : null,
      maeLow: s.count ? +((s.maeLowSum / s.count).toFixed(4)) : null,
      maeCombined: s.count ? +(((s.maeHighSum + s.maeLowSum) / (2 * s.count)).toFixed(4)) : null,
    }))
    .sort((a, b) => (b.maeCombined || 0) - (a.maeCombined || 0));

  const worstMae = [...perInstrument].sort((a, b) => b.maeCombined - a.maeCombined).slice(0, 15);
  const worstHit = [...perInstrument].sort((a, b) => a.bandHitRate - b.bandHitRate).slice(0, 15);

  const totalCount = perInstrument.reduce((s, p) => s + p.count, 0);
  const totalBandHits = perInstrument.reduce((s, p) => s + Math.round(p.bandHitRate * p.count), 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    window: dateRange,
    totals: {
      instruments: perInstrument.length,
      scoredRows: totalCount,
      bandHitRate: totalCount ? +((totalBandHits / totalCount).toFixed(4)) : null,
    },
    bySector: sectorSummary,
    worstByMae: worstMae,
    worstByHitRate: worstHit,
    byInstrument: perInstrument.sort((a, b) => b.maeCombined - a.maeCombined),
  };

  const outPath = path.join(__dirname, '..', '_analyze-range-error-window.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`=== Range Error Analysis ${FROM} → ${TO} ===`);
  console.log(`Instruments: ${perInstrument.length} · Scored: ${totalCount} · Band hit: ${((summary.totals.bandHitRate || 0) * 100).toFixed(1)}%`);
  console.log('\nBy sector (MAE combined):');
  for (const s of sectorSummary) {
    console.log(
      `  ${s.sector.padEnd(12)} hit ${((s.bandHitRate || 0) * 100).toFixed(1)}% · MAE H=${s.maeHigh} L=${s.maeLow} · n=${s.count}`,
    );
  }
  console.log('\nWorst 15 by combined MAE:');
  for (const w of worstMae) {
    console.log(
      `  ${w.instrumentId.padEnd(4)} (${w.sector.padEnd(10)}) hit ${(w.bandHitRate * 100).toFixed(0)}% · MAE H=${w.maeHigh} L=${w.maeLow} · bias H:${w.biasHigh} L:${w.biasLow} · lowMiss=${w.lowMissCount} highMiss=${w.highMissCount}`,
    );
  }
  console.log('\nOutput:', outPath);
}

main();
