#!/usr/bin/env node
/** Smoke: anti-manipulation productization (vision §31/32 / v2.89.7) */
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
  ANTI_MANIP_VERSION,
  detectManipulationSignals,
  scanAutoSuspectSignals,
  applyManipulationToEvidence,
  buildAntiManipulationBoard,
  enrichQuestionQueueWithAntiManip,
} = require('../services/intel-anti-manipulation');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(ANTI_MANIP_VERSION.includes('product') || ANTI_MANIP_VERSION.includes('2.89.7'), ANTI_MANIP_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.7') || ORCHESTRATOR_VERSION.includes('anti-manip'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.7'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'anti_manipulation'), 'lesson');

const clear = detectManipulationSignals({ id: 'rb', name: '螺纹' }, { annotations: [] });
assert(clear.flagged === false, 'clear flagged');
assert(clear.nDisplay === '暂无', clear.nDisplay);
assert(/暂无/.test(clear.display), clear.display);
assert(!/score|评分|0-100|0–100/i.test(JSON.stringify(clear)), 'no fake score');

const human = detectManipulationSignals(
  { id: 'rb' },
  { annotations: [{ annotationType: 'manipulation_risk', reason: '疑似对倒' }] }
);
assert(human.flagged === true && human.source === 'analyst', 'human hard');
assert(human.blockInterrupt === true, 'human block');

const newsOnlyInst = {
  id: 'sc',
  name: '原油',
  factors: { inventory: { stockFlowJoint: { available: false } } },
  capitalAttention: { jointWithInventory: '暂无' },
  technical: { volume: { ratio: 1.8 } },
  dualNarrative: { regime: 'split', display: '内外分裂' },
};
const newsClaim = {
  confidence: '强结构',
  evidenceFor: [{ evidenceType: 'news', summary: '地缘故事', dataSource: 'news' }],
  evidenceAgainst: [],
};
const auto = scanAutoSuspectSignals(newsOnlyInst, newsClaim, {
  narrative: { narrativeAhead: true, alert: '故事超前', contagion: { nDisplay: '12' }, phase: 'spreading' },
});
assert(auto.length >= 2, `auto signals=${auto.length}`);
assert(auto.some((s) => s.id === 'news_only_structure'), 'news only');
assert(auto.some((s) => s.id === 'narrative_ahead'), 'narrative ahead');
assert(auto.every((s) => s.nDisplay), 'signal nDisplay');

const merged = detectManipulationSignals(newsOnlyInst, { annotations: [] }, {
  claim: newsClaim,
  narrative: { narrativeAhead: true, contagion: { nDisplay: '12' }, phase: 'spreading', alert: 'x' },
  dualNarrative: newsOnlyInst.dualNarrative,
});
assert(merged.autoSuspect === true, 'autoSuspect');
assert(merged.flagged === true, 'multi-signal hard flag');
assert(merged.blockInterrupt === true, 'auto hard block');
assert(merged.requiresHumanAck === true, 'needs human ack');

const soft = detectManipulationSignals(
  { id: 'cu', factors: { inventory: { stockFlowJoint: { available: true } } } },
  {},
  {
    claim: { confidence: '弱结构', evidenceFor: [{ evidenceType: 'inventory', summary: '去库' }], evidenceAgainst: [] },
    narrative: { narrativeAhead: true, contagion: { nDisplay: '8' }, phase: 'spreading' },
  }
);
assert(soft.softWatch === true || soft.flagged === false, 'single medium soft');
assert(soft.blockInterrupt === false || soft.softWatch, 'soft no hard block prefer');

const capped = applyManipulationToEvidence(
  [{ evidenceType: 'news', hardness: 0.9, summary: 'h' }],
  soft.softWatch || soft.flagged ? soft : { softWatch: true, newsHardnessCap: 0.4 }
);
assert(capped[0].hardness <= 0.4, `hardness=${capped[0].hardness}`);
assert(capped[0].reliability?.manipulationCapped === true, 'capped flag');

const board = buildAntiManipulationBoard([
  {
    id: 'rb',
    name: '螺纹',
    intelCenter: { antiManipulation: human },
  },
  {
    id: 'sc',
    name: '原油',
    intelCenter: { antiManipulation: merged },
  },
  {
    id: 'cu',
    name: '铜',
    intelCenter: { antiManipulation: soft },
  },
]);
assert(board.counts.flagged >= 1, `flagged=${board.counts.flagged}`);
assert(board.display, board.display);
assert((board.questions || []).length > 0, 'questions');

const q = enrichQuestionQueueWithAntiManip({ all: [], version: 'q' }, board);
assert(q.all.some((x) => x.priorityLabel === '反操纵'), 'queue label');

const pack = buildIntelCenterPack(
  [
    {
      id: 'sc',
      name: '原油',
      factors: { inventory: { stockFlowJoint: { available: false } } },
      capitalAttention: { jointWithInventory: '暂无' },
      technical: { volume: { ratio: 2.0 } },
    },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.antiManipulationBoard?.display, pack.antiManipulationBoard?.display || 'missing board');
assert(pack.stats?.manipulationFlagged != null, 'stats flagged');

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nPASS smoke-intel-anti-manipulation');
