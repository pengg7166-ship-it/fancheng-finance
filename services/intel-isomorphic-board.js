/**
 * 情报中心 · 同构监视板（构想 §46/同构 K）
 * 主题命中 + 磁盘日 K 路径相似；强同构进 P2，弱/主题-only 诚实标注。
 * 禁止合成 bar / 假相似度。
 */
const {
  CANONICAL_VERSION,
  matchCanonicalCases,
  CANONICAL_CASES,
} = require('./intel-canonical-cases');
const { CANONICAL_K_VERSION } = require('./intel-isomorphic-k');

const ISO_BOARD_VERSION = 'v2.89.22-isomorphic-replay';

function pathTier(path) {
  if (!path?.available || path.score == null) {
    return {
      tier: path?.reason === 'era_not_dated' ? 'undated' : 'none',
      tierLabel: path?.reason === 'era_not_dated' ? 'era非定日' : '路径暂无',
    };
  }
  if (path.score >= 0.55) return { tier: 'strong', tierLabel: '路径强同构' };
  if (path.score >= 0.25) return { tier: 'weak', tierLabel: '路径弱相似' };
  return { tier: 'none', tierLabel: '路径不似' };
}

/**
 * @param {object[]} instruments — 已挂 intelCenter.canonicalCases 更佳，否则现场 match
 */
function buildIsomorphicBoard(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const rows = [];
  const questions = [];
  const byInstrument = {};

  for (const inst of instruments || []) {
    if (!inst?.id) continue;
    const match =
      inst.intelCenter?.canonicalCases?.matches?.length != null
        ? inst.intelCenter.canonicalCases
        : matchCanonicalCases(inst, { asOf });
    if (!match?.matches?.length && !match?.inIsomorphicWatch) continue;

    const caseRows = (match.matches || []).map((m) => {
      const pt = pathTier(m.pathSimilarity);
      const replay = m.pathSimilarity?.pathReplay || null;
      return {
        caseId: m.id,
        label: m.label,
        era: m.era,
        mechanism: m.mechanism,
        similarity: m.similarity,
        themeScore: m.themeScore,
        pathScore: m.pathSimilarity?.available ? m.pathSimilarity.score : null,
        pathN: m.pathSimilarity?.n ?? null,
        pathNDisplay: m.pathSimilarity?.nDisplay || (m.pathSimilarity?.n != null ? String(m.pathSimilarity.n) : '暂无'),
        pathDisplay: m.pathSimilarity?.display || pt.tierLabel,
        pathTier: pt.tier,
        pathTierLabel: pt.tierLabel,
        histWindow: m.pathSimilarity?.histWindow || replay?.histWindow || null,
        recentWindow: m.pathSimilarity?.recentWindow || replay?.recentWindow || null,
        pathReplay: replay
          ? {
              ...replay,
              caseId: m.id,
              caseLabel: m.label,
              instrumentId: inst.id,
              instrumentName: inst.name || inst.id,
              pathTier: pt.tier,
              pathTierLabel: pt.tierLabel,
              pathScore: m.pathSimilarity?.score ?? null,
            }
          : m.pathSimilarity?.available === false
            ? {
                available: false,
                reason: m.pathSimilarity?.reason || 'path_unavailable',
                display: m.pathSimilarity?.display || '路径回放暂无',
                caseId: m.id,
                caseLabel: m.label,
                instrumentId: inst.id,
                dataSource: m.pathSimilarity?.dataSource || 'intel-isomorphic-k',
              }
            : null,
        watchSignals: m.watchSignals || [],
        matchReasons: m.matchReasons || [],
        dataSource: 'intel-canonical-cases+isomorphic-k',
      };
    });

    const best = caseRows[0] || null;
    if (!best && !match.inIsomorphicWatch) continue;

    const strong = caseRows.filter((c) => c.pathTier === 'strong');
    const weak = caseRows.filter((c) => c.pathTier === 'weak');
    const themeOnly = caseRows.filter((c) => c.pathTier === 'none' || c.pathTier === 'undated');

    const row = {
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
      inWatch: Boolean(match.inIsomorphicWatch),
      best,
      cases: caseRows,
      strongCount: strong.length,
      weakCount: weak.length,
      themeOnlyCount: themeOnly.length,
      display: match.display || '暂无同构',
      text: best
        ? `${inst.name || inst.id} · ${best.label} · ${best.pathTierLabel}${
            best.pathNDisplay && best.pathNDisplay !== '暂无' ? ` n=${best.pathNDisplay}` : ''
          }`
        : `${inst.name || inst.id} · 同构监视`,
      dataSource: 'intel-isomorphic-board',
    };
    rows.push(row);
    byInstrument[inst.id] = row;

    for (const c of strong.slice(0, 2)) {
      const sig = (c.watchSignals || []).slice(0, 2).join(' / ') || '关键触发信号';
      questions.push({
        priority: 'P2',
        score: 36 + Math.round((c.pathScore || 0) * 20),
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `同构「${c.label}」路径强相似(${c.pathDisplay})：本轮是否兑现 ${sig}？`,
        reasons: ['同构监视板', c.pathTierLabel, `n=${c.pathNDisplay}`],
        caseId: c.caseId,
        isomorphic: true,
        pathTier: 'strong',
        dataSource: 'intel-isomorphic-board',
      });
    }
    for (const c of weak.slice(0, 1)) {
      questions.push({
        priority: 'P3',
        score: 22,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `同构「${c.label}」仅弱相似(${c.pathDisplay})：主题命中是否过度外推？`,
        reasons: ['同构监视板', '路径弱相似', `n=${c.pathNDisplay}`],
        caseId: c.caseId,
        isomorphic: true,
        pathTier: 'weak',
        dataSource: 'intel-isomorphic-board',
      });
    }
  }

  rows.sort((a, b) => {
    const rank = (r) => (r.strongCount ? 2 : r.weakCount ? 1 : 0);
    const d = rank(b) - rank(a);
    if (d) return d;
    return (b.best?.similarity || 0) - (a.best?.similarity || 0);
  });

  const strongInst = rows.filter((r) => r.strongCount > 0);
  const weakInst = rows.filter((r) => r.weakCount > 0 && !r.strongCount);
  const themeInst = rows.filter((r) => !r.strongCount && !r.weakCount);

  const sampleReplays = [];
  for (const r of rows) {
    for (const c of r.cases || []) {
      if (c.pathReplay?.available && (c.pathTier === 'strong' || c.pathTier === 'weak')) {
        sampleReplays.push(c.pathReplay);
      }
    }
  }
  sampleReplays.sort((a, b) => (b.pathScore || 0) - (a.pathScore || 0));

  return {
    version: ISO_BOARD_VERSION,
    canonicalVersion: CANONICAL_VERSION,
    kVersion: CANONICAL_K_VERSION,
    asOf,
    caseLibrarySize: CANONICAL_CASES.length,
    rows: rows.slice(0, 24),
    top: rows.slice(0, 12),
    strong: strongInst.slice(0, 8),
    weak: weakInst.slice(0, 8),
    themeOnly: themeInst.slice(0, 8),
    sampleReplays: sampleReplays.slice(0, 8),
    counts: {
      watching: rows.length,
      strong: strongInst.length,
      weak: weakInst.length,
      themeOnly: themeInst.length,
      pathReplays: sampleReplays.length,
    },
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 12),
    byInstrument,
    display: strongInst.length
      ? `同构板 强路径 ${strongInst.length} · 弱 ${weakInst.length} · 回放 ${sampleReplays.length}`
      : rows.length
        ? `同构板 监视 ${rows.length} · 回放 ${sampleReplays.length} · 暂无强路径同构（era/K 诚实）`
        : '同构板 暂无',
    note: '路径分来自真实日K pearson；回放附 hist/recent 窗口与稀疏收盘；era 非定日不计路径分',
    dataSource: 'intel-isomorphic-board',
    method: 'canonical-theme+kline-path-tier+replay',
  };
}

function attachIsomorphicToInstruments(instruments, board) {
  if (!board?.byInstrument) return instruments;
  return (instruments || []).map((inst) => {
    const row = board.byInstrument[inst.id] || board.byInstrument[String(inst.id).toLowerCase()];
    if (!row) return inst;
    return {
      ...inst,
      intelCenter: {
        ...(inst.intelCenter || {}),
        isomorphicBoard: {
          version: ISO_BOARD_VERSION,
          display: row.display,
          text: row.text,
          strongCount: row.strongCount,
          weakCount: row.weakCount,
          best: row.best
            ? {
                label: row.best.label,
                pathTier: row.best.pathTier,
                pathTierLabel: row.best.pathTierLabel,
                pathNDisplay: row.best.pathNDisplay,
                pathScore: row.best.pathScore,
                watchSignals: row.best.watchSignals,
              }
            : null,
          preferWatchSignals: row.strongCount > 0,
          dataSource: 'intel-isomorphic-board',
        },
      },
    };
  });
}

function enrichQuestionQueueWithIsomorphic(queue, board) {
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
      priorityLabel: '同构监视',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      isomorphic: true,
      pathTier: q.pathTier,
      caseId: q.caseId,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    isomorphicInjected: extra.length,
    version: `${queue.version || ''}+isomorphic`,
  };
}

module.exports = {
  ISO_BOARD_VERSION,
  buildIsomorphicBoard,
  attachIsomorphicToInstruments,
  enrichQuestionQueueWithIsomorphic,
  pathTier,
};
