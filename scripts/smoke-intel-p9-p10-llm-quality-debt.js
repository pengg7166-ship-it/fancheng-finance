#!/usr/bin/env node
/** Smoke: P9 LLM boundary + P10/Q1 prediction quality debt repayment (v2.89.26) */
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
  LLM_BOUNDARY_VERSION,
  assertLlmOutputWithinFacts,
  composeBoundedSystemPrompt,
  buildLlmBoundaryBoard,
  gateLlmText,
} = require('../services/intel-llm-boundary');
const {
  QUALITY_DEBT_VERSION,
  buildPredictionQualityDebtBoard,
  loadLatestAcceptWalkForward,
  loadCalibrationGaps,
} = require('../services/intel-prediction-quality-debt');
const { ORCHESTRATOR_VERSION } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(LLM_BOUNDARY_VERSION.includes('2.89.25') || LLM_BOUNDARY_VERSION.includes('2.89.26'), LLM_BOUNDARY_VERSION);
assert(QUALITY_DEBT_VERSION.includes('2.89.26'), QUALITY_DEBT_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.26'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.26'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'llm_boundary'), 'lesson llm');
assert(LESSONS.some((l) => l.id === 'prediction_quality_debt'), 'lesson quality debt');

const facts = {
  close: 72500,
  hitDisplay: '48.6% (168/346)',
  nDisplay: '346',
  posture: 'observe',
};
const pass = assertLlmOutputWithinFacts('铜收盘 72500，方向命中 48.6% (168/346)，观望。', facts);
assert(pass.ok === true && pass.blocked === false, 'allowlisted pass');

const blockPrice = assertLlmOutputWithinFacts('建议买入，目标价 99999 元。', facts);
assert(blockPrice.blocked === true, 'block invented price');
assert(blockPrice.reasons.some((r) => /invented_price|bare_pct/.test(r)), blockPrice.reasons.join(','));

const blockBare = assertLlmOutputWithinFacts('命中率已提升到 72%。', { close: 1 });
assert(blockBare.blocked === true, 'block bare hit pct');

const blockInventedHit = assertLlmOutputWithinFacts('命中 99.9% (999/1000)', facts);
assert(blockInventedHit.blocked === true, 'block invented hit');

const gated = gateLlmText('目标价 88888', facts, { fallback: '规则摘要' });
assert(gated.used === false && gated.text === '规则摘要', 'fallback on block');

const composed = composeBoundedSystemPrompt('narrative_polish', '你是助手。');
assert(composed.systemPrompt.includes('边界硬约束'), 'bounded prompt');
assert(Array.isArray(composed.allowedRoles), 'allowed roles');

const board = buildLlmBoundaryBoard({}, { asOf: '2026-07-17' });
assert(board.hardSandbox === false, 'board hardSandbox false');
assert(board.outputGate === true, 'outputGate');

const qdEmpty = buildPredictionQualityDebtBoard({}, { asOf: '2026-07-17', walkForward: null });
assert(qdEmpty.improvementClaim === false, 'no improvement claim');
assert(/暂无|质量债/.test(qdEmpty.display), qdEmpty.display);

const qd = buildPredictionQualityDebtBoard(
  {
    processLearning: {
      directionHit: '48.6% (24/50)',
      processCorrect: '62.0% (31/50)',
      dirWrongProcessRightDisplay: '14.0% (7/50)',
      sampleN: 50,
    },
  },
  {
    asOf: '2026-07-17',
    walkForward: {
      hitDisplay: '48.6% (168/346)',
      scored: 346,
      hits: 168,
      hitRate: 48.6,
      instrumentsScored: 26,
      days: 40,
      byInst: [
        { id: 'zz', name: '欠样', scored: 3, hits: 1, hitDisplay: '33.3% (1/3)' },
        { id: 'xx', status: 'skip_no_bars', bars: 12, scored: 0 },
        { id: 'yy', scored: 0, hits: 0 },
      ],
      worst: [{ id: 'zn', name: '锌', scored: 12, hitDisplay: '25.0% (3/12)' }],
      dataSource: 'fixture',
      method: 'test',
    },
  }
);
assert(qd.walkForward.hitDisplay === '48.6% (168/346)', qd.walkForward.hitDisplay);
assert(qd.archive.processCorrect.includes('62.0%'), qd.archive.processCorrect);
assert(qd.sampleDebt.undersampled.length >= 1, 'undersampled from byInst');
assert(qd.sampleDebt.skipped.length >= 1, 'skipped from byInst');
assert(qd.repayment.items.length >= 1, 'repayment actions');
assert(qd.repayment.improvementClaim === false, 'repay no improve claim');
assert(qd.calibrationGaps && typeof qd.calibrationGaps.display === 'string', 'calib gaps');
assert(qd.improvementClaim === false, 'improvement false');
assert(/工程PASS≠准/.test(qd.display), qd.display);
assert(/还债动作/.test(qd.display), qd.display);

const gaps = loadCalibrationGaps();
assert(typeof gaps.display === 'string', gaps.display);
console.log('OK calib gaps', gaps.display);

const snap = loadLatestAcceptWalkForward();
if (snap) {
  assert(/\d+\.\d+%\s*\(\d+\/\d+\)/.test(snap.hitDisplay) || snap.hitDisplay === '暂无', snap.hitDisplay);
  console.log('OK accept snapshot', snap.hitDisplay, 'byInst', (snap.byInst || []).length);
} else {
  console.log('OK accept snapshot missing (honest)');
}

const fusion = fs.readFileSync(path.join(process.cwd(), 'services/fancheng-ai-fusion.js'), 'utf8');
assert(fusion.includes('gateLlmText') && fusion.includes('intel-llm-boundary'), 'fusion wired');
const cursor = fs.readFileSync(path.join(process.cwd(), 'services/cursor-llm-client.js'), 'utf8');
assert(cursor.includes('gateLlmText') && cursor.includes('boundary-blocked'), 'cursor wired');
const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('intel-llm-boundary-line'), 'hub llm strip');
assert(appSrc.includes('intel-quality-debt'), 'hub quality debt');
assert(appSrc.includes('intel-quality-debt-repay'), 'hub repay list');
assert(appSrc.includes('intel-quality-debt-calib'), 'hub calib line');

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-p9-p10-llm-quality-debt');
