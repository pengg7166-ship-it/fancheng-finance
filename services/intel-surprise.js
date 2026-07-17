/**
 * 情报中心 · 惊讶度（历史分位 + n）
 * 价格：磁盘日 K 真实收益分位；OI：持仓序列；缺失标 n=暂无，不造假。
 */
const { freshnessFromStaleness } = require('./intel-evidence-dsl');

const SURPRISE_VERSION = 'v2.87.0-surprise-n-audit';

const BUCKETS = ['low', 'medium', 'high', 'extreme'];

function percentile(sortedAbs, p) {
  if (!sortedAbs?.length) return null;
  const idx = Math.min(sortedAbs.length - 1, Math.max(0, Math.floor((p / 100) * (sortedAbs.length - 1))));
  return sortedAbs[idx];
}

function bucketFromPercentileRank(rank01) {
  if (rank01 == null || !Number.isFinite(rank01)) return { bucket: 'unknown', score: null };
  if (rank01 >= 0.97) return { bucket: 'extreme', score: 0.95 };
  if (rank01 >= 0.9) return { bucket: 'high', score: 0.75 };
  if (rank01 >= 0.7) return { bucket: 'medium', score: 0.5 };
  return { bucket: 'low', score: 0.25 };
}

function empiricalSurprise(observed, historyAbs, weight = 1) {
  if (observed == null || !Number.isFinite(Number(observed))) {
    return { bucket: 'unknown', score: null, n: null, p50: null, p90: null, rank: null };
  }
  const hist = (historyAbs || []).filter((x) => x != null && Number.isFinite(Number(x))).map((x) => Math.abs(Number(x)));
  const n = hist.length;
  if (n < 20) {
    // 样本不足：诚实降级，不用假分位
    return {
      bucket: 'unknown',
      score: null,
      n,
      nDisplay: n ? String(n) : '暂无',
      p50: null,
      p90: null,
      rank: null,
      reason: 'n<20',
    };
  }
  const sorted = [...hist].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p90 = percentile(sorted, 90);
  const v = Math.abs(Number(observed));
  let below = 0;
  for (const h of sorted) {
    if (h <= v) below += 1;
  }
  const rank = below / n;
  const b = bucketFromPercentileRank(rank);
  return {
    bucket: b.bucket,
    score: b.score != null ? +(b.score * weight).toFixed(4) : null,
    n,
    nDisplay: String(n),
    p50: p50 != null ? +p50.toFixed(4) : null,
    p90: p90 != null ? +p90.toFixed(4) : null,
    rank: +rank.toFixed(4),
    dataSource: 'empirical-percentile',
  };
}

function loadPriceReturnHistory(instrumentId, lookback = 120) {
  try {
    const { readCachedKlines } = require('./commodity-technical-analyzer');
    const bars = readCachedKlines(instrumentId);
    if (!bars?.length || bars.length < 25) return [];
    const slice = bars.slice(-Math.max(lookback + 1, 30));
    const rets = [];
    for (let i = 1; i < slice.length; i += 1) {
      const a = Number(slice[i - 1].close);
      const b = Number(slice[i].close);
      if (a > 0 && b > 0) rets.push(((b - a) / a) * 100);
    }
    return rets;
  } catch {
    return [];
  }
}

function loadOiChangeHistory(instrumentId, lookback = 80) {
  try {
    const { getOiChgNdAtDate } = require('./inventory-capital-joint');
    const { readCachedKlines } = require('./commodity-technical-analyzer');
    const bars = readCachedKlines(instrumentId);
    if (!bars?.length) return [];
    const dates = bars.slice(-lookback).map((b) => String(b.date || b.time || '').slice(0, 10)).filter(Boolean);
    const out = [];
    for (const d of dates) {
      const oi = getOiChgNdAtDate(instrumentId, d, 5);
      if (oi?.pct != null && Number.isFinite(Number(oi.pct))) out.push(Number(oi.pct));
    }
    return out;
  } catch {
    return [];
  }
}

function computeSurpriseVector(inst, pricingState) {
  const dims = [];
  const news = inst?.factors?.news;
  const cap = inst?.capitalAttention;
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const basis = inst?.factors?.basis || inst?.basis;
  const id = inst?.id;

  if (inst?.changePct != null) {
    const hist = loadPriceReturnHistory(id, 120);
    const emp = empiricalSurprise(inst.changePct, hist, 1);
    dims.push({
      dimension: 'price',
      observed: +Number(inst.changePct).toFixed(4),
      baseline: emp.p50 != null ? `p50=±${emp.p50}%` : null,
      bucket: emp.bucket,
      score: emp.score,
      n: emp.n,
      nDisplay: emp.nDisplay || '暂无',
      p90: emp.p90,
      rank: emp.rank,
      dataSource: emp.n >= 20 ? 'klines-empirical' : emp.reason || 'insufficient_n',
      method: 'abs-return-percentile',
    });
  }

  if (news?.shock != null) {
    // 新闻无长历史分位时诚实标注 n=暂无，仅用冲击强度分档（非假分位）
    dims.push({
      dimension: 'news',
      observed: news.shock,
      baseline: null,
      bucket: news.shock > 0.75 ? 'extreme' : news.shock > 0.5 ? 'high' : news.shock > 0.25 ? 'medium' : 'low',
      score: +Math.min(1, news.shock).toFixed(4),
      n: news.hitCount ?? null,
      nDisplay: news.hitCount != null ? String(news.hitCount) : '暂无',
      dataSource: 'news-pool',
      method: 'shock-intensity',
      note: '无跨日分位基线',
    });
  }

  if (cap?.horizons?.oi1wPct != null) {
    const hist = loadOiChangeHistory(id, 80);
    const emp = empiricalSurprise(cap.horizons.oi1wPct, hist, 0.85);
    dims.push({
      dimension: 'oi_1w',
      observed: +Number(cap.horizons.oi1wPct).toFixed(4),
      baseline: emp.p50 != null ? `p50=±${emp.p50}%` : null,
      bucket: emp.bucket,
      score: emp.score,
      n: emp.n,
      nDisplay: emp.nDisplay || '暂无',
      p90: emp.p90,
      rank: emp.rank,
      dataSource: emp.n >= 20 ? 'oi-empirical' : 'insufficient_n',
      method: 'oi-chg-percentile',
    });
  }

  if (sf?.available && sf.primaryRegime) {
    const regimeFlip = inst?.changeDelta?.regimeChanged === true;
    dims.push({
      dimension: 'joint_regime',
      observed: regimeFlip ? 1 : 0,
      baseline: 0,
      bucket: regimeFlip ? 'high' : 'low',
      score: regimeFlip ? 0.75 : 0.1,
      n: sf.sampleN ?? null,
      nDisplay: sf.sampleN != null ? String(sf.sampleN) : '暂无',
      dataSource: 'stock-flow-joint',
      note: sf.primaryRegime,
    });
  }

  if (basis?.available && basis.zScore != null) {
    const z = Math.abs(Number(basis.zScore));
    const n = basis.sampleN ?? null;
    dims.push({
      dimension: 'basis_z',
      observed: +Number(basis.zScore).toFixed(4),
      baseline: 'z≈0',
      bucket: z >= 2.5 ? 'extreme' : z >= 1.8 ? 'high' : z >= 1.0 ? 'medium' : 'low',
      score: Math.min(1, z / 3),
      n,
      nDisplay: n != null ? String(n) : '暂无',
      dataSource: basis.dataSource || 'term-structure',
      method: 'term-structure-z',
    });
  }

  const pricedInDiscount = pricingState?.state === 'priced-in' ? 0.4 : pricingState?.state === 'partial' ? 0.75 : 1;

  const scored = dims.filter((d) => d.score != null);
  const composite = scored.length ? +(Math.max(...scored.map((d) => d.score)) * pricedInDiscount).toFixed(4) : null;

  // 复合 n：取有分位维度的最小 n（诚实）
  const nVals = dims.map((d) => d.n).filter((n) => n != null && n > 0);
  const compositeN = nVals.length ? Math.min(...nVals) : null;

  const top = [...dims].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);

  const bucket =
    composite == null
      ? 'unknown'
      : composite >= 0.75
        ? 'extreme'
        : composite >= 0.5
          ? 'high'
          : composite >= 0.25
            ? 'medium'
            : 'low';

  return {
    version: SURPRISE_VERSION,
    dimensions: dims,
    top3: top,
    composite,
    bucket,
    n: compositeN,
    nDisplay: compositeN != null ? String(compositeN) : '暂无',
    pricedInDiscount,
    display:
      composite != null
        ? `惊讶度:${bucket}(${composite})${compositeN != null ? ` · n=${compositeN}` : ' · n=暂无'}`
        : '惊讶度:待校验',
    dataSource: 'intel-surprise',
    method: 'empirical-percentile+honest-n',
  };
}

function computeActionability(inst, claim, clock, pricingState) {
  let score = 0.3;
  const reasons = [];

  if (claim?.status === 'active') {
    score += 0.2;
    reasons.push('active命题');
  }
  if ((claim?.triggers || []).length >= 1) {
    score += 0.15;
    reasons.push('有触发器');
  }
  if (pricingState?.state === 'mispriced' || pricingState?.state === 'unpriced') {
    score += 0.25;
    reasons.push(pricingState.stateLabel);
  }
  if (clock?.aggregate?.level === 'red' || clock?.aggregate?.level === 'yellow') {
    score += 0.2;
    reasons.push('证伪时钟紧迫');
  }
  if (inst?.insufficientData) {
    score = Math.min(score, 0.2);
    reasons.push('数据不足降权');
  }

  const against = claim?.evidenceAgainst?.length ?? 0;
  if (against >= 2) {
    score *= 0.6;
    reasons.push('反对证据多');
  }

  return {
    score: +Math.min(1, score).toFixed(4),
    reasons,
    label: score >= 0.65 ? '高' : score >= 0.4 ? '中' : '低',
    dataSource: 'intel-surprise',
  };
}

function computeInterruptScore(surprise, actionability, freshness) {
  const s = surprise?.composite ?? 0;
  const a = actionability?.score ?? 0;
  const f = freshness?.score ?? 0.5;
  if (surprise?.composite == null) return { score: null, tier: 'silent', reason: '无惊讶度' };
  // n 不足时不允许 interrupt
  if (surprise.n != null && surprise.n < 20) {
    const raw = s * a * f;
    return {
      score: +raw.toFixed(4),
      tier: raw >= 0.2 ? 'watch' : 'silent',
      reason: `惊讶度 n=${surprise.n}<20 · 禁止 Interrupt`,
      formula: 'surprise×actionability×freshness',
      dataSource: 'intel-surprise',
    };
  }
  const raw = s * a * f;
  const tier = raw >= 0.45 ? 'interrupt' : raw >= 0.2 ? 'watch' : 'silent';
  return {
    score: +raw.toFixed(4),
    tier,
    formula: 'surprise×actionability×freshness',
    dataSource: 'intel-surprise',
  };
}

module.exports = {
  SURPRISE_VERSION,
  BUCKETS,
  computeSurpriseVector,
  computeActionability,
  computeInterruptScore,
  empiricalSurprise,
  loadPriceReturnHistory,
};
