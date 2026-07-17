/**
 * Pre-mortem ack store — userData/pre-mortem-acks.json
 */
const fs = require('fs');
const path = require('path');
const { getUserDataDir } = require('./data-paths');
const { buildSignalId } = require('./pre-mortem-gate');

const ACK_STORE_VERSION = 'v1.44.0-discipline';
const FILE_NAME = 'pre-mortem-acks.json';

function storePath() {
  const dir = getUserDataDir();
  return dir ? path.join(dir, FILE_NAME) : null;
}

function readRaw() {
  const fp = storePath();
  if (!fp || !fs.existsSync(fp)) return { acks: {}, version: ACK_STORE_VERSION };
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { acks: {}, version: ACK_STORE_VERSION };
  }
}

function writeRaw(payload) {
  const fp = storePath();
  if (!fp) return { ok: false, error: 'userData unavailable' };
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true };
}

function hasAck(signalId) {
  if (!signalId) return false;
  return Boolean(readRaw().acks?.[signalId]);
}

function getAck(signalId) {
  return readRaw().acks?.[signalId] || null;
}

function saveAck(entry = {}) {
  const signalId = entry.signalId || buildSignalId(entry.symbol, entry.posture, entry.date);
  if (!signalId) return { ok: false, error: 'signalId missing' };
  const raw = readRaw();
  raw.acks = raw.acks || {};
  raw.acks[signalId] = {
    signalId,
    symbol: entry.symbol || null,
    posture: entry.posture || '试仓',
    acknowledgedAt: entry.acknowledgedAt || new Date().toISOString(),
    playbookId: entry.playbookId || null,
    dataSource: 'pre-mortem-ack-store',
    version: ACK_STORE_VERSION,
  };
  raw.version = ACK_STORE_VERSION;
  raw.updatedAt = new Date().toISOString();
  const result = writeRaw(raw);
  return { ...result, signalId, ack: raw.acks[signalId] };
}

function listAcks(limit = 50) {
  const entries = Object.values(readRaw().acks || {});
  return entries.sort((a, b) => String(b.acknowledgedAt).localeCompare(String(a.acknowledgedAt))).slice(0, limit);
}

module.exports = {
  ACK_STORE_VERSION,
  hasAck,
  getAck,
  saveAck,
  listAcks,
  storePath,
  buildSignalId,
};
