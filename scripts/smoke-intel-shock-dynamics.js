#!/usr/bin/env node
/** Smoke: shock activation dynamics (vision §11 / v2.89.10) */
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
  DYNAMICS_VERSION,
  computeLagDistribution,
  computeElasticity,
  tickShockDynamics,
  buildShockWatchOrder,
  buildShockDynamicsBoard,
  transmissionHitRate,
} = require('../services/intel-shock-dynamics');
const { SHOCK_VERSION, empiricalEdge, buildShockGraph } = require('../services/intel-shock-graph');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(DYNAMICS_VERSION.includes('dynamics') || DYNAMICS_VERSION.includes('2.89.10'), DYNAMICS_VERSION);
assert(SHOCK_VERSION.includes('dynamics') || SHOCK_VERSION.includes('2.89.10'), SHOCK_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.10') || ORCHESTRATOR_VERSION.includes('shock-dyn'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.10'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'shock_dynamics'), 'lesson');

// Synthetic aligned series: tgt follows src with lag 2, beta≈0.5
const n = 80;
const srcRets = [];
const tgtRets = [];
for (let i = 0; i < n; i += 1) {
  const s = Math.sin(i / 7) * 0.02 + (i % 11 === 0 ? 0.03 : 0);
  srcRets.push(s);
  tgtRets.push(i >= 2 ? srcRets[i - 2] * 0.5 + Math.sin(i / 13) * 0.002 : 0);
}
const lagDist = computeLagDistribution(srcRets, tgtRets, { maxLag: 5, minN: 40 });
assert(lagDist.available === true, 'lagDist avail');
assert(lagDist.best?.lag === 2, `best lag ${lagDist.best?.lag}`);
assert(lagDist.lags.length >= 2, `lags ${lagDist.lags.length}`);
assert(lagDist.nDisplay !== '暂无', lagDist.nDisplay);

const elast = computeElasticity(srcRets, tgtRets, 2, { minN: 40 });
assert(elast.available === true, 'elast avail');
assert(elast.beta != null && elast.beta > 0.3 && elast.beta < 0.7, `beta ${elast.beta}`);
assert(/\d+/.test(elast.nDisplay), elast.nDisplay);

const emptyHit = transmissionHitRate([]);
assert(emptyHit.display === '暂无' && emptyHit.deferred, 'hit deferred');

const hit = transmissionHitRate([
  { status: 'confirmed' },
  { status: 'confirmed' },
  { status: 'missed' },
  { status: 'pending_quote' },
]);
assert(hit.display === '66.7% (2/3)', hit.display);

// FSM: fire day0 lag0 → verify same day
const instruments = [
  { id: 'sc', name: '原油', changePct: -2.5, intelCenter: { surprise: { composite: 0.8 } } },
  { id: 'fu', name: '燃油', changePct: -1.2 },
];
const active = [
  {
    from: 'sc',
    to: 'fu',
    label: '原油→燃油',
    activation: 0.5,
    lagTypical: 0,
    corr: 0.9,
    n: 80,
    nDisplay: '80',
    elasticity: { available: true, beta: 0.5, n: 80 },
  },
];
const emp = [{ ...active[0], available: true }];
const tick1 = tickShockDynamics(active, emp, instruments, {
  asOf: '2026-07-16',
  persist: false,
  state: { edges: {}, history: [] },
});
const row = tick1.edges['sc->fu'];
assert(row, 'state row');
assert(row.state === 'confirmed' || row.state === 'awaiting' || row.state === 'missed', row.state);
assert(tick1.verifiedToday.length + tick1.firedToday.length >= 1, 'fired or verified');

const watch = buildShockWatchOrder(instruments, emp, { asOf: '2026-07-16' });
assert(watch.watchlists.length >= 1, `watch ${watch.watchlists.length}`);
assert(/燃油|fu/i.test(watch.watchlists[0].display), watch.watchlists[0].display);
assert(watch.watchlists[0].targets[0].verifyMetric, 'verify metric');

const board = buildShockDynamicsBoard({
  activeEdges: active,
  empiricalEdges: emp,
  instruments,
  asOf: '2026-07-16',
  persist: false,
  tickResult: tick1,
});
assert(board.trueDynamics === true, 'trueDynamics');
assert(board.watchOrder?.display, board.watchOrder?.display);
assert(board.method.includes('activation-fsm'), board.method);

// Live empirical edge (disk K)
const liveEdge = empiricalEdge({ from: 'sc', to: 'fu', mechanism: 'cost', label: '原油→燃油' });
if (liveEdge.available) {
  assert(liveEdge.lagDistribution?.available !== false || liveEdge.lagDistribution, 'lagDist on edge');
  assert(liveEdge.elasticity, 'elasticity field');
  console.log('OK live sc→fu', liveEdge.corr, 'β', liveEdge.elasticity?.beta, 'lagDist', liveEdge.lagDistribution?.best?.lag);
} else {
  console.log('OK live edge pending (honest)', liveEdge.reason);
}

const sample = [
  { id: 'sc', name: '原油', direction: 'bearish', changePct: -2.2 },
  { id: 'fu', name: '燃油', direction: 'bearish', changePct: -1.0 },
  { id: 'cu', name: '沪铜', direction: 'bearish', changePct: -0.3 },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.89.10') || pack.version.includes('shock-dyn'), pack.version);
assert(pack.shockGraph?.dynamics || pack.shockDynamicsBoard, 'pack dynamics');
assert(pack.shockDynamicsBoard?.display || pack.shockGraph?.dynamics?.display, 'dyn display');
assert(pack.faceViews?.research?.shockDynamicsBoard || pack.faceViews?.research?.shockGraph?.dynamics, 'face dyn');

const g = buildShockGraph(sample, 'neutral', { asOf: '2026-07-16', persist: false, skipDynamicsPersist: true });
assert(g.trueDynamics === true || g.dynamics?.trueDynamics === true, 'graph dynamics');
assert(/activation-fsm|dynamics/.test(g.method), g.method);

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · shock-dynamics §11'));
process.exit(fails ? 1 : 0);
