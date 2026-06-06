/**
 * 将用户粘贴的 TSV/CSV 转为规范 user-news-import.csv（UTF-8）
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/prepare-user-news-import.js [输入.tsv] [输出.csv]
 */
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const newsTagged = require('../services/news-tagged-loader');
const { normalizeTags, normalizeSourceTier, validateTags } = require('../services/news-tag-normalize');

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

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.date}|${row.title}`;
    const prev = map.get(key);
    if (!prev || (parseInt(row.stars, 10) || 0) > (parseInt(prev.stars, 10) || 0)) {
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function main() {
  const inPath = path.resolve(process.argv[2] || path.join(newsTagged.getHistoryDir(), '_user-raw.tsv'));
  const outPath = path.resolve(process.argv[3] || path.join(newsTagged.getHistoryDir(), 'user-news-import.csv'));

  if (!fs.existsSync(inPath)) {
    console.error('输入文件不存在:', inPath);
    process.exit(1);
  }

  const raw = parseTsvOrCsv(fs.readFileSync(inPath, 'utf8'));
  const allUnmapped = new Set();

  const normalized = dedupeRows(
    raw.map((row) => {
      const ctx = { title: row.title, notes: row.notes || '' };
      for (const u of validateTags(row.commodity_tags, ctx)) allUnmapped.add(u);
      return {
        date: String(row.date).slice(0, 10),
        title: String(row.title).trim(),
        commodity_tags: normalizeTags(row.commodity_tags, ctx),
        direction: (row.direction || 'neutral').toLowerCase(),
        stars: String(Math.max(1, Math.min(5, parseInt(row.stars, 10) || 3))),
        source_tier: normalizeSourceTier(row.source_tier),
        notes: String(row.notes || '').trim(),
      };
    })
  );

  fs.writeFileSync(outPath, newsTagged.rowsToCsv(normalized), 'utf8');
  console.log(`已写入 ${outPath}（${normalized.length} 行，去重后）`);
  if (allUnmapped.size) {
    console.warn('未映射标签:', [...allUnmapped].join(', '));
  } else {
    console.log('全部 commodity_tags 已映射到 catalog id');
  }
}

main();
