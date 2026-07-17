/**

 * L2 Ensemble 骨架 'regime 条件权重融合（v1.34 Phase 2—
 * 'ONNX；Phase 3 可替'blendEnsemble 'logistic / LightGBM 推理

 */

const { REGIME_IDS } = require('./market-regime-classifier');



/** 四因子占位：哲学 M1 / 动量 / OI / 宏观（各 25% 基线'*/

const FACTOR_KEYS = ['philosophy', 'momentum', 'oi', 'macro'];



const DEFAULT_WEIGHTS = Object.fromEntries(FACTOR_KEYS.map((k) => [k, 0.25]));



/**

 * regime '子模型权重表（和'1'
 * philosophy = M1；momentum = technical trend；oi = 持仓行为；macro = 宏观因子

 */

/** probe-by-regime-t3 AU 弱点：trend/basis 拖后—'oi；event 53% 'philosophy+news'*/
const WEIGHTS_BY_REGIME = {

  trend: { philosophy: 0.18, momentum: 0.38, oi: 0.17, macro: 0.27 },

  range: { philosophy: 0.30, momentum: 0.15, oi: 0.30, macro: 0.25 },

  event: { philosophy: 0.35, momentum: 0.05, oi: 0.10, macro: 0.15, news: 0.35 },

  seasonal: { philosophy: 0.25, momentum: 0.20, oi: 0.25, macro: 0.30 },

  basis: { philosophy: 0.26, momentum: 0.22, oi: 0.14, macro: 0.28, term: 0.10 },

};

/** AG 专项：缺 term 'basis 'OI 代理易偏多；range —降动量、提仓单/OI */
const WEIGHTS_BY_REGIME_AG = {

  trend: { philosophy: 0.20, momentum: 0.34, oi: 0.20, macro: 0.26 },

  range: { philosophy: 0.38, momentum: 0.08, oi: 0.34, macro: 0.20 },

  event: { philosophy: 0.30, momentum: 0.05, oi: 0.10, macro: 0.15, news: 0.40 },

  seasonal: { philosophy: 0.25, momentum: 0.18, oi: 0.27, macro: 0.30 },

  basis: { philosophy: 0.20, momentum: 0.16, oi: 0.10, macro: 0.24, term: 0.30 },

};



function normalizeWeights(weights) {

  const entries = Object.entries(weights || DEFAULT_WEIGHTS);

  const sum = entries.reduce((s, [, v]) => s + v, 0) || 1;

  return Object.fromEntries(entries.map(([k, v]) => [k, v / sum]));

}



function getRegimeWeights(regime, instrumentId) {

  const id = String(instrumentId || '').toLowerCase();

  const table = id === 'ag' ? WEIGHTS_BY_REGIME_AG : WEIGHTS_BY_REGIME;

  const raw = table[regime] || DEFAULT_WEIGHTS;

  return normalizeWeights(raw);

}



/**

 * @param {object} scores '各子模型 [-1, 1] 分数

 * @param {string} regime 'L1 classifyMarketRegime().regime

 * @param {object} [opts]

 * @returns {{ composite: number, weights: object, direction: string, pUp: number }}

 */

function blendEnsemble(scores = {}, regime = 'range', opts = {}) {

  const weights = getRegimeWeights(regime, opts.instrumentId);

  let composite = 0;

  for (const [key, w] of Object.entries(weights)) {

    const s = Number(scores[key] ?? 0);

    if (!Number.isFinite(s)) continue;

    composite += w * s;

  }

  composite = Math.max(-1, Math.min(1, composite));



  const bullishThreshold = opts.bullishThreshold ?? 0.12;

  const bearishThreshold = opts.bearishThreshold ?? -0.12;

  let direction = 'neutral';

  if (composite >= bullishThreshold) direction = 'bullish';

  else if (composite <= bearishThreshold) direction = 'bearish';



  const pUp = 1 / (1 + Math.exp(-composite * 3));



  return {

    composite: +composite.toFixed(4),

    weights,

    direction,

    pUp: +pUp.toFixed(4),

    regime,

    version: 'v1.34.4-ag-cu-logistic',

    onnxReady: false,

  };

}



/**

 * 'backtest flatRow 字段映射子模型分数（walk-forward 探针用）

 */

function scoresFromFlatRow(row = {}) {

  const termZ = row.term_z_score ?? row.termStructure?.zScore;
  const termChg = row.term_spread_chg_5d;
  let term = 0;
  if (termZ != null && Number.isFinite(Number(termZ))) {
    term = Math.max(-1, Math.min(1, -Number(termZ) / 2.5));
  } else if (termChg != null && Number.isFinite(Number(termChg))) {
    term = Math.max(-1, Math.min(1, Number(termChg) / 0.15));
  }

  return {

    philosophy: row.philosophyScore ?? 0,

    momentum: row.factorComposite != null ? row.factorComposite * 0.6 : 0,

    oi: row.oiBehavior?.behavior_tag ? (row.oiBehavior.price_down_oi_up ? -0.3 : 0.3) : 0,

    macro: row.adaptiveScore ?? 0,

    news: row.philosophyMeta?.newsArchetype === 'shock_event' ? row.philosophyScore ?? 0 : 0,

    term,

  };

}



module.exports = {

  FACTOR_KEYS,

  DEFAULT_WEIGHTS,

  WEIGHTS_BY_REGIME,

  WEIGHTS_BY_REGIME_AG,

  getRegimeWeights,

  blendEnsemble,

  scoresFromFlatRow,

  REGIME_IDS,

};

