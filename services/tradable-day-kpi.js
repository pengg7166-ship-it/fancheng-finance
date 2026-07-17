/**
 * Tradable-day KPI — SHFE calendar-aligned subset metrics with sample n.
 * No fake fill: missing actuals excluded from scored counts.
 */
const crossMarket = require('./cross-market-precious-inference');
const cnSession = require('./cn-futures-session-calendar');
const { hitDirection } = require('./outlook-labels');

const KPI_VERSION = 'v1.47.0-tradable-day-kpi';
const HIGH_CONF_INTL_PCT = 0.5;
const TARGET_T3_HIT_PCT = 70;

function nowIso() {
  return new Date().toISOString();
}

function fmtHitRateWithSample(hits, scored) {
  if (scored == null || scored <= 0) {
    return { hits: hits ?? 0, scored: 0, hitRatePct: null, formatted: '暂无' };
  }
  const h = hits ?? 0;
  const pct = +((h / scored) * 100).toFixed(2);
  return { hits: h, scored, hitRatePct: pct, formatted: `${pct}% (${h}/${scored})` };
}

function mkBucket() {
  return { hits: 0, scored: 0, hitRatePct: null };
}

function overnightIntlPct(row) {
  if (row.overnightIntlPct != null && !Number.isNaN(Number(row.overnightIntlPct))) {
    return Number(row.overnightIntlPct);
  }
  const infer = crossMarket.inferPointChangeFromClose(row.date, row.instrumentId);
  const prev = infer?.components?.intlLevelPrev;
  const now = infer?.components?.intlLevelNow;
  if (!prev || !now) return null;
  return Math.abs(((now - prev) / prev) * 100);
}

/**
 * Tradable-day OR definition (probe-tradable-day-kpi.js aligned).
 */
function evaluateTradableDay(ctx = {}) {
  const reasons = [];
  const intlPct = ctx.overnightIntlPct != null ? ctx.overnightIntlPct : overnightIntlPct(ctx);
  const highIntl = intlPct != null && intlPct >= HIGH_CONF_INTL_PCT;
  if (highIntl) reasons.push(`overnight_intl>=${HIGH_CONF_INTL_PCT}%`);

  const termOnlyBasis =
    String(ctx.instrumentId || '').toLowerCase() === 'ag' &&
    ctx.marketRegime === 'basis' &&
    process.env.AG_BASIS_DISABLE_OI_PROXY === '1';
  if (termOnlyBasis) reasons.push('ag_term_only_basis');

  const notRange = ctx.marketRegime && ctx.marketRegime !== 'range';
  if (notRange) reasons.push(`regime=${ctx.marketRegime}`);

  const tradable = highIntl || termOnlyBasis || notRange;

  return {
    version: KPI_VERSION,
    dataSource: 'tradable-day-kpi',
    method: 'intl_or_ag_basis_or_non_range',
    tradable: tradable ? true : false,
    overnightIntlPct: intlPct != null ? +intlPct.toFixed(4) : null,
    reasons,
    definition: {
      highIntlOvernightPct: `>= ${HIGH_CONF_INTL_PCT}%`,
      termOnlyBasis: 'AG_BASIS_DISABLE_OI_PROXY=1 + regime=basis',
      nonRange: 'marketRegime !== range',
      logic: 'OR of above',
    },
  };
}

function isTradableDay(row, opts = {}) {
  return evaluateTradableDay({ ...row, ...opts }).tradable === true;
}

/**
 * Calendar staleness vs latest bar (Asia/Shanghai).
 */
function resolveCalendarStaleness(bars, asOfDate) {
  if (!bars?.length) {
    return { state: '待校验', lagDays: null, latestBarDate: null, dataSource: 'cn-futures-session-calendar' };
  }
  const latestIdx = bars.length - 1;
  const latestBarDate = cnSession.normBarDate(bars[latestIdx]);
  const ref = String(asOfDate || latestBarDate).slice(0, 10);
  if (!latestBarDate) {
    return { state: '待校验', lagDays: null, latestBarDate: null, dataSource: 'cn-futures-session-calendar' };
  }
  const lagDays = Math.max(0, Math.round((Date.parse(ref) - Date.parse(latestBarDate)) / 86400000));
  let state = 'fresh';
  if (lagDays > 2) state = 'lagged';
  else if (lagDays > 0) state = 'approaching';
  return {
    state,
    lagDays,
    latestBarDate,
    asOfDate: ref,
    dataSource: 'cn-futures-session-calendar',
    method: 'bar-gap-vs-asof',
  };
}

function scoreHorizon(allBucket, idBucket, row, pred, actualField) {
  const actual = row[actualField];
  if (!actual || actual === 'neutral') return;
  allBucket.scored += 1;
  idBucket.scored += 1;
  if (hitDirection(pred, actual)) {
    allBucket.hits += 1;
    idBucket.hits += 1;
  }
}

function evaluateHitRates(rows, predictFn) {
  const byId = { au: { t1: mkBucket(), t3: mkBucket() }, ag: { t1: mkBucket(), t3: mkBucket() } };
  const all = { t1: mkBucket(), t3: mkBucket() };

  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred || pred === 'neutral') continue;
    const id = String(row.instrumentId || '').toLowerCase();
    if (id === 'au' || id === 'ag') {
      scoreHorizon(all.t1, byId[id].t1, row, pred, 'actualDir');
      scoreHorizon(all.t3, byId[id].t3, row, pred, 'actualDirT3');
    } else {
      scoreHorizon(all.t1, all.t1, row, pred, 'actualDir');
      scoreHorizon(all.t3, all.t3, row, pred, 'actualDirT3');
    }
  }

  return finalizeTree({ all, au: byId.au, ag: byId.ag });
}

function finalizeBucket(b) {
  b.hitRatePct = b.scored ? +((b.hits / b.scored) * 100).toFixed(2) : null;
  b.formatted = fmtHitRateWithSample(b.hits, b.scored).formatted;
  return b;
}

function finalizeTree(tree) {
  finalizeBucket(tree.all.t1);
  finalizeBucket(tree.all.t3);
  finalizeBucket(tree.au.t1);
  finalizeBucket(tree.au.t3);
  finalizeBucket(tree.ag.t1);
  finalizeBucket(tree.ag.t3);
  return tree;
}

function bucketRows(rows, predicate) {
  return rows.filter(predicate);
}

/**
 * Full KPI report (probe-compatible shape).
 * @param {object[]} rows backtest flat rows with instrumentId, date, marketRegime, actualDir, actualDirT3
 * @param {Function} predictFn (row) => direction
 * @param {object} [opts] window, baseline
 */
function computeTradableDayKpiReport(rows, predictFn, opts = {}) {
  const full = evaluateHitRates(rows, predictFn);
  const tradable = evaluateHitRates(bucketRows(rows, (r) => isTradableDay(r)), predictFn);
  const highIntl = evaluateHitRates(
    bucketRows(rows, (r) => {
      const p = overnightIntlPct(r);
      return p != null && p >= HIGH_CONF_INTL_PCT;
    }),
    predictFn,
  );
  const nonRange = evaluateHitRates(
    bucketRows(rows, (r) => r.marketRegime && r.marketRegime !== 'range'),
    predictFn,
  );

  const tradableT3 = tradable.all.t3;
  return {
    generatedAt: nowIso(),
    version: KPI_VERSION,
    dataSource: 'tradable-day-kpi',
    window: opts.window || null,
    model: opts.model || null,
    baseline: opts.baseline || null,
    tradableDayDefinition: evaluateTradableDay({}).definition,
    kpi: {
      fullSample: full,
      tradableDaySubset: tradable,
      highIntlOnly: highIntl,
      nonRangeOnly: nonRange,
    },
    targets: {
      tradableDayT3Pct: TARGET_T3_HIT_PCT,
      tradableDayT3GapPp:
        tradableT3.hitRatePct != null ? +(TARGET_T3_HIT_PCT - tradableT3.hitRatePct).toFixed(2) : null,
    },
    calendar: opts.bars ? resolveCalendarStaleness(opts.bars, opts.asOfDate) : null,
  };
}

module.exports = {
  KPI_VERSION,
  HIGH_CONF_INTL_PCT,
  TARGET_T3_HIT_PCT,
  fmtHitRateWithSample,
  overnightIntlPct,
  evaluateTradableDay,
  isTradableDay,
  resolveCalendarStaleness,
  evaluateHitRates,
  computeTradableDayKpiReport,
};
