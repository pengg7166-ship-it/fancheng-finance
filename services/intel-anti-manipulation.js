/**
 * 情报中心 · 反操纵纪律（构想 §31/§32/§43/§55）
 * 人工标注 = 硬阻断；自动嫌疑 = 真实可观察信号（叙事超前/新闻单源/放量故事/内外分裂）。
 * 禁止合成 0–100「操纵分」；无信号 →「暂无」。
 */
const ANTI_MANIP_VERSION = 'v2.89.7-anti-manip-product';

const NEWS_HARDNESS_FLOOR_FOR_STRONG = 0.4;
const NEWS_HARDNESS_INTERRUPT_MIN = 0.35;

function isNewsTypedEvidence(e) {
  const t = String(e?.evidenceType || e?.dataSource || '').toLowerCase();
  return /news|叙事|headline|media|舆情/.test(t) || e?.lane === 'news';
}

function isStructureTypedEvidence(e) {
  const t = String(e?.evidenceType || e?.dataSource || '').toLowerCase();
  return /inventory|basis|oi|capital|joint|stock|仓单|持仓|基差|合证/.test(t);
}

function resolveNarrative(inst, opts = {}) {
  if (opts.narrative) return opts.narrative;
  if (inst?.intelCenter?.narrative) return inst.intelCenter.narrative;
  try {
    return require('./intel-narrative-epidemiology').assessNarrativeEpidemiology(inst);
  } catch {
    return null;
  }
}

function resolvePricing(inst, claim, opts = {}) {
  if (opts.pricingState) return opts.pricingState;
  if (inst?.intelCenter?.pricingState) return inst.intelCenter.pricingState;
  try {
    return require('./intel-pricing-state').assessPricingState(inst, claim);
  } catch {
    return null;
  }
}

/**
 * 自动嫌疑扫描：只读真实字段，不编造分数
 */
function scanAutoSuspectSignals(inst, claim, opts = {}) {
  const signals = [];
  if (!inst?.id) return signals;

  const narrative = resolveNarrative(inst, opts);
  const dual = opts.dualNarrative || inst?.dualNarrative || inst?.intelCenter?.dualNarrative;
  const pricing = resolvePricing(inst, claim, opts);
  const volRatio =
    inst?.technical?.volume?.ratio ??
    inst?.volumeRatio ??
    inst?.factors?.technical?.volume?.ratio ??
    null;
  const joint = inst?.factors?.inventory?.stockFlowJoint;
  const jointOk = joint?.available === true;
  const jl = inst?.capitalAttention?.jointWithInventory;
  const hasJointLabel = jl && jl !== '暂无' && jl !== '—';

  const allEv = [...(claim?.evidenceFor || []), ...(claim?.evidenceAgainst || [])];
  const newsEv = allEv.filter(isNewsTypedEvidence);
  const structEv = allEv.filter(isStructureTypedEvidence);
  const newsOnly = newsEv.length > 0 && structEv.length === 0 && !jointOk && !hasJointLabel;

  if (narrative?.narrativeAhead) {
    signals.push({
      id: 'narrative_ahead',
      label: '叙事超前于结构',
      severity: 'medium',
      nDisplay: narrative?.contagion?.nDisplay || '暂无',
      note: narrative.alert || narrative.display || '故事加速但合证未跟',
      dataSource: 'narrative-epidemiology',
    });
  }

  if (newsOnly && (claim?.confidence === '强结构' || claim?.confidence === '弱结构')) {
    signals.push({
      id: 'news_only_structure',
      label: '新闻主导结构结论',
      severity: 'high',
      nDisplay: String(newsEv.length),
      note: `新闻证据 ${newsEv.length} · 结构/合证暂无`,
      dataSource: 'evidence-dsl+joint',
    });
  }

  if (volRatio != null && Number.isFinite(Number(volRatio)) && Number(volRatio) >= 1.65) {
    if (narrative?.narrativeAhead || newsOnly) {
      signals.push({
        id: 'vol_spike_story',
        label: '放量伴随故事',
        severity: 'medium',
        nDisplay: String(Number(volRatio).toFixed(2)),
        note: `量比 ${Number(volRatio).toFixed(2)} + 叙事/新闻主导`,
        dataSource: 'technical.volume+narrative',
      });
    }
  }

  if (dual?.regime === 'split' && (newsOnly || narrative?.narrativeAhead)) {
    signals.push({
      id: 'split_news',
      label: '内外分裂+故事单源',
      severity: 'medium',
      nDisplay: dual?.nDisplay || '暂无',
      note: dual.display || '分裂市下新闻易绑架',
      dataSource: 'dual-narrative',
    });
  }

  if (narrative?.phase === 'peak' && pricing?.state === 'priced-in') {
    signals.push({
      id: 'priced_peak_story',
      label: '叙事高峰且已定价',
      severity: 'low',
      nDisplay: narrative?.contagion?.nDisplay || '暂无',
      note: '利好出尽风险 · 观察非硬阻断',
      dataSource: 'narrative+pricing',
    });
  }

  return signals;
}

function detectHumanManipulation(analyst) {
  const anns = analyst?.annotations || analyst?.effects || [];
  const manipAnns = anns.filter(
    (a) => a.annotationType === 'manipulation_risk' || a.type === 'manipulation_risk'
  );
  const newsDelta = analyst?.reliabilityTargets?.news?.delta;
  const newsN = analyst?.reliabilityTargets?.news?.n ?? null;
  const flagged = manipAnns.length > 0 || (newsDelta != null && newsDelta <= -0.3);
  return {
    flagged,
    manipAnns,
    newsDelta,
    newsN,
    reasons: manipAnns.map((a) => a.reason || '操纵风险标注').slice(0, 3),
  };
}

/**
 * 合并人工硬标 + 自动嫌疑
 */
function detectManipulationSignals(inst, analyst, opts = {}) {
  const claim = opts.claim || inst?.intelCenter?.primaryClaim || null;
  const human = detectHumanManipulation(analyst);
  const autoSignals = scanAutoSuspectSignals(inst, claim, opts);
  const highAuto = autoSignals.filter((s) => s.severity === 'high').length;
  const medAuto = autoSignals.filter((s) => s.severity === 'medium' || s.severity === 'high').length;

  if (human.flagged) {
    return {
      version: ANTI_MANIP_VERSION,
      flagged: true,
      autoSuspect: autoSignals.length > 0,
      softWatch: false,
      source: 'analyst',
      n: human.manipAnns.length || (human.newsN != null ? human.newsN : 1),
      nDisplay: String(human.manipAnns.length || human.newsN || 1),
      newsDelta: human.newsDelta ?? -0.35,
      newsHardnessCap: NEWS_HARDNESS_FLOOR_FOR_STRONG,
      reasons: human.reasons.length ? human.reasons : ['新闻可靠性大幅下调'],
      autoSignals,
      maxConfidence: '弱结构',
      blockInterrupt: true,
      blockTop5: true,
      requiresHumanAck: false,
      display: `操纵风险·人工 n=${human.manipAnns.length || human.newsN || 1}${
        autoSignals.length ? ` · 自动信号 ${autoSignals.length}` : ''
      } · 禁 Interrupt/Top5`,
      note: '人工标注优先硬阻断；自动信号仅并列展示',
      dataSource: 'intel-anti-manipulation',
      method: 'analyst-hard+auto-screen',
    };
  }

  if (!autoSignals.length) {
    return {
      version: ANTI_MANIP_VERSION,
      flagged: false,
      autoSuspect: false,
      softWatch: false,
      source: 'none',
      n: 0,
      nDisplay: '暂无',
      newsHardnessCap: null,
      autoSignals: [],
      reasons: [],
      display: '暂无操纵嫌疑（人工+自动均无）',
      note: '不编造操纵分；无信号不等于市场干净',
      dataSource: 'intel-anti-manipulation',
      method: 'analyst+auto-screen',
    };
  }

  const hardFlag = highAuto >= 1 || medAuto >= 2;
  const softWatch = !hardFlag;

  return {
    version: ANTI_MANIP_VERSION,
    flagged: hardFlag,
    autoSuspect: true,
    softWatch,
    source: 'auto',
    n: autoSignals.length,
    nDisplay: String(autoSignals.length),
    newsHardnessCap: NEWS_HARDNESS_FLOOR_FOR_STRONG,
    reasons: autoSignals.map((s) => s.label).slice(0, 4),
    autoSignals,
    maxConfidence: '弱结构',
    blockInterrupt: hardFlag,
    blockTop5: hardFlag,
    requiresHumanAck: softWatch || hardFlag,
    display: hardFlag
      ? `操纵嫌疑·自动 n=${autoSignals.length} · 多信号 · 禁 Interrupt/Top5 · 待人复核`
      : `操纵观察·自动 n=${autoSignals.length} · 待人审 · 新闻硬度降档`,
    note: hardFlag
      ? '自动硬旗来自可观察信号聚合，非操纵评分；建议分析师确认或驳回'
      : '单信号仅观察+硬度帽，不硬阻断 Interrupt',
    dataSource: 'intel-anti-manipulation',
    method: 'auto-screen+optional-analyst',
  };
}


/**
 * 对新闻类证据施加硬度上限（硬旗或软观察）
 */
function applyManipulationToEvidence(evidenceList, signals) {
  const apply = signals?.flagged || signals?.softWatch || signals?.newsHardnessCap != null;
  if (!apply || !evidenceList?.length) return evidenceList || [];
  const cap = signals.newsHardnessCap ?? NEWS_HARDNESS_FLOOR_FOR_STRONG;
  return evidenceList.map((e) => {
    if (!isNewsTypedEvidence(e)) return e;
    const base =
      e.hardness != null
        ? Number(e.hardness)
        : e.reliability?.score != null
          ? Number(e.reliability.score)
          : 0.5;
    const next = Math.min(base, cap);
    return {
      ...e,
      hardness: +next.toFixed(3),
      reliability: {
        ...(e.reliability || {}),
        score: +next.toFixed(3),
        manipulationCapped: true,
        label: next >= 0.75 ? '高' : next >= 0.5 ? '中' : '低',
      },
      manipulationNote: `操纵纪律硬度上限 ${cap}${signals.softWatch ? '（观察）' : ''}`,
    };
  });
}

/**
 * 门禁附加检查：veto/freeze/manip/news hardness
 */
function manipulationGateChecks(claim, analyst, signals, profileName) {
  const checks = [];
  let pass = true;
  let maxConfidence = null;

  if (analyst?.vetoed) {
    checks.push({
      id: 'analyst_not_vetoed',
      label: '分析师未否决',
      pass: false,
      value: 'vetoed',
      required: '非 veto',
    });
    pass = false;
  }

  if (analyst?.frozen && (profileName === 'top5' || profileName === 'interrupt')) {
    checks.push({
      id: 'not_frozen',
      label: '命题未冻结',
      pass: false,
      value: 'frozen',
      required: '非 freeze',
    });
    pass = false;
  }

  if (signals?.flagged && (profileName === 'top5' || profileName === 'interrupt')) {
    checks.push({
      id: 'manipulation_risk',
      label: '无操纵硬旗',
      pass: false,
      value: signals.display || 'flagged',
      required: '无 manipulation 硬旗',
    });
    pass = false;
    maxConfidence = '弱结构';
  }

  if (signals?.softWatch && profileName === 'interrupt') {
    checks.push({
      id: 'manipulation_soft_watch',
      label: '操纵观察中（不硬阻断）',
      pass: true,
      value: signals.display || 'softWatch',
      required: '人审或补结构证据',
    });
    maxConfidence = maxConfidence || '弱结构';
  }

  if (profileName === 'top5' || profileName === 'interrupt') {
    const newsEv = [...(claim?.evidenceFor || []), ...(claim?.evidenceAgainst || [])].filter(
      isNewsTypedEvidence
    );
    if (newsEv.length) {
      const minH = Math.min(
        ...newsEv.map((e) =>
          e.hardness != null
            ? Number(e.hardness)
            : e.reliability?.score != null
              ? Number(e.reliability.score)
              : 0.5
        )
      );
      const ok = minH >= NEWS_HARDNESS_INTERRUPT_MIN;
      checks.push({
        id: 'news_hardness',
        label: '新闻证据硬度',
        pass: ok,
        value: Number.isFinite(minH) ? minH.toFixed(2) : '暂无',
        required: `≥${NEWS_HARDNESS_INTERRUPT_MIN}`,
      });
      if (!ok) {
        pass = false;
        maxConfidence = maxConfidence || '叙事分歧';
      }
    }
  }

  return { checks, pass, maxConfidence };
}

/**
 * Pack 级反操纵纪律板
 */
function buildAntiManipulationBoard(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const flagged = [];
  const watching = [];
  const questions = [];

  for (const inst of instruments || []) {
    const m = inst?.intelCenter?.antiManipulation;
    if (!m) continue;
    const row = {
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
      display: m.display,
      source: m.source || (m.flagged ? 'analyst' : 'auto'),
      nDisplay: m.nDisplay || '暂无',
      reasons: m.reasons || [],
      autoSignals: m.autoSignals || [],
      requiresHumanAck: Boolean(m.requiresHumanAck),
      blockInterrupt: Boolean(m.blockInterrupt),
      dataSource: 'intel-anti-manipulation',
    };
    if (m.flagged) {
      flagged.push(row);
      questions.push({
        priority: 'P1',
        score: 44,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `操纵硬旗「${(m.reasons || [])[0] || m.display}」：确认标注还是驳回？`,
        reasons: ['反操纵纪律', m.source || 'flag', `n=${m.nDisplay}`],
        dataSource: 'intel-anti-manipulation',
      });
    } else if (m.autoSuspect || m.softWatch) {
      watching.push(row);
      questions.push({
        priority: 'P2',
        score: 32,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `操纵观察 n=${m.nDisplay}：是否补结构证据或标注 manipulation_risk？`,
        reasons: ['反操纵自动扫描', ...(m.reasons || []).slice(0, 2)],
        dataSource: 'intel-anti-manipulation',
      });
    }
  }

  const counts = {
    flagged: flagged.length,
    watching: watching.length,
    requiresAck: flagged.filter((r) => r.requiresHumanAck).length + watching.length,
    total: flagged.length + watching.length,
  };

  return {
    version: ANTI_MANIP_VERSION,
    asOf,
    available: true,
    flagged: flagged.slice(0, 12),
    watching: watching.slice(0, 12),
    top: [...flagged, ...watching].slice(0, 10),
    counts,
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 10),
    display:
      counts.total === 0
        ? '反操纵 · 暂无嫌疑（人工+自动）'
        : `反操纵 · 硬旗 ${counts.flagged} · 观察 ${counts.watching}`,
    note: '硬旗禁 Interrupt/Top5；观察仅降新闻硬度。禁止操纵评分。',
    dataSource: 'intel-anti-manipulation',
    method: 'board-from-instrument-signals',
  };
}

function enrichQuestionQueueWithAntiManip(queue, board) {
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
      priorityLabel: '反操纵',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      dataSource: 'intel-anti-manipulation',
    });
    existing.add(key);
  }
  if (!extra.length) return queue;
  const all = [...(queue.all || []), ...extra].sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    ...queue,
    all,
    deepQueue: all.slice(0, 24),
    version: `${queue.version || ''}+antimanip`,
  };
}

module.exports = {
  ANTI_MANIP_VERSION,
  NEWS_HARDNESS_FLOOR_FOR_STRONG,
  NEWS_HARDNESS_INTERRUPT_MIN,
  detectManipulationSignals,
  scanAutoSuspectSignals,
  applyManipulationToEvidence,
  manipulationGateChecks,
  isNewsTypedEvidence,
  buildAntiManipulationBoard,
  enrichQuestionQueueWithAntiManip,
};
