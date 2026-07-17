/**
 * 情报中心 · 定价 × 证伪时钟指挥官板（构想 §定价/证伪时钟）
 * mispriced / unpriced / 临近证伪 / 推送封顶 — 全部来自真实评估，无假 deadline。
 */
const PRICING_CLOCK_BOARD_VERSION = 'v2.86.0-pricing-clock-board';

function buildPricingClockBoard(instruments, opts = {}) {
  const mispriced = [];
  const unpriced = [];
  const pricedIn = [];
  const clockDue = [];
  const clockExpired = [];
  const watchCapped = [];
  const questions = [];

  for (const inst of instruments || []) {
    const ic = inst.intelCenter;
    if (!ic) continue;
    const pricing = ic.pricingState;
    const clock = ic.clock;
    const push = ic.pushTier;
    const claim = ic.primaryClaim;
    const name = inst.name || inst.id;

    if (pricing?.state === 'mispriced') {
      mispriced.push({
        instrumentId: inst.id,
        instrumentName: name,
        state: pricing.state,
        stateLabel: pricing.stateLabel || '定价背离',
        rationale: (pricing.rationale || []).slice(0, 2),
        actionHint: pricing.actionHint || null,
        pushTier: push?.tier || null,
        text: `${name} · ${pricing.stateLabel || '定价背离'}${(pricing.rationale || [])[0] ? ` · ${pricing.rationale[0]}` : ''}`,
        dataSource: pricing.dataSource || 'intel-pricing-state',
      });
    } else if (pricing?.state === 'unpriced') {
      unpriced.push({
        instrumentId: inst.id,
        instrumentName: name,
        state: pricing.state,
        stateLabel: pricing.stateLabel || '未定价',
        text: `${name} · 未定价 · ${pricing.actionHint || '可提高关注'}`,
        dataSource: pricing.dataSource || 'intel-pricing-state',
      });
    } else if (pricing?.state === 'priced-in') {
      pricedIn.push({
        instrumentId: inst.id,
        instrumentName: name,
        text: `${name} · 已定价 · 禁重复利好打断`,
        dataSource: pricing.dataSource || 'intel-pricing-state',
      });
    }

    const agg = clock?.aggregate;
    if (agg?.level === 'red') {
      const row = {
        instrumentId: inst.id,
        instrumentName: name,
        level: agg.level,
        daysLeft: agg.daysLeft ?? null,
        label: agg.label || clock.display || '临近证伪',
        nextCheckpoint: clock.nextCheckpoint || claim?.validUntil || null,
        claimStatus: claim?.status || null,
        text: `${name} · ${clock.display || agg.label}${
          agg.daysLeft != null ? ` · 剩${agg.daysLeft}日` : ''
        }`,
        dataSource: 'intel-falsification-clock',
      };
      if (agg.daysLeft != null && agg.daysLeft < 0) clockExpired.push(row);
      else clockDue.push(row);
    } else if (agg?.level === 'yellow') {
      clockDue.push({
        instrumentId: inst.id,
        instrumentName: name,
        level: agg.level,
        daysLeft: agg.daysLeft ?? null,
        label: agg.label,
        nextCheckpoint: clock.nextCheckpoint || null,
        text: `${name} · ${clock.display || agg.label}`,
        dataSource: 'intel-falsification-clock',
      });
    }

    if (push?.capped || (push?.tier === 'watch' && (push.reasons || []).some((r) => /上限|cap|已定价|门禁/i.test(r)))) {
      watchCapped.push({
        instrumentId: inst.id,
        instrumentName: name,
        tier: push.tier,
        reasons: (push.reasons || []).slice(0, 3),
        capped: Boolean(push.capped),
        text: `${name} · ${push.tierLabel || push.tier}${
          push.capped ? ' · 日上限封顶' : ''
        }${(push.reasons || [])[0] ? ` · ${push.reasons[0]}` : ''}`,
        dataSource: 'intel-push-tier',
      });
    }
  }

  mispriced.sort((a, b) => (a.instrumentName || '').localeCompare(b.instrumentName || ''));
  clockDue.sort((a, b) => {
    const da = a.daysLeft != null ? a.daysLeft : 999;
    const db = b.daysLeft != null ? b.daysLeft : 999;
    return da - db;
  });

  for (const m of mispriced.slice(0, 6)) {
    questions.push({
      priority: 'P1',
      score: 42,
      instrumentId: m.instrumentId,
      instrumentName: m.instrumentName,
      question: `${m.instrumentName}：定价背离 — ${(m.rationale || [])[0] || m.actionHint || '红队+深度优先'}？`,
      reasons: ['定价时钟板', 'mispriced'],
      dataSource: 'intel-pricing-clock-board',
    });
  }
  for (const c of clockExpired.slice(0, 4)) {
    questions.push({
      priority: 'P1',
      score: 44,
      instrumentId: c.instrumentId,
      instrumentName: c.instrumentName,
      question: `${c.instrumentName}：证伪时钟已过期 — 命题是否应 expired/falsified？`,
      reasons: ['定价时钟板', 'clock-expired'],
      dataSource: 'intel-pricing-clock-board',
    });
  }
  for (const c of clockDue.filter((x) => x.level === 'red' && (x.daysLeft == null || x.daysLeft >= 0)).slice(0, 4)) {
    questions.push({
      priority: 'P2',
      score: 36,
      instrumentId: c.instrumentId,
      instrumentName: c.instrumentName,
      question: `${c.instrumentName}：证伪临近${c.daysLeft != null ? `（剩${c.daysLeft}日）` : ''} — 触发器是否已部分命中？`,
      reasons: ['定价时钟板', 'clock-due'],
      dataSource: 'intel-pricing-clock-board',
    });
  }

  return {
    version: PRICING_CLOCK_BOARD_VERSION,
    asOf: opts.asOf || null,
    counts: {
      mispriced: mispriced.length,
      unpriced: unpriced.length,
      pricedIn: pricedIn.length,
      clockDue: clockDue.length,
      clockExpired: clockExpired.length,
      watchCapped: watchCapped.length,
    },
    mispriced: mispriced.slice(0, 16),
    unpriced: unpriced.slice(0, 12),
    pricedIn: pricedIn.slice(0, 8),
    clockDue: clockDue.slice(0, 16),
    clockExpired: clockExpired.slice(0, 10),
    watchCapped: watchCapped.slice(0, 12),
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 12),
    display:
      mispriced.length || clockDue.length || clockExpired.length
        ? `定价/时钟 背离 ${mispriced.length} · 临近 ${clockDue.length} · 过期 ${clockExpired.length} · 未定价 ${unpriced.length}`
        : unpriced.length
          ? `定价/时钟 未定价 ${unpriced.length} · 暂无背离/临近`
          : '定价/时钟 暂无显著项',
    note: 'deadline 仅来自真实时钟；daysLeft 缺失标暂无，不编造',
    dataSource: 'intel-pricing-clock-board',
    method: 'pricing-state×falsify-clock×push-cap',
  };
}

function enrichQuestionQueueWithPricingClock(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId || ''}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId || ''}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P1',
      priorityLabel: '定价/时钟',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    pricingClockInjected: extra.length,
    version: `${queue.version || ''}+pricingclock`,
  };
}

module.exports = {
  PRICING_CLOCK_BOARD_VERSION,
  buildPricingClockBoard,
  enrichQuestionQueueWithPricingClock,
};
