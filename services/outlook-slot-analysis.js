/**
 * 按固定预测时段对比命中率 '方向 T+1 + 区间 band
 */
const { OUTLOOK_INSTRUMENTS } = require('./commodity-outlook-engine');
const slots = require('./outlook-prediction-slots');

function analyzeSlotHitRates(opts = {}) {
  const dirArchive = require('./direction-prediction-archive');
  const rangeArchive = require('./range-prediction-archive');

  const instrumentIds = opts.instruments?.length
    ? opts.instruments.map((i) => String(i.id || i).toLowerCase())
    : OUTLOOK_INSTRUMENTS.map((s) => s.id);

  const dateRange = {};
  if (opts.from) dateRange.from = opts.from;
  if (opts.to) dateRange.to = opts.to;

  const bySlot = {};
  for (const slot of slots.getAllSlots()) {
    bySlot[slot.id] = {
      slotId: slot.id,
      label: slot.label,
      direction: { scored: 0, hits: 0, hitRate: null },
      range: { scored: 0, hits: 0, hitRate: null },
      instruments: instrumentIds.length,
    };
  }

  for (const id of instrumentIds) {
    const dirRows = dirArchive.loadArchive(id, dateRange).filter((r) => r.predictionSlot);
    for (const row of dirRows) {
      const bucket = bySlot[row.predictionSlot];
      if (!bucket) continue;
      if (row.predictedDir && row.predictedDir !== 'neutral' && row.hitDirection != null) {
        bucket.direction.scored += 1;
        if (row.hitDirection) bucket.direction.hits += 1;
      }
    }

    const rangeRows = rangeArchive.loadArchive(id, dateRange).filter((r) => r.predictionSlot);
    for (const row of rangeRows) {
      const bucket = bySlot[row.predictionSlot];
      if (!bucket) continue;
      if (row.bandHit != null) {
        bucket.range.scored += 1;
        if (row.bandHit) bucket.range.hits += 1;
      }
    }
  }

  for (const bucket of Object.values(bySlot)) {
    if (bucket.direction.scored) {
      bucket.direction.hitRate = +(bucket.direction.hits / bucket.direction.scored).toFixed(4);
    }
    if (bucket.range.scored) {
      bucket.range.hitRate = +(bucket.range.hits / bucket.range.scored).toFixed(4);
    }
  }

  return {
    analyzedAt: new Date().toISOString(),
    instrumentCount: instrumentIds.length,
    dateRange,
    bySlot: Object.values(bySlot),
  };
}

module.exports = { analyzeSlotHitRates };
