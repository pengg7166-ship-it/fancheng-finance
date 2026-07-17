/**
 * 跨资产 regime 快速探针 — 仅哲学层 AU/AG 方向命中率（有/无因子）
 */
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getDataDir, getUserDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines, analyzeInstrumentTechnicalsFromBars } = require('../services/commodity-technical-analyzer');
const newsTagged = require('../services/news-tagged-loader');
const philosophy = require('../services/commodity-outlook-philosophy');
const crossAsset = require('../services/commodity-cross-asset-regime');
const { getCommodityMeta } = require('../services/commodities-catalog');
const { getInstrumentProfile } = require('../services/commodity-instrument-profiles');
const eventCalendar = require('../services/commodity-outlook-event-calendar');
const calibration = require('../services/commodity-outlook-calibration');

const PROBE_FROM = '2019-01-01';
const PROBE_TO = '2025-12-31';
const STEP = 5;

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function dirFromScore(score, th = 0.12) {
  if (score >= th) return 'bullish';
  if (score <= -th) return 'bearish';
  return 'neutral';
}

function dirFromReturn(ret, th = 0.05) {
  if (ret == null) return null;
  if (ret >= th) return 'bullish';
  if (ret <= -th) return 'bearish';
  return 'neutral';
}

function hit(a, b) {
  return a && b && a !== 'neutral' && b !== 'neutral' && a === b;
}

function buildQuote(bar, prev) {
  const close = Number(bar.close);
  const prevClose = Number(prev?.close ?? close);
  return {
    price: close,
    close,
    changePct: prevClose ? ((close - prevClose) / prevClose) * 100 : 0,
  };
}

function walkPhilosophy(spec, bars, skipCrossAsset) {
  let hits = 0;
  let total = 0;
  const meta = getCommodityMeta(spec.id);
  const profile = getInstrumentProfile(spec.id);
  if (!meta || !profile) return { hits: 0, total: 0, rate: 0 };

  for (let t = 60; t < bars.length - 1; t += STEP) {
    const barDate = normBarDate(bars[t]);
    if (barDate < PROBE_FROM || barDate > PROBE_TO) continue;
    const slice = bars.slice(Math.max(0, t + 1 - 120), t + 1);
    const bar = slice[slice.length - 1];
    const prev = slice[slice.length - 2];
    if (!bar?.close || !prev?.close) continue;

    const sources = historicalContext.buildHistoricalSources(barDate);
    const eventCtx = eventCalendar.getActiveEventsMerged(barDate, { instrumentId: spec.id, sector: spec.sector });
    const liveQuote = buildQuote(bar, prev);
    const technical = analyzeInstrumentTechnicalsFromBars(spec.id, slice, liveQuote, {
      skipVolPersist: true,
      skipOiPersist: true,
    });
    if (!technical?.hasEnough) continue;

    const newsImpact = { score: 0, hits: [], hitCount: 0, shock: 0 };

    const phil = philosophy.evaluateInstrumentPhilosophy({
      meta,
      profile,
      spec,
      sources,
      technical,
      liveQuote,
      newsImpact,
      changePct: liveQuote.changePct,
      skipRegimePersistence: true,
      eventMultipliers: eventCtx.weightMultipliers,
      eventCtx: calibration.mergeSectorIntoEventMultipliers(eventCtx, spec.sector),
      asOfDate: barDate,
      klines: slice,
      skipCrossAsset,
    });

    const pred = dirFromScore(phil.compositeScore);
    const next = bars[t + 1];
    const ret = ((Number(next.close) - Number(bar.close)) / Number(bar.close)) * 100;
    const actual = dirFromReturn(ret);
    if (pred === 'neutral' || !actual) continue;
    total += 1;
    if (hit(pred, actual)) hits += 1;
  }
  return { hits, total, rate: total ? hits / total : 0 };
}

async function main() {
  diskCache.init(getDataDir() || getUserDataDir() || 'data');
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged();

  const stats = crossAsset.computeRegimeStats(PROBE_FROM, PROBE_TO);
  console.log(`philosophy ${philosophy.PHILOSOPHY_VERSION} | cross-asset ${crossAsset.CROSS_ASSET_VERSION}`);
  console.log('\n=== Regime 分布 ===');
  for (const id of crossAsset.REGIME_IDS) {
    console.log(`  ${crossAsset.REGIME_LABELS[id]}: ${stats.counts[id]} (${stats.pct[id]}%)`);
  }
  console.log('\n=== 时代相关系数 (20d) ===');
  for (const [era, s] of Object.entries(stats.eraStats)) {
    console.log(`  ${era}: AU-SC=${s.avgCorrAuOil20} AU-SP=${s.avgCorrAuSp20}`);
  }

  let wH = 0;
  let wT = 0;
  let woH = 0;
  let woT = 0;

  for (const spec of INSTRUMENT_REGISTRY.filter((s) => s.id === 'au' || s.id === 'ag')) {
    const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b) >= '2018-10-01');
    const withF = walkPhilosophy(spec, bars, false);
    const withoutF = walkPhilosophy(spec, bars, true);
    wH += withF.hits;
    wT += withF.total;
    woH += withoutF.hits;
    woT += withoutF.total;
    const d = (withF.rate - withoutF.rate) * 100;
    console.log(
      `\n${spec.id} 哲学方向: WITH ${(withF.rate * 100).toFixed(1)}% | WITHOUT ${(withoutF.rate * 100).toFixed(1)}% | Δ ${d >= 0 ? '+' : ''}${d.toFixed(1)}pp`
    );
  }

  const delta = ((wT ? wH / wT : 0) - (woT ? woH / woT : 0)) * 100;
  console.log(`\nAU+AG 合计 Δ: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp (${wH}/${wT} vs ${woH}/${woT})`);

  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'cross-asset-regime-stats.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        philosophyVersion: philosophy.PHILOSOPHY_VERSION,
        crossAssetVersion: crossAsset.CROSS_ASSET_VERSION,
        probeFrom: PROBE_FROM,
        probeTo: PROBE_TO,
        regimeStats: stats,
        philosophyDirectionHitRate: {
          withFactor: { hits: wH, total: wT, rate: wT ? +(wH / wT).toFixed(4) : 0 },
          withoutFactor: { hits: woH, total: woT, rate: woT ? +(woH / woT).toFixed(4) : 0 },
          deltaPp: +delta.toFixed(2),
        },
      },
      null,
      2
    ),
    'utf8'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
