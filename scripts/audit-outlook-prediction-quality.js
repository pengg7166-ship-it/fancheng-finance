/**
 * Audit outlook prediction quality across all instruments.
 * Flags: tick violations, pct-as-price, absurd bands, slot/daily conflation hints.
 *
 * Usage: FANCHENG_DATA_DRIVE=E node scripts/audit-outlook-prediction-quality.js [--json]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
diskCache.init(null);

const priceTick = require('../services/price-tick');
const { getAllCommodities } = require('../services/commodities-catalog');
const { getCachedCommodityOutlookSource, buildCommodityOutlookFromSources } = require('../services/commodity-outlook-engine');
const { getCachedAllData } = require('../services/data-fetcher');
const { getDataDir } = require('../services/data-paths');

const AS_JSON = process.argv.includes('--json');
const CHEMICAL_IDS = new Set(['fg', 'sa', 'ma', 'ta', 'eg', 'pp', 'l', 'v', 'ur', 'eb', 'pf', 'ru', 'br', 'px', 'sh', 'pr', 'ad']);

function readBars(id) {
  try {
    const dataRoot = getDataDir() || path.join(process.cwd(), 'data');
    const fp = path.join(dataRoot, 'history', 'trading', `${String(id).toUpperCase()}.json`);
    if (!fs.existsSync(fp)) return [];
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return [];
  }
}

function recentSessionRange(bars, n = 5) {
  if (!bars?.length) return null;
  const tail = bars.slice(-n);
  const ranges = tail.map((b) => (b.high ?? b.close) - (b.low ?? b.close)).filter((r) => r > 0);
  if (!ranges.length) return null;
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

function auditInstrument(inst) {
  const id = String(inst.id || '').toLowerCase();
  const flags = [];
  const price = Number(inst.price);
  const hl = inst.nextDayPrediction || inst.highLowPrediction || inst.nextDayRange;
  const hi = hl?.predictedHigh != null ? Number(hl.predictedHigh) : null;
  const lo = hl?.predictedLow != null ? Number(hl.predictedLow) : null;
  const base = hl?.baseClose ?? hl?.baseline ?? price;

  if (hi == null || lo == null) {
    flags.push({ code: 'missing_prediction', severity: 'high' });
    return { id, name: inst.name, flags };
  }

  if (!priceTick.isValidTickPrice(id, hi)) {
    flags.push({ code: 'tick_high', severity: 'medium', value: hi });
  }
  if (!priceTick.isValidTickPrice(id, lo)) {
    flags.push({ code: 'tick_low', severity: 'medium', value: lo });
  }

  if (priceTick.looksLikePctBand(hi, lo, base)) {
    flags.push({ code: 'pct_as_price', severity: 'high', hi, lo, base });
  }

  if (lo > hi) {
    flags.push({ code: 'inverted_band', severity: 'high', hi, lo });
  }

  if (price > 0) {
    const upDist = Math.abs(hi - price) / price;
    const downDist = Math.abs(price - lo) / price;
    const spread = (hi - lo) / price;
    if (upDist > 0.035 || downDist > 0.035) {
      flags.push({ code: 'band_far_from_price', severity: 'high', upDist: +upDist.toFixed(4), downDist: +downDist.toFixed(4), price, hi, lo });
    }
    if (spread > 0.055) {
      flags.push({ code: 'band_too_wide', severity: 'medium', spreadPct: +(spread * 100).toFixed(2), hi, lo, price });
    }
    if (spread < 0.004 && price > 50) {
      flags.push({ code: 'band_too_narrow', severity: 'low', spreadPct: +(spread * 100).toFixed(2) });
    }
  }

  if (inst.predictionSlot || inst.predictionSlotLabel) {
    flags.push({ code: 'slot_on_daily_row', severity: 'medium', slot: inst.predictionSlotLabel || inst.predictionSlot });
  }

  if (!inst.nextDayPrediction && inst.highLowPrediction) {
    flags.push({ code: 'missing_next_day_track', severity: 'low' });
  }

  const bars = readBars(id);
  const meanRange = recentSessionRange(bars);
  if (meanRange != null && base > 0) {
    const predSpread = hi - lo;
    if (predSpread > meanRange * 2.8) {
      flags.push({
        code: 'spread_vs_history',
        severity: CHEMICAL_IDS.has(id) ? 'high' : 'medium',
        predSpread: +predSpread.toFixed(2),
        meanRange: +meanRange.toFixed(2),
        ratio: +(predSpread / meanRange).toFixed(2),
      });
    }
  }

  return { id, name: inst.name, sector: inst.sector, price, base, hi, lo, method: hl?.method, flags };
}

function loadInstruments() {
  let cached = getCachedCommodityOutlookSource();
  if (cached?.instruments?.length) return cached.instruments;
  const sources = getCachedAllData()?.sources || {};
  try {
    const built = buildCommodityOutlookFromSources(sources);
    return built?.instruments || [];
  } catch {
    return [];
  }
}

function main() {
  const catalog = getAllCommodities();
  let instruments = loadInstruments();
  if (!instruments.length) {
    console.error('No outlook instruments — warm cache or run with live data.');
    process.exit(1);
  }

  const results = instruments.map(auditInstrument);
  const flagged = results.filter((r) => r.flags.length > 0);
  const byCode = {};
  for (const r of flagged) {
    for (const f of r.flags) {
      byCode[f.code] = (byCode[f.code] || 0) + 1;
    }
  }

  const summary = {
    auditedAt: new Date().toISOString(),
    instrumentCount: results.length,
    catalogCount: catalog.length,
    flaggedCount: flagged.length,
    flagCounts: byCode,
    chemicalFlagged: flagged.filter((r) => CHEMICAL_IDS.has(r.id)).map((r) => ({ id: r.id, flags: r.flags.map((f) => f.code) })),
    samples: flagged.slice(0, 12),
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ summary, results: flagged }, null, 2));
  } else {
    console.log(`\n=== Outlook prediction quality audit ===`);
    console.log(`Instruments: ${summary.instrumentCount} · Flagged: ${summary.flaggedCount}`);
    console.log(`Flag counts:`, byCode);
    console.log(`\nChemical sector flagged:`, summary.chemicalFlagged.length);
    for (const r of flagged) {
      const codes = r.flags.map((f) => f.code).join(', ');
      console.log(`  ${r.id.toUpperCase()} (${r.name}) price=${r.price} pred=${r.hi}~${r.lo} [${codes}]`);
    }
    const fg = results.find((r) => r.id === 'fg');
    if (fg) {
      console.log(`\n--- FG detail ---`);
      console.log(JSON.stringify(fg, null, 2));
    }
  }

  const logsDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), '..', 'logs');
  const outPath = path.join(logsDir, 'outlook-prediction-quality-audit.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
    if (!AS_JSON) console.log(`\nWrote ${outPath}`);
  } catch (err) {
    if (!AS_JSON) console.warn('Could not write audit log:', err.message);
  }

  process.exit(flagged.some((r) => r.flags.some((f) => f.severity === 'high')) ? 1 : 0);
}

main();
