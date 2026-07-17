/**
 * 交易所硬性政策追—保证'限仓 > 口头 rhetoric
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId, detectCommodityTags } = require('./policy-commodity-map');

const HARD_POLICY_VERSION = 'v1.44.0-discipline';
const HARD_NEWS_RE = /保证金|限仓|持仓限额|交易限额|涨跌停|扩板|提保|margin|position limit/i;

let cachedSeed = null;

function nowIso() {
  return new Date().toISOString();
}

function loadSeedEvents() {
  if (cachedSeed) return cachedSeed;
  const fp = path.join(__dirname, '..', 'data', 'exchange-hard-policy-seed.json');
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    cachedSeed = raw.events || [];
  } catch {
    cachedSeed = [];
  }
  return cachedSeed;
}

function scanNewsForHardPolicy(newsPool = []) {
  const items = Array.isArray(newsPool) ? newsPool : newsPool?.items || [];
  const hits = [];
  for (const item of items) {
    const text = `${item.title || ''} ${item.summary || ''}`;
    if (!HARD_NEWS_RE.test(text)) continue;
    const tags = detectCommodityTags(text);
    hits.push({
      id: `news-${item.id || item.publishedAt || hits.length}`,
      type: /限仓|position limit/i.test(text) ? 'position_limit' : 'margin_hike',
      title: (item.title || text).slice(0, 120),
      weight: 'hard',
      publishedAt: item.publishedAt || item.pubDate,
      linkedSymbols: tags.map((t) => normalizeCommodityId(t.id)).filter(Boolean),
      dataSource: 'news-scan',
    });
  }
  return hits;
}

function resolveNewsPool(context = {}) {
  const base = Array.isArray(context.newsPool) ? context.newsPool : context.newsPool?.items || [];
  try {
    const { getCachedExchangeNoticeBundle } = require('./exchange-notice-fetcher');
    const bundle = getCachedExchangeNoticeBundle();
    if (bundle?.items?.length) return [...base, ...bundle.items];
  } catch {
    // ignore
  }
  return base;
}

function eventsForSymbol(symbol, context = {}) {
  const sym = normalizeCommodityId(symbol);
  if (!sym) return [];
  const seed = loadSeedEvents();
  const newsHits = scanNewsForHardPolicy(resolveNewsPool(context));
  const all = [...seed, ...newsHits];
  return all.filter(
    (e) =>
      normalizeCommodityId(e.symbol) === sym ||
      (e.linkedSymbols || []).map(normalizeCommodityId).includes(sym)
  );
}

function hasHardPolicy(symbol, context = {}) {
  const events = eventsForSymbol(symbol, context);
  return events.length > 0;
}

function evaluateHardPolicy(symbol, context = {}) {
  const sym = normalizeCommodityId(symbol);
  const events = eventsForSymbol(sym, context);
  const asOf = nowIso();

  if (!events.length) {
    return {
      hasHard: false,
      events: [],
      watchLevelBoost: null,
      dataSource: 'exchange-hard-policy',
      method: 'seed+news-scan',
      version: HARD_POLICY_VERSION,
      asOf,
    };
  }

  return {
    hasHard: true,
    events: events.slice(0, 5),
    watchLevelBoost: 'W2',
    note: events[0]?.title || '交易所硬性政',
    dataSource: 'exchange-hard-policy',
    method: 'seed+news-scan',
    version: HARD_POLICY_VERSION,
    asOf,
  };
}

module.exports = {
  HARD_POLICY_VERSION,
  HARD_NEWS_RE,
  loadSeedEvents,
  scanNewsForHardPolicy,
  eventsForSymbol,
  hasHardPolicy,
  evaluateHardPolicy,
};
