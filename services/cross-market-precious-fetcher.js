/**
 * 跨境贵金属日—COMEX GC/SI + 伦敦银落'
 * 缓存: {dataDir}/history/comex-*-daily.json, fred-london-silver-daily.json
 */
const fs = require('fs');
const path = require('path');
const { fetchJson } = require('./http-client');
const { getDataDir } = require('./data-paths');
const { fetchAndCacheSeries, getHistoryDir, DEFAULT_START } = require('./fred-history-fetcher');

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn/futures/quotes/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const COMEX_CONFIG = {
  gc: {
    file: 'comex-gc-daily.json',
    sinaSymbol: 'GC',
    label: 'COMEX Gold (Sina Global Futures GC)',
    seriesId: 'GC',
  },
  si: {
    file: 'comex-si-daily.json',
    sinaSymbol: 'SI',
    label: 'COMEX Silver (Sina Global Futures SI)',
    seriesId: 'SI',
  },
};

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function seriesFilePath(filename) {
  return path.join(getHistoryDir(), filename);
}

function loadLocalSeries(filename) {
  const p = seriesFilePath(filename);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return null;
}

function saveLocalSeries(filename, payload) {
  fs.writeFileSync(seriesFilePath(filename), JSON.stringify(payload, null, 2), 'utf8');
  return seriesFilePath(filename);
}

async function fetchSinaGlobalFuturesDaily(symbol, startDate = DEFAULT_START) {
  const url = `https://stock2.finance.sina.com.cn/futures/api/json.php/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${encodeURIComponent(symbol)}&___qn=5000`;
  const rows = await fetchJson(url, { headers: SINA_HEADERS, retries: 3, timeout: 45000 });
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => ({
      date: normDate(r.date),
      value: Number(r.close),
    }))
    .filter((r) => r.date >= startDate && r.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchAndCacheComex(key, { startDate = DEFAULT_START, force = false } = {}) {
  const cfg = COMEX_CONFIG[key];
  if (!cfg) throw new Error(`Unknown COMEX key: ${key}`);

  if (!force) {
    const local = loadLocalSeries(cfg.file);
    if (local?.series?.length >= 50) {
      return { ...local, fromCache: true, jsonPath: seriesFilePath(cfg.file) };
    }
  }

  const series = await fetchSinaGlobalFuturesDaily(cfg.sinaSymbol, startDate);
  if (series.length < 20) {
    throw new Error(`${cfg.sinaSymbol} 日频不足 (${series.length})`);
  }

  const payload = {
    seriesId: cfg.seriesId,
    label: cfg.label,
    freq: 'daily',
    source: 'sina-global-futures',
    startDate,
    fetchedAt: new Date().toISOString(),
    series,
    rowCount: series.length,
  };
  const jsonPath = saveLocalSeries(cfg.file, payload);
  return { ...payload, fromCache: false, jsonPath };
}

async function fetchAndCacheLondonSilver({ startDate = DEFAULT_START, force = false } = {}) {
  if (!force) {
    const local = loadLocalSeries('fred-london-silver-daily.json');
    if (local?.series?.length >= 50) {
      return { ...local, fromCache: true, jsonPath: seriesFilePath('fred-london-silver-daily.json') };
    }
  }

  let payload = null;
  try {
    payload = await fetchAndCacheSeries('SLVPRUSD', { startDate, force: true });
  } catch {
    payload = null;
  }

  if (payload?.series?.length >= 20) {
    return { ...payload, fromCache: false, jsonPath: seriesFilePath('fred-london-silver-daily.json') };
  }

  const proxySeries = await fetchSinaGlobalFuturesDaily('XAG', startDate);
  if (proxySeries.length < 20) {
    throw new Error('伦敦·FRED·XAG 代理均不可用');
  }

  const fallback = {
    seriesId: 'SLVPRUSD',
    label: 'London silver spot proxy (Sina XAG)',
    freq: 'daily',
    source: 'sina-global-futures-xag-proxy',
    proxySeries: 'SLVPRUSD',
    proxy: true,
    startDate,
    fetchedAt: new Date().toISOString(),
    series: proxySeries,
    rowCount: proxySeries.length,
    note: 'FRED SLVPRUSD 不可达时回退新浪 XAG 现货',
  };
  const jsonPath = saveLocalSeries('fred-london-silver-daily.json', fallback);
  return { ...fallback, fromCache: false, jsonPath };
}

async function saveCrossMarketPreciousHistory({ startDate = DEFAULT_START, force = false } = {}) {
  const gc = await fetchAndCacheComex('gc', { startDate, force });
  await new Promise((r) => setTimeout(r, 300));
  const si = await fetchAndCacheComex('si', { startDate, force });
  await new Promise((r) => setTimeout(r, 300));
  const londonSilver = await fetchAndCacheLondonSilver({ startDate, force });

  return {
    gc,
    si,
    londonSilver,
    dataDir: getDataDir(),
  };
}

function loadHistoryBars(filename) {
  const fp = seriesFilePath(filename);
  if (!fs.existsSync(fp)) return { bars: [], source: null, file: filename };
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const bars = (raw.series || [])
      .map((r) => ({
        date: normDate(r.date),
        close: Number(r.value ?? r.close ?? 0),
      }))
      .filter((b) => b.close > 0 && b.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      bars,
      source: raw.source || raw.seriesId || filename,
      label: raw.label || null,
      proxy: Boolean(raw.proxy),
      file: filename,
      rowCount: bars.length,
    };
  } catch {
    return { bars: [], source: null, file: filename };
  }
}

module.exports = {
  COMEX_CONFIG,
  fetchSinaGlobalFuturesDaily,
  fetchAndCacheComex,
  fetchAndCacheLondonSilver,
  saveCrossMarketPreciousHistory,
  loadHistoryBars,
};
