/**
 * 情报中心 · KPI 体系（过程正确 > 方向命中）
 * v2.89.17：面板一律带 n / 分母；Interrupt 惊喜门槛可见；禁止裸 %。
 */
const { loadFailureMuseum, loadRecentRevisions, readJsonl } = require('./intel-memory');
const { loadLatestDailyDiff } = require('./intel-daily-diff');

const KPI_VERSION = 'v2.89.17-kpi-n-polish';
const INTERRUPT_SURPRISE_N_GATE = 20;

function parseHitDisplay(display) {
  if (!display || display === '暂无' || display === '—') {
    return { display: '暂无', hits: null, total: null, rate: null, deferred: true };
  }
  const m = String(display).match(/([\d.]+)\s*%\s*\((\d+)\s*\/\s*(\d+)\)/);
  if (m) {
    const hits = Number(m[2]);
    const total = Number(m[3]);
    return {
      display: `${m[1]}% (${hits}/${total})`,
      hits,
      total,
      rate: total > 0 ? hits / total : null,
      deferred: total < 1,
    };
  }
  // 裸百分比无 n → 暂无
  if (/^\s*[\d.]+\s*%\s*$/.test(String(display))) {
    return { display: '暂无', hits: null, total: null, rate: null, deferred: true, note: '裸%无n·不计' };
  }
  return { display: String(display), hits: null, total: null, rate: null, deferred: true };
}

function ratioDisplay(num, den) {
  if (den == null || den < 1) return '暂无';
  return `${num}/${den}`;
}

function panel(id, label, num, den, extra = {}) {
  const value = ratioDisplay(num, den);
  return {
    id,
    label,
    value,
    n: den || null,
    nDisplay: den ? String(den) : '暂无',
    sampleDisplay: den ? `n=${den}` : 'n=暂无',
    ...extra,
  };
}

function computeKpis(instruments, pack) {
  const n = instruments?.length ?? 0;
  const activeClaims = instruments?.filter((i) => i.intelCenter?.primaryClaim?.status === 'active').length ?? 0;
  const withDissent = instruments?.filter((i) => (i.intelCenter?.primaryClaim?.evidenceAgainst?.length ?? 0) >= 1).length;
  const withTriggers = instruments?.filter((i) => (i.intelCenter?.primaryClaim?.triggers?.length ?? 0) >= 1).length;
  const withN = instruments?.filter((i) => i.intelCenter?.primaryClaim?.n != null).length;
  const gateTop5Pass = instruments?.filter((i) => i.intelCenter?.gates?.top5?.pass).length ?? 0;
  const mispriced = instruments?.filter((i) => i.intelCenter?.pricingState?.state === 'mispriced').length ?? 0;
  const interruptCand = instruments?.filter((i) => i.intelCenter?.pushTier?.tier === 'interrupt') || [];
  const interrupts = interruptCand.length;
  const surpriseNOk = instruments?.filter((i) => {
    const sn = i.intelCenter?.surprise?.n ?? i.intelCenter?.pushTier?.surpriseN;
    return sn != null && sn >= INTERRUPT_SURPRISE_N_GATE;
  }).length;
  const interruptNOk = interruptCand.filter((i) => {
    const sn = i.intelCenter?.surprise?.n ?? i.intelCenter?.pushTier?.surpriseN;
    return sn != null && sn >= INTERRUPT_SURPRISE_N_GATE;
  }).length;
  const interruptNMissing = interruptCand.filter((i) => {
    const sn = i.intelCenter?.surprise?.n ?? i.intelCenter?.pushTier?.surpriseN;
    return sn == null;
  }).length;

  const revisions = loadRecentRevisions(50);
  const failures = loadFailureMuseum(50);
  const archives = readJsonl('claims-archive.jsonl', 500);

  const revisionRate7d = revisions.filter((r) => {
    const d = r.recordedAt || r.falsifiedAt;
    if (!d) return false;
    return Date.now() - Date.parse(d) < 7 * 86400000;
  }).length;

  const diff = pack?.dailyDiff || loadLatestDailyDiff();
  const material = diff?.materialChanges;
  const quietDays = diff?.available === true && diff?.quietDay ? 1 : 0;

  const processReadyN = instruments?.filter((i) => i.intelCenter?.processReadiness?.processReady).length ?? 0;
  const card = pack?.processScorecard;

  const fullN = instruments?.filter((i) => i.intelCenter?.attention?.computeMode === 'full').length ?? 0;
  const liteN = instruments?.filter((i) => i.intelCenter?.attention?.computeMode === 'lite').length ?? 0;
  const skipN = instruments?.filter((i) => i.intelCenter?.attention?.computeMode === 'skip').length ?? 0;
  const ration = pack?.attentionRationBoard;
  const attnTrue = pack?.attentionBudget?.trueRationing === true || ration?.trueRationing === true;

  const processScore = n
    ? +(
        ((withDissent / n) * 0.22 +
          (withTriggers / n) * 0.22 +
          (withN / n) * 0.18 +
          (processReadyN / n) * 0.18 +
          (gateTop5Pass / n) * 0.1 +
          (mispriced > 0 ? 0.05 : 0) +
          (diff?.available ? 0.05 : 0)) *
        100
      ).toFixed(1)
    : null;

  const archiveDirRaw =
    card?.outcome?.directionHit || pack?.processLearning?.directionHit || null;
  const archiveProcRaw =
    card?.outcome?.processCorrect || pack?.processLearning?.processCorrect || null;
  const dirParsed = parseHitDisplay(archiveDirRaw);
  const procParsed = parseHitDisplay(archiveProcRaw);

  const panels = [
    panel('dissent', '反对覆盖', withDissent, n),
    panel('triggers', '触发器覆盖', withTriggers, n),
    panel('claimN', '命题带n', withN, n),
    panel('ready', '过程就绪', processReadyN, n),
    panel('surpriseN', `惊讶n≥${INTERRUPT_SURPRISE_N_GATE}`, surpriseNOk, n, {
      gate: INTERRUPT_SURPRISE_N_GATE,
      gateDisplay: `门槛 n≥${INTERRUPT_SURPRISE_N_GATE}`,
    }),
    panel('interruptN', `打断惊喜n合格`, interruptNOk, interrupts || null, {
      gate: INTERRUPT_SURPRISE_N_GATE,
      gateDisplay: `打断候选门槛 n≥${INTERRUPT_SURPRISE_N_GATE}`,
      missingN: interruptNMissing,
      missingNDisplay: interruptNMissing ? String(interruptNMissing) : '0',
      note: interrupts ? null : '暂无打断候选',
    }),
    {
      id: 'attention',
      label: '注意力full/lite/skip',
      value: n ? `${fullN}/${liteN}/${skipN}` : '暂无',
      n: n || null,
      nDisplay: n ? String(n) : '暂无',
      sampleDisplay: n ? `N=${n}` : 'n=暂无',
    },
    {
      id: 'attnSavings',
      label: '省算力',
      value: ration?.savingsDisplay && ration.savingsDisplay !== '暂无' ? ration.savingsDisplay : '暂无',
      n: ration?.counts?.stagesSkipped ?? null,
      nDisplay: ration?.counts?.stagesSkipped != null ? String(ration.counts.stagesSkipped) : '暂无',
      sampleDisplay:
        ration?.counts?.stagesSkipped != null ? `n=${ration.counts.stagesSkipped}` : 'n=暂无',
    },
    {
      id: 'material',
      label: '物质变更',
      value: material != null ? String(material) : '暂无',
      n: null,
      nDisplay: '暂无',
      sampleDisplay: material != null ? `物质=${material}` : 'n=暂无',
    },
    {
      id: 'direction',
      label: '方向命中(归档)',
      value: dirParsed.display,
      n: dirParsed.total,
      nDisplay: dirParsed.total != null ? String(dirParsed.total) : '暂无',
      sampleDisplay: dirParsed.total != null ? `n=${dirParsed.total}` : 'n=暂无',
      deferred: dirParsed.deferred,
      note: '工程 PASS ≠ 预测准确',
    },
  ];

  const interruptQuality = {
    candidates: interrupts,
    nGate: INTERRUPT_SURPRISE_N_GATE,
    nOk: interruptNOk,
    nMissing: interruptNMissing,
    coverageDisplay: interrupts ? `${interruptNOk}/${interrupts}` : '暂无',
    nOkDisplay: interrupts ? `${interruptNOk}/${interrupts} (门槛≥${INTERRUPT_SURPRISE_N_GATE})` : '暂无打断候选',
    missingDisplay: interruptNMissing ? `缺n ${interruptNMissing}` : '缺n 0',
    note: 'Interrupt 须 surprise n≥20；缺 n 不计合格',
  };

  return {
    version: KPI_VERSION,
    asOf: new Date().toISOString().slice(0, 10),
    sampleN: n || null,
    sampleNDisplay: n ? String(n) : '暂无',
    interruptSurpriseGate: INTERRUPT_SURPRISE_N_GATE,
    interruptQuality,
    attentionRationing: {
      full: fullN,
      lite: liteN,
      skip: skipN,
      n: n || null,
      nDisplay: n ? `${fullN}/${liteN}/${skipN} (N=${n})` : '暂无',
      trueRationing: attnTrue,
      savingsPct: ration?.savingsPct ?? null,
      savingsDisplay: ration?.savingsDisplay || '暂无',
      integrityOk: ration?.integrityOk !== false,
      wake: ration?.counts?.wake ?? pack?.attentionBudget?.wakeCount ?? null,
    },
    processCorrectness: {
      score: processScore,
      label: processScore != null ? (processScore >= 70 ? '良好' : processScore >= 50 ? '中等' : '待改进') : '待校验',
      dissentCoverage: n ? `${withDissent}/${n}` : '暂无',
      triggerCoverage: n ? `${withTriggers}/${n}` : '暂无',
      nCoverage: n ? `${withN}/${n}` : '暂无',
      readyCoverage: n ? `${processReadyN}/${n}` : '暂无',
      surpriseNCoverage: n ? `${surpriseNOk}/${n}` : '暂无',
      interruptNCoverage: interrupts ? `${interruptNOk}/${interrupts}` : '暂无',
      gateTop5Pass: n ? `${gateTop5Pass}/${n}` : '暂无',
      archiveProcess: procParsed.display,
      archiveDirection: dirParsed.display,
      dirWrongProcessRight:
        card?.outcome?.dirWrongProcessRightDisplay ||
        pack?.processLearning?.dirWrongProcessRightDisplay ||
        '暂无',
    },
    panels,
    claimHealth: {
      activeClaims,
      archiveSnapshots: archives.length,
      revisions30d: revisions.length,
      revisions7d: revisionRate7d,
      failuresRecorded: failures.length,
    },
    alertQuality: {
      interruptToday: interrupts,
      interruptNOk,
      interruptNGate: INTERRUPT_SURPRISE_N_GATE,
      interruptNDisplay: interrupts ? `${interruptNOk}/${interrupts}` : '暂无',
      mispricedCount: mispriced,
      quietDay: diff?.quietDay ?? pack?.quietDay ?? null,
      quietDayScored: quietDays,
      materialChanges: material != null ? material : null,
      materialDisplay: material != null ? String(material) : '暂无',
      dailyDiffAvailable: diff?.available ?? false,
    },
    directionHit: {
      note: '工程 PASS ≠ 预测准确；仅归档带 n 的命中可展示',
      deferred: dirParsed.deferred,
      archiveDisplay: dirParsed.display,
      hits: dirParsed.hits,
      total: dirParsed.total,
      rate: dirParsed.rate,
      nDisplay: dirParsed.total != null ? String(dirParsed.total) : '暂无',
      sampleDisplay: dirParsed.total != null ? `${dirParsed.display}` : '暂无',
    },
    display: `过程分 ${processScore ?? '暂无'} (样本${n || '暂无'}) · 反对 ${
      n ? `${withDissent}/${n}` : '暂无'
    } · 触发 ${n ? `${withTriggers}/${n}` : '暂无'} · 带n ${n ? `${withN}/${n}` : '暂无'} · 惊讶合格 ${
      n ? `${surpriseNOk}/${n}` : '暂无'
    } · 打断n ${interrupts ? `${interruptNOk}/${interrupts}` : '暂无'} · 方向 ${dirParsed.display}`,
    dataSource: 'intel-kpi',
    method: 'process-over-prediction+n-panels+interrupt-gate',
  };
}

module.exports = {
  KPI_VERSION,
  INTERRUPT_SURPRISE_N_GATE,
  computeKpis,
  parseHitDisplay,
};
