/**
 * Re-entry cooldown — closed/stopped symbols in userData.
 * v1.47.0-retail-discipline
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getUserDataDir } = require('./data-paths');

const STORE_VERSION = 'v1.47.0-retail-discipline';
const FILE_NAME = 're-entry-cooldown.json';
const DEFAULT_COOLDOWN_TRADING_DAYS = 7;

function storePath() {
  const dir = getUserDataDir();
  return dir ? path.join(dir, FILE_NAME) : null;
}

function readRaw() {
  const fp = storePath();
  if (!fp || !fs.existsSync(fp)) {
    return { closes: [], version: STORE_VERSION, cooldownTradingDays: DEFAULT_COOLDOWN_TRADING_DAYS };
  }
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { closes: [], version: STORE_VERSION, cooldownTradingDays: DEFAULT_COOLDOWN_TRADING_DAYS };
  }
}

function writeRaw(payload) {
  const fp = storePath();
  if (!fp) return { ok: false, error: 'userData unavailable' };
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true };
}

function logPositionClose(entry = {}) {
  const symbol = normalizeCommodityId(entry.symbol);
  if (!symbol) return { ok: false, error: 'symbol missing' };
  const raw = readRaw();
  raw.closes = raw.closes || [];
  const record = {
    id: entry.id || `${symbol}|${entry.closedAt || new Date().toISOString()}`,
    symbol,
    closedAt: entry.closedAt || new Date().toISOString(),
    reason: entry.reason || entry.closeReason || 'closed',
    playbookStage: entry.playbookStage || null,
    dataSource: 're-entry-cooldown-store',
    version: STORE_VERSION,
  };
  raw.closes.unshift(record);
  raw.closes = raw.closes.slice(0, 200);
  raw.version = STORE_VERSION;
  raw.updatedAt = new Date().toISOString();
  const result = writeRaw(raw);
  return { ...result, record };
}

function listCloses(limit = 100) {
  const raw = readRaw();
  return (raw.closes || []).slice(0, limit);
}

function getCooldownConfig() {
  const raw = readRaw();
  return {
    cooldownTradingDays: raw.cooldownTradingDays ?? DEFAULT_COOLDOWN_TRADING_DAYS,
    version: STORE_VERSION,
  };
}

function setCooldownTradingDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1 || n > 30) return { ok: false, error: 'invalid days' };
  const raw = readRaw();
  raw.cooldownTradingDays = Math.round(n);
  raw.updatedAt = new Date().toISOString();
  return writeRaw(raw);
}

module.exports = {
  STORE_VERSION,
  DEFAULT_COOLDOWN_TRADING_DAYS,
  logPositionClose,
  listCloses,
  getCooldownConfig,
  setCooldownTradingDays,
  storePath,
  readRaw,
};
