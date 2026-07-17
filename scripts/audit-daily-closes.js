#!/usr/bin/env node
/**
 * 审计本地日 K 收盘价 vs 东方财富拉取 — 样本 AU/FG/CU/RB
 */
const diskCache = require('../services/disk-cache');
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const { getCommodityMeta } = require('../services/commodities-catalog');
const { fetchCommodityHistory } = require('../services/commodities-history-fetcher');
const dailyClose = require('../services/daily-close-sync');

const SAMPLE = ['au', 'fg', 'cu', 'rb'];

function readLocalClose(id) {
  const latest = dailyClose.getLatestBarClose(id);
  return latest ? { close: latest.close, date: latest.tradeDate, source: latest.source } : null;
}

async function fetchRemoteClose(id) {
  const data = await fetchCommodityHistory(id, 'day', { force: true });
  const bars = data.klines || [];
  const last = bars[bars.length - 1];
  if (!last) return null;
  return {
    close: Number(last.close),
    date: String(last.date).slice(0, 10),
    source: data.source,
  };
}

async function main() {
  const dataDir = getDataDir();
  if (!dataDir) {
    console.error('FANCHENG_DATA_DRIVE 未配置');
    process.exit(1);
  }
  diskCache.init(getUserDataDir() || dataDir);

  console.log('Audit daily closes vs East Money refresh');
  console.log('Data dir:', dataDir);
  console.log('---');

  const rows = [];
  let mismatches = 0;

  for (const id of SAMPLE) {
    const meta = getCommodityMeta(id);
    const local = readLocalClose(id);
    let remote = null;
    let error = null;
    try {
      remote = await fetchRemoteClose(id);
    } catch (err) {
      error = err.message;
    }

    const delta =
      local?.close != null && remote?.close != null ? Math.abs(local.close - remote.close) : null;
    const match = delta != null ? delta < 0.01 : false;
    if (local && remote && !match) mismatches += 1;

    rows.push({
      id: id.toUpperCase(),
      name: meta?.name || id,
      localDate: local?.date || '—',
      localClose: local?.close ?? '—',
      remoteDate: remote?.date || '—',
      remoteClose: remote?.close ?? '—',
      remoteSource: remote?.source || error || '—',
      delta: delta != null ? +delta.toFixed(4) : '—',
      ok: match || (local?.close == null && remote?.close != null) ? 'REFRESHED' : match ? 'OK' : 'MISMATCH',
    });
  }

  for (const r of rows) {
    console.log(
      `${r.id} ${r.name}: local ${r.localClose}@${r.localDate} | remote ${r.remoteClose}@${r.remoteDate} (${r.remoteSource}) | Δ=${r.delta} → ${r.ok}`
    );
  }

  console.log('---');
  console.log(`Sample mismatches: ${mismatches}/${SAMPLE.length}`);
  process.exit(mismatches > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
