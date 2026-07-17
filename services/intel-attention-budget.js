/**
 * 情报中心 · 真注意力配额（构想 §25）
 * 每日深算 8–12；其余浅监控/静默。算力跟问题价值走。
 * 触发：合证翻转、新闻 surprise、冲击到达、证伪、误定价、关注列表。
 * 禁止全市场同等深度；禁止 post-hoc 贴标签冒充偷懒。
 */
const ATTENTION_VERSION = 'v2.89.9-true-lazy';

const DEFAULT_DEEP_SLOTS = 10;
const DEFAULT_SHALLOW_SLOTS = 24;
/** 决策面孔深算硬窗（构想 §25） */
const DEEP_SLOTS_MIN = 8;
const DEEP_SLOTS_MAX = 12;
const MAX_SILENT_WAKES = 4; // 同轮 skip→lite 唤醒上限，防预算爆炸

const FACE_ATTENTION_POLICY = {
  decision: {
    faceId: 'decision',
    deepSlots: 10,
    shallowSlots: 24,
    falsifyBias: 0,
    mispricedBias: 0,
    clampDeepToVision: true,
    note: '默认配额·深算8–12',
  },
  research: {
    faceId: 'research',
    deepSlots: 12,
    shallowSlots: 28,
    falsifyBias: 10,
    mispricedBias: 8,
    clampDeepToVision: true,
    note: '研究扩深·仍≤12',
  },
  execution: {
    faceId: 'execution',
    deepSlots: 6,
    shallowSlots: 18,
    falsifyBias: 40,
    mispricedBias: 25,
    interruptBias: 30,
    clampDeepToVision: false, // 执行面刻意收紧深槽
    note: '执行偏证伪/误定价·深槽收紧',
  },
};

const FULL_STAGES = [
  'claims',
  'dual',
  'antiManip',
  'redTeam',
  'falsify',
  'surpriseEmpirical',
  'scenario',
  'gates',
  'memo',
  'persist',
];
const LITE_STAGES = ['claims', 'dual', 'antiManip', 'pricingLite', 'clockLite', 'question'];
const SKIP_STAGES = ['reuseOrMinimal'];

function faceAttentionPolicy(faceId = 'decision') {
  return FACE_ATTENTION_POLICY[faceId] || FACE_ATTENTION_POLICY.decision;
}

function clampDeepSlots(raw, policy) {
  const n = Number(raw);
  const fallback = policy?.deepSlots ?? DEFAULT_DEEP_SLOTS;
  const base = Number.isFinite(n) ? n : fallback;
  if (policy?.clampDeepToVision) {
    return Math.max(DEEP_SLOTS_MIN, Math.min(DEEP_SLOTS_MAX, base));
  }
  return Math.max(1, Math.min(DEEP_SLOTS_MAX, base));
}

/** 显式 deepSlots（测试/运维）可低于 8；缺省走面孔策略 + §25 硬窗 */
function resolveDeepSlots(opts, policy) {
  if (opts?.deepSlots != null && Number.isFinite(Number(opts.deepSlots))) {
    return Math.max(1, Math.min(16, Number(opts.deepSlots)));
  }
  return clampDeepSlots(policy?.deepSlots, policy);
}

/** 廉价异常探针：静默品种是否该醒（不跑全管线） */
function probeSilentAnomaly(inst) {
  const reasons = [];
  let score = 0;
  const chg = Math.abs(Number(inst?.changePct) || 0);
  if (chg >= 2) {
    score += 40;
    reasons.push(`涨跌${chg.toFixed(1)}%`);
  } else if (chg >= 1.2) {
    score += 18;
    reasons.push(`涨跌${chg.toFixed(1)}%`);
  }

  const shock = Number(inst?.factors?.news?.shock);
  if (Number.isFinite(shock) && Math.abs(shock) >= 0.55) {
    score += 35;
    reasons.push(`新闻shock=${shock.toFixed(2)}`);
  }
  const hits = Number(inst?.factors?.news?.hitCount) || 0;
  if (hits >= 3) {
    score += 12;
    reasons.push(`新闻hits=${hits}`);
  }

  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const prevBias =
    inst?.intelCenter?.primaryClaim?.baseline?.structureBias ||
    inst?.intelCenter?.falsifyEval?.baseline?.structureBias ||
    inst?.intelCenter?.structureBiasCached ||
    null;
  const liveBias = sf?.available ? sf.structureBias : null;
  if (
    prevBias &&
    liveBias &&
    prevBias !== liveBias &&
    liveBias !== 'flat' &&
    liveBias !== 'mixed' &&
    prevBias !== 'flat' &&
    prevBias !== 'mixed'
  ) {
    score += 55;
    reasons.push(`合证翻转 ${prevBias}→${liveBias}`);
  }

  if (inst?.userFocus || inst?.isFocus) {
    score += 10;
    reasons.push('关注列表');
  }

  const wake = score >= 35;
  return {
    wake,
    score,
    reasons: reasons.slice(0, 4),
    nDisplay: reasons.length ? String(reasons.length) : '暂无',
    method: 'silent-anomaly-probe',
    dataSource: 'quote+news+stockFlow+priorClaim',
  };
}

function triageScore(inst, facePolicy = null) {
  let score = 0;
  const reasons = [];
  const chg = Math.abs(Number(inst?.changePct) || 0);
  if (chg >= 2) {
    score += 40;
    reasons.push(`涨跌${chg.toFixed(1)}%`);
  } else if (chg >= 1) {
    score += 20;
    reasons.push(`涨跌${chg.toFixed(1)}%`);
  }

  const prev = inst?.intelCenter;
  if (prev?.primaryClaim?.status === 'falsifying') {
    score += 70 + (facePolicy?.falsifyBias || 0);
    reasons.push('证伪中');
  }
  if (prev?.primaryClaim?.status === 'falsified') {
    score += 85 + (facePolicy?.falsifyBias || 0);
    reasons.push('已证伪');
  }
  if (prev?.pricingState?.state === 'mispriced') {
    score += 35 + (facePolicy?.mispricedBias || 0);
    reasons.push('定价背离');
  }
  if (prev?.pushTier?.tier === 'interrupt') {
    score += 100 + (facePolicy?.interruptBias || 0);
    reasons.push('打断级');
  }
  if (prev?.dualNarrative?.regime === 'split') {
    score += 22;
    reasons.push('内外分裂');
  }
  if (prev?.antiManipulation?.flagged) {
    score += 18;
    reasons.push('操纵标注');
  }
  if (prev?.question?.score) score = Math.max(score, Number(prev.question.score) || 0);

  const sf = inst?.factors?.inventory?.stockFlowJoint;
  if (sf?.available && sf.structureBias && sf.structureBias !== 'flat' && sf.structureBias !== 'mixed') {
    score += 12;
    reasons.push('合证明确');
  }

  // §25 触发：合证翻转
  const prevBias =
    prev?.primaryClaim?.baseline?.structureBias ||
    prev?.falsifyEval?.baseline?.structureBias ||
    prev?.structureBiasCached ||
    null;
  const liveBias = sf?.available ? sf.structureBias : null;
  if (
    prevBias &&
    liveBias &&
    prevBias !== liveBias &&
    !['flat', 'mixed'].includes(liveBias) &&
    !['flat', 'mixed'].includes(prevBias)
  ) {
    score += 60;
    reasons.push(`合证翻转 ${prevBias}→${liveBias}`);
  }

  // §25 触发：新闻 surprise
  const shock = Number(inst?.factors?.news?.shock);
  if (Number.isFinite(shock) && Math.abs(shock) >= 0.55) {
    score += 32;
    reasons.push(`新闻surprise ${shock.toFixed(2)}`);
  } else if ((inst?.factors?.news?.hitCount || 0) >= 4) {
    score += 14;
    reasons.push('新闻密度');
  }

  // §25 触发：跨品种冲击到达（若上轮冲击图已标）
  const shockHit =
    prev?.shockInbound ||
    prev?.shockArrival ||
    inst?.shockInbound ||
    (Array.isArray(prev?.shockPaths) && prev.shockPaths.length > 0);
  if (shockHit) {
    score += 28;
    reasons.push('冲击到达');
  }

  if (inst?.userFocus || inst?.isFocus) {
    score += 15;
    reasons.push('关注列表');
  }

  if (inst?.intelCenter?.calendarBoost) {
    score += Math.min(30, Number(inst.intelCenter.calendarBoost) || 0);
    reasons.push(inst.intelCenter.calendarReason || '日历临近');
  }

  return {
    score,
    reasons,
    priority: score >= 80 ? 'P0' : score >= 55 ? 'P1' : score >= 35 ? 'P2' : score >= 15 ? 'P3' : 'P4',
  };
}

/**
 * 仅用 triage（无需全量 evaluate）分配深度
 */
function allocateFromTriage(instruments, opts = {}) {
  const faceId = opts.faceId || 'decision';
  const policy = faceAttentionPolicy(faceId);
  const deepSlots = resolveDeepSlots(opts, policy);
  const shallowSlots = Math.max(0, Math.min(40, opts.shallowSlots ?? policy.shallowSlots ?? DEFAULT_SHALLOW_SLOTS));
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const maxWakes = opts.maxSilentWakes ?? MAX_SILENT_WAKES;

  const ranked = (instruments || [])
    .map((inst, idx) => {
      const t = triageScore(inst, policy);
      const probe = probeSilentAnomaly(inst);
      return {
        instrumentId: inst.id,
        instrumentName: inst.name,
        sector: inst.sector,
        ...t,
        probe,
        question: null,
        _idx: idx,
        _inst: inst,
      };
    })
    .sort((a, b) => b.score - a.score || a._idx - b._idx);

  const deep = [];
  const shallow = [];
  const silent = [];
  const byId = {};
  const wakePromotions = [];

  ranked.forEach((row, rank) => {
    let depth = rank < deepSlots ? 'deep' : rank < deepSlots + shallowSlots ? 'shallow' : 'silent';
    let computeMode = depth === 'deep' ? 'full' : depth === 'shallow' ? 'lite' : 'skip';
    let woke = false;

    // 静默池异常唤醒 → lite（不抢深槽；有上限）
    if (
      computeMode === 'skip' &&
      row.probe?.wake &&
      wakePromotions.length < maxWakes
    ) {
      depth = 'shallow';
      computeMode = 'lite';
      woke = true;
      wakePromotions.push({
        instrumentId: row.instrumentId,
        instrumentName: row.instrumentName,
        from: 'skip',
        to: 'lite',
        reasons: row.probe.reasons,
        probeScore: row.probe.score,
      });
      if (row.probe.reasons?.length) {
        row.reasons = [...(row.reasons || []), `唤醒:${row.probe.reasons[0]}`].slice(0, 5);
      }
    }

    const item = {
      instrumentId: row.instrumentId,
      instrumentName: row.instrumentName,
      sector: row.sector,
      priority: row.priority,
      score: row.score,
      depth,
      rank: rank + 1,
      reasons: (row.reasons || []).slice(0, 5),
      computeMode,
      wokeFromSilent: woke,
      probe: row.probe?.wake
        ? { wake: true, score: row.probe.score, reasons: row.probe.reasons, nDisplay: row.probe.nDisplay }
        : null,
    };
    byId[row.instrumentId] = item;
    if (computeMode === 'full') deep.push(item);
    else if (computeMode === 'lite') shallow.push(item);
    else silent.push(item);
  });

  const N = (instruments || []).length;
  const integrityOk = deep.length <= DEEP_SLOTS_MAX && (N < 1 || deep.length < N || N <= DEEP_SLOTS_MAX);

  return {
    version: ATTENTION_VERSION,
    asOf,
    faceId,
    facePolicy: {
      deepSlots: policy.deepSlots,
      shallowSlots: policy.shallowSlots,
      note: policy.note,
      clampDeepToVision: !!policy.clampDeepToVision,
    },
    deepSlots,
    shallowSlots,
    deepSlotsVision: { min: DEEP_SLOTS_MIN, max: DEEP_SLOTS_MAX },
    deepCount: deep.length,
    shallowCount: shallow.length,
    silentCount: silent.length,
    instrumentCount: N,
    deep,
    shallow: shallow.slice(0, 12),
    silentSample: silent.slice(0, 5),
    wakePromotions,
    wakeCount: wakePromotions.length,
    byId,
    integrityOk,
    display: `真偷懒[${policy.note}] 深算${deep.length}/${deepSlots}(full≤${DEEP_SLOTS_MAX}) · 浅${shallow.length}(lite) · 静默${silent.length}(skip)${
      wakePromotions.length ? ` · 唤醒${wakePromotions.length}` : ''
    }${N ? ` · N=${N}` : ''}`,
    dataSource: 'intel-attention-budget',
    method: 'triage-trigger+silent-wake+vision-clamp',
    trueRationing: true,
  };
}

/** 可审计省算力板：证明不是全表深算 */
function buildAttentionRationBoard(budget, instruments, opts = {}) {
  const list = instruments || [];
  const N = list.length;
  const byId = budget?.byId || {};
  let full = 0;
  let lite = 0;
  let skip = 0;
  let reuseSkip = 0;
  let emptySkip = 0;
  const triggerHits = { structureFlip: 0, newsSurprise: 0, shockArrival: 0, focus: 0, falsify: 0 };

  for (const inst of list) {
    const slot = byId[inst.id] || inst.intelCenter?.attention || {};
    const mode = slot.computeMode || 'skip';
    if (mode === 'full') full += 1;
    else if (mode === 'lite') lite += 1;
    else skip += 1;

    if (mode === 'skip') {
      if (inst.intelCenter?.primaryClaim?.claimId || inst.intelCenter?.method === 'attention-skip-reuse') {
        reuseSkip += 1;
      } else emptySkip += 1;
    }

    const reasons = slot.reasons || [];
    const joined = reasons.join('|');
    if (/合证翻转/.test(joined)) triggerHits.structureFlip += 1;
    if (/surprise|新闻/.test(joined)) triggerHits.newsSurprise += 1;
    if (/冲击/.test(joined)) triggerHits.shockArrival += 1;
    if (/关注/.test(joined)) triggerHits.focus += 1;
    if (/证伪/.test(joined)) triggerHits.falsify += 1;
  }

  // 粗估跳过的全管线阶段数（诚实：按档位固定清单，非墙钟）
  const stagesSkipped =
    lite * (FULL_STAGES.length - LITE_STAGES.length) + skip * (FULL_STAGES.length - SKIP_STAGES.length);
  const stagesRun = full * FULL_STAGES.length + lite * LITE_STAGES.length + skip * SKIP_STAGES.length;
  const naiveFullStages = N * FULL_STAGES.length;
  const savingsPct =
    naiveFullStages > 0 ? +(((naiveFullStages - stagesRun) / naiveFullStages) * 100).toFixed(1) : null;

  const integrityFails = [];
  if (budget?.trueRationing !== true && N > 12) {
    integrityFails.push({ reason: 'trueRationing≠true · 可能是事后贴标' });
  }
  if (full > DEEP_SLOTS_MAX && N > DEEP_SLOTS_MAX) {
    integrityFails.push({ reason: `full ${full} > 深算上限 ${DEEP_SLOTS_MAX}` });
  }
  if (N > 20 && full >= N * 0.85) {
    integrityFails.push({ reason: `full ${full}/${N} 接近全市场 · 未真偷懒` });
  }
  if (budget?.method === 'post-hoc-label') {
    integrityFails.push({ reason: 'method=post-hoc-label · 非 triage-then-compute' });
  }

  const wakeCount = budget?.wakeCount ?? (budget?.wakePromotions || []).length;

  return {
    version: ATTENTION_VERSION,
    asOf: budget?.asOf || opts.asOf || new Date().toISOString().slice(0, 10),
    faceId: budget?.faceId || 'decision',
    instrumentCount: N,
    nDisplay: N ? String(N) : '暂无',
    counts: {
      full,
      lite,
      skip,
      reuseSkip,
      emptySkip,
      wake: wakeCount,
      deepSlots: budget?.deepSlots ?? null,
      stagesSkipped,
      stagesRun,
      naiveFullStages: N ? naiveFullStages : null,
    },
    savingsPct,
    savingsDisplay: savingsPct == null ? '暂无' : `${savingsPct}% (${stagesSkipped} stages skipped / naive ${naiveFullStages})`,
    triggerHits,
    wakePromotions: (budget?.wakePromotions || []).slice(0, 6),
    deep: (budget?.deep || []).slice(0, 12),
    integrityOk: integrityFails.length === 0,
    integrityFails,
    trueRationing: budget?.trueRationing === true,
    method: budget?.method || 'unknown',
    display:
      integrityFails.length > 0
        ? `注意力省算力 告警${integrityFails.length} · full ${full}/${N || '—'} · ${savingsPct != null ? `省${savingsPct}%` : '省算暂无'}`
        : `注意力省算力 full ${full}/${budget?.deepSlots ?? DEEP_SLOTS_MAX} · lite ${lite} · skip ${skip} · 省${savingsPct ?? '—'}%${
            wakeCount ? ` · 唤醒${wakeCount}` : ''
          } (N=${N || '暂无'})`,
    note: '省算力按管线阶段计数，非墙钟 ms；full 须≤12 且 trueRationing',
    dataSource: 'intel-attention-budget',
    stages: { full: FULL_STAGES, lite: LITE_STAGES, skip: SKIP_STAGES },
  };
}

/** 三面孔配额投影（不重跑 74 次全管线，仅 triage 标签） */
function allocateForFaces(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const byFace = {};
  for (const faceId of ['decision', 'research', 'execution']) {
    byFace[faceId] = allocateFromTriage(instruments, { ...opts, asOf, faceId });
  }
  return {
    version: ATTENTION_VERSION,
    asOf,
    byFace,
    display: `面孔配额 决策深${byFace.decision.deepCount} · 研究深${byFace.research.deepCount} · 执行深${byFace.execution.deepCount}`,
    dataSource: 'intel-attention-budget',
    method: 'face-triage-projection',
    note: '计算管线默认 decision 面孔；Hub 切换展示对应配额投影',
    trueRationing: true,
  };
}

/**
 * 面孔真再配额：相对当前预算，仅标记需升档 deep 的品种（delta），禁止宣称三遍全算。
 */
function retriageForFace(instruments, faceId, opts = {}) {
  const currentById = opts.currentBudget?.byId || {};
  const next = allocateFromTriage(instruments, { ...opts, faceId });
  const promote = [];
  const demote = [];
  const reuse = [];

  for (const inst of instruments || []) {
    const id = inst.id;
    const prev = currentById[id];
    const neu = next.byId[id];
    if (!neu) continue;
    const prevMode = prev?.computeMode || inst.intelCenter?.attention?.computeMode || 'skip';
    if (neu.computeMode === 'full' && prevMode !== 'full') {
      promote.push({
        instrumentId: id,
        instrumentName: inst.name,
        from: prevMode,
        to: 'full',
        rank: neu.rank,
        reasons: neu.reasons,
      });
    } else if (prevMode === 'full' && neu.computeMode !== 'full') {
      demote.push({ instrumentId: id, from: 'full', to: neu.computeMode, rank: neu.rank });
    } else if (neu.computeMode === 'skip' || neu.computeMode === 'lite') {
      reuse.push({ instrumentId: id, computeMode: neu.computeMode, reuse: true });
    }
  }

  return {
    version: ATTENTION_VERSION,
    faceId,
    budget: next,
    promote,
    demote,
    reuseCount: reuse.length,
    promoteCount: promote.length,
    demoteCount: demote.length,
    deepSlots: next.deepSlots,
    display: `面孔再配额[${faceId}] 升档 ${promote.length} · 降档 ${demote.length} · 复用 ${reuse.length}（非三遍全算）`,
    method: 'face-retriage-delta',
    trueRationing: true,
    dataSource: 'intel-attention-budget',
    note: '仅升档品种需补跑 full；其余复用缓存/lite',
  };
}

/**
 * @deprecated 兼容旧调用。若已有 question 仍可排，但标记 trueRationing:false（事后贴标）。
 * 新代码请用 allocateFromTriage。
 */
function allocateAttentionBudget(instruments, opts = {}) {
  const hasQuestions = (instruments || []).some((i) => i?.intelCenter?.question?.score != null);
  if (!hasQuestions) return allocateFromTriage(instruments, opts);

  const faceId = opts.faceId || 'decision';
  const policy = faceAttentionPolicy(faceId);
  const deepSlots = resolveDeepSlots(opts, policy);
  const shallowSlots = Math.max(0, Math.min(40, opts.shallowSlots ?? policy.shallowSlots ?? DEFAULT_SHALLOW_SLOTS));
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const ranked = (instruments || [])
    .map((inst, idx) => ({
      instrumentId: inst.id,
      instrumentName: inst.name,
      sector: inst.sector,
      priority: inst?.intelCenter?.question?.priority || 'P4',
      score: Number(inst?.intelCenter?.question?.score) || 0,
      reasons: [...(inst?.intelCenter?.question?.reasons || [])],
      question: inst?.intelCenter?.question?.question || null,
      _idx: idx,
    }))
    .sort((a, b) => b.score - a.score || a._idx - b._idx);

  const deep = [];
  const shallow = [];
  const silent = [];
  const byId = {};
  ranked.forEach((row, rank) => {
    const depth = rank < deepSlots ? 'deep' : rank < deepSlots + shallowSlots ? 'shallow' : 'silent';
    const item = {
      ...row,
      depth,
      rank: rank + 1,
      computeMode: depth === 'deep' ? 'full' : depth === 'shallow' ? 'lite' : 'skip',
    };
    delete item._idx;
    byId[row.instrumentId] = item;
    if (depth === 'deep') deep.push(item);
    else if (depth === 'shallow') shallow.push(item);
    else silent.push(item);
  });

  return {
    version: ATTENTION_VERSION,
    asOf,
    faceId,
    deepSlots,
    shallowSlots,
    deepCount: deep.length,
    shallowCount: shallow.length,
    silentCount: silent.length,
    instrumentCount: (instruments || []).length,
    deep,
    shallow: shallow.slice(0, 12),
    silentSample: silent.slice(0, 5),
    byId,
    display: `配额标注(非真偷懒) 深${deep.length} · 浅${shallow.length} · 静默${silent.length}`,
    dataSource: 'intel-attention-budget',
    method: 'post-hoc-label',
    trueRationing: false,
    note: '事后贴标；管线应以 allocateFromTriage 为准',
  };
}

function applyAttentionToInstruments(instruments, budget) {
  if (!budget?.byId) return instruments;
  return (instruments || []).map((inst) => {
    const att = budget.byId[inst.id];
    if (!att || !inst.intelCenter) return inst;
    return {
      ...inst,
      intelCenter: {
        ...inst.intelCenter,
        attention: {
          depth: att.depth,
          rank: att.rank,
          score: att.score,
          computeMode: att.computeMode || (att.depth === 'deep' ? 'full' : att.depth === 'shallow' ? 'lite' : 'skip'),
          faceId: budget.faceId || 'decision',
          reasons: att.reasons,
          wokeFromSilent: !!att.wokeFromSilent,
          display:
            att.depth === 'deep'
              ? `深算 #${att.rank} · full`
              : att.depth === 'shallow'
                ? `浅监控 #${att.rank} · lite${att.wokeFromSilent ? '·唤醒' : ''}`
                : `静默 #${att.rank} · skip`,
          dataSource: 'intel-attention-budget',
          trueRationing: budget.trueRationing === true,
        },
      },
    };
  });
}

module.exports = {
  ATTENTION_VERSION,
  DEFAULT_DEEP_SLOTS,
  DEFAULT_SHALLOW_SLOTS,
  DEEP_SLOTS_MIN,
  DEEP_SLOTS_MAX,
  MAX_SILENT_WAKES,
  FACE_ATTENTION_POLICY,
  FULL_STAGES,
  LITE_STAGES,
  SKIP_STAGES,
  faceAttentionPolicy,
  clampDeepSlots,
  resolveDeepSlots,
  probeSilentAnomaly,
  triageScore,
  allocateFromTriage,
  allocateForFaces,
  retriageForFace,
  allocateAttentionBudget,
  applyAttentionToInstruments,
  buildAttentionRationBoard,
};
