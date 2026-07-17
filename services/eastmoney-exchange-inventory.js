/**
 * 东财期货库存（交易所交割库）— 有色免费代理序列
 * 注意：非 SMM/Mysteel 社会库存。标签必须含 eastmoney-exchange-inventory。
 */
const https = require('https');
const { saveSeries } = require('./sector-fundamentals-loader');

const EM_INV_VERSION = 'v1.56.21-em-exchange-inventory';

/** 交易品种 → 东财 SECURITY_CODE + 落盘 metric */
const EM_METAL_SPECS = [
  {
    instrumentIds: ['cu'],
    keyword: '沪铜',
    code: 'CU',
    sector: 'metals',
    metric: 'copper_exchange_inventory',
    label: '铜交易所库存(非社会)',
  },
  {
    instrumentIds: ['al'],
    keyword: '沪铝',
    code: 'AL',
    sector: 'metals',
    metric: 'aluminium_exchange_inventory',
    label: '铝交易所库存(非社会)',
  },
  {
    instrumentIds: ['zn'],
    keyword: '沪锌',
    code: 'ZN',
    sector: 'metals',
    metric: 'zinc_exchange_inventory',
    label: '锌交易所库存(非社会)',
  },
  {
    instrumentIds: ['ni'],
    keyword: '沪镍',
    code: 'NI',
    sector: 'metals',
    metric: 'nickel_exchange_inventory',
    label: '镍交易所库存(非社会)',
  },
  {
    instrumentIds: ['pb'],
    keyword: '沪铅',
    code: 'PB',
    sector: 'metals',
    metric: 'lead_exchange_inventory',
    label: '铅交易所库存(非社会)',
  },
  {
    instrumentIds: ['sn'],
    keyword: '沪锡',
    code: 'SN',
    sector: 'metals',
    metric: 'tin_exchange_inventory',
    label: '锡交易所库存(非社会)',
  },
  {
    instrumentIds: ['au'],
    keyword: '沪金',
    code: 'AU',
    sector: 'metals',
    metric: 'gold_exchange_inventory',
    label: '黄金交易所库存(非社会)',
  },
  {
    instrumentIds: ['ag'],
    keyword: '沪银',
    code: 'AG',
    sector: 'metals',
    metric: 'silver_exchange_inventory',
    label: '白银交易所库存(非社会)',
  },
];

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://data.eastmoney.com/',
          Accept: 'application/json',
        },
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(text) });
          } catch (err) {
            reject(new Error(`JSON parse fail HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function resolveFuturesSecurityCode(keyword = '沪铜') {
  const key = String(keyword || '').trim();
  const hard = EM_METAL_SPECS.find(
    (s) =>
      s.keyword === key ||
      s.code === key.toUpperCase() ||
      s.instrumentIds.includes(key.toLowerCase())
  );
  if (hard) return { code: hard.code, name: hard.keyword, spec: hard };

  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_FUTU_POSITIONCODE&columns=ALL&filter=(IS_MAINCODE%3D%221%22)&pageNumber=1&pageSize=500&source=WEB&client=WEB';
  const { json } = await getJson(url);
  const list = json?.result?.data || [];
  const hit =
    list.find((x) => String(x.TRADE_TYPE || '').includes(key)) ||
    list.find((x) => String(x.TRADE_CODE_UPPER || '').toUpperCase() === 'CU');
  return hit
    ? {
        code: String(hit.TRADE_CODE_UPPER || hit.TRADE_CODE || 'CU').toUpperCase(),
        name: hit.TRADE_TYPE || key,
      }
    : { code: 'CU', name: key };
}

async function fetchExchangeInventorySeries(securityCode, { startDate = '2019-01-01' } = {}) {
  const all = [];
  let page = 1;
  let pages = 1;
  while (page <= pages && page <= 20) {
    const filter = encodeURIComponent(`(SECURITY_CODE="${securityCode}")(TRADE_DATE>='${startDate}')`);
    const url =
      `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_FUTU_STOCKDATA` +
      `&columns=SECURITY_CODE,TRADE_DATE,ON_WARRANT_NUM,ADDCHANGE` +
      `&filter=${filter}&pageNumber=${page}&pageSize=500&sortColumns=TRADE_DATE&sortTypes=-1&source=WEB&client=WEB`;
    const { json } = await getJson(url);
    if (!json?.success) {
      throw new Error(json?.message || 'eastmoney stockdata failed');
    }
    pages = Number(json.result?.pages) || 1;
    const batch = json.result?.data || [];
    for (const r of batch) {
      all.push({
        date: String(r.TRADE_DATE || '').slice(0, 10),
        value: r.ON_WARRANT_NUM != null ? Number(r.ON_WARRANT_NUM) : null,
        change_wow: r.ADDCHANGE != null ? Number(r.ADDCHANGE) : null,
      });
    }
    if (!batch.length) break;
    page += 1;
  }
  return all
    .filter((r) => r.date && r.value != null && Number.isFinite(r.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function syncMetalExchangeInventory(spec, options = {}) {
  const code = spec.code;
  let rows = [];
  try {
    rows = await fetchExchangeInventorySeries(code, { startDate: options.startDate || '2019-01-01' });
  } catch (err) {
    return {
      version: EM_INV_VERSION,
      status: 'failed',
      error: err.message,
      code,
      metric: spec.metric,
    };
  }
  if (!rows.length) {
    return { version: EM_INV_VERSION, status: 'empty', code, metric: spec.metric, name: spec.keyword };
  }
  const saved = saveSeries(spec.sector, spec.metric, rows, {
    unit: '吨',
    source: 'eastmoney-exchange-inventory',
    note: `${spec.label}；东财交易所交割库；非社会库存`,
    securityCode: code,
    securityName: spec.keyword,
    version: EM_INV_VERSION,
  });
  return {
    version: EM_INV_VERSION,
    status: 'ok',
    code,
    name: spec.keyword,
    metric: spec.metric,
    label: spec.label,
    saved,
    latest: rows[rows.length - 1],
    dataSource: 'eastmoney-RPT_FUTU_STOCKDATA',
  };
}

/** 兼容旧入口：仅铜 */
async function syncCopperExchangeInventoryProxy(options = {}) {
  const copper = EM_METAL_SPECS.find((s) => s.code === 'CU');
  return syncMetalExchangeInventory(copper, options);
}

/** 同步全部有色交易所库存（免费） */
async function syncAllExchangeInventoryProxies(options = {}) {
  const metals = options.metals
    ? EM_METAL_SPECS.filter((s) => options.metals.includes(s.code) || options.metals.includes(s.metric))
    : EM_METAL_SPECS;
  const results = {};
  for (const spec of metals) {
    results[spec.code] = await syncMetalExchangeInventory(spec, options);
  }
  const failed = Object.values(results).filter((r) => r.status === 'failed').length;
  const ok = Object.values(results).filter((r) => r.status === 'ok').length;
  return {
    version: EM_INV_VERSION,
    status: failed && !ok ? 'failed' : failed ? 'partial' : 'ok',
    ok,
    failed,
    results,
  };
}

module.exports = {
  EM_INV_VERSION,
  EM_METAL_SPECS,
  resolveFuturesSecurityCode,
  fetchExchangeInventorySeries,
  syncMetalExchangeInventory,
  syncCopperExchangeInventoryProxy,
  syncAllExchangeInventoryProxies,
};
