/**
 * 情报中心 · 记忆层可检索回放（构想 §59）
 * 对 claims-archive / revisions / failure-museum 做真实检索与时间线回放。
 * 无命中标「暂无」；禁止编造归档记录。
 */
const {
  MEMORY_VERSION,
  readJsonl,
  loadFailureMuseum,
  loadRecentRevisions,
  getLastClaimSnapshot,
} = require('./intel-memory');

const REPLAY_VERSION = 'v2.89.19-memory-replay';

function norm(s) {
  return String(s || '').toLowerCase();
}

function matchText(hay, needle) {
  if (!needle) return true;
  return norm(hay).includes(norm(needle));
}

/**
 * 跨三类记忆文件检索
 * @param {{ q?: string, instrumentId?: string, claimId?: string, types?: string[], limit?: number }} opts
 */
function searchIntelMemory(opts = {}) {
  const q = (opts.q || '').trim();
  const instrumentId = opts.instrumentId ? norm(opts.instrumentId) : null;
  const claimId = opts.claimId || null;
  const limit = Math.max(1, Math.min(40, opts.limit || 12));
  const want = new Set(
    (opts.types || ['claim_snapshot', 'revision', 'falsified']).map(String)
  );

  const hits = [];

  if (want.has('claim_snapshot') || want.has('archive')) {
    const archives = readJsonl('claims-archive.jsonl', opts.archiveLimit || 1200);
    for (let i = archives.length - 1; i >= 0; i -= 1) {
      const a = archives[i];
      if (!a || a.type !== 'claim_snapshot') continue;
      if (instrumentId && norm(a.instrumentId) !== instrumentId) continue;
      if (claimId && a.claimId !== claimId) continue;
      if (
        q &&
        !matchText(a.statement, q) &&
        !matchText(a.memoHeadline, q) &&
        !matchText(a.stateKey, q) &&
        !matchText(a.claimId, q) &&
        !matchText(a.instrumentId, q)
      ) {
        continue;
      }
      hits.push({
        kind: 'archive',
        kindLabel: '命题存档',
        claimId: a.claimId || null,
        instrumentId: a.instrumentId || null,
        statement: a.statement || a.memoHeadline || '暂无',
        status: a.status || null,
        confidence: a.confidence || null,
        side: a.side || null,
        stateKey: a.stateKey || null,
        nDisplay: a.nDisplay || (a.n != null ? String(a.n) : '暂无'),
        at: a.recordedAt || null,
        dataSource: 'claims-archive',
      });
      if (hits.length >= limit * 2) break;
    }
  }

  if (want.has('revision') || want.has('revisions')) {
    const revs = loadRecentRevisions(opts.revisionLimit || 200);
    for (const r of revs) {
      if (!r) continue;
      if (instrumentId && norm(r.instrumentId) !== instrumentId) continue;
      if (claimId && r.claimId !== claimId) continue;
      const blob = `${r.reason || ''} ${r.to?.statement || ''} ${r.from?.statement || ''}`;
      if (q && !matchText(blob, q) && !matchText(r.claimId, q) && !matchText(r.instrumentId, q)) {
        continue;
      }
      hits.push({
        kind: 'revision',
        kindLabel: '改口履历',
        claimId: r.claimId || null,
        instrumentId: r.instrumentId || null,
        statement: r.to?.statement || r.reason || '暂无',
        status: r.to?.status || null,
        revisionType: r.revisionType || null,
        reason: r.reason || null,
        from: r.from || null,
        to: r.to || null,
        nDisplay: '暂无',
        at: r.recordedAt || null,
        dataSource: 'revisions',
      });
      if (hits.length >= limit * 3) break;
    }
  }

  if (want.has('falsified') || want.has('museum')) {
    const museum = loadFailureMuseum(opts.museumLimit || 120);
    for (const m of museum) {
      if (!m) continue;
      if (instrumentId && norm(m.instrumentId) !== instrumentId) continue;
      if (claimId && m.claimId !== claimId) continue;
      if (
        q &&
        !matchText(m.statement, q) &&
        !matchText(m.trigger, q) &&
        !matchText(m.claimId, q) &&
        !matchText(m.instrumentId, q)
      ) {
        continue;
      }
      hits.push({
        kind: 'museum',
        kindLabel: '失效博物馆',
        claimId: m.claimId || null,
        instrumentId: m.instrumentId || null,
        instrumentName: m.instrumentName || null,
        statement: m.statement || '暂无',
        trigger: m.trigger || null,
        status: 'falsified',
        nDisplay: '暂无',
        at: m.falsifiedAt || m.recordedAt || null,
        dataSource: 'failure-museum',
      });
      if (hits.length >= limit * 3) break;
    }
  }

  hits.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const sliced = hits.slice(0, limit);

  return {
    version: REPLAY_VERSION,
    memoryVersion: MEMORY_VERSION,
    q: q || null,
    instrumentId: opts.instrumentId || null,
    claimId: claimId || null,
    n: sliced.length,
    nDisplay: sliced.length ? String(sliced.length) : '暂无',
    available: sliced.length > 0,
    hits: sliced,
    display: sliced.length
      ? `记忆检索 ${sliced.length} 条${q ? ` · 「${q.slice(0, 24)}」` : ''}`
      : q
        ? `记忆检索 · 暂无命中「${q.slice(0, 24)}」`
        : '记忆检索 · 暂无（未查询或库空）',
    note: '只读真实 JSONL；无命中不编造',
    dataSource: 'intel-memory-replay',
    method: 'search-archive+revision+museum',
  };
}

/**
 * 单命题时间线回放：存档 → 改口 → 证伪
 */
function replayClaimTimeline(claimId, opts = {}) {
  if (!claimId) {
    return {
      version: REPLAY_VERSION,
      available: false,
      claimId: null,
      events: [],
      n: 0,
      nDisplay: '暂无',
      display: '回放 · 暂无 claimId',
      dataSource: 'intel-memory-replay',
    };
  }

  const events = [];
  const archives = readJsonl('claims-archive.jsonl', opts.archiveLimit || 2000);
  for (const a of archives) {
    if (!a || a.claimId !== claimId) continue;
    events.push({
      kind: 'archive',
      kindLabel: '存档',
      at: a.recordedAt || null,
      status: a.status || null,
      confidence: a.confidence || null,
      side: a.side || null,
      statement: a.statement || null,
      nDisplay: a.nDisplay || (a.n != null ? String(a.n) : '暂无'),
      dataSource: 'claims-archive',
    });
  }

  for (const r of loadRecentRevisions(opts.revisionLimit || 400)) {
    if (!r || r.claimId !== claimId) continue;
    events.push({
      kind: 'revision',
      kindLabel: '改口',
      at: r.recordedAt || null,
      revisionType: r.revisionType || null,
      reason: r.reason || null,
      from: r.from || null,
      to: r.to || null,
      statement: r.to?.statement || null,
      nDisplay: '暂无',
      dataSource: 'revisions',
    });
  }

  for (const m of loadFailureMuseum(opts.museumLimit || 200)) {
    if (!m || m.claimId !== claimId) continue;
    events.push({
      kind: 'museum',
      kindLabel: '证伪',
      at: m.falsifiedAt || m.recordedAt || null,
      trigger: m.trigger || null,
      statement: m.statement || null,
      nDisplay: '暂无',
      dataSource: 'failure-museum',
    });
  }

  events.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const latest = getLastClaimSnapshot(claimId);

  return {
    version: REPLAY_VERSION,
    available: events.length > 0,
    claimId,
    instrumentId: latest?.instrumentId || events[0]?.instrumentId || null,
    latest: latest
      ? {
          statement: latest.statement,
          status: latest.status,
          confidence: latest.confidence,
          nDisplay: latest.nDisplay || (latest.n != null ? String(latest.n) : '暂无'),
          recordedAt: latest.recordedAt || null,
        }
      : null,
    events: events.slice(-40),
    n: events.length,
    nDisplay: events.length ? String(events.length) : '暂无',
    display: events.length
      ? `回放 ${claimId.slice(0, 28)} · ${events.length} 事件`
      : `回放 · 暂无事件 ${claimId.slice(0, 28)}`,
    note: '时间线仅含磁盘真实记录',
    dataSource: 'intel-memory-replay',
    method: 'claim-timeline-merge',
  };
}

/**
 * Pack 级记忆回放板：最近改口/证伪 + 可检索入口元数据
 */
function buildMemoryReplayBoard(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const recentRevs = loadRecentRevisions(30).slice(0, 8);
  const recentMuseum = loadFailureMuseum(30).slice(0, 6);

  const sampleIds = (instruments || [])
    .map((i) => i.intelCenter?.primaryClaim?.claimId)
    .filter(Boolean)
    .slice(0, 5);

  const sampleTimelines = sampleIds
    .map((id) => {
      const tl = replayClaimTimeline(id, { archiveLimit: 400, revisionLimit: 100, museumLimit: 80 });
      return tl.available
        ? {
            claimId: id,
            instrumentId: tl.instrumentId,
            n: tl.n,
            nDisplay: tl.nDisplay,
            display: tl.display,
            latestStatus: tl.latest?.status || null,
          }
        : null;
    })
    .filter(Boolean);

  // 默认空查询探测库规模
  const probe = searchIntelMemory({ limit: 5, types: ['claim_snapshot', 'revision', 'falsified'] });

  return {
    version: REPLAY_VERSION,
    asOf,
    available: true,
    libraryN: probe.n,
    libraryNDisplay: probe.nDisplay,
    recentRevisions: recentRevs.map((r) => ({
      claimId: r.claimId,
      instrumentId: r.instrumentId,
      revisionType: r.revisionType,
      reason: r.reason,
      at: r.recordedAt,
      statement: r.to?.statement || null,
    })),
    recentMuseum: recentMuseum.map((m) => ({
      claimId: m.claimId,
      instrumentId: m.instrumentId,
      instrumentName: m.instrumentName,
      trigger: m.trigger,
      statement: m.statement,
      at: m.falsifiedAt || m.recordedAt,
    })),
    sampleTimelines,
    searchHint: '按品种/claimId/关键词检索存档·改口·博物馆',
    display:
      probe.n > 0
        ? `记忆回放 · 近库 ${probe.nDisplay} · 改口 ${recentRevs.length} · 博物馆 ${recentMuseum.length} · 样例线 ${sampleTimelines.length}`
        : '记忆回放 · 库暂无（无存档不编造）',
    note: '可检索、可对比、可回放；工程 PASS ≠ 预测准确',
    dataSource: 'intel-memory-replay',
    method: 'board+search+timeline',
  };
}

module.exports = {
  REPLAY_VERSION,
  searchIntelMemory,
  replayClaimTimeline,
  buildMemoryReplayBoard,
};
