/**
 * L1 byRegime T+3 探针 + regime-labels-daily.json 导出
 * 哲学 M1 方向（philosophyScore）按五态 regime 分组 T+3 命中率
 * AU T+3 对比：philosophy-only vs ensemble-stub vs momentum+OI
 *
 * 用法:
 *   node scripts/probe-by-regime-t3.js
 *   node scripts/probe-by-regime-t3.js --export-regime --id au
 *   node scripts/probe-by-regime-t3.js --compare-au
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const {
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
const { REGIME_IDS } = require('../services/market-regime-classifier');

const PRECIOUS_IDS = ['au', 'ag', 'pt', 'pd'];
const PROBE_MIN_BAR_IDX = 60;
const PHILOSOPHY_DIR_THRESHOLD = 0.12;

function parseArgs() {
  const args = process.argv.slice(2);
  let id = 'au';
  let sector = null;
  let from = '2023-01-01';
  let to = '2026-12-31';
  let step = 1;
  let exportRegime = false;
  let compareAu = false;
  let lookback = 5;
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
    } else if (args[i] === '--step' && args[i + 1]) {
      step = Math.max(1, Number(args[i + 1]) || 1);
      i += 1;
    } else if (args[i] === '--lookback' && args[i + 1]) {
      lookback = Number(args[i + 1]) || 5;
      i += 1;
    } else if (args[i] === '--export-regime') {
      exportRegime = true;
    } else if (args[i] === '--compare-au') {
      compareAu = true;
    }
  }
  return {
    id: String(id).toLowerCase(),
    sector,
    from,
    to,
    step,
    exportRegime,
    compareAu,
    lookback,
  };
}

function resolveInstrumentIds({ id, sector }) {
  if (sector === 'precious') return PRECIOUS_IDS;
  if (id.includes(',')) return id.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [id];
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadTradingBars(instrumentId) {
  const klines = readCachedKlines(instrumentId);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const fp = path.join(historyDir, 'trading', `${instrumentId}.json`);
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

function buildProbeIndices(bars, { from, to, step, minBarIdx = PROBE_MIN_BAR_IDX, maxFutureBars = 3 }) {
  const indices = [];
  const upper = bars.length - maxFutureBars;
  for (let i = minBarIdx; i < upper; i += step) {
    const d = normBarDate(bars[i]);
    if (d >= from && d <= to) indices.push(i);
  }
  return indices;
}

function philosophyDirFromScore(score, threshold = PHILOSOPHY_DIR_THRESHOLD) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'neutral';
  if (s >= threshold) return 'bullish';
  if (s <= -threshold) return 'bearish';
  return 'neutral';
}

function initByRegime() {
  return Object.fromEntries(REGIME_IDS.map((r) => [r, { hits: 0, scored: 0 }]));
}

function recordByRegime(byRegime, regime, hit) {
  if (!byRegime[regime]) byRegime[regime] = { hits: 0, scored: 0 };
  byRegime[regime].scored += 1;
  if (hit) byRegime[regime].hits += 1;
}

function finalizeByRegime(byRegime) {
  const out = {};
  for (const regime of REGIME_IDS) {
    const s = byRegime[regime] || { hits: 0, scored: 0 };
    out[regime] = {
      hits: s.hits,
      scored: s.scored,
      hitRatePct: s.scored ? +((s.hits / s.scored) * 100).toFixed(2) : null,
    };
  }
  return out;
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

function momentumWithOi(bars, i, lookback) {
  const base = momentumSignal(bars, i, lookback);
  if (!base || base === 'neutral') return base;
  const beh = computeOiBehaviorAtBar(bars, i);
  if (beh.behavior_tag === '增仓下跌' && base === 'bullish') return 'bearish';
  if (beh.behavior_tag === '减仓上涨' && base === 'bearish') return 'bullish';
  return base;
}

function scoreMomentumT3(bars, indices, lookback, withOi = false) {
  let hits = 0;
  let scored = 0;
  for (const i of indices) {
    const pred = withOi ? momentumWithOi(bars, i, lookback) : momentumSignal(bars, i, lookback);
    const t3 = computeT3TrendLabel(bars, i);
    if (!pred || pred === 'neutral' || !t3.label) continue;
    scored += 1;
    if (hitDirection(pred, t3.label)) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
  };
}

async function walkForwardRows({ id, from, to, step, useEnsembleStub = false, useOnnxEnsemble = false }) {
  const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
  if (!spec) throw new Error(`instrument ${id} not in registry`);

  const weights = calibration.getCompositeWeights();
  const bars = loadTradingBars(id);
  const indices = buildProbeIndices(bars, { from, to, step });
  const rows = [];
  let prev = 'neutral';

  for (const t of indices) {
    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, { useEnsembleStub, useOnnxEnsemble });
    if (!row) continue;
    prev = row.financeRegimeNext || prev;
    rows.push(row);
  }
  return { spec, bars, indices, rows };
}

function aggregatePhilosophyByRegime(rows) {
  const byRegime = initByRegime();
  let totalHits = 0;
  let totalScored = 0;

  for (const row of rows) {
    const regime = row.marketRegime || 'range';
    const pred = philosophyDirFromScore(row.philosophyScore);
    if (!pred || pred === 'neutral' || !row.actualDirT3) continue;
    const hit = hitDirection(pred, row.actualDirT3);
    recordByRegime(byRegime, regime, hit);
    totalScored += 1;
    if (hit) totalHits += 1;
  }

  return {
    byRegime: finalizeByRegime(byRegime),
    overall: {
      hits: totalHits,
      scored: totalScored,
      hitRatePct: totalScored ? +((totalHits / totalScored) * 100).toFixed(2) : null,
    },
  };
}

function aggregateEngineT3(rows, dirFn) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    const pred = dirFn(row);
    if (!pred || pred === 'neutral' || !row.actualDirT3) continue;
    scored += 1;
    if (hitDirection(pred, row.actualDirT3)) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
  };
}

function exportRegimeLabelsDaily({ id, rows, from, to }) {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const outDir = path.join(dataDir, 'history');
  fs.mkdirSync(outDir, { recursive: true });

  const labels = rows.map((row) => ({
    date: row.date,
    instrument: id,
    regime: row.marketRegime,
    regimeLabel: row.marketRegimeLabel,
    reasons: row.marketRegimeReasons || [],
    version: row.marketRegimeVersion,
  }));

  const payload = {
    version: rows[0]?.marketRegimeVersion || 'v1.34.1',
    instrument: id,
    window: `${from}..${to}`,
    generatedAt: new Date().toISOString(),
    count: labels.length,
    distribution: labels.reduce((acc, l) => {
      acc[l.regime] = (acc[l.regime] || 0) + 1;
      return acc;
    }, {}),
    labels,
  };

  const fp = path.join(outDir, 'regime-labels-daily.json');
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return fp;
}

async function runByRegimeProbe({ ids, from, to, step }) {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const perInstrument = {};
  const aggregateByRegime = initByRegime();
  let aggHits = 0;
  let aggScored = 0;

  for (const id of ids) {
    const { rows } = await walkForwardRows({ id, from, to, step });
    const stats = aggregatePhilosophyByRegime(rows);
    perInstrument[id] = stats;

    for (const regime of REGIME_IDS) {
      const s = stats.byRegime[regime];
      if (!s?.scored) continue;
      aggregateByRegime[regime].hits += s.hits;
      aggregateByRegime[regime].scored += s.scored;
    }
    aggHits += stats.overall.hits;
    aggScored += stats.overall.scored;
  }

  return {
    baseline: 'philosophy_m1_by_regime',
    window: `${from}..${to}`,
    step,
    instruments: ids,
    perInstrument,
    aggregate: {
      byRegime: finalizeByRegime(aggregateByRegime),
      overall: {
        hits: aggHits,
        scored: aggScored,
        hitRatePct: aggScored ? +((aggHits / aggScored) * 100).toFixed(2) : null,
      },
    },
  };
}

async function runAuCompare({ from, to, step, lookback }) {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const id = 'au';
  const { bars, indices, rows: philRows } = await walkForwardRows({ id, from, to, step, useEnsembleStub: false });
  const { rows: ensRows } = await walkForwardRows({ id, from, to, step, useEnsembleStub: true });

  const philosophyOnly = aggregateEngineT3(philRows, (r) => philosophyDirFromScore(r.philosophyScore));
  const engineWalkforward = aggregateEngineT3(philRows, (r) => r.predictedDir);
  const ensembleStub = aggregateEngineT3(ensRows, (r) => r.predictedDir);
  const momentumOi = scoreMomentumT3(bars, indices, lookback, true);

  const deltaEnsembleVsPhilosophy = philosophyOnly.hitRatePct != null && ensembleStub.hitRatePct != null
    ? +(ensembleStub.hitRatePct - philosophyOnly.hitRatePct).toFixed(2)
    : null;

  const phase3Ready = deltaEnsembleVsPhilosophy != null && deltaEnsembleVsPhilosophy >= 1;

  return {
    instrument: id,
    window: `${from}..${to}`,
    step,
    compare: {
      philosophyOnly: { ...philosophyOnly, baseline: 'philosophy_score_m1' },
      engineWalkforward: { ...engineWalkforward, baseline: 'full_engine_walkforward' },
      ensembleStub: { ...ensembleStub, baseline: 'ensemble_stub_l2' },
      momentumWithOi: { ...momentumOi, baseline: `momentum_${lookback}d+oi` },
    },
    deltaPp: {
      ensembleVsPhilosophyOnly: deltaEnsembleVsPhilosophy,
      ensembleVsEngine: engineWalkforward.hitRatePct != null && ensembleStub.hitRatePct != null
        ? +(ensembleStub.hitRatePct - engineWalkforward.hitRatePct).toFixed(2)
        : null,
      philosophyVsMomentumOi: philosophyOnly.hitRatePct != null && momentumOi.hitRatePct != null
        ? +(philosophyOnly.hitRatePct - momentumOi.hitRatePct).toFixed(2)
        : null,
    },
    phase3: {
      thresholdPp: 1,
      ready: phase3Ready,
      verdict: phase3Ready ? 'GO — ONNX Phase 3' : 'NO-GO — stub 需调权重后再上 ONNX',
    },
  };
}

async function main() {
  const opts = parseArgs();
  const ids = resolveInstrumentIds(opts);

  if (opts.compareAu) {
    const cmp = await runAuCompare(opts);
    console.log(JSON.stringify(cmp, null, 2));
    return;
  }

  if (opts.exportRegime && ids.length === 1) {
    diskCache.init(getDataDir());
    await historicalContext.ensureFredDailyCache();
    newsTagged.loadNewsTagged({ force: true });
    const { rows } = await walkForwardRows({
      id: ids[0],
      from: opts.from,
      to: opts.to,
      step: opts.step,
    });
    const fp = exportRegimeLabelsDaily({
      id: ids[0],
      rows,
      from: opts.from,
      to: opts.to,
    });
    console.log(JSON.stringify({ exported: fp, count: rows.length }, null, 2));
  }

  const byRegime = await runByRegimeProbe({
    ids: opts.sector === 'precious' || ids.length > 1 ? ids : ids,
    from: opts.from,
    to: opts.to,
    step: opts.step,
  });

  if (opts.sector === 'precious' || (ids.length > 1 && !opts.id)) {
    byRegime.sector = 'precious';
  }

  if (opts.exportRegime && ids.length === 1) {
    byRegime.regimeLabelsExport = 'data/history/regime-labels-daily.json';
  }

  if (ids.length === 1 && ids[0] === 'au') {
    byRegime.auCompare = await runAuCompare(opts);
  }

  console.log(JSON.stringify(byRegime, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
