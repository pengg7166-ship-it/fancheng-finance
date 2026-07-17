/**
 * 滑点/流动性检—低量—spread 代理
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const SLIPPAGE_VERSION = 'v1.44.0-discipline';

/** Known severe slippage symbols */
const KNOWN_SLIPPAGE = new Set(['ap']);

function nowIso() {
  return new Date().toISOString();
}

function detectSlippageTier(inst, context = {}) {
  const id = normalizeCommodityId(inst?.id || context.symbol);
  const asOf = nowIso();
  const evidence = [];

  if (KNOWN_SLIPPAGE.has(id)) {
    evidence.push(`${id.toUpperCase()} 已知滑点严重品种`);
    return {
      tier: 'severe',
      flag: '滑点严重·交易痛苦',
      scoutCap: 'tiny',
      postureCap: '试仓',
      evidence,
      dataSource: 'slippage-detector:known-list',
      method: 'known+volume-proxy',
      version: SLIPPAGE_VERSION,
      asOf,
    };
  }

  const vol = inst?.volume ?? inst?.factors?.technical?.volume;
  const oi = inst?.openInterest ?? inst?.factors?.technical?.openInterest;
  const volRatio = vol != null && oi != null && oi > 0 ? vol / oi : null;
  const spreadProxy = inst?.spreadProxy ?? inst?.factors?.technical?.spreadPct;

  if (volRatio != null && volRatio < 0.05) {
    evidence.push(`量比 vol/oi=${volRatio.toFixed(3)} 偏低`);
  }
  if (spreadProxy != null && spreadProxy > 0.003) {
    evidence.push(`spread 代理=${(spreadProxy * 100).toFixed(2)}% 偏宽`);
  }

  if (evidence.length >= 2 || (volRatio != null && volRatio < 0.03)) {
    return {
      tier: 'moderate',
      flag: '滑点严重·交易痛苦',
      scoutCap: 'tiny',
      postureCap: '试仓',
      volRatio,
      spreadProxy,
      evidence,
      dataSource: 'slippage-detector:volume-spread-proxy',
      method: 'volume-ratio+spread',
      version: SLIPPAGE_VERSION,
      asOf,
    };
  }

  if (evidence.length) {
    return {
      tier: 'watch',
      flag: null,
      scoutCap: null,
      postureCap: null,
      volRatio,
      spreadProxy,
      evidence,
      dataSource: 'slippage-detector:volume-spread-proxy',
      method: 'volume-ratio+spread',
      version: SLIPPAGE_VERSION,
      asOf,
    };
  }

  return {
    tier: 'normal',
    flag: null,
    scoutCap: null,
    postureCap: null,
    evidence: ['流动性数据待校验'],
    dataSource: 'slippage-detector',
    method: 'volume-ratio+spread',
    version: SLIPPAGE_VERSION,
    asOf,
  };
}

module.exports = {
  SLIPPAGE_VERSION,
  KNOWN_SLIPPAGE,
  detectSlippageTier,
};
