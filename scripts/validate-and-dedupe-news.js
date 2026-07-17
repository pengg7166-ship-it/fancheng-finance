/**
 * 数据卫生：新闻/AU 批次校验、去重、报告
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/validate-and-dedupe-news.js [--apply] [--merge] [--flash]
 * --apply  写入修正（默认仅 dry-run 报告）
 * --merge  先运行 merge-all-user-news-final.js 再校验
 * --flash  合并 flash inbox 增量
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const newsTagged = require('../services/news-tagged-loader');
const { dedupeSimilar, normalizeTitleKey, titleSimilarity } = require('./news-dedupe-utils');

const APPLY = process.argv.includes('--apply');
const RUN_MERGE = process.argv.includes('--merge');
const RUN_FLASH = process.argv.includes('--flash');

const REQUIRED_COLS = ['date', 'title', 'commodity_tags', 'direction', 'stars', 'source_tier'];

const AU_BATCH_FILES = [
  'user-au-events-batch1.csv',
  'user-au-events-batch2.csv',
  'user-au-events-batch3.csv',
  'user-au-events-batch4.csv',
  'user-au-events-batch5.csv',
  'user-au-events-pending.csv',
];

const WEEKEND_FIXES = [
  { file: 'user-au-events-batch2.csv', date: '2023-10-07', newDate: '2023-10-09', reason: '周末→沪金交易日' },
  { file: 'user-au-events-batch3.csv', date: '2024-04-13', newDate: '2024-04-15', reason: '周六→沪金周一' },
  { file: 'user-au-events-batch4.csv', date: '2025-02-01', newDate: '2025-02-03', reason: '周六→沪金周一' },
  { file: 'user-au-events-batch5.csv', date: '2026-02-28', newDate: '2026-03-02', reason: '周六→沪金周一' },
];

/** 同日多行应合并为 canonical event_id 或 title 前缀 */
const SAME_DATE_MERGE_GROUPS = [
  {
    date: '2024-09-18',
    match: (r) => /fed|fomc|降息|美联储/i.test(r.title) || /^fomc_|fed_cut/i.test(r.event_id || ''),
    keepEventId: 'fomc_20240918',
    canonicalTitle: '美联储 FOMC 降息 50bp',
  },
  {
    date: '2025-09-18',
    match: (r) => /fed|fomc|9月.*降息|美联储9月/i.test(r.title + (r.event_id || '')),
    keepEventId: 'fed_cut_sep2025',
    canonicalTitle: '美联储9月降息落地',
  },
];

function resolveHistoryDir() {
  return newsTagged.getHistoryDir();
}

function repoHistoryDir() {
  return path.join(process.cwd(), 'data', 'history');
}

function isWeekend(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T12:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function parseSimpleCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return { header: [], rows: [] };
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(delim);
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = (parts[j] || '').trim().replace(/^"|"$/g, '');
    }
    rows.push(row);
  }
  return { header, rows };
}

function validateAuBatch(filePath, label) {
  const issues = [];
  const internalDupes = [];
  if (!fs.existsSync(filePath)) {
    return { label, exists: false, rows: 0, issues, internalDupes };
  }
  const { header, rows } = parseSimpleCsv(fs.readFileSync(filePath, 'utf8'));
  for (const col of REQUIRED_COLS) {
    if (!header.includes(col)) issues.push({ type: 'schema', detail: `缺少列 ${col}` });
  }
  const seenExact = new Map();
  const seenNorm = new Map();
  const seenEvent = new Map();
  for (const row of rows) {
    const date = String(row.date || '').slice(0, 10);
    const title = String(row.title || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      issues.push({ type: 'invalid_date', date, title });
    } else if (isWeekend(date)) {
      issues.push({ type: 'weekend', date, title });
    }
    const exactKey = `${date}|${title}`;
    if (seenExact.has(exactKey)) {
      internalDupes.push({ date, title, reason: 'same date+title', dupOf: seenExact.get(exactKey) });
    } else seenExact.set(exactKey, title);
    const normKey = `${date}|${normalizeTitleKey(title)}`;
    if (seenNorm.has(normKey) && seenNorm.get(normKey) !== title) {
      internalDupes.push({ date, title, reason: 'same date+normalized title', dupOf: seenNorm.get(normKey) });
    } else seenNorm.set(normKey, title);
    if (row.event_id) {
      const eKey = `${date}|${row.event_id}`;
      if (seenEvent.has(eKey)) {
        internalDupes.push({ date, title, reason: 'same date+event_id', dupOf: seenEvent.get(eKey) });
      } else seenEvent.set(eKey, title);
    }
  }
  return { label, exists: true, rows: rows.length, header, issues, internalDupes };
}

function applyWeekendFixes(historyDir, repoDir) {
  const fixes = [];
  for (const fix of WEEKEND_FIXES) {
    for (const dir of [historyDir, repoDir]) {
      const fp = path.join(dir, fix.file);
      if (!fs.existsSync(fp)) continue;
      const text = fs.readFileSync(fp, 'utf8');
      if (!text.includes(fix.date)) continue;
      if (!APPLY) {
        fixes.push({ ...fix, path: fp, applied: false });
        continue;
      }
      const updated = text.replace(
        new RegExp(`^${fix.date.replace(/-/g, '\\-')},`, 'gm'),
        `${fix.newDate},`
      );
      if (updated !== text) {
        fs.writeFileSync(fp, updated, 'utf8');
        fixes.push({ ...fix, path: fp, applied: true });
      }
    }
  }
  return fixes;
}

function mergeTags(a, b) {
  const set = new Set([...(a || '').split(';'), ...(b || '').split(';')].filter(Boolean));
  return [...set].join(';');
}

function pickRicher(a, b) {
  const notes = [a.notes, b.notes].filter(Boolean).join('；');
  return {
    ...a,
    commodity_tags: mergeTags(a.commodity_tags, b.commodity_tags),
    stars: String(Math.max(parseInt(a.stars, 10) || 3, parseInt(b.stars, 10) || 3)),
    notes: notes.length > 400 ? `${notes.slice(0, 397)}…` : notes,
    event_id: a.event_id || b.event_id,
  };
}

function dedupeKnownGroups(rows) {
  const removedLog = [];
  let kept = [...rows];
  for (const group of SAME_DATE_MERGE_GROUPS) {
    const matchIdx = [];
    for (let i = 0; i < kept.length; i += 1) {
      if (kept[i].date === group.date && group.match(kept[i])) matchIdx.push(i);
    }
    if (matchIdx.length <= 1) continue;
    const matches = matchIdx.map((i) => kept[i]);
    let seed =
      matches.find((r) => r.event_id === group.keepEventId) ||
      matches.find((r) => titleSimilarity(r.title, group.canonicalTitle) >= 0.5) ||
      matches[0];
    const canonical = {
      ...matches.reduce((acc, r) => pickRicher(acc, r), seed),
      title: group.canonicalTitle,
      event_id: group.keepEventId,
    };
    for (const m of matches) {
      if (m.title !== canonical.title || m.event_id !== canonical.event_id) {
        removedLog.push({ date: m.date, title: m.title, reason: `merged into ${group.keepEventId}` });
      }
    }
    const drop = new Set(matchIdx);
    kept = kept.filter((_, i) => !drop.has(i));
    kept.push(canonical);
  }
  return { rows: kept, removedLog };
}

function findNewsDupes(rows) {
  const dupes = [];
  const seen = new Map();
  for (const row of rows) {
    const exact = `${row.date}|${row.title}`;
    const norm = `${row.date}|${normalizeTitleKey(row.title)}`;
    if (seen.has(exact)) dupes.push({ date: row.date, title: row.title, reason: 'exact title' });
    else if ([...seen.values()].some((v) => v.norm === norm)) {
      dupes.push({ date: row.date, title: row.title, reason: 'normalized title' });
    }
    seen.set(exact, { norm, title: row.title });
  }
  return dupes;
}

function auditTradingFred(historyDir) {
  const files = [
    'trading/au.json',
    'trading/ag.json',
    'trading/pt.json',
    'trading/pd.json',
    'trading/wr.json',
    'fred-london-gold-daily.json',
    'cnh-midrate-daily.json',
    'cny-midrate-daily.json',
    'fred-dexchus-daily.json',
  ];
  const out = {};
  for (const rel of files) {
    const fp = path.join(historyDir, rel);
    if (!fs.existsSync(fp)) {
      out[rel] = { exists: false, rows: 0 };
      continue;
    }
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const arr = Array.isArray(j) ? j : j.series || j.data || j.rows || j.bars || [];
    const dates = arr
      .map((x) => String(x.date || x.d || x.time || '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    out[rel] = {
      exists: true,
      rows: arr.length,
      first: dates[0] || null,
      last: dates[dates.length - 1] || j.endDate || null,
      fetchedAt: j.fetchedAt || j.updated || null,
    };
  }
  return out;
}

function auditBacktest(repoRoot, historyDir) {
  const exclude = ['pt', 'pd', 'wr'];
  const tradingDir = path.join(historyDir, 'trading');
  const excludeStatus = exclude.map((id) => ({
    id,
    exists: fs.existsSync(path.join(tradingDir, `${id}.json`)),
    rows: (() => {
      const fp = path.join(tradingDir, `${id}.json`);
      if (!fs.existsSync(fp)) return 0;
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const arr = Array.isArray(j) ? j : j.bars || j.series || [];
      return arr.length;
    })(),
  }));
  const sectorTune = path.join(repoRoot, '_sector-tune-result.json');
  const longrunSummary = path.join(repoRoot, 'data', 'outlook-backtest', 'longrun-2019-summary.json');
  const longrunCu = path.join(repoRoot, 'data', 'outlook-backtest', 'longrun-2019-cu.json');
  return {
    sectorTuneExists: fs.existsSync(sectorTune),
    longrunSummaryExists: fs.existsSync(longrunSummary),
    longrunCuExists: fs.existsSync(longrunCu),
    coreLiquidityExclude: excludeStatus,
  };
}

function syncRepoNews(canonicalPath, repoPath, apply) {
  if (!fs.existsSync(canonicalPath)) return { synced: false, reason: 'canonical missing' };
  const canonical = fs.readFileSync(canonicalPath, 'utf8');
  const repo = fs.existsSync(repoPath) ? fs.readFileSync(repoPath, 'utf8') : '';
  if (canonical === repo) return { synced: false, reason: 'already same' };
  if (apply) {
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    fs.writeFileSync(repoPath, canonical, 'utf8');
  }
  return {
    synced: apply,
    wouldSync: !apply,
    canonicalRows: newsTagged.parseCsv(canonical).length,
    repoRows: repo ? newsTagged.parseCsv(repo).length : 0,
  };
}

function main() {
  const historyDir = resolveHistoryDir();
  const repoDir = repoHistoryDir();
  const report = {
    generatedAt: new Date().toISOString(),
    apply: APPLY,
    historyDir,
    repoDir,
    auBatches: {},
    weekendFixes: [],
    news: {},
    tradingFred: {},
    backtest: {},
    actions: [],
  };

  if (RUN_MERGE && APPLY) {
    const { main: mergeAll } = require('./merge-all-user-news-final');
    report.actions.push('merge-all-user-news-final');
    report.mergeAll = mergeAll();
  }

  for (const name of AU_BATCH_FILES) {
    const ePath = path.join(historyDir, name);
    const rPath = path.join(repoDir, name);
    report.auBatches[name] = {
      dataDrive: validateAuBatch(ePath, name),
      repo: fs.existsSync(rPath) ? validateAuBatch(rPath, name) : { exists: false },
    };
  }

  report.weekendFixes = applyWeekendFixes(historyDir, repoDir);

  const csvPath = path.join(historyDir, 'news-tagged.csv');
  const beforeRows = fs.existsSync(csvPath)
    ? newsTagged.parseCsv(fs.readFileSync(csvPath, 'utf8'))
    : [];
  report.news.beforeRows = beforeRows.length;
  report.news.preDupes = findNewsDupes(beforeRows).slice(0, 50);

  let working = [...beforeRows];
  const groupDedupe = dedupeKnownGroups(working);
  working = groupDedupe.rows;
  const similarDedupe = dedupeSimilar(working);
  working = similarDedupe.rows;

  const removedLog = [...groupDedupe.removedLog, ...similarDedupe.removedLog];
  report.news.dedupedRemoved = removedLog.length;
  report.news.dedupedTop20 = removedLog.slice(0, 20);

  if (APPLY && (removedLog.length > 0 || working.length !== beforeRows.length)) {
    const { verifyAndCorrectRows } = require('../services/news-history-verifier');
    const { rows: verified, summary } = verifyAndCorrectRows(working);
    fs.writeFileSync(csvPath, newsTagged.rowsToCsv(verified), 'utf8');
    newsTagged.loadNewsTagged({ force: true });
    report.news.afterRows = verified.length;
    report.news.verify = summary;
    report.actions.push('dedupe+verify news-tagged.csv');
  } else {
    report.news.afterRows = working.length;
  }

  report.news.repoSync = syncRepoNews(
    csvPath,
    path.join(repoDir, 'news-tagged.csv'),
    APPLY
  );

  if (RUN_FLASH && APPLY) {
    try {
      const { main: mergeFlash } = require('./merge-flash-into-news');
      report.actions.push('merge-flash-into-news');
      report.flash = mergeFlash();
      report.news.afterRows = newsTagged.parseCsv(fs.readFileSync(csvPath, 'utf8')).length;
    } catch (err) {
      report.flashError = err.message || String(err);
    }
  } else {
    try {
      const { readInbox } = require('../services/flash-news-fetcher');
      const inbox = readInbox();
      const pending = (inbox.candidates || []).filter(
        (c) => c.status !== 'merged' && c.status !== 'rejected'
      );
      report.flash = { inboxTotal: inbox.candidates?.length || 0, pending: pending.length };
    } catch (err) {
      report.flash = { error: err.message || String(err) };
    }
  }

  report.tradingFred = auditTradingFred(historyDir);
  report.backtest = auditBacktest(process.cwd(), historyDir);

  const reportPath = path.join(historyDir, 'data-hygiene-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const repoReportPath = path.join(repoDir, 'data-hygiene-report.json');
  if (repoDir !== historyDir) {
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(repoReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log('Data hygiene report');
  console.log(`  apply: ${APPLY}`);
  console.log(`  news-tagged: ${report.news.beforeRows} → ${report.news.afterRows} (removed ${report.news.dedupedRemoved})`);
  console.log(`  report: ${reportPath}`);
  console.log('\nDeduped top 20:');
  for (const e of report.news.dedupedTop20) {
    console.log(`  [${e.date}] ${e.title} — ${e.reason}`);
  }

  return report;
}

if (require.main === module) {
  main();
}

module.exports = { main, validateAuBatch, dedupeKnownGroups, auditTradingFred };
