/**
 * Model C v2 probe — filter / dir-model / flow-model / intersection KPI (au,ag,cu,rb · 2023-2025)
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E PHILOSOPHY_FILTER_V2=1 MODEL_C_V2=1 node scripts/probe-model-c-v2.js
 *   ... --from 2023-01-01 --to 2025-12-31
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';
process.env.PHILOSOPHY_FILTER_V2 = process.env.PHILOSOPHY_FILTER_V2 || '1';
process.env.MODEL_C_V2 = process.env.MODEL_C_V2 || '1';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const calibration = require('../services/commodity-outlook-calibration');
const philosophyFilter = require('../services/philosophy-direction-filter');
const modelCGate = require('../services/model-c-intersection-gate');
const { hitDirection } = require('../services/outlook-labels');

const PROBE_IDS = ['au', 'ag', 'cu', 'rb'];
const FROM = '2023-01-01';
const TO = '2025-12-31';
const OUT_TXT = path.join(process.cwd(), '_probe-model-c-v2-out.txt');
const OUT_JSON = path.join(process.cwd(), '_probe-model-c-v2-summary.json');
const STEP3_PASS_RATE = 35.45;

const CLI_IDS = [];

function parseArgs() {
  const args = process.argv.slice(2);
  let from = FROM;
  let to = TO;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id' && args[i + 1]) {
      CLI_IDS.push(String(args[++i]).toLowerCase());
      continue;
    }
    if (args[i] === '--from' && args[i + 1]) from = args[++i];
    else if (args[i] === '--to' && args[i + 1]) to = args[++i];
  }
  return { from, to, ids: CLI_IDS.length ? CLI_IDS : null };
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

function emptyKpiBucket() {
  return { scored: 0, hits: 0, hitRate: null, passOrSignal: 0, totalDays: 0 };
}

function bumpKpi(bucket, predictedDir, actualDir, signalEligible) {
  bucket.totalDays += 1;
  if (signalEligible) bucket.passOrSignal += 1;
  if (!predictedDir || predictedDir === 'neutral' || !actualDir) return;
  bucket.scored += 1;
  if (hitDirection(predictedDir, actualDir)) bucket.hits += 1;
}

function finalizeKpi(bucket) {
  bucket.hitRate = bucket.scored ? +((bucket.hits / bucket.scored) * 100).toFixed(2) : null;
  bucket.signalRatePct = bucket.totalDays
    ? +((bucket.passOrSignal / bucket.totalDays) * 100).toFixed(2)
    : null;
  return bucket;
}

function walkInstrument(spec, bars, window) {
  const weights = calibration.getCompositeWeights();
  let prevFinance = 'neutral';
  const kpi = {
    instrumentId: spec.id,
    filter: emptyKpiBucket(),
    dirModel: emptyKpiBucket(),
    flowModel: emptyKpiBucket(),
    intersection: emptyKpiBucket(),
  };

  for (let t = 60; t < bars.length - 1; t += 1) {
    const day = normBarDate(bars[t]);
    if (day < window.from || day > window.to) continue;

    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {
      philosophyFilterV2: true,
      modelCV2: true,
    });
    if (!row?.philosophyFilter) continue;
    prevFinance = row.financeRegimeNext || prevFinance;

    const f = row.philosophyFilter;
    const mc = row.modelC;
    const actualDir = row.actualDir;

    const filterDir =
      f.filterPass && f.effectivePhilosophyDir !== 0
        ? modelCGate.resolveEffectivePhilosophyLabel(f)
        : 'neutral';
    bumpKpi(kpi.filter, filterDir, actualDir, f.filterPass);

    const dirPred = mc?.dirModel?.direction || 'neutral';
    bumpKpi(kpi.dirModel, dirPred, actualDir, dirPred !== 'neutral');

    const flowEligible = Boolean(mc?.flowModel?.validFundSignal);
    const flowPred = flowEligible ? mc.flowModel.direction : 'neutral';
    bumpKpi(kpi.flowModel, flowPred, actualDir, flowEligible);

    const interEligible = Boolean(mc?.filterPass && mc?.intersectionSignal);
    const interPred = interEligible ? mc.intersectionSignal : 'neutral';
    bumpKpi(kpi.intersection, interPred, actualDir, interEligible);
  }

  for (const key of ['filter', 'dirModel', 'flowModel', 'intersection']) {
    finalizeKpi(kpi[key]);
  }
  return kpi;
}

function aggregateKpi(all, key) {
  const agg = { scored: 0, hits: 0, passOrSignal: 0, totalDays: 0 };
  for (const inst of all) {
    const b = inst[key];
    agg.scored += b.scored;
    agg.hits += b.hits;
    agg.passOrSignal += b.passOrSignal;
    agg.totalDays += b.totalDays;
  }
  return finalizeKpi(agg);
}

function formatTable(perInstrument, aggregate) {
  const lines = [];
  lines.push('| Instrument | Lane | Scored n | Hits | Hit % | Signal/Pass n | Signal % |');
  lines.push('|------------|------|----------|------|-------|---------------|----------|');
  const lanes = [
    ['filter', 'Philosophy filter'],
    ['dirModel', 'Direction model'],
    ['flowModel', 'Volume/OI flow'],
    ['intersection', 'Intersection'],
  ];
  for (const inst of perInstrument) {
    for (const [key, label] of lanes) {
      const b = inst[key];
      lines.push(
        `| ${inst.instrumentId} | ${label} | ${b.scored} | ${b.hits} | ${b.hitRate ?? '—'} | ${b.passOrSignal} | ${b.signalRatePct ?? '—'} |`,
      );
    }
  }
  lines.push('');
  lines.push('**Aggregate**');
  for (const [key, label] of lanes) {
    const b = aggregate[key];
    lines.push(
      `${label}: scored=${b.scored} hitRate=${b.hitRate ?? '—'}% signal=${b.passOrSignal}/${b.totalDays} (${b.signalRatePct ?? '—'}%)`,
    );
  }
  return lines.join('\n');
}

function formatReport(payload) {
  const lines = [];
  lines.push('=== Model C v2 Probe (Step 4) ===');
  lines.push(`Gate: ${modelCGate.GATE_VERSION} · Filter: ${philosophyFilter.FILTER_VERSION}`);
  lines.push(`Window: ${payload.window.from} → ${payload.window.to}`);
  lines.push(`PHILOSOPHY_FILTER_V2=${process.env.PHILOSOPHY_FILTER_V2} MODEL_C_V2=${process.env.MODEL_C_V2}`);
  lines.push('');
  lines.push(formatTable(payload.perInstrument, payload.aggregate));
  lines.push('');
  lines.push(`Step 3 filter pass rate (baseline): ${STEP3_PASS_RATE}%`);
  lines.push(
    `Step 4 filter pass rate: ${payload.aggregate.filter.signalRatePct}% (${payload.aggregate.filter.passOrSignal}/${payload.aggregate.filter.totalDays})`,
  );
  lines.push(
    `Intersection signal rate: ${payload.aggregate.intersection.signalRatePct}% (${payload.aggregate.intersection.passOrSignal}/${payload.aggregate.intersection.totalDays})`,
  );
  lines.push(
    `Intersection hit rate (live KPI target ≥75%): ${payload.aggregate.intersection.hitRate ?? '—'}% (n=${payload.aggregate.intersection.scored})`,
  );
  return lines.join('\n');
}

async function main() {
  const { from, to, ids } = parseArgs();
  const window = { from, to };
  const probeIds = ids || PROBE_IDS;
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  if (!philosophyFilter.isEnabled() || !modelCGate.isEnabled()) {
    console.warn('Probe forces PHILOSOPHY_FILTER_V2=1 and MODEL_C_V2=1 via env defaults');
  }

  const perInstrument = [];
  for (const id of probeIds) {
    const spec = findSpec(id);
    const bars = loadBars(id);
    if (!spec || bars.length < 62) {
      console.warn(`skip ${id}: missing spec or bars`);
      continue;
    }
    console.log(`walking ${id} (${bars.length} bars)...`);
    perInstrument.push(walkInstrument(spec, bars, window));
  }

  const aggregate = {
    filter: aggregateKpi(perInstrument, 'filter'),
    dirModel: aggregateKpi(perInstrument, 'dirModel'),
    flowModel: aggregateKpi(perInstrument, 'flowModel'),
    intersection: aggregateKpi(perInstrument, 'intersection'),
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    filterVersion: philosophyFilter.FILTER_VERSION,
    modelCVersion: modelCGate.GATE_VERSION,
    window,
    step3PassRatePct: STEP3_PASS_RATE,
    perInstrument,
    aggregate,
  };

  const report = formatReport(payload);
  console.log('\n' + report);
  fs.writeFileSync(OUT_TXT, report + '\n', 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${OUT_TXT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
