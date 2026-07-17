/**
 * Delivery month calendar 'warehouse M-1 ramp alignment (Step 2)
 * Main contract delivery month from listed contract months + sector roll lead.
 */
const CONTRACT_MONTHS = {
  cu: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  al: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  zn: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  pb: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ni: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  sn: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ss: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  au: [2, 4, 6, 8, 10, 12],
  ag: [2, 4, 6, 8, 10, 12],
  rb: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  hc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  i: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  j: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  jm: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  sc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  fu: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

/** Months ahead from as-of date to pick main/near delivery month */
const SECTOR_ROLL_MONTHS_AHEAD = {
  metals: 1,
  black: 1,
  energy: 1,
  chemical: 2,
  agriculture: 2,
  precious: 1,
};

function normDate(d) {
  return String(d || '').slice(0, 10);
}

/**
 * Pick delivery YYYY-MM from listed contract months at rollMonthsAhead offset.
 * Mirrors term-structure far-month picker with configurable lead.
 */
function pickDeliveryMonthFromList(asOfDate, months, rollMonthsAhead) {
  const d = new Date(`${normDate(asOfDate)}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || !months?.length) return null;
  const target = new Date(d);
  target.setUTCMonth(target.getUTCMonth() + rollMonthsAhead);
  let y = target.getUTCFullYear();
  let m = target.getUTCMonth() + 1;
  let pick = months.find((mo) => mo >= m);
  if (pick == null) {
    y += 1;
    pick = months[0];
  }
  return `${y}-${String(pick).padStart(2, '0')}`;
}

/**
 * @param {string} asOfDate
 * @param {string} sector
 * @param {string} instrumentId
 * @param {object} [profile] 'optional contractMonths / deliveryRollMonthsAhead overrides
 */
function resolveDeliveryMonth(asOfDate, sector, instrumentId, profile = null) {
  const id = String(instrumentId || '').toLowerCase();
  const months = profile?.contractMonths || CONTRACT_MONTHS[id] || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const rollAhead =
    profile?.deliveryRollMonthsAhead ??
    SECTOR_ROLL_MONTHS_AHEAD[sector] ??
    SECTOR_ROLL_MONTHS_AHEAD[profile?.sector] ??
    1;
  return pickDeliveryMonthFromList(asOfDate, months, rollAhead);
}

module.exports = {
  CONTRACT_MONTHS,
  SECTOR_ROLL_MONTHS_AHEAD,
  pickDeliveryMonthFromList,
  resolveDeliveryMonth,
};
