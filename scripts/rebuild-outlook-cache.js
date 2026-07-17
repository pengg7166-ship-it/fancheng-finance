#!/usr/bin/env node
/**
 * Force rebuild commodity-outlook-v4.json from current engine + data.
 */
// Desktop launcher uses F:; keep E only if explicitly set / F data missing.
if (!process.env.FANCHENG_DATA_DRIVE) {
  const fs = require('fs');
  process.env.FANCHENG_DATA_DRIVE = fs.existsSync('F:/FanchengFinance/data')
    ? 'F'
    : 'E';
}
process.env.FANCHENG_APP_ROOT = process.env.FANCHENG_APP_ROOT || 'F:/FanchengFinance';

const dailyClose = require('../services/daily-close-sync');
const engine = require('../services/commodity-outlook-engine');

async function main() {
  if (!dailyClose.initDiskCache()) {
    console.error('Cannot init disk cache — check FANCHENG_DATA_DRIVE');
    process.exit(1);
  }

  console.log('[rebuild-outlook] invalidating stale cache...');
  engine.invalidateOutlookDiskCache();

  console.log('[rebuild-outlook] syncing recent closes...');
  await dailyClose.backfillRecentCloses({ days: 3 });

  console.log('[rebuild-outlook] full recompute (may take 1-3 min)...');
  const payload = await engine.fetchCommodityOutlookSource({});
  if (!payload?.instruments?.length) {
    console.error('Rebuild failed — no instruments');
    process.exit(1);
  }

  const stamp = payload.updatedAt || payload.liveRefreshedAt;
  console.log('[rebuild-outlook] done', {
    updatedAt: payload.updatedAt,
    liveRefreshedAt: payload.liveRefreshedAt,
    instruments: payload.instruments.length,
  });

  for (const id of ['fg', 'au', 'al', 'cu']) {
    const inst = payload.instruments.find((x) => String(x.id).toLowerCase() === id);
    if (!inst) continue;
    const hl = inst.nextDayPrediction || inst.highLowPrediction || inst.nextDayRange;
    console.log(id, {
      price: inst.price,
      priceReason: inst.priceReason,
      baseClose: hl?.baseClose,
      baselineDate: hl?.baselineDate,
      predictedHigh: hl?.predictedHigh,
      predictedLow: hl?.predictedLow,
      spread: hl ? Math.abs(hl.predictedHigh - hl.predictedLow) : null,
    });
  }

  console.log('[rebuild-outlook] stamp for UI:', stamp);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
