/**
 * 期货 tick zip → 日 K 聚合 → history/trading/{instrument}.json
 *
 * 用法:
 *   node scripts/convert-tick-zips-to-daily.js [--base E:\BaiduNetdiskDownload] [--dry-run] [--limit N]
 *   node scripts/convert-tick-zips-to-daily.js --sync-klines   # 将 trading/*.json 合并进 klines 缓存
 *
 * zip 内: future_priceYYYYMMDD.txt (TSV tick)
 * 按品种主力合约（当日成交量最大）聚合 OHLCV + OI
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const { getDataDir, getUserDataDir } = require('../services/data-paths');
const { getAllCommodities } = require('../services/commodities-catalog');
const diskCache = require('../services/disk-cache');

const DEFAULT_BASE = 'E:\\BaiduNetdiskDownload';
const STAGING_DIR = path.join('E:\\FanchengFinance', 'data', 'history', 'tick-staging');
const PROGRESS_FILE = 'tick-convert-progress.json';
const LOG_EVERY = 10;

/** 股指/国债 — 不在 74 商品品种内 */
const SKIP_VARIETIES = new Set(['IC', 'IF', 'IH', 'IM', 'T', 'TF', 'TS']);

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    base: (() => {
      const i = args.indexOf('--base');
      return i >= 0 ? args[i + 1] : DEFAULT_BASE;
    })(),
    dryRun: args.includes('--dry-run'),
    limit: (() => {
      const i = args.indexOf('--limit');
      return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 0;
    })(),
    syncKlines: args.includes('--sync-klines'),
    force: args.includes('--force'),
  };
}

function buildVarietyMap() {
  const toInst = new Map();
  const knownIds = new Set();
  for (const item of getAllCommodities()) {
    knownIds.add(item.id);
    const sym = String(item.sinaSymbol || '').replace(/0$/, '').toUpperCase();
    if (sym) toInst.set(sym, item.id);
    toInst.set(String(item.id).toUpperCase(), item.id);
    toInst.set(String(item.id).toLowerCase(), item.id);
  }
  return { toInst, knownIds };
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

function getTradingDir() {
  const dataDir = getDataDir() || path.join('E:\\FanchengFinance', 'data');
  const dir = path.join(dataDir, 'history', 'trading');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getProgressPath() {
  return path.join(getTradingDir(), PROGRESS_FILE);
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

function saveProgress(progress) {
  fs.writeFileSync(getProgressPath(), JSON.stringify(progress, null, 2), 'utf8');
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
  const series = payload.series.sort((a, b) => a.date.localeCompare(b.date));
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
    fs.writeFileSync(path.join(outDir, `${payload.instrumentId}.json`), JSON.stringify(out, null, 2), 'utf8');
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
      // 2017 等嵌套日目录
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

function summarizeDiscovery(zips) {
  const byMonth = {};
  for (const z of zips) {
    const parent = path.basename(path.dirname(z));
    const key = /^future_price\d{6}$/i.test(parent) ? parent : path.basename(path.dirname(path.dirname(z)));
    byMonth[key] = (byMonth[key] || 0) + 1;
  }
  return byMonth;
}

function resolveTxtForZip(zipPath, stagingDir) {
  const base = path.basename(zipPath, '.zip');
  const preExtracted = path.join(path.dirname(zipPath), base, `${base}.txt`);
  if (fs.existsSync(preExtracted)) return preExtracted;

  const dayDir = path.join(stagingDir, base);
  fs.mkdirSync(dayDir, { recursive: true });
  const cached = fs.readdirSync(dayDir).find((f) => /^future_price.*\.txt$/i.test(f));
  if (cached) return path.join(dayDir, cached);

  execFileSync('tar', ['-xf', zipPath, '-C', dayDir], { stdio: 'pipe', windowsHide: true });
  const txt = fs.readdirSync(dayDir).find((f) => /^future_price.*\.txt$/i.test(f));
  if (!txt) throw new Error(`zip 内无 txt: ${zipPath}`);
  return path.join(dayDir, txt);
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

function parseTickFile(txtPath, tradeDate, varietyMap, stats) {
  const MAX_LINE = 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const ctx = {
      varietyMap,
      byContract: new Map(),
      header: null,
      col: {},
      tickRows: 0,
      skipped: 0,
    };
    let carry = '';
    const stream = fs.createReadStream(txtPath, { encoding: 'utf8', highWaterMark: 2 * 1024 * 1024 });

    stream.on('data', (chunk) => {
      carry += chunk;
      let nl;
      while ((nl = carry.indexOf('\n')) >= 0) {
        let line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.length > MAX_LINE) continue;
        processTickLine(line, ctx);
      }
      if (carry.length > MAX_LINE) carry = carry.slice(-MAX_LINE);
    });

    stream.on('end', () => {
      if (carry.trim() && carry.length <= MAX_LINE) processTickLine(carry, ctx);
      stats.tickRows += ctx.tickRows;
      stats.skippedRows += ctx.skipped;

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
      resolve(dailyBars);
    });

    stream.on('error', reject);
  });
}

function mergeBars(instrumentCache, bars, dryRun) {
  const touched = new Set();
  for (const bar of bars) {
    let rec = instrumentCache.get(bar.instrumentId);
    if (!rec) {
      rec = loadInstrumentFile(getTradingDir(), bar.instrumentId);
      instrumentCache.set(bar.instrumentId, rec);
    }
    if (rec.dates.has(bar.date)) continue;
    rec.series.push(bar);
    rec.dates.add(bar.date);
    touched.add(bar.instrumentId);
  }
  if (!dryRun) {
    for (const id of touched) {
      writeInstrumentFile(getTradingDir(), instrumentCache.get(id), false);
    }
  }
  return touched.size;
}

async function runConversion({ base, dryRun, limit, force }) {
  const varietyMap = buildVarietyMap();
  const outDir = getTradingDir();
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  const allZips = discoverZips(base);
  const byMonth = summarizeDiscovery(allZips);
  console.log(`[tick-convert] 发现 ${allZips.length} 个 zip，月份文件夹 ${Object.keys(byMonth).length} 个`);
  for (const [m, c] of Object.entries(byMonth).sort()) console.log(`  ${m}: ${c} zips`);

  const progress = loadProgress();
  const doneSet = new Set(progress.processedZips || []);
  let zips = allZips;
  if (!force) zips = zips.filter((z) => !doneSet.has(z));
  if (limit > 0) zips = zips.slice(0, limit);

  console.log(`[tick-convert] 待处理 ${zips.length}（已跳过 ${allZips.length - zips.length}）`);
  console.log(`[tick-convert] 输出: ${outDir}`);
  console.log(`[tick-convert] staging: ${STAGING_DIR}`);

  const instrumentCache = new Map();
  const stats = {
    zipsProcessed: 0,
    zipsFailed: 0,
    tickRows: 0,
    skippedRows: 0,
    dailyBars: 0,
    errors: [],
  };

  for (let i = 0; i < zips.length; i += 1) {
    const zipPath = zips[i];
    const tradeDate = dateFromZipName(zipPath);
    if (!tradeDate) {
      stats.errors.push({ zip: zipPath, error: '无法解析日期' });
      stats.zipsFailed += 1;
      continue;
    }

    try {
      const txtPath = resolveTxtForZip(zipPath, STAGING_DIR);
      const bars = await parseTickFile(txtPath, tradeDate, varietyMap, stats);
      const touched = mergeBars(instrumentCache, bars, dryRun);
      stats.dailyBars += bars.length;
      stats.zipsProcessed += 1;
      if (!dryRun) {
        doneSet.add(zipPath);
        progress.processedZips = [...doneSet];
        progress.stats = {
          ...stats,
          lastZip: zipPath,
          updatedAt: new Date().toISOString(),
        };
        saveProgress(progress);
      }
      if ((i + 1) % LOG_EVERY === 0 || i === zips.length - 1) {
        console.log(
          `[tick-convert] ${i + 1}/${zips.length} ${tradeDate} bars=${bars.length} touched=${touched} ticks=${stats.tickRows}`
        );
      }
    } catch (err) {
      stats.zipsFailed += 1;
      stats.errors.push({ zip: zipPath, error: err.message });
      console.error(`[tick-convert] FAIL ${zipPath}: ${err.message}`);
    }
  }

  return { stats, instrumentCache, byMonth, totalZips: allZips.length };
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

  if (opts.syncKlines) {
    const n = syncTradingToKlines(opts.dryRun);
    console.log(`[sync-klines] 完成 ${n} 个品种${opts.dryRun ? ' (dry-run)' : ''}`);
    return;
  }

  if (!fs.existsSync(opts.base)) {
    console.error(`基础路径不存在: ${opts.base}`);
    process.exit(1);
  }

  const { stats, instrumentCache, totalZips } = await runConversion(opts);
  printFinalStats(instrumentCache);

  console.log('\n[tick-convert] 处理统计:');
  console.log(`  zip 总数: ${totalZips}`);
  console.log(`  已处理: ${stats.zipsProcessed}`);
  console.log(`  失败: ${stats.zipsFailed}`);
  console.log(`  tick 行: ${stats.tickRows}`);
  console.log(`  跳过行(非商品): ${stats.skippedRows}`);
  console.log(`  日 K 条: ${stats.dailyBars}`);
  if (stats.errors.length) {
    console.log(`  错误样例 (前5):`);
    for (const e of stats.errors.slice(0, 5)) console.log(`    ${e.zip}: ${e.error}`);
  }

  if (!opts.dryRun && stats.zipsProcessed > 0) {
    console.log('\n[tick-convert] 正在同步到 klines 缓存…');
    syncTradingToKlines(false);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
