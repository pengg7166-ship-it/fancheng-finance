/**
 * 上期所 / 上期能源 会员成交持仓排名（官方 pm*.dat）
 * https://www.shfe.com.cn/data/tradedata/future/dailydata/pmYYYYMMDD.dat
 * 仅落盘真实排名；持仓未达公布标准时该品种当日无行 → empty，不编造。
 */
const fs = require('fs');
const path = require('path');
const { fetchText } = require('./http-client');
const { getDataDir, getExternalRoot } = require('./data-paths');
const { getAllCommodities } = require('./commodities-catalog');

const SHFE_MEMBER_VERSION = 'v1.56.20-shfe-czce-member-rank';
const PM_URL = 'https://www.shfe.com.cn/data/tradedata/future/dailydata/pm%s.dat';

const DEFAULT_FOCUS = Object.freeze([
  'cu', 'al', 'zn', 'pb', 'ni', 'sn', 'au', 'ag', 'rb', 'hc', 'ss',
  'fu', 'bu', 'ru', 'sp', 'ao', 'br', 'nr', 'ad', 'sc', 'lu', 'bc', 'ec',
]);

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
  const dir = path.join(root, 'cache', 'shfe-member-posi');
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
      JSON.stringify({ ...row, persistedAt: new Date().toISOString(), version: SHFE_MEMBER_VERSION }, null, 2),
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

function varietyFromInstrument(instrumentId) {
  const m = String(instrumentId || '').trim().toLowerCase().match(/^([a-z]+)/);
  return m ? m[1] : null;
}

function buildListsFromContractRows(rows) {
  const buyFutureList = [];
  const sellFutureList = [];
  for (const r of rows) {
    const rank = Number(r.RANK);
    if (!(rank > 0)) continue;
    const buyName = String(r.PARTICIPANTABBR2 || '').trim();
    const sellName = String(r.PARTICIPANTABBR3 || '').trim();
    const buyQty = Number(r.CJ2);
    const sellQty = Number(r.CJ3);
    const buySub = Number(r.CJ2_CHG);
    const sellSub = Number(r.CJ3_CHG);
    if (buyName && Number.isFinite(buyQty) && buyQty > 0) {
      buyFutureList.push({
        rank: String(rank),
        buyAbbr: buyName,
        todayBuyQty: buyQty,
        buySub: Number.isFinite(buySub) ? buySub : null,
      });
    }
    if (sellName && Number.isFinite(sellQty) && sellQty > 0) {
      sellFutureList.push({
        rank: String(rank),
        sellAbbr: sellName,
        todaySellQty: sellQty,
        sellSub: Number.isFinite(sellSub) ? sellSub : null,
      });
    }
  }
  const todayBuyQty = buyFutureList.reduce((s, r) => s + r.todayBuyQty, 0);
  const todaySellQty = sellFutureList.reduce((s, r) => s + r.todaySellQty, 0);
  const buySub = buyFutureList.reduce((s, r) => s + (Number(r.buySub) || 0), 0);
  const sellSub = sellFutureList.reduce((s, r) => s + (Number(r.sellSub) || 0), 0);
  return {
    buyFutureList,
    sellFutureList,
    todayBuyQty: todayBuyQty || null,
    todaySellQty: todaySellQty || null,
    buySub,
    sellSub,
  };
}

function pickDominantContract(byContract) {
  let bestId = null;
  let bestScore = -1;
  for (const [contractId, rows] of byContract.entries()) {
    const lists = buildListsFromContractRows(rows);
    const score = (lists.todayBuyQty || 0) + (lists.todaySellQty || 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = contractId;
    }
  }
  return bestId;
}

function indexPmCursor(oCursor) {
  const byVariety = new Map();
  for (const r of oCursor || []) {
    const rank = Number(r.RANK);
    if (!(rank > 0)) continue;
    const instrumentId = String(r.INSTRUMENTID || '').trim().toLowerCase();
    const varietyId = varietyFromInstrument(instrumentId);
    if (!varietyId || !instrumentId) continue;
    if (!byVariety.has(varietyId)) byVariety.set(varietyId, new Map());
    const byContract = byVariety.get(varietyId);
    if (!byContract.has(instrumentId)) byContract.set(instrumentId, []);
    byContract.get(instrumentId).push(r);
  }
  return byVariety;
}

function rowForVariety(varietyId, tradeDate, byContract) {
  const id = String(varietyId).toLowerCase();
  if (!byContract || byContract.size === 0) {
    return {
      varietyId: id,
      tradeDate,
      contractId: null,
      empty: true,
      error: null,
      data: null,
      dataSource: 'shfe-official-pm.dat',
      method: 'shfe-member-ranking',
      note: '当日该品种未达公布标准或未公布排名',
    };
  }
  const contractId = pickDominantContract(byContract);
  const lists = buildListsFromContractRows(byContract.get(contractId) || []);
  const hasSignal = lists.buyFutureList.length > 0 || lists.sellFutureList.length > 0;
  return {
    varietyId: id,
    tradeDate,
    contractId,
    empty: !hasSignal,
    todayBuyQty: lists.todayBuyQty,
    todaySellQty: lists.todaySellQty,
    buySub: lists.buySub,
    sellSub: lists.sellSub,
    data: {
      contractId,
      todayBuyQty: lists.todayBuyQty,
      todaySellQty: lists.todaySellQty,
      buySub: lists.buySub,
      sellSub: lists.sellSub,
      buyFutureList: lists.buyFutureList,
      sellFutureList: lists.sellFutureList,
    },
    dataSource: 'shfe-official-pm.dat',
    method: 'shfe-member-ranking',
  };
}

async function fetchPmFile(tradeDate) {
  const url = PM_URL.replace('%s', tradeDate);
  const text = await fetchText(url, {
    timeout: 25000,
    retries: 2,
    headers: {
      'User-Agent': 'Mozilla/4.0 (compatible; MSIE 5.5; Windows NT)',
      Referer: 'https://www.shfe.com.cn/',
      Accept: 'application/json,text/plain,*/*',
    },
  });
  const json = JSON.parse(text);
  if (!Array.isArray(json?.o_cursor)) throw new Error('invalid_pm_payload');
  return json;
}

async function resolveLatestTradeDate(preferDate) {
  let cursor = String(preferDate || toYyyymmdd()).replace(/\D/g, '');
  const tried = [];
  for (let i = 0; i < 12 && cursor; i += 1) {
    tried.push(cursor);
    try {
      const json = await fetchPmFile(cursor);
      if ((json.o_cursor || []).some((r) => Number(r.RANK) > 0)) {
        return { tradeDate: cursor, json, tried };
      }
    } catch {
      // 404 / weekend
    }
    cursor = priorYyyymmdd(cursor, 1);
  }
  return { tradeDate: null, json: null, tried };
}

function catalogShfeIneIds() {
  return getAllCommodities()
    .filter((c) => c.exchangeId === 'shfe' || c.exchangeId === 'ine')
    .map((c) => String(c.id).toLowerCase());
}

async function syncShfeMemberRanking(options = {}) {
  const force = Boolean(options.force);
  const varieties = (options.varieties || DEFAULT_FOCUS).map((v) => String(v).toLowerCase());
  const resolved = await resolveLatestTradeDate(options.tradeDate);
  if (!resolved.tradeDate || !resolved.json) {
    return {
      status: 'failed',
      error: 'no_pm_file',
      tried: resolved.tried,
      version: SHFE_MEMBER_VERSION,
    };
  }
  const byVariety = indexPmCursor(resolved.json.o_cursor);
  const results = [];
  for (const varietyId of varieties) {
    const existing = loadLatestMemberPosi(varietyId);
    if (!force && existing?.tradeDate === resolved.tradeDate && !existing.empty) {
      results.push({ varietyId, status: 'skipped', tradeDate: resolved.tradeDate, reason: 'fresh' });
      continue;
    }
    const row = rowForVariety(varietyId, resolved.tradeDate, byVariety.get(varietyId));
    const fp = persistMemberPosiRow(row);
    results.push({
      varietyId,
      status: row.empty ? 'empty' : 'ok',
      tradeDate: resolved.tradeDate,
      contractId: row.contractId,
      path: fp,
    });
  }
  return {
    status: 'ok',
    tradeDate: resolved.tradeDate,
    availableVarieties: [...byVariety.keys()].sort(),
    ok: results.filter((r) => r.status === 'ok').length,
    empty: results.filter((r) => r.status === 'empty').length,
    results,
    version: SHFE_MEMBER_VERSION,
  };
}

async function backfillShfeMemberRanking(options = {}) {
  const days = Math.max(1, Math.min(40, Number(options.days) || 10));
  const varieties = (options.varieties || DEFAULT_FOCUS).map((v) => String(v).toLowerCase());
  let cursor = String(options.tradeDate || toYyyymmdd()).replace(/\D/g, '');
  const dayResults = [];
  for (let i = 0; i < days && cursor; i += 1) {
    try {
      const json = await fetchPmFile(cursor);
      const byVariety = indexPmCursor(json.o_cursor);
      if (byVariety.size === 0) {
        dayResults.push({ tradeDate: cursor, status: 'empty_file' });
      } else {
        let ok = 0;
        for (const varietyId of varieties) {
          const row = rowForVariety(varietyId, cursor, byVariety.get(varietyId));
          if (!row.empty) {
            persistMemberPosiRow(row);
            ok += 1;
          } else if (options.persistEmpty) {
            persistMemberPosiRow(row);
          }
        }
        dayResults.push({ tradeDate: cursor, status: 'ok', ok, varieties: byVariety.size });
      }
    } catch (err) {
      dayResults.push({ tradeDate: cursor, status: 'miss', error: err.message });
    }
    cursor = priorYyyymmdd(cursor, 1);
    await new Promise((r) => setTimeout(r, options.rateMs || 200));
  }
  return { status: 'ok', days: dayResults, version: SHFE_MEMBER_VERSION };
}

module.exports = {
  SHFE_MEMBER_VERSION,
  DEFAULT_FOCUS,
  syncShfeMemberRanking,
  backfillShfeMemberRanking,
  loadLatestMemberPosi,
  persistMemberPosiRow,
  fetchPmFile,
  catalogShfeIneIds,
  resolveLatestTradeDate,
};
