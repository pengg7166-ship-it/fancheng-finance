/**
 * stateKey 分桶权重表（walk-forward 网格校准）
 * 缺失桶 → null（内核回退启发式）；禁止用假权重填充。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const WEIGHTS_VERSION = 'v1.56.27-statekey-cal';
const DEFAULT_MIN_N = 40;
const DEFAULT_MIN_LIFT_PP = 0.5; // vs equal-weight，百分点

let _cache = null;
let _cacheMtime = null;

function weightsPath() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'outlook-models', 'intel-statekey-weights.json');
}

function normalizeTriple(pw, aw, fw) {
  let a = Math.max(0.05, Number(pw) || 0);
  let b = Math.max(0.05, Number(aw) || 0);
  let c = Math.max(0.05, Number(fw) || 0);
  const s = a + b + c;
  return {
    philosophyWeight: +(a / s).toFixed(4),
    adaptiveWeight: +(b / s).toFixed(4),
    factorWeight: +(c / s).toFixed(4),
  };
}

/** 粗粒度键：合证族 × 主矛盾侧（样本不足时回退） */
function coarseStateKey(stateKey) {
  const parts = String(stateKey || '').split('|');
  const joint = parts[1] || 'joint_off';
  const lean = parts[2] || 'flat';
  let family = 'other';
  if (joint === 'build_oi_up' || joint === 'joint_on') family = 'build_oi_up';
  else if (joint === 'destock_oi_up') family = 'destock_oi_up';
  else if (joint === 'joint_mixed') family = 'joint_mixed';
  else if (joint === 'joint_off' || joint === 'joint_soft') family = 'joint_off';
  else if (/destock|build|flat_oi|oi_only/.test(joint)) family = joint;
  return `${family}|${lean}`;
}

function loadStateKeyWeights({ force = false } = {}) {
  const fp = weightsPath();
  if (!fs.existsSync(fp)) {
    _cache = null;
    _cacheMtime = null;
    return null;
  }
  try {
    const mtime = fs.statSync(fp).mtimeMs;
    if (!force && _cache && _cacheMtime === mtime) return _cache;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    _cache = raw;
    _cacheMtime = mtime;
    return raw;
  } catch {
    return null;
  }
}

function saveStateKeyWeights(report) {
  const fp = weightsPath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(report, null, 2), 'utf8');
  _cache = report;
  _cacheMtime = Date.now();
  return fp;
}

/**
 * @returns {{ weights, source, stateKey, coarseKey, n, hitDisplay, liftVsEqual, rationale } | null}
 */
function lookupCalibratedWeights(stateKey, opts = {}) {
  const table = loadStateKeyWeights();
  if (!table?.buckets && !table?.coarseBuckets) return null;
  const minN = opts.minN ?? table.minN ?? DEFAULT_MIN_N;
  const minLift = opts.minLiftPp ?? table.minLiftPp ?? DEFAULT_MIN_LIFT_PP;
  const key = String(stateKey || '');
  const coarse = coarseStateKey(key);

  const pick = (bucket, src, usedKey) => {
    if (!bucket?.weights) return null;
    if ((bucket.n || 0) < minN) return null;
    if (bucket.liftVsEqual != null && bucket.liftVsEqual < minLift) return null;
    return {
      weights: normalizeTriple(
        bucket.weights.philosophyWeight,
        bucket.weights.adaptiveWeight,
        bucket.weights.factorWeight
      ),
      source: src,
      stateKey: usedKey,
      coarseKey: coarse,
      n: bucket.n,
      hitDisplay: bucket.hitDisplay || null,
      liftVsEqual: bucket.liftVsEqual,
      rationale: [
        `stateKey校准 ${usedKey}: ${bucket.hitDisplay || ''} lift=${bucket.liftVsEqual ?? '—'}pp (n=${bucket.n})`,
      ],
      version: table.version || WEIGHTS_VERSION,
      calibratedAt: table.asOf || null,
    };
  };

  const fine = pick(table.buckets?.[key], 'statekey-fine', key);
  if (fine) return fine;
  const coarseHit = pick(table.coarseBuckets?.[coarse], 'statekey-coarse', coarse);
  if (coarseHit) return coarseHit;

  const gf = table.globalFallback;
  if (gf?.weights && (gf.n || 0) >= minN && (gf.liftVsEqual == null || gf.liftVsEqual >= minLift)) {
    return {
      weights: normalizeTriple(
        gf.weights.philosophyWeight,
        gf.weights.adaptiveWeight,
        gf.weights.factorWeight
      ),
      source: 'statekey-global',
      stateKey: key,
      coarseKey: coarse,
      n: gf.n,
      hitDisplay: gf.hitDisplay || null,
      liftVsEqual: gf.liftVsEqual,
      rationale: [
        `stateKey无专属桶 · 用全局校准: ${gf.hitDisplay || ''} lift=${gf.liftVsEqual ?? '—'}pp (n=${gf.n})`,
      ],
      version: table.version || WEIGHTS_VERSION,
      calibratedAt: table.asOf || null,
    };
  }
  return null;
}

module.exports = {
  WEIGHTS_VERSION,
  DEFAULT_MIN_N,
  DEFAULT_MIN_LIFT_PP,
  weightsPath,
  normalizeTriple,
  coarseStateKey,
  loadStateKeyWeights,
  saveStateKeyWeights,
  lookupCalibratedWeights,
};
