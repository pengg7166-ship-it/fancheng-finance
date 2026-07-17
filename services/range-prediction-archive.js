/**
 * 下一交易'high/low 预测 vs 实际 session 存档 '供回测与实盘前审'
 * 存储：{dataDir}/history/range-prediction-archive/{instrumentId}-daily.jsonl
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const cnSession = require('./cn-futures-session-calendar');
const tradingSession = require('./trading-session-calendar');
const priceTick = require('./price-tick');

const ARCHIVE_SUBDIR = path.join('history', 'range-prediction-archive');

function rangeArchiveRecordKey(record) {
  const day = String(record?.sessionDate || '').slice(0, 10);
  const slot = record?.predictionSlot || 'legacy';
  return `${day}|${slot}`;
}

function getArchiveRoot() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const root = path.join(dataDir, ARCHIVE_SUBDIR);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getArchivePath(instrumentId) {
  const root = getArchiveRoot();
  if (!root) return null;
  const id = String(instrumentId || '').toLowerCase();
  return path.join(root, `${id}-daily.jsonl`);
}

/**
 * 槽位预测 vs 品种专属窗口内实'high/low
 */
function resolveSlotActualHighLow({
  instrumentId,
  slotId,
  sessionDate,
  captureDate,
  klineBars,
  liveQuote,
  cnParts,
}) {
  const window = tradingSession.getSessionWindow(instrumentId, slotId, sessionDate, { captureDate });
  if (!window || window.invalid) {
    return {
      status: 'invalid',
      reason: window?.reason || 'invalid_slot',
      sessionWindowLabel: window?.label || '无夜',
      window,
    };
  }

  const actual = tradingSession.computeWindowHighLow({
    instrumentId,
    window,
    dailyBars: klineBars,
    liveQuote,
    cnParts: cnParts || cnSession.getCnNowParts(),
  });

  return {
    ...actual,
    sessionDate: String(sessionDate || '').slice(0, 10),
    captureDate: window.captureDate,
    sessionWindowLabel: window.label,
    sessionWindowStart: window.start,
    sessionWindowEnd: window.end,
    nightCategory: window.nightCategory,
  };
}

function refreshSlotArchiveActuals(instrumentId, opts = {}) {
  const id = String(instrumentId || '').toLowerCase();
  const existing = readArchiveLines(id);
  const slotRows = existing.filter((r) => r.predictionSlot);
  if (!slotRows.length) return { id, refreshed: 0, path: getArchivePath(id) };

  const klines = opts.bars || readKlineBars(id);
  const liveQuote = opts.liveQuote || null;
  const cnParts = opts.cnParts || cnSession.getCnNowParts();
  const lookbackDays = opts.lookbackDays ?? 45;
  const cutoff = cnSession.shiftCalendarDate(cnParts.date, -Math.max(1, lookbackDays));
  let refreshed = 0;

  for (const row of slotRows) {
    if (String(row.sessionDate || '') < cutoff && !opts.force) continue;
    const normalized = normalizeSlotPredPrices(row);
    if (normalized.predHigh !== row.predHigh || normalized.predLow !== row.predLow) {
      row.predHigh = normalized.predHigh;
      row.predLow = normalized.predLow;
      row.meta = normalized.meta;
    }
    const needsRefresh =
      opts.force ||
      row.meta?.sessionWindowVersion !== tradingSession.SESSION_WINDOW_VERSION ||
      row.meta?.pctCorrected ||
      row.actualHigh == null ||
      row.actualLow == null ||
      row.sessionWindowLabel == null;
    if (!needsRefresh) continue;

    const actual = resolveSlotActualHighLow({
      instrumentId: id,
      slotId: row.predictionSlot,
      sessionDate: row.sessionDate,
      captureDate: row.baselineDate || row.captureDate,
      klineBars: klines,
      liveQuote,
      cnParts,
    });

    if (actual.actualHigh == null || actual.actualLow == null) {
      if (actual.status === 'pending') {
        row.status = 'pending';
        row.sessionWindowLabel = actual.sessionWindowLabel;
        row.meta = {
          ...(row.meta || {}),
          sessionWindowVersion: tradingSession.SESSION_WINDOW_VERSION,
          sessionWindowStart: actual.sessionWindowStart,
          sessionWindowEnd: actual.sessionWindowEnd,
        };
        refreshed += 1;
      }
      continue;
    }

    const cmp = computeRangeComparison({
      predHigh: row.predHigh,
      predLow: row.predLow,
      actualHigh: actual.actualHigh,
      actualLow: actual.actualLow,
      status: actual.status === 'complete' ? 'complete' : 'intraday',
    });

    Object.assign(row, {
      actualHigh: +Number(actual.actualHigh).toFixed(4),
      actualLow: +Number(actual.actualLow).toFixed(4),
      predRange: cmp.predRange,
      actualRange: cmp.actualRange,
      highHit: cmp.highHit,
      lowHit: cmp.lowHit,
      bandHit: cmp.bandHit,
      highError: cmp.highError,
      lowError: cmp.lowError,
      status: cmp.status,
      sessionWindowLabel: actual.sessionWindowLabel,
      updatedAt: new Date().toISOString(),
      meta: {
        ...(row.meta || {}),
        actualSource: actual.source,
        sessionWindowVersion: tradingSession.SESSION_WINDOW_VERSION,
        sessionWindowStart: actual.sessionWindowStart,
        sessionWindowEnd: actual.sessionWindowEnd,
        nightCategory: actual.nightCategory,
      },
    });
    refreshed += 1;
  }

  if (refreshed > 0) {
    writeArchiveLines(id, existing);
  }
  return { id, refreshed, path: getArchivePath(id) };
}

function refreshSlotActualsForInstruments(instruments = [], opts = {}) {
  let refreshed = 0;
  const results = [];
  for (const inst of instruments) {
    const id = inst?.id || inst;
    if (!id) continue;
    const r = refreshSlotArchiveActuals(String(id).toLowerCase(), {
      ...opts,
      liveQuote: inst?.liveQuote || inst?.quote || opts.liveQuote,
    });
    refreshed += r.refreshed || 0;
    if (r.refreshed) results.push(r);
  }
  return { refreshed, count: instruments.length, instruments: results };
}

function resolveSessionPhase(cnParts, baselineDate, sessionDate) {
  if (!cnParts || !baselineDate || !sessionDate) return 'pending';
  const { date, hour, minute } = cnParts;
  const afterDayClose = (d) =>
    date > d || (date === d && (hour > 15 || (hour === 15 && minute >= 0)));
  const atOrAfterNightOpen = (d) => date > d || (date === d && hour >= 21);

  if (afterDayClose(sessionDate)) return 'complete';
  if (atOrAfterNightOpen(baselineDate)) return 'intraday';
  return 'pending';
}

function roundStoredPredPrice(instrumentId, price) {
  return priceTick.roundPriceToTick(instrumentId, price);
}

/** Correct pct offsets (e.g. 1.553 / -1.943) mistakenly stored as predHigh/predLow. */
function normalizeSlotPredPrices(record = {}) {
  const baseClose = record.baseClose;
  let predHigh = record.predHigh;
  let predLow = record.predLow;
  if (!priceTick.looksLikePctBand(predHigh, predLow, baseClose)) {
    predHigh = roundStoredPredPrice(record.instrumentId, predHigh);
    predLow = roundStoredPredPrice(record.instrumentId, predLow);
    if (predHigh === record.predHigh && predLow === record.predLow) return record;
    return { ...record, predHigh, predLow };
  }
  const prices = priceTick.pctBandToPrices({
    instrumentId: record.instrumentId,
    baseClose,
    lowPct: predLow,
    highPct: predHigh,
  });
  return {
    ...record,
    predHigh: prices.predictedHigh,
    predLow: prices.predictedLow,
    meta: { ...(record.meta || {}), pctCorrected: true },
  };
}

/**
 * @param {{
 *   predHigh: number,
 *   predLow: number,
 *   actualHigh?: number|null,
 *   actualLow?: number|null,
 *   status?: 'complete'|'intraday'|'pending',
 * }} opts
 */
function computeRangeComparison(opts = {}) {
  const predHigh = Number(opts.predHigh);
  const predLow = Number(opts.predLow);
  const status = opts.status || 'pending';
  const predRange = predHigh - predLow;

  if (
    status === 'pending' ||
    opts.actualHigh == null ||
    opts.actualLow == null ||
    Number.isNaN(predHigh) ||
    Number.isNaN(predLow)
  ) {
    return {
      status: 'pending',
      predRange: +predRange.toFixed(4),
      actualRange: null,
      highHit: null,
      lowHit: null,
      bandHit: null,
      highError: null,
      lowError: null,
      compareClass: 'range-compare-pending',
      compareLabel: '待校验',
    };
  }

  const actualHigh = Number(opts.actualHigh);
  const actualLow = Number(opts.actualLow);
  const highHit = actualHigh <= predHigh;
  const lowHit = actualLow >= predLow;
  const bandHit = highHit && lowHit;
  const actualRange = actualHigh - actualLow;

  let compareClass = 'range-compare-miss';
  let compareLabel = '区间未命';
  if (bandHit) {
    compareClass = 'range-compare-hit';
    compareLabel = status === 'intraday' ? '盘中·区间命中' : '区间命中';
  } else if (highHit || lowHit) {
    compareClass = 'range-compare-partial';
    compareLabel = status === 'intraday' ? '盘中·部分命中' : '部分命中';
  } else if (status === 'intraday') {
    compareLabel = '盘中·区间未命';
  }

  return {
    status,
    predHigh,
    predLow,
    actualHigh,
    actualLow,
    predRange: +predRange.toFixed(4),
    actualRange: +actualRange.toFixed(4),
    highHit,
    lowHit,
    bandHit,
    highError: +(actualHigh - predHigh).toFixed(4),
    lowError: +(actualLow - predLow).toFixed(4),
    compareClass,
    compareLabel,
  };
}

function readArchiveLines(instrumentId) {
  const fp = getArchivePath(instrumentId);
  if (!fp || !fs.existsSync(fp)) return [];
  const text = fs.readFileSync(fp, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeArchiveLines(instrumentId, records) {
  const fp = getArchivePath(instrumentId);
  if (!fp) return { wrote: false, path: null };
  const sorted = [...records].sort((a, b) =>
    String(a.sessionDate).localeCompare(String(b.sessionDate))
  );
  const body = sorted.map((r) => JSON.stringify(r)).join('\n') + (sorted.length ? '\n' : '');
  fs.writeFileSync(fp, body, 'utf8');
  return { wrote: true, path: fp, count: sorted.length };
}

/**
 * @param {{
 *   instrumentId: string,
 *   sessionDate: string,
 *   baselineDate?: string,
 *   baseClose: number,
 *   predHigh: number,
 *   predLow: number,
 *   actualHigh: number,
 *   actualLow: number,
 *   modelVersion?: string,
 *   meta?: object,
 * }} payload
 */
function recordSessionOutcome(payload = {}) {
  const instrumentId = String(payload.instrumentId || '').toLowerCase();
  const sessionDate = String(payload.sessionDate || '').slice(0, 10);
  if (!instrumentId || !sessionDate) return { recorded: false, reason: 'missing_id_or_date' };

  const predHigh = roundStoredPredPrice(instrumentId, payload.predHigh);
  const predLow = roundStoredPredPrice(instrumentId, payload.predLow);
  const actualHigh = Number(payload.actualHigh);
  const actualLow = Number(payload.actualLow);
  if (
    [predHigh, predLow, actualHigh, actualLow, Number(payload.baseClose)].some(
      (v) => v == null || Number.isNaN(v)
    )
  ) {
    return { recorded: false, reason: 'invalid_numbers' };
  }

  const cmp = computeRangeComparison({
    predHigh,
    predLow,
    actualHigh,
    actualLow,
    status: 'complete',
  });

  const record = {
    instrumentId,
    sessionDate,
    baselineDate: payload.baselineDate ? String(payload.baselineDate).slice(0, 10) : null,
    baseClose: +Number(payload.baseClose).toFixed(4),
    predHigh,
    predLow,
    actualHigh: +actualHigh.toFixed(4),
    actualLow: +actualLow.toFixed(4),
    predRange: cmp.predRange,
    actualRange: cmp.actualRange,
    highHit: cmp.highHit,
    lowHit: cmp.lowHit,
    bandHit: cmp.bandHit,
    highError: cmp.highError,
    lowError: cmp.lowError,
    modelVersion: payload.modelVersion || 'unknown',
    recordedAt: new Date().toISOString(),
    ...(payload.meta && typeof payload.meta === 'object' ? { meta: payload.meta } : {}),
  };

  const existing = readArchiveLines(instrumentId);
  const idx = existing.findIndex(
    (r) =>
      rangeArchiveRecordKey(r) ===
      rangeArchiveRecordKey({ sessionDate, predictionSlot: payload.predictionSlot || 'legacy' })
  );
  if (idx >= 0) existing[idx] = { ...existing[idx], ...record };
  else existing.push(record);

  const write = writeArchiveLines(instrumentId, existing);
  return { recorded: true, updated: idx >= 0, path: write.path, record };
}

function loadArchive(instrumentId, dateRange = {}) {
  const from = dateRange.from ? String(dateRange.from).slice(0, 10) : null;
  const to = dateRange.to ? String(dateRange.to).slice(0, 10) : null;
  return readArchiveLines(instrumentId).filter((r) => {
    const d = r.sessionDate;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function recordSlotPrediction(payload = {}) {
  const instrumentId = String(payload.instrumentId || '').toLowerCase();
  const sessionDate = String(payload.sessionDate || '').slice(0, 10);
  const predictionSlot = payload.predictionSlot || null;
  if (!instrumentId || !sessionDate || !predictionSlot) {
    return { recorded: false, reason: 'missing_id_date_or_slot' };
  }

  const predHigh = Number(payload.predHigh);
  const predLow = Number(payload.predLow);
  const baseClose = Number(payload.baseClose);
  if ([predHigh, predLow, baseClose].some((v) => v == null || Number.isNaN(v))) {
    return { recorded: false, reason: 'invalid_numbers' };
  }

  const normalizedPred = normalizeSlotPredPrices({
    instrumentId,
    baseClose,
    predHigh,
    predLow,
  });

  const existing = readArchiveLines(instrumentId);
  const key = rangeArchiveRecordKey({ sessionDate, predictionSlot });
  const idx = existing.findIndex((r) => rangeArchiveRecordKey(r) === key);
  const prev = idx >= 0 ? existing[idx] : null;

  const cmp = computeRangeComparison({
    predHigh: normalizedPred.predHigh,
    predLow: normalizedPred.predLow,
    actualHigh: prev?.actualHigh,
    actualLow: prev?.actualLow,
    status: prev?.actualHigh != null ? 'complete' : 'pending',
  });

  const record = {
    instrumentId,
    sessionDate,
    baselineDate: payload.baselineDate ? String(payload.baselineDate).slice(0, 10) : null,
    baseClose: +baseClose.toFixed(4),
    predHigh: normalizedPred.predHigh,
    predLow: normalizedPred.predLow,
    actualHigh: prev?.actualHigh ?? null,
    actualLow: prev?.actualLow ?? null,
    predRange: cmp.predRange,
    actualRange: cmp.actualRange,
    highHit: cmp.highHit,
    lowHit: cmp.lowHit,
    bandHit: cmp.bandHit,
    highError: cmp.highError,
    lowError: cmp.lowError,
    status: cmp.status,
    modelVersion: payload.modelVersion || 'slot-v1',
    predictionSlot,
    predictionSlotLabel: payload.predictionSlotLabel || null,
    predictTs: payload.predictTs || new Date().toISOString(),
    sessionWindowLabel: payload.meta?.sessionWindowLabel || prev?.sessionWindowLabel || null,
    recordedAt: prev?.recordedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    meta: {
      source: 'slot-snapshot',
      ...(prev?.meta || {}),
      ...(payload.meta || {}),
      predMidPct: payload.predMidPct ?? prev?.meta?.predMidPct ?? null,
    },
  };

  if (idx >= 0) existing[idx] = { ...prev, ...record };
  else existing.push(record);

  const write = writeArchiveLines(instrumentId, existing);
  return { recorded: true, updated: idx >= 0, path: write.path, record };
}

function getComparisonStats(instrumentId, dateRange = {}, slotFilter = null) {
  let rows = loadArchive(instrumentId, dateRange);
  if (slotFilter) {
    rows = rows.filter((r) => {
      const slot = r.predictionSlot || 'pre-night';
      return slot === slotFilter;
    });
  }
  const scored = rows.filter((r) => r.bandHit != null);
  const bandHits = scored.filter((r) => r.bandHit).length;
  const highHits = scored.filter((r) => r.highHit).length;
  const lowHits = scored.filter((r) => r.lowHit).length;
  const highErrors = scored.map((r) => r.highError).filter((v) => v != null);
  const lowErrors = scored.map((r) => r.lowError).filter((v) => v != null);

  const mean = (arr) =>
    arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(4) : null;

  return {
    instrumentId: String(instrumentId || '').toLowerCase(),
    count: scored.length,
    bandHitRate: scored.length ? +(bandHits / scored.length).toFixed(4) : null,
    highHitRate: scored.length ? +(highHits / scored.length).toFixed(4) : null,
    lowHitRate: scored.length ? +(lowHits / scored.length).toFixed(4) : null,
    meanHighError: mean(highErrors),
    meanLowError: mean(lowErrors),
    worstMisses: [...scored]
      .filter((r) => !r.bandHit)
      .sort(
        (a, b) =>
          Math.abs(b.highError || 0) +
          Math.abs(b.lowError || 0) -
          (Math.abs(a.highError || 0) + Math.abs(a.lowError || 0))
      )
      .slice(0, 10),
  };
}

/**
 * 'K 线与实时报价解析目标 session 的实'high/low
 */
function resolveActualSessionHighLow({ klineBars, predCtx, liveQuote, cnSession }) {
  if (!cnSession || !predCtx || !klineBars?.length) return null;

  const barIdx = predCtx.barIdx;
  const target = cnSession.getNextSessionTarget(klineBars, barIdx);
  if (!target) {
    return { status: 'pending', reason: 'no_target_session', label: '待开' };
  }

  const cnNow = cnSession.getCnNowParts();
  const phase = resolveSessionPhase(cnNow, target.baselineDate, target.nextBarDate);

  if (phase === 'complete') {
    return {
      status: 'complete',
      sessionDate: target.nextBarDate,
      baselineDate: target.baselineDate,
      actualHigh: target.high,
      actualLow: target.low,
      actualRange: target.range,
      source: 'daily-bar',
      label: '已收',
    };
  }

  if (phase === 'intraday') {
    const liveHigh = liveQuote?.high;
    const liveLow = liveQuote?.low;
    if (liveHigh != null && liveLow != null && !Number.isNaN(Number(liveHigh))) {
      const hi = Number(liveHigh);
      const lo = Number(liveLow);
      return {
        status: 'intraday',
        sessionDate: target.nextBarDate,
        baselineDate: target.baselineDate,
        actualHigh: hi,
        actualLow: lo,
        actualRange: hi - lo,
        source: 'live-quote',
        label: '盘中',
      };
    }

    const nextIdx = cnSession.resolveNextBarIdx(klineBars, barIdx);
    const developing = nextIdx >= 0 ? klineBars[nextIdx] : null;
    if (developing) {
      const hi = Number(developing.high ?? developing.close);
      const lo = Number(developing.low ?? developing.close);
      return {
        status: 'intraday',
        sessionDate: target.nextBarDate,
        baselineDate: target.baselineDate,
        actualHigh: hi,
        actualLow: lo,
        actualRange: hi - lo,
        source: 'developing-bar',
        label: '盘中',
      };
    }
  }

  return {
    status: 'pending',
    sessionDate: target.nextBarDate,
    baselineDate: target.baselineDate,
    label: '待开',
  };
}

function buildRangeComparisonForInstrument({ highLowPrediction, actualSessionHighLow }) {
  if (!highLowPrediction?.predictedHigh || !highLowPrediction?.predictedLow) return null;
  const status = actualSessionHighLow?.status || 'pending';
  return computeRangeComparison({
    predHigh: highLowPrediction.predictedHigh,
    predLow: highLowPrediction.predictedLow,
    actualHigh: actualSessionHighLow?.actualHigh,
    actualLow: actualSessionHighLow?.actualLow,
    status,
  });
}

function maybeArchiveCompletedSession({
  instrumentId,
  highLowPrediction,
  actualSessionHighLow,
  rangeComparison,
  regime,
  regimeLabel,
}) {
  if (actualSessionHighLow?.status !== 'complete') return { archived: false, reason: 'not_complete' };
  if (rangeComparison?.highHit == null) return { archived: false, reason: 'no_comparison' };

  return recordSessionOutcome({
    instrumentId,
    sessionDate: actualSessionHighLow.sessionDate,
    baselineDate: actualSessionHighLow.baselineDate || highLowPrediction?.baselineDate,
    baseClose: highLowPrediction?.baseClose ?? highLowPrediction?.baseline,
    predHigh: highLowPrediction.predictedHigh,
    predLow: highLowPrediction.predictedLow,
    actualHigh: actualSessionHighLow.actualHigh,
    actualLow: actualSessionHighLow.actualLow,
    modelVersion: highLowPrediction.method || highLowPrediction.version || 'range-v1',
    meta: {
      source: actualSessionHighLow.source,
      compareClass: rangeComparison.compareClass,
      ...(regime ? { regime } : {}),
      ...(regimeLabel ? { regimeLabel } : {}),
    },
  });
}

function archiveCompletedSessionsFromOutlook(instruments = []) {
  let archived = 0;
  for (const inst of instruments) {
    if (inst.outlookPending || !inst.rangeComparison || inst.rangeComparison.highHit == null) continue;
    const r = maybeArchiveCompletedSession({
      instrumentId: inst.id,
      highLowPrediction: inst.highLowPrediction,
      actualSessionHighLow: inst.actualSessionHighLow,
      rangeComparison: inst.rangeComparison,
      regime: inst.regime,
      regimeLabel: inst.regimeLabel,
    });
    if (r.archived) archived += 1;
  }
  return { archived };
}

/** 由区间中点相对昨收推断偏'偏空/震荡 */
function computeBandDirection(baseClose, high, low) {
  const base = Number(baseClose);
  const hi = Number(high);
  const lo = Number(low);
  if ([base, hi, lo].some((v) => v == null || Number.isNaN(v))) {
    return { dir: null, label: '' };
  }
  const mid = (hi + lo) / 2;
  const bias = mid - base;
  const range = Math.max(hi - lo, base * 0.0001);
  const threshold = Math.max(range * 0.12, base * 0.0004);
  if (Math.abs(bias) <= threshold) return { dir: 'flat', label: '震荡' };
  return bias > 0 ? { dir: 'up', label: '偏多' } : { dir: 'down', label: '偏空' };
}

function formatBandHitLabel(record = {}) {
  if (record.bandHit) return '';
  if (record.highHit && record.lowHit) return '';
  if (record.highHit) return '';
  if (record.lowHit) return '';
  if (record.highHit == null) return '';
  return '';
}

/**
 * 规则化未命中原因标签 —UI 审计'analyze-range-prediction-misses 对齐
 */
function deriveMissReasonTags(record = {}) {
  if (record.bandHit) return ['区间命中'];

  const tags = [];
  const highMiss = record.highHit === false;
  const lowMiss = record.lowHit === false;

  if (highMiss && lowMiss) tags.push('双向突破');
  else if (highMiss) tags.push('高点突破');
  else if (lowMiss) tags.push('低点突破');

  const hiErr = Math.abs(Number(record.highError) || 0);
  const loErr = Math.abs(Number(record.lowError) || 0);
  const maxErr = Math.max(hiErr, loErr);
  const base = Number(record.baseClose);
  if (base > 0 && maxErr > 0) {
    const pct = (maxErr / base) * 100;
    if (pct >= 1.5) tags.push('大幅偏差');
    else if (pct >= 0.5) tags.push('中度偏差');
  }

  const predRange = Number(record.predRange);
  const actualRange = Number(record.actualRange);
  if (predRange > 0 && actualRange > 0) {
    const ratio = actualRange / predRange;
    if (ratio > 1.35) tags.push('实际振幅偏大');
    else if (ratio < 0.65) tags.push('实际振幅偏小');
  }

  if (highMiss && !lowMiss && loErr > hiErr * 1.5) tags.push('下沿偏宽');
  if (lowMiss && !highMiss && hiErr > loErr * 1.5) tags.push('上沿偏宽');

  const regime = record.meta?.regimeLabel || record.meta?.regime;
  if (regime) tags.push(`环境:${regime}`);

  return tags.length ? tags : ['待分'];
}

function enrichAuditRecord(record = {}) {
  let sessionWindowLabel = record.sessionWindowLabel;
  if (!sessionWindowLabel && record.predictionSlot) {
    sessionWindowLabel = tradingSession.getSlotWindowLabel(
      record.instrumentId,
      record.predictionSlot,
      record.sessionDate,
      { captureDate: record.baselineDate }
    );
  }
  const predictedDirection = computeBandDirection(record.baseClose, record.predHigh, record.predLow);
  const actualDirection = computeBandDirection(record.baseClose, record.actualHigh, record.actualLow);
  const directionHit =
    predictedDirection.dir != null &&
    actualDirection.dir != null &&
    (predictedDirection.dir === actualDirection.dir ||
      (predictedDirection.dir === 'flat' && actualDirection.dir === 'flat'));

  const maxDeviation = Math.max(
    Math.abs(Number(record.highError) || 0),
    Math.abs(Number(record.lowError) || 0)
  );

  const deviationHigh = record.highError != null ? record.highError : null;
  const deviationLow = record.lowError != null ? record.lowError : null;
  let centerDeviation = record.centerDeviation ?? null;
  if (
    centerDeviation == null &&
    record.baseClose > 0 &&
    record.meta?.predMidPct != null &&
    record.actualHigh != null &&
    record.actualLow != null
  ) {
    const predCenter = Number(record.baseClose) * (1 + Number(record.meta.predMidPct) / 100);
    const actCenter = (Number(record.actualHigh) + Number(record.actualLow)) / 2;
    centerDeviation = +(actCenter - predCenter).toFixed(4);
  }

  return {
    ...normalizeSlotPredPrices(record),
    predictTs: record.predictTs || record.baselineDate || record.sessionDate || record.recordedAt || null,
    sessionWindowLabel,
    predictedDirection,
    actualDirection,
    directionHit,
    bandHitLabel: formatBandHitLabel(record),
    deviationHigh,
    deviationLow,
    centerDeviation,
    maxDeviation: maxDeviation > 0 ? +maxDeviation.toFixed(4) : null,
    missReasonTags: deriveMissReasonTags(record),
  };
}

function loadArchiveForAudit(instrumentId, limit = 60) {
  const sorted = loadArchive(instrumentId).sort((a, b) => {
    const da = String(a.sessionDate || a.baselineDate || '');
    const db = String(b.sessionDate || b.baselineDate || '');
    return db.localeCompare(da);
  });
  const capped = limit > 0 ? sorted.slice(0, limit) : sorted;
  return capped.map(enrichAuditRecord);
}

function readKlineBars(instrumentId) {
  try {
    const dirArchive = require('./direction-prediction-archive');
    return dirArchive.readKlineBars(instrumentId);
  } catch {
    return [];
  }
}

/**
 * 'N 个交易日：缺失存档或'actual 时，'K '+ 区间预测器回'
 */
function refreshRecentSessionsFromKlines(instrumentId, opts = {}) {
  const id = String(instrumentId || '').toLowerCase();
  const lookbackDays = opts.lookbackDays ?? 21;
  const fromDate =
    opts.fromDate || cnSession.shiftCalendarDate(new Date().toISOString().slice(0, 10), -lookbackDays);

  let bars = opts.bars;
  if (!bars?.length) {
    try {
      const { loadEffectiveBars } = require('./next-day-range-predictor');
      bars = loadEffectiveBars(id, readKlineBars(id));
    } catch {
      bars = readKlineBars(id);
    }
  }
  if (bars.length < 30) return { id, recorded: 0, reason: 'insufficient_bars' };

  let predictFn;
  try {
    ({ predictNextDayHighLowFromBars: predictFn } = require('./intraday-range-predictor'));
  } catch {
    return { id, recorded: 0, reason: 'predictor_unavailable' };
  }

  const existing = readArchiveLines(id);
  const bySession = new Map(existing.map((r) => [r.sessionDate, r]));

  let gapCount = 0;
  for (let i = Math.max(20, bars.length - lookbackDays - 5); i < bars.length - 1; i += 1) {
    const pair = cnSession.getSessionPair(bars, i);
    if (!pair?.target?.nextBarDate) continue;
    if (pair.baseline.date < fromDate && pair.target.nextBarDate < fromDate) continue;
    const prev = bySession.get(pair.target.nextBarDate);
    if (prev?.actualHigh != null && prev?.actualLow != null && prev?.bandHit != null) continue;
    gapCount += 1;
  }
  if (!opts.force && gapCount === 0) {
    return { id, recorded: 0, skipped: true, reason: 'up_to_date', path: getArchivePath(id) };
  }

  let recorded = 0;

  for (let i = 20; i < bars.length - 1; i += 1) {
    const pair = cnSession.getSessionPair(bars, i);
    if (!pair?.target?.nextBarDate) continue;
    const baselineDate = pair.baseline.date;
    const sessionDate = pair.target.nextBarDate;
    if (baselineDate < fromDate && sessionDate < fromDate) continue;

    const prev = bySession.get(sessionDate);
    if (prev?.actualHigh != null && prev?.actualLow != null && prev?.bandHit != null) continue;

    const pred = predictFn({
      instrumentId: id,
      klines: bars.slice(0, i + 1),
      asOfDate: baselineDate,
    });
    if (!pred?.predictedHigh || !pred?.predictedLow) continue;

    const result = recordSessionOutcome({
      instrumentId: id,
      sessionDate,
      baselineDate,
      baseClose: pair.baseline.close,
      predHigh: pred.predictedHigh,
      predLow: pred.predictedLow,
      actualHigh: pair.target.high,
      actualLow: pair.target.low,
      modelVersion: pred.method || pred.version || 'range-refresh-v1',
      meta: {
        refresh: true,
        asOfDate: baselineDate,
        ...(prev?.meta || {}),
      },
    });
    if (result.recorded) {
      recorded += 1;
      bySession.set(sessionDate, result.record);
    }
  }

  return { id, recorded, path: getArchivePath(id), stats: getComparisonStats(id) };
}

function refreshRecentForInstruments(instruments = [], opts = {}) {
  let recorded = 0;
  const results = [];
  for (const inst of instruments) {
    const id = inst?.id || inst;
    if (!id) continue;
    const r = refreshRecentSessionsFromKlines(String(id).toLowerCase(), opts);
    recorded += r.recorded || 0;
    if (r.recorded) results.push(r);
  }
  return { recorded, count: instruments.length, instruments: results };
}

module.exports = {
  ARCHIVE_SUBDIR,
  getArchiveRoot,
  getArchivePath,
  resolveSessionPhase,
  computeRangeComparison,
  computeBandDirection,
  deriveMissReasonTags,
  enrichAuditRecord,
  formatBandHitLabel,
  recordSessionOutcome,
  recordSlotPrediction,
  rangeArchiveRecordKey,
  loadArchive,
  loadArchiveForAudit,
  getComparisonStats,
  resolveActualSessionHighLow,
  resolveSlotActualHighLow,
  normalizeSlotPredPrices,
  refreshSlotArchiveActuals,
  refreshSlotActualsForInstruments,
  buildRangeComparisonForInstrument,
  maybeArchiveCompletedSession,
  archiveCompletedSessionsFromOutlook,
  refreshRecentSessionsFromKlines,
  refreshRecentForInstruments,
  readKlineBars,
  readArchiveLines,
  writeArchiveLines,
};
