/**
 * 品种基本面第八车道 · 美国 EIA 周度石油库存 + 中国黑色系产量/投资代理
 * 数据须来自真实 fetch；缺失返回 null / pending，禁止占位
 */
const { fetchJson } = require('./http-client');
const { fetchFredBatch } = require('./fred-client');
const { getEiaApiKey, isEiaApiKeyConfigured } = require('./config');
const diskCache = require('./disk-cache');

const FUNDAMENTALS_VERSION = 'v1.54.0-fundamentals';
const DISK_KEY = 'fundamentals-lane.json';
const DISK_TTL_MS = 6 * 60 * 60 * 1000;

const EM_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const EM_TOKEN = '894050c76af8597a853f5b408b759f5d';
const EM_HEADERS = { Referer: 'https://data.eastmoney.com/' };

/** FRED 上的 EIA 周度库存序列（与 EIA Weekly Petroleum Status 同源） */
const US_PETROLEUM_FRED = [
  {
    id: 'WCESTUS1',
    name: '美国商业原油库存',
    unit: '千桶',
    sector: 'energy',
    commodities: ['sc', 'fu', 'lu', 'bu', 'pg'],
    category: 'inventory',
  },
  {
    id: 'WGTSTUS1',
    name: '美国汽油库存',
    unit: '千桶',
    sector: 'energy',
    commodities: ['fu', 'pg'],
    category: 'inventory',
  },
  {
    id: 'WKJSTUS1',
    name: '美国馏分油库存',
    unit: '千桶',
    sector: 'energy',
    commodities: ['fu', 'lu'],
    category: 'inventory',
  },
];

const EIA_API_SERIES = {
  WCESTUS1: '美国商业原油库存',
  WGTSTUS1: '美国汽油库存',
  WKJSTUS1: '美国馏分油库存',
};

function pctChange(cur, prev) {
  if (cur == null || prev == null || Number.isNaN(cur) || Number.isNaN(prev)) return null;
  const denom = Math.max(Math.abs(prev), 1e-9);
  return +(((cur - prev) / denom) * 100).toFixed(3);
}

function indicatorRow(row) {
  return {
    ...row,
    dataSource: row.dataSource || 'commodity-fundamentals-fetcher',
  };
}

async function fetchEastmoneyRows(reportName, columns, pageSize = 2) {
  const params = new URLSearchParams({
    reportName,
    columns,
    pageSize: String(pageSize),
    pageNumber: '1',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB',
    token: EM_TOKEN,
  });
  const json = await fetchJson(`${EM_BASE}?${params}`, {
    timeout: 12000,
    headers: EM_HEADERS,
    retries: 2,
  });
  if (!json.success || !json.result?.data?.length) {
    throw new Error(json.message || `Eastmoney ${reportName} 无数据`);
  }
  return json.result.data;
}

async function fetchEiaWeeklyStocks() {
  if (!isEiaApiKeyConfigured()) return [];

  const key = getEiaApiKey();
  const facets = Object.keys(EIA_API_SERIES)
    .map((s) => `facets[series][]=${encodeURIComponent(s)}`)
    .join('&');
  const url =
    `https://api.eia.gov/v2/petroleum/stoc/wstk/data/?api_key=${encodeURIComponent(key)}` +
    `&frequency=weekly&data[0]=value&${facets}` +
    '&sort[0][column]=period&sort[0][direction]=desc&length=8';

  const json = await fetchJson(url, { timeout: 15000, retries: 1 });
  const rows = json.response?.data || [];
  const bySeries = new Map();

  for (const row of rows) {
    const sid = row.series;
    if (!bySeries.has(sid)) bySeries.set(sid, []);
    bySeries.get(sid).push(row);
  }

  const indicators = [];
  for (const [seriesId, label] of Object.entries(EIA_API_SERIES)) {
    const pts = (bySeries.get(seriesId) || []).sort((a, b) => String(b.period).localeCompare(String(a.period)));
    const cur = pts[0];
    const prev = pts[1];
    if (!cur) continue;
    const meta = US_PETROLEUM_FRED.find((s) => s.id === seriesId);
    const curVal = Number(cur.value);
    const prevVal = prev ? Number(prev.value) : null;
    indicators.push(
      indicatorRow({
        id: seriesId,
        name: label,
        value: String(curVal),
        date: String(cur.period || '').slice(0, 10),
        change: prevVal != null ? String((curVal - prevVal).toFixed(1)) : null,
        changePct: prevVal != null ? pctChange(curVal, prevVal) : null,
        unit: meta?.unit || '千桶',
        group: 'us',
        sector: 'energy',
        category: 'inventory',
        commodities: meta?.commodities || ['sc'],
        dataSource: 'eia-api-v2',
      })
    );
  }
  return indicators;
}

async function fetchFredPetroleumStocks() {
  const rows = await fetchFredBatch(US_PETROLEUM_FRED);
  return (rows || []).map((r) => {
    const cur = parseFloat(r.value);
    const chg = r.change != null ? parseFloat(r.change) : null;
    const prev = chg != null && !Number.isNaN(cur) ? cur - chg : null;
    return indicatorRow({
      id: r.id,
      name: r.name,
      value: r.value,
      date: r.date,
      change: r.change,
      changePct: prev != null ? pctChange(cur, prev) : null,
      unit: r.unit,
      group: 'us',
      sector: r.sector || 'energy',
      category: r.category || 'inventory',
      commodities: r.commodities || ['sc'],
      dataSource: r.source || 'fred-eia-weekly',
    });
  });
}

async function fetchCnBlackSectorProxies() {
  const [indusRows, investRows, ppiRows] = await Promise.all([
    fetchEastmoneyRows('RPT_ECONOMY_INDUS_GROW', 'REPORT_DATE,TIME,BASE_SAME,BASE_ACCUMULATE', 2),
    fetchEastmoneyRows(
      'RPT_ECONOMY_ASSET_INVEST',
      'REPORT_DATE,TIME,BASE,BASE_SAME,BASE_SEQUENTIAL,BASE_ACCUMULATE',
      2
    ),
    fetchEastmoneyRows('RPT_ECONOMY_PPI', 'REPORT_DATE,TIME,BASE,BASE_SAME,BASE_ACCUMULATE', 2),
  ]);

  const indicators = [];
  const indus = indusRows[0];
  const indusPrev = indusRows[1];
  if (indus) {
    indicators.push(
      indicatorRow({
        id: 'cn-indus-growth',
        name: '规模以上工业增加值同比',
        value: String(indus.BASE_SAME),
        date: String(indus.TIME || indus.REPORT_DATE || '').slice(0, 10),
        change: indusPrev ? pctChange(indus.BASE_SAME, indusPrev.BASE_SAME) : null,
        unit: '%',
        group: 'cn',
        sector: 'black',
        category: 'production',
        commodities: ['rb', 'hc', 'i', 'j', 'jm', 'ss'],
        note: '黑色系产量景气代理',
        dataSource: 'eastmoney-macro',
      })
    );
  }

  const inv = investRows[0];
  const invPrev = investRows[1];
  if (inv) {
    indicators.push(
      indicatorRow({
        id: 'cn-fixed-invest',
        name: '固定资产投资完成额(当月)',
        value: String(inv.BASE),
        date: String(inv.TIME || inv.REPORT_DATE || '').slice(0, 10),
        changePct: inv.BASE_SAME != null ? Number(inv.BASE_SAME) : null,
        change: invPrev ? pctChange(inv.BASE, invPrev.BASE) : null,
        unit: '亿元',
        group: 'cn',
        sector: 'black',
        category: 'consumption',
        commodities: ['rb', 'hc', 'i', 'j', 'jm'],
        note: '黑色系需求/基建地产代理',
        dataSource: 'eastmoney-macro',
      })
    );
  }

  const ppi = ppiRows[0];
  const ppiPrev = ppiRows[1];
  if (ppi) {
    indicators.push(
      indicatorRow({
        id: 'cn-ppi-yoy',
        name: 'PPI 同比',
        value: String(ppi.BASE_SAME),
        date: String(ppi.TIME || ppi.REPORT_DATE || '').slice(0, 10),
        change: ppiPrev ? pctChange(ppi.BASE_SAME, ppiPrev.BASE_SAME) : null,
        unit: '%',
        group: 'cn',
        sector: 'black',
        category: 'production',
        commodities: ['rb', 'hc', 'i', 'j', 'jm', 'cu', 'al'],
        note: '工业品价格/炼化利润代理',
        dataSource: 'eastmoney-macro',
      })
    );
  }

  return indicators;
}

function buildCommodityMap(indicators = []) {
  const map = {};
  for (const ind of indicators) {
    for (const cid of ind.commodities || []) {
      const sym = String(cid).toLowerCase();
      if (!map[sym]) map[sym] = { indicators: [], sectors: new Set() };
      map[sym].indicators.push({
        id: ind.id,
        name: ind.name,
        value: ind.value,
        changePct: ind.changePct,
        category: ind.category,
        date: ind.date,
        dataSource: ind.dataSource,
      });
      if (ind.sector) map[sym].sectors.add(ind.sector);
    }
  }
  return Object.fromEntries(
    Object.entries(map).map(([sym, row]) => [sym, { ...row, sectors: [...row.sectors] }])
  );
}

async function fetchFundamentalsSource() {
  const errors = [];
  const [petroleumSettled, blackSettled] = await Promise.allSettled([
    (async () => {
      let petroleum = [];
      try {
        petroleum = await fetchEiaWeeklyStocks();
      } catch (err) {
        errors.push({ lane: 'eia', message: err.message });
      }
      if (!petroleum.length) {
        try {
          petroleum = await fetchFredPetroleumStocks();
        } catch (err) {
          errors.push({ lane: 'fred-petroleum', message: err.message });
        }
        if (!petroleum.length) {
          errors.push({
            lane: 'petroleum',
            message: 'EIA/FRED 周度石油库存暂无（网络或密钥待校验）',
          });
        }
      }
      return petroleum;
    })(),
    fetchCnBlackSectorProxies().catch((err) => {
      errors.push({ lane: 'cn-black', message: err.message });
      return [];
    }),
  ]);

  const petroleum = petroleumSettled.status === 'fulfilled' ? petroleumSettled.value : [];
  const black = blackSettled.status === 'fulfilled' ? blackSettled.value : [];

  const indicators = [...petroleum, ...black];
  const groups = [
    { id: 'petroleum', label: 'EIA周度石油库存', region: 'us', indicators: petroleum },
    { id: 'black', label: '中国黑色系基本面代理', region: 'cn', indicators: black },
  ].filter((g) => g.indicators.length);

  const payload = {
    version: FUNDAMENTALS_VERSION,
    key: 'fundamentals',
    name: '品种基本面',
    dataLabel: 'EIA周度石油库存 · 黑色产量/投资/物价代理',
    groups,
    indicators,
    commodities: buildCommodityMap(indicators),
    eiaConfigured: isEiaApiKeyConfigured(),
    errors: errors.length ? errors : undefined,
    pending: indicators.length === 0,
    updatedAt: new Date().toISOString(),
    dataSource: 'commodity-fundamentals-fetcher',
  };

  if (indicators.length) {
    diskCache.write(DISK_KEY, { data: payload });
  }
  return payload;
}

function getCachedFundamentalsSource() {
  const stored = diskCache.read(DISK_KEY, DISK_TTL_MS) || diskCache.readStale(DISK_KEY);
  return stored?.data || null;
}

function fundamentalsScoreForSymbol(symbol, fundamentalsPayload) {
  const sym = String(symbol || '').toLowerCase();
  const rows = fundamentalsPayload?.commodities?.[sym]?.indicators || [];
  if (!rows.length) return { score: 0, hits: [], dataSource: 'missing' };

  let score = 0;
  const hits = [];
  for (const row of rows) {
    const chg = row.changePct;
    if (chg == null || Number.isNaN(chg)) continue;
    let dir = 0;
    if (row.category === 'inventory') {
      dir = chg > 0.5 ? -0.12 : chg < -0.5 ? 0.12 : 0;
    } else if (row.category === 'production') {
      dir = chg > 0 ? 0.08 : chg < 0 ? -0.08 : 0;
    } else if (row.category === 'consumption') {
      dir = chg > 0 ? 0.06 : chg < 0 ? -0.06 : 0;
    }
    score += dir;
    hits.push({ name: row.name, changePct: chg, contribution: +dir.toFixed(3) });
  }

  return {
    score: Math.max(-0.35, Math.min(0.35, score)),
    hits,
    dataSource: 'commodity-fundamentals-fetcher',
  };
}

module.exports = {
  FUNDAMENTALS_VERSION,
  US_PETROLEUM_FRED,
  fetchFundamentalsSource,
  getCachedFundamentalsSource,
  fundamentalsScoreForSymbol,
  fetchCnBlackSectorProxies,
  fetchFredPetroleumStocks,
};
