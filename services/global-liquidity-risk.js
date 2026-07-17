/**
 * 全球流动性风'· US equity bubble thesis observables ('0)
 * 严禁假数据：缺失 observables.status=null，value 'null/暂无'
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { PILOT_SYMBOLS } = require('./outlook-trading-guidance');

const GLOBAL_LIQUIDITY_RISK_VERSION = 'v1.37-global-risk';

/**
 * Hard triggers for regime / tier upgrade 'exported for audit & UI.
 *
 * L1 (adjustment): ' stress triggers OR narrativeHeat mentionCount72h '3
 * L2 (deleveraging): ' triggers OR (VIX'8 AND narrativeHeat') OR creditStress'
 * L3 (systemic shock): VIX'5 OR ' triggers OR (VIX'0 AND creditStress' AND US drop)
 */
const REGIME_RULES = Object.freeze({
  version: GLOBAL_LIQUIDITY_RISK_VERSION,
  tiers: {
    L0: 'normal · no posture cap',
    L1: 'tightening adjustment · narrative max 试仓, industrial max 观望',
    L2: 'deleveraging · narrative max 观望, CU/RB/I/HC max 禁止',
    L3: 'systemic shock · all pilot max 禁止',
  },
  thresholds: {
    vixElevated: 22,
    vixHigh: 28,
    vixShock: 35,
    t10y2yInversion: 0,
    dxyStrongDayPct: 0.35,
    usAvgDropPct: -0.8,
    usdjpyVolDayPct: 0.5,
    realYieldHigh: 2.5,
    narrativeHeatL1: 3,
    narrativeHeatL2: 6,
    newsShockYellow: 3,
    newsShockRed: 6,
    pilotAttLow: 35,
    pilotAttHigh: 65,
  },
  regimeMap: {
    L0: 'normal',
    L1: 'tightening',
    L2: 'deleveraging',
    L3: 'shock',
  },
});

let riskCache = { at: 0, key: null, result: null };
const RISK_CACHE_MS = 90 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function findIndicator(indicators, id) {
  return (indicators || []).find((i) => i.id === id);
}

function findUsIndices(indicesSource) {
  const usIds = new Set(['sp500', 'dji', 'ixic']);
  const out = [];
  for (const region of indicesSource?.regions || []) {
    for (const idx of region.indices || []) {
      if (usIds.has(idx.id)) out.push(idx);
    }
  }
  return out;
}

function findForexPair(forexSource, id) {
  if (forexSource?.pairs?.length) {
    const hit = forexSource.pairs.find((p) => p.id === id);
    if (hit) return hit;
  }
  for (const g of forexSource?.groups || []) {
    const hit = (g.pairs || []).find((p) => p.id === id);
    if (hit) return hit;
  }
  return null;
}

function trafficStatus(id, value, { green, yellow, red } = {}) {
  if (value == null || value === '暂无') return null;
  if (typeof green === 'function' && green(value)) return 'green';
  if (typeof yellow === 'function' && yellow(value)) return 'yellow';
  if (typeof red === 'function' && red(value)) return 'red';
  return 'green';
}

function buildObs(id, label, value, asOf, dataSource, status, extra = {}) {
  return {
    id,
    label,
    value: value == null ? null : value,
    asOf: asOf || null,
    dataSource,
    status: status ?? (value != null && value !== '暂无' ? 'green' : null),
    ...extra,
  };
}

function computeVixTermProxy(vix, vixRow) {
  if (vix == null) return { value: null, note: 'VIX 暂无' };
  const note = 'term structure proxy: spot VIX only (futures curve 暂无)';
  if (vix >= REGIME_RULES.thresholds.vixShock) return { value: `${vix.toFixed(1)} · backwardation-risk`, note };
  if (vix >= REGIME_RULES.thresholds.vixHigh) return { value: `${vix.toFixed(1)} · elevated`, note };
  return { value: vix.toFixed(1), note, asOf: vixRow?.date };
}

function aggregatePilotCapitalAttention(instruments) {
  const scores = [];
  for (const inst of instruments || []) {
    const id = normalizeCommodityId(inst?.id);
    if (!PILOT_SYMBOLS.has(id)) continue;
    const att = inst.capitalAttention?.score;
    if (att != null && !Number.isNaN(Number(att))) scores.push(Number(att));
  }
  if (!scores.length) return { avg: null, n: 0 };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { avg: +avg.toFixed(1), n: scores.length };
}

function aggregateNewsShockScore(sources) {
  let news = [];
  try {
    const { getGlobalNewsPoolSync, scoreNewsItem } = require('./commodities-news');
    news = getGlobalNewsPoolSync?.() || [];
    const macroKw = /bubble|泡沫|crash|衰退|recession|liquidity|流动性|Fed|加息|carry|套息|hard landing|美股|equity/i;
    let shock = 0;
    let hits = 0;
    const since = Date.now() - 72 * 3600 * 1000;
    for (const item of news.slice(0, 120)) {
      const text = `${item.title || ''} ${item.summary || ''}`;
      if (!macroKw.test(text)) continue;
      const pub = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
      if (pub != null && pub < since) continue;
      hits += 1;
      const rel = scoreNewsItem ? scoreNewsItem(item, ['macro', 'equity', 'fed', 'liquidity'], {}) : 0;
      if (/crash|危机|shock|恐慌|panic/i.test(text)) shock += 2;
      else if (rel > 0.5) shock += 1;
      else shock += 0.5;
    }
    return { score: hits ? +shock.toFixed(1) : null, n: hits, poolSize: news.length };
  } catch {
    return { score: null, n: 0, poolSize: 0 };
  }
}

function resolveNarrativeHeat(thesisRegistry) {
  if (!thesisRegistry?.getNarrativeHeat) {
    if (thesisRegistry?.countNarrativeMentions) {
      const nh = thesisRegistry.countNarrativeMentions(
        /bubble|泡沫|hard landing|liquidity crunch|carry unwind|equity bubble/i,
        72
      );
      const count = nh.count ?? 0;
      const bubbleTalk = count >= 6 ? 'hot' : count >= 3 ? 'warming' : 'cold';
      return { bubbleTalk, mentionCount72h: count, asOf: nowIso(), n: nh.n };
    }
    return { bubbleTalk: 'cold', mentionCount72h: null, asOf: nowIso(), n: null };
  }
  return thesisRegistry.getNarrativeHeat('macro_equity_bubble');
}

function cacheKeyForCtx(ctx) {
  const fed = ctx?.sources?.fed?.fetchedAt || '';
  const fx = ctx?.sources?.forex?.fetchedAt || '';
  const idx = ctx?.sources?.indices?.fetchedAt || '';
  return `${fed}|${fx}|${idx}`;
}

/**
 * @param {object} ctx '{ sources, instruments, thesisRegistry }
 */
function computeGlobalLiquidityRisk(ctx = {}) {
  const bypassCache = ctx.force === true;
  const key = cacheKeyForCtx(ctx);
  if (!bypassCache && riskCache.result && riskCache.key === key && Date.now() - riskCache.at < RISK_CACHE_MS) {
    return riskCache.result;
  }

  const sources = ctx.sources || ctx;
  const instruments = ctx.instruments || [];
  const thesisRegistry = ctx.thesisRegistry || null;
  const asOf = nowIso();
  const logicChain = [];
  const triggers = [];
  const observables = [];
  const T = REGIME_RULES.thresholds;

  const fedInd = sources.fed?.indicators || [];
  const vixRow = findIndicator(fedInd, 'VIXCLS');
  const vix = vixRow?.value != null ? parseFloat(vixRow.value) : null;
  const vixTerm = computeVixTermProxy(vix, vixRow);
  observables.push(
    buildObs(
      'vix_term',
      'VIX + 期限结构代理',
      vixTerm.value,
      vixRow?.date || sources.fed?.fetchedAt,
      'fed:VIXCLS',
      vix == null
        ? null
        : trafficStatus('vix', vix, {
            green: (v) => v < T.vixElevated,
            yellow: (v) => v >= T.vixElevated && v < T.vixHigh,
            red: (v) => v >= T.vixHigh,
          }),
      { note: vixTerm.note }
    )
  );
  if (vix != null && vix >= T.vixElevated) triggers.push('vix_elevated');
  if (vix != null && vix >= T.vixHigh) triggers.push('vix_high');
  if (vix != null && vix >= T.vixShock) triggers.push('vix_shock');

  const t10y2yRow = findIndicator(fedInd, 'T10Y2Y');
  const t10y2y = t10y2yRow?.value != null ? parseFloat(t10y2yRow.value) : null;
  const hyProxy = t10y2y;
  observables.push(
    buildObs(
      'hy_spread_proxy',
      'HY/信用利差代理 (10Y-2Y)',
      hyProxy,
      t10y2yRow?.date || sources.fed?.fetchedAt,
      'fed:T10Y2Y',
      hyProxy == null
        ? null
        : trafficStatus('hy', hyProxy, {
            green: (v) => v > 0.25,
            yellow: (v) => v > T.t10y2yInversion && v <= 0.25,
            red: (v) => v <= T.t10y2yInversion,
          })
    )
  );
  if (t10y2y != null && t10y2y < T.t10y2yInversion) triggers.push('yield_curve_inverted');

  const dffRow = findIndicator(fedInd, 'DFF');
  const dff = dffRow?.value != null ? parseFloat(dffRow.value) : null;
  const m2Row = findIndicator(fedInd, 'M2SL');
  const m2Change = m2Row?.change != null ? parseFloat(m2Row.change) : null;
  const fedLiqParts = [];
  if (dff != null) fedLiqParts.push(`FFR ${dff.toFixed(2)}%`);
  if (m2Change != null) fedLiqParts.push(`M2 Δ ${m2Change >= 0 ? '+' : '-'}${m2Change.toFixed(2)}%`);
  const fedLiqVal = fedLiqParts.length ? fedLiqParts.join(' · ') : null;
  observables.push(
    buildObs(
      'fed_liquidity',
      'Fed 流动性代',
      fedLiqVal,
      m2Row?.date || dffRow?.date || sources.fed?.fetchedAt,
      'fed:DFF+M2SL',
      fedLiqVal == null
        ? null
        : m2Change != null && m2Change < 0
          ? 'red'
          : dff != null && dff >= 4.5
            ? 'yellow'
            : 'green'
    )
  );
  if (m2Change != null && m2Change < 0) triggers.push('m2_contracting');
  if (dff != null && dff >= 4.5) triggers.push('tight_policy_rate');

  const dxy = findForexPair(sources.forex, 'dxy');
  const dxyPct = dxy?.changePct != null ? Number(dxy.changePct) : null;
  const dxyPrice = dxy?.price != null ? Number(dxy.price) : null;
  observables.push(
    buildObs(
      'usd_strength',
      '美元强度 (DXY)',
      dxyPrice != null ? dxyPrice : null,
      sources.forex?.fetchedAt,
      'forex:dxy',
      dxyPct == null && dxyPrice == null
        ? null
        : trafficStatus('dxy', dxyPct ?? 0, {
            green: (v) => v < 0.15,
            yellow: (v) => v >= 0.15 && v < T.dxyStrongDayPct,
            red: (v) => v >= T.dxyStrongDayPct,
          }),
      { changePct: dxyPct }
    )
  );
  if (dxyPct != null && dxyPct >= T.dxyStrongDayPct) triggers.push('dxy_strength');

  const narrativeHeat = resolveNarrativeHeat(thesisRegistry);
  const mentionCount = narrativeHeat.mentionCount72h;
  observables.push(
    buildObs(
      'narrative_density',
      '股权估值叙事密',
      mentionCount,
      narrativeHeat.asOf,
      'thesis-registry',
      mentionCount == null
        ? null
        : trafficStatus('narr', mentionCount, {
            green: (v) => v < T.narrativeHeatL1,
            yellow: (v) => v >= T.narrativeHeatL1 && v < T.narrativeHeatL2,
            red: (v) => v >= T.narrativeHeatL2,
          }),
      { bubbleTalk: narrativeHeat.bubbleTalk, n: narrativeHeat.n }
    )
  );
  if (mentionCount != null && mentionCount >= T.narrativeHeatL1) triggers.push('narrative_heat');

  const dgs10 = findIndicator(fedInd, 'DGS10');
  const dgs10Val = dgs10?.value != null ? parseFloat(dgs10.value) : null;
  const breakeven = findIndicator(fedInd, 'T10YIE');
  const beVal = breakeven?.value != null ? parseFloat(breakeven.value) : null;
  let realYield = null;
  if (dgs10Val != null && beVal != null) realYield = +(dgs10Val - beVal).toFixed(2);
  const yieldTrend =
    dgs10Val != null ? `10Y ${dgs10Val.toFixed(2)}%` + (realYield != null ? ` · 实际 ${realYield}%` : '') : null;
  observables.push(
    buildObs(
      'real_rate_10y',
      '实际利率 / 10Y 趋势',
      yieldTrend,
      dgs10?.date || sources.fed?.fetchedAt,
      'fed:DGS10+T10YIE',
      dgs10Val == null
        ? null
        : realYield != null && realYield >= T.realYieldHigh
          ? 'red'
          : dgs10Val >= 4.5
            ? 'yellow'
            : 'green'
    )
  );
  if (realYield != null && realYield >= T.realYieldHigh) triggers.push('real_yield_high');

  const usdjpy = findForexPair(sources.forex, 'usdjpy');
  const usdjpyPrice = usdjpy?.price != null ? Number(usdjpy.price) : null;
  const usdjpyPct = usdjpy?.changePct != null ? Number(usdjpy.changePct) : null;
  observables.push(
    buildObs(
      'usdjpy_carry',
      'USD/JPY 套息压力',
      usdjpyPrice,
      sources.forex?.fetchedAt,
      'forex:usdjpy',
      usdjpyPrice == null
        ? null
        : trafficStatus('uj', Math.abs(usdjpyPct ?? 0), {
            green: (v) => v < 0.3,
            yellow: (v) => v >= 0.3 && v < T.usdjpyVolDayPct,
            red: (v) => v >= T.usdjpyVolDayPct,
          }),
      { changePct: usdjpyPct, note: usdjpyPrice != null && usdjpyPrice >= 160 ? '高位套息' : null }
    )
  );
  if (usdjpyPct != null && Math.abs(usdjpyPct) >= T.usdjpyVolDayPct) triggers.push('usdjpy_volatile');

  const usIndices = findUsIndices(sources.indices);
  const avgChange =
    usIndices.length > 0
      ? usIndices.reduce((s, i) => s + (Number(i.changePct) || 0), 0) / usIndices.length
      : null;
  observables.push(
    buildObs(
      'risk_off_correlation',
      'Risk-off 相关飙升代理',
      null,
      null,
      'unavailable',
      null,
      { note: '跨资产相关序列暂缺 · VIX 阈值参考 regime' }
    )
  );
  if (vix != null && vix >= T.vixHigh) triggers.push('risk_off_vix_only');

  const pilotAtt = aggregatePilotCapitalAttention(instruments);
  observables.push(
    buildObs(
      'pilot_capital_attention',
      'Pilot 资金关注均',
      pilotAtt.avg,
      asOf,
      'outlook:capitalAttention',
      pilotAtt.avg == null
        ? null
        : trafficStatus('att', pilotAtt.avg, {
            green: (v) => v >= T.pilotAttHigh,
            yellow: (v) => v >= T.pilotAttLow && v < T.pilotAttHigh,
            red: (v) => v < T.pilotAttLow,
          }),
      { n: pilotAtt.n }
    )
  );
  if (pilotAtt.avg != null && pilotAtt.avg < T.pilotAttLow) triggers.push('pilot_att_low');

  const newsShock = aggregateNewsShockScore(sources);
  observables.push(
    buildObs(
      'news_shock_macro',
      '宏观/股权新闻冲击',
      newsShock.score,
      asOf,
      'commodities-news:global-pool',
      newsShock.score == null
        ? null
        : trafficStatus('news', newsShock.score, {
            green: (v) => v < T.newsShockYellow,
            yellow: (v) => v >= T.newsShockYellow && v < T.newsShockRed,
            red: (v) => v >= T.newsShockRed,
          }),
      { n: newsShock.n, poolSize: newsShock.poolSize }
    )
  );
  if (newsShock.score != null && newsShock.score >= T.newsShockRed) triggers.push('news_shock');

  if (avgChange != null && avgChange <= T.usAvgDropPct) triggers.push('us_equity_drop');

  const trimmedObs = observables.slice(0, 10);
  const okCount = trimmedObs.filter((o) => o.value != null).length;
  const triggeredCount = triggers.length;

  const creditStress =
    (t10y2y != null && t10y2y < 0 ? 1 : 0) +
    (vix != null && vix >= T.vixHigh ? 1 : 0) +
    (avgChange != null && avgChange < -0.5 ? 1 : 0);
  if (creditStress >= 2) triggers.push('credit_stress_composite');

  let tier = 'L0';
  let regime = 'normal';

  if (
    triggeredCount >= 4 ||
    (vix != null && vix >= T.vixShock) ||
    (vix != null && vix >= 30 && creditStress >= 2 && avgChange != null && avgChange < -0.5)
  ) {
    tier = 'L3';
    regime = 'shock';
  } else if (
    triggeredCount >= 3 ||
    creditStress >= 2 ||
    (vix != null && vix >= T.vixHigh && mentionCount != null && mentionCount >= T.narrativeHeatL2)
  ) {
    tier = 'L2';
    regime = REGIME_RULES.regimeMap.L2;
  } else if (triggeredCount >= 2 || (mentionCount != null && mentionCount >= T.narrativeHeatL1)) {
    tier = 'L1';
    regime = 'tightening';
  }

  if (okCount < 3) {
    logicChain.push({
      layer: '数据',
      conclusion: 'regime 待校',
      evidence: `'${okCount}/10 'observable 可用`,
      dataSource: 'global-liquidity-risk',
      asOf,
    });
    if (tier === 'L3' && okCount < 5) {
      tier = 'L2';
      regime = REGIME_RULES.regimeMap.L2;
    }
  }

  logicChain.push({
    layer: 'Regime',
    conclusion: `${regime} · ${tier}`,
    evidence: `${triggeredCount} triggers · observables ${okCount}/10 · bubbleTalk=${narrativeHeat.bubbleTalk}`,
    dataSource: 'global-liquidity-risk',
    asOf,
  });

  let activeTheses = [];
  try {
    const reg = thesisRegistry || require('./thesis-registry');
    activeTheses = (reg.getActiveTheses?.({ tags: ['macro_equity_bubble', 'liquidity'] }) ||
      reg.queryActiveTheses?.({ theme: 'liquidity', limit: 8 }) ||
      []).slice(0, 8);
  } catch {
    activeTheses = [];
  }

  const result = {
    version: GLOBAL_LIQUIDITY_RISK_VERSION,
    regime,
    tier,
    globalRiskRegime: regime,
    liquidityShockTier: tier === 'L0' ? null : tier,
    observables: trimmedObs,
    activeTheses,
    narrativeHeat,
    triggeredCount,
    okCount,
    observableTotal: trimmedObs.length,
    logicChain,
    dataSource: 'global-liquidity-risk',
    method: 'liquidity-observable-composite',
    asOf,
    summary:
      tier === 'L3'
        ? '全球流动性冲击 L3：posture 全面禁止上限'
        : tier === 'L2'
          ? '去杠杆 L2：工业品种禁止、叙事观望'
          : tier === 'L1'
            ? '收紧 L1：叙事试仓、工业观'
            : okCount >= 5
              ? '流动性环境正常 L0'
              : '数据部分缺失 · 保守 L0',
  };

  riskCache = { at: Date.now(), key, result };
  return result;
}

function invalidateGlobalLiquidityRiskCache() {
  riskCache = { at: 0, key: null, result: null };
}

module.exports = {
  GLOBAL_LIQUIDITY_RISK_VERSION,
  REGIME_RULES,
  RISK_CACHE_MS,
  computeGlobalLiquidityRisk,
  invalidateGlobalLiquidityRiskCache,
};
