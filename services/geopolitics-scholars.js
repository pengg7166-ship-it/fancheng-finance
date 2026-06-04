/**
 * 地缘思想库 — 经济学家、战略学家、政治家、科学家的公开论述（用于分析引述）
 * quote 均为其著作/演讲中的代表性观点摘要；work 标明出处
 */
const SCHOLARS = [
  // —— 意识形态 / 文明 / 制度 ——
  {
    id: 'huntington',
    name: '塞缪尔·亨廷顿',
    role: '政治学家',
    work: '《文明的冲突与世界秩序的重建》(1996)',
    dimensions: ['ideology', 'political'],
    topics: ['conflict', 'diplomacy'],
    keywords: ['文明', '冲突', 'identity', '文化', '意识形态', 'civilization'],
    quote: '未来国际冲突的主轴更可能在不同文明之间展开，而非仅停留在意识形态或经济层面。',
  },
  {
    id: 'fukuyama',
    name: '弗朗西斯·福山',
    role: '政治学家',
    work: '《历史的终结与最后的人》(1992)',
    dimensions: ['ideology', 'political'],
    topics: ['election', 'diplomacy'],
    keywords: ['民主', '制度', '自由主义', '意识形态', 'democracy', 'liberal'],
    quote: '制度竞争的核心在于何种治理模式更能提供合法性与稳定性，而非单一答案适用于所有社会。',
  },
  {
    id: 'nye',
    name: '约瑟夫·奈',
    role: '国际关系学者',
    work: '《软实力：世界政坛成功之道》(2004)',
    dimensions: ['ideology', 'political'],
    topics: ['diplomacy', 'tech'],
    keywords: ['软实力', '话语权', '文化', '价值观', 'soft power', 'narrative'],
    quote: '软实力来自价值观的吸引力、政策合法性与文化感召，与硬实力相互补充而非替代。',
  },
  {
    id: 'zakaria',
    name: '法里德·扎卡利亚',
    role: '记者/学者',
    work: '《后美国世界》(2008)',
    dimensions: ['ideology', 'political', 'economic'],
    topics: ['diplomacy', 'trade'],
    keywords: ['多极', '崛起', '秩序', 'rise', 'multipolar'],
    quote: '权力扩散不等于混乱必然发生，但旧秩序规则必须适应新兴力量的利益与诉求。',
  },

  // —— 军事 / 安全 / 现实主义 ——
  {
    id: 'mearsheimer',
    name: '约翰·米尔斯海默',
    role: '国际关系学者',
    work: '《大国政治的悲剧》(2001)',
    dimensions: ['military', 'political'],
    topics: ['conflict', 'maritime', 'nuclear'],
    keywords: ['大国', '安全困境', '制衡', '军事', 'great power', 'security dilemma'],
    quote: '在无最高权威的国际体系中，大国倾向于以实力最大化保障生存，安全竞争具有结构性。',
  },
  {
    id: 'kennan',
    name: '乔治·凯南',
    role: '外交官/战略家',
    work: '长电报 (1946) / 冷战遏制思想',
    dimensions: ['military', 'political', 'ideology'],
    topics: ['conflict', 'sanctions', 'diplomacy'],
    keywords: ['遏制', '扩张', '联盟', 'containment', 'alliance'],
    quote: '应对扩张性力量需要长期、耐心且系统性的制衡，而非仅依赖单次军事决战。',
  },
  {
    id: 'schelling',
    name: '托马斯·谢林',
    role: '经济学家/博弈论学者',
    work: '《冲突的战略》(1960)',
    dimensions: ['military', 'political', 'economic'],
    topics: ['conflict', 'nuclear', 'sanctions'],
    keywords: ['博弈', '威慑', '可信承诺', 'deterrence', 'game theory'],
    quote: '威慑的有效性取决于对手是否相信你真的会在关键时刻采取行动，而不仅是口头威胁。',
  },
  {
    id: 'clausewitz',
    name: '卡尔·冯·克劳塞维茨',
    role: '军事理论家',
    work: '《战争论》(1832)',
    dimensions: ['military', 'political'],
    topics: ['conflict'],
    keywords: ['战争', '政治', '军事', 'war', 'policy'],
    quote: '战争是政治以其他手段的继续；军事手段必须服务于政治目标，否则易陷入消耗。',
  },

  // —— 政治博弈 / 外交 / 地缘大棋局 ——
  {
    id: 'kissinger',
    name: '亨利·基辛格',
    role: '外交家/战略家',
    work: '《论中国》(2011) / 《世界秩序》(2014)',
    dimensions: ['political', 'diplomacy'],
    topics: ['diplomacy', 'conflict', 'trade'],
    keywords: ['均势', '外交', '秩序', 'balance of power', 'diplomacy', 'order'],
    quote: '均势不是静态平衡，而是各方在共同毁灭风险下不断调整的动态过程。',
  },
  {
    id: 'brzezinski',
    name: '兹比格涅夫·布热津斯基',
    role: '地缘战略学家',
    work: '《大棋局》(1997)',
    dimensions: ['political', 'military', 'economic'],
    topics: ['maritime', 'energy', 'diplomacy'],
    keywords: ['欧亚', '地缘', '枢纽', 'Eurasia', 'geopolitics', 'heartland'],
    quote: '欧亚大陆是全球权力博弈的主棋盘，控制枢纽地带者更易塑造周边秩序。',
  },
  {
    id: 'morgenthau',
    name: '汉斯·摩根索',
    role: '国际关系学者',
    work: '《国家间政治》(1948)',
    dimensions: ['political', 'military'],
    topics: ['diplomacy', 'conflict', 'sanctions'],
    keywords: ['国家利益', '权力', 'national interest', 'power politics'],
    quote: '国际政治的本质是以国家利益定义的权力斗争，道德诉求需经由权力结构才能落地。',
  },
  {
    id: 'bull',
    name: '赫德利·布尔',
    role: '国际关系学者',
    work: '《无政府社会》(1977)',
    dimensions: ['political', 'ideology'],
    topics: ['diplomacy', 'sanctions'],
    keywords: ['国际秩序', '规范', '制度', 'international society', 'norms'],
    quote: '国家在无政府状态下仍可形成有限秩序，规则与制度降低冲突成本但无法消除竞争。',
  },

  // —— 经济竞争 / 贸易 / 金融 ——
  {
    id: 'smith',
    name: '亚当·斯密',
    role: '经济学家',
    work: '《国富论》(1776)',
    dimensions: ['economic'],
    topics: ['trade'],
    keywords: ['贸易', '分工', '市场', 'trade', 'division of labor', 'comparative'],
    quote: '分工与贸易可扩大市场范围；但地缘冲突会抬升交易成本，削弱比较优势发挥。',
  },
  {
    id: 'ricardo',
    name: '大卫·李嘉图',
    role: '经济学家',
    work: '《政治经济学及赋税原理》(1817)',
    dimensions: ['economic'],
    topics: ['trade', 'sanctions'],
    keywords: ['比较优势', '关税', 'comparative advantage', 'tariff'],
    quote: '即使一国在所有产业上效率较低，仍可通过比较优势参与贸易；关税与制裁改变这一格局。',
  },
  {
    id: 'keynes',
    name: '约翰·梅纳德·凯恩斯',
    role: '经济学家',
    work: '《就业、利息和货币通论》(1936)',
    dimensions: ['economic', 'political'],
    topics: ['trade', 'sanctions', 'election'],
    keywords: ['需求', '政策', '危机', '财政', 'demand', 'fiscal', 'recession'],
    quote: '长期我们都已不在；短期政策应对危机时，政府行动可稳定总需求与就业预期。',
  },
  {
    id: 'friedman',
    name: '米尔顿·弗里德曼',
    role: '经济学家',
    work: '《资本主义与自由》(1962)',
    dimensions: ['economic', 'ideology'],
    topics: ['trade', 'sanctions'],
    keywords: ['自由市场', '通胀', '货币', 'free market', 'monetary'],
    quote: '通胀在任何时候都是一种货币现象；地缘冲击若引发供应链断裂，也会通过价格传导。',
  },
  {
    id: 'stiglitz',
    name: '约瑟夫·斯蒂格利茨',
    role: '经济学家',
    work: '《全球化及其不满》(2002)',
    dimensions: ['economic', 'ideology', 'political'],
    topics: ['trade', 'sanctions', 'migration'],
    keywords: ['全球化', '不平等', '贸易', 'globalization', 'inequality'],
    quote: '全球化收益分配不均会转化为政治反弹；贸易保护主义往往是国内失衡的外部表现。',
  },
  {
    id: 'rodrik',
    name: '丹尼·罗德里克',
    role: '经济学家',
    work: '《全球化的悖论》(2011)',
    dimensions: ['economic', 'political'],
    topics: ['trade', 'sanctions', 'tech'],
    keywords: ['全球化', '主权', '三元悖论', 'trilemma', 'sovereignty'],
    quote: '全球化、民主与国家主权难以同时最大化，各国必须在三者间作出权衡。',
  },
  {
    id: 'pettis',
    name: '迈克尔·佩蒂斯',
    role: '经济学家',
    work: '《贸易冲突是常态》(2019)',
    dimensions: ['economic', 'political'],
    topics: ['trade', 'sanctions'],
    keywords: ['贸易失衡', '储蓄', '关税', 'imbalance', 'China', '美国'],
    quote: '贸易冲突常源于国内储蓄-投资结构失衡，关税只是再分配冲突成本的政治工具。',
  },
  {
    id: 'krugman',
    name: '保罗·克鲁格曼',
    role: '经济学家',
    work: '《地理与贸易》(1991) / NYT 专栏',
    dimensions: ['economic', 'political'],
    topics: ['trade', 'sanctions', 'energy'],
    keywords: ['贸易', '汇率', '关税', 'trade war', 'currency'],
    quote: '贸易战没有赢家，但短期政治激励常使各国陷入相互报复的囚徒困境。',
  },
  {
    id: 'schumpeter',
    name: '约瑟夫·熊彼特',
    role: '经济学家',
    work: '《资本主义、社会主义与民主》(1942)',
    dimensions: ['economic', 'ideology', 'tech'],
    topics: ['tech', 'trade'],
    keywords: ['创新', '破坏', '竞争', 'innovation', 'creative destruction'],
    quote: '创造性破坏驱动长期增长；科技竞争是国家经济竞争在产业层面的集中体现。',
  },

  // —— 能源 / 资源 / 科学 ——
  {
    id: 'yergin',
    name: '丹尼尔·耶金',
    role: '能源经济学家',
    work: '《能源重塑世界》(2011)',
    dimensions: ['economic', 'military', 'political'],
    topics: ['energy', 'sanctions', 'maritime'],
    keywords: ['石油', '天然气', '能源', 'oil', 'gas', 'OPEC', 'LNG'],
    quote: '能源安全不仅是储量问题，更是供应链、运输通道与地缘政治的综合函数。',
  },
  {
    id: 'taleb',
    name: '纳西姆·塔勒布',
    role: '风险学家',
    work: '《黑天鹅》(2007)',
    dimensions: ['economic', 'military', 'political'],
    topics: ['conflict', 'energy', 'tech'],
    keywords: ['风险', '尾部', '不确定', 'black swan', 'risk', 'tail risk'],
    quote: '尾部事件对系统的冲击远超日常波动；地缘冲突是最典型的低概率、高影响黑天鹅源。',
  },
  {
    id: 'sachs',
    name: '杰弗里·萨克斯',
    role: '经济学家',
    work: '《文明的代价》(2008) 等',
    dimensions: ['economic', 'political', 'ideology'],
    topics: ['diplomacy', 'sanctions', 'migration'],
    keywords: ['发展', '援助', '和平', 'development', 'sanctions'],
    quote: '发展合作与制裁并存时，需区分安全目标与经济代价，避免穷人承担主要成本。',
  },
];

function matchScholars({ dimensions = [], topics = [], text = '' }, limit = 2) {
  const dimSet = new Set(dimensions.map((d) => d.id || d));
  const topicSet = new Set(topics.map((t) => t.id || t));
  const hay = String(text || '').toLowerCase();

  const scored = SCHOLARS.map((s) => {
    let score = 0;
    for (const d of s.dimensions) {
      if (dimSet.has(d)) score += 4;
    }
    for (const t of s.topics) {
      if (topicSet.has(t)) score += 3;
    }
    for (const kw of s.keywords) {
      const lk = kw.toLowerCase();
      if (hay.includes(lk) || text.includes(kw)) score += 1;
    }
    return { ...s, matchScore: score };
  })
    .filter((s) => s.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore);

  return scored.slice(0, limit).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    work: s.work,
    quote: s.quote,
    relevance: s.matchScore >= 6 ? '高度相关' : '参照视角',
  }));
}

module.exports = {
  SCHOLARS,
  matchScholars,
};
