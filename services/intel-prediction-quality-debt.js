/**
 * 预测质量债（P10 / Q1 还债）
 * 真实 walk-forward hit + 过程正确 vs 方向命中 + 欠样/校准缺口/还债动作；禁止「已提升」话术。
 */
const fs = require('fs');
const path = require('path');
const { parseHitDisplay } = require('./intel-kpi');

const QUALITY_DEBT_VERSION = 'v2.89.26-prediction-quality-debt';
const SAMPLE_DEBT_GATE = 8;

function getAuditsDir() {
  const drive = process.env.FANCHENG_DATA_DRIVE || 'F';
  return path.join(`${drive}:/FanchengFinance/data/audits`);
}

function compactInstRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id || row.instrumentId;
  if (!id) return null;
  const scored = row.scored ?? row.n ?? null;
  const hits = row.hits ?? null;
  let hitDisplay = row.hitDisplay || null;
  if (!hitDisplay && scored != null && hits != null && scored > 0) {
    hitDisplay = `${+((hits / scored) * 100).toFixed(1)}% (${hits}/${scored})`;
  }
  return {
    id,
    name: row.name || row.instrumentName || id,
    scored,
    hits,
    hitRate: row.hitRate ?? null,
    hitDisplay: hitDisplay || '暂无',
    status: row.status || (scored === 0 ? 'zero_scored' : null),
    bars: row.bars ?? null,
    missingActual: row.missingActual ?? null,
  };
}

function loadLatestAcceptWalkForward() {
  const fp = path.join(getAuditsDir(), 'outlook-stockflow-capital-accept-latest.json');
  if (!fs.existsSync(fp)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const wf = j.walkForward || null;
    if (!wf) return null;
    const asOf = String(j.asOf || '').slice(0, 10);
    const byInst = (wf.byInst || []).map(compactInstRow).filter(Boolean);
    return {
      asOf,
      days: wf.days ?? null,
      hitDisplay: wf.hitDisplay || '暂无',
      scored: wf.scored ?? null,
      hits: (() => {
        const p = parseHitDisplay(wf.hitDisplay);
        return p.hits;
      })(),
      hitRate: (() => {
        const p = parseHitDisplay(wf.hitDisplay);
        return p.rate != null ? +(p.rate * 100).toFixed(1) : null;
      })(),
      instrumentsScored: wf.instrumentsScored ?? null,
      instrumentsTried: wf.instrumentsTried ?? null,
      worst: (wf.worst || []).map(compactInstRow).filter(Boolean).slice(0, 12),
      best: (wf.best || []).map(compactInstRow).filter(Boolean).slice(0, 8),
      byInst,
      dataSource: 'outlook-stockflow-capital-accept-latest.json',
      method: 'accept-walk-forward-snapshot',
    };
  } catch {
    return null;
  }
}

function buildSampleDebt(walkForward, processLearning) {
  const undersampled = [];
  const zeroScored = [];
  const skipped = [];
  const seen = new Set();

  const pushUnder = (row) => {
    const id = row.id || row.instrumentId;
    if (!id || seen.has(`u:${id}`)) return;
    const scored = row.scored ?? row.n ?? null;
    if (scored == null || !(scored > 0 && scored < SAMPLE_DEBT_GATE)) return;
    seen.add(`u:${id}`);
    undersampled.push({
      id,
      name: row.name || row.instrumentName || id,
      scored,
      hitDisplay: row.hitDisplay || '暂无',
      threshold: SAMPLE_DEBT_GATE,
      remedy: `扩窗/全市场 WF 至样本≥${SAMPLE_DEBT_GATE} 才进 worst/best`,
    });
  };

  const pushZero = (row) => {
    const id = row.id || row.instrumentId;
    if (!id || seen.has(`z:${id}`)) return;
    const scored = row.scored ?? row.n ?? null;
    if (scored !== 0 && row.status !== 'skip_no_bars') return;
    seen.add(`z:${id}`);
    if (row.status === 'skip_no_bars') {
      skipped.push({
        id,
        name: row.name || id,
        scored: 0,
        bars: row.bars ?? null,
        remedy: 'K 线不足 80 根 · heal/sync 日 K',
        status: 'skip_no_bars',
      });
    } else {
      zeroScored.push({
        id,
        name: row.name || id,
        scored: 0,
        remedy: '缺 actual 或方向中性 · 不计分',
        status: 'zero_scored',
      });
    }
  };

  const pool = [
    ...(walkForward?.byInst || []),
    ...(walkForward?.worst || []),
    ...(walkForward?.best || []),
  ];
  for (const row of pool) {
    pushUnder(row);
    pushZero(row);
  }

  const archiveN = processLearning?.sampleN ?? processLearning?.directionScored ?? null;
  if (archiveN != null && archiveN < SAMPLE_DEBT_GATE) {
    undersampled.push({
      id: '_archive',
      name: '归档方向样本',
      scored: archiveN,
      threshold: SAMPLE_DEBT_GATE,
      remedy: '扩大归档可评分命题（orch evaluateArchivedClaims limit）',
      hitDisplay: processLearning?.directionHit || '暂无',
    });
  }

  undersampled.sort((a, b) => (a.scored ?? 0) - (b.scored ?? 0));
  return {
    undersampled: undersampled.slice(0, 12),
    zeroScored: zeroScored.slice(0, 8),
    skipped: skipped.slice(0, 8),
    gate: SAMPLE_DEBT_GATE,
    display:
      undersampled.length || zeroScored.length || skipped.length
        ? `欠样 ${undersampled.length} · 零分 ${zeroScored.length} · 跳过 ${skipped.length}`
        : '欠样 暂无（或快照未列 byInst）',
    method: 'sample-debt-gate',
    dataSource: 'accept-snapshot+process-learning',
  };
}

function loadCalibrationGaps() {
  try {
    const { loadStateKeyWeights, DEFAULT_MIN_N, DEFAULT_MIN_LIFT_PP } = require('./intel-statekey-weights');
    const table = loadStateKeyWeights();
    if (!table) {
      return {
        available: false,
        display: '校准缺口 暂无（缺 stateKey 权重表）',
        skippedFine: [],
        skippedCoarse: [],
        meta: null,
        method: 'statekey-weights-missing',
        dataSource: 'intel-statekey-weights.json',
      };
    }
    const mapSkip = (arr, kind) =>
      (arr || []).slice(0, 10).map((s) => ({
        key: s.key || s.stateKey || '—',
        n: s.n ?? null,
        hitDisplay: s.hitDisplay || s.best || '暂无',
        reason: s.reason || s.skipReason || '暂无',
        liftVsEqual: s.liftVsEqual ?? s.lift ?? null,
        kind,
      }));
    const skippedFine = mapSkip(table.skippedFine || table.skippedSample, 'fine');
    const skippedCoarse = mapSkip(table.skippedCoarse, 'coarse');
    const meta = {
      asOf: table.asOf ? String(table.asOf).slice(0, 10) : null,
      windowDays: table.windowDays ?? null,
      quick: table.quick === true,
      minN: table.minN ?? DEFAULT_MIN_N,
      minLiftPp: table.minLiftPp ?? DEFAULT_MIN_LIFT_PP,
      instruments: table.coverage?.instruments ?? null,
      fineCalibrated: table.coverage?.fineCalibrated ?? null,
      coarseCalibrated: table.coverage?.coarseCalibrated ?? null,
      globalHit: table.globalFallback?.hitDisplay || '暂无',
      globalN: table.globalFallback?.n ?? null,
    };
    const nSkip = skippedFine.length + skippedCoarse.length;
    const quickTag = meta.quick ? '·quick' : '·full';
    return {
      available: true,
      display:
        nSkip > 0
          ? `校准缺口 fine ${skippedFine.length} · coarse ${skippedCoarse.length} · 窗 ${meta.windowDays ?? '—'}d${quickTag} · 品种 ${meta.instruments ?? '—'}`
          : `校准缺口 暂无 · 窗 ${meta.windowDays ?? '—'}d${quickTag} · 全局 ${meta.globalHit}`,
      skippedFine,
      skippedCoarse,
      meta,
      method: 'statekey-skipped-buckets',
      dataSource: 'intel-statekey-weights.json',
    };
  } catch {
    return {
      available: false,
      display: '校准缺口 暂无',
      skippedFine: [],
      skippedCoarse: [],
      meta: null,
      method: 'statekey-weights-error',
      dataSource: 'intel-statekey-weights.json',
    };
  }
}

function buildRepaymentActions({ sampleDebt, calibrationGaps, walkForward, worst }) {
  const actions = [];
  const seen = new Set();
  const add = (a) => {
    const k = `${a.action}:${a.id || a.key || a.title}`;
    if (seen.has(k)) return;
    seen.add(k);
    actions.push(a);
  };

  for (const s of sampleDebt?.skipped || []) {
    add({
      priority: 1,
      id: s.id,
      action: 'heal-klines',
      title: `${s.name || s.id} 补日 K`,
      detail: s.remedy,
      hitDisplay: '暂无',
      scored: 0,
    });
  }
  for (const z of sampleDebt?.zeroScored || []) {
    add({
      priority: 2,
      id: z.id,
      action: 'hold-unscored',
      title: `${z.name || z.id} 保持不计分`,
      detail: z.remedy,
      hitDisplay: '暂无',
      scored: 0,
    });
  }
  for (const u of sampleDebt?.undersampled || []) {
    if (u.id === '_archive') {
      add({
        priority: 3,
        id: u.id,
        action: 'expand-archive-eval',
        title: '扩大归档评分样本',
        detail: u.remedy,
        hitDisplay: u.hitDisplay || '暂无',
        scored: u.scored,
      });
    } else {
      add({
        priority: 3,
        id: u.id,
        action: 'expand-wf-window',
        title: `${u.name || u.id} 扩 WF 样本`,
        detail: u.remedy,
        hitDisplay: u.hitDisplay || '暂无',
        scored: u.scored,
      });
    }
  }
  for (const w of (worst || walkForward?.worst || []).slice(0, 6)) {
    add({
      priority: 4,
      id: w.id,
      action: 'review-worst',
      title: `${w.name || w.id} 最差复盘`,
      detail: '对照合证/态度；不改权宣称命中提升',
      hitDisplay: w.hitDisplay || '暂无',
      scored: w.scored ?? null,
    });
  }
  for (const s of [...(calibrationGaps?.skippedFine || []), ...(calibrationGaps?.skippedCoarse || [])].slice(0, 6)) {
    const reason = String(s.reason || '');
    const action = /lift|提升|边际/i.test(reason) ? 'hold-heuristic' : 'recal-statekey';
    add({
      priority: 5,
      id: s.key,
      key: s.key,
      action,
      title: action === 'hold-heuristic' ? `桶 ${s.key} 维持启发式` : `桶 ${s.key} 重校准`,
      detail: `n=${s.n ?? '暂无'} · ${reason || '样本/lift 未过门'}`,
      hitDisplay: s.hitDisplay || '暂无',
      scored: s.n ?? null,
    });
  }
  if (calibrationGaps?.meta?.quick) {
    add({
      priority: 2,
      id: '_cal_full',
      action: 'recal-statekey-full',
      title: '全市场 stateKey 重校准',
      detail: `当前 quick·${calibrationGaps.meta.windowDays ?? '—'}d；建议 --days 90–120 --stride 1（无 --quick）`,
      hitDisplay: calibrationGaps.meta.globalHit || '暂无',
      scored: calibrationGaps.meta.globalN ?? null,
    });
  } else if (calibrationGaps?.meta && calibrationGaps.meta.quick === false) {
    add({
      priority: 6,
      id: '_cal_ok',
      action: 'hold-calibrated',
      title: 'stateKey 已全市场校准',
      detail: `窗 ${calibrationGaps.meta.windowDays ?? '—'}d · fine ${calibrationGaps.meta.fineCalibrated ?? '—'} · coarse ${calibrationGaps.meta.coarseCalibrated ?? '—'}`,
      hitDisplay: calibrationGaps.meta.globalHit || '暂无',
      scored: calibrationGaps.meta.globalN ?? null,
    });
  }
  if ((walkForward?.days || 0) > 0 && (walkForward.days || 0) < 80) {
    add({
      priority: 2,
      id: '_wf_expand',
      action: 'expand-accept-wf',
      title: '拉长 accept WF 窗口',
      detail: `当前 ${walkForward.days}d · 建议 80–120d；缺失 actual 仍不计分`,
      hitDisplay: walkForward.hitDisplay || '暂无',
      scored: walkForward.scored ?? null,
    });
  } else if ((walkForward?.days || 0) >= 80) {
    add({
      priority: 6,
      id: '_wf_ok',
      action: 'hold-wf-window',
      title: `WF 已扩至 ${walkForward.days}d`,
      detail: `scored=${walkForward.scored ?? '暂无'} · 品种 ${walkForward.instrumentsScored ?? '暂无'}；继续盯欠样`,
      hitDisplay: walkForward.hitDisplay || '暂无',
      scored: walkForward.scored ?? null,
    });
  }

  actions.sort((a, b) => (a.priority || 9) - (b.priority || 9));
  return {
    items: actions.slice(0, 14),
    display: actions.length ? `还债动作 ${Math.min(actions.length, 14)}` : '还债动作 暂无',
    method: 'quality-debt-repayment',
    dataSource: 'sample-debt+calibration-gaps+wf-worst',
    improvementClaim: false,
  };
}

/**
 * @param {object} pack
 */
function buildPredictionQualityDebtBoard(pack, opts = {}) {
  const asOf = opts.asOf || pack?.asOf || null;
  const wf =
    opts.walkForward !== undefined
      ? opts.walkForward
        ? {
            ...opts.walkForward,
            byInst: (opts.walkForward.byInst || []).map(compactInstRow).filter(Boolean),
            worst: (opts.walkForward.worst || []).map(compactInstRow).filter(Boolean),
            best: (opts.walkForward.best || []).map(compactInstRow).filter(Boolean),
          }
        : null
      : loadLatestAcceptWalkForward();
  const pl = pack?.processLearning || pack?.processScorecard?.outcome || {};
  const kpi = pack?.kpis || {};

  const directionHit =
    pl.directionHit ||
    kpi?.outcome?.directionHit ||
    kpi?.processCorrectness?.directionHit ||
    '暂无';
  const processCorrect =
    pl.processCorrect ||
    kpi?.outcome?.processCorrect ||
    kpi?.processCorrectness?.processCorrect ||
    '暂无';
  const dirWrongProcessRight =
    pl.dirWrongProcessRightDisplay || pl.dirWrongProcessRight || '暂无';

  const dirParsed = parseHitDisplay(directionHit);
  const procParsed = parseHitDisplay(processCorrect);
  const wfParsed = parseHitDisplay(wf?.hitDisplay || '暂无');

  const sampleDebt = buildSampleDebt(wf, {
    sampleN: pl.sampleN ?? dirParsed.total,
    directionScored: dirParsed.total,
    directionHit,
  });
  const calibrationGaps = opts.calibrationGaps || loadCalibrationGaps();
  const repayment = buildRepaymentActions({
    sampleDebt,
    calibrationGaps,
    walkForward: wf,
    worst: wf?.worst,
  });

  const available =
    Boolean(wf?.hitDisplay && wf.hitDisplay !== '暂无') || !dirParsed.deferred || !procParsed.deferred;

  const gapNote =
    !dirParsed.deferred && !procParsed.deferred
      ? `过程 ${procParsed.display} · 方向 ${dirParsed.display}`
      : wfParsed.deferred
        ? '过程/方向或 WF 样本暂无'
        : `WF ${wfParsed.display}`;

  return {
    version: QUALITY_DEBT_VERSION,
    asOf,
    available,
    honestyNote: '工程 PASS ≠ 预测变准',
    improvementClaim: false,
    walkForward: wf
      ? {
          hitDisplay: wf.hitDisplay || '暂无',
          scored: wf.scored ?? wfParsed.total,
          hits: wf.hits ?? wfParsed.hits,
          hitRate: wf.hitRate ?? (wfParsed.rate != null ? +(wfParsed.rate * 100).toFixed(1) : null),
          instrumentsScored: wf.instrumentsScored ?? null,
          instrumentsTried: wf.instrumentsTried ?? null,
          days: wf.days ?? null,
          asOf: wf.asOf || null,
          dataSource: wf.dataSource || 'accept-snapshot',
          method: wf.method || 'accept-walk-forward-snapshot',
        }
      : {
          hitDisplay: '暂无',
          scored: null,
          hits: null,
          hitRate: null,
          instrumentsScored: null,
          instrumentsTried: null,
          days: null,
          dataSource: 'accept-snapshot-missing',
          method: 'accept-walk-forward-snapshot',
        },
    archive: {
      directionHit: dirParsed.display,
      processCorrect: procParsed.display,
      dirWrongProcessRightDisplay: dirWrongProcessRight,
      sampleDisplay: dirParsed.total != null ? String(dirParsed.total) : '暂无',
      dataSource: 'intel-process-learning',
    },
    gap: {
      processVsDirection: gapNote,
      note: '过程正确优先；方向近随机不算失败隐瞒',
    },
    sampleDebt,
    calibrationGaps,
    repayment,
    worst: (wf?.worst || []).slice(0, 5),
    best: (wf?.best || []).slice(0, 5),
    visionClosing: {
      scope: '§20–80',
      nearlyMet: true,
      capabilityAligned: true,
      remainingPartial: [],
      next: ['Q1 扩样本/校准还债', 'Q2 可选进程级 LLM 沙箱'],
      note: '能力 MET ≠ hit 变准；质量债持续公开',
    },
    display: available
      ? `质量债 方向 ${wf?.hitDisplay || dirParsed.display} · 过程 ${procParsed.display} · ${sampleDebt.display} · ${repayment.display} · 工程PASS≠准`
      : '质量债 暂无（缺 accept 快照或归档样本）',
    note: '禁止宣称命中已提升；% 必须带 n',
    method: 'prediction-quality-debt',
    dataSource: 'intel-prediction-quality-debt',
  };
}

module.exports = {
  QUALITY_DEBT_VERSION,
  SAMPLE_DEBT_GATE,
  loadLatestAcceptWalkForward,
  loadCalibrationGaps,
  buildSampleDebt,
  buildRepaymentActions,
  buildPredictionQualityDebtBoard,
  compactInstRow,
};
