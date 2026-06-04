/** 美国政策雷达 — 联邦机构配置与数据源 */
const US_POLICY_DEPARTMENTS = [
  {
    id: 'us-sec',
    name: '美国证券交易委员会',
    shortName: 'SEC',
    weight: 1.5,
    keywords: [
      'SEC',
      'Securities and Exchange',
      'securities',
      'investment company',
      'broker-dealer',
      'disclosure',
      'IPO',
      'ETF',
      'mutual fund',
    ],
  },
  {
    id: 'us-fed',
    name: '美国联邦储备委员会',
    shortName: '美联储',
    weight: 2.5,
    keywords: [
      'Federal Reserve',
      'Fed ',
      'FOMC',
      'interest rate',
      'monetary policy',
      'discount rate',
      'reserve requirement',
      'quantitative',
      'bank holding',
    ],
  },
  {
    id: 'us-treasury',
    name: '美国财政部',
    shortName: '财政部',
    weight: 2,
    keywords: [
      'Treasury',
      'sanctions',
      'OFAC',
      'debt ceiling',
      'Treasury securities',
      'tax',
      'inflation',
      'bond',
    ],
  },
  {
    id: 'us-usda',
    name: '美国农业部',
    shortName: 'USDA',
    weight: 1.5,
    keywords: [
      'Agriculture',
      'USDA',
      'crop',
      'grain',
      'corn',
      'soybean',
      'wheat',
      'livestock',
      'farm',
      'food aid',
    ],
  },
  {
    id: 'us-commerce',
    name: '美国商务部',
    shortName: '商务部',
    weight: 1.5,
    keywords: [
      'Commerce',
      'export control',
      'semiconductor',
      'entity list',
      'BIS',
      'trade deficit',
      'steel',
      'aluminum',
    ],
  },
  {
    id: 'us-doe',
    name: '美国能源部',
    shortName: '能源部',
    weight: 1.5,
    keywords: [
      'Energy Department',
      'DOE',
      'petroleum',
      'crude oil',
      'natural gas',
      'Strategic Petroleum',
      'SPR',
      'LNG',
      'renewable',
    ],
  },
  {
    id: 'us-cftc',
    name: '美国商品期货交易委员会',
    shortName: 'CFTC',
    weight: 2,
    keywords: [
      'CFTC',
      'Commodity Futures',
      'derivatives',
      'futures',
      'swaps',
      'position limit',
      'margin',
      'speculative',
    ],
  },
  {
    id: 'us-ustr',
    name: '美国贸易代表办公室',
    shortName: 'USTR',
    weight: 2,
    keywords: [
      'Trade Representative',
      'USTR',
      'tariff',
      'Section 301',
      'Section 232',
      'trade agreement',
      'WTO',
      'anti-dumping',
    ],
  },
  {
    id: 'us-epa',
    name: '美国环保署',
    shortName: 'EPA',
    weight: 1,
    keywords: [
      'Environmental Protection',
      'EPA',
      'emissions',
      'carbon',
      'fuel standard',
      'renewable fuel',
      'climate',
    ],
  },
  {
    id: 'us-exec',
    name: '白宫 / 综合',
    shortName: '白宫',
    weight: 2,
    keywords: ['White House', 'Executive Order', 'President', 'national emergency'],
  },
];

const US_POLICY_RSS_FEEDS = [
  {
    id: 'sec-press',
    name: 'SEC Press Releases',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    departmentId: 'us-sec',
    limit: 30,
  },
  {
    id: 'fed-press',
    name: 'Federal Reserve Press',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    departmentId: 'us-fed',
    limit: 25,
  },
];

/** Federal Register API — 按机构 slug 抓取最新规章/公告 */
const US_FEDERAL_REGISTER_AGENCIES = [
  { id: 'fr-sec', slug: 'securities-and-exchange-commission', departmentId: 'us-sec', limit: 18 },
  { id: 'fr-fed', slug: 'federal-reserve-system', departmentId: 'us-fed', limit: 18 },
  { id: 'fr-treasury', slug: 'treasury-department', departmentId: 'us-treasury', limit: 15 },
  { id: 'fr-usda', slug: 'agriculture-department', departmentId: 'us-usda', limit: 15 },
  { id: 'fr-commerce', slug: 'commerce-department', departmentId: 'us-commerce', limit: 15 },
  { id: 'fr-doe', slug: 'energy-department', departmentId: 'us-doe', limit: 15 },
  { id: 'fr-cftc', slug: 'commodity-futures-trading-commission', departmentId: 'us-cftc', limit: 18 },
  { id: 'fr-ustr', slug: 'trade-representative-office-of-united-states', departmentId: 'us-ustr', limit: 15 },
  { id: 'fr-epa', slug: 'environmental-protection-agency', departmentId: 'us-epa', limit: 12 },
  { id: 'fr-whitehouse', slug: 'the-white-house-office', departmentId: 'us-exec', limit: 10 },
];

const US_FEDERAL_REGISTER_BASE =
  'https://www.federalregister.gov/api/v1/documents.json';

const US_POLICY_FETCH_KEYWORDS = [
  ...new Set([
    ...US_POLICY_DEPARTMENTS.flatMap((d) => d.keywords),
    'rule',
    'regulation',
    'policy',
    'tariff',
    'sanction',
    'interest rate',
    'monetary',
    'commodity',
    'futures',
    'oil',
    'gas',
    'agriculture',
    'trade',
    'export',
    'import',
    'enforcement',
    'final rule',
    'proposed rule',
    'notice',
    'macro',
    'market',
    'bank',
    'credit',
    'inflation',
  ]),
];

function getUsDepartmentById(id) {
  return US_POLICY_DEPARTMENTS.find((d) => d.id === id) || null;
}

function buildFederalRegisterUrl(slug, limit = 15) {
  const params = new URLSearchParams();
  params.append('conditions[agencies][]', slug);
  params.append('conditions[type][]', 'RULE');
  params.append('conditions[type][]', 'PRORULE');
  params.append('conditions[type][]', 'NOTICE');
  params.set('order', 'newest');
  params.set('per_page', String(limit));
  return `${US_FEDERAL_REGISTER_BASE}?${params.toString()}`;
}

module.exports = {
  US_POLICY_DEPARTMENTS,
  US_POLICY_RSS_FEEDS,
  US_FEDERAL_REGISTER_AGENCIES,
  US_POLICY_FETCH_KEYWORDS,
  US_FEDERAL_REGISTER_BASE,
  getUsDepartmentById,
  buildFederalRegisterUrl,
};
