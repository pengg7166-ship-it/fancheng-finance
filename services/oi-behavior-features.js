/**
 * 持仓行为因子 'OI 变化、成交持仓比、增减仓-价格背离标记
 * 依赖 history/trading/*.json 'klines 'oi/openInterest 字段
 */

function getBarOi(bar) {
  if (!bar) return null;
  const oi = bar.oi ?? bar.openInterest;
  if (oi == null || Number.isNaN(oi) || oi <= 0) return null;
  return Number(oi);
}

function getBarClose(bar) {
  const c = bar?.close ?? bar?.price;
  if (c == null || Number.isNaN(c)) return null;
  return Number(c);
}

/**
 * 'bar 行为特征（相对前一根）
 * @returns {{
 *   oi_change: number|null,
 *   oi_change_pct: number|null,
 *   volume_oi_ratio: number|null,
 *   price_up_oi_down: boolean,
 *   price_down_oi_up: boolean,
 *   behavior_tag: '增仓下跌'|'减仓上涨'|null
 * }}
 */
function computeOiBehaviorAtBar(bars, barIndex) {
  const bar = bars?.[barIndex];
  const prev = barIndex > 0 ? bars[barIndex - 1] : null;
  const oi = getBarOi(bar);
  const prevOi = getBarOi(prev);
  const close = getBarClose(bar);
  const prevClose = getBarClose(prev);
  const volume = bar?.volume != null && !Number.isNaN(bar.volume) ? Number(bar.volume) : null;

  let oiChange = null;
  let oiChangePct = null;
  if (oi != null && prevOi != null) {
    oiChange = oi - prevOi;
    oiChangePct = prevOi > 0 ? +((oiChange / prevOi) * 100).toFixed(4) : null;
  }

  const volumeOiRatio =
    volume != null && oi != null && oi > 0 ? +(volume / oi).toFixed(6) : null;

  const priceUp = close != null && prevClose != null && close > prevClose;
  const priceDown = close != null && prevClose != null && close < prevClose;
  const oiUp = oiChange != null && oiChange > 0;
  const oiDown = oiChange != null && oiChange < 0;

  const priceUpOiDown = Boolean(priceUp && oiDown);
  const priceDownOiUp = Boolean(priceDown && oiUp);

  let behaviorTag = null;
  if (priceDownOiUp) behaviorTag = '增仓下跌';
  else if (priceUpOiDown) behaviorTag = '减仓上涨';

  return {
    oi_change: oiChange,
    oi_change_pct: oiChangePct,
    volume_oi_ratio: volumeOiRatio,
    price_up_oi_down: priceUpOiDown,
    price_down_oi_up: priceDownOiUp,
    behavior_tag: behaviorTag,
  };
}

/**
 * 滚动 window 日增减仓-价格背离占比（含当日'
 */
function computeOiDivergenceRate5d(bars, barIndex, window = 5) {
  if (!bars?.length || barIndex < 0) return null;
  const start = Math.max(0, barIndex - window + 1);
  let count = 0;
  let n = 0;
  for (let i = start; i <= barIndex; i += 1) {
    const beh = computeOiBehaviorAtBar(bars, i);
    if (beh.price_up_oi_down || beh.price_down_oi_up) count += 1;
    n += 1;
  }
  if (!n) return null;
  return +(count / n).toFixed(4);
}

/**
 * 为整'bars 附加行为列（'mutate 原数组）
 */
function enrichBarsWithOiBehavior(bars) {
  if (!Array.isArray(bars)) return [];
  return bars.map((bar, i) => ({
    ...bar,
    oiBehavior: computeOiBehaviorAtBar(bars, i),
  }));
}

/**
 * 汇'OI 覆盖率（2019+ 口径'
 */
function auditOiCoverage(bars, minStart = '2019-01-01') {
  const from2019 = bars.filter((b) => String(b.date).slice(0, 10) >= minStart);
  const withOi = from2019.filter((b) => getBarOi(b) != null);
  const pct = from2019.length ? withOi.length / from2019.length : 0;
  return {
    total: from2019.length,
    withOi: withOi.length,
    coveragePct: +(pct * 100).toFixed(1),
    ok: pct >= 0.8,
  };
}

module.exports = {
  getBarOi,
  computeOiBehaviorAtBar,
  computeOiDivergenceRate5d,
  enrichBarsWithOiBehavior,
  auditOiCoverage,
};
