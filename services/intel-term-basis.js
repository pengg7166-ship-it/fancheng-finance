/**
 * 情报中心 · 基差/期限结构附着（构想 §28 / §19）
 * 真实 term-structure 磁盘序列；缺失返回 null，不造假。
 */
const termFetcher = require('./term-structure-fetcher');

const BASIS_VERSION = 'v2.60.0-term-basis';

function classifyBasisSide(spreadPct, zScore) {
  if (spreadPct == null || !Number.isFinite(Number(spreadPct))) return null;
  const s = Number(spreadPct);
  // 近-远 >0 近端升水(backwardation 常偏多结构)；与 contradiction-matrix 一致：-spread 定 side
  if (Math.abs(s) <= 0.15 && (zScore == null || Math.abs(zScore) < 0.5)) return 'flat';
  if (s > 0.15) return 'bull'; // 近强/升水
  if (s < -0.15) return 'bear'; // 近弱/贴水
  return 'flat';
}

function loadLatestTermSlot(instrumentId, asOf) {
  const id = String(instrumentId || '').toLowerCase();
  if (!id) return null;
  const today = asOf || new Date().toISOString().slice(0, 10);
  let slot = termFetcher.getTermStructureAtDate?.(id, today);
  if (slot?.spreadPct != null) return slot;

  const rows = termFetcher.loadTermStructureRows?.(id);
  if (!rows?.length) return null;
  const last = rows[rows.length - 1];
  const spreadPct = last.spread_pct ?? last.spreadPct ?? null;
  if (spreadPct == null) return null;
  return {
    date: String(last.date || '').slice(0, 10),
    instrumentId: id,
    nearContract: last.near_contract || null,
    farContract: last.far_contract || null,
    nearClose: last.near_close ?? null,
    farClose: last.far_close ?? null,
    spreadNearFar: last.spread_near_far ?? null,
    spreadPct: Number(spreadPct),
    zScore: last.z_score ?? last.zScore ?? null,
    structureRegime: last.structure_regime || null,
    source: last.source || 'term_structure',
    sampleN: rows.length,
    stale: String(last.date || '').slice(0, 10) < today,
  };
}

function buildBasisFactor(instrumentId, asOf) {
  const slot = loadLatestTermSlot(instrumentId, asOf);
  if (!slot || slot.spreadPct == null) {
    return {
      available: false,
      reason: 'term_structure_missing',
      dataSource: 'missing',
      version: BASIS_VERSION,
    };
  }
  const side = classifyBasisSide(slot.spreadPct, slot.zScore);
  const score =
    side === 'bull' ? Math.min(1, Math.abs(slot.spreadPct) / 2) : side === 'bear' ? -Math.min(1, Math.abs(slot.spreadPct) / 2) : 0;
  const structure =
    slot.structureRegime ||
    (slot.spreadPct > 0.15 ? 'backwardation' : slot.spreadPct < -0.15 ? 'contango' : 'flat');

  return {
    available: true,
    spread: slot.spreadNearFar,
    spreadPct: slot.spreadPct,
    zScore: slot.zScore,
    score: +score.toFixed(4),
    strength: Math.min(1, Math.abs(slot.zScore != null ? slot.zScore / 3 : slot.spreadPct / 2)),
    side,
    label: `近远价差 ${slot.spreadPct > 0 ? '+' : ''}${Number(slot.spreadPct).toFixed(2)}% · ${structure}${
      slot.zScore != null ? ` · z${Number(slot.zScore).toFixed(2)}` : ''
    }`,
    structure,
    curve: structure,
    asOf: slot.date,
    nearContract: slot.nearContract,
    farContract: slot.farContract,
    sampleN: slot.sampleN ?? null,
    nDisplay: slot.sampleN != null ? String(slot.sampleN) : '暂无',
    stale: slot.stale === true,
    sourceTier: slot.stale ? 'C' : 'A',
    dataSource: slot.source || 'term-structure',
    version: BASIS_VERSION,
  };
}

function attachTermBasisToInstrument(inst, asOf) {
  if (!inst?.id) return inst;
  const basis = buildBasisFactor(inst.id, asOf);
  const termStructure = basis.available
    ? {
        structure: basis.structure,
        curve: basis.structure,
        score: basis.score,
        strength: basis.strength,
        label: basis.label,
        sourceTier: basis.sourceTier,
        dataSource: basis.dataSource,
        sampleN: basis.sampleN,
      }
    : null;

  return {
    ...inst,
    basis,
    termStructure,
    factors: {
      ...(inst.factors || {}),
      basis,
      termStructure,
    },
  };
}

function attachTermBasisToInstruments(instruments, asOf) {
  return (instruments || []).map((i) => attachTermBasisToInstrument(i, asOf));
}

module.exports = {
  BASIS_VERSION,
  buildBasisFactor,
  attachTermBasisToInstrument,
  attachTermBasisToInstruments,
  loadLatestTermSlot,
  classifyBasisSide,
};
