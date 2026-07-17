/**
 * Aggressive confidence sweep — tradeoff curve toward 75%
 * Uses cached walk rows if present, else samples top instruments.
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { hitDirection } = require('../services/outlook-labels');
const { directionFromPUp } = require('../services/outlook-onnx-runner');

const CACHE = path.join(process.cwd(), 'data', 'exports', 'direction-t1-walk-rows-lite.jsonl');
const OUT = path.join(process.cwd(), '_sweep-t1-aggressive-confidence.json');

function pct(h, s) {
  return s ? +((h / s) * 100).toFixed(2) : null;
}

function score(rows, conf, bull = 0.55, bear = 0.45, exclude = new Set()) {
  let hits = 0;
  let scored = 0;
  for (const r of rows) {
    if (exclude.has(r.instrumentId)) continue;
    if (r.pUp == null) continue;
    if (Math.abs(r.pUp - 0.5) < conf) continue;
    const pred = directionFromPUp(r.pUp, { bullishThreshold: bull, bearishThreshold: bear });
    if (pred === 'neutral' || !r.actualDir || r.actualDir === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, r.actualDir)) hits += 1;
  }
  return { hits, scored, hitRatePct: pct(hits, scored), conf, bull, bear };
}

async function collectLiteRows() {
  const diskCache = require('../services/disk-cache');
  const { getDataDir } = require('../services/data-paths');
  const backtest = require('../services/commodity-outlook-backtest');
  const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
  const calibration = require('../services/commodity-outlook-calibration');
  const historicalContext = require('../services/commodity-outlook-historical-context');
  const newsTagged = require('../services/news-tagged-loader');
  const { readCachedKlines } = require('../services/commodity-technical-analyzer');
  const archive = require('../services/direction-prediction-archive');
  const { predictFromWeights, getDefaultWeightsPath } = require('../services/outlook-onnx-runner');

  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: false });

  const weightsPayload = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8'));
  const weights = calibration.getCompositeWeights();
  const ids = ['au', 'ag', 'cu', 'sc', 'fu', 'bu', 'jm', 'ni', 'ta', 'm', 'i', 'rb', 'au', 'ag'];
  const uniqueIds = [...new Set(ids)];
  const rows = [];

  function buildFlat(spec, row) {
    return {
      instrumentId: spec.id,
      philosophyScore: row.philosophyScore,
      factorComposite: row.factorComposite,
      adaptiveScore: row.adaptiveScore,
      real10y_chg_5d: row.real10y_chg_5d,
      warehouseReceipt_chg_5d: row.warehouseReceipt_chg_5d,
      term_spread_pct: row.term_spread_pct,
      term_z_score: row.term_z_score,
      term_spread_chg_5d: row.term_spread_chg_5d,
      cu_momentum_5d: row.cu_momentum_5d,
      cu_term_spread_pct: row.cu_term_spread_pct,
      cu_term_z_score: row.cu_term_z_score,
      gsr_z_score: row.gsr_z_score,
      slvHoldings_chg_5d: row.slvHoldings_chg_5d,
      lmeInventory_chg_wow: row.lmeInventory_chg_wow,
      gldHoldings_chg_5d: row.gldHoldings_chg_5d,
      oiBehavior: row.oiBehavior,
      marketRegime: row.marketRegime,
      philosophyMeta: row.philosophyMeta,
    };
  }

  for (const id of uniqueIds) {
    const spec = INSTRUMENT_REGISTRY.find((s) => s.id === id);
    let bars = readCachedKlines(id);
    if (bars.length < 60) {
      const fp = path.join(getDataDir(), 'history/trading', `${id}.json`);
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      bars = Array.isArray(raw) ? raw : raw.series || [];
    }
    let prev = 'neutral';
    for (let t = 60; t < bars.length - 1; t += 1) {
      const day = String(bars[t].date || bars[t].time).slice(0, 10);
      if (day < '2017-12-11' || day > '2025-12-31') continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      const actual = archive.resolveActualT1(bars, day);
      if (actual.status !== 'complete' || !actual.actualDir || actual.actualDir === 'neutral') continue;
      const flat = buildFlat(spec, row);
      const pred = predictFromWeights(weightsPayload, flat);
      rows.push({
        instrumentId: id,
        sector: spec.sector,
        date: day,
        pUp: pred?.pUp,
        marketRegime: row.marketRegime,
        actualDir: actual.actualDir,
      });
    }
    console.log(id, 'rows', rows.length);
  }
  return rows;
}

async function main() {
  let rows;
  if (fs.existsSync(CACHE)) {
    rows = fs.readFileSync(CACHE, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    console.log('loaded cache', rows.length);
  } else {
    rows = await collectLiteRows();
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log('wrote cache', CACHE, rows.length);
  }

  const exclude = new Set(['si', 'l', 'sh', 'lh', 'lg', 'pk', 'cj', 'ad', 'bc', 'br']);
  const sweep = [];
  for (let conf = 0.02; conf <= 0.45; conf += 0.01) {
    sweep.push(score(rows, conf, 0.55, 0.45, new Set()));
    sweep.push(score(rows, conf, 0.58, 0.42, exclude));
  }

  const byConf = {};
  for (const s of sweep) {
    const k = `${s.conf}_${s.bull}`;
    if (!byConf[k] || s.hitRatePct > byConf[k].hitRatePct) byConf[k] = s;
  }

  const hits75 = sweep.filter((s) => s.hitRatePct >= 75 && s.scored >= 50);
  const hits75n200 = sweep.filter((s) => s.hitRatePct >= 75 && s.scored >= 200);

  const bestN200 = [...sweep].filter((s) => s.scored >= 200).sort((a, b) => b.hitRatePct - a.hitRatePct)[0];
  const bestAny = [...sweep].filter((s) => s.scored >= 30).sort((a, b) => b.hitRatePct - a.hitRatePct)[0];

  const out = {
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    hits75WithN50: hits75,
    hits75WithN200: hits75n200,
    bestWithN200: bestN200,
    bestWithN30: bestAny,
    top20: [...sweep].filter((s) => s.scored >= 30).sort((a, b) => b.hitRatePct - a.hitRatePct).slice(0, 20),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('75% with n>=200:', hits75n200.length ? hits75n200 : 'NONE');
  console.log('best n>=200:', bestN200);
  console.log('best n>=30:', bestAny);
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
