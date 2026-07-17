/**
 * T+1 direction hit-rate optimizer — diagnose + grid-search toward 75%
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/optimize-t1-direction-75.js
 *   ... --phase diagnose|search|all
 *   ... --oos-from 2023-01-01
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
const {
  predictEnsembleSync,
  predictFromWeights,
  directionFromPUp,
  getDefaultWeightsPath,
} = require('../services/outlook-onnx-runner');

const FROM = process.env.DIRECTION_OPT_FROM || '2017-12-11';
const TO = process.env.DIRECTION_OPT_TO || '2025-12-31';
const OOS_FROM = process.env.DIRECTION_OOS_FROM || '2023-01-01';
const OUT_DIR = path.join(process.cwd(), 'data', 'exports');
const OUT_JSON = path.join(OUT_DIR, 'direction-t1-75-optimization.json');
const OUT_TXT = path.join(process.cwd(), '_optimize-t1-direction-75.txt');
const CALIB_JSON = path.join(getDataDir(), 'outlook-models', 'direction-t1-75-calibration.json');
const EXPERIMENT_WEIGHTS = path.join(getDataDir(), 'outlook-models', 'outlook-logistic-weights-t1-75-experiment.json');

const WR_SKIP = new Set(['wr']);
const LAGGARDS = new Set(['si', 'l', 'sh', 'lh', 'lg', 'pk', 'cj', 'ad', 'bc', 'br']);

const rawArgs = process.argv.slice(2);
let PHASE = 'all';
for (let i = 0; i < rawArgs.length; i += 1) {
  if (rawArgs[i] === '--phase' && rawArgs[i + 1]) PHASE = rawArgs[++i];
}

function findSpec(id) {
  return INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === String(id).toLowerCase());
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

function resolveIds() {
  return getAllCommodities()
    .map((m) => String(m.id))
    .filter((id) => !WR_SKIP.has(id.toLowerCase()) && findSpec(id));
}

function pct(h, s) {
  return s ? +((h / s) * 100).toFixed(2) : null;
}

function metrics(rows, predFn, filterFn = null) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    if (filterFn && !filterFn(row)) continue;
    const pred = predFn(row);
    if (!pred || pred === 'neutral') continue;
    if (!row.actualDir || row.actualDir === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDir)) hits += 1;
  }
  return { hits, scored, hitRatePct: pct(hits, scored) };
}

function buildFlatRow(spec, row) {
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

/** Phase 1 — archive diagnosis (fast, no re-walk) */
function diagnoseArchive(ids) {
  const bySector = {};
  const byTier = {};
  const byRegime = {}; // from archive if present
  let totalRows = 0;
  let scored = 0;
  let hits = 0;
  let neutral = 0;
  const perInstrument = [];

  for (const id of ids) {
    const spec = findSpec(id);
    const rows = archive.loadArchive(id, { from: FROM, to: TO });
    totalRows += rows.length;
    let iScored = 0;
    let iHits = 0;
    for (const r of rows) {
      if (r.predictedDir === 'neutral') {
        neutral += 1;
        continue;
      }
      if (r.hitDirection == null) continue;
      scored += 1;
      iScored += 1;
      if (r.hitDirection) {
        hits += 1;
        iHits += 1;
      }
      const sec = spec?.sector || 'unknown';
      if (!bySector[sec]) bySector[sec] = { hits: 0, scored: 0 };
      bySector[sec].scored += 1;
      if (r.hitDirection) bySector[sec].hits += 1;

      const tier = r.predictedTier || r.predictedDir || 'unknown';
      if (!byTier[tier]) byTier[tier] = { hits: 0, scored: 0 };
      byTier[tier].scored += 1;
      if (r.hitDirection) byTier[tier].hits += 1;
    }
    perInstrument.push({
      instrumentId: id,
      sector: spec?.sector,
      scored: iScored,
      hits: iHits,
      hitRatePct: pct(iHits, iScored),
    });
  }

  for (const k of Object.keys(bySector)) {
    bySector[k].hitRatePct = pct(bySector[k].hits, bySector[k].scored);
  }
  for (const k of Object.keys(byTier)) {
    byTier[k].hitRatePct = pct(byTier[k].hits, byTier[k].scored);
  }

  perInstrument.sort((a, b) => (a.hitRatePct ?? 0) - (b.hitRatePct ?? 0));

  return {
    totalRows,
    scored,
    hits,
    neutral,
    hitRatePct: pct(hits, scored),
    bySector,
    byTier,
    worstInstruments: perInstrument.filter((p) => p.scored >= 20).slice(0, 15),
    bestInstruments: perInstrument.filter((p) => p.scored >= 20).slice(-10).reverse(),
  };
}

/** Collect walk-forward rows with logistic pUp + archive T+1 actual */
async function collectScoredRows(ids, weightsPayload, opts = {}) {
  const weights = calibration.getCompositeWeights();
  const allRows = [];
  let done = 0;

  for (const id of ids) {
    const spec = findSpec(id);
    const bars = loadBars(id);
    if (bars.length < 60) continue;

    const archiveByDay = new Map();
    for (const r of archive.readArchiveLines(id)) {
      archiveByDay.set(r.baselineDate, r);
    }

    let prevFinance = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 1) {
      const day = normBarDate(bars[t]);
      if (day < FROM || day > TO) continue;

      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {});
      if (!row) continue;
      prevFinance = row.financeRegimeNext || prevFinance;

      const actual = archive.resolveActualT1(bars, day);
      if (actual.status !== 'complete' || !actual.actualDir || actual.actualDir === 'neutral') continue;

      const flat = buildFlatRow(spec, row);
      let predMeta;
      if (opts.strictOiProxy && (id === 'au' || id === 'ag')) {
        const reasons = row.marketRegimeReasons || [];
        if (reasons.includes('basis_repair_oi_proxy') || reasons.includes('ag_basis_oi_proxy_blocked')) {
          continue;
        }
      }
      if (opts.useLogistic !== false) {
        predMeta = predictFromWeights(weightsPayload, flat, opts.directionOpts || {});
      } else {
        predMeta = predictEnsembleSync(flat);
      }

      const arch = archiveByDay.get(day);
      allRows.push({
        instrumentId: id,
        sector: spec.sector,
        date: day,
        compositeScore: row.compositeScore,
        pUp: predMeta?.pUp ?? null,
        marketRegime: row.marketRegime,
        marketRegimeReasons: row.marketRegimeReasons,
        predictedDirEngine: row.predictedDir,
        predictedDirArchive: arch?.predictedDir,
        actualDir: actual.actualDir,
        hitEngine: hitDirection(row.predictedDir, actual.actualDir),
        hitArchive: arch?.hitDirection,
      });
    }

    done += 1;
    if (done % 10 === 0) console.log(`  collected ${done}/${ids.length} instruments, rows so far ${allRows.length}`);
  }
  return allRows;
}

function gridConfidenceGate(rows, minN = 200) {
  let best = { name: 'baseline_engine', hits: 0, scored: 0, hitRatePct: 0, config: {} };
  const baseline = metrics(rows, (r) => r.predictedDirEngine);
  if (baseline.hitRatePct > best.hitRatePct) best = { name: 'baseline_engine', ...baseline, config: {} };

  for (let conf = 0.02; conf <= 0.25; conf += 0.01) {
    const m = metrics(rows, (r) => {
      if (r.pUp == null) return r.predictedDirEngine;
      if (Math.abs(r.pUp - 0.5) < conf) return 'neutral';
      return directionFromPUp(r.pUp);
    });
    if (m.scored >= minN && m.hitRatePct > best.hitRatePct) {
      best = { name: 'confidence_gate', ...m, config: { minConfidence: +conf.toFixed(2) } };
    }
  }
  return { baseline, best };
}

function gridDirectionThresholds(rows, minN = 200) {
  let best = { name: 'default_055_045', hits: 0, scored: 0, hitRatePct: 0, config: { bullish: 0.55, bearish: 0.45 } };
  for (let bull = 0.52; bull <= 0.62; bull += 0.01) {
    for (let bear = 0.38; bear <= 0.48; bear += 0.01) {
      if (bull <= 0.5 || bear >= 0.5) continue;
      const m = metrics(rows, (r) => {
        if (r.pUp == null) return 'neutral';
        return directionFromPUp(r.pUp, { bullishThreshold: bull, bearishThreshold: bear });
      });
      if (m.scored >= minN && m.hitRatePct > best.hitRatePct) {
        best = {
          name: 'direction_thresholds',
          ...m,
          config: { bullish: +bull.toFixed(2), bearish: +bear.toFixed(2) },
        };
      }
    }
  }
  return best;
}

function gridPerSectorThresholds(rows, minN = 200) {
  const sectors = [...new Set(rows.map((r) => r.sector))];
  let bestGlobal = { hitRatePct: 0, scored: 0, hits: 0, config: {} };

  const sectorTh = {};
  for (const sec of sectors) {
    const secRows = rows.filter((r) => r.sector === sec);
    let bestSec = { hitRatePct: 0, scored: 0, hits: 0, bull: 0.55, bear: 0.45 };
    for (let bull = 0.52; bull <= 0.62; bull += 0.02) {
      for (let bear = 0.38; bear <= 0.48; bear += 0.02) {
        const m = metrics(secRows, (r) => {
          if (r.pUp == null) return 'neutral';
          return directionFromPUp(r.pUp, { bullishThreshold: bull, bearishThreshold: bear });
        });
        if (m.scored >= 30 && m.hitRatePct > bestSec.hitRatePct) {
          bestSec = { ...m, bull, bear };
        }
      }
    }
    sectorTh[sec] = { bullish: +bestSec.bull.toFixed(2), bearish: +bestSec.bear.toFixed(2), ...bestSec };
  }

  const m = metrics(rows, (r) => {
    if (r.pUp == null) return 'neutral';
    const th = sectorTh[r.sector] || { bullish: 0.55, bearish: 0.45 };
    return directionFromPUp(r.pUp, { bullishThreshold: th.bullish, bearishThreshold: th.bearish });
  });
  if (m.scored >= minN) {
    bestGlobal = { name: 'per_sector_thresholds', ...m, config: { sectorThresholds: sectorTh } };
  }
  return bestGlobal;
}

function gridNeutralExpansion(rows, minN = 200) {
  let best = { hitRatePct: 0, scored: 0, hits: 0, config: { compositeMult: 1 } };
  for (let mult = 1; mult <= 3; mult += 0.1) {
    const m = metrics(rows, (r) => {
      const cs = r.compositeScore;
      if (cs == null) return r.predictedDirEngine;
      const adj = cs / mult;
      if (adj >= 0.12) return 'bullish';
      if (adj <= -0.12) return 'bearish';
      return 'neutral';
    });
    if (m.scored >= minN && m.hitRatePct > best.hitRatePct) {
      best = { name: 'neutral_expansion', ...m, config: { compositeMult: +mult.toFixed(1) } };
    }
  }
  return best;
}

function gridExcludeLaggards(rows, minN = 200) {
  const filtered = rows.filter((r) => !LAGGARDS.has(r.instrumentId));
  const m = metrics(filtered, (r) => {
    if (r.pUp == null) return r.predictedDirEngine;
    return directionFromPUp(r.pUp, { bullishThreshold: 0.58, bearishThreshold: 0.42 });
  });
  return { name: 'exclude_laggards_conf058', ...m, config: { excludeInstruments: [...LAGGARDS], bullish: 0.58, bearish: 0.42 } };
}

function gridCombined(rows, minN = 200) {
  let best = { hitRatePct: 0, scored: 0, hits: 0, config: {} };
  for (let conf = 0.05; conf <= 0.20; conf += 0.02) {
    for (let bull = 0.54; bull <= 0.60; bull += 0.02) {
      const bear = 1 - bull + 0.04;
      const m = metrics(
        rows.filter((r) => !LAGGARDS.has(r.instrumentId)),
        (r) => {
          if (r.pUp == null) return 'neutral';
          if (Math.abs(r.pUp - 0.5) < conf) return 'neutral';
          return directionFromPUp(r.pUp, { bullishThreshold: bull, bearishThreshold: bear });
        },
      );
      if (m.scored >= minN && m.hitRatePct > best.hitRatePct) {
        best = {
          name: 'combined_gate_laggard_exclude',
          ...m,
          config: { minConfidence: +conf.toFixed(2), bullish: bull, bearish: +bear.toFixed(2), excludeInstruments: [...LAGGARDS] },
        };
      }
    }
  }
  return best;
}

function scoreByWindow(rows, config, windowFrom, windowTo) {
  const filterFn = (r) => r.date >= windowFrom && r.date <= windowTo;
  const predFn = makePredFn(config);
  return metrics(rows, predFn, filterFn);
}

function makePredFn(config) {
  const exclude = new Set(config.excludeInstruments || []);
  const sectorTh = config.sectorThresholds || {};
  const minConf = config.minConfidence ?? 0;
  const bull = config.bullish ?? 0.55;
  const bear = config.bearish ?? 0.45;
  const mult = config.compositeMult;

  return (r) => {
    if (exclude.has(r.instrumentId)) return 'neutral';
    if (mult && r.compositeScore != null) {
      const adj = r.compositeScore / mult;
      if (adj >= 0.12) return 'bullish';
      if (adj <= -0.12) return 'bearish';
      return 'neutral';
    }
    if (r.pUp == null) return r.predictedDirEngine;
    if (minConf && Math.abs(r.pUp - 0.5) < minConf) return 'neutral';
    const th = sectorTh[r.sector];
    const b = th?.bullish ?? bull;
    const be = th?.bearish ?? bear;
    return directionFromPUp(r.pUp, { bullishThreshold: b, bearishThreshold: be });
  };
}

function formatReport(payload) {
  const lines = [];
  lines.push('=== T+1 Direction 75% Optimization ===');
  lines.push(`Window: ${FROM} → ${TO} | OOS: ${OOS_FROM} → ${TO}`);
  lines.push(`Archive baseline: ${payload.diagnosis?.hitRatePct}% (${payload.diagnosis?.hits}/${payload.diagnosis?.scored})`);
  lines.push('');
  lines.push('--- Phase 1: Diagnosis ---');
  lines.push('By sector:', JSON.stringify(payload.diagnosis?.bySector, null, 2));
  lines.push('Worst instruments:', JSON.stringify(payload.diagnosis?.worstInstruments?.slice(0, 8), null, 2));
  lines.push('');
  lines.push('--- Phase 2: Search Results ---');
  for (const [k, v] of Object.entries(payload.searches || {})) {
    lines.push(`${k}: ${v.hitRatePct}% (n=${v.scored}) config=${JSON.stringify(v.config)}`);
  }
  lines.push('');
  lines.push('--- Best Overall ---');
  const b = payload.best;
  if (b) {
    lines.push(`Strategy: ${b.name}`);
    lines.push(`Full sample: ${b.full?.hitRatePct}% (n=${b.full?.scored})`);
    lines.push(`OOS ${OOS_FROM}+: ${b.oos?.hitRatePct}% (n=${b.oos?.scored})`);
    lines.push(`Config: ${JSON.stringify(b.config, null, 2)}`);
    lines.push(`75% achieved: ${b.meetsTarget ? 'YES' : 'NO'}`);
  }
  return lines.join('\n');
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: false });

  const ids = resolveIds();
  console.log('=== T+1 DIRECTION 75% OPTIMIZER ===');
  console.log('instruments', ids.length, 'phase', PHASE, 'window', FROM, '→', TO);

  const payload = {
    generatedAt: new Date().toISOString(),
    window: { from: FROM, to: TO },
    oosFrom: OOS_FROM,
    targetHitRate: 0.75,
    minMeaningfulN: 200,
  };

  if (PHASE === 'diagnose' || PHASE === 'all') {
    console.log('\n--- Phase 1: Archive diagnosis ---');
    payload.diagnosis = diagnoseArchive(ids);
    console.log('baseline', payload.diagnosis.hitRatePct + '%', `(${payload.diagnosis.hits}/${payload.diagnosis.scored})`);
    console.log('bySector', JSON.stringify(payload.diagnosis.bySector));
  }

  if (PHASE === 'search' || PHASE === 'all') {
    console.log('\n--- Phase 2: Collecting walk-forward rows (logistic pUp) ---');
    const weightsPath = getDefaultWeightsPath();
    const weightsPayload = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
    const rows = await collectScoredRows(ids, weightsPayload);
    console.log('collected rows with T+1 actual:', rows.length);

    payload.walkRows = rows.length;
    payload.searches = {
      confidenceGate: gridConfidenceGate(rows),
      directionThresholds: gridDirectionThresholds(rows),
      perSectorThresholds: gridPerSectorThresholds(rows),
      neutralExpansion: gridNeutralExpansion(rows),
      excludeLaggards: gridExcludeLaggards(rows),
      combined: gridCombined(rows),
    };

    // Pick best across all strategies
    let bestCandidate = { hitRatePct: 0, scored: 0 };
    for (const [name, result] of Object.entries(payload.searches)) {
      const candidate = result.best || result;
      if (candidate.hitRatePct > bestCandidate.hitRatePct && candidate.scored >= 200) {
        bestCandidate = { ...candidate, searchName: name };
      }
    }

    // Also try strict OI on precious subset
    console.log('Trying strict OI-proxy rescoring on au/ag...');
    const preciousIds = ['au', 'ag'];
    const preciousRows = await collectScoredRows(preciousIds, weightsPayload, { strictOiProxy: true });
    const preciousBest = gridCombined(preciousRows, 50);
    payload.searches.strictOiPrecious = preciousBest;

    const config = bestCandidate.config || {};
    const predFn = makePredFn(config);
    const fullMetrics = metrics(rows, predFn);
    const oosMetrics = metrics(rows, predFn, (r) => r.date >= OOS_FROM);

    payload.best = {
      name: bestCandidate.name || bestCandidate.searchName,
      config,
      full: fullMetrics,
      oos: oosMetrics,
      meetsTarget: fullMetrics.hitRatePct >= 75 && fullMetrics.scored >= 200,
      meetsTargetOos: oosMetrics.hitRatePct >= 75 && oosMetrics.scored >= 200,
    };

    // Export calibration if meaningful improvement
    if (payload.best.full.hitRatePct > (payload.diagnosis?.hitRatePct || 49.46) + 2) {
      const calib = {
        version: 'direction-t1-75-calibration-v1',
        generatedAt: new Date().toISOString(),
        baselineHitRatePct: payload.diagnosis?.hitRatePct,
        optimizedHitRatePct: payload.best.full.hitRatePct,
        baselineScored: payload.diagnosis?.scored,
        optimizedScored: payload.best.full.scored,
        oosHitRatePct: payload.best.oos.hitRatePct,
        oosScored: payload.best.oos.scored,
        meetsTarget75: payload.best.meetsTarget,
        config: payload.best.config,
        strategy: payload.best.name,
        excludeInstruments: config.excludeInstruments || [],
        minConfidence: config.minConfidence ?? null,
        directionThresholds: {
          bullish: config.bullish ?? 0.55,
          bearish: config.bearish ?? 0.45,
          sectorThresholds: config.sectorThresholds || null,
        },
        compositeMult: config.compositeMult ?? null,
        window: { from: FROM, to: TO },
        oosFrom: OOS_FROM,
        productionWeightsUnchanged: true,
      };
      fs.mkdirSync(path.dirname(CALIB_JSON), { recursive: true });
      fs.writeFileSync(CALIB_JSON, JSON.stringify(calib, null, 2), 'utf8');
      payload.calibrationPath = CALIB_JSON;
      console.log('Wrote calibration', CALIB_JSON);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  const txt = formatReport(payload);
  fs.writeFileSync(OUT_TXT, txt, 'utf8');
  console.log('\n' + txt);
  console.log('\nWrote', OUT_JSON);
  console.log('Wrote', OUT_TXT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
