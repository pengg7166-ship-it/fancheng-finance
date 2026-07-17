#!/usr/bin/env node
/**
 * 盘前/盘后数据自愈 — 收盘同步 → 研判重建 → 质量审计（失败 exit 1）
 * Usage: node scripts/run-daily-data-heal.js [--json]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { listWritableRoots, scoreDataPresence } = require('../services/data-paths');

function resolveDataDrive() {
  if (process.env.FANCHENG_DATA_DRIVE?.trim()) {
    return process.env.FANCHENG_DATA_DRIVE.replace(':', '').toUpperCase().slice(0, 1);
  }
  const ranked = listWritableRoots()
    .map((c) => ({ ...c, score: scoreDataPresence(c.root) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return 'E';
  const letter = ranked[0].root.match(/^([A-Z]):/i)?.[1];
  return letter || 'E';
}

async function main() {
  process.env.FANCHENG_DATA_DRIVE = resolveDataDrive();
  const { runHealThenAudit } = require('../services/data-quality-heal');
  const AS_JSON = process.argv.includes('--json');

  const bundle = await runHealThenAudit({
    auditOptions: { mode: 'full', trigger: 'daily-data-heal' },
    maxRetries: 2,
    trigger: 'daily-data-heal',
  });

  const { audit, heal, retries } = bundle;
  const result = { ok: audit.ok, drive: process.env.FANCHENG_DATA_DRIVE, audit, heal, retries };

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('=== Daily Data Heal ===');
    console.log(`Drive: ${process.env.FANCHENG_DATA_DRIVE}:`);
    console.log(`OK: ${audit.ok} · Critical: ${audit.criticalCount} · Warnings: ${audit.warningCount || 0}`);
    console.log(`Latest close: ${audit.latestCloseDate || '—'} · Retries: ${retries}`);
    for (const c of audit.checks || []) {
      if (!c.passed) {
        console.log(`[${c.severity.toUpperCase()}] ${c.name} (${c.id})`);
      }
    }
    if (heal?.steps?.length) {
      console.log('--- Heal steps ---');
      for (const s of heal.steps) console.log(`  ${s.step}: ${s.ok ? 'ok' : s.error || 'fail'}`);
    }
  }

  process.exit(audit.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
