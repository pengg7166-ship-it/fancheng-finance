/** 政策雷达 — 部委配置与数据源 */
const POLICY_DEPARTMENTS = [
  {
    id: 'csrc',
    name: '证监会',
    shortName: '证监会',
    weight: 1,
    keywords: ['证监会', '证券监督管理', '证券基金', 'IPO', '上市公司', '期货', '股指期权', '注册制'],
  },
  {
    id: 'nfra',
    name: '金融监管总局',
    shortName: '金融监管',
    weight: 1,
    keywords: ['金融监管', '金融监管总局', '银保监会', '银行保险', '商业银行', '理财', '信托', '房地产金融'],
  },
  {
    id: 'pboc',
    name: '中国人民银行',
    shortName: '央行',
    weight: 2,
    keywords: ['人民银行', '央行', '货币政策', '降准', '降息', 'LPR', 'MLF', '逆回购', '外汇存款准备金', '金融稳定'],
  },
  {
    id: 'ndrc',
    name: '国家发展改革委',
    shortName: '发改委',
    weight: 2,
    keywords: ['发改委', '国家发展改革委', '发展改革', '成品油', '电价', '产能', '中央预算', '重大项目', '价格机制'],
  },
  {
    id: 'mara',
    name: '农业农村部',
    shortName: '农业农村部',
    weight: 1,
    keywords: ['农业农村部', '农业部', '粮食', '生猪', '收储', '抛储', '种业', '乡村振兴', '农产品'],
  },
  {
    id: 'mofcom',
    name: '商务部',
    shortName: '商务部',
    weight: 1,
    keywords: ['商务部', '进出口', '外贸', '反倾销', '关税', '出口管制', '世贸组织', 'WTO'],
  },
  {
    id: 'miit',
    name: '工业和信息化部',
    shortName: '工信部',
    weight: 1,
    keywords: ['工信部', '工业和信息化', '制造业', '光伏', '新能源汽车', '钢铁产能', '有色金属', '新材料'],
  },
  {
    id: 'nea',
    name: '国家能源局',
    shortName: '能源局',
    weight: 1,
    keywords: ['能源局', '国家能源', '油气', '煤炭', '电力', '新能源装机', '储能', '原油', '天然气'],
  },
  {
    id: 'gov',
    name: '国务院 / 综合',
    shortName: '国务院',
    weight: 2,
    keywords: ['国务院', '国务院办公厅', '中央人民政府'],
  },
];

const POLICY_RSS_FEEDS = [
  {
    id: 'xinhua-fortune',
    name: '新华社财经',
    url: 'http://www.news.cn/fortune/news_fortune.xml',
    fallbackUrls: ['http://www.xinhuanet.com/fortune/news_fortune.xml'],
    limit: 80,
  },
  {
    id: 'people-finance',
    name: '人民网财经',
    url: 'http://www.people.com.cn/rss/finance.xml',
    limit: 60,
  },
];

const GOV_CN_POLICY = {
  id: 'gov-cn',
  name: '中国政府网',
  url: 'https://www.gov.cn/zhengce/',
  defaultDepartment: 'gov',
};

const POLICY_FETCH_KEYWORDS = [
  ...new Set(POLICY_DEPARTMENTS.flatMap((d) => d.keywords)),
  '政策',
  '监管',
  '产业',
  '大宗',
  '关税',
  '收储',
  '限产',
  '产能',
  '期货',
  '宏观',
];

function getDepartmentById(id) {
  return POLICY_DEPARTMENTS.find((d) => d.id === id) || null;
}

module.exports = {
  POLICY_DEPARTMENTS,
  POLICY_RSS_FEEDS,
  GOV_CN_POLICY,
  POLICY_FETCH_KEYWORDS,
  getDepartmentById,
};
