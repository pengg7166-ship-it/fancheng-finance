const { getCommodityPolicyTags, detectCommodityTags, detectImpactDirection, normalizeCommodityId } = require('./policy-commodity-map');
const { getNewsKeywords, scoreNewsItem } = require('./commodities-news');
const { getCommodityMeta } = require('./commodities-catalog');

const EXCHANGE_LABELS = {
  shfe: '上期所',
  dce: '大商所',
  zce: '郑商所',
  ine: '上期能源',
  gfex: '广期所',
};

function dedupeByLink(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = (item.link || item.id || item.title || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sortByDateDesc(a, b) {
  return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
}

function tagNewsItemForCommodities(newsItem, poolType) {
  const text = `${newsItem.title || ''} ${newsItem.summary || ''}`;
  const tags = detectCommodityTags(text);
  if (!tags.length) return [];

  return tags.map((tag) => {
    const meta = getCommodityMeta(tag.id);
    const keywords = meta ? getNewsKeywords(meta) : [tag.name];
    const relevance = scoreNewsItem(newsItem, keywords, meta);
    return {
      commodityId: tag.id,
      commodityName: tag.name,
      relevance,
      item: {
        ...newsItem,
        intelType: poolType,
        relevance,
      },
    };
  });
}

function initCommodityBuckets() {
  const buckets = new Map();
  for (const tag of getCommodityPolicyTags()) {
    const meta = getCommodityMeta(tag.id);
    buckets.set(normalizeCommodityId(tag.id), {
      id: tag.id,
      name: tag.name,
      exchangeId: tag.exchangeId || meta?.exchangeId || '',
      exchange: tag.exchange || meta?.exchange || EXCHANGE_LABELS[tag.exchangeId] || '',
      policies: [],
      cnNews: [],
      globalNews: [],
      geoNews: [],
    });
  }
  return buckets;
}

function tagGeoItemForCommodities(geoItem) {
  const tags = geoItem.commodities?.length
    ? geoItem.commodities
    : detectCommodityTags(`${geoItem.title || ''} ${geoItem.summary || ''} ${geoItem.commodityImpactSummary || geoItem.analysis?.impactLine || ''}`);
  if (!tags.length) return [];

  const text = `${geoItem.title || ''} ${geoItem.summary || ''}`;
  const relevance =
    (geoItem.stars || 1) +
    (geoItem.commodities?.length ? 2 : 0) +
    (geoItem.analysis ? 2 : 0);

  return tags.map((tag) => ({
    commodityId: tag.id,
    commodityName: tag.name,
    relevance,
    item: {
      ...geoItem,
      intelType: 'geo',
      relevance,
      direction: geoItem.direction || detectImpactDirection(text),
      impactSummary: geoItem.commodityImpactSummary || geoItem.analysis?.impactLine || '',
    },
  }));
}

function buildCommodityIntelligence(policyItems, fastPool = [], globalPool = [], geoItems = []) {
  const buckets = initCommodityBuckets();

  for (const policy of policyItems || []) {
    for (const c of policy.commodities || []) {
      const bucket = buckets.get(normalizeCommodityId(c.id));
      if (bucket) bucket.policies.push(policy);
    }
  }

  for (const news of fastPool || []) {
    const poolType = news.category === 'global' ? 'global' : 'cn';
    const tagged = tagNewsItemForCommodities(news, poolType === 'global' ? 'global' : 'cn');
    for (const { commodityId, relevance, item } of tagged) {
      if (relevance < 1) continue;
      const bucket = buckets.get(normalizeCommodityId(commodityId));
      if (!bucket) continue;
      if (poolType === 'global') bucket.globalNews.push(item);
      else bucket.cnNews.push(item);
    }
  }

  for (const news of globalPool || []) {
    const tagged = tagNewsItemForCommodities({ ...news, category: 'global' }, 'global');
    for (const { commodityId, relevance, item } of tagged) {
      if (relevance < 1) continue;
      const bucket = buckets.get(normalizeCommodityId(commodityId));
      if (bucket) bucket.globalNews.push(item);
    }
  }

  for (const geo of geoItems || []) {
    const tagged = tagGeoItemForCommodities(geo);
    for (const { commodityId, relevance, item } of tagged) {
      if (relevance < 2) continue;
      const bucket = buckets.get(normalizeCommodityId(commodityId));
      if (bucket) bucket.geoNews.push(item);
    }
  }

  const catalog = [];
  const feeds = {};

  for (const bucket of buckets.values()) {
    bucket.policies = dedupeByLink(bucket.policies).sort((a, b) => {
      const starDiff = (b.stars || 0) - (a.stars || 0);
      if (starDiff !== 0) return starDiff;
      return sortByDateDesc(a, b);
    });
    bucket.cnNews = dedupeByLink(bucket.cnNews)
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0) || sortByDateDesc(a, b))
      .slice(0, 30);
    bucket.globalNews = dedupeByLink(bucket.globalNews)
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0) || sortByDateDesc(a, b))
      .slice(0, 25);
    bucket.geoNews = dedupeByLink(bucket.geoNews)
      .sort((a, b) => (b.stars || 0) - (a.stars || 0) || sortByDateDesc(a, b))
      .slice(0, 12);

    const totalCount =
      bucket.policies.length + bucket.cnNews.length + bucket.globalNews.length + bucket.geoNews.length;

    catalog.push({
      id: bucket.id,
      name: bucket.name,
      exchangeId: bucket.exchangeId,
      exchange: bucket.exchange,
      exchangeLabel: EXCHANGE_LABELS[bucket.exchangeId] || bucket.exchange,
      policyCount: bucket.policies.length,
      cnNewsCount: bucket.cnNews.length,
      globalNewsCount: bucket.globalNews.length,
      geoNewsCount: bucket.geoNews.length,
      totalCount,
    });

    feeds[bucket.id] = {
      policies: bucket.policies,
      cnNews: bucket.cnNews,
      globalNews: bucket.globalNews,
      geoNews: bucket.geoNews,
      counts: {
        policies: bucket.policies.length,
        cnNews: bucket.cnNews.length,
        globalNews: bucket.globalNews.length,
        geoNews: bucket.geoNews.length,
        total: totalCount,
      },
    };
  }

  catalog.sort((a, b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return a.exchangeId.localeCompare(b.exchangeId) || a.name.localeCompare(b.name, 'zh-CN');
  });

  const summary = {
    commodityCount: catalog.length,
    withData: catalog.filter((c) => c.totalCount > 0).length,
    totalPolicies: catalog.reduce((s, c) => s + c.policyCount, 0),
    totalCnNews: catalog.reduce((s, c) => s + c.cnNewsCount, 0),
    totalGlobalNews: catalog.reduce((s, c) => s + c.globalNewsCount, 0),
    totalGeoNews: catalog.reduce((s, c) => s + c.geoNewsCount, 0),
  };

  return { catalog, feeds, summary, updatedAt: new Date().toISOString() };
}

module.exports = {
  buildCommodityIntelligence,
  EXCHANGE_LABELS,
};
