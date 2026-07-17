/**
 * 导入 user-news-batch4/5 → 智能去重合并 news-tagged.csv → 全量校验
 * 用法: node scripts/import-batch5-news.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const newsTagged = require('../services/news-tagged-loader');
const { normalizeTags, normalizeSourceTier } = require('../services/news-tag-normalize');
const {
  verifyAndCorrectRows,
  getReportPath,
  getVerifiedPath,
} = require('../services/news-history-verifier');

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

function rowKey(row) {
  return `${row.date}|${row.title}`;
}

/** 合并前删除的重复/被取代行 */
const REMOVE_KEYS = new Set([
  '2025-07-01|反内卷政策预期',
  '2025-07-01|反内卷政策密集落地期启动',
  '2025-07-15|反内卷政策预期',
  '2025-01-01|碳酸锂减产联盟成立',
  '2025-12-01|美联储12月第三次降息',
  '2025-12-12|美联储年内最后一次降息落地',
  '2025-12-18|美联储年内最后一次降息落地',
  '2025-12-18|美联储12月第三次降息',
  '2023-01-01|远兴能源投产预期',
  '2023-08-01|远兴能源纯碱一线投产',
  '2023-12-14|红海危机爆发',
  '2024-01-02|集运欧线期货涨停',
  '2024-01-15|红海危机导致乙二醇到港延迟',
  '2025-09-01|美联储9月降息落地',
  '2026-01-23|期货市场新增14个特定品种',
  '2026-01-23|镍期货首次完税品种对外开放',
  '2026-01-23|碳酸锂期货纳入对外开放',
  '2026-01-23|聚酯产业链期权全开放',
  '2026-01-23|期货市场新增14个特定品种对外开放',
  '2025-12-10|美联储年内最后一次降息落地',
]);

function shouldRemoveRow(row) {
  if (REMOVE_KEYS.has(rowKey(row))) return true;
  if (/""""/.test(row.title) || /""""/.test(row.notes || '')) return true;
  return false;
}

/** 合并 commodity_tags 到已有行 */
const TAG_MERGE = {
  '2025-07-01|中央强调反内卷、规范无序竞争': 'rb;hc',
};

function mergeTagSets(existing, extra) {
  const tags = new Set([
    ...String(existing || '').split(';').filter(Boolean),
    ...String(extra || '').split(';').filter(Boolean),
  ]);
  return [...tags].join(';');
}

function applyPreMergeDedupe(rows) {
  let removed = 0;
  const kept = [];
  for (const row of rows) {
    if (shouldRemoveRow(row)) {
      removed += 1;
      continue;
    }
    kept.push(row);
  }

  const map = new Map();
  for (const row of kept) {
    map.set(rowKey(row), row);
  }

  for (const [key, extraTags] of Object.entries(TAG_MERGE)) {
    if (!map.has(key)) continue;
    const row = map.get(key);
    row.commodity_tags = mergeTagSets(row.commodity_tags, extraTags);
  }

  return { rows: [...map.values()], removed };
}

function mergeRows(base, incoming) {
  const map = new Map();
  for (const row of base) {
    map.set(rowKey(row), row);
  }
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const raw of incoming) {
    const row = normalizeRow(raw);
    const key = rowKey(row);
    if (map.has(key)) {
      const prev = map.get(key);
      const mergedTags = mergeTagSets(prev.commodity_tags, row.commodity_tags);
      if (mergedTags !== prev.commodity_tags || (row.notes && row.notes !== prev.notes)) {
        map.set(key, { ...prev, commodity_tags: mergedTags, notes: row.notes || prev.notes });
        updated += 1;
      } else {
        skipped += 1;
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
    skipped,
  };
}

function restoreLargestBackup(historyDir, targetPath) {
  let currentRows = 0;
  if (fs.existsSync(targetPath)) {
    currentRows = newsTagged.parseCsv(fs.readFileSync(targetPath, 'utf8')).length;
  }
  if (currentRows >= 200) return null;

  const backups = fs.readdirSync(historyDir)
    .filter((f) => f.startsWith('news-tagged.csv') && (f.includes('.bak') || f.includes('pre-verify')))
    .map((f) => path.join(historyDir, f))
    .filter((p) => fs.statSync(p).isFile())
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  if (!backups.length) return null;
  fs.copyFileSync(backups[0], targetPath);
  return backups[0];
}

function main() {
  const historyDir = newsTagged.getHistoryDir();
  const taggedPath = newsTagged.getNewsTaggedPath();
  const restoredFrom = restoreLargestBackup(historyDir, taggedPath);
  if (restoredFrom) {
    console.log(`从最大备份恢复: ${path.basename(restoredFrom)}`);
  }
  const batches = [
    ['batch4', path.join(historyDir, 'user-news-batch4.csv')],
    ['batch5', path.join(historyDir, 'user-news-batch5.csv')],
  ];

  const existing = newsTagged.loadNewsTagged({ force: true });
  const { rows: dedupedBase, removed: preRemoved } = applyPreMergeDedupe(existing.rows);
  let allRows = dedupedBase;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  console.log(`合并前去重: 删除 ${preRemoved} 行，保留 ${allRows.length} 行`);

  for (const [label, filePath] of batches) {
    if (!fs.existsSync(filePath)) {
      console.warn(`跳过 ${label}: 文件不存在 ${filePath}`);
      continue;
    }
    const incoming = parseTsvOrCsv(fs.readFileSync(filePath, 'utf8'));
    const { rows, added, updated, skipped } = mergeRows(allRows, incoming);
    allRows = rows;
    totalAdded += added;
    totalUpdated += updated;
    totalSkipped += skipped;
    console.log(`${label}: 输入 ${incoming.length} 行，新增 ${added}，更新 ${updated}，跳过 ${skipped}`);
  }

  let { rows: verifiedRows, report, summary } = verifyAndCorrectRows(allRows);

  // 后处理：同 event_id 同日保留一条；期货开放保留「正式实施」标题
  const postKeys = new Set();
  verifiedRows = verifiedRows.filter((row) => {
    if (row.date === '2025-12-10' && row.title === '美联储年内最后一次降息落地') return false;
    const ek = `${row.date}|${row.event_id || row.title}`;
    if (row.event_id && postKeys.has(ek)) return false;
    if (row.event_id) postKeys.add(ek);
    return true;
  });
  const futuresIdx = verifiedRows.findIndex(
    (r) => r.date === '2026-01-23' && /期货市场新增14个特定品种/.test(r.title)
  );
  if (futuresIdx >= 0) {
    verifiedRows = verifiedRows.filter(
      (r, i) => !(r.date === '2026-01-23' && /期货市场新增14个特定品种/.test(r.title) && i !== futuresIdx)
    );
    const futures = verifiedRows[futuresIdx];
    futures.title = '期货市场新增14个特定品种正式实施';
    futures.commodity_tags = mergeTagSets(futures.commodity_tags, 'TA');
    futures.event_id = futures.event_id || 'futures_open_2026';
    futures.notes = '14个特定品种对外开放（LC;NI;PF;PR;PX;RU;LU;BC;TA）；NR→ru';
  }

  const outPath = newsTagged.getNewsTaggedPath();
  if (fs.existsSync(outPath)) {
    fs.copyFileSync(outPath, `${outPath}.bak-${Date.now()}`);
  }
  const csv = newsTagged.rowsToCsv(verifiedRows);
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, csv, 'utf8');
  fs.renameSync(tmpPath, outPath);
  newsTagged.loadNewsTagged({ force: true });

  const verifiedPath = getVerifiedPath();
  fs.writeFileSync(verifiedPath, csv, 'utf8');
  const reportPath = getReportPath();
  const payload = {
    generatedAt: new Date().toISOString(),
    inputPath: outPath,
    verifiedPath,
    summary,
    entries: report,
  };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`合并+校验 → ${outPath}（${verifiedRows.length} 行）`);
  console.log('校验摘要:', JSON.stringify(summary, null, 2));

  return {
    before: existing.rows.length,
    preRemoved,
    merged: allRows.length,
    after: summary.outputRows,
    deduped: existing.rows.length + totalAdded - summary.outputRows,
    added: totalAdded,
    updated: totalUpdated,
    skipped: totalSkipped,
    verify: summary,
  };
}

if (require.main === module) {
  main();
}

module.exports = { main, parseTsvOrCsv, normalizeRow, mergeRows, applyPreMergeDedupe, REMOVE_KEYS };
