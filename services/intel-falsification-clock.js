/**
 * 情报中心 · 证伪时钟
 * 事件 / 结构 / 价格反馈三类；缺失不假装有 deadline。
 */
const eventCalendar = require('./commodity-outlook-event-calendar');

const CLOCK_VERSION = 'v2.86.0-falsify-clock';

function addDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db - da) / 86400000);
}

function buildEventClocks(inst, asOf) {
  const clocks = [];
  const today = asOf || new Date().toISOString().slice(0, 10);
  const events = eventCalendar.getActiveEventsMerged(today, {
    instrumentId: inst?.id,
    sector: inst?.sector,
  });

  if (events?.active?.length) {
    for (const ev of events.active.slice(0, 3)) {
      clocks.push({
        type: 'event',
        label: ev.label || ev.id,
        checkAt: ev.end || addDays(today, 7),
        checkpoints: [addDays(today, 1), addDays(today, 3), addDays(today, 5)],
        status: 'pending',
        dataSource: 'event-calendar',
      });
    }
  }

  return clocks;
}

function buildStructureClock(claim, inst) {
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const horizonDays = claim?.horizon === 'tactical' ? 5 : claim?.horizon === 'paradigm' ? 90 : 14;
  const baseline = claim?.baselineDate || new Date().toISOString().slice(0, 10);

  return {
    type: 'structure',
    label: sf?.available ? `合证延续监测·${sf.primaryRegime || sf.primaryLabel || '—'}` : '结构指标延续监测',
    validUntil: claim?.validUntil || addDays(baseline, horizonDays),
    checkpoints: [addDays(baseline, Math.floor(horizonDays / 3)), addDays(baseline, Math.floor((2 * horizonDays) / 3))],
    falsifyCondition:
      claim?.side === 'bull'
        ? '去库/OI 结构未延续'
        : claim?.side === 'bear'
          ? '抛压结构缓解'
          : '矛盾未明朗化',
    status: 'active',
    dataSource: sf?.dataSource || 'structure-clock',
  };
}

function buildPriceFeedbackClock(inst, claim) {
  if (claim?.horizon !== 'tactical') return null;
  const vol = inst?.nextDayRangePct?.halfWidth ?? inst?.smoothedVol?.sigma20;
  if (vol == null) return null;
  const baseline = claim?.baselineDate || new Date().toISOString().slice(0, 10);

  return {
    type: 'price_feedback',
    label: '战术价格反馈',
    validUntil: addDays(baseline, 5),
    checkpoints: [addDays(baseline, 2), addDays(baseline, 5)],
    falsifyCondition: `突破后 ${vol.toFixed(1)}% 波动区间内无法站稳且基差背离`,
    status: 'auxiliary',
    dataSource: 'next-day-range',
    note: '辅助层，不单独证伪结构命题',
  };
}

function computeClockUrgency(clock, asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const end = clock.validUntil || clock.checkAt;
  if (!end) return { level: 'unknown', daysLeft: null, label: '待校验' };

  const left = daysBetween(today, end);
  if (left < 0) return { level: 'red', daysLeft: left, label: '已过期' };
  if (left <= 2) return { level: 'red', daysLeft: left, label: '临近证伪' };
  if (left <= 7) return { level: 'yellow', daysLeft: left, label: '关注' };
  return { level: 'green', daysLeft: left, label: '充裕' };
}

function buildFalsificationClock(claim, inst, asOf) {
  if (!claim) {
    return {
      version: CLOCK_VERSION,
      available: false,
      reason: 'no_claim',
      clocks: [],
      aggregate: { level: 'unknown', label: '暂无' },
    };
  }

  const clocks = [
    buildStructureClock(claim, inst),
    buildPriceFeedbackClock(inst, claim),
    ...buildEventClocks(inst, asOf),
  ].filter(Boolean);

  const urgencies = clocks.map((c) => computeClockUrgency(c, asOf));
  const worst = urgencies.reduce(
    (w, u) => {
      const rank = { red: 3, yellow: 2, green: 1, unknown: 0 };
      if (rank[u.level] > rank[w.level]) return u;
      if (rank[u.level] === rank[w.level]) {
        if (u.daysLeft != null && (w.daysLeft == null || u.daysLeft < w.daysLeft)) return u;
      }
      return w;
    },
    { level: 'unknown', label: '待校验', daysLeft: null }
  );

  const triggerSummary = (claim.triggers || [])
    .filter((t) => t.type === 'falsify')
    .map((t) => t.condition)
    .slice(0, 2);

  return {
    version: CLOCK_VERSION,
    available: true,
    claimId: claim.claimId,
    clocks,
    aggregate: worst,
    nextCheckpoint:
      clocks
        .map((c) => (c.checkpoints || []).find((d) => d >= (asOf || new Date().toISOString().slice(0, 10))))
        .filter(Boolean)
        .sort()[0] || claim.validUntil,
    triggerSummary,
    display: `证伪时钟:${worst.label}${
      worst.daysLeft != null && worst.daysLeft < 900 ? `·剩${worst.daysLeft}日` : ''
    }`,
    dataSource: 'intel-falsification-clock',
  };
}

module.exports = {
  CLOCK_VERSION,
  buildFalsificationClock,
  buildStructureClock,
  buildEventClocks,
  computeClockUrgency,
  addDays,
};
