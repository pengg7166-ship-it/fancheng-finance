/** 快速验证长周期回测模块（非 UI） */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getUserDataDir, getDataDir } = require('../services/data-paths');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');

async function main() {
  diskCache.init(getUserDataDir() || getDataDir() || path.join(process.cwd(), 'data'));
  await historicalContext.ensureFredDailyCache();
  const fin = historicalContext.getHistoricalFinanceEnvironment('2020-04-01');
  const regime = historicalContext.getHistoricalRegime('2022-03-15');
  console.log('[probe] 2020-04 finance:', fin.regime, 'dff', fin.dff);
  console.log('[probe] 2022-03 regime:', regime);

  const cached = backtest.loadLongrunSummary();
  if (cached?.overallHitRate != null) {
    console.log('[probe] cached longrun overall', cached.overallHitRate, 'eras', cached.byEra);
    return;
  }

  console.log('[probe] running longrun backtest (may take several minutes)…');
  const summary = await backtest.runLongrunBacktest2019({ force: true, onProgress: (p) => process.stdout.write(`\r${p.pct}% ${p.message}    `) });
  console.log('\n[probe] done overall', summary.overallHitRate);
  console.log('[probe] au', summary.sampleHitRates?.au?.hitRate);
  console.log('[probe] cu', summary.sampleHitRates?.cu?.hitRate);
  console.log('[probe] sc', summary.sampleHitRates?.sc?.hitRate);
  console.log('[probe] FG', summary.sampleHitRates?.FG?.hitRate);
  console.log('[probe] byEra', JSON.stringify(summary.byEra, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
