/** 气候条目 → 大宗商品关联与影响方向 */
const { detectCommodityTags, detectImpactDirection } = require('./policy-commodity-map');
const { findTagById } = require('./policy-commodity-map');

const DIRECTION_LABELS = {
  bullish: '偏多',
  bearish: '偏空',
  neutral: '中性',
};

/** 气候专属词 → 品种（叠加 policy-commodity-map 宏观别名） */
const CLIMATE_COMMODITY_ALIASES = [
  { keywords: ['干旱', '旱灾', 'drought', '缺水'], ids: ['WH', 'c', 'm', 'SR', 'CF', 'a', 'y', 'p'] },
  { keywords: ['洪涝', '洪水', '汛', 'flood', '内涝'], ids: ['WH', 'c', 'm', 'rb', 'i', 'j', 'sc', 'fu'] },
  { keywords: ['台风', '飓风', 'typhoon', 'hurricane', 'cyclone'], ids: ['sc', 'fu', 'lu', 'bu', 'bc', 'cu', 'al'] },
  { keywords: ['厄尔尼诺', '拉尼娜', 'ENSO', 'El Niño', 'El Nino', 'La Niña'], ids: ['WH', 'c', 'm', 'y', 'p', 'sc', 'fu', 'ni', 'cu'] },
  { keywords: ['高温', '热浪', 'heatwave', '酷暑'], ids: ['lh', 'WH', 'c', 'sc', 'fu', 'lu', 'pg', 'MA'] },
  { keywords: ['寒潮', '霜冻', '暴雪', '极寒', 'frost', 'cold snap', 'blizzard'], ids: ['WH', 'c', 'm', 'j', 'jm', 'rb', 'hc', 'sc', 'fu', 'pg'] },
  { keywords: ['山火', '野火', 'wildfire'], ids: ['WH', 'c', 'm', 'y', 'p', 'l', 'v', 'pp'] },
  { keywords: ['水电', '水电出力', 'hydropower'], ids: ['sc', 'fu', 'lu', 'al', 'ni', 'cu'] },
  { keywords: ['光伏', '风电出力', '新能源限电'], ids: ['si', 'lc', 'ps', 'FG', 'SA'] },
  { keywords: ['港口封航', '航运中断', '运河'], ids: ['sc', 'fu', 'lu', 'bu', 'bc', 'i', 'rb'] },
  { keywords: ['锂矿', '铜矿', '铁矿', '煤矿停产'], ids: ['lc', 'cu', 'i', 'j', 'jm', 'sc'] },
];

function keywordMatches(text, keyword) {
  const k = String(keyword || '').trim();
  if (!k) return false;
  if (/[\u4e00-\u9fff]/.test(k)) return text.includes(k);
  return text.toLowerCase().includes(k.toLowerCase()) || text.includes(k);
}

function detectClimateCommodityTags(text) {
  const matched = new Map();
  for (const base of detectCommodityTags(text)) {
    matched.set(String(base.id).toLowerCase(), base);
  }
  for (const alias of CLIMATE_COMMODITY_ALIASES) {
    if (alias.keywords.some((k) => keywordMatches(text, k))) {
      for (const id of alias.ids) {
        const tag = findTagById(id);
        if (tag) matched.set(String(tag.id).toLowerCase(), { id: tag.id, name: tag.name });
      }
    }
  }
  return [...matched.values()].slice(0, 8);
}

function buildCommodityImpactSummary(item) {
  const parts = [];
  if (item.analysis?.impactLine) parts.push(item.analysis.impactLine);
  if (item.primaryCategoryLabel) parts.push(`传导：${item.primaryCategoryLabel}`);
  if (item.eventTypeLabel) parts.push(item.eventTypeLabel);
  return parts.slice(0, 2).join(' · ') || '气候扰动通过产量、物流或能源链影响相关品种';
}

function enrichClimateCommodities(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${item.analysis?.impactLine || ''}`;
  const commodities = item.commodities?.length ? item.commodities : detectClimateCommodityTags(text);
  const direction = item.direction || detectClimateImpactDirection(text, item);
  const commodityImpactSummary = item.commodityImpactSummary || buildCommodityImpactSummary(item);

  return {
    commodities,
    direction,
    directionLabel: DIRECTION_LABELS[direction] || '中性',
    commodityImpactSummary,
    commodityLinked: commodities.length > 0,
  };
}

function detectClimateImpactDirection(text, item) {
  const hay = `${text} ${item?.eventTypeLabel || ''}`;
  const supplyShock = /减产|停产|封港|断供|短缺|减产|supply shock|shortage|disruption|crop loss/i.test(hay);
  const relief = /丰收|增产|解除预警|恢复通航|复产|easing|recovery|rain relief/i.test(hay);
  if (supplyShock && !relief) return 'bullish';
  if (relief && !supplyShock) return 'bearish';
  return detectImpactDirection(hay);
}

module.exports = {
  enrichClimateCommodities,
  detectClimateCommodityTags,
  buildCommodityImpactSummary,
  CLIMATE_COMMODITY_ALIASES,
  DIRECTION_LABELS,
};
