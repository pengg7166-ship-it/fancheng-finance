/**
 * 情报中心 · 机制图产品板（构想 §11/42/50 + 命题机制链）
 * v2.88：三态 taxonomy — liveActive / empiricalReady / pendingInsufficientN
 * v2.89.2：桶按诚实 claim（co_move），禁止 corr-only 进「成本传导」桶
 */
const MECHANISM_BOARD_VERSION = 'v2.89.23-shared-mechanism-chain';
const { buildSharedMechanismChains } = require('./intel-shared-mechanism-chain');

const MECH_LABELS = {
  cost: '成本传导',
  substitute: '替代',
  sentiment: '情绪/联动',
  arbitrage: '套利',
  co_move: '滞后共动',
  multihop: '多跳',
  other: '其他',
};

const STATUS = {
  liveActive: 'liveActive',
  empiricalReady: 'empiricalReady',
  pendingInsufficientN: 'pendingInsufficientN',
};

function bucketOf(mechanism) {
  const m = String(mechanism || 'other');
  if (MECH_LABELS[m]) return m;
  return 'other';
}

function statusLabel(status) {
  if (status === STATUS.liveActive) return '活';
  if (status === STATUS.empiricalReady) return '实证休眠';
  if (status === STATUS.pendingInsufficientN) return 'n不足';
  return '待校验';
}

function hasEmpirics(e) {
  const nOk = e.n != null && Number(e.n) >= 20;
  const corrOk = e.corr != null && Number.isFinite(Number(e.corr));
  return nOk && corrOk;
}

function classifyPending(e) {
  const reason = String(e.reason || e.text || '');
  // 有实证但源冲击不足 / 漂移 / 不在包 → 休眠，不是「无实证」
  if (hasEmpirics(e)) return STATUS.empiricalReady;
  if (/源冲击不足|漂移|不在今日包|activation/i.test(reason) && (e.n != null && e.n >= 20)) {
    return STATUS.empiricalReady;
  }
  return STATUS.pendingInsufficientN;
}

function edgeRow(e, status) {
  const nDisplay = e.nDisplay || (e.n != null ? String(e.n) : '暂无');
  const corrPart =
    e.corr != null && Number.isFinite(Number(e.corr)) ? ` corr=${Number(e.corr).toFixed(2)}` : ' corr=暂无';
  const lagPart = e.lagTypical != null || e.lag != null ? ` lag${e.lagTypical ?? e.lag}d` : '';
  const st = statusLabel(status);
  const mechKey = e.mechanismClaim || e.mechanism || 'other';
  const mechLabel =
    e.mechanismLabel || MECH_LABELS[bucketOf(mechKey)] || mechKey || '其他';
  const priorBit =
    e.mechanismPrior && e.mechanismPrior !== mechKey
      ? ` · 先验${e.mechanismPriorLabel || e.mechanismPrior}`
      : '';
  const honestyBit = e.mechanismHonestyNote ? ` · ${e.mechanismHonestyNote}` : '';
  return {
    from: e.from,
    to: e.to,
    instrumentId: e.to || e.from,
    label: e.label || `${e.from}→${e.to}`,
    mechanism: mechKey,
    mechanismClaim: mechKey,
    mechanismPrior: e.mechanismPrior || e.mechanism || null,
    mechanismPriorLabel: e.mechanismPriorLabel || null,
    mechanismLabel: mechLabel,
    causalLanguageAllowed: e.causalLanguageAllowed !== false,
    status,
    statusLabel: st,
    pending: status !== STATUS.liveActive,
    dormant: status === STATUS.empiricalReady,
    insufficientN: status === STATUS.pendingInsufficientN,
    activation: e.activation ?? null,
    corr: e.corr ?? null,
    n: e.n ?? null,
    nDisplay,
    lag: e.lagTypical ?? e.lag ?? null,
    reason: e.reason || null,
    text:
      e.path ||
      e.text ||
      `${e.label || `${e.from}→${e.to}`} · ${mechLabel}${priorBit} · ${st}${lagPart}${corrPart} (n=${nDisplay})${honestyBit}`,
    dataSource: e.dataSource || 'intel-shock-graph',
  };
}

function claimMechanismRows(instruments) {
  const rows = [];
  for (const inst of instruments || []) {
    const claim = inst.intelCenter?.primaryClaim;
    if (!claim) continue;
    const depth = claim.mechanismDepth;
    const links = claim.mechanismLinks || [];
    const available = links.filter((l) => l.available).length;
    const missing = links.filter((l) => !l.available).map((l) => l.step);
    rows.push({
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
      chain: claim.mechanismChain || claim.mechanism || '暂无',
      depth: depth ?? null,
      depthDisplay: claim.mechanismDepthDisplay || (depth != null ? String(depth) : '暂无'),
      availableLinks: available,
      missingSteps: missing,
      thin: available < 2,
      text: `${inst.name || inst.id} · 机制深 ${
        claim.mechanismDepthDisplay || (depth != null ? String(depth) : '暂无')
      }${available < 2 ? ' · 链薄' : ''}`,
      dataSource: 'intel-claim-library',
    });
  }
  rows.sort((a, b) => (a.availableLinks || 0) - (b.availableLinks || 0));
  return rows;
}

function emptyBucket(key) {
  return {
    id: key,
    label: MECH_LABELS[key] || key,
    liveActive: [],
    empiricalReady: [],
    pendingInsufficientN: [],
  };
}

function buildMechanismBoard(shockGraph, instruments, opts = {}) {
  const liveActive = (shockGraph?.activeEdges || shockGraph?.edges || []).map((e) =>
    edgeRow(e, STATUS.liveActive)
  );

  // topPaths 回退：仅非 pending 且有激活
  let live = liveActive;
  if (!live.length && shockGraph?.topPaths?.length) {
    live = (shockGraph.topPaths || [])
      .filter((p) => !p.pending && (p.activation == null || p.activation >= 0.12))
      .map((p) =>
        edgeRow(
          {
            from: p.from,
            to: p.to,
            label: p.label || p.text,
            mechanism: p.mechanism,
            corr: p.corr,
            n: p.n,
            nDisplay: p.nDisplay,
            lagTypical: p.lag,
            activation: p.activation,
            path: p.text,
            dataSource: p.dataSource,
          },
          STATUS.liveActive
        )
      );
  }

  const empiricalReady = [];
  const pendingInsufficientN = [];
  for (const e of shockGraph?.pendingEdges || []) {
    const status = classifyPending(e);
    const row = edgeRow(e, status);
    if (status === STATUS.empiricalReady) empiricalReady.push(row);
    else pendingInsufficientN.push(row);
  }

  const byMechanism = {};
  for (const key of Object.keys(MECH_LABELS)) byMechanism[key] = emptyBucket(key);

  const pushBucket = (e) => {
    const b = bucketOf(e.mechanism);
    if (!byMechanism[b]) byMechanism[b] = emptyBucket(b);
    if (e.status === STATUS.liveActive) byMechanism[b].liveActive.push(e);
    else if (e.status === STATUS.empiricalReady) byMechanism[b].empiricalReady.push(e);
    else byMechanism[b].pendingInsufficientN.push(e);
  };
  for (const e of live) pushBucket(e);
  for (const e of empiricalReady) pushBucket(e);
  for (const e of pendingInsufficientN) pushBucket(e);

  const buckets = Object.values(byMechanism)
    .map((b) => {
      const a = b.liveActive.length;
      const r = b.empiricalReady.length;
      const p = b.pendingInsufficientN.length;
      return {
        ...b,
        liveActiveCount: a,
        empiricalReadyCount: r,
        pendingInsufficientNCount: p,
        // 兼容旧字段：live=活激活 only
        liveCount: a,
        pendingCount: r + p,
        display: `${b.label} 活${a} · 休眠${r} · n不足${p}`,
      };
    })
    .filter((b) => b.liveActiveCount + b.empiricalReadyCount + b.pendingInsufficientNCount > 0)
    .sort(
      (a, b) =>
        b.liveActiveCount +
        b.empiricalReadyCount +
        b.pendingInsufficientNCount -
        (a.liveActiveCount + a.empiricalReadyCount + a.pendingInsufficientNCount)
    );

  const claimRows = claimMechanismRows(instruments);
  const thinClaims = claimRows.filter((r) => r.thin).slice(0, 12);

  const questions = [];
  for (const e of empiricalReady.slice(0, 6)) {
    questions.push({
      priority: 'P3',
      score: 26,
      instrumentId: e.to || e.from,
      instrumentName: e.label,
      question: `${e.label}：实证就绪(n=${e.nDisplay}${e.corr != null ? ` corr=${Number(e.corr).toFixed(2)}` : ''})但休眠 — 源冲击不足还是阈值未到？`,
      reasons: ['机制图', 'empiricalReady'],
      dataSource: 'intel-mechanism-board',
    });
  }
  for (const e of pendingInsufficientN.slice(0, 4)) {
    if ((e.n || 0) > 0 && (e.n || 0) < 20) {
      questions.push({
        priority: 'P3',
        score: 22,
        instrumentId: e.to || e.from,
        instrumentName: e.label,
        question: `${e.label}：n=${e.nDisplay}不足20 · 禁止当活边 — 等样本还是换链路？`,
        reasons: ['机制图', 'pendingInsufficientN'],
        dataSource: 'intel-mechanism-board',
      });
    }
  }
  for (const r of thinClaims.slice(0, 4)) {
    questions.push({
      priority: 'P2',
      score: 28,
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      question: `${r.instrumentName}：机制链仅 ${r.depthDisplay} 环可用${
        r.missingSteps?.length ? ` · 缺 ${r.missingSteps.slice(0, 3).join('/')}` : ''
      } — 补基差/内外还是降置信？`,
      reasons: ['机制图', 'thin-chain'],
      dataSource: 'intel-mechanism-board',
    });
  }
  const honestyDeniedEdges = [...live, ...empiricalReady].filter((e) => e.causalLanguageAllowed === false);
  for (const e of honestyDeniedEdges.slice(0, 5)) {
    questions.push({
      priority: 'P2',
      score: 32,
      instrumentId: e.to || e.from,
      instrumentName: e.label,
      question: `${e.label}：仅滞后相关 · 禁止「${e.mechanismPriorLabel || e.mechanismPrior || '成本传导'}」话术 — 补基差/合证/事件还是保持共动？`,
      reasons: ['机制图', 'mechanism-honesty', 'corr-only'],
      dataSource: 'intel-mechanism-board',
    });
  }

  const a = live.length;
  const r = empiricalReady.length;
  const p = pendingInsufficientN.length;
  const honestyDenied = honestyDeniedEdges.length;
  const coMoveBucket = buckets.find((b) => b.id === 'co_move');
  const sharedChains = buildSharedMechanismChains(shockGraph, instruments, {
    asOf: opts.asOf || shockGraph?.asOf || null,
  });

  return {
    version: MECHANISM_BOARD_VERSION,
    asOf: opts.asOf || shockGraph?.asOf || null,
    shockVersion: shockGraph?.version || null,
    statusEnum: STATUS,
    counts: {
      liveActive: a,
      empiricalReady: r,
      pendingInsufficientN: p,
      honestyDenied,
      coMove: coMoveBucket
        ? coMoveBucket.liveActiveCount +
          coMoveBucket.empiricalReadyCount +
          coMoveBucket.pendingInsufficientNCount
        : 0,
      // 兼容：live 仅活激活；pending=休眠+n不足
      live: a,
      pending: r + p,
      thinClaims: thinClaims.length,
      buckets: buckets.length,
      sharedChains: sharedChains?.counts?.sharedChains || 0,
      sharedChainsWithN: sharedChains?.counts?.sharedChainsWithN || 0,
    },
    buckets,
    liveActive: live.slice(0, 12),
    empiricalReady: empiricalReady.slice(0, 12),
    pendingInsufficientN: pendingInsufficientN.slice(0, 12),
    honestyDenied: honestyDeniedEdges.slice(0, 12),
    // 兼容旧 Hub 字段
    live: live.slice(0, 12),
    pending: [...empiricalReady, ...pendingInsufficientN].slice(0, 12),
    thinClaims,
    claimRows: claimRows.slice(0, 16),
    sharedChains,
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 10),
    display:
      a + r + p > 0
        ? `机制图 活${a} · 实证休眠${r} · n不足${p} · 链薄${thinClaims.length}${
            honestyDenied ? ` · 因果降权${honestyDenied}` : ''
          }${buckets[0] ? ` · 主桶 ${buckets[0].label}` : ''}${
            sharedChains?.counts?.sharedChainsWithN
              ? ` · 共享链${sharedChains.counts.sharedChainsWithN}`
              : ''
          }`
        : '机制图 暂无候选边',
    note: '活=真激活；corr≠成本传导；共享链=候选机制聚类覆盖',
    dataSource: 'intel-mechanism-board',
    method: 'taxonomy+mechanism-honesty+shared-chains',
  };
}

function enrichQuestionQueueWithMechanism(queue, board) {
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
      priority: q.priority || 'P3',
      priorityLabel: '机制图',
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
    mechanismInjected: extra.length,
    version: `${queue.version || ''}+mech`,
  };
}

module.exports = {
  MECHANISM_BOARD_VERSION,
  MECH_LABELS,
  STATUS,
  classifyPending,
  buildMechanismBoard,
  enrichQuestionQueueWithMechanism,
};
