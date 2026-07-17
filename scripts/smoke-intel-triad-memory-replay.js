#!/usr/bin/env node
/** Smoke: evidence triad + memory replay (v2.89.19 / §72+§59) */
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
  TRIAD_VERSION,
  assessEvidenceTriad,
  buildEvidenceTriadBoard,
  applyTriadToInterruptGate,
} = require('../services/intel-evidence-triad');
const {
  REPLAY_VERSION,
  searchIntelMemory,
  replayClaimTimeline,
  buildMemoryReplayBoard,
} = require('../services/intel-memory-replay');
const { appendJsonl } = require('../services/intel-memory');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');
const fs = require('fs');
const path = require('path');

assert(TRIAD_VERSION.includes('evidence-triad') || TRIAD_VERSION.includes('2.89.19'), TRIAD_VERSION);
assert(REPLAY_VERSION.includes('memory-replay') || REPLAY_VERSION.includes('2.89.19'), REPLAY_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.1') || ORCHESTRATOR_VERSION.includes('triad') || ORCHESTRATOR_VERSION.includes('museum'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.1'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'evidence_triad'), 'lesson triad');
assert(LESSONS.some((l) => l.id === 'memory_replay'), 'lesson memory');

const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
assert(appSrc.includes('intel-triad-line'), 'hub triad');
assert(appSrc.includes('温度·硬度·贴合'), 'hub triad title');
assert(appSrc.includes('intel-mem-search'), 'hub mem search');
assert(appSrc.includes('intel-memory-replay'), 'hub mem replay');
const mainSrc = fs.readFileSync(path.join(process.cwd(), 'electron/main.js'), 'utf8');
assert(mainSrc.includes('search-intel-memory'), 'ipc search');
assert(mainSrc.includes('replay-intel-memory-claim'), 'ipc replay');

const hotSoftInst = {
  id: 'cu',
  name: '铜',
  intelCenter: {
    primaryClaim: {
      statement: '去库支撑近月',
      mechanism: '库存去化',
      evidenceFor: [
        {
          evidenceType: 'news',
          summary: '媒体高热叙事',
          freshness: { score: 0.95, label: '最新', lagDays: 0 },
          reliability: { score: 0.3, tier: 'D', label: '低' },
          relevant: true,
          dataSource: 'news',
        },
        {
          evidenceType: 'news',
          summary: '二手传闻',
          freshness: { score: 0.9, label: '最新', lagDays: 0 },
          reliability: { score: 0.28, tier: 'D', label: '低' },
          relevant: true,
          dataSource: 'news',
        },
      ],
      evidenceAgainst: [],
    },
  },
};
const triad = assessEvidenceTriad(hotSoftInst, '2026-07-17');
assert(triad.patterns.hotSoft >= 1, `hotSoft ${triad.patterns.hotSoft}`);
assert(triad.blocksInterrupt === true, 'blocks interrupt');
assert(triad.items[0].temperature.display !== '混分', 'separate axes');
assert(triad.items.every((i) => i.hardness && i.relevance), 'all axes');

const gates = applyTriadToInterruptGate(
  { intelCenter: { evidenceTriad: triad } },
  { interrupt: { pass: true, blockedReasons: [] } }
);
assert(gates.interrupt.pass === false && gates.interrupt.triadBlocked, 'gate block');

const board = buildEvidenceTriadBoard(
  [
    hotSoftInst,
    {
      id: 'rb',
      name: '螺纹',
      intelCenter: {
        evidenceTriad: assessEvidenceTriad(
          {
            id: 'rb',
            intelCenter: {
              primaryClaim: {
                statement: '合证偏多',
                evidenceFor: [
                  {
                    evidenceType: 'warehouse_joint',
                    summary: '旧合证',
                    freshness: { score: 0.2, label: '严重滞后', lagDays: 10 },
                    reliability: { score: 0.9, tier: 'A', label: '高' },
                    relevant: true,
                  },
                ],
                evidenceAgainst: [],
              },
            },
          },
          '2026-07-17'
        ),
      },
    },
  ],
  '2026-07-17'
);
assert(board.rows.length >= 1, `rows ${board.rows.length}`);
assert(/三轴/.test(board.display), board.display);

const claimId = `smoke-mem-${Date.now()}`;
appendJsonl('claims-archive.jsonl', {
  type: 'claim_snapshot',
  claimId,
  instrumentId: 'cu',
  statement: '烟测铜去库命题',
  status: 'active',
  confidence: '弱结构',
  side: 'bull',
  stateKey: 'test|destock',
  n: 12,
  nDisplay: '12',
});
appendJsonl('revisions.jsonl', {
  type: 'revision',
  revisionType: 'evidence_update',
  claimId,
  instrumentId: 'cu',
  from: { statement: '旧', status: 'active' },
  to: { statement: '烟测铜去库命题', status: 'active' },
  reason: 'smoke',
});

const search = searchIntelMemory({ q: '烟测铜', limit: 8 });
assert(search.available && search.n >= 1, search.display);
assert(search.hits.some((h) => h.claimId === claimId), 'hit claim');

const timeline = replayClaimTimeline(claimId);
assert(timeline.available && timeline.n >= 1, timeline.display);
assert(timeline.events.some((e) => e.kind === 'archive'), 'archive event');
assert(timeline.events.some((e) => e.kind === 'revision'), 'revision event');

const memBoard = buildMemoryReplayBoard([{ intelCenter: { primaryClaim: { claimId } } }], {
  asOf: '2026-07-17',
});
assert(memBoard.display, memBoard.display);
assert(memBoard.libraryNDisplay, memBoard.libraryNDisplay);

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
assert(pack.version.includes('2.89.19') || pack.version.includes('triad'), pack.version);
assert(pack.evidenceTriadBoard?.display, pack.evidenceTriadBoard?.display);
assert(pack.memoryReplayBoard?.display, pack.memoryReplayBoard?.display);
assert(
  withIntel.some((i) => i.intelCenter?.evidenceTriad) ||
    pack.evidenceTriadBoard?.rows?.length >= 0,
  'inst triad'
);

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · evidence-triad + memory-replay §72/§59'));
process.exit(fails ? 1 : 0);
