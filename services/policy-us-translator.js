const crypto = require('crypto');
const { fetchJson } = require('./http-client');
const diskCache = require('./disk-cache');
const {
  translateRegulatoryTitleLocal,
  isAcceptableChinese,
  buildFallbackTitle,
  latinWordCount,
} = require('./policy-en-zh-dict');

const CACHE_KEY = 'policy-us-translations.json';
const CACHE_VERSION = 2;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const API_GAP_MS = 800;

const SOURCE_NAME_ZH = {
  'Federal Register': '联邦公报',
  'SEC Press Releases': 'SEC 新闻稿',
  'Federal Reserve Press': '美联储新闻稿',
};

const DOCUMENT_TYPE_ZH = {
  RULE: '最终规则',
  PRORULE: '拟议规则',
  NOTICE: '公告',
  PRESDOCU: '总统文件',
  PRDOC: '公告',
};

let memoryCache = null;
let apiBlockedUntil = 0;

function hashText(text) {
  return crypto.createHash('md5').update(String(text || '').trim()).digest('hex');
}

function isMostlyEnglish(text) {
  return !isAcceptableChinese(text);
}

function isValidTranslation(source, translated) {
  if (!translated || !source) return false;
  if (translated.trim() === source.trim()) return false;
  return isAcceptableChinese(translated);
}

function purgeBadCacheEntries(cache) {
  for (const [key, value] of Object.entries(cache)) {
    if (!value || !isAcceptableChinese(value)) delete cache[key];
  }
}

function loadTranslationCache() {
  if (memoryCache) return memoryCache;
  const stored = diskCache.read(CACHE_KEY, CACHE_TTL_MS) || diskCache.readStale(CACHE_KEY);
  if (stored?.version === CACHE_VERSION && stored?.entries) {
    memoryCache = stored.entries;
  } else {
    memoryCache = {};
  }
  purgeBadCacheEntries(memoryCache);
  return memoryCache;
}

function saveTranslationCache() {
  diskCache.write(CACHE_KEY, { version: CACHE_VERSION, entries: memoryCache, savedAt: Date.now() });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateViaMyMemory(text) {
  if (Date.now() < apiBlockedUntil) return '';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 380))}&langpair=en|zh-CN`;
  try {
    const json = await fetchJson(url, { timeout: 12000, retries: 0 });
    const translated = json?.responseData?.translatedText?.trim();
    if (!translated || /MYMEMORY WARNING|QUOTA|INVALID|429/i.test(translated)) {
      apiBlockedUntil = Date.now() + 10 * 60 * 1000;
      return '';
    }
    if (translated.toUpperCase() === text.toUpperCase()) return '';
    return translated;
  } catch (err) {
    if (/429/.test(String(err?.message))) {
      apiBlockedUntil = Date.now() + 10 * 60 * 1000;
    }
    return '';
  }
}

async function translateEnToZh(text, context = {}, { force = false } = {}) {
  const source = String(text || '').trim();
  if (!source) return '';
  if (/[\u4e00-\u9fff]/.test(source) && latinWordCount(source) <= 1) return source;

  const cache = loadTranslationCache();
  const key = hashText(source);
  if (!force && cache[key] && isValidTranslation(source, cache[key])) {
    return cache[key];
  }

  let translated = translateRegulatoryTitleLocal(source);
  if (!isValidTranslation(source, translated)) {
    const api = await translateViaMyMemory(source);
    if (isValidTranslation(source, api)) translated = api;
  }
  if (!isValidTranslation(source, translated)) {
    if (context.mode === 'body') {
      return translateRegulatoryTitleLocal(source);
    }
    translated = buildFallbackTitle(source, context);
  }

  if (isValidTranslation(source, translated)) {
    cache[key] = translated;
    saveTranslationCache();
  }
  return translated;
}

async function mapSequential(items, mapper) {
  const results = [];
  for (const item of items) {
    results.push(await mapper(item));
    if (API_GAP_MS > 0) await sleep(API_GAP_MS);
  }
  return results;
}

async function translateUsPolicyItems(items) {
  const usItems = items.filter((i) => i.region === 'us');
  if (!usItems.length) return items;

  for (const item of usItems) {
    item.titleEn = item.title;
    item.summaryEn = item.summary || '';
    if (item.documentType) {
      item.documentTypeLabel =
        DOCUMENT_TYPE_ZH[String(item.documentType).toUpperCase()] || item.documentType;
    }

    const ctx = {
      departmentShort: item.departmentShort,
      departmentName: item.departmentName,
      documentType: item.documentType,
      documentTypeLabel: item.documentTypeLabel,
      commodities: item.commodities,
    };

    item.title = await translateEnToZh(item.titleEn, ctx, { force: true });
    if (item.summaryEn) {
      item.summary = await translateEnToZh(item.summaryEn, ctx, { force: true });
    }

    item.displayTitle = item.documentTypeLabel
      ? `[${item.documentTypeLabel}] ${item.title}`
      : item.title;

    if (SOURCE_NAME_ZH[item.sourceName]) {
      item.sourceNameEn = item.sourceName;
      item.sourceName = SOURCE_NAME_ZH[item.sourceName];
    }
  }

  return items;
}

function translateDocumentType(type) {
  return DOCUMENT_TYPE_ZH[type] || type || '';
}

module.exports = {
  translateEnToZh,
  translateViaMyMemory,
  translateUsPolicyItems,
  translateDocumentType,
  DOCUMENT_TYPE_ZH,
  isMostlyEnglish,
  isValidTranslation,
};
