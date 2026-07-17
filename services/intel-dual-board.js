/**
 * 情报中心 · 内外双叙事可执行板（构想 §29）
 * 分裂 → 问题队列 / 选择集偏 C / 禁止 Interrupt 假装共振。
 * 仅用真实内盘日 K vs 外盘锚点；缺失标暂无，禁止假外盘涨跌。
 */
const DUAL_BOARD_VERSION = 'v2.79.0-dual-executable';

function nOf(dual) {
  const dn = dual?.domestic?.n;
  const en = dual?.external?.n;
  if (dn != null && en != null) return Math.min(dn, en);
  if (dn != null) return dn;
  if (en != null) return en;
  return null;
}

function actionPlay(regime, dual) {
  if (regime === 'split') {
    const gap =
      dual?.domestic?.movePct1d != null && dual?.external?.movePct1d != null
        ? +(Math.abs(dual.domestic.movePct1d - dual.external.movePct1d)).toFixed(2)
        : null;
    return {
      id: 'split_monitor',
      label: '分裂可执行',
      primary: 'C',
      stance: 'monitor_arbitrage_vol',
      why: '内外对立或幅度分裂 · 禁止合成单方向',
      doList: [
        '选择集偏 C（观望/追踪）',
        '优先想套利窗口 / 波动 / 政策扰动',
        'Interrupt 门禁阻断直至共振或单边确认',
      ],
      resolveWhen: [
        '内外同向且幅度差收敛',
        '外盘锚点补齐且与内盘共振',
        '政策/仓单单边确认覆盖外盘',
      ],
      gapPct: gap,
      gapDisplay: gap != null ? `${gap}%` : '暂无',
    };
  }
  if (regime === 'resonate') {
    return {
      id: 'resonate_follow',
      label: '共振可跟随',
      primary: null,
      stance: 'structure_ok',
      why: '内外同向 · 结构跟随前提之一满足',
      doList: ['允许 A/B 按命题与门禁推进'],
      resolveWhen: [],
      gapPct: null,
      gapDisplay: '暂无',
    };
  }
  if (regime === 'domestic_only' || regime === 'external_only' || regime === 'insufficient') {
    return {
      id: 'incomplete',
      label: '双轨不全',
      primary: 'C',
      stance: 'fill_gap',
      why: dual?.regimeLabel || '内外证据不全',
      doList: ['Unknown Map 补外盘/内盘序列', '选择集偏 C'],
      resolveWhen: ['双轨均可叙'],
      gapPct: null,
      gapDisplay: '暂无',
    };
  }
  return {
    id: 'neutral',
    label: '暂无定调',
    primary: null,
    stance: 'watch',
    why: '—',
    doList: [],
    resolveWhen: [],
    gapPct: null,
    gapDisplay: '暂无',
  };
}

/**
 * @param {object[]} instruments
 */
function buildDualNarrativeBoard(instruments, opts = {}) {
  const rows = [];
  const questions = [];
  const byInstrument = {};

  for (const inst of instruments || []) {
    const dual = inst?.intelCenter?.dualNarrative || inst?.dualNarrative;
    if (!dual) continue;
    const regime = dual.regime || 'insufficient';
    const n = nOf(dual);
    const nDisplay = n != null ? String(n) : dual.external?.nDisplay || dual.domestic?.nDisplay || '暂无';
    const play = actionPlay(regime, dual);
    const row = {
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
      regime,
      regimeLabel: dual.regimeLabel || regime,
      splitScore: dual.splitScore ?? null,
      display: dual.display || '暂无',
      domestic: dual.domestic
        ? {
            side: dual.domestic.side,
            label: dual.domestic.label,
            movePct1d: dual.domestic.movePct1d,
            nDisplay: dual.domestic.nDisplay,
          }
        : null,
      external: dual.external
        ? {
            side: dual.external.side,
            label: dual.external.label,
            movePct1d: dual.external.movePct1d,
            nDisplay: dual.external.nDisplay,
            available: dual.external.available,
            role: dual.external.role,
          }
        : null,
      mapped: dual.mapped !== false,
      n,
      nDisplay,
      action: play,
      text: `${inst.name || inst.id} · ${dual.regimeLabel || regime} · ${play.label}${
        nDisplay !== '暂无' ? ` (n=${nDisplay})` : ''
      }`,
      dataSource: 'intel-dual-narrative',
    };
    rows.push(row);
    byInstrument[inst.id] = row;

    if (regime === 'split') {
      questions.push({
        priority: 'P2',
        score: 38 + Math.round((dual.splitScore || 0.5) * 20),
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question:
          dual.questionHint ||
          `${inst.name || inst.id}：内外叙事分裂 — 套利/波动窗口还是政策扰动？（n=${nDisplay}）`,
        reasons: ['双叙事板', 'split', `n=${nDisplay}`, play.gapDisplay !== '暂无' ? `Δ${play.gapDisplay}` : null].filter(
          Boolean
        ),
        dualRegime: 'split',
        preferChoiceC: true,
        blockInterrupt: true,
        dataSource: 'intel-dual-board',
      });
    } else if (regime === 'domestic_only' || (dual.mapped && !dual.external?.available)) {
      questions.push({
        priority: 'P3',
        score: 20,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：外盘锚点不足，能否补序列后再谈共振？`,
        reasons: ['双叙事板', '外盘暂无'],
        dualRegime: regime,
        preferChoiceC: true,
        blockInterrupt: false,
        dataSource: 'intel-dual-board',
      });
    }
  }

  const split = rows.filter((r) => r.regime === 'split').sort((a, b) => (b.splitScore || 0) - (a.splitScore || 0));
  const resonate = rows.filter((r) => r.regime === 'resonate');
  const incomplete = rows.filter((r) =>
    ['domestic_only', 'external_only', 'insufficient'].includes(r.regime)
  );

  return {
    version: DUAL_BOARD_VERSION,
    asOf: opts.asOf || null,
    rows: rows.slice(0, 40),
    top: [...split, ...incomplete, ...resonate].slice(0, 12),
    split: split.slice(0, 12),
    resonate: resonate.slice(0, 8),
    incomplete: incomplete.slice(0, 8),
    counts: {
      total: rows.length,
      split: split.length,
      resonate: resonate.length,
      incomplete: incomplete.length,
    },
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 12),
    byInstrument,
    display: split.length
      ? `双叙事板 分裂 ${split.length} · 共振 ${resonate.length} · 不全 ${incomplete.length} · 分裂禁 Interrupt`
      : resonate.length
        ? `双叙事板 共振 ${resonate.length} · 暂无显著分裂`
        : incomplete.length
          ? `双叙事板 不全 ${incomplete.length} · 暂无分裂定调`
          : '双叙事板 暂无',
    note: '分裂→选择集偏C + Interrupt门禁阻断；外盘缺失标暂无',
    dataSource: 'intel-dual-board',
    method: 'dual-regime+executable-play',
  };
}

function attachDualBoardToInstruments(instruments, board) {
  if (!board?.byInstrument) return instruments;
  return (instruments || []).map((inst) => {
    const row = board.byInstrument[inst.id] || board.byInstrument[String(inst.id).toLowerCase()];
    if (!row) return inst;
    return {
      ...inst,
      intelCenter: {
        ...(inst.intelCenter || {}),
        dualBoard: {
          version: DUAL_BOARD_VERSION,
          regime: row.regime,
          regimeLabel: row.regimeLabel,
          display: row.text,
          preferChoiceC: row.action?.primary === 'C',
          blockInterrupt: row.regime === 'split',
          action: row.action,
          nDisplay: row.nDisplay,
          dataSource: 'intel-dual-board',
        },
      },
    };
  });
}

function enrichQuestionQueueWithDual(queue, board) {
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
      priorityLabel: '内外双轨',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      dualRegime: q.dualRegime,
      preferChoiceC: q.preferChoiceC,
      blockInterrupt: q.blockInterrupt,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    dualInjected: extra.length,
    version: `${queue.version || ''}+dual`,
  };
}

module.exports = {
  DUAL_BOARD_VERSION,
  buildDualNarrativeBoard,
  attachDualBoardToInstruments,
  enrichQuestionQueueWithDual,
  actionPlay,
};
