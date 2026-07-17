#!/usr/bin/env node
/**
 * 对比三个固定预测时段的命中率
 * Usage: node scripts/analyze-slot-hit-rates.js [--from 2026-01-01] [--to 2026-06-28]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const args = process.argv.slice(2);
function readArg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const { analyzeSlotHitRates } = require('../services/outlook-slot-analysis');
const result = analyzeSlotHitRates({
  from: readArg('--from'),
  to: readArg('--to'),
});

console.log('\n=== 固定时段预测命中率对照 ===\n');
for (const row of result.bySlot) {
  const dirPct =
    row.direction.hitRate != null ? `${Math.round(row.direction.hitRate * 100)}%` : '—';
  const rangePct = row.range.hitRate != null ? `${Math.round(row.range.hitRate * 100)}%` : '—';
  console.log(
    `${row.label}: 方向 ${dirPct} (${row.direction.hits}/${row.direction.scored}) · 区间 ${rangePct} (${row.range.hits}/${row.range.scored})`
  );
}
console.log('\n' + JSON.stringify(result, null, 2));
