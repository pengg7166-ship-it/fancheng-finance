/**
 * 大宗走势研判 · 交易指导合成（Phase A pilot'
 * 严禁假数据：缺失'posture=禁止/观望，position=null，logicChain 标注来源'
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const outlookCalibration = require('./commodity-outlook-calibration');
const { USER_FOCUS_SET, listUserFocusSymbols } = require('./user-focus-symbols');
const { resolveInvalidateFromPct } = require('./outlook-prediction-utils');

/** 用户关注品种池 — 每日分析与交易指导覆盖范围 */
const PILOT_SYMBOLS = USER_FOCUS_SET;

const POSTURES = Object.freeze(['禁止', '观望', '试仓', '持有', '加仓', '减仓', '平仓']);
const PHASES = Object.freeze(['冷淡', '升温', '拥挤', '退']);
const RISK_BUDGET_PCT = 1;
const GUIDANCE_VERSION = 'v1.42.0-integrated-spec';
const POSTURE_DOWNGRADE_MIN_MS = 5 * 60 * 1000;

/** Per-symbol hysteresis 'avoids 90s posture flip-flop on downgrades */
const postureHysteresisState = new Map();

/** Posture 攻击性排序（越高越激进）；cap 取更保守 */
const POSTURE_RANK = Object.freeze({
  禁止: 0,
  观望: 1,
  平仓: 1,
  减仓: 2,
  试仓: 3,
  持有: 4,
  加仓: 5,
});

/**
 * L0–L3 全球流动'tier 'pilot 品种 posture 上限（决策表'
 * L0 normal: 无约'(max 加仓)
 * L1 tightening: AG/AU/LC/SC 试仓; CU/RB/I/HC 观望
 * L2 deleveraging: 叙事观望; CU/RB/I/HC 禁止; SC 观望
 * L3 shock: 全部禁止
 */
const POSTURE_CAPS = Object.freeze({
  L0: {
    ag: '加仓',
    au: '加仓',
    lc: '加仓',
    cu: '加仓',
    sc: '加仓',
    rb: '加仓',
    i: '加仓',
    hc: '加仓',
  },
  L1: {
    ag: '试仓',
    au: '试仓',
    lc: '试仓',
    cu: '观望',
    sc: '试仓',
    rb: '观望',
    i: '观望',
    hc: '观望',
  },
  L2: {
    ag: '观望',
    au: '观望',
    lc: '观望',
    cu: '禁止',
    sc: '观望',
    rb: '禁止',
    i: '禁止',
    hc: '禁止',
  },
  L3: {
    ag: '禁止',
    au: '禁止',
    lc: '禁止',
    cu: '禁止',
    sc: '禁止',
    rb: '禁止',
    i: '禁止',
    hc: '禁止',
  },
});

/** @deprecated alias */
const POSTURE_CAP_BY_TIER = POSTURE_CAPS;

const NARRATIVE_SYMBOLS = new Set(['ag', 'au', 'pt', 'pd', 'lc', 'sc']);
const INDUSTRIAL_SYMBOLS = new Set(['cu', 'al', 'zn', 'pb', 'ni', 'sn', 'ao', 'rb', 'i', 'hc', 'jm', 'fg']);
const AGRICULTURE_SYMBOLS = new Set(['m', 'y', 'rm', 'oi', 'p', 'cf', 'sr', 'jd', 'lh']);

/** 未在 POSTURE_CAPS 显式列出的品种，按板块与 tier 取默认上限 */
const TIER_BUCKET_DEFAULT_CAP = Object.freeze({
  L1: { narrative: '试仓', industrial: '观望', agriculture: '观望', other: '观望' },
  L2: { narrative: '观望', industrial: '禁止', agriculture: '观望', other: '观望' },
  L3: { narrative: '禁止', industrial: '禁止', agriculture: '禁止', other: '禁止' },
});

function symbolBucket(id) {
  if (NARRATIVE_SYMBOLS.has(id)) return 'narrative';
  if (INDUSTRIAL_SYMBOLS.has(id)) return 'industrial';
  if (AGRICULTURE_SYMBOLS.has(id)) return 'agriculture';
  return 'other';
}

function REGIME_TO_TIER_FROM_RISK(globalRisk) {
  const regime = globalRisk?.regime || globalRisk?.globalRiskRegime || 'normal';
  if (regime === 'normal') return 'L0';
  if (regime === 'shock') return 'L3';
  if (regime === 'deleveraging') return 'L2';
  if (regime === 'tightening') return 'L1';
  return 'L0';
}

function isPilotSymbol(instrumentId) {
  return PILOT_SYMBOLS.has(normalizeCommodityId(instrumentId));
}

function pilotSymbolList() {
  return listUserFocusSymbols();
}

function nowIso() {
  return new Date().toISOString();
}

function deriveBias(inst) {
  const label = String(inst.directionLabel || '');
  if (/强多|偏多/.test(label)) return '偏多';
  if (/强空|偏空/.test(label)) return '偏空';
  const tier = inst.directionTier || inst.direction;
  if (tier === 'strong_bullish' || tier === 'bullish') return '偏多';
  if (tier === 'strong_bearish' || tier === 'bearish') return '偏空';
  const primary = inst.philosophy?.ranked?.primary?.[0];
  if (primary?.direction === 'bullish') return '偏多';
  if (primary?.direction === 'bearish') return '偏空';
  return '震荡';
}

function volPercentile(smoothedVol) {
  if (smoothedVol?.percentile != null && !Number.isNaN(Number(smoothedVol.percentile))) {
    return Number(smoothedVol.percentile);
  }
  return null;
}

function isVolLow(smoothedVol) {
  const pct = volPercentile(smoothedVol);
  if (pct != null) return pct < 40;
  return smoothedVol?.regime === 'low';
}

function derivePhase(capitalAttention, smoothedVol, inst) {
  const overshootThesis = (inst?.macroSynthesis?.activeTheses || []).find(
    (t) => t.status === 'overshoot' || t.overshootMeta
  );
  if (overshootThesis) {
    const claim = (overshootThesis.claim || '').slice(0, 80);
    return {
      phase: '退',
      evidence: `叙事 overshoot · ${claim || overshootThesis.id}`,
      dataSource: 'thesis-registry:overshoot',
    };
  }

  const att = capitalAttention?.score;
  if (att == null) {
    return { phase: null, evidence: '资金关注 score 暂无', dataSource: 'capitalAttention' };
  }
  const pct = volPercentile(smoothedVol);
  const volRising = smoothedVol?.volRising === true;
  const volSpike = volRising && pct != null && pct >= 65;

  if (att > 70) {
    if (volSpike) {
      return {
        phase: '退',
        evidence: `资金${att}/100 高位回落信号 · 波动分位${Math.round(pct)}%`,
        dataSource: 'capitalAttention+smoothedVol',
      };
    }
    return { phase: '拥挤', evidence: `资金关注 ${att}/100`, dataSource: 'capitalAttention' };
  }
  if (volSpike && att >= 45) {
    return {
      phase: '退',
      evidence: `波动放大${pct != null ? `(${Math.round(pct)}%分位)` : ''} · 资金${att}`,
      dataSource: 'smoothedVol+capitalAttention',
    };
  }
  if ((att >= 40 && att <= 70) || volRising) {
    return {
      phase: '升温',
      evidence: volRising ? `量比/波动上行 · 资金${att}` : `资金升温 ${att}/100`,
      dataSource: volRising ? 'smoothedVol+capitalAttention' : 'capitalAttention',
    };
  }
  if (att < 40 && isVolLow(smoothedVol)) {
    return {
      phase: '冷淡',
      evidence: `资金${att}/100 · 波动偏低${pct != null ? `(${Math.round(pct)}%分位)` : ''}`,
      dataSource: 'capitalAttention+smoothedVol',
    };
  }
  return { phase: '冷淡', evidence: `资金${att}/100`, dataSource: 'capitalAttention' };
}

function biasPhaseConflict(bias, phase) {
  if (!phase) return true;
  if (bias === '震荡' && (phase === '升温' || phase === '拥挤')) return true;
  return false;
}

function structureBroken(inst, bias) {
  const hints = inst.chanStructureHints;
  if (!hints?.length) return { broken: false, reason: null };
  const price = inst.price ?? inst.highLowPrediction?.baseClose ?? null;
  if (price == null) return { broken: false, reason: null };
  const primary = hints.find((h) => h.tfKey === '60' || h.tf === '60m') || hints[0];
  if (!primary) return { broken: false, reason: null };
  if (bias === '偏多' && primary.support != null && price < Number(primary.support)) {
    return { broken: true, reason: `${primary.tf || primary.tfKey} 支撑失守` };
  }
  if (bias === '偏空' && primary.resistance != null && price > Number(primary.resistance)) {
    return { broken: true, reason: `${primary.tf || primary.tfKey} 阻力突破` };
  }
  return { broken: false, reason: null };
}

function resolveInvalidate(inst, bias) {
  const hl = inst.highLowPrediction || inst.nextDayPrediction;
  if (bias === '偏多' && hl?.predictedLow != null) {
    return { price: Number(hl.predictedLow), source: hl.method || hl.modelSource || 'next-day-range', asOf: hl.baselineDate || inst.closingDate || null };
  }
  if (bias === '偏空' && hl?.predictedHigh != null) {
    return { price: Number(hl.predictedHigh), source: hl.method || hl.modelSource || 'next-day-range', asOf: hl.baselineDate || inst.closingDate || null };
  }
  const pctInv = resolveInvalidateFromPct(inst, bias);
  if (pctInv?.price != null) return pctInv;
  const hints = inst.chanStructureHints;
  if (hints?.length) {
    const primary = hints.find((h) => h.tfKey === '60' || h.tf === '60m') || hints[0];
    if (bias === '偏多' && primary?.support != null) {
      return { price: Number(primary.support), source: primary.dataSource || 'chan-structure', asOf: inst.judgementUpdatedAt || null };
    }
    if (bias === '偏空' && primary?.resistance != null) {
      return { price: Number(primary.resistance), source: primary.dataSource || 'chan-structure', asOf: inst.judgementUpdatedAt || null };
    }
  }
  return null;
}

function derivePosture(ctx) {
  const { inst, bias, phase, phaseInfo, tradable, structure, logicChain } = ctx;
  const asOf = nowIso();

  if (inst.outlookPending || inst.insufficientData) {
    logicChain.push({
      layer: '数据',
      conclusion: '禁止',
      evidence: inst.outlookPending ? '行情待加' : '数据源不',
      dataSource: 'outlook-engine',
      asOf,
    });
    return '禁止';
  }

  if (!phase) {
    logicChain.push({
      layer: '阶段',
      conclusion: '禁止',
      evidence: phaseInfo?.evidence || '阶段指标暂无',
      dataSource: phaseInfo?.dataSource || 'capitalAttention',
      asOf,
    });
    return '禁止';
  }

  if (inst.regimeGate?.gated && inst.regimeGate?.emit === false) {
    logicChain.push({
      layer: 'RegimeGate',
      conclusion: '观望',
      evidence: inst.regimeGate.gateReason || inst.regimeGate.reasons?.join(' · ') || 'regime 抑制方向输出',
      dataSource: inst.regimeGate.dataSource || 'regime-gate',
      asOf,
    });
    return '观望';
  }

  if (inst.quantGate && tradable === false) {
    const reason = inst.quantGate.neutralReasons?.[0] || 'quant gate 未通过';
    logicChain.push({
      layer: 'Gate',
      conclusion: '禁止',
      evidence: reason,
      dataSource: 'quantGate',
      asOf,
    });
    return '禁止';
  }

  if (inst.philosophyFilter?.filterPass === false) {
    logicChain.push({
      layer: '哲学',
      conclusion: '禁止',
      evidence: inst.philosophyFilter.neutralReason || '哲学 filter 中性化',
      dataSource: 'philosophyFilter',
      asOf,
    });
    return '禁止';
  }

  const conflictCount = inst.contradictionMatrix?.conflictCount ?? 0;
  if (conflictCount >= 4) {
    logicChain.push({
      layer: '矛盾矩阵',
      conclusion: '观望',
      evidence: inst.contradictionMatrix?.summary || `${conflictCount} 组矛盾，证伪条件优先`,
      dataSource: 'contradiction-matrix',
      asOf,
    });
    return '观望';
  }

  if (biasPhaseConflict(bias, phase)) {
    logicChain.push({
      layer: '合成',
      conclusion: '禁止',
      evidence: `bias=${bias} 'phase=${phase} 冲突`,
      dataSource: 'bias-phase-composite',
      asOf,
    });
    return '禁止';
  }

  if (structure.broken) {
    logicChain.push({
      layer: '结构',
      conclusion: '平仓',
      evidence: structure.reason,
      dataSource: 'chanStructureHints',
      asOf,
    });
    return '平仓';
  }

  const fiveLaws = inst.quantGate?.fiveLaws;
  if (fiveLaws && fiveLaws.pass === false && fiveLaws.hardFail) {
    logicChain.push({
      layer: '五法',
      conclusion: '禁止',
      evidence: fiveLaws.summary || '五法·hard fail',
      dataSource: 'fiveLaws',
      asOf,
    });
    return '禁止';
  }

  if (phase === '冷淡') {
    logicChain.push({
      layer: '阶段',
      conclusion: '观望',
      evidence: phaseInfo.evidence,
      dataSource: phaseInfo.dataSource,
      asOf,
    });
    return bias === '震荡' ? '观望' : '观望';
  }

  if (phase === '退潮') {
    logicChain.push({
      layer: '阶段',
      conclusion: '减仓',
      evidence: phaseInfo.evidence,
      dataSource: phaseInfo.dataSource,
      asOf,
    });
    return '减仓';
  }

  if (phase === '拥挤') {
    let posture = bias !== '震荡' ? '持有' : '观望';
    if (conflictCount >= 2 && posture === '持有') {
      posture = '试仓';
      logicChain.push({
        layer: '矛盾矩阵',
        conclusion: '试仓上限',
        evidence: `${conflictCount} 组矛盾 · 拥挤区降档`,
        dataSource: 'contradiction-matrix',
        asOf,
      });
    }
    logicChain.push({
      layer: '阶段',
      conclusion: posture,
      evidence: `${phaseInfo.evidence} · 拥挤区`,
      dataSource: phaseInfo.dataSource,
      asOf,
    });
    return posture;
  }

  if (phase === '升温' && bias !== '震荡' && tradable !== false) {
    if (conflictCount >= 2) {
      logicChain.push({
        layer: '矛盾矩阵',
        conclusion: '试仓上限',
        evidence: inst.contradictionMatrix?.summary || `${conflictCount} 组矛盾`,
        dataSource: 'contradiction-matrix',
        asOf,
      });
    }
    logicChain.push({
      layer: '合成',
      conclusion: '试仓',
      evidence: `${bias} · ${phaseInfo.evidence}`,
      dataSource: 'bias-phase-gate-composite',
      asOf,
    });
    return '试仓';
  }

  logicChain.push({
    layer: '合成',
    conclusion: '观望',
    evidence: `${bias} · ${phase}`,
    dataSource: 'bias-phase-gate-composite',
    asOf,
  });
  return '观望';
}

function derivePosition(posture, inst, bias, logicChain) {
  const asOf = nowIso();
  if (!['试仓', '持有', '加仓'].includes(posture)) {
    return null;
  }
  const inv = resolveInvalidate(inst, bias);
  if (!inv?.price) {
    logicChain.push({
      layer: '仓位',
      conclusion: '待校验',
      evidence: '无有效 invalidate 价位/结构',
      dataSource: 'nextDayRangePct|chanStructure',
      asOf,
    });
    return { pct: null, method: 'risk-budget-1pct', invalidate: null, note: '待校验' };
  }
  logicChain.push({
    layer: '仓位',
    conclusion: `${RISK_BUDGET_PCT}% 风险预算`,
    evidence: `invalidate @ ${inv.price} (${inv.source})`,
    dataSource: inv.source,
    asOf: inv.asOf || asOf,
  });
  return {
    pct: RISK_BUDGET_PCT,
    method: 'risk-budget-1pct',
    invalidate: inv.price,
    note: `账户风险 ${RISK_BUDGET_PCT}% · 失效 ${inv.price}`,
  };
}

function deriveAlerts(posture, phase, bias, tradable, structure, inst) {
  const att = inst.capitalAttention?.score;
  const scaleUpTriggered = phase === '升温' && tradable !== false && bias !== '震荡' && ['试仓', '持有'].includes(posture);
  const scaleDownTriggered = phase === '退潮' || (phase === '拥挤' && inst.smoothedVol?.volRising);
  const exitTriggered =
    posture === '平仓' ||
    posture === '禁止' ||
    structure.broken ||
    (inst.quantGate && tradable === false);

  return [
    {
      type: 'scale-up',
      triggered: scaleUpTriggered,
      condition: 'phase=升温 · gate 通过 · bias 明确',
      reason: scaleUpTriggered ? `资金${att ?? '—'} 升温 · 可试探加仓` : '条件未满',
    },
    {
      type: 'scale-down',
      triggered: scaleDownTriggered,
      condition: 'phase=退—拥挤+波动放大',
      reason: scaleDownTriggered ? `${phase} · 建议降风险` : '条件未满',
    },
    {
      type: 'exit',
      triggered: exitTriggered,
      condition: '结构破坏 / gate 拦截 / posture=平仓|禁止',
      reason: exitTriggered
        ? structure.reason || inst.quantGate?.neutralReasons?.[0] || `${posture} 信号`
        : '条件未满',
    },
  ];
}

function deriveTiming(posture, inst) {
  const asOf = nowIso();
  const slot = inst.predictionSlotLabel || inst.predictionSlot || 'intraday';
  let action = '观望';
  if (posture === '试仓') action = '试仓';
  else if (posture === '加仓') action = '加仓';
  else if (posture === '减仓') action = '减仓';
  else if (posture === '平仓') action = '平仓';
  else if (posture === '持有') action = '持有';
  else if (posture === '禁止') action = '禁止';
  return {
    action,
    slot,
    reason: inst.latencyLabel ? `${inst.latencyLabel} · ${posture}` : posture,
    asOf,
  };
}

function postureRank(posture) {
  return POSTURE_RANK[posture] ?? 1;
}

function minPosture(posture, capPosture) {
  return applyPostureCap(posture, capPosture).posture;
}

function applyPostureCap(rawPosture, capPosture) {
  if (!capPosture || !rawPosture) return { posture: rawPosture, capped: false };
  const rawRank = postureRank(rawPosture);
  const capRank = postureRank(capPosture);
  if (rawRank <= capRank) return { posture: rawPosture, capped: false };
  return { posture: capPosture, capped: true, uncappedPosture: rawPosture };
}

/**
 * @param {string} instrumentId
 * @param {object} globalRisk 'from global-risk-regime.js
 */
function applyPostureHysteresis(instrumentId, rawPosture, phase) {
  const id = normalizeCommodityId(instrumentId);
  const prev = postureHysteresisState.get(id);
  const rawRank = postureRank(rawPosture);
  const now = Date.now();

  if (!prev) {
    postureHysteresisState.set(id, {
      posture: rawPosture,
      lastPhase: phase,
      phaseStreak: 1,
      lastChangeAt: now,
    });
    return { posture: rawPosture, hysteresisHeld: false };
  }

  const phaseStreak = phase === prev.lastPhase ? prev.phaseStreak + 1 : 1;
  const prevRank = postureRank(prev.posture);

  if (rawRank >= prevRank) {
    postureHysteresisState.set(id, {
      posture: rawPosture,
      lastPhase: phase,
      phaseStreak,
      lastChangeAt: now,
    });
    return { posture: rawPosture, hysteresisHeld: false };
  }

  const elapsed = now - (prev.lastChangeAt || 0);
  const allowDowngrade = phaseStreak >= 2 || elapsed >= POSTURE_DOWNGRADE_MIN_MS;
  if (allowDowngrade) {
    postureHysteresisState.set(id, {
      posture: rawPosture,
      lastPhase: phase,
      phaseStreak,
      lastChangeAt: now,
    });
    return { posture: rawPosture, hysteresisHeld: false };
  }

  postureHysteresisState.set(id, {
    posture: prev.posture,
    lastPhase: phase,
    phaseStreak,
    lastChangeAt: prev.lastChangeAt,
  });
  return { posture: prev.posture, hysteresisHeld: true, deferredPosture: rawPosture };
}

function resolvePostureCap(instrumentId, globalRisk) {
  const id = normalizeCommodityId(instrumentId);
  const tier =
    globalRisk?.tier ||
    globalRisk?.liquidityShockTier ||
    REGIME_TO_TIER_FROM_RISK(globalRisk);
  const regime = globalRisk?.regime || globalRisk?.globalRiskRegime || 'normal';

  if (tier === 'L0' || regime === 'normal') return { cap: null, tier: 'L0', reason: null };

  const table = POSTURE_CAPS[tier] || null;
  let cap = table?.[id] ?? null;
  if (!cap && tier !== 'L0') {
    const bucket = symbolBucket(id);
    cap = TIER_BUCKET_DEFAULT_CAP[tier]?.[bucket] ?? TIER_BUCKET_DEFAULT_CAP[tier]?.other ?? '观望';
  }
  if (!cap || cap === '加仓') return { cap: null, tier, regime, reason: null };

  const bucket = symbolBucket(id);
  return {
    cap,
    tier,
    regime,
    bucket,
    reason: `${tier} · ${bucket} · globalRiskRegime=${regime}`,
  };
}

function applySafeHavenNuance(posture, instrumentId, globalRisk, bias, phase, logicChain) {
  const id = normalizeCommodityId(instrumentId);
  if (!['ag', 'au'].includes(id)) return posture;
  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier;
  if (tier !== 'L1') return posture;
  if (phase !== '升温' || bias !== '偏多') return posture;
  if (postureRank(posture) >= postureRank('试仓')) return posture;
  if (logicChain) {
    logicChain.push({
      layer: 'SafeHaven',
      conclusion: '试仓',
      evidence: 'L1 · AG/AU 避险叙事：phase=升温 · bias=偏多，允许试仓上限（非盲目加仓）',
      dataSource: 'outlook-trading-guidance:safe-haven-nuance',
      asOf: globalRisk?.asOf || nowIso(),
    });
  }
  return '试仓';
}

function applyGlobalRiskPostureCap(posture, instrumentId, globalRisk, logicChain, ctx = {}) {
  const capInfo = resolvePostureCap(instrumentId, globalRisk);
  if (!capInfo.cap) {
    return { posture, globalRiskCap: null, uncappedPosture: null };
  }
  const capped = minPosture(posture, capInfo.cap);
  let finalPosture = capped;
  const uncappedPosture = postureRank(posture) > postureRank(capped) ? posture : null;

  finalPosture = applySafeHavenNuance(
    finalPosture,
    instrumentId,
    globalRisk,
    ctx.bias,
    ctx.phase,
    logicChain
  );

  if ((uncappedPosture || finalPosture !== posture) && logicChain) {
    logicChain.push({
      layer: 'GlobalRiskCap',
      conclusion: finalPosture,
      evidence: `${capInfo.reason} · 'posture ${posture} 'cap ${capInfo.cap}${finalPosture !== capped ? ' · 避险微调' : ''}`,
      dataSource: 'global-liquidity-risk+POSTURE_CAPS',
      asOf: globalRisk?.asOf || nowIso(),
    });
  }
  return {
    posture: finalPosture,
    globalRiskCap: capInfo.cap,
    uncappedPosture: uncappedPosture || (finalPosture !== posture ? posture : null),
    capTier: capInfo.tier,
  };
}

function deriveConfidence(inst) {
  let bt = inst.backtestHitRate30d;
  let hits = inst.backtestHits30d;
  let total = inst.backtestTotal30d;
  if (bt == null || total == null || total <= 0) {
    const cal = inst?.id ? outlookCalibration.getInstrumentHitRate(inst.id, 30) : null;
    if (cal?.rate != null && cal.total > 0) {
      bt = cal.rate;
      hits = cal.hits;
      total = cal.total;
    }
  }
  if (bt != null && total != null && total > 0) {
    const level = bt >= 0.65 ? '' : bt >= 0.5 ? '' : '';
    return { level, hitRate: +bt.toFixed(3), n: total, hits: hits ?? null };
  }
  const stars = inst.confidence ?? inst.stars;
  if (stars != null && !Number.isNaN(Number(stars))) {
    return { level: Number(stars) >= 4 ? '' : '', hitRate: null, n: null };
  }
  return null;
}

/**
 * @param {object} inst 'instrument outlook row (post-gate)
 * @returns {object|null}
 */
function buildTradingGuidance(inst, context = {}) {
  if (!inst?.id) return null;
  if (!isPilotSymbol(inst.id)) {
    return { pilot: false, dataSource: 'outlook-trading-guidance', method: 'stub-non-pilot' };
  }

  const asOf = nowIso();
  const logicChain = [];
  const globalRisk = context.globalRisk || inst.globalRisk || null;
  const capitalAttention = inst.capitalAttention || inst.factors?.capitalAttention;
  const smoothedVol = inst.smoothedVol || inst.factors?.technical?.smoothedVol;
  const bias = deriveBias(inst);
  const phaseInfo = derivePhase(capitalAttention, smoothedVol, inst);
  const phase = phaseInfo.phase;
  const tradable = inst.quantGate?.tradableForSim;
  const structure = structureBroken(inst, bias);

  logicChain.push({
    layer: 'Bias',
    conclusion: bias,
    evidence: inst.directionLabel || inst.directionTier || 'direction',
    dataSource: 'outlook-direction',
    asOf: inst.judgementUpdatedAt || asOf,
  });

  if (phase) {
    logicChain.push({
      layer: 'Phase',
      conclusion: phase,
      evidence: phaseInfo.evidence,
      dataSource: phaseInfo.dataSource,
      asOf,
    });
  }

  let posture = derivePosture({
    inst,
    bias,
    phase,
    phaseInfo,
    tradable,
    structure,
    logicChain,
  });

  const capResult = globalRisk
    ? applyGlobalRiskPostureCap(posture, inst.id, globalRisk, logicChain, { bias, phase })
    : { posture, globalRiskCap: null, uncappedPosture: null, capTier: null };
  posture = capResult.posture;

  const hysteresis = applyPostureHysteresis(inst.id, posture, phase);
  posture = hysteresis.posture;
  if (hysteresis.hysteresisHeld && logicChain) {
    logicChain.push({
      layer: 'Hysteresis',
      conclusion: posture,
      evidence: `暂缓下调'${hysteresis.deferredPosture} · 需连续 2 次同 phase 或间—min`,
      dataSource: 'outlook-trading-guidance:hysteresis',
      asOf,
    });
  }

  const position = derivePosition(posture, inst, bias, logicChain);
  const alerts = deriveAlerts(posture, phase, bias, tradable, structure, inst);
  const timing = deriveTiming(posture, inst);
  const confidence = deriveConfidence(inst);
  const regimeGateConf = inst.regimeGate?.confidenceLabel;
  if (regimeGateConf && regimeGateConf !== '待校验') {
    logicChain.push({
      layer: 'RegimeGate',
      conclusion: regimeGateConf,
      evidence: [
        inst.regimeGate.marketRegimeLabel || inst.regimeGate.marketRegime,
        inst.tradableDay?.tradable === true ? 'tradable-day' : inst.tradableDay?.tradable === false ? 'non-tradable-day' : null,
        inst.regimeGate.gateReason,
      ]
        .filter(Boolean)
        .join(' · '),
      dataSource: inst.regimeGate.dataSource || 'regime-gate',
      asOf,
    });
  }

  const macroSynth = inst.macroSynthesis?.perSymbol?.[normalizeCommodityId(inst.id)];

  return {
    posture,
    uncappedPosture: capResult.uncappedPosture || null,
    globalRiskCap: capResult.globalRiskCap || macroSynth?.globalRiskCap || null,
    globalRiskCapTier: capResult.capTier || null,
    phase: phase || '暂无',
    bias,
    timing,
    position,
    alerts,
    logicChain,
    confidence,
    regimeGate: inst.regimeGate || null,
    tradableDay: inst.tradableDay || null,
    thesisBiasContribution: macroSynth?.thesisBiasContribution ?? null,
    thesisBiasN: macroSynth?.thesisBiasN ?? null,
    dataSource: 'outlook-trading-guidance',
    method: 'bias-phase-gate-composite+global-risk-cap',
    version: GUIDANCE_VERSION,
    pilot: true,
    asOf,
  };
}

/**
 * Lightweight refresh for 90s quote patch 'reuses cached row fields.
 */
function refreshTradingGuidance(inst, context = {}) {
  return buildTradingGuidance(inst, context);
}

function patchInstrumentsTradingGuidance(instruments, context = {}) {
  if (!instruments?.length) return instruments;
  return instruments.map((inst) => {
    if (!isPilotSymbol(inst.id)) return inst;
    const tradingGuidance = refreshTradingGuidance(inst, context);
    return tradingGuidance ? { ...inst, tradingGuidance } : inst;
  });
}

module.exports = {
  PILOT_SYMBOLS,
  POSTURES,
  PHASES,
  RISK_BUDGET_PCT,
  GUIDANCE_VERSION,
  POSTURE_RANK,
  POSTURE_CAPS,
  POSTURE_CAP_BY_TIER,
  minPosture,
  isPilotSymbol,
  pilotSymbolList,
  postureRank,
  resolvePostureCap,
  applyGlobalRiskPostureCap,
  applyPostureHysteresis,
  REGIME_TO_TIER_FROM_RISK,
  buildTradingGuidance,
  refreshTradingGuidance,
  patchInstrumentsTradingGuidance,
};
