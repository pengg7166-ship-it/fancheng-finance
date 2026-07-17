#!/usr/bin/env node
/** Smoke: true attention + live shock + sharp claims + process learn + interrupt channel */
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

const { allocateFromTriage } = require('../services/intel-attention-budget');
const { empiricalEdge, buildShockGraph } = require('../services/intel-shock-graph');
const { buildClaimsFromInstrument, pickPrimaryClaim } = require('../services/intel-claim-library');
const { evaluateArchivedClaims } = require('../services/intel-process-learning');
const { syncInterruptChannel, ackInterrupt } = require('../services/intel-interrupt-channel');
const { applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');

const sample = [
  { id: 'sc', name: '原油', changePct: -2.5, sector: 'energy' },
  { id: 'cu', name: '沪铜', changePct: 0.2, sector: 'metals' },
  { id: 'rb', name: '螺纹', changePct: -0.1, sector: 'black' },
  { id: 'a', name: '豆一', changePct: 0.05, sector: 'agriculture' },
  { id: 'jd', name: '鸡蛋', changePct: 0, sector: 'agriculture' },
];
const budget = allocateFromTriage(sample, { deepSlots: 2, shallowSlots: 2 });
assert(budget.trueRationing === true, 'trueRationing');
assert(budget.byId.sc.computeMode === 'full', `sc mode ${budget.byId.sc.computeMode}`);
assert(budget.deepCount === 2, `deep ${budget.deepCount}`);

const edge = empiricalEdge({ from: 'sc', to: 'fu', mechanism: 'cost', label: '原油→燃油' });
assert(edge.available === true || edge.reason, `empirical ${JSON.stringify({ avail: edge.available, corr: edge.corr, n: edge.n, reason: edge.reason })}`);

const claims = buildClaimsFromInstrument(
  {
    id: 'cu',
    name: '沪铜',
    direction: 'bearish',
    factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '累库+增仓', primaryRegime: 'build_oi_up', structureBias: 'bear' } } },
    basis: { available: true, structure: 'backwardation' },
    dualNarrative: { regime: 'split', regimeLabel: '内外分裂' },
  },
  '2026-07-16'
);
const primary = pickPrimaryClaim(claims);
assert(primary?.issueId, `issueId ${primary?.issueId}`);
assert(/证伪|否则/.test(primary.statement), `sharp stmt ${primary.statement.slice(0, 80)}`);
assert(primary.falsifiable === true, 'falsifiable');

const proc = evaluateArchivedClaims({ horizonDays: 3, limit: 30, persist: true });
assert(proc.version.includes('process-learn'), proc.version);
console.log('OK process', proc.directionHit, proc.processCorrect, proc.dirWrongProcessRightDisplay);

const ch = syncInterruptChannel(
  [{ id: 'sc', name: '原油', headline: '命题已证伪·测试', claimId: 'claim-sc-structural', falsified: true, score: 0.9 }],
  { asOf: '2026-07-16', maxDaily: 3 }
);
assert(ch.freshNotifications?.length >= 0, `notifications ${ch.freshNotifications?.length}`);
if (ch.queue?.[0]?.key) {
  const ack = ackInterrupt(ch.queue[0].key);
  assert(ack.ok, 'ack ok');
}

const src = getCachedCommodityOutlookSource();
const slice = (src?.instruments || []).slice(0, 20);
const applied = applyIntelCenterToInstruments(slice, { persist: false, asOf: '2026-07-16' });
const modes = { full: 0, lite: 0, skip: 0 };
for (const i of applied) {
  const m = i.intelCenter?.attention?.computeMode || 'full';
  modes[m] = (modes[m] || 0) + 1;
}
assert(modes.full <= 12, `full compute capped ${modes.full}`);
assert(modes.skip + modes.lite + modes.full === applied.length, `modes ${JSON.stringify(modes)}`);
console.log('OK compute modes', modes);

const shock = buildShockGraph(applied.slice(0, 15), 'neutral');
assert(shock.method.includes('empirical'), shock.method);
console.log('OK shock', shock.activeCount, 'active /', shock.empiricalPass, 'empirical pass');

const out = hydrateIntelCenterOnOutlook(src, { persist: true, force: true });
assert(out.intelCenterPack?.version?.includes('true-depth') || out.intelCenterPack?.interruptChannel, `pack ${out.intelCenterPack?.version}`);
console.log('OK pack', out.intelCenterPack?.version, out.intelCenterPack?.attentionBudget?.display);
console.log('OK stats', JSON.stringify({
  full: out.intelCenterPack?.stats?.fullCompute,
  lite: out.intelCenterPack?.stats?.liteCompute,
  skip: out.intelCenterPack?.stats?.skipCompute,
  process: out.intelCenterPack?.processLearning?.processCorrect,
  ich: out.intelCenterPack?.interruptChannel?.display,
}));

if (fails) {
  console.error(`FAILED ${fails}`);
  process.exit(1);
}
console.log('PASS: depth-five smoke');
process.exit(0);
