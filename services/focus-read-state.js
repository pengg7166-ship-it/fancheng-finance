/**
 * 关注品种分析已读/未读状态
 * 持久化至 FANCHENG_DATA_DRIVE/FanchengFinance/focus-analysis/read-state.json
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getExternalRoot } = require('./data-paths');

const READ_STATE_VERSION = 'v1.49.2';

function stateDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'focus-analysis');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stateFilePath() {
  const dir = stateDir();
  return dir ? path.join(dir, 'read-state.json') : null;
}

function todaySessionDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadState() {
  const fp = stateFilePath();
  if (!fp || !fs.existsSync(fp)) {
    return { version: READ_STATE_VERSION, sessionDate: todaySessionDate(), read: {}, pinned: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (raw.sessionDate !== todaySessionDate()) {
      return { version: READ_STATE_VERSION, sessionDate: todaySessionDate(), read: {}, pinned: raw.pinned || [] };
    }
    return {
      version: READ_STATE_VERSION,
      sessionDate: raw.sessionDate || todaySessionDate(),
      read: raw.read || {},
      pinned: Array.isArray(raw.pinned) ? raw.pinned : [],
    };
  } catch {
    return { version: READ_STATE_VERSION, sessionDate: todaySessionDate(), read: {}, pinned: [] };
  }
}

function saveState(state) {
  const fp = stateFilePath();
  if (!fp) return false;
  fs.writeFileSync(fp, JSON.stringify({ ...state, version: READ_STATE_VERSION, sessionDate: todaySessionDate() }, null, 2), 'utf8');
  return true;
}

function isRead(symbol, sessionDate = todaySessionDate()) {
  const sym = normalizeCommodityId(symbol);
  const state = loadState();
  if (state.sessionDate !== sessionDate) return false;
  return Boolean(state.read[sym]);
}

function markRead(symbol) {
  const sym = normalizeCommodityId(symbol);
  const state = loadState();
  state.read[sym] = new Date().toISOString();
  saveState(state);
  return { symbol: sym, readAt: state.read[sym], sessionDate: state.sessionDate };
}

function markUnread(symbol) {
  const sym = normalizeCommodityId(symbol);
  const state = loadState();
  delete state.read[sym];
  saveState(state);
  return { symbol: sym, sessionDate: state.sessionDate };
}

function markAllRead(symbols = []) {
  const state = loadState();
  const now = new Date().toISOString();
  for (const s of symbols) {
    const sym = normalizeCommodityId(s);
    if (sym) state.read[sym] = now;
  }
  saveState(state);
  return state;
}

function getReadStateMap(symbols = []) {
  const state = loadState();
  const map = {};
  for (const s of symbols) {
    const sym = normalizeCommodityId(s);
    map[sym] = {
      read: Boolean(state.read[sym]),
      readAt: state.read[sym] || null,
      sessionDate: state.sessionDate,
    };
  }
  return map;
}

function setPinned(symbols = []) {
  const state = loadState();
  state.pinned = symbols.map(normalizeCommodityId).filter(Boolean);
  saveState(state);
  return state.pinned;
}

function getPinned() {
  return loadState().pinned || [];
}

module.exports = {
  READ_STATE_VERSION,
  todaySessionDate,
  isRead,
  markRead,
  markUnread,
  markAllRead,
  getReadStateMap,
  setPinned,
  getPinned,
  loadState,
};
