/**
 * 大宗商品数据发布日历（前瞻，不造假实际值）
 * EIA 周度库存 · WASDE · 国统局 CPI 窗口
 */
const fs = require('fs');
const path = require('path');
const diskCache = require('./disk-cache');
const { getDataDir } = require('./data-paths');

const RELEASE_CAL_VERSION = 'v1.56.7-release-cal';
const DISK_KEY = 'commodity-release-calendar.json';

const RELEASE_DEFS = {
  'eia-weekly': {
    id: 'eia-weekly',
    name: 'EIA 周度石油库存',
    agency: 'EIA',
    region: 'us',
    layer: 'intl',
    symbols: ['sc', 'fu', 'pg', 'bu'],
    sectors: ['energy'],
    keywords: ['EIA', 'crude', 'petroleum', 'inventory', '原油库存'],
  },
  wasde: {
    id: 'wasde',
    name: 'USDA WASDE',
    agency: 'USDA',
    region: 'us',
    layer: 'intl',
    symbols: ['m', 'y', 'p', 'c', 'cf', 'sr', 'lh', 'jd'],
    sectors: ['agriculture'],
    keywords: ['WASDE', 'USDA', '大豆', '玉米', '期末库存'],
  },
  'nbs-cpi': {
    id: 'nbs-cpi',
    name: '中国 CPI/PPI',
    agency: 'NBS',
    region: 'cn',
    layer: 'policy',
    symbols: [],
    sectors: ['black', 'chemical', 'agriculture'],
    keywords: ['CPI', 'PPI', '通胀', '物价'],
  },
};

let cachedDates = null;

function loadReleaseDates() {
  if (cachedDates) return cachedDates;
  const fp = path.join(__dirname, '..', 'data', 'commodity-release-dates.json');
  try {
    cachedDates = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    cachedDates = { wasde2026: [], usFederalHolidays2026: [] };
  }
  return cachedDates;
}

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function asOfKey(asOfDate) {
  if (!asOfDate) return new Date().toISOString().slice(0, 10);
  if (typeof asOfDate === 'string') return asOfDate.slice(0, 10);
  return asOfDate.toISOString().slice(0, 10);
}

function parseYmd(ymd) {
  const d = new Date(`${normDate(ymd)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) return 999;
  return Math.round((db - da) / 86400000);
}

function isUsEasternDst(ymd) {
  const d = parseYmd(ymd);
  if (!d) return false;
  const y = d.getUTCFullYear();
  const march1 = new Date(Date.UTC(y, 2, 1));
  const dstStart = new Date(Date.UTC(y, 2, 14 - march1.getUTCDay()));
  const nov1 = new Date(Date.UTC(y, 10, 1));
  const dstEnd = new Date(Date.UTC(y, 10, 7 - nov1.getUTCDay()));
  return d >= dstStart && d < dstEnd;
}

function etReleaseIso(ymd, hour, minute) {
  const dst = isUsEasternDst(ymd);
  const offset = dst ? '-04:00' : '-05:00';
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${normDate(ymd)}T${hh}:${mm}:00${offset}`;
}

function isUsFederalHoliday(ymd) {
  const holidays = loadReleaseDates().usFederalHolidays2026 || [];
  return holidays.includes(normDate(ymd));
}

function adjustEiaWednesday(ymd) {
  let d = normDate(ymd);
  if (isUsFederalHoliday(d)) {
    const next = parseYmd(d);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return d;
}

function upcomingEiaWeekly(asOf, daysAhead) {
  const out = [];
  let cursor = parseYmd(asOf);
  if (!cursor) return out;
  const end = parseYmd(asOf);
  end.setUTCDate(end.getUTCDate() + daysAhead);

  while (cursor <= end && out.length < 8) {
    const dow = cursor.getUTCDay();
    const daysToWed = (3 - dow + 7) % 7;
    const wed = new Date(cursor);
    wed.setUTCDate(wed.getUTCDate() + daysToWed);
    const wedKey = wed.toISOString().slice(0, 10);
    if (parseYmd(wedKey) >= parseYmd(asOf) && !out.some((r) => r.releaseDate === wedKey)) {
      const adjusted = adjustEiaWednesday(wedKey);
      const releaseAt = etReleaseIso(adjusted, 10, 30);
      const hoursUntil = (new Date(releaseAt).getTime() - Date.now()) / 3600000;
      out.push({
        ...RELEASE_DEFS['eia-weekly'],
        releaseDate: adjusted,
        releaseAt,
        releaseAtLocal: formatCn(releaseAt),
        estimated: adjusted !== wedKey,
        confidence: adjusted !== wedKey ? 'holiday-adjusted' : 'rule',
        method: 'eia-wednesday-1030-et',
        dataSource: 'eia.gov/petroleum/supply/weekly',
        hoursUntil: Math.round(hoursUntil * 10) / 10,
        imminent: hoursUntil >= 0 && hoursUntil <= 24,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

/** 回溯已过 EIA 周三（供 T+3/5/10 结构跟进） */
function recentPastEiaWeekly(asOf, lookbackDays) {
  const out = [];
  const end = parseYmd(asOf);
  if (!end) return out;
  const start = parseYmd(asOf);
  start.setUTCDate(start.getUTCDate() - lookbackDays);
  let cursor = new Date(start);
  while (cursor < end && out.length < 4) {
    if (cursor.getUTCDay() === 3) {
      const wedKey = cursor.toISOString().slice(0, 10);
      const adjusted = adjustEiaWednesday(wedKey);
      if (parseYmd(adjusted) < parseYmd(asOf) && !out.some((r) => r.releaseDate === adjusted)) {
        const releaseAt = etReleaseIso(adjusted, 10, 30);
        const hoursUntil = (new Date(releaseAt).getTime() - Date.now()) / 3600000;
        out.push({
          ...RELEASE_DEFS['eia-weekly'],
          releaseDate: adjusted,
          releaseAt,
          releaseAtLocal: formatCn(releaseAt),
          estimated: adjusted !== wedKey,
          confidence: adjusted !== wedKey ? 'holiday-adjusted' : 'rule',
          method: 'eia-wednesday-1030-et',
          dataSource: 'eia.gov/petroleum/supply/weekly',
          hoursUntil: Math.round(hoursUntil * 10) / 10,
          imminent: false,
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function upcomingWasde(asOf, daysAhead) {
  const dates = loadReleaseDates().wasde2026 || [];
  const out = [];
  for (const d of dates) {
    if (daysBetween(asOf, d) < 0) continue;
    if (daysBetween(asOf, d) > daysAhead) continue;
    const releaseAt = etReleaseIso(d, 12, 0);
    const hoursUntil = (new Date(releaseAt).getTime() - Date.now()) / 3600000;
    out.push({
      ...RELEASE_DEFS.wasde,
      releaseDate: d,
      releaseAt,
      releaseAtLocal: formatCn(releaseAt),
      estimated: false,
      confidence: 'usda-calendar',
      method: 'usda-wasde-2026-json',
      dataSource: 'usda.gov/oce/commodity/wasde',
      hoursUntil: Math.round(hoursUntil * 10) / 10,
      imminent: hoursUntil >= 0 && hoursUntil <= 24,
    });
  }
  return out;
}

function upcomingNbsCpiWindow(asOf, daysAhead) {
  const out = [];
  const base = parseYmd(asOf);
  if (!base) return out;
  for (let m = 0; m <= 2; m += 1) {
    const y = base.getUTCFullYear();
    const month = base.getUTCMonth() + m;
    const dt = new Date(Date.UTC(y, month, 9));
    const windowStart = dt.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, month, 15));
    const windowEnd = end.toISOString().slice(0, 10);
    if (daysBetween(asOf, windowEnd) < 0) continue;
    if (daysBetween(windowStart, asOf) > daysAhead) continue;
    const hoursUntil = (new Date(`${windowStart}T09:00:00+08:00`).getTime() - Date.now()) / 3600000;
    const inWindow = normDate(asOf) >= normDate(windowStart) && normDate(asOf) <= normDate(windowEnd);
    out.push({
      ...RELEASE_DEFS['nbs-cpi'],
      releaseDate: windowStart,
      windowEnd,
      releaseAt: null,
      releaseAtLocal: '待公布',
      estimated: true,
      confidence: 'window-only',
      method: 'nbs-monthly-window-9-15',
      dataSource: 'stats.gov.cn',
      note: '国统局 CPI/PPI 公布窗口，确切日以官网为准',
      hoursUntil: Math.round(hoursUntil * 10) / 10,
      imminent: inWindow,
    });
  }
  return out;
}

function formatCn(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function buildReleaseCalendar({ daysAhead = 14, asOfDate, lookbackDays = 0 } = {}) {
  const asOf = asOfKey(asOfDate);
  const releases = [
    ...(lookbackDays > 0 ? recentPastEiaWeekly(asOf, lookbackDays) : []),
    ...upcomingEiaWeekly(asOf, daysAhead),
    ...upcomingWasde(asOf, daysAhead),
    ...upcomingNbsCpiWindow(asOf, daysAhead),
  ].sort((a, b) => {
    const da = a.releaseAt || `${a.releaseDate}T23:59:59Z`;
    const db = b.releaseAt || `${b.releaseDate}T23:59:59Z`;
    return new Date(da) - new Date(db);
  });

  const imminent = releases.filter((r) => r.imminent);
  const nextCandidates = releases.filter((r) => normDate(r.releaseDate) >= asOf);
  const nextTimed = nextCandidates.find((r) => r.releaseAt);
  return {
    summary: {
      version: RELEASE_CAL_VERSION,
      asOf,
      daysAhead,
      total: releases.length,
      imminentCount: imminent.length,
      nextRelease: nextTimed
        ? {
            id: nextTimed.id,
            name: nextTimed.name,
            releaseDate: nextTimed.releaseDate,
            releaseAtLocal: nextTimed.releaseAtLocal,
          }
        : nextCandidates[0]
          ? {
              id: nextCandidates[0].id,
              name: nextCandidates[0].name,
              releaseDate: nextCandidates[0].releaseDate,
              releaseAtLocal: nextCandidates[0].releaseAtLocal,
            }
          : null,
      builtAt: new Date().toISOString(),
    },
    releases,
    imminent,
  };
}

function hasImminentDataRelease({ withinHours = 24, asOfDate } = {}) {
  const cal = buildReleaseCalendar({ daysAhead: 14, asOfDate });
  return cal.releases.some((r) => {
    if (r.hoursUntil == null) return r.imminent;
    return r.hoursUntil >= 0 && r.hoursUntil <= withinHours;
  });
}

function getReleaseScanBoost() {
  const cal = buildReleaseCalendar({ daysAhead: 7 });
  if (cal.imminent.length) {
    return { boost: true, reason: cal.imminent.map((r) => r.id).join(','), imminent: cal.imminent };
  }
  const soon = cal.releases.find((r) => r.hoursUntil != null && r.hoursUntil >= 0 && r.hoursUntil <= 48);
  if (soon) return { boost: true, reason: soon.id, imminent: [soon] };
  return { boost: false, reason: null, imminent: [] };
}

function persistReleaseCalendar(result) {
  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    diskCache.write(DISK_KEY, { data: result, savedAt: Date.now() });
  } catch {
    // ignore
  }
}

function readCachedReleaseCalendar({ maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    const row = diskCache.readStale(DISK_KEY);
    if (!row?.data?.summary) return null;
    const age = row.savedAt ? Date.now() - row.savedAt : Infinity;
    return { ...row.data, cached: true, cacheAgeMs: age, stale: age > maxAgeMs };
  } catch {
    return null;
  }
}

function getReleasePhase(release, nowMs = Date.now()) {
  if (!release) return 'unknown';
  if (!release.releaseAt) {
    return release.imminent ? 'in_window' : 'upcoming';
  }
  const at = new Date(release.releaseAt).getTime();
  const hours = (nowMs - at) / 3600000;
  if (hours >= -2 && hours < 0) return 'pre_release';
  if (hours >= 0 && hours <= 8) return 'post_release';
  if (hours < -2) return 'upcoming';
  return 'passed';
}

function getActiveReleaseEvents() {
  const cal = buildReleaseCalendar({ daysAhead: 10 });
  const now = Date.now();
  return cal.releases
    .map((r) => ({ ...r, phase: getReleasePhase(r, now) }))
    .filter((r) => r.phase === 'pre_release' || r.phase === 'post_release' || r.phase === 'in_window');
}

function buildReleaseCalendarWithSurprise(fundamentals, outlookPayload, newsItems = []) {
  const cal = buildReleaseCalendar({ daysAhead: 14 });
  let releaseSurprises = [];
  try {
    const { buildActiveReleaseSurprises } = require('./release-data-surprise');
    releaseSurprises = buildActiveReleaseSurprises(fundamentals, outlookPayload, newsItems);
  } catch {
    // ignore
  }
  return { ...cal, releaseSurprises, activeReleases: getActiveReleaseEvents() };
}

module.exports = {
  RELEASE_CAL_VERSION,
  RELEASE_DEFS,
  recentPastEiaWeekly,
  buildReleaseCalendar,
  buildReleaseCalendarWithSurprise,
  getReleasePhase,
  getActiveReleaseEvents,
  hasImminentDataRelease,
  getReleaseScanBoost,
  persistReleaseCalendar,
  readCachedReleaseCalendar,
};
