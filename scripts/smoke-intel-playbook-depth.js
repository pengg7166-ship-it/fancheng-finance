#!/usr/bin/env node
/** Smoke: regime script-pack playbook depth (vision §73 / v2.89.13) */
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
  PLAYBOOK_SWITCH_VERSION,
  REGIME_SCRIPT_PACKS,
  resolvePlaybookContext,
  applyPlaybookToClaim,
  buildPlaybookBoard,
  savePlaybookSnapshot,
} = require('../services/intel-playbook-switcher');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const { buildIntelMemo } = require('../services/intel-memo');

assert(PLAYBOOK_SWITCH_VERSION.includes('regime-script') || PLAYBOOK_SWITCH_VERSION.includes('2.89.13'), PLAYBOOK_SWITCH_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.13') || ORCHESTRATOR_VERSION.includes('playbook-depth'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.13'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'playbook_regime_script'), 'lesson regime');
assert(REGIME_SCRIPT_PACKS.build_oi_up?.id === 'RP-BUILD-OI-UP', 'pack build');
assert(REGIME_SCRIPT_PACKS.destock_oi_up?.id === 'RP-DESTOCK-OI-UP', 'pack destock');

const instBuild = {
  id: 'rb',
  name: '螺纹',
  sector: 'ferrous',
  direction: 'bearish',
  factors: {
    inventory: {
      stockFlowJoint: {
        available: true,
        primaryRegime: 'build_oi_up',
        primaryLabel: '累库+增仓',
      },
    },
  },
  intelligenceKernel: {
    available: true,
    stateKey: 'ferrous|build_oi_up|bear',
    mainContradiction: { side: 'bear', label: '累库抛压' },
  },
};

const pb = resolvePlaybookContext(instBuild, { skipPrior: true });
assert(pb.regimeKey === 'build_oi_up', pb.regimeKey);
assert(pb.regimePlaybookId === 'RP-BUILD-OI-UP', pb.regimePlaybookId);
assert(pb.activeId === 'RP-BUILD-OI-UP', pb.activeId);
assert(pb.scriptPack?.mainContradiction, pb.scriptPack);
assert(pb.switchSource === 'regime_script_pack', pb.switchSource);

const claimBare = {
  claimId: 'c1',
  side: 'bear',
  statement: '螺纹累库压制',
  evidenceFor: [{ summary: '合证累库+增仓', dataSource: 'stockFlowJoint', nDisplay: '40' }],
  evidenceAgainst: [],
  triggers: [],
  stateKey: 'ferrous|build_oi_up|bear',
  confidence: '弱结构',
  status: 'active',
};

const applied = applyPlaybookToClaim(claimBare, pb, '2026-07-16');
assert(applied.playbookInjectedAgainst === true, 'injected against');
assert((applied.evidenceAgainst || []).length >= 1, 'against len');
assert(/累库|对侧/.test(applied.evidenceAgainst[0].summary), applied.evidenceAgainst[0].summary);
assert((applied.triggers || []).some((t) => t.dataSource === 'regime-script-pack'), 'pack triggers');
assert(applied.validUntil, applied.validUntil);
assert(applied.regimePlaybookId === 'RP-BUILD-OI-UP', applied.regimePlaybookId);

// family gate: wrong family → weight blocked even with fake n path
const pbMismatch = resolvePlaybookContext(
  {
    ...instBuild,
    intelligenceKernel: { ...instBuild.intelligenceKernel, stateKey: 'ferrous|destock_oi_up|bull' },
  },
  { skipPrior: true }
);
assert(pbMismatch.weightGate.familyInPack === false || pbMismatch.regimeKey === 'build_oi_up', 'family check context');
// regime is still build_oi_up from sf, family from stateKey is destock → mismatch
assert(pbMismatch.weightGate.familyInPack === false, `familyInPack=${pbMismatch.weightGate.familyInPack}`);
assert(pbMismatch.weightGate.allowed === false, 'weight blocked out of family');

// Simulate snapshot then flip
const board1 = buildPlaybookBoard(
  [
    {
      id: 'rb',
      name: '螺纹',
      intelCenter: {
        playbook: {
          ...pb,
          available: true,
          nDisplay: '暂无',
        },
      },
    },
  ],
  { asOf: '2026-07-15', persist: true }
);
assert(board1.withRegimePack >= 1, board1);

const instDestock = {
  ...instBuild,
  direction: 'bullish',
  factors: {
    inventory: {
      stockFlowJoint: {
        available: true,
        primaryRegime: 'destock_oi_up',
        primaryLabel: '去库+增仓',
      },
    },
  },
  intelligenceKernel: {
    available: true,
    stateKey: 'ferrous|destock_oi_up|bull',
    mainContradiction: { side: 'bull', label: '去库紧库存' },
  },
};
const pb2 = resolvePlaybookContext(instDestock);
assert(pb2.regimeFlip, pb2.regimeFlip);
assert(/合证regime翻转/.test(pb2.whatChanged || ''), pb2.whatChanged);
assert(pb2.regimeFlip.fromRegime === 'build_oi_up', pb2.regimeFlip.fromRegime);
assert(pb2.regimeFlip.toRegime === 'destock_oi_up', pb2.regimeFlip.toRegime);

const claimFlip = applyPlaybookToClaim(
  { ...claimBare, side: 'bull', statement: '螺纹去库', evidenceAgainst: [] },
  pb2,
  '2026-07-16'
);
assert(claimFlip.regimeFlip === true, 'claim regimeFlip');
assert(claimFlip.playbookTransition?.kind === 'regime_flip', claimFlip.playbookTransition);
assert(claimFlip.whatChanged, claimFlip.whatChanged);

const memo = buildIntelMemo(instDestock, claimFlip, null, { stateLabel: '待校验' }, null, { memo: { pass: false } }, null);
assert(memo.whatChanged, memo.whatChanged);
assert(memo.playbookInjectedAgainst === true || (memo.oppose || []).length >= 1, 'memo oppose');

const board2 = buildPlaybookBoard(
  [
    {
      id: 'rb',
      name: '螺纹',
      intelCenter: { playbook: { ...pb2, available: true, nDisplay: '暂无' } },
    },
  ],
  { asOf: '2026-07-16', persist: false }
);
assert(board2.regimeFlipCount >= 1, board2.regimeFlipCount);
assert((board2.transitions || []).some((t) => t.kind === 'regime_flip'), 'transition kind');
assert((board2.questions || []).some((q) => /合证剧本翻转/.test(q.question)), 'P1 question');

const sample = [
  { id: 'rb', name: '螺纹', direction: 'bearish', changePct: -1, sector: 'ferrous' },
  { id: 'sc', name: '原油', direction: 'bullish', changePct: 1, sector: 'energy' },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.89.13') || pack.version.includes('playbook-depth'), pack.version);
assert(pack.playbookBoard?.display, pack.playbookBoard?.display);
assert(pack.faceViews?.research?.playbookBoard, 'face pb board');

const withRp = withIntel.find((i) => i.intelCenter?.playbook?.regimePlaybookId);
if (withRp) {
  assert(withRp.intelCenter.playbook.scriptPack || withRp.intelCenter.primaryClaim?.regimePlaybookId, 'live script');
  console.log('OK live regime', withRp.id, withRp.intelCenter.playbook.regimePlaybookId);
} else {
  console.log('OK no live regime pack today (data-dependent) — unit path still covered');
}

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · playbook-depth §73'));
process.exit(fails ? 1 : 0);
