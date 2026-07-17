const Parser = require('rss-parser');
const { fetchText } = require('./http-client');
const { getCommodityMeta } = require('./commodities-catalog');
const { translateBatch } = require('./translate');
const { isMostlyEnglish, translateNewsOffline } = require('./offline-translate');
const { translateFinanceHeadline } = require('./finance-headline-translate');
const diskCache = require('./disk-cache');

const FAST_TIMEOUT = 8000;
const GLOBAL_RSS_TIMEOUT = 6000;
const POOL_TTL_MS = 5 * 60 * 1000;
const FAST_DISK_KEY = 'news-fast.json';
const GLOBAL_DISK_KEY = 'news-global.json';

const parser = new Parser({
  timeout: GLOBAL_RSS_TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const EM_HEADERS = {
  Referer: 'https://finance.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

let fastPoolCache = { at: 0, items: [] };
let globalPoolCache = { at: 0, items: [], refreshing: false };
let globalRefreshPromise = null;
let fastRefreshPromise = null;
let commodityRefreshMap = new Map();
let newsDiskHydrated = false;

function hydrateNewsFromDisk() {
  if (newsDiskHydrated) return;
  newsDiskHydrated = true;
  const fastStored = diskCache.readStale(FAST_DISK_KEY);
  if (fastStored?.items?.length) {
    fastPoolCache = { at: fastStored.savedAt || Date.now(), items: fastStored.items };
  }
  const globalStored = diskCache.readStale(GLOBAL_DISK_KEY);
  if (globalStored?.items?.length) {
    globalPoolCache = {
      at: globalStored.savedAt || Date.now(),
      items: globalStored.items,
      refreshing: false,
    };
  }
}

const EXTRA_NEWS_KEYWORDS = {
  cu: ['沪铜', '铜价', 'LME', 'COMEX', '精炼铜', '电解铜'],
  al: ['沪铝', '铝价', '电解铝', '氧化铝'],
  zn: ['沪锌', '锌价', '精炼锌'],
  ni: ['沪镍', '镍价', '不锈钢原料'],
  sn: ['沪锡', '锡价'],
  au: ['沪金', '金价', '黄金', 'COMEX金', '避险'],
  ag: ['沪银', '银价', '白银'],
  rb: ['螺纹钢', '螺纹', '钢价', '建筑钢材'],
  hc: ['热卷', '热轧', '板材'],
  i: ['铁矿石', '铁矿', '普氏', 'PB粉', '钢厂'],
  j: ['焦炭', '冶金焦', '焦化'],
  jm: ['焦煤', '炼焦煤'],
  m: ['豆粕', '大豆压榨', '油厂'],
  y: ['豆油', '油脂'],
  p: ['棕榈油', '马棕', 'BMD'],
  c: ['玉米', '淀粉', '饲料'],
  lh: ['生猪', '猪价', '养殖'],
  CF: ['棉花', '棉价', 'ICE棉花'],
  SR: ['白糖', '糖价', '原糖'],
  TA: ['PTA', '聚酯', '涤纶'],
  MA: ['甲醇', '煤制甲醇'],
  FG: ['玻璃', '纯碱', '光伏玻璃'],
  SA: ['纯碱', '光伏'],
  UR: ['尿素', '化肥'],
  RM: ['菜粕', '菜籽'],
  OI: ['菜油', '菜籽油'],
  fu: ['燃料油', '原油', '油价', '布伦特', 'WTI'],
  bu: ['沥青', '炼厂'],
  ru: ['橡胶', '天胶', 'TSR20'],
  sc: ['原油', '石油', 'OPEC', 'WTI', 'Brent', '油气'],
  lu: ['低硫燃料油', '船燃', 'LSFO'],
  bc: ['国际铜', 'LME铜', 'COMEX'],
  si: ['工业硅', '硅价', '光伏'],
  lc: ['碳酸锂', '锂价', '锂电'],
  ps: ['多晶硅', '硅料', '光伏'],
  pt: ['铂金', 'platinum', 'PGM'],
  pd: ['钯金', 'palladium', 'PGM'],
};

/** 国内源：响应快，优先展示 */
const FAST_SOURCES = [
  { id: 'sina-futures', name: '新浪财经·期货', type: 'sina-roll', lid: 2516, category: 'futures' },
  { id: 'sina-commodity', name: '新浪财经·商品', type: 'sina-roll', lid: 2514, category: 'futures' },
  { id: 'eastmoney-futures', name: '东方财富·期货', type: 'eastmoney-roll', category: 'futures' },
  { id: '100ppi', name: '生意社', type: '100ppi', category: 'industry' },
  { id: 'xinhua-fortune', name: '新华社财经', type: 'rss', url: 'http://www.news.cn/fortune/news_fortune.xml', category: 'macro' },
  { id: 'eia-today', name: 'EIA·能源要闻', type: 'rss', url: 'https://www.eia.gov/rss/todayinenergy.xml', category: 'global', translate: true },
  { id: 'usda-press', name: 'USDA·公告', type: 'rss', url: 'https://www.usda.gov/media/press-releases/rss.xml', category: 'global', translate: true },
];

/** 境外源：后台加载，短超时 */
const GLOBAL_SOURCES = [
  { id: 'cnbc', name: 'CNBC', type: 'rss', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', category: 'global', translate: true },
  {
    id: 'bloomberg-markets',
    name: '彭博·市场',
    type: 'rss',
    url: 'https://feeds.bloomberg.com/markets/news.rss',
    category: 'global',
    translate: true,
  },
  {
    id: 'investing-commodities',
    name: 'Investing.com·商品',
    type: 'rss',
    url: 'https://www.investing.com/rss/news_301.rss',
    category: 'global',
    translate: true,
  },
  {
    id: 'oilprice',
    name: 'OilPrice.com',
    type: 'rss',
    url: 'https://oilprice.com/rss/main',
    category: 'global',
    translate: true,
  },
  {
    id: 'iea-news',
    name: 'IEA·新闻',
    type: 'rss',
    url: 'https://www.iea.org/news/rss',
    category: 'global',
    translate: true,
  },
  {
    id: 'reuters-commodities',
    name: 'Reuters·商品',
    type: 'rss',
    url: 'https://feeds.reuters.com/reuters/USenergyNews',
    category: 'global',
    translate: true,
  },
];

const GLOBAL_CN_QUERIES = {
  sc: ['OPEC', '布伦特', 'WTI', '国际原油', '欧佩克'],
  lu: ['低硫燃料油', '船燃', '国际油市'],
  bc: ['LME铜', 'COMEX铜', '国际铜价'],
  cu: ['LME铜', 'COMEX铜', '国际铜价'],
  au: ['COMEX黄金', '国际金价', '伦敦金'],
  ag: ['COMEX白银', '国际银价'],
  i: ['普氏铁矿', '国际铁矿', '淡水河谷'],
  default: ['国际市场', '外盘', '华尔街', '美联储'],
};

function ensureChineseTitle(title) {
  const raw = String(title || '').trim();
  if (!raw || !isMostlyEnglish(raw)) return raw;
  const offline = translateNewsOffline(raw);
  if (offline && !isMostlyEnglish(offline)) return offline;
  const finance = translateFinanceHeadline(raw);
  if (finance && /[\u4e00-\u9fff]/.test(finance)) return finance;
  return offline || finance || raw;
}

function relocalizeNewsItem(item) {
  if (!item) return item;
  const title = ensureChineseTitle(item.title);
  const summary = item.summary ? ensureChineseTitle(String(item.summary).slice(0, 200)) : '';
  const tagged =
    item.sourceName?.includes('译') || item.sourceName?.includes('国际')
      ? item.sourceName
      : `${item.sourceName || '境外'}（译）`;
  return {
    ...item,
    title,
    summary: summary || (item.summary ? String(item.summary).slice(0, 200) : ''),
    sourceName: tagged,
  };
}

function relocalizeNewsResult(data) {
  if (!data) return data;
  const sections = ['related', 'industry', 'futures', 'global', 'macro', 'general'];
  const out = { ...data };
  for (const key of sections) {
    if (Array.isArray(out[key])) {
      out[key] = out[key].map(relocalizeNewsItem);
    }
  }
  return out;
}

const ALL_SOURCE_NAMES = [
  ...FAST_SOURCES.map((s) => s.name),
  ...GLOBAL_SOURCES.map((s) => s.name),
  '东方财富·检索',
  '东方财富·国际',
];

function withTimeout(promise, ms, fallback = []) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function stripHtml(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  return stripHtml(title).replace(/^生意社[：:]\s*/, '');
}

function getNewsKeywords(meta) {
  const extra = EXTRA_NEWS_KEYWORDS[meta.id] || [];
  return [...new Set([...(meta.keywords || []), ...extra, meta.name, meta.id])];
}

function scoreNewsItem(item, keywords, meta) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  let score = 0;
  if (meta?.name && item.title.includes(meta.name)) score += 12;
  const symId = String(meta?.id || '').toLowerCase();
  if (symId.length >= 3 && text.includes(symId)) score += 8;
  for (const kw of keywords) {
    const k = String(kw).toLowerCase().trim();
    if (!k || k.length < 2) continue;
    if (!/[\u4e00-\u9fff]/.test(k) && k.length <= 2) continue;
    if (text.includes(k)) score += k.length >= 4 ? 4 : k.length === 2 ? 1 : 2;
  }
  if (item.category === 'industry') score += 2;
  if (item.source === 'eastmoney-search') score += 5;
  if (item.category === 'futures') score += 1;
  return score;
}

function hasDirectSymbolMention(text, meta, keywords) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const name = String(meta?.name || '').trim();
  if (name.length >= 2 && t.includes(name)) return true;
  const id = String(meta?.id || '').toLowerCase();
  if (id.length >= 3 && lower.includes(id)) return true;
  for (const kw of keywords) {
    const k = String(kw).trim();
    if (!k || k.length < 2) continue;
    if (/[\u4e00-\u9fff]/.test(k)) {
      if (t.includes(k)) return true;
      continue;
    }
    const kl = k.toLowerCase();
    if (kl.length <= 2) continue;
    if (kl.length >= 4 && lower.includes(kl)) return true;
    if (kl.length === 3 && new RegExp(`\\b${kl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) return true;
  }
  return false;
}

function isUsRegulatoryNewsItem(item) {
  const blob = `${item?.source || ''} ${item?.sourceName || ''} ${item?.title || ''} ${item?.url || ''}`;
  return /联邦公报|federalregister|federal register|sec |cftc|ofac|treasury|sec\.gov/i.test(blob);
}

function dedupeNews(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = (item.link || item.title || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchSinaRoll(limit, lid, sourceId, sourceName, category) {
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&num=${limit}&page=1`;
  const text = await fetchText(url, { headers: SINA_HEADERS, timeout: FAST_TIMEOUT, retries: 1 });
  const json = JSON.parse(text);
  return (json?.result?.data || []).map((row) => ({
    title: stripHtml(row.title || row.stitle || ''),
    link: row.url || row.link || '',
    pubDate: row.ctime ? new Date(parseInt(row.ctime, 10) * 1000).toISOString() : '',
    summary: stripHtml(row.intro || row.summary || '').slice(0, 200),
    source: sourceId,
    sourceName,
    category,
  }));
}

async function fetchRssSource(source, itemLimit = 15) {
  const feed = await parser.parseURL(source.url);
  return (feed.items || []).slice(0, itemLimit).map((item) => ({
    title: stripHtml(item.title || '无标题'),
    link: item.link || '',
    pubDate: item.pubDate || item.isoDate || '',
    summary: stripHtml(item.contentSnippet || item.summary || '').slice(0, 200),
    source: source.id,
    sourceName: source.name,
    category: source.category,
    needsTranslate: Boolean(source.translate),
  }));
}

async function fetchEastmoneyRoll() {
  const url =
    'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_quote_col&column=350&pageSize=20&pageIndex=1&req_trace=fcnews';
  const text = await fetchText(url, { headers: EM_HEADERS, timeout: FAST_TIMEOUT, retries: 1 });
  const json = JSON.parse(text);
  return (json?.data?.list || []).map((row) => ({
    title: stripHtml(row.title || row.shortTitle || ''),
    link: row.url || row.uniqueUrl || '',
    pubDate: row.showTime || row.publishTime || '',
    summary: stripHtml(row.summary || row.digest || '').slice(0, 200),
    source: 'eastmoney-futures',
    sourceName: '东方财富·期货',
    category: 'futures',
  }));
}

async function fetch100ppiNews() {
  const html = await fetchText('https://www.100ppi.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.100ppi.com/' },
    timeout: FAST_TIMEOUT,
    retries: 1,
  });
  const items = [];
  const patterns = [
    /<a[^>]+href="(https:\/\/www\.100ppi\.com\/(?:news|focus|forecast)\/[^"]+)"[^>]*title="(生意社[^"]+)"/g,
    /<a[^>]+href="(\/(?:news|focus|forecast)\/[^"]+)"[^>]*title="(生意社[^"]+)"/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) {
      const link = m[1].startsWith('http') ? m[1] : `https://www.100ppi.com${m[1]}`;
      items.push({
        title: normalizeTitle(m[2]),
        link,
        pubDate: '',
        summary: '生意社大宗商品现货与产业链分析',
        source: '100ppi',
        sourceName: '生意社',
        category: 'industry',
      });
    }
  }
  return items;
}

async function fetchEastmoneySearch(keyword, limit = 12) {
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
  const text = await fetchText(url, { headers: EM_HEADERS, timeout: FAST_TIMEOUT, retries: 1 });
  const json = JSON.parse(text.replace(/^j\(/, '').replace(/\)$/, ''));
  return (json?.result?.cmsArticleWebOld || []).map((row) => ({
    title: stripHtml(row.title || row.shortTitle || ''),
    link: row.url || '',
    pubDate: row.date || row.showTime || '',
    summary: stripHtml(row.content || row.digest || '').slice(0, 200),
    source: 'eastmoney-search',
    sourceName: '东方财富·检索',
    category: 'search',
  }));
}

async function fetchSource(source) {
  try {
    switch (source.type) {
      case 'sina-roll':
        return await fetchSinaRoll(25, source.lid, source.id, source.name, source.category);
      case 'rss':
        return await withTimeout(fetchRssSource(source), GLOBAL_RSS_TIMEOUT);
      case 'eastmoney-roll':
        return await fetchEastmoneyRoll();
      case '100ppi':
        return await fetch100ppiNews();
      default:
        return [];
    }
  } catch {
    return [];
  }
}

async function fetchSourcesPool(sources) {
  const parts = await Promise.allSettled(sources.map((src) => fetchSource(src)));
  let all = [];
  for (const p of parts) {
    if (p.status === 'fulfilled') all = all.concat(p.value);
  }
  return dedupeNews(all);
}

async function localizeNewsItems(items, maxItems = 10, { offlineOnly = true } = {}) {
  if (!items?.length) return [];
  const slice = items.slice(0, maxItems);

  const finalize = (item) => {
    const localized = relocalizeNewsItem(item);
    return localized.title ? localized : null;
  };

  if (offlineOnly) {
    return slice.map(finalize).filter(Boolean);
  }

  const needTranslate = slice.filter(
    (item) => item.needsTranslate || isMostlyEnglish(item.title) || isMostlyEnglish(item.summary)
  );
  const chinese = slice.filter(
    (item) => !item.needsTranslate && !isMostlyEnglish(item.title) && !isMostlyEnglish(item.summary)
  );
  if (!needTranslate.length) return chinese.map(finalize).filter(Boolean);

  const texts = needTranslate.flatMap((item) => [item.title, item.summary].filter(Boolean));
  let lookup = (text) => ensureChineseTitle(text);
  const online = await withTimeout(translateBatch(texts, 3), 5000, null);
  if (typeof online === 'function') lookup = (text) => ensureChineseTitle(online(text) || text);

  const translated = needTranslate
    .map((item) => {
      let title = lookup(item.title) || ensureChineseTitle(item.title);
      let summary = item.summary ? lookup(item.summary) || ensureChineseTitle(item.summary) : '';
      if (isMostlyEnglish(title)) title = ensureChineseTitle(item.title);
      if (summary && isMostlyEnglish(summary)) summary = item.summary ? ensureChineseTitle(item.summary) : '';
      return finalize({ ...item, title, summary: summary ? String(summary).slice(0, 200) : '' });
    })
    .filter(Boolean);

  return dedupeNews([...chinese.map(finalize).filter(Boolean), ...translated]);
}

function commodityNewsDiskKey(commodityId) {
  return `news/commodity-${commodityId}.json`;
}

function getCachedCommodityNews(commodityId) {
  hydrateNewsFromDisk();
  const stored = diskCache.readStale(commodityNewsDiskKey(commodityId));
  const data = stored?.data || null;
  return data ? relocalizeNewsResult(data) : null;
}

function refreshFastPoolInBackground() {
  if (fastRefreshPromise) return fastRefreshPromise;
  fastRefreshPromise = (async () => {
    try {
      const items = await withTimeout(
        fetchSourcesPool(FAST_SOURCES),
        FAST_TIMEOUT + 2000,
        fastPoolCache.items
      );
      if (items.length) {
        fastPoolCache = { at: Date.now(), items };
        diskCache.write(FAST_DISK_KEY, { items });
      }
    } finally {
      fastRefreshPromise = null;
    }
  })();
  return fastRefreshPromise;
}

async function getFastNewsPool({ force = false } = {}) {
  hydrateNewsFromDisk();
  if (!force && Date.now() - fastPoolCache.at < POOL_TTL_MS && fastPoolCache.items.length > 0) {
    return fastPoolCache.items;
  }
  if (!force && fastPoolCache.items.length > 0) {
    refreshFastPoolInBackground();
    return fastPoolCache.items;
  }
  const items = await withTimeout(
    fetchSourcesPool(FAST_SOURCES),
    FAST_TIMEOUT + 2000,
    fastPoolCache.items
  );
  if (items.length) {
    fastPoolCache = { at: Date.now(), items };
    diskCache.write(FAST_DISK_KEY, { items });
  }
  return items;
}

async function refreshGlobalPoolInBackground() {
  if (globalRefreshPromise) return globalRefreshPromise;

  globalPoolCache.refreshing = true;
  globalRefreshPromise = (async () => {
    try {
      const translated = await withTimeout(
        (async () => {
          const raw = await fetchSourcesPool(GLOBAL_SOURCES);
          return raw.length ? await localizeNewsItems(raw, 12, { offlineOnly: true }) : [];
        })(),
        10000,
        []
      );
      globalPoolCache = { at: Date.now(), items: translated, refreshing: false };
      diskCache.write(GLOBAL_DISK_KEY, { items: translated });
      return globalPoolCache.items;
    } catch {
      globalPoolCache.refreshing = false;
      return globalPoolCache.items;
    } finally {
      globalPoolCache.refreshing = false;
      globalRefreshPromise = null;
    }
  })();

  return globalRefreshPromise;
}

function getGlobalNewsPoolSync() {
  if (Date.now() - globalPoolCache.at < POOL_TTL_MS && globalPoolCache.items.length > 0) {
    return globalPoolCache.items;
  }
  if (!globalPoolCache.refreshing) {
    refreshGlobalPoolInBackground().catch(() => {});
  }
  return globalPoolCache.items;
}

function getFastNewsPoolSync() {
  hydrateNewsFromDisk();
  if (Date.now() - fastPoolCache.at < POOL_TTL_MS && fastPoolCache.items.length > 0) {
    return fastPoolCache.items;
  }
  if (fastPoolCache.items.length > 0) {
    refreshFastPoolInBackground().catch(() => {});
    return fastPoolCache.items;
  }
  const stale = diskCache.readStale(FAST_DISK_KEY);
  return Array.isArray(stale?.items) ? stale.items : [];
}

function categorizeNews(scored, pool, meta, limit = 20) {
  const related = scored
    .filter((i) => i.relevance >= 4 || (meta.name && i.title.includes(meta.name)))
    .slice(0, limit);
  const relatedLinks = new Set(related.map((i) => i.link));

  return {
    related,
    industry: pool.filter((i) => i.category === 'industry' && !relatedLinks.has(i.link)).slice(0, 15),
    futures: pool
      .filter((i) => (i.category === 'futures' || i.source === 'eastmoney-futures') && !relatedLinks.has(i.link))
      .slice(0, 15),
    global: pool.filter((i) => i.category === 'global' && !relatedLinks.has(i.link)).slice(0, 15),
    macro: pool.filter((i) => i.category === 'macro' && !relatedLinks.has(i.link)).slice(0, 10),
  };
}

function buildNewsResult(meta, combined, keywords) {
  const scored = combined
    .map((item) => ({ ...item, relevance: scoreNewsItem(item, keywords, meta) }))
    .sort((a, b) => b.relevance - a.relevance || new Date(b.pubDate) - new Date(a.pubDate));

  const { related, industry, futures, global, macro } = categorizeNews(scored, combined, meta, 25);

  return {
    commodityId: meta.id,
    commodityName: meta.name,
    related: dedupeNews(related).slice(0, 25),
    industry: dedupeNews(industry).slice(0, 20),
    futures: dedupeNews(futures).slice(0, 18),
    global: dedupeNews(global).slice(0, 18),
    macro: dedupeNews(macro).slice(0, 12),
    general: dedupeNews([...futures, ...macro]).slice(0, 15),
    sources: ALL_SOURCE_NAMES,
    counts: {
      related: related.length,
      industry: industry.length,
      futures: futures.length,
      global: global.length,
      total: combined.length,
    },
    globalLoading: globalPoolCache.refreshing && global.length === 0,
    fetchedAt: new Date().toISOString(),
  };
}

function refreshCommodityNewsInBackground(commodityId) {
  if (commodityRefreshMap.has(commodityId)) return commodityRefreshMap.get(commodityId);
  const task = fetchCommodityNews(commodityId, { force: true })
    .catch(() => null)
    .finally(() => commodityRefreshMap.delete(commodityId));
  commodityRefreshMap.set(commodityId, task);
  return task;
}

async function fetchCommoditySearchBundle(meta) {
  const queries = [
    `${meta.name}期货`,
    meta.name,
    ...(meta.global || []).slice(0, 3),
  ];
  const unique = [...new Set(queries.filter(Boolean))].slice(0, 5);
  const parts = await Promise.allSettled(
    unique.map((q) => withTimeout(fetchEastmoneySearch(q, 10), 5000, []))
  );
  return dedupeNews(parts.flatMap((p) => (p.status === 'fulfilled' ? p.value : [])));
}

async function fetchGlobalChineseSearch(meta) {
  const extra = GLOBAL_CN_QUERIES[meta.id] || GLOBAL_CN_QUERIES.default;
  const queries = [
    `国际${meta.name}`,
    `${meta.name}外盘`,
    ...(meta.global || []).slice(0, 4),
    ...extra,
  ];
  const unique = [...new Set(queries.filter(Boolean))].slice(0, 6);
  const parts = await Promise.allSettled(
    unique.map((q) => withTimeout(fetchEastmoneySearch(q, 8), 5000, []))
  );
  return dedupeNews(
    parts.flatMap((p) => (p.status === 'fulfilled' ? p.value : [])).map((item) => ({
      ...item,
      category: 'global',
      sourceName: '东方财富·国际',
    }))
  );
}

async function fetchCommodityNews(commodityId, { force = false } = {}) {
  const meta = getCommodityMeta(commodityId);
  if (!meta) throw new Error('未知品种');

  if (!force) {
    const cached = getCachedCommodityNews(commodityId);
    if (cached) {
      refreshCommodityNewsInBackground(commodityId);
      return { ...cached, fromCache: true };
    }
  }

  const keywords = getNewsKeywords(meta);
  refreshGlobalPoolInBackground();

  const result = await withTimeout(
    (async () => {
      const [fastPool, searchItems, globalCnItems, globalFresh] = await Promise.all([
        getFastNewsPool({ force }),
        fetchCommoditySearchBundle(meta),
        fetchGlobalChineseSearch(meta),
        withTimeout(
          (async () => {
            const raw = await fetchSourcesPool(GLOBAL_SOURCES);
            return raw.length ? await localizeNewsItems(raw, 20, { offlineOnly: true }) : [];
          })(),
          8000,
          getGlobalNewsPoolSync().map(relocalizeNewsItem)
        ),
      ]);
      const combined = dedupeNews([...searchItems, ...globalCnItems, ...fastPool, ...globalFresh]);
      return relocalizeNewsResult(buildNewsResult(meta, combined, keywords));
    })(),
    15000,
    null
  );

  if (!result) {
    const fallbackPool = fastPoolCache.items.length
      ? fastPoolCache.items
      : await withTimeout(getFastNewsPool(), 3000, []);
    if (fallbackPool.length) {
      const partial = relocalizeNewsResult(buildNewsResult(meta, dedupeNews(fallbackPool), keywords));
      partial.partial = true;
      diskCache.write(commodityNewsDiskKey(commodityId), { data: partial });
      return partial;
    }
    throw new Error('资讯加载超时，请稍后重试');
  }

  diskCache.write(commodityNewsDiskKey(commodityId), { data: result });
  return result;
}

async function fetchCommodityNewsRefresh(commodityId) {
  refreshGlobalPoolInBackground();
  refreshFastPoolInBackground();
  return fetchCommodityNews(commodityId, { force: true });
}

async function fetchCommoditiesNewsOverview() {
  const pool = await getFastNewsPool();
  return {
    headlines: pool.slice(0, 30),
    sources: ALL_SOURCE_NAMES,
    fetchedAt: new Date().toISOString(),
  };
}

function warmNewsCache() {
  hydrateNewsFromDisk();
  if (fastPoolCache.items.length) refreshFastPoolInBackground();
  else getFastNewsPool().catch(() => {});
  refreshGlobalPoolInBackground().catch(() => {});
}

function invalidateNewsCache() {
  fastPoolCache = { at: 0, items: [] };
  globalPoolCache = { at: 0, items: [], refreshing: false };
  globalRefreshPromise = null;
  diskCache.remove(FAST_DISK_KEY);
  diskCache.remove(GLOBAL_DISK_KEY);
}

function initNewsCacheFromDisk() {
  hydrateNewsFromDisk();
}

function flushNewsCacheToDisk() {
  hydrateNewsFromDisk();
  if (fastPoolCache.items.length) {
    diskCache.write(FAST_DISK_KEY, { items: fastPoolCache.items });
  }
  if (globalPoolCache.items.length) {
    diskCache.write(GLOBAL_DISK_KEY, { items: globalPoolCache.items });
  }
}

module.exports = {
  fetchCommodityNews,
  fetchCommodityNewsRefresh,
  fetchCommoditiesNewsOverview,
  getCachedCommodityNews,
  getFastNewsPool,
  getFastNewsPoolSync,
  getGlobalNewsPoolSync,
  warmNewsCache,
  invalidateNewsCache,
  initNewsCacheFromDisk,
  flushNewsCacheToDisk,
  getNewsKeywords,
  scoreNewsItem,
  hasDirectSymbolMention,
  isUsRegulatoryNewsItem,
};
