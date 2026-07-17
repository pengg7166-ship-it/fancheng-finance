#!/usr/bin/env node
/** Smoke: isomorphic path replay + shock edge verify + narrative compartments (v2.89.22 / §24+§22/50) */
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
  CANONICAL_K_VERSION,
  computePathSimilarity,
} = require('../services/intel-isomorphic-k');
const {
  ISO_BOARD_VERSION,
  buildIsomorphicBoard,
} = require('../services/intel-isomorphic-board');
const { CANONICAL_VERSION, CANONICAL_CASES } = require('../services/intel-canonical-cases');
const {
  DYNAMICS_VERSION,
  applyEdgeVerifyDampening,
  loadEdgeVerifyStats,
} = require('../services/intel-shock-dynamics');
const {
  NARRATIVE_VERSION,
  buildNarrativeContagionBoard,
} = require('../services/intel-narrative-epidemiology');
const { ORCHESTRATOR_VERSION } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(CANONICAL_K_VERSION.includes('2.89.22') || CANONICAL_K_VERSION.includes('replay'), CANONICAL_K_VERSION);
assert(ISO_BOARD_VERSION.includes('2.89.22') || ISO_BOARD_VERSION.includes('replay'), ISO_BOARD_VERSION);
assert(CANONICAL_VERSION.includes('2.89.22') || CANONICAL_VERSION.includes('replay'), CANONICAL_VERSION);
assert(DYNAMICS_VERSION.includes('2.89.22') || DYNAMICS_VERSION.includes('edge-verify'), DYNAMICS_VERSION);
assert(NARRATIVE_VERSION.includes('2.89.22') || NARRATIVE_VERSION.includes('transmission'), NARRATIVE_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'isomorphic_path_replay'), 'lesson iso replay');
assert(LESSONS.some((l) => l.id === 'shock_edge_verify'), 'lesson edge verify');
assert(LESSONS.some((l) => l.id === 'narrative_compartment'), 'lesson narr compartment');
assert(CANONICAL_CASES.some((c) => c.id === 'cu_destock_2021'), 'canonical cu_destock_2021');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('intel-iso-replay'), 'hub iso replay');
assert(appSrc.includes('intel-narr-compartment'), 'hub narr compartment');
assert(appSrc.includes('edgeVerifyHit'), 'hub edgeVerifyHit');

const css = fs.readFileSync(path.join(process.cwd(), 'src/intel-center.css'), 'utf8');
assert(css.includes('intel-iso-replay'), 'css iso replay');
assert(css.includes('intel-narr-compartment'), 'css narr compartment');

const damp = applyEdgeVerifyDampening(
  [
    { from: 'sc', to: 'fu', activation: 1, method: 'test' },
    { from: 'cu', to: 'al', activation: 0.8, method: 'test' },
  ],
  {
    'sc->fu': {
      available: true,
      dampen: 0.55,
      hitDisplay: '20.0% (1/5)',
      nDisplay: '5',
    },
    'cu->al': {
      available: false,
      dampen: 1,
      hitDisplay: '暂无',
      nDisplay: '2',
      note: '验证样本不足',
    },
  }
);
assert(damp[0].activation === 0.55, `dampen act ${damp[0].activation}`);
assert(damp[0].activationDamped === true, 'activationDamped');
assert(damp[1].activation === 0.8, 'no damp when n gate');
assert(damp[1].edgeVerify?.hitDisplay === '暂无', '暂无 when unavailable');

const stats = loadEdgeVerifyStats(50);
assert(stats && typeof stats === 'object', 'loadEdgeVerifyStats object');

const board = buildIsomorphicBoard(
  [
    {
      id: 'cu',
      name: '铜',
      intelCenter: {
        canonicalCases: {
          inIsomorphicWatch: true,
          matches: [
            {
              id: 'cu_destock_2021',
              label: '铜去库 2021',
              era: '2021-03~2021-05',
              mechanism: 'destock',
              similarity: 0.7,
              themeScore: 0.6,
              pathSimilarity: {
                available: true,
                score: 0.62,
                n: 40,
                nDisplay: '40',
                display: '路径同构 62% (n=40)',
                histWindow: { start: '2021-03-01', end: '2021-05-31', n: 40 },
                recentWindow: { start: '2026-04-01', end: '2026-06-30', n: 40 },
                pathReplay: {
                  available: true,
                  histWindow: { start: '2021-03-01', end: '2021-05-31', n: 40 },
                  recentWindow: { start: '2026-04-01', end: '2026-06-30', n: 40 },
                  histCloses: [70000, 71000, 72000],
                  recentCloses: [71000, 71500, 73000],
                  nDisplay: '40',
                  display: '2021-03-01→2021-05-31 vs 2026-04-01→2026-06-30 · n=40',
                  dataSource: 'readCachedKlines',
                  method: 'pearson-return-path-replay',
                },
              },
            },
          ],
        },
      },
    },
  ],
  { asOf: '2026-07-17' }
);
assert((board.sampleReplays || []).length >= 1, `sampleReplays ${board.sampleReplays?.length}`);
assert(board.counts.pathReplays >= 1, 'counts.pathReplays');
assert(board.sampleReplays[0].histCloses?.length >= 1, 'histCloses present');
assert(!String(JSON.stringify(board.sampleReplays[0])).includes('generateFake'), 'no fake');

const narr = buildNarrativeContagionBoard([], '2026-07-17');
assert(narr.compartmentCounts?.method === 'discrete-compartment-counts', narr.compartmentCounts?.method);
assert(/非微分方程/.test(narr.compartmentCounts?.note || ''), narr.compartmentCounts?.note);
assert(narr.sir === narr.compartmentCounts || narr.sir?.method === 'discrete-compartment-counts', 'sir alias');
assert(Array.isArray(narr.transmission?.edges), 'transmission.edges array');

if (typeof computePathSimilarity === 'function') {
  const empty = computePathSimilarity('zz_nonexistent_inst_xyz', { era: '2020-01~2020-03', id: 't' }, '2026-07-17');
  assert(empty?.available === false, `missing K honest avail=${empty?.available}`);
}

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-iso-narr-shock-deepen');
