/**
 * 每日数据增量同步 — CLI 入口
 *
 * 用法:
 *   FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js
 *   FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js --dry-run
 *   FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js --force
 *   FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js --inventory
 *   FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js --types trading_klines,warehouse,cnh
 *   FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js --id au,cu --types trading_klines,trading_json
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { buildInventory, runDailyDataSync, DEFAULT_TYPES } = require('../services/daily-data-sync');

function parseArgs() {
  const args = process.argv.slice(2);
  const typesIdx = args.indexOf('--types');
  const idIdx = args.indexOf('--id');
  return {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    inventory: args.includes('--inventory'),
    types:
      typesIdx >= 0 && args[typesIdx + 1]
        ? args[typesIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
        : null,
    instrumentIds:
      idIdx >= 0 && args[idIdx + 1]
        ? args[idIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
        : null,
  };
}

async function main() {
  const opts = parseArgs();

  if (opts.inventory) {
    console.log(JSON.stringify(buildInventory(), null, 2));
    return;
  }

  const summary = await runDailyDataSync({
    dryRun: opts.dryRun,
    force: opts.force,
    types: opts.types,
    instrumentIds: opts.instrumentIds,
    trigger: 'cli',
  });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.skipped) process.exitCode = 0;
  else if (!summary.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
