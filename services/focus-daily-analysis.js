/**
 * 关注品种每日分析 — 基本面 + 走势 + 仓位建议
 * AI 分析仅来自 Cursor 模型；数据上下文来自真实引擎输出
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getExternalRoot } = require('./data-paths');
const {
  isUserFocusSymbol,
  listUserFocusSymbols,
  getFocusMeta,
  filterToUserFocus,
  sortByFocusOrder,
} = require('./user-focus-symbols');
const { pickTop5, pickMajorOpportunities } = require('./focus-opportunity-ranker');
const { buildTop5IntelPackage } = require('./focus-intelligence-brief');
const {
  generateTop5DeepBriefs,
  attachDeepBriefsToTop5,
  loadCachedTop5DeepBrief,
  BRIEF_VERSION: TOP5_DEEP_VERSION,
} = require('./focus-top5-deep-brief');
const { getReadStateMap, todaySessionDate, setPinned } = require('./focus-read-state');
const { buildInstrumentExpectationContext } = require('./focus-expectation-factors');
const {
  analyzeWithCursor,
  parseAnalysisSections,
  ANALYSIS_SYSTEM_PROMPT,
  isCursorConfigured,
  getCloudConcurrencyLimit,
} = require('./cursor-llm-client');

const ANALYSIS_VERSION = 'v1.54.0-expectation-factors';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function analysisDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'focus-analysis', 'daily');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function analysisFilePath(symbol, sessionDate = todaySessionDate()) {
  const dir = analysisDir();
  if (!dir) return null;
  const sym = normalizeCommodityId(symbol);
  const dayDir = path.join(dir, sessionDate);
  fs.mkdirSync(dayDir, { recursive: true });
  return path.join(dayDir, `${sym}.json`);
}

function buildInstrumentContext(inst, outlookPayload = {}) {
  const tg = inst.tradingGuidance;
  const lt = inst.longTermGuidance;
  const phil = inst.philosophy;
  const factors = inst.factors;
  return {
    sessionDate: todaySessionDate(),
    instrument: {
      id: inst.id,
      name: inst.name,
      exchange: inst.exchange,
      price: inst.price ?? null,
      priceSource: inst.priceSource || inst.dataSource || null,
      changePct: inst.changePct ?? inst.changePercent ?? null,
      directionLabel: inst.directionLabel || null,
      directionTier: inst.directionTier || null,
      compositeScore: inst.compositeScore ?? null,
      capitalAttention: inst.capitalAttention || null,
      intelligenceKernel: (() => {
        try {
          const { resolveIntelligenceKernel } = require('./focus-intelligence-brief');
          const k = resolveIntelligenceKernel(inst);
          if (!k?.available) return { available: false, reason: k?.reason || 'missing' };
          return {
            available: true,
            version: k.version,
            summary: k.summary || null,
            stateKey: k.stateKey || null,
            mainContradiction: k.mainContradiction || null,
            dissent: k.dissent
              ? {
                  lean: k.dissent.lean,
                  supportingEvidence: (k.dissent.supportingEvidence || []).slice(0, 5),
                  opposingEvidence: (k.dissent.opposingEvidence || []).slice(0, 5),
                  dissentStrength: k.dissent.dissentStrength,
                  flipConditions: (k.dissent.flipConditions || []).slice(0, 4),
                }
              : null,
            conviction: k.conviction || null,
          };
        } catch {
          return { available: false, reason: 'resolve_failed' };
        }
      })(),
      philosophy: phil
        ? {
            logicSummary: phil.logicSummary || null,
            primary: phil.ranked?.primary?.slice(0, 2) || null,
            secondary: phil.ranked?.secondary?.slice(0, 2) || null,
          }
        : null,
      factors: factors
        ? {
            technical: factors.technical?.hasEnough
              ? {
                  trend: factors.technical.trend || null,
                  rsi: factors.technical.rsi ?? null,
                  volPercentile: factors.technical.smoothedVol?.percentile ?? null,
                }
              : { hasEnough: false },
            macro: factors.macro || null,
            inventory: factors.inventory || null,
            oi: factors.oi || null,
          }
        : null,
      tradingGuidance: tg
        ? {
            posture: tg.posture,
            phase: tg.phase,
            bias: tg.bias,
            position: tg.position,
            logicChain: (tg.logicChain || []).slice(0, 6),
            dataSource: tg.dataSource,
          }
        : null,
      longTermGuidance: lt
        ? {
            entry: lt.entry || null,
            stop: lt.stop || null,
            hold: lt.hold || null,
            dataSource: lt.dataSource,
          }
        : null,
      integratedSpec: inst.integratedSpec
        ? {
            priorityScore: inst.integratedSpec.priorityScore ?? null,
            regime: inst.integratedSpec.regime?.regime || null,
            watchLevel: inst.integratedSpec.watchLevel || null,
          }
        : null,
      activeTheses: (inst.activeTheses || []).slice(0, 3).map((t) => ({
        title: t.title || t.id,
        status: t.status,
        linkedSymbols: t.linkedSymbols,
      })),
      expectationFactors: buildInstrumentExpectationContext(inst, outlookPayload),
    },
    macro: {
      globalRisk: outlookPayload.globalLiquidityRisk || outlookPayload.globalRisk || null,
      macroSynthesis: outlookPayload.macroSynthesis || null,
    },
    dataIntegrity: {
      insufficientData: Boolean(inst.insufficientData),
      priceMissing: inst.price == null,
    },
  };
}

function loadCachedAnalysis(symbol, sessionDate = todaySessionDate()) {
  const fp = analysisFilePath(symbol, sessionDate);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (row.sessionDate !== sessionDate) return null;
    const age = Date.now() - new Date(row.generatedAt || 0).getTime();
    if (Number.isNaN(age) || age > CACHE_TTL_MS) return { ...row, stale: true };
    return row;
  } catch {
    return null;
  }
}

function saveAnalysis(symbol, payload) {
  const fp = analysisFilePath(symbol);
  if (!fp) return null;
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function generateInstrumentAnalysis(inst, outlookPayload = {}, options = {}) {
  const sym = normalizeCommodityId(inst?.id);
  if (!sym || !isUserFocusSymbol(sym)) return null;
  const sessionDate = todaySessionDate();

  if (!options.force) {
    const cached = loadCachedAnalysis(sym, sessionDate);
    if (cached && !cached.stale && cached.analysis?.text) return cached;
  }

  const context = buildInstrumentContext(inst, outlookPayload);
  const cursorResult = await analyzeWithCursor(ANALYSIS_SYSTEM_PROMPT, context, {
    ...options,
    reuseAgent: options.reuseAgent !== false,
  });
  const sections = parseAnalysisSections(cursorResult.text);

  const payload = {
    version: ANALYSIS_VERSION,
    sessionDate,
    symbol: sym,
    name: inst.name || getFocusMeta(sym).name,
    generatedAt: new Date().toISOString(),
    cursorConfigured: isCursorConfigured(),
    analysis: {
      ...sections,
      text: cursorResult.text,
      method: cursorResult.method,
      provider: cursorResult.provider,
      model: cursorResult.model,
      error: cursorResult.error || null,
    },
    structuredContext: context,
    dataSource: 'focus-daily-analysis',
  };

  if (cursorResult.text) saveAnalysis(sym, payload);
  return payload;
}

async function generateAllFocusAnalyses(outlookPayload = {}, options = {}) {
  const instruments = sortByFocusOrder(filterToUserFocus(outlookPayload.instruments || []));
  const results = [];
  const concurrency = options.concurrency || getCloudConcurrencyLimit();
  let idx = 0;

  async function worker() {
    while (idx < instruments.length) {
      const i = idx++;
      const inst = instruments[i];
      try {
        const row = await generateInstrumentAnalysis(inst, outlookPayload, options);
        if (row) results.push(row);
      } catch (err) {
        results.push({
          symbol: inst.id,
          name: inst.name,
          error: err.message,
          analysis: { text: null, error: err.message },
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, instruments.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function buildFocusDashboard(outlookPayload = {}, analyses = [], top5BriefRows = []) {
  const instruments = sortByFocusOrder(filterToUserFocus(outlookPayload.instruments || []));
  const intelPack = buildTop5IntelPackage(instruments, outlookPayload);
  const top5 = attachDeepBriefsToTop5(intelPack.top5, top5BriefRows);
  const majorOpportunities = intelPack.majorOpportunities;
  const pinned = setPinned(majorOpportunities.map((m) => m.symbol));
  const readState = getReadStateMap(instruments.map((i) => i.id));

  const analysisMap = new Map(analyses.map((a) => [normalizeCommodityId(a.symbol), a]));

  const rows = instruments.map((inst) => {
    const sym = normalizeCommodityId(inst.id);
    const rank = top5.find((t) => t.symbol === sym);
    const major = majorOpportunities.find((m) => m.symbol === sym);
    const analysis = analysisMap.get(sym) || loadCachedAnalysis(sym);
    return {
      symbol: sym,
      name: inst.name,
      exchange: inst.exchange,
      price: inst.price ?? null,
      directionLabel: inst.directionLabel,
      posture: inst.tradingGuidance?.posture || '暂无',
      position: inst.tradingGuidance?.position || null,
      priorityScore: inst.integratedSpec?.priorityScore ?? rank?.priorityScore ?? null,
      top5Rank: rank?.rank ?? null,
      isTop5: Boolean(rank),
      isMajorOpportunity: Boolean(major),
      opportunityTier: major ? 'major' : rank ? 'elevated' : 'normal',
      pinned: pinned.includes(sym),
      read: readState[sym]?.read || false,
      readAt: readState[sym]?.readAt || null,
      analysis: analysis?.analysis || {
        fundamentalAnalysis: null,
        trendAnalysis: null,
        positionAdvice: null,
        text: null,
        error: isCursorConfigured() ? '分析生成中或待刷新' : '待配置 CURSOR_API_KEY',
      },
      generatedAt: analysis?.generatedAt || null,
    };
  });

  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.isMajorOpportunity !== b.isMajorOpportunity) return a.isMajorOpportunity ? -1 : 1;
    if (a.isTop5 !== b.isTop5) return a.isTop5 ? -1 : 1;
  });

  return {
    version: ANALYSIS_VERSION,
    sessionDate: todaySessionDate(),
    cursorConfigured: isCursorConfigured(),
    focusCount: instruments.length,
    top5,
    majorOpportunities,
    pinned,
    intelVersion: require('./focus-intelligence-brief').BRIEF_VERSION,
    top5DeepVersion: TOP5_DEEP_VERSION,
    instruments: rows,
    dataSource: 'focus-daily-analysis',
    generatedAt: new Date().toISOString(),
  };
}

async function getFocusDashboard(outlookPayload = {}, options = {}) {
  const instruments = sortByFocusOrder(filterToUserFocus(outlookPayload.instruments || []));
  const intelPack = buildTop5IntelPackage(instruments, outlookPayload);
  let top5BriefRows = intelPack.top5
    .map((row) => loadCachedTop5DeepBrief(row.symbol))
    .filter(Boolean);

  let analyses = [];
  if (options.generate !== false && isCursorConfigured()) {
    if (options.top5Deep !== false) {
      top5BriefRows = await generateTop5DeepBriefs(intelPack.top5, outlookPayload, {
        force: options.force === true,
        concurrency: options.top5Concurrency || Math.min(3, getCloudConcurrencyLimit()),
      });
    }
    analyses = await generateAllFocusAnalyses(outlookPayload, { force: options.force });
  } else {
    analyses = listUserFocusSymbols()
      .map((sym) => loadCachedAnalysis(sym))
      .filter(Boolean);
  }
  return buildFocusDashboard(outlookPayload, analyses, top5BriefRows);
}

module.exports = {
  ANALYSIS_VERSION,
  buildInstrumentContext,
  generateInstrumentAnalysis,
  generateAllFocusAnalyses,
  buildFocusDashboard,
  getFocusDashboard,
  loadCachedAnalysis,
  loadCachedTop5DeepBrief,
};
