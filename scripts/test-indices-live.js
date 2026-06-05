/**
 * Verify SP500 / FTSE use live sources and values can change between fetches.
 * Usage: node scripts/test-indices-live.js
 */
const { fetchGlobalIndices } = require('../services/indices-fetcher');

function pickIndices(pack, ids) {
  const flat = pack.regions.flatMap((r) => r.indices);
  return Object.fromEntries(ids.map((id) => [id, flat.find((i) => i.id === id)]));
}

async function main() {
  const ids = ['sp500', 'ftse', 'dji', 'sse', 'dax'];
  const first = await fetchGlobalIndices();
  console.log('stats:', first.success, '/', first.total, 'failed:', first.failed);
  const a = pickIndices(first, ids);
  for (const id of ids) {
    const row = a[id];
    console.log(
      id,
      row
        ? `${row.price} (${row.changePct}%) source=${row.source || '?'} stale=${Boolean(row.stale)}`
        : 'MISSING'
    );
  }

  await new Promise((r) => setTimeout(r, 4000));
  const second = await fetchGlobalIndices();
  const b = pickIndices(second, ids);
  let changed = 0;
  for (const id of ids) {
    if (a[id]?.price !== b[id]?.price || a[id]?.changePct !== b[id]?.changePct) changed += 1;
  }

  const sp500Ok = a.sp500 && !a.sp500.stale && a.sp500.price > 7000;
  const ftseOk = a.ftse && !a.ftse.stale && a.ftse.price > 9500;

  console.log('sp500 live quote:', sp500Ok ? 'OK' : 'FAIL', a.sp500?.price);
  console.log('ftse live quote:', ftseOk ? 'OK' : 'FAIL', a.ftse?.price);
  console.log('fields changed in 4s:', changed, '(may be 0 after hours)');

  if (!sp500Ok || !ftseOk || first.success < 15) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
