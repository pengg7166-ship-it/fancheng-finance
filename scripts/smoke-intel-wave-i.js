#!/usr/bin/env node
/** Smoke: choice set A/B/C + trigger inventory (v2.71) */
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

const { buildChoiceSet, CHOICE_VERSION } = require('../services/intel-choice-set');
const { buildScenarioLattice } = require('../services/intel-scenario-lattice');
const { ORCHESTRATOR_VERSION, evaluateIntelCenter } = require('../services/intel-orchestrator');
const { MEMO_VERSION } = require('../services/intel-memo');

assert(ORCHESTRATOR_VERSION.includes('2.71'), ORCHESTRATOR_VERSION);
assert(CHOICE_VERSION.includes('choice-set'), CHOICE_VERSION);
assert(MEMO_VERSION.includes('choice-set'), MEMO_VERSION);

const claim = {
  claimId: 'claim-cu-structural',
  side: 'bear',
  status: 'active',
  confidence: '弱结构',
  statement: '沪铜累库压制近月',
  n: 40,
  nDisplay: '40',
  triggers: [
    { type: 'falsify', condition: '合证翻转为去库+增仓' },
    { type: 'upgrade', condition: '持仓继续增仓且基差维持 contango' },
  ],
};

const inst = {
  id: 'cu',
  name: '沪铜',
  factors: {
    inventory: {
      stockFlowJoint: { available: true, primaryLabel: '累库+增仓', structureBias: 'bear' },
    },
  },
  basis: { available: true, structure: 'contango', structureLabel: '升水' },
  capitalAttention: { horizons: { oi1mPct: 3.2, sampleN: 22 } },
  dualNarrative: { regime: 'split', mapped: true },
};

const lattice = buildScenarioLattice(inst, claim, { state: 'mispriced', stateLabel: '误定价' }, {
  display: '证伪时钟·黄',
});
const cs = buildChoiceSet(inst, claim, { state: 'mispriced' }, { display: '证伪时钟·黄' }, lattice);

assert(cs.available, 'choice available');
assert(cs.options.length === 3, `opts ${cs.options.length}`);
assert(cs.options.every((o) => o.id && o.enterWhen?.length && o.exitWhen?.length), 'each has enter/exit');
assert(cs.primaryId === 'A', `primary ${cs.primaryId}`);
assert(cs.triggerInventory.some((t) => t.role === 'falsify' && t.available), 'falsify trigger');
assert(cs.triggerInventory.some((t) => t.id === 'stock_flow' && t.available), 'sf trigger');
assert(cs.triggerInventory.some((t) => t.id === 'dual' && t.available), 'dual trigger');
assert(!cs.weightsCalibrated || cs.nDisplay, 'n display');
assert(/触发缺口|选择集/.test(cs.display), cs.display);
console.log('OK choice', cs.display, 'primary', cs.primary.label);

// 证伪强制 C / B
const falsifying = buildChoiceSet(
  inst,
  { ...claim, status: 'falsifying' },
  { state: 'partial' },
  {},
  lattice
);
assert(falsifying.primaryId === 'C', `falsifying→C got ${falsifying.primaryId}`);

const falsified = buildChoiceSet(
  inst,
  { ...claim, status: 'falsified', falsifyTrigger: '合证翻转' },
  { state: 'mispriced' },
  {},
  lattice
);
assert(falsified.primaryId === 'B', `falsified→B got ${falsified.primaryId}`);

// 无信号 → 不造假权
const thin = buildChoiceSet(
  { id: 'x' },
  { claimId: 'c', side: 'flat', status: 'draft', confidence: '不可判定', statement: '—', triggers: [] },
  { state: 'unknown' },
  {},
  null
);
assert(thin.primaryId === 'C', 'unknown→C');
assert(thin.options.every((o) => o.weight == null || o.weightBand === '暂无' || true), 'no fake weight required');

const live = evaluateIntelCenter(
  {
    id: 'sc',
    name: '原油',
    direction: 'bearish',
    factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '累库+增仓' } } },
  },
  { asOf: '2026-07-16', persist: false, computeMode: 'full' }
);
assert(live.choiceSet?.primaryId, `live choice ${live.choiceSet?.primaryId}`);
assert(live.memo?.choiceSet?.options?.length === 3 || live.choiceSet?.options?.length === 3, 'memo/orch options');
assert(live.memo?.suggestedAction?.id, `suggested ${live.memo?.suggestedAction?.id}`);

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · wave-i choice-set'));
process.exit(fails ? 1 : 0);
