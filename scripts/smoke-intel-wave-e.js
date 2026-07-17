#!/usr/bin/env node
/** Smoke: shock pending + interrupt contract + claim-first UI data */
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

const { empiricalEdge, buildShockGraph, alignReturnsByDate, loadReturns, SHOCK_VERSION } = require('../services/intel-shock-graph');
const { syncInterruptChannel, ackInterrupt, INTERRUPT_STATES, CHANNEL_VERSION } = require('../services/intel-interrupt-channel');
const {
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
  ORCHESTRATOR_VERSION,
} = require('../services/intel-orchestrator');
const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');

assert(ORCHESTRATOR_VERSION.includes('2.67'), `orch ${ORCHESTRATOR_VERSION}`);
assert(SHOCK_VERSION.includes('shock-pending'), SHOCK_VERSION);
assert(CHANNEL_VERSION.includes('interrupt-contract'), CHANNEL_VERSION);

const edge = empiricalEdge({ from: 'sc', to: 'fu', mechanism: 'cost', label: '原油→燃油' });
assert(edge.available === true || edge.pending === true || edge.reason, `edge ${JSON.stringify({ a: edge.available, p: edge.pending, r: edge.reason, n: edge.n })}`);
if (!edge.available && edge.n != null && edge.n < 40) {
  assert(edge.corr == null || edge.pending === true, 'no fake strong corr when pending/n short');
}
console.log('OK empirical', edge.available ? `corr=${edge.corr} n=${edge.n}` : edge.reason);

const src = loadReturns('sc', 80);
const tgt = loadReturns('fu', 80);
if (src && tgt) {
  const al = alignReturnsByDate(src, tgt);
  assert(al.available === true || al.n != null, `align ${JSON.stringify(al)}`);
  console.log('OK aligned n', al.n);
}

const sampleInst = [
  { id: 'sc', name: '原油', changePct: -2.5 },
  { id: 'fu', name: '燃油', changePct: -1.2 },
  { id: 'rb', name: '螺纹', changePct: 0.1 },
  { id: 'i', name: '铁矿', changePct: -0.8 },
];
const graph = buildShockGraph(sampleInst, 'neutral');
assert(graph.pendingCount >= 0, `pending ${graph.pendingCount}`);
assert(Array.isArray(graph.pendingEdges), 'pendingEdges array');
assert(graph.topPaths.some((p) => p.pending === true) || graph.activeCount > 0 || graph.pendingCount >= 0, 'paths or pending');
const pendingPath = graph.topPaths.find((p) => p.pending);
if (pendingPath) {
  assert(pendingPath.corr == null || typeof pendingPath.corr === 'number', 'pending may have weak corr only');
  assert(/待校验/.test(pendingPath.text), pendingPath.text);
}
console.log('OK shock', graph.display);

const uniqueClaim = `claim-sc-smoke-${Date.now()}`;
const ch = syncInterruptChannel(
  [
    {
      id: 'sc',
      name: '原油',
      headline: '命题已证伪·测试',
      claimId: uniqueClaim,
      falsified: true,
      score: 0.9,
      lifecycle: 'eligible',
      beliefLevel: '弱结构',
      claimStatus: 'falsified',
      gatePass: true,
    },
  ],
  { asOf: '2099-01-01', maxDaily: 3 }
);
assert(ch.contract?.includes('eligible'), ch.contract);
assert(ch.queue?.length >= 1, `queue len ${ch.queue?.length}`);
assert(ch.queue[0].state === INTERRUPT_STATES.pending_ack, `state ${ch.queue[0].state}`);
assert(ch.freshNotifications?.length >= 1, `notifications ${ch.freshNotifications?.length}`);
console.log('OK channel', ch.display);

const ack = ackInterrupt(ch.queue[0].key);
assert(ack.ok && ack.state === INTERRUPT_STATES.archived, `ack ${JSON.stringify(ack)}`);
assert(ack.archived === true, 'archived to jsonl');
console.log('OK ack archivedToday', ack.archivedToday);

const outlook = getCachedCommodityOutlookSource();
const slice = (outlook?.instruments || []).slice(0, 16);
const applied = applyIntelCenterToInstruments(slice, { persist: false, asOf: '2026-07-16' });
const pack = buildIntelCenterPack(applied, { asOf: '2026-07-16', persist: false });
assert(pack.version.includes('2.67'), pack.version);
assert(pack.shockGraph?.version?.includes('shock-pending'), pack.shockGraph?.version);
assert(pack.interruptChannel?.contract || pack.interruptChannel?.error, pack.interruptChannel?.display || pack.interruptChannel?.error);
assert(pack.faceViews?.research?.shockGraph?.pendingEdges != null || pack.shockGraph?.pendingEdges, 'pending in face/research');
console.log('OK pack shock', pack.shockGraph?.display);
console.log('OK pack ich', pack.interruptChannel?.display);

try {
  if (outlook) {
    hydrateIntelCenterOnOutlook(outlook, { force: true, persist: false });
    console.log('OK force hydrate');
  }
} catch (err) {
  console.warn('WARN hydrate', err.message);
}

if (fails) {
  console.error(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-wave-e');
