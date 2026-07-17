#!/usr/bin/env node
/** Smoke: dual narrative + attention budget + isomorphic K */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();

const { assessDualNarrative } = require('../services/intel-dual-narrative');
const { allocateAttentionBudget } = require('../services/intel-attention-budget');
const { computePathSimilarity, pearson } = require('../services/intel-isomorphic-k');
const { matchCanonicalCases } = require('../services/intel-canonical-cases');
const { evaluateIntelCenter, buildIntelCenterPack } = require('../services/intel-orchestrator');

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    fails += 1;
  } else console.log('OK', msg);
}

// 1) dual narrative — au has COMEX
const auDual = assessDualNarrative({ id: 'au', name: '沪金', changePct: -0.3, sector: 'precious' });
assert(auDual.version.includes('dual-narrative'), `dual version ${auDual.version}`);
assert(auDual.mapped === true, 'au mapped');
assert(auDual.external.available === true || auDual.external.nDisplay === '暂无', `au external ${auDual.external.label}`);
assert(auDual.macroClimate.available === true, `macro climate ${auDual.macroClimate.display}`);

const rbDual = assessDualNarrative({ id: 'rb', name: '螺纹', changePct: -0.5, sector: 'ferrous' });
assert(rbDual.mapped === false, 'rb unmapped honest');

// 2) pearson + isomorphic path
assert(pearson([0.01, 0.02, -0.01, 0.0, 0.01, 0.02, -0.01], [0.01, 0.02, -0.01, 0.0, 0.01, 0.02, -0.01]) > 0.99, 'pearson identity');
const path = computePathSimilarity('au', { era: '2020-02~2020-04', id: 'covid_liquidity_2020' }, '2026-07-16');
assert(path.available === true || path.reason, `path result ${JSON.stringify(path).slice(0, 120)}`);
const canon = matchCanonicalCases({ id: 'au', name: '沪金', sector: 'precious' }, { asOf: '2026-07-16' });
assert(canon.version.includes('isomorphic') || canon.method.includes('kline-path'), `canon ${canon.method}`);

// 3) orchestrator + attention
const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
const packSrc = getCachedCommodityOutlookSource();
const au = (packSrc?.instruments || []).find((i) => i.id === 'au') || { id: 'au', name: '沪金', changePct: -0.3 };
const ic = evaluateIntelCenter(au, { persist: false, asOf: '2026-07-16' });
assert(ic.dualNarrative?.version, `ic dual ${ic.dualNarrative?.regime}`);
assert(ic.version.includes('dual-attn-iso') || ic.version.includes('v2.61'), `orch ${ic.version}`);

const mini = [
  { id: 'au', name: '沪金', intelCenter: ic },
  {
    id: 'rb',
    name: '螺纹',
    intelCenter: {
      question: { priority: 'P4', score: 2, reasons: [], question: '浅' },
      dualNarrative: { regime: 'domestic_only' },
    },
  },
  {
    id: 'sc',
    name: '原油',
    intelCenter: {
      question: { priority: 'P1', score: 60, reasons: ['内外叙事分裂'], question: '分裂?' },
      dualNarrative: { regime: 'split' },
      pushTier: { tier: 'watch' },
    },
  },
];
// rebuild questions via allocate on synthetic
const budget = allocateAttentionBudget(
  mini.map((m) => ({
    ...m,
    intelCenter: {
      ...m.intelCenter,
      question: m.intelCenter.question || ic.question,
    },
  })),
  { deepSlots: 2, shallowSlots: 1 }
);
assert(budget.deepCount <= 2, `deepCount ${budget.deepCount}`);
assert(budget.display.includes('深算'), budget.display);

const fullPack = buildIntelCenterPack(
  (packSrc?.instruments || []).slice(0, 12).map((inst) => {
    const e = evaluateIntelCenter(inst, { persist: false });
    const enriched = e._enrichedInstrument || inst;
    const clean = { ...e };
    delete clean._enrichedInstrument;
    return { ...enriched, intelCenter: clean };
  }),
  { persist: false, asOf: '2026-07-16' }
);
assert(fullPack.attentionBudget?.deepCount >= 1, `pack deep ${fullPack.attentionBudget?.deepCount}`);
assert(typeof fullPack.dualSplitCount === 'number', `dualSplitCount ${fullPack.dualSplitCount}`);

if (fails) {
  console.error(`FAILED ${fails}`);
  process.exit(1);
}
console.log('PASS: dual+attention+isomorphic-k smoke');
process.exit(0);
