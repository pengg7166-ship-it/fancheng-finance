#!/usr/bin/env node
/** Smoke: meta debt bridge + false quiet loop (v2.89.18 / §30+§70) */
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
  META_VERSION,
  META_SPOT_DEBT,
  buildMetaIntelligenceBoard,
  mergeMetaBridgeIntoDebtBoard,
} = require('../services/intel-meta-intelligence');
const {
  QUIET_BRAKE_VERSION,
  buildQuietBrakeBoard,
  ackFalseQuietRisk,
  enrichQuestionQueueWithQuietBrake,
} = require('../services/intel-quiet-brake-board');
const { attachDebtOpsPlan } = require('../services/intel-debt-ops');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(META_VERSION.includes('meta-debt') || META_VERSION.includes('2.89.18'), META_VERSION);
assert(QUIET_BRAKE_VERSION.includes('false-quiet-loop') || QUIET_BRAKE_VERSION.includes('2.89.18'), QUIET_BRAKE_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.18') || ORCHESTRATOR_VERSION.includes('meta-debt'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.18'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'meta_debt_bridge'), 'lesson meta_debt_bridge');
assert(LESSONS.some((l) => l.id === 'false_quiet_risk'), 'lesson false_quiet');
assert(META_SPOT_DEBT.coverage_stale?.debtType === 'stale_data', 'spot map');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('intel-meta-bridge-line'), 'hub meta bridge');
assert(appSrc.includes('prefer-meta'), 'hub prefer meta');
assert(appSrc.includes('intel-fq-loop'), 'hub fq loop');
assert(appSrc.includes('intel-ack-false-quiet'), 'hub fq ack');
const mainSrc = fs.readFileSync(path.join(process.cwd(), 'electron/main.js'), 'utf8');
assert(mainSrc.includes('ack-intel-false-quiet'), 'ipc ack');
const preSrc = fs.readFileSync(path.join(process.cwd(), 'electron/preload.js'), 'utf8');
assert(preSrc.includes('ackIntelFalseQuiet'), 'preload ack');

const instruments = [
  {
    id: 'rb',
    name: '螺纹',
    calendarStaleness: { lagDays: 5 },
    factors: { inventory: { stockFlowJoint: { available: false } } },
    capitalAttention: { jointWithInventory: '暂无' },
    intelCenter: {
      primaryClaim: { status: 'active', evidenceAgainst: [{}], n: 10, nDisplay: '10' },
    },
  },
];

const meta = buildMetaIntelligenceBoard(instruments, {
  asOf: '2026-07-17',
  debtBoard: { weeklyMustPay: [], byType: { stale_data: 1, joint_gap: 1 } },
});
assert(meta.debtBridge, 'debtBridge');
assert((meta.debtBridge.pendingRunnable || 0) >= 1, `runnable ${meta.debtBridge.pendingRunnable}`);
assert(meta.spots.some((s) => s.opsRunnable && s.debtType), 'spot ops');

let debt = {
  weeklyMustPay: [],
  weeklyPlan: { mustPay: [] },
  display: '问题债务·测',
  version: 'debt-test',
  method: 'debt',
};
debt = mergeMetaBridgeIntoDebtBoard(debt, meta, '2026-07-17');
assert((debt.metaInjected || 0) >= 1, `injected ${debt.metaInjected}`);
debt = attachDebtOpsPlan(debt, { asOf: '2026-07-17' });
assert((debt.opsPlan?.pendingRunnable || 0) >= 1, 'ops after inject');

const qbOpen = buildQuietBrakeBoard({
  dailyDiff: {
    available: true,
    quietDay: true,
    materialChanges: 0,
    changes: { surpriseTop: [{ id: 'cu' }] },
    summary: '静默',
  },
  confidenceBrake: { active: false },
  interrupts: [{ id: 'cu', name: '铜' }],
  asOf: '2026-07-17',
  persist: false,
});
assert(qbOpen.falseQuietRisk === true, 'false quiet risk');
assert(qbOpen.falseQuietLoop?.status === 'open', qbOpen.falseQuietLoop?.status);
assert(qbOpen.falseQuietLoop?.canAck === true, 'canAck');
assert(qbOpen.falseQuietLoop?.checklist?.length >= 2, 'checklist');
assert(qbOpen.questions.some((q) => q.priority === 'P0' && q.falseQuietLoop), 'P0 question');

const qMerged = enrichQuestionQueueWithQuietBrake(
  { all: [], p0: [{ question: '原P0', priority: 'P0' }], p0Count: 1 },
  qbOpen
);
assert(qMerged.p0.some((q) => q.falseQuietLoop), 'p0 injected');

const ack = ackFalseQuietRisk({
  asOf: '2026-07-17',
  reasons: qbOpen.falseQuietReasons,
  resolution: 'reviewed',
  fingerprint: qbOpen.falseQuietLoop.fingerprint,
});
assert(ack.ok && ack.state?.status === 'acknowledged', 'ack ok');

const qbAck = buildQuietBrakeBoard({
  dailyDiff: {
    available: true,
    quietDay: true,
    materialChanges: 0,
    changes: { surpriseTop: [{ id: 'cu' }] },
    summary: '静默',
  },
  confidenceBrake: { active: false },
  interrupts: [{ id: 'cu' }],
  asOf: '2026-07-17',
  persist: false,
});
assert(qbAck.falseQuietLoop?.status === 'acknowledged', qbAck.falseQuietLoop?.status);
assert(qbAck.falseQuietLoop?.canAck === false, 'no re-ack');

const sample = [
  { id: 'rb', name: '螺纹', direction: 'bearish', changePct: -1, sector: 'ferrous' },
  { id: 'cu', name: '铜', direction: 'bullish', changePct: 1, sector: 'base_metal' },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.89.18') || pack.version.includes('meta-debt'), pack.version);
assert(pack.metaIntelligence?.debtBridge || pack.metaIntelligence?.severity, 'pack meta');
assert(pack.quietBrakeBoard?.falseQuietLoop, 'pack fq loop');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · meta-debt + false-quiet-loop §30/§70'));
process.exit(fails ? 1 : 0);
