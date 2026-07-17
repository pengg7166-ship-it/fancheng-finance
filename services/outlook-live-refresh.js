/**
 * 大宗走势研判 · 盘中实时刷新调度
 * - 行情：盘中每 90s 拉新浪报价并 patch outlook 现价 + pilot 交易指导
 * - 研判：盘中每 5min 部分/全量重算
 */
const fs = require('fs');
const path = require('path');
const { getLogsDir } = require('./data-paths');
const cnSession = require('./cn-futures-session-calendar');
const { fetchCommoditiesLive } = require('./commodities-fetcher');
const { normalizeCommodityId } = require('./policy-commodity-map');
const {
  getCachedCommodityOutlookSource,
  patchOutlookPricesFromCommodities,
  refreshOutlookForPushCycle,
  invalidateOutlookDiskCache,
} = require('./commodity-outlook-engine');

const LOG_FILE = 'outlook-live-refresh.jsonl';
const QUOTE_INTERVAL_MS = 60 * 1000;
const OUTLOOK_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_PROBE_MS = 10 * 60 * 1000;
const QUOTE_DRIFT_INVALIDATE_PCT = 0.003;

let quoteTimer = null;
let outlookTimer = null;
let sessionProbeTimer = null;
let quoteBusy = false;
let outlookBusy = false;
let hooks = {};
let lastQuoteRefreshAt = null;
let lastOutlookRefreshAt = null;
let cycleCount = 0;

function logPath() {
  const logsDir = getLogsDir();
  return logsDir ? path.join(logsDir, LOG_FILE) : null;
}

function appendLog(entry) {
  const fp = logPath();
  if (!fp) return;
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.appendFileSync(fp, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
  } catch (err) {
    console.warn('[outlook-live-refresh] log write failed:', err?.message || err);
  }
}

function isMarketSessionLive(now = new Date()) {
  const { hour, minute } = cnSession.getCnNowParts(now);
  const nowMin = hour * 60 + minute;
  if (nowMin >= 9 * 60 && nowMin < 11 * 60 + 30) return true;
  if (nowMin >= 13 * 60 + 30 && nowMin < 15 * 60) return true;
  if (nowMin >= 21 * 60 || nowMin < 2 * 60 + 30) return true;
  return false;
}

function buildCommodityQuoteMap(commodities) {
  const map = new Map();
  if (!commodities?.exchanges?.length) return map;
  for (const ex of commodities.exchanges) {
    for (const item of ex.items || []) {
      if (item?.id != null) map.set(normalizeCommodityId(item.id), item);
    }
  }
  return map;
}

function countQuotedInstruments(commodities) {
  if (!commodities?.exchanges?.length) return 0;
  return commodities.exchanges.reduce(
    (n, ex) => n + (ex.items || []).filter((i) => i.price != null && !Number.isNaN(Number(i.price))).length,
    0
  );
}

function sampleInstrumentPrice(commodities, id) {
  const q = buildCommodityQuoteMap(commodities).get(normalizeCommodityId(id));
  return q?.price != null ? Number(q.price) : null;
}

function outlookNeedsDriftRecompute(cached, commodities) {
  if (!cached?.instruments?.length || !commodities?.exchanges?.length) return false;
  const quoteMap = buildCommodityQuoteMap(commodities);
  return cached.instruments.some((inst) => {
    const q = quoteMap.get(normalizeCommodityId(inst.id));
    if (q?.price == null || inst.price == null) return false;
    const live = Number(q.price);
    const baseline =
      inst.highLowPrediction?.baselineClose ??
      inst.nextDayRange?.baselineClose ??
      Number(inst.price);
    if (!baseline || baseline <= 0) return false;
    return Math.abs(live - baseline) / baseline > QUOTE_DRIFT_INVALIDATE_PCT;
  });
}

async function runQuoteCycle(options = {}) {
  const force = options.force === true;
  if ((!isMarketSessionLive() && !force) || quoteBusy) return null;
  quoteBusy = true;
  const started = Date.now();
  try {
    const commodities = await fetchCommoditiesLive({ force: true });
    const quoted = countQuotedInstruments(commodities);
    if (!quoted) {
      appendLog({ phase: 'quotes', ok: false, reason: 'no-quotes', durationMs: Date.now() - started });
      return null;
    }

    const { patchSourceInCache } = require('./data-fetcher');
    patchSourceInCache('commodities', commodities, { notifyOutlook: false });

    const cached = getCachedCommodityOutlookSource();
    let outlook = cached;
    if (cached) {
      outlook =
        patchOutlookPricesFromCommodities(cached, commodities, {
          forceStamp: true,
          skipGuidanceRefresh: true,
        }) || cached;
    }

    const liveRefreshedAt = outlook?.liveRefreshedAt || commodities.fetchedAt || new Date().toISOString();
    lastQuoteRefreshAt = liveRefreshedAt;
    cycleCount += 1;

    const payload = {
      commodities,
      outlook,
      liveRefreshedAt,
      quotedCount: quoted,
      cycle: cycleCount,
    };

    hooks.onQuotesUpdated?.(payload);

    appendLog({
      phase: 'quotes',
      ok: true,
      cycle: cycleCount,
      quotedCount: quoted,
      fgPrice: sampleInstrumentPrice(commodities, 'FG'),
      liveRefreshedAt,
      durationMs: Date.now() - started,
    });

    return payload;
  } catch (err) {
    appendLog({
      phase: 'quotes',
      ok: false,
      error: err?.message || String(err),
      durationMs: Date.now() - started,
    });
    return null;
  } finally {
    quoteBusy = false;
  }
}

async function runOutlookCycle(options = {}) {
  const force = options.force === true;
  if ((!isMarketSessionLive() && !force) || outlookBusy) return null;
  outlookBusy = true;
  const started = Date.now();
  try {
    const commodities = await fetchCommoditiesLive({ force: true });
    const quoted = countQuotedInstruments(commodities);
    if (!quoted) {
      appendLog({ phase: 'outlook', ok: false, reason: 'no-quotes', durationMs: Date.now() - started });
      return null;
    }

    const { patchSourceInCache, getCachedAllData } = require('./data-fetcher');
    patchSourceInCache('commodities', commodities, { notifyOutlook: false });

    const cached = getCachedCommodityOutlookSource();
    if (cached && outlookNeedsDriftRecompute(cached, commodities)) {
      invalidateOutlookDiskCache();
      appendLog({ phase: 'outlook', action: 'invalidate-drift' });
    }

    const sources = { ...(getCachedAllData()?.sources || {}), commodities };
    const outlook = await refreshOutlookForPushCycle(sources);
    if (!outlook?.instruments?.length && !outlook?.categories?.length) {
      appendLog({ phase: 'outlook', ok: false, reason: 'empty-payload', durationMs: Date.now() - started });
      return null;
    }

    const liveRefreshedAt = outlook.liveRefreshedAt || new Date().toISOString();
    lastOutlookRefreshAt = liveRefreshedAt;

    const payload = {
      ...outlook,
      liveRefreshedAt,
      commodities,
      cycle: cycleCount,
    };
    hooks.onOutlookUpdated?.(payload);

    appendLog({
      phase: 'outlook',
      ok: true,
      instrumentCount: outlook.instruments?.length || 0,
      fgPrice: sampleInstrumentPrice(commodities, 'FG'),
      liveRefreshedAt,
      durationMs: Date.now() - started,
    });

    return payload;
  } catch (err) {
    appendLog({
      phase: 'outlook',
      ok: false,
      error: err?.message || String(err),
      durationMs: Date.now() - started,
    });
    return null;
  } finally {
    outlookBusy = false;
  }
}

function clearTimers() {
  if (quoteTimer) clearInterval(quoteTimer);
  if (outlookTimer) clearInterval(outlookTimer);
  if (sessionProbeTimer) clearInterval(sessionProbeTimer);
  quoteTimer = null;
  outlookTimer = null;
  sessionProbeTimer = null;
}

function scheduleActiveLoops() {
  clearTimers();
  setTimeout(() => void runQuoteCycle(), 5000);
  setTimeout(() => void runOutlookCycle(), 20000);
  quoteTimer = setInterval(() => void runQuoteCycle(), QUOTE_INTERVAL_MS);
  outlookTimer = setInterval(() => void runOutlookCycle(), OUTLOOK_INTERVAL_MS);
  appendLog({ phase: 'scheduler', action: 'started', quoteIntervalMs: QUOTE_INTERVAL_MS, outlookIntervalMs: OUTLOOK_INTERVAL_MS });
}

function startOutlookLiveRefresh(nextHooks = {}) {
  hooks = { ...hooks, ...nextHooks };
  clearTimers();

  if (!isMarketSessionLive()) {
    appendLog({ phase: 'scheduler', action: 'paused', reason: 'outside-session' });
    sessionProbeTimer = setInterval(() => {
      if (isMarketSessionLive()) scheduleActiveLoops();
    }, SESSION_PROBE_MS);
    return;
  }

  scheduleActiveLoops();
}

function stopOutlookLiveRefresh() {
  clearTimers();
  appendLog({ phase: 'scheduler', action: 'stopped' });
}

function getOutlookLiveRefreshStatus() {
  return {
    running: Boolean(quoteTimer || outlookTimer),
    inSession: isMarketSessionLive(),
    lastQuoteRefreshAt,
    lastOutlookRefreshAt,
    cycleCount,
  };
}

module.exports = {
  startOutlookLiveRefresh,
  stopOutlookLiveRefresh,
  runQuoteCycle,
  runOutlookCycle,
  isMarketSessionLive,
  getOutlookLiveRefreshStatus,
};
