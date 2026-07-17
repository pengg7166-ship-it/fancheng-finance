/**
 * T+1 unified experiment manifest 'single source of truth for horizon, splits, data versions.
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const CONFIG_FILENAME = 't1-unified-config.json';
const EXPERIMENT_WEIGHTS_FILENAME = 'outlook-logistic-weights-t1-unified-experiment.json';
const PRODUCTION_WEIGHTS_FILENAME = 'outlook-logistic-weights.json';
const CALIB_FILENAME = 'direction-t1-75-calibration.json';

let _cache = null;
let _cacheMtime = 0;

function getConfigPath() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  return path.join(dataDir, 'outlook-models', CONFIG_FILENAME);
}

function getExperimentWeightsPath() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  return path.join(dataDir, 'outlook-models', EXPERIMENT_WEIGHTS_FILENAME);
}

function getProductionWeightsPath() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  return path.join(dataDir, 'outlook-models', PRODUCTION_WEIGHTS_FILENAME);
}

function getCalibrationPath() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  return path.join(dataDir, 'outlook-models', CALIB_FILENAME);
}

function defaultConfig() {
  return {
    schemaVersion: 't1-unified-v1',
    modelId: 't1-unified-experiment',
    horizon: 1,
    horizonLabel: 'T+1',
    productionModelVersion: 'v1.34.8-ag-cu-spread+basis-term',
    experimentWeightsFile: EXPERIMENT_WEIGHTS_FILENAME,
    productionWeightsFile: PRODUCTION_WEIGHTS_FILENAME,
    calibrationFile: CALIB_FILENAME,
    train: { from: '2017-01-01', to: '2022-12-31' },
    oos: { from: '2023-01-01', to: '2025-12-31' },
    sessionAnchor: 'cn-session-21:00-05:00',
    data: {
      newsTaggedPath: 'history/news-tagged.csv',
      newsTaggedRowsExpected: 2462,
      newsTaggedUseCurated: false,
      directionArchiveInstruments: 65,
      rangeArchiveInstruments: 65,
      basisRegimeOverrides: 'history/labels/basis-regime-overrides.csv',
      basisSkipOiProxyExpected: 44,
    },
    regime: {
      agBasisStrictOiProxy: true,
      agBasisDisableOiProxy: false,
      useBasisRegimeOverrides: true,
    },
    scoring: {
      calibrationFile: CALIB_FILENAME,
      targetHitRatePct: 75,
      gateMinScored: 200,
      gateBeatBaselinePp: 2,
      baselines: {
        t1RawOverallPct: 52.11,
        t1GatedOverallPct: 52.81,
        t1GatedAuAgPct: 54.28,
      },
    },
    trainHyperparams: {
      instruments: ['au', 'ag'],
      step: 1,
      epochs: 800,
      lr: 0.08,
      lambda: 0.02,
      excludeFeatures: ['cu_momentum_5d', 'gldHoldings_chg_5d'],
      agTrainSampleWeight: 1.35,
      agBasisSampleWeight: 1.5,
    },
    updatedAt: new Date().toISOString(),
  };
}

function loadConfig(force = false) {
  const fp = getConfigPath();
  if (!fp || !fs.existsSync(fp)) return defaultConfig();
  try {
    const stat = fs.statSync(fp);
    if (!force && _cache && stat.mtimeMs === _cacheMtime) return _cache;
    _cache = { ...defaultConfig(), ...JSON.parse(fs.readFileSync(fp, 'utf8')) };
    _cacheMtime = stat.mtimeMs;
    return _cache;
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config) {
  const fp = getConfigPath();
  if (!fp) throw new Error('no data dir for t1-unified-config');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const payload = { ...config, updatedAt: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  _cache = payload;
  _cacheMtime = fs.statSync(fp).mtimeMs;
  return payload;
}

/** Apply unified regime env vars from config (idempotent per process). */
function applyRegimeEnv(config = null) {
  const c = config || loadConfig();
  if (c.regime?.agBasisStrictOiProxy) {
    process.env.AG_BASIS_STRICT_OI_PROXY = '1';
  }
  if (c.regime?.agBasisDisableOiProxy) {
    process.env.AG_BASIS_DISABLE_OI_PROXY = '1';
  }
  if (c.data?.newsTaggedUseCurated) {
    process.env.NEWS_TAGGED_USE_CURATED = '1';
  }
  return c;
}

module.exports = {
  CONFIG_FILENAME,
  EXPERIMENT_WEIGHTS_FILENAME,
  getConfigPath,
  getExperimentWeightsPath,
  getProductionWeightsPath,
  getCalibrationPath,
  defaultConfig,
  loadConfig,
  saveConfig,
  applyRegimeEnv,
};
