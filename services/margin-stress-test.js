/**
 * Margin stress test — uses quant-trading-margin contract specs
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const futuresSpecs = require('./futures-contract-specs');

const STRESS_VERSION = 'v1.44.0-discipline';
const MARGIN_SOURCE_LABEL = 'futures-contract-specs + margin bump';
const DEFAULT_SCOUT_LOTS = 1;
const WARN_MARGIN_YUAN = 80000;
const CRITICAL_MARGIN_YUAN = 150000;

function nowIso() {
  return new Date().toISOString();
}

function getContractSpec(id) {
  return futuresSpecs.getContractSpec(id);
}

function calcNotional(price, instrumentId, lots = 1) {
  const spec = getContractSpec(instrumentId);
  if (!spec) return 0;
  return Number(price) * spec.multiplier * Math.max(1, lots);
}

function calcMarginRequired(price, instrumentId, lots = 1) {
  const spec = getContractSpec(instrumentId);
  if (!spec) return 0;
  return calcNotional(price, instrumentId, lots) * spec.marginRate;
}

function resolvePrice(symbol, entry = {}) {
  if (entry.price != null && Number(entry.price) > 0) return Number(entry.price);
  try {
    const directionArchive = require('./direction-prediction-archive');
    const bars = directionArchive.readKlineBars(symbol);
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      const close = Number(bars[i]?.close);
      if (close > 0) return close;
    }
  } catch {
    // optional kline source
  }
  return null;
}

function normalizeHoldingsInput(holdings = []) {
  if (!Array.isArray(holdings)) return [];
  return holdings
    .slice(0, 3)
    .map((h) => {
      if (typeof h === 'string') return { symbol: normalizeCommodityId(h), lots: DEFAULT_SCOUT_LOTS };
      return {
        symbol: normalizeCommodityId(h.symbol || h.id),
        lots: Math.max(1, Number(h.lots) || DEFAULT_SCOUT_LOTS),
        price: h.price != null ? Number(h.price) : null,
      };
    })
    .filter((h) => h.symbol);
}

function classifyMarginLevel(marginYuan) {
  if (marginYuan == null) return 'unknown';
  if (marginYuan >= CRITICAL_MARGIN_YUAN) return 'critical';
  if (marginYuan >= WARN_MARGIN_YUAN) return 'warn';
  return 'safe';
}

function runMarginStress(holdings = [], marginBumpPct = 2) {
  const normalized = normalizeHoldingsInput(holdings);
  const bump = Math.max(0, Number(marginBumpPct) || 2);
  const perSymbol = [];
  let portfolioCurrent = 0;
  let portfolioStressed = 0;
  let allPending = true;

  for (const h of normalized) {
    const spec = getContractSpec(h.symbol);
    const price = resolvePrice(h.symbol, h);
    if (!spec || price == null) {
      perSymbol.push({
        symbol: h.symbol,
        lots: h.lots,
        status: '待校验',
        currentMarginYuan: null,
        stressedMarginYuan: null,
        reason: !spec ? 'missing contract spec' : 'missing close price',
        dataSource: 'margin-stress-test',
      });
      continue;
    }
    allPending = false;
    const current = calcMarginRequired(price, h.symbol, h.lots);
    const stressedRate = Math.min(0.99, spec.marginRate + bump / 100);
    const notional = calcNotional(price, h.symbol, h.lots);
    const stressed = notional * stressedRate;
    portfolioCurrent += current;
    portfolioStressed += stressed;
    perSymbol.push({
      symbol: h.symbol,
      lots: h.lots,
      price,
      marginRate: spec.marginRate,
      stressedMarginRate: stressedRate,
      notionalYuan: Math.round(notional),
      currentMarginYuan: Math.round(current),
      stressedMarginYuan: Math.round(stressed),
      marginBumpPct: bump,
      level: classifyMarginLevel(stressed),
      status: 'verified',
      dataSource: 'margin-stress-test',
      specSource: MARGIN_SOURCE_LABEL,
    });
  }

  return {
    perSymbol,
    portfolio: {
      currentMarginYuan: allPending ? null : Math.round(portfolioCurrent),
      stressedMarginYuan: allPending ? null : Math.round(portfolioStressed),
      marginBumpPct: bump,
      level: allPending ? 'unknown' : classifyMarginLevel(portfolioStressed),
      status: allPending ? '待校验' : 'verified',
      symbolCount: normalized.length,
    },
    version: STRESS_VERSION,
    dataSource: 'margin-stress-test',
    method: 'contract-spec+margin-bump',
    asOf: nowIso(),
  };
}

module.exports = {
  STRESS_VERSION,
  DEFAULT_SCOUT_LOTS,
  runMarginStress,
  normalizeHoldingsInput,
  classifyMarginLevel,
};
