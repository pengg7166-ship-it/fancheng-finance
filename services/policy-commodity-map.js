/** 政策关键词 → 大宗商品标签（与 commodities-catalog 全量同步） */
const { getAllCommodities } = require('./commodities-catalog');

/** 品种级补充关键词（政策/监管语境） */
const EXTRA_POLICY_KEYWORDS = {
  cu: ['有色', '电解铜', '精炼铜', 'LME', 'COMEX', 'copper'],
  al: ['有色', '电解铝', '铝土矿', 'aluminium', 'aluminum'],
  zn: ['有色', '精炼锌', 'zinc'],
  pb: ['有色', '铅', 'lead'],
  ni: ['有色', '不锈钢', 'nickel'],
  sn: ['有色', '锡', 'tin'],
  au: ['贵金属', '金价', 'bullion', 'COMEX gold', 'gold'],
  ag: ['贵金属', '银价', 'silver'],
  rb: ['钢铁', '粗钢', '建材钢', 'steel', 'rebar', '黑色'],
  hc: ['钢铁', '热轧', '板材', 'HRC', 'hot rolled'],
  ss: ['不锈钢', 'stainless'],
  i: ['黑色', '钢厂', '矿石', 'iron ore', 'pellet', '普氏'],
  j: ['黑色', '焦化', 'met coke', 'coke'],
  jm: ['黑色', '炼焦煤', 'coking coal'],
  fu: ['能化', '燃油', 'fuel oil'],
  bu: ['能化', '沥青', 'bitumen'],
  ru: ['轮胎', 'TSR20', 'rubber'],
  sc: ['原油', '石油', 'crude oil', 'WTI', 'Brent', 'OPEC', 'petroleum', '油气'],
  lu: ['低硫燃料油', '船燃', 'LSFO', 'marine fuel'],
  bc: ['国际铜', 'LME', 'COMEX copper', 'copper'],
  ec: ['集运', '欧线', '运费', 'container freight', 'shipping'],
  si: ['工业硅', '硅料', 'silicon metal', '光伏'],
  lc: ['碳酸锂', '锂价', 'lithium carbonate', 'battery', '锂电'],
  ps: ['多晶硅', 'polysilicon', '硅料', '光伏'],
  pt: ['铂金', 'platinum', 'PGM', '氢能催化剂'],
  pd: ['钯金', 'palladium', 'PGM', '汽车催化'],
  a: ['大豆', 'soybean', 'CBOT', '油脂油料'],
  b: ['大豆', 'soybean', '进口大豆'],
  c: ['玉米', 'corn', '淀粉', '饲料', 'ethanol'],
  m: ['豆粕', '大豆压榨', 'soy meal', 'soymeal', '油脂油料'],
  y: ['豆油', 'soybean oil', '油脂'],
  p: ['棕榈', 'palm oil', 'BMD', '植物油'],
  l: ['化工', '聚乙烯', 'PE', 'petrochemical', 'plastic'],
  v: ['化工', '聚氯乙烯', 'polyvinyl'],
  pp: ['化工', '聚丙烯', 'polypropylene'],
  eg: ['化工', 'MEG', 'ethylene glycol'],
  eb: ['化工', '苯乙烯', 'styrene'],
  pg: ['化工', 'LPG', '丙烷', 'propane'],
  lh: ['猪肉', '猪价', '养殖', 'pork', 'hog', 'livestock'],
  jd: ['鸡蛋', '蛋价', 'eggs'],
  CF: ['棉花', '棉价', 'cotton', 'ICE cotton'],
  SR: ['白糖', '食糖', '糖价', 'sugar'],
  TA: ['聚酯', '涤纶', 'PTA', '对苯二甲酸'],
  MA: ['甲醇', 'methanol', '煤制'],
  FG: ['玻璃', '光伏玻璃', 'glass'],
  RM: ['菜粕', '菜籽', 'rapeseed', 'canola'],
  OI: ['菜油', '菜籽油', 'rapeseed oil'],
  ZC: ['煤炭', '煤电', '电煤', 'thermal coal', 'coal'],
  WH: ['小麦', 'wheat', 'grain', '粮食'],
  PM: ['小麦', 'wheat', 'grain', '普麦'],
  UR: ['尿素', '化肥', 'urea'],
  SA: ['纯碱', 'soda ash'],
  AP: ['苹果', 'apple', '水果'],
  lg: ['木材', 'timber', '原木'],
};

/** 跨品种宏观词 → 关联合法品种 */
const MACRO_COMMODITY_ALIASES = [
  { keywords: ['有色金属', '有色产业', '铜铝锌'], ids: ['cu', 'al', 'zn', 'pb', 'ni', 'sn'] },
  { keywords: ['黑色金属', '钢铁产业', '粗钢产能'], ids: ['rb', 'hc', 'i', 'j', 'jm', 'ss'] },
  { keywords: ['油脂油料', '大豆进口', '豆粕豆油'], ids: ['a', 'b', 'm', 'y', 'p'] },
  { keywords: ['能源化工', '石油化工', '炼化'], ids: ['sc', 'fu', 'bu', 'lu', 'l', 'v', 'pp', 'eg', 'eb', 'pg', 'TA', 'MA'] },
  { keywords: ['新能源', '光伏', '锂电', '新三样'], ids: ['si', 'lc', 'ps', 'pt', 'pd', 'FG', 'SA', 'MA'] },
  { keywords: ['农产品', '粮食安全', '种业'], ids: ['c', 'm', 'y', 'p', 'CF', 'SR', 'WH', 'PM', 'lh'] },
  { keywords: ['大宗商品', '期货市场', '期货监管', 'position limit'], ids: [] },
  { keywords: ['中东', '红海', '霍尔木兹', '苏伊士', 'Middle East', 'Red Sea', 'Hormuz', '以军', '加沙', '胡塞'], ids: ['sc', 'fu', 'lu', 'bu'] },
  { keywords: ['俄乌', '乌克兰', 'Ukraine', 'Russia war', '黑海'], ids: ['sc', 'fu', 'WH', 'c', 'm', 'i'] },
  { keywords: ['台海', 'Taiwan Strait', '南海', 'South China Sea'], ids: ['sc', 'fu', 'lu', 'bc', 'cu'] },
  { keywords: ['制裁', '禁运', 'sanction', 'embargo', '实体清单'], ids: ['cu', 'al', 'ni', 'sc', 'i', 'lc'] },
  { keywords: ['关税战', '贸易战', 'tariff war', 'trade war'], ids: ['cu', 'al', 'a', 'c', 'm', 'y', 'p'] },
  { keywords: ['OPEC', '欧佩克', '原油减产', '石油禁运'], ids: ['sc', 'fu', 'lu', 'bu', 'pg'] },
  { keywords: ['粮食危机', 'food security', '小麦出口', 'wheat export'], ids: ['WH', 'PM', 'c', 'm', 'y', 'SR'] },
  { keywords: ['锂矿', '锂资源', 'lithium mine', '钴', 'cobalt', '稀土', 'rare earth'], ids: ['lc', 'ps', 'si'] },
];

function buildCommodityPolicyTags() {
  return getAllCommodities().map((c) => ({
    id: c.id,
    name: c.name,
    exchangeId: c.exchangeId,
    exchange: c.exchange,
    keywords: [
      ...new Set([
        c.name,
        c.id,
        c.sinaSymbol?.replace(/0$/, '') || '',
        ...(c.keywords || []),
        ...(c.global || []),
        ...(EXTRA_POLICY_KEYWORDS[c.id] || []),
      ]),
    ].filter(Boolean),
  }));
}

let cachedTags = null;

function getCommodityPolicyTags() {
  if (!cachedTags) cachedTags = buildCommodityPolicyTags();
  return cachedTags;
}

function normalizeCommodityId(id) {
  return String(id || '').toLowerCase();
}

function findTagById(id) {
  const norm = normalizeCommodityId(id);
  return getCommodityPolicyTags().find((t) => normalizeCommodityId(t.id) === norm) || null;
}

const POLICY_TYPE_KEYWORDS = {
  monetary: ['货币', '降准', '降息', 'LPR', 'MLF', '信贷', '利率', 'monetary', 'interest rate', 'FOMC', 'fed funds', 'quantitative', 'tightening', 'easing'],
  industry: ['产业', '制造业', '产能', '技改', '规划', '目录', 'industrial', 'manufacturing', 'capacity', 'infrastructure'],
  trade: ['进出口', '关税', '外贸', '反倾销', '出口', '进口', 'tariff', 'trade', 'export', 'import', 'sanction', 'Section 301', 'Section 232', 'anti-dumping', 'WTO'],
  regulation: ['监管', '管理办法', '暂行规定', '处罚', '合规', 'regulation', 'rule', 'enforcement', 'compliance', 'final rule', 'proposed rule', 'guidance'],
  reserve: ['收储', '抛储', '储备', '临储', 'Strategic Petroleum', 'SPR', 'reserve release', 'stockpile'],
  environmental: ['环保', '限产', '减排', '碳', '督察', 'environmental', 'emission', 'carbon', 'climate', 'EPA', 'renewable fuel'],
  price: ['价格', '调价', '限价', '机制', 'price', 'pricing', 'subsidy'],
};

function keywordMatches(text, keyword) {
  const k = String(keyword || '').trim();
  if (!k) return false;
  if (/[\u4e00-\u9fff]/.test(k)) return text.includes(k);
  if (k.length <= 3 && /^[a-z0-9]+$/i.test(k)) {
    const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(text);
  }
  return text.toLowerCase().includes(k.toLowerCase()) || text.includes(k);
}

function detectCommodityTags(text) {
  const matched = new Map();
  const tags = getCommodityPolicyTags();

  for (const item of tags) {
    if (item.keywords.some((k) => keywordMatches(text, k))) {
      matched.set(normalizeCommodityId(item.id), { id: item.id, name: item.name });
    }
  }

  for (const macro of MACRO_COMMODITY_ALIASES) {
    if (macro.keywords.some((k) => keywordMatches(text, k))) {
      for (const id of macro.ids) {
        const tag = findTagById(id);
        if (tag) matched.set(normalizeCommodityId(tag.id), { id: tag.id, name: tag.name });
      }
    }
  }

  return [...matched.values()].slice(0, 8);
}

function detectPolicyTypes(text) {
  const types = [];
  const lower = text.toLowerCase();
  for (const [type, words] of Object.entries(POLICY_TYPE_KEYWORDS)) {
    if (words.some((w) => keywordMatches(text, w) || lower.includes(w.toLowerCase()))) types.push(type);
  }
  return types.length ? types : ['general'];
}

function detectImpactDirection(text) {
  const bullish = [
    '支持', '扶持', '补贴', '降准', '降息', '收储', '刺激', '放宽', '鼓励',
    'stimulus', 'ease', 'easing', 'cut rate', 'rate cut', 'support', 'subsidy',
    'purchase program', 'buyback', 'release reserve', 'lower tariff', 'exemption',
  ];
  const bearish = [
    '限产', '打压', '收紧', '限制', '禁止', '处罚', '抛储', '加息', '抑制',
    'tighten', 'tightening', 'rate hike', 'restrict', 'ban', 'sanction', 'embargo',
    'prohibition', 'penalty', 'enforcement action', 'tariff increase', 'quota',
    'position limit', 'halt trading',
  ];
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of bullish) {
    if (lower.includes(w.toLowerCase()) || text.includes(w)) score += 1;
  }
  for (const w of bearish) {
    if (lower.includes(w.toLowerCase()) || text.includes(w)) score -= 1;
  }
  if (score > 0) return 'bullish';
  if (score < 0) return 'bearish';
  return 'neutral';
}

module.exports = {
  getCommodityPolicyTags,
  detectPolicyTypes,
  detectCommodityTags,
  detectImpactDirection,
  normalizeCommodityId,
  findTagById,
  get COMMODITY_POLICY_TAGS() {
    return getCommodityPolicyTags();
  },
};
