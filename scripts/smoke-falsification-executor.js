#!/usr/bin/env node
/**
 * 证伪执行器冒烟：基线合证 vs 现况对立 → 必须流转 falsified 并进博物馆。
 * 不写假行情；用受控 instrument 快照 + 持久化基线翻转。
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const {
  evaluateAndApplyFalsification,
  loadClaimState,
  saveClaimState,
  STATUS,
} = require('../services/intel-falsification-executor');
const { buildClaimsFromInstrument } = require('../services/intel-claim-library');
const { loadFailureMuseum } = require('../services/intel-memory');

const asOf = new Date().toISOString().slice(0, 10);

// 清理同 claim 测试残留，避免干扰
const fs = require('fs');
const path = require('path');
const { getIntelDir } = require('../services/intel-memory');
const stateFp = path.join(getIntelDir(), 'claim-states', 'claim-cu-structural.json');
if (fs.existsSync(stateFp)) fs.unlinkSync(stateFp);

const instBullThesis = {
  id: 'cu',
  name: '沪铜',
  sector: 'metals',
  direction: 'bullish',
  directionLabel: '偏多',
  price: 100000,
  changePct: 0.2,
  capitalAttention: {
    jointWithInventory: '去库+增仓',
    attitudeScore: 0.1,
    attitudeLabel: '偏多',
    horizons: { oi1wPct: 1.2, oi1mPct: 2.0 },
    dataSource: 'test-fixture',
  },
  factors: {
    inventory: {
      stockFlowJoint: {
        available: true,
        primaryRegime: 'destock_oi_up',
        primaryLabel: '去库+增仓',
        structureBias: 'bull',
        sampleN: 40,
        dataSource: 'test-fixture',
      },
    },
  },
};

const claims = buildClaimsFromInstrument(instBullThesis, asOf);
const primary = claims.find((c) => c.horizon === 'structural') || claims[0];
console.log('[smoke] claimId', primary.claimId, 'side', primary.side, 'status', primary.status);

// 第一次：写入基线（多头合证）
const r1 = evaluateAndApplyFalsification(primary, instBullThesis, null, { asOf, persist: true });
console.log('[smoke] after baseline', r1.claim.status, r1.evaluation.display);

const state = loadClaimState(primary.claimId);
if (!state?.baseline) {
  console.error('FAIL: baseline not persisted');
  process.exit(1);
}

// 人为把基线钉在多头，现况改成累库偏空 → 必须证伪
state.baseline = {
  ...state.baseline,
  structureBias: 'bull',
  primaryRegime: 'destock_oi_up',
  jointLabel: '去库+增仓',
  jointAvailable: true,
  side: 'bull',
};
state.status = STATUS.active;
state.side = 'bull';
delete state.falsifiedAt;
saveClaimState(state);

const instBearLive = {
  ...instBullThesis,
  direction: 'bullish', // 命题侧仍多，但结构已翻空
  changePct: -0.3,
  capitalAttention: {
    ...instBullThesis.capitalAttention,
    jointWithInventory: '累库+增仓',
    attitudeScore: -0.2,
    attitudeLabel: '偏空',
  },
  factors: {
    inventory: {
      stockFlowJoint: {
        available: true,
        primaryRegime: 'build_oi_up',
        primaryLabel: '累库+增仓',
        structureBias: 'bear',
        sampleN: 40,
        dataSource: 'test-fixture',
      },
    },
  },
};

const claimStillBull = { ...primary, side: 'bull', status: 'active', statement: '沪铜结构偏多（测试）' };
const r2 = evaluateAndApplyFalsification(claimStillBull, instBearLive, null, { asOf, persist: true });

console.log('[smoke] after oppose', {
  status: r2.claim.status,
  confidence: r2.claim.confidence,
  trigger: r2.claim.falsifyTrigger,
  tags: r2.claim.falsifyTags,
  display: r2.evaluation.display,
});

const museum = loadFailureMuseum(20);
const inMuseum = museum.some((m) => m.claimId === primary.claimId);
console.log('[smoke] museum hit', inMuseum);

if (r2.claim.status !== 'falsified') {
  console.error('FAIL: expected falsified, got', r2.claim.status, r2.evaluation);
  process.exit(1);
}
if (r2.claim.confidence !== '证伪进行中' && r2.claim.confidence !== '不可判定') {
  // 证伪后置信应为 证伪进行中
  if (r2.claim.confidence !== '证伪进行中') {
    console.warn('WARN: confidence', r2.claim.confidence);
  }
}
if (!inMuseum) {
  console.error('FAIL: failure museum missing entry');
  process.exit(1);
}

console.log('PASS: falsification executor flipped claim and recorded museum');
process.exit(0);
