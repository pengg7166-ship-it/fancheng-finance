/**
 * 情报中心 · 多跳冲击路径（构想 §11/42/50）
 * 仅拼接冲击图已实证边（真实 corr + n）；禁止合成假相关 / 假激活。
 * 默认最多 2 跳；路径强度 = 跳 corr 乘积 · n = min(跳 n) · lag = 跳 lag 之和。
 */
const MULTIHOP_VERSION = 'v2.77.0-shock-multihop';

function idKey(id) {
  return String(id || '').toLowerCase();
}

function hopKey(from, to) {
  return `${idKey(from)}->${idKey(to)}`;
}

/**
 * @param {object[]} empiricalEdges — buildShockGraph 中 available===true 的边
 * @param {object[]} activeEdges — 当日已激活的 1 跳边
 * @param {object[]} instruments
 */
function buildMultiHopBoard(empiricalEdges, activeEdges, instruments, opts = {}) {
  const maxHops = opts.maxHops || 2;
  const minAbsPathCorr = opts.minAbsPathCorr ?? 0.08;
  const minHopN = opts.minHopN ?? 40;

  const byId = new Map();
  for (const i of instruments || []) {
    if (!i?.id) continue;
    byId.set(i.id, i);
    byId.set(String(i.id).toLowerCase(), i);
    byId.set(String(i.id).toUpperCase(), i);
  }

  const hops = (empiricalEdges || []).filter(
    (e) => e && e.available && e.corr != null && e.n != null && e.n >= minHopN && Math.abs(e.corr) >= 0.18
  );
  if (!hops.length) {
    return emptyBoard(opts.asOf, '暂无足够实证边可拼多跳');
  }

  const adj = new Map();
  for (const e of hops) {
    const k = idKey(e.from);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push(e);
  }

  const activeMap = new Map();
  for (const e of activeEdges || []) {
    activeMap.set(hopKey(e.from, e.to), e);
  }

  const paths = [];
  const seen = new Set();

  for (const e1 of hops) {
    const mid = idKey(e1.to);
    const nexts = adj.get(mid) || [];
    for (const e2 of nexts) {
      if (idKey(e2.to) === idKey(e1.from)) continue; // 禁立刻回环
      if (idKey(e2.to) === mid) continue;
      const nodes = [idKey(e1.from), mid, idKey(e2.to)];
      if (new Set(nodes).size < 3) continue;

      const pathId = `${nodes.join('→')}`;
      if (seen.has(pathId)) continue;
      seen.add(pathId);

      const pathCorr = +(e1.corr * e2.corr).toFixed(4);
      const pathN = Math.min(e1.n, e2.n);
      const pathLag = (e1.lagTypical ?? e1.lag ?? 0) + (e2.lagTypical ?? e2.lag ?? 0);
      if (Math.abs(pathCorr) < minAbsPathCorr) continue;

      const a1 = activeMap.get(hopKey(e1.from, e1.to));
      const a2 = activeMap.get(hopKey(e2.from, e2.to));
      const liveHops = [a1, a2].filter(Boolean).length;
      let status = 'structural';
      let statusLabel = '结构链';
      let activation = null;
      let pending = false;
      let reason = '';

      if (liveHops === 2) {
        status = 'live';
        statusLabel = '活多跳';
        activation = +Math.min(1, Math.min(a1.activation, a2.activation) * 0.7).toFixed(4);
        reason = `两跳均激活 · pathCorr=${pathCorr}`;
      } else if (liveHops === 1) {
        status = 'partial';
        statusLabel = '半激活';
        activation = +(Math.min(a1?.activation || a2?.activation || 0, 1) * 0.45).toFixed(4);
        reason = a1 && !a2 ? '首跳活·次跳待冲击' : '次跳活·首跳待冲击';
        pending = false;
      } else {
        status = 'structural';
        statusLabel = '结构链';
        activation = 0;
        reason = '实证链·当日源冲击不足';
        pending = true;
      }

      // 中间节点滞后：源已动、中继/终点未跟
      const src = byId.get(e1.from) || byId.get(String(e1.from).toLowerCase());
      const midInst = byId.get(e1.to) || byId.get(String(e1.to).toLowerCase());
      const sink = byId.get(e2.to) || byId.get(String(e2.to).toLowerCase());
      const chSrc = Number(src?.changePct);
      const chMid = Number(midInst?.changePct);
      const chSink = Number(sink?.changePct);
      let lagging = false;
      let lagNote = null;
      if (
        Number.isFinite(chSrc) &&
        Math.abs(chSrc) >= 0.8 &&
        Number.isFinite(chSink) &&
        Math.abs(chSink) < 0.35 &&
        Math.sign(chSrc) === Math.sign(pathCorr) // 正相关链时期望同向
      ) {
        lagging = true;
        lagNote = `${src?.name || e1.from} 已动 ${chSrc.toFixed(1)}% · ${sink?.name || e2.to} 未跟 (${chSink.toFixed(1)}%)`;
      } else if (
        Number.isFinite(chSrc) &&
        Math.abs(chSrc) >= 0.8 &&
        Number.isFinite(chMid) &&
        Math.abs(chMid) < 0.35
      ) {
        lagging = true;
        lagNote = `${src?.name || e1.from} 已动 · 中继 ${midInst?.name || e1.to} 未跟`;
      }

      const hopDisplays = [
        `${e1.label || `${e1.from}→${e1.to}`} corr=${e1.corr} n=${e1.n}`,
        `${e2.label || `${e2.from}→${e2.to}`} corr=${e2.corr} n=${e2.n}`,
      ];

      const text = `2跳 ${e1.from}→${e1.to}→${e2.to} · pathCorr=${pathCorr} lag=${pathLag}d · n=${pathN} · ${statusLabel}${
        lagging ? ' · 滞后' : ''
      }`;

      paths.push({
        pathId,
        hops: 2,
        from: e1.from,
        via: e1.to,
        to: e2.to,
        fromName: src?.name || e1.from,
        viaName: midInst?.name || e1.to,
        toName: sink?.name || e2.to,
        nodes: [e1.from, e1.to, e2.to],
        hopEdges: [
          {
            from: e1.from,
            to: e1.to,
            label: e1.label,
            corr: e1.corr,
            n: e1.n,
            nDisplay: String(e1.n),
            lag: e1.lagTypical ?? e1.lag ?? null,
            mechanism: e1.mechanism,
            live: Boolean(a1),
          },
          {
            from: e2.from,
            to: e2.to,
            label: e2.label,
            corr: e2.corr,
            n: e2.n,
            nDisplay: String(e2.n),
            lag: e2.lagTypical ?? e2.lag ?? null,
            mechanism: e2.mechanism,
            live: Boolean(a2),
          },
        ],
        hopDisplays,
        pathCorr,
        pathN,
        nDisplay: String(pathN),
        pathLag,
        status,
        statusLabel,
        activation,
        pending,
        lagging,
        lagNote,
        reason,
        text,
        mechanisms: [e1.mechanism, e2.mechanism].filter(Boolean),
        dataSource: 'intel-shock-multihop',
        method: 'compose-empirical-2hop-corr-product',
        note: 'pathCorr=跳corr乘积，非独立估计；禁止当作单边假相关',
      });
    }
  }

  // 仅支持 maxHops=2 本波；预留扩展点
  if (maxHops > 2) {
    // intentionally unused — 3+ 跳需更严 n 门禁，本波不做
  }

  paths.sort((a, b) => {
    const liveRank = (p) => (p.status === 'live' ? 2 : p.status === 'partial' ? 1 : 0);
    const d = liveRank(b) - liveRank(a);
    if (d) return d;
    if (a.lagging !== b.lagging) return a.lagging ? -1 : 1;
    return Math.abs(b.pathCorr) - Math.abs(a.pathCorr);
  });

  const live = paths.filter((p) => p.status === 'live');
  const partial = paths.filter((p) => p.status === 'partial');
  const structural = paths.filter((p) => p.status === 'structural');
  const laggingPaths = paths.filter((p) => p.lagging);

  const questions = [];
  for (const p of [...laggingPaths, ...partial].slice(0, 8)) {
    questions.push({
      priority: 'P3',
      score: p.lagging ? 30 : 24,
      instrumentId: p.to,
      instrumentName: p.toName,
      viaId: p.via,
      fromId: p.from,
      question: p.lagging
        ? `多跳 ${p.from}→${p.via}→${p.to}：是否滞后传导 — ${p.lagNote || p.reason}？`
        : `多跳 ${p.from}→${p.via}→${p.to}：半激活 — ${p.reason}（pathCorr=${p.pathCorr} n=${p.nDisplay}）？`,
      reasons: ['多跳冲击', p.statusLabel, `n=${p.nDisplay}`],
      multiHop: true,
      pathId: p.pathId,
      dataSource: 'intel-shock-multihop',
    });
  }

  const byInstrument = {};
  for (const p of paths.slice(0, 40)) {
    for (const nid of [p.from, p.via, p.to]) {
      const k = String(nid);
      if (!byInstrument[k]) byInstrument[k] = { asSource: [], asVia: [], asSink: [] };
      if (idKey(nid) === idKey(p.from)) byInstrument[k].asSource.push(p);
      if (idKey(nid) === idKey(p.via)) byInstrument[k].asVia.push(p);
      if (idKey(nid) === idKey(p.to)) byInstrument[k].asSink.push(p);
    }
  }

  const top = paths.slice(0, 12);
  const display =
    live.length || partial.length
      ? `多跳 活${live.length} · 半激活${partial.length} · 结构${structural.length}${
          laggingPaths.length ? ` · 滞后${laggingPaths.length}` : ''
        }`
      : structural.length
        ? `多跳 结构链 ${structural.length} · 当日暂无活多跳`
        : '多跳 暂无（实证边不足或无可拼 2 跳）';

  return {
    version: MULTIHOP_VERSION,
    asOf: opts.asOf || null,
    maxHops: 2,
    paths: paths.slice(0, 40),
    top,
    live,
    partial,
    structural,
    lagging: laggingPaths,
    counts: {
      total: paths.length,
      live: live.length,
      partial: partial.length,
      structural: structural.length,
      lagging: laggingPaths.length,
    },
    questions,
    byInstrument,
    display,
    note: '仅实证边拼接；pathCorr=乘积·n=min；禁止假 corr',
    dataSource: 'intel-shock-multihop',
    method: 'compose-empirical-2hop-corr-product',
  };
}

function emptyBoard(asOf, reason) {
  return {
    version: MULTIHOP_VERSION,
    asOf: asOf || null,
    maxHops: 2,
    paths: [],
    top: [],
    live: [],
    partial: [],
    structural: [],
    lagging: [],
    counts: { total: 0, live: 0, partial: 0, structural: 0, lagging: 0 },
    questions: [],
    byInstrument: {},
    display: reason || '多跳 暂无',
    note: '仅实证边拼接；禁止假 corr',
    dataSource: 'intel-shock-multihop',
    method: 'compose-empirical-2hop-corr-product',
  };
}

function attachMultiHopToInstruments(instruments, board) {
  if (!board?.byInstrument) return instruments;
  return (instruments || []).map((inst) => {
    const slice =
      board.byInstrument[inst.id] ||
      board.byInstrument[String(inst.id).toLowerCase()] ||
      board.byInstrument[String(inst.id).toUpperCase()];
    if (!slice) return inst;
    const asSink = (slice.asSink || []).slice(0, 3);
    const asVia = (slice.asVia || []).slice(0, 2);
    const asSource = (slice.asSource || []).slice(0, 3);
    const liveN = [...asSink, ...asVia, ...asSource].filter((p) => p.status === 'live').length;
    const lagN = [...asSink, ...asVia, ...asSource].filter((p) => p.lagging).length;
    return {
      ...inst,
      intelCenter: {
        ...(inst.intelCenter || {}),
        multiHop: {
          version: MULTIHOP_VERSION,
          asSource: asSource.map(slimPath),
          asVia: asVia.map(slimPath),
          asSink: asSink.map(slimPath),
          liveCount: liveN,
          laggingCount: lagN,
          display: lagN
            ? `多跳滞后 ${lagN}`
            : liveN
              ? `活多跳 ${liveN}`
              : asSink.length || asSource.length
                ? `多跳结构 ${(asSink.length || 0) + (asSource.length || 0)}`
                : '暂无多跳',
          dataSource: 'intel-shock-multihop',
        },
      },
    };
  });
}

function slimPath(p) {
  return {
    pathId: p.pathId,
    text: p.text,
    status: p.status,
    statusLabel: p.statusLabel,
    pathCorr: p.pathCorr,
    nDisplay: p.nDisplay,
    lagging: p.lagging,
    from: p.from,
    via: p.via,
    to: p.to,
  };
}

function enrichQuestionQueueWithMultiHop(queue, board) {
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
      priorityLabel: '多跳冲击',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      multiHop: true,
      pathId: q.pathId,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    multiHopInjected: extra.length,
    version: `${queue.version || ''}+multihop`,
  };
}

module.exports = {
  MULTIHOP_VERSION,
  buildMultiHopBoard,
  attachMultiHopToInstruments,
  enrichQuestionQueueWithMultiHop,
};
