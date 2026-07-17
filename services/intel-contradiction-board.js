/**
 * 情报中心 · 矛盾矩阵板（构想 §52）
 * 跨品种汇总：主矛盾 × 反对力 × 轴冲突；仅读真实 contradictionMatrix + kernel。
 * 缺失标「暂无」，禁止编造对立侧。
 */
const BOARD_VERSION = 'v2.89.21-contradiction-board';

function sideLabel(side) {
  if (side === 'bull') return '多';
  if (side === 'bear') return '空';
  if (side === 'flat') return '中';
  return '暂无';
}

function opposingForceFromMatrix(cm, kernel) {
  const dissentRaw =
    kernel?.dissent?.opposingEvidence?.[0]?.summary ||
    kernel?.dissent?.opposingEvidence?.[0]?.label ||
    cm?.forcedDissent ||
    null;
  const dissent = dissentRaw && String(dissentRaw).trim() && String(dissentRaw).trim() !== '暂无' ? String(dissentRaw).trim() : null;
  if (dissent) {
    return { label: dissent.slice(0, 72), source: 'kernel-dissent', available: true };
  }
  const conflict = (cm?.cells || []).find((c) => c.conflict);
  if (conflict) {
    return {
      label: `${conflict.aLabel || 'A'}(${sideLabel(conflict.aSide)}) × ${conflict.bLabel || 'B'}(${sideLabel(conflict.bSide)})`,
      source: 'matrix-conflict',
      available: true,
    };
  }
  const hyp = (cm?.competingHypotheses || []).find((h) => h.side === 'short' || h.side === 'bear' || h.side === 'long');
  if (hyp?.claim) {
    return { label: String(hyp.claim).slice(0, 72), source: 'competing-hyp', available: true };
  }
  return { label: '暂无', source: null, available: false };
}

function axesSummary(cm) {
  const axes = cm?.axes || [];
  const withSide = axes.filter((a) => a.side);
  if (!withSide.length) return '轴 暂无';
  return withSide
    .slice(0, 5)
    .map((a) => `${a.label || a.id || '?'}:${sideLabel(a.side)}`)
    .join(' · ');
}

/**
 * @param {object[]} instruments
 * @param {{ asOf?: string }} [opts]
 */
function buildContradictionBoard(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const rows = [];
  let withMatrix = 0;
  let withConflict = 0;
  let withMain = 0;
  let missingOppose = 0;

  for (const inst of instruments || []) {
    const cm = inst?.contradictionMatrix || inst?.intelCenter?.contradictionMatrix;
    const kernel = inst?.intelligenceKernel || inst?.intelCenter?.intelligenceKernel;
    if (!cm && !kernel?.mainContradiction) continue;

    withMatrix += 1;
    const conflictCount = cm?.conflictCount ?? (cm?.cells || []).filter((c) => c.conflict).length;
    if (conflictCount > 0) withConflict += 1;

    const main =
      kernel?.mainContradiction?.label ||
      cm?.mainContradiction ||
      null;
    const mainSide = kernel?.mainContradiction?.side || null;
    if (main && main !== '暂无') withMain += 1;

    const oppose = opposingForceFromMatrix(cm, kernel);
    if (!oppose.available) missingOppose += 1;

    rows.push({
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
      mainContradiction: main || '暂无',
      mainSide,
      mainSideLabel: sideLabel(mainSide),
      conflictCount: conflictCount || 0,
      nDisplay: String(conflictCount || 0),
      opposingForce: oppose.label,
      opposingAvailable: oppose.available,
      opposingSource: oppose.source,
      axesSummary: axesSummary(cm),
      availableAxes: cm?.availableAxes ?? null,
      summary: cm?.summary || (main ? `主矛盾 ${main}` : '暂无'),
      stateKey: kernel?.stateKey || cm?.stateKey || null,
      text: `${inst.name || inst.id} · ${main || '暂无'} · 反对 ${oppose.label} · 矛盾对 ${conflictCount || 0}`,
      dataSource: cm?.dataSource || 'contradiction-matrix+kernel',
      method: 'pack-contradiction-board',
    });
  }

  rows.sort((a, b) => {
    const miss = Number(!a.opposingAvailable) - Number(!b.opposingAvailable);
    if (miss) return -miss;
    return (b.conflictCount || 0) - (a.conflictCount || 0);
  });

  const questions = [];
  for (const r of rows.filter((x) => !x.opposingAvailable).slice(0, 4)) {
    questions.push({
      priority: 'P1',
      score: 40,
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      question: `矛盾矩阵：${r.instrumentName} 有主矛盾「${(r.mainContradiction || '').slice(0, 24)}」但反对力暂无 — 补红队/对侧轴？`,
      reasons: ['矛盾矩阵缺反对', `冲突对 n=${r.nDisplay}`],
      nDisplay: r.nDisplay,
      dataSource: 'intel-contradiction-board',
    });
  }
  for (const r of rows.filter((x) => x.conflictCount >= 2).slice(0, 4)) {
    questions.push({
      priority: 'P2',
      score: 32 + Math.min(8, r.conflictCount),
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      question: `矛盾矩阵：${r.instrumentName} ${r.conflictCount} 组轴冲突 — 主矛盾是否仍成立？`,
      reasons: ['多轴冲突', r.axesSummary],
      nDisplay: r.nDisplay,
      dataSource: 'intel-contradiction-board',
    });
  }

  const hot = rows
    .filter((r) => r.conflictCount > 0 || !r.opposingAvailable || (r.mainContradiction && r.mainContradiction !== '暂无'))
    .slice(0, 12);

  return {
    version: BOARD_VERSION,
    asOf,
    available: rows.length > 0,
    rows: hot.length ? hot : rows.slice(0, 12),
    allRows: rows.slice(0, 40),
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 8),
    counts: {
      instruments: rows.length,
      withConflict,
      withMain,
      missingOppose,
      nDisplay: String(rows.length),
    },
    display: rows.length
      ? `矛盾矩阵 ${rows.length} · 冲突 ${withConflict} · 主矛盾 ${withMain} · 缺反对 ${missingOppose}`
      : '矛盾矩阵 暂无',
    note: '仅真实矩阵轴+内核主矛盾；缺反对标暂无，不造对立侧',
    dataSource: 'intel-contradiction-board',
    method: 'matrix+kernel→pack-board',
  };
}

function enrichQuestionQueueWithContradiction(queue, board) {
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
      priorityLabel: '矛盾矩阵',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      nDisplay: q.nDisplay,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  return {
    ...queue,
    all,
    deepQueue: all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16),
    contradictionInjected: extra.length,
    version: `${queue.version || ''}+cmatrix`,
  };
}

module.exports = {
  BOARD_VERSION,
  buildContradictionBoard,
  enrichQuestionQueueWithContradiction,
  opposingForceFromMatrix,
};
