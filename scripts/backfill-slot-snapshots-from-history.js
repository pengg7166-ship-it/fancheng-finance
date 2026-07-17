/**
 * Re-capture slot snapshots from JSONL outlook history at each slot predictTs.
 * Fixes identical predictions when catch-up used live outlook instead of historical state.
 *
 * FANCHENG_DATA_DRIVE=E node scripts/backfill-slot-snapshots-from-history.js [--date 2026-06-29] [--force]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const slots = require('../services/outlook-prediction-slots');
const { captureOutlookPredictionSnapshot } = require('../services/outlook-slot-snapshot');
const { getOutlookHistoryRoot, todayKey } = require('../services/commodity-outlook-history');
const { getAllCommodities } = require('../services/commodities-catalog');

const rawArgs = process.argv.slice(2);
let TARGET_DATE = todayKey();
let FORCE = false;

for (let i = 0; i < rawArgs.length; i += 1) {
  const a = rawArgs[i];
  if (a === '--force') {
    FORCE = true;
    continue;
  }
  if ((a === '--date' || a === '-d') && rawArgs[i + 1]) {
    TARGET_DATE = String(rawArgs[i + 1]).slice(0, 10);
    i += 1;
    continue;
  }
  if (a.startsWith('--date=')) TARGET_DATE = a.slice(7).slice(0, 10);
}

function loadStubInstruments() {
  return getAllCommodities().map((m) => ({
    id: m.id,
    name: m.name,
    sector: m.sector,
    price: 1000,
    scenarios: { base: { low: -1, mid: 0, high: 1 } },
  }));
}

function main() {
  const root = getOutlookHistoryRoot();
  if (!root) {
    console.error(JSON.stringify({ error: 'outlook-history root unavailable' }));
    process.exit(1);
  }

  const stubInstruments = loadStubInstruments();
  const results = [];

  for (const slot of slots.getAllSlots()) {
    const slotMeta = slots.buildSlotMeta(slot.id, { sessionDate: TARGET_DATE, captureDate: TARGET_DATE });
    const result = captureOutlookPredictionSnapshot(slot.id, {
      instruments: stubInstruments,
      sessionDate: TARGET_DATE,
      captureDate: TARGET_DATE,
      force: FORCE,
    });
    results.push({
      slotId: slot.id,
      captured: result.captured,
      reason: result.reason,
      path: result.path,
      instrumentCount: result.instrumentCount,
    });
  }

  const summary = {
    date: TARGET_DATE,
    force: FORCE,
    results,
    auditDir: path.join(root, 'slot-audit-archive'),
    snapshotDir: path.join(root, 'slot-snapshots', TARGET_DATE),
    ranAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
