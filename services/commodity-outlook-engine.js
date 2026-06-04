/**
 * 大宗商品走势研判 v3 — 逐品种档案 + 资金关注 + 资讯冲击 + 因子分解
 * 聚合：品种特性权重、宏观七因子、新闻池、成交量/持仓、BOLL、MA 排列
 */
const diskCache = require('./disk-cache');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getCommodityMeta, getAllCommodities } = require('./commodities-catalog');
const { getNewsKeywords, scoreNewsItem, getGlobalNewsPoolSync } = require('./commodities-news');
const {
  getInstrumentProfile,
  scoreToDirectionTier,
  directionTierClass,
} = require('./commodity-instrument-profiles');
const {
  analyzeInstrumentTechnicals,
  hasCachedDayKlines,
  readCachedKlines,
} = require('./commodity-technical-analyzer');

const OUTLOOK_DISK_KEY = 'commodity-outlook-v3.json';
const OUTLOOK_DISK_TTL_MS = 60 * 1000;

/** UI 板块分组 */
const OUTLOOK_SECTORS = [
  { id: 'energy', name: '能源', icon: '⚡' },
  { id: 'chemical', name: '化工', icon: '🧪' },
  { id: 'black', name: '黑色', icon: '⛏' },
  { id: 'metals', name: '有色新能源', icon: '🔩' },
  { id: 'precious', name: '贵金属', icon: '🥇' },
  { id: 'agriculture', name: '农产品', icon: '🌾' },
];

/** UI sector + macro bucket for each catalog id (single source: commodities-catalog) */
const OUTLOOK_SECTOR_BY_ID = {
  sc: 'energy', fu: 'energy', pg: 'energy', ZC: 'energy', lu: 'energy', bu: 'energy', ec: 'energy',
  jm: 'chemical', FG: 'chemical', TA: 'chemical', MA: 'chemical', SA: 'chemical', ru: 'chemical',
  v: 'chemical', l: 'chemical', pp: 'chemical', eg: 'chemical', eb: 'chemical', UR: 'chemical',
  PF: 'chemical', PX: 'chemical', SH: 'chemical', PR: 'chemical', br: 'chemical', ad: 'chemical',
  rb: 'black', hc: 'black', i: 'black', j: 'black', ss: 'black', wr: 'black', SF: 'black', SM: 'black',
  cu: 'metals', al: 'metals', zn: 'metals', pb: 'metals', ni: 'metals', sn: 'metals', si: 'metals',
  lc: 'metals', ps: 'metals', ao: 'metals', bc: 'metals',
  au: 'precious', ag: 'precious', pt: 'precious', pd: 'precious',
  p: 'agriculture', c: 'agriculture', m: 'agriculture', y: 'agriculture', CF: 'agriculture', SR: 'agriculture',
  OI: 'agriculture', RM: 'agriculture', a: 'agriculture', b: 'agriculture', cs: 'agriculture',
  jd: 'agriculture', lh: 'agriculture', rr: 'agriculture', lg: 'agriculture', AP: 'agriculture',
  CJ: 'agriculture', PK: 'agriculture', RS: 'agriculture', WH: 'agriculture', PM: 'agriculture',
  RI: 'agriculture', LR: 'agriculture', JR: 'agriculture', CY: 'agriculture', sp: 'agriculture',
};

const OUTLOOK_BUCKET_BY_SECTOR = {
  energy: 'energy',
  chemical: 'energy',
  black: 'metals',
  metals: 'metals',
  precious: 'precious',
  agriculture: 'agriculture',
};

const OUTLOOK_PRIORITY_BY_ID = {
  sc: 1, fu: 1, rb: 1, i: 1, cu: 1, al: 1, au: 1, ag: 1, lc: 1, p: 1, TA: 1, MA: 1, jm: 1, FG: 1,
};

/** 次日区间按板块/品种的历史波动上限（% half-width 或 total span 参考） */
const SECTOR_CLASS_MAX_PCT = {
  precious: { au: 1.2, ag: 2.5, pt: 1.5, pd: 1.5, default: 1.5 },
  energy: { sc: 3, fu: 3, pg: 3, lu: 3, bu: 3, ec: 3, ZC: 3, default: 3 },
  chemical: { default: 2.5 },
  black: { default: 3 },
  metals: { default: 3 },
  agriculture: { default: 2.5 },
};

const KLINE_BACKFILL_PRIORITY = ['cu', 'SA', 'au', 'ag', 'rb', 'sc'];

function inferOutlookSector(meta) {
  const id = meta.id;
  if (OUTLOOK_SECTOR_BY_ID[id] != null) return OUTLOOK_SECTOR_BY_ID[id];
  const lower = id.toLowerCase();
  if (OUTLOOK_SECTOR_BY_ID[lower] != null) return OUTLOOK_SECTOR_BY_ID[lower];
  if (meta.exchangeId === 'gfex') return 'metals';
  if (meta.exchangeId === 'ine') return 'energy';
  if (meta.exchangeId === 'dce') {
    if (/^(c|m|y|p|a|b|cs|jd|lh|rr|lg)$/i.test(id)) return 'agriculture';
    if (/^(j|jm|i|l|v|pp|eg|eb|pg)$/i.test(id)) return meta.exchangeId === 'dce' && /^j/i.test(id) ? 'black' : 'chemical';
    return 'agriculture';
  }
  if (meta.exchangeId === 'zce') {
    if (/^(CF|SR|OI|RM|AP|CJ|PK|RS|WH|PM|RI|LR|JR|CY)$/i.test(id)) return 'agriculture';
    if (/^(TA|MA|FG|SA|UR|PF|PX|SH|PR|SF|SM|ZC)$/i.test(id)) return 'chemical';
  }
  if (meta.exchangeId === 'shfe') {
    if (/^(au|ag)$/i.test(id)) return 'precious';
    if (/^(cu|al|zn|pb|ni|sn|ss|ao|bc|ad|br)$/i.test(id)) return 'metals';
    if (/^(rb|hc|wr)$/i.test(id)) return 'black';
    if (/^(fu|bu|ru|sp)$/i.test(id)) return /^(ru|sp)$/i.test(id) ? 'agriculture' : 'energy';
  }
  return 'agriculture';
}

function buildInstrumentRegistryFromCatalog() {
  return getAllCommodities().map((meta) => {
    const sector = inferOutlookSector(meta);
    const bucket = OUTLOOK_BUCKET_BY_SECTOR[sector] || 'agriculture';
    const priority = OUTLOOK_PRIORITY_BY_ID[meta.id] ?? OUTLOOK_PRIORITY_BY_ID[meta.id.toLowerCase()] ?? 3;
    return {
      id: meta.id,
      name: meta.name,
      sector,
      bucket,
      priority,
      exchangeId: meta.exchangeId,
    };
  });
}

const INSTRUMENT_REGISTRY = buildInstrumentRegistryFromCatalog();
const OUTLOOK_INSTRUMENTS = INSTRUMENT_REGISTRY;

const INSTRUMENT_FACTOR_WEIGHTS = {
  short: { macro: 0.28, news: 0.22, technical: 0.35, volumeOi: 0.15 },
  medium: { macro: 0.38, news: 0.22, technical: 0.28, volumeOi: 0.12 },
  long: { macro: 0.48, news: 0.18, technical: 0.22, volumeOi: 0.12 },
};

/** 四大类品种桶 — 对齐 repo 大宗 taxonomy */
const COMMODITY_BUCKETS = [
  {
    id: 'energy',
    name: '能源',
    icon: '⚡',
    commodities: ['sc', 'fu', 'bu', 'lu', 'pg', 'j', 'jm', 'ZC', 'MA', 'TA', 'eb', 'eg'],
  },
  {
    id: 'precious',
    name: '贵金属',
    icon: '🥇',
    commodities: ['au', 'ag', 'pt', 'pd'],
  },
  {
    id: 'metals',
    name: '有色金属',
    icon: '🔩',
    commodities: ['cu', 'al', 'zn', 'pb', 'ni', 'sn', 'bc', 'ss', 'ao', 'si', 'lc', 'ps', 'SF', 'SM'],
  },
  {
    id: 'agriculture',
    name: '农产品',
    icon: '🌾',
    commodities: [
      'c', 'm', 'y', 'p', 'CF', 'SR', 'WH', 'PM', 'a', 'b', 'lh', 'jd', 'AP', 'OI', 'RM',
      'PK', 'CJ', 'RS', 'RR', 'ru', 'sp',
    ],
  },
];

const BUCKET_COMMODITY_SETS = Object.fromEntries(
  COMMODITY_BUCKETS.map((b) => [b.id, new Set(b.commodities.map((id) => normalizeCommodityId(id)))])
);

/** 因子标签 */
const FACTOR_DEFS = [
  { id: 'usEquities', label: '美股', icon: '📈', shortLabel: '美股' },
  { id: 'usd', label: '美元指数', icon: '💵', shortLabel: '美元' },
  { id: 'supply', label: '供需/政策', icon: '🏭', shortLabel: '政策供应' },
  { id: 'climate', label: '气候', icon: '🌦', shortLabel: '气候' },
  { id: 'geopolitics', label: '地缘政治', icon: '🌍', shortLabel: '地缘' },
  { id: 'fed', label: '美联储', icon: '🏛', shortLabel: '美联储' },
  { id: 'boj', label: '日央行', icon: '🇯🇵', shortLabel: '日央行' },
];

/** 时间维度权重 — short 1-7d / medium 1-4w / long 1-3m+ */
const HORIZON_WEIGHTS = {
  short: { usEquities: 0.22, usd: 0.22, supply: 0.12, climate: 0.1, geopolitics: 0.1, fed: 0.14, boj: 0.1 },
  medium: { usEquities: 0.14, usd: 0.16, supply: 0.18, climate: 0.14, geopolitics: 0.14, fed: 0.14, boj: 0.1 },
  long: { usEquities: 0.08, usd: 0.12, supply: 0.16, climate: 0.12, geopolitics: 0.12, fed: 0.2, boj: 0.2 },
};

const HORIZON_LABELS = {
  short: '短期（1–7 日）',
  medium: '中期（1–4 周）',
  long: '长期（1–3 月+）',
};

/** 品种桶对因子的敏感度修正（>1 放大，<0 反向） */
const BUCKET_FACTOR_MODS = {
  energy: { usEquities: 1.0, usd: 1.1, supply: 1.2, climate: 0.8, geopolitics: 1.4, fed: 1.0, boj: 0.9 },
  precious: { usEquities: -0.6, usd: -1.3, supply: 0.7, climate: 0.5, geopolitics: 1.2, fed: 1.3, boj: 1.0 },
  metals: { usEquities: 1.2, usd: 1.0, supply: 1.15, climate: 0.9, geopolitics: 1.1, fed: 1.0, boj: 0.95 },
  agriculture: { usEquities: 0.7, usd: 0.9, supply: 1.3, climate: 1.5, geopolitics: 0.8, fed: 0.9, boj: 0.85 },
};

let liveRefreshPromise = null;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clampStars(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function starsToHtml(stars) {
  const n = clampStars(stars);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function scoreToDirection(score) {
  if (score > 0.12) return 'bullish';
  if (score < -0.12) return 'bearish';
  return 'neutral';
}

function directionArrow(dir) {
  if (dir === 'strong_bullish' || dir === 'bullish') return dir === 'strong_bullish' ? '↑↑' : '↑';
  if (dir === 'strong_bearish' || dir === 'bearish') return dir === 'strong_bearish' ? '↓↓' : '↓';
  return '→';
}

function directionLabel(dir) {
  if (dir === 'strong_bullish') return '强多';
  if (dir === 'bullish') return '偏多';
  if (dir === 'strong_bearish') return '强空';
  if (dir === 'bearish') return '偏空';
  return '震荡';
}

const NEWS_SOURCE_TIER = {
  policy: 1.15,
  geopolitics: 1.1,
  climate: 1.05,
  commodity: 1.0,
  macro: 0.95,
  default: 0.9,
};

const FACTOR_BREAKDOWN_LABELS = {
  macroUsd: '美元',
  macroFed: '美联储',
  macroChina: '中国宏观',
  macroEquities: '美股',
  macroGeo: '地缘',
  macroClimate: '气候',
  macroPolicy: '政策',
  technical: '技术面',
  capital: '资金关注',
  news: '资讯冲击',
  intraday: '盘中',
  inventory: '库存/OI',
  weather: '天气',
  profileAdjust: '品种校准',
};

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

function scoreUsEquities(indicesSource, fedSource) {
  const usIndices = findUsIndices(indicesSource);
  const avgChange =
    usIndices.length > 0
      ? usIndices.reduce((s, i) => s + (Number(i.changePct) || 0), 0) / usIndices.length
      : 0;
  const vixInd = findIndicator(fedSource?.indicators, 'VIXCLS');
  const vix = parseFloat(vixInd?.value);
  const vixSafe = Number.isNaN(vix) ? 20 : vix;

  let score = clamp(avgChange / 1.2, -0.7, 0.7);
  if (avgChange < -0.4 && vixSafe > 22) score -= 0.25;
  if (avgChange > 0.4 && vixSafe < 18) score += 0.15;

  const panic = avgChange < -0.5 && vixSafe > 24;
  const acceptance = avgChange > 0.3 && vixSafe < 22;

  let summary = '美股震荡，流动性情绪中性';
  if (panic) summary = '美股走弱且恐慌指数偏高，流动性偏紧，工业大宗承压、贵金属或获避险支撑';
  else if (acceptance) summary = '美股偏强、波动可控，风险偏好回升，工业类商品获流动性支撑';
  else if (avgChange > 0.2) summary = '美股小幅走强，市场风险偏好温和改善';
  else if (avgChange < -0.2) summary = '美股回调，市场谨慎情绪升温';

  return {
    score: clamp(score, -1, 1),
    confidence: usIndices.length >= 2 ? clampStars(2 + Math.abs(avgChange) * 2 + (vixSafe > 25 ? 1 : 0)) : 2,
    summary,
    detail: usIndices.length
      ? `美股均涨跌 ${avgChange.toFixed(2)}%，VIX ${vixSafe.toFixed(1)}`
      : '美股数据暂不可用',
    metrics: { avgChange, vix: vixSafe, panic, acceptance },
  };
}

function scoreUsd(forexSource) {
  const dxy = findForexPair(forexSource, 'dxy');
  const changePct = Number(dxy?.changePct) || 0;
  const score = clamp(-changePct / 0.45, -1, 1);

  let summary = '美元震荡，对大宗影响有限';
  if (changePct > 0.25) summary = '美元走强，以美元计价的大宗商品整体承压';
  else if (changePct < -0.25) summary = '美元走弱，大宗商品获得汇率支撑';
  else if (changePct > 0.1) summary = '美元小幅走强，大宗略偏空';
  else if (changePct < -0.1) summary = '美元小幅走弱，大宗略偏多';

  return {
    score,
    confidence: dxy ? clampStars(2.5 + Math.abs(changePct) * 3) : 2,
    summary,
    detail: dxy ? `DXY ${Number(dxy.price || 0).toFixed(2)}，日涨跌 ${changePct.toFixed(2)}%` : 'DXY 数据暂不可用',
    metrics: { changePct, price: dxy?.price },
  };
}

function itemRelevantToBucket(item, bucketId) {
  const set = BUCKET_COMMODITY_SETS[bucketId];
  if (!set) return false;
  const tags = item.commodities || [];
  if (tags.some((c) => set.has(normalizeCommodityId(c.id)))) return true;
  const text = `${item.title || ''} ${item.summary || ''} ${item.commodityImpactSummary || ''}`;
  const bucket = COMMODITY_BUCKETS.find((b) => b.id === bucketId);
  if (!bucket) return false;
  return bucket.commodities.some((id) => {
    const meta = require('./commodities-catalog').getCommodityMeta(id);
    const name = meta?.name || id;
    return text.includes(name) || text.toLowerCase().includes(String(id).toLowerCase());
  });
}

function aggregateIntelItems(items, bucketId, limit = 40) {
  let bullish = 0;
  let bearish = 0;
  let weight = 0;
  let topTitle = '';

  for (const item of (items || []).slice(0, limit)) {
    const relevant = !item.commodities?.length || itemRelevantToBucket(item, bucketId);
    if (!relevant) continue;
    const dir = item.direction || 'neutral';
    const w = (item.stars || 2) / 5;
    if (dir === 'bullish') bullish += w;
    else if (dir === 'bearish') bearish += w;
    weight += w;
    if (!topTitle && (item.stars || 0) >= 3) topTitle = item.title;
  }

  const score = weight > 0 ? clamp((bullish - bearish) / weight, -1, 1) : 0;
  return { score, bullish, bearish, weight, topTitle };
}

function scoreSupplyPolicy(policyItems, bucketId) {
  const agg = aggregateIntelItems(policyItems, bucketId, 35);
  let summary = '产业政策信号平淡';
  if (agg.weight > 0) {
    if (agg.score > 0.2) summary = '产业政策偏宽松/利好需求，支撑相关品种';
    else if (agg.score < -0.2) summary = '产业政策偏紧或压制产能，相关品种承压';
    else summary = '产业政策多空交织，需关注具体品种';
    if (agg.topTitle) summary += `（${agg.topTitle.slice(0, 28)}…）`;
  }
  return {
    score: agg.score,
    confidence: clampStars(agg.weight > 0 ? 2 + agg.weight : 2),
    summary,
    detail: agg.weight > 0 ? `政策条目加权 ${agg.weight.toFixed(1)}，多 ${agg.bullish.toFixed(1)} / 空 ${agg.bearish.toFixed(1)}` : '暂无显著政策供需信号',
    metrics: agg,
  };
}

function scoreClimate(climateItems, bucketId) {
  const agg = aggregateIntelItems(climateItems, bucketId, 30);
  let summary = '气候扰动有限';
  if (agg.weight > 0) {
    if (agg.score > 0.2) summary = '极端天气或产量扰动推升供应风险，农产品/能源或受益';
    else if (agg.score < -0.2) summary = '气候条件改善或产量恢复，相关品种供应压力缓解';
    else summary = '气候事件影响分化，关注主产区动态';
  }
  return {
    score: agg.score,
    confidence: clampStars(agg.weight > 0 ? 2.5 + agg.weight * 0.8 : 2),
    summary,
    detail: agg.weight > 0 ? `气候条目 ${Math.round(agg.weight)} 条加权评分` : '暂无显著气候传导',
    metrics: agg,
  };
}

function scoreGeopolitics(geoItems, bucketId) {
  const agg = aggregateIntelItems(geoItems, bucketId, 30);
  let summary = '地缘风险平稳';
  if (agg.weight > 0) {
    if (agg.score > 0.2) summary = '地缘冲突或制裁推升能源/金属供应风险溢价';
    else if (agg.score < -0.2) summary = '地缘紧张缓和，风险溢价回落';
    else summary = '地缘事件影响有限但需持续跟踪';
  }
  return {
    score: agg.score,
    confidence: clampStars(agg.weight > 0 ? 2.5 + agg.weight * 0.7 : 2),
    summary,
    detail: agg.weight > 0 ? `地缘条目加权 ${agg.weight.toFixed(1)}` : '暂无显著地缘传导',
    metrics: agg,
  };
}

function scoreFed(fedSource) {
  const indicators = fedSource?.indicators || [];
  const dff = parseFloat(findIndicator(indicators, 'DFF')?.value);
  const vix = parseFloat(findIndicator(indicators, 'VIXCLS')?.value);
  const spread = parseFloat(findIndicator(indicators, 'T10Y2Y')?.value);
  const m2 = findIndicator(indicators, 'M2SL');
  const m2Change = parseFloat(m2?.change);

  let score = 0;
  if (!Number.isNaN(dff)) {
    if (dff <= 1.5) score += 0.35;
    else if (dff <= 2.5) score += 0.15;
    else if (dff >= 5) score -= 0.35;
    else if (dff >= 4) score -= 0.2;
  }
  if (!Number.isNaN(spread)) {
    if (spread < -0.2) score -= 0.15;
    else if (spread > 0.8) score += 0.08;
  }
  if (!Number.isNaN(m2Change) && m2Change > 0) score += 0.12;
  if (!Number.isNaN(vix) && vix > 28) score -= 0.1;

  let summary = '美联储政策立场中性';
  if (!Number.isNaN(dff)) {
    if (dff <= 1.5) summary = '联邦基金利率处于低位，全球流动性宽松利好大宗';
    else if (dff >= 4.5) summary = '利率偏高、流动性收紧，压制大宗估值';
    else summary = `政策利率 ${dff.toFixed(2)}%，流动性影响温和`;
  }

  return {
    score: clamp(score, -1, 1),
    confidence: !Number.isNaN(dff) ? clampStars(3 + Math.abs(score) * 2) : 2,
    summary,
    detail: !Number.isNaN(dff)
      ? `联邦基金 ${dff.toFixed(2)}% · 10Y-2Y ${Number.isNaN(spread) ? '—' : spread.toFixed(2)}% · VIX ${Number.isNaN(vix) ? '—' : vix.toFixed(1)}`
      : '美联储指标暂不可用',
    metrics: { dff, vix, spread, m2Change },
  };
}

function scoreBoj(bojSource, forexSource) {
  const indicators = bojSource?.indicators || [];
  const rateRow =
    indicators.find((i) => /隔夜|拆借|政策利率|rate/i.test(i.name)) ||
    indicators.find((i) => i.id === 'IRSTCI01JPM156N');
  const rateVal = parseFloat(rateRow?.value);
  const usdjpy = findForexPair(forexSource, 'usdjpy');
  const jpyChange = Number(usdjpy?.changePct) || 0;

  let score = 0;
  if (!Number.isNaN(rateVal)) {
    if (rateVal <= 0) score += 0.45;
    else if (rateVal <= 0.5) score += 0.25;
    else if (rateVal >= 1) score -= 0.1;
  }
  if (jpyChange > 0.15) score += 0.15;
  else if (jpyChange < -0.15) score -= 0.08;

  let summary = '日央行政策对全球流动性影响有限';
  if (!Number.isNaN(rateVal) && rateVal <= 0) {
    summary = '负利率/超宽松立场延续，日元套息交易支撑全球流动性，间接利好大宗';
  } else if (!Number.isNaN(rateVal)) {
    summary = `日本政策利率 ${rateVal.toFixed(2)}%，套息与流动性传导温和`;
  }

  return {
    score: clamp(score, -1, 1),
    confidence: !Number.isNaN(rateVal) ? clampStars(3 + Math.abs(score)) : 2,
    summary,
    detail: !Number.isNaN(rateVal)
      ? `政策利率 ${rateVal.toFixed(2)}% · USD/JPY 日涨跌 ${jpyChange.toFixed(2)}%`
      : '日央行指标暂不可用',
    metrics: { rate: rateVal, jpyChange },
  };
}

function buildFactorScores(sources) {
  const policySupply = scoreSupplyPolicy(sources.policy?.items, 'energy');
  return {
    usEquities: scoreUsEquities(sources.indices, sources.fed),
    usd: scoreUsd(sources.forex),
    supply: {
      ...policySupply,
      label: '政策/供需',
    },
    climate: scoreClimate(sources.climate?.items, 'energy'),
    geopolitics: scoreGeopolitics(sources.geopolitics?.items, 'energy'),
    fed: scoreFed(sources.fed),
    boj: scoreBoj(sources.boj, sources.forex),
  };
}

function buildBucketFactorScores(sources, bucketId) {
  return {
    usEquities: scoreUsEquities(sources.indices, sources.fed),
    usd: scoreUsd(sources.forex),
    supply: scoreSupplyPolicy(sources.policy?.items, bucketId),
    climate: scoreClimate(sources.climate?.items, bucketId),
    geopolitics: scoreGeopolitics(sources.geopolitics?.items, bucketId),
    fed: scoreFed(sources.fed),
    boj: scoreBoj(sources.boj, sources.forex),
  };
}

function weightedOutlook(factorScores, bucketId, horizon) {
  const weights = HORIZON_WEIGHTS[horizon];
  const mods = BUCKET_FACTOR_MODS[bucketId] || {};
  let total = 0;
  let weightSum = 0;
  const contributions = {};

  for (const [fid, w] of Object.entries(weights)) {
    const raw = factorScores[fid]?.score ?? 0;
    const mod = mods[fid] ?? 1;
    const effective = mod < 0 ? raw * mod : raw * mod;
    total += effective * w;
    weightSum += w;
    contributions[fid] = effective;
  }

  const score = weightSum > 0 ? total / weightSum : 0;
  const direction = scoreToDirection(score);
  const absScore = Math.abs(score);

  let confidence = 2;
  for (const fid of Object.keys(weights)) {
    confidence += (factorScores[fid]?.confidence || 2) * weights[fid] * 0.15;
  }
  confidence = clampStars(confidence);

  return { score: clamp(score, -1, 1), direction, confidence, contributions };
}

function buildHorizonCommentary(bucket, horizon, outlook, factorScores) {
  const dir = directionLabel(outlook.direction);
  const hLabel = HORIZON_LABELS[horizon].replace(/（.*?）/, '');
  const topFactors = Object.entries(outlook.contributions || {})
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([fid]) => FACTOR_DEFS.find((f) => f.id === fid)?.shortLabel || fid);

  const driverText = topFactors.length ? topFactors.join('、') : '宏观因子';
  if (outlook.direction === 'bullish') {
    return `${bucket.name}${hLabel}${dir}，${driverText}形成支撑，关注库存与基差验证`;
  }
  if (outlook.direction === 'bearish') {
    return `${bucket.name}${hLabel}${dir}，${driverText}施压，注意止损与事件风险`;
  }
  return `${bucket.name}${hLabel}震荡，${driverText}多空交织，宜区间思路`;
}

function buildCategoryOutlooks(sources) {
  return COMMODITY_BUCKETS.map((bucket) => {
    const factorScores = buildBucketFactorScores(sources, bucket.id);
    const horizons = {};
    for (const h of ['short', 'medium', 'long']) {
      const outlook = weightedOutlook(factorScores, bucket.id, h);
      horizons[h] = {
        ...outlook,
        directionArrow: directionArrow(outlook.direction),
        directionLabel: directionLabel(outlook.direction),
        stars: outlook.confidence,
        starsHtml: starsToHtml(outlook.confidence),
        commentary: buildHorizonCommentary(bucket, h, outlook, factorScores),
      };
    }
    return {
      id: bucket.id,
      name: bucket.name,
      icon: bucket.icon,
      short: horizons.short,
      medium: horizons.medium,
      long: horizons.long,
    };
  });
}

function buildFactorsPanel(globalFactors) {
  return FACTOR_DEFS.map((def) => {
    const raw = globalFactors[def.id] || { score: 0, confidence: 2, summary: '数据不足' };
    const direction = scoreToDirection(raw.score);
    return {
      id: def.id,
      label: def.label,
      icon: def.icon,
      score: raw.score,
      direction,
      directionArrow: directionArrow(direction),
      directionLabel: directionLabel(direction),
      confidence: raw.confidence || 2,
      stars: raw.confidence || 2,
      starsHtml: starsToHtml(raw.confidence || 2),
      summary: raw.summary || '',
      detail: raw.detail || '',
    };
  });
}

function findLiveQuote(commodityId, commoditiesSource) {
  const id = String(commodityId || '');
  const lower = id.toLowerCase();
  const flat = commoditiesSource?.items;
  if (Array.isArray(flat)) {
    const hit = flat.find((item) => item.id === id || String(item.id).toLowerCase() === lower);
    if (hit) return hit;
  }
  for (const ex of commoditiesSource?.exchanges || []) {
    for (const item of ex.items || []) {
      if (item.id === id || String(item.id).toLowerCase() === lower) return item;
    }
  }
  return null;
}

function resolveInstrumentQuote(spec, commoditiesSource, technical) {
  const liveQuote = findLiveQuote(spec.id, commoditiesSource);
  let price = liveQuote?.price;
  let changePct = liveQuote?.changePct;
  let priceReason = null;

  if (price == null || Number.isNaN(Number(price))) {
    if (technical?.price != null && !Number.isNaN(Number(technical.price))) {
      price = technical.price;
      priceReason = '日线收盘价';
    } else if (liveQuote && liveQuote.available === false) {
      priceReason = '报价不可用';
    } else if (!commoditiesSource?.exchanges?.length && !commoditiesSource?.items?.length) {
      priceReason = '行情未加载';
    } else {
      priceReason = '暂无报价';
    }
  }

  if (changePct == null || Number.isNaN(Number(changePct))) {
    changePct = technical?.changePct ?? null;
  }

  return { liveQuote, price, changePct, priceReason };
}

function itemRelevantToInstrument(item, meta, keywords) {
  const tags = item.commodities || [];
  if (tags.some((c) => normalizeCommodityId(c.id) === normalizeCommodityId(meta.id))) return true;
  const text = `${item.title || ''} ${item.summary || ''} ${item.commodityImpactSummary || ''}`.toLowerCase();
  for (const kw of keywords) {
    const k = String(kw).toLowerCase().trim();
    if (k.length >= 2 && text.includes(k)) return true;
  }
  return false;
}

function computeCapitalAttention(technical, liveQuote, sectorVolumeRank = null) {
  const vol5 = technical.volume?.ratio ?? 1;
  const vol20 = technical.volume?.ratio20 ?? vol5;
  const oiDelta = technical.oi?.deltaPct;
  const price = Number(liveQuote?.price) || Number(technical.price) || 0;
  const volume = Number(liveQuote?.volume) || technical.volume?.todayVolume || 0;
  const turnover = price > 0 && volume > 0 ? price * volume : 0;
  const rangePct = technical.intraday?.rangePct ?? 0;

  const volScore = clamp((vol5 - 0.75) * 22 + (vol20 - 0.75) * 14, 0, 32);
  const oiScore =
    oiDelta != null ? clamp(Math.abs(oiDelta) * 3.5 + (Math.abs(oiDelta) >= 2 ? 6 : 0), 0, 26) : oiDelta === null && technical.oi?.current ? 12 : 6;
  const turnScore = turnover > 0 ? clamp(Math.log10(turnover + 1) * 2.8 - 4, 0, 22) : 4;
  const rangeScore = clamp(rangePct * 3.5, 0, 14);
  const rankScore = sectorVolumeRank != null ? clamp((1 - sectorVolumeRank) * 12, 0, 12) : 6;

  const raw = volScore + oiScore + turnScore + rangeScore + rankScore;
  const score = clamp(Math.round(raw), 0, 100);
  const contribution = clamp((score - 50) / 220, -0.28, 0.35);

  return {
    score,
    display: `${score}/100`,
    contribution: +contribution.toFixed(4),
    subMetrics: {
      volumeRatio5d: vol5 != null ? +vol5.toFixed(2) : null,
      volumeRatio20d: vol20 != null ? +vol20.toFixed(2) : null,
      oiChangePct: oiDelta != null ? +oiDelta.toFixed(2) : null,
      turnoverProxy: turnover > 0 ? Math.round(turnover) : null,
      intradayRangePct: rangePct != null ? +rangePct.toFixed(2) : null,
      sectorVolumeRank: sectorVolumeRank != null ? +sectorVolumeRank.toFixed(2) : null,
    },
  };
}

function computeInventoryScore(technical, profile) {
  const oi = technical.oi;
  if (!oi) return 0;
  let score = 0;
  if (oi.deltaPct != null) score += clamp(oi.deltaPct / 12, -0.5, 0.5);
  if (technical.volume?.ratio != null) score += clamp((technical.volume.ratio - 1) * 0.15, -0.2, 0.2);
  return clamp(score * (profile.macroSensitivity?.inventory ?? 0.5), -0.4, 0.4);
}

function computeWeatherScore(climateScore, profile) {
  const sens = profile.macroSensitivity?.weather ?? 0.5;
  return clamp(climateScore * sens, -0.5, 0.5);
}

function classifyNewsBucket(item, sources) {
  if (item._newsBucket) return item._newsBucket;
  const src = String(item.sourceName || item.source || '').toLowerCase();
  if (sources.policy?.items?.includes(item)) return 'policy';
  if (sources.geopolitics?.items?.includes(item)) return 'geo';
  if (sources.climate?.items?.includes(item)) return 'climate';
  if (/宏观|fed|央行|利率|gdp|通胀|macro|treasury/i.test(`${item.title} ${item.summary}`)) return 'macro';
  if (/期货|大宗|commodity|oil|copper|gold/i.test(src) || item.category === 'futures') return 'commodity';
  return 'commodity';
}

function scoreNewsImpactForInstrument(meta, profile, sources, newsPools = []) {
  const keywords = [...new Set([...(profile.newsAliases || []), ...getNewsKeywords(meta)])];
  const buckets = { policy: 0, geo: 0, climate: 0, commodity: 0, macro: 0 };
  const bucketWeight = { policy: 0, geo: 0, climate: 0, commodity: 0, macro: 0 };
  let bullish = 0;
  let bearish = 0;
  let weight = 0;
  let hitCount = 0;
  const hits = [];

  const intelPools = [
    ...(sources.policy?.items || []).map((i) => ({ ...i, _newsBucket: 'policy' })),
    ...(sources.geopolitics?.items || []).map((i) => ({ ...i, _newsBucket: 'geo' })),
    ...(sources.climate?.items || []).map((i) => ({ ...i, _newsBucket: 'climate' })),
    ...(newsPools || []).map((i) => ({ ...i, _newsBucket: classifyNewsBucket(i, sources) })),
  ];

  for (const item of intelPools.slice(0, 140)) {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    const tagHit = item.commodities?.some((c) => normalizeCommodityId(c.id) === normalizeCommodityId(meta.id));
    const kwHit = keywords.some((kw) => {
      const k = String(kw).toLowerCase().trim();
      return k.length >= 2 && text.includes(k);
    });
    const matchScore = scoreNewsItem(item, keywords, meta);
    const relevance = tagHit ? 1 : kwHit ? Math.min(0.35 + matchScore / 25, 1) : matchScore >= 5 ? matchScore / 20 : 0;
    if (relevance < 0.2) continue;

    hitCount += 1;
    const bucket = item._newsBucket || classifyNewsBucket(item, sources);
    const tier = NEWS_SOURCE_TIER[bucket] || NEWS_SOURCE_TIER.default;
    const w = relevance * ((item.stars || 2) / 5) * tier;
    const dir = item.direction || 'neutral';
    if (dir === 'bullish') bullish += w;
    else if (dir === 'bearish') bearish += w;
    weight += w;
    buckets[bucket] = (buckets[bucket] || 0) + (dir === 'bullish' ? w : dir === 'bearish' ? -w : 0);
    bucketWeight[bucket] = (bucketWeight[bucket] || 0) + w;

    if (hits.length < 6) {
      hits.push({
        title: (item.title || '').slice(0, 80),
        direction: dir,
        stars: item.stars || 2,
        source: item.sourceName || item.source || '情报',
        bucket,
        relevance: +relevance.toFixed(2),
        matchScore,
      });
    }
  }

  const score = weight > 0 ? clamp((bullish - bearish) / weight, -1, 1) : 0;
  const shockRaw = weight > 0 ? clamp((bullish - bearish) * 0.22, -profile.newsShockCap, profile.newsShockCap) : 0;
  const shock = +shockRaw.toFixed(2);

  let summary;
  if (hitCount === 0) summary = '资讯中性（0条命中）';
  else summary = `资讯冲击 ${shock >= 0 ? '+' : ''}${shock.toFixed(2)}（${hitCount}条命中）`;

  return {
    score,
    shock,
    shockDisplay: `${shock >= 0 ? '+' : ''}${shock.toFixed(2)}`,
    confidence: clampStars(hitCount > 0 ? 2 + Math.min(weight, 3) : 1.5),
    summary,
    weight,
    hitCount,
    hits,
    buckets,
    bucketWeight,
    bullish,
    bearish,
    topTitle: hits[0]?.title || null,
  };
}

function buildFactorBreakdown({
  profile,
  macroScores,
  technical,
  capitalAttention,
  newsImpact,
  inventoryScore,
  weatherScore,
}) {
  const w = profile.factorWeights;
  const s = profile.macroSensitivity;

  const parts = {
    macroUsd: macroScores.usd * (s.usd ?? 1) * w.macroUsd,
    macroFed: macroScores.fed * (s.fed ?? 1) * w.macroFed,
    macroChina: macroScores.china * (s.chinaPolicy ?? 1) * w.macroChina,
    macroEquities: macroScores.usEquities * (s.usEquities ?? 1) * w.macroEquities,
    macroGeo: macroScores.geo * (s.geo ?? 1) * w.macroGeo,
    macroClimate: macroScores.climate * (s.climate ?? 1) * w.macroClimate,
    macroPolicy: macroScores.policy * (s.chinaPolicy ?? 0.5) * w.macroPolicy,
    technical: (technical.techScore || 0) * w.technical,
    capital: (capitalAttention.contribution || 0) * (w.capital / 0.1),
    news: (newsImpact.shock || newsImpact.score * 0.15) * (w.news / 0.12),
    intraday: (technical.intraday?.score || 0) * w.intraday,
    inventory: inventoryScore * w.inventory,
    weather: weatherScore * w.weather,
  };

  let profileAdjust = 0;
  if (profile.supplyDemandType === 'financial' && macroScores.usd < -0.15) profileAdjust += 0.02;
  if (profile.supplyDemandType === 'geo-sensitive' && Math.abs(macroScores.geo) > 0.2) profileAdjust += macroScores.geo * 0.04;
  if (profile.supplyDemandType === 'weather-sensitive' && Math.abs(weatherScore) > 0.15) profileAdjust += weatherScore * 0.05;
  parts.profileAdjust = profileAdjust;

  const breakdown = {};
  let composite = 0;
  for (const [k, v] of Object.entries(parts)) {
    breakdown[k] = +v.toFixed(2);
    composite += v;
  }
  breakdown._sum = +composite.toFixed(4);
  return breakdown;
}

function buildRationaleFromBreakdown(meta, breakdown, capitalAttention, newsImpact, profile) {
  const entries = Object.entries(breakdown)
    .filter(([k, v]) => k !== '_sum' && k !== 'profileAdjust' && Math.abs(v) >= 0.03)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2);

  const driverParts = entries.map(([k, v]) => {
    const label = FACTOR_BREAKDOWN_LABELS[k] || k;
    return `${label}${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  });

  const cap = capitalAttention?.score != null ? `资金关注${capitalAttention.score}/100` : '';
  const news = newsImpact?.hitCount ? `资讯${newsImpact.shockDisplay}(${newsImpact.hitCount}条)` : '';

  if (driverParts.length >= 2) {
    return `${meta.name}：${driverParts[0]}、${driverParts[1]}主导；${[cap, news].filter(Boolean).join(' · ')}`;
  }
  if (driverParts.length === 1) {
    return `${meta.name}：${driverParts[0]}主导；${[cap, news].filter(Boolean).join(' · ')}`;
  }
  return `${meta.name}：${profile.supplyDemandType}品种因子均衡；${[cap, news].filter(Boolean).join(' · ') || '待更多数据'}`;
}

function buildMacroScoresForInstrument(sources, bucketId) {
  const bucketScores = buildBucketFactorScores(sources, bucketId);
  const chinaPolicy = scoreSupplyPolicy(sources.policy?.items, bucketId);
  return {
    usd: bucketScores.usd?.score ?? 0,
    fed: bucketScores.fed?.score ?? 0,
    china: chinaPolicy.score ?? 0,
    usEquities: bucketScores.usEquities?.score ?? 0,
    geo: bucketScores.geopolitics?.score ?? 0,
    climate: bucketScores.climate?.score ?? 0,
    policy: chinaPolicy.score ?? 0,
    boj: bucketScores.boj?.score ?? 0,
  };
}

function computeSectorVolumeRanks(instrumentData) {
  const bySector = {};
  for (const row of instrumentData) {
    const sector = row.sector || 'all';
    if (!bySector[sector]) bySector[sector] = [];
    const vol = Number(row.liveQuote?.volume) || row.technical?.volume?.todayVolume || 0;
    bySector[sector].push({ id: row.id, volume: vol });
  }
  const ranks = {};
  for (const list of Object.values(bySector)) {
    list.sort((a, b) => b.volume - a.volume);
    const n = list.length;
    list.forEach((item, idx) => {
      ranks[item.id] = n <= 1 ? 0 : idx / (n - 1);
    });
  }
  return ranks;
}

function getClassMaxPct(sector, instrumentId) {
  const caps = SECTOR_CLASS_MAX_PCT[sector] || SECTOR_CLASS_MAX_PCT.agriculture;
  const id = String(instrumentId || '').toLowerCase();
  return caps[id] ?? caps.default ?? 2.5;
}

function countHighStarNewsHits(newsFactor) {
  return (newsFactor?.hits || []).filter((h) => (h.stars || 0) >= 4).length;
}

function parseVix(fedSource) {
  const vixInd = findIndicator(fedSource?.indicators, 'VIXCLS');
  const vix = parseFloat(vixInd?.value);
  return Number.isNaN(vix) ? 20 : vix;
}

function computeNextDayRangePct({
  compositeScore,
  historicalVol,
  newsFactor,
  newsShock,
  newsShockCap,
  macroScore,
  techScore,
  intradayChangePct,
  sector,
  instrumentId,
  vix,
}) {
  const classMax = getClassMaxPct(sector, instrumentId);
  const idLower = String(instrumentId || '').toLowerCase();
  const sigma = historicalVol?.sigmaDaily20 ?? historicalVol?.histVol20d ?? 0.45;
  const p90 = historicalVol?.absReturnP90 ?? sigma * 1.35;
  const atrPct = historicalVol?.atrPct14 ?? sigma;

  let halfWidth;
  if (sector === 'precious') {
    halfWidth = Math.min(sigma * 1.2, p90 * 0.85, classMax);
  } else if (sector === 'energy' || sector === 'black' || sector === 'metals') {
    halfWidth = Math.min(Math.max(sigma * 1.2, atrPct * 0.55), classMax);
  } else {
    halfWidth = Math.min(sigma * 1.2, p90 * 0.85, classMax);
  }
  halfWidth = Math.max(halfWidth, 0.12);

  const highStarCount = countHighStarNewsHits(newsFactor);
  const newsAddPerStar = idLower === 'au' || idLower === 'pt' || idLower === 'pd' ? 0.3 : 0.5;
  const extremeNewsShock = (vix || 20) > 24 && highStarCount >= 1;
  let newsShockAdd = highStarCount * newsAddPerStar;

  if (newsShock != null && Math.abs(newsShock) > 0) {
    newsShockAdd = Math.min(Math.abs(newsShock) * 0.8, newsShockCap ?? 0.35);
  }

  if (extremeNewsShock && idLower === 'au') {
    halfWidth = Math.min(halfWidth + newsShockAdd, 1.0);
    newsShockAdd = 0;
  } else {
    halfWidth += newsShockAdd;
  }

  const macroTilt = (macroScore || 0) * 0.12;
  const techTilt = (techScore || 0) * 0.08;
  const newsTilt = (newsFactor?.score || 0) * 0.06;
  const intradayTilt = clamp((intradayChangePct || 0) / 100, -0.3, 0.3) * 0.15;
  let mid = macroTilt + techTilt + newsTilt + intradayTilt;
  mid = clamp(mid, -classMax * 0.55, classMax * 0.55);

  const bias = scoreToDirection(compositeScore);
  let downHalf = halfWidth;
  let upHalf = halfWidth;
  if (bias === 'bearish') {
    downHalf *= 1.1;
    upHalf *= 0.92;
  } else if (bias === 'bullish') {
    downHalf *= 0.92;
    upHalf *= 1.1;
  }

  if (newsShock != null && newsShock > 0) upHalf *= 1.04;
  else if (newsShock != null && newsShock < 0) downHalf *= 1.04;

  let low = mid - downHalf;
  let high = mid + upHalf;

  const effectiveMax = extremeNewsShock && idLower === 'au' ? 1.0 : classMax + (extremeNewsShock ? 0.35 : 0);
  let rangeCapped = false;
  const rawSpan = high - low;
  if (Math.abs(low) > effectiveMax || Math.abs(high) > effectiveMax || rawSpan > effectiveMax * 2.05) {
    rangeCapped = true;
    low = clamp(low, -effectiveMax, effectiveMax);
    high = clamp(high, -effectiveMax, effectiveMax);
    if (low > high) [low, high] = [high, low];
  }

  const expectedMovePct = (Math.abs(low - mid) + Math.abs(high - mid)) / 2;
  const histVol20d = historicalVol?.histVol20d ?? sigma;

  let biasLabel = directionLabel(bias);
  if (Math.abs(compositeScore || 0) <= 0.12) biasLabel = '震荡';

  return {
    low: +low.toFixed(3),
    mid: +mid.toFixed(3),
    high: +high.toFixed(3),
    bias,
    biasLabel,
    biasArrow: directionArrow(bias),
    expectedMovePct: +expectedMovePct.toFixed(2),
    expectedMoveDisplay: `预测波动 ±${expectedMovePct.toFixed(2)}%`,
    histVol20d: +histVol20d.toFixed(2),
    histVol20dDisplay: `历史20日均波动 ±${histVol20d.toFixed(2)}%`,
    rangeCapped,
    rangeCappedNote: rangeCapped ? '区间已按品种历史上限校准' : null,
    halfWidth: +halfWidth.toFixed(3),
    classMaxPct: classMax,
    volatilityProxy: +sigma.toFixed(3),
    formula: `±min(σ×1.2,p90×0.85,板块上限)+高星新闻；mid=宏观/技术/新闻/盘中`,
  };
}

function computeInstrumentConfidence({ hasLivePrice, hasEnough, dataPoints, newsHitCount, oiDelta, volumeRatio, compositeScore }) {
  let raw = 1;
  if (hasLivePrice) raw += 1.2;
  if (hasEnough) raw += 1.5;
  else if (dataPoints >= 5) raw += 0.7;
  if (newsHitCount > 0) raw += Math.min(newsHitCount * 0.15, 1);
  if (oiDelta != null) raw += 0.4;
  if (volumeRatio != null) raw += 0.25;
  raw += Math.abs(compositeScore || 0) * 1.2;
  return clampStars(raw);
}

function buildInstrumentHorizons(macroScore, newsFactor, technical, bucketId, compositeScore) {
  const horizons = {};
  for (const h of ['short', 'medium', 'long']) {
    const w = INSTRUMENT_FACTOR_WEIGHTS[h];
    const volOiScore = ((technical.volume?.score || 0) + (technical.oi?.score || 0)) / 2;
    const intradayScore = technical.intraday?.score || 0;
    const composite =
      macroScore * w.macro +
      newsFactor.score * w.news +
      technical.techScore * w.technical +
      volOiScore * w.volumeOi +
      intradayScore * 0.08;

    const score = clamp(composite, -1, 1);
    const direction = scoreToDirection(score);
    const confidence = computeInstrumentConfidence({
      hasLivePrice: technical.hasLivePrice,
      hasEnough: technical.hasEnough,
      dataPoints: technical.dataPoints,
      newsHitCount: newsFactor.hitCount || 0,
      oiDelta: technical.oi?.deltaPct,
      volumeRatio: technical.volume?.ratio,
      compositeScore: score,
    });
    horizons[h] = {
      score: +score.toFixed(4),
      direction,
      directionArrow: directionArrow(direction),
      directionLabel: directionLabel(direction),
      confidence,
      stars: confidence,
      starsHtml: starsToHtml(confidence),
    };
  }
  return horizons;
}

function buildInstrumentRationale(meta, breakdown, capitalAttention, newsImpact, profile) {
  return buildRationaleFromBreakdown(meta, breakdown, capitalAttention, newsImpact, profile);
}

function buildTechBadges(technical, outlookPending = false) {
  const badges = [];
  if (outlookPending) {
    badges.push({ id: 'pending-outlook', label: '待加载报价', trend: 'flat' });
    return badges;
  }
  if (!technical.hasEnough && technical.hasLivePrice) {
    badges.push({ id: 'partial-data', label: '日线不足·用盘中+资讯', trend: 'flat' });
  }
  if (technical.maStack?.alignmentLabel) {
    const maLabel =
      technical.maStack.maSpreadPct != null && Math.abs(technical.maStack.maSpreadPct) >= 0.05
        ? `${technical.maStack.alignmentLabel} ${technical.maStack.maSpreadPct > 0 ? '+' : ''}${technical.maStack.maSpreadPct}%`
        : technical.maStack.alignmentLabel;
    badges.push({
      id: 'ma',
      label: maLabel,
      trend: technical.maStack.alignment.includes('bull') ? 'up' : technical.maStack.alignment.includes('bear') ? 'down' : 'flat',
    });
    if (technical.maStack.crossLabel) {
      badges.push({ id: 'cross', label: technical.maStack.crossLabel, trend: technical.maStack.crossSignal === 'golden' ? 'up' : 'down' });
    }
  }
  if (technical.boll) {
    const bollLabel = technical.boll.position === 'upper' ? 'BOLL上轨' : technical.boll.position === 'lower' ? 'BOLL下轨' : 'BOLL中轨';
    badges.push({
      id: 'boll',
      label: bollLabel,
      trend: technical.boll.position === 'upper' ? 'up' : technical.boll.position === 'lower' ? 'down' : 'flat',
    });
  } else if (technical.intraday?.rangePct != null && technical.hasLivePrice) {
    badges.push({ id: 'intraday-range', label: `振幅${technical.intraday.rangePct.toFixed(2)}%`, trend: 'flat' });
  }
  if (technical.volume?.ratio != null) {
    badges.push({
      id: 'vol',
      label: `量比${technical.volume.ratio}`,
      trend: technical.volume.ratio >= 1.1 ? 'up' : technical.volume.ratio <= 0.9 ? 'down' : 'flat',
    });
  }
  if (technical.oi?.deltaPct != null) {
    badges.push({
      id: 'oi',
      label: `持仓${technical.oi.deltaPct > 0 ? '+' : ''}${technical.oi.deltaPct}%`,
      trend: technical.oi.deltaPct > 0 ? 'up' : technical.oi.deltaPct < 0 ? 'down' : 'flat',
    });
  } else if (technical.oi?.display) {
    badges.push({ id: 'oi-flat', label: technical.oi.display, trend: 'flat' });
  } else if (technical.oi?.label) {
    badges.push({ id: 'oi-flat', label: technical.oi.label, trend: 'flat' });
  }
  if (technical.intraday?.changePct != null && technical.hasLivePrice && !technical.maStack) {
    badges.push({
      id: 'intraday-chg',
      label: `盘中${technical.intraday.changePct > 0 ? '+' : ''}${technical.intraday.changePct.toFixed(2)}%`,
      trend: technical.intraday.changePct > 0.05 ? 'up' : technical.intraday.changePct < -0.05 ? 'down' : 'flat',
    });
  }
  return badges;
}

function macroScoreForBucket(bucketId, sources) {
  const factorScores = buildBucketFactorScores(sources, bucketId);
  const outlook = weightedOutlook(factorScores, bucketId, 'short');
  return outlook.score;
}

let klineBackfillPromise = null;

function triggerOutlookKlineBackfill(limit = 40) {
  if (klineBackfillPromise) return klineBackfillPromise;
  klineBackfillPromise = Promise.resolve().then(async () => {
    const { fetchCommodityHistory } = require('./commodities-history-fetcher');
    const prioritySet = new Set(KLINE_BACKFILL_PRIORITY);
    const priority = INSTRUMENT_REGISTRY.filter(
      (spec) => prioritySet.has(String(spec.id).toLowerCase()) && !hasCachedDayKlines(spec.id, 20)
    );
    const missing = INSTRUMENT_REGISTRY.filter(
      (spec) => !prioritySet.has(String(spec.id).toLowerCase()) && !hasCachedDayKlines(spec.id, 20)
    ).slice(0, limit);
    const queue = [...priority, ...missing];
    for (let i = 0; i < queue.length; i += 1) {
      try {
        await fetchCommodityHistory(queue[i].id, 'day');
      } catch {
        // ignore per-instrument failures
      }
      if (i < queue.length - 1) await new Promise((r) => setTimeout(r, 180));
    }
  }).finally(() => {
    klineBackfillPromise = null;
  });
  return klineBackfillPromise;
}

function collectOutlookNewsPools() {
  try {
    const newsMod = require('./commodities-news');
    newsMod.initNewsCacheFromDisk?.();
    const global = newsMod.getGlobalNewsPoolSync();
    const pools = Array.isArray(global) ? [...global] : [...(global?.items || [])];
    return pools;
  } catch {
    return [];
  }
}

function buildInstrumentOutlooks(sources) {
  const newsPools = collectOutlookNewsPools();

  const prepRows = INSTRUMENT_REGISTRY.map((spec) => {
    const meta = getCommodityMeta(spec.id);
    if (!meta) return null;
    const quote = resolveInstrumentQuote(spec, sources.commodities, null);
    const technical = analyzeInstrumentTechnicals(spec.id, quote.liveQuote);
    const mergedQuote = resolveInstrumentQuote(spec, sources.commodities, technical);
    return { spec, meta, liveQuote: mergedQuote.liveQuote, technical, mergedQuote };
  }).filter(Boolean);

  const sectorRanks = computeSectorVolumeRanks(
    prepRows.map((r) => ({ id: r.spec.id, sector: r.spec.sector, liveQuote: r.liveQuote, technical: r.technical }))
  );

  return prepRows
    .map(({ spec, meta, liveQuote, technical, mergedQuote }) => {
      const profile = getInstrumentProfile(spec.id);
      const newsImpact = scoreNewsImpactForInstrument(meta, profile, sources, newsPools);
      const macroScores = buildMacroScoresForInstrument(sources, spec.bucket);
      const capitalAttention = computeCapitalAttention(technical, liveQuote, sectorRanks[spec.id]);
      const inventoryScore = computeInventoryScore(technical, profile);
      const weatherScore = computeWeatherScore(macroScores.climate, profile);

      const factorBreakdown = buildFactorBreakdown({
        profile,
        macroScores,
        technical,
        capitalAttention,
        newsImpact,
        inventoryScore,
        weatherScore,
      });

      const compositeScore = clamp(factorBreakdown._sum ?? 0, -1, 1);
      delete factorBreakdown._sum;

      const dirTier = scoreToDirectionTier(compositeScore, profile.volatilityTier);
      const direction = directionTierClass(dirTier.direction);

      const hasLivePrice = mergedQuote.price != null && !Number.isNaN(Number(mergedQuote.price));
      const outlookPending = !hasLivePrice;

      const horizons = buildInstrumentHorizons(
        macroScores.china * 0.5 + macroScores.usd * 0.3,
        { score: newsImpact.score, hitCount: newsImpact.hitCount },
        technical,
        spec.bucket,
        compositeScore
      );

      const vix = parseVix(sources.fed);
      const newsFactor = { score: newsImpact.score, hits: newsImpact.hits, hitCount: newsImpact.hitCount };
      const nextDayRangePct = outlookPending
        ? null
        : computeNextDayRangePct({
            compositeScore,
            historicalVol:
              technical.historicalVol ||
              (technical.volatilityProxy
                ? {
                    sigmaDaily20: technical.volatilityProxy,
                    histVol20d: technical.volatilityProxy,
                    atrPct14: technical.intraday?.atrProxyPct ?? technical.volatilityProxy * 1.2,
                    absReturnP90: technical.volatilityProxy * 1.35,
                  }
                : null),
            newsFactor,
            newsShock: newsImpact.shock,
            newsShockCap: profile.newsShockCap,
            macroScore: macroScores.china * 0.4 + macroScores.usd * 0.3,
            techScore: technical.techScore,
            intradayChangePct: technical.intraday?.changePct ?? mergedQuote.changePct,
            sector: spec.sector,
            instrumentId: spec.id,
            vix,
          });

      const confidence = computeInstrumentConfidence({
        hasLivePrice,
        hasEnough: technical.hasEnough,
        dataPoints: technical.dataPoints,
        newsHitCount: newsImpact.hitCount || 0,
        oiDelta: technical.oi?.deltaPct,
        volumeRatio: technical.volume?.ratio,
        compositeScore,
      });

      const bucketFactorScores = buildBucketFactorScores(sources, spec.bucket);
      const macroFactors = FACTOR_DEFS.map((def) => ({
        id: def.id,
        label: def.shortLabel,
        score: bucketFactorScores[def.id]?.score ?? 0,
        direction: scoreToDirection(bucketFactorScores[def.id]?.score ?? 0),
      }));

      const factorBreakdownDisplay = Object.entries(factorBreakdown)
        .filter(([, v]) => Math.abs(v) >= 0.005)
        .map(([id, value]) => ({
          id,
          label: FACTOR_BREAKDOWN_LABELS[id] || id,
          value: +value.toFixed(2),
          display: `${value >= 0 ? '+' : ''}${value.toFixed(2)}`,
        }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

      const factors = {
        macro: { score: +macroScores.china.toFixed(4), bucket: spec.bucket, factors: macroFactors },
        news: {
          score: +newsImpact.score.toFixed(4),
          shock: newsImpact.shock,
          shockDisplay: newsImpact.shockDisplay,
          confidence: newsImpact.confidence,
          summary: newsImpact.summary,
          weight: +newsImpact.weight.toFixed(2),
          hitCount: newsImpact.hitCount || 0,
          hits: newsImpact.hits,
          buckets: newsImpact.buckets,
        },
        technical: {
          score: +technical.techScore.toFixed(4),
          maStack: technical.maStack,
          boll: technical.boll,
          dataPoints: technical.dataPoints,
          hasEnough: technical.hasEnough,
        },
        volume: technical.volume,
        oi: technical.oi,
        capitalAttention,
        factorBreakdown,
        factorBreakdownDisplay,
        profile: {
          volatilityTier: profile.volatilityTier,
          supplyDemandType: profile.supplyDemandType,
          tradingSession: profile.tradingSession,
        },
      };

      const rationale = outlookPending
        ? `${meta.name}：现价待加载；${mergedQuote.priceReason || '行情未接入'}`
        : buildInstrumentRationale(meta, factorBreakdown, capitalAttention, newsImpact, profile);

      return {
        id: meta.id,
        name: meta.name,
        aliases: profile.newsAliases?.slice(0, 4) || meta.keywords?.slice(0, 4) || [],
        exchange: meta.exchange,
        unit: meta.unit,
        bucket: spec.bucket,
        sector: spec.sector,
        priority: spec.priority,
        price: mergedQuote.price,
        changePct: mergedQuote.changePct,
        priceReason: mergedQuote.priceReason,
        outlookPending,
        compositeScore: +compositeScore.toFixed(2),
        compositeScoreDisplay: `${compositeScore >= 0 ? '+' : ''}${compositeScore.toFixed(2)}`,
        direction,
        directionTier: dirTier.direction,
        directionArrow: dirTier.arrow,
        directionLabel: dirTier.label,
        confidence,
        stars: confidence,
        starsHtml: starsToHtml(confidence),
        capitalAttention,
        capitalAttentionDisplay: capitalAttention.display,
        nextDayRangePct,
        short: horizons.short,
        medium: horizons.medium,
        long: horizons.long,
        techBadges: buildTechBadges(technical, outlookPending),
        factors,
        factorBreakdown,
        factorBreakdownDisplay,
        rationale,
        sourceNote: technical.sourceNote,
        profileSummary: `${profile.volatilityTier}波动 · ${profile.supplyDemandType} · ${profile.tradingSession}`,
      };
    })
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'zh-CN'));
}

function buildCommodityOutlookFromSources(sources = {}) {
  let globalFactors;
  let categories;
  let factors;
  let instruments;
  try {
    globalFactors = buildFactorScores(sources);
    categories = buildCategoryOutlooks(sources);
    factors = buildFactorsPanel(globalFactors);
    instruments = buildInstrumentOutlooks(sources);
  } catch (err) {
    globalFactors = {};
    categories = buildCategoryOutlooks({});
    factors = buildFactorsPanel(globalFactors);
    instruments = [];
    return {
      key: 'outlook',
      name: '大宗商品走势研判',
      dataLabel: '大宗商品走势研判 · 逐品种档案 · 资金关注 · 因子分解',
      categories,
      instruments,
      factors,
      framework: { logicModel: '多因子+品种档案（部分输入异常，已降级）', version: 'v1.18.0' },
      sectors: OUTLOOK_SECTORS,
      stats: {
        categoryCount: categories.length,
        instrumentCount: 0,
        factorCount: factors.length,
        dataQuality: 0,
        dataQualityLabel: '计算降级',
      },
      updatedAt: new Date().toISOString(),
      error: err?.message || '研判计算异常',
    };
  }

  const dataQuality = [
    sources.indices?.regions?.some((r) => r.indices?.length),
    sources.forex?.pairs?.length || sources.forex?.groups?.length,
    sources.policy?.items?.length,
    sources.climate?.items?.length,
    sources.geopolitics?.items?.length,
    sources.fed?.indicators?.length,
    sources.boj?.indicators?.length,
    sources.commodities?.exchanges?.some((e) => e.items?.length),
  ].filter(Boolean).length;

  const techReady = instruments.filter((i) => i.factors?.technical?.hasEnough).length;

  return {
    key: 'outlook',
    name: '大宗商品走势研判',
    dataLabel: '大宗商品走势研判 · 逐品种档案 · 资金关注 · 因子分解',
    categories,
    instruments,
    factors,
    framework: {
      logicModel:
        '品种档案权重 → 宏观/资金/资讯/技术/库存因子分解 → 综合分 → 历史校准次日区间',
      horizons: HORIZON_LABELS,
      factorIds: FACTOR_DEFS.map((f) => f.id),
      instrumentIds: INSTRUMENT_REGISTRY.map((i) => i.id),
      sectors: OUTLOOK_SECTORS,
      rangeFormula: '±min(σ×1.2,p90×0.85,板块上限)+资讯冲击；mid=因子分解合成',
      sectorClassCaps: SECTOR_CLASS_MAX_PCT,
      version: 'v1.18.0',
    },
    sectors: OUTLOOK_SECTORS,
    stats: {
      categoryCount: categories.length,
      instrumentCount: instruments.length,
      techReadyCount: techReady,
      factorCount: factors.length,
      dataQuality,
      dataQualityLabel: `${dataQuality}/8 路数据源 · ${techReady}/${instruments.length} 品种技术面就绪`,
    },
    updatedAt: new Date().toISOString(),
    liveRefreshedAt: new Date().toISOString(),
  };
}

function enrichSourcesForOutlook(sources = {}) {
  const next = { ...sources };
  try {
    const { getCachedCommoditiesLive } = require('./commodities-fetcher');
    const commodities = getCachedCommoditiesLive();
    if (commodities?.exchanges?.length) {
      next.commodities = commodities;
    }
  } catch {
    // ignore
  }
  if (!next.commodities?.exchanges?.length && sources.commodities?.exchanges?.length) {
    next.commodities = sources.commodities;
  }
  return next;
}

function fetchCommodityOutlookSource(sources) {
  const enriched = enrichSourcesForOutlook(sources);
  triggerOutlookKlineBackfill().catch(() => {});
  const payload = buildCommodityOutlookFromSources(enriched);
  diskCache.write(OUTLOOK_DISK_KEY, { data: payload, savedAt: Date.now() });
  return payload;
}

function getCachedCommodityOutlookSource() {
  const stored = diskCache.readStale(OUTLOOK_DISK_KEY);
  if (stored?.data?.instruments?.length || stored?.data?.categories?.length) return stored.data;
  return null;
}

function fetchCommodityOutlookLive({ force = false, sources } = {}) {
  const { getCachedAllData } = require('./data-fetcher');
  const allSources = enrichSourcesForOutlook(sources || getCachedAllData()?.sources || {});
  const hasCommodities = allSources.commodities?.exchanges?.some((e) => e.items?.some((i) => i.price != null));
  const expectedCount = INSTRUMENT_REGISTRY.length;

  if (!force) {
    const cached = getCachedCommodityOutlookSource();
    const stale = diskCache.readStale(OUTLOOK_DISK_KEY);
    const cachedCount = cached?.instruments?.length || 0;
    const registryStale = cachedCount > 0 && cachedCount < expectedCount - 2;

    if (cached?.instruments?.length || cached?.categories?.length) {
      if (registryStale || (hasCommodities && cachedCount === 0)) {
        return fetchCommodityOutlookSource(allSources);
      }
      if (Date.now() - (stale?.savedAt || 0) > OUTLOOK_DISK_TTL_MS) {
        refreshCommodityOutlookInBackground(allSources);
      }
      return { ...cached, fromCache: true };
    }
    if (hasCommodities) {
      return fetchCommodityOutlookSource(allSources);
    }
  }

  return fetchCommodityOutlookSource(allSources);
}

function refreshCommodityOutlookInBackground(sources) {
  if (liveRefreshPromise) return liveRefreshPromise;
  liveRefreshPromise = Promise.resolve()
    .then(() => {
      const { getCachedAllData } = require('./data-fetcher');
      const allSources = sources || getCachedAllData()?.sources || {};
      return fetchCommodityOutlookSource(allSources);
    })
    .catch(() => null)
    .finally(() => {
      liveRefreshPromise = null;
    });
  return liveRefreshPromise;
}

module.exports = {
  COMMODITY_BUCKETS,
  INSTRUMENT_REGISTRY,
  OUTLOOK_INSTRUMENTS,
  OUTLOOK_SECTORS,
  FACTOR_DEFS,
  FACTOR_BREAKDOWN_LABELS,
  HORIZON_WEIGHTS,
  buildInstrumentRegistryFromCatalog,
  buildCommodityOutlookFromSources,
  fetchCommodityOutlookSource,
  getCachedCommodityOutlookSource,
  fetchCommodityOutlookLive,
  refreshCommodityOutlookInBackground,
  triggerOutlookKlineBackfill,
  computeNextDayRangePct,
  computeCapitalAttention,
  buildFactorBreakdown,
  getClassMaxPct,
  SECTOR_CLASS_MAX_PCT,
  directionArrow,
  directionLabel,
  starsToHtml,
};
