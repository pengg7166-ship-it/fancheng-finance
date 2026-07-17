#!/usr/bin/env node
/**
 * Verify DemoMaCross1020 (MA10/MA20) across 74 main instruments using real cached day K-lines.
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/verify-ma-cross-1020.js
 *   FANCHENG_DATA_DRIVE=E node scripts/verify-ma-cross-1020.js --from 2023-01-01
 *   FANCHENG_DATA_DRIVE=E node scripts/verify-ma-cross-1020.js --export-main
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const {
  readCachedKlines,
  detectMaCross1020,
  maCross1020TrendDirection,
} = require('../services/commodity-technical-analyzer');

const MIN_BARS = 21;
const DEFAULT_FROM = '2022-01-01';

function parseArgs(argv) {
  const opts = { from: DEFAULT_FROM, exportMain: false, outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from' && argv[i + 1]) opts.from = argv[++i];
    else if (argv[i] === '--export-main') opts.exportMain = true;
    else if (argv[i] === '--out' && argv[i + 1]) opts.outPath = path.resolve(argv[++i]);
  }
  return opts;
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function actualDirection(prevClose, nextClose) {
  if (prevClose == null || nextClose == null || prevClose <= 0 || nextClose <= 0) return null;
  const chg = ((nextClose - prevClose) / prevClose) * 100;
  if (Math.abs(chg) < 0.03) return 'neutral';
  return chg > 0 ? 'bullish' : 'bearish';
}

function hitDirection(predicted, actual) {
  if (!predicted || !actual || predicted === 'neutral' || actual === 'neutral') return null;
  return predicted === actual;
}

function evaluateInstrument(spec, bars, fromDate) {
  const result = {
    instrumentId: spec.id,
    sector: spec.sector,
    barCount: bars.length,
    dataSource: 'readCachedKlines',
    method: 'DemoMaCross1020-daily-proxy',
    trend: { hits: 0, total: 0, scored: 0, missingActual: 0 },
    cross: { hits: 0, total: 0, scored: 0, missingActual: 0, events: 0 },
    latest: null,
    status: 'ok',
    issues: [],
  };

  if (bars.length < MIN_BARS) {
    result.status = 'insufficient_bars';
    result.issues.push(`bars=${bars.length} < ${MIN_BARS}`);
    return result;
  }

  for (let t = MIN_BARS; t < bars.length - 1; t += 1) {
    const barDate = normBarDate(bars[t]);
    if (barDate < fromDate) continue;

    const slice = bars.slice(0, t + 1);
    const closes = slice.map((b) => b.close).filter((c) => c > 0);
    if (closes.length < MIN_BARS) continue;

    const cross = detectMaCross1020(closes);
    const trendDir = maCross1020TrendDirection(closes);
    const prevClose = bars[t].close;
    const nextClose = bars[t + 1]?.close;
    const actual = actualDirection(prevClose, nextClose);

    if (actual == null) {
      result.trend.missingActual += 1;
      if (cross) result.cross.missingActual += 1;
      continue;
    }

    if (trendDir && trendDir !== 'neutral') {
      result.trend.total += 1;
      const hit = hitDirection(trendDir, actual);
      if (hit != null) {
        result.trend.scored += 1;
        if (hit) result.trend.hits += 1;
      }
    }

    if (cross) {
      result.cross.events += 1;
      const predicted = cross === 'golden' ? 'bullish' : 'bearish';
      result.cross.total += 1;
      const hit = hitDirection(predicted, actual);
      if (hit != null) {
        result.cross.scored += 1;
        if (hit) result.cross.hits += 1;
      }
    }
  }

  const latestCloses = bars.map((b) => b.close).filter((c) => c > 0);
  const latestCross = detectMaCross1020(latestCloses);
  const latestTrend = maCross1020TrendDirection(latestCloses);
  result.latest = {
    asOfDate: normBarDate(bars[bars.length - 1]),
    trend1020: latestTrend,
    cross1020Signal: latestCross,
    dataSource: 'readCachedKlines',
  };

  if (result.trend.scored === 0 && result.cross.scored === 0) {
    result.status = 'no_scored_samples';
    result.issues.push('no_scored_samples_in_window');
  }

  return result;
}

function pct(hits, total) {
  if (!total) return null;
  return +((hits / total) * 100).toFixed(2);
}

function rateLabel(hits, total) {
  if (!total) return '暂无';
  return `${pct(hits, total)}% (${hits}/${total})`;
}

async function maybeExportMainContracts() {
  const exportScript = path.join(__dirname, 'export-ma-cross-instruments.js');
  if (!fs.existsSync(exportScript)) return null;
  execSync(`node "${exportScript}"`, {
    stdio: 'inherit',
    env: { ...process.env, FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE || 'E' },
  });
  const dataDir = getDataDir();
  const mapPath = path.join(dataDir, 'main-contracts-pythongo.json');
  if (!fs.existsSync(mapPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataDir = getDataDir();
  if (!dataDir) {
    console.error('FANCHENG_DATA_DRIVE unavailable');
    process.exit(1);
  }
  diskCache.init(dataDir);

  let mainContracts = null;
  if (opts.exportMain) {
    mainContracts = await maybeExportMainContracts();
  } else {
    const mapPath = path.join(dataDir, 'main-contracts-pythongo.json');
    if (fs.existsSync(mapPath)) {
      try {
        mainContracts = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      } catch {
        mainContracts = null;
      }
    }
  }

  const perInstrument = [];
  let trendHits = 0;
  let trendScored = 0;
  let crossHits = 0;
  let crossScored = 0;
  let crossEvents = 0;
  const missingKlines = [];
  const insufficientBars = [];

  for (const spec of INSTRUMENT_REGISTRY) {
    const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b));
    if (!bars.length) {
      missingKlines.push(spec.id);
      perInstrument.push({
        instrumentId: spec.id,
        status: 'missing_klines',
        dataSource: 'readCachedKlines',
        issues: ['暂无'],
      });
      continue;
    }

    const row = evaluateInstrument(spec, bars, opts.from);
    perInstrument.push(row);
    trendHits += row.trend?.hits || 0;
    trendScored += row.trend?.scored || 0;
    crossHits += row.cross?.hits || 0;
    crossScored += row.cross?.scored || 0;
    crossEvents += row.cross?.events || 0;

    if (row.status === 'insufficient_bars') insufficientBars.push(spec.id);
  }

  const expected = INSTRUMENT_REGISTRY.length;
  const withKlines = expected - missingKlines.length;
  const passCoverage = withKlines === expected;
  const passMainMap = (mainContracts?.contractCount ?? 0) >= expected;

  const summary = {
    ok: passCoverage && trendScored > 0,
    version: 'verify-ma-cross-1020-v1',
    generatedAt: new Date().toISOString(),
    dataSource: 'readCachedKlines',
    method: 'DemoMaCross1020-daily-proxy',
    fromDate: opts.from,
    expectedInstruments: expected,
    withKlines,
    missingKlines,
    insufficientBars,
    mainContracts: mainContracts
      ? {
          contractCount: mainContracts.contractCount,
          totalResolved: mainContracts.totalResolved,
          skipped: mainContracts.skipped?.length ?? 0,
          pass: passMainMap,
        }
      : { pass: null, note: 'main-contracts-pythongo.json not loaded; run with --export-main' },
    trendDirection: {
      hitRate: rateLabel(trendHits, trendScored),
      hits: trendHits,
      scored: trendScored,
      note: 'MA10 vs MA20 position → T+1 close direction',
    },
    crossEvents: {
      hitRate: rateLabel(crossHits, crossScored),
      hits: crossHits,
      scored: crossScored,
      events: crossEvents,
      note: 'Golden/dead cross bar → T+1 close direction',
    },
    perInstrument: perInstrument.map((r) => ({
      id: r.instrumentId,
      status: r.status,
      bars: r.barCount,
      trendHit: rateLabel(r.trend?.hits, r.trend?.scored),
      crossHit: rateLabel(r.cross?.hits, r.cross?.scored),
      crossEvents: r.cross?.events ?? 0,
      latest: r.latest,
      issues: r.issues?.length ? r.issues : undefined,
    })),
  };

  const outPath = opts.outPath || path.join(process.cwd(), '_verify-ma-cross-1020-summary.json');
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('=== DemoMaCross1020 verify (74 主力 · readCachedKlines) ===');
  console.log(`instruments: ${withKlines}/${expected} with K-lines`);
  console.log(`main-contract map: ${mainContracts ? `${mainContracts.contractCount}/${expected}` : 'not loaded'}`);
  console.log(`trend T+1 hit: ${summary.trendDirection.hitRate}`);
  console.log(`cross T+1 hit: ${summary.crossEvents.hitRate} · events ${crossEvents}`);
  console.log(`missing klines: ${missingKlines.length ? missingKlines.join(', ') : 'none'}`);
  console.log(`written: ${outPath}`);
  console.log(`pass: ${summary.ok ? 'YES' : 'NO'}`);

  process.exit(summary.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
