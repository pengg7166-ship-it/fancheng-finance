#!/usr/bin/env node
/** Smoke: multi-hop shock paths (v2.77) */
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
  MULTIHOP_VERSION,
  buildMultiHopBoard,
  enrichQuestionQueueWithMultiHop,
} = require('../services/intel-shock-multihop');
const { SHOCK_VERSION, buildShockGraph } = require('../services/intel-shock-graph');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.77'), ORCHESTRATOR_VERSION);
assert(MULTIHOP_VERSION.includes('multihop'), MULTIHOP_VERSION);
assert(SHOCK_VERSION.includes('multihop'), SHOCK_VERSION);

// Synthetic empirical edges forming jm→j→rb
const empirical = [
  {
    from: 'jm',
    to: 'j',
    label: '焦煤→焦炭',
    mechanism: 'cost',
    available: true,
    corr: 0.55,
    n: 60,
    lagTypical: 1,
  },
  {
    from: 'j',
    to: 'rb',
    label: '焦炭→螺纹',
    mechanism: 'cost',
    available: true,
    corr: 0.42,
    n: 55,
    lagTypical: 2,
  },
  {
    from: 'i',
    to: 'rb',
    label: '铁矿→螺纹',
    mechanism: 'cost',
    available: true,
    corr: 0.35,
    n: 50,
    lagTypical: 1,
  },
];

const instruments = [
  { id: 'jm', name: '焦煤', changePct: 2.1, intelCenter: {} },
  { id: 'j', name: '焦炭', changePct: 0.1, intelCenter: {} },
  { id: 'rb', name: '螺纹', changePct: 0.05, intelCenter: {} },
  { id: 'i', name: '铁矿', changePct: 0.2, intelCenter: {} },
];

const active = [
  {
    from: 'jm',
    to: 'j',
    label: '焦煤→焦炭',
    activation: 0.6,
    corr: 0.55,
    n: 60,
    lagTypical: 1,
  },
];

const board = buildMultiHopBoard(empirical, active, instruments, { asOf: '2026-07-16' });
assert(board.counts.total >= 1, `paths ${board.counts.total}`);
const p = board.paths.find((x) => x.from === 'jm' && x.via === 'j' && x.to === 'rb');
assert(p, 'jm→j→rb path');
assert(Math.abs(p.pathCorr - 0.55 * 0.42) < 0.001, `pathCorr ${p.pathCorr}`);
assert(p.pathN === 55, `min n ${p.pathN}`);
assert(p.pathLag === 3, `lag sum ${p.pathLag}`);
assert(p.status === 'partial', `status ${p.status}`);
assert(p.lagging, 'lagging mid/sink');
assert(/乘积|pathCorr/.test(p.note || board.note), board.note);

const q = enrichQuestionQueueWithMultiHop({ all: [], version: 't' }, board);
assert((q.multiHopInjected || 0) >= 1, `injected ${q.multiHopInjected}`);
assert(q.all.some((x) => /多跳/.test(x.question)), 'question text');

// Live pack — may or may not find real multi-hops depending on K data
const pack = buildIntelCenterPack(
  [
    { id: 'jm', name: '焦煤', changePct: 1.5 },
    { id: 'j', name: '焦炭', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'i', name: '铁矿', changePct: 0.3 },
    { id: 'sc', name: '原油', changePct: 0.5 },
    { id: 'fu', name: '燃油', changePct: 0.4 },
  ],
  { asOf: '2026-07-16', persist: false }
);
assert(pack.version.includes('2.77'), pack.version);
assert(pack.multiHopBoard?.version?.includes('multihop'), pack.multiHopBoard?.version || 'no mh');
assert(pack.shockGraph?.multiHop, 'shockGraph.multiHop');
assert(typeof pack.multiHopBoard.display === 'string', pack.multiHopBoard.display);
assert(pack.faceViews?.research?.multiHopBoard || pack.faceViews?.research?.shockGraph?.multiHop, 'research face mh');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-o multihop');
process.exit(fails ? 1 : 0);
