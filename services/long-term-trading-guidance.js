/**
 * 大宗走势研判 · 长线交易指导（weeks-to-months'
 * 严禁假数据：缺失结构/基准 'stop null + 待校验；每条决策'dataSource / method / logicChain'
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const outlookTradingGuidance = require('./outlook-trading-guidance');

const LONG_TERM_VERSION = 'v1.46.0-retail-hf';
const MIN_HOLD_DAYS_BY_PHASE = Object.freeze({
  冷淡: 14,
  升温: 7,
  拥挤: 5,
  退潮: 3,
});
const EARLY_STOP_ATR_MULT = 2.0;
const TRAILING_ACTIVATION_PCT = 0.03;
const TRAILING_ATR_MULT = 1.5;

function nowIso() {
  return new Date().toISOString();
}

function getReferencePrice(inst) {
  const px = inst?.price ?? inst?.highLowPrediction?.baseClose ?? inst?.closingPrice ?? null;
  return px != null && !Number.isNaN(Number(px)) ? Number(px) : null;
}

function getSmoothedVol(inst) {
  return inst?.smoothedVol || inst?.factors?.technical?.smoothedVol || null;
}

/** ATR 绝对价位（优'atr14Pct，回退 sigma20'*/
function getAtrPrice(inst, refPrice) {
  const ref = refPrice ?? getReferencePrice(inst);
  if (ref == null || ref <= 0) return null;
  const sv = getSmoothedVol(inst);
  const pct = sv?.atr14Pct ?? sv?.sigma20 ?? null;
  if (pct == null || Number.isNaN(Number(pct))) return null;
  return (ref * Number(pct)) / 100;
}

function primaryStructureHint(inst) {
  const hints = inst?.chanStructureHints;
  if (!hints?.length) return null;
  return hints.find((h) => h.tfKey === '60' || h.tf === '60m') || hints[0];
}

function resolveStructureLevel(inst, bias) {
  const primary = primaryStructureHint(inst);
  if (!primary) return null;
  if (bias === '偏多' && primary.support != null) {
    return {
      price: Number(primary.support),
      source: primary.dataSource || 'chan-structure',
      label: `${primary.tf || primary.tfKey || '结构'} 支撑`,
      asOf: inst.judgementUpdatedAt || null,
    };
  }
  if (bias === '偏空' && primary.resistance != null) {
    return {
      price: Number(primary.resistance),
      source: primary.dataSource || 'chan-structure',
      label: `${primary.tf || primary.tfKey || '结构'} 阻力`,
      asOf: inst.judgementUpdatedAt || null,
    };
  }
  return null;
}

function parseFalsifyPrice(falsify, bias) {
  if (falsify == null) return null;
  if (typeof falsify === 'number' && !Number.isNaN(falsify)) return falsify;
  const text = String(falsify);
  const m = text.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = Number(m[1]);
  if (Number.isNaN(val)) return null;
  if (/below|下破|跌破|低于|支撑/.test(text) && bias === '偏多') return val;
  if (/above|上破|突破|高于|阻力/.test(text) && bias === '偏空') return val;
  if (bias === '偏多' && /stop|止损|失效/.test(text)) return val;
  if (bias === '偏空' && /stop|止损|失效/.test(text)) return val;
  return val;
}

function resolveThesisFalsifyLevel(inst, bias) {
  const theses = inst?.macroSynthesis?.activeTheses || [];
  for (const t of theses) {
    const level = parseFalsifyPrice(t.falsify, bias);
    if (level != null) {
      return {
        price: level,
        source: 'thesis-registry:falsify',
        label: `命题失效 · ${(t.who || t.id || '').slice(0, 24)}`,
        asOf: t.fetchedAt || null,
        thesisId: t.id,
      };
    }
  }
  return null;
}

function resolveRangeBoundary(inst, bias) {
  const hl = inst?.highLowPrediction || inst?.nextDayPrediction;
  if (!hl) return null;
  if (bias === '偏多' && hl.predictedLow != null) {
    return {
      price: Number(hl.predictedLow),
      source: hl.method || hl.modelSource || 'next-day-range',
      label: '风险边界下沿',
      asOf: hl.baselineDate || inst.closingDate || null,
    };
  }
  if (bias === '偏空' && hl.predictedHigh != null) {
    return {
      price: Number(hl.predictedHigh),
      source: hl.method || hl.modelSource || 'next-day-range',
      label: '风险边界上沿',
      asOf: hl.baselineDate || inst.closingDate || null,
    };
  }
  return null;
}

function pickHardStopLevel(inst, bias) {
  const candidates = [
    resolveStructureLevel(inst, bias),
    resolveThesisFalsifyLevel(inst, bias),
    resolveRangeBoundary(inst, bias),
  ].filter(Boolean);
  if (!candidates.length) return null;
  const ref = getReferencePrice(inst);
  if (ref == null) return candidates[0];

  if (bias === '偏多') {
    return candidates.reduce((best, c) => (c.price < best.price ? c : best));
  }
  if (bias === '偏空') {
    return candidates.reduce((best, c) => (c.price > best.price ? c : best));
  }
  return candidates[0];
}

function deriveThesisStatus(inst, bias) {
  const theses = inst?.macroSynthesis?.activeTheses || [];
  const overshoot = theses.some((t) => t.status === 'overshoot' || t.status === 'falsified');
  if (overshoot) return { status: 'falsified', evidence: '活跃命题 overshoot/失效', dataSource: 'thesis-registry' };

  const ref = getReferencePrice(inst);
  for (const t of theses) {
    const level = parseFalsifyPrice(t.falsify, bias);
    if (level == null || ref == null) continue;
    if (bias === '偏多' && ref < level) {
      return { status: 'falsified', evidence: `现价低于命题失效'${level}`, dataSource: 'thesis-registry:falsify' };
    }
    if (bias === '偏空' && ref > level) {
      return { status: 'falsified', evidence: `现价高于命题失效'${level}`, dataSource: 'thesis-registry:falsify' };
    }
  }

  const phase = inst?.tradingGuidance?.phase;
  const tier = inst?.globalRiskRegime === 'shock' ? 'L3' : null;
  if (phase === '退潮' || tier === 'L3') {
    return { status: 'weakening', evidence: phase === '退潮' ? 'phase=退' : 'global L3', dataSource: 'phase+globalRisk' };
  }
  return { status: 'intact', evidence: `${theses.length} 条活跃命题未触发失效`, dataSource: 'thesis-registry' };
}

function deriveSuggestedEntryZone(inst, bias) {
  const hl = inst?.highLowPrediction || inst?.nextDayPrediction;
  const struct = primaryStructureHint(inst);
  const ref = getReferencePrice(inst);

  if (bias === '偏多') {
    const low = struct?.support ?? hl?.predictedLow ?? null;
    const high = ref ?? hl?.predictedMid ?? hl?.predictedHigh ?? null;
    if (low != null && high != null && Number(low) <= Number(high)) {
      return {
        low: Number(low),
        high: Number(high),
        method: struct?.support != null ? 'chan-structure+price' : 'range-boundary',
        dataSource: struct?.dataSource || hl?.method || hl?.modelSource || 'highLowPrediction',
      };
    }
  }
  if (bias === '偏空') {
    const high = struct?.resistance ?? hl?.predictedHigh ?? null;
    const low = ref ?? hl?.predictedMid ?? hl?.predictedLow ?? null;
    if (low != null && high != null && Number(low) <= Number(high)) {
      return {
        low: Number(low),
        high: Number(high),
        method: struct?.resistance != null ? 'chan-structure+price' : 'range-boundary',
        dataSource: struct?.dataSource || hl?.method || hl?.modelSource || 'highLowPrediction',
      };
    }
  }
  return null;
}

function assessRiskOfEarlyStop(refPrice, stopPrice, atrPrice, bias) {
  if (refPrice == null || stopPrice == null || atrPrice == null || atrPrice <= 0) {
    return { level: null, evidence: '基准/止损/ATR 待校', dataSource: 'atr-check' };
  }
  const distance = Math.abs(refPrice - stopPrice);
  const ratio = distance / atrPrice;
  if (ratio < EARLY_STOP_ATR_MULT) {
    return {
      level: 'high',
      evidence: `止损'${distance.toFixed(2)} < ${EARLY_STOP_ATR_MULT}×ATR(${atrPrice.toFixed(2)}) · 长线易扫损`,
      dataSource: 'smoothedVol:atr14Pct|sigma20',
    };
  }
  if (ratio < EARLY_STOP_ATR_MULT * 1.5) {
    return {
      level: 'medium',
      evidence: `止损'${ratio.toFixed(2)}×ATR · 偏紧`,
      dataSource: 'smoothedVol:atr14Pct|sigma20',
    };
  }
  return {
    level: 'low',
    evidence: `止损'${ratio.toFixed(2)}×ATR · 适合长线`,
    dataSource: 'smoothedVol:atr14Pct|sigma20',
  };
}

function deriveHardStop(inst, bias, logicChain) {
  const asOf = nowIso();
  const level = pickHardStopLevel(inst, bias);
  if (!level?.price) {
    logicChain.push({
      layer: 'HardStop',
      conclusion: '待校验',
      evidence: '无结构化命题/区间失效',
      dataSource: 'chanStructure|thesis|range',
      asOf,
    });
    return {
      hardStop: null,
      stopType: null,
      rationale: '待校验 · 缺少可审计结构位',
      riskOfEarlyStop: 'medium',
    };
  }

  const ref = getReferencePrice(inst);
  const atrPrice = getAtrPrice(inst, ref);
  const early = assessRiskOfEarlyStop(ref, level.price, atrPrice, bias);
  const stopType = level.source.includes('thesis') ? 'thesis-falsify' : level.source.includes('chan') ? 'structure' : 'structure';

  logicChain.push({
    layer: 'HardStop',
    conclusion: level.price,
    evidence: `${level.label} @ ${level.price} (${level.source})`,
    dataSource: level.source,
    asOf: level.asOf || asOf,
  });

  return {
    hardStop: level.price,
    stopType,
    rationale: `${level.label} · ${stopType} · ${level.source}`,
    riskOfEarlyStop: early.level || 'medium',
    earlyStopEvidence: early.evidence,
  };
}

function liquidityTierRank(tier) {
  const map = { L0: 0, L1: 1, L2: 2, L3: 3 };
  return map[tier] ?? 0;
}

function deriveSoftStop(inst, bias, phase, globalRisk, logicChain) {
  const asOf = nowIso();
  const tierRank = liquidityTierRank(globalRisk?.tier || globalRisk?.liquidityShockTier || 'L0');
  if (phase !== '退' && tierRank < 2 && globalRisk?.regime !== 'shock') {
    return { softStop: null, rationale: null };
  }

  const struct = resolveStructureLevel(inst, bias);
  const ref = getReferencePrice(inst);
  const atrPrice = getAtrPrice(inst, ref);
  let softPrice = null;
  let rationale = '';

  if (phase === '退潮') {
    rationale = 'phase=退潮 · 资金退潮预警线';
    if (struct?.price != null && ref != null && atrPrice != null) {
      softPrice = bias === '偏多' ? struct.price + atrPrice * 0.5 : struct.price - atrPrice * 0.5;
    } else if (struct?.price != null) {
      softPrice = struct.price;
    }
  }

  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier;
  if (tier === 'L2' || tier === 'L3' || globalRisk?.regime === 'shock') {
    rationale = rationale ? `${rationale} · global ${tier || globalRisk?.regime}` : `global ${tier || globalRisk?.regime} 预警`;
    if (ref != null && atrPrice != null) {
      const warn = bias === '偏多' ? ref - atrPrice : bias === '偏空' ? ref + atrPrice : null;
      if (warn != null) softPrice = softPrice != null ? (bias === '偏多' ? Math.max(softPrice, warn) : Math.min(softPrice, warn)) : warn;
    }
  }

  if (softPrice != null) {
    logicChain.push({
      layer: 'SoftStop',
      conclusion: +softPrice.toFixed(4),
      evidence: rationale,
      dataSource: 'phase+globalRisk+structure',
      asOf: globalRisk?.asOf || asOf,
    });
  }

  return {
    softStop: softPrice != null ? +Number(softPrice).toFixed(4) : null,
    rationale: softPrice != null ? rationale : null,
  };
}

function deriveTrailingStop(inst, bias, hardStop, logicChain) {
  const ref = getReferencePrice(inst);
  const atrPrice = getAtrPrice(inst, ref);
  if (ref == null || atrPrice == null) {
    return { trailingStop: null, method: null, rationale: null };
  }

  const struct = resolveStructureLevel(inst, bias);
  let movePct = 0;
  if (bias === '偏多' && struct?.price != null && ref > struct.price) {
    movePct = (ref - struct.price) / struct.price;
  } else if (bias === '偏空' && struct?.price != null && ref < struct.price) {
    movePct = (struct.price - ref) / struct.price;
  } else if (bias === '偏多') {
    movePct = TRAILING_ACTIVATION_PCT;
  } else if (bias === '偏空') {
    movePct = TRAILING_ACTIVATION_PCT;
  }

  if (movePct < TRAILING_ACTIVATION_PCT) {
    return {
      trailingStop: null,
      method: 'atr-structure-ratchet',
      rationale: `浮盈 ${(movePct * 100).toFixed(1)}% 未达 ${TRAILING_ACTIVATION_PCT * 100}% 激活阈值`,
    };
  }

  const trail =
    bias === '偏多'
      ? ref - atrPrice * TRAILING_ATR_MULT
      : bias === '偏空'
        ? ref + atrPrice * TRAILING_ATR_MULT
        : null;

  if (trail == null) return { trailingStop: null, method: null, rationale: null };

  let finalTrail = trail;
  if (hardStop != null) {
    finalTrail = bias === '偏多' ? Math.max(trail, hardStop) : Math.min(trail, hardStop);
  }

  logicChain.push({
    layer: 'TrailingStop',
    conclusion: +finalTrail.toFixed(4),
    evidence: `${TRAILING_ATR_MULT}×ATR ratchet · 激'${(movePct * 100).toFixed(1)}%`,
    dataSource: 'smoothedVol:atr-ratchet',
    asOf: nowIso(),
  });

  return {
    trailingStop: +Number(finalTrail).toFixed(4),
    method: 'atr-structure-ratchet',
    rationale: `浮盈达标 · ${TRAILING_ATR_MULT}×ATR 结构棘轮`,
  };
}

function deriveEntryReadiness(inst, tg, globalRisk, thesisStatus, bias, phase) {
  const conditions = [];
  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier || 'L0';
  const posture = tg?.posture;

  conditions.push({
    met: bias !== '震荡',
    label: '方向明确',
    evidence: tg?.bias || bias || '暂无',
    dataSource: 'outlook-direction',
  });
  conditions.push({
    met: phase === '升温',
    label: '资金升温（非拥挤',
    evidence: tg?.phase || phase || '暂无',
    dataSource: 'capitalAttention+smoothedVol',
  });
  conditions.push({
    met: tier !== 'L3' && globalRisk?.regime !== 'shock',
    label: '全球风险允许',
    evidence: `${tier} · ${globalRisk?.regime || 'normal'}`,
    dataSource: 'global-liquidity-risk',
  });
  conditions.push({
    met: thesisStatus.status !== 'falsified',
    label: '命题未失',
    evidence: thesisStatus.evidence,
    dataSource: thesisStatus.dataSource,
  });

  let readiness = 'not-ready';
  let reason = '条件未满';

  if (posture === '禁止' || tier === 'L3' || thesisStatus.status === 'falsified') {
    readiness = 'not-ready';
    reason =
      posture === '禁止'
        ? 'posture=禁止'
        : tier === 'L3'
          ? '全球流动性 L3'
          : '命题已失';
  } else if (phase === '冷淡' && bias !== '震荡') {
    readiness = 'approaching';
    reason = '方向明确 · 等待资金升温确认';
  } else if (
    ['试仓', '持有', '加仓'].includes(posture) &&
    phase === '升温' &&
    bias !== '震荡' &&
    thesisStatus.status === 'intact'
  ) {
    readiness = 'ready';
    reason = `${bias} · ${phase} · ${posture}`;
  } else if (phase === '拥挤' && ['持有', '试仓'].includes(posture)) {
    readiness = 'approaching';
    reason = '拥挤期 · 不宜追价新开';
  } else if (posture === '平仓' || posture === '减仓') {
    readiness = 'missed';
    reason = `${posture} · 结构或阶段已转向`;
  } else {
    readiness = 'not-ready';
    reason = `${posture || ''} · ${phase || ''}`;
  }

  const zone = deriveSuggestedEntryZone(inst, bias);
  if (readiness === 'ready' && zone && getReferencePrice(inst) != null) {
    const ref = getReferencePrice(inst);
    if (bias === '偏多' && ref > zone.high * 1.02) {
      readiness = 'missed';
      reason = '价格已偏离建议入场区上沿';
    }
    if (bias === '偏空' && ref < zone.low * 0.98) {
      readiness = 'missed';
      reason = '价格已偏离建议入场区下沿';
    }
  }

  return { readiness, reason, conditions, suggestedEntryZone: zone };
}

function deriveHoldGuidance(inst, bias, phase, thesisStatus, hardStop) {
  const minHoldDays = MIN_HOLD_DAYS_BY_PHASE[phase] ?? 7;
  const struct = resolveStructureLevel(inst, bias);
  const addPoint = struct?.price ?? null;
  let reducePoint = null;
  const hl = inst?.highLowPrediction;
  if (bias === '偏多' && hl?.predictedHigh != null) reducePoint = Number(hl.predictedHigh);
  if (bias === '偏空' && hl?.predictedLow != null) reducePoint = Number(hl.predictedLow);

  return {
    minHoldDays,
    thesisStatus: thesisStatus.status,
    thesisEvidence: thesisStatus.evidence,
    addPoint,
    reducePoint,
    addSource: struct?.source || null,
    reduceSource: hl?.method || hl?.modelSource || null,
  };
}

function deriveRewardRisk(inst, bias, hardStop) {
  const ref = getReferencePrice(inst);
  if (ref == null || hardStop == null) return null;
  const hl = inst?.highLowPrediction;
  let target = null;
  if (bias === '偏多' && hl?.predictedHigh != null) target = Number(hl.predictedHigh);
  if (bias === '偏空' && hl?.predictedLow != null) target = Number(hl.predictedLow);
  if (target == null) return null;

  const risk = Math.abs(ref - hardStop);
  const reward = Math.abs(target - ref);
  if (risk <= 0) return null;

  return {
    ratio: +(reward / risk).toFixed(2),
    targetZone: { low: Math.min(ref, target), high: Math.max(ref, target) },
    method: 'range-boundary-vs-hard-stop',
    dataSource: hl?.method || hl?.modelSource || 'highLowPrediction',
  };
}

/**
 * @param {object} inst
 * @param {object} context '{ globalRisk, tradingGuidance }
 */
function buildLongTermGuidance(inst, context = {}) {
  if (!inst?.id) return null;
  if (!outlookTradingGuidance.isPilotSymbol(inst.id)) {
    return { pilot: false, dataSource: 'long-term-trading-guidance', method: 'stub-non-pilot' };
  }

  const asOf = nowIso();
  const logicChain = [];
  const globalRisk = context.globalRisk || inst.globalRisk || null;
  const tg = context.tradingGuidance || outlookTradingGuidance.buildTradingGuidance(inst, { globalRisk });
  if (!tg?.pilot) {
    return { pilot: false, dataSource: 'long-term-trading-guidance', method: 'stub-non-pilot' };
  }

  const bias = tg.bias;
  const phase = tg.phase === '暂无' ? null : tg.phase;
  const thesisStatus = deriveThesisStatus(inst, bias);

  logicChain.push({
    layer: 'Synthesis',
    conclusion: 'long-term',
    evidence: `posture=${tg.posture} · phase=${phase || ''} · thesis=${thesisStatus.status}`,
    dataSource: 'bias-phase-thesis-globalRisk',
    asOf,
  });

  const hardPack = deriveHardStop(inst, bias, logicChain);
  const softPack = deriveSoftStop(inst, bias, phase, globalRisk, logicChain);
  const trailPack = deriveTrailingStop(inst, bias, hardPack.hardStop, logicChain);
  const entry = deriveEntryReadiness(inst, tg, globalRisk, thesisStatus, bias, phase);
  const hold = deriveHoldGuidance(inst, bias, phase, thesisStatus, hardPack.hardStop);
  const rewardRisk = deriveRewardRisk(inst, bias, hardPack.hardStop);

  let positionPctCap = null;
  let scoutSizeMultiplier = 1;
  try {
    const { assessRetailPositionQuality } = require('./retail-hf-strategy');
    const retailQ = inst.integratedSpec?.retailHf?.exitLiquidity
      ? { exitLiquidity: inst.integratedSpec.retailHf.exitLiquidity, convexity: inst.integratedSpec.retailHf.convexity }
      : assessRetailPositionQuality(inst, { tradingGuidance: tg, integratedSpec: inst.integratedSpec, globalRisk });
    scoutSizeMultiplier = retailQ.exitLiquidity?.scoutSizeMultiplier ?? 1;
    positionPctCap = retailQ.exitLiquidity?.positionPctCap ?? Math.round(100 * scoutSizeMultiplier);
    if (scoutSizeMultiplier < 1) {
      logicChain.push({
        layer: 'RetailExitLiquidity',
        conclusion: `scout×${scoutSizeMultiplier}`,
        evidence: retailQ.convexity?.evidence?.join(' · ') || '滑点/凸性 cap',
        dataSource: 'retail-hf-strategy',
        asOf,
      });
    }
  } catch {
    // non-fatal
  }

  if (hardPack.riskOfEarlyStop === 'high') {
    logicChain.push({
      layer: 'RiskFlag',
      conclusion: '观望',
      evidence: hardPack.earlyStopEvidence || '止损过紧',
      dataSource: 'long-term-trading-guidance:early-stop',
      asOf,
    });
  }

  return {
    horizon: 'weeks-to-months',
    entry,
    stop: {
      hardStop: hardPack.hardStop,
      softStop: softPack.softStop,
      trailingStop: trailPack.trailingStop,
      stopType: hardPack.stopType,
      rationale: hardPack.rationale,
      softRationale: softPack.rationale,
      trailingMethod: trailPack.method,
      trailingRationale: trailPack.rationale,
      riskOfEarlyStop: hardPack.riskOfEarlyStop,
      logicChain,
    },
    hold,
    rewardRisk,
    positionPctCap,
    scoutSizeMultiplier,
    posture: tg.posture,
    phase: tg.phase,
    bias: tg.bias,
    globalRiskCap: tg.globalRiskCap || null,
    dataSource: 'long-term-trading-guidance',
    method: 'fundamental-phase-thesis-globalRisk→posture→longTerm',
    version: LONG_TERM_VERSION,
    pilot: true,
    asOf,
  };
}

function refreshLongTermGuidance(inst, context = {}) {
  const tg = context.tradingGuidance || inst.tradingGuidance;
  return buildLongTermGuidance(inst, { ...context, tradingGuidance: tg });
}

function patchInstrumentsLongTermGuidance(instruments, context = {}) {
  if (!instruments?.length) return instruments;
  return instruments.map((inst) => {
    if (!outlookTradingGuidance.isPilotSymbol(inst.id)) return inst;
    const longTermGuidance = refreshLongTermGuidance(inst, context);
    return longTermGuidance ? { ...inst, longTermGuidance } : inst;
  });
}

function patchPilotGuidance(instruments, context = {}) {
  if (!instruments?.length) return instruments;
  return instruments.map((inst) => {
    if (!outlookTradingGuidance.isPilotSymbol(inst.id)) return inst;
    const tradingGuidance = outlookTradingGuidance.refreshTradingGuidance(inst, context);
    const longTermGuidance = refreshLongTermGuidance(
      { ...inst, tradingGuidance },
      { ...context, tradingGuidance }
    );
    return { ...inst, tradingGuidance, longTermGuidance };
  });
}

module.exports = {
  LONG_TERM_VERSION,
  MIN_HOLD_DAYS_BY_PHASE,
  EARLY_STOP_ATR_MULT,
  buildLongTermGuidance,
  refreshLongTermGuidance,
  patchInstrumentsLongTermGuidance,
  patchPilotGuidance,
  getAtrPrice,
  deriveThesisStatus,
};
