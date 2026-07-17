/**
 * 板块基本面（显性库存等）— 可选 CSV 导入（非付费刚需）
 * 目标: {dataDir}/history/sector-fundamentals/{sector}-{metric}-weekly.json
 *
 * 日更已自动：兰格铁矿港口 / 东财铜交易所库存（见 sector_fundamentals sync）。
 * Mysteel / SMM（含 API token）费用高，产品不依赖；仅当你已有自备 CSV 时导入。
 *
 * 用法:
 *   node scripts/fetch-sector-fundamentals.js --import path.csv --sector black --metric iron_port_inventory --unit 万吨 --source user-import
 *   node scripts/fetch-sector-fundamentals.js --sector black
 *
 * CSV: date,value,change_wow
 */
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));

const { getDataDir } = require('../services/data-paths');
const loader = require('../services/sector-fundamentals-loader');

const TARGET_SUBDIR = 'history/sector-fundamentals';

const SECTOR_METRICS = {
  black: ['iron_port_inventory', 'blast_furnace_rate', 'rebar_demand', 'steel_mill_margin', 'coking_coal_port_inventory'],
  metals: ['copper_social_inventory', 'aluminium_social_inventory', 'smelter_margin', 'import_arbitrage'],
  energy: ['crack_spread', 'refinery_rate', 'port_oil_inventory', 'unit_maintenance'],
  agri: ['crush_margin', 'breeding_profit', 'import_arrival', 'stock_draw'],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    sector: get('--sector') || 'all',
    metric: get('--metric'),
    importPath: get('--import'),
    unit: get('--unit') || '万吨',
    source: get('--source') || 'user-import',
    force: args.includes('--force'),
  };
}

async function fetchSectorFundamentals(options = {}) {
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置');
  return {
    status: 'stub',
    message:
      '付费源（Mysteel API / SMM）不做刚需。铁矿港口用兰格自动；铜用东财交易所库存自动。仅当你已有自备 CSV 时用 --import。',
    outDir: path.join(dataDir, TARGET_SUBDIR),
    metrics: SECTOR_METRICS,
    visibleMap: loader.VISIBLE_INVENTORY_MAP,
    force: Boolean(options.force),
  };
}

async function main() {
  const opts = parseArgs();
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置');

  if (opts.importPath) {
    if (!opts.sector || opts.sector === 'all' || !opts.metric) {
      throw new Error('--import 需同时指定 --sector 与 --metric');
    }
    if (!fs.existsSync(opts.importPath)) throw new Error(`文件不存在: ${opts.importPath}`);
    const saved = loader.importCsvFile(opts.importPath, opts.sector, opts.metric, {
      unit: opts.unit,
      source: opts.source,
    });
    console.log(JSON.stringify({ status: 'ok', ...saved }, null, 2));
    return;
  }

  const stub = await fetchSectorFundamentals(opts);
  console.log(
    JSON.stringify(
      {
        ...stub,
        metrics: opts.sector === 'all' ? SECTOR_METRICS : { [opts.sector]: SECTOR_METRICS[opts.sector] || [] },
        schema: { date: 'YYYY-MM-DD', value: '数值', change_wow: '周增减（可选）' },
        example:
          'node scripts/fetch-sector-fundamentals.js --import data/user-iron-port.csv --sector black --metric iron_port_inventory --source user-import',
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { fetchSectorFundamentals, SECTOR_METRICS, TARGET_SUBDIR };
