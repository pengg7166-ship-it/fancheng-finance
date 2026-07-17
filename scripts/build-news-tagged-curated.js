/**
 * Build news-tagged-curated.csv from full news-tagged.csv (training-only subset)
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/build-news-tagged-curated.js [--warehouse-min-pct 5]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const newsTagged = require('../services/news-tagged-loader');
const curation = require('../services/news-tagged-curation');
const { computeNewsStats } = require('../services/news-tag-expansion');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { warehouseMinAbsChgPct: 5, excludeAllAutoWarehouse: true };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--warehouse-min-pct') opts.warehouseMinAbsChgPct = parseFloat(args[++i]) || 5;
    if (args[i] === '--keep-large-warehouse-only') opts.excludeAllAutoWarehouse = false;
  }
  return opts;
}

function main() {
  const filterOpts = parseArgs();
  const { rows: fullRows, path: csvPath } = newsTagged.loadNewsTagged({ force: true });
  const { kept, excluded, stats } = curation.buildCuratedRows(fullRows, filterOpts);
  const outPath = curation.getCuratedNewsTaggedPath();
  curation.writeCuratedCsv(kept, outPath);

  const before = computeNewsStats(fullRows);
  const after = computeNewsStats(kept);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceCsv: csvPath,
    curatedCsv: outPath,
    filter: filterOpts,
    rowCounts: stats,
    before: {
      count2019: stats.full2019Plus,
      auAgTagged: before.auAgTagged,
      warehouseTagged: before.warehouseTagged,
      tiers: before.tiers,
    },
    after: {
      count2019: stats.curated2019Plus,
      auAgTagged: after.auAgTagged,
      warehouseTagged: after.warehouseTagged,
      tiers: after.tiers,
    },
    sampleExcluded: excluded.slice(0, 8).map((r) => ({
      date: r.date,
      title: (r.title || '').slice(0, 60),
      event_id: r.event_id,
      reason: curation.isAutoWarehouseRow(r) ? 'auto_warehouse' : curation.isLowSignalFlash(r) ? 'low_signal_flash' : 'other',
    })),
    reproduce: 'FANCHENG_DATA_DRIVE=E node scripts/build-news-tagged-curated.js',
  };

  const outJson = path.join(process.cwd(), '_news-curated-stats.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main();
