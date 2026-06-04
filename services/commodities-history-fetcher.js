const { getCommodityMeta, listCommoditiesWithHistory } = require('./commodities-catalog');
const { fetchJson, fetchText } = require('./http-client');
const diskCache = require('./disk-cache');

const KLINE_DISK_TTL_MS = 24 * 60 * 60 * 1000;
const KLINE_HOUR_DISK_TTL_MS = 60 * 60 * 1000;

function klineDiskKey(commodityId, timeframe) {
  return `klines/commodity-${commodityId}-${timeframe}.json`;
}

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn/futures/quotes/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const EM_HEADERS = {
  Referer: 'https://finance.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const TIMEFRAMES = {
  year: { label: '年K', klt: null, aggregate: 'year', pageSize: 240, maxYears: 20 },
  month: { label: '月K', klt: 103, pageSize: 500, maxYears: 20 },
  week: { label: '周K', klt: 102, pageSize: 500, maxYears: 20 },
  day: { label: '日K', klt: 101, pageSize: 5000, paginate: true, maxYears: 20 },
  hour: { label: '小时K', klt: 60, pageSize: 5000, paginate: true, maxYears: 20 },
};

function dateToNum(d) {
  return parseInt(String(d).replace(/[^\d]/g, '').slice(0, 14), 10) || 0;
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

function normalizeBar({ date, open, close, high, low, volume = 0 }) {
  if ([open, close, high, low].some((v) => Number.isNaN(v))) return null;
  return { date, open, close, high, low, volume: Number.isNaN(volume) ? 0 : volume };
}

function parseKlineRow(line) {
  const p = line.split(',');
  if (p.length < 5) return null;
  return normalizeBar({
    date: p[0],
    open: parseFloat(p[1]),
    close: parseFloat(p[2]),
    high: parseFloat(p[3]),
    low: parseFloat(p[4]),
    volume: p[5] ? parseFloat(p[5]) : 0,
  });
}

function aggregateYearly(bars) {
  const byYear = new Map();
  for (const b of bars) {
    const year = String(b.date).slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, { date: `${year}-12-31`, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
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
      byMonth.set(month, { date: `${month}-28`, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
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

function aggregateWeekly(bars) {
  const byWeek = new Map();
  for (const b of bars) {
    const d = new Date(String(b.date).slice(0, 10));
    if (Number.isNaN(d.getTime())) continue;
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day + 1);
    const key = monday.toISOString().slice(0, 10);
    if (!byWeek.has(key)) {
      byWeek.set(key, { date: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    } else {
      const w = byWeek.get(key);
      w.high = Math.max(w.high, b.high);
      w.low = Math.min(w.low, b.low);
      w.close = b.close;
      w.volume += b.volume;
    }
  }
  return [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function finalizeBars(bars, timeframe) {
  bars.sort((a, b) => dateToNum(a.date) - dateToNum(b.date));
  bars = filterByYears(bars, TIMEFRAMES[timeframe].maxYears);
  if (bars.length < 2) throw new Error('K线数据不足');
  return bars;
}

async function fetchSinaDailyBars(sinaSymbol) {
  const url = `https://stock2.finance.sina.com.cn/futures/api/json.php/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(sinaSymbol)}`;
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

async function fetchSinaHourBars(sinaSymbol) {
  const url = `https://stock2.finance.sina.com.cn/futures/api/json.php/InnerFuturesNewService.getMinLine?symbol=${encodeURIComponent(sinaSymbol)}&scale=60&datalen=5000`;
  const rows = await fetchJson(url, { headers: SINA_HEADERS, retries: 2 });
  if (!Array.isArray(rows)) return [];

  const minutes = [];
  let tradeDate = '';

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    if (row.length >= 7 && row[6]) tradeDate = row[6];
    if (!tradeDate) continue;

    const price = parseFloat(row[1]);
    const avg = parseFloat(row[2]);
    const volume = parseFloat(row[3]);
    if (Number.isNaN(price)) continue;

    minutes.push({
      date: `${tradeDate} ${row[0]}`,
      price,
      avg: Number.isNaN(avg) ? price : avg,
      volume: Number.isNaN(volume) ? 0 : volume,
    });
  }

  if (!minutes.length) return [];

  const byHour = new Map();
  for (const m of minutes) {
    const [day, time] = m.date.split(' ');
    const hour = (time || '00:00').slice(0, 2);
    const key = `${day} ${hour}:00`;
    if (!byHour.has(key)) {
      byHour.set(key, {
        date: key,
        open: m.price,
        high: m.price,
        low: m.price,
        close: m.price,
        volume: m.volume,
      });
    } else {
      const h = byHour.get(key);
      h.high = Math.max(h.high, m.price);
      h.low = Math.min(h.low, m.price);
      h.close = m.price;
      h.volume += m.volume;
    }
  }

  return [...byHour.values()].sort((a, b) => dateToNum(a.date) - dateToNum(b.date));
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
  const maxPages = tf === 'hour' ? 40 : tf === 'day' ? 15 : 5;

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
    await new Promise((r) => setTimeout(r, 180));
  }

  return all.filter((b) => dateToNum(b.date) >= minDate);
}

async function fetchEastMoneyBars(secid, timeframe) {
  const tf = TIMEFRAMES[timeframe];
  if (!tf) throw new Error('未知K线周期');

  if (timeframe === 'year') {
    const monthly = await fetchPaginatedEastMoney(secid, 'month');
    if (monthly.length >= 2) return aggregateYearly(monthly);
    const daily = await fetchPaginatedEastMoney(secid, 'day');
    return aggregateYearly(daily);
  }

  if (timeframe === 'month') {
    const bars = await fetchPaginatedEastMoney(secid, 'month');
    if (bars.length >= 2) return bars;
    const daily = await fetchPaginatedEastMoney(secid, 'day');
    return aggregateMonthly(daily);
  }

  if (timeframe === 'week') {
    const bars = await fetchPaginatedEastMoney(secid, 'week');
    if (bars.length >= 2) return bars;
    const daily = await fetchPaginatedEastMoney(secid, 'day');
    return aggregateWeekly(daily);
  }

  if (tf.paginate) {
    return fetchPaginatedEastMoney(secid, timeframe);
  }

  return filterByYears(await fetchEastMoneyPage(secid, tf.klt, tf.pageSize, '20500101'), tf.maxYears);
}

async function fetchBarsForCommodity(meta, timeframe) {
  if (!TIMEFRAMES[timeframe]) throw new Error('未知K线周期');

  let source = 'sina';
  let bars = [];

  if (meta.eastmoneySecid) {
    try {
      bars = await fetchEastMoneyBars(meta.eastmoneySecid, timeframe);
      if (bars.length >= 2) source = 'eastmoney';
    } catch {
      bars = [];
    }
  }

  if (bars.length < 2) {
    if (timeframe === 'hour') {
      bars = await fetchSinaHourBars(meta.sinaSymbol);
      source = 'sina-hour-recent';
    } else {
      const daily = await fetchSinaDailyBars(meta.sinaSymbol);
      if (timeframe === 'day') bars = daily;
      else if (timeframe === 'week') bars = aggregateWeekly(daily);
      else if (timeframe === 'month') bars = aggregateMonthly(daily);
      else if (timeframe === 'year') bars = aggregateYearly(daily);
      source = 'sina';
    }
  }

  if (bars.length < 2) throw new Error('K线数据源暂时不可用，请稍后重试');

  return { bars: finalizeBars(bars, timeframe), source };
}

function buildSummary(bars, timeframe) {
  const start = bars[0];
  const end = bars[bars.length - 1];
  const totalReturnPct = start.close ? ((end.close - start.close) / start.close) * 100 : 0;
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

async function fetchCommodityHistory(commodityId, timeframe = 'day', { force = false } = {}) {
  const meta = getCommodityMeta(commodityId);
  if (!meta) throw new Error('未知品种');

  const diskKey = klineDiskKey(commodityId, timeframe);
  const ttl = timeframe === 'hour' ? KLINE_HOUR_DISK_TTL_MS : KLINE_DISK_TTL_MS;
  if (!force) {
    const cached = diskCache.read(diskKey, ttl) || diskCache.readStale(diskKey);
    if (cached?.data) return { ...cached.data, fromCache: true };
  }

  const { bars, source } = await fetchBarsForCommodity(meta, timeframe);
  const summary = buildSummary(bars, timeframe);

  const data = {
    id: meta.id,
    name: meta.name,
    exchange: meta.exchange,
    unit: meta.unit,
    timeframe,
    source,
    sourceNote:
      source === 'sina-hour-recent'
        ? '小时K：新浪近期数据（完整20年小时K需东方财富数据源，当前网络暂不可达时将显示近期数据）'
        : null,
    summary,
    klines: bars,
  };

  diskCache.write(diskKey, { data });
  return data;
}

async function refreshCommodityKline(commodityId, timeframe, existingKlines = []) {
  const meta = getCommodityMeta(commodityId);
  if (!meta) throw new Error('未知品种');

  let latest = [];
  let source = 'sina';

  if (meta.eastmoneySecid) {
    try {
      const tf = TIMEFRAMES[timeframe];
      if (timeframe === 'year') {
        latest = aggregateYearly(await fetchEastMoneyPage(meta.eastmoneySecid, 103, 24, '20500101'));
      } else if (timeframe === 'month') {
        latest = await fetchEastMoneyPage(meta.eastmoneySecid, 103, 24, '20500101');
      } else if (timeframe === 'week') {
        latest = await fetchEastMoneyPage(meta.eastmoneySecid, 102, 24, '20500101');
      } else if (tf?.klt) {
        latest = await fetchEastMoneyPage(meta.eastmoneySecid, tf.klt, 15, '20500101');
      }
      if (latest.length >= 1) source = 'eastmoney';
    } catch {
      latest = [];
    }
  }

  if (latest.length < 1) {
    if (timeframe === 'hour') {
      latest = await fetchSinaHourBars(meta.sinaSymbol);
      source = 'sina-hour-recent';
    } else {
      const daily = await fetchSinaDailyBars(meta.sinaSymbol);
      if (timeframe === 'day') latest = daily.slice(-15);
      else if (timeframe === 'week') latest = aggregateWeekly(daily).slice(-4);
      else if (timeframe === 'month') latest = aggregateMonthly(daily).slice(-4);
      else if (timeframe === 'year') latest = aggregateYearly(daily).slice(-2);
    }
  }

  const merged = [...(existingKlines || [])];
  const idxMap = new Map(merged.map((b, i) => [b.date, i]));
  for (const bar of latest) {
    if (idxMap.has(bar.date)) merged[idxMap.get(bar.date)] = bar;
    else merged.push(bar);
  }
  merged.sort((a, b) => dateToNum(a.date) - dateToNum(b.date));
  const bars = finalizeBars(merged, timeframe);

  const data = {
    id: meta.id,
    name: meta.name,
    exchange: meta.exchange,
    timeframe,
    source,
    summary: buildSummary(bars, timeframe),
    klines: bars,
    refreshedAt: new Date().toISOString(),
  };

  diskCache.write(klineDiskKey(commodityId, timeframe), { data });
  return data;
}

module.exports = {
  fetchCommodityHistory,
  refreshCommodityKline,
  listCommoditiesWithHistory,
  TIMEFRAMES,
};
