/**
 * T+1 方向全样本回测 — Logistic v1.34.8 (au/ag)
 * 全样本 2019+ vs OOS 2023-2026；附带 T+3 对比与 regime 分组
 *
 * 用法:
 *   FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-t1-direction-fullsample.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { getDefaultWeightsPath } = require('../services/outlook-onnx-runner');
const { rowToFeatureVector, FEATURE_NAMES } = require('../services/outlook-logistic-features');
const { sigmoid, directionFromPUp } = require('../services/outlook-onnx-runner');
const { hitDirection } = require('../services/outlook-labels');
const { REGIME_IDS } = require('../services/market-regime-classifier');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const inference = require('../services/cross-market-precious-inference');

const FULL_FROM = '2019-01-01';
const FULL_TO = '2026-12-31';
const OOS_FROM = '2023-01-01';
const OOS_TO = '2026-12-31';
const WEIGHTS_VERSION = 'v1.34.8-ag-cu-spread+basis-term';
const OUT_TXT = path.join(process.cwd(), '_probe-t1-fullsample.txt');
const OUT_JSON = path.join(process.cwd(), '_probe-t1-fullsample.json');

function loadBars(id) {
  const k = readCachedKlines(id);
  if (k.length >= 60) return k;
  const fp = path.join(getDataDir(), 'history/trading', `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

function predict(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function inWindow(dateStr, from, to) {
  const d = String(dateStr || '').slice(0, 10);
  return d >= from && d <= to;
}

function emptyMetrics() {
  return { hits: 0, scored: 0, hitRatePct: null };
}

function scoreRows(rows, weightsObj, filterFn = null) {
  let t1Hits = 0;
  let t1Scored = 0;
  let t3Hits = 0;
  let t3Scored = 0;
  const byRegime = Object.fromEntries(
    REGIME_IDS.map((r) => [r, { t1: emptyMetrics(), t3: emptyMetrics() }]),
  );

  for (const row of rows) {
    if (filterFn && !filterFn(row)) continue;
    const pred = predict(weightsObj, row);
    if (!pred || pred === 'neutral') continue;

    const reg = row.marketRegime || 'range';

    if (row.actualDir && row.actualDir !== 'neutral') {
      t1Scored += 1;
      const hit = hitDirection(pred, row.actualDir);
      if (hit) t1Hits += 1;
      byRegime[reg].t1.scored += 1;
      if (hit) byRegime[reg].t1.hits += 1;
    }

    if (row.actualDirT3 && row.actualDirT3 !== 'neutral') {
      t3Scored += 1;
      const hit3 = hitDirection(pred, row.actualDirT3);
      if (hit3) t3Hits += 1;
      byRegime[reg].t3.scored += 1;
      if (hit3) byRegime[reg].t3.hits += 1;
    }
  }

  const pct = (h, s) => (s ? +((h / s) * 100).toFixed(2) : null);
  const regimeOut = {};
  for (const r of REGIME_IDS) {
    const s1 = byRegime[r].t1;
    const s3 = byRegime[r].t3;
    regimeOut[r] = {
      t1: { hits: s1.hits, scored: s1.scored, hitRatePct: pct(s1.hits, s1.scored) },
      t3: { hits: s3.hits, scored: s3.scored, hitRatePct: pct(s3.hits, s3.scored) },
    };
  }

  return {
    t1: { hits: t1Hits, scored: t1Scored, hitRatePct: pct(t1Hits, t1Scored) },
    t3: { hits: t3Hits, scored: t3Scored, hitRatePct: pct(t3Hits, t3Scored) },
    deltaT3MinusT1Pp:
      t1Scored && t3Scored
        ? +(pct(t3Hits, t3Scored) - pct(t1Hits, t1Scored)).toFixed(2)
        : null,
    byRegime: regimeOut,
  };
}

function aggregateMetrics(list) {
  let t1Hits = 0;
  let t1Scored = 0;
  let t3Hits = 0;
  let t3Scored = 0;
  for (const m of list) {
    t1Hits += m.t1.hits;
    t1Scored += m.t1.scored;
    t3Hits += m.t3.hits;
    t3Scored += m.t3.scored;
  }
  const pct = (h, s) => (s ? +((h / s) * 100).toFixed(2) : null);
  return {
    t1: { hits: t1Hits, scored: t1Scored, hitRatePct: pct(t1Hits, t1Scored) },
    t3: { hits: t3Hits, scored: t3Scored, hitRatePct: pct(t3Hits, t3Scored) },
    deltaT3MinusT1Pp:
      t1Scored && t3Scored
        ? +(pct(t3Hits, t3Scored) - pct(t1Hits, t1Scored)).toFixed(2)
        : null,
  };
}

async function walkInstrument(id) {
  const spec = INSTRUMENT_REGISTRY.find((s) => s.id === id);
  const bars = loadBars(id);
  const weights = calibration.getCompositeWeights();
  const rows = [];
  let prev = 'neutral';
  for (let t = 60; t < bars.length - 3; t += 1) {
    const d = String(bars[t].date || bars[t].time).slice(0, 10);
    if (d < FULL_FROM || d > FULL_TO) continue;
    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
    if (!row) continue;
    prev = row.financeRegimeNext || prev;
    rows.push({ ...row, instrumentId: id });
  }
  return rows;
}

function probeCrossMarketT1(instrumentId, from, to) {
  const bars = inference.loadTradingBars(instrumentId);
  inference.resetIntlSeriesCache();
  const th = instrumentId === 'au' ? 0.3 : 15;

  function dirFromDelta(delta) {
    if (delta > th) return 'bullish';
    if (delta < -th) return 'bearish';
    return 'neutral';
  }

  let hits = 0;
  let scored = 0;
  for (let i = 1; i < bars.length; i += 1) {
    const d = bars[i].date;
    if (d < from || d > to) continue;
    const actualDelta = bars[i].close - bars[i - 1].close;
    const pred = inference.inferPointChangeFromClose(d, instrumentId);
    if (pred.gated || pred.predictedDelta == null) continue;
    const pDir = dirFromDelta(pred.predictedDelta);
    const aDir = dirFromDelta(actualDelta);
    if (pDir === 'neutral' || aDir === 'neutral') continue;
    scored += 1;
    if (pDir === aDir) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
  };
}

function zhTable(payload) {
  const lines = [];
  lines.push('【T+1 方向命中率 — Logistic v1.34.8 全样本探针】');
  lines.push(`权重: ${payload.weightsVersion}`);
  lines.push(`标签: computeT1Direction / actualDir (±0.05% 阈值)`);
  lines.push('');
  lines.push('| 品种 | 窗口 | T+1 % | T+3 % | T+1 scored | T+3 scored | Δ(T3-T1)pp |');
  lines.push('|------|------|-------|-------|------------|------------|------------|');

  for (const id of ['au', 'ag']) {
    const inst = payload.perInstrument[id];
    for (const [winKey, winLabel] of [
      ['full', `全样本 ${FULL_FROM.slice(0, 4)}+`],
      ['oos', `OOS ${OOS_FROM.slice(0, 4)}-${OOS_TO.slice(0, 4)}`],
    ]) {
      const m = inst[winKey];
      lines.push(
        `| ${id.toUpperCase()} | ${winLabel} | ${m.t1.hitRatePct ?? 'N/A'} | ${m.t3.hitRatePct ?? 'N/A'} | ${m.t1.scored} | ${m.t3.scored} | ${m.deltaT3MinusT1Pp ?? 'N/A'} |`,
      );
    }
  }

  for (const [winKey, winLabel] of [
    ['full', `全样本 ${FULL_FROM.slice(0, 4)}+`],
    ['oos', `OOS ${OOS_FROM.slice(0, 4)}-${OOS_TO.slice(0, 4)}`],
  ]) {
    const m = payload.auAg[winKey];
    lines.push(
      `| AU+AG | ${winLabel} | ${m.t1.hitRatePct ?? 'N/A'} | ${m.t3.hitRatePct ?? 'N/A'} | ${m.t1.scored} | ${m.t3.scored} | ${m.deltaT3MinusT1Pp ?? 'N/A'} |`,
    );
  }

  lines.push('');
  lines.push('【vs T+3 基线 (probe-precious-longrun-t3, 全样本 2019+)】');
  const bl = payload.t3BaselineFullSample;
  if (bl) {
    lines.push(`- AU T+3: ${bl.au?.hitRatePct ?? 'N/A'}% (n=${bl.au?.scored ?? 0})`);
    lines.push(`- AG T+3: ${bl.ag?.hitRatePct ?? 'N/A'}% (n=${bl.ag?.scored ?? 0})`);
    lines.push(`- AU+AG T+3: ${bl.auAg?.hitRatePct ?? 'N/A'}% (n=${bl.auAg?.scored ?? 0})`);
  }

  if (payload.crossMarket) {
    lines.push('');
    lines.push('【跨境传导 inferPointChangeFromClose — T+1 方向】');
    for (const id of ['au', 'ag']) {
      const cm = payload.crossMarket[id];
      lines.push(
        `- ${id.toUpperCase()} 全样本: ${cm.full.hitRatePct ?? 'N/A'}% (n=${cm.full.scored})`,
      );
      lines.push(
        `- ${id.toUpperCase()} OOS: ${cm.oos.hitRatePct ?? 'N/A'}% (n=${cm.oos.scored})`,
      );
    }
  }

  lines.push('');
  lines.push('【Regime 分组 T+1 (全样本)】');
  for (const id of ['au', 'ag']) {
    lines.push(`--- ${id.toUpperCase()} ---`);
    const reg = payload.perInstrument[id].full.byRegime;
    for (const r of REGIME_IDS) {
      const s = reg[r]?.t1;
      if (s?.scored) {
        lines.push(`  ${r}: ${s.hitRatePct}% (n=${s.scored})`);
      }
    }
  }

  return lines.join('\n');
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const weightsPath = getDefaultWeightsPath();
  const weightsRaw = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  const weightsObj = weightsRaw.weights;

  const perInstrument = {};
  const allRows = { au: [], ag: [] };

  for (const id of ['au', 'ag']) {
    const rows = await walkInstrument(id);
    allRows[id] = rows;
    perInstrument[id] = {
      full: scoreRows(rows, weightsObj),
      oos: scoreRows(rows, weightsObj, (r) => inWindow(r.date, OOS_FROM, OOS_TO)),
    };
  }

  const auAg = {
    full: aggregateMetrics([perInstrument.au.full, perInstrument.ag.full]),
    oos: aggregateMetrics([perInstrument.au.oos, perInstrument.ag.oos]),
  };

  const crossMarket = {};
  for (const id of ['au', 'ag']) {
    crossMarket[id] = {
      full: probeCrossMarketT1(id, FULL_FROM, FULL_TO),
      oos: probeCrossMarketT1(id, OOS_FROM, OOS_TO),
    };
  }

  const t3BaselineFullSample = {
    au: { hitRatePct: 63.09, scored: 447 },
    ag: { hitRatePct: 60.46, scored: 521 },
    auAg: { hitRatePct: 61.67, scored: 968 },
    source: '_probe-longrun-t3-v1348-out.txt',
  };

  const payload = {
    version: 'probe-t1-direction-fullsample',
    weightsVersion: weightsRaw.version || WEIGHTS_VERSION,
    weightsPath,
    labelMethod: 'computeT1Direction / backtest.actualDir (±0.05%)',
    model: 'logistic-json walk-forward',
    windows: {
      full: { from: FULL_FROM, to: FULL_TO },
      oos: { from: OOS_FROM, to: OOS_TO },
    },
    perInstrument,
    auAg,
    crossMarket,
    t3BaselineFullSample,
    generatedAt: new Date().toISOString(),
  };

  const zh = zhTable(payload);
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(OUT_TXT, `${zh}\n\n--- JSON ---\n${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(zh);
  console.log(`\nWrote ${OUT_TXT}`);
  console.log(`Wrote ${OUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
