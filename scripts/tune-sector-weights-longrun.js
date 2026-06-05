/** 长周期回测 + 板块权重网格搜索（v1.27） */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getUserDataDir, getDataDir } = require('../services/data-paths');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const calibration = require('../services/commodity-outlook-calibration');

async function main() {
  diskCache.init(getUserDataDir() || getDataDir() || path.join(process.cwd(), 'data'));
  await historicalContext.ensureFredDailyCache();

  const before = backtest.loadLongrunSummary();
  if (before?.bySector) {
    console.log('\n=== BEFORE (cached) ===');
    console.log('overall', before.overallHitRate != null ? `${Math.round(before.overallHitRate * 100)}%` : '—');
    for (const [s, st] of Object.entries(before.bySector)) {
      console.log(`  ${s}: ${st.hitRate != null ? Math.round(st.hitRate * 100) + '%' : '—'} (${st.hits}/${st.total})`);
    }
  }

  console.log('\n=== Running longrun backtest v1.27 (force) ===');
  const t0 = Date.now();
  const summary = await backtest.runLongrunBacktest2019({
    force: true,
    onProgress: (p) => process.stdout.write(`\r${p.pct}% ${p.message}    `),
  });
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s`);

  console.log('\n=== AFTER ===');
  console.log('overall', summary.overallHitRate != null ? `${Math.round(summary.overallHitRate * 100)}%` : '—');
  console.log('target 70%', summary.overallHitRate >= 0.7 ? 'REACHED' : `gap +${Math.round((0.7 - summary.overallHitRate) * 100)}pp`);
  for (const [s, st] of Object.entries(summary.bySector || {})) {
    const pct = st.hitRate != null ? Math.round(st.hitRate * 100) : '—';
    const gap = st.hitRate != null ? Math.round((0.7 - st.hitRate) * 100) : '—';
    console.log(`  ${s}: ${pct}% (gap ${gap}pp) ${st.hits}/${st.total}`);
  }

  const cal = calibration.loadCalibration(true);
  console.log('\n=== Sector tuned weights (sample) ===');
  for (const id of calibration.SECTOR_IDS) {
    const w = cal.sectorWeights?.[id];
    if (!w) continue;
    console.log(
      `  ${id}: φ=${w.philosophyWeight} ad=${w.adaptiveWeight} f=${w.factorWeight} th=${w.directionBull} hit=${w.hitRate != null ? Math.round(w.hitRate * 100) + '%' : '—'}`
    );
  }

  const outPath = path.join(process.cwd(), '_sector-tune-result.json');
  require('fs').writeFileSync(
    outPath,
    JSON.stringify({ before: before?.bySector, after: summary.bySector, overall: summary.overallHitRate }, null, 2)
  );
  console.log('\nWrote', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
