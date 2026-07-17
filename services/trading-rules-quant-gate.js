/**
 * Quant Gate '研判方向 '五法—区间—Model C/OI
 *
 * QUANT_MODE:
 *   fundamental_chan '基本面方向为主，五法则加'减分，band 仿真 advisory
 *   model_c_gate     'legacy Model C 交集'gate（默认）
 */
const fiveLaws = require('./trading-rules-five-laws');
const rangeArchive = require('./range-prediction-archive');
const modelCGate = require('./model-c-intersection-gate');
const liveStrategy = require('./model-c-live-strategy');
const outlookCalibration = require('./commodity-outlook-calibration');
const { predictNextDayHighLowFromBars } = require('./intraday-range-predictor');
const cnSession = require('./cn-futures-session-calendar');

const GATE_VERSION = 'quant-gate-v2-fundamental-chan';

function resolveQuantMode() {
  const raw = String(process.env.QUANT_MODE || 'model_c_gate').toLowerCase();
  if (raw === 'fundamental_chan' || raw === 'fundamental' || raw === 'chan') {
    return 'fundamental_chan';
  }
  return 'model_c_gate';
}

function isFundamentalChanMode() {
  return resolveQuantMode() === 'fundamental_chan';
}

/** sim_relaxed band miss sizing (Option A / combo tail). */
const BAND_SOFT_SIZE_MULT = 0.6;
/** Partial band hit sizing (Option B). */
const BAND_PARTIAL_SIZE_MULT = 0.75;
/** Option C: pred band width must be 'this fraction of ATR(20). */
const DEFAULT_BAND_MIN_ATR_RATIO = 0.35;
const ATR_PERIOD = 20;

const _archiveCache = new Map();

function resolveBandSimMode() {
  const raw = String(process.env.QUANT_BAND_SIM_MODE || 'soft').toLowerCase();
  if (['soft', 'partial', 'off', 'width', 'combo', 'strict'].includes(raw)) return raw;
  return 'soft';
}

function computeLocalAtr(bars, period = ATR_PERIOD) {
  if (!bars?.length || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    const h = Number(bars[i].high ?? bars[i].close);
    const l = Number(bars[i].low ?? bars[i].close);
    const pc = Number(bars[i - 1].close);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function bandHitFlags(band) {
  const highHit = band?.highHit ?? band?.comparison?.highHit ?? null;
  const lowHit = band?.lowHit ?? band?.comparison?.lowHit ?? null;
  const partialHit = highHit === true || lowHit === true;
  const fullHit = band?.bandTradable === true;
  const fullMiss = band?.bandTradable === false;
  return { highHit, lowHit, partialHit, fullHit, fullMiss };
}

/**
 * sim_relaxed band relaxation 'live / sim_balanced stay strict via caller.
 * @returns {{ bandBlocked: boolean, bandSoftPass: boolean, bandGateMode: string, bandSizeMult: number }}
 */
function evaluateBandSimRelaxation(band, simMode, ctx = {}) {
  const { partialHit, fullHit, fullMiss } = bandHitFlags(band);
  const out = {
    bandBlocked: false,
    bandSoftPass: false,
    bandGateMode: simMode,
    bandSizeMult: 1,
  };

  if (fullHit || band?.bandTradable === 'pending' || band?.bandTradable == null) {
    return out;
  }
  if (!fullMiss) return out;

  switch (simMode) {
    case 'off':
      out.bandSoftPass = true;
      break;
    case 'soft':
      out.bandSoftPass = true;
      out.bandSizeMult = BAND_SOFT_SIZE_MULT;
      break;
    case 'partial':
      if (partialHit) {
        out.bandSoftPass = true;
        out.bandSizeMult = BAND_PARTIAL_SIZE_MULT;
      } else {
        out.bandBlocked = true;
      }
      break;
    case 'width': {
      const minRatio = Number(process.env.QUANT_BAND_MIN_ATR_RATIO) || DEFAULT_BAND_MIN_ATR_RATIO;
      const predHigh = Number(band?.predHigh);
      const predLow = Number(band?.predLow);
      const barIndex = ctx.barIndex;
      const bars = ctx.bars;
      let widthOk = false;
      if (predHigh > predLow && barIndex != null && bars?.length) {
        const atr = computeLocalAtr(bars.slice(0, barIndex + 1));
        if (atr > 0) {
          widthOk = (predHigh - predLow) / atr >= minRatio;
        }
      }
      if (widthOk) {
        out.bandSoftPass = true;
        out.bandSizeMult = partialHit ? BAND_PARTIAL_SIZE_MULT : BAND_SOFT_SIZE_MULT;
      } else {
        out.bandBlocked = true;
      }
      break;
    }
    case 'combo':
      out.bandSoftPass = true;
      out.bandSizeMult = partialHit ? BAND_PARTIAL_SIZE_MULT : BAND_SOFT_SIZE_MULT;
      break;
    case 'strict':
      out.bandBlocked = true;
      out.bandGateMode = 'strict';
      break;
    default:
      out.bandBlocked = true;
      out.bandGateMode = 'strict';
  }
  return out;
}

function isLiveTierId(tier) {
  return tier === liveStrategy.DEFAULT_LIVE_TIER || tier === 'live_high_hit' || tier === 'high_hit';
}

function getArchiveForInstrument(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  if (_archiveCache.has(id)) return _archiveCache.get(id);
  const rows = rangeArchive.loadArchive(id);
  _archiveCache.set(id, rows);
  return rows;
}

function clearArchiveCache() {
  _archiveCache.clear();
}

function normBarDate(bar) {
  if (typeof bar === 'string') return bar.slice(0, 10);
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

/**
 * Resolve bandTradable for backtest (ex-post) or live (archive/pending).
 * @param {object} opts
 * @param {boolean} [opts.backtestMode=false]
 */
function resolveBandTradable(opts = {}) {
  const instrumentId = String(opts.instrumentId || '').toLowerCase();
  const bars = opts.bars;
  const barIndex = opts.barIndex;
  const backtestMode = opts.backtestMode === true;

  if (barIndex == null || !bars?.length) {
    return { bandTradable: 'pending', source: 'no_bars' };
  }

  const baselineDate = normBarDate(bars[barIndex]);
  const nextIdx = barIndex + 1;
  const nextBar = bars[nextIdx];
  const sessionDate = nextBar ? normBarDate(nextBar) : null;

  if (sessionDate) {
    const archived = getArchiveForInstrument(instrumentId).find(
      (r) => r.sessionDate === sessionDate && (!r.baselineDate || r.baselineDate === baselineDate),
    );
    if (archived?.bandHit != null) {
      return {
        bandTradable: archived.bandHit,
        highHit: archived.highHit,
        lowHit: archived.lowHit,
        sessionDate,
        baselineDate,
        predHigh: archived.predHigh,
        predLow: archived.predLow,
        source: 'archive',
      };
    }
  }

  if (!backtestMode || !nextBar) {
    return { bandTradable: 'pending', sessionDate, baselineDate, source: 'live_pending' };
  }

  const hl = predictNextDayHighLowFromBars({
    instrumentId,
    klines: bars,
    asOfDate: baselineDate,
    marketRegime: opts.regime,
  });

  if (!hl?.predictedHigh || !hl?.predictedLow) {
    return { bandTradable: 'pending', sessionDate, baselineDate, source: 'no_prediction' };
  }

  const cmp = rangeArchive.computeRangeComparison({
    predHigh: hl.predictedHigh,
    predLow: hl.predictedLow,
    actualHigh: Number(nextBar.high ?? nextBar.close),
    actualLow: Number(nextBar.low ?? nextBar.close),
    status: 'complete',
  });

  return {
    bandTradable: cmp.bandHit,
    highHit: cmp.highHit,
    lowHit: cmp.lowHit,
    sessionDate,
    baselineDate,
    predHigh: hl.predictedHigh,
    predLow: hl.predictedLow,
    source: 'computed',
    comparison: cmp,
  };
}

function evaluateBandGateForTier(band, tier, ctx = {}) {
  const bandTradable = band?.bandTradable;
  const isLive = isLiveTierId(tier);
  const isRelaxed = liveStrategy.isSimRelaxedTier(tier);

  if (isLive) {
    const bandBlocked = bandTradable === false || bandTradable !== true;
    return {
      bandBlocked,
      bandSoftPass: false,
      bandGateMode: 'strict',
      bandSizeMult: 1,
    };
  }

  if (isRelaxed) {
    const simMode = resolveBandSimMode();
    return evaluateBandSimRelaxation(band, simMode, ctx);
  }

  // sim_balanced 'strict band miss block
  return {
    bandBlocked: bandTradable === false,
    bandSoftPass: false,
    bandGateMode: 'strict',
    bandSizeMult: 1,
  };
}

/**
 * Full quant gate evaluation.
 * @param {object} ctx
 * @param {object} ctx.filterOut 'philosophy filter output
 * @param {object} [ctx.modelC] 'existing Model C output
 * @param {string} ctx.instrumentId
 * @param {Array} [ctx.bars]
 * @param {number} [ctx.barIndex]
 * @param {string} [ctx.regime]
 * @param {string} [ctx.sector]
 * @param {object} [ctx.crossMarketCtx]
 * @param {boolean} [ctx.backtestMode]
 * @param {string} [ctx.simTier]
 * @param {string} [ctx.liveTier]
 */
function resolveOutlookCompositeDir(ctx) {
  const score = Number(ctx.compositeScore);
  const sector = ctx.sector;
  if (!Number.isFinite(score) || !sector) return 'neutral';
  const tier = outlookCalibration.scoreToDirectionTier(score, sector);
  if (tier.direction === 'bullish' || tier.direction === 'strong_bullish') return 'bullish';
  if (tier.direction === 'bearish' || tier.direction === 'strong_bearish') return 'bearish';
  return 'neutral';
}

function resolvePrimaryDirection(ctx, filterOut, philDir) {
  if (philDir === 'bullish' || philDir === 'bearish') return philDir;
  const compositeDir = resolveOutlookCompositeDir(ctx);
  if (compositeDir === 'bullish' || compositeDir === 'bearish') return compositeDir;
  const outlookDir = ctx.predictedDir || ctx.outlookDirection;
  if (outlookDir === 'bullish' || outlookDir === 'bearish') return outlookDir;
  const mcDir = ctx.modelC?.intersectionSignal || ctx.modelC?.predictedDir;
  if (mcDir === 'bullish' || mcDir === 'bearish') return mcDir;
  return 'neutral';
}

function scoreFiveLawsMultiplier(lawsOut, hardGate) {
  let mult = lawsOut?.sizeMultiplier ?? 1;
  if (hardGate) return mult;
  if (lawsOut?.pass) return mult;
  if (Number(lawsOut?.alignedCount) > 0) return mult * 0.85;
  return mult * 0.7;
}

function evaluateFundamentalChanGate(ctx = {}) {
  const reasons = [];
  const filterOut = ctx.filterOut;
  const philDir =
    modelCGate.resolveEffectivePhilosophyLabel(filterOut) ||
    filterOut?.philosophyDirection ||
    'neutral';
  const filterPass = Boolean(filterOut?.filterPass);
  const primaryDir = resolvePrimaryDirection(ctx, filterOut, philDir);

  if (primaryDir === 'neutral') {
    reasons.push('philosophy_or_direction_neutral');
    return buildGateResult(false, reasons, ctx, null, null, {
      bandTradable: null,
      quantMode: 'fundamental_chan',
      primaryDirection: primaryDir,
    });
  }
  if (!filterPass) reasons.push('philosophy_filter_advisory');

  const simTier = ctx.simTier || liveStrategy.resolveSimTier();
  const liveTier = ctx.liveTier || liveStrategy.DEFAULT_LIVE_TIER;
  const lawsSim = evaluateFiveLawsForCtx(ctx, primaryDir, simTier);
  const lawsLive = evaluateFiveLawsForCtx(ctx, primaryDir, liveTier);

  const band = resolveBandTradable({
    instrumentId: ctx.instrumentId,
    bars: ctx.bars,
    barIndex: ctx.barIndex,
    regime: ctx.regime,
    backtestMode: ctx.backtestMode,
  });

  const modelC = ctx.modelC || buildModelC(ctx);
  const simBandGate = evaluateBandGateForTier(band, simTier, ctx);
  const liveBandGate = evaluateBandGateForTier(band, liveTier, ctx);

  if (simBandGate.bandSoftPass) reasons.push('band_soft_pass');
  if (band?.bandTradable === false) reasons.push('band_miss_advisory');

  const simReasons = [...reasons];
  const liveReasons = [...reasons];
  if (!lawsLive.pass) {
    liveReasons.push(`law_votes_insufficient:${lawsLive.alignedCount}/${lawsLive.requiredVotes}`);
  }
  if (liveBandGate.bandBlocked) {
    liveReasons.push(band.bandTradable === false ? 'band_miss_no_trade' : 'band_pending');
  }

  const liveTierPass = evaluateModelCTierPass(modelC, ctx, liveTier);
  if (!liveTierPass) liveReasons.push('model_c_tier_fail');

  // Sim/export: 大宗走势研判方向为主；哲'filter 'advisory（缩'标注），不阻'sim'
  const tradableForSim = Boolean(primaryDir !== 'neutral');
  const tradableForLive = Boolean(
    filterPass && primaryDir !== 'neutral' && lawsLive.pass && liveTierPass && !liveBandGate.bandBlocked,
  );

  let sizeMultiplier = scoreFiveLawsMultiplier(lawsSim, false);
  if (simBandGate.bandSizeMult > 0 && simBandGate.bandSizeMult < 1) {
    sizeMultiplier *= simBandGate.bandSizeMult;
  }
  if (band?.bandTradable === false) sizeMultiplier *= 0.9;

  return buildGateResult(tradableForSim, simReasons, ctx, lawsSim, band, {
    tradableForLive,
    liveReasons,
    lawsLive,
    modelC,
    sizeMultiplier,
    simTier,
    liveTier,
    lawsHardGate: false,
    simBandGate,
    liveBandGate,
    quantMode: 'fundamental_chan',
    primaryDirection: primaryDir,
  });
}

function evaluateModelCGate(ctx = {}) {
  const reasons = [];
  const filterOut = ctx.filterOut;
  const philDir =
    modelCGate.resolveEffectivePhilosophyLabel(filterOut) ||
    filterOut?.philosophyDirection ||
    'neutral';
  const filterPass = Boolean(filterOut?.filterPass);

  if (!filterPass || philDir === 'neutral') {
    reasons.push('philosophy_filter_fail');
    return buildGateResult(false, reasons, ctx, null, null, {
      bandTradable: null,
      quantMode: 'model_c_gate',
    });
  }

  const simTier = ctx.simTier || liveStrategy.resolveSimTier();
  const liveTier = ctx.liveTier || liveStrategy.DEFAULT_LIVE_TIER;
  const lawsHardGate = !liveStrategy.isSimRelaxedTier(simTier);

  const lawsSim = evaluateFiveLawsForCtx(ctx, philDir, simTier);
  const lawsLive = evaluateFiveLawsForCtx(ctx, philDir, liveTier);

  if (lawsHardGate && !lawsSim.pass) {
    reasons.push(`law_votes_insufficient:${lawsSim.alignedCount}/${lawsSim.requiredVotes}`);
  }

  const band = resolveBandTradable({
    instrumentId: ctx.instrumentId,
    bars: ctx.bars,
    barIndex: ctx.barIndex,
    regime: ctx.regime,
    backtestMode: ctx.backtestMode,
  });

  const modelC = ctx.modelC || buildModelC(ctx);
  const simTierPass = evaluateModelCTierPass(modelC, ctx, simTier);
  const liveTierPass = evaluateModelCTierPass(modelC, ctx, liveTier);

  if (!simTierPass) {
    if (!modelC?.philosophyFilterPass) reasons.push('philosophy_filter_fail');
    else if (!modelC?.sameSign) reasons.push('model_c_intersection_fail');
    else reasons.push('model_c_tier_fail');
  }

  const simBandGate = evaluateBandGateForTier(band, simTier, ctx);
  const liveBandGate = evaluateBandGateForTier(band, liveTier, ctx);
  const simBandBlock = simBandGate.bandBlocked;
  const liveBandBlock = liveBandGate.bandBlocked;

  const simReasons = [...reasons];
  if (simBandBlock) {
    simReasons.push(band.bandTradable === false ? 'band_miss_no_trade' : 'band_pending');
  } else if (simBandGate.bandSoftPass) {
    simReasons.push('band_soft_pass');
  }

  const liveReasons = [...reasons];
  if (!lawsLive.pass) {
    if (!liveReasons.some((r) => r.startsWith('law_votes'))) {
      liveReasons.push(`law_votes_insufficient:${lawsLive.alignedCount}/${lawsLive.requiredVotes}`);
    }
  }
  if (liveBandBlock) {
    liveReasons.push(band.bandTradable === false ? 'band_miss_no_trade' : 'band_pending');
  }

  const tradableForSim = Boolean(
    filterPass && simTierPass && !simBandBlock && (!lawsHardGate || lawsSim.pass),
  );
  const tradableForLive = Boolean(filterPass && lawsLive.pass && liveTierPass && !liveBandBlock);

  let sizeMultiplier = scoreFiveLawsMultiplier(lawsSim, lawsHardGate);
  if (simBandGate.bandSizeMult > 0 && simBandGate.bandSizeMult < 1) {
    sizeMultiplier *= simBandGate.bandSizeMult;
  }

  return buildGateResult(tradableForSim, simReasons, ctx, lawsSim, band, {
    tradableForLive,
    liveReasons,
    lawsLive,
    modelC,
    sizeMultiplier,
    simTier,
    liveTier,
    lawsHardGate,
    simBandGate,
    liveBandGate,
    quantMode: 'model_c_gate',
    primaryDirection: philDir,
  });
}

function evaluateQuantTradeGate(ctx = {}) {
  if (isFundamentalChanMode()) return evaluateFundamentalChanGate(ctx);
  return evaluateModelCGate(ctx);
}

function evaluateFiveLawsForCtx(ctx, philDir, tier) {
  return fiveLaws.evaluateFiveLaws({
    instrumentId: ctx.instrumentId,
    bars: ctx.bars,
    barIndex: ctx.barIndex,
    regime: ctx.regime || 'trend',
    sector: ctx.sector,
    philosophyDirection: philDir,
    crossMarketCtx: ctx.crossMarketCtx,
    tier,
  });
}

function evaluateModelCTierPass(modelC, ctx, tierId) {
  if (!modelC) return false;
  const tierOut = liveStrategy.evaluateTradability({
    modelCOut: modelC,
    filterOut: ctx.filterOut,
    sector: ctx.sector,
    instrumentId: ctx.instrumentId,
    bars: ctx.bars,
    barIndex: ctx.barIndex,
    tierId,
  });
  return Boolean(tierOut.tradable);
}

function buildModelC(ctx) {
  if (!modelCGate.isEnabled() && !ctx.modelCV2) return null;
  return modelCGate.evaluateModelC(
    {
      filterOut: ctx.filterOut,
      flatRow: ctx.flatRow,
      bars: ctx.bars,
      barIndex: ctx.barIndex,
      sector: ctx.sector,
      instrumentId: ctx.instrumentId,
      oiBehavior: ctx.oiBehavior,
      dirModel: ctx.dirModel,
      flowModel: ctx.flowModel,
    },
    ctx.modelCOpts || {},
  );
}

function buildGateResult(tradableForSim, reasons, ctx, fiveLawsOut, band, extra = {}) {
  const simBandGate = extra.simBandGate ?? {};
  const liveBandGate = extra.liveBandGate ?? {};
  return {
    version: GATE_VERSION,
    quantMode: extra.quantMode ?? resolveQuantMode(),
    primaryDirection: extra.primaryDirection ?? fiveLawsOut?.philosophyDirection ?? null,
    tradableForSim,
    tradableForLive: extra.tradableForLive ?? false,
    tradableSignal: tradableForSim,
    neutralReasons: reasons.length ? reasons : null,
    liveNeutralReasons: extra.liveReasons?.length ? extra.liveReasons : null,
    philosophyDirection: fiveLawsOut?.philosophyDirection ?? extra.primaryDirection ?? null,
    fiveLaws: fiveLawsOut,
    fiveLawsLive: extra.lawsLive ?? null,
    bandTradable: band?.bandTradable ?? null,
    bandHighHit: band?.highHit ?? band?.comparison?.highHit ?? null,
    bandLowHit: band?.lowHit ?? band?.comparison?.lowHit ?? null,
    band: band ?? null,
    bandGateMode: simBandGate.bandGateMode ?? 'strict',
    bandSoftPass: simBandGate.bandSoftPass === true,
    bandBlocked: simBandGate.bandBlocked === true,
    liveBandBlocked: liveBandGate.bandBlocked === true,
    modelC: extra.modelC ?? null,
    sizeMultiplier: extra.sizeMultiplier ?? 1,
    simTier: extra.simTier ?? null,
    liveTier: extra.liveTier ?? null,
    lawsHardGate: extra.lawsHardGate ?? true,
    lawVoteCount: fiveLawsOut?.alignedCount ?? 0,
    requiredVotes: fiveLawsOut?.requiredVotes ?? null,
    volatilityRegime: fiveLawsOut?.volatilityRegime ?? 'mid',
  };
}

/** Merge quant gate into modelC object for simulator/daemon. */
function applyQuantGateToModelC(modelC, gateOut) {
  if (!modelC || !gateOut) return modelC;
  return {
    ...modelC,
    tradableForSim: gateOut.tradableForSim,
    tradableForLive: gateOut.tradableForLive,
    quantGate: gateOut,
    quantGatePass: gateOut.tradableForSim,
    fiveLaws: gateOut.fiveLaws,
    bandTradable: gateOut.bandTradable,
    bandGateMode: gateOut.bandGateMode,
    bandSoftPass: gateOut.bandSoftPass,
    bandBlocked: gateOut.bandBlocked,
    sizeMultiplier: gateOut.sizeMultiplier,
    neutralReasons: gateOut.tradableForSim
      ? modelC.neutralReasons
      : [...new Set([...(gateOut.neutralReasons || []), ...(modelC.neutralReasons || [])])],
    neutralReason: gateOut.tradableForSim ? modelC.neutralReason : gateOut.neutralReasons?.[0] ?? modelC.neutralReason,
  };
}

/** Enrich backtest row with quant gate (call after predictAtBarIndexHistorical). */
function enrichRowWithQuantGate(row, ctx = {}) {
  if (!row) return row;
  const gateOut = evaluateQuantTradeGate({
    filterOut: row.philosophyFilter,
    modelC: row.modelC,
    predictedDir: row.predictedDir,
    outlookDirection: row.predictedDir,
    compositeScore: row.compositeScore,
    instrumentId: row.instrumentId || ctx.instrumentId,
    bars: ctx.bars,
    barIndex: ctx.barIndex,
    regime: row.marketRegime,
    sector: ctx.sector,
    crossMarketCtx: ctx.crossMarketCtx,
    backtestMode: ctx.backtestMode !== false,
    flatRow: ctx.flatRow,
    oiBehavior: row.oiBehavior,
  });
  return {
    ...row,
    modelC: applyQuantGateToModelC(row.modelC, gateOut),
    quantGate: gateOut,
  };
}

module.exports = {
  GATE_VERSION,
  BAND_SOFT_SIZE_MULT,
  BAND_PARTIAL_SIZE_MULT,
  DEFAULT_BAND_MIN_ATR_RATIO,
  clearArchiveCache,
  resolveQuantMode,
  isFundamentalChanMode,
  resolveBandSimMode,
  resolveBandTradable,
  evaluateBandSimRelaxation,
  evaluateBandGateForTier,
  evaluateFundamentalChanGate,
  evaluateModelCGate,
  evaluateQuantTradeGate,
  applyQuantGateToModelC,
  enrichRowWithQuantGate,
};
