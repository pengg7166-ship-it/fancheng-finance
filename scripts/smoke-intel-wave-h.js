#!/usr/bin/env node
/** Smoke: face promote → true full recompute + paradigm expand (v2.70) */
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
  buildClaimsFromInstrument,
  shouldEmitParadigmClaim,
  CLAIM_VERSION,
} = require('../services/intel-claim-library');
const { retriageForFace, allocateFromTriage } = require('../services/intel-attention-budget');
const {
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
  applyPromoteFullEvaluations,
  slimOverlayForPack,
  stripIntelPackForDisk,
  ORCHESTRATOR_VERSION,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.70'), `orch ${ORCHESTRATOR_VERSION}`);
assert(CLAIM_VERSION.includes('paradigm-expand'), CLAIM_VERSION);

// —— paradigm：无真实信号不发 ——
const noPara = shouldEmitParadigmClaim({ id: 'x', direction: 'flat' });
assert(!noPara.emit, 'no paradigm without signal');

const dualPara = shouldEmitParadigmClaim({
  id: 'cu',
  dualNarrative: { regime: 'split' },
});
assert(dualPara.emit && dualPara.reason === 'dualNarrative.split', dualPara.reason);

const claimsWithPara = buildClaimsFromInstrument(
  {
    id: 'sc',
    name: '原油',
    direction: 'bearish',
    dualNarrative: { regime: 'split' },
    factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '累库', sampleN: 20 } } },
  },
  '2026-07-16'
);
assert(claimsWithPara.some((c) => c.horizon === 'paradigm'), 'paradigm claim emitted');
assert(claimsWithPara.find((c) => c.horizon === 'paradigm')?.paradigmEmitReason, 'paradigmEmitReason');

const claimsNoPara = buildClaimsFromInstrument(
  {
    id: 'rb',
    name: '螺纹',
    direction: 'flat',
    outlookPending: true,
  },
  '2026-07-16'
);
assert(!claimsNoPara.some((c) => c.horizon === 'paradigm'), 'no fake paradigm');

// —— promote full ——
const sample = [
  {
    id: 'sc',
    name: '原油',
    changePct: -2.5,
    direction: 'bearish',
    intelCenter: { attention: { computeMode: 'lite' }, primaryClaim: { claimId: 'claim-sc-structural', status: 'active' } },
  },
  {
    id: 'cu',
    name: '沪铜',
    changePct: 0.2,
    direction: 'flat',
    intelCenter: { attention: { computeMode: 'skip' } },
  },
  {
    id: 'rb',
    name: '螺纹',
    changePct: 0,
    intelCenter: { attention: { computeMode: 'full' }, primaryClaim: { claimId: 'claim-rb-structural', status: 'active' } },
  },
];

const budget = allocateFromTriage(sample, { asOf: '2026-07-16', faceId: 'decision' });
const rt = retriageForFace(sample, 'execution', { asOf: '2026-07-16', currentBudget: budget });
assert(rt.method || rt.display, `retriage ${rt.display}`);

const applied = applyPromoteFullEvaluations(sample, { ...rt, faceId: 'execution' }, {
  asOf: '2026-07-16',
  persist: false,
  maxPromote: 4,
});
assert(applied.method === 'face-promote-full', applied.method);
assert(applied.trueRationing === true, 'trueRationing');
assert(!/全市场重算|三遍/.test(applied.display) || /非全市场/.test(applied.display), applied.display);
console.log('OK promote', applied.display, 'ids', applied.promotedIds);

// 强制升档路径：真补跑 full
const forced = applyPromoteFullEvaluations(
  [{ id: 'sc', name: '原油', changePct: -3, direction: 'bearish', intelCenter: { attention: { computeMode: 'skip' } } }],
  { faceId: 'execution', promote: [{ instrumentId: 'sc', instrumentName: '原油', from: 'skip', to: 'full' }] },
  { asOf: '2026-07-16', persist: false, maxPromote: 2 }
);
assert(forced.appliedCount === 1, `forced applied ${forced.appliedCount}`);
assert(forced.overlays.sc?.attention?.computeMode === 'full', 'forced full mode');
assert(/face-promote/.test(forced.overlays.sc?.method || ''), forced.overlays.sc?.method);
assert(/非全市场/.test(forced.display), forced.display);

if (applied.promotedIds.length) {
  const slim = slimOverlayForPack(applied.overlays[applied.promotedIds[0]]);
  assert(slim?.attention?.computeMode === 'full' || slim?.reusedFull, 'slim full/reused');
}

// —— pack wiring（小样本，persist false）——
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.70'), pack.version);
assert(pack.facePromoteFull?.method === 'face-promote-full', 'facePromoteFull');
assert(pack.faceViews?.execution?.faceRetriage?.appliedFull, 'execution appliedFull');
assert(pack.faceViews?.decision?.faceRetriage?.appliedFull?.appliedCount === 0, 'decision no promote');

const stripped = stripIntelPackForDisk(pack);
assert(!stripped._faceFullOverlays, 'strip full overlays');
assert(stripped.facePromoteFull?.overlays || stripped.facePromoteFull?.method, 'slim kept');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · wave-h promote-full + paradigm'));
process.exit(fails ? 1 : 0);
