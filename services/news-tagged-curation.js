/**
 * Curated news filter 'training-only subset of news-tagged.csv
 * Excludes noisy auto warehouse spikes and low-signal flash; keeps policy/geo/manual.
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { WAREHOUSE_TITLE_RE } = require('./news-tag-expansion');

const AUTO_WH_EVENT_RE = /_(wh)_(supply_up|supply_down)_/i;
const AG_BASIS_MISS_RE = /^ag_basis_wh_miss_/;

function getCuratedNewsTaggedPath() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'history', 'news-tagged-curated.csv');
}

function parseWarehouseChgPctFromNotes(notes) {
  const m = String(notes || '').match(/仓单5日变([+-]?[\d.]+)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? Math.abs(v) : null;
}

function isAutoWarehouseRow(row) {
  const blob = `${row.event_id || ''}|${row.notes || ''}|${row.title || ''}`;
  if (AG_BASIS_MISS_RE.test(row.event_id || '')) return false;
  if (AUTO_WH_EVENT_RE.test(row.event_id || '')) return true;
  if (/warehouse-receipts\/(au|ag)-daily\.json/.test(blob)) return true;
  if (WAREHOUSE_TITLE_RE.test(blob) && /自动生成/.test(blob)) return true;
  return false;
}

function isAgBasisMissRow(row) {
  return AG_BASIS_MISS_RE.test(row.event_id || '');
}

function isEventCalendarRow(row) {
  return /event-calendar/.test(String(row.notes || '')) || /'event-calendar/.test(String(row.notes || ''));
}

function isLowSignalFlash(row) {
  if (String(row.source_tier || '').toLowerCase() !== 'flash') return false;
  const hasTags = !!(row.commodity_tags || '').trim();
  const stars = parseInt(row.stars, 10) || 3;
  const text = `${row.title || ''} ${row.notes || ''}`;
  const commodityHint =
    hasTags ||
    /金|银|铜|油|原油|OPEC|Fed|制裁|期货|commodity|gold|silver|tariff|warehouse|仓单|地缘|央行|发改/i.test(text);
  if (!commodityHint && row.direction === 'neutral' && stars <= 2) return true;
  if (!commodityHint && !hasTags) return true;
  return false;
}

function shouldKeepForCurated(row, options = {}) {
  const {
    excludeAllAutoWarehouse = true,
    warehouseMinAbsChgPct = 5,
    excludeLowSignalFlash = true,
    minDate = '2019-01-01',
  } = options;

  if (row.date && row.date < minDate) return true;

  if (isAgBasisMissRow(row)) return true;
  if (isEventCalendarRow(row)) return true;

  if (isAutoWarehouseRow(row)) {
    if (excludeAllAutoWarehouse) return false;
    const chg = parseWarehouseChgPctFromNotes(row.notes);
    if (chg == null) return false;
    return chg >= warehouseMinAbsChgPct;
  }

  if (excludeLowSignalFlash && isLowSignalFlash(row)) return false;

  return true;
}

function buildCuratedRows(allRows, options = {}) {
  const kept = [];
  const excluded = [];
  const reasons = {
    autoWarehouse: 0,
    lowSignalFlash: 0,
    other: 0,
  };

  for (const row of allRows) {
    if (shouldKeepForCurated(row, options)) {
      kept.push(row);
      continue;
    }
    excluded.push(row);
    if (isAutoWarehouseRow(row)) reasons.autoWarehouse += 1;
    else if (isLowSignalFlash(row)) reasons.lowSignalFlash += 1;
    else reasons.other += 1;
  }

  const minDate = options.minDate || '2019-01-01';
  const full2019 = allRows.filter((r) => r.date >= minDate);
  const kept2019 = kept.filter((r) => r.date >= minDate);

  return {
    kept,
    excluded,
    stats: {
      fullTotal: allRows.length,
      full2019Plus: full2019.length,
      curatedTotal: kept.length,
      curated2019Plus: kept2019.length,
      excludedTotal: excluded.length,
      excluded2019Plus: full2019.length - kept2019.length,
      exclusionReasons: reasons,
      keepPct2019: full2019.length ? +((kept2019.length / full2019.length) * 100).toFixed(1) : null,
    },
  };
}

function writeCuratedCsv(rows, outPath) {
  const { rowsToCsv } = require('./news-tagged-loader');
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rowsToCsv(sorted), 'utf8');
  return { path: outPath, count: sorted.length };
}

module.exports = {
  getCuratedNewsTaggedPath,
  isAutoWarehouseRow,
  isAgBasisMissRow,
  isLowSignalFlash,
  shouldKeepForCurated,
  buildCuratedRows,
  writeCuratedCsv,
  parseWarehouseChgPctFromNotes,
};
