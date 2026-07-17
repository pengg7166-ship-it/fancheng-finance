/**
 * 命题 + 全球风险 '宏观合成（规则化、可审计'
 * 单条 thesis 'bias 贡献上限 0.15；narrative 不能突破 globalRiskCap
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { PILOT_SYMBOLS } = require('./outlook-trading-guidance');
const thesisRegistry = require('./thesis-registry');

const SYNTHESIS_VERSION = 'v1.42.0-integrated-spec';
const MAX_THESIS_BIAS_CONTRIBUTION = 0.15;
const THEME_CHANNEL_WEIGHTS = Object.freeze({
  us_equity_bubble: { financial: 0.6, safeHaven: 0.35, physical: 0.05 },
  liquidity: { financial: 0.7, physical: 0.25, safeHaven: 0.05 },
  jpy_carry: { financial: 0.5, safeHaven: 0.4, physical: 0.1 },
  precious_narrative: { safeHaven: 0.65, financial: 0.25, physical: 0.1 },
});

const SYMBOL_CHANNELS = Object.freeze({
  ag: { safeHaven: 0.5, financial: 0.35, physical: 0.15 },
  au: { safeHaven: 0.55, financial: 0.35, physical: 0.1 },
  lc: { physical: 0.45, financial: 0.4, safeHaven: 0.15 },
  cu: { physical: 0.5, financial: 0.45, safeHaven: 0.05 },
  sc: { physical: 0.55, financial: 0.4, safeHaven: 0.05 },
  rb: { physical: 0.6, financial: 0.35, safeHaven: 0.05 },
  i: { physical: 0.65, financial: 0.3, safeHaven: 0.05 },
  hc: { physical: 0.6, financial: 0.35, safeHaven: 0.05 },
});

function nowIso() {
  return new Date().toISOString();
}

function scoreThesisDirection(thesis) {
  const text = `${thesis.claim || ''}`.toLowerCase();
  let score = 0;
  if (/bull|上涨|支撑|bid|利好|偏多|safe haven|避险/.test(text)) score += 0.5;
  if (/bear|下跌|承压|利空|偏空|tighten|收紧|crunch/.test(text)) score -= 0.5;
  if (/bubble|泡沫|overshoot|过热/.test(text)) score -= 0.15;
  if (/hard landing|衰退|recession/.test(text)) score -= 0.2;
  return Math.max(-1, Math.min(1, score));
}

function tierWeight(tier) {
  const map = { A: 1, B: 0.85, C: 0.65, D: 0.45 };
  return map[tier] ?? 0.5;
}

function buildImpactChain(thesis, symbolId) {
  const themes = thesis.linkedThemes || [];
  const channels = [];
  for (const theme of themes) {
    const w = THEME_CHANNEL_WEIGHTS[theme];
    if (!w) continue;
    channels.push({ theme, ...w });
  }
  const symCh = SYMBOL_CHANNELS[normalizeCommodityId(symbolId)] || { physical: 0.4, financial: 0.4, safeHaven: 0.2 };
  return {
    thesisId: thesis.id,
    channels,
    symbolChannel: symCh,
    dataSource: 'thesis-synthesis',
    asOf: thesis.fetchedAt || nowIso(),
  };
}

function computeThesisBiasContribution(theses, symbolId) {
  const sid = normalizeCommodityId(symbolId);
  let total = 0;
  const notes = [];
  for (const t of theses) {
    if (t.linkedSymbols?.length && !t.linkedSymbols.includes(sid)) continue;
    const dir = scoreThesisDirection(t);
    const w = tierWeight(t.sourceTier) * MAX_THESIS_BIAS_CONTRIBUTION;
    const contrib = dir * w;
    total += contrib;
    notes.push({
      thesisId: t.id,
      who: t.who,
      contribution: +contrib.toFixed(4),
      claim: (t.claim || '').slice(0, 120),
      url: t.url,
      sourceTier: t.sourceTier,
      dataSource: 'thesis-registry',
      asOf: t.fetchedAt,
    });
  }
  return {
    score: Math.max(-MAX_THESIS_BIAS_CONTRIBUTION * 3, Math.min(MAX_THESIS_BIAS_CONTRIBUTION * 3, total)),
    notes: notes.slice(0, 5),
    n: notes.length,
  };
}

function globalRiskNarrativeCap(globalRisk) {
  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier;
  const regime = globalRisk?.globalRiskRegime || globalRisk?.regime || 'normal';
  if (regime === 'shock' || tier === 'L3') return '观望';
  if (regime === 'deleveraging' || tier === 'L2') return '观望';
  if (regime === 'tightening' || tier === 'L1') return '试仓';
  return null;
}

/**
 * @param {object} ctx '{ sources, globalRisk, instruments }
 */
function buildMacroSynthesis(ctx = {}) {
  const asOf = nowIso();
  const logicChain = [];
  const globalRisk = ctx.globalRisk || {};
  thesisRegistry.ensureSeedData();

  const activeTheses = thesisRegistry.queryActiveTheses({ limit: 50 });
  const priceBySymbol = {};
  for (const inst of ctx.instruments || []) {
    if (inst?.id && inst.price != null) priceBySymbol[normalizeCommodityId(inst.id)] = Number(inst.price);
  }
  thesisRegistry.refreshOvershootStatuses(priceBySymbol);
  try {
    const warehouseBySymbol = {};
    const wh = require('./shfe-warehouse-fetcher');
    for (const inst of ctx.instruments || []) {
      const id = normalizeCommodityId(inst?.id);
      if (!id) continue;
      const snap = wh.getWarehouseReceiptAtDate?.(id, asOf.slice(0, 10));
      if (snap?.changeDod != null) warehouseBySymbol[id] = { changeDod: snap.changeDod };
    }
    thesisRegistry.refreshHypothesisFalsifyStatuses?.({ priceBySymbol, warehouseBySymbol });
  } catch {
    // optional
  }

  logicChain.push({
    layer: 'Thesis',
    conclusion: `${activeTheses.length} active`,
    evidence: `registry · narrative heat ${globalRisk.narrativeHeat ?? '—'}`,
    dataSource: 'thesis-registry',
    asOf,
  });

  const crossCommodity = {
    financialChannel: globalRisk.globalRiskRegime === 'shock' ? 'tight' : globalRisk.globalRiskRegime === 'tightening' ? 'cautious' : 'neutral',
    physicalChannel: 'demand-linked',
    safeHavenChannel: (globalRisk.narrativeHeat || 0) >= 3 ? 'elevated' : 'normal',
    dataSource: 'thesis-synthesis+global-risk-regime',
    asOf: globalRisk.asOf || asOf,
  };

  const perSymbol = {};
  for (const sym of PILOT_SYMBOLS) {
    const relevant = activeTheses
      .filter((t) => !t.linkedSymbols?.length || t.linkedSymbols.includes(sym))
      .slice(0, 10);
    const top3 = relevant
      .sort((a, b) => tierWeight(b.sourceTier) - tierWeight(a.sourceTier))
      .slice(0, 3);
    const biasContrib = computeThesisBiasContribution(relevant, sym);
    const globalRiskCap = require('./outlook-trading-guidance').resolvePostureCap(sym, globalRisk);
    perSymbol[sym] = {
      thesisBiasContribution: biasContrib.score,
      thesisBiasN: biasContrib.n,
      thesisNotes: biasContrib.notes,
      activeTheses: top3.map((t) => ({
        id: t.id,
        who: t.who,
        claim: t.claim,
        status: t.status,
        url: t.url,
        fetchedAt: t.fetchedAt,
        sourceTier: t.sourceTier,
        falsify: t.falsify,
        seed: t.seed === true,
      })),
      impactChains: top3.map((t) => buildImpactChain(t, sym)),
      globalRiskCap: globalRiskCap?.cap || null,
      globalRiskCapReason: globalRiskCap?.reason || null,
      narrativeCap: globalRiskNarrativeCap(globalRisk),
    };
  }

  const narrativeSummary = activeTheses.length
    ? activeTheses
        .slice(0, 3)
        .map((t) => `${t.who}: ${(t.claim || '').slice(0, 80)}`)
        .join(' | ')
    : '暂无活跃命题';

  return {
    version: SYNTHESIS_VERSION,
    macroSynthesis: {
      activeThesisCount: activeTheses.length,
      crossCommodity,
      perSymbol,
      narrativeSummary,
      confidence: activeTheses.length >= 3 ? { level: '', n: activeTheses.length } : { level: null, n: activeTheses.length || null },
    },
    logicChain,
    dataSource: 'thesis-synthesis',
    method: 'rule-based-weighted-thesis-composite',
    asOf,
  };
}

module.exports = {
  SYNTHESIS_VERSION,
  MAX_THESIS_BIAS_CONTRIBUTION,
  buildMacroSynthesis,
  computeThesisBiasContribution,
  scoreThesisDirection,
};
