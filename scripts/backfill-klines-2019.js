/**
 * 一次性回填 2019-01-01 起的日线 K 线缓存（74 品种）
 * 用法: node scripts/backfill-klines-2019.js [--force] [--limit N]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { fetchCommodityHistory } = require('../services/commodities-history-fetcher');

const MIN_START = '2019-01-01';
const MIN_BARS = 60;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force'),
    limit: (() => {
      const i = args.indexOf('--limit');
      return i >= 0 ? parseInt(args[i + 1], 10) || 999 : 999;
    })(),
  };
}

function readBars(instrumentId) {
  const key = `klines/commodity-${String(instrumentId).toLowerCase()}-day.json`;
  const cached = diskCache.readStale(key);
  return cached?.data?.klines || [];
}

function needsBackfill(bars) {
  if (bars.length < MIN_BARS) return true;
  const first = String(bars[0]?.date || '').slice(0, 10);
  return first > MIN_START;
}

async function main() {
  const userData = getUserDataDir() || path.join(process.cwd(), 'userData');
  diskCache.init(userData);
  const { force, limit } = parseArgs();
  const dataDir = getDataDir();
  console.log(`[backfill-klines-2019] data dir: ${dataDir || '(local cache)'}`);
  console.log(`[backfill-klines-2019] instruments: ${INSTRUMENT_REGISTRY.length}, force=${force}, limit=${limit}`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const spec of INSTRUMENT_REGISTRY.slice(0, limit)) {
    const bars = readBars(spec.id);
    if (!force && !needsBackfill(bars)) {
      skipped += 1;
      console.log(`  skip ${spec.id} (${bars.length} bars, from ${bars[0]?.date})`);
      continue;
    }

    try {
      const data = await fetchCommodityHistory(spec.id, 'day', { force: true });
      const klines = data.klines || [];
      const first = klines[0]?.date;
      const last = klines[klines.length - 1]?.date;
      console.log(`  ok ${spec.id}: ${klines.length} bars ${first} → ${last} (${data.source})`);
      fetched += 1;
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      failed += 1;
      console.error(`  fail ${spec.id}: ${err.message}`);
    }
  }

  console.log(`[backfill-klines-2019] done fetched=${fetched} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
