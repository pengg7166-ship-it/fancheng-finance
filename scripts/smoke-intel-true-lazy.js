#!/usr/bin/env node
/** Smoke: true attention lazy rationing (vision §25 / v2.89.9) */
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
  ATTENTION_VERSION,
  DEEP_SLOTS_MIN,
  DEEP_SLOTS_MAX,
  allocateFromTriage,
  probeSilentAnomaly,
  buildAttentionRationBoard,
  FACE_ATTENTION_POLICY,
} = require('../services/intel-attention-budget');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const { KPI_VERSION } = require('../services/intel-kpi');

assert(ATTENTION_VERSION.includes('true-lazy') || ATTENTION_VERSION.includes('2.89.9'), ATTENTION_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.9') || ORCHESTRATOR_VERSION.includes('true-lazy'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.9'), TEACH_VERSION);
assert(KPI_VERSION.includes('attention') || KPI_VERSION.includes('2.89.9'), KPI_VERSION);
assert(LESSONS.some((l) => l.id === 'attention_ration'), 'lesson attention_ration');
assert(DEEP_SLOTS_MIN === 8 && DEEP_SLOTS_MAX === 12, 'vision window');
assert(FACE_ATTENTION_POLICY.decision.deepSlots <= DEEP_SLOTS_MAX, 'decision deep');
assert(FACE_ATTENTION_POLICY.research.deepSlots <= DEEP_SLOTS_MAX, 'research deep≤12');

// Build 30 synthetic instruments: few high signal, rest quiet
const instruments = [];
for (let i = 0; i < 30; i += 1) {
  const id = `x${i}`;
  instruments.push({
    id,
    name: `品种${i}`,
    sector: i % 2 ? 'base' : 'energy',
    changePct: i === 0 ? -3.2 : i === 1 ? 2.1 : i < 5 ? 0.8 : 0.05,
    factors:
      i === 2
        ? { news: { shock: 0.8, hitCount: 5 }, inventory: { stockFlowJoint: { available: true, structureBias: 'bull' } } }
        : i === 3
          ? {
              inventory: { stockFlowJoint: { available: true, structureBias: 'bear' } },
              news: { shock: 0.1, hitCount: 0 },
            }
          : { news: { shock: 0, hitCount: 0 } },
    intelCenter:
      i === 3
        ? {
            primaryClaim: { status: 'falsifying', baseline: { structureBias: 'bull' } },
            falsifyEval: { baseline: { structureBias: 'bull' } },
          }
        : i === 4
          ? { pricingState: { state: 'mispriced' }, pushTier: { tier: 'watch' } }
          : i === 29
            ? { primaryClaim: { claimId: 'old-29', status: 'active', statement: '缓存命题' } }
            : undefined,
    userFocus: i === 5,
  });
}

const budget = allocateFromTriage(instruments, { asOf: '2026-07-16', shallowSlots: 12 });
assert(budget.trueRationing === true, 'trueRationing');
assert(budget.method.includes('triage'), budget.method);
assert(budget.deepCount >= DEEP_SLOTS_MIN && budget.deepCount <= DEEP_SLOTS_MAX, `deep ${budget.deepCount}`);
assert(budget.deepCount + budget.shallowCount + budget.silentCount === 30, 'partition');
assert(budget.byId.x0.computeMode === 'full', `x0 ${budget.byId.x0.computeMode}`);
assert(budget.silentCount >= 1, `silent ${budget.silentCount}`);

// structure flip should score high
assert(budget.byId.x3.score >= 55, `flip score ${budget.byId.x3.score}`);
assert((budget.byId.x3.reasons || []).some((r) => /翻转|证伪/.test(r)), budget.byId.x3.reasons);

// silent wake: many louder names fill deep+shallow; anomaly on low-rank → skip then wake→lite
const loud = Array.from({ length: 22 }, (_, i) => ({
  id: `loud${i}`,
  name: `响${i}`,
  changePct: -0.4, // 不高到触发 silent probe，但 falsifying 抢深/浅槽
  intelCenter: { primaryClaim: { status: 'falsifying' } },
}));
const sleeper = {
  id: 'wake1',
  name: '待醒',
  // triage 分低于 falsifying，落 silent；probe 仍因 shock 唤醒
  changePct: 1.3,
  factors: { news: { shock: 0.7, hitCount: 2 } },
};
const wakeBudget = allocateFromTriage([...loud, sleeper], {
  asOf: '2026-07-16',
  deepSlots: 8,
  shallowSlots: 10,
  maxSilentWakes: 4,
});
assert(wakeBudget.byId.wake1, 'wake1 slot');
assert(wakeBudget.wakeCount >= 1, `wake ${wakeBudget.wakeCount}`);
assert(wakeBudget.byId.wake1.computeMode === 'lite', `wake1 mode ${wakeBudget.byId.wake1.computeMode}`);
assert(wakeBudget.byId.wake1.wokeFromSilent === true, 'wokeFromSilent');
assert((wakeBudget.wakePromotions || []).some((w) => w.instrumentId === 'wake1'), 'wake1 in promotions');

const probe = probeSilentAnomaly({ changePct: 2.5, factors: { news: { shock: 0.6 } } });
assert(probe.wake === true, 'probe wake');

const ration = buildAttentionRationBoard(budget, instruments);
assert(ration.integrityOk === true, ration.display);
assert(ration.savingsPct != null && ration.savingsPct > 0, ration.savingsDisplay);
assert(/\d+\/\d+\/\d+/.test(`${ration.counts.full}/${ration.counts.lite}/${ration.counts.skip}`) || ration.counts.skip >= 0, 'counts');
assert(ration.trueRationing === true, 'ration true');

// apply: modes must diverge
const withIntel = applyIntelCenterToInstruments(instruments.slice(0, 20), {
  asOf: '2026-07-16',
  persist: false,
  deepSlots: 8,
  shallowSlots: 6,
});
const modes = { full: 0, lite: 0, skip: 0 };
for (const i of withIntel) {
  const m = i.intelCenter?.attention?.computeMode || '?';
  modes[m] = (modes[m] || 0) + 1;
}
assert(modes.full <= 12, `full ${modes.full}`);
assert(modes.full >= 1 && modes.skip >= 1, JSON.stringify(modes));
assert(withIntel._attentionBudget?.trueRationing === true, 'apply budget');

const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.89.9') || pack.version.includes('true-lazy'), pack.version);
assert(pack.attentionRationBoard?.display, pack.attentionRationBoard?.display);
assert(pack.attentionRationBoard?.integrityOk !== false, 'pack ration ok');
assert(pack.kpis?.attentionRationing?.nDisplay, pack.kpis?.attentionRationing?.nDisplay);
assert(pack.faceViews?.decision?.attentionRationBoard, 'face ration');
assert(pack.stats?.attentionRationOk !== false, 'stats ration');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · true-lazy §25'));
process.exit(fails ? 1 : 0);
