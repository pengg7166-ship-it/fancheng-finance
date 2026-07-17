/**
 * 机构观点 · 论点充分 / 逻辑完整 门禁（阶段 C 中等策略）
 */
const { detectOpinionBroker } = require('./opinion-news');
const { detectCommodityTags } = require('./policy-commodity-map');

const OPINION_LOGIC_VERSION = 'v1.56.4-opinion-logic';

const COMMODITY_HINT_RE =
  /期货|原油|铜|铝|钢|铁矿|农产品|生猪|豆粕|棕榈|纯碱|玻璃|甲醇|橡胶|黄金|白银|化工|黑色|有色|能化|大宗|商品|螺纹|热卷|焦煤|焦炭|棉花|白糖|化肥|油气|煤炭|镍|锌|铅|锡|工业硅|碳酸锂|多晶硅/i;

const CAUSAL_RE = /因为|由于|鉴于|在.+背景下|因此|所以|驱动|逻辑|主因|供需|库存|基差|价差|利润|开工|到港|出口|进口|减产|限产|天气|地缘|美联储|OPEC/i;
const DIRECTION_RE = /看多|看空|偏多|偏空|上涨|下跌|承压|支撑|震荡|区间|目标价|上调|下调|走强|走弱|反弹|回落|高位|低位/;
const EVIDENCE_RE = /库存|产量|开工率|港口|表观|持仓|仓单|\d+%|\d+万|\d+亿|万吨|桶\/日|美元\/吨|元\/吨/;
const HYPE_PENALTY_RE = /必涨|稳赚|满仓|梭哈|翻倍|暴涨暴跌|兰博/;

function isBrokerDailyTitle(title) {
  return /日报|周报|早报|晚评|晨会|午评|点评/.test(String(title || ''));
}

/**
 * @param {string} text title + summary
 * @param {{ title?: string, url?: string, brokerDaily?: boolean, knownBroker?: boolean }} meta
 */
function assessOpinionLogic(text, meta = {}) {
  const t = String(text || '');
  const title = String(meta.title || t.slice(0, 120));
  const broker = detectOpinionBroker(title, meta.url || '');
  const brokerDaily = meta.brokerDaily ?? isBrokerDailyTitle(title);
  const knownBroker = meta.knownBroker ?? Boolean(broker && broker.id !== 'broker-unknown');
  const tags = detectCommodityTags(t);

  const checks = [];
  let score = 0;

  if (COMMODITY_HINT_RE.test(t) || tags.length > 0) {
    score += 22;
    checks.push('品种锚定');
  }
  if (DIRECTION_RE.test(t)) {
    score += 18;
    checks.push('方向判断');
  }
  if (CAUSAL_RE.test(t)) {
    score += 22;
    checks.push('因果逻辑');
  }
  if (EVIDENCE_RE.test(t)) {
    score += 16;
    checks.push('数据支撑');
  }
  if (brokerDaily && knownBroker) {
    score += 14;
    checks.push('期货公司日报');
  } else if (knownBroker) {
    score += 8;
    checks.push('具名机构');
  }
  if (t.length >= 80) {
    score += 6;
    checks.push('论述篇幅');
  }
  if (HYPE_PENALTY_RE.test(t)) {
    score -= 35;
    checks.push('煽动性用语');
  }
  if (brokerDaily && !knownBroker) {
    score -= 8;
    checks.push('日报但未识别机构');
  }

  const hasAnchor = checks.includes('品种锚定');
  const hasReasoning = checks.includes('因果逻辑') || checks.includes('数据支撑');
  const hasDirection = checks.includes('方向判断');
  const sufficient =
    score >= 50 && hasAnchor && hasReasoning && (hasDirection || brokerDaily);

  const logicChain = [];
  if (hasAnchor) logicChain.push(`品种:${tags.map((x) => x.id).slice(0, 4).join('/') || '大宗'}`);
  if (checks.includes('因果逻辑')) logicChain.push('因果');
  if (checks.includes('数据支撑')) logicChain.push('数据');
  if (hasDirection) logicChain.push('方向');
  if (brokerDaily) logicChain.push('日报');

  return {
    version: OPINION_LOGIC_VERSION,
    sufficient,
    score: Math.max(0, Math.min(100, score)),
    checks,
    logicChain: logicChain.join(' → ') || '—',
    broker: broker?.name || null,
    brokerDaily,
    knownBroker,
    commodityTags: tags.map((x) => x.id),
  };
}

/** 中等策略：期货公司日报 + 逻辑充分 → 可进 ②；转载投行观点需更高门槛 */
function opinionSectorEligible(logic, magnitude = 0) {
  if (!logic?.sufficient) return false;
  if (logic.brokerDaily && logic.knownBroker) return magnitude >= 38;
  if (logic.knownBroker) return magnitude >= 48;
  return magnitude >= 54;
}

module.exports = {
  OPINION_LOGIC_VERSION,
  assessOpinionLogic,
  opinionSectorEligible,
  isBrokerDailyTitle,
};
