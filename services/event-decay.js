/**
 * Event decay — retail cannot trade T+0 edge forever.
 * Policy/news age → edge weight decays; stale events cap W level and posture.
 */
const EVENT_DECAY_VERSION = 'v1.46.0-retail-hf';

/** Edge weight by age in days: T+0 100%, T+5 50%, T+10 25% */
const DECAY_ANCHORS = Object.freeze([
  { days: 0, weight: 1.0 },
  { days: 5, weight: 0.5 },
  { days: 10, weight: 0.25 },
]);

const STALE_MAX_DAYS = 10;
const WATCH_CAP_BY_WEIGHT = Object.freeze({
  high: 'W4',
  mid: 'W3',
  low: 'W2',
  stale: 'W1',
});

function nowIso() {
  return new Date().toISOString();
}

function daysSince(isoOrMs) {
  if (!isoOrMs) return null;
  const ts = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / (24 * 3600 * 1000);
}

/**
 * Interpolate decay weight from anchor table.
 * @param {number} ageDays
 */
function computeEventDecayWeight(ageDays) {
  if (ageDays == null || ageDays < 0) return null;
  if (ageDays >= STALE_MAX_DAYS) return DECAY_ANCHORS[DECAY_ANCHORS.length - 1].weight;
  for (let i = 0; i < DECAY_ANCHORS.length - 1; i++) {
    const a = DECAY_ANCHORS[i];
    const b = DECAY_ANCHORS[i + 1];
    if (ageDays >= a.days && ageDays <= b.days) {
      const t = (ageDays - a.days) / (b.days - a.days);
      return +(a.weight + t * (b.weight - a.weight)).toFixed(3);
    }
  }
  return DECAY_ANCHORS[0].weight;
}

function weightBand(weight) {
  if (weight == null) return 'unknown';
  if (weight >= 0.75) return 'high';
  if (weight >= 0.4) return 'mid';
  if (weight >= 0.2) return 'low';
  return 'stale';
}

/**
 * @param {object} event '{ fetchedAt, createdAt, confirmedByPrice, confirmedByInventory }'
 */
function computeEventDecay(event = {}) {
  const asOf = nowIso();
  const ageDays = daysSince(event.fetchedAt || event.createdAt || event.at);
  const weight = ageDays != null ? computeEventDecayWeight(ageDays) : null;
  const priceConfirm = event.confirmedByPrice === true || event.priceConfirm === true;
  const inventoryConfirm = event.confirmedByInventory === true || event.inventoryConfirm === true;
  const hasConfirm = priceConfirm || inventoryConfirm;

  let band = weightBand(weight);
  let maxPosture = '试仓';
  let watchCap = WATCH_CAP_BY_WEIGHT[band] || 'W2';
  let staleRule = null;

  if (ageDays != null && ageDays >= STALE_MAX_DAYS && !hasConfirm) {
    band = 'stale';
    maxPosture = '观望';
    watchCap = 'W1';
    staleRule = 'stale event without price/inventory confirm → max 观望';
  } else if (band === 'stale' && !hasConfirm) {
    maxPosture = '观望';
    watchCap = 'W1';
    staleRule = 'stale event without price/inventory confirm → max 观望';
  } else if (band === 'low' && !hasConfirm) {
    maxPosture = '试仓';
    watchCap = 'W2';
  }

  return {
    ageDays: ageDays != null ? +ageDays.toFixed(1) : null,
    edgeWeight: weight,
    weightPct: weight != null ? Math.round(weight * 100) : null,
    band,
    maxPosture,
    watchCap,
    staleRule,
    priceConfirm,
    inventoryConfirm,
    badge: band === 'stale' || (band === 'low' && !hasConfirm) ? '事件衰减' : null,
    evidence: [
      ageDays != null ? `事件年龄 ${Math.round(ageDays)}d · 权重 ${weight != null ? (weight * 100).toFixed(0) : '—'}%` : '事件年龄待校验',
      hasConfirm ? '价格/库存已确认' : '无价格库存确认',
      staleRule || `W cap → ${watchCap}`,
    ],
    dataSource: 'event-decay',
    method: 'T0-T5-T10-decay+confirm-gate',
    version: EVENT_DECAY_VERSION,
    asOf,
  };
}

/**
 * Apply decay to research pool priority score (multiplier, not fake fill).
 */
function applyEventDecayToPriority(priorityScore, decay) {
  if (priorityScore == null || decay?.edgeWeight == null) return priorityScore;
  return Math.round(priorityScore * (0.5 + 0.5 * decay.edgeWeight));
}

/**
 * Cap watch level by event decay.
 */
function applyEventDecayToWatchLevel(watchLevel, decay) {
  if (!decay?.watchCap) return watchLevel;
  const order = ['W0', 'W1', 'W2', 'W3', 'W4', 'O2'];
  const cur = order.indexOf(watchLevel);
  const cap = order.indexOf(decay.watchCap);
  if (cur < 0 || cap < 0) return watchLevel;
  return order[Math.min(cur, cap)];
}

/**
 * Derive decay from instrument integrated spec / pool entry.
 */
function computeEventDecayForInstrument(inst, context = {}) {
  const pool = inst?.integratedSpec?.poolStatus || context.poolStatus;
  const hardPolicy = inst?.integratedSpec?.hardPolicy || context.hardPolicy;
  const geo = inst?.integratedSpec?.geoDecay;

  const event = {
    fetchedAt: pool?.triggeredAt || pool?.addedAt || hardPolicy?.asOf,
    confirmedByPrice: !!(inst?.tradingGuidance?.phase === '升温' || inst?.capitalAttention?.score >= 55),
    confirmedByInventory: !!(inst?.factors?.inventory?.signal || inst?.warehouseTrend),
  };
  if (geo?.decayFactor != null && geo.decayFactor < 0.5) {
    event.fetchedAt = event.fetchedAt || geo.asOf;
  }
  return computeEventDecay(event);
}

module.exports = {
  EVENT_DECAY_VERSION,
  DECAY_ANCHORS,
  STALE_MAX_DAYS,
  computeEventDecayWeight,
  computeEventDecay,
  applyEventDecayToPriority,
  applyEventDecayToWatchLevel,
  computeEventDecayForInstrument,
};
