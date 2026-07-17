/**
 * 交易所公告聚合（最优路径）
 * 直连：中金所 / 广期所 HTML
 * 镜像：快讯池 + 政策池 + 新浪期货滚动 + 东财商品 7×24 中命中交易所规则关键词
 * 不伪造：SHFE/DCE/CZCE 官网 412/JS 壳时仅收录媒体转载，标注 mirror
 */
const crypto = require('crypto');
const { fetchText } = require('./http-client');
const { POLICY_HTML_FEEDS } = require('./policy-sources');
const { detectCommodityTags, normalizeCommodityId, findTagById } = require('./policy-commodity-map');
const { enrichExchangeNoticeSymbols } = require('./exchange-symbol-match');
const diskCache = require('./disk-cache');
const { getDataDir } = require('./data-paths');

const EXCHANGE_NOTICE_VERSION = 'v1.56.9-exchange-notice';
const DISK_KEY = 'exchange-notice-mirror.json';

const CN_EXCHANGE_RE =
  /上期所|上海期货交易所|大商所|大连商品交易所|郑商所|郑州商品交易所|中金所|中国金融期货交易所|广期所|广州期货交易所|能源中心|上海国际能源交易中心/;

const EXCHANGE_NOTICE_RE =
  /上期所|上海期货交易所|大商所|大连商品交易所|郑商所|郑州商品交易所|中金所|中国金融期货交易所|广期所|广州期货交易所|能源中心|上海国际能源|交易所.*(通知|公告|函)|限仓|持仓限额|交易限额|调整.*(手续费|保证金)|涨跌停|交易保证金|套保额度/i;

const HARD_RULE_RE = /限仓|持仓限额|交易限额|保证金|手续费|涨跌停|提保|扩板/i;

/** 媒体转载常见公告标题（未必含交易所全称） */
const FORMAL_FUTURES_NOTICE_RE =
  /关于.*(期货|期权|合约).*(通知|公告)|关于.*(调整|修订|加强|就).*(手续费|保证金|涨跌停|限仓|持仓|交易时间|夜盘|交易限额|合约|办法|细则)|关于.*(管理办法|业务细则|合约).*(通知|公告|征求意见)|《[^》]*?(商品|期货)交易所[^》]*》/;

const EXCHANGE_SHORT_MAP = {
  shfe: '上期所',
  ine: '能源中心',
  dce: '大商所',
  zce: '郑商所',
  cffex: '中金所',
  gfex: '广期所',
};

const SINA_EXCHANGE_LIDS = [2516, 2517, 2518, 2519, 2520];
const EM_FAST_COLUMNS = [106, 102, 107];
const EM_SEARCH_QUERIES = [
  '郑商所 通知',
  '郑商所 公告',
  '郑州商品交易所 通知',
  '动力煤 期货 公告',
  '油菜籽 期货 郑商所',
  '大商所 通知',
  '上期所 通知',
  '期货交易所 保证金',
];

function qualifiesExchangeNotice(text, { mirror = false, relaxed = false } = {}) {
  const hasCnExchange = CN_EXCHANGE_RE.test(text);
  const hasFormalNotice = /交易所.*(通知|公告|函)/.test(text) || FORMAL_FUTURES_NOTICE_RE.test(text);
  const hasHardRule = HARD_RULE_RE.test(text) && /交易所|期货|合约|期权/.test(text);
  if (mirror) {
    if (relaxed && hasCnExchange) return true;
    if (relaxed && FORMAL_FUTURES_NOTICE_RE.test(text)) return true;
    if (hasCnExchange && (hasFormalNotice || hasHardRule || /(通知|公告|函)/.test(text))) return true;
    if (FORMAL_FUTURES_NOTICE_RE.test(text) && /期货|期权|合约|休市|夜盘/.test(text)) return true;
    if (hasHardRule && /(通知|公告)/.test(text)) return true;
    return false;
  }
  return hasCnExchange || hasFormalNotice || hasHardRule;
}

function inferExchangeFromCommodityTags(text) {
  const tags = detectCommodityTags(text);
  const exCounts = {};
  for (const t of tags) {
    const full = findTagById(t.id);
    const ex = full?.exchangeId;
    if (ex) exCounts[ex] = (exCounts[ex] || 0) + 1;
  }
  const sorted = Object.entries(exCounts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
  return EXCHANGE_SHORT_MAP[sorted[0][0]] || null;
}

function extractDateFromEmArticleLink(link) {
  const m = String(link).match(/\/a\/(\d{8})/);
  if (!m) return '';
  const d = m[1];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T08:00:00+08:00`;
}

function parseEastmoneySearchJsonp(text) {
  const start = String(text).indexOf('{');
  const end = String(text).lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn/futuremarket/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const EM_HEADERS = {
  Referer: 'https://kuaixun.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const GFEX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  Referer: 'http://www.gfex.com.cn/gfex/index.shtml',
};

/** 广期所通知正文路径；tzts/list.shtml 为 JS 壳，须用 jysgg 列表页 */
const GFEX_NOTICE_LINK_RE = /\/gfex\/tzts\/\d{6}\/[a-f0-9]+\.shtml/i;
const GFEX_LIST_URLS = ['http://www.gfex.com.cn/gfex/xxgs/jysgg/list.shtml'];

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemKey(item) {
  return crypto.createHash('md5').update(`${item.title}|${item.link}`).digest('hex');
}

function inferExchangeLabel(text) {
  if (/广期所|GFEX|广州期货/.test(text)) return '广期所';
  if (/中金所|CFFEX/.test(text)) return '中金所';
  if (/上期所|SHFE|上海期货/.test(text)) return '上期所';
  if (/大商所|DCE|大连商品/.test(text)) return '大商所';
  if (/郑商所|CZCE|郑州商品/.test(text)) return '郑商所';
  if (/能源中心|INE|上海国际能源/.test(text)) return '能源中心';
  const fromTags = inferExchangeFromCommodityTags(text);
  if (fromTags) return fromTags;
  return '交易所';
}

function normalizeMirrorItem(raw, sourceMeta) {
  const title = stripHtml(raw.title);
  const summary = stripHtml(raw.summary || '');
  const text = `${title} ${summary}`;
  if (!title || !qualifiesExchangeNotice(text, { mirror: sourceMeta.mirror !== false, relaxed: sourceMeta.relaxed === true }))
    return null;

  const tags = detectCommodityTags(text);
  const exchangeLabel = inferExchangeLabel(text);

  return enrichExchangeNoticeSymbols({
    title,
    summary: summary.slice(0, 280),
    link: raw.link || '',
    pubDate: raw.pubDate || raw.publishedAt || raw.fetchedAt || '',
    sourceId: sourceMeta.id,
    sourceName: sourceMeta.name,
    departmentId: 'exchange',
    region: 'cn',
    contentType: HARD_RULE_RE.test(text) ? 'exchange-rule' : 'exchange-rule',
    exchangeMirror: sourceMeta.mirror !== false,
    exchangeLabel,
    commodityTags: tags,
    symbols: tags.map((t) => normalizeCommodityId(t.id)),
    dataSource: sourceMeta.dataSource || 'exchange-notice-fetcher',
    method: sourceMeta.method || 'mirror-filter',
  });
}

function readJsonPool(filePath) {
  const fs = require('fs');
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const row = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return row.items || row.candidates || row.data?.items || row.headlines || [];
  } catch {
    return [];
  }
}

function collectLocalPools() {
  const pools = [];
  const dataDir = getDataDir();
  if (dataDir) {
    pools.push(
      ...readJsonPool(`${dataDir}/history/flash-news-inbox.json`),
      ...readJsonPool(`${dataDir}/news-fast.json`),
      ...readJsonPool(`${dataDir}/policy-radar.json`)
    );
  }
  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    const policy = diskCache.readStale('policy-radar.json')?.data?.items;
    if (policy?.length) pools.push(...policy);
    const fast = diskCache.readStale('news-fast.json')?.items;
    if (fast?.length) pools.push(...fast);
  } catch {
    // ignore
  }
  return pools;
}

function extractMirrorsFromPool(pool = []) {
  const meta = {
    id: 'exchange-pool-mirror',
    name: '资讯池·交易所镜像',
    mirror: true,
    dataSource: 'flash-policy-pool',
    method: 'pool-keyword-filter',
  };
  const out = [];
  const seen = new Set();
  for (const raw of pool) {
    const row = normalizeMirrorItem(raw, meta);
    if (!row) continue;
    const key = itemKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function fetchSinaFuturesExchangeRoll() {
  const merged = [];
  const seen = new Set();
  for (const lid of SINA_EXCHANGE_LIDS) {
    try {
      const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&num=40&page=1`;
      const text = await fetchText(url, { headers: SINA_HEADERS, timeout: 12000, retries: 1 });
      const json = JSON.parse(text);
      const meta = {
        id: 'sina-futures-exchange',
        name: '新浪期货·交易所镜像',
        mirror: true,
        dataSource: `sina-roll-${lid}`,
        method: 'live-roll-filter',
      };
      for (const row of json?.result?.data || []) {
        const item = normalizeMirrorItem(
          {
            title: row.title || row.stitle,
            summary: row.intro || '',
            link: row.url || row.link,
            pubDate: row.ctime ? new Date(parseInt(row.ctime, 10) * 1000).toISOString() : '',
          },
          meta
        );
        if (!item) continue;
        const key = itemKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    } catch {
      // per-lid fail ok
    }
  }
  return merged;
}

async function fetchEastmoneyFastColumn(fastColumn, pageSize = 50) {
  const qs = new URLSearchParams({
    client: 'web',
    biz: 'web_724',
    fastColumn: String(fastColumn),
    sortEnd: '',
    pageSize: String(pageSize),
    req_trace: String(Date.now()),
  });
  const text = await fetchText(`https://np-weblist.eastmoney.com/comm/web/getFastNewsList?${qs}`, {
    headers: EM_HEADERS,
    timeout: 12000,
    retries: 1,
  });
  const json = JSON.parse(text);
  const meta = {
    id: `eastmoney-fast-${fastColumn}`,
    name: `东财快讯·交易所镜像(${fastColumn})`,
    mirror: true,
    dataSource: `eastmoney-fast-${fastColumn}`,
    method: 'live-fast-filter',
  };
  return (json?.data?.fastNewsList || [])
    .map((row) =>
      normalizeMirrorItem(
        {
          title: row.title || row.summary,
          summary: row.summary || '',
          link: row.code ? `https://finance.eastmoney.com/a/${row.code}.html` : '',
          pubDate: row.showTime || row.realSort || '',
        },
        meta
      )
    )
    .filter(Boolean);
}

async function fetchEastmoneyCommodityExchange() {
  const merged = [];
  const seen = new Set();
  for (const col of EM_FAST_COLUMNS) {
    try {
      for (const item of await fetchEastmoneyFastColumn(col, 50)) {
        const key = itemKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    } catch {
      // ignore
    }
  }
  return merged;
}

async function fetchEastmoneyFuturesHomeNotices() {
  const html = await fetchText('https://futures.eastmoney.com/', {
    timeout: 18000,
    headers: {
      ...EM_HEADERS,
      Referer: 'https://finance.eastmoney.com/',
    },
    retries: 1,
  });
  const meta = {
    id: 'eastmoney-futures-home',
    name: '东财期货首页·交易所镜像',
    mirror: true,
    relaxed: true,
    dataSource: 'eastmoney-futures-home',
    method: 'futures-home-parse',
  };
  const out = [];
  const seen = new Set();
  const re = /href="(https:\/\/finance\.eastmoney\.com\/a\/\d+\.html)"[^>]*>([^<]{10,200})</gi;
  let m;
  while ((m = re.exec(html)) && out.length < 80) {
    const title = stripHtml(m[2].replace(/&gt;/g, '>'));
    if (!title || /台风|猪企|养殖场|行情&gt;&gt;/.test(title)) continue;
    const link = m[1];
    const item = normalizeMirrorItem(
      {
        title,
        summary: '',
        link,
        pubDate: extractDateFromEmArticleLink(link),
      },
      meta
    );
    if (!item) continue;
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchEastmoneySearchMirror(query) {
  const qs = new URLSearchParams({
    type: 'cmsArticleWebOld',
    client: 'web',
    clientType: 'web',
    clientVersion: '1.0.0',
    keyword: query,
    pageindex: '1',
    pagesize: '25',
  });
  const text = await fetchText(`https://search-api-web.eastmoney.com/search/jsonp?${qs}&cb=emCb`, {
    headers: { ...EM_HEADERS, Referer: 'https://so.eastmoney.com/' },
    timeout: 15000,
    retries: 1,
  });
  const parsed = parseEastmoneySearchJsonp(text);
  if (!parsed) return [];
  const list = parsed?.result?.cmsArticleWebOld || parsed?.result?.cmsArticle || [];
  const meta = {
    id: 'eastmoney-search-exchange',
    name: `东财搜索·${query}`,
    mirror: true,
    dataSource: 'eastmoney-search',
    method: 'search-keyword',
  };
  return list
    .map((row) =>
      normalizeMirrorItem(
        {
          title: row.title,
          summary: row.content || '',
          link: row.url || (row.code ? `https://finance.eastmoney.com/a/${row.code}.html` : ''),
          pubDate: row.date || row.showTime || '',
        },
        meta
      )
    )
    .filter(Boolean);
}

async function fetchEastmoneyExchangeSearchBundle() {
  const merged = [];
  const seen = new Set();
  for (const q of EM_SEARCH_QUERIES) {
    try {
      for (const item of await fetchEastmoneySearchMirror(q)) {
        const key = itemKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    } catch {
      // ignore
    }
  }
  return merged;
}

function extractDateFromGfexLink(link) {
  const m = String(link).match(/\/tzts\/(\d{4})(\d{2})\//);
  if (!m) return '';
  return `${m[1]}-${m[2]}-01T08:00:00+08:00`;
}

function parseGfexNoticesFromHtml(html, baseUrl, limit = 25) {
  const seen = new Set();
  const items = [];
  const textRe = /<a[^>]+href="([^"]+)"[^>]*>([^<]{8,200})</gi;
  let m;
  while ((m = textRe.exec(html)) && items.length < limit) {
    const rawLink = m[1];
    if (!GFEX_NOTICE_LINK_RE.test(rawLink)) continue;
    const title = stripHtml(m[2]);
    if (!title || title.length < 8) continue;
    if (/查看更多|点击了解|下载|行情|资料/.test(title)) continue;
    const link = rawLink.startsWith('http') ? rawLink : new URL(rawLink, baseUrl).href;
    const key = `${link}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(
      enrichExchangeNoticeSymbols({
        title,
        summary: '',
        link,
        pubDate: extractDateFromGfexLink(link),
        sourceId: 'gfex-notice',
        sourceName: '广期所·通知公告',
        departmentId: 'exchange',
        region: 'cn',
        contentType: 'exchange-rule',
        exchangeMirror: false,
        exchangeLabel: '广期所',
        dataSource: 'gfex-html-direct',
        method: 'jysgg-list-parse',
      })
    );
  }
  return items;
}

async function fetchGfexNoticesDirect() {
  const errors = [];
  for (const url of GFEX_LIST_URLS) {
    try {
      const html = await fetchText(url, {
        timeout: 20000,
        headers: GFEX_HEADERS,
        retries: 2,
      });
      const items = parseGfexNoticesFromHtml(html, 'http://www.gfex.com.cn/', 25);
      if (items.length) return { items, errors };
    } catch (err) {
      errors.push({ url, message: err.message || String(err) });
    }
  }
  return { items: [], errors };
}

async function fetchCffexNoticesDirect() {
  const feed = POLICY_HTML_FEEDS.find((f) => f.id === 'cffex-notice');
  if (!feed) return [];
  try {
    const html = await fetchText(feed.url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      retries: 2,
    });
    const seen = new Set();
    const out = [];
    const cffexRe = /\/cn\/(jysgg|zljggzdt)\/\d+\/\d+\.html/i;
    const push = (rawLink, title) => {
      if (!title || title.length < 8) return;
      const link = rawLink.startsWith('http') ? rawLink : new URL(rawLink, feed.baseUrl).href;
      if (!cffexRe.test(link)) return;
      const key = `${link}|${title}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(
        enrichExchangeNoticeSymbols({
          title: stripHtml(title),
          summary: '',
          link,
          pubDate: '',
          sourceId: feed.id,
          sourceName: feed.name,
          departmentId: 'exchange',
          region: 'cn',
          contentType: 'exchange-rule',
          exchangeMirror: false,
          exchangeLabel: '中金所',
          dataSource: 'policy-html-direct',
          method: 'html-direct',
        })
      );
    };
    let m;
    const titleRe = /href="([^"]+)"[^>]*title="([^"]+)"/g;
    while ((m = titleRe.exec(html)) && out.length < (feed.limit || 20) + 20) {
      push(m[1], m[2]);
    }
    if (out.length < Math.min(8, feed.limit || 20)) {
      const textRe = /<a[^>]+href="([^"]+)"[^>]*>([^<]{8,160})</g;
      while ((m = textRe.exec(html)) && out.length < (feed.limit || 20) + 20) {
        push(m[1], m[2]);
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchDirectExchangeHtml() {
  const [cffexSettled, gfexSettled] = await Promise.allSettled([
    fetchCffexNoticesDirect(),
    fetchGfexNoticesDirect(),
  ]);
  const out = [];
  if (cffexSettled.status === 'fulfilled') out.push(...cffexSettled.value);
  if (gfexSettled.status === 'fulfilled') out.push(...gfexSettled.value.items);
  return out.slice(0, 50);
}

function dedupeItems(items) {
  const map = new Map();
  for (const raw of items) {
    const item = enrichExchangeNoticeSymbols(raw);
    const key = itemKey(item);
    const prev = map.get(key);
    if (!prev || (prev.exchangeMirror && !item.exchangeMirror)) {
      map.set(key, item);
    }
  }
  return [...map.values()].sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
}

async function fetchEastmoneyGfexMirror() {
  const qs = new URLSearchParams({
    client: 'web',
    biz: 'web_724',
    fastColumn: '106',
    sortEnd: '',
    pageSize: '80',
    req_trace: String(Date.now()),
  });
  const text = await fetchText(`https://np-weblist.eastmoney.com/comm/web/getFastNewsList?${qs}`, {
    headers: EM_HEADERS,
    timeout: 12000,
    retries: 1,
  });
  const json = JSON.parse(text);
  const meta = {
    id: 'eastmoney-gfex-mirror',
    name: '东财商品·广期所镜像',
    mirror: true,
    dataSource: 'eastmoney-fast-106-gfex',
    method: 'gfex-keyword-filter',
  };
  return (json?.data?.fastNewsList || [])
    .map((row) =>
      normalizeMirrorItem(
        {
          title: row.title || row.summary,
          summary: row.summary || '',
          link: row.code ? `https://finance.eastmoney.com/a/${row.code}.html` : '',
          pubDate: row.showTime || row.realSort || '',
        },
        meta
      )
    )
    .filter((it) => it && it.exchangeLabel === '广期所');
}

async function fetchExchangeNoticeBundle() {
  const errors = [];
  const [
    directSettled,
    dceApiSettled,
    poolMirrorsSettled,
    sinaSettled,
    emSettled,
    emGfexSettled,
    emHomeSettled,
    emSearchSettled,
  ] = await Promise.allSettled([
    fetchDirectExchangeHtml(),
    (async () => {
      try {
        const { fetchDcePortalNotices } = require('./dce-portal-api-fetcher');
        return await fetchDcePortalNotices();
      } catch (err) {
        return { items: [], configured: false, error: err.message };
      }
    })(),
    Promise.resolve(extractMirrorsFromPool(collectLocalPools())),
    fetchSinaFuturesExchangeRoll(),
    fetchEastmoneyCommodityExchange(),
    fetchEastmoneyGfexMirror(),
    fetchEastmoneyFuturesHomeNotices(),
    fetchEastmoneyExchangeSearchBundle(),
  ]);

  const merged = [];
  if (directSettled.status === 'fulfilled') merged.push(...directSettled.value);
  else errors.push({ lane: 'direct-html', message: directSettled.reason?.message });

  if (dceApiSettled.status === 'fulfilled') {
    const dce = dceApiSettled.value;
    if (dce?.items?.length) merged.push(...dce.items);
    else if (dce?.error) errors.push({ lane: 'dce-portal-api', message: dce.error });
  } else {
    errors.push({ lane: 'dce-portal-api', message: dceApiSettled.reason?.message });
  }

  if (poolMirrorsSettled.status === 'fulfilled') merged.push(...(poolMirrorsSettled.value || []));
  else errors.push({ lane: 'pool-mirror', message: poolMirrorsSettled.reason?.message });

  if (sinaSettled.status === 'fulfilled') merged.push(...sinaSettled.value);
  else errors.push({ lane: 'sina-roll', message: sinaSettled.reason?.message });

  if (emSettled.status === 'fulfilled') merged.push(...emSettled.value);
  else errors.push({ lane: 'eastmoney-fast', message: emSettled.reason?.message });

  if (emGfexSettled.status === 'fulfilled') merged.push(...emGfexSettled.value);
  else errors.push({ lane: 'eastmoney-gfex', message: emGfexSettled.reason?.message });

  if (emHomeSettled.status === 'fulfilled') merged.push(...emHomeSettled.value);
  else errors.push({ lane: 'eastmoney-futures-home', message: emHomeSettled.reason?.message });

  if (emSearchSettled.status === 'fulfilled') merged.push(...emSearchSettled.value);
  else errors.push({ lane: 'eastmoney-search', message: emSearchSettled.reason?.message });

  const items = dedupeItems(merged);
  const payload = {
    version: EXCHANGE_NOTICE_VERSION,
    items,
    dcePortal: (() => {
      try {
        const { isDcePortalConfigured } = require('./dce-portal-api-fetcher');
        return { configured: isDcePortalConfigured(), awaitingRegistration: !isDcePortalConfigured() };
      } catch {
        return null;
      }
    })(),
    stats: {
      total: items.length,
      direct: items.filter((i) => !i.exchangeMirror).length,
      mirror: items.filter((i) => i.exchangeMirror).length,
      byExchange: items.reduce((acc, i) => {
        const k = i.exchangeLabel || '其他';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      byLane: items.reduce((acc, i) => {
        const k = i.dataSource || i.method || 'other';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    },
    errors: errors.length ? errors : undefined,
    fetchedAt: new Date().toISOString(),
    dataSource: 'exchange-notice-fetcher',
  };

  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    diskCache.write(DISK_KEY, { data: payload, savedAt: Date.now() });
  } catch {
    // ignore
  }

  return items;
}

function getCachedExchangeNoticeBundle() {
  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    return diskCache.readStale(DISK_KEY)?.data || null;
  } catch {
    return null;
  }
}

module.exports = {
  EXCHANGE_NOTICE_VERSION,
  EXCHANGE_NOTICE_RE,
  GFEX_NOTICE_LINK_RE,
  fetchExchangeNoticeBundle,
  fetchGfexNoticesDirect,
  getCachedExchangeNoticeBundle,
  extractMirrorsFromPool,
  parseGfexNoticesFromHtml,
};
