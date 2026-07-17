/**
 * 板块显性库存 / 开工等周频序列
 * 路径: {dataDir}/history/sector-fundamentals/{sector}-{metric}-weekly.json
 * 仅读真实 CSV/JSON；无数据返回 null（UI 暂无）。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const LOADER_VERSION = 'v1.56.19-sector-fundamentals';
const SUBDIR = 'sector-fundamentals';

/** 品种 → 显性库存映射（有仓单之外的社会/港口/交易所库存；社会缺则用交易所代理） */
const VISIBLE_INVENTORY_MAP = {
  i: { sector: 'black', metric: 'iron_port_inventory', unit: '万吨', label: '铁矿港口库存' },
  rb: { sector: 'black', metric: 'iron_port_inventory', unit: '万吨', label: '铁矿港口库存(相关)' },
  jm: { sector: 'black', metric: 'coking_coal_port_inventory', unit: '万吨', label: '焦煤港口库存' },
  cu: [
    { sector: 'metals', metric: 'copper_social_inventory', unit: '万吨', label: '铜社会库存' },
    {
      sector: 'metals',
      metric: 'copper_exchange_inventory',
      unit: '吨',
      label: '铜交易所库存(非社会)',
    },
  ],
  al: [
    { sector: 'metals', metric: 'aluminium_social_inventory', unit: '万吨', label: '铝社会库存' },
    {
      sector: 'metals',
      metric: 'aluminium_exchange_inventory',
      unit: '吨',
      label: '铝交易所库存(非社会)',
    },
  ],
  zn: {
    sector: 'metals',
    metric: 'zinc_exchange_inventory',
    unit: '吨',
    label: '锌交易所库存(非社会)',
  },
  ni: {
    sector: 'metals',
    metric: 'nickel_exchange_inventory',
    unit: '吨',
    label: '镍交易所库存(非社会)',
  },
  pb: {
    sector: 'metals',
    metric: 'lead_exchange_inventory',
    unit: '吨',
    label: '铅交易所库存(非社会)',
  },
  sn: {
    sector: 'metals',
    metric: 'tin_exchange_inventory',
    unit: '吨',
    label: '锡交易所库存(非社会)',
  },
  hc: {
    sector: 'black',
    metric: 'iron_port_inventory',
    unit: '万吨',
    label: '铁矿港口库存(相关)',
  },
  ao: {
    sector: 'metals',
    metric: 'aluminium_exchange_inventory',
    unit: '吨',
    label: '铝交易所库存(相关氧化铝)',
  },
  au: {
    sector: 'metals',
    metric: 'gold_exchange_inventory',
    unit: '千克',
    label: '黄金交易所库存(非社会)',
  },
  ag: {
    sector: 'metals',
    metric: 'silver_exchange_inventory',
    unit: '千克',
    label: '白银交易所库存(非社会)',
  },
};

function normalizeMapEntry(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  const raw = VISIBLE_INVENTORY_MAP[id];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function outPath(sector, metric) {
  const root = getDataDir();
  if (!root) return null;
  return path.join(root, 'history', SUBDIR, `${sector}-${metric}-weekly.json`);
}

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function loadSeries(sector, metric) {
  const fp = outPath(sector, metric);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || raw.series || [];
    return {
      file: fp,
      sector,
      metric,
      unit: raw.unit || null,
      source: raw.source || null,
      rows: rows
        .map((r) => ({
          date: normDate(r.date || r.weekEnding || r.week_ending),
          value: r.value != null ? Number(r.value) : r.level != null ? Number(r.level) : null,
          changeWow:
            r.change_wow != null ? Number(r.change_wow) : r.changeWow != null ? Number(r.changeWow) : null,
        }))
        .filter((r) => r.date && r.value != null && Number.isFinite(r.value))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  } catch {
    return null;
  }
}

function getVisibleInventoryAtDate(instrumentId, barDate) {
  const id = String(instrumentId || '').toLowerCase();
  const maps = normalizeMapEntry(id);
  if (!maps.length) return null;

  let lastMissing = null;
  for (const map of maps) {
    const series = loadSeries(map.sector, map.metric);
    if (!series?.rows?.length) {
      lastMissing = {
        available: false,
        symbol: id,
        label: map.label,
        sector: map.sector,
        metric: map.metric,
        unit: map.unit,
        reason: 'missing_file',
        dataSource: 'sector-fundamentals',
      };
      continue;
    }
    const d = normDate(barDate) || series.rows[series.rows.length - 1].date;
    let row = series.rows.find((r) => r.date === d);
    if (!row) {
      for (let i = series.rows.length - 1; i >= 0; i -= 1) {
        if (series.rows[i].date <= d) {
          row = series.rows[i];
          break;
        }
      }
    }
    if (!row) row = series.rows[series.rows.length - 1];
    const idx = series.rows.findIndex((r) => r.date === row.date);
    let changeWow = row.changeWow;
    if (changeWow == null && idx > 0) {
      changeWow = Number(row.value) - Number(series.rows[idx - 1].value);
    }
    return {
      available: true,
      symbol: id,
      label: map.label,
      sector: map.sector,
      metric: map.metric,
      unit: map.unit || series.unit,
      date: row.date,
      level: row.value,
      changeWow: changeWow != null && Number.isFinite(changeWow) ? changeWow : null,
      source: series.source || 'user-import',
      dataSource: 'sector-fundamentals',
      method: 'weekly-series',
      isSocial: map.metric.includes('social'),
      isExchangeProxy: map.metric.includes('exchange'),
    };
  }
  return lastMissing;
}

function parseImportCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => h.includes('date') || h.includes('日期'));
  const start = hasHeader ? 1 : 0;
  const dateIdx = hasHeader ? header.findIndex((h) => h.includes('date') || h.includes('日期')) : 0;
  const valIdx = hasHeader
    ? header.findIndex((h) => h.includes('value') || h.includes('level') || h.includes('库存') || h.includes('qty'))
    : 1;
  const chgIdx = hasHeader ? header.findIndex((h) => h.includes('change') || h.includes('增减')) : 2;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const parts = lines[i].split(delim);
    const date = normDate(parts[dateIdx]);
    const value = parseFloat(String(parts[valIdx] || '').replace(/,/g, ''));
    if (!date || !Number.isFinite(value)) continue;
    const changeWow = chgIdx >= 0 ? parseFloat(String(parts[chgIdx] || '').replace(/,/g, '')) : null;
    rows.push({
      date,
      value,
      change_wow: Number.isFinite(changeWow) ? changeWow : null,
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function saveSeries(sector, metric, rows, meta = {}) {
  const fp = outPath(sector, metric);
  if (!fp) throw new Error('dataDir missing');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const sorted = [...rows].sort((a, b) => normDate(a.date).localeCompare(normDate(b.date)));
  const payload = {
    sector,
    metric,
    freq: 'weekly',
    unit: meta.unit || null,
    source: meta.source || 'user-import',
    updated: new Date().toISOString(),
    startDate: sorted[0]?.date || null,
    endDate: sorted[sorted.length - 1]?.date || null,
    rowCount: sorted.length,
    version: LOADER_VERSION,
    data: sorted,
  };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return { file: fp, rowCount: sorted.length, endDate: payload.endDate };
}

function importCsvFile(csvPath, sector, metric, meta = {}) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseImportCsv(text);
  if (!rows.length) throw new Error('CSV 无有效行');
  return saveSeries(sector, metric, rows, meta);
}

module.exports = {
  LOADER_VERSION,
  SUBDIR,
  VISIBLE_INVENTORY_MAP,
  loadSeries,
  getVisibleInventoryAtDate,
  parseImportCsv,
  saveSeries,
  importCsvFile,
  outPath,
};
