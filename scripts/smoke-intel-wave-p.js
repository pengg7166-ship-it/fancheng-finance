#!/usr/bin/env node
/** Smoke: isomorphic board + calendar follow OS (v2.78) */
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
  ISO_BOARD_VERSION,
  buildIsomorphicBoard,
  enrichQuestionQueueWithIsomorphic,
  pathTier,
} = require('../services/intel-isomorphic-board');
const {
  INTEL_CAL_VERSION,
  buildCalendarFollowQuestions,
  enrichQuestionQueueWithCalendar,
} = require('../services/intel-intelligence-calendar');
const { CANONICAL_CASES } = require('../services/intel-canonical-cases');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');
const { CHOICE_VERSION, buildChoiceSet } = require('../services/intel-choice-set');

assert(ORCHESTRATOR_VERSION.includes('2.78'), ORCHESTRATOR_VERSION);
assert(ISO_BOARD_VERSION.includes('isomorphic'), ISO_BOARD_VERSION);
assert(INTEL_CAL_VERSION.includes('calendar-follow'), INTEL_CAL_VERSION);
assert(CHOICE_VERSION.includes('iso'), CHOICE_VERSION);

const oil = CANONICAL_CASES.find((c) => c.id === 'oil_supply_shock');
assert(oil?.era?.includes('2022'), `oil era dated ${oil?.era}`);
assert(pathTier({ available: true, score: 0.6 }).tier === 'strong', 'tier strong');
assert(pathTier({ available: true, score: 0.3 }).tier === 'weak', 'tier weak');
assert(pathTier({ reason: 'era_not_dated' }).tier === 'undated', 'tier undated');

const board = buildIsomorphicBoard(
  [
    {
      id: 'sc',
      name: '原油',
      sector: 'energy',
      intelCenter: {
        canonicalCases: {
          inIsomorphicWatch: true,
          display: '同构监视 · 原油供给冲击',
          matches: [
            {
              id: 'oil_supply_shock',
              label: '原油供给冲击传导',
              era: '2022-02~2022-04',
              mechanism: 'geo',
              similarity: 0.72,
              themeScore: 0.35,
              watchSignals: ['地缘溢价', '裂解价差'],
              pathSimilarity: {
                available: true,
                score: 0.62,
                n: 28,
                nDisplay: '28',
                display: '路径同构 62% (n=28)',
              },
              matchReasons: ['品种命中'],
            },
          ],
        },
      },
    },
    {
      id: 'p',
      name: '棕榈',
      intelCenter: {
        canonicalCases: {
          inIsomorphicWatch: true,
          display: '同构监视 · 棕榈天气',
          matches: [
            {
              id: 'palm_weather_narrative',
              label: '棕榈天气叙事 vs 库存',
              era: 'recurring',
              similarity: 0.4,
              themeScore: 0.4,
              watchSignals: ['产地降雨'],
              pathSimilarity: { available: false, reason: 'era_not_dated', display: 'era非定日' },
              matchReasons: ['品种命中', '路径·era非定日'],
            },
          ],
        },
      },
    },
  ],
  { asOf: '2026-07-16' }
);
assert(board.counts.strong >= 1, `strong ${board.counts.strong}`);
assert(board.counts.themeOnly >= 1, `theme ${board.counts.themeOnly}`);
assert(board.questions.some((q) => /同构/.test(q.question) && q.pathTier === 'strong'), 'strong Q');

const qIso = enrichQuestionQueueWithIsomorphic({ all: [], version: 't' }, board);
assert((qIso.isomorphicInjected || 0) >= 1, `iso injected ${qIso.isomorphicInjected}`);

const calQs = buildCalendarFollowQuestions({
  imminent: [
    {
      eventId: 'r1',
      name: '库存报告',
      type: 'data_release',
      intelPhase: 'pre',
      imminent: true,
      symbols: ['cu'],
      question: '铜库存发布前：市场定价了什么？',
    },
  ],
  followWatch: [
    {
      eventId: 'r2',
      name: '仓单周报',
      symbols: ['rb'],
      followThrough: {
        d5: {
          pending: false,
          available: true,
          scored: 3,
          agree: 0,
          disagree: 2,
          nDisplay: '0/3',
          display: 'T+5 · 结构未跟上 2/3',
          verdict: '结构未跟上',
          horizonDays: 5,
        },
      },
    },
  ],
  events: [],
});
assert(calQs.some((q) => q.calendarPhase === 'pre'), 'cal pre Q');
assert(calQs.some((q) => q.calendarPhase === 'follow'), 'cal follow Q');
const qCal = enrichQuestionQueueWithCalendar({ all: [], version: 't' }, {
  imminent: calQs.filter((q) => q.calendarPhase === 'pre').map((q) => ({
    eventId: q.eventId,
    name: '库存报告',
    type: 'data_release',
    intelPhase: 'pre',
    imminent: true,
    symbols: [q.instrumentId],
    question: q.question,
  })),
  followWatch: [
    {
      eventId: 'r2',
      name: '仓单周报',
      symbols: ['rb'],
      followThrough: {
        d5: {
          pending: false,
          available: true,
          scored: 3,
          agree: 0,
          disagree: 2,
          nDisplay: '0/3',
          display: 'T+5 · 结构未跟上 2/3',
          verdict: '结构未跟上',
          horizonDays: 5,
        },
      },
    },
  ],
  events: [],
});
assert((qCal.calendarInjected || 0) >= 1, `cal injected ${qCal.calendarInjected}`);

const cs = buildChoiceSet(
  {
    id: 'sc',
    intelCenter: {
      isomorphicBoard: {
        preferWatchSignals: true,
        best: {
          label: '原油供给冲击传导',
          pathTier: 'strong',
          pathNDisplay: '28',
          watchSignals: ['地缘溢价', '裂解价差'],
        },
      },
    },
  },
  { claimId: 'c1', side: 'bull', confidence: '弱结构', status: 'active', n: 30, triggers: [] },
  { state: 'unpriced' },
  {},
  null,
  null
);
assert(cs.isomorphic?.label, 'choice iso flag');
assert(/同构监视/.test(cs.display), cs.display);
assert(cs.options.find((o) => o.id === 'A')?.enterWhen?.some((t) => /同构/.test(t)), 'A enter iso');

const pack = buildIntelCenterPack(
  [
    { id: 'sc', name: '原油', changePct: 0.5, sector: 'energy' },
    { id: 'cu', name: '沪铜', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1, sector: 'ferrous' },
    { id: 'au', name: '沪金', changePct: 0.3 },
    { id: 'p', name: '棕榈', changePct: 0.1 },
  ],
  { asOf: '2026-07-16', persist: false }
);
assert(pack.version.includes('2.78'), pack.version);
assert(pack.isomorphicBoard?.version?.includes('isomorphic'), pack.isomorphicBoard?.version || 'no iso');
assert(pack.intelligenceCalendar?.version?.includes('calendar'), pack.intelligenceCalendar?.version || 'no cal');
assert(typeof pack.isomorphicBoard.display === 'string', pack.isomorphicBoard.display);
assert(pack.faceViews?.research?.isomorphicBoard || pack.faceViews?.research?.intelligenceCalendar, 'research face');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-p iso-calendar');
process.exit(fails ? 1 : 0);
