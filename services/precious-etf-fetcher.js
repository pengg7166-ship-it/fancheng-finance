/**
 * GLD/IAU ETF 日持仓序—P0 贵金属基本面
 * 落盘: {dataDir}/history/precious-etf-holdings-daily.json
 * 消费: services/precious-sector-loader.js · PRECIOUS_P0_FILES.etfHoldings
 *
 * 自动源：SPDR historical-archive API（XLSX，首选）· 'CSV/barlist · Yahoo/Stooq 代理
 * 'CSV `GLD_US_archive_EN.csv` 现已 301 重定向至 barlist API（当'bar 明细，非历史 tonnes）'
 * 手动步骤'
 *   1. 下载 Historical Archive XLSX（首选直'API）：
 *      US/GLD:  https://api.spdrgoldshares.com/api/v1/historical-archive?product=gld&exchange=NYSE&lang=en
 *      HK/2840: https://api.spdrgoldshares.com/api/v1/historical-archive?product=2840&exchange=HKeX
 *      JP/1326: https://api.spdrgoldshares.com/api/v1/historical-archive?product=1326&exchange=TSE
 *      备选：各区'SPDR —下滑'Historical Data 'Historical Archive (XLSX) 'Download'
 *      https://www.spdrgoldshares.com/usa/gld/
 *      https://www.spdrgoldshares.com/japan/gld/
 *      https://www.spdrgoldshares.com/hong-kong/2840/
 *   2. 转为 date,tonnes CSV（列须含 Date + Tonnes/Holdings'
 *   3. 放到数据盘，例如'
 *      E:\FanchengFinance\data\history\user-gld-holdings.csv
 *   4. 导入'
 *      FANCHENG_DATA_DRIVE=E node scripts/fetch-precious-etf-holdings.js --import E:\FanchengFinance\data\history\user-gld-holdings.csv
 *   'API：fetchPreciousEtfHoldings({ importPath: '...' })
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { fetchText, fetchJson, fetchBuffer } = require('./http-client');
const { fetchStooqHistory } = require('./stooq-history');
const { readZipEntry, parseSharedStrings, parseSheetRows } = require('./xlsx-lite');
const { PRECIOUS_P0_FILES } = require('./precious-sector-loader');

const DEFAULT_START = '2019-01-01';
const OUT_FILE = PRECIOUS_P0_FILES.etfHoldings;

const FRED_CSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://fred.stlouisfed.org/',
  Accept: 'text/csv,*/*',
};

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function parseSpdrArchiveCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase();
  if (!header.includes('date') && !header.includes('tonnes')) return [];

  const cols = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const dateIdx = cols.findIndex((c) => c.includes('date'));
  const tonIdx = cols.findIndex((c) => c.includes('tonnes') || c.includes('holdings'));
  if (dateIdx < 0 || tonIdx < 0) return [];

  const series = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(',');
    const date = normDate(parts[dateIdx]);
    const value = parseFloat(String(parts[tonIdx] || '').replace(/,/g, ''));
    if (!date || Number.isNaN(value) || value <= 0) continue;
    series.push({ date, value, ticker: 'GLD', unit: 'tonnes' });
  }
  return series.filter((r) => r.date >= DEFAULT_START);
}

function parseImportCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => h.includes('date'));
  const start = hasHeader ? 1 : 0;
  const dateIdx = hasHeader ? header.findIndex((h) => h.includes('date')) : 0;
  const valIdx = hasHeader
    ? header.findIndex((h) => h.includes('tonnes') || h.includes('holdings') || h.includes('value') || h.includes('close'))
    : 1;

  const series = [];
  for (let i = start; i < lines.length; i += 1) {
    const parts = lines[i].split(delim);
    const date = normDate(parts[dateIdx]);
    const value = parseFloat(String(parts[valIdx >= 0 ? valIdx : 1] || '').replace(/,/g, ''));
    if (!date || Number.isNaN(value)) continue;
    series.push({ date, value, ticker: 'GLD', unit: 'tonnes' });
  }
  return series.filter((r) => r.date >= DEFAULT_START);
}

const GLD_MANUAL_FALLBACK_URLS = {
  spdr: 'https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv',
  spdrHistoricalArchive:
    'https://api.spdrgoldshares.com/api/v1/historical-archive?product=gld&exchange=NYSE&lang=en',
  macromicro: 'https://en.macromicro.me/series/294/gold-spdr-holdings（需 MM Business CSV 导出',
  investing: 'https://www.investing.com/etfs/spdr-gold-trust-historical-data',
  wgc: 'https://www.gold.org/goldhub/data/gold-etfs-holdings-and-flows',
};

const SPDR_GLD_HISTORICAL_ARCHIVE_URL = GLD_MANUAL_FALLBACK_URLS.spdrHistoricalArchive;

const MONTHS = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function parseSpdrDisplayDate(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${String(m[1]).padStart(2, '0')}`;
}

function parseSpdrHistoricalArchiveXlsx(buffer) {
  const sharedStrings = parseSharedStrings(readZipEntry(buffer, 'xl/sharedStrings.xml'));
  const sheetBuf =
    readZipEntry(buffer, 'xl/worksheets/sheet2.xml') || readZipEntry(buffer, 'xl/worksheets/sheet1.xml');
  if (!sheetBuf) throw new Error('SPDR XLSX 无 worksheet');
  const rows = parseSheetRows(sheetBuf, sharedStrings);
  const series = [];
  for (const row of rows) {
    const date = parseSpdrDisplayDate(row.cells.A);
    const value = parseFloat(String(row.cells.J || '').replace(/,/g, ''));
    if (!date || Number.isNaN(value) || value <= 0) continue;
    series.push({ date, value, ticker: 'GLD', unit: 'tonnes', source: 'spdr-gld-historical-archive' });
  }
  const filtered = series.filter((r) => r.date >= DEFAULT_START);
  if (filtered.length < 200) throw new Error(`SPDR Historical Archive 解析不足 (${filtered.length} '`);
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

async function trySpdrHistoricalArchive() {
  const buffer = await fetchBuffer(SPDR_GLD_HISTORICAL_ARCHIVE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      Referer: 'https://www.spdrgoldshares.com/usa/gld/',
    },
    timeout: 90000,
    retries: 2,
  });
  if (!buffer.length || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error('SPDR historical-archive 无 XLSX（可能被 Cloudflare 拦截）');
  }
  const series = parseSpdrHistoricalArchiveXlsx(buffer);
  return {
    source: 'spdr-gld-historical-archive',
    label: 'SPDR GLD 官方 Historical Archive (tonnes)',
    kind: 'gld_tonnes',
    manualUrl: SPDR_GLD_HISTORICAL_ARCHIVE_URL,
    series,
  };
}

async function trySpdrArchive() {
  const urls = [
    'https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv',
    'https://api.spdrgoldshares.com/api/v1/barlist?underlying=gld&format=csv',
    'https://api.spdrgoldshares.com/api/v1/barlist?underlying=gld',
  ];
  let lastErr = 'unknown';
  for (const url of urls) {
    try {
      const text = await fetchText(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/csv,application/json,*/*' },
        timeout: 45000,
        retries: 1,
      });
      if (text.startsWith('%PDF') || (text.includes('<html') && !text.includes('Date'))) {
        lastErr = 'SPDR 返回 PDF/HTML（Cloudflare 拦截';
        continue;
      }
      const series = parseSpdrArchiveCsv(text);
      if (series.length >= 20) {
        return {
          source: 'spdr-gld-archive',
          label: 'SPDR GLD 官方日持—',
          kind: 'gld_tonnes',
          manualUrl: GLD_MANUAL_FALLBACK_URLS.spdr,
          series,
        };
      }
      lastErr = `SPDR CSV 解析不足 (${series.length} '`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  throw new Error(lastErr);
}

async function tryMacroMicroGldHoldings() {
  const urls = [
    'https://en.macromicro.me/series/294/gold-spdr-holdings/download',
    'https://en.macromicro.me/charts/data/294',
  ];
  let lastErr = 'unknown';
  for (const url of urls) {
    try {
      const text = await fetchText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'text/csv,application/json,*/*',
          Referer: 'https://en.macromicro.me/',
        },
        timeout: 45000,
        retries: 1,
      });
      if (text.startsWith('%PDF') || text.includes('Just a moment')) {
        lastErr = 'MacroMicro Cloudflare 403';
        continue;
      }
      const series = parseImportCsv(text);
      if (series.length >= 20) {
        return {
          source: 'macromicro-gld-holdings',
          label: 'MacroMicro GLD 持仓(吨)',
          kind: 'gld_tonnes',
          manualUrl: GLD_MANUAL_FALLBACK_URLS.macromicro,
          series,
        };
      }
      lastErr = `MacroMicro 解析不足 (${series.length})`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  throw new Error(lastErr);
}

async function tryInvestingGldHoldings() {
  const url = 'https://www.investing.com/etfs/spdr-gold-trust-historical-data';
  const text = await fetchText(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/html,*/*',
      Referer: 'https://www.investing.com/',
    },
    timeout: 30000,
    retries: 1,
  });
  if (text.includes('Just a moment') || text.includes('403 Forbidden')) {
    throw new Error('Investing.com Cloudflare 403');
  }
  const series = parseImportCsv(text);
  if (series.length < 20) throw new Error(`Investing.com 解析不足 (${series.length})`);
  return {
    source: 'investing-gld-holdings',
    label: 'Investing.com GLD 持仓',
    kind: 'gld_tonnes',
    manualUrl: GLD_MANUAL_FALLBACK_URLS.investing,
    series,
  };
}

async function tryYahooGldVolumeProxy() {
  const period1 = Math.floor(new Date(`${DEFAULT_START}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/GLD?period1=${period1}&period2=${period2}&interval=1d`;
  const json = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, retries: 1, timeout: 20000 });
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const volumes = result?.indicators?.quote?.[0]?.volume || [];
  const series = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const v = volumes[i];
    if (v == null || Number.isNaN(v)) continue;
    series.push({
      date: normDate(new Date(timestamps[i] * 1000).toISOString()),
      value: v,
      ticker: 'GLD',
      unit: 'shares_volume_proxy',
    });
  }
  const filtered = series.filter((r) => r.date >= DEFAULT_START);
  if (filtered.length < 20) throw new Error('yahoo GLD 无足够 volume');
  return {
    source: 'yahoo-gld-volume-proxy',
    label: 'Yahoo GLD 日成交量（非持仓，代理）',
    kind: 'gld_volume_proxy',
    proxy: true,
    manualUrl: 'https://finance.yahoo.com/quote/GLD/history',
    series: filtered,
    note: 'Yahoo shares outstanding；仅作流动性代理，非 tonnes',
  };
}

async function tryStooqGldVolumeProxy() {
  const bars = await fetchStooqHistory('gld.us', 'day', 8);
  const series = bars
    .filter((b) => b.date >= DEFAULT_START && b.volume > 0)
    .map((b) => ({
      date: b.date,
      value: b.volume,
      ticker: 'GLD',
      unit: 'shares_volume_proxy',
    }));
  if (series.length < 20) throw new Error('stooq GLD volume 不足');
  return {
    source: 'stooq-gld-volume-proxy',
    label: 'Stooq GLD 日成交量（非持仓，代理）',
    kind: 'gld_volume_proxy',
    proxy: true,
    manualUrl: 'https://stooq.pl/q/d/l/?s=gld.us',
    series,
    note: 'Stooq 无 tonnes；仅作流动性代理',
  };
}

const GLD_SOURCE_PRIORITY = {
  'spdr-gld-historical-archive': 4,
  'spdr-gld-archive': 3,
  'user-import': 2,
  'macromicro-gld-holdings': 1,
  'yahoo-gld-volume-proxy': 0,
  'stooq-gld-volume-proxy': 0,
};

function gldSourcePriority(source) {
  return GLD_SOURCE_PRIORITY[String(source || '').toLowerCase()] ?? 1;
}

function loadExistingGldSeries() {
  const jsonPath = path.join(getHistoryDir(), OUT_FILE);
  if (!fs.existsSync(jsonPath)) return { series: [], meta: null };
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const series = Array.isArray(raw) ? raw : raw.data || [];
    return { series, meta: raw };
  } catch {
    return { series: [], meta: null };
  }
}

function mergeGldSeries(existingSeries, incomingSeries) {
  const byDate = new Map();
  let added = 0;
  let skippedOverlap = 0;
  let replaced = 0;

  for (const row of existingSeries || []) {
    const d = normDate(row.date);
    if (!d) continue;
    byDate.set(d, { ...row, date: d });
  }

  for (const row of incomingSeries || []) {
    const d = normDate(row.date);
    if (!d) continue;
    const existing = byDate.get(d);
    if (!existing) {
      byDate.set(d, { ...row, date: d });
      added += 1;
      continue;
    }
    const incPri = gldSourcePriority(row.source);
    const existPri = gldSourcePriority(existing.source);
    if (incPri > existPri) {
      byDate.set(d, { ...row, date: d });
      replaced += 1;
    } else {
      skippedOverlap += 1;
    }
  }

  const series = [...byDate.values()].sort((a, b) => normDate(a.date).localeCompare(normDate(b.date)));
  return { series, added, replaced, skippedOverlap, rowCount: series.length };
}

const _gldCache = { rows: null, mtime: 0 };

function loadGldRows() {
  const jsonPath = path.join(getHistoryDir(), OUT_FILE);
  if (!fs.existsSync(jsonPath)) return null;
  try {
    const stat = fs.statSync(jsonPath);
    if (_gldCache.rows && _gldCache.mtime === stat.mtimeMs) return _gldCache.rows;
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    _gldCache.rows = rows;
    _gldCache.mtime = stat.mtimeMs;
    return rows;
  } catch {
    return null;
  }
}

function getGldHoldingsAtDate(barDate) {
  const rows = loadGldRows();
  if (!rows?.length) return null;
  const d = normDate(barDate);
  let row = rows.find((r) => normDate(r.date) === d);
  if (!row) {
    const prior = rows.filter((r) => normDate(r.date) <= d);
    row = prior.length ? prior[prior.length - 1] : null;
  }
  if (!row) return null;
  return {
    date: normDate(row.date),
    holdingsTonnes: row.value != null ? Number(row.value) : null,
    ticker: row.ticker || 'GLD',
    unit: row.unit || 'tonnes',
    source: row.source || 'gld-holdings',
  };
}

function getGldHoldingsChg5dAtDate(barDate) {
  const rows = loadGldRows();
  if (!rows?.length) return null;
  const d = normDate(barDate);
  const idx = rows.findIndex((r) => normDate(r.date) === d);
  let curIdx = idx;
  if (curIdx < 0) {
    const prior = rows.filter((r) => normDate(r.date) <= d);
    if (!prior.length) return null;
    curIdx = rows.indexOf(prior[prior.length - 1]);
  }
  const cur = rows[curIdx]?.value;
  if (cur == null) return null;
  const pastIdx = curIdx - 5;
  if (pastIdx < 0) return null;
  const past = rows[pastIdx]?.value;
  if (past == null) return null;
  const delta = Number(cur) - Number(past);
  const denom = Math.max(Math.abs(Number(past)), 1);
  return +((delta / denom) * 100).toFixed(4);
}

function buildPayload(result, attempts) {
  const series = result.series || [];
  const updated = new Date().toISOString();
  return {
    seriesId: 'GLD_HOLDINGS',
    label: result.label,
    freq: 'daily',
    source: result.source,
    updated,
    fetchedAt: updated,
    startDate: DEFAULT_START,
    endDate: series.length ? series[series.length - 1].date : null,
    kind: result.kind || 'gld_tonnes',
    proxy: Boolean(result.proxy),
    manualUrl: result.manualUrl || null,
    data: series,
    rowCount: series.length,
    sourceAttempts: attempts,
    note: result.note || null,
  };
}

async function fetchPreciousEtfHoldings({ importPath } = {}) {
  const attempts = [];

  if (importPath) {
    const text = fs.readFileSync(importPath, 'utf8');
    const incoming = parseImportCsv(text).map((r) => ({ ...r, source: r.source || 'user-import' }));
    if (incoming.length < 1) throw new Error(`import 行数不足 (${incoming.length})`);
    const existing = loadExistingGldSeries();
    const merged = mergeGldSeries(existing.series, incoming);
    if (merged.rowCount < 5 && existing.series.length < 5) {
      throw new Error(`合并后行数不'(${merged.rowCount})`);
    }
    const primarySource =
      existing.meta?.source && gldSourcePriority(existing.meta.source) >= gldSourcePriority('user-import')
        ? `${existing.meta.source}+gap-fill`
        : 'user-import';
    return buildPayload(
      {
        source: primarySource,
        label: '用户导入 GLD 持仓',
        kind: 'gld_tonnes',
        manualUrl: importPath,
        series: merged.series,
        mergeStats: {
          existingRows: existing.series.length,
          incomingRows: incoming.length,
          added: merged.added,
          replaced: merged.replaced,
          skippedOverlap: merged.skippedOverlap,
        },
      },
      [{ source: 'user-import', ok: true, rows: merged.rowCount, merge: merged }]
    );
  }

  const tryOrder = [
    ['spdr-historical-archive', () => trySpdrHistoricalArchive()],
    ['spdr-archive', () => trySpdrArchive()],
    ['macromicro-gld', () => tryMacroMicroGldHoldings()],
    ['investing-gld', () => tryInvestingGldHoldings()],
    ['yahoo-gld', () => tryYahooGldVolumeProxy()],
    ['stooq-gld', () => tryStooqGldVolumeProxy()],
  ];

  for (const [name, fn] of tryOrder) {
    try {
      const result = await fn();
      attempts.push({ source: name, ok: true, rows: result.series.length, proxy: Boolean(result.proxy) });
      return buildPayload({ ...result, attempts }, attempts);
    } catch (err) {
      attempts.push({ source: name, ok: false, error: err.message });
    }
  }

  const err = new Error(`GLD 全源失败: ${attempts.map((a) => `${a.source}=${a.error}`).join('; ')}`);
  err.attempts = attempts;
  err.manualFallbackUrls = GLD_MANUAL_FALLBACK_URLS;
  throw err;
}

async function savePreciousEtfHoldings(options = {}) {
  const payload = await fetchPreciousEtfHoldings(options);
  const jsonPath = path.join(getHistoryDir(), OUT_FILE);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  _gldCache.rows = null;
  _gldCache.mtime = 0;
  return { payload, jsonPath };
}

module.exports = {
  DEFAULT_START,
  OUT_FILE,
  GLD_MANUAL_FALLBACK_URLS,
  GLD_SOURCE_PRIORITY,
  fetchPreciousEtfHoldings,
  savePreciousEtfHoldings,
  mergeGldSeries,
  loadGldRows,
  getGldHoldingsAtDate,
  getGldHoldingsChg5dAtDate,
  parseImportCsv,
};
