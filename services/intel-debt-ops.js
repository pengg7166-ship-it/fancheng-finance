/**
 * 情报中心 · 问题债务运维闭环（构想 §61 / §68）
 * mustPay 不只写「heal/sync」文案：可执行同步 → 复核 → 归档。
 * 禁止假装还清：合证/基差等需重建或人工的，标 partial/manual，不造假 cleared。
 */
const fs = require('fs');
const path = require('path');
const { getIntelDir, appendJsonl, readJsonl } = require('./intel-memory');
const { scanInstrumentDebt, DEBT_TYPES } = require('./intel-debt-board');
const dailyClose = require('./daily-close-sync');

const DEBT_OPS_VERSION = 'v2.89.18-debt-ops-meta';
const OPS_ARCHIVE = 'debt-ops-archive.jsonl';
const OPS_STATE = 'debt-ops-state.json';

/** 债务类型 → 可执行动作 */
const OPS_BY_TYPE = {
  stale_data: {
    action: 'sync_instrument_close',
    label: '同步收盘/日K',
    runnable: true,
    verify: 'staleness',
  },
  joint_gap: {
    action: 'sync_instrument_close',
    label: '同步日K（合证仍可能需仓单/OI+重算）',
    runnable: true,
    verify: 'partial_rebuild',
  },
  unknown_critical: {
    action: 'sync_instrument_close',
    label: '同步日K以缓解滞后类缺口',
    runnable: true,
    verify: 'partial_rebuild',
  },
  basis_gap: {
    action: 'manual',
    label: '需现货-期货价差源',
    runnable: false,
    verify: 'manual',
  },
  n_missing: {
    action: 'manual',
    label: '需 stateKey 校准扩样',
    runnable: false,
    verify: 'manual',
  },
  gate_blocked: {
    action: 'manual',
    label: '补证据/降档（非 sync）',
    runnable: false,
    verify: 'manual',
  },
  repeat_falsify: {
    action: 'manual',
    label: '博物馆人工复核',
    runnable: false,
    verify: 'manual',
  },
};

function daysBehind(iso) {
  if (!iso) return null;
  const d = (Date.now() - Date.parse(String(iso).slice(0, 10))) / 86400000;
  return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : null;
}

function nextDueDate(asOf) {
  const base = String(asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dt = new Date(`${base}T12:00:00+08:00`);
  if (Number.isNaN(dt.getTime())) return base;
  // 本周五（或已过则下周五）
  const day = dt.getDay(); // 0 Sun
  const toFri = (5 - day + 7) % 7;
  dt.setDate(dt.getDate() + (toFri === 0 ? 0 : toFri));
  return dt.toISOString().slice(0, 10);
}

function planForDebt(debt) {
  const spec = OPS_BY_TYPE[debt.type] || {
    action: 'manual',
    label: '待分类',
    runnable: false,
    verify: 'manual',
  };
  return {
    ...spec,
    type: debt.type,
    typeLabel: DEBT_TYPES[debt.type]?.label || debt.label || debt.type,
    instrumentId: debt.instrumentId,
    instrumentName: debt.instrumentName || debt.instrumentId,
  };
}

function enrichMustPayItem(debt, asOf) {
  const plan = planForDebt(debt);
  return {
    ...debt,
    label: debt.label || plan.typeLabel,
    opsAction: plan.action,
    opsLabel: plan.label,
    opsRunnable: plan.runnable,
    owner: plan.runnable ? 'intel-debt-ops' : 'analyst',
    dueBy: nextDueDate(asOf),
    nDisplay: debt.nDisplay || (debt.daysOpen != null ? String(debt.daysOpen) : null),
    source: debt.source || null,
    metaSpotId: debt.metaSpotId || null,
  };
}

function buildDebtOpsPreview(debtBoard, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const mustPay = (debtBoard?.weeklyMustPay || debtBoard?.weeklyPlan?.mustPay || []).map((d) =>
    enrichMustPayItem(d, asOf)
  );
  const runnable = mustPay.filter((d) => d.opsRunnable);
  const manual = mustPay.filter((d) => !d.opsRunnable);
  return {
    version: DEBT_OPS_VERSION,
    asOf,
    pendingRunnable: runnable.length,
    pendingManual: manual.length,
    mustPay,
    runnable: runnable.slice(0, 8),
    manual: manual.slice(0, 8),
    maxAuto: opts.maxItems ?? 3,
    display:
      mustPay.length === 0
        ? '债务运维·暂无 mustPay'
        : `债务运维 可执行 ${runnable.length} · 须人工 ${manual.length} · 上限 ${opts.maxItems ?? 3}`,
    note: '点击执行才 sync；合证缺口同步后仍可能须 outlook 重算',
    dataSource: 'intel-debt-ops',
    method: 'mustPay→ops-plan',
  };
}

function verifyAfterOp(debt, exec) {
  const plan = planForDebt(debt);
  if (plan.verify === 'manual') {
    return {
      cleared: false,
      status: 'manual',
      note: '须人工，不自动计还清',
    };
  }
  if (plan.verify === 'partial_rebuild') {
    return {
      cleared: false,
      status: 'partial',
      note: exec?.ok
        ? '已同步日K · 合证/Unknown 须重算 outlook 后再验'
        : '同步未完成',
      lastDate: exec?.sync?.endDate || exec?.sync?.lastDate || null,
    };
  }
  // staleness
  try {
    if (!dailyClose.initDiskCache()) {
      return { cleared: false, status: 'unverifiable', note: '无数据目录' };
    }
    const latest = dailyClose.getLatestBarClose(String(debt.instrumentId).toLowerCase());
    const lag = daysBehind(latest?.tradeDate);
    const cleared = lag != null && lag <= 1;
    return {
      cleared,
      status: cleared ? 'cleared' : 'open',
      lag,
      lastDate: latest?.tradeDate || null,
      note: cleared
        ? `收盘已新至 ${latest.tradeDate}`
        : lag != null
          ? `仍滞后 ${lag} 日`
          : '收盘日暂无',
    };
  } catch (err) {
    return { cleared: false, status: 'error', note: err.message };
  }
}

async function executeDebtOp(debt, opts = {}) {
  const plan = planForDebt(debt);
  if (!plan.runnable) {
    return {
      ok: false,
      skipped: true,
      reason: 'manual_only',
      plan,
      action: plan.action,
    };
  }
  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      skipped: true,
      reason: 'dryRun',
      plan,
      action: plan.action,
    };
  }
  if (plan.action === 'sync_instrument_close') {
    if (!dailyClose.initDiskCache()) {
      return { ok: false, error: 'no_data_dir', plan, action: plan.action };
    }
    try {
      const sync = await dailyClose.syncInstrumentDailyClose(debt.instrumentId, {
        force: opts.force !== false,
      });
      const ok = sync.status === 'ok' || sync.status === 'skipped';
      return { ok, sync, plan, action: plan.action };
    } catch (err) {
      return { ok: false, error: err.message, plan, action: plan.action };
    }
  }
  return { ok: false, error: 'unknown_action', plan, action: plan.action };
}

function loadOpsState() {
  const dir = getIntelDir();
  if (!dir) return null;
  const fp = path.join(dir, OPS_STATE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function saveOpsState(state) {
  const dir = getIntelDir();
  if (!dir) return;
  fs.writeFileSync(path.join(dir, OPS_STATE), JSON.stringify(state, null, 2), 'utf8');
}

/**
 * 执行 mustPay 运维闭环（默认最多 3 项，可 dryRun）
 * 可选 filterInstrumentId / filterDebtType / preferMeta 限定元智能还债桥
 */
async function runDebtOpsLoop({
  debtBoard,
  instruments = [],
  maxItems = 3,
  dryRun = false,
  asOf,
  persist = true,
  filterInstrumentId = null,
  filterDebtType = null,
  preferMeta = false,
} = {}) {
  const preview = buildDebtOpsPreview(debtBoard, { asOf, maxItems: 12 });
  let queue = preview.runnable.slice();
  if (preferMeta) {
    const metaFirst = queue.filter((d) => d.source === 'meta' || d.metaSpotId);
    if (metaFirst.length) queue = [...metaFirst, ...queue.filter((d) => !(d.source === 'meta' || d.metaSpotId))];
  }
  if (filterInstrumentId) {
    const id = String(filterInstrumentId).toLowerCase();
    queue = queue.filter((d) => String(d.instrumentId || '').toLowerCase() === id);
  }
  if (filterDebtType) {
    queue = queue.filter((d) => d.type === filterDebtType);
  }
  queue = queue.slice(0, Math.max(1, Math.min(8, maxItems)));
  const results = [];

  for (const debt of queue) {
    const exec = await executeDebtOp(debt, { dryRun, force: true });
    const verify = dryRun
      ? { cleared: false, status: 'dryRun', note: '演练未写盘' }
      : verifyAfterOp(debt, exec);
    const row = {
      type: 'debt_ops',
      instrumentId: debt.instrumentId,
      instrumentName: debt.instrumentName,
      debtType: debt.type,
      opsAction: debt.opsAction,
      metaSpotId: debt.metaSpotId || null,
      source: debt.source || 'mustPay',
      ok: Boolean(exec.ok),
      dryRun: Boolean(dryRun),
      verify,
      execSummary: exec.sync
        ? `${exec.sync.status}:${exec.sync.endDate || exec.sync.lastDate || '—'}`
        : exec.reason || exec.error || null,
      at: new Date().toISOString(),
      version: DEBT_OPS_VERSION,
    };
    results.push(row);
    if (persist && !dryRun) {
      try {
        appendJsonl(OPS_ARCHIVE, row);
      } catch {
        // ignore
      }
    }
  }

  const cleared = results.filter((r) => r.verify?.cleared).length;
  const partial = results.filter((r) => r.verify?.status === 'partial').length;
  const failed = results.filter((r) => !r.ok && !r.dryRun).length;

  const report = {
    version: DEBT_OPS_VERSION,
    asOf: asOf || preview.asOf,
    dryRun: Boolean(dryRun),
    attempted: results.length,
    cleared,
    partial,
    failed,
    manualRemaining: preview.pendingManual,
    filterInstrumentId: filterInstrumentId || null,
    filterDebtType: filterDebtType || null,
    results,
    recent: readJsonl(OPS_ARCHIVE, 20).reverse().slice(0, 8),
    display: dryRun
      ? `债务运维演练 ${results.length} 项`
      : results.length === 0
        ? '债务运维 · 暂无匹配可执行项'
        : `债务运维已执行 ${results.length} · 还清 ${cleared} · 部分 ${partial} · 失败 ${failed}`,
    note: 'cleared 仅对可复核项（如滞后）；合证类为 partial，禁止假还清',
    dataSource: 'intel-debt-ops',
    method: 'mustPay→sync→verify',
  };

  if (persist && !dryRun) {
    saveOpsState({
      version: DEBT_OPS_VERSION,
      lastRunAt: report.asOf,
      lastReport: {
        attempted: report.attempted,
        cleared: report.cleared,
        partial: report.partial,
        failed: report.failed,
        display: report.display,
      },
      updatedAt: new Date().toISOString(),
    });
  }

  return report;
}

/**
 * 把运维计划挂到债务板（不执行）
 */
function attachDebtOpsPlan(debtBoard, opts = {}) {
  if (!debtBoard) return debtBoard;
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const preview = buildDebtOpsPreview(debtBoard, { asOf, maxItems: opts.maxItems ?? 3 });
  const last = loadOpsState();
  const weeklyMustPay = (debtBoard.weeklyMustPay || []).map((d) => enrichMustPayItem(d, asOf));
  const weeklyPlan = {
    ...(debtBoard.weeklyPlan || {}),
    mustPay: weeklyMustPay,
    shouldPay: (debtBoard.weeklyPlan?.shouldPay || []).map((d) => enrichMustPayItem(d, asOf)),
    dueBy: nextDueDate(asOf),
    owner: 'intel-debt-ops+analyst',
    note: `${debtBoard.weeklyPlan?.note || '每周优先还阻断发布项'} · 可执行 ${preview.pendingRunnable} · 人工 ${preview.pendingManual} · 到期 ${nextDueDate(asOf)}`,
  };

  return {
    ...debtBoard,
    version: `${debtBoard.version || 'debt'}+ops`,
    weeklyMustPay,
    weeklyPlan,
    opsPlan: preview,
    opsLast: last?.lastReport
      ? { ...last.lastReport, lastRunAt: last.lastRunAt, updatedAt: last.updatedAt }
      : null,
    display: `${debtBoard.display || '问题债务'}${
      preview.pendingRunnable ? ` · 可还 ${preview.pendingRunnable}` : ''
    }${last?.lastReport?.display ? ` · 上次 ${last.lastReport.cleared ?? 0}清` : ''}`,
    method: `${debtBoard.method || 'debt'}+ops-plan`,
  };
}

/**
 * 用最新 instruments 复核某笔债务是否仍在
 */
function reverifyAgainstInstruments(debt, instruments) {
  const inst = (instruments || []).find(
    (i) => String(i.id).toLowerCase() === String(debt.instrumentId || '').toLowerCase()
  );
  if (!inst) {
    return { cleared: false, status: 'missing_instrument', note: '品种不在包内' };
  }
  const still = scanInstrumentDebt(inst).filter((d) => d.type === debt.type);
  return {
    cleared: still.length === 0,
    status: still.length === 0 ? 'cleared' : 'open',
    remaining: still.length,
    note: still.length === 0 ? '扫描已无此债' : `仍有 ${still.length} 条同型债务`,
  };
}

module.exports = {
  DEBT_OPS_VERSION,
  OPS_BY_TYPE,
  planForDebt,
  enrichMustPayItem,
  buildDebtOpsPreview,
  executeDebtOp,
  verifyAfterOp,
  runDebtOpsLoop,
  attachDebtOpsPlan,
  reverifyAgainstInstruments,
  loadOpsState,
  nextDueDate,
};
