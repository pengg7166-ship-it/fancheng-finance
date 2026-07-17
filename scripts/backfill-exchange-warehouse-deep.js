#!/usr/bin/env node
/**
 * 深度回填：DCE / CZCE / GFEX 仓单 ≥60–90 个交易日
 *   node scripts/backfill-exchange-warehouse-deep.js
 *   node scripts/backfill-exchange-warehouse-deep.js --only dce
 *   node scripts/backfill-exchange-warehouse-deep.js --only czce,gfex
 */
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));
require('../services/config').init(path.join(os.homedir(), 'AppData', 'Roaming', 'fancheng-finance'));

function parseOnly() {
  const i = process.argv.indexOf('--only');
  if (i < 0) return new Set(['dce', 'czce', 'gfex']);
  return new Set(
    String(process.argv[i + 1] || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

(async () => {
  const only = parseOnly();
  const out = {};

  if (only.has('dce')) {
    const dce = require('../services/dce-portal-api-fetcher');
    console.log('[dce] deep backfill…');
    out.dce = await dce.backfillDceWarehouseHistory({ deep: true, lookbackDays: 160, targetDays: 90 });
    console.log('[dce] fetched', out.dce.warehouseFetched, 'persistOk', (out.dce.persist?.results || []).filter((r) => r.status === 'ok').length);
  }

  if (only.has('czce')) {
    const czce = require('../services/czce-warehouse-fetcher');
    console.log('[czce] scrape…');
    out.czce = await czce.scrapeCzceWarehouseReceipts({ deep: true, lookbackDays: 140, targetDays: 90 });
    console.log('[czce] daysFilled', out.czce.daysFilled);
  }

  if (only.has('gfex')) {
    const gfex = require('../services/gfex-warehouse-fetcher');
    console.log('[gfex] scrape…');
    out.gfex = await gfex.scrapeGfexWarehouseReceipts({ deep: true, lookbackDays: 140, targetDays: 90 });
    console.log('[gfex] daysFilled', out.gfex.daysFilled);
  }

  console.log(JSON.stringify({ ok: true, summary: {
    dce: out.dce && { fetched: out.dce.warehouseFetched, errors: out.dce.errors?.length || 0 },
    czce: out.czce && { daysFilled: out.czce.daysFilled, errors: out.czce.errors?.length || 0 },
    gfex: out.gfex && { daysFilled: out.gfex.daysFilled, errors: out.gfex.errors?.length || 0 },
  } }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
