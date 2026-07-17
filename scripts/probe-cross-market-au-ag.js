/**
 * 跨境传导探针 — 伦敦金(代理)+CNH 能否解释沪金/沪银次日收盘相对前收的点位变动
 *
 * 用法: node scripts/probe-cross-market-au-ag.js [--from 2019-01-01] [--to 2025-12-31]
 * 输出: docs/cross-market-au-ag-probe.json
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const crossAsset = require('../services/commodity-cross-asset-regime');
const inference = require('../services/cross-market-precious-inference');
const { getDataDir } = require('../services/data-paths');

const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const FROM = argVal('--from', '2019-01-01');
const TO = argVal('--to', '2025-12-31');
const DIR_TH_PCT = 0.05;

function dirFromDelta(delta, unit) {
  const th = unit === 'au' ? 0.3 : 15;
  if (delta > th) return 'bullish';
  if (delta < -th) return 'bearish';
  return 'neutral';
}

function dirFromPct(pct) {
  if (pct > DIR_TH_PCT) return 'bullish';
  if (pct < -DIR_TH_PCT) return 'bearish';
  return 'neutral';
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 10) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den ? +(num / den).toFixed(4) : null;
}

function probeInstrument(instrumentId) {
  const bars = inference.loadTradingBars(instrumentId);
  const unit = instrumentId === 'au' ? '元/克' : '元/千克';
  inference.resetIntlSeriesCache();

  let scored = 0;
  let dirHits = 0;
  let dirScored = 0;
  let maeSum = 0;
  let openGapMaeSum = 0;
  let openGapScored = 0;
  const predDeltas = [];
  const actualDeltas = [];
  const openGaps = [];

  for (let i = 1; i < bars.length; i += 1) {
    const d = bars[i].date;
    if (d < FROM || d > TO) continue;

    const prevClose = bars[i - 1].close;
    const actualClose = bars[i].close;
    const actualDelta = actualClose - prevClose;

    const pred = inference.inferPointChangeFromClose(d, instrumentId);
    if (pred.gated || pred.predictedDelta == null) continue;

    scored += 1;
    maeSum += Math.abs(pred.predictedDelta - actualDelta);
    predDeltas.push(pred.predictedDelta);
    actualDeltas.push(actualDelta);

    const pDir = dirFromDelta(pred.predictedDelta, instrumentId);
    const aDir = dirFromDelta(actualDelta, instrumentId);
    if (pDir !== 'neutral' && aDir !== 'neutral') {
      dirScored += 1;
      if (pDir === aDir) dirHits += 1;
    }

    const gap = inference.inferOpenGap(d, instrumentId);
    if (!gap.gated && gap.actualOpen != null) {
      openGapScored += 1;
      openGapMaeSum += Math.abs(gap.openGapError);
      openGaps.push(gap.openGapError);
    }
  }

  const mae = scored ? +(maeSum / scored).toFixed(4) : null;
  const dirHitPct = dirScored ? +((dirHits / dirScored) * 100).toFixed(2) : null;
  const corr = pearson(predDeltas, actualDeltas);
  const openGapMae = openGapScored ? +(openGapMaeSum / openGapScored).toFixed(4) : null;

  return {
    instrumentId,
    unit,
    window: { from: FROM, to: TO },
    scored,
    mae,
    dirHitRate: { hits: dirHits, scored: dirScored, pct: dirHitPct },
    correlationPredVsActual: corr,
    openGap: { scored: openGapScored, mae: openGapMae },
    note: instrumentId === 'ag'
      ? 'intl=伦敦银+COMEX SI；缺数据则 gated'
      : 'intl=伦敦金+COMEX GC；缺数据则 gated',
  };
}

function loadT3Baseline(instrumentId) {
  const labelsPath = path.join(getDataDir() || 'E:\\FanchengFinance\\data', 'history', 'labels', 'direction-daily.csv');
  if (!fs.existsSync(labelsPath)) return null;
  const text = fs.readFileSync(labelsPath, 'utf8');
  const lines = text.trim().split('\n').slice(1);
  let scored = 0;
  let hits = 0;
  for (const line of lines) {
    const [date, id, , , , , , exclude] = line.split(',');
    if (id !== instrumentId || exclude === '1') continue;
    if (date < FROM || date > TO) continue;
    scored += 1;
  }
  return { instrumentId, t3LabelRows: scored, note: 'T+3 方向模型需 philosophy backtest 重跑；此处仅标签行数' };
}

function main() {
  crossAsset.resetSeriesCache();
  inference.resetIntlSeriesCache();
  const overlay = crossAsset.ensureAuOverlaySeriesLoaded();
  const intl = inference.ensureIntlSeriesLoaded();

  const au = probeInstrument('au');
  const ag = probeInstrument('ag');

  const priorBaseline = {
    au: { dirHitPct: 57.34, mae: 3.7434, note: 'v0.1-stub 伦敦金GC代理' },
    ag: { dirHitPct: 55.73, mae: 3453.6744, note: 'v0.1-stub 误用金价代理' },
  };

  const out = {
    generatedAt: new Date().toISOString(),
    inferenceVersion: inference.INFERENCE_VERSION,
    dataAudit: {
      londonGold: {
        rows: overlay.intlGold.length,
        source: overlay.intlGoldMeta.source,
        file: inference.DATA_FILES.londonGold,
        caveat: 'AU 伦敦金溢价锚 + COMEX GC 隔夜；优先 London+COMEX',
      },
      londonSilver: {
        exists: intl.londonSilverMeta.rowCount > 0,
        rows: intl.londonSilverMeta.rowCount || 0,
        source: intl.londonSilverMeta.source,
        proxy: Boolean(intl.londonSilverMeta.proxy),
        file: inference.DATA_FILES.londonSilver,
      },
      comexGold: {
        exists: intl.comexGoldMeta.rowCount > 0,
        rows: intl.comexGoldMeta.rowCount || 0,
        source: intl.comexGoldMeta.source,
        file: inference.DATA_FILES.comexGold,
      },
      comexSilver: {
        exists: intl.comexSilverMeta.rowCount > 0,
        rows: intl.comexSilverMeta.rowCount || 0,
        source: intl.comexSilverMeta.source,
        file: inference.DATA_FILES.comexSilver,
      },
      cnh: {
        rows: overlay.cnh.length,
        kind: overlay.cnhMeta.kind,
        source: overlay.cnhMeta.source,
      },
      shfeAu: { rows: overlay.au.length, fields: 'open/high/low/close/price — 无 settle 字段' },
      shfeAg: { rows: inference.loadTradingBars('ag').length },
      gldHoldings: { file: inference.DATA_FILES.gldHoldings, note: '已落盘 user-import+gap-fill，探针未纳入' },
    },
    compareBaseline: {
      currentT3DirectionOOS: {
        au: '67.6% (v1348 OOS 105 scored, 2023+ regime slice)',
        ag: '61.2% (v1348 OOS 121 scored)',
        caveat: '全样本 philosophy ~48-51%，75% 全样本不现实',
      },
      crossMarketSimple: { au, ag },
      priorCrossMarketStub: priorBaseline,
      deltaVsPrior: {
        au: {
          dirHitPct: au.dirHitRate?.pct != null && priorBaseline.au.dirHitPct != null
            ? +(au.dirHitRate.pct - priorBaseline.au.dirHitPct).toFixed(2)
            : null,
          mae: au.mae != null && priorBaseline.au.mae != null
            ? +(au.mae - priorBaseline.au.mae).toFixed(4)
            : null,
        },
        ag: {
          dirHitPct: ag.dirHitRate?.pct != null && priorBaseline.ag.dirHitPct != null
            ? +(ag.dirHitRate.pct - priorBaseline.ag.dirHitPct).toFixed(2)
            : null,
          mae: ag.mae != null && priorBaseline.ag.mae != null
            ? +(ag.mae - priorBaseline.ag.mae).toFixed(4)
            : null,
        },
      },
    },
    feasibility: {
      auDirectionFromIntl: au.dirHitRate?.pct,
      auMaeRmbPerGram: au.mae,
      auCorrelation: au.correlationPredVsActual,
      agDirectionFromIntl: ag.dirHitRate?.pct,
      agMaeRmbPerKg: ag.mae,
      agCorrelation: ag.correlationPredVsActual,
      verdict: {
        au: au.mae < 5 && (au.dirHitRate?.pct ?? 0) > 52
          ? 'partial — 伦敦金+COMEX GC+离岸CNH 日频可解释方向，MAE ~3-4 元/克'
          : 'weak',
        ag: ag.mae != null && ag.mae < 200 && (ag.dirHitRate?.pct ?? 0) > 52
          ? 'partial — 伦敦银+COMEX SI 已启用，MAE 较金价代理显著改善'
          : ag.scored > 0
            ? 'weak — 有分数但 KPI 未达标'
            : 'blocked — 缺伦敦银/COMEX SI',
        overall: intl.londonSilverMeta.rowCount && intl.comexSilverMeta.rowCount
          ? 'P0 跨境贵金属序列已补齐，可做点数 KPI 迭代'
          : '仍需补 COMEX/伦敦银落盘',
      },
    },
    dataGaps: [
      intl.londonSilverMeta.proxy ? '伦敦银当前为 XAG 代理，待 FRED SLVPRUSD 直连' : null,
      'GLD/SLV 日持仓（SLV 缺）',
      'SHFE 夜盘时段 COMEX 对齐时间戳（非日频）',
    ].filter(Boolean),
    kpiRecommendation: {
      shiftFrom: '全样本方向 75%',
      shiftTo: [
        '跨境传导日 MAE < 1.5 元/克 (AU) / < 50 元/千克 (AG)',
        '高置信传导日（|overnight intl|>0.5%）方向 ≥ 65%',
        '分板块 KPI：贵金属点位 + 有色库存，黑色政策',
      ],
    },
  };

  const outPath = path.join(__dirname, '..', 'docs', 'cross-market-au-ag-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
}

main();
