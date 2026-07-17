#!/usr/bin/env node
/** Smoke: Intelligence Calendar pre / post / follow */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();

const { buildIntelligenceCalendar, assessFollowThrough } = require('../services/intel-intelligence-calendar');
const { recentPastEiaWeekly } = require('../services/commodity-release-calendar');

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    fails += 1;
  } else console.log('OK', msg);
}

const past = recentPastEiaWeekly('2026-07-16', 14);
assert(past.length >= 1, `past EIA ${past.length}`);

const instruments = [
  {
    id: 'sc',
    name: '原油',
    sector: 'energy',
    changePct: -0.5,
    intelCenter: {
      primaryClaim: {
        claimId: 'claim-sc-structural',
        status: 'active',
        confidence: '弱结构',
        statement: '原油结构偏空待验证',
        side: 'bear',
      },
      pricingState: { state: 'mispriced' },
      dualNarrative: { regime: 'resonate' },
    },
    factors: { inventory: { stockFlowJoint: { structureBias: 'bear', available: true } } },
  },
  {
    id: 'cu',
    name: '沪铜',
    sector: 'metals',
    intelCenter: {
      primaryClaim: { claimId: 'claim-cu-structural', status: 'active', confidence: '弱结构', statement: '铜', side: 'bull' },
      pricingState: { state: 'partial' },
    },
  },
];

const cal = buildIntelligenceCalendar(instruments, {
  asOf: '2026-07-16',
  daysAhead: 14,
  lookbackDays: 14,
});
assert(cal.version.includes('intel-calendar'), cal.version);
assert(cal.eventCount >= 1, `events ${cal.eventCount}`);
const eia = cal.events.find((e) => e.id === 'eia-weekly');
assert(eia, 'has eia event');
assert(eia.pre?.marketPricedLabel, `pre ${eia.pre?.marketPricedLabel}`);
assert(eia.followThrough?.d3, 'has d3 follow slot');

const pastEia = cal.events.find((e) => e.id === 'eia-weekly' && e.releaseDate < '2026-07-16');
if (pastEia) {
  const ft = assessFollowThrough(pastEia, instruments, '2026-07-16', 3);
  assert(ft.pending === false || ft.pending === true, `follow pending=${ft.pending} ${ft.display}`);
  console.log('OK follow sample', ft.display);
} else {
  console.log('OK no past eia in window (ok)');
}

const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');
const disk = require('../services/disk-cache');
if (!disk.getRoot()) disk.init('F:/FanchengFinance/data');
const out = hydrateIntelCenterOnOutlook(getCachedCommodityOutlookSource(), { persist: true, force: true });
const ic = out.intelCenterPack?.intelligenceCalendar;
assert(ic?.version, `pack calendar ${ic?.display}`);
assert(ic.eventCount >= 1, `pack events ${ic.eventCount}`);

if (fails) {
  console.error(`FAILED ${fails}`);
  process.exit(1);
}
console.log('PASS: intelligence calendar smoke');
process.exit(0);
