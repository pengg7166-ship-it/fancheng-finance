/**
 * Philosophy Filter v2 probe — au, ag, cu, rb sample 2023-2025
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/probe-philosophy-filter-v2.js
 *   FANCHENG_DATA_DRIVE=E PHILOSOPHY_FILTER_V2=1 node scripts/probe-philosophy-filter-v2.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';
process.env.PHILOSOPHY_FILTER_V2 = process.env.PHILOSOPHY_FILTER_V2 || '1';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const philosophyFilter = require('../services/philosophy-direction-filter');
const calibration = require('../services/commodity-outlook-calibration');

const PROBE_IDS = ['au', 'ag', 'cu', 'rb'];
const FROM = '2023-01-01';
const TO = '2025-12-31';
const OUT_TXT = path.join(process.cwd(), '_probe-philosophy-filter-v2-out.txt');

function parseArgs() {
  const args = process.argv.slice(2);
  let from = FROM;
  let to = TO;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--from' && args[i + 1]) from = args[++i];
    else if (args[i] === '--to' && args[i + 1]) to = args[++i];
  }
  return { from, to };
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

function walkInstrument(spec, bars, window) {
  const weights = calibration.getCompositeWeights();
  let prevFinance = 'neutral';
  const stats = {
    instrumentId: spec.id,
    total: 0,
    filterPass: 0,
    filterFail: 0,
    policyDays: 0,
    eventDays: 0,
    neutralReasons: {},
    warehouseScaleSum: 0,
    pricedInSum: 0,
    pricedInMin: 1,
    pricedInMax: 0,
    pricedInByDayType: { routine: { n: 0, sum: 0 }, policy: { n: 0, sum: 0 }, event: { n: 0, sum: 0 } },
    pricedInModes: { none: 0, partial: 0, full: 0 },
  };

  for (let t = 60; t < bars.length - 1; t += 1) {
    const day = normBarDate(bars[t]);
    if (day < window.from || day > window.to) continue;

    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {
      philosophyFilterV2: true,
    });
    if (!row?.philosophyFilter) continue;
    prevFinance = row.financeRegimeNext || prevFinance;

    const f = row.philosophyFilter;
    stats.total += 1;
    if (f.filterPass) stats.filterPass += 1;
    else {
      stats.filterFail += 1;
      const reason = f.neutralReason || 'unknown';
      stats.neutralReasons[reason] = (stats.neutralReasons[reason] || 0) + 1;
    }
    if (f.policyDay) stats.policyDays += 1;
    if (f.eventDay) stats.eventDays += 1;
    stats.warehouseScaleSum += f.warehouseWeightScale ?? 0;

    const pi = typeof f.pricedIn === 'object' ? f.pricedIn?.score : f.pricedIn;
    if (pi != null && !Number.isNaN(Number(pi))) {
      const n = Number(pi);
      stats.pricedInSum += n;
      stats.pricedInMin = Math.min(stats.pricedInMin, n);
      stats.pricedInMax = Math.max(stats.pricedInMax, n);
      const dt = f.dayType || 'routine';
      if (!stats.pricedInByDayType[dt]) stats.pricedInByDayType[dt] = { n: 0, sum: 0 };
      stats.pricedInByDayType[dt].n += 1;
      stats.pricedInByDayType[dt].sum += n;
      const mode = f.pricedIn?.mode || 'none';
      stats.pricedInModes[mode] = (stats.pricedInModes[mode] || 0) + 1;
    }
  }

  stats.passRatePct = stats.total ? +((stats.filterPass / stats.total) * 100).toFixed(2) : null;
  stats.avgWarehouseScale = stats.total
    ? +((stats.warehouseScaleSum / stats.total).toFixed(4))
    : null;
  stats.avgPricedIn = stats.total ? +((stats.pricedInSum / stats.total).toFixed(4)) : null;
  for (const [k, v] of Object.entries(stats.pricedInByDayType)) {
    v.avg = v.n ? +((v.sum / v.n).toFixed(4)) : null;
  }
  if (stats.pricedInMin > stats.pricedInMax) {
    stats.pricedInMin = null;
    stats.pricedInMax = null;
  }
  return stats;
}

function aggregate(all) {
  const agg = {
    instruments: all.length,
    total: 0,
    filterPass: 0,
    filterFail: 0,
    policyDays: 0,
    eventDays: 0,
    neutralReasons: {},
    pricedInSum: 0,
    pricedInMin: 1,
    pricedInMax: 0,
    pricedInByDayType: { routine: { n: 0, sum: 0 }, policy: { n: 0, sum: 0 }, event: { n: 0, sum: 0 } },
    pricedInModes: { none: 0, partial: 0, full: 0 },
  };
  for (const s of all) {
    agg.total += s.total;
    agg.filterPass += s.filterPass;
    agg.filterFail += s.filterFail;
    agg.policyDays += s.policyDays;
    agg.eventDays += s.eventDays;
    agg.pricedInSum += s.pricedInSum || 0;
    if (s.pricedInMin != null) agg.pricedInMin = Math.min(agg.pricedInMin, s.pricedInMin);
    if (s.pricedInMax != null) agg.pricedInMax = Math.max(agg.pricedInMax, s.pricedInMax);
    for (const [k, v] of Object.entries(s.neutralReasons)) {
      agg.neutralReasons[k] = (agg.neutralReasons[k] || 0) + v;
    }
    for (const [dt, bucket] of Object.entries(s.pricedInByDayType || {})) {
      if (!agg.pricedInByDayType[dt]) agg.pricedInByDayType[dt] = { n: 0, sum: 0 };
      agg.pricedInByDayType[dt].n += bucket.n || 0;
      agg.pricedInByDayType[dt].sum += bucket.sum || 0;
    }
    for (const [mode, count] of Object.entries(s.pricedInModes || {})) {
      agg.pricedInModes[mode] = (agg.pricedInModes[mode] || 0) + count;
    }
  }
  agg.passRatePct = agg.total ? +((agg.filterPass / agg.total) * 100).toFixed(2) : null;
  agg.avgPricedIn = agg.total ? +((agg.pricedInSum / agg.total).toFixed(4)) : null;
  for (const [k, v] of Object.entries(agg.pricedInByDayType)) {
    v.avg = v.n ? +((v.sum / v.n).toFixed(4)) : null;
  }
  if (agg.pricedInMin > agg.pricedInMax) {
    agg.pricedInMin = null;
    agg.pricedInMax = null;
  }
  return agg;
}

function formatReport(payload) {
  const lines = [];
  lines.push('=== Philosophy Filter v2 Probe ===');
  lines.push(`Version: ${philosophyFilter.FILTER_VERSION}`);
  lines.push(`Window: ${payload.window.from} → ${payload.window.to}`);
  lines.push(`PHILOSOPHY_FILTER_V2=${process.env.PHILOSOPHY_FILTER_V2}`);
  lines.push('');
  lines.push('--- Per instrument ---');
  for (const s of payload.perInstrument) {
    lines.push(
      `${s.instrumentId}: n=${s.total} pass=${s.passRatePct}% policyDays=${s.policyDays} eventDays=${s.eventDays} avgWhScale=${s.avgWarehouseScale} avgPi=${s.avgPricedIn}`,
    );
    lines.push(`  neutralReasons: ${JSON.stringify(s.neutralReasons)}`);
    lines.push(`  pricedInModes: ${JSON.stringify(s.pricedInModes)}`);
  }
  lines.push('');
  lines.push('--- Aggregate ---');
  lines.push(`Total rows: ${payload.aggregate.total}`);
  lines.push(`Filter pass rate: ${payload.aggregate.passRatePct}% (${payload.aggregate.filterPass}/${payload.aggregate.total})`);
  lines.push(`Step 2 baseline pass rate: 35.45% (1031/2908)`);
  lines.push(`Policy day count: ${payload.aggregate.policyDays}`);
  lines.push(`Event day count: ${payload.aggregate.eventDays}`);
  lines.push(`PricedIn avg/min/max: ${payload.aggregate.avgPricedIn} / ${payload.aggregate.pricedInMin} / ${payload.aggregate.pricedInMax}`);
  lines.push(`PricedIn by dayType (avg pi): ${JSON.stringify(payload.aggregate.pricedInByDayType)}`);
  lines.push(`PricedIn modes: ${JSON.stringify(payload.aggregate.pricedInModes)}`);
  lines.push(`Neutral reasons: ${JSON.stringify(payload.aggregate.neutralReasons, null, 2)}`);
  return lines.join('\n');
}

async function main() {
  const window = parseArgs();
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  if (!philosophyFilter.isEnabled()) {
    console.warn('PHILOSOPHY_FILTER_V2 not enabled — probe forces philosophyFilterV2 option in backtest');
  }

  const perInstrument = [];
  for (const id of PROBE_IDS) {
    const spec = findSpec(id);
    const bars = loadBars(id);
    if (!spec || bars.length < 62) {
      console.warn(`skip ${id}: missing spec or bars`);
      continue;
    }
    console.log(`walking ${id} (${bars.length} bars)...`);
    perInstrument.push(walkInstrument(spec, bars, window));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    filterVersion: philosophyFilter.FILTER_VERSION,
    window,
    perInstrument,
    aggregate: aggregate(perInstrument),
  };

  const report = formatReport(payload);
  console.log('\n' + report);
  fs.writeFileSync(OUT_TXT, report + '\n', 'utf8');
  fs.writeFileSync(
    path.join(process.cwd(), '_probe-philosophy-filter-v2-summary.json'),
    JSON.stringify(payload, null, 2),
  );
  console.log(`\nWrote ${OUT_TXT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
