/**
 * 跨境传导 + logistic 方向融合 'v1.35.2 实验
 * 高置信：|overnight intl| > 0.5% 'cross-market 权重 '
 * 生产默认关闭；探'显式 env `FANCHENG_CROSS_MARKET_ENSEMBLE=1`
 */
const crossMarket = require('./cross-market-precious-inference');

const ENSEMBLE_ENV = 'FANCHENG_CROSS_MARKET_ENSEMBLE';
const HIGH_CONF_INTL_PCT = Number(process.env.FANCHENG_CROSS_HIGH_CONF_PCT) || 0.5;
const DEFAULT_W_CROSS = Number(process.env.FANCHENG_CROSS_BLEND_WEIGHT) || 0.35;
const HIGH_W_CROSS = Number(process.env.FANCHENG_CROSS_HIGH_BLEND_WEIGHT) || 0.65;
const DEFAULT_BULLISH = 0.55;
const DEFAULT_BEARISH = 0.45;

const DIR_THRESH = {
  au: { delta: 0.3, unit: '元/克' },
  ag: { delta: 15, unit: '元/千克' },
};

function directionFromPUp(pUp, opts = {}) {
  const bull = opts.bullishThreshold ?? DEFAULT_BULLISH;
  const bear = opts.bearishThreshold ?? DEFAULT_BEARISH;
  if (pUp >= bull) return 'bullish';
  if (pUp <= bear) return 'bearish';
  return 'neutral';
}

function isEnsembleEnabled(opts = {}) {
  if (opts.crossMarketEnsemble === false) return false;
  if (opts.crossMarketEnsemble === true) return true;
  return process.env[ENSEMBLE_ENV] === '1';
}

function overnightIntlPct(infer) {
  const prev = infer?.components?.intlLevelPrev;
  const now = infer?.components?.intlLevelNow;
  if (prev == null || now == null || !prev) return null;
  return +(((now - prev) / prev) * 100).toFixed(4);
}

function directionFromCrossDelta(delta, instrumentId) {
  const th = DIR_THRESH[instrumentId]?.delta ?? 0.3;
  if (delta == null || Number.isNaN(delta)) return 'neutral';
  if (delta > th) return 'bullish';
  if (delta < -th) return 'bearish';
  return 'neutral';
}

function directionToPUp(dir) {
  if (dir === 'bullish') return 0.75;
  if (dir === 'bearish') return 0.25;
  return 0.5;
}

function fuseCrossMarketWithLogistic(logisticOut, row, opts = {}) {
  if (!isEnsembleEnabled(opts)) return logisticOut;
  const id = String(row.instrumentId || 'au').toLowerCase();
  if (id !== 'au' && id !== 'ag') return logisticOut;

  const barDate = String(row.date || row.barDate || '').slice(0, 10);
  if (!barDate) return logisticOut;

  let infer;
  try {
    infer = crossMarket.inferPointChangeFromClose(barDate, id);
  } catch {
    return logisticOut;
  }
  if (infer?.gated || infer?.predictedDelta == null) {
    return { ...logisticOut, crossMarketMeta: { gated: true, reason: infer?.gateReason || 'gated' } };
  }

  const intlPct = overnightIntlPct(infer);
  const highConf = intlPct != null && Math.abs(intlPct) >= HIGH_CONF_INTL_PCT;
  const wCross = highConf ? HIGH_W_CROSS : DEFAULT_W_CROSS;
  const wLog = 1 - wCross;

  const crossDir = directionFromCrossDelta(infer.predictedDelta, id);
  const crossPUp = directionToPUp(crossDir);
  const logPUp = logisticOut.pUp ?? 0.5;
  const blendedPUp = +(wCross * crossPUp + wLog * logPUp).toFixed(4);
  const direction = directionFromPUp(blendedPUp, opts);
  const composite = Math.max(-1, Math.min(1, (blendedPUp - 0.5) * 2));

  return {
    ...logisticOut,
    composite: +composite.toFixed(4),
    direction,
    pUp: blendedPUp,
    backend: `${logisticOut.backend || 'logistic'}+cross-ensemble`,
    crossMarketMeta: {
      gated: false,
      highConf,
      wCross,
      wLog,
      overnightIntlPct: intlPct,
      crossDirection: crossDir,
      crossPUp,
      logisticPUp: logPUp,
      predictedDelta: infer.predictedDelta,
      intlSource: infer.dataSources?.intl,
    },
  };
}

module.exports = {
  ENSEMBLE_ENV,
  HIGH_CONF_INTL_PCT,
  DEFAULT_W_CROSS,
  HIGH_W_CROSS,
  isEnsembleEnabled,
  overnightIntlPct,
  directionFromCrossDelta,
  fuseCrossMarketWithLogistic,
};
