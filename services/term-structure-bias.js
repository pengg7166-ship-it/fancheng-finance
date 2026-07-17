/**
 * 期限结构偏置 'contango/backwardation 代理
 */
const { getTermStructureAtDate, P0_INSTRUMENTS } = require('./term-structure-fetcher');

const TERM_BIAS_VERSION = 'v1.46.0-retail-hf';

function nowIso() {
  return new Date().toISOString();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @returns {{ bias: 'contango'|'backwardation'|'flat'|'unknown', spread: number|null, zScore: number|null, evidence: string[], dataSource: string }}
 */
function computeTermStructureBias(symbol, context = {}) {
  const id = String(symbol || '').toLowerCase();
  const asOf = nowIso();
  const barDate = context.barDate || todayStr();

  if (!P0_INSTRUMENTS.includes(id)) {
    return {
      bias: 'unknown',
      spread: null,
      zScore: null,
      evidence: [`${id.toUpperCase()} 期限结构序列暂无`],
      dataSource: 'term-structure-bias',
      method: 'p0-instruments-only',
      version: TERM_BIAS_VERSION,
      asOf,
    };
  }

  const row = getTermStructureAtDate(id, barDate);
  if (!row || row.spread == null) {
    return {
      bias: 'unknown',
      spread: null,
      zScore: null,
      evidence: ['期限结构数据待校'],
      dataSource: 'term-structure-fetcher',
      method: 'near-far-spread',
      version: TERM_BIAS_VERSION,
      asOf,
    };
  }

  const spread = Number(row.spread);
  const z = row.zScore != null ? Number(row.zScore) : null;
  let bias = 'flat';
  if (spread > 0.002) bias = 'contango';
  else if (spread < -0.002) bias = 'backwardation';

  const evidence = [
    `近远 spread=${spread.toFixed(4)}`,
    z != null ? `z=${z.toFixed(2)}` : 'z-score 待校',
    bias === 'backwardation' ? '现货偏紧/backwardation' : bias === 'contango' ? 'contango/库存压力' : '结构平坦',
  ];

  return {
    bias,
    spread,
    zScore: z,
    evidence,
    dataSource: 'term-structure-fetcher',
    method: 'near-far-spread',
    version: TERM_BIAS_VERSION,
    asOf,
  };
}

/**
 * Carry/roll hint for retail 1–3 month holding horizon (not HF roll P&L optimization).
 * @returns {{ hint: string, bias: string, holdingHorizon: string, evidence: string[], dataSource: string }}
 */
function buildCarryRollHint(symbol, context = {}) {
  const ts = computeTermStructureBias(symbol, context);
  const asOf = nowIso();
  const id = String(symbol || '').toLowerCase();

  if (ts.bias === 'unknown') {
    return {
      hint: '待校验',
      bias: 'unknown',
      holdingHorizon: '1-3 months',
      spread: null,
      evidence: ts.evidence || [`${id.toUpperCase()} 期限曲线暂无`],
      carryLine: `${id.toUpperCase()} 展期/持有 · 待校验`,
      dataSource: 'term-structure-bias',
      method: 'carry-roll-retail-hint',
      version: TERM_BIAS_VERSION,
      asOf,
    };
  }

  let hint = '结构平坦 · 持有中性';
  if (ts.bias === 'contango') {
    hint = 'contango · 长线持有多头展期成本偏高 · 宜控制仓位';
  } else if (ts.bias === 'backwardation') {
    hint = 'backwardation · 现货偏紧 · 持有多头展期友好';
  }

  const carryLine = `${id.toUpperCase()} 1-3月 · ${hint}${ts.spread != null ? ` · spread ${ts.spread.toFixed(4)}` : ''}`;

  return {
    hint,
    bias: ts.bias,
    holdingHorizon: '1-3 months',
    spread: ts.spread,
    zScore: ts.zScore,
    evidence: ts.evidence,
    carryLine,
    dataSource: ts.dataSource,
    method: 'carry-roll-retail-hint',
    version: TERM_BIAS_VERSION,
    asOf,
  };
}

module.exports = {
  TERM_BIAS_VERSION,
  computeTermStructureBias,
  buildCarryRollHint,
};
