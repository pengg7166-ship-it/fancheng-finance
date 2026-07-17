/**

 * 入场哲学映射 '大宗走势研判方向 '入场周期与策'
 *

 * 用户确认 2026-07-01'
 * - 日线方向：三时段 slot-snapshot direction（非 composite 单独'
 * - 大级别方向：horizons.medium— 周）

 * - 一'neutral '不做；同—仅日'5m/15m/1h；冲—跟日线做日内

 */

const outlookSlotExport = require('./outlook-slot-export');



const INTRADAY_EXPORT_SLOTS = new Set(['night_prep', 'day_prep', 'early_morning']);

const LARGE_TF_EXPORT_SLOTS = new Set(['night_prep', 'day_prep']);



function normalizeDir(raw) {

  const v = String(raw || '').toLowerCase();

  if (v === 'bullish' || v === 'strong_bullish' || v.includes('bull')) return 'bullish';

  if (v === 'bearish' || v === 'strong_bearish' || v.includes('bear')) return 'bearish';

  return 'neutral';

}



function dirToSide(dir) {

  if (dir === 'bullish') return 'long';

  if (dir === 'bearish') return 'short';

  return null;

}



/** 日线方向 '三时'slot-snapshot direction（决'C'*/

function resolveDailyDirection(opts = {}) {

  const { outlookRange, exportSlot, gateOut } = opts;

  if (exportSlot) {

    if (outlookRange?.rangeSource === 'slot-snapshot' && outlookRange?.direction != null) {

      return normalizeDir(outlookRange.direction);

    }

    return 'neutral';

  }

  return normalizeDir(gateOut?.primaryDirection || gateOut?.philosophyDirection);

}



/** 大级别方—horizons.medium— 周，决策 B 暂定'*/

function resolveLargeTfDirection(opts = {}) {

  const inst =

    opts.outlookInstrument ||

    (opts.instrumentId ? outlookSlotExport.readLiveOutlookInstrument(opts.instrumentId) : null);

  const medium = inst?.medium;

  if (medium?.direction) return normalizeDir(medium.direction);

  return 'neutral';

}



function buildIntradayPlan(side, dailyDir, alignment) {

  const conflict = alignment === 'conflict';

  const label =

    side === 'long'

      ? conflict

        ? '日线看涨·冲突跟日线·逢低做多'

        : '日线看涨·逢低做多'

      : conflict

        ? '日线看空·冲突跟日线·逢高做空'

        : '日线看空·逢高做空';

  return {

    side,

    tfs: ['5m', '15m', '1h'],

    style: side === 'long' ? 'buy_dip' : 'sell_rally',

    directionSource: 'daily',

    directionLabel: label,

    alignment,

  };

}



/**

 * @returns {{ dailyDir: string, largeTfDir: string, alignment: string|null, skipReason: string|null, plans: object[] }}

 */

function resolveEntryPlans(opts = {}) {

  const exportSlot = opts.exportSlot || null;

  const dailyDir = resolveDailyDirection(opts);

  const largeTfDir = resolveLargeTfDirection(opts);

  const plans = [];



  if (dailyDir === 'neutral' || largeTfDir === 'neutral') {

    return {

      dailyDir,

      largeTfDir,

      alignment: null,

      skipReason: 'philosophy_one_neutral',

      plans: [],

    };

  }



  let alignment = 'same';

  let intradayDir = dailyDir;

  if (dailyDir !== largeTfDir) {

    alignment = 'conflict';

    intradayDir = dailyDir;

  }



  if (exportSlot && INTRADAY_EXPORT_SLOTS.has(exportSlot)) {

    const side = dirToSide(intradayDir);

    if (side) plans.push(buildIntradayPlan(side, dailyDir, alignment));

  }



  if (!exportSlot) {

    const side = dirToSide(intradayDir);

    if (side) plans.push(buildIntradayPlan(side, dailyDir, alignment));

  }



  return { dailyDir, largeTfDir, alignment, skipReason: plans.length ? null : 'no_intraday_slot', plans };

}



module.exports = {

  INTRADAY_EXPORT_SLOTS,

  LARGE_TF_EXPORT_SLOTS,

  normalizeDir,

  dirToSide,

  resolveDailyDirection,

  resolveLargeTfDirection,

  resolveEntryPlans,

};


