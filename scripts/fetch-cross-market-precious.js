/**
 * 抓取 COMEX GC/SI + 伦敦银 → data/history/*.json
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/fetch-cross-market-precious.js [--force]
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { saveCrossMarketPreciousHistory } = require('../services/cross-market-precious-fetcher');

async function main() {
  const force = process.argv.includes('--force');
  try {
    const result = await saveCrossMarketPreciousHistory({ force });
    console.log(
      JSON.stringify(
        {
          ok: true,
          dataDir: result.dataDir,
          gc: {
            file: result.gc.jsonPath,
            rows: result.gc.rowCount,
            source: result.gc.source,
            fromCache: result.gc.fromCache,
          },
          si: {
            file: result.si.jsonPath,
            rows: result.si.rowCount,
            source: result.si.source,
            fromCache: result.si.fromCache,
          },
          londonSilver: {
            file: result.londonSilver.jsonPath,
            rows: result.londonSilver.rowCount,
            source: result.londonSilver.source,
            proxy: Boolean(result.londonSilver.proxy),
            fromCache: result.londonSilver.fromCache,
          },
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
