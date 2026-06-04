const MONETARY_KEYWORDS = [
  'monetary policy',
  'interest rate',
  'policy rate',
  'federal funds',
  'inflation',
  'price stability',
  'quantitative',
  'tightening',
  'easing',
  'balance sheet',
  'financial conditions',
  'dual mandate',
  'labor market',
  'economic outlook',
  'economic activity',
  '物价',
  '货币政策',
  '利率',
  '通胀',
  '金融政策',
  '经济展望',
  '经济活动',
];

const FX_KEYWORDS = [
  'exchange rate',
  'foreign exchange',
  'currency',
  'dollar',
  'yen',
  'forex',
  'international',
  'global economic',
  '汇率',
  '日元',
  '外汇',
  '国际',
];

const FED_OFFICIAL_WEIGHT = [
  { pattern: /\bpowell\b/i, weight: 5, name: '鲍威尔（主席）' },
  { pattern: /\b(jefferson|philip)\b/i, weight: 4, name: '杰斐逊（副主席）' },
  { pattern: /\b(bowman|michelle)\b/i, weight: 4, name: '鲍曼（理事）' },
  { pattern: /\b(barr|michael s\.?\s*barr)\b/i, weight: 4, name: '巴尔（副主席）' },
  { pattern: /\b(waller|christopher)\b/i, weight: 3, name: '沃勒（理事）' },
  { pattern: /\b(lisa cook|\bcook,)\b/i, weight: 3, name: '库克（理事）' },
  { pattern: /\b(kugler|adriana)\b/i, weight: 3, name: '库格勒' },
  { pattern: /\b(williams|john)\b/i, weight: 3, name: '威廉姆斯' },
  { pattern: /\b(barkin|thomas)\b/i, weight: 3, name: '巴尔金' },
  { pattern: /\b(bostic|raphael)\b/i, weight: 3, name: '博斯蒂克' },
  { pattern: /\b(daly|mary)\b/i, weight: 3, name: '戴利' },
  { pattern: /\b(logan|lorie)\b/i, weight: 3, name: '洛根' },
  { pattern: /\b(goolsbee|austin)\b/i, weight: 3, name: '古尔斯比' },
  { pattern: /\b(hammack|beth)\b/i, weight: 3, name: '哈马克' },
  { pattern: /\b(kashkari|neel)\b/i, weight: 3, name: '卡什卡利' },
  { pattern: /\b(musalem|alberto)\b/i, weight: 3, name: '穆萨莱姆' },
  { pattern: /\b(schmid|jeffrey)\b/i, weight: 3, name: '施密德' },
  { pattern: /\b(cook|collins|susan)\b/i, weight: 3, name: '柯林斯（主席）' },
];

const BOJ_OFFICIAL_WEIGHT = [
  { pattern: /ueda|植田|行长|governor/i, weight: 5, name: '植田和男' },
  { pattern: /himino|冰见|副行长|deputy governor/i, weight: 4, name: '冰见亮三' },
  { pattern: /koeda|小手|policy board/i, weight: 3, name: '小手保充' },
  { pattern: /tamura|田村/i, weight: 3, name: '田村直树' },
  { pattern: /kamiyama|神田|executive director/i, weight: 3, name: '神田真之' },
  { pattern: /policy board|政策委员会/i, weight: 3, name: '政策委员' },
];

const CEREMONIAL_RE =
  /profile in courage|award ceremony|acceptance remarks|memorial|commencement|greeting only|photo/i;

function clampStars(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function textMatchesAny(text, words) {
  const lower = String(text || '').toLowerCase();
  return words.some((w) => {
    const lw = w.toLowerCase();
    return lower.includes(lw) || String(text).includes(w);
  });
}

function detectTopics(text) {
  const monetary = textMatchesAny(text, MONETARY_KEYWORDS);
  const fx = textMatchesAny(text, FX_KEYWORDS);
  const labels = [];
  if (monetary) labels.push('货币政策');
  if (fx) labels.push('汇率');
  if (!labels.length) labels.push('政策沟通');
  return { monetary, fx, labels };
}

function resolveOfficialWeight(bank, text, officialHint = '') {
  const probe = `${officialHint} ${text}`.trim();
  const rules = bank === 'boj' ? BOJ_OFFICIAL_WEIGHT : FED_OFFICIAL_WEIGHT;
  for (const rule of rules) {
    if (rule.pattern.test(probe)) {
      return { weight: rule.weight, officialName: rule.name };
    }
  }
  return { weight: bank === 'boj' ? 2 : 2, officialName: '' };
}

function contentBoost(text, topics) {
  let boost = 0;
  if (topics.monetary) boost += 0.6;
  if (topics.fx) boost += 0.5;
  if (/outlook|statement|testimony|hearing|press conference|展望|声明|听证会/i.test(text)) boost += 0.4;
  if (/rate hike|rate cut|加息|降息|yield curve|缩表|扩表/i.test(text)) boost += 0.5;
  if (CEREMONIAL_RE.test(text)) boost -= 1.2;
  return boost;
}

function impactHint(stars, topics) {
  if (stars >= 5) return topics.fx ? '高层表态 · 或显著影响汇率预期' : '高层表态 · 或显著影响利率路径';
  if (stars >= 4) return '重要官员 · 关注政策信号';
  if (stars >= 3) return '政策沟通 · 边际参考';
  return '信息参考';
}

function scoreCbSpeech(item, bank = 'fed') {
  const text = `${item.title || ''} ${item.summary || ''}`;
  const topics = detectTopics(`${text} ${item.official || ''}`);
  const { weight, officialName } = resolveOfficialWeight(bank, text, item.official || '');

  let score = weight + contentBoost(text, topics);
  if (item.official && !officialName) {
    score += 0.2;
  }

  const stars = clampStars(score);
  const topicLabel = topics.labels.join(' · ');

  return {
    ...item,
    stars,
    topicLabel,
    topics: topics.labels,
    impactHint: impactHint(stars, topics),
    officialDisplay: officialName || item.official || (bank === 'boj' ? '日本央行官员' : '美联储官员'),
  };
}

function isRelevantCbSpeech(item, bank = 'fed') {
  const text = `${item.official || ''} ${item.title || ''} ${item.summary || ''}`;
  const topics = detectTopics(text);
  if (CEREMONIAL_RE.test(text) && !topics.monetary && !topics.fx) return false;
  if (topics.monetary || topics.fx) return true;

  const speechRe =
    bank === 'boj'
      ? /speech|remarks|opening|testimony|讲话|演讲|致辞|statement on monetary|economic activity|货币政策/i
      : /speech|remarks|testimony|hearing|monetary|economic|inflation|policy|outlook/i;

  if (!speechRe.test(text)) return false;

  const { weight } = resolveOfficialWeight(bank, text);
  return weight >= 3;
}

module.exports = {
  scoreCbSpeech,
  isRelevantCbSpeech,
  detectTopics,
  clampStars,
};
