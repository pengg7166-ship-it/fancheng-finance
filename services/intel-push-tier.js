/**
 * 情报中心 · 三层推送 Silent / Watch / Interrupt
 */
const { computeInterruptScore } = require('./intel-surprise');
const { freshnessFromStaleness } = require('./intel-evidence-dsl');

const PUSH_VERSION = 'v2.87.0-push-n-audit';

const DAILY_INTERRUPT_CAP = 3;

function resolvePushTier(inst, claim, surprise, actionability, gates, pricingState) {
  const fresh = freshnessFromStaleness(inst?.calendarStaleness, claim?.baselineDate);
  const interrupt = computeInterruptScore(surprise, actionability, fresh);

  let tier = interrupt.tier || 'silent';
  let reasons = [...(actionability?.reasons || [])];
  if (interrupt.reason) reasons.unshift(interrupt.reason);

  if (!gates?.interrupt?.pass) {
    if (tier === 'interrupt') {
      tier = 'watch';
      reasons.push(`Interrupt门禁未过:${gates.interrupt.blockedReasons?.join('、') || '—'}`);
    }
  }

  if (tier === 'interrupt' && (!claim?.evidenceAgainst?.length || claim.evidenceAgainst.length < 1)) {
    tier = 'watch';
    reasons.push('缺反对证据，降级');
  }

  if (pricingState?.state === 'priced-in' && tier === 'interrupt') {
    tier = 'watch';
    reasons.push('已定价，不打断');
  }

  if (inst?.changeDelta?.quietDay) {
    tier = 'silent';
    reasons.push('静默日');
  }

  const labels = { silent: '静默更新', watch: '关注', interrupt: '打断' };
  const surpriseN = surprise?.n ?? null;
  const surpriseNDisplay = surprise?.nDisplay || (surpriseN != null ? String(surpriseN) : '暂无');

  return {
    version: PUSH_VERSION,
    tier,
    tierLabel: labels[tier] || tier,
    score: interrupt.score,
    scoreDisplay: interrupt.score != null ? String(interrupt.score) : '暂无',
    reasons,
    interruptReason: interrupt.reason || null,
    surpriseN,
    surpriseNDisplay,
    formula: interrupt.formula || null,
    cap: DAILY_INTERRUPT_CAP,
    dataSource: 'intel-push-tier',
  };
}

/**
 * 对全市场行应用每日 Interrupt 上限；返回完整列表（非仅候选）。
 */
function rankInterruptCandidates(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const interruptIds = list
    .filter((r) => r?.intelCenter?.pushTier?.tier === 'interrupt')
    .sort((a, b) => (b.intelCenter?.pushTier?.score ?? 0) - (a.intelCenter?.pushTier?.score ?? 0))
    .map((r) => r.id);

  const cappedSet = new Set(interruptIds.slice(DAILY_INTERRUPT_CAP));

  return list.map((r) => {
    if (!r?.intelCenter?.pushTier || r.intelCenter.pushTier.tier !== 'interrupt') return r;
    if (!cappedSet.has(r.id)) {
      return {
        ...r,
        intelCenter: {
          ...r.intelCenter,
          pushTier: { ...r.intelCenter.pushTier, capped: false },
        },
      };
    }
    return {
      ...r,
      intelCenter: {
        ...r.intelCenter,
        pushTier: {
          ...r.intelCenter.pushTier,
          capped: true,
          tier: 'watch',
          tierLabel: '关注(已达日上限)',
        },
      },
    };
  });
}

module.exports = {
  PUSH_VERSION,
  DAILY_INTERRUPT_CAP,
  resolvePushTier,
  rankInterruptCandidates,
};
