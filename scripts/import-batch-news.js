/**
 * 导入 user-news-batch2/3/4 → 合并 news-tagged.csv → 校验
 * 用法: node scripts/import-batch-news.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const newsTagged = require('../services/news-tagged-loader');
const { normalizeTags, normalizeSourceTier } = require('../services/news-tag-normalize');
const { runVerification } = require('../services/news-history-verifier');

function parseTsvOrCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(delim);
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = (cols[j] || '').trim();
    }
    if (!row.date || !row.title) continue;
    rows.push(row);
  }
  return rows;
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

function mergeRows(base, incoming) {
  const map = new Map();
  for (const row of base) {
    map.set(`${row.date}|${row.title}`, row);
  }
  let added = 0;
  let skipped = 0;
  for (const raw of incoming) {
    const row = normalizeRow(raw);
    const key = `${row.date}|${row.title}`;
    if (map.has(key)) {
      skipped += 1;
    } else {
      map.set(key, row);
      added += 1;
    }
  }
  return {
    rows: [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
    added,
    skipped,
  };
}

function main() {
  const historyDir = newsTagged.getHistoryDir();
  const eHistoryDir = path.join('E:', 'FanchengFinance', 'data', 'history');
  const batch2Path = fs.existsSync(path.join(historyDir, 'user-news-batch2.csv'))
    ? path.join(historyDir, 'user-news-batch2.csv')
    : path.join(eHistoryDir, 'user-news-batch2.csv');
  const batch3Path = fs.existsSync(path.join(historyDir, 'user-news-batch3.csv'))
    ? path.join(historyDir, 'user-news-batch3.csv')
    : path.join(eHistoryDir, 'user-news-batch3.csv');
  const batch4Path = fs.existsSync(path.join(historyDir, 'user-news-batch4.csv'))
    ? path.join(historyDir, 'user-news-batch4.csv')
    : path.join(eHistoryDir, 'user-news-batch4.csv');

  const existing = newsTagged.loadNewsTagged({ force: true });
  let allRows = existing.rows;
  let totalAdded = 0;
  let totalSkipped = 0;

  for (const [label, filePath] of [
    ['batch2', batch2Path],
    ['batch3', batch3Path],
    ['batch4', batch4Path],
  ]) {
    if (!fs.existsSync(filePath)) {
      console.warn(`跳过 ${label}: 文件不存在 ${filePath}`);
      continue;
    }
    const incoming = parseTsvOrCsv(fs.readFileSync(filePath, 'utf8'));
    const { rows, added, skipped } = mergeRows(allRows, incoming);
    allRows = rows;
    totalAdded += added;
    totalSkipped += skipped;
    console.log(`${label}: 输入 ${incoming.length} 行，新增 ${added}，跳过重复 ${skipped}`);
  }

  const writeResult = newsTagged.writeNewsTaggedCsv(allRows);
  console.log(`合并后 → ${writeResult.path}（${writeResult.count} 行）`);

  const verify = runVerification({ replace: true, dryRun: false });
  console.log('校验摘要:', JSON.stringify(verify.summary, null, 2));

  return {
    before: existing.rows.length,
    after: verify.summary.outputRows,
    added: totalAdded,
    skipped: totalSkipped,
    verify: verify.summary,
  };
}

if (require.main === module) {
  main();
}

module.exports = { main, parseTsvOrCsv, normalizeRow, mergeRows };
