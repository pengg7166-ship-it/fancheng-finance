/**
 * 逐品种特性档案 — 74 品种 metadata，驱动多因子权重与方向阈值
 */
const { getAllCommodities } = require('./commodities-catalog');

/** @typedef {'low'|'medium'|'high'} VolatilityTier */
/** @typedef {'stock-sensitive'|'weather-sensitive'|'geo-sensitive'|'financial'} SupplyDemandType */

const DIRECTION_THRESHOLDS = {
  low: { strongBull: 0.18, bull: 0.08, bear: -0.08, strongBear: -0.18 },
  medium: { strongBull: 0.15, bull: 0.07, bear: -0.07, strongBear: -0.15 },
  high: { strongBull: 0.12, bull: 0.05, bear: -0.05, strongBear: -0.12 },
};

const NEWS_SHOCK_CAP = { low: 0.25, medium: 0.35, high: 0.45 };

const SECTOR_TEMPLATES = {
  precious: {
    volatilityTier: 'low',
    supplyDemandType: 'financial',
    tradingSession: '夜盘活跃·内外盘联动',
    macroSensitivity: { usd: -0.85, fed: 0.35, chinaPolicy: 0.15, usEquities: -0.45, geo: 0.55, climate: 0.08, inventory: 0.05, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.32, macroFed: 0.14, macroChina: 0.04, macroEquities: 0.08, macroGeo: 0.08,
      macroClimate: 0.02, macroPolicy: 0.04, technical: 0.12, capital: 0.08, news: 0.14, intraday: 0.04,
      inventory: 0.0, weather: 0.0,
    },
    newsShockCap: 0.22,
  },
  metals: {
    volatilityTier: 'medium',
    supplyDemandType: 'stock-sensitive',
    tradingSession: '日盘主力·LME/COMEX联动',
    macroSensitivity: { usd: -0.55, fed: 0.25, chinaPolicy: 0.65, usEquities: 0.45, geo: 0.35, climate: 0.1, inventory: 0.55, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.12, macroFed: 0.08, macroChina: 0.22, macroEquities: 0.1, macroGeo: 0.05,
      macroClimate: 0.02, macroPolicy: 0.08, technical: 0.12, capital: 0.1, news: 0.1, intraday: 0.05,
      inventory: 0.18, weather: 0.0,
    },
    newsShockCap: 0.32,
  },
  energy: {
    volatilityTier: 'high',
    supplyDemandType: 'geo-sensitive',
    tradingSession: '夜盘活跃·原油引领',
    macroSensitivity: { usd: -0.45, fed: 0.2, chinaPolicy: 0.35, usEquities: 0.35, geo: 0.75, climate: 0.15, inventory: 0.4, weather: 0.1 },
    factorWeights: {
      macroUsd: 0.1, macroFed: 0.06, macroChina: 0.1, macroEquities: 0.08, macroGeo: 0.18,
      macroClimate: 0.04, macroPolicy: 0.08, technical: 0.1, capital: 0.12, news: 0.12, intraday: 0.06,
      inventory: 0.12, weather: 0.0,
    },
    newsShockCap: 0.4,
  },
  black: {
    volatilityTier: 'medium',
    supplyDemandType: 'stock-sensitive',
    tradingSession: '日盘·基建地产链',
    macroSensitivity: { usd: -0.25, fed: 0.15, chinaPolicy: 0.85, usEquities: 0.35, geo: 0.15, climate: 0.1, inventory: 0.5, weather: 0.08 },
    factorWeights: {
      macroUsd: 0.05, macroFed: 0.05, macroChina: 0.28, macroEquities: 0.08, macroGeo: 0.03,
      macroClimate: 0.03, macroPolicy: 0.12, technical: 0.12, capital: 0.1, news: 0.08, intraday: 0.05,
      inventory: 0.18, weather: 0.0,
    },
    newsShockCap: 0.3,
  },
  chemical: {
    volatilityTier: 'medium',
    supplyDemandType: 'stock-sensitive',
    tradingSession: '日盘·能化链',
    macroSensitivity: { usd: -0.3, fed: 0.15, chinaPolicy: 0.7, usEquities: 0.3, geo: 0.2, climate: 0.12, inventory: 0.45, weather: 0.08 },
    factorWeights: {
      macroUsd: 0.06, macroFed: 0.05, macroChina: 0.22, macroEquities: 0.06, macroGeo: 0.04,
      macroClimate: 0.04, macroPolicy: 0.1, technical: 0.12, capital: 0.1, news: 0.1, intraday: 0.05,
      inventory: 0.16, weather: 0.0,
    },
    newsShockCap: 0.3,
  },
  agriculture: {
    volatilityTier: 'medium',
    supplyDemandType: 'weather-sensitive',
    tradingSession: '日盘·季节性明显',
    macroSensitivity: { usd: -0.35, fed: 0.1, chinaPolicy: 0.55, usEquities: 0.2, geo: 0.25, climate: 0.65, inventory: 0.35, weather: 0.7 },
    factorWeights: {
      macroUsd: 0.06, macroFed: 0.04, macroChina: 0.12, macroEquities: 0.04, macroGeo: 0.05,
      macroClimate: 0.12, macroPolicy: 0.08, technical: 0.1, capital: 0.1, news: 0.1, intraday: 0.04,
      inventory: 0.1, weather: 0.3,
    },
    newsShockCap: 0.28,
  },
};

/** 品种 id → UI sector（与 outlook-engine 一致） */
const ID_SECTOR = {
  sc: 'energy', fu: 'energy', pg: 'energy', ZC: 'energy', lu: 'energy', bu: 'energy', ec: 'energy',
  jm: 'chemical', FG: 'chemical', TA: 'chemical', MA: 'chemical', SA: 'chemical', ru: 'chemical',
  v: 'chemical', l: 'chemical', pp: 'chemical', eg: 'chemical', eb: 'chemical', UR: 'chemical',
  PF: 'chemical', PX: 'chemical', SH: 'chemical', PR: 'chemical', br: 'chemical', ad: 'chemical',
  rb: 'black', hc: 'black', i: 'black', j: 'black', ss: 'black', wr: 'black', SF: 'black', SM: 'black',
  cu: 'metals', al: 'metals', zn: 'metals', pb: 'metals', ni: 'metals', sn: 'metals', si: 'metals',
  lc: 'metals', ps: 'metals', ao: 'metals', bc: 'metals',
  au: 'precious', ag: 'precious', pt: 'precious', pd: 'precious',
  p: 'agriculture', c: 'agriculture', m: 'agriculture', y: 'agriculture', CF: 'agriculture', SR: 'agriculture',
  OI: 'agriculture', RM: 'agriculture', a: 'agriculture', b: 'agriculture', cs: 'agriculture',
  jd: 'agriculture', lh: 'agriculture', rr: 'agriculture', lg: 'agriculture', AP: 'agriculture',
  CJ: 'agriculture', PK: 'agriculture', RS: 'agriculture', WH: 'agriculture', PM: 'agriculture',
  RI: 'agriculture', LR: 'agriculture', JR: 'agriculture', CY: 'agriculture', sp: 'agriculture',
};

/** 逐品种覆盖 — 关键差异点 */
const ID_OVERRIDES = {
  au: {
    volatilityTier: 'low',
    supplyDemandType: 'financial',
    tradingSession: '夜盘活跃·COMEX联动',
    macroSensitivity: { usd: -0.9, fed: 0.35, chinaPolicy: 0.15, usEquities: -0.5, geo: 0.6, climate: 0.05, inventory: 0.05, weather: 0.03 },
    factorWeights: {
      macroUsd: 0.35, macroFed: 0.12, macroChina: 0.04, macroEquities: 0.08, macroGeo: 0.08,
      macroClimate: 0.02, macroPolicy: 0.04, technical: 0.12, capital: 0.08, news: 0.15, intraday: 0.04,
      inventory: 0.0, weather: 0.0,
    },
    newsShockCap: 0.2,
    newsAliases: ['沪金', '黄金', 'AU', 'COMEX gold', 'XAU', '避险', '央行购金'],
  },
  ag: {
    volatilityTier: 'medium',
    macroSensitivity: { usd: -0.7, fed: 0.3, chinaPolicy: 0.2, usEquities: -0.35, geo: 0.4, climate: 0.1, inventory: 0.15, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.28, macroFed: 0.1, macroChina: 0.05, macroEquities: 0.1, macroGeo: 0.06,
      macroClimate: 0.03, macroPolicy: 0.04, technical: 0.12, capital: 0.1, news: 0.14, intraday: 0.05,
      inventory: 0.05, weather: 0.0,
    },
    newsAliases: ['沪银', '白银', 'AG', 'COMEX silver', 'XAG'],
  },
  cu: {
    volatilityTier: 'medium',
    supplyDemandType: 'stock-sensitive',
    tradingSession: '日盘主力·LME铜联动',
    macroSensitivity: { usd: -0.55, fed: 0.2, chinaPolicy: 0.75, usEquities: 0.5, geo: 0.3, climate: 0.08, inventory: 0.65, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.1, macroFed: 0.06, macroChina: 0.25, macroEquities: 0.1, macroGeo: 0.05,
      macroClimate: 0.02, macroPolicy: 0.08, technical: 0.12, capital: 0.1, news: 0.1, intraday: 0.04,
      inventory: 0.2, weather: 0.0,
    },
    newsAliases: ['沪铜', '铜', 'CU', 'LME copper', 'COMEX copper', '电解铜', '精炼铜', '铜库存'],
  },
  bc: {
    macroSensitivity: { usd: -0.6, fed: 0.2, chinaPolicy: 0.6, usEquities: 0.45, geo: 0.35, climate: 0.08, inventory: 0.7, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.12, macroFed: 0.06, macroChina: 0.2, macroEquities: 0.1, macroGeo: 0.05,
      macroClimate: 0.02, macroPolicy: 0.06, technical: 0.12, capital: 0.1, news: 0.1, intraday: 0.04,
      inventory: 0.22, weather: 0.0,
    },
    newsAliases: ['国际铜', 'BC', 'LME copper', 'COMEX copper'],
  },
  sc: {
    volatilityTier: 'high',
    supplyDemandType: 'geo-sensitive',
    tradingSession: '夜盘活跃·WTI/Brent引领',
    macroSensitivity: { usd: -0.4, fed: 0.15, chinaPolicy: 0.3, usEquities: 0.3, geo: 0.85, climate: 0.12, inventory: 0.55, weather: 0.08 },
    factorWeights: {
      macroUsd: 0.08, macroFed: 0.05, macroChina: 0.08, macroEquities: 0.06, macroGeo: 0.22,
      macroClimate: 0.04, macroPolicy: 0.06, technical: 0.08, capital: 0.14, news: 0.14, intraday: 0.08,
      inventory: 0.15, weather: 0.0,
    },
    newsAliases: ['原油', 'SC', 'WTI', 'Brent', 'OPEC', '石油', 'EIA库存'],
  },
  FG: {
    volatilityTier: 'medium',
    supplyDemandType: 'stock-sensitive',
    tradingSession: '日盘·地产链',
    macroSensitivity: { usd: -0.2, fed: 0.1, chinaPolicy: 0.85, usEquities: 0.25, geo: 0.1, climate: 0.15, inventory: 0.55, weather: 0.12 },
    factorWeights: {
      macroUsd: 0.04, macroFed: 0.04, macroChina: 0.3, macroEquities: 0.06, macroGeo: 0.02,
      macroClimate: 0.04, macroPolicy: 0.12, technical: 0.12, capital: 0.1, news: 0.08, intraday: 0.04,
      inventory: 0.18, weather: 0.06,
    },
    newsAliases: ['玻璃', 'FG', '光伏玻璃', '浮法玻璃', '纯碱'],
  },
  SA: {
    volatilityTier: 'medium',
    supplyDemandType: 'stock-sensitive',
    macroSensitivity: { usd: -0.15, fed: 0.08, chinaPolicy: 0.8, usEquities: 0.2, geo: 0.08, climate: 0.1, inventory: 0.6, weather: 0.1 },
    factorWeights: {
      macroUsd: 0.04, macroFed: 0.03, macroChina: 0.28, macroEquities: 0.05, macroGeo: 0.02,
      macroClimate: 0.03, macroPolicy: 0.12, technical: 0.12, capital: 0.1, news: 0.1, intraday: 0.04,
      inventory: 0.2, weather: 0.04,
    },
    newsAliases: ['纯碱', 'SA', '光伏', '浮法玻璃'],
  },
  rb: {
    volatilityTier: 'medium',
    macroSensitivity: { usd: -0.2, fed: 0.12, chinaPolicy: 0.9, usEquities: 0.35, geo: 0.12, climate: 0.08, inventory: 0.55, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.04, macroFed: 0.04, macroChina: 0.3, macroEquities: 0.08, macroGeo: 0.03,
      macroClimate: 0.02, macroPolicy: 0.12, technical: 0.12, capital: 0.1, news: 0.08, intraday: 0.04,
      inventory: 0.18, weather: 0.0,
    },
    newsAliases: ['螺纹钢', 'RB', '建筑钢材', '钢价'],
  },
  i: {
    volatilityTier: 'medium',
    macroSensitivity: { usd: -0.25, fed: 0.1, chinaPolicy: 0.85, usEquities: 0.4, geo: 0.15, climate: 0.08, inventory: 0.6, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.05, macroFed: 0.04, macroChina: 0.28, macroEquities: 0.08, macroGeo: 0.03,
      macroClimate: 0.02, macroPolicy: 0.1, technical: 0.12, capital: 0.1, news: 0.08, intraday: 0.04,
      inventory: 0.2, weather: 0.0,
    },
    newsAliases: ['铁矿石', 'I', '普氏', 'PB粉', '港口库存'],
  },
  lc: {
    volatilityTier: 'high',
    supplyDemandType: 'stock-sensitive',
    macroSensitivity: { usd: -0.3, fed: 0.15, chinaPolicy: 0.7, usEquities: 0.45, geo: 0.2, climate: 0.1, inventory: 0.5, weather: 0.05 },
    factorWeights: {
      macroUsd: 0.06, macroFed: 0.06, macroChina: 0.2, macroEquities: 0.1, macroGeo: 0.04,
      macroClimate: 0.03, macroPolicy: 0.1, technical: 0.12, capital: 0.14, news: 0.12, intraday: 0.06,
      inventory: 0.14, weather: 0.0,
    },
    newsAliases: ['碳酸锂', 'LC', '锂价', '锂电', '电池金属'],
  },
  CF: {
    supplyDemandType: 'weather-sensitive',
    macroSensitivity: { usd: -0.35, fed: 0.08, chinaPolicy: 0.5, usEquities: 0.15, geo: 0.2, climate: 0.7, inventory: 0.35, weather: 0.75 },
    factorWeights: {
      macroUsd: 0.05, macroFed: 0.03, macroChina: 0.1, macroEquities: 0.03, macroGeo: 0.04,
      macroClimate: 0.14, macroPolicy: 0.08, technical: 0.1, capital: 0.1, news: 0.1, intraday: 0.04,
      inventory: 0.1, weather: 0.32,
    },
    newsAliases: ['棉花', 'CF', 'ICE cotton', '棉价', '新疆棉'],
  },
  lh: {
    supplyDemandType: 'stock-sensitive',
    macroSensitivity: { usd: -0.2, fed: 0.08, chinaPolicy: 0.75, usEquities: 0.15, geo: 0.1, climate: 0.2, inventory: 0.45, weather: 0.25 },
    factorWeights: {
      macroUsd: 0.04, macroFed: 0.03, macroChina: 0.22, macroEquities: 0.03, macroGeo: 0.02,
      macroClimate: 0.08, macroPolicy: 0.1, technical: 0.1, capital: 0.1, news: 0.12, intraday: 0.04,
      inventory: 0.14, weather: 0.12,
    },
    newsAliases: ['生猪', 'LH', '猪价', '养殖', '能繁母猪'],
  },
  ec: {
    volatilityTier: 'high',
    supplyDemandType: 'geo-sensitive',
    tradingSession: '日盘·航运指数',
    macroSensitivity: { usd: -0.3, fed: 0.1, chinaPolicy: 0.5, usEquities: 0.25, geo: 0.7, climate: 0.15, inventory: 0.2, weather: 0.15 },
    factorWeights: {
      macroUsd: 0.06, macroFed: 0.04, macroChina: 0.14, macroEquities: 0.06, macroGeo: 0.2,
      macroClimate: 0.06, macroPolicy: 0.08, technical: 0.1, capital: 0.12, news: 0.12, intraday: 0.06,
      inventory: 0.06, weather: 0.06,
    },
    newsAliases: ['集运', 'EC', '欧线', '红海', '航运', '运费'],
  },
  pt: {
    volatilityTier: 'low',
    supplyDemandType: 'financial',
    newsAliases: ['铂金', 'PT', 'platinum', 'PGM', '氢能'],
  },
  pd: {
    volatilityTier: 'low',
    supplyDemandType: 'financial',
    newsAliases: ['钯金', 'PD', 'palladium', 'PGM', '尾气催化'],
  },
};

function deepMerge(base, override) {
  const out = { ...base };
  if (!override) return out;
  if (override.macroSensitivity) {
    out.macroSensitivity = { ...base.macroSensitivity, ...override.macroSensitivity };
  }
  if (override.factorWeights) {
    out.factorWeights = { ...base.factorWeights, ...override.factorWeights };
  }
  for (const k of Object.keys(override)) {
    if (k !== 'macroSensitivity' && k !== 'factorWeights') out[k] = override[k];
  }
  return out;
}

function normalizeWeights(weights) {
  const sum = Object.values(weights).reduce((s, v) => s + v, 0);
  if (sum <= 0) return weights;
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = +(v / sum).toFixed(4);
  return out;
}

function buildProfileForId(id, meta) {
  const sector = ID_SECTOR[id] || ID_SECTOR[id.toLowerCase()] || 'agriculture';
  const template = SECTOR_TEMPLATES[sector] || SECTOR_TEMPLATES.agriculture;
  const override = ID_OVERRIDES[id] || ID_OVERRIDES[id.toLowerCase()] || {};
  const merged = deepMerge(template, override);
  const keywords = meta?.keywords || [meta?.name, id].filter(Boolean);
  const newsAliases = override.newsAliases || keywords.slice(0, 8);
  return {
    id,
    name: meta?.name || id,
    sector,
    volatilityTier: merged.volatilityTier,
    supplyDemandType: merged.supplyDemandType,
    tradingSession: merged.tradingSession,
    macroSensitivity: merged.macroSensitivity,
    factorWeights: normalizeWeights(merged.factorWeights),
    directionThresholds: DIRECTION_THRESHOLDS[merged.volatilityTier] || DIRECTION_THRESHOLDS.medium,
    newsShockCap: merged.newsShockCap ?? NEWS_SHOCK_CAP[merged.volatilityTier] ?? 0.3,
    newsAliases,
  };
}

let profileCache = null;

function buildAllProfiles() {
  const profiles = {};
  for (const meta of getAllCommodities()) {
    profiles[meta.id] = buildProfileForId(meta.id, meta);
  }
  return profiles;
}

function getInstrumentProfile(commodityId) {
  if (!profileCache) profileCache = buildAllProfiles();
  const id = String(commodityId || '');
  return profileCache[id] || profileCache[id.toLowerCase()] || buildProfileForId(id, null);
}

function getAllInstrumentProfiles() {
  if (!profileCache) profileCache = buildAllProfiles();
  return profileCache;
}

function scoreToDirectionTier(score, volatilityTier) {
  const th = DIRECTION_THRESHOLDS[volatilityTier] || DIRECTION_THRESHOLDS.medium;
  if (score >= th.strongBull) return { direction: 'strong_bullish', label: '强多', arrow: '↑↑' };
  if (score >= th.bull) return { direction: 'bullish', label: '偏多', arrow: '↑' };
  if (score <= th.strongBear) return { direction: 'strong_bearish', label: '强空', arrow: '↓↓' };
  if (score <= th.bear) return { direction: 'bearish', label: '偏空', arrow: '↓' };
  return { direction: 'neutral', label: '震荡', arrow: '→' };
}

function directionTierClass(dir) {
  if (dir === 'strong_bullish' || dir === 'bullish') return 'bullish';
  if (dir === 'strong_bearish' || dir === 'bearish') return 'bearish';
  return 'neutral';
}

module.exports = {
  DIRECTION_THRESHOLDS,
  NEWS_SHOCK_CAP,
  SECTOR_TEMPLATES,
  getInstrumentProfile,
  getAllInstrumentProfiles,
  buildProfileForId,
  scoreToDirectionTier,
  directionTierClass,
};
