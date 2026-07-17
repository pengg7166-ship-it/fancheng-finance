/**
 * 组合相关性簇门禁 '同簇 3 槽时有效独立押注 '2
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const CORRELATION_GATE_VERSION = 'v1.44.0-discipline';
const MAX_EFFECTIVE_INDEPENDENT = 2;

const CLUSTERS = Object.freeze({
  precious: { id: 'precious', label: '贵金', symbols: ['ag', 'au'] },
  nonferrous: { id: 'nonferrous', label: '有色', symbols: ['cu', 'al', 'ni', 'sn', 'zn', 'pb'] },
  black: { id: 'black', label: '黑色', symbols: ['i', 'rb', 'jm', 'j', 'hc'] },
  chemical_energy: {
    id: 'chemical_energy',
    label: '能化/化工',
    symbols: ['sc', 'fu', 'lu', 'pg', 'eb', 'eg', 'pp', 'l', 'v', 'ma', 'ta', 'pf', 'px', 'br', 'ru', 'fg', 'sa', 'ur'],
  },
});

function nowIso() {
  return new Date().toISOString();
}

function getClusterForSymbol(symbol) {
  const id = normalizeCommodityId(symbol);
  if (!id) return null;
  for (const cluster of Object.values(CLUSTERS)) {
    if (cluster.symbols.includes(id)) return cluster;
  }
  return { id: 'other', label: '其他', symbols: [] };
}

/**
 * @param {string[]} holdings 'normalized 0-3 symbols
 * @param {object} options '{ candidateSymbol }
 */
function computeClusterGate(holdings = [], options = {}) {
  const asOf = nowIso();
  const logicChain = [];
  const held = (holdings || []).map(normalizeCommodityId).filter(Boolean);
  const clusterCounts = new Map();

  for (const sym of held) {
    const c = getClusterForSymbol(sym);
    const key = c?.id || 'other';
    clusterCounts.set(key, (clusterCounts.get(key) || 0) + 1);
  }

  const clusterBreakdown = [...clusterCounts.entries()].map(([clusterId, count]) => {
    const meta = Object.values(CLUSTERS).find((c) => c.id === clusterId) || { id: clusterId, label: clusterId };
    return { clusterId, label: meta.label, count, symbols: held.filter((s) => getClusterForSymbol(s)?.id === clusterId) };
  });

  let capNewScout = false;
  let capReason = null;
  let clusterWarning = null;
  let effectiveIndependentBets = held.length;

  const dominant = clusterBreakdown.find((b) => b.count >= 3);
  if (dominant) {
    effectiveIndependentBets = MAX_EFFECTIVE_INDEPENDENT;
    capNewScout = true;
    capReason = `同簇(${dominant.label})占满 3 '· 有效独立押注'{MAX_EFFECTIVE_INDEPENDENT}`;
    clusterWarning = `${dominant.label}'3/3 · 分散度不足`;
    logicChain.push({
      layer: 'ClusterGate',
      conclusion: 'cap-scout',
      evidence: capReason,
      dataSource: 'portfolio-correlation-gate',
      asOf,
    });
  } else {
    const heavy = clusterBreakdown.find((b) => b.count >= 2);
    if (heavy) {
      clusterWarning = `${heavy.label}'${heavy.count} '· 注意相关性`;
      logicChain.push({
        layer: 'ClusterGate',
        conclusion: 'warn',
        evidence: clusterWarning,
        dataSource: 'portfolio-correlation-gate',
        asOf,
      });
    }
  }

  const candidate = options.candidateSymbol ? normalizeCommodityId(options.candidateSymbol) : null;
  if (candidate && held.length >= 2 && !capNewScout) {
    const candCluster = getClusterForSymbol(candidate)?.id;
    const sameCount = held.filter((s) => getClusterForSymbol(s)?.id === candCluster).length;
    if (sameCount >= 2 && held.length >= MAX_EFFECTIVE_INDEPENDENT) {
      capNewScout = true;
      capReason = capReason || `候'${candidate} 与持仓同'· 有效独立押注将超限`;
      logicChain.push({
        layer: 'ClusterGate',
        conclusion: 'reject-candidate',
        evidence: capReason,
        dataSource: 'portfolio-correlation-gate',
        asOf,
      });
    }
  }

  return {
    clusterBreakdown,
    effectiveIndependentBets,
    maxEffectiveIndependent: MAX_EFFECTIVE_INDEPENDENT,
    capNewScout,
    capReason,
    clusterWarning,
    logicChain,
    dataSource: 'portfolio-correlation-gate',
    method: 'cluster-concentration-cap',
    version: CORRELATION_GATE_VERSION,
    asOf,
  };
}

function applyClusterGateToPosture(posture, symbol, clusterGate, logicChain) {
  if (!clusterGate?.capNewScout) return posture;
  if (posture !== '试仓' && posture !== '加仓') return posture;
  if (logicChain) {
    logicChain.push({
      layer: 'ClusterGate',
      conclusion: '观望',
      evidence: clusterGate.capReason || '簇集中度门禁',
      dataSource: 'portfolio-correlation-gate',
      asOf: clusterGate.asOf || nowIso(),
    });
  }
  return '观望';
}

module.exports = {
  CORRELATION_GATE_VERSION,
  CLUSTERS,
  MAX_EFFECTIVE_INDEPENDENT,
  getClusterForSymbol,
  computeClusterGate,
  applyClusterGateToPosture,
};
