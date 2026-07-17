/**
 * 情报中心 · 总编排器（幕僚线 v2.58）
 * 串联：证据 → 命题 → 红队 → 时钟 → 定价 → 惊讶 → 场景 → 门禁 → 推送 → 备忘录 → 记忆
 */
const { buildClaimsFromInstrument, pickPrimaryClaim, buildClaimTree, buildClaimSharpnessBoard, enrichQuestionQueueWithClaimSharpness } = require('./intel-claim-library');
const { buildFalsificationClock } = require('./intel-falsification-clock');
const { assessPricingState } = require('./intel-pricing-state');
const { computeSurpriseVector, computeActionability } = require('./intel-surprise');
const { buildScenarioLattice, buildScenarioLatticeBoard, enrichQuestionQueueWithScenarioLattice } = require('./intel-scenario-lattice');
const { evaluateAllGates } = require('./intel-publish-gates');
const { resolvePushTier } = require('./intel-push-tier');
const { buildIntelMemo } = require('./intel-memo');
const { processMemoryForInstrument } = require('./intel-memory');
const { scoreQuestion } = require('./intel-question-queue');
const { evaluateRedTeam } = require('./intel-red-team');
const {
  ingestRedTeamDissent,
  buildRedTeamBoard,
  enrichQuestionQueueWithRedTeam,
} = require('./intel-red-team-loop');
const { resolveHorizonCoordination, buildHorizonConflictBoard, enrichQuestionQueueWithHorizon } = require('./intel-horizon-coordination');
const { matchCanonicalCases } = require('./intel-canonical-cases');
const {
  assessNarrativeEpidemiology,
  buildNarrativeContagionBoard,
  enrichQuestionQueueWithNarrative,
  buildSectorNarrativeHeatmap,
} = require('./intel-narrative-epidemiology');
const { applyAnnotationsToIntel } = require('./intel-analyst-workbench');
const {
  assessEvidenceFreshness,
  buildEvidenceFreshnessBoard,
  applyFreshnessToInterruptGate,
} = require('./intel-evidence-freshness');
const {
  assessEvidenceTriad,
  buildEvidenceTriadBoard,
  applyTriadToInterruptGate,
} = require('./intel-evidence-triad');

const ORCHESTRATOR_VERSION = 'v2.89.26-intel-center-quality-debt-repay';
const { resolveStaffFace } = require('./intel-staff-face');
const {
  applyShiftToPushTier,
  applyShiftDeliveryContract,
  resolveShift,
  buildShiftContext,
  buildShiftDisciplineBoard,
} = require('./intel-shift-schedule');
const { evaluateAndApplyFalsification } = require('./intel-falsification-executor');
const { attachTermBasisToInstrument } = require('./intel-term-basis');
const { attachDualNarrativeToInstrument } = require('./intel-dual-narrative');
const { buildTeachingPack } = require('./intel-teaching');
const {
  resolvePlaybookContext,
  applyPlaybookToClaim,
  buildPlaybookBoard,
  enrichQuestionQueueWithPlaybook,
} = require('./intel-playbook-switcher');
const { buildIssueBoard, attachIssueIdsToClaim } = require('./intel-issue-board');
const { listFaceContracts, FACE_CONTRACT_VERSION, applyFaceDeliveryContract, buildFaceContractBoard, buildCommanderWorkbar, buildFaceShellLayout } = require('./intel-face-contracts');
const { buildAntiPatternBoard, enrichQuestionQueueWithAntiPattern } = require('./intel-anti-pattern-board');
const { buildLlmBoundaryBoard } = require('./intel-llm-boundary');
const { buildPredictionQualityDebtBoard } = require('./intel-prediction-quality-debt');
const { buildPageToneBoard, PAGE_TONE_VERSION } = require('./intel-page-tone');
const {
  detectManipulationSignals,
  applyManipulationToEvidence,
} = require('./intel-anti-manipulation');
const { compileInstrumentRelease, compileResearchRelease, compareToRelease } = require('./intel-research-compile');
const { buildChoiceSet } = require('./intel-choice-set');
const { buildUnknownBoard } = require('./intel-unknown-map');
const {
  buildResonanceBoard,
  attachResonanceToInstruments,
  enrichQuestionQueueWithResonance,
} = require('./intel-resonance-board');
const {
  attachMultiHopToInstruments,
  enrichQuestionQueueWithMultiHop,
} = require('./intel-shock-multihop');
const {
  buildIsomorphicBoard,
  attachIsomorphicToInstruments,
  enrichQuestionQueueWithIsomorphic,
} = require('./intel-isomorphic-board');
const {
  buildDualNarrativeBoard,
  attachDualBoardToInstruments,
  enrichQuestionQueueWithDual,
} = require('./intel-dual-board');
const {
  buildFailureMuseumBoard,
  attachMuseumToInstruments,
  enrichQuestionQueueWithMuseum,
  mergeMuseumIntoDebtBoard,
} = require('./intel-failure-museum-board');
const {
  buildContradictionBoard,
  enrichQuestionQueueWithContradiction,
} = require('./intel-contradiction-board');
const { buildFaceComputeBoard } = require('./intel-face-compute-ledger');
const {
  buildEvidenceAuditBoard,
  enrichQuestionQueueWithEvidenceAudit,
} = require('./intel-evidence-audit');

const STRONG_STRUCTURE_CAP = 12;

/**
 * 自信通胀刹车：超额「强结构」强制降为「弱结构」（按 push 分保留 cap）
 */
function enforceConfidenceBrake(instruments, cap = STRONG_STRUCTURE_CAP) {
  const strong = (instruments || [])
    .filter(
      (i) =>
        i.intelCenter?.beliefLevel === '强结构' ||
        i.intelCenter?.primaryClaim?.confidence === '强结构'
    )
    .sort(
      (a, b) => (b.intelCenter?.pushTier?.score ?? 0) - (a.intelCenter?.pushTier?.score ?? 0)
    );

  const downgraded = [];
  if (strong.length <= cap) {
    return {
      active: false,
      strongCount: strong.length,
      strongAfter: strong.length,
      cap,
      downgraded: [],
      note: null,
    };
  }

  for (let i = cap; i < strong.length; i += 1) {
    const inst = strong[i];
    const ic = inst.intelCenter;
    if (!ic) continue;
    if (ic.primaryClaim) {
      ic.primaryClaim = {
        ...ic.primaryClaim,
        confidence: '弱结构',
        confidenceBrakeForced: true,
      };
    }
    ic.beliefLevel = '弱结构';
    ic.confidenceBrakeForced = true;
    if (ic.memo) {
      ic.memo = {
        ...ic.memo,
        note: `${ic.memo.note || ''} · 自信刹车降档`.trim(),
      };
    }
    ic.staffFace = resolveStaffFace(ic);
    downgraded.push({ id: inst.id, name: inst.name });
  }

  return {
    active: true,
    strongCount: strong.length,
    strongAfter: cap,
    cap,
    downgraded,
    note: `自信通胀刹车 · 强结构 ${strong.length}→${cap} · 已降档 ${downgraded.length}`,
  };
}

function enrichContradictionMatrix(inst) {
  const cm = inst?.contradictionMatrix;
  const kernel = inst?.intelligenceKernel;
  const main = kernel?.mainContradiction?.label || cm?.mainContradiction || null;
  const dissent =
    kernel?.dissent?.opposingEvidence?.[0]?.summary ||
    kernel?.dissent?.opposingEvidence?.[0]?.label ||
    cm?.forcedDissent ||
    null;
  if (!cm && !main) return null;
  // 内核有主矛盾但引擎未挂矩阵时建可审计骨架，禁止编造轴侧
  const base = cm || {
    version: 'stub-from-kernel',
    summary: main ? `主矛盾 ${main}` : '轴数据暂无',
    availableAxes: 0,
    conflictCount: 0,
    axes: [],
    cells: [],
    competingHypotheses: [],
    dataSource: 'kernel-stub',
  };
  return {
    ...base,
    mainContradiction: main || '暂无',
    forcedDissent: dissent || '暂无',
    stateKey: kernel?.stateKey || cm?.stateKey || null,
    dataSource: cm ? 'contradiction-matrix+kernel' : 'kernel-stub+contradiction',
  };
}

function evaluateIntelCenter(inst, ctx = {}) {
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const persist = ctx.persist !== false;
  const shift = ctx.shift || resolveShift();
  const depth = ctx.depth || 'deep'; // deep | shallow | silent
  const computeMode = ctx.computeMode || (depth === 'deep' ? 'full' : depth === 'shallow' ? 'lite' : 'skip');

  const analyst = applyAnnotationsToIntel(inst);
  if (analyst.vetoed) {
    return {
      version: ORCHESTRATOR_VERSION,
      available: false,
      reason: 'analyst_veto',
      analyst,
      attention: { depth, computeMode },
      summary: '分析师否决 · 暂停发布',
      dataSource: 'intel-orchestrator',
    };
  }

  // —— 静默：复用旧 intel 或最小体检，不跑红队/惊喜/门禁全链 ——
  if (computeMode === 'skip') {
    const prev = inst.intelCenter;
    if (prev?.primaryClaim?.claimId) {
      const reused = {
        ...prev,
        version: ORCHESTRATOR_VERSION,
        attention: { depth: 'silent', computeMode: 'skip', display: '静默·复用', trueRationing: true },
        summary: prev.summary || '静默监控',
        method: 'attention-skip-reuse',
        _enrichedInstrument: inst,
      };
      reused.staffFace = resolveStaffFace(reused);
      return reused;
    }
    const empty = {
      version: ORCHESTRATOR_VERSION,
      available: false,
      reason: 'attention_silent',
      attention: { depth: 'silent', computeMode: 'skip', display: '静默·无缓存', trueRationing: true },
      summary: '静默 · 暂无命题缓存',
      question: { priority: 'P4', score: 0, question: `${inst.name}：浅静默`, reasons: ['attention_skip'] },
      dataSource: 'intel-orchestrator',
      method: 'attention-skip',
      _enrichedInstrument: inst,
    };
    empty.staffFace = resolveStaffFace(empty);
    return empty;
  }

  // 基差/期限结构 + 内外盘双轨：先附着再派生命题与证据
  let enrichedInst = attachTermBasisToInstrument(inst, asOf);
  enrichedInst = attachDualNarrativeToInstrument(enrichedInst, asOf);

  let claims = buildClaimsFromInstrument(enrichedInst, asOf);
  claims = claims.map((c) => attachIssueIdsToClaim(c, enrichedInst, asOf));
  const claimTree = buildClaimTree(claims);
  const horizonCoordination = resolveHorizonCoordination(claims, enrichedInst);
  let primaryClaim = pickPrimaryClaim(claims);

  // Playbook 切换器（决策树 + 分析师 pin + 过程权）
  let playbook = null;
  try {
    playbook = resolvePlaybookContext(enrichedInst, {
      overrideId: ctx.playbookOverrideId || null,
    });
    if (primaryClaim) {
      primaryClaim = applyPlaybookToClaim(primaryClaim, playbook, asOf);
      claims = claims.map((c) =>
        c.claimId === primaryClaim.claimId ? primaryClaim : applyPlaybookToClaim(c, playbook, asOf)
      );
    }
  } catch (err) {
    playbook = { available: false, error: err.message, dataSource: 'intel-playbook-switcher' };
  }

  // 过程学习乘数（有 n 才改）；playbook 键优先
  try {
    const { lookupProcessMultiplier } = require('./intel-process-learning');
    const stateKey = primaryClaim?.stateKey || enrichedInst?.intelligenceKernel?.stateKey;
    const pbKey = playbook?.activeId && stateKey ? `${stateKey}|${playbook.activeId}` : stateKey;
    let mult = lookupProcessMultiplier(pbKey);
    if (!mult.available && stateKey) mult = lookupProcessMultiplier(stateKey);
    if (mult.available && primaryClaim && mult.multiplier !== 1) {
      primaryClaim = {
        ...primaryClaim,
        processMultiplier: mult.multiplier,
        processLearn: mult,
      };
    }
  } catch {
    // optional
  }

  // 反操纵：人工硬标 + 自动嫌疑扫描 → 新闻证据硬度上限
  let antiManipulation = detectManipulationSignals(enrichedInst, analyst, {
    claim: primaryClaim,
    dualNarrative: enrichedInst.dualNarrative || null,
  });
  if ((antiManipulation.flagged || antiManipulation.softWatch) && primaryClaim) {
    primaryClaim = {
      ...primaryClaim,
      evidenceFor: applyManipulationToEvidence(primaryClaim.evidenceFor, antiManipulation),
      evidenceAgainst: applyManipulationToEvidence(primaryClaim.evidenceAgainst, antiManipulation),
    };
    if (primaryClaim.confidence === '强结构') {
      primaryClaim = { ...primaryClaim, confidence: '弱结构', manipulationDowngraded: true };
    }
    claims = claims.map((c) => (c.claimId === primaryClaim.claimId ? primaryClaim : c));
  }

  // —— 浅监控 lite：命题+双轨+简易定价/问题，跳过红队全量/惊喜经验分位/场景/记忆写盘 ——
  if (computeMode === 'lite') {
    const pricingState = assessPricingState(enrichedInst, primaryClaim);
    let clock = buildFalsificationClock(primaryClaim, enrichedInst, asOf);
    const surprise = {
      version: 'lite',
      composite: Math.min(1, Math.abs(Number(inst.changePct) || 0) / 3),
      bucket: Math.abs(Number(inst.changePct) || 0) >= 2 ? 'high' : 'low',
      nDisplay: 'lite',
      method: 'changePct-proxy',
      dataSource: 'quote',
    };
    const pushTier = applyShiftToPushTier(
      {
        tier: primaryClaim?.status === 'falsified' ? 'watch' : 'silent',
        tierLabel: '浅监控',
        score: Math.min(0.4, Math.abs(Number(inst.changePct) || 0) / 10),
        reasons: ['attention_lite'],
      },
      shift
    );
    const memo = {
      available: Boolean(primaryClaim),
      headline: primaryClaim?.statement?.slice(0, 80) || '浅监控',
      oneLiner: enrichedInst.dualNarrative?.display || primaryClaim?.statement?.slice(0, 60) || '—',
      method: 'lite',
    };
    const question = scoreQuestion({
      ...enrichedInst,
      intelCenter: { primaryClaim, pricingState, clock, surprise, pushTier, dualNarrative: enrichedInst.dualNarrative },
    });
    return {
      version: ORCHESTRATOR_VERSION,
      available: Boolean(primaryClaim),
      primaryClaim,
      claims,
      dualNarrative: enrichedInst.dualNarrative || null,
      playbook,
      analyst,
      antiManipulation,
      claimTree,
      basis: enrichedInst.basis || null,
      horizonCoordination,
      clock,
      pricingState,
      surprise,
      pushTier,
      memo,
      question,
      beliefLevel: primaryClaim?.confidence || '不可判定',
      attention: { depth: 'shallow', computeMode: 'lite', display: '浅监控·lite', trueRationing: true },
      summary: memo.oneLiner,
      dataSource: 'intel-orchestrator',
      method: 'attention-lite',
      shiftId: shift.id,
      _enrichedInstrument: enrichedInst,
      staffFace: resolveStaffFace({
        beliefLevel: primaryClaim?.confidence || '不可判定',
        primaryClaim,
        memo,
        gates: null,
      }),
    };
  }

  const redTeam = evaluateRedTeam(enrichedInst, primaryClaim);
  {
    const ingest = ingestRedTeamDissent(primaryClaim, redTeam, {
      persist,
      instrumentId: enrichedInst?.id || inst?.id,
    });
    primaryClaim = ingest.claim || primaryClaim;
    if (redTeam) {
      redTeam.ingest = {
        ingested: ingest.ingested,
        againstAfter: ingest.againstAfter,
        dissentDebt: ingest.dissentDebt,
        version: ingest.version,
      };
    }
  }
  claims = claims.map((c) => (c.claimId === primaryClaim?.claimId ? primaryClaim : c));

  if (analyst.frozen && primaryClaim) {
    primaryClaim = { ...primaryClaim, status: 'watch', frozenByAnalyst: true };
  }

  // 证伪执行：先建时钟骨架，再对照基线真判，回写命题状态
  let clock = buildFalsificationClock(primaryClaim, enrichedInst, asOf);
  let falsifyEval = null;
  if (primaryClaim && primaryClaim.status !== 'draft') {
    const result = evaluateAndApplyFalsification(primaryClaim, enrichedInst, clock, { asOf, persist });
    primaryClaim = result.claim || primaryClaim;
    falsifyEval = result.evaluation;
    claims = claims.map((c) => (c.claimId === primaryClaim.claimId ? primaryClaim : c));
    if (falsifyEval?.display) {
      clock = {
        ...clock,
        evaluation: falsifyEval,
        aggregate:
          primaryClaim.status === 'falsified'
            ? { level: 'red', label: '已证伪', daysLeft: clock.aggregate?.daysLeft }
            : primaryClaim.status === 'falsifying'
              ? { level: 'yellow', label: '证伪进行中', daysLeft: clock.aggregate?.daysLeft }
              : primaryClaim.status === 'expired'
                ? { level: 'red', label: '已过期', daysLeft: clock.aggregate?.daysLeft }
                : clock.aggregate,
        display: falsifyEval.display,
      };
    }
  }

  // 终态命题不得再当强推送原料
  if (primaryClaim && (primaryClaim.status === 'falsified' || primaryClaim.status === 'expired')) {
    primaryClaim = { ...primaryClaim, publishBlocked: true };
  }

  const pricingState = assessPricingState(enrichedInst, primaryClaim);
  const surprise = computeSurpriseVector(enrichedInst, pricingState);
  const actionability = computeActionability(enrichedInst, primaryClaim, clock, pricingState);
  const scenarioLattice = buildScenarioLattice(enrichedInst, primaryClaim, pricingState, clock);
  const choiceSet = buildChoiceSet(
    enrichedInst,
    primaryClaim,
    pricingState,
    clock,
    scenarioLattice,
    horizonCoordination
  );
  let gates = evaluateAllGates(enrichedInst, primaryClaim, clock, pricingState, {
    analyst,
    antiManipulation,
    dualNarrative: enrichedInst.dualNarrative || null,
  });
  const evidenceFreshness = assessEvidenceFreshness(
    { ...enrichedInst, intelCenter: { primaryClaim } },
    asOf
  );
  gates = applyFreshnessToInterruptGate(
    { intelCenter: { evidenceFreshness } },
    gates
  );
  const evidenceTriad = assessEvidenceTriad(
    { ...enrichedInst, intelCenter: { primaryClaim } },
    asOf
  );
  gates = applyTriadToInterruptGate({ intelCenter: { evidenceTriad } }, gates);
  let pushTier = resolvePushTier(enrichedInst, primaryClaim, surprise, actionability, gates, pricingState);
  pushTier = applyShiftToPushTier(pushTier, shift);
  if (evidenceFreshness?.blocksInterrupt && pushTier.tier === 'interrupt') {
    pushTier = {
      ...pushTier,
      tier: 'watch',
      tierLabel: '关注(证据滞后降档)',
      reasons: [...(pushTier.reasons || []), '证据严重滞后'],
    };
  }
  if (evidenceTriad?.blocksInterrupt && pushTier.tier === 'interrupt') {
    pushTier = {
      ...pushTier,
      tier: 'watch',
      tierLabel: '关注(证据三轴降档)',
      reasons: [...(pushTier.reasons || []), '证据三轴·热软/冷硬'],
    };
  }

  // 证伪进行中 → 至少 watch；已证伪 → interrupt 候选（改口通知）
  if (primaryClaim?.status === 'falsifying' && pushTier.tier === 'silent') {
    pushTier = { ...pushTier, tier: 'watch', tierLabel: '关注(证伪进行中)', reasons: [...(pushTier.reasons || []), '证伪进行中'] };
  }
  if (primaryClaim?.status === 'falsified') {
    pushTier = {
      ...pushTier,
      tier: shift.allowInterrupt ? 'interrupt' : 'watch',
      tierLabel: shift.allowInterrupt ? '打断(命题已证伪)' : '关注(命题已证伪)',
      score: Math.max(pushTier.score || 0, 0.55),
      reasons: [...(pushTier.reasons || []), '命题已证伪·改口'],
    };
  }

  let memo = buildIntelMemo(enrichedInst, primaryClaim, clock, pricingState, scenarioLattice, gates, choiceSet);
  const contradictionMatrix = enrichContradictionMatrix(enrichedInst);
  const canonicalCases = matchCanonicalCases(enrichedInst, { asOf });
  try {
    const { retrieveForMemo, attachRetrievalToMemo } = require('./intel-retrieval');
    const retrieval = retrieveForMemo(enrichedInst, primaryClaim, { canonicalCases });
    memo = attachRetrievalToMemo(memo, retrieval);
  } catch {
    // 检索失败不阻断备忘录
  }
  const { exportMemoUnit } = require('./intel-memo-export');
  const memoExport = exportMemoUnit(
    { ...enrichedInst, intelCenter: { memo, primaryClaim, confidenceBrakeForced: false } },
    { asOf }
  );
  const narrative = assessNarrativeEpidemiology(enrichedInst, asOf);
  const dualNarrative = enrichedInst.dualNarrative || null;

  // 内外分裂 → 置信不得高于「叙事分歧」
  if (dualNarrative?.regime === 'split' && primaryClaim) {
    const conf = primaryClaim.confidence;
    if (conf === '强结构' || conf === '弱结构') {
      primaryClaim = { ...primaryClaim, confidence: '叙事分歧', dualSplit: true };
      claims = claims.map((c) => (c.claimId === primaryClaim.claimId ? primaryClaim : c));
    }
  }

  const question = scoreQuestion({
    ...enrichedInst,
    intelCenter: {
      primaryClaim,
      pricingState,
      clock,
      surprise,
      pushTier,
      gates,
      memo,
      analyst,
      falsifyEval,
      dualNarrative,
      canonicalCases,
      horizonCoordination,
      evidenceFreshness,
      evidenceTriad,
      narrative,
    },
  });

  const memory = processMemoryForInstrument(primaryClaim, enrichedInst, memo, {
    persist,
    skipFalsifyRecord: true,
  });
  const beliefLevel = primaryClaim?.confidence || '不可判定';
  const compileMeta = compileInstrumentRelease(enrichedInst, { version: ORCHESTRATOR_VERSION }, asOf);

  return {
    version: ORCHESTRATOR_VERSION,
    available: Boolean(primaryClaim),
    primaryClaim,
    claims,
    redTeam,
    falsifyEval,
    basis: enrichedInst.basis || null,
    termStructure: enrichedInst.termStructure || null,
    horizonCoordination,
    canonicalCases,
    dualNarrative,
    playbook,
    claimTree,
    narrative,
    analyst,
    antiManipulation,
    clock,
    pricingState,
    surprise,
    actionability,
    scenarioLattice,
    choiceSet,
    evidenceFreshness,
    evidenceTriad,
    gates,
    pushTier,
    memo,
    memoExport,
    retrieval: memo?.retrieval || null,
    contradictionMatrix,
    question,
    memory: { revision: memory.revision, archived: memory.archived },
    beliefLevel,
    unknownMap: memo?.unknownMap || null,
    attention: { depth: 'deep', computeMode: 'full', display: '深算·full', trueRationing: true },
    summary: memo?.oneLiner || kernelSummary(enrichedInst),
    dataSource: 'intel-orchestrator',
    method: 'chief-of-staff-pipeline',
    releaseId: compileMeta.releaseId,
    modelVersions: compileMeta.modelVersions,
    shiftId: shift.id,
    _enrichedInstrument: enrichedInst,
    staffFace: resolveStaffFace({
      beliefLevel,
      primaryClaim,
      memo,
      gates,
    }),
  };
}

function kernelSummary(inst) {
  const k = inst?.intelligenceKernel;
  if (k?.summary) return k.summary;
  return '暂无';
}

function buildIntelCenterPack(instruments, ctx = {}) {
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const globalRegime = ctx.globalRegime || 'neutral';
  const shift = buildShiftContext();

  const cappedRaw = (instruments || []).some((i) => i.intelCenter)
    ? instruments
    : applyIntelCenterToInstruments(instruments, { ...ctx, asOf, persist: ctx.persist, shift });
  const attentionFromApply = cappedRaw._attentionBudget || null;
  const capped = Array.isArray(cappedRaw) ? cappedRaw : instruments;

  const { buildQuestionQueue } = require('./intel-question-queue');
  const { buildShockGraph } = require('./intel-shock-graph');
  const { buildDailyDiff } = require('./intel-daily-diff');
  const { loadFailureMuseum, loadRecentRevisions } = require('./intel-memory');
  const { buildDebtBoard } = require('./intel-debt-board');
  const { computeKpis } = require('./intel-kpi');
  const { buildCanonicalWatchList } = require('./intel-canonical-cases');
  const { buildSectorNarrativeHeatmap } = require('./intel-narrative-epidemiology');
  const { buildWorkbenchSummary } = require('./intel-analyst-workbench');

  let intelligenceCalendar = null;
  try {
    const { buildIntelligenceCalendar, enrichQuestionQueueWithCalendar } = require('./intel-intelligence-calendar');
    intelligenceCalendar = buildIntelligenceCalendar(capped, {
      asOf,
      daysAhead: 14,
      lookbackDays: 12,
      fundamentals: ctx.fundamentals || null,
      newsItems: ctx.newsItems || [],
    });
    // stash enricher for use after queue build
    intelligenceCalendar._enrichQueue = enrichQuestionQueueWithCalendar;
  } catch (err) {
    intelligenceCalendar = {
      version: null,
      available: false,
      display: '情报日历暂不可用',
      error: err.message,
      dataSource: 'intel-intelligence-calendar',
    };
  }

  // 日历临近 → 问题队列抬权（再算一遍 queue）
  if (intelligenceCalendar?.imminent?.length) {
    const boostById = new Map();
    for (const ev of intelligenceCalendar.imminent) {
      const boost = ev.type === 'data_release' ? 28 : ev.type === 'delivery' ? 18 : 12;
      for (const sym of ev.symbols || []) {
        const id = String(sym).toLowerCase();
        const prev = boostById.get(id) || 0;
        if (boost > prev) {
          boostById.set(id, boost);
          boostById.set(`${id}::reason`, `${ev.name}·${ev.intelPhase || '临近'}`);
        }
      }
    }
    for (const inst of capped) {
      const id = String(inst.id || '').toLowerCase();
      const boost = boostById.get(id);
      if (boost && inst.intelCenter) {
        inst.intelCenter.calendarBoost = boost;
        inst.intelCenter.calendarReason = boostById.get(`${id}::reason`) || '情报日历临近';
      }
    }
  }

  const questionQueue = buildQuestionQueue(capped);
  const {
    allocateFromTriage,
    allocateForFaces,
    retriageForFace,
    applyAttentionToInstruments,
    buildAttentionRationBoard,
  } = require('./intel-attention-budget');
  // 优先使用 apply 阶段真配额；禁止用 post-hoc 贴标冒充偷懒
  let attentionBudget =
    attentionFromApply ||
    allocateFromTriage(capped, { asOf, faceId: ctx.faceId || 'decision', deepSlots: ctx.deepSlots, shallowSlots: ctx.shallowSlots });
  const attentionByFace = allocateForFaces(capped, { asOf });
  // 各面孔相对 decision 预算的升档 delta（标签，不重跑全市场）
  const faceRetriage = {};
  for (const faceId of ['decision', 'research', 'execution']) {
    const rt = retriageForFace(capped, faceId, {
      asOf,
      currentBudget: attentionBudget,
    });
    // decision 已是主算面孔，无需补跑；research/execution 对升档真补跑 full
    if (faceId === 'decision') {
      faceRetriage[faceId] = {
        ...rt,
        appliedFull: { appliedCount: 0, display: '主算面孔·无需升档补跑', method: 'face-promote-full' },
        overlays: {},
      };
    } else {
      const applied = applyPromoteFullEvaluations(capped, { ...rt, faceId }, {
        asOf,
        shift,
        persist: false,
        maxPromote: faceId === 'execution' ? 6 : 8,
      });
      const slimOverlays = {};
      for (const [id, ov] of Object.entries(applied.overlays || {})) {
        slimOverlays[id] = slimOverlayForPack(ov);
        // 完整 overlay 挂在内存（供详情面板），pack 只存 slim；完整存 applied.fullOverlays
      }
      faceRetriage[faceId] = {
        ...rt,
        appliedFull: {
          appliedCount: applied.appliedCount,
          display: applied.display,
          method: applied.method,
          promotedIds: applied.promotedIds,
        },
        overlays: slimOverlays,
        fullOverlays: applied.overlays,
      };
    }
  }
  const withAttention = applyAttentionToInstruments(capped, attentionBudget);
  for (let i = 0; i < capped.length; i += 1) {
    if (withAttention[i]?.intelCenter?.attention) {
      capped[i].intelCenter = withAttention[i].intelCenter;
    }
  }

  const faceComputeBoard = buildFaceComputeBoard({
    attentionBudget,
    attentionByFace,
    faceRetriage,
    instruments: capped,
    asOf,
    persist: ctx.persist !== false,
  });
  const attentionRationBoard = buildAttentionRationBoard(attentionBudget, capped, { asOf });

  const shockGraph = buildShockGraph(capped, globalRegime, {
    asOf,
    persist: ctx.persist !== false,
  });
  const shockDynamicsBoard = shockGraph?.dynamics || null;
  const multiHopBoard = shockGraph?.multiHop || null;
  if (multiHopBoard) {
    const withMh = attachMultiHopToInstruments(capped, multiHopBoard);
    for (let i = 0; i < capped.length; i += 1) {
      if (withMh[i]?.intelCenter?.multiHop) {
        capped[i].intelCenter = {
          ...capped[i].intelCenter,
          multiHop: withMh[i].intelCenter.multiHop,
        };
      }
    }
  }
  let resonanceBoard = buildResonanceBoard(shockGraph, capped, { asOf });
  // 共振摘要挂回品种；分化/滞后注入 P3 问题
  const withResonance = attachResonanceToInstruments(capped, resonanceBoard);
  for (let i = 0; i < capped.length; i += 1) {
    if (withResonance[i]?.intelCenter?.resonance) {
      capped[i].intelCenter = {
        ...capped[i].intelCenter,
        resonance: withResonance[i].intelCenter.resonance,
      };
    }
  }
  const {
    buildMechanismBoard,
    enrichQuestionQueueWithMechanism,
  } = require('./intel-mechanism-board');
  const { enrichQuestionQueueWithShockDynamics } = require('./intel-shock-dynamics');
  const mechanismBoard = buildMechanismBoard(shockGraph, capped, { asOf });
  let questionQueueEnriched = enrichQuestionQueueWithResonance(questionQueue, resonanceBoard);
  questionQueueEnriched = enrichQuestionQueueWithMultiHop(questionQueueEnriched, multiHopBoard);
  questionQueueEnriched = enrichQuestionQueueWithMechanism(questionQueueEnriched, mechanismBoard);
  questionQueueEnriched = enrichQuestionQueueWithShockDynamics(questionQueueEnriched, shockDynamicsBoard);
  if (typeof intelligenceCalendar?._enrichQueue === 'function') {
    questionQueueEnriched = intelligenceCalendar._enrichQueue(questionQueueEnriched, intelligenceCalendar);
    delete intelligenceCalendar._enrichQueue;
  }
  const isomorphicBoard = buildIsomorphicBoard(capped, { asOf });
  const withIso = attachIsomorphicToInstruments(capped, isomorphicBoard);
  for (let i = 0; i < capped.length; i += 1) {
    if (withIso[i]?.intelCenter?.isomorphicBoard) {
      capped[i].intelCenter = {
        ...capped[i].intelCenter,
        isomorphicBoard: withIso[i].intelCenter.isomorphicBoard,
      };
    }
  }
  questionQueueEnriched = enrichQuestionQueueWithIsomorphic(questionQueueEnriched, isomorphicBoard);
  const claimSharpnessBoard = buildClaimSharpnessBoard(capped, asOf);
  questionQueueEnriched = enrichQuestionQueueWithClaimSharpness(questionQueueEnriched, claimSharpnessBoard);
  const scenarioLatticeBoard = buildScenarioLatticeBoard(capped, asOf);
  questionQueueEnriched = enrichQuestionQueueWithScenarioLattice(questionQueueEnriched, scenarioLatticeBoard);
  const dualBoard = buildDualNarrativeBoard(capped, { asOf });
  const withDualBoard = attachDualBoardToInstruments(capped, dualBoard);
  for (let i = 0; i < capped.length; i += 1) {
    if (withDualBoard[i]?.intelCenter?.dualBoard) {
      capped[i].intelCenter = {
        ...capped[i].intelCenter,
        dualBoard: withDualBoard[i].intelCenter.dualBoard,
      };
    }
  }
  questionQueueEnriched = enrichQuestionQueueWithDual(questionQueueEnriched, dualBoard);
  // 同构板挂载后回写选择集触发器（evaluate 阶段尚无板）
  for (const inst of capped) {
    const iso = inst.intelCenter?.isomorphicBoard;
    const cs = inst.intelCenter?.choiceSet;
    if (!iso?.preferWatchSignals || !cs || !iso.best?.watchSignals?.length) continue;
    const sig = iso.best.watchSignals.slice(0, 2).join(' / ');
    const optA = (cs.options || []).find((o) => o.id === 'A');
    const optC = (cs.options || []).find((o) => o.id === 'C');
    if (optA && !(optA.enterWhen || []).some((t) => /同构/.test(t))) {
      optA.enterWhen = [...(optA.enterWhen || []), `同构监视兑现：${sig}`];
    }
    if (optC && !(optC.enterWhen || []).some((t) => /同构/.test(t))) {
      optC.enterWhen = [...(optC.enterWhen || []), '同构路径强相似但信号未兑现 · 继续追踪'];
    }
    const trig = (cs.triggerInventory || []).find((t) => t.id === 'isomorphic');
    if (!trig) {
      cs.triggerInventory = [
        ...(cs.triggerInventory || []),
        {
          role: 'structural',
          id: 'isomorphic',
          text: `同构「${iso.best.label}」监视：${sig}`,
          source: 'isomorphic-board',
          available: true,
          nDisplay: iso.best.pathNDisplay || '暂无',
        },
      ];
    }
    cs.isomorphic = {
      label: iso.best.label,
      pathTier: iso.best.pathTier,
      pathNDisplay: iso.best.pathNDisplay,
      watchSignals: iso.best.watchSignals,
    };
    if (!/同构监视/.test(cs.display || '')) {
      cs.display = `${cs.display || '选择集'} · 同构监视`;
    }
  }
  const narrativeContagion = buildNarrativeContagionBoard(capped, asOf);
  questionQueueEnriched = enrichQuestionQueueWithNarrative(questionQueueEnriched, narrativeContagion);
  const evidenceFreshnessBoard = buildEvidenceFreshnessBoard(capped, asOf);
  const evidenceTriadBoard = buildEvidenceTriadBoard(capped, asOf);
  let memoryReplayBoard = null;
  try {
    const { buildMemoryReplayBoard } = require('./intel-memory-replay');
    memoryReplayBoard = buildMemoryReplayBoard(capped, { asOf });
  } catch (err) {
    memoryReplayBoard = {
      available: false,
      display: '记忆回放 · 暂无',
      error: err.message,
      dataSource: 'intel-memory-replay',
    };
  }
  const horizonConflictBoard = buildHorizonConflictBoard(capped);
  questionQueueEnriched = enrichQuestionQueueWithHorizon(questionQueueEnriched, horizonConflictBoard);

  const museumBoard = buildFailureMuseumBoard(capped, { asOf });
  const withMuseum = attachMuseumToInstruments(capped, museumBoard);
  for (let i = 0; i < capped.length; i += 1) {
    if (withMuseum[i]?.intelCenter?.museumReview) {
      capped[i].intelCenter = {
        ...capped[i].intelCenter,
        museumReview: withMuseum[i].intelCenter.museumReview,
      };
    }
  }
  const contradictionBoard = buildContradictionBoard(capped, { asOf });
  questionQueueEnriched = enrichQuestionQueueWithContradiction(questionQueueEnriched, contradictionBoard);
  try {
    const { attachRetrievalToInstruments } = require('./intel-retrieval');
    const withRetrieval = attachRetrievalToInstruments(capped);
    for (let i = 0; i < capped.length; i += 1) {
      if (withRetrieval[i]?.intelCenter?.retrieval) {
        capped[i].intelCenter = {
          ...capped[i].intelCenter,
          retrieval: withRetrieval[i].intelCenter.retrieval,
          memo: withRetrieval[i].intelCenter.memo || capped[i].intelCenter?.memo,
        };
      }
    }
  } catch {
    // ignore
  }
  questionQueueEnriched = enrichQuestionQueueWithMuseum(questionQueueEnriched, museumBoard);

  const evidenceAuditBoard = buildEvidenceAuditBoard(capped, { asOf });
  questionQueueEnriched = enrichQuestionQueueWithEvidenceAudit(questionQueueEnriched, evidenceAuditBoard);

  const redTeamBoard = buildRedTeamBoard(capped, { asOf });
  questionQueueEnriched = enrichQuestionQueueWithRedTeam(questionQueueEnriched, redTeamBoard);

  const playbookBoard = buildPlaybookBoard(capped, {
    asOf,
    persist: ctx.persist !== false,
  });
  questionQueueEnriched = enrichQuestionQueueWithPlaybook(questionQueueEnriched, playbookBoard);

  // 用富集后的队列覆盖（保留原 p0；证据 critical 已在 all/deepQueue）
  let questionQueueFinal = {
    ...questionQueueEnriched,
    p0: questionQueue.p0,
    p0Count: questionQueue.p0Count,
  };

  let debtBoard = buildDebtBoard(capped);
  debtBoard = mergeMuseumIntoDebtBoard(debtBoard, museumBoard);
  try {
    const { attachDebtOpsPlan } = require('./intel-debt-ops');
    debtBoard = attachDebtOpsPlan(debtBoard, { asOf, maxItems: 3 });
    // sync 执行仅经 IPC run-intel-debt-ops；此处只挂计划，避免同步 pack 阻塞
    if (ctx.runDebtOps === true) {
      debtBoard.opsLoop = {
        available: false,
        deferred: true,
        note: '请经 IPC/Hub「执行本周必还」触发，勿在同步 pack 内跑 sync',
        display: '债务运维·请显式执行',
      };
    }
  } catch (err) {
    debtBoard = {
      ...debtBoard,
      opsPlan: { available: false, error: err.message, display: '债务运维计划暂无' },
    };
  }
  const unknownBoard = buildUnknownBoard(capped);

  let processLearning = null;
  let processScorecard = null;
  try {
    const {
      evaluateArchivedClaims,
      loadPlaybookWeights,
      attachProcessReadinessToInstruments,
      buildProcessScorecard,
    } = require('./intel-process-learning');
    processLearning = evaluateArchivedClaims({ horizonDays: 3, limit: 100, persist: ctx.persist !== false });
    processLearning.weights = loadPlaybookWeights();
    processLearning.weightProposal =
      processLearning.weightProposal || require('./intel-process-learning').getPendingWeightProposal();
    const withProc = attachProcessReadinessToInstruments(capped);
    for (let i = 0; i < capped.length; i += 1) {
      if (withProc[i]?.intelCenter?.processReadiness) {
        capped[i].intelCenter = {
          ...capped[i].intelCenter,
          processReadiness: withProc[i].intelCenter.processReadiness,
        };
      }
    }
    processScorecard = buildProcessScorecard(processLearning, capped, processLearning.weights);
    processLearning.scorecard = {
      display: processScorecard.display,
      live: processScorecard.live,
      outcome: {
        directionHit: processScorecard.outcome.directionHit,
        processCorrect: processScorecard.outcome.processCorrect,
        dirWrongProcessRightDisplay: processScorecard.outcome.dirWrongProcessRightDisplay,
        sampleDisplay: processScorecard.outcome.sampleDisplay,
      },
      weightProposal: processScorecard.weightProposal,
    };
  } catch (err) {
    processLearning = { available: false, error: err.message, dataSource: 'intel-process-learning' };
    processScorecard = { available: false, error: err.message };
  }

  // 自信刹车先于日差快照，确保 brakeForced 可被物质变更捕获
  const confidenceBrake = enforceConfidenceBrake(capped, STRONG_STRUCTURE_CAP);

  const dailyDiff = buildDailyDiff(capped, {
    date: asOf,
    persist: ctx.persist !== false,
    packMeta: {
      brakeActive: Boolean(confidenceBrake.active),
      brakeDowngraded: confidenceBrake.downgraded?.length || 0,
    },
  });

  const kpis = computeKpis(capped, {
    dailyDiff,
    quietDay: questionQueueFinal.quietDay,
    processScorecard,
    processLearning,
  });
  const canonicalWatch = buildCanonicalWatchList(capped, { asOf });
  const narrativeHeatmap = buildSectorNarrativeHeatmap(capped);
  const workbench = buildWorkbenchSummary(capped);
  const dualSplitCount = capped.filter((i) => i.intelCenter?.dualNarrative?.regime === 'split').length;

  let interruptChannel = null;

  // 刹车后重算 top5 / interrupt（降档可能影响门禁展示字段）
  const top5AfterBrake = capped
    .filter((i) => i.intelCenter?.gates?.top5?.pass && !i.intelCenter?.analyst?.vetoed)
    .sort((a, b) => (b.intelCenter?.pushTier?.score ?? 0) - (a.intelCenter?.pushTier?.score ?? 0))
    .slice(0, 5);
  const interruptsAfterBrake = capped
    .filter((i) => i.intelCenter?.pushTier?.tier === 'interrupt' && !i.intelCenter?.analyst?.frozen)
    .slice(0, 3)
    .map((i) => {
      const gatePass = i.intelCenter?.gates?.interrupt?.pass === true;
      const blocked = i.intelCenter?.antiManipulation?.flagged || i.intelCenter?.analyst?.vetoed;
      const push = i.intelCenter?.pushTier;
      const surprise = i.intelCenter?.surprise;
      return {
        id: i.id,
        name: i.name,
        claimId: i.intelCenter?.primaryClaim?.claimId,
        headline: i.intelCenter?.memo?.headline || i.intelCenter?.primaryClaim?.statement,
        redTeam: i.intelCenter?.redTeam?.display,
        score: push?.score ?? null,
        scoreDisplay: push?.scoreDisplay || (push?.score != null ? String(push.score) : '暂无'),
        surpriseN: push?.surpriseN ?? surprise?.n ?? null,
        surpriseNDisplay:
          push?.surpriseNDisplay || surprise?.nDisplay || (surprise?.n != null ? String(surprise.n) : '暂无'),
        nGate: 20,
        nGateMet:
          (push?.surpriseN ?? surprise?.n) != null && (push?.surpriseN ?? surprise?.n) >= 20,
        nGateDisplay: (() => {
          const sn = push?.surpriseN ?? surprise?.n;
          if (sn == null) return 'n=暂无·门槛≥20';
          return sn >= 20 ? `n=${sn}≥20` : `n=${sn}<20`;
        })(),
        interruptReason: push?.interruptReason || (push?.reasons || [])[0] || null,
        reasons: (push?.reasons || []).slice(0, 3),
        falsified: i.intelCenter?.primaryClaim?.status === 'falsified',
        beliefLevel: i.intelCenter?.beliefLevel || null,
        claimStatus: i.intelCenter?.primaryClaim?.status || null,
        gatePass,
        lifecycle: blocked ? 'blocked' : gatePass ? 'eligible' : 'blocked',
        blockedReasons: i.intelCenter?.gates?.interrupt?.blockedReasons || [],
      };
    });

  const {
    buildQuietBrakeBoard,
    enrichQuestionQueueWithQuietBrake,
  } = require('./intel-quiet-brake-board');
  const quietBrakeBoard = buildQuietBrakeBoard({
    dailyDiff,
    confidenceBrake,
    interrupts: interruptsAfterBrake,
    asOf,
    persist: ctx.persist !== false,
  });
  questionQueueFinal = enrichQuestionQueueWithQuietBrake(questionQueueFinal, quietBrakeBoard);
  // 保留假静默开环 P0，再合并原 P0
  {
    const fqP0 = (questionQueueFinal.p0 || []).filter((q) => q.falseQuietLoop);
    const baseP0 = questionQueue.p0 || [];
    const merged = [...fqP0, ...baseP0.filter((q) => !q.falseQuietLoop)].slice(0, 5);
    questionQueueFinal = {
      ...questionQueueFinal,
      p0: merged,
      p0Count: merged.length,
    };
  }

  const {
    buildExternalBriefBoard,
    enrichQuestionQueueWithMemoExport,
  } = require('./intel-memo-export');
  const {
    buildAnalystJournalBoard,
    enrichQuestionQueueWithAnalystJournal,
  } = require('./intel-analyst-journal-board');
  const externalBriefBoard = buildExternalBriefBoard(capped, { asOf, limit: 8 });
  questionQueueFinal = enrichQuestionQueueWithMemoExport(questionQueueFinal, externalBriefBoard);
  const analystJournalBoard = buildAnalystJournalBoard(capped, { asOf });
  questionQueueFinal = enrichQuestionQueueWithAnalystJournal(questionQueueFinal, analystJournalBoard);

  const {
    buildPricingClockBoard,
    enrichQuestionQueueWithPricingClock,
  } = require('./intel-pricing-clock-board');
  const pricingClockBoard = buildPricingClockBoard(capped, { asOf });
  questionQueueFinal = enrichQuestionQueueWithPricingClock(questionQueueFinal, pricingClockBoard);
  questionQueueFinal = {
    ...questionQueueFinal,
    p0: questionQueue.p0,
    p0Count: questionQueue.p0Count,
  };

  try {
    const { syncInterruptChannel, DAILY_INTERRUPT_CAP } = require('./intel-interrupt-channel');
    // 班次禁止时仍传入候选，通道内记 shift_denied + 不投递
    interruptChannel = syncInterruptChannel(interruptsAfterBrake, {
      asOf,
      shiftId: shift?.id,
      shift,
      maxDaily: shift?.allowInterrupt === false ? 0 : DAILY_INTERRUPT_CAP || 3,
    });
  } catch (err) {
    interruptChannel = { available: false, error: err.message };
  }

  let metaIntelligence = null;
  try {
    const {
      buildMetaIntelligenceBoard,
      enrichQuestionQueueWithMeta,
      mergeMetaBridgeIntoDebtBoard,
    } = require('./intel-meta-intelligence');
    const { attachDebtOpsPlan } = require('./intel-debt-ops');
    metaIntelligence = buildMetaIntelligenceBoard(capped, {
      asOf,
      debtBoard,
      unknownBoard,
      museumBoard,
      mechanismBoard,
      shockGraph,
      evidenceAuditBoard,
      processLearning,
      processScorecard,
      kpis,
      attentionBudget,
      attentionRationBoard,
      interruptChannel,
      shift,
      interruptCandidates: interruptsAfterBrake.length,
      quietBrakeBoard,
    });
    // 元智能盲区注入 mustPay → 再挂 ops 计划
    if (debtBoard && metaIntelligence?.debtBridge?.unlinkedCount) {
      debtBoard = mergeMetaBridgeIntoDebtBoard(debtBoard, metaIntelligence, asOf);
      debtBoard = attachDebtOpsPlan(debtBoard, { asOf, maxItems: 3 });
      metaIntelligence = buildMetaIntelligenceBoard(capped, {
        asOf,
        debtBoard,
        unknownBoard,
        museumBoard,
        mechanismBoard,
        shockGraph,
        evidenceAuditBoard,
        processLearning,
        processScorecard,
        kpis,
        attentionBudget,
        attentionRationBoard,
        interruptChannel,
        shift,
        interruptCandidates: interruptsAfterBrake.length,
        quietBrakeBoard,
      });
    }
    questionQueueFinal = enrichQuestionQueueWithMeta(questionQueueFinal, metaIntelligence);
    {
      const fqP0 = (questionQueueFinal.p0 || []).filter((q) => q.falseQuietLoop);
      const baseP0 = questionQueueFinal.p0?.length
        ? questionQueueFinal.p0.filter((q) => !q.falseQuietLoop)
        : questionQueue.p0 || [];
      const merged = [...fqP0, ...baseP0].slice(0, 5);
      questionQueueFinal = {
        ...questionQueueFinal,
        p0: merged,
        p0Count: merged.length,
      };
    }
  } catch (err) {
    metaIntelligence = {
      available: false,
      error: err.message,
      display: '元智能暂无',
      dataSource: 'intel-meta-intelligence',
    };
  }

  let antiManipulationBoard = null;
  try {
    const {
      buildAntiManipulationBoard,
      enrichQuestionQueueWithAntiManip,
    } = require('./intel-anti-manipulation');
    antiManipulationBoard = buildAntiManipulationBoard(capped, { asOf });
    questionQueueFinal = enrichQuestionQueueWithAntiManip(questionQueueFinal, antiManipulationBoard);
    questionQueueFinal = {
      ...questionQueueFinal,
      p0: questionQueue.p0,
      p0Count: questionQueue.p0Count,
    };
  } catch (err) {
    antiManipulationBoard = {
      available: false,
      error: err.message,
      display: '反操纵板暂无',
      dataSource: 'intel-anti-manipulation',
    };
  }

  let antiPatternBoard = null;
  try {
    antiPatternBoard = buildAntiPatternBoard(
      {
        evidenceAuditBoard,
        mechanismBoard,
        antiManipulationBoard,
        narrativeContagion,
        claimSharpnessBoard,
        museumBoard,
        asOf,
      },
      capped,
      { asOf }
    );
    questionQueueFinal = enrichQuestionQueueWithAntiPattern(questionQueueFinal, antiPatternBoard);
  } catch (err) {
    antiPatternBoard = {
      available: false,
      error: err.message,
      display: '反模式板暂无',
      dataSource: 'intel-anti-pattern-board',
    };
  }

  const llmBoundaryBoard = buildLlmBoundaryBoard(null, { asOf });
  let qualityDebtBoard = null;
  try {
    qualityDebtBoard = buildPredictionQualityDebtBoard(
      { processLearning, processScorecard, kpis, asOf },
      { asOf }
    );
  } catch (err) {
    qualityDebtBoard = {
      available: false,
      improvementClaim: false,
      error: err.message,
      display: '质量债 暂无',
      dataSource: 'intel-prediction-quality-debt',
    };
  }

  const teaching = buildTeachingPack({
    processLearning,
    processScorecard,
    resonanceBoard,
    unknownBoard,
    narrativeContagion,
    evidenceFreshnessBoard,
    evidenceTriadBoard,
    memoryReplayBoard,
    calendarImminent: (intelligenceCalendar?.imminentCount || 0) > 0,
    calendarFollow: intelligenceCalendar?.followCount || 0,
    shockActive: shockGraph?.activeCount || 0,
    multiHopBoard,
    shockDynamicsBoard,
    mechanismBoard,
    isomorphicBoard,
    dualBoard,
    museumBoard,
    contradictionBoard,
    horizonConflictBoard,
    debtBoard,
    claim: {
      n: processLearning?.sampleN ?? null,
      status: null,
      confidence: null,
    },
    interruptChannel,
    shift,
    faceComputeBoard,
    attentionRationBoard,
    evidenceAuditBoard,
    redTeamBoard,
    playbookBoard,
    quietBrakeBoard,
    dailyDiff,
    externalBriefBoard,
    analystJournalBoard,
    pricingClockBoard,
    kpis,
    metaIntelligence,
    antiManipulationBoard,
    claimSharpnessBoard,
    scenarioLatticeBoard,
    antiPatternBoard,
    llmBoundaryBoard,
    qualityDebtBoard,
  });

  const issueBoard = buildIssueBoard(capped, { limit: 40 });
  const shiftDiscipline = buildShiftDisciplineBoard(shift, {
    interrupts: interruptsAfterBrake,
    teaching,
    _preShiftInterruptCount: interruptsAfterBrake.length,
  });

  let pack = {
    version: ORCHESTRATOR_VERSION,
    asOf,
    shift: {
      ...shift,
      version: shift.version || 'v2.64.0-shift-contract',
      display: `当前班次 · ${shift.label} · ${shift.tone} · 契约 ${shift.deliveryContract}`,
      dataSource: 'intel-shift-schedule',
    },
    faceContracts: {
      version: FACE_CONTRACT_VERSION,
      faces: listFaceContracts(),
      note: '三面孔独立交付投影（allowlist+brief）；非 CSS hidden；配额见 attentionByFace',
    },
    questionQueue: questionQueueFinal,
    attentionBudget,
    attentionByFace,
    faceRetriage,
    faceComputeBoard,
    attentionRationBoard,
    evidenceAuditBoard,
    redTeamBoard,
    shockGraph,
    multiHopBoard,
    shockDynamicsBoard,
    mechanismBoard,
    isomorphicBoard,
    dualBoard,
    museumBoard,
    contradictionBoard,
    resonanceBoard,
    narrativeContagion,
    evidenceFreshnessBoard,
    evidenceTriadBoard,
    memoryReplayBoard,
    horizonConflictBoard,
    dailyDiff,
    debtBoard,
    unknownBoard,
    metaIntelligence,
    antiManipulationBoard,
    antiPatternBoard,
    llmBoundaryBoard,
    qualityDebtBoard,
    kpis,
    canonicalWatch,
    narrativeHeatmap,
    workbench,
    dualSplitCount,
    intelligenceCalendar,
    processLearning,
    processScorecard,
    interruptChannel,
    shiftDiscipline,
    teaching,
    playbookBoard,
    quietBrakeBoard,
    externalBriefBoard,
    analystJournalBoard,
    pricingClockBoard,
    issueBoard,
    claimSharpnessBoard,
    scenarioLatticeBoard,
    top5Candidates: top5AfterBrake.map((i) => ({
      id: i.id,
      name: i.name,
      claimId: i.intelCenter?.primaryClaim?.claimId,
      headline: i.intelCenter?.memo?.headline,
      pushTier: i.intelCenter?.pushTier?.tier,
      beliefLevel: i.intelCenter?.beliefLevel,
    })),
    interrupts: interruptsAfterBrake.map((i) => ({
      id: i.id,
      name: i.name,
      headline: i.headline,
      score: i.score,
      scoreDisplay: i.scoreDisplay,
      surpriseN: i.surpriseN,
      surpriseNDisplay: i.surpriseNDisplay,
      interruptReason: i.interruptReason,
      reasons: i.reasons,
      redTeam: i.redTeam,
      beliefLevel: i.beliefLevel,
      claimStatus: i.claimStatus,
      lifecycle: i.lifecycle,
      gatePass: i.gatePass,
      blockedReasons: i.blockedReasons,
    })),
    failureMuseumRecent: loadFailureMuseum(10),
    revisionsRecent: loadRecentRevisions(10),
    quietDay: Boolean(quietBrakeBoard?.quietDay),
    quietReason: quietBrakeBoard?.quietReason || null,
    confidenceBrake,
    stats: {
      instrumentCount: capped.length,
      activeClaims: capped.filter((i) =>
        ['active', 'watch', 'falsifying'].includes(i.intelCenter?.primaryClaim?.status)
      ).length,
      activeStrict: capped.filter((i) => i.intelCenter?.primaryClaim?.status === 'active').length,
      falsifying: capped.filter((i) => i.intelCenter?.primaryClaim?.status === 'falsifying').length,
      falsified: capped.filter((i) => i.intelCenter?.primaryClaim?.status === 'falsified').length,
      expired: capped.filter((i) => i.intelCenter?.primaryClaim?.status === 'expired').length,
      mispriced: capped.filter((i) => i.intelCenter?.pricingState?.state === 'mispriced').length,
      interruptEligible: interruptsAfterBrake.length,
      p0: questionQueueFinal.p0Count,
      dualSplit: dualSplitCount,
      dualBoardSplit: dualBoard?.counts?.split || 0,
      resonanceDiverge: resonanceBoard?.counts?.diverge || 0,
      resonanceLagging: resonanceBoard?.counts?.lagging || 0,
      narrativeAhead: narrativeContagion?.counts?.ahead || 0,
      evidenceStale: evidenceFreshnessBoard?.staleInstrumentCount || 0,
      evidenceTriadHotSoft: evidenceTriadBoard?.counts?.hotSoft || 0,
      evidenceTriadColdHard: evidenceTriadBoard?.counts?.coldHard || 0,
      evidenceTriadBlock: evidenceTriadBoard?.blockingCount || 0,
      memoryLibraryN: memoryReplayBoard?.libraryN ?? null,
      memoryReplayTimelines: memoryReplayBoard?.sampleTimelines?.length || 0,
      horizonConflicts: horizonConflictBoard?.counts?.conflict || 0,
      multiHopLive: multiHopBoard?.counts?.live || 0,
      multiHopTotal: multiHopBoard?.counts?.total || 0,
      multiHopLagging: multiHopBoard?.counts?.lagging || 0,
      shockDynAwaiting: shockDynamicsBoard?.counts?.awaiting || 0,
      shockDynHit: shockDynamicsBoard?.transmissionHit?.display || null,
      shockDynWatch: shockDynamicsBoard?.counts?.watchSources || 0,
      isomorphicStrong: isomorphicBoard?.counts?.strong || 0,
      isomorphicWatching: isomorphicBoard?.counts?.watching || 0,
      isomorphicPathReplays: isomorphicBoard?.counts?.pathReplays || 0,
      shockDynEdgeVerify: shockDynamicsBoard?.counts?.edgeVerifyReady || 0,
      calendarFollow: intelligenceCalendar?.followCount || 0,
      deepAttention: attentionBudget.deepCount,
      fullCompute: capped.filter((i) => i.intelCenter?.attention?.computeMode === 'full').length,
      liteCompute: capped.filter((i) => i.intelCenter?.attention?.computeMode === 'lite').length,
      skipCompute: capped.filter((i) => i.intelCenter?.attention?.computeMode === 'skip').length,
      attentionWake: attentionBudget.wakeCount || 0,
      attentionSavingsPct: attentionRationBoard?.savingsPct ?? null,
      attentionRationOk: attentionRationBoard?.integrityOk !== false,
      processScore: processLearning?.processCorrect || kpis.processCorrectness?.score,
      processReady: processScorecard?.live?.readyDisplay || null,
      debtTotal: debtBoard.totalDebts,
      metaBlindSpots: metaIntelligence?.counts?.total || 0,
      metaCritical: metaIntelligence?.counts?.critical || 0,
      metaSeverity: metaIntelligence?.severity || null,
      museumEntries: museumBoard?.counts?.entries || 0,
      museumWarnings: museumBoard?.counts?.activeWarnings || 0,
      museumTodayIntake: museumBoard?.counts?.todayIntake ?? museumBoard?.todayIntake?.todayN ?? 0,
      contradictionInstruments: contradictionBoard?.counts?.instruments || 0,
      contradictionConflicts: contradictionBoard?.counts?.withConflict || 0,
      contradictionMissingOppose: contradictionBoard?.counts?.missingOppose || 0,
      interruptPending: interruptChannel?.pendingCount || 0,
      interruptDelivered: interruptChannel?.notifiedToday || 0,
      shiftDeniedInterrupts: interruptChannel?.shiftDeniedCount || 0,
      shiftId: shift?.id || null,
      faceComputeIntegrity: faceComputeBoard?.integrityOk !== false,
      evidenceProblems: evidenceAuditBoard?.counts?.problemInstruments || 0,
      evidenceCritical: evidenceAuditBoard?.counts?.critical || 0,
      evidenceMissingAgainst: evidenceAuditBoard?.counts?.missingAgainst || 0,
      redTeamDebt: redTeamBoard?.counts?.dissentDebt || 0,
      redTeamIngested: redTeamBoard?.counts?.ingestedTotal || 0,
      playbookTransitions: playbookBoard?.transitionCount || 0,
      unknownGaps: unknownBoard.totalGaps,
      unknownCriticalInstruments: unknownBoard.criticalInstrumentCount,
      strongStructure: confidenceBrake.strongAfter ?? confidenceBrake.strongCount,
      confidenceBrakeDowngraded: confidenceBrake.downgraded?.length || 0,
      quietStreak: quietBrakeBoard?.quietStreak?.streak ?? null,
      materialChanges: dailyDiff?.materialChanges ?? null,
      memoPublishable: externalBriefBoard?.counts?.publishable || 0,
      memoInternalOnly: externalBriefBoard?.counts?.internalOnly || 0,
      analystJournalToday: analystJournalBoard?.counts?.today || 0,
      analystLiveFrozen: analystJournalBoard?.counts?.liveFrozen || 0,
      analystLiveVetoed: analystJournalBoard?.counts?.liveVetoed || 0,
      mechanismLiveActive: mechanismBoard?.counts?.liveActive ?? mechanismBoard?.counts?.live ?? 0,
      mechanismEmpiricalReady: mechanismBoard?.counts?.empiricalReady || 0,
      mechanismPendingInsufficientN: mechanismBoard?.counts?.pendingInsufficientN || 0,
      // 兼容旧字段：live=活激活；pending=休眠+n不足
      mechanismLive: mechanismBoard?.counts?.liveActive ?? mechanismBoard?.counts?.live ?? 0,
      mechanismPending: mechanismBoard?.counts?.pending || 0,
      mechanismThinClaims: mechanismBoard?.counts?.thinClaims || 0,
      mechanismHonestyDenied: mechanismBoard?.counts?.honestyDenied || shockGraph?.mechanismHonestyDenied || 0,
      falseQuietRisk: Boolean(quietBrakeBoard?.falseQuietRisk),
      falseQuietLoopStatus: quietBrakeBoard?.falseQuietLoop?.status || null,
      metaOpsRunnable: metaIntelligence?.debtBridge?.pendingRunnable ?? 0,
      metaOpsUnlinked: metaIntelligence?.debtBridge?.unlinkedCount ?? 0,
      staffCommand: capped.filter((i) => i.intelCenter?.staffFace?.mode === 'command').length,
      staffBrief: capped.filter((i) => i.intelCenter?.staffFace?.mode === 'brief').length,
      staffObserve: capped.filter((i) => i.intelCenter?.staffFace?.mode === 'observe').length,
      weightProposalPending: processScorecard?.weightProposal?.pendingApproval ? 1 : 0,
      analystWeightSignals: processScorecard?.weightProposal?.analystContribution?.signalN ?? 0,
      analystWeightMaterial: processScorecard?.weightProposal?.analystContribution?.materialWithAnalyst ?? 0,
      pricingMispriced: pricingClockBoard?.counts?.mispriced || 0,
      clockDue: pricingClockBoard?.counts?.clockDue || 0,
      clockExpired: pricingClockBoard?.counts?.clockExpired || 0,
      playbookSwitched: playbookBoard.switchedCount || 0,
      playbookRegimePacks: playbookBoard.withRegimePack || 0,
      playbookRegimeFlips: playbookBoard.regimeFlipCount || 0,
      issuesOpen: issueBoard.openCount || 0,
      issuesFalsifying: issueBoard.falsifyingCount || 0,
      claimSharp: claimSharpnessBoard?.counts?.sharp || 0,
      claimSoft: claimSharpnessBoard?.counts?.soft || 0,
      claimMissingAgainst: claimSharpnessBoard?.counts?.missingAgainst || 0,
      claimEpochBumped: claimSharpnessBoard?.counts?.epochBumped || 0,
      scenarioCalibrated: scenarioLatticeBoard?.counts?.calibrated || 0,
      scenarioScriptedHeavy: scenarioLatticeBoard?.counts?.scriptedHeavy || 0,
      manipulationFlagged: capped.filter((i) => i.intelCenter?.antiManipulation?.flagged).length,
      manipulationWatching: capped.filter(
        (i) =>
          i.intelCenter?.antiManipulation?.softWatch ||
          (i.intelCenter?.antiManipulation?.autoSuspect && !i.intelCenter?.antiManipulation?.flagged)
      ).length,
    },
    dataSource: 'intel-orchestrator-pack',
  };

  // Hub 头部分母：k/N，禁止裸计数掩盖覆盖面
  {
    const N = pack.stats.instrumentCount || 0;
    const den = (k) => (N > 0 ? `${k}/${N}` : k == null ? '暂无' : String(k));
    pack.statsDisplay = {
      instrumentCount: N > 0 ? String(N) : '暂无',
      p0: pack.stats.p0 != null ? String(pack.stats.p0) : '暂无',
      deepAttention: den(pack.stats.deepAttention ?? 0),
      issuesFalsifying: den(pack.stats.issuesFalsifying ?? 0),
      dualSplit: den(pack.stats.dualSplit ?? 0),
      falsifying: den(pack.stats.falsifying ?? 0),
      falsified: den(pack.stats.falsified ?? 0),
      mispriced: den(pack.stats.mispriced ?? 0),
      mechanismLiveActive: String(pack.stats.mechanismLiveActive ?? 0),
      mechanismEmpiricalReady: String(pack.stats.mechanismEmpiricalReady ?? 0),
      mechanismPendingInsufficientN: String(pack.stats.mechanismPendingInsufficientN ?? 0),
      mechanismLine: `活${pack.stats.mechanismLiveActive ?? 0}·休眠${
        pack.stats.mechanismEmpiricalReady ?? 0
      }·n不足${pack.stats.mechanismPendingInsufficientN ?? 0}`,
      falseQuietRisk: pack.stats.falseQuietRisk
        ? pack.stats.falseQuietLoopStatus === 'open'
          ? '假静默开环'
          : pack.stats.falseQuietLoopStatus === 'acknowledged'
            ? '假静默已确认'
            : '假静默风险'
        : null,
      metaOps:
        pack.stats.metaOpsRunnable > 0 ? `元智可还${pack.stats.metaOpsRunnable}` : null,
      staffLine: `可行动${pack.stats.staffCommand ?? 0}·备忘录${pack.stats.staffBrief ?? 0}·观望${
        pack.stats.staffObserve ?? 0
      }`,
      pageToneLine: null, // filled after pageToneBoard
      weightProposalPending: pack.stats.weightProposalPending
        ? '权提案待审'
        : null,
      museumToday:
        pack.stats.museumTodayIntake > 0 ? `今日入馆${pack.stats.museumTodayIntake}` : null,
      analystWeight:
        pack.stats.analystWeightMaterial > 0
          ? `标注权待审${pack.stats.analystWeightMaterial}`
          : pack.stats.analystWeightSignals > 0
            ? `标注权信号${pack.stats.analystWeightSignals}`
            : null,
      metaBlind:
        pack.stats.metaBlindSpots != null
          ? `盲区${pack.stats.metaBlindSpots}·临界${pack.stats.metaCritical ?? 0}${
              pack.stats.metaOpsRunnable ? `·可还${pack.stats.metaOpsRunnable}` : ''
            }`
          : null,
      triadLine:
        pack.stats.evidenceTriadHotSoft != null || pack.stats.evidenceTriadColdHard != null
          ? `三轴热软${pack.stats.evidenceTriadHotSoft ?? 0}·冷硬${pack.stats.evidenceTriadColdHard ?? 0}`
          : null,
      memoryLine:
        pack.stats.memoryLibraryN != null
          ? `记忆库${pack.stats.memoryLibraryN}`
          : null,
      materialChanges:
        pack.stats.materialChanges != null ? String(pack.stats.materialChanges) : '暂无',
    };
  }

  // 教学层补充分母/假静默上下文（stats 已就绪）
  pack.teaching = buildTeachingPack({
    processLearning,
    processScorecard,
    resonanceBoard,
    unknownBoard,
    narrativeContagion,
    evidenceFreshnessBoard,
    evidenceTriadBoard,
    memoryReplayBoard,
    calendarImminent: (intelligenceCalendar?.imminentCount || 0) > 0,
    calendarFollow: intelligenceCalendar?.followCount || 0,
    shockActive: shockGraph?.activeCount || 0,
    multiHopBoard,
    shockDynamicsBoard,
    mechanismBoard,
    isomorphicBoard,
    dualBoard,
    museumBoard,
    contradictionBoard,
    horizonConflictBoard,
    debtBoard,
    claim: {
      n: processLearning?.sampleN ?? null,
      status: null,
      confidence: null,
    },
    interruptChannel,
    shift,
    faceComputeBoard,
    attentionRationBoard,
    evidenceAuditBoard,
    redTeamBoard,
    playbookBoard,
    quietBrakeBoard,
    dailyDiff,
    externalBriefBoard,
    analystJournalBoard,
    pricingClockBoard,
    kpis,
    metaIntelligence,
    antiManipulationBoard,
    claimSharpnessBoard,
    scenarioLatticeBoard,
    antiPatternBoard,
    llmBoundaryBoard,
    qualityDebtBoard,
    stats: pack.stats,
    statsDisplay: pack.statsDisplay,
  });

  // 研究编译挪至 pageTone 之后（完整快照）；此处仅占位
  pack.researchCompile = null;
  pack.releaseId = null;
  pack.modelVersions = null;

  // 班次契约裁剪交付面（同数据不同压缩）+ 文风
  pack = applyShiftDeliveryContract(pack, shift);
  if (pack.shiftContract) {
    pack.shift = {
      ...pack.shift,
      ...pack.shiftContract,
      voiceId: pack.shiftVoice?.voiceId || pack.shiftContract.voiceId,
      voiceLabel: pack.shiftVoice?.voiceLabel || pack.shiftContract.voiceLabel,
      hubLead: pack.shiftVoice?.hubLead || pack.shiftContract.hubLead,
      display: `当前班次 · ${pack.shiftContract.label} · ${pack.shiftContract.tone} · 文风 ${
        pack.shiftVoice?.voiceLabel || pack.shiftContract.voiceLabel || '—'
      } · 契约 ${pack.shiftContract.deliveryContract}`,
    };
  }
  if (pack.statsDisplay && pack.shiftVoice?.hubLead) {
    pack.statsDisplay.shiftVoiceLine = pack.shiftVoice.hubLead;
  }
  if (pack.stats && pack.kpis?.interruptQuality) {
    pack.stats.interruptNOk = pack.kpis.interruptQuality.nOk ?? null;
    pack.stats.interruptNCandidates = pack.kpis.interruptQuality.candidates ?? null;
  }
  if (pack.statsDisplay && pack.kpis?.interruptQuality) {
    pack.statsDisplay.interruptNLine = pack.kpis.interruptQuality.nOkDisplay || null;
  }

  // 三面孔预投影（Hub 切换时用，非纯 CSS hidden）
  const faceViews = {};
  for (const id of ['decision', 'research', 'execution']) {
    const v = applyFaceDeliveryContract(pack, id);
    const faceAttn = attentionByFace?.byFace?.[id] || null;
    const retriage = faceRetriage?.[id] || null;
    faceViews[id] = {
      faceContract: v.faceContract,
      deliveryBrief: v.deliveryBrief || null,
      shellLayout: buildFaceShellLayout(id),
      attentionBudget: faceAttn
        ? {
            display: faceAttn.display,
            deepCount: faceAttn.deepCount,
            shallowCount: faceAttn.shallowCount,
            silentCount: faceAttn.silentCount,
            deep: (faceAttn.deep || []).slice(0, 8),
            faceId: id,
            facePolicy: faceAttn.facePolicy,
          }
        : null,
      faceRetriage: retriage
        ? {
            display: retriage.display,
            promoteCount: retriage.promoteCount,
            demoteCount: retriage.demoteCount,
            promote: (retriage.promote || []).slice(0, 6),
            method: retriage.method,
            note: retriage.note,
            appliedFull: retriage.appliedFull || null,
            overlays: retriage.overlays || {},
          }
        : null,
      faceComputeBoard: pack.faceComputeBoard
        ? {
            display: pack.faceComputeBoard.display,
            integrityOk: pack.faceComputeBoard.integrityOk,
            counts: pack.faceComputeBoard.counts,
            faces: pack.faceComputeBoard.faces
              ? {
                  [id]: pack.faceComputeBoard.faces[id],
                  decision: pack.faceComputeBoard.faces.decision,
                }
              : null,
          }
        : null,
      attentionRationBoard: pack.attentionRationBoard
        ? {
            display: pack.attentionRationBoard.display,
            integrityOk: pack.attentionRationBoard.integrityOk,
            counts: pack.attentionRationBoard.counts,
            savingsDisplay: pack.attentionRationBoard.savingsDisplay,
            wakePromotions: (pack.attentionRationBoard.wakePromotions || []).slice(0, 4),
            deep: (pack.attentionRationBoard.deep || []).slice(0, id === 'research' ? 10 : 6),
            trueRationing: pack.attentionRationBoard.trueRationing,
          }
        : null,
      evidenceAuditBoard: pack.evidenceAuditBoard
        ? {
            display: pack.evidenceAuditBoard.display,
            counts: pack.evidenceAuditBoard.counts,
            top: (pack.evidenceAuditBoard.top || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.evidenceAuditBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
            typesPresent: pack.evidenceAuditBoard.typesPresent,
            typesTotal: pack.evidenceAuditBoard.typesTotal,
          }
        : null,
      antiPatternBoard: pack.antiPatternBoard
        ? id === 'research'
          ? {
              display: pack.antiPatternBoard.display,
              counts: pack.antiPatternBoard.counts,
              catalog: (pack.antiPatternBoard.catalog || []).slice(0, 8),
              hits: (pack.antiPatternBoard.hits || []).slice(0, 12),
              questions: (pack.antiPatternBoard.questions || []).slice(0, 6),
              available: pack.antiPatternBoard.available,
            }
          : id === 'decision'
            ? {
                display: pack.antiPatternBoard.display,
                counts: pack.antiPatternBoard.counts,
                available: pack.antiPatternBoard.available,
                catalog: (pack.antiPatternBoard.catalog || [])
                  .filter((c) => c.severity === 'critical' || c.severity === 'high')
                  .slice(0, 3),
              }
            : null
        : null,
      llmBoundaryBoard: pack.llmBoundaryBoard
        ? {
            display: pack.llmBoundaryBoard.display,
            note: pack.llmBoundaryBoard.note,
            hardSandbox: false,
            outputGate: true,
            counts: pack.llmBoundaryBoard.counts,
          }
        : null,
      qualityDebtBoard: pack.qualityDebtBoard
        ? id === 'research' || id === 'decision'
          ? {
              display: pack.qualityDebtBoard.display,
              honestyNote: pack.qualityDebtBoard.honestyNote,
              improvementClaim: false,
              walkForward: pack.qualityDebtBoard.walkForward,
              archive: pack.qualityDebtBoard.archive,
              sampleDebt: pack.qualityDebtBoard.sampleDebt
                ? {
                    display: pack.qualityDebtBoard.sampleDebt.display,
                    undersampled: (pack.qualityDebtBoard.sampleDebt.undersampled || []).slice(
                      0,
                      id === 'research' ? 8 : 3
                    ),
                    skipped: (pack.qualityDebtBoard.sampleDebt.skipped || []).slice(
                      0,
                      id === 'research' ? 6 : 2
                    ),
                  }
                : null,
              calibrationGaps: pack.qualityDebtBoard.calibrationGaps
                ? {
                    display: pack.qualityDebtBoard.calibrationGaps.display,
                    skippedFine: (pack.qualityDebtBoard.calibrationGaps.skippedFine || []).slice(
                      0,
                      id === 'research' ? 6 : 2
                    ),
                    skippedCoarse: (pack.qualityDebtBoard.calibrationGaps.skippedCoarse || []).slice(
                      0,
                      id === 'research' ? 4 : 2
                    ),
                    meta: pack.qualityDebtBoard.calibrationGaps.meta || null,
                  }
                : null,
              repayment: pack.qualityDebtBoard.repayment
                ? {
                    display: pack.qualityDebtBoard.repayment.display,
                    items: (pack.qualityDebtBoard.repayment.items || []).slice(
                      0,
                      id === 'research' ? 10 : 4
                    ),
                    improvementClaim: false,
                  }
                : null,
              gap: pack.qualityDebtBoard.gap,
              available: pack.qualityDebtBoard.available,
            }
          : null
        : null,
      redTeamBoard: pack.redTeamBoard
        ? {
            display: pack.redTeamBoard.display,
            counts: pack.redTeamBoard.counts,
            top: (pack.redTeamBoard.top || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.redTeamBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
            recentArchive: id === 'research' ? (pack.redTeamBoard.recentArchive || []).slice(0, 6) : [],
          }
        : null,
      questionQueue: v.questionQueue,
      shockGraph: {
        topPaths: v.shockGraph?.topPaths,
        activeCount: v.shockGraph?.activeCount,
        pendingCount: v.shockGraph?.pendingCount ?? pack.shockGraph?.pendingCount,
        pendingEdges: (pack.shockGraph?.pendingEdges || []).slice(0, id === 'research' ? 8 : 3),
        display: v.shockGraph?.display || pack.shockGraph?.display,
        edgeCatalog: pack.shockGraph?.edgeCatalog
          ? {
              display: pack.shockGraph.edgeCatalog.display,
              counts: pack.shockGraph.edgeCatalog.counts,
              topVerified: (pack.shockGraph.edgeCatalog.topVerified || []).slice(
                0,
                id === 'research' ? 6 : 3
              ),
              sampleCatalog: (pack.shockGraph.edgeCatalog.sampleCatalog || []).slice(
                0,
                id === 'research' ? 8 : 4
              ),
            }
          : null,
        dynamics: pack.shockDynamicsBoard
          ? {
              display: pack.shockDynamicsBoard.display,
              counts: pack.shockDynamicsBoard.counts,
              transmissionHit: pack.shockDynamicsBoard.transmissionHit,
              watchOrder: pack.shockDynamicsBoard.watchOrder
                ? {
                    display: pack.shockDynamicsBoard.watchOrder.display,
                    watchlists: (pack.shockDynamicsBoard.watchOrder.watchlists || []).slice(
                      0,
                      id === 'research' ? 4 : 2
                    ),
                  }
                : null,
              awaiting: (pack.shockDynamicsBoard.awaiting || []).slice(0, id === 'research' ? 8 : 4),
              questions: (pack.shockDynamicsBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
            }
          : pack.shockGraph?.dynamics || null,
        multiHop: pack.multiHopBoard
          ? {
              display: pack.multiHopBoard.display,
              counts: pack.multiHopBoard.counts,
              top: (pack.multiHopBoard.top || []).slice(0, id === 'research' ? 8 : 4),
              questions: (pack.multiHopBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
            }
          : null,
      },
      shockDynamicsBoard: pack.shockDynamicsBoard
        ? {
            display: pack.shockDynamicsBoard.display,
            counts: pack.shockDynamicsBoard.counts,
            transmissionHit: pack.shockDynamicsBoard.transmissionHit,
            watchOrder: pack.shockDynamicsBoard.watchOrder
              ? {
                  display: pack.shockDynamicsBoard.watchOrder.display,
                  watchlists: (pack.shockDynamicsBoard.watchOrder.watchlists || []).slice(
                    0,
                    id === 'research' ? 4 : 2
                  ),
                }
              : null,
            awaiting: (pack.shockDynamicsBoard.awaiting || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.shockDynamicsBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      multiHopBoard: pack.multiHopBoard
        ? {
            display: pack.multiHopBoard.display,
            counts: pack.multiHopBoard.counts,
            top: (pack.multiHopBoard.top || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.multiHopBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
            lagging: (pack.multiHopBoard.lagging || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      mechanismBoard: pack.mechanismBoard
        ? {
            display: pack.mechanismBoard.display,
            counts: pack.mechanismBoard.counts,
            buckets: (pack.mechanismBoard.buckets || []).slice(0, 6),
            liveActive: (pack.mechanismBoard.liveActive || pack.mechanismBoard.live || []).slice(
              0,
              id === 'research' ? 10 : 5
            ),
            empiricalReady: (pack.mechanismBoard.empiricalReady || []).slice(
              0,
              id === 'research' ? 8 : 4
            ),
            pendingInsufficientN: (pack.mechanismBoard.pendingInsufficientN || []).slice(
              0,
              id === 'research' ? 8 : 4
            ),
            // 兼容
            live: (pack.mechanismBoard.liveActive || pack.mechanismBoard.live || []).slice(
              0,
              id === 'research' ? 10 : 5
            ),
            pending: (pack.mechanismBoard.pending || []).slice(0, id === 'research' ? 8 : 4),
            thinClaims: (pack.mechanismBoard.thinClaims || []).slice(0, id === 'research' ? 8 : 4),
            sharedChains: pack.mechanismBoard.sharedChains
              ? {
                  display: pack.mechanismBoard.sharedChains.display,
                  counts: pack.mechanismBoard.sharedChains.counts,
                  top: (pack.mechanismBoard.sharedChains.top || []).slice(
                    0,
                    id === 'research' ? 6 : 3
                  ),
                }
              : null,
            questions: (pack.mechanismBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      isomorphicBoard: pack.isomorphicBoard
        ? {
            display: pack.isomorphicBoard.display,
            counts: pack.isomorphicBoard.counts,
            top: (pack.isomorphicBoard.top || []).slice(0, id === 'research' ? 8 : 4),
            strong: (pack.isomorphicBoard.strong || []).slice(0, id === 'research' ? 6 : 3),
            sampleReplays: (pack.isomorphicBoard.sampleReplays || []).slice(
              0,
              id === 'research' ? 8 : 3
            ),
            questions: (pack.isomorphicBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      dualBoard: pack.dualBoard
        ? {
            display: pack.dualBoard.display,
            counts: pack.dualBoard.counts,
            split: (pack.dualBoard.split || []).slice(0, id === 'research' ? 8 : 4),
            top: (pack.dualBoard.top || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.dualBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      museumBoard: pack.museumBoard
        ? {
            display: pack.museumBoard.display,
            counts: pack.museumBoard.counts,
            entries: (pack.museumBoard.entries || []).slice(0, id === 'research' ? 10 : 5),
            activeWarnings: (pack.museumBoard.activeWarnings || []).slice(0, id === 'research' ? 6 : 3),
            lessons: (pack.museumBoard.lessons || []).slice(0, 6),
            weeklyMuseumPay: (pack.museumBoard.weeklyMuseumPay || []).slice(0, 5),
            todayIntake: pack.museumBoard.todayIntake
              ? {
                  display: pack.museumBoard.todayIntake.display,
                  todayN: pack.museumBoard.todayIntake.todayN,
                  nDisplay: pack.museumBoard.todayIntake.nDisplay,
                  rows: (pack.museumBoard.todayIntake.rows || []).slice(0, id === 'research' ? 8 : 4),
                }
              : null,
            questions: (pack.museumBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
            revisions: (pack.museumBoard.revisions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      contradictionBoard: pack.contradictionBoard
        ? {
            display: pack.contradictionBoard.display,
            counts: pack.contradictionBoard.counts,
            rows: (pack.contradictionBoard.rows || []).slice(0, id === 'research' ? 10 : 5),
            questions: (pack.contradictionBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      intelligenceCalendar: pack.intelligenceCalendar
        ? {
            display: pack.intelligenceCalendar.display,
            imminentCount: pack.intelligenceCalendar.imminentCount,
            followCount: pack.intelligenceCalendar.followCount,
            postCount: pack.intelligenceCalendar.postCount,
            imminent: (pack.intelligenceCalendar.imminent || []).slice(0, id === 'research' ? 8 : 4),
            followWatch: (pack.intelligenceCalendar.followWatch || []).slice(0, id === 'research' ? 6 : 3),
            next: pack.intelligenceCalendar.next
              ? {
                  name: pack.intelligenceCalendar.next.name,
                  releaseDate: pack.intelligenceCalendar.next.releaseDate,
                  intelPhase: pack.intelligenceCalendar.next.intelPhase,
                }
              : null,
          }
        : null,
      resonanceBoard: pack.resonanceBoard
        ? {
            display: pack.resonanceBoard.display,
            counts: pack.resonanceBoard.counts,
            top: (pack.resonanceBoard.top || []).slice(0, id === 'research' ? 10 : 5),
            questions: (pack.resonanceBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      narrativeContagion: pack.narrativeContagion
        ? {
            display: pack.narrativeContagion.display,
            counts: pack.narrativeContagion.counts,
            ahead: (pack.narrativeContagion.ahead || []).slice(0, id === 'research' ? 8 : 4),
            clusters: (pack.narrativeContagion.clusters || []).slice(0, id === 'research' ? 6 : 3),
            transmission: pack.narrativeContagion.transmission
              ? {
                  edges: (pack.narrativeContagion.transmission.edges || []).slice(
                    0,
                    id === 'research' ? 10 : 5
                  ),
                  themes: (pack.narrativeContagion.transmission.themes || []).slice(
                    0,
                    id === 'research' ? 6 : 3
                  ),
                  counts: pack.narrativeContagion.transmission.counts,
                  method: pack.narrativeContagion.transmission.method,
                }
              : null,
            compartmentCounts: pack.narrativeContagion.compartmentCounts || null,
            sirCensus: pack.narrativeContagion.sirCensus || null,
            sirCeiling: pack.narrativeContagion.sirCeiling || null,
            sir: pack.narrativeContagion.sir || pack.narrativeContagion.compartmentCounts || null,
            questions: (pack.narrativeContagion.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      evidenceFreshnessBoard: pack.evidenceFreshnessBoard
        ? {
            display: pack.evidenceFreshnessBoard.display,
            blockingCount: pack.evidenceFreshnessBoard.blockingCount,
            rows: (pack.evidenceFreshnessBoard.rows || []).slice(0, id === 'research' ? 8 : 4),
          }
        : null,
      evidenceTriadBoard: pack.evidenceTriadBoard
        ? {
            display: pack.evidenceTriadBoard.display,
            blockingCount: pack.evidenceTriadBoard.blockingCount,
            counts: pack.evidenceTriadBoard.counts,
            rows: (pack.evidenceTriadBoard.rows || []).slice(0, id === 'research' ? 8 : 4),
          }
        : null,
      memoryReplayBoard: pack.memoryReplayBoard
        ? {
            display: pack.memoryReplayBoard.display,
            libraryNDisplay: pack.memoryReplayBoard.libraryNDisplay,
            searchHint: pack.memoryReplayBoard.searchHint,
            sampleTimelines: (pack.memoryReplayBoard.sampleTimelines || []).slice(
              0,
              id === 'research' ? 5 : 2
            ),
            recentRevisions: (pack.memoryReplayBoard.recentRevisions || []).slice(
              0,
              id === 'research' ? 6 : 3
            ),
            recentMuseum: (pack.memoryReplayBoard.recentMuseum || []).slice(0, id === 'research' ? 5 : 2),
          }
        : null,
      horizonConflictBoard: pack.horizonConflictBoard
        ? {
            display: pack.horizonConflictBoard.display,
            counts: pack.horizonConflictBoard.counts,
            conflictRows: (pack.horizonConflictBoard.conflictRows || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.horizonConflictBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      interrupts: v.interrupts,
      failureMuseumRecent: v.failureMuseumRecent,
      revisionsRecent: v.revisionsRecent,
      teaching: v.teaching,
      processLearning: v.processLearning,
      kpis: pack.kpis
        ? {
            display: pack.kpis.display,
            sampleNDisplay: pack.kpis.sampleNDisplay,
            panels: pack.kpis.panels || [],
            directionHit: pack.kpis.directionHit || null,
            processCorrectness: pack.kpis.processCorrectness
              ? {
                  score: pack.kpis.processCorrectness.score,
                  dissentCoverage: pack.kpis.processCorrectness.dissentCoverage,
                  triggerCoverage: pack.kpis.processCorrectness.triggerCoverage,
                  nCoverage: pack.kpis.processCorrectness.nCoverage,
                  surpriseNCoverage: pack.kpis.processCorrectness.surpriseNCoverage,
                }
              : null,
          }
        : null,
      processScorecard: pack.processScorecard
        ? {
            display: pack.processScorecard.display,
            live: pack.processScorecard.live,
            outcome: pack.processScorecard.outcome
              ? {
                  directionHit: pack.processScorecard.outcome.directionHit,
                  processCorrect: pack.processScorecard.outcome.processCorrect,
                  dirWrongProcessRightDisplay: pack.processScorecard.outcome.dirWrongProcessRightDisplay,
                  sampleDisplay: pack.processScorecard.outcome.sampleDisplay,
                  rows: (pack.processScorecard.outcome.rows || []).slice(0, id === 'research' ? 8 : 4),
                }
              : null,
            weightNudges: (pack.processScorecard.weightNudges || []).slice(0, 4),
            weightProposal: pack.processScorecard.weightProposal || null,
            pendingWeightChanges: (pack.processScorecard.pendingWeightChanges || []).slice(0, 8),
            notReady: (pack.processScorecard.notReady || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      playbookBoard: pack.playbookBoard
        ? {
            display: pack.playbookBoard.display,
            withPlaybook: pack.playbookBoard.withPlaybook,
            withRegimePack: pack.playbookBoard.withRegimePack,
            switchedCount: pack.playbookBoard.switchedCount,
            transitionCount: pack.playbookBoard.transitionCount,
            regimeFlipCount: pack.playbookBoard.regimeFlipCount || 0,
            comparedTo: pack.playbookBoard.comparedTo,
            top: (pack.playbookBoard.top || []).slice(0, id === 'research' ? 8 : 4),
            transitions: (pack.playbookBoard.transitions || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.playbookBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
            note: pack.playbookBoard.note,
          }
        : null,
      debtBoard: v.debtBoard,
      unknownBoard: pack.unknownBoard
        ? {
            display: pack.unknownBoard.display,
            totalGaps: pack.unknownBoard.totalGaps,
            criticalInstrumentCount: pack.unknownBoard.criticalInstrumentCount,
            paydown: (pack.unknownBoard.paydown || []).slice(0, id === 'research' ? 8 : 4),
          }
        : null,
      issueBoard: v.issueBoard,
      claimSharpnessBoard: pack.claimSharpnessBoard
        ? {
            display: pack.claimSharpnessBoard.display,
            counts: pack.claimSharpnessBoard.counts,
            rows: (pack.claimSharpnessBoard.rows || []).slice(0, id === 'research' ? 10 : 5),
            questions: (pack.claimSharpnessBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      scenarioLatticeBoard: pack.scenarioLatticeBoard
        ? {
            display: pack.scenarioLatticeBoard.display,
            counts: pack.scenarioLatticeBoard.counts,
            rows: (pack.scenarioLatticeBoard.rows || []).slice(0, id === 'research' ? 8 : 4),
            questions: (pack.scenarioLatticeBoard.questions || []).slice(0, id === 'research' ? 6 : 3),
          }
        : null,
      interruptChannel: pack.interruptChannel
        ? {
            display: pack.interruptChannel.display,
            pendingCount: pack.interruptChannel.pendingCount,
            notifiedToday: pack.interruptChannel.notifiedToday,
            maxDaily: pack.interruptChannel.maxDaily,
            shiftAllowsInterrupt: pack.interruptChannel.shiftAllowsInterrupt,
            shiftDenyReason: pack.interruptChannel.shiftDenyReason,
            shiftDeniedCount: pack.interruptChannel.shiftDeniedCount,
            escalatedCount: pack.interruptChannel.escalatedCount,
            queue: (pack.interruptChannel.queue || []).slice(0, id === 'execution' ? 8 : 4),
            recentDeliveries: (pack.interruptChannel.recentDeliveries || []).slice(0, 4),
            shiftDenied: (pack.interruptChannel.shiftDenied || []).slice(0, 4),
            deliveryNote: pack.interruptChannel.deliveryNote,
            commandDeck: pack.interruptChannel.commandDeck
              ? {
                  active: pack.interruptChannel.commandDeck.active,
                  display: pack.interruptChannel.commandDeck.display,
                  pendingCount: pack.interruptChannel.commandDeck.pendingCount,
                  escalatedCount: pack.interruptChannel.commandDeck.escalatedCount,
                  next: pack.interruptChannel.commandDeck.next,
                  actions: pack.interruptChannel.commandDeck.actions,
                  note: pack.interruptChannel.commandDeck.note,
                }
              : null,
          }
        : null,
      shiftDiscipline: pack.shiftDiscipline
        ? {
            display: pack.shiftDiscipline.display,
            shiftLabel: pack.shiftDiscipline.shiftLabel,
            rules: pack.shiftDiscipline.rules,
            denied: pack.shiftDiscipline.denied,
            violations: pack.shiftDiscipline.violations,
            discipline: pack.shiftDiscipline.discipline,
          }
        : null,
      canonicalWatch: v.canonicalWatch,
      top5Candidates: v.top5Candidates,
      quietDay: v.quietDay,
      quietReason: v.quietReason,
      quietBrakeBoard: pack.quietBrakeBoard
        ? {
            display: pack.quietBrakeBoard.display,
            quietDay: pack.quietBrakeBoard.quietDay,
            quietEligible: pack.quietBrakeBoard.quietEligible,
            quietReason: pack.quietBrakeBoard.quietReason,
            falseQuietRisk: Boolean(pack.quietBrakeBoard.falseQuietRisk),
            falseQuietReasons: pack.quietBrakeBoard.falseQuietReasons || [],
            falseQuietLoop: pack.quietBrakeBoard.falseQuietLoop
              ? {
                  status: pack.quietBrakeBoard.falseQuietLoop.status,
                  statusLabel: pack.quietBrakeBoard.falseQuietLoop.statusLabel,
                  display: pack.quietBrakeBoard.falseQuietLoop.display,
                  canAck: pack.quietBrakeBoard.falseQuietLoop.canAck,
                  checklist: (pack.quietBrakeBoard.falseQuietLoop.checklist || []).slice(0, 4),
                  mustRead: (pack.quietBrakeBoard.falseQuietLoop.mustRead || []).slice(0, 3),
                  commanderOverride: Boolean(pack.quietBrakeBoard.falseQuietLoop.commanderOverride),
                }
              : null,
            materialChanges: pack.quietBrakeBoard.materialChanges,
            materialDisplay: pack.quietBrakeBoard.materialDisplay,
            quietStreak: pack.quietBrakeBoard.quietStreak,
            brake: pack.quietBrakeBoard.brake,
            questions: (pack.quietBrakeBoard.questions || []).slice(0, id === 'decision' ? 6 : 3),
          }
        : null,
      externalBriefBoard: pack.externalBriefBoard
        ? {
            display: pack.externalBriefBoard.display,
            counts: pack.externalBriefBoard.counts,
            top: (pack.externalBriefBoard.top || []).slice(0, id === 'research' ? 8 : 5).map((u) => ({
              instrumentId: u.instrumentId,
              instrumentName: u.instrumentName,
              publishable: u.publishable,
              headline: u.headline,
              oneLiner: u.oneLiner,
              nDisplay: u.nDisplay,
              display: u.display,
              honesty: (u.honesty || []).slice(0, 3),
              // markdown 仅研究面孔带全文，避免 execution 膨胀
              markdown: id === 'research' ? u.markdown : null,
              plain: u.plain,
            })),
            questions: (pack.externalBriefBoard.questions || []).slice(0, 4),
          }
        : null,
      analystJournalBoard: pack.analystJournalBoard
        ? {
            display: pack.analystJournalBoard.display,
            counts: pack.analystJournalBoard.counts,
            today: (pack.analystJournalBoard.today || []).slice(0, id === 'research' ? 10 : 6),
            recent: (pack.analystJournalBoard.recent || []).slice(0, id === 'research' ? 12 : 6),
            liveFrozen: (pack.analystJournalBoard.liveFrozen || []).slice(0, 8),
            liveVetoed: (pack.analystJournalBoard.liveVetoed || []).slice(0, 6),
            questions: (pack.analystJournalBoard.questions || []).slice(0, 6),
          }
        : null,
      pricingClockBoard: pack.pricingClockBoard
        ? {
            display: pack.pricingClockBoard.display,
            counts: pack.pricingClockBoard.counts,
            mispriced: (pack.pricingClockBoard.mispriced || []).slice(0, id === 'execution' ? 10 : 6),
            clockDue: (pack.pricingClockBoard.clockDue || []).slice(0, id === 'execution' ? 10 : 6),
            clockExpired: (pack.pricingClockBoard.clockExpired || []).slice(0, 6),
            unpriced: (pack.pricingClockBoard.unpriced || []).slice(0, 6),
            watchCapped: (pack.pricingClockBoard.watchCapped || []).slice(0, 6),
            questions: (pack.pricingClockBoard.questions || []).slice(0, id === 'execution' ? 8 : 4),
          }
        : null,
      dailyDiff: pack.dailyDiff
        ? {
            available: pack.dailyDiff.available,
            quietDay: pack.dailyDiff.quietDay,
            quietReason: pack.dailyDiff.quietReason,
            materialChanges: pack.dailyDiff.materialChanges,
            summary: pack.dailyDiff.summary,
            prevDate: pack.dailyDiff.prevDate,
            date: pack.dailyDiff.date,
            changes: pack.dailyDiff.changes
              ? {
                  falsified: (pack.dailyDiff.changes.falsified || []).slice(0, 8),
                  claimSwaps: (pack.dailyDiff.changes.claimSwaps || []).slice(0, 6),
                  playbookTransitions: (pack.dailyDiff.changes.playbookTransitions || []).slice(0, 6),
                  pricingFlips: (pack.dailyDiff.changes.pricingFlips || []).slice(0, 6),
                  regimeFlips: (pack.dailyDiff.changes.regimeFlips || []).slice(0, 6),
                  redTeamIngests: (pack.dailyDiff.changes.redTeamIngests || []).slice(0, 6),
                  brakeForced: (pack.dailyDiff.changes.brakeForced || []).slice(0, 6),
                  newGaps: (pack.dailyDiff.changes.newGaps || []).slice(0, 6),
                  upgraded: (pack.dailyDiff.changes.upgraded || []).slice(0, 4),
                  downgraded: (pack.dailyDiff.changes.downgraded || []).slice(0, 4),
                  directionFlips: (pack.dailyDiff.changes.directionFlips || []).slice(0, 6),
                  surpriseTop: (pack.dailyDiff.changes.surpriseTop || []).slice(0, 5),
                }
              : null,
          }
        : null,
      confidenceBrake: pack.confidenceBrake || null,
      researchCompile: pack.researchCompile
        ? {
            releaseId: pack.researchCompile.releaseId,
            display: pack.researchCompile.display,
            previousReleaseId: pack.researchCompile.previousReleaseId,
            vsPrev: pack.researchCompile.vsPrev,
            versionLines: (pack.researchCompile.versionLines || []).slice(0, id === 'research' ? 14 : 6),
            recent: (pack.researchCompile.recent || []).slice(0, id === 'research' ? 5 : 2),
            inputDigestDisplay: pack.researchCompile.inputDigestDisplay,
          }
        : null,
    };
  }
  pack.faceViews = faceViews;
  pack.faceContractBoard = buildFaceContractBoard(faceViews, { asOf });
  pack.commanderWorkbar = buildCommanderWorkbar(pack, { asOf });
  if (faceViews.decision) faceViews.decision.commanderWorkbar = pack.commanderWorkbar;
  pack.pageToneBoard = buildPageToneBoard(capped, { asOf });
  if (pack.stats) {
    pack.stats.faceRailOk = pack.faceContractBoard.contractOk ? 1 : 0;
    pack.stats.faceDecisionP0 = pack.faceContractBoard.faces?.decision?.p0 ?? 0;
    pack.stats.faceExecutionP0 = pack.faceContractBoard.faces?.execution?.p0 ?? 0;
    pack.stats.faceResearchStripped = pack.faceContractBoard.faces?.decision?.stripped ?? 0;
    pack.stats.commanderPending = pack.commanderWorkbar?.totalPending || 0;
    pack.stats.commanderOrders = pack.commanderWorkbar?.orderQueue?.pending || 0;
    pack.stats.shellsDiffer = pack.faceContractBoard?.shellsDiffer ? 1 : 0;
    pack.stats.antiPatternHits = pack.antiPatternBoard?.counts?.hitRows || 0;
    pack.stats.antiPatternCritical = pack.antiPatternBoard?.counts?.critical || 0;
    pack.stats.llmBoundaryReady = pack.llmBoundaryBoard?.outputGate ? 1 : 0;
    pack.stats.qualityDebtHit = pack.qualityDebtBoard?.walkForward?.hitDisplay || null;
    pack.stats.qualityDebtUndersampled = pack.qualityDebtBoard?.sampleDebt?.undersampled?.length || 0;
    pack.stats.qualityDebtRepayActions = pack.qualityDebtBoard?.repayment?.items?.length || 0;
    pack.stats.qualityDebtCalibGaps =
      (pack.qualityDebtBoard?.calibrationGaps?.skippedFine?.length || 0) +
      (pack.qualityDebtBoard?.calibrationGaps?.skippedCoarse?.length || 0);
    pack.stats.edgeCatalogVerified = pack.shockGraph?.edgeCatalog?.counts?.verifiedReady || 0;
    pack.stats.sharedMechChains = pack.mechanismBoard?.counts?.sharedChainsWithN || 0;
    pack.stats.sirCensusAvailable = pack.narrativeContagion?.sirCensus?.available ? 1 : 0;
    pack.stats.pageToneStaff =
      (pack.pageToneBoard.counts?.staffSurface || 0) + (pack.pageToneBoard.counts?.pending || 0);
    pack.stats.pageToneFortuneAux = pack.pageToneBoard.counts?.fortuneAux || 0;
    pack.stats.pageToneArrowHidden = pack.pageToneBoard.counts?.arrowHidden || 0;
  }
  if (pack.statsDisplay && pack.pageToneBoard) {
    pack.statsDisplay.pageToneLine = pack.pageToneBoard.display;
  }
  // 研究编译发行（须在 dailyDiff + 各板之后，方可产品对照）
  pack.researchCompile = compileResearchRelease(pack, capped, {
    asOf,
    orchestratorVersion: ORCHESTRATOR_VERSION,
    persist: ctx.persist !== false,
    scope: 'intel-pack',
    compareReleaseId: ctx.compareReleaseId || null,
  });
  pack.releaseId = pack.researchCompile.releaseId;
  pack.modelVersions = pack.researchCompile.modelVersions;
  pack.releaseProductBoard = pack.researchCompile.productBoard || null;
  if (pack.stats) {
    pack.stats.releaseMaterialN = pack.researchCompile.productPath?.materialN ?? null;
    pack.stats.releaseVersionDelta = pack.researchCompile.vsPrev?.changedCount ?? 0;
    pack.stats.releaseSnapshotSaved = pack.researchCompile.snapshotSaved ? 1 : 0;
  }
  if (pack.statsDisplay) {
    pack.statsDisplay.releaseLine = pack.researchCompile.display || null;
  }
  // 回填 faceViews 编译切片
  for (const id of Object.keys(faceViews || {})) {
    faceViews[id].researchCompile = pack.researchCompile
      ? {
          releaseId: pack.researchCompile.releaseId,
          display: pack.researchCompile.display,
          previousReleaseId: pack.researchCompile.previousReleaseId,
          vsPrev: pack.researchCompile.vsPrev,
          productPath: pack.researchCompile.productPath
            ? {
                headline: pack.researchCompile.productPath.headline,
                mustRead: (pack.researchCompile.productPath.mustRead || []).slice(0, 6),
                materialN: pack.researchCompile.productPath.materialN,
                topLines: (pack.researchCompile.productPath.topLines || []).slice(0, id === 'research' ? 8 : 4),
                available: pack.researchCompile.productPath.available,
              }
            : null,
          versionLines: (pack.researchCompile.versionLines || []).slice(0, id === 'research' ? 14 : 6),
          recent: (pack.researchCompile.recent || []).slice(0, id === 'research' ? 6 : 3),
          productBoard: pack.releaseProductBoard
            ? {
                display: pack.releaseProductBoard.display,
                rollbackCandidates: (pack.releaseProductBoard.rollbackCandidates || []).slice(0, 4),
              }
            : null,
          inputDigestDisplay: pack.researchCompile.inputDigestDisplay,
          compare: pack.researchCompile.compare || null,
        }
      : null;
  }
  pack.faceViews = faceViews;
  // 教学层补三面孔分轨 + 发行对照上下文（须在 faceContractBoard / researchCompile 之后）
  pack.teaching = buildTeachingPack({
    processLearning,
    processScorecard,
    resonanceBoard,
    unknownBoard,
    narrativeContagion,
    evidenceFreshnessBoard,
    evidenceTriadBoard,
    memoryReplayBoard,
    calendarImminent: (intelligenceCalendar?.imminentCount || 0) > 0,
    calendarFollow: intelligenceCalendar?.followCount || 0,
    shockActive: shockGraph?.activeCount || 0,
    multiHopBoard,
    shockDynamicsBoard,
    mechanismBoard,
    isomorphicBoard,
    dualBoard,
    museumBoard,
    contradictionBoard,
    horizonConflictBoard,
    debtBoard,
    claim: { n: processLearning?.sampleN ?? null, status: null, confidence: null },
    interruptChannel,
    shift,
    faceComputeBoard,
    attentionRationBoard,
    evidenceAuditBoard,
    redTeamBoard,
    playbookBoard,
    quietBrakeBoard,
    dailyDiff,
    externalBriefBoard,
    analystJournalBoard,
    pricingClockBoard,
    kpis,
    metaIntelligence,
    antiManipulationBoard,
    claimSharpnessBoard,
    scenarioLatticeBoard,
    antiPatternBoard,
    llmBoundaryBoard: pack.llmBoundaryBoard,
    qualityDebtBoard: pack.qualityDebtBoard,
    commanderWorkbar: pack.commanderWorkbar,
    faceContractBoard: pack.faceContractBoard,
    faceViews,
    pageToneBoard: pack.pageToneBoard,
    researchCompile: pack.researchCompile,
    releaseProductBoard: pack.releaseProductBoard,
    shiftVoice: pack.shiftVoice,
    shiftDiscipline: pack.shiftDiscipline,
    evidenceTriadBoard: pack.evidenceTriadBoard,
    memoryReplayBoard: pack.memoryReplayBoard,
    stats: pack.stats,
    statsDisplay: pack.statsDisplay,
  });
  // 班次教学配额：最终教学重建后再次裁剪
  if (shift?.maxTeaching != null && pack.teaching?.lessons) {
    const { prioritizeTeachingLessons } = require('./intel-shift-schedule');
    const before = pack.teaching.lessons.length;
    const maxTeach = shift.maxTeaching;
    pack.teaching = {
      ...pack.teaching,
      lessons: prioritizeTeachingLessons(pack.teaching.lessons, maxTeach),
      truncatedByShift: before > maxTeach,
    };
  }
  // 升档补跑摘要（slim）；完整 overlay 不落盘，避免 pack 膨胀
  pack.facePromoteFull = {
    research: {
      appliedFull: faceRetriage.research?.appliedFull || null,
      overlays: faceRetriage.research?.overlays || {},
      promotedIds: faceRetriage.research?.appliedFull?.promotedIds || [],
    },
    execution: {
      appliedFull: faceRetriage.execution?.appliedFull || null,
      overlays: faceRetriage.execution?.overlays || {},
      promotedIds: faceRetriage.execution?.appliedFull?.promotedIds || [],
    },
    method: 'face-promote-full',
    note: '仅对升档品种补跑 full，非三遍全市场',
  };
  // 运行时完整 overlay（hydrate/IPC 内存用；序列化前可删）
  if (ctx.keepFullOverlays !== false) {
    pack._faceFullOverlays = {
      research: faceRetriage.research?.fullOverlays || {},
      execution: faceRetriage.execution?.fullOverlays || {},
    };
  }
  return pack;
}

/**
 * 面孔升档：对 promote 列表真补跑 full（默认最多 6），其余仍复用。
 * 禁止宣称三遍全市场深算。
 */
function applyPromoteFullEvaluations(instruments, retriage, ctx = {}) {
  const faceId = retriage?.faceId || ctx.faceId || 'execution';
  const maxPromote = Math.max(1, Math.min(8, ctx.maxPromote ?? 6));
  const promoteList = (retriage?.promote || []).slice(0, maxPromote);
  if (!promoteList.length) {
    return {
      faceId,
      appliedCount: 0,
      overlays: {},
      promotedIds: [],
      display: `面孔升档[${faceId}] 无需补跑`,
      method: 'face-promote-full',
      trueRationing: true,
    };
  }

  const byId = new Map((instruments || []).map((i) => [i.id, i]));
  const overlays = {};
  const promotedIds = [];

  for (const row of promoteList) {
    const inst = byId.get(row.instrumentId);
    if (!inst) continue;
    if (inst.intelCenter?.attention?.computeMode === 'full' && inst.intelCenter?.primaryClaim?.claimId) {
      // 已是 full：仅打标
      overlays[inst.id] = {
        reusedFull: true,
        beliefLevel: inst.intelCenter.beliefLevel,
        claimStatus: inst.intelCenter.primaryClaim?.status,
        summary: inst.intelCenter.summary,
      };
      promotedIds.push(inst.id);
      continue;
    }
    const intelCenter = evaluateIntelCenter(inst, {
      ...ctx,
      computeMode: 'full',
      depth: 'deep',
      persist: false,
      shift: ctx.shift,
      asOf: ctx.asOf,
    });
    const base = intelCenter._enrichedInstrument || inst;
    const { _enrichedInstrument, ...cleanIntel } = intelCenter;
    overlays[inst.id] = {
      ...cleanIntel,
      attention: {
        ...(cleanIntel.attention || {}),
        computeMode: 'full',
        depth: 'deep',
        promotedByFace: faceId,
        fromMode: row.from || 'skip',
        trueRationing: true,
        display: `面孔升档·full ← ${row.from || '—'}`,
      },
      method: `${cleanIntel.method || 'chief-of-staff-pipeline'}+face-promote`,
      _baseInstrumentId: base.id,
    };
    promotedIds.push(inst.id);
  }

  return {
    faceId,
    appliedCount: promotedIds.length,
    overlays,
    promotedIds,
    display: `面孔升档[${faceId}] 已补跑 full ${promotedIds.length}/${promoteList.length}（非全市场重算）`,
    method: 'face-promote-full',
    trueRationing: true,
    dataSource: 'intel-orchestrator',
  };
}

function slimOverlayForPack(overlay) {
  if (!overlay) return null;
  return {
    available: overlay.available,
    beliefLevel: overlay.beliefLevel,
    summary: overlay.summary,
    claimStatus: overlay.primaryClaim?.status || overlay.claimStatus,
    claimId: overlay.primaryClaim?.claimId,
    issueId: overlay.primaryClaim?.issueId,
    pushTier: overlay.pushTier?.tier,
    pricingState: overlay.pricingState?.state,
    mechanismDepthDisplay: overlay.primaryClaim?.mechanismDepthDisplay || overlay.memo?.mechanismDepthDisplay,
    claimTreeDisplay: overlay.claimTree?.display,
    attention: overlay.attention,
    reusedFull: overlay.reusedFull || false,
    memoHeadline: overlay.memo?.headline || overlay.primaryClaim?.statement,
    choicePrimaryId: overlay.choiceSet?.primaryId || null,
  };
}

/** 落盘前剔除运行时完整 overlay，避免 cache 膨胀 */
function stripIntelPackForDisk(pack) {
  if (!pack || typeof pack !== 'object') return pack;
  const { _faceFullOverlays, ...rest } = pack;
  return rest;
}

function applyIntelCenterToInstruments(instruments, ctx = {}) {
  const { rankInterruptCandidates } = require('./intel-push-tier');
  const { buildQuestionQueue } = require('./intel-question-queue');
  const { allocateFromTriage, applyAttentionToInstruments } = require('./intel-attention-budget');
  const shift = ctx.shift || resolveShift();
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);

  // 1) 先 triage 配额（不跑全量）
  const budget = allocateFromTriage(instruments, {
    asOf,
    deepSlots: ctx.deepSlots,
    shallowSlots: ctx.shallowSlots,
    faceId: ctx.faceId || 'decision',
  });

  // 2) 按 computeMode 分档评估
  const enriched = (instruments || []).map((inst) => {
    const slot = budget.byId[inst.id] || { depth: 'silent', computeMode: 'skip' };
    const intelCenter = evaluateIntelCenter(inst, {
      ...ctx,
      shift,
      asOf,
      depth: slot.depth,
      computeMode: slot.computeMode,
      // 静默/浅层不写博物馆，避免噪音
      persist: slot.computeMode === 'full' ? ctx.persist !== false : false,
    });
    const base = intelCenter._enrichedInstrument || inst;
    const { _enrichedInstrument, ...cleanIntel } = intelCenter;
    return {
      ...base,
      intelCenter: {
        ...cleanIntel,
        attention: {
          ...(cleanIntel.attention || {}),
          depth: slot.depth,
          rank: slot.rank,
          score: slot.score,
          computeMode: slot.computeMode,
          reasons: slot.reasons,
          trueRationing: true,
          display:
            slot.computeMode === 'full'
              ? `深算 #${slot.rank} · full`
              : slot.computeMode === 'lite'
                ? `浅监控 #${slot.rank} · lite`
                : `静默 #${slot.rank} · skip`,
        },
      },
    };
  });

  const withAttn = applyAttentionToInstruments(enriched, budget);
  const ranked = rankInterruptCandidates(withAttn);
  const questionQueue = buildQuestionQueue(ranked);
  const byId = new Map(questionQueue.all.map((q) => [q.instrumentId, q]));

  const out = ranked.map((inst) => ({
    ...inst,
    intelCenter: {
      ...inst.intelCenter,
      question: byId.get(inst.id) || inst.intelCenter.question,
    },
  }));
  out._attentionBudget = budget;
  return out;
}

module.exports = {
  ORCHESTRATOR_VERSION,
  evaluateIntelCenter,
  buildIntelCenterPack,
  applyIntelCenterToInstruments,
  applyPromoteFullEvaluations,
  slimOverlayForPack,
  stripIntelPackForDisk,
  enrichContradictionMatrix,
  enforceConfidenceBrake,
  STRONG_STRUCTURE_CAP,
  compareToRelease,
};
