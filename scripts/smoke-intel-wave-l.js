#!/usr/bin/env node
/** Smoke: process correctness OS (v2.74) */
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
  PROCESS_VERSION,
  assessLiveProcessReadiness,
  buildProcessScorecard,
  scoreProcessCorrect,
  attachProcessReadinessToInstruments,
} = require('../services/intel-process-learning');
const { TEACH_VERSION, buildTeachingPack } = require('../services/intel-teaching');
const { KPI_VERSION, computeKpis } = require('../services/intel-kpi');
const {
  ORCHESTRATOR_VERSION,
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.74'), ORCHESTRATOR_VERSION);
assert(PROCESS_VERSION.includes('process-os'), PROCESS_VERSION);
assert(TEACH_VERSION.includes('2.74'), TEACH_VERSION);
assert(KPI_VERSION.includes('process-os'), KPI_VERSION);

const readyInst = {
  id: 'cu',
  name: '沪铜',
  intelCenter: {
    primaryClaim: {
      side: 'bear',
      status: 'active',
      n: 40,
      evidenceAgainst: [{ summary: '资金对侧' }],
      triggers: [{ type: 'falsify', condition: '合证翻转' }],
    },
    unknownMap: { hasCritical: false, blocksPublish: false },
    choiceSet: { primaryId: 'A' },
  },
};
const ready = assessLiveProcessReadiness(readyInst);
assert(ready.processReady, ready.display);
assert(ready.band === '过程就绪', ready.band);

const weakInst = {
  id: 'x',
  name: '弱',
  intelCenter: {
    primaryClaim: { status: 'active', n: 5, evidenceAgainst: [], triggers: [] },
    unknownMap: { hasCritical: true, blocksPublish: true },
  },
};
const weak = assessLiveProcessReadiness(weakInst);
assert(!weak.processReady, weak.display);
assert(weak.checks.some((c) => !c.ok), 'has failing checks');

const procSnap = scoreProcessCorrect({
  hadDissent: true,
  hadTriggers: true,
  n: 20,
});
assert(procSnap.processCorrect, 'archive process ok');

const report = {
  directionHit: '50.0% (10/20)',
  processCorrect: '70.0% (14/20)',
  bothGood: 8,
  dirWrongProcessRight: 3,
  dirWrongProcessRightDisplay: '3/20 方向错但过程对',
  sampleN: 20,
  horizonDays: 3,
  rows: [
    {
      scored: true,
      directionHit: false,
      processCorrect: true,
      claimId: 'c1',
      instrumentId: 'cu',
      asOf: '2026-07-10',
      forwardPct: 1.2,
      n: 40,
      stateKey: 'test',
    },
    {
      scored: true,
      directionHit: true,
      processCorrect: false,
      claimId: 'c2',
      instrumentId: 'sc',
      asOf: '2026-07-11',
      forwardPct: -0.5,
      n: 10,
    },
  ],
};
const attached = attachProcessReadinessToInstruments([readyInst, weakInst]);
const card = buildProcessScorecard(report, attached, {
  byStateKey: {
    test: {
      available: true,
      n: 25,
      nDisplay: '25',
      multiplier: 1.08,
      processDisplay: '68% (17/25)',
      dirHitDisplay: '52% (13/25)',
    },
  },
});
assert(card.live.readyN === 1, `readyN ${card.live.readyN}`);
assert(card.outcome.rows.some((r) => r.tag === 'dir_miss_proc_ok'), 'tag dir_miss_proc_ok');
assert(card.outcome.rows.some((r) => r.tag === 'dir_hit_proc_bad'), 'tag dir_hit_proc_bad');
assert(card.weightNudges.length === 1, 'weight nudge');
assert(card.notReady.length >= 1, 'notReady');
assert(/过程OS/.test(card.display), card.display);

const teach = buildTeachingPack({
  processScorecard: card,
  resonanceBoard: { counts: { diverge: 1, lagging: 0 } },
  unknownBoard: { totalGaps: 2 },
  shockActive: 1,
});
assert(teach.lessons.some((l) => l.id === 'resonance' || l.id === 'process_ready' || l.id === 'unknown_map'), 'new lessons');

const kpis = computeKpis(attached, { processScorecard: card, processLearning: report, dailyDiff: { available: true } });
assert(kpis.processCorrectness.readyCoverage, kpis.processCorrectness.readyCoverage);
assert(/就绪/.test(kpis.display), kpis.display);

const sample = [
  { id: 'sc', name: '原油', direction: 'bearish', changePct: -1 },
  { id: 'cu', name: '沪铜', direction: 'bearish', changePct: -0.5 },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.74'), pack.version);
assert(pack.processScorecard?.display, pack.processScorecard?.display);
assert(pack.faceViews?.research?.processScorecard, 'research scorecard');
assert(withIntel.some((i) => i.intelCenter?.processReadiness) || pack.stats?.processReady, 'readiness wired');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · wave-l process-os'));
process.exit(fails ? 1 : 0);
