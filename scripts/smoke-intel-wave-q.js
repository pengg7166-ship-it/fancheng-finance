#!/usr/bin/env node
/** Smoke: dual narrative executable OS (v2.79) */
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
  DUAL_BOARD_VERSION,
  buildDualNarrativeBoard,
  enrichQuestionQueueWithDual,
  actionPlay,
} = require('../services/intel-dual-board');
const { DUAL_VERSION } = require('../services/intel-dual-narrative');
const { GATE_VERSION, evaluatePublishGate } = require('../services/intel-publish-gates');
const { CHOICE_VERSION, buildChoiceSet } = require('../services/intel-choice-set');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.79'), ORCHESTRATOR_VERSION);
assert(DUAL_BOARD_VERSION.includes('dual-executable'), DUAL_BOARD_VERSION);
assert(DUAL_VERSION.includes('dual-executable'), DUAL_VERSION);
assert(GATE_VERSION.includes('dual'), GATE_VERSION);
assert(CHOICE_VERSION.includes('dual'), CHOICE_VERSION);

const play = actionPlay('split', {
  domestic: { movePct1d: 1.5 },
  external: { movePct1d: -1.2 },
  regimeLabel: '内外叙事分裂',
});
assert(play.primary === 'C', 'play C');
assert(play.doList.some((d) => /Interrupt/.test(d)), 'play interrupt');

const board = buildDualNarrativeBoard(
  [
    {
      id: 'cu',
      name: '沪铜',
      intelCenter: {
        dualNarrative: {
          regime: 'split',
          regimeLabel: '内外叙事分裂',
          splitScore: 0.7,
          display: '内外叙事分裂 · 内盘偏多 · COMEX偏空',
          questionHint: '沪铜：内外叙事分裂 — 套利？',
          domestic: { side: 'bull', label: '内盘偏多', movePct1d: 1.2, n: 80, nDisplay: '80' },
          external: {
            available: true,
            side: 'bear',
            label: 'COMEX偏空',
            movePct1d: -0.9,
            n: 80,
            nDisplay: '80',
          },
          mapped: true,
        },
      },
    },
    {
      id: 'au',
      name: '沪金',
      intelCenter: {
        dualNarrative: {
          regime: 'resonate',
          regimeLabel: '内外共振',
          display: '共振',
          domestic: { side: 'bull', nDisplay: '80' },
          external: { available: true, side: 'bull', nDisplay: '80' },
          mapped: true,
        },
      },
    },
  ],
  { asOf: '2026-07-16' }
);
assert(board.counts.split === 1, `split ${board.counts.split}`);
assert(board.questions.some((q) => q.blockInterrupt && q.preferChoiceC), 'Q flags');
const q = enrichQuestionQueueWithDual({ all: [], version: 't' }, board);
assert((q.dualInjected || 0) >= 1, `injected ${q.dualInjected}`);

const dualInst = {
  id: 'cu',
  dualNarrative: board.rows[0] && {
    regime: 'split',
    regimeLabel: '内外叙事分裂',
    display: '分裂',
    domestic: { nDisplay: '80' },
    external: { nDisplay: '80' },
  },
};
const cs = buildChoiceSet(
  dualInst,
  { claimId: 'c1', side: 'bull', confidence: '弱结构', status: 'active', n: 40, triggers: [{ type: 'falsify', condition: 'x' }] },
  { state: 'unpriced' },
  {},
  null,
  null
);
assert(cs.primaryId === 'C', `choice ${cs.primaryId}`);
assert(cs.dualSplit?.preferChoiceC, 'choice dual flag');
assert(/内外分裂偏C/.test(cs.display), cs.display);

const gateI = evaluatePublishGate(
  dualInst,
  { confidence: '弱结构', status: 'active', n: 40, evidenceFor: [1, 2], evidenceAgainst: [1], triggers: [1], validUntil: '2099-01-01' },
  { nextCheckpoint: 'x' },
  { state: 'unpriced' },
  'interrupt',
  { dualNarrative: dualInst.dualNarrative }
);
assert(!gateI.pass, 'interrupt blocked');
assert(gateI.blockedReasons.some((r) => /内外/.test(r)), gateI.blockedReasons.join(','));

const gateMemo = evaluatePublishGate(
  { ...dualInst, dataQuality: 5 },
  { confidence: '叙事分歧', status: 'active', n: 40, evidenceFor: [1], evidenceAgainst: [1], triggers: [1], validUntil: '2099-01-01' },
  { nextCheckpoint: 'x' },
  { state: 'unpriced' },
  'memo',
  { dualNarrative: dualInst.dualNarrative }
);
const dualCheck = (gateMemo.checks || []).find((c) => c.id === 'dual_not_split');
assert(dualCheck?.pass === true, `memo dual check pass=${dualCheck?.pass}`);
assert(gateMemo.maxConfidence === '叙事分歧' || gateMemo.pass, `memo cap ${gateMemo.maxConfidence}`);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 1.2 },
    { id: 'au', name: '沪金', changePct: 0.3 },
    { id: 'sc', name: '原油', changePct: -0.5 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
  ],
  { asOf: '2026-07-16', persist: false }
);
assert(pack.version.includes('2.79'), pack.version);
assert(pack.dualBoard?.version?.includes('dual'), pack.dualBoard?.version || 'no board');
assert(typeof pack.dualBoard.display === 'string', pack.dualBoard.display);
assert(pack.faceViews?.research?.dualBoard || pack.stats?.dualSplit != null, 'research/stats');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-q dual-exec');
process.exit(fails ? 1 : 0);
