const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const { fetchText, fetchJson } = require('./http-client');
const { getDataDir } = require('./data-paths');
const {
  FLASH_ALERT_KEYWORDS,
  getEnabledFlashSources,
  getFlashSourceById,
} = require('./flash-news-sources');
const { detectCommodityTags } = require('./policy-commodity-map');
const { buildFederalRegisterUrl } = require('./policy-us-sources');
const { isOpinionTitle, detectOpinionBroker, rankOpinionItems } = require('./opinion-news');

const INBOX_FILENAME = 'flash-news-inbox.json';
const FETCHER_VERSION = 'v1.56.3-opinion-free';
const RSS_TIMEOUT_MS = 10000;
const API_TIMEOUT_MS = 12000;
const INTL_RSS_TIMEOUT_MS = 6000;
const DEFAULT_MIN_KEYWORD_HITS = 0;
const FETCH_BATCH_SIZE = 8;

const parser = new Parser({
  timeout: RSS_TIMEOUT_MS,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FanchengFinance/1.31 flash-news',
    Accept: 'application/rss+xml, application/xml, text/xml, application/json, */*',
  },
});

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const EM_HEADERS = {
  Referer: 'https://finance.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInboxPath() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, INBOX_FILENAME);
}

function readInbox() {
  const filePath = getInboxPath();
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      updatedAt: null,
      lastFetchAt: null,
      candidates: [],
      manualQueue: [],
      sourceStats: {},
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      version: 1,
      updatedAt: data.updatedAt || null,
      lastFetchAt: data.lastFetchAt || null,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      manualQueue: Array.isArray(data.manualQueue) ? data.manualQueue : [],
      sourceStats: data.sourceStats || {},
    };
  } catch {
    return {
      version: 1,
      updatedAt: null,
      lastFetchAt: null,
      candidates: [],
      manualQueue: [],
      sourceStats: {},
    };
  }
}

function writeInbox(inbox) {
  const filePath = getInboxPath();
  const payload = {
    ...inbox,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function normalizeTitle(title) {
  return stripHtml(title)
    .replace(/^【[^】]+】/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parsePubDate(raw) {
  if (!raw) return null;
  if (typeof raw === 'number') {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s, 10) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s, 10));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPubDate(raw) {
  const d = parsePubDate(raw);
  return d ? d.toISOString() : String(raw || '').trim();
}

function dedupeKey(item) {
  const title = normalizeTitle(item.title);
  const d = parsePubDate(item.pubDate);
  const datePart = d ? d.toISOString().slice(0, 16) : String(item.pubDate || '').slice(0, 16);
  return `${title}|${datePart}`;
}

function hashCandidate(item) {
  return crypto.createHash('md5').update(dedupeKey(item)).digest('hex');
}

function detectKeywordHits(text) {
  const hits = [];
  for (const group of FLASH_ALERT_KEYWORDS) {
    if (group.keywords.some((k) => text.includes(k) || text.toLowerCase().includes(k.toLowerCase()))) {
      hits.push(group.id);
    }
  }
  return hits;
}

function enrichCandidate(raw, source) {
  const title = stripHtml(raw.title || raw.summary || '').slice(0, 300);
  const summary = stripHtml(raw.summary || '').slice(0, 400);
  const text = `${title} ${summary}`;
  const keywordHits = detectKeywordHits(text);
  const commodityTags = detectCommodityTags(text).map((t) => t.id);
  const pubDate = formatPubDate(raw.pubDate);
  const broker = detectOpinionBroker(title, raw.link || '');
  const contentType = source.contentType || (isOpinionTitle(title) ? 'opinion' : 'news');

  return {
    id: hashCandidate({ title, pubDate }),
    title,
    summary,
    link: raw.link || '',
    pubDate,
    sourceId: source.id,
    sourceName: broker?.name ? `${source.name}·${broker.name}` : source.name,
    category: source.category,
    contentType,
    opinionBroker: broker?.id || null,
    method: source.method,
    keywordHits,
    commodityTags,
    fetchedAt: new Date().toISOString(),
    status: 'pending',
    verifyNote: '未合并至 news-tagged.csv，需人工核验',
  };
}

function clsSign(queryString) {
  const sha1 = crypto.createHash('sha1').update(queryString).digest('hex');
  return crypto.createHash('md5').update(sha1).digest('hex');
}

/** 财联社 Web 签名：参数按 key 字典序拼接后 sha1→md5（对照 RSSHub lib/routes/cls/utils.ts） */
function buildClsSignedQuery(params) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const keys = Object.keys(filtered).sort();
  const core = keys.map((k) => `${k}=${filtered[k]}`).join('&');
  return `${core}&sign=${clsSign(core)}`;
}

async function fetchSinaFuturesOpinion(source) {
  const pageUrl = source.api?.url || 'https://finance.sina.com.cn/futuremarket/';
  const html = await fetchText(pageUrl, {
    headers: { ...SINA_HEADERS, Referer: source.api?.referer || SINA_HEADERS.Referer },
    timeout: API_TIMEOUT_MS,
    retries: 1,
  });
  const limit = source.api?.limit || 30;
  const items = [];
  const seen = new Set();
  for (const re of [
    /href="(https?:\/\/[^"]+)"[^>]*title="([^"]+)"/g,
    /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{10,120})</g,
  ]) {
    let m;
    while ((m = re.exec(html)) && items.length < limit * 2) {
      const title = stripHtml(m[2]);
      const link = m[1];
      if (!title || !link || seen.has(link)) continue;
      if (!isOpinionTitle(title)) continue;
      seen.add(link);
      items.push({ title, link, summary: '', pubDate: '' });
    }
  }
  return rankOpinionItems(items).slice(0, limit);
}

async function fetchSinaRoll(source) {
  const { lid, pageSize = 30 } = source.api.params;
  const referer = source.api.referer || SINA_HEADERS.Referer;
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&num=${pageSize}&page=1`;
  const text = await fetchText(url, {
    headers: { ...SINA_HEADERS, Referer: referer },
    timeout: API_TIMEOUT_MS,
    retries: 1,
  });
  const json = JSON.parse(text);
  return (json?.result?.data || []).map((row) => ({
    title: stripHtml(row.title || row.stitle || ''),
    summary: stripHtml(row.intro || row.summary || '').slice(0, 400),
    link: row.url || row.link || '',
    pubDate: row.ctime ? new Date(parseInt(row.ctime, 10) * 1000).toISOString() : '',
  }));
}

async function fetch100ppi(source) {
  const html = await fetchText('https://www.100ppi.com/', {
    headers: { 'User-Agent': EM_HEADERS['User-Agent'], Referer: 'https://www.100ppi.com/' },
    timeout: API_TIMEOUT_MS,
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
        title: stripHtml(m[2]),
        link,
        pubDate: '',
        summary: '生意社大宗商品现货与产业链快讯',
      });
    }
  }
  const seen = new Set();
  return items.filter((row) => {
    const key = row.link || row.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchEastmoneyFastList(source) {
  const { url, params, referer } = source.api;
  const qs = new URLSearchParams({
    ...params,
    req_trace: String(Date.now()),
  });
  const text = await fetchText(`${url}?${qs.toString()}`, {
    headers: { ...EM_HEADERS, Referer: referer || EM_HEADERS.Referer },
    timeout: API_TIMEOUT_MS,
    retries: 1,
  });
  const json = JSON.parse(text);
  const list = json?.data?.fastNewsList || [];
  return list.map((row) => ({
    title: stripHtml(row.title || row.summary || ''),
    summary: stripHtml(row.summary || ''),
    link: row.code ? `https://finance.eastmoney.com/a/${row.code}.html` : '',
    pubDate: row.showTime || row.realSort || '',
  }));
}

async function fetchEastmoneyColumns(source) {
  const { url, params, referer } = source.api;
  const qs = new URLSearchParams({
    ...params,
    req_trace: String(Date.now()),
  });
  const text = await fetchText(`${url}?${qs.toString()}`, {
    headers: { ...EM_HEADERS, Referer: referer || EM_HEADERS.Referer },
    timeout: API_TIMEOUT_MS,
    retries: 1,
  });
  const json = JSON.parse(text);
  return (json?.data?.list || []).map((row) => ({
    title: stripHtml(row.title || row.shortTitle || row.summary || ''),
    summary: stripHtml(row.summary || row.digest || ''),
    link: row.url || row.uniqueUrl || '',
    pubDate: row.showTime || row.publishTime || '',
  }));
}

async function fetchJin10(source) {
  const { url, params, headers, referer } = source.api;
  const qs = new URLSearchParams(params);
  const json = await fetchJson(`${url}?${qs.toString()}`, {
    headers: { ...headers, Referer: referer },
    timeout: API_TIMEOUT_MS,
    retries: 1,
  });
  return (json?.data || [])
    .filter((item) => item.type !== 1 && item.data?.content)
    .map((item) => {
      const content = stripHtml(item.data.content || '');
      const titleMatch = content.match(/^【[^】]+】/);
      let title = titleMatch ? titleMatch[1] : item.data.vip_title || content.slice(0, 120);
      let summary = titleMatch ? content.replace(titleMatch[0], '').trim() : content;
      return {
        title,
        summary,
        link: item.data.link || 'https://www.jin10.com/',
        pubDate: item.time || '',
      };
    });
}

async function fetchClsSigned(source) {
  const { url, params = {}, referer } = source.api;
  const baseParams = {
    appName: 'CailianpressWeb',
    os: 'web',
    sv: '8.7.9',
    ...params,
  };
  const query = buildClsSignedQuery(baseParams);
  const json = await fetchJson(`${url}?${query}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: referer || 'https://www.cls.cn/telegraph',
      Origin: 'https://www.cls.cn',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
    },
    timeout: API_TIMEOUT_MS,
    retries: 2,
  });
  if (json?.errno && String(json.errno) !== '0') {
    throw new Error(json.msg || `CLS errno ${json.errno}`);
  }
  return (json?.data?.roll_data || []).map((row) => ({
    title: stripHtml(row.title || row.brief || row.content || ''),
    summary: stripHtml(row.content || row.brief || ''),
    link: row.shareurl || `https://www.cls.cn/detail/${row.id}`,
    pubDate: row.ctime ? new Date(row.ctime * 1000).toISOString() : row.time || '',
  }));
}

async function fetchWallstreetcn(source) {
  const { url, params, referer } = source.api;
  const qs = new URLSearchParams(params);
  const json = await fetchJson(`${url}?${qs.toString()}`, {
    headers: { Referer: referer, 'User-Agent': EM_HEADERS['User-Agent'] },
    timeout: API_TIMEOUT_MS,
    retries: 1,
  });
  return (json?.data?.items || []).map((row) => ({
    title: stripHtml(row.title || row.content_text || '').slice(0, 200),
    summary: stripHtml(row.content_text || row.title || '').slice(0, 400),
    link: row.uri ? `https://wallstreetcn.com/livenews/${row.id}` : 'https://wallstreetcn.com/live/global',
    pubDate: row.display_time ? new Date(row.display_time * 1000).toISOString() : '',
  }));
}

async function fetchFederalRegister(source) {
  const { agencySlug, limit } = source.api;
  const url = buildFederalRegisterUrl(agencySlug, limit || 12);
  const json = await fetchJson(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.31 flash-news', Accept: 'application/json' },
    timeout: 15000,
    retries: 1,
  });
  return (json?.results || []).map((row) => ({
    title: stripHtml(row.title || ''),
    summary: stripHtml(row.abstract || row.action || '').slice(0, 400),
    link: row.html_url || row.pdf_url || '',
    pubDate: row.publication_date || row.effective_on || '',
  }));
}

async function fetchRssSource(source) {
  const feedCfg = source.rss;
  const urls = [feedCfg.url, ...(feedCfg.fallbackUrls || [])];
  const useProxy = source.category === 'intl' || source.category === 'official';
  let lastErr = null;
  for (const feedUrl of urls) {
    try {
      let parsed;
      if (useProxy) {
        const text = await fetchText(feedUrl, {
          headers: parser.options?.headers,
          timeout: INTL_RSS_TIMEOUT_MS,
          retries: 1,
          useOverseasProxy: true,
        });
        parsed = await parser.parseString(text);
      } else {
        parsed = await parser.parseURL(feedUrl);
      }
      return (parsed.items || []).slice(0, feedCfg.limit || 20).map((item) => ({
        title: stripHtml(item.title || ''),
        summary: stripHtml(item.contentSnippet || item.summary || '').slice(0, 400),
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || '',
      }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('RSS 解析失败');
}

async function fetchSourceRaw(source) {
  if (source.method === 'rss') return fetchRssSource(source);
  if (source.method === 'html') {
    if (source.api?.parser === '100ppi') return fetch100ppi(source);
    if (source.api?.parser === 'sina-futures-opinion') return fetchSinaFuturesOpinion(source);
    throw new Error('需手动粘贴');
  }

  const parserId = source.api?.parser;
  if (parserId === 'eastmoney-columns') return fetchEastmoneyColumns(source);
  if (parserId === 'jin10') return fetchJin10(source);
  if (parserId === 'cls-signed') return fetchClsSigned(source);
  if (parserId === 'wallstreetcn') return fetchWallstreetcn(source);
  if (parserId === 'federal-register') return fetchFederalRegister(source);
  if (parserId === 'sina-roll') return fetchSinaRoll(source);
  if (parserId === 'sina-futures-opinion') return fetchSinaFuturesOpinion(source);
  if (source.api?.url?.includes('getFastNewsList')) return fetchEastmoneyFastList(source);
  throw new Error(`未知 API 解析: ${source.id}`);
}

async function fetchOneSource(source) {
  const started = Date.now();
  try {
    const rawItems = await fetchSourceRaw(source);
    const candidates = rawItems
      .filter((r) => r.title && r.title.length >= 4)
      .map((r) => enrichCandidate(r, source));
    return {
      sourceId: source.id,
      sourceName: source.name,
      ok: true,
      count: candidates.length,
      durationMs: Date.now() - started,
      items: candidates,
      error: null,
    };
  } catch (err) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      ok: false,
      count: 0,
      durationMs: Date.now() - started,
      items: [],
      error: err?.message || String(err ?? 'unknown error'),
      fallback: source.fallback || null,
      fallbackNote: source.fallbackNote || null,
    };
  }
}

function filterByMinKeywordHits(items, minHits) {
  if (!minHits || minHits <= 0) return items;
  return items.filter((item) => item.keywordHits?.length >= minHits);
}

function mergeInboxCandidates(existing, incoming, { maxCandidates = 2000 } = {}) {
  const seen = new Set(existing.map((c) => c.id));
  const merged = [...existing];
  let added = 0;
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.unshift(item);
    added += 1;
  }
  merged.sort((a, b) => new Date(b.pubDate || b.fetchedAt) - new Date(a.pubDate || a.fetchedAt));
  return { merged: merged.slice(0, maxCandidates), added };
}

function countInTimeWindow(items, hours) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  return items.filter((item) => {
    const d = parsePubDate(item.pubDate || item.fetchedAt);
    return d && d.getTime() >= cutoff;
  }).length;
}

function buildSourceReport(sourceResults, windowItems) {
  const report = {};
  for (const r of sourceResults) {
    const sourceItems = windowItems.filter((c) => c.sourceId === r.sourceId);
    report[r.sourceId] = {
      name: r.sourceName,
      ok: r.ok,
      fetched: r.count,
      last24h: countInTimeWindow(sourceItems, 24),
      last7d: countInTimeWindow(sourceItems, 24 * 7),
      error: r.error || null,
      fallback: r.fallback || null,
    };
  }
  return report;
}

async function fetchAllFlashNews(options = {}) {
  const {
    sources = getEnabledFlashSources(),
    minKeywordHits = DEFAULT_MIN_KEYWORD_HITS,
    appendInbox = true,
    respectRateLimit = false,
    parallel = true,
  } = options;

  const sourceResults = [];
  const allCandidates = [];

  if (parallel) {
    for (let i = 0; i < sources.length; i += FETCH_BATCH_SIZE) {
      const batch = sources.slice(i, i + FETCH_BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(async (source, idx) => {
          if (respectRateLimit && idx > 0 && source.rateLimitMs) {
            await sleep(Math.min(source.rateLimitMs, 500));
          }
          return fetchOneSource(source);
        })
      );
      for (const row of settled) {
        const result = row.status === 'fulfilled' ? row.value : {
          sourceId: 'unknown',
          sourceName: 'unknown',
          ok: false,
          count: 0,
          durationMs: 0,
          items: [],
          error: row.reason?.message || String(row.reason),
        };
        sourceResults.push(result);
        allCandidates.push(...filterByMinKeywordHits(result.items, minKeywordHits));
      }
    }
  } else {
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      if (respectRateLimit && i > 0 && source.rateLimitMs) {
        await sleep(source.rateLimitMs);
      }
      const result = await fetchOneSource(source);
      sourceResults.push(result);
      allCandidates.push(...filterByMinKeywordHits(result.items, minKeywordHits));
    }
  }

  let inbox = readInbox();
  let added = 0;
  if (appendInbox && allCandidates.length) {
    const merge = mergeInboxCandidates(inbox.candidates, allCandidates);
    inbox.candidates = merge.merged;
    added = merge.added;
  }

  inbox.lastFetchAt = new Date().toISOString();
  inbox.sourceStats = buildSourceReport(sourceResults, inbox.candidates);
  if (appendInbox) inbox = writeInbox(inbox);

  return {
    version: FETCHER_VERSION,
    fetchedAt: inbox.lastFetchAt,
    inboxPath: getInboxPath(),
    sourceResults,
    candidates: allCandidates,
    addedToInbox: added,
    inboxTotal: inbox.candidates.length,
    manualQueueSize: inbox.manualQueue.length,
    stats: {
      totalFetched: allCandidates.length,
      last24h: countInTimeWindow(allCandidates, 24),
      last7d: countInTimeWindow(allCandidates, 24 * 7),
      bySource: buildSourceReport(sourceResults, allCandidates),
    },
  };
}

function addManualFlashNews(entries, { sourceLabel = '手动粘贴' } = {}) {
  const manualSource = {
    id: 'manual-paste',
    name: sourceLabel,
    category: 'manual',
    method: 'manual',
  };
  const inbox = readInbox();
  const items = (Array.isArray(entries) ? entries : [entries]).map((entry) => {
    const text = typeof entry === 'string' ? entry : entry.title || entry.text || '';
    return enrichCandidate(
      {
        title: text.slice(0, 300),
        summary: typeof entry === 'object' ? entry.summary || '' : '',
        link: typeof entry === 'object' ? entry.link || '' : '',
        pubDate: typeof entry === 'object' ? entry.pubDate || new Date().toISOString() : new Date().toISOString(),
      },
      manualSource
    );
  });

  inbox.manualQueue = [...items, ...inbox.manualQueue].slice(0, 500);
  const merge = mergeInboxCandidates(inbox.candidates, items);
  inbox.candidates = merge.merged;
  writeInbox(inbox);
  return { added: items.length, inboxTotal: inbox.candidates.length };
}

function getFlashNewsInbox() {
  const inbox = readInbox();
  return {
    ...inbox,
    inboxPath: getInboxPath(),
    pendingCount: inbox.candidates.filter((c) => c.status === 'pending').length,
  };
}

function getFlashNewsSummary() {
  const inbox = getFlashNewsInbox();
  const pending = inbox.candidates.filter((c) => c.status === 'pending');
  return {
    pendingCount: pending.length,
    lastFetchAt: inbox.lastFetchAt,
    last24h: countInTimeWindow(inbox.candidates, 24),
    last7d: countInTimeWindow(inbox.candidates, 24 * 7),
    sourceStats: inbox.sourceStats,
    alertHits: pending.filter((c) => c.keywordHits?.length).length,
  };
}

module.exports = {
  FETCHER_VERSION,
  getInboxPath,
  readInbox,
  fetchAllFlashNews,
  fetchOneSource,
  addManualFlashNews,
  getFlashNewsInbox,
  getFlashNewsSummary,
  enrichCandidate,
  countInTimeWindow,
  getFlashSourceById,
};
