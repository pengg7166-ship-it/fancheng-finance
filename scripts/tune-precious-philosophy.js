/** v1.31.3 贵金属哲学参数网格 — AU/AG 2019+ 快速 walk-forward */
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const philosophy = require('../services/commodity-outlook-philosophy');

const PROBE_FROM = '2019-01-01';
const BATCH8_BASELINE = { overall: 0.565, precious: 0.545 };

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function buildGrid() {
  const base = { ...philosophy.PHILOSOPHY_FIT_SECTOR_CALIBRATION };
  const combos = [{ id: 'v1312-baseline', precious: { ...base.precious, byInstrument: undefined } }];
  const pp = [0.88, 0.92, 0.95, 1.0];
  const cap = [1.15, 1.20, 1.22, 1.25];
  const blend = [0.72, 0.76, 0.78];
  const macroR = [0.82, 0.90, 0.92, 0.95];
  const macroMin = [null, 0.80, 0.82];
  const uncTh = [0.52, 0.55, 0.58];

  for (const postShockPullbackMult of pp) {
    for (const narrativeExtendCap of cap) {
      combos.push({
        id: `pp${postShockPullbackMult}-cap${narrativeExtendCap}`,
        precious: {
          ...base.precious,
          postShockPullbackMult,
          postShockPullbackStarsMult: Math.min(postShockPullbackMult + 0.02, 1),
          narrativeExtendCap,
          byInstrument: {
            au: { postShockPullbackMult, narrativeExtendCap },
            ag: { postShockPullbackMult, narrativeExtendCap },
          },
        },
      });
    }
  }

  for (const macroRepeatRepeatMult of macroR) {
    for (const macroDecayMin of macroMin) {
      combos.push({
        id: `macroR${macroRepeatRepeatMult}-min${macroDecayMin ?? 'none'}`,
        precious: {
          ...base.precious,
          macroRepeatRepeatMult,
          macroRepeatStarsMult: Math.min(macroRepeatRepeatMult + 0.02, 1),
          ...(macroDecayMin != null ? { macroDecayMin } : {}),
        },
      });
    }
  }

  for (const philosophyBlendWeight of blend) {
    for (const philosophyUncertaintyThreshold of uncTh) {
      combos.push({
        id: `blend${philosophyBlendWeight}-unc${philosophyUncertaintyThreshold}`,
        precious: {
          ...base.precious,
          philosophyBlendWeight,
          philosophyUncertaintyThreshold,
          byInstrument: {
            au: { philosophyBlendWeight },
            ag: { philosophyBlendWeight },
          },
        },
      });
    }
  }

  // v1.31.3 candidate bundle
  combos.push({
    id: 'v1313-bundle',
    precious: {
      postShockPullbackMult: 0.95,
      postShockPullbackStarsMult: 0.96,
      postShockBounceMult: 0.9,
      skipPullbackDirectionDowngrade: true,
      narrativeExtendCap: 1.22,
      philosophyBlendWeight: 0.78,
      philosophyUncertaintyThreshold: 0.58,
      macroRepeatRepeatMult: 0.92,
      macroRepeatStarsMult: 0.94,
      macroDecayMin: 0.82,
      byInstrument: {
        au: { postShockPullbackMult: 0.95, narrativeExtendCap: 1.22, philosophyBlendWeight: 0.78 },
        ag: { postShockPullbackMult: 0.95, narrativeExtendCap: 1.22, philosophyBlendWeight: 0.78 },
      },
    },
  });

  return combos;
}

async function runProbe(label, fitOverride) {
  philosophy.setPhilosophyFitCalibration(fitOverride);
  const weights = calibration.getCompositeWeights();
  const specs = INSTRUMENT_REGISTRY.filter(
    (s) => s.sector === 'precious' && readCachedKlines(s.id).length >= 60
  );
  let hits = 0;
  let total = 0;
  const byInst = {};

  for (const spec of specs) {
    const bars = readCachedKlines(spec.id).filter((b) => normBarDate(b) >= '2018-10-01');
    let prevFinance = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 1) {
      if (normBarDate(bars[t]) < PROBE_FROM) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance);
      if (!row) continue;
      prevFinance = row.financeRegimeNext || prevFinance;
      if (!row.predictedDir || row.predictedDir === 'neutral' || !row.actualDir) continue;
      if (!byInst[spec.id]) byInst[spec.id] = { hits: 0, total: 0 };
      byInst[spec.id].total += 1;
      total += 1;
      if (row.hitDirection) {
        byInst[spec.id].hits += 1;
        hits += 1;
      }
    }
  }

  philosophy.setPhilosophyFitCalibration(null);
  const rate = total ? hits / total : 0;
  return { label, precious: rate, hits, total, byInst };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged();
  console.log(`[precious-tune] philosophy ${philosophy.PHILOSOPHY_VERSION} · news ${newsTagged.getRowCount?.() || '?'} rows`);
  console.log(`[precious-tune] batch8 baseline precious ${(BATCH8_BASELINE.precious * 100).toFixed(1)}%\n`);

  const grid = buildGrid();
  const results = [];
  for (let i = 0; i < grid.length; i += 1) {
    const combo = grid[i];
    const r = await runProbe(combo.id, combo);
    results.push({ ...combo, ...r });
    process.stdout.write(
      `\r  ${i + 1}/${grid.length} best ${(Math.max(...results.map((x) => x.precious)) * 100).toFixed(2)}%    `
    );
  }
  console.log('');

  results.sort((a, b) => b.precious * 100 + (b.precious >= 0.58 ? 3 : 0) - (a.precious * 100 + (a.precious >= 0.58 ? 3 : 0)));

  console.log('\n=== TOP 8 precious combos ===');
  for (const r of results.slice(0, 8)) {
    const delta = (r.precious - BATCH8_BASELINE.precious) * 100;
    console.log(
      `${r.id}: ${(r.precious * 100).toFixed(2)}% (${r.hits}/${r.total}) ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp vs batch8`
    );
  }

  const outPath = path.join(process.cwd(), '_precious-tune-result.json');
  fs.writeFileSync(outPath, JSON.stringify({ baseline: BATCH8_BASELINE, top8: results.slice(0, 8), gridSize: grid.length }, null, 2));
  console.log('\nWrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
