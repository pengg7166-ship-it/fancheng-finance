/**
 * 大商所对外门户 API（dceapiv1.0）
 * - 登录 POST /dceapi/cms/auth/accessToken
 * - 公告 POST /dceapi/cms/info/articleByPage
 * - 交易日 GET /dceapi/forward/publicweb/maxTradeDate
 * - 仓单   POST /dceapi/forward/publicweb/dailystat/wbillWeeklyQuotes
 * - 持仓   POST /dceapi/forward/publicweb/dailystat/memberDealPosi
 * Token 落盘 + 分钟限流；失败不造假。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { readConfig } = require('./config');
const { getDataDir, getExternalRoot } = require('./data-paths');
const { enrichExchangeNoticeSymbols } = require('./exchange-symbol-match');
const { listUserFocusSymbols } = require('./user-focus-symbols');

const DCE_PORTAL_VERSION = 'v1.56.19-inventory-gaps-closed';

/** 关注池 ∩ 大商所品种 */
const DCE_FOCUS_VARIETIES = Object.freeze([
  'i', 'jm', 'm', 'y', 'p', 'eg', 'jd', 'lh',
  'a', 'b', 'c', 'cs', 'l', 'v', 'pp', 'j', 'eb', 'pg', 'rr', 'lg',
]);

const DEFAULT_NOTICE_COLUMNS = [
  { columnId: '244', label: '业务公告与通知' },
  { columnId: '1076', label: '今日提示' },
  { columnId: '245', label: '活动公告与通知' },
];

const PATHS = {
  auth: '/dceapi/cms/auth/accessToken',
  article: '/dceapi/cms/info/articleByPage',
  maxTradeDate: '/dceapi/forward/publicweb/maxTradeDate',
  warehouse: '/dceapi/forward/publicweb/dailystat/wbillWeeklyQuotes',
  memberPosi: '/dceapi/forward/publicweb/dailystat/memberDealPosi',
  dayQuotes: '/dceapi/forward/publicweb/dailystat/dayQuotes',
};

let memToken = null;
let memTokenExpiresAt = 0;
let callTimestamps = [];

function getDcePortalConfig() {
  const cfg = readConfig()?.dcePortalApi || {};
  const baseUrl = String(cfg.baseUrl || process.env.DCE_PORTAL_BASE_URL || 'http://www.dce.com.cn')
    .trim()
    .replace(/\/$/, '');
  const appKey = String(cfg.appKey || cfg.appId || process.env.DCE_PORTAL_APP_KEY || '').trim();
  const appSecret = String(cfg.appSecret || process.env.DCE_PORTAL_APP_SECRET || '').trim();
  const token = String(cfg.token || process.env.DCE_PORTAL_TOKEN || '').trim();
  const columns = Array.isArray(cfg.columnIds) && cfg.columnIds.length
    ? cfg.columnIds.map((id) => ({ columnId: String(id), label: String(id) }))
    : DEFAULT_NOTICE_COLUMNS;
  const varieties = Array.isArray(cfg.varieties) && cfg.varieties.length
    ? cfg.varieties.map((v) => String(v).toLowerCase())
    : (() => {
        const focusHit = DCE_FOCUS_VARIETIES.filter((id) => listUserFocusSymbols().includes(id));
        return focusHit.length ? focusHit : [...DCE_FOCUS_VARIETIES];
      })();
  return {
    enabled: cfg.enabled === true,
    baseUrl,
    appKey,
    appSecret,
    token,
    authPath: String(cfg.authPath || PATHS.auth).trim(),
    noticePath: String(cfg.noticePath || PATHS.article).trim(),
    siteId: Number(cfg.siteId) || 5,
    pageSize: Math.min(50, Math.max(5, Number(cfg.pageSize) || 15)),
    rateLimitPerMin: Math.max(5, Number(cfg.rateLimitPerMin) || 25),
    columns,
    varieties,
    fetchWarehouse: cfg.fetchWarehouse !== false,
    fetchMemberPosi: cfg.fetchMemberPosi !== false,
  };
}

function isDcePortalConfigured() {
  const c = getDcePortalConfig();
  return c.enabled && Boolean(c.baseUrl) && Boolean(c.token || (c.appKey && c.appSecret));
}

function tokenCachePath() {
  const root = getDataDir() || getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'cache');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  return path.join(dir, 'dce-portal-token.json');
}

function loadDiskToken() {
  const fp = tokenCachePath();
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!row?.token || !row?.expiresAt) return null;
    if (Date.now() >= Number(row.expiresAt) - 60_000) return null;
    return row;
  } catch {
    return null;
  }
}

function saveDiskToken(token, expiresInSec) {
  const fp = tokenCachePath();
  if (!fp) return;
  try {
    fs.writeFileSync(
      fp,
      JSON.stringify(
        {
          token,
          expiresAt: Date.now() + (Number(expiresInSec) || 3600) * 1000,
          savedAt: new Date().toISOString(),
          version: DCE_PORTAL_VERSION,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // ignore
  }
}

async function respectRateLimit(cfg) {
  const windowMs = 60_000;
  const limit = cfg.rateLimitPerMin || 25;
  const now = Date.now();
  callTimestamps = callTimestamps.filter((t) => now - t < windowMs);
  if (callTimestamps.length >= limit) {
    const wait = windowMs - (now - callTimestamps[0]) + 50;
    await new Promise((r) => setTimeout(r, wait));
    callTimestamps = callTimestamps.filter((t) => Date.now() - t < windowMs);
  }
  callTimestamps.push(Date.now());
}

function requestJson(url, { method = 'GET', headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        family: 4,
        timeout,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FanchengFinance/1.56 (DCE Portal API)',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, text, json });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${timeout}ms`));
    });
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function dceRequest(cfg, relPath, { method = 'GET', body = null, token = null, timeout = 20000 } = {}) {
  await respectRateLimit(cfg);
  const url = `${cfg.baseUrl}${relPath.startsWith('/') ? '' : '/'}${relPath}`;
  const headers = {};
  if (cfg.appKey) headers.apikey = cfg.appKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  return requestJson(url, { method, headers, body, timeout });
}

async function fetchAccessToken(cfg, { force = false } = {}) {
  if (!force && cfg.token) {
    return { token: cfg.token, tokenType: 'Bearer', expiresIn: null, source: 'config' };
  }
  if (!force && memToken && Date.now() < memTokenExpiresAt - 60_000) {
    return { token: memToken, tokenType: 'Bearer', expiresIn: null, source: 'memory' };
  }
  if (!force) {
    const disk = loadDiskToken();
    if (disk?.token) {
      memToken = disk.token;
      memTokenExpiresAt = Number(disk.expiresAt);
      return { token: disk.token, tokenType: 'Bearer', expiresIn: null, source: 'disk' };
    }
  }
  if (!cfg.appKey || !cfg.appSecret) {
    throw new Error('缺少 appKey/appSecret，无法登录大商所 API');
  }

  const res = await dceRequest(cfg, cfg.authPath || PATHS.auth, {
    method: 'POST',
    body: { secret: cfg.appSecret },
  });

  if (res.status === 412) throw new Error('HTTP 412（WAF）· 登录被拦截');
  if (!res.json?.success || res.json?.code !== 200 || !res.json?.data?.token) {
    const code = res.json?.code;
    const msg = res.json?.msg || res.text?.slice(0, 120) || `HTTP ${res.status}`;
    if (code === 402) {
      throw new Error(`无效的apikey或apisecret（402）· ${msg} · 请在门户「复制」后重写凭证`);
    }
    throw new Error(`登录失败: ${msg}`);
  }

  const token = res.json.data.token;
  const expiresIn = Number(res.json.data.expiresIn) || 3600;
  memToken = token;
  memTokenExpiresAt = Date.now() + expiresIn * 1000;
  saveDiskToken(token, expiresIn);
  return {
    token,
    tokenType: res.json.data.tokenType || 'Bearer',
    expiresIn,
    source: 'accessToken',
  };
}

async function authorizedCall(cfg, relPath, opts = {}) {
  let auth = await fetchAccessToken(cfg);
  let res = await dceRequest(cfg, relPath, { ...opts, token: auth.token });
  if (res.status === 402 || res.json?.code === 402) {
    auth = await fetchAccessToken(cfg, { force: true });
    res = await dceRequest(cfg, relPath, { ...opts, token: auth.token });
  }
  if (res.status === 501 || res.json?.code === 501) {
    await new Promise((r) => setTimeout(r, 2500));
    res = await dceRequest(cfg, relPath, { ...opts, token: auth.token });
  }
  return { res, auth };
}

function normalizeDceNoticeRow(row, index = 0, columnMeta = {}) {
  const title = String(row.title || '').trim();
  if (!title || title.length < 4) return null;
  const staticUrl = String(row.articleStaticUrl || '').trim();
  const dynamicUrl = String(row.articleDynamicUrl || '').trim();
  let link = staticUrl || dynamicUrl || '';
  if (link && !/^https?:\/\//i.test(link)) {
    link = new URL(link.replace(/^\//, ''), 'http://www.dce.com.cn/').href;
  }
  const pubDate = row.releaseDate || row.showDate || row.createDate || '';
  const summary = String(row.infoSummary || row.subTitle || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

  const item = enrichExchangeNoticeSymbols({
    title,
    summary,
    link: link || '',
    pubDate,
    sourceId: 'dce-portal-api',
    sourceName: '大商所·对外门户API',
    departmentId: 'exchange',
    region: 'cn',
    contentType: 'exchange-rule',
    exchangeMirror: false,
    exchangeLabel: '大商所',
    columnId: columnMeta.columnId || null,
    columnLabel: columnMeta.label || row.pageName || null,
    dataSource: 'dce-portal-api',
    method: 'dceapi-cms-articleByPage',
  });
  item.id = String(row.id || `dce-api-${columnMeta.columnId || 'x'}-${index}`);
  return item;
}

async function fetchArticleColumn(cfg, column) {
  const { res } = await authorizedCall(cfg, cfg.noticePath || PATHS.article, {
    method: 'POST',
    body: {
      columnId: String(column.columnId),
      pageNo: 1,
      siteId: cfg.siteId,
      pageSize: cfg.pageSize,
    },
  });
  if (res.status === 412) throw new Error(`HTTP 412 · column ${column.columnId}`);
  if (!res.json?.success || res.json?.code !== 200) {
    throw new Error(res.json?.msg || `HTTP ${res.status}`);
  }
  const list = Array.isArray(res.json?.data?.resultList) ? res.json.data.resultList : [];
  return {
    columnId: column.columnId,
    label: column.label,
    totalCount: res.json?.data?.totalCount ?? list.length,
    items: list.map((row, i) => normalizeDceNoticeRow(row, i, column)).filter(Boolean),
  };
}

function fromYyyymmdd(yyyymmdd) {
  const s = String(yyyymmdd || '').replace(/\D/g, '');
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function toYyyymmdd(dateStr) {
  return String(dateStr || '')
    .slice(0, 10)
    .replace(/-/g, '');
}

function priorYyyymmdd(yyyymmdd, daysBack = 1) {
  const iso = fromYyyymmdd(yyyymmdd);
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return toYyyymmdd(d.toISOString().slice(0, 10));
}

function summarizeWbillEntityList(entityList) {
  const list = Array.isArray(entityList) ? entityList : [];
  let totalQty = 0;
  let totalDiff = 0;
  let warehouses = 0;
  for (const row of list) {
    if (row == null) continue;
    if (row.wbillQty != null && Number.isFinite(Number(row.wbillQty))) {
      totalQty += Number(row.wbillQty);
      warehouses += 1;
    }
    if (row.diff != null && Number.isFinite(Number(row.diff))) {
      totalDiff += Number(row.diff);
    }
  }
  return { entityList: list, totalQty, totalDiff, warehouseCount: warehouses };
}

async function fetchMaxTradeDate(cfg) {
  const { res } = await authorizedCall(cfg, PATHS.maxTradeDate, { method: 'GET' });
  if (!res.json?.success || res.json?.code !== 200) {
    throw new Error(res.json?.msg || `maxTradeDate HTTP ${res.status}`);
  }
  return String(res.json?.data?.tradeDate || '').trim() || null;
}

async function fetchWarehouseQuotes(cfg, varietyId, tradeDate) {
  const { res } = await authorizedCall(cfg, PATHS.warehouse, {
    method: 'POST',
    body: { varietyId: String(varietyId), tradeDate: String(tradeDate) },
  });
  if (!res.json?.success || res.json?.code !== 200) {
    return {
      varietyId,
      tradeDate,
      error: res.json?.msg || `HTTP ${res.status}`,
      entityList: [],
      totalQty: null,
      totalDiff: null,
      warehouseCount: 0,
      rows: [],
    };
  }
  const data = res.json.data || {};
  const entityList = Array.isArray(data.entityList)
    ? data.entityList
    : Array.isArray(data)
      ? data
      : Array.isArray(data?.list)
        ? data.list
        : [];
  const sum = summarizeWbillEntityList(entityList);
  return {
    varietyId,
    tradeDate,
    entityList: sum.entityList,
    totalQty: sum.warehouseCount ? sum.totalQty : null,
    totalDiff: sum.warehouseCount ? sum.totalDiff : null,
    warehouseCount: sum.warehouseCount,
    ifAgioFlag: data.ifAgioFlag ?? null,
    rows: sum.entityList,
    dataSource: 'dce-portal-api',
    method: 'dceapi-wbillWeeklyQuotes',
  };
}

/**
 * 仓单日报常滞后于 maxTradeDate；空 entityList 时向前回退，绝不填假值。
 */
async function fetchWarehouseQuotesWithFallback(cfg, varietyId, startTradeDate, { maxLookback = 10 } = {}) {
  let tradeDate = String(startTradeDate || '');
  const tried = [];
  for (let i = 0; i < maxLookback && tradeDate; i += 1) {
    const row = await fetchWarehouseQuotes(cfg, varietyId, tradeDate);
    tried.push(tradeDate);
    if (row.error) return { ...row, triedDates: tried };
    if (row.warehouseCount > 0 && row.totalQty != null) {
      return { ...row, resolvedTradeDate: tradeDate, triedDates: tried };
    }
    tradeDate = priorYyyymmdd(tradeDate, 1);
    if (i < maxLookback - 1) await new Promise((r) => setTimeout(r, 250));
  }
  return {
    varietyId,
    tradeDate: startTradeDate,
    entityList: [],
    totalQty: null,
    totalDiff: null,
    warehouseCount: 0,
    rows: [],
    empty: true,
    triedDates: tried,
    dataSource: 'dce-portal-api',
    method: 'dceapi-wbillWeeklyQuotes',
  };
}

async function fetchDayQuotes(cfg, varietyId, tradeDate) {
  const { res } = await authorizedCall(cfg, PATHS.dayQuotes, {
    method: 'POST',
    body: {
      varietyId: String(varietyId),
      tradeDate: String(tradeDate),
      tradeType: '1',
      lang: 'zh',
    },
  });
  if (!res.json?.success || res.json?.code !== 200) {
    return { varietyId, tradeDate, error: res.json?.msg || `HTTP ${res.status}`, rows: [] };
  }
  const data = res.json.data;
  const rows = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : [];
  return {
    varietyId,
    tradeDate,
    rows,
    dataSource: 'dce-portal-api',
    method: 'dceapi-dayQuotes',
  };
}

function pickDominantContract(dayRows, varietyId) {
  const id = String(varietyId || '').toLowerCase();
  const ranked = (dayRows || [])
    .filter((r) => r && r.contractId)
    .map((r) => ({
      contractId: String(r.contractId),
      openInterest: Number(r.openInterest) || 0,
      volume: Number(r.volumn ?? r.volume ?? 0) || 0,
    }))
    .filter((r) => !id || r.contractId.toLowerCase().startsWith(id))
    .sort((a, b) => b.openInterest - a.openInterest || b.volume - a.volume);
  return ranked[0] || null;
}

async function resolveDominantContract(cfg, varietyId, tradeDate) {
  const quotes = await fetchDayQuotes(cfg, varietyId, tradeDate);
  if (quotes.error) return { contractId: null, error: quotes.error, openInterest: null };
  let dominant = pickDominantContract(quotes.rows, varietyId);
  if (!dominant?.contractId) {
    // 当日未公布时回退上一交易日日行情
    const prev = priorYyyymmdd(tradeDate, 1);
    if (prev) {
      const prevQuotes = await fetchDayQuotes(cfg, varietyId, prev);
      dominant = pickDominantContract(prevQuotes.rows, varietyId);
    }
  }
  return {
    contractId: dominant?.contractId || null,
    openInterest: dominant?.openInterest ?? null,
    volume: dominant?.volume ?? null,
    dataSource: 'dce-portal-api',
    method: 'dceapi-dayQuotes-maxOI',
  };
}

async function fetchMemberDealPosi(cfg, varietyId, tradeDate, contractId) {
  if (!contractId || contractId === 'all') {
    return {
      varietyId,
      tradeDate,
      contractId: contractId || null,
      error: 'contractId_required',
      data: null,
    };
  }
  const { res } = await authorizedCall(cfg, PATHS.memberPosi, {
    method: 'POST',
    body: {
      varietyId: String(varietyId),
      tradeDate: String(tradeDate),
      contractId: String(contractId),
      tradeType: '1',
    },
  });
  if (!res.json?.success || res.json?.code !== 200) {
    return { varietyId, tradeDate, contractId, error: res.json?.msg || `HTTP ${res.status}`, data: null };
  }
  const data = res.json.data || null;
  const hasSignal =
    data &&
    (Number(data.todayBuyQty) > 0 ||
      Number(data.todaySellQty) > 0 ||
      (Array.isArray(data.buyFutureList) && data.buyFutureList.length > 0));
  return {
    varietyId,
    tradeDate,
    contractId,
    data,
    empty: !hasSignal,
    todayBuyQty: data?.todayBuyQty != null ? Number(data.todayBuyQty) : null,
    todaySellQty: data?.todaySellQty != null ? Number(data.todaySellQty) : null,
    buySub: data?.buySub != null ? Number(data.buySub) : null,
    sellSub: data?.sellSub != null ? Number(data.sellSub) : null,
    todayQty: data?.todayQty != null ? Number(data.todayQty) : null,
    dataSource: 'dce-portal-api',
    method: 'dceapi-memberDealPosi',
  };
}

function persistMarketBundle(bundle) {
  const root = getDataDir() || getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'cache');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'dce-portal-market.json');
    fs.writeFileSync(fp, JSON.stringify(bundle, null, 2), 'utf8');
    return fp;
  } catch {
    return null;
  }
}

function memberPosiDir() {
  const root = getDataDir() || getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'cache', 'dce-member-posi');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  return dir;
}

function persistMemberPosiRow(row) {
  const dir = memberPosiDir();
  if (!dir || !row?.varietyId || !row?.tradeDate) return null;
  const fp = path.join(dir, `${String(row.varietyId).toLowerCase()}-${row.tradeDate}.json`);
  try {
    fs.writeFileSync(
      fp,
      JSON.stringify(
        {
          ...row,
          persistedAt: new Date().toISOString(),
          version: DCE_PORTAL_VERSION,
        },
        null,
        2
      ),
      'utf8'
    );
    return fp;
  } catch {
    return null;
  }
}

function loadLatestMemberPosi(varietyId) {
  const dir = memberPosiDir();
  if (!dir) return null;
  const id = String(varietyId || '').toLowerCase();
  let best = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(`${id}-`) || !name.endsWith('.json')) continue;
      const fp = path.join(dir, name);
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!raw?.tradeDate) continue;
      if (!best || String(raw.tradeDate) > String(best.tradeDate)) best = raw;
    }
  } catch {
    return null;
  }
  return best;
}

function persistWarehouseToHistory(warehouseItems) {
  let whMod;
  try {
    whMod = require('./shfe-warehouse-fetcher');
  } catch {
    return { status: 'failed', reason: 'shfe-warehouse-fetcher_missing', results: [] };
  }
  const results = [];
  for (const item of warehouseItems || []) {
    const varietyId = String(item.varietyId || '').toLowerCase();
    const tradeDate = item.resolvedTradeDate || item.tradeDate;
    const dateIso = fromYyyymmdd(tradeDate);
    if (!varietyId || !dateIso) {
      results.push({ varietyId, status: 'skipped', reason: 'missing_id_or_date' });
      continue;
    }
    if (item.empty || item.totalQty == null || !(item.warehouseCount > 0)) {
      results.push({
        varietyId,
        status: 'empty',
        tradeDate,
        triedDates: item.triedDates || undefined,
      });
      continue;
    }
    const incoming = [
      {
        date: dateIso,
        instrument_id: varietyId,
        warehouse_receipt: Number(item.totalQty),
        change_dod: item.totalDiff != null ? Number(item.totalDiff) : null,
        exchange: 'DCE',
        unit: '手',
        source: 'dce-portal-api',
      },
    ];
    const existing = whMod.loadExistingRows(varietyId);
    const merged = whMod.mergeWarehouseRows(existing.rows, incoming);
    const fp = whMod.saveWarehouseFile(varietyId, merged.rows, {
      exchange: 'DCE',
      source: 'dce-portal-api',
      label: `${varietyId.toUpperCase()} 注册仓单 (DCE)`,
      schema: {
        date: 'YYYY-MM-DD',
        warehouse_receipt: '注册仓单量合计（手 · wbillQty sum）',
        change_dod: '增减合计（手 · diff sum）',
        exchange: 'DCE',
      },
    });
    results.push({
      varietyId,
      status: 'ok',
      date: dateIso,
      totalQty: item.totalQty,
      totalDiff: item.totalDiff,
      added: merged.added,
      replaced: merged.replaced,
      rowCount: merged.rowCount,
      file: fp,
    });
  }
  return { status: 'ok', results };
}

/**
 * 回填近 N 个交易日仓单（跳过周末/假日与空日），供 chg5d / 连续序列。
 * 优先 varietyId=all 单日批量，再拆分落盘；deep=true 默认 ~90 交易日。
 */
async function backfillDceWarehouseHistory(options = {}) {
  const cfg = getDcePortalConfig();
  if (!isDcePortalConfigured()) {
    return { version: DCE_PORTAL_VERSION, configured: false, reason: 'awaiting_credentials' };
  }
  await fetchAccessToken(cfg);
  let endDate = options.tradeDate || null;
  try {
    endDate = endDate || (await fetchMaxTradeDate(cfg));
  } catch (err) {
    return { version: DCE_PORTAL_VERSION, configured: true, error: err.message };
  }
  const deep = options.deep === true || options.force === true;
  const defaultLookback = deep ? 160 : 20;
  const lookbackDays = Math.min(200, Math.max(1, Number(options.lookbackDays) || defaultLookback));
  const defaultTarget = deep ? 90 : 12;
  const target = Math.min(lookbackDays, Math.max(1, Number(options.targetDays) || defaultTarget));
  const varieties = options.varieties || cfg.varieties || [...DCE_FOCUS_VARIETIES];
  const varietySet = new Set(varieties.map((v) => String(v).toLowerCase()));
  let isHoliday = () => false;
  try {
    isHoliday = require('./cn-trading-calendar').isCnHolidayDate;
  } catch {
    // optional
  }

  const warehouse = [];
  const errors = [];
  let filled = 0;
  let cursor = endDate;
  for (let step = 0; step < lookbackDays && filled < target; step += 1) {
    const iso = fromYyyymmdd(cursor);
    if (iso && isHoliday(iso)) {
      cursor = priorYyyymmdd(cursor, 1);
      continue;
    }
    try {
      const row = await fetchWarehouseQuotes(cfg, 'all', cursor);
      if (row.error) {
        errors.push({ lane: 'warehouse-backfill', tradeDate: cursor, message: row.error });
      } else {
        const bySym = {};
        for (const e of row.entityList || []) {
          const id = String(e.varietyOrder || '').toLowerCase();
          if (!id || !varietySet.has(id)) continue;
          if (!bySym[id]) bySym[id] = { qty: 0, diff: 0, n: 0, entities: [] };
          if (e.wbillQty != null && Number.isFinite(Number(e.wbillQty))) {
            bySym[id].qty += Number(e.wbillQty);
            bySym[id].n += 1;
          }
          if (e.diff != null && Number.isFinite(Number(e.diff))) {
            bySym[id].diff += Number(e.diff);
          }
          bySym[id].entities.push(e);
        }
        let dayHit = false;
        for (const [id, slot] of Object.entries(bySym)) {
          if (!slot.n) continue;
          warehouse.push({
            varietyId: id,
            tradeDate: cursor,
            resolvedTradeDate: cursor,
            entityList: slot.entities,
            totalQty: slot.qty,
            totalDiff: slot.diff,
            warehouseCount: slot.n,
            dataSource: 'dce-portal-api',
            method: 'dceapi-wbillWeeklyQuotes-all',
          });
          dayHit = true;
        }
        if (dayHit) filled += 1;
      }
    } catch (err) {
      errors.push({ lane: 'warehouse-backfill', tradeDate: cursor, message: err.message });
    }
    cursor = priorYyyymmdd(cursor, 1);
    await new Promise((r) => setTimeout(r, 320));
  }

  const persist = persistWarehouseToHistory(warehouse);
  return {
    version: DCE_PORTAL_VERSION,
    configured: true,
    endDate,
    lookbackDays,
    target,
    deep,
    mode: 'varietyId=all',
    daysFilled: filled,
    warehouseFetched: warehouse.length,
    persist,
    errors: errors.length ? errors : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchDcePortalMarketBundle(options = {}) {
  const cfg = getDcePortalConfig();
  if (!isDcePortalConfigured()) {
    return { version: DCE_PORTAL_VERSION, configured: false, reason: 'awaiting_credentials' };
  }
  const auth = await fetchAccessToken(cfg);
  let tradeDate = options.tradeDate || null;
  const errors = [];
  try {
    tradeDate = tradeDate || (await fetchMaxTradeDate(cfg));
  } catch (err) {
    errors.push({ lane: 'maxTradeDate', message: err.message });
  }

  const warehouse = [];
  const memberPosi = [];
  const varieties = options.varieties || cfg.varieties || [];
  const doWarehouse = options.fetchWarehouse !== undefined ? options.fetchWarehouse !== false : cfg.fetchWarehouse !== false;
  const doMember = options.fetchMemberPosi !== undefined ? options.fetchMemberPosi !== false : cfg.fetchMemberPosi !== false;
  if (tradeDate && doWarehouse) {
    for (const v of varieties) {
      try {
        warehouse.push(await fetchWarehouseQuotesWithFallback(cfg, v, tradeDate));
        await new Promise((r) => setTimeout(r, 350));
      } catch (err) {
        errors.push({ lane: 'warehouse', varietyId: v, message: err.message });
      }
    }
  }
  if (tradeDate && doMember) {
    for (const v of varieties) {
      try {
        const dom = await resolveDominantContract(cfg, v, tradeDate);
        if (!dom.contractId) {
          memberPosi.push({
            varietyId: v,
            tradeDate,
            contractId: null,
            empty: true,
            error: dom.error || 'no_dominant_contract',
            dataSource: 'dce-portal-api',
            method: 'dceapi-dayQuotes-maxOI',
          });
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        let posiTradeDate = tradeDate;
        let posi = await fetchMemberDealPosi(cfg, v, posiTradeDate, dom.contractId);
        if (posi.empty || posi.error) {
          const prev = priorYyyymmdd(tradeDate, 1);
          if (prev) {
            posiTradeDate = prev;
            const domPrev = await resolveDominantContract(cfg, v, prev);
            if (domPrev.contractId) {
              posi = await fetchMemberDealPosi(cfg, v, prev, domPrev.contractId);
              posi.dominantOpenInterest = domPrev.openInterest;
            }
          }
        } else {
          posi.dominantOpenInterest = dom.openInterest;
        }
        const cachePath = persistMemberPosiRow(posi);
        if (cachePath) posi.cachePath = cachePath;
        memberPosi.push(posi);
        await new Promise((r) => setTimeout(r, 350));
      } catch (err) {
        errors.push({ lane: 'memberPosi', varietyId: v, message: err.message });
      }
    }
  }

  const historyPersist = persistWarehouseToHistory(warehouse);
  const bundle = {
    version: DCE_PORTAL_VERSION,
    configured: true,
    authSource: auth.source,
    tradeDate,
    warehouse,
    memberPosi,
    historyPersist,
    errors: errors.length ? errors : undefined,
    fetchedAt: new Date().toISOString(),
    dataSource: 'dce-portal-api',
  };
  bundle.cachePath = persistMarketBundle(bundle);
  return bundle;
}

async function fetchDcePortalNotices() {
  const cfg = getDcePortalConfig();
  if (!isDcePortalConfigured()) {
    return {
      version: DCE_PORTAL_VERSION,
      items: [],
      configured: false,
      reason: 'awaiting_credentials',
    };
  }

  try {
    const auth = await fetchAccessToken(cfg);
    const columns = [];
    const errors = [];
    for (const col of cfg.columns) {
      try {
        if (columns.length) await new Promise((r) => setTimeout(r, 600));
        columns.push(await fetchArticleColumn(cfg, col));
      } catch (err) {
        errors.push({ columnId: col.columnId, message: err.message || String(err) });
      }
    }

    const seen = new Set();
    const items = [];
    for (const col of columns) {
      for (const it of col.items || []) {
        const key = it.id || `${it.title}|${it.pubDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(it);
      }
    }

    let market = null;
    if (cfg.fetchWarehouse !== false || cfg.fetchMemberPosi !== false) {
      try {
        market = await fetchDcePortalMarketBundle();
      } catch (err) {
        errors.push({ lane: 'market', message: err.message || String(err) });
      }
    }

    return {
      version: DCE_PORTAL_VERSION,
      items,
      configured: true,
      fetchedAt: new Date().toISOString(),
      authSource: auth.source,
      columns: columns.map((c) => ({
        columnId: c.columnId,
        label: c.label,
        totalCount: c.totalCount,
        count: c.items.length,
      })),
      market: market
        ? {
            tradeDate: market.tradeDate,
            warehouseCount: (market.warehouse || []).filter((w) => w.warehouseCount > 0 && !w.error).length,
            warehouseEmpty: (market.warehouse || []).filter((w) => w.empty || !(w.warehouseCount > 0)).length,
            memberPosiCount: (market.memberPosi || []).filter((m) => !m.error && !m.empty).length,
            historyPersist: market.historyPersist || null,
            cachePath: market.cachePath || null,
          }
        : null,
      errors: errors.length ? errors : undefined,
      endpoint: `${cfg.baseUrl}${cfg.noticePath}`,
    };
  } catch (err) {
    return {
      version: DCE_PORTAL_VERSION,
      items: [],
      configured: true,
      error: err.message || String(err),
      endpoint: `${cfg.baseUrl}${cfg.noticePath}`,
    };
  }
}

module.exports = {
  DCE_PORTAL_VERSION,
  DCE_FOCUS_VARIETIES,
  DEFAULT_NOTICE_COLUMNS,
  PATHS,
  getDcePortalConfig,
  isDcePortalConfigured,
  fetchAccessToken,
  fetchDcePortalNotices,
  fetchDcePortalMarketBundle,
  backfillDceWarehouseHistory,
  fetchMaxTradeDate,
  fetchWarehouseQuotes,
  fetchWarehouseQuotesWithFallback,
  fetchDayQuotes,
  resolveDominantContract,
  fetchMemberDealPosi,
  persistWarehouseToHistory,
  persistMemberPosiRow,
  loadLatestMemberPosi,
  normalizeDceNoticeRow,
  fromYyyymmdd,
  toYyyymmdd,
};
