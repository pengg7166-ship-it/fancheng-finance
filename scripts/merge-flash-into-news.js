/**
 * 合并 flash-news-inbox.json → news-tagged.csv（去重 + 校验）
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/merge-flash-into-news.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const newsTagged = require('../services/news-tagged-loader');
const { readInbox, getInboxPath } = require('../services/flash-news-fetcher');
const { dedupeSimilar, titleSimilarity } = require('./news-dedupe-utils');
const {
  isRelevantFlashCandidate,
  flashCandidateToExpansionRow,
} = require('../services/news-tag-expansion');

function flashCandidateToRow(candidate) {
  if (!isRelevantFlashCandidate(candidate)) return null;
  const row = flashCandidateToExpansionRow(candidate);
  if (!row) return null;
  const { _expansionSource, ...clean } = row;
  return { ...clean, _flashId: candidate.id };
}

function mergeFlashIntoRows(baseRows, candidates, { minDate = '2019-01-01' } = {}) {
  const stats = {
    inboxTotal: candidates.length,
    skippedIrrelevant: 0,
    skippedNoDate: 0,
    skippedBeforeMin: 0,
    skippedDup: 0,
    added: 0,
    mergedRicher: 0,
  };

  let rows = [...baseRows];
  const mergedFlashIds = [];

  for (const candidate of candidates) {
    if (candidate.status === 'merged' || candidate.status === 'rejected') continue;

    const row = flashCandidateToRow(candidate);
    if (!row) {
      if (!isRelevantFlashCandidate(candidate)) stats.skippedIrrelevant = (stats.skippedIrrelevant || 0) + 1;
      else stats.skippedNoDate += 1;
      continue;
    }
    if (row.date < minDate) {
      stats.skippedBeforeMin += 1;
      continue;
    }

    const exactIdx = rows.findIndex((r) => r.date === row.date && r.title === row.title);
    if (exactIdx >= 0) {
      stats.skippedDup += 1;
      mergedFlashIds.push(candidate.id);
      continue;
    }

    const similarIdx = rows.findIndex(
      (r) =>
        r.date === row.date &&
        (r.title === row.title || titleSimilarity(r.title, row.title) >= 0.82)
    );
    if (similarIdx >= 0) {
      const existing = rows[similarIdx];
      rows[similarIdx] = {
        ...existing,
        commodity_tags: [...new Set([...(existing.commodity_tags || '').split(';'), ...(row.commodity_tags || '').split(';')].filter(Boolean))].join(';'),
        stars: String(Math.max(parseInt(existing.stars, 10) || 3, parseInt(row.stars, 10) || 3)),
        notes: [existing.notes, row.notes].filter(Boolean).join('；').slice(0, 400),
      };
      stats.mergedRicher += 1;
      mergedFlashIds.push(candidate.id);
      continue;
    }

    const { _flashId, ...cleanRow } = row;
    rows.push(cleanRow);
    stats.added += 1;
    mergedFlashIds.push(candidate.id);
  }

  const { rows: deduped, removed } = dedupeSimilar(rows);
  stats.dedupedRemoved = removed;

  return { rows: deduped, stats, mergedFlashIds };
}

function markInboxMerged(mergedFlashIds) {
  if (!mergedFlashIds.length) return 0;
  const inbox = readInbox();
  const idSet = new Set(mergedFlashIds);
  let marked = 0;
  for (const c of inbox.candidates) {
    if (idSet.has(c.id) && c.status === 'pending') {
      c.status = 'merged';
      c.verifyNote = `已合并 news-tagged.csv ${new Date().toISOString().slice(0, 10)}`;
      marked += 1;
    }
  }
  const filePath = getInboxPath();
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ ...inbox, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
  return marked;
}

function main() {
  const historyDir = newsTagged.getHistoryDir();
  const csvPath = path.join(historyDir, 'news-tagged.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('news-tagged.csv 不存在:', csvPath);
    process.exit(1);
  }

  const inbox = readInbox();
  const pending = inbox.candidates.filter((c) => c.status !== 'merged' && c.status !== 'rejected');
  const baseRows = newsTagged.parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const beforeCount = baseRows.length;

  console.log(`Inbox: ${inbox.candidates.length} 条 (pending ${pending.length})`);
  console.log(`news-tagged.csv 合并前: ${beforeCount} 行`);

  const { rows: mergedRows, stats, mergedFlashIds } = mergeFlashIntoRows(baseRows, inbox.candidates);

  const { verifyAndCorrectRows } = require('../services/news-history-verifier');
  const { rows: verified, report, summary: verifySummary } = verifyAndCorrectRows(mergedRows);

  fs.writeFileSync(csvPath, newsTagged.rowsToCsv(verified), 'utf8');
  fs.writeFileSync(path.join(historyDir, 'news-tagged-verified.csv'), newsTagged.rowsToCsv(verified), 'utf8');
  fs.writeFileSync(
    path.join(historyDir, 'news-verification-report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        inputPath: csvPath,
        source: 'merge-flash-into-news',
        summary: verifySummary,
        entries: report,
      },
      null,
      2
    ),
    'utf8'
  );
  newsTagged.loadNewsTagged({ force: true });

  const marked = markInboxMerged(mergedFlashIds);

  const mergeReport = {
    generatedAt: new Date().toISOString(),
    beforeRows: beforeCount,
    afterRows: verified.length,
    netAdded: verified.length - beforeCount,
    flash: stats,
    inboxMarkedMerged: marked,
    verify: verifySummary,
  };
  fs.writeFileSync(path.join(historyDir, 'merge-flash-report.json'), JSON.stringify(mergeReport, null, 2));

  console.log('\n=== Flash 合并结果 ===');
  console.log(JSON.stringify(mergeReport, null, 2));

  return mergeReport;
}

if (require.main === module) {
  main();
}

module.exports = { main, flashCandidateToRow, mergeFlashIntoRows };
