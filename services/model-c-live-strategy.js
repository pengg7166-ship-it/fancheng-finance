/**
 * Model C live strategy 'high hit rate, low frequency intersection signals.
 * Enable: MODEL_C_V2=1 + MODEL_C_LIVE_TIER=high_hit (experiment only; production v1.34.8 unchanged)
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const philosophyFilter = require('./philosophy-direction-filter');

const MANIFEST_FILENAME = 'model-c-live-strategy.json';
const STRATEGY_VERSION = 'v1-live-high-hit';
const STRATEGY_MODE = 'high_hit_low_freq';
const DEFAULT_LIVE_TIER = 'live_high_hit';
const DEFAULT_AUDIT_TIER = 'audit_relaxed';
const DEFAULT_SIM_TIER = 'sim_relaxed';

let _manifestCache = null;
let _manifestMtime = 0;

function defaultManifest() {
  return {
    schemaVersion: 'model-c-live-strategy-v1',
    strategyMode: STRATEGY_MODE,
    expectedSignalRatePct: { min: 1, max: 2 },
    targetHitRatePct: { min: 70, max: 75 },
    defaultLiveTier: DEFAULT_LIVE_TIER,
    defaultAuditTier: DEFAULT_AUDIT_TIER,
    defaultSimTier: DEFAULT_SIM_TIER,
    tiers: {
      audit_relaxed: {
        label: 'Archive / backtest baseline (relaxed flow)',
        divergenceLookbackN: 5,
        divergenceThreshold: 4,
        flowMinVolRatio: 0.8,
        flowMinOiChgPct: 0.02,
        pricedInAlpha: 1.0,
        sectorOverrides: {},
      },
      live_high_hit: {
        label: 'Live tradable · high hit, low frequency',
        divergenceLookbackN: 5,
        divergenceThreshold: 4,
        flowMinVolRatio: 1.05,
        flowMinOiChgPct: 0.02,
        pricedInAlpha: 1.0,
        minPhilosophyConfidence: 0.12,
        sectorOverrides: {
          precious: {
            divergenceLookbackN: 4,
            divergenceThreshold: 4,
            flowMinOiChgPct: 0.01,
          },
        },
      },
      sim_balanced: {
        label: 'Paper / backtest · balanced frequency',
        divergenceLookbackN: 5,
        divergenceThreshold: 4,
        flowMinVolRatio: 0.8,
        flowMinOiChgPct: 0.02,
        pricedInAlpha: 1.0,
        minPhilosophyConfidence: 0.08,
        sectorOverrides: {},
      },
      sim_relaxed: {
        label: 'Paper / backtest · relaxed five-laws gate',
        divergenceLookbackN: 5,
        divergenceThreshold: 4,
        flowMinVolRatio: 0.8,
        flowMinOiChgPct: 0.02,
        pricedInAlpha: 1.0,
        minPhilosophyConfidence: 0.08,
        sectorOverrides: {},
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

function getManifestPath() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  return path.join(dataDir, 'outlook-models', MANIFEST_FILENAME);
}

function loadManifest(force = false) {
  const fp = getManifestPath();
  if (!fp || !fs.existsSync(fp)) return defaultManifest();
  try {
    const stat = fs.statSync(fp);
    if (!force && _manifestCache && stat.mtimeMs === _manifestMtime) return _manifestCache;
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const base = defaultManifest();
    _manifestCache = {
      ...base,
      ...parsed,
      tiers: { ...base.tiers, ...(parsed.tiers || {}) },
      notes: { ...(base.notes || {}), ...(parsed.notes || {}) },
    };
    _manifestMtime = stat.mtimeMs;
    return _manifestCache;
  } catch {
    return defaultManifest();
  }
}

function resolveActiveTier() {
  const tier = String(process.env.MODEL_C_LIVE_TIER || '').trim().toLowerCase();
  if (tier === 'high_hit' || tier === 'live_high_hit') return DEFAULT_LIVE_TIER;
  if (tier === 'audit' || tier === 'audit_relaxed') return DEFAULT_AUDIT_TIER;
  if (tier === 'sim' || tier === 'sim_balanced' || tier === 'balanced') return 'sim_balanced';
  if (tier === 'sim_relaxed' || tier === 'relaxed') return DEFAULT_SIM_TIER;
  return tier || null;
}

function isSimRelaxedTier(tierId) {
  const t = String(tierId || '').toLowerCase();
  return t === 'sim_relaxed' || t === 'relaxed';
}

function resolveSimTier() {
  const tier = String(process.env.MODEL_C_SIM_TIER || '').trim().toLowerCase();
  if (tier === 'audit' || tier === 'audit_relaxed') return DEFAULT_AUDIT_TIER;
  if (tier === 'sim' || tier === 'sim_balanced' || tier === 'balanced') return 'sim_balanced';
  if (tier === 'sim_relaxed' || tier === 'relaxed') return DEFAULT_SIM_TIER;
  if (tier === 'high_hit' || tier === 'live_high_hit') return DEFAULT_LIVE_TIER;
  const manifest = loadManifest();
  return manifest.defaultSimTier || DEFAULT_SIM_TIER;
}

function isModelCExperimentEnabled() {
  const v = process.env.MODEL_C_V2;
  return (v === '1' || v === 'true') && philosophyFilter.isEnabled();
}

function isLiveTierActive() {
  const tier = resolveActiveTier();
  return tier === DEFAULT_LIVE_TIER && isModelCExperimentEnabled();
}

function resolveTierConfig(tierId, sector = null, instrumentId = null) {
  const manifest = loadManifest();
  const base = manifest.tiers?.[tierId];
  if (!base) return null;

  const sectorKey = String(sector || '').toLowerCase();
  const id = String(instrumentId || '').toLowerCase();
  const isPrecious = sectorKey === 'precious' || id === 'au' || id === 'ag';
  const overrideKey = isPrecious ? 'precious' : sectorKey;
  const sectorOverride = base.sectorOverrides?.[overrideKey] || {};

  return {
    tierId,
    ...base,
    ...sectorOverride,
    sector: sectorKey || null,
    instrumentId: id || null,
  };
}

/** Apply tier threshold env overrides (call per instrument when sector-specific). */
function applyTierEnv(tierId, ctx = {}) {
  const tier = resolveTierConfig(tierId, ctx.sector, ctx.instrumentId);
  if (!tier) return null;

  process.env.PHILOSOPHY_FILTER_V2 = '1';
  process.env.MODEL_C_V2 = '1';
  process.env.PHILOSOPHY_DIVERGENCE_LOOKBACK_N = String(tier.divergenceLookbackN);
  process.env.PHILOSOPHY_DIVERGENCE_THRESHOLD = String(tier.divergenceThreshold);
  process.env.FLOW_MODEL_MIN_VOL_RATIO = String(tier.flowMinVolRatio);
  process.env.FLOW_MODEL_MIN_OI_CHG_PCT = String(tier.flowMinOiChgPct);
  if (tier.pricedInAlpha != null) {
    process.env.PHILOSOPHY_PRICED_IN_ALPHA = String(tier.pricedInAlpha);
  }

  return tier;
}

function applyLiveTierEnvIfActive(ctx = {}) {
  if (!isLiveTierActive()) return null;
  return applyTierEnv(DEFAULT_LIVE_TIER, ctx);
}

function meetsFlowThresholds(flowModel, tier, filterOut) {
  if (!flowModel || !tier) return false;
  const volRatio = Number(flowModel.volumeRatio);
  const oiPct = Math.abs(Number(flowModel.oiChangePct ?? 0));
  if (!Number.isFinite(volRatio) || volRatio < tier.flowMinVolRatio) return false;
  if (!Number.isFinite(oiPct) || oiPct < tier.flowMinOiChgPct) return false;
  const philDir = filterOut?.effectivePhilosophyDir;
  if (!philDir || Number(flowModel.oiChgDir) !== Number(philDir)) return false;
  return true;
}

function meetsPhilosophyDivergence(filterOut, tier, bars, barIndex) {
  if (!filterOut?.filterPass || !tier) return false;
  if (!bars?.length || barIndex == null) {
    const rw = filterOut.randomWalkFilter;
    if (!rw) return Boolean(filterOut.filterPass);
    return rw.divergenceCount < tier.divergenceThreshold;
  }

  const philDir = filterOut.effectivePhilosophyDir;
  if (!philDir) return false;
  const count = philosophyFilter.countPhilosophyDivergence(
    bars,
    barIndex,
    philDir,
    tier.divergenceLookbackN,
  );
  return count < tier.divergenceThreshold;
}

function meetsConfidenceThresholds(filterOut, modelCOut, tier) {
  const minPhil = tier.minPhilosophyConfidence ?? 0;
  const minDir = tier.minDirModelConfidence ?? 0;
  const minFlow = tier.minFlowConfidence ?? 0;

  const philConf = Number(filterOut?.philosophyConfidence ?? modelCOut?.philosophyConfidence ?? 0);
  const dirConf = Number(modelCOut?.dirModel?.confidence ?? 0);
  const flowConf = Number(modelCOut?.flowModel?.confidence ?? 0);

  return philConf >= minPhil && dirConf >= minDir && flowConf >= minFlow;
}

/**
 * Evaluate tradability under a strategy tier (live_high_hit, sim_balanced, etc.).
 * @param {object} ctx
 * @param {object} ctx.modelCOut
 * @param {object} ctx.filterOut
 * @param {string} [ctx.sector]
 * @param {string} [ctx.instrumentId]
 * @param {Array} [ctx.bars]
 * @param {number} [ctx.barIndex]
 * @param {string} [ctx.tierId]
 */
function evaluateTradability(ctx = {}) {
  const { modelCOut, filterOut, sector, instrumentId, bars, barIndex } = ctx;
  const tierId = ctx.tierId || DEFAULT_LIVE_TIER;
  const tier = resolveTierConfig(tierId, sector, instrumentId);

  if (!modelCOut || !tier) {
    return {
      tradable: false,
      tradableForLive: false,
      liveStrategyTier: tierId,
      strategyMode: STRATEGY_MODE,
      liveStrategyVersion: STRATEGY_VERSION,
    };
  }

  const intersectionOk = Boolean(
    modelCOut.intersectionSignal &&
      modelCOut.philosophyFilterPass &&
      modelCOut.sameSign,
  );
  const flowOk = meetsFlowThresholds(modelCOut.flowModel, tier, filterOut);
  const divergenceOk = meetsPhilosophyDivergence(filterOut, tier, bars, barIndex);
  const confidenceOk = meetsConfidenceThresholds(filterOut, modelCOut, tier);

  const tradable = Boolean(intersectionOk && flowOk && divergenceOk && confidenceOk);

  return {
    tradable,
    tradableForLive: tradable,
    liveStrategyTier: tierId,
    strategyMode: STRATEGY_MODE,
    liveStrategyVersion: STRATEGY_VERSION,
    liveTierPreset: {
      divergenceLookbackN: tier.divergenceLookbackN,
      divergenceThreshold: tier.divergenceThreshold,
      flowMinVolRatio: tier.flowMinVolRatio,
      flowMinOiChgPct: tier.flowMinOiChgPct,
    },
  };
}

/** @deprecated alias 'use evaluateTradability */
function evaluateLiveTradability(ctx = {}) {
  return evaluateTradability({ ...ctx, tierId: ctx.tierId || DEFAULT_LIVE_TIER });
}

/** Merge live strategy fields into archive record. */
function attachLiveStrategyToArchiveRecord(record, liveOut) {
  if (!liveOut) return record;
  return {
    ...record,
    tradableForLive: liveOut.tradableForLive,
    liveStrategyTier: liveOut.liveStrategyTier,
    strategyMode: liveOut.strategyMode,
    liveStrategyVersion: liveOut.liveStrategyVersion,
    liveTierPreset: liveOut.liveTierPreset ?? record.liveTierPreset,
  };
}

/** Extend Model C output with live + sim strategy annotations. */
function annotateModelC(modelCOut, ctx = {}) {
  const baseCtx = {
    modelCOut,
    filterOut: ctx.filterOut,
    sector: ctx.sector,
    instrumentId: ctx.instrumentId,
    bars: ctx.bars,
    barIndex: ctx.barIndex,
  };
  const liveOut = evaluateTradability({ ...baseCtx, tierId: ctx.tierId || DEFAULT_LIVE_TIER });
  const simTierId = ctx.simTierId || resolveSimTier();
  const simOut = evaluateTradability({ ...baseCtx, tierId: simTierId });
  return {
    ...modelCOut,
    ...liveOut,
    tradableForLive: liveOut.tradable,
    tradableForSim: simOut.tradable,
    simStrategyTier: simOut.liveStrategyTier,
    simTierPreset: simOut.liveTierPreset,
  };
}

module.exports = {
  MANIFEST_FILENAME,
  STRATEGY_VERSION,
  STRATEGY_MODE,
  DEFAULT_LIVE_TIER,
  DEFAULT_AUDIT_TIER,
  DEFAULT_SIM_TIER,
  getManifestPath,
  loadManifest,
  defaultManifest,
  resolveActiveTier,
  resolveSimTier,
  isSimRelaxedTier,
  isLiveTierActive,
  isModelCExperimentEnabled,
  resolveTierConfig,
  applyTierEnv,
  applyLiveTierEnvIfActive,
  evaluateTradability,
  evaluateLiveTradability,
  attachLiveStrategyToArchiveRecord,
  annotateModelC,
};
