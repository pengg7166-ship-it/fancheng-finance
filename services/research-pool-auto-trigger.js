/**
 * Policy/news/thesis/playbook/divergence 'research pool auto-add
 */
const thesisRegistry = require('./thesis-registry');
const { getGlobalNewsPoolSync } = require('./commodities-news');
const { computeDivergence, detectPlaybook } = require('./policy-playbook-engine');
const { addToPool, findRecentPoolEntry } = require('./research-pool');
const { normalizeCommodityId, detectCommodityTags } = require('./policy-commodity-map');
const { evaluateHardPolicy } = require('./exchange-hard-policy');

const { filterActiveThesesForDisplay, isThesisOnlyPoolTrigger } = require('./thesis-retirement');

const AUTO_TRIGGER_VERSION = 'v1.44.0-discipline';
const DEDUP_WINDOW_MS = 24 * 3600 * 1000;
const NEWS_LOOKBACK_MS = 72 * 3600 * 1000;
const THESIS_NEW_MS = 48 * 3600 * 1000;

const POLICY_NEWS_RE = /政策|调控|限产|收储|去产能|监管|regulation|policy|tariff|制裁/i;
const POLICY_THESIS_RE = /政策|产能|限产|调控|打压|收储|regulation|policy/i;

function nowIso() {
  return new Date().toISOString();
}

function isWithinMs(isoOrMs, windowMs) {
  if (!isoOrMs) return false;
  const ts = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= windowMs;
}

function normalizeNewsPool(pool) {
  if (!pool) return [];
  if (Array.isArray(pool)) return pool;
  return pool.items || [];
}

function tagNewsForCommodities(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  return detectCommodityTags(text).map((tag) => ({
    commodityId: tag.id,
    commodityName: tag.name,
  }));
}

function filterPolicyNews(newsPool) {
  return normalizeNewsPool(newsPool).filter((item) => {
    const text = `${item.title || ''} ${item.summary || ''} ${(item.tags || []).join(' ')}`;
    return POLICY_NEWS_RE.test(text) || item.intelType === 'policy' || item.category === 'policy';
  });
}

function policyNewsForSymbol(newsPool, symbol) {
  const sym = normalizeCommodityId(symbol);
  const policy = filterPolicyNews(newsPool);
  const out = [];
  for (const item of policy) {
    const tagged = tagNewsForCommodities(item);
    if (tagged.some((t) => normalizeCommodityId(t.commodityId) === sym)) out.push(item);
  }
  return out.slice(0, 5);
}

function hasPolicySignal(inst, policyNews = []) {
  const theses = inst?.macroSynthesis?.activeTheses || [];
  if (theses.some((t) => POLICY_THESIS_RE.test(t.claim || ''))) return true;
  return policyNews.length > 0;
}

function violentVolMove(inst) {
  const sv = inst?.smoothedVol;
  return Boolean(sv?.volRising && sv?.percentile != null && sv.percentile >= 70);
}

function tryAutoAdd(symbol, meta, options = {}) {
  const sym = normalizeCommodityId(symbol);
  if (!sym) return null;
  const trigger = meta.trigger || meta.reason || 'auto-policy-trigger';
  if (!options.force && findRecentPoolEntry(sym, trigger, DEDUP_WINDOW_MS)) {
    return { skipped: true, symbol: sym, trigger };
  }
  const entry = addToPool(sym, {
    ...meta,
    trigger,
    source: meta.source || 'auto-policy-trigger',
    method: 'evaluateAutoPoolTriggers',
    addedAt: meta.addedAt || nowIso(),
  });
  return { skipped: false, symbol: sym, trigger, entry };
}

function scanThesisTriggers(theses, results, options) {
  const activeTheses = filterActiveThesesForDisplay(theses);
  for (const t of activeTheses) {
    if (t.status === 'archived') continue;
    const claim = t.claim || '';
    const tags = t.linkedTags || t.linkedThemes || [];
    const isPolicy =
      POLICY_THESIS_RE.test(claim) ||
      tags.some((tag) => /policy|regulation|产能|macro/.test(String(tag)));
    const isOvershoot = t.status === 'overshoot';
    const isNew =
      t.status === 'active' &&
      isWithinMs(t.createdAt || t.fetchedAt, THESIS_NEW_MS) &&
      !t.seed;

    if (!isPolicy && !isOvershoot && !isNew) continue;

    let symbols = (t.linkedSymbols || []).map(normalizeCommodityId).filter(Boolean);
    if (!symbols.length) {
      symbols = detectCommodityTags(claim).map((tag) => normalizeCommodityId(tag.id)).filter(Boolean);
    }
    if (!symbols.length) continue;

    const trigger = isOvershoot ? 'thesis-overshoot' : isPolicy ? 'policy-thesis' : 'thesis-new';
    const watchLevel = isOvershoot ? 'W1' : isPolicy ? 'W1' : 'W0';
    for (const sym of symbols) {
      results.scanned += 1;
      const r = tryAutoAdd(
        sym,
        {
          watchLevel,
          trigger,
          note: claim.slice(0, 120),
          regime: null,
        },
        options
      );
      if (r?.skipped) results.skipped.push(r);
      else if (r?.entry) results.added.push(r);
    }
  }
}

function scanNewsTriggers(newsPool, results, options) {
  const policyNews = filterPolicyNews(newsPool);
  for (const item of policyNews) {
    const pub = item.publishedAt || item.pubDate || item.fetchedAt;
    if (pub && !isWithinMs(pub, NEWS_LOOKBACK_MS)) continue;

    const tagged = tagNewsForCommodities(item);
    const symbols = tagged.length
      ? tagged.map((t) => normalizeCommodityId(t.commodityId))
      : detectCommodityTags(`${item.title || ''} ${item.summary || ''}`).map((t) => normalizeCommodityId(t.id));

    for (const sym of [...new Set(symbols.filter(Boolean))]) {
      results.scanned += 1;
      const r = tryAutoAdd(
        sym,
        {
          watchLevel: 'W1',
          trigger: 'policy-news',
          note: (item.title || item.summary || '').slice(0, 120),
        },
        options
      );
      if (r?.skipped) results.skipped.push(r);
      else if (r?.entry) results.added.push(r);
    }
  }
}

function scanInstrumentTriggers(instruments, context, results, options) {
  const newsPool = context.newsPool || getGlobalNewsPoolSync?.() || [];
  const holdings = (context.holdings || []).map(normalizeCommodityId);

  for (const inst of instruments) {
    if (!inst?.id) continue;
    const sym = normalizeCommodityId(inst.id);
    const tg = inst.tradingGuidance;
    const policyNews = context.policyNews?.length
      ? context.policyNews
      : policyNewsForSymbol(newsPool, sym);
    const divContext = {
      tradingGuidance: tg,
      activeTheses: inst.macroSynthesis?.activeTheses,
      policyNews,
    };
    const div = context.precomputedDivergence?.[sym] || computeDivergence(inst, divContext);
    const pb = detectPlaybook({ inst, tradingGuidance: tg, divergence: div, policyNews });

    if (pb?.id && (/^PB-(I|LH|FG|BLACK)-/.test(pb.id)) && pb.stage && /^T[1-5]$/.test(pb.stage)) {
      results.scanned += 1;
      const r = tryAutoAdd(
        sym,
        {
          watchLevel: pb.stage === 'T3' || pb.stage === 'T4' ? 'W2' : 'W1',
          trigger: 'playbook-detect',
          playbookId: pb.id,
          note: `${pb.id} · ${pb.stage} · ${(pb.narrativeZh || pb.title || '').slice(0, 60)}`,
        },
        options
      );
      if (r?.skipped) results.skipped.push(r);
      else if (r?.entry) results.added.push(r);
    }

    const hardPol = evaluateHardPolicy(sym, { newsPool });
    if (hardPol?.hasHard) {
      results.scanned += 1;
      const r = tryAutoAdd(
        sym,
        {
          watchLevel: 'W2',
          trigger: 'hard-policy',
          note: hardPol.note || '交易所硬性政',
          eventDrivenUnverified: true,
        },
        options
      );
      if (r?.skipped) results.skipped.push(r);
      else if (r?.entry) results.added.push(r);
    }

    const gap = inst.integratedSpec?.expectationGap;
    if (gap?.overshootBounceEligible) {
      results.scanned += 1;
      const r = tryAutoAdd(
        sym,
        {
          watchLevel: 'O2',
          trigger: 'overshoot-bounce-o2',
          note: 'O2 二次反弹·快钱 · 不恋',
          overshootBounce: true,
        },
        options
      );
      if (r?.skipped) results.skipped.push(r);
      else if (r?.entry) results.added.push(r);
    }

    if (div.level === 'D2' || div.level === 'D3') {
      results.scanned += 1;
      const held = holdings.includes(sym);
      const volSpike = violentVolMove(inst);
      const watchLevel = div.level === 'D3' || (held && div.holderAlert) || volSpike ? 'W2' : 'W1';
      const r = tryAutoAdd(
        sym,
        {
          watchLevel,
          trigger: 'policy-divergence',
          divergenceLevel: div.level,
          note: div.evidence?.slice(0, 2).join(' · ') || div.label,
          regime: inst.integratedSpec?.regime?.regime || null,
          eventDrivenUnverified: watchLevel === 'W2',
        },
        options
      );
      if (r?.skipped) results.skipped.push(r);
      else if (r?.entry) results.added.push(r);
    }

    if (hasPolicySignal(inst, policyNews) && violentVolMove(inst)) {
      results.scanned += 1;
      const r = tryAutoAdd(
        sym,
        {
          watchLevel: 'W2',
          trigger: 'policy-vol-spike',
          note: '政策/命题信号 + 剧烈波动',
          eventDrivenUnverified: true,
        },
        options
      );
      if (r?.skipped) results.skipped.push(r);
      else if (r?.entry) results.added.push(r);
    }
  }
}

/**
 * Scan policy/news/thesis/playbook/divergence signals and auto-add to research pool.
 * @param {object} context '{ instruments, holdings, theses, newsPool, policyNews, force }
 */
function evaluateAutoPoolTriggers(context = {}) {
  const results = { version: AUTO_TRIGGER_VERSION, added: [], skipped: [], scanned: 0, asOf: nowIso() };
  const options = { force: context.force === true };

  try {
    thesisRegistry.ensureSeedData?.();
  } catch {
    // non-fatal
  }

  const theses = filterActiveThesesForDisplay(
    context.theses || thesisRegistry.getActiveTheses?.() || []
  );
  const newsPool = context.newsPool || getGlobalNewsPoolSync?.() || [];

  scanThesisTriggers(theses, results, options);
  scanNewsTriggers(newsPool, results, options);

  const instruments = context.instruments || [];
  if (instruments.length) {
    scanInstrumentTriggers(instruments, { ...context, newsPool }, results, options);
  }

  return results;
}

module.exports = {
  AUTO_TRIGGER_VERSION,
  DEDUP_WINDOW_MS,
  evaluateAutoPoolTriggers,
  filterPolicyNews,
  policyNewsForSymbol,
};
