/**
 * 探针：AU 2023–2026 基线 T+3 vs T+1 命中率（动量 / 可选哲学 M1）
 * OI 行为因子对比：momentum vs momentum+OI divergence
 * 用法:
 *   node scripts/probe-t3-vs-t1-baseline.js [--id au]
 *   node scripts/probe-t3-vs-t1-baseline.js --baseline philosophy --step 3
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const {
  computeT1Direction,
  computeT3TrendLabel,
  hitDirection,
  DIRECTION_THRESHOLD_PCT,
} = require('../services/outlook-labels');
const { computeOiBehaviorAtBar } = require('../services/oi-behavior-features');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');

const PRECIOUS_IDS = ['au', 'ag', 'pt', 'pd'];

function parseArgs() {
  const args = process.argv.slice(2);
  let id = 'au';
  let sector = null;
  let from = '2023-01-01';
  let to = '2026-12-31';
  let lookback = 5;
  let baseline = 'momentum';
  let step = 1;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id' && args[i + 1]) {
      id = args[i + 1];
      i += 1;
    } else if (args[i] === '--sector' && args[i + 1]) {
      sector = String(args[i + 1]).toLowerCase();
      i += 1;
    } else if (args[i] === '--from' && args[i + 1]) {
      from = args[i + 1];
      i += 1;
    } else if (args[i] === '--to' && args[i + 1]) {
      to = args[i + 1];
      i += 1;
    } else if (args[i] === '--lookback' && args[i + 1]) {
      lookback = Number(args[i + 1]) || 5;
      i += 1;
    } else if (args[i] === '--baseline' && args[i + 1]) {
      baseline = args[i + 1];
      i += 1;
    } else if (args[i] === '--step' && args[i + 1]) {
      step = Math.max(1, Number(args[i + 1]) || 1);
      i += 1;
    }
  }
  return { id: String(id).toLowerCase(), sector, from, to, lookback, baseline, step };
}

function resolveInstrumentIds({ id, sector }) {
  if (sector === 'precious') return PRECIOUS_IDS;
  if (id.includes(',')) return id.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [id];
}

function loadTradingBars(id) {
  const klines = readCachedKlines(id);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const fp = path.join(historyDir, 'trading', `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

function momentumSignal(bars, i, lookback) {
  if (i < lookback) return null;
  const start = bars[i - lookback];
  const end = bars[i];
  if (!start?.close || !end?.close) return null;
  const ret = ((Number(end.close) - Number(start.close)) / Number(start.close)) * 100;
  if (ret > DIRECTION_THRESHOLD_PCT) return 'bullish';
  if (ret < -DIRECTION_THRESHOLD_PCT) return 'bearish';
  return 'neutral';
}

/** OI 背离修正：增仓下跌→偏空，减仓上涨→偏多 */
function momentumWithOi(bars, i, lookback) {
  const base = momentumSignal(bars, i, lookback);
  if (!base || base === 'neutral') return base;
  const beh = computeOiBehaviorAtBar(bars, i);
  if (beh.behavior_tag === '增仓下跌' && base === 'bullish') return 'bearish';
  if (beh.behavior_tag === '减仓上涨' && base === 'bearish') return 'bullish';
  return base;
}

function labelDistribution(labels) {
  const dist = { bullish: 0, bearish: 0, neutral: 0, null: 0 };
  for (const l of labels) {
    dist[l ?? 'null'] = (dist[l ?? 'null'] || 0) + 1;
  }
  return dist;
}

function scoreHorizons(predFn, bars, indices, lookback) {
  const t1Labels = [];
  const t3Labels = [];
  let t1Hits = 0;
  let t1Total = 0;
  let t3Hits = 0;
  let t3Total = 0;

  for (const i of indices) {
    const pred = predFn(bars, i, lookback);
    const t1 = computeT1Direction(bars, i);
    const t3 = computeT3TrendLabel(bars, i);
    t1Labels.push(t1.label);
    t3Labels.push(t3.label);

    if (pred && pred !== 'neutral' && t1.label) {
      t1Total += 1;
      if (hitDirection(pred, t1.label)) t1Hits += 1;
    }
    if (pred && pred !== 'neutral' && t3.label) {
      t3Total += 1;
      if (hitDirection(pred, t3.label)) t3Hits += 1;
    }
  }

  const t1Rate = t1Total ? +((t1Hits / t1Total) * 100).toFixed(2) : null;
  const t3Rate = t3Total ? +((t3Hits / t3Total) * 100).toFixed(2) : null;

  return {
    t1: {
      distribution: labelDistribution(t1Labels),
      hitRatePct: t1Rate,
      hits: t1Hits,
      scored: t1Total,
    },
    t3: {
      distribution: labelDistribution(t3Labels),
      hitRatePct: t3Rate,
      hits: t3Hits,
      scored: t3Total,
    },
    deltaPp: t1Rate != null && t3Rate != null ? +(t3Rate - t1Rate).toFixed(2) : null,
  };
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

/** 统一探针索引：同窗口、同 step、T+3 需留 3 根未来 bar */
const PROBE_MIN_BAR_IDX = 60;

function buildProbeIndices(bars, { from, to, step, minBarIdx = PROBE_MIN_BAR_IDX, maxFutureBars = 3 }) {
  const indices = [];
  const upper = bars.length - maxFutureBars;
  for (let i = minBarIdx; i < upper; i += step) {
    const d = normBarDate(bars[i]);
    if (d >= from && d <= to) indices.push(i);
  }
  return indices;
}

async function runEngineWalkForward({ id, from, to, step, forceNews = false }) {
  const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
  if (!spec) throw new Error(`instrument ${id} not in registry`);

  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: forceNews });

  const weights = calibration.getCompositeWeights();
  const bars = loadTradingBars(id);
  const indices = buildProbeIndices(bars, { from, to, step });
  let t1Hits = 0;
  let t1Total = 0;
  let t3Hits = 0;
  let t3Total = 0;
  let prev = 'neutral';
  const regimeCounts = {};
  let regimeTagged = 0;

  for (const t of indices) {
    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev);
    if (!row) continue;
    prev = row.financeRegimeNext || prev;
    if (row.marketRegime) {
      regimeTagged += 1;
      regimeCounts[row.marketRegime] = (regimeCounts[row.marketRegime] || 0) + 1;
    }
    if (!row.predictedDir || row.predictedDir === 'neutral') continue;
    if (row.actualDir) {
      t1Total += 1;
      if (row.hitDirection) t1Hits += 1;
    }
    if (row.actualDirT3) {
      t3Total += 1;
      if (row.hitDirectionT3) t3Hits += 1;
    }
  }

  const t1Rate = t1Total ? +((t1Hits / t1Total) * 100).toFixed(2) : null;
  const t3Rate = t3Total ? +((t3Hits / t3Total) * 100).toFixed(2) : null;
  return {
    baseline: 'philosophy_m1_walkforward',
    step,
    barsInWindow: indices.length,
    newsRows: newsTagged.isLoaded() ? newsTagged.getRowCount?.() ?? null : null,
    t1: { hitRatePct: t1Rate, hits: t1Hits, scored: t1Total },
    t3: { hitRatePct: t3Rate, hits: t3Hits, scored: t3Total },
    deltaPp: t1Rate != null && t3Rate != null ? +(t3Rate - t1Rate).toFixed(2) : null,
    marketRegime: {
      tagged: regimeTagged,
      coveragePct: indices.length ? +((regimeTagged / indices.length) * 100).toFixed(1) : null,
      distribution: regimeCounts,
    },
  };
}

async function runPhilosophyProbe(opts) {
  return runEngineWalkForward(opts);
}

async function runSectorWalkForward({ ids, from, to, step }) {
  const perInstrument = {};
  let t1Hits = 0;
  let t1Total = 0;
  let t3Hits = 0;
  let t3Total = 0;
  const regimeCounts = {};

  for (const id of ids) {
    const wf = await runEngineWalkForward({ id, from, to, step, forceNews: id === ids[0] });
    perInstrument[id] = wf;
    t1Hits += wf.t1.hits;
    t1Total += wf.t1.scored;
    t3Hits += wf.t3.hits;
    t3Total += wf.t3.scored;
    for (const [regime, count] of Object.entries(wf.marketRegime?.distribution || {})) {
      regimeCounts[regime] = (regimeCounts[regime] || 0) + count;
    }
  }

  const t1Rate = t1Total ? +((t1Hits / t1Total) * 100).toFixed(2) : null;
  const t3Rate = t3Total ? +((t3Hits / t3Total) * 100).toFixed(2) : null;

  return {
    baseline: 'philosophy_m1_walkforward',
    sector: ids.length > 1 ? 'precious' : null,
    instruments: ids,
    step,
    aggregate: {
      t1: { hitRatePct: t1Rate, hits: t1Hits, scored: t1Total },
      t3: { hitRatePct: t3Rate, hits: t3Hits, scored: t3Total },
      deltaPp: t1Rate != null && t3Rate != null ? +(t3Rate - t1Rate).toFixed(2) : null,
    },
    marketRegime: { distribution: regimeCounts },
    perInstrument,
  };
}

async function main() {
  const { id, sector, from, to, lookback, baseline, step } = parseArgs();
  const ids = resolveInstrumentIds({ id, sector });
  const probeSpec = {
    instrument: ids.length === 1 ? ids[0] : ids,
    sector: sector || (ids.length > 1 ? 'multi' : null),
    window: `${from}..${to}`,
    step,
    minBarIdx: PROBE_MIN_BAR_IDX,
    dataSource: 'loadTradingBars',
  };

  if (baseline === 'philosophy' || baseline === 'walkforward') {
    const wf = ids.length > 1
      ? await runSectorWalkForward({ ids, from, to, step })
      : await runEngineWalkForward({ id: ids[0], from, to, step, forceNews: true });
    console.log(JSON.stringify({ ...probeSpec, ...wf }, null, 2));
    return;
  }

  if (baseline === 'all') {
    const bars = loadTradingBars(id);
    const indices = buildProbeIndices(bars, { from, to, step, minBarIdx: lookback });
    const momentum = scoreHorizons(momentumSignal, bars, indices, lookback);
    const momentumOi = scoreHorizons(momentumWithOi, bars, indices, lookback);
    const wf = await runEngineWalkForward({ id, from, to, step, forceNews: true });
    const out = {
      ...probeSpec,
      bars: indices.length,
      lookback,
      thresholdPct: DIRECTION_THRESHOLD_PCT,
      momentum: { baseline: `momentum_${lookback}d`, ...momentum },
      momentumWithOi: { baseline: `momentum_${lookback}d+oi_divergence`, ...momentumOi },
      philosophyWalkforward: wf,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const bars = loadTradingBars(id);
  const indices = buildProbeIndices(bars, { from, to, step, minBarIdx: lookback });

  const momentum = scoreHorizons(momentumSignal, bars, indices, lookback);
  const momentumOi = scoreHorizons(momentumWithOi, bars, indices, lookback);

  const out = {
    ...probeSpec,
    bars: indices.length,
    lookback,
    thresholdPct: DIRECTION_THRESHOLD_PCT,
    momentum: {
      baseline: `momentum_${lookback}d`,
      ...momentum,
      t3Better: momentum.t3.hitRatePct != null && momentum.t1.hitRatePct != null
        ? momentum.t3.hitRatePct > momentum.t1.hitRatePct
        : null,
    },
    momentumWithOi: {
      baseline: `momentum_${lookback}d+oi_divergence`,
      ...momentumOi,
      vsMomentumT3DeltaPp:
        momentum.t3.hitRatePct != null && momentumOi.t3.hitRatePct != null
          ? +(momentumOi.t3.hitRatePct - momentum.t3.hitRatePct).toFixed(2)
          : null,
    },
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
