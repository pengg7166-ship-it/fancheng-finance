/**
 * 情报中心 · 失效博物馆复盘板（构想 §68/69）
 * 仅读真实 failure-museum / revisions JSONL；无记录标「暂无」，禁止编造失效案例。
 * 输出：教训分型、同品种现役提醒、P2 问句、周还债联动项。
 */
const { loadFailureMuseum, loadRecentRevisions } = require('./intel-memory');

const MUSEUM_BOARD_VERSION = 'v2.89.20-museum-intake';

function daysAgo(iso, asOf) {
  if (!iso) return null;
  const a = Date.parse(String(asOf || new Date().toISOString()).slice(0, 10));
  const b = Date.parse(String(iso).slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 86400000));
}

function classifyLesson(entry) {
  const trig = String(entry.trigger || entry.reason || '');
  const st = String(entry.status || entry.type || '');
  if (/clock|过期|expired|时效/i.test(trig) || st === 'expired') {
    return { id: 'expired', label: '时效失效', note: '有效期到而未改口/未验证' };
  }
  if (/合证|结构|基差|库存|stock.?flow/i.test(trig)) {
    return { id: 'structure_flip', label: '结构翻转证伪', note: '合证/基差相对基线翻转' };
  }
  if (/叙事|新闻|shock|surprise/i.test(trig)) {
    return { id: 'narrative_break', label: '叙事证伪', note: '故事未兑现或被定价' };
  }
  if (/侧|side|方向|改口/i.test(trig)) {
    return { id: 'direction_revision', label: '方向改口', note: '命题侧翻转' };
  }
  return { id: 'falsified', label: '证伪归档', note: trig.slice(0, 48) || '触发器命中' };
}

/**
 * @param {object[]} instruments
 * @param {{ asOf?: string, museumLimit?: number, revisionLimit?: number }} [opts]
 */
function buildFailureMuseumBoard(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const museum = loadFailureMuseum(opts.museumLimit || 80);
  const revisions = loadRecentRevisions(opts.revisionLimit || 40);

  if (!museum.length && !revisions.length) {
    return emptyBoard(asOf, '失效博物馆暂无归档（诚实空库）');
  }

  const byId = new Map();
  for (const i of instruments || []) {
    if (!i?.id) continue;
    byId.set(i.id, i);
    byId.set(String(i.id).toLowerCase(), i);
  }

  const entries = museum.map((m) => {
    const lesson = classifyLesson(m);
    const age = daysAgo(m.falsifiedAt || m.recordedAt, asOf);
    return {
      claimId: m.claimId || null,
      instrumentId: m.instrumentId || null,
      instrumentName: m.instrumentName || m.instrumentId || '—',
      statement: m.statement || null,
      trigger: m.trigger || null,
      falsifiedAt: m.falsifiedAt || (m.recordedAt || '').slice(0, 10) || null,
      daysAgo: age,
      daysAgoDisplay: age != null ? String(age) : '暂无',
      lesson,
      text: `${m.instrumentName || m.instrumentId || '—'} · ${lesson.label} · ${(m.statement || m.trigger || '—').slice(0, 36)}`,
      dataSource: 'failure-museum.jsonl',
    };
  });

  const byInstrument = {};
  for (const e of entries) {
    if (!e.instrumentId) continue;
    const k = e.instrumentId;
    if (!byInstrument[k]) byInstrument[k] = { instrumentId: k, entries: [], count: 0, recent30: 0 };
    byInstrument[k].entries.push(e);
    byInstrument[k].count += 1;
    if (e.daysAgo != null && e.daysAgo <= 30) byInstrument[k].recent30 += 1;
  }

  const lessonCounts = {};
  for (const e of entries) {
    lessonCounts[e.lesson.id] = (lessonCounts[e.lesson.id] || 0) + 1;
  }

  // 现役命题邻近：同品种仍有 active/watch 且近 90 日有失效
  const activeWarnings = [];
  const questions = [];
  for (const [id, slice] of Object.entries(byInstrument)) {
    const inst = byId.get(id) || byId.get(String(id).toLowerCase());
    if (!inst) continue;
    const claim = inst.intelCenter?.primaryClaim;
    if (!claim || !['active', 'watch', 'falsifying'].includes(claim.status)) continue;
    const recent = slice.entries.filter((e) => e.daysAgo != null && e.daysAgo <= 90);
    if (!recent.length) continue;
    const topLesson = recent[0].lesson;
    activeWarnings.push({
      instrumentId: id,
      instrumentName: inst.name || id,
      claimId: claim.claimId,
      claimStatus: claim.status,
      museumN: recent.length,
      nDisplay: String(recent.length),
      latestLesson: topLesson,
      latestAt: recent[0].falsifiedAt,
      display: `${inst.name || id} 近90日失效 ${recent.length} · 现役 ${claim.status} · ${topLesson.label}`,
      dataSource: 'failure-museum+live-claim',
    });
    questions.push({
      priority: 'P2',
      score: 34 + Math.min(10, recent.length * 2),
      instrumentId: id,
      instrumentName: inst.name || id,
      question: `失效博物馆：近90日 ${recent.length} 次证伪（${topLesson.label}）— 现役命题是否重蹈？触发器：${(recent[0].trigger || '暂无').slice(0, 40)}`,
      reasons: ['失效博物馆复盘', topLesson.label, `n=${recent.length}`],
      museumN: recent.length,
      nDisplay: String(recent.length),
      dataSource: 'intel-failure-museum-board',
    });
  }

  // 改口履历摘要（真实 revisions）
  const revisionRows = revisions.slice(0, 20).map((r) => ({
    claimId: r.claimId,
    instrumentId: r.instrumentId,
    revisionType: r.revisionType || 'evidence_update',
    reason: r.reason || null,
    fromSide: r.from?.side ?? null,
    toSide: r.to?.side ?? null,
    recordedAt: (r.recordedAt || '').slice(0, 10) || null,
    text: `${r.instrumentId || '—'} · ${r.revisionType || '改口'}${r.from?.side && r.to?.side && r.from.side !== r.to.side ? ` · ${r.from.side}→${r.to.side}` : ''}`,
    dataSource: 'revisions.jsonl',
  }));

  // 周还债联动：近30日多次失效品种
  const weeklyMuseumPay = Object.values(byInstrument)
    .filter((s) => s.recent30 >= 2)
    .sort((a, b) => b.recent30 - a.recent30)
    .slice(0, 5)
    .map((s) => ({
      type: 'repeat_falsify',
      instrumentId: s.instrumentId,
      instrumentName: (byId.get(s.instrumentId) || {}).name || s.instrumentId,
      impact: 'high',
      museumN30: s.recent30,
      nDisplay: String(s.recent30),
      remedy: '复盘触发器质量 / 降档置信 / 补反对证据',
      blocksPublish: false,
      label: '近30日重复证伪',
      dataSource: 'failure-museum.jsonl',
    }));

  const recentEntries = entries
    .filter((e) => e.daysAgo == null || e.daysAgo <= 60)
    .slice(0, 16);

  // 今日入馆闭环：仅 asOf 当日真实 JSONL，禁止编造
  const todayIntake = entries.filter((e) => e.falsifiedAt === asOf);
  const todayIntakeRows = todayIntake.slice(0, 12).map((e) => ({
    claimId: e.claimId,
    instrumentId: e.instrumentId,
    instrumentName: e.instrumentName,
    statement: e.statement,
    trigger: e.trigger,
    lesson: e.lesson,
    falsifiedAt: e.falsifiedAt,
    museumWritten: true,
    intakeClosed: true,
    text: `${e.instrumentName || e.instrumentId || '—'} · ${e.lesson?.label || '入馆'} · ${(e.statement || e.trigger || '—').slice(0, 36)}`,
    dataSource: 'failure-museum.jsonl',
    method: 'today-intake-slice',
  }));
  if (todayIntake.length) {
    questions.unshift({
      priority: 'P1',
      score: 42,
      instrumentId: todayIntake[0].instrumentId,
      instrumentName: todayIntake[0].instrumentName,
      question: `今日入馆 ${todayIntake.length} 条 — 触发器是否写清？现役是否避开同坑？`,
      reasons: ['今日博物馆入馆', `n=${todayIntake.length}`],
      museumN: todayIntake.length,
      nDisplay: String(todayIntake.length),
      dataSource: 'intel-failure-museum-board',
    });
  }

  const intakeBoard = {
    version: MUSEUM_BOARD_VERSION,
    asOf,
    available: true,
    todayN: todayIntake.length,
    nDisplay: String(todayIntake.length),
    rows: todayIntakeRows,
    display:
      todayIntake.length > 0
        ? `今日入馆 ${todayIntake.length} · 已写入博物馆`
        : '今日入馆 0 · 暂无新证伪/过期',
    note: '仅 JSONL 当日归档；空日不造假入馆',
    dataSource: 'intel-failure-museum-board',
    method: 'falsify→museum-intake-closed-loop',
  };

  return {
    version: MUSEUM_BOARD_VERSION,
    asOf,
    available: true,
    entryCount: entries.length,
    revisionCount: revisionRows.length,
    entries: recentEntries,
    allEntries: entries.slice(0, 40),
    byInstrument,
    lessonCounts,
    lessons: Object.entries(lessonCounts).map(([id, n]) => ({
      id,
      n,
      nDisplay: String(n),
      label: entries.find((e) => e.lesson.id === id)?.lesson.label || id,
    })),
    activeWarnings: activeWarnings.slice(0, 12),
    revisions: revisionRows,
    weeklyMuseumPay,
    todayIntake: intakeBoard,
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 10),
    counts: {
      entries: entries.length,
      instruments: Object.keys(byInstrument).length,
      activeWarnings: activeWarnings.length,
      weeklyPay: weeklyMuseumPay.length,
      revisions: revisionRows.length,
      todayIntake: todayIntake.length,
    },
    display: (() => {
      const intakeBit = todayIntake.length ? ` · 今日入馆 ${todayIntake.length}` : '';
      if (activeWarnings.length) {
        return `失效博物馆 ${entries.length} 条 · 现役邻近警告 ${activeWarnings.length} · 周还债 ${weeklyMuseumPay.length}${intakeBit}`;
      }
      if (entries.length) return `失效博物馆 ${entries.length} 条 · 暂无现役邻近警告${intakeBit}`;
      return '失效博物馆 暂无';
    })(),
    note: '仅 JSONL 真实归档；空库不造假案例；证伪须原子入馆',
    dataSource: 'intel-failure-museum-board',
    method: 'museum-jsonl+revision+live-claim+today-intake',
  };
}

function emptyBoard(asOf, reason) {
  return {
    version: MUSEUM_BOARD_VERSION,
    asOf: asOf || null,
    available: false,
    entryCount: 0,
    revisionCount: 0,
    entries: [],
    allEntries: [],
    byInstrument: {},
    lessonCounts: {},
    lessons: [],
    activeWarnings: [],
    revisions: [],
    weeklyMuseumPay: [],
    questions: [],
    todayIntake: {
      version: MUSEUM_BOARD_VERSION,
      asOf: asOf || null,
      available: false,
      todayN: 0,
      nDisplay: '0',
      rows: [],
      display: '今日入馆 0 · 暂无',
      note: reason || '空库',
      dataSource: 'intel-failure-museum-board',
    },
    counts: { entries: 0, instruments: 0, activeWarnings: 0, weeklyPay: 0, revisions: 0, todayIntake: 0 },
    display: reason || '失效博物馆 暂无',
    note: '仅 JSONL 真实归档；空库不造假案例',
    dataSource: 'intel-failure-museum-board',
    method: 'museum-jsonl+revision+live-claim-crosslink',
  };
}

function attachMuseumToInstruments(instruments, board) {
  if (!board?.byInstrument) return instruments;
  return (instruments || []).map((inst) => {
    const slice = board.byInstrument[inst.id] || board.byInstrument[String(inst.id).toLowerCase()];
    const warn = (board.activeWarnings || []).find((w) => w.instrumentId === inst.id);
    if (!slice && !warn) return inst;
    return {
      ...inst,
      intelCenter: {
        ...(inst.intelCenter || {}),
        museumReview: {
          version: MUSEUM_BOARD_VERSION,
          count: slice?.count || 0,
          recent30: slice?.recent30 || 0,
          nDisplay: slice ? String(slice.count) : '暂无',
          warning: warn || null,
          display: warn
            ? warn.display
            : slice?.count
              ? `博物馆 ${slice.count} 条 · 近30日 ${slice.recent30}`
              : '暂无失效归档',
          dataSource: 'intel-failure-museum-board',
        },
      },
    };
  });
}

function enrichQuestionQueueWithMuseum(queue, board) {
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
      priority: 'P2',
      priorityLabel: '失效博物馆',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      museumN: q.museumN,
      nDisplay: q.nDisplay,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    museumInjected: extra.length,
    version: `${queue.version || ''}+museum`,
  };
}

/**
 * 把博物馆周还债项并入债务板（不造假债）
 */
function mergeMuseumIntoDebtBoard(debtBoard, museumBoard) {
  if (!debtBoard || !museumBoard?.weeklyMuseumPay?.length) return debtBoard;
  const existing = new Set(
    (debtBoard.priorityPaydown || []).map((d) => `${d.type}|${d.instrumentId}`)
  );
  const extra = [];
  for (const d of museumBoard.weeklyMuseumPay) {
    const key = `${d.type}|${d.instrumentId}`;
    if (existing.has(key)) continue;
    extra.push(d);
  }
  if (!extra.length) {
    return {
      ...debtBoard,
      museumLinked: 0,
      version: `${debtBoard.version || ''}+museum`,
    };
  }
  const weeklyMustPay = [...(debtBoard.weeklyMustPay || []), ...extra].slice(0, 8);
  const priorityPaydown = [...extra, ...(debtBoard.priorityPaydown || [])].slice(0, 16);
  return {
    ...debtBoard,
    weeklyMustPay,
    priorityPaydown,
    totalDebts: (debtBoard.totalDebts || 0) + extra.length,
    museumLinked: extra.length,
    byType: {
      ...(debtBoard.byType || {}),
      repeat_falsify: (debtBoard.byType?.repeat_falsify || 0) + extra.length,
    },
    display: `${debtBoard.display || '问题债务'} · 博物馆周还 ${extra.length}`,
    version: `${debtBoard.version || ''}+museum`,
    method: `${debtBoard.method || 'debt'}+museum-repeat-falsify`,
  };
}

module.exports = {
  MUSEUM_BOARD_VERSION,
  buildFailureMuseumBoard,
  attachMuseumToInstruments,
  enrichQuestionQueueWithMuseum,
  mergeMuseumIntoDebtBoard,
  classifyLesson,
};
