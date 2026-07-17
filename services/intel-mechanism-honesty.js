/**
 * 情报中心 · 机制话术诚实门禁（构想 §74 / §11）
 * 滞后相关 ≠ 机制身份。cost/substitute/arbitrage 先验在仅有 corr 时
 * 禁止展示为「成本传导」等因果话术，降为「滞后共动」并保留先验审计字段。
 */
const MECHANISM_HONESTY_VERSION = 'v2.89.2-mechanism-honesty';

const PRIOR_LABELS = {
  cost: '成本传导',
  substitute: '替代',
  sentiment: '情绪/联动',
  arbitrage: '套利',
  multihop: '多跳',
  other: '其他',
  co_move: '滞后共动',
};

/** 需要结构/事件背书才允许因果话术的先验 */
const CAUSAL_PRIORS = new Set(['cost', 'substitute', 'arbitrage']);

function structureBits(inst) {
  if (!inst) return [];
  const bits = [];
  const sf = inst.factors?.inventory?.stockFlowJoint;
  if (sf?.available && (sf.primaryLabel || sf.primaryRegime)) bits.push('合证');
  const basis = inst.basis || inst.factors?.basis || inst.intelCenter?.basis;
  if (basis?.available && (basis.structure || basis.label)) bits.push('基差');
  const dual = inst.dualNarrative || inst.intelCenter?.dualNarrative;
  if (dual?.regime && dual.regime !== 'unknown' && dual.available !== false) bits.push('内外');
  const term = inst.termStructure || inst.intelCenter?.termStructure;
  if (term?.available) bits.push('期限');
  return bits;
}

function eventBits(inst) {
  if (!inst) return [];
  const bits = [];
  const kernel = inst.intelligenceKernel;
  if (kernel?.eventClock?.imminent || kernel?.calendar?.imminent) bits.push('事件钟');
  if (kernel?.newsShock?.available && kernel.newsShock.level) bits.push('新闻冲击');
  const cal = inst.intelCenter?.calendarHit;
  if (cal?.imminent) bits.push('情报日历');
  return bits;
}

/**
 * @param {object} edge — 须含 mechanism 先验；可有 corr/n
 * @param {object|null} sourceInst
 * @param {object|null} targetInst
 */
function assessMechanismHonesty(edge = {}, sourceInst = null, targetInst = null) {
  const prior = String(edge.mechanismPrior || edge.mechanism || 'other');
  const priorLabel = PRIOR_LABELS[prior] || prior;
  const hasCorr =
    edge.corr != null && Number.isFinite(Number(edge.corr)) && edge.n != null && Number(edge.n) >= 20;

  const sBits = structureBits(sourceInst);
  const tBits = structureBits(targetInst);
  const structureBitsAll = [...new Set([...sBits, ...tBits])];
  const structureOk = structureBitsAll.length > 0;

  const eBits = [...new Set([...eventBits(sourceInst), ...eventBits(targetInst)])];
  const eventOk = eBits.length > 0;

  const tiers = [];
  if (hasCorr) tiers.push('corr');
  if (structureOk) tiers.push('structure');
  if (eventOk) tiers.push('event');
  if (!tiers.length) tiers.push('prior_only');

  let mechanismClaim = prior;
  let mechanismLabel = priorLabel;
  let causalLanguageAllowed = true;
  let honestyNote = null;

  if (CAUSAL_PRIORS.has(prior)) {
    if (structureOk || eventOk) {
      mechanismClaim = prior;
      mechanismLabel = priorLabel;
      causalLanguageAllowed = true;
      honestyNote = null;
    } else if (hasCorr) {
      mechanismClaim = 'co_move';
      mechanismLabel = '滞后共动';
      causalLanguageAllowed = false;
      honestyNote = `先验「${priorLabel}」·仅滞后相关 · 禁止当${priorLabel}`;
    } else {
      mechanismClaim = 'co_move';
      mechanismLabel = '先验待验';
      causalLanguageAllowed = false;
      honestyNote = `先验「${priorLabel}」·无相关/结构 · 禁止因果话术`;
    }
  } else if (prior === 'sentiment') {
    mechanismClaim = 'sentiment';
    mechanismLabel = hasCorr && !structureOk ? '情绪/联动（相关）' : '情绪/联动';
    causalLanguageAllowed = true;
  } else {
    mechanismClaim = prior === 'other' ? (hasCorr ? 'co_move' : 'other') : prior;
    mechanismLabel = PRIOR_LABELS[mechanismClaim] || mechanismClaim;
  }

  return {
    version: MECHANISM_HONESTY_VERSION,
    mechanismPrior: prior,
    mechanismPriorLabel: priorLabel,
    mechanismClaim,
    mechanismLabel,
    // 兼容：mechanism 字段改为可展示的诚实 claim（调用方应另存 prior）
    mechanism: mechanismClaim,
    causalLanguageAllowed,
    evidenceTier: tiers,
    evidenceTierDisplay: tiers.join('+'),
    structureBits: structureBitsAll,
    eventBits: eBits,
    honestyNote,
    displaySuffix: honestyNote ? ` · ${honestyNote}` : '',
    dataSource: 'intel-mechanism-honesty',
    method: 'prior+corr|structure|event→claim',
  };
}

function applyMechanismHonesty(edge, sourceInst, targetInst) {
  const h = assessMechanismHonesty(edge, sourceInst, targetInst);
  const baseLabel = edge.label || `${edge.from}→${edge.to}`;
  const corrPart =
    edge.corr != null && Number.isFinite(Number(edge.corr))
      ? ` corr=${Number(edge.corr).toFixed(2)}`
      : '';
  const lagPart =
    edge.lagTypical != null || edge.lag != null ? ` lag${edge.lagTypical ?? edge.lag}d` : '';
  const nPart = edge.nDisplay || (edge.n != null ? String(edge.n) : null);
  const actPart =
    edge.activation != null ? ` · 激活${(Number(edge.activation) * 100).toFixed(0)}%` : '';

  const path = `${baseLabel} · ${h.mechanismLabel}${
    !h.causalLanguageAllowed && h.mechanismPriorLabel ? `≠${h.mechanismPriorLabel}` : ''
  }${lagPart}${corrPart}${actPart}${nPart ? ` (n=${nPart})` : ''}${h.displaySuffix}`;

  return {
    ...edge,
    mechanismPrior: h.mechanismPrior,
    mechanismPriorLabel: h.mechanismPriorLabel,
    mechanism: h.mechanismClaim,
    mechanismClaim: h.mechanismClaim,
    mechanismLabel: h.mechanismLabel,
    causalLanguageAllowed: h.causalLanguageAllowed,
    mechanismEvidenceTier: h.evidenceTier,
    mechanismEvidenceTierDisplay: h.evidenceTierDisplay,
    mechanismHonestyNote: h.honestyNote,
    mechanismStructureBits: h.structureBits,
    path,
    text: edge.pending
      ? `${baseLabel} · 待校验 · ${edge.reason || '—'} · ${h.mechanismLabel}${
          !h.causalLanguageAllowed ? `≠${h.mechanismPriorLabel}` : ''
        }${nPart ? ` (n=${nPart})` : ''}`
      : path,
    honesty: h,
  };
}

module.exports = {
  MECHANISM_HONESTY_VERSION,
  PRIOR_LABELS,
  CAUSAL_PRIORS,
  assessMechanismHonesty,
  applyMechanismHonesty,
  structureBits,
  eventBits,
};
