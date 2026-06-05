/**
 * 大宗商品走势研判 v4 — 动态多情景 + 双轨波动 + 环境 regime + 变更存档
 */
const diskCache = require('./disk-cache');
const volModel = require('./commodity-volatility-model');
const marketAdaptive = require('./commodity-market-adaptive');
const outlookHistory = require('./commodity-outlook-history');
const outlookCalibration = require('./commodity-outlook-calibration');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getCommodityMeta, getAllCommodities } = require('./commodities-catalog');
const { getNewsKeywords, scoreNewsItem, getGlobalNewsPoolSync } = require('./commodities-news');
const {
  getInstrumentProfile,
  getSectorVolPrior,
  volMultiplier,
  directionTierClass,
} = require('./commodity-instrument-profiles');
const {
  analyzeInstrumentTechnicals,
  hasCachedDayKlines,
  readCachedKlines,
  readPrevVolForecast,
} = require('./commodity-technical-analyzer');
const philosophy = require('./commodity-outlook-philosophy');
const eventCalendar = require('./commodity-outlook-event-calendar');

const OUTLOOK_DISK_KEY = 'commodity-outlook-v4.json';
const OUTLOOK_DISK_TTL_MS = 60 * 1000;
const OUTLOOK_RECOMPUTE_DEBOUNCE_MS = 800;
const PRICE_OI_CHANGE_THRESHOLD_PCT = 0.15;
const OUTLOOK_ENGINE_VERSION = 'v1.26.0';

/** 市场研判环境（条件权重，非固定） */
const REGIME_IDS = ['riskOn', 'riskOff', 'liquidityPanic', 'supplyShock', 'weatherShock', 'neutral'];

const REGIME_LABELS = {
  riskOn: '风险偏好',
  riskOff: '避险回落',
  liquidityPanic: '流动性恐慌',
  supplyShock: '供应冲击',
  weatherShock: '气候冲击',
  neutral: '中性',
};

/** regime → 因子权重乘数（× profile.factorWeights） */
const REGIME_FACTOR_MULTIPLIERS = {
  riskOn: { macroEquities: 1.15, macroUsd: 0.95, macroGeo: 0.9, news: 1.05, capital: 1.1, weather: 0.85 },
  riskOff: { macroEquities: 1.2, macroUsd: 1.1, macroFed: 1.05, macroGeo: 1.15, news: 1.1, technical: 0.95 },
  liquidityPanic: { macroFed: 1.25, macroEquities: 1.3, macroUsd: 1.1, intraday: 1.2, capital: 1.15, news: 1.05 },
  supplyShock: { macroGeo: 1.35, macroPolicy: 1.2, news: 1.25, inventory: 1.2, macroClimate: 0.9 },
  weatherShock: { weather: 1.45, macroClimate: 1.35, news: 1.1, macroChina: 1.05, macroEquities: 0.9 },
  neutral: {},
};

let liveRefreshPromise = null;
let outlookRecomputeTimer = null;
let lastOutlookFingerprint = null;
let lastOutlookDataVersion = 0;

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

function loadBacktestSummarySafe() {
  try {
    return require('./commodity-outlook-backtest').loadBacktestSummary();
  } catch {
    return null;
  }
}

function loadLongrunSummarySafe() {
  try {
    return require('./commodity-outlook-backtest').loadLongrunSummary();
  } catch {
    return null;
  }
}

function applyLiveMacroEventMultipliers(macroScores, multipliers = {}) {
  const m = multipliers || {};
  return {
    ...macroScores,
    fed: (macroScores.fed ?? 0) * (m.macroFed ?? 1),
    geo: (macroScores.geo ?? 0) * (m.macroGeo ?? 1),
    china: (macroScores.china ?? 0) * (m.macroChina ?? 1),
  };
}

function countOutlookDataSources(sources = {}) {
  return [
    sources.indices?.regions?.some((r) => r.indices?.length),
    sources.forex?.pairs?.length || sources.forex?.groups?.length,
    sources.policy?.items?.length,
    sources.climate?.items?.length,
    sources.geopolitics?.items?.length,
    sources.fed?.indicators?.length,
    sources.boj?.indicators?.length,
    sources.commodities?.exchanges?.some((e) => e.items?.length),
  ].filter(Boolean).length;
}

function applyNewsPriceConfirmation(newsImpact, changePct) {
  const chg = Number(changePct);
  if (!newsImpact || Number.isNaN(chg)) return newsImpact;
  const damp =
    (newsImpact.score > 0.05 && chg < -0.5) || (newsImpact.score < -0.05 && chg > 0.5);
  if (!damp) return newsImpact;
  return {
    ...newsImpact,
    shock: +(newsImpact.shock * 0.4).toFixed(3),
    score: +(newsImpact.score * 0.4).toFixed(4),
    shockDisplay: `${newsImpact.shock * 0.4 >= 0 ? '+' : ''}${(newsImpact.shock * 0.4).toFixed(2)}`,
    summary: `${newsImpact.summary || ''} · 现价背离×0.4`.trim(),
    priceDampened: true,
  };
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
  macroBoj: '日央行',
  philosophySdFinance: '供需×金融',
  philosophyPrice: '现价反馈',
  philosophyCapital: '资金情绪',
  philosophyOil: '原油传导',
  technical: '技术面',
  capital: '资金关注',
  news: '资讯冲击',
  intraday: '盘中',
  inventory: '库存/OI',
  weather: '天气',
  profileAdjust: '品种校准',
  volLevel: '波动水平',
  volTrend: '波动趋势',
  volForecastPct: 'σ预测',
  instant: '即时通道',
  delayed: '滞后通道',
  latency: '反射状态',
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

function computeVolBias(smoothedVol, technical, directionHint = 'neutral') {
  if (!smoothedVol?.volForecastPct) {
    return { volLevel: 0, volTrend: 0, volBias: 0, volForecastPct: null };
  }

  let volLevel = 0;
  if (smoothedVol.regime === 'low') volLevel = 0.06;
  else if (smoothedVol.regime === 'high') volLevel = -0.04;

  const intradayChg = technical.intraday?.changePct ?? 0;
  const intradayBearish = intradayChg < -0.08;
  const intradayBullish = intradayChg > 0.08;
  const trendAligned =
    (directionHint === 'bullish' && intradayBullish) ||
    (directionHint === 'bearish' && intradayBearish);

  let volTrend = 0;
  if (smoothedVol.volRising && intradayBearish) volTrend = -0.03;
  else if (smoothedVol.volFalling && trendAligned) volTrend = 0.03;
  else if (smoothedVol.volRising) volTrend = -0.02;
  else if (smoothedVol.volFalling) volTrend = 0.02;

  const volBias = volLevel + volTrend;
  return {
    volLevel: +volLevel.toFixed(2),
    volTrend: +volTrend.toFixed(2),
    volBias: +volBias.toFixed(4),
    volForecastPct: smoothedVol.volForecastPct,
  };
}

function adjustConfidenceForVolStability(baseStars, smoothedVol) {
  let stars = baseStars;
  if (!smoothedVol?.volEma10 || !smoothedVol?.volEma20) return clampStars(stars);

  const avg = (smoothedVol.volEma10 + smoothedVol.volEma20) / 2;
  const relDiff = avg > 0 ? Math.abs(smoothedVol.volEma10 - smoothedVol.volEma20) / avg : 1;

  if (relDiff < 0.1) stars += 1;
  else if (smoothedVol.regime === 'low') stars += 0.5;
  else if (smoothedVol.regime === 'high') stars -= 0.5;

  return clampStars(stars);
}

function effectiveDirectionThresholds(profile, smoothedVol) {
  const th = profile.directionThresholds || {};
  if (smoothedVol?.regime !== 'high') return th;
  const widen = 1.12;
  return {
    strongBull: (th.strongBull ?? 0.15) * widen,
    bull: (th.bull ?? 0.07) * widen,
    bear: (th.bear ?? -0.07) * widen,
    strongBear: (th.strongBear ?? -0.15) * widen,
  };
}

function scoreToDirectionTierWithVol(score, profile, smoothedVol) {
  const th = effectiveDirectionThresholds(profile, smoothedVol);
  if (score >= th.strongBull) return { direction: 'strong_bullish', label: '强多', arrow: '↑↑' };
  if (score >= th.bull) return { direction: 'bullish', label: '偏多', arrow: '↑' };
  if (score <= th.strongBear) return { direction: 'strong_bearish', label: '强空', arrow: '↓↓' };
  if (score <= th.bear) return { direction: 'bearish', label: '偏空', arrow: '↓' };
  return { direction: 'neutral', label: '震荡', arrow: '→' };
}

function buildFactorBreakdown({
  profile,
  macroScores,
  technical,
  capitalAttention,
  newsImpact,
  inventoryScore,
  weatherScore,
  volBiasParts,
  regime = 'neutral',
}) {
  const { adjusted: w, regimeMultipliers } = applyRegimeToFactorWeights(profile, regime);
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
    volLevel: volBiasParts?.volLevel ?? 0,
    volTrend: volBiasParts?.volTrend ?? 0,
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
  breakdown._regime = regime;
  breakdown._regimeMultipliers = regimeMultipliers;
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

function buildHistoricalContext({ bars, predictedMid, regimeLabel, volRegimeLabel }) {
  if (!bars?.length) {
    return {
      similarDays60: 0,
      maxAbsReturn60: null,
      avgAbsReturn20: null,
      avgNextDayPct: null,
      regimeMatchSummary: '',
      precedentSummary: '日线不足，暂无历史对照',
      oftenAppears: false,
    };
  }

  const sorted = [...bars].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const window = sorted.slice(-62);
  const returns = [];
  for (let i = 1; i < window.length; i += 1) {
    const prev = window[i - 1].close;
    const cur = window[i].close;
    if (prev > 0 && cur > 0) {
      const ret = +(((cur - prev) / prev) * 100).toFixed(3);
      let nextRet = null;
      if (i + 1 < window.length && window[i + 1].close > 0) {
        nextRet = +(((window[i + 1].close - cur) / cur) * 100).toFixed(3);
      }
      returns.push({ date: String(window[i].date), ret, nextRet });
    }
  }

  const last60Returns = returns.slice(-60);
  const absReturns = last60Returns.map((r) => Math.abs(r.ret));
  const maxAbsReturn60 = absReturns.length ? +Math.max(...absReturns).toFixed(3) : null;
  const last20 = absReturns.slice(-20);
  const avgAbsReturn20 = last20.length
    ? +(last20.reduce((s, v) => s + v, 0) / last20.length).toFixed(3)
    : null;

  const mid = Number(predictedMid);
  const similar = last60Returns.filter((r) => {
    const absR = Math.abs(r.ret);
    const target = Math.abs(mid);
    if (Number.isNaN(target)) return false;
    if (target < 0.05) return absR <= 0.4;
    return absR >= target * 0.8 && absR <= target * 1.2;
  });
  const similarDays60 = similar.length;
  const nextMoves = similar.map((s) => s.nextRet).filter((n) => n != null);
  const avgNextDayPct = nextMoves.length
    ? +(nextMoves.reduce((s, v) => s + v, 0) / nextMoves.length).toFixed(2)
    : null;

  const envLabel = [volRegimeLabel || '常态波', regimeLabel || '中性环境'].filter(Boolean).join('+');
  const regimeMatchSummary =
    similarDays60 > 0 && avgNextDayPct != null
      ? `近60日类似环境(${envLabel})出现 ${similarDays60} 次，次日平均涨跌 ${avgNextDayPct >= 0 ? '+' : ''}${avgNextDayPct}%`
      : similarDays60 > 0
        ? `近60日类似波动幅度出现 ${similarDays60} 次`
        : '近60日少见与预测中心相当的波动幅度';

  const midText =
    mid != null && !Number.isNaN(mid) ? `${mid >= 0 ? '+' : ''}${mid.toFixed(2)}%` : '当前预测';
  const oftenAppears = similarDays60 >= 5;
  const precedentSummary = oftenAppears
    ? `历史上${similarDays60}个交易日波幅接近预测中心${midText}，属较常出现；${
        avgNextDayPct != null
          ? `同类情形后次日平均${avgNextDayPct >= 0 ? '上涨' : '下跌'}${Math.abs(avgNextDayPct)}%`
          : '次日样本偏少'
      }。`
    : `近60日仅${similarDays60}日波幅接近${midText}，${similarDays60 <= 1 ? '属少见情形' : '偶发情形'}，需关注超预期波动。`;

  return {
    similarDays60,
    maxAbsReturn60,
    avgAbsReturn20,
    avgNextDayPct,
    regimeMatchSummary,
    precedentSummary,
    oftenAppears,
  };
}

function buildPredictionRationale({
  outlookPending,
  smoothedVol,
  nextDayRangePct,
  scenarios,
  newsImpact,
  capitalAttention,
  latencyLabel,
  latencyState,
  changePct,
  instantScore,
}) {
  if (outlookPending) return '现价待加载，预测依据将在行情接入后生成';

  const sv = smoothedVol || {};
  const sigma = sv.sigma20 ?? nextDayRangePct?.histVol20d;
  const regime = sv.regimeLabel || '常态波';
  const pct60 = sv.percentile != null ? `${Math.round(sv.percentile)}%分位` : '';
  const emaPart =
    sv.volEma10 != null && sv.volEma20 != null
      ? `EMA10/20 ${sv.volEma10.toFixed(2)}/${sv.volEma20.toFixed(2)}%`
      : sv.volForecastPct != null
        ? `平滑预测${sv.volForecastPct.toFixed(2)}%`
        : '';

  const newsCount = newsImpact?.hitCount || 0;
  const topTitle = (newsImpact?.topTitle || newsImpact?.hits?.[0]?.title || '').trim().slice(0, 28);
  const highStars = countHighStarNewsHits(newsImpact);
  const capScore = capitalAttention?.score;
  const volPm = nextDayRangePct?.expectedMovePct ?? nextDayRangePct?.halfWidth;
  const chg =
    changePct != null && !Number.isNaN(Number(changePct))
      ? `即时盘面${changePct >= 0 ? '+' : ''}${Number(changePct).toFixed(2)}%`
      : '';
  const latency = latencyLabel || latencyState || '';
  const instant =
    instantScore != null ? `即时分${instantScore >= 0 ? '+' : ''}${Number(instantScore).toFixed(2)}` : '';

  let stressNote = '极端情景未触发';
  if (scenarios?.stress) {
    const span = Number(scenarios.stress.high) - Number(scenarios.stress.low);
    stressNote = scenarios.stressTriggered
      ? `极端已触发·跨度${span.toFixed(2)}%`
      : `极端缓冲+${(highStars * 0.3).toFixed(1)}%资讯`;
  } else if (highStars >= 1) {
    stressNote = `高星${highStars}条·极端缓冲`;
  }

  const line1 = [
    sigma != null ? `近20日σ${sigma.toFixed(2)}%` : null,
    `环境${regime}`,
    emaPart,
    pct60 ? `60日${pct60}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const line2 = [
    newsCount ? `资讯${newsCount}条命中${topTitle ? `「${topTitle}」` : ''}` : '资讯无高星突发',
    capScore != null ? `资金关注${capScore}/100` : null,
    latency ? `双速${latency}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const line3 = [
    chg,
    instant,
    volPm != null ? `预测波动±${Number(volPm).toFixed(2)}%` : null,
    stressNote,
  ]
    .filter(Boolean)
    .join(' · ');

  const lines = [line1, line2, line3].filter((l) => l && l.length > 4);
  if (!lines.length) return '依据：波动与资讯数据积累中';
  return lines.slice(0, 3).join('\n');
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
  return volModel.countHighStarHits(newsFactor, 4);
}

function evaluateContext(sources, { sector, bucketId, technical, newsFactor } = {}) {
  const usEq = scoreUsEquities(sources.indices, sources.fed);
  const usd = scoreUsd(sources.forex);
  const vix = parseVix(sources.fed);
  const dxyChg = Math.abs(Number(usd.metrics?.changePct) || 0);
  const geoAgg = aggregateIntelItems(sources.geopolitics?.items, bucketId || 'energy', 25);
  const climateAgg = aggregateIntelItems(sources.climate?.items, bucketId || 'agriculture', 25);
  const highStars = countHighStarNewsHits(newsFactor);
  const oiSpike = Math.abs(technical?.oi?.deltaPct ?? 0) >= 3;
  const volSpike = (technical?.volume?.ratio ?? 1) >= 1.65;

  let regime = 'neutral';
  const triggers = [];

  if (vix > 26 && usEq.metrics?.panic) {
    regime = 'liquidityPanic';
    triggers.push('VIX恐慌');
  } else if (vix > 24 && usEq.score < -0.15) {
    regime = 'riskOff';
    triggers.push('VIX偏高');
  } else if (geoAgg.weight > 1.2 && geoAgg.score > 0.15 && (sector === 'energy' || sector === 'precious')) {
    regime = 'supplyShock';
    triggers.push('地缘供应');
  } else if (
    (sector === 'agriculture' || bucketId === 'agriculture') &&
    climateAgg.weight > 0.8 &&
    Math.abs(climateAgg.score) > 0.12
  ) {
    regime = 'weatherShock';
    triggers.push('气候农产品');
  } else if (usEq.score > 0.2 && vix < 20 && dxyChg < 0.2) {
    regime = 'riskOn';
    triggers.push('美股+VIX');
  } else if (dxyChg > 0.35 && usd.score < -0.1) {
    regime = 'riskOff';
    triggers.push('美元走强');
  }

  if (highStars >= 2 && regime === 'neutral') {
    regime = geoAgg.score > 0 ? 'supplyShock' : 'riskOff';
    triggers.push('高星资讯');
  }
  if (oiSpike && volSpike && regime === 'neutral') {
    regime = 'riskOn';
    triggers.push('持仓放量');
  }

  return {
    regime,
    regimeLabel: REGIME_LABELS[regime] || regime,
    triggers,
    activeRules: REGIME_FACTOR_MULTIPLIERS[regime] || {},
    vix,
    dxyChangePct: usd.metrics?.changePct,
  };
}

function applyRegimeToFactorWeights(profile, regime) {
  const mults = REGIME_FACTOR_MULTIPLIERS[regime] || {};
  const base = { ...profile.factorWeights };
  const adjusted = {};
  for (const [k, v] of Object.entries(base)) {
    adjusted[k] = v * (mults[k] ?? 1);
  }
  const sum = Object.values(adjusted).reduce((s, n) => s + n, 0) || 1;
  for (const k of Object.keys(adjusted)) {
    adjusted[k] = adjusted[k] / sum;
  }
  return { adjusted, regimeMultipliers: mults };
}

function buildScenarioBand(mid, halfWidth, bias, score) {
  let down = halfWidth;
  let up = halfWidth;
  if (bias === 'bearish' || score < -0.08) {
    down *= 1.08;
    up *= 0.94;
  } else if (bias === 'bullish' || score > 0.08) {
    down *= 0.94;
    up *= 1.08;
  }
  return {
    low: +clamp(mid - down, -99, 99).toFixed(3),
    mid: +mid.toFixed(3),
    high: +clamp(mid + up, -99, 99).toFixed(3),
    bias,
    score: +score.toFixed(3),
  };
}

function buildScenarios({
  compositeScore,
  mid,
  halfWidth,
  classMax,
  newsFactor,
  shockVol,
  smoothedVol,
  flowAligned,
}) {
  const bias = scoreToDirection(compositeScore);
  const base = buildScenarioBand(mid, halfWidth, bias, compositeScore);

  const bullScore = clamp(compositeScore + (flowAligned ? 0.14 : 0.08), -1, 1);
  const bearScore = clamp(compositeScore - (flowAligned ? 0.14 : 0.08), -1, 1);
  const bullShift = halfWidth * (0.22 + Math.max(0, compositeScore) * 0.18);
  const bearShift = halfWidth * (0.22 + Math.max(0, -compositeScore) * 0.18);
  const bull = buildScenarioBand(mid + bullShift, halfWidth * 0.78, 'bullish', bullScore);
  const bear = buildScenarioBand(mid - bearShift, halfWidth * 0.78, 'bearish', bearScore);

  const highStars = countHighStarNewsHits(newsFactor);
  const stressTriggered = volModel.isVolShockTriggered({ shockVol, smoothedVol, highStarCount: highStars });
  let stress = null;
  if (stressTriggered) {
    const stressHalf = Math.min(halfWidth * 1.45, classMax * 1.05);
    const stressMid = mid + (bias === 'bullish' ? stressHalf * 0.2 : bias === 'bearish' ? -stressHalf * 0.2 : 0);
    stress = buildScenarioBand(stressMid, stressHalf, bias, compositeScore);
    stress.label = '突变';
  }

  return { base, bull, bear, stress, stressTriggered };
}

function hashNewsPool(sources, newsPools) {
  const titles = [
    ...(sources.policy?.items || []).slice(0, 12).map((i) => i.title),
    ...(sources.geopolitics?.items || []).slice(0, 12).map((i) => i.title),
    ...(sources.climate?.items || []).slice(0, 8).map((i) => i.title),
    ...(newsPools || []).slice(0, 20).map((i) => i.title),
  ]
    .filter(Boolean)
    .join('|');
  return titles.length ? `${titles.length}:${titles.slice(0, 400)}` : '';
}

function computeOutlookFingerprint(sources, commoditiesSource) {
  const newsHash = hashNewsPool(sources, collectOutlookNewsPools());
  const prices = [];
  for (const ex of commoditiesSource?.exchanges || []) {
    for (const item of ex.items || []) {
      if (item.price != null) {
        prices.push(`${item.id}:${item.price}:${item.changePct}:${item.openInterest}`);
      }
    }
  }
  prices.sort();
  return `${newsHash}::${prices.slice(0, 80).join(';')}`;
}

function outlookFingerprintChanged(prev, next) {
  if (!prev || !next) return true;
  return prev !== next;
}

function parseVix(fedSource) {
  const vixInd = findIndicator(fedSource?.indicators, 'VIXCLS');
  const vix = parseFloat(vixInd?.value);
  return Number.isNaN(vix) ? 20 : vix;
}

function computeNextDayRangePct({
  compositeScore,
  historicalVol,
  smoothedVol,
  volatilityTier,
  newsFactor,
  newsShock,
  newsShockCap,
  macroScore,
  techScore,
  intradayChangePct,
  sector,
  instrumentId,
  vix,
  volumeRatio,
  shockVol: shockVolIn,
  compositeVolPct: compositeVolIn,
  instantChannelFired = false,
}) {
  const classMax = getClassMaxPct(sector, instrumentId);
  const idLower = String(instrumentId || '').toLowerCase();
  const sectorPrior = getSectorVolPrior(sector);
  const sigma =
    historicalVol?.sigmaDaily20 ??
    historicalVol?.histVol20d ??
    smoothedVol?.sigma20 ??
    sectorPrior * 0.72;
  const baselineVol = smoothedVol?.volForecastPct ?? Math.max(sectorPrior * 0.52, sigma);
  const highStarCount = countHighStarNewsHits(newsFactor);
  const shockVol =
    shockVolIn ??
    volModel.computeShockVol({
      intradayChangePct,
      volumeRatio: volumeRatio ?? 1,
      highStarCount,
      smoothedVol,
      newsShock,
    });
  const boostedShock = instantChannelFired ? shockVol * 1.12 + 0.08 : shockVol;
  const shockWeight = volModel.computeShockWeight({
    newsHitCount: newsFactor?.hitCount ?? 0,
    highStarCount,
    volumeRatio: volumeRatio ?? 1,
  });
  const compositeVol =
    compositeVolIn ?? volModel.computeCompositeVolPct({ baselineVol, shockVol: boostedShock, shockWeight });

  const prevVolRef = smoothedVol?.prevForecastPct ?? readPrevVolForecast(instrumentId) ?? baselineVol;
  const tierMult = volMultiplier(volatilityTier || 'medium');
  let halfWidth = compositeVol * tierMult;

  if (smoothedVol?.regime === 'low') halfWidth *= 0.92;
  else if (smoothedVol?.regime === 'high') halfWidth *= 1.06;

  const scoreSpread = Math.abs(compositeScore || 0) * 0.06;
  const volRatioSpread = clamp(((volumeRatio ?? 1) - 1) * 0.14, -0.08, 0.22);
  const intradaySpread = clamp(Math.abs(intradayChangePct || 0) * 0.04, 0, 0.18);
  halfWidth = halfWidth * (1 + scoreSpread + volRatioSpread + intradaySpread);

  halfWidth = Math.min(halfWidth, classMax);
  halfWidth = Math.max(halfWidth, 0.12);

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

  if (idLower === 'au' || idLower === 'pt' || idLower === 'pd') {
    const maxSpan = idLower === 'au' ? 1.2 : 1.65;
    const span = high - low;
    if (span > maxSpan) {
      const center = (high + low) / 2;
      const half = maxSpan / 2;
      low = +clamp(center - half, -maxSpan, maxSpan).toFixed(3);
      high = +clamp(center + half, -maxSpan, maxSpan).toFixed(3);
      halfWidth = Math.min(halfWidth, maxSpan / 2);
    }
  }

  const expectedMovePct = (Math.abs(low - mid) + Math.abs(high - mid)) / 2;
  const histVol20d = historicalVol?.histVol20d ?? sigma;

  let biasLabel = directionLabel(bias);
  if (Math.abs(compositeScore || 0) <= 0.12) biasLabel = '震荡';

  const volSubline = `基线 ${baselineVol.toFixed(2)}% + 突变${boostedShock.toFixed(2)}%×${shockWeight} → ${compositeVol.toFixed(2)}% · 昨日 ${Number(prevVolRef).toFixed(2)}%`;

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
    volForecastPct: +compositeVol.toFixed(4),
    baselineVolPct: +baselineVol.toFixed(4),
    shockVol: +boostedShock.toFixed(4),
    shockWeight: +Number(shockWeight).toFixed(3),
    compositeVolPct: +compositeVol.toFixed(4),
    volForecastDisplay: `σ${compositeVol.toFixed(2)}% (平滑+突变)`,
    volForecastSubline: volSubline,
    smoothedVolDisplay: smoothedVol?.display || null,
    rangeCapped,
    rangeCappedNote: rangeCapped ? '区间已按品种历史上限校准' : null,
    halfWidth: +halfWidth.toFixed(3),
    classMaxPct: classMax,
    volatilityProxy: +compositeVol.toFixed(3),
    formula: `±(基线EMA+突变层)×tierMult+资讯；mid=宏观/技术/新闻/盘中`,
  };
}

function computeInstrumentConfidence({
  hasLivePrice,
  hasEnough,
  dataPoints,
  newsHitCount,
  oiDelta,
  volumeRatio,
  compositeScore,
  smoothedVol,
  sector,
  instrumentId,
  dataQuality,
}) {
  let raw = 1;
  if (hasLivePrice) raw += 1.2;
  if (hasEnough) raw += 1.5;
  else if (dataPoints >= 5) raw += 0.7;
  if (newsHitCount > 0) raw += Math.min(newsHitCount * 0.15, 1);
  if (oiDelta != null) raw += 0.4;
  if (volumeRatio != null) raw += 0.25;
  raw += Math.abs(compositeScore || 0) * 1.2;
  if (dataQuality != null && dataQuality < 3) raw -= 1.2;

  const sectorHit = sector ? outlookCalibration.getSectorHitRate(sector, 60) : null;
  const instHit = instrumentId ? outlookCalibration.getInstrumentHitRate(instrumentId, 30) : null;
  const hitRate = instHit?.rate ?? sectorHit?.rate;
  if (hitRate != null) {
    if (hitRate >= 0.62) raw += 0.8;
    else if (hitRate >= 0.55) raw += 0.4;
    else if (hitRate < 0.45) raw -= 0.5;
  }

  return adjustConfidenceForVolStability(raw, smoothedVol);
}

function buildInstrumentHorizons(macroScore, newsFactor, technical, bucketId, compositeScore, smoothedVol) {
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
      smoothedVol,
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

function maStatusBadge(ma, price, label) {
  if (ma == null || price == null || Number.isNaN(Number(ma)) || Number.isNaN(Number(price))) {
    return null;
  }
  const above = Number(price) >= Number(ma);
  return {
    id: `ma-${label}`,
    label: `${label}${above ? '上' : '下'}`,
    trend: above ? 'up' : 'down',
  };
}

function buildDailyStatusBadge(technical) {
  const chg = technical.changePct ?? technical.intraday?.changePct;
  if (chg == null || Number.isNaN(Number(chg))) return null;
  const v = Number(chg);
  if (Math.abs(v) < 0.08) return { id: 'daily-flat', label: '日线震荡', trend: 'flat' };
  return {
    id: 'daily-trend',
    label: v > 0 ? '日线阳线' : '日线阴线',
    trend: v > 0 ? 'up' : 'down',
  };
}

function buildTechBadges(technical, outlookPending = false, extras = {}) {
  const badges = [];
  if (outlookPending) {
    badges.push({ id: 'pending-outlook', label: '待加载报价', trend: 'flat' });
    return badges;
  }
  if (!technical.hasEnough && technical.hasLivePrice) {
    badges.push({ id: 'partial-data', label: '日线不足·用盘中+资讯', trend: 'flat' });
  }
  const price = technical.price;
  const ma = technical.maStack;
  if (ma) {
    for (const [key, label] of [
      ['ma5', 'MA5'],
      ['ma10', 'MA10'],
      ['ma20', 'MA20'],
      ['ma60', 'MA60'],
    ]) {
      const b = maStatusBadge(ma[key], price, label);
      if (b) badges.push(b);
    }
    if (ma.alignmentLabel) {
      badges.push({
        id: 'ma-align',
        label: ma.alignmentLabel,
        trend: ma.alignment?.includes('bull') ? 'up' : ma.alignment?.includes('bear') ? 'down' : 'flat',
      });
    }
    if (ma.crossLabel) {
      badges.push({
        id: 'cross',
        label: ma.crossLabel,
        trend: ma.crossSignal === 'golden' ? 'up' : 'down',
      });
    }
  }
  const dailyBadge = buildDailyStatusBadge(technical);
  if (dailyBadge) badges.push(dailyBadge);
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
  const sv = technical.smoothedVol;
  if (sv?.regimeLabel) {
    badges.push({
      id: 'vol-regime',
      label: sv.regimeLabel,
      trend: sv.regimeTrend || 'flat',
    });
  }
  if (sv?.volForecastPct != null) {
    badges.push({
      id: 'vol-forecast',
      label: `σ预测${sv.volForecastPct.toFixed(2)}%`,
      trend: sv.volRising ? 'up' : sv.volFalling ? 'down' : 'flat',
    });
  }
  if (extras.latencyLabel) {
    badges.push({
      id: 'latency',
      label: extras.latencyLabel,
      trend: extras.latencyState === 'sync' ? 'up' : extras.latencyState === 'diverge' ? 'down' : 'flat',
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

async function ensurePriorityKlinesForOutlook() {
  const { fetchCommodityHistory } = require('./commodities-history-fetcher');
  const missing = KLINE_BACKFILL_PRIORITY.filter((id) => !hasCachedDayKlines(id, 5));
  for (let i = 0; i < missing.length; i += 1) {
    try {
      await fetchCommodityHistory(missing[i], 'day');
    } catch {
      // ignore per-instrument failures
    }
    if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 120));
  }
}

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

function buildInstrumentOutlooks(sources, globalCtx = null) {
  const newsPools = collectOutlookNewsPools();
  const sharedCtx =
    globalCtx ||
    evaluateContext(sources, { sector: 'energy', bucketId: 'energy', technical: {}, newsFactor: {} });

  const prepRows = INSTRUMENT_REGISTRY.map((spec) => {
    const meta = getCommodityMeta(spec.id);
    if (!meta) return null;
    const profile = getInstrumentProfile(spec.id);
    const sectorPrior = getSectorVolPrior(spec.sector || profile.sector);
    const quote = resolveInstrumentQuote(spec, sources.commodities, null);
    const technical = analyzeInstrumentTechnicals(spec.id, quote.liveQuote, { sectorPrior });
    const mergedQuote = resolveInstrumentQuote(spec, sources.commodities, technical);
    return { spec, meta, profile, liveQuote: mergedQuote.liveQuote, technical, mergedQuote };
  }).filter(Boolean);

  const sectorRanks = computeSectorVolumeRanks(
    prepRows.map((r) => ({ id: r.spec.id, sector: r.spec.sector, liveQuote: r.liveQuote, technical: r.technical }))
  );

  return prepRows
    .map(({ spec, meta, profile, liveQuote, technical, mergedQuote }) => {
      const newsImpactRaw = scoreNewsImpactForInstrument(meta, profile, sources, newsPools);
      const newsImpact = applyNewsPriceConfirmation(
        newsImpactRaw,
        mergedQuote.changePct ?? technical.intraday?.changePct
      );
      const newsFactor = { score: newsImpact.score, hits: newsImpact.hits, hitCount: newsImpact.hitCount };
      const sourceLaneCount = countOutlookDataSources(sources);

      const today = new Date().toISOString().slice(0, 10);
      const eventCtx = eventCalendar.getActiveEventsMerged(today, {
        instrumentId: spec.id,
        sector: spec.sector,
      });

      const phil = philosophy.evaluateInstrumentPhilosophy({
        meta,
        profile,
        spec,
        sources,
        technical,
        liveQuote,
        newsImpact,
        sectorVolumeRank: sectorRanks[spec.id],
        changePct: mergedQuote.changePct,
        eventMultipliers: eventCtx.weightMultipliers,
      });

      const ctx = evaluateContext(sources, {
        sector: spec.sector,
        bucketId: spec.bucket,
        technical,
        newsFactor,
      });
      const regime = ctx.regime !== 'neutral' ? ctx.regime : sharedCtx.regime;
      const regimeLabel = REGIME_LABELS[regime] || regime;

      let macroScores = buildMacroScoresForInstrument(sources, spec.bucket);
      macroScores = applyLiveMacroEventMultipliers(macroScores, eventCtx.weightMultipliers);
      const capitalAttention = computeCapitalAttention(technical, liveQuote, sectorRanks[spec.id]);
      const inventoryScore = computeInventoryScore(technical, profile);
      const weatherScore = computeWeatherScore(macroScores.climate, profile);

      const prelimScore = clamp(
        (technical.techScore || 0) * 0.35 +
          (newsImpact.shock || newsImpact.score * 0.15) * 0.25 +
          (macroScores.usd * 0.3 + macroScores.china * 0.4) * 0.2,
        -1,
        1
      );
      const directionHint = scoreToDirection(prelimScore);
      const volBiasParts = computeVolBias(technical.smoothedVol, technical, directionHint);

      const factorBreakdown = buildFactorBreakdown({
        profile,
        macroScores,
        technical,
        capitalAttention,
        newsImpact,
        inventoryScore,
        weatherScore,
        volBiasParts,
        regime,
      });
      const regimeMultipliers = factorBreakdown._regimeMultipliers || {};
      delete factorBreakdown._regime;
      delete factorBreakdown._regimeMultipliers;

      let factorComposite = clamp((factorBreakdown._sum ?? 0) + (volBiasParts.volBias || 0), -1, 1);
      const capMult = eventCtx.weightMultipliers?.capitalSentiment ?? 1;
      if (capMult !== 1) factorComposite = clamp(factorComposite * capMult, -1, 1);
      delete factorBreakdown._sum;
      if (volBiasParts.volForecastPct != null) {
        factorBreakdown.volForecastPct = +volBiasParts.volForecastPct.toFixed(2);
      }

      const vix = parseVix(sources.fed);
      const adaptive = marketAdaptive.computeAdaptiveOutlook({
        intradayChangePct: technical.intraday?.changePct ?? mergedQuote.changePct,
        intradayScore: technical.intraday?.score || 0,
        volumeRatio: technical.volume?.ratio ?? 1,
        newsHits: newsImpact.hits,
        sources,
        vix,
        oiDeltaPct: technical.oi?.deltaPct,
        oiScore: inventoryScore,
        maStack: technical.maStack,
        smoothedVol: technical.smoothedVol,
        technicalScore: technical.techScore,
        macroScores,
      });
      Object.assign(factorBreakdown, adaptive.factorBreakdown);

      const philContrib = phil.contributions || {};
      factorBreakdown.philosophySdFinance = philContrib.sdFinance ?? phil.sdFinance?.score * 0.32 ?? 0;
      factorBreakdown.philosophyPrice = philContrib.priceFeedback ?? 0;
      factorBreakdown.philosophyCapital = philContrib.capitalSentiment ?? 0;
      factorBreakdown.philosophyOil = philContrib.oilMother ?? 0;
      factorBreakdown.macroBoj =
        (macroScores.boj ?? 0) * (profile.macroSensitivity?.fed ?? 0.5) * (profile.factorWeights?.macroFed ?? 0.08);

      let philosophyScore = phil.compositeScore ?? 0;
      const philMult = eventCtx.weightMultipliers?.philosophy ?? 1;
      if (philMult !== 1) philosophyScore = clamp(philosophyScore * philMult, -1, 1);
      const blend = outlookCalibration.getCompositeWeights(today, eventCtx);
      const compositeScoreRaw = clamp(
        philosophyScore * blend.philosophyWeight +
          adaptive.compositeScore * blend.adaptiveWeight +
          factorComposite * blend.factorWeight,
        -1,
        1
      );

      let compositeScore = compositeScoreRaw;
      let dirTier = scoreToDirectionTierWithVol(compositeScore, profile, technical.smoothedVol);
      let direction = directionTierClass(dirTier.direction);
      let directionLabelOverride = null;
      let insufficientData = false;

      if (sourceLaneCount < 3) {
        insufficientData = true;
        direction = 'neutral';
        directionLabelOverride = '数据不足·观望';
        compositeScore = clamp(compositeScoreRaw * 0.35, -0.35, 0.35);
        dirTier = scoreToDirectionTierWithVol(compositeScore, profile, technical.smoothedVol);
      }

      const hasLivePrice = mergedQuote.price != null && !Number.isNaN(Number(mergedQuote.price));
      const outlookPending = !hasLivePrice;

      const horizons = buildInstrumentHorizons(
        macroScores.china * 0.5 + macroScores.usd * 0.3,
        { score: newsImpact.score, hitCount: newsImpact.hitCount },
        technical,
        spec.bucket,
        compositeScore,
        technical.smoothedVol
      );

      const nextDayRangePct = outlookPending
        ? null
        : computeNextDayRangePct({
            compositeScore,
            historicalVol: technical.historicalVol || {
              sigmaDaily20: technical.smoothedVol?.sigma20 ?? technical.volatilityProxy,
              histVol20d: technical.smoothedVol?.sigma20 ?? technical.volatilityProxy,
              atrPct14: technical.smoothedVol?.atr14Pct ?? technical.intraday?.atrProxyPct,
              absReturnP90: technical.smoothedVol?.p90AbsReturn ?? (technical.volatilityProxy || 0.45) * 1.35,
            },
            smoothedVol: technical.smoothedVol,
            volatilityTier: profile.volatilityTier,
            newsFactor,
            newsShock: newsImpact.shock,
            newsShockCap: profile.newsShockCap,
            macroScore: macroScores.china * 0.4 + macroScores.usd * 0.3,
            techScore: technical.techScore,
            intradayChangePct: technical.intraday?.changePct ?? mergedQuote.changePct,
            sector: spec.sector,
            instrumentId: spec.id,
            vix,
            volumeRatio: technical.volume?.ratio,
            instantChannelFired: adaptive.instantFired,
          });

      let scenarios = null;
      if (nextDayRangePct) {
        const flowAligned =
          (compositeScore > 0.08 && newsImpact.score > 0.1 && (technical.volume?.ratio ?? 1) >= 1.1) ||
          (compositeScore < -0.08 && newsImpact.score < -0.1);
        scenarios = buildScenarios({
          compositeScore,
          mid: nextDayRangePct.mid,
          halfWidth: nextDayRangePct.halfWidth,
          classMax: nextDayRangePct.classMaxPct,
          newsFactor,
          shockVol: nextDayRangePct.shockVol,
          smoothedVol: technical.smoothedVol,
          flowAligned,
        });
        nextDayRangePct.scenarioPrimary = 'base';
      }

      const judgementUpdatedAt = new Date().toISOString();
      const volForecast = nextDayRangePct
        ? {
            baseline: nextDayRangePct.baselineVolPct,
            shockVol: nextDayRangePct.shockVol,
            shockWeight: nextDayRangePct.shockWeight,
            composite: nextDayRangePct.compositeVolPct,
          }
        : null;

      const confidence = computeInstrumentConfidence({
        hasLivePrice,
        hasEnough: technical.hasEnough,
        dataPoints: technical.dataPoints,
        newsHitCount: newsImpact.hitCount || 0,
        oiDelta: technical.oi?.deltaPct,
        volumeRatio: technical.volume?.ratio,
        compositeScore,
        smoothedVol: technical.smoothedVol,
        sector: spec.sector,
        instrumentId: spec.id,
        dataQuality: sourceLaneCount,
      });

      const backtestHit = outlookCalibration.getInstrumentHitRate(spec.id, 30);
      const sectorBacktestHit = outlookCalibration.getSectorHitRate(spec.sector, 30);
      const envBacktestHit = sectorBacktestHit?.rate ?? backtestHit?.rate;

      const bucketFactorScores = buildBucketFactorScores(sources, spec.bucket);
      const macroFactors = FACTOR_DEFS.map((def) => ({
        id: def.id,
        label: def.shortLabel,
        score: bucketFactorScores[def.id]?.score ?? 0,
        direction: scoreToDirection(bucketFactorScores[def.id]?.score ?? 0),
        isPrimary: def.id === 'supply' && phil.policy?.isPrimaryMatch,
      }));

      const factorBreakdownDisplay = Object.entries(factorBreakdown)
        .filter(([id, v]) => id !== 'latency' && typeof v === 'number' && Math.abs(v) >= 0.005)
        .map(([id, value]) => {
          const mult = regimeMultipliers[id];
          const label = FACTOR_BREAKDOWN_LABELS[id] || id;
          const multNote = mult != null && mult !== 1 ? ` ×${mult.toFixed(2)}` : '';
          return {
            id,
            label: `${label}${multNote}`,
            value: +value.toFixed(2),
            display: `${value >= 0 ? '+' : ''}${value.toFixed(2)}`,
            regimeMultiplier: mult,
          };
        })
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
          smoothedVol: technical.smoothedVol,
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
        : `${buildInstrumentRationale(meta, factorBreakdown, capitalAttention, newsImpact, profile)}；${adaptive.rationaleSuffix}`;

      const predictionRationale = buildPredictionRationale({
        outlookPending,
        smoothedVol: technical.smoothedVol,
        nextDayRangePct,
        scenarios,
        newsImpact,
        capitalAttention,
        latencyLabel: adaptive.latencyLabel,
        latencyState: adaptive.latencyState,
        changePct: mergedQuote.changePct,
        instantScore: adaptive.instantScore,
      });

      const klineBars = readCachedKlines(meta.id);
      const historicalContext = outlookPending
        ? {
            similarDays60: 0,
            maxAbsReturn60: null,
            avgAbsReturn20: null,
            avgNextDayPct: null,
            regimeMatchSummary: '',
            precedentSummary: '行情待加载，历史对照暂不可用',
            oftenAppears: false,
          }
        : buildHistoricalContext({
            bars: klineBars,
            predictedMid: nextDayRangePct?.mid,
            regimeLabel,
            volRegimeLabel: technical.smoothedVol?.regimeLabel,
          });

      const row = {
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
        directionLabel: directionLabelOverride || dirTier.label,
        insufficientData,
        dataQuality: sourceLaneCount,
        secondaryDominates: phil.secondaryDominates || phil.ranked?.secondaryDominates,
        backtestHitRate30d: backtestHit?.rate ?? null,
        envBacktestHitRate: envBacktestHit ?? null,
        calibrationWeights: blend,
        confidence,
        stars: confidence,
        starsHtml: starsToHtml(confidence),
        capitalAttention,
        capitalAttentionDisplay: capitalAttention.display,
        nextDayRangePct,
        scenarios,
        regime,
        regimeLabel,
        regimeTriggers: ctx.triggers,
        judgementUpdatedAt,
        judgementUpdatedDisplay: formatJudgementTime(judgementUpdatedAt),
        volForecast,
        shockVol: nextDayRangePct?.shockVol ?? null,
        compositeVolPct: nextDayRangePct?.compositeVolPct ?? null,
        smoothedVol: technical.smoothedVol,
        volForecastPct: nextDayRangePct?.compositeVolPct ?? technical.smoothedVol?.volForecastPct ?? null,
        short: horizons.short,
        medium: horizons.medium,
        long: horizons.long,
        techBadges: buildTechBadges(technical, outlookPending, {
          latencyLabel: adaptive.latencyLabel,
          latencyState: adaptive.latencyState,
        }),
        historicalContext,
        rationaleSummary: (predictionRationale || '').split('\n')[0]?.slice(0, 48) || '',
        factors,
        factorBreakdown,
        factorBreakdownDisplay,
        rationale,
        predictionRationale,
        sourceNote: technical.sourceNote,
        profileSummary: `${profile.volatilityTier}波动 · ${profile.supplyDemandType} · ${profile.tradingSession} · ${regimeLabel}`,
        wInstant: adaptive.wInstant,
        wDelayed: adaptive.wDelayed,
        instantScore: adaptive.instantScore,
        delayedScore: adaptive.delayedScore,
        instantChannel: adaptive.instantChannel,
        delayedChannel: adaptive.delayedChannel,
        latencyState: adaptive.latencyState,
        latencyLabel: adaptive.latencyLabel,
        dataVersion: lastOutlookDataVersion,
        philosophy: {
          supplyDemand: phil.supplyDemand,
          financialEnvironment: phil.financialEnvironment,
          sdFinance: phil.sdFinance,
          policy: phil.policy,
          climate: phil.climate,
          geo: phil.geo,
          oilMother: phil.oilMother,
          capitalSentiment: phil.capitalSentiment,
          priceFeedback: phil.priceFeedback,
          boj: phil.boj,
          macroChina: phil.macroChina,
          ranked: phil.ranked,
          compositeScore: phil.compositeScore,
          paradigmHint: phil.paradigmHint,
          logicSummary: phil.logicSummary,
          primaryChip: phil.ranked?.primaryChip,
          secondaryChip: phil.ranked?.secondaryChip,
          primaryDriverId: phil.ranked?.primary?.[0]?.id || 'sdFinance',
          secondaryDominates: phil.secondaryDominates || phil.ranked?.secondaryDominates,
        },
      };
      return outlookHistory.attachChangeDelta(row);
    })
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'zh-CN'));
}

function formatJudgementTime(iso) {
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '';
  }
}

function buildCommodityOutlookFromSources(sources = {}) {
  lastOutlookDataVersion += 1;
  const globalCtx = evaluateContext(sources, { sector: 'energy', bucketId: 'energy' });
  let globalFactors;
  let categories;
  let factors;
  let instruments;
  try {
    globalFactors = buildFactorScores(sources);
    categories = buildCategoryOutlooks(sources);
    factors = buildFactorsPanel(globalFactors);
    instruments = buildInstrumentOutlooks(sources, globalCtx);
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
      framework: {
        logicModel: '动态多情景+双轨波动+环境regime（部分输入异常，已降级）',
        version: OUTLOOK_ENGINE_VERSION,
        regimes: REGIME_IDS.map((id) => ({ id, label: REGIME_LABELS[id] })),
      },
      globalRegime: globalCtx.regime,
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

  const dataQuality = countOutlookDataSources(sources);
  const backtestSummary = loadBacktestSummarySafe();
  const longrunSummary = loadLongrunSummarySafe();

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
        '核心：供需×金融环境矩阵 → 主/次矛盾分级 → 现价反馈+资金情绪 → 技术/双速通道校验 → 四情景区间',
      philosophyModel: 'Price = Supply/Demand × Financial Environment（v1.26 事件加权+长周期校准）',
      philosophyMatrix: philosophy.SD_FINANCE_MATRIX,
      horizons: HORIZON_LABELS,
      factorIds: FACTOR_DEFS.map((f) => f.id),
      instrumentIds: INSTRUMENT_REGISTRY.map((i) => i.id),
      sectors: OUTLOOK_SECTORS,
      regimes: REGIME_IDS.map((id) => ({ id, label: REGIME_LABELS[id] })),
      rangeFormula: 'compositeVol=基线EMA+shockWeight×突变；情景区间按方向偏置',
      sectorClassCaps: SECTOR_CLASS_MAX_PCT,
      version: OUTLOOK_ENGINE_VERSION,
    },
    globalRegime: globalCtx.regime,
    globalRegimeLabel: globalCtx.regimeLabel,
    sectors: OUTLOOK_SECTORS,
    stats: {
      categoryCount: categories.length,
      instrumentCount: instruments.length,
      techReadyCount: techReady,
      factorCount: factors.length,
      dataQuality,
      dataQualityLabel: `${dataQuality}/8 路数据源 · ${techReady}/${instruments.length} 品种技术面就绪`,
      directionHitRate7d: outlookHistory.getDirectionHitRate7d(),
      backtestHitRate30d: backtestSummary?.overallHitRate30d ?? null,
      backtestHitRate60d: backtestSummary?.overallHitRate60d ?? null,
      longRunHitRate: longrunSummary?.overallHitRate ?? outlookCalibration.getLongRunHitRate?.() ?? null,
      longRunPeriodFrom: longrunSummary?.periodFrom ?? '2019-01-01',
      longRunPeriodTo: longrunSummary?.periodTo ?? null,
      longRunByEra: longrunSummary?.byEra ?? null,
      backtestRunAt: backtestSummary?.runAt ?? null,
      longRunRunAt: longrunSummary?.runAt ?? null,
      calibrationPath: outlookCalibration.getCalibrationPath(),
      backtestSummaryPath: (() => {
        try {
          return require('./commodity-outlook-backtest').getSummaryPath();
        } catch {
          return null;
        }
      })(),
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

async function fetchCommodityOutlookSource(sources) {
  const enriched = enrichSourcesForOutlook(sources);
  try {
    await ensurePriorityKlinesForOutlook();
  } catch {
    // continue with cached/partial klines
  }
  triggerOutlookKlineBackfill().catch(() => {});
  const payload = buildCommodityOutlookFromSources(enriched);
  lastOutlookFingerprint = computeOutlookFingerprint(enriched, enriched.commodities);
  const hist = outlookHistory.recordOutlookSnapshots(payload.instruments, {
    dataVersion: lastOutlookDataVersion,
  });
  outlookHistory.bootstrapDailyOutlook(payload.instruments);
  payload.historyArchivePath = hist.root;
  payload.stats = payload.stats || {};
  payload.stats.todayArchiveCount = outlookHistory.countTodayArchiveEntries();
  payload.stats.directionHitRate7d = outlookHistory.getDirectionHitRate7d();
  const bt = loadBacktestSummarySafe();
  const lr = loadLongrunSummarySafe();
  payload.stats.backtestHitRate30d = bt?.overallHitRate30d ?? null;
  payload.stats.backtestHitRate60d = bt?.overallHitRate60d ?? null;
  payload.stats.longRunHitRate = lr?.overallHitRate ?? outlookCalibration.getLongRunHitRate?.() ?? null;
  payload.stats.longRunByEra = lr?.byEra ?? null;
  payload.stats.calibrationPath = outlookCalibration.getCalibrationPath();
  payload.stats.dailySnapshotPath = outlookHistory.getDailySummaryPath();
  diskCache.write(OUTLOOK_DISK_KEY, { data: payload, savedAt: Date.now() });
  return payload;
}

function scheduleOutlookRecomputeOnSourcesChange(sources) {
  const enriched = enrichSourcesForOutlook(sources);
  const fp = computeOutlookFingerprint(enriched, enriched.commodities);
  if (!outlookFingerprintChanged(lastOutlookFingerprint, fp)) return null;

  if (outlookRecomputeTimer) clearTimeout(outlookRecomputeTimer);
  outlookRecomputeTimer = setTimeout(() => {
    outlookRecomputeTimer = null;
    refreshCommodityOutlookInBackground(enriched).catch(() => {});
  }, OUTLOOK_RECOMPUTE_DEBOUNCE_MS);
  return refreshCommodityOutlookInBackground;
}

function notifyOutlookSourcesRefreshed(sources) {
  return scheduleOutlookRecomputeOnSourcesChange(sources);
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
      return Promise.resolve({ ...cached, fromCache: true });
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
  REGIME_IDS,
  REGIME_LABELS,
  REGIME_FACTOR_MULTIPLIERS,
  buildInstrumentRegistryFromCatalog,
  buildCommodityOutlookFromSources,
  fetchCommodityOutlookSource,
  getCachedCommodityOutlookSource,
  fetchCommodityOutlookLive,
  refreshCommodityOutlookInBackground,
  scheduleOutlookRecomputeOnSourcesChange,
  notifyOutlookSourcesRefreshed,
  triggerOutlookKlineBackfill,
  ensurePriorityKlinesForOutlook,
  evaluateContext,
  buildScenarios,
  computeVolBias,
  computeNextDayRangePct,
  computeCapitalAttention,
  buildFactorBreakdown,
  getClassMaxPct,
  SECTOR_CLASS_MAX_PCT,
  directionArrow,
  directionLabel,
  starsToHtml,
  formatJudgementTime,
  buildPredictionRationale,
  buildHistoricalContext,
  OUTLOOK_ENGINE_VERSION,
  scoreToDirection,
  buildMacroScoresForInstrument,
  parseVix,
  countOutlookDataSources,
  philosophy,
};
