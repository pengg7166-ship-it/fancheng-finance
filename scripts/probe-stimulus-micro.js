/** v1.30 微探针 — 2025+ 每5日采样，2品种 */
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const calibration = require('../services/commodity-outlook-calibration');
const philosophy = require('../services/commodity-outlook-philosophy');

const PROBE_IDS = ['c', 'cu'];
const BASELINE = 0.57;

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

async function main() {
  fs.mkdirSync(path.join(getDataDir() || '', 'oi-snap'), { recursive: true });
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();

  console.log('[micro] decay:', philosophy.eventStimulusDecay('macro_fomc_cut', 1));
  const weights = calibration.getCompositeWeights();
  let hits = 0;
  let total = 0;

  for (const spec of INSTRUMENT_REGISTRY.filter((s) => PROBE_IDS.includes(s.id))) {
    const bars = readCachedKlines(spec.id);
    let prev = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 5) {
      if (normBarDate(bars[t]) < '2025-01-01') continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev);
      if (!row?.predictedDir || row.predictedDir === 'neutral' || !row.actualDir) continue;
      total += 1;
      if (row.hitDirection) hits += 1;
      prev = row.financeRegimeNext || prev;
    }
    console.log(`  ${spec.id} sampled`);
  }

  const hr = total > 0 ? hits / total : null;
  console.log(`\n[micro] 2025+ sample (step=5): ${hr != null ? Math.round(hr * 100) : '—'}% (${hits}/${total})`);
  console.log(`[micro] v1.29 baseline: ${Math.round(BASELINE * 100)}% (全量 longrun)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
