/**
 * 研究—policy/news/thesis 触发 · W0-W4 关注级别
 * 持久' FANCHENG_DATA_DRIVE/FanchengFinance/research-pool/pool.jsonl
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getExternalRoot } = require('./data-paths');

const POOL_VERSION = 'v1.44.0-discipline';

const WATCH_LEVELS = Object.freeze({
  W0: { id: 'W0', label: '跟踪', scoutAllowed: false },
  W1: { id: 'W1', label: '聚焦', scoutAllowed: false },
  W2: { id: 'W2', label: '事件/剧烈波动', scoutAllowed: true, eventDrivenUnverified: true, scoutSize: 'tiny' },
  O2: { id: 'O2', label: '二次反弹·快钱', scoutAllowed: true, overshootBounce: true, scoutSize: 'micro', mandatoryExit: '不恋战' },
  W3: { id: 'W3', label: '已验证试仓', scoutAllowed: true },
  W4: { id: 'W4', label: '加仓确认', scoutAllowed: true },
});

function poolDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'research-pool');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function poolFilePath() {
  const dir = poolDir();
  return dir ? path.join(dir, 'pool.jsonl') : null;
}

function nowIso() {
  return new Date().toISOString();
}

function readPoolEntries() {
  const fp = poolFilePath();
  if (!fp || !fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip corrupt line
    }
  }
  return entries;
}

function writePoolEntries(entries) {
  const fp = poolFilePath();
  if (!fp) return false;
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  fs.writeFileSync(fp, body, 'utf8');
  return true;
}

/** Latest entry per symbol wins */
function getPoolMap() {
  const map = new Map();
  for (const e of readPoolEntries()) {
    const sym = normalizeCommodityId(e.symbol);
    if (!sym) continue;
    const prev = map.get(sym);
    if (!prev || (e.updatedAt || e.addedAt) >= (prev.updatedAt || prev.addedAt)) {
      map.set(sym, e);
    }
  }
  return map;
}

function getPoolList() {
  return [...getPoolMap().values()].sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
}

function seedPoolIfEmpty() {
  const fp = poolFilePath();
  if (fp && fs.existsSync(fp) && fs.statSync(fp).size > 0) return;
  const seeds = [
    { symbol: 'i', watchLevel: 'W1', trigger: 'playbook-seed', note: 'PB-I-2023 政策/资本背离模板' },
    { symbol: 'rb', watchLevel: 'W1', trigger: 'playbook-seed', note: 'PB-BLACK-2015 供给侧改革模板' },
    { symbol: 'lh', watchLevel: 'W1', trigger: 'playbook-seed', note: 'PB-LH-2024 去产能踩踏' },
    { symbol: 'fg', watchLevel: 'W1', trigger: 'playbook-seed', note: 'PB-FG-2024 供给 reform→需求锚定' },
    { symbol: 'ag', watchLevel: 'W2', trigger: 'narrative-seed', note: '贵金属叙事 · 资本关注' },
  ];
  for (const s of seeds) addToPool(s.symbol, s);
}

/**
 * @param {string} symbol
 * @param {object} meta '{ watchLevel, trigger, note, regime, divergenceLevel, playbookId, priorityScore }
 */
function addToPool(symbol, meta = {}) {
  const sym = normalizeCommodityId(symbol);
  if (!sym) return null;
  const wl = meta.watchLevel && WATCH_LEVELS[meta.watchLevel] ? meta.watchLevel : 'W0';
  const entry = {
    symbol: sym,
    watchLevel: wl,
    watchLabel: WATCH_LEVELS[wl].label,
    trigger: meta.trigger || 'manual',
    note: meta.note || null,
    regime: meta.regime || null,
    divergenceLevel: meta.divergenceLevel || null,
    playbookId: meta.playbookId || null,
    priorityScore: meta.priorityScore ?? null,
    eventDrivenUnverified: wl === 'W2' ? true : meta.eventDrivenUnverified || false,
    overshootBounce: wl === 'O2' ? true : meta.overshootBounce || false,
    addedAt: meta.addedAt || nowIso(),
    updatedAt: nowIso(),
    source: meta.source || null,
    dataSource: 'research-pool',
    method: meta.method || 'addToPool',
  };
  const fp = poolFilePath();
  if (!fp) return entry;
  fs.appendFileSync(fp, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

/** Same symbol+trigger within window 'skip auto-add */
function findRecentPoolEntry(symbol, trigger, withinMs = 24 * 3600 * 1000) {
  const sym = normalizeCommodityId(symbol);
  if (!sym || !trigger) return null;
  const cutoff = Date.now() - withinMs;
  for (const e of readPoolEntries()) {
    if (normalizeCommodityId(e.symbol) !== sym) continue;
    if ((e.trigger || '') !== trigger) continue;
    const ts = new Date(e.addedAt || e.updatedAt || 0).getTime();
    if (!Number.isNaN(ts) && ts >= cutoff) return e;
  }
  return null;
}

function getPoolStatus(symbol) {
  const sym = normalizeCommodityId(symbol);
  const entry = getPoolMap().get(sym);
  if (!entry) return { inPool: false, watchLevel: 'W0', watchLabel: WATCH_LEVELS.W0.label };
  const wl = entry.watchLevel || 'W0';
  return {
    inPool: true,
    ...entry,
    watchLevel: wl,
    watchLabel: WATCH_LEVELS[wl]?.label || wl,
    scoutAllowed: WATCH_LEVELS[wl]?.scoutAllowed || false,
  };
}

function deriveWatchLevel(inst, context = {}) {
  const tg = context.tradingGuidance || inst?.tradingGuidance;
  const lt = context.longTermGuidance || inst?.longTermGuidance;
  const posture = tg?.posture;
  const phase = tg?.phase;
  const pool = getPoolStatus(inst?.id);
  const gap = inst?.integratedSpec?.expectationGap || context.expectationGap;

  if (pool.inPool && pool.watchLevel === 'O2') return 'O2';
  if (pool.inPool && pool.watchLevel !== 'W0') return pool.watchLevel;

  if (gap?.overshootBounceEligible && phase === '冷淡') return 'O2';

  if (posture === '加仓' && lt?.entry?.readiness === 'ready') return 'W4';
  if (posture === '试仓' || posture === '持有') {
    if (lt?.entry?.readiness === 'ready') return 'W3';
    if (posture === '试仓') return 'W3';
  }
  const att = inst?.capitalAttention?.score;
  const volSpike = inst?.smoothedVol?.volRising && inst?.smoothedVol?.percentile >= 70;
  if (volSpike || (att != null && att >= 70 && phase === '升温')) return 'W2';
  if (att != null && att >= 50) return 'W1';
  return 'W0';
}

module.exports = {
  POOL_VERSION,
  WATCH_LEVELS,
  poolFilePath,
  seedPoolIfEmpty,
  addToPool,
  findRecentPoolEntry,
  getPoolList,
  getPoolMap,
  getPoolStatus,
  deriveWatchLevel,
};
