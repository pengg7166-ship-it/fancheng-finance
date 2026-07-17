/**
 * Smoke test: run 2 outlook quote refresh cycles 30s apart.
 * Usage: node scripts/smoke-outlook-live-refresh.js
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { runQuoteCycle, isMarketSessionLive } = require('../services/outlook-live-refresh');

async function main() {
  const force = process.argv.includes('--force');
  console.log('inSession:', isMarketSessionLive(), 'force:', force);
  const a = await runQuoteCycle({ force });
  console.log('cycle1:', {
    ok: Boolean(a),
    liveRefreshedAt: a?.liveRefreshedAt,
    quotedCount: a?.quotedCount,
    fgPrice: a?.commodities?.exchanges?.flatMap((ex) => ex.items || []).find((i) => String(i.id).toUpperCase() === 'FG')?.price,
  });
  console.log('waiting 30s...');
  await new Promise((r) => setTimeout(r, 30000));
  const b = await runQuoteCycle({ force });
  console.log('cycle2:', {
    ok: Boolean(b),
    liveRefreshedAt: b?.liveRefreshedAt,
    quotedCount: b?.quotedCount,
    fgPrice: b?.commodities?.exchanges?.flatMap((ex) => ex.items || []).find((i) => String(i.id).toUpperCase() === 'FG')?.price,
  });
  const logPath = path.join(
    process.env.FANCHENG_DATA_DIR || 'E:/FanchengFinance/data',
    'logs',
    'outlook-live-refresh.jsonl'
  );
  console.log('log tail:', logPath);
  try {
    const fs = require('fs');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    console.log(lines.slice(-4).join('\n'));
  } catch (err) {
    console.warn('log read failed:', err.message);
  }
}

main()
  .then(() => {
    console.log('ALL PASS outlook-live-refresh');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
