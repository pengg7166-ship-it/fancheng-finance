#!/usr/bin/env node
/** Smoke: P5 SIR ceiling + commander workbar · P6 edge catalog + shared mech (v2.89.23) */
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
  buildDiscreteSirCensus,
  buildSirCeiling,
  buildNarrativeContagionBoard,
  computeThemeTransmissionDynamics,
} = require('../services/intel-narrative-epidemiology');
const {
  CATALOG_VERSION,
  buildShockEdgeCatalog,
} = require('../services/intel-shock-edge-catalog');
const {
  SHARED_MECH_VERSION,
  buildSharedMechanismChains,
} = require('../services/intel-shared-mechanism-chain');
const { SHOCK_VERSION } = require('../services/intel-shock-graph');
const { MECHANISM_BOARD_VERSION, buildMechanismBoard } = require('../services/intel-mechanism-board');
const {
  FACE_CONTRACT_VERSION,
  buildCommanderWorkbar,
} = require('../services/intel-face-contracts');
const { ORCHESTRATOR_VERSION } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(NARRATIVE_VERSION.includes('2.89.23') || NARRATIVE_VERSION.includes('sir-ceiling'), NARRATIVE_VERSION);
assert(CATALOG_VERSION.includes('2.89.23'), CATALOG_VERSION);
assert(SHARED_MECH_VERSION.includes('2.89.23'), SHARED_MECH_VERSION);
assert(SHOCK_VERSION.includes('2.89.23') || SHOCK_VERSION.includes('catalog'), SHOCK_VERSION);
assert(MECHANISM_BOARD_VERSION.includes('2.89.23') || MECHANISM_BOARD_VERSION.includes('shared'), MECHANISM_BOARD_VERSION);
assert(FACE_CONTRACT_VERSION.includes('2.89.23') || FACE_CONTRACT_VERSION.includes('commander'), FACE_CONTRACT_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'narrative_sir_ceiling'), 'lesson sir ceiling');
assert(LESSONS.some((l) => l.id === 'shock_edge_catalog'), 'lesson edge catalog');
assert(LESSONS.some((l) => l.id === 'shared_mechanism_chain'), 'lesson shared mech');
assert(LESSONS.some((l) => l.id === 'commander_workbar'), 'lesson commander');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('intel-narr-sir'), 'hub narr sir');
assert(appSrc.includes('intel-edge-catalog'), 'hub edge catalog');
assert(appSrc.includes('intel-shared-mech'), 'hub shared mech');
assert(appSrc.includes('intel-commander-workbar'), 'hub commander');

const narrSrc = fs.readFileSync(path.join(process.cwd(), 'services/intel-narrative-epidemiology.js'), 'utf8');
assert(!/\bfitOde\b|\bestimateBeta\b|\bodeSolve\b/i.test(narrSrc), 'no ode fit symbols');
assert(narrSrc.includes('odeFitted: false'), 'odeFitted false');

const census = buildDiscreteSirCensus(
  {
    byTheme: {
      stimulus: {
        themeId: 'stimulus',
        themeLabel: '刺激',
        instrumentCount: 3,
        infected: [
          { id: 'rb', role: 'seed', infectionAgeDays: 2 },
          { id: 'hc', role: 'adopter', infectionAgeDays: 5 },
          { id: 'i', role: 'late', infectionAgeDays: 20 },
        ],
        lagStats: { available: true, lagStatsDisplay: '中位滞后 3日 (n=2)', medianLagDays: 3 },
        R0Display: '2 (2/1)',
        nDisplay: '10',
      },
    },
  },
  [{ id: 'rb' }, { id: 'hc' }, { id: 'i' }, { id: 'j' }],
  '2026-07-17'
);
assert(census.available, 'census available');
assert(census.S === 1, `S=${census.S}`);
assert(census.I === 2, `I=${census.I}`);
assert(census.R === 1, `R=${census.R}`);
assert(census.odeFitted === false, 'census odeFitted');
assert(census.method === 'discrete-sir-census', census.method);

const ceiling = buildSirCeiling(census);
assert(ceiling.odeFitted === false && ceiling.differentialEq === false, 'ceiling rejects ode');

const emptyBoard = buildNarrativeContagionBoard([], '2026-07-17');
assert(emptyBoard.sirCeiling?.odeFitted === false, 'board sirCeiling');
assert(emptyBoard.sirCensus, 'board sirCensus');

const catalog = buildShockEdgeCatalog(
  [
    { from: 'sc', to: 'fu', label: '原油→燃油', mechanism: 'cost', available: true, corr: 0.7, n: 80, nDisplay: '80' },
    { from: 'cu', to: 'al', label: '铜→铝', mechanism: 'sentiment', available: false, corr: null, n: 5, nDisplay: '5' },
  ],
  {
    'sc->fu': { available: true, hitDisplay: '60.0% (3/5)', nDisplay: '5', dampen: 1 },
  }
);
assert(catalog.counts.catalog === 2, 'catalog size');
assert(catalog.counts.verifiedReady === 1, 'verifiedReady');
assert(catalog.topVerified[0].edgeVerify.hitDisplay.includes('%'), catalog.topVerified[0].edgeVerify.hitDisplay);
assert(catalog.rows.find((r) => r.from === 'cu').edgeVerify.hitDisplay === '暂无', 'cu hit 暂无');

const shared = buildSharedMechanismChains(
  {
    edgeCatalog: catalog,
    activeEdges: catalog.rows.filter((r) => r.available),
  },
  [{ id: 'sc', name: '原油' }, { id: 'fu', name: '燃油' }, { id: 'cu', name: '铜' }, { id: 'al', name: '铝' }]
);
assert(shared.counts.sharedChains >= 1, 'shared chains');
assert(shared.top.length >= 1 || shared.chains.length >= 1, 'shared top/chains');
assert(/覆盖|环|暂无/.test(shared.display), shared.display);

const mech = buildMechanismBoard(
  { activeEdges: [{ from: 'sc', to: 'fu', label: '原油→燃油', mechanism: 'cost', corr: 0.7, n: 80, nDisplay: '80', activation: 0.5 }], pendingEdges: [], edgeCatalog: catalog },
  [{ id: 'sc' }, { id: 'fu' }],
  { asOf: '2026-07-17' }
);
assert(mech.sharedChains?.counts?.sharedChains >= 1, 'mech sharedChains');

const bar = buildCommanderWorkbar({
  interruptChannel: { pendingCount: 2, commandDeck: { pendingCount: 1, escalatedCount: 0 } },
  debtBoard: { opsPlan: { items: [{ id: 1 }] } },
  processScorecard: { pendingWeightChanges: [{ id: 'w1' }] },
  quietBrakeBoard: { falseQuietRisk: true, falseQuietLoop: { status: 'open' } },
});
assert(bar.totalPending >= 4, `pending ${bar.totalPending}`);
assert(bar.productShell === false, 'not full OS');
assert(bar.cmds.length === 5, 'five cmds');

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-p5-p6-sir-catalog-shared');
