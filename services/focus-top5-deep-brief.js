/**
 * Top5 战场深度解读 — Cursor 专用，聚合研判全链路结构化数据
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getExternalRoot } = require('./data-paths');
const { isUserFocusSymbol, getFocusMeta } = require('./user-focus-symbols');
const { todaySessionDate } = require('./focus-read-state');
const { buildBattleIntel } = require('./focus-intelligence-brief');
const { loadCachedWebNews } = require('./focus-anysearch-news');
const {
  analyzeWithCursor,
  TOP5_DEEP_BRIEF_PROMPT,
  parseTop5DeepSections,
  isCursorConfigured,
  getCloudConcurrencyLimit,
} = require('./cursor-llm-client');

const BRIEF_VERSION = 'v1.50.1-top5-deep';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function briefDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'focus-analysis', 'top5-deep');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function briefFilePath(symbol, sessionDate = todaySessionDate()) {
  const dir = briefDir();
  if (!dir) return null;
  const dayDir = path.join(dir, sessionDate);
  fs.mkdirSync(dayDir, { recursive: true });
  return path.join(dayDir, `${normalizeCommodityId(symbol)}.json`);
}

function loadCachedTop5DeepBrief(symbol, sessionDate = todaySessionDate()) {
  const fp = briefFilePath(symbol, sessionDate);
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

function saveTop5DeepBrief(symbol, payload) {
  const fp = briefFilePath(symbol);
  if (!fp) return null;
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function safeInstrumentBrief(inst, outlookPayload = {}) {
  try {
    if (inst.aiFusion?.instrumentBrief) return inst.aiFusion.instrumentBrief;
    const { buildInstrumentBrief } = require('./fancheng-ai-fusion');
    return buildInstrumentBrief(inst, {
      globalRisk: outlookPayload.globalLiquidityRisk || outlookPayload.globalRisk,
      macroSynthesis: outlookPayload.macroSynthesis,
    });
  } catch {
    return null;
  }
}

function buildRichBattleContext(inst, outlookPayload = {}) {
  const sym = normalizeCommodityId(inst?.id);
  const webNews = loadCachedWebNews(sym, { allowStale: true });
  const battleIntel = buildBattleIntel(inst, { webNews });
  const instrumentBrief = safeInstrumentBrief(inst, outlookPayload);
  const tech = inst.factors?.technical;
  const vol = inst.factors?.volume;
  const oi = inst.factors?.oi;
  const inv = inst.factors?.inventory;
  const macroLine = outlookPayload.macroSynthesis?.perSymbol?.[sym] || inst.macroSynthesis || null;

  return {
    sessionDate: todaySessionDate(),
    role: 'top5-battle-deep-brief',
    battleIntel,
    webNews: webNews
      ? {
          fetchedAt: webNews.fetchedAt,
          ok: webNews.ok,
          dataSource: webNews.dataSource,
          items: (webNews.items || []).slice(0, 6).map((i) => ({
            title: i.title,
            snippet: i.snippet ? String(i.snippet).slice(0, 160) : null,
            source: i.source,
            url: i.url,
          })),
        }
      : null,
    instrument: {
      id: sym,
      name: inst.name,
      exchange: inst.exchange,
      price: inst.price ?? null,
      priceSource: inst.priceSource || inst.dataSource || null,
      changePct: inst.changePct ?? inst.changePercent ?? null,
      directionLabel: inst.directionLabel || null,
      directionTier: inst.directionTier || null,
      compositeScore: inst.compositeScore ?? null,
      capitalAttention: inst.capitalAttention || null,
      intelligenceKernel: battleIntel?.intelligenceKernel || inst.intelligenceKernel || null,
      philosophy: inst.philosophy
        ? {
            logicSummary: inst.philosophy.logicSummary || null,
            policy: inst.philosophy.policy || null,
            ranked: inst.philosophy.ranked?.primary?.slice(0, 3) || null,
          }
        : null,
      philosophyFilter: inst.philosophyFilter || null,
      quantGate: inst.quantGate || null,
      regimeGate: inst.regimeGate || null,
      integratedSpec: inst.integratedSpec
        ? {
            priorityScore: inst.integratedSpec.priorityScore ?? null,
            regime: inst.integratedSpec.regime || null,
            watchLevel: inst.integratedSpec.watchLevel || null,
            playbook: inst.integratedSpec.playbook || null,
          }
        : null,
      tradingGuidance: inst.tradingGuidance
        ? {
            posture: inst.tradingGuidance.posture,
            phase: inst.tradingGuidance.phase,
            bias: inst.tradingGuidance.bias,
            position: inst.tradingGuidance.position,
            confidence: inst.tradingGuidance.confidence || null,
            logicChain: (inst.tradingGuidance.logicChain || []).slice(0, 8),
            dataSource: inst.tradingGuidance.dataSource,
          }
        : null,
      longTermGuidance: inst.longTermGuidance
        ? {
            entry: inst.longTermGuidance.entry || null,
            stop: inst.longTermGuidance.stop || null,
            hold: inst.longTermGuidance.hold || null,
            thesisStatus: inst.longTermGuidance.thesisStatus || null,
            dataSource: inst.longTermGuidance.dataSource,
          }
        : null,
      nextDayRangePct: inst.nextDayRangePct
        ? {
            mid: inst.nextDayRangePct.mid,
            halfWidth: inst.nextDayRangePct.halfWidth,
            expectedMovePct: inst.nextDayRangePct.expectedMovePct,
            scenarios: inst.nextDayRangePct.scenarios || null,
            dataSource: inst.nextDayRangePct.dataSource || 'next-day-range-predictor',
          }
        : null,
      highLowPrediction: inst.highLowPrediction || null,
      rangeComparison: inst.rangeComparison || null,
      rationaleSummary: inst.rationaleSummary || inst.predictionRationale || null,
      factors: {
        technical: tech?.hasEnough
          ? {
              trend: tech.trend,
              maStack: tech.maStack || null,
              boll: tech.boll || null,
              rsi: tech.rsi ?? null,
              volPercentile: tech.smoothedVol?.percentile ?? null,
            }
          : { hasEnough: false, sourceNote: tech?.sourceNote || null },
        volume: vol || null,
        oi: oi || null,
        inventory: inv || null,
        macro: inst.factors?.macro || null,
        news: inst.factors?.news
          ? { summary: inst.factors.news.summary, hits: (inst.factors.news.hits || []).slice(0, 4) }
          : null,
      },
      activeTheses: (inst.activeTheses || []).slice(0, 4).map((t) => ({
        title: t.title || t.id,
        status: t.status,
        claim: t.claim ? String(t.claim).slice(0, 120) : null,
      })),
      backtest: inst.backtestSummary || inst.directionBacktest || null,
    },
    crossModule: {
      dailyBrief: outlookPayload.dailyBrief
        ? {
            headline: outlookPayload.dailyBrief.headline || outlookPayload.dailyBrief.title || null,
            regime: outlookPayload.dailyBrief.regime || outlookPayload.dailyBrief.globalRegime || null,
            narrative: outlookPayload.dailyBrief.narrative
              ? String(outlookPayload.dailyBrief.narrative).slice(0, 280)
              : null,
          }
        : null,
      aiMacroBrief: outlookPayload.aiMacroBrief
        ? {
            summary: outlookPayload.aiMacroBrief.summary || outlookPayload.aiMacroBrief.headline || null,
            asOf: outlookPayload.aiMacroBrief.asOf || null,
          }
        : null,
      aiFusionBrief: instrumentBrief
        ? {
            summary: instrumentBrief.summary,
            keyPoints: (instrumentBrief.keyPoints || []).slice(0, 5).map((p) => p.text || p),
            actionAdvice: instrumentBrief.actionAdvice,
            counterThesis: instrumentBrief.counterThesis?.summary || instrumentBrief.counterThesis?.headline || null,
            method: instrumentBrief.method,
            dataSource: instrumentBrief.dataSource,
          }
        : null,
      macroPerSymbol: macroLine,
      globalRisk: outlookPayload.globalLiquidityRisk || outlookPayload.globalRisk || null,
      globalRegime: outlookPayload.globalRegime || outlookPayload.globalRegimeLabel || null,
    },
    dataIntegrity: {
      insufficientData: Boolean(inst.insufficientData),
      priceMissing: inst.price == null,
    },
  };
}

async function generateTop5DeepBrief(inst, outlookPayload = {}, options = {}) {
  const sym = normalizeCommodityId(inst?.id);
  if (!sym || !isUserFocusSymbol(sym)) return null;
  const sessionDate = todaySessionDate();

  if (!options.force) {
    const cached = loadCachedTop5DeepBrief(sym, sessionDate);
    if (cached && !cached.stale && cached.deepBrief?.text) return cached;
  }

  const context = buildRichBattleContext(inst, outlookPayload);
  const cursorResult = await analyzeWithCursor(TOP5_DEEP_BRIEF_PROMPT, context, {
    ...options,
    reuseAgent: options.reuseAgent !== false,
  });
  const sections = parseTop5DeepSections(cursorResult.text);

  const payload = {
    version: BRIEF_VERSION,
    sessionDate,
    symbol: sym,
    name: inst.name || getFocusMeta(sym).name,
    rank: options.rank ?? null,
    generatedAt: new Date().toISOString(),
    cursorConfigured: isCursorConfigured(),
    deepBrief: {
      ...sections,
      text: cursorResult.text,
      method: cursorResult.method,
      provider: cursorResult.provider,
      model: cursorResult.model,
      error: cursorResult.error || null,
    },
    structuredContext: context,
    dataSource: 'focus-top5-deep-brief',
  };

  if (cursorResult.text) saveTop5DeepBrief(sym, payload);
  return payload;
}

async function generateTop5DeepBriefs(top5Rows = [], outlookPayload = {}, options = {}) {
  const list = top5Rows.filter((r) => r?.symbol && isUserFocusSymbol(r.symbol));
  const instrumentMap = new Map(
    (outlookPayload.instruments || []).map((i) => [normalizeCommodityId(i.id), i])
  );
  const results = [];
  const concurrency = options.concurrency || Math.min(3, getCloudConcurrencyLimit());
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const i = idx++;
      const row = list[i];
      const inst = instrumentMap.get(normalizeCommodityId(row.symbol));
      if (!inst) continue;
      try {
        const brief = await generateTop5DeepBrief(inst, outlookPayload, {
          ...options,
          rank: row.rank,
        });
        if (brief) results.push(brief);
      } catch (err) {
        results.push({
          symbol: row.symbol,
          name: row.name,
          deepBrief: { text: null, error: err.message },
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
  return results;
}

function attachDeepBriefsToTop5(top5 = [], briefRows = []) {
  const map = new Map(briefRows.map((b) => [normalizeCommodityId(b.symbol), b]));
  return top5.map((row) => {
    const cached = map.get(normalizeCommodityId(row.symbol)) || loadCachedTop5DeepBrief(row.symbol);
    if (!cached?.deepBrief) return { ...row, deepBrief: null, deepBriefGeneratedAt: null };
    return {
      ...row,
      deepBrief: cached.deepBrief,
      deepBriefGeneratedAt: cached.generatedAt || null,
      deepBriefVersion: cached.version || BRIEF_VERSION,
    };
  });
}

module.exports = {
  BRIEF_VERSION,
  buildRichBattleContext,
  loadCachedTop5DeepBrief,
  generateTop5DeepBrief,
  generateTop5DeepBriefs,
  attachDeepBriefsToTop5,
};
