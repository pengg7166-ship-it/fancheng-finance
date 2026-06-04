const { fetchWithFallback } = require('./http-client');
const { translateNewsOffline, isMostlyEnglish } = require('./offline-translate');

const cache = new Map();

const TERM_MAP = [
  ['Federal Reserve', '美联储'],
  ['Board of Governors', '理事会'],
  ['Monetary Policy', '货币政策'],
  ['Treasury', '美国财政部'],
  ['Department of the Treasury', '美国财政部'],
  ['FOMC', '联邦公开市场委员会'],
  ['Stooq', '欧洲历史数据'],
  ['apikey', '接口密钥'],
  ['OHLCV', '开高低收量'],
  ['fetch failed', '网络连接失败'],
  ['socket hang up', '连接被中断'],
  ['ERR_EMPTY_RESPONSE', '服务器无响应'],
  ['ETIMEDOUT', '连接超时'],
  ['connect ETIMEDOUT', '连接超时'],
  ['Network request failed', '网络请求失败'],
];

function applyTermMap(text) {
  let out = String(text);
  for (const [en, zh] of TERM_MAP) {
    out = out.split(en).join(zh);
  }
  return out;
}

async function translateGoogle(text) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', 'zh-CN');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text.slice(0, 450));

  const res = await fetchWithFallback(url, { timeout: 3500, retries: 0 });
  const json = await res.json();
  const parts = (json[0] || []).map((p) => p[0]).join('');
  const translated = parts?.trim();
  if (!translated || /error/i.test(translated)) return null;
  return translated;
}

async function translateMyMemory(text) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text.slice(0, 450));
  url.searchParams.set('langpair', 'en|zh-CN');

  const res = await fetchWithFallback(url, { timeout: 3500, retries: 0 });
  const json = await res.json();
  const translated = json.responseData?.translatedText?.trim();
  if (
    !translated ||
    translated.toUpperCase() === text.toUpperCase() ||
    /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)
  ) {
    return null;
  }
  return translated;
}

async function translateOne(text) {
  const trimmed = String(text).trim();
  if (!trimmed || !isMostlyEnglish(trimmed)) return trimmed;
  if (cache.has(trimmed)) return cache.get(trimmed);

  const result = await Promise.race([
    translateOneInner(trimmed),
    new Promise((resolve) => setTimeout(() => resolve(translateNewsOffline(trimmed)), 4500)),
  ]);

  if (cache.size > 2000) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(trimmed, result);
  return result;
}

async function translateOneInner(trimmed) {
  let result = null;

  try {
    result = await translateGoogle(trimmed);
  } catch {
    // 在线翻译不可用时走离线规则
  }

  if (!result || isMostlyEnglish(result)) {
    try {
      const mm = await translateMyMemory(trimmed);
      if (mm && !isMostlyEnglish(mm)) result = mm;
    } catch {
      // ignore
    }
  }

  if (!result || isMostlyEnglish(result)) {
    const reg = require('./policy-en-zh-dict').translateRegulatoryTitleLocal(trimmed);
    if (reg && !isMostlyEnglish(reg)) result = reg;
  }

  if (!result || isMostlyEnglish(result)) {
    result = translateNewsOffline(trimmed);
  } else {
    result = applyTermMap(result);
  }

  return result;
}

async function translateBatch(texts, concurrency = 2) {
  const unique = [...new Set(texts.filter(Boolean))];
  const result = new Map();
  let index = 0;

  async function worker() {
    while (index < unique.length) {
      const i = index++;
      const src = unique[i];
      result.set(src, await translateOne(src));
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return (text) => (text ? result.get(text) || translateNewsOffline(text) : text);
}

function localizeErrorMessage(message) {
  if (!message) return '未知错误';

  const map = {
    'FRED API 400': '美联储数据接口请求无效（400）',
    'FRED API 403': '美联储数据接口密钥无效或未授权（403）',
    'FRED API 404': '未找到对应经济数据（404）',
    'FRED API 429': '美联储数据接口请求过于频繁（429）',
    'FRED API 500': '美联储数据接口服务器错误（500）',
    'fetch failed': '网络连接失败',
    'socket hang up': '网络连接被中断',
    'ERR_EMPTY_RESPONSE': '数据服务器无响应',
    'connect ETIMEDOUT': '连接超时，请检查网络',
    'ETIMEDOUT': '连接超时，请检查网络',
    'Network request failed': '网络请求失败',
    'The user aborted a request': '请求已超时',
    'K线数据源暂时不可用，请稍后重试': 'K线数据源暂时不可用，请稍后重试',
    '欧洲等地指数 K 线需配置历史数据密钥，请在设置中填写':
      '欧洲等地指数 K 线需配置历史数据密钥，请在设置中填写',
    '历史数据密钥无效或已过期，请重新申请': '历史数据密钥无效或已过期，请重新申请',
  };

  let out = String(message);
  for (const [key, zh] of Object.entries(map)) {
    if (out.includes(key)) return zh;
  }
  if (/^FRED API \d+$/.test(out)) {
    return `美联储数据接口错误（${out.replace('FRED API ', '')}）`;
  }
  if (/^HTTP \d+$/.test(out)) {
    return `网络请求失败（${out.replace('HTTP ', '')}）`;
  }

  out = applyTermMap(out);
  if (isMostlyEnglish(out)) {
    return '操作失败，请检查网络或稍后重试';
  }
  return out;
}

module.exports = {
  translateOne,
  translateBatch,
  isMostlyEnglish,
  localizeErrorMessage,
  applyTermMap,
};
