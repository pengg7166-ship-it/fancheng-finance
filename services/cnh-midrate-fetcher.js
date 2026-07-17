/**
 * 离岸 USDCNH 日频中间'收盘—多源抓取
 * 优先东方财富 push2his (133.USDCNH)，回退 FRED DEXCHUS 在岸代理
 */
const fs = require('fs');
const path = require('path');
const { fetchJson, fetchText } = require('./http-client');
const { getDataDir } = require('./data-paths');
const { parseFredCsvFull } = require('./fred-client');

const DEFAULT_START = '2019-01-01';
const EM_SECID = '133.USDCNH';
const EM_HEADERS = {
  Referer: 'https://finance.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};
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

function endDateYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseEastMoneyKline(line) {
  const p = line.split(',');
  if (p.length < 3) return null;
  const date = normDate(p[0]);
  const close = parseFloat(p[2]);
  if (!date || Number.isNaN(close) || close <= 0) return null;
  return { date, value: close };
}

async function tryEastMoneyUsdcnh(startDate = DEFAULT_START) {
  const beg = startDate.replace(/-/g, '');
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', EM_SECID);
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
  url.searchParams.set('klt', '101');
  url.searchParams.set('fqt', '1');
  url.searchParams.set('beg', beg);
  url.searchParams.set('end', endDateYmd());

  const json = await fetchJson(url.toString(), { headers: EM_HEADERS, retries: 3, timeout: 45000 });
  const klines = json.data?.klines || [];
  const series = klines
    .map(parseEastMoneyKline)
    .filter(Boolean)
    .filter((r) => r.date >= startDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (series.length < 20) {
    throw new Error(`eastmoney rows=${series.length}`);
  }

  return {
    source: 'eastmoney-usdcnh',
    label: '美元兑离岸人民币(东方财富日收)',
    kind: 'cnh_spot_close',
    manualUrl: 'https://quote.eastmoney.com/forex/USDCNH.html',
    series,
  };
}

async function tryYahooUsdcnh() {
  const period1 = Math.floor(new Date(`${DEFAULT_START}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  for (const symbol of ['USDCNH=X', 'CNH=X']) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
    const json = await fetchJson(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      retries: 1,
      timeout: 20000,
    });
    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const series = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const v = closes[i];
      if (v == null || Number.isNaN(v)) continue;
      series.push({ date: normDate(new Date(timestamps[i] * 1000).toISOString()), value: v });
    }
    if (series.length >= 20) {
      return {
        source: `yahoo-${symbol}`,
        label: `Yahoo ${symbol}`,
        kind: 'cnh_spot_close',
        manualUrl: `https://finance.yahoo.com/quote/${symbol}/history`,
        series: series.filter((r) => r.date >= DEFAULT_START).sort((a, b) => a.date.localeCompare(b.date)),
      };
    }
  }
  throw new Error('yahoo no data');
}

async function tryStooqUsdcnh() {
  for (const symbol of ['usdcnh', 'usdcnh.v']) {
    const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
    const text = await fetchText(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, retries: 1, timeout: 20000 });
    const lines = text.trim().split(/\r?\n/).slice(1);
    const series = [];
    for (const line of lines) {
      const [date, , , , close] = line.split(',');
      const v = parseFloat(close);
      if (date && !Number.isNaN(v) && v > 0) series.push({ date: normDate(date), value: v });
    }
    if (series.length >= 20) {
      return {
        source: `stooq-${symbol}`,
        label: `Stooq ${symbol}`,
        kind: 'cnh_spot_close',
        manualUrl: `https://stooq.com/q/d/l/?s=${symbol}&i=d`,
        series: series.filter((r) => r.date >= DEFAULT_START).sort((a, b) => a.date.localeCompare(b.date)),
      };
    }
  }
  throw new Error('stooq no data');
}

async function tryChinamoneyOnshoreToday() {
  const ts = Date.now();
  const url = `https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/fx/ccpr.json?t=${ts}`;
  const json = await fetchJson(url, {
    headers: { Referer: 'https://www.chinamoney.com.cn/chinese/bkccpr/', 'User-Agent': 'Mozilla/5.0' },
    retries: 2,
    timeout: 20000,
  });
  const records = json.data?.records || json.records || [];
  const usd = records.find((r) => String(r.vrtEName || r.vrtCode || '').includes('USD/CNY'));
  if (!usd?.price) throw new Error('chinamoney today only');
  const date = normDate(String(json.data?.lastDate || json.data?.lastDateEn || '').replace(/\//g, '-'));
  return {
    source: 'chinamoney-ccpr-today',
    label: '在岸USD/CNY中间价(当日)',
    kind: 'cny_midrate_today',
    manualUrl: 'https://www.chinamoney.com.cn/chinese/bkccpr/',
    series: date ? [{ date, value: parseFloat(usd.price) }] : [],
    note: '中国货币网仅提供当日在岸中间价，无公开历史序列；历史请用 FRED DEXCHUS',
  };
}

async function tryFredDexchus(startDate = DEFAULT_START) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXCHUS&cosd=${encodeURIComponent(startDate)}`;
  const text = await fetchText(url, { timeout: 45000, retries: 2, headers: FRED_CSV_HEADERS });
  const series = parseFredCsvFull(text)
    .filter((r) => r.date >= startDate)
    .map((r) => ({ date: r.date, value: r.value }));
  if (series.length < 20) throw new Error('fred dexchus empty');
  return {
    source: 'fred-dexchus',
    label: '在岸USD/CNY(DEXCHUS)',
    kind: 'cny_midrate_proxy',
    proxy: true,
    manualUrl: 'https://fred.stlouisfed.org/series/DEXCHUS',
    series,
  };
}

async function fetchCnhMidrateSeries(startDate = DEFAULT_START) {
  const attempts = [];
  const tryOrder = [
    ['chinamoney-offshore', async () => { throw new Error('无公开离岸CNH中间价历史API'); }],
    ['yahoo-finance', () => tryYahooUsdcnh()],
    ['stooq', () => tryStooqUsdcnh()],
    ['investing.com', async () => { throw new Error('Cloudflare 403'); }],
    ['fred-cnh', async () => { throw new Error('FRED CNH 序列不可用'); }],
    ['eastmoney-usdcnh', () => tryEastMoneyUsdcnh(startDate)],
    ['sina-fx', async () => { throw new Error('sinajs 403'); }],
  ];

  for (const [name, fn] of tryOrder) {
    try {
      const result = await fn();
      attempts.push({ source: name, ok: true, rows: result.series.length });
      return { ...result, startDate, attempts };
    } catch (err) {
      attempts.push({ source: name, ok: false, error: err.message });
    }
  }

  const onshore = await tryFredDexchus(startDate);
  attempts.push({ source: 'fred-dexchus-fallback', ok: true, rows: onshore.series.length, proxy: true });
  return {
    ...onshore,
    startDate,
    attempts,
    note: '离岸 USDCNH 全源失败，已回退在岸 DEXCHUS 代理',
  };
}

async function fetchOnshoreMidrateSeries(startDate = DEFAULT_START) {
  try {
    return await tryFredDexchus(startDate);
  } catch (err) {
    const today = await tryChinamoneyOnshoreToday();
    return { ...today, note: `FRED 失败(${err.message})；仅 chinamoney 当日` };
  }
}

function buildPayload(result) {
  const series = result.series || [];
  const updated = new Date().toISOString();
  return {
    seriesId: result.proxy ? 'USDCNY_MID' : 'USDCNH_MID',
    label: result.label,
    freq: 'daily',
    source: result.source,
    updated,
    fetchedAt: updated,
    startDate: result.startDate || DEFAULT_START,
    endDate: series.length ? series[series.length - 1].date : null,
    kind: result.kind || (result.proxy ? 'cny_midrate_proxy' : 'cnh_midrate'),
    proxy: Boolean(result.proxy),
    manualUrl: result.manualUrl || null,
    series,
    rowCount: series.length,
    sourceAttempts: result.attempts || null,
    note: result.note || null,
  };
}

function writeCsv(filePath, series) {
  const lines = ['date,value', ...series.map((r) => `${r.date},${r.value}`)];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function computeSpreadStats(cnhSeries, cnySeries) {
  const cnyMap = new Map(cnySeries.map((r) => [r.date, r.value]));
  const diffs = [];
  for (const r of cnhSeries) {
    const on = cnyMap.get(r.date);
    if (on != null) diffs.push({ date: r.date, cnh: r.value, cny: on, spread: r.value - on });
  }
  if (!diffs.length) return null;
  const spreads = diffs.map((d) => d.spread);
  const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const recent = diffs.slice(-30);
  const recentAvg = recent.reduce((a, b) => a + b.spread, 0) / recent.length;
  return {
    alignedDays: diffs.length,
    avgSpreadCnhMinusCny: +avg.toFixed(5),
    recent30dAvgSpread: +recentAvg.toFixed(5),
    sample: diffs.slice(-5),
  };
}

async function saveCnhMidrateFiles({ startDate = DEFAULT_START, includeOnshore = true } = {}) {
  const histDir = getHistoryDir();
  const result = await fetchCnhMidrateSeries(startDate);
  const payload = buildPayload(result);
  const jsonPath = path.join(histDir, 'cnh-midrate-daily.json');
  const csvPath = path.join(histDir, 'cnh-midrate-daily.csv');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  writeCsv(csvPath, payload.series);

  let onshorePayload = null;
  let spread = null;
  if (includeOnshore) {
    try {
      const onshore = await fetchOnshoreMidrateSeries(startDate);
      onshorePayload = buildPayload(onshore);
      const onshoreJson = path.join(histDir, 'cny-midrate-daily.json');
      const onshoreCsv = path.join(histDir, 'cny-midrate-daily.csv');
      fs.writeFileSync(onshoreJson, JSON.stringify(onshorePayload, null, 2), 'utf8');
      writeCsv(onshoreCsv, onshorePayload.series);
      if (!payload.proxy) {
        spread = computeSpreadStats(payload.series, onshorePayload.series);
      }
    } catch {
      // optional
    }
  }

  return { payload, jsonPath, csvPath, onshorePayload, spread };
}

module.exports = {
  DEFAULT_START,
  fetchCnhMidrateSeries,
  fetchOnshoreMidrateSeries,
  saveCnhMidrateFiles,
  computeSpreadStats,
  tryEastMoneyUsdcnh,
};
