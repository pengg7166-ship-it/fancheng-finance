/**
 * 历史事实校验 news-tagged.csv
 * 用法: node scripts/verify-news-tagged.js [--dry-run]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { runVerification } = require('../services/news-history-verifier');

const dryRun = process.argv.includes('--dry-run');

const result = runVerification({ replace: !dryRun, dryRun });

console.log('News history verification');
console.log('  input:', result.inputPath);
console.log('  summary:', JSON.stringify(result.summary, null, 2));
if (!dryRun) {
  console.log('  verified:', result.verifiedPath);
  console.log('  report:', require('../services/news-history-verifier').getReportPath());
}
console.log('\nCorrections sample:');
for (const e of result.entries.filter((x) => x.status !== 'ok').slice(0, 20)) {
  const detail = e.newDate
    ? `${e.oldDate} → ${e.newDate}`
    : e.field
      ? `${e.field}: ${e.oldValue} → ${e.newValue}`
      : e.status;
  console.log(`  [${e.status}] ${e.title} — ${detail} (${e.source})`);
}
