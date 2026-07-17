#!/usr/bin/env node
/** Smoke: memo export + analyst journal (v2.85) */
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
  MEMO_EXPORT_VERSION,
  exportMemoUnit,
  buildExternalBriefBoard,
  enrichQuestionQueueWithMemoExport,
} = require('../services/intel-memo-export');
const {
  JOURNAL_VERSION,
  buildAnalystJournalBoard,
  enrichQuestionQueueWithAnalystJournal,
} = require('../services/intel-analyst-journal-board');
const { recordAnnotation } = require('../services/intel-analyst-workbench');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.85'), ORCHESTRATOR_VERSION);
assert(MEMO_EXPORT_VERSION.includes('memo-export'), MEMO_EXPORT_VERSION);
assert(JOURNAL_VERSION.includes('analyst-journal'), JOURNAL_VERSION);

const missing = exportMemoUnit({ id: 'x', name: 'X', intelCenter: { memo: { available: false, reason: 'no_claim' } } });
assert(missing.available === false, 'missing memo');
assert(/暂无/.test(missing.markdown), missing.markdown.slice(0, 40));

const unit = exportMemoUnit(
  {
    id: 'cu',
    name: '沪铜',
    intelCenter: {
      memo: {
        available: true,
        publishable: false,
        claimId: 'c1',
        issueId: 'i1',
        headline: '去库支撑近月',
        oneLiner: '弱结构 · 待校验',
        support: [{ summary: '合证去库', dataSource: 'joint', n: '40' }],
        oppose: [],
        triggers: ['合证翻累库'],
        unknownMap: { display: '缺外盘', gaps: [{ label: '外盘', impact: 'high', shortestPath: '补行情' }] },
        suggestedAction: { label: '观望', condition: '等合证' },
        n: '暂无',
        claimStatus: 'watch',
        dataSource: 'intel-memo',
      },
    },
  },
  { asOf: '2026-07-17' }
);
assert(unit.available, 'unit ok');
assert(unit.publishable === false, 'not publishable');
assert(unit.honesty.some((h) => /门禁|反对|n/.test(h)), JSON.stringify(unit.honesty));
assert(/三支撑/.test(unit.markdown) && /一反对/.test(unit.markdown), 'md template');
assert(/沪铜/.test(unit.plain), unit.plain);

const board = buildExternalBriefBoard(
  [
    {
      id: 'cu',
      name: '沪铜',
      intelCenter: {
        memo: {
          available: true,
          publishable: true,
          headline: '可发布样例',
          oneLiner: '弱结构',
          support: [{ summary: 'a', dataSource: 's', n: '20' }],
          oppose: [{ summary: 'b', dataSource: 't' }],
          triggers: ['t1'],
          n: '20',
          claimId: 'c',
        },
      },
    },
    {
      id: 'au',
      name: '沪金',
      intelCenter: {
        memo: {
          available: true,
          publishable: false,
          headline: '内部样例',
          oneLiner: '叙事分歧',
          support: [],
          oppose: [],
          triggers: [],
          n: '暂无',
          claimId: 'c2',
        },
      },
    },
  ],
  { asOf: '2026-07-17' }
);
assert(board.counts.publishable >= 1, `pub ${board.counts.publishable}`);
assert(board.counts.internalOnly >= 1, `internal ${board.counts.internalOnly}`);
const qBrief = enrichQuestionQueueWithMemoExport({ all: [], version: 'w' }, board);
assert((qBrief.memoExportInjected || 0) >= 1, `brief inj ${qBrief.memoExportInjected}`);

// journal: write a real annotation then read board
const ann = recordAnnotation({
  instrumentId: 'cu',
  type: 'freeze_claim',
  reason: 'smoke-w freeze',
  analyst: 'smoke',
});
assert(ann.ok, `ann ${ann.error}`);
const journal = buildAnalystJournalBoard(
  [
    { id: 'cu', name: '沪铜' },
    { id: 'au', name: '沪金' },
  ],
  { asOf: new Date().toISOString().slice(0, 10) }
);
assert(journal.counts.total >= 1, `journal total ${journal.counts.total}`);
assert(journal.counts.liveFrozen >= 1 || journal.liveFrozen.length >= 1, 'live freeze');
assert(/分析师日记/.test(journal.display), journal.display);
const qJ = enrichQuestionQueueWithAnalystJournal({ all: [], version: 'w' }, journal);
assert((qJ.analystJournalInjected || 0) >= 1, `journal inj ${qJ.analystJournalInjected}`);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.85'), pack.version);
assert(pack.externalBriefBoard?.version?.includes('memo-export'), pack.externalBriefBoard?.version || 'no brief');
assert(pack.analystJournalBoard?.version?.includes('analyst-journal'), pack.analystJournalBoard?.version || 'no journal');
assert(typeof pack.externalBriefBoard.display === 'string', pack.externalBriefBoard.display);
assert(typeof pack.analystJournalBoard.display === 'string', pack.analystJournalBoard.display);
assert(
  pack.faceViews?.research?.externalBriefBoard || pack.faceViews?.research?.analystJournalBoard,
  'research face'
);

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-w memo-export-journal');
process.exit(fails ? 1 : 0);
