/**
 * 校验并合并用户补充的新闻 CSV → news-tagged.csv
 * 用法: node scripts/merge-user-news-csv.js additions.csv [--replace]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const newsTagged = require('../services/news-tagged-loader');
const { normalizeTags, normalizeSourceTier } = require('../services/news-tag-normalize');

const VALID_DIRECTIONS = new Set(['bullish', 'bearish', 'neutral']);
const VALID_TIERS = new Set([
  'policy', 'geo', 'climate', 'commodity', 'macro', 'fed', 'fomc', 'geopolitics', 'weather',
  'supply', 'demand',
]);

function validateRow(row, lineNo) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push(`第 ${lineNo} 行 date 无效: ${row.date}`);
  if (!row.title) errors.push(`第 ${lineNo} 行 title 为空`);
  if (row.direction && !VALID_DIRECTIONS.has(row.direction)) {
    errors.push(`第 ${lineNo} 行 direction 须为 bullish/bearish/neutral`);
  }
  if (row.source_tier && !VALID_TIERS.has(row.source_tier)) {
    errors.push(`第 ${lineNo} 行 source_tier 无效: ${row.source_tier}`);
  }
  const stars = parseInt(row.stars, 10);
  if (row.stars && (Number.isNaN(stars) || stars < 1 || stars > 5)) {
    errors.push(`第 ${lineNo} 行 stars 须为 1–5`);
  }
  return errors;
}

function normalizeRow(row) {
  const ctx = { title: row.title, notes: row.notes || '' };
  return {
    date: String(row.date).slice(0, 10),
    title: String(row.title).trim(),
    commodity_tags: normalizeTags(row.commodity_tags, ctx),
    direction: (row.direction || 'neutral').toLowerCase(),
    stars: String(Math.max(1, Math.min(5, parseInt(row.stars, 10) || 3))),
    source_tier: normalizeSourceTier(row.source_tier),
    event_id: String(row.event_id || '').trim(),
    notes: String(row.notes || '').trim(),
  };
}

function mergeRows(base, incoming, { replace = false } = {}) {
  const map = new Map();
  for (const row of base) {
    map.set(`${row.date}|${row.title}`, row);
  }
  let added = 0;
  let updated = 0;
  for (const raw of incoming) {
    const row = normalizeRow(raw);
    const key = `${row.date}|${row.title}`;
    if (map.has(key)) {
      if (replace) {
        map.set(key, row);
        updated += 1;
      }
    } else {
      map.set(key, row);
      added += 1;
    }
  }
  return {
    rows: [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
    added,
    updated,
  };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const replace = process.argv.includes('--replace');
  if (!args[0]) {
    console.error('用法: node scripts/merge-user-news-csv.js <用户CSV> [--replace]');
    process.exit(1);
  }

  const userPath = path.resolve(args[0]);
  if (!fs.existsSync(userPath)) {
    console.error('文件不存在:', userPath);
    process.exit(1);
  }

  const incoming = newsTagged.parseCsv(fs.readFileSync(userPath, 'utf8'));
  const allErrors = [];
  incoming.forEach((row, i) => {
    allErrors.push(...validateRow(row, i + 2));
  });
  if (allErrors.length) {
    console.error('校验失败:\n' + allErrors.join('\n'));
    process.exit(1);
  }

  const existing = newsTagged.loadNewsTagged({ force: true });
  const { rows, added, updated } = mergeRows(existing.rows, incoming, { replace });
  const result = newsTagged.writeNewsTaggedCsv(rows);

  console.log(`合并完成 → ${result.path}`);
  console.log(`  原有: ${existing.rows.length} 行`);
  console.log(`  新增: ${added} 行，更新: ${updated} 行`);
  console.log(`  合计: ${result.count} 行`);
}

main();
