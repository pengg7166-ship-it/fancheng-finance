/**
 * 每日数据增量同步编排 '全品'+ 宏观/P0 衍生数据
 * 幂等：同一天可多次运行；各步骤按缺'陈旧增量补齐
 */
const fs = require('fs');
const path = require('path');
const diskCache = require('./disk-cache');
const { getDataDir, getUserDataDir } = require('./data-paths');
const { getAllCommodities } = require('./commodities-catalog');
const { INSTRUMENT_REGISTRY } = require('./commodity-outlook-engine');
const { fetchCommodityHistory, refreshCommodityKline, fetchFuturesDailyWithOi } = require('./commodities-history-fetcher');
const fredHistory = require('./fred-history-fetcher');
const historicalContext = require('./commodity-outlook-historical-context');
const { saveCnhMidrateFiles } = require('./cnh-midrate-fetcher');
const { scrapeWarehouseReceipts, P0_INSTRUMENTS: WH_P0 } = require('./shfe-warehouse-fetcher');
const { fetchAndSaveTermStructure, P0_INSTRUMENTS: TERM_P0 } = require('./term-structure-fetcher');
const { saveCrossMarketPreciousHistory } = require('./cross-market-precious-fetcher');
const { savePreciousEtfHoldings } = require('./precious-etf-fetcher');
const { saveSlvEtfHoldings } = require('./slv-etf-fetcher');
const newsTagged = require('./news-tagged-loader');
const { saveGeopoliticsDailySeries } = require('./geopolitics-daily-aggregator');
const { runNewsTagExpansion } = require('../scripts/expand-news-tagged');

const MIN_START = '2019-01-01';
const VOLUME_LOOKBACK = 20;
const MIN_BARS = 30;
const LOCK_MAX_MS = 2 * 60 * 60 * 1000;
const STATE_FILE = 'daily-sync-state.json';
const LOG_FILE = 'daily-sync-log.jsonl';
const LOCK_FILE = '.daily-sync-lock.json';

const DEFAULT_TYPES = [
  'fred_macro',
  'cnh',
  'trading_klines',
  'trading_json',
  'commodity_oi',
  'warehouse',
  'dce_warehouse',
  'czce_warehouse',
  'gfex_warehouse',
  'member_ranking',
  'sector_fundamentals',
  'term_structure',
  'cross_market_precious',
  'gld_etf',
  'slv_etf',
  'news_tagged',
  'geopolitics',
];

const TYPE_META = {
  fred_macro: {
    label: 'FRED 宏观序列',
    paths: ['history/fred-dff-daily.json', 'history/fred-vixcls-daily.json', 'history/fred-real10y-daily.json'],
    entry: 'services/fred-history-fetcher.js · loadFredHistory',
    frequency: 'daily',
  },
  cnh: {
    label: '离岸 CNH 中间',
    paths: ['history/cnh-midrate-daily.json'],
    entry: 'scripts/fetch-cnh-midrate.js',
    frequency: 'daily',
  },
  trading_klines: {
    label: '期货日K（disk cache klines',
    paths: ['klines/commodity-{id}-day.json'],
    entry: 'services/commodities-history-fetcher.js · fetchCommodityHistory',
    frequency: 'daily',
  },
  trading_json: {
    label: 'walk-forward 日K（history/trading',
    paths: ['history/trading/{id}.json'],
    entry: 'services/daily-data-sync.js · syncKlinesToTrading',
    frequency: 'daily',
  },
  commodity_oi: {
    label: '持仓/OI 并入 trading',
    paths: ['history/trading/{id}.json (oi/openInterest)'],
    entry: 'scripts/backfill-oi-missing.js',
    frequency: 'daily',
  },
  warehouse: {
    label: '注册仓单 P0（cu/al/au/ag',
    paths: ['history/warehouse-receipts/{id}-daily.json'],
    entry: 'scripts/fetch-warehouse-receipts.js --scrape',
    frequency: 'daily',
  },
  dce_warehouse: {
    label: '大商所仓单/会员持仓（门户API）',
    paths: [
      'history/warehouse-receipts/{id}-daily.json',
      'cache/dce-portal-market.json',
      'cache/dce-member-posi/',
    ],
    entry: 'services/dce-portal-api-fetcher.js · fetchDcePortalMarketBundle',
    frequency: 'daily',
  },
  czce_warehouse: {
    label: '郑商所仓单（DFS Excel）',
    paths: ['history/warehouse-receipts/{id}-daily.json'],
    entry: 'services/czce-warehouse-fetcher.js',
    frequency: 'daily',
  },
  gfex_warehouse: {
    label: '广期所仓单（官方 JSON）',
    paths: ['history/warehouse-receipts/{id}-daily.json'],
    entry: 'services/gfex-warehouse-fetcher.js',
    frequency: 'daily',
  },
  member_ranking: {
    label: '上期/郑商/广期会员持仓排名（官方免费）',
    paths: ['cache/shfe-member-posi/', 'cache/czce-member-posi/', 'cache/gfex-member-posi/'],
    entry:
      'services/shfe-member-ranking-fetcher.js · czce-member-ranking-fetcher.js · gfex-member-ranking-fetcher.js',
    frequency: 'daily',
  },
  sector_fundamentals: {
    label: '显性库存（兰格铁矿港存 / 东财铜所库代理）',
    paths: ['history/sector-fundamentals/'],
    entry: 'services/lange-iron-port-fetcher.js',
    frequency: 'weekly',
  },
  term_structure: {
    label: '期限结构 P0（au/ag/sc/cu',
    paths: ['history/term-structure/{id}-daily.json'],
    entry: 'scripts/fetch-term-structure.js',
    frequency: 'daily',
  },
  cross_market_precious: {
    label: 'COMEX GC/SI + 伦敦',
    paths: ['history/comex-gc-daily.json', 'history/comex-si-daily.json', 'history/fred-london-silver-daily.json'],
    entry: 'scripts/fetch-cross-market-precious.js',
    frequency: 'daily',
  },
  cross_market_external: {
    label: '外盘扩展（LME/CBOT/SGX/ICE）',
    paths: [
      'history/comex-hg-daily.json',
      'history/lme-cad-daily.json',
      'history/lme-ahd-daily.json',
      'history/comex-cl-daily.json',
      'history/cbot-s-daily.json',
      'history/sgx-fef-daily.json',
    ],
    entry: 'scripts/fetch-cross-market-external.js',
    frequency: 'daily',
  },
  gld_etf: {
    label: 'GLD ETF 持仓',
    paths: ['history/precious-etf-holdings-daily.json'],
    entry: 'scripts/fetch-precious-etf-holdings.js',
    frequency: 'daily',
  },
  slv_etf: {
    label: 'SLV ETF 持仓',
    paths: ['history/slv-etf-holdings-daily.json'],
    entry: 'scripts/fetch-slv-etf-holdings.js',
    frequency: 'daily',
  },
  news_tagged: {
    label: 'news-tagged 快讯扩表（skip-warehouse',
    paths: ['history/news-tagged.csv', 'history/news-tagged-verified.csv'],
    entry: 'scripts/expand-news-tagged.js · runNewsTagExpansion',
    frequency: 'daily',
  },
  geopolitics: {
    label: '地缘日聚合（news-tagged 衍生',
    paths: ['history/geopolitics-daily.json'],
    entry: 'scripts/aggregate-geopolitics-daily.js',
    frequency: 'daily',
  },
};

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const da = new Date(normDate(a));
  const db = new Date(normDate(b));
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 999;
  return Math.round((db - da) / 86400000);
}

function tradingDaysBetween(lastDate, endDate = todayKey()) {
  try {
    const { tradingDaysBetween: cnTradingDays } = require('./cn-trading-calendar');
    return cnTradingDays(lastDate, endDate);
  } catch {
    const start = new Date(normDate(lastDate));
    const end = new Date(normDate(endDate));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 999;
    if (start >= end) return 0;
    let count = 0;
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + 1);
    while (d <= end) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) count += 1;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return count;
  }
}

function isStale(lastDate, maxLagDays = 2) {
  if (!lastDate) return true;
  const calLag = daysBetween(lastDate, todayKey());
  if (calLag <= maxLagDays) return false;
  return tradingDaysBetween(lastDate, todayKey()) > maxLagDays;
}

function historyDir() {
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或数据盘不可写');
  return path.join(dataDir, 'history');
}

function statePath() {
  return path.join(historyDir(), STATE_FILE);
}

function logPath() {
  return path.join(historyDir(), LOG_FILE);
}

function lockPath() {
  return path.join(historyDir(), LOCK_FILE);
}

function readJsonSafe(fp, fallback = null) {
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    // ignore
  }
  return fallback;
}

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function appendLog(entry) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(logPath()), { recursive: true });
  fs.appendFileSync(logPath(), `${line}\n`, 'utf8');
}

function acquireLock(trigger) {
  const lp = lockPath();
  const existing = readJsonSafe(lp);
  if (existing?.startedAt && Date.now() - existing.startedAt < LOCK_MAX_MS) {
    return { ok: false, reason: 'lock_held', lock: existing };
  }
  writeJson(lp, { pid: process.pid, trigger, startedAt: Date.now() });
  return { ok: true };
}

function releaseLock() {
  try {
    if (fs.existsSync(lockPath())) fs.unlinkSync(lockPath());
  } catch {
    // ignore
  }
}

function readState() {
  return readJsonSafe(statePath(), { runs: [] });
}

function saveState(patch) {
  const prev = readState();
  writeJson(statePath(), { ...prev, ...patch, updatedAt: new Date().toISOString() });
}

function shouldRunToday({ force = false } = {}) {
  if (force) return true;
  const state = readState();
  return state.lastSuccessDate !== todayKey();
}

function loadTradingBars(id) {
  const fp = path.join(historyDir(), 'trading', `${String(id).toLowerCase()}.json`);
  if (!fs.existsSync(fp)) return { fp, bars: [] };
  const raw = readJsonSafe(fp, []);
  const bars = Array.isArray(raw) ? raw : raw.series || [];
  return { fp, bars };
}

function barVolume(bar) {
  return Number(bar.volume ?? bar.vol ?? bar.turnoverVol ?? 0) || 0;
}

function assessTradingActive(id) {
  const { bars, fp } = loadTradingBars(id);
  if (bars.length < MIN_BARS) {
    return { active: false, reason: 'no_data', bars: bars.length, fp };
  }
  const recent = bars.slice(-VOLUME_LOOKBACK);
  const maxVol = Math.max(...recent.map(barVolume));
  if (maxVol <= 0) return { active: false, reason: 'zero_volume', bars: bars.length, fp };
  return { active: true, reason: null, bars: bars.length, fp, lastDate: normDate(bars[bars.length - 1]?.date) };
}

function getSyncInstrumentIds({ activeOnly = true } = {}) {
  const ids = INSTRUMENT_REGISTRY.map((s) => s.id);
  if (!activeOnly) return ids;
  return ids.filter((id) => assessTradingActive(id).active);
}

function klineKey(instrumentId) {
  return `klines/commodity-${String(instrumentId).toLowerCase()}-day.json`;
}

function readKlines(instrumentId) {
  const stored = diskCache.readStale(klineKey(instrumentId));
  return stored?.data?.klines || [];
}

function readSeriesEndDate(relPath, opts = {}) {
  const fp = path.join(getDataDir() || '', 'history', relPath);
  if (!fp || !fs.existsSync(fp)) return null;
  const raw = readJsonSafe(fp);
  if (!raw) return null;
  const arr = opts.array
    ? raw
    : raw.series || raw.data || raw.records || raw.labels || [];
  if (!arr.length) return null;
  const dates = arr.map((r) => normDate(r.date || r.time)).filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

function tradingBarToJson(bar) {
  const close = bar.close ?? bar.price;
  return {
    date: normDate(bar.date),
    open: bar.open ?? close,
    high: bar.high ?? close,
    low: bar.low ?? close,
    close,
    price: close,
    volume: bar.volume ?? 0,
    ...(bar.openInterest != null || bar.oi != null
      ? { oi: Math.round(bar.oi ?? bar.openInterest), openInterest: Math.round(bar.oi ?? bar.openInterest) }
      : {}),
  };
}

function syncKlinesToTrading(instrumentId, { dryRun = false } = {}) {
  const klines = readKlines(instrumentId);
  if (klines.length < 2) return { status: 'skipped', reason: 'no_klines', added: 0, replaced: 0 };

  const { fp, bars } = loadTradingBars(instrumentId);
  const byDate = new Map(bars.map((b) => [normDate(b.date), b]));
  let added = 0;
  let replaced = 0;

  for (const bar of klines) {
    const d = normDate(bar.date);
    if (!d || d < MIN_START) continue;
    const next = tradingBarToJson(bar);
    if (!byDate.has(d)) {
      byDate.set(d, next);
      added += 1;
    } else {
      const prev = byDate.get(d);
      const merged = { ...prev, ...next };
      const nextOi = next.oi ?? next.openInterest;
      const prevOi = prev.oi ?? prev.openInterest;
      // Prefer incoming OI when klines carry 持仓; only fall back to previous bar OI.
      if (nextOi != null && nextOi > 0) {
        merged.oi = Math.round(nextOi);
        merged.openInterest = Math.round(nextOi);
      } else if (prevOi != null && prevOi > 0) {
        merged.oi = Math.round(prevOi);
        merged.openInterest = Math.round(prevOi);
      }
      byDate.set(d, merged);
      replaced += 1;
    }
  }

  const merged = [...byDate.values()].sort((a, b) => normDate(a.date).localeCompare(normDate(b.date)));
  if (!dryRun && merged.length >= 2) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(merged, null, 2), 'utf8');
  }

  return {
    status: 'ok',
    file: fp,
    rows: merged.length,
    added,
    replaced,
    lastDate: merged.length ? normDate(merged[merged.length - 1].date) : null,
  };
}

function mergeOiIntoTradingBars(existing, fetched) {
  const idx = new Map(existing.map((b, i) => [normDate(b.date), i]));
  let merged = 0;
  for (const bar of fetched) {
    const d = normDate(bar.date);
    const oi = bar.openInterest ?? bar.oi;
    if (!oi || oi <= 0) continue;
    if (idx.has(d)) {
      existing[idx.get(d)].oi = Math.round(oi);
      existing[idx.get(d)].openInterest = Math.round(oi);
      merged += 1;
    }
  }
  return merged;
}

async function syncFredMacro({ dryRun, force }) {
  const staleFiles = ['fred-dff-daily.json', 'fred-vixcls-daily.json', 'fred-real10y-daily.json']
    .map((f) => ({ file: f, end: readSeriesEndDate(f) }))
    .filter((x) => force || isStale(x.end, 3));
  if (!staleFiles.length && !force) {
    return { status: 'skipped', reason: 'fresh', series: staleFiles };
  }
  if (dryRun) {
    return { status: 'dry_run', wouldRefresh: staleFiles.map((x) => x.file) };
  }
  const history = await fredHistory.loadFredHistory({ startDate: MIN_START, force: true });
  await historicalContext.ensureFredDailyCache({ force: true });
  return {
    status: 'ok',
    rowCounts: history.rowCounts,
    refreshed: staleFiles.map((x) => x.file),
  };
}

async function syncCnh({ dryRun, force }) {
  const end = readSeriesEndDate('cnh-midrate-daily.json');
  if (!force && !isStale(end, 2)) return { status: 'skipped', reason: 'fresh', endDate: end };
  if (dryRun) return { status: 'dry_run', wouldRefresh: true, endDate: end };
  const { payload, jsonPath } = await saveCnhMidrateFiles({ startDate: MIN_START });
  return { status: 'ok', file: jsonPath, rows: payload.rowCount, endDate: payload.endDate, source: payload.source };
}

async function syncTradingKlines({ dryRun, instrumentIds, rateMs = 220 }) {
  const ids = instrumentIds || getSyncInstrumentIds({ activeOnly: true });
  const results = [];
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    const klines = readKlines(id);
    const last = klines.length ? normDate(klines[klines.length - 1].date) : null;
    const stale = isStale(last, 1);
    if (!stale) {
      skipped += 1;
      results.push({ id, status: 'skipped', lastDate: last });
      continue;
    }
    if (dryRun) {
      results.push({ id, status: 'dry_run', lastDate: last });
      continue;
    }
    try {
      const data = await fetchCommodityHistory(id, 'day', { force: true });
      fetched += 1;
      results.push({
        id,
        status: 'ok',
        bars: data.klines?.length || 0,
        source: data.source,
        endDate: data.klines?.length ? normDate(data.klines[data.klines.length - 1].date) : null,
      });
    } catch (err) {
      failed += 1;
      results.push({ id, status: 'failed', error: err.message });
    }
    await new Promise((r) => setTimeout(r, rateMs));
  }

  return { status: failed ? 'partial' : 'ok', fetched, skipped, failed, results };
}

async function syncTradingJson({ dryRun, instrumentIds }) {
  const ids = instrumentIds || getSyncInstrumentIds({ activeOnly: true });
  const results = [];
  let updated = 0;
  for (const id of ids) {
    const r = syncKlinesToTrading(id, { dryRun });
    results.push({ id, ...r });
    if (r.added > 0 || r.replaced > 0) updated += 1;
  }
  return { status: 'ok', updated, results };
}

async function syncCommodityOi({ dryRun, instrumentIds, rateMs = 280 }) {
  const ids = instrumentIds || getSyncInstrumentIds({ activeOnly: true });
  const results = [];
  let mergedTotal = 0;

  for (const id of ids) {
    const { fp, bars } = loadTradingBars(id);
    if (bars.length < MIN_BARS) {
      results.push({ id, status: 'skipped', reason: 'no_trading_file' });
      continue;
    }
    const withOi = bars.filter((b) => (b.oi ?? b.openInterest) > 0);
    const lastOiDate = withOi.length ? normDate(withOi[withOi.length - 1].date) : null;
    const lastBarDate = normDate(bars[bars.length - 1].date);
    const oiLagsBars = Boolean(lastOiDate && lastBarDate && lastOiDate < lastBarDate);
    const needsOi = !lastOiDate || oiLagsBars || isStale(lastOiDate, 2);
    if (!needsOi) {
      results.push({ id, status: 'skipped', lastOiDate, lastBarDate });
      continue;
    }
    if (dryRun) {
      results.push({ id, status: 'dry_run', lastOiDate, lastBarDate, oiLagsBars });
      continue;
    }
    try {
      const fetched = await fetchFuturesDailyWithOi(id);
      const oiBars = fetched?.bars || [];
      const merged = mergeOiIntoTradingBars(bars, oiBars);
      if (merged > 0) fs.writeFileSync(fp, JSON.stringify(bars, null, 2), 'utf8');
      mergedTotal += merged;
      const withOiAfter = bars.filter((b) => (b.oi ?? b.openInterest) > 0);
      const newLastOi = withOiAfter.length ? normDate(withOiAfter[withOiAfter.length - 1].date) : lastOiDate;
      results.push({
        id,
        status: merged > 0 ? 'ok' : 'no_merge',
        merged,
        source: fetched?.source || null,
        lastOiDate: newLastOi,
        lastBarDate,
      });
    } catch (err) {
      results.push({ id, status: 'failed', error: err.message });
    }
    await new Promise((r) => setTimeout(r, rateMs));
  }

  return { status: 'ok', mergedTotal, results };
}

async function syncWarehouse({ dryRun, force }) {
  const gapsPreview = await scrapeWarehouseReceipts({
    instruments: WH_P0,
    startDate: MIN_START,
    dryRun: true,
  });
  const needs = (gapsPreview.results || []).filter((r) => r.missingCount > 0);
  if (!needs.length && !force) {
    return { status: 'skipped', reason: 'complete', instruments: WH_P0 };
  }
  if (dryRun) {
    return { status: 'dry_run', gaps: gapsPreview.results };
  }
  const result = await scrapeWarehouseReceipts({
    instruments: WH_P0,
    startDate: MIN_START,
    force: false,
    rateMs: 450,
  });
  return {
    status: 'ok',
    dayFetches: result.dayFetches,
    results: (result.results || []).map((r) => ({
      instrumentId: r.instrumentId,
      status: r.status,
      rowCount: r.rowCount,
      added: r.added,
      endDate: r.endDate,
    })),
  };
}

async function syncDceWarehouse({ dryRun, force }) {
  let dce;
  try {
    dce = require('./dce-portal-api-fetcher');
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
  if (!dce.isDcePortalConfigured()) {
    return { status: 'skipped', reason: 'awaiting_credentials' };
  }
  if (dryRun) {
    return {
      status: 'dry_run',
      varieties: dce.getDcePortalConfig().varieties,
      wouldBackfill: true,
    };
  }
  const live = await dce.fetchDcePortalMarketBundle({ force: Boolean(force) });
  let backfill = null;
  try {
    backfill = await dce.backfillDceWarehouseHistory({
      lookbackDays: force ? 160 : 20,
      targetDays: force ? 90 : 12,
      deep: Boolean(force),
    });
  } catch (err) {
    backfill = { status: 'failed', error: err.message };
  }
  return {
    status: live.configured === false ? 'skipped' : live.error ? 'failed' : 'ok',
    tradeDate: live.tradeDate,
    warehouseOk: (live.historyPersist?.results || []).filter((r) => r.status === 'ok').length,
    memberPosiOk: (live.memberPosi || []).filter((m) => !m.error && !m.empty).length,
    cachePath: live.cachePath || null,
    historyPersist: live.historyPersist || null,
    backfill: backfill
      ? {
          warehouseFetched: backfill.warehouseFetched,
          persistOk: (backfill.persist?.results || []).filter((r) => r.status === 'ok').length,
          deep: backfill.deep,
          error: backfill.error,
        }
      : null,
    errors: live.errors,
  };
}

async function syncCzceWarehouse({ dryRun, force }) {
  let czce;
  try {
    czce = require('./czce-warehouse-fetcher');
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
  if (dryRun) {
    return { status: 'dry_run', varieties: czce.FOCUS_VARIETIES, wouldScrape: true };
  }
  try {
    const result = await czce.scrapeCzceWarehouseReceipts({
      deep: Boolean(force),
      lookbackDays: force ? 120 : 15,
      targetDays: force ? 80 : 10,
    });
    return {
      status: 'ok',
      daysFilled: result.daysFilled,
      endDate: result.endDate,
      version: result.version,
      errors: result.errors,
    };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

async function syncMemberRanking({ dryRun, force }) {
  try {
    const config = require('./config');
    const userData =
      getUserDataDir() ||
      (process.env.FANCHENG_APP_ROOT
        ? path.join(process.env.FANCHENG_APP_ROOT, 'userData')
        : null);
    if (userData && typeof config.init === 'function') config.init(userData);
  } catch {
    // non-fatal — DCE may still skip
  }
  if (dryRun) {
    return { status: 'dry_run', wouldSync: ['shfe', 'czce', 'gfex', 'dce'] };
  }
  const out = { status: 'ok', shfe: null, czce: null, gfex: null, dce: null };
  try {
    const shfe = require('./shfe-member-ranking-fetcher');
    out.shfe = await shfe.syncShfeMemberRanking({ force: Boolean(force) });
    if (force) {
      const bf = await shfe.backfillShfeMemberRanking({ days: 8, force: true });
      out.shfeBackfill = {
        okDays: (bf.days || []).filter((d) => d.status === 'ok').length,
        version: bf.version,
      };
    }
  } catch (err) {
    out.shfe = { status: 'failed', error: err.message };
  }
  try {
    const czce = require('./czce-member-ranking-fetcher');
    out.czce = await czce.syncCzceMemberRanking({ force: Boolean(force) });
    if (force) {
      const bf = await czce.backfillCzceMemberRanking({ days: 8, force: true });
      out.czceBackfill = {
        okDays: (bf.days || []).filter((d) => d.status === 'ok').length,
        version: bf.version,
      };
    }
  } catch (err) {
    out.czce = { status: 'failed', error: err.message };
  }
  try {
    const gfex = require('./gfex-member-ranking-fetcher');
    out.gfex = await gfex.syncGfexMemberRanking({ force: Boolean(force) });
    if (force) {
      const bf = await gfex.backfillGfexMemberRanking({ days: 5, force: true });
      out.gfexBackfill = {
        okDays: (bf.days || []).filter((d) => d.status === 'ok').length,
        version: bf.version,
      };
    }
  } catch (err) {
    out.gfex = { status: 'failed', error: err.message };
  }
  try {
    const dce = require('./dce-portal-api-fetcher');
    if (!dce.isDcePortalConfigured?.()) {
      out.dce = { status: 'skipped', reason: 'awaiting_credentials' };
    } else {
      const { getAllCommodities } = require('./commodities-catalog');
      const dceIds = getAllCommodities()
        .filter((c) => String(c.exchangeId).toLowerCase() === 'dce')
        .map((c) => String(c.id).toLowerCase());
      const market = await dce.fetchDcePortalMarketBundle({
        varieties: dceIds.length ? dceIds : undefined,
        fetchWarehouse: false,
        fetchMemberPosi: true,
      });
      const ok = (market.memberPosi || []).filter((m) => m && !m.error && !m.empty).length;
      const miss = (market.memberPosi || [])
        .filter((m) => !m || m.error || m.empty)
        .map((m) => m?.varietyId)
        .filter(Boolean);
      out.dce = {
        status: market.configured === false ? 'skipped' : 'ok',
        tradeDate: market.tradeDate || null,
        ok,
        of: (market.memberPosi || []).length || dceIds.length,
        miss,
        version: market.version,
        errors: market.errors?.length || 0,
      };
    }
  } catch (err) {
    out.dce = { status: 'failed', error: err.message };
  }
  if (
    out.shfe?.status === 'failed' &&
    out.czce?.status === 'failed' &&
    out.gfex?.status === 'failed' &&
    (out.dce?.status === 'failed' || out.dce?.status === 'skipped')
  ) {
    out.status = 'failed';
  }
  return out;
}

async function syncGfexWarehouse({ dryRun, force }) {
  let gfex;
  try {
    gfex = require('./gfex-warehouse-fetcher');
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
  if (dryRun) {
    return { status: 'dry_run', varieties: gfex.FOCUS_VARIETIES, wouldScrape: true };
  }
  try {
    const result = await gfex.scrapeGfexWarehouseReceipts({
      deep: Boolean(force),
      lookbackDays: force ? 120 : 15,
      targetDays: force ? 80 : 10,
    });
    return {
      status: 'ok',
      daysFilled: result.daysFilled,
      endDate: result.endDate,
      version: result.version,
      errors: result.errors,
    };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

async function syncSectorFundamentals({ dryRun, force }) {
  if (dryRun) {
    return {
      status: 'dry_run',
      wouldFetch: ['lange-iron-port', 'em-base-metals-exchange', 'westmetall-lme'],
    };
  }
  const out = {};
  try {
    const lange = require('./lange-iron-port-fetcher');
    out.ironPort = await lange.scrapeLangeIronPortInventory({ limit: force ? 40 : 12 });
  } catch (err) {
    out.ironPort = { status: 'failed', error: err.message };
  }
  try {
    const em = require('./eastmoney-exchange-inventory');
    out.exchangeInventory = await em.syncAllExchangeInventoryProxies({ force });
  } catch (err) {
    out.exchangeInventory = { status: 'failed', error: err.message };
  }
  try {
    const lme = require('./lme-inventory-fetcher');
    const metals = force
      ? ['copper', 'aluminum', 'zinc', 'nickel', 'lead', 'tin']
      : ['copper', 'aluminum', 'zinc', 'nickel'];
    out.lmeInventory = { status: 'ok', metals: {} };
    for (const metal of metals) {
      try {
        const saved = await lme.saveLmeInventory({ metal });
        out.lmeInventory.metals[metal] = {
          status: 'ok',
          endDate: saved.payload?.endDate,
          rowCount: saved.payload?.rowCount,
          source: saved.payload?.source,
        };
      } catch (err) {
        out.lmeInventory.metals[metal] = { status: 'failed', error: err.message };
      }
    }
    const failN = Object.values(out.lmeInventory.metals).filter((x) => x.status === 'failed').length;
    if (failN === metals.length) out.lmeInventory.status = 'failed';
    else if (failN) out.lmeInventory.status = 'partial';
  } catch (err) {
    out.lmeInventory = { status: 'failed', error: err.message };
  }
  const failed = [out.ironPort, out.exchangeInventory, out.lmeInventory].some(
    (x) => x?.status === 'failed' || x?.error
  );
  const partial = [out.ironPort, out.exchangeInventory, out.lmeInventory].some(
    (x) => x?.status === 'partial'
  );
  return { status: failed ? 'partial' : partial ? 'partial' : 'ok', ...out };
}

async function syncTermStructure({ dryRun, force, tradingUpdatedIds = [] }) {
  const ids = [...TERM_P0];
  const toRefresh = [];
  for (const id of ids) {
    const termEnd = readSeriesEndDate(`term-structure/${id}-daily.json`);
    const { bars } = loadTradingBars(id);
    const tradingEnd = bars.length ? normDate(bars[bars.length - 1].date) : null;
    const stale = force || tradingUpdatedIds.includes(id) || isStale(termEnd, 1) || (tradingEnd && termEnd && tradingEnd > termEnd);
    if (stale) toRefresh.push(id);
  }
  if (!toRefresh.length) return { status: 'skipped', reason: 'fresh', instruments: ids };
  if (dryRun) return { status: 'dry_run', wouldRefresh: toRefresh };
  const { results } = await fetchAndSaveTermStructure({ force: true, instruments: toRefresh });
  return { status: 'ok', refreshed: toRefresh, results };
}

async function syncCrossMarketPrecious({ dryRun, force }) {
  const ends = ['comex-gc-daily.json', 'comex-si-daily.json', 'fred-london-silver-daily.json'].map((f) =>
    readSeriesEndDate(f)
  );
  const stale = force || ends.some((e) => isStale(e, 3));
  if (!stale) return { status: 'skipped', endDates: ends };
  if (dryRun) return { status: 'dry_run', endDates: ends };
  const result = await saveCrossMarketPreciousHistory({ force: true });
  return {
    status: 'ok',
    gc: { rows: result.gc.rowCount, end: result.gc.endDate },
    si: { rows: result.si.rowCount, end: result.si.endDate },
    londonSilver: { rows: result.londonSilver.rowCount, end: result.londonSilver.endDate },
  };
}

async function syncGldEtf({ dryRun, force }) {
  const end = readSeriesEndDate('precious-etf-holdings-daily.json');
  if (!force && !isStale(end, 4)) return { status: 'skipped', endDate: end };
  if (dryRun) return { status: 'dry_run', endDate: end };
  try {
    const { payload, jsonPath } = await savePreciousEtfHoldings();
    return { status: 'ok', file: jsonPath, rows: payload.rowCount, endDate: payload.endDate, source: payload.source };
  } catch (err) {
    return { status: 'failed', error: err.message, attempts: err.attempts };
  }
}

async function syncSlvEtf({ dryRun, force }) {
  const end = readSeriesEndDate('slv-etf-holdings-daily.json');
  if (!force && !isStale(end, 4)) return { status: 'skipped', endDate: end };
  if (dryRun) return { status: 'dry_run', endDate: end };
  try {
    const { payload, jsonPath } = await saveSlvEtfHoldings();
    return { status: 'ok', file: jsonPath, rows: payload.rowCount, endDate: payload.endDate, source: payload.source };
  } catch (err) {
    return { status: 'failed', error: err.message, attempts: err.attempts };
  }
}

function syncNewsTagged({ dryRun, force, skipWarehouse = true, skipFlash = false } = {}) {
  const csvPath = newsTagged.getNewsTaggedPath();
  if (!fs.existsSync(csvPath)) {
    return { status: 'skipped', reason: 'no_csv', csvPath };
  }

  if (dryRun) {
    const baseRows = newsTagged.parseCsv(fs.readFileSync(csvPath, 'utf8'));
    const { readInbox } = require('./flash-news-fetcher');
    const { isRelevantFlashCandidate } = require('./news-tag-expansion');
    const inbox = readInbox();
    const pending = (inbox.candidates || []).filter(
      (c) => c.status !== 'merged' && c.status !== 'rejected' && isRelevantFlashCandidate(c)
    );
    return {
      status: 'dry_run',
      csvPath,
      rowCount: baseRows.length,
      pendingFlash: pending.length,
      skipWarehouse,
      skipFlash,
      wouldRun: true,
    };
  }

  try {
    const report = runNewsTagExpansion({
      dryRun: false,
      skipWarehouse,
      skipFlash,
      skipGeopolitics: true,
      quiet: true,
    });
    const rowsAdded = report.delta?.rows2019Plus ?? report.delta?.rowsAdded ?? 0;
    return {
      status: rowsAdded > 0 || force ? 'ok' : 'skipped',
      reason: rowsAdded > 0 ? null : 'no_new_rows',
      csvPath: report.csvPath,
      before: report.before?.count,
      after: report.after?.count,
      rowsAdded,
      flash: report.steps?.flash,
      warehouseSkipped: skipWarehouse,
    };
  } catch (err) {
    return { status: 'failed', error: err.message, code: err.code };
  }
}

function syncGeopolitics({ dryRun, forceReload = false } = {}) {
  if (dryRun) {
    newsTagged.loadNewsTagged({ force: true });
    return { status: 'dry_run', newsRows: newsTagged.getRowCount?.() ?? 'n/a' };
  }
  newsTagged.loadNewsTagged({ force: true });
  const { payload, jsonPath } = saveGeopoliticsDailySeries({ forceReload: forceReload || true });
  return {
    status: 'ok',
    file: jsonPath,
    daysWithGeoNews: payload.daysWithGeoNews,
    endDate: payload.endDate,
  };
}

function buildInventory() {
  const activeIds = getSyncInstrumentIds({ activeOnly: true });
  const catalogCount = getAllCommodities().length;
  return {
    generatedAt: new Date().toISOString(),
    dataDir: getDataDir(),
    catalogInstruments: catalogCount,
    activeInstruments: activeIds.length,
    activeIds,
    types: DEFAULT_TYPES.map((t) => ({ id: t, ...TYPE_META[t] })),
    notAutomated: [
      { id: 'news_warehouse_backfill', reason: '仓单扩表噪声大；手动 npm run expand-news-tagged（无 --skip-warehouse' },
      { id: 'flash_news_merge', reason: '快讯 inbox 已并入 news_tagged 日更步骤' },
      { id: 'lme_inventory', reason: '已并入 sector_fundamentals（Westmetall 免费 scrape）' },
      { id: 'sector_fundamentals', reason: '周频为主；日更仍拉最新' },
      { id: 'tick_zip_convert', reason: '历史 tick 转换独立长跑任务' },
      { id: 'range_archive', reason: 'outlook 刷新后 archiveCompletedSessionsFromOutlook 自动写入' },
      { id: 'outlook_weights', reason: '生产权重 v1.34.8 不随日更改变' },
    ],
  };
}

const INTRADAY_P0 = ['au', 'ag', 'rb', 'cu'];
const INTRADAY_TFS = ['hour', '15m', '5m'];
const INTRADAY_SCHEDULER_TFS = ['hour', '5m'];

function getOutlookIntradayInstrumentIds() {
  return INSTRUMENT_REGISTRY.map((s) => String(s.id).toLowerCase());
}

function intradayKlineKey(instrumentId, tf) {
  return `klines/commodity-${String(instrumentId).toLowerCase()}-${tf}.json`;
}

function readIntradayKlines(instrumentId, tf) {
  const stored = diskCache.readStale(intradayKlineKey(instrumentId, tf));
  return stored?.data?.klines || [];
}

async function syncIntradayKlines({
  dryRun = false,
  force = false,
  instrumentIds = null,
  timeframes = null,
  rateMs = 280,
  allOutlook = false,
} = {}) {
  const ids = instrumentIds || (allOutlook ? getOutlookIntradayInstrumentIds() : INTRADAY_P0);
  const tfs = timeframes || INTRADAY_TFS;
  const results = [];
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    for (const tf of tfs) {
      const klines = readIntradayKlines(id, tf);
      const last = klines.length ? normDate(klines[klines.length - 1].date) : null;
      const stale = force || isStale(last, 0);
      if (!stale) {
        skipped += 1;
        results.push({ id, tf, status: 'skipped', lastDate: last, bars: klines.length });
        continue;
      }
      if (dryRun) {
        results.push({ id, tf, status: 'dry_run', lastDate: last, bars: klines.length });
        continue;
      }
      try {
        // 5m/15m/hour：合并增量，禁止 force 全量覆盖（否则会冲掉 tick 长历史）
        let data;
        if (tf === '5m' || tf === '15m' || tf === 'hour') {
          data = await refreshCommodityKline(id, tf, klines);
        } else {
          data = await fetchCommodityHistory(id, tf, { force: true });
        }
        fetched += 1;
        results.push({
          id,
          tf,
          status: 'ok',
          bars: data.klines?.length || 0,
          source: data.source,
          endDate: data.klines?.length ? normDate(data.klines[data.klines.length - 1].date) : null,
        });
      } catch (err) {
        failed += 1;
        results.push({ id, tf, status: 'failed', error: err.message });
      }
      await new Promise((r) => setTimeout(r, rateMs));
    }
  }

  return {
    status: failed ? 'partial' : 'ok',
    fetched,
    skipped,
    failed,
    results,
  };
}

async function runDailyDataSync(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const trigger = options.trigger || 'manual';
  const types = (options.types && options.types.length ? options.types : DEFAULT_TYPES).filter((t) =>
    DEFAULT_TYPES.includes(t)
  );
  const instrumentIds = options.instrumentIds || null;

  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或数据盘不可写');

  diskCache.init(getUserDataDir() || dataDir);

  if (!dryRun) {
    const lock = acquireLock(trigger);
    if (!lock.ok) {
      return { ok: false, skipped: true, reason: lock.reason, lock: lock.lock };
    }
  }

  const startedAt = Date.now();
  const steps = {};
  let tradingUpdatedIds = [];

  try {
    if (types.includes('fred_macro')) {
      steps.fred_macro = await syncFredMacro({ dryRun, force });
    }
    if (types.includes('cnh')) {
      steps.cnh = await syncCnh({ dryRun, force });
    }
    if (types.includes('trading_klines')) {
      steps.trading_klines = await syncTradingKlines({ dryRun, instrumentIds });
    }
    if (types.includes('trading_json')) {
      steps.trading_json = await syncTradingJson({ dryRun, instrumentIds });
      tradingUpdatedIds = (steps.trading_json.results || [])
        .filter((r) => r.added > 0)
        .map((r) => r.id);
    }
    if (types.includes('commodity_oi')) {
      steps.commodity_oi = await syncCommodityOi({ dryRun, instrumentIds });
    }
    if (types.includes('warehouse')) {
      steps.warehouse = await syncWarehouse({ dryRun, force });
    }
    if (types.includes('dce_warehouse')) {
      steps.dce_warehouse = await syncDceWarehouse({ dryRun, force });
    }
    if (types.includes('czce_warehouse')) {
      steps.czce_warehouse = await syncCzceWarehouse({ dryRun, force });
    }
    if (types.includes('member_ranking')) {
      steps.member_ranking = await syncMemberRanking({ dryRun, force });
    }
    if (types.includes('gfex_warehouse')) {
      steps.gfex_warehouse = await syncGfexWarehouse({ dryRun, force });
    }
    if (types.includes('sector_fundamentals')) {
      steps.sector_fundamentals = await syncSectorFundamentals({ dryRun, force });
    }
    if (types.includes('term_structure')) {
      steps.term_structure = await syncTermStructure({ dryRun, force, tradingUpdatedIds });
    }
    if (types.includes('cross_market_precious')) {
      steps.cross_market_precious = await syncCrossMarketPrecious({ dryRun, force });
    }
    if (types.includes('gld_etf')) {
      steps.gld_etf = await syncGldEtf({ dryRun, force });
    }
    if (types.includes('slv_etf')) {
      steps.slv_etf = await syncSlvEtf({ dryRun, force });
    }
    let chainGeopolitics = false;
    if (types.includes('news_tagged')) {
      steps.news_tagged = syncNewsTagged({ dryRun, force, skipWarehouse: true });
      chainGeopolitics = !dryRun && steps.news_tagged?.status !== 'failed';
    }
    const runGeopolitics =
      types.includes('geopolitics') || chainGeopolitics;
    if (runGeopolitics) {
      steps.geopolitics = syncGeopolitics({
        dryRun,
        forceReload: chainGeopolitics || force,
      });
    }

    const summary = {
      ok: true,
      dryRun,
      force,
      trigger,
      date: todayKey(),
      dataDir,
      durationMs: Date.now() - startedAt,
      types,
      activeInstruments: getSyncInstrumentIds({ activeOnly: true }).length,
      steps,
    };

    if (!dryRun) {
      saveState({
        lastRunAt: new Date().toISOString(),
        lastSuccessDate: todayKey(),
        lastTrigger: trigger,
        lastDurationMs: summary.durationMs,
        lastTypes: types,
      });
      appendLog(summary);
    }

    return summary;
  } catch (err) {
    const fail = {
      ok: false,
      dryRun,
      trigger,
      error: err.message,
      durationMs: Date.now() - startedAt,
      steps,
    };
    if (!dryRun) appendLog(fail);
    throw err;
  } finally {
    if (!dryRun) releaseLock();
  }
}

module.exports = {
  DEFAULT_TYPES,
  TYPE_META,
  INTRADAY_P0,
  INTRADAY_TFS,
  INTRADAY_SCHEDULER_TFS,
  getOutlookIntradayInstrumentIds,
  buildInventory,
  shouldRunToday,
  runDailyDataSync,
  syncIntradayKlines,
  syncKlinesToTrading,
  getSyncInstrumentIds,
  syncGeopolitics,
  syncNewsTagged,
  readIntradayKlines,
  intradayKlineKey,
  isStale,
  tradingDaysBetween,
};
