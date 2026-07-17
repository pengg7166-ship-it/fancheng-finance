#!/usr/bin/env node
/** Smoke: P7 face shells + commander orders · P8 anti-pattern board (v2.89.24) */
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
  FACE_CONTRACT_VERSION,
  FACE_SHELL_LAYOUTS,
  buildFaceShellLayout,
  buildCommanderWorkbar,
  buildFaceContractBoard,
} = require('../services/intel-face-contracts');
const {
  ANTI_PATTERN_VERSION,
  buildAntiPatternBoard,
} = require('../services/intel-anti-pattern-board');
const { ORCHESTRATOR_VERSION } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(FACE_CONTRACT_VERSION.includes('2.89.24') || FACE_CONTRACT_VERSION.includes('shell'), FACE_CONTRACT_VERSION);
assert(ANTI_PATTERN_VERSION.includes('2.89.24'), ANTI_PATTERN_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'face_shell_layout'), 'lesson face shell');
assert(LESSONS.some((l) => l.id === 'commander_order_queue'), 'lesson order queue');
assert(LESSONS.some((l) => l.id === 'anti_pattern_board'), 'lesson anti pattern');

const shells = ['decision', 'research', 'execution'].map((id) => buildFaceShellLayout(id));
assert(shells[0].shellLayoutId === 'cmd-brief', shells[0].shellLayoutId);
assert(shells[1].shellLayoutId === 'lab-depth', shells[1].shellLayoutId);
assert(shells[2].shellLayoutId === 'trigger-strip', shells[2].shellLayoutId);
assert(shells.every((s) => s.independentApp === false), 'not independent apps');
assert(
  new Set(shells.map((s) => s.shellLayoutId)).size === 3,
  'three distinct shells'
);

const bar = buildCommanderWorkbar({
  interruptChannel: {
    pendingCount: 1,
    commandDeck: {
      pendingCount: 1,
      escalatedCount: 1,
      next: { key: 'k1', headline: '螺纹证伪', instrumentId: 'rb', instrumentName: '螺纹' },
    },
  },
  debtBoard: { opsPlan: { pendingRunnable: 2, items: [{ id: 1 }, { id: 2 }] } },
  processScorecard: {
    pendingWeightChanges: [{ id: 'w1' }],
    weightProposal: { proposalId: 'prop-1' },
  },
  quietBrakeBoard: { falseQuietRisk: true, falseQuietLoop: { status: 'open' } },
});
assert(bar.productShell === false, 'productShell false');
assert(bar.orderQueue?.pending >= 3, `orders ${bar.orderQueue?.pending}`);
assert(bar.orders.some((o) => o.kind === 'interrupt'), 'interrupt order');
assert(bar.orders.some((o) => o.kind === 'debt'), 'debt order');
assert(bar.orders.some((o) => o.kind === 'weight'), 'weight order');
assert(bar.orders.some((o) => o.kind === 'falseQuiet'), 'fq order');

const board = buildFaceContractBoard({
  decision: { deliveryBrief: { counts: { p0: 2, interrupts: 1, stripped: 3 } }, questionQueue: { p0: [1, 2] }, interrupts: [{}], faceContract: { label: '决策者', deliveryContract: 'x' } },
  research: {
    deliveryBrief: { counts: { p0: 5, interrupts: 0, stripped: 0 } },
    shockGraph: { display: '冲击' },
    playbookBoard: { display: '剧本' },
    debtBoard: { weeklyMustPay: 1 },
    faceContract: { label: '研究员', deliveryContract: 'y' },
  },
  execution: {
    deliveryBrief: { counts: { p0: 1, interrupts: 1, stripped: 5 } },
    faceContract: { label: '执行者', deliveryContract: 'z' },
  },
});
assert(board.shellsDiffer === true, 'shellsDiffer');
assert(board.independentApp === false, 'board not independent');

const emptyAp = buildAntiPatternBoard({}, [], { asOf: '2026-07-17' });
assert(emptyAp.available === false, 'empty anti pattern');
assert(/暂无/.test(emptyAp.display), emptyAp.display);
assert(emptyAp.hits.length === 0, 'no fake hits');

const hitAp = buildAntiPatternBoard(
  {
    evidenceAuditBoard: {
      top: [
        {
          instrumentId: 'cu',
          instrumentName: '铜',
          issues: [
            { id: 'fake_suspect', label: '假数嫌疑' },
            { id: 'missing_against', label: '缺反对' },
            { id: 'all_n_missing', label: '全无 n' },
          ],
        },
      ],
      counts: { missingAgainst: 1 },
    },
    mechanismBoard: {
      honestyDenied: [{ from: 'sc', to: 'fu', label: '原油→燃油', nDisplay: '80' }],
    },
    narrativeContagion: {
      ahead: [{ instrumentId: 'rb', instrumentName: '螺纹', themeLabel: '基建', nDisplay: '3' }],
    },
    museumBoard: {
      activeWarnings: [{ instrumentId: 'i', instrumentName: '铁矿', display: '重蹈警告' }],
    },
  },
  [],
  { asOf: '2026-07-17' }
);
assert(hitAp.available === true, 'hit available');
assert(hitAp.counts.hitTypes >= 4, `hitTypes ${hitAp.counts.hitTypes}`);
assert(hitAp.catalog.some((c) => c.id === 'fake_data_risk'), 'fake type');
assert(hitAp.catalog.every((c) => c.nDisplay && c.nDisplay !== ''), 'n on catalog');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('data-intel-shell'), 'hub shell attr');
assert(appSrc.includes('intel-commander-order-queue'), 'hub order queue');
assert(appSrc.includes('intel-anti-pattern'), 'hub anti pattern');
assert(Object.keys(FACE_SHELL_LAYOUTS).length === 3, '3 layouts');

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-p7-p8-shell-antipattern');
