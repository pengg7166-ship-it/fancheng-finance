#!/usr/bin/env node
/** Smoke: interrupt delivery + shift discipline (v2.81) */
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
  CHANNEL_VERSION,
  syncInterruptChannel,
  ackInterrupt,
  loadRecentDeliveries,
  INTERRUPT_STATES,
} = require('../services/intel-interrupt-channel');
const {
  SHIFT_VERSION,
  resolveShiftAt,
  applyShiftDeliveryContract,
  applyShiftToPushTier,
  buildShiftDisciplineBoard,
} = require('../services/intel-shift-schedule');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.81'), ORCHESTRATOR_VERSION);
assert(CHANNEL_VERSION.includes('interrupt-delivery'), CHANNEL_VERSION);
assert(SHIFT_VERSION.includes('shift-discipline'), SHIFT_VERSION);

const weekend = resolveShiftAt('2026-07-18T12:00:00+08:00'); // Saturday
assert(weekend.id === 'weekend', `weekend ${weekend.id}`);
assert(weekend.allowInterrupt === false, 'weekend no interrupt');
assert(weekend.allowLongBrief === true, 'weekend long ok');

const intraday = resolveShiftAt('2026-07-17T10:30:00+08:00'); // Friday morning
assert(intraday.id === 'intraday', `intraday ${intraday.id}`);
assert(intraday.allowInterrupt === true, 'intraday interrupt');
assert(intraday.allowLongBrief === false, 'intraday no long');

const pt = applyShiftToPushTier({ tier: 'interrupt', reasons: [] }, weekend);
assert(pt.tier === 'watch', `weekend push ${pt.tier}`);

const candidates = [
  {
    id: 'cu',
    name: '沪铜',
    claimId: `c-smoke-${Date.now()}`,
    headline: '证伪触发 · 合证翻转',
    score: 90,
    gatePass: true,
    lifecycle: 'eligible',
  },
];

const deniedCh = syncInterruptChannel(candidates, {
  asOf: '2026-07-18',
  shift: weekend,
  maxDaily: 3,
});
assert(deniedCh.shiftAllowsInterrupt === false, 'ch deny flag');
assert((deniedCh.shiftDeniedCount || 0) >= 1, `denied ${deniedCh.shiftDeniedCount}`);
assert((deniedCh.freshNotifications || []).length === 0, 'no notify on weekend');
assert(/拒投/.test(deniedCh.display), deniedCh.display);

const liveCh = syncInterruptChannel(candidates, {
  asOf: '2026-07-17',
  shift: intraday,
  maxDaily: 3,
});
assert((liveCh.freshNotifications || []).length >= 1, `notified ${liveCh.freshNotifications?.length}`);
assert((liveCh.recentDeliveries || []).length >= 1 || loadRecentDeliveries(3).length >= 1, 'delivery log');
if (liveCh.queue?.[0]?.key) {
  const ack = ackInterrupt(liveCh.queue[0].key);
  assert(ack.ok && ack.state === INTERRUPT_STATES.archived, 'ack archive');
}

const disc = buildShiftDisciplineBoard(weekend, { _preShiftInterruptCount: 2 });
assert(disc.denied.some((r) => r.id === 'interrupt'), 'disc deny interrupt');
assert((disc.violations || []).length >= 1, 'violations');

const trimmed = applyShiftDeliveryContract(
  {
    questionQueue: { p0: [1, 2, 3, 4], p0Count: 4, deepQueue: [1, 2, 3, 4, 5] },
    shockGraph: { topPaths: [1, 2, 3, 4, 5, 6] },
    top5Candidates: [{ id: 'x' }],
    interrupts: [{ id: 'cu' }],
    teaching: { lessons: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    failureMuseumRecent: [1, 2, 3, 4],
  },
  intraday
);
assert(trimmed.top5Candidates.length === 0, 'intraday no top5');
assert(trimmed.interrupts.length === 1, 'intraday keeps interrupt list pre-channel');
assert((trimmed.teaching.lessons || []).length <= 1, 'intraday teaching trim');
assert(trimmed.shiftDiscipline?.shiftId === 'intraday', 'discipline on pack');

const weekendPack = applyShiftDeliveryContract(
  {
    questionQueue: { p0: [1], p0Count: 1 },
    shockGraph: { topPaths: [] },
    top5Candidates: [{ id: 'x' }],
    interrupts: [{ id: 'cu' }, { id: 'au' }],
    teaching: { lessons: [1, 2] },
    interruptChannel: { display: 'x', queue: [{ key: 'a' }], pendingCount: 1 },
  },
  weekend
);
assert(weekendPack.interrupts.length === 0, 'weekend strip interrupts');
assert(weekendPack.interruptChannel?.shiftAllowsInterrupt === false, 'weekend ch stamped');

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 1.2 },
    { id: 'au', name: '沪金', changePct: 0.3 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.81'), pack.version);
assert(pack.interruptChannel?.version?.includes('interrupt-delivery'), pack.interruptChannel?.version || 'no ich');
assert(pack.shiftDiscipline?.version?.includes('shift-discipline') || pack.shift?.version?.includes('shift'), 'shift disc');
assert(pack.faceViews?.execution?.shiftDiscipline || pack.faceViews?.execution?.interruptChannel, 'exec face');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-s shift-interrupt');
process.exit(fails ? 1 : 0);
