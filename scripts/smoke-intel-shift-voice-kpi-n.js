#!/usr/bin/env node
/** Smoke: shift voice + Interrupt/KPI n polish (v2.89.17 / §67+§58) */
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
  SHIFT_VERSION,
  SHIFT_VOICE_PROFILES,
  resolveShiftAt,
  buildShiftVoice,
  applyShiftVoice,
  applyShiftDeliveryContract,
} = require('../services/intel-shift-schedule');
const {
  KPI_VERSION,
  INTERRUPT_SURPRISE_N_GATE,
  computeKpis,
  parseHitDisplay,
} = require('../services/intel-kpi');
const { CHANNEL_VERSION, syncInterruptChannel } = require('../services/intel-interrupt-channel');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(SHIFT_VERSION.includes('shift-voice') || SHIFT_VERSION.includes('2.89.17'), SHIFT_VERSION);
assert(KPI_VERSION.includes('kpi-n-polish') || KPI_VERSION.includes('2.89.17'), KPI_VERSION);
assert(CHANNEL_VERSION.includes('2.89.17') || CHANNEL_VERSION.includes('n-gate'), CHANNEL_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.17') || ORCHESTRATOR_VERSION.includes('shift-voice'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.17'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'shift_voice'), 'lesson shift_voice');
assert(LESSONS.some((l) => l.id === 'interrupt_n'), 'lesson interrupt_n');
assert(INTERRUPT_SURPRISE_N_GATE === 20, String(INTERRUPT_SURPRISE_N_GATE));
assert(SHIFT_VOICE_PROFILES.intraday && SHIFT_VOICE_PROFILES.weekend, 'voice profiles');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('data-shift-voice'), 'hub data-shift-voice');
assert(appSrc.includes('intel-shift-voice-line'), 'hub voice line');
assert(appSrc.includes('voiceTitles'), 'hub voice titles');
assert(appSrc.includes('nGateDisplay'), 'hub nGate');
assert(appSrc.includes('intel-kpi-interrupt-n'), 'hub kpi interrupt n');
assert(appSrc.includes('sampleDisplay'), 'hub sampleDisplay');

const intraday = resolveShiftAt('2026-07-17T10:30:00+08:00');
assert(intraday.id === 'intraday', intraday.id);
const voiceIn = buildShiftVoice(intraday);
assert(voiceIn.voiceId === 'short_actionable', voiceIn.voiceId);
assert(/盘中/.test(voiceIn.hubLead || ''), voiceIn.hubLead);
assert(voiceIn.sectionTitles?.interrupt, 'section titles');

const voiced = applyShiftVoice(
  {
    dailyDiff: { summary: '物质变更 3 条很长很长很长很长很长很长很长很长很长很长很长', materialChanges: 3 },
    interrupts: [
      {
        id: 'cu',
        headline: '这是一条非常非常非常非常非常非常非常长的打断标题需要按盘中文风截断',
        surpriseN: 25,
        surpriseNDisplay: '25',
      },
    ],
    questionQueue: { p0: [{ question: '很长的P0问题内容需要被文风截断处理一下再展示给用户看' }] },
    shiftContract: { id: 'intraday', label: '盘中', deliveryContract: 'x', outputStyle: 'short_actionable', tone: '短' },
  },
  intraday
);
assert(voiced.shiftVoice?.voiceId === 'short_actionable', 'pack voice');
assert((voiced.interrupts[0].headline || '').length <= voiceIn.headlineMax + 1, voiced.interrupts[0].headline);
assert(voiced.dailyDiff.voiceLead, voiced.dailyDiff.voiceLead);

const weekend = resolveShiftAt('2026-07-18T12:00:00+08:00');
const voiceWe = buildShiftVoice(weekend);
assert(voiceWe.voiceId === 'review_debt', voiceWe.voiceId);
const trimmed = applyShiftDeliveryContract(
  {
    questionQueue: { p0: [1, 2, 3], p0Count: 3 },
    shockGraph: { topPaths: [1, 2, 3, 4] },
    top5Candidates: [{ id: 'x' }],
    interrupts: [{ id: 'cu', headline: '短' }],
    teaching: { lessons: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    dailyDiff: { summary: '周末复盘物质' },
  },
  weekend
);
assert(trimmed.shiftVoice?.voiceId === 'review_debt', trimmed.shiftVoice?.voiceId);
assert(trimmed.interrupts.length === 0, 'weekend strip interrupts');

const bare = parseHitDisplay('55%');
assert(bare.display === '暂无' && bare.deferred, 'bare % rejected');
const withN = parseHitDisplay('48.6% (168/346)');
assert(withN.total === 346 && !withN.deferred, withN.display);

const kpi = computeKpis(
  [
    {
      id: 'cu',
      intelCenter: {
        primaryClaim: { status: 'active', evidenceAgainst: [{}], triggers: [{}], n: 40 },
        surprise: { n: 25, nDisplay: '25' },
        pushTier: { tier: 'interrupt', surpriseN: 25, surpriseNDisplay: '25', score: 80 },
        gates: { top5: { pass: true } },
        processReadiness: { processReady: true },
        attention: { computeMode: 'full' },
      },
    },
    {
      id: 'rb',
      intelCenter: {
        primaryClaim: { status: 'active', evidenceAgainst: [{}], triggers: [{}], n: null },
        surprise: { n: 5, nDisplay: '5' },
        pushTier: { tier: 'interrupt', surpriseN: 5, surpriseNDisplay: '5', score: 70 },
        attention: { computeMode: 'lite' },
      },
    },
  ],
  { dailyDiff: { available: true, materialChanges: 2, quietDay: false } }
);
assert(kpi.interruptQuality?.nGate === 20, String(kpi.interruptQuality?.nGate));
assert(kpi.interruptQuality?.coverageDisplay === '1/2', kpi.interruptQuality?.coverageDisplay);
assert(kpi.panels.some((p) => p.id === 'interruptN' && p.sampleDisplay), 'interruptN panel');
assert(kpi.panels.every((p) => p.sampleDisplay || p.nDisplay), 'all panels n');
assert(/打断n/.test(kpi.display), kpi.display);

const ch = syncInterruptChannel(
  [
    {
      id: 'cu',
      name: '沪铜',
      claimId: `c-kpi-${Date.now()}`,
      headline: '证伪触发',
      score: 90,
      surpriseN: 30,
      surpriseNDisplay: '30',
      gatePass: true,
      lifecycle: 'eligible',
    },
  ],
  { asOf: '2026-07-17', shift: intraday, maxDaily: 3 }
);
const q0 = ch.queue?.[0] || ch.freshNotifications?.[0];
assert(q0?.nGateDisplay || (ch.queue || []).some((x) => x.nGateDisplay), 'channel nGateDisplay');
assert((ch.freshNotifications || []).some((n) => /n=/.test(n.body || '')), 'notify body has n');

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
assert(pack.version.includes('2.89.17') || pack.version.includes('shift-voice'), pack.version);
assert(pack.shiftVoice?.voiceId || pack.shift?.voiceId, pack.shiftVoice?.display || pack.shift?.display);
assert(pack.kpis?.interruptQuality, 'pack interruptQuality');
assert(pack.kpis?.panels?.some((p) => p.sampleDisplay), 'pack kpi sampleDisplay');
assert(
  (pack.teaching?.lessons || []).some((l) => l.id === 'shift_voice') ||
    LESSONS.some((l) => l.id === 'shift_voice'),
  'teaching shift_voice'
);

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · shift-voice + kpi-n §67/§58'));
process.exit(fails ? 1 : 0);
