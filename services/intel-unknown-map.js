/**
 * 情报中心 · Unknown Map OS（构想 §37）
 * 「不知道」是一等输出：缺口 / 影响 / 降档幅度 / 最短补齐路径。
 * 禁止用假数据填洞；缺失一律标暂无/待校验。
 */
const UNKNOWN_VERSION = 'v2.72.0-unknown-map';

const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

const GAP_CATALOG = {
  joint: {
    label: '仓单·资金合证',
    impact: 'high',
    confidenceHaircut: 0.35,
    blocksPublish: true,
    remedy: 'heal/sync 仓单+OI 或等待合证覆盖',
    shortestPath: '跑 warehouse/OI heal → 重算 stock-flow-joint',
    etaHint: '当日可补（源可用时）',
  },
  price: {
    label: '实时报价',
    impact: 'high',
    confidenceHaircut: 0.4,
    blocksPublish: true,
    remedy: '行情接入 / daily-close-sync',
    shortestPath: '同步最新可交易日收盘价',
    etaHint: '当日可补',
  },
  oi_1m: {
    label: '持仓1月',
    impact: 'medium',
    confidenceHaircut: 0.15,
    blocksPublish: false,
    remedy: 'OI 序列抓取（Sina/东财）',
    shortestPath: '补抓 trading-oi 1m 窗口',
    etaHint: '1–2 个交易日',
  },
  basis: {
    label: '基差/期限结构',
    impact: 'medium',
    confidenceHaircut: 0.2,
    blocksPublish: false,
    remedy: '现货-期货价差源 / term-structure',
    shortestPath: '接入现货或近远月价差',
    etaHint: '视源覆盖',
  },
  external: {
    label: '外盘锚点序列',
    impact: 'medium',
    confidenceHaircut: 0.15,
    blocksPublish: false,
    remedy: '同步 COMEX/FRED 外盘',
    shortestPath: '为该品种配置外盘映射并拉日 K',
    etaHint: '视映射表',
  },
  n: {
    label: '历史同类样本 n',
    impact: 'low',
    confidenceHaircut: 0.1,
    blocksPublish: false,
    remedy: 'stateKey 校准扩样',
    shortestPath: '扩大 walk-forward 窗或等待桶 n≥30',
    etaHint: '校准周期',
  },
  dissent: {
    label: '对侧证据',
    impact: 'high',
    confidenceHaircut: 0.25,
    blocksPublish: true,
    remedy: '红队/内核反对意见必填',
    shortestPath: '强制写入至少 1 条 evidenceAgainst',
    etaHint: '即时（重算）',
  },
  dual_split_unresolved: {
    label: '内外分裂未裁决',
    impact: 'medium',
    confidenceHaircut: 0.12,
    blocksPublish: false,
    remedy: '等待外盘或国内结构一方确认',
    shortestPath: '追踪 dual-narrative 至 resonate/单边',
    etaHint: '结构确认前',
  },
};

function detectGaps(inst, claim) {
  const gaps = [];
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const cap = inst?.capitalAttention;
  const basis = inst?.factors?.basis || inst?.basis || inst?.termStructure;

  if (!sf?.available) {
    const jointLabel = inst?.capitalAttention?.jointWithInventory;
    const hasJointLabel = jointLabel && jointLabel !== '暂无' && jointLabel !== '—';
    if (!hasJointLabel) gaps.push({ id: 'joint', ...GAP_CATALOG.joint });
  }

  if (inst?.outlookPending || (inst?.price == null && inst?.insufficientData)) {
    gaps.push({ id: 'price', ...GAP_CATALOG.price });
  }

  if (cap?.horizons?.oi1mPct == null) {
    gaps.push({ id: 'oi_1m', ...GAP_CATALOG.oi_1m });
  }

  if ((!basis || basis.available === false) && inst?.sector !== 'precious') {
    gaps.push({ id: 'basis', ...GAP_CATALOG.basis });
  }

  if (claim?.n == null) {
    gaps.push({ id: 'n', ...GAP_CATALOG.n });
  }

  const dual = inst?.dualNarrative || inst?.factors?.dualNarrative || inst?.intelCenter?.dualNarrative;
  if (dual?.mapped && dual.regime === 'domestic_only') {
    gaps.push({ id: 'external', ...GAP_CATALOG.external });
  }
  if (dual?.regime === 'split') {
    gaps.push({ id: 'dual_split_unresolved', ...GAP_CATALOG.dual_split_unresolved });
  }

  const against = claim?.evidenceAgainst?.length || 0;
  const kernelOpp = inst?.intelligenceKernel?.dissent?.opposingEvidence?.length || 0;
  if (claim && against === 0 && kernelOpp === 0 && claim.status !== 'draft') {
    gaps.push({ id: 'dissent', ...GAP_CATALOG.dissent });
  }

  return gaps.map((g) => ({
    ...g,
    available: false,
    note: '缺口·未填充',
  }));
}

function sumHaircut(gaps) {
  let h = 0;
  for (const g of gaps || []) {
    h += Number(g.confidenceHaircut) || 0;
  }
  return Math.min(0.75, +h.toFixed(2));
}

/**
 * 单品种 Unknown Map
 */
function buildUnknownMap(inst, claim) {
  const gaps = detectGaps(inst, claim);
  const criticalGaps = gaps.filter((g) => g.impact === 'high');
  const blockingGaps = gaps.filter((g) => g.blocksPublish);
  const confidenceHaircut = sumHaircut(gaps);

  const shortestPath = [...gaps]
    .sort((a, b) => (IMPACT_RANK[b.impact] || 0) - (IMPACT_RANK[a.impact] || 0))
    .slice(0, 3)
    .map((g) => ({
      gapId: g.id,
      label: g.label,
      path: g.shortestPath || g.remedy,
      etaHint: g.etaHint || '暂无',
      impact: g.impact,
    }));

  return {
    version: UNKNOWN_VERSION,
    available: true,
    instrumentId: inst?.id || null,
    gaps,
    criticalGaps,
    blockingGaps,
    hasCritical: criticalGaps.length > 0,
    blocksPublish: blockingGaps.length > 0,
    confidenceHaircut,
    confidenceHaircutDisplay:
      confidenceHaircut > 0 ? `置信建议×${(1 - confidenceHaircut).toFixed(2)}` : '暂无降档',
    shortestPath,
    nextAction: shortestPath[0] || null,
    display: criticalGaps.length
      ? `关键缺口:${criticalGaps.map((g) => g.label).join('、')} · ${shortestPath[0]?.path || '—'}`
      : gaps.length
        ? `缺口:${gaps.length} · 下一步 ${shortestPath[0]?.path || '—'}`
        : '暂无关键缺口',
    dataSource: 'intel-unknown-map',
    method: 'gap-catalog+haircut+shortest-path',
  };
}

/**
 * Pack 级 Unknown 汇总（还债优先队列）
 */
function buildUnknownBoard(instruments) {
  const rows = [];
  for (const inst of instruments || []) {
    const map = inst?.intelCenter?.unknownMap || inst?.intelCenter?.memo?.unknownMap;
    if (!map?.gaps?.length) continue;
    for (const g of map.gaps) {
      rows.push({
        instrumentId: inst.id,
        instrumentName: inst.name,
        gapId: g.id,
        label: g.label,
        impact: g.impact,
        blocksPublish: !!g.blocksPublish,
        path: g.shortestPath || g.remedy,
        etaHint: g.etaHint || '暂无',
        haircut: g.confidenceHaircut ?? null,
      });
    }
  }

  rows.sort(
    (a, b) =>
      (IMPACT_RANK[b.impact] || 0) - (IMPACT_RANK[a.impact] || 0) ||
      (b.blocksPublish ? 1 : 0) - (a.blocksPublish ? 1 : 0)
  );

  const byGap = {};
  for (const r of rows) {
    byGap[r.gapId] = (byGap[r.gapId] || 0) + 1;
  }

  const criticalInstruments = new Set(rows.filter((r) => r.impact === 'high').map((r) => r.instrumentId));
  const paydown = rows.filter((r) => r.impact === 'high' || r.blocksPublish).slice(0, 10);

  return {
    version: UNKNOWN_VERSION,
    totalGaps: rows.length,
    criticalInstrumentCount: criticalInstruments.size,
    byGap,
    paydown,
    display:
      rows.length === 0
        ? 'Unknown Map 清空'
        : `Unknown ${rows.length} 缺口 · 关键品种 ${criticalInstruments.size} · 优先还 ${paydown
            .slice(0, 3)
            .map((p) => p.instrumentName || p.instrumentId)
            .join('、')}`,
    dataSource: 'intel-unknown-map',
    method: 'pack-aggregate',
  };
}

module.exports = {
  UNKNOWN_VERSION,
  GAP_CATALOG,
  buildUnknownMap,
  buildUnknownBoard,
  detectGaps,
};
