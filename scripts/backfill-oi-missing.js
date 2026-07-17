/**
 * 补齐 trading JSON 中 OI 为零的品种（P0：au/ag/fu/sc + 可选 --partial）
 * 用法: node scripts/backfill-oi-missing.js [--force] [--partial]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { getDataDir } = require('../services/data-paths');
const { fetchFuturesDailyWithOi } = require('../services/commodities-history-fetcher');
const { auditOiCoverage } = require('../services/oi-behavior-features');

const MIN_START = '2019-01-01';
const ZERO_OI_IDS = ['au', 'ag', 'fu', 'sc'];
const PARTIAL_OI_IDS = ['JR', 'LR', 'PM', 'RI', 'WH', 'ZC'];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force'),
    partial: args.includes('--partial'),
    dryRun: args.includes('--dry-run'),
  };
}

function tradingPath(historyDir, id) {
  return path.join(historyDir, 'trading', `${String(id).toLowerCase()}.json`);
}

function readTradingBars(historyDir, id) {
  const fp = tradingPath(historyDir, id);
  if (!fs.existsSync(fp)) return { fp, bars: null };
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const bars = Array.isArray(raw) ? raw : raw.series || [];
  return { fp, bars };
}

function writeTradingBars(fp, bars) {
  fs.writeFileSync(fp, JSON.stringify(bars, null, 2), 'utf8');
}

function mergeOiIntoTradingBars(existing, fetched) {
  const idx = new Map(existing.map((b, i) => [String(b.date).slice(0, 10), i]));
  let merged = 0;
  for (const bar of fetched) {
    const d = String(bar.date).slice(0, 10);
    const oi = bar.openInterest ?? bar.oi;
    if (!oi || oi <= 0) continue;
    if (idx.has(d)) {
      existing[idx.get(d)].oi = Math.round(oi);
      existing[idx.get(d)].openInterest = Math.round(oi);
      merged += 1;
    }
  }
  return merged;
}

function needsBackfill(bars, force) {
  if (force) return true;
  const audit = auditOiCoverage(bars, MIN_START);
  return !audit.ok;
}

async function backfillOne(historyDir, id, opts) {
  const { fp, bars } = readTradingBars(historyDir, id);
  if (!bars?.length) {
    console.warn(`  skip ${id}: no trading file`);
    return { id, status: 'missing_file' };
  }

  const before = auditOiCoverage(bars, MIN_START);
  if (!needsBackfill(bars, opts.force)) {
    console.log(`  skip ${id}: coverage ${before.coveragePct}% ok`);
    return { id, status: 'skipped', before };
  }

  let oiBars = [];
  let source = 'eastmoney-futures';
  try {
    const { bars: fetched } = await fetchFuturesDailyWithOi(id);
    oiBars = fetched.filter((b) => String(b.date).slice(0, 10) >= MIN_START);
  } catch (err) {
    console.warn(`  em fail ${id}: ${err.message}`);
  }

  if (oiBars.length < 20) {
    console.error(`  fail ${id}: insufficient OI rows (${oiBars.length})`);
    return { id, status: 'failed', before };
  }

  const merged = mergeOiIntoTradingBars(bars, oiBars);
  const after = auditOiCoverage(bars, MIN_START);

  if (!opts.dryRun) {
    writeTradingBars(fp, bars);
  }

  console.log(
    `  ok ${id}: ${before.coveragePct}% → ${after.coveragePct}% merged=${merged} (${source})`
  );
  return { id, status: 'ok', before, after, merged, source };
}

async function main() {
  const opts = parseArgs();
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const targets = [...ZERO_OI_IDS];
  if (opts.partial) targets.push(...PARTIAL_OI_IDS);

  console.log(
    `[backfill-oi-missing] history=${historyDir} targets=${targets.length} force=${opts.force} dryRun=${opts.dryRun}`
  );

  const results = [];
  for (const id of targets) {
    results.push(await backfillOne(historyDir, id, opts));
    await new Promise((r) => setTimeout(r, 320));
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  console.log(`[backfill-oi-missing] done ok=${ok} failed=${failed} skipped=${results.length - ok - failed}`);

  const reportPath = path.join(historyDir, 'oi-backfill-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ at: new Date().toISOString(), targets, results }, null, 2),
    'utf8'
  );
  console.log(`report → ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
