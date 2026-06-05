/**
 * 大宗走势研判历史回测 — walk-forward，无前瞻
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { INSTRUMENT_REGISTRY, scoreToDirection, computeNextDayRangePct, buildFactorBreakdown, computeCapitalAttention, buildMacroScoresForInstrument, parseVix } = require('./commodity-outlook-engine');
const philosophy = require('./commodity-outlook-philosophy');
const marketAdaptive = require('./commodity-market-adaptive');
const calibration = require('./commodity-outlook-calibration');
const { getCommodityMeta } = require('./commodities-catalog');
const { getInstrumentProfile, getSectorVolPrior } = require('./commodity-instrument-profiles');
const { readCachedKlines, analyzeInstrumentTechnicalsFromBars } = require('./commodity-technical-analyzer');
const { getCachedAllData } = require('./data-fetcher');

const MIN_BARS = 60;
const MIN_WALK_START = 25;

let backtestRunning = false;
let backtestProgress = { phase: 'idle', pct: 0, message: '' };

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getBacktestRoot() {
  const dataDir = getDataDir();
  const base = dataDir || path.join(process.cwd(), 'data');
  const root = path.join(base, 'outlook-backtest');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getSummaryPath() {
  return path.join(getBacktestRoot(), 'summary.json');
}

function loadBacktestSummary() {
  const p = getSummaryPath();
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return null;
}

function directionFromReturn(pct) {
  if (pct == null || Number.isNaN(pct)) return null;
  if (pct > 0.05) return 'bullish';
  if (pct < -0.05) return 'bearish';
  return 'neutral';
}

function hitDirection(predicted, actual) {
  if (!predicted || !actual || predicted === 'neutral' || actual === 'neutral') return null;
  return predicted === actual;
}

function buildSyntheticQuote(bar, prevBar) {
  const changePct =
    prevBar?.close && bar?.close ? ((Number(bar.close) - Number(prevBar.close)) / Number(prevBar.close)) * 100 : 0;
  return {
    price: bar.close,
    changePct: +changePct.toFixed(4),
    openInterest: bar.openInterest,
    high: bar.high,
    low: bar.low,
    volume: bar.volume,
  };
}

function countSourceLanes(sources = {}) {
  return [
    sources.indices?.regions?.some((r) => r.indices?.length),
    sources.forex?.pairs?.length || sources.forex?.groups?.length,
    sources.policy?.items?.length,
    sources.climate?.items?.length,
    sources.geopolitics?.items?.length,
    sources.fed?.indicators?.length,
    sources.boj?.indicators?.length,
    sources.commodities?.exchanges?.some((e) => e.items?.length),
  ].filter(Boolean).length;
}

function applyNewsPriceDampening(newsImpact, changePct) {
  const chg = Number(changePct);
  if (newsImpact == null || Number.isNaN(chg)) return newsImpact;
  const next = { ...newsImpact };
  if (next.shock > 0 && chg < -0.5) {
    next.shock = +(next.shock * 0.4).toFixed(3);
    next.score = +(next.score * 0.4).toFixed(4);
    next.priceDampened = true;
  } else if (next.shock < 0 && chg > 0.5) {
    next.shock = +(next.shock * 0.4).toFixed(3);
    next.score = +(next.score * 0.4).toFixed(4);
    next.priceDampened = true;
  }
  return next;
}

function predictAtBarIndex(spec, bars, tIndex, sources, weights) {
  if (tIndex < MIN_WALK_START || tIndex >= bars.length - 1) return null;

  const slice = bars.slice(0, tIndex + 1);
  const bar = slice[slice.length - 1];
  const prev = slice[slice.length - 2];
  if (!bar?.close || !prev?.close) return null;

  const meta = getCommodityMeta(spec.id);
  const profile = getInstrumentProfile(spec.id);
  if (!meta || !profile) return null;

  const liveQuote = buildSyntheticQuote(bar, prev);
  const sectorPrior = getSectorVolPrior(spec.sector || profile.sector);
  const technical = analyzeInstrumentTechnicalsFromBars(spec.id, slice, liveQuote, { sectorPrior });
  if (!technical?.hasEnough) return null;

  const dataQuality = countSourceLanes(sources);
  const newsImpact = { score: 0, shock: 0, hitCount: 0, hits: [] };

  const phil = philosophy.evaluateInstrumentPhilosophy({
    meta,
    profile,
    spec,
    sources,
    technical,
    liveQuote,
    newsImpact,
    sectorVolumeRank: null,
    changePct: liveQuote.changePct,
    vix: parseVix(sources.fed),
  });

  const macroScores = buildMacroScoresForInstrument(sources, spec.bucket);
  const vix = parseVix(sources.fed);
  const adaptive = marketAdaptive.computeAdaptiveOutlook({
    intradayChangePct: liveQuote.changePct,
    intradayScore: technical.intraday?.score || 0,
    volumeRatio: technical.volume?.ratio ?? 1,
    newsHits: [],
    sources,
    vix,
    oiDeltaPct: technical.oi?.deltaPct,
    oiScore: technical.oi?.score ?? 0,
    maStack: technical.maStack,
    smoothedVol: technical.smoothedVol,
    technicalScore: technical.techScore,
    macroScores,
  });

  const factorBreakdown = buildFactorBreakdown({
    profile,
    macroScores,
    technical,
    capitalAttention: computeCapitalAttention(technical, liveQuote, null),
    newsImpact,
    inventoryScore: technical.oi?.score ?? 0,
    weatherScore: 0,
    volBiasParts: { volBias: 0 },
    regime: 'neutral',
  });
  const factorComposite = clamp((factorBreakdown._sum ?? 0), -1, 1);

  const philosophyScore = phil.compositeScore ?? 0;
  const pw = weights.philosophyWeight ?? 0.58;
  const aw = weights.adaptiveWeight ?? 0.22;
  const fw = weights.factorWeight ?? 0.2;
  let compositeScore = clamp(philosophyScore * pw + adaptive.compositeScore * aw + factorComposite * fw, -1, 1);

  let direction = scoreToDirection(compositeScore);
  let directionLabel = direction === 'bullish' ? '偏多' : direction === 'bearish' ? '偏空' : '震荡';
  if (dataQuality < 3) {
    direction = 'neutral';
    directionLabel = '数据不足·观望';
    compositeScore = clamp(compositeScore * 0.35, -0.35, 0.35);
  }

  const nextDayRangePct = computeNextDayRangePct({
    compositeScore,
    historicalVol: technical.historicalVol || {},
    smoothedVol: technical.smoothedVol,
    volatilityTier: profile.volatilityTier,
    newsFactor: { score: 0, hitCount: 0 },
    newsShock: 0,
    newsShockCap: profile.newsShockCap,
    macroScore: macroScores.china * 0.4 + macroScores.usd * 0.3,
    techScore: technical.techScore,
    intradayChangePct: liveQuote.changePct,
    sector: spec.sector,
    instrumentId: spec.id,
    vix,
    volumeRatio: technical.volume?.ratio,
    instantChannelFired: false,
  });

  const predictedMid = nextDayRangePct?.mid ?? compositeScore * (technical.smoothedVol?.volForecastPct ?? 0.8);

  const nextBar = bars[tIndex + 1];
  const actualReturn =
    nextBar?.close && bar.close ? ((Number(nextBar.close) - Number(bar.close)) / Number(bar.close)) * 100 : null;
  const actualDir = directionFromReturn(actualReturn);
  const predictedDir = direction;
  const gapPct = actualReturn != null && predictedMid != null ? actualReturn - predictedMid : null;

  return {
    date: bar.date || bar.time || `T${tIndex}`,
    predictedMid: predictedMid != null ? +Number(predictedMid).toFixed(4) : null,
    compositeScore: +compositeScore.toFixed(4),
    predictedDir,
    actualReturn: actualReturn != null ? +actualReturn.toFixed(4) : null,
    actualDir,
    hitDirection: hitDirection(predictedDir, actualDir),
    gapPct: gapPct != null ? +gapPct.toFixed(4) : null,
    dataQuality,
    financeRegime: phil.financialEnvironment?.regime,
    sdState: phil.supplyDemand?.state,
  };
}

function aggregateInstrumentResults(days, window30, window60) {
  const scored = days.filter((d) => d.predictedDir && d.predictedDir !== 'neutral' && d.actualDir);
  const hits = scored.filter((d) => d.hitDirection).length;
  const total = scored.length;
  const last30 = scored.slice(-window30);
  const last60 = scored.slice(-window60);
  const hits30 = last30.filter((d) => d.hitDirection).length;
  const hits60 = last60.filter((d) => d.hitDirection).length;
  const gaps = scored.filter((d) => d.gapPct != null).map((d) => Math.abs(d.gapPct));
  const maeMid = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;

  return {
    hits,
    total,
    hitRate: total > 0 ? hits / total : null,
    hitRate30d: last30.length > 0 ? hits30 / last30.length : null,
    hitRate60d: last60.length > 0 ? hits60 / last60.length : null,
    hits30d: hits30,
    total30d: last30.length,
    hits60d: hits60,
    total60d: last60.length,
    avgGapPct: maeMid != null ? +maeMid.toFixed(4) : null,
    sampleLast10: days.slice(-10),
  };
}

function aggregateBySector(instrumentResults) {
  const bySector = {};
  for (const inst of instrumentResults) {
    const sector = inst.sector || 'unknown';
    if (!bySector[sector]) {
      bySector[sector] = { hits30d: 0, total30d: 0, hits60d: 0, total60d: 0, gaps: [] };
    }
    bySector[sector].hits30d += inst.hits30d || 0;
    bySector[sector].total30d += inst.total30d || 0;
    bySector[sector].hits60d += inst.hits60d || 0;
    bySector[sector].total60d += inst.total60d || 0;
    if (inst.avgGapPct != null) bySector[sector].gaps.push(inst.avgGapPct);
  }
  const out = {};
  for (const [sector, s] of Object.entries(bySector)) {
    out[sector] = {
      hitRate30d: s.total30d > 0 ? s.hits30d / s.total30d : null,
      hitRate60d: s.total60d > 0 ? s.hits60d / s.total60d : null,
      hits30d: s.hits30d,
      total30d: s.total30d,
      hits60d: s.hits60d,
      total60d: s.total60d,
      maeMid30d: s.gaps.length ? +(s.gaps.reduce((a, b) => a + b, 0) / s.gaps.length).toFixed(4) : null,
    };
  }
  return out;
}

function runOutlookBacktest({ days = 60, onProgress = null } = {}) {
  if (backtestRunning) {
    return Promise.reject(new Error('回测已在运行中'));
  }

  backtestRunning = true;
  backtestProgress = { phase: 'init', pct: 0, message: '初始化回测…' };

  return Promise.resolve().then(async () => {
    const sources = getCachedAllData()?.sources || {};
    const weights = calibration.getCompositeWeights();
    const walkDays = Math.max(30, Math.min(days, 120));
    const eligible = INSTRUMENT_REGISTRY.filter((spec) => readCachedKlines(spec.id).length >= MIN_BARS);
    const totalSteps = eligible.length;
    const instrumentResults = [];

    for (let i = 0; i < eligible.length; i += 1) {
      const spec = eligible[i];
      const bars = readCachedKlines(spec.id);
      const startT = Math.max(MIN_WALK_START, bars.length - walkDays - 1);
      const dayRows = [];

      for (let t = startT; t < bars.length - 1; t += 1) {
        const row = predictAtBarIndex(spec, bars, t, sources, weights);
        if (row) dayRows.push(row);
      }

      const agg = aggregateInstrumentResults(dayRows, 30, 60);
      const instResult = {
        id: spec.id,
        name: spec.name,
        sector: spec.sector,
        barCount: bars.length,
        walkDays: dayRows.length,
        ...agg,
        days: dayRows,
      };

      instrumentResults.push(instResult);
      fs.writeFileSync(
        path.join(getBacktestRoot(), `${spec.id}.json`),
        JSON.stringify({ id: spec.id, sector: spec.sector, ...agg, days: dayRows.slice(-walkDays) }, null, 2),
        'utf8'
      );

      const pct = Math.round(((i + 1) / totalSteps) * 100);
      backtestProgress = {
        phase: 'walk-forward',
        pct,
        message: `${spec.name || spec.id} (${i + 1}/${totalSteps})`,
        instrumentId: spec.id,
      };
      onProgress?.(backtestProgress);
      await new Promise((r) => setImmediate(r));
    }

    backtestProgress = { phase: 'calibrate', pct: 95, message: '权重校准…' };
    onProgress?.(backtestProgress);

    const allHits30 = instrumentResults.reduce((s, r) => s + (r.hits30d || 0), 0);
    const allTotal30 = instrumentResults.reduce((s, r) => s + (r.total30d || 0), 0);
    const allHits60 = instrumentResults.reduce((s, r) => s + (r.hits60d || 0), 0);
    const allTotal60 = instrumentResults.reduce((s, r) => s + (r.total60d || 0), 0);

    const summary = {
      version: 'v1.25.0',
      runAt: new Date().toISOString(),
      days: walkDays,
      instrumentCount: instrumentResults.length,
      skippedCount: INSTRUMENT_REGISTRY.length - instrumentResults.length,
      overallHitRate30d: allTotal30 > 0 ? +(allHits30 / allTotal30).toFixed(4) : null,
      overallHitRate60d: allTotal60 > 0 ? +(allHits60 / allTotal60).toFixed(4) : null,
      hits30d: allHits30,
      total30d: allTotal30,
      hits60d: allHits60,
      total60d: allTotal60,
      bySector: aggregateBySector(instrumentResults),
      instruments: instrumentResults.map((r) => ({
        id: r.id,
        name: r.name,
        sector: r.sector,
        hitRate30d: r.hitRate30d,
        hitRate60d: r.hitRate60d,
        hits30d: r.hits30d,
        total30d: r.total30d,
        hits60d: r.hits60d,
        total60d: r.total60d,
        avgGapPct: r.avgGapPct,
        walkDays: r.walkDays,
        sampleLast10: r.sampleLast10,
      })),
      sampleHitRates: {
        au: instrumentResults.find((r) => String(r.id).toLowerCase() === 'au'),
        cu: instrumentResults.find((r) => String(r.id).toLowerCase() === 'cu'),
        FG: instrumentResults.find((r) => String(r.id).toLowerCase() === 'fg'),
        sc: instrumentResults.find((r) => String(r.id).toLowerCase() === 'sc'),
      },
    };

    fs.writeFileSync(getSummaryPath(), JSON.stringify(summary, null, 2), 'utf8');
    calibration.tuneWeightsFromBacktest(summary);

    backtestProgress = { phase: 'done', pct: 100, message: '回测完成', summary };
    onProgress?.(backtestProgress);
    return summary;
  }).finally(() => {
    backtestRunning = false;
  });
}

function getBacktestProgress() {
  return { ...backtestProgress, running: backtestRunning };
}

module.exports = {
  MIN_BARS,
  getBacktestRoot,
  getSummaryPath,
  loadBacktestSummary,
  runOutlookBacktest,
  getBacktestProgress,
  predictAtBarIndex,
};
