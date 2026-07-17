/**
 * 固定时段预测调度 '应用运行期间每分钟检'CN 时间'
 * 注：需应用在前'后台运行；关闭后错过时段需手动 backfill 或下次启动补抓（'tick 逻辑）'
 */
const fs = require('fs');
const path = require('path');
const slots = require('./outlook-prediction-slots');
const cnSession = require('./cn-futures-session-calendar');
const { captureOutlookPredictionSnapshot } = require('./outlook-slot-snapshot');
const { getOutlookHistoryRoot } = require('./commodity-outlook-history');

const CHECK_INTERVAL_MS = 60 * 1000;
const STATE_FILE = 'outlook-slot-scheduler-state.json';

let schedulerTimer = null;
let captureInFlight = null;
let getInstrumentsFn = null;
let onCapturedFn = null;

function getStatePath() {
  const root = getOutlookHistoryRoot();
  return root ? path.join(root, STATE_FILE) : null;
}

function readState() {
  const fp = getStatePath();
  if (!fp || !fs.existsSync(fp)) return { captures: {} };
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { captures: {} };
  }
}

function writeState(state) {
  const fp = getStatePath();
  if (!fp) return;
  fs.writeFileSync(fp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

function stateKey(sessionDate, slotId) {
  return `${String(sessionDate).slice(0, 10)}|${slotId}`;
}

function wasCapturedInState(sessionDate, slotId) {
  const state = readState();
  return Boolean(state.captures?.[stateKey(sessionDate, slotId)]);
}

function markCapturedInState(sessionDate, slotId, result) {
  const state = readState();
  state.captures = state.captures || {};
  state.captures[stateKey(sessionDate, slotId)] = {
    at: new Date().toISOString(),
    path: result.path || null,
    instrumentCount: result.instrumentCount || 0,
  };
  writeState(state);
}

async function runSlotCapture(slotId, opts = {}) {
  if (captureInFlight) return captureInFlight;
  captureInFlight = (async () => {
    try {
      let instruments = opts.instruments;
      if (!instruments?.length && typeof getInstrumentsFn === 'function') {
        instruments = await getInstrumentsFn({ force: true });
      }
      const result = captureOutlookPredictionSnapshot(slotId, {
        ...opts,
        instruments: instruments || [],
      });
      if (result.captured) {
        markCapturedInState(result.sessionDate, slotId, result);
        if (typeof onCapturedFn === 'function') {
          try {
            onCapturedFn(result);
          } catch {
            // non-fatal
          }
        }
      }
      return result;
    } finally {
      captureInFlight = null;
    }
  })();
  return captureInFlight;
}

/**
 * 单次 tick '捕获当前 due 槽，并尝试补抓今日已过的槽（应用晚启动）
 */
async function tickOutlookSlotScheduler(opts = {}) {
  const cnParts = cnSession.getCnNowParts(opts.now);
  const due = slots.findDueSlot(cnParts);
  if (due) {
    const sessionDate = slots.resolveSessionDateForSlot(due.id, cnParts);
    if (!wasCapturedInState(sessionDate, due.id)) {
      return runSlotCapture(due.id, opts);
    }
    return { captured: false, reason: 'state_already_captured', slotId: due.id, sessionDate };
  }

  const nowMin = cnParts.hour * 60 + cnParts.minute;
  const missed = [];
  for (const slot of slots.getAllSlots()) {
    const slotMin = slot.cronHour * 60 + slot.cronMinute;
    if (nowMin <= slotMin + slots.CAPTURE_TOLERANCE_MINUTES) continue;
    const sessionDate = slots.resolveSessionDateForSlot(slot.id, cnParts);
    if (wasCapturedInState(sessionDate, slot.id)) continue;
    const { hasSlotCapture } = require('./outlook-slot-snapshot');
    if (hasSlotCapture(sessionDate, slot.id)) {
      markCapturedInState(sessionDate, slot.id, { path: null, instrumentCount: 0 });
      continue;
    }
    missed.push({ slot, sessionDate });
  }

  if (missed.length && opts.catchUp !== false) {
    const results = [];
    for (const m of missed) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runSlotCapture(m.slot.id, {
        ...opts,
        sessionDate: m.sessionDate,
        force: false,
      });
      results.push(r);
    }
    return {
      captured: results.some((r) => r?.captured),
      reason: 'catch_up_missed_slots',
      count: results.length,
      results,
    };
  }

  return { captured: false, reason: 'no_due_slot' };
}

function startOutlookSlotScheduler(options = {}) {
  getInstrumentsFn = options.getInstruments || getInstrumentsFn;
  onCapturedFn = options.onCaptured || onCapturedFn;

  if (schedulerTimer) clearInterval(schedulerTimer);

  setTimeout(() => {
    tickOutlookSlotScheduler({ catchUp: true }).catch(() => {});
  }, 8000);

  // 启动后周期性补抓：晚开应用也能把当日已过槽补齐
  schedulerTimer = setInterval(() => {
    tickOutlookSlotScheduler({ catchUp: true }).catch(() => {});
  }, CHECK_INTERVAL_MS);

  return { started: true, intervalMs: CHECK_INTERVAL_MS };
}

function stopOutlookSlotScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  CHECK_INTERVAL_MS,
  startOutlookSlotScheduler,
  stopOutlookSlotScheduler,
  tickOutlookSlotScheduler,
  runSlotCapture,
  readState,
};
