/**
 * 情报内核（v1）：主矛盾 → 状态条件权重 → 强制反对意见
 * 真实证据编排，禁止假填充；证据不足标「暂无 / 结论脆弱」。
 *
 * 与「字段汇聚台」的区别：先定今日主矛盾与状态，再改三路合成权重，
 * 并强制列出与倾向相反的证据；反对意见强则压置信，而非假装唯一最优解。
 */
const INTEL_VERSION = 'v1.56.27-statekey-cal';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeTriple(pw, aw, fw) {
  let a = Math.max(0.05, Number(pw) || 0);
  let b = Math.max(0.05, Number(aw) || 0);
  let c = Math.max(0.05, Number(fw) || 0);
  const s = a + b + c;
  return {
    philosophyWeight: +(a / s).toFixed(4),
    adaptiveWeight: +(b / s).toFixed(4),
    factorWeight: +(c / s).toFixed(4),
  };
}

/**
 * 今日主矛盾：优先哲学 ranked.primary；合证仅作结构状态标注，不单独定调。
 */
function identifyMainContradiction({ phil, stockFlow, jointSignal, regime } = {}) {
  const primary = phil?.ranked?.primary?.[0] || null;
  const chip = phil?.ranked?.primaryChip || phil?.sdFinance?.combinedLabel || null;

  if (!primary && !phil?.sdFinance) {
    return {
      available: false,
      id: null,
      label: '暂无',
      side: null,
      score: null,
      source: 'missing',
      note: '哲学主矛盾与供需×金融均不足 · 不作假主线',
      regime: regime || null,
      jointRegime: jointSignal?.regime || stockFlow?.primaryRegime || null,
    };
  }

  const score = primary?.score != null ? Number(primary.score) : Number(phil?.sdFinance?.score);
  let side = null;
  if (Number.isFinite(score)) {
    if (score > 0.08) side = 'bull';
    else if (score < -0.08) side = 'bear';
    else side = 'flat';
  }

  const jointNote =
    stockFlow?.available && stockFlow.primaryLabel
      ? `合证状态:${stockFlow.primaryLabel}${stockFlow.priceMayLag ? '·价格或滞后' : ''}`
      : jointSignal?.reason && jointSignal.reason !== 'joint_unavailable'
        ? `合证信号:${jointSignal.reason}`
        : null;

  return {
    available: true,
    id: primary?.id || 'sdFinance',
    label: primary?.label || chip || '供需×金融',
    chip: chip || null,
    side,
    score: Number.isFinite(score) ? +score.toFixed(4) : null,
    weight: primary?.weight ?? null,
    source: 'philosophy.ranked.primary',
    note: jointNote,
    regime: regime || null,
    jointRegime: jointSignal?.regime || stockFlow?.primaryRegime || null,
    jointCoherence: stockFlow?.coherence || jointSignal?.coherence || null,
  };
}

/**
 * 状态键：环境 regime × 合证 regime × 主矛盾侧
 * 用于条件权重表（可审计，非唯一永恒权重）。
 */
function buildStateKey({ regime, jointSignal, stockFlow, mainContradiction } = {}) {
  const env = regime && regime !== 'neutral' ? regime : 'neutral';
  const joint =
    jointSignal?.reason === 'joint_applied'
      ? jointSignal.regime || 'joint_on'
      : stockFlow?.available
        ? stockFlow.structureBias === 'mixed'
          ? 'joint_mixed'
          : stockFlow.primaryRegime || 'joint_soft'
        : 'joint_off';
  const lean = mainContradiction?.side || 'flat';
  return `${env}|${joint}|${lean}`;
}

/**
 * 状态条件权重：优先使用 stateKey 分桶校准表；不足则启发式回退（可审计）。
 */
function buildStateConditionalWeights({
  baseBlend,
  regime,
  stockFlow,
  jointSignal,
  phil,
  mainContradiction,
} = {}) {
  const stateKey = buildStateKey({ regime, jointSignal, stockFlow, mainContradiction });
  const base = normalizeTriple(
    baseBlend?.philosophyWeight ?? 0.5,
    baseBlend?.adaptiveWeight ?? 0.25,
    baseBlend?.factorWeight ?? 0.25
  );

  // 1) 校准表（walk-forward 网格，带 n / lift 门禁）
  try {
    const { lookupCalibratedWeights } = require('./intel-statekey-weights');
    const cal = lookupCalibratedWeights(stateKey);
    if (cal?.weights) {
      return {
        ...cal.weights,
        base,
        rationale: [
          ...(cal.rationale || []),
          '校准命中门禁已过 · 覆盖启发式微调',
        ],
        stateKey,
        coarseKey: cal.coarseKey,
        method: `statekey-calibrated:${cal.source}`,
        dataSource: 'intel-statekey-weights',
        calibrated: {
          n: cal.n,
          hitDisplay: cal.hitDisplay,
          liftVsEqual: cal.liftVsEqual,
          version: cal.version,
          calibratedAt: cal.calibratedAt,
        },
      };
    }
  } catch {
    // 无表或读失败 → 启发式
  }

  let pw = base.philosophyWeight;
  let aw = base.adaptiveWeight;
  let fw = base.factorWeight;
  const rationale = ['启发式回退：校准桶不足或不达标'];

  // 资金态度 / 瞬时通道：归因显示 stance 负 IC → 压 adaptive
  aw *= 0.85;
  rationale.push('adaptive×0.85：资金态度 stance 归因负 IC，不作方向主仓');

  if (jointSignal?.reason === 'joint_applied' && jointSignal.delta != null) {
    fw *= 1.18;
    aw *= 0.9;
    rationale.push(`factor×1.18：合证 ${jointSignal.regime} 已赋权入库存分`);
  } else if (stockFlow?.available && stockFlow.structureBias === 'mixed') {
    fw *= 0.82;
    pw *= 1.12;
    rationale.push('合证混合：压因子结构叙事，抬哲学主矛盾');
  } else if (jointSignal?.reason === 'regime_zero_weight' || jointSignal?.reason === 'coherence_diverge') {
    fw *= 0.88;
    pw *= 1.08;
    rationale.push(`合证 ${jointSignal.reason}：不把置零/分歧结构当方向`);
  } else if (!stockFlow?.available) {
    fw *= 0.92;
    rationale.push('合证不可用：略压库存因子权重');
  }

  if (stockFlow?.priceMayLag) {
    fw *= 0.9;
    aw *= 0.92;
    rationale.push('合证标价格或滞后：降结构与瞬时置信');
  }

  if (mainContradiction?.side === 'flat' || mainContradiction?.score == null) {
    const mid = normalizeTriple(0.4, 0.3, 0.3);
    pw = (pw + mid.philosophyWeight) / 2;
    aw = (aw + mid.adaptiveWeight) / 2;
    fw = (fw + mid.factorWeight) / 2;
    rationale.push('主矛盾平坦/不足：权重向均衡靠拢');
  }

  if (phil?.secondaryDominates || phil?.ranked?.secondaryDominates) {
    pw *= 0.92;
    aw *= 0.92;
    fw *= 0.92;
    rationale.push('次矛盾喧宾夺主：三路同步降权待主料确认');
  }

  if (regime === 'liquidityPanic' || regime === 'riskOff') {
    aw *= 0.9;
    pw *= 1.05;
    rationale.push(`${regime}：压瞬时、略抬哲学`);
  } else if (regime === 'supplyShock') {
    fw *= 1.08;
    rationale.push('supplyShock：略抬供需/库存因子');
  }

  const weights = normalizeTriple(pw, aw, fw);
  return {
    ...weights,
    base,
    rationale,
    stateKey,
    coarseKey: (() => {
      try {
        return require('./intel-statekey-weights').coarseStateKey(stateKey);
      } catch {
        return null;
      }
    })(),
    method: 'state-conditional-heuristic',
    dataSource: 'intel-kernel',
    calibrated: null,
  };
}

/**
 * 强制反对意见：无论倾向哪侧，都必须列出对侧证据；没有则诚实标脆弱。
 */
function buildForcedDissent({
  phil,
  stockFlow,
  jointSignal,
  capitalAttention,
  technical,
  newsImpact,
  mainContradiction,
} = {}) {
  const lean = mainContradiction?.side || 'flat';
  const support = [];
  const oppose = [];

  const pushUnique = (arr, item) => {
    if (!item || arr.includes(item)) return;
    arr.push(item);
  };

  // 哲学主次
  for (const f of phil?.ranked?.primary || []) {
    if (f?.score == null || !f.label) continue;
    const item = `主矛盾·${f.label}:${Number(f.score) >= 0 ? '+' : ''}${Number(f.score).toFixed(2)}`;
    if (f.score > 0.08) pushUnique(support, item);
    else if (f.score < -0.08) pushUnique(oppose, item);
  }
  for (const f of phil?.ranked?.secondary || []) {
    if (f?.score == null || !f.label) continue;
    const item = `次矛盾·${f.label}:${Number(f.score) >= 0 ? '+' : ''}${Number(f.score).toFixed(2)}`;
    if (Math.abs(f.score) < 0.12) continue;
    if (f.score > 0) pushUnique(support, item);
    else pushUnique(oppose, item);
  }

  // 合证：按 structureBias / supports*
  if (stockFlow?.available) {
    const tag = `合证:${stockFlow.primaryLabel}`;
    if (stockFlow.supportsLong) pushUnique(support, tag);
    if (stockFlow.supportsShort) pushUnique(oppose, tag);
    if (stockFlow.structureBias === 'mixed' || stockFlow.priceMayLag) {
      pushUnique(oppose, `合证警示:${stockFlow.note || '混合/滞后·不宜单边'}`);
      pushUnique(support, `合证警示:${stockFlow.note || '混合/滞后·不宜单边'}`);
    }
  } else {
    pushUnique(oppose, '合证:暂无（仓单×资金未对齐）');
  }

  if (jointSignal?.reason === 'regime_zero_weight') {
    pushUnique(oppose, `合证赋权拒绝:${jointSignal.regime}（归因置零）`);
  }
  if (jointSignal?.reason === 'joint_applied' && jointSignal.delta != null) {
    const t = `合证增量:${jointSignal.regime} Δ${jointSignal.delta}`;
    if (jointSignal.delta < 0) pushUnique(oppose, t);
    else if (jointSignal.delta > 0) pushUnique(support, t);
  }

  // 资金态度：只作文案证据，不因 stance 定方向
  if (capitalAttention?.attitudeLabel && capitalAttention.attitudeLabel !== '暂无') {
    const att = `资金态度:${capitalAttention.attitudeLabel}`;
    if (capitalAttention.attitude === 'inflow' || capitalAttention.attitude === 'mild_in') {
      pushUnique(support, `${att}（仅关注度，不作方向主仓）`);
    } else if (capitalAttention.attitude === 'outflow' || capitalAttention.attitude === 'mild_out') {
      pushUnique(oppose, `${att}（仅关注度，不作方向主仓）`);
    } else {
      pushUnique(oppose, `${att}`);
      pushUnique(support, `${att}`);
    }
  }

  if (technical?.maStack?.label) {
    const ma = `均线:${technical.maStack.label}`;
    if (/多|上/.test(technical.maStack.label)) pushUnique(support, ma);
    else if (/空|下/.test(technical.maStack.label)) pushUnique(oppose, ma);
  }

  if (newsImpact?.hitCount > 0 && newsImpact.score != null) {
    const n = `资讯冲击:${newsImpact.shockDisplay || newsImpact.score}(${newsImpact.hitCount}条)`;
    if (newsImpact.score > 0.1) pushUnique(support, n);
    else if (newsImpact.score < -0.1) pushUnique(oppose, n);
  }

  // lean 视角下的「支持 / 反对」
  let supportingEvidence;
  let opposingEvidence;
  if (lean === 'bull') {
    supportingEvidence = support.slice(0, 6);
    opposingEvidence = oppose.slice(0, 6);
  } else if (lean === 'bear') {
    supportingEvidence = oppose.slice(0, 6);
    opposingEvidence = support.slice(0, 6);
  } else {
    supportingEvidence = support.slice(0, 4);
    opposingEvidence = oppose.slice(0, 4);
  }

  if (!opposingEvidence.length) {
    opposingEvidence = ['反对意见:暂无对侧硬证据 · 结论脆弱'];
  }

  const dissentStrength = clamp(
    opposingEvidence.filter((e) => !/暂无对侧|结论脆弱/.test(e)).length / 4,
    0,
    1
  );

  const flipConditions = [];
  if (lean === 'bull' || lean === 'flat') {
    flipConditions.push('1m/3m 合证转为累库+增仓且价格摆动失守');
  }
  if (lean === 'bear' || lean === 'flat') {
    flipConditions.push('1m/3m 合证转为去库+增仓且价格摆动突破');
  }
  if (stockFlow?.priceMayLag) {
    flipConditions.push('资金重新确认库存方向后撤销「价格滞后」标签');
  }
  if (!stockFlow?.available) {
    flipConditions.push('仓单与持仓同窗口对齐后才能升级合证定调');
  }

  return {
    lean,
    supportingEvidence,
    opposingEvidence,
    dissentStrength: +dissentStrength.toFixed(3),
    flipConditions,
    method: 'forced-dissent',
    dataSource: 'phil+stockFlow+capital+tech+news',
  };
}

/**
 * 置信缩放：反对意见强 / 主矛盾弱 / 数据不足 → 压复合分，不翻假方向。
 */
function convictionScaleFromKernel({ dissent, mainContradiction, sourceLaneCount } = {}) {
  let scale = 1;
  const notes = [];
  const ds = dissent?.dissentStrength ?? 0;
  if (ds >= 0.75) {
    scale *= 0.55;
    notes.push('反对意见很强·压置信');
  } else if (ds >= 0.5) {
    scale *= 0.72;
    notes.push('反对意见中等·降置信');
  } else if (ds >= 0.25) {
    scale *= 0.88;
    notes.push('存在对侧证据·略降置信');
  }

  if (!mainContradiction?.available || mainContradiction.side === 'flat') {
    scale *= 0.75;
    notes.push('主矛盾不明·压置信');
  }

  if (sourceLaneCount != null && sourceLaneCount < 3) {
    scale *= 0.5;
    notes.push('数据源不足');
  }

  return { scale: +clamp(scale, 0.25, 1).toFixed(3), notes };
}

/**
 * 编排入口
 */
function evaluateIntelligenceKernel(ctx = {}) {
  const {
    phil,
    stockFlow,
    jointSignal,
    capitalAttention,
    technical,
    newsImpact,
    regime,
    baseBlend,
    sourceLaneCount,
    inventoryFactor,
  } = ctx;

  const joint =
    jointSignal ||
    inventoryFactor?.jointSignal ||
    capitalAttention?.jointSignal ||
    null;
  const sf =
    stockFlow ||
    inventoryFactor?.stockFlowJoint ||
    (capitalAttention?.stockFlowBias
      ? { available: true, structureBias: capitalAttention.stockFlowBias, primaryLabel: capitalAttention.jointWithInventory }
      : null);

  const mainContradiction = identifyMainContradiction({
    phil,
    stockFlow: sf,
    jointSignal: joint,
    regime,
  });

  if (!mainContradiction.available && !phil) {
    return {
      version: INTEL_VERSION,
      available: false,
      reason: 'philosophy_missing',
      mainContradiction,
      conditionalWeights: null,
      dissent: null,
      conviction: { scale: 0.5, notes: ['哲学层缺失'] },
      method: 'intelligence-kernel',
      dataSource: 'missing',
    };
  }

  const conditionalWeights = buildStateConditionalWeights({
    baseBlend,
    regime,
    stockFlow: sf,
    jointSignal: joint,
    phil,
    mainContradiction,
  });

  const dissent = buildForcedDissent({
    phil,
    stockFlow: sf,
    jointSignal: joint,
    capitalAttention,
    technical,
    newsImpact,
    mainContradiction,
  });

  const conviction = convictionScaleFromKernel({
    dissent,
    mainContradiction,
    sourceLaneCount,
  });

  const summaryParts = [];
  if (mainContradiction.available) {
    summaryParts.push(
      `主矛盾:${mainContradiction.label}${
        mainContradiction.side === 'bull' ? '偏多' : mainContradiction.side === 'bear' ? '偏空' : '震荡'
      }`
    );
  }
  summaryParts.push(`状态:${conditionalWeights.stateKey}`);
  if (dissent.opposingEvidence[0]) {
    summaryParts.push(`反对:${dissent.opposingEvidence[0]}`);
  }
  summaryParts.push(`置信×${conviction.scale}`);

  return {
    version: INTEL_VERSION,
    available: true,
    mainContradiction,
    conditionalWeights,
    dissent,
    conviction,
    stateKey: conditionalWeights.stateKey,
    summary: summaryParts.join(' · '),
    method: 'intelligence-kernel',
    dataSource: 'philosophy+stock-flow+capital+regime',
  };
}

/**
 * 用条件权重合成三路分数（可审计替代固定 blend）
 */
function blendWithKernelWeights(philosophyScore, adaptiveScore, factorComposite, weights) {
  const w = normalizeTriple(
    weights?.philosophyWeight ?? 0.5,
    weights?.adaptiveWeight ?? 0.25,
    weights?.factorWeight ?? 0.25
  );
  const raw = clamp(
    (philosophyScore ?? 0) * w.philosophyWeight +
      (adaptiveScore ?? 0) * w.adaptiveWeight +
      (factorComposite ?? 0) * w.factorWeight,
    -1,
    1
  );
  return { score: raw, weights: w };
}

function applyConviction(compositeScore, conviction) {
  const scale = conviction?.scale != null ? conviction.scale : 1;
  return clamp((compositeScore ?? 0) * scale, -1, 1);
}

module.exports = {
  INTEL_VERSION,
  identifyMainContradiction,
  buildStateKey,
  buildStateConditionalWeights,
  buildForcedDissent,
  convictionScaleFromKernel,
  evaluateIntelligenceKernel,
  blendWithKernelWeights,
  applyConviction,
  normalizeTriple,
};
