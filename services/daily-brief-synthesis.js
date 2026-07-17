/**

 * Daily Brief 三答 + research pool + top5 + portfolio gate + master clock

 */

const { computePortfolioGate } = require('./portfolio-gate');

const { getPoolList, seedPoolIfEmpty } = require('./research-pool');

const { computePriorityScore } = require('./multi-dimensional-scoring');

const { buildMacroBrief } = require('./fancheng-ai-fusion');

const { computeMacroMasterClock } = require('./macro-master-clock');

const { summarizeOverridePatterns } = require('./behavior-override-log');



const { getHolidayGapRisk } = require('./holiday-gap-calendar');
const { runMarginStress } = require('./margin-stress-test');

const { buildOpponentBriefLine } = require('./opponent-capitulation');
const { buildFactorExposure, buildFollowAdviceLine } = require('./retail-hf-strategy');
const { buildCarryRollHint } = require('./term-structure-bias');
const { evaluateNoTradeDay } = require('./no-trade-day');
const { computeCoreTacticalState } = require('./core-tactical-slots');
const { listPainEntries, buildPainFusionLine, matchPainEntries } = require('./pain-memory-playbook');

const BRIEF_VERSION = 'v1.47.0-retail-discipline';

const BRIEF_CACHE_MS = 60 * 60 * 1000;



let briefCache = { payload: null, at: 0, key: null };



function nowIso() {

  return new Date().toISOString();

}

function fmtBacktestHitWithSample(rate, hits, total) {
  if (rate == null) return null;
  const pct = Math.round(rate * 100);
  if (hits != null && total != null && total > 0) return `${pct}% (${hits}/${total})`;
  return `${pct}%`;
}

function buildBacktestSummaryLine() {
  try {
    const { loadBacktestSummary } = require('./commodity-outlook-backtest');
    const summary = loadBacktestSummary();
    if (!summary?.runAt) return '待运行回测';
    const p30 = fmtBacktestHitWithSample(summary.overallHitRate30d, summary.hits30d, summary.total30d);
    const p60 = fmtBacktestHitWithSample(summary.overallHitRate60d, summary.hits60d, summary.total60d);
    if (!p30 && !p60) return '待运行回测';
    const parts = [];
    if (p30) parts.push(`30d ${p30}`);
    if (p60) parts.push(`60d ${p60}`);
    return `walk-forward 回测 · ${parts.join(' · ')}`;
  } catch {
    return '待运行回测';
  }
}



function buildThreeAnswers(outlookPayload = {}, context = {}) {

  const instruments = outlookPayload.instruments || [];

  const globalRisk = outlookPayload.globalRisk || outlookPayload.globalLiquidityRisk;

  const tier = globalRisk?.tier || 'L0';

  const regime = globalRisk?.regime || 'normal';

  const macroSynth = outlookPayload.macroSynthesis;

  const masterClock = outlookPayload.masterClock || context.masterClock;



  const hot = instruments

    .filter((i) => i.integratedSpec?.priorityScore != null)

    .sort((a, b) => (b.integratedSpec.priorityScore ?? 0) - (a.integratedSpec.priorityScore ?? 0))

    .slice(0, 5);

  const intelPack = outlookPayload.intelCenterPack;
  const intelP0 = (intelPack?.questionQueue?.p0 || [])
    .slice(0, 3)
    .map((q) => `${q.instrumentName}: ${q.question}`)
    .join(' · ');
  const intelChanged = intelPack?.dailyDiff?.summary || null;
  const intelQuiet = intelPack?.quietDay ? '情报静默日' : null;

  const clockLine = masterClock?.summaryThreeLines?.[0] || null;
  const intelPrefix = [intelChanged, intelQuiet, intelP0 ? `P0: ${intelP0}` : null].filter(Boolean).join(' · ');

  const whatHappened = hot.length

    ? hot

        .slice(0, 3)

        .map((i) => `${i.name || i.id} phase=${i.tradingGuidance?.phase || ''} posture=${i.tradingGuidance?.posture || ''}`)

        .join('')

    : '暂无优先品种数据';



  const soWhat = masterClock?.conflict

    ? `宏观时钟冲突 · posture cap ${masterClock.postureCap || '试仓'}`

    : tier !== 'L0'

      ? `全球流动性 ${tier} · ${regime} · pilot posture 上限收紧`

      : hot.length

        ? `${hot[0].name || hot[0].id} 综合优先 · regime ${hot[0].integratedSpec?.regime?.regime || ''}`

        : '市场结构待校验';



  const why = macroSynth?.narrativeSummary && macroSynth.narrativeSummary !== '暂无活跃命题'

    ? macroSynth.narrativeSummary

    : globalRisk?.summary || '命题/宏观合成待校验';



  const holidayGap = getHolidayGapRisk();
  const holidayLine =
    holidayGap.upcoming && holidayGap.briefLine ? holidayGap.briefLine : holidayGap.briefLine || null;

  const opponentLines = instruments
    .filter((i) => i.integratedSpec?.opponentStatus)
    .slice(0, 4)
    .map((i) => `${i.name || i.id} ${buildOpponentBriefLine(i.integratedSpec.opponentStatus) || '对手盘: 待校验'}`)
    .filter(Boolean);
  const opponentStatusLine = opponentLines.length ? opponentLines.join(' · ') : null;

  const factorExposure = buildFactorExposure(context.holdings || [], instruments, { masterClock });
  const factorLine = factorExposure.factorLine;
  const followAdvice = factorExposure.followAdvice;

  const noTradeDay = evaluateNoTradeDay({
    instruments,
    globalRisk: outlookPayload.globalRisk || outlookPayload.globalLiquidityRisk,
    factorExposure,
    holdings: context.holdings || [],
    masterClock,
  });

  const hotCarry = hot.slice(0, 2).map((i) => buildCarryRollHint(i.id)).filter((c) => c.carryLine);
  const carryLine = hotCarry.length ? hotCarry.map((c) => c.carryLine).join(' · ') : null;

  return {

    happened: intelPrefix
      ? `${intelPrefix}${clockLine ? ` · ${clockLine}` : ''}${holidayLine ? ` · ${holidayLine}` : ''}${opponentStatusLine ? ` · ${opponentStatusLine}` : ''} · ${whatHappened}`
      : clockLine
      ? `${clockLine}${holidayLine ? ` · ${holidayLine}` : ''}${opponentStatusLine ? ` · ${opponentStatusLine}` : ''} · ${whatHappened}`
      : holidayLine
        ? `${holidayLine}${opponentStatusLine ? ` · ${opponentStatusLine}` : ''} · ${whatHappened}`
        : opponentStatusLine
          ? `${opponentStatusLine} · ${whatHappened}`
          : whatHappened,

    soWhat,

    why,

    masterClockLines: masterClock?.summaryThreeLines || [],

    holidayGap,

    opponentStatusLine,

    factorLine,

    followAdvice,

    carryLine,

    factorExposure,

    noTradeDay,

    dataSource: 'daily-brief-synthesis',

    method: '三答-template+master-clock+holiday-gap+opponent+retail-hf+no-trade',

    asOf: nowIso(),

  };

}



function buildResearchPoolTable(outlookPayload = {}) {

  seedPoolIfEmpty();

  const pool = getPoolList();

  const instMap = new Map((outlookPayload.instruments || []).map((i) => [String(i.id).toLowerCase(), i]));



  return pool.map((p) => {

    const inst = instMap.get(String(p.symbol).toLowerCase());

    const spec = inst?.integratedSpec;

    return {

      symbol: p.symbol,

      name: inst?.name || p.symbol.toUpperCase(),

      regime: spec?.regime?.regime || p.regime || '',

      regimeLabel: spec?.regime?.label || '',

      watchLevel: spec?.watchLevel || p.watchLevel || 'W0',

      watchLabel: spec?.watchLabel || p.watchLabel || '跟踪',

      divergenceLevel: spec?.divergence?.level || p.divergenceLevel || 'D0',

      playbook: spec?.playbook?.id || p.playbookId || '',

      playbookStage: spec?.playbook?.stage || '',

      priorityScore: spec?.priorityScore ?? p.priorityScore ?? null,

      slippageFlag: spec?.slippage?.flag || null,

      note: p.note || null,

      inPool: true,

      dataSource: 'research-pool',

    };

  });

}



function buildTop5Priorities(instruments = []) {

  return instruments

    .map((inst) => {

      const spec = inst.integratedSpec || computePriorityScore(inst, { tradingGuidance: inst.tradingGuidance });

      return { inst, spec, score: spec.priorityScore };

    })

    .filter((r) => r.score != null)

    .sort((a, b) => b.score - a.score)

    .slice(0, 5)

    .map(({ inst, spec }, rank) => ({

      rank: rank + 1,

      symbol: inst.id,

      name: inst.name || inst.id,

      priorityScore: spec.priorityScore,

      regime: spec.regime?.regime || '',

      regimeTags: spec.regimeTags || [],

      watchLevel: inst.integratedSpec?.watchLevel || 'W0',

      playbookMatch: spec.playbookMatch,

      posture: inst.tradingGuidance?.posture || '暂无',

      dataSource: 'multi-dimensional-scoring',

    }));

}



/**

 * @param {object} outlookPayload

 * @param {object} options '{ holdings, forceRefresh, sources, activeTheses }

 */

function buildDailyBrief(outlookPayload = {}, options = {}) {

  const cacheKey = `${outlookPayload.updatedAt || ''}:${(options.holdings || []).join(',')}`;

  const now = Date.now();

  if (!options.forceRefresh && briefCache.payload && briefCache.key === cacheKey && now - briefCache.at < BRIEF_CACHE_MS) {

    return { ...briefCache.payload, cached: true };

  }



  const instruments = outlookPayload.instruments || [];

  const globalRisk = outlookPayload.globalRisk || outlookPayload.globalLiquidityRisk;

  const masterClock = computeMacroMasterClock({

    sources: options.sources || outlookPayload.sources,

    globalRisk,

    macroSynthesis: outlookPayload.macroSynthesis,

  });



  const enriched = instruments.map((inst) => {

    if (inst.integratedSpec) return inst;

    const integratedSpec = {

      ...computePriorityScore(inst, { tradingGuidance: inst.tradingGuidance, globalRisk }),

      watchLevel: require('./research-pool').deriveWatchLevel(inst, { tradingGuidance: inst.tradingGuidance }),

    };

    return { ...inst, integratedSpec };

  });



  const holdings = options.holdings || [];
  const holidayGap = getHolidayGapRisk();
  const marginStress = holdings.length ? runMarginStress(holdings, 2) : null;

  const threeAnswers = buildThreeAnswers({ ...outlookPayload, instruments: enriched, masterClock }, { ...options, holdings });

  const researchPool = buildResearchPoolTable({ ...outlookPayload, instruments: enriched });

  const top5 = buildTop5Priorities(enriched);

  const portfolioGate = computePortfolioGate(options.holdings || [], enriched, {
    globalRisk,
    masterClock,
    factorExposure: buildFactorExposure(options.holdings || [], enriched, { masterClock }),
  });

  const coreTactical = computeCoreTacticalState(options.holdings || [], enriched);

  const noTradeDay = evaluateNoTradeDay({
    instruments: enriched,
    globalRisk,
    factorExposure: portfolioGate.retailFactorGate?.factorExposure || buildFactorExposure(options.holdings || [], enriched, { masterClock }),
    holdings: options.holdings || [],
    masterClock,
  });

  const painEntries = listPainEntries(50);
  const painFusionLines = enriched
    .slice(0, 5)
    .map((inst) => {
      const m = matchPainEntries(inst, painEntries);
      return m.length ? buildPainFusionLine(m) : null;
    })
    .filter(Boolean);
  const painFusionLine = painFusionLines[0] || null;

  const factorExposure = portfolioGate.retailFactorGate?.factorExposure || buildFactorExposure(options.holdings || [], enriched, { masterClock });
  const retailFollowAdvice = buildFollowAdviceLine(factorExposure);
  const carryHints = top5
    .slice(0, 3)
    .map((t) => buildCarryRollHint(t.symbol))
    .filter((c) => c.carryLine);
  const carryLine = carryHints.length ? carryHints.map((c) => c.carryLine).join(' · ') : null;

  let redTeamWeekly = null;
  try {
    const { buildRedTeamWeekly, isSunday } = require('./red-team-weekly');
    if (options.forceRedTeam || isSunday()) {
      redTeamWeekly = buildRedTeamWeekly({ ...outlookPayload, instruments: enriched, masterClock, globalRisk }, {
        holdings: options.holdings || [],
      });
    }
  } catch {
    // non-fatal
  }

  const behaviorPatterns = summarizeOverridePatterns();

  let counterThesisSection = null;

  try {

    const macroBrief = outlookPayload.aiMacroBrief || buildMacroBrief(globalRisk, options.activeTheses || [], outlookPayload.macroSynthesis, options);

    counterThesisSection = {

      summary: macroBrief.summary,

      risks: (macroBrief.risks || []).map((r) => r.text || r),

      dissent: buildDissentLines(enriched, globalRisk),

      dataSource: 'fancheng-ai-fusion',

      method: 'counter-thesis-mandatory',

    };

  } catch {

    counterThesisSection = { summary: '宏观/反证待校验', risks: [], dissent: [], dataSource: 'fancheng-ai-fusion' };

  }



  const payload = {

    threeAnswers,

    masterClock,

    researchPool,

    top5,

    portfolioGate,

    coreTactical,

    noTradeDay,

    painFusionLine,

    painFusionLines,

    clusterWarning: portfolioGate.clusterGate?.clusterWarning || null,

    counterThesis: counterThesisSection,

    behaviorPatterns: behaviorPatterns.patternWarning ? behaviorPatterns : null,

    holidayGap,

    marginStress,

    factorExposure,

    factorLine: threeAnswers.factorLine || factorExposure?.factorLine,

    followAdvice: retailFollowAdvice || threeAnswers.followAdvice,

    carryLine: carryLine || threeAnswers.carryLine,

    redTeamWeekly,

    intelCenter: outlookPayload.intelCenterPack
      ? {
          version: outlookPayload.intelCenterPack.version,
          quietDay: outlookPayload.intelCenterPack.quietDay,
          shift: outlookPayload.intelCenterPack.shift?.label || null,
          whatChanged: outlookPayload.intelCenterPack.dailyDiff?.summary || null,
          materialChanges: outlookPayload.intelCenterPack.dailyDiff?.materialChanges ?? null,
          p0: (outlookPayload.intelCenterPack.questionQueue?.p0 || []).slice(0, 3),
          kpis: outlookPayload.intelCenterPack.kpis?.display || null,
          debt: outlookPayload.intelCenterPack.debtBoard?.display || null,
          top5Candidates: outlookPayload.intelCenterPack.top5Candidates || [],
          externalBrief: outlookPayload.intelCenterPack.externalBriefBoard
            ? {
                display: outlookPayload.intelCenterPack.externalBriefBoard.display,
                publishable: outlookPayload.intelCenterPack.externalBriefBoard.counts?.publishable ?? null,
                top: (outlookPayload.intelCenterPack.externalBriefBoard.top || []).slice(0, 5).map((u) => ({
                  instrumentId: u.instrumentId,
                  instrumentName: u.instrumentName,
                  publishable: u.publishable,
                  headline: u.headline,
                  oneLiner: u.oneLiner,
                  nDisplay: u.nDisplay,
                  honesty: (u.honesty || []).slice(0, 2),
                  plain: u.plain,
                })),
              }
            : null,
          analystJournal: outlookPayload.intelCenterPack.analystJournalBoard
            ? {
                display: outlookPayload.intelCenterPack.analystJournalBoard.display,
                today: outlookPayload.intelCenterPack.analystJournalBoard.counts?.today ?? null,
                liveFrozen: outlookPayload.intelCenterPack.analystJournalBoard.counts?.liveFrozen ?? null,
                liveVetoed: outlookPayload.intelCenterPack.analystJournalBoard.counts?.liveVetoed ?? null,
                recent: (outlookPayload.intelCenterPack.analystJournalBoard.recent || []).slice(0, 5).map((e) => ({
                  instrumentId: e.instrumentId,
                  text: e.text,
                  label: e.label,
                })),
              }
            : null,
          quietBrake: outlookPayload.intelCenterPack.quietBrakeBoard?.display || null,
        }
      : null,

    backtestSummaryLine: buildBacktestSummaryLine(),

    version: BRIEF_VERSION,

    dataSource: 'daily-brief-synthesis',

    method: '三答+pool+top5+gate+master-clock+holiday+margin-stress+retail-hf+no-trade+core-tactical',

    asOf: nowIso(),

    cacheTtlMs: BRIEF_CACHE_MS,

  };



  briefCache = { payload, at: now, key: cacheKey };

  return payload;

}



function buildDissentLines(instruments, globalRisk) {

  const lines = [];

  if (globalRisk?.regime === 'shock' || globalRisk?.tier === 'L3') {

    lines.push('反证：流动性冲击下叙事品种亦可能补跌，避险逻辑非单向');

  }

  const divAlerts = instruments.filter((i) => i.integratedSpec?.divergence?.level === 'D2' || i.integratedSpec?.divergence?.level === 'D3');

  for (const i of divAlerts.slice(0, 3)) {

    lines.push(`反证 · ${i.name || i.id}：政策-资本背离 (${i.integratedSpec.divergence.level})，持有者宜减仓而非追逐叙事。`);

  }

  const overshoot = instruments.filter((i) => i.integratedSpec?.expectationGap?.gap === 'overshoot');

  for (const i of overshoot.slice(0, 2)) {

    lines.push(`反证 · ${i.name || i.id}：叙事 overshoot，价格可能已透支预期 (priced-in ${i.integratedSpec.expectationGap.pricedInDegree?.degree || ''})。`);

  }

  const o2 = instruments.filter((i) => i.integratedSpec?.watchLevel === 'O2');

  for (const i of o2.slice(0, 2)) {

    lines.push(`反证 · ${i.name || i.id}：O2 二次反弹·快钱 · 通常不破前高 · 不恋战 · time-stop。`);

  }

  if (!lines.length) lines.push('反证：当前无 divergence/overshoot 信号 · 仍需跟踪命题 falsify');

  return lines;

}



function invalidateBriefCache() {

  briefCache = { payload: null, at: 0, key: null };

}

/**
 * Compact JSON payload for Daily Brief LLM narrative — derived from buildDailyBrief() output only.
 * @param {object} brief
 */
function buildDailyBriefLlmPayload(brief = {}) {
  const ta = brief.threeAnswers || {};
  const mc = brief.masterClock || {};
  const pg = brief.portfolioGate || {};
  const ct = brief.counterThesis || {};

  return {
    task: 'daily-brief-three-answers',
    threeAnswers: {
      happened: ta.happened || null,
      soWhat: ta.soWhat || null,
      why: ta.why || null,
      masterClockLines: ta.masterClockLines || mc.summaryThreeLines || [],
    },
    masterClock: {
      summaryThreeLines: mc.summaryThreeLines || [],
      postureCap: mc.postureCap || null,
      conflict: Boolean(mc.conflict),
    },
    noTradeDay: brief.noTradeDay || ta.noTradeDay || null,
    portfolioGate: {
      slotsUsed: pg.slotsUsed ?? null,
      maxPositions: pg.maxPositions ?? null,
      capNewScout: pg.capNewScout ?? null,
      capReason: pg.capReason || null,
    },
    backtestSummaryLine: brief.backtestSummaryLine || null,
    top5: (brief.top5 || []).map((t) => ({
      rank: t.rank,
      name: t.name,
      symbol: t.symbol,
      priorityScore: t.priorityScore ?? null,
      regime: t.regime || '',
      posture: t.posture || '暂无',
    })),
    counterThesis: {
      summary: ct.summary || null,
      dissent: (ct.dissent || []).slice(0, 5),
    },
    factorLine: brief.factorLine || ta.factorLine || null,
    followAdvice: brief.followAdvice || ta.followAdvice || null,
    carryLine: brief.carryLine || ta.carryLine || null,
    asOf: brief.asOf || null,
    dataSource: brief.dataSource || 'daily-brief-synthesis',
  };
}

module.exports = {

  BRIEF_VERSION,

  BRIEF_CACHE_MS,

  buildDailyBrief,

  buildThreeAnswers,

  buildDailyBriefLlmPayload,

  buildResearchPoolTable,

  buildTop5Priorities,

  invalidateBriefCache,

};

