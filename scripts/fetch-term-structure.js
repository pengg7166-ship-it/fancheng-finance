/**
 * P0 期限结构 — 近月主力连续 vs 远月单合约（Sina）
 * 目标: E:\FanchengFinance\data\history\term-structure\{id}-daily.json
 *
 * 用法:
 *   FANCHENG_DATA_DRIVE=E node scripts/fetch-term-structure.js
 *   node scripts/fetch-term-structure.js --force
 *   node scripts/fetch-term-structure.js --id au,ag,cu,sc
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const {
  fetchAndSaveTermStructure,
  P0_INSTRUMENTS,
  OUT_SUBDIR,
} = require('../services/term-structure-fetcher');
const { getDataDir } = require('../services/data-paths');

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const idIdx = args.indexOf('--id');
  const instruments =
    idIdx >= 0 && args[idIdx + 1]
      ? args[idIdx + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : P0_INSTRUMENTS;
  return { force, instruments };
}

async function main() {
  const dataDir = getDataDir();
  if (!dataDir) throw new Error('FANCHENG_DATA_DRIVE 未配置或数据盘不可写');

  const { force, instruments } = parseArgs();
  const { results } = await fetchAndSaveTermStructure({ force, instruments });

  const summary = {
    ok: true,
    dataDir,
    outDir: path.join(dataDir, 'history', OUT_SUBDIR),
    force,
    instruments,
    results,
    landed: results.filter((r) => r.status === 'ok').map((r) => ({
      id: r.instrumentId,
      rows: r.rowCount,
      file: r.file,
      range: `${r.startDate} → ${r.endDate}`,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.landed.length && !results.some((r) => r.status === 'skipped')) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
