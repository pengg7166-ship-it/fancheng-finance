/**
 * 缠论多周期支'阻力 'Phase 1  pragmatic implementation
 *
 * Simplifications (documented in docs/QUANT_TRADING_FUNDAMENTAL_CHAN.md):
 * - 无完整笔/段识别；使用 pivot high/low 聚类近似 S/R
 * - 5m/15m 'hour K 或日 K 合成（E 盘多数品种无分钟 K'
 * - 回测'session 'bar OHLC 路径代理 intraday touch 顺序
 */
const diskCache = require('./disk-cache');
const margin = require('./quant-trading-margin');
const cnSession = require('./cn-futures-session-calendar');
const { predictNextDayHighLowFromBars } = require('./intraday-range-predictor');

const SERVICE_VERSION = 'chan-multitf-v1';

/**
 * SL / 盈利保护距离配置
 * - unit 'ticks' | 'price'：按 tick 数或价格单位（元/克、元/千克、元/吨）
 * - stopLossYuan / profitExemptYuan：按每手固定金额（元/手）'价格距离 = yuan / multiplier
 *   沪金 au' '= 1000 克，报价—'500 —= 500/1000 = 0.5 —
 */
/** @type {Record<string, object>} */
const POINT_CONFIG = {
  au: {
    stopLossYuan: 500,
    profitExemptYuan: 500,
    note: 'SL 500点≈0.5克；盈利保护 500点/手（多：支撑下移 0.5克）',
  },
  ag: {
    stopLossYuan: 300,
    profitExemptYuan: 400,
    note: '用户确认 2026-06-18：SL 300点≈20元/千克；盈利保护400点/手（SL×4/3，原 3:4 比例）',
  },
  rb: {
    points: 3,
    unit: 'price',
    profitExemptPoints: 4,
    note: '用户已确认：SL 3 元/吨（30 元/手）；盈利保护 4 元/吨（40 元/手）',
  },
  cu: {
    stopLossYuan: 300,
    note: '用户确认 2026-06-30：SL 300点≈60元/吨（乘数5）',
  },
  ni: {
    stopLossYuan: 300,
    note: '用户确认 2026-06-30：SL 300点≈300元（乘数10 tick）',
  },
  sn: {
    stopLossYuan: 300,
    note: '用户确认 2026-06-30：SL 300—= 300元（乘数1）；夜盘 export 仍受滑点谨慎门控',
  },
};

const TF_ORDER = ['5m', '15m', '1h'];
const TF_ORDER_DAILY = ['daily'];
const PIVOT_LOOKBACK = 5;
const DAILY_SR_LOOKBACK = 120;
const LEVEL_CLUSTER_TICKS = 2;
/** @type {Map<string, object[]>} */
const intradayKlinesCache = new Map();

/** 每手固定金额（元）→ 价格单位距离（元/克、元/千克、元/吨） */
function yuanPerLotToPriceDistance(instrumentId, yuanPerLot) {
  const spec = margin.getContractSpec(instrumentId);
  const mult = spec?.multiplier ?? 1;
  return Number(yuanPerLot) / mult;
}

/** 导出池默'per-instrument 固定止损 300 '手（决策 11）；显式 POINT_CONFIG 优先 */
const DEFAULT_STOP_LOSS_YUAN = 300;

function resolvePointDistance(instrumentId, pointCount, kind = 'stop') {
  const id = String(instrumentId || '').toLowerCase();
  const cfg =
    POINT_CONFIG[id] ||
    (kind === 'profit'
      ? { stopLossYuan: DEFAULT_STOP_LOSS_YUAN, profitExemptPoints: 4 }
      : { stopLossYuan: DEFAULT_STOP_LOSS_YUAN });
  const spec = margin.getContractSpec(id);

  if (cfg.stopLossYuan != null || cfg.profitExemptYuan != null) {
    const yuan =
      kind === 'profit'
        ? (cfg.profitExemptYuan ?? cfg.stopLossYuan ?? 500)
        : (cfg.stopLossYuan ?? cfg.profitExemptYuan ?? 500);
    return yuanPerLotToPriceDistance(id, yuan);
  }

  const n = kind === 'profit' ? cfg.profitExemptPoints ?? 4 : cfg.points ?? 3;
  if (cfg.unit === 'price') return n;
  return n * (spec?.tickSize ?? 1);
}

/** Trail arming scale for profit-exempt distance (default 0.67). POINT_CONFIG au 500¥/'unchanged. */
function resolveTrailArmRatio() {
  const v = Number(process.env.CHAN_TRAIL_ARM_RATIO);
  if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  return 0.67;
}

function pathReachedProfitThreshold(points, entryPrice, direction, threshold, startIdx) {
  const th = Number(threshold);
  const ep = Number(entryPrice);
  if (!th || th <= 0 || !ep) return false;
  for (let i = Math.max(0, startIdx); i < points.length; i += 1) {
    const p = points[i].price;
    if (direction === 'long' && p >= ep + th) return true;
    if (direction === 'short' && p <= ep - th) return true;
  }
  return false;
}

function normBarDate(bar) {
  return cnSession.normBarDate(bar);
}

function intradayCacheDisabled() {
  return process.env.CHAN_FORCE_DAILY_PROXY === '1';
}

/** Exit path: `5m` (default) prefers tick 5m bars; `daily` forces OHLC proxy. */
function exitPathMode() {
  if (intradayCacheDisabled()) return 'daily';
  const v = String(process.env.CHAN_EXIT_PATH || '5m').toLowerCase();
  return v === 'daily' ? 'daily' : '5m';
}

function barMinutes(bar) {
  const raw = String(bar?.date || bar?.TDATE || '');
  const m = raw.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return {
    date: m[1],
    minutes: m[2] != null ? parseInt(m[2], 10) * 60 + parseInt(m[3], 10) : 0,
  };
}

function nightOpenMinutes() {
  const [h, m] = String(cnSession.SESSION_META.nightOpenTime || '21:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Chronological key within one trading session (night 'early 'day). */
function sessionBarSortKey(bar, baselineDate, sessionDate) {
  const ts = barMinutes(bar);
  if (!ts) return Number.MAX_SAFE_INTEGER;
  const base = String(baselineDate || '').slice(0, 10);
  const sess = String(sessionDate || '').slice(0, 10);
  const { date, minutes } = ts;
  const nightOpen = nightOpenMinutes();
  const earlyEnd = 2 * 60 + 35;
  const dayStart = 8 * 60 + 55;
  if (date === base && minutes >= nightOpen) return minutes;
  if (date === sess && minutes <= earlyEnd) return 10000 + minutes;
  if (date === sess && minutes >= dayStart) return 20000 + minutes;
  return Number.MAX_SAFE_INTEGER - 1;
}

/** Exit path must not include pre-open (20:55) auction bars on baseline night. */
function barAtOrAfterNightOpen(bar, baselineDate) {
  const ts = barMinutes(bar);
  if (!ts) return false;
  const base = String(baselineDate || '').slice(0, 10);
  if (ts.date === base) return ts.minutes >= nightOpenMinutes();
  return true;
}

/** Night (baseline 21:00+) + early (session '2:35) + day (session 08:55'5:00). */
function barInTradingSession(bar, baselineDate, sessionDate) {
  const ts = barMinutes(bar);
  if (!ts) return false;
  const base = String(baselineDate || '').slice(0, 10);
  const sess = String(sessionDate || '').slice(0, 10);
  const { date, minutes } = ts;
  const NIGHT_START = 20 * 60 + 55;
  const EARLY_END = 2 * 60 + 35;
  const DAY_START = 8 * 60 + 55;
  const DAY_END = 15 * 60;
  if (date === base && minutes >= NIGHT_START) return true;
  if (date === sess) {
    if (minutes <= EARLY_END) return true;
    if (minutes >= DAY_START && minutes <= DAY_END) return true;
  }
  return false;
}

function filterBarsForTradingSession(bars, baselineDate, sessionDate, opts = {}) {
  const forExit = opts.forExit === true;
  return (bars || [])
    .filter((b) => barInTradingSession(b, baselineDate, sessionDate))
    .filter((b) => !forExit || barAtOrAfterNightOpen(b, baselineDate))
    .sort(
      (a, b) =>
        sessionBarSortKey(a, baselineDate, sessionDate) -
        sessionBarSortKey(b, baselineDate, sessionDate),
    );
}

function readHourKlines(instrumentId) {
  if (intradayCacheDisabled()) return [];
  return readIntradayKlines(instrumentId, 'hour');
}

function readIntradayKlines(instrumentId, tf) {
  if (intradayCacheDisabled()) return [];
  const id = String(instrumentId || '').toLowerCase();
  const cacheKey = `${id}:${tf}`;
  if (intradayKlinesCache.has(cacheKey)) return intradayKlinesCache.get(cacheKey);
  const key = `klines/commodity-${id}-${tf}.json`;
  const stored = diskCache.readStale(key);
  const bars = stored?.data?.klines || [];
  intradayKlinesCache.set(cacheKey, bars);
  return bars;
}

function filterBarsUpToDate(bars, asOfDate) {
  const asOf = String(asOfDate || '').slice(0, 10);
  return (bars || []).filter((b) => String(b.date || '').slice(0, 10) <= asOf);
}

function filterBarsForSession(bars, sessionDate) {
  const day = String(sessionDate || '').slice(0, 10);
  return (bars || []).filter((b) => String(b.date || '').slice(0, 10) === day);
}

/**
 * 由日 K 合成'intraday bar（Phase 1 fallback'
 * 单根 session 'bar '8 段路径覆盖夜'日盘关键时点
 */
function synthesizeSessionBarsFromDaily(sessionBar, baselineDate, sessionDate) {
  if (!sessionBar) return [];
  const o = Number(sessionBar.open ?? sessionBar.close);
  const h = Number(sessionBar.high ?? o);
  const l = Number(sessionBar.low ?? o);
  const c = Number(sessionBar.close ?? o);
  if (!o) return [];

  const bullish = c >= o;
  const prices = bullish ? [o, l, h, c] : [o, h, l, c];
  const times = [
    `${baselineDate}T21:00:00+08:00`,
    `${baselineDate}T23:30:00+08:00`,
    `${sessionDate}T10:30:00+08:00`,
    `${sessionDate}T15:00:00+08:00`,
  ];

  const out = [];
  for (let i = 0; i < prices.length; i += 1) {
    out.push({
      date: times[i],
      open: prices[i],
      high: Math.max(prices[i], prices[Math.min(i + 1, prices.length - 1)] ?? prices[i]),
      low: Math.min(prices[i], prices[Math.min(i + 1, prices.length - 1)] ?? prices[i]),
      close: prices[Math.min(i + 1, prices.length - 1)] ?? prices[i],
      synthetic: true,
      tf: 'daily-proxy',
    });
  }
  return out;
}

/** hour K '15m / 5m 近似（复'hour bar，标'tf'*/
function deriveLowerTfFromHour(hourBars, tf) {
  if (!hourBars?.length) return [];
  const factor = tf === '15m' ? 4 : tf === '5m' ? 12 : 1;
  if (factor === 1) {
    return hourBars.map((b) => ({ ...b, tf: '1h' }));
  }
  const out = [];
  for (const bar of hourBars) {
    const o = Number(bar.open);
    const h = Number(bar.high);
    const l = Number(bar.low);
    const c = Number(bar.close);
    const baseDate = String(bar.date || '').slice(0, 16);
    for (let i = 0; i < factor; i += 1) {
      const t = i / factor;
      const mid = o + (c - o) * t;
      out.push({
        date: `${baseDate}:${String(i).padStart(2, '0')}`,
        open: mid,
        high: h,
        low: l,
        close: mid + (c - o) / factor,
        tf,
        synthetic: true,
      });
    }
  }
  return out;
}

function loadBarsForTf(instrumentId, tf, sessionDate, dailyBars, barIndex) {
  if (tf === 'daily') {
    const end = barIndex >= 0 ? barIndex + 1 : dailyBars?.length || 0;
    const bars = (dailyBars || []).slice(Math.max(0, end - DAILY_SR_LOOKBACK), end);
    return {
      bars: bars.map((b) => ({ ...b, tf: 'daily' })),
      source: 'daily-bars',
    };
  }

  if (tf === '5m' || tf === '15m') {
    const cached = filterBarsForSession(readIntradayKlines(instrumentId, tf), sessionDate);
    if (cached.length) {
      return { bars: cached.map((b) => ({ ...b, tf })), source: `${tf}-cache` };
    }
  }

  const hourAll = readHourKlines(instrumentId);
  const hourSession = filterBarsForSession(hourAll, sessionDate);

  if (tf === '1h' && hourSession.length) {
    return { bars: hourSession.map((b) => ({ ...b, tf: '1h' })), source: 'hour-cache' };
  }
  if ((tf === '15m' || tf === '5m') && hourSession.length) {
    return {
      bars: deriveLowerTfFromHour(hourSession, tf),
      source: 'hour-derived',
    };
  }

  // 无真实分'小时 K 时不合成 daily-proxy 入场结构（决'7/9'
  return { bars: [], source: 'no-intraday-bars' };
}

function isPivotHigh(bars, i, lookback = PIVOT_LOOKBACK) {
  const h = Number(bars[i]?.high);
  if (!h) return false;
  for (let j = Math.max(0, i - lookback); j <= Math.min(bars.length - 1, i + lookback); j += 1) {
    if (j !== i && Number(bars[j]?.high) >= h) return false;
  }
  return true;
}

function isPivotLow(bars, i, lookback = PIVOT_LOOKBACK) {
  const l = Number(bars[i]?.low);
  if (!l) return false;
  for (let j = Math.max(0, i - lookback); j <= Math.min(bars.length - 1, i + lookback); j += 1) {
    if (j !== i && Number(bars[j]?.low) <= l) return false;
  }
  return true;
}

function clusterLevels(rawLevels, instrumentId) {
  const spec = margin.getContractSpec(instrumentId);
  const tol = (spec?.tickSize ?? 1) * LEVEL_CLUSTER_TICKS;
  const sorted = [...rawLevels].sort((a, b) => a - b);
  const clusters = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(v - last.mean) <= tol) {
      last.values.push(v);
      last.mean = last.values.reduce((s, x) => s + x, 0) / last.values.length;
      last.strength = last.values.length;
    } else {
      clusters.push({ mean: v, values: [v], strength: 1 });
    }
  }
  return clusters.sort((a, b) => b.strength - a.strength);
}

function detectSupportResistance(bars, instrumentId, refPrice) {
  if (!bars?.length) return { supports: [], resistances: [] };
  const pivotHighs = [];
  const pivotLows = [];
  for (let i = PIVOT_LOOKBACK; i < bars.length - PIVOT_LOOKBACK; i += 1) {
    if (isPivotHigh(bars, i)) pivotHighs.push(Number(bars[i].high));
    if (isPivotLow(bars, i)) pivotLows.push(Number(bars[i].low));
  }
  const supports = clusterLevels(pivotLows, instrumentId).map((c) => ({
    price: +c.mean.toFixed(6),
    strength: c.strength,
  }));
  const resistances = clusterLevels(pivotHighs, instrumentId).map((c) => ({
    price: +c.mean.toFixed(6),
    strength: c.strength,
  }));

  if (refPrice != null) {
    supports.sort((a, b) => Math.abs(a.price - refPrice) - Math.abs(b.price - refPrice));
    resistances.sort((a, b) => Math.abs(a.price - refPrice) - Math.abs(b.price - refPrice));
  }
  return { supports, resistances };
}

function nearestLevelBelow(levels, price) {
  const below = levels.filter((l) => l.price <= price);
  if (!below.length) return null;
  return below.reduce((best, l) => (price - l.price < price - best.price ? l : best));
}

function nearestLevelAbove(levels, price) {
  const above = levels.filter((l) => l.price >= price);
  if (!above.length) return null;
  return above.reduce((best, l) => (l.price - price < best.price - price ? l : best));
}

/** Re-anchor S/R to entry so TP/SL sit on the correct side of price. */
function alignLevelsToEntry(direction, entryPrice, supports, resistances) {
  const ep = Number(entryPrice);
  if (!ep) return { valid: false, support: null, resistance: null };

  let support = nearestLevelBelow(supports, ep)?.price ?? null;
  let resistance = nearestLevelAbove(resistances, ep)?.price ?? null;

  if (direction === 'long') {
    if (support != null && support > ep) support = null;
    if (resistance != null && resistance <= ep) resistance = null;
  } else if (direction === 'short') {
    if (support != null && support >= ep) support = null;
    if (resistance != null && resistance < ep) resistance = ep;
  }

  if (support != null && resistance != null && support >= resistance) {
    return { valid: false, support, resistance };
  }
  if (direction === 'long' && resistance != null && resistance <= ep) {
    return { valid: false, support, resistance };
  }
  if (direction === 'short' && support != null && support >= ep) {
    return { valid: false, support, resistance };
  }

  return { valid: true, support, resistance };
}

function validateSrSetup(direction, entry, stop, tp, tol = 0) {
  const ep = Number(entry);
  const sp = Number(stop);
  const tpPx = Number(tp);
  if (!ep) return false;
  if (direction === 'long') {
    if (Number.isFinite(sp) && sp >= ep - tol) return false;
    if (Number.isFinite(tpPx) && tpPx <= ep + tol) return false;
  } else if (direction === 'short') {
    if (Number.isFinite(sp) && sp <= ep + tol) return false;
    if (Number.isFinite(tpPx) && tpPx >= ep - tol) return false;
  }
  return true;
}

const MAX_EXPORT_ENTRIES = 5;

function resolveRangeFallback(opts = {}) {
  const instrumentId = String(opts.instrumentId || '').toLowerCase();
  const dailyBars = opts.dailyBars || [];
  const barIndex = opts.barIndex ?? -1;
  let rangeFallback = opts.rangePredict || null;
  if (!rangeFallback?.predLow && barIndex >= 0 && dailyBars.length) {
    const hl = predictNextDayHighLowFromBars({
      instrumentId,
      klines: dailyBars,
      asOfDate: normBarDate(dailyBars[barIndex]),
    });
    if (hl?.predictedHigh && hl?.predictedLow) {
      rangeFallback = { predHigh: hl.predictedHigh, predLow: hl.predictedLow, source: 'range-predictor' };
    }
  }
  return rangeFallback;
}

function resolveRefPrice(opts = {}) {
  const dailyBars = opts.dailyBars || [];
  const barIndex = opts.barIndex ?? -1;
  return (
    opts.refPrice ??
    (barIndex >= 0 ? Number(dailyBars[barIndex]?.close) : null) ??
    Number(dailyBars[barIndex + 1]?.open)
  );
}

function priceWithinTolerance(a, b, tol) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function resolveMaxEntryDeviation(instrumentId, dailyBars, barIndex) {
  const ratio = (() => {
    const v = Number(process.env.CHAN_ENTRY_MAX_ATR_RATIO);
    if (Number.isFinite(v) && v > 0) return v;
    return 2.5;
  })();
  const end = barIndex >= 0 ? barIndex + 1 : dailyBars?.length || 0;
  const slice = (dailyBars || []).slice(0, end);
  if (slice.length < 21) return null;
  const trs = [];
  for (let i = 1; i < slice.length; i += 1) {
    const h = Number(slice[i].high ?? slice[i].close);
    const l = Number(slice[i].low ?? slice[i].close);
    const pc = Number(slice[i - 1].close);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const period = Math.min(20, trs.length);
  const atr = trs.slice(-period).reduce((s, v) => s + v, 0) / period;
  if (!atr || atr <= 0) return null;
  return atr * ratio;
}

function entryLevelFromTfContext(tf, ctx) {
  const {
    direction,
    instrumentId,
    refPrice,
    supports,
    resistances,
    dataSource,
    maxDeviation,
    entryStyle,
  } = ctx;

  const rp = Number(refPrice);
  if (!rp) return null;

  let entryPrice = null;
  let support = null;
  let resistance = null;

  if (direction === 'long') {
    support = nearestLevelBelow(supports, rp);
    if (!support?.price) return null;
    entryPrice = support.price;
    resistance = nearestLevelAbove(resistances, rp)?.price ?? null;
    if (entryPrice >= rp) return null;
  } else if (direction === 'short') {
    resistance = nearestLevelAbove(resistances, rp);
    if (!resistance?.price) return null;
    entryPrice = resistance.price;
    support = nearestLevelBelow(supports, rp)?.price ?? null;
    if (entryPrice <= rp) return null;
  } else {
    return null;
  }

  if (maxDeviation != null && Math.abs(entryPrice - rp) > maxDeviation) {
    return {
      tf,
      invalid: true,
      skipReason: 'entry_too_far_from_price',
      entryPrice: +Number(entryPrice).toFixed(6),
      refPrice: rp,
      maxDeviation,
      deviation: Math.abs(entryPrice - rp),
      dataSource,
      entryStyle: entryStyle || null,
    };
  }

  const aligned = alignLevelsToEntry(direction, entryPrice, supports, resistances);
  if (!aligned.valid) return null;

  const stopDist = resolvePointDistance(instrumentId, 3, 'stop');
  const tpPx = direction === 'long' ? aligned.resistance : aligned.support;
  if (
    !validateSrSetup(
      direction,
      entryPrice,
      direction === 'long' ? entryPrice - stopDist : entryPrice + stopDist,
      tpPx,
    )
  ) {
    return null;
  }

  return {
    tf,
    support: aligned.support,
    resistance: aligned.resistance,
    entryPrice: +Number(entryPrice).toFixed(6),
    dataSource,
    entryStyle: entryStyle || null,
    refPrice: rp,
    deviationFromPrice: +Math.abs(entryPrice - rp).toFixed(6),
    takeProfitHint: tpPx != null ? +Number(tpPx).toFixed(6) : null,
  };
}

function loadTfSrContext(tf, opts, refPrice, maxDeviation) {
  const instrumentId = String(opts.instrumentId || '').toLowerCase();
  const sessionDate = String(opts.sessionDate || '').slice(0, 10);
  const dailyBars = opts.dailyBars || [];
  const barIndex = opts.barIndex ?? -1;
  const { bars, source } = loadBarsForTf(instrumentId, tf, sessionDate, dailyBars, barIndex);
  const historyBars = filterBarsUpToDate(
    bars.length ? bars : dailyBars.slice(0, barIndex + 1),
    sessionDate,
  );
  const { supports, resistances } = detectSupportResistance(historyBars, instrumentId, refPrice);
  return {
    direction: opts.direction,
    instrumentId,
    sessionDate,
    dailyBars,
    barIndex,
    refPrice,
    maxDeviation,
    supports,
    resistances,
    dataSource: source,
    entryStyle: opts.entryStyle || null,
  };
}

/** Primary entry for one timeframe (5m / 15m / 1h / daily). */
function findEntryLevelAtTf(tf, opts = {}) {
  const refPrice = resolveRefPrice(opts);
  const maxDeviation =
    opts.maxDeviation ?? resolveMaxEntryDeviation(opts.instrumentId, opts.dailyBars, opts.barIndex);
  const ctx = loadTfSrContext(tf, opts, refPrice, maxDeviation);
  return entryLevelFromTfContext(tf, ctx);
}

/** Extra S/R touch points on one TF (beyond the primary nearest level). */
function collectExtraEntriesAtTf(tf, opts, usedPrices, tickTol) {
  const direction = opts.direction;
  const instrumentId = String(opts.instrumentId || '').toLowerCase();
  const refPrice = resolveRefPrice(opts);
  const maxDeviation =
    opts.maxDeviation ?? resolveMaxEntryDeviation(opts.instrumentId, opts.dailyBars, opts.barIndex);
  const ctx = loadTfSrContext(tf, opts, refPrice, maxDeviation);
  const { supports, resistances, dataSource } = ctx;

  const levelList =
    direction === 'long'
      ? supports.filter((s) => s.price < refPrice).sort((a, b) => b.price - a.price)
      : resistances.filter((r) => r.price > refPrice).sort((a, b) => a.price - b.price);

  const out = [];
  for (const lvl of levelList) {
    if (usedPrices.some((p) => priceWithinTolerance(p, lvl.price, tickTol))) continue;
    if (maxDeviation != null && Math.abs(lvl.price - refPrice) > maxDeviation) continue;
    const aligned = alignLevelsToEntry(direction, lvl.price, supports, resistances);
    if (!aligned.valid) continue;
    const stopDist = resolvePointDistance(instrumentId, 3, 'stop');
    const tpPx = direction === 'long' ? aligned.resistance : aligned.support;
    if (
      !validateSrSetup(
        direction,
        lvl.price,
        direction === 'long' ? lvl.price - stopDist : lvl.price + stopDist,
        tpPx,
      )
    ) {
      continue;
    }
    out.push({
      tf,
      support: aligned.support,
      resistance: aligned.resistance,
      entryPrice: +Number(lvl.price).toFixed(6),
      dataSource,
      entryStyle: opts.entryStyle || null,
      refPrice,
      deviationFromPrice: +Math.abs(lvl.price - refPrice).toFixed(6),
      takeProfitHint: tpPx != null ? +Number(tpPx).toFixed(6) : null,
    });
    if (out.length + usedPrices.length >= MAX_EXPORT_ENTRIES) break;
  }
  return out;
}

/**
 * Export: up to 5 distinct Chan touch entries per instrument (5m '15m '1h + extra S/R).
 * @param {object} opts 'same as findEntryLevel
 * @param {number} [maxEntries=5]
 */
function findMultiEntryLevels(opts = {}, maxEntries = MAX_EXPORT_ENTRIES) {
  const cap = Math.max(1, Math.min(Number(maxEntries) || MAX_EXPORT_ENTRIES, MAX_EXPORT_ENTRIES));
  const instrumentId = String(opts.instrumentId || '').toLowerCase();
  const spec = margin.getContractSpec(instrumentId);
  const tickTol = (spec?.tickSize ?? 1) * LEVEL_CLUSTER_TICKS;
  const tfOrder = opts.tfOrder?.length ? opts.tfOrder : TF_ORDER;
  const chanOpts = {
    ...opts,
    maxDeviation:
      opts.maxDeviation ?? resolveMaxEntryDeviation(instrumentId, opts.dailyBars, opts.barIndex),
  };
  const entries = [];
  const usedPrices = [];

  const pushEntry = (entry) => {
    if (!entry?.entryPrice || entry.invalid) return;
    if (usedPrices.some((p) => priceWithinTolerance(p, entry.entryPrice, tickTol))) return;
    usedPrices.push(entry.entryPrice);
    entries.push(entry);
  };

  for (const tf of tfOrder) {
    if (entries.length >= cap) break;
    pushEntry(findEntryLevelAtTf(tf, chanOpts));
  }

  for (const tf of tfOrder) {
    if (entries.length >= cap) break;
    for (const extra of collectExtraEntriesAtTf(tf, chanOpts, usedPrices, tickTol)) {
      pushEntry(extra);
      if (entries.length >= cap) break;
    }
  }

  return entries.slice(0, cap);
}

/**
 * @param {object} opts
 * @param {'long'|'short'} opts.direction
 * @param {string} opts.instrumentId
 * @param {string} opts.sessionDate
 * @param {Array} [opts.dailyBars]
 * @param {number} [opts.barIndex]
 * @param {number} [opts.refPrice]
 * @param {{ predHigh?: number, predLow?: number }} [opts.rangePredict]
 */
function findEntryLevel(opts = {}) {
  const refPrice = resolveRefPrice(opts);
  const maxDeviation =
    opts.maxDeviation ?? resolveMaxEntryDeviation(opts.instrumentId, opts.dailyBars, opts.barIndex);
  const tfOrder = opts.tfOrder?.length ? opts.tfOrder : TF_ORDER;
  const chanOpts = { ...opts, maxDeviation };

  for (const tf of tfOrder) {
    const ctx = loadTfSrContext(tf, chanOpts, refPrice, maxDeviation);
    const entry = entryLevelFromTfContext(tf, ctx);
    if (entry && !entry.invalid) return entry;
  }

  return {
    tf: null,
    support: null,
    resistance: null,
    entryPrice: null,
    dataSource: 'no-structure',
    invalid: true,
    skipReason: 'no_valid_sr_level',
  };
}

function findStopLoss({ direction, entryPrice, instrumentId }) {
  const dist = resolvePointDistance(instrumentId, 3, 'stop');
  const ep = Number(entryPrice);
  if (!ep) return { stopPrice: null, stopPoints: dist };
  const stopPrice =
    direction === 'long' ? ep - dist : direction === 'short' ? ep + dist : null;
  return {
    stopPrice: stopPrice != null ? +stopPrice.toFixed(6) : null,
    stopPoints: dist,
    stopPointConfig: POINT_CONFIG[String(instrumentId || '').toLowerCase()] || null,
  };
}

function buildSessionPricePath(sessionBar) {
  const o = Number(sessionBar.open ?? sessionBar.close);
  const h = Number(sessionBar.high ?? o);
  const l = Number(sessionBar.low ?? o);
  const c = Number(sessionBar.close ?? o);
  const bullish = c >= o;
  const seq = bullish ? [o, l, h, c] : [o, h, l, c];
  const path = [];
  for (let i = 0; i < seq.length - 1; i += 1) {
    path.push({ from: seq[i], to: seq[i + 1], idx: i });
  }
  return path;
}

/** Walk OHLC sequence per bar (bullish O→L→H→C, bearish O→H→L→C). */
function buildBarSequencePricePath(bars) {
  const path = [];
  for (const bar of bars || []) {
    const o = Number(bar.open ?? bar.close);
    const h = Number(bar.high ?? o);
    const l = Number(bar.low ?? o);
    const c = Number(bar.close ?? o);
    if (!o) continue;
    const bullish = c >= o;
    const seq = bullish ? [o, l, h, c] : [o, h, l, c];
    for (let i = 0; i < seq.length - 1; i += 1) {
      path.push({ from: seq[i], to: seq[i + 1], idx: path.length, barDate: bar.date || null });
    }
  }
  return path;
}

/**
 * Real 5m tick bars for one trading session (night on baselineDate + day on sessionDate).
 * @returns {{ path: object[], bars: object[], source: string }}
 */
function buildTick5mPricePath(instrumentId, sessionDate, baselineDate) {
  const all5m = readIntradayKlines(instrumentId, '5m');
  const sessionBars = filterBarsForTradingSession(all5m, baselineDate, sessionDate, { forExit: true });
  if (!sessionBars.length) {
    return { path: [], bars: [], source: '5m-tick-empty' };
  }
  return {
    path: buildBarSequencePricePath(sessionBars),
    bars: sessionBars,
    source: '5m-tick',
  };
}

function buildHourDerivedPricePath(instrumentId, sessionDate, baselineDate) {
  const hourAll = readHourKlines(instrumentId);
  const sessionBars = filterBarsForTradingSession(hourAll, baselineDate, sessionDate, { forExit: true });
  if (!sessionBars.length) {
    return { path: [], bars: [], source: 'hour-derived-empty' };
  }
  const derived = deriveLowerTfFromHour(sessionBars, '5m');
  const walkBars = derived.length ? derived : sessionBars;
  return {
    path: buildBarSequencePricePath(walkBars),
    bars: walkBars,
    source: 'hour-derived',
  };
}

function resolveExitPricePath({ instrumentId, sessionDate, baselineDate, sessionBar }) {
  const mode = exitPathMode();
  if (mode === '5m') {
    const tick = buildTick5mPricePath(instrumentId, sessionDate, baselineDate);
    if (tick.path.length) {
      if (process.env.CHAN_EXIT_PATH_LOG === '1') {
        console.log(`[chan-exit] ${instrumentId} ${sessionDate}: 5m-tick (${tick.bars.length} bars)`);
      }
      return tick;
    }
    const hour = buildHourDerivedPricePath(instrumentId, sessionDate, baselineDate);
    if (hour.path.length) {
      if (process.env.CHAN_EXIT_PATH_LOG === '1') {
        console.log(`[chan-exit] ${instrumentId} ${sessionDate}: hour-derived (${hour.bars.length} bars)`);
      }
      return hour;
    }
    if (process.env.CHAN_EXIT_PATH_LOG === '1') {
      console.log(`[chan-exit] ${instrumentId} ${sessionDate}: daily-proxy-fallback`);
    }
    return {
      path: buildSessionPricePath(sessionBar),
      bars: sessionBar ? [sessionBar] : [],
      source: 'daily-proxy-fallback',
    };
  }
  if (process.env.CHAN_EXIT_PATH_LOG === '1') {
    console.log(`[chan-exit] ${instrumentId} ${sessionDate}: daily-proxy (forced)`);
  }
  return {
    path: buildSessionPricePath(sessionBar),
    bars: sessionBar ? [sessionBar] : [],
    source: 'daily-proxy',
  };
}

function barDateToIso(barDate, fallback) {
  const raw = String(barDate || '');
  if (!raw) return fallback;
  if (raw.includes('T')) return raw;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return fallback;
  const t = m[2] != null ? `${m[2]}:${m[3]}` : '15:00';
  return `${m[1]}T${t}:00+08:00`;
}

function exitTimeFromPoint(points, idx, fallback) {
  if (idx < 0 || !points?.length) return fallback;
  return barDateToIso(points[idx]?.barDate, fallback);
}

function walkPathSegments(path) {
  const points = [];
  if (!path?.length) return points;
  points.push({ price: path[0].from, seg: 0, t: 0, barDate: path[0].barDate || null });
  for (let i = 0; i < path.length; i += 1) {
    points.push({ price: path[i].to, seg: i, t: i + 1, barDate: path[i].barDate || null });
  }
  return points;
}

function findNightOpenPathIndex(points, baselineDate) {
  const base = String(baselineDate || '').slice(0, 10);
  const openMin = nightOpenMinutes();
  const openLabel = cnSession.SESSION_META.nightOpenTime;
  for (let i = 0; i < points.length; i += 1) {
    const ts = barMinutes({ date: points[i].barDate });
    if (!ts) continue;
    if (ts.date === base && ts.minutes >= openMin) return i;
    if (ts.date !== base) return i;
    const raw = String(points[i].barDate || '');
    if (raw.includes(`${openLabel}`) && raw.includes(base)) return i;
  }
  return 0;
}

function sequentialTouchIndex(points, level, mode, startIdx = 0) {
  const lv = Number(level);
  if (!lv) return -1;
  for (let i = Math.max(0, startIdx); i < points.length; i += 1) {
    const p = points[i].price;
    const prev = i > 0 ? points[i - 1].price : p;
    const lo = Math.min(p, prev);
    const hi = Math.max(p, prev);
    if (mode === 'entry_long' && lo <= lv) return i;
    if (mode === 'entry_short' && hi >= lv) return i;
    if (mode === 'stop_long' && lo <= lv) return i;
    if (mode === 'stop_short' && hi >= lv) return i;
    if (mode === 'tp_long' && hi >= lv) return i;
    if (mode === 'tp_short' && lo <= lv) return i;
  }
  return -1;
}

/** Sequential intraday simulation 'exit path from 5m tick / hour / daily-proxy. */
function simulateIntradayExit(opts = {}) {
  const {
    direction,
    sessionBar,
    entryLevel,
    stopLoss,
    resistance,
    support,
    instrumentId,
    baselineDate,
    sessionDate,
    entryTf,
  } = opts;

  const { path, source: exitPathSource } = resolveExitPricePath({
    instrumentId,
    sessionDate,
    baselineDate,
    sessionBar,
  });
  const points = walkPathSegments(path);
  const spec = margin.getContractSpec(instrumentId);
  const tol = (spec?.tickSize ?? 1) * 0.5;
  const profitExempt = resolvePointDistance(instrumentId, 4, 'profit');
  const armRatio = resolveTrailArmRatio();
  const trailExempt = profitExempt * armRatio;
  const armThreshold = trailExempt * 0.5;

  const entryTarget = Number(entryLevel?.entryPrice ?? entryLevel);
  const stopPx = Number(stopLoss?.stopPrice ?? stopLoss);
  const tpPx = direction === 'long' ? Number(resistance) : Number(support);
  const hasTp = tpPx != null && !Number.isNaN(tpPx);

  if (!validateSrSetup(direction, entryTarget, stopPx, hasTp ? tpPx : null, tol)) {
    return { entered: false, reason: 'invalid_sr_setup', exitPathSource };
  }

  const openIdx = findNightOpenPathIndex(points, baselineDate);
  const entryMode = direction === 'long' ? 'entry_long' : 'entry_short';
  const entryIdx = sequentialTouchIndex(points, entryTarget, entryMode, openIdx);
  if (entryIdx < 0) {
    return { entered: false, reason: 'entry_not_touched', exitPathSource };
  }

  const effectiveEntryIdx = Math.max(entryIdx, openIdx);
  const stopMode = direction === 'long' ? 'stop_long' : 'stop_short';
  const stopIdx = sequentialTouchIndex(points, stopPx, stopMode, effectiveEntryIdx + 1);
  const tpMode = direction === 'long' ? 'tp_long' : 'tp_short';
  const tpIdx = hasTp ? sequentialTouchIndex(points, tpPx, tpMode, effectiveEntryIdx + 1) : -1;

  const entryPrice = margin.applySlippage(entryTarget, instrumentId, direction, 1);
  const entryFallback = `${baselineDate}T${cnSession.SESSION_META.nightOpenTime}:00+08:00`;
  const entryTime = exitTimeFromPoint(points, effectiveEntryIdx, entryFallback);
  const stopFallback = `${sessionDate}T11:00:00+08:00`;
  const tpFallback = `${sessionDate}T14:00:00+08:00`;
  const closeFallback = `${sessionDate}T${cnSession.SESSION_META.dayCloseTime}:00+08:00`;

  if (stopIdx >= 0 && (tpIdx < 0 || stopIdx <= tpIdx)) {
    const exitPrice = margin.applySlippage(stopPx, instrumentId, direction === 'long' ? 'short' : 'long', 1);
    return {
      entered: true,
      entryPrice,
      exitPrice,
      entryTime,
      exitTime: exitTimeFromPoint(points, stopIdx, stopFallback),
      exitType: 'stop_loss',
      trailReason: null,
      tpLevel: hasTp ? tpPx : null,
      entryTf,
      stopPoints: stopLoss?.stopPoints ?? resolvePointDistance(instrumentId, 3, 'stop'),
      exitPathSource,
    };
  }

  if (tpIdx >= 0) {
    const exitPrice = margin.applySlippage(tpPx, instrumentId, direction === 'long' ? 'short' : 'long', 1);
    return {
      entered: true,
      entryPrice,
      exitPrice,
      entryTime,
      exitTime: exitTimeFromPoint(points, tpIdx, tpFallback),
      exitType: 'take_profit',
      trailReason: null,
      tpLevel: tpPx,
      entryTf,
      stopPoints: stopLoss?.stopPoints ?? resolvePointDistance(instrumentId, 3, 'stop'),
      exitPathSource,
    };
  }

  const sessionClose = Number(sessionBar.close);
  const sessionLow = Number(sessionBar.low);
  const sessionHigh = Number(sessionBar.high);
  const sessionInProfit =
    direction === 'long' ? sessionHigh > entryPrice + tol : sessionLow < entryPrice - tol;
  const pathInProfit = pathReachedProfitThreshold(
    points,
    entryPrice,
    direction,
    armThreshold,
    effectiveEntryIdx + 1,
  );
  const inProfit = sessionInProfit || pathInProfit;

  let trailSupport = Number(support);
  if (inProfit && trailSupport != null) {
    if (direction === 'long') trailSupport -= trailExempt;
    else trailSupport += trailExempt;
  }

  const nextSupport = trailSupport ?? (direction === 'long' ? sessionLow : sessionHigh);
  const trailMode = direction === 'long' ? 'stop_long' : 'stop_short';
  const trailIdx = sequentialTouchIndex(points, nextSupport, trailMode, effectiveEntryIdx + 1);
  const trailBroken = trailIdx >= 0;

  const exitPrice = margin.applySlippage(
    trailBroken ? nextSupport : sessionClose,
    instrumentId,
    direction === 'long' ? 'short' : 'long',
    1,
  );

  return {
    entered: true,
    entryPrice,
    exitPrice,
    entryTime,
    exitTime: trailBroken
      ? exitTimeFromPoint(points, trailIdx, closeFallback)
      : closeFallback,
    exitType: trailBroken ? 'trail_support_break' : 'session_close',
    trailReason: hasTp ? 'no_resistance_hit_trail' : 'hold_until_support_break',
    tpLevel: hasTp ? tpPx : null,
    entryTf,
    stopPoints: stopLoss?.stopPoints ?? resolvePointDistance(instrumentId, 3, 'stop'),
    profitExemptApplied: inProfit,
    trailArmRatio: armRatio,
    exitPathSource,
  };
}

/** Outlook detail UI '5/15/60 分结构提示（只读展示，非执行层） */
function getOutlookStructureHints(instrumentId, refPrice, sessionDate) {
  const id = String(instrumentId || '').toLowerCase();
  const price = Number(refPrice);
  const sess = String(sessionDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const specs = [
    { key: '5m', label: '5', cacheTf: '5m' },
    { key: '15m', label: '15', cacheTf: '15m' },
    { key: '60m', label: '60', cacheTf: 'hour' },
  ];
  const hints = [];
  for (const spec of specs) {
    const bars = readIntradayKlines(id, spec.cacheTf);
    const filtered = filterBarsUpToDate(bars, sess).slice(-80);
    if (!filtered.length) {
      hints.push({
        tf: spec.label,
        tfKey: spec.key,
        support: null,
        resistance: null,
        summary: '暂无 K ',
        dataSource: 'none',
      });
      continue;
    }
    const { supports, resistances } = detectSupportResistance(filtered, id, price);
    const support = supports.find((s) => s.price <= price) || supports[0] || null;
    const resistance = resistances.find((r) => r.price >= price) || resistances[0] || null;
    let summary = '结构待确';
    if (support && resistance) {
      const mid = (support.price + resistance.price) / 2;
      summary = price > mid + (resistance.price - support.price) * 0.05 ? '偏多结构' : price < mid - (resistance.price - support.price) * 0.05 ? '偏空结构' : '区间震荡';
    } else if (support) summary = '近支';
    else if (resistance) summary = '近阻';
    hints.push({
      tf: spec.label,
      tfKey: spec.key,
      support: support?.price ?? null,
      resistance: resistance?.price ?? null,
      supportStrength: support?.strength ?? null,
      resistanceStrength: resistance?.strength ?? null,
      summary,
      dataSource: `${spec.cacheTf}-cache`,
    });
  }
  return { instrumentId: id, refPrice: price || null, sessionDate: sess, hints, version: SERVICE_VERSION };
}

function getDataAvailability(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  const hour = readHourKlines(id);
  const m5 = readIntradayKlines(id, '5m');
  const m15 = readIntradayKlines(id, '15m');
  const has5m15m = m5.length > 0 && m15.length > 0;
  let phase1Fallback = 'daily-proxy-path';
  if (has5m15m) phase1Fallback = '5m15m-cache';
  else if (hour.length) phase1Fallback = 'hour-derived-5m15m';
  const exitPathDefault = has5m15m || m5.length ? '5m-tick' : hour.length ? 'hour-derived' : 'daily-proxy';
  return {
    instrumentId: id,
    hourBars: hour.length,
    bars5m: m5.length,
    bars15m: m15.length,
    hourRange: hour.length
      ? { start: hour[0]?.date, end: hour[hour.length - 1]?.date }
      : null,
    range5m: m5.length ? { start: m5[0]?.date, end: m5[m5.length - 1]?.date } : null,
    range15m: m15.length ? { start: m15[0]?.date, end: m15[m15.length - 1]?.date } : null,
    has5m15m,
    phase1Fallback,
    exitPathDefault,
    exitPathMode: exitPathMode(),
  };
}

module.exports = {
  SERVICE_VERSION,
  POINT_CONFIG,
  TF_ORDER,
  TF_ORDER_DAILY,
  yuanPerLotToPriceDistance,
  resolvePointDistance,
  resolveMaxEntryDeviation,
  resolveTrailArmRatio,
  pathReachedProfitThreshold,
  readHourKlines,
  readIntradayKlines,
  loadBarsForTf,
  detectSupportResistance,
  findEntryLevel,
  findEntryLevelAtTf,
  findMultiEntryLevels,
  findStopLoss,
  simulateIntradayExit,
  synthesizeSessionBarsFromDaily,
  buildTick5mPricePath,
  buildBarSequencePricePath,
  resolveExitPricePath,
  exitPathMode,
  getDataAvailability,
  getOutlookStructureHints,
};
