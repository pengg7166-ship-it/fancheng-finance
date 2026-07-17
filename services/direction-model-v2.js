/**
 * DirectionModel v2 'logistic direction WITHOUT philosophyScore as feature.
 * Uses production v1.34.8 weights with philosophy zeroed (no retrain / no overwrite).
 * Enable: MODEL_C_V2=1 (requires PHILOSOPHY_FILTER_V2=1)
 */
const { predictEnsembleSync, getDefaultWeightsPath } = require('./outlook-onnx-runner');
const philosophyFilter = require('./philosophy-direction-filter');

const MODEL_VERSION = 'v2-step4-no-philosophy';

function isEnabled() {
  const v = process.env.MODEL_C_V2;
  return (v === '1' || v === 'true') && philosophyFilter.isEnabled();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** Flat row with philosophyScore forced to 0 for direction-only logistic head. */
function buildFlatRowNoPhilosophy(flatRow = {}) {
  return {
    ...flatRow,
    philosophyScore: 0,
    philosophyMeta: flatRow.philosophyMeta
      ? { ...flatRow.philosophyMeta, philosophyZeroed: true }
      : { philosophyZeroed: true },
  };
}

function resolveWeightsPath(opts = {}) {
  return opts.weightsPath || getDefaultWeightsPath();
}

/**
 * @param {object} flatRow 'predictAtBarIndexHistorical ensemble flat row
 * @param {object} [opts]
 * @returns {{ direction, pUp, confidence, composite, version, backend, philosophyZeroed }}
 */
function predictDirectionModel(flatRow = {}, opts = {}) {
  const row = buildFlatRowNoPhilosophy(flatRow);
  const weightsPath = resolveWeightsPath(opts);
  const pred = predictEnsembleSync(row, { ...opts, weightsPath });
  const pUp = Number(pred.pUp ?? 0.5);
  const confidence = +clamp(Math.abs(pUp - 0.5) * 2, 0, 1).toFixed(4);

  return {
    direction: pred.direction || 'neutral',
    pUp: +pUp.toFixed(4),
    confidence,
    composite: pred.composite ?? 0,
    version: pred.version || MODEL_VERSION,
    backend: pred.backend || 'logistic-json',
    head: pred.head || null,
    philosophyZeroed: true,
    weightsPath,
  };
}

module.exports = {
  MODEL_VERSION,
  isEnabled,
  buildFlatRowNoPhilosophy,
  predictDirectionModel,
};
