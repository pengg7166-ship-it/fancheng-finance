/**
 * 将 batch2 TSV 转为 user-news-batch2.csv，并追加到 user-news-import.csv
 * 用法: node scripts/prepare-user-news-batch2.js [输入.tsv]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const newsTagged = require('../services/news-tagged-loader');
const { normalizeTags, normalizeSourceTier, validateTags } = require('../services/news-tag-normalize');

const DATE_CORRECTIONS = {
  '2022-05-01|印度禁止小麦出口': '2022-05-13',
  '2022-05-10|印度禁止小麦出口': '2022-05-13',
  '2024-09-19|美联储降息50bp': '2024-09-18',
  '2024-11-05|特朗普胜选': '2024-11-06',
  '2023-11-15|美联储停止加息信号': '2023-11-01',
};

function parseTsvOrCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const hasHeader = /date|title/i.test(lines[0]);
  const start = hasHeader ? 1 : 0;
  const header = hasHeader
    ? lines[0].split(delim).map((h) => h.trim().toLowerCase())
    : ['date', 'title', 'commodity_tags', 'direction', 'stars', 'source_tier', 'notes'];
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
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
  let date = String(row.date).slice(0, 10);
  const key = `${date}|${row.title}`;
  if (DATE_CORRECTIONS[key]) date = DATE_CORRECTIONS[key];
  return {
    date,
    title: String(row.title).trim(),
    commodity_tags: normalizeTags(row.commodity_tags, ctx),
    direction: (row.direction || 'neutral').toLowerCase(),
    stars: String(Math.max(1, Math.min(5, parseInt(row.stars, 10) || 3))),
    source_tier: normalizeSourceTier(row.source_tier),
    event_id: String(row.event_id || '').trim(),
    notes: String(row.notes || '').trim(),
  };
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.date}|${row.title}`, row);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function main() {
  const historyDir = newsTagged.getHistoryDir();
  const inPath = path.resolve(process.argv[2] || path.join(historyDir, '_user-batch2-raw.tsv'));
  const batch2Path = path.join(historyDir, 'user-news-batch2.csv');
  const importPath = path.join(historyDir, 'user-news-import.csv');

  if (!fs.existsSync(inPath)) {
    console.error('输入文件不存在:', inPath);
    process.exit(1);
  }

  const raw = parseTsvOrCsv(fs.readFileSync(inPath, 'utf8'));
  const allUnmapped = new Set();
  const batch2 = dedupeRows(
    raw.map((row) => {
      const ctx = { title: row.title, notes: row.notes || '' };
      for (const u of validateTags(row.commodity_tags, ctx)) allUnmapped.add(u);
      return normalizeRow(row);
    })
  );

  fs.writeFileSync(batch2Path, newsTagged.rowsToCsv(batch2), 'utf8');
  console.log(`已写入 ${batch2Path}（${batch2.length} 行）`);

  const existing = fs.existsSync(importPath)
    ? newsTagged.parseCsv(fs.readFileSync(importPath, 'utf8'))
    : [];
  const merged = dedupeRows([...existing, ...batch2]);
  fs.writeFileSync(importPath, newsTagged.rowsToCsv(merged), 'utf8');
  console.log(`已追加到 ${importPath}（${existing.length} → ${merged.length} 行，新增 ${merged.length - existing.length}）`);

  if (allUnmapped.size) {
    console.warn('未映射标签:', [...allUnmapped].join(', '));
  }
}

main();
