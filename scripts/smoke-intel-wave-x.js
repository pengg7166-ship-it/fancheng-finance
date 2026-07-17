#!/usr/bin/env node
/** Smoke: mechanism board + pricing/clock board (v2.86) */
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
  MECHANISM_BOARD_VERSION,
  buildMechanismBoard,
  enrichQuestionQueueWithMechanism,
} = require('../services/intel-mechanism-board');
const {
  PRICING_CLOCK_BOARD_VERSION,
  buildPricingClockBoard,
  enrichQuestionQueueWithPricingClock,
} = require('../services/intel-pricing-clock-board');
const { PRICING_VERSION } = require('../services/intel-pricing-state');
const { CLOCK_VERSION } = require('../services/intel-falsification-clock');
const { PUSH_VERSION } = require('../services/intel-push-tier');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.86'), ORCHESTRATOR_VERSION);
assert(MECHANISM_BOARD_VERSION.includes('mechanism-board'), MECHANISM_BOARD_VERSION);
assert(PRICING_CLOCK_BOARD_VERSION.includes('pricing-clock'), PRICING_CLOCK_BOARD_VERSION);
assert(PRICING_VERSION.includes('2.86'), PRICING_VERSION);
assert(CLOCK_VERSION.includes('2.86'), CLOCK_VERSION);
assert(PUSH_VERSION.includes('2.86'), PUSH_VERSION);

const mech = buildMechanismBoard(
  {
    version: 'shock',
    activeEdges: [
      {
        from: 'sc',
        to: 'fu',
        label: '原油→燃油',
        mechanism: 'cost',
        corr: 0.82,
        n: 80,
        nDisplay: '80',
        lagTypical: 1,
        activation: 0.6,
        path: '原油→燃油 · lag1d corr=0.82 · 激活60% (n=80)',
      },
    ],
    pendingEdges: [
      {
        from: 'cu',
        to: 'al',
        label: '铜→铝',
        mechanism: 'sentiment',
        n: 40,
        nDisplay: '40',
        corr: null,
        reason: '源冲击不足',
        text: '铜→铝 · 待校验 · 源冲击不足 (n=40)',
      },
    ],
  },
  [
    {
      id: 'rb',
      name: '螺纹',
      intelCenter: {
        primaryClaim: {
          mechanismDepth: 1,
          mechanismDepthDisplay: '1',
          mechanismChain: '合证:去库',
          mechanismLinks: [
            { step: '合证', available: true },
            { step: '基差', available: false },
            { step: '内外', available: false },
          ],
        },
      },
    },
  ],
  { asOf: '2026-07-17' }
);
assert(mech.counts.live >= 1, `live ${mech.counts.live}`);
assert(mech.counts.pending >= 1, `pending ${mech.counts.pending}`);
assert(mech.buckets.some((b) => b.id === 'cost' && b.liveCount >= 1), 'cost bucket');
assert(mech.thinClaims.length >= 1, 'thin claims');
assert(mech.questions.length >= 1, 'mech Q');
const qM = enrichQuestionQueueWithMechanism({ all: [], version: 'x' }, mech);
assert((qM.mechanismInjected || 0) >= 1, `mech inj ${qM.mechanismInjected}`);

const pc = buildPricingClockBoard(
  [
    {
      id: 'cu',
      name: '沪铜',
      intelCenter: {
        pricingState: {
          state: 'mispriced',
          stateLabel: '定价背离',
          rationale: ['结构偏多但价格下跌'],
          actionHint: '红队+深度',
          dataSource: 'test',
        },
        clock: {
          display: '证伪时钟:临近证伪·剩1日',
          aggregate: { level: 'red', daysLeft: 1, label: '临近证伪' },
          nextCheckpoint: '2026-07-18',
        },
        pushTier: { tier: 'watch', tierLabel: '关注', reasons: ['Interrupt门禁未过'], capped: false },
        primaryClaim: { status: 'active' },
      },
    },
    {
      id: 'au',
      name: '沪金',
      intelCenter: {
        pricingState: { state: 'unpriced', stateLabel: '未定价', actionHint: '可提高关注' },
        clock: { display: '证伪时钟:充裕', aggregate: { level: 'green', daysLeft: 10, label: '充裕' } },
        pushTier: { tier: 'silent', tierLabel: '静默' },
      },
    },
  ],
  { asOf: '2026-07-17' }
);
assert(pc.counts.mispriced >= 1, `mis ${pc.counts.mispriced}`);
assert(pc.counts.clockDue >= 1, `due ${pc.counts.clockDue}`);
assert(pc.counts.unpriced >= 1, `unp ${pc.counts.unpriced}`);
assert(pc.questions.some((q) => /背离|临近/.test(q.question)), 'pc Q');
const qP = enrichQuestionQueueWithPricingClock({ all: [], version: 'x' }, pc);
assert((qP.pricingClockInjected || 0) >= 1, `pc inj ${qP.pricingClockInjected}`);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.86'), pack.version);
assert(pack.mechanismBoard?.version?.includes('mechanism-board'), pack.mechanismBoard?.version || 'no mech');
assert(pack.pricingClockBoard?.version?.includes('pricing-clock'), pack.pricingClockBoard?.version || 'no pc');
assert(typeof pack.mechanismBoard.display === 'string', pack.mechanismBoard.display);
assert(typeof pack.pricingClockBoard.display === 'string', pack.pricingClockBoard.display);
assert(
  pack.faceViews?.research?.mechanismBoard || pack.faceViews?.execution?.pricingClockBoard,
  'face boards'
);

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-x mechanism-pricing-clock');
process.exit(fails ? 1 : 0);
