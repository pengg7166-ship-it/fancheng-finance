/**
 * Philosophy Direction Filter v2 'Step 2 (experiment path only)
 * Day-type rules: policy/event/routine paths, delivery calendar, sector playbooks.
 * Enable: PHILOSOPHY_FILTER_V2=1 (production default off)
 */
const newsTagged = require('./news-tagged-loader');
const philosophy = require('./commodity-outlook-philosophy');
const { FANCHENG_PHILOSOPHY } = require('./fancheng-philosophy');
const { detectPolicyTypes } = require('./policy-commodity-map');
const { loadWarehouseRows } = require('./shfe-warehouse-fetcher');
const deliveryCalendar = require('./delivery-calendar');
const crossMarketPrecious = require('./cross-market-precious-inference');
const { computeOiBehaviorAtBar } = require('./oi-behavior-features');
const { getCuMomentum5dAtDate } = require('./ag-industrial-proxy');

const FILTER_VERSION = 'v2-step3';

const PRICED_IN_WEIGHTS = { priceCross: 0.35, volumeOi: 0.30, newsRepeat: 0.35 };
const PRICED_IN_FULL_THRESHOLD = 0.7;
const PRICED_IN_PARTIAL_THRESHOLD = 0.35;
const PRICED_IN_ALPHA_DEFAULT = 1;
const PHILOSOPHY_CONF_BASE_SCALE = 0.5;
const VOLUME_BASELINE_DAYS = 20;

const DEFAULT_LOOKBACK_N = 5;
const DEFAULT_DIVERGENCE_THRESHOLD = 4;
const MAIN_CONTRACT_BASE_WEIGHT = 0.25;
const PHILOSOPHY_DIR_THRESHOLD = 0.12;

const DOMESTIC_POLICY_RE =
  /国务院|常务会议|发改委|工信部|生态环境部|自然资源部|住建部|商务部|能源局|应急管理部|市场监管|产业规划|环保限产|产能置换|粗钢产量|双碳|碳中和|supply-side|供给侧改革|反内卷|限产|抛储|收储/i;

const EVENT_SOURCE_TIERS = new Set(['geo', 'geopolitics', 'climate', 'supply', 'shock']);

const SUPPLY_EVENT_RE =
  /eventType\s*=\s*supply|供应冲击|supply.?shock|停产|检修扩产|矿山事故|断供|出口禁令|禁运/i;

const SECTOR_PLAYBOOK = {
  precious: {
    crossMarketLead: 'CMX',
    targets: ['au', 'ag'],
    hintKey: 'cmx_precious_lead',
    narrative: 'CMX金银5d方向门控',
  },
  metals: {
    crossMarketLead: 'LME',
    targets: ['cu', 'al', 'zn', 'ni', 'pb', 'sn'],
    hintKey: 'lme_nonferrous_lead',
    narrative: 'LME有色海外lead',
  },
  black: {
    hintKey: 'black_policy_inventory',
    drivers: ['policy', 'port_inventory', 'blast_furnace'],
    narrative: '政策限产+铁矿港口库存+高炉开',
  },
  chemical: {
    hintKey: 'chemical_crude_cost',
    drivers: ['sc', 'fu', 'coal'],
    chain: 'crude→olefin/芳烃',
    narrative: '原油(SC/FU)成本',
  },
  agriculture: {
    hintKey: 'agri_crude_oil_chain',
    drivers: ['sc', 'weather', 'policy'],
    chain: 'sc→p/y/sr',
    narrative: '原油油脂·季节窗口',
  },
};

function isEnabled() {
  const v = process.env.PHILOSOPHY_FILTER_V2;
  return v === '1' || v === 'true';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function scoreToPhilosophyDir(score) {
  const s = Number(score);
  if (Number.isNaN(s)) return 0;
  if (s >= PHILOSOPHY_DIR_THRESHOLD) return 1;
  if (s <= -PHILOSOPHY_DIR_THRESHOLD) return -1;
  return 0;
}

function dirToLabel(d) {
  if (d === 1) return 'bullish';
  if (d === -1) return 'bearish';
  return 'neutral';
}

function loadDayNewsRows(asOfDate) {
  const { byDate } = newsTagged.loadNewsTagged();
  return byDate.get(normDate(asOfDate)) || [];
}

/**
 * Broad policy day 'news-tagged policy tier + domestic industrial policy labels.
 */
function detectPolicyDay(asOfDate, dayRows = null) {
  const rows = dayRows || loadDayNewsRows(asOfDate);
  if (!rows.length) return { policyDay: false, hits: [] };

  const hits = [];
  for (const row of rows) {
    const tier = String(row.source_tier || '').toLowerCase();
    const text = `${row.title || ''} ${row.notes || ''} ${row.event_id || ''}`;
    const policyTypes = detectPolicyTypes(text);
    const notesPolicy = /eventType\s*=\s*policy/i.test(text);
    const domestic =
      DOMESTIC_POLICY_RE.test(text) ||
      policyTypes.some((t) => ['industry', 'regulation', 'environmental', 'trade', 'reserve'].includes(t));

    if (tier === 'policy' || notesPolicy || domestic) {
      hits.push({ title: (row.title || '').slice(0, 60), tier, policyTypes });
    }
  }
  return { policyDay: hits.length > 0, hits };
}

function rowRelevantToInstrument(row, instrumentId, sector, profile) {
  const normId = String(instrumentId || '').toLowerCase();
  const tags = String(row.commodity_tags || '')
    .split(/[;|,]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tags.includes(normId)) return true;
  if (tags.includes(String(sector || '').toLowerCase())) return true;
  const keywords = profile?.newsAliases || [];
  const text = `${row.title || ''} ${row.notes || ''}`.toLowerCase();
  return keywords.some((kw) => {
    const k = String(kw).toLowerCase().trim();
    return k.length >= 2 && text.includes(k);
  });
}

function isInstrumentEventNewsRow(row) {
  const tier = String(row.source_tier || '').toLowerCase();
  if (EVENT_SOURCE_TIERS.has(tier)) return true;
  const text = `${row.title || ''} ${row.notes || ''}`;
  if (SUPPLY_EVENT_RE.test(text)) return true;
  return (
    philosophy.classifyNewsArchetype(row.title, row.notes, row.event_id) ===
    philosophy.NEWS_ARCHETYPES.shock_event
  );
}

/**
 * Event day 'instrument-scoped geo/supply/shock news OR regime=event for this id/date.
 * Not every day with generic news hits.
 */
function detectEventDay(ctx = {}) {
  const { asOfDate, marketRegime, dayRows = null, instrumentId, sector, profile } = ctx;
  const rows = dayRows || loadDayNewsRows(asOfDate);
  const reasons = [];

  if (marketRegime === 'event') reasons.push('regime_event');

  for (const row of rows) {
    if (instrumentId && !rowRelevantToInstrument(row, instrumentId, sector, profile)) continue;
    if (!isInstrumentEventNewsRow(row)) continue;
    const tier = String(row.source_tier || '').toLowerCase();
    if (EVENT_SOURCE_TIERS.has(tier)) {
      reasons.push(`news_${tier}`);
    } else if (SUPPLY_EVENT_RE.test(`${row.title || ''} ${row.notes || ''}`)) {
      reasons.push('news_supply');
    } else {
      reasons.push('news_shock_event');
    }
    break;
  }

  return { eventDay: reasons.length > 0, reasons };
}

function resolveDeliveryMonth(asOfDate, sector, instrumentId, profile = null) {
  return deliveryCalendar.resolveDeliveryMonth(asOfDate, sector, instrumentId, profile);
}

/**
 * M-1 full ramp 'delivery month MAX weight; main contract limited outside window.
 * Policy days force scale 0 (warehouse factor masked downstream).
 */
function computeWarehouseWeightScale(asOfDate, deliveryMonth, policyDay) {
  if (policyDay) return 0;

  const asOf = normDate(asOfDate);
  const deliveryStart = `${deliveryMonth}-01`;
  const dDelivery = new Date(`${deliveryStart}T12:00:00Z`);
  const mMinus1 = new Date(dDelivery);
  mMinus1.setUTCMonth(mMinus1.getUTCMonth() - 1);
  const mMinus1Start = `${mMinus1.getUTCFullYear()}-${String(mMinus1.getUTCMonth() + 1).padStart(2, '0')}-01`;

  if (asOf < mMinus1Start) return MAIN_CONTRACT_BASE_WEIGHT;
  if (asOf >= deliveryStart) return 1;

  const m1End = new Date(dDelivery);
  m1End.setUTCDate(0);
  const t0 = new Date(`${mMinus1Start}T12:00:00Z`).getTime();
  const t1 = m1End.getTime();
  const t = new Date(`${asOf}T12:00:00Z`).getTime();
  const frac = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 1;
  return +(MAIN_CONTRACT_BASE_WEIGHT + (1 - MAIN_CONTRACT_BASE_WEIGHT) * frac).toFixed(4);
}

function warehouseMaxInDeliveryWindow(instrumentId, deliveryMonth) {
  const rows = loadWarehouseRows(instrumentId);
  if (!rows?.length) return null;
  const start = `${deliveryMonth}-01`;
  const endDate = new Date(`${start}T12:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  const end = endDate.toISOString().slice(0, 10);
  let maxVal = null;
  for (const r of rows) {
    const d = normDate(r.date);
    if (d < start || d > end) continue;
    const v = r.warehouse_receipt != null ? Number(r.warehouse_receipt) : null;
    if (v != null && (maxVal == null || v > maxVal)) maxVal = v;
  }
  return maxVal;
}

function resolveLookbackConfig() {
  const lookbackN = Math.max(
    1,
    parseInt(process.env.PHILOSOPHY_DIVERGENCE_LOOKBACK_N || String(DEFAULT_LOOKBACK_N), 10) ||
      DEFAULT_LOOKBACK_N,
  );
  const threshold =
    parseInt(process.env.PHILOSOPHY_DIVERGENCE_THRESHOLD || '', 10) ||
    DEFAULT_DIVERGENCE_THRESHOLD;
  return { lookbackN, threshold: Math.min(threshold, lookbackN) };
}

function countPhilosophyDivergence(bars, barIndex, philosophyDir, lookbackN) {
  if (!bars?.length || philosophyDir === 0 || barIndex < 1) return 0;
  let count = 0;
  const start = Math.max(1, barIndex - lookbackN + 1);
  for (let i = start; i <= barIndex; i += 1) {
    const cur = Number(bars[i]?.close);
    const prev = Number(bars[i - 1]?.close);
    if (!cur || !prev) continue;
    const actualDir = cur > prev ? 1 : cur < prev ? -1 : 0;
    if (actualDir !== 0 && actualDir !== philosophyDir) count += 1;
  }
  return count;
}

function derivePolicyDirectionHint(phil, fallbackDir) {
  const macroPolicy = phil?.factorBreakdown?.macroPolicy;
  const macroChina = phil?.factorBreakdown?.macroChina;
  const score = macroPolicy ?? macroChina;
  if (score == null) return fallbackDir;
  if (score > 0.05) return 'bullish';
  if (score < -0.05) return 'bearish';
  return fallbackDir;
}

/** Policy-day playbook 'macro/policy narrative takes precedence; warehouse masked. */
function applyPolicyPlaybook(filterDraft, ctx) {
  if (!filterDraft.policyDay) return filterDraft;
  const policyDirectionHint = derivePolicyDirectionHint(ctx.phil, filterDraft.philosophyDirection);
  const summary = [
    filterDraft.philosophySummary,
    '政策叙事优先',
    policyDirectionHint !== 'neutral' ? `政策倾向${policyDirectionHint}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    ...filterDraft,
    warehouseWeightScale: 0,
    policyPlaybook: {
      applied: true,
      precedence: 'macro_policy_narrative',
      warehouseMasked: true,
      directionHint: policyDirectionHint,
      policyHits: filterDraft.policyHits,
    },
    philosophySummary: summary,
  };
}

/** Sector fundamentals hooks 'lightweight direction hints / cross-market metadata. */
function applySectorPlaybook(filterDraft, ctx) {
  const sector = ctx.sector || ctx.profile?.sector;
  const spec = SECTOR_PLAYBOOK[sector];
  if (!spec) return filterDraft;

  const directionHint =
    filterDraft.effectivePhilosophyDir !== 0 ? filterDraft.philosophyDirection : null;

  return {
    ...filterDraft,
    sectorPlaybook: {
      sector,
      ...spec,
      directionHint,
      applied: true,
      note: `${spec.hintKey}_stub`,
    },
  };
}

/** Event playbook 'separate rule path from policy/routine; shock phase extension hooks. */
function applyEventPlaybook(filterDraft, ctx) {
  if (!filterDraft.eventDay || filterDraft.policyDay) return filterDraft;

  const phase = ctx.phil?.newsArchetype?.shockPhase;
  const shockHit = ctx.phil?.newsArchetype?.shockHit;
  const rules = [];

  if (filterDraft.eventReasons?.includes('regime_event')) rules.push('regime_event_path');
  if (phase?.phase === 'spike') rules.push('shock_spike_window');
  if (phase?.phase === 'pullback') rules.push('post_shock_pullback_caution');
  if (phase?.phase === 'bounce') rules.push('post_shock_bounce_watch');

  let directionHint = filterDraft.philosophyDirection;
  if (phase?.pullbackWarning && phase?.phase === 'pullback') {
    directionHint = 'neutral';
    rules.push('pullback_neutral_gate');
  }

  const summary = [
    filterDraft.philosophySummary,
    phase?.phaseLabel || '事件规则路径',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    ...filterDraft,
    eventPlaybook: {
      applied: true,
      phase: phase?.phase || null,
      phaseLabel: phase?.phaseLabel || null,
      daysSinceEvent: phase?.daysSinceEvent ?? null,
      shockTitle: shockHit?.title?.slice(0, 48) || null,
      rules,
      directionHint,
      separateFromPolicy: true,
      eventReasons: filterDraft.eventReasons,
    },
    philosophySummary: summary,
  };
}

function resolvePricedInAlpha() {
  const v = parseFloat(process.env.PHILOSOPHY_PRICED_IN_ALPHA || '');
  return Number.isFinite(v) && v > 0 ? v : PRICED_IN_ALPHA_DEFAULT;
}

function resolvePricedInFullThreshold() {
  const v = parseFloat(process.env.PHILOSOPHY_PRICED_IN_FULL_THRESHOLD || '');
  return Number.isFinite(v) && v > 0 ? v : PRICED_IN_FULL_THRESHOLD;
}

function signDir(n) {
  if (n == null || Number.isNaN(Number(n)) || Number(n) === 0) return 0;
  return Number(n) > 0 ? 1 : -1;
}

function avgVolumeBaseline(bars, barIndex, window = VOLUME_BASELINE_DAYS) {
  if (!bars?.length || barIndex < 1) return null;
  const start = Math.max(0, barIndex - window);
  let sum = 0;
  let n = 0;
  for (let i = start; i < barIndex; i += 1) {
    const v = bars[i]?.volume;
    if (v != null && !Number.isNaN(v) && v > 0) {
      sum += Number(v);
      n += 1;
    }
  }
  return n ? sum / n : null;
}

function computePriceCrossComponent(ctx, philosophyDir) {
  if (!philosophyDir) return 0;

  const { asOfDate, instrumentId, sector, bars, barIndex } = ctx;
  const normId = String(instrumentId || '').toLowerCase();
  let score = 0.08;

  const domesticRet5d =
    bars != null && barIndex != null
      ? philosophy.computePreRunReturn(bars, normDate(asOfDate))
      : null;
  const domesticAligned =
    domesticRet5d != null &&
    signDir(domesticRet5d) === philosophyDir &&
    Math.abs(domesticRet5d) >= 1.5;

  let crossAligned = false;
  let crossRetPct = null;

  if (sector === 'precious' && (normId === 'au' || normId === 'ag')) {
    const cross = crossMarketPrecious.inferPointChangeFromClose(normDate(asOfDate), normId);
    if (!cross?.gated && cross.shfePrevClose) {
      crossRetPct = (cross.predictedDelta / cross.shfePrevClose) * 100;
      crossAligned = signDir(crossRetPct) === philosophyDir && Math.abs(crossRetPct) >= 0.15;
    }
    const intlBars =
      normId === 'ag'
        ? crossMarketPrecious.ensureIntlSeriesLoaded()?.comexSilver
        : crossMarketPrecious.ensureIntlSeriesLoaded()?.comexGold;
    if (intlBars?.length >= 6) {
      const d = normDate(asOfDate);
      let endIdx = -1;
      for (let i = intlBars.length - 1; i >= 0; i -= 1) {
        if (intlBars[i].date <= d) {
          endIdx = i;
          break;
        }
      }
      if (endIdx >= 5) {
        const end = intlBars[endIdx]?.close;
        const start = intlBars[endIdx - 5]?.close;
        if (end && start) {
          const intl5d = ((end - start) / start) * 100;
          if (signDir(intl5d) === philosophyDir && Math.abs(intl5d) >= 1) crossAligned = true;
        }
      }
    }
  } else if (sector === 'metals' && normId === 'cu') {
    const cuMom = getCuMomentum5dAtDate(asOfDate);
    crossRetPct = cuMom;
    crossAligned = cuMom != null && signDir(cuMom) === philosophyDir && Math.abs(cuMom) >= 1.5;
  }

  if (domesticAligned && crossAligned) {
    score = 0.82 + clamp(Math.abs(domesticRet5d) / 12, 0, 0.18);
  } else if (domesticAligned) {
    score = 0.52 + clamp(Math.abs(domesticRet5d) / 10, 0, 0.28);
  } else if (crossAligned) {
    score = 0.42 + clamp(Math.abs(crossRetPct || 0) / 8, 0, 0.25);
  } else if (domesticRet5d != null && signDir(domesticRet5d) === philosophyDir) {
    score = 0.18 + clamp(Math.abs(domesticRet5d) / 12, 0, 0.22);
  }

  return +clamp(score, 0, 1).toFixed(4);
}

function computeVolumeOiComponent(ctx, philosophyDir) {
  if (!philosophyDir || ctx.bars == null || ctx.barIndex == null) return 0;

  const { bars, barIndex } = ctx;
  const beh = computeOiBehaviorAtBar(bars, barIndex);
  const vol = bars[barIndex]?.volume;
  const avgVol = avgVolumeBaseline(bars, barIndex);
  const volRatio = avgVol && vol ? vol / avgVol : null;
  const oiAligned = signDir(beh.oi_change) === philosophyDir && beh.oi_change != null;

  let score = 0.1;
  if (volRatio != null && volRatio >= 1.5 && oiAligned) {
    score = 0.72 + clamp((volRatio - 1.5) / 2.5, 0, 0.28);
  } else if (volRatio != null && volRatio >= 1.2 && oiAligned) {
    score = 0.52;
  } else if (oiAligned) {
    score = 0.38;
  } else if (volRatio != null && volRatio >= 1.5) {
    score = 0.32;
  } else if (volRatio != null && volRatio >= 1.15) {
    score = 0.22;
  }

  return +clamp(score, 0, 1).toFixed(4);
}

function computeNewsRepeatComponent(phil) {
  const fit = phil?.philosophyFit;
  if (!fit?.ok) return 0.12;

  let score = 0.12;
  const stim = fit.stimulus;
  const priorOcc = stim?.priorOccurrences ?? 0;
  const path = fit.path || stim?.path;
  const macroRepeat = path === philosophy.EVENT_PATHS.macroRepeat || path === 'macro_repeat';

  if (macroRepeat) {
    if (priorOcc >= 3) score += 0.38;
    else if (priorOcc >= 2) score += 0.28;
    else if (priorOcc >= 1) score += 0.18;
  }
  if (fit.narrativeExtend) score += 0.24;
  if (fit.pricedIn?.pricedInLikely) score += 0.28;
  if (stim?.decay != null && stim.decay < 0.9) {
    score += clamp((0.9 - stim.decay) * 1.2, 0, 0.22);
  }
  if (fit.compositeMultiplier != null && fit.compositeMultiplier < 1) {
    score += clamp((1 - fit.compositeMultiplier) * 0.45, 0, 0.2);
  }

  return +clamp(score, 0, 1).toFixed(4);
}

function resolvePricedInMode(score) {
  const fullTh = resolvePricedInFullThreshold();
  if (score >= fullTh) return 'full';
  if (score >= PRICED_IN_PARTIAL_THRESHOLD) return 'partial';
  return 'none';
}

function resolvePricedInDirectionFlip(phil, mode, instrumentId) {
  if (mode !== 'full') return false;
  const fit = phil?.philosophyFit?.pricedIn;
  if (fit?.directionFlip === 'bearish') {
    const normId = String(instrumentId || '').toLowerCase();
    if (normId === 'au' || normId === 'ag') {
      try {
        const era = require('./commodity-outlook-event-calendar').classifyEpoch(
          phil?.asOfDate || new Date().toISOString().slice(0, 10),
        );
        if (era === '2025_2026') return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  return fit?.directionFlip === 'neutral';
}

function assessPricedInSynthesis(ctx, philosophyDir) {
  const priceCross = computePriceCrossComponent(ctx, philosophyDir);
  const volumeOi = computeVolumeOiComponent(ctx, philosophyDir);
  const newsRepeat = computeNewsRepeatComponent(ctx.phil);

  const score = +clamp(
    PRICED_IN_WEIGHTS.priceCross * priceCross +
      PRICED_IN_WEIGHTS.volumeOi * volumeOi +
      PRICED_IN_WEIGHTS.newsRepeat * newsRepeat,
    0,
    1,
  ).toFixed(4);

  const mode = resolvePricedInMode(score);
  const directionFlip = resolvePricedInDirectionFlip(ctx.phil, mode, ctx.instrumentId);

  return {
    score,
    mode,
    directionFlip,
    alpha: resolvePricedInAlpha(),
    components: { priceCross, volumeOi, newsRepeat },
  };
}

function applyPricedInToConfidence(filterDraft, pricedInObj, phil) {
  const compositeScore = Number(phil?.compositeScore ?? 0);
  const pi = pricedInObj?.score ?? 0;
  const alpha = pricedInObj?.alpha ?? resolvePricedInAlpha();
  const damp = Math.pow(1 - pi, alpha);
  const baseConf = clamp(Math.abs(compositeScore) / PHILOSOPHY_CONF_BASE_SCALE, 0, 1);
  const philosophyConfidence = +(baseConf * damp).toFixed(4);
  const adjustedScore = compositeScore * damp;
  const effectivePhilosophyDir = scoreToPhilosophyDir(adjustedScore);

  return {
    ...filterDraft,
    philosophyConfidence,
    effectivePhilosophyDir,
    philosophyDirection: dirToLabel(effectivePhilosophyDir),
    pricedInDamp: +damp.toFixed(4),
  };
}

function applyPlaybookGating(filterDraft, ctx = {}) {
  let out = { ...filterDraft };
  const minConf = parseFloat(process.env.PHILOSOPHY_MIN_CONFIDENCE || '0.12');

  if (out.eventPlaybook?.rules?.includes('pullback_neutral_gate')) {
    out.filterPass = false;
    out.neutralReason = 'event_pullback';
    if (out.eventPlaybook.directionHint === 'neutral') {
      out.effectivePhilosophyDir = 0;
      out.philosophyDirection = 'neutral';
    }
  }

  if (out.policyPlaybook?.applied && out.policyPlaybook.directionHint) {
    const hint = out.policyPlaybook.directionHint;
    const hintDir = hint === 'bullish' ? 1 : hint === 'bearish' ? -1 : 0;
    if (hintDir !== 0 && out.effectivePhilosophyDir !== 0 && hintDir !== out.effectivePhilosophyDir) {
      out.philosophyConfidence = +((out.philosophyConfidence ?? 0) * 0.75).toFixed(4);
      if ((out.philosophyConfidence ?? 0) < minConf) {
        out.filterPass = false;
        out.neutralReason = out.neutralReason || 'policy_day_neutral';
      }
    }
  }

  if (out.sectorPlaybook?.applied && out.pricedIn?.components?.priceCross >= 0.75) {
    const crossConflict =
      out.sectorPlaybook.crossMarketLead &&
      out.effectivePhilosophyDir !== 0 &&
      out.pricedIn.components.priceCross >= 0.75 &&
      out.pricedIn.mode !== 'none';
    if (crossConflict && (out.philosophyConfidence ?? 0) < 0.25) {
      out.filterPass = false;
      out.neutralReason = out.neutralReason || 'cross_market_conflict';
    }
  }

  if (out.pricedIn?.mode === 'full' && out.effectivePhilosophyDir !== 0) {
    out.filterPass = false;
    out.neutralReason = 'priced_in_full';
  }

  if ((out.philosophyConfidence ?? 0) < minConf && out.filterPass && out.effectivePhilosophyDir !== 0) {
    out.filterPass = false;
    out.neutralReason = out.neutralReason || 'low_philosophy_confidence';
  }

  if (out.effectivePhilosophyDir === 0 && out.filterPass) {
    out.filterPass = false;
    out.neutralReason = out.neutralReason || 'philosophy_neutral';
  }

  return out;
}

/**
 * @param {object} ctx
 * @param {string} ctx.instrumentId
 * @param {string} ctx.sector
 * @param {string} ctx.asOfDate
 * @param {object} ctx.phil 'evaluateInstrumentPhilosophy output
 * @param {string} [ctx.marketRegime]
 * @param {object} [ctx.newsImpact]
 * @param {Array} [ctx.bars]
 * @param {number} [ctx.barIndex]
 */
function evaluatePhilosophyDirectionFilter(ctx = {}) {
  const {
    instrumentId,
    sector,
    asOfDate,
    phil,
    marketRegime,
    bars,
    barIndex,
    profile: ctxProfile,
  } = ctx;

  const dayRows = loadDayNewsRows(asOfDate);
  const { policyDay, hits: policyHits } = detectPolicyDay(asOfDate, dayRows);
  const { eventDay, reasons: eventReasons } = detectEventDay({
    asOfDate,
    marketRegime,
    dayRows,
    instrumentId,
    sector,
    profile: ctxProfile,
  });

  const deliveryMonth = resolveDeliveryMonth(asOfDate, sector, instrumentId, ctxProfile);
  const warehouseWeightScale = computeWarehouseWeightScale(asOfDate, deliveryMonth, policyDay);
  const warehouseReferenceMax = warehouseMaxInDeliveryWindow(instrumentId, deliveryMonth);

  const rawPhilosophyDir = scoreToPhilosophyDir(phil?.compositeScore);
  const { lookbackN, threshold } = resolveLookbackConfig();
  const divergenceCount =
    bars != null && barIndex != null
      ? countPhilosophyDivergence(bars, barIndex, rawPhilosophyDir, lookbackN)
      : 0;

  let filterPass = true;
  let neutralReason = null;

  if (rawPhilosophyDir === 0) {
    filterPass = false;
    neutralReason = 'philosophy_neutral';
  } else if (divergenceCount >= threshold) {
    filterPass = false;
    neutralReason = 'philosophy_divergence';
  }

  const philosophySummary = [
    phil?.logicSummary ? phil.logicSummary.slice(0, 120) : null,
    policyDay ? '政策' : null,
    eventDay ? '事件' : null,
    warehouseWeightScale === 0 ? '仓单关闭' : `仓单权重${warehouseWeightScale}`,
    rawPhilosophyDir === 1 ? '哲学偏多' : rawPhilosophyDir === -1 ? '哲学偏空' : '哲学中',
  ]
    .filter(Boolean)
    .join(' · ');

  let out = {
    version: FILTER_VERSION,
    filterPass,
    neutralReason,
    philosophySummary,
    policyDay,
    eventDay,
    warehouseWeightScale,
    effectivePhilosophyDir: rawPhilosophyDir,
    philosophyDirection: dirToLabel(rawPhilosophyDir),
    deliveryMonth,
    warehouseReferenceMax,
    policyHits: policyHits.slice(0, 3),
    eventReasons,
    randomWalkFilter: {
      lookbackN,
      divergenceCount,
      threshold,
      triggered: divergenceCount >= threshold,
    },
    dayType: policyDay ? 'policy' : eventDay ? 'event' : 'routine',
  };

  out = applySectorPlaybook(out, ctx);
  if (out.policyDay) {
    out = applyPolicyPlaybook(out, ctx);
  } else if (out.eventDay) {
    out = applyEventPlaybook(out, ctx);
  }

  const pricedInObj = assessPricedInSynthesis(ctx, rawPhilosophyDir);
  out.pricedIn = pricedInObj;
  out = applyPricedInToConfidence(out, pricedInObj, phil);
  out = applyPlaybookGating(out, ctx);

  const piTag =
    pricedInObj.mode !== 'none'
      ? `pricedIn ${pricedInObj.mode} π=${pricedInObj.score}`
      : `π=${pricedInObj.score}`;
  out.philosophySummary = [out.philosophySummary, piTag].filter(Boolean).join(' · ');

  return out;
}

/** Scale warehouse logistic feature for experiment path. */
function scaleWarehouseFeature(value, filterOut) {
  if (!filterOut) return value;
  const scale = filterOut.warehouseWeightScale;
  if (scale == null) return value;
  if (scale === 0) return 0;
  const n = Number(value ?? 0);
  return +(n * scale).toFixed(6);
}

/** Merge v2 filter fields into direction-prediction-archive record (backward compatible). */
function attachFilterToArchiveRecord(record, filterOut) {
  if (!filterOut) return record;
  return {
    ...record,
    schemaVersion: Math.max(record.schemaVersion || 1, 2),
    filterPass: filterOut.filterPass,
    neutralReason: filterOut.filterPass ? null : filterOut.neutralReason,
    philosophyDirection: filterOut.philosophyDirection,
    philosophySummary: filterOut.philosophySummary,
    dayType: filterOut.dayType,
    pricedIn:
      filterOut.pricedIn != null
        ? typeof filterOut.pricedIn === 'object'
          ? filterOut.pricedIn
          : { score: filterOut.pricedIn, mode: 'stub' }
        : record.pricedIn,
    philosophyConfidence: filterOut.philosophyConfidence ?? record.philosophyConfidence,
    warehouseContext: {
      deliveryMonth: filterOut.deliveryMonth,
      weight: filterOut.warehouseWeightScale,
      referenceMax: filterOut.warehouseReferenceMax,
      policyDayMasked: filterOut.policyDay === true,
    },
    randomWalkFilter: filterOut.randomWalkFilter,
    sectorPlaybook: filterOut.sectorPlaybook,
    policyPlaybook: filterOut.policyPlaybook,
    eventPlaybook: filterOut.eventPlaybook,
    philosophyFilter: filterOut,
  };
}

module.exports = {
  FANCHENG_PHILOSOPHY,
  FILTER_VERSION,
  DEFAULT_LOOKBACK_N,
  DEFAULT_DIVERGENCE_THRESHOLD,
  MAIN_CONTRACT_BASE_WEIGHT,
  SECTOR_PLAYBOOK,
  isEnabled,
  detectPolicyDay,
  detectEventDay,
  resolveDeliveryMonth,
  computeWarehouseWeightScale,
  warehouseMaxInDeliveryWindow,
  countPhilosophyDivergence,
  applyPolicyPlaybook,
  applySectorPlaybook,
  applyEventPlaybook,
  assessPricedInSynthesis,
  applyPricedInToConfidence,
  applyPlaybookGating,
  evaluatePhilosophyDirectionFilter,
  scaleWarehouseFeature,
  attachFilterToArchiveRecord,
  scoreToPhilosophyDir,
};
