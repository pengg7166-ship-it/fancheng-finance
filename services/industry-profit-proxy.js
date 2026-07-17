/**
 * 行业利润代理 'Regime B W3 试仓门禁（LH/FG 等）
 * 无真实数据时诚实返回 待校'
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { readCachedKlines } = require('./commodity-technical-analyzer');

const PROFIT_PROXY_VERSION = 'v1.44.0-discipline';

/** Symbols where W3 scout requires profit validation */
const W3_PROFIT_GATE_SYMBOLS = new Set(['lh', 'fg', 'jm', 'j']);

function nowIso() {
  return new Date().toISOString();
}

function loadSectorProfitCache(symbol) {
  const id = normalizeCommodityId(symbol);
  const dataDir = path.join(process.cwd(), 'data', 'sector-profit');
  const fp = path.join(dataDir, `${id}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function proxyFromPriceMomentum(symbol) {
  const bars = readCachedKlines(symbol);
  if (bars.length < 60) return null;
  const recent = bars.slice(-20);
  const prior = bars.slice(-60, -20);
  const avgRecent = recent.reduce((a, b) => a + Number(b.close || 0), 0) / recent.length;
  const avgPrior = prior.reduce((a, b) => a + Number(b.close || 0), 0) / prior.length;
  if (!avgPrior) return null;
  const momPct = ((avgRecent - avgPrior) / avgPrior) * 100;
  return {
    momPct: +momPct.toFixed(2),
    dataSource: 'cached-klines:momentum-proxy',
    method: '20d-vs-40d-avg',
    note: '价格动量代理 · 非真实行业利',
  };
}

/**
 * @returns {{ status: 'validated'|'weak'|'unknown', profitSignal: string|null, gateW3: boolean, evidence: string[], dataSource: string }}
 */
function evaluateIndustryProfit(symbol, context = {}) {
  const id = normalizeCommodityId(symbol);
  const asOf = nowIso();
  const evidence = [];

  if (!W3_PROFIT_GATE_SYMBOLS.has(id)) {
    return {
      status: 'not-required',
      profitSignal: null,
      gateW3: false,
      evidence: ['W3 利润门禁品种'],
      dataSource: 'industry-profit-proxy',
      method: 'symbol-filter',
      version: PROFIT_PROXY_VERSION,
      asOf,
    };
  }

  const cached = loadSectorProfitCache(id);
  if (cached?.profitMargin != null) {
    const margin = Number(cached.profitMargin);
    const ok = margin > 0;
    evidence.push(`行业利润 ${margin}% · ${cached.dataSource || 'sector-profit-cache'}`);
    return {
      status: ok ? 'validated' : 'weak',
      profitSignal: `${margin}%`,
      gateW3: !ok,
      evidence,
      dataSource: cached.dataSource || 'sector-profit-cache',
      method: 'disk-profit',
      version: PROFIT_PROXY_VERSION,
      asOf,
    };
  }

  const mom = proxyFromPriceMomentum(id);
  if (mom) {
    evidence.push(`动量代理 ${mom.momPct}% · ${mom.note}`);
    const weak = mom.momPct < -5;
    return {
      status: weak ? 'weak' : 'proxy-ok',
      profitSignal: `${mom.momPct}%`,
      gateW3: weak,
      evidence,
      dataSource: mom.dataSource,
      method: mom.method,
      version: PROFIT_PROXY_VERSION,
      asOf,
    };
  }

  evidence.push('行业利润数据待校');
  return {
    status: 'unknown',
    profitSignal: null,
    gateW3: true,
    evidence,
    dataSource: 'industry-profit-proxy',
    method: 'honest-missing',
    version: PROFIT_PROXY_VERSION,
    asOf,
  };
}

module.exports = {
  PROFIT_PROXY_VERSION,
  W3_PROFIT_GATE_SYMBOLS,
  evaluateIndustryProfit,
};
