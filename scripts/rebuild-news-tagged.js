/**
 * 从种子备份 + 全部用户批次 CSV 重建 news-tagged.csv（去重 + 标签规范化）
 * 用法: node scripts/rebuild-news-tagged.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const newsTagged = require('../services/news-tagged-loader');
const { normalizeTags, normalizeSourceTier } = require('../services/news-tag-normalize');

const USER_BATCH_FILES = [
  'user-news-import.csv',
  'user-news-batch2.csv',
  'user-news-batch3.csv',
  'user-news-batch4.csv',
  'user-news-batch5.csv',
  'user-news-batch6.csv',
];

function normalizeExistingRow(row) {
  const ctx = { title: row.title, notes: row.notes || '' };
  return {
    date: String(row.date).slice(0, 10),
    title: String(row.title).trim(),
    commodity_tags: normalizeTags(row.commodity_tags, ctx),
    direction: (row.direction || 'neutral').toLowerCase(),
    stars: Math.max(1, Math.min(5, parseInt(row.stars, 10) || 3)),
    source_tier: normalizeSourceTier(row.source_tier),
    event_id: String(row.event_id || '').trim(),
    notes: String(row.notes || '').trim(),
  };
}

function loadUserBatches(historyDir) {
  const all = [];
  for (const name of USER_BATCH_FILES) {
    const fp = path.join(historyDir, name);
    if (!fs.existsSync(fp)) continue;
    const rows = newsTagged.parseCsv(fs.readFileSync(fp, 'utf8')).map(normalizeExistingRow);
    all.push({ name, rows });
  }
  return all;
}

function main() {
  const historyDir = newsTagged.getHistoryDir();
  const seedPath = path.join(historyDir, 'news-tagged.csv.bak-1780708367909');
  const outPath = newsTagged.getNewsTaggedPath();

  if (!fs.existsSync(seedPath)) {
    console.error('种子备份不存在:', seedPath);
    process.exit(1);
  }

  const seeds = newsTagged.parseCsv(fs.readFileSync(seedPath, 'utf8')).map(normalizeExistingRow);
  const batches = loadUserBatches(historyDir);
  if (!batches.length) {
    console.error('未找到任何 user-news-*.csv');
    process.exit(1);
  }

  const map = new Map();
  for (const row of seeds) {
    map.set(`${row.date}|${row.title}`, row);
  }

  let addedFromUser = 0;
  for (const { name, rows } of batches) {
    let batchAdded = 0;
    for (const row of rows) {
      const key = `${row.date}|${row.title}`;
      if (!map.has(key)) {
        map.set(key, row);
        addedFromUser += 1;
        batchAdded += 1;
      }
    }
    console.log(`  ${name}: ${rows.length} 行，新增 ${batchAdded}`);
  }

  const merged = [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
  );
  const result = newsTagged.writeNewsTaggedCsv(merged);
  console.log(`\n重建完成 → ${result.path}`);
  console.log(`  种子: ${seeds.length} 行，用户合计新增: ${addedFromUser} 行，总计: ${result.count} 行`);
}

main();
