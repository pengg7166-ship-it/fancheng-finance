/**
 * 分析区间预测未命中日 — 导出 CSV 供人工审计
 * FANCHENG_DATA_DRIVE=E node scripts/analyze-range-prediction-misses.js [--id au] [--top 20]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const { getAllCommodities } = require('../services/commodities-catalog');
const archive = require('../services/range-prediction-archive');

const rawArgs = process.argv.slice(2);
const CLI_IDS = [];
let TOP = 15;
for (let i = 0; i < rawArgs.length; i += 1) {
  const a = rawArgs[i];
  if (a === '--id' && rawArgs[i + 1]) {
    CLI_IDS.push(String(rawArgs[i + 1]).toLowerCase());
    i += 1;
    continue;
  }
  if (a.startsWith('--id=')) {
    CLI_IDS.push(a.slice(5).toLowerCase());
    continue;
  }
  if (a === '--top' && rawArgs[i + 1]) {
    TOP = Math.max(1, parseInt(rawArgs[i + 1], 10) || 15);
    i += 1;
  }
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

function resolveIds() {
  if (CLI_IDS.length) return CLI_IDS;
  const root = archive.getArchiveRoot();
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith('-daily.jsonl'))
    .map((f) => f.replace(/-daily\.jsonl$/, ''));
}

function missSeverity(r) {
  return Math.abs(r.highError || 0) + Math.abs(r.lowError || 0);
}

function main() {
  const targetIds = CLI_IDS.length
    ? CLI_IDS
    : resolveIds().length
      ? resolveIds()
      : getAllCommodities().map((m) => String(m.id).toLowerCase());

  const allMisses = [];
  const perInstrument = [];

  for (const id of targetIds) {
    const stats = archive.getComparisonStats(id);
    if (!stats.count) continue;
    const rows = archive.loadArchive(id).filter((r) => r.bandHit === false);
    for (const r of rows) {
      allMisses.push({ ...r, severity: missSeverity(r) });
    }
    perInstrument.push({
      id,
      count: stats.count,
      bandHitRate: stats.bandHitRate,
      worst: stats.worstMisses.slice(0, TOP),
    });
  }

  allMisses.sort((a, b) => b.severity - a.severity);
  const topMisses = allMisses.slice(0, TOP * Math.max(1, targetIds.length));

  const dataDir = getDataDir() || 'E:\\FanchengFinance\\data';
  const labelsDir = path.join(dataDir, 'history', 'labels');
  fs.mkdirSync(labelsDir, { recursive: true });
  const csvPath = path.join(labelsDir, 'range-prediction-miss-audit.csv');

  const header = [
    'instrumentId',
    'sessionDate',
    'baselineDate',
    'baseClose',
    'predHigh',
    'predLow',
    'actualHigh',
    'actualLow',
    'highHit',
    'lowHit',
    'highError',
    'lowError',
    'modelVersion',
    'severity',
  ];
  const csvLines = [
    header.join(','),
    ...topMisses.map((r) =>
      header.map((k) => csvEscape(r[k])).join(','),
    ),
  ];
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf8');

  const outJson = path.join(__dirname, '..', '_analyze-range-prediction-misses.json');
  fs.writeFileSync(
    outJson,
    JSON.stringify({ csvPath, topMisses: topMisses.slice(0, 50), perInstrument }, null, 2),
  );

  console.log('=== Range Prediction Miss Analysis ===');
  console.log('CSV:', csvPath);
  console.log('Top misses:', topMisses.length);
  for (const p of perInstrument.slice(0, 20)) {
    console.log(
      `${p.id}: bandHit ${p.bandHitRate != null ? (p.bandHitRate * 100).toFixed(1) : '—'}% · worst ${p.worst.length}`,
    );
  }
  console.log('\nWrote', outJson);
}

main();
