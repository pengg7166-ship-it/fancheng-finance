/** 地缘政治 — 区域、国家影响力、资讯源配置 */

const REGIONS = [
  { id: 'asia', label: '亚洲', flag: '🌏' },
  { id: 'americas', label: '美洲', flag: '🌎' },
  { id: 'europe', label: '欧洲', flag: '🇪🇺' },
  { id: 'africa', label: '非洲', flag: '🌍' },
  { id: 'oceania', label: '澳洲/大洋洲', flag: '🌊' },
  { id: 'global', label: '全球/多边', flag: '🌐' },
];

/**
 * 国家国际影响力 baseInfluence: 1–5 星（综合经济体量、军事、外交、能源与区域权重）
 * keywords: 中/英匹配词
 */
const COUNTRIES = [
  // —— 5 星 ——
  { id: 'us', name: '美国', nameEn: 'United States', region: 'americas', baseInfluence: 5, flag: '🇺🇸', keywords: ['美国', '美方', '华盛顿', '白宫', 'US', 'U.S.', 'United States', 'America', 'Washington', 'White House', 'Pentagon', 'Congress', 'Biden', 'Trump'] },
  { id: 'cn', name: '中国', nameEn: 'China', region: 'asia', baseInfluence: 5, flag: '🇨🇳', keywords: ['中国', '中方', '北京', 'China', 'Chinese', 'Beijing', 'PRC', 'Taiwan Strait', '台海'] },
  { id: 'ru', name: '俄罗斯', nameEn: 'Russia', region: 'europe', baseInfluence: 5, flag: '🇷🇺', keywords: ['俄罗斯', '俄方', '莫斯科', 'Russia', 'Russian', 'Moscow', 'Kremlin', 'Putin', '普京'] },
  { id: 'eu', name: '欧盟', nameEn: 'European Union', region: 'europe', baseInfluence: 5, flag: '🇪🇺', keywords: ['欧盟', '欧洲联盟', 'EU', 'European Union', 'Brussels', '布鲁塞尔', 'European Commission'] },
  { id: 'uk', name: '英国', nameEn: 'United Kingdom', region: 'europe', baseInfluence: 5, flag: '🇬🇧', keywords: ['英国', 'UK', 'U.K.', 'United Kingdom', 'Britain', 'British', 'London', 'Downing Street'] },
  { id: 'jp', name: '日本', nameEn: 'Japan', region: 'asia', baseInfluence: 5, flag: '🇯🇵', keywords: ['日本', '日方', 'Japan', 'Japanese', 'Tokyo', '东京'] },

  // —— 4 星 ——
  { id: 'in', name: '印度', nameEn: 'India', region: 'asia', baseInfluence: 4, flag: '🇮🇳', keywords: ['印度', 'India', 'Indian', 'New Delhi', 'Modi', '莫迪'] },
  { id: 'de', name: '德国', nameEn: 'Germany', region: 'europe', baseInfluence: 4, flag: '🇩🇪', keywords: ['德国', 'Germany', 'German', 'Berlin', '柏林'] },
  { id: 'fr', name: '法国', nameEn: 'France', region: 'europe', baseInfluence: 4, flag: '🇫🇷', keywords: ['法国', 'France', 'French', 'Paris', 'Macron', '马克龙'] },
  { id: 'sa', name: '沙特阿拉伯', nameEn: 'Saudi Arabia', region: 'asia', baseInfluence: 4, flag: '🇸🇦', keywords: ['沙特', '沙特阿拉伯', 'Saudi', 'Riyadh', '利雅得', 'OPEC+'] },
  { id: 'ir', name: '伊朗', nameEn: 'Iran', region: 'asia', baseInfluence: 4, flag: '🇮🇷', keywords: ['伊朗', 'Iran', 'Iranian', 'Tehran', '德黑兰'] },
  { id: 'il', name: '以色列', nameEn: 'Israel', region: 'asia', baseInfluence: 4, flag: '🇮🇱', keywords: ['以色列', 'Israel', 'Israeli', 'Tel Aviv', 'Jerusalem', '加沙', 'Gaza', '哈马斯', 'Hamas'] },
  { id: 'tr', name: '土耳其', nameEn: 'Turkey', region: 'asia', baseInfluence: 4, flag: '🇹🇷', keywords: ['土耳其', 'Turkey', 'Turkish', 'Türkiye', 'Ankara', '埃尔多安', 'Erdogan'] },
  { id: 'br', name: '巴西', nameEn: 'Brazil', region: 'americas', baseInfluence: 4, flag: '🇧🇷', keywords: ['巴西', 'Brazil', 'Brazilian', 'Brasilia', 'Brasil'] },
  { id: 'kr', name: '韩国', nameEn: 'South Korea', region: 'asia', baseInfluence: 4, flag: '🇰🇷', keywords: ['韩国', 'South Korea', 'Korean', 'Seoul', '首尔', '朝鲜', 'North Korea', 'DPRK', 'Kim Jong'] },

  // —— 3 星 ——
  { id: 'ca', name: '加拿大', nameEn: 'Canada', region: 'americas', baseInfluence: 3, flag: '🇨🇦', keywords: ['加拿大', 'Canada', 'Canadian', 'Ottawa'] },
  { id: 'au', name: '澳大利亚', nameEn: 'Australia', region: 'oceania', baseInfluence: 3, flag: '🇦🇺', keywords: ['澳大利亚', '澳洲', 'Australia', 'Australian', 'Canberra', '悉尼', 'Sydney'] },
  { id: 'id', name: '印度尼西亚', nameEn: 'Indonesia', region: 'asia', baseInfluence: 3, flag: '🇮🇩', keywords: ['印尼', '印度尼西亚', 'Indonesia', 'Jakarta', '雅加达'] },
  { id: 'mx', name: '墨西哥', nameEn: 'Mexico', region: 'americas', baseInfluence: 3, flag: '🇲🇽', keywords: ['墨西哥', 'Mexico', 'Mexican'] },
  { id: 'za', name: '南非', nameEn: 'South Africa', region: 'africa', baseInfluence: 3, flag: '🇿🇦', keywords: ['南非', 'South Africa', 'South African'] },
  { id: 'eg', name: '埃及', nameEn: 'Egypt', region: 'africa', baseInfluence: 3, flag: '🇪🇬', keywords: ['埃及', 'Egypt', 'Egyptian', 'Cairo', '开罗', '苏伊士'] },
  { id: 'pk', name: '巴基斯坦', nameEn: 'Pakistan', region: 'asia', baseInfluence: 3, flag: '🇵🇰', keywords: ['巴基斯坦', 'Pakistan', 'Pakistani', 'Islamabad'] },
  { id: 'tw', name: '台湾', nameEn: 'Taiwan', region: 'asia', baseInfluence: 3, flag: '🏝️', keywords: ['台湾', 'Taiwan', 'Taipei', '台北', '赖清德', 'Tsai'] },
  { id: 'ua', name: '乌克兰', nameEn: 'Ukraine', region: 'europe', baseInfluence: 3, flag: '🇺🇦', keywords: ['乌克兰', 'Ukraine', 'Ukrainian', 'Kyiv', '基辅', 'Zelensky', '泽连斯基'] },
  { id: 'pl', name: '波兰', nameEn: 'Poland', region: 'europe', baseInfluence: 3, flag: '🇵🇱', keywords: ['波兰', 'Poland', 'Polish', 'Warsaw'] },
  { id: 'it', name: '意大利', nameEn: 'Italy', region: 'europe', baseInfluence: 3, flag: '🇮🇹', keywords: ['意大利', 'Italy', 'Italian', 'Rome', '罗马'] },
  { id: 'es', name: '西班牙', nameEn: 'Spain', region: 'europe', baseInfluence: 3, flag: '🇪🇸', keywords: ['西班牙', 'Spain', 'Spanish', 'Madrid'] },
  { id: 'ng', name: '尼日利亚', nameEn: 'Nigeria', region: 'africa', baseInfluence: 3, flag: '🇳🇬', keywords: ['尼日利亚', 'Nigeria', 'Nigerian'] },
  { id: 'ae', name: '阿联酋', nameEn: 'UAE', region: 'asia', baseInfluence: 3, flag: '🇦🇪', keywords: ['阿联酋', 'UAE', 'United Arab Emirates', 'Dubai', 'Abu Dhabi', '迪拜'] },

  // —— 2 星 ——
  { id: 'ar', name: '阿根廷', nameEn: 'Argentina', region: 'americas', baseInfluence: 2, flag: '🇦🇷', keywords: ['阿根廷', 'Argentina', 'Argentine', 'Buenos Aires'] },
  { id: 'cl', name: '智利', nameEn: 'Chile', region: 'americas', baseInfluence: 2, flag: '🇨🇱', keywords: ['智利', 'Chile', 'Chilean', 'Santiago'] },
  { id: 'co', name: '哥伦比亚', nameEn: 'Colombia', region: 'americas', baseInfluence: 2, flag: '🇨🇴', keywords: ['哥伦比亚', 'Colombia', 'Colombian'] },
  { id: 've', name: '委内瑞拉', nameEn: 'Venezuela', region: 'americas', baseInfluence: 2, flag: '🇻🇪', keywords: ['委内瑞拉', 'Venezuela', 'Venezuelan', 'Maduro'] },
  { id: 'vn', name: '越南', nameEn: 'Vietnam', region: 'asia', baseInfluence: 2, flag: '🇻🇳', keywords: ['越南', 'Vietnam', 'Vietnamese', 'Hanoi', '河内'] },
  { id: 'th', name: '泰国', nameEn: 'Thailand', region: 'asia', baseInfluence: 2, flag: '🇹🇭', keywords: ['泰国', 'Thailand', 'Thai', 'Bangkok', '曼谷'] },
  { id: 'my', name: '马来西亚', nameEn: 'Malaysia', region: 'asia', baseInfluence: 2, flag: '🇲🇾', keywords: ['马来西亚', 'Malaysia', 'Malaysian', 'Kuala Lumpur'] },
  { id: 'ph', name: '菲律宾', nameEn: 'Philippines', region: 'asia', baseInfluence: 2, flag: '🇵🇭', keywords: ['菲律宾', 'Philippines', 'Filipino', 'Manila', '马尼拉'] },
  { id: 'nz', name: '新西兰', nameEn: 'New Zealand', region: 'oceania', baseInfluence: 2, flag: '🇳🇿', keywords: ['新西兰', 'New Zealand', 'NZ', 'Wellington'] },
  { id: 'ke', name: '肯尼亚', nameEn: 'Kenya', region: 'africa', baseInfluence: 2, flag: '🇰🇪', keywords: ['肯尼亚', 'Kenya', 'Kenyan', 'Nairobi'] },
  { id: 'et', name: '埃塞俄比亚', nameEn: 'Ethiopia', region: 'africa', baseInfluence: 2, flag: '🇪🇹', keywords: ['埃塞俄比亚', 'Ethiopia', 'Ethiopian'] },
  { id: 'ma', name: '摩洛哥', nameEn: 'Morocco', region: 'africa', baseInfluence: 2, flag: '🇲🇦', keywords: ['摩洛哥', 'Morocco', 'Moroccan'] },
  { id: 'qa', name: '卡塔尔', nameEn: 'Qatar', region: 'asia', baseInfluence: 2, flag: '🇶🇦', keywords: ['卡塔尔', 'Qatar', 'Qatari', 'Doha'] },
  { id: 'iq', name: '伊拉克', nameEn: 'Iraq', region: 'asia', baseInfluence: 2, flag: '🇮🇶', keywords: ['伊拉克', 'Iraq', 'Iraqi', 'Baghdad', '巴格达'] },
  { id: 'sy', name: '叙利亚', nameEn: 'Syria', region: 'asia', baseInfluence: 2, flag: '🇸🇾', keywords: ['叙利亚', 'Syria', 'Syrian', 'Damascus'] },
  { id: 'ye', name: '也门', nameEn: 'Yemen', region: 'asia', baseInfluence: 2, flag: '🇾🇪', keywords: ['也门', 'Yemen', 'Yemeni', 'Houthi', '胡塞'] },
  { id: 'mm', name: '缅甸', nameEn: 'Myanmar', region: 'asia', baseInfluence: 2, flag: '🇲🇲', keywords: ['缅甸', 'Myanmar', 'Burmese', 'Rohingya'] },
  { id: 'bd', name: '孟加拉国', nameEn: 'Bangladesh', region: 'asia', baseInfluence: 2, flag: '🇧🇩', keywords: ['孟加拉', 'Bangladesh', 'Bangladeshi', 'Dhaka'] },

  // —— 1 星（区域代表性） ——
  { id: 'sg', name: '新加坡', nameEn: 'Singapore', region: 'asia', baseInfluence: 1, flag: '🇸🇬', keywords: ['新加坡', 'Singapore', 'Singaporean'] },
  { id: 'lk', name: '斯里兰卡', nameEn: 'Sri Lanka', region: 'asia', baseInfluence: 1, flag: '🇱🇰', keywords: ['斯里兰卡', 'Sri Lanka'] },
  { id: 'np', name: '尼泊尔', nameEn: 'Nepal', region: 'asia', baseInfluence: 1, flag: '🇳🇵', keywords: ['尼泊尔', 'Nepal', 'Nepalese'] },
  { id: 'kz', name: '哈萨克斯坦', nameEn: 'Kazakhstan', region: 'asia', baseInfluence: 1, flag: '🇰🇿', keywords: ['哈萨克斯坦', 'Kazakhstan', 'Kazakh'] },
  { id: 'uz', name: '乌兹别克斯坦', nameEn: 'Uzbekistan', region: 'asia', baseInfluence: 1, flag: '🇺🇿', keywords: ['乌兹别克', 'Uzbekistan'] },
  { id: 'pe', name: '秘鲁', nameEn: 'Peru', region: 'americas', baseInfluence: 1, flag: '🇵🇪', keywords: ['秘鲁', 'Peru', 'Peruvian'] },
  { id: 'ec', name: '厄瓜多尔', nameEn: 'Ecuador', region: 'americas', baseInfluence: 1, flag: '🇪🇨', keywords: ['厄瓜多尔', 'Ecuador'] },
  { id: 'cu', name: '古巴', nameEn: 'Cuba', region: 'americas', baseInfluence: 1, flag: '🇨🇺', keywords: ['古巴', 'Cuba', 'Cuban', 'Havana'] },
  { id: 'gr', name: '希腊', nameEn: 'Greece', region: 'europe', baseInfluence: 1, flag: '🇬🇷', keywords: ['希腊', 'Greece', 'Greek', 'Athens'] },
  { id: 'nl', name: '荷兰', nameEn: 'Netherlands', region: 'europe', baseInfluence: 1, flag: '🇳🇱', keywords: ['荷兰', 'Netherlands', 'Dutch', 'Amsterdam'] },
  { id: 'se', name: '瑞典', nameEn: 'Sweden', region: 'europe', baseInfluence: 1, flag: '🇸🇪', keywords: ['瑞典', 'Sweden', 'Swedish', 'Stockholm'] },
  { id: 'no', name: '挪威', nameEn: 'Norway', region: 'europe', baseInfluence: 1, flag: '🇳🇴', keywords: ['挪威', 'Norway', 'Norwegian', 'Oslo'] },
  { id: 'ch', name: '瑞士', nameEn: 'Switzerland', region: 'europe', baseInfluence: 1, flag: '🇨🇭', keywords: ['瑞士', 'Switzerland', 'Swiss', 'Bern'] },
  { id: 'hu', name: '匈牙利', nameEn: 'Hungary', region: 'europe', baseInfluence: 1, flag: '🇭🇺', keywords: ['匈牙利', 'Hungary', 'Hungarian', 'Orban'] },
  { id: 'ro', name: '罗马尼亚', nameEn: 'Romania', region: 'europe', baseInfluence: 1, flag: '🇷🇴', keywords: ['罗马尼亚', 'Romania', 'Romanian'] },
  { id: 'gh', name: '加纳', nameEn: 'Ghana', region: 'africa', baseInfluence: 1, flag: '🇬🇭', keywords: ['加纳', 'Ghana', 'Ghanaian'] },
  { id: 'tz', name: '坦桑尼亚', nameEn: 'Tanzania', region: 'africa', baseInfluence: 1, flag: '🇹🇿', keywords: ['坦桑尼亚', 'Tanzania'] },
  { id: 'dz', name: '阿尔及利亚', nameEn: 'Algeria', region: 'africa', baseInfluence: 1, flag: '🇩🇿', keywords: ['阿尔及利亚', 'Algeria', 'Algerian'] },
  { id: 'ly', name: '利比亚', nameEn: 'Libya', region: 'africa', baseInfluence: 1, flag: '🇱🇾', keywords: ['利比亚', 'Libya', 'Libyan'] },
  { id: 'sd', name: '苏丹', nameEn: 'Sudan', region: 'africa', baseInfluence: 1, flag: '🇸🇩', keywords: ['苏丹', 'Sudan', 'Sudanese'] },
  { id: 'fj', name: '斐济', nameEn: 'Fiji', region: 'oceania', baseInfluence: 1, flag: '🇫🇯', keywords: ['斐济', 'Fiji'] },
  { id: 'pg', name: '巴布亚新几内亚', nameEn: 'Papua New Guinea', region: 'oceania', baseInfluence: 1, flag: '🇵🇬', keywords: ['巴布亚', 'Papua New Guinea'] },
  { id: 'un', name: '联合国/多边', nameEn: 'United Nations', region: 'global', baseInfluence: 4, flag: '🇺🇳', keywords: ['联合国', 'UN', 'United Nations', 'G7', 'G20', '北约', 'NATO', 'APEC', '东盟', 'ASEAN', '上合', 'SCO', '金砖', 'BRICS', 'OPEC', '世贸', 'WTO', 'IMF', '世界银行', 'World Bank'] },
];

const GEOPOLITICS_TOPICS = [
  { id: 'conflict', label: '武装冲突', weight: 3, keywords: ['战争', '冲突', '军事', '袭击', '导弹', '轰炸', 'war', 'conflict', 'military', 'attack', 'strike', 'missile', 'invasion', 'ceasefire', '停火', '交火', '武装', 'drone', '无人机', '核威慑'] },
  { id: 'sanctions', label: '制裁/管制', weight: 2.5, keywords: ['制裁', '禁运', '出口管制', '实体清单', 'sanction', 'embargo', 'blacklist', 'OFAC', '长臂管辖', '脱钩'] },
  { id: 'diplomacy', label: '外交/谈判', weight: 2, keywords: ['外交', '会谈', '峰会', '访问', 'diplomacy', 'summit', 'talks', 'negotiation', 'treaty', '协议', 'ambassador', '外长', '斡旋'] },
  { id: 'election', label: '选举/政权', weight: 2, keywords: ['选举', '大选', '公投', '政变', 'election', 'vote', 'referendum', 'coup', 'inauguration', '就职', '议会'] },
  { id: 'trade', label: '贸易/关税', weight: 2.5, keywords: ['贸易', '关税', '自贸', '贸易战', 'trade', 'tariff', 'FTA', '出口', '进口', 'supply chain', '供应链', '产业链', '反倾销'] },
  { id: 'energy', label: '能源/资源', weight: 2.5, keywords: ['石油', '天然气', '能源', 'oil', 'gas', 'LNG', 'pipeline', '管道', 'OPEC', '原油', '炼油', '关键矿产', '稀土'] },
  { id: 'nuclear', label: '核问题', weight: 3, keywords: ['核', 'nuclear', 'uranium', '铀', '核试验', '核武器', 'NPT', 'IAEA', '核扩散'] },
  { id: 'migration', label: '移民/人道', weight: 1.5, keywords: ['难民', '移民', 'humanitarian', 'refugee', 'migration', '人道主义'] },
  { id: 'tech', label: '科技/标准', weight: 2.5, keywords: ['芯片', '半导体', '科技战', 'chip', 'semiconductor', 'cyber', '网络', '数据安全', 'AI', '人工智能', '标准', '5G', '量子'] },
  { id: 'maritime', label: '海上/航道', weight: 2.5, keywords: ['南海', '东海', '海峡', '航运', 'Red Sea', '红海', '霍尔木兹', 'Hormuz', '苏伊士', 'maritime', 'naval', '马六甲', '北极航道'] },
  { id: 'finance', label: '金融/货币', weight: 2, keywords: ['美元', '制裁金融', 'SWIFT', '汇率', '国债', '央行', 'currency', 'dollar', 'bond', '债务', 'IMF', '世行'] },
  { id: 'alliance', label: '联盟/集团', weight: 2, keywords: ['北约', 'NATO', 'AUKUS', '印太', '联盟', 'alliance', '集团', 'bloc', '军事同盟'] },
];

/** 四维大国竞争框架 */
const COMPETITION_DIMENSIONS = [
  {
    id: 'ideology',
    label: '意识形态竞争',
    shortLabel: '意识形态',
    icon: '📜',
    color: '#c084fc',
    description: '价值观、制度叙事、话语权与文明认同的竞争',
    keywords: [
      '意识形态', '价值观', '民主', '威权', '叙事', '话语权', '文明', '宗教', '软实力',
      'propaganda', 'ideology', 'values', 'narrative', 'civilization', 'human rights', '人权',
      '审查', '媒体', '信息战', '认知', '普世', '模式', '道路', '制度优势', '颜色革命',
    ],
  },
  {
    id: 'military',
    label: '军事竞争',
    shortLabel: '军事',
    icon: '⚔️',
    color: '#ef4444',
    description: '武力部署、军备、威慑、冲突与防务联盟',
    keywords: [
      '军事', '军队', '导弹', '核', '军备', '防务', '战争', '冲突', '演习', '部署', '武器',
      'military', 'army', 'navy', 'air force', 'defense', 'weapon', 'nuclear', 'deterrence',
      '威慑', '无人机', '航母', '北约', 'NATO', '军售', '征兵', '占领', '袭击', '轰炸',
    ],
  },
  {
    id: 'political',
    label: '政治博弈',
    shortLabel: '政治',
    icon: '🏛️',
    color: '#3b82f6',
    description: '外交、选举、联盟、秩序与权力平衡',
    keywords: [
      '外交', '政治', '选举', '峰会', '协议', '制裁政治', '承认', '建交', '断交', '斡旋',
      'political', 'diplomacy', 'summit', 'treaty', 'election', 'regime', 'government',
      '总统', '总理', '议会', '政变', '承认', '联合国', '多边', '秩序', '博弈', '制衡',
    ],
  },
  {
    id: 'economic',
    label: '经济竞争博弈',
    shortLabel: '经济',
    icon: '💹',
    color: '#22c55e',
    description: '贸易、关税、金融、产业链、资源与科技经济战',
    keywords: [
      '经济', '贸易', '关税', '制裁', '产业链', '供应链', '投资', '市场', '金融', '货币',
      'economic', 'trade', 'tariff', 'sanction', 'investment', 'GDP', '出口', '进口',
      '脱钩', '去风险', '补贴', '倾销', '汇率', '债务', '资源', '石油', '芯片', '稀土',
    ],
  },
];

const GEOPOLITICS_RSS_FEEDS = [
  { id: 'xinhua-world', name: '新华网·国际', url: 'http://www.news.cn/world/news_world.xml', region: 'global', lang: 'zh' },
  { id: 'xinhua-world-alt', name: '新华网·国际', url: 'http://www.xinhuanet.com/world/news_world.xml', region: 'global', lang: 'zh' },
  { id: 'people-world', name: '人民网·国际', url: 'http://www.people.com.cn/rss/world.xml', region: 'global', lang: 'zh' },
  { id: 'people-politics', name: '人民网·时政', url: 'http://www.people.com.cn/rss/politics.xml', region: 'global', lang: 'zh' },
  { id: 'cctv-world', name: '央视·国际', url: 'https://news.cctv.com/rss/world.xml', region: 'global', lang: 'zh' },
  { id: 'china-daily', name: '中国日报', url: 'http://www.chinadaily.com.cn/rss/world_rss.xml', region: 'global', lang: 'en', translate: true },
  { id: 'un-news', name: '联合国新闻', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', region: 'global', lang: 'en', translate: true },
  { id: 'aljazeera', name: '半岛电视台', url: 'https://www.aljazeera.com/xml/rss/all.xml', region: 'global', lang: 'en', translate: true },
  { id: 'guardian-world', name: '卫报·国际', url: 'https://www.theguardian.com/world/rss', region: 'global', lang: 'en', translate: true },
  { id: 'guardian-opinion', name: '卫报·评论', url: 'https://www.theguardian.com/commentisfree/rss', region: 'global', lang: 'en', translate: true },
  { id: 'bbc-world', name: 'BBC·国际', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', region: 'global', lang: 'en', translate: true },
  { id: 'dw-world', name: '德国之声', url: 'https://rss.dw.com/xml/rss-en-world', region: 'global', lang: 'en', translate: true },
  { id: 'france24', name: 'France24', url: 'https://www.france24.com/en/rss', region: 'global', lang: 'en', translate: true },
  { id: 'npr-world', name: 'NPR·国际', url: 'https://feeds.npr.org/1004/rss.xml', region: 'global', lang: 'en', translate: true },
  { id: 'rferl', name: '自由欧洲电台', url: 'https://www.rferl.org/api/z-qveovr', region: 'global', lang: 'en', translate: true },
];

const GEOPOLITICS_SEARCH_QUERIES = [
  // 综合
  '地缘政治', '国际局势', '大国博弈', '全球秩序', '冷战', '热战',
  // 意识形态
  '意识形态', '价值观外交', '软实力', '文明冲突', '信息战', '舆论战',
  // 军事
  '军事冲突', '军备竞赛', '核威慑', '防务联盟', '北约东扩', '印太战略', 'AUKUS',
  // 政治
  '外交政策', '权力平衡', '联合国改革', 'G7峰会', 'G20', '金砖国家', '上合组织',
  // 经济
  '贸易战', '关税战', '经济制裁', '产业链转移', '去风险', '金融制裁', 'SWIFT',
  // 热点区域
  '中东局势', '俄乌冲突', '台海局势', '南海', '中美关系', '中欧关系', '非洲资源',
  '拉美左翼', '亚太安全', '红海航运', '关键矿产', '科技封锁', '芯片禁令',
];

const GEOPOLITICS_RELEVANCE_KEYWORDS = [
  ...COMPETITION_DIMENSIONS.flatMap((d) => d.keywords.slice(0, 20)),
  ...GEOPOLITICS_TOPICS.flatMap((t) => t.keywords),
  ...COUNTRIES.flatMap((c) => c.keywords.slice(0, 6)),
  '政府', '总统', '总理', '外交部', '国防部', '议会', 'policy', 'government', 'minister',
  '国际', '全球', '地区', '局势', '战略', '安全', '联盟', '条约', '博弈', '竞争',
];

function getRegionById(id) {
  return REGIONS.find((r) => r.id === id) || { id, label: id, flag: '🌐' };
}

function getCountryById(id) {
  return COUNTRIES.find((c) => c.id === id) || null;
}

function listCountriesByRegion(regionId) {
  if (!regionId || regionId === 'all') return COUNTRIES;
  return COUNTRIES.filter((c) => c.region === regionId);
}

function listCountriesByInfluence(minStars = 1) {
  return COUNTRIES.filter((c) => c.baseInfluence >= minStars);
}

module.exports = {
  REGIONS,
  COUNTRIES,
  COMPETITION_DIMENSIONS,
  GEOPOLITICS_TOPICS,
  GEOPOLITICS_RSS_FEEDS,
  GEOPOLITICS_SEARCH_QUERIES,
  GEOPOLITICS_RELEVANCE_KEYWORDS,
  getRegionById,
  getCountryById,
  listCountriesByRegion,
  listCountriesByInfluence,
};
