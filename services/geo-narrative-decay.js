/**
 * 地缘叙事半衰—thesis tag decay for geopolitical premium
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const GEO_DECAY_VERSION = 'v1.44.0-discipline';
const GEO_TAG_RE = /geo|地缘|制裁|war|冲突|premium|俄乌|中东|tariff/i;
const DEFAULT_HALF_LIFE_DAYS = 14;

function nowIso() {
  return new Date().toISOString();
}

function daysSince(isoOrMs) {
  if (!isoOrMs) return null;
  const ts = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / (24 * 3600 * 1000);
}

function isGeoThesis(thesis) {
  const text = `${thesis.claim || ''} ${(thesis.linkedTags || []).join(' ')} ${(thesis.linkedThemes || []).join(' ')}`;
  return GEO_TAG_RE.test(text) || thesis.category === 'geopolitics';
}

/**
 * @returns {{ decayFactor: number, premiumRemaining: string, halfLifeDays: number, evidence: string[], dataSource: string }}
 */
function computeGeoNarrativeDecay(inst, context = {}) {
  const asOf = nowIso();
  const theses = inst?.macroSynthesis?.activeTheses || context.activeTheses || [];
  const geoTheses = theses.filter(isGeoThesis);

  if (!geoTheses.length) {
    return {
      decayFactor: 1,
      premiumRemaining: 'none',
      halfLifeDays: DEFAULT_HALF_LIFE_DAYS,
      evidence: ['无活跃地缘命'],
      dataSource: 'geo-narrative-decay',
      method: 'exponential-half-life',
      version: GEO_DECAY_VERSION,
      asOf,
    };
  }

  const halfLife = context.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  let minDecay = 1;
  const evidence = [];

  for (const t of geoTheses) {
    const age = daysSince(t.fetchedAt || t.createdAt || t.updatedAt);
    if (age == null) {
      evidence.push(`${(t.claim || '').slice(0, 40)} · 年龄待校验`);
      minDecay = Math.min(minDecay, 0.5);
      continue;
    }
    const decay = Math.pow(0.5, age / halfLife);
    minDecay = Math.min(minDecay, decay);
    evidence.push(`${(t.claim || '').slice(0, 40)} · ${Math.round(age)}d · decay=${(decay * 100).toFixed(0)}%`);
  }

  let premiumRemaining = 'high';
  if (minDecay < 0.25) premiumRemaining = 'low';
  else if (minDecay < 0.5) premiumRemaining = 'medium';

  return {
    decayFactor: +minDecay.toFixed(3),
    premiumRemaining,
    halfLifeDays: halfLife,
    geoThesisCount: geoTheses.length,
    evidence,
    dataSource: 'geo-narrative-decay',
    method: 'exponential-half-life',
    version: GEO_DECAY_VERSION,
    asOf,
  };
}

function applyGeoDecayToAttention(attentionScore, decay) {
  if (attentionScore == null || !decay?.decayFactor) return attentionScore;
  if (decay.premiumRemaining === 'none') return attentionScore;
  return Math.round(attentionScore * (0.7 + 0.3 * decay.decayFactor));
}

module.exports = {
  GEO_DECAY_VERSION,
  DEFAULT_HALF_LIFE_DAYS,
  isGeoThesis,
  computeGeoNarrativeDecay,
  applyGeoDecayToAttention,
};
