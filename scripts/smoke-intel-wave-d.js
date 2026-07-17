#!/usr/bin/env node
/** Smoke: anti-manip gates + research compile + face attention */
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
  detectManipulationSignals,
  applyManipulationToEvidence,
  manipulationGateChecks,
} = require('../services/intel-anti-manipulation');
const { evaluatePublishGate } = require('../services/intel-publish-gates');
const { compileResearchRelease, buildReleaseId, collectModelVersions } = require('../services/intel-research-compile');
const { allocateFromTriage, allocateForFaces, FACE_ATTENTION_POLICY } = require('../services/intel-attention-budget');
const {
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
  ORCHESTRATOR_VERSION,
} = require('../services/intel-orchestrator');
const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');

assert(ORCHESTRATOR_VERSION.includes('2.66'), `orch ${ORCHESTRATOR_VERSION}`);

const signals = detectManipulationSignals(
  { id: 'sc' },
  {
    annotations: [{ annotationType: 'manipulation_risk', reason: '异常成交叙事' }],
    reliabilityTargets: { news: { delta: -0.35, n: 1 } },
  }
);
assert(signals.flagged === true, 'manip flagged');
assert(signals.blockInterrupt === true, 'block interrupt');

const ev = applyManipulationToEvidence(
  [{ summary: '新闻冲击', evidenceType: 'news', hardness: 0.8, dataSource: 'news' }],
  signals
);
assert(ev[0].hardness <= 0.4, `hardness capped ${ev[0].hardness}`);
assert(ev[0].manipulationNote, 'manip note');

const gate = evaluatePublishGate(
  { id: 'sc', dataQuality: 5 },
  {
    evidenceFor: [{ summary: 'x' }, { summary: 'y' }],
    evidenceAgainst: [{ summary: 'z' }],
    triggers: [{ type: 'falsify' }],
    validUntil: '2026-08-01',
    confidence: '弱结构',
    n: 25,
    nDisplay: '25',
    status: 'active',
  },
  { nextCheckpoint: '2026-07-20' },
  { state: 'mispriced' },
  'interrupt',
  { analyst: { manipulationRisk: true }, antiManipulation: signals }
);
assert(gate.pass === false, 'interrupt blocked by manip');
assert(gate.blockedReasons.some((r) => /操纵/.test(r)), `reasons ${gate.blockedReasons.join(',')}`);

const versions = collectModelVersions({ orchestrator: ORCHESTRATOR_VERSION });
assert(versions.antiManip, 'antiManip ver');
assert(versions.compile, 'compile ver');
const rid = buildReleaseId('2026-07-16', 'intel-pack', versions);
assert(rid.startsWith('rel-2026-07-16-'), rid);

const sample = [
  { id: 'sc', name: '原油', changePct: -3, intelCenter: { primaryClaim: { status: 'falsifying' }, pricingState: { state: 'mispriced' } } },
  { id: 'cu', name: '沪铜', changePct: 0.1 },
  { id: 'rb', name: '螺纹', changePct: 0 },
  { id: 'a', name: '豆一', changePct: 0.2 },
  { id: 'jd', name: '鸡蛋', changePct: 0 },
  { id: 'm', name: '豆粕', changePct: -0.5 },
  { id: 'y', name: '豆油', changePct: 0 },
  { id: 'p', name: '棕榈', changePct: 0 },
  { id: 'i', name: '铁矿', changePct: -1 },
  { id: 'j', name: '焦炭', changePct: 0 },
  { id: 'jm', name: '焦煤', changePct: 0 },
  { id: 'hc', name: '热卷', changePct: 0 },
  { id: 'ag', name: '白银', changePct: 0.3 },
  { id: 'au', name: '黄金', changePct: 0 },
  { id: 'al', name: '沪铝', changePct: 0 },
];
const faces = allocateForFaces(sample, { asOf: '2026-07-16' });
assert(faces.byFace.research.deepSlots > faces.byFace.execution.deepSlots, 'research deeper than exec');
assert(faces.byFace.execution.deepSlots === FACE_ATTENTION_POLICY.execution.deepSlots, 'exec slots');
assert(faces.byFace.decision.deepCount <= 10, `decision deep ${faces.byFace.decision.deepCount}`);
const execBudget = allocateFromTriage(sample, { faceId: 'execution', asOf: '2026-07-16' });
assert(execBudget.byId.sc.computeMode === 'full', 'falsifying gets full under exec');
console.log('OK face attn', faces.display);

const src = getCachedCommodityOutlookSource();
const slice = (src?.instruments || []).slice(0, 18);
const applied = applyIntelCenterToInstruments(slice, { persist: false, asOf: '2026-07-16', faceId: 'decision' });
const pack = buildIntelCenterPack(applied, { asOf: '2026-07-16', persist: false });
assert(pack.version.includes('2.66'), pack.version);
assert(pack.researchCompile?.releaseId, pack.researchCompile?.releaseId);
assert(pack.attentionByFace?.byFace?.execution?.deepSlots < pack.attentionByFace?.byFace?.research?.deepSlots, 'pack face slots');
assert(pack.faceViews?.execution?.attentionBudget?.faceId === 'execution', 'faceView attn');
assert(pack.faceViews?.research?.attentionBudget?.deepCount >= pack.faceViews?.execution?.attentionBudget?.deepCount, 'research deep >= exec');

const compiled = compileResearchRelease(pack, applied, { asOf: '2026-07-16', orchestratorVersion: ORCHESTRATOR_VERSION, persist: false });
assert(compiled.releaseId === pack.researchCompile.releaseId || compiled.version, compiled.releaseId);
console.log('OK compile', pack.researchCompile.display);

try {
  const outlook = getCachedCommodityOutlookSource();
  if (outlook) {
    hydrateIntelCenterOnOutlook(outlook, { force: true, persist: false });
    console.log('OK force hydrate');
  }
} catch (err) {
  console.warn('WARN hydrate', err.message);
}

const manipCheck = manipulationGateChecks(
  { evidenceFor: [{ evidenceType: 'news', hardness: 0.2 }] },
  { vetoed: false },
  { flagged: false },
  'interrupt'
);
assert(manipCheck.pass === false, 'low news hardness fails interrupt');

if (fails) {
  console.error(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-wave-d');
