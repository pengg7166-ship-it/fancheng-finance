/**
 * 气候分析 — 事件摘要、传导机制、品种影响（简洁版，无学者引述）
 */
const { CLIMATE_DIMENSIONS, CLIMATE_EVENT_TYPES } = require('./climate-sources');

const TRANSMISSION_BY_DIMENSION = {
  agriculture: '气象异常→播种/单产/收割节奏→粮油菜糖及饲料供需再平衡',
  mining_logistics: '极端天气→矿山停产或港口封航→运输瓶颈→金属能源交付延迟',
  macro: '灾害与气候政策→财政救灾/能源保供/碳成本→宏观预期与风险溢价调整',
};

const IMPACT_HINTS = {
  drought: '干旱抬升粮价波动预期，利好相关农产品多头情绪',
  flood: '洪涝扰动种植与物流，短期供应不确定性上升',
  typhoon: '台风影响沿海炼化、港口装卸与海上油气平台',
  elnino: 'ENSO 切换重塑全球降水格局，影响农产品与软商品定价',
  heatwave: '高温推高用电与制冷需求，考验能源与生猪养殖',
  frost: '寒潮霜冻威胁越冬作物与交通，黑色系物流成本或上升',
  wildfire: '山火威胁产区与输电走廊，局部供应中断风险',
  policy: '气候与碳政策改变长期能源结构与成本曲线',
  forecast: '预警信息引导短期交易情绪，实质冲击待验证',
};

function detectDimensions(text) {
  const hay = String(text || '');
  const lower = hay.toLowerCase();
  const hits = [];
  for (const dim of CLIMATE_DIMENSIONS) {
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
        intensity: Math.min(3, Math.ceil(score / 4)),
        score,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) {
    return [{ id: 'macro', label: '宏观政经', shortLabel: '宏观', icon: '📊', intensity: 1, score: 0 }];
  }
  return hits.slice(0, 3);
}

function detectEventTypes(text) {
  const hay = String(text || '');
  const lower = hay.toLowerCase();
  const hits = [];
  for (const ev of CLIMATE_EVENT_TYPES) {
    let score = 0;
    for (const kw of ev.keywords) {
      const lk = kw.toLowerCase();
      if (lower.includes(lk) || hay.includes(kw)) score += 1;
    }
    if (score > 0) hits.push({ ...ev, matchScore: score });
  }
  hits.sort((a, b) => b.matchScore * b.weight - a.matchScore * a.weight);
  return hits.slice(0, 3);
}

function shortenFact(title, max = 40) {
  const s = String(title || '').trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function buildClimateAnalysis(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  const dimensions = item.dimensions?.length ? item.dimensions : detectDimensions(text);
  const events = item.eventTypes?.length ? item.eventTypes : detectEventTypes(text);
  const primaryDim = dimensions[0]?.id || 'macro';
  const primaryEvent = events[0]?.id || 'forecast';

  const eventSummary = `气候事件：${events[0]?.label || '气象动态'} — ${shortenFact(item.title)}`;
  const transmission =
    TRANSMISSION_BY_DIMENSION[primaryDim] ||
    TRANSMISSION_BY_DIMENSION.macro;
  const impactLine =
    IMPACT_HINTS[primaryEvent] ||
    (item.commodities?.length
      ? `关注 ${item.commodities.slice(0, 3).map((c) => c.name).join('、')} 等品种的供需与基差反应`
      : '气候扰动或抬升相关大宗商品波动率');

  const logicChain = [
    { step: 1, label: '事件', text: eventSummary },
    { step: 2, label: '传导', text: transmission },
    { step: 3, label: '品种', text: impactLine },
  ];

  return {
    summary: eventSummary,
    eventSummary,
    transmission,
    impactLine,
    logicChain,
    dimensions,
    primaryDimension: primaryDim,
    primaryDimensionLabel: dimensions[0]?.shortLabel || dimensions[0]?.label,
  };
}

module.exports = {
  buildClimateAnalysis,
  detectDimensions,
  detectEventTypes,
};
