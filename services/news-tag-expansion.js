/**
 * News-tagged expansion helpers 'policy/geo/supply tagging, flash filter, warehouse backfill
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { normalizeTags, normalizeSourceTier } = require('./news-tag-normalize');
const {
  detectCommodityTags,
  detectPolicyTypes,
  detectImpactDirection,
} = require('./policy-commodity-map');
const { getWarehouseReceiptChg5dAtDate } = require('./shfe-warehouse-fetcher');

const GEO_KEYWORDS = /地缘|伊朗|以色列|俄乌|乌克兰|制裁|中东|红海|霍尔木兹|Taiwan|台海|战争|冲突|strike|missile|embargo|sanction/i;
const WAREHOUSE_TITLE_RE = /仓单|warehouse|注册仓单|supply_up|supply_down/i;
const FLASH_SKIP_RE = /世界杯|足球|篮球|减持.*股份|离婚|娱乐|明星|票房|高考|综艺|游戏版号/i;

function computeNewsStats(rows, { minDate = '2019-01-01' } = {}) {
  const filtered = rows.filter((r) => r.date >= minDate);
  const tiers = {};
  const dirs = {};
  const byYear = {};
  const tagCounts = {};
  let auAg = 0;
  let geo = 0;
  let warehouse = 0;

  for (const r of filtered) {
    tiers[r.source_tier] = (tiers[r.source_tier] || 0) + 1;
    dirs[r.direction] = (dirs[r.direction] || 0) + 1;
    const y = r.date.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + 1;
    for (const t of String(r.commodity_tags || '').split(/[;|,]/).filter(Boolean)) {
      tagCounts[t.toLowerCase()] = (tagCounts[t.toLowerCase()] || 0) + 1;
    }
    if (/(^|;|,)(au|ag)(;|,|$)/i.test(r.commodity_tags || '')) auAg += 1;
    if (['geo', 'geopolitics'].includes(String(r.source_tier || '').toLowerCase())) geo += 1;
    if (WAREHOUSE_TITLE_RE.test(`${r.title}${r.notes}${r.event_id}`)) warehouse += 1;
  }

  const dates = filtered.map((r) => r.date).sort();
  return {
    count: filtered.length,
    totalAllYears: rows.length,
    minDate: dates[0] || null,
    maxDate: dates[dates.length - 1] || null,
    tiers,
    dirs,
    byYear,
    auAgTagged: auAg,
    geoTagged: geo,
    warehouseTagged: warehouse,
    topTags: Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, n]) => ({ tag, n })),
  };
}

function inferSourceTierFromText(text, keywordHits = []) {
  const lower = String(text || '').toLowerCase();
  const policyTypes = detectPolicyTypes(text);
  const hits = new Set(keywordHits || []);

  if (GEO_KEYWORDS.test(text)) return 'geo';
  if (hits.has('fed') || hits.has('macro') || policyTypes.includes('monetary')) return 'macro';
  if (hits.has('tariff') || hits.has('sanction') || policyTypes.includes('trade')) return 'policy';
  if (hits.has('oil') || hits.has('coal') || policyTypes.includes('reserve')) return 'commodity';
  if (hits.has('china-policy') || policyTypes.includes('industry') || policyTypes.includes('regulation')) {
    return 'policy';
  }
  if (policyTypes.includes('environmental')) return 'climate';
  if (/仓单|库存|抛储|收储|warehouse|inventory|supply shock|供应/.test(text)) return 'commodity';
  if (/FOMC|美联储|Powell|非农|CPI|PPI/.test(text)) return 'macro';
  return 'commodity';
}

function inferDirectionFromText(text, fallback = 'neutral') {
  const fromPolicy = detectImpactDirection(text);
  if (fromPolicy !== 'neutral') return fromPolicy;
  if (/降息|降准|刺激|减产|禁令|制裁升级|供应紧张|收储|反弹|大涨|突破|创新高/.test(text)) return 'bullish';
  if (/加息|收紧|增产|抛储|大跌|暴跌|供应过剩|仓单.*增|注册仓单.*增|warehouse.*up/.test(text)) return 'bearish';
  return fallback;
}

function enrichFlashText(candidate) {
  const title = String(candidate.title || '').trim();
  const summary = String(candidate.summary || '').trim();
  const text = `${title} ${summary}`;
  const tagsFromInbox = (candidate.commodityTags || []).filter(Boolean);
  const detected = detectCommodityTags(text).map((t) => t.id);
  const commodity_tags = normalizeTags(
    [...new Set([...tagsFromInbox, ...detected])].join(';'),
    { title, notes: summary }
  );
  const keywordHits = candidate.keywordHits || [];
  const source_tier = normalizeSourceTier(
    inferSourceTierFromText(text, keywordHits)
  );
  const direction = inferDirectionFromText(text, 'neutral');
  return { commodity_tags, source_tier, direction, text };
}

function isRelevantFlashCandidate(candidate) {
  if (candidate.status === 'merged' || candidate.status === 'rejected') return false;
  const title = String(candidate.title || '').trim();
  const summary = String(candidate.summary || '').trim();
  if (!title) return false;
  if (FLASH_SKIP_RE.test(title) || FLASH_SKIP_RE.test(summary)) return false;

  const keywordHits = candidate.keywordHits || [];
  const inboxTags = candidate.commodityTags || [];
  if (keywordHits.length > 0 || inboxTags.length > 0) return true;

  const { commodity_tags } = enrichFlashText(candidate);
  if (commodity_tags) return true;

  const text = `${title} ${summary}`;
  if (GEO_KEYWORDS.test(text)) return true;
  if (/FOMC|美联储|关税|原油|OPEC|制裁|国务院|发改委|央行|期货|commodity|gold|silver|铜|银/i.test(text)) {
    return true;
  }
  return false;
}

function flashCandidateToExpansionRow(candidate) {
  const d = parseFlashPubDate(candidate.pubDate);
  const date = d ? d.toISOString().slice(0, 10) : String(candidate.pubDate || '').slice(0, 10);
  if (!date || !candidate.title) return null;

  const { commodity_tags, source_tier, direction, text } = enrichFlashText(candidate);
  if (!commodity_tags && !isRelevantFlashCandidate(candidate)) return null;

  const keywordCount = (candidate.keywordHits || []).length;
  let stars = 2;
  if (keywordCount >= 2 || String(commodity_tags).split(';').filter(Boolean).length >= 2) stars = 4;
  else if (keywordCount >= 1 || commodity_tags) stars = 3;
  if (source_tier === 'geo' || source_tier === 'policy') stars = Math.max(stars, 3);

  const notesParts = [
    candidate.summary,
    candidate.sourceName ? `'${candidate.sourceName}` : '',
    candidate.link || '',
    'flash-inbox自动导入',
  ].filter(Boolean);

  return {
    date,
    title: String(candidate.title).trim().replace(/^"|"$/g, ''),
    commodity_tags: commodity_tags || '',
    direction,
    stars: String(stars),
    source_tier,
    event_id: candidate.id ? `flash_${String(candidate.id).slice(0, 12)}` : '',
    notes: notesParts.join(' | ').slice(0, 400),
    _flashId: candidate.id,
    _expansionSource: 'flash-inbox',
  };
}

function parseFlashPubDate(raw) {
  if (!raw) return null;
  if (typeof raw === 'number') {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s, 10) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s, 10));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasWarehouseRowOnDate(rows, date, instrumentId) {
  const id = instrumentId.toLowerCase();
  return rows.some(
    (r) =>
      r.date === date &&
      WAREHOUSE_TITLE_RE.test(`${r.title}${r.notes}${r.event_id}`) &&
      new RegExp(`(^|;|,)(${id})(;|,|$)`, 'i').test(r.commodity_tags || '')
  );
}

function buildWarehouseSupplyRows(instrumentId, existingRows, { minDate = '2019-01-01', chgThreshold = 1.5 } = {}) {
  const id = String(instrumentId).toLowerCase();
  const label = id === 'au' ? '沪金' : id === 'ag' ? '沪银' : id.toUpperCase();
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const whPath = path.join(dataDir, 'history', 'warehouse-receipts', `${id}-daily.json`);
  if (!fs.existsSync(whPath)) return { rows: [], stats: { skipped: 'no_file' } };

  const payload = JSON.parse(fs.readFileSync(whPath, 'utf8'));
  const series = payload.data || payload.series || [];
  const out = [];
  let scanned = 0;
  let skippedExisting = 0;
  let skippedSmall = 0;

  for (const row of series) {
    const date = String(row.date).slice(0, 10);
    if (date < minDate) continue;
    scanned += 1;
    if (hasWarehouseRowOnDate(existingRows, date, id)) {
      skippedExisting += 1;
      continue;
    }
    const chg5d = getWarehouseReceiptChg5dAtDate(id, date);
    if (chg5d == null || Math.abs(chg5d) < chgThreshold) {
      skippedSmall += 1;
      continue;
    }
    const supplyUp = chg5d > 0;
    out.push({
      date,
      title: `${label}上期所注册仓单5'{supplyUp ? '增加' : '减少'}${Math.abs(chg5d).toFixed(2)}%`,
      commodity_tags: id,
      direction: supplyUp ? 'bearish' : 'bullish',
      stars: Math.abs(chg5d) >= 5 ? '4' : '3',
      source_tier: 'commodity',
      event_id: `${id}_wh_${supplyUp ? 'supply_up' : 'supply_down'}_${date.replace(/-/g, '')}`,
      notes: `仓单5日变'{chg5d.toFixed(4)}%；来'warehouse-receipts/${id}-daily.json；自动生成`,
      _expansionSource: 'warehouse-receipts',
    });
  }

  return {
    rows: out,
    stats: { scanned, added: out.length, skippedExisting, skippedSmall, chgThreshold },
  };
}

function buildAgBasisMissWarehouseRows(existingRows, auditCsvPath) {
  if (!fs.existsSync(auditCsvPath)) {
    return { rows: [], stats: { skipped: 'no_audit_file' } };
  }
  const text = fs.readFileSync(auditCsvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const out = [];
  let skippedExisting = 0;
  let skippedNoWh = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    const date = cols[idx.date]?.trim();
    const modes = cols[idx.failure_mode]?.trim() || '';
    const whChg = parseFloat(cols[idx.warehouseReceipt_chg_5d]);
    if (!date || !modes.includes('warehouse_supply_up')) continue;
    if (hasWarehouseRowOnDate(existingRows, date, 'ag')) {
      skippedExisting += 1;
      continue;
    }
    if (!Number.isFinite(whChg) || whChg <= 0) {
      skippedNoWh += 1;
      continue;
    }
    out.push({
      date,
      title: `AG basis miss日：仓单供应上行—${whChg.toFixed(2)}%）`,
      commodity_tags: 'ag;au',
      direction: 'bearish',
      stars: '4',
      source_tier: 'commodity',
      event_id: `ag_basis_wh_miss_${date.replace(/-/g, '')}`,
      notes: `AG basis OOS miss audit warehouse_supply_up；chg_5d=${whChg}`,
      _expansionSource: 'ag-basis-miss-audit',
    });
  }

  return {
    rows: out,
    stats: { added: out.length, skippedExisting, skippedNoWh },
  };
}

function mergeExpansionRows(baseRows, incomingRows) {
  const map = new Map();
  for (const row of baseRows) {
    map.set(`${row.date}|${row.title}`, row);
  }
  let added = 0;
  let skipped = 0;
  for (const raw of incomingRows) {
    const { _expansionSource, _flashId, ...row } = raw;
    const key = `${row.date}|${row.title}`;
    if (map.has(key)) {
      skipped += 1;
    } else {
      map.set(key, row);
      added += 1;
    }
  }
  const rows = [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
  );
  return { rows, added, skipped };
}

module.exports = {
  computeNewsStats,
  inferSourceTierFromText,
  inferDirectionFromText,
  enrichFlashText,
  isRelevantFlashCandidate,
  flashCandidateToExpansionRow,
  buildWarehouseSupplyRows,
  buildAgBasisMissWarehouseRows,
  mergeExpansionRows,
  hasWarehouseRowOnDate,
  WAREHOUSE_TITLE_RE,
};
