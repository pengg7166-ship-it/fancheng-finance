#!/usr/bin/env node
/** Smoke: regime-gate + tradable-day-kpi model layer */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}

const { evaluateRegimeGate, GATE_VERSION } = require('../services/regime-gate');
const {
  evaluateTradableDay,
  fmtHitRateWithSample,
  computeTradableDayKpiReport,
  KPI_VERSION,
} = require('../services/tradable-day-kpi');
const { hitDirection } = require('../services/outlook-labels');

console.log('GATE_VERSION', GATE_VERSION);
console.log('KPI_VERSION', KPI_VERSION);

const trendGate = evaluateRegimeGate({
  instrumentId: 'au',
  marketRegime: 'trend',
  marketRegimeLabel: '趋势',
  compositeScore: 0.35,
  direction: 'bullish',
  baselineDate: '2026-07-01',
  baseClose: 780,
  tradableDay: evaluateTradableDay({ instrumentId: 'au', marketRegime: 'trend', date: '2026-07-01' }),
});
if (trendGate.emit !== true) fail('trend should emit');
if (!trendGate.dataSource) fail('trendGate.dataSource missing');
if (!trendGate.baselineDate) fail('trendGate.baselineDate missing');
if (trendGate.confidenceLabel === '待校验') fail('trend should have confidence label');

const rangeWeak = evaluateRegimeGate({
  instrumentId: 'ag',
  marketRegime: 'range',
  compositeScore: 0.05,
  overnightIntlPct: 0.1,
  tradableDay: evaluateTradableDay({
    instrumentId: 'ag',
    marketRegime: 'range',
    date: '2026-07-01',
    overnightIntlPct: 0.1,
  }),
});
if (rangeWeak.emit !== false) fail('weak range non-tradable should suppress emit');
if (!rangeWeak.gated) fail('weak range should be gated');

const missing = evaluateRegimeGate({ instrumentId: 'au', compositeScore: 0.2 });
if (missing.emit !== false) fail('missing regime should not emit');
if (missing.confidenceLabel !== '待校验') fail('missing regime confidence should be 待校验');

const fmt = fmtHitRateWithSample(34, 50);
if (fmt.formatted !== '68% (34/50)') fail(`fmtHitRateWithSample wrong: ${fmt.formatted}`);
if (fmtHitRateWithSample(null, 0).formatted !== '暂无') fail('empty sample should be 暂无');

const mockRows = [
  { instrumentId: 'au', date: '2026-01-02', marketRegime: 'trend', actualDir: 'bullish', actualDirT3: 'bullish' },
  { instrumentId: 'ag', date: '2026-01-03', marketRegime: 'range', actualDir: 'bearish', actualDirT3: 'bullish' },
];
const report = computeTradableDayKpiReport(mockRows, () => 'bullish', {
  window: { from: '2026-01-01', to: '2026-12-31' },
  model: 'smoke',
});
if (!report.kpi?.fullSample?.all?.t3) fail('KPI report missing t3 bucket');
if (report.kpi.tradableDaySubset.all.t3.scored == null) fail('tradable subset missing scored');

console.log('OK regime-gate + tradable-day-kpi smoke');
process.exit(failed ? 1 : 0);
