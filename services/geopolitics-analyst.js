/**
 * 地缘深度分析 — 四维竞争识别、逻辑链串联、学者引述
 */
const { matchScholars } = require('./geopolitics-scholars');
const { COMPETITION_DIMENSIONS } = require('./geopolitics-sources');

const LOGIC_TEMPLATES = {
  ideology: {
    step1: (actors, fact) => `${actors}在舆论与制度叙事上展开竞争，事件焦点：${fact}`,
    step2: () => '价值与身份认同差异→联盟站队与规则制定权争夺→国际话语权此消彼长',
    step3: () => '跨国企业合规成本上升、学术/媒体合作受限、区域公共产品供给波动',
  },
  military: {
    step1: (actors, fact) => `${actors}安全互动升级，事件焦点：${fact}`,
    step2: () => '武力展示/部署调整→安全困境与军备竞赛预期→防务开支与联盟义务重估',
    step3: () => '能源与航运保费上升、避险资产波动、军工供应链订单变化',
  },
  political: {
    step1: (actors, fact) => `${actors}在政治层面博弈，事件焦点：${fact}`,
    step2: () => '权力平衡变动→外交策略与制度安排调整→政策不确定性抬升',
    step3: () => '选举周期政策摇摆、双边协议执行风险、资本跨境流动谨慎',
  },
  economic: {
    step1: (actors, fact) => `${actors}在经济领域角力，事件焦点：${fact}`,
    step2: () => '关税/制裁/产业链重组→贸易路径与成本结构变化→相关商品与资产价格重定价',
    step3: () => '进出口企业利润波动、汇率与利率预期修正、大宗商品供需再平衡',
  },
};

const CROSS_LOGIC = {
  'ideology+military': '叙事竞争与武力威慑相互强化，易形成「话语—行动」螺旋。',
  'ideology+economic': '制度叙事差异通过贸易与科技规则落地，长期影响产业链布局。',
  'political+economic': '政治博弈常借关税、制裁等经济工具实现，需区分目标与代价。',
  'military+economic': '安全冲突直接扰动能源、航运与保险成本，再反馈至财政与通胀。',
  'ideology+political': '合法性竞争决定联盟组合，影响多边机制效率。',
  'military+political': '军事压力改变谈判筹码，外交窗口期往往短暂。',
  'ideology+economic+military': '三线并进时，市场需同时定价安全溢价、规则风险与需求冲击。',
};

function detectDimensions(text) {
  const hay = String(text || '');
  const lower = hay.toLowerCase();
  const hits = [];

  for (const dim of COMPETITION_DIMENSIONS) {
    let score = 0;
    for (const kw of dim.keywords) {
      const lk = kw.toLowerCase();
      if (lower.includes(lk) || hay.includes(kw)) score += lk.length >= 4 ? 2 : 1;
    }
    if (score > 0) {
      hits.push({
        id: dim.id,
        label: dim.label,
        shortLabel: dim.shortLabel,
        icon: dim.icon,
        intensity: Math.min(3, Math.ceil(score / 3)),
        score,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) {
    return [{ id: 'political', label: '政治博弈', shortLabel: '政治', icon: '🏛️', intensity: 1, score: 0 }];
  }
  return hits.slice(0, 3);
}

function shortenFact(title, max = 36) {
  const s = String(title || '').trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function summarizeActors(countries) {
  if (!countries?.length) return '主要行为体';
  return countries
    .slice(0, 2)
    .map((c) => c.name)
    .join('与');
}

function buildCrossNote(dimIds) {
  const key = [...new Set(dimIds)].sort().join('+');
  for (const [pattern, note] of Object.entries(CROSS_LOGIC)) {
    const parts = pattern.split('+');
    if (parts.every((p) => dimIds.includes(p)) && dimIds.length >= 2) return note;
  }
  if (dimIds.length >= 3) return CROSS_LOGIC['ideology+economic+military'];
  return '';
}

function buildLogicChain(item, dimensions) {
  const primary = dimensions[0]?.id || 'political';
  const tpl = LOGIC_TEMPLATES[primary] || LOGIC_TEMPLATES.political;
  const actors = summarizeActors(item.countries);
  const fact = shortenFact(item.title);

  const chain = [
    { step: 1, label: '事件', text: tpl.step1(actors, fact) },
    { step: 2, label: '机制', text: tpl.step2() },
    { step: 3, label: '外溢', text: tpl.step3() },
  ];

  const cross = buildCrossNote(dimensions.map((d) => d.id));
  if (cross && dimensions.length >= 2) {
    chain.push({ step: 4, label: '交叉', text: cross });
  }

  return chain;
}

function buildImpactLine(item, dimensions, topics) {
  const dimIds = dimensions.map((d) => d.id);
  const topicId = topics[0]?.id || 'diplomacy';
  const lines = {
    conflict: '关注原油/黄金波动、防务板块、航运保险费率',
    sanctions: '关注跨境支付、替代供应链、受制裁国相关资产',
    trade: '关注关税敏感行业、汇率、出口导向型企业',
    energy: '关注油气/LNG价格、炼化利润、能源进口依存度',
    tech: '关注半导体、关键矿产、出口管制清单',
    nuclear: '关注地缘溢价、铀价、避险需求',
    maritime: '关注红海/马六甲/苏伊士绕行成本、运价指数',
    diplomacy: '关注政策预期差、双边关系敏感资产',
    election: '关注政策连续性、财政取向、资本流动',
    migration: '关注边境国家财政、人道援助预算',
  };
  const base = lines[topicId] || lines.diplomacy;
  if (dimIds.includes('economic')) return `${base}；叠加产业链重构风险`;
  if (dimIds.includes('military')) return `${base}；叠加安全溢价`;
  return base;
}

function buildGeopoliticsAnalysis(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  const dimensions = item.dimensions?.length ? item.dimensions : detectDimensions(text);
  const topics = item.topics || [];
  const logicChain = buildLogicChain(item, dimensions);
  const scholarRefs = matchScholars(
    { dimensions, topics, text },
    item.stars >= 4 ? 2 : 1
  );
  const impactLine = buildImpactLine(item, dimensions, topics);

  const primaryDim = dimensions[0]?.label || '政治博弈';
  const summary = `【${primaryDim}】${shortenFact(item.title, 48)}`;

  return {
    dimensions,
    logicChain,
    scholarRefs,
    impactLine,
    summary,
    primaryDimension: dimensions[0]?.id || 'political',
    primaryDimensionLabel: primaryDim,
  };
}

/** 兼容旧字段：生成精简文本（供搜索/通知） */
function buildGeopoliticsCommentaryText(analysis) {
  if (!analysis) return '';
  const parts = [];
  if (analysis.logicChain?.length) {
    parts.push(`逻辑：${analysis.logicChain.map((c) => c.text).join(' → ')}`);
  }
  if (analysis.scholarRefs?.length) {
    const ref = analysis.scholarRefs[0];
    parts.push(`引述·${ref.name}（${ref.work}）：「${ref.quote}」`);
  }
  if (analysis.impactLine) parts.push(`影响：${analysis.impactLine}`);
  return parts.join('\n');
}

module.exports = {
  detectDimensions,
  buildGeopoliticsAnalysis,
  buildGeopoliticsCommentaryText,
  buildLogicChain,
  buildImpactLine,
};
