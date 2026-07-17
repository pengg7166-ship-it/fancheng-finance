/**
 * SLV (iShares Silver Trust) 日持仓序—P0 白银 ETF 基本'
 * 落盘: {dataDir}/history/slv-etf-holdings-daily.json
 *
 * 首选自动源：BlackRock product-data API（iShares Data Download Excel/XML）'
 * Historical 表含 As Of + Shares Outstanding；tonnes 由官'anchor 比例换算'
 *   https://www.blackrock.com/varnish-api/blk-one01-product-data/product-data/api/v1/get-fund-document?...portfolioId=239855&component=fundDownload
 * 备选手动：iShares 'Data Download 'MacroMicro CSV
 *      https://www.ishares.com/us/products/239855/ishares-silver-trust-fund
 *   2. 转为 date,tonnes CSV（列须含 Date + Tonnes/Holdings/Ounces'
 *   3. 放到数据盘，例如'
 *      E:\FanchengFinance\data\history\user-slv-holdings.csv
 *   4. 导入'
 *      FANCHENG_DATA_DRIVE=E node scripts/fetch-slv-etf-holdings.js --import E:\FanchengFinance\data\history\user-slv-holdings.csv
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { fetchText, fetchJson } = require('./http-client');
const { fetchStooqHistory } = require('./stooq-history');

const DEFAULT_START = '2019-01-01';
const OUT_FILE = 'slv-etf-holdings-daily.json';

const ISHARES_SLV_PORTFOLIO_ID = '239855';
const ISHARES_SLV_ARCHIVE_URL =
  'https://www.blackrock.com/varnish-api/blk-one01-product-data/product-data/api/v1/get-fund-document?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=us-ishares&locale=en_US&portfolioId=239855&component=fundDownload&userType=individual';
/** iShares 'Tonnes in Trust / Shares Outstanding 锚点'026-06-11）→ 换算 historical shares */
const SLV_TONNES_PER_SHARE = 15003.8 / 533200000;

const SLV_MANUAL_FALLBACK_URLS = {
  ishares: 'https://www.ishares.com/us/products/239855/ishares-silver-trust-fund',
  isharesArchiveApi: ISHARES_SLV_ARCHIVE_URL,
  macromicro: 'https://en.macromicro.me/collections/3351/commodity-silver/24945/silver-ishare-silver-trust-etf-tonnes-vs-silver',
  investing: 'https://www.investing.com/etfs/ishares-silver-trust-historical-data',
  yahoo: 'https://finance.yahoo.com/quote/SLV/history/',
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

function parseImportCsv(text, ticker = 'SLV') {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => h.includes('date'));
  const start = hasHeader ? 1 : 0;
  const dateIdx = hasHeader ? header.findIndex((h) => h.includes('date')) : 0;
  const valIdx = hasHeader
    ? header.findIndex(
        (h) =>
          h.includes('tonnes') ||
          h.includes('tonne') ||
          h.includes('holdings') ||
          h.includes('ounces') ||
          h.includes('value') ||
          h.includes('close')
      )
    : 1;

  const series = [];
  for (let i = start; i < lines.length; i += 1) {
    const parts = lines[i].split(delim);
    const date = normDate(parts[dateIdx]);
    let raw = String(parts[valIdx >= 0 ? valIdx : 1] || '').replace(/,/g, '').trim();
    let value = parseFloat(raw);
    if (!date || Number.isNaN(value)) continue;
    const ouncesIdx = header.findIndex((h) => h.includes('ounce') && !h.includes('tonne'));
    if (ouncesIdx >= 0 && header[valIdx]?.includes('ounce')) {
      value = value / 32150.7465686;
    }
    series.push({ date, value, ticker, unit: 'tonnes' });
  }
  return series.filter((r) => r.date >= DEFAULT_START);
}

const SLV_SOURCE_PRIORITY = {
  'ishares-slv-archive': 4,
  'user-import': 3,
  'macromicro-slv-holdings': 2,
  'yahoo-slv-volume-proxy': 0,
  'stooq-slv-volume-proxy': 0,
};

function slvSourcePriority(source) {
  return SLV_SOURCE_PRIORITY[String(source || '').toLowerCase()] ?? 1;
}

function loadExistingSlvSeries() {
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

function mergeSlvSeries(existingSeries, incomingSeries) {
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
    const incPri = slvSourcePriority(row.source);
    const existPri = slvSourcePriority(existing.source);
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

const _slvCache = { rows: null, mtime: 0 };

function loadSlvRows() {
  const jsonPath = path.join(getHistoryDir(), OUT_FILE);
  if (!fs.existsSync(jsonPath)) return null;
  try {
    const stat = fs.statSync(jsonPath);
    if (_slvCache.rows && _slvCache.mtime === stat.mtimeMs) return _slvCache.rows;
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    _slvCache.rows = rows;
    _slvCache.mtime = stat.mtimeMs;
    return rows;
  } catch {
    return null;
  }
}

function getSlvHoldingsAtDate(barDate) {
  const rows = loadSlvRows();
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
    ticker: row.ticker || 'SLV',
    unit: row.unit || 'tonnes',
    source: row.source || 'slv-holdings',
    proxy: Boolean(row.proxy),
  };
}

function getSlvHoldingsChg5dAtDate(barDate) {
  const rows = loadSlvRows();
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

function parseIsharesDisplayDate(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '--') return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return normDate(d.toISOString());
}

function parseIsharesSlvSpreadsheetMl(text) {
  const histMatch = String(text).match(/<ss:Worksheet ss:Name="Historical">([\s\S]*?)<\/ss:Worksheet>/i);
  if (!histMatch) throw new Error('iShares XML 缺少 Historical ');

  const rows = [...histMatch[1].matchAll(/<ss:Row>([\s\S]*?)<\/ss:Row>/gi)];
  if (rows.length < 2) throw new Error('iShares Historical 行数不足');

  const series = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = [
      ...rows[i][1].matchAll(/<ss:Data ss:Type="(?:String|Number)">([^<]*)<\/ss:Data>/gi),
    ].map((m) => m[1].trim());
    if (cells.length < 4) continue;
    const date = parseIsharesDisplayDate(cells[0]);
    const shares = parseFloat(String(cells[3] || '').replace(/,/g, ''));
    if (!date || Number.isNaN(shares) || shares <= 0) continue;
    const tonnes = +((shares * SLV_TONNES_PER_SHARE).toFixed(4));
    series.push({ date, value: tonnes, ticker: 'SLV', unit: 'tonnes', sharesOutstanding: shares });
  }

  const filtered = series.filter((r) => r.date >= DEFAULT_START);
  if (filtered.length < 200) throw new Error(`iShares Historical 解析不足 (${filtered.length} '`);
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

async function tryIsharesSlvArchive() {
  const text = await fetchText(ISHARES_SLV_ARCHIVE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: 'application/xml,text/xml,*/*',
      Referer: 'https://www.ishares.com/us/products/239855/ishares-silver-trust-fund',
    },
    timeout: 60000,
    retries: 2,
  });
  if (text.startsWith('%PDF') || (text.includes('<!DOCTYPE html') && !text.includes('<ss:Workbook'))) {
    throw new Error('iShares archive 返回 HTML/PDF（Cloudflare 拦截');
  }
  const parsed = parseIsharesSlvSpreadsheetMl(text);
  return {
    source: 'ishares-slv-archive',
    label: 'iShares SLV 官方 Shares Outstanding / tonnes',
    kind: 'slv_tonnes',
    manualUrl: ISHARES_SLV_ARCHIVE_URL,
    series: parsed.map(({ sharesOutstanding, ...row }) => ({ ...row, source: 'ishares-slv-archive' })),
    note:
      'BlackRock get-fund-document XML Historical 表；tonnes = shares × 官方 anchor (15003.8t / 533.2M sh, 2026-06-11)',
  };
}

function defaultUserSlvCsvPath() {
  return path.join(getHistoryDir(), 'user-slv-holdings.csv');
}

function seriesToImportCsv(series) {
  const lines = ['date,tonnes'];
  for (const row of series) {
    lines.push(`${normDate(row.date)},${row.value}`);
  }
  return `${lines.join('\n')}\n`;
}

function loadUserSlvCsvSeries(csvPath = defaultUserSlvCsvPath()) {
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf8');
  return parseImportCsv(text).map((r) => ({ ...r, source: 'user-import' }));
}

function writeUserSlvCsv(series, csvPath = defaultUserSlvCsvPath()) {
  fs.writeFileSync(csvPath, seriesToImportCsv(series), 'utf8');
  return csvPath;
}

async function tryYahooSlvVolumeProxy() {
  const period1 = Math.floor(new Date(`${DEFAULT_START}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/SLV?period1=${period1}&period2=${period2}&interval=1d`;
  const json = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, retries: 2, timeout: 30000 });
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
      ticker: 'SLV',
      unit: 'shares_volume_proxy',
      proxy: true,
    });
  }
  const filtered = series.filter((r) => r.date >= DEFAULT_START);
  if (filtered.length < 20) throw new Error('yahoo SLV 无足够 volume');
  return {
    source: 'yahoo-slv-volume-proxy',
    label: 'Yahoo SLV 日成交量（非持仓，代理）',
    kind: 'slv_volume_proxy',
    proxy: true,
    manualUrl: SLV_MANUAL_FALLBACK_URLS.yahoo,
    series: filtered,
    note: 'Yahoo shares outstanding；仅作流动性代理，非 tonnes',
  };
}

async function tryStooqSlvVolumeProxy() {
  const bars = await fetchStooqHistory('slv.us', 'day', 8);
  const series = bars
    .filter((b) => b.date >= DEFAULT_START && b.volume > 0)
    .map((b) => ({
      date: b.date,
      value: b.volume,
      ticker: 'SLV',
      unit: 'shares_volume_proxy',
      proxy: true,
    }));
  if (series.length < 20) throw new Error('stooq SLV volume 不足');
  return {
    source: 'stooq-slv-volume-proxy',
    label: 'Stooq SLV 日成交量（非持仓，代理）',
    kind: 'slv_volume_proxy',
    proxy: true,
    manualUrl: 'https://stooq.pl/q/d/l/?s=slv.us',
    series,
    note: 'Stooq 无 tonnes；仅作流动性代理',
  };
}

function buildPayload(result, attempts) {
  const series = result.series || [];
  const updated = new Date().toISOString();
  return {
    seriesId: 'SLV_HOLDINGS',
    label: result.label,
    freq: 'daily',
    source: result.source,
    updated,
    fetchedAt: updated,
    startDate: DEFAULT_START,
    endDate: series.length ? series[series.length - 1].date : null,
    kind: result.kind || 'slv_tonnes',
    proxy: Boolean(result.proxy),
    manualUrl: result.manualUrl || null,
    data: series,
    rowCount: series.length,
    sourceAttempts: attempts,
    note: result.note || null,
    mergeStats: result.mergeStats || null,
  };
}

async function fetchSlvEtfHoldings({ importPath } = {}) {
  const attempts = [];

  if (importPath) {
    const text = fs.readFileSync(importPath, 'utf8');
    const incoming = parseImportCsv(text).map((r) => ({ ...r, source: r.source || 'user-import' }));
    if (incoming.length < 1) throw new Error(`import 行数不足 (${incoming.length})`);
    const existing = loadExistingSlvSeries();
    const merged = mergeSlvSeries(existing.series, incoming);
    if (merged.rowCount < 5 && existing.series.length < 5) {
      throw new Error(`合并后行数不'(${merged.rowCount})`);
    }
    const primarySource =
      existing.meta?.source && slvSourcePriority(existing.meta.source) >= slvSourcePriority('user-import')
        ? `${existing.meta.source}+gap-fill`
        : 'user-import';
    return buildPayload(
      {
        source: primarySource,
        label: '用户导入 SLV 持仓',
        kind: 'slv_tonnes',
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
    ['ishares-slv-archive', () => tryIsharesSlvArchive()],
    ['yahoo-slv', () => tryYahooSlvVolumeProxy()],
    ['stooq-slv', () => tryStooqSlvVolumeProxy()],
  ];

  for (const [name, fn] of tryOrder) {
    try {
      const result = await fn();
      attempts.push({ source: name, ok: true, rows: result.series.length, proxy: Boolean(result.proxy) });
      const userCsvPath = defaultUserSlvCsvPath();
      const userSeries = loadUserSlvCsvSeries(userCsvPath);
      let series = result.series;
      let mergeStats = null;
      if (userSeries.length) {
        const merged = mergeSlvSeries(userSeries, series);
        series = merged.series;
        mergeStats = {
          userCsvRows: userSeries.length,
          officialRows: result.series.length,
          added: merged.added,
          replaced: merged.replaced,
          skippedOverlap: merged.skippedOverlap,
        };
      }
      writeUserSlvCsv(series, userCsvPath);
      return buildPayload({ ...result, series, mergeStats, source: result.source }, attempts);
    } catch (err) {
      attempts.push({ source: name, ok: false, error: err.message });
    }
  }

  const err = new Error(`SLV 全源失败: ${attempts.map((a) => `${a.source}=${a.error}`).join('; ')}`);
  err.attempts = attempts;
  err.manualFallbackUrls = SLV_MANUAL_FALLBACK_URLS;
  throw err;
}

async function saveSlvEtfHoldings(options = {}) {
  const payload = await fetchSlvEtfHoldings(options);
  const jsonPath = path.join(getHistoryDir(), OUT_FILE);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  _slvCache.rows = null;
  _slvCache.mtime = 0;
  return { payload, jsonPath };
}

module.exports = {
  DEFAULT_START,
  OUT_FILE,
  ISHARES_SLV_PORTFOLIO_ID,
  ISHARES_SLV_ARCHIVE_URL,
  SLV_TONNES_PER_SHARE,
  SLV_MANUAL_FALLBACK_URLS,
  SLV_SOURCE_PRIORITY,
  fetchSlvEtfHoldings,
  saveSlvEtfHoldings,
  tryIsharesSlvArchive,
  parseIsharesSlvSpreadsheetMl,
  mergeSlvSeries,
  loadSlvRows,
  loadUserSlvCsvSeries,
  writeUserSlvCsv,
  defaultUserSlvCsvPath,
  getSlvHoldingsAtDate,
  getSlvHoldingsChg5dAtDate,
  parseImportCsv,
};
