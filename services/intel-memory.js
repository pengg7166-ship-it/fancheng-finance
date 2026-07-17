/**
 * 情报中心 · 记忆层（命题存档 / 改口履历 / 失效博物馆）
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const MEMORY_VERSION = 'v2.57.0-intel-center';
const INTEL_DIR = 'intel-center';

function getIntelDir() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const dir = path.join(dataDir, INTEL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendJsonl(filename, record) {
  const dir = getIntelDir();
  if (!dir) return false;
  const fp = path.join(dir, filename);
  fs.appendFileSync(fp, `${JSON.stringify({ ...record, recordedAt: new Date().toISOString() })}\n`, 'utf8');
  return true;
}

function readJsonl(filename, limit = 500) {
  const dir = getIntelDir();
  if (!dir) return [];
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip
    }
  }
  return out;
}

function archiveClaimSnapshot(claim, inst, memo) {
  if (!claim?.claimId) return null;
  let processFields = {};
  try {
    processFields = require('./intel-process-learning').enrichArchiveFields(claim);
  } catch {
    processFields = {};
  }
  appendJsonl('claims-archive.jsonl', {
    type: 'claim_snapshot',
    claimId: claim.claimId,
    issueId: claim.issueId || claim.issueIdStable || null,
    issueSnapshotId: claim.issueSnapshotId || null,
    playbookId: claim.playbookId || null,
    instrumentId: inst?.id,
    statement: claim.statement,
    status: claim.status,
    confidence: claim.confidence,
    side: claim.side,
    stateKey: claim.stateKey,
    horizon: claim.horizon,
    n: claim.n,
    nDisplay: claim.nDisplay,
    memoHeadline: memo?.headline || null,
    ...processFields,
    version: MEMORY_VERSION,
  });
  return true;
}

function recordRevision(prev, next, reason, revisionType = 'evidence_update') {
  if (!next?.claimId) return null;
  appendJsonl('revisions.jsonl', {
    type: 'revision',
    revisionType,
    claimId: next.claimId,
    instrumentId: next.instrumentId,
    from: prev
      ? { statement: prev.statement, confidence: prev.confidence, side: prev.side, status: prev.status }
      : null,
    to: { statement: next.statement, confidence: next.confidence, side: next.side, status: next.status },
    reason: reason || '引擎更新',
    version: MEMORY_VERSION,
  });
  return true;
}

function recordFalsification(claim, trigger, inst) {
  appendJsonl('failure-museum.jsonl', {
    type: 'falsified',
    claimId: claim.claimId,
    instrumentId: inst?.id,
    instrumentName: inst?.name,
    statement: claim.statement,
    falsifiedAt: new Date().toISOString().slice(0, 10),
    trigger: trigger || 'clock_expired',
    tags: [],
    version: MEMORY_VERSION,
  });
  return true;
}

function loadFailureMuseum(limit = 50) {
  return readJsonl('failure-museum.jsonl', limit).reverse();
}

function loadRecentRevisions(limit = 30) {
  return readJsonl('revisions.jsonl', limit).reverse();
}

function detectRevision(prevSnap, claim) {
  if (!prevSnap || !claim) return null;
  const changes = [];
  if (prevSnap.side !== claim.side) changes.push('side');
  if (prevSnap.confidence !== claim.confidence) changes.push('confidence');
  if (prevSnap.statement !== claim.statement) changes.push('statement');
  if (prevSnap.status !== claim.status) changes.push('status');
  if (!changes.length) return null;
  return {
    types: changes,
    revisionType: changes.includes('side') ? 'direction_revision' : changes.includes('status') ? 'status_revision' : 'evidence_update',
  };
}

function getLastClaimSnapshot(claimId) {
  const all = readJsonl('claims-archive.jsonl', 2000);
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (all[i].claimId === claimId) return all[i];
  }
  return null;
}

function processMemoryForInstrument(claim, inst, memo, { persist = true, skipFalsifyRecord = false } = {}) {
  if (!persist || !claim) return { revision: null, archived: false };
  const prev = getLastClaimSnapshot(claim.claimId);
  const rev = detectRevision(prev, claim);
  if (rev) {
    recordRevision(prev, claim, rev.types.join('+'), rev.revisionType);
  }
  archiveClaimSnapshot(claim, inst, memo);
  if (!skipFalsifyRecord && claim.status === 'falsified') {
    recordFalsification(claim, claim.falsifyTrigger || claim.triggers?.[0]?.condition, inst);
  }
  return { revision: rev, archived: true, prev };
}

module.exports = {
  MEMORY_VERSION,
  getIntelDir,
  archiveClaimSnapshot,
  recordRevision,
  recordFalsification,
  loadFailureMuseum,
  loadRecentRevisions,
  processMemoryForInstrument,
  getLastClaimSnapshot,
  readJsonl,
  appendJsonl,
};
