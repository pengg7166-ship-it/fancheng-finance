/**
 * Experiment #3 — news-tagged expansion pipeline (2019+)
 *
 * Steps: warehouse backfill → AG basis miss tags → filtered flash merge → verify → geo aggregate
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/expand-news-tagged.js [--dry-run] [--skip-flash] [--skip-warehouse]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const newsTagged = require('../services/news-tagged-loader');
const { readInbox, getInboxPath } = require('../services/flash-news-fetcher');
const { verifyAndCorrectRows } = require('../services/news-history-verifier');
const { saveGeopoliticsDailySeries } = require('../services/geopolitics-daily-aggregator');
const {
  computeNewsStats,
  isRelevantFlashCandidate,
  flashCandidateToExpansionRow,
  buildWarehouseSupplyRows,
  buildAgBasisMissWarehouseRows,
  mergeExpansionRows,
} = require('../services/news-tag-expansion');
const { dedupeSimilar } = require('./news-dedupe-utils');
const { getDataDir } = require('../services/data-paths');

function parseArgs() {
  const args = process.argv.slice(2);
  const thIdx = args.indexOf('--warehouse-threshold');
  return {
    dryRun: args.includes('--dry-run'),
    skipFlash: args.includes('--skip-flash'),
    skipWarehouse: args.includes('--skip-warehouse'),
    minDate: '2019-01-01',
    probeKpi: args.includes('--probe-kpi'),
    warehouseThreshold: thIdx >= 0 ? parseFloat(args[thIdx + 1]) || 5 : 5,
  };
}

function markInboxMerged(mergedFlashIds) {
  if (!mergedFlashIds.length) return 0;
  const inbox = readInbox();
  const idSet = new Set(mergedFlashIds);
  let marked = 0;
  for (const c of inbox.candidates) {
    if (idSet.has(c.id) && c.status === 'pending') {
      c.status = 'merged';
      c.verifyNote = `expand-news-tagged ${new Date().toISOString().slice(0, 10)}`;
      marked += 1;
    }
  }
  fs.writeFileSync(
    getInboxPath(),
    `${JSON.stringify({ ...inbox, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
  return marked;
}

function mergeFilteredFlash(baseRows, candidates, { minDate }) {
  const stats = {
    inboxTotal: candidates.length,
    relevant: 0,
    skippedIrrelevant: 0,
    skippedNoDate: 0,
    skippedBeforeMin: 0,
    skippedDup: 0,
    added: 0,
  };
  const incoming = [];
  const mergedFlashIds = [];

  for (const candidate of candidates) {
    if (!isRelevantFlashCandidate(candidate)) {
      stats.skippedIrrelevant += 1;
      continue;
    }
    stats.relevant += 1;
    const row = flashCandidateToExpansionRow(candidate);
    if (!row) {
      stats.skippedNoDate += 1;
      continue;
    }
    if (row.date < minDate) {
      stats.skippedBeforeMin += 1;
      continue;
    }
    const exact = baseRows.find((r) => r.date === row.date && r.title === row.title);
    if (exact) {
      stats.skippedDup += 1;
      mergedFlashIds.push(candidate.id);
      continue;
    }
    incoming.push(row);
    mergedFlashIds.push(candidate.id);
  }

  const { rows: merged, added, skipped } = mergeExpansionRows(baseRows, incoming);
  stats.added = added;
  stats.skippedDup += skipped;
  const { rows: deduped, removed } = dedupeSimilar(merged);
  stats.dedupedRemoved = removed;

  return { rows: deduped, stats, mergedFlashIds };
}

function runProbeKpi() {
  const env = { ...process.env, FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE || 'E' };
  const res = spawnSync(
    process.execPath,
    ['scripts/probe-tradable-day-kpi.js'],
    { cwd: path.join(__dirname, '..'), env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  if (res.status !== 0) {
    return { ok: false, error: res.stderr || res.stdout || `exit ${res.status}` };
  }
  try {
    const outPath = path.join(__dirname, '..', '_probe-tradable-day-kpi-out.json');
    return { ok: true, payload: JSON.parse(fs.readFileSync(outPath, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Programmatic news-tagged expansion (daily-data-sync calls with skipWarehouse: true).
 * @param {object} options
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.skipFlash=false]
 * @param {boolean} [options.skipWarehouse=false] — daily sync passes true
 * @param {boolean} [options.skipGeopolitics=false] — daily sync chains geo separately
 * @param {string} [options.minDate='2019-01-01']
 * @param {number} [options.warehouseThreshold=5]
 * @param {boolean} [options.probeKpi=false]
 * @param {boolean} [options.quiet=false]
 */
function runNewsTagExpansion(options = {}) {
  const opts = {
    dryRun: Boolean(options.dryRun),
    skipFlash: Boolean(options.skipFlash),
    skipWarehouse: options.skipWarehouse !== undefined ? Boolean(options.skipWarehouse) : true,
    skipGeopolitics: Boolean(options.skipGeopolitics),
    minDate: options.minDate || '2019-01-01',
    warehouseThreshold: options.warehouseThreshold ?? 5,
    probeKpi: Boolean(options.probeKpi),
    quiet: Boolean(options.quiet),
  };

  const historyDir = newsTagged.getHistoryDir();
  const csvPath = newsTagged.getNewsTaggedPath();
  if (!fs.existsSync(csvPath)) {
    const err = new Error(`news-tagged.csv 不存在: ${csvPath}`);
    err.code = 'NO_CSV';
    throw err;
  }

  const baseRows = newsTagged.parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const beforeStats = computeNewsStats(baseRows, { minDate: opts.minDate });
  if (!opts.quiet) {
    console.log('=== BEFORE ===');
    console.log(JSON.stringify(beforeStats, null, 2));
  }

  let workingRows = [...baseRows];
  const stepStats = {};

  if (!opts.skipWarehouse) {
    const auditPath = path.join(getDataDir(), 'history', 'labels', 'user-ag-basis-audit-template.csv');
    const agWh = buildWarehouseSupplyRows('ag', workingRows, {
      minDate: opts.minDate,
      chgThreshold: opts.warehouseThreshold,
    });
    const auWh = buildWarehouseSupplyRows('au', workingRows, {
      minDate: opts.minDate,
      chgThreshold: opts.warehouseThreshold,
    });
    const missWh = buildAgBasisMissWarehouseRows(workingRows, auditPath);
    const whIncoming = [...agWh.rows, ...auWh.rows, ...missWh.rows];
    const whMerge = mergeExpansionRows(workingRows, whIncoming);
    workingRows = whMerge.rows;
    stepStats.warehouse = {
      ag: agWh.stats,
      au: auWh.stats,
      agBasisMiss: missWh.stats,
      merged: { added: whMerge.added, skipped: whMerge.skipped },
    };
    if (!opts.quiet) {
      console.log('\n=== WAREHOUSE BACKFILL ===');
      console.log(JSON.stringify(stepStats.warehouse, null, 2));
    }
  }

  if (!opts.skipFlash) {
    const inbox = readInbox();
    const flashMerge = mergeFilteredFlash(workingRows, inbox.candidates, { minDate: opts.minDate });
    workingRows = flashMerge.rows;
    stepStats.flash = flashMerge.stats;
    stepStats.flash.inboxMarkedMerged = opts.dryRun ? 0 : markInboxMerged(flashMerge.mergedFlashIds);
    if (!opts.quiet) {
      console.log('\n=== FLASH MERGE (filtered) ===');
      console.log(JSON.stringify(stepStats.flash, null, 2));
    }
  }

  let verified = workingRows;
  let verifySummary = null;
  const rowsAdded = workingRows.length - baseRows.length;
  const flashAdded = stepStats.flash?.added ?? 0;
  const warehouseAdded = stepStats.warehouse?.merged?.added ?? 0;
  const deltaRows = rowsAdded > 0 ? rowsAdded : flashAdded + warehouseAdded;

  if (!opts.dryRun) {
    const verify = verifyAndCorrectRows(workingRows);
    verified = verify.rows;
    verifySummary = verify.summary;
    newsTagged.writeNewsTaggedCsv(verified, { backup: true });
    fs.writeFileSync(
      path.join(historyDir, 'news-tagged-verified.csv'),
      newsTagged.rowsToCsv(verified),
      'utf8'
    );
    newsTagged.loadNewsTagged({ force: true });
    if (!opts.skipGeopolitics) {
      const geo = saveGeopoliticsDailySeries({ forceReload: true });
      stepStats.geopolitics = {
        geoSourceRowCount: geo.payload.geoSourceRowCount,
        daysWithGeoNews: geo.payload.daysWithGeoNews,
        startDate: geo.payload.startDate,
        endDate: geo.payload.endDate,
      };
    }
  }

  const afterStats = computeNewsStats(verified, { minDate: opts.minDate });
  if (!opts.quiet) {
    console.log('\n=== AFTER ===');
    console.log(JSON.stringify(afterStats, null, 2));
  }

  let kpiProbe = null;
  if (opts.probeKpi && !opts.dryRun) {
    if (!opts.quiet) console.log('\n=== KPI PROBE (v1.34.8 · may take ~2min) ===');
    kpiProbe = runProbeKpi();
    if (kpiProbe.ok) {
      const t3 = kpiProbe.payload?.kpi?.fullSample?.all?.t3;
      console.log(`au+ag T+3: ${t3?.hitRatePct}% (${t3?.scored} scored)`);
    } else {
      console.warn('KPI probe failed:', kpiProbe.error);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: opts.dryRun,
    warehouseThreshold: opts.warehouseThreshold,
    csvPath,
    before: beforeStats,
    after: afterStats,
    delta: {
      rows2019Plus: afterStats.count - beforeStats.count,
      auAgTagged: afterStats.auAgTagged - beforeStats.auAgTagged,
      geoTagged: afterStats.geoTagged - beforeStats.geoTagged,
      warehouseTagged: afterStats.warehouseTagged - beforeStats.warehouseTagged,
      rowsAdded: deltaRows,
    },
    steps: stepStats,
    verify: verifySummary,
    kpiProbe: kpiProbe?.ok
      ? {
          auAgT3: kpiProbe.payload?.kpi?.fullSample?.all?.t3?.hitRatePct,
          scored: kpiProbe.payload?.kpi?.fullSample?.all?.t3?.scored,
        }
      : kpiProbe,
    wiring: {
      philosophyLayer: 'news-tagged → scoreNewsForInstrumentAtDate → philosophy (newsImpact.shock)',
      logisticFeatures: 'philosophyScore only — no direct news_* feature in v1.34.8 weights',
      geopoliticsDaily: 'geo rows → geopolitics-daily.json (regime/outlook context, not logistic weight)',
      kpiExpectation: 'Row expansion may shift philosophyScore on tagged days; logistic weights unchanged → KPI delta often small until retrain',
    },
  };

  const reportPath = path.join(historyDir, 'news-expansion-report.json');
  if (!opts.dryRun) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  fs.writeFileSync(path.join(__dirname, '..', '_news-expansion-report.json'), JSON.stringify(report, null, 2));

  if (!opts.quiet) {
    console.log('\n=== EXPANSION REPORT ===');
    console.log(JSON.stringify(report, null, 2));
    if (!opts.dryRun) console.log(`\nWrote ${reportPath}`);
  }

  return report;
}

function main() {
  const cli = parseArgs();
  try {
    const report = runNewsTagExpansion({
      dryRun: cli.dryRun,
      skipFlash: cli.skipFlash,
      skipWarehouse: cli.skipWarehouse,
      minDate: cli.minDate,
      warehouseThreshold: cli.warehouseThreshold,
      probeKpi: cli.probeKpi,
    });
    return report;
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, runNewsTagExpansion, mergeFilteredFlash };
