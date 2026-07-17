/**
 * 国内期货主力连续合约仿真参数 '乘数 / 最小变动价'/ 保证金率
 * 来源：各交易所合约规则（公开资料）；仿真固定率，非逐日动'
 */
const { getCommodityMeta } = require('./commodities-catalog');

/** @type {Record<string, { multiplier: number, tickSize: number, marginRate: number }>} */
const RAW_SPECS = {
  // SHFE
  cu: { multiplier: 5, tickSize: 10, marginRate: 0.12 },
  al: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  zn: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  pb: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  ni: { multiplier: 1, tickSize: 10, marginRate: 0.14 },
  sn: { multiplier: 1, tickSize: 10, marginRate: 0.14 },
  au: { multiplier: 1000, tickSize: 0.02, marginRate: 0.14 },
  ag: { multiplier: 15, tickSize: 1, marginRate: 0.14 },
  rb: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  hc: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  ss: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  wr: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  fu: { multiplier: 10, tickSize: 1, marginRate: 0.12 },
  bu: { multiplier: 10, tickSize: 2, marginRate: 0.12 },
  ru: { multiplier: 10, tickSize: 5, marginRate: 0.12 },
  sp: { multiplier: 10, tickSize: 2, marginRate: 0.12 },
  ao: { multiplier: 20, tickSize: 1, marginRate: 0.12 },
  br: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  ad: { multiplier: 10, tickSize: 5, marginRate: 0.12 },
  // INE
  sc: { multiplier: 1000, tickSize: 0.1, marginRate: 0.12 },
  lu: { multiplier: 10, tickSize: 1, marginRate: 0.12 },
  bc: { multiplier: 5, tickSize: 10, marginRate: 0.12 },
  ec: { multiplier: 50, tickSize: 0.1, marginRate: 0.15 },
  // DCE
  a: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  b: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  c: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  cs: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  m: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  y: { multiplier: 10, tickSize: 2, marginRate: 0.11 },
  p: { multiplier: 10, tickSize: 2, marginRate: 0.11 },
  l: { multiplier: 5, tickSize: 1, marginRate: 0.11 },
  v: { multiplier: 5, tickSize: 1, marginRate: 0.11 },
  pp: { multiplier: 5, tickSize: 1, marginRate: 0.11 },
  j: { multiplier: 100, tickSize: 0.5, marginRate: 0.12 },
  jm: { multiplier: 60, tickSize: 0.5, marginRate: 0.12 },
  i: { multiplier: 100, tickSize: 0.5, marginRate: 0.12 },
  eg: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  eb: { multiplier: 5, tickSize: 1, marginRate: 0.11 },
  pg: { multiplier: 20, tickSize: 1, marginRate: 0.12 },
  jd: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  lh: { multiplier: 16, tickSize: 5, marginRate: 0.12 },
  rr: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  lg: { multiplier: 90, tickSize: 0.5, marginRate: 0.12 },
  // ZCE (keys lowercase)
  cf: { multiplier: 5, tickSize: 5, marginRate: 0.11 },
  sr: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  ta: { multiplier: 5, tickSize: 2, marginRate: 0.11 },
  oi: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  ma: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  fg: { multiplier: 20, tickSize: 1, marginRate: 0.11 },
  rm: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  sf: { multiplier: 5, tickSize: 2, marginRate: 0.11 },
  sm: { multiplier: 5, tickSize: 2, marginRate: 0.11 },
  ap: { multiplier: 10, tickSize: 1, marginRate: 0.12 },
  cj: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  ur: { multiplier: 20, tickSize: 1, marginRate: 0.11 },
  sa: { multiplier: 20, tickSize: 1, marginRate: 0.11 },
  pf: { multiplier: 5, tickSize: 2, marginRate: 0.11 },
  pk: { multiplier: 5, tickSize: 2, marginRate: 0.11 },
  sh: { multiplier: 30, tickSize: 1, marginRate: 0.11 },
  px: { multiplier: 5, tickSize: 2, marginRate: 0.11 },
  pr: { multiplier: 15, tickSize: 2, marginRate: 0.11 },
  cy: { multiplier: 5, tickSize: 5, marginRate: 0.11 },
  rs: { multiplier: 10, tickSize: 1, marginRate: 0.11 },
  wh: { multiplier: 20, tickSize: 1, marginRate: 0.11 },
  pm: { multiplier: 50, tickSize: 1, marginRate: 0.11 },
  ri: { multiplier: 20, tickSize: 1, marginRate: 0.11 },
  lr: { multiplier: 20, tickSize: 1, marginRate: 0.11 },
  jr: { multiplier: 20, tickSize: 1, marginRate: 0.11 },
  zc: { multiplier: 100, tickSize: 0.2, marginRate: 0.12 },
  // GFEX
  si: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  lc: { multiplier: 1, tickSize: 50, marginRate: 0.14 },
  ps: { multiplier: 5, tickSize: 5, marginRate: 0.12 },
  pt: { multiplier: 1000, tickSize: 0.02, marginRate: 0.14 },
  pd: { multiplier: 1000, tickSize: 0.02, marginRate: 0.14 },
};

function buildContractSpec(instrumentId, raw) {
  const meta = getCommodityMeta(instrumentId);
  return {
    exchange: meta?.exchangeId?.toUpperCase() || 'CN',
    name: meta?.name || instrumentId,
    multiplier: raw.multiplier,
    priceUnit: meta?.unit || '—',
    tickSize: raw.tickSize,
    marginRate: raw.marginRate,
    tradingHours: '日盘+夜盘',
  };
}

/** @type {Record<string, object>} */
const CONTRACT_SPECS = Object.fromEntries(
  Object.entries(RAW_SPECS).map(([id, raw]) => [id, buildContractSpec(id, raw)])
);

function getRawSpec(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  return RAW_SPECS[id] || null;
}

function getContractSpec(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  return CONTRACT_SPECS[id] || null;
}

function listSpecIds() {
  return Object.keys(CONTRACT_SPECS);
}

module.exports = {
  RAW_SPECS,
  CONTRACT_SPECS,
  getRawSpec,
  getContractSpec,
  listSpecIds,
};
