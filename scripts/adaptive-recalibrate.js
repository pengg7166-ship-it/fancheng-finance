/** 自适应校准一轮：读 longrun 摘要 → 分析拖累 → 安全应用 → 写报告 */
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const backtest = require('../services/commodity-outlook-backtest');
const adaptive = require('../services/outlook-adaptive-calibration');
const calibration = require('../services/commodity-outlook-calibration');

function resolveDataRoot() {
  const candidates = [
    getDataDir(),
    path.join('E:', 'FanchengFinance', 'data'),
    path.join(process.cwd(), 'data'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'outlook-backtest', 'longrun-2019-summary.json'))) return dir;
  }
  return candidates[0];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipApply = args.includes('--no-apply');
  const forceLongrun = args.includes('--force-longrun');

  const dataRoot = resolveDataRoot();
  diskCache.init(dataRoot);
  console.log('dataRoot:', dataRoot);

  let summary = backtest.loadLongrunSummary();
  if (!summary?.overallHitRate || forceLongrun) {
    console.log('Running longrun backtest (force)...');
    summary = await backtest.runLongrunBacktest2019({
      force: true,
      onProgress: (p) => process.stdout.write(`\r${p.pct}% ${p.message}    `),
    });
    console.log('');
  }

  if (!summary?.overallHitRate) {
    console.error('无 longrun 命中率数据，请先运行 tune-sector-weights-longrun.js');
    process.exit(1);
  }

  console.log(`\n=== 自适应反测 ${adaptive.ADAPTIVE_VERSION} ===`);
  console.log(`全量命中率: ${(summary.overallHitRate * 100).toFixed(1)}% (${summary.hits}/${summary.total})`);
  if (summary.coreLiquidity) {
    const c = summary.coreLiquidity;
    console.log(
      `核心流动性: ${c.coreOverallHitRate != null ? (c.coreOverallHitRate * 100).toFixed(1) : '—'}% (排除 ${c.excluded.join(',')})`
    );
  }
  console.log(`区间: ${summary.periodFrom} → ${summary.periodTo}`);
  backtest.printLongrunKpiReport(summary, { label: '板块 KPI (sector_balanced ≥70%)' });

  const analysis = adaptive.analyzeBacktestFailures(summary);
  console.log(`\n发现 ${analysis.failures.length} 项拖累/规则问题`);

  const proposal = adaptive.proposeAdjustments(analysis);
  console.log(`建议调整: ${proposal.adjustments.length} 项（安全 ${proposal.adjustments.filter((a) => a.safe).length}）`);
  console.log(`待确认: ${proposal.pending.length} 项`);

  let applied = { applied: [] };
  if (!skipApply && !dryRun) {
    applied = adaptive.applySafeAdjustments(proposal);
    console.log(`\n已应用 ${applied.applied.length} 项安全调整 → ${calibration.getCalibrationPath()}`);
  } else {
    console.log(dryRun ? '\n[dry-run] 跳过写入 calibration' : '\n[--no-apply] 跳过写入');
  }

  const markdown = adaptive.buildMarkdownReport({ analysis, proposal, applied });
  const report = {
    version: adaptive.ADAPTIVE_VERSION,
    generatedAt: new Date().toISOString(),
    dryRun,
    skipApply,
    analysis,
    proposal,
    applied: applied.applied,
    markdown,
  };

  const paths = adaptive.writeReports(report);
  console.log('报告:', paths.jsonPath);
  console.log('文档:', paths.mdPath);

  console.log('\n--- 摘要 ---');
  for (const f of analysis.failures.filter((x) => x.kind === 'era' || x.kind === 'sector').slice(0, 6)) {
    console.log(`  ${f.label || f.sector || f.eraId}: ${(f.hitRate * 100).toFixed(1)}% (${(f.gapPp * 100).toFixed(1)}pp)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
