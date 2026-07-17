/**
 * 回填 2019+ 持仓量（OI）— 东方财富期货主连 API
 * 用法: node scripts/backfill-commodity-oi.js [--force] [--limit N]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { fetchFuturesDailyWithOi, MIN_HISTORY_START } = require('../services/commodities-history-fetcher');
const { getHistoryDir } = require('../services/fred-history-fetcher');

const MIN_START = '2019-01-01';
const GITHUB_CSV_BASE =
  'https://raw.githubusercontent.com/commodity-exchange-zh/commodity-exchange-zh/main/data';

function parseArgs() {
  const args = process.argv.slice(2);
  const sectorIdx = args.indexOf('--sector');
  const sectors = sectorIdx >= 0
    ? String(args[sectorIdx + 1] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  return {
    force: args.includes('--force'),
    sectors,
    limit: (() => {
      const i = args.indexOf('--limit');
      return i >= 0 ? parseInt(args[i + 1], 10) || 999 : 999;
    })(),
  };
}

function klineKey(instrumentId) {
  return `klines/commodity-${String(instrumentId).toLowerCase()}-day.json`;
}

function readBars(instrumentId) {
  const cached = diskCache.readStale(klineKey(instrumentId));
  return cached?.data?.klines || [];
}

function writeBars(instrumentId, data) {
  diskCache.write(klineKey(instrumentId), { data });
}

function getOiHistoryPath(instrumentId) {
  const dir = path.join(getHistoryDir(), 'oi');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(instrumentId).toLowerCase()}.json`);
}

function saveOiHistory(instrumentId, rows, source) {
  const oiRows = rows
    .filter((b) => b.openInterest > 0)
    .map((b) => ({ date: b.date, openInterest: b.openInterest }));
  const payload = {
    instrumentId,
    source,
    fetchedAt: new Date().toISOString(),
    from: MIN_START,
    rowCount: oiRows.length,
    series: oiRows,
  };
  fs.writeFileSync(getOiHistoryPath(instrumentId), JSON.stringify(payload, null, 2), 'utf8');
  return oiRows.length;
}

function mergeOiIntoBars(existing, fetched) {
  const idx = new Map(existing.map((b, i) => [String(b.date).slice(0, 10), i]));
  let merged = 0;
  for (const bar of fetched) {
    const d = String(bar.date).slice(0, 10);
    if (!bar.openInterest || bar.openInterest <= 0) continue;
    if (idx.has(d)) {
      existing[idx.get(d)].openInterest = bar.openInterest;
      merged += 1;
    }
  }
  return merged;
}

function needsBackfill(bars) {
  const from2019 = bars.filter((b) => String(b.date).slice(0, 10) >= MIN_START);
  const withOi = from2019.filter((b) => b.openInterest > 0);
  return from2019.length < 60 || withOi.length < from2019.length * 0.5;
}

async function tryGithubCsvFallback(instrumentId) {
  const year = 2019;
  const url = `${GITHUB_CSV_BASE}/${year}/${String(instrumentId).toLowerCase()}.csv`;
  try {
    const { fetchText } = require('../services/http-client');
    const text = await fetchText(url, { timeout: 15000, retries: 1 });
    const lines = text.trim().split(/\r?\n/).slice(1);
    const rows = [];
    for (const line of lines) {
      const p = line.split(',');
      if (p.length < 3) continue;
      const date = String(p[0]).slice(0, 10);
      const openInterest = parseFloat(p[p.length - 1]);
      if (date >= MIN_START && openInterest > 0) rows.push({ date, openInterest });
    }
    return rows.length >= 20 ? rows : [];
  } catch {
    return [];
  }
}

async function main() {
  diskCache.init(getUserDataDir() || getDataDir() || path.join(process.cwd(), 'data'));
  const { force, limit, sectors } = parseArgs();
  const registry = sectors.length
    ? INSTRUMENT_REGISTRY.filter((s) => sectors.includes(String(s.sector).toLowerCase()))
    : INSTRUMENT_REGISTRY;
  const targets = registry.slice(0, limit);
  console.log(
    `[backfill-oi] start=${MIN_START} instruments=${targets.length}/${INSTRUMENT_REGISTRY.length} sectors=${sectors.length ? sectors.join(',') : 'all'} force=${force}`
  );

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let oiRowsTotal = 0;

  for (const spec of targets) {
    const existing = readBars(spec.id);
    if (!force && !needsBackfill(existing)) {
      skipped += 1;
      console.log(`  skip ${spec.id} (oi coverage ok)`);
      continue;
    }

    try {
      let oiBars = [];
      let source = 'eastmoney-futures';
      try {
        const { bars } = await fetchFuturesDailyWithOi(spec.id);
        oiBars = bars.filter((b) => String(b.date).slice(0, 10) >= MIN_START);
      } catch (err) {
        console.warn(`  em fail ${spec.id}: ${err.message}`);
      }

      if (oiBars.length < 20) {
        const csvRows = await tryGithubCsvFallback(spec.id);
        if (csvRows.length >= 20) {
          oiBars = csvRows;
          source = 'github-commodity-exchange-zh';
        }
      }

      if (oiBars.length < 10) {
        failed += 1;
        console.error(`  fail ${spec.id}: insufficient OI rows`);
        continue;
      }

      const merged = mergeOiIntoBars(existing, oiBars);
      if (existing.length) {
        writeBars(spec.id, {
          ...(diskCache.readStale(klineKey(spec.id))?.data || {}),
          klines: existing,
          oiBackfillAt: new Date().toISOString(),
          oiSource: source,
        });
      }

      const saved = saveOiHistory(spec.id, oiBars, source);
      oiRowsTotal += saved;
      fetched += 1;
      console.log(`  ok ${spec.id}: oi=${saved} merged=${merged} (${source})`);
      await new Promise((r) => setTimeout(r, 280));
    } catch (err) {
      failed += 1;
      console.error(`  fail ${spec.id}: ${err.message}`);
    }
  }

  console.log(
    `[backfill-oi] done fetched=${fetched} skipped=${skipped} failed=${failed} oiRows=${oiRowsTotal}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
