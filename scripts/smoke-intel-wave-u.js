#!/usr/bin/env node
/** Smoke: red-team ingest loop + playbook state machine (v2.83) */
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
  RED_LOOP_VERSION,
  ingestRedTeamDissent,
  buildRedTeamBoard,
  enrichQuestionQueueWithRedTeam,
} = require('../services/intel-red-team-loop');
const { RED_TEAM_VERSION } = require('../services/intel-red-team');
const {
  PLAYBOOK_SWITCH_VERSION,
  buildPlaybookBoard,
  enrichQuestionQueueWithPlaybook,
  resolvePlaybookContext,
} = require('../services/intel-playbook-switcher');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.83'), ORCHESTRATOR_VERSION);
assert(RED_LOOP_VERSION.includes('redteam-ingest'), RED_LOOP_VERSION);
assert(RED_TEAM_VERSION.includes('redteam-ingest'), RED_TEAM_VERSION);
assert(PLAYBOOK_SWITCH_VERSION.includes('playbook-statemachine'), PLAYBOOK_SWITCH_VERSION);

// 红队入库：有论据 → against；无论据 → debt，不编造
const withArgs = ingestRedTeamDissent(
  {
    claimId: 'c-rt',
    status: 'active',
    confidence: '弱结构',
    evidenceAgainst: [],
  },
  {
    arguments: [
      {
        type: 'joint_contradiction',
        summary: '合证与主判断相反',
        strength: 0.7,
        n: 40,
        dataSource: 'stock-flow',
      },
    ],
    forceDowngrade: true,
    downgradeTo: 'watch',
  },
  { persist: false }
);
assert(withArgs.ingested >= 1, `ingested ${withArgs.ingested}`);
assert(withArgs.claim.evidenceAgainst.length >= 1, 'against written');
assert(/红队/.test(withArgs.claim.evidenceAgainst[0].summary), withArgs.claim.evidenceAgainst[0].summary);
assert(withArgs.dissentDebt === false, 'no debt when against exists');

const noArgs = ingestRedTeamDissent(
  {
    claimId: 'c-debt',
    status: 'active',
    confidence: '强结构',
    evidenceAgainst: [],
  },
  { arguments: [], forceDowngrade: false },
  { persist: false }
);
assert(noArgs.dissentDebt === true, 'dissent debt');
assert(noArgs.claim.evidenceAgainst.length === 0, 'no fabricated against');
assert(noArgs.claim.status === 'watch', `status ${noArgs.claim.status}`);
assert(noArgs.claim.confidence === '叙事分歧', noArgs.claim.confidence);

const rtBoard = buildRedTeamBoard(
  [
    {
      id: 'cu',
      name: '沪铜',
      intelCenter: {
        redTeam: { available: true, opposingStrength: 0.8, forceDowngrade: true, arguments: [{ summary: '合证反对' }] },
        primaryClaim: {
          claimId: 'x',
          redTeamIngested: 1,
          dissentDebt: false,
          evidenceAgainst: [{ summary: '[红队] 合证反对', dataSource: 'intel-red-team' }],
        },
      },
    },
    {
      id: 'au',
      name: '沪金',
      intelCenter: {
        redTeam: { available: true, opposingStrength: 0.1, arguments: [] },
        primaryClaim: { claimId: 'y', dissentDebt: true, evidenceAgainst: [], status: 'watch' },
      },
    },
  ],
  { asOf: '2026-07-17' }
);
assert(rtBoard.counts.dissentDebt >= 1, `debt ${rtBoard.counts.dissentDebt}`);
assert(rtBoard.questions.some((q) => /反对|红队/.test(q.question)), 'rt Q');
const qRt = enrichQuestionQueueWithRedTeam({ all: [], version: 'u' }, rtBoard);
assert((qRt.redTeamInjected || 0) >= 1, `rt injected ${qRt.redTeamInjected}`);

// 剧本状态机：无快照不假迁移；n 不足不改权
const pbCtx = resolvePlaybookContext(
  { id: 'cu', name: '沪铜', intelligenceKernel: { stateKey: 'test|key' } },
  {}
);
assert(pbCtx.weightGate, 'weightGate');
assert(typeof pbCtx.weightGate.allowed === 'boolean', 'weightGate.allowed');
if (!pbCtx.weightGate.allowed) {
  assert(pbCtx.processMultiplier === 1, 'n gate blocks weight');
}

const pbBoard = buildPlaybookBoard(
  [
    {
      id: 'cu',
      name: '沪铜',
      intelCenter: {
        playbook: {
          activeId: 'pb-a',
          activeTitle: 'A',
          stage: 'early',
          switchSource: 'decision_tree',
          switched: false,
          stateKey: 'k',
          n: 5,
          nDisplay: '5',
          weightGate: { allowed: false, n: 5, nDisplay: '5' },
          display: 'Playbook pb-a',
        },
      },
    },
    {
      id: 'au',
      name: '沪金',
      intelCenter: {
        playbook: {
          activeId: 'pb-b',
          activeTitle: 'B',
          stage: 'mid',
          switchSource: 'analyst_pin',
          switched: true,
          stateKey: 'k2',
          n: null,
          nDisplay: '暂无',
          weightGate: { allowed: false, n: null, nDisplay: '暂无' },
          display: 'Playbook pb-b 覆写',
        },
      },
    },
  ],
  { asOf: '2026-07-17', persist: false, skipSnapshot: true }
);
assert(pbBoard.withPlaybook === 2, `withPb ${pbBoard.withPlaybook}`);
assert(pbBoard.switchedCount >= 1, `switched ${pbBoard.switchedCount}`);
assert(pbBoard.transitionCount === 0, 'no fake transition without snapshot');
assert(pbBoard.questions.some((q) => /过程权|n=/.test(q.question)), 'n gate Q');
const qPb = enrichQuestionQueueWithPlaybook({ all: [], version: 'u' }, pbBoard);
assert((qPb.playbookInjected || 0) >= 1, `pb injected ${qPb.playbookInjected}`);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.83'), pack.version);
assert(pack.redTeamBoard?.version?.includes('redteam-ingest'), pack.redTeamBoard?.version || 'no rt');
assert(pack.playbookBoard?.version?.includes('playbook-statemachine'), pack.playbookBoard?.version || 'no pb');
assert(typeof pack.redTeamBoard.display === 'string', pack.redTeamBoard.display);
assert(typeof pack.playbookBoard.display === 'string', pack.playbookBoard.display);
assert(
  pack.faceViews?.research?.redTeamBoard || pack.faceViews?.research?.playbookBoard,
  'research face boards'
);

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-u redteam-playbook');
process.exit(fails ? 1 : 0);
