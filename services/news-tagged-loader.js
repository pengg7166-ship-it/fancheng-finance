/**
 * 按日标注新闻 CSV — 长周期 walk-forward 回测用
 * 路径: {dataDir}/history/news-tagged.csv
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { getCommodityMeta } = require('./commodities-catalog');
const { normalizeCommodityId } = require('./policy-commodity-map');

const CSV_HEADERS = ['date', 'title', 'commodity_tags', 'direction', 'stars', 'source_tier', 'event_id', 'notes'];

const SOURCE_TIER_TO_BUCKET = {
  policy: 'policy',
  geo: 'geo',
  geopolitics: 'geo',
  climate: 'climate',
  weather: 'climate',
  commodity: 'commodity',
  macro: 'macro',
  fed: 'macro',
  fomc: 'macro',
};

let cachedRows = null;
let cachedByDate = null;
let cachedPath = null;

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getNewsTaggedPath() {
  return path.join(getHistoryDir(), 'news-tagged.csv');
}

function getNewsTaggedTemplatePath() {
  return path.join(getHistoryDir(), 'news-tagged.template.csv');
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = (cols[j] || '').trim();
    }
    if (!row.date || !row.title) continue;
    row.date = String(row.date).slice(0, 10);
    row.direction = (row.direction || 'neutral').toLowerCase();
    row.stars = Math.max(1, Math.min(5, parseInt(row.stars, 10) || 3));
    row.source_tier = (row.source_tier || 'commodity').toLowerCase();
    rows.push(row);
  }
  return rows;
}

function escapeCsvField(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows) {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      CSV_HEADERS.map((h) => escapeCsvField(row[h] ?? '')).join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

function indexByDate(rows) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }
  return byDate;
}

function loadNewsTagged({ force = false } = {}) {
  const p = getNewsTaggedPath();
  if (!force && cachedRows && cachedPath === p) {
    return { path: p, rows: cachedRows, byDate: cachedByDate };
  }
  cachedPath = p;
  if (!fs.existsSync(p)) {
    cachedRows = [];
    cachedByDate = new Map();
    return { path: p, rows: cachedRows, byDate: cachedByDate, missing: true };
  }
  try {
    cachedRows = parseCsv(fs.readFileSync(p, 'utf8'));
    cachedByDate = indexByDate(cachedRows);
    return { path: p, rows: cachedRows, byDate: cachedByDate };
  } catch (err) {
    cachedRows = [];
    cachedByDate = new Map();
    return { path: p, rows: cachedRows, byDate: cachedByDate, error: err.message };
  }
}

function isLoaded() {
  const { rows, missing } = loadNewsTagged();
  return !missing && rows.length > 0;
}

function getRowCount() {
  return loadNewsTagged().rows.length;
}

function parseCommodityTags(tagStr) {
  return String(tagStr || '')
    .split(/[;|,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((tag) => {
      const lower = tag.toLowerCase();
      const meta = getCommodityMeta(lower) || getCommodityMeta(tag);
      return { id: meta?.id || lower, name: meta?.name || tag };
    });
}

function rowToNewsItem(row) {
  const bucket = SOURCE_TIER_TO_BUCKET[row.source_tier] || 'commodity';
  return {
    title: row.title,
    summary: row.notes || '',
    direction: row.direction || 'neutral',
    stars: row.stars || 3,
    sourceName: row.source_tier,
    source: row.source_tier,
    commodities: parseCommodityTags(row.commodity_tags),
    _newsBucket: bucket,
    eventId: row.event_id || null,
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clampStars(n) {
  return clamp(Math.round(n * 2) / 2, 1, 5);
}

const NEWS_SOURCE_TIER = { policy: 1.15, geo: 1.1, climate: 0.95, commodity: 1, macro: 1.05, default: 1 };

function scoreNewsForInstrumentAtDate(meta, profile, date) {
  const { byDate } = loadNewsTagged();
  const d = String(date || '').slice(0, 10);
  const dayRows = byDate.get(d) || [];
  if (!dayRows.length) {
    return { score: 0, shock: 0, hitCount: 0, hits: [], buckets: {}, bucketWeight: {}, weight: 0, bullish: 0, bearish: 0, summary: '资讯中性（0条命中）', shockDisplay: '+0.00', confidence: 1.5, topTitle: null };
  }

  const normId = normalizeCommodityId(meta.id);
  const sector = profile.sector || meta.sector;
  const keywords = [...new Set([...(profile.newsAliases || []), ...(meta.keywords || [])])];
  const buckets = { policy: 0, geo: 0, climate: 0, commodity: 0, macro: 0 };
  const bucketWeight = { policy: 0, geo: 0, climate: 0, commodity: 0, macro: 0 };
  let bullish = 0;
  let bearish = 0;
  let weight = 0;
  let hitCount = 0;
  const hits = [];

  for (const row of dayRows) {
    const tags = parseCommodityTags(row.commodity_tags);
    const tagHit = tags.some((t) => normalizeCommodityId(t.id) === normId);
    const sectorHit = tags.some((t) => String(t.id).toLowerCase() === String(sector).toLowerCase());
    const text = `${row.title} ${row.notes || ''}`.toLowerCase();
    const kwHit = keywords.some((kw) => {
      const k = String(kw).toLowerCase().trim();
      return k.length >= 2 && text.includes(k);
    });
    const untagged = !row.commodity_tags || !String(row.commodity_tags).trim();
    let relevance = 0;
    if (tagHit) relevance = 1;
    else if (sectorHit) relevance = 0.75;
    else if (kwHit) relevance = 0.55;
    else if (untagged) relevance = 0.35;
    if (relevance < 0.2) continue;

    hitCount += 1;
    const bucket = SOURCE_TIER_TO_BUCKET[row.source_tier] || 'commodity';
    const tier = NEWS_SOURCE_TIER[bucket] || NEWS_SOURCE_TIER.default;
    const w = relevance * ((row.stars || 3) / 5) * tier;
    const dir = row.direction || 'neutral';
    if (dir === 'bullish') bullish += w;
    else if (dir === 'bearish') bearish += w;
    weight += w;
    buckets[bucket] = (buckets[bucket] || 0) + (dir === 'bullish' ? w : dir === 'bearish' ? -w : 0);
    bucketWeight[bucket] = (bucketWeight[bucket] || 0) + w;

    if (hits.length < 6) {
      hits.push({
        title: (row.title || '').slice(0, 80),
        direction: dir,
        stars: row.stars || 3,
        source: row.source_tier || '标注',
        bucket,
        relevance: +relevance.toFixed(2),
        eventId: row.event_id || null,
      });
    }
  }

  const cap = profile.newsShockCap ?? 0.35;
  const score = weight > 0 ? clamp((bullish - bearish) / weight, -1, 1) : 0;
  const shockRaw = weight > 0 ? clamp((bullish - bearish) * 0.22, -cap, cap) : 0;
  const shock = +shockRaw.toFixed(2);

  let summary;
  if (hitCount === 0) summary = '资讯中性（0条命中）';
  else summary = `标注新闻 ${shock >= 0 ? '+' : ''}${shock.toFixed(2)}（${hitCount}条）`;

  return {
    score,
    shock,
    shockDisplay: `${shock >= 0 ? '+' : ''}${shock.toFixed(2)}`,
    confidence: clampStars(hitCount > 0 ? 2 + Math.min(weight, 3) : 1.5),
    summary,
    weight,
    hitCount,
    hits,
    buckets,
    bucketWeight,
    bullish,
    bearish,
    topTitle: hits[0]?.title || null,
  };
}

function writeNewsTaggedCsv(rows, { backup = true } = {}) {
  const p = getNewsTaggedPath();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  if (backup && fs.existsSync(p)) {
    const bak = `${p}.bak-${Date.now()}`;
    fs.copyFileSync(p, bak);
  }
  fs.writeFileSync(p, rowsToCsv(sorted), 'utf8');
  cachedRows = null;
  cachedByDate = null;
  return { path: p, count: sorted.length };
}

module.exports = {
  CSV_HEADERS,
  getHistoryDir,
  getNewsTaggedPath,
  getNewsTaggedTemplatePath,
  parseCsv,
  rowsToCsv,
  loadNewsTagged,
  isLoaded,
  getRowCount,
  rowToNewsItem,
  scoreNewsForInstrumentAtDate,
  writeNewsTaggedCsv,
  escapeCsvField,
};
