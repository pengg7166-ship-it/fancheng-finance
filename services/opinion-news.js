/**
 * 阶段 C · 免费机构观点识别（不替代事实快讯/政策）
 */
const OPINION_VERSION = 'v1.56.3-opinion-free';

const OPINION_EXCLUDE_RE = /weibo\.com|@新浪期货|说出你的期货故事|点击关注|免责声明/i;

const OPINION_TITLE_RE =
  /周报|月报|半年报|年报|季度报告|日报|早报|晚评|早评|午评|晨会|策略报告|研报|研究：|研究:|机构观点|机构料|多机构料|展望|点评|调研报告|产业调研|平衡表|上市前瞻/i;

const BROKER_PREFIX_RE = /^[\u4e00-\u9fa5A-Za-z·（）]{2,16}期货[：:]/;

const INSTITUTION_OPINION_RE =
  /(花旗|高盛|摩根士丹利|摩根大通|瑞银|巴克莱|国泰君安|中信建投期货|中信期货|光大期货|永安期货|华泰期货|银河期货|南华期货|国投期货|方正中期|申万期货|东证期货|广发期货|Mysteel|我的钢铁|SMM|上海有色|隆众|卓创)/;

const BROKER_REGISTRY = [
  { id: 'citic-futures', name: '中信建投期货', score: 74, patterns: [/中信建投期货|中信期货/i] },
  { id: 'everbright-futures', name: '光大期货', score: 72, patterns: [/光大期货/i] },
  { id: 'gtja-futures', name: '国泰君安期货', score: 72, patterns: [/国泰君安期货|国君期货/i] },
  { id: 'yongan-futures', name: '永安期货', score: 70, patterns: [/永安期货/i] },
  { id: 'huatai-futures', name: '华泰期货', score: 70, patterns: [/华泰期货/i] },
  { id: 'mysteel', name: 'Mysteel', score: 68, patterns: [/Mysteel|我的钢铁/i] },
  { id: 'smm', name: '上海有色', score: 66, patterns: [/上海有色|SMM/i] },
  { id: 'zhongyu', name: '卓创资讯', score: 64, patterns: [/卓创资讯|隆众/i] },
];

const STOCK_ONLY_RE = /深成指|创业板指|创指|沪指|上证|深证|A股|医药板块|科技板块|创业板|沪深/;
const COMMODITY_HINT_RE =
  /期货|原油|铜|铝|钢|铁矿|农产品|生猪|豆粕|棕榈|纯碱|玻璃|甲醇|橡胶|黄金|白银|化工|黑色|有色|能化|大宗|商品|期权|油气|煤炭|铁矿|螺纹|热卷|焦煤|焦炭|棉花|白糖|化肥|磷肥/i;

function isOpinionTitle(title) {
  const t = String(title || '').trim();
  if (t.length < 10 || OPINION_EXCLUDE_RE.test(t)) return false;
  if (/午评|早评|开盘|收盘/.test(t) && STOCK_ONLY_RE.test(t) && !COMMODITY_HINT_RE.test(t)) return false;
  if (/^机构[：:]/.test(t) && !COMMODITY_HINT_RE.test(t)) return false;
  if (/利率债|债市|债券市场/.test(t) && !COMMODITY_HINT_RE.test(t)) return false;
  if (OPINION_TITLE_RE.test(t)) return true;
  if (BROKER_PREFIX_RE.test(t)) return true;
  if (INSTITUTION_OPINION_RE.test(t) && /认为|预计|预测|看空|看多|上调|下调|料|有望|承压|支撑/.test(t)) return true;
  return false;
}

function detectOpinionBroker(title, url = '') {
  const probe = `${title} ${url}`;
  for (const row of BROKER_REGISTRY) {
    if (row.patterns.some((re) => re.test(probe))) {
      return { id: row.id, name: row.name, score: row.score };
    }
  }
  const prefix = String(title || '').match(BROKER_PREFIX_RE);
  if (prefix) {
    return { id: 'broker-unknown', name: prefix[0].replace(/[：:]$/, ''), score: 62 };
  }
  return null;
}

function opinionRecencyScore(link) {
  const m = String(link || '').match(/\/(202\d)[-/]/);
  return m ? parseInt(m[1], 10) : 0;
}

function rankOpinionItems(items) {
  return [...items].sort((a, b) => opinionRecencyScore(b.link) - opinionRecencyScore(a.link));
}

module.exports = {
  OPINION_VERSION,
  OPINION_EXCLUDE_RE,
  isOpinionTitle,
  detectOpinionBroker,
  opinionRecencyScore,
  rankOpinionItems,
  BROKER_REGISTRY,
};
