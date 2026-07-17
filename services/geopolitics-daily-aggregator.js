/**
 * Geopolitics daily aggregation from news-tagged.csv (source_tier geo/geopolitics)
 * Output: {dataDir}/history/geopolitics-daily.json
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const newsTagged = require('./news-tagged-loader');
const philosophy = require('./commodity-outlook-philosophy');

const OUT_FILE = 'geopolitics-daily.json';
const VERSION = 'v1-geopolitics-daily-aggregate';
const GEO_SOURCE_TIERS = new Set(['geo', 'geopolitics']);
const GEO_TIER_MULT = 1.1;
const SHOCK_CAP = 0.35;

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isGeoRow(row) {
  return GEO_SOURCE_TIERS.has(String(row.source_tier || '').toLowerCase());
}

function aggregateGeoRowsForDate(dayRows, priorRows, date) {
  const geoRows = dayRows.filter(isGeoRow);
  if (!geoRows.length) return null;

  let bullish = 0;
  let bearish = 0;
  let weight = 0;
  let starSum = 0;
  let maxStars = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  const titles = [];
  let topRow = null;
  let topWeight = -1;

  for (const row of geoRows) {
    const dir = String(row.direction || 'neutral').toLowerCase();
    const stars = Math.max(1, Math.min(5, parseInt(row.stars, 10) || 3));
    const stim = philosophy.applyItemStimulusWeight(
      { title: row.title, notes: row.notes, eventId: row.event_id, direction: dir, sourceName: row.source_tier },
      { priorRows, asOfDate: date }
    );
    const w = (stars / 5) * GEO_TIER_MULT * stim.decay;
    if (dir === 'bullish') {
      bullish += w;
      bullishCount += 1;
    } else if (dir === 'bearish') {
      bearish += w;
      bearishCount += 1;
    } else {
      neutralCount += 1;
    }
    weight += w;
    starSum += stars;
    maxStars = Math.max(maxStars, stars);
    if (titles.length < 6) titles.push(String(row.title || '').slice(0, 120));
    if (w > topWeight) {
      topWeight = w;
      topRow = row;
    }
  }

  const netScore = weight > 0 ? clamp((bullish - bearish) / weight, -1, 1) : 0;
  const geoShock = weight > 0 ? +clamp((bullish - bearish) * 0.22, -SHOCK_CAP, SHOCK_CAP).toFixed(4) : 0;
  let direction = 'neutral';
  if (netScore > 0.08) direction = 'bullish';
  else if (netScore < -0.08) direction = 'bearish';

  return {
    date,
    itemCount: geoRows.length,
    bullishCount,
    bearishCount,
    neutralCount,
    bullishWeight: +bullish.toFixed(4),
    bearishWeight: +bearish.toFixed(4),
    weight: +weight.toFixed(4),
    netScore: +netScore.toFixed(4),
    geoShock,
    avgStars: +(starSum / geoRows.length).toFixed(2),
    maxStars,
    direction,
    topTitle: topRow?.title ? String(topRow.title).slice(0, 120) : null,
    topEventId: topRow?.event_id || null,
    titles,
  };
}

function buildGeopoliticsDailySeries({ forceReload = false } = {}) {
  const { path: csvPath, rows } = newsTagged.loadNewsTagged({ force: forceReload });
  const geoRows = rows.filter(isGeoRow);
  const dates = [...new Set(geoRows.map((r) => normDate(r.date)))].sort();
  const series = [];

  for (const date of dates) {
    const dayRows = rows.filter((r) => normDate(r.date) === date);
    const priorRows = newsTagged.getPriorRowsBeforeDate(date);
    const agg = aggregateGeoRowsForDate(dayRows, priorRows, date);
    if (agg) series.push(agg);
  }

  const directionCounts = series.reduce(
    (acc, row) => {
      acc[row.direction] = (acc[row.direction] || 0) + 1;
      return acc;
    },
    { bullish: 0, bearish: 0, neutral: 0 }
  );

  return {
    version: VERSION,
    source: 'news-tagged.csv',
    sourcePath: csvPath,
    sourceRowCount: rows.length,
    geoSourceRowCount: geoRows.length,
    generatedAt: new Date().toISOString(),
    startDate: series[0]?.date || null,
    endDate: series[series.length - 1]?.date || null,
    daysWithGeoNews: series.length,
    directionCounts,
    series,
  };
}

function saveGeopoliticsDailySeries(options = {}) {
  const payload = buildGeopoliticsDailySeries(options);
  const jsonPath = path.join(getHistoryDir(), OUT_FILE);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  _cache.rows = null;
  _cache.mtime = 0;
  return { payload, jsonPath };
}

const _cache = { rows: null, mtime: 0, meta: null };

function loadGeopoliticsDailyPayload({ force = false } = {}) {
  const jsonPath = path.join(getHistoryDir(), OUT_FILE);
  if (!fs.existsSync(jsonPath)) return { jsonPath, payload: null, series: [], missing: true };
  try {
    const stat = fs.statSync(jsonPath);
    if (!force && _cache.rows && _cache.mtime === stat.mtimeMs) {
      return { jsonPath, payload: _cache.meta, series: _cache.rows, missing: false };
    }
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const series = Array.isArray(payload) ? payload : payload.series || [];
    _cache.rows = series;
    _cache.meta = payload;
    _cache.mtime = stat.mtimeMs;
    return { jsonPath, payload, series, missing: false };
  } catch (err) {
    return { jsonPath, payload: null, series: [], missing: true, error: err.message };
  }
}

function getGeopoliticsDailyAtDate(date) {
  const d = normDate(date);
  const { series } = loadGeopoliticsDailyPayload();
  return series.find((row) => normDate(row.date) === d) || null;
}

function getGeopoliticsShockAtDate(date) {
  return getGeopoliticsDailyAtDate(date)?.geoShock ?? 0;
}

module.exports = {
  OUT_FILE,
  VERSION,
  GEO_SOURCE_TIERS,
  buildGeopoliticsDailySeries,
  saveGeopoliticsDailySeries,
  loadGeopoliticsDailyPayload,
  getGeopoliticsDailyAtDate,
  getGeopoliticsShockAtDate,
  aggregateGeoRowsForDate,
  isGeoRow,
};
