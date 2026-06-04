/**
 * 财经英文标题离线中文化（不依赖 Google 等境外翻译 API）
 */
const { translateRegulatoryTitleLocal, isAcceptableChinese, latinWordCount } = require('./policy-en-zh-dict');

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'and', 'or', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'its', 'it', 'this', 'that', 'these',
  'those', 'from', 'into', 'through', 'during', 'before', 'after', 'over', 'under', 'again', 's',
  't', 're', 've', 'll', 'd', 'm', 'amid', 'amidst', 'while', 'than', 'but', 'not', 'no', 'so', 'if',
  'about', 'up', 'down', 'out', 'off', 'new', 'more', 'most', 'also', 'just', 'still', 'even',
]);

const PHRASES = [
  ['Wall Street futures', '华尔街期货'],
  ['Wall Street', '华尔街'],
  ['OPEC', '欧佩克'],
  ['rate cut', '降息'],
  ['rate cuts', '降息'],
  ['rate hike', '加息'],
  ['rate hikes', '加息'],
  ['cuts output', '削减产量'],
  ['cut output', '削减产量'],
  ['record high', '纪录新高'],
  ['record low', '纪录新低'],
  ['China demand', '中国需求'],
  ['stimulus hopes', '刺激政策预期'],
  ['stimulus plan', '刺激计划'],
  ['dollar strengthens', '美元走强'],
  ['dollar weakens', '美元走弱'],
  ['crude oil', '原油'],
  ['natural gas', '天然气'],
  ['interest rates', '利率'],
  ['monetary policy', '货币政策'],
  ['supply chain', '供应链'],
  ['Middle East', '中东'],
  ['United States', '美国'],
  ['European Union', '欧盟'],
  ['New York', '纽约'],
  ['Hong Kong', '香港'],
  ['South Korea', '韩国'],
  ['Saudi Arabia', '沙特阿拉伯'],
];

const WORDS = {
  oil: '原油', gas: '天然气', gold: '黄金', silver: '白银', copper: '铜', iron: '铁矿石', steel: '钢铁',
  corn: '玉米', wheat: '小麦', soybean: '大豆', soybeans: '大豆', rice: '大米', cotton: '棉花',
  sugar: '糖', coffee: '咖啡', cocoa: '可可', rubber: '橡胶', palm: '棕榈', lithium: '锂',
  platinum: '铂金', palladium: '钯金', nickel: '镍', zinc: '锌', aluminum: '铝', aluminium: '铝',
  tin: '锡', lead: '铅', coal: '煤炭', uranium: '铀', wheat: '小麦', barley: '大麦',
  prices: '价格', price: '价格', market: '市场', markets: '市场', futures: '期货', future: '期货',
  stocks: '股票', stock: '股票', shares: '股份', bond: '债券', bonds: '债券', yields: '收益率',
  yield: '收益率', dollar: '美元', euro: '欧元', yen: '日元', yuan: '人民币', pound: '英镑',
  inflation: '通胀', recession: '衰退', growth: '增长', economy: '经济', economic: '经济',
  demand: '需求', supply: '供应', output: '产量', production: '生产', export: '出口', imports: '进口',
  import: '进口', exports: '出口', trade: '贸易', tariff: '关税', tariffs: '关税', sanctions: '制裁',
  war: '战争', conflict: '冲突', crisis: '危机', risk: '风险', risks: '风险', hedge: '对冲',
  investors: '投资者', investor: '投资者', traders: '交易员', trader: '交易员', analyst: '分析师',
  analysts: '分析师', bank: '银行', banks: '银行', central: '中央', reserve: '储备', reserves: '储备',
  cut: '削减', cuts: '削减',
  decision: '决定', meeting: '会议', minutes: '会议纪要', speech: '讲话', statement: '声明',
  report: '报告', data: '数据', forecast: '预测', outlook: '展望', warning: '警告', alert: '警报',
  record: '纪录', high: '高位', highs: '高位', low: '低位', lows: '低位', peak: '峰值', bottom: '底部',
  rise: '上涨', rises: '上涨', rising: '上涨', climb: '攀升', climbs: '攀升', climbing: '攀升',
  surge: '飙升', surges: '飙升', surging: '飙升', jump: '跳涨', jumps: '跳涨', gain: '上涨', gains: '上涨',
  rally: '反弹', rallies: '反弹', rebound: '反弹', rebounding: '反弹', recover: '复苏', recovery: '复苏',
  fall: '下跌', falls: '下跌', falling: '下跌', drop: '下跌', drops: '下跌', dropping: '下跌',
  slide: '下滑', slides: '下滑', slump: '暴跌', slumps: '暴跌', plunge: ' plunge', plunges: ' plunge',
  tumble: '重挫', tumbles: '重挫', sink: '下挫', sinks: '下挫', weaken: '走弱', weakens: '走弱',
  strengthen: '走强', strengthens: '走强', steady: '持稳', stabilize: '企稳', stabilizes: '企稳',
  volatile: '波动', volatility: '波动性', uncertainty: '不确定性', concern: '担忧', concerns: '担忧',
  worry: '忧虑', worries: '忧虑', fear: '担忧', fears: '担忧', hope: '希望', hopes: '希望',
  boost: '提振', boosts: '提振', pressure: '压力', pressures: '压力', support: '支撑', supports: '支撑',
  hit: '触及', hits: '触及', reach: '达到', reaches: '达到', top: '登顶', tops: '登顶',
  break: '突破', breaks: '突破', breach: '突破', breaches: '突破', test: '测试', tests: '测试',
  first: '首次', second: '第二', third: '第三', latest: '最新', today: '今日', week: '周',
  month: '月', year: '年', quarter: '季度', daily: '日内', weekly: '周度', monthly: '月度',
  global: '全球', world: '世界', international: '国际', overseas: '海外', foreign: '海外',
  china: '中国', chinese: '中国', us: '美国', usa: '美国', american: '美国', europe: '欧洲',
  european: '欧洲', japan: '日本', japanese: '日本', korea: '韩国', india: '印度', russia: '俄罗斯',
  middle: '中东', east: '东', west: '西', asia: '亚洲', gulf: '海湾',
  wall: '华尔街', street: '街', tech: '科技', energy: '能源', mining: '矿业', agriculture: '农业',
  sector: '板块', sectors: '板块', industry: '行业', company: '公司', companies: '公司',
  earnings: '盈利', profit: '利润', profits: '利润', revenue: '营收', loss: '亏损', losses: '亏损',
  debt: '债务', default: '违约', bankruptcy: '破产', merger: '合并', acquisition: '收购',
  deal: '交易', deals: '交易', contract: '合约', contracts: '合约', shipment: '装运', shipments: '装运',
  inventory: '库存', inventories: '库存', stockpile: '储备', stockpiles: '储备', warehouse: '仓库',
  refinery: '炼厂', refineries: '炼厂', pipeline: '管道', drilling: '钻井', rig: '钻井平台',
  opec: '欧佩克', fed: '美联储', fomc: 'FOMC', ecb: '欧央行', boj: '日本央行', pboc: '央行',
  lme: 'LME', comex: 'COMEX', nymex: 'NYMEX', cboe: 'CBOE', sec: 'SEC', cftc: 'CFTC',
  brent: '布伦特', wti: 'WTI', crude: '原油', barrel: '桶', barrels: '桶', ton: '吨', tons: '吨',
  tonnage: '吨位', tonne: '吨', tonnes: '吨', ounce: '盎司', ounces: '盎司', gram: '克',
  stimulus: '刺激', stimulus: '刺激政策', policy: '政策', policies: '政策', reform: '改革',
  election: '选举', vote: '投票', government: '政府', congress: '国会', senate: '参议院',
  president: '总统', minister: '部长', official: '官员', officials: '官员', leader: '领导人',
  talks: '谈判', talk: '谈判', summit: '峰会', agreement: '协议', pact: '协议', deal: '协议',
  ceasefire: '停火', strike: '罢工', strikes: '罢工', protest: '抗议', protests: '抗议',
  weather: '天气', drought: '干旱', flood: '洪水', hurricane: '飓风', storm: '风暴',
  harvest: ' harvest', planting: '种植', crop: '作物', crops: '作物', livestock: '畜牧',
  hog: '生猪', hogs: '生猪', cattle: ' cattle', pork: '猪肉', beef: '牛肉', chicken: '鸡肉',
  closes: '关闭', close: '关闭', closed: '关闭', open: ' open', opens: ' open', hire: '招聘',
  hires: '招聘', fire: '解雇', fires: '解雇', appoint: '任命', appoints: '任命', resign: '辞职',
  resigns: '辞职', announce: '宣布', announces: '宣布', warn: '警告', warns: '警告',
  expect: '预期', expects: '预期', expected: '预期', forecast: '预测', forecasts: '预测',
  predict: '预测', predicts: '预测', estimate: '估计', estimates: '估计', show: '显示', shows: '显示',
  signal: ' signal', signals: ' signal', suggest: '暗示', suggests: '暗示', indicate: '表明',
  indicates: '表明', remain: '维持', remains: '维持', continue: '继续', continues: '继续',
  extend: '延长', extends: '延长', expand: '扩大', expands: '扩大', shrink: '收缩', shrinks: '收缩',
  slow: '放缓', slows: '放缓', accelerate: '加速', accelerates: '加速', rebound: '反弹',
  stimulus: '刺激', liquidity: '流动性', tightening: '收紧', easing: '宽松', pivot: '转向',
  pivoting: '转向', pause: '暂停', pauses: '暂停', hold: '按兵不动', unchanged: '不变',
  unchanged: '持平', flat: '持平', mixed: '涨跌互现', bullish: '看涨', bearish: '看跌',
  neutral: '中性', optimistic: '乐观', pessimistic: '悲观', cautious: '谨慎', aggressive: '激进',
  polymarket: 'Polymarket', bitcoin: '比特币', crypto: '加密', cryptocurrency: '加密货币',
  ethereum: '以太坊', blockchain: '区块链', ai: 'AI', chip: '芯片', chips: '芯片',
  semiconductor: '半导体', semiconductors: '半导体', ev: '电动车', vehicle: '汽车', vehicles: '汽车',
  housing: '住房', home: ' home', homes: ' homes', mortgage: ' mortgage', mortgages: ' mortgages',
  retail: '零售', consumer: '消费', consumption: '消费', spending: '支出', sentiment: ' sentiment',
  confidence: '信心', index: '指数', indices: '指数', gauge: ' gauge', gauges: ' gauges',
  benchmark: ' benchmark', benchmarks: ' benchmarks', contract: '合约', settlement: ' settlement',
  expiration: '到期', expiry: '到期', roll: '换月', rollover: '换月', margin: '保证金',
  liquidation: ' liquidation', liquidations: ' liquidations', short: '空头', long: '多头',
  position: '持仓', positions: '持仓', limit: '限制', limits: '限制', ban: '禁令', bans: '禁令',
  embargo: '禁运', quota: '配额', quotas: '配额', subsidy: '补贴', subsidies: '补贴',
  makes: '宣布', make: '宣布',
  since: '以来', after: '之后', before: '之前', amid: '在…背景下', despite: '尽管',
  ahead: ' ahead', behind: ' behind', into: ' into', onto: ' onto', versus: ' vs ', vs: ' vs ',
  bet: ' bet', bets: ' bets', betting: ' betting', poll: ' poll', polls: ' polls',
};

const TEMPLATES = [
  {
    re: /^(.+?) (?:rises?|climbs?|surges?|jumps?|gains?|rallies?|rebounds?) (?:on|as|after|amid|following|despite) (.+)$/i,
    fn: (m) => `${translateWords(m[1])}因${translateWords(m[2])}而上涨`,
  },
  {
    re: /^(.+?) (?:falls?|drops?|slides?|slumps?|tumbles?|sinks?|weakens?) (?:on|as|after|amid|following|despite) (.+)$/i,
    fn: (m) => `${translateWords(m[1])}因${translateWords(m[2])}而下跌`,
  },
  {
    re: /^(.+?) hits? (?:a )?record (high|low) on (.+)$/i,
    fn: (m) => `${translateWords(m[1])}因${translateWords(m[3])}创纪录${m[2].toLowerCase() === 'high' ? '新高' : '新低'}`,
  },
  {
    re: /^Fed(?:eral Reserve)? makes first rate cut since (.+)$/i,
    fn: (m) => `美联储自${translateWords(m[1])}以来首次降息`,
  },
  {
    re: /^(.+?) hits? (?:a )?record (high|low)$/i,
    fn: (m) => `${translateWords(m[1])}创纪录${m[2].toLowerCase() === 'high' ? '新高' : '新低'}`,
  },
  {
    re: /^(.+?) (?:rises?|climbs?|surges?|jumps?|gains?) to (.+)$/i,
    fn: (m) => `${translateWords(m[1])}上涨至${translateWords(m[2])}`,
  },
  {
    re: /^(.+?) (?:falls?|drops?|slides?) to (.+)$/i,
    fn: (m) => `${translateWords(m[1])}下跌至${translateWords(m[2])}`,
  },
  {
    re: /^Fed(?:eral Reserve)? (.+)$/i,
    fn: (m) => `美联储${translateWords(m[1])}`,
  },
  {
    re: /^(.+?) (?:set|sets) (?:to )?(.+)$/i,
    fn: (m) => `${translateWords(m[1])}${translateWords(m[2])}`,
  },
  {
    re: /^(.+?): (.+)$/,
    fn: (m) => `${translateWords(m[1])}：${translateWords(m[2])}`,
  },
  {
    re: /^(.+?) - (.+)$/,
    fn: (m) => `${translateWords(m[1])} — ${translateWords(m[2])}`,
  },
];

function isMostlyEnglish(text) {
  if (!text) return false;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin > 4 && latin > cjk;
}

const ACRONYM_ZH = {
  OPEC: '欧佩克',
};

function translateToken(word) {
  const lower = word.toLowerCase().replace(/['']/g, '');
  if (!lower || STOP_WORDS.has(lower)) return '';
  if (/^\d+([.,]\d+)?%?$/.test(lower)) return word.replace(/%$/, '%');
  if (ACRONYM_ZH[word]) return ACRONYM_ZH[word];
  if (WORDS[lower]) return WORDS[lower];
  if (/^[A-Z]{2,6}$/.test(word)) return word;
  return '';
}

function applyPhrases(text) {
  let out = String(text || '');
  for (const [en, zh] of PHRASES) {
    out = out.replace(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), zh);
  }
  return out;
}

function translateWords(text) {
  const raw = applyPhrases(String(text || '').trim());
  if (!raw) return '';
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;

  const parts = raw.split(/(\s+|\/|,|&)/).filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (/^[\s,/,&]+$/.test(part)) continue;
    const zh = translateToken(part);
    if (zh) out.push(zh);
  }
  return out.join('') || raw;
}

function applyTemplates(text) {
  const trimmed = String(text || '').trim();
  for (const { re, fn } of TEMPLATES) {
    const m = trimmed.match(re);
    if (m) {
      const result = fn(m).replace(/\s+/g, '').trim();
      if (isAcceptableChinese(result)) return result;
    }
  }
  return null;
}

function translateFinanceHeadline(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (!isMostlyEnglish(trimmed)) return trimmed;

  const templated = applyTemplates(trimmed);
  if (templated && isAcceptableChinese(templated)) return templated;

  const regulatory = translateRegulatoryTitleLocal(trimmed);
  if (isAcceptableChinese(regulatory)) return regulatory;

  const wordByWord = translateWords(trimmed);
  if (isAcceptableChinese(wordByWord)) return wordByWord;

  const hybrid = `${translateWords(trimmed.split(/\s+/).slice(0, 8).join(' '))}`;
  if (hybrid && /[\u4e00-\u9fff]/.test(hybrid)) {
    const rest = latinWordCount(trimmed) > 3 ? '等国际市场动态' : '';
    return `${hybrid}${rest}`;
  }

  return `国际财经：${trimmed.slice(0, 60)}`;
}

module.exports = {
  translateFinanceHeadline,
  translateWords,
  isMostlyEnglish,
};
