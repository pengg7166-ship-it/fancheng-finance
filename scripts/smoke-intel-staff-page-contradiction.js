#!/usr/bin/env node
/** Smoke: staff-page memo primary + contradiction board (v2.89.21 / §20+§52) */
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
  BOARD_VERSION,
  buildContradictionBoard,
  opposingForceFromMatrix,
} = require('../services/intel-contradiction-board');
const { ORCHESTRATOR_VERSION, enrichContradictionMatrix } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const { PAGE_TONE_VERSION } = require('../services/intel-page-tone');
const fs = require('fs');
const path = require('path');

assert(BOARD_VERSION.includes('contradiction-board') || BOARD_VERSION.includes('2.89.21'), BOARD_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.'), TEACH_VERSION);
assert(PAGE_TONE_VERSION.includes('2.89.21') || PAGE_TONE_VERSION.includes('memo'), PAGE_TONE_VERSION);
assert(LESSONS.some((l) => l.id === 'outlook_memo_primary'), 'lesson memo primary');
assert(LESSONS.some((l) => l.id === 'contradiction_matrix'), 'lesson cmatrix');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('intel-memo-hard'), 'memo hard template');
assert(appSrc.includes('outlook-detail-area-memo-primary'), 'detail memo primary');
assert(appSrc.includes('outlook-scenarios-demoted'), 'scenarios demoted');
assert(appSrc.includes('intel-cmatrix-line'), 'hub cmatrix line');
assert(appSrc.includes('outlook-cmatrix-main'), 'matrix main contradiction');
assert(appSrc.includes('>幕僚</span>'), 'list head 幕僚');

const css = fs.readFileSync(path.join(process.cwd(), 'src/reading-layout.css'), 'utf8');
assert(css.includes('outlook-detail-staff-grid'), 'staff grid css');

const stub = enrichContradictionMatrix({
  intelligenceKernel: {
    mainContradiction: { label: '去库未确认', side: 'bull' },
    dissent: { opposingEvidence: [{ summary: '资金态度偏空' }] },
    stateKey: 'test|destock|bull',
  },
});
assert(stub && stub.mainContradiction === '去库未确认', 'enrich stub main');
assert(stub.forcedDissent === '资金态度偏空', 'enrich stub dissent');
assert(stub.axes.length === 0, 'stub no fake axes');

const board = buildContradictionBoard(
  [
    {
      id: 'cu',
      name: '铜',
      contradictionMatrix: {
        summary: '2 组矛盾',
        conflictCount: 2,
        availableAxes: 4,
        mainContradiction: '去库支撑',
        forcedDissent: '暂无',
        axes: [
          { label: '价格', side: 'bull', sideLabel: '多', display: '+1%' },
          { label: '合证', side: 'bear', sideLabel: '空', display: '累库' },
        ],
        cells: [{ conflict: true, aLabel: '价格', aSide: 'bull', bLabel: '合证', bSide: 'bear' }],
        competingHypotheses: [],
        dataSource: 'test',
      },
      intelligenceKernel: {
        mainContradiction: { label: '去库支撑', side: 'bull' },
        dissent: { opposingEvidence: [] },
      },
    },
    {
      id: 'rb',
      name: '螺纹',
      contradictionMatrix: {
        summary: '轴不足',
        conflictCount: 0,
        availableAxes: 1,
        axes: [{ label: '价格', side: null, display: '暂无' }],
        cells: [],
        competingHypotheses: [],
        forcedDissent: '暂无',
      },
      intelligenceKernel: {
        mainContradiction: { label: '政策预期', side: 'bull' },
        dissent: { opposingEvidence: [] },
      },
    },
    {
      id: 'ag',
      name: '白银',
      contradictionMatrix: {
        summary: '同向',
        conflictCount: 0,
        availableAxes: 3,
        axes: [{ label: '价格', side: 'bull', display: '+2%' }],
        cells: [],
        competingHypotheses: [],
      },
      intelligenceKernel: {
        mainContradiction: { label: '避险溢价', side: 'bull' },
        dissent: { opposingEvidence: [{ summary: '实际利率上行' }] },
      },
    },
  ],
  { asOf: '2026-07-17' }
);

assert(board.available, 'board available');
assert(board.counts.instruments === 3, `instruments ${board.counts.instruments}`);
assert(board.counts.withConflict >= 1, 'withConflict');
assert(board.counts.missingOppose >= 1, `missingOppose ${board.counts.missingOppose}`);
assert(/矛盾矩阵/.test(board.display), board.display);
assert(board.rows.some((r) => r.instrumentId === 'cu' && r.opposingAvailable), 'cu oppose from conflict');
assert(board.rows.some((r) => r.instrumentId === 'rb' && !r.opposingAvailable), 'rb miss oppose');
assert(board.rows.some((r) => r.instrumentId === 'ag' && r.opposingForce.includes('实际利率')), 'ag oppose');

const opp = opposingForceFromMatrix(
  { cells: [], competingHypotheses: [] },
  { dissent: { opposingEvidence: [{ summary: '红队拆台' }] } }
);
assert(opp.available && opp.label.includes('红队'), 'oppose from kernel');

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-staff-page-contradiction');
