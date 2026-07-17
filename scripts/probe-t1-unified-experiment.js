/**
 * T+1 unified experiment probe — all instruments, production vs experiment weights.
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/probe-t1-unified-experiment.js
 *   ... --oos-from 2023-01-01 --oos-to 2025-12-31
 *   ... --weights-only production|experiment|both
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { getAllCommodities } = require('../services/commodities-catalog');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { hitDirection } = require('../services/outlook-labels');
const { predictFromWeights, directionFromPUp } = require('../services/outlook-onnx-runner');
const directionT1Scoring = require('../services/direction-t1-scoring');
const t1Config = require('../services/t1-unified-config');
const { loadOverrides } = require('../services/basis-regime-overrides');
const philosophyFilter = require('../services/philosophy-direction-filter');

const OUT_DIR = path.join(process.cwd(), 'data', 'exports');
const OUT_JSON = path.join(OUT_DIR, 't1-unified-probe-report.json');
const OUT_TXT = path.join(process.cwd(), '_t1-unified-probe-out.txt');

const WR_SKIP = new Set(['wr']);

function parseArgs(config) {
  const args = process.argv.slice(2);
  let from = config.train.from;
  let to = config.oos.to;
  let oosFrom = config.oos.from;
  let oosTo = config.oos.to;
  let weightsOnly = 'both';
  let oosOnly = false;
  let sector = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--from' && args[i + 1]) { from = args[++i]; continue; }
    if (args[i] === '--to' && args[i + 1]) { to = args[++i]; continue; }
    if (args[i] === '--oos-from' && args[i + 1]) { oosFrom = args[++i]; continue; }
    if (args[i] === '--oos-to' && args[i + 1]) { oosTo = args[++i]; continue; }
    if (args[i] === '--weights-only' && args[i + 1]) { weightsOnly = args[++i]; continue; }
    if (args[i] === '--oos-only') { oosOnly = true; continue; }
    if (args[i] === '--sector' && args[i + 1]) { sector = args[++i]; continue; }
  }
  if (oosOnly) {
    from = oosFrom;
    to = oosTo;
  }
  return { from, to, oosFrom, oosTo, weightsOnly, oosOnly, sector };
}

function findSpec(id) {
  return INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === String(id).toLowerCase());
}

function isActiveInstrument(bars) {
  if (!bars?.length) return false;
  return bars.slice(-20).some((b) => (b.volume ?? b.vol ?? 0) > 0);
}

function resolveIds(sectorFilter = null) {
  return getAllCommodities()
    .map((m) => String(m.id))
    .filter((id) => {
      if (WR_SKIP.has(id.toLowerCase()) || !findSpec(id)) return false;
      if (sectorFilter && findSpec(id)?.sector !== sectorFilter) return false;
      const bars = loadBars(id);
      return bars.length >= 62 && isActiveInstrument(bars);
    });
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

function buildFlatRow(spec, row) {
  const whChg = philosophyFilter.isEnabled()
    ? philosophyFilter.scaleWarehouseFeature(row.warehouseReceipt_chg_5d, row.philosophyFilter)
    : row.warehouseReceipt_chg_5d;
  return {
    instrumentId: spec.id,
    philosophyScore: row.philosophyScore,
    factorComposite: row.factorComposite,
    adaptiveScore: row.adaptiveScore,
    real10y_chg_5d: row.real10y_chg_5d,
    warehouseReceipt_chg_5d: whChg,
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

function pct(h, s) {
  return s ? +((h / s) * 100).toFixed(2) : null;
}

function scoreRows(scoredRows, calib) {
  let rawHits = 0;
  let rawScored = 0;
  let gatedHits = 0;
  let gatedScored = 0;

  for (const r of scoredRows) {
    if (!r.pred || r.pred === 'neutral' || !r.actualDir || r.actualDir === 'neutral') continue;
    rawScored += 1;
    if (hitDirection(r.pred, r.actualDir)) rawHits += 1;

    const gateRow = {
      instrumentId: r.instrumentId,
      sector: r.sector,
      pUp: r.pUp,
      logisticPUp: r.pUp,
      compositeScore: r.compositeScore,
      predictedDir: r.pred,
    };
    if (!directionT1Scoring.passesConfidenceGate(gateRow, calib)) continue;
    gatedScored += 1;
    if (hitDirection(r.pred, r.actualDir)) gatedHits += 1;
  }

  return {
    raw: { hits: rawHits, scored: rawScored, hitRatePct: pct(rawHits, rawScored) },
    gated: { hits: gatedHits, scored: gatedScored, hitRatePct: pct(gatedHits, gatedScored) },
  };
}

function aggregateBySector(perInstrument) {
  const bySector = {};
  for (const row of perInstrument) {
    const sec = row.sector || 'unknown';
    if (!bySector[sec]) {
      bySector[sec] = { rawHits: 0, rawScored: 0, gatedHits: 0, gatedScored: 0, instruments: 0 };
    }
    bySector[sec].instruments += 1;
    bySector[sec].rawHits += row.raw.hits;
    bySector[sec].rawScored += row.raw.scored;
    bySector[sec].gatedHits += row.gated.hits;
    bySector[sec].gatedScored += row.gated.scored;
  }
  for (const sec of Object.keys(bySector)) {
    const s = bySector[sec];
    s.rawHitRatePct = pct(s.rawHits, s.rawScored);
    s.gatedHitRatePct = pct(s.gatedHits, s.gatedScored);
  }
  return bySector;
}

function coverageFromDual(prodScored, expScored, labelRows) {
  const countDir = (rows) => {
    let directional = 0;
    let neutral = 0;
    for (const r of rows) {
      if (!r.pred || r.pred === 'neutral') neutral += 1;
      else directional += 1;
    }
    return { directional, neutral, total: rows.length };
  };
  return {
    labelRows,
    production: countDir(prodScored),
    experiment: expScored ? countDir(expScored) : null,
  };
}

async function collectScoredRowsDual(ids, prodWeights, expWeights, window) {
  const weights = calibration.getCompositeWeights();
  const prodScored = [];
  const expScored = expWeights ? [] : null;
  let labelRows = 0;
  let done = 0;

  for (const id of ids) {
    const spec = findSpec(id);
    const bars = loadBars(id);
    if (bars.length < 62) continue;

    let prevFinance = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 1) {
      const day = normBarDate(bars[t]);
      if (day < window.from || day > window.to) continue;

      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {
        philosophyFilterV2: philosophyFilter.isEnabled(),
      });
      if (!row) continue;
      prevFinance = row.financeRegimeNext || prevFinance;

      if (!row.actualDir || row.actualDir === 'neutral') continue;
      labelRows += 1;

      const flat = buildFlatRow(spec, row);
      const base = {
        instrumentId: id,
        sector: spec.sector,
        date: day,
        actualDir: row.actualDir,
        compositeScore: row.factorComposite ?? row.adaptiveScore,
        oos: day >= window.oosFrom && day <= window.oosTo,
      };

      const prodMeta = predictFromWeights(prodWeights, flat);
      if (prodMeta?.pUp != null) {
        prodScored.push({ ...base, pred: prodMeta.direction, pUp: prodMeta.pUp });
      }
      if (expScored) {
        const expMeta = predictFromWeights(expWeights, flat);
        if (expMeta?.pUp != null) {
          expScored.push({ ...base, pred: expMeta.direction, pUp: expMeta.pUp });
        }
      }
    }
    done += 1;
    if (done % 10 === 0) console.log(`walk-forward ${done}/${ids.length} instruments...`);
  }
  return {
    prodScored,
    expScored,
    coverage: coverageFromDual(prodScored, expScored, labelRows),
  };
}

function summarize(allScored, calib, filterFn = null) {
  const filtered = filterFn ? allScored.filter(filterFn) : allScored;
  const overall = scoreRows(filtered, calib);

  const byInstrument = {};
  for (const r of filtered) {
    if (!byInstrument[r.instrumentId]) {
      byInstrument[r.instrumentId] = { sector: r.sector, rows: [] };
    }
    byInstrument[r.instrumentId].rows.push(r);
  }

  const perInstrument = Object.entries(byInstrument).map(([instrumentId, { sector, rows }]) => {
    const m = scoreRows(rows, calib);
    return { instrumentId, sector, ...m };
  });

  const auAgRows = filtered.filter((r) => r.instrumentId === 'au' || r.instrumentId === 'ag');
  const auAg = scoreRows(auAgRows, calib);

  return {
    overall,
    auAg,
    bySector: aggregateBySector(perInstrument),
    perInstrument: perInstrument.sort((a, b) => (a.raw.hitRatePct ?? 0) - (b.raw.hitRatePct ?? 0)),
    instrumentCount: perInstrument.length,
  };
}

function compareModels(prod, exp) {
  const delta = (a, b) =>
    a != null && b != null ? +(b - a).toFixed(2) : null;
  return {
    rawOverallPp: delta(prod.overall.raw.hitRatePct, exp.overall.raw.hitRatePct),
    gatedOverallPp: delta(prod.overall.gated.hitRatePct, exp.overall.gated.hitRatePct),
    gatedAuAgPp: delta(prod.auAg.gated.hitRatePct, exp.auAg.gated.hitRatePct),
    oosRawOverallPp: delta(prod.oos?.overall.raw.hitRatePct, exp.oos?.overall.raw.hitRatePct),
    oosGatedOverallPp: delta(prod.oos?.overall.gated.hitRatePct, exp.oos?.overall.gated.hitRatePct),
  };
}

function checkGate(summary, config) {
  const baselines = config.scoring?.baselines || {};
  const minN = config.scoring?.gateMinScored ?? 200;
  const beatPp = config.scoring?.gateBeatBaselinePp ?? 2;
  const target = config.scoring?.targetHitRatePct ?? 75;

  const oos = summary.oos?.overall?.raw;
  const oosAuAg = summary.oos?.auAg?.gated;

  const beatRaw =
    oos?.hitRatePct != null &&
    oos.scored >= minN &&
    oos.hitRatePct >= (baselines.t1RawOverallPct ?? 52.11) + beatPp;

  const reach75 = oos?.hitRatePct != null && oos.scored >= minN && oos.hitRatePct >= target;

  const beatAuAg =
    oosAuAg?.hitRatePct != null &&
    oosAuAg.scored >= 100 &&
    oosAuAg.hitRatePct >= (baselines.t1GatedAuAgPct ?? 54.28) + beatPp;

  return { passed: beatRaw || reach75 || beatAuAg, beatRaw, reach75, beatAuAg };
}

function formatReport(payload) {
  const lines = [];
  lines.push('=== T+1 Unified Experiment Probe ===');
  lines.push(`Window full: ${payload.window.from} → ${payload.window.to}`);
  lines.push(`OOS: ${payload.window.oosFrom} → ${payload.window.oosTo}`);
  lines.push(`Instruments: ${payload.instrumentCount}`);
  lines.push('');
  lines.push('--- Production v1.34.8 ---');
  lines.push(`Full raw: ${payload.production.full.overall.raw.hitRatePct}% (n=${payload.production.full.overall.raw.scored})`);
  lines.push(`Full gated: ${payload.production.full.overall.gated.hitRatePct}% (n=${payload.production.full.overall.gated.scored})`);
  lines.push(`OOS raw: ${payload.production.oos.overall.raw.hitRatePct}% (n=${payload.production.oos.overall.raw.scored})`);
  lines.push(`OOS gated: ${payload.production.oos.overall.gated.hitRatePct}% (n=${payload.production.oos.overall.gated.scored})`);
  lines.push(`OOS au+ag gated: ${payload.production.oos.auAg.gated.hitRatePct}% (n=${payload.production.oos.auAg.gated.scored})`);
  if (payload.experiment) {
    lines.push('');
    lines.push('--- Experiment t1-unified ---');
    lines.push(`Train scope: ${(payload.trainingInstruments || ['au', 'ag']).join('+')}`);
    lines.push(`Full raw: ${payload.experiment.full.overall.raw.hitRatePct}% (n=${payload.experiment.full.overall.raw.scored})`);
    lines.push(`OOS raw: ${payload.experiment.oos.overall.raw.hitRatePct}% (n=${payload.experiment.oos.overall.raw.scored})`);
    if (payload.experiment.trainingScope?.oos) {
      const ts = payload.experiment.trainingScope.oos.overall.raw;
      lines.push(`OOS raw (train scope): ${ts.hitRatePct}% (n=${ts.scored})`);
    }
    lines.push(`OOS au+ag gated: ${payload.experiment.oos.auAg.gated.hitRatePct}% (n=${payload.experiment.oos.auAg.gated.scored})`);
    if (payload.coverage?.experiment) {
      const c = payload.coverage.experiment;
      const pct = c.total ? +((c.directional / c.total) * 100).toFixed(1) : null;
      lines.push(`Directional rate (all rows w/ label): ${pct}% (${c.directional}/${c.total})`);
    }
    lines.push('');
    lines.push('--- Delta (experiment − production) ---');
    lines.push(JSON.stringify(payload.comparison, null, 2));
  }
  lines.push('');
  lines.push(`Gate: ${payload.gate?.passed ? 'PASS' : 'FAIL'}`);
  lines.push(`Deploy: ${payload.deployRecommendation}`);
  return lines.join('\n');
}

async function main() {
  const config = t1Config.loadConfig();
  t1Config.applyRegimeEnv(config);
  if (config.regime?.useBasisRegimeOverrides) loadOverrides(true);

  const window = parseArgs(config);
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const ids = resolveIds(window.sector);
  console.log('=== T+1 UNIFIED PROBE ===', ids.length, 'instruments');
  if (philosophyFilter.isEnabled()) {
    console.log(`PHILOSOPHY_FILTER_V2=1 (${philosophyFilter.FILTER_VERSION}) — warehouse mask + filter gate active`);
  }

  const prodPath = t1Config.getProductionWeightsPath();
  const expPath = t1Config.getExperimentWeightsPath();
  if (!fs.existsSync(prodPath)) throw new Error(`missing production weights: ${prodPath}`);

  const prodWeights = JSON.parse(fs.readFileSync(prodPath, 'utf8'));
  let expWeights = null;
  if (window.weightsOnly !== 'production' && fs.existsSync(expPath)) {
    expWeights = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  } else if (window.weightsOnly !== 'production') {
    console.warn('Experiment weights not found — run train-outlook-logistic-t1-unified.js first');
  }

  const trainingInstruments = config.trainHyperparams?.instruments || ['au', 'ag'];
  const trainingScope = new Set(trainingInstruments.map((id) => String(id).toLowerCase()));
  const inTrainingScope = (r) => trainingScope.has(String(r.instrumentId).toLowerCase());

  const { prodScored, expScored, coverage } = await collectScoredRowsDual(ids, prodWeights, expWeights, window);
  console.log('scored rows production:', prodScored.length, expScored ? `experiment: ${expScored.length}` : '');

  const calib = directionT1Scoring.loadCalibration();
  const prodFull = summarize(prodScored, calib);
  const prodOos = summarize(prodScored, calib, (r) => r.oos);
  const prodTrainingScope = summarize(prodScored, calib, (r) => inTrainingScope(r));

  const payload = {
    generatedAt: new Date().toISOString(),
    horizon: 1,
    unifiedConfig: t1Config.getConfigPath(),
    trainingInstruments,
    window,
    instrumentCount: ids.length,
    coverage,
    production: {
      weightsPath: prodPath,
      version: prodWeights.version,
      full: prodFull,
      oos: prodOos,
      trainingScope: {
        full: prodTrainingScope,
        oos: summarize(prodScored, calib, (r) => r.oos && inTrainingScope(r)),
      },
    },
    experiment: null,
    comparison: null,
    gate: null,
    deployRecommendation: 'Await experiment weights',
  };

  if (expScored) {
    const expFull = summarize(expScored, calib);
    const expOos = summarize(expScored, calib, (r) => r.oos);
    payload.experiment = {
      weightsPath: expPath,
      version: expWeights.version,
      trainedInstruments: expWeights.instruments || trainingInstruments,
      full: expFull,
      oos: expOos,
      trainingScope: {
        full: summarize(expScored, calib, inTrainingScope),
        oos: summarize(expScored, calib, (r) => r.oos && inTrainingScope(r)),
      },
    };
    payload.comparison = compareModels(
      { overall: prodOos.overall, auAg: prodOos.auAg, oos: prodOos },
      { overall: expOos.overall, auAg: expOos.auAg, oos: expOos },
    );
    payload.gate = checkGate({ oos: expOos }, config);
    payload.deployRecommendation = payload.gate.passed
      ? 'EXPERIMENT_PASSED — document deploy steps; do NOT overwrite production v1.34.8 without explicit approval'
      : 'GATE_FAIL — keep production v1.34.8';
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  const txt = formatReport(payload);
  fs.writeFileSync(OUT_TXT, txt, 'utf8');
  console.log(txt);
  console.log('\nWrote', OUT_JSON);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
