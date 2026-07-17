/**
 * Merge user-filled news/basis labels → news-tagged.csv (dedupe + verify + geo aggregate).
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/merge-user-news-basis-labels.js
 *   ... [--input path/to/user-news-basis-label-template.csv]
 *   ... [--dry-run]
 *   ... [--skip-geo]
 *   ... [--basis-overrides]  write basis-regime-overrides.csv from basis rows (future hook)
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const newsTagged = require('../services/news-tagged-loader');
const { verifyAndCorrectRows } = require('../services/news-history-verifier');
const { saveGeopoliticsDailySeries } = require('../services/geopolitics-daily-aggregator');
const { mergeExpansionRows } = require('../services/news-tag-expansion');
const { dedupeSimilar } = require('./news-dedupe-utils');
const { getDataDir } = require('../services/data-paths');

const EVENT_TYPE_TO_TIER = {
  policy: 'policy',
  geo: 'geo',
  supply: 'commodity',
  basis: 'commodity',
  warehouse: 'commodity',
};

const DIR_MAP = {
  bull: 'bullish',
  bear: 'bearish',
  neutral: 'neutral',
  bullish: 'bullish',
  bearish: 'bearish',
};

const HEADER_ALIASES = {
  日期: 'date',
  品种: 'instrumentId',
  事件类型: 'eventType',
  方向: 'direction',
  标题: 'title',
  备注: 'notes',
  来源层级: 'source_tier',
  星级: 'stars',
  品种标签: 'commodities',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  return {
    dryRun: args.includes('--dry-run'),
    skipGeo: args.includes('--skip-geo'),
    basisOverrides: args.includes('--basis-overrides'),
    inputPath:
      inputIdx >= 0
        ? args[inputIdx + 1]
        : path.join(getDataDir(), 'history', 'labels', 'user-news-basis-label-template.csv'),
  };
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseUserCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const rawHeader = parseCsvLine(lines[0]);
  const header = rawHeader.map((h) => HEADER_ALIASES[h.trim()] || h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((h, idx) => {
      row[h] = (cols[idx] || '').trim();
    });
    if (row.date?.startsWith('#') || row.instrumentId?.startsWith('#')) continue;
    rows.push(row);
  }
  return rows;
}

function normalizeUserRow(raw) {
  const title = String(raw.title || '').trim();
  if (!title || title.startsWith('#') || title.startsWith('[待确认]') && !raw._force) {
    if (title.startsWith('[待确认]')) return null;
    if (!title) return null;
  }

  const directionRaw = String(raw.direction || '').toLowerCase();
  const direction = DIR_MAP[directionRaw];
  if (!direction) return null;

  const eventType = String(raw.eventType || 'supply').toLowerCase();
  const instrumentId = String(raw.instrumentId || 'ag').toLowerCase();
  const commodities = String(raw.commodities || instrumentId)
    .replace(/\|/g, ';')
    .replace(/,/g, ';');
  const sourceTier =
    raw.source_tier ||
    EVENT_TYPE_TO_TIER[eventType] ||
    'commodity';
  const date = String(raw.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const slug = title
    .slice(0, 40)
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const event_id =
    raw.event_id ||
    `user_${instrumentId}_${date.replace(/-/g, '')}_${slug || eventType}`.slice(0, 64);

  return {
    date,
    title: title.replace(/^\[待确认\]\s*/, ''),
    commodity_tags: commodities,
    direction,
    stars: String(Math.min(5, Math.max(1, parseInt(raw.stars, 10) || 3))),
    source_tier: sourceTier,
    event_id,
    notes: [raw.notes, `用户标注 merge ${new Date().toISOString().slice(0, 10)}`]
      .filter(Boolean)
      .join('；')
      .slice(0, 400),
    _userEventType: eventType,
    _instrumentId: instrumentId,
  };
}

function writeBasisOverrides(rows, { dryRun }) {
  const basisRows = rows.filter((r) => r._userEventType === 'basis');
  if (!basisRows.length) return { wrote: false, count: 0 };

  const outPath = path.join(getDataDir(), 'history', 'labels', 'basis-regime-overrides.csv');
  const header = 'sessionDate,instrumentId,overrideRegime,notes,user_confirm,mergedAt';
  const existing = fs.existsSync(outPath)
    ? fs.readFileSync(outPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(1)
    : [];
  const existingKeys = new Set(
    existing.map((line) => {
      const [d, id] = line.split(',');
      return `${d}|${id}`;
    }),
  );

  const newLines = [];
  const now = new Date().toISOString();
  for (const r of basisRows) {
    const key = `${r.date}|${r._instrumentId}`;
    if (existingKeys.has(key)) continue;
    newLines.push(
      [r.date, r._instrumentId, 'skip_oi_proxy', r.notes, '', now].join(','),
    );
    existingKeys.add(key);
  }

  if (!newLines.length || dryRun) {
    return { wrote: false, count: newLines.length, path: outPath, dryRun };
  }

  const body = existing.length
    ? fs.readFileSync(outPath, 'utf8').trimEnd() + '\n' + newLines.join('\n') + '\n'
    : `${header}\n${newLines.join('\n')}\n`;
  fs.writeFileSync(outPath, body, 'utf8');
  return { wrote: true, count: newLines.length, path: outPath };
}

function main() {
  const opts = parseArgs();
  if (!fs.existsSync(opts.inputPath)) {
    console.error('用户模板不存在:', opts.inputPath);
    console.error('请先运行: FANCHENG_DATA_DRIVE=E node scripts/build-labeling-assistance.js');
    process.exit(1);
  }

  const csvPath = newsTagged.getNewsTaggedPath();
  const baseRows = newsTagged.parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const beforeCount = baseRows.length;

  const userRaw = parseUserCsv(fs.readFileSync(opts.inputPath, 'utf8'));
  const normalized = userRaw.map(normalizeUserRow).filter(Boolean);

  if (!normalized.length) {
    console.log('无有效用户行（需填写 title + direction bull/bear/neutral）');
    console.log('模板路径:', opts.inputPath);
    process.exit(0);
  }

  const { rows: merged, added, skipped } = mergeExpansionRows(baseRows, normalized);
  const { rows: deduped, removed } = dedupeSimilar(merged);

  let verified = deduped;
  let verifySummary = null;
  let geoStats = null;
  let basisOverrideResult = null;

  if (opts.basisOverrides) {
    basisOverrideResult = writeBasisOverrides(normalized, { dryRun: opts.dryRun });
  }

  if (!opts.dryRun) {
    const verify = verifyAndCorrectRows(deduped);
    verified = verify.rows;
    verifySummary = verify.summary;
    newsTagged.writeNewsTaggedCsv(verified, { backup: true });
    const historyDir = newsTagged.getHistoryDir();
    fs.writeFileSync(
      path.join(historyDir, 'news-tagged-verified.csv'),
      newsTagged.rowsToCsv(verified),
      'utf8',
    );
    newsTagged.loadNewsTagged({ force: true });
    if (!opts.skipGeo) {
      const geo = saveGeopoliticsDailySeries({ forceReload: true });
      geoStats = {
        geoSourceRowCount: geo.payload.geoSourceRowCount,
        daysWithGeoNews: geo.payload.daysWithGeoNews,
      };
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: opts.dryRun,
    inputPath: opts.inputPath,
    userRowsParsed: userRaw.length,
    userRowsAccepted: normalized.length,
    beforeRows: beforeCount,
    afterRows: verified.length,
    netAdded: verified.length - beforeCount,
    merge: { added, skipped, dedupedRemoved: removed },
    verify: verifySummary,
    geopolitics: geoStats,
    basisOverrides: basisOverrideResult,
    kpiNote:
      '合并后 philosophyScore 可能变化；v1.34.8 logistic 权重未变 → T+1 命中率提升通常需重训。探针: node scripts/probe-tradable-day-kpi.js',
  };

  const reportPath = path.join(getDataDir(), 'history', 'labels', 'merge-user-labels-report.json');
  if (!opts.dryRun) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));
  if (!opts.dryRun) console.log(`\nReport: ${reportPath}`);
  return report;
}

if (require.main === module) {
  main();
}

module.exports = { main, normalizeUserRow, parseUserCsv };
