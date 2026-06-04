/**
 * 大宗商品走势研判 v2 — 多因子 + 逐品种技术面 + 次日波动区间
 * 聚合：宏观七因子、新闻池、成交量/持仓、BOLL、MA 排列
 */
const diskCache = require('./disk-cache');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getCommodityMeta, getAllCommodities } = require('./commodities-catalog');
const { getNewsKeywords, scoreNewsItem, getFastNewsPool, getGlobalNewsPoolSync } = require('./commodities-news');
const { analyzeInstrumentTechnicals } = require('./commodity-technical-analyzer');

const OUTLOOK_DISK_KEY = 'commodity-outlook-v2.json';
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
  if (dir === 'bullish') return '↑';
  if (dir === 'bearish') return '↓';
  return '→';
}

function directionLabel(dir) {
  if (dir === 'bullish') return '偏多';
  if (dir === 'bearish') return '偏空';
  return '震荡';
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

function scoreNewsForInstrument(meta, sources, newsPools = []) {
  const keywords = getNewsKeywords(meta);
  let bullish = 0;
  let bearish = 0;
  let weight = 0;
  const hits = [];

  const intelPools = [
    ...(sources.policy?.items || []),
    ...(sources.climate?.items || []),
    ...(sources.geopolitics?.items || []),
    ...newsPools,
  ];

  for (const item of intelPools.slice(0, 120)) {
    const relevance = item.commodities?.length
      ? item.commodities.some((c) => normalizeCommodityId(c.id) === normalizeCommodityId(meta.id))
      : scoreNewsItem(item, keywords, meta) >= 4 || itemRelevantToInstrument(item, meta, keywords);

    if (!relevance) continue;

    const matchScore = scoreNewsItem(item, keywords, meta);
    const w = ((item.stars || 2) / 5) * (1 + Math.min(matchScore, 20) / 20);
    const dir = item.direction || 'neutral';
    if (dir === 'bullish') bullish += w;
    else if (dir === 'bearish') bearish += w;
    weight += w;

    if (hits.length < 5 && (item.stars || 0) >= 2) {
      hits.push({
        title: (item.title || '').slice(0, 80),
        direction: dir,
        stars: item.stars || 2,
        source: item.sourceName || item.source || '情报',
        matchScore,
      });
    }
  }

  const score = weight > 0 ? clamp((bullish - bearish) / weight, -1, 1) : 0;
  let summary = '新闻面中性';
  if (weight > 0) {
    if (score > 0.2) summary = `新闻偏多（${hits.length ? hits[0].title.slice(0, 24) : '相关报道'}…）`;
    else if (score < -0.2) summary = `新闻偏空（${hits.length ? hits[0].title.slice(0, 24) : '相关报道'}…）`;
    else summary = '新闻多空交织，关注 headline 验证';
  }

  return {
    score,
    confidence: clampStars(weight > 0 ? 2 + Math.min(weight, 4) : 2),
    summary,
    weight,
    hits,
    bullish,
    bearish,
  };
}

function computeNextDayRangePct({ compositeScore, boll, newsScore, macroScore, techScore }) {
  const baseVol = boll?.bandwidth ? boll.bandwidth / 2 : 0.8;
  const newsShock = Math.abs(newsScore || 0) * 0.45;
  const macroTilt = (macroScore || 0) * 0.35;
  const techTilt = (techScore || 0) * 0.25;
  const mid = macroTilt + techTilt + (newsScore || 0) * 0.2;

  let low = mid - baseVol - newsShock;
  let high = mid + baseVol + newsShock;
  low = clamp(low, -6, 6);
  high = clamp(high, -6, 6);
  if (low > high) [low, high] = [high, low];

  const bias = scoreToDirection(compositeScore);
  return {
    low: +low.toFixed(2),
    mid: +mid.toFixed(2),
    high: +high.toFixed(2),
    bias,
    biasLabel: directionLabel(bias),
    biasArrow: directionArrow(bias),
    formula: `mid=宏观×0.35+技术×0.25+新闻×0.2；区间±(BOLL带宽/2+新闻冲击)`,
  };
}

function buildInstrumentHorizons(macroScore, newsFactor, technical, bucketId) {
  const horizons = {};
  for (const h of ['short', 'medium', 'long']) {
    const w = INSTRUMENT_FACTOR_WEIGHTS[h];
    const volOiScore = ((technical.volume?.score || 0) + (technical.oi?.score || 0)) / 2;
    const composite =
      macroScore * w.macro +
      newsFactor.score * w.news +
      technical.techScore * w.technical +
      volOiScore * w.volumeOi;

    const score = clamp(composite, -1, 1);
    const direction = scoreToDirection(score);
    horizons[h] = {
      score: +score.toFixed(4),
      direction,
      directionArrow: directionArrow(direction),
      directionLabel: directionLabel(direction),
      confidence: clampStars(
        2 +
          Math.abs(score) * 2 +
          (technical.hasEnough ? 0.8 : 0) +
          (newsFactor.weight > 0 ? 0.5 : 0)
      ),
      stars: 0,
      starsHtml: '',
    };
    horizons[h].stars = horizons[h].confidence;
    horizons[h].starsHtml = starsToHtml(horizons[h].confidence);
  }
  return horizons;
}

function buildInstrumentRationale(meta, horizons, nextDay, factors, technical) {
  const short = horizons.short;
  const parts = [];
  parts.push(`${meta.name}次日研判${nextDay.biasLabel}${nextDay.biasArrow}，预估波动 ${nextDay.low}% ~ ${nextDay.high}%`);
  if (technical.maStack?.alignmentLabel) parts.push(`均线${technical.maStack.alignmentLabel}`);
  if (technical.boll?.positionLabel) parts.push(`BOLL${technical.boll.positionLabel}（带宽 ${technical.boll.bandwidth}%）`);
  if (technical.volume?.label) parts.push(`${technical.volume.label}（量比 ${technical.volume.ratio}）`);
  if (technical.oi?.label && technical.oi.deltaPct != null) {
    parts.push(`${technical.oi.label} ${technical.oi.deltaPct > 0 ? '+' : ''}${technical.oi.deltaPct}%`);
  }
  if (factors.news.summary) parts.push(factors.news.summary);
  parts.push(`短期${short.directionLabel}，置信 ${short.stars} 星`);
  return parts.join('；');
}

function buildTechBadges(technical, outlookPending = false) {
  const badges = [];
  if (outlookPending) {
    badges.push({ id: 'pending-outlook', label: '研判积累中', trend: 'flat' });
  }
  if (!technical.hasEnough) {
    badges.push({ id: 'pending', label: '指标待日线积累', trend: 'flat' });
  }
  if (technical.maStack) {
    badges.push({
      id: 'ma',
      label: technical.maStack.alignmentLabel,
      trend: technical.maStack.alignment.includes('bull') ? 'up' : technical.maStack.alignment.includes('bear') ? 'down' : 'flat',
    });
    if (technical.maStack.crossLabel) {
      badges.push({ id: 'cross', label: technical.maStack.crossLabel, trend: technical.maStack.crossSignal === 'golden' ? 'up' : 'down' });
    }
  }
  if (technical.boll) {
    badges.push({ id: 'boll', label: `BOLL${technical.boll.positionLabel}`, trend: technical.boll.position === 'upper' ? 'up' : technical.boll.position === 'lower' ? 'down' : 'flat' });
  }
  if (technical.volume) {
    badges.push({ id: 'vol', label: `量比${technical.volume.ratio}`, trend: technical.volume.ratio >= 1.1 ? 'up' : technical.volume.ratio <= 0.9 ? 'down' : 'flat' });
  }
  if (technical.oi?.deltaPct != null) {
    badges.push({
      id: 'oi',
      label: `持仓${technical.oi.deltaPct > 0 ? '+' : ''}${technical.oi.deltaPct}%`,
      trend: technical.oi.deltaPct > 0 ? 'up' : technical.oi.deltaPct < 0 ? 'down' : 'flat',
    });
  }
  return badges;
}

function macroScoreForBucket(bucketId, sources) {
  const factorScores = buildBucketFactorScores(sources, bucketId);
  const outlook = weightedOutlook(factorScores, bucketId, 'short');
  return outlook.score;
}

function buildInstrumentOutlooks(sources) {
  let newsPools = [];
  try {
    newsPools = [...(getFastNewsPool()?.items || []), ...(getGlobalNewsPoolSync()?.items || [])];
  } catch {
    newsPools = [];
  }

  return INSTRUMENT_REGISTRY.map((spec) => {
    const meta = getCommodityMeta(spec.id);
    if (!meta) return null;

    const quote = resolveInstrumentQuote(spec, sources.commodities, null);
    const technical = analyzeInstrumentTechnicals(spec.id, quote.liveQuote);
    const mergedQuote = resolveInstrumentQuote(spec, sources.commodities, technical);
    const newsFactor = scoreNewsForInstrument(meta, sources, newsPools);
    const macroScore = macroScoreForBucket(spec.bucket, sources);

    const outlookPending = !technical.hasEnough && newsFactor.weight <= 0;
    const volOiScore = ((technical.volume?.score || 0) + (technical.oi?.score || 0)) / 2;
    const w = INSTRUMENT_FACTOR_WEIGHTS.short;
    const compositeScore = outlookPending
      ? clamp(macroScore * 0.5, -1, 1)
      : clamp(
          macroScore * w.macro +
            newsFactor.score * w.news +
            technical.techScore * w.technical +
            volOiScore * w.volumeOi,
          -1,
          1
        );

    const horizons = buildInstrumentHorizons(macroScore, newsFactor, technical, spec.bucket);
    if (outlookPending) {
      for (const h of ['short', 'medium', 'long']) {
        horizons[h].directionLabel = '研判积累中';
        horizons[h].commentary = horizons[h].commentary || '宏观因子已接入，技术面与新闻待积累';
      }
    }
    const nextDayRangePct = computeNextDayRangePct({
      compositeScore,
      boll: technical.boll,
      newsScore: newsFactor.score,
      macroScore,
      techScore: technical.techScore,
    });

    const bucketFactorScores = buildBucketFactorScores(sources, spec.bucket);
    const macroFactors = FACTOR_DEFS.map((def) => ({
      id: def.id,
      label: def.shortLabel,
      score: bucketFactorScores[def.id]?.score ?? 0,
      direction: scoreToDirection(bucketFactorScores[def.id]?.score ?? 0),
    }));

    const factors = {
      macro: { score: +macroScore.toFixed(4), bucket: spec.bucket, factors: macroFactors },
      news: {
        score: +newsFactor.score.toFixed(4),
        confidence: newsFactor.confidence,
        summary: newsFactor.summary,
        weight: +newsFactor.weight.toFixed(2),
        hits: newsFactor.hits,
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
    };

    const direction = scoreToDirection(compositeScore);
    const dirLabel = outlookPending ? '研判积累中' : directionLabel(direction);
    const rationale = outlookPending
      ? `${meta.name}：${mergedQuote.price != null ? `现价 ${mergedQuote.price}` : '现价待加载'}；${mergedQuote.priceReason || '研判积累中'}`
      : buildInstrumentRationale(meta, horizons, nextDayRangePct, factors, technical);

    return {
      id: meta.id,
      name: meta.name,
      aliases: meta.keywords?.slice(0, 4) || [],
      exchange: meta.exchange,
      unit: meta.unit,
      bucket: spec.bucket,
      sector: spec.sector,
      priority: spec.priority,
      price: mergedQuote.price,
      changePct: mergedQuote.changePct,
      priceReason: mergedQuote.priceReason,
      outlookPending,
      compositeScore: +compositeScore.toFixed(4),
      direction,
      directionArrow: directionArrow(direction),
      directionLabel: dirLabel,
      confidence: horizons.short.confidence,
      stars: horizons.short.stars,
      starsHtml: horizons.short.starsHtml,
      nextDayRangePct,
      short: horizons.short,
      medium: horizons.medium,
      long: horizons.long,
      techBadges: buildTechBadges(technical, outlookPending),
      factors,
      rationale,
      sourceNote: technical.sourceNote,
    };
  })
    .filter(Boolean)
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
      dataLabel: '大宗商品走势研判 · 逐品种多因子 · 次日波动区间',
      categories,
      instruments,
      factors,
      framework: { logicModel: '多因子+技术面（部分输入异常，已降级）', version: 'v1.16.1' },
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
    dataLabel: '大宗商品走势研判 · 逐品种多因子 · 次日波动区间',
    categories,
    instruments,
    factors,
    framework: {
      logicModel:
        '宏观七因子 → 品种新闻加权 → 成交量/持仓/OIΔ → BOLL(20,2)+MA排列 → 合成评分 → 次日波动区间',
      horizons: HORIZON_LABELS,
      factorIds: FACTOR_DEFS.map((f) => f.id),
      instrumentIds: INSTRUMENT_REGISTRY.map((i) => i.id),
      sectors: OUTLOOK_SECTORS,
      rangeFormula: 'nextDay.mid = 宏观×0.35+技术×0.25+新闻×0.2；区间 ± (BOLL带宽/2 + |新闻|×0.45)',
      version: 'v1.16.1',
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
  HORIZON_WEIGHTS,
  buildInstrumentRegistryFromCatalog,
  buildCommodityOutlookFromSources,
  fetchCommodityOutlookSource,
  getCachedCommodityOutlookSource,
  fetchCommodityOutlookLive,
  refreshCommodityOutlookInBackground,
  directionArrow,
  directionLabel,
  starsToHtml,
};
