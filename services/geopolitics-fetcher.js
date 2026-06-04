const crypto = require('crypto');
const Parser = require('rss-parser');
const { fetchText } = require('./http-client');
const diskCache = require('./disk-cache');
const {
  GEOPOLITICS_RSS_FEEDS,
  GEOPOLITICS_SEARCH_QUERIES,
  GEOPOLITICS_RELEVANCE_KEYWORDS,
  REGIONS,
  COUNTRIES,
  COMPETITION_DIMENSIONS,
} = require('./geopolitics-sources');
const { scoreGeopoliticsItem, buildRegionGroups, buildCountryIndex, buildStats } = require('./geopolitics-scorer');
const { buildGeopoliticsCommentary } = require('./geopolitics-commentary');
const { enrichGeopoliticsCommodities } = require('./geopolitics-commodity-bridge');
const { buildCommodityIntelligence } = require('./policy-commodity-intelligence');
const { getGlobalNewsPoolSync } = require('./commodities-news');
const { translateNewsOffline, isMostlyEnglish } = require('./offline-translate');
const { translateFinanceHeadline } = require('./finance-headline-translate');

const GEO_DISK_KEY = 'geopolitics-radar.json';
const GEO_DISK_TTL_MS = 90 * 1000;
const RSS_TIMEOUT_MS = 8000;

const parser = new Parser({
  timeout: RSS_TIMEOUT_MS,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FanchengFinance/1.10',
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

function isGeoRelevant(text) {
  if (!text || text.length < 6) return false;
  const lower = text.toLowerCase();
  return GEOPOLITICS_RELEVANCE_KEYWORDS.some((k) => {
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
    sourceName: '东方财富·国际',
    sourceTier: 'primary',
    lang: 'zh',
  }));
}

async function fetchRssFeed(feed) {
  try {
    const parsed = await withTimeout(parser.parseURL(feed.url), RSS_TIMEOUT_MS, null);
    if (!parsed?.items?.length) return [];
    return parsed.items.slice(0, 18).map((item) => ({
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
  const queries = GEOPOLITICS_SEARCH_QUERIES.slice(0, 24);
  const batchSize = 8;
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

async function fetchAllGeopoliticsRaw() {
  const [rssParts, searchItems] = await Promise.all([
    Promise.allSettled(GEOPOLITICS_RSS_FEEDS.map((f) => fetchRssFeed(f))),
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

  if (!isGeoRelevant(text)) return null;

  const scored = scoreGeopoliticsItem(raw);
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

  if (item.needsCommentary || item.needsAnalysis) {
    item.analysis = buildGeopoliticsCommentary(item);
    item.commentary = item.analysis?.summary || '';
  }

  Object.assign(item, enrichGeopoliticsCommodities(item));

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

async function buildGeopoliticsPayload(rawItems) {
  const normalized = rawItems.map(normalizeItem).filter(Boolean);
  const items = dedupeAndSort(normalized);
  const groups = buildRegionGroups(items);
  const countryIndex = buildCountryIndex(items);
  const stats = buildStats(items);
  const commodityLinkage = buildGeoCommodityLinkage(items);

  return {
    key: 'geopolitics',
    name: '地缘政治',
    dataLabel: '全球地缘政治雷达 · 四维竞争 · 逻辑链分析',
    items,
    groups,
    countryIndex,
    framework: {
      dimensions: COMPETITION_DIMENSIONS.map((d) => ({
        id: d.id,
        label: d.label,
        shortLabel: d.shortLabel,
        icon: d.icon,
        description: d.description,
        count: stats.dimensions?.find((x) => x.id === d.id)?.count || 0,
      })),
      logicModel: '事件 → 机制传导 → 市场/政策外溢（附学者框架引述）',
    },
    catalog: {
      regions: REGIONS,
      countries: COUNTRIES.map((c) => ({
        id: c.id,
        name: c.name,
        flag: c.flag,
        region: c.region,
        baseInfluence: c.baseInfluence,
      })),
    },
    stats,
    commodityLinkage,
    sources: [
      ...GEOPOLITICS_RSS_FEEDS.map((f) => f.name),
      '东方财富·检索',
    ],
    updatedAt: new Date().toISOString(),
    liveRefreshedAt: new Date().toISOString(),
  };
}

function buildGeoCommodityLinkage(geoItems) {
  const linked = geoItems.filter((i) => i.commodityLinked);
  const intel = buildCommodityIntelligence([], [], getGlobalNewsPoolSync(), geoItems);
  return {
    linkedCount: linked.length,
    commodityCount: intel.catalog.filter((c) => c.geoNewsCount > 0).length,
    topCommodities: intel.catalog.filter((c) => c.geoNewsCount > 0).slice(0, 12),
    feeds: intel.feeds,
    summary: intel.summary,
    updatedAt: new Date().toISOString(),
  };
}

function syncPolicyCommodityIntelWithGeo(geoItems) {
  try {
    const policyStored = diskCache.readStale('policy-radar.json');
    if (!policyStored?.data) return;
    const policyItems = policyStored.data.items || [];
    const intel = buildCommodityIntelligence(
      policyItems,
      [],
      getGlobalNewsPoolSync(),
      geoItems
    );
    policyStored.data.commodityIntel = {
      catalog: intel.catalog,
      summary: intel.summary,
      updatedAt: intel.updatedAt,
      geoFeeds: Object.fromEntries(
        Object.entries(intel.feeds || {}).map(([id, feed]) => [id, { geoNews: feed.geoNews || [] }])
      ),
    };
    diskCache.write('policy-radar.json', { data: policyStored.data, savedAt: Date.now() });
  } catch {
    // ignore
  }
}

async function fetchGeopoliticsSource() {
  const raw = await fetchAllGeopoliticsRaw();
  const payload = await buildGeopoliticsPayload(raw);
  diskCache.write(GEO_DISK_KEY, { data: payload, savedAt: Date.now() });
  syncPolicyCommodityIntelWithGeo(payload.items);
  return payload;
}

function getCachedGeopoliticsSource() {
  const stored = diskCache.readStale(GEO_DISK_KEY);
  if (!stored?.data?.items?.length) return null;
  if (Date.now() - (stored.savedAt || 0) > GEO_DISK_TTL_MS * 10) return stored.data;
  return stored.data;
}

async function fetchGeopoliticsLive({ force = false } = {}) {
  if (!force) {
    const cached = getCachedGeopoliticsSource();
    if (cached?.items?.length) {
      if (Date.now() - (diskCache.readStale(GEO_DISK_KEY)?.savedAt || 0) > GEO_DISK_TTL_MS) {
        refreshGeopoliticsInBackground();
      }
      return { ...cached, fromCache: true };
    }
  }
  return fetchGeopoliticsSource();
}

function refreshGeopoliticsInBackground() {
  if (liveRefreshPromise) return liveRefreshPromise;
  liveRefreshPromise = fetchGeopoliticsSource()
    .catch(() => null)
    .finally(() => {
      liveRefreshPromise = null;
    });
  return liveRefreshPromise;
}

module.exports = {
  fetchGeopoliticsSource,
  fetchGeopoliticsLive,
  getCachedGeopoliticsSource,
  refreshGeopoliticsInBackground,
  buildGeopoliticsPayload,
};
