/**
 * 跨品种共享机制链（构想 §74）
 * 由候选冲击边按机制先验聚类；成员覆盖来自今日包真实 id；无 corr/n 标暂无。
 */
const { CANDIDATE_EDGES } = require('./intel-shock-graph');
const { edgeKey } = require('./intel-shock-dynamics');

const SHARED_MECH_VERSION = 'v2.89.23-shared-mechanism-chain';

const MECH_LABELS = {
  cost: '成本传导',
  substitute: '替代/价差',
  sentiment: '情绪/比价',
  arbitrage: '套利/内外',
  co_move: '滞后共动',
};

/**
 * @param {object} shockGraph
 * @param {object[]} instruments
 */
function buildSharedMechanismChains(shockGraph, instruments, opts = {}) {
  const asOf = opts.asOf || shockGraph?.asOf || null;
  const present = new Set();
  const nameById = {};
  for (const i of instruments || []) {
    if (!i?.id) continue;
    const id = String(i.id);
    present.add(id);
    present.add(id.toLowerCase());
    nameById[id] = i.name || id;
    nameById[id.toLowerCase()] = i.name || id;
  }

  const evaluatedByKey = new Map();
  const allEval = [
    ...(shockGraph?.activeEdges || []),
    ...(shockGraph?.pendingEdges || []),
    ...(shockGraph?.edgeCatalog?.rows || []),
  ];
  // Prefer catalog rows if present; else active/pending
  const catalogRows = shockGraph?.edgeCatalog?.rows || [];
  if (catalogRows.length) {
    for (const r of catalogRows) {
      evaluatedByKey.set(r.key || edgeKey(r.from, r.to), r);
    }
  } else {
    for (const e of allEval) {
      if (!e?.from || !e?.to) continue;
      evaluatedByKey.set(edgeKey(e.from, e.to), e);
    }
  }

  const byMech = {};
  for (const cand of CANDIDATE_EDGES) {
    const mech = cand.mechanism || 'co_move';
    if (!byMech[mech]) {
      byMech[mech] = {
        chainId: `shared-${mech}`,
        mechanismPrior: mech,
        mechanismLabel: MECH_LABELS[mech] || mech,
        label: `共享 · ${MECH_LABELS[mech] || mech}`,
        candidates: [],
      };
    }
    byMech[mech].candidates.push(cand);
  }

  const chains = [];
  for (const g of Object.values(byMech)) {
    const nodes = new Set();
    const edges = [];
    let withN = 0;
    let verified = 0;
    for (const cand of g.candidates) {
      nodes.add(cand.from);
      nodes.add(cand.to);
      const key = edgeKey(cand.from, cand.to);
      const ev = evaluatedByKey.get(key);
      const n = ev?.n ?? null;
      const nDisplay = ev?.nDisplay || (n != null ? String(n) : '暂无');
      const corr = ev?.corr ?? null;
      const hit = ev?.edgeVerify?.hitDisplay || '暂无';
      const available = Boolean(ev?.available);
      if (n != null && n > 0) withN += 1;
      if (ev?.edgeVerify?.available || ev?.catalogStatus === 'verifiedReady') verified += 1;
      edges.push({
        from: cand.from,
        to: cand.to,
        label: cand.label,
        corr,
        n,
        nDisplay,
        available,
        hitDisplay: hit,
        catalogStatus: ev?.catalogStatus || (available ? 'empiricalOnly' : 'pendingInsufficientN'),
        dataSource: ev?.dataSource || 'intel-shock-graph',
      });
    }

    const memberInstruments = [...nodes].filter(
      (id) => present.has(id) || present.has(String(id).toLowerCase())
    );
    const edgeCount = edges.length;
    const coverageN = edges.filter((e) => e.available || (e.n != null && e.n > 0)).length;
    const sharedDepth = coverageN;
    const sharedDepthDisplay = edgeCount ? `${coverageN}/${edgeCount} 环实证` : '暂无';

    chains.push({
      chainId: g.chainId,
      mechanismPrior: g.mechanismPrior,
      mechanismLabel: g.mechanismLabel,
      label: g.label,
      nodes: [...nodes],
      edges,
      memberInstruments,
      memberCount: memberInstruments.length,
      edgeCount,
      coverageN,
      coverageDisplay: sharedDepthDisplay,
      sharedDepth,
      sharedDepthDisplay,
      verifiedEdges: verified,
      withN,
      display: `${g.label} · 成员${memberInstruments.length} · ${sharedDepthDisplay}${
        verified ? ` · 验证边${verified}` : ''
      }`,
      dataSource: 'intel-shared-mechanism-chain',
      method: 'candidate-cluster+evaluated-coverage',
    });
  }

  chains.sort(
    (a, b) =>
      b.sharedDepth - a.sharedDepth || b.memberCount - a.memberCount || b.verifiedEdges - a.verifiedEdges
  );

  const withDepth = chains.filter((c) => c.sharedDepth > 0);

  return {
    version: SHARED_MECH_VERSION,
    asOf,
    chains: chains.slice(0, 12),
    top: withDepth.slice(0, 6),
    counts: {
      sharedChains: chains.length,
      sharedChainsWithN: withDepth.length,
      membersOnChains: new Set(chains.flatMap((c) => c.memberInstruments)).size,
      verifiedEdges: chains.reduce((s, c) => s + c.verifiedEdges, 0),
    },
    display: withDepth.length
      ? `共享机制链 ${withDepth.length}/${chains.length} 有实证环 · 成员 ${
          new Set(chains.flatMap((c) => c.memberInstruments)).size
        }`
      : chains.length
        ? `共享机制链 ${chains.length} · 暂无实证环`
        : '共享机制链 暂无',
    note: '链=候选机制先验聚类；覆盖=真实评估边 corr/n；非独立因果推理引擎',
    method: 'shared-mechanism-chain',
    dataSource: 'intel-shared-mechanism-chain',
  };
}

module.exports = {
  SHARED_MECH_VERSION,
  buildSharedMechanismChains,
  MECH_LABELS,
};
