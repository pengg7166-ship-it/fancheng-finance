/**
 * 国内期货交易日历（周末 + 法定假日区间）
 * 用于收盘价/K 线滞后判定，避免周末/长假误报 critical
 */
const { loadCalendar } = require('./holiday-gap-calendar');

const CAL_VERSION = 'v1.56.5-trading-cal';

let holidayRanges = null;

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function buildHolidayRanges() {
  if (holidayRanges) return holidayRanges;
  const cal = loadCalendar();
  holidayRanges = (cal.holidays || []).map((h) => ({
    start: normDate(h.startDate),
    end: normDate(h.endDate),
    name: h.name,
  }));
  return holidayRanges;
}

function isWeekend(dateStr) {
  const d = new Date(`${normDate(dateStr)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function isCnHolidayDate(dateStr) {
  const day = normDate(dateStr);
  if (!day) return false;
  if (isWeekend(day)) return true;
  for (const h of buildHolidayRanges()) {
    if (day >= h.start && day <= h.end) return true;
  }
  return false;
}

/** 两日期间交易日数（不含 start，含 end 方向上的每个非休市日） */
function tradingDaysBetween(lastDate, endDate) {
  const start = new Date(`${normDate(lastDate)}T12:00:00`);
  const end = new Date(`${normDate(endDate)}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 999;
  if (start >= end) return 0;
  let count = 0;
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= end) {
    const key = d.toISOString().slice(0, 10);
    if (!isCnHolidayDate(key)) count += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

module.exports = {
  CAL_VERSION,
  isCnHolidayDate,
  tradingDaysBetween,
  buildHolidayRanges,
};
