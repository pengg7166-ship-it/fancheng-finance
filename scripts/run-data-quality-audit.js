#!/usr/bin/env node
/**
 * CLI data-quality audit — exit 1 on critical failures.
 * Usage: FANCHENG_DATA_DRIVE=E node scripts/run-data-quality-audit.js [--heal] [--json] [--light] [--packaged]
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

process.env.FANCHENG_DATA_DRIVE = resolveDataDrive();

const HEAL = process.argv.includes('--heal');
const AS_JSON = process.argv.includes('--json');
const LIGHT = process.argv.includes('--light');
const PACKAGED = process.argv.includes('--packaged');

async function main() {
  const { runQualityAudit } = require('../services/data-quality-guard');
  const auditOptions = {
    mode: LIGHT ? 'light' : 'full',
    skipNetwork: process.argv.includes('--skip-network'),
    packagedContext: PACKAGED,
    trigger: 'cli',
  };

  let result;
  if (HEAL) {
    const { runHealThenAudit } = require('../services/data-quality-heal');
    const bundle = await runHealThenAudit({ auditOptions, maxRetries: 1, trigger: 'cli-heal' });
    result = { ...bundle.audit, heal: bundle.heal, retries: bundle.retries };
  } else {
    result = await runQualityAudit(auditOptions);
  }

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('=== Data Quality Audit ===');
    console.log(`Mode: ${auditOptions.mode} · OK: ${result.ok} · Critical: ${result.criticalCount} · Warnings: ${result.warningCount || 0}`);
    if (result.latestCloseDate) console.log(`Latest close: ${result.latestCloseDate}`);
    console.log('---');
    for (const c of result.checks || []) {
      const mark = c.passed ? 'PASS' : c.severity.toUpperCase();
      console.log(`[${mark}] ${c.name} (${c.id})`);
      if (!c.passed && c.details) {
        const brief = JSON.stringify(c.details);
        console.log(`       ${brief.length > 200 ? `${brief.slice(0, 200)}…` : brief}`);
      }
    }
    if (result.heal) {
      console.log('--- Heal steps ---');
      for (const s of result.heal.steps || []) console.log(`  ${s.step}: ${s.ok ? 'ok' : s.error || 'fail'}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
