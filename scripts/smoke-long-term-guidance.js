#!/usr/bin/env node
/** Smoke: long-term trading guidance + engine wiring */
const path = require('path');

const modules = [
  '../services/long-term-trading-guidance',
  '../services/outlook-trading-guidance',
  '../services/global-risk-regime',
  '../services/thesis-synthesis',
  '../services/commodity-outlook-engine',
];

let failed = 0;
for (const mod of modules) {
  try {
    const m = require(mod);
    console.log('OK', mod, Object.keys(m).slice(0, 8).join(', '));
  } catch (err) {
    failed += 1;
    console.error('FAIL', mod, err.message);
  }
}

const { buildLongTermGuidance, LONG_TERM_VERSION } = require('../services/long-term-trading-guidance');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');
const { computeGlobalRiskRegime } = require('../services/global-risk-regime');

const gr = computeGlobalRiskRegime({}, {});
const mockAg = {
  id: 'ag',
  name: '白银',
  price: 7800,
  directionLabel: '偏多',
  directionTier: 'bullish',
  capitalAttention: { score: 52 },
  smoothedVol: { percentile: 45, volRising: true, atr14Pct: 1.8, sigma20: 2.1, regime: 'normal' },
  highLowPrediction: {
    predictedLow: 7600,
    predictedHigh: 8100,
    baselineDate: '2026-07-01',
    method: 'range-engine',
    baseClose: 7800,
  },
  chanStructureHints: [{ tf: '60m', tfKey: '60', support: 7550, resistance: 8200, dataSource: 'chan-multitf' }],
  macroSynthesis: {
    activeTheses: [{ id: 't1', who: 'Test', claim: 'safe haven bid', falsify: 'below 7400', status: 'active', fetchedAt: new Date().toISOString() }],
  },
  quantGate: { tradableForSim: true },
};

const tg = buildTradingGuidance(mockAg, { globalRisk: gr });
const lt = buildLongTermGuidance({ ...mockAg, tradingGuidance: tg }, { globalRisk: gr, tradingGuidance: tg });

console.log('\nLONG_TERM_VERSION', LONG_TERM_VERSION);
console.log('AG entry readiness', lt?.entry?.readiness, lt?.entry?.reason);
console.log('AG stops', {
  hard: lt?.stop?.hardStop,
  soft: lt?.stop?.softStop,
  trail: lt?.stop?.trailingStop,
  earlyRisk: lt?.stop?.riskOfEarlyStop,
});
console.log('AG hold', lt?.hold);
console.log('AG rewardRisk', lt?.rewardRisk?.ratio);
console.log('logicChain steps', lt?.stop?.logicChain?.length);

if (!lt?.pilot || !lt?.dataSource || !lt?.method) {
  console.error('FAIL: missing required longTermGuidance fields');
  failed += 1;
}
if (!lt?.stop?.logicChain?.length) {
  console.error('FAIL: empty logicChain');
  failed += 1;
}

process.exit(failed ? 1 : 0);
