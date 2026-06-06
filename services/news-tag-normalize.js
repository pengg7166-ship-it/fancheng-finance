/**
 * 用户新闻 CSV 品种标签 → catalog id 规范化
 */
const { getCommodityMeta } = require('./commodities-catalog');

const TAG_ALIASES = {
  C: 'c',
  M: 'm',
  RM: 'RM',
  P: 'p',
  Y: 'y',
  OI: 'OI',
  CF: 'CF',
  SR: 'SR',
  WH: 'c',
  WHEAT: 'c',
  AG: 'ag',
  FU: 'fu',
  LH: 'lh',
  RB: 'rb',
  HC: 'hc',
  I: 'i',
  J: 'j',
  JM: 'jm',
  ZC: 'ZC',
  AL: 'al',
  SI: 'si',
  SF: 'SF',
  SM: 'SM',
  CU: 'cu',
  ZN: 'zn',
  SN: 'sn',
  NI: 'ni',
  AU: 'au',
  AO: 'ao',
  SC: 'sc',
  BU: 'bu',
  LPG: 'pg',
  PG: 'pg',
  PK: 'pk',
  JD: 'jd',
  PR: 'pr',
  SP: 'sp',
  EG: 'eg',
  PP: 'pp',
  L: 'l',
  MA: 'MA',
  TA: 'TA',
  PF: 'PF',
  UR: 'UR',
  SA: 'SA',
  FG: 'FG',
  PS: 'ps',
  LC: 'lc',
  CJ: 'CJ',
  RU: 'ru',
  EC: 'ec',
  AP: 'ap',
  EB: 'eb',
  V: 'v',
  JR: 'jr',
  LU: 'lu',
  BC: 'bc',
  NR: 'ru',
  PTA: 'TA',
  PX: 'PX',
  BB: null,
  FB: null,
};

const SOURCE_TIER_ALIASES = {
  supply: 'climate',
  demand: 'supply',
  weather: 'climate',
  geopolitics: 'geo',
  fed: 'macro',
  fomc: 'macro',
};

function normalizeSourceTier(tier) {
  const t = String(tier || 'commodity').trim().toLowerCase();
  return SOURCE_TIER_ALIASES[t] || t;
}

function normalizeTag(raw, { title = '', notes = '' } = {}) {
  const tag = String(raw || '').trim();
  if (!tag) return null;

  const ctx = `${title}${notes}`;
  if (tag.toUpperCase() === 'AG' && /核污水|排海/.test(ctx)) {
    return null;
  }

  const upper = tag.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(TAG_ALIASES, upper)) {
    return TAG_ALIASES[upper];
  }
  if (Object.prototype.hasOwnProperty.call(TAG_ALIASES, tag)) {
    return TAG_ALIASES[tag];
  }

  const meta = getCommodityMeta(tag) || getCommodityMeta(tag.toLowerCase());
  if (meta) return meta.id;

  return tag.toLowerCase();
}

function normalizeTags(tagStr, rowCtx = {}) {
  const ids = String(tagStr || '')
    .split(/[;|,]/)
    .map((t) => normalizeTag(t, rowCtx))
    .filter(Boolean);
  return [...new Set(ids)].join(';');
}

function validateTags(tagStr, rowCtx = {}) {
  const unmapped = [];
  for (const raw of String(tagStr || '').split(/[;|,]/)) {
    const tag = String(raw || '').trim();
    if (!tag) continue;
    const norm = normalizeTag(tag, rowCtx);
    if (!norm) continue;
    const meta = getCommodityMeta(norm) || getCommodityMeta(norm.toLowerCase());
    if (!meta) unmapped.push(tag);
  }
  return unmapped;
}

module.exports = {
  TAG_ALIASES,
  SOURCE_TIER_ALIASES,
  normalizeSourceTier,
  normalizeTag,
  normalizeTags,
  validateTags,
};
