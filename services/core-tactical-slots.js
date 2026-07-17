/**
 * Core / Tactical slot classification — max 2 core + 1 tactical within 3 slots.
 * v1.47.0-retail-discipline
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { MAX_POSITIONS } = require('./portfolio-gate');

const SLOT_VERSION = 'v1.47.0-retail-discipline';
const MAX_CORE = 2;
const MAX_TACTICAL = 1;
const O2_MAX_HOLD_DAYS_WARN = 5;

function nowIso() {
  return new Date().toISOString();
}

/**
 * O2 / watchLevel O2 = tactical; W3+ longTerm = core.
 */
function classifySlotType(inst) {
  const spec = inst?.integratedSpec || {};
  const wl = spec.watchLevel;
  const lt = inst?.longTermGuidance;
  if (wl === 'O2') return 'tactical';
  if (wl === 'W3' || wl === 'W4') return 'core';
  if (lt?.pilot && (lt.entry?.readiness === 'ready' || lt.entry?.readiness === 'approaching')) return 'core';
  if (wl === 'W2') return 'tactical';
  return 'unclassified';
}

function slotLabel(type) {
  if (type === 'core') return '核心';
  if (type === 'tactical') return '快钱';
  return '—';
}

/**
 * @param {string[]} holdings
 * @param {object[]} instruments guidance list with integratedSpec
 */
function computeCoreTacticalState(holdings = [], instruments = []) {
  const asOf = nowIso();
  const logicChain = [];
  const guidanceMap = new Map();
  for (const g of instruments || []) {
    if (g?.id) guidanceMap.set(normalizeCommodityId(g.id), g);
  }

  const slots = [];
  let coreCount = 0;
  let tacticalCount = 0;

  for (let i = 0; i < MAX_POSITIONS; i += 1) {
    const sym = holdings[i] ? normalizeCommodityId(holdings[i]) : null;
    if (!sym) {
      slots.push({ slot: i + 1, symbol: null, slotType: null, slotLabel: '空', posture: '', watchLevel: '' });
      continue;
    }
    const inst = guidanceMap.get(sym);
    const slotType = inst ? classifySlotType(inst) : 'unclassified';
    const wl = inst?.integratedSpec?.watchLevel || '';
    const posture = inst?.tradingGuidance?.posture || '暂无';
    if (slotType === 'core') coreCount += 1;
    if (slotType === 'tactical') tacticalCount += 1;

    let holdWarn = null;
    if (slotType === 'tactical' && wl === 'O2') {
      const o2Rules = inst?.integratedSpec?.o2ExitRules;
      holdWarn = o2Rules ? `O2 快钱 ≤${o2Rules.maxHoldDays || O2_MAX_HOLD_DAYS_WARN}d` : 'O2 不宜久持';
    }

    slots.push({
      slot: i + 1,
      symbol: sym,
      name: inst?.name || sym.toUpperCase(),
      slotType,
      slotLabel: slotLabel(slotType),
      watchLevel: wl,
      posture,
      holdWarn,
    });
  }

  const warnings = [];
  if (tacticalCount >= 3) {
    warnings.push('三槽均为快钱/O2 · 缺少核心长线锚');
    logicChain.push({ layer: 'CoreTactical', conclusion: '3-tactical', evidence: warnings[warnings.length - 1], dataSource: 'core-tactical-slots', asOf });
  } else if (tacticalCount > MAX_TACTICAL) {
    warnings.push(`快钱槽 ${tacticalCount} > ${MAX_TACTICAL} · 宜保留核心位`);
    logicChain.push({ layer: 'CoreTactical', conclusion: 'tactical-over', evidence: warnings[warnings.length - 1], dataSource: 'core-tactical-slots', asOf });
  }
  if (coreCount > MAX_CORE) {
    warnings.push(`核心槽 ${coreCount} > ${MAX_CORE}`);
    logicChain.push({ layer: 'CoreTactical', conclusion: 'core-over', evidence: warnings[warnings.length - 1], dataSource: 'core-tactical-slots', asOf });
  }

  const o2Held = slots.filter((s) => s.slotType === 'tactical' && s.watchLevel === 'O2' && s.symbol);
  for (const s of o2Held) {
    warnings.push(`${s.name} O2 快钱持仓 · 注意 time-stop`);
  }

  const briefLine = warnings.length ? warnings.join(' · ') : null;

  return {
    maxCore: MAX_CORE,
    maxTactical: MAX_TACTICAL,
    coreCount,
    tacticalCount,
    slots,
    warnings,
    briefLine,
    logicChain,
    dataSource: 'core-tactical-slots',
    method: 'O2=tactical W3+=core',
    version: SLOT_VERSION,
    asOf,
  };
}

function fmtBacktestHitWithSample(rate, hits, total) {
  if (rate == null) return null;
  const pct = Math.round(rate * 100);
  if (hits != null && total != null && total > 0) {
    return { rate, pct, hits, n: total, formatted: `${pct}% (${hits}/${total})` };
  }
  return { rate, pct, hits: hits ?? null, n: total ?? null, formatted: `${pct}%` };
}

function buildEmptySlotReason(slotIndex, portfolioGate = {}, brief = {}) {
  const noTrade = brief?.noTradeDay;
  if (noTrade?.noTradeDay) return noTrade.topLine || '今日 follow 模式 · 系统建议不新开仓';
  if (portfolioGate?.slotsFree <= 0) return '三槽已满 · 腾槽后方可新开';
  if (portfolioGate?.capNewScout) return portfolioGate.capReason || '组合门禁 · 新开试仓受限';
  if (portfolioGate?.clusterGate?.capNewScout) {
    return portfolioGate.clusterGate.capReason || '相关性簇门禁 · 不宜加第三同类槽';
  }
  const used = portfolioGate?.slotsUsed ?? 0;
  const sugIdx = slotIndex - 1 - used;
  const suggestions = portfolioGate?.suggestions || [];
  const sug = sugIdx >= 0 ? suggestions[sugIdx] : suggestions[0];
  if (sug) {
    return `空槽 · 研究池可考虑 ${sug.name || sug.symbol}（R${sug.regime || '—'} · score ${sug.priorityScore ?? '—'}）`;
  }
  return '空槽 · 尚无 scout 放行品种或 research pool 待校验';
}

function buildSlotInstrumentContext(inst, slot, top5Map) {
  const spec = inst?.integratedSpec;
  const sym = normalizeCommodityId(inst?.id || slot.symbol || '');
  const top5Entry = top5Map?.get(String(sym).toLowerCase());
  const trap = spec?.retailTrap;
  const opponent = spec?.opponentStatus;

  return {
    slot: slot.slot,
    instrumentId: sym || null,
    name: inst?.name || slot.name || (sym ? sym.toUpperCase() : '—'),
    slotType: slot.slotType,
    slotLabel: slot.slotLabel,
    watchLevel: slot.watchLevel || spec?.watchLevel || '',
    posture: slot.posture || inst?.tradingGuidance?.posture || '暂无',
    regime: spec?.regime?.regime || null,
    regimeLabel: spec?.regime?.label || null,
    playbook: spec?.playbook
      ? {
          id: spec.playbook.id,
          stage: spec.playbook.stage || null,
          narrativeZh: spec.playbook.narrativeZh || null,
        }
      : null,
    trap: trap
      ? { score: trap.score ?? null, badge: trap.badge || null, highTrap: Boolean(trap.highTrap) }
      : null,
    opponent: opponent
      ? {
          label: opponent.label || null,
          noChase: Boolean(opponent.noChase),
          opponentCapitulated: Boolean(opponent.opponentCapitulated),
        }
      : null,
    backtestHitRate30d: fmtBacktestHitWithSample(
      inst?.backtestHitRate30d,
      inst?.backtestHits30d,
      inst?.backtestTotal30d
    ),
    whySelected: top5Entry
      ? {
          top5Rank: top5Entry.rank,
          priorityScore: top5Entry.priorityScore,
          watchLevel: top5Entry.watchLevel,
        }
      : spec?.priorityScore != null
        ? { priorityScore: spec.priorityScore, watchLevel: spec?.watchLevel }
        : null,
    holdWarn: slot.holdWarn || null,
    empty: false,
  };
}

/**
 * Structured JSON for slot-decision LLM / rule narrative.
 * @param {object} outlookPayload
 * @param {string[]} holdings
 * @param {object} brief 'buildDailyBrief output'
 */
function buildSlotDecisionContext(outlookPayload = {}, holdings = [], brief = {}) {
  const instruments = outlookPayload.instruments || [];
  const guidanceMap = new Map();
  for (const g of instruments) {
    if (g?.id) guidanceMap.set(normalizeCommodityId(g.id), g);
  }

  const held = Array.isArray(holdings) ? holdings : [];
  const coreTactical =
    brief.coreTactical ||
    brief.portfolioGate?.coreTactical ||
    computeCoreTacticalState(held, instruments);
  const portfolioGate = brief.portfolioGate || {};
  const top5Map = new Map(
    (brief.top5 || []).map((t) => [String(t.symbol || t.id || '').toLowerCase(), t])
  );

  const slots = (coreTactical?.slots || []).map((slot) => {
    if (!slot.symbol) {
      return {
        slot: slot.slot,
        instrumentId: null,
        empty: true,
        slotLabel: slot.slotLabel || '空',
        emptyReason: buildEmptySlotReason(slot.slot, portfolioGate, brief),
      };
    }
    const inst = guidanceMap.get(normalizeCommodityId(slot.symbol));
    return buildSlotInstrumentContext(inst, slot, top5Map);
  });

  const heldIds = new Set(
    slots.filter((s) => !s.empty && s.instrumentId).map((s) => String(s.instrumentId).toLowerCase())
  );
  const researchSuggestions = (brief.top5 || portfolioGate.suggestions || [])
    .slice(0, 5)
    .map((s) => ({
      symbol: s.symbol || s.id,
      name: s.name,
      regime: s.regime || s.integratedSpec?.regime?.regime || null,
      priorityScore: s.priorityScore ?? s.integratedSpec?.priorityScore ?? null,
      posture: s.posture || s.tradingGuidance?.posture || '暂无',
      rank: s.rank,
      notHeldReason: heldIds.has(String(s.symbol || s.id || '').toLowerCase())
        ? 'already-held'
        : brief.noTradeDay?.noTradeDay
          ? 'no-trade-day'
          : portfolioGate.capNewScout
            ? portfolioGate.capReason || 'portfolio-gate-cap'
            : s.posture === '观望' || s.posture === '禁止'
              ? `posture-${s.posture}`
              : null,
    }));

  const masterClock = brief.masterClock || outlookPayload.masterClock;
  const globalRisk = outlookPayload.globalRisk || outlookPayload.globalLiquidityRisk;

  return {
    slots,
    emptySlots: {
      capReason: portfolioGate.capReason || null,
      capNewScout: Boolean(portfolioGate.capNewScout),
      slotsFree: portfolioGate.slotsFree,
      noTradeDay: brief.noTradeDay
        ? {
            noTradeDay: Boolean(brief.noTradeDay.noTradeDay),
            topLine: brief.noTradeDay.topLine || null,
            reasons: brief.noTradeDay.reasons || [],
          }
        : null,
      suggestions: researchSuggestions,
    },
    portfolioGate: {
      maxPositions: portfolioGate.maxPositions || MAX_POSITIONS,
      slotsUsed: portfolioGate.slotsUsed,
      slotsFree: portfolioGate.slotsFree,
      capNewScout: Boolean(portfolioGate.capNewScout),
      capReason: portfolioGate.capReason || null,
      clusterWarning: brief.clusterWarning || portfolioGate.clusterGate?.clusterWarning || null,
    },
    followAdvice: brief.followAdvice || brief.factorLine || brief.threeAnswers?.followAdvice || null,
    masterClock: masterClock
      ? {
          summaryThreeLines: masterClock.summaryThreeLines || [],
          phase: masterClock.phase || null,
          tier: masterClock.tier || null,
        }
      : null,
    coreTactical: {
      coreCount: coreTactical?.coreCount,
      tacticalCount: coreTactical?.tacticalCount,
      warnings: coreTactical?.warnings || [],
    },
    globalRisk: globalRisk
      ? { tier: globalRisk.tier || globalRisk.liquidityShockTier, regime: globalRisk.regime }
      : null,
    asOf: nowIso(),
    dataSource: 'core-tactical-slots',
    method: 'slot-decision-context',
    version: SLOT_VERSION,
  };
}

module.exports = {
  SLOT_VERSION,
  MAX_CORE,
  MAX_TACTICAL,
  classifySlotType,
  slotLabel,
  computeCoreTacticalState,
  buildSlotDecisionContext,
  buildEmptySlotReason,
  fmtBacktestHitWithSample,
};
