#!/usr/bin/env node
/**
 * 基础设施修复：收盘价回填 + 外盘 + 数据质量复检
 * 海外代理：userData/config.json → overseasProxyUrl 或环境变量 FANCHENG_OVERSEAS_PROXY
 */
const dailyClose = require('../services/daily-close-sync');
const { runStartupDataHeal } = require('../services/startup-data-heal');
const { runHealThenAudit } = require('../services/data-quality-heal');
const { getOverseasProxyUrl } = require('../services/http-client');

async function main() {
  console.log('=== 基础设施修复 ===\n');
  console.log('海外代理:', getOverseasProxyUrl() ? '已配置' : '未配置（国际源走直连）');
  console.log('');

  if (!dailyClose.initDiskCache()) {
    console.error('无法初始化数据目录');
    process.exit(1);
  }

  console.log('1) 启动自愈（收盘价回填）...');
  const heal = await runStartupDataHeal({ trigger: 'cli-infrastructure-heal', syncDays: 5 });
  console.log(JSON.stringify(heal.steps, null, 2));

  console.log('\n2) 强制全量收盘价同步（活跃品种）...');
  const sync = await dailyClose.syncAllDailyCloses({
    force: false,
    trigger: 'cli-infrastructure-heal',
    includeCrossMarket: true,
    rateMs: 180,
  });
  console.log(`同步: ${JSON.stringify({ ok: sync.ok, fetched: sync.fetched, skipped: sync.skipped, failed: sync.failed, dominantDate: sync.dominantDate })}`);

  console.log('\n3) 数据质量复检 + 自动修复（含研判缓存重建）...');
  const bundle = await runHealThenAudit({
    auditOptions: { mode: 'full', trigger: 'cli-infrastructure-heal', skipNetwork: false },
    maxRetries: 2,
    trigger: 'cli-infrastructure-heal',
  });
  const audit = bundle.audit;
  if (bundle.heal?.steps?.length) {
    console.log('修复步骤:', JSON.stringify(bundle.heal.steps, null, 2));
  }
  console.log(`结果: ok=${audit.ok} critical=${audit.criticalCount} warnings=${audit.warningCount}`);
  for (const c of audit.checks.filter((x) => !x.passed)) {
    console.log(`  [${c.severity}] ${c.name}: ${JSON.stringify(c.details).slice(0, 160)}`);
  }

  process.exit(audit.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
