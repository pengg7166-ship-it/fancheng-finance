/**
 * 情报中心 · 议题板（构想 §76）
 * 稳定 issueId 跨日聚合：open / falsifying / falsified / superseded；禁止虚构议题。
 */
const { readJsonl } = require('./intel-memory');

const ISSUE_BOARD_VERSION = 'v2.69.0-issue-tree';

/** 稳定议题键：品种+尺度（不含日） */
function makeStableIssueId(instrumentId, horizon) {
  return `issue-${String(instrumentId || '').toLowerCase()}-${horizon || 'structural'}`;
}

/** 日快照键（归档用） */
function makeIssueSnapshotId(instrumentId, horizon, asOf) {
  const day = String(asOf || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  return `${makeStableIssueId(instrumentId, horizon)}-${day}`;
}

/**
 * 归一：旧版 issue-{id}-{horizon}-{YYYYMMDD} → 稳定 issue-{id}-{horizon}
 */
function normalizeIssueId(issueId, claimId) {
  if (issueId) {
    const s = String(issueId);
    const m = s.match(/^(issue-[a-z0-9]+-(?:tactical|structural|paradigm))(?:-\d{8})?$/i);
    if (m) return m[1].toLowerCase();
    if (s.startsWith('issue-')) return s.replace(/-\d{8}$/, '');
    return s;
  }
  if (claimId && String(claimId).startsWith('claim-')) {
    return String(claimId).replace(/^claim-/, 'issue-');
  }
  return null;
}

function deriveStatus(rows) {
  const latest = rows[rows.length - 1];
  const statuses = rows.map((r) => r.status).filter(Boolean);
  if (statuses.includes('falsified') || latest?.status === 'falsified') return 'falsified';
  if (statuses.includes('falsifying') || latest?.status === 'falsifying') return 'falsifying';
  if (statuses.includes('expired') || latest?.status === 'expired') return 'expired';
  if (latest?.status === 'active' || latest?.status === 'watch') return 'open';
  return latest?.status || 'open';
}

function buildIssueFromRows(issueId, rows) {
  const sorted = [...rows].sort((a, b) =>
    String(a.recordedAt || '').localeCompare(String(b.recordedAt || ''))
  );
  const latest = sorted[sorted.length - 1];
  const first = sorted[0];
  const sides = new Set(sorted.map((r) => r.side).filter(Boolean));
  const revisions = sorted.filter(
    (r) => r.type === 'revision' || (r.side && sides.size > 1)
  ).length;

  return {
    issueId,
    instrumentId: latest.instrumentId || first.instrumentId,
    instrumentName: latest.instrumentName || latest.instrumentId,
    horizon: latest.horizon || (issueId.match(/-(tactical|structural|paradigm)$/) || [])[1] || null,
    status: deriveStatus(sorted),
    side: latest.side || null,
    statement: latest.statement || latest.memoHeadline || null,
    confidence: latest.confidence || null,
    n: latest.n ?? null,
    nDisplay: latest.n != null ? String(latest.n) : latest.nDisplay || '暂无',
    snapshotCount: sorted.filter((r) => r.type === 'claim_snapshot' || r.claimId).length || sorted.length,
    firstSeen: first.recordedAt || null,
    lastSeen: latest.recordedAt || null,
    claimId: latest.claimId || null,
    playbookId: latest.playbookId || null,
    parentIssueId: latest.parentIssueId || null,
    childIssueIds: latest.childIssueIds || null,
    flipped: sides.size > 1,
    revisionHints: revisions,
  };
}

/**
 * 从 archive + revisions + museum + 当前 instruments 聚合议题板
 */
function buildIssueBoard(instruments = [], { limit = 40 } = {}) {
  const byIssue = new Map();

  const push = (rec) => {
    const issueId = normalizeIssueId(rec.issueId, rec.claimId);
    if (!issueId) return;
    if (!byIssue.has(issueId)) byIssue.set(issueId, []);
    byIssue.get(issueId).push(rec);
  };

  for (const a of readJsonl('claims-archive.jsonl', 1200)) push(a);
  for (const r of readJsonl('revisions.jsonl', 600)) {
    push({
      ...r,
      statement: r.to?.statement || r.from?.statement,
      status: r.to?.status || r.revisionType,
      side: r.to?.side || r.from?.side,
      confidence: r.to?.confidence,
      type: 'revision',
    });
  }
  for (const m of readJsonl('failure-museum.jsonl', 400)) {
    push({
      ...m,
      status: 'falsified',
      type: 'museum',
      statement: m.statement || m.trigger,
    });
  }

  // 当前存活命题
  for (const inst of instruments || []) {
    const claim = inst.intelCenter?.primaryClaim;
    if (!claim?.claimId) continue;
    const issueId =
      claim.issueIdStable ||
      normalizeIssueId(claim.issueId, claim.claimId) ||
      makeStableIssueId(inst.id, claim.horizon || 'structural');
    push({
      issueId,
      claimId: claim.claimId,
      instrumentId: inst.id,
      instrumentName: inst.name,
      horizon: claim.horizon,
      status: claim.status,
      side: claim.side,
      statement: claim.statement,
      confidence: claim.confidence,
      n: claim.n,
      nDisplay: claim.nDisplay,
      playbookId: claim.playbookId || inst.intelCenter?.playbook?.activeId,
      parentIssueId: claim.parentIssueId || null,
      childIssueIds: claim.childIssueIds || null,
      recordedAt: new Date().toISOString(),
      type: 'live',
    });
  }

  const issues = [];
  for (const [issueId, rows] of byIssue.entries()) {
    issues.push(buildIssueFromRows(issueId, rows));
  }

  const statusRank = { falsifying: 0, open: 1, falsified: 2, expired: 3 };
  issues.sort((a, b) => {
    const ra = statusRank[a.status] ?? 9;
    const rb = statusRank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''));
  });

  const open = issues.filter((i) => i.status === 'open' || i.status === 'watch');
  const falsifying = issues.filter((i) => i.status === 'falsifying');
  const falsified = issues.filter((i) => i.status === 'falsified');
  const flipped = issues.filter((i) => i.flipped);

  const top = issues.slice(0, limit);

  return {
    version: ISSUE_BOARD_VERSION,
    available: issues.length > 0,
    total: issues.length,
    openCount: open.length,
    falsifyingCount: falsifying.length,
    falsifiedCount: falsified.length,
    flippedCount: flipped.length,
    issues: top,
    falsifying: falsifying.slice(0, 10),
    open: open.slice(0, 12),
    recentFalsified: falsified.slice(0, 8),
    display: issues.length
      ? `议题 ${issues.length} · 开放 ${open.length} · 证伪中 ${falsifying.length} · 已证伪 ${falsified.length}`
      : '议题板·暂无归档',
    dataSource: 'intel-issue-board',
    method: 'archive+revisions+museum+live-normalize',
  };
}

function attachIssueIdsToClaim(claim, inst, asOf) {
  if (!claim) return claim;
  const horizon = claim.horizon || 'structural';
  const stable = makeStableIssueId(inst?.id || claim.instrumentId, horizon);
  return {
    ...claim,
    issueId: stable,
    issueIdStable: stable,
    issueSnapshotId: makeIssueSnapshotId(inst?.id || claim.instrumentId, horizon, asOf),
  };
}

module.exports = {
  ISSUE_BOARD_VERSION,
  makeStableIssueId,
  makeIssueSnapshotId,
  normalizeIssueId,
  buildIssueBoard,
  attachIssueIdsToClaim,
};
