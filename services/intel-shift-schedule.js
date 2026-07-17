/**
 * 情报中心 · 班次纪律 OS（构想 §67）
 * 开盘前/盘中/收盘后/周末：权限矩阵 + 交付裁剪 + 违规记账。
 * 盘中禁长文；周末禁 Interrupt — 强制执行，不只标签。
 * v2.89.17：班次分轨文风（同一数据，不同叙述气质）。
 */
const SHIFT_VERSION = 'v2.89.17-shift-voice';

/** 班次文风档案：标题/导语/截断，禁止编造数值 */
const SHIFT_VOICE_PROFILES = {
  weekend: {
    id: 'review_debt',
    label: '复盘还债',
    hubLead: '周末 · 复盘与还债，不推打断',
    sectionTitles: {
      whatChanged: '本周物质变更复盘',
      p0: '周末跟进 P0',
      interrupt: '打断（周末关闭）',
      calendar: '下周情报日历',
      museum: '失效博物馆',
      debt: '问题债务还债',
      kpi: '过程 KPI（带 n）',
    },
    headlineMax: 64,
    preferBullets: true,
    allowNarrative: true,
  },
  pre_open: {
    id: 'checklist',
    label: '清单式',
    hubLead: '开盘前 · 冷静清单，不叙事',
    sectionTitles: {
      whatChanged: '隔夜变更清单',
      p0: '开盘前 P0',
      interrupt: '打断（开盘前关闭）',
      calendar: '今日情报日历',
      museum: '近期失效（压缩）',
      debt: '阻断级债务',
      kpi: '过程 KPI（带 n）',
    },
    headlineMax: 48,
    preferBullets: true,
    allowNarrative: false,
  },
  intraday: {
    id: 'short_actionable',
    label: '短可行动',
    hubLead: '盘中 · 只盯证伪与打断',
    sectionTitles: {
      whatChanged: '盘中物质变更',
      p0: '盘中 P0',
      interrupt: '打断 / 可行动',
      calendar: '临近窗（压缩）',
      museum: '失效（压缩）',
      debt: '债务（压缩）',
      kpi: '过程 KPI（带 n）',
    },
    headlineMax: 28,
    preferBullets: false,
    allowNarrative: false,
  },
  post_close: {
    id: 'full_diff',
    label: '完整复盘',
    hubLead: '收盘后 · 完整 what-changed 与改口',
    sectionTitles: {
      whatChanged: '今日什么变了',
      p0: '今日 P0 问题',
      interrupt: '打断 / 可行动',
      calendar: '情报日历',
      museum: '失效博物馆',
      debt: '问题债务',
      kpi: '过程 KPI（带 n）',
    },
    headlineMax: 56,
    preferBullets: true,
    allowNarrative: true,
  },
  off_hours: {
    id: 'silent',
    label: '静默',
    hubLead: '非交易时段 · 静默更新，少打扰',
    sectionTitles: {
      whatChanged: '静默变更',
      p0: 'P0（极少）',
      interrupt: '打断（关闭）',
      calendar: '日历（压缩）',
      museum: '博物馆（压缩）',
      debt: '债务（压缩）',
      kpi: '过程 KPI（带 n）',
    },
    headlineMax: 24,
    preferBullets: false,
    allowNarrative: false,
  },
};

function buildShiftVoice(shift) {
  if (!shift?.id) {
    return {
      version: SHIFT_VERSION,
      available: false,
      display: '班次文风暂无',
      dataSource: 'intel-shift-schedule',
    };
  }
  const profile = SHIFT_VOICE_PROFILES[shift.id] || SHIFT_VOICE_PROFILES.off_hours;
  return {
    version: SHIFT_VERSION,
    available: true,
    shiftId: shift.id,
    shiftLabel: shift.label,
    tone: shift.tone,
    outputStyle: shift.outputStyle,
    voiceId: profile.id,
    voiceLabel: profile.label,
    hubLead: profile.hubLead,
    sectionTitles: { ...profile.sectionTitles },
    headlineMax: profile.headlineMax,
    preferBullets: profile.preferBullets,
    allowNarrative: profile.allowNarrative,
    display: `文风 · ${shift.label} · ${profile.label} · ${profile.hubLead}`,
    note: '同一内核数据；文风只改叙述气质与截断，不改数值',
    dataSource: 'intel-shift-schedule',
    method: 'shift-voice-profile',
  };
}

function clipHeadline(text, max) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (!max || s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 按班次文风改写交付文案（截断/导语/标题），不伪造字段
 */
function applyShiftVoice(pack, shift) {
  if (!pack || !shift) return pack;
  const voice = buildShiftVoice(shift);
  const max = voice.headlineMax || 48;

  const next = { ...pack, shiftVoice: voice };

  if (next.dailyDiff) {
    const baseSummary = next.dailyDiff.summary || next.dailyDiff.display || null;
    next.dailyDiff = {
      ...next.dailyDiff,
      voiceLead: voice.hubLead,
      voiceSummary: baseSummary
        ? voice.preferBullets
          ? `【${voice.voiceLabel}】${baseSummary}`
          : clipHeadline(baseSummary, max + 20)
        : voice.hubLead,
    };
  }

  if (Array.isArray(next.interrupts) && next.interrupts.length) {
    next.interrupts = next.interrupts.map((i) => ({
      ...i,
      headline: clipHeadline(i.headline || i.summary || '', max),
      headlineVoiceClipped: Boolean(i.headline && String(i.headline).length > max),
      shiftVoiceId: voice.voiceId,
    }));
  }

  if (next.interruptChannel?.queue?.length) {
    next.interruptChannel = {
      ...next.interruptChannel,
      queue: next.interruptChannel.queue.map((i) => ({
        ...i,
        headline: clipHeadline(i.headline || '', max),
        shiftVoiceId: voice.voiceId,
      })),
      voiceLead: voice.hubLead,
    };
  }

  if (next.questionQueue?.p0?.length) {
    next.questionQueue = {
      ...next.questionQueue,
      p0: next.questionQueue.p0.map((q) => ({
        ...q,
        question: clipHeadline(q.question || '', max + 12),
      })),
    };
  }

  if (next.shiftContract) {
    next.shiftContract = {
      ...next.shiftContract,
      voiceId: voice.voiceId,
      voiceLabel: voice.voiceLabel,
      hubLead: voice.hubLead,
      sectionTitles: voice.sectionTitles,
    };
  }

  return next;
}

function getChinaParts(now = new Date()) {
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const cn = new Date(utc + 8 * 3600000);
  return { hour: cn.getHours(), weekday: cn.getDay(), date: cn.toISOString().slice(0, 10) };
}

function resolveShift(now = new Date()) {
  const { hour, weekday } = getChinaParts(now);
  const isWeekend = weekday === 0 || weekday === 6;

  if (isWeekend) {
    return {
      id: 'weekend',
      label: '周末复盘',
      tone: '复盘、还债',
      allowInterrupt: false,
      allowLongBrief: true,
      allowTop5: false,
      maxP0: 5,
      maxShockPaths: 8,
      maxMemoLines: 12,
      maxTeaching: 5,
      maxMuseum: 10,
      focus: ['failure_museum', 'debt_board', 'canonical_cases', 'process_learning'],
      outputStyle: 'full_review',
      deliveryContract: 'museum+debt+process',
      discipline: ['禁 Interrupt', '允长文复盘', '优先还债/博物馆'],
    };
  }

  if (hour >= 8 && hour < 9) {
    return {
      id: 'pre_open',
      label: '开盘前',
      tone: '冷静、清单式',
      allowInterrupt: false,
      allowLongBrief: true,
      allowTop5: true,
      maxP0: 3,
      maxShockPaths: 4,
      maxMemoLines: 8,
      maxTeaching: 3,
      maxMuseum: 3,
      focus: ['overnight_shock', 'calendar', 'p0_status'],
      outputStyle: 'checklist',
      deliveryContract: 'calendar+p0+checklist',
      discipline: ['禁 Interrupt', '清单式', '日历+P0'],
    };
  }

  if (hour >= 9 && hour < 15) {
    return {
      id: 'intraday',
      label: '盘中',
      tone: '短、可行动',
      allowInterrupt: true,
      allowLongBrief: false,
      allowTop5: false,
      maxP0: 2,
      maxShockPaths: 3,
      maxMemoLines: 4,
      maxTeaching: 1,
      maxMuseum: 2,
      focus: ['falsify', 'extreme_surprise', 'interrupt_channel'],
      outputStyle: 'short_actionable',
      deliveryContract: 'falsify+surprise+interrupt-only',
      discipline: ['允 Interrupt', '禁长文', '禁 Top5', '短可行动'],
    };
  }

  if (hour >= 15 && hour < 18) {
    return {
      id: 'post_close',
      label: '收盘后',
      tone: '完整、可复盘',
      allowInterrupt: false,
      allowLongBrief: true,
      allowTop5: true,
      maxP0: 3,
      maxShockPaths: 6,
      maxMemoLines: 10,
      maxTeaching: 4,
      maxMuseum: 6,
      focus: ['what_changed', 'claim_archive', 'revisions', 'teaching'],
      outputStyle: 'full_diff',
      deliveryContract: 'diff+revisions+teaching',
      discipline: ['禁 Interrupt', '允长文', 'diff+改口'],
    };
  }

  return {
    id: 'off_hours',
    label: '非交易时段',
    tone: '静默更新',
    allowInterrupt: false,
    allowLongBrief: false,
    allowTop5: false,
    maxP0: 1,
    maxShockPaths: 2,
    maxMemoLines: 3,
    maxTeaching: 1,
    maxMuseum: 1,
    focus: ['silent_update'],
    outputStyle: 'silent',
    deliveryContract: 'silent-minimal',
    discipline: ['全静默', '禁 Interrupt', '禁长文'],
  };
}

function applyShiftToPushTier(pushTier, shift) {
  if (!pushTier || !shift) return pushTier;
  let tier = pushTier.tier;
  const reasons = [...(pushTier.reasons || [])];

  if (tier === 'interrupt' && !shift.allowInterrupt) {
    tier = 'watch';
    reasons.push(`班次 ${shift.label} 禁止 Interrupt`);
  }

  return {
    ...pushTier,
    tier,
    tierLabel:
      tier === 'interrupt' ? '打断' : tier === 'watch' ? '关注' : pushTier.tierLabel || '静默更新',
    shiftApplied: true,
    shiftId: shift.id,
    reasons,
  };
}

/**
 * 班次权限矩阵（产品面）
 */
function buildShiftDisciplineBoard(shift, pack = {}) {
  if (!shift) {
    return {
      version: SHIFT_VERSION,
      available: false,
      display: '班次纪律暂无',
      dataSource: 'intel-shift-schedule',
    };
  }

  const rules = [
    {
      id: 'interrupt',
      label: 'Interrupt 推送',
      allowed: Boolean(shift.allowInterrupt),
      detail: shift.allowInterrupt ? '允许投递 Hub+文件回执' : '强制拒投 · 降为 watch',
    },
    {
      id: 'long_brief',
      label: '长文/深报',
      allowed: Boolean(shift.allowLongBrief),
      detail: shift.allowLongBrief ? `memo≤${shift.maxMemoLines} 行` : '禁止长文 · 深度队列压缩',
    },
    {
      id: 'top5',
      label: 'Top5 强结论',
      allowed: Boolean(shift.allowTop5),
      detail: shift.allowTop5 ? '允许' : '本班次清空 Top5 交付',
    },
    {
      id: 'p0',
      label: 'P0 问题',
      allowed: true,
      detail: `最多 ${shift.maxP0 ?? 3} 条`,
    },
    {
      id: 'teaching',
      label: '教学层',
      allowed: true,
      detail: `最多 ${shift.maxTeaching ?? 2} 条`,
    },
  ];

  const violations = [];
  const rawInterruptN = (pack._preShiftInterruptCount ?? pack.interrupts?.length ?? 0) || 0;
  if (!shift.allowInterrupt && rawInterruptN > 0) {
    violations.push({
      id: 'interrupt_blocked',
      label: 'Interrupt 班次拒投',
      count: rawInterruptN,
      nDisplay: String(rawInterruptN),
      detail: `${rawInterruptN} 条候选被班次纪律降档/拒投`,
    });
  }
  if (!shift.allowLongBrief && (pack.teaching?.lessons?.length || 0) > (shift.maxTeaching || 1)) {
    violations.push({
      id: 'long_brief_truncated',
      label: '长文裁剪',
      count: pack.teaching.lessons.length,
      detail: '盘中/静默班次压缩教学与深队列',
    });
  }

  const denied = rules.filter((r) => !r.allowed);
  const allowed = rules.filter((r) => r.allowed);

  return {
    version: SHIFT_VERSION,
    available: true,
    shiftId: shift.id,
    shiftLabel: shift.label,
    tone: shift.tone,
    outputStyle: shift.outputStyle,
    deliveryContract: shift.deliveryContract,
    discipline: shift.discipline || [],
    rules,
    allowed,
    denied,
    violations,
    counts: {
      allowed: allowed.length,
      denied: denied.length,
      violations: violations.length,
    },
    display: `班次纪律 · ${shift.label} · 允 ${allowed.length} / 禁 ${denied.length}${
      violations.length ? ` · 违规处置 ${violations.length}` : ''
    }`,
    note: '盘中禁长文 · 周末/开盘前/收盘后禁 Interrupt',
    dataSource: 'intel-shift-schedule',
    method: 'shift-permission-matrix',
  };
}

/**
 * 按班次契约裁剪 pack 交付面（同数据，不同压缩）
 */
const TEACH_PRIORITY = {
  false_quiet_risk: 0,
  mechanism_honesty: 1,
  weight_human_ack: 2,
  header_denominators: 3,
  mechanism_board: 4,
  staff_face: 5,
  shift_voice: 6,
  weight_honesty: 7,
  interrupt_n: 8,
  n_required: 9,
  read_memo: 10,
};

function prioritizeTeachingLessons(lessons, maxN) {
  const list = lessons || [];
  if (list.length <= maxN) return list;
  const scored = list.map((l, i) => ({
    l,
    i,
    p: Object.prototype.hasOwnProperty.call(TEACH_PRIORITY, l.id) ? TEACH_PRIORITY[l.id] : 20,
  }));
  scored.sort((a, b) => a.p - b.p || a.i - b.i);
  return scored.slice(0, maxN).map((x) => x.l);
}

function applyShiftDeliveryContract(pack, shift) {
  if (!pack || !shift) return pack;
  const q = pack.questionQueue || {};
  const shock = pack.shockGraph || {};
  const preInterruptCount = (pack.interrupts || []).length;
  const maxTeach = shift.maxTeaching ?? 2;

  const next = {
    ...pack,
    _preShiftInterruptCount: preInterruptCount,
    shiftContract: {
      id: shift.id,
      label: shift.label,
      deliveryContract: shift.deliveryContract,
      outputStyle: shift.outputStyle,
      tone: shift.tone,
      allowInterrupt: shift.allowInterrupt,
      allowLongBrief: shift.allowLongBrief,
      allowTop5: shift.allowTop5,
      maxMemoLines: shift.maxMemoLines,
      discipline: shift.discipline || [],
    },
    questionQueue: {
      ...q,
      p0: (q.p0 || []).slice(0, shift.maxP0 ?? 3),
      p0Count: Math.min(q.p0Count || 0, shift.maxP0 ?? 3),
      deepQueue: shift.allowLongBrief
        ? q.deepQueue
        : (q.deepQueue || []).slice(0, shift.maxP0 ?? 2),
    },
    shockGraph: {
      ...shock,
      topPaths: (shock.topPaths || []).slice(0, shift.maxShockPaths ?? 4),
      activeEdges: (shock.activeEdges || []).slice(0, shift.maxShockPaths ?? 4),
    },
    top5Candidates: shift.allowTop5 ? pack.top5Candidates : [],
    interrupts: shift.allowInterrupt ? pack.interrupts : [],
    teaching: pack.teaching
      ? {
          ...pack.teaching,
          lessons: prioritizeTeachingLessons(pack.teaching.lessons, maxTeach),
          truncatedByShift: (pack.teaching.lessons || []).length > maxTeach,
        }
      : pack.teaching,
  };

  // 盘中：压缩博物馆/复盘长板
  if (!shift.allowLongBrief) {
    next.failureMuseumRecent = (pack.failureMuseumRecent || []).slice(0, shift.maxMuseum ?? 2);
    next.revisionsRecent = (pack.revisionsRecent || []).slice(0, 2);
    if (next.museumBoard) {
      next.museumBoard = {
        ...next.museumBoard,
        entries: (next.museumBoard.entries || []).slice(0, shift.maxMuseum ?? 2),
        questions: (next.museumBoard.questions || []).slice(0, 2),
        truncatedByShift: true,
      };
    }
    if (next.narrativeContagion) {
      next.narrativeContagion = {
        ...next.narrativeContagion,
        ahead: (next.narrativeContagion.ahead || []).slice(0, 2),
        transmission: next.narrativeContagion.transmission
          ? {
              ...next.narrativeContagion.transmission,
              edges: (next.narrativeContagion.transmission.edges || []).slice(0, 3),
              themes: (next.narrativeContagion.transmission.themes || []).slice(0, 2),
            }
          : null,
        truncatedByShift: true,
      };
    }
  }

  // 周末：博物馆/债务全开，Interrupt 通道标拒投
  if (shift.id === 'weekend') {
    next.failureMuseumRecent = pack.failureMuseumRecent;
    if (next.interruptChannel) {
      next.interruptChannel = {
        ...next.interruptChannel,
        shiftAllowsInterrupt: false,
        shiftDenyReason: '周末复盘班次禁止 Interrupt',
        queue: [],
        pendingCount: 0,
        display: `打断通道 班次拒投 · 周末复盘 · 候选曾 ${preInterruptCount}`,
      };
    }
  }

  if (shift.outputStyle === 'silent') {
    next.quietDay = true;
    next.quietReason = next.quietReason || '非交易时段·班次静默契约';
  }

  next.shiftDiscipline = buildShiftDisciplineBoard(shift, next);
  return applyShiftVoice(next, shift);
}

function buildShiftContext(pack) {
  const shift = resolveShift();
  return {
    version: SHIFT_VERSION,
    ...shift,
    quietDayAllowed: shift.id === 'post_close' || shift.id === 'weekend',
    packStats: pack?.stats || null,
    display: `当前班次 · ${shift.label} · ${shift.tone} · 契约 ${shift.deliveryContract}`,
    dataSource: 'intel-shift-schedule',
  };
}

/** 供测试注入时刻 */
function resolveShiftAt(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return resolveShift(d);
}

module.exports = {
  SHIFT_VERSION,
  SHIFT_VOICE_PROFILES,
  resolveShift,
  resolveShiftAt,
  applyShiftToPushTier,
  applyShiftDeliveryContract,
  buildShiftContext,
  buildShiftDisciplineBoard,
  buildShiftVoice,
  applyShiftVoice,
  prioritizeTeachingLessons,
  getChinaHour: () => getChinaParts().hour,
  getChinaWeekday: () => getChinaParts().weekday,
};
