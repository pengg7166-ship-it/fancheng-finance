/**
 * 跨境点位 + 本地 realized vol 混合幅度 'AU/AG 相对昨收
 *
 * 点位：cross-market inferPointChangeFromClose（COMEX+London+CNH'
 * 带宽：SHFE 20 'mean_abs realized vol（元/—'千克'
 * 强跨境（|隔夜国际|>0.5%）：±1σ 围绕跨境隐含'
 * 弱信号：±1σ 围绕昨收（vol-only'
 */

const crossMarket = require('./cross-market-precious-inference');

const MAGNITUDE_VERSION = 'v0.2-regime-vol-window';
const VOL_WINDOW = 20;
const VOL_MODE = 'mean_abs';
/** 'regime vol 窗口 'event 短窗 / trend 中窗 / basis·range 默认 20d */
const REGIME_VOL_WINDOW = {
  event: 10,
  trend: 15,
  basis: 20,
  range: 20,
  seasonal: 20,
};

function resolveVolWindow(regime, override) {
  if (override != null && override > 0) return override;
  const r = String(regime || '').toLowerCase();
  return REGIME_VOL_WINDOW[r] ?? VOL_WINDOW;
}
const INTL_CHG_STRONG_PCT = 0.5;
const INTL_CHG_MID_PCT = 0.25;

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

/** 日历日可能晚于最'SHFE K 线（周末/节假'行情未落盘）—'asOfDate 的最近一根算 vol */
function resolveBarIdx(bars, asOfDate) {
  if (!bars?.length) return -1;
  const exact = bars.findIndex((b) => normBarDate(b) === asOfDate);
  if (exact >= 0) return exact;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (normBarDate(bars[i]) <= asOfDate) return i;
  }
  return bars.length - 1;
}

function computeRealizedVol(bars, idx, window = VOL_WINDOW, mode = VOL_MODE) {
  if (!bars || idx < window) return null;
  const rets = [];
  for (let i = idx - window + 1; i <= idx; i += 1) {
    const prev = bars[i - 1]?.close;
    const now = bars[i]?.close;
    if (!prev || !now) continue;
    rets.push(((now - prev) / prev) * now);
  }
  if (rets.length < Math.max(3, window - 2)) return null;
  if (mode === 'std') {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return Math.sqrt(variance);
  }
  return rets.reduce((a, b) => a + Math.abs(b), 0) / rets.length;
}

function overnightIntlChgPct(infer) {
  const comp = infer?.components || {};
  const prev = comp.intlDeltaPrev ?? comp.intlLevelPrev;
  const now = comp.intlDeltaNow ?? comp.intlLevelNow;
  if (!prev || now == null) return null;
  return ((now - prev) / prev) * 100;
}

function confidenceLabel(absOvernightPct) {
  if (absOvernightPct == null) return '';
  if (absOvernightPct >= INTL_CHG_STRONG_PCT) return '';
  if (absOvernightPct >= INTL_CHG_MID_PCT) return '';
  return '';
}

/**
 * @param {{
 *   instrumentId: 'au'|'ag',
 *   close?: number,
 *   asOfDate?: string,
 *   crossMarketCtx?: object,
 *   priceHistory?: Array<{date?:string,time?:string,close:number}>,
 * }} opts
 */
function predictMagnitude(opts = {}) {
  const id = String(opts.instrumentId || '').toLowerCase();
  const asOfDate = opts.asOfDate || new Date().toISOString().slice(0, 10);
  const unit = id === 'au' ? '元/克' : '元/千克';
  const digits = id === 'au' ? 2 : 1;

  let bars = opts.priceHistory;
  if (!bars?.length) {
    bars = crossMarket.loadTradingBars(id);
  }

  const volWindow = resolveVolWindow(opts.marketRegime, opts.volWindow);
  const barIdx = resolveBarIdx(bars, asOfDate);
  const sigma = barIdx >= volWindow ? computeRealizedVol(bars, barIdx, volWindow, VOL_MODE) : null;

  let infer = opts.crossMarketCtx;
  if (!infer) {
    try {
      infer = crossMarket.inferPointChangeFromClose(asOfDate, id);
    } catch {
      infer = { gated: true, gateReason: 'inference_error' };
    }
  }

  const overnightPct = overnightIntlChgPct(infer);
  const absOvernight = overnightPct != null ? Math.abs(overnightPct) : null;
  const strongCross = absOvernight != null && absOvernight > INTL_CHG_STRONG_PCT;
  const crossOk = infer && !infer.gated && infer.predictedDelta != null;

  const close =
    Number(opts.close) > 0
      ? Number(opts.close)
      : infer?.shfePrevClose != null
        ? Number(infer.shfePrevClose)
        : barIdx >= 0
          ? Number(bars[barIdx]?.close)
          : null;

  let pointDelta = null;
  let source = 'vol';
  let bandCenter = close;

  if (crossOk && strongCross) {
    pointDelta = infer.predictedDelta;
    source = 'cross';
    bandCenter = close != null ? close + pointDelta : infer.predictedClose;
  } else if (crossOk && absOvernight != null) {
    pointDelta = infer.predictedDelta;
    source = 'hybrid';
    bandCenter = close != null ? close + pointDelta : infer.predictedClose;
  } else if (close != null) {
    pointDelta = crossOk ? infer.predictedDelta : null;
    source = 'vol';
    bandCenter = close;
  }

  const sigmaVal = sigma != null ? +sigma.toFixed(digits) : null;
  let bandLow = null;
  let bandHigh = null;
  if (bandCenter != null && sigmaVal != null) {
    bandLow = +(bandCenter - sigmaVal).toFixed(digits);
    bandHigh = +(bandCenter + sigmaVal).toFixed(digits);
  }

  const roundPt = (v) => (v != null ? +Number(v).toFixed(digits) : null);

  return {
    version: MAGNITUDE_VERSION,
    instrumentId: id,
    unit,
    date: asOfDate,
    close: roundPt(close),
    pointDelta: roundPt(pointDelta),
    predictedClose: roundPt(bandCenter),
    bandLow,
    bandHigh,
    sigma: sigmaVal,
    volWindow,
    volMode: VOL_MODE,
    source,
    confidence: confidenceLabel(absOvernight),
    overnightIntlChgPct: overnightPct != null ? +overnightPct.toFixed(3) : null,
    highConfidence: strongCross,
    crossGated: infer?.gated ?? true,
    gateReason: infer?.gateReason || null,
  };
}

module.exports = {
  MAGNITUDE_VERSION,
  VOL_WINDOW,
  REGIME_VOL_WINDOW,
  resolveVolWindow,
  resolveBarIdx,
  VOL_MODE,
  INTL_CHG_STRONG_PCT,
  computeRealizedVol,
  predictMagnitude,
};
