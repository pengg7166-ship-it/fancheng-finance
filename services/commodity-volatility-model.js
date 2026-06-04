/**
 * 双轨波动：平滑基线 + 盘中/资讯突变层 → 次日 composite σ
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function countHighStarHits(newsFactor, minStars = 4) {
  return (newsFactor?.hits || []).filter((h) => (h.stars || 0) >= minStars).length;
}

/**
 * 突变层：|盘中涨跌|、放量、高星资讯爆发
 */
function computeShockVol({
  intradayChangePct = 0,
  volumeRatio = 1,
  highStarCount = 0,
  smoothedVol = null,
  newsShock = 0,
}) {
  const emaRef = smoothedVol?.volEma20 ?? smoothedVol?.volForecastPct ?? 0.5;
  const absChg = Math.abs(Number(intradayChangePct) || 0);
  const chgShock = absChg >= 0.35 ? clamp((absChg - 0.25) * 0.55, 0, 1.2) : absChg >= 0.15 ? (absChg - 0.1) * 0.35 : 0;

  let volSpike = 0;
  if (volumeRatio >= 2) volSpike = 0.45 + (volumeRatio - 2) * 0.12;
  else if (volumeRatio >= 1.45) volSpike = (volumeRatio - 1.2) * 0.35;

  const newsBurst = highStarCount * 0.22 + (Math.abs(newsShock) > 0.12 ? Math.abs(newsShock) * 0.35 : 0);
  let shockVol = chgShock + volSpike + newsBurst;

  if (emaRef > 0 && absChg > emaRef * 1.8) {
    shockVol += clamp((absChg / emaRef - 1.5) * 0.25, 0, 0.6);
  }

  return +clamp(shockVol, 0, 2.5).toFixed(4);
}

/**
 * 突变权重：资讯条数 + 高星密度 + 放量
 */
function computeShockWeight({ newsHitCount = 0, highStarCount = 0, volumeRatio = 1 }) {
  let w = 0.35;
  w += Math.min(newsHitCount, 6) * 0.04;
  w += Math.min(highStarCount, 4) * 0.08;
  if (volumeRatio >= 1.5) w += 0.12;
  if (volumeRatio >= 2) w += 0.08;
  return +clamp(w, 0.25, 0.85).toFixed(3);
}

function computeCompositeVolPct({ baselineVol, shockVol, shockWeight }) {
  const base = Math.max(0.1, Number(baselineVol) || 0.5);
  const shock = Math.max(0, Number(shockVol) || 0);
  const w = Number(shockWeight) || 0.35;
  return +clamp(base + w * shock, 0.12, 8).toFixed(4);
}

function isVolShockTriggered({ shockVol, smoothedVol, highStarCount }) {
  const ema = smoothedVol?.volEma20 ?? smoothedVol?.volForecastPct ?? 0.5;
  return highStarCount >= 1 && (highStarCount >= 2 || shockVol > ema * 1.5);
}

module.exports = {
  computeShockVol,
  computeShockWeight,
  computeCompositeVolPct,
  countHighStarHits,
  isVolShockTriggered,
};
