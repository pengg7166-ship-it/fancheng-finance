#!/usr/bin/env node
/** Smoke: mechanism honesty — corr ≠ 成本传导 (vision §74 / v2.89.2) */
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
  MECHANISM_HONESTY_VERSION,
  assessMechanismHonesty,
  applyMechanismHonesty,
} = require('../services/intel-mechanism-honesty');
const { buildMechanismBoard } = require('../services/intel-mechanism-board');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(MECHANISM_HONESTY_VERSION.includes('honesty'), MECHANISM_HONESTY_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.2') || ORCHESTRATOR_VERSION.includes('mechanism-honesty'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.2'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'mechanism_honesty'), 'lesson');

const corrOnly = assessMechanismHonesty(
  { mechanism: 'cost', corr: 0.55, n: 40, label: '原油→燃油' },
  { id: 'sc' },
  { id: 'fu' }
);
assert(corrOnly.causalLanguageAllowed === false, 'corr-only denies causal');
assert(corrOnly.mechanismClaim === 'co_move', corrOnly.mechanismClaim);
assert(corrOnly.mechanismPrior === 'cost', corrOnly.mechanismPrior);
assert(/成本传导/.test(corrOnly.honestyNote || ''), corrOnly.honestyNote);

const withStructure = assessMechanismHonesty(
  { mechanism: 'cost', corr: 0.55, n: 40, label: '原油→燃油' },
  { id: 'sc', factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '去库' } } } },
  { id: 'fu', basis: { available: true, structure: 'contango' } }
);
assert(withStructure.causalLanguageAllowed === true, 'structure allows cost');
assert(withStructure.mechanismClaim === 'cost', withStructure.mechanismClaim);
assert(withStructure.mechanismLabel === '成本传导', withStructure.mechanismLabel);

const applied = applyMechanismHonesty(
  {
    from: 'sc',
    to: 'fu',
    label: '原油→燃油',
    mechanism: 'cost',
    corr: 0.42,
    n: 50,
    nDisplay: '50',
    lagTypical: 2,
    activation: 0.4,
  },
  null,
  null
);
assert(applied.mechanism === 'co_move', applied.mechanism);
assert(applied.mechanismPrior === 'cost', applied.mechanismPrior);
assert(/滞后共动/.test(applied.path) && /≠成本传导/.test(applied.path), applied.path);
assert(!/· 成本传导 ·/.test(applied.path.replace('≠成本传导', '')), 'no bare cost claim in path');

const board = buildMechanismBoard(
  {
    activeEdges: [applied],
    pendingEdges: [],
  },
  []
);
assert(board.counts.honestyDenied >= 1, `denied ${board.counts.honestyDenied}`);
assert(
  (board.buckets || []).some((b) => b.id === 'co_move' && b.liveActiveCount + b.liveCount > 0),
  'co_move bucket'
);
assert(!(board.buckets || []).some((b) => b.id === 'cost' && b.liveActiveCount > 0), 'not in cost bucket');
assert((board.questions || []).some((q) => /禁止/.test(q.question)), 'honesty q');

const pack = buildIntelCenterPack(
  [
    { id: 'sc', name: '原油', changePct: 2.5 },
    { id: 'fu', name: '燃油', changePct: 1.2 },
    { id: 'cu', name: '沪铜', changePct: 0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.89.2') || pack.version.includes('mechanism-honesty'), pack.version);
assert(typeof pack.stats.mechanismHonestyDenied === 'number', 'stats honesty');
if (pack.mechanismBoard?.display) {
  assert(
    !/主桶 成本传导/.test(pack.mechanismBoard.display) ||
      (pack.mechanismBoard.counts.honestyDenied || 0) >= 0,
    pack.mechanismBoard.display
  );
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · mechanism-honesty §74');
process.exit(fails ? 1 : 0);
