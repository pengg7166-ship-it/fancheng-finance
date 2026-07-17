/**
 * VolumeOIModel 'OI change + volume confirmation (independent of logistic OI features).
 * validFundSignal: sign(ΔOI) == sign(philosophyDir) AND volume/OI z-score thresholds.
 * Enable: MODEL_C_V2=1 (requires PHILOSOPHY_FILTER_V2=1)
 */
const { computeOiBehaviorAtBar } = require('./oi-behavior-features');
const philosophyFilter = require('./philosophy-direction-filter');

const MODEL_VERSION = 'v2-step4-flow';
const VOLUME_BASELINE_DAYS = 20;
const DEFAULT_MIN_VOL_RATIO = 1.15;
const DEFAULT_MIN_OI_CHG_PCT = 0.08;

const SECTOR_MIN_VOL_RATIO = {
  precious: 1.12,
  metals: 1.15,
  black: 1.18,
  chemical: 1.16,
  energy: 1.16,
  agriculture: 1.14,
};

function isEnabled() {
  const v = process.env.MODEL_C_V2;
  return (v === '1' || v === 'true') && philosophyFilter.isEnabled();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function signDir(n) {
  if (n == null || Number.isNaN(Number(n)) || Number(n) === 0) return 0;
  return Number(n) > 0 ? 1 : -1;
}

function dirToLabel(d) {
  if (d === 1 || d === 'bullish') return 'bullish';
  if (d === -1 || d === 'bearish') return 'bearish';
  return 'neutral';
}

function resolveMinVolRatio(sector) {
  const env = parseFloat(process.env.FLOW_MODEL_MIN_VOL_RATIO || '');
  if (Number.isFinite(env) && env > 0) return env;
  return SECTOR_MIN_VOL_RATIO[sector] ?? DEFAULT_MIN_VOL_RATIO;
}

function resolveMinOiChgPct() {
  const env = parseFloat(process.env.FLOW_MODEL_MIN_OI_CHG_PCT || '');
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_MIN_OI_CHG_PCT;
}

function avgVolumeBaseline(bars, barIndex, window = VOLUME_BASELINE_DAYS) {
  if (!bars?.length || barIndex < 1) return null;
  const start = Math.max(0, barIndex - window);
  let sum = 0;
  let n = 0;
  for (let i = start; i < barIndex; i += 1) {
    const v = bars[i]?.volume;
    if (v != null && !Number.isNaN(v) && v > 0) {
      sum += Number(v);
      n += 1;
    }
  }
  return n ? sum / n : null;
}

function volumeZScore(bars, barIndex, window = VOLUME_BASELINE_DAYS) {
  if (!bars?.length || barIndex < 1) return null;
  const vol = bars[barIndex]?.volume;
  if (vol == null || vol <= 0) return null;
  const start = Math.max(0, barIndex - window);
  const samples = [];
  for (let i = start; i < barIndex; i += 1) {
    const v = bars[i]?.volume;
    if (v != null && v > 0) samples.push(Number(v));
  }
  if (samples.length < 5) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  const std = Math.sqrt(variance);
  if (std <= 0) return null;
  return +((Number(vol) - mean) / std).toFixed(4);
}

function resolvePhilosophyDirSign(filterOut) {
  if (!filterOut) return 0;
  if (filterOut.effectivePhilosophyDir != null) return signDir(filterOut.effectivePhilosophyDir);
  const label = filterOut.philosophyDirection;
  if (label === 'bullish') return 1;
  if (label === 'bearish') return -1;
  return 0;
}

function hasValidOiBehavior(beh) {
  return beh != null && beh.oi_change != null && !Number.isNaN(Number(beh.oi_change));
}

/**
 * @param {object} ctx
 * @param {object} ctx.filterOut 'philosophy filter output
 * @param {Array} [ctx.bars]
 * @param {number} [ctx.barIndex]
 * @param {string} [ctx.sector]
 * @param {object} [ctx.oiBehavior] 'precomputed technical.oiBehavior
 */
function evaluateVolumeOiFlow(ctx = {}) {
  const { filterOut, bars, barIndex, sector, oiBehavior: oiIn } = ctx;
  const philDir = resolvePhilosophyDirSign(filterOut);

  let beh = hasValidOiBehavior(oiIn) ? oiIn : null;
  if (!beh && bars != null && barIndex != null) {
    beh = computeOiBehaviorAtBar(bars, barIndex);
  }
  beh = beh || {};

  const oiChgDir = signDir(beh.oi_change);
  const flowDirNum = oiChgDir;
  const flowDirection = dirToLabel(flowDirNum);

  const vol = bars != null && barIndex != null ? bars[barIndex]?.volume : null;
  const avgVol = bars != null && barIndex != null ? avgVolumeBaseline(bars, barIndex) : null;
  const volRatio = avgVol && vol ? Number(vol) / avgVol : null;
  const volZ = bars != null && barIndex != null ? volumeZScore(bars, barIndex) : null;
  const volPctile = volZ != null ? +clamp((volZ + 2) / 4, 0, 1).toFixed(4) : null;

  const minVolRatio = resolveMinVolRatio(sector);
  const minOiChgPct = resolveMinOiChgPct();
  const oiChgPct = Math.abs(Number(beh.oi_change_pct ?? 0));

  const oiAlignedWithPhilosophy = philDir !== 0 && oiChgDir === philDir;
  const volumeAboveThreshold = volRatio != null && volRatio >= minVolRatio;
  const oiMagnitudeOk = oiChgPct >= minOiChgPct;
  const validFundSignal = Boolean(oiAlignedWithPhilosophy && volumeAboveThreshold && oiMagnitudeOk);

  let confidence = 0.08;
  if (validFundSignal) {
    confidence = 0.42 + clamp((volRatio - minVolRatio) / 2, 0, 0.28) + clamp(oiChgPct / 2, 0, 0.2);
  } else if (oiAlignedWithPhilosophy) {
    confidence = 0.22 + clamp(oiChgPct / 3, 0, 0.15);
  } else if (volumeAboveThreshold) {
    confidence = 0.15;
  }
  confidence = +clamp(confidence, 0, 1).toFixed(4);

  return {
    version: MODEL_VERSION,
    direction: flowDirection,
    flowDir: flowDirection,
    oiChgDir,
    oiChangePct: beh.oi_change_pct ?? null,
    volumeRatio: volRatio != null ? +volRatio.toFixed(4) : null,
    volumePctile: volPctile,
    volumeZScore: volZ,
    volumeOiRatio: beh.volume_oi_ratio ?? null,
    behaviorTag: beh.behavior_tag ?? null,
    priceDownOiUp: Boolean(beh.price_down_oi_up),
    priceUpOiDown: Boolean(beh.price_up_oi_down),
    validFundSignal,
    validFlow: validFundSignal,
    confidence,
    thresholds: {
      minVolRatio,
      minOiChgPct,
      philosophyDir: philDir,
    },
  };
}

module.exports = {
  MODEL_VERSION,
  DEFAULT_MIN_VOL_RATIO,
  DEFAULT_MIN_OI_CHG_PCT,
  isEnabled,
  evaluateVolumeOiFlow,
  resolvePhilosophyDirSign,
};
