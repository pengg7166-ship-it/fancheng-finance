/**
 * 情报中心 · 命题库（claim lifecycle · 构想 §46）
 * 从引擎真实字段派生可证伪原子命题；禁止无 ID / 无证伪句 / 套话结论进 Top5/Interrupt。
 * v2.89.11：原子谓词 + 期号 + 反套话门禁 + 锐度板。
 */
const crypto = require('crypto');
const { extractEvidenceFromInstrument, partitionEvidence } = require('./intel-evidence-dsl');
const { applyReliabilityToEvidenceList } = require('./intel-analyst-workbench');

const CLAIM_VERSION = 'v2.89.11-sharp-atomic-os';

const HORIZONS = {
  tactical: { id: 'tactical', label: '战术 1–3d', days: 3 },
  structural: { id: 'structural', label: '结构 2–8w', days: 56 },
  paradigm: { id: 'paradigm', label: '范式 季+', days: 120 },
};

const CONFIDENCE_LEVELS = {
  strong: '强结构',
  weak: '弱结构',
  divided: '叙事分歧',
  unknown: '不可判定',
  falsifying: '证伪进行中',
};

/** 套话/软模板：命中则不得标 atomic，并降为 watch */
const SOFT_TEMPLATE_RE =
  /关注验证|偏多关注|偏空关注|结构研判|待验证成立|关注触发器|短线结构待验|证据不足时仅 watch/;

function hashClaimKey(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
}

function makeClaimId(instrumentId, horizon, _mechanism) {
  // 稳定 ID：按品种+尺度，机制变化不打断证伪生命周期（机制写入字段）
  return `claim-${String(instrumentId).toLowerCase()}-${horizon}`;
}

function inferConfidence(inst, evidenceFor, evidenceAgainst, kernel) {
  if (inst?.insufficientData) return CONFIDENCE_LEVELS.unknown;
  // dataQuality 缺失时不直接判不可判定（旧缓存常见）；仅当明确 <3 才降
  if (inst?.dataQuality != null && Number(inst.dataQuality) < 3) return CONFIDENCE_LEVELS.unknown;

  const dissent = kernel?.dissent?.dissentStrength ?? 0;
  const hasKernel = Boolean(kernel?.available || kernel?.mainContradiction);
  const conviction = hasKernel ? (kernel?.conviction?.scale ?? 0.55) : 0.55;
  const forN = evidenceFor.filter((e) => e.n != null).reduce((s, e) => s + (e.n || 0), 0);
  const hasN = forN > 0 ? forN : null;
  const evidenceTotal = evidenceFor.length + evidenceAgainst.length;

  if (evidenceTotal === 0) return CONFIDENCE_LEVELS.unknown;
  if (evidenceAgainst.length === 0 && evidenceFor.length >= 1) {
    // 无反对 → 最高弱结构（门禁仍要求 dissent 才能 Interrupt）
    return CONFIDENCE_LEVELS.weak;
  }
  if (dissent >= 0.65 && conviction < 0.55) return CONFIDENCE_LEVELS.divided;
  if (evidenceFor.length >= 2 && evidenceAgainst.length >= 1 && conviction >= 0.7) {
    return hasN != null && hasN < 20 ? CONFIDENCE_LEVELS.weak : CONFIDENCE_LEVELS.strong;
  }
  if (evidenceFor.length >= 1 && evidenceAgainst.length >= 1) return CONFIDENCE_LEVELS.divided;
  if (evidenceFor.length >= 1) return CONFIDENCE_LEVELS.weak;
  return CONFIDENCE_LEVELS.weak;
}

function buildMechanism(inst, horizon, side) {
  const links = [];
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const basis = inst?.basis || inst?.factors?.basis;
  const dual = inst?.dualNarrative || inst?.factors?.dualNarrative;
  const kernel = inst?.intelligenceKernel;

  if (sf?.available && sf.primaryLabel) {
    links.push({
      step: '合证',
      source: 'stockFlowJoint',
      available: true,
      label: sf.primaryLabel,
      n: sf.sampleN ?? null,
      nDisplay: sf.sampleN != null ? String(sf.sampleN) : '暂无',
    });
  } else {
    links.push({ step: '合证', source: 'stockFlowJoint', available: false, label: '暂无', nDisplay: '暂无' });
  }

  if (basis?.available && (basis.structure || basis.label)) {
    links.push({
      step: '基差',
      source: 'basis',
      available: true,
      label: basis.structure || basis.label,
      n: basis.sampleN ?? null,
      nDisplay: basis.sampleN != null ? String(basis.sampleN) : '暂无',
    });
  } else {
    links.push({ step: '基差', source: 'basis', available: false, label: '暂无', nDisplay: '暂无' });
  }

  if (dual?.regime) {
    links.push({
      step: '内外',
      source: 'dualNarrative',
      available: true,
      label: dual.regimeLabel || dual.regime,
      nDisplay: dual.nDisplay || '暂无',
    });
  } else {
    links.push({ step: '内外', source: 'dualNarrative', available: false, label: '暂无', nDisplay: '暂无' });
  }

  if (kernel?.mainContradiction?.label) {
    links.push({
      step: '主矛盾',
      source: 'intelligenceKernel',
      available: true,
      label: kernel.mainContradiction.label,
      nDisplay: '暂无',
    });
  }

  const availableLinks = links.filter((l) => l.available);
  const chain =
    availableLinks.length > 0
      ? availableLinks.map((l) => `${l.step}:${l.label}`).join(' → ')
      : horizon === 'tactical'
        ? '短线结构待验'
        : '结构证据链·各环暂无';

  return {
    chain,
    links,
    mechanismDepth: availableLinks.length,
    mechanismDepthDisplay: availableLinks.length > 0 ? String(availableLinks.length) : '暂无',
    side,
    horizon,
    falsifiable: true,
  };
}

/**
 * 原子命题核：可机读谓词 + 可观测 + 证伪条件（§46）
 * 禁止只给「看多螺纹」式方向句。
 */
function buildAtomicCore(inst, horizon, side) {
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const basis = inst?.basis || inst?.factors?.basis;
  const dual = inst?.dualNarrative || inst?.factors?.dualNarrative;
  const kernel = inst?.intelligenceKernel;
  const regime = sf?.primaryLabel || sf?.primaryRegime || null;
  const falsifyIf = [];

  if (horizon === 'tactical') {
    const priceObs =
      inst?.price != null
        ? { kind: 'last_price', value: inst.price, dataSource: 'quote' }
        : { kind: 'last_price', value: null, dataSource: 'missing', nDisplay: '暂无' };
    const predicate =
      side === 'bull' ? 'tactical_bull_structure_holds' : side === 'bear' ? 'tactical_bear_structure_holds' : 'tactical_range';
    const otherwiseFalsify =
      side === 'bull'
        ? '若合证转空或跌破近5日低点结构则证伪'
        : side === 'bear'
          ? '若合证转多或突破近5日高点结构则证伪'
          : '若合证或基差给出明确方向则本震荡命题证伪';
    falsifyIf.push({
      predicate: side === 'flat' ? 'direction_emerges' : 'price_or_regime_break',
      condition: otherwiseFalsify,
      dataSource: 'price+stock-flow',
    });
    return {
      predicate,
      observable: priceObs,
      supporting: regime
        ? { kind: 'stock_flow_regime', value: regime, dataSource: 'stockFlowJoint', n: sf?.sampleN ?? null }
        : null,
      expectedEffect: side === 'bull' ? 'hold_above_5d_low' : side === 'bear' ? 'hold_below_5d_high' : 'range_bound',
      falsifyIf,
      otherwiseFalsify,
      sharpness: side === 'flat' ? 'watch' : 'atomic',
      softTemplate: false,
    };
  }

  if (regime && (side === 'bull' || side === 'bear')) {
    const flip =
      side === 'bull'
        ? '若合证翻转为累库+增仓或结构对立则证伪'
        : '若合证翻转为去库+增仓或结构对立则证伪';
    falsifyIf.push({
      predicate: 'stock_flow_regime_flip',
      condition: flip,
      dataSource: 'stock-flow-joint',
      currentRegime: regime,
    });
    if (basis?.available && basis.structure) {
      falsifyIf.push({
        predicate: 'basis_structure_oppose',
        condition: `若基差/期限从 ${basis.structure} 显著对立则降档或证伪`,
        dataSource: 'basis',
      });
    }
    if (dual?.regime === 'split') {
      falsifyIf.push({
        predicate: 'dual_split_blocks_strong',
        condition: '内外分裂存续则禁止升为强结构',
        dataSource: 'dualNarrative',
      });
    }
    return {
      predicate: side === 'bull' ? 'regime_supports_bull' : 'regime_pressures_bear',
      observable: {
        kind: 'stock_flow_regime',
        value: regime,
        dataSource: 'stockFlowJoint',
        n: sf?.sampleN ?? null,
        nDisplay: sf?.sampleN != null ? String(sf.sampleN) : '暂无',
      },
      supporting:
        basis?.available && basis.structure
          ? {
              kind: 'basis_structure',
              value: basis.structure,
              dataSource: 'basis',
              n: basis.sampleN ?? null,
              nDisplay: basis.sampleN != null ? String(basis.sampleN) : '暂无',
            }
          : null,
      expectedEffect:
        side === 'bull'
          ? basis?.structure
            ? `bull_structure_with_basis_${basis.structure}`
            : 'bull_structure_persist'
          : basis?.structure
            ? `bear_structure_with_basis_${basis.structure}`
            : 'bear_structure_persist',
      dualRegime: dual?.regime || null,
      falsifyIf,
      otherwiseFalsify: flip,
      sharpness: 'atomic',
      softTemplate: false,
    };
  }

  if (kernel?.mainContradiction?.label) {
    const otherwiseFalsify = '若主矛盾标签消失或对立证据主导则证伪';
    falsifyIf.push({
      predicate: 'main_contradiction_flip',
      condition: otherwiseFalsify,
      dataSource: 'intelligence-kernel',
    });
    return {
      predicate: 'main_contradiction_lean',
      observable: {
        kind: 'main_contradiction',
        value: kernel.mainContradiction.label,
        dataSource: 'intelligenceKernel',
        nDisplay: '暂无',
      },
      expectedEffect: side === 'bull' ? 'lean_bull' : side === 'bear' ? 'lean_bear' : 'lean_flat',
      falsifyIf,
      otherwiseFalsify,
      sharpness: 'watch',
      softTemplate: false,
    };
  }

  return {
    predicate: 'insufficient_structure',
    observable: { kind: 'missing', value: null, dataSource: 'missing', nDisplay: '暂无' },
    expectedEffect: 'watch_only',
    falsifyIf: [
      {
        predicate: 'valid_until_expiry',
        condition: '超过有效期仍无合证/基差确认则证伪/过期',
        dataSource: 'claim.validUntil',
      },
    ],
    otherwiseFalsify: '缺合证与基差时本命题仅 watch；不得当强结构；补齐后需重建期号',
    sharpness: 'soft',
    softTemplate: true,
  };
}

function buildStatement(inst, horizon, side, atomic) {
  const name = inst?.name || inst?.id || '品种';
  const hLabel = HORIZONS[horizon]?.label || horizon;
  const a = atomic || buildAtomicCore(inst, horizon, side);
  const dual = inst?.dualNarrative || inst?.factors?.dualNarrative;
  const basis = inst?.basis || inst?.factors?.basis;

  if (horizon === 'tactical') {
    const price = a.observable?.value != null ? `现价${a.observable.value}` : '现价待校验';
    if (side === 'bull') {
      return `${name}（${hLabel}）：原子「近5日低点结构不破 + 合证未转空」→短线偏多成立；${a.otherwiseFalsify}`;
    }
    if (side === 'bear') {
      return `${name}（${hLabel}）：原子「近5日高点结构不破 + 合证未转多」→短线偏空成立；${a.otherwiseFalsify}`;
    }
    return `${name}（${hLabel}）：原子「主矛盾未明·区间」成立；${a.otherwiseFalsify}`;
  }

  if (a.predicate === 'regime_supports_bull' || a.predicate === 'regime_pressures_bear') {
    const regime = a.observable?.value;
    const basisBit =
      a.supporting?.kind === 'basis_structure'
        ? `；期限/基差「${a.supporting.value}」同向佐证`
        : basis?.available === false
          ? '；（基差暂无，结论降档）'
          : '';
    const dualBit =
      dual?.regime === 'split'
        ? '；内外叙事分裂，禁止当强趋势'
        : dual?.regime === 'resonate'
          ? '；内外共振加强'
          : '';
    const lean = side === 'bull' ? '支撑偏多结构' : '压制偏空结构';
    // 愿景例风格：可观测因果句 + 显式证伪
    return `${name}（${hLabel}）：合证「${regime}」将${lean}${basisBit}${dualBit}；${a.otherwiseFalsify}`;
  }

  if (a.predicate === 'main_contradiction_lean') {
    const lean = side === 'bull' ? '利多' : side === 'bear' ? '利空' : '中性';
    return `${name}（${hLabel}）：主矛盾「${a.observable?.value}」呈${lean}；${a.otherwiseFalsify}`;
  }

  return `${name}（${hLabel}）：结构证据不足，命题仅 watch（不可升强结构）；${a.otherwiseFalsify}`;
}

function makeEpochId(inst, horizon, side, atomic) {
  const core = [
    String(inst?.id || '').toLowerCase(),
    horizon,
    side || 'flat',
    atomic?.predicate || '',
    String(atomic?.observable?.value ?? ''),
    String(atomic?.supporting?.value ?? ''),
  ];
  return `E-${hashClaimKey(core)}`;
}

function resolveClaimEpoch(inst, horizon, side, atomic, asOf) {
  const epochId = makeEpochId(inst, horizon, side, atomic);
  const prev = inst?.intelCenter?.claims?.find((c) => c.horizon === horizon) ||
    (inst?.intelCenter?.primaryClaim?.horizon === horizon ? inst.intelCenter.primaryClaim : null);
  const prevEpoch = prev?.epochId || null;
  const prevSide = prev?.side || null;
  const bumped = Boolean(prevEpoch && prevEpoch !== epochId);
  const bumpReason =
    bumped && prevSide && prevSide !== side
      ? `side ${prevSide}→${side}`
      : bumped
        ? 'atomic-core-changed'
        : null;
  return {
    epochId,
    epochDisplay: `期号 ${epochId}`,
    previousEpochId: bumped ? prevEpoch : null,
    epochBumped: bumped,
    bumpReason,
    epochAsOf: asOf || null,
  };
}

function assessStatementSharpness(statement, atomic) {
  const text = String(statement || '');
  const softHit = SOFT_TEMPLATE_RE.test(text) || atomic?.softTemplate === true;
  const hasFalsify = /则证伪|否则证伪|证伪/.test(text) || Boolean(atomic?.otherwiseFalsify);
  const hasAtomicLead = /原子「|合证「|主矛盾「/.test(text);
  const sharp =
    !softHit &&
    hasFalsify &&
    (atomic?.sharpness === 'atomic' || (hasAtomicLead && atomic?.sharpness === 'watch'));
  const softReasons = [];
  if (softHit) softReasons.push('soft_template');
  if (!hasFalsify) softReasons.push('missing_falsify_clause');
  if (atomic?.sharpness === 'soft') softReasons.push('atomic_soft');
  if (!atomic?.predicate) softReasons.push('missing_predicate');
  return {
    sharp: !!sharp,
    sharpness: sharp ? 'atomic' : softHit || atomic?.sharpness === 'soft' ? 'soft' : atomic?.sharpness || 'watch',
    softReasons,
    hasFalsifyClause: hasFalsify,
    softTemplate: softHit,
    nDisplay: softReasons.length ? String(softReasons.length) : '0',
  };
}

function makeIssueId(instrumentId, horizon, asOf) {
  // 稳定议题键（产品层）；日快照见 issueSnapshotId
  try {
    const { makeStableIssueId, makeIssueSnapshotId } = require('./intel-issue-board');
    const stable = makeStableIssueId(instrumentId, horizon);
    // asOf 保留兼容：调用方可再读 snapshot
    void asOf;
    void makeIssueSnapshotId;
    return stable;
  } catch {
    return `issue-${String(instrumentId).toLowerCase()}-${horizon}`;
  }
}

function makeIssueSnapshotIdCompat(instrumentId, horizon, asOf) {
  try {
    return require('./intel-issue-board').makeIssueSnapshotId(instrumentId, horizon, asOf);
  } catch {
    const day = String(asOf || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    return `issue-${String(instrumentId).toLowerCase()}-${horizon}-${day}`;
  }
}

function buildTriggers(inst, side, horizon) {
  const triggers = [];
  const kernel = inst?.intelligenceKernel;
  const flip = kernel?.dissent?.flipConditions || [];
  const sf = inst?.factors?.inventory?.stockFlowJoint;

  for (const f of flip.slice(0, 2)) {
    triggers.push({
      type: 'falsify',
      predicate: 'kernel_flip',
      condition: typeof f === 'string' ? f : f?.condition || f?.label || '待校验',
      dataSource: 'intelligence-kernel.dissent',
    });
  }

  if (inst?.regimeTriggers?.length) {
    for (const t of inst.regimeTriggers.slice(0, 2)) {
      triggers.push({
        type: 'upgrade',
        predicate: 'regime_upgrade',
        condition: typeof t === 'string' ? t : t?.label || t?.id || 'regime',
        dataSource: 'regime-triggers',
      });
    }
  }

  if (sf?.available || horizon === 'structural') {
    triggers.push({
      type: 'falsify',
      predicate: 'stock_flow_regime_flip',
      condition: `合证 regime 翻转（当前 ${sf?.primaryRegime || sf?.primaryLabel || inst?.capitalAttention?.jointWithInventory || '—'}）`,
      dataSource: 'stock-flow-joint',
    });
  }

  if (side === 'bull') {
    triggers.push({
      type: 'falsify',
      predicate: 'structure_bias_oppose',
      condition: '库存去化未延续或结构转空',
      dataSource: 'structure-clock',
    });
  } else if (side === 'bear') {
    triggers.push({
      type: 'falsify',
      predicate: 'structure_bias_oppose',
      condition: '抛压结构缓解或结构转多',
      dataSource: 'structure-clock',
    });
  }

  triggers.push({
    type: 'falsify',
    predicate: 'valid_until_expiry',
    condition: `超过有效期未获结构确认`,
    dataSource: 'claim.validUntil',
  });

  return triggers.slice(0, 5);
}

function buildSingleClaim(inst, horizon, asOf) {
  const kernel = inst?.intelligenceKernel;
  const side =
    inst?.direction === 'bullish'
      ? 'bull'
      : inst?.direction === 'bearish'
        ? 'bear'
        : kernel?.mainContradiction?.side && kernel.mainContradiction.side !== 'flat'
          ? kernel.mainContradiction.side
          : 'flat';

  const mechObj = buildMechanism(inst, horizon, side);
  const mechanism =
    mechObj.chain ||
    kernel?.mainContradiction?.label ||
    inst?.philosophy?.logicSummary?.slice(0, 48) ||
    '事件→预期→供需→库存→资金→价格';

  const claimId = makeClaimId(inst.id, horizon, mechanism);
  const issueId = makeIssueId(inst.id, horizon, asOf);
  const issueSnapshotId = makeIssueSnapshotIdCompat(inst.id, horizon, asOf);
  let evidence = extractEvidenceFromInstrument(inst, claimId, asOf);
  evidence = applyReliabilityToEvidenceList(evidence, inst.id);

  // 证据 DSL 的 for/against 相对「偏多」；命题 side=bear 时翻转归属
  const alignedFor = [];
  const alignedAgainst = [];
  for (const e of evidence) {
    if (e.direction === 'neutral') continue;
    if (side === 'bear') {
      if (e.direction === 'against') alignedFor.push(e);
      else if (e.direction === 'for') alignedAgainst.push(e);
    } else if (side === 'bull') {
      if (e.direction === 'for') alignedFor.push(e);
      else if (e.direction === 'against') alignedAgainst.push(e);
    } else {
      // flat：双方都进 against/for 各半，优先展示反对与分歧
      if (e.direction === 'for') alignedFor.push(e);
      else alignedAgainst.push(e);
    }
  }

  // 强制反对：kernel dissent 已在 extract 中标 against；bear 翻转后可能进 for，需确保至少保留一条反对
  const kernelOpp = (inst?.intelligenceKernel?.dissent?.opposingEvidence || []).slice(0, 2);
  if (!alignedAgainst.length && kernelOpp.length) {
    for (const opp of kernelOpp) {
      alignedAgainst.push({
        summary: typeof opp === 'string' ? opp : opp?.text || '反对证据',
        dataSource: 'intelligence-kernel.dissent',
        direction: 'against',
        nDisplay: '暂无',
      });
    }
  }

  const confidence = inferConfidence(inst, alignedFor, alignedAgainst, kernel);

  // 有方向+至少一条真实证据 → 允许 active（弱结构），避免全市场 draft 空转
  let status =
    confidence === CONFIDENCE_LEVELS.unknown
      ? 'draft'
      : inst?.outlookPending
        ? 'watch'
        : 'active';

  if (status === 'draft' && (alignedFor.length + alignedAgainst.length) >= 1 && side !== 'flat') {
    status = 'watch';
  }
  if (status === 'draft' && alignedFor.length >= 2) {
    status = 'watch';
  }

  const h = HORIZONS[horizon] || HORIZONS.structural;
  const validUntil = (() => {
    const d = new Date(asOf || new Date().toISOString().slice(0, 10));
    d.setDate(d.getDate() + h.days);
    return d.toISOString().slice(0, 10);
  })();

  const nValues = alignedFor.map((e) => e.n).filter((n) => n != null);
  if (inst?.factors?.basis?.sampleN != null) nValues.push(inst.factors.basis.sampleN);
  if (inst?.factors?.inventory?.stockFlowJoint?.sampleN != null) {
    nValues.push(inst.factors.inventory.stockFlowJoint.sampleN);
  }
  const nTotal = nValues.length ? Math.min(...nValues) : null;

  const atomic = buildAtomicCore(inst, horizon, side);
  const statement = buildStatement(inst, horizon, side, atomic);
  const sharpness = assessStatementSharpness(statement, atomic);
  const epoch = resolveClaimEpoch(inst, horizon, side, atomic, asOf);

  // 套话或无证伪句 → 禁止 active 强展示，压到 watch；强结构降弱
  let confidenceOut = confidence;
  if (sharpness.softTemplate || !sharpness.hasFalsifyClause) {
    if (status === 'active') status = 'watch';
    if (confidenceOut === CONFIDENCE_LEVELS.strong) confidenceOut = CONFIDENCE_LEVELS.weak;
  }

  // 原子证伪条件并入 triggers（去重）
  const triggers = buildTriggers(inst, side, horizon);
  for (const f of atomic.falsifyIf || []) {
    if (triggers.some((t) => t.condition === f.condition)) continue;
    triggers.unshift({
      type: 'falsify',
      predicate: f.predicate,
      condition: f.condition,
      dataSource: f.dataSource || 'atomic-core',
      atomic: true,
    });
  }

  // 板块父议题（范式层）：宏观→板块→品种，不伪造板块命题正文
  const sectorParentIssueId =
    horizon === 'paradigm' && inst.sector
      ? `issue-sector-${String(inst.sector).toLowerCase()}-paradigm`
      : horizon === 'structural' && inst.sector
        ? `issue-sector-${String(inst.sector).toLowerCase()}-structural`
        : null;

  return {
    claimId,
    issueId,
    issueIdStable: issueId,
    issueSnapshotId,
    issueVersion: CLAIM_VERSION,
    instrumentId: inst.id,
    instrumentName: inst.name,
    sector: inst.sector,
    horizon,
    horizonLabel: h.label,
    statement,
    atomic: {
      predicate: atomic.predicate,
      observable: atomic.observable,
      supporting: atomic.supporting || null,
      expectedEffect: atomic.expectedEffect,
      otherwiseFalsify: atomic.otherwiseFalsify,
      falsifyIf: atomic.falsifyIf,
      sharpness: sharpness.sharpness,
      softTemplate: sharpness.softTemplate,
    },
    otherwiseFalsify: atomic.otherwiseFalsify,
    sharpness: sharpness.sharpness,
    sharp: sharpness.sharp,
    softReasons: sharpness.softReasons,
    epochId: epoch.epochId,
    epochDisplay: epoch.epochDisplay,
    previousEpochId: epoch.previousEpochId,
    epochBumped: epoch.epochBumped,
    epochBumpReason: epoch.bumpReason,
    mechanism,
    mechanismChain: mechObj.chain,
    mechanismLinks: mechObj.links,
    mechanismDepth: mechObj.mechanismDepth,
    mechanismDepthDisplay: mechObj.mechanismDepthDisplay,
    falsifiable: sharpness.hasFalsifyClause,
    status,
    confidence: confidenceOut,
    side,
    evidenceFor: alignedFor.slice(0, 3),
    evidenceAgainst: alignedAgainst.slice(0, 3),
    triggers: triggers.slice(0, 6),
    baselineDate: asOf || new Date().toISOString().slice(0, 10),
    validUntil,
    parentClaim:
      horizon === 'tactical'
        ? makeClaimId(inst.id, 'structural', mechanism)
        : horizon === 'structural'
          ? makeClaimId(inst.id, 'paradigm', mechanism)
          : null,
    parentIssueId:
      horizon === 'tactical'
        ? makeIssueId(inst.id, 'structural', asOf)
        : horizon === 'structural'
          ? makeIssueId(inst.id, 'paradigm', asOf)
          : null,
    sectorParentIssueId,
    childClaims:
      horizon === 'structural'
        ? [makeClaimId(inst.id, 'tactical', mechanism)]
        : horizon === 'paradigm'
          ? [makeClaimId(inst.id, 'structural', mechanism)]
          : [],
    childIssueIds:
      horizon === 'structural'
        ? [makeIssueId(inst.id, 'tactical', asOf)]
        : horizon === 'paradigm'
          ? [makeIssueId(inst.id, 'structural', asOf)]
          : [],
    n: nTotal,
    nDisplay: nTotal != null ? `${nTotal}` : '暂无',
    stateKey: kernel?.stateKey || null,
    dataSource: 'intel-claim-library',
    method: 'atomic-predicate+falsify+epoch',
  };
}

/**
 * 将已生成 claims 解析为父子树；缺层标 null/暂无，不伪造 horizon 节点
 */
function buildClaimTree(claims) {
  const byId = new Map((claims || []).map((c) => [c.claimId, c]));
  const byHorizon = {};
  for (const c of claims || []) byHorizon[c.horizon] = c;

  const resolve = (claimId) => {
    if (!claimId) return null;
    const c = byId.get(claimId);
    if (!c) return { claimId, available: false, status: '暂无', note: '本层未构建' };
    return {
      claimId: c.claimId,
      issueId: c.issueId,
      horizon: c.horizon,
      horizonLabel: c.horizonLabel,
      status: c.status,
      confidence: c.confidence,
      side: c.side,
      statement: c.statement,
      mechanismDepth: c.mechanismDepth ?? null,
      mechanismDepthDisplay: c.mechanismDepthDisplay || '暂无',
      available: true,
      nDisplay: c.nDisplay || '暂无',
      epochId: c.epochId || null,
      epochDisplay: c.epochDisplay || null,
      sharp: c.sharp === true,
      sharpness: c.sharpness || null,
      atomicPredicate: c.atomic?.predicate || null,
      otherwiseFalsify: c.otherwiseFalsify || null,
      sectorParentIssueId: c.sectorParentIssueId || null,
    };
  };

  const nodes = (claims || []).map((c) => ({
    ...resolve(c.claimId),
    parent: resolve(c.parentClaim),
    children: (c.childClaims || []).map(resolve),
    parentIssueId: c.parentIssueId || null,
    childIssueIds: c.childIssueIds || [],
  }));

  const root =
    byHorizon.paradigm || byHorizon.structural || byHorizon.tactical || (claims && claims[0]) || null;

  return {
    version: CLAIM_VERSION,
    root: root ? resolve(root.claimId) : null,
    byHorizon: {
      paradigm: resolve(byHorizon.paradigm?.claimId),
      structural: resolve(byHorizon.structural?.claimId),
      tactical: resolve(byHorizon.tactical?.claimId),
    },
    nodes,
    edgeCount: nodes.reduce((s, n) => s + (n.parent?.available ? 1 : 0) + (n.children || []).filter((ch) => ch.available).length, 0),
    display: root
      ? `命题树 ${[
          byHorizon.paradigm ? '范式' : null,
          byHorizon.structural ? '结构' : null,
          byHorizon.tactical ? '战术' : null,
        ]
          .filter(Boolean)
          .join('→')} · 机制深 ${root.mechanismDepthDisplay || '暂无'}${
          root.epochDisplay ? ` · ${root.epochDisplay}` : ''
        }${root.sharp != null ? (root.sharp ? ' · 锐利' : ' · 软/待锐化') : ''}`
      : '命题树·暂无',
    dataSource: 'intel-claim-library',
    method: 'horizon-parent-child+atomic-epoch',
  };
}

function shouldEmitParadigmClaim(inst) {
  const phil = inst?.philosophy;
  if (phil?.paradigmHint) return { emit: true, reason: 'philosophy.paradigmHint' };
  if (phil?.ranked?.primary?.some((p) => p?.id === 'policy' || p?.id === 'geo')) {
    return { emit: true, reason: 'philosophy.policy/geo' };
  }
  const dual = inst?.dualNarrative || inst?.factors?.dualNarrative;
  if (dual?.regime === 'split') return { emit: true, reason: 'dualNarrative.split' };
  const hard = inst?.integratedSpec?.hardPolicy || inst?.hardPolicy;
  if (hard?.hasHard) return { emit: true, reason: 'hardPolicy' };
  const kernel = inst?.intelligenceKernel;
  if (kernel?.horizon === 'paradigm' || kernel?.mainContradiction?.horizon === 'paradigm') {
    return { emit: true, reason: 'kernel.paradigm' };
  }
  const theses = inst?.macroSynthesis?.activeTheses || [];
  if (theses.some((t) => /范式|制裁|地缘|长期政策|结构性/.test(`${t.claim || ''}${t.id || ''}`))) {
    return { emit: true, reason: 'macroSynthesis.paradigm-thesis' };
  }
  // 新闻主题：仅当有真实 hit 文本匹配，不造范式
  const hits = inst?.factors?.news?.hits || [];
  if (hits.some((h) => /制裁|地缘|关税大战|范式|长期政策/.test(`${h.title || ''}${h.summary || ''}`))) {
    return { emit: true, reason: 'news.paradigm-keyword' };
  }
  return { emit: false, reason: null };
}

function buildClaimsFromInstrument(inst, asOf) {
  if (!inst?.id) return [];
  const claims = [];
  const structural = buildSingleClaim(inst, 'structural', asOf);
  claims.push(structural);

  if (!inst.outlookPending) {
    claims.push(buildSingleClaim(inst, 'tactical', asOf));
  }

  const para = shouldEmitParadigmClaim(inst);
  if (para.emit) {
    const pClaim = buildSingleClaim(inst, 'paradigm', asOf);
    claims.push({ ...pClaim, paradigmEmitReason: para.reason });
  }

  // child 仅保留实际生成的节点；parent 可指向未构建层（树里标暂无）
  const ids = new Set(claims.map((c) => c.claimId));
  return claims.map((c) => ({
    ...c,
    childClaims: (c.childClaims || []).filter((id) => ids.has(id)),
  }));
}

function pickPrimaryClaim(claims) {
  if (!claims?.length) return null;
  // 终态仍展示，便于博物馆/改口；但优先可行动命题
  const actionable = claims.filter((c) => ['active', 'watch', 'falsifying'].includes(c.status));
  const pool = actionable.length ? actionable : claims;
  const structural = pool.find((c) => c.horizon === 'structural');
  return structural || pool[0];
}

function claimsForPublish(claims, minConfidence = 'weak') {
  const order = ['unknown', 'falsifying', 'divided', 'weak', 'strong'];
  const minIdx = order.indexOf(minConfidence === '弱结构' ? 'weak' : minConfidence) >= 0
    ? order.indexOf(minConfidence === '弱结构' ? 'weak' : minConfidence)
    : order.indexOf('weak');
  return (claims || []).filter((c) => {
    const key = Object.entries(CONFIDENCE_LEVELS).find(([, v]) => v === c.confidence)?.[0] || 'unknown';
    return order.indexOf(key) >= minIdx && c.status !== 'draft';
  });
}

/**
 * Pack 级命题锐度板：原子/期号/套话审计
 */
function buildClaimSharpnessBoard(instruments, asOfInput) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const rows = [];
  let sharpN = 0;
  let softN = 0;
  let missingFalsify = 0;
  let missingAgainst = 0;
  let epochBumped = 0;
  let withEpoch = 0;

  for (const inst of instruments || []) {
    const claim = inst?.intelCenter?.primaryClaim;
    if (!claim?.claimId) continue;
    const sharp = claim.sharp === true || claim.sharpness === 'atomic';
    const soft = claim.sharpness === 'soft' || claim.atomic?.softTemplate === true;
    if (sharp) sharpN += 1;
    if (soft) softN += 1;
    if (!claim.falsifiable && !claim.otherwiseFalsify) missingFalsify += 1;
    if (!(claim.evidenceAgainst || []).length) missingAgainst += 1;
    if (claim.epochId) withEpoch += 1;
    if (claim.epochBumped) epochBumped += 1;

    if (soft || !sharp || claim.epochBumped || !(claim.evidenceAgainst || []).length) {
      rows.push({
        instrumentId: inst.id,
        instrumentName: inst.name,
        claimId: claim.claimId,
        issueId: claim.issueId,
        epochDisplay: claim.epochDisplay || '暂无',
        sharpness: claim.sharpness || (sharp ? 'atomic' : 'soft'),
        sharp,
        softReasons: claim.softReasons || [],
        otherwiseFalsify: claim.otherwiseFalsify || '暂无',
        atomicPredicate: claim.atomic?.predicate || '暂无',
        nDisplay: claim.nDisplay || '暂无',
        againstN: (claim.evidenceAgainst || []).length,
        display: `${inst.name} · ${claim.sharpness || '—'} · ${claim.epochDisplay || '无期号'}${
          soft ? ' · 套话/软' : ''
        }${!sharp && !soft ? ' · 待锐化' : ''}`,
      });
    }
  }

  const total = sharpN + softN + rows.filter((r) => !r.sharp && r.sharpness !== 'soft').length;
  const scored = instruments?.filter((i) => i?.intelCenter?.primaryClaim?.claimId).length || 0;
  const questions = rows
    .filter((r) => r.sharpness === 'soft' || r.againstN === 0)
    .slice(0, 6)
    .map((r) => ({
      priority: r.againstN === 0 ? 'P1' : 'P2',
      score: r.againstN === 0 ? 36 : 24,
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      question:
        r.againstN === 0
          ? `${r.instrumentName}：主命题缺反对证据 — 禁止当可行动强结论`
          : `${r.instrumentName}：命题偏软/套话（${(r.softReasons || []).join(',') || r.sharpness}）— 是否重写原子证伪句？`,
      reasons: ['命题锐度板', r.epochDisplay, `n=${r.nDisplay}`],
      dataSource: 'intel-claim-library',
    }));

  return {
    version: CLAIM_VERSION,
    asOf,
    rows: rows.slice(0, 24),
    questions,
    counts: {
      scored,
      sharp: sharpN,
      soft: softN,
      missingFalsify,
      missingAgainst,
      withEpoch,
      epochBumped,
    },
    nDisplay: scored ? String(scored) : '暂无',
    display: scored
      ? `命题锐度 锐利${sharpN}/${scored} · 软${softN} · 缺反对${missingAgainst} · 期号${withEpoch}${
          epochBumped ? ` · 换期${epochBumped}` : ''
        }`
      : '命题锐度 暂无',
    note: '锐利=原子谓词+证伪句且非套话；软模板压 watch；期号随 side/原子核变化',
    dataSource: 'intel-claim-library',
    method: 'atomic-sharpness-audit',
  };
}

function enrichQuestionQueueWithClaimSharpness(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P2',
      priorityLabel: q.priority === 'P1' ? '缺反对' : '命题软模板',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 18);
  return {
    ...queue,
    all,
    deepQueue: deep,
    claimSharpnessInjected: extra.length,
    version: `${queue.version || ''}+claim-sharp`,
  };
}

module.exports = {
  CLAIM_VERSION,
  HORIZONS,
  CONFIDENCE_LEVELS,
  SOFT_TEMPLATE_RE,
  makeClaimId,
  makeIssueId,
  makeIssueSnapshotIdCompat,
  buildMechanism,
  buildAtomicCore,
  buildStatement,
  assessStatementSharpness,
  makeEpochId,
  resolveClaimEpoch,
  buildClaimsFromInstrument,
  buildSingleClaim,
  buildClaimTree,
  buildClaimSharpnessBoard,
  enrichQuestionQueueWithClaimSharpness,
  shouldEmitParadigmClaim,
  pickPrimaryClaim,
  claimsForPublish,
};
