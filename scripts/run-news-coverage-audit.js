#!/usr/bin/env node
/**
 * 35 品种资讯覆盖度审计
 */
const { auditNewsCoverage, persistCoverageAudit } = require('../services/news-coverage-audit');
const dailyClose = require('../services/daily-close-sync');

function bar(pct) {
  const n = Math.round(pct / 10);
  return `${'█'.repeat(n)}${'░'.repeat(10 - n)} ${pct}%`;
}

async function main() {
  dailyClose.initDiskCache?.();
  const result = auditNewsCoverage();
  persistCoverageAudit(result);

  console.log('=== 35 品种 · 资讯覆盖度审计 ===\n');
  console.log(`版本: ${result.summary.version}`);
  console.log(`均覆盖: ${result.summary.avgCoveragePct}% | 满分品种: ${result.summary.fullCoverage}/${result.summary.symbolCount}`);
  console.log(`池规模: 快讯=${result.summary.poolSizes.flash} 政策=${result.summary.poolSizes.policy} 观点=${result.summary.poolSizes.opinion} 国际=${result.summary.poolSizes.intl}`);
  console.log(`审计时间: ${result.summary.auditedAt}\n`);

  const weak = [...result.rows].sort((a, b) => a.coveragePct - b.coveragePct);
  console.log('--- 覆盖偏弱（前 12）---');
  for (const row of weak.slice(0, 12)) {
    console.log(`${row.id.toUpperCase().padEnd(4)} ${row.name.padEnd(6)} ${bar(row.coveragePct)} 缺口: ${row.gaps.join('、') || '—'}`);
  }

  console.log('\n--- 覆盖完整（满分）---');
  const full = result.rows.filter((r) => r.gaps.length === 0);
  console.log(full.map((r) => r.id).join(', ') || '暂无');

  const jsonPath = process.env.FANCHENG_DATA_DIR
    ? require('path').join(process.env.FANCHENG_DATA_DIR, 'news-coverage-audit.json')
    : 'data/news-coverage-audit.json';
  console.log(`\n已写入缓存: news-coverage-audit.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
