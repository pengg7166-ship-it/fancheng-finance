/**
 * 国内期货交易日历 'SHFE/DCE/CZCE 连续合约'K 对齐
 *
 * ## 'K  bar 日期约定（经 au.json 开收价差验证）
 *
 * 数据'`history/trading/{id}.json` 每根'bar '`date` = **日盘所在自然日**'
 * 'bar 覆盖一个完整「交易日」周期：
 *   - 夜盘：前一自然'21:00 ~ 02:30（周五夜盘归属下周一 bar'
 *   - 日盘：date 当日 09:00 ~ 15:00
 *
 * 因此'
 *   - `close[date=T]` = T '15:00 日盘收盘—**昨收基准**
 *   - `high/low[date=T+1]` = 'T '21:00 夜盘起至 T+1 '15:00 的极—**下一交易'*预测目标
 *   - 休市'bar 序列缺口表示（无 bar = 非交易日），不维护独立假日表
 *
 * 数据仅含'K，无分钟级夜'日盘拆分；下一交易'high/low 'bar[i+1] 'OHLC 为代理'
 */

const SESSION_META = {
  dayCloseTime: '15:00',
  nightOpenTime: '21:00',
  dayOpenTime: '09:00',
  timezone: 'Asia/Shanghai',
  barConvention: 'shfe-dated-by-day-session',
};

const LABELS = {
  baselineClose: '昨收·5:00',
  nextSessionHigh: '预测下一交易日（21:00夜盘起）最高点',
  nextSessionLow: '预测下一交易日（21:00夜盘起）最低点',
  nextSessionRange: '预测下一交易日（21:00夜盘起）振幅',
  nextSessionTitle: '下一交易日高低点位预',
  nextSessionSubtitle: '交易窗口：当日21:00夜盘至次日15:00日盘收盘',
  nextSessionCompact: '下一交易日（21:00夜盘起）',
};

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

/**
 * 解析 asOf 对应'bar 索引（≤ asOf 的最后一根）
 */
function resolveBarIdx(bars, asOfDate) {
  if (!bars?.length) return -1;
  const asOf = String(asOfDate || '').slice(0, 10);
  const exact = bars.findIndex((b) => normBarDate(b) === asOf);
  if (exact >= 0) return exact;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (normBarDate(bars[i]) <= asOf) return i;
  }
  return bars.length - 1;
}

/**
 * 下一'bar 索引（下一交易日），无'-1
 */
function resolveNextBarIdx(bars, barIdx) {
  if (!bars?.length || barIdx < 0 || barIdx >= bars.length - 1) return -1;
  return barIdx + 1;
}

/**
 * 昨收基准：bar[barIdx].close = 该交易日 15:00 日盘'
 */
function getBaselineClose(bars, barIdx) {
  if (barIdx < 0 || !bars[barIdx]) return null;
  const bar = bars[barIdx];
  const close = Number(bar.close ?? bar.price);
  if (!close || close <= 0 || Number.isNaN(close)) return null;
  return {
    close,
    date: normBarDate(bar),
    sessionCloseTime: SESSION_META.dayCloseTime,
    label: LABELS.baselineClose,
  };
}

/**
 * 下一交易'OHLC 目标'1:00 夜盘—次日 15:00'
 */
function getNextSessionTarget(bars, barIdx) {
  const nextIdx = resolveNextBarIdx(bars, barIdx);
  if (nextIdx < 0) return null;
  const baseline = getBaselineClose(bars, barIdx);
  if (!baseline) return null;

  const nextBar = bars[nextIdx];
  const high = Number(nextBar.high ?? nextBar.close);
  const low = Number(nextBar.low ?? nextBar.close);
  if (Number.isNaN(high) || Number.isNaN(low)) return null;

  const baselineDate = baseline.date;
  const nextDate = normBarDate(nextBar);

  return {
    high,
    low,
    range: high - low,
    highDelta: high - baseline.close,
    lowDelta: low - baseline.close,
    nextBarDate: nextDate,
    baselineDate,
    sessionStart: `${baselineDate}T${SESSION_META.nightOpenTime}:00+08:00`,
    sessionEnd: `${nextDate}T${SESSION_META.dayCloseTime}:00+08:00`,
    dataSource: 'daily-bar-proxy',
    labelHigh: LABELS.nextSessionHigh,
    labelLow: LABELS.nextSessionLow,
    labelRange: LABELS.nextSessionRange,
  };
}

/**
 * 训练/探针用：close[i] 'high/low[i+1]
 */
function getSessionPair(bars, barIdx) {
  const baseline = getBaselineClose(bars, barIdx);
  const target = getNextSessionTarget(bars, barIdx);
  if (!baseline || !target) return null;
  return { baseline, target, barIdx, nextBarIdx: barIdx + 1 };
}

/**
 * 历史窗口：各 bar 相对前一 bar 收的'低延伸（'computeIntradayStats 一致）
 */
function collectSessionExtents(bars, endIdx, lookback = 15) {
  const start = Math.max(1, endIdx - lookback + 1);
  const ranges = [];
  const upExtents = [];
  const downExtents = [];
  for (let i = start; i <= endIdx; i += 1) {
    const pair = getSessionPair(bars, i - 1);
    if (!pair) continue;
    const { baseline, target } = pair;
    ranges.push(target.range);
    upExtents.push(Math.max(0, target.high - baseline.close));
    downExtents.push(Math.max(0, baseline.close - target.low));
  }
  return { ranges, upExtents, downExtents, n: ranges.length };
}

function shiftCalendarDate(dateStr, days) {
  const dt = new Date(`${String(dateStr).slice(0, 10)}T12:00:00+08:00`);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function getCnNowParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: Number.isNaN(minute) ? 0 : minute,
  };
}

function isAfterDaySessionClose(cnParts) {
  const { hour, minute } = cnParts;
  return hour > 15 || (hour === 15 && minute >= 0);
}

/**
 * 实时预测上下文：15:00 前昨'上一交易的 bar5:00 后昨'当日 15:00 '
 */
function resolvePredictionContext(bars, now = new Date()) {
  if (!bars?.length) return null;
  const cn = getCnNowParts(now);
  const afterDayClose = isAfterDaySessionClose(cn);
  const lookupDate = afterDayClose ? cn.date : shiftCalendarDate(cn.date, -1);
  const barIdx = resolveBarIdx(bars, lookupDate);
  if (barIdx < 0) return null;
  const baseline = getBaselineClose(bars, barIdx);
  return {
    asOfDate: normBarDate(bars[barIdx]),
    barIdx,
    baseline,
    afterDayClose,
    cnDate: cn.date,
    lookupDate,
  };
}

/**
 * Export baseline dates snapped to actual bar dates (skip weekend calendar gaps).
 * Mirrors resolvePredictionContext but may return up to two distinct bar dates.
 */
function resolveExportBaselineDates(bars, now = new Date()) {
  if (!bars?.length) return [];
  const cn = getCnNowParts(now);
  const candidates = [];
  if (isAfterDaySessionClose(cn)) candidates.push(cn.date);
  candidates.push(shiftCalendarDate(cn.date, -1));
  const snapped = [];
  for (const cand of [...new Set(candidates)]) {
    const barIdx = resolveBarIdx(bars, cand);
    if (barIdx < 0) continue;
    // 末根 K 线尚无下一交易'bar，无'forward export
    if (resolveNextBarIdx(bars, barIdx) < 0) continue;
    const barDate = normBarDate(bars[barIdx]);
    if (barDate && !snapped.includes(barDate)) snapped.push(barDate);
  }
  return snapped;
}

function attachSessionMeta(result, bars, barIdx) {
  if (!result) return null;
  const baseline = getBaselineClose(bars, barIdx);
  const nextIdx = resolveNextBarIdx(bars, barIdx);
  const nextDate = nextIdx >= 0 ? normBarDate(bars[nextIdx]) : null;
  return {
    ...result,
    session: {
      ...SESSION_META,
      baselineDate: baseline?.date ?? result.baselineDate,
      baselineCloseTime: SESSION_META.dayCloseTime,
      nextSessionStart: baseline?.date
        ? `${baseline.date}T${SESSION_META.nightOpenTime}:00+08:00`
        : null,
      nextSessionEnd: nextDate ? `${nextDate}T${SESSION_META.dayCloseTime}:00+08:00` : null,
      nextSessionLabel: LABELS.nextSessionCompact,
      targetDataSource: 'daily-bar-proxy',
    },
    labels: { ...LABELS },
  };
}

module.exports = {
  SESSION_META,
  LABELS,
  normBarDate,
  shiftCalendarDate,
  getCnNowParts,
  isAfterDaySessionClose,
  resolvePredictionContext,
  resolveExportBaselineDates,
  resolveBarIdx,
  resolveNextBarIdx,
  getBaselineClose,
  getNextSessionTarget,
  getSessionPair,
  collectSessionExtents,
  attachSessionMeta,
};
