/**
 * 生成双轨方向标签 CSV — au+ag 样本（Phase 0 Week 1）
 * 用法: node scripts/build-direction-labels.js [--id au] [--from 2019-01-01]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { getDataDir } = require('../services/data-paths');
const { computeDualLabels, LABELS_VERSION } = require('../services/outlook-labels');
const historicalContext = require('../services/commodity-outlook-historical-context');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { CORE_LIQUIDITY_EXCLUDE } = require('../services/commodity-outlook-backtest');

const DEFAULT_IDS = ['au', 'ag'];
const DEFAULT_FROM = '2019-01-01';

function parseArgs() {
  const args = process.argv.slice(2);
  const ids = [];
  let from = DEFAULT_FROM;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id' && args[i + 1]) {
      ids.push(String(args[i + 1]).toLowerCase());
      i += 1;
    } else if (args[i] === '--from' && args[i + 1]) {
      from = args[i + 1];
      i += 1;
    }
  }
  return { ids: ids.length ? ids : DEFAULT_IDS, from };
}

function loadBars(id) {
  const klines = readCachedKlines(id);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const fp = path.join(historyDir, 'trading', `${id}.json`);
  if (!fs.existsSync(fp)) return klines;
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const { ids, from } = parseArgs();
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const outDir = path.join(dataDir, 'history', 'labels');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'direction-daily.csv');

  const header = [
    'date',
    'instrument_id',
    'label_primary',
    'return_t3_pct',
    'label_compare',
    'return_t1_pct',
    'era_id',
    'exclude_kpi',
    'labels_version',
  ];

  const lines = [header.join(',')];
  const stats = {};

  for (const id of ids) {
    const bars = loadBars(id);
    let count = 0;
    for (let i = 0; i < bars.length - 3; i += 1) {
      const date = String(bars[i]?.date || bars[i]?.time || '').slice(0, 10);
      if (!date || date < from) continue;
      const dual = computeDualLabels(bars, i);
      lines.push(
        [
          date,
          id,
          dual.t3.label ?? '',
          dual.t3.returnPct ?? '',
          dual.t1.label ?? '',
          dual.t1.returnPct ?? '',
          historicalContext.classifyEra(date) ?? '',
          CORE_LIQUIDITY_EXCLUDE.has(id) ? 1 : 0,
          LABELS_VERSION,
        ]
          .map(csvEscape)
          .join(',')
      );
      count += 1;
    }
    stats[id] = { bars: bars.length, rows: count };
  }

  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        outPath,
        labelsVersion: LABELS_VERSION,
        from,
        instruments: stats,
        totalRows: lines.length - 1,
      },
      null,
      2
    )
  );
}

main();
