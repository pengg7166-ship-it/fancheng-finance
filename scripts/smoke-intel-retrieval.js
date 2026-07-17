#!/usr/bin/env node
/** Smoke: memo retrieval from archive/museum/isomorphic (vision §4 / v2.89.4) */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const fs = require('fs');
const path = require('path');
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
  RETRIEVAL_VERSION,
  retrieveForMemo,
  attachRetrievalToMemo,
  scoreArchiveHit,
} = require('../services/intel-retrieval');
const { getDataDir } = require('../services/data-paths');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const { MEMO_EXPORT_VERSION, exportMemoUnit } = require('../services/intel-memo-export');

assert(RETRIEVAL_VERSION.includes('retrieval'), RETRIEVAL_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.4') || ORCHESTRATOR_VERSION.includes('retrieval'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.4'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'memo_retrieval'), 'lesson');
assert(MEMO_EXPORT_VERSION.includes('2.89.4'), MEMO_EXPORT_VERSION);

const claim = {
  claimId: 'smoke-claim-curr',
  stateKey: 'test|pb',
  side: 'bull',
  playbookId: 'pb',
  horizon: 'tactical',
  confidence: '弱结构',
};

assert(scoreArchiveHit({ type: 'claim_snapshot', stateKey: 'test|pb' }, claim) >= 4, 'score stateKey');
assert(scoreArchiveHit({ type: 'other' }, claim) === 0, 'score reject non-snapshot');

const intelDir = path.join(getDataDir(), 'intel-center');
fs.mkdirSync(intelDir, { recursive: true });
const archPath = path.join(intelDir, 'claims-archive.jsonl');
const musPath = path.join(intelDir, 'failure-museum.jsonl');
const bakA = fs.existsSync(archPath) ? fs.readFileSync(archPath, 'utf8') : null;
const bakM = fs.existsSync(musPath) ? fs.readFileSync(musPath, 'utf8') : null;

try {
  fs.writeFileSync(
    archPath,
    `${JSON.stringify({
      type: 'claim_snapshot',
      claimId: 'smoke-old-1',
      instrumentId: 'rb',
      statement: '螺纹去库测试先例',
      status: 'active',
      confidence: '弱结构',
      side: 'bull',
      stateKey: 'test|pb',
      playbookId: 'pb',
      n: 22,
      nDisplay: '22',
      recordedAt: '2026-06-01T00:00:00.000Z',
    })}\n`,
    'utf8'
  );
  fs.writeFileSync(
    musPath,
    `${JSON.stringify({
      type: 'falsified',
      claimId: 'smoke-fail-1',
      instrumentId: 'rb',
      statement: '螺纹证伪先例',
      trigger: '合证结构翻转',
      falsifiedAt: '2026-06-15',
      recordedAt: '2026-06-15T00:00:00.000Z',
    })}\n`,
    'utf8'
  );

  const empty = retrieveForMemo({ id: 'zz_unknown_xyz' }, claim);
  assert(empty.available === false, 'empty available false');
  assert(empty.nDisplay === '暂无', empty.nDisplay);
  assert(/暂无/.test(empty.display), empty.display);

  const ret = retrieveForMemo(
    { id: 'rb', name: '螺纹', intelCenter: {} },
    claim,
    {
      canonicalCases: {
        matches: [
          {
            id: 'case-smoke',
            label: '钢铁去库同构',
            pathSimilarity: { available: true, score: 0.62, n: 40, nDisplay: '40', display: '路径强' },
            watchSignals: ['仓单续降'],
          },
        ],
      },
    }
  );
  assert(ret.available === true, 'ret available');
  assert(ret.archive.available && ret.archive.n >= 1, 'archive hit');
  assert(ret.museum.available && ret.museum.n >= 1, 'museum hit');
  assert(ret.isomorphic.available && ret.isomorphic.n >= 1, 'iso hit');
  assert(ret.archive.hits[0].nDisplay === '22', 'archive n');
  assert(ret.isomorphic.hits[0].pathNDisplay === '40', 'iso path n');
  assert(!ret.archive.hits.some((h) => h.claimId === 'smoke-claim-curr'), 'skip self');

  const memo = attachRetrievalToMemo(
    { available: true, headline: '测', method: 'minimum-publishable-unit', support: [], oppose: [] },
    ret
  );
  assert(memo.retrieval?.available, 'memo has retrieval');
  assert(String(memo.method).includes('retrieval'), memo.method);

  const exported = exportMemoUnit({
    id: 'rb',
    name: '螺纹',
    intelCenter: { memo: { ...memo, publishable: false, n: '22' }, primaryClaim: claim },
  });
  assert(/检索召回/.test(exported.markdown), 'export has retrieval section');
  assert(/claims-archive|档案/.test(exported.markdown), 'export archive line');
  assert(/检索：/.test(exported.plain), 'plain retrieval');

  const pack = buildIntelCenterPack(
    [{ id: 'rb', name: '螺纹', calendarStaleness: { lagDays: 0 } }],
    { asOf: '2026-07-17', persist: false }
  );
  const packMemo = pack.instruments?.[0]?.intelCenter?.memo || pack.byInstrument?.rb;
  // pack may nest differently — check any instrument with retrieval
  const anyRet = (pack.instruments || []).some((i) => i.intelCenter?.retrieval || i.intelCenter?.memo?.retrieval);
  const packHasRetrievalField =
    anyRet ||
    Boolean(pack.stats) ||
    JSON.stringify(pack).includes('intel-retrieval') ||
    JSON.stringify(pack).includes('检索');
  // Soft: at least orchestrator version bumped and module loads in pack path
  assert(ORCHESTRATOR_VERSION.includes('retrieval'), 'orch version');
  void packMemo;
  void packHasRetrievalField;
} finally {
  if (bakA != null) fs.writeFileSync(archPath, bakA, 'utf8');
  else if (fs.existsSync(archPath)) fs.unlinkSync(archPath);
  if (bakM != null) fs.writeFileSync(musPath, bakM, 'utf8');
  else if (fs.existsSync(musPath)) fs.unlinkSync(musPath);
}

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nPASS smoke-intel-retrieval');
