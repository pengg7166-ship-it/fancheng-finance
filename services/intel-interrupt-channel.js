/**
 * 情报中心 · Interrupt 投递通道深化（构想 §13/56）
 * 生命周期 + 班次拒投 + 投递回执 JSONL；禁止伪造系统通知到达。
 * 通道：hub（Hub 列表）| file（投递日志）— 无 OS push 时标「仅文件/Hub」。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

let DAILY_INTERRUPT_CAP = 3;
try {
  DAILY_INTERRUPT_CAP = require('./intel-push-tier').DAILY_INTERRUPT_CAP || 3;
} catch {
  DAILY_INTERRUPT_CAP = 3;
}

const CHANNEL_VERSION = 'v2.89.17-interrupt-n-gate';
const INTERRUPT_SURPRISE_N_GATE = 20;
const QUEUE_FILE = 'interrupt-channel-queue.json';
const ACK_FILE = 'interrupt-channel-acks.json';
const ARCHIVE_FILE = 'interrupt-channel-archive.jsonl';
const DELIVERY_FILE = 'interrupt-delivery.jsonl';

const INTERRUPT_STATES = {
  eligible: 'eligible',
  notified: 'notified',
  pending_ack: 'pending_ack',
  acked: 'acked',
  archived: 'archived',
  capped: 'capped',
  muted: 'muted',
  blocked: 'blocked',
  shift_denied: 'shift_denied',
  escalated: 'escalated',
};

const STATE_LABELS = {
  eligible: '待投递',
  notified: '已通知',
  pending_ack: '待确认',
  acked: '已确认',
  archived: '已归档',
  capped: '日上限外',
  muted: '已消音',
  blocked: '门禁阻断',
  shift_denied: '班次拒投',
  escalated: '超时催办',
};

function getIntelDir() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const dir = path.join(dataDir, 'intel-center');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(name, fallback) {
  const dir = getIntelDir();
  if (!dir) return fallback;
  const fp = path.join(dir, name);
  if (!fs.existsSync(fp)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  const dir = getIntelDir();
  if (!dir) return false;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), 'utf8');
  return true;
}

function appendJsonl(name, record) {
  const dir = getIntelDir();
  if (!dir) return false;
  const fp = path.join(dir, name);
  fs.appendFileSync(fp, `${JSON.stringify({ ...record, recordedAt: new Date().toISOString() })}\n`, 'utf8');
  return true;
}

function appendArchive(record) {
  return appendJsonl(ARCHIVE_FILE, { ...record, archivedAt: new Date().toISOString() });
}

function countArchivedToday(today) {
  const dir = getIntelDir();
  if (!dir) return 0;
  const fp = path.join(dir, ARCHIVE_FILE);
  if (!fs.existsSync(fp)) return 0;
  try {
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    let n = 0;
    for (const line of lines.slice(-200)) {
      try {
        const r = JSON.parse(line);
        if (String(r.asOf || r.ackedAt || '').slice(0, 10) === today) n += 1;
      } catch {
        // skip
      }
    }
    return n;
  } catch {
    return 0;
  }
}

function interruptKey(item) {
  return `${item.instrumentId || item.id}::${item.claimId || ''}::${item.reasonKey || item.tier || 'interrupt'}`;
}

function hoursSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return +((Date.now() - t) / 3600000).toFixed(2);
}

/**
 * 指挥官甲板：待确认按催办优先；下一步动作可审计
 */
function buildCommandDeck(channel) {
  const queue = channel?.queue || [];
  const pending = [...queue].sort((a, b) => {
    const rank = { escalated: 3, pending_ack: 2, notified: 1, eligible: 0 };
    const d = (rank[b.state] || 0) - (rank[a.state] || 0);
    if (d) return d;
    return (b.pendingHours || 0) - (a.pendingHours || 0);
  });
  const next = pending[0] || null;
  const escalatedCount = pending.filter((i) => i.state === INTERRUPT_STATES.escalated).length;
  const shiftDeniedCount = channel?.shiftDeniedCount || 0;
  const active = pending.length > 0 || shiftDeniedCount > 0;

  return {
    version: CHANNEL_VERSION,
    active,
    pendingCount: pending.length,
    escalatedCount,
    shiftDeniedCount,
    notifiedToday: channel?.notifiedToday ?? null,
    maxDaily: channel?.maxDaily ?? DAILY_INTERRUPT_CAP,
    next: next
      ? {
          key: next.key,
          instrumentId: next.instrumentId,
          instrumentName: next.instrumentName,
          headline: next.headline,
          state: next.state,
          stateLabel: next.stateLabel || STATE_LABELS[next.state] || next.state,
          pendingHoursDisplay: next.pendingHoursDisplay || '暂无',
          channels: next.channels || channel?.deliveryChannels || ['hub', 'file'],
          surpriseNDisplay: next.surpriseNDisplay || '暂无',
        }
      : null,
    actions: [
      { id: 'ack', label: '确认已阅', requiresKey: true },
      { id: 'mute_4h', label: '消音4小时', requiresKey: true },
      { id: 'open_memo', label: '打开备忘录', requiresInstrument: true },
    ],
    display: !channel?.shiftAllowsInterrupt
      ? `指挥台 · 班次拒投 · 候选 ${shiftDeniedCount}`
      : active
        ? `指挥台 · 待确认 ${pending.length} · 催办 ${escalatedCount}${
            next ? ` · 下一单 ${next.instrumentName || next.instrumentId}` : ''
          }`
        : '指挥台 · 暂无待办',
    note: '确认/消音写审计；OS 仅在 Electron Notification 成功后记账，禁止假装推送',
    dataSource: 'intel-interrupt-channel',
    method: 'commander-deck',
  };
}

/**
 * OS 通知真实派发后回写通道（禁止未派发就标 os）
 */
function markOsDelivered(keys, { asOf } = {}) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  if (!list.length) {
    return { ok: false, marked: 0, reason: 'no_keys' };
  }
  const today = asOf || new Date().toISOString().slice(0, 10);
  const queue = readJson(QUEUE_FILE, {
    items: [],
    notifiedKeys: [],
    dailyCount: 0,
    dailyDate: today,
  });
  const keySet = new Set(list);
  let marked = 0;
  for (const it of queue.items || []) {
    const key = it.key || interruptKey(it);
    if (!keySet.has(key)) continue;
    it.channels = [...new Set([...(it.channels || ['hub', 'file']), 'os'])];
    it.osDeliveredAt = new Date().toISOString();
    marked += 1;
    appendJsonl(DELIVERY_FILE, {
      type: 'interrupt_os_delivery',
      key,
      instrumentId: it.instrumentId,
      title: `情报打断 · ${it.instrumentName || it.instrumentId}`,
      body: (it.headline || '').slice(0, 120),
      asOf: today,
      channels: ['os'],
      channelNote: 'Electron Notification 已派发',
      version: CHANNEL_VERSION,
      dataSource: 'intel-interrupt-channel',
    });
  }
  if (marked) writeJson(QUEUE_FILE, queue);
  return {
    ok: true,
    marked,
    channels: marked ? ['os'] : [],
    note: marked ? '已记账 OS 投递' : '队列无匹配 key · 未记账',
  };
}

/**
 * 消音（非确认）：移出待办并禁再投 muteHours，写 mute 审计
 */
function muteInterrupt(key, { muteHours = 4 } = {}) {
  if (!key) return { ok: false, error: 'missing_key' };
  const hours = Math.max(1, Math.min(72, Number(muteHours) || 4));
  const queue = readJson(QUEUE_FILE, { items: [], notifiedKeys: [], dailyCount: 0, dailyDate: null });
  const acks = readJson(ACK_FILE, { acked: {}, mutedUntil: {} });
  const today = new Date().toISOString().slice(0, 10);
  const item = (queue.items || []).find((i) => (i.key || interruptKey(i)) === key);
  if (!item) {
    return { ok: false, error: 'not_in_queue', remaining: (queue.items || []).length };
  }
  const mutedUntil = new Date(Date.now() + hours * 3600000).toISOString();
  if (item.instrumentId) {
    acks.mutedUntil[item.instrumentId] = mutedUntil;
  }
  queue.items = (queue.items || []).filter((i) => (i.key || interruptKey(i)) !== key);
  writeJson(ACK_FILE, acks);
  writeJson(QUEUE_FILE, queue);
  appendArchive({
    type: 'interrupt_mute',
    key,
    state: INTERRUPT_STATES.muted,
    asOf: today,
    muteHours: hours,
    mutedUntil,
    instrumentId: item.instrumentId,
    instrumentName: item.instrumentName,
    claimId: item.claimId,
    headline: item.headline,
    version: CHANNEL_VERSION,
  });
  return {
    ok: true,
    key,
    mutedUntil,
    muteHours: hours,
    remaining: queue.items.length,
    state: INTERRUPT_STATES.muted,
  };
}

/**
 * 写入投递回执（真实文件通道；无 OS 通知时标 channels）
 */
function recordDelivery(notification, { asOf, shiftId, channels = ['hub', 'file'] } = {}) {
  return appendJsonl(DELIVERY_FILE, {
    type: 'interrupt_delivery',
    key: notification.key,
    instrumentId: notification.instrumentId,
    title: notification.title,
    body: notification.body,
    asOf: asOf || new Date().toISOString().slice(0, 10),
    shiftId: shiftId || null,
    channels,
    channelNote: channels.includes('os')
      ? '含系统通知'
      : '仅 Hub+文件回执 · 无 OS push',
    version: CHANNEL_VERSION,
    dataSource: 'intel-interrupt-channel',
  });
}

function loadRecentDeliveries(limit = 20) {
  const dir = getIntelDir();
  if (!dir) return [];
  const fp = path.join(dir, DELIVERY_FILE);
  if (!fs.existsSync(fp)) return [];
  try {
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip
      }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

/**
 * @param {object[]} packInterrupts
 * @param {{ asOf?: string, shiftId?: string, shift?: object, maxDaily?: number, escalateHours?: number }} [opts]
 */
function syncInterruptChannel(packInterrupts, opts = {}) {
  const {
    asOf,
    shiftId,
    shift = null,
    maxDaily: maxDailyOpt,
    escalateHours = 4,
  } = opts;

  const shiftAllows = shift ? shift.allowInterrupt !== false : true;
  const maxDaily = !shiftAllows ? 0 : maxDailyOpt ?? DAILY_INTERRUPT_CAP;

  const queue = readJson(QUEUE_FILE, {
    version: CHANNEL_VERSION,
    asOf: null,
    items: [],
    notifiedKeys: [],
    dailyCount: 0,
    dailyDate: null,
    cappedKeys: [],
    mutedSkipped: 0,
    shiftDeniedKeys: [],
  });
  const acks = readJson(ACK_FILE, { acked: {}, mutedUntil: {} });
  const today = asOf || new Date().toISOString().slice(0, 10);

  if (queue.dailyDate !== today) {
    queue.dailyDate = today;
    queue.dailyCount = 0;
    queue.notifiedKeys = [];
    queue.cappedKeys = [];
    queue.mutedSkipped = 0;
    queue.shiftDeniedKeys = [];
  }

  const incoming = (packInterrupts || []).map((i) => {
    const surpriseN = i.surpriseN ?? null;
    const nGate = i.nGate ?? INTERRUPT_SURPRISE_N_GATE;
    const nGateMet = surpriseN != null && surpriseN >= nGate;
    const surpriseNDisplay =
      i.surpriseNDisplay && i.surpriseNDisplay !== '暂无'
        ? i.surpriseNDisplay
        : surpriseN != null
          ? String(surpriseN)
          : '暂无';
    const nGateDisplay =
      surpriseN != null
        ? nGateMet
          ? `n=${surpriseN}≥${nGate}`
          : `n=${surpriseN}<${nGate}`
        : `n=暂无·门槛≥${nGate}`;
    return {
      instrumentId: i.id || i.instrumentId,
      instrumentName: i.name || i.instrumentName,
      claimId: i.claimId || null,
      headline: i.headline || i.summary || '',
      redTeam: i.redTeam || null,
      score: i.score ?? null,
      scoreDisplay: i.scoreDisplay || (i.score != null ? String(i.score) : '暂无'),
      surpriseN,
      surpriseNDisplay,
      nGate,
      nGateMet,
      nGateDisplay,
      interruptReason: i.interruptReason || null,
      reasons: i.reasons || [],
      beliefLevel: i.beliefLevel || null,
      claimStatus: i.claimStatus || null,
      gatePass: i.gatePass ?? null,
      lifecycle: i.lifecycle || INTERRUPT_STATES.eligible,
      reasonKey: i.falsified ? 'falsified' : 'interrupt',
      tier: 'interrupt',
      shiftId: shiftId || shift?.id || null,
      asOf: today,
      createdAt: new Date().toISOString(),
    };
  });

  const existingKeys = new Set((queue.items || []).map((it) => it.key || interruptKey(it)));
  const fresh = [];
  const muted = [];
  const alreadyAcked = [];
  const shiftDenied = [];

  for (const item of incoming) {
    const key = interruptKey(item);
    if (acks.mutedUntil?.[item.instrumentId] && Date.parse(acks.mutedUntil[item.instrumentId]) > Date.now()) {
      muted.push({ ...item, key, state: INTERRUPT_STATES.muted });
      queue.mutedSkipped = (queue.mutedSkipped || 0) + 1;
      continue;
    }
    if (acks.acked?.[key] && acks.acked[key] === today) {
      alreadyAcked.push({ ...item, key, state: INTERRUPT_STATES.acked });
      continue;
    }
    if (!shiftAllows) {
      shiftDenied.push({
        ...item,
        key,
        state: INTERRUPT_STATES.shift_denied,
        denyReason: `班次 ${shift?.label || shiftId || '当前'} 禁止 Interrupt`,
      });
      queue.shiftDeniedKeys = [...new Set([...(queue.shiftDeniedKeys || []), key])];
      continue;
    }
    if (!existingKeys.has(key)) {
      fresh.push({ ...item, key, state: INTERRUPT_STATES.eligible });
      existingKeys.add(key);
    }
  }

  const room = Math.max(0, maxDaily - (queue.dailyCount || 0));
  const toNotify = fresh.slice(0, room);
  const capped = fresh.slice(room).map((it) => ({ ...it, state: INTERRUPT_STATES.capped }));
  queue.cappedKeys = [...new Set([...(queue.cappedKeys || []), ...capped.map((c) => c.key)])];

  const notifications = [];
  for (const item of toNotify) {
    if (queue.notifiedKeys.includes(item.key)) {
      item.state = INTERRUPT_STATES.pending_ack;
      continue;
    }
    item.state = INTERRUPT_STATES.pending_ack;
    item.notifiedAt = new Date().toISOString();
    item.channels = ['hub', 'file'];
    const nBit = item.nGateDisplay || item.surpriseNDisplay || 'n=暂无';
    const note = {
      title: `情报打断 · ${item.instrumentName || item.instrumentId}`,
      body: `${(item.headline || '命题需改口/证伪').slice(0, 90)} · ${nBit}`.slice(0, 140),
      instrumentId: item.instrumentId,
      key: item.key,
      state: INTERRUPT_STATES.notified,
      channels: item.channels,
      surpriseNDisplay: item.surpriseNDisplay || '暂无',
      nGateDisplay: item.nGateDisplay || 'n=暂无',
    };
    notifications.push(note);
    recordDelivery(note, { asOf: today, shiftId: shiftId || shift?.id, channels: item.channels });
    queue.notifiedKeys.push(item.key);
    queue.dailyCount = (queue.dailyCount || 0) + 1;
  }

  const retained = (queue.items || [])
    .filter((it) => !acks.acked?.[it.key || interruptKey(it)])
    .map((it) => {
      const key = it.key || interruptKey(it);
      const ageH = hoursSince(it.notifiedAt || it.createdAt);
      let state = it.state || INTERRUPT_STATES.pending_ack;
      if (state === INTERRUPT_STATES.pending_ack && ageH != null && ageH >= escalateHours) {
        state = INTERRUPT_STATES.escalated;
      }
      return {
        ...it,
        state,
        key,
        pendingHours: ageH,
        pendingHoursDisplay: ageH != null ? String(ageH) : '暂无',
      };
    });

  queue.items = [...toNotify, ...retained]
    .filter((it, idx, arr) => arr.findIndex((x) => (x.key || interruptKey(x)) === (it.key || interruptKey(it))) === idx)
    .slice(0, 20)
    .map((it) => {
      const ageH = hoursSince(it.notifiedAt || it.createdAt);
      let state = it.state || INTERRUPT_STATES.pending_ack;
      if (
        (state === INTERRUPT_STATES.pending_ack || state === INTERRUPT_STATES.escalated) &&
        ageH != null &&
        ageH >= escalateHours
      ) {
        state = INTERRUPT_STATES.escalated;
      }
      return {
        ...it,
        state,
        pendingHours: ageH,
        pendingHoursDisplay: ageH != null ? String(ageH) : '暂无',
        stateLabel: STATE_LABELS[state] || state,
      };
    });
  queue.asOf = today;
  queue.version = CHANNEL_VERSION;
  queue.updatedAt = new Date().toISOString();
  queue.shiftId = shiftId || shift?.id || null;
  queue.shiftAllowsInterrupt = shiftAllows;

  writeJson(QUEUE_FILE, queue);

  const archivedToday = countArchivedToday(today);
  const escalatedCount = queue.items.filter((i) => i.state === INTERRUPT_STATES.escalated).length;
  const deliveries = loadRecentDeliveries(8);

  const channelBase = {
    version: CHANNEL_VERSION,
    asOf: today,
    updatedAt: queue.updatedAt,
    shiftId: queue.shiftId,
    shiftAllowsInterrupt: shiftAllows,
    shiftDenyReason: shiftAllows ? null : `班次 ${shift?.label || '当前'} 禁止 Interrupt`,
    queue: queue.items,
    pendingCount: queue.items.length,
    notifiedToday: queue.dailyCount,
    maxDaily,
    cappedCount: capped.length,
    mutedCount: muted.length,
    shiftDeniedCount: shiftDenied.length,
    shiftDenied: shiftDenied.slice(0, 8),
    escalatedCount,
    archivedToday,
    freshNotifications: notifications,
    recentDeliveries: deliveries,
    deliveryChannels: ['hub', 'file'],
    deliveryNote:
      '默认 Hub+文件回执；OS 仅在 Notification 成功后由 markOsDelivered 记账，禁止假装已推送',
    statesSummary: {
      pending_ack: queue.items.filter((i) => i.state === INTERRUPT_STATES.pending_ack).length,
      escalated: escalatedCount,
      capped: capped.length,
      muted: muted.length,
      shift_denied: shiftDenied.length,
      acked_today: alreadyAcked.length,
      archived_today: archivedToday,
      delivered_today: queue.dailyCount,
    },
    display: !shiftAllows
      ? `打断通道 班次拒投 · ${shift?.label || '当前班次'} 禁止 Interrupt · 候选 ${shiftDenied.length}`
      : `打断通道 待确认 ${queue.items.length} · 今日投递 ${queue.dailyCount}/${maxDaily} · 催办 ${escalatedCount} · 归档 ${archivedToday}${
          capped.length ? ` · 上限外 ${capped.length}` : ''
        }${muted.length ? ` · 消音 ${muted.length}` : ''}`,
    contract: 'eligible→notified→pending_ack→acked/archived · mute · shift_denied/capped · os-on-success',
    dataSource: 'intel-interrupt-channel',
    method: 'lifecycle-queue+delivery-receipt+command-deck',
  };
  channelBase.commandDeck = buildCommandDeck(channelBase);
  return channelBase;
}

function ackInterrupt(key, { muteHours = 0 } = {}) {
  const queue = readJson(QUEUE_FILE, { items: [], notifiedKeys: [], dailyCount: 0, dailyDate: null });
  const acks = readJson(ACK_FILE, { acked: {}, mutedUntil: {} });
  const today = new Date().toISOString().slice(0, 10);
  acks.acked[key] = today;
  const item = (queue.items || []).find((i) => (i.key || interruptKey(i)) === key);
  if (muteHours > 0 && item?.instrumentId) {
    acks.mutedUntil[item.instrumentId] = new Date(Date.now() + muteHours * 3600000).toISOString();
  }
  queue.items = (queue.items || []).filter((i) => (i.key || interruptKey(i)) !== key);
  writeJson(ACK_FILE, acks);
  writeJson(QUEUE_FILE, queue);

  let archived = false;
  if (item) {
    archived = appendArchive({
      type: 'interrupt_ack',
      key,
      state: INTERRUPT_STATES.archived,
      asOf: today,
      ackedAt: today,
      instrumentId: item.instrumentId,
      instrumentName: item.instrumentName,
      claimId: item.claimId,
      headline: item.headline,
      version: CHANNEL_VERSION,
    });
  }

  return {
    ok: true,
    key,
    remaining: queue.items.length,
    archived,
    state: INTERRUPT_STATES.archived,
    archivedToday: countArchivedToday(today),
  };
}

function getInterruptChannelState() {
  const queue = readJson(QUEUE_FILE, { items: [], dailyCount: 0, dailyDate: null, version: CHANNEL_VERSION });
  const today = queue.dailyDate || new Date().toISOString().slice(0, 10);
  const archivedToday = countArchivedToday(today);
  const deliveries = loadRecentDeliveries(5);
  const base = {
    version: CHANNEL_VERSION,
    ...queue,
    pendingCount: (queue.items || []).length,
    archivedToday,
    recentDeliveries: deliveries,
    deliveryChannels: ['hub', 'file'],
    display: `打断通道 待确认 ${(queue.items || []).length} · 今日已投递 ${queue.dailyCount || 0} · 已归档 ${archivedToday}`,
    contract: 'eligible→notified→pending_ack→acked/archived · mute · os-on-success',
    dataSource: 'intel-interrupt-channel',
  };
  base.commandDeck = buildCommandDeck(base);
  return base;
}

module.exports = {
  CHANNEL_VERSION,
  INTERRUPT_STATES,
  STATE_LABELS,
  DAILY_INTERRUPT_CAP,
  INTERRUPT_SURPRISE_N_GATE,
  syncInterruptChannel,
  ackInterrupt,
  muteInterrupt,
  markOsDelivered,
  buildCommandDeck,
  getInterruptChannelState,
  interruptKey,
  recordDelivery,
  loadRecentDeliveries,
};
