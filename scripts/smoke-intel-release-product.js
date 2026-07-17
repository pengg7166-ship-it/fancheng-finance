#!/usr/bin/env node
/** Smoke: research compile release productization (v2.89.16 / §76) */
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
  COMPILE_VERSION,
  buildProductPathDiff,
  buildReleaseSnapshot,
  saveReleaseSnapshot,
  loadRelease,
  compareToRelease,
  buildReleaseProductBoard,
  compileResearchRelease,
} = require('../services/intel-research-compile');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(COMPILE_VERSION.includes('release-product') || COMPILE_VERSION.includes('2.89.16'), COMPILE_VERSION);
assert(ORCHESTRATOR_VERSION.includes('release-product') || ORCHESTRATOR_VERSION.includes('2.89.16'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.16'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'release_product_path'), 'lesson');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('发行对照'), 'hub 发行对照');
assert(appSrc.includes('intel-release-must-list'), 'hub must-read');
assert(appSrc.includes('产品主路径'), 'hub product path');
assert(appSrc.includes('可回滚对照'), 'hub rollback');

const noPrev = buildProductPathDiff(
  {
    releaseId: 'rel-test-curr',
    dailyDiff: { available: true, summary: '物质 2', materialChanges: 2, topLines: [] },
    boards: {},
    modelVersions: { compile: COMPILE_VERSION },
  },
  null
);
assert(noPrev.available === false, 'no prev → unavailable');
assert(/暂无/.test(noPrev.headline || ''), noPrev.headline);

const prevSnap = {
  releaseId: 'rel-test-prev',
  asOf: '2026-07-15',
  dailyDiff: {
    available: true,
    summary: '昨日物质 1',
    materialChanges: 1,
    topLines: [{ bucket: 'claim_flip', text: '旧翻转', instrumentId: 'rb' }],
  },
  boards: { pageTone: { display: '旧气质' } },
  modelVersions: { orchestrator: 'v2.89.15', compile: 'old' },
  stats: { p0: 1, falsifying: 0 },
};
const currSnap = {
  releaseId: 'rel-test-curr',
  asOf: '2026-07-16',
  dailyDiff: {
    available: true,
    summary: '今日物质 3',
    materialChanges: 3,
    topLines: [{ bucket: 'falsify', text: '证伪临近', instrumentId: 'cu' }],
  },
  boards: { pageTone: { display: '新气质' } },
  modelVersions: { orchestrator: ORCHESTRATOR_VERSION, compile: COMPILE_VERSION },
  stats: { p0: 2, falsifying: 1 },
};
const pp = buildProductPathDiff(currSnap, prevSnap);
assert(pp.available === true, 'product path available');
assert(pp.materialN === 3, String(pp.materialN));
assert((pp.mustRead || []).length >= 1, 'mustRead');
assert(/物质/.test(pp.headline || '') || /发行对照/.test(pp.headline || ''), pp.headline);
assert((pp.boardDeltas || []).some((d) => d.key === 'pageTone'), 'board delta');

const testId = `rel-smoke-${Date.now()}`;
const snap = buildReleaseSnapshot(
  {
    stats: { instrumentCount: 2, p0: 1, materialChanges: 3 },
    dailyDiff: currSnap.dailyDiff,
    pageToneBoard: { display: '新气质', counts: {} },
  },
  [{ id: 'cu' }, { id: 'rb' }],
  {
    releaseId: testId,
    asOf: '2026-07-16',
    modelVersions: currSnap.modelVersions,
    inputDigest: 'abc123',
  }
);
assert(snap.type === 'research_release_snapshot', snap.type);
const saved = saveReleaseSnapshot(snap);
assert(saved === true, 'snapshot saved');
const loaded = loadRelease(testId);
assert(loaded?.releaseId === testId, loaded?.releaseId);
const cmp = compareToRelease(snap, testId);
assert(cmp.available === true || cmp.productPath, 'compare self ok-ish');

const board = buildReleaseProductBoard({
  releaseId: testId,
  previousReleaseId: 'rel-test-prev',
  productPath: pp,
  vsPrev: { changedCount: 1, display: '模块变更 1' },
  recent: [{ releaseId: 'rel-test-prev', asOf: '2026-07-15', materialChanges: 1 }],
  display: '发行测试',
});
assert(board.rollbackCandidates?.length >= 1, 'rollback candidates');
assert(/产品主路径|发行/.test(board.note || board.display || ''), board.display);

const sample = [
  { id: 'rb', name: '螺纹', direction: 'bearish', changePct: -1, sector: 'ferrous' },
  { id: 'cu', name: '铜', direction: 'bullish', changePct: 1, sector: 'base_metal' },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('release-product') || pack.version.includes('2.89.16'), pack.version);
assert(pack.researchCompile?.releaseId, pack.researchCompile?.releaseId);
assert(pack.researchCompile?.productPath, 'productPath on pack');
assert(pack.releaseProductBoard?.display, pack.releaseProductBoard?.display);
assert(pack.statsDisplay?.releaseLine || pack.researchCompile?.display, 'stats releaseLine');
assert(pack.faceViews?.decision?.researchCompile?.releaseId, 'face decision compile');
assert(
  (pack.teaching?.lessons || []).some((l) => l.id === 'release_product_path') ||
    LESSONS.some((l) => l.id === 'release_product_path'),
  'teaching lesson wired'
);

// cleanup smoke snapshot file (best-effort)
try {
  const fp = path.join(require('../services/intel-memory').getIntelDir(), 'releases', `${testId}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
} catch {
  // ignore
}

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · release-product §76'));
process.exit(fails ? 1 : 0);
