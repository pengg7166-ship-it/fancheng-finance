/**
 * 大宗研判 · 资讯价值审查（先审预期，后入板）
 *
 * 核心逻辑（与用户研判框架一致）：
 *   政策/资讯 → 市场形成什么新预期 → 预期变化幅度 = 质量
 *   → 再结合宽/广/时三维决定 ①②④ 板块归属
 *
 * 不要求正文出现「大宗商品」字样；美联储降息、贸易战等通过
 * 流动性/避险/贸易等二阶传导通道识别（如：利率→流动性→风险资产）。
 */
const { detectCommodityTags, normalizeCommodityId } = require('./policy-commodity-map');
const {
  isUserFocusSymbol,
  getFocusSector,
  REBOUND_WATCH_SYMBOL_IDS,
  STRATEGIC_WATCH_SYMBOL_IDS,
  isReboundWatchSymbol,
  isStrategicWatchSymbol,
} = require('./user-focus-symbols');
const { assessNewsSourceQuality, blendRankingScore } = require('./focus-news-source-quality');

const RELEVANCE_VERSION = 'v1.56.15-cu-strategic-watch';

/** 仅下列传导通道可候选 ① 全市场 */
const GLOBAL_TIER_CHANNEL_IDS = new Set([
  'liquidity',
  'fedRateOutlook',
  'usEquityRiskOff',
  'riskOff',
  'tradeGlobal',
]);

function isStabilizeTradeRhetoric(text) {
  const t = String(text || '');
  return (
    /稳外贸|稳外资|扩大高水平开放|优化营商环境/i.test(t) &&
    !/关税|收储|限产|出口禁令|加征|大豆|原油|大宗|禁运|制裁/i.test(t)
  );
}

function isNonUsEquityMarketNoise(text) {
  const t = String(text || '');
  if (!/熔断|circuit breaker|暴跌.*暂停|trading halt|股指.*暴跌|股价指数.*跌/i.test(t)) return false;
  if (/标普|纳斯达克|道琼斯|美股|S&P|Nasdaq|Dow Jones|Wall Street|华尔街/i.test(t)) return false;
  if (/韩国|韩股|KOSPI|日经|港股|恒生|A股|上证|深证|创业板|欧股|富时|DAX/i.test(t)) return true;
  return /股指|股市|股价指数/i.test(t) && !/原油|大宗|黄金|commodity|铜|铝/i.test(t);
}

function isEvSectorCommentary(text) {
  if (isSectorReboundWatchStory(text)) return false;
  return /新能源渗透率|新势力.*KPI|光伏巨头|造车新势力|半年度KPI/i.test(String(text || ''));
}

/** 非池品种 → 可交易代理（产业链传导，仅用于②关注入板） */
const FOCUS_PROXY_BY_KEYWORD = [
  { re: /玻璃(?!幕墙)/i, symbols: ['fg'] },
  { re: /甲醇/i, symbols: ['ma'] },
  { re: /尿素/i, symbols: ['ma'] },
];

function symbolsFromCommodityText(text) {
  const t = String(text || '');
  const tags = detectCommodityTags(t);
  let syms = filterToFocusSymbols(tags.map((c) => normalizeCommodityId(c.id)));
  if (!syms.length) {
    for (const row of FOCUS_PROXY_BY_KEYWORD) {
      if (row.re.test(t)) {
        syms = filterToFocusSymbols(row.symbols);
        if (syms.length) break;
      }
    }
  }
  return syms;
}

function isCommodityCrashStory(text) {
  const t = String(text || '');
  if (isNonUsEquityMarketNoise(t)) return false;
  if (/美股|标普|纳斯达克|道琼斯|A股|上证|恒生|韩股|股指/i.test(t) && !symbolsFromCommodityText(t).length) {
    return false;
  }
  const hasCrash =
    /暴跌|重挫|崩盘|深跌|急跌|大跌|刷新年内低|历史低位|创新低|不见底|跌幅|跌超|跌\d+%|连跌|plunge|crash|slump/i.test(t);
  if (!hasCrash) return false;
  return symbolsFromCommodityText(t).length > 0 || /期价|期货|主力合约|连续下跌/i.test(t);
}

function isAntiInvolutionWatch(text) {
  return /反内卷|减产自律|去产能|产能出清|内卷治理|无序竞争|低价倾销|行业协会.*(限产|减产)/i.test(
    String(text || '')
  );
}

function isSectorInvolutionStory(text) {
  const t = String(text || '');
  return (
    /工业硅|硅业|多晶硅|硅价|光伏.*内卷|内卷.*(光伏|硅|产能)|产能过剩|价格战.*硅|放血.*内卷|硅业至暗/i.test(t) ||
    isAntiInvolutionWatch(t)
  );
}

function isSectorReboundWatchStory(text) {
  return isSectorInvolutionStory(text) || isCommodityCrashStory(text);
}

function isSectorCommentaryNoise(text) {
  if (isSectorReboundWatchStory(text)) return false;
  return /至暗时刻|大内卷|谁能熬过|暴跌\d+%仍不见底/i.test(String(text || ''));
}

const HIGH_WATCH_CHANNEL_IDS = new Set([
  'sectorInvolution',
  'sectorCrashRebound',
  'antiInvolutionWatch',
]);

function isAntiInvolutionOnlyText(text) {
  return /反内卷|内卷治理|减产自律|产能过剩|无序竞争|低价倾销/i.test(String(text || ''));
}

function isCopperThemedText(text) {
  return /电解铜|沪铜|LME.*铜|铜矿|精炼铜|copper|AI.*铜|数据中心.*铜/i.test(String(text || ''));
}

function isReboundWatchHit(channelIds, tradeableSymbols) {
  if (!channelIds.some((id) => HIGH_WATCH_CHANNEL_IDS.has(id))) return false;
  if (channelIds.includes('antiInvolutionWatch') && !tradeableSymbols.length) {
    return true;
  }
  return tradeableSymbols.some((s) => isReboundWatchSymbol(s));
}

function isStrategicCuWatch(channelIds, tradeableSymbols, text, magnitude) {
  if (!tradeableSymbols.includes('cu')) return false;
  if (isAntiInvolutionOnlyText(text) && !isCopperThemedText(text)) return false;
  if (channelIds.includes('sectorCrashRebound')) return true;
  if (magnitude < 28) return false;
  return (
    channelIds.includes('metalSupply') ||
    channelIds.includes('exportControl') ||
    channelIds.includes('commodityBalance') ||
    isCopperThemedText(text)
  );
}

function resolveWatchPriority(channelIds, tradeableSymbols, text, magnitude) {
  if (isReboundWatchHit(channelIds, tradeableSymbols)) {
    return { watchPriority: 'high', watchReason: 'rebound-anti-involution' };
  }
  if (isStrategicCuWatch(channelIds, tradeableSymbols, text, magnitude)) {
    return { watchPriority: 'high', watchReason: 'strategic-cu' };
  }
  return { watchPriority: null, watchReason: null };
}

const DURATION_RANK = { intraday: 0, short: 1, swing: 2, cycle: 3, structural: 4 };
function rankDurationKey(d) {
  return DURATION_RANK[d] ?? -1;
}

/** ① 品种数上限：只影响 ≤4 个可交易品种时，最高进 ② */
const GLOBAL_SYMBOL_CAP = 4;

/** ②板块：对品种/板块价格有中短期影响的资讯类型（用户校准） */
const SECTOR_MEDIUM_CHANNEL_IDS = new Set([
  'commodityBalance',
  'weatherSupply',
  'energySupply',
  'exportControl',
  'reserveAccumulation',
  'policyDirect',
  'metalSupply',
  'agResearch',
  'sanctionMetals',
  'sectorInvolution',
  'sectorCrashRebound',
  'antiInvolutionWatch',
]);

/** 对大宗定价几乎不产生新预期的政务主题 — 质量分封顶 */
const LOW_VALUE_ADMIN_RES = [
  /中医药|中医事业|中药振兴/,
  /疾控|疾病预防控制|公共卫生|卫生健康|医疗卫生|医保|医改/,
  /旅游(?!商品)|文旅|风景名胜/,
  /残疾人|民政(?!部.*(收储|保供))/,
  /教育(?!.*产业)|义务教育|学籍/,
  /体育事业|全民健身|文化遗产|非遗/,
  /人口发展|生育支持|托育/,
  /表彰|先进事迹|人事任免|任命|辞职/,
];

const GENERIC_PLAN_REPLY_RE =
  /国务院关于[《「].{2,40}(十五五|十四五|十三五).{0,20}规划[》」].{0,8}的批复/;

/**
 * 预期传导通道 — 每条描述「市场会形成什么预期」，而非关键词机械匹配
 */
const TRANSMISSION_CHANNELS = [
  {
    id: 'liquidity',
    scope: 'global',
    magnitude: 76,
    narrative: '货币政策/流动性预期变化→贴现率与风险偏好重估→风险资产与大宗商品定价框架联动',
    test: (t) =>
      !/黄金储备|增持黄金|gold reserve/i.test(t) &&
      /美联储|FOMC|federal reserve|欧央行|ECB|日本央行|BOJ|人民银行|央行/i.test(t) &&
      /降息|加息|利率|货币政策|monetary|基点|bps|至零|zero|QE|量化宽松|缩表|流动性/i.test(t),
  },
  {
    id: 'riskOff',
    scope: 'global',
    magnitude: 74,
    narrative: '增长/信用/地缘恶化预期→避险与去杠杆→风险资产遭抛售、波动率抬升',
    test: (t) =>
      /贸易战|trade war|经济衰退|recession|金融危机|系统性风险|流动性危机|债务违约|主权违约|银行危机|挤兑/i.test(t) ||
      (/关税|tariff|制裁|sanction|禁运|embargo/i.test(t) && /全面|大规模|升级|加征/i.test(t)),
  },
  {
    id: 'fedRateOutlook',
    scope: 'global',
    magnitude: 74,
    narrative: '美联储利率路径预期变化→贴现率与大宗商品定价框架重估（须特别留意）',
    test: (t) =>
      (/美联储|FOMC|Federal Reserve|\bFed\b/i.test(t) ||
        /加息概率|降息概率|年内.*按兵不动|预测市场.*利率/i.test(t)) &&
      /加息|降息|利率|policy rate|basis point|bps|货币政策|加息概率|降息概率|按兵不动/i.test(t),
  },
  {
    id: 'usEquityRiskOff',
    scope: 'global',
    magnitude: 78,
    narrative: '美股暴跌/熔断→全球去杠杆与现金为王→风险资产与大宗商品遭抛售',
    test: (t) =>
      /熔断|circuit breaker|trading halt|暴跌.*暂停/i.test(t) &&
      /标普|纳斯达克|道琼斯|美股|S&P|Nasdaq|Dow|华尔街|Wall Street/i.test(t),
  },
  {
    id: 'tradeGlobal',
    scope: 'global',
    magnitude: 70,
    narrative: '全面贸易战/大规模关税→全球贸易与大宗定价框架',
    test: (t) =>
      (/贸易战|trade war/i.test(t) || (/关税|tariff/i.test(t) && /全面|大规模|升级|加征/i.test(t))) &&
      !/临时禁止出口|海关商品编号/i.test(t),
  },
  {
    id: 'sanctionMetals',
    scope: 'sector',
    magnitude: 66,
    narrative: '针对性制裁/实体清单→有色跨境贸易与报价预期（板块级、置顶较久）',
    test: (t) =>
      /OFAC|外国资产控制|财政部.*制裁|实体清单|\[公告\].*制裁/i.test(t) ||
      (/sanction|制裁/i.test(t) && !/全面|大规模|系统性|贸易战/i.test(t)),
    suggestSectors: () => ['metals'],
    suggestSymbols: (t) => {
      const syms = new Set();
      if (/铜|copper/i.test(t)) syms.add('cu');
      if (/铝|aluminium|aluminum/i.test(t)) syms.add('al');
      if (/镍|nickel/i.test(t)) syms.add('ni');
      if (/锌|zinc/i.test(t)) syms.add('zn');
      if (!syms.size) ['cu', 'al', 'ni', 'zn'].forEach((s) => syms.add(s));
      return [...syms];
    },
  },
  {
    id: 'trade',
    scope: 'sector',
    magnitude: 56,
    narrative: '贸易救济/反倾销等→相关可交易品种进出口价差预期',
    test: (t) =>
      /反倾销|反补贴|保障措施|tariff/i.test(t) &&
      !/全面|大规模|贸易战|加征关税|OFAC|制裁|sanction/i.test(t) &&
      !/临时禁止出口|禁止出口管理|海关商品编号/i.test(t),
  },
  {
    id: 'commodityBalance',
    scope: 'sector',
    magnitude: 58,
    narrative: '供需平衡/库存/价差报告→品种或板块定价预期修正（中短期）',
    test: (t) =>
      /IEA|国际能源署|USDA|美国农业部|OPEC月报|EIA|期末库存|期末棉花|期末小麦|期末玉米|期末大豆|裂解价差|炼油利润|油需|库存.*预期|分析师预期|WASDE/i.test(t) ||
      (/花旗|高盛|摩根士丹利|瑞银|巴克莱/i.test(t) && /原油|布伦特|Brent|油价|农产品|植物油|玉米|大豆|棉花|糖/i.test(t)),
    suggestSymbols: (t) => {
      const syms = new Set();
      if (/棉花/i.test(t)) syms.add('CF');
      if (/玉米/i.test(t)) syms.add('c');
      if (/大豆|豆粕/i.test(t)) syms.add('m');
      if (/小麦/i.test(t)) syms.add('w');
      if (/原油|布伦特|石油|成品油|裂解/i.test(t)) ['sc', 'fu', 'lu', 'bu'].forEach((s) => syms.add(s));
      if (/植物油|棕榈/i.test(t)) syms.add('p');
      return [...syms];
    },
    suggestSectors: (t) => {
      const s = new Set();
      if (/原油|石油|成品油|裂解|炼油/i.test(t)) {
        s.add('energy');
        s.add('chemical');
      }
      if (/棉花|玉米|大豆|小麦|植物油|农产品|USDA|农业/i.test(t)) s.add('agriculture');
      return [...s];
    },
  },
  {
    id: 'agResearch',
    scope: 'sector',
    magnitude: 56,
    narrative: '机构农业/软商品研究→产区集中与贸易链预期→品种分化（中短期）',
    test: (t) =>
      /高盛|摩根|花旗|瑞银/i.test(t) &&
      /农业|植物油|化肥|农产品|厄尔尼诺|拉尼娜|生物燃料/i.test(t),
    suggestSectors: () => ['agriculture', 'chemical'],
    suggestSymbols: (t) => {
      const syms = new Set();
      if (/植物油|棕榈/i.test(t)) syms.add('p');
      if (/化肥|尿素/i.test(t)) syms.add('UR');
      return [...syms];
    },
  },
  {
    id: 'exportControl',
    scope: 'sector',
    magnitude: 62,
    narrative: '商务部等进出口管制→可交易品种国内/国际价差预期（中短期）',
    test: (t) => /临时禁止出口|禁止出口管理|暂停出口|出口禁令.*(品种|商品)|海关商品编号/i.test(t),
    suggestSymbols: (t) => detectCommodityTags(t).map((c) => normalizeCommodityId(c.id)),
    suggestSectors: (t) => {
      const syms = detectCommodityTags(t)
        .map((c) => normalizeCommodityId(c.id))
        .filter(isUserFocusSymbol);
      return [...new Set(syms.map(getFocusSector).filter((s) => s && s !== 'other'))];
    },
  },
  {
    id: 'reserveAccumulation',
    scope: 'sector',
    magnitude: 54,
    narrative: '官方储备变动→贵金属/能源战略配置预期→板块定价支撑',
    test: (t) => /黄金储备|增持黄金|gold reserve|储备.*增加.*盎司/i.test(t),
    suggestSectors: () => ['precious'],
    suggestSymbols: () => ['au'],
  },
  {
    id: 'weatherSupply',
    scope: 'sector',
    magnitude: 58,
    narrative: '极端气候/ENSO→产区单产与物流预期→农产品/软商品供需再平衡（品种分化）',
    test: (t) => /厄尔尼诺|拉尼娜|elnino|la nina|干旱|洪涝|霜冻|极端天气|拉尼娜|作物受损|减产|单产/i.test(t),
    suggestSymbols: (t) => {
      const syms = new Set();
      if (/东南亚|马来|印尼|泰国|干旱|棕榈/i.test(t)) syms.add('p');
      if (/橡胶|泰国|印尼/i.test(t)) syms.add('ru');
      if (/甘蔗|白糖|糖/i.test(t)) syms.add('SR');
      if (/巴西|南美|大豆|豆粕/i.test(t)) syms.add('m');
      if (/玉米|小麦|粮食/i.test(t)) {
        syms.add('c');
        syms.add('w');
      }
      if (!syms.size && /厄尔尼诺|拉尼娜|干旱|洪涝/i.test(t)) {
        ['p', 'ru', 'SR', 'm'].forEach((s) => syms.add(s));
      }
      return [...syms];
    },
    suggestSectors: () => ['agriculture', 'chemical'],
  },
  {
    id: 'sectorInvolution',
    scope: 'sector',
    magnitude: 62,
    narrative: '产能过剩/价格战/内卷→板块供需恶化与减产限价预期（须持续关注）',
    test: (t) =>
      /工业硅|硅业|多晶硅|硅价|光伏.*内卷|内卷.*(光伏|硅|产能)|产能过剩|价格战|放血.*内卷|硅业至暗|螺纹|钢铁|铁矿石|PTA|甲醇|乙二醇|氧化铝|电解铝|纯碱|玻璃/i.test(
        t
      ),
    suggestSymbols: (t) => {
      const syms = new Set();
      if (/工业硅|硅业|硅价|多晶硅/i.test(t)) syms.add('si');
      if (/碳酸锂|锂电/i.test(t)) syms.add('lc');
      if (/多晶硅/i.test(t)) syms.add('ps');
      if (/螺纹|钢铁/i.test(t)) syms.add('rb');
      if (/铁矿/i.test(t)) syms.add('i');
      if (/PTA|聚酯/i.test(t)) syms.add('ta');
      if (/甲醇/i.test(t)) syms.add('ma');
      if (/乙二醇/i.test(t)) syms.add('eg');
      if (/氧化铝/i.test(t)) syms.add('ao');
      if (/电解铝|沪铝/i.test(t)) syms.add('al');
      if (/纯碱|soda ash/i.test(t)) syms.add('sa');
      if (/玻璃/i.test(t)) syms.add('fg');
      if (!syms.size && /光伏/i.test(t)) {
        syms.add('si');
        syms.add('ps');
      }
      return filterToFocusSymbols([...syms, ...symbolsFromCommodityText(t)]);
    },
    suggestSectors: () => ['chemical'],
  },
  {
    id: 'sectorCrashRebound',
    scope: 'sector',
    magnitude: 64,
    narrative: '品种经历深跌→筑底/反弹与供给出清预期→低位须高度关注（无品种永远低位）',
    test: (t) => isCommodityCrashStory(t),
    suggestSymbols: (t) => symbolsFromCommodityText(t),
    suggestSectors: (t) => sectorsFromFocusSymbols(symbolsFromCommodityText(t)),
  },
  {
    id: 'antiInvolutionWatch',
    scope: 'sector',
    magnitude: 66,
    narrative: '反内卷/减产自律/产能出清→供给收缩与价格修复预期（须高度关注）',
    test: (t) => isAntiInvolutionWatch(t),
    suggestSymbols: (t) => {
      const fromText = symbolsFromCommodityText(t);
      if (fromText.length) return fromText;
      return filterToFocusSymbols([...REBOUND_WATCH_SYMBOL_IDS]);
    },
    suggestSectors: (t) => {
      const fromSyms = sectorsFromFocusSymbols(symbolsFromCommodityText(t));
      if (fromSyms.length) return fromSyms;
      return ['chemical', 'black', 'newenergy'];
    },
  },
  {
    id: 'policyDirect',
    scope: 'sector',
    magnitude: 62,
    narrative: '政府直接干预供需/价格预期→收储抛储、限产保供、进出口管制等传导至定价',
    test: (t) => /收储|抛储|临储|最低收购价|限价|稳价|保供|限产|停产|检修|反内卷|产能置换|环保督察/i.test(t),
  },
  {
    id: 'energySupply',
    scope: 'sector',
    magnitude: 60,
    narrative: '能源地缘/产量预期→原油天然气煤炭定价与化工成本曲线',
    test: (t) => /OPEC|原油|石油|天然气|LNG|煤炭|减产|增产|钻井|炼厂|油田/i.test(t),
    suggestSectors: () => ['energy', 'chemical'],
  },
  {
    id: 'metalSupply',
    scope: 'sector',
    magnitude: 55,
    narrative: '矿山/冶炼/库存预期→有色黑色供需与基差',
    test: (t) => /矿山|冶炼|电解|库存|LME|仓单|港口库存|铁矿石|铜矿|电解铜|沪铜|copper/i.test(t),
    suggestSymbols: (t) => {
      const syms = new Set(symbolsFromCommodityText(t));
      if (/铜|copper|电解铜|沪铜/i.test(t)) syms.add('cu');
      if (/铁矿石|铁矿/i.test(t)) syms.add('i');
      return filterToFocusSymbols([...syms]);
    },
    suggestSectors: (t) => sectorsFromFocusSymbols(symbolsFromCommodityText(t)) || ['metals', 'black'],
  },
  {
    id: 'marketWrap',
    scope: 'feed',
    magnitude: 22,
    narrative: '盘面/收盘综述→短时效交易情绪，实质预期变化有限',
    test: (t) =>
      /日报|日评|每日.*评述|收盘综述|盘面|期价.*日|mixed|choppy|有色金属日报|农产品日报|黑色日报|能化日报/i.test(t) ||
      (/期货|期商|期价/i.test(t) && /日报|日评|综述/i.test(t)),
  },
];

function filterToFocusSymbols(symbols = []) {
  return [...new Set(symbols.map((s) => normalizeCommodityId(s)).filter(isUserFocusSymbol))];
}

function sectorsFromFocusSymbols(symbols = []) {
  return [...new Set(symbols.map(getFocusSector).filter((s) => s && s !== 'other'))];
}

/** 仅当资讯能传导至用户关注品种池时才审查/归档 */
function evaluateTradeableScope(text, channelIds, rawTagSymbols, tradeableSymbols) {
  const exemptGlobal =
    channelIds.some((id) => GLOBAL_TIER_CHANNEL_IDS.has(id)) ||
    (channelIds.includes('trade') && /全面|大规模|贸易战|加征关税/i.test(text));
  if (exemptGlobal) return { inScope: true, reason: null };

  const mustMapSymbol =
    channelIds.includes('exportControl') ||
    channelIds.includes('policyDirect') ||
    (channelIds.includes('trade') && !/全面|大规模|贸易战|加征关税/i.test(text));

  if (mustMapSymbol) {
    if (tradeableSymbols.length === 0) {
      return { inScope: false, reason: '非可交易品种范围' };
    }
    return { inScope: true, reason: null };
  }

  if (channelIds.some((id) => SECTOR_MEDIUM_CHANNEL_IDS.has(id))) {
    if (tradeableSymbols.length > 0) return { inScope: true, reason: null };
    return { inScope: false, reason: '非可交易品种范围' };
  }

  if (channelIds.includes('marketWrap')) {
    return tradeableSymbols.length > 0
      ? { inScope: true, reason: null }
      : { inScope: false, reason: '非可交易品种范围' };
  }

  if (tradeableSymbols.length > 0) return { inScope: true, reason: null };
  if (rawTagSymbols.length > 0) {
    return { inScope: false, reason: '非可交易品种范围' };
  }
  return { inScope: false, reason: '非可交易品种范围' };
}

function detectTransmissionChannels(text) {
  const t = String(text || '');
  const hits = [];
  for (const ch of TRANSMISSION_CHANNELS) {
    if (!ch.test(t)) continue;
    hits.push({
      id: ch.id,
      scope: ch.scope,
      magnitude: ch.magnitude,
      narrative: ch.narrative,
      suggestedSymbols: ch.suggestSymbols?.(t) || [],
      suggestedSectors: ch.suggestSectors?.(t) || [],
    });
  }
  return hits;
}

function buildExpectationNarrative(channels, text) {
  if (!channels.length) return null;
  const primary = channels.sort((a, b) => b.magnitude - a.magnitude)[0];
  let climateNote = null;
  try {
    if (/厄尔尼诺|拉尼娜|干旱|洪涝|霜冻|极端天气/i.test(text)) {
      const { buildClimateAnalysis } = require('./climate-analyst');
      const ca = buildClimateAnalysis({ title: text.slice(0, 120), summary: text });
      climateNote = ca.impactLine;
    }
  } catch {
    // ignore
  }
  return {
    primary: primary.narrative,
    channels: channels.map((c) => ({ id: c.id, scope: c.scope, narrative: c.narrative })),
    climateNote,
    dataSource: 'focus-expectation-review',
  };
}

/**
 * 审查资讯对大宗市场的预期价值
 * @returns expectationMagnitude 即「质量」— 预期变化幅度 0-100
 */
function assessExpectationValue(text, item = {}, dim = null) {
  const t = String(text || '').trim();
  const tags = detectCommodityTags(t);
  const tagSymbols = tags.map((c) => String(c.id || '').toLowerCase());

  const channels = detectTransmissionChannels(t);
  let magnitude = channels.length ? Math.max(...channels.map((c) => c.magnitude)) : 6;

  const rawSuggestedSymbols = [
    ...new Set([
      ...channels.flatMap((c) => c.suggestedSymbols || []),
      ...tagSymbols,
      ...(item.symbols || []).map((s) => String(s).toLowerCase()),
    ]),
  ].filter(Boolean);
  const tradeableSymbols = filterToFocusSymbols(rawSuggestedSymbols);
  const tradeableSectors = sectorsFromFocusSymbols(tradeableSymbols);

  if (tradeableSymbols.length) magnitude += Math.min(12, tradeableSymbols.length * 3);
  if (tradeableSectors.length) magnitude += Math.min(8, tradeableSectors.length * 2);

  if (dim) {
    magnitude = Math.round(magnitude * 0.55 + (dim.compositeScore || 0) * 0.45);
    if (dim.govPolicy?.detected && dim.govPolicy.forceHits > 0) magnitude += 6;
    if (dim.isGlobalSystemic) magnitude = Math.max(magnitude, 62);
  }

  if (GENERIC_PLAN_REPLY_RE.test(t) && !channels.some((c) => c.id !== 'marketWrap')) {
    magnitude = Math.min(magnitude, 10);
  }
  for (const re of LOW_VALUE_ADMIN_RES) {
    if (re.test(t)) {
      magnitude = Math.min(magnitude, 8);
      break;
    }
  }

  const channelIds = channels.map((c) => c.id);
  const sourceQuality = assessNewsSourceQuality(item);
  if (sourceQuality.tier === 'noise') {
    magnitude = Math.min(magnitude, 12);
  } else if (sourceQuality.tier === 'trade' && channelIds.includes('marketWrap')) {
    magnitude = Math.min(magnitude, 32);
  } else if (sourceQuality.tier === 'official' || sourceQuality.tier === 'institutional') {
    magnitude = Math.min(100, magnitude + 5);
  } else if (sourceQuality.tier === 'aggregator' || sourceQuality.tier === 'unknown') {
    magnitude = Math.round(magnitude * 0.94);
  }

  magnitude = Math.round(Math.min(100, Math.max(0, magnitude)));
  if (
    channelIds.some((id) => HIGH_WATCH_CHANNEL_IDS.has(id)) &&
    tradeableSymbols.length > 0
  ) {
    magnitude = Math.max(magnitude, 50);
  }
  const combinedQuality = blendRankingScore(magnitude, sourceQuality.score);

  const primaryScope = channels.sort((a, b) => b.magnitude - a.magnitude)[0]?.scope || null;
  const narrative = buildExpectationNarrative(channels, t);
  const scope = evaluateTradeableScope(t, channelIds, tagSymbols, tradeableSymbols);

  const hasExpectationShift =
    magnitude >= 14 &&
    scope.inScope &&
    (channels.length > 0 || tradeableSymbols.length > 0) &&
    (tradeableSymbols.length > 0 ||
      channelIds.some((id) => GLOBAL_TIER_CHANNEL_IDS.has(id)) ||
      (channelIds.includes('trade') && /全面|大规模|贸易战|加征关税/i.test(t)));

  let rejectReason = null;
  if (isStabilizeTradeRhetoric(t)) {
    magnitude = Math.min(magnitude, 10);
    rejectReason = '稳外贸稳外资表述·无大宗定价预期';
  } else if (isNonUsEquityMarketNoise(t)) {
    magnitude = Math.min(magnitude, 6);
    rejectReason = '非美股指波动·对大宗框架影响有限';
  } else if (isEvSectorCommentary(t)) {
    magnitude = Math.min(magnitude, 12);
    rejectReason = '新能源车赛道评论·非大宗定价';
  } else if (isSectorCommentaryNoise(t)) {
    magnitude = Math.min(magnitude, 14);
    rejectReason = '行业评论/叙事稿·非定价事件';
  }

  if (!scope.inScope) {
    rejectReason = rejectReason || scope.reason;
  } else if (magnitude < 14) {
    rejectReason = channels.length ? '预期变化幅度不足' : '未形成可交易的大宗预期';
  } else if (GENERIC_PLAN_REPLY_RE.test(t) && magnitude < 20) {
    rejectReason = '政务规划批复·无定价预期';
  } else if (
    (channelIds.includes('exportControl') || channelIds.includes('policyDirect')) &&
    tradeableSymbols.length === 0
  ) {
    rejectReason = '非可交易品种范围';
  }

  const hasGlobalChannel = channelIds.some((id) => GLOBAL_TIER_CHANNEL_IDS.has(id));
  const eligibleGlobal =
    hasExpectationShift &&
    !rejectReason &&
    magnitude >= 58 &&
    hasGlobalChannel &&
    (() => {
      const dur = rankDurationKey(dim?.duration);
      const macroLiquidity =
        channelIds.includes('liquidity') ||
        channelIds.includes('fedRateOutlook') ||
        channelIds.includes('usEquityRiskOff');
      const meetsDur =
        dur >= rankDurationKey('cycle') ||
        (macroLiquidity && dur >= rankDurationKey('swing')) ||
        (channelIds.includes('riskOff') && dur >= rankDurationKey('swing'));
      return meetsDur && (dim?.width ?? 0) >= 72 && (dim?.breadth ?? 0) >= 55;
    })();

  const eligibleSector =
    hasExpectationShift &&
    magnitude >= 20 &&
    (() => {
      const dur = rankDurationKey(dim?.duration);
      if (dur >= 0 && dur < rankDurationKey('swing')) return false;
      return tradeableSymbols.length >= 1 || (dim?.breadth ?? 0) >= 28 || channelIds.length > 0;
    })();

  const eligibleFeed =
    hasExpectationShift &&
    magnitude >= 12 &&
    (channelIds.includes('marketWrap') ||
      rankDurationKey(dim?.duration) < rankDurationKey('swing') ||
      (!eligibleSector && !eligibleGlobal && magnitude < 32));

  const watch = resolveWatchPriority(channelIds, tradeableSymbols, t, magnitude);

  return {
    version: RELEVANCE_VERSION,
    expectationMagnitude: magnitude,
    quality: combinedQuality,
    score: combinedQuality,
    contentMagnitude: magnitude,
    sourceQuality,
    commodityRelevant: hasExpectationShift && !rejectReason,
    eligibleGlobal,
    eligibleSector,
    eligibleFeed,
    rejectReason,
    channels: channelIds,
    primaryScope,
    narrative,
    suggestedSymbols: tradeableSymbols,
    suggestedSectors: tradeableSectors,
    tradeableScope: scope.inScope,
    watchPriority: watch.watchPriority,
    watchReason: watch.watchReason,
    dataSource: 'focus-expectation-review',
  };
}

/** @deprecated 别名 — 内部统一走预期审查 */
function assessCommodityNewsRelevance(text, item = {}) {
  return assessExpectationValue(text, item, null);
}

function capTierByRelevance(tier, review, dim = null) {
  if (!tier || !review?.commodityRelevant) return null;

  const symCount = (review.suggestedSymbols || dim?.symbols || []).length;
  if (tier === 'global' && symCount > 0 && symCount <= GLOBAL_SYMBOL_CAP) {
    tier = 'sector';
  }

  const order = ['global', 'sector', 'symbol', 'feed'];
  const maxIdx = review.eligibleGlobal
    ? 0
    : review.eligibleSector
      ? 1
      : review.eligibleFeed
        ? 3
        : -1;
  if (maxIdx < 0) return null;
  const tierIdx = order.indexOf(tier);
  if (tierIdx < 0) return tier;
  if (tierIdx >= maxIdx) return tier;
  if (review.eligibleGlobal) return tier;
  if (review.eligibleSector) {
    if (tierIdx < 1) return 'sector';
    return tier;
  }
  if (review.eligibleFeed) {
    if (tierIdx < 3) return tier === 'symbol' ? 'symbol' : 'feed';
    return tier;
  }
  return null;
}

function passesRelevanceGate(tier, text, item = {}) {
  const rel = assessExpectationValue(text, item, item.impactDimensions || null);
  if (!rel.commodityRelevant) return false;
  if (tier === 'global') return rel.eligibleGlobal;
  if (tier === 'sector') return rel.eligibleSector;
  if (tier === 'symbol') return rel.eligibleSector || rel.eligibleFeed;
  if (tier === 'feed') return rel.eligibleFeed;
  return false;
}

module.exports = {
  RELEVANCE_VERSION,
  GLOBAL_TIER_CHANNEL_IDS,
  assessExpectationValue,
  assessCommodityNewsRelevance,
  capTierByRelevance,
  passesRelevanceGate,
  detectTransmissionChannels,
  isStabilizeTradeRhetoric,
  isNonUsEquityMarketNoise,
  isEvSectorCommentary,
  isSectorInvolutionStory,
  isSectorReboundWatchStory,
  isCommodityCrashStory,
  isAntiInvolutionWatch,
  HIGH_WATCH_CHANNEL_IDS,
  isSectorCommentaryNoise,
};
