/** 天气气候 — 区域、传导维度、资讯源与关键词 */

const CLIMATE_REGIONS = [
  { id: 'domestic', label: '国内', flag: '🇨🇳' },
  { id: 'international', label: '国际', flag: '🌐' },
  { id: 'asia', label: '亚洲', flag: '🌏' },
  { id: 'americas', label: '美洲', flag: '🌎' },
  { id: 'europe', label: '欧洲', flag: '🇪🇺' },
  { id: 'africa', label: '非洲', flag: '🌍' },
  { id: 'oceania', label: '大洋洲', flag: '🌊' },
  { id: 'global', label: '全球', flag: '🔗' },
];

/** 气候→大宗传导维度 */
const CLIMATE_DIMENSIONS = [
  {
    id: 'agriculture',
    label: '农业产量',
    shortLabel: '农业',
    icon: '🌾',
    color: '#84cc16',
    description: '种植、畜牧、渔业与粮食油料供需',
    keywords: [
      '农业', '粮食', '作物', '种植', '收成', '减产', '丰收', '播种', '春播', '秋粮',
      '小麦', '玉米', '大豆', '水稻', '棉花', '糖料', '畜牧', '养殖', '饲料', '种业',
      'agriculture', 'crop', 'harvest', 'planting', 'wheat', 'corn', 'soybean', 'rice',
      'food security', 'grain', 'famine', 'drought crop', 'flood farmland',
    ],
  },
  {
    id: 'mining_logistics',
    label: '矿山物流',
    shortLabel: '矿山物流',
    icon: '⛏️',
    color: '#f59e0b',
    description: '矿山作业、航运港口、铁路公路与供应链中断',
    keywords: [
      '矿山', '采矿', '港口', '航运', '物流', '铁路', '公路', '运输', '供应链', '断航',
      '封港', '限运', '矿难', '露天矿', '井工', '铜矿', '铁矿', '煤矿', '锂矿',
      'mining', 'port', 'shipping', 'freight', 'logistics', 'supply chain', 'disruption',
      'canal', 'strait', 'typhoon port', 'flood mine', 'snow road',
    ],
  },
  {
    id: 'macro',
    label: '宏观政经',
    shortLabel: '宏观',
    icon: '📊',
    color: '#38bdf8',
    description: '气候政策、碳市场、能源安全与财政民生',
    keywords: [
      '气候政策', '碳中和', '碳达峰', '碳市场', '碳税', '排放', '绿电', '能源安全',
      '电价', '通胀', '保险', '救灾', '应急', '财政', '民生', 'COP', 'IPCC', 'ENSO',
      'climate policy', 'carbon', 'net zero', 'emission', 'renewable', 'energy transition',
      'climate risk', 'disaster relief', 'fiscal', 'insurance loss',
    ],
  },
];

const CLIMATE_EVENT_TYPES = [
  { id: 'drought', label: '干旱', weight: 3, keywords: ['干旱', '旱情', 'drought', 'water shortage', '缺水'] },
  { id: 'flood', label: '洪涝', weight: 3, keywords: ['洪涝', '洪水', '汛情', '内涝', 'flood', 'flooding', 'inundation'] },
  { id: 'typhoon', label: '台风', weight: 3, keywords: ['台风', '飓风', 'cyclone', 'typhoon', 'hurricane', '热带气旋'] },
  { id: 'elnino', label: '厄尔尼诺/拉尼娜', weight: 2.5, keywords: ['厄尔尼诺', '拉尼娜', 'ENSO', 'El Niño', 'El Nino', 'La Niña', 'La Nina', '南方涛动'] },
  { id: 'heatwave', label: '高温热浪', weight: 2.5, keywords: ['高温', '热浪', '酷暑', 'heatwave', 'heat wave', 'extreme heat', '破纪录高温'] },
  { id: 'frost', label: '寒潮霜冻', weight: 2.5, keywords: ['寒潮', '霜冻', '冰冻', '暴雪', '寒潮', 'cold snap', 'frost', 'freezing', 'blizzard', '极寒'] },
  { id: 'wildfire', label: '山火', weight: 2, keywords: ['山火', '野火', '林火', 'wildfire', 'bushfire'] },
  { id: 'policy', label: '气候政策', weight: 2, keywords: ['气候法案', '碳配额', 'climate bill', 'carbon market', 'climate summit', 'COP'] },
  { id: 'forecast', label: '预报预警', weight: 1, keywords: ['预报', '预警', '蓝色预警', '黄色预警', '红色预警', 'forecast', 'warning', 'alert'] },
];

const CLIMATE_RSS_FEEDS = [
  { id: 'bbc-env', name: 'BBC·环境', url: 'http://feeds.bbci.co.uk/news/science_and_environment/rss.xml', region: 'international', lang: 'en', translate: true },
  { id: 'guardian-env', name: '卫报·环境', url: 'https://www.theguardian.com/environment/rss', region: 'international', lang: 'en', translate: true },
  { id: 'npr-climate', name: 'NPR·气候', url: 'https://feeds.npr.org/1025/rss.xml', region: 'international', lang: 'en', translate: true },
  { id: 'dw-env', name: '德国之声·环境', url: 'https://rss.dw.com/rdf/rss-en-environment', region: 'international', lang: 'en', translate: true },
  { id: 'xinhua-domestic', name: '新华网·国内', url: 'http://www.news.cn/politics/news_politics.xml', region: 'domestic', lang: 'zh' },
  { id: 'people-env', name: '人民网·生态', url: 'http://env.people.com.cn/rss/env.xml', region: 'domestic', lang: 'zh' },
  { id: 'cctv-news', name: '央视·新闻', url: 'https://news.cctv.com/rss/china.xml', region: 'domestic', lang: 'zh' },
  { id: 'china-daily-env', name: '中国日报', url: 'http://www.chinadaily.com.cn/rss/china_rss.xml', region: 'domestic', lang: 'en', translate: true },
];

const CLIMATE_SEARCH_QUERIES = [
  '极端天气', '气象预警', '干旱', '洪涝', '台风', '寒潮', '高温热浪', '厄尔尼诺', '拉尼娜',
  '农业气象', '粮食减产', '气候政策', '碳中和', '碳排放', '能源保供', '防汛抗旱',
  '矿山停产', '港口封航', '航运中断', 'ENSO', '气候风险', '中国气象局', '暴雨红色预警',
  '小麦主产区', '大豆种植', '原油炼化停产', '水电出力', '新能源发电',
];

const CLIMATE_RELEVANCE_KEYWORDS = [
  ...CLIMATE_DIMENSIONS.flatMap((d) => d.keywords.slice(0, 25)),
  ...CLIMATE_EVENT_TYPES.flatMap((t) => t.keywords),
  '天气', '气候', '气象', '降水', '气温', '湿度', '季风', '梅雨', '沙尘暴', '冰雹',
  'weather', 'climate', 'meteorological', 'temperature', 'rainfall', 'precipitation',
  'disaster', '灾害', '应急', '救灾', '保险赔付', '产量', '减产', '供应冲击',
];

function getClimateRegionById(id) {
  return CLIMATE_REGIONS.find((r) => r.id === id) || { id, label: id, flag: '🌐' };
}

function getClimateDimensionById(id) {
  return CLIMATE_DIMENSIONS.find((d) => d.id === id) || null;
}

module.exports = {
  CLIMATE_REGIONS,
  CLIMATE_DIMENSIONS,
  CLIMATE_EVENT_TYPES,
  CLIMATE_RSS_FEEDS,
  CLIMATE_SEARCH_QUERIES,
  CLIMATE_RELEVANCE_KEYWORDS,
  getClimateRegionById,
  getClimateDimensionById,
};
