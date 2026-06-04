const { INDICES } = require('./indices-fetcher');
const { fetchJson } = require('./http-client');
const { fetchStooqHistory } = require('./stooq-history');
const diskCache = require('./disk-cache');

const KLINE_DISK_TTL_MS = 24 * 60 * 60 * 1000;
const KLINE_HOUR_DISK_TTL_MS = 60 * 60 * 1000;

function klineDiskKey(indexId, timeframe) {
  return `klines/index-${indexId}-${timeframe}.json`;
}

const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://finance.eastmoney.com/',
};

const SINA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://finance.sina.com.cn',
};

const TENCENT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://finance.qq.com/',
};

/** 东方财富 klt：60=60分钟 101=日 103=月 */
const TIMEFRAMES = {
  year: { label: '年K', klt: null, aggregate: 'year', pageSize: 240, maxYears: 20 },
  month: { label: '月K', klt: 103, pageSize: 500, maxYears: 20 },
  day: { label: '日K', klt: 101, pageSize: 5000, paginate: true, maxYears: 20 },
  hour: { label: '小时K', klt: 60, pageSize: 5000, paginate: true, maxYears: 20 },
};

const HISTORY_CONFIG = {
  sp500: { eastmoney: '100.SPX', sinaUs: '.INX' },
  dji: { eastmoney: '100.DJI', sinaUs: '.DJI' },
  ixic: { eastmoney: '100.NDX', sinaUs: '.IXIC' },
  rut: { eastmoney: '100.RUT', stooq: '^rut' },
  tsx: { eastmoney: '100.TSX', stooq: '^tsx' },
  bvsp: { eastmoney: '100.BVSP', stooq: '^bvsp' },
  mxx: { eastmoney: '100.MXX', stooq: '^mxx' },
  ftse: { eastmoney: '100.FTSE', stooq: '^ftse' },
  dax: { eastmoney: '100.GDAXI', stooq: '^dax' },
  cac: { eastmoney: '100.CAC', stooq: '^cac' },
  stoxx50: { eastmoney: '100.SXXP', stooq: '^stoxx50e' },
  ssmi: { eastmoney: '100.SSMI', stooq: '^ssmi' },
  ibex: { eastmoney: '100.IBEX', stooq: '^ibex' },
  aex: { eastmoney: '100.AEX', stooq: '^aex' },
  n225: { eastmoney: '100.N225', sinaFutures: 'NK' },
  hsi: { eastmoney: '100.HSI', tencent: 'hkHSI', sinaFutures: 'HSI' },
  sse: { eastmoney: '1.000001', sinaCn: 'sh000001', tencent: 'sh000001' },
  szse: { eastmoney: '0.399001', sinaCn: 'sz399001', tencent: 'sz399001' },
  chinext: { eastmoney: '0.399006', sinaCn: 'sz399006', tencent: 'sz399006' },
  kospi: { eastmoney: '100.KS11', stooq: '^kospi' },
  twii: { eastmoney: '100.TWII', stooq: '^twii' },
  nifty: { eastmoney: '100.NSEI', stooq: '^nsei' },
  sensex: { eastmoney: '100.SENSEX', stooq: '^bsesn' },
  axjo: { eastmoney: '100.ASX', stooq: '^axjo' },
  sti: { eastmoney: '100.STR', stooq: '^sti' },
  tasi: { eastmoney: '100.TASI', stooq: '^tasi' },
  jse: { eastmoney: '100.JALSH', stooq: '^j203' },
};

function getIndexMeta(indexId) {
  for (const group of INDICES) {
    const item = group.items.find((i) => i.id === indexId);
    if (item) return { ...item, region: group.region };
  }
  return null;
}

function listIndicesWithHistory() {
  return INDICES.flatMap((g) =>
    g.items
      .filter((i) => HISTORY_CONFIG[i.id])
      .map((i) => ({ id: i.id, name: i.name, market: i.market, region: g.region }))
  );
}

function parseKlineRow(line) {
  const p = line.split(',');
  if (p.length < 5) return null;
  const open = parseFloat(p[1]);
  const close = parseFloat(p[2]);
  const high = parseFloat(p[3]);
  const low = parseFloat(p[4]);
  const volume = p[5] ? parseFloat(p[5]) : 0;
  if ([open, close, high, low].some((v) => Number.isNaN(v))) return null;
  return {
    date: p[0],
    open,
    close,
    high,
    low,
    volume: Number.isNaN(volume) ? 0 : volume,
  };
}

function normalizeBar({ date, open, close, high, low, volume = 0 }) {
  if ([open, close, high, low].some((v) => Number.isNaN(v))) return null;
  return {
    date,
    open,
    close,
    high,
    low,
    volume: Number.isNaN(volume) ? 0 : volume,
  };
}

function dateToNum(d) {
  return parseInt(String(d).replace(/[^\d]/g, '').slice(0, 8), 10) || 0;
}

function cutoffDate(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return parseInt(`${y}${m}${day}`, 10);
}

function filterByYears(bars, years) {
  const minDate = cutoffDate(years);
  return bars.filter((b) => dateToNum(b.date) >= minDate);
}

async function fetchEastMoneyPage(secid, klt, lmt, end) {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', secid);
  url.searchParams.set('fields1', 'f1');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
  url.searchParams.set('klt', String(klt));
  url.searchParams.set('fqt', '1');
  url.searchParams.set('end', end);
  url.searchParams.set('lmt', String(lmt));

  const json = await fetchJson(url.toString(), { headers: EM_HEADERS, retries: 3 });
  const klines = json.data?.klines || [];
  return klines.map(parseKlineRow).filter(Boolean);
}

async function fetchPaginatedEastMoney(secid, tf) {
  const cfg = TIMEFRAMES[tf];
  const minDate = cutoffDate(cfg.maxYears);
  let end = '20500101';
  const all = [];
  const seen = new Set();
  let pages = 0;
  const maxPages = tf === 'hour' ? 40 : tf === 'day' ? 15 : 3;

  while (pages < maxPages) {
    const batch = await fetchEastMoneyPage(secid, cfg.klt, cfg.pageSize, end);
    if (!batch.length) break;

    for (const bar of batch) {
      const key = bar.date;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(bar);
      }
    }

    all.sort((a, b) => dateToNum(a.date) - dateToNum(b.date));

    const oldest = all[0];
    if (!oldest || dateToNum(oldest.date) <= minDate) break;

    const oldestNum = dateToNum(oldest.date);
    if (oldestNum >= dateToNum(end)) break;

    end = String(oldestNum);
    pages += 1;

    if (batch.length < cfg.pageSize) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  return all.filter((b) => dateToNum(b.date) >= minDate);
}

async function fetchSinaUsBars(symbol, timeframe) {
  let url;
  if (timeframe === 'hour') {
    url = `https://stock.finance.sina.com.cn/usstock/api/json.php/US_MinKService.getMinK?symbol=${encodeURIComponent(symbol)}&type=60&___qn=5000`;
  } else {
    url = `https://stock.finance.sina.com.cn/usstock/api/json.php/US_MinKService.getDailyK?symbol=${encodeURIComponent(symbol)}&___qn=5000`;
  }

  const rows = await fetchJson(url, { headers: SINA_HEADERS, retries: 2 });
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) =>
      normalizeBar({
        date: row.d,
        open: parseFloat(row.o),
        high: parseFloat(row.h),
        low: parseFloat(row.l),
        close: parseFloat(row.c),
        volume: parseFloat(row.v),
      })
    )
    .filter(Boolean);
}

async function fetchSinaCnBars(symbol, timeframe) {
  const scale = timeframe === 'hour' ? 60 : 240;
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${encodeURIComponent(symbol)}&scale=${scale}&ma=no&datalen=5000`;
  const rows = await fetchJson(url, { headers: SINA_HEADERS, retries: 2 });
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) =>
      normalizeBar({
        date: row.day,
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseFloat(row.volume),
      })
    )
    .filter(Boolean);
}

async function fetchSinaFuturesBars(symbol) {
  const url = `https://stock2.finance.sina.com.cn/futures/api/json.php/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${encodeURIComponent(symbol)}&___qn=5000`;
  const rows = await fetchJson(url, { headers: SINA_HEADERS, retries: 2 });
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) =>
      normalizeBar({
        date: row.date,
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseFloat(row.volume),
      })
    )
    .filter(Boolean);
}

async function fetchTencentBars(code, timeframe) {
  const tfMap = {
    day: 'day',
    month: 'month',
    year: 'month',
    hour: 'm60',
  };
  const tf = tfMap[timeframe];
  if (!tf) return [];

  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(code)},${tf},,,3200,qfq`;
  const json = await fetchJson(url, { headers: TENCENT_HEADERS, retries: 2 });
  const bucket = json?.data?.[code]?.[tf];
  if (!Array.isArray(bucket) || bucket.length < 2) return [];

  return bucket
    .map((row) =>
      normalizeBar({
        date: row[0],
        open: parseFloat(row[1]),
        close: parseFloat(row[2]),
        high: parseFloat(row[3]),
        low: parseFloat(row[4]),
        volume: parseFloat(row[5]),
      })
    )
    .filter(Boolean);
}

function aggregateYearly(bars) {
  const byYear = new Map();
  for (const b of bars) {
    const year = String(b.date).slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, {
        date: `${year}-12-31`,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      });
    } else {
      const y = byYear.get(year);
      y.high = Math.max(y.high, b.high);
      y.low = Math.min(y.low, b.low);
      y.close = b.close;
      y.volume += b.volume;
    }
  }
  return [...byYear.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateMonthly(bars) {
  const byMonth = new Map();
  for (const b of bars) {
    const month = String(b.date).slice(0, 7);
    if (!byMonth.has(month)) {
      byMonth.set(month, {
        date: `${month}-28`,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      });
    } else {
      const m = byMonth.get(month);
      m.high = Math.max(m.high, b.high);
      m.low = Math.min(m.low, b.low);
      m.close = b.close;
      m.volume += b.volume;
    }
  }
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function finalizeBars(bars, timeframe) {
  bars.sort((a, b) => dateToNum(a.date) - dateToNum(b.date));
  bars = filterByYears(bars, TIMEFRAMES[timeframe].maxYears);
  if (bars.length < 2) throw new Error('K线数据不足');
  return bars;
}

async function fetchEastMoneyBars(secid, timeframe) {
  const tf = TIMEFRAMES[timeframe];
  if (!tf) throw new Error('未知K线周期');

  if (timeframe === 'year') {
    const monthly = await fetchPaginatedEastMoney(secid, 'month');
    if (monthly.length < 2) {
      const daily = await fetchPaginatedEastMoney(secid, 'day');
      return aggregateYearly(daily);
    }
    return aggregateYearly(monthly);
  }

  if (timeframe === 'month') {
    const bars = await fetchPaginatedEastMoney(secid, 'month');
    if (bars.length >= 2) return bars;
    const daily = await fetchPaginatedEastMoney(secid, 'day');
    return aggregateMonthly(daily);
  }

  if (tf.paginate) {
    return fetchPaginatedEastMoney(secid, timeframe);
  }

  const bars = await fetchEastMoneyPage(secid, tf.klt, tf.pageSize, '20500101');
  return filterByYears(bars, tf.maxYears);
}

async function fetchStooqBars(symbol, timeframe) {
  const bars = await fetchStooqHistory(symbol, timeframe, TIMEFRAMES[timeframe].maxYears);
  if (timeframe === 'year') return aggregateYearly(bars);
  if (timeframe === 'month' && bars.length >= 2 && String(bars[0].date).length <= 10) {
    const dailyLike = bars.every((b) => String(b.date).length > 8);
    if (dailyLike) return aggregateMonthly(bars);
  }
  return bars;
}

async function fetchFallbackBars(cfg, timeframe) {
  const tf = TIMEFRAMES[timeframe];
  if (!tf) throw new Error('未知K线周期');

  if (cfg.stooq) {
    try {
      const bars = await fetchStooqBars(cfg.stooq, timeframe);
      if (bars.length >= 2) return bars;
    } catch (err) {
      if (/历史数据密钥|欧洲等地指数/.test(err.message)) throw err;
    }
  }

  if (cfg.sinaUs && (timeframe === 'day' || timeframe === 'hour')) {
    const bars = await fetchSinaUsBars(cfg.sinaUs, timeframe);
    if (bars.length >= 2) {
      if (timeframe === 'month') return aggregateMonthly(bars);
      if (timeframe === 'year') return aggregateYearly(bars);
      return bars;
    }
  }

  if (cfg.sinaCn && (timeframe === 'day' || timeframe === 'hour')) {
    const bars = await fetchSinaCnBars(cfg.sinaCn, timeframe);
    if (bars.length >= 2) {
      if (timeframe === 'month') return aggregateMonthly(bars);
      if (timeframe === 'year') return aggregateYearly(bars);
      return bars;
    }
  }

  if (cfg.sinaFutures && (timeframe === 'day' || timeframe === 'month' || timeframe === 'year')) {
    const bars = await fetchSinaFuturesBars(cfg.sinaFutures);
    if (bars.length >= 2) {
      if (timeframe === 'month') return aggregateMonthly(bars);
      if (timeframe === 'year') return aggregateYearly(bars);
      return bars;
    }
  }

  if (cfg.tencent && timeframe !== 'hour') {
    const bars = await fetchTencentBars(cfg.tencent, timeframe);
    if (bars.length >= 2) {
      if (timeframe === 'year') return aggregateYearly(bars);
      return bars;
    }
  }

  if (cfg.sinaUs && (timeframe === 'month' || timeframe === 'year')) {
    const daily = await fetchSinaUsBars(cfg.sinaUs, 'day');
    if (daily.length >= 2) {
      return timeframe === 'year' ? aggregateYearly(daily) : aggregateMonthly(daily);
    }
  }

  if (cfg.sinaCn && (timeframe === 'month' || timeframe === 'year')) {
    const daily = await fetchSinaCnBars(cfg.sinaCn, 'day');
    if (daily.length >= 2) {
      return timeframe === 'year' ? aggregateYearly(daily) : aggregateMonthly(daily);
    }
  }

  return [];
}

async function fetchBarsForIndex(indexId, timeframe) {
  const cfg = HISTORY_CONFIG[indexId];
  if (!cfg) throw new Error('该指数暂无K线数据');
  if (!TIMEFRAMES[timeframe]) throw new Error('未知K线周期');

  let source = 'eastmoney';
  let bars = [];

  if (cfg.eastmoney) {
    try {
      bars = await fetchEastMoneyBars(cfg.eastmoney, timeframe);
    } catch {
      bars = [];
    }
  }

  if (bars.length < 2) {
    try {
      bars = await fetchFallbackBars(cfg, timeframe);
    } catch (err) {
      if (/历史数据密钥|欧洲等地指数/.test(err.message)) throw err;
    }
    if (bars.length >= 2) {
      if (cfg.stooq) source = 'stooq';
      else if (cfg.sinaUs && (timeframe === 'day' || timeframe === 'hour')) source = 'sina-us';
      else if (cfg.sinaCn) source = 'sina-cn';
      else if (cfg.sinaFutures) source = 'sina-futures';
      else if (cfg.tencent) source = 'tencent';
    }
  }

  if (bars.length < 2) {
    if (cfg.stooq) {
      throw new Error('欧洲等地指数 K 线需配置历史数据密钥，请在设置中填写');
    }
    throw new Error('K线数据源暂时不可用，请稍后重试');
  }

  return { bars: finalizeBars(bars, timeframe), source };
}

function buildSummary(bars, timeframe) {
  const start = bars[0];
  const end = bars[bars.length - 1];
  const totalReturnPct = start.close
    ? ((end.close - start.close) / start.close) * 100
    : 0;
  return {
    timeframe,
    timeframeLabel: TIMEFRAMES[timeframe]?.label || timeframe,
    startDate: start.date,
    endDate: end.date,
    startValue: start.close,
    endValue: end.close,
    high20y: Math.max(...bars.map((b) => b.high)),
    low20y: Math.min(...bars.map((b) => b.low)),
    totalReturnPct,
    bars: bars.length,
  };
}


async function refreshIndexKline(indexId, timeframe, existingKlines = []) {
  const meta = getIndexMeta(indexId);
  if (!meta) throw new Error('未知指数');

  const cfg = HISTORY_CONFIG[indexId];
  if (!cfg) throw new Error('该指数暂无K线数据');
  if (!TIMEFRAMES[timeframe]) throw new Error('未知K线周期');

  let latest = [];
  let source = 'eastmoney';

  if (cfg.eastmoney) {
    try {
      const tf = TIMEFRAMES[timeframe];
      if (timeframe === 'year') {
        latest = aggregateYearly(await fetchEastMoneyPage(cfg.eastmoney, 103, 24, '20500101'));
      } else if (timeframe === 'month') {
        latest = await fetchEastMoneyPage(cfg.eastmoney, 103, 24, '20500101');
      } else {
        latest = await fetchEastMoneyPage(cfg.eastmoney, tf.klt, 15, '20500101');
      }
    } catch {
      latest = [];
    }
  }

  if (latest.length < 1) {
    const full = await fetchBarsForIndex(indexId, timeframe);
    latest = full.bars.slice(-15);
    source = full.source;
  }

  const merged = mergeKlines(existingKlines, latest);
  const filtered = filterByYears(merged, TIMEFRAMES[timeframe].maxYears);
  if (filtered.length < 2) throw new Error('K线数据不足');

  const data = {
    id: indexId,
    name: meta.name,
    market: meta.market,
    region: meta.region,
    timeframe,
    timeframeLabel: TIMEFRAMES[timeframe].label,
    source,
    klines: filtered,
    summary: buildSummary(filtered, timeframe),
    refreshedAt: new Date().toISOString(),
  };

  diskCache.write(klineDiskKey(indexId, timeframe), { data });
  return data;
}

function mergeKlines(existing, incoming) {
  const map = new Map();
  for (const b of existing) map.set(b.date, b);
  for (const b of incoming) map.set(b.date, b);
  return [...map.values()];
}

async function fetchIndexHistory(indexId, timeframe = 'day', { force = false } = {}) {
  const meta = getIndexMeta(indexId);
  if (!meta) throw new Error('未知指数');

  const diskKey = klineDiskKey(indexId, timeframe);
  const ttl = timeframe === 'hour' ? KLINE_HOUR_DISK_TTL_MS : KLINE_DISK_TTL_MS;
  if (!force) {
    const cached = diskCache.read(diskKey, ttl) || diskCache.readStale(diskKey);
    if (cached?.data) return { ...cached.data, fromCache: true };
  }

  const { bars, source } = await fetchBarsForIndex(indexId, timeframe);

  const data = {
    id: indexId,
    name: meta.name,
    market: meta.market,
    region: meta.region,
    timeframe,
    timeframeLabel: TIMEFRAMES[timeframe].label,
    source,
    klines: bars,
    summary: buildSummary(bars, timeframe),
  };

  diskCache.write(diskKey, { data });
  return data;
}

module.exports = {
  fetchIndexHistory,
  refreshIndexKline,
  listIndicesWithHistory,
  getIndexMeta,
  TIMEFRAMES,
  HISTORY_CONFIG,
};
