/**
 * 大宗商品走势研判 v1 — 规则加权因子引擎
 * 聚合现有数据源：指数/美股、外汇/DXY、政策/气候/地缘、美联储/日央行
 */
const diskCache = require('./disk-cache');
const { normalizeCommodityId } = require('./policy-commodity-map');

const OUTLOOK_DISK_KEY = 'commodity-outlook-v1.json';
const OUTLOOK_DISK_TTL_MS = 60 * 1000;

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

function buildCommodityOutlookFromSources(sources = {}) {
  const globalFactors = buildFactorScores(sources);
  const categories = buildCategoryOutlooks(sources);
  const factors = buildFactorsPanel(globalFactors);

  const dataQuality = [
    sources.indices?.regions?.some((r) => r.indices?.length),
    sources.forex?.pairs?.length || sources.forex?.groups?.length,
    sources.policy?.items?.length,
    sources.climate?.items?.length,
    sources.geopolitics?.items?.length,
    sources.fed?.indicators?.length,
    sources.boj?.indicators?.length,
  ].filter(Boolean).length;

  return {
    key: 'outlook',
    name: '大宗商品走势研判',
    dataLabel: '大宗商品走势研判 · 多因子规则评分 · 短/中/长期展望',
    categories,
    factors,
    framework: {
      logicModel: '美股流动性 → 美元 → 供需/气候/地缘 → 美联储/日央行 → 四大类大宗 outlook',
      horizons: HORIZON_LABELS,
      factorIds: FACTOR_DEFS.map((f) => f.id),
      version: 'v1.14.0',
    },
    stats: {
      categoryCount: categories.length,
      factorCount: factors.length,
      dataQuality,
      dataQualityLabel: `${dataQuality}/7 路数据源可用`,
    },
    updatedAt: new Date().toISOString(),
    liveRefreshedAt: new Date().toISOString(),
  };
}

function fetchCommodityOutlookSource(sources) {
  const payload = buildCommodityOutlookFromSources(sources);
  diskCache.write(OUTLOOK_DISK_KEY, { data: payload, savedAt: Date.now() });
  return payload;
}

function getCachedCommodityOutlookSource() {
  const stored = diskCache.readStale(OUTLOOK_DISK_KEY);
  if (stored?.data?.categories?.length) return stored.data;
  return null;
}

function fetchCommodityOutlookLive({ force = false, sources } = {}) {
  if (!force) {
    const cached = getCachedCommodityOutlookSource();
    const stale = diskCache.readStale(OUTLOOK_DISK_KEY);
    if (cached?.categories?.length) {
      if (Date.now() - (stale?.savedAt || 0) > OUTLOOK_DISK_TTL_MS) {
        refreshCommodityOutlookInBackground(sources);
      }
      return { ...cached, fromCache: true };
    }
  }

  const { getCachedAllData } = require('./data-fetcher');
  const allSources = sources || getCachedAllData()?.sources || {};
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
  FACTOR_DEFS,
  HORIZON_WEIGHTS,
  buildCommodityOutlookFromSources,
  fetchCommodityOutlookSource,
  getCachedCommodityOutlookSource,
  fetchCommodityOutlookLive,
  refreshCommodityOutlookInBackground,
  directionArrow,
  directionLabel,
  starsToHtml,
};
