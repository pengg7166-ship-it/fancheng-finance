/**
 * P0 LME / SHFE 库存 — 自动抓取 + 手动 CSV 导入（周频 → 日频前填由 loader 负责）
 * 目标: E:\FanchengFinance\data\history\inventory\{metal}-weekly.json
 *
 * 用法:
 *   FANCHENG_DATA_DRIVE=E node scripts/fetch-lme-shfe-inventory.js
 *   FANCHENG_DATA_DRIVE=E node scripts/fetch-lme-shfe-inventory.js --metal copper
 *   node scripts/fetch-lme-shfe-inventory.js --import E:\FanchengFinance\data\history\user-lme-copper.csv --metal copper
 *
 * CSV 模板（首行表头）:
 *   week_ending,inventory_tonnes,change_wow,source
 *   2025-01-03,123456,-2340,LME
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const {
  saveLmeInventory,
  METALS,
  MANUAL_FALLBACK_URLS,
  enrichChangeWow,
  parseGenericSeries,
  DEFAULT_START,
} = require('../services/lme-inventory-fetcher');

const TARGET_SUBDIR = 'history/inventory';

function parseImportCsv(text, metal) {
  return enrichChangeWow(parseGenericSeries(text, metal, 'user-import'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const impIdx = args.indexOf('--import');
  const metalIdx = args.indexOf('--metal');
  return {
    importPath: impIdx >= 0 ? args[impIdx + 1] : null,
    metal: (metalIdx >= 0 ? args[metalIdx + 1] : 'copper').toLowerCase(),
    force: args.includes('--force'),
  };
}

async function fetchLmeShfeInventory(options = {}) {
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或 E 盘不可写');

  const outDir = path.join(dataDir, TARGET_SUBDIR);
  fs.mkdirSync(outDir, { recursive: true });
  const metal = String(options.metal || 'copper').toLowerCase();

  if (options.importPath) {
    const { payload, jsonPath } = await saveLmeInventory({
      metal,
      importPath: options.importPath,
    });
    return {
      status: 'imported',
      ok: true,
      outFile: jsonPath,
      rowCount: payload.rowCount,
      metal,
      source: payload.source,
      startDate: payload.startDate,
      endDate: payload.endDate,
    };
  }

  try {
    const { payload, jsonPath } = await saveLmeInventory({ metal });
    return {
      status: 'fetched',
      ok: true,
      outFile: jsonPath,
      rowCount: payload.rowCount,
      metal,
      source: payload.source,
      startDate: payload.startDate,
      endDate: payload.endDate,
      attempts: payload.sourceAttempts,
    };
  } catch (err) {
    return {
      status: 'failed',
      ok: false,
      metal,
      outDir,
      outFile: path.join(outDir, `${metal}-weekly.json`),
      error: err.message,
      attempts: err.attempts || [],
      manualFallbackUrls: err.manualFallbackUrls || MANUAL_FALLBACK_URLS,
      templatePath: path.join(dataDir, 'history', 'templates', 'lme-inventory-template.csv'),
      schema: {
        week_ending: 'YYYY-MM-DD',
        inventory_tonnes: '库存吨数',
        change_wow: '周变化',
        source: 'LME|SHFE|COMEX',
      },
    };
  }
}

if (require.main === module) {
  const opts = parseArgs();
  fetchLmeShfeInventory(opts)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
      process.exit(1);
    });
}

module.exports = { fetchLmeShfeInventory, TARGET_SUBDIR, METALS, DEFAULT_START, parseImportCsv };
