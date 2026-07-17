/**
 * 大宗走势研判三时段预测槽导出
 *
 * 读取 App 写入'slot-snapshots，或 commodity-outlook-v4 磁盘缓存回退'
 * 'outlook 校验 CSV 与时段对照导出使用'
 */
const diskCache = require('./disk-cache');
const cnSession = require('./cn-futures-session-calendar');
const slotSnapshot = require('./outlook-slot-snapshot');
const outlookSlots = require('./outlook-prediction-slots');
const { getDataDir, getUserDataDir } = require('./data-paths');

/** 导出槽位 id 'outlook-prediction-slots id */
const FORWARD_TO_OUTLOOK_SLOT = {
  night_prep: 'pre-night',
  day_prep: 'pre-day',
  /** 凌晨段沿用当'pre-night 区间'1:00'2:30 同属夜盘预测窗口'*/
  early_morning: 'pre-night',
};

const OUTLOOK_DISK_KEY = 'commodity-outlook-v4.json';

function mapForwardSlot(forwardSlot) {
  return FORWARD_TO_OUTLOOK_SLOT[String(forwardSlot || '')] || null;
}

function initDiskCacheIfNeeded() {
  if (diskCache.getRoot?.()) return;
  const root = getUserDataDir() || getDataDir();
  if (root) diskCache.init(root);
}

/**
 * 解析 export 时段对应'outlook sessionDate（与 slot-snapshot 目录一致）
 */
function resolveOutlookSessionDate(forwardSlot, now = new Date()) {
  const outlookSlotId = mapForwardSlot(forwardSlot);
  if (!outlookSlotId) return null;
  const cnParts = cnSession.getCnNowParts(now);
  const slotMeta = outlookSlots.buildSlotMeta(outlookSlotId, { cnParts, now });
  return slotMeta?.sessionDate ? String(slotMeta.sessionDate).slice(0, 10) : null;
}

function readLiveOutlookInstrument(instrumentId) {
  initDiskCacheIfNeeded();
  const stored = diskCache.readStale(OUTLOOK_DISK_KEY);
  const instruments = stored?.data?.instruments;
  if (!Array.isArray(instruments)) return null;
  const id = String(instrumentId || '').toLowerCase();
  return instruments.find((i) => String(i.id).toLowerCase() === id) || null;
}

function bandFromLiveInstrument(inst) {
  if (!inst) return null;
  const band = slotSnapshot.resolveSlotPriceBand(inst);
  if (band.predictedLow == null && band.predictedHigh == null) return null;
  return {
    predLow: band.predictedLow,
    predHigh: band.predictedHigh,
    predMid: band.predictedMid,
    direction: inst.directionTier || inst.direction || null,
    directionLabel: inst.directionLabel || null,
    source: 'commodity-outlook-v4.json',
    baseline: band.baseline ?? inst.price ?? null,
  };
}

function bandFromSlotEntry(entry) {
  if (!entry) return null;
  const predLow = entry.predictedLow;
  const predHigh = entry.predictedHigh;
  if (predLow == null && predHigh == null) return null;
  return {
    predLow,
    predHigh,
    predMid: entry.predictedMid ?? null,
    direction: entry.direction || null,
    directionLabel: entry.directionLabel || null,
    source: 'slot-snapshot',
    predictTs: entry.predictTs || entry.ts || null,
    sessionWindowLabel: entry.sessionWindowLabel || null,
    captureSource: entry.captureSource || null,
  };
}

/**
 * @returns {object|null} outlook range band for instrument at forward export slot
 */
function loadOutlookRangeForExport(opts = {}) {
  const forwardSlot = opts.forwardSlot || opts.exportSlot;
  const instrumentId = String(opts.instrumentId || '').toLowerCase();
  const sessionDate =
    opts.sessionDate ||
    resolveOutlookSessionDate(forwardSlot, opts.now || new Date());
  const outlookSlotId = mapForwardSlot(forwardSlot);

  if (!instrumentId || !outlookSlotId || !sessionDate) {
    return {
      ok: false,
      reason: 'missing_slot_context',
      instrumentId,
      forwardSlot,
      outlookSlotId,
      sessionDate,
    };
  }

  const snap = slotSnapshot.readSlotSnapshot(sessionDate, outlookSlotId);
  const snapEntry = snap?.instruments?.find(
    (i) => String(i.id).toLowerCase() === instrumentId,
  );
  let band = bandFromSlotEntry(snapEntry);
  let rangeSource = band ? 'slot-snapshot' : null;

  if (!band) {
    const liveInst = readLiveOutlookInstrument(instrumentId);
    band = bandFromLiveInstrument(liveInst);
    rangeSource = band ? 'commodity-outlook-v4.json' : null;
  }

  if (!band) {
    return {
      ok: false,
      reason: 'no_outlook_range',
      instrumentId,
      forwardSlot,
      outlookSlotId,
      sessionDate,
      snapshotPath: slotSnapshot.slotSnapshotPath(sessionDate, outlookSlotId),
      hint: '请在 App 内刷新大宗走势研判，并等待三时段快照写入 outlook-history/slot-snapshots',
    };
  }

  return {
    ok: true,
    instrumentId,
    forwardSlot,
    outlookSlotId,
    outlookSlotLabel: outlookSlots.getSlotById(outlookSlotId)?.label || outlookSlotId,
    sessionDate,
    snapshotPath: slotSnapshot.slotSnapshotPath(sessionDate, outlookSlotId),
    snapshotSavedAt: snap?.savedAt || null,
    rangeSource,
    ...band,
  };
}

function resolveRangeTolerance(instrumentId, band) {
  const span =
    band?.predHigh != null && band?.predLow != null
      ? Math.abs(Number(band.predHigh) - Number(band.predLow))
      : 0;
  const pct = Number(process.env.OUTLOOK_RANGE_TOLERANCE_PCT || 0.02);
  const minAbs = Number(process.env.OUTLOOK_RANGE_TOLERANCE_MIN || 0);
  const fromPct = span > 0 ? span * pct : 0;
  try {
    const priceTick = require('./price-tick');
    const tick = priceTick.getTickSize?.(instrumentId) ?? 0;
    return Math.max(fromPct, minAbs, tick * 2);
  } catch {
    return Math.max(fromPct, minAbs);
  }
}

/**
 * 入场价是否落在预测区间内（含小幅容差'
 */
function validateEntryInOutlookRange(opts = {}) {
  const entryPrice = Number(opts.entryPrice);
  const predLow = Number(opts.predLow);
  const predHigh = Number(opts.predHigh);
  const direction = opts.direction;

  if (!Number.isFinite(entryPrice)) {
    return { valid: false, reason: 'no_entry_price' };
  }
  if (!Number.isFinite(predLow) || !Number.isFinite(predHigh) || predLow >= predHigh) {
    return { valid: true, reason: 'no_band_skip_check', relaxed: true };
  }

  const tol = resolveRangeTolerance(opts.instrumentId, opts);
  const lo = predLow - tol;
  const hi = predHigh + tol;

  if (entryPrice < lo || entryPrice > hi) {
    return {
      valid: false,
      reason: 'entry_outside_outlook_range',
      entryPrice,
      predLow,
      predHigh,
      tolerance: tol,
      direction,
    };
  }

  return {
    valid: true,
    reason: 'in_range',
    entryPrice,
    predLow,
    predHigh,
    tolerance: tol,
  };
}

module.exports = {
  FORWARD_TO_OUTLOOK_SLOT,
  OUTLOOK_DISK_KEY,
  mapForwardSlot,
  resolveOutlookSessionDate,
  loadOutlookRangeForExport,
  validateEntryInOutlookRange,
  readLiveOutlookInstrument,
};
