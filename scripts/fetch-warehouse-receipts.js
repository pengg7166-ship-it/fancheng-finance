/**
 * P0 注册仓单 — 上期所官方抓取 + 手动 CSV 导入
 * 目标: E:\FanchengFinance\data\history\warehouse-receipts\{id}-daily.json
 *
 * 用法:
 *   FANCHENG_DATA_DRIVE=E node scripts/fetch-warehouse-receipts.js --scrape
 *   FANCHENG_DATA_DRIVE=E node scripts/fetch-warehouse-receipts.js --scrape --id cu,al,au,ag --force
 *   FANCHENG_DATA_DRIVE=E node scripts/fetch-warehouse-receipts.js --scrape --dry-run --id au --start 2024-01-01 --end 2024-12-31
 *   node scripts/fetch-warehouse-receipts.js --import E:\FanchengFinance\data\history\user-cu-warehouse.csv --id cu
 *
 * CSV 模板（首行表头）:
 *   date,warehouse_receipt,change_dod,exchange
 *   2025-01-02,12345,-120,SHFE
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const {
  scrapeWarehouseReceipts,
  saveWarehouseFile,
  mergeWarehouseRows,
  loadExistingRows,
  P0_INSTRUMENTS,
  OUT_SUBDIR,
} = require('../services/shfe-warehouse-fetcher');

const TARGET_SUBDIR = `history/${OUT_SUBDIR}`;
const DEFAULT_START = '2019-01-01';

function normDate(d) {
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return String(d || '').slice(0, 10);
}

function parseImportCsv(text, instrumentId) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => h.includes('date'));
  const start = hasHeader ? 1 : 0;
  const dateIdx = hasHeader ? header.findIndex((h) => h.includes('date')) : 0;
  const wrIdx = hasHeader
    ? header.findIndex((h) => h.includes('warehouse') || h.includes('receipt') || h.includes('仓单'))
    : 1;
  const chgIdx = hasHeader ? header.findIndex((h) => h.includes('change') || h.includes('变化')) : 2;
  const exIdx = hasHeader ? header.findIndex((h) => h.includes('exchange') || h.includes('交易所')) : 3;

  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const parts = lines[i].split(delim);
    const date = normDate(parts[dateIdx]);
    const warehouse_receipt = parseFloat(String(parts[wrIdx >= 0 ? wrIdx : 1] || '').replace(/,/g, ''));
    if (!date || Number.isNaN(warehouse_receipt)) continue;
    const change_dod = chgIdx >= 0 ? parseFloat(String(parts[chgIdx] || '').replace(/,/g, '')) : null;
    const exchange = exIdx >= 0 ? String(parts[exIdx] || '').trim() : '';
    rows.push({
      date,
      instrument_id: instrumentId,
      warehouse_receipt,
      change_dod: Number.isNaN(change_dod) ? null : change_dod,
      exchange: exchange || null,
      source: 'user-import',
    });
  }
  return rows.filter((r) => r.date >= DEFAULT_START).sort((a, b) => a.date.localeCompare(b.date));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const impIdx = args.indexOf('--import');
  const idIdx = args.indexOf('--id');
  const startIdx = args.indexOf('--start');
  const endIdx = args.indexOf('--end');
  const rateIdx = args.indexOf('--rate-ms');
  return {
    importPath: impIdx >= 0 ? args[impIdx + 1] : null,
    instrumentId: (idIdx >= 0 ? args[idIdx + 1] : 'cu').toLowerCase(),
    instruments:
      idIdx >= 0 && args[idIdx + 1]
        ? args[idIdx + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
        : P0_INSTRUMENTS,
    scrape: args.includes('--scrape'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    startDate: startIdx >= 0 ? normDate(args[startIdx + 1]) : DEFAULT_START,
    endDate: endIdx >= 0 ? normDate(args[endIdx + 1]) : normDate(new Date()),
    rateMs: rateIdx >= 0 ? Math.max(200, parseInt(args[rateIdx + 1], 10) || 450) : 450,
  };
}

async function fetchWarehouseReceipts(options = {}) {
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或 E 盘不可写');

  const outDir = path.join(dataDir, TARGET_SUBDIR);
  fs.mkdirSync(outDir, { recursive: true });

  if (options.importPath) {
    const id = String(options.instrumentId || 'cu').toLowerCase();
    const text = fs.readFileSync(options.importPath, 'utf8');
    const incoming = parseImportCsv(text, id);
    if (incoming.length < 1) throw new Error(`import 行数不足 (${incoming.length})`);
    const existing = loadExistingRows(id);
    const merged = mergeWarehouseRows(existing.rows, incoming);
    if (merged.rowCount < 5) throw new Error(`合并后行数不足 (${merged.rowCount})`);
    const outFile = saveWarehouseFile(id, merged.rows, {
      source: existing.meta?.source === 'shfe-official' ? 'shfe-official+gap-fill' : 'merged',
      importPath: options.importPath,
      mergeStats: {
        existingRows: existing.rows.length,
        incomingRows: incoming.length,
        added: merged.added,
        replaced: merged.replaced,
        skippedOverlap: merged.skippedOverlap,
        sourceCounts: merged.sourceCounts,
      },
    });
    return {
      status: 'imported',
      outFile,
      rowCount: merged.rowCount,
      instrumentId: id,
      mergeStats: {
        existingRows: existing.rows.length,
        incomingRows: incoming.length,
        added: merged.added,
        replaced: merged.replaced,
        skippedOverlap: merged.skippedOverlap,
        sourceCounts: merged.sourceCounts,
      },
    };
  }

  if (options.scrape) {
    const scraped = await scrapeWarehouseReceipts({
      instruments: options.instruments,
      startDate: options.startDate,
      endDate: options.endDate,
      force: options.force,
      rateMs: options.rateMs,
      dryRun: options.dryRun,
    });

    if (scraped.dryRun) {
      return {
        status: 'dry-run',
        dataDir,
        outDir,
        force: options.force,
        startDate: options.startDate,
        endDate: options.endDate,
        tradingDays: scraped.tradingDays,
        calendars: scraped.calendars,
        calendarDayCounts: scraped.calendarDayCounts,
        gaps: scraped.gaps,
        results: scraped.results,
      };
    }

    return {
      status: 'scraped',
      dataDir,
      outDir,
      force: options.force,
      startDate: options.startDate,
      endDate: options.endDate,
      rateMs: options.rateMs,
      tradingDays: scraped.tradingDays,
      dayFetches: scraped.dayFetches,
      dayMisses: scraped.dayMisses,
      results: scraped.results,
      landed: scraped.results
        .filter((r) => r.status === 'ok')
        .map((r) => ({
          id: r.instrumentId,
          rows: r.rowCount,
          file: r.file,
          range: `${r.startDate} → ${r.endDate}`,
        })),
    };
  }

  return {
    status: 'stub',
    message: '请使用 --scrape 从上期所官方抓取，或 --import 导入 CSV',
    outDir,
    templatePath: path.join(dataDir, 'history', 'templates', 'warehouse-receipts-template.csv'),
    schema: {
      date: 'YYYY-MM-DD',
      warehouse_receipt: '注册仓单量（手或吨，需统一）',
      change_dod: '日变化',
      exchange: 'SHFE|DCE|CZCE',
    },
    force: Boolean(options.force),
  };
}

if (require.main === module) {
  const opts = parseArgs();
  fetchWarehouseReceipts(opts)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
      process.exit(1);
    });
}

module.exports = { fetchWarehouseReceipts, TARGET_SUBDIR, parseImportCsv };
