/**
 * 仓单×资金合证 → 可审计决策增量（非仅存档）
 * 仅在 joint.available 且结构明确时给出 signed delta；缺失/混合 → null / 0，不填充。
 */
const JOINT_SIGNAL_VERSION = 'v1.56.25-joint-signal';

const COHERENCE_MULT = Object.freeze({
  '1m_3m_agree': 1.0,
  single: 0.72,
  partial: 0.55,
  '1m_3m_diverge': 0.0,
});

/** 归因 120d：build_oi_up 53.4%(1110) 保留；destock_oi_up 48.6% 置零；其余混合不赋权 */
const REGIME_BASE_DELTA = Object.freeze({
  destock_oi_up: 0.0,
  build_oi_up: -0.2,
  destock_oi_down: 0.0,
  build_oi_down: 0.0,
  destock_oi_flat: 0.0,
  build_oi_flat: 0.0,
  flat_oi_up: 0.0,
  flat_oi_down: 0.0,
  flat: 0.0,
  oi_only: 0.0,
  insufficient: 0.0,
});

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {object|null} joint buildStockFlowJoint 结果
 * @param {{ profileInventorySens?: number, allowMixed?: boolean, regimeWeights?: Record<string, number> }} [opts]
 */
function jointDecisionDelta(joint, opts = {}) {
  const invSens = Number.isFinite(Number(opts.profileInventorySens))
    ? clamp(Number(opts.profileInventorySens), 0.2, 1.2)
    : 0.7;
  const regimeTable = opts.regimeWeights || REGIME_BASE_DELTA;

  if (!joint || joint.available !== true) {
    return {
      delta: null,
      weight: 0,
      reason: joint?.reason || 'joint_unavailable',
      dataSource: joint?.dataSource || 'missing',
      method: 'stock-flow-joint-signal',
      version: JOINT_SIGNAL_VERSION,
      regime: null,
      coherence: null,
      structureBias: null,
    };
  }

  const regime = joint.primaryRegime || null;
  const coherence = joint.coherence || 'single';
  const structureBias = joint.structureBias || null;
  const cohMult = COHERENCE_MULT[coherence] ?? 0.4;
  let base = regimeTable[regime];
  if (base == null) base = 0;

  // 不因 supportsLong/Short 覆盖归因置零的 regime（避免 destock_oi_up 负 IC 被强行加多）
  if (joint.supportsLong === true && base > 0) base = Math.max(base, 0.16);
  if (joint.supportsShort === true && base < 0) base = Math.min(base, -0.2);

  if (structureBias === 'mixed' && !opts.allowMixed) {
    return {
      delta: 0,
      weight: 0,
      reason: 'mixed_structure_no_solo',
      dataSource: joint.dataSource,
      method: 'stock-flow-joint-signal',
      version: JOINT_SIGNAL_VERSION,
      regime,
      coherence,
      structureBias,
    };
  }

  if (!(Math.abs(base) > 1e-9) || !(cohMult > 0)) {
    return {
      delta: 0,
      weight: 0,
      reason: cohMult === 0 ? 'coherence_diverge' : 'regime_zero_weight',
      dataSource: joint.dataSource,
      method: 'stock-flow-joint-signal',
      version: JOINT_SIGNAL_VERSION,
      regime,
      coherence,
      structureBias,
    };
  }

  let delta = base * cohMult * invSens;
  if (joint.priceMayLag) delta *= 0.45;
  const hz = joint.horizons?.[joint.primaryHorizon || '1m'];
  if (hz?.oiStale) delta *= 0.5;

  delta = clamp(+delta.toFixed(4), -0.28, 0.28);
  return {
    delta,
    weight: Math.abs(delta),
    reason: 'joint_applied',
    dataSource: joint.dataSource,
    method: 'stock-flow-joint-signal',
    version: JOINT_SIGNAL_VERSION,
    regime,
    coherence,
    structureBias,
    supportsLong: !!joint.supportsLong,
    supportsShort: !!joint.supportsShort,
    primaryHorizon: joint.primaryHorizon || null,
    primaryLabel: joint.primaryLabel || null,
  };
}

/** 无合证时压低仓单单独分量（禁止单独定调进决策） */
function dampenSoloWarehouse(soloWarehouseScore, jointSignal) {
  if (soloWarehouseScore == null || !Number.isFinite(Number(soloWarehouseScore))) return 0;
  const s = Number(soloWarehouseScore);
  if (jointSignal?.reason === 'joint_applied' && jointSignal.delta != null) {
    return clamp(s * 0.25, -0.12, 0.12);
  }
  return clamp(s * 0.35, -0.08, 0.08);
}

module.exports = {
  JOINT_SIGNAL_VERSION,
  REGIME_BASE_DELTA,
  COHERENCE_MULT,
  jointDecisionDelta,
  dampenSoloWarehouse,
};
