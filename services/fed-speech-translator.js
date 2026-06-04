const { cjkCount, latinWordCount, isAcceptableChinese } = require('./policy-en-zh-dict');

/** 美联储官员讲话标题 — 完整句映射（最长优先） */
const EXACT_TITLES = [
  [
    'A Framework for Practical Monetary Policy Decision Making',
    '实用货币政策决策框架',
  ],
  [
    'Global Economic Developments and the U.S. Economy',
    '全球经济形势与美国就业',
  ],
  [
    'The Opportunities and Risks AI Presents for the Economy and Financial System',
    '人工智能对经济和金融体系带来的机遇与风险',
  ],
  [
    'Efficient and Effective Central Banking: Beyond the Balance Sheet',
    '高效央行运作：超越资产负债表',
  ],
  [
    'When Regulation Reshapes Markets: The Migration of Corporate Lending',
    '监管重塑市场：企业贷款迁移趋势',
  ],
  [
    'Perspectives on Tokenization and Implications for the Financial System',
    '代币化视角及其对金融体系的影响',
  ],
  [
    'A Coordinated Approach to Consumer Fraud Protection',
    '消费者欺诈防护的协调机制',
  ],
  [
    'Artificial Intelligence in the Financial System',
    '人工智能在金融体系中的应用',
  ],
  [
    'Modernizing Federal Reserve Operations in the 21st Century',
    '二十一世纪美联储运作现代化',
  ],
  [
    'One Transitory Shock After Another',
    '一轮又一轮的暂时性冲击',
  ],
  ['Policy Risks Have Changed', '政策风险已发生变化'],
  ['Measuring Financial Health', '衡量金融健康状况'],
  ['Update On Federal Reserve Bank Operations', '美联储银行业务运作更新'],
  ['Acceptance Remarks', '接受致辞'],
  ['Opening Remarks', '开幕致辞'],
  ['Remarks', '讲话'],
  ['Speech', '演讲'],
  ['Testimony', '国会听证证词'],
];

const PHRASES = [
  ['Monetary Policy Decision Making', '货币政策决策'],
  ['Monetary Policy', '货币政策'],
  ['Global Economic Developments', '全球经济形势'],
  ['U.S. Economy', '美国经济'],
  ['Financial System', '金融体系'],
  ['Financial Health', '金融健康状况'],
  ['Central Banking', '中央银行运作'],
  ['Balance Sheet', '资产负债表'],
  ['Corporate Lending', '企业贷款'],
  ['Federal Reserve Bank Operations', '美联储银行业务运作'],
  ['Federal Reserve', '美联储'],
  ['Interest Rate', '利率'],
  ['Interest Rates', '利率'],
  ['Exchange Rate', '汇率'],
  ['Inflation', '通胀'],
  ['Tokenization', '代币化'],
  ['Artificial Intelligence', '人工智能'],
  ['Consumer Fraud Protection', '消费者欺诈防护'],
  ['Regulation Reshapes Markets', '监管重塑市场'],
  ['Policy Risks', '政策风险'],
  ['Transitory Shock', '暂时性冲击'],
  ['Opening Remarks', '开幕致辞'],
  ['Acceptance Remarks', '接受致辞'],
  ['Economic Outlook', '经济展望'],
  ['Labor Market', '劳动力市场'],
  ['Price Stability', '物价稳定'],
  ['Financial Conditions', '金融条件'],
  ['Payment System', '支付体系'],
  ['Digital Assets', '数字资产'],
  ['Climate Risk', '气候风险'],
  ['Bank Capital', '银行资本'],
  ['Stress Test', '压力测试'],
  ['Framework for', '…框架：'],
  ['Perspectives on', '…视角：'],
  ['Implications for', '对…的影响'],
  ['Update On', '…更新：'],
  ['Beyond the', '超越…'],
  ['and the', '与'],
  ['for the', '针对'],
  ['in the', '在…中的'],
];

const SUMMARY_PHRASES = [
  ['Speech at', '演讲（'],
  ['Remarks at', '讲话（'],
  ['Meeting of', '会议（'],
  ['Annual Meeting', '年会'],
  ['Federal Reserve Bank of', '联邦储备银行（'],
  ['Board of Governors', '理事会'],
  ['Monetary Policy', '货币政策'],
  ['Financial System', '金融体系'],
  ['Massachusetts', '马萨诸塞州'],
  ['Washington', '华盛顿'],
  ['New York', '纽约'],
];

const SORTED_EXACT = [...EXACT_TITLES].sort((a, b) => b[0].length - a[0].length);
const SORTED_PHRASES = [...PHRASES].sort((a, b) => b[0].length - a[0].length);

function normalize(text) {
  return String(text || '')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyPhrases(text, phrases) {
  let out = String(text || '');
  for (const [en, zh] of phrases) {
    out = out.replace(new RegExp(esc(en), 'gi'), zh);
  }
  return out
    .replace(/:\s*/g, '：')
    .replace(/\(\s*/g, '（')
    .replace(/\s*\)/g, '）')
    .replace(/\s+/g, ' ')
    .trim();
}

function findExact(text) {
  const n = normalize(text);
  const lower = n.toLowerCase();
  for (const [en, zh] of SORTED_EXACT) {
    if (lower === en.toLowerCase()) return zh;
  }
  return null;
}

function needsTranslation(text) {
  return latinWordCount(normalize(text)) >= 2;
}

function classifyTitle(text) {
  const s = text.toLowerCase();
  if (/monetary policy|interest rate|inflation|federal funds/.test(s)) return '货币政策讲话';
  if (/exchange rate|currency|dollar|forex/.test(s)) return '汇率政策讲话';
  if (/financial system|banking|regulation/.test(s)) return '金融体系讲话';
  if (/economy|economic|outlook|employment/.test(s)) return '经济展望讲话';
  if (/remarks|speech|testimony|opening/.test(s)) return '政策讲话';
  return '官员讲话';
}

function translateFedSpeechTitle(text) {
  const n = normalize(text);
  if (!n) return n;
  if (!needsTranslation(n)) return n;

  const exact = findExact(n);
  if (exact) return exact;

  const partial = applyPhrases(n, SORTED_PHRASES);
  if (cjkCount(partial) >= 4 && latinWordCount(partial) < latinWordCount(n)) {
    return partial.replace(/^[：:…]+/, '').replace(/[：:…]+$/, '').trim() || partial;
  }

  return `美联储${classifyTitle(n)}`;
}

function translateFedSpeechSummary(text) {
  const n = normalize(text);
  if (!n || !needsTranslation(n)) return n;

  const exact = findExact(n);
  if (exact) return exact;

  let out = applyPhrases(n, SUMMARY_PHRASES);
  out = applyPhrases(out, SORTED_PHRASES);
  if (isAcceptableChinese(out) || cjkCount(out) >= 6) return out.slice(0, 220);
  return '';
}

function localizeFedSpeechItem(item) {
  if (!item) return item;
  return {
    ...item,
    title: translateFedSpeechTitle(item.title),
    summary: item.summary ? translateFedSpeechSummary(item.summary) : '',
  };
}

function relocalizeFedSpeeches(speeches) {
  return (speeches || []).map((item) => {
    if (!needsTranslation(item.title) && !needsTranslation(item.summary)) return item;
    const localized = localizeFedSpeechItem({
      title: item.title,
      summary: item.summary,
      official: item.official,
    });
    return { ...item, title: localized.title, summary: localized.summary || item.summary };
  });
}

module.exports = {
  translateFedSpeechTitle,
  translateFedSpeechSummary,
  localizeFedSpeechItem,
  relocalizeFedSpeeches,
  needsTranslation,
};
