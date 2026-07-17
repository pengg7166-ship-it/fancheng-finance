/** 长周期回测 + 板块权重网格搜索（v1.29） */
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getUserDataDir, getDataDir } = require('../services/data-paths');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const calibration = require('../services/commodity-outlook-calibration');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');

function resolveDataRoot() {
  const candidates = [
    getDataDir(),
    path.join('E:', 'FanchengFinance', 'data'),
    path.join(process.cwd(), 'data'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'klines', 'commodity-au-day.json'))) return dir;
  }
  return candidates[0];
}

async function main() {
  const dataRoot = resolveDataRoot();
  diskCache.init(dataRoot);
  const eligible = INSTRUMENT_REGISTRY.filter((s) => readCachedKlines(s.id).length >= 60).length;
  console.log('dataRoot:', diskCache.getRoot(), 'eligible:', eligible);
  if (eligible < 10) {
    throw new Error(`K线缓存不足（${eligible} 品种），请确认 ${dataRoot}/klines`);
  }
  await historicalContext.ensureFredDailyCache();

  const before = backtest.loadLongrunSummary();
  if (before?.bySector) {
    console.log('\n=== BEFORE (cached) ===');
    console.log('overall', before.overallHitRate != null ? `${Math.round(before.overallHitRate * 100)}%` : '—');
    for (const [s, st] of Object.entries(before.bySector)) {
      console.log(`  ${s}: ${st.hitRate != null ? Math.round(st.hitRate * 100) + '%' : '—'} (${st.hits}/${st.total})`);
    }
  }

  console.log('\n=== Running longrun backtest v1.29 (force) ===');
  const t0 = Date.now();
  const summary = await backtest.runLongrunBacktest2019({
    force: true,
    onProgress: (p) => process.stdout.write(`\r${p.pct}% ${p.message}    `),
  });
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s`);

  backtest.printLongrunKpiReport(summary, { label: 'AFTER longrun' });

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
    JSON.stringify(
      {
        before: before?.bySector,
        after: summary.bySector,
        overall: summary.overallHitRate,
        coreLiquidity: summary.coreLiquidity,
        sectorGaps: backtest.KPI_SECTOR_IDS.reduce((acc, id) => {
          const st = summary.bySector?.[id];
          acc[id] = st?.hitRate != null ? +(backtest.KPI_SECTOR_TARGET - st.hitRate).toFixed(4) : null;
          return acc;
        }, {}),
      },
      null,
      2
    )
  );
  console.log('\nWrote', outPath);
}

main().catch((err) => {
  console.error('longrun failed:', err?.stack || err);
  process.exit(1);
});
