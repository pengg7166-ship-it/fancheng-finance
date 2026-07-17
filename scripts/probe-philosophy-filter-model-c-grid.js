/**
 * Step 6 — Model C intersection KPI walk-forward threshold grid.
 *
 * Grid: philosophy divergence (N × threshold) × flow thresholds × optional pricedIn alpha.
 * Instruments: au, ag, cu, rb · OOS 2023-01-01 → 2025-12-31
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/probe-philosophy-filter-model-c-grid.js
 *   ... --quick          # smaller grid for smoke test
 *   ... --include-alpha  # add PHILOSOPHY_PRICED_IN_ALPHA variants
 *   ... --relaxed        # N5/T4 + relaxed flow vol/oi grid
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';
process.env.PHILOSOPHY_FILTER_V2 = '1';
process.env.MODEL_C_V2 = '1';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const calibration = require('../services/commodity-outlook-calibration');
const philosophyFilter = require('../services/philosophy-direction-filter');
const modelCGate = require('../services/model-c-intersection-gate');
const directionModel = require('../services/direction-model-v2');
const { computeOiBehaviorAtBar } = require('../services/oi-behavior-features');
const { hitDirection } = require('../services/outlook-labels');

const PROBE_IDS = ['au', 'ag', 'cu', 'rb'];
const PRECIOUS_IDS = new Set(['au', 'ag']);
const FROM = '2023-01-01';
const TO = '2025-12-31';
const DEFAULT_OUT_TXT = '_probe-model-c-grid-run.txt';
const DEFAULT_OUT_JSON = '_probe-model-c-grid-out.json';
const RELAXED_OUT_TXT = '_probe-model-c-grid-relaxed-run.txt';
const RELAXED_OUT_JSON = '_probe-model-c-grid-relaxed-out.json';
let OUT_TXT = path.join(process.cwd(), DEFAULT_OUT_TXT);
let OUT_JSON = path.join(process.cwd(), DEFAULT_OUT_JSON);

const GATE_MIN_HIT_PCT = 75;
const GATE_MIN_INTERSECTION_N = 40;
const PHILOSOPHY_CONF_BASE_SCALE = 0.5;
const PHILOSOPHY_DIR_THRESHOLD = 0.12;
const DIVERGENCE_NS = [3, 5, 7];

const FULL_GRID = {
  divergenceLookbackN: [3, 5, 7],
  divergenceThreshold: [3, 4, 5],
  flowMinVolRatio: [1.1, 1.15, 1.2],
  flowMinOiChgPct: [0.06, 0.08, 0.1],
  pricedInAlpha: [1.0],
};

const RELAXED_GRID = {
  divergenceLookbackN: [5],
  divergenceThreshold: [4],
  flowMinVolRatio: [0.7, 0.8, 0.9, 1.0, 1.05, 1.1],
  flowMinOiChgPct: [0.02, 0.03, 0.04, 0.05, 0.06],
  pricedInAlpha: [1.0],
};

const QUICK_GRID = {
  divergenceLookbackN: [3, 5, 7],
  divergenceThreshold: [3, 4, 5],
  flowMinVolRatio: [1.15],
  flowMinOiChgPct: [0.08],
  pricedInAlpha: [1.0],
};

const ALPHA_VARIANTS = [1.0, 1.25, 1.5];

function parseArgs() {
  const args = process.argv.slice(2);
  let from = FROM;
  let to = TO;
  let quick = false;
  let includeAlpha = false;
  let relaxed = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--from' && args[i + 1]) from = args[++i];
    else if (args[i] === '--to' && args[i + 1]) to = args[++i];
    else if (args[i] === '--quick') quick = true;
    else if (args[i] === '--include-alpha') includeAlpha = true;
    else if (args[i] === '--relaxed') relaxed = true;
  }
  return { from, to, quick, includeAlpha, relaxed };
}

function buildGrid(quick, includeAlpha, relaxed) {
  const base = relaxed ? RELAXED_GRID : quick ? QUICK_GRID : FULL_GRID;
  const alphas = includeAlpha ? ALPHA_VARIANTS : base.pricedInAlpha;
  const combos = [];
  for (const lookbackN of base.divergenceLookbackN) {
    for (const threshold of base.divergenceThreshold) {
      if (threshold > lookbackN) continue;
      for (const flowMinVolRatio of base.flowMinVolRatio) {
        for (const flowMinOiChgPct of base.flowMinOiChgPct) {
          for (const pricedInAlpha of alphas) {
            combos.push({
              divergenceLookbackN: lookbackN,
              divergenceThreshold: threshold,
              flowMinVolRatio,
              flowMinOiChgPct,
              pricedInAlpha,
            });
          }
        }
      }
    }
  }
  return combos;
}

function comboKey(combo) {
  return [
    `N${combo.divergenceLookbackN}`,
    `T${combo.divergenceThreshold}`,
    `vol${combo.flowMinVolRatio}`,
    `oi${combo.flowMinOiChgPct}`,
    `a${combo.pricedInAlpha}`,
  ].join('_');
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadBars(id) {
  const fp = path.join(getDataDir(), 'history', 'trading', `${id}.json`);
  if (!fs.existsSync(fp)) return [];
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return (Array.isArray(raw) ? raw : raw.series || [])
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function findSpec(id) {
  return INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === String(id).toLowerCase());
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function scoreToPhilosophyDir(score) {
  const s = Number(score);
  if (Number.isNaN(s)) return 0;
  if (s >= PHILOSOPHY_DIR_THRESHOLD) return 1;
  if (s <= -PHILOSOPHY_DIR_THRESHOLD) return -1;
  return 0;
}

function dirToLabel(d) {
  if (d === 1) return 'bullish';
  if (d === -1) return 'bearish';
  return 'neutral';
}

function signDir(n) {
  if (n == null || Number.isNaN(Number(n)) || Number(n) === 0) return 0;
  return Number(n) > 0 ? 1 : -1;
}

function dirLabelToSign(label) {
  if (label === 'bullish') return 1;
  if (label === 'bearish') return -1;
  return 0;
}

function countPhilosophyDivergence(bars, barIndex, philosophyDir, lookbackN) {
  if (!bars?.length || philosophyDir === 0 || barIndex < 1) return 0;
  let count = 0;
  const start = Math.max(1, barIndex - lookbackN + 1);
  for (let i = start; i <= barIndex; i += 1) {
    const cur = Number(bars[i]?.close);
    const prev = Number(bars[i - 1]?.close);
    if (!cur || !prev) continue;
    const actualDir = cur > prev ? 1 : cur < prev ? -1 : 0;
    if (actualDir !== 0 && actualDir !== philosophyDir) count += 1;
  }
  return count;
}

function emptyKpiBucket() {
  return { scored: 0, hits: 0, hitRate: null, passOrSignal: 0, totalDays: 0 };
}

function bumpKpi(bucket, predictedDir, actualDir, signalEligible) {
  bucket.totalDays += 1;
  if (signalEligible) bucket.passOrSignal += 1;
  if (!predictedDir || predictedDir === 'neutral' || !actualDir) return;
  bucket.scored += 1;
  if (hitDirection(predictedDir, actualDir)) bucket.hits += 1;
}

function finalizeKpi(bucket) {
  bucket.hitRate = bucket.scored ? +((bucket.hits / bucket.scored) * 100).toFixed(2) : null;
  bucket.signalRatePct = bucket.totalDays
    ? +((bucket.passOrSignal / bucket.totalDays) * 100).toFixed(2)
    : null;
  return bucket;
}

/** One expensive pass: cache bar-level inputs for fast threshold sweeps. */
function collectBarArtifacts(spec, bars, window) {
  const weights = calibration.getCompositeWeights();
  let prevFinance = 'neutral';
  const artifacts = [];

  for (let t = 60; t < bars.length - 1; t += 1) {
    const day = normBarDate(bars[t]);
    if (day < window.from || day > window.to) continue;

    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {
      philosophyFilterV2: true,
      modelCV2: true,
    });
    if (!row?.philosophyFilter) continue;
    prevFinance = row.financeRegimeNext || prevFinance;

    const compositeScore = Number(row.philosophyScore ?? 0);
    const rawPhilosophyDir = scoreToPhilosophyDir(compositeScore);
    const divergenceByN = {};
    for (const n of DIVERGENCE_NS) {
      divergenceByN[n] = countPhilosophyDivergence(bars, t, rawPhilosophyDir, n);
    }

    const f = row.philosophyFilter;
    const dirModel =
      row.modelC?.dirModel ||
      directionModel.predictDirectionModel(row, { philosophyFilterV2: true });

    const beh = computeOiBehaviorAtBar(bars, t) || {};
    const oiChgDir = signDir(beh.oi_change);
    const flow = row.modelC?.flowModel || {};
    const volRatio = flow.volumeRatio != null ? Number(flow.volumeRatio) : null;
    const oiChgPct = Math.abs(Number(beh.oi_change_pct ?? 0));

    artifacts.push({
      actualDir: row.actualDir,
      compositeScore,
      rawPhilosophyDir,
      divergenceByN,
      pricedInScore: f.pricedIn?.score ?? 0,
      pricedInMode: f.pricedIn?.mode ?? 'none',
      eventPullbackGate: Boolean(f.eventPlaybook?.rules?.includes('pullback_neutral_gate')),
      policyDirectionHint: f.policyPlaybook?.applied ? f.policyPlaybook.directionHint || null : null,
      crossMarketConflictEligible: Boolean(
        f.sectorPlaybook?.applied &&
          f.sectorPlaybook.crossMarketLead &&
          (f.pricedIn?.components?.priceCross ?? 0) >= 0.75 &&
          f.pricedIn?.mode !== 'none',
      ),
      dirModelDirection: dirModel.direction || 'neutral',
      oiChgDir,
      volRatio,
      oiChgPct,
    });
  }

  return artifacts;
}

function resolveFilterPass(artifact, combo) {
  const minConf = parseFloat(process.env.PHILOSOPHY_MIN_CONFIDENCE || '0.12');
  const { rawPhilosophyDir, divergenceByN, pricedInScore, pricedInMode } = artifact;

  let filterPass = true;
  if (rawPhilosophyDir === 0) filterPass = false;

  const divergenceCount = divergenceByN[combo.divergenceLookbackN] ?? 0;
  if (divergenceCount >= combo.divergenceThreshold) filterPass = false;

  const damp = Math.pow(1 - pricedInScore, combo.pricedInAlpha);
  const adjustedScore = artifact.compositeScore * damp;
  let effectivePhilosophyDir = scoreToPhilosophyDir(adjustedScore);
  const philosophyConfidence = +(
    clamp(Math.abs(artifact.compositeScore) / PHILOSOPHY_CONF_BASE_SCALE, 0, 1) * damp
  ).toFixed(4);

  if (artifact.eventPullbackGate) {
    filterPass = false;
    effectivePhilosophyDir = 0;
  }

  if (artifact.policyDirectionHint && artifact.policyDirectionHint !== 'neutral') {
    const hintDir = artifact.policyDirectionHint === 'bullish' ? 1 : -1;
    if (hintDir !== 0 && effectivePhilosophyDir !== 0 && hintDir !== effectivePhilosophyDir) {
      const adjConf = +((philosophyConfidence ?? 0) * 0.75).toFixed(4);
      if (adjConf < minConf) filterPass = false;
    }
  }

  if (
    artifact.crossMarketConflictEligible &&
    effectivePhilosophyDir !== 0 &&
    philosophyConfidence < 0.25
  ) {
    filterPass = false;
  }

  if (pricedInMode === 'full' && effectivePhilosophyDir !== 0) {
    filterPass = false;
  }

  if (philosophyConfidence < minConf && filterPass && effectivePhilosophyDir !== 0) {
    filterPass = false;
  }

  if (effectivePhilosophyDir === 0 && filterPass) {
    filterPass = false;
  }

  return { filterPass, effectivePhilosophyDir, philosophyConfidence };
}

function evaluateFlowSignal(artifact, combo, effectivePhilosophyDir) {
  const philDir = signDir(effectivePhilosophyDir);
  const oiAligned = philDir !== 0 && artifact.oiChgDir === philDir;
  const volumeAbove = artifact.volRatio != null && artifact.volRatio >= combo.flowMinVolRatio;
  const oiMagnitudeOk = artifact.oiChgPct >= combo.flowMinOiChgPct;
  const validFundSignal = Boolean(oiAligned && volumeAbove && oiMagnitudeOk);
  const flowDirection =
    artifact.oiChgDir === 1 ? 'bullish' : artifact.oiChgDir === -1 ? 'bearish' : 'neutral';
  return { validFundSignal, flowDirection };
}

function evaluateIntersection(artifact, combo) {
  const { filterPass, effectivePhilosophyDir } = resolveFilterPass(artifact, combo);
  const philSign = signDir(effectivePhilosophyDir);
  const philLabel = dirToLabel(effectivePhilosophyDir);
  const dirSign = dirLabelToSign(artifact.dirModelDirection);
  const { validFundSignal, flowDirection } = evaluateFlowSignal(artifact, combo, effectivePhilosophyDir);
  const flowSign = dirLabelToSign(flowDirection);

  const sameSign =
    philSign !== 0 && dirSign === philSign && flowSign === philSign && validFundSignal;
  const intersectionPass = Boolean(filterPass && sameSign);

  const filterDir = filterPass && philSign !== 0 ? philLabel : 'neutral';
  const interPred = intersectionPass ? philLabel : 'neutral';

  return { filterDir, interPred, filterPass, intersectionPass };
}

function evaluateCombo(combo, preparedArtifacts) {
  const perInstrument = preparedArtifacts.map(({ instrumentId, artifacts }) => {
    const kpi = { filter: emptyKpiBucket(), intersection: emptyKpiBucket() };
    for (const a of artifacts) {
      const ev = evaluateIntersection(a, combo);
      bumpKpi(kpi.filter, ev.filterDir, a.actualDir, ev.filterPass);
      bumpKpi(kpi.intersection, ev.interPred, a.actualDir, ev.intersectionPass);
    }
    finalizeKpi(kpi.filter);
    finalizeKpi(kpi.intersection);
    return { instrumentId, ...kpi };
  });

  const aggregateLane = (key) => {
    const agg = emptyKpiBucket();
    for (const inst of perInstrument) {
      const b = inst[key];
      agg.scored += b.scored;
      agg.hits += b.hits;
      agg.passOrSignal += b.passOrSignal;
      agg.totalDays += b.totalDays;
    }
    return finalizeKpi(agg);
  };

  const aggregate = {
    filter: aggregateLane('filter'),
    intersection: aggregateLane('intersection'),
  };

  const preciousSubset = perInstrument.filter((p) => PRECIOUS_IDS.has(p.instrumentId));
  const preciousAgg = emptyKpiBucket();
  for (const inst of preciousSubset) {
    const b = inst.intersection;
    preciousAgg.scored += b.scored;
    preciousAgg.hits += b.hits;
    preciousAgg.passOrSignal += b.passOrSignal;
    preciousAgg.totalDays += b.totalDays;
  }
  finalizeKpi(preciousAgg);

  const gatePass =
    aggregate.intersection.scored >= GATE_MIN_INTERSECTION_N &&
    aggregate.intersection.hitRate != null &&
    aggregate.intersection.hitRate >= GATE_MIN_HIT_PCT;

  return {
    key: comboKey(combo),
    params: combo,
    perInstrument: perInstrument.map((p) => ({
      instrumentId: p.instrumentId,
      filterPassPct: p.filter.signalRatePct,
      filterScored: p.filter.scored,
      intersectionN: p.intersection.scored,
      intersectionHitPct: p.intersection.hitRate,
      intersectionSignalPct: p.intersection.signalRatePct,
    })),
    aggregate: {
      filterPassPct: aggregate.filter.signalRatePct,
      filterScored: aggregate.filter.scored,
      intersectionN: aggregate.intersection.scored,
      intersectionHitPct: aggregate.intersection.hitRate,
      intersectionSignalPct: aggregate.intersection.signalRatePct,
    },
    precious: {
      intersectionN: preciousAgg.scored,
      intersectionHitPct: preciousAgg.hitRate,
      intersectionSignalPct: preciousAgg.signalRatePct,
    },
    gatePass,
  };
}

function isParetoOptimal(results, idx) {
  const a = results[idx];
  const hit = a.aggregate.intersectionHitPct ?? -1;
  const n = a.aggregate.intersectionN;
  for (let j = 0; j < results.length; j += 1) {
    if (j === idx) continue;
    const b = results[j];
    const bHit = b.aggregate.intersectionHitPct ?? -1;
    const bN = b.aggregate.intersectionN;
    if (bN >= n && bHit >= hit && (bN > n || bHit > hit)) return false;
  }
  return true;
}


function bestMaxNAtMinHit(results, minHitPct) {
  const eligible = results.filter(
    (r) => r.aggregate.intersectionHitPct != null && r.aggregate.intersectionHitPct >= minHitPct,
  );
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => {
    const nDiff = b.aggregate.intersectionN - a.aggregate.intersectionN;
    if (nDiff !== 0) return nDiff;
    return (b.aggregate.intersectionHitPct ?? -1) - (a.aggregate.intersectionHitPct ?? -1);
  })[0];
}

function rankResults(results) {
  const gatePassers = results.filter((r) => r.gatePass);
  const nEligible = results.filter((r) => r.aggregate.intersectionN >= GATE_MIN_INTERSECTION_N);
  const bestParetoN40 = nEligible.length
    ? [...nEligible].sort((a, b) => {
        const hitDiff =
          (b.aggregate.intersectionHitPct ?? -1) - (a.aggregate.intersectionHitPct ?? -1);
        if (hitDiff !== 0) return hitDiff;
        return b.aggregate.intersectionN - a.aggregate.intersectionN;
      })[0]
    : null;

  const bestHitAnyN = [...results].sort(
    (a, b) => (b.aggregate.intersectionHitPct ?? -1) - (a.aggregate.intersectionHitPct ?? -1),
  )[0];

  const bestNAnyHit = [...results].sort(
    (a, b) => b.aggregate.intersectionN - a.aggregate.intersectionN,
  )[0];

  const paretoFront = results
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => isParetoOptimal(results, i))
    .map(({ r }) => r)
    .sort((a, b) => {
      const hitDiff =
        (b.aggregate.intersectionHitPct ?? -1) - (a.aggregate.intersectionHitPct ?? -1);
      if (hitDiff !== 0) return hitDiff;
      return b.aggregate.intersectionN - a.aggregate.intersectionN;
    });

  const relaxedTradeoff = {
    minHit60: bestMaxNAtMinHit(results, 60),
    minHit65: bestMaxNAtMinHit(results, 65),
    minHit70: bestMaxNAtMinHit(results, 70),
  };
  return { gatePassers, bestParetoN40, bestHitAnyN, bestNAnyHit, paretoFront, relaxedTradeoff };
}

function formatEnvRecommendation(combo) {
  return {
    PHILOSOPHY_FILTER_V2: '1',
    MODEL_C_V2: '1',
    PHILOSOPHY_DIVERGENCE_LOOKBACK_N: String(combo.divergenceLookbackN),
    PHILOSOPHY_DIVERGENCE_THRESHOLD: String(combo.divergenceThreshold),
    FLOW_MODEL_MIN_VOL_RATIO: String(combo.flowMinVolRatio),
    FLOW_MODEL_MIN_OI_CHG_PCT: String(combo.flowMinOiChgPct),
    PHILOSOPHY_PRICED_IN_ALPHA: String(combo.pricedInAlpha),
  };
}

function formatComboLine(r) {
  if (!r?.aggregate) return String(r?.key || '—');
  const p = r.params;
  const a = r.aggregate;
  const pr = r.precious || {};
  return [
    r.key,
    `filterPass=${a.filterPassPct}%`,
    `interN=${a.intersectionN}`,
    `interHit=${a.intersectionHitPct ?? '—'}%`,
    `au+ag n=${pr.intersectionN ?? '—'} hit=${pr.intersectionHitPct ?? '—'}%`,
    r.gatePass ? 'GATE_PASS' : 'gate_fail',
    p
      ? `(N=${p.divergenceLookbackN} T=${p.divergenceThreshold} vol=${p.flowMinVolRatio} oi=${p.flowMinOiChgPct} α=${p.pricedInAlpha})`
      : '',
  ].join(' · ');
}

function formatReport(payload) {
  const lines = [];
  lines.push('=== Step 6: Model C Intersection KPI Threshold Grid ===');
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Window: ${payload.window.from} → ${payload.window.to}`);
  lines.push(`Instruments: ${PROBE_IDS.join(', ')}`);
  lines.push(
    `Gate: intersection hit ≥ ${GATE_MIN_HIT_PCT}% AND n ≥ ${GATE_MIN_INTERSECTION_N} (live T+1 target)`,
  );
  lines.push(`Combos evaluated: ${payload.comboCount}`);
  lines.push(`Baseline (default params): interN=${payload.baseline?.aggregate?.intersectionN} hit=${payload.baseline?.aggregate?.intersectionHitPct ?? '—'}%`);
  lines.push('');

  lines.push('--- Gate outcome ---');
  lines.push(`Gate pass count: ${payload.ranking.gatePassers.length}/${payload.comboCount}`);
  if (payload.ranking.gatePassers.length) {
    for (const r of payload.ranking.gatePassers.slice(0, 10)) {
      lines.push(`  PASS · ${formatComboLine(r)}`);
    }
  } else {
    lines.push('  No combo met gate (75% hit @ n≥40).');
  }
  lines.push('');

  lines.push('--- Best Pareto (max hit rate subject to n≥40) ---');
  if (payload.ranking.bestParetoN40) {
    const bp = payload.ranking.bestParetoN40;
    lines.push(
      formatComboLine({
        key: bp.key,
        params: bp.params,
        aggregate: bp.aggregate,
        precious: bp.precious,
        gatePass: bp.aggregate?.intersectionN >= GATE_MIN_INTERSECTION_N &&
          (bp.aggregate?.intersectionHitPct ?? 0) >= GATE_MIN_HIT_PCT,
      }),
    );
    lines.push(
      `Recommended env: ${JSON.stringify(formatEnvRecommendation(payload.ranking.bestParetoN40.params))}`,
    );
  } else {
    lines.push('  No combo reached n≥40.');
  }
  lines.push('');

  if (payload.ranking.relaxedTradeoff) {
    lines.push('--- Relaxed flow: max n at min hit ---');
    for (const [label, minHit] of [
      ['hit>=60%', 60],
      ['hit>=65%', 65],
      ['hit>=70%', 70],
    ]) {
      const r = payload.ranking.relaxedTradeoff['minHit' + minHit];
      lines.push(r ? '  ' + label + ': ' + formatComboLine(r) : '  ' + label + ': (none)');
    }
    lines.push('');
  }

  lines.push('--- Tradeoff anchors ---');
  lines.push(`Best hit (any n): ${formatComboLine(payload.ranking.bestHitAnyN)}`);
  lines.push(`Max intersection n: ${formatComboLine(payload.ranking.bestNAnyHit)}`);
  lines.push('');

  lines.push('--- Pareto front (top 15 by hit then n) ---');
  const paretoFront = (payload.ranking.paretoFrontKeys || [])
    .map((k) => payload.results.find((r) => r.key === k))
    .filter(Boolean);
  for (const r of paretoFront.slice(0, 15)) {
    lines.push(formatComboLine(r));
  }
  lines.push('');

  lines.push('--- Full grid (sorted by intersection n desc, hit desc) ---');
  const sorted = [...payload.results].sort((a, b) => {
    const nDiff = b.aggregate.intersectionN - a.aggregate.intersectionN;
    if (nDiff !== 0) return nDiff;
    return (b.aggregate.intersectionHitPct ?? -1) - (a.aggregate.intersectionHitPct ?? -1);
  });
  for (const r of sorted) {
    lines.push(formatComboLine(r));
  }

  lines.push('');
  lines.push('--- Production deploy ---');
  lines.push(
    payload.ranking.gatePassers.length
      ? 'Experiment path only — validate on holdout before production.'
      : 'NOT justified for production deploy — gate not met; keep v1.34.8 live weights.',
  );

  return lines.join('\n');
}

async function main() {
  const { from, to, quick, includeAlpha, relaxed } = parseArgs();
  const window = { from, to };
  if (relaxed) {
    OUT_TXT = path.join(process.cwd(), RELAXED_OUT_TXT);
    OUT_JSON = path.join(process.cwd(), RELAXED_OUT_JSON);
  }
  const grid = buildGrid(quick, includeAlpha, relaxed);

  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const preparedArtifacts = [];
  for (const id of PROBE_IDS) {
    const spec = findSpec(id);
    const bars = loadBars(id);
    if (!spec || bars.length < 62) {
      console.warn(`skip ${id}: missing spec or bars`);
      continue;
    }
    console.log(`collecting ${id} (${bars.length} bars)...`);
    preparedArtifacts.push({
      instrumentId: id,
      artifacts: collectBarArtifacts(spec, bars, window),
    });
  }

  const defaultCombo = {
    divergenceLookbackN: 5,
    divergenceThreshold: 4,
    flowMinVolRatio: 1.15,
    flowMinOiChgPct: 0.08,
    pricedInAlpha: 1.0,
  };

  console.log(`\nGrid sweep: ${grid.length} combos · ${window.from} → ${window.to}`);
  if (quick) console.log('(--quick mode)');
  if (relaxed) console.log('(--relaxed flow threshold grid, N5/T4 focus)');

  const t0 = Date.now();
  const baseline = evaluateCombo(defaultCombo, preparedArtifacts);
  const results = [];
  for (let i = 0; i < grid.length; i += 1) {
    const combo = grid[i];
    if (i === 0 || (i + 1) % 20 === 0 || i === grid.length - 1) {
      console.log(`[${i + 1}/${grid.length}] ${comboKey(combo)}`);
    }
    results.push(evaluateCombo(combo, preparedArtifacts));
  }
  const elapsedSec = +((Date.now() - t0) / 1000).toFixed(1);

  const ranking = rankResults(results);
  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedSec,
    filterVersion: philosophyFilter.FILTER_VERSION,
    modelCVersion: modelCGate.GATE_VERSION,
    window,
    gate: { minHitPct: GATE_MIN_HIT_PCT, minIntersectionN: GATE_MIN_INTERSECTION_N },
    gridSpec: {
      quick,
      relaxed,
      includeAlpha,
      divergenceLookbackN: [...new Set(grid.map((g) => g.divergenceLookbackN))],
      divergenceThreshold: [...new Set(grid.map((g) => g.divergenceThreshold))],
      flowMinVolRatio: [...new Set(grid.map((g) => g.flowMinVolRatio))],
      flowMinOiChgPct: [...new Set(grid.map((g) => g.flowMinOiChgPct))],
      pricedInAlpha: [...new Set(grid.map((g) => g.pricedInAlpha))],
    },
    comboCount: results.length,
    baseline,
    ranking: {
      gatePassCount: ranking.gatePassers.length,
      gatePassers: ranking.gatePassers.map((r) => ({
        key: r.key,
        params: r.params,
        aggregate: r.aggregate,
        precious: r.precious,
        gatePass: r.gatePass,
        recommendedEnv: formatEnvRecommendation(r.params),
      })),
      bestParetoN40: ranking.bestParetoN40
        ? {
            key: ranking.bestParetoN40.key,
            params: ranking.bestParetoN40.params,
            aggregate: ranking.bestParetoN40.aggregate,
            precious: ranking.bestParetoN40.precious,
            recommendedEnv: formatEnvRecommendation(ranking.bestParetoN40.params),
          }
        : null,
      bestHitAnyN: {
        key: ranking.bestHitAnyN.key,
        params: ranking.bestHitAnyN.params,
        aggregate: ranking.bestHitAnyN.aggregate,
        precious: ranking.bestHitAnyN.precious,
        gatePass: ranking.bestHitAnyN.gatePass,
      },
      bestNAnyHit: {
        key: ranking.bestNAnyHit.key,
        params: ranking.bestNAnyHit.params,
        aggregate: ranking.bestNAnyHit.aggregate,
        precious: ranking.bestNAnyHit.precious,
        gatePass: ranking.bestNAnyHit.gatePass,
      },
      paretoFrontKeys: ranking.paretoFront.slice(0, 20).map((r) => r.key),
      relaxedTradeoff: ranking.relaxedTradeoff
        ? {
            minHit60: ranking.relaxedTradeoff.minHit60
              ? { key: ranking.relaxedTradeoff.minHit60.key, params: ranking.relaxedTradeoff.minHit60.params, aggregate: ranking.relaxedTradeoff.minHit60.aggregate, precious: ranking.relaxedTradeoff.minHit60.precious }
              : null,
            minHit65: ranking.relaxedTradeoff.minHit65
              ? { key: ranking.relaxedTradeoff.minHit65.key, params: ranking.relaxedTradeoff.minHit65.params, aggregate: ranking.relaxedTradeoff.minHit65.aggregate, precious: ranking.relaxedTradeoff.minHit65.precious }
              : null,
            minHit70: ranking.relaxedTradeoff.minHit70
              ? { key: ranking.relaxedTradeoff.minHit70.key, params: ranking.relaxedTradeoff.minHit70.params, aggregate: ranking.relaxedTradeoff.minHit70.aggregate, precious: ranking.relaxedTradeoff.minHit70.precious }
              : null,
          }
        : undefined,
    },
    productionDeployJustified: ranking.gatePassers.length > 0,
    results,
  };

  const report = formatReport(payload);
  console.log('\n' + report);
  const tmpJson = `${OUT_JSON}.${process.pid}.tmp`;
  const tmpTxt = `${OUT_TXT}.${process.pid}.tmp`;
  fs.writeFileSync(tmpJson, JSON.stringify(payload, null, 2));
  fs.writeFileSync(tmpTxt, report + '\n', 'utf8');
  try {
    if (fs.existsSync(OUT_JSON)) fs.unlinkSync(OUT_JSON);
    if (fs.existsSync(OUT_TXT)) fs.unlinkSync(OUT_TXT);
  } catch (_) {
    /* prior file may be locked */
  }
  fs.renameSync(tmpJson, OUT_JSON);
  fs.renameSync(tmpTxt, OUT_TXT);
  console.log(`\nWrote ${OUT_TXT}`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Elapsed: ${elapsedSec}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
