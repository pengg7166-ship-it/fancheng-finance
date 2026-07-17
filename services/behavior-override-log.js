/**
 * 行为覆盖追踪 '用户采纳/忽略 posture 建议
 * 持久' FANCHENG_DATA_DRIVE/FanchengFinance/behavior-overrides/overrides.jsonl
 */
const fs = require('fs');
const path = require('path');
const { getExternalRoot } = require('./data-paths');
const { normalizeCommodityId } = require('./policy-commodity-map');

const BEHAVIOR_LOG_VERSION = 'v1.44.0-discipline';
const PATTERN_WARN_MIN_N = 5;

function storeDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'behavior-overrides');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storePath() {
  const dir = storeDir();
  return dir ? path.join(dir, 'overrides.jsonl') : null;
}

function nowIso() {
  return new Date().toISOString();
}

function readOverrides() {
  const fp = storePath();
  if (!fp || !fs.existsSync(fp)) return [];
  return fs
    .readFileSync(fp, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function logBehaviorOverride(entry = {}) {
  const fp = storePath();
  const record = {
    symbol: normalizeCommodityId(entry.symbol),
    suggestedPosture: entry.suggestedPosture || null,
    userAction: entry.userAction,
    userPosture: entry.userPosture || null,
    note: entry.note || null,
    at: entry.at || nowIso(),
    dataSource: 'behavior-override-log',
    method: 'logBehaviorOverride',
    version: BEHAVIOR_LOG_VERSION,
  };
  if (!record.symbol || !['采纳', '忽略'].includes(record.userAction)) {
    return { ok: false, error: 'invalid entry' };
  }
  if (!fp) return { ok: true, record, persisted: false };
  fs.appendFileSync(fp, `${JSON.stringify(record)}\n`, 'utf8');
  return { ok: true, record, persisted: true };
}

function summarizeOverridePatterns(symbol = null) {
  const entries = readOverrides();
  const filtered = symbol
    ? entries.filter((e) => normalizeCommodityId(e.symbol) === normalizeCommodityId(symbol))
    : entries;

  const ignored = filtered.filter((e) => e.userAction === '忽略');
  const adopted = filtered.filter((e) => e.userAction === '采纳');
  const n = filtered.length;
  const ignoreRate = n ? ignored.length / n : null;

  let patternWarning = null;
  if (n >= PATTERN_WARN_MIN_N && ignoreRate != null && ignoreRate >= 0.7) {
    patternWarning = `忽略'${(ignoreRate * 100).toFixed(0)}% (n=${n}) · 建议复盘 posture 规则`;
  }

  return {
    total: n,
    ignored: ignored.length,
    adopted: adopted.length,
    ignoreRate,
    patternWarning,
    recent: filtered.slice(-10).reverse(),
    dataSource: 'behavior-override-log',
    method: 'pattern-summary',
    version: BEHAVIOR_LOG_VERSION,
    asOf: nowIso(),
  };
}

module.exports = {
  BEHAVIOR_LOG_VERSION,
  PATTERN_WARN_MIN_N,
  logBehaviorOverride,
  readOverrides,
  summarizeOverridePatterns,
};
