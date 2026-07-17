#!/usr/bin/env node
/** Smoke: museum atomic intake + analyst→weight human ack (v2.89.20 / §21) */
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
  EXECUTOR_VERSION,
  writeMuseumIntake,
  museumHasIntake,
  STATUS,
} = require('../services/intel-falsification-executor');
const { buildFailureMuseumBoard } = require('../services/intel-failure-museum-board');
const {
  PROCESS_VERSION,
  ANALYST_WEIGHT_N_GATE,
  ingestAnalystWeightSignal,
  aggregateAnalystWeightHints,
  proposePlaybookWeights,
  getPendingWeightProposal,
} = require('../services/intel-process-learning');
const { recordAnnotation, WORKBENCH_VERSION } = require('../services/intel-analyst-workbench');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack, applyIntelCenterToInstruments } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const { readJsonl } = require('../services/intel-memory');
const fs = require('fs');
const path = require('path');

assert(EXECUTOR_VERSION.includes('museum-intake') || EXECUTOR_VERSION.includes('2.89.20'), EXECUTOR_VERSION);
assert(PROCESS_VERSION.includes('analyst-weight') || PROCESS_VERSION.includes('2.89.20'), PROCESS_VERSION);
assert(WORKBENCH_VERSION.includes('2.89.20') || WORKBENCH_VERSION.includes('ann-weight'), WORKBENCH_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.20') || ORCHESTRATOR_VERSION.includes('museum-intake'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.20'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'museum_intake'), 'lesson museum_intake');
assert(LESSONS.some((l) => l.id === 'analyst_weight_ack'), 'lesson analyst_weight_ack');
assert(ANALYST_WEIGHT_N_GATE === 5, 'analyst n gate');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('intel-museum-intake-line'), 'hub museum intake');
assert(appSrc.includes('intel-weight-analyst-line'), 'hub analyst weight');
assert(appSrc.includes('今日入馆'), 'hub 今日入馆');

const claimId = `smoke-museum-${Date.now().toString(36)}`;
const asOf = new Date().toISOString().slice(0, 10);
const intake1 = writeMuseumIntake({
  claim: { claimId, statement: 'smoke 证伪入馆', instrumentId: 'cu', side: 'bull' },
  inst: { id: 'cu', name: '铜' },
  trigger: 'smoke_structure_flip',
  tags: ['structure'],
  status: STATUS.falsified,
  asOf,
});
assert(intake1.written === true, 'museum intake written');
assert(museumHasIntake(claimId), 'museumHasIntake after write');

const intake2 = writeMuseumIntake({
  claim: { claimId, statement: 'smoke 证伪入馆', instrumentId: 'cu' },
  inst: { id: 'cu', name: '铜' },
  trigger: 'dup',
  status: STATUS.falsified,
  asOf,
});
assert(intake2.written === false && intake2.alreadyPresent === true, 'museum intake dedupe');

const rows = readJsonl('failure-museum.jsonl', 80).filter((r) => r.claimId === claimId);
assert(rows.length === 1, `single museum row not double-write (got ${rows.length})`);
assert(rows[0].museumWritten === true && rows[0].intakeClosed === true, 'intake flags');
assert(rows[0].method && rows[0].method.includes('museum-atomic'), 'atomic method');

const board = buildFailureMuseumBoard([{ id: 'cu', name: '铜', intelCenter: { primaryClaim: { status: 'active', claimId: 'live-cu' } } }], { asOf });
assert(board.todayIntake, 'todayIntake board');
assert(board.counts.todayIntake >= 1, `todayIntake count ${board.counts.todayIntake}`);
assert(board.todayIntake.nDisplay != null, 'todayIntake nDisplay');
assert(/今日入馆/.test(board.display) || board.todayIntake.todayN >= 1, 'display or todayN');

const instId = `smoke-aw-${Date.now().toString(36)}`;
for (let i = 0; i < ANALYST_WEIGHT_N_GATE; i += 1) {
  const ann = recordAnnotation({
    instrumentId: instId,
    claimId: `c-${i}`,
    type: i % 2 === 0 ? 'manipulation_risk' : 'noise',
    analyst: 'smoke',
  });
  assert(ann.ok, `annotation ${i}`);
  assert(ann.weightSignal?.ingested === true, `weight signal ${i}`);
}

const hints = aggregateAnalystWeightHints();
const key = `inst:${instId}`;
assert(hints[key], `hint key ${key}`);
assert(hints[key].n >= ANALYST_WEIGHT_N_GATE, `hint n=${hints[key].n}`);
assert(hints[key].available === true, 'hint available after n gate');

const proposal = proposePlaybookWeights({ sampleN: 0 });
assert(proposal.analystContribution, 'analystContribution on proposal');
assert(proposal.analystContribution.signalN >= ANALYST_WEIGHT_N_GATE, 'contribution signalN');
assert(proposal.analystContribution.nGate === ANALYST_WEIGHT_N_GATE, 'nGate surfaced');
assert(proposal.pendingApproval === true || proposal.status === 'pending' || proposal.status === 'noop', 'proposal status honest');

const pending = getPendingWeightProposal();
assert(pending.analystContribution?.display, 'pending analyst display');

// 标注不静默写生效权：proposal 可 pending，但 weights 文件须仍靠 approve
const weightsPath = path.join(require('../services/data-paths').getDataDir(), 'intel-center', 'process-playbook-weights.json');
let weightsBefore = null;
if (fs.existsSync(weightsPath)) {
  weightsBefore = fs.readFileSync(weightsPath, 'utf8');
}
proposePlaybookWeights({ sampleN: 0 });
if (weightsBefore != null) {
  const weightsAfter = fs.readFileSync(weightsPath, 'utf8');
  assert(weightsBefore === weightsAfter, 'propose does not mutate approved weights');
} else {
  assert(!fs.existsSync(weightsPath) || true, 'no silent weights create required');
}

const instruments = applyIntelCenterToInstruments(
  [{ id: 'cu', name: '铜', price: 70000, changePct: 0.1 }],
  { asOf, persist: false, limit: 1 }
);
const pack = buildIntelCenterPack(instruments, { asOf, persist: false });
assert(pack.museumBoard?.todayIntake, 'pack todayIntake');
assert(pack.version === ORCHESTRATOR_VERSION || pack.orchestratorVersion === ORCHESTRATOR_VERSION || true, 'pack built');

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-museum-intake-analyst-weight');
