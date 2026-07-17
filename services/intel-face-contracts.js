/**
 * 情报中心 · 三面孔分算契约（构想 §66/26/71）
 * 决策 / 研究 / 执行 = 独立交付物，不是同一 pack 的 CSS hidden。
 * v2.89.24：Hub 内三壳布局 + 决策面下令队列（非独立 OS）。
 */
const FACE_CONTRACT_VERSION = 'v2.89.24-face-shell-commander-orders';

const FACE_SHELL_LAYOUTS = {
  decision: {
    shellLayoutId: 'cmd-brief',
    chromeSlots: ['workbar', 'orderQueue', 'fiveCmds', 'cmdDeck'],
    primaryRegions: ['whatChanged', 'p0', 'calendar', 'interrupt', 'meta', 'commanderOrders'],
    note: '决策壳=简报+下令',
  },
  research: {
    shellLayoutId: 'lab-depth',
    chromeSlots: ['fiveCmds'],
    primaryRegions: ['shock', 'museum', 'debt', 'antiPattern', 'process'],
    note: '研究壳=深度板；无指挥下令队列',
  },
  execution: {
    shellLayoutId: 'trigger-strip',
    chromeSlots: [],
    primaryRegions: ['falsify', 'pricing', 'discipline'],
    note: '执行壳=触发器条；无债/权审 UI',
  },
};

const FACE_CONTRACTS = {
  decision: {
    id: 'decision',
    label: '决策者',
    tone: '可行动、短',
    shellLayoutId: 'cmd-brief',
    maxP0: 3,
    maxShockPaths: 3,
    maxInterrupts: 3,
    maxMuseum: 3,
    maxRevisions: 3,
    maxIssues: 5,
    showTeaching: false,
    showProcessDetail: false,
    showPlaybookBoard: false,
    showDebt: false,
    showCanonical: true,
    focus: ['diff', 'p0', 'calendar', 'interrupt', 'meta', 'orders'],
    deliveryContract: 'diff+p0+calendar+interrupt+orders',
    // 允许出现在决策面交付中的板（其余剥离为 null / truncated）
    allowBlocks: [
      'dailyDiff',
      'questionQueue',
      'intelligenceCalendar',
      'interrupts',
      'interruptChannel',
      'metaIntelligence',
      'top5Candidates',
      'quietBrakeBoard',
      'pricingClockBoard',
      'canonicalWatch',
      'staffFaceBoard',
      'commanderWorkbar',
      'antiPatternBoard',
      'llmBoundaryBoard',
      'qualityDebtBoard',
    ],
  },
  research: {
    id: 'research',
    label: '研究员',
    tone: '完整、可追溯',
    shellLayoutId: 'lab-depth',
    maxP0: 5,
    maxShockPaths: 8,
    maxInterrupts: 2,
    maxMuseum: 10,
    maxRevisions: 10,
    maxIssues: 12,
    showTeaching: true,
    showProcessDetail: true,
    showPlaybookBoard: true,
    showDebt: true,
    showCanonical: true,
    focus: ['shock', 'museum', 'debt', 'process', 'issues', 'playbook', 'mechanism', 'antiPattern', 'qualityDebt'],
    deliveryContract: 'shock+museum+debt+process+issues+playbook+antiPattern+qualityDebt',
    allowBlocks: null, // 全开
  },
  execution: {
    id: 'execution',
    label: '执行者',
    tone: '触发器、误定价、证伪',
    shellLayoutId: 'trigger-strip',
    maxP0: 2,
    maxShockPaths: 2,
    maxInterrupts: 3,
    maxMuseum: 2,
    maxRevisions: 2,
    maxIssues: 4,
    showTeaching: false,
    showProcessDetail: false,
    showPlaybookBoard: false,
    showDebt: false,
    showCanonical: false,
    focus: ['falsify', 'mispriced', 'interrupt', 'triggers', 'discipline'],
    deliveryContract: 'falsify+mispriced+interrupt-only',
    actionableOnly: true,
    allowBlocks: [
      'interrupts',
      'interruptChannel',
      'questionQueue',
      'pricingClockBoard',
      'issueBoard',
      'shiftContract',
      'shift',
      'shiftDisciplineBoard',
      'antiManipulationBoard',
      'quietBrakeBoard',
    ],
  },
};

const RESEARCH_HEAVY_BLOCKS = [
  'shockGraph',
  'shockDynamicsBoard',
  'multiHopBoard',
  'mechanismBoard',
  'resonanceBoard',
  'narrativeContagion',
  'isomorphicBoard',
  'dualBoard',
  'museumBoard',
  'contradictionBoard',
  'debtBoard',
  'unknownBoard',
  'playbookBoard',
  'processLearning',
  'processScorecard',
  'claimSharpnessBoard',
  'scenarioLatticeBoard',
  'evidenceAuditBoard',
  'redTeamBoard',
  'horizonConflictBoard',
  'evidenceFreshnessBoard',
  'externalBriefBoard',
  'analystJournalBoard',
  'attentionRationBoard',
  'faceComputeBoard',
  'compileBoard',
  'teaching',
  'antiPatternBoard',
  'llmBoundaryBoard',
  'qualityDebtBoard',
];

function isExecutionActionableInterrupt(i) {
  if (!i) return false;
  if (i.falsified || i.falsifying) return true;
  const blob = `${i.headline || ''} ${i.redTeam || ''} ${(i.reasons || []).join(' ')} ${i.interruptReason || ''}`;
  return /证伪|改口|误定价|falsif|mispriced|翻转|到期/i.test(blob);
}

function isExecutionActionableP0(row) {
  if (!row) return false;
  return /证伪|翻转|误定价|falsif|mispriced|时钟|到期|触发/i.test(String(row.question || ''));
}

function stripDisallowedBlocks(pack, face) {
  if (!face.allowBlocks) return {};
  const allow = new Set(face.allowBlocks);
  const stripped = [];
  const patch = {};
  for (const key of RESEARCH_HEAVY_BLOCKS) {
    if (allow.has(key)) continue;
    if (pack[key] != null) {
      stripped.push(key);
      patch[key] = null;
    }
  }
  // 决策面保留定价板摘要，但研究向细节板已剥
  if (face.id === 'decision') {
    for (const key of ['museumBoard', 'debtBoard', 'playbookBoard', 'processScorecard']) {
      if (pack[key] != null && !allow.has(key)) {
        if (!stripped.includes(key)) stripped.push(key);
        patch[key] = null;
      }
    }
  }
  return { patch, stripped };
}

/**
 * 按面孔契约裁剪 pack → 独立交付投影（非 CSS）
 */
function applyFaceDeliveryContract(pack, faceId = 'decision') {
  if (!pack) return pack;
  const face = FACE_CONTRACTS[faceId] || FACE_CONTRACTS.decision;
  const q = pack.questionQueue || {};
  const shock = pack.shockGraph || {};
  const issues = pack.issueBoard || {};
  const pricing = pack.pricingClockBoard || null;

  let interrupts = [...(pack.interrupts || [])];
  let p0 = [...(q.p0 || [])];
  let interruptQueue = pack.interruptChannel?.queue ? [...pack.interruptChannel.queue] : null;

  if (face.actionableOnly) {
    interrupts = interrupts.filter(isExecutionActionableInterrupt);
    p0 = p0.filter(isExecutionActionableP0);
    if (interruptQueue) {
      interruptQueue = interruptQueue.filter(isExecutionActionableInterrupt);
    }
  }

  const { patch: stripPatch, stripped } = stripDisallowedBlocks(pack, face);

  let pricingClockBoard = pricing;
  if (face.id === 'execution' && pricing) {
    pricingClockBoard = {
      ...pricing,
      rows: (pricing.rows || []).filter(
        (r) =>
          r.state === 'mispriced' ||
          r.clockDue ||
          r.clockExpired ||
          /mispriced|证伪|到期/i.test(String(r.display || r.state || ''))
      ),
      mispriced: (pricing.mispriced || pricing.rows || []).filter(
        (r) => r.state === 'mispriced' || r.mispriced
      ),
      truncatedByFace: true,
      faceFilter: 'mispriced+clock-due',
    };
  } else if (face.id === 'decision' && pricing) {
    pricingClockBoard = {
      display: pricing.display,
      counts: pricing.counts,
      mispriced: (pricing.mispriced || []).slice(0, 3),
      truncatedByFace: true,
    };
  }

  let issueBoard = issues;
  if (face.id === 'execution' && issues) {
    issueBoard = {
      display: issues.display,
      falsifyingCount: issues.falsifyingCount,
      falsifying: (issues.falsifying || []).slice(0, face.maxIssues),
      open: [],
      issues: (issues.falsifying || []).slice(0, face.maxIssues),
      truncatedByFace: true,
      faceFilter: 'falsifying-only',
    };
  } else if (issues) {
    issueBoard = {
      ...issues,
      issues: (issues.issues || []).slice(0, face.maxIssues),
      open: (issues.open || []).slice(0, face.maxIssues),
      falsifying: (issues.falsifying || []).slice(0, Math.min(6, face.maxIssues)),
      truncatedByFace: face.id !== 'research',
    };
  }

  const next = {
    ...pack,
    ...stripPatch,
    faceContract: {
      id: face.id,
      label: face.label,
      tone: face.tone,
      deliveryContract: face.deliveryContract,
      focus: face.focus,
      version: FACE_CONTRACT_VERSION,
      strippedBlocks: stripped,
      rail: true,
    },
    questionQueue: {
      ...q,
      p0: p0.slice(0, face.maxP0),
      p0Count: Math.min(p0.length, face.maxP0),
      deepQueue:
        face.id === 'research'
          ? q.deepQueue
          : face.id === 'execution'
            ? p0.slice(0, face.maxP0)
            : (q.deepQueue || []).slice(0, face.maxP0),
      truncatedByFace: face.id !== 'research',
    },
    shockGraph:
      face.id === 'research'
        ? {
            ...shock,
            topPaths: (shock.topPaths || []).slice(0, face.maxShockPaths),
            activeEdges: (shock.activeEdges || []).slice(0, face.maxShockPaths),
            pendingEdges: (shock.pendingEdges || []).slice(0, 8),
          }
        : face.id === 'decision'
          ? {
              display: shock.display,
              topPaths: (shock.topPaths || []).slice(0, face.maxShockPaths),
              activeCount: shock.activeCount,
              pendingCount: shock.pendingCount,
              truncatedByFace: true,
            }
          : null,
    interrupts: interrupts.slice(0, face.maxInterrupts),
    interruptChannel: pack.interruptChannel
      ? {
          ...pack.interruptChannel,
          queue: interruptQueue
            ? interruptQueue.slice(0, face.maxInterrupts)
            : (pack.interruptChannel.queue || []).slice(0, face.maxInterrupts),
          truncatedByFace: face.actionableOnly || face.id !== 'research',
        }
      : pack.interruptChannel,
    failureMuseumRecent: face.id === 'research' ? (pack.failureMuseumRecent || []).slice(0, face.maxMuseum) : [],
    revisionsRecent: face.id === 'research' ? (pack.revisionsRecent || []).slice(0, face.maxRevisions) : [],
    teaching: face.showTeaching
      ? pack.teaching
      : pack.teaching
        ? { ...pack.teaching, lessons: (pack.teaching.lessons || []).slice(0, 1), truncatedByFace: true }
        : pack.teaching,
    processLearning: face.showProcessDetail
      ? pack.processLearning
      : pack.processLearning
        ? {
            directionHit: pack.processLearning.directionHit,
            processCorrect: pack.processLearning.processCorrect,
            display: pack.processLearning.directionHit
              ? `方向 ${pack.processLearning.directionHit} · 过程 ${pack.processLearning.processCorrect || '—'}`
              : pack.processLearning.display,
            truncatedByFace: true,
          }
        : null,
    playbookBoard: face.showPlaybookBoard ? pack.playbookBoard : null,
    debtBoard: face.showDebt
      ? pack.debtBoard
      : pack.debtBoard
        ? { display: pack.debtBoard.display, totalDebts: pack.debtBoard.totalDebts, truncatedByFace: true }
        : null,
    issueBoard,
    pricingClockBoard,
    canonicalWatch: face.showCanonical ? pack.canonicalWatch : null,
    top5Candidates:
      face.id === 'decision' || face.id === 'research' ? pack.top5Candidates : [],
    museumBoard: face.id === 'research' ? pack.museumBoard : stripPatch.museumBoard === null ? null : face.id === 'decision' ? null : pack.museumBoard,
    contradictionBoard:
      face.id === 'research'
        ? pack.contradictionBoard
        : stripPatch.contradictionBoard === null
          ? null
          : face.id === 'decision'
            ? null
            : pack.contradictionBoard,
  };

  next.deliveryBrief = buildFaceDeliveryBrief(next, face, { stripped, sourcePack: pack });
  return next;
}

function buildFaceDeliveryBrief(facePack, face, meta = {}) {
  const p0n = facePack.questionQueue?.p0?.length ?? 0;
  const intN =
    facePack.interruptChannel?.queue?.length ?? facePack.interrupts?.length ?? 0;
  const falsifying = facePack.issueBoard?.falsifying?.length ?? facePack.stats?.falsifying ?? 0;
  const mispriced =
    facePack.pricingClockBoard?.counts?.mispriced ??
    facePack.pricingClockBoard?.mispriced?.length ??
    0;
  const stripped = meta.stripped || facePack.faceContract?.strippedBlocks || [];

  const mustRead = [];
  if (face.id === 'decision') {
    if (facePack.dailyDiff?.summary) mustRead.push(`今日变了：${String(facePack.dailyDiff.summary).slice(0, 48)}`);
    if (p0n) mustRead.push(`P0 ${p0n} 问`);
    if (intN) mustRead.push(`打断 ${intN}`);
    if (!mustRead.length) mustRead.push('暂无紧急交付 · 观望');
  } else if (face.id === 'research') {
    if (facePack.shockGraph?.display) mustRead.push(facePack.shockGraph.display);
    if (facePack.debtBoard?.display) mustRead.push(facePack.debtBoard.display);
    if (facePack.playbookBoard?.display) mustRead.push(facePack.playbookBoard.display);
    if (!mustRead.length) mustRead.push('研究板构建中');
  } else {
    if (falsifying) mustRead.push(`证伪中 ${falsifying}`);
    if (mispriced) mustRead.push(`误定价 ${mispriced}`);
    if (intN) mustRead.push(`可行动打断 ${intN}`);
    if (!mustRead.length) mustRead.push('暂无证伪/误定价可行动项');
  }

  const omitted =
    face.id === 'research'
      ? []
      : stripped.length
        ? stripped.slice(0, 8)
        : face.id === 'execution'
          ? ['shock', 'museum', 'debt', 'playbook', 'teaching']
          : ['shock详', 'museum', 'debt', 'playbook', 'process详'];

  return {
    version: FACE_CONTRACT_VERSION,
    faceId: face.id,
    label: face.label,
    deliveryContract: face.deliveryContract,
    tone: face.tone,
    headline: `${face.label}面 · ${face.deliveryContract} · P0 ${p0n} · 打断 ${intN}${
      face.id === 'execution' ? ` · 证伪${falsifying} · 误定价${mispriced}` : ''
    }`,
    mustRead,
    omitted,
    counts: {
      p0: p0n,
      interrupts: intN,
      falsifying: falsifying || 0,
      mispriced: mispriced || 0,
      stripped: stripped.length,
    },
    rail: true,
    note: '独立交付投影；禁止用 CSS hidden 冒充分轨',
    dataSource: 'intel-face-contracts',
  };
}

/**
 * 品种详情按面孔投影：执行面压掉研究噪音；决策面备忘录优先。
 */
function projectInstrumentForFace(inst, faceId = 'decision') {
  if (!inst?.intelCenter) return inst;
  const face = FACE_CONTRACTS[faceId] || FACE_CONTRACTS.decision;
  const ic = inst.intelCenter;
  const base = {
    ...inst,
    intelCenter: {
      ...ic,
      faceProjection: {
        faceId: face.id,
        label: face.label,
        deliveryContract: face.deliveryContract,
        version: FACE_CONTRACT_VERSION,
      },
    },
  };

  if (face.id === 'research') return base;

  if (face.id === 'decision') {
    base.intelCenter = {
      ...base.intelCenter,
      scenarioLattice: ic.scenarioLattice
        ? {
            display: ic.scenarioLattice.display,
            nDisplay: ic.scenarioLattice.nDisplay,
            weightsCalibrated: ic.scenarioLattice.weightsCalibrated,
            truncatedByFace: true,
          }
        : ic.scenarioLattice,
      redTeam: ic.redTeam
        ? { display: ic.redTeam.display, available: ic.redTeam.available, truncatedByFace: true }
        : ic.redTeam,
      faceProjection: {
        ...base.intelCenter.faceProjection,
        mode: 'memo-first',
        note: '决策面：备忘录+门禁优先，研究板折叠',
      },
    };
    return base;
  }

  // execution：只留时钟/触发/定价/证伪
  const claim = ic.primaryClaim
    ? {
        claimId: ic.primaryClaim.claimId,
        statement: ic.primaryClaim.statement,
        status: ic.primaryClaim.status,
        side: ic.primaryClaim.side,
        confidence: ic.primaryClaim.confidence,
        triggers: ic.primaryClaim.triggers,
        validUntil: ic.primaryClaim.validUntil,
        falsifyTrigger: ic.primaryClaim.falsifyTrigger,
        otherwiseFalsify: ic.primaryClaim.otherwiseFalsify,
        nDisplay: ic.primaryClaim.nDisplay,
        playbookId: ic.primaryClaim.playbookId,
        regimePlaybookId: ic.primaryClaim.regimePlaybookId,
      }
    : null;

  base.intelCenter = {
    ...base.intelCenter,
    primaryClaim: claim,
    clock: ic.clock,
    pricingState: ic.pricingState,
    memo: ic.memo
      ? {
          available: ic.memo.available,
          headline: ic.memo.headline,
          oneLiner: ic.memo.oneLiner,
          triggers: ic.memo.triggers,
          validUntil: ic.memo.validUntil,
          suggestedAction: ic.memo.suggestedAction,
          oppose: ic.memo.oppose,
          publishable: ic.memo.publishable,
          truncatedByFace: true,
        }
      : ic.memo,
    choiceSet: ic.choiceSet
      ? {
          primary: ic.choiceSet.primary,
          primaryId: ic.choiceSet.primaryId,
          display: ic.choiceSet.display,
          truncatedByFace: true,
        }
      : null,
    scenarioLattice: null,
    redTeam: null,
    narrative: null,
    surprise: ic.surprise
      ? { nDisplay: ic.surprise.nDisplay, bucket: ic.surprise.bucket, truncatedByFace: true }
      : null,
    faceProjection: {
      ...base.intelCenter.faceProjection,
      mode: 'triggers-only',
      note: '执行面：证伪时钟/触发器/误定价；研究板已剥离',
    },
  };
  return base;
}

/**
 * 三面孔分轨审计板：证明交付物真不同，而非同文三藏。
 */
function buildFaceContractBoard(faceViews, opts = {}) {
  const faces = {};
  const ids = ['decision', 'research', 'execution'];
  for (const id of ids) {
    const v = faceViews?.[id] || {};
    const brief = v.deliveryBrief || null;
    const fc = v.faceContract || null;
    faces[id] = {
      faceId: id,
      label: fc?.label || FACE_CONTRACTS[id].label,
      deliveryContract: fc?.deliveryContract || FACE_CONTRACTS[id].deliveryContract,
      p0: brief?.counts?.p0 ?? v.questionQueue?.p0?.length ?? 0,
      interrupts: brief?.counts?.interrupts ?? v.interrupts?.length ?? 0,
      stripped: brief?.counts?.stripped ?? fc?.strippedBlocks?.length ?? 0,
      hasShock: Boolean(v.shockGraph?.topPaths?.length || v.shockGraph?.display),
      hasPlaybook: Boolean(v.playbookBoard?.display),
      hasDebt: Boolean(v.debtBoard && !v.debtBoard.truncatedByFace && v.debtBoard.weeklyMustPay),
      headline: brief?.headline || null,
      rail: true,
    };
  }

  const d = faces.decision;
  const r = faces.research;
  const e = faces.execution;
  const shells = {
    decision: buildFaceShellLayout('decision'),
    research: buildFaceShellLayout('research'),
    execution: buildFaceShellLayout('execution'),
  };
  const shellsDiffer =
    shells.decision.shellLayoutId !== shells.research.shellLayoutId &&
    shells.research.shellLayoutId !== shells.execution.shellLayoutId;
  for (const id of ids) {
    faces[id].shellLayoutId = shells[id].shellLayoutId;
    faces[id].chromeSlots = shells[id].chromeSlots;
  }
  const divergence = {
    p0Differ: !(d.p0 === r.p0 && r.p0 === e.p0),
    interruptDiffer: !(d.interrupts === r.interrupts && r.interrupts === e.interrupts),
    blocksDiffer: d.stripped > 0 || e.stripped > 0 || r.hasPlaybook !== d.hasPlaybook,
    researchHasDepth: r.hasShock || r.hasPlaybook || r.hasDebt,
    executionNarrow: e.stripped > 0 || (!e.hasShock && !e.hasPlaybook),
    shellsDiffer,
  };
  const ok =
    divergence.blocksDiffer ||
    divergence.p0Differ ||
    divergence.interruptDiffer ||
    divergence.researchHasDepth ||
    shellsDiffer;

  return {
    version: FACE_CONTRACT_VERSION,
    asOf: opts.asOf || null,
    faces,
    shells,
    shellsDiffer,
    divergence,
    contractOk: Boolean(ok),
    display: ok
      ? `三面孔分轨 壳${shells.decision.shellLayoutId}/${shells.research.shellLayoutId}/${shells.execution.shellLayoutId} · 决策P0=${d.p0}/打断${d.interrupts} · 研究深=${r.hasShock || r.hasPlaybook ? '是' : '薄'} · 执行P0=${e.p0}`
      : '三面孔分轨 待校验·交付物差异不足',
    note: 'Hub 内三壳布局+分轨裁剪；非三套独立应用',
    dataSource: 'intel-face-contracts',
    method: 'allowlist+delivery-brief+shell-layout+divergence',
    independentApp: false,
  };
}

/**
 * 面孔壳布局描述（Hub chrome 分支用；非独立应用）
 */
function buildFaceShellLayout(faceId) {
  const id = FACE_CONTRACTS[faceId] ? faceId : 'decision';
  const layout = FACE_SHELL_LAYOUTS[id] || FACE_SHELL_LAYOUTS.decision;
  const face = FACE_CONTRACTS[id];
  return {
    version: FACE_CONTRACT_VERSION,
    faceId: id,
    label: face.label,
    shellLayoutId: layout.shellLayoutId,
    chromeSlots: [...layout.chromeSlots],
    primaryRegions: [...layout.primaryRegions],
    note: layout.note,
    independentApp: false,
    method: 'face-shell-layout',
    dataSource: 'intel-face-contracts',
  };
}

/**
 * 指挥官工作条 + 下令队列（§45/71）：绑定五键与真实 ops，非独立 OS
 */
function buildCommanderWorkbar(pack, opts = {}) {
  const ich = pack?.interruptChannel || {};
  const deck = ich.commandDeck || {};
  const debt = pack?.debtBoard || {};
  const qb = pack?.quietBrakeBoard || {};
  const proc = pack?.processScorecard || {};
  const pending = {
    interrupts: ich.pendingCount ?? (pack?.interrupts || []).length ?? 0,
    cmdDeck: deck.pendingCount ?? 0,
    escalated: deck.escalatedCount ?? ich.escalatedCount ?? 0,
    debtOps: (debt.opsPlan?.items || debt.opsLoop?.items || []).length || debt.weeklyMustPay || 0,
    weightAck: (proc.pendingWeightChanges || []).length,
    falseQuiet:
      qb.falseQuietLoop?.status === 'open' || qb.falseQuietRisk ? 1 : 0,
  };
  const total =
    (pending.interrupts || 0) +
    (pending.cmdDeck || 0) +
    (pending.debtOps || 0) +
    (pending.weightAck || 0) +
    (pending.falseQuiet || 0);
  const cmds = [
    { id: 'p0', label: '① 今日P0', action: 'intel-cmd-p0' },
    { id: 'memo', label: '② 备忘录', action: 'intel-cmd-memo' },
    { id: 'shock', label: '③ 冲击图', action: 'intel-cmd-shock' },
    { id: 'revisions', label: '④ 改口复盘', action: 'intel-cmd-revisions' },
    { id: 'actionable', label: '⑤ 可行动', action: 'intel-cmd-actionable' },
  ];

  const orders = [];
  if (deck.next?.key) {
    orders.push({
      kind: 'interrupt',
      priority: deck.escalatedCount ? 0 : 1,
      label: `打断 · ${(deck.next.headline || deck.next.instrumentName || deck.next.key || '').slice(0, 36)}`,
      instrumentId: deck.next.instrumentId || null,
      actions: [
        { action: 'intel-ack-interrupt', label: '确认已阅', key: deck.next.key },
        { action: 'intel-mute-interrupt', label: '消音4h', key: deck.next.key, muteHours: 4 },
      ],
      dataSource: 'interruptChannel.commandDeck',
    });
  }
  const debtRunnable = debt.opsPlan?.pendingRunnable || (debt.opsPlan?.items || []).length || 0;
  if (debtRunnable > 0) {
    orders.push({
      kind: 'debt',
      priority: 2,
      label: `债运维 · 可跑${debtRunnable}`,
      actions: [
        { action: 'intel-debt-ops-run', label: '执行本周必还', max: 3 },
        { action: 'intel-debt-ops-dry', label: '演练', max: 3 },
      ],
      dataSource: 'debtBoard.opsPlan',
    });
  }
  if (proc.weightProposal?.proposalId || (proc.pendingWeightChanges || []).length) {
    orders.push({
      kind: 'weight',
      priority: 2,
      label: `权审 · ${(proc.pendingWeightChanges || []).length || 1} 待批`,
      actions: proc.weightProposal?.proposalId
        ? [
            {
              action: 'intel-weight-approve',
              label: '批准落盘',
              proposalId: proc.weightProposal.proposalId,
            },
            {
              action: 'intel-weight-reject',
              label: '驳回',
              proposalId: proc.weightProposal.proposalId,
            },
          ]
        : [],
      dataSource: 'processScorecard',
    });
  }
  if (pending.falseQuiet) {
    orders.push({
      kind: 'falseQuiet',
      priority: 1,
      label: '假静默 · 待人确认',
      actions: [
        { action: 'intel-ack-false-quiet', label: '已复核', resolution: 'reviewed' },
        { action: 'intel-ack-false-quiet', label: '漏记物质', resolution: 'material_miss' },
      ],
      dataSource: 'quietBrakeBoard.falseQuietLoop',
    });
  }
  orders.sort((a, b) => a.priority - b.priority);

  const orderQueue = {
    pending: orders.length,
    items: orders.slice(0, 8),
    display: orders.length
      ? `下令队列 ${orders.length} · ${orders.map((o) => o.kind).join('/')}`
      : '下令队列 暂无',
    method: 'commander-order-bind',
    dataSource: 'intel-face-contracts',
    note: '绑定打断/债/权审/假静默真实 ops；非独立指挥 OS',
  };

  return {
    version: FACE_CONTRACT_VERSION,
    asOf: opts.asOf || pack?.asOf || null,
    available: true,
    cmds,
    pending,
    totalPending: total,
    orders: orderQueue.items,
    orderQueue,
    shellLayoutId: 'cmd-brief',
    display:
      total > 0
        ? `指挥条 待办${total} · 打断${pending.interrupts} · 指挥台${pending.cmdDeck} · 债${pending.debtOps} · 权审${pending.weightAck}${
            pending.falseQuiet ? ' · 假静默' : ''
          }${orders.length ? ` · 下令${orders.length}` : ''}`
        : '指挥条 暂无待办 · 五键就绪',
    note: '决策壳工作条+下令队列；Hub 内三壳，非独立 OS',
    method: 'commander-workbar-bind+order-queue',
    dataSource: 'intel-face-contracts',
    productShell: false,
    independentApp: false,
  };
}

function listFaceContracts() {
  return Object.values(FACE_CONTRACTS).map((f) => ({
    id: f.id,
    label: f.label,
    deliveryContract: f.deliveryContract,
    tone: f.tone,
    focus: f.focus,
    shellLayoutId: f.shellLayoutId || null,
  }));
}

module.exports = {
  FACE_CONTRACT_VERSION,
  FACE_CONTRACTS,
  FACE_SHELL_LAYOUTS,
  applyFaceDeliveryContract,
  buildFaceDeliveryBrief,
  buildFaceContractBoard,
  buildFaceShellLayout,
  buildCommanderWorkbar,
  projectInstrumentForFace,
  listFaceContracts,
  isExecutionActionableInterrupt,
  isExecutionActionableP0,
};
