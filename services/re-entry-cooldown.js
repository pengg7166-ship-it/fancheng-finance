/**
 * Re-entry cooldown logic — trading-day gate before posture > 观望.
 * v1.47.0-retail-discipline
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { listCloses, getCooldownConfig, DEFAULT_COOLDOWN_TRADING_DAYS } = require('./re-entry-cooldown-store');

const COOLDOWN_VERSION = 'v1.47.0-retail-discipline';

function nowIso() {
  return new Date().toISOString();
}

function tradingDaysBetween(startIso, endMs = Date.now()) {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return null;
  const calendarDays = (endMs - start) / (24 * 3600 * 1000);
  return Math.max(0, Math.floor(calendarDays * (5 / 7)));
}

function latestCloseForSymbol(symbol, closes = null) {
  const sym = normalizeCommodityId(symbol);
  const list = closes || listCloses(200);
  return list.find((c) => normalizeCommodityId(c.symbol) === sym) || null;
}

/**
 * Exception: playbook stage T change vs at close, or W2 hard event on symbol.
 */
function hasCooldownException(inst, closeRecord, context = {}) {
  const spec = inst?.integratedSpec || context.integratedSpec || {};
  const pbStage = spec.playbook?.stage;
  const closeStage = closeRecord?.playbookStage;
  if (pbStage && closeStage && pbStage !== closeStage) {
    return { excepted: true, reason: `playbook stage ${closeStage}→${pbStage}` };
  }
  const wl = spec.watchLevel;
  const hard = spec.hardPolicy?.hasHard || spec.poolStatus?.scoutAllowed === true && wl === 'W2';
  if (wl === 'W2' && hard) {
    return { excepted: true, reason: 'W2 hard event verified' };
  }
  return { excepted: false, reason: null };
}

/**
 * @param {string} symbol
 * @param {object} context '{ inst, closes, cooldownTradingDays }'
 */
function getReentryCooldown(symbol, context = {}) {
  const asOf = nowIso();
  const sym = normalizeCommodityId(symbol);
  const config = getCooldownConfig();
  const cooldownDays = context.cooldownTradingDays ?? config.cooldownTradingDays ?? DEFAULT_COOLDOWN_TRADING_DAYS;
  const closeRecord = latestCloseForSymbol(sym, context.closes);
  const logicChain = [];

  if (!closeRecord) {
    return {
      symbol: sym,
      inCooldown: false,
      daysRemaining: 0,
      cooldownTradingDays: cooldownDays,
      closeRecord: null,
      exception: null,
      logicChain,
      dataSource: 're-entry-cooldown',
      method: 'trading-day-since-close',
      version: COOLDOWN_VERSION,
      asOf,
    };
  }

  const elapsed = tradingDaysBetween(closeRecord.closedAt);
  const exception = context.inst ? hasCooldownException(context.inst, closeRecord, context) : { excepted: false };
  const daysRemaining = exception.excepted ? 0 : Math.max(0, cooldownDays - (elapsed ?? 0));
  const inCooldown = !exception.excepted && daysRemaining > 0;

  if (inCooldown) {
    logicChain.push({
      layer: 'ReentryCooldown',
      conclusion: '观望',
      evidence: `${sym} 平仓后 ${elapsed}/${cooldownDays} 交易日 · ${closeRecord.reason || 'closed'}`,
      dataSource: 're-entry-cooldown-store',
      asOf,
    });
  } else if (exception.excepted) {
    logicChain.push({
      layer: 'ReentryCooldown',
      conclusion: 'exception',
      evidence: exception.reason,
      dataSource: 're-entry-cooldown',
      asOf,
    });
  }

  return {
    symbol: sym,
    inCooldown,
    daysRemaining,
    elapsedTradingDays: elapsed,
    cooldownTradingDays: cooldownDays,
    closeRecord,
    exception: exception.excepted ? exception : null,
    logicChain,
    dataSource: 're-entry-cooldown',
    method: 'trading-day-since-close',
    version: COOLDOWN_VERSION,
    asOf,
  };
}

function getReentryCooldownBatch(symbols = [], context = {}) {
  const closes = context.closes || listCloses(200);
  return symbols.map((s) => getReentryCooldown(s, { ...context, closes }));
}

function applyReentryCooldownToPosture(posture, symbol, context = {}, logicChain) {
  const cd = getReentryCooldown(symbol, context);
  if (!cd.inCooldown) return posture;
  if (['试仓', '加仓', '持有'].includes(posture)) {
    if (logicChain) logicChain.push(...cd.logicChain);
    return '观望';
  }
  return posture;
}

module.exports = {
  COOLDOWN_VERSION,
  DEFAULT_COOLDOWN_TRADING_DAYS,
  tradingDaysBetween,
  getReentryCooldown,
  getReentryCooldownBatch,
  applyReentryCooldownToPosture,
  hasCooldownException,
};
