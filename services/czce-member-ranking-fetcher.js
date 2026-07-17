/**
 * 郑商所会员成交持仓排名（官方 FutureDataHolding.xlsx）
 * http://www.czce.com.cn/cn/DFSStaticFiles/Future/{year}/{YYYYMMDD}/FutureDataHolding.xlsx
 * 优先品种合计段；无则回退主力合约段。不编造席位。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const XLSX = require('xlsx');
const { getDataDir, getExternalRoot } = require('./data-paths');

const CZCE_MEMBER_VERSION = 'v1.56.20-shfe-czce-member-rank';

const VARIETY_ALIASES = Object.freeze({
  ta: ['PTA', 'TA'],
  cf: ['CF'],
  sr: ['SR'],
  oi: ['OI'],
  ma: ['MA'],
  fg: ['FG'],
  rm: ['RM'],
  sf: ['SF'],
  sm: ['SM'],
  ap: ['AP'],
  cj: ['CJ'],
  ur: ['UR'],
  sa: ['SA'],
  pf: ['PF'],
  pk: ['PK'],
  sh: ['SH'],
  px: ['PX'],
  pr: ['PR'],
  cy: ['CY'],
  rs: ['RS'],
  wh: ['WH'],
  pm: ['PM'],
  ri: ['RI'],
  lr: ['LR'],
  jr: ['JR'],
  zc: ['ZC'],
  pl: ['PL'],
});

const DEFAULT_FOCUS = Object.freeze([
  'TA', 'MA', 'FG', 'SA', 'CF', 'SR', 'OI', 'RM', 'AP', 'CJ', 'UR', 'PF', 'PK', 'SH', 'PX', 'SF', 'SM',
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
  const dir = path.join(root, 'cache', 'czce-member-posi');
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
      JSON.stringify({ ...row, persistedAt: new Date().toISOString(), version: CZCE_MEMBER_VERSION }, null, 2),
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

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
          Host: parsed.hostname,
          Referer: 'http://www.czce.com.cn/cn/jysj/ccpm/H077003004index_1.htm',
          Accept: '*/*',
        },
        timeout: 45000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects > 6) {
            reject(new Error('too_many_redirects'));
            return;
          }
          let next = res.headers.location;
          if (next.startsWith('/')) next = `${parsed.protocol}//${parsed.host}${next}`;
          fetchBuffer(next, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function holdingUrls(tradeDate) {
  const d = String(tradeDate).replace(/\D/g, '');
  const y = d.slice(0, 4);
  return [
    `http://www.czce.com.cn/cn/DFSStaticFiles/Future/${y}/${d}/FutureDataHolding.xlsx`,
    `https://www.czce.com.cn/cn/DFSStaticFiles/Future/${y}/${d}/FutureDataHolding.xlsx`,
    `http://www.czce.com.cn/cn/DFSStaticFiles/Future/${y}/${d}/FutureDataHolding.xls`,
  ];
}

async function fetchHoldingWorkbook(tradeDate) {
  let lastErr = null;
  for (const url of holdingUrls(tradeDate)) {
    try {
      const buf = await fetchBuffer(url);
      if (!buf || buf.length < 100) throw new Error('empty_buffer');
      return XLSX.read(buf, { type: 'buffer' });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('fetch_failed');
}

function parseHoldingSheet(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const sections = [];
  let current = null;

  const flush = () => {
    if (current) sections.push(current);
    current = null;
  };

  for (let i = 0; i < grid.length; i += 1) {
    const cell0 = String(grid[i][0] || '').trim();
    const varietyMatch = cell0.match(/品种[：:]\s*.*?([A-Za-z]{1,4})\b/);
    const contractMatch = cell0.match(/合约[：:]\s*([A-Za-z0-9]+)/);
    if (varietyMatch || contractMatch) {
      flush();
      current = {
        kind: contractMatch ? 'contract' : 'variety',
        code: String(contractMatch ? contractMatch[1] : varietyMatch[1]).toUpperCase(),
        headerRow: i,
        memberRows: [],
        totals: null,
      };
      continue;
    }
    if (!current) continue;
    if (/^名次/.test(cell0)) continue;
    if (/合计/.test(cell0)) {
      current.totals = {
        buyQty: parseNum(grid[i][5]),
        buySub: parseNum(grid[i][6]),
        sellQty: parseNum(grid[i][8]),
        sellSub: parseNum(grid[i][9]),
        vol: parseNum(grid[i][2]),
      };
      continue;
    }
    const rank = parseNum(cell0);
    if (rank == null || rank <= 0) continue;
    current.memberRows.push({
      rank,
      volName: String(grid[i][1] || '').trim(),
      vol: parseNum(grid[i][2]),
      volChg: parseNum(grid[i][3]),
      buyName: String(grid[i][4] || '').trim(),
      buyQty: parseNum(grid[i][5]),
      buySub: parseNum(grid[i][6]),
      sellName: String(grid[i][7] || '').trim(),
      sellQty: parseNum(grid[i][8]),
      sellSub: parseNum(grid[i][9]),
    });
  }
  flush();
  return sections;
}

function sectionToLists(section) {
  const buyFutureList = [];
  const sellFutureList = [];
  for (const r of section.memberRows || []) {
    if (r.buyName && r.buyQty > 0) {
      buyFutureList.push({
        rank: String(r.rank),
        buyAbbr: r.buyName,
        todayBuyQty: r.buyQty,
        buySub: r.buySub,
      });
    }
    if (r.sellName && r.sellQty > 0) {
      sellFutureList.push({
        rank: String(r.rank),
        sellAbbr: r.sellName,
        todaySellQty: r.sellQty,
        sellSub: r.sellSub,
      });
    }
  }
  const todayBuyQty =
    section.totals?.buyQty != null
      ? section.totals.buyQty
      : buyFutureList.reduce((s, x) => s + x.todayBuyQty, 0) || null;
  const todaySellQty =
    section.totals?.sellQty != null
      ? section.totals.sellQty
      : sellFutureList.reduce((s, x) => s + x.todaySellQty, 0) || null;
  const buySub =
    section.totals?.buySub != null
      ? section.totals.buySub
      : buyFutureList.reduce((s, x) => s + (Number(x.buySub) || 0), 0);
  const sellSub =
    section.totals?.sellSub != null
      ? section.totals.sellSub
      : sellFutureList.reduce((s, x) => s + (Number(x.sellSub) || 0), 0);
  return { buyFutureList, sellFutureList, todayBuyQty, todaySellQty, buySub, sellSub };
}

function varietyPrefix(code) {
  const m = String(code || '').toUpperCase().match(/^([A-Z]+)/);
  return m ? m[1] : '';
}

function aliasCodes(varietyId) {
  const id = String(varietyId || '').toLowerCase();
  const aliases = VARIETY_ALIASES[id] || [id.toUpperCase()];
  return [...new Set(aliases.map((a) => String(a).toUpperCase()))];
}

function pickSectionForVariety(sections, varietyId) {
  const aliases = aliasCodes(varietyId);
  const varietySections = sections.filter(
    (s) => s.kind === 'variety' && aliases.includes(String(s.code).toUpperCase())
  );
  if (varietySections.length) return varietySections[0];

  const contractSections = sections.filter((s) => {
    if (s.kind !== 'contract') return false;
    const prefix = varietyPrefix(s.code);
    return aliases.some(
      (a) => prefix === a || (a === 'PTA' && prefix === 'TA') || (a === 'TA' && prefix === 'TA')
    );
  });
  if (!contractSections.length) return null;
  let best = null;
  let bestScore = -1;
  for (const s of contractSections) {
    const lists = sectionToLists(s);
    const score = (lists.todayBuyQty || 0) + (lists.todaySellQty || 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function rowForVariety(varietyId, tradeDate, sections) {
  const id = String(varietyId).toLowerCase();
  const section = pickSectionForVariety(sections, id);
  if (!section) {
    return {
      varietyId: id,
      tradeDate,
      contractId: null,
      empty: true,
      data: null,
      dataSource: 'czce-official-holding',
      method: 'czce-member-ranking',
      note: '当日该品种未公布持仓排名',
    };
  }
  const lists = sectionToLists(section);
  const contractId =
    section.kind === 'contract' ? String(section.code).toLowerCase() : `variety:${section.code}`;
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
    dataSource: 'czce-official-holding',
    method: 'czce-member-ranking',
    sectionKind: section.kind,
    sectionCode: section.code,
  };
}

async function resolveLatestHolding(preferDate) {
  let cursor = String(preferDate || toYyyymmdd()).replace(/\D/g, '');
  const tried = [];
  for (let i = 0; i < 12 && cursor; i += 1) {
    tried.push(cursor);
    try {
      const wb = await fetchHoldingWorkbook(cursor);
      const sections = parseHoldingSheet(wb);
      if (sections.length) return { tradeDate: cursor, sections, tried };
    } catch {
      // miss
    }
    cursor = priorYyyymmdd(cursor, 1);
  }
  return { tradeDate: null, sections: [], tried };
}

async function syncCzceMemberRanking(options = {}) {
  const force = Boolean(options.force);
  const varieties = (options.varieties || DEFAULT_FOCUS).map((v) => String(v).toLowerCase());
  const resolved = await resolveLatestHolding(options.tradeDate);
  if (!resolved.tradeDate) {
    return {
      status: 'failed',
      error: 'no_holding_file',
      tried: resolved.tried,
      version: CZCE_MEMBER_VERSION,
    };
  }
  const results = [];
  for (const varietyId of varieties) {
    const existing = loadLatestMemberPosi(varietyId);
    if (!force && existing?.tradeDate === resolved.tradeDate && !existing.empty) {
      results.push({ varietyId, status: 'skipped', tradeDate: resolved.tradeDate, reason: 'fresh' });
      continue;
    }
    const row = rowForVariety(varietyId, resolved.tradeDate, resolved.sections);
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
    ok: results.filter((r) => r.status === 'ok').length,
    empty: results.filter((r) => r.status === 'empty').length,
    results,
    version: CZCE_MEMBER_VERSION,
  };
}

async function backfillCzceMemberRanking(options = {}) {
  const days = Math.max(1, Math.min(40, Number(options.days) || 10));
  const varieties = (options.varieties || DEFAULT_FOCUS).map((v) => String(v).toLowerCase());
  let cursor = String(options.tradeDate || toYyyymmdd()).replace(/\D/g, '');
  const dayResults = [];
  for (let i = 0; i < days && cursor; i += 1) {
    try {
      const wb = await fetchHoldingWorkbook(cursor);
      const sections = parseHoldingSheet(wb);
      let ok = 0;
      for (const varietyId of varieties) {
        const row = rowForVariety(varietyId, cursor, sections);
        if (!row.empty) {
          persistMemberPosiRow(row);
          ok += 1;
        } else if (options.persistEmpty) {
          persistMemberPosiRow(row);
        }
      }
      dayResults.push({ tradeDate: cursor, status: 'ok', ok, sections: sections.length });
    } catch (err) {
      dayResults.push({ tradeDate: cursor, status: 'miss', error: err.message });
    }
    cursor = priorYyyymmdd(cursor, 1);
    await new Promise((r) => setTimeout(r, options.rateMs || 250));
  }
  return { status: 'ok', days: dayResults, version: CZCE_MEMBER_VERSION };
}

module.exports = {
  CZCE_MEMBER_VERSION,
  DEFAULT_FOCUS,
  VARIETY_ALIASES,
  syncCzceMemberRanking,
  backfillCzceMemberRanking,
  loadLatestMemberPosi,
  persistMemberPosiRow,
  parseHoldingSheet,
  resolveLatestHolding,
};
