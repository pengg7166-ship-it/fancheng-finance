#!/usr/bin/env node
/**
 * 命中率数据 P0 流水线 — OI 检查 → 新闻标注 → 长周期回测 → L2 权重训练（可选）
 * Usage: node scripts/run-hitrate-data-pipeline.js [--skip-train] [--json]
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const { listWritableRoots, scoreDataPresence, getDataDir } = require('../services/data-paths');
const SKIP_TRAIN = process.argv.includes('--skip-train');
const AS_JSON = process.argv.includes('--json');

function resolveDataDrive() {
  if (process.env.FANCHENG_DATA_DRIVE?.trim()) {
    return process.env.FANCHENG_DATA_DRIVE.replace(':', '').toUpperCase().slice(0, 1);
  }
  const ranked = listWritableRoots()
    .map((c) => ({ ...c, score: scoreDataPresence(c.root) }))
    .sort((a, b) => b.score - a.score);
  const letter = ranked[0]?.root?.match(/^([A-Z]):/i)?.[1];
  return letter || 'E';
}

function runNode(script, args = []) {
  const node = process.execPath;
  execFileSync(node, [path.join(__dirname, script), ...args], {
    stdio: 'inherit',
    env: { ...process.env, FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE },
    windowsHide: true,
  });
}

function countOiFiles() {
  const dataDir = getDataDir();
  if (!dataDir) return { count: 0, path: null };
  const oiDir = path.join(dataDir, 'history', 'oi');
  if (!fs.existsSync(oiDir)) return { count: 0, path: oiDir };
  const count = fs.readdirSync(oiDir).filter((f) => f.endsWith('.json')).length;
  return { count, path: oiDir };
}

function newsTaggedStats() {
  const fp = path.join(__dirname, '..', 'data', 'history', 'news-tagged.csv');
  if (!fs.existsSync(fp)) return { rows: 0, path: fp };
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  return { rows: Math.max(0, lines.length - 1), path: fp };
}

async function main() {
  process.env.FANCHENG_DATA_DRIVE = resolveDataDrive();
  const report = {
    drive: process.env.FANCHENG_DATA_DRIVE,
    steps: [],
    ok: true,
  };

  const oiBefore = countOiFiles();
  report.steps.push({ step: 'oi_inventory', ...oiBefore, target: 74 });

  if (oiBefore.count < 60) {
    try {
      runNode('backfill-commodity-oi.js');
      const oiAfter = countOiFiles();
      report.steps.push({ step: 'oi_backfill', ok: true, ...oiAfter });
    } catch (err) {
      report.steps.push({ step: 'oi_backfill', ok: false, error: err.message });
      report.ok = false;
    }
  } else {
    report.steps.push({ step: 'oi_backfill', ok: true, skipped: true, reason: 'coverage_sufficient' });
  }

  const newsBefore = newsTaggedStats();
  report.steps.push({ step: 'news_tagged_before', ...newsBefore });

  try {
    runNode('expand-news-tagged.js', ['--skip-warehouse']);
    report.steps.push({ step: 'expand_news_tagged', ok: true, ...newsTaggedStats() });
  } catch (err) {
    report.steps.push({ step: 'expand_news_tagged', ok: false, error: err.message });
    report.ok = false;
  }

  try {
    const diskCache = require('../services/disk-cache');
    diskCache.init(getDataDir());
    const backtest = require('../services/commodity-outlook-backtest');
    const summary = await backtest.runLongrunBacktest2019?.({ force: true });
    report.steps.push({
      step: 'longrun_backtest',
      ok: !!summary,
      overallHitRate: summary?.overallHitRate ?? null,
      instrumentCount: summary?.instruments?.length ?? null,
    });
  } catch (err) {
    report.steps.push({ step: 'longrun_backtest', ok: false, error: err.message });
    report.ok = false;
  }

  if (!SKIP_TRAIN) {
    try {
      runNode('train-outlook-logistic.js');
      report.steps.push({ step: 'train_outlook_logistic', ok: true });
    } catch (err) {
      report.steps.push({ step: 'train_outlook_logistic', ok: false, error: err.message });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('=== Hit-rate data pipeline ===');
    console.log(`Drive: ${report.drive}:`);
    for (const s of report.steps) {
      console.log(`  ${s.step}: ${s.ok === false ? 'FAIL ' + (s.error || '') : JSON.stringify(s)}`);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
