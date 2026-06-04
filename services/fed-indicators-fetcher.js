const diskCache = require('./disk-cache');
const { fetchFredSeries } = require('./fred-client');
const { fetchText } = require('./http-client');

const FED_INDICATORS_DISK_KEY = 'fed-indicators-v2.json';
const FED_INDICATORS_TTL_MS = 15 * 60 * 1000;
const FRED_SERIES_DELAY_MS = 700;

const FED_INDICATOR_SERIES = [
  { id: 'DFF', name: '联邦基金利率', unit: '%' },
  { id: 'DGS10', name: '10年期国债收益率', unit: '%' },
  { id: 'DGS2', name: '2年期国债收益率', unit: '%' },
  { id: 'T10Y2Y', name: '10年-2年利差', unit: '%' },
  { id: 'DEXCHUS', name: '美元/人民币汇率', unit: '人民币' },
  { id: 'UNRATE', name: '美国失业率', unit: '%' },
  { id: 'CPIAUCSL', name: '消费者物价指数', unit: '指数' },
  { id: 'M2SL', name: 'M2 货币供应量', unit: '十亿美元' },
  { id: 'VIXCLS', name: '波动率恐慌指数', unit: '' },
];

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function diffChange(latest, previous) {
  if (latest == null || previous == null) return null;
  const a = parseFloat(latest);
  const b = parseFloat(previous);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (a - b).toFixed(4);
}

function readTreasuryEntry(entry) {
  const get = (tag) => entry.match(new RegExp(`<d:${tag}[^>]*>([^<]+)`))?.[1];
  const dateRaw = get('NEW_DATE');
  return {
    date: dateRaw ? dateRaw.slice(0, 10) : '',
    dgs10: get('BC_10YEAR'),
    dgs2: get('BC_2YEAR'),
  };
}

async function fetchTreasuryYieldCurveRows() {
  const year = new Date().getFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const text = await fetchText(url, { timeout: 25000, retries: 2 });
  const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  if (!entries.length) return [];

  const latest = readTreasuryEntry(entries[entries.length - 1]);
  const previous = entries.length > 1 ? readTreasuryEntry(entries[entries.length - 2]) : null;
  if (!latest.dgs10 || !latest.dgs2) return [];

  const spread = (parseFloat(latest.dgs10) - parseFloat(latest.dgs2)).toFixed(2);
  const prevSpread =
    previous?.dgs10 && previous?.dgs2
      ? (parseFloat(previous.dgs10) - parseFloat(previous.dgs2)).toFixed(2)
      : null;

  return [
    {
      id: 'DGS10',
      name: '10年期国债收益率',
      unit: '%',
      value: latest.dgs10,
      date: latest.date,
      change: diffChange(latest.dgs10, previous?.dgs10),
      source: 'treasury',
    },
    {
      id: 'DGS2',
      name: '2年期国债收益率',
      unit: '%',
      value: latest.dgs2,
      date: latest.date,
      change: diffChange(latest.dgs2, previous?.dgs2),
      source: 'treasury',
    },
    {
      id: 'T10Y2Y',
      name: '10年-2年利差',
      unit: '%',
      value: spread,
      date: latest.date,
      change: diffChange(spread, prevSpread),
      source: 'treasury',
    },
  ];
}

async function fetchUsdcnyFromSina() {
  const url = `https://hq.sinajs.cn/list=fx_susdcny&_=${Date.now()}`;
  const text = await fetchText(url, { headers: SINA_HEADERS, timeout: 12000, retries: 2 });
  const raw = text.match(/hq_str_fx_susdcny="([^"]*)"/)?.[1];
  if (!raw) return null;

  const parts = raw.split(',');
  const price = parseFloat(parts[8]);
  const prevClose = parseFloat(parts[7]);
  if (Number.isNaN(price)) return null;

  const change = Number.isNaN(prevClose) ? null : (price - prevClose).toFixed(4);
  const tradeDate = parts[parts.length - 1] || new Date().toISOString().slice(0, 10);

  return {
    id: 'DEXCHUS',
    name: '美元/人民币汇率',
    unit: '人民币',
    value: price.toFixed(4),
    date: tradeDate,
    change,
    source: 'sina',
  };
}

async function fetchFredIndicatorRow(series) {
  const data = await fetchFredSeries(series.id);
  if (data?.value == null) return null;
  return {
    ...series,
    value: data.value,
    date: data.date,
    change: data.change,
    source: data.source || 'fred',
  };
}

function mergeIndicatorRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row?.id && row.value != null && row.value !== '') map.set(row.id, row);
  }
  return FED_INDICATOR_SERIES.map((s) => map.get(s.id)).filter(Boolean);
}

function getCachedFedIndicators() {
  const cached = diskCache.read(FED_INDICATORS_DISK_KEY, FED_INDICATORS_TTL_MS);
  return cached?.data || null;
}

function getStaleFedIndicators() {
  const stale = diskCache.readStale(FED_INDICATORS_DISK_KEY);
  return stale?.data || null;
}

async function fetchFedIndicators({ force = false } = {}) {
  if (!force) {
    const cached = getCachedFedIndicators();
    if (cached?.length) return cached;
  }

  const partial = [];

  try {
    partial.push(...(await fetchTreasuryYieldCurveRows()));
  } catch {
    // Treasury 失败时继续尝试其他来源
  }

  try {
    const usdcny = await fetchUsdcnyFromSina();
    if (usdcny) partial.push(usdcny);
  } catch {
    // ignore
  }

  const filledIds = new Set(partial.map((r) => r.id));
  const fredIds = FED_INDICATOR_SERIES.map((s) => s.id).filter((id) => !filledIds.has(id));

  for (const id of fredIds) {
    const series = FED_INDICATOR_SERIES.find((s) => s.id === id);
    if (!series) continue;
    try {
      const row = await fetchFredIndicatorRow(series);
      if (row) partial.push(row);
    } catch {
      // 单条失败不影响其余指标
    }
    await sleep(FRED_SERIES_DELAY_MS);
  }

  let indicators = mergeIndicatorRows(partial);

  if (!indicators.length) {
    const stale = getStaleFedIndicators();
    if (stale?.length) return stale;
    return [];
  }

  diskCache.write(FED_INDICATORS_DISK_KEY, { data: indicators });
  return indicators;
}

module.exports = {
  fetchFedIndicators,
  getCachedFedIndicators,
  FED_INDICATOR_SERIES,
};
