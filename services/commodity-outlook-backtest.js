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

const historicalContext = require('./commodity-outlook-historical-context');
const eventCalendar = require('./commodity-outlook-event-calendar');

const MIN_BARS = 60;
const MIN_WALK_START = 25;
const LONG_RUN_START = historicalContext.LONG_RUN_START;
const LONG_RUN_VERSION = 'v1.27.0';

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

function getLongrunSummaryPath() {
  return path.join(getBacktestRoot(), 'longrun-2019-summary.json');
}

function getLongrunEpochsPath() {
  return path.join(getBacktestRoot(), 'epochs.json');
}

function getLongrunByEraPath() {
  return path.join(getBacktestRoot(), 'longrun-2019-by-era.json');
}

function getLongrunInstrumentPath(id) {
  return path.join(getBacktestRoot(), `longrun-2019-${String(id).toLowerCase()}.json`);
}

function loadLongrunSummary() {
  const p = getLongrunSummaryPath();
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return null;
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function findWalkStartIndex(bars) {
  for (let i = MIN_BARS - 1; i < bars.length; i += 1) {
    if (normBarDate(bars[i]) >= LONG_RUN_START) return Math.max(MIN_WALK_START, i);
  }
  return Math.max(MIN_WALK_START, bars.length - 1);
}

function applyMacroEventMultipliers(macroScores, multipliers = {}) {
  const m = multipliers || {};
  return {
    ...macroScores,
    fed: (macroScores.fed ?? 0) * (m.macroFed ?? 1),
    geo: (macroScores.geo ?? 0) * (m.macroGeo ?? 1),
    china: (macroScores.china ?? 0) * (m.macroChina ?? 1),
    oil: (macroScores.oil ?? macroScores.energy ?? 0) * (m.oilSpillover ?? 1),
  };
}

function predictAtBarIndexHistorical(spec, bars, tIndex, weights, prevFinanceRegime = 'neutral') {
  if (tIndex < MIN_WALK_START || tIndex >= bars.length - 1) return null;

  const sliceStart = Math.max(0, tIndex + 1 - 120);
  const slice = bars.slice(sliceStart, tIndex + 1);
  const bar = slice[slice.length - 1];
  const prev = slice[slice.length - 2];
  if (!bar?.close || !prev?.close) return null;

  const barDate = normBarDate(bar);
  const sources = historicalContext.buildHistoricalSources(barDate);
  const eventCtx = eventCalendar.getActiveEventsMerged(barDate, {
    instrumentId: spec.id,
    sector: spec.sector,
  });
  const eventCtxMerged = calibration.mergeSectorIntoEventMultipliers(eventCtx, spec.sector);
  const blend = calibration.getCompositeWeights(barDate, eventCtxMerged, spec.sector);

  const meta = getCommodityMeta(spec.id);
  const profile = getInstrumentProfile(spec.id);
  if (!meta || !profile) return null;

  const liveQuote = buildSyntheticQuote(bar, prev);
  const sectorPrior = getSectorVolPrior(spec.sector || profile.sector);
  const technical = analyzeInstrumentTechnicalsFromBars(spec.id, slice, liveQuote, {
    sectorPrior,
    skipVolPersist: true,
  });
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
    skipRegimePersistence: true,
    eventMultipliers: eventCtx.weightMultipliers,
  });

  let macroScores = buildMacroScoresForInstrument(sources, spec.bucket);
  macroScores = applyMacroEventMultipliers(macroScores, eventCtxMerged.weightMultipliers);
  const vix = parseVix(sources.fed);
  const histRegime = historicalContext.getHistoricalRegime(barDate);
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
    regime: histRegime,
  });
  let factorComposite = clamp((factorBreakdown._sum ?? 0), -1, 1);
  const capMult = eventCtxMerged.weightMultipliers?.capitalSentiment ?? 1;
  if (capMult !== 1) {
    factorComposite = clamp(factorComposite * capMult, -1, 1);
  }

  let philosophyScore = phil.compositeScore ?? 0;
  const philMult = eventCtxMerged.weightMultipliers?.philosophy ?? 1;
  if (philMult !== 1) philosophyScore = clamp(philosophyScore * philMult, -1, 1);

  let compositeScore = calibration.blendSectorComposite({
    philosophyScore,
    adaptiveScore: adaptive.compositeScore,
    factorComposite,
    sector: spec.sector,
    date: barDate,
    eventCtx: eventCtxMerged,
  });

  let dirTier = calibration.scoreToDirectionTier(compositeScore, spec.sector, profile.directionThresholds, technical.smoothedVol);
  const adv = calibration.applyAdvancedDirectionFilters({
    sector: spec.sector,
    compositeScore,
    directionTier: dirTier,
    technical,
    eventCtx: eventCtxMerged,
    phil,
    smoothedVol: technical.smoothedVol,
    barDate,
    eraId: historicalContext.classifyEra(barDate),
  });
  dirTier = adv.directionTier;
  compositeScore = adv.compositeScore;
  dirTier = calibration.applyEnsembleStrongDirectionRule(dirTier, spec.sector, compositeScore);

  let direction = dirTier.direction === 'strong_bullish' || dirTier.direction === 'bullish'
    ? 'bullish'
    : dirTier.direction === 'strong_bearish' || dirTier.direction === 'bearish'
      ? 'bearish'
      : 'neutral';

  if (dataQuality < 3) {
    direction = 'neutral';
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
  const matrixCell = `${phil.supplyDemand?.state || 'balanced'}×${phil.financialEnvironment?.regime || 'neutral'}`;

  return {
    date: barDate || `T${tIndex}`,
    era: historicalContext.classifyEra(barDate),
    predictedMid: predictedMid != null ? +Number(predictedMid).toFixed(4) : null,
    compositeScore: +compositeScore.toFixed(4),
    philosophyScore: +philosophyScore.toFixed(4),
    adaptiveScore: +Number(adaptive.compositeScore ?? 0).toFixed(4),
    factorComposite: +factorComposite.toFixed(4),
    predictedDir,
    actualReturn: actualReturn != null ? +actualReturn.toFixed(4) : null,
    actualDir,
    hitDirection: hitDirection(predictedDir, actualDir),
    gapPct: gapPct != null ? +gapPct.toFixed(4) : null,
    dataQuality,
    financeRegime: phil.financialEnvironment?.regime,
    sdState: phil.supplyDemand?.state,
    histRegime,
    matrixCell,
    eventIds: eventCtx.eventIds,
    financeRegimeNext: phil.financialEnvironment?.regime || prevFinanceRegime,
  };
}

function aggregateEraStats(dayRows) {
  const byEra = {};
  for (const row of dayRows) {
    if (!row.era) continue;
    if (!byEra[row.era]) byEra[row.era] = { hits: 0, total: 0 };
    if (row.predictedDir && row.predictedDir !== 'neutral' && row.actualDir) {
      byEra[row.era].total += 1;
      if (row.hitDirection) byEra[row.era].hits += 1;
    }
  }
  const out = {};
  for (const era of historicalContext.BACKTEST_ERAS) {
    const s = byEra[era.id] || { hits: 0, total: 0 };
    out[era.id] = {
      label: era.label,
      hits: s.hits,
      total: s.total,
      hitRate: s.total > 0 ? +(s.hits / s.total).toFixed(4) : null,
    };
  }
  return out;
}

function aggregateMatrixStats(dayRows) {
  const byCell = {};
  for (const row of dayRows) {
    if (!row.matrixCell) continue;
    if (!byCell[row.matrixCell]) byCell[row.matrixCell] = { hits: 0, total: 0 };
    if (row.predictedDir && row.predictedDir !== 'neutral' && row.actualDir) {
      byCell[row.matrixCell].total += 1;
      if (row.hitDirection) byCell[row.matrixCell].hits += 1;
    }
  }
  const out = {};
  for (const [cell, s] of Object.entries(byCell)) {
    out[cell] = {
      hits: s.hits,
      total: s.total,
      hitRate: s.total > 0 ? +(s.hits / s.total).toFixed(4) : null,
    };
  }
  return out;
}

function aggregateLongrunInstrument(dayRows) {
  const scored = dayRows.filter((d) => d.predictedDir && d.predictedDir !== 'neutral' && d.actualDir);
  const hits = scored.filter((d) => d.hitDirection).length;
  const total = scored.length;
  const gaps = scored.filter((d) => d.gapPct != null).map((d) => Math.abs(d.gapPct));
  return {
    hits,
    total,
    hitRate: total > 0 ? hits / total : null,
    avgGapPct: gaps.length ? +(gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(4) : null,
    walkDays: dayRows.length,
    byEra: aggregateEraStats(dayRows),
    byMatrix: aggregateMatrixStats(dayRows),
    sampleLast30: dayRows.slice(-30).map(({ date, predictedDir, actualReturn, hitDirection, era }) => ({
      date,
      predictedDir,
      actualReturn,
      hitDirection,
      era,
    })),
  };
}

function aggregateLongrunByEra(allDayRows) {
  const byEra = {};
  for (const row of allDayRows) {
    if (!row.era) continue;
    if (!byEra[row.era]) byEra[row.era] = { hits: 0, total: 0, instruments: new Set() };
    byEra[row.era].instruments.add(row.instrumentId);
    if (row.predictedDir && row.predictedDir !== 'neutral' && row.actualDir) {
      byEra[row.era].total += 1;
      if (row.hitDirection) byEra[row.era].hits += 1;
    }
  }
  const out = {};
  for (const era of historicalContext.BACKTEST_ERAS) {
    const s = byEra[era.id] || { hits: 0, total: 0, instruments: new Set() };
    out[era.id] = {
      label: era.label,
      hits: s.hits,
      total: s.total,
      hitRate: s.total > 0 ? +(s.hits / s.total).toFixed(4) : null,
      instrumentCount: s.instruments?.size || 0,
    };
  }
  return out;
}

function aggregateLongrunBySector(instrumentResults) {
  const bySector = {};
  for (const inst of instrumentResults) {
    const sector = inst.sector || 'unknown';
    if (!bySector[sector]) bySector[sector] = { hits: 0, total: 0 };
    bySector[sector].hits += inst.hits || 0;
    bySector[sector].total += inst.total || 0;
  }
  const out = {};
  for (const [sector, s] of Object.entries(bySector)) {
    out[sector] = {
      hits: s.hits,
      total: s.total,
      hitRate: s.total > 0 ? +(s.hits / s.total).toFixed(4) : null,
    };
  }
  return out;
}

function runLongrunBacktest2019({ force = false, onProgress = null, writeAllInstruments = true } = {}) {
  if (backtestRunning) {
    return Promise.reject(new Error('回测已在运行中'));
  }

  if (!force) {
    const cached = loadLongrunSummary();
    if (cached?.runAt && cached.version === LONG_RUN_VERSION) {
      backtestProgress = { phase: 'done', pct: 100, message: '已加载缓存长周期回测', summary: cached };
      return Promise.resolve(cached);
    }
  }

  backtestRunning = true;
  backtestProgress = { phase: 'init', pct: 0, message: '初始化长周期回测…', mode: 'longrun-2019' };

  const t0 = Date.now();

  return Promise.resolve()
    .then(async () => {
      await historicalContext.ensureFredDailyCache();
      const weights = calibration.getCompositeWeights();
      const eligible = INSTRUMENT_REGISTRY.filter((spec) => readCachedKlines(spec.id).length >= MIN_BARS);

      backtestProgress = {
        phase: 'walk-forward',
        pct: 2,
        message: `长周期 walk-forward ${eligible.length} 品种…`,
        mode: 'longrun-2019',
      };
      onProgress?.(backtestProgress);

      const instrumentResults = [];
      const allFlatRows = [];
      const totalSteps = eligible.length;

      for (let i = 0; i < eligible.length; i += 1) {
        const spec = eligible[i];
        const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b) >= '2018-10-01');
        const startT = findWalkStartIndex(bars);
        const dayRows = [];
        let prevFinance = 'neutral';

        for (let t = startT; t < bars.length - 1; t += 1) {
          const row = predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance);
          if (row) {
            prevFinance = row.financeRegimeNext || prevFinance;
            dayRows.push(row);
            allFlatRows.push({ ...row, instrumentId: spec.id, sector: spec.sector });
          }
          if (t % 120 === 0) await new Promise((r) => setImmediate(r));
        }

        const agg = aggregateLongrunInstrument(dayRows);
        const instResult = {
          id: spec.id,
          name: spec.name,
          sector: spec.sector,
          barCount: bars.length,
          startDate: normBarDate(bars[startT]),
          endDate: normBarDate(bars[bars.length - 1]),
          ...agg,
        };
        instrumentResults.push(instResult);

        if (writeAllInstruments) {
          fs.writeFileSync(
            getLongrunInstrumentPath(spec.id),
            JSON.stringify(
              {
                id: spec.id,
                sector: spec.sector,
                ...agg,
              },
              null,
              2
            ),
            'utf8'
          );
        }

        const pct = Math.round(5 + ((i + 1) / totalSteps) * 90);
        backtestProgress = {
          phase: 'walk-forward',
          pct,
          message: `${spec.name || spec.id} (${i + 1}/${totalSteps})`,
          instrumentId: spec.id,
          mode: 'longrun-2019',
        };
        onProgress?.(backtestProgress);
        await new Promise((r) => setImmediate(r));
      }

      backtestProgress = { phase: 'aggregate', pct: 96, message: '汇总时代/板块…', mode: 'longrun-2019' };
      onProgress?.(backtestProgress);

      const allHits = instrumentResults.reduce((s, r) => s + (r.hits || 0), 0);
      const allTotal = instrumentResults.reduce((s, r) => s + (r.total || 0), 0);
      const byEra = aggregateLongrunByEra(allFlatRows);
      const bySector = aggregateLongrunBySector(instrumentResults);
      const byMatrix = aggregateMatrixStats(allFlatRows);
      const runtimeMs = Date.now() - t0;

      const dffSource = historicalContext.getDffAtDate('2024-01-01') != null ? 'fred-dff-cache+piecewise' : 'piecewise';

      const summary = {
        version: LONG_RUN_VERSION,
        mode: 'longrun-2019',
        runAt: new Date().toISOString(),
        periodFrom: LONG_RUN_START,
        periodTo: new Date().toISOString().slice(0, 10),
        runtimeMs,
        runtimeEstimate: `${Math.round(runtimeMs / 60000)} min`,
        instrumentCount: instrumentResults.length,
        skippedCount: INSTRUMENT_REGISTRY.length - instrumentResults.length,
        overallHitRate: allTotal > 0 ? +(allHits / allTotal).toFixed(4) : null,
        hits: allHits,
        total: allTotal,
        dataSources: {
          klines: 'Eastmoney/Sina → data/klines/commodity-{id}-day.json',
          dff: dffSource,
          vix: 'fred-vixcls-daily.json or piecewise',
          macroEvents: 'commodity-outlook-event-calendar HISTORICAL_EVENTS',
        },
        activeEventModel: 'sector-weighted-regime-v1.27',
        byEra,
        bySector,
        byMatrix,
        instruments: instrumentResults.map((r) => ({
          id: r.id,
          name: r.name,
          sector: r.sector,
          hitRate: r.hitRate,
          hits: r.hits,
          total: r.total,
          avgGapPct: r.avgGapPct,
          walkDays: r.walkDays,
          startDate: r.startDate,
          endDate: r.endDate,
        })),
        sampleHitRates: {
          au: instrumentResults.find((r) => String(r.id).toLowerCase() === 'au'),
          cu: instrumentResults.find((r) => String(r.id).toLowerCase() === 'cu'),
          FG: instrumentResults.find((r) => String(r.id).toLowerCase() === 'fg'),
          sc: instrumentResults.find((r) => String(r.id).toLowerCase() === 'sc'),
        },
      };

      fs.writeFileSync(getLongrunSummaryPath(), JSON.stringify(summary, null, 2), 'utf8');
      fs.writeFileSync(getLongrunByEraPath(), JSON.stringify({ runAt: summary.runAt, byEra, byMatrix }, null, 2), 'utf8');

      calibration.tuneWeightsFromLongrunBacktest(summary, allFlatRows);

      fs.writeFileSync(
        getLongrunEpochsPath(),
        JSON.stringify(
          {
            runAt: summary.runAt,
            version: LONG_RUN_VERSION,
            periodFrom: summary.periodFrom,
            periodTo: summary.periodTo,
            overallHitRate: summary.overallHitRate,
            byEra,
            byMatrix,
            epochWeights: calibration.loadCalibration(true).epochWeights || {},
            fedEraExamples: {
              '2020-04-01': historicalContext.getHistoricalFinanceEnvironment('2020-04-01'),
              '2022-06-15': historicalContext.getHistoricalFinanceEnvironment('2022-06-15'),
              '2024-01-01': historicalContext.getHistoricalFinanceEnvironment('2024-01-01'),
              '2026-03-01': historicalContext.getHistoricalFinanceEnvironment('2026-03-01'),
            },
          },
          null,
          2
        ),
        'utf8'
      );

      backtestProgress = { phase: 'done', pct: 100, message: '长周期回测完成', summary, mode: 'longrun-2019' };
      onProgress?.(backtestProgress);
      return summary;
    })
    .finally(() => {
      backtestRunning = false;
    });
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

  const sliceStart = Math.max(0, tIndex + 1 - 120);
  const slice = bars.slice(sliceStart, tIndex + 1);
  const bar = slice[slice.length - 1];
  const prev = slice[slice.length - 2];
  if (!bar?.close || !prev?.close) return null;

  const meta = getCommodityMeta(spec.id);
  const profile = getInstrumentProfile(spec.id);
  if (!meta || !profile) return null;

  const liveQuote = buildSyntheticQuote(bar, prev);
  const sectorPrior = getSectorVolPrior(spec.sector || profile.sector);
  const technical = analyzeInstrumentTechnicalsFromBars(spec.id, slice, liveQuote, {
    sectorPrior,
    skipVolPersist: true,
  });
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
  LONG_RUN_START,
  getBacktestRoot,
  getSummaryPath,
  getLongrunSummaryPath,
  getLongrunByEraPath,
  getLongrunEpochsPath,
  loadBacktestSummary,
  loadLongrunSummary,
  runOutlookBacktest,
  runLongrunBacktest2019,
  getBacktestProgress,
  predictAtBarIndex,
  predictAtBarIndexHistorical,
};
