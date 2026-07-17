#!/usr/bin/env node
/** Smoke: Interrupt command deck (vision §13 / v2.89.6) */
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
  CHANNEL_VERSION,
  syncInterruptChannel,
  ackInterrupt,
  muteInterrupt,
  markOsDelivered,
  buildCommandDeck,
  interruptKey,
} = require('../services/intel-interrupt-channel');
const { getDataDir } = require('../services/data-paths');
const { ORCHESTRATOR_VERSION } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(CHANNEL_VERSION.includes('command'), CHANNEL_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.6') || ORCHESTRATOR_VERSION.includes('interrupt-cmd'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.6'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'interrupt_channel'), 'lesson');

const intelDir = path.join(getDataDir(), 'intel-center');
fs.mkdirSync(intelDir, { recursive: true });
const qPath = path.join(intelDir, 'interrupt-channel-queue.json');
const aPath = path.join(intelDir, 'interrupt-channel-acks.json');
const dPath = path.join(intelDir, 'interrupt-delivery.jsonl');
const bakQ = fs.existsSync(qPath) ? fs.readFileSync(qPath, 'utf8') : null;
const bakA = fs.existsSync(aPath) ? fs.readFileSync(aPath, 'utf8') : null;
const bakD = fs.existsSync(dPath) ? fs.readFileSync(dPath, 'utf8') : null;

try {
  fs.writeFileSync(qPath, JSON.stringify({ items: [], dailyCount: 0, dailyDate: null, notifiedKeys: [], cappedKeys: [], shiftDeniedKeys: [] }), 'utf8');
  fs.writeFileSync(aPath, JSON.stringify({ acked: {}, mutedUntil: {} }), 'utf8');
  if (fs.existsSync(dPath)) fs.writeFileSync(dPath, '', 'utf8');

  const emptyDeck = buildCommandDeck({ queue: [], shiftAllowsInterrupt: true, shiftDeniedCount: 0 });
  assert(emptyDeck.active === false, 'empty inactive');
  assert(/暂无/.test(emptyDeck.display), emptyDeck.display);

  const ch = syncInterruptChannel(
    [
      {
        id: 'rb',
        name: '螺纹',
        claimId: 'c1',
        headline: '合证翻转需改口',
        score: 0.7,
        scoreDisplay: '0.7',
        surpriseN: 30,
        surpriseNDisplay: '30',
        reasons: ['证伪'],
        falsified: true,
      },
      {
        id: 'cu',
        name: '铜',
        claimId: 'c2',
        headline: '内外分裂',
        score: 0.55,
        surpriseNDisplay: '22',
      },
    ],
    {
      asOf: '2026-07-17',
      shiftId: 'intraday',
      shift: { id: 'intraday', label: '盘中', allowInterrupt: true },
      maxDaily: 3,
    }
  );

  assert(ch.commandDeck?.active === true, 'deck active');
  assert(ch.commandDeck?.pendingCount >= 1, `pending=${ch.commandDeck?.pendingCount}`);
  assert(ch.commandDeck?.next?.instrumentId, 'next');
  assert(ch.freshNotifications?.length >= 1, 'fresh notes');
  assert((ch.deliveryChannels || []).includes('hub'), 'hub channel');
  assert(!(ch.freshNotifications[0].channels || []).includes('os'), 'no fake os on fresh');

  const key = ch.commandDeck.next.key;
  const osBefore = markOsDelivered([]);
  assert(osBefore.ok === false || osBefore.marked === 0, 'empty os mark');

  const os = markOsDelivered([key], { asOf: '2026-07-17' });
  assert(os.ok === true && os.marked === 1, `os marked=${os.marked}`);
  const qAfter = JSON.parse(fs.readFileSync(qPath, 'utf8'));
  const item = (qAfter.items || []).find((i) => i.key === key);
  assert(item?.channels?.includes('os'), 'queue has os');
  const del = fs.readFileSync(dPath, 'utf8');
  assert(/interrupt_os_delivery/.test(del), 'os delivery log');

  const muted = muteInterrupt(key, { muteHours: 4 });
  assert(muted.ok === true, 'mute ok');
  assert(muted.remaining === (ch.pendingCount || 1) - 1 || muted.remaining >= 0, `remain=${muted.remaining}`);

  const denied = syncInterruptChannel(
    [{ id: 'au', name: '黄金', claimId: 'c3', headline: '周末改口', score: 0.8 }],
    {
      asOf: '2026-07-18',
      shift: { id: 'weekend', label: '周末', allowInterrupt: false },
      maxDaily: 3,
    }
  );
  assert(denied.shiftDeniedCount >= 1, 'shift denied');
  assert(denied.commandDeck?.display, denied.commandDeck?.display);
  assert(/拒投/.test(denied.display || ''), denied.display);

  // ack path on remaining cu if still queued
  const ch2 = syncInterruptChannel(
    [{ id: 'i', name: '铁矿', claimId: 'c4', headline: '催办测', score: 0.6, surpriseNDisplay: '25' }],
    { asOf: '2026-07-17', shift: { allowInterrupt: true }, maxDaily: 3 }
  );
  const k2 = ch2.queue?.[0]?.key || ch2.commandDeck?.next?.key;
  if (k2) {
    const ack = ackInterrupt(k2);
    assert(ack.ok === true, 'ack ok');
  } else {
    console.log('OK skip ack (no key)');
  }

  assert(typeof interruptKey({ id: 'rb', claimId: 'x' }) === 'string', 'key fn');
} finally {
  if (bakQ != null) fs.writeFileSync(qPath, bakQ, 'utf8');
  else if (fs.existsSync(qPath)) fs.unlinkSync(qPath);
  if (bakA != null) fs.writeFileSync(aPath, bakA, 'utf8');
  else if (fs.existsSync(aPath)) fs.unlinkSync(aPath);
  if (bakD != null) fs.writeFileSync(dPath, bakD, 'utf8');
  else if (fs.existsSync(dPath)) fs.writeFileSync(dPath, '', 'utf8');
}

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nPASS smoke-intel-interrupt-command');
