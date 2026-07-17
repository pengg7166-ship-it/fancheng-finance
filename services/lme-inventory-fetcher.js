/**
 * LME/SHFE/COMEX 金属库存周频 'P0 有色基本'
 * 落盘: {dataDir}/history/inventory/{metal}-weekly.json
 * 消费: commodity-outlook-backtest flatRow.lmeInventory
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { fetchText } = require('./http-client');

const DEFAULT_START = '2019-01-01';
const OUT_SUBDIR = 'history/inventory';
const METALS = ['copper', 'aluminum', 'zinc', 'nickel', 'lead', 'tin'];

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/csv,application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
};

const MANUAL_FALLBACK_URLS = {
  westmetall: 'https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Cu_cash',
  macromicro:
    'https://en.macromicro.me/series/190/lme-copper-inventories（需 MM Business 订阅 CSV 导出',
  datatrack: 'https://datatrack.trendforce.com.tw/Graph/Index/2/1/1（LME 铜库存日频图表）',
  investing: 'https://www.investing.com/commodities/copper-stocks-historical-data',
  lmeOfficial: 'https://www.lme.com/en/Market-Data/Reports-and-data/Warehouse-and-stock-reports',
  userImport: 'F:\\FanchengFinance\\data\\history\\user-lme-copper.csv',
};

const _rowCache = new Map();

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function outPath(metal) {
  return path.join(getHistoryDir(), 'inventory', `${String(metal).toLowerCase()}-weekly.json`);
}

function isBlockedHtml(text) {
  const t = String(text || '');
  return (
    t.startsWith('%PDF')
    || t.includes('<html')
    && (t.includes('Just a moment') || t.includes('Cloudflare') || t.includes('403 Forbidden'))
  );
}

function parseGenericSeries(text, metal, sourceLabel) {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!t || isBlockedHtml(t)) return [];

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const json = JSON.parse(t);
      const arr = Array.isArray(json) ? json : json.data || json.series || json.rows || [];
      return arr
        .map((row) => {
          const week_ending = normDate(row.week_ending || row.date || row.report_date || row.time);
          const inventory_tonnes = Number(
            row.inventory_tonnes ?? row.inventory ?? row.value ?? row.stock ?? row.close
          );
          if (!week_ending || Number.isNaN(inventory_tonnes)) return null;
          return {
            week_ending,
            metal,
            inventory_tonnes,
            change_wow:
              row.change_wow != null
                ? Number(row.change_wow)
                : row.change != null
                  ? Number(row.change)
                  : null,
            source: row.source || sourceLabel,
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  const lines = t.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const dateIdx = header.findIndex((h) => h.includes('date') || h.includes('week') || h === 'time');
  const valIdx = header.findIndex(
    (h) => h.includes('inventory') || h.includes('tonnes') || h.includes('stock') || h.includes('value') || h.includes('close')
  );
  const chgIdx = header.findIndex((h) => h.includes('change') || h.includes('wow'));
  if (dateIdx < 0 || valIdx < 0) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(delim);
    const week_ending = normDate(parts[dateIdx]);
    const inventory_tonnes = parseFloat(String(parts[valIdx] || '').replace(/,/g, ''));
    if (!week_ending || Number.isNaN(inventory_tonnes)) continue;
    const changeRaw = chgIdx >= 0 ? parseFloat(String(parts[chgIdx] || '').replace(/,/g, '')) : null;
    rows.push({
      week_ending,
      metal,
      inventory_tonnes,
      change_wow: changeRaw != null && !Number.isNaN(changeRaw) ? changeRaw : null,
      source: sourceLabel,
    });
  }
  return rows;
}

function enrichChangeWow(rows) {
  const sorted = [...rows].sort((a, b) => a.week_ending.localeCompare(b.week_ending));
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].change_wow == null && i > 0) {
      sorted[i].change_wow = +(sorted[i].inventory_tonnes - sorted[i - 1].inventory_tonnes).toFixed(2);
    }
  }
  return sorted.filter((r) => r.week_ending >= DEFAULT_START);
}

async function tryMacroMicroCopper(metal) {
  if (metal !== 'copper') throw new Error('MacroMicro 仅覆盖 copper');
  const urls = [
    'https://en.macromicro.me/series/190/lme-copper-inventories/download',
    'https://en.macromicro.me/charts/data/190',
    'https://www.macromicro.me/charts/data/190',
  ];
  let lastErr = 'unknown';
  for (const url of urls) {
    try {
      const text = await fetchText(url, {
        headers: { ...BROWSER_HEADERS, Referer: 'https://en.macromicro.me/' },
        timeout: 45000,
        retries: 1,
      });
      if (isBlockedHtml(text)) {
        lastErr = 'Cloudflare 403';
        continue;
      }
      const rows = enrichChangeWow(parseGenericSeries(text, metal, 'LME'));
      if (rows.length >= 20) {
        return { source: 'macromicro', label: 'MacroMicro LME 铜库', manualUrl: urls[0], rows };
      }
      lastErr = `解析不足 (${rows.length})`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  throw new Error(lastErr);
}

async function tryDataTrackCopper(metal) {
  if (metal !== 'copper') throw new Error('DataTrack 仅覆盖 copper');
  const urls = [
    'https://datatrack.trendforce.com.tw/Graph/Data/2/1/1',
    'https://datatrack.trendforce.com.tw/Graph/GetData/2/1/1',
    'https://datatrack.trendforce.com.tw/api/graph/data?graphId=2&seriesId=1&rangeId=1',
  ];
  let lastErr = 'unknown';
  for (const url of urls) {
    try {
      const text = await fetchText(url, {
        headers: { ...BROWSER_HEADERS, Referer: 'https://datatrack.trendforce.com.tw/' },
        timeout: 30000,
        retries: 1,
      });
      const rows = enrichChangeWow(parseGenericSeries(text, metal, 'LME'));
      if (rows.length >= 20) {
        return { source: 'datatrack', label: 'DataTrack LME 铜库', manualUrl: MANUAL_FALLBACK_URLS.datatrack, rows };
      }
      lastErr = text.includes('"message"') ? 'API 404/' : `解析不足 (${rows.length})`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  throw new Error(lastErr);
}

async function tryInvestingCopper(metal) {
  if (metal !== 'copper') throw new Error('Investing.com 仅覆盖 copper');
  const url = 'https://www.investing.com/commodities/copper-stocks-historical-data';
  const text = await fetchText(url, {
    headers: { ...BROWSER_HEADERS, Referer: 'https://www.investing.com/' },
    timeout: 30000,
    retries: 1,
  });
  if (isBlockedHtml(text)) throw new Error('Cloudflare 403');
  const rows = enrichChangeWow(parseGenericSeries(text, metal, 'LME'));
  if (rows.length < 20) throw new Error(`HTML 解析不足 (${rows.length})`);
  return { source: 'investing.com', label: 'Investing.com LME 铜库', manualUrl: url, rows };
}

async function tryLmeOfficial(metal) {
  const urls =
    metal === 'copper'
      ? [
          'https://www.lme.com/-/media/Files/L/Data/Reports/Stock/stocks.csv',
          'https://www.lme.com/api/stocks/copper',
        ]
      : [`https://www.lme.com/api/stocks/${metal}`];
  let lastErr = 'unknown';
  for (const url of urls) {
    try {
      const text = await fetchText(url, {
        headers: BROWSER_HEADERS,
        timeout: 45000,
        retries: 1,
      });
      if (isBlockedHtml(text)) {
        lastErr = 'Cloudflare 403/302';
        continue;
      }
      const rows = enrichChangeWow(parseGenericSeries(text, metal, 'LME'));
      if (rows.length >= 20) {
        return { source: 'lme-official', label: 'LME 官方库存', manualUrl: MANUAL_FALLBACK_URLS.lmeOfficial, rows };
      }
      lastErr = `解析不足 (${rows.length})`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  throw new Error(lastErr);
}

const INV_SOURCE_PRIORITY = {
  'lme-official': 30,
  'shfe-official': 30,
  westmetall: 25,
  'user-import': 20,
  macromicro: 10,
  'investing.com': 10,
  datatrack: 10,
};

async function tryWestmetall(metal) {
  const wm = require('./westmetall-lme-stocks-fetcher');
  const result = await wm.scrapeWestmetallLmeStocks(metal, { startYear: 2019 });
  if (result.status !== 'ok' || !result.rows?.length) {
    throw new Error(result.reason || result.status || 'westmetall empty');
  }
  if (result.rows.length < 20) throw new Error(`westmetall 行数不足 (${result.rows.length})`);
  return {
    source: 'westmetall',
    label: result.label,
    manualUrl: result.manualUrl,
    rows: enrichChangeWow(result.rows),
  };
}

function invSourcePriority(source) {
  return INV_SOURCE_PRIORITY[String(source || '').toLowerCase()] ?? 1;
}

function loadExistingInventoryRows(metal) {
  const fp = outPath(metal);
  if (!fs.existsSync(fp)) return { rows: [], meta: null };
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    return { rows, meta: raw };
  } catch {
    return { rows: [], meta: null };
  }
}

function mergeInventoryRows(existingRows, incomingRows) {
  const byWeek = new Map();
  let added = 0;
  let skippedOverlap = 0;
  let replaced = 0;

  for (const row of existingRows || []) {
    const w = normDate(row.week_ending);
    if (!w) continue;
    byWeek.set(w, { ...row, week_ending: w });
  }

  for (const row of incomingRows || []) {
    const w = normDate(row.week_ending);
    if (!w) continue;
    const existing = byWeek.get(w);
    if (!existing) {
      byWeek.set(w, { ...row, week_ending: w });
      added += 1;
      continue;
    }
    const incPri = invSourcePriority(row.source);
    const existPri = invSourcePriority(existing.source);
    if (incPri > existPri) {
      byWeek.set(w, { ...row, week_ending: w });
      replaced += 1;
    } else {
      skippedOverlap += 1;
    }
  }

  const rows = [...byWeek.values()].sort((a, b) =>
    normDate(a.week_ending).localeCompare(normDate(b.week_ending))
  );
  return { rows: enrichChangeWow(rows), added, replaced, skippedOverlap, rowCount: rows.length };
}

function buildPayload(result, attempts, metal) {
  const data = result.rows || [];
  const updated = new Date().toISOString();
  return {
    metal,
    label: result.label || `${metal} 库存（周频）`,
    freq: 'weekly',
    source: result.source,
    updated,
    fetchedAt: updated,
    startDate: data.length ? data[0].week_ending : null,
    endDate: data.length ? data[data.length - 1].week_ending : null,
    manualUrl: result.manualUrl || null,
    rowCount: data.length,
    data,
    sourceAttempts: attempts,
    manualFallbackUrls: MANUAL_FALLBACK_URLS,
  };
}

async function fetchLmeInventory({ metal = 'copper', importPath, importText } = {}) {
  const m = String(metal || 'copper').toLowerCase();
  const attempts = [];

  if (importPath) {
    const text = fs.readFileSync(importPath, 'utf8');
    const incoming = enrichChangeWow(parseGenericSeries(text, m, 'user-import'));
    if (incoming.length < 1) throw new Error(`import 行数不足 (${incoming.length})`);
    const existing = loadExistingInventoryRows(m);
    const merged = mergeInventoryRows(existing.rows, incoming);
    if (merged.rowCount < 4 && existing.rows.length < 4) {
      throw new Error(`合并后行数不'(${merged.rowCount})`);
    }
    const primarySource =
      existing.meta?.source && invSourcePriority(existing.meta.source) > invSourcePriority('user-import')
        ? `${existing.meta.source}+gap-fill`
        : 'user-import';
    return buildPayload(
      {
        source: primarySource,
        label: '用户导入库存',
        manualUrl: importPath,
        rows: merged.rows,
        mergeStats: {
          existingRows: existing.rows.length,
          incomingRows: incoming.length,
          added: merged.added,
          replaced: merged.replaced,
          skippedOverlap: merged.skippedOverlap,
        },
      },
      [{ source: 'user-import', ok: true, rows: merged.rowCount, merge: merged }],
      m
    );
  }

  if (importText) {
    const incoming = enrichChangeWow(parseGenericSeries(importText, m, 'user-import'));
    if (incoming.length < 1) throw new Error(`import 行数不足 (${incoming.length})`);
    const existing = loadExistingInventoryRows(m);
    const merged = mergeInventoryRows(existing.rows, incoming);
    if (merged.rowCount < 4 && existing.rows.length < 4) {
      throw new Error(`合并后行数不'(${merged.rowCount})`);
    }
    return buildPayload(
      {
        source: existing.meta?.source || 'user-import',
        label: '用户导入库存',
        rows: merged.rows,
        mergeStats: merged,
      },
      [{ source: 'user-import', ok: true, rows: merged.rowCount }],
      m
    );
  }

  const tryOrder = [
    ['westmetall', () => tryWestmetall(m)],
    ['macromicro', () => tryMacroMicroCopper(m)],
    ['datatrack', () => tryDataTrackCopper(m)],
    ['investing.com', () => tryInvestingCopper(m)],
    ['lme-official', () => tryLmeOfficial(m)],
  ];

  for (const [name, fn] of tryOrder) {
    try {
      const result = await fn();
      attempts.push({ source: name, ok: true, rows: result.rows.length });
      const existing = loadExistingInventoryRows(m);
      const merged = mergeInventoryRows(existing.rows, result.rows);
      return buildPayload(
        {
          ...result,
          rows: merged.rows,
          source: result.source || name,
        },
        attempts,
        m
      );
    } catch (err) {
      attempts.push({ source: name, ok: false, error: err.message });
    }
  }

  const existing = loadExistingInventoryRows(m);
  if (existing.rows.length >= 4) {
    attempts.push({ source: 'disk-cache', ok: true, rows: existing.rows.length });
    return buildPayload(
      {
        source: existing.meta?.source || 'disk-cache',
        label: `${m} 库存（磁盘存量，外源暂不可达）`,
        rows: enrichChangeWow(existing.rows),
        manualUrl: MANUAL_FALLBACK_URLS.westmetall,
      },
      attempts,
      m
    );
  }

  const err = new Error(`${m} 库存全源失败`);
  err.attempts = attempts;
  err.manualFallbackUrls = MANUAL_FALLBACK_URLS;
  throw err;
}

async function saveLmeInventory(options = {}) {
  const payload = await fetchLmeInventory(options);
  const fp = outPath(payload.metal);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return { payload, jsonPath: fp };
}

function loadInventoryRows(metal) {
  const m = String(metal).toLowerCase();
  if (_rowCache.has(m)) return _rowCache.get(m);

  const fp = outPath(m);
  if (!fs.existsSync(fp)) {
    _rowCache.set(m, null);
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    _rowCache.set(m, rows);
    return rows;
  } catch {
    _rowCache.set(m, null);
    return null;
  }
}

function metalForInstrument(instrumentId) {
  const map = {
    cu: 'copper',
    al: 'aluminum',
    zn: 'zinc',
    ni: 'nickel',
    pb: 'lead',
    sn: 'tin',
  };
  return map[String(instrumentId).toLowerCase()] || null;
}

function getInventoryAtDate(metalOrInstrument, barDate) {
  const metal = METALS.includes(String(metalOrInstrument).toLowerCase())
    ? String(metalOrInstrument).toLowerCase()
    : metalForInstrument(metalOrInstrument);
  if (!metal) return null;

  const rows = loadInventoryRows(metal);
  if (!rows?.length) return null;

  const d = normDate(barDate);
  let row = rows.find((r) => normDate(r.week_ending) === d);
  if (!row) {
    const prior = rows.filter((r) => normDate(r.week_ending) <= d);
    row = prior.length ? prior[prior.length - 1] : null;
  }
  if (!row) return null;

  return {
    weekEnding: normDate(row.week_ending),
    metal,
    inventoryTonnes: row.inventory_tonnes != null ? Number(row.inventory_tonnes) : null,
    changeWow: row.change_wow != null ? Number(row.change_wow) : null,
    source: row.source || 'LME',
    exchange: row.source || 'LME',
  };
}

/** WoW inventory pct change (×100), same scale as warehouseReceipt_chg_5d / gldHoldings_chg_5d */
function getInventoryChgWowAtDate(metalOrInstrument, barDate) {
  const slot = getInventoryAtDate(metalOrInstrument, barDate);
  if (!slot || slot.changeWow == null || slot.inventoryTonnes == null) return null;
  const prior = Number(slot.inventoryTonnes) - Number(slot.changeWow);
  const denom = Math.max(Math.abs(prior), 1);
  return +((Number(slot.changeWow) / denom) * 100).toFixed(4);
}

module.exports = {
  DEFAULT_START,
  OUT_SUBDIR,
  METALS,
  MANUAL_FALLBACK_URLS,
  INV_SOURCE_PRIORITY,
  parseGenericSeries,
  enrichChangeWow,
  mergeInventoryRows,
  fetchLmeInventory,
  saveLmeInventory,
  loadInventoryRows,
  getInventoryAtDate,
  getInventoryChgWowAtDate,
  metalForInstrument,
  outPath,
};
