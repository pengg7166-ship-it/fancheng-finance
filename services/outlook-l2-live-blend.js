/**
 * 大宗走势研判 · L2 实时 ensemble 融合（v1.48）
 * 从 live 计算上下文构建 flatRow，调用 logistic/ONNX/stub 推理。
 */
const { predictEnsembleSync, getRunnerStatus } = require('./outlook-onnx-runner');
const { classifyMarketRegime } = require('./market-regime-classifier');

const L2_LIVE_VERSION = 'v1.48.0-l2-live';
const L2_BLEND_WEIGHT = Number(process.env.OUTLOOK_L2_BLEND_WEIGHT) || 0.25;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isEnabled() {
  const v = process.env.OUTLOOK_L2_LIVE;
  if (v === '0' || v === 'false') return false;
  return true;
}

function buildLiveFlatRow(ctx = {}) {
  const {
    instrumentId,
    sector,
    philosophyScore = 0,
    adaptiveScore = 0,
    factorComposite = 0,
    technical = {},
    macroScores = {},
    today,
  } = ctx;

  const momentum =
    technical.momentum5d ??
    technical.intraday?.score ??
    (technical.techScore != null ? technical.techScore * 0.4 : 0);

  const oi = technical.oi || {};
  const regime =
    ctx.marketRegime ||
    classifyMarketRegime({
      barDate: today,
      instrumentId,
      sector,
      technical,
      macroScores,
    })?.regime ||
    'range';

  return {
    instrumentId,
    sector,
    philosophyScore: clamp(philosophyScore, -1, 1),
    adaptiveScore: clamp(adaptiveScore, -1, 1),
    factorComposite: clamp(factorComposite, -1, 1),
    momentum: clamp(momentum, -1, 1),
    marketRegime: regime,
    oi_price_down_oi_up: oi.priceDownOiUp ? 1 : 0,
    oi_price_up_oi_down: oi.priceUpOiDown ? 1 : 0,
    oi_change_pct: oi.deltaPct ?? 0,
    volume_oi_ratio: oi.volumeOiRatio ?? 0,
    oi_divergence_rate_5d: oi.divergenceRate5d ?? 0,
    real10y_chg_5d: macroScores.real10yChg5d ?? 0,
  };
}

function directionLabel(dir) {
  if (dir === 'bullish') return '偏多';
  if (dir === 'bearish') return '偏空';
  return '中性';
}

/**
 * Feed L2 blended composite back into headline direction (P1 live direction layer).
 * Skips when data insufficient or L2 errored.
 */
function applyL2BlendedDirection(ctx = {}) {
  const {
    l2Live,
    compositeScore,
    dirTier,
    directionLabelOverride,
    insufficientData,
    sector,
    profile,
    technical,
    eventCtxMerged,
    today,
  } = ctx;

  const base = {
    compositeScore,
    dirTier,
    directionLabelOverride,
    l2Live,
  };
  if (!isEnabled() || insufficientData || !l2Live || l2Live.error) return base;
  if (l2Live.blendedComposite == null || !Number.isFinite(l2Live.blendedComposite)) return base;

  const outlookCalibration = require('./commodity-outlook-calibration');
  const { directionTierClass } = require('./commodity-instrument-profiles');

  let newScore = l2Live.blendedComposite;
  let newDirTier = outlookCalibration.scoreToDirectionTier(
    newScore,
    sector,
    profile?.directionThresholds,
    technical?.smoothedVol
  );
  let newLabelOverride = directionLabelOverride;

  const adv = outlookCalibration.applyAdvancedDirectionFilters({
    sector,
    compositeScore: newScore,
    directionTier: newDirTier,
    technical,
    eventCtx: eventCtxMerged,
    phil: ctx.phil,
    smoothedVol: technical?.smoothedVol,
    barDate: today,
    eraId: require('./commodity-outlook-event-calendar').classifyEpoch(today),
  });
  newDirTier = adv.directionTier;
  newScore = adv.compositeScore;
  newLabelOverride = adv.directionLabelOverride;
  newDirTier = outlookCalibration.applyEnsembleStrongDirectionRule(newDirTier, sector, newScore);

  return {
    compositeScore: newScore,
    dirTier: newDirTier,
    direction: directionTierClass(newDirTier.direction),
    directionLabelOverride: newLabelOverride,
    l2Live: {
      ...l2Live,
      directionApplied: true,
      priorCompositeScore: compositeScore,
      priorDirection: dirTier?.direction || null,
    },
  };
}

/**
 * @param {object} ctx - live instrument compute context
 * @returns {object|null} l2Live block for instrument payload
 */
function blendL2LiveDirection(ctx = {}) {
  if (!isEnabled()) return null;
  try {
    const flatRow = buildLiveFlatRow(ctx);
    const pred = predictEnsembleSync(flatRow);
    const pUp = Number(pred.pUp ?? 0.5);
    const confidence = +clamp(Math.abs(pUp - 0.5) * 2, 0, 1).toFixed(4);
    const runner = getRunnerStatus();

    const l2Score = (pUp - 0.5) * 2;
    let blendedComposite = ctx.compositeScore;
    if (blendedComposite != null && Number.isFinite(blendedComposite)) {
      blendedComposite = +clamp(
        blendedComposite * (1 - L2_BLEND_WEIGHT) + l2Score * L2_BLEND_WEIGHT,
        -1,
        1
      ).toFixed(4);
    }

    return {
      version: L2_LIVE_VERSION,
      direction: pred.direction || 'neutral',
      directionLabel: directionLabel(pred.direction),
      pUp: +pUp.toFixed(4),
      confidence,
      backend: pred.backend || runner.fallback || 'ensemble-stub',
      head: pred.head || null,
      blendWeight: L2_BLEND_WEIGHT,
      blendedComposite,
      runnerStatus: {
        onnxPresent: runner.onnxPresent,
        weightsPresent: runner.weightsPresent,
        ortAvailable: runner.ortAvailable,
      },
      logicSummary: `L2 ${pred.backend || 'stub'} P(up)=${(pUp * 100).toFixed(1)}% · ${directionLabel(pred.direction)}`,
    };
  } catch (err) {
    return {
      version: L2_LIVE_VERSION,
      error: err?.message || String(err),
      direction: 'neutral',
      directionLabel: '待校验',
      backend: 'error',
    };
  }
}

module.exports = {
  L2_LIVE_VERSION,
  L2_BLEND_WEIGHT,
  isEnabled,
  buildLiveFlatRow,
  blendL2LiveDirection,
  applyL2BlendedDirection,
};
