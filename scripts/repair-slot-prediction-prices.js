/**

 * Repair slot snapshots & range archive rows:

 * - pct offsets stored as predHigh/predLow

 * - predictions not aligned to exchange tick size

 *

 * FANCHENG_DATA_DRIVE=E node scripts/repair-slot-prediction-prices.js [--id fg] [--force]

 */

const fs = require('fs');

const path = require('path');



process.chdir(path.join(__dirname, '..'));

process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';



const priceTick = require('../services/price-tick');

const rangeArchive = require('../services/range-prediction-archive');

const { getOutlookHistoryRoot } = require('../services/commodity-outlook-history');

const { getAllCommodities } = require('../services/commodities-catalog');



const rawArgs = process.argv.slice(2);

const IDS = [];

let FORCE = false;

for (let i = 0; i < rawArgs.length; i += 1) {

  const a = rawArgs[i];

  if (a === '--force') {

    FORCE = true;

    continue;

  }

  if (a === '--id' && rawArgs[i + 1]) {

    IDS.push(String(rawArgs[i + 1]).toLowerCase());

    i += 1;

    continue;

  }

  if (a.startsWith('--id=')) IDS.push(a.slice(5).toLowerCase());

}



function targetIds() {

  if (IDS.length) return IDS;

  return getAllCommodities().map((m) => String(m.id).toLowerCase());

}



function repairEntryPrices(entry) {

  if (!entry?.id) return { fixed: false, pct: false, tick: false };

  const base = entry.baseClose ?? entry.priceAtPredict;

  let pct = false;

  let tick = false;



  if (priceTick.looksLikePctBand(entry.predictedHigh, entry.predictedLow, base)) {

    const prices = priceTick.pctBandToPrices({

      instrumentId: entry.id,

      baseClose: base,

      lowPct: entry.predictedLowPct ?? entry.predictedLow,

      highPct: entry.predictedHighPct ?? entry.predictedHigh,

    });

    entry.predictedLowPct = entry.predictedLowPct ?? entry.predictedLow;

    entry.predictedHighPct = entry.predictedHighPct ?? entry.predictedHigh;

    entry.predictedMidPct = entry.predictedMidPct ?? entry.predictedMid;

    entry.predictedLow = prices.predictedLow;

    entry.predictedHigh = prices.predictedHigh;

    pct = true;

  }



  const hi = priceTick.roundPriceToTick(entry.id, entry.predictedHigh);

  const lo = priceTick.roundPriceToTick(entry.id, entry.predictedLow);

  if (hi != null && hi !== entry.predictedHigh) {

    entry.predictedHigh = hi;

    tick = true;

  }

  if (lo != null && lo !== entry.predictedLow) {

    entry.predictedLow = lo;

    tick = true;

  }



  return { fixed: pct || tick, pct, tick };

}



function repairSlotSnapshotFile(fp) {

  const snap = JSON.parse(fs.readFileSync(fp, 'utf8'));

  let fixed = 0;

  let pctFixed = 0;

  let tickFixed = 0;

  for (const entry of snap.instruments || []) {

    const r = repairEntryPrices(entry);

    if (r.fixed) {

      fixed += 1;

      if (r.pct) pctFixed += 1;

      if (r.tick) tickFixed += 1;

    }

  }

  if (fixed > 0 || FORCE) {

    fs.writeFileSync(fp, JSON.stringify(snap, null, 2), 'utf8');

  }

  return { fixed, pctFixed, tickFixed };

}



function repairSlotSnapshots() {

  const root = path.join(getOutlookHistoryRoot() || '', 'slot-snapshots');

  if (!fs.existsSync(root)) return { files: 0, entries: 0, pctFixed: 0, tickFixed: 0 };

  let files = 0;

  let entries = 0;

  let pctFixed = 0;

  let tickFixed = 0;

  for (const day of fs.readdirSync(root)) {

    const dayDir = path.join(root, day);

    if (!fs.statSync(dayDir).isDirectory()) continue;

    for (const f of fs.readdirSync(dayDir)) {

      if (!f.endsWith('.json')) continue;

      const n = repairSlotSnapshotFile(path.join(dayDir, f));

      if (n.fixed > 0) {

        files += 1;

        entries += n.fixed;

        pctFixed += n.pctFixed;

        tickFixed += n.tickFixed;

      }

    }

  }

  return { files, entries, pctFixed, tickFixed };

}



function repairRangeArchive(id) {

  const lines = rangeArchive.readArchiveLines(id);

  let fixed = 0;

  let pctFixed = 0;

  let tickFixed = 0;

  const next = lines.map((row) => {

    if (!row.predictionSlot) return row;

    const beforeHi = row.predHigh;

    const beforeLo = row.predLow;

    const normalized = rangeArchive.normalizeSlotPredPrices(row);

    const changed =

      normalized.predHigh !== beforeHi ||

      normalized.predLow !== beforeLo ||

      normalized.meta?.pctCorrected;

    if (!changed) return row;

    fixed += 1;

    if (normalized.meta?.pctCorrected) pctFixed += 1;

    if (

      !normalized.meta?.pctCorrected &&

      (normalized.predHigh !== beforeHi || normalized.predLow !== beforeLo)

    ) {

      tickFixed += 1;

    }

    const cmp = rangeArchive.computeRangeComparison({

      predHigh: normalized.predHigh,

      predLow: normalized.predLow,

      actualHigh: row.actualHigh,

      actualLow: row.actualLow,

      status: row.actualHigh != null ? row.status || 'complete' : 'pending',

    });

    return {

      ...row,

      predHigh: normalized.predHigh,

      predLow: normalized.predLow,

      predRange: cmp.predRange,

      actualRange: cmp.actualRange,

      highHit: cmp.highHit,

      lowHit: cmp.lowHit,

      bandHit: cmp.bandHit,

      highError: cmp.highError,

      lowError: cmp.lowError,

      status: cmp.status,

      meta: normalized.meta,

      updatedAt: new Date().toISOString(),

    };

  });

  if (fixed > 0) rangeArchive.writeArchiveLines(id, next);

  const refresh = rangeArchive.refreshSlotArchiveActuals(id, { force: fixed > 0, lookbackDays: 60 });

  return { id, fixed, pctFixed, tickFixed, refreshed: refresh.refreshed };

}



function main() {

  const ids = targetIds();

  const snap = repairSlotSnapshots();

  const archiveResults = ids.map(repairRangeArchive);

  const summary = {

    slotSnapshotFiles: snap.files,

    slotSnapshotEntries: snap.entries,

    slotPctFixed: snap.pctFixed,

    slotTickFixed: snap.tickFixed,

    archives: archiveResults.filter((r) => r.fixed > 0 || r.refreshed > 0),

    archiveFixedTotal: archiveResults.reduce((s, r) => s + (r.fixed || 0), 0),

    ranAt: new Date().toISOString(),

  };

  console.log(JSON.stringify(summary, null, 2));

}



main();

