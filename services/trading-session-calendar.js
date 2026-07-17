/**
 * 品种级交易时段日—三槽预测校验窗口'0:55 / 08:55 / 13:25'
 *
 * 夜盘分类'1:00 起，按交易所现行规则）：
 *   night_2300 '21:00'3:00（玻'化工/黑色/多数农产品等'
 *   night_0100 '21:00–次'01:00（有色金属、不锈钢、氧化铝等）
 *   night_0230 '21:00–次'02:30（贵金属、原油）
 *   no_night   '无夜盘（仅日'09:00'1:30 / 13:30'5:00'
 */
const cnSession = require('./cn-futures-session-calendar');
const diskCache = require('./disk-cache');

const TIMEZONE = 'Asia/Shanghai';
const SESSION_WINDOW_VERSION = 'slot-v2-commodity-windows';

const DAY_MORNING = { start: '09:00', end: '11:30', label: '09:00-11:30' };
const DAY_AFTERNOON = { start: '13:30', end: '15:00', label: '13:30-15:00' };

/** @type {Record<string, { category: string, nightEnd: string|null, hasNightSession: boolean, note?: string }>} */
const INSTRUMENT_NIGHT_PROFILE = {
  // SHFE '有色金属 01:00
  cu: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  al: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  zn: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  pb: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  ni: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  sn: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  ss: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  ao: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  ad: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  // SHFE '贵金'02:30
  au: { category: 'night_0230', nightEnd: '02:30', hasNightSession: true },
  ag: { category: 'night_0230', nightEnd: '02:30', hasNightSession: true },
  // SHFE '23:00
  rb: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  hc: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  fu: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  bu: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  ru: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  sp: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  br: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  // SHFE '无夜'
  wr: { category: 'no_night', nightEnd: null, hasNightSession: false },

  // INE
  sc: { category: 'night_0230', nightEnd: '02:30', hasNightSession: true },
  bc: { category: 'night_0100', nightEnd: '01:00', hasNightSession: true },
  lu: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  ec: { category: 'no_night', nightEnd: null, hasNightSession: false },

  // DCE '夜盘 23:00
  a: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  b: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  c: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  cs: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  m: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  y: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  p: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  l: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  v: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  pp: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  j: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  jm: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  i: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  eg: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  eb: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  pg: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  // DCE '无夜'
  jd: { category: 'no_night', nightEnd: null, hasNightSession: false },
  lh: { category: 'no_night', nightEnd: null, hasNightSession: false },
  rr: { category: 'no_night', nightEnd: null, hasNightSession: false },
  lg: { category: 'no_night', nightEnd: null, hasNightSession: false },

  // ZCE '夜盘 23:00
  cf: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  sr: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  ta: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  oi: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  ma: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  fg: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  rm: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  sf: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  sm: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  ur: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  sa: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  pf: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  sh: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  px: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  pr: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  cy: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  // ZCE '无夜'
  ap: { category: 'no_night', nightEnd: null, hasNightSession: false },
  cj: { category: 'no_night', nightEnd: null, hasNightSession: false },
  pk: { category: 'no_night', nightEnd: null, hasNightSession: false },
  wh: { category: 'no_night', nightEnd: null, hasNightSession: false },
  pm: { category: 'no_night', nightEnd: null, hasNightSession: false },
  ri: { category: 'no_night', nightEnd: null, hasNightSession: false },
  lr: { category: 'no_night', nightEnd: null, hasNightSession: false },
  jr: { category: 'no_night', nightEnd: null, hasNightSession: false },
  rs: { category: 'no_night', nightEnd: null, hasNightSession: false },
  zc: { category: 'no_night', nightEnd: null, hasNightSession: false, note: '动力煤主力常暂停' },

  // GFEX
  si: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  lc: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  ps: { category: 'night_2300', nightEnd: '23:00', hasNightSession: true },
  pt: { category: 'night_0230', nightEnd: '02:30', hasNightSession: true, note: '广期所铂金，比照贵金属夜盘' },
  pd: { category: 'night_0230', nightEnd: '02:30', hasNightSession: true, note: '广期所钯金，比照贵金属夜盘' },
};

const NIGHT_END_LABEL = {
  night_2300: '21:00-23:00',
  night_0100: '21:00-01:00',
  night_0230: '21:00-02:30',
};

function normId(instrumentId) {
  return String(instrumentId || '').toLowerCase();
}

function getInstrumentNightProfile(instrumentId) {
  const id = normId(instrumentId);
  return (
    INSTRUMENT_NIGHT_PROFILE[id] || {
      category: 'no_night',
      nightEnd: null,
      hasNightSession: false,
      note: '未登记品种，默认无夜',
    }
  );
}

function toInstant(dateStr, timeStr) {
  const d = String(dateStr || '').slice(0, 10);
  const t = String(timeStr || '00:00').slice(0, 5);
  return new Date(`${d}T${t}:00+08:00`);
}

function nightEndCalendarDate(captureDate, profile) {
  if (profile.category === 'night_0100' || profile.category === 'night_0230') {
    return cnSession.shiftCalendarDate(captureDate, 1);
  }
  return String(captureDate).slice(0, 10);
}

function formatWindowLabel(startDate, startTime, endDate, endTime) {
  const sameDay = String(startDate).slice(0, 10) === String(endDate).slice(0, 10);
  const st = String(startTime).slice(0, 5);
  const et = String(endTime).slice(0, 5);
  if (sameDay) return `${st}'{et}`;
  return `${st}–次'{et}`;
}

/**
 * @param {string} instrumentId
 * @param {string} slotId 'pre-night | pre-day | pre-afternoon
 * @param {string} sessionDate '目标交易'K 'date
 * @param {{ captureDate?: string }} opts 'pre-night '20:55 所在自然日
 */
function getSessionWindow(instrumentId, slotId, sessionDate, opts = {}) {
  const id = normId(instrumentId);
  const sess = String(sessionDate || '').slice(0, 10);
  const profile = getInstrumentNightProfile(id);
  const slot = String(slotId || '');

  if (slot === 'pre-day') {
    return {
      slotId: slot,
      instrumentId: id,
      sessionDate: sess,
      captureDate: opts.captureDate ? String(opts.captureDate).slice(0, 10) : sess,
      start: toInstant(sess, DAY_MORNING.start).toISOString(),
      end: toInstant(sess, DAY_MORNING.end).toISOString(),
      startTime: DAY_MORNING.start,
      endTime: DAY_MORNING.end,
      startDate: sess,
      endDate: sess,
      label: DAY_MORNING.label,
      segment: 'day-morning',
      nightCategory: profile.category,
      hasNightSession: profile.hasNightSession,
    };
  }

  if (slot === 'pre-afternoon') {
    return {
      slotId: slot,
      instrumentId: id,
      sessionDate: sess,
      captureDate: opts.captureDate ? String(opts.captureDate).slice(0, 10) : sess,
      start: toInstant(sess, DAY_AFTERNOON.start).toISOString(),
      end: toInstant(sess, DAY_AFTERNOON.end).toISOString(),
      startTime: DAY_AFTERNOON.start,
      endTime: DAY_AFTERNOON.end,
      startDate: sess,
      endDate: sess,
      label: DAY_AFTERNOON.label,
      segment: 'day-afternoon',
      nightCategory: profile.category,
      hasNightSession: profile.hasNightSession,
    };
  }

  if (slot === 'pre-night') {
    const captureDate = opts.captureDate
      ? String(opts.captureDate).slice(0, 10)
      : cnSession.shiftCalendarDate(sess, -1);
    if (!profile.hasNightSession) {
      return {
        slotId: slot,
        instrumentId: id,
        sessionDate: sess,
        captureDate,
        start: null,
        end: null,
        label: '无夜',
        segment: 'night',
        nightCategory: 'no_night',
        hasNightSession: false,
        invalid: true,
        reason: 'no_night_session',
      };
    }
    const endDate = nightEndCalendarDate(captureDate, profile);
    const label = NIGHT_END_LABEL[profile.category] || `21:00'{profile.nightEnd}`;
    return {
      slotId: slot,
      instrumentId: id,
      sessionDate: sess,
      captureDate,
      start: toInstant(captureDate, '21:00').toISOString(),
      end: toInstant(endDate, profile.nightEnd).toISOString(),
      startTime: '21:00',
      endTime: profile.nightEnd,
      startDate: captureDate,
      endDate,
      label,
      segment: 'night',
      nightCategory: profile.category,
      hasNightSession: true,
    };
  }

  return null;
}

function getSlotWindowLabel(instrumentId, slotId, sessionDate, opts = {}) {
  const w = getSessionWindow(instrumentId, slotId, sessionDate, opts);
  return w?.label || '';
}

function cnNowMs(cnParts = cnSession.getCnNowParts()) {
  return toInstant(cnParts.date, `${String(cnParts.hour).padStart(2, '0')}:${String(cnParts.minute).padStart(2, '0')}`).getTime();
}

function resolveWindowPhase(window, cnParts = cnSession.getCnNowParts()) {
  if (!window?.start || !window?.end) return 'invalid';
  const now = cnNowMs(cnParts);
  const start = new Date(window.start).getTime();
  const end = new Date(window.end).getTime();
  if (now < start) return 'pending';
  if (now <= end) return 'intraday';
  return 'complete';
}

function barTimestampMs(bar) {
  const raw = String(bar?.date || bar?.time || bar?.TDATE || '').trim();
  if (!raw) return null;
  if (/\d{2}:\d{2}/.test(raw)) {
    const normalized = raw.includes('T')
      ? raw
      : `${raw.replace(' ', 'T')}${raw.includes('+') ? '' : '+08:00'}`;
    const iso = normalized.includes('+') || normalized.endsWith('Z') ? normalized : `${normalized}+08:00`;
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function readIntradayBars(instrumentId, tf = '5m') {
  const id = normId(instrumentId);
  const key = `klines/commodity-${id}-${tf}.json`;
  const stored = diskCache.readStale(key);
  return (stored?.data?.klines || []).filter((b) => b.date || b.time);
}

function filterBarsInWindow(bars, window) {
  if (!window?.start || !window?.end) return [];
  const startMs = new Date(window.start).getTime();
  const endMs = new Date(window.end).getTime();
  return (bars || []).filter((b) => {
    const ms = barTimestampMs(b);
    return ms != null && ms >= startMs && ms <= endMs;
  });
}

function highLowFromBars(bars) {
  if (!bars?.length) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars) {
    const h = Number(b.high ?? b.close ?? b.price);
    const l = Number(b.low ?? b.close ?? b.price);
    if (!Number.isNaN(h)) hi = Math.max(hi, h);
    if (!Number.isNaN(l)) lo = Math.min(lo, l);
  }
  if (hi === -Infinity || lo === Infinity) return null;
  return { high: hi, low: lo };
}

/** 'K 代理 '仅日盘上'下午槽；夜盘槽不可用'K 'bar */
function synthesizeDaySlotFromDaily(dailyBar, slotId) {
  if (!dailyBar) return null;
  const o = Number(dailyBar.open ?? dailyBar.close);
  const h = Number(dailyBar.high ?? o);
  const l = Number(dailyBar.low ?? o);
  const c = Number(dailyBar.close ?? o);
  if (!o || Number.isNaN(o)) return null;

  if (slotId === 'pre-day') {
    const bullish = c >= o;
    const hi = bullish ? Math.max(o, h) : Math.max(o, (o + h) / 2);
    const lo = bullish ? Math.min(o, (o + l) / 2) : Math.min(o, l);
    return { high: hi, low: lo, source: 'daily-proxy-morning' };
  }
  if (slotId === 'pre-afternoon') {
    const bullish = c >= o;
    const hi = bullish ? Math.max(c, (c + h) / 2) : Math.max(c, h);
    const lo = bullish ? Math.min(c, l) : Math.min(c, (c + l) / 2);
    return { high: hi, low: lo, source: 'daily-proxy-afternoon' };
  }
  return null;
}

/**
 * 计算槽位窗口内实'high/low
 * @param {{ instrumentId: string, window: object, dailyBars?: object[], liveQuote?: object, cnParts?: object }} opts
 */
function computeWindowHighLow(opts = {}) {
  const { instrumentId, window, dailyBars, liveQuote } = opts;
  if (!window || window.invalid) {
    return { status: 'invalid', reason: window?.reason || 'invalid_window', label: window?.label || '' };
  }

  const phase = resolveWindowPhase(window, opts.cnParts);
  const bars5m = readIntradayBars(instrumentId, '5m');
  const barsHour = readIntradayBars(instrumentId, 'hour');
  let slice = filterBarsInWindow(bars5m, window);
  let source = '5m';
  if (!slice.length) {
    slice = filterBarsInWindow(barsHour, window);
    source = slice.length ? 'hour' : source;
  }

  if (slice.length) {
    const hl = highLowFromBars(slice);
    if (hl) {
      return {
        status: phase === 'complete' ? 'complete' : 'intraday',
        actualHigh: hl.high,
        actualLow: hl.low,
        actualRange: hl.high - hl.low,
        source,
        barCount: slice.length,
        window,
        label: phase === 'complete' ? '已收' : '盘中',
      };
    }
  }

  if (phase === 'intraday' || phase === 'complete') {
    const liveHigh = liveQuote?.high;
    const liveLow = liveQuote?.low;
    if (liveHigh != null && liveLow != null && !Number.isNaN(Number(liveHigh))) {
      const hi = Number(liveHigh);
      const lo = Number(liveLow);
      return {
        status: phase === 'complete' ? 'complete' : 'intraday',
        actualHigh: hi,
        actualLow: lo,
        actualRange: hi - lo,
        source: 'live-quote',
        window,
        label: phase === 'complete' ? '已收' : '盘中',
      };
    }
  }

  if (window.slotId === 'pre-day' || window.slotId === 'pre-afternoon') {
    const day = String(window.sessionDate || '').slice(0, 10);
    const dailyBar = (dailyBars || []).find((b) => cnSession.normBarDate(b) === day);
    const proxy = synthesizeDaySlotFromDaily(dailyBar, window.slotId);
    if (proxy && phase === 'complete') {
      return {
        status: 'complete',
        actualHigh: proxy.high,
        actualLow: proxy.low,
        actualRange: proxy.high - proxy.low,
        source: proxy.source,
        window,
        label: '日K代理',
      };
    }
  }

  if (phase === 'pending') {
    return { status: 'pending', window, label: '待开' };
  }

  return {
    status: phase === 'complete' ? 'complete' : 'intraday',
    actualHigh: null,
    actualLow: null,
    source: 'unavailable',
    window,
    label: phase === 'complete' ? '缺分钟数' : '待数',
    reason: 'no_intraday_bars',
  };
}

function summarizeCategories() {
  const counts = { night_2300: 0, night_0100: 0, night_0230: 0, no_night: 0 };
  const byCategory = { night_2300: [], night_0100: [], night_0230: [], no_night: [] };
  for (const [id, p] of Object.entries(INSTRUMENT_NIGHT_PROFILE)) {
    counts[p.category] = (counts[p.category] || 0) + 1;
    byCategory[p.category].push(id);
  }
  return { counts, byCategory, total: Object.keys(INSTRUMENT_NIGHT_PROFILE).length };
}

function buildSlotWindowLabelsForInstrument(instrumentId, sessionDate, captureDates = {}) {
  const sess = String(sessionDate || '').slice(0, 10);
  const out = {};
  for (const slotId of ['pre-night', 'pre-day', 'pre-afternoon']) {
    out[slotId] = getSlotWindowLabel(instrumentId, slotId, sess, {
      captureDate: captureDates[slotId] || captureDates.preNight || undefined,
    });
  }
  return out;
}

module.exports = {
  TIMEZONE,
  SESSION_WINDOW_VERSION,
  DAY_MORNING,
  DAY_AFTERNOON,
  INSTRUMENT_NIGHT_PROFILE,
  NIGHT_END_LABEL,
  getInstrumentNightProfile,
  getSessionWindow,
  getSlotWindowLabel,
  buildSlotWindowLabelsForInstrument,
  resolveWindowPhase,
  readIntradayBars,
  filterBarsInWindow,
  highLowFromBars,
  computeWindowHighLow,
  summarizeCategories,
  barTimestampMs,
};
