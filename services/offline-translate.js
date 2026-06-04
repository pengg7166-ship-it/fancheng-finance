const MONTHS = {
  january: '1月',
  february: '2月',
  march: '3月',
  april: '4月',
  may: '5月',
  june: '6月',
  july: '7月',
  august: '8月',
  september: '9月',
  october: '10月',
  november: '11月',
  december: '12月',
};

const PEOPLE = {
  'kevin warsh': '凯文·沃什',
  'kevin m. warsh': '凯文·沃什',
  'jerome h. powell': '杰罗姆·鲍威尔',
  'jerome powell': '杰罗姆·鲍威尔',
  powell: '鲍威尔',
  warsh: '沃什',
};

const BANKS = {
  'atlantic union bank': '大西洋联合银行',
  'frost bank': '弗罗斯特银行',
  'commerce bank': '商业银行',
};

const PHRASES = [
  [
    'Agencies publish resolution plan feedback letters for certain domestic and foreign banking organizations',
    '相关监管机构向部分境内外银行机构发布处置方案反馈意见函',
  ],
  [
    'Federal Reserve Board requests public comment on a proposal to establish a "payment account," which legally eligible financial institutions could use for the specific purpose of clearing and settling their payments',
    '美联储理事会就设立「支付账户」提案征求公众意见，合格金融机构可专用该账户进行支付清算与结算',
  ],
  [
    'Federal Reserve Board issues enforcement actions with former employee of',
    '美联储理事会对以下机构前雇员发布执法处罚：',
  ],
  [
    'Federal Reserve Board issues enforcement action with former employee of',
    '美联储理事会对以下机构前雇员发布执法处罚：',
  ],
  ['Federal Reserve Board issues enforcement actions', '美联储理事会发布执法处罚'],
  ['Federal Reserve Board issues enforcement action', '美联储理事会发布执法处罚'],
  ['Federal Reserve Board requests public comment on', '美联储理事会就以下事项征求公众意见：'],
  ['Federal Reserve Board announces', '美联储理事会宣布：'],
  ['Federal Reserve Board approves', '美联储理事会批准：'],
  ['Federal Reserve Board names', '美联储理事会任命：'],
  ['Federal Reserve Board', '美联储理事会'],
  ['Federal Open Market Committee unanimously selects', '联邦公开市场委员会一致推选'],
  ['Federal Open Market Committee', '联邦公开市场委员会'],
  ['Board of Governors of the Federal Reserve System', '美联储系统理事会'],
  ['Board of Governors', '理事会'],
  ['Agencies publish resolution plan feedback letters', '相关监管机构发布处置方案反馈意见函'],
  ["Minutes of the Board's discount rate meeting on", '理事会贴现率会议纪要（'],
  ['Minutes of the Federal Open Market Committee,', '联邦公开市场委员会会议纪要（'],
  ['Minutes of the', '会议纪要：'],
  ['takes oath of office as chairman and a member of', '宣誓就任主席及'],
  ['takes oath of office as chairman', '宣誓就任主席'],
  ['takes oath of office', '宣誓就职'],
  ['and the Federal Open Market Committee unanimously selects', '；联邦公开市场委员会一致推选'],
  ['as its chairman', '担任主席'],
  ['as chair pro tempore', '担任临时主席'],
  ['chair pro tempore', '临时主席'],
  ['until', '直至'],
  ['is sworn in as the new chair', '宣誓就任新主席'],
  ['former employee of', '前雇员（原任职于'],
  ['and former employee of', '；前雇员（原任职于'],
  ['discount rate meeting', '贴现率会议'],
  ['enforcement actions', '执法处罚'],
  ['enforcement action', '执法处罚'],
  ['public comment', '公众意见'],
  ['payment account', '支付账户'],
  ['stress test results', '压力测试结果'],
  ['stress test', '压力测试'],
  ['banking organizations', '银行机构'],
  ['financial institutions', '金融机构'],
  ['monetary policy', '货币政策'],
  ['interest rate', '利率'],
  ['press release', '新闻稿'],
  ['statement', '声明'],
  ['supervisory', '监管'],
  ['proposal to establish', '设立提案：'],
  ['proposal', '提案'],
  ['domestic and foreign', '境内外'],
  ['domestic', '国内'],
  ['foreign', '国外'],
  ['member of the', '成员，隶属'],
  ['member of', '成员'],
  ['unanimously selects', '一致推选'],
  ['unanimously', '一致'],
  ['announces', '宣布'],
  ['approves', '批准'],
  ['publishes', '发布'],
  ['issues', '发布'],
  ['requests', '征求'],
  ['selects', '推选'],
  ['names', '任命'],
  ['with', '涉及'],
  ['and', '及'],
  ['the', ''],
  ['of', '的'],
  ['for', '针对'],
  ['on', '于'],
  ['in', '于'],
  ['to', '至'],
  ['a', ''],
  ['an', ''],
];

const { translateRegulatoryTitleLocal, isAcceptableChinese } = require('./policy-en-zh-dict');
const { translateFinanceHeadline } = require('./finance-headline-translate');

function isFedRelated(text) {
  return /federal reserve|fomc|board of governors|discount rate meeting|oath of office|chair pro tempore|enforcement action with former employee|resolution plan feedback/i.test(
    String(text || '')
  );
}
function isMostlyEnglish(text) {
  if (!text) return false;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin > 4 && latin > cjk;
}

function translateDates(text) {
  let out = text;

  out = out.replace(
    /(\w+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})/gi,
    (_, month, d1, d2, year) => {
      const m = MONTHS[month.toLowerCase()] || month;
      return `${year}年${m}${d1}日至${d2}日`;
    }
  );

  out = out.replace(
    /(\w+)\s+(\d{1,2})\s+and\s+(\d{1,2}),\s*(\d{4})/gi,
    (_, month, d1, d2, year) => {
      const m = MONTHS[month.toLowerCase()] || month;
      return `${year}年${m}${d1}日及${d2}日`;
    }
  );

  out = out.replace(/(\w+)\s+(\d{1,2}),\s*(\d{4})/gi, (_, month, day, year) => {
    const m = MONTHS[month.toLowerCase()] || month;
    return `${year}年${m}${day}日`;
  });

  return out;
}

function translateKnownNames(text) {
  let out = text;
  for (const [en, zh] of Object.entries(BANKS)) {
    out = out.replace(new RegExp(en, 'gi'), zh);
  }
  for (const [en, zh] of Object.entries(PEOPLE)) {
    out = out.replace(new RegExp(en.replace('.', '\\.'), 'gi'), zh);
  }
  return out;
}

function applyPhrases(text) {
  let out = text;
  for (const [en, zh] of PHRASES) {
    out = out.split(en).join(zh);
  }
  return out;
}

function cleanupChinese(text) {
  return text
    .replace(/\s+/g, '')
    .replace(/，+/g, '，')
    .replace(/。+/g, '。')
    .replace(/：+/g, '：')
    .replace(/（+/g, '（')
    .replace(/）+/g, '）')
    .replace(/；+/g, '；')
    .replace(/[，；：]\s*$/g, '')
    .replace(/\(\s*/g, '（')
    .replace(/\s*\)/g, '）')
    .trim();
}

function genericSummary(text) {
  const lower = text.toLowerCase();
  if (/enforcement action/.test(lower)) {
    return `美联储发布执法处罚公告：${cleanupChinese(applyPhrases(translateKnownNames(text))).slice(0, 80)}`;
  }
  if (/minutes of/.test(lower)) {
    return `美联储发布会议纪要：${translateDates(translateKnownNames(text))}`;
  }
  if (/oath of office|sworn in|chair/.test(lower)) {
    return `美联储人事任命公告：${cleanupChinese(applyPhrases(translateKnownNames(text))).slice(0, 80)}`;
  }
  if (/public comment|proposal/.test(lower)) {
    return `美联储政策征求意见公告：${cleanupChinese(applyPhrases(text)).slice(0, 80)}`;
  }
  if (/stress test|resolution plan/.test(lower)) {
    return `美联储监管公告：${cleanupChinese(applyPhrases(text)).slice(0, 80)}`;
  }
  return `美联储公告摘要：${cleanupChinese(applyPhrases(translateKnownNames(text))).slice(0, 100)}`;
}

function translateFedNewsOffline(trimmed) {
  let m = trimmed.match(
    /^Federal Reserve Board issues enforcement actions with former employee of (.+?) and former employee of (.+)$/i
  );
  if (m) {
    return cleanupChinese(
      `美联储理事会对${translateKnownNames(m[1])}与${translateKnownNames(m[2])}前雇员发布执法处罚。`
    );
  }

  m = trimmed.match(/^Federal Reserve Board issues enforcement action with former employee of (.+)$/i);
  if (m) {
    return cleanupChinese(`美联储理事会对${translateKnownNames(m[1])}前雇员发布执法处罚。`);
  }

  m = trimmed.match(/^Minutes of the Board's discount rate meeting on (.+)$/i);
  if (m) {
    return cleanupChinese(`理事会贴现率会议纪要（${translateDates(m[1])}）。`);
  }

  m = trimmed.match(/^Minutes of the Federal Open Market Committee, (.+)$/i);
  if (m) {
    return cleanupChinese(`联邦公开市场委员会会议纪要（${translateDates(m[1])}）。`);
  }

  m = trimmed.match(/^(.+?) takes oath of office as chairman/i);
  if (m) {
    return cleanupChinese(`${translateKnownNames(m[1])}宣誓就任美联储理事会主席。`);
  }

  m = trimmed.match(/^Federal Reserve Board names (.+?) as chair pro tempore;/i);
  if (m) {
    return cleanupChinese(
      `美联储理事会任命${translateKnownNames(m[1])}为临时主席，直至新任主席宣誓就职。`
    );
  }

  let out = translateKnownNames(trimmed);
  out = applyPhrases(out);
  out = translateDates(out);
  out = cleanupChinese(out);

  if (isMostlyEnglish(out)) {
    out = cleanupChinese(genericSummary(trimmed));
  }

  if (!out.endsWith('。') && !out.endsWith('）')) {
    out += '。';
  }

  return out;
}

function translateNewsOffline(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !isMostlyEnglish(trimmed)) return trimmed;

  if (isFedRelated(trimmed)) {
    return translateFedNewsOffline(trimmed);
  }

  const finance = translateFinanceHeadline(trimmed);
  if (finance && /[\u4e00-\u9fff]/.test(finance)) return finance;

  const general = translateRegulatoryTitleLocal(trimmed);
  if (isAcceptableChinese(general)) return general;

  return finance || general || trimmed;
}

module.exports = {
  translateNewsOffline,
  isMostlyEnglish,
};
