/**
 * 全品种区间预测未命中批量导出 — CSV + 汇总 JSON
 * FANCHENG_DATA_DRIVE=E node scripts/analyze-all-range-prediction-misses.js [--partial-only]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const { getInstrumentProfile } = require('../services/commodity-instrument-profiles');
const archive = require('../services/range-prediction-archive');

const PARTIAL_ONLY = process.argv.includes('--partial-only');

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function resolveArchiveIds() {
  const root = archive.getArchiveRoot();
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith('-daily.jsonl'))
    .map((f) => f.replace(/-daily\.jsonl$/, ''))
    .sort();
}

function missSeverity(r) {
  return Math.abs(r.highError || 0) + Math.abs(r.lowError || 0);
}

function isMissRow(r) {
  if (r.bandHit == null) return false;
  if (PARTIAL_ONLY) return r.bandHit === false && (r.highHit || r.lowHit);
  return r.bandHit === false;
}

function rowToCsvRecord(enriched, sector) {
  const regime = enriched.meta?.regimeLabel || enriched.meta?.regime || '';
  return {
    instrumentId: enriched.instrumentId,
    sector,
    sessionDate: enriched.sessionDate,
    baselineDate: enriched.baselineDate || '',
    baseClose: enriched.baseClose,
    predHigh: enriched.predHigh,
    predLow: enriched.predLow,
    predRange: enriched.predRange,
    actualHigh: enriched.actualHigh,
    actualLow: enriched.actualLow,
    actualRange: enriched.actualRange,
    highHit: enriched.highHit,
    lowHit: enriched.lowHit,
    bandHit: enriched.bandHit,
    bandHitLabel: enriched.bandHitLabel,
    highError: enriched.highError,
    lowError: enriched.lowError,
    maxDeviation: enriched.maxDeviation,
    severity: enriched.severity,
    predictedDirection: enriched.predictedDirection?.label || '',
    actualDirection: enriched.actualDirection?.label || '',
    directionHit: enriched.directionHit,
    missReasonTags: (enriched.missReasonTags || []).join('|'),
    regime,
    modelVersion: enriched.modelVersion || '',
    recordedAt: enriched.recordedAt || '',
  };
}

function tallyTags(tagCounts, tags = []) {
  for (const t of tags) {
    if (!t || t === '区间命中') continue;
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
}

function topTags(tagCounts, n = 8) {
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tag, count]) => ({ tag, count }));
}

function main() {
  const ids = resolveArchiveIds();
  if (!ids.length) {
    console.error('No archive files found under', archive.getArchiveRoot());
    process.exit(1);
  }

  const allMissRows = [];
  const perInstrument = [];
  const perSector = {};
  const globalTagCounts = {};
  let totalScored = 0;
  let totalMisses = 0;
  let totalPartial = 0;

  for (const id of ids) {
    const profile = getInstrumentProfile(id);
    const sector = profile.sector || 'agriculture';
    const stats = archive.getComparisonStats(id);
    const scored = stats.count || 0;
    const rows = archive.loadArchive(id);
    const misses = [];
    const instTagCounts = {};

    for (const raw of rows) {
      if (raw.bandHit == null) continue;
      if (!isMissRow(raw)) continue;
      const enriched = archive.enrichAuditRecord({ ...raw, instrumentId: id });
      enriched.severity = missSeverity(enriched);
      const csvRec = rowToCsvRecord(enriched, sector);
      misses.push(csvRec);
      tallyTags(instTagCounts, enriched.missReasonTags);
      tallyTags(globalTagCounts, enriched.missReasonTags);
    }

    const missCount = misses.length;
    const partialCount = rows.filter((r) => r.bandHit === false && (r.highHit || r.lowHit)).length;
    totalScored += scored;
    totalMisses += missCount;
    totalPartial += partialCount;

    allMissRows.push(...misses);

    const instSummary = {
      instrumentId: id,
      sector,
      scored,
      missCount,
      partialCount,
      missRate: scored ? +(missCount / scored).toFixed(4) : null,
      bandHitRate: stats.bandHitRate,
      highHitRate: stats.highHitRate,
      lowHitRate: stats.lowHitRate,
      topReasonTags: topTags(instTagCounts, 6),
    };
    perInstrument.push(instSummary);

    if (!perSector[sector]) {
      perSector[sector] = {
        sector,
        instruments: 0,
        scored: 0,
        missCount: 0,
        partialCount: 0,
        tagCounts: {},
      };
    }
    const sec = perSector[sector];
    sec.instruments += 1;
    sec.scored += scored;
    sec.missCount += missCount;
    sec.partialCount += partialCount;
    for (const [tag, c] of Object.entries(instTagCounts)) {
      sec.tagCounts[tag] = (sec.tagCounts[tag] || 0) + c;
    }
  }

  allMissRows.sort((a, b) => b.severity - a.severity);

  const dataDir = getDataDir() || 'E:\\FanchengFinance\\data';
  const labelsDir = path.join(dataDir, 'history', 'labels');
  fs.mkdirSync(labelsDir, { recursive: true });

  const csvPath = path.join(labelsDir, 'range-prediction-miss-audit-all.csv');
  const jsonPath = path.join(labelsDir, 'range-prediction-miss-audit-all-summary.json');

  const header = [
    'instrumentId',
    'sector',
    'sessionDate',
    'baselineDate',
    'baseClose',
    'predHigh',
    'predLow',
    'predRange',
    'actualHigh',
    'actualLow',
    'actualRange',
    'highHit',
    'lowHit',
    'bandHit',
    'bandHitLabel',
    'highError',
    'lowError',
    'maxDeviation',
    'severity',
    'predictedDirection',
    'actualDirection',
    'directionHit',
    'missReasonTags',
    'regime',
    'modelVersion',
    'recordedAt',
  ];

  const csvLines = [
    header.join(','),
    ...allMissRows.map((r) => header.map((k) => csvEscape(r[k])).join(',')),
  ];
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf8');

  const worstByMissRate = [...perInstrument]
    .filter((p) => p.scored >= 50)
    .sort((a, b) => (a.bandHitRate ?? 1) - (b.bandHitRate ?? 1))
    .slice(0, 10);

  const sectorSummary = Object.values(perSector)
    .map((s) => ({
      sector: s.sector,
      instruments: s.instruments,
      scored: s.scored,
      missCount: s.missCount,
      partialCount: s.partialCount,
      missRate: s.scored ? +(s.missCount / s.scored).toFixed(4) : null,
      bandHitRate: s.scored ? +((s.scored - s.missCount) / s.scored).toFixed(4) : null,
      topReasonTags: topTags(s.tagCounts, 10),
    }))
    .sort((a, b) => a.sector.localeCompare(b.sector));

  const summary = {
    generatedAt: new Date().toISOString(),
    filter: PARTIAL_ONLY ? 'partial-only' : 'all-misses',
    paths: { csv: csvPath, summaryJson: jsonPath },
    totals: {
      instruments: ids.length,
      scoredRows: totalScored,
      missRows: totalMisses,
      partialRows: totalPartial,
      missRate: totalScored ? +(totalMisses / totalScored).toFixed(4) : null,
      bandHitRate: totalScored ? +((totalScored - totalMisses) / totalScored).toFixed(4) : null,
    },
    topReasonTags: topTags(globalTagCounts, 15),
    worstInstrumentsByMissRate: worstByMissRate,
    bySector: sectorSummary,
    byInstrument: perInstrument.sort((a, b) => (a.bandHitRate ?? 1) - (b.bandHitRate ?? 1)),
  };

  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('=== All-Instruments Range Prediction Miss Export ===');
  console.log('Instruments:', ids.length);
  console.log('Scored rows:', totalScored);
  console.log('Miss rows (CSV):', totalMisses);
  console.log('Partial hits:', totalPartial);
  console.log(
    'Overall bandHit:',
    summary.totals.bandHitRate != null ? `${(summary.totals.bandHitRate * 100).toFixed(2)}%` : '—',
  );
  console.log('CSV:', csvPath);
  console.log('Summary JSON:', jsonPath);
  console.log('\nWorst 10 by miss rate (min 50 scored):');
  for (const w of worstByMissRate) {
    console.log(
      `  ${w.instrumentId} (${w.sector}): bandHit ${((w.bandHitRate || 0) * 100).toFixed(1)}% · misses ${w.missCount}/${w.scored}`,
    );
  }
  console.log('\nTop failure modes:');
  for (const t of summary.topReasonTags.slice(0, 10)) {
    console.log(`  ${t.tag}: ${t.count}`);
  }
}

main();
