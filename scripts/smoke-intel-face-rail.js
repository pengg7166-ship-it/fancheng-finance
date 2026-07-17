#!/usr/bin/env node
/** Smoke: three-face delivery rail (vision §66 / v2.89.14) */
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
  FACE_CONTRACT_VERSION,
  applyFaceDeliveryContract,
  buildFaceContractBoard,
  projectInstrumentForFace,
} = require('../services/intel-face-contracts');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(FACE_CONTRACT_VERSION.includes('face-delivery') || FACE_CONTRACT_VERSION.includes('2.89.14'), FACE_CONTRACT_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.14') || ORCHESTRATOR_VERSION.includes('face-rail'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.14'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'face_delivery_rail'), 'lesson');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('activeFaceGrid'), 'hub activeFaceGrid');
assert(appSrc.includes('data-intel-face-rail'), 'hub face-rail attr');
assert(appSrc.includes('projectOutlookInstrumentForFace'), 'detail project');
assert(!/decisionGrid\}\s*\$\{researchGrid\}\s*\$\{execGrid\}/.test(appSrc), 'no triple CSS panels');

const basePack = {
  version: 'test',
  dailyDiff: { summary: '物质变更 2', materialChanges: 2 },
  questionQueue: {
    p0: [
      { instrumentId: 'rb', instrumentName: '螺纹', question: '合证是否翻转？' },
      { instrumentId: 'cu', instrumentName: '铜', question: '基差是否误定价？' },
      { instrumentId: 'sc', instrumentName: '原油', question: '叙事是否超前？' },
      { instrumentId: 'i', instrumentName: '铁矿', question: '普通观察问题' },
    ],
    p0Count: 4,
    deepQueue: [{ question: 'deep1' }, { question: 'deep2' }],
  },
  interrupts: [
    { instrumentId: 'rb', headline: '证伪进行中 · 合证翻转', falsifying: true },
    { instrumentId: 'cu', headline: '普通高 surprise' },
    { instrumentId: 'al', headline: '误定价背离 mispriced' },
  ],
  shockGraph: { display: '冲击 3 活边', topPaths: [{ text: 'a→b' }, { text: 'c→d' }], activeCount: 2 },
  playbookBoard: { display: '剧本板 覆盖10' },
  debtBoard: { display: '债务 5', weeklyMustPay: [{ instrumentId: 'rb' }] },
  museumBoard: { display: '博物馆' },
  mechanismBoard: { display: '机制' },
  teaching: { lessons: [{ id: 'a' }, { id: 'b' }] },
  processLearning: { directionHit: '48% (10/20)', processCorrect: '33% (8/24)', display: 'full' },
  pricingClockBoard: {
    display: '定价时钟',
    counts: { mispriced: 1 },
    mispriced: [{ state: 'mispriced', display: '铜误定价' }],
    rows: [
      { state: 'mispriced', display: '铜误定价' },
      { state: 'priced-in', display: '已定价' },
    ],
  },
  issueBoard: {
    display: '议题',
    falsifying: [{ instrumentId: 'rb', statement: '证伪中' }],
    open: [{ instrumentId: 'sc' }],
    issues: [{}, {}],
  },
  top5Candidates: [{ id: 'rb' }],
};

const decision = applyFaceDeliveryContract(basePack, 'decision');
assert(decision.faceContract.rail === true, 'decision rail');
assert(decision.deliveryBrief?.headline, decision.deliveryBrief?.headline);
assert(decision.questionQueue.p0.length <= 3, decision.questionQueue.p0.length);
assert(decision.playbookBoard == null, 'decision no playbook');
assert(decision.mechanismBoard == null, 'decision no mechanism');
assert((decision.faceContract.strippedBlocks || []).length > 0, 'decision stripped');

const research = applyFaceDeliveryContract(basePack, 'research');
assert(research.playbookBoard?.display, 'research playbook');
assert(research.shockGraph?.topPaths?.length >= 1, 'research shock');
assert(research.teaching?.lessons?.length >= 1, 'research teach');

const execution = applyFaceDeliveryContract(basePack, 'execution');
assert(execution.deliveryBrief?.deliveryContract.includes('falsify'), execution.deliveryBrief?.deliveryContract);
assert(execution.interrupts.every((i) => /证伪|误定价|falsif|mispriced/i.test(i.headline || '') || i.falsifying), 'exec interrupts');
assert(execution.playbookBoard == null, 'exec no playbook');
assert(execution.shockGraph == null, 'exec no shock');
assert(execution.issueBoard?.faceFilter === 'falsifying-only', execution.issueBoard?.faceFilter);
assert(
  (execution.questionQueue.p0 || []).every((q) => /证伪|翻转|误定价|falsif|mispriced|时钟|到期|触发/i.test(q.question)),
  'exec p0 filtered'
);

const faceViews = {
  decision: { faceContract: decision.faceContract, deliveryBrief: decision.deliveryBrief, questionQueue: decision.questionQueue, interrupts: decision.interrupts, playbookBoard: decision.playbookBoard, shockGraph: decision.shockGraph, debtBoard: decision.debtBoard },
  research: { faceContract: research.faceContract, deliveryBrief: research.deliveryBrief, questionQueue: research.questionQueue, interrupts: research.interrupts, playbookBoard: research.playbookBoard, shockGraph: research.shockGraph, debtBoard: research.debtBoard },
  execution: { faceContract: execution.faceContract, deliveryBrief: execution.deliveryBrief, questionQueue: execution.questionQueue, interrupts: execution.interrupts, playbookBoard: execution.playbookBoard, shockGraph: execution.shockGraph, debtBoard: execution.debtBoard },
};
const board = buildFaceContractBoard(faceViews, { asOf: '2026-07-16' });
assert(board.contractOk === true, board.display);
assert(/分轨/.test(board.display), board.display);
assert(board.divergence.blocksDiffer || board.divergence.p0Differ, board.divergence);

const inst = {
  id: 'rb',
  name: '螺纹',
  intelCenter: {
    primaryClaim: {
      claimId: 'c1',
      statement: '累库压制',
      status: 'active',
      triggers: [{ condition: '合证翻转' }],
      validUntil: '2026-07-26',
      nDisplay: '40',
    },
    memo: { available: true, headline: '累库压制', oppose: [{ summary: '去库风险' }], triggers: ['翻转'] },
    scenarioLattice: { display: '场景', scenarios: [{ id: 'base' }], nDisplay: '40', weightsCalibrated: true },
    redTeam: { available: true, display: '红队', arguments: [{ summary: 'x' }] },
    surprise: { nDisplay: '50', bucket: 'high', composite: 0.8 },
  },
};
const execInst = projectInstrumentForFace(inst, 'execution');
assert(execInst.intelCenter.scenarioLattice == null, 'exec strip scenario');
assert(execInst.intelCenter.redTeam == null, 'exec strip red');
assert(execInst.intelCenter.faceProjection?.mode === 'triggers-only', execInst.intelCenter.faceProjection);
assert(execInst.intelCenter.primaryClaim?.triggers?.length >= 1, 'exec keep triggers');

const decInst = projectInstrumentForFace(inst, 'decision');
assert(decInst.intelCenter.scenarioLattice?.truncatedByFace === true, 'decision truncate scenario');
assert(decInst.intelCenter.faceProjection?.mode === 'memo-first', 'decision memo-first');

const sample = [
  { id: 'rb', name: '螺纹', direction: 'bearish', changePct: -1, sector: 'ferrous' },
  { id: 'cu', name: '铜', direction: 'bullish', changePct: 1, sector: 'base_metal' },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.89.14') || pack.version.includes('face-rail'), pack.version);
assert(pack.faceContractBoard?.display, pack.faceContractBoard?.display);
assert(pack.faceViews?.decision?.deliveryBrief?.headline, pack.faceViews.decision.deliveryBrief);
assert(pack.faceViews?.execution?.deliveryBrief?.deliveryContract, pack.faceViews.execution.deliveryBrief);
assert(pack.faceViews?.decision?.faceContract?.strippedBlocks?.length > 0, 'live decision stripped');
assert(pack.faceViews?.research?.playbookBoard || pack.faceViews?.research?.shockGraph, 'research has depth board');
assert(pack.stats?.faceRailOk === 1 || pack.faceContractBoard?.contractOk, 'faceRailOk');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · face-rail §66'));
process.exit(fails ? 1 : 0);
