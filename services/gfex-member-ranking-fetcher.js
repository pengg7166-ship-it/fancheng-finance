/**
 * 广期所会员成交持仓排名 — 官方 JSON
 * POST /u/interfacesWebTiMemberDealPosiQuotes/loadListContract_id
 * POST /u/interfacesWebTiMemberDealPosiQuotes/loadList  (data_type 1成交/2买持仓/3卖持仓)
 * http://www.gfex.com.cn/gfex/rcjccpm/hqsj_tjsj.shtml
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { getDataDir, getExternalRoot } = require('./data-paths');

const GFEX_MEMBER_VERSION = 'v1.56.21-gfex-member-rank';
const DEFAULT_FOCUS = Object.freeze(['si', 'lc', 'ps', 'pt', 'pd']);

function toYyyymmdd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function priorYyyymmdd(yyyymmdd, daysBack = 1) {
  const s = String(yyyymmdd || '').replace(/\D/g, '');
  if (s.length !== 8) return null;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  d.setDate(d.getDate() - daysBack);
  return toYyyymmdd(d);
}

function memberPosiDir() {
  const root = getDataDir() || getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'cache', 'gfex-member-posi');
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
      JSON.stringify({ ...row, persistedAt: new Date().toISOString(), version: GFEX_MEMBER_VERSION }, null, 2),
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
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!raw?.tradeDate) continue;
      if (!best || String(raw.tradeDate) > String(best.tradeDate)) best = raw;
    }
  } catch {
    return null;
  }
  return best;
}

function postForm(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const req = http.request(
      {
        hostname: 'www.gfex.com.cn',
        path: apiPath,
        method: 'POST',
        family: 4,
        timeout: 25000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'FanchengFinance/1.56 (GFEX member ranking)',
          Accept: 'application/json',
          Referer: 'http://www.gfex.com.cn/gfex/rcjccpm/hqsj_tjsj.shtml',
          Origin: 'http://www.gfex.com.cn',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, text, json });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function isMemberRow(row) {
  if (!row) return false;
  const cid = String(row.contractId || '');
  if (cid === '总计' || /total/i.test(cid)) return false;
  const abbr = String(row.abbr || '').trim();
  return Boolean(abbr) && Number(row.todayQty) > 0;
}

function normalizeSideRows(rows, side) {
  const list = [];
  for (const r of rows || []) {
    if (!isMemberRow(r)) continue;
    const qty = Number(r.todayQty);
    const sub = Number(r.qtySub);
    if (side === 'buy') {
      list.push({
        rank: String(r.contractId || list.length + 1),
        buyAbbr: String(r.abbr).trim(),
        todayBuyQty: qty,
        buySub: Number.isFinite(sub) ? sub : null,
      });
    } else {
      list.push({
        rank: String(r.contractId || list.length + 1),
        sellAbbr: String(r.abbr).trim(),
        todaySellQty: qty,
        sellSub: Number.isFinite(sub) ? sub : null,
      });
    }
  }
  return list;
}

function extractTotal(rows) {
  const tot = (rows || []).find((r) => String(r.contractId || '') === '总计');
  if (!tot) return { qty: null, sub: null };
  return {
    qty: Number.isFinite(Number(tot.todayQty)) ? Number(tot.todayQty) : null,
    sub: Number.isFinite(Number(tot.qtySub)) ? Number(tot.qtySub) : null,
  };
}

async function fetchContractIds(varietyId, tradeDate) {
  const res = await postForm('/u/interfacesWebTiMemberDealPosiQuotes/loadListContract_id', {
    variety: String(varietyId).toLowerCase(),
    trade_date: String(tradeDate),
  });
  if (res.status !== 200 || String(res.json?.code) !== '0') {
    return { contracts: [], error: res.json?.msg || `HTTP ${res.status}` };
  }
  const raw = res.json?.data;
  const contracts = Array.isArray(raw)
    ? raw.map((x) => String(Array.isArray(x) ? x[0] : x).trim().toLowerCase()).filter(Boolean)
    : [];
  return { contracts, error: null };
}

async function fetchSideList(varietyId, contractId, tradeDate, dataType) {
  const res = await postForm('/u/interfacesWebTiMemberDealPosiQuotes/loadList', {
    trade_date: String(tradeDate),
    trade_type: '0',
    variety: String(varietyId).toLowerCase(),
    contract_id: String(contractId).toLowerCase(),
    data_type: String(dataType),
  });
  if (res.status !== 200 || String(res.json?.code) !== '0') {
    return { rows: [], error: res.json?.msg || `HTTP ${res.status}` };
  }
  return { rows: Array.isArray(res.json?.data) ? res.json.data : [], error: null };
}

async function fetchContractBundle(varietyId, contractId, tradeDate) {
  const [buyPack, sellPack] = await Promise.all([
    fetchSideList(varietyId, contractId, tradeDate, 2),
    fetchSideList(varietyId, contractId, tradeDate, 3),
  ]);
  if (buyPack.error && sellPack.error) {
    return { contractId, error: buyPack.error || sellPack.error, empty: true, score: 0 };
  }
  const buyFutureList = normalizeSideRows(buyPack.rows, 'buy');
  const sellFutureList = normalizeSideRows(sellPack.rows, 'sell');
  const buyTot = extractTotal(buyPack.rows);
  const sellTot = extractTotal(sellPack.rows);
  const todayBuyQty =
    buyTot.qty != null ? buyTot.qty : buyFutureList.reduce((s, r) => s + r.todayBuyQty, 0) || null;
  const todaySellQty =
    sellTot.qty != null ? sellTot.qty : sellFutureList.reduce((s, r) => s + r.todaySellQty, 0) || null;
  const buySub =
    buyTot.sub != null ? buyTot.sub : buyFutureList.reduce((s, r) => s + (Number(r.buySub) || 0), 0);
  const sellSub =
    sellTot.sub != null ? sellTot.sub : sellFutureList.reduce((s, r) => s + (Number(r.sellSub) || 0), 0);
  const hasSignal = buyFutureList.length > 0 || sellFutureList.length > 0;
  return {
    contractId,
    empty: !hasSignal,
    todayBuyQty,
    todaySellQty,
    buySub,
    sellSub,
    buyFutureList,
    sellFutureList,
    score: (todayBuyQty || 0) + (todaySellQty || 0),
  };
}

async function buildVarietyRow(varietyId, tradeDate) {
  const id = String(varietyId).toLowerCase();
  const { contracts, error } = await fetchContractIds(id, tradeDate);
  if (error) {
    return {
      varietyId: id,
      tradeDate,
      contractId: null,
      empty: true,
      error,
      data: null,
      dataSource: 'gfex-official-member',
      method: 'gfex-member-ranking',
    };
  }
  if (!contracts.length) {
    return {
      varietyId: id,
      tradeDate,
      contractId: null,
      empty: true,
      data: null,
      dataSource: 'gfex-official-member',
      method: 'gfex-member-ranking',
      note: '当日该品种未公布持仓排名合约',
    };
  }

  let best = null;
  for (const cid of contracts) {
    const bundle = await fetchContractBundle(id, cid, tradeDate);
    if (bundle.empty) continue;
    if (!best || bundle.score > best.score) best = bundle;
    await new Promise((r) => setTimeout(r, 80));
  }

  if (!best) {
    return {
      varietyId: id,
      tradeDate,
      contractId: null,
      empty: true,
      data: null,
      dataSource: 'gfex-official-member',
      method: 'gfex-member-ranking',
      note: '合约列表有但排名为空',
      triedContracts: contracts,
    };
  }

  return {
    varietyId: id,
    tradeDate,
    contractId: best.contractId,
    empty: false,
    todayBuyQty: best.todayBuyQty,
    todaySellQty: best.todaySellQty,
    buySub: best.buySub,
    sellSub: best.sellSub,
    data: {
      contractId: best.contractId,
      todayBuyQty: best.todayBuyQty,
      todaySellQty: best.todaySellQty,
      buySub: best.buySub,
      sellSub: best.sellSub,
      buyFutureList: best.buyFutureList,
      sellFutureList: best.sellFutureList,
    },
    dataSource: 'gfex-official-member',
    method: 'gfex-member-ranking',
  };
}

async function probeTradeDateHasAny(tradeDate, varietyId = 'si') {
  const { contracts } = await fetchContractIds(varietyId, tradeDate);
  if (!contracts.length) return false;
  const pack = await fetchSideList(varietyId, contracts[0], tradeDate, 2);
  return (pack.rows || []).some(isMemberRow);
}

async function resolveLatestTradeDate(preferDate) {
  let cursor = String(preferDate || toYyyymmdd()).replace(/\D/g, '');
  const tried = [];
  for (let i = 0; i < 12 && cursor; i += 1) {
    tried.push(cursor);
    try {
      if (await probeTradeDateHasAny(cursor, 'si')) {
        return { tradeDate: cursor, tried };
      }
    } catch {
      // miss
    }
    cursor = priorYyyymmdd(cursor, 1);
  }
  return { tradeDate: null, tried };
}

async function syncGfexMemberRanking(options = {}) {
  const force = Boolean(options.force);
  const varieties = (options.varieties || DEFAULT_FOCUS).map((v) => String(v).toLowerCase());
  const resolved = await resolveLatestTradeDate(options.tradeDate);
  if (!resolved.tradeDate) {
    return {
      status: 'failed',
      error: 'no_gfex_member_day',
      tried: resolved.tried,
      version: GFEX_MEMBER_VERSION,
    };
  }
  const results = [];
  for (const varietyId of varieties) {
    const existing = loadLatestMemberPosi(varietyId);
    if (!force && existing?.tradeDate === resolved.tradeDate && !existing.empty) {
      results.push({ varietyId, status: 'skipped', tradeDate: resolved.tradeDate, reason: 'fresh' });
      continue;
    }
    const row = await buildVarietyRow(varietyId, resolved.tradeDate);
    const fp = persistMemberPosiRow(row);
    results.push({
      varietyId,
      status: row.empty ? 'empty' : 'ok',
      tradeDate: resolved.tradeDate,
      contractId: row.contractId,
      path: fp,
      error: row.error || undefined,
    });
    await new Promise((r) => setTimeout(r, options.rateMs || 200));
  }
  return {
    status: 'ok',
    tradeDate: resolved.tradeDate,
    ok: results.filter((r) => r.status === 'ok').length,
    empty: results.filter((r) => r.status === 'empty').length,
    results,
    version: GFEX_MEMBER_VERSION,
  };
}

async function backfillGfexMemberRanking(options = {}) {
  const days = Math.max(1, Math.min(20, Number(options.days) || 5));
  const varieties = (options.varieties || DEFAULT_FOCUS).map((v) => String(v).toLowerCase());
  let cursor = String(options.tradeDate || toYyyymmdd()).replace(/\D/g, '');
  const dayResults = [];
  for (let i = 0; i < days && cursor; i += 1) {
    try {
      const has = await probeTradeDateHasAny(cursor, varieties[0] || 'si');
      if (!has) {
        dayResults.push({ tradeDate: cursor, status: 'miss' });
      } else {
        let ok = 0;
        for (const varietyId of varieties) {
          const row = await buildVarietyRow(varietyId, cursor);
          if (!row.empty) {
            persistMemberPosiRow(row);
            ok += 1;
          } else if (options.persistEmpty) {
            persistMemberPosiRow(row);
          }
          await new Promise((r) => setTimeout(r, options.rateMs || 150));
        }
        dayResults.push({ tradeDate: cursor, status: 'ok', ok });
      }
    } catch (err) {
      dayResults.push({ tradeDate: cursor, status: 'miss', error: err.message });
    }
    cursor = priorYyyymmdd(cursor, 1);
  }
  return { status: 'ok', days: dayResults, version: GFEX_MEMBER_VERSION };
}

module.exports = {
  GFEX_MEMBER_VERSION,
  DEFAULT_FOCUS,
  syncGfexMemberRanking,
  backfillGfexMemberRanking,
  loadLatestMemberPosi,
  persistMemberPosiRow,
  buildVarietyRow,
  resolveLatestTradeDate,
};
