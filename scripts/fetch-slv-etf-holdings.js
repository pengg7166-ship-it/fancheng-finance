/**
 * 抓取/导入 SLV ETF 持仓 → slv-etf-holdings-daily.json
 * 用法:
 *   FANCHENG_DATA_DRIVE=E node scripts/fetch-slv-etf-holdings.js
 *   node scripts/fetch-slv-etf-holdings.js --import path/to/user-slv-holdings.csv
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { saveSlvEtfHoldings } = require('../services/slv-etf-fetcher');

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--import');
  return { importPath: i >= 0 ? args[i + 1] : null };
}

async function main() {
  const { importPath } = parseArgs();
  try {
    const { payload, jsonPath } = await saveSlvEtfHoldings({ importPath });
    console.log(
      JSON.stringify(
        {
          ok: true,
          file: jsonPath,
          rows: payload.rowCount,
          source: payload.source,
          proxy: payload.proxy,
          startDate: payload.startDate,
          endDate: payload.endDate,
          attempts: payload.sourceAttempts,
          mergeStats: payload.mergeStats,
          note: payload.note,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: err.message,
          attempts: err.attempts || [],
          manualFallbackUrls: err.manualFallbackUrls || null,
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
