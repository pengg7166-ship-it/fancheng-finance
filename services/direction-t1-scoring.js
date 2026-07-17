/**
 * T+1 direction confidence gating 'runtime config (weights unchanged)
 * Loads direction-t1-75-calibration.json from E drive outlook-models.
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { directionFromPUp } = require('./outlook-onnx-runner');

const CALIB_FILENAME = 'direction-t1-75-calibration.json';
let _cache = null;
let _cacheMtime = 0;

function getCalibrationPath() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  return path.join(dataDir, 'outlook-models', CALIB_FILENAME);
}

function loadCalibration(force = false) {
  const fp = getCalibrationPath();
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const stat = fs.statSync(fp);
    if (!force && _cache && stat.mtimeMs === _cacheMtime) return _cache;
    _cache = JSON.parse(fs.readFileSync(fp, 'utf8'));
    _cacheMtime = stat.mtimeMs;
    return _cache;
  } catch {
    return null;
  }
}

function isInstrumentExcluded(instrumentId, calib = null) {
  const c = calib || loadCalibration();
  const exclude = c?.excludeInstruments || c?.config?.excludeInstruments || [];
  return exclude.map((id) => String(id).toLowerCase()).includes(String(instrumentId || '').toLowerCase());
}

function resolveThresholds(sector, calib = null) {
  const c = calib || loadCalibration();
  const cfg = c?.config || c?.directionThresholds || {};
  const sectorTh = cfg.sectorThresholds?.[sector] || c?.directionThresholds?.sectorThresholds?.[sector];
  return {
    bullish: sectorTh?.bullish ?? cfg.bullish ?? c?.directionThresholds?.bullish ?? 0.55,
    bearish: sectorTh?.bearish ?? cfg.bearish ?? c?.directionThresholds?.bearish ?? 0.45,
    minConfidence: cfg.minConfidence ?? c?.minConfidence ?? 0,
    compositeMult: cfg.compositeMult ?? c?.compositeMult ?? null,
  };
}

/**
 * Whether a scored archive row passes confidence gate (for filtered KPI).
 * @param {object} row 'archive record; optional pUp, compositeScore, sector
 */
function passesConfidenceGate(row, calib = null) {
  const c = calib || loadCalibration();
  if (!c) return true;
  if (isInstrumentExcluded(row.instrumentId, c)) return false;

  const sector = row.sector || row.instrumentSector;
  const th = resolveThresholds(sector, c);

  if (th.compositeMult && row.compositeScore != null) {
    const adj = row.compositeScore / th.compositeMult;
    if (adj > -0.12 && adj < 0.12) return false;
    return true;
  }

  if (row.pUp != null || row.ensemblePUp != null || row.logisticPUp != null) {
    const pUp = row.pUp ?? row.ensemblePUp ?? row.logisticPUp;
    if (th.minConfidence && Math.abs(pUp - 0.5) < th.minConfidence) return false;
    const dir = directionFromPUp(pUp, {
      bullishThreshold: th.bullish,
      bearishThreshold: th.bearish,
    });
    return dir !== 'neutral';
  }

  // Archive rows without pUp: use tier strength as proxy
  const tier = String(row.predictedTier || row.predictedDir || '');
  if (tier.includes('strong')) return true;
  if (th.minConfidence >= 0.1 && (tier === 'bullish' || tier === 'bearish')) return false;
  return true;
}

function computeGatedStats(rows, calib = null) {
  const c = calib || loadCalibration();
  const gated = rows.filter(
    (r) =>
      r.predictedDir &&
      r.predictedDir !== 'neutral' &&
      r.actualDir &&
      r.hitDirection != null &&
      passesConfidenceGate(r, c),
  );
  const hits = gated.filter((r) => r.hitDirection).length;
  const hitRate = gated.length ? +(hits / gated.length).toFixed(4) : null;
  return {
    scored: gated.length,
    hits,
    hitRate,
    meetsTarget: hitRate != null ? hitRate >= 0.75 : null,
    calibrationLoaded: Boolean(c),
    strategy: c?.strategy || null,
    minConfidence: c?.minConfidence ?? c?.config?.minConfidence ?? null,
  };
}

module.exports = {
  CALIB_FILENAME,
  getCalibrationPath,
  loadCalibration,
  isInstrumentExcluded,
  resolveThresholds,
  passesConfidenceGate,
  computeGatedStats,
};
