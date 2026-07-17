#!/usr/bin/env node
/** Smoke: staff face vs fortune chrome (v2.89 / vision §1) */
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
  STAFF_FACE_VERSION,
  MODE,
  resolveStaffFace,
} = require('../services/intel-staff-face');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(STAFF_FACE_VERSION.includes('staff-face'), STAFF_FACE_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'staff_face'), 'lesson staff_face');

const unknown = resolveStaffFace({ beliefLevel: '不可判定', memo: { available: true } });
assert(unknown.mode === MODE.observe && unknown.fortuneChromeAllowed === false, 'unknown observe');

const divided = resolveStaffFace({ beliefLevel: '叙事分歧', memo: { available: true, publishable: true } });
assert(divided.mode === MODE.brief && divided.fortuneChromeAllowed === false, 'divided brief');

const weakNoGate = resolveStaffFace({
  beliefLevel: '弱结构',
  memo: { available: true, publishable: false },
  gates: { memo: { pass: false }, top5: { pass: false } },
});
assert(weakNoGate.mode === MODE.brief && weakNoGate.fortuneChromeAllowed === false, 'weak no gate');

const weakTop5 = resolveStaffFace({
  beliefLevel: '弱结构',
  memo: { available: true, publishable: true },
  gates: { memo: { pass: true }, top5: { pass: true } },
});
assert(weakTop5.mode === MODE.command && weakTop5.fortuneChromeAllowed === true, 'weak top5 command');

const strong = resolveStaffFace({
  beliefLevel: '强结构',
  memo: { available: true, publishable: true },
  gates: { memo: { pass: true }, top5: { pass: false } },
});
assert(strong.mode === MODE.command && strong.fortuneChromeAllowed === true, 'strong memo gate');

const falsifying = resolveStaffFace({
  beliefLevel: '弱结构',
  primaryClaim: { status: 'falsifying' },
  gates: { top5: { pass: true } },
});
assert(falsifying.mode === MODE.observe && falsifying.fortuneChromeAllowed === false, 'falsifying blocks');

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.89'), pack.version);
assert(typeof pack.stats.staffCommand === 'number', 'stats staffCommand');
assert(typeof pack.stats.staffBrief === 'number', 'stats staffBrief');
assert(typeof pack.stats.staffObserve === 'number', 'stats staffObserve');
assert(pack.statsDisplay?.staffLine && /可行动/.test(pack.statsDisplay.staffLine), pack.statsDisplay?.staffLine);
const withFace = (pack.instruments || []).length
  ? null
  : require('../services/intel-orchestrator').applyIntelCenterToInstruments(
      [
        { id: 'cu', name: '沪铜', changePct: 0.5 },
        { id: 'au', name: '沪金', changePct: 0.1 },
      ],
      { asOf: '2026-07-17', persist: false }
    );
const sample = withFace || [];
for (const inst of sample) {
  assert(inst.intelCenter?.staffFace?.mode, `${inst.id} staffFace`);
  assert(typeof inst.intelCenter.staffFace.fortuneChromeAllowed === 'boolean', `${inst.id} fortune`);
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave staff-face §1');
process.exit(fails ? 1 : 0);
