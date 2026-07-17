#!/usr/bin/env node
/** Smoke: narrative epidemiology dynamics beyond keyword heat (vision §22 / v2.89.8) */
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
  NARRATIVE_VERSION,
  computeThemeTransmissionDynamics,
  assessNarrativeEpidemiology,
  buildNarrativeContagionBoard,
  enrichQuestionQueueWithNarrative,
} = require('../services/intel-narrative-epidemiology');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack, applyIntelCenterToInstruments } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(NARRATIVE_VERSION.includes('dynamics') || NARRATIVE_VERSION.includes('2.89.8'), NARRATIVE_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.8') || ORCHESTRATOR_VERSION.includes('narrative-dyn'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.8'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'narrative_transmission'), 'lesson narrative_transmission');

// Synthetic timeline: seed sc day0 → adopters day2/day5 → isolated late outside lag
const synthetic = [
  { date: '2026-07-01', title: '地缘冲突升级制裁预期', tags: ['sc'] },
  { date: '2026-07-01', title: '地缘溢价推升原油', tags: ['sc'] },
  { date: '2026-07-03', title: '地缘紧张外溢燃料油', tags: ['fu'] },
  { date: '2026-07-06', title: '地缘风险传导低硫', tags: ['lu'] },
  { date: '2026-07-10', title: '天气干旱威胁糖料', tags: ['sr'] },
  { date: '2026-07-12', title: '政策收储传闻', tags: ['al'] },
];
const dyn = computeThemeTransmissionDynamics('2026-07-16', {
  rows: synthetic,
  lookbackDays: 21,
  maxLagDays: 14,
});
assert(dyn.byTheme.geo, 'geo theme');
assert(dyn.byTheme.geo.seeds.includes('sc'), `seeds ${dyn.byTheme.geo.seeds}`);
assert(dyn.byTheme.geo.adopterCount >= 2, `adopters ${dyn.byTheme.geo.adopterCount}`);
assert(dyn.byTheme.geo.R0 != null, `R0 ${dyn.byTheme.geo.R0Display}`);
assert(/\(\d+\/\d+\)/.test(dyn.byTheme.geo.R0Display), dyn.byTheme.geo.R0Display);
assert(dyn.edges.some((e) => e.from === 'sc' && e.to === 'fu' && e.lagDays === 2), 'edge sc→fu lag2');
assert(dyn.edges.some((e) => e.from === 'sc' && e.to === 'lu'), 'edge sc→lu');
assert(dyn.method === 'theme-first-seen-lag-transmission', dyn.method);

const solo = computeThemeTransmissionDynamics('2026-07-16', {
  rows: [{ date: '2026-07-10', title: '去库加速', tags: ['cu'] }],
});
assert(solo.byTheme.destock.R0 == null, 'solo no R0');
assert(/单品种|暂无/.test(solo.byTheme.destock.R0Display), solo.byTheme.destock.R0Display);

// Live assess: no shock-driven peak; transmission fields present
const live = assessNarrativeEpidemiology(
  { id: 'sc', name: '原油', factors: { news: { shock: 0.99, hitCount: 0, hits: [] } } },
  '2026-07-16'
);
assert(live.version.includes('dynamics'), live.version);
assert(live.transmission, 'transmission field');
assert(live.scoreDisplay === '暂无' || live.contagion?.nDisplay, `score ${live.scoreDisplay}`);
assert(live.method.includes('transmission'), live.method);
assert(!/shock/.test(live.method), 'method not shock');

const board = buildNarrativeContagionBoard(
  [
    {
      id: 'sc',
      name: '原油',
      sector: 'energy',
      intelCenter: {
        narrative: assessNarrativeEpidemiology(
          { id: 'sc', factors: { news: { hitCount: 0 } } },
          '2026-07-16'
        ),
      },
    },
    {
      id: 'fu',
      name: '燃油',
      sector: 'energy',
      intelCenter: {
        narrative: assessNarrativeEpidemiology(
          { id: 'fu', factors: { news: { hitCount: 0 } } },
          '2026-07-16'
        ),
      },
    },
    {
      id: 'cu',
      name: '沪铜',
      sector: 'base',
      intelCenter: {
        narrative: {
          phase: 'spreading',
          label: '扩散·跨品种传染',
          narrativeAhead: true,
          alert: '故事加速但合证未跟',
          n: 8,
          nDisplay: '8',
          dominantTheme: { id: 'geo', count: 3 },
          display: '扩散',
          contagion: { velocityDisplay: '+120%' },
          scoreDisplay: '0.60',
          transmission: {
            role: 'adopter',
            roleLabel: '采纳者',
            seedId: 'sc',
            lagFromSeedDays: 1,
            R0Display: '2.00 (2/1)',
          },
          dataSource: 'news-tagged.csv',
        },
      },
    },
  ],
  '2026-07-16'
);
assert(board.transmission, 'board.transmission');
assert(board.counts.transmissionEdges != null, 'counts.transmissionEdges');
assert(board.sir, 'sir');
assert(/叙事板/.test(board.display), board.display);
assert(board.method.includes('first-seen-transmission'), board.method);
assert(
  board.questions.some((q) => /滞后|传染|R₀|R0/.test(q.question)),
  'path/R0 question'
);

const q = enrichQuestionQueueWithNarrative(
  { version: 't', all: [], deepQueue: [], p0: [], p0Count: 0 },
  board
);
assert(q.narrativeInjected >= 1, `injected ${q.narrativeInjected}`);

const sample = [
  { id: 'sc', name: '原油', direction: 'bearish', changePct: -1 },
  { id: 'fu', name: '燃油', direction: 'bearish', changePct: -0.5 },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.89.8') || pack.version.includes('narrative-dyn'), pack.version);
assert(pack.narrativeContagion?.transmission, 'pack transmission');
assert(pack.faceViews?.research?.narrativeContagion?.transmission, 'research face transmission');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · narrative-dynamics §22'));
process.exit(fails ? 1 : 0);
