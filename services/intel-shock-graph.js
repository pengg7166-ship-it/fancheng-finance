/**
 * 情报中心 · 活冲击图（构想 §11/42/50）
 * 候选机制边 + 日历对齐日 K 滞后相关；n 不足 → pending 待校验，禁止假 corr。
 * v2.89.10：滞后分布 + 弹性 β + 激活态机/传导验证 + 有序盯盘清单（激活动力学）。
 */
const fs = require('fs');
const path = require('path');
const { readCachedKlines } = require('./commodity-technical-analyzer');
const { getIntelDir } = require('./intel-memory');

const SHOCK_VERSION = 'v2.89.23-shock-edge-catalog';
const SNAPSHOT_FILE = 'shock-graph-snapshot.json';
const { buildMultiHopBoard } = require('./intel-shock-multihop');
const { applyMechanismHonesty } = require('./intel-mechanism-honesty');
const {
  enrichEdgeDynamics,
  buildShockDynamicsBoard,
  computeLagDistribution,
  computeElasticity,
  loadEdgeVerifyStats,
} = require('./intel-shock-dynamics');
const { buildShockEdgeCatalog } = require('./intel-shock-edge-catalog');

/** 机制候选（先验），须被实证滞后相关激活 */
const CANDIDATE_EDGES = [
  { from: 'sc', to: 'fu', mechanism: 'cost', label: '原油→燃油' },
  { from: 'sc', to: 'lu', mechanism: 'cost', label: '原油→低硫燃油' },
  { from: 'sc', to: 'bu', mechanism: 'cost', label: '原油→沥青' },
  { from: 'sc', to: 'TA', mechanism: 'cost', label: '原油→PTA' },
  { from: 'sc', to: 'MA', mechanism: 'cost', label: '原油→甲醇' },
  { from: 'sc', to: 'pp', mechanism: 'cost', label: '原油→聚丙烯' },
  { from: 'sc', to: 'l', mechanism: 'cost', label: '原油→塑料' },
  { from: 'sc', to: 'v', mechanism: 'cost', label: '原油→PVC' },
  { from: 'i', to: 'rb', mechanism: 'cost', label: '铁矿→螺纹' },
  { from: 'i', to: 'hc', mechanism: 'cost', label: '铁矿→热卷' },
  { from: 'jm', to: 'j', mechanism: 'cost', label: '焦煤→焦炭' },
  { from: 'j', to: 'rb', mechanism: 'cost', label: '焦炭→螺纹' },
  { from: 'y', to: 'p', mechanism: 'substitute', label: '豆油↔棕榈' },
  { from: 'p', to: 'y', mechanism: 'substitute', label: '棕榈↔豆油' },
  { from: 'm', to: 'RM', mechanism: 'substitute', label: '豆粕↔菜粕' },
  { from: 'au', to: 'ag', mechanism: 'sentiment', label: '金→银' },
  { from: 'cu', to: 'al', mechanism: 'sentiment', label: '铜→铝' },
  { from: 'cu', to: 'zn', mechanism: 'sentiment', label: '铜→锌' },
  { from: 'cu', to: 'bc', mechanism: 'arbitrage', label: '沪铜↔国际铜' },
  { from: 'rb', to: 'i', mechanism: 'arbitrage', label: '螺纹↔铁矿' },
  { from: 'a', to: 'm', mechanism: 'cost', label: '大豆→豆粕' },
  { from: 'a', to: 'y', mechanism: 'cost', label: '大豆→豆油' },
  { from: 'CF', to: 'CY', mechanism: 'cost', label: '棉花→棉纱' },
];

function loadReturns(instrumentId, lookback = 80) {
  const id = String(instrumentId || '');
  const klines = readCachedKlines(id) || readCachedKlines(id.toLowerCase()) || [];
  const bars = klines
    .map((k) => ({
      date: String(k.date || k.day || '').slice(0, 10),
      close: Number(k.close ?? k.c ?? 0),
    }))
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length < lookback + 5) return null;
  const slice = bars.slice(-(lookback + 1));
  const rets = [];
  const dates = [];
  for (let i = 1; i < slice.length; i += 1) {
    rets.push((slice[i].close - slice[i - 1].close) / slice[i - 1].close);
    dates.push(slice[i].date);
  }
  return { rets, dates, n: rets.length, dataSource: 'readCachedKlines' };
}

/** 按交易日交集对齐收益，避免休市错位 */
function alignReturnsByDate(src, tgt) {
  if (!src?.dates?.length || !tgt?.dates?.length) return null;
  const mapT = new Map();
  for (let i = 0; i < tgt.dates.length; i += 1) mapT.set(tgt.dates[i], tgt.rets[i]);
  const srcRets = [];
  const tgtRets = [];
  const dates = [];
  for (let i = 0; i < src.dates.length; i += 1) {
    const d = src.dates[i];
    if (!mapT.has(d)) continue;
    srcRets.push(src.rets[i]);
    tgtRets.push(mapT.get(d));
    dates.push(d);
  }
  if (srcRets.length < 20) {
    return { available: false, n: srcRets.length, reason: `日历对齐不足 n=${srcRets.length}` };
  }
  return { available: true, srcRets, tgtRets, dates, n: srcRets.length, method: 'date-aligned' };
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

function bestLagCorr(srcRets, tgtRets, maxLag = 5) {
  let best = { lag: null, corr: null, n: 0 };
  for (let lag = 0; lag <= maxLag; lag += 1) {
    if (srcRets.length <= lag + 20 || tgtRets.length <= lag + 20) continue;
    const x = srcRets.slice(0, srcRets.length - lag);
    const y = tgtRets.slice(lag);
    const n = Math.min(x.length, y.length);
    const corr = pearson(x.slice(-n), y.slice(-n));
    if (corr == null) continue;
    if (best.corr == null || Math.abs(corr) > Math.abs(best.corr)) {
      best = { lag, corr, n };
    }
  }
  return best;
}

function empiricalEdge(edge, { lookback = 80, minN = 40, minAbsCorr = 0.18 } = {}) {
  const src = loadReturns(edge.from, lookback);
  const tgt = loadReturns(edge.to, lookback);
  if (!src || !tgt) {
    return {
      ...edge,
      available: false,
      pending: true,
      reason: '日K不足',
      corr: null,
      n: 0,
      nDisplay: '暂无',
      activation: 0,
      dataSource: 'missing',
    };
  }

  const aligned = alignReturnsByDate(src, tgt);
  if (!aligned?.available) {
    return {
      ...edge,
      available: false,
      pending: true,
      reason: aligned?.reason || '日历对齐不足',
      corr: null,
      n: aligned?.n || 0,
      nDisplay: aligned?.n != null ? String(aligned.n) : '暂无',
      activation: 0,
      dataSource: 'readCachedKlines',
      method: 'date-aligned',
    };
  }

  const best = bestLagCorr(aligned.srcRets, aligned.tgtRets, 5);
  if (best.corr == null || best.n < minN) {
    return {
      ...edge,
      available: false,
      pending: true,
      reason: `相关样本不足 n=${best.n || aligned.n}`,
      corr: null,
      n: best.n || aligned.n,
      nDisplay: String(best.n || aligned.n),
      activation: 0,
      dataSource: 'readCachedKlines',
      method: 'date-aligned-lagged-return-pearson',
    };
  }
  if (Math.abs(best.corr) < minAbsCorr) {
    return {
      ...edge,
      available: false,
      pending: true,
      reason: `|corr| ${Math.abs(best.corr)} < ${minAbsCorr}`,
      corr: best.corr,
      lag: best.lag,
      n: best.n,
      nDisplay: String(best.n),
      activation: 0,
      dataSource: 'readCachedKlines',
      method: 'date-aligned-lagged-return-pearson',
    };
  }

  const base = {
    ...edge,
    available: true,
    pending: false,
    lagTypical: best.lag,
    corr: best.corr,
    n: best.n,
    nDisplay: String(best.n),
    empiricalStrength: +Math.min(1, Math.abs(best.corr) / 0.55).toFixed(4),
    dataSource: 'readCachedKlines',
    method: 'date-aligned-lagged-return-pearson',
  };
  return enrichEdgeDynamics(base, aligned);
}

function activationForLiveEdge(edge, sourceRow, targetRow) {
  if (!edge.available) {
    return {
      activation: 0,
      reason: edge.reason || '未实证',
      dataSource: edge.dataSource,
      pending: true,
    };
  }
  const srcSurp = sourceRow?.intelCenter?.surprise?.composite;
  const chg = Math.abs(Number(sourceRow?.changePct) || 0);
  const shockProxy = srcSurp != null ? srcSurp : Math.min(1, chg / 3);
  if (shockProxy < 0.2 && chg < 0.8) {
    return { activation: 0, reason: '源冲击不足', dataSource: 'live-shock', pending: false };
  }

  const pricing = targetRow?.intelCenter?.pricingState?.state;
  let boost = 1;
  if (pricing === 'unpriced') boost = 1.25;
  else if (pricing === 'priced-in') boost = 0.45;
  else if (pricing === 'mispriced') boost = 1.15;

  const act = Math.min(
    1,
    (edge.empiricalStrength || Math.abs(edge.corr || 0)) * (0.35 + shockProxy * 0.65) * boost
  );
  return {
    activation: +act.toFixed(4),
    reason: `corr=${edge.corr} lag=${edge.lagTypical}d n=${edge.n} shock=${shockProxy.toFixed(2)}`,
    dataSource: 'live-shock',
    pending: false,
  };
}

function buildShockGraph(instruments, globalRegime, opts = {}) {
  const byId = new Map();
  for (const i of instruments || []) {
    byId.set(i.id, i);
    byId.set(String(i.id).toLowerCase(), i);
    byId.set(String(i.id).toUpperCase(), i);
  }

  const evaluated = [];
  const activeEdges = [];
  const pendingEdges = [];
  let skippedInsufficient = 0;

  for (const cand of CANDIDATE_EDGES) {
    const edge = empiricalEdge(cand, opts);
    evaluated.push(edge);
    if (!edge.available) {
      skippedInsufficient += 1;
      const pendingRaw = {
        from: edge.from,
        to: edge.to,
        label: edge.label,
        mechanism: edge.mechanism,
        mechanismPrior: edge.mechanism,
        reason: edge.reason,
        n: edge.n ?? null,
        nDisplay: edge.nDisplay || (edge.n != null ? String(edge.n) : '暂无'),
        corr: edge.corr ?? null,
        pending: true,
        dataSource: edge.dataSource || 'intel-shock-graph',
        text: `${edge.label} · 待校验 · ${edge.reason || '样本不足'}${
          edge.nDisplay && edge.nDisplay !== '暂无' ? ` (n=${edge.nDisplay})` : ''
        }`,
      };
      const srcP = byId.get(edge.from) || byId.get(String(edge.from).toLowerCase());
      const tgtP = byId.get(edge.to) || byId.get(String(edge.to).toLowerCase());
      pendingEdges.push(applyMechanismHonesty(pendingRaw, srcP, tgtP));
      continue;
    }
    const sourceRow = byId.get(edge.from) || byId.get(String(edge.from).toLowerCase());
    const targetRow = byId.get(edge.to) || byId.get(String(edge.to).toLowerCase());
    if (!sourceRow || !targetRow) {
      pendingEdges.push(
        applyMechanismHonesty(
          {
            from: edge.from,
            to: edge.to,
            label: edge.label,
            mechanism: edge.mechanism,
            mechanismPrior: edge.mechanism,
            reason: '品种不在今日包',
            n: edge.n,
            nDisplay: edge.nDisplay,
            corr: edge.corr,
            pending: true,
            text: `${edge.label} · 待校验 · 品种不在今日包`,
            dataSource: 'intel-shock-graph',
          },
          null,
          null
        )
      );
      continue;
    }

    const act = activationForLiveEdge(edge, sourceRow, targetRow);
    if (act.activation < 0.12) {
      pendingEdges.push(
        applyMechanismHonesty(
          {
            from: edge.from,
            to: edge.to,
            label: edge.label,
            mechanism: edge.mechanism,
            mechanismPrior: edge.mechanism,
            reason: act.reason || '源冲击不足',
            n: edge.n,
            nDisplay: edge.nDisplay,
            corr: edge.corr,
            lagTypical: edge.lagTypical,
            pending: true,
            text: `${edge.label} · 待校验 · ${act.reason || '源冲击不足'} (n=${edge.nDisplay})`,
            dataSource: 'live-shock',
          },
          sourceRow,
          targetRow
        )
      );
      continue;
    }

    activeEdges.push(
      applyMechanismHonesty(
        {
          ...edge,
          ...act,
          mechanismPrior: edge.mechanism,
          sourceSurprise: sourceRow.intelCenter?.surprise?.composite ?? null,
          sourceChangePct: sourceRow.changePct ?? null,
          targetPricing:
            targetRow.intelCenter?.pricingState?.stateLabel ||
            targetRow.intelCenter?.pricingState?.state ||
            '待校验',
          lagDistribution: edge.lagDistribution || null,
          elasticity: edge.elasticity || null,
          path: `${edge.label} · lag${edge.lagTypical}d corr=${edge.corr}${
            edge.elasticity?.available ? ` β=${edge.elasticity.beta}` : ''
          } · 激活${(act.activation * 100).toFixed(0)}% (n=${edge.n})`,
        },
        sourceRow,
        targetRow
      )
    );
  }

  activeEdges.sort((a, b) => b.activation - a.activation);
  pendingEdges.sort((a, b) => (b.n || 0) - (a.n || 0));

  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const prior = opts.skipSnapshot ? null : loadShockSnapshot();
  const drifted = applySnapshotDrift(activeEdges, pendingEdges, prior);
  const finalActive = drifted.activeEdges;
  const finalPending = drifted.pendingEdges;
  finalPending.sort((a, b) => (b.n || 0) - (a.n || 0));

  const pendingTop = finalPending.slice(0, 8);
  const activePaths = finalActive.slice(0, 8).map((e) => ({
    text: e.path || e.text,
    mechanism: e.mechanism,
    mechanismPrior: e.mechanismPrior || null,
    mechanismLabel: e.mechanismLabel || null,
    causalLanguageAllowed: e.causalLanguageAllowed !== false,
    activation: e.activation,
    corr: e.corr,
    lag: e.lagTypical,
    n: e.n,
    nDisplay: e.nDisplay,
    pending: false,
  }));
  const pendingPaths = pendingTop.map((e) => ({
    text: e.text,
    mechanism: e.mechanism,
    mechanismPrior: e.mechanismPrior || null,
    mechanismLabel: e.mechanismLabel || null,
    causalLanguageAllowed: e.causalLanguageAllowed !== false,
    activation: 0,
    corr: e.corr,
    n: e.n,
    nDisplay: e.nDisplay,
    pending: true,
    reason: e.reason,
  }));

  const empiricalPassEdges = evaluated.filter((e) => e.available);
  const multiHop = buildMultiHopBoard(empiricalPassEdges, finalActive, instruments, { asOf });
  const multiHopTop = (multiHop.top || []).slice(0, 4).map((p) => ({
    text: p.text,
    mechanism: (p.mechanisms || []).join('+') || 'multihop',
    activation: p.activation || 0,
    corr: p.pathCorr,
    lag: p.pathLag,
    n: p.pathN,
    nDisplay: p.nDisplay,
    pending: p.pending,
    multiHop: true,
    status: p.status,
  }));

  const dynamics = buildShockDynamicsBoard({
    activeEdges: finalActive,
    empiricalEdges: empiricalPassEdges,
    instruments,
    asOf,
    persist: opts.persist !== false && !opts.skipDynamicsPersist,
  });

  const edgeCatalog = buildShockEdgeCatalog(evaluated, loadEdgeVerifyStats(), { topN: 8, sampleN: 10 });

  const honestyDenied = finalActive.filter((e) => e.causalLanguageAllowed === false).length
    + finalPending.filter((e) => e.causalLanguageAllowed === false).length;
  const graph = {
    version: SHOCK_VERSION,
    asOf,
    edgeCount: CANDIDATE_EDGES.length,
    evaluatedCount: evaluated.length,
    empiricalPass: empiricalPassEdges.length,
    skippedInsufficient,
    pendingCount: finalPending.length,
    activeCount: finalActive.length,
    mechanismHonestyDenied: honestyDenied,
    activeEdges: finalActive.slice(0, 12),
    pendingEdges: pendingTop,
    topPaths: [...activePaths, ...multiHopTop, ...pendingPaths].slice(0, 12),
    multiHop,
    dynamics,
    edgeCatalog,
    regime: globalRegime || null,
    snapshotComparedTo: drifted.comparedTo,
    driftCount: drifted.driftNotes.length,
    display: `冲击图 激活 ${finalActive.length} · 待校验 ${finalPending.length} · 实证通过 ${empiricalPassEdges.length}/${CANDIDATE_EDGES.length}${
      honestyDenied ? ` · 因果话术降权 ${honestyDenied}` : ''
    }${
      multiHop?.counts?.total
        ? ` · 多跳${multiHop.counts.live || 0}活/${multiHop.counts.total}链`
        : ''
    }${
      dynamics?.counts?.awaiting != null ? ` · 动力学待验${dynamics.counts.awaiting}` : ''
    }${
      dynamics?.transmissionHit && !dynamics.transmissionHit.deferred
        ? ` · 传导${dynamics.transmissionHit.display}`
        : ''
    }${
      edgeCatalog?.counts?.verifiedReady
        ? ` · 图库验证${edgeCatalog.counts.verifiedReady}`
        : edgeCatalog?.counts?.catalog
          ? ` · 图库${edgeCatalog.counts.catalog}`
          : ''
    }${drifted.comparedTo ? ` · 较${drifted.comparedTo}漂移${drifted.driftNotes.length}` : ''}`,
    dataSource: 'intel-shock-graph',
    method:
      'candidate+lag-dist+beta+activation-fsm+snapshot-drift+multihop+mechanism-honesty+edge-catalog',
    note: skippedInsufficient
      ? `${skippedInsufficient} 边待校验（无假 corr）· ${finalActive.length} 边已激活${
          honestyDenied ? ` · ${honestyDenied} 边禁止成本/替代/套利话术` : ''
        }`
      : honestyDenied
        ? `${honestyDenied} 边仅相关·禁止因果话术`
        : null,
    trueDynamics: true,
  };

  if (opts.persist !== false) {
    try {
      saveShockSnapshot(graph, asOf);
      graph.snapshotSaved = true;
    } catch {
      graph.snapshotSaved = false;
    }
  }

  return graph;
}

function loadShockSnapshot() {
  const dir = getIntelDir();
  if (!dir) return null;
  const fp = path.join(dir, SNAPSHOT_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function saveShockSnapshot(graph, asOf) {
  const dir = getIntelDir();
  if (!dir || !graph) return false;
  const edges = [
    ...(graph.activeEdges || []).map((e) => ({
      from: e.from,
      to: e.to,
      corr: e.corr,
      lag: e.lagTypical ?? e.lag,
      n: e.n,
      activation: e.activation,
      pending: false,
    })),
    ...(graph.pendingEdges || []).map((e) => ({
      from: e.from,
      to: e.to,
      corr: e.corr,
      n: e.n,
      pending: true,
      reason: e.reason,
    })),
  ];
  const payload = {
    version: SHOCK_VERSION,
    asOf: asOf || new Date().toISOString().slice(0, 10),
    savedAt: new Date().toISOString(),
    activeCount: graph.activeCount,
    pendingCount: graph.pendingCount,
    edges,
    method: graph.method,
    dataSource: 'intel-shock-graph',
  };
  fs.writeFileSync(path.join(dir, SNAPSHOT_FILE), JSON.stringify(payload, null, 2), 'utf8');
  return true;
}

/**
 * 相对前日快照：corr 剧变或 n 下滑 → 降 pending（不造假激活）
 */
function applySnapshotDrift(activeEdges, pendingEdges, prior) {
  if (!prior?.edges?.length) {
    return { activeEdges, pendingEdges, driftNotes: [], comparedTo: null };
  }
  const priorMap = new Map(prior.edges.map((e) => [`${e.from}->${e.to}`, e]));
  const stillActive = [];
  const extraPending = [...pendingEdges];
  const driftNotes = [];

  for (const e of activeEdges) {
    const key = `${e.from}->${e.to}`;
    const p = priorMap.get(key);
    if (!p || p.corr == null || e.corr == null) {
      stillActive.push(e);
      continue;
    }
    const corrDrift = Math.abs(e.corr - p.corr);
    const nDrop = p.n != null && e.n != null && e.n < p.n * 0.7;
    if (corrDrift >= 0.25 || nDrop) {
      driftNotes.push({
        edge: key,
        reason: nDrop ? `n下滑 ${p.n}→${e.n}` : `|Δcorr|=${corrDrift.toFixed(2)}`,
      });
      extraPending.push({
        from: e.from,
        to: e.to,
        label: e.label,
        mechanism: e.mechanism,
        reason: `相对${prior.asOf}漂移·${nDrop ? 'n下滑' : 'corr剧变'}`,
        n: e.n,
        nDisplay: e.nDisplay,
        corr: e.corr,
        pending: true,
        text: `${e.label} · 待校验 · 相对${prior.asOf}漂移 (n=${e.nDisplay})`,
        dataSource: 'shock-snapshot-drift',
      });
    } else {
      stillActive.push({ ...e, priorCorr: p.corr, priorN: p.n, priorAsOf: prior.asOf });
    }
  }

  return {
    activeEdges: stillActive,
    pendingEdges: extraPending,
    driftNotes,
    comparedTo: prior.asOf,
  };
}

function pathsFromTo(graph, fromId, toId) {
  return (graph?.activeEdges || [])
    .filter((e) => e.from === fromId && e.to === toId)
    .map((e) => e.path);
}

module.exports = {
  SHOCK_VERSION,
  CANDIDATE_EDGES,
  STATIC_EDGES: CANDIDATE_EDGES,
  loadReturns,
  alignReturnsByDate,
  empiricalEdge,
  bestLagCorr,
  buildShockGraph,
  pathsFromTo,
  activationForLiveEdge,
  loadShockSnapshot,
  saveShockSnapshot,
  applySnapshotDrift,
  computeLagDistribution,
  computeElasticity,
};
