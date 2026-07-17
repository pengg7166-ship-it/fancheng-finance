#!/usr/bin/env node
/** Smoke: face compute ledger + evidence DSL audit (v2.82) */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();
const disk = require('../services/disk-cache');
if (!disk.getRoot()) disk.init('F:/FanchengFinance/data');

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    fails += 1;
  } else console.log('OK', msg);
}

const {
  FACE_COMPUTE_VERSION,
  buildFaceComputeBoard,
} = require('../services/intel-face-compute-ledger');
const {
  EVIDENCE_AUDIT_VERSION,
  auditOneEvidence,
  buildEvidenceAuditBoard,
  enrichQuestionQueueWithEvidenceAudit,
} = require('../services/intel-evidence-audit');
const { EVIDENCE_VERSION } = require('../services/intel-evidence-dsl');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.82'), ORCHESTRATOR_VERSION);
assert(FACE_COMPUTE_VERSION.includes('face-compute'), FACE_COMPUTE_VERSION);
assert(EVIDENCE_AUDIT_VERSION.includes('evidence-audit'), EVIDENCE_AUDIT_VERSION);
assert(EVIDENCE_VERSION.includes('evidence-audit'), EVIDENCE_VERSION);

const okEv = auditOneEvidence({
  evidenceType: 'warehouse_joint',
  direction: 'for',
  dataSource: 'inventory-capital-joint',
  n: 40,
  nDisplay: '40',
  summary: '合证去库',
});
assert(okEv.ok, 'ok evidence');

const badEv = auditOneEvidence({
  evidenceType: 'warehouse_joint',
  direction: 'for',
  dataSource: 'mock-dummy',
  summary: 'generateFake placeholder',
});
assert(badEv.severity === 'critical', `critical ${badEv.severity}`);

const board = buildEvidenceAuditBoard(
  [
    {
      id: 'cu',
      name: '沪铜',
      intelCenter: {
        primaryClaim: {
          claimId: 'c1',
          status: 'active',
          evidenceFor: [
            {
              evidenceType: 'price',
              direction: 'for',
              dataSource: 'quote',
              summary: '涨',
              nDisplay: '暂无',
            },
          ],
          evidenceAgainst: [],
        },
      },
    },
    {
      id: 'au',
      name: '沪金',
      intelCenter: {
        primaryClaim: {
          claimId: 'c2',
          status: 'active',
          evidenceFor: [
            {
              evidenceType: 'capital',
              direction: 'for',
              dataSource: 'capital',
              n: 20,
              nDisplay: '20',
              summary: '资金偏多',
            },
          ],
          evidenceAgainst: [
            {
              evidenceType: 'warehouse_joint',
              direction: 'against',
              dataSource: 'joint',
              n: 30,
              nDisplay: '30',
              summary: '合证偏空',
            },
          ],
        },
      },
    },
  ],
  { asOf: '2026-07-17' }
);
assert(board.counts.missingAgainst >= 1, `missingAgainst ${board.counts.missingAgainst}`);
assert(board.questions.some((q) => /反对/.test(q.question)), 'against Q');
const q = enrichQuestionQueueWithEvidenceAudit({ all: [], version: 't' }, board);
assert((q.evidenceAuditInjected || 0) >= 1, `injected ${q.evidenceAuditInjected}`);

const fc = buildFaceComputeBoard({
  attentionBudget: {
    deepSlots: 10,
    deepCount: 8,
    shallowSlots: 24,
    shallowCount: 20,
    silentCount: 46,
    method: 'triage',
  },
  attentionByFace: {
    byFace: {
      research: { deepSlots: 14, deepCount: 12, shallowSlots: 28, shallowCount: 20, silentCount: 42 },
      execution: { deepSlots: 6, deepCount: 5, shallowSlots: 18, shallowCount: 15, silentCount: 54 },
    },
  },
  faceRetriage: {
    research: {
      promoteCount: 5,
      promote: [1, 2, 3, 4, 5],
      appliedFull: { appliedCount: 5, method: 'face-promote-full', promotedIds: ['a', 'b', 'c', 'd', 'e'] },
      overlays: {},
    },
    execution: {
      promoteCount: 10,
      promote: Array(10).fill(1),
      appliedFull: { appliedCount: 6, method: 'face-promote-full', promotedIds: ['1', '2', '3', '4', '5', '6'] },
      overlays: {},
    },
  },
  instruments: Array.from({ length: 74 }, (_, i) => ({
    id: `i${i}`,
    intelCenter: { attention: { computeMode: i < 8 ? 'full' : i < 28 ? 'lite' : 'skip' } },
  })),
  asOf: '2026-07-17',
  persist: false,
});
assert(fc.faces.execution.capped === true, 'exec capped');
assert(fc.integrityOk === false || fc.integrityFails.length >= 1, 'integrity fail on capped');
assert(/算力台账/.test(fc.display), fc.display);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.82'), pack.version);
assert(pack.faceComputeBoard?.version?.includes('face-compute'), pack.faceComputeBoard?.version || 'no fc');
assert(pack.evidenceAuditBoard?.version?.includes('evidence-audit'), pack.evidenceAuditBoard?.version || 'no ev');
assert(typeof pack.faceComputeBoard.display === 'string', pack.faceComputeBoard.display);
assert(typeof pack.evidenceAuditBoard.display === 'string', pack.evidenceAuditBoard.display);
assert(pack.faceViews?.research?.faceComputeBoard || pack.faceViews?.research?.evidenceAuditBoard, 'research face');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-t compute-evidence');
process.exit(fails ? 1 : 0);
