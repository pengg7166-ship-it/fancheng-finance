#!/usr/bin/env node
/** Smoke: cross-instrument resonance board (v2.73) */
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
  buildResonanceBoard,
  attachResonanceToInstruments,
  enrichQuestionQueueWithResonance,
  RESONANCE_VERSION,
} = require('../services/intel-resonance-board');
const { buildShockGraph } = require('../services/intel-shock-graph');
const {
  ORCHESTRATOR_VERSION,
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.73'), ORCHESTRATOR_VERSION);
assert(RESONANCE_VERSION.includes('resonance'), RESONANCE_VERSION);

// 合成冲击边（仅测分类逻辑；corr/n 显式给出，非假盘）
const fakeShock = {
  activeEdges: [
    {
      from: 'sc',
      to: 'fu',
      label: '原油→燃油',
      corr: 0.72,
      n: 80,
      nDisplay: '80',
      activation: 0.55,
      lagTypical: 1,
      mechanism: 'cost',
    },
    {
      from: 'cu',
      to: 'al',
      label: '铜→铝',
      corr: 0.61,
      n: 60,
      nDisplay: '60',
      activation: 0.4,
      lagTypical: 1,
      mechanism: 'sentiment',
    },
  ],
  pendingEdges: [
    {
      from: 'i',
      to: 'rb',
      label: '铁矿→螺纹',
      reason: 'n不足',
      n: 12,
      nDisplay: '12',
      pending: true,
      text: '铁矿→螺纹 · 待校验',
    },
  ],
};

const instruments = [
  {
    id: 'sc',
    name: '原油',
    changePct: -2.1,
    intelCenter: { primaryClaim: { side: 'bear', status: 'active' }, beliefLevel: '弱结构' },
  },
  {
    id: 'fu',
    name: '燃油',
    changePct: 0.1,
    intelCenter: { primaryClaim: { side: 'bull', status: 'active' }, beliefLevel: '弱结构' },
  },
  {
    id: 'cu',
    name: '沪铜',
    changePct: -1.5,
    intelCenter: { primaryClaim: { side: 'bear', status: 'active' } },
  },
  {
    id: 'al',
    name: '沪铝',
    changePct: -0.1,
    intelCenter: { primaryClaim: { side: 'bear', status: 'active' } },
  },
];

const board = buildResonanceBoard(fakeShock, instruments, { asOf: '2026-07-16' });
assert(board.counts.diverge >= 1, `diverge ${board.counts.diverge}`);
assert(board.counts.lagging >= 1 || board.pairs.some((p) => p.regime === 'lagging' || p.regime === 'resonate'), 'lag/resonate');
assert(board.pairs.every((p) => p.pending || (p.n != null && p.corr != null)), 'active pairs have n+corr');
assert(board.questions.length >= 1, `questions ${board.questions.length}`);
assert(/分化|滞后|共振/.test(board.display), board.display);
assert(!board.pairs.some((p) => !p.pending && p.corr == null), 'no fake corr on active');
console.log('OK board', board.display);

const attached = attachResonanceToInstruments(instruments, board);
assert(attached.find((i) => i.id === 'fu')?.intelCenter?.resonance?.diverge?.length >= 1, 'fu diverge attach');

const q0 = {
  version: 't',
  p0: [],
  p0Count: 0,
  deepQueue: [],
  all: [],
  quietDay: true,
};
const q1 = enrichQuestionQueueWithResonance(q0, board);
assert(q1.resonanceInjected >= 1, `injected ${q1.resonanceInjected}`);
assert(q1.all.some((x) => x.priority === 'P3'), 'P3 present');

// live pack（小样本）
const sample = [
  { id: 'sc', name: '原油', changePct: -1.2, direction: 'bearish' },
  { id: 'fu', name: '燃油', changePct: -0.3, direction: 'bearish' },
  { id: 'cu', name: '沪铜', changePct: 0.2, direction: 'flat' },
  { id: 'al', name: '沪铝', changePct: 0.1, direction: 'flat' },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.73'), pack.version);
assert(pack.resonanceBoard?.display, pack.resonanceBoard?.display);
assert(pack.faceViews?.research?.resonanceBoard, 'research face resonance');
assert(pack.shockGraph, 'shock present');

// 真冲击图冒烟（可能无激活边，不得崩）
const liveShock = buildShockGraph(withIntel, 'neutral', { asOf: '2026-07-16', persist: false, skipSnapshot: true });
const liveBoard = buildResonanceBoard(liveShock, withIntel, { asOf: '2026-07-16' });
assert(liveBoard.version, liveBoard.display);
assert(typeof liveBoard.counts.pending === 'number', 'pending count');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · wave-k resonance'));
process.exit(fails ? 1 : 0);
