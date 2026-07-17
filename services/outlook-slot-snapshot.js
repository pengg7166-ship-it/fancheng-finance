/**
 * 固定时段 outlook 预测快照 'slot-snapshots/ + 方向/区间存档
 */
const fs = require('fs');
const path = require('path');
const slots = require('./outlook-prediction-slots');
const cnSession = require('./cn-futures-session-calendar');
const tradingSession = require('./trading-session-calendar');
const { getOutlookHistoryRoot, todayKey } = require('./commodity-outlook-history');

const REFERENCE_INSTRUMENT = 'au';

function getSlotSnapshotsRoot() {
  const root = getOutlookHistoryRoot();
  if (!root) return null;
  const dir = path.join(root, 'slot-snapshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slotSnapshotPath(sessionDate, slotId) {
  const root = getSlotSnapshotsRoot();
  if (!root) return null;
  return path.join(root, String(sessionDate).slice(0, 10), `${slotId}.json`);
}

function readSlotSnapshot(sessionDate, slotId) {
  const fp = slotSnapshotPath(sessionDate, slotId);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function hasSlotCapture(sessionDate, slotId) {
  return Boolean(readSlotSnapshot(sessionDate, slotId));
}

function loadReferenceBars() {
  try {
    const dirArchive = require('./direction-prediction-archive');
    return dirArchive.readKlineBars(REFERENCE_INSTRUMENT);
  } catch {
    return [];
  }
}

function resolveSlotPriceBand(inst) {
  const base = inst.scenarios?.base || inst.nextDayRangePct || {};
  const hl = inst.highLowPrediction || {};
  const baseline = hl.baseClose ?? hl.baseline ?? inst.price ?? null;
  const priceTick = require('./price-tick');

  let predictedHigh = hl.predictedHigh ?? null;
  let predictedLow = hl.predictedLow ?? null;

  if (predictedHigh != null && predictedLow != null) {
    predictedHigh = priceTick.roundPriceToTick(inst.id, predictedHigh);
    predictedLow = priceTick.roundPriceToTick(inst.id, predictedLow);
  } else if (baseline > 0 && base.low != null && base.high != null) {
    const prices = priceTick.pctBandToPrices({
      instrumentId: inst.id,
      baseClose: baseline,
      lowPct: base.low,
      highPct: base.high,
    });
    predictedHigh = prices.predictedHigh;
    predictedLow = prices.predictedLow;
  }

  return {
    predictedLow,
    predictedMid: base.mid ?? null,
    predictedHigh,
    predictedMidPct: base.mid ?? null,
    predictedLowPct: base.low ?? null,
    predictedHighPct: base.high ?? null,
    baseline,
  };
}

function computeCaptureDelayMinutes(slotMeta, now = new Date()) {
  const predictMs = new Date(slotMeta?.predictTs).getTime();
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (Number.isNaN(predictMs) || Number.isNaN(nowMs)) return 0;
  return Math.max(0, Math.round((nowMs - predictMs) / 60000));
}

/**
 * 优先'predictTs 时刻'JSONL 历史快照；无历史时用 live（并标记延迟捕获'
 */
function resolveInstrumentForSlotCapture(liveInst, slotMeta, opts = {}) {
  const outlookHistory = require('./commodity-outlook-history');
  const delayMin = computeCaptureDelayMinutes(slotMeta, opts.now || new Date());
  const isLateCapture = delayMin > slots.CAPTURE_TOLERANCE_MINUTES;

  const lookup = outlookHistory.lookupOutlookAtTimestamp(liveInst.id, slotMeta.predictTs, {
    lookbackDays: opts.lookbackDays ?? 10,
  });
  if (lookup?.snapshot) {
    const reconstructed = outlookHistory.historySnapshotToInstrumentShape(lookup.snapshot, liveInst);
    if (reconstructed) {
      return {
        inst: reconstructed,
        captureSource: lookup.source,
        lookupTs: lookup.lookupTs,
        captureDelayMinutes: delayMin,
        isLateCapture,
      };
    }
  }

  return {
    inst: liveInst,
    captureSource: isLateCapture ? 'live-fallback-late' : 'live',
    lookupTs: null,
    captureDelayMinutes: delayMin,
    isLateCapture,
  };
}

function buildSlotInstrumentEntry(inst, slotMeta, captureMeta = {}) {
  const band = resolveSlotPriceBand(inst);
  const sessionWindow = tradingSession.getSessionWindow(
    inst.id,
    slotMeta.id,
    slotMeta.sessionDate,
    { captureDate: slotMeta.captureDate }
  );
  return {
    id: inst.id,
    name: inst.name,
    sector: inst.sector || null,
    predictedLow: band.predictedLow,
    predictedMid: band.predictedMid,
    predictedHigh: band.predictedHigh,
    predictedMidPct: band.predictedMidPct,
    predictedLowPct: band.predictedLowPct,
    predictedHighPct: band.predictedHighPct,
    direction: inst.directionTier || inst.direction || null,
    directionLabel: inst.directionLabel || null,
    compositeScore: inst.compositeScore ?? null,
    priceAtPredict: inst.price ?? null,
    baseClose: band.baseline ?? inst.price ?? null,
    ts: slotMeta.predictTs,
    predictTs: slotMeta.predictTs,
    predictionSlot: slotMeta.id,
    predictionSlotLabel: slotMeta.label,
    sessionDate: slotMeta.sessionDate,
    captureDate: slotMeta.captureDate,
    sessionWindowLabel: sessionWindow?.label || null,
    sessionWindowStart: sessionWindow?.start || null,
    sessionWindowEnd: sessionWindow?.end || null,
    captureSource: captureMeta.captureSource || null,
    lookupTs: captureMeta.lookupTs || null,
    captureDelayMinutes: captureMeta.captureDelayMinutes ?? null,
    isLateCapture: captureMeta.isLateCapture === true,
  };
}

function appendSlotAuditArchive(payload) {
  const root = getOutlookHistoryRoot();
  if (!root || !payload?.sessionDate) return { wrote: false };
  const dir = path.join(root, 'slot-audit-archive');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${String(payload.sessionDate).slice(0, 10)}.jsonl`);
  const line =
    JSON.stringify({
      archivedAt: new Date().toISOString(),
      sessionDate: payload.sessionDate,
      predictionSlot: payload.predictionSlot,
      predictionSlotLabel: payload.predictionSlotLabel,
      predictTs: payload.predictTs,
      captureSource: payload.captureSource,
      captureDelayMinutes: payload.captureDelayMinutes,
      isLateCapture: payload.isLateCapture,
      instrumentCount: payload.instrumentCount,
      savedAt: payload.savedAt,
    }) + '\n';
  fs.appendFileSync(fp, line, 'utf8');
  return { wrote: true, path: fp };
}

function writeSlotSnapshotFile(sessionDate, slotId, payload) {
  const fp = slotSnapshotPath(sessionDate, slotId);
  if (!fp) return { wrote: false, path: null };
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return { wrote: true, path: fp };
}

function syncDirectionArchiveFromSlot(sessionDate, slotMeta, rows) {
  try {
    const dirArchive = require('./direction-prediction-archive');
    let synced = 0;
    for (const entry of rows) {
      if (!entry?.id) continue;
      const result = dirArchive.recordFromSlotEntry(entry, {
        baselineDate: sessionDate,
        slotMeta,
      });
      if (result.recorded) synced += 1;
    }
    return { synced };
  } catch {
    return { synced: 0 };
  }
}

function syncRangeArchiveFromSlot(sessionDate, slotMeta, rows) {
  try {
    const rangeArchive = require('./range-prediction-archive');
    let synced = 0;
    for (const entry of rows) {
      if (!entry?.id) continue;
      const result = rangeArchive.recordSlotPrediction({
        instrumentId: entry.id,
        sessionDate,
        baselineDate: slotMeta.captureDate,
        baseClose: entry.baseClose ?? entry.priceAtPredict,
        predHigh: entry.predictedHigh,
        predLow: entry.predictedLow,
        predMidPct: entry.predictedMid ?? entry.predictedMidPct,
        predictionSlot: slotMeta.id,
        predictionSlotLabel: slotMeta.label,
        predictTs: slotMeta.predictTs,
        meta: {
          sessionWindowLabel: entry.sessionWindowLabel,
          sessionWindowStart: entry.sessionWindowStart,
          sessionWindowEnd: entry.sessionWindowEnd,
          captureSource: entry.captureSource,
          lookupTs: entry.lookupTs,
          captureDelayMinutes: entry.captureDelayMinutes,
          isLateCapture: entry.isLateCapture,
        },
      });
      if (result.recorded) synced += 1;
    }
    return { synced };
  } catch {
    return { synced: 0 };
  }
}

function stampInstrumentsWithSlot(instruments, slotMeta) {
  if (!Array.isArray(instruments) || !slotMeta) return instruments;
  return instruments.map((inst) => ({
    ...inst,
    predictionSlot: slotMeta.id,
    predictionSlotLabel: slotMeta.label,
    predictionSessionDate: slotMeta.sessionDate,
    slotPredictTs: slotMeta.predictTs,
  }));
}

/**
 * @param {string} slotId
 * @param {{ instruments?: object[], force?: boolean, sessionDate?: string, captureDate?: string, now?: Date }} opts
 */
function captureOutlookPredictionSnapshot(slotId, opts = {}) {
  const slot = slots.getSlotById(slotId);
  if (!slot) return { captured: false, reason: 'unknown_slot', slotId };

  const referenceBars = loadReferenceBars();
  const cnParts = cnSession.getCnNowParts(opts.now);
  const slotMeta = slots.buildSlotMeta(slotId, {
    cnParts,
    now: opts.now,
    sessionDate: opts.sessionDate,
    captureDate: opts.captureDate || cnParts.date,
    referenceBars,
    predictTs: opts.predictTs,
  });
  if (!slotMeta?.sessionDate) {
    return { captured: false, reason: 'no_session_date', slotId };
  }

  const sessionDate = String(slotMeta.sessionDate).slice(0, 10);
  if (hasSlotCapture(sessionDate, slotId) && !opts.force) {
    return {
      captured: false,
      reason: 'already_captured',
      slotId,
      sessionDate,
      path: slotSnapshotPath(sessionDate, slotId),
    };
  }

  const instruments = (opts.instruments || []).filter((i) => i?.id && !i.outlookPending);
  if (!instruments.length) {
    return { captured: false, reason: 'no_instruments', slotId, sessionDate };
  }

  const captureNow = opts.now || new Date();
  const resolved = instruments.map((liveInst) => resolveInstrumentForSlotCapture(liveInst, slotMeta, opts));
  const rows = resolved.map(({ inst, ...captureMeta }) => buildSlotInstrumentEntry(inst, slotMeta, captureMeta));
  const captureSources = [...new Set(resolved.map((r) => r.captureSource))];
  const maxDelay = Math.max(...resolved.map((r) => r.captureDelayMinutes || 0));
  const anyLate = resolved.some((r) => r.isLateCapture);

  const payload = {
    sessionDate,
    captureDate: slotMeta.captureDate,
    predictionSlot: slotMeta.id,
    predictionSlotLabel: slotMeta.label,
    predictTs: slotMeta.predictTs,
    savedAt: new Date().toISOString(),
    captureSource: captureSources.length === 1 ? captureSources[0] : 'mixed',
    captureDelayMinutes: maxDelay,
    isLateCapture: anyLate,
    isRecapture: Boolean(opts.force && hasSlotCapture(sessionDate, slotId)),
    instrumentCount: rows.length,
    instruments: rows,
  };

  const write = writeSlotSnapshotFile(sessionDate, slotId, payload);
  appendSlotAuditArchive(payload);
  const dirSync = syncDirectionArchiveFromSlot(sessionDate, slotMeta, rows);
  const rangeSync = syncRangeArchiveFromSlot(sessionDate, slotMeta, rows);

  return {
    captured: true,
    slotId,
    sessionDate,
    path: write.path,
    instrumentCount: rows.length,
    directionSynced: dirSync.synced,
    rangeSynced: rangeSync.synced,
    slotMeta,
  };
}

function listSlotSnapshotsForSession(sessionDate) {
  const root = getSlotSnapshotsRoot();
  const day = String(sessionDate || '').slice(0, 10);
  const dir = root ? path.join(root, day) : null;
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.predictTs).localeCompare(String(b.predictTs)));
}

function getLatestSlotCaptureMeta(sessionDate = todayKey()) {
  const snaps = listSlotSnapshotsForSession(sessionDate);
  if (!snaps.length) return null;
  const last = snaps[snaps.length - 1];
  return {
    predictionSlot: last.predictionSlot,
    predictionSlotLabel: last.predictionSlotLabel,
    predictTs: last.predictTs,
    sessionDate: last.sessionDate,
    instrumentCount: last.instrumentCount,
  };
}

module.exports = {
  getSlotSnapshotsRoot,
  slotSnapshotPath,
  readSlotSnapshot,
  hasSlotCapture,
  computeCaptureDelayMinutes,
  resolveInstrumentForSlotCapture,
  buildSlotInstrumentEntry,
  resolveSlotPriceBand,
  captureOutlookPredictionSnapshot,
  listSlotSnapshotsForSession,
  getLatestSlotCaptureMeta,
  stampInstrumentsWithSlot,
  syncDirectionArchiveFromSlot,
  syncRangeArchiveFromSlot,
  appendSlotAuditArchive,
};
