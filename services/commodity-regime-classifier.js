/**
 * 商品动态 regime 分类 A|B|C|D — 非固定 Tier A 金属优先
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const REGIME_VERSION = 'v1.44.0-discipline';

const REGIME_B_SYMBOLS = new Set([
  'fg', 'jm', 'j', 'i', 'rb', 'hc', 'lh', 'lc', 'oi', 'sa', 'ur', 'pp', 'l', 'v', 'ma', 'eb', 'eg', 'pf', 'px', 'br', 'pr', 'sh',
]);
const REGIME_C_SYMBOLS = new Set(['ru', 'p', 'cf', 'b', 'm', 'y', 'a', 'c', 'cs', 'sr', 'ap', 'cj', 'pk']);
const REGIME_D_SYMBOLS = new Set(['zn', 'pb', 'ap']);
const REGIME_A_SYMBOLS = new Set(['ag', 'au', 'lc', 'sc', 'cu', 'al', 'ni', 'sn']);

const REGIME_LABELS = Object.freeze({
  A: '资本/叙事',
  B: '政策/产能反转',
  C: '供给/气候',
  D: '效率过滤',
});

function nowIso() {
  return new Date().toISOString();
}

function volPercentile(smoothedVol) {
  if (smoothedVol?.percentile != null && !Number.isNaN(Number(smoothedVol.percentile))) {
    return Number(smoothedVol.percentile);
  }
  return null;
}

function classifyRegime(symbol, context = {}) {
  const id = normalizeCommodityId(symbol);
  const inst = context.inst || context;
  const asOf = nowIso();
  const reasons = [];
  const att = context.capitalAttention?.score ?? inst?.capitalAttention?.score ?? null;
  const smoothedVol = context.smoothedVol ?? inst?.smoothedVol ?? inst?.factors?.technical?.smoothedVol;
  const pct = volPercentile(smoothedVol);

  if (REGIME_D_SYMBOLS.has(id)) {
    reasons.push(id === 'ap' ? 'AP 滑点/流动性约束' : 'ZN/PB 低波效率过滤');
    if (pct != null && pct < 35) reasons.push(`波动分位 ${Math.round(pct)}% 偏低`);
    return {
      regime: 'D',
      label: REGIME_LABELS.D,
      reasons,
      slippageFlag: id === 'ap',
      dataSource: 'commodity-regime-classifier',
      method: 'static-map+vol-filter',
      version: REGIME_VERSION,
      asOf,
    };
  }

  if (REGIME_B_SYMBOLS.has(id)) {
    reasons.push('政策/产能反转品种池');
    const policyHit = context.policyNews?.length || inst?.macroSynthesis?.activeTheses?.some((t) => /政策|产能|限产|收储/.test(t.claim || ''));
    if (policyHit) reasons.push('政策/命题信号命中');
    else reasons.push('政策信号待校验');
    return {
      regime: 'B',
      label: REGIME_LABELS.B,
      reasons,
      dataSource: 'commodity-regime-classifier',
      method: 'static-map+policy-thesis',
      version: REGIME_VERSION,
      asOf,
    };
  }

  if (REGIME_C_SYMBOLS.has(id)) {
    reasons.push('供给/气候敏感品种池');
    const climateHit = context.climateNews?.length || /El Niño|厄尔尼诺|天气|霜冻|干旱/.test(JSON.stringify(inst?.macroSynthesis?.activeTheses || []));
    if (climateHit) reasons.push('气候/供给叙事命中');
    else reasons.push('气候信号待校验');
    return {
      regime: 'C',
      label: REGIME_LABELS.C,
      reasons,
      dataSource: 'commodity-regime-classifier',
      method: 'static-map+climate-thesis',
      version: REGIME_VERSION,
      asOf,
    };
  }

  if (REGIME_A_SYMBOLS.has(id) || (att != null && att >= 55)) {
    reasons.push(REGIME_A_SYMBOLS.has(id) ? '贵金属/高关注品种池' : `资金关注 ${att}/100 偏高`);
    if (att != null) reasons.push(`capitalAttention=${att}`);
    else reasons.push('capitalAttention 待校验');
    return {
      regime: 'A',
      label: REGIME_LABELS.A,
      reasons,
      dataSource: 'commodity-regime-classifier',
      method: 'static-map+capital-attention',
      version: REGIME_VERSION,
      asOf,
    };
  }

  reasons.push('未命中 A/B/C/D 强映射 · 默认 B 政策/基本面通道');
  return {
    regime: 'B',
    label: REGIME_LABELS.B,
    reasons,
    dataSource: 'commodity-regime-classifier',
    method: 'default-fallback',
    version: REGIME_VERSION,
    asOf,
  };
}

module.exports = {
  REGIME_VERSION,
  REGIME_LABELS,
  REGIME_A_SYMBOLS,
  REGIME_B_SYMBOLS,
  REGIME_C_SYMBOLS,
  REGIME_D_SYMBOLS,
  classifyRegime,
};
