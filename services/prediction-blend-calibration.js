/**
 * Dual-track prediction comparison: next-day (full session) vs slot snapshots.
 * Foundation for weighted blend calibration 'metrics stored for deviation analysis.
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const BLEND_VERSION = 'prediction-blend-v1';

function blendMetricsPath() {
  const base = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(base, 'outlook-models', 'prediction-blend-metrics.jsonl');
}

function midPrice(pred) {
  if (!pred?.predictedHigh || !pred?.predictedLow) return null;
  return (Number(pred.predictedHigh) + Number(pred.predictedLow)) / 2;
}

function spread(pred) {
  if (!pred?.predictedHigh || !pred?.predictedLow) return null;
  return Math.abs(Number(pred.predictedHigh) - Number(pred.predictedLow));
}

/**
 * Compare daily nextDayPrediction against one or more slot snapshot entries.
 * @param {{ nextDayPrediction?: object, slotPredictions?: object[] }} opts
 */
function compareDailyVsSlots(opts = {}) {
  const daily = opts.nextDayPrediction || opts.highLowPrediction || null;
  if (!daily?.predictedHigh || !daily?.predictedLow) return null;

  const slots = (opts.slotPredictions || []).filter(
    (s) => s?.predictedHigh != null && s?.predictedLow != null
  );
  if (!slots.length) {
    return {
      version: BLEND_VERSION,
      instrumentId: opts.instrumentId || daily.instrumentId || null,
      hasSlots: false,
      dailyMid: midPrice(daily),
      dailySpread: spread(daily),
      slotCount: 0,
      gaps: [],
      suggestedDailyWeight: 1,
      suggestedSlotWeight: 0,
    };
  }

  const dailyMid = midPrice(daily);
  const dailySpread = spread(daily);
  const gaps = slots.map((slot) => {
    const slotMid = midPrice(slot);
    const slotSpread = spread(slot);
    return {
      slotId: slot.predictionSlot || slot.slotId || null,
      slotLabel: slot.predictionSlotLabel || slot.slotLabel || null,
      midGap: slotMid != null && dailyMid != null ? +(slotMid - dailyMid).toFixed(4) : null,
      spreadGap: slotSpread != null && dailySpread != null ? +(slotSpread - dailySpread).toFixed(4) : null,
      highGap:
        slot.predictedHigh != null && daily.predictedHigh != null
          ? +(Number(slot.predictedHigh) - Number(daily.predictedHigh)).toFixed(4)
          : null,
      lowGap:
        slot.predictedLow != null && daily.predictedLow != null
          ? +(Number(slot.predictedLow) - Number(daily.predictedLow)).toFixed(4)
          : null,
    };
  });

  const avgAbsMidGap =
    gaps.filter((g) => g.midGap != null).reduce((s, g) => s + Math.abs(g.midGap), 0) /
    Math.max(1, gaps.filter((g) => g.midGap != null).length);

  const base = daily.baseClose ?? daily.baseline ?? 1;
  const relGap = base > 0 ? avgAbsMidGap / base : 0;
  const suggestedDailyWeight = relGap > 0.012 ? 0.55 : relGap > 0.006 ? 0.65 : 0.75;
  const suggestedSlotWeight = +(1 - suggestedDailyWeight).toFixed(3);

  return {
    version: BLEND_VERSION,
    instrumentId: opts.instrumentId || daily.instrumentId || null,
    hasSlots: true,
    dailyMid,
    dailySpread,
    slotCount: slots.length,
    avgAbsMidGap: +avgAbsMidGap.toFixed(4),
    relMidGapPct: +(relGap * 100).toFixed(4),
    gaps,
    suggestedDailyWeight,
    suggestedSlotWeight,
  };
}

function appendBlendMetrics(record) {
  if (!record?.instrumentId) return { wrote: false };
  const fp = blendMetricsPath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const line =
    JSON.stringify({
      ...record,
      archivedAt: new Date().toISOString(),
    }) + '\n';
  fs.appendFileSync(fp, line, 'utf8');
  return { wrote: true, path: fp };
}

/**
 * Attach blend comparison to instrument row (non-blocking metrics append).
 */
function attachBlendComparison(inst, slotPredictions = []) {
  if (!inst) return inst;
  const comparison = compareDailyVsSlots({
    instrumentId: inst.id,
    nextDayPrediction: inst.nextDayPrediction || inst.highLowPrediction,
    slotPredictions,
  });
  if (!comparison) return inst;
  if (comparison.hasSlots && comparison.slotCount > 0) {
    try {
      appendBlendMetrics(comparison);
    } catch {
      // non-fatal
    }
  }
  return { ...inst, predictionBlend: comparison };
}

module.exports = {
  BLEND_VERSION,
  blendMetricsPath,
  compareDailyVsSlots,
  appendBlendMetrics,
  attachBlendComparison,
};
