/**
 * 情报中心 · 跨品种共振板（构想 §八 P3 / §11）
 * 仅用冲击图已激活边（真实日 K corr + n）+ 命题侧；禁止假相关/合成路径。
 * 分类：resonate | diverge | lagging | pending
 */
const RESONANCE_VERSION = 'v2.73.0-resonance-board';

function sideOf(inst) {
  const s = inst?.intelCenter?.primaryClaim?.side;
  if (s === 'bull' || s === 'bear' || s === 'flat') return s;
  const d = inst?.direction;
  if (d === 'bullish' || d === 'strong_bullish') return 'bull';
  if (d === 'bearish' || d === 'strong_bearish') return 'bear';
  return 'flat';
}

function changePct(inst) {
  const n = Number(inst?.changePct);
  return Number.isFinite(n) ? n : null;
}

function beliefOf(inst) {
  return inst?.intelCenter?.beliefLevel || inst?.intelCenter?.primaryClaim?.confidence || null;
}

/**
 * @param {object} shockGraph from buildShockGraph
 * @param {object[]} instruments
 */
function buildResonanceBoard(shockGraph, instruments, opts = {}) {
  const byId = new Map();
  for (const i of instruments || []) {
    if (!i?.id) continue;
    byId.set(i.id, i);
    byId.set(String(i.id).toLowerCase(), i);
    byId.set(String(i.id).toUpperCase(), i);
  }

  const pairs = [];
  const active = shockGraph?.activeEdges || [];
  const pending = (shockGraph?.pendingEdges || []).slice(0, 12);

  for (const e of active) {
    const src = byId.get(e.from) || byId.get(String(e.from).toLowerCase());
    const tgt = byId.get(e.to) || byId.get(String(e.to).toLowerCase());
    if (!src || !tgt) continue;
    if (e.corr == null || e.n == null || e.n < 20) {
      pairs.push({
        from: e.from,
        to: e.to,
        label: e.label,
        regime: 'pending',
        regimeLabel: '待校验',
        reason: e.n == null ? 'corr n 暂无' : `n=${e.n}<20`,
        corr: e.corr ?? null,
        n: e.n ?? null,
        nDisplay: e.n != null ? String(e.n) : '暂无',
        activation: e.activation ?? null,
        mechanism: e.mechanism,
        pending: true,
        dataSource: 'intel-shock-graph',
      });
      continue;
    }

    const sideA = sideOf(src);
    const sideB = sideOf(tgt);
    const chA = changePct(src);
    const chB = changePct(tgt);
    const corr = Number(e.corr);
    const act = Number(e.activation) || 0;

    let regime = 'resonate';
    let regimeLabel = '共振';
    let reason = '';

    const sidesAgree =
      (sideA === 'bull' && sideB === 'bull') || (sideA === 'bear' && sideB === 'bear');
    const sidesOppose =
      (sideA === 'bull' && sideB === 'bear') || (sideA === 'bear' && sideB === 'bull');

    // 正相关机制下：命题同向+价格同向 → 共振；命题对立 → 分化
    if (corr >= 0.35) {
      if (sidesOppose && act >= 0.2) {
        regime = 'diverge';
        regimeLabel = '分化';
        reason = `机制正相关(corr=${corr})但命题 ${sideA}/${sideB} 对立`;
      } else if (sidesAgree) {
        regime = 'resonate';
        regimeLabel = '共振';
        reason = `正相关+命题同向(${sideA}) · 激活${(act * 100).toFixed(0)}%`;
      } else if (chA != null && chB != null && Math.sign(chA) !== Math.sign(chB) && Math.abs(chA) > 0.8 && Math.abs(chB) < 0.35) {
        regime = 'lagging';
        regimeLabel = '滞后';
        reason = `${src.name || e.from} 已动 ${chA.toFixed(1)}% · ${tgt.name || e.to} 未跟 (${chB.toFixed(1)}%)`;
      } else if (chA != null && chB != null && Math.sign(chA) === Math.sign(chB) && Math.abs(chA) >= 0.5) {
        regime = 'resonate';
        regimeLabel = '共振';
        reason = `价格同向 · corr=${corr} n=${e.n}`;
      } else {
        regime = 'resonate';
        regimeLabel = '弱共振';
        reason = `边已激活但命题/价格信号弱 · corr=${corr}`;
      }
    } else if (corr <= -0.35) {
      // 负相关：命题同向反而可能是分化
      if (sidesAgree && act >= 0.2) {
        regime = 'diverge';
        regimeLabel = '分化';
        reason = `机制负相关(corr=${corr})但命题同向(${sideA})`;
      } else if (sidesOppose) {
        regime = 'resonate';
        regimeLabel = '负相关共振';
        reason = `负相关+命题对立符合机制 · n=${e.n}`;
      } else {
        regime = 'lagging';
        regimeLabel = '待观察';
        reason = `负相关边激活 · 命题侧不明`;
      }
    } else {
      regime = 'pending';
      regimeLabel = '弱相关';
      reason = `|corr|=${Math.abs(corr).toFixed(2)} 偏低 · 不作共振定调`;
    }

    pairs.push({
      from: e.from,
      to: e.to,
      fromName: src.name || e.from,
      toName: tgt.name || e.to,
      label: e.label,
      regime,
      regimeLabel,
      reason,
      corr,
      n: e.n,
      nDisplay: String(e.n),
      activation: act,
      lag: e.lagTypical ?? null,
      mechanism: e.mechanism,
      sideFrom: sideA,
      sideTo: sideB,
      beliefFrom: beliefOf(src),
      beliefTo: beliefOf(tgt),
      pending: false,
      text: `${e.label} · ${regimeLabel} · corr=${corr} n=${e.n} · ${reason}`,
      dataSource: 'intel-resonance-board',
      method: 'shock-edge+claim-side',
    });
  }

  for (const e of pending) {
    pairs.push({
      from: e.from,
      to: e.to,
      label: e.label,
      regime: 'pending',
      regimeLabel: '待校验',
      reason: e.reason || e.text || '冲击边未激活',
      corr: e.corr ?? null,
      n: e.n ?? null,
      nDisplay: e.nDisplay || (e.n != null ? String(e.n) : '暂无'),
      activation: 0,
      mechanism: e.mechanism,
      pending: true,
      text: e.text || `${e.label} · 待校验`,
      dataSource: 'intel-shock-graph',
    });
  }

  const resonate = pairs.filter((p) => p.regime === 'resonate' && !p.pending);
  const diverge = pairs.filter((p) => p.regime === 'diverge');
  const lagging = pairs.filter((p) => p.regime === 'lagging');
  const pendingPairs = pairs.filter((p) => p.regime === 'pending' || p.pending);

  // 按品种索引
  const byInstrument = {};
  for (const p of pairs) {
    for (const id of [p.from, p.to]) {
      if (!id) continue;
      if (!byInstrument[id]) {
        byInstrument[id] = { resonate: [], diverge: [], lagging: [], pending: [] };
      }
      const bucket =
        p.regime === 'diverge'
          ? 'diverge'
          : p.regime === 'lagging'
            ? 'lagging'
            : p.regime === 'pending' || p.pending
              ? 'pending'
              : 'resonate';
      byInstrument[id][bucket].push(p);
    }
  }

  const questions = [];
  for (const p of [...diverge, ...lagging].slice(0, 8)) {
    if (p.pending) continue;
    questions.push({
      priority: p.regime === 'diverge' ? 'P3' : 'P3',
      score: p.regime === 'diverge' ? 28 : 22,
      instrumentId: p.to,
      instrumentName: p.toName || p.to,
      peerId: p.from,
      peerName: p.fromName || p.from,
      question:
        p.regime === 'diverge'
          ? `${p.fromName || p.from}↔${p.toName || p.to}：机制边分化 — ${p.reason}？`
          : `${p.fromName || p.from}→${p.toName || p.to}：是否滞后传导 — ${p.reason}？`,
      reasons: ['跨品种共振板', p.regimeLabel, `n=${p.nDisplay}`],
      claimId: null,
      resonanceRegime: p.regime,
      dataSource: 'intel-resonance-board',
    });
  }

  const top = [...diverge, ...lagging, ...resonate.filter((p) => !p.pending)]
    .sort((a, b) => (b.activation || 0) - (a.activation || 0))
    .slice(0, 12);

  return {
    version: RESONANCE_VERSION,
    asOf: opts.asOf || null,
    pairs: pairs.slice(0, 40),
    top,
    counts: {
      resonate: resonate.length,
      diverge: diverge.length,
      lagging: lagging.length,
      pending: pendingPairs.length,
    },
    byInstrument,
    questions,
    display:
      diverge.length || lagging.length
        ? `共振板 分化${diverge.length} · 滞后${lagging.length} · 共振${resonate.length}（边均带 n）`
        : resonate.length
          ? `共振板 共振${resonate.length} · 暂无显著分化`
          : pendingPairs.length
            ? `共振板 待校验边 ${pendingPairs.length} · 暂无激活定调`
            : '共振板 暂无',
    note: '仅冲击图实证边；n不足标待校验，禁止假 corr',
    dataSource: 'intel-resonance-board',
    method: 'shock-corr+claim-side-classify',
  };
}

function attachResonanceToInstruments(instruments, board) {
  if (!board?.byInstrument) return instruments;
  return (instruments || []).map((inst) => {
    const slice = board.byInstrument[inst.id] || board.byInstrument[String(inst.id).toLowerCase()];
    if (!slice) return inst;
    const summary = {
      version: RESONANCE_VERSION,
      resonate: (slice.resonate || []).slice(0, 4),
      diverge: (slice.diverge || []).slice(0, 4),
      lagging: (slice.lagging || []).slice(0, 4),
      display:
        (slice.diverge || []).length
          ? `分化 ${(slice.diverge || []).map((p) => p.label).slice(0, 2).join('、')}`
          : (slice.lagging || []).length
            ? `滞后 ${(slice.lagging || []).map((p) => p.label).slice(0, 2).join('、')}`
            : (slice.resonate || []).length
              ? `共振 ${(slice.resonate || []).length} 边`
              : '暂无共振边',
      dataSource: 'intel-resonance-board',
    };
    return {
      ...inst,
      intelCenter: {
        ...(inst.intelCenter || {}),
        resonance: summary,
      },
    };
  });
}

function enrichQuestionQueueWithResonance(queue, board) {
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
      priority: 'P3',
      priorityLabel: '跨品种共振',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      resonanceRegime: q.resonanceRegime,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    resonanceInjected: extra.length,
    version: `${queue.version || ''}+resonance`,
  };
}

module.exports = {
  RESONANCE_VERSION,
  buildResonanceBoard,
  attachResonanceToInstruments,
  enrichQuestionQueueWithResonance,
};
