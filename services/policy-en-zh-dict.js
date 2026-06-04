/** 美国联邦监管标题 — 英文短语/术语 → 中文（长短语优先匹配） */
const REGULATORY_PHRASES = [
  ['Opening Remarks at the 2026 BOJ-IMES Conference Hosted by the Institute for Monetary and Economic Studies, Bank of Japan', '2026年日本央行-IMES会议开幕致辞（日本银行金融研究所主办）'],
  ['Economic Activity, Prices, and Monetary Policy in Japan', '日本经济、物价与货币政策'],
  ['Singleness of Money and the Role of Central Banks', '货币单一性与中央银行的作用'],
  ['Statement on Monetary Policy', '货币政策声明'],
  ['Quarterly Schedule of Outright Purchases of Japanese Government Bonds', '日本国债现券购买季度时间表'],
  ['Timetable and Schedule of U.S. Dollar Funds-Supplying Operations', '美元融资操作时间表'],
  ['Relaxation of the Terms and Conditions for the Securities Lending Facility', '证券借贷便利条款放宽'],
  ['Opening Remarks by Executive Director', '执行理事开幕致辞'],
  ['Opening Remarks at the', '开幕致辞：'],
  ['Speech at a Meeting with Local Leaders in', '地方领导人会议演讲（'],
  ['Speech at the Japan Society of Monetary Economics', '日本货币经济学会演讲'],
  ['Member of the Policy Board', '政策委员会委员'],
  ['Deputy Governor', '副行长'],
  ['Bank of Japan', '日本央行'],
  ['Monetary Policy Meeting', '货币政策会议'],
  ['Monetary Policy Releases', '货币政策发布'],
  ['Governor', '行长'],
  ['At a meeting with local leaders in', '地方领导人会议（'],
  ['At the Kisaragi-kai Meeting', 'kisaragi-kai 会议'],
  ['Hosted by the Institute for Monetary and Economic Studies', '日本银行金融研究所主办'],
  ['Self-Regulatory Organizations', '自律监管组织'],
  ['Notice and Request for Comments', '公告并征求意见'],
  ['Notice of Intent To Extend Collection', '延长信息收集公告'],
  ['Agency Information Collection Activities', '机构信息收集活动'],
  ['Order Granting Conditional Substituted Compliance', '授予有条件替代合规令'],
  ['Conditional Substituted Compliance', '有条件替代合规'],
  ['Substituted Compliance', '替代合规'],
  ['Staff No-Action and Interpretive Letters', '工作人员不行动及解释函'],
  ['No-Action and Interpretive Letters', '不行动及解释函'],
  ['Guidance Supporting Retirement Plans', '支持退休计划指引'],
  ['Retirement Plans for Small Businesses', '小型企业退休计划'],
  ['Repeal Existing Stationary Source Regulations', '撤销现行固定污染源法规'],
  ['Stationary Source Regulations', '固定污染源法规'],
  ['Air Plan Approval', '空气计划批准'],
  ['Air Quality Implementation Plans', '空气质量实施计划'],
  ['National Ambient Air Quality Standards', '国家环境空气质量标准'],
  ['Reasonably Available Control Technology', '合理可行控制技术'],
  ['Alternative Control Technology', '替代控制技术'],
  ['Federal Open Market Committee', '联邦公开市场委员会'],
  ['Federal Financial Assistance', '联邦财政援助'],
  ['Bank Holding Companies', '银行控股公司'],
  ['Savings and Loan Holding Company', '储蓄贷款控股公司'],
  ['Change in Bank Control Notices', '银行控制权变更公告'],
  ['Acquisitions of Shares of a Bank', '收购银行股份'],
  ['Acquisitions by, and Mergers of', '收购及合并'],
  ['Formations of, Acquisitions by, and Mergers of', '设立、收购及合并'],
  ['enforcement actions', '执法行动'],
  ['Enforcement Action', '执法行动'],
  ['Proposed Rule Change', '拟议规则变更'],
  ['Final Results of Antidumping Duty Administrative Review', '反倾销行政复审最终裁定'],
  ['Antidumping and Countervailing Duty Administrative Reviews', '反倾销反补贴行政复审'],
  ['Countervailing Duty Administrative Reviews', '反补贴行政复审'],
  ['Initiation of Antidumping', '反倾销立案'],
  ['Section 301 Investigations', '301条款调查'],
  ['Tariff-Related Elements', '关税相关要素'],
  ['Trade and Security Agreement', '贸易与安全协议'],
  ['Critical Minerals', '关键矿产'],
  ['Renewable Electricity Production', '可再生电力生产'],
  ['Strategic Petroleum Reserve', '战略石油储备'],
  ['Position Limits', '持仓限制'],
  ['Commodity Futures Trading Act', '商品交易法'],
  ['Investment Company Act of 1940', '1940年投资公司法'],
  ['Securities Exchange Act', '证券交易法'],
  ['Federal Reserve Board', '美联储理事会'],
  ['Environmental Protection Agency', '美国环保署'],
  ['Commodity Futures Trading Commission', '美国商品期货交易委员会'],
  ['Securities and Exchange Commission', '美国证券交易委员会'],
  ['Department of the Treasury', '美国财政部'],
  ['Department of Agriculture', '美国农业部'],
  ['Department of Commerce', '美国商务部'],
  ['Department of Energy', '美国能源部'],
  ['Trade Representative', '贸易代表办公室'],
  ['Notice of OFAC Sanctions Actions', 'OFAC制裁行动公告'],
  ['Freedom of Information Act Procedures', '信息自由法程序'],
  ['Climate-Related Financial Risk', '气候相关金融风险'],
  ['Climate-Related Disclosure', '气候相关披露'],
  ['Private Fund Reporting', '私募基金报告'],
  ['Insider Trading Scheme', '内幕交易计划'],
  ['Financial Literacy Month', '金融素养月'],
  ['Public Offerings', '公开发行'],
  ['Registered Offerings', '注册发行'],
  ['Combined Notice Filings', '合并公告备案'],
  ['Endangered and Threatened Species', '濒危和受威胁物种'],
  ['Marine Mammals Incidental to', '附带影响海洋哺乳动物'],
  ['Deep Seabed Mining', '深海采矿'],
  ['Payment Account', '支付账户'],
  ['Reserve Requirements of Depository Institutions', '存款机构准备金要求'],
  ['Discount Rate Meeting', '贴现率会议'],
  ['Economic Well-Being of U.S. Households', '美国家庭经济福祉'],
  ['Rural Business Development Grants', '农村商业发展 grant'],
  ['Supplemental Nutrition Assistance Program', '补充营养援助计划'],
  ['Specialty Crop Farmers', '特种作物农民'],
  ['White River National Forest', '白河国家森林'],
  ['Infrastructure Improvement Project', '基础设施改善项目'],
  ['Infrastructure Modernization Project', '基础设施现代化项目'],
  ['Keystone VOC RACT Alternative Control', 'Keystone VOC RACT 替代控制'],
  ['Philadelphia Gas Works', '费城煤气厂'],
  ['San Joaquin Valley', '圣华金谷'],
  ['Air Pollution Control District', '空气污染控制区'],
  ['Regional Haze State Implementation Plan', '区域雾霾州实施计划'],
  ['Source-Specific Air Quality Implementation Plan', '源特定空气质量实施计划'],
  ['Determination of Attainment', '达标认定'],
  ['Partial Approval and Partial Disapproval', '部分批准及部分否决'],
  ['Investment Management and Corporation Finance', '投资管理和公司金融'],
  ['Investment Management and Trading and Markets', '投资管理和交易市场'],
  ['Corporation Finance Issue Staff Guidance', '公司金融部发布工作人员指引'],
  [
    'SEC Divisions of Investment Management and Corporation Finance Issue Staff Guidance Supporting Retirement Plans for Small Businesses',
    'SEC投资管理和公司金融部门发布支持小型企业退休计划工作人员指引',
  ],
  ['Withdraw Certain Staff', '撤回部分工作人员'],
  ['Official Seal', '官方印章'],
  ['Privacy Act of 1974', '1974年隐私法'],
  ['Privacy Act Regulations', '隐私法法规'],
  ['Clearing Requirement Determination', '清算要求认定'],
  ['Interest Rate Swaps', '利率互换'],
  ['Application of Federal Securities Laws', '联邦证券法适用'],
  ['Crypto Assets', '加密资产'],
  ['Small Business Advisory Committee', '小企业咨询委员会'],
  ['Investor Advisory Committee', '投资者咨询委员会'],
  ['Memorandum of Understanding', '谅解备忘录'],
  ['Roundtable on Options Market Structure', '期权市场结构圆桌会'],
  ['Consolidated Audit Trail', '综合审计追踪'],
  ['Cross-Margining', '交叉保证金'],
  ['U.S. Treasury Markets', '美国国债市场'],
  ['Fiscal Year', '财年'],
  ['Four-Year Review Process', '四年审查程序'],
  ['African Growth and Opportunity Act', '非洲增长与机会法'],
  ['Industry Trade Advisory Committees', '行业贸易咨询委员会'],
  ['Intergovernmental Policy Advisory Committee on Trade', '贸易政府间政策咨询委员会'],
  ['Trade Advisory Committee on Africa', '非洲贸易咨询委员会'],
  ['Trade and Environment Policy Advisory Committee', '贸易与环境政策咨询委员会'],
  ['issues enforcement actions with', '对…采取执法行动'],
  ['in Connection With', '关于'],
  ['Certain Capital and Financial Reporting Requirements', '部分资本与财务报告要求'],
  ['Corporation Finance Issue Staff Guidance', '公司金融部发布工作人员指引'],
  ['Issue Staff Guidance', '发布工作人员指引'],
  ['Investment Management and Corporation Finance', '投资管理和公司金融'],
  ['former employee of', '前雇员'],
  ['Atlantic Union Bank', '大西洋联合银行'],
  ['Frost Bank', '弗罗斯特银行'],
  ['Repeal of Existing', '撤销现行'],
  ['Rapid Response Labor Mechanism', '快速响应劳工机制'],
  ['Import Injury Determination', '进口损害认定'],
  ['Semiannual Reporting', '半年度报告'],
  ['Deregistration Under Section 8(f)', '第8(f)条注销登记'],
  ['Immediate Effectiveness of Proposed Rule Change', '拟议规则变更立即生效'],
  ['Order Approving a Proposed Rule Change', '批准拟议规则变更令'],
  ['Announcement of Board Approval', '董事会批准公告'],
  ['Submission for OMB Review', '提交OMB审查'],
  ['Open Meeting of the Taxpayer Advocacy Panel', '纳税人权益小组公开会议'],
  ['Credit for Renewable Electricity Production', '可再生电力生产抵免'],
  ['Publication of Inflation Adjustment Factor', '公布通胀调整因子'],
  ['Assistance for Specialty Crop Farmers', '特种作物农民援助'],
  ['Area Risk Protection Insurance', '区域风险保护保险'],
  ['Land Management Plan', '土地管理计划'],
  ['Preliminary Permit Application', '初步许可申请'],
  ['Qualifying Conduit Hydropower Facility', '合格管道式水电设施'],
  ['Application Accepted for Filing', '受理备案申请'],
  ['Soliciting Motions To Intervene', '征集介入动议'],
  ['Request Under Blanket Authorization', '依总括授权申请'],
  ['Water Quality Certification Application', '水质认证申请'],
  ['Fuel and Energy Purchase Practices', '燃料和能源采购做法'],
  ['FERC Form 580', 'FERC 580表格'],
  ['Interrogatories on', '关于…的质询'],
  ['Takes of Marine Mammals', '海洋哺乳动物捕获'],
  ['Anadromous Fish', '溯河性鱼类'],
  ['Highly Migratory Species', '高度洄游物种'],
  ['Fisheries Off West Coast States', '美国西海岸州渔业'],
  ['Onions Grown in South Texas', '南德克萨斯州洋葱'],
  ['Temporary Suspension and Continuance of Referendum', '临时暂停并继续公投'],
  ['Poultry Grower Payment Systems', '家禽养殖户支付系统'],
  ['Capital Improvement Systems', '资本改善系统'],
  ['Delay of Effective Date', '生效日期延迟'],
];

const REGULATORY_TERMS = [
  ['Wall Street', '华尔街'],
  ['block trade', '大宗交易'],
  ['prediction markets', '预测市场'],
  ['futures', '期货'],
  ['commodity', '大宗商品'],
  ['commodities', '大宗商品'],
  ['crude oil', '原油'],
  ['oil prices', '油价'],
  ['natural gas', '天然气'],
  ['copper', '铜'],
  ['gold', '黄金'],
  ['silver', '白银'],
  ['lithium', '锂'],
  ['steel', '钢铁'],
  ['soybean', '大豆'],
  ['corn', '玉米'],
  ['wheat', '小麦'],
  ['OPEC', '欧佩克'],
  ['stimulus', '刺激政策'],
  ['inflation', '通胀'],
  ['recession', '衰退'],
  ['earnings', '盈利'],
  ['stocks', '股票'],
  ['markets', '市场'],
  ['market', '市场'],
  ['prices', '价格'],
  ['price', '价格'],
  ['trading', '交易'],
  ['traders', '交易员'],
  ['investors', '投资者'],
  ['analysts', '分析师'],
  ['China', '中国'],
  ['Chinese', '中国'],
  ['Fed', '美联储'],
  ['first', '首次'],
  ['hires', '招聘'],
  ['closes', '关闭'],
  ['rises', '上涨'],
  ['falls', '下跌'],
  ['climb', '攀升'],
  ['surge', '飙升'],
  ['drop', '下跌'],
  ['cut', '削减'],
  ['cuts', '削减'],
  ['output', '产量'],
  ['demand', '需求'],
  ['supply', '供应'],
  ['Regulations', '法规'],
  ['Regulation', '法规'],
  ['Repeal', '撤销'],
  ['Existing', '现行'],
  ['Stationary', '固定'],
  ['Guidance', '指引'],
  ['Supporting', '支持'],
  ['Retirement', '退休'],
  ['Businesses', '企业'],
  ['Approval', '批准'],
  ['Approvals', '批准'],
  ['Withdraw', '撤回'],
  ['Withdrawal', '撤回'],
  ['Issuance', '发布'],
  ['Issue', '发布'],
  ['Issued', '发布'],
  ['Proposed', '拟议'],
  ['Final', '最终'],
  ['Notice', '公告'],
  ['Notices', '公告'],
  ['Order', '命令'],
  ['Orders', '命令'],
  ['Rule', '规则'],
  ['Rules', '规则'],
  ['Action', '行动'],
  ['Actions', '行动'],
  ['Enforcement', '执法'],
  ['Sanctions', '制裁'],
  ['Sanction', '制裁'],
  ['Tariff', '关税'],
  ['Trade', '贸易'],
  ['Security', '安全'],
  ['Agreement', '协议'],
  ['Investigation', '调查'],
  ['Investigations', '调查'],
  ['Initiation', '启动'],
  ['Implementation', '实施'],
  ['Amendment', '修正案'],
  ['Amendments', '修正案'],
  ['Amended', '修订'],
  ['Correction', '更正'],
  ['Publication', '公布'],
  ['Announcement', '宣布'],
  ['Application', '申请'],
  ['Applications', '申请'],
  ['Request', '请求'],
  ['Requests', '请求'],
  ['Comments', '评论'],
  ['Comment', '评论'],
  ['Hearing', '听证'],
  ['Meeting', '会议'],
  ['Minutes', '会议纪要'],
  ['Statement', '声明'],
  ['Report', '报告'],
  ['Review', '审查'],
  ['Determination', '认定'],
  ['Designation', '指定'],
  ['Rescission', '撤销'],
  ['Rescinds', '撤销'],
  ['Proposes', '提议'],
  ['Propose', '提议'],
  ['Approved', '批准'],
  ['Approval', '批准'],
  ['Announces', '宣布'],
  ['Announced', '宣布'],
  ['Charges', '指控'],
  ['Alleged', '涉嫌'],
  ['Securities', '证券'],
  ['Investment', '投资'],
  ['Management', '管理'],
  ['Trading', '交易'],
  ['Markets', '市场'],
  ['Market', '市场'],
  ['Finance', '金融'],
  ['Financial', '金融'],
  ['Banking', '银行'],
  ['Bank', '银行'],
  ['Banks', '银行'],
  ['Depository', '存款'],
  ['Institutions', '机构'],
  ['Institution', '机构'],
  ['Reserve', '储备'],
  ['Reserves', '储备'],
  ['Requirements', '要求'],
  ['Requirement', '要求'],
  ['Interest', '利息'],
  ['Rate', '利率'],
  ['Rates', '利率'],
  ['Monetary', '货币'],
  ['Policy', '政策'],
  ['Policies', '政策'],
  ['Environmental', '环境'],
  ['Protection', '保护'],
  ['Agency', '机构'],
  ['Agencies', '机构'],
  ['Commission', '委员会'],
  ['Department', '部'],
  ['Futures', '期货'],
  ['Commodity', '商品'],
  ['Commodities', '商品'],
  ['Swaps', '互换'],
  ['Swap', '互换'],
  ['Derivatives', '衍生品'],
  ['Clearing', '清算'],
  ['Margin', '保证金'],
  ['Position', '持仓'],
  ['Limits', '限制'],
  ['Limit', '限制'],
  ['Agriculture', '农业'],
  ['Energy', '能源'],
  ['Commerce', '商务'],
  ['Treasury', '财政部'],
  ['Export', '出口'],
  ['Import', '进口'],
  ['Controls', '管制'],
  ['Control', '控制'],
  ['Source', '源'],
  ['Sources', '源'],
  ['Emissions', '排放'],
  ['Emission', '排放'],
  ['Pollution', '污染'],
  ['Air', '空气'],
  ['Quality', '质量'],
  ['Plan', '计划'],
  ['Plans', '计划'],
  ['Standards', '标准'],
  ['Standard', '标准'],
  ['Ozone', '臭氧'],
  ['Climate', '气候'],
  ['Renewable', '可再生'],
  ['Electricity', '电力'],
  ['Production', '生产'],
  ['Fuel', '燃料'],
  ['Oil', '石油'],
  ['Gas', '天然气'],
  ['Natural', '天然'],
  ['Crude', '原油'],
  ['Livestock', '畜牧'],
  ['Crop', '作物'],
  ['Crops', '作物'],
  ['Farmers', '农民'],
  ['Farmer', '农民'],
  ['Grants', '资助'],
  ['Grant', '资助'],
  ['Program', '计划'],
  ['Programs', '计划'],
  ['Small', '小型'],
  ['Business', '企业'],
  ['Public', '公共'],
  ['Private', '私人'],
  ['Fund', '基金'],
  ['Funds', '基金'],
  ['Offerings', '发行'],
  ['Offering', '发行'],
  ['Disclosure', '披露'],
  ['Disclosures', '披露'],
  ['Compliance', '合规'],
  ['Reporting', '报告'],
  ['Filings', '备案'],
  ['Filing', '备案'],
  ['Staff', '工作人员'],
  ['Division', '部门'],
  ['Divisions', '部门'],
  ['Committee', '委员会'],
  ['Committees', '委员会'],
  ['Advisory', '咨询'],
  ['Roundtable', '圆桌会'],
  ['Semiannual', '半年度'],
  ['Annual', '年度'],
  ['Monthly', '月度'],
  ['Effective', '生效'],
  ['Effective Date', '生效日期'],
  ['Delay', '延迟'],
  ['Extension', '延长'],
  ['Termination', '终止'],
  ['Conversion', '转换'],
  ['Resignation', '辞职'],
  ['Appointment', '任命'],
  ['Former', '前'],
  ['Employee', '雇员'],
  ['Employees', '雇员'],
  ['Memorandum', '备忘录'],
  ['Understanding', '谅解'],
  ['Privacy', '隐私'],
  ['Information', '信息'],
  ['Collection', '收集'],
  ['Activities', '活动'],
  ['Activity', '活动'],
  ['Solicitation', '征集'],
  ['Nomination', '提名'],
  ['Nominations', '提名'],
  ['Membership', '成员'],
  ['Invitation', '邀请'],
  ['Continuance', '延续'],
  ['Continuation', '继续'],
  ['Modernization', '现代化'],
  ['Infrastructure', '基础设施'],
  ['Improvement', '改善'],
  ['Project', '项目'],
  ['Projects', '项目'],
  ['Forest', '森林'],
  ['National', '国家'],
  ['State', '州'],
  ['County', '县'],
  ['Regional', '区域'],
  ['Partial', '部分'],
  ['Technical', '技术'],
  ['Amendment to', '修订'],
  ['Revision to', '修订'],
  ['Revision', '修订'],
  ['Establishing', '设立'],
  ['Permissible', '许可'],
  ['Nonbanking', '非银行'],
  ['Activities', '活动'],
  ['Holding', '控股'],
  ['Company', '公司'],
  ['Companies', '公司'],
  ['Corporation', '公司'],
  ['Shares', '股份'],
  ['Share', '股份'],
  ['Merger', '合并'],
  ['Mergers', '合并'],
  ['Acquisition', '收购'],
  ['Acquisitions', '收购'],
  ['Formation', '设立'],
  ['Formations', '设立'],
  ['Seal', '印章'],
  ['Official', '官方'],
  ['Virginia', '弗吉尼亚州'],
  ['Indiana', '印第安纳州'],
  ['Pennsylvania', '宾夕法尼亚州'],
  ['California', '加利福尼亚州'],
  ['Texas', '德克萨斯州'],
  ['Michigan', '密歇根州'],
  ['New York', '纽约州'],
  ['Hawaii', '夏威夷州'],
  ['Oregon', '俄勒冈州'],
  ['Colorado', '科罗拉多州'],
  ['Wyoming', '怀俄明州'],
  ['Georgia', '乔治亚州'],
  ['Florida', '佛罗里达州'],
  ['Republic', '共和国'],
  ['European Union', '欧盟'],
  ['United States', '美国'],
  ['People\'s Republic of China', '中华人民共和国'],
  ['China', '中国'],
  ['Japan', '日本'],
  ['Korea', '韩国'],
  ['Taiwan', '台湾'],
  ['Mexico', '墨西哥'],
  ['Canada', '加拿大'],
  ['Australia', '澳大利亚'],
];

const ACRONYM_KEEP = new Set([
  'SEC', 'EPA', 'CFTC', 'FERC', 'OFAC', 'FOMC', 'OMB', 'USDA', 'DOE', 'USTR',
  'VOC', 'RACT', 'NAAQS', 'ARPI', 'SNAP', 'AGOA', 'WTO', 'IPO', 'ETF', 'USD',
  'CAD', 'MXN', 'LLC', 'INC', 'CO', 'PHS', 'VOC', 'RACT', 'FERC', 'NFA',
]);

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortByLengthDesc(pairs) {
  return [...pairs].sort((a, b) => b[0].length - a[0].length);
}

const SORTED_PHRASES = sortByLengthDesc(REGULATORY_PHRASES);
const SORTED_TERMS = sortByLengthDesc(REGULATORY_TERMS);

function cjkCount(text) {
  return (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
}

function latinWordCount(text) {
  const stop = new Set(['of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'the', 'and', 'or', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'issue', 'issues', 'certain', 'connection', 'from', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once']);
  return (String(text).match(/\b[a-zA-Z]{3,}\b/g) || []).filter((w) => {
    const up = w.toUpperCase();
    return !ACRONYM_KEEP.has(up) && !stop.has(w.toLowerCase());
  }).length;
}

function isAcceptableChinese(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  const cjk = cjkCount(s);
  const bad = latinWordCount(s);
  if (cjk >= 8 && bad <= 2) return true;
  if (cjk >= 5 && bad === 0) return true;
  if (cjk >= 4 && bad <= 1 && cjk / s.length >= 0.3) return true;
  return false;
}

function applyPhrases(text) {
  let out = String(text || '');
  for (const [en, zh] of SORTED_PHRASES) {
    out = out.replace(new RegExp(escapeRegExp(en), 'gi'), zh);
  }
  return out;
}

function applyTerms(text) {
  let out = String(text || '');
  for (const [en, zh] of SORTED_TERMS) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(en)}\\b`, 'gi'), zh);
  }
  return out;
}

function normalizeTitle(text) {
  return String(text || '')
    .replace(/\s*;\s*/g, '；')
    .replace(/\s*,\s*/g, '，')
    .replace(/\s+/g, ' ')
    .replace(/\s*；\s*/g, '；')
    .replace(/\s*，\s*/g, '，')
    .trim();
}

function translateSegments(text) {
  const parts = String(text)
    .split(/[;；]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return null;

  const translated = parts.map((part) => translateRegulatoryTitleLocal(part));
  const merged = normalizeTitle(translated.join('；'));
  return isAcceptableChinese(merged) ? merged : null;
}

function cleanupMixed(text) {
  return String(text || '')
    .replace(/\s+of\s+/gi, '')
    .replace(/\s+in\s+/gi, '')
    .replace(/\s+with\s+/gi, '')
    .replace(/\s+for\s+/gi, '针对')
    .replace(/\s+/g, ' ')
    .trim();
}

function translateRegulatoryTitleLocal(text) {
  if (!text) return '';
  if (/[\u4e00-\u9fff]/.test(text) && latinWordCount(text) <= 1) return normalizeTitle(text);

  let out = normalizeTitle(text);
  out = applyPhrases(out);
  out = applyTerms(out);
  out = cleanupMixed(out);
  out = normalizeTitle(out);

  if (!isAcceptableChinese(out)) {
    const segmented = translateSegments(text);
    if (segmented) out = segmented;
  }

  return out;
}

function buildFallbackTitle(text, context = {}) {
  const dept = context.departmentShort || context.departmentName || '美国机构';
  const rawType = String(context.documentType || '').toUpperCase();
  const typeMap = { RULE: '最终规则', PRORULE: '拟议规则', NOTICE: '公告' };
  const docType = context.documentTypeLabel || typeMap[rawType] || '政策公告';
  const local = translateRegulatoryTitleLocal(text);
  if (isAcceptableChinese(local)) return local;

  const commodities = (context.commodities || []).map((c) => c.name).join('、');
  if (commodities) return `${dept}：${docType}（关联${commodities}）`;
  return `${dept}：${docType}`;
}

module.exports = {
  translateRegulatoryTitleLocal,
  translateSegments,
  isAcceptableChinese,
  cjkCount,
  latinWordCount,
  buildFallbackTitle,
  ACRONYM_KEEP,
};
