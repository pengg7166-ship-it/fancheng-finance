/** 新闻合并后长周期回测对比 */
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getUserDataDir, getDataDir } = require('../services/data-paths');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const newsTagged = require('../services/news-tagged-loader');

function pct(rate) {
  return rate != null ? `${Math.round(rate * 100)}%` : '—';
}

function printSector(label, bySector) {
  console.log(`\n=== ${label} ===`);
  if (!bySector) {
    console.log('(无数据)');
    return;
  }
  const order = ['agriculture', 'black', 'metals', 'precious', 'energy', 'chemical'];
  let hits = 0;
  let total = 0;
  for (const id of order) {
    const s = bySector[id];
    if (!s) continue;
    hits += s.hits || 0;
    total += s.total || 0;
    console.log(`  ${id}: ${pct(s.hitRate)} (${s.hits}/${s.total})`);
  }
  const overall = total > 0 ? hits / total : null;
  console.log(`  overall(板块加总): ${pct(overall)}`);
}

async function main() {
  diskCache.init(getUserDataDir() || getDataDir() || path.join(process.cwd(), 'data'));
  await historicalContext.ensureFredDailyCache();

  const newsCount = newsTagged.getRowCount();
  console.log(`news-tagged.csv: ${newsCount} 行`);

  const before = backtest.loadLongrunSummary();
  if (before?.overallHitRate != null && before.instrumentCount > 0) {
    printSector(`BEFORE (cached ${before.runAt?.slice(0, 10) || ''}) overall ${pct(before.overallHitRate)}`, before.bySector);
  } else {
    console.log('\nBEFORE: 使用 v1.27 基准 ~47% (58条种子新闻)');
  }

  console.log('\nRunning longrun backtest (force)…');
  const t0 = Date.now();
  const summary = await backtest.runLongrunBacktest2019({
    force: true,
    onProgress: (p) => process.stdout.write(`\r${p.pct}% ${p.message}    `),
  });
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s`);

  printSector(`AFTER (${newsCount} 条新闻) overall ${pct(summary.overallHitRate)}`, summary.bySector);

  const out = {
    newsRows: newsCount,
    beforeOverall: before?.overallHitRate ?? 0.47,
    beforeBySector: before?.bySector,
    afterOverall: summary.overallHitRate,
    afterBySector: summary.bySector,
    deltaOverall: summary.overallHitRate != null && before?.overallHitRate != null
      ? +(summary.overallHitRate - before.overallHitRate).toFixed(4)
      : summary.overallHitRate != null ? +(summary.overallHitRate - 0.47).toFixed(4) : null,
  };
  fs.writeFileSync(path.join(__dirname, '..', '_news-merge-backtest.json'), JSON.stringify(out, null, 2));
  console.log('\nWrote _news-merge-backtest.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
