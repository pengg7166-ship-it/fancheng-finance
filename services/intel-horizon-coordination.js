/**
 * 情报中心 · 三时间尺度协同 / 冲突 OS（构想 §九）
 * 战术/结构/范式冲突显式化，禁止合成单箭头糊弄。
 * v2.76：pack 冲突板 + P2 问句 + 选择集偏 C。
 */
const { HORIZONS } = require('./intel-claim-library');

const HORIZON_VERSION = 'v2.76.0-horizon-conflict-os';

function sideRank(side) {
  if (side === 'bull') return 1;
  if (side === 'bear') return -1;
  return 0;
}

function sideLabel(side) {
  if (side === 'bull') return '偏多';
  if (side === 'bear') return '偏空';
  if (side === 'flat') return '震荡';
  return '暂无';
}

function claimSlice(c) {
  if (!c) return null;
  return {
    side: c.side,
    sideLabel: sideLabel(c.side),
    confidence: c.confidence || null,
    claimId: c.claimId || null,
    status: c.status || null,
    statement: c.statement ? String(c.statement).slice(0, 64) : null,
    n: c.n ?? null,
    nDisplay: c.n != null ? String(c.n) : c.nDisplay || '暂无',
    available: true,
  };
}

/**
 * 单品种三尺度协同
 */
function resolveHorizonCoordination(claims, inst) {
  const byHorizon = {};
  for (const c of claims || []) {
    byHorizon[c.horizon] = c;
  }

  const tactical = byHorizon.tactical;
  const structural = byHorizon.structural;
  const paradigm = byHorizon.paradigm;

  const missing = [];
  if (!tactical) missing.push({ horizon: 'tactical', label: HORIZONS.tactical?.label || '战术', note: '战术命题暂无' });
  if (!structural) missing.push({ horizon: 'structural', label: HORIZONS.structural?.label || '结构', note: '结构命题暂无' });
  if (!paradigm) missing.push({ horizon: 'paradigm', label: HORIZONS.paradigm?.label || '范式', note: '范式层未触发（无真实信号时不造）' });

  const conflicts = [];
  const pairs = [
    ['tactical', 'structural', tactical, structural],
    ['structural', 'paradigm', structural, paradigm],
    ['tactical', 'paradigm', tactical, paradigm],
  ];

  for (const [a, b, ca, cb] of pairs) {
    if (!ca || !cb) continue;
    const ra = sideRank(ca.side);
    const rb = sideRank(cb.side);
    if (ra !== 0 && rb !== 0 && ra !== rb) {
      const severity = a === 'tactical' && b === 'structural' ? 'high' : 'medium';
      conflicts.push({
        horizons: [a, b],
        labels: [HORIZONS[a]?.label || a, HORIZONS[b]?.label || b],
        sides: [ca.side, cb.side],
        sideLabels: [sideLabel(ca.side), sideLabel(cb.side)],
        severity,
        display: `${HORIZONS[a]?.label || a} ${sideLabel(ca.side)} vs ${HORIZONS[b]?.label || b} ${sideLabel(cb.side)}`,
        resolution: '显式分歧 — 禁止合成单方向 · 选择集偏追踪(C)',
        actionHint:
          severity === 'high'
            ? '战术与结构对立：执行层以区间/观望为主，勿把短期当结构'
            : '跨尺度对立：分开表述，勿加权合成箭头',
      });
    }
  }

  const primaryHorizon = structural ? 'structural' : tactical ? 'tactical' : paradigm ? 'paradigm' : null;
  const primaryClaim = primaryHorizon ? byHorizon[primaryHorizon] : null;

  let stance = 'aligned';
  let stanceLabel = '尺度一致或未齐';
  if (conflicts.length) {
    stance = 'conflict';
    stanceLabel = '尺度冲突';
  } else if (missing.filter((m) => m.horizon !== 'paradigm').length >= 2) {
    stance = 'incomplete';
    stanceLabel = '尺度未齐';
  } else if (structural && tactical && sideRank(structural.side) === sideRank(tactical.side) && sideRank(structural.side) !== 0) {
    stance = 'aligned';
    stanceLabel = '战术·结构同向';
  }

  const headline =
    conflicts.length > 0
      ? conflicts[0].display
      : structural
        ? `${HORIZONS.structural.label} · ${sideLabel(structural.side)}`
        : tactical
          ? `${HORIZONS.tactical.label} · ${sideLabel(tactical.side)}（结构暂无）`
          : '尺度未齐';

  return {
    version: HORIZON_VERSION,
    instrumentId: inst?.id || null,
    claimsByHorizon: {
      tactical: claimSlice(tactical),
      structural: claimSlice(structural),
      paradigm: claimSlice(paradigm),
    },
    missing,
    conflicts,
    hasConflict: conflicts.length > 0,
    conflictCount: conflicts.length,
    severity: conflicts.some((c) => c.severity === 'high') ? 'high' : conflicts.length ? 'medium' : null,
    stance,
    stanceLabel,
    primaryHorizon,
    primaryClaimId: primaryClaim?.claimId || null,
    headline,
    preferChoiceC: conflicts.length > 0,
    uiHint: conflicts.length
      ? conflicts[0].actionHint
      : missing.length
        ? '缺层不补假命题'
        : null,
    display: conflicts.length
      ? `尺度冲突 ${conflicts.length} · ${conflicts[0].display}`
      : stance === 'aligned'
        ? `尺度 · ${headline}`
        : `尺度 · ${stanceLabel}`,
    dataSource: 'intel-horizon-coordination',
    method: 'explicit-multi-horizon-conflict-os',
  };
}

/**
 * Pack 级三尺度冲突板
 */
function buildHorizonConflictBoard(instruments) {
  const rows = [];
  for (const inst of instruments || []) {
    const hz = inst?.intelCenter?.horizonCoordination;
    if (!hz) continue;
    if (!hz.hasConflict && hz.stance !== 'incomplete') continue;
    rows.push({
      instrumentId: inst.id,
      instrumentName: inst.name,
      sector: inst.sector || null,
      stance: hz.stance,
      stanceLabel: hz.stanceLabel,
      hasConflict: !!hz.hasConflict,
      severity: hz.severity,
      headline: hz.headline,
      display: hz.display,
      conflicts: hz.conflicts || [],
      missing: hz.missing || [],
      preferChoiceC: !!hz.preferChoiceC,
      claimsByHorizon: hz.claimsByHorizon,
    });
  }

  rows.sort(
    (a, b) =>
      (b.hasConflict ? 1 : 0) - (a.hasConflict ? 1 : 0) ||
      (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0)
  );

  const conflictRows = rows.filter((r) => r.hasConflict);
  const questions = conflictRows.slice(0, 8).map((r) => ({
    priority: r.severity === 'high' ? 'P2' : 'P3',
    score: r.severity === 'high' ? 34 : 26,
    instrumentId: r.instrumentId,
    instrumentName: r.instrumentName,
    question: `${r.instrumentName}：${r.headline} — 如何分尺度表述、禁止合成单箭头？`,
    reasons: ['三尺度冲突板', r.stanceLabel, ...(r.conflicts || []).slice(0, 2).map((c) => c.display)],
    dataSource: 'intel-horizon-coordination',
  }));

  return {
    version: HORIZON_VERSION,
    rows: rows.slice(0, 24),
    conflictRows: conflictRows.slice(0, 16),
    questions,
    counts: {
      conflict: conflictRows.length,
      incomplete: rows.filter((r) => r.stance === 'incomplete').length,
      high: conflictRows.filter((r) => r.severity === 'high').length,
    },
    display: conflictRows.length
      ? `尺度冲突板 ${conflictRows.length} 品种 · 高严重 ${conflictRows.filter((r) => r.severity === 'high').length}`
      : rows.length
        ? `尺度板 未齐 ${rows.length} · 暂无对立冲突`
        : '尺度冲突板 暂无',
    note: '冲突时禁止合成单方向；选择集应偏 C（追踪）',
    dataSource: 'intel-horizon-coordination',
    method: 'pack-horizon-conflict-board',
  };
}

function enrichQuestionQueueWithHorizon(queue, board) {
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
      priority: q.priority || 'P3',
      priorityLabel: q.priority === 'P2' ? '尺度冲突' : '尺度关注',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 20);
  return {
    ...queue,
    all,
    deepQueue: deep,
    horizonInjected: extra.length,
    version: `${queue.version || ''}+horizon`,
  };
}

module.exports = {
  HORIZON_VERSION,
  resolveHorizonCoordination,
  buildHorizonConflictBoard,
  enrichQuestionQueueWithHorizon,
  sideLabel,
  sideRank,
};
