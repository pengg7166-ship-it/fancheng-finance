const INDICES = [
  {
    region: '美洲',
    items: [
      { id: 'sp500', name: '标普 500', market: '美国', sina: 'int_sp500', parser: 'int' },
      { id: 'dji', name: '道琼斯工业', market: '美国', sina: 'gb_dji', parser: 'gb' },
      { id: 'ixic', name: '纳斯达克综合', market: '美国', sina: 'gb_ixic', parser: 'gb' },
      { id: 'rut', name: '罗素 2000', market: '美国', stooq: '^rut' },
      { id: 'tsx', name: '多伦多综合', market: '加拿大', stooq: '^tsx' },
      { id: 'bvsp', name: '圣保罗综合', market: '巴西', stooq: '^bvsp' },
      { id: 'mxx', name: '墨西哥综合', market: '墨西哥', stooq: '^mxx' },
    ],
  },
  {
    region: '欧洲',
    items: [
      { id: 'ftse', name: '富时 100', market: '英国', sina: 'int_ftse', parser: 'int', stooq: '^ftse' },
      { id: 'dax', name: '德国法兰克福', market: '德国', stooq: '^dax' },
      { id: 'cac', name: '法国巴黎', market: '法国', stooq: '^cac' },
      { id: 'stoxx50', name: '欧洲斯托克 50', market: '欧洲', stooq: '^stoxx50e' },
      { id: 'ssmi', name: '瑞士市场', market: '瑞士', stooq: '^ssmi' },
      { id: 'ibex', name: '西班牙马德里', market: '西班牙', stooq: '^ibex' },
      { id: 'aex', name: '荷兰阿姆斯特丹', market: '荷兰', stooq: '^aex' },
    ],
  },
  {
    region: '亚太',
    items: [
      { id: 'n225', name: '日经 225', market: '日本', sina: 'int_nikkei', parser: 'int' },
      { id: 'hsi', name: '恒生指数', market: '中国香港', sina: 'int_hangseng', parser: 'int' },
      { id: 'sse', name: '上证指数', market: '中国', sina: 's_sh000001', parser: 's' },
      { id: 'szse', name: '深证成指', market: '中国', sina: 's_sz399001', parser: 's' },
      { id: 'chinext', name: '创业板指', market: '中国', sina: 's_sz399006', parser: 's' },
      { id: 'kospi', name: '韩国综合', market: '韩国', stooq: '^kospi' },
      { id: 'twii', name: '台湾加权', market: '中国台湾', stooq: '^twii' },
      { id: 'nifty', name: '印度 Nifty50', market: '印度', stooq: '^nsei' },
      { id: 'sensex', name: '印度孟买', market: '印度', stooq: '^bsesn' },
      { id: 'axjo', name: '澳洲综合', market: '澳大利亚', stooq: '^axjo' },
      { id: 'sti', name: '新加坡海峡时报', market: '新加坡', stooq: '^sti' },
    ],
  },
  {
    region: '中东与非洲',
    items: [
      { id: 'tasi', name: '沙特全股', market: '沙特阿拉伯', stooq: '^tasi' },
      { id: 'jse', name: '南非全股', market: '南非', stooq: '^j203' },
    ],
  },
];

const { fetchText } = require('./http-client');

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

function parseSinaInt(parts) {
  if (parts.length < 4) return null;
  const price = parseFloat(parts[1]);
  const change = parseFloat(parts[2]);
  const changePct = parseFloat(parts[3]);
  if (Number.isNaN(price)) return null;
  return { price, change, changePct };
}

function parseSinaGb(parts) {
  if (parts.length < 5) return null;
  const price = parseFloat(parts[1]);
  const changePct = parseFloat(parts[2]);
  const change = parseFloat(parts[4]);
  if (Number.isNaN(price)) return null;
  return { price, change, changePct };
}

function parseSinaS(parts) {
  if (parts.length < 4) return null;
  const price = parseFloat(parts[1]);
  const change = parseFloat(parts[2]);
  const changePct = parseFloat(parts[3]);
  if (Number.isNaN(price)) return null;
  return { price, change, changePct };
}

function parseSinaLine(code, parser, raw) {
  if (!raw) return null;
  const parts = raw.split(',');
  switch (parser) {
    case 'int':
      return parseSinaInt(parts);
    case 'gb':
      return parseSinaGb(parts);
    case 's':
      return parseSinaS(parts);
    default:
      return null;
  }
}

async function fetchSinaBatch(items) {
  const codes = items.map((i) => i.sina).filter(Boolean);
  if (!codes.length) return {};

  const url = `https://hq.sinajs.cn/list=${codes.join(',')}`;
  const text = await fetchText(url, { headers: SINA_HEADERS, timeout: 10000 });
  const map = {};
  for (const segment of text.split(';')) {
    const m = segment.match(/hq_str_(\w+)="([^"]*)"/);
    if (m && m[2]) map[m[1]] = m[2];
  }
  return map;
}

async function fetchStooqQuote(symbol) {
  const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`;
  const text = await fetchText(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 5000,
    retries: 1,
  });
  const line = text.trim().split('\n')[1];
  if (!line) throw new Error('无行情数据');

  const parts = line.split(',');
  const open = parseFloat(parts[3]);
  const close = parseFloat(parts[6]);
  const dateStr = parts[1];

  if (Number.isNaN(close)) throw new Error('解析失败');

  const change = Number.isNaN(open) ? 0 : close - open;
  const changePct = open ? (change / open) * 100 : 0;

  return {
    price: close,
    change,
    changePct,
    updatedAt: dateStr ? `${dateStr}T00:00:00.000Z` : new Date().toISOString(),
    changeNote: '较开盘',
  };
}

async function fetchOneIndex(item, sinaMap) {
  try {
    if (item.sina) {
      const raw = sinaMap[item.sina.replace(/^s_|^gb_|^int_/, (m) => m)] || sinaMap[item.sina];
      // sina keys in response: hq_str_int_sp500 -> key int_sp500, gb_dji, s_sh000001
      const key = item.sina;
      const data = parseSinaLine(key, item.parser, sinaMap[key]);
      if (!data) throw new Error('暂无数据');
      return { ...item, ...data, status: 'ok', source: 'sina' };
    }

    if (item.stooq) {
      const data = await Promise.race([
        fetchStooqQuote(item.stooq),
        new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), 3500)),
      ]);
      return { ...item, ...data, status: 'ok', source: 'stooq' };
    }

    throw new Error('未配置数据源');
  } catch (err) {
    return { ...item, status: 'error', error: err.message || '获取失败' };
  }
}

async function fetchGlobalIndicesSinaOnly() {
  const flat = INDICES.flatMap((group) =>
    group.items.map((item) => ({ ...item, region: group.region }))
  );

  const sinaItems = flat.filter((i) => i.sina);
  let sinaMap = {};
  try {
    sinaMap = await fetchSinaBatch(sinaItems);
  } catch {
    sinaMap = {};
  }

  const sinaResults = sinaItems.map((item) => {
    const data = parseSinaLine(item.sina, item.parser, sinaMap[item.sina]);
    if (!data) return { ...item, status: 'error', error: '暂无数据' };
    return { ...item, ...data, status: 'ok', source: 'sina' };
  });

  const allResults = flat.map((item) => {
    if (item.sina) return sinaResults.find((r) => r.id === item.id) || { ...item, status: 'error' };
    return { ...item, status: 'skip' };
  });

  return packIndexResults(allResults, flat);
}

function packIndexResults(allResults, flat) {
  const byRegion = INDICES.map((group) => ({
    name: group.region,
    indices: allResults
      .filter((item) => item.region === group.region && item.status === 'ok')
      .map(({ region, status, error, sina, stooq, parser, source, ...rest }) => rest),
  }));

  const success = allResults.filter((r) => r.status === 'ok').length;
  const failed = allResults.filter((r) => r.status === 'error').length;

  return {
    regions: byRegion,
    total: flat.length,
    success,
    failed,
  };
}

async function fetchGlobalIndices() {
  const flat = INDICES.flatMap((group) =>
    group.items.map((item) => ({ ...item, region: group.region }))
  );

  const sinaPack = await fetchGlobalIndicesSinaOnly();
  const sinaOkIds = new Set(
    sinaPack.regions.flatMap((r) => r.indices.map((i) => i.id))
  );

  const stooqItems = flat.filter((i) => i.stooq && !sinaOkIds.has(i.id));
  if (!stooqItems.length) return sinaPack;

  const stooqResults = await fetchWithConcurrency(
    stooqItems.map((item) => async () => fetchOneIndex(item, {})),
    4
  );

  const merged = flat.map((item) => {
    const sinaRow = sinaPack.regions
      .flatMap((r) => r.indices)
      .find((i) => i.id === item.id);
    if (sinaRow) return { ...item, ...sinaRow, status: 'ok' };
    const stooqRow = stooqResults.find((r) => r.id === item.id);
    if (stooqRow?.status === 'ok') return stooqRow;
    return { ...item, status: 'error', error: '暂无数据' };
  });

  return packIndexResults(merged, flat);
}

async function fetchWithConcurrency(tasks, limit = 3) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

module.exports = { fetchGlobalIndices, fetchGlobalIndicesSinaOnly, INDICES };
