#!/usr/bin/env node
/** Smoke: fancheng-ai-fusion — structured brief + Q&A without fabrication */
const path = require('path');

let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}

try {
  require('../services/fancheng-ai-fusion');
  console.log('OK require fancheng-ai-fusion');
} catch (err) {
  fail(`require: ${err.message}`);
  process.exit(1);
}

const {
  FUSION_VERSION,
  buildInstrumentBrief,
  buildMacroBrief,
  answerQuestion,
  matchQuestionPattern,
  summarizeMacroWithLlm,
  summarizeDailyBriefWithLlm,
  isLlmConfigured,
  buildSlotDecisionBriefRule,
  explainPortfolioSlotsWithLlm,
  buildSlotDecisionBrief,
} = require('../services/fancheng-ai-fusion');
const { buildSlotDecisionContext } = require('../services/core-tactical-slots');
const { buildDailyBrief, buildDailyBriefLlmPayload } = require('../services/daily-brief-synthesis');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');
const { buildLongTermGuidance } = require('../services/long-term-trading-guidance');
const { computeGlobalRiskRegime } = require('../services/global-risk-regime');

console.log('FUSION_VERSION', FUSION_VERSION);

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
    activeTheses: [
      {
        id: 't1',
        who: 'Test',
        claim: 'safe haven bid',
        falsify: 'below 7400',
        status: 'active',
        fetchedAt: new Date().toISOString(),
      },
    ],
  },
  quantGate: { tradableForSim: true },
};

const tg = buildTradingGuidance(mockAg, { globalRisk: gr });
const lt = buildLongTermGuidance({ ...mockAg, tradingGuidance: tg }, { globalRisk: gr, tradingGuidance: tg });
const inst = { ...mockAg, tradingGuidance: tg, longTermGuidance: lt };

const brief = buildInstrumentBrief(inst, { globalRisk: gr });
console.log('\nAG brief summary:', brief.summary?.slice(0, 120) + '…');
console.log('AG brief citations:', brief.citations?.length);
console.log('AG brief method:', brief.method);

if (!brief.summary || brief.summary.length < 20) fail('brief.summary too short');
if (!brief.citations?.length) fail('brief.citations empty');
if (!brief.method) fail('brief.method missing');
if (brief.dataSource !== 'fancheng-ai-fusion') fail('brief.dataSource wrong');

const macroBrief = buildMacroBrief(gr, inst.macroSynthesis.activeTheses, { narrativeSummary: 'test synth' });
if (!macroBrief.summary) fail('macroBrief.summary missing');
if (!macroBrief.method) fail('macroBrief.method missing');

const { refreshGlobalRiskOnOutlook } = require('../services/global-risk-regime');
const outlookWithMacro = refreshGlobalRiskOnOutlook(
  { instruments: [inst], categories: [] },
  {},
  {}
);
if (!outlookWithMacro?.aiMacroBrief?.summary) fail('refreshGlobalRiskOnOutlook should attach aiMacroBrief');
if (!/全球流动性/.test(outlookWithMacro.aiMacroBrief.summary)) fail('aiMacroBrief.summary should cite globalRisk');

(async () => {
  const llmConfigured = isLlmConfigured();
  console.log('isLlmConfigured', llmConfigured);
  const augmented = await summarizeMacroWithLlm(macroBrief, { globalRisk: gr });
  if (!llmConfigured && augmented.summary !== macroBrief.summary) {
    fail('summarizeMacroWithLlm must not change summary when LLM unconfigured');
  }
  if (llmConfigured && augmented.summary) {
    console.log('LLM macro augment ok (or fallback to rule summary)');
  }
})().then(async () => {
  runQaSmoke();
  await runSlotDecisionSmoke();
  process.exit(failed ? 1 : 0);
}).catch((err) => {
  fail(err.message || String(err));
  process.exit(failed ? 1 : 0);
});

function runQaSmoke() {
const { evaluateNoTradeDay } = require('../services/no-trade-day');
const { computeCoreTacticalState } = require('../services/core-tactical-slots');
const { PRESET_CHIPS } = require('../services/fancheng-ai-fusion');

if (!PRESET_CHIPS?.length || PRESET_CHIPS.length < 10) {
  fail(`PRESET_CHIPS expected 10+ got ${PRESET_CHIPS?.length ?? 0}`);
} else {
  console.log(`OK PRESET_CHIPS count=${PRESET_CHIPS.length}`);
}

const ctx = {
  instrument: inst,
  globalRisk: gr,
  activeTheses: inst.macroSynthesis.activeTheses,
  noTradeDay: evaluateNoTradeDay({ instruments: [inst], globalRisk: gr, holdings: ['ag'] }),
  coreTactical: computeCoreTacticalState(['ag'], [inst]),
};
const qaPatterns = [
  '为什么现在是试仓？',
  '为什么建议就绪？',
  '止损为什么设在这里？',
  '全球风险对本品有什么影响？',
  '当前活跃命题是什么？',
  '现在适合长线开仓吗？',
  '为什么是这个 posture？',
  '止损逻辑是什么？',
  '派发区风险大吗？',
  '有痛苦记忆吗？',
  '回测置信如何？',
  '今天 no-trade 吗？',
  '对手盘怎样？',
  'playbook 阶段？',
  '三槽快钱超标？',
  '宏观命题是什么？',
  '止损在哪？',
  '长线入场逻辑？',
];

for (const q of qaPatterns) {
  const matched = matchQuestionPattern(q);
  const ans = answerQuestion(q, ctx);
  console.log(`Q: ${q}`);
  console.log(`  pattern=${matched?.type} conf=${ans.confidence} cites=${ans.citations?.length}`);
  if (!ans.answer || ans.answer.length < 3) fail(`empty answer for: ${q}`);
  if (!ans.method) fail(`missing method for: ${q}`);
  if (/编造|预测价|建议买入/.test(ans.answer)) fail(`fabrication detected: ${q}`);
  if (!/暂无|待校验|[\u4e00-\u9fff]/.test(ans.answer)) fail(`answer not honest text for: ${q}`);
}

for (const chip of PRESET_CHIPS) {
  const matched = matchQuestionPattern(chip.question);
  if (!matched || matched.type === 'unknown') fail(`PRESET chip unmapped: ${chip.id} -> ${chip.question}`);
  const ans = answerQuestion(chip.question, ctx);
  if (!ans.answer) fail(`PRESET chip empty answer: ${chip.id}`);
}

const emptyInst = { id: 'ag', name: '白银' };
const emptyBrief = buildInstrumentBrief(emptyInst, {});
if (!/待校验|暂无/.test(emptyBrief.summary)) fail('missing guidance should say 待校验/暂无');
console.log('\nEmpty guidance brief:', emptyBrief.summary.slice(0, 80));

const emptyCtx = { instrument: emptyInst, globalRisk: gr };
const trapAns = answerQuestion('派发区风险大吗？', emptyCtx);
if (!/暂无|待校验/.test(trapAns.answer)) fail('missing retailTrap should say 暂无/待校验');
console.log('Empty trap answer:', trapAns.answer.slice(0, 60));
}

async function runSlotDecisionSmoke() {
  const outlook = {
    instruments: [inst],
    globalRisk: gr,
    masterClock: { summaryThreeLines: ['测试 master clock line 1', 'line 2'] },
  };
  const holdings = ['ag'];
  const brief = buildDailyBrief(outlook, { holdings });
  const ctx = buildSlotDecisionContext(outlook, holdings, brief);
  if (!ctx.slots?.length) fail('slot context should have 3 slots');
  if (ctx.slots.filter((s) => !s.empty).length !== 1) fail('expected 1 filled slot for ag');
  const filled = ctx.slots.find((s) => !s.empty);
  if (filled?.instrumentId !== 'ag') fail(`expected ag in slot got ${filled?.instrumentId}`);
  if (!filled?.posture || filled.posture === '暂无') fail('filled slot posture missing');
  if (filled?.backtestHitRate30d && filled.backtestHitRate30d.n == null && filled.backtestHitRate30d.hits != null) {
    fail('backtest hit must include n when hits present');
  }

  const ruleBrief = buildSlotDecisionBriefRule(ctx);
  console.log('\nSlot rule narrative:', ruleBrief.narrative?.slice(0, 160) + '…');
  if (!ruleBrief.narrative || ruleBrief.narrative.length < 40) fail('slot rule narrative too short');
  if (ruleBrief.method !== 'structured-synthesis') fail('rule brief method wrong');
  if (!ruleBrief.citations?.length) fail('slot rule citations empty');
  if (/编造|建议买入/.test(ruleBrief.narrative)) fail('slot narrative fabrication');

  const llmPayload = buildDailyBriefLlmPayload(brief);
  if (!llmPayload.threeAnswers?.happened) fail('daily brief LLM payload missing threeAnswers.happened');
  if (!llmPayload.backtestSummaryLine) fail('daily brief LLM payload missing backtestSummaryLine');
  if (!Array.isArray(llmPayload.top5)) fail('daily brief LLM payload top5 must be array');
  console.log('Daily brief LLM payload keys:', Object.keys(llmPayload).join(','));

  const dailyLlm = await summarizeDailyBriefWithLlm(llmPayload);
  if (!isLlmConfigured() && dailyLlm !== null) fail('summarizeDailyBriefWithLlm must return null when LLM unconfigured');
  if (isLlmConfigured() && dailyLlm?.llmNarrative) {
    console.log('Daily brief LLM narrative:', dailyLlm.llmNarrative.slice(0, 120) + '…');
    if (dailyLlm.method !== 'llm-augmented') fail('daily brief LLM method wrong');
    if (!dailyLlm.citations?.length) fail('daily brief LLM citations empty');
  } else {
    console.log('OK daily brief LLM skipped or fallback (no config / API)');
  }

  const full = await buildSlotDecisionBrief(outlook, holdings, brief);
  if (!full.narrative) fail('buildSlotDecisionBrief narrative missing');
  if (!full.ruleBasedNarrative && isLlmConfigured()) fail('LLM path should retain ruleBasedNarrative');
  if (!isLlmConfigured() && full.method !== 'structured-synthesis') fail('unconfigured LLM must use rule method');
  console.log('Slot decision method:', full.method);
}
