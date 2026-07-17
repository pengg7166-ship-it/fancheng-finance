/**
 * 关注品种机会排名 — Top5 + 重大机会检测
 * 基于真实结构化数据评分，禁止假数据
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { isUserFocusSymbol, getFocusMeta } = require('./user-focus-symbols');
const { computePriorityScore } = require('./multi-dimensional-scoring');
const { classifyRegime } = require('./commodity-regime-classifier');
const { deriveWatchLevel } = require('./research-pool');

const RANKER_VERSION = 'v1.49.2-user-focus';

/** 重大机会阈值：priorityScore ≥ 此值 或 regime B/C + 高资金关注 */
const MAJOR_OPPORTUNITY_SCORE = 0.68;
const MAJOR_OPPORTUNITY_ATT = 70;
const ELEVATED_OPPORTUNITY_SCORE = 0.58;

function scoreInstrument(inst, context = {}) {
  if (!inst?.id || !isUserFocusSymbol(inst.id)) return null;
  const tg = inst.tradingGuidance || context.tradingGuidance;
  const lt = inst.longTermGuidance || context.longTermGuidance;
  const priority = computePriorityScore(inst, { tradingGuidance: tg, ...context });
  const watchLevel = deriveWatchLevel(inst, { tradingGuidance: tg, longTermGuidance: lt });
  const regime = priority.regime?.regime || classifyRegime(inst.id, { inst }).regime;
  const att = inst.capitalAttention?.score;
  const posture = tg?.posture;
  const bias = inst.directionLabel || inst.directionTier || 'neutral';

  let opportunityTier = 'normal';
  const isMajor =
    (priority.priorityScore != null && priority.priorityScore >= MAJOR_OPPORTUNITY_SCORE) ||
    (['B', 'C'].includes(regime) && att != null && att >= MAJOR_OPPORTUNITY_ATT) ||
    watchLevel === 'W4' ||
    watchLevel === 'O2' ||
    (posture === '加仓' && lt?.entry?.readiness === 'ready');

  if (isMajor) opportunityTier = 'major';
  else if (
    (priority.priorityScore != null && priority.priorityScore >= ELEVATED_OPPORTUNITY_SCORE) ||
    watchLevel === 'W3' ||
    watchLevel === 'W2'
  ) {
    opportunityTier = 'elevated';
  }

  const meta = getFocusMeta(inst.id);
  return {
    symbol: normalizeCommodityId(inst.id),
    name: inst.name || meta.name,
    exchange: inst.exchange || meta.exchange,
    priorityScore: priority.priorityScore,
    regime,
    regimeLabel: priority.regime?.label || regime,
    watchLevel,
    posture: posture || '暂无',
    bias: inst.directionLabel || '震荡',
    directionTier: inst.directionTier,
    capitalAttention: att,
    opportunityTier,
    isMajorOpportunity: opportunityTier === 'major',
    playbookMatch: priority.playbookMatch,
    dimensions: priority.dimensions,
    dataSource: 'focus-opportunity-ranker',
    method: 'multi-dimensional-scoring',
    asOf: inst.judgementUpdatedAt || new Date().toISOString(),
  };
}

function rankFocusInstruments(instruments = [], context = {}) {
  const focus = instruments.filter((i) => isUserFocusSymbol(i?.id));
  const scored = focus.map((inst) => scoreInstrument(inst, context)).filter(Boolean);
  scored.sort((a, b) => {
    if (a.isMajorOpportunity !== b.isMajorOpportunity) return a.isMajorOpportunity ? -1 : 1;
    if (a.opportunityTier !== b.opportunityTier) {
      const tierRank = { major: 0, elevated: 1, normal: 2 };
      return (tierRank[a.opportunityTier] ?? 9) - (tierRank[b.opportunityTier] ?? 9);
    }
    return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
  });
  return scored;
}

function pickTop5(instruments = [], context = {}) {
  return rankFocusInstruments(instruments, context).slice(0, 5).map((row, idx) => ({
    ...row,
    rank: idx + 1,
  }));
}

function pickMajorOpportunities(instruments = [], context = {}) {
  return rankFocusInstruments(instruments, context).filter((r) => r.isMajorOpportunity);
}

module.exports = {
  RANKER_VERSION,
  MAJOR_OPPORTUNITY_SCORE,
  MAJOR_OPPORTUNITY_ATT,
  scoreInstrument,
  rankFocusInstruments,
  pickTop5,
  pickMajorOpportunities,
};
