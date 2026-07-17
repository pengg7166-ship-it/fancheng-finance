#!/usr/bin/env node
/**
 * Tick zip → intraday K (5m/15m/hour) for all catalog commodities (default).
 *
 * Reuses zip discovery / variety mapping from convert-tick-zips-to-daily.js.
 * Main contract per day: highest tick volume contract (same as daily converter).
 *
 * Usage:
 *   node scripts/backfill-tick-intraday.js --inventory
 *   node scripts/backfill-tick-intraday.js --instruments au --from 2023-01-01 --to 2025-12-31
 *   node scripts/backfill-tick-intraday.js --probe-au --limit 3
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const tickConvert = require('./convert-tick-zips-to-daily');
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const { getCommodityMeta, getAllCommodities } = require('../services/commodities-catalog');
const diskCache = require('../services/disk-cache');

const {
  buildVarietyMap,
  mapToInstrument,
  formatDateYmd,
  dateFromZipName,
  zipEntryName,
  zipRelKey,
  discoverZips,
  resolveTxtForZip,
  runWorkerPool,
  createMergeQueue,
  defaultWorkers,
} = tickConvert;

const DEFAULT_BASE = 'E:\\BaiduNetdiskDownload';
const P0_INTRADAY = ['au', 'ag', 'rb'];
const TIMEFRAMES = [
  { id: '5m', minutes: 5, label: '5分K' },
  { id: '15m', minutes: 15, label: '15分K' },
  { id: 'hour', minutes: 60, label: '小时K' },
];
const PROGRESS_FILE = 'tick-intraday-progress.json';
const DEFAULT_FROM = '2023-01-01';
const DEFAULT_TO = '2025-12-31';
const DEFAULT_STAGING_SUFFIX = 'tick-intraday-staging';

function defaultDataSubdir(...segments) {
  const dataDir = getDataDir() || path.join('E:\\FanchengFinance', 'data');
  return path.join(dataDir, ...segments);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const readStr = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const readInt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? parseInt(args[i + 1], 10) || fallback : fallback;
  };
  return {
    inventory: args.includes('--inventory'),
    probeAu: args.includes('--probe-au'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    benchmark: args.includes('--benchmark'),
    base: readStr('--base', DEFAULT_BASE),
    from: readStr('--from', DEFAULT_FROM),
    to: readStr('--to', DEFAULT_TO),
    limit: readInt('--limit', 0),
    workers: readInt('--workers', defaultWorkers()),
    flushEvery: readInt('--flush-every', 25),
    instruments: (() => {
      const raw = readStr('--instruments', '');
      if (raw) {
        return raw
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
      }
      return getAllCommodities().map((c) => String(c.id).toLowerCase());
    })(),
  };
}

function ymdNum(dateStr) {
  return parseInt(String(dateStr || '').replace(/[^\d]/g, '').slice(0, 8), 10) || 0;
}

function zipInRange(zipPath, fromYmd, toYmd) {
  const tradeDate = dateFromZipName(zipPath);
  if (!tradeDate) return false;
  const n = ymdNum(tradeDate);
  return n >= fromYmd && n <= toYmd;
}

function getProgressPath() {
  const dir = defaultDataSubdir('history', 'trading');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, PROGRESS_FILE);
}

function loadProgress() {
  const p = getProgressPath();
  if (!fs.existsSync(p)) return { processed: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { processed: raw.processed || {} };
  } catch {
    return { processed: {} };
  }
}

function saveProgressAtomic(progress) {
  const p = getProgressPath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(progress, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function klineDiskKey(instrumentId, timeframe) {
  return `klines/commodity-${String(instrumentId).toLowerCase()}-${timeframe}.json`;
}

function tickBarKey(dateStr, hh, mm, intervalMin) {
  const bucketMm = intervalMin >= 60 ? 0 : Math.floor(mm / intervalMin) * intervalMin;
  const pad = (n) => String(n).padStart(2, '0');
  return `${dateStr} ${pad(hh)}:${pad(bucketMm)}`;
}

function createBarBucket() {
  return { open: null, high: null, low: null, close: null, volume: 0 };
}

function updateBucket(bucket, px, vol) {
  if (bucket.open == null) {
    bucket.open = px;
    bucket.high = px;
    bucket.low = px;
  } else {
    bucket.high = Math.max(bucket.high, px);
    bucket.low = Math.min(bucket.low, px);
  }
  bucket.close = px;
  bucket.volume += vol;
}

function bucketToBar(key, bucket) {
  if (bucket.open == null) return null;
  return {
    date: key,
    open: +bucket.open.toFixed(4),
    high: +bucket.high.toFixed(4),
    low: +bucket.low.toFixed(4),
    close: +bucket.close.toFixed(4),
    volume: Math.round(bucket.volume),
  };
}

function createContractState(instrumentId) {
  const tfMaps = {};
  for (const tf of TIMEFRAMES) tfMaps[tf.id] = new Map();
  return { instrumentId, dayVolume: 0, tfMaps };
}

function createIntradayTickParser(tradeDate, varietyMap, targetInstruments) {
  const targetSet = targetInstruments?.length ? new Set(targetInstruments) : null;
  const ctx = {
    varietyMap,
    targetSet,
    tradeDate,
    byContract: new Map(),
    header: null,
    col: {},
    tickRows: 0,
    skipped: 0,
  };

  const processLine = (line) => {
    if (!line.trim()) return;
    if (!ctx.header) {
      ctx.header = line.split('\t');
      ctx.col = {
        tdate: ctx.header.indexOf('TDATE'),
        ttime: ctx.header.indexOf('TTIME'),
        contractId: ctx.header.indexOf('CONTRACTID'),
        lastPx: ctx.header.indexOf('LASTPX'),
        tq: ctx.header.indexOf('TQ'),
        contractCode: ctx.header.indexOf('CONTRACTCODE'),
        varieties: ctx.header.indexOf('VARIETIES'),
      };
      return;
    }

    const parts = line.split('\t');
    const get = (idx) => (idx >= 0 && idx < parts.length ? parts[idx] : '');
    const contractId = get(ctx.col.contractId);
    const instId = mapToInstrument(
      contractId,
      get(ctx.col.contractCode),
      get(ctx.col.varieties),
      ctx.varietyMap
    );
    if (!instId) {
      ctx.skipped += 1;
      return;
    }
    if (targetSet && !targetSet.has(instId)) {
      ctx.skipped += 1;
      return;
    }

    const px = parseFloat(get(ctx.col.lastPx));
    if (!Number.isFinite(px) || px <= 0) return;

    const tq = parseFloat(get(ctx.col.tq)) || 0;
    const rawTdate = get(ctx.col.tdate);
    const ttime = get(ctx.col.ttime);
    if (!ttime) return;

    const dateStr = formatDateYmd(rawTdate) || ctx.tradeDate;
    const pad6 = String(ttime).padStart(6, '0');
    const hh = parseInt(pad6.slice(0, 2), 10);
    const mm = parseInt(pad6.slice(2, 4), 10);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;

    ctx.tickRows += 1;

    let contract = ctx.byContract.get(contractId);
    if (!contract) {
      contract = createContractState(instId);
      ctx.byContract.set(contractId, contract);
    }
    contract.dayVolume += tq;

    for (const tf of TIMEFRAMES) {
      const key = tickBarKey(dateStr, hh, mm, tf.minutes);
      let bucket = contract.tfMaps[tf.id].get(key);
      if (!bucket) {
        bucket = createBarBucket();
        contract.tfMaps[tf.id].set(key, bucket);
      }
      updateBucket(bucket, px, tq);
    }
  };

  const MAX_LINE = 4 * 1024 * 1024;
  let carry = '';

  const feedChunk = (chunkStr) => {
    carry += chunkStr;
    let nl;
    while ((nl = carry.indexOf('\n')) >= 0) {
      let line = carry.slice(0, nl);
      carry = carry.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length > MAX_LINE) continue;
      processLine(line);
    }
    if (carry.length > MAX_LINE) carry = carry.slice(-MAX_LINE);
  };

  const finish = () => {
    if (carry.trim() && carry.length <= MAX_LINE) processLine(carry);

    const bestByInst = new Map();
    for (const contract of ctx.byContract.values()) {
      const prev = bestByInst.get(contract.instrumentId);
      if (!prev || contract.dayVolume > prev.dayVolume) {
        bestByInst.set(contract.instrumentId, contract);
      }
    }

    const barsByInst = {};
    for (const [instId, contract] of bestByInst) {
      barsByInst[instId] = {};
      for (const tf of TIMEFRAMES) {
        barsByInst[instId][tf.id] = [...contract.tfMaps[tf.id].entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, bucket]) => bucketToBar(key, bucket))
          .filter(Boolean);
      }
    }

    return { barsByInst, tickRows: ctx.tickRows, skipped: ctx.skipped };
  };

  return { feedChunk, finish };
}

function parseIntradayFromZipStream(zipPath, tradeDate, varietyMap, targetInstruments) {
  const entry = zipEntryName(zipPath);
  return new Promise((resolve, reject) => {
    const parser = createIntradayTickParser(tradeDate, varietyMap, targetInstruments);
    const proc = spawn('tar', ['-xOf', zipPath, entry], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => parser.feedChunk(chunk));
    proc.stdout.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`tar -xOf exit ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(parser.finish());
    });
    proc.on('error', reject);
  });
}

function parseIntradayFromTxt(txtPath, tradeDate, varietyMap, targetInstruments) {
  return new Promise((resolve, reject) => {
    const parser = createIntradayTickParser(tradeDate, varietyMap, targetInstruments);
    const stream = fs.createReadStream(txtPath, { encoding: 'utf8', highWaterMark: 4 * 1024 * 1024 });
    stream.on('data', (chunk) => parser.feedChunk(chunk));
    stream.on('end', () => resolve(parser.finish()));
    stream.on('error', reject);
  });
}

async function processOneZip(zipPath, workerId, varietyMap, targetInstruments, stagingRoot) {
  const tradeDate = dateFromZipName(zipPath);
  if (!tradeDate) {
    return { zipPath, tradeDate: null, barsByInst: {}, tickRows: 0, skipped: 0, error: '无法解析日期' };
  }
  try {
    const parsed = await parseIntradayFromZipStream(zipPath, tradeDate, varietyMap, targetInstruments);
    return {
      zipPath,
      tradeDate,
      barsByInst: parsed.barsByInst,
      tickRows: parsed.tickRows,
      skipped: parsed.skipped,
      error: null,
    };
  } catch (streamErr) {
    const stagingDir = path.join(stagingRoot, `w${workerId}`);
    fs.mkdirSync(stagingDir, { recursive: true });
    try {
      const txtPath = resolveTxtForZip(zipPath, stagingDir);
      const parsed = await parseIntradayFromTxt(txtPath, tradeDate, varietyMap, targetInstruments);
      return {
        zipPath,
        tradeDate,
        barsByInst: parsed.barsByInst,
        tickRows: parsed.tickRows,
        skipped: parsed.skipped,
        error: null,
      };
    } catch (stagingErr) {
      return {
        zipPath,
        tradeDate,
        barsByInst: {},
        tickRows: 0,
        skipped: 0,
        error: stagingErr.message || String(streamErr.message || streamErr),
      };
    }
  }
}

function createAccumulator() {
  const byInst = new Map();
  return {
    mergeDay(barsByInst) {
      for (const [instId, tfBars] of Object.entries(barsByInst || {})) {
        if (!byInst.has(instId)) {
          const tfMaps = {};
          for (const tf of TIMEFRAMES) tfMaps[tf.id] = new Map();
          byInst.set(instId, tfMaps);
        }
        const tfMaps = byInst.get(instId);
        for (const tf of TIMEFRAMES) {
          const bars = tfBars[tf.id] || [];
          const map = tfMaps[tf.id];
          for (const bar of bars) {
            const prev = map.get(bar.date);
            if (!prev || (prev.volume || 0) < bar.volume) map.set(bar.date, bar);
          }
        }
      }
    },
    getBars(instId, tfId) {
      const tfMaps = byInst.get(instId);
      if (!tfMaps) return [];
      return [...tfMaps[tfId].values()].sort((a, b) => a.date.localeCompare(b.date));
    },
    instrumentIds() {
      return [...byInst.keys()];
    },
    clear() {
      byInst.clear();
    },
  };
}

function buildSummary(bars, timeframe) {
  if (!bars.length) return null;
  const tf = TIMEFRAMES.find((t) => t.id === timeframe);
  const start = bars[0];
  const end = bars[bars.length - 1];
  const totalReturnPct = start.close ? ((end.close - start.close) / start.close) * 100 : 0;
  return {
    timeframe,
    timeframeLabel: tf?.label || timeframe,
    startDate: start.date,
    endDate: end.date,
    startValue: start.close,
    endValue: end.close,
    high20y: Math.max(...bars.map((b) => b.high)),
    low20y: Math.min(...bars.map((b) => b.low)),
    totalReturnPct,
    bars: bars.length,
  };
}

function mergeKlineBars(existing, incoming) {
  const byDate = new Map((existing || []).map((b) => [b.date, b]));
  for (const bar of incoming || []) {
    const prev = byDate.get(bar.date);
    if (!prev || (prev.volume || 0) < (bar.volume || 0)) byDate.set(bar.date, bar);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function writeIntradayKlines(instrumentId, tfId, bars, dryRun) {
  const meta = getCommodityMeta(instrumentId);
  const key = klineDiskKey(instrumentId, tfId);
  const cached = diskCache.readStale(key);
  const merged = mergeKlineBars(cached?.data?.klines || [], bars);
  const summary = buildSummary(merged, tfId);
  const data = {
    id: meta?.id || instrumentId,
    name: meta?.name || instrumentId,
    exchange: meta?.exchange,
    unit: meta?.unit,
    timeframe: tfId,
    source: 'tick-zips-sync',
    sourceNote: 'intraday bars aggregated from Baidu tick zips (main contract per day)',
    summary,
    klines: merged,
  };
  if (!dryRun) diskCache.write(key, { data });
  return { key, bars: merged.length, summary };
}

function printInventory(base) {
  const zips = discoverZips(base);
  const months = new Set();
  for (const z of zips) {
    const m = path.basename(z).match(/future_price(\d{6})/);
    if (m) months.add(m[1]);
  }
  console.log(`[tick-intraday] zip source: ${base}`);
  console.log(`[tick-intraday] zips: ${zips.length}, months: ${[...months].sort().join(', ')}`);
  console.log('[tick-intraday] output: data/klines/commodity-{id}-{5m|15m|hour}.json');
  return { zips: zips.length, months: [...months].sort() };
}

function printInstrumentStats(instrumentId) {
  const lines = [`[tick-intraday] ${instrumentId}:`];
  for (const tf of TIMEFRAMES) {
    const key = klineDiskKey(instrumentId, tf.id);
    const cached = diskCache.readStale(key);
    const bars = cached?.data?.klines || [];
    const summary = cached?.data?.summary;
    if (!bars.length) {
      lines.push(`  ${tf.id}: 0 bars`);
      continue;
    }
    const closes = bars.map((b) => b.close).filter((c) => c > 0);
    const minClose = Math.min(...closes);
    const maxClose = Math.max(...closes);
    lines.push(
      `  ${tf.id}: ${bars.length} bars, ${summary?.startDate || bars[0].date} ~ ${summary?.endDate || bars[bars.length - 1].date}, close ${minClose.toFixed(2)}-${maxClose.toFixed(2)}`
    );
  }
  console.log(lines.join('\n'));
}

function instrumentsMissingTickCache(instIds) {
  return instIds.filter((id) => {
    const cached = diskCache.readStale(klineDiskKey(id, '5m'));
    const d = cached?.data;
    return !(d?.source === 'tick-zips-sync' && d.klines?.length);
  });
}

async function runBackfill(opts) {
  const varietyMap = buildVarietyMap();
  const fromYmd = ymdNum(opts.from);
  const toYmd = ymdNum(opts.to);
  const allZips = discoverZips(opts.base);
  let zips = allZips.filter((z) => zipInRange(z, fromYmd, toYmd));

  const userData = getUserDataDir() || path.join(process.cwd(), 'userData');
  diskCache.init(userData);

  const missingOnDisk = new Set(
    instrumentsMissingTickCache(opts.instruments).map((id) => String(id).toLowerCase())
  );
  if (missingOnDisk.size) {
    console.log(`[tick-intraday] retry missing on disk: ${[...missingOnDisk].join(',')}`);
  }

  const progress = loadProgress();
  if (!opts.force) {
    zips = zips.filter((z) => {
      const key = zipRelKey(z);
      const entry = progress.processed[key];
      if (!entry?.flushed) return true;
      const done = new Set((entry.instruments || P0_INTRADAY).map((id) => String(id).toLowerCase()));
      return opts.instruments.some((id) => {
        const low = String(id).toLowerCase();
        if (missingOnDisk.has(low)) return true;
        return !done.has(low);
      });
    });
  }
  if (opts.limit > 0) zips = zips.slice(0, opts.limit);

  console.log(`[tick-intraday] zips=${zips.length} (pool ${allZips.length}) from=${opts.from} to=${opts.to} instruments=${opts.instruments.join(',')}`);
  if (!zips.length) {
    console.log('[tick-intraday] nothing to process');
    return { processed: 0, failed: 0, tickRows: 0, elapsedMin: 0, rate: 0 };
  }

  const stagingRoot = defaultDataSubdir('history', DEFAULT_STAGING_SUFFIX);
  fs.mkdirSync(stagingRoot, { recursive: true });

  const accumulator = createAccumulator();
  const mergeQueue = createMergeQueue();
  const stats = { processed: 0, failed: 0, tickRows: 0, errors: [], sinceFlush: 0 };
  const startedAt = Date.now();
  let lastLog = 0;
  let pendingFlush = [];

  const flushInstruments = async (instIds, batchKeys) => {
    const ids = instIds.length ? instIds : opts.instruments;
    for (const instId of ids) {
      for (const tf of TIMEFRAMES) {
        const bars = accumulator.getBars(instId, tf.id);
        if (!bars.length) continue;
        const out = writeIntradayKlines(instId, tf.id, bars, opts.dryRun);
        console.log(`[tick-intraday] cache ${instId}-${tf.id}: ${out.bars} bars`);
      }
    }
    if (!opts.dryRun && batchKeys.length) {
      const now = new Date().toISOString();
      for (const entry of batchKeys) {
        progress.processed[entry.key] = {
          ...entry.meta,
          flushed: true,
          instruments: [...opts.instruments],
          flushedAt: now,
        };
      }
      saveProgressAtomic(progress);
    }
    accumulator.clear();
    pendingFlush = [];
    stats.sinceFlush = 0;
  };

  await runWorkerPool(zips, opts.workers, async (zipPath, workerId) => {
    const result = await processOneZip(zipPath, workerId, varietyMap, opts.instruments, stagingRoot);
    await mergeQueue(result.barsByInst ? Object.keys(result.barsByInst) : [], async () => {
      if (result.error) {
        stats.failed += 1;
        stats.errors.push({ zip: zipPath, error: result.error });
        return;
      }
      stats.processed += 1;
      stats.sinceFlush += 1;
      stats.tickRows += result.tickRows || 0;
      accumulator.mergeDay(result.barsByInst);
      pendingFlush.push({
        key: zipRelKey(zipPath),
        meta: { tradeDate: result.tradeDate, tickRows: result.tickRows, at: new Date().toISOString() },
      });
      if (stats.sinceFlush >= opts.flushEvery || stats.processed === zips.length) {
        await flushInstruments(opts.instruments, pendingFlush);
      }
      const now = Date.now();
      if (now - lastLog > 15000 || stats.processed === zips.length) {
        lastLog = now;
        const elapsedMin = (now - startedAt) / 60000;
        const rate = stats.processed / (elapsedMin || 0.001);
        console.log(
          `[tick-intraday] progress ${stats.processed}/${zips.length} failed=${stats.failed} tickRows=${stats.tickRows} rate=${rate.toFixed(1)} zip/min`
        );
      }
    });
  });

  await mergeQueue(opts.instruments, async () => {
    if (pendingFlush.length) await flushInstruments(opts.instruments, pendingFlush);
  });

  const elapsedMin = (Date.now() - startedAt) / 60000;
  for (const instId of opts.instruments) printInstrumentStats(instId);

  if (stats.errors.length) {
    console.log(`[tick-intraday] errors (${stats.errors.length}):`);
    for (const e of stats.errors.slice(0, 5)) console.log(`  ${e.zip}: ${e.error}`);
  }

  return {
    processed: stats.processed,
    failed: stats.failed,
    tickRows: stats.tickRows,
    elapsedMin,
    rate: stats.processed / (elapsedMin || 0.001),
  };
}

async function probeZips(opts) {
  const varietyMap = buildVarietyMap();
  const zips = discoverZips(opts.base).slice(0, opts.limit || 1);
  const stagingRoot = defaultDataSubdir('history', DEFAULT_STAGING_SUFFIX);
  for (const zipPath of zips) {
    const result = await processOneZip(zipPath, 0, varietyMap, opts.instruments, stagingRoot);
    console.log('\n[tick-intraday] probe', zipPath);
    console.log('  tradeDate:', result.tradeDate, 'tickRows:', result.tickRows, 'error:', result.error);
    for (const [instId, tfBars] of Object.entries(result.barsByInst || {})) {
      for (const tf of TIMEFRAMES) {
        const bars = tfBars[tf.id] || [];
        if (!bars.length) continue;
        const closes = bars.map((b) => b.close);
        console.log(
          `  ${instId} ${tf.id}: ${bars.length} bars, sample ${bars[0].date} close=${bars[0].close}, last ${bars[bars.length - 1].date} close=${bars[bars.length - 1].close}, range ${Math.min(...closes).toFixed(2)}-${Math.max(...closes).toFixed(2)}`
        );
      }
    }
  }
}

async function main() {
  const opts = parseArgs();
  if (!fs.existsSync(opts.base)) {
    console.error(`[tick-intraday] base missing: ${opts.base}`);
    process.exit(1);
  }

  const dataDir = getDataDir();
  console.log(`[tick-intraday] dataDir=${dataDir || 'n/a'}`);

  if (opts.inventory) {
    printInventory(opts.base);
    return;
  }

  if (opts.probeAu) {
    opts.instruments = ['au'];
    await probeZips(opts);
    return;
  }

  const result = await runBackfill(opts);
  console.log(
    `[tick-intraday] done processed=${result.processed} failed=${result.failed} elapsed=${result.elapsedMin.toFixed(1)}min rate=${result.rate.toFixed(1)} zip/min`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
