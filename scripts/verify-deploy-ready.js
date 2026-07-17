#!/usr/bin/env node
/**
 * Pre-deploy gate — asar modules + live data-quality audit.
 * Usage: node scripts/verify-deploy-ready.js [--force] [--asar path]
 */
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const FORCE = process.argv.includes('--force');
const ASAR =
  process.argv.find((a, i) => process.argv[i - 1] === '--asar') ||
  process.env.FANCHENG_ASAR ||
  'E:/FanchengFinance/app/win-unpacked/resources/app.asar';

const REQUIRED_MODULES = [
  'services/daily-close-scheduler.js',
  'services/chemical-range-calibration.js',
  'services/startup-data-heal.js',
  'services/data-quality-guard.js',
  'services/data-quality-heal.js',
  'services/commodity-outlook-backtest.js',
  'electron/main.js',
  'electron/preload.js',
  'src/app.js',
];

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function checkAsarModules(asarPath) {
  const issues = [];
  if (!fs.existsSync(asarPath)) {
    return { ok: false, issues: [`asar not found: ${asarPath}`] };
  }
  const listing = new Set(asar.listPackage(asarPath).map(norm));
  for (const rel of REQUIRED_MODULES) {
    if (!listing.has(norm(rel))) issues.push(`missing in asar: ${rel}`);
  }
  try {
    const mainJs = asar.extractFile(asarPath, 'electron/main.js').toString();
    if (!/data-quality|runQualityAudit|get-data-quality-status/.test(mainJs)) {
      issues.push('electron/main.js missing data-quality integration');
    }
    const appJs = asar.extractFile(asarPath, 'src/app.js').toString();
    if (!/dataQualityIndicator|data-quality-indicator/.test(appJs)) {
      issues.push('src/app.js missing data-quality UI indicator');
    }
  } catch (err) {
    issues.push(`content check failed: ${err.message}`);
  }
  return { ok: issues.length === 0, issues };
}

const FAKE_DATA_CHECK_IDS = ['no_fake_data_outlook', 'backtest_data_integrity', 'honest_ui_states'];

async function checkLiveData() {
  process.chdir(ROOT);
  process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';
  const { runQualityAudit } = require('../services/data-quality-guard');
  const report = await runQualityAudit({
    mode: 'full',
    skipNetwork: false,
    packagedContext: false,
    trigger: 'deploy-gate',
  });
  return report;
}

async function main() {
  console.log('=== Deploy readiness gate ===');
  console.log('asar:', ASAR);

  const mod = checkAsarModules(ASAR);
  if (!mod.ok) {
    console.error('\n--- ASAR module failures ---');
    for (const i of mod.issues) console.error('✗', i);
    if (!FORCE) process.exit(1);
    console.warn('--force: continuing despite asar issues');
  } else {
    console.log('✓ asar modules OK');
  }

  console.log('\nRunning live data-quality audit...');
  const report = await checkLiveData();
  console.log(
    `Audit: ok=${report.ok} critical=${report.criticalCount} warnings=${report.warningCount || 0} close=${report.latestCloseDate || '?'}`
  );

  for (const c of report.checks || []) {
    if (!c.passed) {
      const tag = c.severity === 'critical' ? '✗' : '!';
      console.log(`${tag} [${c.severity}] ${c.name}`);
    }
  }

  const fakeViolations = (report.checks || []).filter(
    (c) => FAKE_DATA_CHECK_IDS.includes(c.id) && !c.passed
  );
  if (fakeViolations.length) {
    console.error('\n--- Fake-data integrity failures ---');
    for (const c of fakeViolations) {
      console.error(`✗ ${c.name} (${c.id})`);
      if (c.details?.violations?.length) {
        console.error(`  sample: ${JSON.stringify(c.details.violations.slice(0, 3))}`);
      }
      if (c.details?.issues?.length) {
        console.error(`  issues: ${JSON.stringify(c.details.issues.slice(0, 3))}`);
      }
    }
  }

  if (!report.ok && !FORCE) {
    console.error('\nDEPLOY BLOCKED — critical data-quality failures. Use --force to override.');
    process.exit(1);
  }

  if (!report.ok && FORCE) {
    console.warn('\n--force: deploy allowed despite critical audit failures');
  }

  console.log('\nPASS — deploy ready');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
