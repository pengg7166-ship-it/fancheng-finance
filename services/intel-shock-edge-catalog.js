/**
 * 冲击边图库（构想 §42）
 * 仅收录 CANDIDATE 已评估边 + 验证档案；禁止发明新边 / 假 corr。
 */
const { EDGE_VERIFY_N_GATE, loadEdgeVerifyStats, edgeKey } = require('./intel-shock-dynamics');

const CATALOG_VERSION = 'v2.89.23-shock-edge-catalog';

function catalogStatus(edge, verify) {
  if (!edge?.available) {
    const n = edge?.n;
    if (n != null && n > 0 && n < 20) return 'pendingInsufficientN';
    return 'pendingInsufficientN';
  }
  if (verify?.available) return 'verifiedReady';
  if (verify && !verify.available && verify.n > 0) return 'empiricalOnly';
  if (!verify || verify.hitDisplay === '暂无') return 'noVerifyArchive';
  return 'empiricalOnly';
}

/**
 * @param {object[]} evaluatedEdges — empiricalEdge 结果（含 available/corr/n）
 * @param {object} [verifyStats]
 */
function buildShockEdgeCatalog(evaluatedEdges, verifyStats, opts = {}) {
  const stats = verifyStats || loadEdgeVerifyStats();
  const rows = [];

  for (const e of evaluatedEdges || []) {
    if (!e?.from || !e?.to) continue;
    const key = edgeKey(e.from, e.to);
    const st = stats[key] || null;
    const status = catalogStatus(e, st);
    rows.push({
      key,
      from: e.from,
      to: e.to,
      label: e.label || `${e.from}→${e.to}`,
      mechanismPrior: e.mechanismPrior || e.mechanism || null,
      mechanismClaim: e.mechanismClaim || e.mechanism || null,
      corr: e.corr ?? null,
      n: e.n ?? null,
      nDisplay: e.nDisplay || (e.n != null ? String(e.n) : '暂无'),
      lagTypical: e.lagTypical ?? e.lag ?? null,
      available: Boolean(e.available),
      catalogStatus: status,
      edgeVerify: st
        ? {
            available: Boolean(st.available),
            hitDisplay: st.hitDisplay || '暂无',
            nDisplay: st.nDisplay || '暂无',
            dampen: st.dampen ?? 1,
            note: st.note || null,
          }
        : {
            available: false,
            hitDisplay: '暂无',
            nDisplay: '暂无',
            dampen: 1,
            note: '无验证档案',
          },
      dataSource: e.dataSource || 'readCachedKlines',
      method: 'shock-edge-catalog',
    });
  }

  const verifiedReady = rows.filter((r) => r.catalogStatus === 'verifiedReady');
  const empiricalOnly = rows.filter((r) => r.catalogStatus === 'empiricalOnly' || r.catalogStatus === 'noVerifyArchive');
  const pending = rows.filter((r) => r.catalogStatus === 'pendingInsufficientN');
  const withHit = rows.filter((r) => r.edgeVerify?.available && r.edgeVerify.hitDisplay !== '暂无');

  const topVerified = [...verifiedReady]
    .sort((a, b) => (b.corr || 0) - (a.corr || 0))
    .slice(0, opts.topN || 8)
    .map((r) => ({
      ...r,
      display: `${r.label} · corr ${r.corr != null ? Number(r.corr).toFixed(2) : '暂无'} · n=${r.nDisplay} · 史命中 ${r.edgeVerify.hitDisplay}`,
    }));

  const sampleCatalog = [...rows]
    .sort((a, b) => {
      const rank = { verifiedReady: 0, empiricalOnly: 1, noVerifyArchive: 2, pendingInsufficientN: 3 };
      return (rank[a.catalogStatus] ?? 9) - (rank[b.catalogStatus] ?? 9) || (b.corr || 0) - (a.corr || 0);
    })
    .slice(0, opts.sampleN || 10)
    .map((r) => ({
      ...r,
      display: `${r.label} · ${r.catalogStatus} · n=${r.nDisplay} · 命中 ${r.edgeVerify.hitDisplay}`,
    }));

  return {
    version: CATALOG_VERSION,
    verifyGate: EDGE_VERIFY_N_GATE,
    rows,
    topVerified,
    sampleCatalog,
    counts: {
      catalog: rows.length,
      verifiedReady: verifiedReady.length,
      empiricalOnly: empiricalOnly.length,
      pending: pending.length,
      withHit: withHit.length,
      available: rows.filter((r) => r.available).length,
    },
    display: rows.length
      ? `边图库 ${rows.length} · 验证就绪 ${verifiedReady.length} · 实证 ${empiricalOnly.length} · 待验 ${pending.length}`
      : '边图库 暂无',
    note: '仅候选边评估+验证档案；不发现新边；命中 n 不足标暂无',
    method: 'candidate-evaluated+verify-archive',
    dataSource: 'intel-shock-edge-catalog',
  };
}

module.exports = {
  CATALOG_VERSION,
  buildShockEdgeCatalog,
  catalogStatus,
};
