/**
 * 情报中心 · 问题债务看板
 * 长期缺口、无 n 命题、合证覆盖不足 — 必须可见、可还债。
 */
const { getIntelDir, readJsonl } = require('./intel-memory');

const DEBT_VERSION = 'v2.80.0-debt-museum';

const DEBT_TYPES = {
  joint_gap: { label: '合证覆盖缺口', severity: 'high', blocksPublish: true },
  basis_gap: { label: '基差/期限结构缺失', severity: 'medium', blocksPublish: false },
  n_missing: { label: '命题无历史 n', severity: 'medium', blocksPublish: false },
  stale_data: { label: '数据滞后', severity: 'high', blocksPublish: true },
  gate_blocked: { label: '发布门禁长期未过', severity: 'low', blocksPublish: false },
  unknown_critical: { label: '关键 Unknown Map 缺口', severity: 'high', blocksPublish: true },
  repeat_falsify: { label: '近30日重复证伪', severity: 'high', blocksPublish: false },
};

function daysSince(iso) {
  if (!iso) return null;
  const d = (Date.now() - Date.parse(String(iso).slice(0, 10))) / 86400000;
  return Math.max(0, Math.floor(d));
}

function scanInstrumentDebt(inst) {
  const debts = [];
  const ic = inst?.intelCenter;
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const lag = inst?.calendarStaleness?.lagDays ?? inst?.calendarStaleness?.daysBehind;

  if (!sf?.available) {
    const jointLabel = inst?.capitalAttention?.jointWithInventory;
    const hasJointLabel = jointLabel && jointLabel !== '暂无' && jointLabel !== '—';
    if (!hasJointLabel) {
      debts.push({
        type: 'joint_gap',
        instrumentId: inst.id,
        instrumentName: inst.name,
        impact: 'high',
        daysOpen: null,
        remedy: 'heal/sync 或等待合证源',
        blocksPublish: true,
      });
    }
  }

  if (lag != null && lag > 1) {
    debts.push({
      type: 'stale_data',
      instrumentId: inst.id,
      instrumentName: inst.name,
      impact: 'high',
      daysOpen: lag,
      remedy: 'daily-close-sync / OI 抓取',
      blocksPublish: true,
    });
  }

  const claim = ic?.primaryClaim;
  if (claim && claim.n == null && claim.status === 'active') {
    debts.push({
      type: 'n_missing',
      instrumentId: inst.id,
      instrumentName: inst.name,
      impact: 'medium',
      daysOpen: daysSince(claim.baselineDate),
      remedy: 'stateKey 校准扩样',
      blocksPublish: false,
    });
  }

  if (ic?.memo?.unknownMap?.criticalGaps?.length) {
    for (const g of ic.memo.unknownMap.criticalGaps) {
      debts.push({
        type: 'unknown_critical',
        instrumentId: inst.id,
        instrumentName: inst.name,
        impact: 'high',
        label: g.label,
        daysOpen: null,
        remedy: g.remedy || '数据补齐',
        blocksPublish: true,
      });
    }
  }

  if (ic?.gates?.top5 && !ic.gates.top5.pass && ic.gates.top5.blockedReasons?.length) {
    const blocked = ic.gates.top5.blockedReasons.join('、');
    if (blocked.includes('反对') || blocked.includes('新鲜')) {
      debts.push({
        type: 'gate_blocked',
        instrumentId: inst.id,
        instrumentName: inst.name,
        impact: 'low',
        detail: blocked,
        daysOpen: null,
        remedy: '补齐证据或降档',
        blocksPublish: false,
      });
    }
  }

  const basis = inst?.factors?.basis || inst?.basis;
  if (!basis && !['precious'].includes(inst?.sector)) {
    debts.push({
      type: 'basis_gap',
      instrumentId: inst.id,
      instrumentName: inst.name,
      impact: 'medium',
      daysOpen: null,
      remedy: '现货-期货价差源',
      blocksPublish: false,
    });
  }

  return debts;
}

function buildDebtBoard(instruments) {
  const all = [];
  for (const inst of instruments || []) {
    all.push(...scanInstrumentDebt(inst));
  }

  const byType = {};
  for (const d of all) {
    byType[d.type] = (byType[d.type] || 0) + 1;
  }

  const blocking = all.filter((d) => d.blocksPublish);
  const registryN = instruments?.length ?? 74;
  const jointCovered = (instruments || []).filter((i) => {
    const sf = i.factors?.inventory?.stockFlowJoint;
    if (sf?.available) return true;
    const jl = i.capitalAttention?.jointWithInventory;
    return jl && jl !== '暂无' && jl !== '—';
  }).length;

  const priorityPaydown = [...all]
    .sort((a, b) => {
      const sev = { high: 3, medium: 2, low: 1 };
      return (sev[b.impact] || 0) - (sev[a.impact] || 0) || (b.daysOpen ?? 0) - (a.daysOpen ?? 0);
    })
    .slice(0, 12);

  return {
    version: DEBT_VERSION,
    totalDebts: all.length,
    blockingCount: blocking.length,
    byType,
    debtTypes: DEBT_TYPES,
    jointCoverage: {
      covered: jointCovered,
      total: instruments?.length ?? registryN,
      display: `${jointCovered}/${instruments?.length ?? registryN}`,
      pct: instruments?.length ? +((jointCovered / instruments.length) * 100).toFixed(1) : null,
    },
    priorityPaydown,
    weeklyMustPay: priorityPaydown.filter((d) => d.impact === 'high').slice(0, 5),
    weeklyPlan: {
      mustPay: priorityPaydown.filter((d) => d.impact === 'high').slice(0, 5),
      shouldPay: priorityPaydown.filter((d) => d.impact === 'medium').slice(0, 4),
      note: '每周优先还阻断发布项；博物馆重复证伪并入 mustPay',
    },
    display:
      all.length === 0
        ? '暂无问题债务'
        : `问题债务 ${all.length} 项 · 阻断发布 ${blocking.length} · 合证 ${jointCovered}/${instruments?.length ?? '—'} · 本周必还 ${priorityPaydown.filter((d) => d.impact === 'high').slice(0, 5).length}`,
    dataSource: 'intel-debt-board',
    method: 'coverage+staleness+unknown-scan+weekly-plan',
  };
}

module.exports = {
  DEBT_VERSION,
  DEBT_TYPES,
  scanInstrumentDebt,
  buildDebtBoard,
};
