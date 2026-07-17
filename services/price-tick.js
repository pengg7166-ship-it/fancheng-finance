/**

 * Exchange minimum price tick 'round/format predictions to valid quote increments.

 */

const { getCommodityMeta } = require('./commodities-catalog');

const { getRawSpec, RAW_SPECS } = require('./futures-contract-specs');



const DEFAULT_TICK = 1;



/** Exchange-wide default when a product spec row is missing. */

const EXCHANGE_DEFAULT_TICK = {

  shfe: 1,

  ine: 0.1,

  dce: 1,

  zce: 1,

  gfex: 5,

};



function getTickDecimals(tick) {

  if (tick == null || tick >= 1) return 0;

  const frac = String(tick).split('.')[1];

  return frac ? frac.length : 2;

}



function getTickSize(instrumentId) {

  const id = String(instrumentId || '').toLowerCase();

  const spec = getRawSpec(id);

  if (spec?.tickSize > 0) return spec.tickSize;

  const meta = getCommodityMeta(id);

  const exchangeDefault = meta?.exchangeId ? EXCHANGE_DEFAULT_TICK[meta.exchangeId] : null;

  return exchangeDefault ?? DEFAULT_TICK;

}



function roundPriceToTick(instrumentId, price) {

  if (price == null || Number.isNaN(Number(price))) return null;

  const tick = getTickSize(instrumentId);

  const v = Number(price);

  const rounded = Math.round(v / tick) * tick;

  return +rounded.toFixed(getTickDecimals(tick));

}



/** True when price is an exact multiple of the instrument tick (within float tolerance). */

function isValidTickPrice(instrumentId, price) {

  if (price == null || Number.isNaN(Number(price))) return false;

  const rounded = roundPriceToTick(instrumentId, price);

  return rounded != null && Math.abs(Number(price) - rounded) < 1e-9;

}



function listAllTickSizes() {

  const { getAllCommodities } = require('./commodities-catalog');

  const out = {};

  for (const c of getAllCommodities()) {

    const id = String(c.id).toLowerCase();

    out[id] = getTickSize(id);

  }

  return out;

}



/** Detect pct band stored where absolute prices were expected (e.g. 1.553 / -1.943 vs base 968). */

function looksLikePctBand(high, low, baseClose) {

  const base = Number(baseClose);

  const hi = Number(high);

  const lo = Number(low);

  if ([base, hi, lo].some((v) => v == null || Number.isNaN(v))) return false;

  if (base <= 0) return false;

  if (Math.abs(hi) > 25 || Math.abs(lo) > 25) return false;

  if (Math.abs(hi) < base * 0.02 && Math.abs(lo) < base * 0.02) return true;

  return false;

}



function pctBandToPrices({ instrumentId, baseClose, lowPct, highPct }) {

  const base = Number(baseClose);

  if (!base || base <= 0) return { predictedHigh: null, predictedLow: null };

  const loPct = Number(lowPct);

  const hiPct = Number(highPct);

  if ([loPct, hiPct].some((v) => Number.isNaN(v))) {

    return { predictedHigh: null, predictedLow: null };

  }

  const rawLo = base * (1 + loPct / 100);

  const rawHi = base * (1 + hiPct / 100);

  const predictedLow = roundPriceToTick(instrumentId, Math.min(rawLo, rawHi));

  const predictedHigh = roundPriceToTick(instrumentId, Math.max(rawLo, rawHi));

  return { predictedLow, predictedHigh };

}



function formatPriceForInstrument(instrumentId, price) {

  if (price == null || Number.isNaN(Number(price))) return '';

  const v = roundPriceToTick(instrumentId, price);

  if (v == null) return '';

  const tick = getTickSize(instrumentId);

  if (tick >= 1) return String(Math.round(v));

  return v.toFixed(getTickDecimals(tick));

}



module.exports = {

  DEFAULT_TICK,

  EXCHANGE_DEFAULT_TICK,

  RAW_SPECS,

  getTickSize,

  getTickDecimals,

  roundPriceToTick,

  isValidTickPrice,

  listAllTickSizes,

  looksLikePctBand,

  pctBandToPrices,

  formatPriceForInstrument,

};

