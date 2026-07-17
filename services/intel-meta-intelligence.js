/**
 * 情报中心 · 元智能（构想 §30）
 * 系统自审盲区：读已有板/品种字段，回答「今天系统哪里在装懂 / 哪里诚实不知道」。
 * 禁止编造盲区；无信号 →「暂无可审计盲区」。
 * v2.89.18：盲区→可执行还债桥（挂 ops / 注入 mustPay，禁止只写文案）。
 */
const META_VERSION = 'v2.89.18-meta-debt-bridge';

/** 盲区 id → 债务类型 / 运维动作（与 intel-debt-ops 对齐） */
const META_SPOT_DEBT = {
  coverage_joint: { debtType: 'joint_gap', preferRunnable: true },
  coverage_stale: { debtType: 'stale_data', preferRunnable: true },
  unknown_critical: { debtType: 'unknown_critical', preferRunnable: true },
  evidence_no_n: { debtType: 'n_missing', preferRunnable: false },
  evidence_no_oppose: { debtType: 'gate_blocked', preferRunnable: false },
  evidence_audit: { debtType: 'gate_blocked', preferRunnable: false },
  false_quiet: { debtType: null, action: 'ack_false_quiet', preferRunnable: false, loop: 'false_quiet' },
  learning_weight_pending: { debtType: null, action: 'human_ack_weights', preferRunnable: false },
  interrupt_backlog: { debtType: null, action: 'ack_interrupts', preferRunnable: false },
};

function sampleIds(instruments, pred, limit = 4) {
  const out = [];
  for (const inst of instruments || []) {
    if (!inst?.id || !pred(inst)) continue;
    out.push({
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function spot({
  id,
  label,
  severity,
  n,
  instruments = [],
  question,
  remedy,
  dataSource,
  note,
}) {
  const count = n != null ? n : instruments.length;
  return {
    id,
    label,
    severity,
    n: count,
    nDisplay: count > 0 ? String(count) : '暂无',
    instruments: instruments.slice(0, 6),
    question: question || null,
    remedy: remedy || null,
    note: note || null,
    dataSource: dataSource || 'intel-meta-intelligence',
  };
}

/**
 * @param {object[]} instruments
 * @param {object} ctx — pack 子板快照
 */
function buildMetaIntelligenceBoard(instruments, ctx = {}) {
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const list = instruments || [];
  const N = list.length;
  const spots = [];

  const jointGap = sampleIds(list, (i) => {
    const sf = i.factors?.inventory?.stockFlowJoint;
    if (sf?.available) return false;
    const jl = i.capitalAttention?.jointWithInventory;
    const hasJointLabel = jl && jl !== '暂无' && jl !== '—';
    return !hasJointLabel;
  });
  const jointFromDebt = ctx.debtBoard?.byType?.joint_gap || 0;
  const jointN = Math.max(jointGap.length, jointFromDebt);
  if (jointN > 0) {
    spots.push(
      spot({
        id: 'coverage_joint',
        label: '合证覆盖盲区',
        severity: jointN >= 8 ? 'critical' : 'high',
        n: jointN,
        instruments: jointGap,
        question: `合证缺口 ${jointN}：哪些品种结论在无库存×资金合证下仍被当「结构」？`,
        remedy: 'debt-ops sync + 降档不可判定；禁止假合证',
        dataSource: 'debt-board+instruments',
      })
    );
  }

  const stale = sampleIds(
    list,
    (i) =>
      (i.calendarStaleness?.lagDays ?? i.calendarStaleness?.daysBehind ?? 0) > 1 ||
      (i.intelCenter?.debts || []).some((d) => d.type === 'stale_data')
  );
  const staleDebt = ctx.debtBoard?.byType?.stale_data || 0;
  const staleN = Math.max(stale.length, staleDebt);
  if (staleN > 0) {
    spots.push(
      spot({
        id: 'coverage_stale',
        label: '数据滞后盲区',
        severity: staleN >= 5 ? 'high' : 'medium',
        n: staleN,
        instruments: stale,
        question: `滞后 ${staleN}：收盘/日K 未对齐时，Top 结论是否应静默？`,
        remedy: '执行 mustPay sync 并复核 lag≤1',
        dataSource: 'calendarStaleness+debt',
      })
    );
  }

  const noOppose = sampleIds(
    list,
    (i) =>
      i.intelCenter?.primaryClaim?.status === 'active' &&
      !(i.intelCenter?.primaryClaim?.evidenceAgainst || []).length
  );
  if (noOppose.length) {
    spots.push(
      spot({
        id: 'evidence_no_oppose',
        label: '缺反对证据',
        severity: 'high',
        n: noOppose.length,
        instruments: noOppose,
        question: `缺反对 ${noOppose.length}：这些 active 命题为何未过红队/门禁降档？`,
        remedy: '强制至少 1 条 against；否则禁 Interrupt',
        dataSource: 'primaryClaim.evidenceAgainst',
      })
    );
  }

  const noN = sampleIds(
    list,
    (i) =>
      i.intelCenter?.primaryClaim &&
      i.intelCenter.primaryClaim.n == null &&
      (i.intelCenter.primaryClaim.nDisplay == null ||
        i.intelCenter.primaryClaim.nDisplay === '暂无')
  );
  if (noN.length) {
    spots.push(
      spot({
        id: 'evidence_no_n',
        label: '命题无样本量 n',
        severity: 'medium',
        n: noN.length,
        instruments: noN,
        question: `无 n ${noN.length}：命中/权重是否被裸展示？`,
        remedy: '标暂无；n<20 降启发式',
        dataSource: 'primaryClaim.n',
      })
    );
  }

  const evCritical = ctx.evidenceAuditBoard?.counts?.critical || 0;
  const evHigh = ctx.evidenceAuditBoard?.counts?.high || 0;
  if (evCritical + evHigh > 0) {
    spots.push(
      spot({
        id: 'evidence_audit',
        label: '证据 DSL 审计告警',
        severity: evCritical > 0 ? 'critical' : 'high',
        n: evCritical + evHigh,
        instruments: (ctx.evidenceAuditBoard?.critical || ctx.evidenceAuditBoard?.items || [])
          .slice(0, 4)
          .map((x) => ({
            instrumentId: x.instrumentId,
            instrumentName: x.instrumentName || x.instrumentId,
          })),
        question: `证据审计 critical ${evCritical} · high ${evHigh}：哪条在装源/装 n？`,
        remedy: '修 dataSource / 去掉假填充嫌疑',
        dataSource: 'intel-evidence-audit',
      })
    );
  }

  const honestyDenied =
    ctx.mechanismBoard?.counts?.honestyDenied ||
    ctx.shockGraph?.mechanismHonestyDenied ||
    0;
  if (honestyDenied > 0) {
    spots.push(
      spot({
        id: 'mechanism_honesty',
        label: '相关冒充传导',
        severity: 'high',
        n: honestyDenied,
        instruments: [],
        question: `机制诚实否决 ${honestyDenied}：是否仍有「成本传导」文案漏网？`,
        remedy: '统一降为滞后共动，待合证/基差/事件',
        dataSource: 'mechanism-honesty',
      })
    );
  }

  const mechLive =
    ctx.mechanismBoard?.counts?.liveActive || ctx.mechanismBoard?.counts?.live || 0;
  const mechPendingN = ctx.mechanismBoard?.counts?.pendingInsufficientN || 0;
  if (mechLive === 0 && mechPendingN > 0) {
    spots.push(
      spot({
        id: 'mechanism_n_starved',
        label: '机制网 n 饥饿',
        severity: 'medium',
        n: mechPendingN,
        instruments: [],
        question: `活边=0 但 n不足 ${mechPendingN}：冲击图是否在装「网络」？`,
        remedy: '展示休眠/n不足分母，禁止编 corr',
        dataSource: 'mechanism-board',
      })
    );
  }

  const strongNoRetrieval = sampleIds(list, (i) => {
    const conf = i.intelCenter?.primaryClaim?.confidence || i.intelCenter?.beliefLevel;
    const ret = i.intelCenter?.retrieval || i.intelCenter?.memo?.retrieval;
    return conf === '强结构' && ret && ret.available === false;
  });
  if (strongNoRetrieval.length) {
    spots.push(
      spot({
        id: 'retrieval_empty_strong',
        label: '强结构无档案召回',
        severity: 'medium',
        n: strongNoRetrieval.length,
        instruments: strongNoRetrieval,
        question: `强结构且检索空 ${strongNoRetrieval.length}：结论是否仅靠现场字段？`,
        remedy: '备忘录明示「暂无先例」；勿暗示历史支持',
        dataSource: 'retrieval+confidence',
      })
    );
  }

  if (
    ctx.processScorecard?.weightProposal?.pendingApproval ||
    ctx.processLearning?.weightProposal?.pendingApproval
  ) {
    spots.push(
      spot({
        id: 'learning_weight_pending',
        label: '过程权待人审',
        severity: 'high',
        n: 1,
        instruments: [],
        question: '权提案待审：生效权是否仍可能被误读为已更新？',
        remedy: 'Hub 批准/驳回前禁止静默落盘',
        dataSource: 'process-learning',
      })
    );
  }

  const sampleN = ctx.processLearning?.sampleN ?? ctx.kpis?.sampleN ?? null;
  if (sampleN != null && sampleN < 20) {
    spots.push(
      spot({
        id: 'learning_low_n',
        label: '过程学习样本不足',
        severity: 'medium',
        n: sampleN,
        instruments: [],
        question: `过程样本 n=${sampleN}<20：改权/剧本切换是否应 deferred？`,
        remedy: '标暂无/启发式；禁止当校准完成',
        dataSource: 'process-learning',
        note: `n=${sampleN}`,
      })
    );
  }

  const attn = ctx.attentionBudget;
  const deep = attn?.deepCount ?? attn?.counts?.deep ?? null;
  const trueR =
    attn?.trueRationing === true || list.some((i) => i.intelCenter?.attention?.trueRationing);
  const ration = ctx.attentionRationBoard;
  if (N > 0 && deep != null && deep >= N && N > 12) {
    spots.push(
      spot({
        id: 'attention_no_ration',
        label: '注意力未真偷懒',
        severity: 'high',
        n: N,
        instruments: [],
        question: `深算 ${deep}/${N}：是否仍全量深算冒充配额？`,
        remedy: 'skip/lite 真跳过 evaluate；深算 8–12',
        dataSource: 'attention-budget',
        note: `deep=${deep} N=${N}`,
      })
    );
  } else if (ration && ration.integrityOk === false) {
    spots.push(
      spot({
        id: 'attention_ration_integrity',
        label: '注意力省算力完整性告警',
        severity: 'high',
        n: N,
        instruments: [],
        question: ration.integrityFails?.[0]?.reason || '省算力板告警',
        remedy: '检查 trueRationing / full≤12 / 禁止 post-hoc-label',
        dataSource: 'attention-ration-board',
        note: ration.display,
      })
    );
  } else if (N > 20 && !trueR && deep == null) {
    spots.push(
      spot({
        id: 'attention_unknown',
        label: '注意力配额不可审计',
        severity: 'medium',
        n: N,
        instruments: [],
        question: '注意力板缺 trueRationing/深算分母：无法证明偷懒',
        remedy: '挂 attentionBudget 计数 k/N + attentionRationBoard',
        dataSource: 'attention-budget',
      })
    );
  } else if (N > 20 && ration?.savingsPct != null && ration.savingsPct < 20) {
    spots.push(
      spot({
        id: 'attention_low_savings',
        label: '注意力省算力偏低',
        severity: 'medium',
        n: N,
        instruments: [],
        question: `阶段省算仅 ${ration.savingsPct}%：lite/skip 是否未真跳过？`,
        remedy: '核对 computeMode 分流与 FULL_STAGES 跳过',
        dataSource: 'attention-ration-board',
        note: ration.savingsDisplay,
      })
    );
  }

  const shiftDenied =
    ctx.interruptChannel?.shiftDeniedCount || ctx.interruptChannel?.deniedByShift || 0;
  const pendingIch =
    ctx.interruptChannel?.pending?.length || ctx.interruptChannel?.pendingCount || 0;
  if (
    shiftDenied > 0 ||
    (ctx.shift?.allowInterrupt === false && (ctx.interruptCandidates || 0) > 0)
  ) {
    spots.push(
      spot({
        id: 'interrupt_shift_denied',
        label: '打断被班次挡住',
        severity: 'medium',
        n: shiftDenied || ctx.interruptCandidates || 1,
        instruments: [],
        question: '班次拒投 Interrupt：改口是否只停在 Hub 列表？',
        remedy: '盘中短讯通道 / 收盘后完整改口',
        dataSource: 'interrupt-channel+shift',
      })
    );
  }
  if (pendingIch > 3) {
    spots.push(
      spot({
        id: 'interrupt_backlog',
        label: '打断积压未确认',
        severity: 'medium',
        n: pendingIch,
        instruments: [],
        question: `未确认打断 ${pendingIch}：指挥官是否漏看？`,
        remedy: 'ack 通道 + 日上限',
        dataSource: 'interrupt-channel',
      })
    );
  }

  const museumN = ctx.museumBoard?.counts?.entries || ctx.museumBoard?.entries?.length || 0;
  const activeN = list.filter((i) => i.intelCenter?.primaryClaim?.status === 'active').length;
  if (museumN === 0 && activeN >= 10) {
    spots.push(
      spot({
        id: 'museum_empty',
        label: '失效博物馆空库',
        severity: 'medium',
        n: activeN,
        instruments: [],
        question: `active ${activeN} 但博物馆 0：证伪执行是否从未进货？`,
        remedy: '跑 falsify executor；空库诚实展示',
        dataSource: 'failure-museum',
        note: '空库≠安全，是无失败样本',
      })
    );
  }

  const criticalUnknown = sampleIds(
    list,
    (i) =>
      (i.intelCenter?.memo?.unknownMap?.criticalGaps || i.intelCenter?.unknownMap?.criticalGaps || [])
        .length > 0
  );
  const unkBoardCrit = ctx.unknownBoard?.criticalCount || ctx.unknownBoard?.counts?.critical || 0;
  const unkN = Math.max(criticalUnknown.length, unkBoardCrit);
  if (unkN > 0) {
    spots.push(
      spot({
        id: 'unknown_critical',
        label: 'Unknown Map 关键缺口',
        severity: unkN >= 6 ? 'high' : 'medium',
        n: unkN,
        instruments: criticalUnknown,
        question: `关键 Unknown ${unkN}：结论是否越过「不可判定」？`,
        remedy: '缺口不收敛则降档；写入债务周还',
        dataSource: 'unknown-map',
      })
    );
  }

  if (ctx.quietBrakeBoard?.falseQuietRisk) {
    spots.push(
      spot({
        id: 'false_quiet',
        label: '假静默风险',
        severity: 'high',
        n: 1,
        instruments: [],
        question: '日差静默但有 Interrupt/高惊讶：是否漏记物质变更？',
        remedy: '亮假静默闭环：复核物质桶→确认/消解；不翻转 quietDay 真值',
        dataSource: 'quiet-brake-board',
      })
    );
  }

  const strongBlocked = sampleIds(
    list,
    (i) =>
      i.intelCenter?.beliefLevel === '强结构' && i.intelCenter?.gates?.top5?.pass === false
  );
  if (strongBlocked.length) {
    spots.push(
      spot({
        id: 'confidence_gate_conflict',
        label: '强结构却未过门禁',
        severity: 'high',
        n: strongBlocked.length,
        instruments: strongBlocked,
        question: `强结构·门禁未过 ${strongBlocked.length}：UI 是否仍露出算命 chrome？`,
        remedy: '幕僚面 observe/brief；禁交易指令',
        dataSource: 'belief+gates',
      })
    );
  }

  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  spots.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0) || b.n - a.n);

  const counts = {
    critical: spots.filter((s) => s.severity === 'critical').length,
    high: spots.filter((s) => s.severity === 'high').length,
    medium: spots.filter((s) => s.severity === 'medium').length,
    low: spots.filter((s) => s.severity === 'low').length,
    total: spots.length,
    instrumentUniverse: N,
  };

  let severity = 'clear';
  if (counts.critical) severity = 'critical';
  else if (counts.high) severity = 'high';
  else if (counts.medium) severity = 'medium';
  else if (counts.low) severity = 'low';

  const questions = spots.slice(0, 6).map((s, idx) => ({
    priority: s.severity === 'critical' || s.severity === 'high' ? 'P1' : 'P2',
    score: 50 - idx * 3 - (s.severity === 'critical' ? 0 : s.severity === 'high' ? 4 : 10),
    instrumentId: s.instruments[0]?.instrumentId || null,
    instrumentName: s.instruments[0]?.instrumentName || '系统',
    question: s.question || s.label,
    reasons: ['元智能自审', s.id, `n=${s.nDisplay}`],
    metaSpotId: s.id,
    severity: s.severity,
    nDisplay: s.nDisplay,
    dataSource: 'intel-meta-intelligence',
  }));

  const topLabels = spots
    .slice(0, 3)
    .map((s) => `${s.label}(${s.nDisplay})`)
    .join(' · ');

  const board = {
    version: META_VERSION,
    asOf,
    available: true,
    severity,
    severityLabel:
      severity === 'clear'
        ? '暂无可审计盲区'
        : severity === 'critical'
          ? '临界盲区'
          : severity === 'high'
            ? '高盲区'
            : severity === 'medium'
              ? '中盲区'
              : '低盲区',
    spots: spots.slice(0, 12),
    top: spots.slice(0, 5),
    counts,
    questions,
    display:
      spots.length === 0
        ? '元智能 · 暂无可审计盲区（不代表全知）'
        : `元智能 · ${counts.total} 盲区 · 临界 ${counts.critical} · 高 ${counts.high}${
            topLabels ? ` · ${topLabels}` : ''
          }`,
    note: '仅聚合真实板/字段；无信号不编造盲区。clear≠全覆盖。临界盲区可挂还债动作。',
    dataSource: 'intel-meta-intelligence',
    method: 'pack-self-audit+debt-bridge',
  };

  return attachMetaDebtBridge(board, ctx.debtBoard || null);
}

/**
 * 给盲区挂 ops 计划，并生成可执行还债队列（不假装还清）
 */
function attachMetaDebtBridge(metaBoard, debtBoard = null) {
  if (!metaBoard) return metaBoard;
  let planForDebt;
  try {
    planForDebt = require('./intel-debt-ops').planForDebt;
  } catch {
    planForDebt = null;
  }

  const spots = (metaBoard.spots || []).map((s) => {
    const map = META_SPOT_DEBT[s.id] || null;
    if (!map) {
      return {
        ...s,
        opsRunnable: false,
        opsAction: 'manual',
        opsLabel: s.remedy || '须人工研判',
        debtType: null,
      };
    }
    if (map.loop === 'false_quiet' || map.action === 'ack_false_quiet') {
      return {
        ...s,
        opsRunnable: false,
        opsAction: 'ack_false_quiet',
        opsLabel: '假静默闭环确认',
        debtType: null,
        loop: 'false_quiet',
      };
    }
    if (!map.debtType) {
      return {
        ...s,
        opsRunnable: false,
        opsAction: map.action || 'manual',
        opsLabel: s.remedy || '须人工',
        debtType: null,
      };
    }
    const plan = planForDebt
      ? planForDebt({ type: map.debtType, instrumentId: s.instruments?.[0]?.instrumentId || null })
      : { action: 'manual', label: '待分类', runnable: false };
    return {
      ...s,
      debtType: map.debtType,
      opsAction: plan.action,
      opsLabel: plan.label,
      opsRunnable: Boolean(plan.runnable && map.preferRunnable !== false),
      opsVerify: plan.verify || null,
    };
  });

  const runnableRows = [];
  for (const s of spots) {
    if (!s.opsRunnable || !s.debtType) continue;
    const targets = (s.instruments || []).filter((i) => i.instrumentId);
    if (!targets.length) {
      // 无品种样本时仍记类型债，供与 mustPay 对齐
      continue;
    }
    for (const t of targets.slice(0, 4)) {
      runnableRows.push({
        source: 'meta',
        metaSpotId: s.id,
        metaLabel: s.label,
        type: s.debtType,
        instrumentId: t.instrumentId,
        instrumentName: t.instrumentName || t.instrumentId,
        label: s.label,
        opsAction: s.opsAction,
        opsLabel: s.opsLabel,
        opsRunnable: true,
        severity: s.severity,
        nDisplay: s.nDisplay,
        impact: s.severity === 'critical' ? 'critical' : 'high',
      });
    }
  }

  // 与债务板 mustPay 对齐：已在 mustPay 的标 linked
  const mustPayKeys = new Set(
    (debtBoard?.weeklyMustPay || []).map((d) => `${d.type}|${String(d.instrumentId || '').toLowerCase()}`)
  );
  for (const row of runnableRows) {
    row.linkedMustPay = mustPayKeys.has(`${row.type}|${String(row.instrumentId).toLowerCase()}`);
  }

  const pendingRunnable = runnableRows.length;
  const unlinked = runnableRows.filter((r) => !r.linkedMustPay);

  const bridge = {
    version: META_VERSION,
    pendingRunnable,
    unlinkedCount: unlinked.length,
    runnable: runnableRows.slice(0, 12),
    unlinked: unlinked.slice(0, 8),
    display:
      pendingRunnable === 0
        ? '元智能还债桥 · 暂无自动可还项'
        : `元智能还债桥 可执行 ${pendingRunnable} · 未入 mustPay ${unlinked.length}`,
    note: '可执行项走 debt-ops sync；合证类 partial；禁止文案假装还清',
    dataSource: 'intel-meta-intelligence',
    method: 'spot→debt-ops',
  };

  const counts = {
    ...(metaBoard.counts || {}),
    opsRunnable: pendingRunnable,
    opsUnlinked: unlinked.length,
  };

  return {
    ...metaBoard,
    spots,
    top: spots.slice(0, 5),
    counts,
    debtBridge: bridge,
    display:
      pendingRunnable > 0
        ? `${metaBoard.display} · 可还 ${pendingRunnable}`
        : metaBoard.display,
    method: 'pack-self-audit+debt-bridge',
  };
}

/**
 * 把元智能可还盲区注入债务板 mustPay（去重），再交 attachDebtOpsPlan
 */
function mergeMetaBridgeIntoDebtBoard(debtBoard, metaBoard, asOf) {
  if (!debtBoard || !metaBoard?.debtBridge?.unlinked?.length) return debtBoard;
  const existing = new Set(
    (debtBoard.weeklyMustPay || []).map((d) => `${d.type}|${String(d.instrumentId || '').toLowerCase()}`)
  );
  const injected = [];
  for (const row of metaBoard.debtBridge.unlinked) {
    const key = `${row.type}|${String(row.instrumentId).toLowerCase()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    injected.push({
      type: row.type,
      instrumentId: row.instrumentId,
      instrumentName: row.instrumentName,
      label: `元智能·${row.metaLabel || row.label}`,
      impact: row.impact || 'high',
      source: 'meta-debt-bridge',
      metaSpotId: row.metaSpotId,
      daysOpen: 0,
      nDisplay: row.nDisplay || null,
    });
  }
  if (!injected.length) return debtBoard;
  const weeklyMustPay = [...(debtBoard.weeklyMustPay || []), ...injected];
  return {
    ...debtBoard,
    weeklyMustPay,
    metaInjected: injected.length,
    display: `${debtBoard.display || '问题债务'} · 元智注入 ${injected.length}`,
    method: `${debtBoard.method || 'debt'}+meta-inject`,
  };
}

function enrichQuestionQueueWithMeta(queue, board) {
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
      priorityLabel: '元智能',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      nDisplay: q.nDisplay,
      metaSpotId: q.metaSpotId,
      dataSource: 'intel-meta-intelligence',
    });
    existing.add(key);
  }
  // 可还盲区升 P1 问句
  for (const row of board.debtBridge?.runnable || []) {
    const q = `元智能可还债：${row.metaLabel || row.label} · ${row.instrumentName} · ${row.opsLabel}`;
    const key = `${row.instrumentId}|${q}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: row.instrumentId,
      instrumentName: row.instrumentName,
      sector: null,
      priority: 'P1',
      priorityLabel: '元智能还债',
      score: 46,
      question: q,
      reasons: ['元智能还债桥', row.metaSpotId, row.type],
      claimId: null,
      pushTier: 'watch',
      nDisplay: row.nDisplay || '暂无',
      metaSpotId: row.metaSpotId,
      opsRunnable: true,
      dataSource: 'intel-meta-intelligence',
    });
    existing.add(key);
  }
  if (!extra.length) return queue;
  const all = [...(queue.all || []), ...extra].sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    ...queue,
    all,
    deepQueue: all.slice(0, 24),
    version: `${queue.version || ''}+meta`,
  };
}

module.exports = {
  META_VERSION,
  META_SPOT_DEBT,
  buildMetaIntelligenceBoard,
  attachMetaDebtBridge,
  mergeMetaBridgeIntoDebtBoard,
  enrichQuestionQueueWithMeta,
};
