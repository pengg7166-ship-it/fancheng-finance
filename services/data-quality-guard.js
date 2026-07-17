/**
 * Central data-quality orchestrator 'timeliness, completeness, authenticity.
 * Reuses live fetch/compare logic (not file-existence-only stubs).
 */
const fs = require('fs');
const path = require('path');
const diskCache = require('./disk-cache');
const { getDataDir, getUserDataDir, getAppDir } = require('./data-paths');
const dailyClose = require('./daily-close-sync');
const { isStale } = require('./daily-data-sync');
const cnSession = require('./cn-futures-session-calendar');
const { getAllCommodities } = require('./commodities-catalog');
const { fetchCommodityHistory } = require('./commodities-history-fetcher');
const priceTick = require('./price-tick');
const rangeArchive = require('./range-prediction-archive');
const { getOutlookHistoryRoot } = require('./commodity-outlook-history');
const { getCachedCommodityOutlookSource } = require('./commodity-outlook-engine');
const { outlookCacheIsStale, readOutlookCacheData } = require('./startup-data-heal');
const {
  hasOutlookVolatilityForecast,
  getInstrumentBaselineDate,
  auditPctVolatilityForecast,
} = require('./outlook-prediction-utils');
const { readCachedKlines } = require('./commodity-technical-analyzer');

const EXPECTED_INSTRUMENT_COUNT = 74;
/** Delisted / halted 'excluded from freshness lag checks (67 active). */
const DORMANT_INSTRUMENTS = new Set(['wr', 'wh', 'pm', 'ri', 'lr', 'jr', 'zc']);
const ACTIVE_INSTRUMENT_COUNT = EXPECTED_INSTRUMENT_COUNT - DORMANT_INSTRUMENTS.size;
const ACCURACY_SAMPLE = ['au', 'fg', 'cu', 'rb', 'al', 'sc'];
const CHEMICAL_SANITY_IDS = new Set(['fg', 'ma', 'ta']);
const FG_MAX_BAND_SPREAD = 20;
const INTL_MAX_LAG_DAYS = 3;
const CLOSE_MAX_LAG_DAYS = 2;
const KLINE_5M_MAX_LAG_DAYS = 3;

const PRODUCTION_MODULES = [
  'services/daily-close-scheduler.js',
  'services/chemical-range-calibration.js',
  'services/startup-data-heal.js',
  'services/data-quality-guard.js',
  'services/data-quality-heal.js',
];

function initContext() {
  const dataDir = getDataDir();
  if (!dataDir) return { ok: false, error: 'no_data_dir' };
  diskCache.init(getUserDataDir() || dataDir);
  dailyClose.initDiskCache();
  return { ok: true, dataDir };
}

function makeCheck(id, name, severity, passed, details = {}, extra = {}) {
  return {
    id,
    name,
    severity,
    passed: !!passed,
    ok: !!passed,
    details,
    ...extra,
  };
}

function dominantLatestCloseDate(catalog) {
  const counts = new Map();
  for (const c of catalog) {
    const id = String(c.id).toLowerCase();
    if (DORMANT_INSTRUMENTS.has(id)) continue;
    const latest = dailyClose.getLatestBarClose(c.id);
    const d = latest?.tradeDate ? String(latest.tradeDate).slice(0, 10) : null;
    if (!d) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return { date: best, count: bestN };
}

function readLatestClosingFile() {
  const dir = path.join(getDataDir() || '', 'closing-prices');
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) return null;
  const latestFile = files[files.length - 1];
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, latestFile), 'utf8'));
    return {
      fileDate: latestFile.replace('.json', ''),
      tradeDate: String(payload.tradeDate || latestFile.replace('.json', '')).slice(0, 10),
      records: payload.records || [],
      updatedAt: payload.updatedAt || null,
    };
  } catch {
    return null;
  }
}

function readKlineLastBar(id, tf = 'day') {
  const key = `klines/commodity-${String(id).toLowerCase()}-${tf}.json`;
  const stored = diskCache.readStale(key);
  const bars = stored?.data?.klines || [];
  const last = bars[bars.length - 1];
  if (!last) return null;
  return {
    date: String(last.date).slice(0, 10),
    close: Number(last.close),
    barCount: bars.length,
  };
}

function isMarketHours(cn = cnSession.getCnNowParts()) {
  const { hour, minute } = cn;
  const nowMin = hour * 60 + minute;
  if (nowMin >= 9 * 60 && nowMin < 15 * 60) return true;
  if (nowMin >= 21 * 60 || nowMin < 2 * 60 + 30) return true;
  return false;
}

function checkClosingPriceFreshness() {
  const catalog = getAllCommodities();
  const dominant = dominantLatestCloseDate(catalog);
  const closingFile = readLatestClosingFile();
  const missing = [];
  const staleIds = [];
  const tipDates = [];

  for (const c of catalog) {
    const id = String(c.id).toLowerCase();
    if (DORMANT_INSTRUMENTS.has(id)) continue;
    const latest = dailyClose.getLatestBarClose(id);
    if (!latest?.tradeDate || !(latest.close > 0)) {
      missing.push(id);
      continue;
    }
    const tip = String(latest.tradeDate).slice(0, 10);
    tipDates.push(tip);
    if (isStale(tip, CLOSE_MAX_LAG_DAYS)) staleIds.push(id);
  }

  const fileRecords = closingFile?.records?.length || 0;
  const fileMatchDominant =
    closingFile?.tradeDate && dominant.date
      ? closingFile.tradeDate >= dominant.date || closingFile.tradeDate === dominant.date
      : false;
  const dominantFresh = dominant.date ? !isStale(dominant.date, CLOSE_MAX_LAG_DAYS) : false;
  const countOk = missing.length === 0 && dominant.count >= ACTIVE_INSTRUMENT_COUNT - 1;
  const fileOk = fileRecords >= ACTIVE_INSTRUMENT_COUNT - 1 && fileMatchDominant;
  const staleOk = staleIds.length === 0;

  // During partial day-bar publication, tips may split across T-1 and T.
  // If every tip is within lag and the span is ≤1 calendar day, treat as fresh consensus.
  const uniqueTips = [...new Set(tipDates)].sort();
  let tipSpanDays = null;
  if (uniqueTips.length >= 1) {
    tipSpanDays =
      (Date.parse(uniqueTips[uniqueTips.length - 1]) - Date.parse(uniqueTips[0])) / 86400000;
  }
  const closingFileFresh = closingFile?.tradeDate
    ? !isStale(String(closingFile.tradeDate).slice(0, 10), CLOSE_MAX_LAG_DAYS)
    : false;
  const tipSpreadOk =
    missing.length === 0 &&
    staleOk &&
    tipDates.length >= ACTIVE_INSTRUMENT_COUNT - 1 &&
    tipSpanDays != null &&
    tipSpanDays <= 1 &&
    fileRecords >= ACTIVE_INSTRUMENT_COUNT - 1 &&
    closingFileFresh;

  const passed = (countOk && dominantFresh && fileOk && staleOk) || tipSpreadOk;
  return makeCheck(
    'closing_price_freshness',
    '收盘价实时',
    'critical',
    passed,
    {
      expectedInstruments: EXPECTED_INSTRUMENT_COUNT,
      activeInstruments: ACTIVE_INSTRUMENT_COUNT,
      dormantExcluded: [...DORMANT_INSTRUMENTS],
      dominantDate: dominant.date,
      dominantCount: dominant.count,
      closingFileDate: closingFile?.tradeDate || null,
      closingFileRecords: fileRecords,
      missingCount: missing.length,
      missingSample: missing.slice(0, 8),
      staleCount: staleIds.length,
      staleSample: staleIds.slice(0, 8),
      tipSpanDays,
      tipDatesSample: uniqueTips,
      tipSpreadOk,
      maxLagDays: CLOSE_MAX_LAG_DAYS,
    }
  );
}

async function checkClosingPriceAccuracy({ skipNetwork = false } = {}) {
  if (skipNetwork) {
    return makeCheck('closing_price_accuracy', '收盘价真实(东财)', 'warning', true, { skipped: true });
  }

  const mismatches = [];
  const checked = [];

  for (const id of ACCURACY_SAMPLE) {
    const local = dailyClose.getLatestBarClose(id);
    let remote = null;
    let error = null;
    let compareMode = null;
    try {
      // persist:false — never rewrite day tips during accuracy probe (avoids splitting tip dates).
      const data = await fetchCommodityHistory(id, 'day', { force: true, persist: false });
      const bars = data.klines || [];
      const localDate = local?.tradeDate ? String(local.tradeDate).slice(0, 10) : null;
      // Prefer same-date bar: mid-session Eastmoney last bar can be T while disk still has T-1 close.
      // Comparing different dates is not a data-integrity failure.
      let bar = null;
      if (localDate) {
        bar = bars.find((b) => String(b.date).slice(0, 10) === localDate) || null;
        if (bar) compareMode = 'same_date';
      }
      if (!bar && bars.length) {
        bar = bars[bars.length - 1];
        compareMode = localDate && String(bar.date).slice(0, 10) !== localDate ? 'latest_only' : 'latest';
      }
      if (bar) {
        remote = {
          close: Number(bar.close),
          date: String(bar.date).slice(0, 10),
          source: data.source,
        };
      }
    } catch (err) {
      error = err.message;
    }

    const sameDate =
      local?.tradeDate &&
      remote?.date &&
      String(local.tradeDate).slice(0, 10) === String(remote.date).slice(0, 10);
    const delta =
      local?.close != null && remote?.close != null ? Math.abs(local.close - remote.close) : null;
    // Critical only when same-date closes disagree; date lag is handled by freshness checks.
    const match = sameDate ? delta != null && delta < 0.01 : true;
    const row = {
      id,
      localClose: local?.close ?? null,
      localDate: local?.tradeDate ?? null,
      remoteClose: remote?.close ?? null,
      remoteDate: remote?.date ?? null,
      delta: sameDate ? delta : null,
      compareMode,
      sameDate: !!sameDate,
      dateLagSkipped: !!(local && remote && !sameDate),
      error,
      ok: match,
    };
    checked.push(row);
    if (local && remote && sameDate && !match) mismatches.push(row);
  }

  return makeCheck(
    'closing_price_accuracy',
    '收盘价真实(东财)',
    'critical',
    mismatches.length === 0,
    {
      sampleSize: ACCURACY_SAMPLE.length,
      mismatchCount: mismatches.length,
      mismatches,
      checked,
    }
  );
}

function checkOutlookCacheFreshness() {
  const { data } = readOutlookCacheData();
  const dominant = dominantLatestCloseDate(getAllCommodities());
  const stale = outlookCacheIsStale(data);
  const withVolForecast = (data?.instruments || []).filter((i) => hasOutlookVolatilityForecast(i));
  const baselineMismatches = [];
  for (const inst of data?.instruments || []) {
    const latest = dailyClose.getLatestBarClose(inst.id);
    const baselineDate = getInstrumentBaselineDate(inst);
    if (!latest?.tradeDate || !baselineDate) continue;
    if (String(baselineDate).slice(0, 10) < String(latest.tradeDate).slice(0, 10)) {
      baselineMismatches.push(inst.id);
    }
  }

  const passed =
    !stale &&
    withVolForecast.length >= ACTIVE_INSTRUMENT_COUNT - 2 &&
    baselineMismatches.length === 0;

  return makeCheck(
    'outlook_cache_freshness',
    '研判缓存实时',
    'critical',
    passed,
    {
      instrumentCount: data?.instruments?.length || 0,
      withVolForecast: withVolForecast.length,
      withPrediction: withVolForecast.length,
      forecastMode: 'nextDayRangePct',
      updatedAt: data?.updatedAt || null,
      liveRefreshedAt: data?.liveRefreshedAt || null,
      stale,
      dominantCloseDate: dominant.date,
      baselineMismatchCount: baselineMismatches.length,
      baselineMismatchSample: baselineMismatches.slice(0, 8),
    }
  );
}

function auditInstrumentPrediction(inst) {
  const id = String(inst.id || '').toLowerCase();
  if (inst.outlookPending || inst.insufficientData) {
    return { id, flags: [], skipped: true };
  }
  const hl = inst.nextDayPrediction || inst.highLowPrediction || inst.nextDayRange;
  const hi = hl?.predictedHigh != null ? Number(hl.predictedHigh) : null;
  const lo = hl?.predictedLow != null ? Number(hl.predictedLow) : null;

  if (hi != null && lo != null) {
    const flags = [];
    const price = Number(inst.price);
    const base = hl?.baseClose ?? hl?.baseline ?? price;
    if (!priceTick.isValidTickPrice(id, hi)) flags.push({ code: 'tick_high', severity: 'critical', value: hi });
    if (!priceTick.isValidTickPrice(id, lo)) flags.push({ code: 'tick_low', severity: 'critical', value: lo });
    if (priceTick.looksLikePctBand(hi, lo, base)) {
      flags.push({ code: 'pct_as_price', severity: 'critical', hi, lo, base });
    }
    if (lo > hi) flags.push({ code: 'inverted_band', severity: 'critical', hi, lo });
    const spread = hi - lo;
    if (CHEMICAL_SANITY_IDS.has(id) && id === 'fg' && base > 500) {
      if (spread > FG_MAX_BAND_SPREAD) {
        flags.push({ code: 'fg_band_too_wide', severity: 'critical', spread, max: FG_MAX_BAND_SPREAD, base });
      }
    }
    return { id, flags, hi, lo, spread, mode: 'absolute' };
  }

  const pctAudit = auditPctVolatilityForecast(inst);
  return { ...pctAudit, mode: 'pct' };
}

function collectTickViolations() {
  const violations = [];
  const checkHL = (instrumentId, hi, lo, source) => {
    for (const [field, val] of [
      ['predictedHigh', hi],
      ['predictedLow', lo],
    ]) {
      if (val == null || Number.isNaN(Number(val))) continue;
      if (!priceTick.isValidTickPrice(instrumentId, val)) {
        violations.push({ instrumentId, field, value: val, source });
      }
    }
    if (hi != null && lo != null && lo > hi) {
      violations.push({ instrumentId, field: 'inverted', value: `${lo}>${hi}`, source });
    }
  };

  const cached = getCachedCommodityOutlookSource();
  for (const inst of cached?.instruments || []) {
    const id = String(inst.id).toLowerCase();
    const hl = inst.highLowPrediction || inst.nextDayRange || inst.nextDayPrediction;
    if (!hl) continue;
    checkHL(id, hl.predictedHigh, hl.predictedLow, 'outlook-cache');
  }

  for (const c of getAllCommodities()) {
    const id = String(c.id).toLowerCase();
    const lines = rangeArchive.readArchiveLines(id).filter((r) => r.predictionSlot);
    const latest = lines[lines.length - 1];
    if (!latest) continue;
    checkHL(id, latest.predHigh, latest.predLow, `archive:${id}`);
  }

  return violations;
}

function checkOutlookPredictionSanity() {
  const cached = getCachedCommodityOutlookSource();
  const instruments = cached?.instruments || [];
  const audited = instruments.map(auditInstrumentPrediction).filter((r) => !r.skipped);
  const criticalFlags = audited.flatMap((r) =>
    r.flags.filter((f) => f.severity === 'critical').map((f) => ({ id: r.id, ...f }))
  );
  const tickViolations = collectTickViolations();
  const passed = criticalFlags.length === 0 && tickViolations.length === 0;

  return makeCheck(
    'outlook_prediction_sanity',
    '预测波动情景',
    'critical',
    passed,
    {
      instrumentCount: instruments.length,
      forecastMode: 'nextDayRangePct',
      criticalFlagCount: criticalFlags.length,
      criticalFlags: criticalFlags.slice(0, 20),
      tickViolationCount: tickViolations.length,
      tickViolations: tickViolations.slice(0, 20),
      fgSample: audited.find((r) => r.id === 'fg') || null,
    }
  );
}

function checkDisplayPriceLogic() {
  const id = 'au';
  const latest = dailyClose.getLatestBarClose(id);
  if (!latest?.close) {
    return makeCheck('display_price_logic', '展示价逻辑', 'warning', false, { reason: 'no_local_close' });
  }

  const driftPrice = latest.close + (latest.close > 500 ? 5 : 0.5);
  const resolved = dailyClose.resolveDisplayPrice(id, { price: driftPrice, changePct: 0.1, available: true });
  const cn = cnSession.getCnNowParts();
  const afterClose = cnSession.isAfterDaySessionClose(cn);
  const inSession = isMarketHours(cn);

  let passed = true;
  let reason = null;
  if (afterClose && !inSession) {
    passed = !resolved.isLive && Math.abs(resolved.price - latest.close) < 0.01;
    if (!passed) reason = 'after_close_should_use_official_close';
  } else if (inSession) {
    passed = resolved.isLive === true;
    if (!passed) reason = 'in_session_should_use_live';
  } else {
    passed = Math.abs(resolved.price - latest.close) < 0.01;
    if (!passed) reason = 'off_hours_should_use_close';
  }

  return makeCheck(
    'display_price_logic',
    '展示价逻辑',
    'critical',
    passed,
    {
      instrument: id,
      afterDayClose: afterClose,
      inSession,
      expectedClose: latest.close,
      resolvedPrice: resolved.price,
      isLive: resolved.isLive,
      priceReason: resolved.priceReason,
      reason,
    }
  );
}

function checkKlineCompleteness() {
  const catalog = getAllCommodities();
  const dominant = dominantLatestCloseDate(catalog);
  const missingDay = [];
  const staleDay = [];
  const missing5m = [];
  const stale5m = [];
  const missingHour = [];
  const staleHour = [];

  for (const c of catalog) {
    const id = String(c.id).toLowerCase();
    if (DORMANT_INSTRUMENTS.has(id)) continue;
    const dayBar = readKlineLastBar(id, 'day');
    if (!dayBar) {
      missingDay.push(id);
      continue;
    }
    if (dominant.date && dayBar.date < dominant.date) staleDay.push({ id, date: dayBar.date });
    else if (isStale(dayBar.date, CLOSE_MAX_LAG_DAYS)) staleDay.push({ id, date: dayBar.date });

    const bar5m = readKlineLastBar(id, '5m');
    if (!bar5m) missing5m.push(id);
    else if (isStale(bar5m.date, KLINE_5M_MAX_LAG_DAYS)) stale5m.push({ id, date: bar5m.date });

    const barHour = readKlineLastBar(id, 'hour');
    if (!barHour) missingHour.push(id);
    else if (isStale(barHour.date, KLINE_5M_MAX_LAG_DAYS)) staleHour.push({ id, date: barHour.date });
  }

  const dayOk = missingDay.length === 0 && staleDay.length <= 2;
  const m5Ok = missing5m.length <= 5 && stale5m.length <= 10;
  const hourOk = missingHour.length <= 8 && staleHour.length <= 12;

  return makeCheck(
    'kline_completeness',
    'K线完整',
    missingDay.length > 5 ? 'critical' : 'warning',
    dayOk && m5Ok && hourOk,
    {
      dominantDate: dominant.date,
      missingDayCount: missingDay.length,
      staleDayCount: staleDay.length,
      missing5mCount: missing5m.length,
      stale5mCount: stale5m.length,
      missingHourCount: missingHour.length,
      staleHourCount: staleHour.length,
      missingDaySample: missingDay.slice(0, 8),
      staleDaySample: staleDay.slice(0, 8),
      staleHourSample: staleHour.slice(0, 8),
    }
  );
}

function checkIntlReferencesFreshness() {
  const intl = dailyClose.loadIntlCloseSeries();
  const stale = [];
  for (const [key, rec] of Object.entries(intl)) {
    if (!rec?.tradeDate) {
      stale.push({ key, reason: 'missing' });
      continue;
    }
    if (isStale(rec.tradeDate, INTL_MAX_LAG_DAYS)) {
      stale.push({ key, tradeDate: rec.tradeDate, close: rec.close });
    }
  }
  return makeCheck(
    'intl_references_freshness',
    '外盘参考实时',
    'warning',
    stale.length === 0,
    { intl, stale, maxLagDays: INTL_MAX_LAG_DAYS }
  );
}

function checkSlotSnapshots() {
  const histRoot = getOutlookHistoryRoot();
  const cn = cnSession.getCnNowParts();
  const afterFirstSlot = cn.hour > 9 || (cn.hour === 9 && cn.minute >= 30);
  if (!histRoot) {
    return makeCheck('slot_snapshots', '时段快照', afterFirstSlot ? 'warning' : 'info', !afterFirstSlot, {
      skipped: true,
      reason: 'no_outlook_history_root',
      sessionDate: cn.date,
      afterFirstSlot,
    });
  }
  const root = path.join(histRoot, 'slot-snapshots');
  const todayDir = path.join(root, cn.date);
  const files =
    fs.existsSync(todayDir) ? fs.readdirSync(todayDir).filter((f) => f.endsWith('.json')) : [];
  const passed = !afterFirstSlot || files.length > 0;

  return makeCheck(
    'slot_snapshots',
    '时段快照',
    afterFirstSlot && files.length === 0 ? 'warning' : 'info',
    passed,
    { sessionDate: cn.date, snapshotCount: files.length, afterFirstSlot, root }
  );
}

function normAsarEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function checkProductionModules({ packagedContext = false } = {}) {
  if (!packagedContext) {
    return makeCheck('production_modules', '生产模块', 'info', true, { skipped: true });
  }

  // Inside packaged Electron: modules are already loadable 'never chdir/walk app.asar.
  if (process.versions?.electron) {
    const missing = [];
    for (const rel of PRODUCTION_MODULES) {
      const local = path.join(__dirname, path.basename(rel));
      try {
        require.resolve(local);
      } catch {
        missing.push(rel);
      }
    }
    return makeCheck(
      'production_modules',
      '生产模块',
      'warning',
      missing.length === 0,
      { mode: 'require_resolve', missing }
    );
  }

  const appDir = getAppDir();
  const asarPath = appDir ? path.join(appDir, 'resources', 'app.asar') : null;
  if (!asarPath || !fs.existsSync(asarPath)) {
    return makeCheck('production_modules', '生产模块', 'warning', false, { reason: 'asar_not_found', asarPath });
  }
  let asarLib;
  try {
    asarLib = require('@electron/asar');
  } catch {
    return makeCheck('production_modules', '生产模块', 'warning', false, { reason: 'asar_lib_missing' });
  }
  const listing = new Set(asarLib.listPackage(asarPath).map(normAsarEntry));
  const missing = PRODUCTION_MODULES.filter((rel) => !listing.has(rel));
  return makeCheck(
    'production_modules',
    '生产模块',
    'warning',
    missing.length === 0,
    { mode: 'asar_list', asarPath, required: PRODUCTION_MODULES, missing }
  );
}

function checkArchiveIntegrity() {
  const corrupt = [];
  for (const c of getAllCommodities()) {
    const id = String(c.id).toLowerCase();
    const lines = rangeArchive.readArchiveLines(id).filter((r) => r.predictionSlot);
    const latest = lines[lines.length - 1];
    if (!latest) continue;
    const base = latest.baseClose;
    if (priceTick.looksLikePctBand(latest.predHigh, latest.predLow, base)) {
      corrupt.push({ id, predHigh: latest.predHigh, predLow: latest.predLow, baseClose: base });
    }
  }
  return makeCheck(
    'archive_integrity',
    '存档完整',
    'critical',
    corrupt.length === 0,
    { corruptCount: corrupt.length, corrupt: corrupt.slice(0, 15) }
  );
}

const VALID_PREDICTION_SOURCES = new Set([
  'intraday-range',
  'next-day-range',
  'pct-vol-fallback',
  'fallback-pct',
  'range',
  'chemical-calibration',
  'nonferrous-calibration',
  'precious-calibration',
  'sector-calibration',
]);

function predictionHasSourceTag(hl) {
  if (!hl) return false;
  const tag = String(hl.dataSource || hl.method || hl.modelSource || '').trim();
  return tag.length > 0 && (VALID_PREDICTION_SOURCES.has(tag) || tag.includes('-') || tag.includes('_'));
}

function checkNoFakeDataInOutlook() {
  const cached = getCachedCommodityOutlookSource();
  const instruments = cached?.instruments || [];
  const violations = [];

  for (const inst of instruments) {
    const id = String(inst.id || '').toLowerCase();
    const hl = inst.highLowPrediction || inst.nextDayPrediction || inst.nextDayRange;
    if (hl?.predictedHigh == null || hl?.predictedLow == null) continue;

    const baseClose = hl.baseClose ?? hl.baseline ?? inst.nextDayRange?.baseline;
    const baselineDate = hl.baselineDate ?? inst.nextDayRange?.baselineDate;
    const price = inst.price ?? inst.closingPrice;

    if (baseClose == null || !(Number(baseClose) > 0)) {
      violations.push({ id, code: 'band_without_baseline_close', hi: hl.predictedHigh, lo: hl.predictedLow });
    }
    if (!baselineDate) {
      violations.push({ id, code: 'band_without_baseline_date', hi: hl.predictedHigh, lo: hl.predictedLow });
    }
    if ((price == null || !(Number(price) > 0)) && (baseClose == null || !(Number(baseClose) > 0))) {
      violations.push({ id, code: 'band_without_any_close', hi: hl.predictedHigh, lo: hl.predictedLow });
    }
    if (priceTick.looksLikePctBand(hl.predictedHigh, hl.predictedLow, baseClose ?? price)) {
      violations.push({
        id,
        code: 'pct_as_price',
        hi: hl.predictedHigh,
        lo: hl.predictedLow,
        base: baseClose ?? price,
      });
    }
  }

  return makeCheck(
    'no_fake_data_outlook',
    '研判无假数据',
    'critical',
    violations.length === 0,
    {
      instrumentCount: instruments.length,
      violationCount: violations.length,
      violations: violations.slice(0, 25),
    }
  );
}

function checkBacktestDataIntegrity() {
  const issues = [];
  const sampleIds = ['au', 'cu', 'fg', 'rb'];
  let klineBarCount = 0;

  for (const id of sampleIds) {
    const bars = readCachedKlines(id);
    if (!bars?.length) {
      issues.push({ id, code: 'missing_klines' });
      continue;
    }
    klineBarCount += bars.length;
    const last = bars[bars.length - 1];
    if (!last?.date || !(Number(last.close) > 0)) {
      issues.push({ id, code: 'invalid_last_bar', last });
    }
  }

  let backtestSource = null;
  try {
    const backtest = require('./commodity-outlook-backtest');
    const src = fs.readFileSync(path.join(__dirname, 'commodity-outlook-backtest.js'), 'utf8');
    if (/generateFake|mockBars|syntheticBars|Math\.random\s*\(/.test(src)) {
      issues.push({ code: 'synthetic_pattern_in_backtest_module' });
    }
    if (!src.includes('readCachedKlines')) {
      issues.push({ code: 'backtest_not_using_cached_klines' });
    }

    const summary = backtest.loadBacktestSummary?.();
    const longrun = backtest.loadLongrunSummary?.();
    if (longrun && !longrun.dataSources?.klines) {
      issues.push({ code: 'longrun_summary_missing_kline_source_tag' });
    }
    if (summary && !longrun) {
      backtestSource = 'readCachedKlines (walk-forward module)';
    } else if (longrun?.dataSources?.klines) {
      backtestSource = longrun.dataSources.klines;
    }

    for (const id of sampleIds.slice(0, 2)) {
      const p = path.join(backtest.getBacktestRoot?.() || '', `${id}.json`);
      if (!fs.existsSync(p)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
        const days = payload.days || [];
        if (!days.some((d) => d.actualSource != null)) continue;
        const bad = days.filter((d) => d.actualReturn != null && d.actualSource === 'missing');
        if (bad.length) {
          issues.push({ id, code: 'non_real_actual_return', count: bad.length });
        }
        const fakeScored = days.filter((d) => d.scored === true && d.actualSource === 'missing');
        if (fakeScored.length) {
          issues.push({ id, code: 'fake_scored_missing_actual', count: fakeScored.length });
        }
      } catch {
        issues.push({ id, code: 'backtest_file_parse_error' });
      }
    }
  } catch (err) {
    issues.push({ code: 'backtest_module_error', error: err.message });
  }

  const passed = issues.length === 0;
  return makeCheck(
    'backtest_data_integrity',
    '回测数据真实',
    'critical',
    passed,
    {
      sampleKlineBars: klineBarCount,
      backtestKlineSource: backtestSource,
      issueCount: issues.length,
      issues: issues.slice(0, 20),
    }
  );
}

function checkHonestUIStates() {
  const cached = getCachedCommodityOutlookSource();
  const instruments = cached?.instruments || [];
  const violations = [];

  for (const inst of instruments) {
    const id = String(inst.id || '').toLowerCase();
    const hl = inst.highLowPrediction || inst.nextDayPrediction || inst.nextDayRange;

    if (hl?.predictedHigh != null && hl?.predictedLow != null) {
      if (!predictionHasSourceTag(hl)) {
        violations.push({ id, code: 'prediction_without_source_tag', hi: hl.predictedHigh, lo: hl.predictedLow });
      }
      const tag = String(hl.dataSource || hl.method || hl.modelSource || '');
      if (tag === 'ui-pct-fallback') {
        violations.push({ id, code: 'ui_only_pct_fallback', tag });
      }
    }
  }

  return makeCheck(
    'honest_ui_states',
    'UI诚实状',
    'critical',
    violations.length === 0,
    {
      instrumentCount: instruments.length,
      violationCount: violations.length,
      violations: violations.slice(0, 25),
    }
  );
}

function summarizeChecks(checks) {
  const criticalCount = checks.filter((c) => !c.passed && c.severity === 'critical').length;
  const warningCount = checks.filter((c) => !c.passed && c.severity === 'warning').length;
  const infoCount = checks.filter((c) => !c.passed && c.severity === 'info').length;
  const dominant = dominantLatestCloseDate(getAllCommodities());
  return {
    ok: criticalCount === 0,
    criticalCount,
    warningCount,
    infoCount,
    latestCloseDate: dominant.date,
    checkCount: checks.length,
    passedCount: checks.filter((c) => c.passed).length,
  };
}

async function runQualityAudit(options = {}) {
  const {
    mode = 'full',
    skipNetwork = false,
    packagedContext = false,
    trigger = 'manual',
  } = options;

  const ctx = initContext();
  if (!ctx.ok) {
    return {
      ok: false,
      criticalCount: 1,
      warningCount: 0,
      checks: [
        makeCheck('data_dir', '数据目录', 'critical', false, { error: ctx.error }),
      ],
      ranAt: new Date().toISOString(),
      trigger,
      mode,
    };
  }

  const checks = [];
  checks.push(checkClosingPriceFreshness());

  if (mode === 'full') {
    checks.push(await checkClosingPriceAccuracy({ skipNetwork }));
    checks.push(checkOutlookCacheFreshness());
    checks.push(checkOutlookPredictionSanity());
    checks.push(checkDisplayPriceLogic());
    checks.push(checkKlineCompleteness());
    checks.push(checkIntlReferencesFreshness());
    checks.push(checkSlotSnapshots());
    checks.push(checkArchiveIntegrity());
    checks.push(checkNoFakeDataInOutlook());
    checks.push(checkBacktestDataIntegrity());
    checks.push(checkHonestUIStates());
    checks.push(checkProductionModules({ packagedContext }));
  } else {
    checks.push(checkOutlookCacheFreshness());
    checks.push(checkIntlReferencesFreshness());
    checks.push(checkDisplayPriceLogic());
  }

  const summary = summarizeChecks(checks);
  return {
    ...summary,
    checks,
    ranAt: new Date().toISOString(),
    trigger,
    mode,
  };
}

module.exports = {
  EXPECTED_INSTRUMENT_COUNT,
  ACTIVE_INSTRUMENT_COUNT,
  DORMANT_INSTRUMENTS,
  runQualityAudit,
  checkClosingPriceFreshness,
  checkClosingPriceAccuracy,
  checkOutlookCacheFreshness,
  checkOutlookPredictionSanity,
  checkDisplayPriceLogic,
  checkKlineCompleteness,
  checkIntlReferencesFreshness,
  checkSlotSnapshots,
  checkProductionModules,
  checkArchiveIntegrity,
  checkNoFakeDataInOutlook,
  checkBacktestDataIntegrity,
  checkHonestUIStates,
  initContext,
};
