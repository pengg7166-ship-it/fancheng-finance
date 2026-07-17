#!/usr/bin/env node
/** Smoke: page tone — staff lead, direction table retreat (v2.89.15 / §20) */
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
  PAGE_TONE_VERSION,
  buildStaffListLead,
  resolveRowToneClass,
  buildPageToneBoard,
} = require('../services/intel-page-tone');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(PAGE_TONE_VERSION.includes('page-tone') || PAGE_TONE_VERSION.includes('2.89.15'), PAGE_TONE_VERSION);
assert(
  ORCHESTRATOR_VERSION.includes('2.89.1') || ORCHESTRATOR_VERSION.includes('page-tone') || ORCHESTRATOR_VERSION.includes('release'),
  ORCHESTRATOR_VERSION
);
assert(TEACH_VERSION.includes('2.89.1'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'page_tone_staff'), 'lesson');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('buildOutlookStaffListLead'), 'app lead helper');
assert(appSrc.includes('outlook-inst-staff'), 'app staff col');
assert(appSrc.includes('outlookRowToneClassForInst'), 'app row tone');
assert(appSrc.includes('intel-page-tone-line') || appSrc.includes('pageToneLine'), 'hub page tone');

const observeInst = {
  id: 'rb',
  name: '螺纹',
  direction: 'bearish',
  directionArrow: '▼',
  directionLabel: '偏空',
  intelCenter: {
    available: true,
    beliefLevel: '不可判定',
    memo: { available: true, headline: '暂不可判定', oneLiner: '证据不足' },
    staffFace: { mode: 'observe', fortuneChromeAllowed: false, display: '观望·禁算命面' },
  },
};
const leadObs = buildStaffListLead(observeInst);
assert(leadObs.lead === '观望', leadObs.lead);
assert(leadObs.showArrow === false, 'observe no arrow');
assert(leadObs.directionLabel == null, 'observe no dir label');
const toneObs = resolveRowToneClass(observeInst);
assert(/staff-surface/.test(toneObs) && /staff-muted/.test(toneObs), toneObs);
assert(!/outlook-direction-bearish[^-]/.test(toneObs), 'no full bearish wash');

const commandInst = {
  id: 'cu',
  name: '铜',
  direction: 'bullish',
  directionArrow: '▲',
  directionLabel: '偏多',
  intelCenter: {
    available: true,
    beliefLevel: '强结构',
    choiceSet: { primaryId: 'A' },
    memo: { available: true, headline: '去库支撑', oneLiner: '结构偏多' },
    primaryClaim: { status: 'active', statement: '去库支撑近月' },
    staffFace: { mode: 'command', fortuneChromeAllowed: true, display: '可行动幕僚' },
  },
};
const leadCmd = buildStaffListLead(commandInst);
assert(leadCmd.lead === '方案A' || leadCmd.lead === '强结构', leadCmd.lead);
assert(leadCmd.showArrow === true, 'command aux arrow');
assert(leadCmd.arrow === '▲', leadCmd.arrow);
const toneCmd = resolveRowToneClass(commandInst);
assert(/fortune-aux/.test(toneCmd) && /bullish-aux/.test(toneCmd), toneCmd);

const board = buildPageToneBoard([observeInst, commandInst], { asOf: '2026-07-16' });
assert(board.counts.arrowHidden >= 1, board.counts);
assert(board.counts.fortuneAux >= 1, board.counts);
assert(/幕僚面/.test(board.display), board.display);

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
assert(pack.version.includes('2.89.1') || pack.version.includes('page-tone') || pack.version.includes('release'), pack.version);
assert(pack.pageToneBoard?.display, pack.pageToneBoard?.display);
assert(pack.statsDisplay?.pageToneLine || pack.pageToneBoard?.display, 'stats pageTone');
assert((pack.stats?.pageToneArrowHidden || 0) >= 0, 'stats arrowHidden');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · page-tone §20'));
process.exit(fails ? 1 : 0);
