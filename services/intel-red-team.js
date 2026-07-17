/**
 * 情报中心 · 程序化红队
 * 给定主结论，自动构造最强反对论据；反对强度超阈值则强制降档。
 */
const { lookupCalibratedWeights } = require('./intel-statekey-weights');
const { loadFailureMuseum } = require('./intel-memory');

const RED_TEAM_VERSION = 'v2.83.0-redteam-ingest';

function historicalOutcomeForStateKey(stateKey, side) {
  if (!stateKey) return { n: null, hitRate: null, display: '暂无' };
  try {
    const cal = lookupCalibratedWeights(stateKey);
    if (cal?.hitRate != null && cal?.n != null) {
      return {
        n: cal.n,
        hitRate: cal.hitRate,
        display: `${Math.round((cal.hitRate || 0) * 100)}% (${cal.hits ?? '?'}/${cal.n})`,
        dataSource: 'intel-statekey-weights',
      };
    }
    if (cal?.n != null) {
      return { n: cal.n, hitRate: cal.hitRate ?? null, display: cal.nDisplay || `n=${cal.n}`, dataSource: 'intel-statekey-weights' };
    }
  } catch {
    // fall through
  }
  return { n: null, hitRate: null, display: '暂无', dataSource: 'missing' };
}

function buildRedTeamArguments(inst, claim) {
  const args = [];
  const kernel = inst?.intelligenceKernel;
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const cap = inst?.capitalAttention || inst?.factors?.capitalAttention;
  const side = claim?.side || 'flat';

  if (kernel?.dissent?.opposingEvidence?.length) {
    for (const opp of kernel.dissent.opposingEvidence.slice(0, 3)) {
      args.push({
        type: 'kernel_dissent',
        strength: kernel.dissent.dissentStrength ?? 0.5,
        summary: typeof opp === 'string' ? opp : opp?.text || opp?.label || '反对证据',
        dataSource: 'intelligence-kernel.dissent',
      });
    }
  }

  if (sf?.available && sf.structureBias) {
    const opposes =
      (side === 'bull' && sf.structureBias === 'bear') || (side === 'bear' && sf.structureBias === 'bull');
    if (opposes) {
      args.push({
        type: 'joint_contradiction',
        strength: sf.coherence != null ? 1 - sf.coherence : 0.6,
        summary: `合证结构(${sf.primaryLabel || sf.primaryRegime})与命题方向背离`,
        dataSource: sf.dataSource || 'stock-flow-joint',
        n: sf.sampleN ?? null,
      });
    }
  }

  if (cap?.attitudeScore != null) {
    const opposes =
      (side === 'bull' && cap.attitudeScore < -0.08) || (side === 'bear' && cap.attitudeScore > 0.08);
    if (opposes) {
      args.push({
        type: 'capital_contradiction',
        strength: Math.min(1, Math.abs(cap.attitudeScore) * 2),
        summary: `资金态度(${cap.attitudeLabel})与命题方向不一致`,
        dataSource: cap.dataSource || 'capital-attitude',
      });
    }
  }

  const hist = historicalOutcomeForStateKey(claim?.stateKey || kernel?.stateKey, side);
  if (hist.n != null && hist.n >= 15 && hist.hitRate != null && hist.hitRate < 0.48) {
    args.push({
      type: 'historical_statekey',
      strength: 0.55 + (0.48 - hist.hitRate),
      summary: `同 stateKey 历史方向命中偏低 ${hist.display}`,
      dataSource: hist.dataSource,
      n: hist.n,
    });
  }

  const museum = loadFailureMuseum(30);
  const similar = museum.filter(
    (m) => m.instrumentId === inst?.id && m.statement && claim?.statement && m.statement.slice(0, 20) === claim.statement.slice(0, 20)
  );
  if (similar.length) {
    args.push({
      type: 'failure_museum',
      strength: 0.5,
      summary: `失效博物馆有 ${similar.length} 条同品种近似命题`,
      dataSource: 'intel-memory.failure-museum',
      n: similar.length,
    });
  }

  if (inst?.expectationGap?.pricedIn) {
    args.push({
      type: 'priced_in',
      strength: 0.45,
      summary: '预期已定价，利好/利空或已反映',
      dataSource: 'expectation-gap',
    });
  }

  const dual = inst?.dualNarrative || inst?.intelCenter?.dualNarrative;
  if (dual?.regime === 'split') {
    args.push({
      type: 'dual_split',
      strength: Math.min(1, 0.5 + (dual.splitScore || 0.3)),
      summary: `内外叙事分裂 · ${dual.regimeLabel || 'split'}`,
      dataSource: dual.dataSource || 'intel-dual-narrative',
      n: dual.external?.n ?? dual.domestic?.n ?? null,
    });
  }

  const hz = inst?.intelCenter?.horizonCoordination;
  if (hz?.hasConflict) {
    args.push({
      type: 'horizon_conflict',
      strength: hz.severity === 'high' ? 0.7 : 0.55,
      summary: `三尺度冲突 · ${hz.headline || hz.display || '禁止合成箭头'}`,
      dataSource: 'intel-horizon-coordination',
    });
  }

  return args.sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
}

function evaluateRedTeam(inst, claim) {
  if (!claim) {
    return {
      version: RED_TEAM_VERSION,
      available: false,
      reason: 'no_claim',
      opposingStrength: null,
      forceDowngrade: false,
      arguments: [],
    };
  }

  const arguments_ = buildRedTeamArguments(inst, claim);
  const opposingStrength =
    arguments_.length > 0
      ? +Math.min(1, Math.max(...arguments_.map((a) => a.strength ?? 0))).toFixed(4)
      : 0;

  const forceDowngrade = opposingStrength >= 0.72;
  const suggestDowngrade = opposingStrength >= 0.55;

  let downgradeTo = null;
  if (forceDowngrade) downgradeTo = '不可判定';
  else if (suggestDowngrade && claim.confidence === '强结构') downgradeTo = '弱结构';
  else if (suggestDowngrade && claim.confidence === '弱结构') downgradeTo = '叙事分歧';

  return {
    version: RED_TEAM_VERSION,
    available: arguments_.length > 0,
    opposingStrength,
    forceDowngrade,
    suggestDowngrade,
    downgradeTo,
    arguments: arguments_.slice(0, 4),
    display:
      opposingStrength >= 0.55
        ? `红队强度 ${(opposingStrength * 100).toFixed(0)}%${forceDowngrade ? ' · 强制降档' : ''}`
        : '红队未达降档阈值',
    dataSource: 'intel-red-team',
    method: 'programmatic-dissent',
  };
}

function applyRedTeamToClaim(claim, redTeam) {
  if (!claim || !redTeam?.downgradeTo) return claim;
  return {
    ...claim,
    confidence: redTeam.downgradeTo,
    status: redTeam.forceDowngrade ? 'watch' : claim.status,
    redTeamApplied: true,
    redTeamNote: redTeam.display,
  };
}

module.exports = {
  RED_TEAM_VERSION,
  buildRedTeamArguments,
  evaluateRedTeam,
  applyRedTeamToClaim,
  historicalOutcomeForStateKey,
};
