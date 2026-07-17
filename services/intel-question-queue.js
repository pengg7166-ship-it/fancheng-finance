/**
 * 情报中心 · 问题队列 P0–P4
 */
const QUEUE_VERSION = 'v2.76.0-horizon-p2';

const PRIORITY_LABELS = {
  P0: '证伪/翻转',
  P1: 'mispriced+高惊讶',
  P2: '时钟紧迫',
  P3: '跨品种/常规关注',
  P4: '浅监控',
};

function scoreQuestion(inst) {
  const ic = inst?.intelCenter;
  if (!ic) return { priority: 'P4', score: 0, question: '数据待构建' };

  let score = 0;
  const reasons = [];

  if (ic.analyst?.priorityBoost) {
    score += ic.analyst.priorityBoost;
    reasons.push(`分析师置顶+${ic.analyst.priorityBoost}`);
  }
  if (ic.pushTier?.tier === 'interrupt') {
    score += 100;
    reasons.push('打断级');
  }
  if (ic.primaryClaim?.status === 'falsified') {
    score += 90;
    reasons.push('命题已证伪');
  }
  if (ic.primaryClaim?.status === 'falsifying' || ic.falsifyEval?.status === 'falsifying') {
    score += 70;
    reasons.push('证伪进行中');
  }
  if (ic.pricingState?.state === 'mispriced') {
    score += 40;
    reasons.push('定价背离');
  }
  if (ic.clock?.aggregate?.level === 'red') {
    score += 35;
    reasons.push('证伪紧迫');
  }
  if (ic.surprise?.bucket === 'extreme' || ic.surprise?.bucket === 'high') {
    score += 25;
    reasons.push('高惊讶');
  }
  if (ic.gates?.top5?.pass) {
    score += 15;
    reasons.push('可进Top5');
  }
  if (inst?.changeDelta?.directionChanged) {
    score += 30;
    reasons.push('方向翻转');
  }
  if (inst?.changeDelta?.regimeChanged) {
    score += 25;
    reasons.push('regime翻转');
  }
  if (ic.unknownMap?.criticalGaps?.length) {
    score += 10;
    reasons.push('关键缺口');
  }
  if (ic.dualNarrative?.regime === 'split') {
    score += 22;
    reasons.push('内外叙事分裂');
  }
  if (ic.canonicalCases?.pathSimilarity?.available && ic.canonicalCases.pathSimilarity.score >= 0.55) {
    score += 18;
    reasons.push('同构路径相似');
  }
  if (ic.calendarBoost) {
    score += ic.calendarBoost;
    reasons.push(ic.calendarReason || '情报日历临近');
  }
  if (ic.resonance?.diverge?.length) {
    score += 20;
    reasons.push('跨品种分化');
  } else if (ic.resonance?.lagging?.length) {
    score += 16;
    reasons.push('跨品种滞后');
  }
  if (ic.horizonCoordination?.hasConflict) {
    score += ic.horizonCoordination.severity === 'high' ? 28 : 18;
    reasons.push('三尺度冲突');
  }

  let priority = 'P4';
  if (score >= 80) priority = 'P0';
  else if (score >= 55) priority = 'P1';
  else if (score >= 35) priority = 'P2';
  else if (score >= 15) priority = 'P3';

  const claim = ic.primaryClaim;
  const question =
    claim?.status === 'falsified'
      ? `${inst.name}：命题已证伪 — ${claim.falsifyTrigger || '触发器命中'}，是否改口？`
      : claim?.status === 'falsifying' || claim?.confidence === '证伪进行中'
        ? `${inst.name}：证伪进行中 — ${claim.falsifyTrigger || ic.clock?.display || '信号累积'}？`
        : ic.dualNarrative?.regime === 'split' && ic.dualNarrative?.questionHint
          ? ic.dualNarrative.questionHint
          : priority === 'P0'
            ? `${inst.name}：${claim?.statement || '命题'}是否已被证伪？`
            : priority === 'P1'
              ? `${inst.name}：结构/价格为何背离？`
              : priority === 'P2'
                ? `${inst.name}：证伪时钟 ${ic.clock?.display || '—'}`
                : `${inst.name}：${ic.memo?.headline || claim?.statement || '监控'}`;

  return { priority, score, question, reasons, priorityLabel: PRIORITY_LABELS[priority] };
}

function buildQuestionQueue(instruments, { limit = 12 } = {}) {
  const items = (instruments || [])
    .map((inst) => {
      const q = scoreQuestion(inst);
      return {
        instrumentId: inst.id,
        instrumentName: inst.name,
        sector: inst.sector,
        ...q,
        claimId: inst.intelCenter?.primaryClaim?.claimId || null,
        pushTier: inst.intelCenter?.pushTier?.tier || 'silent',
      };
    })
    .sort((a, b) => b.score - a.score);

  const p0 = items.filter((i) => i.priority === 'P0').slice(0, 3);
  const deep = items.filter((i) => ['P0', 'P1', 'P2'].includes(i.priority)).slice(0, limit);

  return {
    version: QUEUE_VERSION,
    asOf: new Date().toISOString(),
    p0,
    p0Count: p0.length,
    deepQueue: deep,
    quietDay: p0.length === 0 && deep.filter((d) => d.priority !== 'P4').length === 0,
    all: items,
    dataSource: 'intel-question-queue',
  };
}

module.exports = {
  QUEUE_VERSION,
  PRIORITY_LABELS,
  scoreQuestion,
  buildQuestionQueue,
};
