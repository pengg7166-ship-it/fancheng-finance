const Parser = require('rss-parser');
const { getFredApiKey, isFredApiKeyConfigured } = require('./config');
const { localizeErrorMessage } = require('./translate');
const { translateNewsOffline, isMostlyEnglish } = require('./offline-translate');
const { fetchGlobalIndices, fetchGlobalIndicesSinaOnly } = require('./indices-fetcher');
const { fetchMacroSource, getCachedMacroSource } = require('./macro-fetcher');
const { fetchForexSource, getCachedForexSource } = require('./forex-fetcher');
const { fetchPolicySource, getCachedPolicySource } = require('./policy-fetcher');
const { fetchGeopoliticsSource, getCachedGeopoliticsSource } = require('./geopolitics-fetcher');
const { fetchClimateSource, getCachedClimateSource } = require('./climate-fetcher');
const {
  buildCommodityOutlookFromSources,
  getCachedCommodityOutlookSource,
  fetchCommodityOutlookSource,
} = require('./commodity-outlook-engine');
const { fetchBojSource, getCachedBojSource, ensureBojPayloadLocalized } = require('./boj-fetcher');
const { fetchFedSpeeches } = require('./cb-speeches');
const { fetchFredBatch } = require('./fred-client');
const { fetchFedIndicators: fetchFedIndicatorsRich } = require('./fed-indicators-fetcher');
const diskCache = require('./disk-cache');

const DATA_CACHE_TTL_MS = 3 * 60 * 1000;
const DISK_CACHE_KEY = 'all-data.json';
const RSS_TIMEOUT_MS = 6000;
const SOURCE_TIMEOUT_MS = 8000;
const INDICES_TIMEOUT_MS = 25000;
const HTTP_TIMEOUT_MS = 6000;

let dataCache = { at: 0, payload: null };
let refreshPromise = null;
let onBackgroundRefresh = null;
let diskHydrated = false;

function hydrateFromDisk() {
  if (diskHydrated) return;
  diskHydrated = true;
  const stored = diskCache.readStale(DISK_CACHE_KEY);
  if (stored?.payload) {
    dataCache = {
      at: stored.savedAt || stored._mtime || Date.now(),
      payload: stored.payload,
    };
  }
}

function sourceHasData(source) {
  if (!source) return false;
  if (source.regions?.some((r) => r.indices?.length)) return true;
  if (source.groups?.some((g) => g.indicators?.length)) return true;
  if (source.groups?.some((g) => g.pairs?.length)) return true;
  if (source.pairs?.length) return true;
  if (source.items?.length) return true;
  if (source.categories?.length) return true;
  if (source.factors?.length) return true;
  if (source.news?.length) return true;
  if (source.speeches?.length) return true;
  if (source.indicators?.length) return true;
  return false;
}

function mergePayloads(prev, next) {
  if (!prev?.sources) return next;
  const sources = { ...prev.sources };
  for (const [key, val] of Object.entries(next.sources || {})) {
    if (sourceHasData(val)) {
      sources[key] = val;
    } else if (!sources[key]) {
      sources[key] = val;
    }
  }
  return {
    ...next,
    sources,
    errors: next.errors?.length ? next.errors : prev.errors || [],
    fetchedAt: next.fetchedAt || prev.fetchedAt,
    fredApiKeyConfigured: next.fredApiKeyConfigured ?? prev.fredApiKeyConfigured,
  };
}

function payloadHasCacheableData(payload) {
  if (!payload?.sources) return false;
  return Object.values(payload.sources).some(sourceHasData);
}

function persistToDisk(payload) {
  const stale = diskCache.readStale(DISK_CACHE_KEY);
  const merged = mergePayloads(stale?.payload, payload);
  if (!payloadHasCacheableData(merged)) return;
  diskCache.write(DISK_CACHE_KEY, { payload: merged });
  dataCache = { at: Date.now(), payload: merged };
}

function flushDataCacheToDisk() {
  hydrateFromDisk();
  if (dataCache.payload && payloadHasCacheableData(dataCache.payload)) {
    persistToDisk(dataCache.payload);
  }
}

const parser = new Parser({
  timeout: RSS_TIMEOUT_MS,
  headers: {
    'User-Agent': 'FanchengFinance/1.0 (Desktop App)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

const FRED_SERIES = [
  { id: 'DFF', name: '联邦基金利率', unit: '%' },
  { id: 'DGS10', name: '10年期国债收益率', unit: '%' },
  { id: 'DGS2', name: '2年期国债收益率', unit: '%' },
  { id: 'T10Y2Y', name: '10年-2年利差', unit: '%' },
  { id: 'DEXCHUS', name: '美元/人民币汇率', unit: '人民币' },
  { id: 'UNRATE', name: '美国失业率', unit: '%' },
  { id: 'CPIAUCSL', name: '消费者物价指数', unit: '指数' },
  { id: 'M2SL', name: 'M2 货币供应量', unit: '十亿美元' },
  { id: 'VIXCLS', name: '波动率恐慌指数', unit: '' },
];

async function fetchFedIndicators(options = {}) {
  return fetchFedIndicatorsRich(options);
}

const SOURCES = {
  fed: {
    name: '美联储',
    newsUrl: 'https://www.federalreserve.gov/feeds/press_all.xml',
    dataLabel: '关键经济指标（圣路易斯联储）',
  },
  treasury: {
    name: '美国财政部',
    newsUrl: 'https://home.treasury.gov/system/files/136/TreasuryRSS.xml',
    dataLabel: '国债与汇率参考',
  },
  xinhua: {
    name: '新华社',
    newsUrl: 'http://www.xinhuanet.com/fortune/news_fortune.xml',
    fallbackUrls: [
      'http://www.xinhuanet.com/politics/news_politics.xml',
      'http://www.news.cn/fortune/news_fortune.xml',
    ],
    dataLabel: '财经要闻',
  },
  indices: {
    name: '全球指数',
    dataLabel: '主流大盘指数',
  },
  macro: {
    name: '中美宏观',
    dataLabel: '投资决策核心宏观指标',
  },
  forex: {
    name: '外汇',
    dataLabel: '美元指数与主要货币对实时汇率',
  },
  policy: {
    name: '政策雷达',
    dataLabel: '部委政策与产业影响雷达',
  },
  geopolitics: {
    name: '地缘政治',
    dataLabel: '全球地缘政治雷达 · 按区域与影响力追踪',
  },
  climate: {
    name: '天气气候',
    dataLabel: '全球天气气候雷达 · 农业/矿山物流/宏观传导',
  },
  outlook: {
    name: '大宗走势研判',
    dataLabel: '大宗商品走势研判 · 逐品种多因子 · 次日波动区间',
  },
  boj: {
    name: '日本央行',
    dataLabel: '日本货币政策与核心指标（日本央行 · FRED · 新浪）',
  },
};

async function fetchRss(url, fallbacks = []) {
  const urls = [url, ...fallbacks];
  for (const feedUrl of urls) {
    try {
      const feed = await Promise.race([
        parser.parseURL(feedUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('RSS 超时')), RSS_TIMEOUT_MS)),
      ]);
      return (feed.items || []).slice(0, 20).map((item) => ({
        title: stripHtml(item.title || '无标题'),
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || '',
        summary: stripHtml(item.contentSnippet || item.summary || '').slice(0, 200),
      }));
    } catch {
      // try next URL
    }
  }
  return [];
}

async function fetchFredSeries(seriesId) {
  const { fetchFredSeries: fetchOne } = require('./fred-client');
  return fetchOne(seriesId);
}

async function fetchTreasuryIndicators() {
  // Treasury fiscal data via Fiscal Data API (no key required)
  const endpoints = [
    {
      name: '联邦债务总额',
      url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1',
      field: 'tot_pub_debt_out_amt',
      format: (v) => `${(parseFloat(v) / 1e12).toFixed(2)} 万亿美元`,
    },
    {
      name: '10年期国债收益率',
      url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?filter=security_desc:eq:Treasury%20Notes&sort=-record_date&page[size]=1',
      field: 'avg_interest_rate_amt',
      format: (v) => `${parseFloat(v).toFixed(2)}%`,
    },
  ];

  const indicators = [];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (!res.ok) continue;
      const json = await res.json();
      const row = json.data?.[0];
      if (!row) continue;
      indicators.push({
        name: ep.name,
        value: ep.format(row[ep.field]),
        date: row.record_date,
        formatted: true,
      });
    } catch {
      // skip failed endpoint
    }
  }
  return indicators;
}

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function localizeNewsFast(news) {
  if (!news?.length) return news;
  return news.map((item) => ({
    ...item,
    title: isMostlyEnglish(item.title) ? translateNewsOffline(item.title) || item.title : item.title,
    summary:
      item.summary && isMostlyEnglish(item.summary)
        ? translateNewsOffline(item.summary).slice(0, 200)
        : item.summary || '',
  }));
}

function emptySource(key) {
  return {
    key,
    name: SOURCES[key].name,
    news: [],
    indicators: [],
    regions: key === 'indices' ? [] : undefined,
    groups:
      key === 'macro' || key === 'forex' || key === 'policy' || key === 'geopolitics' || key === 'climate'
        ? []
        : undefined,
    pairs: key === 'forex' ? [] : undefined,
    categories: key === 'outlook' ? [] : undefined,
    instruments: key === 'outlook' ? [] : undefined,
    factors: key === 'outlook' ? [] : undefined,
    items: key === 'policy' || key === 'geopolitics' || key === 'climate' ? [] : undefined,
    dataLabel: SOURCES[key].dataLabel,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchSourceWithTimeout(key, options = {}) {
  const timeoutMs =
    key === 'indices'
      ? INDICES_TIMEOUT_MS
      : key === 'macro'
        ? 45000
        : key === 'forex'
          ? 15000
          : key === 'policy'
            ? 30000
            : key === 'geopolitics'
              ? 35000
              : key === 'climate'
                ? 35000
                : key === 'fed' || key === 'boj'
              ? 25000
              : SOURCE_TIMEOUT_MS;
  return Promise.race([
    fetchSource(key, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${SOURCES[key].name}加载超时`)), timeoutMs)
    ),
  ]);
}

async function fetchSource(key, options = {}) {
  const source = SOURCES[key];

  if (key === 'indices') {
    const indexData = options.sinaOnly
      ? await fetchGlobalIndicesSinaOnly()
      : await fetchGlobalIndices();
    return {
      key,
      name: source.name,
      news: [],
      indicators: [],
      regions: indexData.regions,
      indexStats: {
        total: indexData.total,
        success: indexData.success,
        failed: indexData.failed,
      },
      dataLabel: source.dataLabel,
      updatedAt: new Date().toISOString(),
    };
  }

  if (key === 'macro') {
    const cached = !options.force ? getCachedMacroSource() : null;
    if (cached?.groups?.length) {
      fetchMacroSource().catch(() => {});
      return { ...cached, fromCache: true };
    }
    return fetchMacroSource();
  }

  if (key === 'forex') {
    const cached = !options.force ? getCachedForexSource() : null;
    if (cached?.pairs?.length) {
      fetchForexSource().catch(() => {});
      return { ...cached, fromCache: true };
    }
    return fetchForexSource();
  }

  if (key === 'policy') {
    const cached = !options.force ? getCachedPolicySource() : null;
    if (cached?.items?.length) {
      fetchPolicySource().catch(() => {});
      return { ...cached, fromCache: true };
    }
    return fetchPolicySource();
  }

  if (key === 'geopolitics') {
    const cached = !options.force ? getCachedGeopoliticsSource() : null;
    if (cached?.items?.length) {
      fetchGeopoliticsSource().catch(() => {});
      return { ...cached, fromCache: true };
    }
    return fetchGeopoliticsSource();
  }

  if (key === 'climate') {
    const cached = !options.force ? getCachedClimateSource() : null;
    if (cached?.items?.length) {
      fetchClimateSource().catch(() => {});
      return { ...cached, fromCache: true };
    }
    return fetchClimateSource();
  }

  if (key === 'boj') {
    const cached = !options.force ? getCachedBojSource() : null;
    if (cached?.indicators?.length || cached?.news?.length) {
      fetchBojSource().catch(() => {});
      return { ...ensureBojPayloadLocalized(cached), fromCache: true };
    }
    return fetchBojSource();
  }

  const [news, indicators, speechesRaw] = await Promise.all([
    fetchRss(source.newsUrl, source.fallbackUrls || []),
    key === 'fed'
      ? fetchFedIndicators({ force: Boolean(options.force) })
      : key === 'treasury'
        ? fetchTreasuryIndicators()
        : Promise.resolve([]),
    key === 'fed' ? fetchFedSpeeches().catch(() => []) : Promise.resolve([]),
  ]);

  const localizedNews = key === 'xinhua' ? news : localizeNewsFast(news);

  return {
    key,
    name: source.name,
    news: localizedNews,
    speeches: key === 'fed' ? speechesRaw : undefined,
    indicators,
    dataLabel: source.dataLabel,
    updatedAt: new Date().toISOString(),
  };
}

async function refreshAllData() {
  const keys = ['indices', 'macro', 'forex', 'policy', 'geopolitics', 'climate', 'fed', 'treasury', 'boj', 'xinhua'];
  const results = await Promise.allSettled(keys.map((key) => fetchSourceWithTimeout(key)));

  const sources = {};
  const errors = [];

  results.forEach((result, i) => {
    const key = keys[i];
    if (result.status === 'fulfilled') {
      sources[key] = result.value;
    } else {
      errors.push({ key, message: localizeErrorMessage(result.reason?.message || '未知错误') });
      sources[key] = {
        key,
        name: SOURCES[key].name,
        news: [],
        indicators: [],
        regions: key === 'indices' ? [] : undefined,
    groups:
      key === 'macro' || key === 'forex' || key === 'policy' || key === 'geopolitics' || key === 'climate'
        ? []
        : undefined,
    pairs: key === 'forex' ? [] : undefined,
    items: key === 'policy' || key === 'geopolitics' || key === 'climate' ? [] : undefined,
        dataLabel: SOURCES[key].dataLabel,
        updatedAt: new Date().toISOString(),
        error: localizeErrorMessage(result.reason?.message),
      };
    }
  });

  try {
    sources.outlook = fetchCommodityOutlookSource(sources);
  } catch {
    sources.outlook = {
      key: 'outlook',
      name: SOURCES.outlook.name,
      dataLabel: SOURCES.outlook.dataLabel,
      categories: [],
      instruments: [],
      factors: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const payload = {
    sources,
    errors,
    fetchedAt: new Date().toISOString(),
    fredApiKeyConfigured: isFredApiKeyConfigured(),
  };

  dataCache = { at: Date.now(), payload };
  if (payloadHasCacheableData(payload)) {
    persistToDisk(withLocalizedBojSources(payload));
  }
  return withLocalizedBojSources(payload);
}

function scheduleBackgroundRefresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshAllData()
    .then((payload) => {
      if (typeof onBackgroundRefresh === 'function') onBackgroundRefresh(payload);
      return payload;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function withLocalizedBojSources(payload) {
  if (!payload?.sources?.boj) return payload;
  return {
    ...payload,
    sources: {
      ...payload.sources,
      boj: ensureBojPayloadLocalized(payload.sources.boj),
    },
  };
}

function getCachedAllData() {
  hydrateFromDisk();
  if (!dataCache.payload) return null;
  const indexSuccess = dataCache.payload.sources?.indices?.indexStats?.success || 0;
  const hasIndexRows = dataCache.payload.sources?.indices?.regions?.some((r) => r.indices?.length);
  if (!hasIndexRows && indexSuccess === 0 && Date.now() - dataCache.at > 60 * 1000) {
    return null;
  }
  return withLocalizedBojSources({
    sources: dataCache.payload.sources || {},
    errors: dataCache.payload.errors || [],
    fetchedAt: dataCache.payload.fetchedAt || new Date(dataCache.at).toISOString(),
    fredApiKeyConfigured: isFredApiKeyConfigured(),
    fromCache: true,
  });
}

async function fetchAllData({ force = false, fast = false } = {}) {
  hydrateFromDisk();
  const age = Date.now() - dataCache.at;
  const cached = dataCache.payload;

  if (!force && cached) {
    if (age > DATA_CACHE_TTL_MS) scheduleBackgroundRefresh();
    return {
      ...cached,
      fromCache: true,
      cacheRoot: diskCache.getRoot(),
    };
  }

  if (fast && !force && !cached) {
    let indices = emptySource('indices');
    const indexErrors = [];
    try {
      indices = await fetchSourceWithTimeout('indices', { sinaOnly: true });
    } catch (err) {
      indices = emptySource('indices');
      indexErrors.push({
        key: 'indices',
        message: localizeErrorMessage(err.message || '全球指数加载失败'),
      });
    }

    const hasIndices = indices.regions?.some((r) => r.indices?.length);
    const payload = {
      sources: {
        indices,
        fed: emptySource('fed'),
        treasury: emptySource('treasury'),
        xinhua: emptySource('xinhua'),
        macro: emptySource('macro'),
        forex: emptySource('forex'),
        policy: emptySource('policy'),
        geopolitics: emptySource('geopolitics'),
        climate: emptySource('climate'),
        boj: emptySource('boj'),
        outlook: emptySource('outlook'),
      },
      errors: indexErrors,
      fetchedAt: new Date().toISOString(),
      fredApiKeyConfigured: isFredApiKeyConfigured(),
      partial: hasIndices,
    };

    if (hasIndices) {
      dataCache = { at: Date.now(), payload: mergePayloads(dataCache.payload, payload) };
      persistToDisk(dataCache.payload);
    }

    scheduleBackgroundRefresh();
    return payload;
  }

  return refreshAllData();
}

function invalidateDataCache() {
  dataCache = { at: 0, payload: null };
  diskCache.remove(DISK_CACHE_KEY);
}

function initDataCacheFromDisk() {
  hydrateFromDisk();
}

function setDataRefreshListener(fn) {
  onBackgroundRefresh = fn;
}

async function fetchIndicesLive() {
  const data = await fetchSource('indices');
  return { ...data, fetchedAt: new Date().toISOString() };
}

async function fetchIndicesQuick() {
  hydrateFromDisk();
  const cached = getCachedAllData();
  if (cached?.sources?.indices?.regions?.some((r) => r.indices?.length)) {
    return { ...cached.sources.indices, fromCache: true };
  }
  const data = await fetchSourceWithTimeout('indices', { sinaOnly: true });
  if (data.regions?.some((r) => r.indices?.length)) {
    persistToDisk({
      sources: { indices: data },
      errors: dataCache.payload?.errors || [],
      fetchedAt: new Date().toISOString(),
      fredApiKeyConfigured: isFredApiKeyConfigured(),
    });
  }
  return { ...data, fetchedAt: new Date().toISOString() };
}

function patchSourceInCache(key, source) {
  hydrateFromDisk();
  const normalized =
    key === 'boj' ? ensureBojPayloadLocalized(source) : source;
  const prev = dataCache.payload || {
    sources: {},
    errors: [],
    fetchedAt: new Date().toISOString(),
    fredApiKeyConfigured: isFredApiKeyConfigured(),
  };
  const payload = {
    ...prev,
    sources: { ...prev.sources, [key]: normalized },
    fetchedAt: new Date().toISOString(),
    fredApiKeyConfigured: isFredApiKeyConfigured(),
  };
  dataCache = { at: Date.now(), payload };
  if (sourceHasData(normalized)) persistToDisk(payload);
  return payload;
}

async function fetchFedLive() {
  const prevFed = getCachedAllData()?.sources?.fed;
  const [data, speeches] = await Promise.all([
    fetchSourceWithTimeout('fed', { force: false }),
    fetchFedSpeeches().catch(() => null),
  ]);
  const indicators =
    data.indicators?.length > 0
      ? data.indicators
      : prevFed?.indicators?.length
        ? prevFed.indicators
        : await fetchFedIndicators({ force: true }).catch(() => []);
  const merged = {
    ...data,
    indicators,
    speeches: speeches?.length ? speeches : data.speeches || prevFed?.speeches || [],
    liveRefreshedAt: new Date().toISOString(),
  };
  patchSourceInCache('fed', merged);
  return merged;
}

let fedRefreshPromise = null;
function refreshFedInBackground() {
  if (fedRefreshPromise) return fedRefreshPromise;
  fedRefreshPromise = fetchFedLive()
    .catch(() => null)
    .finally(() => {
      fedRefreshPromise = null;
    });
  return fedRefreshPromise;
}

module.exports = {
  fetchAllData,
  fetchIndicesLive,
  fetchIndicesQuick,
  fetchFedLive,
  refreshFedInBackground,
  patchSourceInCache,
  invalidateDataCache,
  initDataCacheFromDisk,
  flushDataCacheToDisk,
  getCachedAllData,
  scheduleBackgroundRefresh,
  setDataRefreshListener,
  SOURCES,
};
