/**
 * 用户持仓 1-3 品种 '持久化于 userData/portfolio-holdings.json
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getUserDataDir } = require('./data-paths');
const { normalizeHoldings, MAX_POSITIONS } = require('./portfolio-gate');

const STORE_VERSION = 'v1.44.0-discipline';
const FILE_NAME = 'portfolio-holdings.json';

function storePath() {
  const dir = getUserDataDir();
  return dir ? path.join(dir, FILE_NAME) : null;
}

function readRaw() {
  const fp = storePath();
  if (!fp || !fs.existsSync(fp)) return { holdings: [], version: STORE_VERSION };
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { holdings: [], version: STORE_VERSION };
  }
}

function getPortfolioHoldings() {
  const raw = readRaw();
  return normalizeHoldings(raw.holdings || []);
}

function setPortfolioHoldings(holdings = []) {
  const fp = storePath();
  const normalized = normalizeHoldings(holdings);
  const payload = {
    holdings: normalized,
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    dataSource: 'portfolio-holdings-store',
  };
  if (!fp) return { ok: false, error: 'userData 目录不可', holdings: normalized };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, holdings: normalized };
}

module.exports = {
  STORE_VERSION,
  MAX_POSITIONS,
  getPortfolioHoldings,
  setPortfolioHoldings,
  storePath,
};
