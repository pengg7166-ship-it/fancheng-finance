/** 地缘条目 → 大宗商品关联与影响摘要 */
const { detectCommodityTags, detectImpactDirection } = require('./policy-commodity-map');

const DIRECTION_LABELS = {
  bullish: '偏多',
  bearish: '偏空',
  neutral: '中性',
};

function buildCommodityImpactSummary(item) {
  const parts = [];
  if (item.analysis?.impactLine) parts.push(item.analysis.impactLine);
  if (item.analysis?.primaryDimensionLabel) {
    parts.push(`竞争维度：${item.analysis.primaryDimensionLabel}`);
  }
  if (item.dimensionLabel) parts.push(item.dimensionLabel);
  return parts.slice(0, 2).join(' · ') || '地缘事件或扰动相关品种供需与风险溢价';
}

function enrichGeopoliticsCommodities(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${item.analysis?.impactLine || ''}`;
  const commodities = item.commodities?.length ? item.commodities : detectCommodityTags(text);
  const direction = item.direction || detectImpactDirection(text);
  const commodityImpactSummary = item.commodityImpactSummary || buildCommodityImpactSummary(item);

  return {
    commodities,
    direction,
    directionLabel: DIRECTION_LABELS[direction] || '中性',
    commodityImpactSummary,
    commodityLinked: commodities.length > 0,
  };
}

module.exports = {
  enrichGeopoliticsCommodities,
  buildCommodityImpactSummary,
  DIRECTION_LABELS,
};
