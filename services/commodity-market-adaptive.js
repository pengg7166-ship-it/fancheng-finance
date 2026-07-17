/**
 * 双速市场反射 — 即时/滞后通道 + latencyState（v1.20）
 * 市场有时即时定价、有时滞后反映；权重随当前条件动态调整。
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

const LATENCY_LABELS = {
  sync: '同步',
  lagging: '滞后',
  divergent: '背离',
};

function newsAgeHours(item) {
  const raw = item.pubDate || item.publishTime || item.publishedAt || item.date;
  if (!raw) return 24;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return 24;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function splitNewsByLatency(newsHits, sources, maxAgeInstantMin = 30) {
  const instant = [];
  const delayed = [];
  for (const hit of newsHits || []) {
    instant.push(hit);
  }
  const pools = [
    ...(sources?.policy?.items || []),
    ...(sources?.geopolitics?.items || []),
    ...(sources?.climate?.items || []),
  ];
  for (const item of pools.slice(0, 60)) {
    const ageH = newsAgeHours(item);
    if (ageH <= maxAgeInstantMin / 60) instant.push(item);
    else if (ageH >= 1 && ageH <= 24) delayed.push(item);
  }
  return { instant, delayed };
}

function scoreNewsList(items, directionWeight = 1) {
  let bull = 0;
  let bear = 0;
  let w = 0;
  for (const item of items || []) {
    const stars = item.stars || 2;
    const weight = (stars / 5) * (item.relevance ?? 0.85);
    w += weight;
    const dir = item.direction || 'neutral';
    if (dir === 'bullish') bull += weight * directionWeight;
    else if (dir === 'bearish') bear += weight * directionWeight;
  }
  if (w <= 0) return { score: 0, weight: 0, burst: 0 };
  const score = clamp((bull - bear) / w, -1, 1);
  const burst = clamp(w * 0.08, 0, 0.35);
  return { score, weight: w, burst };
}

/**
 * 即时通道强度 0–1：盘中涨跌、放量、≤30min 资讯、VIX 跳升
 */
function computeInstantChannel({
  intradayChangePct = 0,
  intradayScore = 0,
  volumeRatio = 1,
  newsHits = [],
  sources = {},
  vix = 20,
  vixPrev = null,
}) {
  const signals = [];
  const absChg = Math.abs(Number(intradayChangePct) || 0);
  let strength = 0;

  if (absChg >= 0.15) {
    strength += clamp(absChg / 1.2, 0.12, 0.45);
    signals.push(`盘中${intradayChangePct > 0 ? '+' : '-'}${Number(intradayChangePct).toFixed(2)}%`);
  }
  if (volumeRatio >= 1.45) {
    strength += clamp((volumeRatio - 1.2) * 0.22, 0.08, 0.35);
    signals.push(`量比${Number(volumeRatio).toFixed(2)}`);
  }

  const { instant: instantNews } = splitNewsByLatency(newsHits, sources, 30);
  const instantNewsScore = scoreNewsList(instantNews);
  if (instantNewsScore.weight > 0) {
    strength += clamp(instantNewsScore.weight * 0.06, 0.05, 0.28);
    signals.push(`快讯${instantNews.length}条`);
  }

  const vixJump = vixPrev != null && !Number.isNaN(vixPrev) ? vix - vixPrev : 0;
  if (vixJump >= 2 || vix >= 28) {
    strength += clamp(vixJump * 0.04 + (vix >= 28 ? 0.1 : 0), 0.05, 0.25);
    signals.push(`VIX${vix.toFixed(1)}`);
  }

  strength = clamp(strength, 0, 1);

  let score = clamp(intradayScore || intradayChangePct / 1.5, -1, 1);
  if (instantNewsScore.weight > 0) {
    score = clamp(score * 0.55 + instantNewsScore.score * 0.45, -1, 1);
  }
  if (vix >= 26 && absChg < 0.1) score -= 0.08;

  return {
    strength: +strength.toFixed(3),
    score: +score.toFixed(4),
    newsBurst: +instantNewsScore.burst.toFixed(3),
    volShock: absChg >= 0.35 ? +clamp((absChg - 0.25) * 0.15, 0.05, 0.2).toFixed(3) : 0,
    signals,
  };
}

/**
 * 滞后通道强度 0–1：OI 堆积、MA 排列、平滑波动趋势、1–24h 政策
 */
function computeDelayedChannel({
  oiDeltaPct = null,
  oiScore = 0,
  maStack = null,
  smoothedVol = null,
  technicalScore = 0,
  macroScores = {},
  newsHits = [],
  sources = {},
}) {
  const signals = [];
  let strength = 0;

  if (oiDeltaPct != null && Math.abs(oiDeltaPct) >= 0.5) {
    strength += clamp(Math.abs(oiDeltaPct) / 8, 0.1, 0.38);
    signals.push(`持仓${oiDeltaPct > 0 ? '+' : '-'}${Number(oiDeltaPct).toFixed(1)}%`);
  }

  if (maStack?.alignment) {
    const align = maStack.alignment;
    if (align.includes('bull') || align.includes('bear')) {
      strength += 0.18;
      signals.push(maStack.alignmentLabel || 'MA排列');
    }
  }

  if (smoothedVol?.volRising || smoothedVol?.volFalling) {
    strength += 0.12;
    signals.push(smoothedVol.volRising ? '波动升' : '波动降');
  }

  const { delayed: delayedNews } = splitNewsByLatency(newsHits, sources, 30);
  const policyScore = scoreNewsList(delayedNews);
  if (policyScore.weight > 0) {
    strength += clamp(policyScore.weight * 0.05, 0.06, 0.22);
    signals.push(`政策/滞后资讯${delayedNews.length}条`);
  }

  strength = clamp(strength, 0, 1);

  let score = clamp(oiScore || (oiDeltaPct != null ? oiDeltaPct / 15 : 0), -1, 1);
  score = clamp(score * 0.35 + (technicalScore || 0) * 0.25, -1, 1);
  const macroBlend =
    (macroScores.china ?? 0) * 0.35 +
    (macroScores.policy ?? macroScores.china ?? 0) * 0.25 +
    (macroScores.fed ?? 0) * 0.2 +
    (macroScores.geo ?? 0) * 0.2;
  score = clamp(score * 0.55 + macroBlend * 0.45, -1, 1);
  if (policyScore.weight > 0) {
    score = clamp(score * 0.7 + policyScore.score * 0.3, -1, 1);
  }

  return {
    strength: +strength.toFixed(3),
    score: +score.toFixed(4),
    signals,
  };
}

function computeLatencyState(instantScore, delayedScore, instantStrength, delayedStrength) {
  const iSign = Math.sign(instantScore || 0);
  const dSign = Math.sign(delayedScore || 0);
  const iAbs = Math.abs(instantScore || 0);
  const dAbs = Math.abs(delayedScore || 0);

  if (iSign !== 0 && dSign !== 0 && iSign !== dSign && iAbs >= 0.08 && dAbs >= 0.06) {
    return 'divergent';
  }
  if (instantStrength >= 0.35 && (dAbs < iAbs * 0.55 || delayedStrength < 0.22)) {
    return 'lagging';
  }
  return 'sync';
}

function computeAdaptiveWeights({ instantStrength, newsBurst = 0, volShock = 0, latencyState }) {
  const base = 0.28;
  let wInstant = base + (newsBurst || 0) + (volShock || 0) + instantStrength * 0.12;
  wInstant = clamp(wInstant, 0.15, 0.7);
  let wDelayed = 1 - wInstant;
  if (latencyState === 'lagging') {
    wDelayed = clamp(wDelayed * 1.18, 0.3, 0.85);
    wInstant = 1 - wDelayed;
  } else if (latencyState === 'divergent') {
    wInstant = clamp(wInstant * 1.08, 0.2, 0.72);
    wDelayed = 1 - wInstant;
  }
  return {
    wInstant: +wInstant.toFixed(3),
    wDelayed: +wDelayed.toFixed(3),
  };
}

function buildLatencyRationale({ instantContrib, delayedContrib, latencyState, wInstant, wDelayed }) {
  const stateLabel = LATENCY_LABELS[latencyState] || latencyState;
  const instantPart = `盘面已反应(${instantContrib >= 0 ? '+' : '-'}${instantContrib.toFixed(2)}即时)`;
  const delayedPart = `持仓/政策滞后(延迟${delayedContrib >= 0 ? '+' : '-'}${delayedContrib.toFixed(2)})`;
  return `${instantPart}，${delayedPart}，当前状态:${stateLabel} · w即时${(wInstant * 100).toFixed(0)}%`;
}

/**
 * 自适应综合分 + factorBreakdown 扩展项
 */
function computeAdaptiveOutlook(params) {
  const instant = computeInstantChannel(params);
  const delayed = computeDelayedChannel(params);
  const latencyState = computeLatencyState(
    instant.score,
    delayed.score,
    instant.strength,
    delayed.strength
  );
  const { wInstant, wDelayed } = computeAdaptiveWeights({
    instantStrength: instant.strength,
    newsBurst: instant.newsBurst,
    volShock: instant.volShock,
    latencyState,
  });

  const compositeScore = clamp(wInstant * instant.score + wDelayed * delayed.score, -1, 1);
  const instantContrib = wInstant * instant.score;
  const delayedContrib = wDelayed * delayed.score;

  const factorBreakdown = {
    instant: +instantContrib.toFixed(2),
    delayed: +delayedContrib.toFixed(2),
    latency: latencyState,
  };

  return {
    instantChannel: instant.strength,
    delayedChannel: delayed.strength,
    instantScore: instant.score,
    delayedScore: delayed.score,
    wInstant,
    wDelayed,
    latencyState,
    latencyLabel: LATENCY_LABELS[latencyState],
    compositeScore: +compositeScore.toFixed(4),
    factorBreakdown,
    instantFired: instant.strength >= 0.35,
    rationaleSuffix: buildLatencyRationale({
      instantContrib,
      delayedContrib,
      latencyState,
      wInstant,
      wDelayed,
    }),
    signals: { instant: instant.signals, delayed: delayed.signals },
  };
}

module.exports = {
  LATENCY_LABELS,
  computeInstantChannel,
  computeDelayedChannel,
  computeLatencyState,
  computeAdaptiveWeights,
  computeAdaptiveOutlook,
  buildLatencyRationale,
};
