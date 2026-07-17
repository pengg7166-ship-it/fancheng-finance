/**
 * 固定时段预测—每日 20:55 / 08:55 / 13:25（Asia/Shanghai'
 * 供定时快照、存档标签、回测对照使用'
 */
const cnSession = require('./cn-futures-session-calendar');
const tradingSession = require('./trading-session-calendar');

const TIMEZONE = 'Asia/Shanghai';
const CAPTURE_TOLERANCE_MINUTES = 2;

const PREDICTION_SLOTS = [
  {
    id: 'pre-night',
    label: '20:55夜盘',
    shortLabel: '20:55',
    cronHour: 20,
    cronMinute: 55,
    description: '日盘收盘后、夜盘开盘前基准预测',
  },
  {
    id: 'pre-day',
    label: '08:55日盘',
    shortLabel: '08:55',
    cronHour: 8,
    cronMinute: 55,
    description: '夜盘结束后、日盘开盘前预测',
  },
  {
    id: 'pre-afternoon',
    label: '13:25午盘',
    shortLabel: '13:25',
    cronHour: 13,
    cronMinute: 25,
    description: '日盘午间、夜盘重启前预测',
  },
];

const SLOT_BY_ID = Object.fromEntries(PREDICTION_SLOTS.map((s) => [s.id, s]));

function getSlotById(slotId) {
  return SLOT_BY_ID[String(slotId || '')] || null;
}

function getAllSlots() {
  return PREDICTION_SLOTS.slice();
}

function cnTimeToMinutes(cnParts) {
  return cnParts.hour * 60 + cnParts.minute;
}

function slotTargetMinutes(slot) {
  return slot.cronHour * 60 + slot.cronMinute;
}

/** 当前 CN 时间是否落在某槽的捕获窗口内 */
function isSlotDueNow(slot, cnParts = cnSession.getCnNowParts(), toleranceMin = CAPTURE_TOLERANCE_MINUTES) {
  if (!slot) return false;
  const diff = Math.abs(cnTimeToMinutes(cnParts) - slotTargetMinutes(slot));
  return diff <= toleranceMin;
}

/** 返回当前时刻应触发的槽（若有'*/
function findDueSlot(cnParts = cnSession.getCnNowParts()) {
  return PREDICTION_SLOTS.find((s) => isSlotDueNow(s, cnParts)) || null;
}

/**
 * 解析槽位对应的目'session bar 日期（交易日 K 'date 字段'
 * 优先用参考品'K 线；'K 线时用日历近似'
 */
function resolveSessionDateForSlot(slotId, cnParts = cnSession.getCnNowParts(), bars = null) {
  const slot = getSlotById(slotId);
  if (!slot) return null;

  if (bars?.length) {
    const ctx = cnSession.resolvePredictionContext(bars, slotDateToInstant(cnParts, slot));
    if (ctx?.barIdx >= 0) {
      const target = cnSession.getNextSessionTarget(bars, ctx.barIdx);
      if (target?.nextBarDate) return target.nextBarDate;
    }
  }

  const { date } = cnParts;
  if (slotId === 'pre-night') {
    return cnSession.shiftCalendarDate(date, 1);
  }
  return date;
}

/** 构造槽位触发时刻的 Date（用'resolvePredictionContext'*/
function slotDateToInstant(cnParts, slot) {
  const d = new Date(
    `${cnParts.date}T${String(slot.cronHour).padStart(2, '0')}:${String(slot.cronMinute).padStart(2, '0')}:00+08:00`
  );
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function buildSlotMeta(slotId, opts = {}) {
  const slot = getSlotById(slotId);
  if (!slot) return null;
  const cnParts = opts.cnParts || cnSession.getCnNowParts(opts.now);
  const captureDate = opts.captureDate || cnParts.date;
  const predictTs =
    opts.predictTs ||
    new Date(
      `${captureDate}T${String(slot.cronHour).padStart(2, '0')}:${String(slot.cronMinute).padStart(2, '0')}:00+08:00`
    ).toISOString();
  const sessionDate =
    opts.sessionDate || resolveSessionDateForSlot(slotId, cnParts, opts.referenceBars);
  const genericWindow =
    slotId === 'pre-night'
      ? { label: '21:00–夜盘收(因品种而异)' }
      : slotId === 'pre-day'
        ? { label: tradingSession.DAY_MORNING.label }
        : { label: tradingSession.DAY_AFTERNOON.label };

  return {
    id: slot.id,
    label: slot.label,
    shortLabel: slot.shortLabel,
    captureDate,
    sessionDate,
    predictTs,
    timezone: TIMEZONE,
    sessionWindowLabel: genericWindow.label,
  };
}

function formatSlotKey(sessionDate, slotId) {
  return `${String(sessionDate || '').slice(0, 10)}|${slotId || 'legacy'}`;
}

module.exports = {
  TIMEZONE,
  CAPTURE_TOLERANCE_MINUTES,
  PREDICTION_SLOTS,
  getSlotById,
  getAllSlots,
  isSlotDueNow,
  findDueSlot,
  resolveSessionDateForSlot,
  buildSlotMeta,
  formatSlotKey,
};
