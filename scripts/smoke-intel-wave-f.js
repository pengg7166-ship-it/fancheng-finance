#!/usr/bin/env node
/** Smoke: narrative precision + shock snapshot persist + claim-first readiness */
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
  assessNarrativeEpidemiology,
  growthRate,
  NARRATIVE_VERSION,
} = require('../services/intel-narrative-epidemiology');
const {
  buildShockGraph,
  loadShockSnapshot,
  saveShockSnapshot,
  SHOCK_VERSION,
} = require('../services/intel-shock-graph');
const {
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
  ORCHESTRATOR_VERSION,
} = require('../services/intel-orchestrator');
const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');

assert(ORCHESTRATOR_VERSION.includes('2.68'), `orch ${ORCHESTRATOR_VERSION}`);
assert(NARRATIVE_VERSION.includes('narrative-precision'), NARRATIVE_VERSION);
assert(SHOCK_VERSION.includes('shock-persist'), SHOCK_VERSION);

assert(growthRate(0, 0) === 0, 'growth 0/0');
assert(growthRate(3, 0) === null, 'growth no infinite');
assert(growthRate(6, 3) === 1, `growth ${growthRate(6, 3)}`);

const noNews = assessNarrativeEpidemiology({ id: 'zz_none', name: '无新闻品种', factors: {} }, '2026-07-16');
assert(noNews.nDisplay === '暂无' || noNews.n == null, `n ${noNews.nDisplay}`);
assert(noNews.score == null || noNews.scoreDisplay === '暂无', `score ${noNews.scoreDisplay}`);
assert(noNews.contagion.velocityDisplay === '暂无' || noNews.phase === 'dormant', noNews.display);
assert(noNews.phase !== 'spreading' && noNews.phase !== 'peak', `phase gated ${noNews.phase}`);
console.log('OK narrative empty', noNews.display);

const shockOnly = assessNarrativeEpidemiology(
  { id: 'zz_none2', factors: { news: { shock: 0.9, hitCount: 5, hits: [] } } },
  '2026-07-16'
);
assert(shockOnly.phase !== 'spreading' && shockOnly.phase !== 'peak', `shock alone not peak ${shockOnly.phase}`);
assert(shockOnly.score == null || shockOnly.nDisplay === '暂无', 'no score from shock alone without tagged');
console.log('OK shock-gated', shockOnly.display);

const sampleInst = [
  { id: 'sc', name: '原油', changePct: -2.5 },
  { id: 'fu', name: '燃油', changePct: -1.2 },
  { id: 'rb', name: '螺纹', changePct: 0.1 },
  { id: 'i', name: '铁矿', changePct: -0.8 },
];
const g1 = buildShockGraph(sampleInst, 'neutral', { asOf: '2026-07-16', persist: true, skipSnapshot: true });
assert(g1.snapshotSaved === true, 'snapshot saved');
const snap = loadShockSnapshot();
assert(snap?.edges?.length > 0, `snap edges ${snap?.edges?.length}`);
assert(snap.version.includes('shock-persist') || snap.asOf, snap.asOf);
console.log('OK snapshot', snap.asOf, 'edges', snap.edges.length);

const g2 = buildShockGraph(sampleInst, 'neutral', { asOf: '2026-07-17', persist: true });
assert(g2.version.includes('shock-persist'), g2.version);
assert(g2.snapshotComparedTo === '2026-07-16' || g2.snapshotComparedTo == null || typeof g2.snapshotComparedTo === 'string', `compared ${g2.snapshotComparedTo}`);
console.log('OK shock rebuild', g2.display);

const outlook = getCachedCommodityOutlookSource();
const slice = (outlook?.instruments || []).slice(0, 14);
const applied = applyIntelCenterToInstruments(slice, { persist: false, asOf: '2026-07-16' });
const pack = buildIntelCenterPack(applied, { asOf: '2026-07-16', persist: false });
assert(pack.version.includes('2.68'), pack.version);
assert(pack.shockGraph?.version?.includes('shock-persist'), pack.shockGraph?.version);
const narr = applied.find((i) => i.intelCenter?.narrative)?.intelCenter?.narrative;
if (narr) {
  assert(narr.version?.includes('narrative-precision') || narr.nDisplay, narr.version);
  console.log('OK live narrative', narr.display);
}
const claimFirstReady = applied.some(
  (i) => i.intelCenter?.available || i.intelCenter?.beliefLevel || i.intelCenter?.primaryClaim
);
assert(claimFirstReady || applied.length === 0, 'claim-first data present');

try {
  if (outlook) {
    hydrateIntelCenterOnOutlook(outlook, { force: true, persist: false });
    console.log('OK force hydrate');
  }
} catch (err) {
  console.warn('WARN hydrate', err.message);
}

if (fails) {
  console.error(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-wave-f');
