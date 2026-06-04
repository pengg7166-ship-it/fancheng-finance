const { fetchText } = require('./http-client');
const diskCache = require('./disk-cache');

const FOREX_DISK_KEY = 'forex-rates.json';
const FOREX_DISK_TTL_MS = 60 * 1000;
const ALL_DATA_DISK_KEY = 'all-data.json';

let liveRefreshPromise = null;

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

/** 新浪财经外汇代码 — 实时报价 */
const FOREX_CATALOG = [
  {
    group: 'index',
    groupLabel: '美元基准',
    pairs: [
      {
        id: 'dxy',
        name: '美元指数',
        code: 'USD',
        quote: 'DXY',
        sina: 'DINIW',
        parser: 'dxy',
        decimals: 4,
      },
    ],
  },
  {
    group: 'major',
    groupLabel: '主要货币对',
    pairs: [
      {
        id: 'usdeur',
        name: '美元 / 欧元',
        code: 'USD/EUR',
        quote: 'EUR',
        sina: 'fx_susdeur',
        parser: 'fx',
        decimals: 4,
      },
      {
        id: 'usdgbp',
        name: '美元 / 英镑',
        code: 'USD/GBP',
        quote: 'GBP',
        sina: 'fx_susdgbp',
        parser: 'fx',
        decimals: 4,
      },
      {
        id: 'usdcny',
        name: '美元 / 人民币',
        code: 'USD/CNY',
        quote: 'CNY',
        sina: 'fx_susdcny',
        parser: 'fx',
        decimals: 4,
      },
      {
        id: 'usdhkd',
        name: '美元 / 港币',
        code: 'USD/HKD',
        quote: 'HKD',
        sina: 'fx_susdhkd',
        parser: 'fx',
        decimals: 4,
      },
      {
        id: 'usdjpy',
        name: '美元 / 日元',
        code: 'USD/JPY',
        quote: 'JPY',
        sina: 'fx_susdjpy',
        parser: 'fx',
        decimals: 2,
      },
      {
        id: 'usdkrw',
        name: '美元 / 韩元',
        code: 'USD/KRW',
        quote: 'KRW',
        sina: 'fx_susdkrw',
        parser: 'fx',
        decimals: 2,
      },
      {
        id: 'usdthb',
        name: '美元 / 泰铢',
        code: 'USD/THB',
        quote: 'THB',
        sina: 'fx_susdthb',
        parser: 'fx',
        decimals: 4,
      },
    ],
  },
];

const ALL_PAIRS = FOREX_CATALOG.flatMap((g) => g.pairs);

function pctChange(price, change) {
  const prev = price - change;
  if (!prev || Number.isNaN(prev) || Number.isNaN(change)) return 0;
  return (change / prev) * 100;
}

function parseSinaForex(raw) {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length < 9) return null;

  const price = parseFloat(parts[8]);
  const prevClose = parseFloat(parts[7]);
  if (Number.isNaN(price)) return null;

  const change = Number.isNaN(prevClose) ? 0 : price - prevClose;
  const quoteTime = parts[0] || '';
  const tradeDate = parts[parts.length - 1] || '';

  return {
    price,
    change,
    changePct: pctChange(price, change),
    quoteTime,
    tradeDate,
  };
}

function parseSinaDxy(raw) {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length < 9) return null;

  const price = parseFloat(parts[8]);
  const prevClose = parseFloat(parts[7]);
  if (Number.isNaN(price)) return null;

  const change = Number.isNaN(prevClose) ? price - parseFloat(parts[1]) : price - prevClose;
  return {
    price,
    change: Number.isNaN(change) ? 0 : change,
    changePct: pctChange(price, Number.isNaN(change) ? 0 : change),
    quoteTime: parts[0] || '',
    tradeDate: parts[parts.length - 1] || '',
  };
}

async function fetchSinaForexMap() {
  const codes = ALL_PAIRS.map((p) => p.sina);
  const url = `https://hq.sinajs.cn/list=${codes.join(',')}&_=${Date.now()}`;
  const text = await fetchText(url, {
    headers: SINA_HEADERS,
    timeout: 10000,
    retries: 2,
  });
  const map = {};
  for (const segment of text.split(';')) {
    const m = segment.match(/hq_str_(\w+)="([^"]*)"/);
    if (m && m[2]) map[m[1]] = m[2];
  }
  return map;
}

function buildPairRow(def, raw) {
  const parsed =
    def.parser === 'dxy' ? parseSinaDxy(raw) : parseSinaForex(raw);
  if (!parsed) return null;

  return {
    id: def.id,
    name: def.name,
    code: def.code,
    quote: def.quote,
    price: parsed.price,
    change: parsed.change,
    changePct: parsed.changePct,
    decimals: def.decimals,
    quoteTime: parsed.quoteTime,
    tradeDate: parsed.tradeDate,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchForexRates() {
  const map = await fetchSinaForexMap();
  const groups = [];
  let success = 0;
  let failed = 0;

  for (const groupDef of FOREX_CATALOG) {
    const pairs = [];
    for (const def of groupDef.pairs) {
      const row = buildPairRow(def, map[def.sina]);
      if (row) {
        pairs.push(row);
        success += 1;
      } else {
        failed += 1;
      }
    }
    if (pairs.length) {
      groups.push({
        id: groupDef.group,
        label: groupDef.groupLabel,
        pairs,
      });
    }
  }

  return {
    groups,
    pairs: groups.flatMap((g) => g.pairs),
    stats: { total: ALL_PAIRS.length, success, failed },
    fetchedAt: new Date().toISOString(),
  };
}

function persistForexPayload(payload) {
  diskCache.write(FOREX_DISK_KEY, { data: payload });
  try {
    const stale = diskCache.readStale(ALL_DATA_DISK_KEY);
    if (stale?.payload?.sources) {
      const merged = {
        ...stale.payload,
        sources: { ...stale.payload.sources, forex: payload },
        fetchedAt: new Date().toISOString(),
      };
      diskCache.write(ALL_DATA_DISK_KEY, { payload: merged, savedAt: Date.now() });
    }
  } catch {
    // ignore merge failures
  }
}

async function fetchForexSource() {
  const { groups, pairs, stats, fetchedAt } = await fetchForexRates();
  const payload = {
    key: 'forex',
    name: '外汇',
    groups,
    pairs,
    stats,
    news: [],
    indicators: [],
    dataLabel: '美元指数与主要货币对实时汇率',
    updatedAt: fetchedAt,
    liveRefreshedAt: fetchedAt,
    fetchedAt,
  };

  persistForexPayload(payload);
  return payload;
}

function refreshForexLiveInBackground() {
  if (liveRefreshPromise) return liveRefreshPromise;
  liveRefreshPromise = fetchForexSource()
    .catch(() => null)
    .finally(() => {
      liveRefreshPromise = null;
    });
  return liveRefreshPromise;
}

function getCachedForexSource() {
  const stored =
    diskCache.read(FOREX_DISK_KEY, FOREX_DISK_TTL_MS) ||
    diskCache.readStale(FOREX_DISK_KEY);
  return stored?.data || null;
}

async function fetchForexLive({ force = true } = {}) {
  if (!force) {
    const cached = getCachedForexSource();
    if (cached?.pairs?.length) {
      refreshForexLiveInBackground();
      return { ...cached, fromCache: true };
    }
  }
  return fetchForexSource();
}

async function fetchUsdJpyQuote() {
  const map = await fetchSinaForexMap();
  const parsed = parseSinaForex(map.fx_susdjpy);
  if (!parsed) return null;
  return {
    price: parsed.price,
    change: parsed.change,
    quoteTime: parsed.quoteTime,
    tradeDate: parsed.tradeDate,
  };
}

module.exports = {
  fetchForexSource,
  fetchForexLive,
  getCachedForexSource,
  fetchForexRates,
  fetchUsdJpyQuote,
  refreshForexLiveInBackground,
  FOREX_CATALOG,
};
