const { fetchText } = require('./http-client');
const config = require('./config');

const STOOQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const INTERVALS = {
  day: 'd',
  month: 'm',
  year: 'm',
  hour: 'h',
};

function needsApiKey(text) {
  return /apikey|Uzyskaj apikey|Get your apikey/i.test(text);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('date') || header.includes('data');
  const rows = hasHeader ? lines.slice(1) : lines;
  const bars = [];

  for (const line of rows) {
    const parts = line.split(',');
    if (parts.length < 5) continue;

    const dateRaw = parts[0].trim();
    const open = parseFloat(parts[1]);
    const high = parseFloat(parts[2]);
    const low = parseFloat(parts[3]);
    const close = parseFloat(parts[4]);
    const volume = parts[5] ? parseFloat(parts[5]) : 0;

    if ([open, high, low, close].some((v) => Number.isNaN(v))) continue;
    if (/^B\/D$/i.test(dateRaw) || /^B\/D$/i.test(String(close))) continue;

    const date = dateRaw.includes('-')
      ? dateRaw.slice(0, 10)
      : `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;

    bars.push({
      date,
      open,
      high,
      low,
      close,
      volume: Number.isNaN(volume) ? 0 : volume,
    });
  }

  return bars;
}

function cutoffDate(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function fetchStooqHistory(symbol, timeframe = 'day', maxYears = 20) {
  const interval = INTERVALS[timeframe];
  if (!interval) throw new Error('该周期暂不支持历史数据下载');

  const apiKey = config.getStooqApiKey();
  const url = new URL('https://stooq.pl/q/d/l/');
  url.searchParams.set('s', symbol.toLowerCase());
  url.searchParams.set('d1', cutoffDate(maxYears));
  url.searchParams.set('d2', todayYmd());
  url.searchParams.set('i', interval);
  if (apiKey) url.searchParams.set('apikey', apiKey);

  const text = await fetchText(url.toString(), {
    headers: STOOQ_HEADERS,
    timeout: 60000,
    retries: 2,
  });

  if (needsApiKey(text)) {
    if (!apiKey) {
      throw new Error('欧洲等地指数 K 线需配置历史数据密钥，请在设置中填写');
    }
    throw new Error('历史数据密钥无效或已过期，请重新申请');
  }

  const bars = parseCsv(text);
  if (bars.length < 2) {
    throw new Error('历史数据返回不足，请稍后重试');
  }

  return bars;
}

module.exports = {
  fetchStooqHistory,
  parseCsv,
  needsApiKey,
};
