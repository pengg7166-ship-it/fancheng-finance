/**
 * 资讯来源质量评分 — 大宗研判专用
 *
 * 与「预期幅度」正交：来源分衡量可信度/权威性/可审计性，
 * 不替代内容审查；低来源 + 低预期 → 拒收或仅留快讯。
 */
const SOURCE_QUALITY_VERSION = 'v1.56.0-source-quality';

/** @typedef {'official'|'institutional'|'tier1'|'trade'|'aggregator'|'noise'|'unknown'} SourceTier */

const TIER_SCORE = {
  official: 92,
  institutional: 78,
  tier1: 62,
  trade: 48,
  aggregator: 32,
  unknown: 38,
  noise: 12,
};

const TIER_LABELS = {
  official: '官方/监管',
  institutional: '机构研究',
  tier1: '一线媒体',
  trade: '快讯/盘面',
  aggregator: '聚合转载',
  unknown: '未识别来源',
  noise: '政务噪音',
};

/** id → 默认分；pattern 在 sourceName / url / department 上匹配 */
const SOURCE_REGISTRY = [
  // —— 中国官方 ——
  { id: 'mofcom', tier: 'official', score: 94, patterns: [/商务部|mofcom/i, /禁止出口|出口管理|反倾销|保障措施/i] },
  { id: 'customs', tier: 'official', score: 93, patterns: [/海关总署|海关总/i] },
  { id: 'pboc', tier: 'official', score: 95, patterns: [/人民银行|央行|中国人民银行|PBOC/i] },
  { id: 'ndrc', tier: 'official', score: 90, patterns: [/发改委|国家发展改革委/i] },
  { id: 'nea', tier: 'official', score: 90, patterns: [/国家能源局|能源局/i] },
  { id: 'mara', tier: 'official', score: 88, patterns: [/农业农村部|农业部/i] },
  { id: 'gov-cn', tier: 'official', score: 82, patterns: [/中国政府网|gov\.cn/i] },
  { id: 'csrc', tier: 'official', score: 86, patterns: [/证监会|期货监管|持仓限额/i] },

  // —— 国际官方 / 平衡表 ——
  { id: 'usda', tier: 'official', score: 96, patterns: [/USDA|美国农业部|WASDE|期末库存/i] },
  { id: 'eia', tier: 'official', score: 95, patterns: [/EIA|能源信息署/i] },
  { id: 'iea', tier: 'official', score: 95, patterns: [/IEA|国际能源署/i] },
  { id: 'opec', tier: 'official', score: 93, patterns: [/OPEC|欧佩克/i] },
  { id: 'fed', tier: 'official', score: 96, patterns: [/美联储|Federal Reserve|FOMC|federalreserve\.gov/i] },
  { id: 'treasury', tier: 'official', score: 90, patterns: [/美国财政部|Treasury|home\.treasury\.gov/i] },
  { id: 'ofac', tier: 'official', score: 92, patterns: [/OFAC|制裁行动|sanction/i] },
  { id: 'federal-register', tier: 'official', score: 88, patterns: [/Federal Register|federalregister\.gov/i] },

  // —— 机构研究 / 投行 ——
  { id: 'goldman', tier: 'institutional', score: 80, patterns: [/高盛|Goldman Sachs/i] },
  { id: 'citi', tier: 'institutional', score: 78, patterns: [/花旗|Citigroup|Citi /i] },
  { id: 'morgan', tier: 'institutional', score: 78, patterns: [/摩根士丹利|Morgan Stanley|摩根大通|J\.?P\.?\s*Morgan/i] },
  { id: 'ubs', tier: 'institutional', score: 76, patterns: [/瑞银|UBS/i] },
  { id: 'barclays', tier: 'institutional', score: 74, patterns: [/巴克莱|Barclays/i] },
  { id: 'citic-futures', tier: 'institutional', score: 74, patterns: [/中信建投期货|中信期货/i] },
  { id: 'everbright-futures', tier: 'institutional', score: 72, patterns: [/光大期货/i] },
  { id: 'gtja-futures', tier: 'institutional', score: 72, patterns: [/国泰君安期货|国君期货/i] },
  { id: 'yongan-futures', tier: 'institutional', score: 70, patterns: [/永安期货/i] },
  { id: 'huatai-futures', tier: 'institutional', score: 70, patterns: [/华泰期货/i] },
  { id: 'mysteel', tier: 'institutional', score: 68, patterns: [/Mysteel|我的钢铁/i] },
  { id: 'smm', tier: 'institutional', score: 66, patterns: [/上海有色|SMM/i] },
  { id: 'zhongyu', tier: 'institutional', score: 64, patterns: [/卓创资讯|隆众/i] },

  // —— 一线媒体 ——
  { id: 'reuters', tier: 'tier1', score: 72, patterns: [/Reuters|路透/i, /reuters\.com/i] },
  { id: 'bloomberg', tier: 'tier1', score: 70, patterns: [/Bloomberg|彭博/i, /bloomberg\.com/i] },
  { id: 'cnbc', tier: 'tier1', score: 65, patterns: [/CNBC/i, /cnbc\.com/i] },
  { id: 'xinhua', tier: 'tier1', score: 68, patterns: [/新华社|新华网|news\.cn|xinhuanet/i] },
  { id: 'wallstreetcn', tier: 'tier1', score: 64, patterns: [/华尔街见闻|wallstreetcn/i] },
  { id: 'investing', tier: 'tier1', score: 60, patterns: [/Investing\.com/i] },
  { id: 'oilprice', tier: 'tier1', score: 62, patterns: [/OilPrice/i, /oilprice\.com/i] },
  { id: 'wmo', tier: 'tier1', score: 70, patterns: [/世界气象|WMO|ECMWF|气候预测中心/i] },

  // —— 快讯 / 盘面 ——
  { id: 'jin10', tier: 'trade', score: 52, patterns: [/金十|jin10/i] },
  { id: 'jin10-commodity', tier: 'trade', score: 54, patterns: [/金十.*商品/i] },
  { id: 'eastmoney-intl', tier: 'trade', score: 50, patterns: [/东方财富·国际/i] },
  { id: 'eastmoney-macro', tier: 'trade', score: 52, patterns: [/东方财富·宏观/i] },
  { id: 'wallstreetcn-commodity', tier: 'tier1', score: 64, patterns: [/华尔街见闻·商品/i] },
  { id: 'wallstreetcn-oil', tier: 'tier1', score: 66, patterns: [/华尔街见闻·油气/i] },
  { id: 'wallstreetcn-gold', tier: 'tier1', score: 66, patterns: [/华尔街见闻·黄金/i] },
  { id: 'sina-futures', tier: 'trade', score: 46, patterns: [/新浪.*期货/i] },
  { id: 'sina-futures-opinion', tier: 'institutional', score: 68, patterns: [/新浪.*期货观点|期货观点/i] },
  { id: 'sina-commodity', tier: 'trade', score: 46, patterns: [/新浪.*商品/i] },
  { id: 'people-finance', tier: 'tier1', score: 64, patterns: [/人民网·财经/i] },
  { id: '100ppi', tier: 'trade', score: 44, patterns: [/生意社|100ppi/i] },
  { id: 'eastmoney', tier: 'trade', score: 50, patterns: [/东方财富/i] },
  { id: 'cls', tier: 'trade', score: 48, patterns: [/财联社|cls\.cn/i] },
  { id: 'sina-futures', tier: 'trade', score: 46, patterns: [/新浪.*期货|新浪财经/i] },
  { id: '100ppi', tier: 'trade', score: 44, patterns: [/生意社|100ppi/i] },
  { id: 'market-wrap', tier: 'trade', score: 28, patterns: [/收盘综述|涨跌不一|盘面|mixed|choppy/i] },

  // —— 低质政务 ——
  {
    id: 'gov-noise',
    tier: 'noise',
    score: 10,
    patterns: [
      /国务院关于[《「].{2,40}(十五五|十四五|十三五).{0,20}规划[》」]/,
      /中医药|旅游强国|疾控|卫生健康|义务教育|非遗|人口发展/,
    ],
  },
];

const HOST_HINTS = [
  { host: /mofcom\.gov\.cn/i, id: 'mofcom', tier: 'official', score: 94 },
  { host: /ndrc\.gov\.cn/i, id: 'ndrc', tier: 'official', score: 90 },
  { host: /miit\.gov\.cn/i, id: 'miit', tier: 'official', score: 88 },
  { host: /moa\.gov\.cn/i, id: 'mara', tier: 'official', score: 88 },
  { host: /nea\.gov\.cn/i, id: 'nea', tier: 'official', score: 90 },
  { host: /customs\.gov\.cn/i, id: 'customs', tier: 'official', score: 93 },
  { host: /cffex\.com\.cn/i, id: 'cffex', tier: 'official', score: 91 },
  { host: /shfe\.com\.cn/i, id: 'shfe', tier: 'official', score: 90 },
  { host: /dce\.com\.cn/i, id: 'dce', tier: 'official', score: 90 },
  { host: /czce\.com\.cn/i, id: 'czce', tier: 'official', score: 90 },
  { host: /gfex\.com\.cn/i, id: 'gfex', tier: 'official', score: 90 },
  { host: /pbc\.gov\.cn/i, id: 'pboc', tier: 'official', score: 95 },
  { host: /gov\.cn/i, id: 'gov-cn', tier: 'official', score: 82 },
  { host: /usda\.gov/i, id: 'usda', tier: 'official', score: 96 },
  { host: /eia\.gov/i, id: 'eia', tier: 'official', score: 95 },
  { host: /iea\.org/i, id: 'iea', tier: 'official', score: 95 },
  { host: /federalreserve\.gov/i, id: 'fed', tier: 'official', score: 96 },
  { host: /treasury\.gov/i, id: 'treasury', tier: 'official', score: 90 },
  { host: /reuters\.com/i, id: 'reuters', tier: 'tier1', score: 72 },
  { host: /bloomberg\.com/i, id: 'bloomberg', tier: 'tier1', score: 70 },
  { host: /jin10\.com/i, id: 'jin10', tier: 'trade', score: 52 },
  { host: /eastmoney\.com/i, id: 'eastmoney', tier: 'trade', score: 50 },
];

function buildSourceProbe(item = {}) {
  return [
    item.sourceName,
    item.source,
    item.feedId,
    item.department,
    item.departmentName,
    item.region,
  ]
    .filter(Boolean)
    .join(' ');
}

function buildProbeText(item = {}) {
  return [buildSourceProbe(item), item.url || item.link, item.title].filter(Boolean).join(' ');
}

function matchNoiseInContent(text) {
  for (const row of SOURCE_REGISTRY) {
    if (row.tier !== 'noise') continue;
    for (const re of row.patterns) {
      if (re.test(text)) {
        return { id: row.id, tier: row.tier, score: row.score, evidence: `政务噪音·${row.id}` };
      }
    }
  }
  return null;
}

function matchRegistry(probe, { includeTitle = false } = {}) {
  let best = null;
  for (const row of SOURCE_REGISTRY) {
    if (row.tier === 'noise') continue;
    for (const re of row.patterns) {
      if (!re.test(probe)) continue;
      if (!best || row.score > best.score) {
        best = { id: row.id, tier: row.tier, score: row.score, evidence: `来源匹配·${row.id}` };
      }
    }
  }
  return best;
}

function matchHost(url) {
  if (!url) return null;
  for (const row of HOST_HINTS) {
    if (row.host.test(url)) {
      return { id: row.id, tier: row.tier, score: row.score, evidence: `域名·${row.id}` };
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} item
 */
function assessNewsSourceQuality(item = {}) {
  const title = String(item.title || '');
  const sourceProbe = buildSourceProbe(item);
  const fullProbe = buildProbeText(item);

  const noiseHit = matchNoiseInContent(title);
  if (noiseHit) {
    return {
      version: SOURCE_QUALITY_VERSION,
      score: noiseHit.score,
      tier: noiseHit.tier,
      tierLabel: TIER_LABELS.noise,
      sourceId: noiseHit.id,
      evidence: noiseHit.evidence,
      dataSource: 'focus-news-source-quality',
    };
  }

  const hostHit = matchHost(String(item.url || item.link || ''));
  const regHit = matchRegistry(`${sourceProbe} ${item.url || item.link || ''}`);

  let hit = regHit;
  if (hostHit && (!hit || hostHit.score > hit.score)) hit = hostHit;
  if (!hit) {
    if (/手动|manual|粘贴/i.test(sourceProbe)) {
      hit = { id: 'manual', tier: 'aggregator', score: 36, evidence: '手动录入' };
    } else if (/情报池|unknown/i.test(sourceProbe)) {
      hit = { id: 'unknown', tier: 'unknown', score: TIER_SCORE.unknown, evidence: '未标注来源' };
    } else {
      hit = { id: 'unknown', tier: 'unknown', score: TIER_SCORE.unknown, evidence: '未识别来源' };
    }
  }

  let score = hit.score;
  if (hit.tier !== 'noise' && /收盘综述|涨跌不一|盘面综述/i.test(fullProbe)) {
    score = Math.min(score, TIER_SCORE.trade - 8);
    hit = { ...hit, id: 'market-wrap', tier: 'trade', evidence: `${hit.evidence}·盘面综述降权` };
  }

  const tier = hit.tier;
  return {
    version: SOURCE_QUALITY_VERSION,
    score: Math.round(Math.min(100, Math.max(0, score))),
    tier,
    tierLabel: TIER_LABELS[tier] || tier,
    sourceId: hit.id,
    evidence: hit.evidence,
    dataSource: 'focus-news-source-quality',
  };
}

/** 综合排序分：预期幅度为主，来源为辅 */
function blendRankingScore(expectationMagnitude, sourceScore) {
  const exp = Number(expectationMagnitude) || 0;
  const src = Number(sourceScore) || TIER_SCORE.unknown;
  return Math.round(exp * 0.78 + src * 0.22);
}

/**
 * 入板来源门槛 — 内容预期够强时可豁免低来源
 */
function meetsTierSourceFloor(tier, sourceQuality, expectationMagnitude = 0) {
  const src = sourceQuality?.score ?? TIER_SCORE.unknown;
  const mag = Number(expectationMagnitude) || 0;

  if (sourceQuality?.tier === 'noise') return mag >= 52;

  if (tier === 'feed') return true;
  if (tier === 'symbol') return src >= 28 || mag >= 40;
  if (tier === 'sector') return src >= 34 || mag >= 44;
  if (tier === 'global') return src >= 50 || mag >= 58;
  return src >= 30;
}

function formatSourceQualitySummary(sq) {
  if (!sq?.score) return '—';
  return `${sq.tierLabel || sq.tier}·${sq.score}`;
}

module.exports = {
  SOURCE_QUALITY_VERSION,
  TIER_SCORE,
  TIER_LABELS,
  assessNewsSourceQuality,
  blendRankingScore,
  meetsTierSourceFloor,
  formatSourceQualitySummary,
};
