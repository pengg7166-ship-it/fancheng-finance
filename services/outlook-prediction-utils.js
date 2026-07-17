/**
 * v1.49+ 研判预测模式 — 百分比波动情景（ENABLE_RANGE_PREDICTION=false）
 * 审计 / UI / 交易指导共用，避免绝对价区间与 pct 情景脱节。
 */
const priceTick = require('./price-tick');

function getOutlookPctRange(inst) {
  if (!inst || inst.outlookPending) return null;
  const pct = inst.nextDayRangePct;
  if (pct?.low != null && pct?.high != null && pct?.mid != null) return pct;
  const base = inst.scenarios?.base;
  if (base?.low != null && base?.high != null) {
    return {
      low: base.low,
      mid: base.mid ?? null,
      high: base.high,
      bias: base.bias,
      biasLabel: base.biasLabel,
      expectedMovePct: inst.nextDayRangePct?.expectedMovePct ?? null,
      dataSource: 'scenarios.base',
    };
  }
  return null;
}

function hasOutlookVolatilityForecast(inst) {
  return Boolean(getOutlookPctRange(inst));
}

function getInstrumentBaselineDate(inst) {
  const hl = inst?.nextDayPrediction || inst?.highLowPrediction || inst?.nextDayRange;
  return (
    hl?.baselineDate ||
    inst?.closingDate ||
    (inst?.judgementUpdatedAt ? String(inst.judgementUpdatedAt).slice(0, 10) : null) ||
    null
  );
}

function pctToAbsolutePrice(instId, basePrice, pctValue) {
  const base = Number(basePrice);
  const pct = Number(pctValue);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(pct)) return null;
  const raw = base * (1 + pct / 100);
  return priceTick.roundPriceToTick(instId, raw);
}

function deriveAbsoluteBandFromPct(inst) {
  const hl = inst?.nextDayPrediction || inst?.highLowPrediction || inst?.nextDayRange;
  if (hl?.predictedHigh != null && hl?.predictedLow != null) {
    return {
      ...hl,
      track: 'daily',
      sessionScope: hl.sessionScope || 'full-next-trading-day',
      dataSource: hl.dataSource || hl.method || 'highLowPrediction',
    };
  }
  const pct = getOutlookPctRange(inst);
  if (!pct) return null;
  const base = inst.price ?? inst.closingPrice ?? hl?.baseClose ?? null;
  if (base == null || Number(base) <= 0) {
    return {
      pctOnly: true,
      pct,
      predictedHigh: null,
      predictedLow: null,
      baseClose: null,
      baselineDate: getInstrumentBaselineDate(inst),
      method: 'nextDayRangePct',
      dataSource: 'nextDayRangePct',
      confidence: inst.confidence || null,
    };
  }
  const id = String(inst.id || '').toLowerCase();
  const predictedLow = pctToAbsolutePrice(id, base, pct.low);
  const predictedHigh = pctToAbsolutePrice(id, base, pct.high);
  if (predictedLow == null || predictedHigh == null) return null;
  return {
    pctOnly: false,
    pct,
    predictedLow: Math.min(predictedLow, predictedHigh),
    predictedHigh: Math.max(predictedLow, predictedHigh),
    baseClose: base,
    baselineDate: getInstrumentBaselineDate(inst),
    method: 'nextDayRangePct-derived',
    dataSource: 'nextDayRangePct',
    unit: inst.unit || '',
    confidence: inst.confidence || null,
    track: 'daily',
    sessionScope: 'pct-volatility-band',
  };
}

function resolveInvalidateFromPct(inst, bias) {
  const derived = deriveAbsoluteBandFromPct(inst);
  if (!derived) return null;
  const id = String(inst.id || '').toLowerCase();
  if (bias === '偏多' && derived.predictedLow != null) {
    return {
      price: derived.predictedLow,
      source: derived.dataSource || 'nextDayRangePct',
      asOf: derived.baselineDate || getInstrumentBaselineDate(inst),
    };
  }
  if (bias === '偏空' && derived.predictedHigh != null) {
    return {
      price: derived.predictedHigh,
      source: derived.dataSource || 'nextDayRangePct',
      asOf: derived.baselineDate || getInstrumentBaselineDate(inst),
    };
  }
  if (bias === '偏多' && derived.pct?.low != null && derived.baseClose != null) {
    const p = pctToAbsolutePrice(id, derived.baseClose, derived.pct.low);
    if (p != null) {
      return { price: p, source: 'nextDayRangePct', asOf: derived.baselineDate || null };
    }
  }
  if (bias === '偏空' && derived.pct?.high != null && derived.baseClose != null) {
    const p = pctToAbsolutePrice(id, derived.baseClose, derived.pct.high);
    if (p != null) {
      return { price: p, source: 'nextDayRangePct', asOf: derived.baselineDate || null };
    }
  }
  return null;
}

function auditPctVolatilityForecast(inst) {
  const id = String(inst.id || '').toLowerCase();
  const flags = [];
  const pct = getOutlookPctRange(inst);
  if (!pct) {
    flags.push({ code: 'missing_pct_forecast', severity: 'critical' });
    return { id, flags };
  }
  const low = Number(pct.low);
  const high = Number(pct.high);
  const mid = pct.mid != null ? Number(pct.mid) : null;
  if (Number.isNaN(low) || Number.isNaN(high)) {
    flags.push({ code: 'missing_pct_bounds', severity: 'critical' });
    return { id, flags };
  }
  if (low > high) flags.push({ code: 'inverted_pct_band', severity: 'critical', low, high });
  if (mid != null && !Number.isNaN(mid) && (mid < low - 0.01 || mid > high + 0.01)) {
    flags.push({ code: 'mid_outside_pct_band', severity: 'warning', mid, low, high });
  }
  const span = high - low;
  if (span > 8) flags.push({ code: 'pct_span_wide', severity: 'warning', span });
  if (span < 0.05) flags.push({ code: 'pct_span_narrow', severity: 'warning', span });
  return { id, flags, low, high, mid, span };
}

module.exports = {
  getOutlookPctRange,
  hasOutlookVolatilityForecast,
  getInstrumentBaselineDate,
  deriveAbsoluteBandFromPct,
  resolveInvalidateFromPct,
  auditPctVolatilityForecast,
  pctToAbsolutePrice,
};
