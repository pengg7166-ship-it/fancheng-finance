/**
 * 大宗商品资讯 · 三维影响评估
 * 宽度 = 波及多少板块/品种（横向覆盖）
 * 广度 = 对定价/供需的冲击深度（纵向强度，非盘面噪音）
 * 时长 = 影响可持续多久（决定置顶天数与板块归属）
 * 中国政府干预 = 独立评估轴（部委权威 × 干预类型 × 执行力度），再映射到三维
 */
const {
  detectCommodityTags,
  detectPolicyTypes,
  MACRO_COMMODITY_ALIASES,
} = require('./policy-commodity-map');
const { assessCommodityNewsRelevance, capTierByRelevance, assessExpectationValue, GLOBAL_TIER_CHANNEL_IDS } = require('./focus-news-relevance');
const { assessNewsSourceQuality, blendRankingScore } = require('./focus-news-source-quality');

const DURATION_META = {
  intraday: { label: '日内', days: 1, score: 18 },
  short: { label: '1-3天', days: 2, score: 38 },
  swing: { label: '3-7天', days: 5, score: 58 },
  cycle: { label: '7-14天', days: 9, score: 76 },
  structural: { label: '14天+', days: 14, score: 92 },
};

const WIDTH_LABELS = [
  [75, '全市场'],
  [55, '跨板块'],
  [32, '单板块'],
  [0, '单品种'],
];

const BREADTH_LABELS = [
  [72, '结构性冲击'],
  [52, '基本面扰动'],
  [32, '短期情绪'],
  [0, '盘面噪音'],
];

const GOV_INTERVENTION_TYPES = {
  reserve: { label: '收储抛储', breadth: 82, duration: 'cycle', widthBoost: 8 },
  price: { label: '价格调控', breadth: 80, duration: 'cycle', widthBoost: 6 },
  capacity: { label: '产能限产', breadth: 78, duration: 'cycle', widthBoost: 10 },
  trade: { label: '进出口管制', breadth: 76, duration: 'cycle', widthBoost: 12 },
  monetary: { label: '货币流动性', breadth: 68, duration: 'swing', widthBoost: 18 },
  regulation: { label: '监管规则', breadth: 62, duration: 'swing', widthBoost: 8 },
  industry: { label: '产业政策', breadth: 58, duration: 'swing', widthBoost: 6 },
  environmental: { label: '环保限产', breadth: 74, duration: 'cycle', widthBoost: 8 },
};

const GOV_FORCE_VERBS = [
  '严禁', '禁止', '全面', '立即', '即日起', '约谈', '挂牌', '收储', '抛储', '临储',
  '限价', '指导价', '稳价', '保供', '调控', '限产', '停产', '检修', '核查', '整顿',
  '出口禁令', '暂停出口', '加征', '反倾销', '配额', '总量控制', '产能置换', '环保督察',
];
const GOV_SOFT_SIGNALS = ['征求意见', '草案', '试点', '研究', '探讨', '拟', '或将', '有望', '座谈会', '调研', '走访'];
const GOV_NOISE_SIGNALS = ['统计', '人事', '任免', '答记者问', '解读', '宣传活动', '座谈会', '调研走访'];

function labelFromScore(score, table) {
  for (const [min, label] of table) {
    if (score >= min) return label;
  }
  return table[table.length - 1][1];
}

function detectCnGovAuthorities(text) {
  const t = String(text || '');
  const patterns = [
    { id: 'gov', shortName: '国务院', weight: 3, re: /国务院|国常会|国务院常务会议/ },
    { id: 'ndrc', shortName: '发改委', weight: 2, re: /发改委|国家发展改革委/ },
    { id: 'pboc', shortName: '央行', weight: 2, re: /人民银行|央行|中国人民银行/ },
    { id: 'mara', shortName: '农业农村部', weight: 2, re: /农业农村部|农业部/ },
    { id: 'mofcom', shortName: '商务部', weight: 2, re: /商务部/ },
    { id: 'miit', shortName: '工信部', weight: 2, re: /工信部|工业和信息化部/ },
    { id: 'nea', shortName: '能源局', weight: 2, re: /国家能源局|能源局/ },
    { id: 'csrc', shortName: '证监会', weight: 2, re: /证监会|证券监督管理|期货监管|持仓限额|限仓/ },
    { id: 'nfra', shortName: '金融监管', weight: 1, re: /金融监管总局|银保监会/ },
    { id: 'mee', shortName: '生态环境部', weight: 2, re: /生态环境部|环保督察/ },
    { id: 'customs', shortName: '海关', weight: 2, re: /海关总署|海关总/ },
    { id: 'samr', shortName: '市场监管', weight: 1, re: /市场监管总局|市场监管/ },
  ];
  return patterns.filter((p) => p.re.test(t)).map((p) => ({ id: p.id, shortName: p.shortName, weight: p.weight }));
}

/**
 * 中国政府对大宗商品市场的干预评估
 * 核心逻辑：部委权威 × 干预类型 × 执行力度 → 映射到宽/广/时
 */
function assessChineseGovIntervention(text) {
  const t = String(text || '');
  const authorities = detectCnGovAuthorities(t);
  const policyTypes = detectPolicyTypes(t);
  const hasAuthority = authorities.length > 0;
  const hasGovContext = hasAuthority || /中国(政府|国务院|部委)|国常会|发改委|央行|商务部|工信部|农业农村部|能源局|市场监管|国务院/.test(t);

  if (!hasGovContext) {
    return { detected: false, strength: 0, authorities: [], types: [], label: null };
  }

  if (GOV_NOISE_SIGNALS.some((w) => t.includes(w)) && !GOV_FORCE_VERBS.some((w) => t.includes(w))) {
    return { detected: false, strength: 12, authorities, types: policyTypes, label: '政务信息', noise: true };
  }

  if (/批复/.test(t) && /规划/.test(t) && !GOV_FORCE_VERBS.some((w) => t.includes(w))) {
    return { detected: false, strength: 18, authorities, types: policyTypes, label: '规划批复', noise: true };
  }

  let strength = 28;
  const maxAuthWeight = authorities.reduce((m, a) => Math.max(m, a.weight || 1), 0);
  strength += maxAuthWeight * 14;
  if (authorities.some((a) => a.id === 'gov')) strength += 16;
  if (/国常会/.test(t)) strength += 12;

  const matchedTypes = policyTypes.filter((pt) => GOV_INTERVENTION_TYPES[pt]);
  for (const pt of matchedTypes) {
    strength += 8;
  }

  const forceHits = GOV_FORCE_VERBS.filter((w) => t.includes(w)).length;
  strength += Math.min(forceHits * 6, 24);

  if (GOV_SOFT_SIGNALS.some((w) => t.includes(w)) && forceHits === 0) strength -= 14;
  if (/座谈会|调研|走访/.test(t) && !/约谈|严禁|禁止|印发|实施|决定|投放|挂牌|收储|抛储/.test(t)) {
    strength = Math.min(strength, 38);
  }
  if (/印发|发布|公布|实施|通告|通知(?!意见)/.test(t)) strength += 6;

  const primaryType = matchedTypes.sort(
    (a, b) => (GOV_INTERVENTION_TYPES[b]?.breadth || 0) - (GOV_INTERVENTION_TYPES[a]?.breadth || 0)
  )[0];
  const typeMeta = primaryType ? GOV_INTERVENTION_TYPES[primaryType] : null;

  strength = Math.round(Math.min(100, Math.max(0, strength)));
  const authorityLabel = authorities.map((a) => a.shortName).slice(0, 2).join('·') || '政策';
  const label = typeMeta ? `${typeMeta.label}·${authorityLabel}` : (hasAuthority ? `政府政策·${authorityLabel}` : null);

  return {
    detected: strength >= 42 && (hasAuthority || forceHits > 0 || matchedTypes.length > 0),
    strength,
    authorities: authorities.map((a) => ({ id: a.id, name: a.shortName, weight: a.weight })),
    types: matchedTypes,
    primaryType,
    typeMeta,
    label,
    forceHits,
    noise: false,
    dataSource: 'cn-gov-intervention',
  };
}

function isCnGovGlobalIntervention(gov) {
  if (!gov?.detected) return false;
  if (gov.strength < 68) return false;
  const authIds = (gov.authorities || []).map((a) => a.id);
  if (gov.primaryType === 'monetary' && gov.strength >= 62) return true;
  if (gov.primaryType === 'trade' && gov.forceHits >= 1 && gov.strength >= 65) return true;
  if ((authIds.includes('gov') || authIds.includes('pboc')) && gov.forceHits >= 1 && gov.strength >= 72) {
    return true;
  }
  return gov.strength >= 82 && gov.forceHits >= 2;
}

function isCnGovSectorIntervention(gov) {
  if (!gov?.detected) return false;
  if (gov.strength < 48) return false;
  const sectorTypes = ['reserve', 'price', 'capacity', 'environmental', 'trade', 'industry', 'regulation'];
  return sectorTypes.includes(gov.primaryType) || gov.forceHits >= 1;
}

function applyGovToDimensions(text, width, breadth, duration, gov) {
  if (!gov?.detected) return { width, breadth, duration, gov };

  let w = width;
  let b = breadth;
  let d = duration;

  if (gov.typeMeta) {
    b = Math.max(b, gov.typeMeta.breadth);
    w += gov.typeMeta.widthBoost;
    if (rankDuration(gov.typeMeta.duration) > rankDuration(d)) d = gov.typeMeta.duration;
  }

  b = Math.max(b, Math.round(gov.strength * 0.82));
  w += Math.min(22, Math.round(gov.strength * 0.18));

  if (isCnGovGlobalIntervention(gov)) w = Math.max(w, 76);
  else if (isCnGovSectorIntervention(gov)) w = Math.max(w, 42);

  if (gov.forceHits >= 2 && gov.strength >= 55) {
    if (rankDuration('cycle') > rankDuration(d)) d = 'cycle';
  }
  if (gov.authorities.some((a) => a.id === 'gov') && gov.strength >= 65) {
    d = 'structural';
  }

  return {
    width: Math.round(Math.min(100, w)),
    breadth: Math.round(Math.min(100, b)),
    duration: d,
    gov,
  };
}

const GLOBAL_SYMBOL_CAP = 4;

function countImpactSymbols(dim, review) {
  const fromReview = review?.suggestedSymbols || [];
  if (fromReview.length) return fromReview.length;
  return (dim.symbols || []).length;
}

function isMacroGlobalNews(dim, review, text) {
  const channels = review?.channels || [];
  return channels.some((id) => GLOBAL_TIER_CHANNEL_IDS.has(id)) && review?.eligibleGlobal === true;
}

function rankDuration(d) {
  const order = ['intraday', 'short', 'swing', 'cycle', 'structural'];
  return order.indexOf(d);
}

function isEnforcementNoise(text) {
  const t = String(text || '');
  if (
    !/enforcement action|issues enforcement|执法处罚|执法行动|former employee|termination of enforcement|takes enforcement action/i.test(
      t
    )
  ) {
    return false;
  }
  return !/tariff|sanction|禁运|embargo|关税|制裁|FOMC|commodity|大宗|利率|降息|加息|货币政策|monetary policy/i.test(t);
}

function isRoutineMarketWrap(text) {
  const t = String(text || '');
  if (/日报|日评|每日评述|有色金属日报|农产品日报|黑色日报|能化日报/i.test(t)) return true;
  if (/涨跌不一|涨跌互现|互有涨跌|小幅波动|窄幅震荡|交投|收盘综述|mixed|choppy|range-bound/i.test(t)) {
    return true;
  }
  if (/隔夜要闻|收盘|盘面|期价.*日|日涨跌/i.test(t) && !/减产|旱情|洪涝|霜冻|极端天气|出口禁令|罢工|停产|关税|制裁/i.test(t)) {
    return true;
  }
  if (/芝加哥农产品|CBOT|美豆|美玉米|美小麦|外盘.*收盘/i.test(t) && !/减产|旱情|洪涝|霜冻|极端天气|出口禁令|罢工|停产/i.test(t)) {
    return true;
  }
  if (/期价\d+日|农产品期价\d+/.test(t) && !/政策|限产|收储|关税|制裁|减产|灾害/i.test(t)) {
    return true;
  }
  return false;
}

function isForeignPriceCommentary(text) {
  const t = String(text || '');
  if (!/美国|芝加哥|CBOT|外盘|LME|COMEX|CME/i.test(t)) return false;
  if (/减产|旱情|洪涝|霜冻|极端天气|出口禁令|罢工|停产|关税|制裁|限产|收储/i.test(t)) return false;
  return /涨跌|期价|收盘|盘面|波动|mixed|choppy/i.test(t);
}

function detectSectorsFromText(text, sectorKeywords) {
  const t = String(text || '').toLowerCase();
  const hits = [];
  for (const [id, words] of Object.entries(sectorKeywords)) {
    if (words.some((w) => t.includes(String(w).toLowerCase()))) hits.push(id);
  }
  return [...new Set(hits)];
}

function isGlobalSystemic(text, gov = null) {
  if (isEnforcementNoise(text)) return false;
  const t = String(text || '').toLowerCase();
  const globalKeys = [
    '关税',
    '加征',
    'tariff',
    '贸易战',
    'trade war',
    '全面制裁',
    '制裁行动',
    'sanction',
    '禁运',
    'embargo',
    '实体清单',
    '石油禁运',
    '出口禁令',
    '系统性风险',
    '流动性危机',
    '紧急降息',
    '紧急加息',
    '大宗商品市场',
    'commodity market',
  ];
  if (globalKeys.some((k) => t.includes(k.toLowerCase()))) return true;
  if (
    /美联储|federal reserve|欧央行|ecb|日本央行|boj/i.test(t) &&
    /monetary|利率|降息|加息|fomc|货币政策|紧急/i.test(t)
  ) {
    return true;
  }
  const aliases = MACRO_COMMODITY_ALIASES || [];
  const broad = aliases.find(
    (a) => a.ids.length === 0 && a.keywords.some((k) => t.includes(k.toLowerCase()))
  );
  return Boolean(broad) || isCnGovGlobalIntervention(gov);
}

function assessSectorWideImpact(text, gov = null) {
  if (isCnGovSectorIntervention(gov)) return true;
  return /减产|旱情|干旱|洪涝|霜冻|极端天气|拉尼娜|厄尔尼诺|出口禁令|出口限制|限产|停产|收储|抛储|反内卷|内卷|产能过剩|价格战|产能调控|作物受损|单产.{0,6}下调|播种推迟|收割受阻|灾害|crop failure|drought|frost|export ban|production cut/i.test(
    String(text || '')
  );
}

function assessImpactWidth(text, sectors, symbols, gov = null) {
  const sectorN = sectors.length;
  const symbolN = symbols.length;
  let width = 0;

  width += Math.min(sectorN, 6) * 14;
  width += Math.min(symbolN, 8) * 2;

  if (sectorN >= 3) width += 14;
  else if (sectorN === 2) width += 8;

  if (sectorN >= 1 && assessSectorWideImpact(text, gov)) {
    width = Math.max(width, sectorN >= 2 ? 58 : 42);
  }

  if (isGlobalSystemic(text, gov)) width = Math.max(width, 82);

  if (sectorN <= 1 && symbolN <= 2 && !assessSectorWideImpact(text, gov) && !isGlobalSystemic(text, gov)) {
    width = Math.min(width, 36);
  }

  return Math.round(Math.min(100, Math.max(0, width)));
}

function assessImpactBreadth(text, gov = null) {
  const t = String(text || '');
  let breadth = 24;

  if (gov?.detected) {
    breadth = Math.max(breadth, Math.round(gov.strength * 0.85));
    if (gov.typeMeta) breadth = Math.max(breadth, gov.typeMeta.breadth);
  }

  if (isRoutineMarketWrap(t) && !gov?.detected) return 16;
  if (isForeignPriceCommentary(t)) return 22;
  if (/略有影响|一点影响|轻微影响|短期影响|影响有限|影响较小/i.test(t)) breadth = Math.min(breadth, 28);

  if (/减产|旱情|干旱|洪涝|霜冻|极端天气|拉尼娜|厄尔尼诺|作物受损|单产.{0,6}下调|播种推迟|收割受阻/i.test(t)) {
    breadth = Math.max(breadth, 68);
  }
  if (/出口禁令|出口限制|禁运|embargo|限产|停产|检修|爆炸|事故|港口封锁|物流中断/i.test(t)) {
    breadth = Math.max(breadth, 72);
  }
  if (/关税|加征|tariff|制裁|sanction|反内卷|产能调控|收储|抛储|反倾销|反补贴/i.test(t)) {
    breadth = Math.max(breadth, 74);
  }
  if (/opec|石油禁运|战略储备|SPR/i.test(t)) breadth = Math.max(breadth, 70);
  if (/FOMC|欧央行|ECB|紧急降息|紧急加息|流动性危机|系统性风险/i.test(t)) breadth = Math.max(breadth, 66);

  if (/巴西|美国|阿根廷|乌克兰|黑海/i.test(t) && /大豆|玉米|小麦|棉花|白糖|菜籽|豆粕|棕榈/i.test(t)) {
    if (/减产|旱|涝|干旱|霜|灾害|出口|禁令|罢工|港口|物流中断/i.test(t)) breadth = Math.max(breadth, 70);
    else if (/天气|降雨|干旱|forecast/i.test(t)) breadth = Math.max(breadth, 48);
  }

  if (/政策|发改委|商务部|工信部|农业农村部|海关|国常会|国务院|央行|证监会|能源局|市场监管/i.test(t) && /限产|收储|调控|禁令|加征|反倾销|抛储|稳价|保供|约谈/.test(t)) {
    breadth = Math.max(breadth, 72);
  }

  if (/暴跌|暴涨|crash|plunge|surge|历史性/i.test(t) && !isRoutineMarketWrap(t)) {
    breadth = Math.max(breadth, 44);
  }

  if (/分析|评论|观点|综述|综述|展望/i.test(t) && breadth < 40) breadth = Math.min(breadth, 32);

  return Math.round(Math.min(100, Math.max(0, breadth)));
}

function assessImpactDuration(text, breadth, gov = null) {
  const t = String(text || '');

  if (gov?.detected) {
    if (gov.typeMeta && rankDuration(gov.typeMeta.duration) >= rankDuration('swing')) {
      return gov.typeMeta.duration;
    }
    if (gov.authorities.some((a) => a.id === 'gov') && gov.strength >= 60) return 'structural';
    if (gov.forceHits >= 2 && gov.strength >= 52) return 'cycle';
    if (gov.strength >= 48) return 'swing';
  }

  if (isRoutineMarketWrap(t) || isForeignPriceCommentary(t)) return 'intraday';
  if (/略有影响|一点影响|轻微影响|短期影响|影响有限|影响较小|日内|短线/i.test(t)) return 'short';
  if (/隔夜|收盘综述|盘面/i.test(t) && breadth < 40) return 'intraday';

  if (/关税|贸易战|全面制裁|长期|结构性|货币政策转向|石油禁运/i.test(t)) return 'structural';
  if (/制裁|sanction|禁运|embargo|反内卷|内卷|产能过剩|价格战|产能调控|出口禁令/i.test(t)) return 'cycle';
  if (/减产|旱情|干旱|洪涝|霜冻|极端天气|限产|停产|收储|抛储|作物受损/i.test(t)) return 'cycle';
  if (/检修|港口|物流|阶段性|天气预报/i.test(t) && breadth >= 45) return 'swing';
  if (/FOMC|降息|加息|利率决议/i.test(t)) return breadth >= 60 ? 'cycle' : 'swing';
  if (/美联储|FOMC|人民银行|央行/i.test(t) && /降息|加息|至零|紧急|zero/i.test(t)) return 'structural';
  if (/IEA|USDA|美国农业部|期末库存|裂解价差|炼油利润|EIA|OPEC月报/i.test(t)) return 'swing';
  if (/厄尔尼诺|拉尼娜|极端天气|干旱|洪涝/i.test(t) && breadth >= 40) return 'cycle';
  if (/黄金储备|增持黄金/i.test(t)) return 'swing';
  if (/禁止出口|出口管理|临时禁止/i.test(t)) return 'swing';
  if (
    /纯碱|玻璃|焦煤|螺纹|钢铁|铁矿|PTA|甲醇|乙二醇|氧化铝|电解铝|工业硅|碳酸锂|多晶硅/i.test(t) &&
    /暴跌|重挫|深跌|历史低位|反内卷|内卷|产能过剩/i.test(t)
  ) {
    return 'cycle';
  }

  if (breadth >= 58) return 'swing';
  if (breadth >= 38) return 'short';
  return 'intraday';
}

function pinDaysFromDuration(duration, tier) {
  const base = DURATION_META[duration]?.days || 1;
  if (tier === 'feed') return 1;
  if (tier === 'symbol') return Math.min(base, 3);
  if (tier === 'sector') {
    if (duration === 'cycle' || duration === 'structural') {
      return Math.max(10, Math.min(base + 4, 14));
    }
    return Math.max(5, Math.min(base + 2, 10));
  }
  if (tier === 'global') return Math.max(7, Math.min(base + 3, 14));
  return base;
}

function compositeImpactScore(width, breadth, durationKey) {
  const dur = DURATION_META[durationKey]?.score || 20;
  return Math.round(width * 0.32 + breadth * 0.43 + dur * 0.25);
}

/**
 * @param {string} text 标题+摘要全文
 * @param {{ sectors?: string[], symbols?: string[], stars?: number }} item
 * @param {Record<string,string[]>} sectorKeywords
 */
function assessCommodityImpact(text, item = {}, sectorKeywords = {}) {
  let sectors = item.sectors?.length
    ? item.sectors
    : detectSectorsFromText(text, sectorKeywords);
  const tags = detectCommodityTags(text);
  let symbols = item.symbols?.length
    ? item.symbols
    : tags.map((c) => c.id);

  const gov = assessChineseGovIntervention(text);

  let width = assessImpactWidth(text, sectors, symbols, gov);
  let breadth = assessImpactBreadth(text, gov);
  let duration = assessImpactDuration(text, breadth, gov);
  const merged = applyGovToDimensions(text, width, breadth, duration, gov);
  width = merged.width;
  breadth = merged.breadth;
  duration = merged.duration;

  const durationMeta = DURATION_META[duration];
  const compositeScore = compositeImpactScore(width, breadth, duration);
  const sectorWide = assessSectorWideImpact(text, gov);

  const preDim = { width, breadth, duration, compositeScore, sectors, symbols, sectorWide, govPolicy: gov.detected ? gov : null };
  const sourceMeta = {
    sourceName: item.sourceName || item.source,
    source: item.source,
    url: item.url || item.link,
    feedId: item.feedId,
    department: item.department,
    departmentName: item.departmentName,
  };
  const expectationReview = assessExpectationValue(text, { sectors, symbols, ...sourceMeta }, preDim);

  if (expectationReview.suggestedSymbols?.length) {
    symbols = [...new Set(expectationReview.suggestedSymbols)];
  }
  if (expectationReview.suggestedSectors?.length) {
    sectors = [...new Set(expectationReview.suggestedSectors)];
  }

  const channelIds = expectationReview.channels || [];

  if (channelIds.some((id) => ['liquidity', 'fedRateOutlook', 'usEquityRiskOff'].includes(id))) {
    width = Math.max(width, 76);
    breadth = Math.max(breadth, 58);
    if (rankDuration(duration) < rankDuration('swing')) duration = 'swing';
  }
  if (channelIds.some((id) => ['riskOff', 'tradeGlobal'].includes(id))) {
    width = Math.max(width, 72);
    breadth = Math.max(breadth, 55);
    if (rankDuration(duration) < rankDuration('cycle')) duration = 'cycle';
  }
  if (channelIds.includes('sanctionMetals')) {
    breadth = Math.max(breadth, 52);
    if (rankDuration(duration) < rankDuration('cycle')) duration = 'cycle';
  }
  if (channelIds.includes('sectorInvolution')) {
    breadth = Math.max(breadth, 50);
    width = Math.max(width, 38);
    if (rankDuration(duration) < rankDuration('cycle')) duration = 'cycle';
  }
  if (channelIds.includes('sectorCrashRebound') || channelIds.includes('antiInvolutionWatch')) {
    breadth = Math.max(breadth, 52);
    width = Math.max(width, 40);
    if (rankDuration(duration) < rankDuration('cycle')) duration = 'cycle';
  }
  if (channelIds.includes('weatherSupply')) {
    breadth = Math.max(breadth, 50);
    if (rankDuration(duration) < rankDuration('cycle')) duration = 'cycle';
  }
  if (channelIds.includes('agResearch') || channelIds.includes('commodityBalance')) {
    breadth = Math.max(breadth, 46);
    width = Math.max(width, 34);
    if (rankDuration(duration) < rankDuration('swing')) duration = 'swing';
  }
  if (channelIds.includes('exportControl') || channelIds.includes('policyDirect')) {
    breadth = Math.max(breadth, 52);
    if (rankDuration(duration) < rankDuration('swing')) duration = 'swing';
  }
  if (channelIds.includes('reserveAccumulation')) {
    breadth = Math.max(breadth, 54);
    if (rankDuration(duration) < rankDuration('swing')) duration = 'swing';
  }

  const compositeScoreFinal = compositeImpactScore(width, breadth, duration);
  const durationMetaFinal = DURATION_META[duration];

  const expectationReviewFinal = assessExpectationValue(
    text,
    { sectors, symbols, ...sourceMeta },
    {
      width,
      breadth,
      duration,
      compositeScore: compositeScoreFinal,
      govPolicy: gov.detected ? gov : null,
      isGlobalSystemic: isGlobalSystemic(text, gov),
    }
  );

  const sourceQuality = expectationReviewFinal.sourceQuality || assessNewsSourceQuality(sourceMeta);

  return {
    width,
    breadth,
    duration,
    durationLabel: durationMetaFinal.label,
    durationDays: durationMetaFinal.days,
    widthLabel: labelFromScore(width, WIDTH_LABELS),
    breadthLabel: labelFromScore(breadth, BREADTH_LABELS),
    compositeScore: compositeScoreFinal,
    sectors,
    symbols,
    sectorWide,
    govPolicy: gov.detected ? gov : null,
    relevance: expectationReviewFinal,
    expectationReview: expectationReviewFinal,
    expectationMagnitude: expectationReviewFinal.expectationMagnitude,
    sourceQuality,
    combinedQuality: expectationReviewFinal.quality,
    isNoise: isEnforcementNoise(text) || Boolean(expectationReviewFinal.rejectReason),
    isRoutineWrap: isRoutineMarketWrap(text) && !gov.detected,
    isGlobalSystemic: isGlobalSystemic(text, gov) && expectationReviewFinal.eligibleGlobal,
    dataSource: 'focus-impact-dimensions',
  };
}

/**
 * 板块归属：以「时（≥3天→②，≥半月+面广→①）× 广（品种数）」为主轴
 * ① 更高级、更持久（半月～年）、波及品种多；≤4 品种封顶 ②
 */
function classifyTierFromDimensions(dim, text, item = {}) {
  if (!dim || dim.isNoise) return null;
  const review = dim.expectationReview || dim.relevance;
  if (review && !review.commodityRelevant) return null;

  const { width, breadth, duration, sectors, symbols } = dim;
  const durRank = rankDuration(duration);
  const symCount = countImpactSymbols(dim, review);
  const sectorCount = sectors.length;
  const macroGlobal = isMacroGlobalNews(dim, review, text);

  let classified = null;

  // ④ feed：<3 天，或盘面综述
  if ((dim.isRoutineWrap || durRank < rankDuration('swing')) && !dim.govPolicy?.detected) {
    if (breadth >= 8 || dim.isRoutineWrap) {
      classified = { tier: 'feed', sectors, symbols, strength: dim.compositeScore, dimensions: dim };
    }
  }

  // ① global：持久（cycle+ 或宏观流动性+swing）、宽≥72 广≥55；非宏观须 >4 品种
  const meetsGlobalDuration =
    durRank >= rankDuration('cycle') || (macroGlobal && durRank >= rankDuration('swing'));
  const meetsGlobalBreadth = macroGlobal;
  if (
    !classified &&
    meetsGlobalDuration &&
    meetsGlobalBreadth &&
    width >= 72 &&
    breadth >= 55
  ) {
    classified = { tier: 'global', sectors, symbols, strength: dim.compositeScore, dimensions: dim };
  }

  // ② sector：≥3 天价格预期；1~4 品种均可
  if (
    !classified &&
    durRank >= rankDuration('swing') &&
    breadth >= 26 &&
    (symCount >= 1 || sectorCount >= 1 || dim.govPolicy?.detected)
  ) {
    classified = { tier: 'sector', sectors, symbols, strength: dim.compositeScore, dimensions: dim };
  }

  // ③ symbol：单品种、窄宽度、≥3 天
  if (
    !classified &&
    durRank >= rankDuration('swing') &&
    symCount === 1 &&
    width < 42 &&
    breadth >= 30
  ) {
    classified = {
      tier: 'symbol',
      sectors,
      symbols,
      strength: dim.compositeScore,
      dimensions: dim,
      primarySymbol: symbols[0],
    };
  }

  if (!classified && breadth >= 10) {
    classified = { tier: 'feed', sectors, symbols, strength: dim.compositeScore, dimensions: dim };
  }
  if (!classified) return null;

  if (classified.tier === 'global' && symCount > 0 && symCount <= GLOBAL_SYMBOL_CAP && !macroGlobal) {
    classified = { ...classified, tier: 'sector' };
  }

  const cappedTier = capTierByRelevance(classified.tier, review, dim);
  if (!cappedTier) return null;
  return { ...classified, tier: cappedTier };
}

function dimensionsPassTierGate(dim, tier) {
  if (!dim || dim.isNoise) return false;
  const review = dim.expectationReview || dim.relevance;
  if (review && !review.commodityRelevant) return false;
  const { breadth, duration } = dim;
  const durRank = rankDuration(duration);

  if (tier === 'feed') {
    return review?.eligibleFeed && (dim.isRoutineWrap || durRank < rankDuration('swing'));
  }
  if (tier === 'global') {
    return (
      review?.eligibleGlobal &&
      (dim.width ?? 0) >= 72 &&
      (dim.breadth ?? 0) >= 55 &&
      durRank >= rankDuration('swing')
    );
  }
  if (tier === 'sector') {
    return review?.eligibleSector && durRank >= rankDuration('swing') && breadth >= 26;
  }
  if (tier === 'symbol') {
    return review?.eligibleSector && durRank >= rankDuration('swing') && (dim.symbols || []).length >= 1;
  }
  return false;
}

function formatDimensionsSummary(dim) {
  if (!dim) return '—';
  const gov = dim.govPolicy?.label ? `·${dim.govPolicy.label}` : '';
  const q = dim.expectationMagnitude ?? dim.expectationReview?.expectationMagnitude;
  const qual = q != null ? `·预期${q}` : '';
  return `宽${dim.width}·广${dim.breadth}·${dim.durationLabel}${gov}${qual}`;
}

module.exports = {
  DURATION_META,
  assessCommodityImpact,
  assessChineseGovIntervention,
  classifyTierFromDimensions,
  dimensionsPassTierGate,
  pinDaysFromDuration,
  compositeImpactScore,
  formatDimensionsSummary,
  isRoutineMarketWrap,
  isEnforcementNoise,
  isGlobalSystemic,
};
