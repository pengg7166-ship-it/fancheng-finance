/**
 * 假期缺口日历 '国内期货休市 gap 风险
 */
const fs = require('fs');
const path = require('path');

const GAP_CAL_VERSION = 'v1.44.0-discipline';
const LOOKAHEAD_DAYS = 10;

let cachedCalendar = null;

function loadCalendar() {
  if (cachedCalendar) return cachedCalendar;
  const fp = path.join(__dirname, '..', 'data', 'china-holiday-gaps.json');
  try {
    cachedCalendar = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    cachedCalendar = { holidays: [] };
  }
  return cachedCalendar;
}

function parseDate(str) {
  const d = new Date(`${str}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const ms = parseDate(b)?.getTime() - parseDate(a)?.getTime();
  if (ms == null || Number.isNaN(ms)) return null;
  return Math.round(ms / (24 * 3600 * 1000));
}

function riskLevelFor(holiday, daysUntilStart) {
  if (daysUntilStart == null || daysUntilStart < 0) return 'none';
  const pre = holiday.preWindowDays ?? 2;
  const sev = holiday.severity || 'medium';
  if (daysUntilStart <= pre && sev === 'high') return 'critical';
  if (daysUntilStart <= pre) return 'warn';
  if (daysUntilStart <= LOOKAHEAD_DAYS && sev === 'high') return 'warn';
  if (daysUntilStart <= LOOKAHEAD_DAYS) return 'caution';
  return 'none';
}

/**
 * @param {string|Date} asOfDate 'YYYY-MM-DD
 */
function getHolidayGapRisk(asOfDate = new Date()) {
  const asOf =
    typeof asOfDate === 'string'
      ? asOfDate.slice(0, 10)
      : asOfDate.toISOString().slice(0, 10);
  const cal = loadCalendar();
  let best = null;

  for (const h of cal.holidays || []) {
    const start = h.startDate;
    const daysUntil = daysBetween(asOf, start);
    if (daysUntil == null || daysUntil < 0 || daysUntil > LOOKAHEAD_DAYS) continue;
    const level = riskLevelFor(h, daysUntil);
    if (level === 'none') continue;
    const candidate = {
      holidayId: h.id,
      name: h.name,
      startDate: h.startDate,
      endDate: h.endDate,
      gapTradingDays: h.gapTradingDays,
      daysUntilStart: daysUntil,
      riskLevel: level,
      briefLine: `${h.name} ${daysUntil} 天后休市 · gap ${h.gapTradingDays} 交易日`,
      preWindowDays: h.preWindowDays,
      postWindowDays: h.postWindowDays,
    };
    if (!best || candidate.daysUntilStart < best.daysUntilStart) best = candidate;
  }

  if (!best) {
    return {
      upcoming: false,
      riskLevel: 'none',
      briefLine: `${LOOKAHEAD_DAYS} 日内无重大假期缺口`,
      asOf,
      version: GAP_CAL_VERSION,
      dataSource: 'holiday-gap-calendar',
      method: 'china-holiday-gaps.json',
    };
  }

  return {
    upcoming: true,
    ...best,
    asOf,
    version: GAP_CAL_VERSION,
    dataSource: 'holiday-gap-calendar',
    method: 'china-holiday-gaps.json',
  };
}

module.exports = {
  GAP_CAL_VERSION,
  LOOKAHEAD_DAYS,
  loadCalendar,
  getHolidayGapRisk,
};
