/**
 * 一键拉取 2019+ 历史数据：FRED 宏观 + 国际指数 + 国内期货 OI
 * 用法: node scripts/fetch-all-history-data.js [--force]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const fredHistory = require('../services/fred-history-fetcher');
const historicalContext = require('../services/commodity-outlook-historical-context');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { fetchFuturesDailyWithOi } = require('../services/commodities-history-fetcher');
const { fetchIndexHistory, listIndicesWithHistory } = require('../services/history-fetcher');
const { fetchCommodityHistory } = require('../services/commodities-history-fetcher');

const MIN_START = '2019-01-01';
const KEY_INDICES = ['sp500', 'dji', 'ixic', 'n225', 'hsi', 'ftse', 'dax', 'sse'];

function parseArgs() {
  return { force: process.argv.includes('--force') };
}

function klineKey(instrumentId) {
  return `klines/commodity-${String(instrumentId).toLowerCase()}-day.json`;
}

function countOiCoverage(bars) {
  const from2019 = bars.filter((b) => String(b.date).slice(0, 10) >= MIN_START);
  const withOi = from2019.filter((b) => b.openInterest > 0);
  return { from2019: from2019.length, withOi: withOi.length };
}

async function backfillCommodityKlines({ force }) {
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let totalBars = 0;

  for (const spec of INSTRUMENT_REGISTRY) {
    const cached = diskCache.readStale(klineKey(spec.id));
    const bars = cached?.data?.klines || [];
    const first = String(bars[0]?.date || '').slice(0, 10);
    if (!force && bars.length >= 60 && first <= MIN_START) {
      skipped += 1;
      continue;
    }
    try {
      const data = await fetchCommodityHistory(spec.id, 'day', { force: true });
      fetched += 1;
      totalBars += data.klines?.length || 0;
      process.stdout.write(`\r  K线 ${spec.id}: ${data.klines?.length || 0} bars    `);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      failed += 1;
    }
  }
  console.log(`\n[K线] fetched=${fetched} skipped=${skipped} failed=${failed} totalBars=${totalBars}`);
  return { fetched, skipped, failed, totalBars };
}

async function backfillInternationalIndices({ force }) {
  const available = new Set(listIndicesWithHistory().map((i) => i.id));
  const targets = KEY_INDICES.filter((id) => available.has(id));
  let fetched = 0;
  let failed = 0;
  let totalBars = 0;

  for (const id of targets) {
    try {
      const data = await fetchIndexHistory(id, 'day', { force });
      const bars = data.klines || [];
      const from2019 = bars.filter((b) => String(b.date).slice(0, 10) >= MIN_START);
      fetched += 1;
      totalBars += from2019.length;
      console.log(`  指数 ${id}: ${from2019.length} bars since 2019 (${data.source})`);
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      failed += 1;
      console.warn(`  指数 ${id} fail: ${err.message}`);
    }
  }
  console.log(`[指数] fetched=${fetched} failed=${failed} bars2019+=${totalBars}`);
  return { fetched, failed, totalBars, targets };
}

async function backfillOi({ force }) {
  let fetched = 0;
  let failed = 0;
  let oiRows = 0;
  let mergedTotal = 0;

  for (const spec of INSTRUMENT_REGISTRY) {
    const cached = diskCache.readStale(klineKey(spec.id));
    const bars = cached?.data?.klines || [];
    const cov = countOiCoverage(bars);
    if (!force && cov.from2019 >= 60 && cov.withOi >= cov.from2019 * 0.5) continue;

    try {
      const { bars: oiBars, source } = await fetchFuturesDailyWithOi(spec.id);
      const idx = new Map(bars.map((b, i) => [String(b.date).slice(0, 10), i]));
      let merged = 0;
      for (const bar of oiBars) {
        const d = String(bar.date).slice(0, 10);
        if (d < MIN_START || !bar.openInterest) continue;
        if (idx.has(d)) {
          bars[idx.get(d)].openInterest = bar.openInterest;
          merged += 1;
        }
      }
      if (bars.length) {
        diskCache.write(klineKey(spec.id), {
          data: { ...cached?.data, klines: bars, oiSource: source, oiBackfillAt: new Date().toISOString() },
        });
      }
      const saved = oiBars.filter((b) => b.openInterest > 0 && String(b.date).slice(0, 10) >= MIN_START).length;
      oiRows += saved;
      mergedTotal += merged;
      fetched += 1;
      process.stdout.write(`\r  OI ${spec.id}: ${saved} rows merged=${merged}    `);
      await new Promise((r) => setTimeout(r, 250));
    } catch {
      failed += 1;
    }
  }
  console.log(`\n[OI] instruments=${fetched} failed=${failed} oiRows=${oiRows} merged=${mergedTotal}`);
  return { fetched, failed, oiRows, mergedTotal };
}

async function main() {
  const { force } = parseArgs();
  diskCache.init(getUserDataDir() || getDataDir() || path.join(process.cwd(), 'data'));

  console.log('=== [1/4] FRED 宏观 (美/国际) ===');
  const fred = await fredHistory.loadFredHistory({ startDate: MIN_START, force });
  await historicalContext.ensureFredDailyCache({ force });
  console.log('[FRED] rows:', fred.rowCounts);
  console.log('[FRED] sources:', fred.sources);
  console.log('[FRED] dir:', fredHistory.getHistoryDir());

  console.log('\n=== [2/4] 国际指数日K 2019+ ===');
  const indices = await backfillInternationalIndices({ force });

  console.log('\n=== [3/4] 国内期货日K 2019+ ===');
  const klines = await backfillCommodityKlines({ force: false });

  console.log('\n=== [4/4] 国内期货持仓量 OI ===');
  const oi = await backfillOi({ force });

  const summary = {
    fetchedAt: new Date().toISOString(),
    startDate: MIN_START,
    fred: { rowCounts: fred.rowCounts, sources: fred.sources },
    indices,
    klines,
    oi,
  };
  const outPath = path.join(fredHistory.getHistoryDir(), 'fetch-summary.json');
  require('fs').writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('\nWrote', outPath);
  console.log('Next: node scripts/tune-sector-weights-longrun.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
