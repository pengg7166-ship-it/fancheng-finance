const crypto = require('crypto');
const Parser = require('rss-parser');
const { fetchText } = require('./http-client');
const diskCache = require('./disk-cache');
const {
  CLIMATE_RSS_FEEDS,
  CLIMATE_SEARCH_QUERIES,
  CLIMATE_RELEVANCE_KEYWORDS,
  CLIMATE_REGIONS,
  CLIMATE_DIMENSIONS,
} = require('./climate-sources');
const { scoreClimateItem, buildCategoryGroups, buildStats } = require('./climate-scorer');
const { buildClimateAnalysis } = require('./climate-analyst');
const { enrichClimateCommodities } = require('./climate-commodity-bridge');
const { buildCommodityIntelligence } = require('./policy-commodity-intelligence');
const { getGlobalNewsPoolSync } = require('./commodities-news');
const { translateNewsOffline, isMostlyEnglish } = require('./offline-translate');
const { translateFinanceHeadline } = require('./finance-headline-translate');

const CLIMATE_DISK_KEY = 'climate-radar.json';
const CLIMATE_DISK_TTL_MS = 120 * 1000;
const CLIMATE_PAYLOAD_ITEM_LIMIT = 120;
const CLIMATE_SEARCH_QUERY_LIMIT = 14;
const RSS_TIMEOUT_MS = 8000;

const parser = new Parser({
  timeout: RSS_TIMEOUT_MS,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FanchengFinance/1.13',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

const EM_HEADERS = {
  Referer: 'https://finance.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

let liveRefreshPromise = null;

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashItem(item) {
  return crypto.createHash('md5').update(`${item.title}|${item.link}|${item.pubDate}`).digest('hex');
}

function ensureChinese(text) {
  const raw = String(text || '').trim();
  if (!raw || !isMostlyEnglish(raw)) return raw;
  const offline = translateNewsOffline(raw);
  if (offline && !isMostlyEnglish(offline)) return offline;
  const finance = translateFinanceHeadline(raw);
  return finance && /[\u4e00-\u9fff]/.test(finance) ? finance : offline || raw;
}

function isClimateRelevant(text) {
  if (!text || text.length < 6) return false;
  const lower = text.toLowerCase();
  return CLIMATE_RELEVANCE_KEYWORDS.some((k) => {
    const lk = k.toLowerCase();
    return lower.includes(lk) || text.includes(k);
  });
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function fetchEastmoneySearch(keyword, limit = 8) {
  const param = encodeURIComponent(
    JSON.stringify({
      uid: '',
      keyword,
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      pageIndex: 1,
      pageSize: limit,
    })
  );
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=j&param=${param}`;
  const text = await fetchText(url, { headers: EM_HEADERS, timeout: 8000, retries: 1 });
  const json = JSON.parse(text.replace(/^j\(/, '').replace(/\)$/, ''));
  return (json?.result?.cmsArticleWebOld || []).map((row) => ({
    title: stripHtml(row.title || row.shortTitle || ''),
    link: row.url || '',
    pubDate: row.date || row.showTime || '',
    summary: stripHtml(row.content || row.digest || '').slice(0, 220),
    source: 'eastmoney-search',
    sourceName: '东方财富·气候',
    sourceTier: 'primary',
    lang: 'zh',
    feedRegion: 'domestic',
  }));
}

async function fetchRssFeed(feed) {
  try {
    const parsed = await withTimeout(parser.parseURL(feed.url), RSS_TIMEOUT_MS, null);
    if (!parsed?.items?.length) return [];
    return parsed.items.slice(0, 16).map((item) => ({
      title: stripHtml(item.title || ''),
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || '',
      summary: stripHtml(item.contentSnippet || item.summary || '').slice(0, 220),
      source: feed.id,
      sourceName: feed.name,
      sourceTier: feed.lang === 'zh' ? 'primary' : 'international',
      lang: feed.lang || 'en',
      feedRegion: feed.region || 'global',
      needsTranslate: feed.translate || feed.lang === 'en',
    }));
  } catch {
    return [];
  }
}

async function fetchSearchBundle() {
  const queries = CLIMATE_SEARCH_QUERIES.slice(0, CLIMATE_SEARCH_QUERY_LIMIT);
  const batchSize = 6;
  const all = [];
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const parts = await Promise.allSettled(
      batch.map((q) => withTimeout(fetchEastmoneySearch(q, 5), 5500, []))
    );
    for (const p of parts) {
      if (p.status === 'fulfilled') all.push(...p.value);
    }
  }
  return all;
}

async function fetchAllClimateRaw() {
  const [rssParts, searchItems] = await Promise.all([
    Promise.allSettled(CLIMATE_RSS_FEEDS.map((f) => fetchRssFeed(f))),
    withTimeout(fetchSearchBundle(), 12000, []),
  ]);

  let items = [...searchItems];
  for (const p of rssParts) {
    if (p.status === 'fulfilled') items = items.concat(p.value);
  }

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = (item.link || item.title || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function normalizeItem(raw) {
  let title = ensureChinese(raw.title);
  let summary = raw.summary ? ensureChinese(raw.summary) : '';
  const text = `${title} ${summary}`;

  if (!isClimateRelevant(text)) return null;

  const scored = scoreClimateItem({ ...raw, title, summary });
  const item = {
    id: hashItem({ title, link: raw.link, pubDate: raw.pubDate }),
    title,
    link: raw.link,
    pubDate: raw.pubDate,
    summary,
    source: raw.source,
    sourceName: raw.sourceName,
    lang: raw.lang || 'zh',
    ...scored,
  };

  if (item.needsAnalysis) {
    item.analysis = buildClimateAnalysis(item);
  }

  Object.assign(item, enrichClimateCommodities(item));

  return item;
}

function dedupeAndSort(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.sort((a, b) => {
    const starDiff = (b.stars || 0) - (a.stars || 0);
    if (starDiff !== 0) return starDiff;
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });
}

function buildClimateCommodityLinkage(climateItems) {
  const linked = climateItems.filter((i) => i.commodityLinked);
  const intel = buildCommodityIntelligence([], [], getGlobalNewsPoolSync(), [], climateItems);
  return {
    linkedCount: linked.length,
    commodityCount: intel.catalog.filter((c) => (c.climateNewsCount || 0) > 0).length,
    topCommodities: intel.catalog.filter((c) => (c.climateNewsCount || 0) > 0).slice(0, 12),
    feeds: intel.feeds,
    summary: intel.summary,
    updatedAt: new Date().toISOString(),
  };
}

async function buildClimatePayload(rawItems) {
  const normalized = rawItems.map(normalizeItem).filter(Boolean);
  const items = dedupeAndSort(normalized).slice(0, CLIMATE_PAYLOAD_ITEM_LIMIT);
  const groups = buildCategoryGroups(items);
  const stats = buildStats(items);
  const commodityLinkage = buildClimateCommodityLinkage(items);

  return {
    key: 'climate',
    name: '天气气候',
    dataLabel: '全球天气气候雷达 · 农业/矿山物流/宏观传导 · 大宗关联',
    items,
    groups,
    framework: {
      dimensions: CLIMATE_DIMENSIONS.map((d) => ({
        id: d.id,
        label: d.label,
        shortLabel: d.shortLabel,
        icon: d.icon,
        description: d.description,
        count: stats.dimensions?.find((x) => x.id === d.id)?.count || 0,
      })),
      logicModel: '气候事件 → 传导机制 → 大宗商品影响',
    },
    catalog: {
      regions: CLIMATE_REGIONS,
      dimensions: CLIMATE_DIMENSIONS,
    },
    stats,
    commodityLinkage,
    sources: [...CLIMATE_RSS_FEEDS.map((f) => f.name), '东方财富·气候检索'],
    updatedAt: new Date().toISOString(),
    liveRefreshedAt: new Date().toISOString(),
  };
}

async function fetchClimateSource() {
  const raw = await fetchAllClimateRaw();
  const payload = await buildClimatePayload(raw);
  diskCache.write(CLIMATE_DISK_KEY, { data: payload, savedAt: Date.now() });
  return payload;
}

function getCachedClimateSource() {
  const stored = diskCache.readStale(CLIMATE_DISK_KEY);
  if (!stored?.data?.items?.length) return null;
  if (Date.now() - (stored.savedAt || 0) > CLIMATE_DISK_TTL_MS * 10) return stored.data;
  return stored.data;
}

async function fetchClimateLive({ force = false } = {}) {
  if (!force) {
    const cached = getCachedClimateSource();
    if (cached?.items?.length) {
      if (Date.now() - (diskCache.readStale(CLIMATE_DISK_KEY)?.savedAt || 0) > CLIMATE_DISK_TTL_MS) {
        refreshClimateInBackground();
      }
      return { ...cached, fromCache: true };
    }
  }
  return fetchClimateSource();
}

function refreshClimateInBackground() {
  if (liveRefreshPromise) return liveRefreshPromise;
  liveRefreshPromise = fetchClimateSource()
    .catch(() => null)
    .finally(() => {
      liveRefreshPromise = null;
    });
  return liveRefreshPromise;
}

module.exports = {
  fetchClimateSource,
  fetchClimateLive,
  getCachedClimateSource,
  refreshClimateInBackground,
  buildClimatePayload,
};
