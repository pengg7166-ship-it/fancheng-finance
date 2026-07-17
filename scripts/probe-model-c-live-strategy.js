/**
 * Model C live strategy probe — audit_relaxed vs live_high_hit tiers.
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/probe-model-c-live-strategy.js
 *   ... --from 2023-01-01 --to 2025-12-31
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';
process.env.PHILOSOPHY_FILTER_V2 = '1';
process.env.MODEL_C_V2 = '1';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const calibration = require('../services/commodity-outlook-calibration');
const liveStrategy = require('../services/model-c-live-strategy');
const { hitDirection } = require('../services/outlook-labels');

const PROBE_IDS = ['au', 'ag', 'cu', 'rb'];
const FROM = '2023-01-01';
const TO = '2025-12-31';
const OUT_TXT = path.join(process.cwd(), '_probe-model-c-live-strategy-out.txt');
const OUT_JSON = path.join(process.cwd(), '_probe-model-c-live-strategy-summary.json');

const TIERS = ['audit_relaxed', 'live_high_hit'];

function parseArgs() {
  const args = process.argv.slice(2);
  let from = FROM;
  let to = TO;
  const ids = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id' && args[i + 1]) {
      ids.push(String(args[++i]).toLowerCase());
      continue;
    }
    if (args[i] === '--from' && args[i + 1]) from = args[++i];
    else if (args[i] === '--to' && args[i + 1]) to = args[++i];
  }
  return { from, to, ids: ids.length ? ids : PROBE_IDS };
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadBars(id) {
  const fp = path.join(getDataDir(), 'history', 'trading', `${id}.json`);
  if (!fs.existsSync(fp)) return [];
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return (Array.isArray(raw) ? raw : raw.series || [])
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function findSpec(id) {
  return INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === String(id).toLowerCase());
}

function emptyBucket() {
  return {
    totalDays: 0,
    intersectionSignals: 0,
    intersectionScored: 0,
    intersectionHits: 0,
    tradableForLive: 0,
  };
}

function finalizeBucket(bucket) {
  bucket.signalRatePct = bucket.totalDays
    ? +((bucket.intersectionSignals / bucket.totalDays) * 100).toFixed(2)
    : null;
  bucket.intersectionHitPct = bucket.intersectionScored
    ? +((bucket.intersectionHits / bucket.intersectionScored) * 100).toFixed(2)
    : null;
  bucket.tradableRatePct = bucket.totalDays
    ? +((bucket.tradableForLive / bucket.totalDays) * 100).toFixed(2)
    : null;
  return bucket;
}

function walkInstrumentTier(spec, bars, window, tierId) {
  liveStrategy.applyTierEnv(tierId, { sector: spec.sector, instrumentId: spec.id });

  const weights = calibration.getCompositeWeights();
  let prevFinance = 'neutral';
  const bucket = emptyBucket();

  for (let t = 60; t < bars.length - 1; t += 1) {
    const day = normBarDate(bars[t]);
    if (day < window.from || day > window.to) continue;

    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {
      philosophyFilterV2: true,
      modelCV2: true,
    });
    if (!row?.philosophyFilter) continue;
    prevFinance = row.financeRegimeNext || prevFinance;

    bucket.totalDays += 1;
    const mc = row.modelC;
    const intersection = Boolean(mc?.filterPass && mc?.intersectionSignal);
    if (intersection) bucket.intersectionSignals += 1;

    if (intersection && row.actualDir) {
      bucket.intersectionScored += 1;
      if (hitDirection(mc.intersectionSignal, row.actualDir)) bucket.intersectionHits += 1;
    }

    if (mc?.tradableForLive === true) bucket.tradableForLive += 1;
  }

  return finalizeBucket({
    instrumentId: spec.id,
    sector: spec.sector,
    tierId,
    tierPreset: liveStrategy.resolveTierConfig(tierId, spec.sector, spec.id),
    ...bucket,
  });
}

function aggregateBuckets(perInst) {
  const agg = emptyBucket();
  for (const b of perInst) {
    agg.totalDays += b.totalDays;
    agg.intersectionSignals += b.intersectionSignals;
    agg.intersectionScored += b.intersectionScored;
    agg.intersectionHits += b.intersectionHits;
    agg.tradableForLive += b.tradableForLive;
  }
  return finalizeBucket(agg);
}

function formatLines(summary) {
  const lines = [];
  lines.push('=== Model C Live Strategy Probe ===');
  lines.push(`Window: ${summary.window.from} → ${summary.window.to}`);
  lines.push(`Manifest: ${summary.manifestPath || 'default'}`);
  lines.push(`Strategy: ${liveStrategy.STRATEGY_MODE} · ${liveStrategy.STRATEGY_VERSION}`);
  lines.push('');

  for (const tierId of TIERS) {
    const tierBlock = summary.byTier[tierId];
    lines.push(`--- ${tierId} ---`);
    const agg = tierBlock.aggregate;
    lines.push(
      `ALL: days=${agg.totalDays} intersection=${agg.intersectionSignals} signalRate=${agg.signalRatePct}% hit=${agg.intersectionHitPct}% (n=${agg.intersectionScored}) tradableForLive=${agg.tradableForLive} (${agg.tradableRatePct}%)`,
    );
    for (const inst of tierBlock.instruments) {
      lines.push(
        `  ${inst.instrumentId}: signal=${inst.intersectionSignals}/${inst.totalDays} (${inst.signalRatePct}%) hit=${inst.intersectionHitPct}% (n=${inst.intersectionScored}) tradable=${inst.tradableForLive}`,
      );
    }
    lines.push('');
  }

  lines.push('--- Tier delta (live_high_hit vs audit_relaxed) ---');
  const audit = summary.byTier.audit_relaxed.aggregate;
  const live = summary.byTier.live_high_hit.aggregate;
  lines.push(
    `signalRate: ${audit.signalRatePct}% → ${live.signalRatePct}% (${+(live.signalRatePct - audit.signalRatePct).toFixed(2)}pp)`,
  );
  lines.push(
    `intersection hit: ${audit.intersectionHitPct}% (n=${audit.intersectionScored}) → ${live.intersectionHitPct}% (n=${live.intersectionScored})`,
  );
  lines.push(`tradableForLive: ${audit.tradableForLive} → ${live.tradableForLive}`);
  return lines.join('\n');
}

async function main() {
  const { from, to, ids } = parseArgs();
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const manifestPath = liveStrategy.getManifestPath();
  const summary = {
    generatedAt: new Date().toISOString(),
    window: { from, to },
    instruments: ids,
    manifestPath,
    strategyMode: liveStrategy.STRATEGY_MODE,
    strategyVersion: liveStrategy.STRATEGY_VERSION,
    byTier: {},
  };

  for (const tierId of TIERS) {
    const perInst = [];
    for (const id of ids) {
      const spec = findSpec(id);
      if (!spec) continue;
      const bars = loadBars(id);
      if (bars.length < 60) continue;
      console.log(`walking ${id} tier=${tierId}...`);
      perInst.push(walkInstrumentTier(spec, bars, { from, to }, tierId));
    }
    summary.byTier[tierId] = {
      instruments: perInst,
      aggregate: aggregateBuckets(perInst),
    };
  }

  const text = formatLines(summary);
  fs.writeFileSync(OUT_TXT, text, 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), 'utf8');
  console.log(text);
  console.log(`\nWrote ${OUT_TXT}`);
  console.log(`Wrote ${OUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
