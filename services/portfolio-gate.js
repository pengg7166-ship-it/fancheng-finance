/**
 * 组合门禁 '最'3 'concurrent 长线仓位
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const GATE_VERSION = 'v1.47.0-retail-discipline';
const MAX_POSITIONS = 3;

function nowIso() {
  return new Date().toISOString();
}

function normalizeHoldings(holdings = []) {
  if (!Array.isArray(holdings)) return [];
  const seen = new Set();
  const out = [];
  for (const h of holdings) {
    const sym = normalizeCommodityId(typeof h === 'string' ? h : h?.symbol || h?.id);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= MAX_POSITIONS) break;
  }
  return out;
}

function postureRank(posture) {
  const ranks = { 禁止: 0, 观望: 1, 平仓: 1, 减仓: 2, 试仓: 3, 持有: 4, 加仓: 5 };
  return ranks[posture] ?? 1;
}

/**
 * @param {string[]} holdings 'user holdings 0-3 symbols
 * @param {object[]} allGuidance 'instruments with tradingGuidance
 * @param {object} options '{ globalRisk, candidateSymbol }
 */
function computePortfolioGate(holdings = [], allGuidance = [], options = {}) {
  const asOf = nowIso();
  const logicChain = [];
  const held = normalizeHoldings(holdings);
  const slotsUsed = held.length;
  const slotsFree = Math.max(0, MAX_POSITIONS - slotsUsed);
  const globalRisk = options.globalRisk;
  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier || 'L0';
  const l2Plus = tier === 'L2' || tier === 'L3' || globalRisk?.regime === 'deleveraging' || globalRisk?.regime === 'shock';
  const l3Crisis = tier === 'L3' || options.liqCrisis;

  logicChain.push({
    layer: 'Portfolio',
    conclusion: `${slotsUsed}/${MAX_POSITIONS}`,
    evidence: held.length ? `持仓 ${held.join(', ')}` : '空仓',
    dataSource: 'portfolio-gate',
    asOf,
  });

  const guidanceMap = new Map();
  for (const g of allGuidance || []) {
    if (g?.id) guidanceMap.set(normalizeCommodityId(g.id), g);
  }

  const slotAdvice = held.map((sym, i) => {
    const inst = guidanceMap.get(sym);
    const tg = inst?.tradingGuidance;
    return {
      slot: i + 1,
      symbol: sym,
      name: inst?.name || sym.toUpperCase(),
      posture: tg?.posture || '暂无',
      phase: tg?.phase || '暂无',
      watchLevel: inst?.integratedSpec?.watchLevel || '',
      holderPriority: inst?.integratedSpec?.divergence?.holderAlert ? 'reduce-exit-alert' : 'hold-monitor',
    };
  });

  while (slotAdvice.length < MAX_POSITIONS) {
    slotAdvice.push({ slot: slotAdvice.length + 1, symbol: null, name: '空槽', posture: '', phase: '', watchLevel: '' });
  }

  let capNewScout = false;
  let capReason = null;

  if (slotsFree <= 0) {
    capNewScout = true;
    capReason = '三槽已满 · 新开试仓需先腾';
    logicChain.push({ layer: 'Gate', conclusion: 'cap-scout', evidence: capReason, dataSource: 'portfolio-gate', asOf });
  }

  if (l2Plus) {
    capNewScout = true;
    capReason = capReason ? `${capReason} · L2+ 总敞口上限` : '全球风险 L2+ · 限制总敞口·新开试仓';
    logicChain.push({ layer: 'GlobalRisk', conclusion: 'cap-exposure', evidence: `${tier} · 总敞口保守`, dataSource: 'portfolio-gate+global-risk', asOf });
  }

  if (l3Crisis && slotsUsed >= 1) {
    capNewScout = true;
    capReason = capReason ? `${capReason} · PB-LIQ-CRISIS 有效押注≤1` : 'PB-LIQ-CRISIS · 有效独立押注 ≤1';
    logicChain.push({ layer: 'LiqCrisis', conclusion: 'effective-bets-1', evidence: 'L3 · 组合簇门禁收紧', dataSource: 'portfolio-gate+PB-LIQ-CRISIS', asOf });
  }

  const candidate = options.candidateSymbol ? normalizeCommodityId(options.candidateSymbol) : null;
  if (candidate && !held.includes(candidate) && slotsFree <= 0) {
    logicChain.push({
      layer: 'Candidate',
      conclusion: 'reject-scout',
      evidence: `${candidate} 无空槽`,
      dataSource: 'portfolio-gate',
      asOf,
    });
  }

  const suggestions = [];
  if (slotsFree > 0 && !l2Plus) {
    const ranked = (allGuidance || [])
      .filter((g) => g?.integratedSpec?.priorityScore != null)
      .sort((a, b) => (b.integratedSpec.priorityScore ?? 0) - (a.integratedSpec.priorityScore ?? 0));
    for (const g of ranked) {
      const sym = normalizeCommodityId(g.id);
      if (held.includes(sym)) continue;
      const tg = g.tradingGuidance;
      if (tg?.posture === '试仓' || tg?.posture === '持有' || g.integratedSpec?.watchLevel === 'W2') {
        suggestions.push({ symbol: sym, name: g.name, priorityScore: g.integratedSpec.priorityScore, regime: g.integratedSpec?.regime?.regime });
        if (suggestions.length >= slotsFree) break;
      }
    }
  }

  let clusterGate = null;
  try {
    const { computeClusterGate } = require('./portfolio-correlation-gate');
    clusterGate = computeClusterGate(held, { candidateSymbol: options.candidateSymbol });
    if (clusterGate?.logicChain?.length) logicChain.push(...clusterGate.logicChain);
    if (clusterGate?.capNewScout) {
      capNewScout = true;
      capReason = capReason ? `${capReason} · ${clusterGate.capReason}` : clusterGate.capReason;
    }
  } catch {
    // non-fatal
  }

  let retailFactorGate = null;
  try {
    const { buildFactorExposure, getSymbolFactors, dominantFactor } = require('./retail-hf-strategy');
    const factorExposure = options.factorExposure || buildFactorExposure(held, allGuidance, {
      masterClock: options.masterClock,
    });
    retailFactorGate = { factorExposure };

    const candSym = options.candidateSymbol ? normalizeCommodityId(options.candidateSymbol) : null;
    if (candSym && !held.includes(candSym) && held.length >= 2) {
      const candFactor = dominantFactor(getSymbolFactors(candSym));
      const sameFactorCount = held.filter((h) => dominantFactor(getSymbolFactors(h)) === candFactor).length;
      const projectedHedge = factorExposure.hedgeDegree;
      if (sameFactorCount >= 2 && projectedHedge < 30 && candFactor) {
        capNewScout = true;
        const msg = `因子扎堆 · ${candFactor} 已有${sameFactorCount}槽 · 对冲度${projectedHedge}<30 · 禁第3槽同因子`;
        capReason = capReason ? `${capReason} · ${msg}` : msg;
        logicChain.push({
          layer: 'RetailFactorGate',
          conclusion: 'reject-scout',
          evidence: msg,
          dataSource: 'portfolio-gate+retail-hf-strategy',
          asOf,
        });
        retailFactorGate.blockedThirdSameFactor = true;
      }
    }

    if (factorExposure.accidentalConcentration?.length) {
      logicChain.push({
        layer: 'RetailFactor',
        conclusion: '勿扎堆',
        evidence: factorExposure.accidentalConcentration.join(' · '),
        dataSource: 'retail-hf-strategy',
        asOf,
      });
    }
  } catch {
    // non-fatal
  }

  let coreTactical = null;
  try {
    const { computeCoreTacticalState } = require('./core-tactical-slots');
    coreTactical = computeCoreTacticalState(held, allGuidance);
    if (coreTactical?.briefLine) {
      logicChain.push({
        layer: 'CoreTactical',
        conclusion: 'slot-warn',
        evidence: coreTactical.briefLine,
        dataSource: 'core-tactical-slots',
        asOf,
      });
    }
  } catch {
    // non-fatal
  }

  return {
    maxPositions: MAX_POSITIONS,
    slotsUsed,
    slotsFree,
    holdings: held,
    slotAdvice,
    capNewScout,
    capReason,
    l2PlusExposureCap: l2Plus,
    l3EffectiveBetsCap: l3Crisis ? 1 : null,
    clusterGate,
    retailFactorGate,
    coreTactical,
    suggestions,
    logicChain,
    dataSource: 'portfolio-gate',
    method: 'max-3-slots+global-L2-cap+cluster-gate+retail-factor+core-tactical',
    version: GATE_VERSION,
    asOf,
  };
}

function applyPortfolioGateToPosture(posture, symbol, gate, logicChain) {
  if (!gate?.capNewScout) return posture;
  const sym = normalizeCommodityId(symbol);
  const held = gate.holdings || [];
  if (held.includes(sym)) return posture;
  if (posture !== '试仓' && posture !== '加仓') return posture;
  if (logicChain) {
    logicChain.push({
      layer: 'PortfolioGate',
      conclusion: '观望',
      evidence: gate.capReason || '组合门禁',
      dataSource: 'portfolio-gate',
      asOf: gate.asOf || nowIso(),
    });
  }
  return '观望';
}

function applyClusterGateFromPortfolio(posture, symbol, gate, logicChain) {
  const clusterGate = gate?.clusterGate;
  if (!clusterGate?.capNewScout) return posture;
  try {
    const { applyClusterGateToPosture } = require('./portfolio-correlation-gate');
    return applyClusterGateToPosture(posture, symbol, clusterGate, logicChain);
  } catch {
    return posture;
  }
}

module.exports = {
  GATE_VERSION,
  MAX_POSITIONS,
  normalizeHoldings,
  computePortfolioGate,
  applyPortfolioGateToPosture,
  applyClusterGateFromPortfolio,
};
