#!/usr/bin/env node
/**
 * stateKey 分桶：三路合成权重 walk-forward 网格校准（真实日 K，无 synthetic）
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=F node scripts/calibrate-intel-statekey-weights.js
 *   ... --days 90 --min-n 40 --quick
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) {
  process.env.FANCHENG_DATA_DRIVE = fs.existsSync('F:/FanchengFinance/data') ? 'F' : 'E';
}
process.env.FANCHENG_APP_ROOT = process.env.FANCHENG_APP_ROOT || 'F:/FanchengFinance';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();

const { getDataDir } = require('../services/data-paths');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const backtest = require('../services/commodity-outlook-backtest');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { getCommodityMeta } = require('../services/commodities-catalog');
const {
  WEIGHTS_VERSION,
  DEFAULT_MIN_N,
  DEFAULT_MIN_LIFT_PP,
  normalizeTriple,
  coarseStateKey,
  saveStateKeyWeights,
  weightsPath,
} = require('../services/intel-statekey-weights');

const DAYS = (() => {
  const i = process.argv.indexOf('--days');
  if (i >= 0) return Math.max(30, Math.min(250, Number(process.argv[i + 1]) || 60));
  return 60;
})();
const MIN_N = (() => {
  const i = process.argv.indexOf('--min-n');
  if (i >= 0) return Math.max(20, Math.min(200, Number(process.argv[i + 1]) || DEFAULT_MIN_N));
  return DEFAULT_MIN_N;
})();
const MIN_LIFT = (() => {
  const i = process.argv.indexOf('--min-lift');
  if (i >= 0) return Math.max(0, Math.min(10, Number(process.argv[i + 1]) || DEFAULT_MIN_LIFT_PP));
  return DEFAULT_MIN_LIFT_PP;
})();
const STRIDE = (() => {
  const i = process.argv.indexOf('--stride');
  if (i >= 0) return Math.max(1, Math.min(5, Number(process.argv[i + 1]) || 2));
  return 2; // 隔日采样：加速且仍用真实 bar
})();
const QUICK = process.argv.includes('--quick');
const QUICK_IDS = [
  'cu', 'al', 'zn', 'ni', 'rb', 'i', 'au', 'ag', 'sc', 'ta', 'ma', 'm', 'y', 'p', 'c', 'cs',
  'si', 'ao', 'lc', 'pg', 'v', 'ur', 'b', 'sh', 'lh', 'ec',
];

const DIR_TH = 0.05;
const EQUAL = normalizeTriple(1 / 3, 1 / 3, 1 / 3);

function* weightGrid(step = 0.1) {
  for (let pw = 0.1; pw <= 0.8 + 1e-9; pw = +(pw + step).toFixed(2)) {
    for (let aw = 0.1; aw <= 0.8 - pw + 1e-9; aw = +(aw + step).toFixed(2)) {
      const fw = +(1 - pw - aw).toFixed(2);
      if (fw >= 0.1 - 1e-9) yield normalizeTriple(pw, aw, fw);
    }
  }
}

function dirFromScore(score) {
  if (score == null || !Number.isFinite(score)) return null;
  if (score > DIR_TH) return 'bullish';
  if (score < -DIR_TH) return 'bearish';
  return 'neutral';
}

function blendScore(p, a, f, w) {
  return (p ?? 0) * w.philosophyWeight + (a ?? 0) * w.adaptiveWeight + (f ?? 0) * w.factorWeight;
}

function evalWeights(rows, w) {
  let hits = 0;
  let n = 0;
  for (const r of rows) {
    const score = blendScore(r.philosophyScore, r.adaptiveScore, r.factorComposite, w);
    const pred = dirFromScore(score);
    if (!pred || pred === 'neutral') continue;
    if (r.actualDir !== 'bullish' && r.actualDir !== 'bearish') continue;
    n += 1;
    if (pred === r.actualDir) hits += 1;
  }
  return {
    hits,
    n,
    hitRate: n ? +((hits / n) * 100).toFixed(1) : null,
    hitDisplay: n ? `${((hits / n) * 100).toFixed(1)}% (${hits}/${n})` : '暂无',
  };
}

function bestWeights(rows) {
  let best = null;
  for (const w of weightGrid(0.1)) {
    const m = evalWeights(rows, w);
    if (!m.n) continue;
    if (
      !best ||
      m.hitRate > best.hitRate + 1e-9 ||
      (m.hitRate === best.hitRate && m.n > best.n)
    ) {
      best = { ...m, weights: w };
    }
  }
  return best;
}

function main() {
  backtest.preloadWalkForwardCaches();
  const ids = QUICK
    ? QUICK_IDS.filter((id) => INSTRUMENT_REGISTRY.some((s) => String(s.id).toLowerCase() === id))
    : INSTRUMENT_REGISTRY.map((s) => s.id);

  console.log('[statekey-cal] instruments', ids.length, QUICK ? '(quick)' : '(full)', 'days', DAYS, 'stride', STRIDE);

  const byFine = new Map();
  const byCoarse = new Map();
  let rowsKept = 0;
  let barsTried = 0;
  const t0 = Date.now();

  for (let ii = 0; ii < ids.length; ii += 1) {
    const id = ids[ii];
    const bars = readCachedKlines(id) || [];
    if (bars.length < 80) {
      console.log(`[statekey-cal] skip ${id} bars=${bars.length || 0}`);
      continue;
    }
    const meta = getCommodityMeta(id) || {};
    const spec =
      INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === String(id).toLowerCase()) || {
        id,
        sector: meta.sector || 'other',
        bucket: meta.bucket,
      };
    const end = bars.length - 2;
    const begin = Math.max(60, end - DAYS);
    let prevFinance = null;
    let instRows = 0;
    for (let t = begin; t <= end; t += STRIDE) {
      barsTried += 1;
      let row;
      try {
        row = backtest.predictAtBarIndexHistorical(spec, bars, t, null, prevFinance, {});
        prevFinance = row?.financeRegimeNext || prevFinance;
      } catch {
        continue;
      }
      if (!row) continue;
      const stateKey = row.intelligenceKernel?.stateKey;
      if (!stateKey) continue;
      if (row.actualDir !== 'bullish' && row.actualDir !== 'bearish') continue;
      if (
        row.philosophyScore == null ||
        row.adaptiveScore == null ||
        row.factorComposite == null
      ) {
        continue;
      }
      const sample = {
        id,
        date: row.date,
        stateKey,
        coarseKey: coarseStateKey(stateKey),
        philosophyScore: Number(row.philosophyScore),
        adaptiveScore: Number(row.adaptiveScore),
        factorComposite: Number(row.factorComposite),
        actualDir: row.actualDir,
      };
      if (!byFine.has(stateKey)) byFine.set(stateKey, []);
      byFine.get(stateKey).push(sample);
      if (!byCoarse.has(sample.coarseKey)) byCoarse.set(sample.coarseKey, []);
      byCoarse.get(sample.coarseKey).push(sample);
      rowsKept += 1;
      instRows += 1;
    }
    console.log(
      `[statekey-cal] ${ii + 1}/${ids.length} ${id} rows=${instRows} totalKept=${rowsKept} ${(
        (Date.now() - t0) /
        1000
      ).toFixed(0)}s`
    );
  }

  function calibrateMap(map, kind) {
    const out = {};
    const skipped = [];
    for (const [key, rows] of [...map.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (rows.length < MIN_N) {
        skipped.push({ key, n: rows.length, reason: 'n_below_min' });
        continue;
      }
      const equal = evalWeights(rows, EQUAL);
      const best = bestWeights(rows);
      if (!best || best.n < MIN_N) {
        skipped.push({ key, n: rows.length, reason: 'no_grid_scored' });
        continue;
      }
      const lift = equal.hitRate != null ? +(best.hitRate - equal.hitRate).toFixed(1) : null;
      if (lift == null || lift < MIN_LIFT) {
        skipped.push({
          key,
          n: best.n,
          reason: 'lift_below_min',
          best: best.hitDisplay,
          equal: equal.hitDisplay,
          lift,
        });
        continue;
      }
      out[key] = {
        n: best.n,
        hits: best.hits,
        hitRate: best.hitRate,
        hitDisplay: best.hitDisplay,
        weights: best.weights,
        equalHitDisplay: equal.hitDisplay,
        liftVsEqual: lift,
        method: 'grid-search-t1-simplex',
        kind,
      };
    }
    return { buckets: out, skipped };
  }

  const fine = calibrateMap(byFine, 'fine');
  const coarse = calibrateMap(byCoarse, 'coarse');

  // 全样本全局兜底（仅当 lift 足够）
  const allRows = [...byFine.values()].flat();
  let globalFallback = null;
  if (allRows.length >= MIN_N) {
    const equal = evalWeights(allRows, EQUAL);
    const best = bestWeights(allRows);
    if (best && equal.hitRate != null) {
      const lift = +(best.hitRate - equal.hitRate).toFixed(1);
      if (lift >= MIN_LIFT) {
        globalFallback = {
          n: best.n,
          hitDisplay: best.hitDisplay,
          liftVsEqual: lift,
          weights: best.weights,
          method: 'grid-search-global',
        };
      }
    }
  }

  const report = {
    version: WEIGHTS_VERSION,
    asOf: new Date().toISOString(),
    dataDrive: process.env.FANCHENG_DATA_DRIVE,
      windowDays: DAYS,
      stride: STRIDE,
      minN: MIN_N,
    minLiftPp: MIN_LIFT,
    quick: QUICK,
    coverage: {
      instruments: ids.length,
      barsTried,
      rowsWithStateKeyAndActual: rowsKept,
      fineKeys: byFine.size,
      coarseKeys: byCoarse.size,
      fineCalibrated: Object.keys(fine.buckets).length,
      coarseCalibrated: Object.keys(coarse.buckets).length,
    },
    buckets: fine.buckets,
    coarseBuckets: coarse.buckets,
    skippedFine: fine.skipped.slice(0, 40),
    skippedCoarse: coarse.skipped.slice(0, 40),
    globalFallback,
    knownGaps: [
      '仅校准 T+1 方向命中；T+3 未纳入本表',
      '桶样本量 < minN 或 lift < minLift 时不写入 — 内核回退启发式',
      '网格步长 0.1，非连续最优；禁止外推未见过的 stateKey',
      QUICK ? 'quick 子集校准；全市场请去掉 --quick 重跑' : '全注册表校准',
    ],
  };

  const outPath = saveStateKeyWeights(report);
  const auditCopy = path.join(
    getDataDir() || 'F:/FanchengFinance/data',
    'audits',
    `intel-statekey-weights-${new Date().toISOString().slice(0, 10)}.json`
  );
  fs.mkdirSync(path.dirname(auditCopy), { recursive: true });
  fs.writeFileSync(auditCopy, JSON.stringify(report, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        outPath,
        weightsPath: weightsPath(),
        coverage: report.coverage,
        topFine: Object.entries(fine.buckets)
          .sort((a, b) => (b[1].liftVsEqual ?? 0) - (a[1].liftVsEqual ?? 0))
          .slice(0, 8)
          .map(([k, v]) => ({ key: k, ...v })),
        topCoarse: Object.entries(coarse.buckets)
          .sort((a, b) => (b[1].liftVsEqual ?? 0) - (a[1].liftVsEqual ?? 0))
          .slice(0, 8)
          .map(([k, v]) => ({ key: k, ...v })),
        globalFallback,
        skippedSample: fine.skipped.slice(0, 5),
      },
      null,
      2
    )
  );
}

main();
