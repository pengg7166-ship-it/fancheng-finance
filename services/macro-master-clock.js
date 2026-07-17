/**
 * 宏观主时—real_rates / dollar / china_credit / global_risk / mfg_cycle
 * 三行摘要'Daily Brief 顶部；冲突时 posture cap
 */
const { buildGsrSeries } = require('./gsr-proxy');

const CLOCK_VERSION = 'v1.44.0-discipline';

function nowIso() {
  return new Date().toISOString();
}

function findIndicator(indicators, id) {
  return (indicators || []).find((i) => i.id === id);
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

function clockState(value, { bullishAbove, bearishBelow, invert = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return { state: 'unknown', stateLabel: '待校验' };
  const v = Number(value);
  if (bullishAbove != null && v >= bullishAbove) return { state: invert ? 'headwind' : 'tailwind', stateLabel: invert ? '偏紧' : '偏松' };
  if (bearishBelow != null && v <= bearishBelow) return { state: invert ? 'tailwind' : 'headwind', stateLabel: invert ? '偏松' : '偏紧' };
  return { state: 'neutral', stateLabel: '中' };
}

function deriveOilCopperRatio(sources = {}) {
  const commodities = sources.commodities;
  let scPrice = null;
  let cuPrice = null;
  for (const ex of commodities?.exchanges || []) {
    for (const item of ex.items || []) {
      if (item.id === 'sc') scPrice = Number(item.price);
      if (item.id === 'cu') cuPrice = Number(item.price);
    }
  }
  if (scPrice == null || cuPrice == null || !cuPrice) return null;
  return +(scPrice / cuPrice).toFixed(4);
}

function deriveGsrLite() {
  try {
    const series = buildGsrSeries();
    if (!series.length) return null;
    const latest = series[series.length - 1];
    const window = series.slice(-60);
    const vals = window.map((s) => s.ratio);
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) || 1;
    const z = +((latest.ratio - mean) / std).toFixed(2);
    return { ratio: latest.ratio, zScore: z, date: latest.date, dataSource: 'gsr-proxy' };
  } catch {
    return null;
  }
}

/**
 * @param {object} context '{ sources, globalRisk, macroSynthesis }
 */
function computeMacroMasterClock(context = {}) {
  const asOf = nowIso();
  const sources = context.sources || {};
  const globalRisk = context.globalRisk || {};
  const macro = sources.macro || {};
  const indicators = macro.indicators || [];
  const forex = sources.forex || {};

  const realYield = findIndicator(indicators, 'us10y-real')?.value ?? findIndicator(indicators, 't10yie')?.value;
  const dxy = findForexPair(forex, 'dxy')?.changePct ?? findForexPair(forex, 'usdx')?.changePct;
  const cnCredit = findIndicator(indicators, 'cn-social-financing')?.value ?? findIndicator(indicators, 'cn-m2-yoy')?.value;
  const pmi = findIndicator(indicators, 'cn-pmi')?.value ?? findIndicator(indicators, 'cn-manufacturing-pmi')?.value;

  const clocks = {
    real_rates: {
      id: 'real_rates',
      label: '实际利率',
      ...clockState(realYield, { bullishAbove: 2.0, bearishBelow: 0.5, invert: true }),
      value: realYield,
      dataSource: realYield != null ? 'macro-indicators' : '待校验',
    },
    dollar: {
      id: 'dollar',
      label: '美元',
      ...clockState(dxy, { bullishAbove: 0.3, bearishBelow: -0.3, invert: true }),
      value: dxy,
      dataSource: dxy != null ? 'forex-live' : '待校验',
    },
    china_credit: {
      id: 'china_credit',
      label: '中国信用',
      ...clockState(cnCredit, { bullishAbove: 10, bearishBelow: 8 }),
      value: cnCredit,
      dataSource: cnCredit != null ? 'macro-indicators' : '待校验',
    },
    global_risk: {
      id: 'global_risk',
      label: '全球风险',
      state: globalRisk.tier === 'L0' ? 'neutral' : globalRisk.tier === 'L1' ? 'caution' : 'headwind',
      stateLabel: globalRisk.tier || 'L?',
      value: globalRisk.tier,
      dataSource: 'global-liquidity-risk',
    },
    mfg_cycle: {
      id: 'mfg_cycle',
      label: '制造周',
      ...clockState(pmi, { bullishAbove: 50, bearishBelow: 49 }),
      value: pmi,
      dataSource: pmi != null ? 'macro-indicators' : '待校验',
    },
  };

  const crossMarket = {
    gsr: deriveGsrLite(),
    oilCopper: deriveOilCopperRatio(sources),
    dataSource: 'macro-master-clock:cross-market-lite',
  };

  const states = Object.values(clocks).map((c) => c.state);
  const tailwinds = states.filter((s) => s === 'tailwind').length;
  const headwinds = states.filter((s) => s === 'headwind' || s === 'caution').length;
  const unknowns = states.filter((s) => s === 'unknown').length;

  let conflict = false;
  let postureCap = null;
  if (headwinds >= 2 && tailwinds >= 1) {
    conflict = true;
    postureCap = '试仓';
  }
  if (clocks.global_risk.state === 'headwind' || globalRisk.tier === 'L2' || globalRisk.tier === 'L3') {
    conflict = true;
    postureCap = postureCap === '试仓' ? '观望' : postureCap || '试仓';
  }

  const line1 = `时钟：实际利'{clocks.real_rates.stateLabel} · 美元${clocks.dollar.stateLabel} · 全球${clocks.global_risk.stateLabel}`;
  const line2 = `中国信用${clocks.china_credit.stateLabel} · 制造周'{clocks.mfg_cycle.stateLabel}${unknowns ? ` · ${unknowns}项待校验` : ''}`;
  const ratioHints = [];
  if (crossMarket.gsr?.zScore != null) ratioHints.push(`GSR z=${crossMarket.gsr.zScore}`);
  if (crossMarket.oilCopper != null) ratioHints.push(`油铜'${crossMarket.oilCopper}`);
  const line3 = conflict
    ? `时钟冲突 · posture 上限 ${postureCap || '试仓'}${ratioHints.length ? ` · ${ratioHints.join(' · ')}` : ''}`
    : `时钟大致一'· ${tailwinds}顺风/${headwinds}逆风${ratioHints.length ? ` · ${ratioHints.join(' · ')}` : ''}`;

  const summaryThreeLines = [line1, line2, line3];

  return {
    clocks,
    crossMarket,
    summaryThreeLines,
    conflict,
    postureCap,
    tailwinds,
    headwinds,
    unknowns,
    logicChain: [
      { layer: 'MasterClock', conclusion: line1, evidence: line2, dataSource: 'macro-master-clock', asOf },
      { layer: 'MasterClock', conclusion: line3, evidence: conflict ? 'clocks-conflict' : 'clocks-aligned', dataSource: 'macro-master-clock', asOf },
    ],
    dataSource: 'macro-master-clock',
    method: 'five-clock+ratio-lite',
    version: CLOCK_VERSION,
    asOf,
  };
}

module.exports = {
  CLOCK_VERSION,
  computeMacroMasterClock,
};
