const { fetchText } = require('./http-client');
const { getAllCommodities, listCommodityExchanges } = require('./commodities-catalog');
const diskCache = require('./disk-cache');

const LIVE_DISK_KEY = 'commodities-live.json';
const LIVE_DISK_TTL_MS = 5 * 60 * 1000;
const LIVE_DISK_STALE_MS = 7 * 24 * 60 * 60 * 1000;
let liveRefreshPromise = null;

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const BATCH_SIZE = 25;

function parseSinaFuturesLine(raw) {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length < 15) return null;

  const open = parseFloat(parts[2]);
  const high = parseFloat(parts[3]);
  const low = parseFloat(parts[4]);
  const bid = parseFloat(parts[6]);
  const ask = parseFloat(parts[7]);
  let price = parseFloat(parts[8]);
  const prevSettle = parseFloat(parts[10]);
  let openInterest = parseFloat(parts[13]);
  if (Number.isNaN(openInterest) || openInterest <= 0) {
    const altOi = parseFloat(parts[12]);
    if (!Number.isNaN(altOi) && altOi > 0) openInterest = altOi;
  }
  const volume = parseFloat(parts[14]);
  const tradeDate = parts[17] || parts[18] || '';

  if (Number.isNaN(price) || price === 0) {
    if (!Number.isNaN(bid) && bid > 0 && !Number.isNaN(ask) && ask > 0) {
      price = (bid + ask) / 2;
    } else if (parts.length > 27) {
      const avg = parseFloat(parts[27]);
      if (!Number.isNaN(avg) && avg > 0) price = avg;
    }
  }

  if (Number.isNaN(price) || price === 0) return null;

  const base = !Number.isNaN(prevSettle) && prevSettle > 0 ? prevSettle : open;
  const change = base ? price - base : 0;
  const changePct = base ? (change / base) * 100 : 0;

  return {
    price,
    open: Number.isNaN(open) ? price : open,
    high: Number.isNaN(high) ? price : high,
    low: Number.isNaN(low) ? price : low,
    change,
    changePct,
    volume: Number.isNaN(volume) ? 0 : volume,
    openInterest: Number.isNaN(openInterest) ? 0 : openInterest,
    updatedAt: tradeDate ? `${tradeDate}T15:00:00+08:00` : new Date().toISOString(),
  };
}

async function fetchSinaBatch(quoteCodes) {
  if (!quoteCodes.length) return {};
  const url = `https://hq.sinajs.cn/list=${quoteCodes.join(',')}`;
  const text = await fetchText(url, { headers: SINA_HEADERS, timeout: 20000, retries: 2 });
  const map = {};
  for (const segment of text.split(';')) {
    const m = segment.match(/hq_str_(\w+)="([^"]*)"/);
    if (m && m[2]) map[m[1]] = m[2];
  }
  return map;
}

async function fetchAllQuotes() {
  const all = getAllCommodities();
  const quoteCodes = all.map((c) => c.sinaQuote);
  const sinaMap = {};

  for (let i = 0; i < quoteCodes.length; i += BATCH_SIZE) {
    const batch = quoteCodes.slice(i, i + BATCH_SIZE);
    const part = await fetchSinaBatch(batch);
    Object.assign(sinaMap, part);
    if (i + BATCH_SIZE < quoteCodes.length) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  let success = 0;
  let failed = 0;
  const quoted = all.map((meta) => {
    const raw = sinaMap[meta.sinaQuote];
    const parsed = parseSinaFuturesLine(raw);
    if (parsed) {
      success += 1;
      return { ...meta, ...parsed, available: true };
    }
    failed += 1;
    return { ...meta, available: false, price: null, change: 0, changePct: 0 };
  });

  return { items: quoted, stats: { total: all.length, success, failed } };
}

async function fetchCommoditiesLiveInner() {
  const quotes = await fetchAllQuotes();
  const byExchange = listCommodityExchanges().map((ex) => ({
    ...ex,
    items: quotes.items
      .filter((q) => q.exchangeId === ex.id)
      .map((q) => ({
        id: q.id,
        name: q.name,
        exchange: q.exchange,
        exchangeId: q.exchangeId,
        unit: q.unit,
        price: q.price,
        open: q.open,
        high: q.high,
        low: q.low,
        change: q.change,
        changePct: q.changePct,
        volume: q.volume,
        openInterest: q.openInterest,
        updatedAt: q.updatedAt,
        available: q.available,
        sinaSymbol: q.sinaSymbol,
      })),
  }));

  return {
    exchanges: byExchange,
    stats: quotes.stats,
    fetchedAt: new Date().toISOString(),
  };
}

function refreshCommoditiesLiveInBackground() {
  if (liveRefreshPromise) return liveRefreshPromise;
  liveRefreshPromise = fetchCommoditiesLiveInner()
    .then((data) => {
      diskCache.write(LIVE_DISK_KEY, { data });
      return data;
    })
    .finally(() => {
      liveRefreshPromise = null;
    });
  return liveRefreshPromise;
}

async function fetchCommoditiesLive({ force = false } = {}) {
  if (!force) {
    const stored = diskCache.read(LIVE_DISK_KEY, LIVE_DISK_TTL_MS);
    if (stored?.data) {
      refreshCommoditiesLiveInBackground();
      return { ...stored.data, fromCache: true };
    }
    const stale = diskCache.read(LIVE_DISK_KEY, LIVE_DISK_STALE_MS) || diskCache.readStale(LIVE_DISK_KEY);
    if (stale?.data) {
      refreshCommoditiesLiveInBackground();
      return { ...stale.data, fromCache: true };
    }
  }

  const data = await fetchCommoditiesLiveInner();
  diskCache.write(LIVE_DISK_KEY, { data });
  return data;
}

function getCachedCommoditiesLive() {
  const stored = diskCache.readStale(LIVE_DISK_KEY);
  return stored?.data || null;
}

module.exports = {
  fetchCommoditiesLive,
  fetchAllQuotes,
  parseSinaFuturesLine,
  getCachedCommoditiesLive,
  refreshCommoditiesLiveInBackground,
};
