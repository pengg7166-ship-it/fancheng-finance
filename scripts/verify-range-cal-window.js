/**
 * Compare archive band-hit (old preds) vs re-simulated preds with current calibration JSON.
 * FANCHENG_DATA_DRIVE=E node scripts/verify-range-cal-window.js [--from 2026-06-01] [--to 2026-06-27]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getInstrumentProfile } = require('../services/commodity-instrument-profiles');
const cnSession = require('../services/cn-futures-session-calendar');
const { predictNextDayHighLowFromBars } = require('../services/intraday-range-predictor');
const { loadEffectiveBars } = require('../services/next-day-range-predictor');
const archive = require('../services/range-prediction-archive');
const { getDataDir } = require('../services/data-paths');

const rawArgs = process.argv.slice(2);
let FROM = '2026-06-01';
let TO = '2026-06-27';
const FOCUS = ['au', 'ag', 'cu', 'bc', 'rb', 'fg', 'sc', 'fu', 'v', 'br'];
for (let i = 0; i < rawArgs.length; i += 1) {
  if (rawArgs[i] === '--from' && rawArgs[i + 1]) { FROM = rawArgs[i + 1].slice(0, 10); i += 1; }
  else if (rawArgs[i] === '--to' && rawArgs[i + 1]) { TO = rawArgs[i + 1].slice(0, 10); i += 1; }
}

function loadBars(id) {
  const base = getDataDir();
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

function statsFor(rows) {
  const scored = rows.filter((r) => r.bandHit != null);
  const hits = scored.filter((r) => r.bandHit).length;
  const maeH = scored.reduce((s, r) => s + Math.abs(r.highError || 0), 0) / (scored.length || 1);
  const maeL = scored.reduce((s, r) => s + Math.abs(r.lowError || 0), 0) / (scored.length || 1);
  return {
    count: scored.length,
    bandHitRate: scored.length ? +(hits / scored.length).toFixed(4) : null,
    maeHigh: +maeH.toFixed(4),
    maeLow: +maeL.toFixed(4),
  };
}

function simulateInstrument(id) {
  const bars = loadEffectiveBars(id, loadBars(id));
  const archiveRows = archive.loadArchive(id, { from: FROM, to: TO }).filter((r) => r.bandHit != null);
  if (!archiveRows.length || bars.length < 30) return null;

  const oldRows = archiveRows.map((r) => ({
    bandHit: r.bandHit,
    highError: r.highError,
    lowError: r.lowError,
  }));

  const newRows = [];
  for (const row of archiveRows) {
    const baselineDate = row.baselineDate || row.sessionDate;
    const barIdx = cnSession.resolveBarIdx(bars, baselineDate);
    if (barIdx < 20) continue;
    const pred = predictNextDayHighLowFromBars({
      instrumentId: id,
      klines: bars.slice(0, barIdx + 1),
      asOfDate: baselineDate,
    });
    if (!pred?.predictedHigh || !pred?.predictedLow) continue;
    const cmp = archive.computeRangeComparison({
      predHigh: pred.predictedHigh,
      predLow: pred.predictedLow,
      actualHigh: row.actualHigh,
      actualLow: row.actualLow,
      status: 'complete',
    });
    newRows.push(cmp);
  }

  const profile = getInstrumentProfile(id);
  return {
    instrumentId: id,
    sector: profile.sector,
    old: statsFor(oldRows),
    new: statsFor(newRows),
    deltaHit: newRows.length && oldRows.length
      ? +((statsFor(newRows).bandHitRate || 0) - (statsFor(oldRows).bandHitRate || 0)).toFixed(4)
      : null,
  };
}

function main() {
  // Force reload calibration caches
  for (const mod of [
    '../services/precious-range-calibration',
    '../services/nonferrous-range-calibration',
    '../services/chemical-range-calibration',
    '../services/energy-range-calibration',
    '../services/black-range-calibration',
    '../services/agricultural-range-calibration',
  ]) {
    try {
      const m = require(mod);
      if (m.resetCalCache) m.resetCalCache();
      if (m.loadCalParams) m.loadCalParams(true);
    } catch { /* ignore */ }
  }

  const root = archive.getArchiveRoot();
  const ids = fs.readdirSync(root)
    .filter((f) => f.endsWith('-daily.jsonl'))
    .map((f) => f.replace(/-daily\.jsonl$/, ''));

  const results = ids.map(simulateInstrument).filter(Boolean);
  const focus = results.filter((r) => FOCUS.includes(r.instrumentId));

  const sectorAgg = {};
  for (const r of results) {
    if (!sectorAgg[r.sector]) sectorAgg[r.sector] = { oldHits: 0, newHits: 0, count: 0, oldMaeH: 0, oldMaeL: 0, newMaeH: 0, newMaeL: 0 };
    const s = sectorAgg[r.sector];
    s.count += r.old.count;
    s.oldHits += Math.round((r.old.bandHitRate || 0) * r.old.count);
    s.newHits += Math.round((r.new.bandHitRate || 0) * r.new.count);
    s.oldMaeH += r.old.maeHigh * r.old.count;
    s.oldMaeL += r.old.maeLow * r.old.count;
    s.newMaeH += r.new.maeHigh * r.new.count;
    s.newMaeL += r.new.maeLow * r.new.count;
  }

  const bySector = Object.entries(sectorAgg).map(([sector, s]) => ({
    sector,
    count: s.count,
    oldHitRate: s.count ? +((s.oldHits / s.count).toFixed(4)) : null,
    newHitRate: s.count ? +((s.newHits / s.count).toFixed(4)) : null,
    oldMaeCombined: s.count ? +(((s.oldMaeH + s.oldMaeL) / (2 * s.count)).toFixed(4)) : null,
    newMaeCombined: s.count ? +(((s.newMaeH + s.newMaeL) / (2 * s.count)).toFixed(4)) : null,
  })).sort((a, b) => (a.oldHitRate || 0) - (b.oldHitRate || 0));

  const totalOldHits = results.reduce((s, r) => s + Math.round((r.old.bandHitRate || 0) * r.old.count), 0);
  const totalNewHits = results.reduce((s, r) => s + Math.round((r.new.bandHitRate || 0) * r.new.count), 0);
  const totalCount = results.reduce((s, r) => s + r.old.count, 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    window: { from: FROM, to: TO },
    totals: {
      count: totalCount,
      oldHitRate: totalCount ? +((totalOldHits / totalCount).toFixed(4)) : null,
      newHitRate: totalCount ? +((totalNewHits / totalCount).toFixed(4)) : null,
    },
    bySector,
    focusInstruments: focus.sort((a, b) => (b.deltaHit || 0) - (a.deltaHit || 0)),
  };

  const outPath = path.join(__dirname, '..', '_verify-range-cal-window.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`=== Verify Range Cal ${FROM} → ${TO} ===`);
  console.log(`Overall: ${(summary.totals.oldHitRate * 100).toFixed(1)}% → ${(summary.totals.newHitRate * 100).toFixed(1)}% band hit`);
  console.log('\nBy sector:');
  for (const s of bySector) {
    console.log(
      `  ${s.sector.padEnd(12)} ${((s.oldHitRate || 0) * 100).toFixed(1)}% → ${((s.newHitRate || 0) * 100).toFixed(1)}% · MAE ${s.oldMaeCombined} → ${s.newMaeCombined}`,
    );
  }
  console.log('\nFocus instruments:');
  for (const f of focus) {
    console.log(
      `  ${f.instrumentId.padEnd(4)} ${((f.old.bandHitRate || 0) * 100).toFixed(0)}% → ${((f.new.bandHitRate || 0) * 100).toFixed(0)}% · MAE H ${f.old.maeHigh}→${f.new.maeHigh} L ${f.old.maeLow}→${f.new.maeLow}`,
    );
  }
  console.log('\nOutput:', outPath);
}

main();
