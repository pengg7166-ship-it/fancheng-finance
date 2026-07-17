/**
 * 情报中心 · 证据 DSL（可审计、可组合）
 * 禁止假填充；缺失标 null / 「暂无」。
 */
const EVIDENCE_VERSION = 'v2.82.0-evidence-audit';

const EVIDENCE_TYPES = [
  'inventory',
  'oi',
  'warehouse_joint',
  'capital',
  'price',
  'basis',
  'term_structure',
  'news',
  'macro',
  'foreign',
  'policy',
  'philosophy',
  'technical',
  'regime',
  'expectation_gap',
];

function clamp01(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.max(0, Math.min(1, Number(n)));
}

function sideFromScore(score, deadband = 0.06) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const v = Number(score);
  if (Math.abs(v) <= deadband) return 'neutral';
  return v > 0 ? 'for' : 'against';
}

/**
 * @param {object} p
 * @returns {object|null}
 */
function buildEvidence(p) {
  const {
    claimId = null,
    evidenceType,
    direction,
    strength = null,
    freshness = null,
    reliability = null,
    n = null,
    links = [],
    summary = '',
    dataSource = 'missing',
    relevant = true,
  } = p || {};

  if (!evidenceType || !EVIDENCE_TYPES.includes(evidenceType)) return null;
  if (!summary || summary === '暂无') {
    if (direction == null && strength == null) return null;
  }

  const dir =
    direction === 'for' || direction === 'against' || direction === 'neutral'
      ? direction
      : direction === 'bull' || direction === 'bullish'
        ? 'for'
        : direction === 'bear' || direction === 'bearish'
          ? 'against'
          : 'neutral';

  return {
    evidenceId: `${evidenceType}:${claimId || 'global'}:${Date.now().toString(36)}`,
    claimId,
    evidenceType,
    direction: dir,
    strength: strength != null ? +Number(strength).toFixed(4) : null,
    freshness: freshness || null,
    reliability: reliability || null,
    n: n != null && Number.isFinite(Number(n)) ? Math.floor(Number(n)) : null,
    nDisplay: n != null && Number.isFinite(Number(n)) ? `${Math.floor(Number(n))}` : '暂无',
    links: Array.isArray(links) ? links : [],
    summary: summary || '暂无',
    dataSource,
    relevant: relevant !== false,
    temperature: freshness?.score != null ? freshness.score : null,
    hardness: reliability?.score != null ? reliability.score : null,
  };
}

function freshnessFromStaleness(staleness, asOf) {
  if (!staleness) return { score: null, label: '待校验', asOf: asOf || null };
  const lag = staleness.lagDays ?? staleness.daysBehind ?? null;
  if (lag == null) return { score: null, label: '待校验', asOf: asOf || null };
  if (lag <= 0) return { score: 1, label: '最新', lagDays: 0, asOf: asOf || null };
  if (lag <= 1) return { score: 0.85, label: 'T+1', lagDays: lag, asOf: asOf || null };
  if (lag <= 3) return { score: 0.6, label: '滞后', lagDays: lag, asOf: asOf || null };
  return { score: 0.3, label: '严重滞后', lagDays: lag, asOf: asOf || null };
}

function reliabilityFromSource(sourceTier, corroboration = 0) {
  const tier = String(sourceTier || 'D').toUpperCase();
  const base = { A: 0.9, B: 0.75, C: 0.55, D: 0.35 }[tier] || 0.35;
  const bonus = Math.min(0.15, corroboration * 0.05);
  return {
    score: clamp01(base + bonus),
    tier,
    corroboration,
    label: tier === 'A' ? '高' : tier === 'B' ? '中' : tier === 'C' ? '一般' : '低',
  };
}

function extractEvidenceFromInstrument(inst, claimId, asOf) {
  const out = [];
  const f = inst?.factors || {};
  const kernel = inst?.intelligenceKernel;
  const cap = inst?.capitalAttention || f.capitalAttention;
  const inv = f.inventory;
  const sf = inv?.stockFlowJoint;
  const news = f.news;
  const tech = f.technical || inst?.technical;
  const phil = inst?.philosophy;
  const staleness = inst?.calendarStaleness;

  const fresh = freshnessFromStaleness(staleness, asOf);

  if (kernel?.mainContradiction?.available) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'philosophy',
        direction: kernel.mainContradiction.side === 'bull' ? 'for' : kernel.mainContradiction.side === 'bear' ? 'against' : 'neutral',
        strength: kernel.mainContradiction.score != null ? Math.abs(kernel.mainContradiction.score) : null,
        freshness: fresh,
        reliability: reliabilityFromSource('B', 1),
        summary: `主矛盾:${kernel.mainContradiction.label}`,
        dataSource: kernel.mainContradiction.source || 'philosophy',
        links: [{ type: 'kernel', field: 'mainContradiction' }],
      })
    );
  }

  if (sf?.available) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'warehouse_joint',
        direction: sf.structureBias === 'bull' ? 'for' : sf.structureBias === 'bear' ? 'against' : 'neutral',
        strength: sf.coherence != null ? sf.coherence : 0.5,
        freshness: fresh,
        reliability: reliabilityFromSource('A', sf.horizons ? 2 : 1),
        n: sf.sampleN ?? null,
        summary: sf.display || sf.primaryLabel || '合证',
        dataSource: sf.dataSource || 'inventory-capital-joint',
        links: [{ type: 'stockFlowJoint', field: 'factors.inventory.stockFlowJoint' }],
      })
    );
  } else if (inv?.warehouse?.level != null) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'inventory',
        direction: 'neutral',
        strength: null,
        freshness: fresh,
        reliability: reliabilityFromSource('C'),
        summary: `${inv.warehouse.level} · 待合证`,
        dataSource: inv.warehouse.source || 'warehouse',
      })
    );
  }

  if (cap?.attitudeLabel) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'capital',
        direction: cap.attitudeScore > 0.05 ? 'for' : cap.attitudeScore < -0.05 ? 'against' : 'neutral',
        strength: cap.attitudeScore != null ? Math.abs(cap.attitudeScore) : cap.score != null ? cap.score / 100 : null,
        freshness: fresh,
        reliability: reliabilityFromSource('B'),
        summary: `资金态度:${cap.attitudeLabel}`,
        dataSource: cap.dataSource || 'capital-attitude',
      })
    );
  }

  if (inst?.changePct != null) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'price',
        direction: sideFromScore(inst.changePct / 3, 0.15),
        strength: Math.min(1, Math.abs(inst.changePct) / 5),
        freshness: fresh,
        reliability: reliabilityFromSource(inst.priceReason === '收盘价' ? 'A' : 'B'),
        summary: `日涨跌 ${inst.changePct > 0 ? '+' : ''}${Number(inst.changePct).toFixed(2)}%`,
        dataSource: inst.priceReason || 'quote',
      })
    );
  }

  if (news?.hitCount > 0) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'news',
        direction: sideFromScore(news.score, 0.08),
        strength: news.shock != null ? Math.min(1, news.shock) : Math.abs(news.score || 0),
        freshness: { score: 0.9, label: '当日', asOf },
        reliability: reliabilityFromSource(news.confidence === 'high' ? 'B' : 'C', news.hitCount > 1 ? 1 : 0),
        summary: news.summary || `${news.hitCount}条命中`,
        dataSource: 'news-pool',
        links: (news.hits || []).slice(0, 3).map((h) => ({ type: 'news', title: h.title, source: h.source })),
      })
    );
  }

  if (tech?.techScore != null) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'technical',
        direction: sideFromScore(tech.techScore),
        strength: Math.abs(tech.techScore),
        freshness: fresh,
        reliability: reliabilityFromSource(tech.hasEnough ? 'B' : 'C'),
        n: tech.dataPoints ?? null,
        summary: `技术分 ${tech.techScore > 0 ? '+' : ''}${Number(tech.techScore).toFixed(2)}`,
        dataSource: tech.sourceNote || 'technical-analyzer',
      })
    );
  }

  if (phil?.sdFinance?.combinedLabel) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'philosophy',
        direction: sideFromScore(phil.sdFinance.score, 0.08),
        strength: Math.abs(phil.sdFinance.score || 0),
        freshness: fresh,
        reliability: reliabilityFromSource('B', 1),
        summary: phil.sdFinance.combinedLabel,
        dataSource: 'philosophy.sdFinance',
      })
    );
  }

  const gap = inst?.expectationGap || f.expectationGap;
  if (gap?.gap != null || gap?.pricedIn != null || gap?.overshoot != null) {
    let dir = 'neutral';
    if (gap.overshoot) dir = 'against';
    else if (gap.pricedIn) dir = 'neutral';
    else if (gap.gap != null) dir = sideFromScore(-gap.gap, 0.05);
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'expectation_gap',
        direction: dir,
        strength: gap.gap != null ? Math.min(1, Math.abs(gap.gap)) : null,
        freshness: fresh,
        reliability: reliabilityFromSource('B'),
        summary: gap.label || (gap.pricedIn ? '已定价' : gap.overshoot ? '超涨/超跌' : '预期差'),
        dataSource: gap.dataSource || 'expectation-gap',
      })
    );
  }

  const basis = inst?.factors?.basis || inst?.basis;
  if (basis?.spread != null || basis?.label || basis?.available) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'basis',
        direction: sideFromScore(basis.score ?? (basis.spreadPct > 0 ? 0.1 : basis.spreadPct < 0 ? -0.1 : 0), 0.05),
        strength: basis.strength != null ? basis.strength : basis.spreadPct != null ? Math.min(1, Math.abs(basis.spreadPct) / 2) : null,
        freshness: fresh,
        reliability: reliabilityFromSource(basis.sourceTier || 'B'),
        n: basis.sampleN ?? null,
        summary: basis.label || `基差 ${basis.spreadPct != null ? basis.spreadPct : basis.spread != null ? basis.spread : '—'}`,
        dataSource: basis.dataSource || 'basis',
        links: [{ type: 'basis', field: 'factors.basis' }],
      })
    );
  }

  const term = inst?.factors?.termStructure || inst?.termStructure;
  if (term?.structure || term?.curve) {
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'term_structure',
        direction: sideFromScore(term.score ?? 0, 0.08),
        strength: term.strength != null ? term.strength : null,
        freshness: fresh,
        reliability: reliabilityFromSource(term.sourceTier || 'B'),
        n: term.sampleN ?? basis?.sampleN ?? null,
        summary: term.label || term.structure || '期限结构',
        dataSource: term.dataSource || 'term-structure',
      })
    );
  }

  const dual = inst?.dualNarrative || inst?.factors?.dualNarrative;
  if (dual?.available) {
    let dir = 'neutral';
    if (dual.regime === 'split') dir = 'against';
    else if (dual.regime === 'resonate' && dual.domestic?.side === 'bull') dir = 'for';
    else if (dual.regime === 'resonate' && dual.domestic?.side === 'bear') dir = 'against';
    else if (dual.external?.side === 'bull') dir = 'for';
    else if (dual.external?.side === 'bear') dir = 'against';
    out.push(
      buildEvidence({
        claimId,
        evidenceType: 'foreign',
        direction: dir,
        strength: dual.splitScore != null ? dual.splitScore : dual.regime === 'resonate' ? 0.45 : 0.25,
        freshness: fresh,
        reliability: reliabilityFromSource(dual.external?.available ? 'A' : 'C'),
        n: dual.external?.n ?? dual.domestic?.n ?? null,
        summary: dual.display || dual.regimeLabel || '内外盘双轨',
        dataSource: dual.dataSource || 'intel-dual-narrative',
        links: [{ type: 'dual_narrative', field: 'dualNarrative' }],
      })
    );
  }

  if (kernel?.dissent?.opposingEvidence?.length) {
    for (const opp of kernel.dissent.opposingEvidence.slice(0, 3)) {
      out.push(
        buildEvidence({
          claimId,
          evidenceType: 'regime',
          direction: 'against',
          strength: kernel.dissent.dissentStrength ?? 0.5,
          freshness: fresh,
          reliability: reliabilityFromSource('A'),
          summary: typeof opp === 'string' ? opp : opp?.text || opp?.label || '反对证据',
          dataSource: 'intelligence-kernel.dissent',
        })
      );
    }
  }

  return out.filter(Boolean);
}

function partitionEvidence(evidenceList) {
  const forList = [];
  const againstList = [];
  const neutralList = [];
  for (const e of evidenceList || []) {
    if (e.direction === 'for') forList.push(e);
    else if (e.direction === 'against') againstList.push(e);
    else neutralList.push(e);
  }
  return { for: forList, against: againstList, neutral: neutralList };
}

module.exports = {
  EVIDENCE_VERSION,
  EVIDENCE_TYPES,
  buildEvidence,
  extractEvidenceFromInstrument,
  partitionEvidence,
  freshnessFromStaleness,
  reliabilityFromSource,
  sideFromScore,
};
