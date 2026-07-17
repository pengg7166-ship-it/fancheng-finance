#!/usr/bin/env node
/**
 * Walk-forward 合证/资金态度归因（真实日 K，无 synthetic）
 * 度量：特征指示方向 vs T+1 / T+3 实际方向；缺失不计分。
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=F F:\FanchengFinance\tools\node-v22\node.exe scripts/attribute-stockflow-joint-walkforward.js
 *   ... --days 120 --min-n 20
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) {
  process.env.FANCHENG_DATA_DRIVE = fs.existsSync('F:/FanchengFinance/data') ? 'F' : 'E';
}
process.env.FANCHENG_APP_ROOT = process.env.FANCHENG_APP_ROOT || 'F:/FanchengFinance';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();

const { getDataDir } = require('../services/data-paths');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const { buildStockFlowJoint } = require('../services/inventory-capital-joint');
const { stanceFromOi } = require('../services/capital-attitude');
const { jointDecisionDelta } = require('../services/stock-flow-joint-signal');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { computeT1Direction, computeT3TrendLabel, hitDirection } = require('../services/outlook-labels');

const DAYS = (() => {
  const i = process.argv.indexOf('--days');
  if (i >= 0) return Math.max(40, Math.min(400, Number(process.argv[i + 1]) || 120));
  return 120;
})();
const MIN_N = (() => {
  const i = process.argv.indexOf('--min-n');
  if (i >= 0) return Math.max(8, Math.min(200, Number(process.argv[i + 1]) || 20));
  return 20;
})();

const NO_WH = new Set(['ec', 'wh', 'pm', 'ri', 'lr', 'jr', 'zc']);

function bucket() {
  return { hits: 0, n: 0, missActual: 0, unavailable: 0 };
}

function addHit(b, hit) {
  if (!b) return;
  b.n += 1;
  if (hit) b.hits += 1;
}

function rate(b) {
  if (!b || !b.n) return null;
  return {
    hitRate: +((b.hits / b.n) * 100).toFixed(1),
    hits: b.hits,
    n: b.n,
    display: `${((b.hits / b.n) * 100).toFixed(1)}% (${b.hits}/${b.n})`,
  };
}

function predFromBias(bias) {
  if (bias === 'bull') return 'bullish';
  if (bias === 'bear') return 'bearish';
  return null;
}

function predFromAttitude(stance) {
  if (stance === 'inflow' || stance === 'mild_in') return 'bullish';
  if (stance === 'outflow' || stance === 'mild_out') return 'bearish';
  return null;
}

function predFromDelta(delta) {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.04) return null;
  return delta > 0 ? 'bullish' : 'bearish';
}

function main() {
  const outDir = path.join(getDataDir() || 'F:/FanchengFinance/data', 'audits');
  fs.mkdirSync(outDir, { recursive: true });

  const byRegimeT1 = {};
  const byRegimeT3 = {};
  const byHorizonBiasT1 = { '1w': bucket(), '1m': bucket(), '3m': bucket(), '1y': bucket() };
  const byHorizonBiasT3 = { '1w': bucket(), '1m': bucket(), '3m': bucket(), '1y': bucket() };
  const byInstT1 = {};
  const byInstT3 = {};
  const byAttitudeT1 = bucket();
  const byAttitudeT3 = bucket();
  const byJointSignalT1 = bucket();
  const byJointSignalT3 = bucket();
  const baselineT1 = bucket();
  const baselineT3 = bucket();
  const soloWhT1 = bucket();
  const soloWhT3 = bucket();

  let jointBars = 0;
  let jointAvailBars = 0;
  let scoredInst = 0;

  console.log('[attr] instruments', INSTRUMENT_REGISTRY.length, 'days', DAYS);

  for (const spec of INSTRUMENT_REGISTRY) {
    const id = String(spec.id).toLowerCase();
    const bars = readCachedKlines(id) || [];
    if (!bars.length || bars.length < 80) {
      console.log('[attr] skip', id, 'bars', bars.length || 0);
      continue;
    }
    const end = bars.length - 4;
    const begin = Math.max(60, end - DAYS);
    if (begin >= end) continue;

    if (!byInstT1[id]) byInstT1[id] = bucket();
    if (!byInstT3[id]) byInstT3[id] = bucket();
    let instScored = 0;

    for (let t = begin; t <= end; t += 1) {
      const barDate = String(bars[t].date || '').slice(0, 10);
      if (!barDate) continue;

      const t1 = computeT1Direction(bars, t);
      const t3 = computeT3TrendLabel(bars, t);
      const act1 = t1.direction;
      const act3 = t3.direction;

      if (act1 === 'bullish' || act1 === 'bearish') {
        baselineT1.n += 1;
        if (act1 === 'bullish') baselineT1.hits += 1;
      }
      if (act3 === 'bullish' || act3 === 'bearish') {
        baselineT3.n += 1;
        if (act3 === 'bullish') baselineT3.hits += 1;
      }

      const joint = NO_WH.has(id)
        ? { available: false, reason: 'no_warehouse_by_design', horizons: {} }
        : buildStockFlowJoint(id, barDate);
      jointBars += 1;
      if (joint?.available) jointAvailBars += 1;

      const signal = jointDecisionDelta(joint, { profileInventorySens: 0.7 });
      const predSignal = predFromDelta(signal.delta);

      if (predSignal && (act1 === 'bullish' || act1 === 'bearish')) {
        addHit(byJointSignalT1, hitDirection(predSignal, act1) === true);
        addHit(byInstT1[id], hitDirection(predSignal, act1) === true);
        instScored += 1;
      }
      if (predSignal && (act3 === 'bullish' || act3 === 'bearish')) {
        addHit(byJointSignalT3, hitDirection(predSignal, act3) === true);
        addHit(byInstT3[id], hitDirection(predSignal, act3) === true);
      }

      if (joint?.available) {
        const regime = joint.primaryRegime || 'unknown';
        if (!byRegimeT1[regime]) byRegimeT1[regime] = bucket();
        if (!byRegimeT3[regime]) byRegimeT3[regime] = bucket();
        const predBias = predFromBias(joint.structureBias);
        if (predBias && (act1 === 'bullish' || act1 === 'bearish')) {
          addHit(byRegimeT1[regime], hitDirection(predBias, act1) === true);
        } else if (!predBias && joint.structureBias === 'mixed') {
          byRegimeT1[regime].unavailable += 1;
        }
        if (predBias && (act3 === 'bullish' || act3 === 'bearish')) {
          addHit(byRegimeT3[regime], hitDirection(predBias, act3) === true);
        }

        for (const hk of ['1w', '1m', '3m', '1y']) {
          const h = joint.horizons?.[hk];
          if (!h?.structureBias || h.structureBias === 'mixed') continue;
          const hp = predFromBias(h.structureBias);
          if (!hp) continue;
          if (act1 === 'bullish' || act1 === 'bearish') {
            addHit(byHorizonBiasT1[hk], hitDirection(hp, act1) === true);
          }
          if (act3 === 'bullish' || act3 === 'bearish') {
            addHit(byHorizonBiasT3[hk], hitDirection(hp, act3) === true);
          }
        }
      }

      // 态度方向：直接用合证窗口 OI（避免每 bar 再跑一遍 computeCapitalAttitude）
      const oi1w = joint?.horizons?.['1w']?.oiPct ?? null;
      const oi1m = joint?.horizons?.['1m']?.oiPct ?? null;
      const oi3m = joint?.horizons?.['3m']?.oiPct ?? null;
      const att = stanceFromOi(oi1w, oi1m, oi3m);
      const predAtt = predFromAttitude(att?.stance);
      if (predAtt && (act1 === 'bullish' || act1 === 'bearish')) {
        addHit(byAttitudeT1, hitDirection(predAtt, act1) === true);
      }
      if (predAtt && (act3 === 'bullish' || act3 === 'bearish')) {
        addHit(byAttitudeT3, hitDirection(predAtt, act3) === true);
      }

      if ((!joint?.available || joint.structureBias === 'mixed') && !NO_WH.has(id)) {
        const wh =
          joint?.horizons?.['1m']?.warehousePct ?? joint?.horizons?.['1w']?.warehousePct ?? null;
        if (wh != null && Math.abs(wh) >= 1.2) {
          const predSolo = wh < 0 ? 'bullish' : 'bearish';
          if (act1 === 'bullish' || act1 === 'bearish') {
            addHit(soloWhT1, hitDirection(predSolo, act1) === true);
          }
          if (act3 === 'bullish' || act3 === 'bearish') {
            addHit(soloWhT3, hitDirection(predSolo, act3) === true);
          }
        }
      }
    }
    if (instScored > 0) scoredInst += 1;
  }

  function rankBuckets(map, minN = MIN_N) {
    return Object.entries(map)
      .map(([k, b]) => ({ key: k, ...rate(b), missActual: b.missActual, unavailable: b.unavailable }))
      .filter((r) => r.n >= minN)
      .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0));
  }

  const regimeT1 = rankBuckets(byRegimeT1, Math.min(MIN_N, 15));
  const regimeT3 = rankBuckets(byRegimeT3, Math.min(MIN_N, 15));
  const horizonT1 = Object.fromEntries(
    Object.entries(byHorizonBiasT1).map(([k, b]) => [k, rate(b)])
  );
  const horizonT3 = Object.fromEntries(
    Object.entries(byHorizonBiasT3).map(([k, b]) => [k, rate(b)])
  );

  const instT1 = rankBuckets(byInstT1, MIN_N);
  const liftVs50 = (r) => (r?.hitRate != null ? +(r.hitRate - 50).toFixed(1) : null);

  const helpfulRegimes = regimeT1.filter((r) => r.hitRate >= 52 && r.n >= MIN_N).map((r) => r.key);
  const dragRegimes = regimeT1.filter((r) => r.hitRate <= 48 && r.n >= MIN_N).map((r) => r.key);
  const helpfulInst = instT1.filter((r) => r.hitRate >= 54).slice(0, 15);
  const dragInst = [...instT1]
    .sort((a, b) => (a.hitRate ?? 99) - (b.hitRate ?? 99))
    .filter((r) => r.hitRate <= 46)
    .slice(0, 15);

  const report = {
    version: 'v1-attr-stockflow-joint',
    asOf: new Date().toISOString(),
    dataDrive: process.env.FANCHENG_DATA_DRIVE,
    windowDays: DAYS,
    minN: MIN_N,
    coverage: {
      jointBars,
      jointAvailBars,
      jointAvailPct: jointBars ? +((jointAvailBars / jointBars) * 100).toFixed(1) : null,
      instrumentsWithSignal: scoredInst,
    },
    featureIc: {
      jointSignalT1: { ...rate(byJointSignalT1), liftVs50: liftVs50(rate(byJointSignalT1)) },
      jointSignalT3: { ...rate(byJointSignalT3), liftVs50: liftVs50(rate(byJointSignalT3)) },
      attitudeStanceT1: { ...rate(byAttitudeT1), liftVs50: liftVs50(rate(byAttitudeT1)) },
      attitudeStanceT3: { ...rate(byAttitudeT3), liftVs50: liftVs50(rate(byAttitudeT3)) },
      soloWarehouseT1: {
        ...rate(soloWhT1),
        liftVs50: liftVs50(rate(soloWhT1)),
        note: '对照：无合证时仓单单独启发式',
      },
      soloWarehouseT3: { ...rate(soloWhT3), liftVs50: liftVs50(rate(soloWhT3)) },
      bullishShareT1: rate(baselineT1),
      bullishShareT3: rate(baselineT3),
    },
    byRegimeT1: regimeT1,
    byRegimeT3: regimeT3,
    byHorizonStructureBiasT1: horizonT1,
    byHorizonStructureBiasT3: horizonT3,
    helpfulRegimesT1: helpfulRegimes,
    dragRegimesT1: dragRegimes,
    helpfulInstrumentsT1: helpfulInst,
    dragInstrumentsT1: dragInst,
    weightRecommendation: {
      enableRegimes: helpfulRegimes.filter((r) => r === 'destock_oi_up' || r === 'build_oi_up'),
      zeroWeightRegimes: dragRegimes,
      preferHorizons: Object.entries(horizonT1)
        .filter(([, v]) => v && v.n >= MIN_N)
        .sort((a, b) => (b[1].hitRate ?? 0) - (a[1].hitRate ?? 0))
        .map(([k, v]) => ({ horizon: k, ...v })),
      note: '仅对 hitRate≥52% 且 n≥minN 的明确合证 regime 赋权；仓单单独启发式若 ≤50% 则继续禁止单独定调',
    },
    knownGaps: [
      '本报告度量的是合证/态度特征自身 IC，不是改权后的引擎命中',
      '无仓单品种(ec/休眠粮)不参与合证归因',
      'OI 滞后品种合证可能 priceMayLag，已在 signal 模块降权',
      '命中接近 50% 时不得宣称「有信息量」——须看 lift 与 n',
    ],
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `outlook-stockflow-joint-attr-${stamp}.json`);
  const latest = path.join(outDir, 'outlook-stockflow-joint-attr-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(latest, JSON.stringify(report, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        outPath,
        coverage: report.coverage,
        featureIc: report.featureIc,
        helpfulRegimesT1: report.helpfulRegimesT1,
        dragRegimesT1: report.dragRegimesT1,
        topInst: report.helpfulInstrumentsT1.slice(0, 5),
        worstInst: report.dragInstrumentsT1.slice(0, 5),
        horizonsT1: report.byHorizonStructureBiasT1,
      },
      null,
      2
    )
  );
}

main();
