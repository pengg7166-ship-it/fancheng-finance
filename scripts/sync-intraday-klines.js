/**
 * 同步量化 P0 品种（au/ag/rb/cu）小时 + 15m + 5m K 线至 E:\FanchengFinance\data\klines
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/sync-intraday-klines.js
 *   ... --force --id au --id ag
 *   ... --all          # 全 outlook 品种（与自动调度一致）
 *   ... --dry-run
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const { syncIntradayKlines, INTRADAY_P0, getOutlookIntradayInstrumentIds } = require('../services/daily-data-sync');

function parseArgs() {
  const args = process.argv.slice(2);
  const ids = [];
  let dryRun = false;
  let force = false;
  let allOutlook = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--force') force = true;
    else if (args[i] === '--all') allOutlook = true;
    else if (args[i] === '--id' && args[i + 1]) {
      ids.push(String(args[++i]).toLowerCase());
    }
  }
  return {
    dryRun,
    force,
    allOutlook,
    instrumentIds: ids.length ? ids : allOutlook ? getOutlookIntradayInstrumentIds() : null,
  };
}

async function main() {
  const opts = parseArgs();
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或数据盘不可写');
  diskCache.init(getUserDataDir() || dataDir);

  console.log(`=== Intraday K-line sync → ${dataDir} ===`);
  console.log('P0:', (opts.instrumentIds || (opts.allOutlook ? getOutlookIntradayInstrumentIds() : INTRADAY_P0)).join(', '));
  console.log('dryRun:', opts.dryRun, 'force:', opts.force);

  const result = await syncIntradayKlines({
    dryRun: opts.dryRun,
    force: opts.force,
    instrumentIds: opts.instrumentIds,
    allOutlook: opts.allOutlook,
  });

  for (const row of result.results || []) {
    console.log(
      `${row.id} ${row.tf}: ${row.status}` +
        (row.bars != null ? ` bars=${row.bars}` : '') +
        (row.endDate ? ` end=${row.endDate}` : '') +
        (row.error ? ` err=${row.error}` : '')
    );
  }

  console.log(`\nDone: fetched=${result.fetched} skipped=${result.skipped} failed=${result.failed}`);
  if (result.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
