/**
 * 日收盘价权威同步 '全品'domestic + COMEX/London 外盘
 * 落盘: data/closing-prices/{date}.json + klines + history/trading
 */
const fs = require('fs');
const path = require('path');
const diskCache = require('./disk-cache');
const { getDataDir, getUserDataDir } = require('./data-paths');
const cnSession = require('./cn-futures-session-calendar');
const { getAllCommodities } = require('./commodities-catalog');
const { fetchCommodityHistory } = require('./commodities-history-fetcher');
const { saveCrossMarketPreciousHistory } = require('./cross-market-precious-fetcher');
const {
  syncKlinesToTrading,
  isStale,
  getSyncInstrumentIds,
} = require('./daily-data-sync');

const STATE_FILE = 'daily-close-sync-state.json';
const LOG_FILE = 'daily-close-sync.jsonl';
const RECENT_BACKFILL_DAYS = 5;

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function todayCloseFileComplete(minRecords = 50) {
  const stored = readClosingPrices(todayKey());
  return (stored?.records?.length || 0) >= minRecords;
}

function historyDir() {
  const dataDir = getDataDir();
  return dataDir ? path.join(dataDir, 'history') : null;
}

function closingPricesDir() {
  const dataDir = getDataDir();
  return dataDir ? path.join(dataDir, 'closing-prices') : null;
}

function closingPriceFile(dateKey = todayKey()) {
  return path.join(closingPricesDir() || '', `${dateKey}.json`);
}

function statePath() {
  return path.join(historyDir() || '', STATE_FILE);
}

function logPath() {
  return path.join(historyDir() || '', LOG_FILE);
}

function readJsonSafe(fp, fallback = null) {
  try {
    if (fp && fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
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
  const fp = logPath();
  if (!fp) return;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.appendFileSync(fp, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
}

function readState() {
  return readJsonSafe(statePath(), { waves: {}, lastStartupDate: null, lastSuccessAt: null });
}

function saveState(patch) {
  const fp = statePath();
  if (!fp) return;
  const prev = readState();
  writeJson(fp, { ...prev, ...patch, updatedAt: new Date().toISOString() });
}

function klineKey(instrumentId) {
  return `klines/commodity-${String(instrumentId).toLowerCase()}-day.json`;
}

function readKlines(instrumentId) {
  const stored = diskCache.readStale(klineKey(instrumentId));
  return stored?.data?.klines || [];
}

function barCloseRecord(instrumentId, bar, source = 'klines') {
  const close = Number(bar?.close ?? bar?.price);
  if (!close || close <= 0 || Number.isNaN(close)) return null;
  const settleRaw = bar?.settle ?? bar?.settlement;
  const settle = settleRaw != null && !Number.isNaN(Number(settleRaw)) ? Number(settleRaw) : null;
  return {
    instrumentId: String(instrumentId).toLowerCase(),
    tradeDate: normDate(bar.date),
    close,
    settle,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

function ensureDiskCacheReady() {
  if (!diskCache.getRoot?.()) initDiskCache();
}

function getLatestBarClose(instrumentId) {
  ensureDiskCacheReady();
  const bars = readKlines(instrumentId);
  if (!bars.length) return null;
  return barCloseRecord(instrumentId, bars[bars.length - 1]);
}

function readClosingPrices(dateKey = todayKey()) {
  return readJsonSafe(closingPriceFile(dateKey));
}

function writeClosingPrices(dateKey, records, meta = {}) {
  const dir = closingPricesDir();
  if (!dir) return null;
  const payload = {
    tradeDate: dateKey,
    updatedAt: new Date().toISOString(),
    recordCount: records.length,
    ...meta,
    records,
  };
  writeJson(closingPriceFile(dateKey), payload);
  return closingPriceFile(dateKey);
}

function mergeRecordsIntoDailyFile(records, meta = {}) {
  const byId = new Map();
  const existing = readClosingPrices(todayKey());
  for (const rec of existing?.records || []) {
    if (rec?.instrumentId && rec.close > 0) byId.set(rec.instrumentId, rec);
  }
  for (const rec of records) {
    if (!rec?.instrumentId || !rec.tradeDate || !(rec.close > 0)) continue;
    byId.set(rec.instrumentId, rec);
  }
  const mergedRecords = [...byId.values()].sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
  const tradeDates = [...new Set(mergedRecords.map((r) => r.tradeDate))].sort();
  const primaryDate = tradeDates[tradeDates.length - 1] || todayKey();
  writeClosingPrices(primaryDate, mergedRecords, meta);
  return { primaryDate, count: mergedRecords.length };
}

function lookupCloseRecord(instrumentId, tradeDate = null) {
  const id = String(instrumentId).toLowerCase();
  if (tradeDate) {
    const stored = readClosingPrices(tradeDate);
    const hit = stored?.records?.find((r) => r.instrumentId === id);
    if (hit?.close > 0) return hit;
  }
  return getLatestBarClose(id);
}

function isMarketSessionLive(cnParts = cnSession.getCnNowParts()) {
  const { hour, minute } = cnParts;
  const nowMin = hour * 60 + minute;
  if (nowMin >= 9 * 60 && nowMin < 15 * 60) return true;
  if (nowMin >= 21 * 60 || nowMin < 2 * 60 + 30) return true;
  return false;
}

function resolveDisplayPrice(instrumentId, liveQuote = null) {
  ensureDiskCacheReady();
  const id = String(instrumentId).toLowerCase();
  const cn = cnSession.getCnNowParts();
  const afterDayClose = cnSession.isAfterDaySessionClose(cn);
  const latest = getLatestBarClose(id);
  const livePrice =
    liveQuote?.price != null && !Number.isNaN(Number(liveQuote.price)) ? Number(liveQuote.price) : null;
  const liveAvailable = liveQuote?.available !== false && livePrice != null && livePrice > 0;

  if (liveAvailable && isMarketSessionLive(cn)) {
    return {
      price: livePrice,
      changePct: liveQuote.changePct ?? null,
      priceReason: null,
      closingPrice: latest?.close ?? null,
      closingDate: latest?.tradeDate ?? null,
      isLive: true,
    };
  }

  if (latest?.close > 0) {
    let changePct = liveQuote?.changePct ?? null;
    if (changePct == null) {
      const bars = readKlines(id);
      if (bars.length >= 2) {
        const prev = Number(bars[bars.length - 2].close);
        if (prev > 0) changePct = +(((latest.close - prev) / prev) * 100).toFixed(4);
      }
    }
    return {
      price: latest.close,
      changePct,
      priceReason: afterDayClose ? '收盘' : '昨收',
      closingPrice: latest.close,
      closingDate: latest.tradeDate,
      isLive: false,
    };
  }

  if (livePrice != null) {
    return {
      price: livePrice,
      changePct: liveQuote.changePct ?? null,
      priceReason: liveQuote.available === false ? '报价不可' : null,
      closingPrice: null,
      closingDate: null,
      isLive: true,
    };
  }

  return {
    price: null,
    changePct: null,
    priceReason: '暂无报价',
    closingPrice: null,
    closingDate: null,
    isLive: false,
  };
}

function loadIntlCloseSeries() {
  const hist = historyDir();
  if (!hist) return {};
  const readSeries = (file) => {
    const raw = readJsonSafe(path.join(hist, file));
    const series = raw?.series || raw?.data || [];
    const last = series[series.length - 1];
    if (!last) return null;
    const close = Number(last.value ?? last.close);
    if (!close || close <= 0) return null;
    return {
      id: file.replace('-daily.json', ''),
      tradeDate: normDate(last.date),
      close,
      source: raw?.source || file,
      fetchedAt: raw?.updatedAt || raw?.fetchedAt || null,
    };
  };
  return {
    comexGc: readSeries('comex-gc-daily.json'),
    comexSi: readSeries('comex-si-daily.json'),
    londonSilver: readSeries('fred-london-silver-daily.json'),
  };
}

function needsInstrumentRefresh(id, { force = false, maxLagDays = 1 } = {}) {
  if (force) return true;
  const latest = getLatestBarClose(id);
  if (!latest?.tradeDate) return true;
  return isStale(latest.tradeDate, maxLagDays);
}

async function syncInstrumentDailyClose(id, { force = false, rateMs = 220 } = {}) {
  const lower = String(id).toLowerCase();
  if (!force && !needsInstrumentRefresh(lower)) {
    const latest = getLatestBarClose(lower);
    return { id: lower, status: 'skipped', lastDate: latest?.tradeDate || null, close: latest?.close || null };
  }

  const data = await fetchCommodityHistory(lower, 'day', { force: true });
  const bars = data.klines || [];
  const lastBar = bars[bars.length - 1];
  const record = lastBar ? barCloseRecord(lower, lastBar, data.source || 'eastmoney') : null;
  if (record) {
    mergeRecordsIntoDailyFile([record], { trigger: 'instrument', source: data.source });
  }
  syncKlinesToTrading(lower);
  return {
    id: lower,
    status: 'ok',
    bars: bars.length,
    endDate: record?.tradeDate || null,
    close: record?.close || null,
    source: data.source,
  };
}

async function syncCrossMarketCloses({ force = false } = {}) {
  const intl = loadIntlCloseSeries();
  const stale =
    force ||
    ['comexGc', 'comexSi', 'londonSilver'].some((k) => {
      const end = intl[k]?.tradeDate;
      return !end || isStale(end, 2);
    });
  if (!stale) {
    return { status: 'skipped', intl };
  }
  const result = await saveCrossMarketPreciousHistory({ force: true });
  const refreshed = loadIntlCloseSeries();
  const intlRecords = [];
  if (refreshed.comexGc) {
    intlRecords.push({
      instrumentId: 'comex_gc',
      tradeDate: refreshed.comexGc.tradeDate,
      close: refreshed.comexGc.close,
      settle: null,
      source: 'comex-gc-daily',
      fetchedAt: new Date().toISOString(),
    });
  }
  if (refreshed.comexSi) {
    intlRecords.push({
      instrumentId: 'comex_si',
      tradeDate: refreshed.comexSi.tradeDate,
      close: refreshed.comexSi.close,
      settle: null,
      source: 'comex-si-daily',
      fetchedAt: new Date().toISOString(),
    });
  }
  if (refreshed.londonSilver) {
    intlRecords.push({
      instrumentId: 'london_silver',
      tradeDate: refreshed.londonSilver.tradeDate,
      close: refreshed.londonSilver.close,
      settle: null,
      source: 'fred-london-silver',
      fetchedAt: new Date().toISOString(),
    });
  }
  if (intlRecords.length) mergeRecordsIntoDailyFile(intlRecords, { trigger: 'cross_market' });
  return { status: 'ok', gc: result.gc, si: result.si, londonSilver: result.londonSilver, intl: refreshed };
}

async function syncDailyCloses({
  dryRun = false,
  force = false,
  instrumentIds = null,
  includeCrossMarket = true,
  rateMs = 220,
  trigger = 'manual',
} = {}) {
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或数据盘不可写');
  diskCache.init(getUserDataDir() || dataDir);

  let ids = instrumentIds || getAllCommodities().map((c) => c.id);
  if (!ids.length) {
    ids = getSyncInstrumentIds({ activeOnly: false });
  }
  if (dryRun) {
    const pending = ids.filter((id) => needsInstrumentRefresh(id, { force }));
    return { ok: true, dryRun: true, trigger, pending: pending.length, total: ids.length };
  }

  const startedAt = Date.now();
  const results = [];
  const records = [];
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const r = await syncInstrumentDailyClose(id, { force, rateMs });
      results.push(r);
      if (r.status === 'ok') {
        fetched += 1;
        if (r.close != null) {
          records.push({
            instrumentId: r.id,
            tradeDate: r.endDate,
            close: r.close,
            settle: null,
            source: r.source || 'daily-close-sync',
            fetchedAt: new Date().toISOString(),
          });
        }
      } else skipped += 1;
    } catch (err) {
      failed += 1;
      results.push({ id, status: 'failed', error: err.message });
    }
    await new Promise((r) => setTimeout(r, rateMs));
  }

  let crossMarket = null;
  if (includeCrossMarket) {
    try {
      crossMarket = await syncCrossMarketCloses({ force });
    } catch (err) {
      crossMarket = { status: 'failed', error: err.message };
    }
  }

  if (records.length) {
    mergeRecordsIntoDailyFile(records, { trigger, fetched, skipped, failed });
  }

  const summary = {
    ok: failed === 0,
    trigger,
    date: todayKey(),
    durationMs: Date.now() - startedAt,
    instrumentCount: ids.length,
    fetched,
    skipped,
    failed,
    crossMarket,
  };

  appendLog(summary);
  saveState({
    lastSuccessAt: new Date().toISOString(),
    lastTrigger: trigger,
    lastFetched: fetched,
    lastSkipped: skipped,
    lastFailed: failed,
  });

  try {
    const engine = require('./commodity-outlook-engine');
    engine.invalidateOutlookDiskCache?.();
  } catch {
    // non-fatal
  }

  return { ...summary, results };
}

async function backfillRecentCloses({ days = RECENT_BACKFILL_DAYS, instrumentIds = null } = {}) {
  return syncDailyCloses({
    force: true,
    instrumentIds,
    includeCrossMarket: true,
    trigger: 'startup-backfill',
    rateMs: 200,
  });
}

function initDiskCache() {
  const dataDir = getDataDir();
  if (!dataDir) return false;
  diskCache.init(getUserDataDir() || dataDir);
  return true;
}

module.exports = {
  RECENT_BACKFILL_DAYS,
  normDate,
  todayKey,
  todayCloseFileComplete,
  readKlines,
  getLatestBarClose,
  lookupCloseRecord,
  resolveDisplayPrice,
  loadIntlCloseSeries,
  readClosingPrices,
  mergeRecordsIntoDailyFile,
  syncInstrumentDailyClose,
  syncCrossMarketCloses,
  syncDailyCloses,
  syncAllDailyCloses: syncDailyCloses,
  backfillRecentCloses,
  needsInstrumentRefresh,
  initDiskCache,
  ensureDiskCacheReady,
  readState,
  saveState,
  getOutlookInstrumentIds: () => getAllCommodities().map((c) => c.id),
};
