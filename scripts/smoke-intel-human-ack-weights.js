#!/usr/bin/env node
/** Smoke: process weight human-ack gate (vision §5 / v2.89.1) */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const fs = require('fs');
const path = require('path');
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
  PROCESS_VERSION,
  WEIGHTS_FILE,
  PROPOSAL_FILE,
  proposePlaybookWeights,
  tryUpdatePlaybookWeights,
  approvePlaybookWeights,
  rejectPlaybookWeights,
  loadPlaybookWeights,
  getPendingWeightProposal,
  lookupProcessMultiplier,
} = require('../services/intel-process-learning');
const { getDataDir } = require('../services/data-paths');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(PROCESS_VERSION.includes('human-ack'), PROCESS_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.1') || ORCHESTRATOR_VERSION.includes('human-ack'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.1'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'weight_human_ack'), 'lesson');

const intelDir = path.join(getDataDir(), 'intel-center');
fs.mkdirSync(intelDir, { recursive: true });
const weightsPath = path.join(intelDir, WEIGHTS_FILE);
const proposalPath = path.join(intelDir, PROPOSAL_FILE);
const bakW = fs.existsSync(weightsPath) ? fs.readFileSync(weightsPath, 'utf8') : null;
const bakP = fs.existsSync(proposalPath) ? fs.readFileSync(proposalPath, 'utf8') : null;

const scoresPath = path.join(intelDir, 'process-scores.jsonl');
const bakScores = fs.existsSync(scoresPath) ? fs.readFileSync(scoresPath, 'utf8') : null;
const scoreLines = [];
for (let i = 0; i < 25; i += 1) {
  scoreLines.push(
    JSON.stringify({
      type: 'process_score',
      stateKey: 'test|pb',
      processCorrect: true,
      scored: true,
      directionHit: i % 3 !== 0,
      n: 20,
    })
  );
}
fs.writeFileSync(scoresPath, `${scoreLines.join('\n')}\n`, 'utf8');

try {
  // seed approved baseline
  fs.writeFileSync(
    weightsPath,
    JSON.stringify(
      {
        version: PROCESS_VERSION,
        approved: true,
        approvedAt: '2026-01-01T00:00:00.000Z',
        byStateKey: {
          'test|pb': {
            available: true,
            n: 40,
            nDisplay: '40',
            multiplier: 1,
            processDisplay: '50% (20/40)',
            dirHitDisplay: '50% (10/20)',
          },
        },
      },
      null,
      2
    ),
    'utf8'
  );

  const beforeMtime = fs.statSync(weightsPath).mtimeMs;
  const proposed = proposePlaybookWeights({
    directionHit: '50% (10/20)',
    processCorrect: '80% (20/25)',
    dirWrongProcessRightDisplay: '2/20',
    sampleN: 25,
  });
  assert(proposed.pendingApproval === true, `pending ${proposed.status}`);
  assert((proposed.materialChanges || []).length >= 1, 'material');
  const afterProposeMtime = fs.statSync(weightsPath).mtimeMs;
  assert(afterProposeMtime === beforeMtime, 'weights file untouched on propose');

  const aliased = tryUpdatePlaybookWeights({
    directionHit: '50% (10/20)',
    processCorrect: '80% (20/25)',
    dirWrongProcessRightDisplay: '2/20',
    sampleN: 25,
  });
  assert(aliased.pendingApproval === true, 'tryUpdate aliases propose');
  assert(fs.statSync(weightsPath).mtimeMs === beforeMtime, 'still untouched');

  const pending = getPendingWeightProposal();
  assert(pending.pendingApproval === true, pending.display);

  const liveBefore = lookupProcessMultiplier('test|pb');
  assert(liveBefore.multiplier === 1, `live ${liveBefore.multiplier}`);

  const rej = rejectPlaybookWeights({
    proposalId: pending.proposalId,
    actor: 'smoke',
    reason: 'test reject',
  });
  assert(rej.ok === true && rej.rejected === true, `reject ${JSON.stringify(rej)}`);

  const proposed2 = proposePlaybookWeights({
    directionHit: '50% (10/20)',
    processCorrect: '80% (20/25)',
    dirWrongProcessRightDisplay: '2/20',
    sampleN: 25,
  });
  assert(proposed2.pendingApproval === true, 're-propose');

  const badId = approvePlaybookWeights({ proposalId: 'wrong-id', actor: 'smoke' });
  assert(badId.ok === false, 'mismatch id');

  const ok = approvePlaybookWeights({ proposalId: proposed2.proposalId, actor: 'smoke', note: 'ok' });
  assert(ok.ok === true, JSON.stringify(ok));
  assert(fs.statSync(weightsPath).mtimeMs > beforeMtime, 'weights written after approve');

  const liveAfter = lookupProcessMultiplier('test|pb');
  assert(liveAfter.multiplier === 1.08, `approved mult ${liveAfter.multiplier}`);

  const noop = proposePlaybookWeights({
    directionHit: '50% (10/20)',
    processCorrect: '80% (20/25)',
    dirWrongProcessRightDisplay: '2/20',
    sampleN: 25,
  });
  assert(noop.pendingApproval === false || noop.status === 'noop', `noop ${noop.status}`);

  const pack = buildIntelCenterPack(
    [
      { id: 'cu', name: '沪铜', changePct: 0.5 },
      { id: 'au', name: '沪金', changePct: 0.2 },
    ],
    { asOf: '2026-07-17', persist: false }
  );
  assert(pack.version.includes('2.89.1') || pack.version.includes('human-ack'), pack.version);
  assert(
    pack.processScorecard?.note?.includes('人审') || pack.processScorecard?.method?.includes('human-ack'),
    'scorecard note'
  );
} finally {
  if (bakW != null) fs.writeFileSync(weightsPath, bakW, 'utf8');
  else if (fs.existsSync(weightsPath)) fs.unlinkSync(weightsPath);
  if (bakP != null) fs.writeFileSync(proposalPath, bakP, 'utf8');
  else if (fs.existsSync(proposalPath)) fs.unlinkSync(proposalPath);
  if (bakScores != null) fs.writeFileSync(scoresPath, bakScores, 'utf8');
  else if (fs.existsSync(scoresPath)) fs.unlinkSync(scoresPath);
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · human-ack weights §5');
process.exit(fails ? 1 : 0);
