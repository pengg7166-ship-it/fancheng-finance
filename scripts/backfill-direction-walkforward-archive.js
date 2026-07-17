/**
 * Walk-forward 回填方向预测审计存档（2017+ K 线 · T+1 · v1.34.8 引擎）
 *
 * 用法:
 *   FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/backfill-direction-walkforward-archive.js
 *   ... --sector precious --from 2019-01-01 --to 2025-12-31
 *   ... --id au --id ag --measure-only
 *   ... --export-csv
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { getAllCommodities } = require('../services/commodities-catalog');
const archive = require('../services/direction-prediction-archive');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { hitDirection } = require('../services/outlook-labels');
const { predictEnsembleSync, directionFromPUp, predictFromWeights, getDefaultWeightsPath } = require('../services/outlook-onnx-runner');

const WR_SKIP = new Set(['wr']);
const PRODUCTION_SOURCES = new Set(['daily-summary', 'outlook-jsonl']);
const OUT_DIR = path.join(process.cwd(), 'data', 'exports');
const OUT_CSV = path.join(OUT_DIR, 'direction-archive-t1-summary.csv');
const OUT_JSON = path.join(OUT_DIR, 'direction-archive-t1-report.json');

const rawArgs = process.argv.slice(2);
let FROM = process.env.DIRECTION_BACKFILL_FROM || '2017-12-11';
let TO = process.env.DIRECTION_BACKFILL_TO || '2025-12-31';
let SECTOR = null;
const CLI_IDS = [];
let MEASURE_ONLY = false;
let EXPORT_CSV = false;
let USE_ENSEMBLE = false;
let FORCE = false;
let WEIGHTS_PATH = null;
let MODEL_VERSION_TAG = null;

for (let i = 0; i < rawArgs.length; i += 1) {
  const a = rawArgs[i];
  if (a === '--measure-only') { MEASURE_ONLY = true; continue; }
  if (a === '--export-csv') { EXPORT_CSV = true; continue; }
  if (a === '--use-ensemble') { USE_ENSEMBLE = true; continue; }
  if (a === '--force') { FORCE = true; continue; }
  if (a === '--weights-path' && rawArgs[i + 1]) { WEIGHTS_PATH = rawArgs[++i]; continue; }
  if (a === '--model-version' && rawArgs[i + 1]) { MODEL_VERSION_TAG = rawArgs[++i]; continue; }
  if (a === '--from' && rawArgs[i + 1]) { FROM = rawArgs[++i]; continue; }
  if (a === '--to' && rawArgs[i + 1]) { TO = rawArgs[++i]; continue; }
  if (a === '--sector' && rawArgs[i + 1]) { SECTOR = String(rawArgs[++i]).toLowerCase(); continue; }
  if (a === '--id' && rawArgs[i + 1]) { CLI_IDS.push(String(rawArgs[++i])); continue; }
  if (a.startsWith('--id=')) CLI_IDS.push(a.slice(5));
}

function findSpec(id) {
  const lower = String(id).toLowerCase();
  return INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === lower);
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadBars(id) {
  const k = readCachedKlines(id);
  if (k.length >= 60) return k;
  const fp = path.join(getDataDir(), 'history', 'trading', `${id}.json`);
  if (!fs.existsSync(fp)) return [];
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return (Array.isArray(raw) ? raw : raw.series || [])
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function isActiveInstrument(bars) {
  if (!bars?.length) return false;
  return bars.slice(-20).some((b) => (b.volume ?? b.vol ?? 0) > 0);
}

function resolveTargetIds() {
  if (CLI_IDS.length) return CLI_IDS;
  const all = getAllCommodities()
    .map((m) => String(m.id))
    .filter((id) => !WR_SKIP.has(id.toLowerCase()));
  if (!SECTOR) return all;
  const sectorSet = new Set(
    INSTRUMENT_REGISTRY.filter((s) => s.sector === SECTOR).map((s) => String(s.id).toLowerCase()),
  );
  return all.filter((id) => sectorSet.has(id.toLowerCase()));
}

function tierLabelFromDir(dir) {
  if (dir === 'bullish') return '偏多';
  if (dir === 'bearish') return '偏空';
  return '震荡';
}

function buildFlatRowForEnsemble(spec, row) {
  return {
    instrumentId: spec.id,
    philosophyScore: row.philosophyScore,
    factorComposite: row.factorComposite,
    adaptiveScore: row.adaptiveScore,
    real10y_chg_5d: row.real10y_chg_5d,
    warehouseReceipt_chg_5d: row.warehouseReceipt_chg_5d,
    term_spread_pct: row.term_spread_pct,
    term_z_score: row.term_z_score,
    term_spread_chg_5d: row.term_spread_chg_5d,
    cu_momentum_5d: row.cu_momentum_5d,
    cu_term_spread_pct: row.cu_term_spread_pct,
    cu_term_z_score: row.cu_term_z_score,
    gsr_z_score: row.gsr_z_score,
    slvHoldings_chg_5d: row.slvHoldings_chg_5d,
    lmeInventory_chg_wow: row.lmeInventory_chg_wow,
    gldHoldings_chg_5d: row.gldHoldings_chg_5d,
    oiBehavior: row.oiBehavior,
    marketRegime: row.marketRegime,
    philosophyMeta: row.philosophyMeta,
  };
}

function resolvePredictedDir(spec, row, weightsPayload = null) {
  if (USE_ENSEMBLE && (spec.id === 'au' || spec.id === 'ag')) {
    const ens = predictEnsembleSync(buildFlatRowForEnsemble(spec, row));
    return { dir: ens.direction, tier: ens.direction, label: tierLabelFromDir(ens.direction), pUp: ens.pUp };
  }
  if (weightsPayload) {
    const flat = buildFlatRowForEnsemble(spec, row);
    const pred = predictFromWeights(weightsPayload, flat);
    if (pred?.pUp != null) {
      return {
        dir: pred.direction || row.predictedDir,
        tier: pred.direction || row.predictedDir,
        label: tierLabelFromDir(pred.direction || row.predictedDir),
        pUp: pred.pUp,
      };
    }
  }
  return { dir: row.predictedDir, tier: row.predictedDir, label: tierLabelFromDir(row.predictedDir), pUp: null };
}

function existingByDay(instrumentId) {
  const map = new Map();
  for (const r of archive.loadArchive(instrumentId, { from: '1900-01-01' })) {
    map.set(r.baselineDate, r);
  }
  return map;
}

function shouldPreserveExisting(existing) {
  if (!existing) return false;
  if (!FORCE && PRODUCTION_SOURCES.has(existing.source)) return true;
  return false;
}

function walkforwardInstrument(id) {
  const spec = findSpec(id);
  if (!spec) return { id, error: 'no_spec' };

  const bars = loadBars(id);
  if (bars.length < 60) return { id, error: 'insufficient_bars', n: bars.length };
  if (!isActiveInstrument(bars)) return { id, error: 'inactive', n: bars.length };

  const weights = calibration.getCompositeWeights();
  let weightsPayload = null;
  try {
    const wp = WEIGHTS_PATH || getDefaultWeightsPath();
    weightsPayload = JSON.parse(fs.readFileSync(wp, 'utf8'));
  } catch {
    // optional
  }
  if (MODEL_VERSION_TAG) {
    process.env.DIRECTION_ARCHIVE_MODEL_VERSION = MODEL_VERSION_TAG;
  }
  const existingMap = existingByDay(id);
  const records = [];
  let prevFinance = 'neutral';
  let written = 0;
  let skippedProd = 0;

  for (let t = 60; t < bars.length - 1; t += 1) {
    const day = normBarDate(bars[t]);
    if (day < FROM || day > TO) continue;
    if (day < archive.ARCHIVE_START_DATE) continue;

    const existing = existingMap.get(day);
    if (shouldPreserveExisting(existing)) {
      skippedProd += 1;
      continue;
    }

    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {});
    if (!row) continue;
    prevFinance = row.financeRegimeNext || prevFinance;

    const pred = resolvePredictedDir(spec, row, weightsPayload);
    const record = archive.buildDirectionRecord({
      instrumentId: id,
      baselineDate: day,
      predictedDir: pred.dir,
      predictedTier: pred.tier,
      predictedDirLabel: pred.label,
      source: 'walk-forward',
      predictTs: `${day}T15:00:00.000Z`,
      bars,
    });
    if (!record) continue;
    if (pred.pUp != null) {
      record.ensemblePUp = pred.pUp;
      record.logisticPUp = pred.pUp;
    }
    records.push(record);
  }

  if (!MEASURE_ONLY && records.length) {
    const merge = archive.bulkMergeRecords(id, records, { force: FORCE });
    written = merge.added + merge.updated;
    skippedProd = merge.skipped;
  }

  const stats = archive.getDirectionStats(id, { from: FROM, to: TO });
  return {
    id,
    sector: spec.sector,
    walkDays: records.length,
    written,
    skippedProd,
    rows: stats.count,
    scored: stats.scored,
    hits: stats.hits,
    hitRate: stats.hitRate,
    startDate: stats.startDate,
    endDate: stats.endDate,
  };
}

function pct(h, s) {
  return s ? +((h / s) * 100).toFixed(2) : null;
}

function aggregateReport(results) {
  const ok = results.filter((r) => !r.error);
  let hits = 0;
  let scored = 0;
  let rows = 0;
  const bySector = {};
  const perInstrument = [];

  for (const r of ok) {
    hits += r.hits || 0;
    scored += r.scored || 0;
    rows += r.rows || 0;
    const sec = r.sector || 'unknown';
    if (!bySector[sec]) bySector[sec] = { hits: 0, scored: 0, instruments: 0 };
    bySector[sec].hits += r.hits || 0;
    bySector[sec].scored += r.scored || 0;
    bySector[sec].instruments += 1;
    perInstrument.push({
      instrumentId: r.id,
      sector: r.sector,
      dateFrom: r.startDate,
      dateTo: r.endDate,
      rows: r.rows,
      scored: r.scored,
      hits: r.hits,
      hitRatePct: pct(r.hits, r.scored),
    });
  }

  const auAg = ok.filter((r) => r.id === 'au' || r.id === 'ag');
  const auAgHits = auAg.reduce((s, r) => s + (r.hits || 0), 0);
  const auAgScored = auAg.reduce((s, r) => s + (r.scored || 0), 0);

  const directionT1Scoring = require('../services/direction-t1-scoring');
  let gatedHits = 0;
  let gatedScored = 0;
  for (const r of ok) {
    const rows = archive.loadArchive(r.id, { from: FROM, to: TO });
    const g = directionT1Scoring.computeGatedStats(rows);
    gatedHits += g.hits || 0;
    gatedScored += g.scored || 0;
  }

  for (const sec of Object.keys(bySector)) {
    const s = bySector[sec];
    s.hitRatePct = pct(s.hits, s.scored);
  }

  return {
    generatedAt: new Date().toISOString(),
    window: { from: FROM, to: TO },
    modelVersion: archive.MODEL_VERSION,
    horizon: archive.VERIFY_HORIZON,
    targetHitRate: archive.DIRECTION_HIT_TARGET,
    useEnsemble: USE_ENSEMBLE,
    instrumentsOk: ok.length,
    instrumentsTotal: results.length,
    totalRows: rows,
    overall: { hits, scored, hitRatePct: pct(hits, scored), meetsTarget: scored ? hits / scored >= archive.DIRECTION_HIT_TARGET : null },
    gatedOverall: { hits: gatedHits, scored: gatedScored, hitRatePct: pct(gatedHits, gatedScored), meetsTarget: gatedScored ? gatedHits / gatedScored >= archive.DIRECTION_HIT_TARGET : null },
    auAg: { hits: auAgHits, scored: auAgScored, hitRatePct: pct(auAgHits, auAgScored) },
    bySector,
    perInstrument: perInstrument.sort((a, b) => String(a.instrumentId).localeCompare(b.instrumentId)),
  };
}

function writeCsv(report) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const header = 'instrumentId,sector,dateFrom,dateTo,rows,scored,hits,hitRatePct';
  const lines = report.perInstrument.map((r) =>
    [r.instrumentId, r.sector, r.dateFrom, r.dateTo, r.rows, r.scored, r.hits, r.hitRatePct ?? ''].join(','),
  );
  fs.writeFileSync(OUT_CSV, `${header}\n${lines.join('\n')}\n`, 'utf8');
}

/** 阈值调优：仅调整 neutral 带宽度（compositeScore 缩放），不改权重 */
function tuneThresholdMultiplier(allRows) {
  let best = { mult: 1, hits: 0, scored: 0, hitRatePct: 0 };
  for (let mult = 1; mult <= 2.5; mult += 0.05) {
    let hits = 0;
    let scored = 0;
    for (const row of allRows) {
      const cs = row.compositeScore;
      if (cs == null) continue;
      const adj = cs / mult;
      let pred = 'neutral';
      if (adj >= 0.12) pred = 'bullish';
      else if (adj <= -0.12) pred = 'bearish';
      if (pred === 'neutral') continue;
      if (!row.actualDir || row.actualDir === 'neutral') continue;
      scored += 1;
      if (hitDirection(pred, row.actualDir)) hits += 1;
    }
    const hitRatePct = pct(hits, scored);
    if (hitRatePct != null && hitRatePct > best.hitRatePct) {
      best = { mult: +mult.toFixed(2), hits, scored, hitRatePct };
    }
  }
  return best;
}

async function collectWalkRows(ids) {
  const weights = calibration.getCompositeWeights();
  const allRows = [];
  for (const id of ids) {
    const spec = findSpec(id);
    const bars = loadBars(id);
    if (bars.length < 60) continue;
    let prevFinance = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 1) {
      const day = normBarDate(bars[t]);
      if (day < FROM || day > TO) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {});
      if (!row) continue;
      prevFinance = row.financeRegimeNext || prevFinance;
      const actual = archive.resolveActualT1(bars, day);
      if (actual.status !== 'complete' || !actual.actualDir) continue;
      allRows.push({
        instrumentId: id,
        sector: spec.sector,
        date: day,
        compositeScore: row.compositeScore,
        predictedDir: row.predictedDir,
        actualDir: actual.actualDir,
      });
    }
  }
  return allRows;
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: false });

  const ids = resolveTargetIds();
  console.log('=== DIRECTION WALK-FORWARD ARCHIVE BACKFILL ===');
  console.log('from', FROM, 'to', TO, 'instruments', ids.length, 'measureOnly', MEASURE_ONLY, 'ensemble', USE_ENSEMBLE);

  const results = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = walkforwardInstrument(id);
    results.push(row);
    if (row.error) console.log(`[${i + 1}/${ids.length}]`, id, 'SKIP', row.error);
    else {
      console.log(
        `[${i + 1}/${ids.length}]`,
        id,
        'walk',
        row.walkDays,
        'written',
        row.written,
        'scored',
        row.scored,
        'hitRate',
        row.hitRate != null ? `${Math.round(row.hitRate * 100)}%` : '—',
        `(${row.hits}/${row.scored})`,
      );
    }
  }

  const report = aggregateReport(results);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  if (EXPORT_CSV || !MEASURE_ONLY) writeCsv(report);

  console.log('\n=== SUMMARY ===');
  console.log('overall T+1', report.overall.hitRatePct + '%', `(${report.overall.hits}/${report.overall.scored})`);
  if (report.gatedOverall) {
    console.log('gated T+1', report.gatedOverall.hitRatePct + '%', `(${report.gatedOverall.hits}/${report.gatedOverall.scored})`);
  }
  console.log('au+ag T+1', report.auAg.hitRatePct + '%', `(${report.auAg.hits}/${report.auAg.scored})`);
  console.log('target', Math.round(archive.DIRECTION_HIT_TARGET * 100) + '%', 'met?', report.overall.meetsTarget);
  console.log('bySector', JSON.stringify(report.bySector, null, 2));
  console.log('Wrote', OUT_JSON);
  if (fs.existsSync(OUT_CSV)) console.log('Wrote', OUT_CSV);

  if (!report.overall.meetsTarget) {
    console.log('\n=== THRESHOLD TUNING (composite mult, no weight change) ===');
    const tuneIds = ids.slice(0, Math.min(ids.length, 10));
    const sampleRows = await collectWalkRows(tuneIds);
    const tuned = tuneThresholdMultiplier(sampleRows);
    console.log('sample instruments', tuneIds.length, 'rows', sampleRows.length);
    console.log('best mult', tuned.mult, 'hitRate', tuned.hitRatePct + '%', `(${tuned.hits}/${tuned.scored})`);
    report.thresholdTuningSample = tuned;
    fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { walkforwardInstrument, aggregateReport };
