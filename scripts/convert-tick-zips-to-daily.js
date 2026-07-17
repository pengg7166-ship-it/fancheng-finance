/**

 * 期货 tick zip → 日 K 聚合 → history/trading/{instrument}.json

 *

 * 用法:

 *   node scripts/convert-tick-zips-to-daily.js [--base E:\BaiduNetdiskDownload] [--dry-run] [--limit N]

 *   node scripts/convert-tick-zips-to-daily.js --workers 12 --staging D:\FanchengFinance\data\history\tick-staging

 *   node scripts/convert-tick-zips-to-daily.js --base D:\FanchengFinance\data\tick-zip-cache --fallback-base E:\BaiduNetdiskDownload --output D:\FanchengFinance\data\history\trading

 *   node scripts/convert-tick-zips-to-daily.js --benchmark --limit 20

 *   node scripts/convert-tick-zips-to-daily.js --sync-klines

 *

 * 优化: tar -xOf 流式读 zip（跳过 800MB txt 落盘）；staging 默认 D: SSD；连续 worker 池。

 */

const fs = require('fs');

const path = require('path');

const os = require('os');

const { execFileSync, spawn } = require('child_process');



process.chdir(path.join(__dirname, '..'));



const { getDataDir, getUserDataDir } = require('../services/data-paths');

const { getAllCommodities } = require('../services/commodities-catalog');

const diskCache = require('../services/disk-cache');



const DEFAULT_BASE = 'E:\\BaiduNetdiskDownload';

function defaultDataSubdir(...segments) {
  const dataDir = getDataDir() || path.join('E:\\FanchengFinance', 'data');
  return path.join(dataDir, ...segments);
}

const DEFAULT_STAGING = defaultDataSubdir('history', 'tick-staging');

const FALLBACK_STAGING = defaultDataSubdir('history', 'tick-staging');

const PROGRESS_FILE = 'tick-convert-progress.json';

let outputDirOverride = null;

let progressDirOverride = null;

const LOG_EVERY = 10;

const DEFAULT_PROGRESS_EVERY = 50;

const DEFAULT_FLUSH_EVERY = 50;



const SKIP_VARIETIES = new Set(['IC', 'IF', 'IH', 'IM', 'T', 'TF', 'TS']);



function defaultWorkers() {

  const cpus = os.cpus()?.length || 4;

  return Math.min(12, Math.max(4, cpus - 2));

}



function parseArgs() {

  const args = process.argv.slice(2);

  const readIntFlag = (name, fallback) => {

    const i = args.indexOf(name);

    return i >= 0 ? parseInt(args[i + 1], 10) || fallback : fallback;

  };

  const readStrFlag = (name, fallback) => {

    const i = args.indexOf(name);

    return i >= 0 ? args[i + 1] : fallback;

  };

  return {

    base: readStrFlag('--base', DEFAULT_BASE),

    fallbackBase: readStrFlag('--fallback-base', ''),

    output: readStrFlag('--output', ''),

    progressDir: readStrFlag('--progress-dir', ''),

    staging: readStrFlag('--staging', DEFAULT_STAGING),

    dryRun: args.includes('--dry-run'),

    limit: readIntFlag('--limit', 0),

    workers: readIntFlag('--workers', defaultWorkers()),

    progressEvery: readIntFlag('--progress-every', DEFAULT_PROGRESS_EVERY),

    flushEvery: readIntFlag('--flush-every', DEFAULT_FLUSH_EVERY),

    syncKlines: args.includes('--sync-klines'),

    force: args.includes('--force'),

    benchmark: args.includes('--benchmark'),

  };

}



function buildVarietyMap() {

  const toInst = new Map();

  for (const item of getAllCommodities()) {

    const canonId = String(item.id).toLowerCase();

    const sym = String(item.sinaSymbol || '').replace(/0$/, '').toUpperCase();

    if (sym) toInst.set(sym, canonId);

    toInst.set(String(item.id).toUpperCase(), canonId);

    toInst.set(canonId, canonId);

  }

  return { toInst };

}



function varietyFromContractId(contractId) {

  const m = String(contractId || '').match(/^([A-Za-z]+)/);

  return m ? m[1].toUpperCase() : '';

}



function mapToInstrument(contractId, contractCode, varieties, varietyMap) {

  const code = String(contractCode || '').trim().toUpperCase();

  if (code && varietyMap.toInst.has(code)) {

    const id = varietyMap.toInst.get(code);

    if (!SKIP_VARIETIES.has(code)) return id;

    return null;

  }

  const v = varietyFromContractId(contractId);

  if (!v || SKIP_VARIETIES.has(v)) return null;

  return varietyMap.toInst.get(v) || null;

}



function formatDateYmd(ymd) {

  const s = String(ymd || '').trim();

  if (s.length !== 8) return null;

  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

}



function dateFromZipName(zipPath) {

  const m = path.basename(zipPath).match(/future_price(\d{8})/i);

  return m ? formatDateYmd(m[1]) : null;

}



function zipEntryName(zipPath) {

  return `${path.basename(zipPath, '.zip')}.txt`;

}



function getTradingDir() {

  if (outputDirOverride) {

    fs.mkdirSync(outputDirOverride, { recursive: true });

    return outputDirOverride;

  }

  const dataDir = getDataDir() || path.join('E:\\FanchengFinance', 'data');

  const dir = path.join(dataDir, 'history', 'trading');

  fs.mkdirSync(dir, { recursive: true });

  return dir;

}



function getProgressDir() {

  if (progressDirOverride) return progressDirOverride;

  return getTradingDir();

}



function getProgressPath() {

  const dir = getProgressDir();

  fs.mkdirSync(dir, { recursive: true });

  return path.join(dir, PROGRESS_FILE);

}



/** 跨盘符匹配同一 zip（E:/D: 缓存路径归一化） */

function zipRelKey(zipPath) {

  const norm = String(zipPath || '').replace(/\\/g, '/').toLowerCase();

  const m = norm.match(/(\d{4}\/future_price\d{6}(?:\/future_price\d{8})?\/future_price\d{8}\.zip)$/);

  return m ? m[1] : norm;

}



function loadProgress() {

  const p = getProgressPath();

  if (!fs.existsSync(p)) return { processedZips: [], stats: {} };

  try {

    return JSON.parse(fs.readFileSync(p, 'utf8'));

  } catch {

    return { processedZips: [], stats: {} };

  }

}



function saveProgressAtomic(progress) {

  const p = getProgressPath();

  const tmp = `${p}.tmp.${process.pid}`;

  fs.writeFileSync(tmp, JSON.stringify(progress), 'utf8');

  fs.renameSync(tmp, p);

}



function loadInstrumentFile(outDir, instrumentId) {

  const fp = path.join(outDir, `${instrumentId}.json`);

  if (!fs.existsSync(fp)) {

    return { instrumentId, source: 'tick-zips', series: [], dates: new Set() };

  }

  try {

    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));

    const series = Array.isArray(data) ? data : data.series || [];

    const dates = new Set(series.map((r) => r.date));

    return {

      instrumentId,

      source: data.source || 'tick-zips',

      importedAt: data.importedAt,

      series,

      dates,

    };

  } catch {

    return { instrumentId, source: 'tick-zips', series: [], dates: new Set() };

  }

}



function writeInstrumentFile(outDir, payload, dryRun) {

  const series = payload.series;

  if (series.length > 1 && series[series.length - 2].date > series[series.length - 1].date) {

    series.sort((a, b) => a.date.localeCompare(b.date));

  }

  const out = {

    instrumentId: payload.instrumentId,

    source: payload.source || 'tick-zips',

    importedAt: payload.importedAt || new Date().toISOString(),

    rowCount: series.length,

    from: series[0]?.date || null,

    to: series[series.length - 1]?.date || null,

    series: series.map((r) => ({

      date: r.date,

      open: r.open,

      high: r.high,

      low: r.low,

      close: r.close,

      price: r.close,

      volume: r.volume ?? null,

      oi: r.oi ?? null,

      openInterest: r.oi ?? null,

    })),

  };

  if (!dryRun) {

    fs.writeFileSync(path.join(outDir, `${payload.instrumentId}.json`), JSON.stringify(out), 'utf8');

  }

  return out;

}



function discoverZips(baseDir) {

  const zips = [];

  if (!fs.existsSync(baseDir)) return zips;

  const years = fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name));

  for (const yr of years) {

    const yearPath = path.join(baseDir, yr.name);

    for (const monthDir of fs.readdirSync(yearPath, { withFileTypes: true })) {

      if (!monthDir.isDirectory() || !/^future_price\d{6}$/i.test(monthDir.name)) continue;

      const monthPath = path.join(yearPath, monthDir.name);

      for (const f of fs.readdirSync(monthPath)) {

        if (/^future_price\d{8}\.zip$/i.test(f)) zips.push(path.join(monthPath, f));

      }

      for (const sub of fs.readdirSync(monthPath, { withFileTypes: true })) {

        if (!sub.isDirectory() || !/^future_price\d{8}$/i.test(sub.name)) continue;

        const subPath = path.join(monthPath, sub.name);

        for (const f of fs.readdirSync(subPath)) {

          if (/^future_price\d{8}\.zip$/i.test(f)) zips.push(path.join(subPath, f));

        }

      }

    }

  }

  return zips.sort();

}



/** 多 base 合并：同 zipRelKey 优先 fastBase（如 D: 缓存） */

function discoverZipsHybrid(fastBase, slowBase) {

  const byKey = new Map();

  if (slowBase && fs.existsSync(slowBase)) {

    for (const z of discoverZips(slowBase)) byKey.set(zipRelKey(z), z);

  }

  if (fastBase && fs.existsSync(fastBase)) {

    for (const z of discoverZips(fastBase)) byKey.set(zipRelKey(z), z);

  }

  return [...byKey.values()].sort();

}



function summarizeDiscovery(zips) {

  const byMonth = {};

  for (const z of zips) {

    const parent = path.basename(path.dirname(z));

    const key = /^future_price\d{6}$/i.test(parent) ? parent : path.basename(path.dirname(path.dirname(z)));

    byMonth[key] = (byMonth[key] || 0) + 1;

  }

  return byMonth;

}



function isValidTickTxt(txtPath) {

  try {

    const st = fs.statSync(txtPath);

    if (!st.isFile() || st.size < 64) return false;

    const fd = fs.openSync(txtPath, 'r');

    const buf = Buffer.alloc(Math.min(512, st.size));

    const n = fs.readSync(fd, buf, 0, buf.length, 0);

    fs.closeSync(fd);

    return buf.slice(0, n).toString('utf8').includes('CONTRACTID');

  } catch {

    return false;

  }

}



function resolveTxtForZip(zipPath, stagingDir) {

  const base = path.basename(zipPath, '.zip');

  const preExtracted = path.join(path.dirname(zipPath), base, `${base}.txt`);

  if (isValidTickTxt(preExtracted)) return preExtracted;



  const dayDir = path.join(stagingDir, base);

  fs.mkdirSync(dayDir, { recursive: true });

  const cached = fs.readdirSync(dayDir).find((f) => /^future_price.*\.txt$/i.test(f));

  if (cached) {

    const cachedPath = path.join(dayDir, cached);

    if (isValidTickTxt(cachedPath)) return cachedPath;

  }



  execFileSync('tar', ['-xf', zipPath, '-C', dayDir], { stdio: 'pipe', windowsHide: true });

  const txt = fs.readdirSync(dayDir).find((f) => /^future_price.*\.txt$/i.test(f));

  if (!txt) throw new Error(`zip 内无 txt: ${zipPath}`);

  const txtPath = path.join(dayDir, txt);

  if (!isValidTickTxt(txtPath)) throw new Error(`解压 txt 无效: ${txtPath}`);

  return txtPath;

}



function processTickLine(line, ctx) {

  if (!line.trim()) return;

  if (!ctx.header) {

    ctx.header = line.split('\t');

    ctx.col = {

      contractId: ctx.header.indexOf('CONTRACTID'),

      lastPx: ctx.header.indexOf('LASTPX'),

      tq: ctx.header.indexOf('TQ'),

      openInts: ctx.header.indexOf('OPENINTS'),

      settlement: ctx.header.indexOf('SETTLEMENTPX'),

      contractCode: ctx.header.indexOf('CONTRACTCODE'),

      varieties: ctx.header.indexOf('VARIETIES'),

    };

    return;

  }



  const parts = line.split('\t');

  const get = (idx) => (idx >= 0 && idx < parts.length ? parts[idx] : '');

  const contractId = get(ctx.col.contractId);

  const instId = mapToInstrument(contractId, get(ctx.col.contractCode), get(ctx.col.varieties), ctx.varietyMap);

  if (!instId) {

    ctx.skipped += 1;

    return;

  }



  const px = parseFloat(get(ctx.col.lastPx));

  if (!Number.isFinite(px) || px <= 0) return;



  ctx.tickRows += 1;

  const tq = parseFloat(get(ctx.col.tq)) || 0;

  const oi = parseFloat(get(ctx.col.openInts));

  const settle = parseFloat(get(ctx.col.settlement));



  let bucket = ctx.byContract.get(contractId);

  if (!bucket) {

    bucket = {

      instrumentId: instId,

      open: px,

      high: px,

      low: px,

      close: px,

      volume: 0,

      oi: Number.isFinite(oi) ? oi : null,

      settlement: Number.isFinite(settle) && settle > 0 ? settle : null,

    };

    ctx.byContract.set(contractId, bucket);

  } else {

    bucket.high = Math.max(bucket.high, px);

    bucket.low = Math.min(bucket.low, px);

    bucket.close = px;

    if (Number.isFinite(oi)) bucket.oi = oi;

    if (Number.isFinite(settle) && settle > 0) bucket.settlement = settle;

  }

  bucket.volume += tq;

}



function finalizeTickCtx(ctx, tradeDate) {

  const bestByInst = new Map();

  for (const bucket of ctx.byContract.values()) {

    const prev = bestByInst.get(bucket.instrumentId);

    if (!prev || bucket.volume > prev.volume) bestByInst.set(bucket.instrumentId, bucket);

  }



  const dailyBars = [];

  for (const bucket of bestByInst.values()) {

    const close = bucket.settlement || bucket.close;

    dailyBars.push({

      date: tradeDate,

      instrumentId: bucket.instrumentId,

      open: +bucket.open.toFixed(4),

      high: +bucket.high.toFixed(4),

      low: +bucket.low.toFixed(4),

      close: +close.toFixed(4),

      volume: Math.round(bucket.volume),

      oi: bucket.oi != null ? Math.round(bucket.oi) : null,

    });

  }

  return { dailyBars, tickRows: ctx.tickRows, skipped: ctx.skipped };

}



function createTickParser(tradeDate, varietyMap) {

  const ctx = {

    varietyMap,

    byContract: new Map(),

    header: null,

    col: {},

    tickRows: 0,

    skipped: 0,

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

      processTickLine(line, ctx);

    }

    if (carry.length > MAX_LINE) carry = carry.slice(-MAX_LINE);

  };



  const finish = () => {

    if (carry.trim() && carry.length <= MAX_LINE) processTickLine(carry, ctx);

    return finalizeTickCtx(ctx, tradeDate);

  };



  return { feedChunk, finish };

}



function parseTickFile(txtPath, tradeDate, varietyMap) {

  return new Promise((resolve, reject) => {

    const parser = createTickParser(tradeDate, varietyMap);

    const stream = fs.createReadStream(txtPath, { encoding: 'utf8', highWaterMark: 4 * 1024 * 1024 });

    stream.on('data', (chunk) => parser.feedChunk(chunk));

    stream.on('end', () => resolve(parser.finish()));

    stream.on('error', reject);

  });

}



function parseTickFromZipStream(zipPath, tradeDate, varietyMap) {

  const entry = zipEntryName(zipPath);

  return new Promise((resolve, reject) => {

    const parser = createTickParser(tradeDate, varietyMap);

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



async function processOneZip(zipPath, workerId, varietyMap, stagingRoot, fallbackStaging) {

  const tradeDate = dateFromZipName(zipPath);

  if (!tradeDate) {

    return { zipPath, tradeDate: null, bars: [], tickRows: 0, skipped: 0, error: '无法解析日期', mode: null };

  }

  try {

    try {

      const parsed = await parseTickFromZipStream(zipPath, tradeDate, varietyMap);

      return {

        zipPath, tradeDate, bars: parsed.dailyBars, tickRows: parsed.tickRows, skipped: parsed.skipped, error: null, mode: 'stream',

      };

    } catch (streamErr) {

      const stagingDir = path.join(stagingRoot, `w${workerId}`);

      fs.mkdirSync(stagingDir, { recursive: true });

      try {

        const txtPath = resolveTxtForZip(zipPath, stagingDir);

        const parsed = await parseTickFile(txtPath, tradeDate, varietyMap);

        return {

          zipPath, tradeDate, bars: parsed.dailyBars, tickRows: parsed.tickRows, skipped: parsed.skipped, error: null, mode: 'staging',

        };

      } catch (stagingErr) {

        if (fallbackStaging && fallbackStaging !== stagingRoot) {

          const fbDir = path.join(fallbackStaging, `w${workerId}`);

          fs.mkdirSync(fbDir, { recursive: true });

          const txtPath = resolveTxtForZip(zipPath, fbDir);

          const parsed = await parseTickFile(txtPath, tradeDate, varietyMap);

          return {

            zipPath, tradeDate, bars: parsed.dailyBars, tickRows: parsed.tickRows, skipped: parsed.skipped, error: null, mode: 'fallback',

          };

        }

        throw new Error(`stream: ${streamErr.message}; staging: ${stagingErr.message}`);

      }

    }

  } catch (err) {

    return { zipPath, tradeDate, bars: [], tickRows: 0, skipped: 0, error: err.message, mode: null };

  }

}



function mergeBars(instrumentCache, outDir, bars, dryRun, pendingFlush) {

  const touched = new Set();

  for (const bar of bars) {

    let rec = instrumentCache.get(bar.instrumentId);

    if (!rec) {

      rec = loadInstrumentFile(outDir, bar.instrumentId);

      instrumentCache.set(bar.instrumentId, rec);

    }

    if (rec.dates.has(bar.date)) continue;

    rec.series.push(bar);

    rec.dates.add(bar.date);

    touched.add(bar.instrumentId);

    pendingFlush.add(bar.instrumentId);

  }

  return touched.size;

}



function flushInstruments(instrumentCache, outDir, pendingFlush, dryRun) {

  if (dryRun || pendingFlush.size === 0) return;

  for (const id of pendingFlush) {

    const rec = instrumentCache.get(id);

    if (rec) writeInstrumentFile(outDir, rec, false);

  }

  pendingFlush.clear();

}



function createMergeQueue() {

  const instChains = new Map();

  const runForInstruments = (instrumentIds, fn) => {

    const ids = instrumentIds.length ? instrumentIds : ['__global__'];

    const waits = ids.map((id) => instChains.get(id) || Promise.resolve());

    const batch = Promise.all(waits)

      .then(fn)

      .catch((err) => {

        console.error('[tick-convert] merge error:', err.message);

      });

    for (const id of ids) instChains.set(id, batch);

    return batch;

  };

  return runForInstruments;

}



function runWorkerPool(zips, workers, workerFn) {

  return new Promise((resolve, reject) => {

    let nextIdx = 0;

    let active = 0;

    let failed = false;



    const pump = () => {

      while (!failed && active < workers && nextIdx < zips.length) {

        const zipIndex = nextIdx++;

        active += 1;

        workerFn(zips[zipIndex], zipIndex % workers)

          .then(() => {

            active -= 1;

            if (nextIdx >= zips.length && active === 0) resolve();

            else pump();

          })

          .catch((err) => {

            failed = true;

            reject(err);

          });

      }

    };

    pump();

  });

}



async function runConversion({ base, fallbackBase, staging, dryRun, limit, force, workers, progressEvery, flushEvery }) {

  const varietyMap = buildVarietyMap();

  const outDir = getTradingDir();

  const stagingRoot = staging || DEFAULT_STAGING;

  const fallbackStaging = stagingRoot !== FALLBACK_STAGING ? FALLBACK_STAGING : null;

  try {

    fs.mkdirSync(stagingRoot, { recursive: true });

  } catch {

    console.warn(`[tick-convert] staging ${stagingRoot} 不可用，回退 ${FALLBACK_STAGING}`);

  }



  const allZips = fallbackBase ? discoverZipsHybrid(base, fallbackBase) : discoverZips(base);

  const byMonth = summarizeDiscovery(allZips);

  const fromFast = fallbackBase ? allZips.filter((z) => z.toLowerCase().startsWith(String(base).toLowerCase())).length : 0;

  console.log(`[tick-convert] 发现 ${allZips.length} 个 zip，月份文件夹 ${Object.keys(byMonth).length} 个${fallbackBase ? ` (D:缓存 ${fromFast})` : ''}`);

  for (const [m, c] of Object.entries(byMonth).sort()) console.log(`  ${m}: ${c} zips`);



  const progress = loadProgress();

  const doneSet = new Set((progress.processedZips || []).map(zipRelKey));

  let zips = allZips;

  if (!force) zips = zips.filter((z) => !doneSet.has(zipRelKey(z)));

  if (limit > 0) zips = zips.slice(0, limit);



  const pendingTotal = force ? allZips.length : allZips.filter((z) => !doneSet.has(zipRelKey(z))).length;
  console.log(`[tick-convert] 待处理 ${zips.length}${limit > 0 ? ` (limit=${limit})` : ''}，队列剩余 ${pendingTotal}，已完成 ${doneSet.size}`);

  console.log(`[tick-convert] workers=${workers} progress-every=${progressEvery} flush-every=${flushEvery}`);

  console.log(`[tick-convert] 输出: ${outDir}`);

  console.log(`[tick-convert] 进度: ${getProgressPath()}`);

  console.log(`[tick-convert] staging: ${stagingRoot} (stream 优先，无落盘)`);



  const instrumentCache = new Map();

  const pendingFlush = new Set();

  const enqueueMerge = createMergeQueue();

  const stats = {

    zipsProcessed: 0,

    zipsFailed: 0,

    tickRows: 0,

    skippedRows: 0,

    dailyBars: 0,

    streamOk: 0,

    stagingOk: 0,

    errors: [],

  };



  const startedAt = Date.now();

  let completed = 0;



  const processZip = (zipPath, workerId) =>

    processOneZip(zipPath, workerId, varietyMap, stagingRoot, fallbackStaging).then((r) => {

      const touchedIds = r.error ? [] : [...new Set(r.bars.map((b) => b.instrumentId))];

      enqueueMerge(touchedIds, async () => {

        if (r.error) {

          stats.zipsFailed += 1;

          stats.errors.push({ zip: r.zipPath, error: r.error });

          console.error(`[tick-convert] FAIL ${r.zipPath}: ${r.error}`);

          return;

        }



        if (r.mode === 'stream') stats.streamOk += 1;

        else if (r.mode) stats.stagingOk += 1;



        const touched = mergeBars(instrumentCache, outDir, r.bars, dryRun, pendingFlush);

        stats.tickRows += r.tickRows;

        stats.skippedRows += r.skipped;

        stats.dailyBars += r.bars.length;

        stats.zipsProcessed += 1;

        completed += 1;



        if (!dryRun) {

          const zKey = zipRelKey(r.zipPath);

          doneSet.add(zKey);

          const already = (progress.processedZips || []).some((p) => zipRelKey(p) === zKey);

          if (!already) progress.processedZips.push(r.zipPath);

        }



        if (completed % LOG_EVERY === 0 || completed === zips.length) {

          const elapsedMin = (Date.now() - startedAt) / 60000;

          const rate = elapsedMin > 0 ? (completed / elapsedMin).toFixed(2) : '—';

          console.log(

            `[tick-convert] ${completed}/${zips.length} ${r.tradeDate} mode=${r.mode || '?'} bars=${r.bars.length} touched=${touched} rate=${rate} zip/min`

          );

        }



        const shouldFlush = pendingFlush.size > 0 && (completed % flushEvery === 0 || completed === zips.length);

        if (shouldFlush) flushInstruments(instrumentCache, outDir, pendingFlush, dryRun);



        if (!dryRun && (completed % progressEvery === 0 || completed === zips.length)) {

          progress.stats = {

            ...stats,

            lastZip: r.zipPath,

            updatedAt: new Date().toISOString(),

          };

          saveProgressAtomic(progress);

        }

      });

      return r;

    });



  await runWorkerPool(zips, workers, processZip);

  await enqueueMerge([], async () => {});



  const elapsedMin = (Date.now() - startedAt) / 60000;

  const rate = stats.zipsProcessed > 0 && elapsedMin > 0 ? stats.zipsProcessed / elapsedMin : 0;



  return { stats, instrumentCache, byMonth, totalZips: allZips.length, benchmark: { elapsedMin, rate } };

}



function syncTradingToKlines(dryRun) {

  const userData = getUserDataDir() || path.join(process.cwd(), 'userData');

  diskCache.init(userData);

  const tradingDir = getTradingDir();

  const files = fs.readdirSync(tradingDir).filter((f) => f.endsWith('.json') && f !== PROGRESS_FILE);

  let merged = 0;



  for (const f of files) {

    const instrumentId = f.replace(/\.json$/, '');

    const data = JSON.parse(fs.readFileSync(path.join(tradingDir, f), 'utf8'));

    const series = Array.isArray(data) ? data : data.series || [];

    if (!series.length) continue;



    const key = `klines/commodity-${String(instrumentId).toLowerCase()}-day.json`;

    const cached = diskCache.readStale(key);

    const existing = cached?.data?.klines || [];

    const byDate = new Map(existing.map((b) => [String(b.date).slice(0, 10), b]));



    for (const row of series) {

      const d = String(row.date).slice(0, 10);

      const bar = {

        date: d,

        open: row.open ?? row.price,

        high: row.high ?? row.price,

        low: row.low ?? row.price,

        close: row.close ?? row.price,

        volume: row.volume ?? 0,

      };

      if (row.oi != null || row.openInterest != null) {

        bar.openInterest = row.oi ?? row.openInterest;

      }

      if (!byDate.has(d) || (byDate.get(d).volume || 0) < bar.volume) byDate.set(d, bar);

    }



    const klines = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    if (!dryRun) {

      diskCache.write(key, {

        data: {

          id: instrumentId,

          name: instrumentId,

          timeframe: 'day',

          source: 'tick-zips-sync',

          klines,

        },

      });

    }

    merged += 1;

    console.log(`[sync-klines] ${instrumentId}: ${klines.length} bars`);

  }

  return merged;

}



function printFinalStats(instrumentCache) {

  const instruments = [...instrumentCache.values()];

  let minDate = null;

  let maxDate = null;

  let totalDays = 0;



  const outDir = getTradingDir();

  for (const f of fs.readdirSync(outDir)) {

    if (!f.endsWith('.json') || f === PROGRESS_FILE) continue;

    try {

      const data = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));

      const series = Array.isArray(data) ? data : data.series || [];

      totalDays += series.length;

      for (const row of series) {

        if (!minDate || row.date < minDate) minDate = row.date;

        if (!maxDate || row.date > maxDate) maxDate = row.date;

      }

    } catch {

      // skip

    }

  }



  const instCount = fs.readdirSync(outDir).filter((f) => f.endsWith('.json') && f !== PROGRESS_FILE).length;

  console.log('\n[tick-convert] === 汇总 ===');

  console.log(`  品种文件: ${instCount}`);

  console.log(`  总交易日行: ${totalDays}`);

  console.log(`  日期范围: ${minDate || '—'} ~ ${maxDate || '—'}`);

  if (instruments.length) {

    console.log(`  本次写入品种: ${instruments.length}`);

  }

}



async function main() {

  const opts = parseArgs();

  if (opts.output) outputDirOverride = path.resolve(opts.output);

  if (opts.progressDir) progressDirOverride = path.resolve(opts.progressDir);



  if (opts.syncKlines) {

    const n = syncTradingToKlines(opts.dryRun);

    console.log(`[sync-klines] 完成 ${n} 个品种${opts.dryRun ? ' (dry-run)' : ''}`);

    return;

  }



  if (!fs.existsSync(opts.base)) {

    console.error(`基础路径不存在: ${opts.base}`);

    process.exit(1);

  }



  const { stats, instrumentCache, totalZips, benchmark } = await runConversion(opts);

  printFinalStats(instrumentCache);



  console.log('\n[tick-convert] 处理统计:');

  console.log(`  zip 总数: ${totalZips}`);

  console.log(`  已处理: ${stats.zipsProcessed}`);

  console.log(`  失败: ${stats.zipsFailed}`);

  console.log(`  stream 模式: ${stats.streamOk}`);

  console.log(`  staging 回退: ${stats.stagingOk}`);

  console.log(`  tick 行: ${stats.tickRows}`);

  console.log(`  跳过行(非商品): ${stats.skippedRows}`);

  console.log(`  日 K 条: ${stats.dailyBars}`);

  if (benchmark.rate > 0) {

    console.log(`  吞吐: ${benchmark.rate.toFixed(2)} zip/min (${benchmark.elapsedMin.toFixed(2)} min)`);

    const remaining = totalZips - (loadProgress().processedZips?.length || 0);

    if (remaining > 0) {

      const etaH = remaining / benchmark.rate / 60;

      console.log(`  预估剩余 ETA: ${etaH.toFixed(1)} h (${remaining} zips @ ${benchmark.rate.toFixed(2)}/min)`);

    }

  }

  if (stats.errors.length) {

    console.log(`  错误样例 (前5):`);

    for (const e of stats.errors.slice(0, 5)) console.log(`    ${e.zip}: ${e.error}`);

  }



  if (!opts.dryRun && stats.zipsProcessed > 0 && !opts.benchmark) {

    console.log('\n[tick-convert] 正在同步到 klines 缓存…');

    syncTradingToKlines(false);

  }

}



if (require.main === module) {

  main().catch((err) => {

    console.error(err);

    process.exit(1);

  });

}



module.exports = {

  SKIP_VARIETIES,

  buildVarietyMap,

  mapToInstrument,

  varietyFromContractId,

  formatDateYmd,

  dateFromZipName,

  zipEntryName,

  zipRelKey,

  discoverZips,

  discoverZipsHybrid,

  parseTickFromZipStream,

  parseTickFile,

  resolveTxtForZip,

  runWorkerPool,

  createMergeQueue,

  defaultWorkers,

};


