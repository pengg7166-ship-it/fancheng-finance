/**
 * 回填下一交易日 high/low 预测 vs 实际 session 存档
 * FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/backfill-range-prediction-archive.js --id au --id fg --id sp
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const { getAllCommodities } = require('../services/commodities-catalog');
const cnSession = require('../services/cn-futures-session-calendar');
const { predictNextDayHighLowFromBars } = require('../services/intraday-range-predictor');
const { loadEffectiveBars } = require('../services/next-day-range-predictor');
const archive = require('../services/range-prediction-archive');

const DEFAULT_FROM = '2023-01-01';
const DEFAULT_TO = '2026-12-31';
const MIN_BARS = 30;
const WR_SKIP = new Set(['wr']);

const rawArgs = process.argv.slice(2);
const CLI_IDS = [];
let FROM = DEFAULT_FROM;
let TO = DEFAULT_TO;
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
  if (a === '--from' && rawArgs[i + 1]) {
    FROM = rawArgs[i + 1];
    i += 1;
    continue;
  }
  if (a === '--to' && rawArgs[i + 1]) {
    TO = rawArgs[i + 1];
    i += 1;
    continue;
  }
  if (!a.startsWith('--')) CLI_IDS.push(a.toLowerCase());
}

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

function isActiveInstrument(bars) {
  if (!bars?.length) return false;
  const tail = bars.slice(-20);
  return tail.some((b) => (b.volume ?? b.vol ?? 0) > 0);
}

function resolveTargetIds() {
  if (CLI_IDS.length) return CLI_IDS;
  return getAllCommodities()
    .map((m) => String(m.id).toLowerCase())
    .filter((id) => !WR_SKIP.has(id));
}

function backfillInstrument(id) {
  const bars = loadEffectiveBars(id, loadBars(id));
  if (bars.length < MIN_BARS) return { id, error: 'insufficient_bars', n: bars.length };
  if (!isActiveInstrument(bars)) return { id, error: 'inactive', n: bars.length };

  let recorded = 0;
  let bandHits = 0;
  let scored = 0;

  for (let i = 20; i < bars.length - 1; i += 1) {
    const asOf = cnSession.normBarDate(bars[i]);
    if (asOf < FROM || asOf > TO) continue;

    const pair = cnSession.getSessionPair(bars, i);
    if (!pair) continue;

    const pred = predictNextDayHighLowFromBars({
      instrumentId: id,
      klines: bars.slice(0, i + 1),
      asOfDate: asOf,
    });
    if (!pred?.predictedHigh || !pred?.predictedLow) continue;

    const cmp = archive.computeRangeComparison({
      predHigh: pred.predictedHigh,
      predLow: pred.predictedLow,
      actualHigh: pair.target.high,
      actualLow: pair.target.low,
      status: 'complete',
    });

    archive.recordSessionOutcome({
      instrumentId: id,
      sessionDate: pair.target.nextBarDate,
      baselineDate: pair.baseline.date,
      baseClose: pair.baseline.close,
      predHigh: pred.predictedHigh,
      predLow: pred.predictedLow,
      actualHigh: pair.target.high,
      actualLow: pair.target.low,
      modelVersion: pred.method || pred.version || 'backfill-v1',
      meta: { asOfDate: asOf, backfill: true },
    });

    recorded += 1;
    scored += 1;
    if (cmp.bandHit) bandHits += 1;
  }

  const stats = archive.getComparisonStats(id, { from: FROM, to: TO });
  return {
    id,
    recorded,
    scored,
    bandHitRate: scored ? +((bandHits / scored) * 100).toFixed(2) : null,
    archiveStats: stats,
    path: archive.getArchivePath(id),
  };
}

function main() {
  const ids = resolveTargetIds();
  const results = ids.map((id) => backfillInstrument(id));
  const ok = results.filter((r) => !r.error);
  const bandRates = ok.map((r) => r.bandHitRate).filter((v) => v != null);
  const summary = {
    version: 'range-prediction-archive-backfill-v1',
    from: FROM,
    to: TO,
    instrumentCount: ids.length,
    successCount: ok.length,
    totalRecorded: ok.reduce((s, r) => s + (r.recorded || 0), 0),
    meanBandHitRatePct:
      bandRates.length ? +(bandRates.reduce((a, b) => a + b, 0) / bandRates.length).toFixed(2) : null,
    archiveRoot: archive.getArchiveRoot(),
    instruments: results,
  };

  const outJson = path.join(__dirname, '..', '_backfill-range-prediction-archive.json');
  const outTxt = path.join(__dirname, '..', '_backfill-range-prediction-archive.txt');
  fs.writeFileSync(outJson, JSON.stringify(summary, null, 2));

  const lines = [
    '=== Range Prediction Archive Backfill ===',
    `Window: ${FROM} → ${TO}`,
    `Instruments: ${ids.length} · success ${ok.length}`,
    `Total records: ${summary.totalRecorded}`,
    `Mean band hit rate: ${summary.meanBandHitRatePct ?? '—'}%`,
    '',
    'id | recorded | bandHit% | path',
    ...results.map(
      (r) =>
        `${r.id} | ${r.recorded ?? '—'} | ${r.bandHitRate ?? '—'}% | ${r.error || r.path || '—'}`,
    ),
  ];
  fs.writeFileSync(outTxt, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log('\nWrote', outJson);
}

main();
