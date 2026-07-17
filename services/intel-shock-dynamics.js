/**
 * 情报中心 · 冲击激活动力学（构想 §11）
 * 滞后分布 + 弹性(β·n) + 激活态机(firing→awaiting→confirmed/missed) + 有序盯盘清单。
 * 禁止用 corr 冒充已验证传导；验证失败标 missed，命中率带 n。
 */
const fs = require('fs');
const path = require('path');
const { getIntelDir, appendJsonl, readJsonl } = require('./intel-memory');

const DYNAMICS_VERSION = 'v2.89.22-shock-edge-verify';
const STATE_FILE = 'shock-activation-state.json';
const VERIFY_LOG = 'shock-transmission-verify.jsonl';
const EDGE_VERIFY_N_GATE = 5;

const STATE_LABELS = {
  dormant: '休眠',
  armed: '待命',
  firing: '点火',
  awaiting: '待验证',
  confirmed: '传导确认',
  missed: '传导未兑现',
  decaying: '衰减',
};

function edgeKey(from, to) {
  return `${String(from)}->${String(to)}`;
}

function addCalendarDays(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000
  );
}

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 20) return null;
  const a = x.slice(-n);
  const b = y.slice(-n);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += a[i];
    sy += b[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = a[i] - mx;
    const vy = b[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx <= 0 || dy <= 0) return null;
  return +(num / Math.sqrt(dx * dy)).toFixed(4);
}

/** 滞后分布：各 lag 的 corr/n，非单一固定日 */
function computeLagDistribution(srcRets, tgtRets, { maxLag = 5, minN = 40 } = {}) {
  const lags = [];
  for (let lag = 0; lag <= maxLag; lag += 1) {
    if (srcRets.length <= lag + 20 || tgtRets.length <= lag + 20) continue;
    const x = srcRets.slice(0, srcRets.length - lag);
    const y = tgtRets.slice(lag);
    const n = Math.min(x.length, y.length);
    if (n < minN) continue;
    const corr = pearson(x.slice(-n), y.slice(-n));
    if (corr == null) continue;
    lags.push({ lag, corr, n, absCorr: Math.abs(corr) });
  }
  if (!lags.length) {
    return {
      available: false,
      lags: [],
      best: null,
      lagSpread: null,
      nDisplay: '暂无',
      method: 'lag-distribution',
      dataSource: 'readCachedKlines',
    };
  }
  lags.sort((a, b) => b.absCorr - a.absCorr || a.lag - b.lag);
  const best = lags[0];
  const significant = lags.filter((l) => l.absCorr >= best.absCorr * 0.7);
  const lagNums = significant.map((l) => l.lag);
  const lagSpread =
    lagNums.length >= 2 ? Math.max(...lagNums) - Math.min(...lagNums) : 0;
  return {
    available: true,
    lags: lags.slice(0, 6),
    best: { lag: best.lag, corr: best.corr, n: best.n },
    secondary: lags[1] ? { lag: lags[1].lag, corr: lags[1].corr, n: lags[1].n } : null,
    significantLags: lagNums.sort((a, b) => a - b),
    lagSpread,
    nDisplay: String(best.n),
    display: `lag分布 最佳${best.lag}d corr=${best.corr} (n=${best.n})${
      lagSpread > 0 ? ` · 宽${lagSpread}d` : ''
    }`,
    method: 'lag-distribution',
    dataSource: 'readCachedKlines',
  };
}

/** 弹性 β：tgt ~ β * src_lagged；n 不足返回暂无 */
function computeElasticity(srcRets, tgtRets, lag = 0, { minN = 40 } = {}) {
  if (!srcRets?.length || !tgtRets?.length) {
    return { available: false, beta: null, n: 0, nDisplay: '暂无', method: 'ols-lagged-beta' };
  }
  const L = Math.max(0, Number(lag) || 0);
  if (srcRets.length <= L + 20 || tgtRets.length <= L + 20) {
    return { available: false, beta: null, n: 0, nDisplay: '暂无', reason: '序列不足', method: 'ols-lagged-beta' };
  }
  const x = srcRets.slice(0, srcRets.length - L);
  const y = tgtRets.slice(L);
  const n = Math.min(x.length, y.length);
  if (n < minN) {
    return {
      available: false,
      beta: null,
      n,
      nDisplay: String(n),
      reason: `n=${n}<${minN}`,
      method: 'ols-lagged-beta',
    };
  }
  const xs = x.slice(-n);
  const ys = y.slice(-n);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  if (den <= 0) {
    return { available: false, beta: null, n, nDisplay: String(n), reason: 'var(src)=0', method: 'ols-lagged-beta' };
  }
  const beta = +(num / den).toFixed(4);
  return {
    available: true,
    beta,
    n,
    nDisplay: String(n),
    lag: L,
    display: `β=${beta} (n=${n}, lag${L}d)`,
    method: 'ols-lagged-beta',
    dataSource: 'readCachedKlines',
  };
}

function enrichEdgeDynamics(edge, aligned) {
  if (!edge?.available || !aligned?.available) {
    return {
      ...edge,
      lagDistribution: { available: false, nDisplay: '暂无' },
      elasticity: { available: false, beta: null, nDisplay: '暂无' },
    };
  }
  const lagDist = computeLagDistribution(aligned.srcRets, aligned.tgtRets, {
    maxLag: 5,
    minN: Math.min(40, Math.max(20, Math.floor((aligned.n || 40) * 0.5))),
  });
  const lag = lagDist.best?.lag ?? edge.lagTypical ?? 0;
  const elasticity = computeElasticity(aligned.srcRets, aligned.tgtRets, lag, {
    minN: Math.min(40, Math.max(20, Math.floor((aligned.n || 40) * 0.5))),
  });
  return {
    ...edge,
    lagDistribution: lagDist,
    elasticity,
    lagTypical: lagDist.best?.lag ?? edge.lagTypical,
    corr: lagDist.best?.corr ?? edge.corr,
  };
}

function loadActivationState() {
  const dir = getIntelDir();
  if (!dir) return { edges: {}, history: [] };
  const fp = path.join(dir, STATE_FILE);
  if (!fs.existsSync(fp)) return { edges: {}, history: [] };
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return { edges: j.edges || {}, history: Array.isArray(j.history) ? j.history : [] };
  } catch {
    return { edges: {}, history: [] };
  }
}

function saveActivationState(state, asOf) {
  const dir = getIntelDir();
  if (!dir || !state) return false;
  fs.writeFileSync(
    path.join(dir, STATE_FILE),
    JSON.stringify(
      {
        version: DYNAMICS_VERSION,
        asOf,
        savedAt: new Date().toISOString(),
        edges: state.edges || {},
        history: (state.history || []).slice(-80),
        dataSource: 'intel-shock-dynamics',
      },
      null,
      2
    ),
    'utf8'
  );
  return true;
}

function sourceShockProxy(inst) {
  if (!inst) return { shock: 0, changePct: 0, sign: 0 };
  const surp = inst?.intelCenter?.surprise?.composite;
  const chg = Number(inst?.changePct) || 0;
  const shock = surp != null ? Number(surp) : Math.min(1, Math.abs(chg) / 3);
  const sign = chg === 0 ? 0 : chg > 0 ? 1 : -1;
  return { shock: Number.isFinite(shock) ? shock : 0, changePct: chg, sign };
}

/**
 * 激活态机 tick：点火 → 待验证 → 确认/未兑现
 * @param {object[]} activeEdges — 今日已激活边
 * @param {object[]} empiricalEdges — 实证可用边（含 elasticity/lag）
 * @param {Map|object} byId
 */
function tickShockDynamics(activeEdges, empiricalEdges, instruments, opts = {}) {
  const asOf = String(opts.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const persist = opts.persist !== false;
  const byId = new Map();
  for (const i of instruments || []) {
    byId.set(i.id, i);
    byId.set(String(i.id).toLowerCase(), i);
  }

  const empMap = new Map();
  for (const e of empiricalEdges || []) {
    if (e?.available) empMap.set(edgeKey(e.from, e.to), e);
  }

  const state = opts.state || loadActivationState();
  const edges = { ...(state.edges || {}) };
  const history = [...(state.history || [])];
  const firedToday = [];
  const verifiedToday = [];

  // 1) 今日激活边 → firing/awaiting
  for (const ae of activeEdges || []) {
    const key = edgeKey(ae.from, ae.to);
    const emp = empMap.get(key) || ae;
    const src = byId.get(ae.from) || byId.get(String(ae.from).toLowerCase());
    const srcShock = sourceShockProxy(src);
    const lag = emp.lagTypical ?? ae.lagTypical ?? ae.lag ?? 1;
    const beta = emp.elasticity?.available ? emp.elasticity.beta : null;
    const corrSign = emp.corr != null ? (emp.corr >= 0 ? 1 : -1) : 1;
    const expectedSign = srcShock.sign === 0 ? corrSign : srcShock.sign * corrSign;
    const prev = edges[key];

    if ((ae.activation || 0) >= 0.12 && srcShock.shock >= 0.2) {
      const expectedBy = addCalendarDays(asOf, Math.max(0, lag));
      if (!prev || prev.state === 'dormant' || prev.state === 'decaying' || prev.state === 'missed' || prev.state === 'confirmed') {
        edges[key] = {
          from: ae.from,
          to: ae.to,
          label: ae.label || key,
          state: daysBetween(asOf, expectedBy) <= 0 ? 'awaiting' : 'firing',
          stateLabel: daysBetween(asOf, expectedBy) <= 0 ? STATE_LABELS.awaiting : STATE_LABELS.firing,
          firedAt: asOf,
          expectedBy,
          lag,
          sourceShock: +srcShock.shock.toFixed(3),
          sourceChangePct: srcShock.changePct,
          expectedSign,
          elasticity: beta,
          elasticityN: emp.elasticity?.n ?? null,
          corr: emp.corr ?? ae.corr ?? null,
          n: emp.n ?? ae.n ?? null,
          nDisplay: emp.nDisplay || ae.nDisplay || (emp.n != null ? String(emp.n) : '暂无'),
          activation: ae.activation,
          verify: null,
        };
        firedToday.push(edges[key]);
      } else if (prev.state === 'firing' && asOf >= prev.expectedBy) {
        edges[key] = { ...prev, state: 'awaiting', stateLabel: STATE_LABELS.awaiting };
      }
    }
  }

  // 2) awaiting → verify
  for (const [key, row] of Object.entries(edges)) {
    if (row.state !== 'awaiting' && row.state !== 'firing') continue;
    if (asOf < row.expectedBy && row.state === 'firing') continue;
    if (asOf < row.expectedBy) continue;

    const tgt = byId.get(row.to) || byId.get(String(row.to).toLowerCase());
    const tgtChg = Number(tgt?.changePct);
    if (!Number.isFinite(tgtChg) || tgt == null) {
      edges[key] = {
        ...row,
        state: 'awaiting',
        stateLabel: STATE_LABELS.awaiting,
        verify: {
          status: 'pending_quote',
          note: '目标涨跌暂无',
          nDisplay: '暂无',
        },
      };
      continue;
    }

    const moved = Math.abs(tgtChg) >= 0.35;
    const signOk = row.expectedSign === 0 ? moved : Math.sign(tgtChg) === row.expectedSign && moved;
    // 弹性粗检：若有 β，期望幅度 ≈ |β| * |srcChg|；达不到也不必强制 miss（只作 note）
    let elasticNote = null;
    if (row.elasticity != null && Number.isFinite(row.sourceChangePct)) {
      const expectedMag = Math.abs(row.elasticity * row.sourceChangePct);
      elasticNote =
        expectedMag >= 0.2
          ? `期望|Δ|≈${expectedMag.toFixed(2)}% · 实际${Math.abs(tgtChg).toFixed(2)}%`
          : null;
    }

    const status = signOk ? 'confirmed' : moved ? 'missed' : 'missed';
    const verify = {
      status,
      asOf,
      targetChangePct: tgtChg,
      expectedSign: row.expectedSign,
      signOk,
      moved,
      elasticNote,
      nDisplay: row.nDisplay || '暂无',
      dataSource: 'quote+shock-dynamics',
    };
    edges[key] = {
      ...row,
      state: status,
      stateLabel: STATE_LABELS[status],
      verify,
      verifiedAt: asOf,
    };
    const histRow = {
      key,
      from: row.from,
      to: row.to,
      label: row.label,
      status,
      firedAt: row.firedAt,
      expectedBy: row.expectedBy,
      targetChangePct: tgtChg,
      expectedSign: row.expectedSign,
      elasticity: row.elasticity,
      n: row.n ?? null,
      nDisplay: row.nDisplay || '暂无',
      asOf,
    };
    history.push(histRow);
    verifiedToday.push(histRow);
    if (persist) {
      try {
        appendJsonl(VERIFY_LOG, histRow);
      } catch {
        // optional
      }
    }
  }

  // 3) confirmed/missed → decaying after 1d, then dormant
  for (const [key, row] of Object.entries(edges)) {
    if ((row.state === 'confirmed' || row.state === 'missed') && row.verifiedAt) {
      const age = daysBetween(row.verifiedAt, asOf);
      if (age >= 2) {
        edges[key] = { ...row, state: 'dormant', stateLabel: STATE_LABELS.dormant };
      } else if (age >= 1) {
        edges[key] = { ...row, state: 'decaying', stateLabel: STATE_LABELS.decaying };
      }
    } else if (row.state === 'decaying' && row.verifiedAt && daysBetween(row.verifiedAt, asOf) >= 2) {
      edges[key] = { ...row, state: 'dormant', stateLabel: STATE_LABELS.dormant };
    }
  }

  const nextState = { edges, history: history.slice(-80) };
  if (persist) saveActivationState(nextState, asOf);

  return {
    version: DYNAMICS_VERSION,
    asOf,
    edges,
    firedToday,
    verifiedToday,
    history: nextState.history,
    dataSource: 'intel-shock-dynamics',
  };
}

function transmissionHitRate(history) {
  const scored = (history || []).filter((h) => h.status === 'confirmed' || h.status === 'missed');
  if (!scored.length) {
    return { rate: null, hits: 0, total: 0, display: '暂无', nDisplay: '暂无', deferred: true };
  }
  const hits = scored.filter((h) => h.status === 'confirmed').length;
  const total = scored.length;
  const pct = +((hits / total) * 100).toFixed(1);
  return {
    rate: hits / total,
    hits,
    total,
    display: `${pct}% (${hits}/${total})`,
    nDisplay: String(total),
    deferred: false,
  };
}

/**
 * 按边聚合历史验证命中（真实 JSONL）；n&lt;GATE 标暂无，禁止假权
 */
function loadEdgeVerifyStats(limit = 800) {
  const rows = readJsonl(VERIFY_LOG, limit);
  const byKey = {};
  for (const r of rows) {
    const from = r.from || r.src || r.sourceId;
    const to = r.to || r.tgt || r.targetId;
    if (!from || !to) continue;
    const status = r.status || r.verify?.status || r.result;
    if (status !== 'confirmed' && status !== 'missed') continue;
    const key = edgeKey(from, to);
    if (!byKey[key]) byKey[key] = { from, to, confirmed: 0, missed: 0, n: 0 };
    byKey[key].n += 1;
    if (status === 'confirmed') byKey[key].confirmed += 1;
    else byKey[key].missed += 1;
  }
  const out = {};
  for (const [key, b] of Object.entries(byKey)) {
    if (b.n < EDGE_VERIFY_N_GATE) {
      out[key] = {
        available: false,
        n: b.n,
        nDisplay: String(b.n),
        note: `验证样本不足(n<${EDGE_VERIFY_N_GATE})`,
        hitDisplay: '暂无',
        dampen: 1,
        method: 'edge-verify-n-gate',
      };
      continue;
    }
    const rate = b.confirmed / b.n;
    let dampen = 1;
    if (rate < 0.35) dampen = 0.55;
    else if (rate < 0.5) dampen = 0.75;
    else if (rate >= 0.65) dampen = 1.08;
    out[key] = {
      available: true,
      n: b.n,
      nDisplay: String(b.n),
      confirmed: b.confirmed,
      missed: b.missed,
      rate: +rate.toFixed(3),
      hitDisplay: `${Math.round(rate * 100)}% (${b.confirmed}/${b.n})`,
      dampen: +dampen.toFixed(3),
      method: `edge-verify-hit-n${EDGE_VERIFY_N_GATE}`,
      dataSource: VERIFY_LOG,
    };
  }
  return out;
}

function applyEdgeVerifyDampening(activeEdges, verifyStats) {
  const stats = verifyStats || loadEdgeVerifyStats();
  return (activeEdges || []).map((e) => {
    const key = edgeKey(e.from, e.to);
    const st = stats[key];
    if (!st) {
      return {
        ...e,
        edgeVerify: { available: false, hitDisplay: '暂无', nDisplay: '暂无', note: '无验证档案' },
      };
    }
    if (!st.available) {
      return { ...e, edgeVerify: st, activationRaw: e.activation };
    }
    const raw = e.activation;
    const next =
      raw != null && Number.isFinite(Number(raw)) ? +(Number(raw) * st.dampen).toFixed(4) : raw;
    return {
      ...e,
      activationRaw: raw,
      activation: next,
      edgeVerify: st,
      activationDamped: st.dampen !== 1,
      method: `${e.method || 'shock-edge'}+verify-dampen`,
    };
  });
}

/**
 * 「原油涨了，还该盯谁」——按期望到达顺序
 */
function buildShockWatchOrder(instruments, empiricalOrActiveEdges, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const minShock = opts.minShock ?? 0.25;
  const byId = new Map();
  for (const i of instruments || []) {
    byId.set(i.id, i);
    byId.set(String(i.id).toLowerCase(), i);
  }

  const sources = [];
  for (const inst of instruments || []) {
    const sp = sourceShockProxy(inst);
    if (sp.shock < minShock && Math.abs(sp.changePct) < 0.8) continue;
    sources.push({
      instrumentId: inst.id,
      instrumentName: inst.name,
      shock: sp.shock,
      changePct: sp.changePct,
      sign: sp.sign,
    });
  }
  sources.sort((a, b) => b.shock - a.shock || Math.abs(b.changePct) - Math.abs(a.changePct));

  const edges = empiricalOrActiveEdges || [];
  const watchlists = [];

  for (const src of sources.slice(0, 6)) {
    const outs = edges
      .filter((e) => {
        const from = String(e.from || '').toLowerCase();
        return from === String(src.instrumentId).toLowerCase() && (e.available !== false || e.activation > 0);
      })
      .map((e) => {
        const tgt = byId.get(e.to) || byId.get(String(e.to).toLowerCase());
        const lag = e.lagTypical ?? e.lag ?? e.lagDistribution?.best?.lag ?? null;
        const beta = e.elasticity?.available ? e.elasticity.beta : null;
        const expectedBy = lag != null ? addCalendarDays(asOf, Math.max(0, lag)) : null;
        const verifyMetric =
          beta != null && Number.isFinite(src.changePct)
            ? `观察 ${e.to} 是否同向·|Δ|参考≈${Math.abs(beta * src.changePct).toFixed(2)}%`
            : `观察 ${e.to} 在 lag 窗内是否跟随源方向`;
        return {
          from: src.instrumentId,
          to: e.to,
          toName: tgt?.name || e.to,
          label: e.label || `${e.from}→${e.to}`,
          lag,
          lagDisplay: lag == null ? '暂无' : `${lag}d`,
          expectedBy,
          corr: e.corr ?? null,
          beta,
          betaDisplay: beta == null ? '暂无' : String(beta),
          n: e.n ?? e.elasticity?.n ?? null,
          nDisplay: e.nDisplay || (e.n != null ? String(e.n) : '暂无'),
          activation: e.activation ?? null,
          verifyMetric,
          mechanismLabel: e.mechanismLabel || e.mechanism || null,
          orderScore: (lag == null ? 9 : lag) * 10 - (e.activation || Math.abs(e.corr || 0)) * 5,
        };
      })
      .sort((a, b) => a.orderScore - b.orderScore || (a.lag ?? 99) - (b.lag ?? 99));

    if (!outs.length) continue;
    watchlists.push({
      sourceId: src.instrumentId,
      sourceName: src.instrumentName,
      sourceShock: src.shock,
      sourceChangePct: src.changePct,
      targets: outs.slice(0, 8),
      display: `${src.instrumentName}冲击 → 盯 ${outs
        .slice(0, 4)
        .map((t) => `${t.toName}(lag${t.lagDisplay})`)
        .join(' · ')}`,
    });
  }

  return {
    version: DYNAMICS_VERSION,
    asOf,
    watchlists,
    display: watchlists.length
      ? `冲击盯盘序 ${watchlists.length} 源 · ${watchlists[0].display}`
      : '冲击盯盘序 暂无（无足够源冲击）',
    dataSource: 'intel-shock-dynamics',
    method: 'source-shock+lag-order+elasticity-verify-metric',
  };
}

function buildShockDynamicsBoard({
  activeEdges = [],
  empiricalEdges = [],
  instruments = [],
  asOf,
  persist = true,
  tickResult = null,
} = {}) {
  const day = asOf || new Date().toISOString().slice(0, 10);
  const edgeVerifyStats = loadEdgeVerifyStats();
  const dampedActive = applyEdgeVerifyDampening(activeEdges, edgeVerifyStats);
  const tick =
    tickResult ||
    tickShockDynamics(dampedActive, empiricalEdges, instruments, { asOf: day, persist });

  const liveStates = Object.values(tick.edges || {}).filter(
    (e) => e.state && e.state !== 'dormant'
  );
  const awaiting = liveStates.filter((e) => e.state === 'awaiting' || e.state === 'firing');
  const confirmed = liveStates.filter((e) => e.state === 'confirmed');
  const missed = liveStates.filter((e) => e.state === 'missed');

  const hit = transmissionHitRate(tick.history);
  const watch = buildShockWatchOrder(instruments, [...dampedActive, ...empiricalEdges], {
    asOf: day,
    edgeVerifyStats,
  });

  // 边上挂历史验证命中
  for (const w of watch.watchlists || []) {
    for (const t of w.targets || []) {
      const st = edgeVerifyStats[edgeKey(t.from, t.to)];
      t.edgeVerifyHit = st?.hitDisplay || '暂无';
      t.edgeVerifyN = st?.nDisplay || '暂无';
      t.edgeVerifyAvailable = Boolean(st?.available);
      if (st?.available) {
        t.verifyMetric = `${t.verifyMetric} · 史命中 ${st.hitDisplay}`;
      }
    }
  }

  const questions = [];
  for (const w of (watch.watchlists || []).slice(0, 3)) {
    const lead = w.targets[0];
    if (!lead) continue;
    questions.push({
      priority: 'P2',
      score: 28,
      instrumentId: lead.to,
      instrumentName: lead.toName,
      question: `${w.sourceName}已冲击：按序盯 ${lead.toName}（期望 ${lead.expectedBy || '暂无'} · ${lead.verifyMetric}）？`,
      reasons: ['冲击动力学盯盘序', w.display, `n=${lead.nDisplay}`, `史命中=${lead.edgeVerifyHit}`],
      dataSource: 'intel-shock-dynamics',
    });
  }
  for (const m of missed.slice(0, 3)) {
    questions.push({
      priority: 'P3',
      score: 22,
      instrumentId: m.to,
      instrumentName: m.to,
      question: `${m.label || m.from + '→' + m.to}：期望传导未兑现 (missed) — 机制失效还是滞后未到？`,
      reasons: ['传导验证', m.verify?.elasticNote || m.stateLabel, `n=${m.nDisplay || '暂无'}`],
      dataSource: 'intel-shock-dynamics',
    });
  }

  return {
    version: DYNAMICS_VERSION,
    asOf: day,
    tick,
    watchOrder: watch,
    transmissionHit: hit,
    awaiting: awaiting.slice(0, 10).map((e) => {
      const st = edgeVerifyStats[edgeKey(e.from, e.to)];
      return {
        from: e.from,
        to: e.to,
        label: e.label,
        state: e.state,
        stateLabel: e.stateLabel,
        expectedBy: e.expectedBy,
        lag: e.lag,
        betaDisplay: e.elasticity != null ? String(e.elasticity) : '暂无',
        nDisplay: e.nDisplay || '暂无',
        edgeVerifyHit: st?.hitDisplay || '暂无',
        edgeVerifyN: st?.nDisplay || '暂无',
        display: `${e.label || e.from + '→' + e.to} · ${e.stateLabel} · 期望${e.expectedBy} · n=${e.nDisplay || '暂无'}${
          st?.available ? ` · 史命中 ${st.hitDisplay}` : ''
        }`,
      };
    }),
    confirmed: confirmed.slice(0, 6),
    missed: missed.slice(0, 6),
    firedToday: (tick.firedToday || []).slice(0, 8),
    dampedActiveCount: dampedActive.filter((e) => e.activationDamped).length,
    edgeVerifyReady: Object.values(edgeVerifyStats).filter((s) => s.available).length,
    questions,
    counts: {
      liveStates: liveStates.length,
      awaiting: awaiting.length,
      confirmed: confirmed.length,
      missed: missed.length,
      firedToday: (tick.firedToday || []).length,
      watchSources: (watch.watchlists || []).length,
      hitTotal: hit.total,
      edgeVerifyReady: Object.values(edgeVerifyStats).filter((s) => s.available).length,
      activationDamped: dampedActive.filter((e) => e.activationDamped).length,
    },
    display: hit.deferred
      ? `冲击动力学 待验${awaiting.length} · 盯盘源${(watch.watchlists || []).length} · 边验证档${Object.values(edgeVerifyStats).filter((s) => s.available).length} · 传导命中暂无`
      : `冲击动力学 待验${awaiting.length} · 传导命中 ${hit.display} · 边验证档${Object.values(edgeVerifyStats).filter((s) => s.available).length}`,
    note: '态机验证用真实涨跌；边激活可按历史 verify 命中阻尼；n不足不改权',
    dataSource: 'intel-shock-dynamics',
    method: 'lag-dist+beta+activation-fsm+edge-verify-dampen',
    trueDynamics: true,
  };
}

function enrichQuestionQueueWithShockDynamics(queue, board) {
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
      priorityLabel: /未兑现|missed/.test(q.question || '') ? '传导未兑现' : '冲击盯盘序',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 18);
  return {
    ...queue,
    all,
    deepQueue: deep,
    shockDynamicsInjected: extra.length,
    version: `${queue.version || ''}+shock-dyn`,
  };
}

function readRecentTransmissionLog(limit = 40) {
  return readJsonl(VERIFY_LOG, limit);
}

module.exports = {
  DYNAMICS_VERSION,
  STATE_LABELS,
  EDGE_VERIFY_N_GATE,
  computeLagDistribution,
  computeElasticity,
  enrichEdgeDynamics,
  tickShockDynamics,
  transmissionHitRate,
  loadEdgeVerifyStats,
  applyEdgeVerifyDampening,
  buildShockWatchOrder,
  buildShockDynamicsBoard,
  enrichQuestionQueueWithShockDynamics,
  loadActivationState,
  saveActivationState,
  readRecentTransmissionLog,
  edgeKey,
  addCalendarDays,
};
