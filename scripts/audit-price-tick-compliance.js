/**

 * Audit all outlook instruments — predictions must align to exchange tick size.

 * FANCHENG_DATA_DRIVE=E node scripts/audit-price-tick-compliance.js [--fix]

 */

const fs = require('fs');

const path = require('path');



process.chdir(path.join(__dirname, '..'));

process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
diskCache.init(null);

const priceTick = require('../services/price-tick');

const { getAllCommodities } = require('../services/commodities-catalog');

const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');

const { getOutlookHistoryRoot } = require('../services/commodity-outlook-history');

const rangeArchive = require('../services/range-prediction-archive');



const FIX = process.argv.includes('--fix');

const SAMPLE_IDS = ['fg', 'au', 'al', 'sc', 'cu'];



function violation(instrumentId, field, value, source) {

  if (value == null || Number.isNaN(Number(value))) return null;

  if (priceTick.isValidTickPrice(instrumentId, value)) return null;

  const tick = priceTick.getTickSize(instrumentId);

  const rounded = priceTick.roundPriceToTick(instrumentId, value);

  return { instrumentId, field, value, tick, rounded, source };

}



function checkHighLow(instrumentId, hi, lo, source, out) {

  const vHi = violation(instrumentId, 'predictedHigh', hi, source);

  const vLo = violation(instrumentId, 'predictedLow', lo, source);

  if (vHi) out.push(vHi);

  if (vLo) out.push(vLo);

}



function auditOutlookCache(out) {

  const cached = getCachedCommodityOutlookSource();

  for (const inst of cached?.instruments || []) {

    const id = String(inst.id).toLowerCase();

    const hl = inst.highLowPrediction || inst.nextDayRange;

    if (!hl) continue;

    checkHighLow(id, hl.predictedHigh, hl.predictedLow, 'outlook-cache', out);

  }

  return cached;

}



function auditLatestSlotSnapshots(out) {

  const root = path.join(getOutlookHistoryRoot() || '', 'slot-snapshots');

  if (!fs.existsSync(root)) return;

  const days = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory()).sort();

  const latestDay = days[days.length - 1];

  if (!latestDay) return;

  const dayDir = path.join(root, latestDay);

  for (const f of fs.readdirSync(dayDir).filter((x) => x.endsWith('.json'))) {

    const snap = JSON.parse(fs.readFileSync(path.join(dayDir, f), 'utf8'));

    for (const entry of snap.instruments || []) {

      checkHighLow(entry.id, entry.predictedHigh, entry.predictedLow, `slot:${latestDay}/${f}`, out);

    }

  }

}



function auditLatestArchiveRows(out) {

  for (const c of getAllCommodities()) {

    const id = String(c.id).toLowerCase();

    const lines = rangeArchive.readArchiveLines(id).filter((r) => r.predictionSlot);

    const latest = lines[lines.length - 1];

    if (!latest) continue;

    checkHighLow(id, latest.predHigh, latest.predLow, `archive:${id}`, out);

  }

}



function formatSample(id, cached) {

  const inst = cached?.instruments?.find((i) => String(i.id).toLowerCase() === id);

  const hl = inst?.highLowPrediction || inst?.nextDayRange;

  if (!hl) return { id, status: 'no-prediction' };

  const tick = priceTick.getTickSize(id);

  return {

    id,

    tick,

    predictedHigh: hl.predictedHigh,

    predictedLow: hl.predictedLow,

    highFormatted: priceTick.formatPriceForInstrument(id, hl.predictedHigh),

    lowFormatted: priceTick.formatPriceForInstrument(id, hl.predictedLow),

    highValid: priceTick.isValidTickPrice(id, hl.predictedHigh),

    lowValid: priceTick.isValidTickPrice(id, hl.predictedLow),

  };

}



function main() {

  const violations = [];

  const cached = auditOutlookCache(violations);

  auditLatestSlotSnapshots(violations);

  auditLatestArchiveRows(violations);



  const tickTable = priceTick.listAllTickSizes();

  const report = {

    instrumentCount: Object.keys(tickTable).length,

    defaultTick: priceTick.DEFAULT_TICK,

    exchangeDefaults: priceTick.EXCHANGE_DEFAULT_TICK,

    violationCount: violations.length,

    violations: violations.slice(0, 50),

    samples: SAMPLE_IDS.map((id) => formatSample(id, cached)),

    ranAt: new Date().toISOString(),

  };



  console.log(JSON.stringify(report, null, 2));



  if (FIX && violations.length > 0) {

    console.log('\nRunning repair-slot-prediction-prices.js ...');

    require('./repair-slot-prediction-prices.js');

  }



  process.exit(violations.length > 0 ? 1 : 0);

}



main();

