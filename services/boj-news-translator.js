const {
  translateRegulatoryTitleLocal,
  isAcceptableChinese,
  cjkCount,
  latinWordCount,
} = require('./policy-en-zh-dict');

/** 日本央行新闻标题 — 完整句映射（最长优先） */
const BOJ_EXACT_TITLES = [
  [
    'Opening Remarks at the 2026 BOJ-IMES Conference Hosted by the Institute for Monetary and Economic Studies, Bank of Japan',
    '2026年日本央行-IMES会议开幕致辞（金融研究所主办）',
  ],
  [
    '"Economic Activity, Prices, and Monetary Policy in Japan" (Speech at a Meeting with Local Leaders in Fukuoka)',
    '「日本的经济活动、物价与货币政策」地方领导人会议演讲（福冈）',
  ],
  [
    '"Singleness of Money and the Role of Central Banks" (Speech at the Japan Society of Monetary Economics)',
    '「货币单一性与中央银行的作用」日本货币经济学会演讲',
  ],
  [
    "'Economic Activity, Prices, and Monetary Policy in Japan' (Speech at a Meeting with Local Leaders in Fukuoka)",
    '「日本的经济活动、物价与货币政策」地方领导人会议演讲（福冈）',
  ],
  [
    "'Singleness of Money and the Role of Central Banks' (Speech at the Japan Society of Monetary Economics)",
    '「货币单一性与中央银行的作用」日本货币经济学会演讲',
  ],
  [
    "Remarks by Executive Director KAMIYAMA at the AIMA Japan Annual Forum 2026 on May 14 (Promoting the Evolution and Stability of Japan's Financial System)",
    '执行理事神田真之在 AIMA 日本年度论坛演讲（2026年5月14日）：推动日本金融体系演进与稳定',
  ],
  [
    '(IMES Newsletter) 2026 BOK/ERI - BOJ/IMES Joint Research Workshop',
    '（IMES 通讯）2026年韩国银行/经济研究院 — 日本央行/IMES 联合研究研讨会',
  ],
  [
    'Call for Papers: 8th Conference on Nontraditional Data, Machine Learning, and Natural Language Processing in Macroeconomics (ECONDAT 2026 Fall Meeting)',
    '征文通知：第八届宏观经济学非传统数据、机器学习与自然语言处理会议（ECONDAT 2026 秋季会议）',
  ],
  [
    'Opening Remarks by Executive Director KAMIYAMA at the 10th Meeting of the Liaison and Coordination Committee on Central Bank Digital Currency on February 2, 2026 (Points Forming Lines, Evolving to Surfaces)',
    '执行理事神田真之在央行数字货币联络协调委员会第十次会议开幕致辞（2026年2月2日）',
  ],
  [
    '(IMES Newsletter) 2025 BOJ-IMES Finance Workshop',
    '（IMES 通讯）2025年日本央行-IMES 金融研讨会',
  ],
];

/** 日本央行 — 短语/术语 */
const BOJ_PHRASES = [
  ['Statement on Monetary Policy', '货币政策声明'],
  ['Outlook for Economic Activity and Prices', '经济活动和物价展望'],
  ['Opening Remarks at the', '开幕致辞：'],
  ['Opening Remarks by Executive Director', '执行理事开幕致辞：'],
  ['Opening Remarks by', '开幕致辞：'],
  ['Opening Remarks', '开幕致辞'],
  ['Remarks by Executive Director', '执行理事讲话：'],
  ['Remarks by', '讲话：'],
  ['Speech at a Meeting with Local Leaders in', '地方领导人会议演讲（'],
  ['Speech at the Japan Society of Monetary Economics', '日本货币经济学会演讲'],
  ['Speech at a Meeting with', '会议演讲：'],
  ['Economic Activity, Prices, and Monetary Policy in Japan', '日本的经济活动、物价与货币政策'],
  ['Singleness of Money and the Role of Central Banks', '货币单一性与中央银行的作用'],
  ['Hosted by the Institute for Monetary and Economic Studies', '（金融研究所主办）'],
  ['Institute for Monetary and Economic Studies', '金融研究所'],
  ['Member of the Policy Board', '政策委员会委员'],
  ['Deputy Governor', '副行长'],
  ['Executive Director', '执行理事'],
  ['Bank of Japan', '日本央行'],
  ['Monetary Policy Meeting', '货币政策会议'],
  ['Monetary Policy', '货币政策'],
  ['Joint Research Workshop', '联合研究研讨会'],
  ['Annual Forum', '年度论坛'],
  ['IMES Newsletter', 'IMES 通讯'],
  ['Financial System', '金融体系'],
  ['Promoting the Evolution and Stability of', '推动…演进与稳定：'],
  ['Quarterly Schedule of Outright Purchases of Japanese Government Bonds', '日本国债现券购买季度时间表'],
  ['Timetable and Schedule of U.S. Dollar Funds-Supplying Operations', '美元融资操作时间表'],
  ['Call for Papers', '征文通知'],
  ['Conference on', '会议：'],
  ['Workshop', '研讨会'],
  ['Governor', '行长'],
  ['Japan', '日本'],
];

/** 日本央行人物 */
const BOJ_PEOPLE = [
  ['UEDA Kazuo, Governor', '植田和男（行长）'],
  ['UEDA Kazuo', '植田和男'],
  ['KOEDA Junko, Member of the Policy Board', '小手保充（政策委员会委员）'],
  ['KOEDA Junko', '小手保充'],
  ['HIMINO Ryozo, Deputy Governor', '冰见亮三（副行长）'],
  ['HIMINO Ryozo', '冰见亮三'],
  ['TAMURA Naoki, Member of the Policy Board', '田村直树（政策委员会委员）'],
  ['TAMURA Naoki', '田村直树'],
  ['Executive Director KAMIYAMA', '执行理事神田真之'],
  ['KAMIYAMA', '神田真之'],
];

const BOJ_CITIES = [
  ['Fukuoka', '福冈'],
  ['Hyogo', '兵库'],
  ['Tokyo', '东京'],
  ['Osaka', '大阪'],
];

const SORTED_EXACT = [...BOJ_EXACT_TITLES].sort((a, b) => b[0].length - a[0].length);
const SORTED_PHRASES = [...BOJ_PHRASES].sort((a, b) => b[0].length - a[0].length);
const SORTED_PEOPLE = [...BOJ_PEOPLE].sort((a, b) => b[0].length - a[0].length);

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(text) {
  return String(text || '')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

function extractPdfSuffix(text) {
  const m = String(text).match(/(\[PDF[^\]]*\])/i);
  return m ? ` ${m[1]}` : '';
}

function applyBojPhrases(text) {
  let out = String(text || '');
  for (const [en, zh] of SORTED_PEOPLE) {
    out = out.replace(new RegExp(escapeRegExp(en), 'gi'), zh);
  }
  for (const [en, zh] of SORTED_PHRASES) {
    out = out.replace(new RegExp(escapeRegExp(en), 'gi'), zh);
  }
  for (const [en, zh] of BOJ_CITIES) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(en)}\\b`, 'gi'), zh);
  }
  return out
    .replace(/"\s*/g, '「')
    .replace(/\s*"/g, '」')
    .replace(/\(\s*/g, '（')
    .replace(/\s*\)/g, '）')
    .replace(/\s+/g, ' ')
    .replace(/\s*，\s*/g, '，')
    .replace(/\s*：\s*/g, '：')
    .trim();
}

function findExactTranslation(text) {
  const norm = normalizeText(text);
  const lower = norm.toLowerCase();
  for (const [en, zh] of SORTED_EXACT) {
    if (lower === en.toLowerCase()) return zh;
  }
  const withoutPdf = norm.replace(/\s*\[PDF[^\]]*\]/gi, '').trim();
  for (const [en, zh] of SORTED_EXACT) {
    if (withoutPdf.toLowerCase() === en.toLowerCase()) return zh + extractPdfSuffix(norm);
  }
  return null;
}

function classifyBojFallback(text) {
  const t = text.toLowerCase();
  if (/statement on monetary policy/.test(t)) return '货币政策声明';
  if (/outlook for economic activity/.test(t)) return '经济活动和物价展望';
  if (/opening remarks/.test(t)) return '开幕致辞';
  if (/speech at/.test(t)) return '演讲';
  if (/remarks by/.test(t)) return '讲话';
  if (/minutes of/.test(t)) return '会议纪要';
  if (/monetary policy meeting/.test(t)) return '货币政策会议';
  if (/schedule of outright purchases/.test(t)) return '国债购买时间表';
  if (/call for papers/.test(t)) return '征文通知';
  if (/newsletter/.test(t)) return '通讯';
  if (/workshop/.test(t)) return '研讨会';
  return '公告';
}

function buildBojFallback(text) {
  const pdf = extractPdfSuffix(text);
  const kind = classifyBojFallback(text);
  const partial = applyBojPhrases(text.replace(/\[PDF[^\]]*\]/gi, '').trim());
  if (cjkCount(partial) >= 6 && latinWordCount(partial) <= 4) {
    return partial + pdf;
  }
  return `日本央行：${kind}${pdf}`;
}

function isBetterChinese(original, translated) {
  if (!translated || translated.trim() === original.trim()) return false;
  const oc = cjkCount(original);
  const tc = cjkCount(translated);
  const ol = latinWordCount(original);
  const tl = latinWordCount(translated);
  if (isAcceptableChinese(translated)) return true;
  if (tc >= 4 && tc > oc) return true;
  if (tc >= 3 && tl < ol) return true;
  return false;
}

function translateBojTitle(text) {
  if (!text) return '';
  const norm = normalizeText(text);
  if (/[\u4e00-\u9fff]/.test(norm) && latinWordCount(norm) <= 1) return norm;

  const exact = findExactTranslation(norm);
  if (exact) return exact;

  let out = applyBojPhrases(norm);
  if (!isBetterChinese(norm, out)) {
    out = applyBojPhrases(translateRegulatoryTitleLocal(norm));
  }
  if (isBetterChinese(norm, out)) return out;

  return buildBojFallback(norm);
}

function translateBojSpeaker(text) {
  if (!text) return '';
  const norm = normalizeText(text);
  if (/[\u4e00-\u9fff]/.test(norm) && latinWordCount(norm) <= 1) return norm;

  let out = applyBojPhrases(norm);
  if (isBetterChinese(norm, out)) return out;

  const exact = findExactTranslation(norm);
  if (exact) return exact;

  return buildBojFallback(norm);
}

module.exports = {
  translateBojTitle,
  translateBojSpeaker,
  BOJ_EXACT_TITLES,
};
