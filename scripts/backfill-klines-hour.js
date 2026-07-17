/**
 * 一次性回填量化 P0 小时 K 线缓存（默认 au/ag/rb/cu，约 1 年窗口）
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/backfill-klines-hour.js [--force] [--id au,ag,rb]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const { fetchCommodityHistory } = require('../services/commodities-history-fetcher');
const { INTRADAY_P0 } = require('../services/daily-data-sync');

const MIN_BARS = 40;

function parseArgs() {
  const args = process.argv.slice(2);
  const ids = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id' && args[i + 1]) {
      ids.push(
        ...String(args[++i])
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      );
    } else if (args[i].startsWith('--id=')) {
      ids.push(
        ...args[i]
          .slice(5)
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      );
    }
  }
  return {
    force: args.includes('--force'),
    instrumentIds: ids.length ? [...new Set(ids)] : [...INTRADAY_P0],
  };
}

function readBars(instrumentId) {
  const key = `klines/commodity-${String(instrumentId).toLowerCase()}-hour.json`;
  const cached = diskCache.readStale(key);
  return cached?.data?.klines || [];
}

function needsBackfill(bars) {
  return bars.length < MIN_BARS;
}

async function main() {
  const userData = getUserDataDir() || path.join(process.cwd(), 'userData');
  diskCache.init(userData);
  const { force, instrumentIds } = parseArgs();
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或数据盘不可写');
  console.log(`[backfill-klines-hour] data dir: ${dataDir}`);
  console.log(`[backfill-klines-hour] instruments: ${instrumentIds.join(', ')}, force=${force}`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of instrumentIds) {
    const bars = readBars(id);
    if (!force && !needsBackfill(bars)) {
      skipped += 1;
      console.log(`  skip ${id} (${bars.length} bars, ${bars[0]?.date} → ${bars[bars.length - 1]?.date})`);
      continue;
    }

    try {
      const data = await fetchCommodityHistory(id, 'hour', { force: true });
      const klines = data.klines || [];
      const first = klines[0]?.date;
      const last = klines[klines.length - 1]?.date;
      console.log(`  ok ${id}: ${klines.length} bars ${first} → ${last} (${data.source})`);
      fetched += 1;
      await new Promise((r) => setTimeout(r, 280));
    } catch (err) {
      failed += 1;
      console.error(`  fail ${id}: ${err.message}`);
    }
  }

  console.log(`[backfill-klines-hour] done fetched=${fetched} skipped=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
