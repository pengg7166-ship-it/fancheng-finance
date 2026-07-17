/**
 * Model C intersection gate 'Philosophy filter 'DirectionModel 'VolumeOIModel.
 * Training/backtest scores dir / flow / intersection KPI separately.
 * Enable: MODEL_C_V2=1 (requires PHILOSOPHY_FILTER_V2=1)
 */
const philosophyFilter = require('./philosophy-direction-filter');
const directionModel = require('./direction-model-v2');
const volumeOiFlow = require('./volume-oi-flow-model');
const liveStrategy = require('./model-c-live-strategy');

const GATE_VERSION = 'v2-step4';

function isEnabled() {
  const v = process.env.MODEL_C_V2;
  return (v === '1' || v === 'true') && philosophyFilter.isEnabled();
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

function resolveEffectivePhilosophySign(filterOut) {
  if (!filterOut) return 0;
  if (filterOut.effectivePhilosophyDir != null) return signDir(filterOut.effectivePhilosophyDir);
  return dirLabelToSign(filterOut.philosophyDirection);
}

function resolveEffectivePhilosophyLabel(filterOut) {
  const s = resolveEffectivePhilosophySign(filterOut);
  if (s === 1) return 'bullish';
  if (s === -1) return 'bearish';
  return 'neutral';
}

function collectNeutralReasons(filterOut, dirModel, flowModel, sameSign) {
  const reasons = [];
  if (!filterOut?.filterPass) {
    if (filterOut?.neutralReason) reasons.push(filterOut.neutralReason);
    else reasons.push('philosophy_filter_fail');
  }
  if (!dirModel || dirModel.direction === 'neutral') reasons.push('dir_model_neutral');
  if (!flowModel?.validFundSignal) reasons.push('low_flow_confidence');
  if (!sameSign) reasons.push('philosophy_flow_mismatch');
  return [...new Set(reasons)];
}

/**
 * @param {object} ctx
 * @param {object} ctx.filterOut
 * @param {object} ctx.flatRow
 * @param {object} [ctx.dirModel]
 * @param {object} [ctx.flowModel]
 * @param {Array} [ctx.bars]
 * @param {number} [ctx.barIndex]
 * @param {string} [ctx.sector]
 * @param {object} [ctx.oiBehavior]
 * @param {object} [opts]
 */
function evaluateModelC(ctx = {}, opts = {}) {
  const { filterOut, flatRow, bars, barIndex, sector, oiBehavior } = ctx;

  const dirModel = ctx.dirModel || directionModel.predictDirectionModel(flatRow || {}, opts);
  const flowModel =
    ctx.flowModel ||
    volumeOiFlow.evaluateVolumeOiFlow({
      filterOut,
      bars,
      barIndex,
      sector,
      oiBehavior,
    });

  const philSign = resolveEffectivePhilosophySign(filterOut);
  const philLabel = resolveEffectivePhilosophyLabel(filterOut);
  const dirSign = dirLabelToSign(dirModel.direction);
  const flowSign = dirLabelToSign(flowModel.direction);

  const sameSign =
    philSign !== 0 &&
    dirSign === philSign &&
    flowSign === philSign &&
    flowModel.validFundSignal;

  const filterPass = Boolean(filterOut?.filterPass);
  const intersectionPass = Boolean(filterPass && sameSign);

  const neutralReasons = intersectionPass
    ? []
    : collectNeutralReasons(filterOut, dirModel, flowModel, sameSign);

  const intersectionSignal = intersectionPass ? philLabel : null;
  const predictedDir = intersectionPass ? philLabel : 'neutral';

  const base = {
    version: GATE_VERSION,
    filterPass: intersectionPass,
    philosophyFilterPass: filterPass,
    predictedDir,
    intersectionSignal,
    philosophyDirection: philLabel,
    philosophyConfidence: filterOut?.philosophyConfidence ?? null,
    effectivePhilosophyDir: philSign,
    dirModel: {
      direction: dirModel.direction,
      pUp: dirModel.pUp,
      confidence: dirModel.confidence,
      composite: dirModel.composite,
      backend: dirModel.backend,
      philosophyZeroed: true,
    },
    flowModel: {
      direction: flowModel.direction,
      oiChgDir: flowModel.oiChgDir,
      oiChangePct: flowModel.oiChangePct ?? null,
      volumePctile: flowModel.volumePctile,
      volumeRatio: flowModel.volumeRatio,
      confidence: flowModel.confidence,
      validFundSignal: flowModel.validFundSignal,
      validFlow: flowModel.validFlow,
      behaviorTag: flowModel.behaviorTag,
      thresholds: flowModel.thresholds,
    },
    tradableForKpi: intersectionPass,
    intersectionKpiEligible: intersectionPass,
    neutralReason: neutralReasons.length ? neutralReasons[0] : null,
    neutralReasons,
    sameSign,
  };

  if (liveStrategy.isModelCExperimentEnabled()) {
    return liveStrategy.annotateModelC(base, {
      filterOut,
      sector: ctx.sector,
      instrumentId: ctx.instrumentId ?? flatRow?.instrumentId,
      bars,
      barIndex,
    });
  }
  return base;
}

/** Merge Model C v2 fields into direction-prediction-archive record (backward compatible). */
function attachModelCToArchiveRecord(record, modelCOut) {
  if (!modelCOut) return record;
  const neutralReasons = modelCOut.neutralReasons?.length
    ? modelCOut.neutralReasons
    : modelCOut.neutralReason
      ? [modelCOut.neutralReason]
      : null;
  const predictedDir = modelCOut.predictedDir ?? record.predictedDir;
  const needsReason = predictedDir === 'neutral' || modelCOut.filterPass === false;
  const resolvedReason =
    modelCOut.neutralReason ??
    (neutralReasons?.length ? neutralReasons[0] : null) ??
    record.neutralReason ??
    (needsReason ? 'unknown_filter_fail' : null);
  const resolvedReasons =
    modelCOut.filterPass === true
      ? null
      : neutralReasons?.length
        ? neutralReasons
        : resolvedReason
          ? [resolvedReason]
          : null;

  return {
    ...record,
    schemaVersion: Math.max(record.schemaVersion || 1, 2),
    filterPass: modelCOut.filterPass,
    predictedDir,
    neutralReason: modelCOut.filterPass ? null : resolvedReason,
    neutralReasons: modelCOut.filterPass ? null : resolvedReasons,
    philosophyDirection: modelCOut.philosophyDirection ?? record.philosophyDirection,
    philosophyConfidence: modelCOut.philosophyConfidence ?? record.philosophyConfidence,
    dirModel: modelCOut.dirModel,
    flowModel: modelCOut.flowModel,
    intersectionSignal: modelCOut.intersectionSignal,
    tradableForKpi: modelCOut.tradableForKpi,
    intersectionKpiEligible: modelCOut.intersectionKpiEligible,
    tradableForLive: modelCOut.tradableForLive ?? null,
    tradableForSim: modelCOut.tradableForSim ?? null,
    simStrategyTier: modelCOut.simStrategyTier ?? null,
    liveStrategyTier: modelCOut.liveStrategyTier ?? null,
    strategyMode: modelCOut.strategyMode ?? null,
    liveStrategyVersion: modelCOut.liveStrategyVersion ?? null,
    modelC: modelCOut,
  };
}

module.exports = {
  GATE_VERSION,
  isEnabled,
  evaluateModelC,
  attachModelCToArchiveRecord,
  resolveEffectivePhilosophyLabel,
};
