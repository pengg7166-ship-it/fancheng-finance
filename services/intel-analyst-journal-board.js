/**
 * 情报中心 · 分析师日记板（构想 §55）
 * 跨品种聚合标注：冻结/否决/剧本覆写/操纵风险 — 人 Δ 与机器日差并列。
 */
const { readJsonl } = require('./intel-memory');
const {
  ANNOTATION_TYPES,
  WORKBENCH_VERSION,
  loadReliabilityTable,
} = require('./intel-analyst-workbench');

const JOURNAL_VERSION = 'v2.85.0-analyst-journal';

function labelOf(type) {
  return ANNOTATION_TYPES[type]?.label || type || '标注';
}

function dayKey(iso) {
  if (!iso) return null;
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function buildAnalystJournalBoard(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const all = readJsonl('analyst-annotations.jsonl', 1500);
  const nameById = {};
  for (const inst of instruments || []) {
    if (inst?.id) nameById[String(inst.id).toLowerCase()] = inst.name || inst.id;
  }

  const entries = [];
  const counts = {
    total: 0,
    today: 0,
    freeze: 0,
    veto: 0,
    playbookPin: 0,
    manipulation: 0,
    other: 0,
  };

  for (const a of all) {
    if (!a?.instrumentId || !a.annotationType) continue;
    const def = ANNOTATION_TYPES[a.annotationType];
    if (!def) continue;
    counts.total += 1;
    const day = dayKey(a.recordedAt || a.at || a.ts || a.savedAt) || null;
    if (day === asOf) counts.today += 1;

    let bucket = 'other';
    if (a.annotationType === 'freeze_claim') {
      counts.freeze += 1;
      bucket = 'freeze';
    } else if (a.annotationType === 'veto') {
      counts.veto += 1;
      bucket = 'veto';
    } else if (a.annotationType === 'playbook_pin' || a.annotationType === 'playbook_clear') {
      counts.playbookPin += 1;
      bucket = 'playbook';
    } else if (a.annotationType === 'manipulation_risk') {
      counts.manipulation += 1;
      bucket = 'manipulation';
    } else {
      counts.other += 1;
    }

    const id = String(a.instrumentId).toLowerCase();
    entries.push({
      instrumentId: id,
      instrumentName: nameById[id] || id,
      annotationType: a.annotationType,
      label: labelOf(a.annotationType),
      bucket,
      target: a.target || null,
      reason: a.reason || null,
      analyst: a.analyst || 'local',
      claimId: a.claimId || null,
      day,
      recordedAt: a.recordedAt || a.at || null,
      text: `${nameById[id] || id} · ${labelOf(a.annotationType)}${
        a.target ? ` → ${a.target}` : ''
      }${a.reason ? ` · ${String(a.reason).slice(0, 40)}` : ''}`,
      dataSource: 'analyst-annotations.jsonl',
    });
  }

  // 新→旧
  entries.reverse();
  const today = entries.filter((e) => e.day === asOf);
  const recent = entries.slice(0, 24);
  const active = {
    freeze: [],
    veto: [],
    playbook: [],
    manipulation: [],
  };
  const seen = { freeze: new Set(), veto: new Set(), playbook: new Set(), manipulation: new Set() };
  for (const e of entries) {
    if (e.bucket === 'freeze' && !seen.freeze.has(e.instrumentId)) {
      seen.freeze.add(e.instrumentId);
      active.freeze.push(e);
    }
    if (e.bucket === 'veto' && !seen.veto.has(e.instrumentId)) {
      seen.veto.add(e.instrumentId);
      active.veto.push(e);
    }
    if (e.bucket === 'playbook' && e.annotationType === 'playbook_pin' && !seen.playbook.has(e.instrumentId)) {
      seen.playbook.add(e.instrumentId);
      active.playbook.push(e);
    }
    if (e.bucket === 'manipulation' && !seen.manipulation.has(e.instrumentId)) {
      seen.manipulation.add(e.instrumentId);
      active.manipulation.push(e);
    }
  }

  // 与 live 工作台对照：仍冻结/否决的品种
  const table = loadReliabilityTable();
  const liveFrozen = Object.entries(table.byInstrument || {})
    .filter(([, v]) => v.frozen)
    .map(([k]) => ({
      instrumentId: k,
      instrumentName: nameById[k] || k,
      text: `${nameById[k] || k} · 现役冻结`,
    }));
  const liveVetoed = Object.entries(table.byInstrument || {})
    .filter(([, v]) => v.vetoed)
    .map(([k]) => ({
      instrumentId: k,
      instrumentName: nameById[k] || k,
      text: `${nameById[k] || k} · 现役否决`,
    }));

  const questions = [];
  for (const f of liveFrozen.slice(0, 4)) {
    questions.push({
      priority: 'P2',
      score: 34,
      instrumentId: f.instrumentId,
      instrumentName: f.instrumentName,
      question: `${f.instrumentName}：分析师冻结仍在生效 — 今日是否解冻或改口？`,
      reasons: ['分析师日记', 'freeze'],
      dataSource: 'intel-analyst-journal-board',
    });
  }
  for (const v of liveVetoed.slice(0, 3)) {
    questions.push({
      priority: 'P1',
      score: 40,
      instrumentId: v.instrumentId,
      instrumentName: v.instrumentName,
      question: `${v.instrumentName}：分析师否决生效 — 门禁已阻断，理由是否仍成立？`,
      reasons: ['分析师日记', 'veto'],
      dataSource: 'intel-analyst-journal-board',
    });
  }
  if (counts.today === 0 && (liveFrozen.length || liveVetoed.length)) {
    questions.push({
      priority: 'P3',
      score: 18,
      instrumentId: null,
      instrumentName: '全市场',
      question: '今日无人标注，但有现役冻结/否决 — 是否例行复核人 Δ？',
      reasons: ['分析师日记', 'stale'],
      dataSource: 'intel-analyst-journal-board',
    });
  }

  return {
    version: JOURNAL_VERSION,
    workbenchVersion: WORKBENCH_VERSION,
    asOf,
    counts: {
      ...counts,
      liveFrozen: liveFrozen.length,
      liveVetoed: liveVetoed.length,
    },
    today: today.slice(0, 16),
    recent: recent.slice(0, 20),
    active: {
      freeze: active.freeze.slice(0, 10),
      veto: active.veto.slice(0, 10),
      playbook: active.playbook.slice(0, 10),
      manipulation: active.manipulation.slice(0, 10),
    },
    liveFrozen: liveFrozen.slice(0, 12),
    liveVetoed: liveVetoed.slice(0, 12),
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 10),
    display: counts.total
      ? `分析师日记 今日 ${counts.today} · 冻结现役 ${liveFrozen.length} · 否决 ${liveVetoed.length} · 归档 ${counts.total}`
      : '分析师日记 暂无标注',
    note: '仅真实 annotations.jsonl；无标注显示暂无，不编造人审记录',
    dataSource: 'intel-analyst-journal-board',
    method: 'annotation-journal+reliability-live',
  };
}

function enrichQuestionQueueWithAnalystJournal(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId || ''}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId || ''}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P2',
      priorityLabel: '分析师日记',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    analystJournalInjected: extra.length,
    version: `${queue.version || ''}+journal`,
  };
}

module.exports = {
  JOURNAL_VERSION,
  buildAnalystJournalBoard,
  enrichQuestionQueueWithAnalystJournal,
};
