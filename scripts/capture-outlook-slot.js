#!/usr/bin/env node
/**
 * 手动触发固定时段 outlook 快照
 * Usage:
 *   node scripts/capture-outlook-slot.js --slot pre-day
 *   node scripts/capture-outlook-slot.js --slot pre-night --date 2026-06-28 --force
 */
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
diskCache.init(getDataDir() || path.join(root, 'data'));

const args = process.argv.slice(2);
function readArg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const slotId = readArg('--slot') || readArg('-s');
const sessionDate = readArg('--date') || readArg('--session-date');
const force = args.includes('--force');

if (!slotId) {
  console.error('Usage: node scripts/capture-outlook-slot.js --slot <pre-night|pre-day|pre-afternoon> [--date YYYY-MM-DD] [--force]');
  process.exit(1);
}

async function main() {
  const slots = require('../services/outlook-prediction-slots');
  if (!slots.getSlotById(slotId)) {
    console.error('Unknown slot:', slotId);
    process.exit(1);
  }

  let instruments = [];
  try {
    const engine = require('../services/commodity-outlook-engine');
    const cached = engine.getCachedCommodityOutlookSource();
    instruments = cached?.instruments || [];
    if (!instruments.length) {
      const stored = diskCache.readStale('commodity-outlook-v4.json');
      instruments = stored?.data?.instruments || [];
    }
  } catch {
    // optional
  }

  if (!instruments.length) {
    console.warn('No cached outlook instruments — snapshot will record 0 rows unless you refresh outlook first.');
  }

  const { captureOutlookPredictionSnapshot } = require('../services/outlook-slot-snapshot');
  const result = captureOutlookPredictionSnapshot(slotId, {
    instruments,
    force,
    sessionDate,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.captured || result.reason === 'already_captured' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
