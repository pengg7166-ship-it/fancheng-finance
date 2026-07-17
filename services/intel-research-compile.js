/**
 * 情报中心 · 研究编译发行产品化（构想 §76）
 * 每次 pack 是一次「发行」：releaseId + 快照落盘 + 可回滚对照。
 * 产品主路径 = 今日相对昨日（或指定上版）的物质 diff，不只是模块版本号变更。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appendJsonl, readJsonl, getIntelDir } = require('./intel-memory');

const COMPILE_VERSION = 'v2.89.16-release-product';

function safeVer(modPath, exportName) {
  try {
    const m = require(modPath);
    const v = exportName ? m[exportName] : m.VERSION || m.version;
    return v || null;
  } catch {
    return null;
  }
}

function collectModelVersions(extra = {}) {
  return {
    orchestrator: extra.orchestrator || null,
    claim: safeVer('./intel-claim-library', 'CLAIM_VERSION'),
    choice: safeVer('./intel-choice-set', 'CHOICE_VERSION'),
    unknown: safeVer('./intel-unknown-map', 'UNKNOWN_VERSION'),
    narrative: safeVer('./intel-narrative-epidemiology', 'NARRATIVE_VERSION'),
    evidenceFresh: safeVer('./intel-evidence-freshness', 'EVIDENCE_FRESH_VERSION'),
    evidenceTriad: safeVer('./intel-evidence-triad', 'TRIAD_VERSION'),
    memoryReplay: safeVer('./intel-memory-replay', 'REPLAY_VERSION'),
    horizon: safeVer('./intel-horizon-coordination', 'HORIZON_VERSION'),
    multihop: safeVer('./intel-shock-multihop', 'MULTIHOP_VERSION'),
    shockDynamics: safeVer('./intel-shock-dynamics', 'DYNAMICS_VERSION'),
    isomorphic: safeVer('./intel-isomorphic-board', 'ISO_BOARD_VERSION'),
    calendar: safeVer('./intel-intelligence-calendar', 'INTEL_CAL_VERSION'),
    dual: safeVer('./intel-dual-board', 'DUAL_BOARD_VERSION'),
    museum: safeVer('./intel-failure-museum-board', 'MUSEUM_BOARD_VERSION'),
    interrupt: safeVer('./intel-interrupt-channel', 'CHANNEL_VERSION'),
    shift: safeVer('./intel-shift-schedule', 'SHIFT_VERSION'),
    faceCompute: safeVer('./intel-face-compute-ledger', 'FACE_COMPUTE_VERSION'),
    evidenceAudit: safeVer('./intel-evidence-audit', 'EVIDENCE_AUDIT_VERSION'),
    redTeamLoop: safeVer('./intel-red-team-loop', 'RED_LOOP_VERSION'),
    redTeam: safeVer('./intel-red-team', 'RED_TEAM_VERSION'),
    dailyDiff: safeVer('./intel-daily-diff', 'DIFF_VERSION'),
    quietBrake: safeVer('./intel-quiet-brake-board', 'QUIET_BRAKE_VERSION'),
    memoExport: safeVer('./intel-memo-export', 'MEMO_EXPORT_VERSION'),
    analystJournal: safeVer('./intel-analyst-journal-board', 'JOURNAL_VERSION'),
    mechanism: safeVer('./intel-mechanism-board', 'MECHANISM_BOARD_VERSION'),
    mechanismHonesty: safeVer('./intel-mechanism-honesty', 'MECHANISM_HONESTY_VERSION'),
    staffFace: safeVer('./intel-staff-face', 'STAFF_FACE_VERSION'),
    pageTone: safeVer('./intel-page-tone', 'PAGE_TONE_VERSION'),
    pricingClock: safeVer('./intel-pricing-clock-board', 'PRICING_CLOCK_BOARD_VERSION'),
    pricing: safeVer('./intel-pricing-state', 'PRICING_VERSION'),
    falsifyClock: safeVer('./intel-falsification-clock', 'CLOCK_VERSION'),
    scenario: safeVer('./intel-scenario-lattice', 'SCENARIO_VERSION'),
    surprise: safeVer('./intel-surprise', 'SURPRISE_VERSION'),
    kpi: safeVer('./intel-kpi', 'KPI_VERSION'),
    pushTier: safeVer('./intel-push-tier', 'PUSH_VERSION'),
    gates: safeVer('./intel-publish-gates', 'GATE_VERSION'),
    attention: safeVer('./intel-attention-budget', 'ATTENTION_VERSION'),
    face: safeVer('./intel-face-contracts', 'FACE_CONTRACT_VERSION'),
    playbook: safeVer('./intel-playbook-switcher', 'PLAYBOOK_SWITCH_VERSION'),
    process: safeVer('./intel-process-learning', 'PROCESS_VERSION'),
    issue: safeVer('./intel-issue-board', 'ISSUE_BOARD_VERSION'),
    antiManip: safeVer('./intel-anti-manipulation', 'ANTI_MANIP_VERSION'),
    compile: COMPILE_VERSION,
    kernel: extra.kernel || null,
    weights: extra.weights || null,
    data: extra.data || null,
  };
}

function digestVersions(versions) {
  const keys = Object.keys(versions || {})
    .sort()
    .map((k) => `${k}=${versions[k] ?? '暂无'}`)
    .join('|');
  return crypto.createHash('sha256').update(keys).digest('hex').slice(0, 10);
}

function buildReleaseId(asOf, scope, versions) {
  const day = String(asOf || new Date().toISOString().slice(0, 10));
  const d = digestVersions(versions);
  const sc = String(scope || 'pack')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24);
  return `rel-${day}-${sc}-${d}`;
}

function inputDigest(instruments) {
  const ids = (instruments || [])
    .map((i) => i.id)
    .filter(Boolean)
    .sort()
    .join(',');
  if (!ids) return null;
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 12);
}

function releasesDir() {
  const dir = getIntelDir();
  if (!dir) return null;
  const r = path.join(dir, 'releases');
  fs.mkdirSync(r, { recursive: true });
  return r;
}

function releasePath(releaseId) {
  const dir = releasesDir();
  if (!dir || !releaseId) return null;
  const safe = String(releaseId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return path.join(dir, `${safe}.json`);
}

function slimDailyDiff(diff) {
  if (!diff) return null;
  const changes = diff.changes || {};
  const buckets = Object.keys(changes).map((k) => ({
    key: k,
    n: Array.isArray(changes[k]) ? changes[k].length : 0,
  }));
  const topLines = [];
  for (const [k, arr] of Object.entries(changes)) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr.slice(0, 3)) {
      topLines.push({
        bucket: k,
        text: item.text || item.question || item.display || `${k}`,
        instrumentId: item.instrumentId || null,
      });
      if (topLines.length >= 10) break;
    }
    if (topLines.length >= 10) break;
  }
  return {
    available: diff.available !== false,
    summary: diff.summary || null,
    materialChanges: diff.materialChanges ?? null,
    quietDay: Boolean(diff.quietDay),
    quietReason: diff.quietReason || null,
    prevDate: diff.prevDate || null,
    buckets,
    topLines,
    display: diff.summary || diff.display || null,
  };
}

function slimPackBoards(pack) {
  if (!pack) return {};
  const pick = (b) => (b?.display ? { display: b.display, counts: b.counts || null } : null);
  return {
    playbook: pick(pack.playbookBoard),
    scenario: pick(pack.scenarioLatticeBoard),
    pageTone: pick(pack.pageToneBoard),
    faceContract: pick(pack.faceContractBoard),
    claimSharp: pick(pack.claimSharpnessBoard),
    museum: pick(pack.museumBoard),
    debt: pick(pack.debtBoard),
    interrupt: pack.interruptChannel
      ? {
          display: pack.interruptChannel.display || null,
          pendingCount: pack.interruptChannel.pendingCount ?? null,
        }
      : null,
  };
}

function buildReleaseSnapshot(pack, instruments, meta) {
  return {
    version: COMPILE_VERSION,
    type: 'research_release_snapshot',
    releaseId: meta.releaseId,
    asOf: meta.asOf,
    savedAt: new Date().toISOString(),
    modelVersions: meta.modelVersions,
    inputDigest: meta.inputDigest,
    inputDigestDisplay: meta.inputDigest || '暂无',
    stats: pack?.stats
      ? {
          instrumentCount: pack.stats.instrumentCount,
          p0: pack.stats.p0,
          falsifying: pack.stats.falsifying,
          falsified: pack.stats.falsified,
          mispriced: pack.stats.mispriced,
          materialChanges: pack.stats.materialChanges,
          staffCommand: pack.stats.staffCommand,
          staffBrief: pack.stats.staffBrief,
          staffObserve: pack.stats.staffObserve,
        }
      : null,
    dailyDiff: slimDailyDiff(pack?.dailyDiff),
    boards: slimPackBoards(pack),
    shiftId: pack?.shift?.id || pack?.shiftContract?.id || null,
    orchestrator: meta.modelVersions?.orchestrator || null,
    method: 'release-snapshot+product-diff',
    dataSource: 'intel-research-compile',
  };
}

function saveReleaseSnapshot(snapshot) {
  const fp = releasePath(snapshot?.releaseId);
  if (!fp || !snapshot) return false;
  fs.writeFileSync(fp, JSON.stringify(snapshot, null, 2), 'utf8');
  return true;
}

function loadRelease(releaseId) {
  const fp = releasePath(releaseId);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function listReleases(limit = 12) {
  const dir = releasesDir();
  if (!dir) return [];
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const fp = path.join(dir, f);
        const st = fs.statSync(fp);
        return { fp, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
    return files
      .map(({ fp }) => {
        try {
          const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
          return {
            releaseId: j.releaseId,
            asOf: j.asOf,
            display: j.dailyDiff?.display || j.releaseId,
            materialChanges: j.dailyDiff?.materialChanges ?? null,
            orchestrator: j.orchestrator || j.modelVersions?.orchestrator || null,
            savedAt: j.savedAt || null,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function diffModelVersions(curr, prev) {
  if (!prev || typeof prev !== 'object') {
    return { available: false, changed: [], changedCount: 0, note: '暂无上一版可对比', display: '暂无上一版模块对照' };
  }
  const changed = [];
  const keys = new Set([...Object.keys(curr || {}), ...Object.keys(prev || {})]);
  for (const k of keys) {
    const a = curr?.[k] ?? null;
    const b = prev?.[k] ?? null;
    if (String(a) !== String(b)) {
      changed.push({ key: k, from: b || '暂无', to: a || '暂无' });
    }
  }
  return {
    available: true,
    changed,
    changedCount: changed.length,
    display: changed.length
      ? `模块变更 ${changed.length}：${changed
          .slice(0, 4)
          .map((c) => c.key)
          .join('、')}`
      : '模块版本无变更',
  };
}

/**
 * 产品主路径 diff：物质变更优先，模块版本次之
 */
function buildProductPathDiff(currSnap, prevSnap) {
  if (!prevSnap) {
    return {
      available: false,
      comparedTo: null,
      headline: '发行对照 · 暂无上版快照（不可回滚对照）',
      mustRead: ['首次发行或上版未落盘 · 物质 diff 待有快照后生效'],
      materialN: null,
      versionDeltaN: null,
      topLines: [],
      boardDeltas: [],
      note: '禁止无快照假装昨日对照',
      dataSource: 'intel-research-compile',
    };
  }

  const currDiff = currSnap.dailyDiff || {};
  const prevDiff = prevSnap.dailyDiff || {};
  const materialN = currDiff.materialChanges;
  const topLines = (currDiff.topLines || []).slice(0, 8);
  const mustRead = [];

  if (currDiff.summary) mustRead.push(`今日变了：${String(currDiff.summary).slice(0, 64)}`);
  else if (materialN != null) mustRead.push(`物质变更 ${materialN}`);
  else mustRead.push('物质变更 暂无（日差不可判定或静默）');

  if (currDiff.quietDay) {
    mustRead.push(`静默日 · ${currDiff.quietReason || '无物质变更'}`);
  }

  const boardDeltas = [];
  const currBoards = currSnap.boards || {};
  const prevBoards = prevSnap.boards || {};
  for (const key of new Set([...Object.keys(currBoards), ...Object.keys(prevBoards)])) {
    const a = currBoards[key]?.display || null;
    const b = prevBoards[key]?.display || null;
    if (a !== b && (a || b)) {
      boardDeltas.push({ key, from: b || '暂无', to: a || '暂无' });
    }
  }
  if (boardDeltas.length) {
    mustRead.push(
      `板面 Δ ${boardDeltas.length}：${boardDeltas
        .slice(0, 3)
        .map((d) => d.key)
        .join('、')}`
    );
  }

  const verDiff = diffModelVersions(currSnap.modelVersions, prevSnap.modelVersions);
  if (verDiff.available && verDiff.changedCount) {
    mustRead.push(verDiff.display);
  }

  const statsDelta = [];
  const cs = currSnap.stats || {};
  const ps = prevSnap.stats || {};
  for (const k of ['p0', 'falsifying', 'falsified', 'mispriced']) {
    if (cs[k] != null && ps[k] != null && cs[k] !== ps[k]) {
      statsDelta.push({ key: k, from: ps[k], to: cs[k] });
    }
  }

  return {
    available: true,
    comparedTo: prevSnap.releaseId,
    comparedAsOf: prevSnap.asOf || null,
    headline: `发行对照 ${currSnap.releaseId} ← ${prevSnap.releaseId}${
      materialN != null ? ` · 物质 ${materialN}` : ''
    }${verDiff.changedCount ? ` · 模块Δ${verDiff.changedCount}` : ''}`,
    mustRead,
    materialN: materialN ?? null,
    versionDeltaN: verDiff.changedCount ?? 0,
    topLines,
    boardDeltas: boardDeltas.slice(0, 8),
    statsDelta,
    quietDay: Boolean(currDiff.quietDay),
    note: '产品主路径=物质 what-changed；模块版本为辅',
    dataSource: 'intel-research-compile',
    method: 'dailyDiff+board+version↔release-snapshot',
  };
}

function loadRecentCompiles(limit = 8) {
  try {
    const fromFiles = listReleases(limit);
    if (fromFiles.length) return fromFiles;
    const rows = readJsonl('compile-log.jsonl', Math.max(20, limit * 3))
      .filter((r) => r?.type === 'research_compile' && r.releaseId)
      .reverse()
      .slice(0, limit);
    return rows.map((r) => ({
      releaseId: r.releaseId,
      asOf: r.asOf,
      display: r.display,
      orchestrator: r.modelVersions?.orchestrator || null,
      materialChanges: r.dailyDiff?.materialChanges ?? null,
      inputDigestDisplay: r.inputDigestDisplay || r.inputDigest || '暂无',
      persistedAt: r.ts || r.savedAt || null,
    }));
  } catch {
    return [];
  }
}

function loadPreviousCompile(currentReleaseId) {
  const recent = loadRecentCompiles(16);
  const idx = recent.findIndex((r) => r.releaseId === currentReleaseId);
  if (idx >= 0 && recent[idx + 1]) return recent[idx + 1];
  if (idx < 0 && recent[0] && recent[0].releaseId !== currentReleaseId) return recent[0];
  if (idx < 0 && recent[1]) return recent[1];
  return null;
}

/**
 * 对照指定历史发行（回滚阅读，不改当前生效权）
 */
function compareToRelease(packOrSnapshot, targetReleaseId) {
  const curr =
    packOrSnapshot?.releaseId && packOrSnapshot?.dailyDiff
      ? packOrSnapshot
      : packOrSnapshot?.researchCompile?.snapshot || packOrSnapshot;
  const prev = loadRelease(targetReleaseId);
  if (!prev) {
    return {
      available: false,
      reason: 'release_not_found',
      targetReleaseId,
      display: `对照失败 · 发行 ${targetReleaseId || '—'} 暂无快照`,
      dataSource: 'intel-research-compile',
    };
  }
  const productPath = buildProductPathDiff(curr, prev);
  const vsPrev = diffModelVersions(curr.modelVersions, prev.modelVersions);
  return {
    available: true,
    targetReleaseId,
    productPath,
    vsPrev,
    display: productPath.headline,
    rollbackReadOnly: true,
    note: '只读对照，不回写权重/命题',
    dataSource: 'intel-research-compile',
  };
}

function buildReleaseProductBoard(compile) {
  const pp = compile?.productPath;
  const recent = compile?.recent || [];
  return {
    version: COMPILE_VERSION,
    releaseId: compile?.releaseId || null,
    previousReleaseId: compile?.previousReleaseId || null,
    productPath: pp || null,
    vsPrev: compile?.vsPrev || null,
    recent: recent.slice(0, 8),
    rollbackCandidates: recent.filter((r) => r.releaseId !== compile?.releaseId).slice(0, 6),
    display: pp?.headline || compile?.display || '发行板 暂无',
    note: '今日相对上版 = 产品主路径；选历史 releaseId 可只读对照',
    dataSource: 'intel-research-compile',
    method: 'release-product-board',
  };
}

/**
 * 编译一次研究发布（含快照 + 产品 diff + 近期史）
 */
function compileResearchRelease(pack, instruments, ctx = {}) {
  const asOf = ctx.asOf || pack?.asOf || new Date().toISOString().slice(0, 10);
  const modelVersions = collectModelVersions({
    orchestrator: ctx.orchestratorVersion || pack?.version || null,
    kernel: ctx.kernel || null,
    weights: ctx.weights || null,
    data: ctx.data || pack?.dataSource || null,
  });
  const releaseId = buildReleaseId(asOf, ctx.scope || 'intel-pack', modelVersions);
  const inDigest = inputDigest(instruments);

  const previousMeta = loadPreviousCompile(releaseId);
  let previousSnap = previousMeta?.releaseId ? loadRelease(previousMeta.releaseId) : null;
  if (!previousSnap && previousMeta?.releaseId) {
    // 旧日志无快照时，仅能做模块 diff
    previousSnap = {
      releaseId: previousMeta.releaseId,
      asOf: previousMeta.asOf,
      modelVersions: null,
      dailyDiff: null,
      boards: {},
      stats: null,
    };
    try {
      const rows = readJsonl('compile-log.jsonl', 40).filter((r) => r.releaseId === previousMeta.releaseId);
      previousSnap.modelVersions = rows[rows.length - 1]?.modelVersions || null;
    } catch {
      // ignore
    }
  }

  const snapshot = buildReleaseSnapshot(pack, instruments, {
    releaseId,
    asOf,
    modelVersions,
    inputDigest: inDigest,
  });

  const vsPrev = diffModelVersions(modelVersions, previousSnap?.modelVersions);
  const productPath = buildProductPathDiff(snapshot, previousSnap?.releaseId ? previousSnap : null);

  const versionLines = Object.entries(modelVersions)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ({ key: k, version: v }));

  const release = {
    version: COMPILE_VERSION,
    releaseId,
    asOf,
    modelVersions,
    versionLines: versionLines.slice(0, 18),
    inputDigest: inDigest,
    inputDigestDisplay: inDigest || '暂无',
    previousReleaseId: previousMeta?.releaseId || previousSnap?.releaseId || null,
    vsPrev,
    productPath,
    snapshot: {
      releaseId: snapshot.releaseId,
      asOf: snapshot.asOf,
      dailyDiff: snapshot.dailyDiff,
      boards: snapshot.boards,
      stats: snapshot.stats,
      modelVersions: snapshot.modelVersions,
    },
    recent: loadRecentCompiles(8),
    stats: snapshot.stats,
    shiftId: snapshot.shiftId,
    method: 'release-snapshot+product-path+version-diff',
    dataSource: 'intel-research-compile',
    display: productPath.available
      ? `发行 ${releaseId} · ${productPath.materialN != null ? `物质${productPath.materialN}` : '物质暂无'}${
          vsPrev.changedCount ? ` · 模块Δ${vsPrev.changedCount}` : ''
        }`
      : `发行 ${releaseId} · orch ${modelVersions.orchestrator || '暂无'} · 上版暂无`,
  };

  release.productBoard = buildReleaseProductBoard(release);

  if (ctx.compareReleaseId && ctx.compareReleaseId !== releaseId) {
    release.compare = compareToRelease(snapshot, ctx.compareReleaseId);
  }

  if (ctx.persist !== false) {
    try {
      const saved = saveReleaseSnapshot(snapshot);
      release.snapshotSaved = saved;
      appendJsonl('compile-log.jsonl', {
        type: 'research_compile',
        ts: new Date().toISOString(),
        releaseId,
        asOf,
        display: release.display,
        modelVersions,
        inputDigest: inDigest,
        inputDigestDisplay: release.inputDigestDisplay,
        previousReleaseId: release.previousReleaseId,
        productPathHeadline: productPath.headline,
        materialChanges: productPath.materialN,
        dailyDiff: snapshot.dailyDiff,
      });
      release.persisted = true;
    } catch (err) {
      release.persisted = false;
      release.snapshotSaved = false;
      release.persistError = err.message;
    }
  }

  return release;
}

function compileInstrumentRelease(inst, intelCenter, asOf) {
  const versions = collectModelVersions({
    orchestrator: intelCenter?.version || null,
    kernel: intelCenter?.modelVersions?.kernel || inst?.intelligenceKernel?.version || null,
    weights: intelCenter?.modelVersions?.weights || null,
    data: intelCenter?.modelVersions?.data || inst?.dataVersion || null,
  });
  return {
    releaseId: buildReleaseId(asOf, inst?.id || 'inst', versions),
    modelVersions: versions,
    version: COMPILE_VERSION,
  };
}

module.exports = {
  COMPILE_VERSION,
  collectModelVersions,
  buildReleaseId,
  compileResearchRelease,
  compileInstrumentRelease,
  digestVersions,
  diffModelVersions,
  loadRecentCompiles,
  loadRelease,
  listReleases,
  saveReleaseSnapshot,
  compareToRelease,
  buildProductPathDiff,
  buildReleaseProductBoard,
  buildReleaseSnapshot,
};
