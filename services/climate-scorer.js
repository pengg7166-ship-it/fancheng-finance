const {
  CLIMATE_REGIONS,
  CLIMATE_EVENT_TYPES,
  CLIMATE_DIMENSIONS,
  getClimateRegionById,
} = require('./climate-sources');
const { detectDimensions, detectEventTypes } = require('./climate-analyst');

function clampStars(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function starsToHtml(stars) {
  const n = clampStars(stars);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function inferRegion(item, text) {
  if (item.feedRegion) return item.feedRegion;
  if (/中国|国内|华北|华南|长江|黄河|新疆|东北|西南|中央气象台|气象局/i.test(text)) return 'domestic';
  if (/美国|欧洲|印度|巴西|澳洲|非洲|国际|全球|UN|IPCC/i.test(text)) return 'international';
  return item.lang === 'zh' ? 'domestic' : 'international';
}

function scoreClimateItem(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  const dimensions = detectDimensions(text);
  const eventTypes = detectEventTypes(text);
  const region = inferRegion(item, text);
  const regionInfo = getClimateRegionById(region);

  const maxEventWeight = eventTypes.length ? Math.max(...eventTypes.map((e) => e.weight)) : 0;
  const maxDimIntensity = dimensions.length
    ? Math.max(...dimensions.map((d) => d.intensity))
    : 1;
  const eventBonus = eventTypes.length ? Math.min(2, eventTypes.length * 0.4) : 0;

  let raw =
    maxEventWeight * 0.85 +
    maxDimIntensity * 0.55 +
    eventBonus +
    (item.sourceTier === 'primary' ? 0.2 : 0);

  if (/特大|重大|灾难|灾害|红色预警|national emergency|major disaster|catastrophic/i.test(text)) {
    raw += 1.2;
  }
  if (/国家|国务院|部委|央行|财政|COP|IPCC|national policy|climate bill/i.test(text)) {
    raw += 0.8;
  }
  if (/省级|区域|regional|significant/i.test(text)) raw += 0.4;
  if (/背景|例行|周报|气候展望|seasonal outlook|长期平均/i.test(text)) raw -= 0.8;
  if (/娱乐|体育|明星|旅游攻略/i.test(text)) raw -= 1.5;

  const stars = clampStars(raw);
  const primaryCategory = dimensions[0] || CLIMATE_DIMENSIONS[2];
  const primaryEvent = eventTypes[0] || null;

  return {
    stars,
    starsHtml: starsToHtml(stars),
    region,
    regionLabel: regionInfo.label,
    regionFlag: regionInfo.flag,
    dimensions,
    eventTypes: eventTypes.map((e) => ({ id: e.id, label: e.label, weight: e.weight })),
    primaryCategoryId: primaryCategory.id,
    primaryCategoryLabel: primaryCategory.shortLabel || primaryCategory.label,
    eventTypeId: primaryEvent?.id,
    eventTypeLabel: primaryEvent?.label,
    needsAnalysis: stars >= 2,
  };
}

function buildCategoryGroups(items) {
  const groups = CLIMATE_DIMENSIONS.map((d) => ({
    id: d.id,
    label: d.label,
    icon: d.icon,
    color: d.color,
    items: [],
  }));
  const map = new Map(groups.map((g) => [g.id, g]));

  for (const item of items) {
    const dimId = item.primaryCategoryId || item.dimensions?.[0]?.id || 'macro';
    const g = map.get(dimId) || map.get('macro');
    g.items.push(item);
  }

  return groups
    .map((g) => ({ ...g, items: g.items.sort((a, b) => (b.stars || 0) - (a.stars || 0)) }))
    .filter((g) => g.items.length);
}

function buildStats(items) {
  const highImpact = items.filter((i) => (i.stars || 0) >= 4).length;
  const withAnalysis = items.filter((i) => i.analysis).length;
  const linked = items.filter((i) => i.commodityLinked).length;
  const byRegion = {};
  const byCategory = {};

  for (const item of items) {
    byRegion[item.region] = (byRegion[item.region] || 0) + 1;
    const cat = item.primaryCategoryId || 'macro';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  return {
    total: items.length,
    highImpact,
    withAnalysis,
    commodityLinked: linked,
    byRegion,
    byCategory,
    dimensions: CLIMATE_DIMENSIONS.map((d) => ({
      id: d.id,
      label: d.label,
      count: byCategory[d.id] || 0,
    })),
  };
}

module.exports = {
  scoreClimateItem,
  buildCategoryGroups,
  buildStats,
  starsToHtml,
  clampStars,
};
