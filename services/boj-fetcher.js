const { fetchText } = require('./http-client');
const { fetchFredBatch } = require('./fred-client');
const { readZipEntry, parseSharedStrings, parseSheetRows, findLabelValue } = require('./xlsx-lite');
const { translateBojTitle, translateBojSpeaker } = require('./boj-news-translator');
const { latinWordCount } = require('./policy-en-zh-dict');
const { fetchUsdJpyQuote } = require('./forex-fetcher');
const { extractBojSpeeches } = require('./cb-speeches');
const diskCache = require('./disk-cache');

const BOJ_BASE = 'https://www.boj.or.jp';
const BOJ_PRESS_URL = `${BOJ_BASE}/en/about/press/index.htm`;
const BOJ_RELEASE_URL = `${BOJ_BASE}/en/about/release_2026/index.htm`;
const BOJ_MPM_URL = `${BOJ_BASE}/en/mopo/mpmdeci/mpr_2026/index.htm`;
const BOJ_MUTAN_URL = `${BOJ_BASE}/en/statistics/market/short/mutan/index.htm`;

const BOJ_DISK_KEY = 'boj-source-v3.json';
const BOJ_DISK_TTL_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 12000;

/** FRED 日本宏观序列（需配置 FRED API Key） */
const JP_FRED_SERIES = [
  { id: 'IRSTCI01JPM156N', name: '无担保隔夜拆借利率（FRED）', unit: '%', live: true },
  { id: 'IRLTLT01JPM156N', name: '10 年期国债收益率', unit: '%', live: true },
  { id: 'DEXJPUS', name: '美元/日元汇率（FRED）', unit: '日元', live: true },
  { id: 'JPNCPIALLMINMEI', name: 'CPI 消费者物价指数', unit: '指数' },
  { id: 'JPNPROINDMISMEI', name: '工业产出指数', unit: '指数' },
  { id: 'BOGMBASEJPM461S', name: '货币基础', unit: '十亿日元' },
  { id: 'JPNUNRTOTQ156N', name: '失业率', unit: '%' },
];

const JP_LIVE_NAMES = new Set([
  '无担保隔夜拆借利率（速报）',
  '无担保隔夜拆借利率（平均）',
  '无担保隔夜拆借利率（最高）',
  '无担保隔夜拆借利率（最低）',
  '美元/日元（实时）',
  ...JP_FRED_SERIES.filter((s) => s.live).map((s) => s.name),
]);

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function absBojUrl(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return `${BOJ_BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function parseTableNews(html, { titleCol = 2, dateCol = 0, speakerCol = 1, filterTitle } = {}) {
  const news = [];
  const seen = new Set();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripHtml(m[1]));
    if (cells.length < 2) continue;
    if (/^date$/i.test(cells[dateCol])) continue;

    const title = cells[titleCol] || cells[cells.length - 1];
    if (!title || title.length < 8) continue;
    if (filterTitle && !filterTitle(title)) continue;

    const href = row.match(/href="([^"]+)"/i)?.[1] || '';
    const link = absBojUrl(href);
    const pubDate = cells[dateCol] || '';
    const speaker = speakerCol != null ? cells[speakerCol] : '';
    const key = `${pubDate}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    news.push({
      title,
      link,
      pubDate,
      summary: speaker ? `${speaker}` : '',
    });
  }
  return news;
}

function needsBojTranslation(text) {
  if (!text) return false;
  return latinWordCount(String(text)) >= 3;
}

function ensureBojPayloadLocalized(payload) {
  if (!payload) return payload;
  const news = payload.news?.length
    ? payload.news.map((item) => {
        const title = needsBojTranslation(item.title) ? translateBojTitle(item.title) : item.title;
        const summary =
          item.summary && needsBojTranslation(item.summary)
            ? translateBojSpeaker(item.summary).slice(0, 200)
            : item.summary || '';
        return { ...item, title, summary };
      })
    : [];
  const speeches = news.length ? extractBojSpeeches(news) : payload.speeches || [];
  return { ...payload, news, speeches };
}

function localizeBojNews(news) {
  return news.map((item) => ({
    ...item,
    title: translateBojTitle(item.title),
    summary: item.summary ? translateBojSpeaker(item.summary).slice(0, 200) : '',
  }));
}

async function fetchBojNews() {
  const [pressHtml, releaseHtml, mpmHtml] = await Promise.all([
    fetchText(BOJ_PRESS_URL, { timeout: HTTP_TIMEOUT_MS, retries: 1 }),
    fetchText(BOJ_RELEASE_URL, { timeout: HTTP_TIMEOUT_MS, retries: 1 }).catch(() => ''),
    fetchText(BOJ_MPM_URL, { timeout: HTTP_TIMEOUT_MS, retries: 1 }).catch(() => ''),
  ]);

  const press = parseTableNews(pressHtml, { titleCol: 2, dateCol: 0, speakerCol: 1 }).filter(
    (n) => n.link
  );
  const release = parseTableNews(releaseHtml, { titleCol: 1, dateCol: 0, speakerCol: null });
  const mpm = parseTableNews(mpmHtml, {
    titleCol: 1,
    dateCol: 0,
    speakerCol: null,
    filterTitle: (t) =>
      /statement on monetary policy|monetary policy meeting|outlook for economic activity/i.test(t),
  });

  const merged = [...mpm, ...press, ...release]
    .filter((n) => n.title)
    .sort((a, b) => {
      const da = Date.parse(a.pubDate.replace(/\./g, '')) || 0;
      const db = Date.parse(b.pubDate.replace(/\./g, '')) || 0;
      return db - da;
    })
    .slice(0, 25);

  return localizeBojNews(merged);
}

async function fetchLatestMutanXlsxUrl() {
  const html = await fetchText(BOJ_MUTAN_URL, { timeout: HTTP_TIMEOUT_MS, retries: 2 });
  const href =
    html.match(/href="(\/en\/statistics\/market\/short\/mutan\/d_release\/[^"]+\.xlsx)"/i)?.[1] ||
    html.match(/href="(\/en\/statistics\/market\/short\/mutan\/[^"]+\.xlsx)"/i)?.[1];
  if (!href) throw new Error('未找到日本央行拆借利率数据文件');
  return absBojUrl(href);
}

function parseMutanXlsx(buffer) {
  const shared = parseSharedStrings(readZipEntry(buffer, 'xl/sharedStrings.xml'));
  const rows = parseSheetRows(readZipEntry(buffer, 'xl/worksheets/sheet1.xml'), shared);
  const titleRow = rows.find((r) =>
    String(r.cells.A || '').includes('Uncollateralized Overnight Call Rate')
  );
  const dateMatch = String(titleRow?.cells.A || '').match(/for\s+([A-Za-z]+\s+\d+)/i);
  const date = dateMatch ? dateMatch[1] : '';

  const avg = findLabelValue(rows, ['average', '平均']);
  const max = findLabelValue(rows, ['maximum', '最高']);
  const min = findLabelValue(rows, ['minimum', '最低']);

  const indicators = [];
  if (avg) {
    indicators.push({
      name: '无担保隔夜拆借利率（平均）',
      value: avg.value.toFixed(3),
      date,
      unit: '%',
      live: true,
      source: 'boj',
    });
  }
  if (max) {
    indicators.push({
      name: '无担保隔夜拆借利率（最高）',
      value: max.value.toFixed(3),
      date,
      unit: '%',
      live: true,
      source: 'boj',
    });
  }
  if (min) {
    indicators.push({
      name: '无担保隔夜拆借利率（最低）',
      value: min.value.toFixed(3),
      date,
      unit: '%',
      live: true,
      source: 'boj',
    });
  }
  return indicators;
}

async function fetchBojCallMoneyIndicators() {
  const url = await fetchLatestMutanXlsxUrl();
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`日本央行拆借利率下载失败 (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return parseMutanXlsx(buffer);
}

async function fetchUsdJpyLive() {
  const quote = await fetchUsdJpyQuote();
  if (!quote) return null;
  return {
    name: '美元/日元（实时）',
    value: quote.price.toFixed(2),
    date: quote.tradeDate || new Date().toISOString().slice(0, 10),
    change: quote.change != null ? quote.change.toFixed(4) : null,
    unit: '日元',
    live: true,
    source: 'sina',
  };
}

async function fetchFredJapanIndicators(seriesList = JP_FRED_SERIES) {
  const rows = await fetchFredBatch(seriesList);
  return rows.map((r) => ({
    name: r.name,
    value: r.value,
    date: r.date,
    change: r.change,
    unit: r.unit,
    live: Boolean(r.live),
    source: 'fred',
    seriesId: r.id,
  }));
}

async function fetchBojIndicators({ liveOnly = false } = {}) {
  const tasks = liveOnly
    ? [
        fetchBojCallMoneyIndicators().catch(() => []),
        fetchUsdJpyLive().catch(() => null),
        fetchFredJapanIndicators(JP_FRED_SERIES.filter((s) => s.live)).catch(() => []),
      ]
    : [
        fetchBojCallMoneyIndicators().catch(() => []),
        fetchUsdJpyLive().catch(() => null),
        fetchFredJapanIndicators().catch(() => []),
      ];

  const [callMoney, usdjpy, fredRows] = await Promise.all(tasks);
  const indicators = [...(Array.isArray(callMoney) ? callMoney : []), ...(Array.isArray(fredRows) ? fredRows : [])];
  if (usdjpy) indicators.unshift(usdjpy);
  return indicators.filter((i) => i.value != null && i.value !== '');
}

async function fetchBojSource() {
  const [news, indicators] = await Promise.all([fetchBojNews(), fetchBojIndicators()]);
  const speeches = extractBojSpeeches(news);

  const payload = {
    key: 'boj',
    name: '日本央行',
    news,
    speeches,
    indicators,
    dataLabel: '日本货币政策与核心指标（日本央行 · FRED · 新浪）',
    updatedAt: new Date().toISOString(),
  };

  diskCache.write(BOJ_DISK_KEY, { data: payload, localeVersion: 3 });
  return ensureBojPayloadLocalized(payload);
}

function getCachedBojSource() {
  const stored = diskCache.read(BOJ_DISK_KEY, BOJ_DISK_TTL_MS) || diskCache.readStale(BOJ_DISK_KEY);
  if (!stored?.data) return null;
  return ensureBojPayloadLocalized(stored.data);
}

async function fetchBojLive() {
  const cached = getCachedBojSource();
  const [liveIndicators, newsRaw] = await Promise.all([
    fetchBojIndicators({ liveOnly: true }),
    fetchBojNews().catch(() => null),
  ]);
  const news = newsRaw?.length
    ? newsRaw
    : localizeBojNews(cached?.news || []);
  const speeches = news.length ? extractBojSpeeches(news) : cached?.speeches || [];
  const liveMap = new Map(liveIndicators.map((i) => [i.name, i]));

  if (!cached?.indicators?.length && !news.length) {
    const fresh = await fetchBojSource();
    return { ...fresh, liveRefreshedAt: new Date().toISOString() };
  }

  const baseIndicators = cached?.indicators?.length ? cached.indicators : liveIndicators;
  const mergedIndicators = baseIndicators.map((ind) => {
    const live = liveMap.get(ind.name);
    return live ? { ...ind, ...live } : ind;
  });

  for (const live of liveIndicators) {
    if (!mergedIndicators.some((i) => i.name === live.name)) mergedIndicators.unshift(live);
  }

  const payload = {
    ...(cached || {
      key: 'boj',
      name: '日本央行',
      dataLabel: '日本货币政策与核心指标（日本央行 · FRED · 新浪）',
    }),
    news,
    speeches,
    indicators: mergedIndicators,
    updatedAt: new Date().toISOString(),
    liveRefreshedAt: new Date().toISOString(),
  };

  diskCache.write(BOJ_DISK_KEY, { data: payload, localeVersion: 3 });
  return ensureBojPayloadLocalized(payload);
}

let bojRefreshPromise = null;
function refreshBojInBackground() {
  if (bojRefreshPromise) return bojRefreshPromise;
  bojRefreshPromise = fetchBojLive()
    .catch(() => null)
    .finally(() => {
      bojRefreshPromise = null;
    });
  return bojRefreshPromise;
}

module.exports = {
  fetchBojSource,
  fetchBojLive,
  getCachedBojSource,
  refreshBojInBackground,
  fetchBojIndicators,
  fetchBojNews,
  ensureBojPayloadLocalized,
  localizeBojNews,
  JP_FRED_SERIES,
  JP_LIVE_NAMES,
};
