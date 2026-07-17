/**
 * L2 logistic 特征向量 'flatRow 'x（v1.34 Phase 3' * 哲学 score · 动量 · OI 标志 · regime one-hot
 */
const { REGIME_IDS } = require('./market-regime-classifier');

/** 稀'MM 库存特征 —FANCHENG_LOGISTIC_SPARSE=1 时纳入训练（'DATA_LAYER 附录 C'*/
const SPARSE_INVENTORY_FEATURES = ['lmeInventory_chg_wow'];
const USE_SPARSE_INVENTORY = process.env.FANCHENG_LOGISTIC_SPARSE === '1';

const OI_FEATURE_NAMES = [
  'oi_price_down_oi_up',
  'oi_price_up_oi_down',
  'oi_change_pct',
  'volume_oi_ratio',
  'oi_divergence_rate_5d',
];

const TERM_FEATURE_NAMES = ['term_spread_pct', 'term_z_score', 'term_spread_chg_5d'];

/** AG 工业联动 —instrumentId=ag 时非零（CU 5日动量） */
const AG_INDUSTRIAL_FEATURES = ['cu_momentum_5d'];

/** AG basis 期限结构强调 'term_z 仅在 ag+basis 非零（v1.34.6 r3'*/
const AG_BASIS_TERM_FEATURES = ['term_z_score_ag_basis'];

/** 白银相对铜期限结—ag_term_z 'cu_term_z（v1.34.6 r3'*/
const AG_SILVER_BASIS_FEATURES = ['ag_cu_term_z_spread'];

/** basis/trend 'logistic 侧零'OI 连续/离散特征（probe-by-regime 弱点'*/
const OI_GATED_REGIMES = new Set(['basis', 'trend']);

/** AG basis 次级 head 特征 'v1.34.7 Round 4（仅 ag+basis 推理时启用） */
const AG_BASIS_HEAD_FEATURE_NAMES = [
  ...TERM_FEATURE_NAMES,
  ...AG_BASIS_TERM_FEATURES,
  ...AG_SILVER_BASIS_FEATURES,
  'real10y_chg_5d',
  ...OI_FEATURE_NAMES,
];

const FEATURE_NAMES_FULL = [
  'philosophyScore',
  'momentum',
  'adaptiveScore',
  'real10y_chg_5d',
  'warehouseReceipt_chg_5d',
  ...TERM_FEATURE_NAMES,
  ...AG_INDUSTRIAL_FEATURES,
  ...AG_BASIS_TERM_FEATURES,
  ...AG_SILVER_BASIS_FEATURES,
  'lmeInventory_chg_wow',
  'gldHoldings_chg_5d',
  ...OI_FEATURE_NAMES,
  ...REGIME_IDS.map((r) => `regime_${r}`),
];

const FEATURE_NAMES = USE_SPARSE_INVENTORY
  ? FEATURE_NAMES_FULL
  : FEATURE_NAMES_FULL.filter((n) => !SPARSE_INVENTORY_FEATURES.includes(n));

/** v1.35 split heads 'Fed/哲学规则'AG 降权（AU 全量'*/
const AU_PHILOSOPHY_SCALE = 1;
const AG_PHILOSOPHY_SCALE = Number(process.env.AG_PHILOSOPHY_SCALE) || 0.45;

const GSR_FEATURES = ['gsr_z_score'];

/** AG 白银 ETF 持仓 —instrumentId=ag 时非零（SLV tonnes 5d chg'*/
const AG_SLV_FEATURES = ['slvHoldings_chg_5d'];

/** AU 专用 head 'real10y / GLD / 期限结构 / 仓单 */
const AU_HEAD_FEATURE_NAMES = [
  'philosophyScore',
  'momentum',
  'adaptiveScore',
  'real10y_chg_5d',
  'warehouseReceipt_chg_5d',
  ...TERM_FEATURE_NAMES,
  'gldHoldings_chg_5d',
  ...OI_FEATURE_NAMES,
  ...REGIME_IDS.map((r) => `regime_${r}`),
];

/** AG 专用 head '期限/CU/GSR/仓单；哲学降权在 vector '*/
const AG_HEAD_FEATURE_NAMES = [
  'philosophyScore',
  'momentum',
  'adaptiveScore',
  'real10y_chg_5d',
  'warehouseReceipt_chg_5d',
  ...TERM_FEATURE_NAMES,
  ...AG_BASIS_TERM_FEATURES,
  ...AG_SILVER_BASIS_FEATURES,
  ...AG_INDUSTRIAL_FEATURES,
  ...GSR_FEATURES,
  ...AG_SLV_FEATURES,
  ...OI_FEATURE_NAMES,
  ...REGIME_IDS.map((r) => `regime_${r}`),
];

const SPLIT_HEAD_CONFIG = {
  au: {
    featureNames: AU_HEAD_FEATURE_NAMES,
    philosophyScale: AU_PHILOSOPHY_SCALE,
    defaultExclude: [],
  },
  ag: {
    featureNames: AG_HEAD_FEATURE_NAMES,
    philosophyScale: AG_PHILOSOPHY_SCALE,
    defaultExclude: [],
  },
};

function oiFeatureValues(row = {}, oiGate = 1) {
  const oi = row.oiBehavior || {};
  return [
    (oi.price_down_oi_up ? 1 : 0) * oiGate,
    (oi.price_up_oi_down ? 1 : 0) * oiGate,
    Number(oi.oi_change_pct ?? 0) * oiGate,
    Number(oi.volume_oi_ratio ?? 0) * oiGate,
    Number(oi.oi_divergence_rate_5d ?? 0) * oiGate,
  ];
}

function regimeFeatureValues(row = {}) {
  const regime = row.marketRegime || 'range';
  return REGIME_IDS.map((r) => (regime === r ? 1 : 0));
}

function rowToFeatureVector(row = {}) {
  const oi = row.oiBehavior || {};
  const regime = row.marketRegime || 'range';
  const regimeBits = REGIME_IDS.map((r) => (regime === r ? 1 : 0));
  const oiGate = OI_GATED_REGIMES.has(regime) ? 0 : 1;
  const isAg = String(row.instrumentId || '').toLowerCase() === 'ag';
  const isAgBasis = isAg && regime === 'basis';
  const termZ = Number(row.term_z_score ?? row.termStructure?.zScore ?? 0);
  const cuTermZ = Number(row.cu_term_z_score ?? 0);
  const full = [
    Number(row.philosophyScore ?? 0),
    Number(row.compositeScore ?? row.factorComposite ?? 0),
    Number(row.adaptiveScore ?? 0),
    Number(row.real10y_chg_5d ?? 0),
    Number(row.warehouseReceipt_chg_5d ?? 0),
    Number(row.term_spread_pct ?? row.termStructure?.spreadPct ?? 0),
    termZ,
    Number(row.term_spread_chg_5d ?? 0),
    isAg ? Number(row.cu_momentum_5d ?? 0) : 0,
    isAgBasis ? termZ : 0,
    isAg ? termZ - cuTermZ : 0,
    Number(row.lmeInventory_chg_wow ?? 0),
    Number(row.gldHoldings_chg_5d ?? 0),
    (oi.price_down_oi_up ? 1 : 0) * oiGate,
    (oi.price_up_oi_down ? 1 : 0) * oiGate,
    Number(oi.oi_change_pct ?? 0) * oiGate,
    Number(oi.volume_oi_ratio ?? 0) * oiGate,
    Number(oi.oi_divergence_rate_5d ?? 0) * oiGate,
    ...regimeBits,
  ];
  if (USE_SPARSE_INVENTORY) return full;
  return full.filter((_, i) => !SPARSE_INVENTORY_FEATURES.includes(FEATURE_NAMES_FULL[i]));
}

/** AG basis 次级 head 'OI 'gate（basis 桶专用） */
function rowToAgBasisHeadFeatureVector(row = {}) {
  const oi = row.oiBehavior || {};
  const termZ = Number(row.term_z_score ?? row.termStructure?.zScore ?? 0);
  const cuTermZ = Number(row.cu_term_z_score ?? 0);
  return [
    Number(row.term_spread_pct ?? row.termStructure?.spreadPct ?? 0),
    termZ,
    Number(row.term_spread_chg_5d ?? 0),
    termZ,
    termZ - cuTermZ,
    Number(row.real10y_chg_5d ?? 0),
    oi.price_down_oi_up ? 1 : 0,
    oi.price_up_oi_down ? 1 : 0,
    Number(oi.oi_change_pct ?? 0),
    Number(oi.volume_oi_ratio ?? 0),
    Number(oi.oi_divergence_rate_5d ?? 0),
  ];
}

function rowToAuHeadFeatureVector(row = {}, philosophyScale = AU_PHILOSOPHY_SCALE) {
  const regime = row.marketRegime || 'range';
  const oiGate = OI_GATED_REGIMES.has(regime) ? 0 : 1;
  const termZ = Number(row.term_z_score ?? row.termStructure?.zScore ?? 0);
  return [
    Number(row.philosophyScore ?? 0) * philosophyScale,
    Number(row.compositeScore ?? row.factorComposite ?? 0),
    Number(row.adaptiveScore ?? 0),
    Number(row.real10y_chg_5d ?? 0),
    Number(row.warehouseReceipt_chg_5d ?? 0),
    Number(row.term_spread_pct ?? row.termStructure?.spreadPct ?? 0),
    termZ,
    Number(row.term_spread_chg_5d ?? 0),
    Number(row.gldHoldings_chg_5d ?? 0),
    ...oiFeatureValues(row, oiGate),
    ...regimeFeatureValues(row),
  ];
}

function rowToAgHeadFeatureVector(row = {}, philosophyScale = AG_PHILOSOPHY_SCALE) {
  const regime = row.marketRegime || 'range';
  const oiGate = OI_GATED_REGIMES.has(regime) ? 0 : 1;
  const isAgBasis = regime === 'basis';
  const termZ = Number(row.term_z_score ?? row.termStructure?.zScore ?? 0);
  const cuTermZ = Number(row.cu_term_z_score ?? 0);
  return [
    Number(row.philosophyScore ?? 0) * philosophyScale,
    Number(row.compositeScore ?? row.factorComposite ?? 0),
    Number(row.adaptiveScore ?? 0),
    Number(row.real10y_chg_5d ?? 0),
    Number(row.warehouseReceipt_chg_5d ?? 0),
    Number(row.term_spread_pct ?? row.termStructure?.spreadPct ?? 0),
    termZ,
    Number(row.term_spread_chg_5d ?? 0),
    isAgBasis ? termZ : 0,
    termZ - cuTermZ,
    Number(row.cu_momentum_5d ?? 0),
    Number(row.gsr_z_score ?? 0),
    Number(row.slvHoldings_chg_5d ?? 0),
    ...oiFeatureValues(row, oiGate),
    ...regimeFeatureValues(row),
  ];
}

function rowToSplitHeadFeatureVector(row = {}, headId = 'au') {
  const id = String(headId || row.instrumentId || 'au').toLowerCase();
  if (id === 'ag') return rowToAgHeadFeatureVector(row);
  return rowToAuHeadFeatureVector(row);
}

function getSplitHeadConfig(headId) {
  const id = String(headId || 'au').toLowerCase();
  return SPLIT_HEAD_CONFIG[id] || SPLIT_HEAD_CONFIG.au;
}

function scoresFromFlatRowForStub(row = {}) {
  const { scoresFromFlatRow } = require('./outlook-ensemble');
  return scoresFromFlatRow(row);
}

module.exports = {
  FEATURE_NAMES,
  FEATURE_NAMES_FULL,
  OI_FEATURE_NAMES,
  TERM_FEATURE_NAMES,
  AG_INDUSTRIAL_FEATURES,
  AG_BASIS_TERM_FEATURES,
  AG_SILVER_BASIS_FEATURES,
  AG_BASIS_HEAD_FEATURE_NAMES,
  AU_HEAD_FEATURE_NAMES,
  AG_HEAD_FEATURE_NAMES,
  GSR_FEATURES,
  AG_SLV_FEATURES,
  AU_PHILOSOPHY_SCALE,
  AG_PHILOSOPHY_SCALE,
  SPLIT_HEAD_CONFIG,
  OI_GATED_REGIMES,
  SPARSE_INVENTORY_FEATURES,
  REGIME_IDS,
  rowToFeatureVector,
  rowToAgBasisHeadFeatureVector,
  rowToAuHeadFeatureVector,
  rowToAgHeadFeatureVector,
  rowToSplitHeadFeatureVector,
  getSplitHeadConfig,
  scoresFromFlatRowForStub,
};
