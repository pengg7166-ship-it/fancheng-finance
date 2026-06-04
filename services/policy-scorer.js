const { getDepartmentById } = require('./policy-sources');
const { getUsDepartmentById } = require('./policy-us-sources');
const { detectPolicyTypes, detectCommodityTags, detectImpactDirection } = require('./policy-commodity-map');

const HIGH_IMPACT_WORDS_CN = [
  '国务院',
  '全国',
  '立即',
  '全面',
  '严禁',
  '禁止',
  '降准',
  '降息',
  '收储',
  '抛储',
  '产能',
  '出口配额',
  '关税',
  '期货',
  '监管规则',
  '管理办法',
  '调价',
  '限价',
  '总量',
];

const HIGH_IMPACT_WORDS_US = [
  'final rule',
  'emergency',
  'sanction',
  'sanctions',
  'tariff',
  'prohibition',
  'rate hike',
  'rate cut',
  'enforcement action',
  'penalty',
  'trading halt',
  'embargo',
  'quota',
  'reserve requirement',
  'Section 301',
  'Section 232',
  'OFAC',
  'position limit',
  'national emergency',
  'executive order',
  'Strategic Petroleum',
];

const MEDIUM_IMPACT_WORDS_CN = ['通知', '意见', '方案', '规划', '试点', '指导', '若干措施', '支持'];
const MEDIUM_IMPACT_WORDS_US = [
  'proposed rule',
  'notice',
  'guidance',
  'framework',
  'initiative',
  'rulemaking',
  'determination',
  'investigation',
  'preliminary',
];

const LOW_IMPACT_WORDS_CN = ['统计', '人事', '会议', '宣传', '解读', '答记者问', '活动'];
const LOW_IMPACT_WORDS_US = [
  'information collection',
  'appointment',
  'advisory committee',
  'advisory',
  'meeting notice',
  'comment request',
  'OMB review',
  'delegation of authority',
  'technical amendment',
  'public meeting',
  'hearing notice',
];

const POLICY_TYPE_LABELS = {
  monetary: '货币政策',
  industry: '产业政策',
  trade: '贸易政策',
  regulation: '监管政策',
  reserve: '收储抛储',
  environmental: '环保限产',
  price: '价格调控',
  general: '综合政策',
};

const DIRECTION_LABELS = {
  bullish: '偏多',
  bearish: '偏空',
  neutral: '中性',
};

const TIMING_LABELS = {
  immediate: '即时',
  short: '短期(1–4周)',
  medium: '中期(1–3月)',
  long: '长期',
};

function resolveDepartment(item) {
  if (item.region === 'us') return getUsDepartmentById(item.departmentId);
  return getDepartmentById(item.departmentId);
}

function clampStars(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function starsToHtml(stars) {
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function textMatchesAny(text, words) {
  const lower = text.toLowerCase();
  return words.some((w) => {
    const lw = w.toLowerCase();
    return lower.includes(lw) || text.includes(w);
  });
}

function detectTiming(text, stars, region) {
  if (/立即|自发布之日起|即日起|现予发布|effective immediately|immediate effect/i.test(text)) {
    return 'immediate';
  }
  if (stars >= 4 || /202\d年|202\d/.test(text)) return 'short';
  if (/规划|纲要|三年|五年|multi-year|five-year|long-term/i.test(text)) return 'long';
  if (region === 'us' && /final rule|enforcement|emergency/i.test(text)) return 'immediate';
  return 'medium';
}

function buildImpactSummary({ stars, direction, commodities, departmentName }) {
  const parts = [];
  if (departmentName) parts.push(departmentName);
  if (commodities.length) parts.push(`关联：${commodities.map((c) => c.name).join('、')}`);
  parts.push(`方向：${DIRECTION_LABELS[direction] || '中性'}`);
  if (stars >= 4) parts.push('可能显著影响定价或供需');
  else if (stars >= 3) parts.push('关注产业链边际变化');
  else if (stars <= 2) parts.push('信息参考为主');
  return parts.join(' · ');
}

function scorePolicyItem(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  const region = item.region || 'cn';
  const isUs = region === 'us';
  let score = isUs ? 2.2 : 2;

  const dept = resolveDepartment(item);
  if (dept?.weight) score += dept.weight * 0.4;

  const publishRe = isUs
    ? /adopt|issue|announce|publish|approve|implement|release/i
    : /印发|发布|公布|实施|印发/;
  if (publishRe.test(text)) score += 0.3;

  const highWords = isUs ? HIGH_IMPACT_WORDS_US : HIGH_IMPACT_WORDS_CN;
  const medWords = isUs ? MEDIUM_IMPACT_WORDS_US : MEDIUM_IMPACT_WORDS_CN;
  const lowWords = isUs ? LOW_IMPACT_WORDS_US : LOW_IMPACT_WORDS_CN;

  if (textMatchesAny(text, highWords)) score += 1.2;
  if (textMatchesAny(text, medWords)) score += 0.4;
  if (textMatchesAny(text, lowWords)) score -= 0.6;

  const draftRe = isUs
    ? /request for comment|advance notice|draft|preliminary|proposed rule/i
    : /征求意见|草案|听证|暂未/;
  if (draftRe.test(text)) score -= 0.8;

  const commodities = detectCommodityTags(text);
  if (commodities.length >= 3) score += 0.8;
  else if (commodities.length >= 1) score += 0.4;

  if (item.sourceId === 'gov-cn') score += 0.5;
  if (item.sourceId?.startsWith('fr-') && isUs) score += 0.4;
  if (item.sourceId === 'fed-press') score += 0.6;

  const stars = clampStars(score);
  const types = detectPolicyTypes(text);
  const direction = detectImpactDirection(text);
  const timing = detectTiming(text, stars, region);

  return {
    stars,
    starsLabel: starsToHtml(stars),
    policyTypes: types,
    policyTypeLabels: types.map((t) => POLICY_TYPE_LABELS[t] || t),
    commodities,
    direction,
    directionLabel: DIRECTION_LABELS[direction],
    timing,
    timingLabel: TIMING_LABELS[timing],
    impactSummary: buildImpactSummary({
      stars,
      direction,
      commodities,
      departmentName: dept?.shortName || item.departmentName,
    }),
  };
}

module.exports = {
  scorePolicyItem,
  starsToHtml,
  POLICY_TYPE_LABELS,
  DIRECTION_LABELS,
};
