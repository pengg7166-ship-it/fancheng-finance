/**
 * @deprecated facade — prefer global-liquidity-risk.js
 * Kept for backward-compatible imports across engine / live refresh.
 */
const {
  GLOBAL_LIQUIDITY_RISK_VERSION,
  REGIME_RULES,
  computeGlobalLiquidityRisk,
  invalidateGlobalLiquidityRiskCache,
} = require('./global-liquidity-risk');
const { normalizeCommodityId } = require('./policy-commodity-map');
const outlookTradingGuidance = require('./outlook-trading-guidance');
const longTermTradingGuidance = require('./long-term-trading-guidance');

const GLOBAL_RISK_VERSION = GLOBAL_LIQUIDITY_RISK_VERSION;
const THRESHOLDS = REGIME_RULES.thresholds;
/** regime → default tier when `tier` field absent (L2 must not collapse to L1) */
const REGIME_TO_TIER = Object.freeze({
  normal: 'L0',
  tightening: 'L1',
  deleveraging: 'L2',
  shock: 'L3',
});

function refreshPilotGuidance(inst, globalRisk) {
  const tradingGuidance = outlookTradingGuidance.refreshTradingGuidance(inst, { globalRisk });
  const longTermGuidance = longTermTradingGuidance.refreshLongTermGuidance(
    { ...inst, tradingGuidance },
    { globalRisk, tradingGuidance }
  );
  const enriched = { ...inst, tradingGuidance, longTermGuidance };
  let aiFusion = null;
  try {
    const { attachInstrumentAiFusion } = require('./fancheng-ai-fusion');
    aiFusion = attachInstrumentAiFusion(enriched, globalRisk);
  } catch {
    // non-fatal
  }
  return { ...enriched, aiFusion };
}

function computeGlobalRiskRegime(sources = {}, opts = {}) {
  const ctx = {
    sources,
    instruments: opts.instruments || [],
    thesisRegistry: opts.thesisRegistry,
    force: opts.force,
  };
  return computeGlobalLiquidityRisk(ctx);
}

function resolveThesisRegistry(opts = {}) {
  if (opts.thesisRegistry) return opts.thesisRegistry;
  try {
    return require('./thesis-registry');
  } catch {
    return null;
  }
}

function resolveActiveTheses(thesisRegistry, opts = {}) {
  return (
    thesisRegistry?.getActiveTheses?.() ||
    thesisRegistry?.queryActiveTheses?.() ||
    opts.activeTheses ||
    []
  );
}

function resolveHoldings(opts = {}) {
  if (opts.holdings) return opts.holdings;
  try {
    const store = require('./portfolio-holdings-store');
    return store.getPortfolioHoldings?.() || [];
  } catch {
    return [];
  }
}

function resolveNewsPool(sources = {}) {
  try {
    const { getGlobalNewsPoolSync } = require('./commodities-news');
    return getGlobalNewsPoolSync?.() || sources.newsPool || [];
  } catch {
    return sources.newsPool || [];
  }
}

function needsMacroSynthesisHydration(outlook) {
  if (!outlook?.instruments?.length) return false;
  if (outlook.macroSynthesis?.narrativeSummary != null) return false;
  const pilot = outlook.instruments.find((i) => outlookTradingGuidance.isPilotSymbol(i.id));
  if (!pilot) return false;
  const sid = normalizeCommodityId(pilot.id);
  const sym = pilot.macroSynthesis?.perSymbol?.[sid] || pilot.macroSynthesis;
  return !sym?.activeTheses?.length && outlook.macroSynthesis?.activeThesisCount == null;
}

function needsIntegratedSpecHydration(outlook) {
  if (!outlook?.instruments?.length) return false;
  const pilot = outlook.instruments.find((i) => outlookTradingGuidance.isPilotSymbol(i.id));
  if (!pilot) return false;
  return !pilot.integratedSpec?.version;
}

function needsOutlookGuidanceHydration(outlook) {
  if (!outlook?.instruments?.length) return false;
  if (!outlook.globalRisk && !outlook.globalLiquidityRisk) return true;
  const pilot = outlook.instruments.find((i) => outlookTradingGuidance.isPilotSymbol(i.id));
  if (pilot && !pilot.tradingGuidance?.pilot) return true;
  if (!outlook.aiMacroBrief?.summary && (outlook.globalRisk || outlook.globalLiquidityRisk)) return true;
  if (needsMacroSynthesisHydration(outlook)) return true;
  if (needsIntegratedSpecHydration(outlook)) return true;
  return false;
}

function attachPerInstrumentMacroSynthesis(instruments, synthResult) {
  const ms = synthResult?.macroSynthesis;
  if (!ms || !instruments?.length) return instruments;
  return instruments.map((inst) => {
    const sid = normalizeCommodityId(inst.id);
    const symData = ms.perSymbol?.[sid];
    return {
      ...inst,
      macroSynthesis: {
        ...(inst.macroSynthesis || {}),
        ...(symData || {}),
        perSymbol: ms.perSymbol,
        narrativeSummary: ms.narrativeSummary,
        crossCommodity: ms.crossCommodity,
        activeThesisCount: ms.activeThesisCount,
      },
    };
  });
}

function buildOutlookHydrateContext(sources, outlook, globalRisk, macroSynthResult, opts = {}) {
  const thesisRegistry = resolveThesisRegistry(opts);
  return {
    sources: sources || {},
    globalRisk,
    holdings: resolveHoldings(opts),
    newsPool: resolveNewsPool(sources || {}),
    macroSynthesis: macroSynthResult?.macroSynthesis || outlook.macroSynthesis || null,
    activeTheses: resolveActiveTheses(thesisRegistry, opts),
  };
}

function ensureOutlookGuidanceHydrated(outlook, sources = {}, opts = {}) {
  if (!outlook) return null;
  if (!opts.force && !needsOutlookGuidanceHydration(outlook)) return outlook;
  return refreshGlobalRiskOnOutlook(outlook, sources, opts) || outlook;
}

function refreshGlobalRiskOnOutlook(outlook, sources, opts = {}) {
  if (!outlook) return null;
  const hydrateErrors = [];
  const thesisRegistry = resolveThesisRegistry(opts);
  const globalRisk = computeGlobalLiquidityRisk({
    sources: sources || {},
    instruments: outlook.instruments || [],
    thesisRegistry,
    force: opts.force,
  });

  let macroSynthResult =
    outlook.macroSynthesisBundle ||
    (outlook.macroSynthesis ? { macroSynthesis: outlook.macroSynthesis } : null);
  if (!macroSynthResult?.macroSynthesis?.narrativeSummary || opts.force) {
    try {
      const { buildMacroSynthesis } = require('./thesis-synthesis');
      macroSynthResult = buildMacroSynthesis({
        sources: sources || {},
        globalRisk,
        instruments: outlook.instruments || [],
      });
    } catch (err) {
      hydrateErrors.push(`macroSynthesis: ${err?.message || err}`);
      macroSynthResult = outlook.macroSynthesisBundle || null;
    }
  }

  let instruments = outlook.instruments || [];
  if (instruments.length && macroSynthResult?.macroSynthesis) {
    instruments = attachPerInstrumentMacroSynthesis(instruments, macroSynthResult);
  }

  if (instruments.length) {
    instruments = instruments.map((inst) => {
      if (!outlookTradingGuidance.isPilotSymbol(inst.id)) return inst;
      return refreshPilotGuidance(inst, globalRisk);
    });
  }

  if (instruments.length) {
    try {
      const { attachIntegratedSpecBatch } = require('./integrated-spec-attach');
      const attachCtx = buildOutlookHydrateContext(sources, outlook, globalRisk, macroSynthResult, opts);
      instruments = attachIntegratedSpecBatch(instruments, attachCtx);
      instruments = instruments.map((inst) => {
        if (!outlookTradingGuidance.isPilotSymbol(inst.id)) return inst;
        return refreshPilotGuidance(inst, globalRisk);
      });
    } catch (err) {
      hydrateErrors.push(`integratedSpec: ${err?.message || err}`);
      console.warn('[global-risk-regime] integrated-spec attach:', err?.message || err);
    }
  }

  let aiMacroBrief = outlook.aiMacroBrief || null;
  try {
    const { buildMacroBrief } = require('./fancheng-ai-fusion');
    const activeTheses = resolveActiveTheses(thesisRegistry, opts);
    aiMacroBrief = buildMacroBrief(
      globalRisk,
      activeTheses,
      macroSynthResult?.macroSynthesis || outlook.macroSynthesis,
      {
        instruments,
        holdings: resolveHoldings(opts),
        sources: sources || {},
      }
    );
  } catch (err) {
    hydrateErrors.push(`aiMacroBrief: ${err?.message || err}`);
  }

  const macroSynthesis = macroSynthResult?.macroSynthesis || outlook.macroSynthesis || null;
  const integratedOk =
    !needsIntegratedSpecHydration({ instruments }) &&
    !hydrateErrors.some((e) => e.startsWith('integratedSpec'));

  return {
    ...outlook,
    globalRisk,
    globalLiquidityRisk: globalRisk,
    globalRiskRegime: globalRisk.regime,
    macroSynthesis,
    macroSynthesisBundle: macroSynthResult || outlook.macroSynthesisBundle || null,
    aiMacroBrief,
    instruments,
    hydrateStatus: {
      guidance: true,
      macroSynthesis: !!macroSynthesis?.narrativeSummary,
      integratedSpec: integratedOk,
      errors: hydrateErrors,
      asOf: new Date().toISOString(),
    },
  };
}

module.exports = {
  GLOBAL_RISK_VERSION,
  THRESHOLDS,
  REGIME_TO_TIER,
  REGIME_RULES,
  computeGlobalRiskRegime,
  refreshPilotGuidance,
  needsMacroSynthesisHydration,
  needsIntegratedSpecHydration,
  needsOutlookGuidanceHydration,
  ensureOutlookGuidanceHydrated,
  refreshGlobalRiskOnOutlook,
  attachPerInstrumentMacroSynthesis,
  invalidateGlobalLiquidityRiskCache,
};
