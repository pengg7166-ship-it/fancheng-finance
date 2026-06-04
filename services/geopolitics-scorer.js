const {
  COUNTRIES,
  GEOPOLITICS_TOPICS,
  COMPETITION_DIMENSIONS,
  getCountryById,
  getRegionById,
} = require('./geopolitics-sources');
const { detectDimensions } = require('./geopolitics-analyst');

function clampStars(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function starsToHtml(stars) {
  const n = clampStars(stars);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function detectCountries(text) {
  const hay = String(text || '');
  const lower = hay.toLowerCase();
  const hits = [];

  for (const country of COUNTRIES) {
    let score = 0;
    for (const kw of country.keywords) {
      const lk = kw.toLowerCase();
      if (lk.length >= 3 && (lower.includes(lk) || hay.includes(kw))) {
        score += lk.length >= 5 ? 3 : 2;
      } else if (lk.length === 2 && new RegExp(`\\b${lk}\\b`, 'i').test(hay)) {
        score += 1;
      }
    }
    if (score > 0) hits.push({ ...country, matchScore: score });
  }

  hits.sort((a, b) => b.matchScore - a.matchScore || b.baseInfluence - a.baseInfluence);
  return hits.slice(0, 5);
}

function detectTopics(text) {
  const hay = String(text || '');
  const lower = hay.toLowerCase();
  const hits = [];

  for (const topic of GEOPOLITICS_TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      const lk = kw.toLowerCase();
      if (lower.includes(lk) || hay.includes(kw)) score += 1;
    }
    if (score > 0) hits.push({ ...topic, matchScore: score });
  }

  hits.sort((a, b) => b.matchScore * b.weight - a.matchScore * a.weight);
  return hits.slice(0, 4);
}

function resolvePrimaryRegion(countries) {
  if (!countries.length) return 'global';
  const regionCounts = new Map();
  for (const c of countries) {
    regionCounts.set(c.region, (regionCounts.get(c.region) || 0) + 1);
  }
  let best = 'global';
  let bestScore = 0;
  for (const [region, count] of regionCounts) {
    const topInfluence = Math.max(
      ...countries.filter((c) => c.region === region).map((c) => c.baseInfluence)
    );
    const score = count * 2 + topInfluence;
    if (score > bestScore) {
      bestScore = score;
      best = region;
    }
  }
  return best;
}

function scoreGeopoliticsItem(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  const countries = detectCountries(text);
  const topics = detectTopics(text);
  const dimensions = detectDimensions(text);

  const maxCountryInfluence = countries.length
    ? Math.max(...countries.map((c) => c.baseInfluence))
    : 1;
  const maxTopicWeight = topics.length ? Math.max(...topics.map((t) => t.weight)) : 0;
  const maxDimIntensity = dimensions.length
    ? Math.max(...dimensions.map((d) => d.intensity))
    : 1;
  const topicBonus = topics.length ? Math.min(2, topics.length * 0.35) : 0;
  const dimBonus = dimensions.length >= 2 ? 0.6 : 0;

  let raw =
    maxCountryInfluence * 0.5 +
    maxTopicWeight * 0.75 +
    maxDimIntensity * 0.45 +
    topicBonus +
    dimBonus +
    (countries.length >= 2 ? 0.5 : 0) +
    (item.sourceTier === 'primary' ? 0.25 : 0);

  if (/紧急|重大|升级|escalat|breaking|urgent|critical/i.test(text)) raw += 0.6;
  if (/例行|人事|活动|culture|sport|娱乐|明星|足球/i.test(text)) raw -= 1.2;

  const stars = clampStars(raw);
  const region = resolvePrimaryRegion(countries);
  const regionInfo = getRegionById(region);

  const primaryCountry = countries[0] || null;

  return {
    stars,
    starsHtml: starsToHtml(stars),
    countries: countries.map((c) => ({
      id: c.id,
      name: c.name,
      flag: c.flag,
      baseInfluence: c.baseInfluence,
      region: c.region,
    })),
    topics: topics.map((t) => ({ id: t.id, label: t.label })),
    dimensions,
    dimensionLabel: dimensions.map((d) => d.shortLabel || d.label).join(' · '),
    region,
    regionLabel: regionInfo.label,
    regionFlag: regionInfo.flag,
    primaryCountryId: primaryCountry?.id || '',
    primaryCountryName: primaryCountry?.name || '',
    primaryCountryInfluence: primaryCountry?.baseInfluence || 0,
    countryInfluenceLabel: primaryCountry
      ? `${primaryCountry.flag} ${primaryCountry.name} · 影响力 ${'★'.repeat(primaryCountry.baseInfluence)}`
      : '多边/未识别',
    topicLabel: topics[0]?.label || '综合',
    needsCommentary: stars >= 3 || (maxCountryInfluence >= 4 && stars >= 2),
    needsAnalysis: stars >= 3 || dimensions.length >= 2,
  };
}

function buildRegionGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const r = item.region || 'global';
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(item);
  }
  return [...groups.entries()]
    .map(([id, regionItems]) => {
      const info = getRegionById(id);
      return {
        id,
        label: info.label,
        flag: info.flag,
        items: regionItems,
        count: regionItems.length,
        highImpact: regionItems.filter((i) => i.stars >= 4).length,
      };
    })
    .sort((a, b) => b.highImpact - a.highImpact || b.count - a.count);
}

function buildCountryIndex(items) {
  const index = new Map();
  for (const item of items) {
    for (const c of item.countries || []) {
      if (!index.has(c.id)) {
        const meta = getCountryById(c.id);
        index.set(c.id, {
          id: c.id,
          name: c.name,
          flag: c.flag,
          baseInfluence: meta?.baseInfluence || c.baseInfluence || 1,
          region: meta?.region || c.region,
          count: 0,
          highImpact: 0,
        });
      }
      const row = index.get(c.id);
      row.count += 1;
      if (item.stars >= 4) row.highImpact += 1;
    }
  }
  return [...index.values()].sort(
    (a, b) => b.baseInfluence - a.baseInfluence || b.count - a.count
  );
}

function buildStats(items) {
  const regions = buildRegionGroups(items);
  const dimCounts = {};
  for (const d of COMPETITION_DIMENSIONS) dimCounts[d.id] = 0;
  for (const item of items) {
    for (const d of item.dimensions || []) {
      if (dimCounts[d.id] !== undefined) dimCounts[d.id] += 1;
    }
  }
  return {
    total: items.length,
    highImpact: items.filter((i) => i.stars >= 4).length,
    withAnalysis: items.filter((i) => i.analysis).length,
    withCommentary: items.filter((i) => i.analysis).length,
    regions: regions.map((r) => ({ id: r.id, label: r.label, count: r.count, highImpact: r.highImpact })),
    dimensions: COMPETITION_DIMENSIONS.map((d) => ({
      id: d.id,
      label: d.shortLabel,
      count: dimCounts[d.id] || 0,
    })),
    countriesTracked: buildCountryIndex(items).length,
    avgStars: items.length
      ? (items.reduce((s, i) => s + (i.stars || 1), 0) / items.length).toFixed(1)
      : '0',
  };
}

module.exports = {
  detectCountries,
  detectTopics,
  scoreGeopoliticsItem,
  buildRegionGroups,
  buildCountryIndex,
  buildStats,
  starsToHtml,
  clampStars,
};
