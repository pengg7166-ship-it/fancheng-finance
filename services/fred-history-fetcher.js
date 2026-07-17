/**
 * FRED 宏观历史序列 '2019+ 日频/月频，CSV 优先，可'FRED API 回退
 * 缓存目录: {dataDir}/history/fred-*.json
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { parseFredCsvFull, fetchFredSeriesHistoryCsv } = require('./fred-client');
const { fetchText } = require('./http-client');
const { isFredApiKeyConfigured, getFredApiKey } = require('./config');

const DEFAULT_START = '2019-01-01';
const FRED_CSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://fred.stlouisfed.org/',
  Accept: 'text/csv,*/*',
};

const SERIES_CONFIG = {
  DFF: { file: 'fred-dff-daily.json', freq: 'daily', label: '联邦基金利率' },
  VIXCLS: { file: 'fred-vixcls-daily.json', freq: 'daily', label: 'VIX' },
  REAINTRATREARAT10Y: { file: 'fred-real10y-daily.json', freq: 'daily', label: '10年实际利' },
  M2SL: { file: 'fred-m2sl-monthly.json', freq: 'monthly', label: 'M2 货币供应' },
  DTWEXBGS: { file: 'fred-dxy-daily.json', freq: 'daily', label: '广义美元指数' },
  DCOILBRENTEU: { file: 'fred-brent-daily.json', freq: 'daily', label: 'Brent 原油现货' },
  DCOILWTICO: { file: 'fred-wti-daily.json', freq: 'daily', label: 'WTI 原油现货' },
  GOLDAMGBD228NLBM: { file: 'fred-london-gold-daily.json', freq: 'daily', label: '伦敦·AM 定盘', optional: true },
  SLVPRUSD: { file: 'fred-london-silver-daily.json', freq: 'daily', label: '伦敦银定', optional: true },
  DEXCHUS: { file: 'fred-dexchus-daily.json', freq: 'daily', label: '美元/在岸人民', optional: true },
};

let loadedCache = null;

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function seriesFilePath(filename) {
  return path.join(getHistoryDir(), filename);
}

function normDate(d) {
  return String(d || '').slice(0, 10);
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
}

async function fetchFredCsv(seriesId, startDate = DEFAULT_START) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${encodeURIComponent(startDate)}`;
  const text = await fetchText(url, {
    timeout: 45000,
    retries: 2,
    headers: FRED_CSV_HEADERS,
  });
  const rows = parseFredCsvFull(text).filter((r) => r.date >= startDate);
  return rows;
}

async function fetchFredApiHistory(seriesId, startDate = DEFAULT_START) {
  if (!isFredApiKeyConfigured()) return [];
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', getFredApiKey());
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'asc');
  url.searchParams.set('observation_start', startDate);
  url.searchParams.set('limit', '100000');

  const { fetchJson } = require('./http-client');
  const json = await fetchJson(url.toString(), { timeout: 45000, retries: 1 });
  const rows = (json.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: normDate(o.date), value: parseFloat(o.value) }))
    .filter((r) => !Number.isNaN(r.value) && r.date >= startDate);
  return rows;
}

async function fetchSeriesWithFallback(seriesId, startDate = DEFAULT_START) {
  try {
    const rows = await fetchFredCsv(seriesId, startDate);
    if (rows.length >= 20) return { rows, source: 'fred-csv' };
  } catch {
    // try API
  }

  try {
    const rows = await fetchFredApiHistory(seriesId, startDate);
    if (rows.length >= 20) return { rows, source: 'fred-api' };
  } catch {
    // try legacy full CSV without cosd
  }

  try {
    const rows = (await fetchFredSeriesHistoryCsv(seriesId)).filter((r) => r.date >= startDate);
    if (rows.length >= 20) return { rows, source: 'fred-csv-legacy' };
  } catch {
    // give up
  }

  return { rows: [], source: 'unavailable' };
}

function forwardFillMonthlyToDaily(monthlyRows, startDate = DEFAULT_START) {
  if (!monthlyRows?.length) return [];
  const sorted = [...monthlyRows].sort((a, b) => a.date.localeCompare(b.date));
  const daily = [];
  const end = normDate(new Date().toISOString());
  let idx = 0;
  let cur = sorted[0]?.value ?? null;

  for (let d = new Date(startDate); normDate(d) <= end; d.setDate(d.getDate() + 1)) {
    const ds = normDate(d);
    while (idx + 1 < sorted.length && sorted[idx + 1].date <= ds) {
      idx += 1;
      cur = sorted[idx].value;
    }
    if (cur != null) daily.push({ date: ds, value: cur });
  }
  return daily;
}

function lookupSeriesByDate(series, date) {
  if (!series?.length) return null;
  const d = normDate(date);
  let last = null;
  for (const row of series) {
    if (row.date <= d) last = row;
    else break;
  }
  return last?.value ?? null;
}

function lookupSeriesPrev(series, date) {
  if (!series?.length) return null;
  const d = normDate(date);
  let prev = null;
  let last = null;
  for (const row of series) {
    if (row.date <= d) {
      prev = last;
      last = row;
    } else break;
  }
  return prev?.value ?? null;
}

function computeYoY(series, date, monthsBack = 12) {
  const d = normDate(date);
  const cur = lookupSeriesByDate(series, d);
  if (cur == null) return null;
  const dt = new Date(d);
  dt.setMonth(dt.getMonth() - monthsBack);
  const past = lookupSeriesByDate(series, normDate(dt));
  if (past == null || past === 0) return null;
  return +(((cur - past) / past) * 100).toFixed(4);
}

async function fetchAndCacheSeries(seriesId, { startDate = DEFAULT_START, force = false } = {}) {
  const cfg = SERIES_CONFIG[seriesId];
  if (!cfg) throw new Error(`Unknown FRED series: ${seriesId}`);

  if (!force) {
    const local = loadLocalSeries(cfg.file);
    if (local?.series?.length >= 50) {
      return { ...local, fromCache: true };
    }
  }

  const { rows, source } = await fetchSeriesWithFallback(seriesId, startDate);
  const payload = {
    seriesId,
    label: cfg.label,
    freq: cfg.freq,
    source,
    startDate,
    fetchedAt: new Date().toISOString(),
    series: rows,
    rowCount: rows.length,
  };
  if (rows.length >= 20) saveLocalSeries(cfg.file, payload);
  return payload;
}

async function fetchAllFredHistory({ startDate = DEFAULT_START, force = false } = {}) {
  const results = {};
  for (const seriesId of Object.keys(SERIES_CONFIG)) {
    results[seriesId] = await fetchAndCacheSeries(seriesId, { startDate, force });
    await new Promise((r) => setTimeout(r, 350));
  }
  return results;
}

async function loadFredHistory({ startDate = DEFAULT_START, force = false } = {}) {
  if (loadedCache && !force) return loadedCache;

  const fetched = await fetchAllFredHistory({ startDate, force });
  const dff = fetched.DFF?.series || [];
  const vix = fetched.VIXCLS?.series || [];
  const real10y = fetched.REAINTRATREARAT10Y?.series || [];
  const m2Monthly = fetched.M2SL?.series || [];
  const dxy = fetched.DTWEXBGS?.series || [];
  const brent = fetched.DCOILBRENTEU?.series || [];
  const wti = fetched.DCOILWTICO?.series || [];
  const londonGold = fetched.GOLDAMGBD228NLBM?.series || [];
  const m2Daily = forwardFillMonthlyToDaily(m2Monthly, startDate);

  loadedCache = {
    startDate,
    loadedAt: new Date().toISOString(),
    dff,
    vix,
    real10y,
    dxy,
    brent,
    wti,
    londonGold,
    m2Monthly,
    m2Daily,
    sources: {
      DFF: fetched.DFF?.source,
      VIXCLS: fetched.VIXCLS?.source,
      REAINTRATREARAT10Y: fetched.REAINTRATREARAT10Y?.source,
      M2SL: fetched.M2SL?.source,
      DTWEXBGS: fetched.DTWEXBGS?.source,
      DCOILBRENTEU: fetched.DCOILBRENTEU?.source,
      DCOILWTICO: fetched.DCOILWTICO?.source,
      GOLDAMGBD228NLBM: fetched.GOLDAMGBD228NLBM?.source,
    },
    rowCounts: {
      dff: dff.length,
      vix: vix.length,
      real10y: real10y.length,
      dxy: dxy.length,
      brent: brent.length,
      wti: wti.length,
      londonGold: londonGold.length,
      m2Monthly: m2Monthly.length,
      m2Daily: m2Daily.length,
    },
    lookupSeriesByDate,
    lookupSeriesPrev,
    computeYoY,
  };
  return loadedCache;
}

function getFredAtDate(field, date) {
  if (!loadedCache) return null;
  const map = {
    dff: loadedCache.dff,
    vix: loadedCache.vix,
    real10y: loadedCache.real10y,
    m2: loadedCache.m2Daily,
  };
  return lookupSeriesByDate(map[field], date);
}

module.exports = {
  DEFAULT_START,
  SERIES_CONFIG,
  getHistoryDir,
  fetchFredCsv,
  fetchAndCacheSeries,
  fetchAllFredHistory,
  loadFredHistory,
  forwardFillMonthlyToDaily,
  lookupSeriesByDate,
  lookupSeriesPrev,
  computeYoY,
  getFredAtDate,
};
