/**
 * 研判标签 '双轨口径（v1.34'
 * 'KPI：T+3 趋势方向（computeT3TrendLabel'
 * 对比轨：T+1 方向（computeT1Direction，保留与'longrun 可比'
 */
const LABELS_VERSION = 'v1.34.1';

/** 'commodity-outlook-backtest.directionFromReturn 一'*/
const DIRECTION_THRESHOLD_PCT = 0.05;

const EVENT_WINDOW = {
  shock_event: { pre: 1, post: 5 },
  narrative_theme: { pre: 0, post: 20 },
  routine: null,
};

function directionFromReturnPct(pct, thresholdPct = DIRECTION_THRESHOLD_PCT) {
  if (pct == null || Number.isNaN(pct)) return null;
  if (pct > thresholdPct) return 'bullish';
  if (pct < -thresholdPct) return 'bearish';
  return 'neutral';
}

/**
 * 通用 horizon 方向标签
 * @param {Array<{ close?: number, date?: string }>} bars
 * @param {number} barIndex
 * @param {number} horizon '交易日偏移（1=T+1'=T+3'
 */
function computeHorizonDirection(bars, barIndex, horizon, opts = {}) {
  const thresholdPct = opts.thresholdPct ?? DIRECTION_THRESHOLD_PCT;
  const bar = bars?.[barIndex];
  const endBar = bars?.[barIndex + horizon];
  if (!bar?.close || !endBar?.close) {
    return {
      label: null,
      direction: null,
      returnPct: null,
      horizon,
      barDate: bar?.date ?? null,
      barDateEnd: endBar?.date ?? null,
    };
  }
  const returnPct = ((Number(endBar.close) - Number(bar.close)) / Number(bar.close)) * 100;
  const direction = directionFromReturnPct(returnPct, thresholdPct);
  return {
    label: direction,
    direction,
    returnPct: +returnPct.toFixed(4),
    horizon,
    barDate: bar.date ?? null,
    barDateEnd: endBar.date ?? null,
  };
}

/**
 * 'KPI：T+3 趋势方向标签
 */
function computeT3TrendLabel(bars, barIndex, opts = {}) {
  return computeHorizonDirection(bars, barIndex, opts.horizon ?? 3, opts);
}

/** @deprecated 别名，请'computeT3TrendLabel */
function computeT3TrendDirection(bars, barIndex, opts = {}) {
  return computeT3TrendLabel(bars, barIndex, opts);
}

/**
 * 对比轨：T+1 方向（保留与旧回'longrun 可比'
 */
function computeT1Direction(bars, barIndex, opts = {}) {
  return computeHorizonDirection(bars, barIndex, 1, opts);
}

/**
 * 双轨标签 '同一信号日同时产'T+1 'T+3
 */
function computeDualLabels(bars, barIndex, opts = {}) {
  const t1 = computeT1Direction(bars, barIndex, opts);
  const t3 = computeT3TrendLabel(bars, barIndex, opts);
  return {
    barDate: t1.barDate ?? t3.barDate,
    t1,
    t3,
    labelPrimary: t3.label,
    labelCompare: t1.label,
  };
}

/**
 * 事件窗口标签 'shock ±5 / narrative +20
 * @param {string} barDate 'YYYY-MM-DD
 * @param {string} eventDate '事件'
 * @param {'shock_event'|'narrative_theme'|'routine'} archetype
 */
function computeEventWindowLabel(barDate, eventDate, archetype = 'routine') {
  const win = EVENT_WINDOW[archetype];
  if (!win || !barDate || !eventDate) {
    return { inWindow: false, archetype, windowStart: null, windowEnd: null };
  }
  const t0 = new Date(`${eventDate}T12:00:00`);
  const t = new Date(`${barDate}T12:00:00`);
  const dayMs = 86400000;
  const start = new Date(t0.getTime() - win.pre * dayMs);
  const end = new Date(t0.getTime() + win.post * dayMs);
  const inWindow = t >= start && t <= end;
  return {
    inWindow,
    archetype,
    windowStart: start.toISOString().slice(0, 10),
    windowEnd: end.toISOString().slice(0, 10),
  };
}

function hitDirection(predicted, actual) {
  if (!predicted || !actual || predicted === 'neutral' || actual === 'neutral') return null;
  return predicted === actual;
}

module.exports = {
  LABELS_VERSION,
  DIRECTION_THRESHOLD_PCT,
  EVENT_WINDOW,
  directionFromReturnPct,
  computeHorizonDirection,
  computeT3TrendLabel,
  computeT3TrendDirection,
  computeT1Direction,
  computeDualLabels,
  computeEventWindowLabel,
  hitDirection,
};
