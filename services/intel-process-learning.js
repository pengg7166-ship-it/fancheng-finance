/**
 * 情报中心 · 过程学习闭环（构想 §5/58/73）
 * 方向 hit 与过程正确分开打标；样本不够不改权。禁止用假分填充。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { readJsonl, appendJsonl } = require('./intel-memory');
const { readCachedKlines } = require('./commodity-technical-analyzer');

const PROCESS_VERSION = 'v2.89.20-analyst-weight-ack';
const WEIGHTS_FILE = 'process-playbook-weights.json';
const PROPOSAL_FILE = 'process-playbook-weights-proposal.json';
const PROPOSAL_ARCHIVE = 'process-weight-proposals.jsonl';
const APPROVAL_ARCHIVE = 'process-weight-approvals.jsonl';
const ANALYST_SIGNAL_FILE = 'analyst-weight-signals.jsonl';
const ANALYST_WEIGHT_N_GATE = 5;

function getIntelDir() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const dir = path.join(dataDir, 'intel-center');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function forwardReturn(instrumentId, fromDate, horizonDays) {
  const bars = (readCachedKlines(instrumentId) || [])
    .map((k) => ({
      date: String(k.date || k.day || '').slice(0, 10),
      close: Number(k.close ?? k.c ?? 0),
    }))
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const i = bars.findIndex((b) => b.date >= fromDate);
  if (i < 0 || i + horizonDays >= bars.length) return { pct: null, n: 0, actualDate: null };
  const from = bars[i];
  const to = bars[i + horizonDays];
  if (!(from.close > 0)) return { pct: null, n: 0, actualDate: null };
  return {
    pct: +(((to.close - from.close) / from.close) * 100).toFixed(4),
    n: horizonDays,
    actualDate: to.date,
    dataSource: 'readCachedKlines',
  };
}

function directionFromSide(side) {
  if (side === 'bull') return 1;
  if (side === 'bear') return -1;
  return 0;
}

/**
 * 过程正确：有反对 + 有触发器 +（若有 n 则 n≥15）
 * 与方向是否命中无关
 */
function scoreProcessCorrect(snap) {
  const hasDissent = Boolean(snap?.hadDissent ?? snap?.evidenceAgainstCount >= 1);
  const hasTriggers = Boolean(snap?.hadTriggers ?? snap?.triggerCount >= 1);
  const nOk = snap?.n == null || snap.n >= 15;
  const processCorrect = hasDissent && hasTriggers && nOk;
  return {
    processCorrect,
    hadDissent: hasDissent,
    hadTriggers: hasTriggers,
    nOk,
    reasons: [
      hasDissent ? '有反对' : '缺反对',
      hasTriggers ? '有触发器' : '缺触发器',
      nOk ? 'n合格或暂无' : `n不足(${snap?.n})`,
    ],
  };
}

/**
 * 从 claims-archive 抽样，对照后续日 K 打标
 */
function evaluateArchivedClaims({ horizonDays = 3, limit = 80, persist = true } = {}) {
  const archives = readJsonl('claims-archive.jsonl', 800);
  const recent = archives.filter((a) => a.side && a.side !== 'flat' && a.instrumentId && a.recordedAt).slice(-limit);

  const rows = [];
  let directionHits = 0;
  let directionScored = 0;
  let processCorrectN = 0;
  let processScored = 0;
  let bothGood = 0;
  let dirWrongProcessRight = 0;

  for (const snap of recent) {
    const asOf = String(snap.recordedAt || '').slice(0, 10);
    if (!asOf) continue;
    const fwd = forwardReturn(snap.instrumentId, asOf, horizonDays);
    const proc = scoreProcessCorrect({
      hadDissent: snap.hadDissent,
      hadTriggers: snap.hadTriggers,
      evidenceAgainstCount: snap.evidenceAgainstCount,
      triggerCount: snap.triggerCount,
      n: snap.n,
    });

    let directionHit = null;
    let scored = false;
    if (fwd.pct != null && Math.abs(fwd.pct) >= 0.15) {
      const pred = directionFromSide(snap.side);
      const actual = fwd.pct > 0 ? 1 : -1;
      directionHit = pred !== 0 && pred === actual;
      scored = true;
      directionScored += 1;
      if (directionHit) directionHits += 1;
    }

    processScored += 1;
    if (proc.processCorrect) processCorrectN += 1;
    if (scored && directionHit && proc.processCorrect) bothGood += 1;
    if (scored && directionHit === false && proc.processCorrect) dirWrongProcessRight += 1;

    const row = {
      type: 'process_score',
      claimId: snap.claimId,
      instrumentId: snap.instrumentId,
      asOf,
      side: snap.side,
      horizonDays,
      forwardPct: fwd.pct,
      actualDate: fwd.actualDate,
      directionHit,
      scored,
      ...proc,
      stateKey: snap.stateKey || null,
      version: PROCESS_VERSION,
      dataSource: 'claims-archive+klines',
    };
    rows.push(row);
    if (persist && scored) appendJsonl('process-scores.jsonl', row);
  }

  const hitDisplay =
    directionScored > 0
      ? `${((directionHits / directionScored) * 100).toFixed(1)}% (${directionHits}/${directionScored})`
      : '暂无';
  const processDisplay =
    processScored > 0
      ? `${((processCorrectN / processScored) * 100).toFixed(1)}% (${processCorrectN}/${processScored})`
      : '暂无';

  const report = {
    version: PROCESS_VERSION,
    horizonDays,
    sampleN: rows.length,
    directionHit: hitDisplay,
    directionHits,
    directionScored,
    processCorrect: processDisplay,
    processCorrectN,
    processScored,
    bothGood,
    dirWrongProcessRight,
    dirWrongProcessRightDisplay:
      directionScored > 0
        ? `${dirWrongProcessRight}/${directionScored} 方向错但过程对`
        : '暂无',
    rows: rows.slice(-20),
    dataSource: 'intel-process-learning',
    method: 'archive-vs-forward-k',
  };

  if (persist) {
    report.weightProposal = proposePlaybookWeights(report);
  }
  return report;
}

function loadPlaybookWeights() {
  const dir = getIntelDir();
  if (!dir) return { version: PROCESS_VERSION, byStateKey: {}, updatedAt: null, approved: false };
  const fp = path.join(dir, WEIGHTS_FILE);
  if (!fs.existsSync(fp)) return { version: PROCESS_VERSION, byStateKey: {}, updatedAt: null, approved: false };
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return {
      ...raw,
      approved: raw.approved !== false,
      dataSource: raw.dataSource || 'process-playbook-weights',
    };
  } catch {
    return { version: PROCESS_VERSION, byStateKey: {}, updatedAt: null, approved: false };
  }
}

function loadWeightProposal() {
  const dir = getIntelDir();
  if (!dir) return null;
  const fp = path.join(dir, PROPOSAL_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function diffWeightMultipliers(current, proposedByKey) {
  const changes = [];
  const keys = new Set([
    ...Object.keys(current?.byStateKey || {}),
    ...Object.keys(proposedByKey || {}),
  ]);
  for (const key of keys) {
    const next = proposedByKey[key];
    if (!next?.available) continue;
    const prev = current?.byStateKey?.[key];
    const from = prev?.available && prev.multiplier != null ? Number(prev.multiplier) : 1;
    const to = Number(next.multiplier);
    if (!Number.isFinite(to)) continue;
    if (Math.abs(to - from) < 0.0005) continue;
    changes.push({
      stateKey: key,
      from: +from.toFixed(3),
      to: +to.toFixed(3),
      n: next.n ?? null,
      nDisplay: next.nDisplay || (next.n != null ? String(next.n) : '暂无'),
      processDisplay: next.processDisplay || '暂无',
      dirHitDisplay: next.dirHitDisplay || '暂无',
      analystInformed: Boolean(next.analystInformed),
      analystN: next.analystN ?? null,
      source: next.analystInformed ? 'analyst+process' : next.method || 'process_score',
    });
  }
  changes.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  return changes;
}

/**
 * 分析师标注 → 权重信号（只入 JSONL，不静默改生效权）
 */
function ingestAnalystWeightSignal(annotation) {
  const type = annotation?.annotationType || annotation?.type;
  if (!['reliable', 'noise', 'manipulation_risk'].includes(type)) {
    return { ingested: false, reason: 'not_weight_signal', annotationType: type || null };
  }
  const instrumentId = annotation.instrumentId ? String(annotation.instrumentId).toLowerCase() : null;
  if (!instrumentId) return { ingested: false, reason: 'no_instrument' };
  const stateKey = annotation.stateKey || `inst:${instrumentId}`;
  const signal = {
    type: 'analyst_weight_signal',
    instrumentId,
    claimId: annotation.claimId || null,
    annotationType: type,
    reliabilityDelta: annotation.reliabilityDelta ?? null,
    stateKey,
    at: new Date().toISOString(),
    version: PROCESS_VERSION,
    dataSource: 'intel-process-learning',
    method: 'annotation→weight-signal',
  };
  appendJsonl(ANALYST_SIGNAL_FILE, signal);
  return { ingested: true, signal };
}

/**
 * 聚合标注权重提示：n≥ANALYST_WEIGHT_N_GATE 才可进提案；禁止裸乘数无 n
 */
function aggregateAnalystWeightHints() {
  const signals = readJsonl(ANALYST_SIGNAL_FILE, 800);
  const byKey = {};
  for (const s of signals) {
    const key = s.stateKey || (s.instrumentId ? `inst:${s.instrumentId}` : null);
    if (!key) continue;
    if (!byKey[key]) byKey[key] = { n: 0, reliable: 0, noise: 0, manip: 0, netDelta: 0 };
    const b = byKey[key];
    b.n += 1;
    if (s.annotationType === 'reliable') b.reliable += 1;
    if (s.annotationType === 'noise') b.noise += 1;
    if (s.annotationType === 'manipulation_risk') b.manip += 1;
    if (typeof s.reliabilityDelta === 'number') b.netDelta += s.reliabilityDelta;
  }
  const hints = {};
  for (const [key, b] of Object.entries(byKey)) {
    if (b.n < ANALYST_WEIGHT_N_GATE) {
      hints[key] = {
        available: false,
        n: b.n,
        nDisplay: String(b.n),
        note: `标注样本不足(n<${ANALYST_WEIGHT_N_GATE})不改权`,
        multiplierHint: 1,
        source: 'analyst_annotation',
      };
      continue;
    }
    let multiplierHint = 1;
    if (b.manip / b.n >= 0.4) multiplierHint = 0.94;
    else if (b.noise / b.n >= 0.5) multiplierHint = 0.96;
    else if (b.reliable / b.n >= 0.6 && b.netDelta > 0) multiplierHint = 1.04;
    hints[key] = {
      available: multiplierHint !== 1,
      n: b.n,
      nDisplay: String(b.n),
      reliable: b.reliable,
      noise: b.noise,
      manip: b.manip,
      netDelta: +b.netDelta.toFixed(3),
      multiplierHint: +multiplierHint.toFixed(3),
      method: `analyst-annotation-gate-n${ANALYST_WEIGHT_N_GATE}`,
      source: 'analyst_annotation',
    };
  }
  return hints;
}

function mergeAnalystHintsIntoByStateKey(byStateKey, analystHints) {
  const informedKeys = [];
  for (const [key, hint] of Object.entries(analystHints || {})) {
    if (!hint?.available || !(hint.multiplierHint > 0) || hint.multiplierHint === 1) continue;
    informedKeys.push(key);
    if (!byStateKey[key] || !byStateKey[key].available) {
      byStateKey[key] = {
        available: true,
        n: hint.n,
        nDisplay: hint.nDisplay,
        processRate: null,
        processDisplay: '暂无·标注驱动',
        dirHitDisplay: '暂无',
        multiplier: hint.multiplierHint,
        method: hint.method,
        analystInformed: true,
        analystN: hint.n,
        analystHint: hint.multiplierHint,
      };
    } else {
      const blended = +(byStateKey[key].multiplier * 0.7 + hint.multiplierHint * 0.3).toFixed(3);
      byStateKey[key] = {
        ...byStateKey[key],
        multiplier: blended,
        analystInformed: true,
        analystN: hint.n,
        analystHint: hint.multiplierHint,
        method: `${byStateKey[key].method || 'process'}+analyst-n${ANALYST_WEIGHT_N_GATE}`,
      };
    }
  }
  return informedKeys;
}

/**
 * 仅当某 stateKey 下过程正确率显著且 n≥20 时生成微调提案；
 * 标注信号 n≥5 可并入提案。禁止静默写入生效权 — 须人审 approve
 */
function proposePlaybookWeights(report) {
  const scores = readJsonl('process-scores.jsonl', 400);
  const byKey = {};
  for (const s of scores) {
    const key = s.stateKey || 'unknown';
    if (!byKey[key]) byKey[key] = { n: 0, processOk: 0, dirHit: 0, dirScored: 0, dirWrongProcessRight: 0 };
    const b = byKey[key];
    b.n += 1;
    if (s.processCorrect) b.processOk += 1;
    if (s.scored) {
      b.dirScored += 1;
      if (s.directionHit) b.dirHit += 1;
      if (s.directionHit === false && s.processCorrect) b.dirWrongProcessRight += 1;
    }
  }

  const byStateKey = {};
  for (const [key, b] of Object.entries(byKey)) {
    if (b.n < 20) {
      byStateKey[key] = {
        available: false,
        n: b.n,
        nDisplay: String(b.n),
        note: '样本不足不改权',
        multiplier: 1,
      };
      continue;
    }
    const processRate = b.processOk / b.n;
    let multiplier = 1;
    if (processRate >= 0.65) multiplier = 1.08;
    else if (processRate < 0.4) multiplier = 0.92;
    if (b.dirScored >= 15 && b.dirWrongProcessRight / b.dirScored >= 0.25) {
      multiplier = Math.max(multiplier, 1.05);
    }
    byStateKey[key] = {
      available: true,
      n: b.n,
      nDisplay: String(b.n),
      processRate: +processRate.toFixed(3),
      processDisplay: `${Math.round(processRate * 100)}% (${b.processOk}/${b.n})`,
      dirHitDisplay:
        b.dirScored > 0 ? `${Math.round((b.dirHit / b.dirScored) * 100)}% (${b.dirHit}/${b.dirScored})` : '暂无',
      dirWrongProcessRight: b.dirWrongProcessRight,
      multiplier: +multiplier.toFixed(3),
      method: 'process-rate-gate-n20',
    };
  }

  const analystHints = aggregateAnalystWeightHints();
  const analystInformedKeys = mergeAnalystHintsIntoByStateKey(byStateKey, analystHints);
  const analystSignalN = Object.values(analystHints).reduce((acc, h) => acc + (h.n || 0), 0);
  const analystReadyKeys = Object.values(analystHints).filter((h) => h.available).length;

  const current = loadPlaybookWeights();
  const materialChanges = diffWeightMultipliers(current, byStateKey);
  const proposalId = `pw-${Date.now().toString(36)}`;
  const pendingApproval = materialChanges.length > 0;
  const analystMaterial = materialChanges.filter((c) => c.analystInformed).length;
  const analystContribution = {
    signalN: analystSignalN,
    signalNDisplay: String(analystSignalN),
    readyKeys: analystReadyKeys,
    informedKeys: analystInformedKeys.length,
    materialWithAnalyst: analystMaterial,
    nGate: ANALYST_WEIGHT_N_GATE,
    display:
      analystMaterial > 0
        ? `标注驱动 ${analystMaterial} 项待审 · 信号 n=${analystSignalN}`
        : analystReadyKeys > 0
          ? `标注已达门槛 ${analystReadyKeys} 键 · 无实质权差`
          : analystSignalN > 0
            ? `标注信号 n=${analystSignalN} · 未达 n≥${ANALYST_WEIGHT_N_GATE} 不改权`
            : '暂无标注权重信号',
    dataSource: 'analyst-weight-signals.jsonl',
    method: `annotation→propose-n${ANALYST_WEIGHT_N_GATE}-human-ack`,
  };

  const proposal = {
    version: PROCESS_VERSION,
    proposalId,
    status: pendingApproval ? 'pending' : 'noop',
    pendingApproval,
    proposedAt: new Date().toISOString(),
    byStateKey,
    materialChanges,
    materialCount: materialChanges.length,
    analystContribution,
    lastReport: {
      directionHit: report?.directionHit || '暂无',
      processCorrect: report?.processCorrect || '暂无',
      dirWrongProcessRightDisplay: report?.dirWrongProcessRightDisplay || '暂无',
      sampleN: report?.sampleN ?? null,
    },
    currentApprovedAt: current.approvedAt || current.updatedAt || null,
    note: pendingApproval
      ? `待人审 · ${materialChanges.length} 项乘数变更${analystMaterial ? `（含标注 ${analystMaterial}）` : ''} · 未写入生效权`
      : '无实质变更 · 不写生效权',
    dataSource: 'intel-process-learning',
    method: 'propose-only-human-ack+analyst-signals',
  };

  const dir = getIntelDir();
  if (dir) {
    fs.writeFileSync(path.join(dir, PROPOSAL_FILE), JSON.stringify(proposal, null, 2), 'utf8');
    if (pendingApproval) {
      try {
        appendJsonl(PROPOSAL_ARCHIVE, {
          type: 'weight_proposal',
          proposalId,
          materialCount: materialChanges.length,
          materialChanges: materialChanges.slice(0, 20),
          analystContribution,
          proposedAt: proposal.proposedAt,
          version: PROCESS_VERSION,
        });
      } catch {
        // ignore archive failure
      }
    }
  }

  return proposal;
}

/** @deprecated 兼容旧调用：改为只提案，不静默落盘 */
function tryUpdatePlaybookWeights(report) {
  return proposePlaybookWeights(report);
}

function getPendingWeightProposal() {
  const proposal = loadWeightProposal();
  if (!proposal) {
    return {
      available: false,
      pendingApproval: false,
      display: '无权提案',
      dataSource: 'intel-process-learning',
    };
  }
  return {
    available: true,
    pendingApproval: proposal.status === 'pending' && proposal.pendingApproval === true,
    proposalId: proposal.proposalId || null,
    status: proposal.status || null,
    materialCount: proposal.materialCount ?? (proposal.materialChanges || []).length,
    materialChanges: (proposal.materialChanges || []).slice(0, 16),
    proposedAt: proposal.proposedAt || null,
    note: proposal.note || null,
    lastReport: proposal.lastReport || null,
    analystContribution: proposal.analystContribution || null,
    display:
      proposal.status === 'pending' && proposal.pendingApproval
        ? `权提案待审 ${proposal.materialCount ?? 0} 项 · ${proposal.proposalId || ''}${
            proposal.analystContribution?.materialWithAnalyst
              ? ` · 标注${proposal.analystContribution.materialWithAnalyst}`
              : ''
          }`
        : proposal.status === 'approved'
          ? `最近已批准 ${proposal.proposalId || ''}`
          : proposal.status === 'rejected'
            ? `最近已驳回 ${proposal.proposalId || ''}`
            : proposal.note || '无待审权提案',
    dataSource: 'intel-process-learning',
    method: 'human-ack-gate+analyst-signals',
  };
}

function approvePlaybookWeights({ proposalId, actor, note } = {}) {
  const proposal = loadWeightProposal();
  if (!proposal || proposal.status !== 'pending' || !proposal.pendingApproval) {
    return { ok: false, error: '无待审权提案' };
  }
  if (proposalId && proposal.proposalId && proposalId !== proposal.proposalId) {
    return { ok: false, error: `提案不匹配 · 期望 ${proposal.proposalId}` };
  }
  if (!(proposal.materialChanges || []).length) {
    return { ok: false, error: '提案无实质变更 · 拒绝空批' };
  }

  const payload = {
    version: PROCESS_VERSION,
    updatedAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    approvedBy: actor || 'analyst',
    approvalNote: note || null,
    proposalId: proposal.proposalId,
    approved: true,
    byStateKey: proposal.byStateKey || {},
    lastReport: proposal.lastReport || null,
    materialChanges: proposal.materialChanges || [],
    dataSource: 'intel-process-learning',
    method: 'human-ack-approved',
  };

  const dir = getIntelDir();
  if (!dir) return { ok: false, error: 'intel-center 目录不可用' };
  fs.writeFileSync(path.join(dir, WEIGHTS_FILE), JSON.stringify(payload, null, 2), 'utf8');

  const closed = {
    ...proposal,
    status: 'approved',
    pendingApproval: false,
    approvedAt: payload.approvedAt,
    approvedBy: payload.approvedBy,
    note: `已批准落盘 · ${payload.approvedBy}`,
  };
  fs.writeFileSync(path.join(dir, PROPOSAL_FILE), JSON.stringify(closed, null, 2), 'utf8');

  try {
    appendJsonl(APPROVAL_ARCHIVE, {
      type: 'weight_approval',
      action: 'approve',
      proposalId: proposal.proposalId,
      actor: payload.approvedBy,
      note: note || null,
      materialCount: (proposal.materialChanges || []).length,
      materialChanges: (proposal.materialChanges || []).slice(0, 20),
      at: payload.approvedAt,
      version: PROCESS_VERSION,
    });
  } catch {
    // ignore
  }

  return {
    ok: true,
    proposalId: proposal.proposalId,
    materialCount: (proposal.materialChanges || []).length,
    weights: payload,
    pending: getPendingWeightProposal(),
  };
}

function rejectPlaybookWeights({ proposalId, actor, reason } = {}) {
  const proposal = loadWeightProposal();
  if (!proposal || proposal.status !== 'pending' || !proposal.pendingApproval) {
    return { ok: false, error: '无待审权提案' };
  }
  if (proposalId && proposal.proposalId && proposalId !== proposal.proposalId) {
    return { ok: false, error: `提案不匹配 · 期望 ${proposal.proposalId}` };
  }

  const closed = {
    ...proposal,
    status: 'rejected',
    pendingApproval: false,
    rejectedAt: new Date().toISOString(),
    rejectedBy: actor || 'analyst',
    rejectReason: reason || null,
    note: `已驳回 · 生效权未改${reason ? ` · ${reason}` : ''}`,
  };
  const dir = getIntelDir();
  if (!dir) return { ok: false, error: 'intel-center 目录不可用' };
  fs.writeFileSync(path.join(dir, PROPOSAL_FILE), JSON.stringify(closed, null, 2), 'utf8');

  try {
    appendJsonl(APPROVAL_ARCHIVE, {
      type: 'weight_approval',
      action: 'reject',
      proposalId: proposal.proposalId,
      actor: closed.rejectedBy,
      reason: reason || null,
      materialCount: (proposal.materialChanges || []).length,
      at: closed.rejectedAt,
      version: PROCESS_VERSION,
    });
  } catch {
    // ignore
  }

  return {
    ok: true,
    proposalId: proposal.proposalId,
    rejected: true,
    pending: getPendingWeightProposal(),
  };
}

function lookupProcessMultiplier(stateKey) {
  const w = loadPlaybookWeights();
  const row = w.byStateKey?.[stateKey || 'unknown'];
  if (!row?.available) return { multiplier: 1, available: false, n: row?.n ?? null, note: row?.note || '暂无' };
  // 未批准的历史文件仍可读，但新提案绝不自动进此文件
  return {
    multiplier: row.multiplier,
    available: true,
    n: row.n,
    nDisplay: row.nDisplay,
    processDisplay: row.processDisplay,
    approvedAt: w.approvedAt || w.updatedAt || null,
    dataSource: 'process-playbook-weights',
  };
}

/** 丰富归档字段，供后续过程打分 */
function enrichArchiveFields(claim) {
  return {
    hadDissent: (claim?.evidenceAgainst?.length || 0) >= 1,
    hadTriggers: (claim?.triggers?.length || 0) >= 1,
    evidenceAgainstCount: claim?.evidenceAgainst?.length || 0,
    triggerCount: claim?.triggers?.length || 0,
  };
}

/**
 * 当日品种过程就绪度（结果未知前）：反对 / 触发器 / n / Unknown 阻断
 * 与方向命中无关 —— 这是「过程正确」的 live 侧。
 */
function assessLiveProcessReadiness(inst) {
  const claim = inst?.intelCenter?.primaryClaim;
  const um = inst?.intelCenter?.unknownMap || inst?.intelCenter?.memo?.unknownMap;
  const against =
    (claim?.evidenceAgainst?.length || 0) >= 1 ||
    (inst?.intelligenceKernel?.dissent?.opposingEvidence?.length || 0) >= 1 ||
    (inst?.intelCenter?.redTeam?.arguments?.length || 0) >= 1;
  const triggers = (claim?.triggers?.length || 0) >= 1;
  const n = claim?.n;
  const nOk = n == null || n >= 15;
  const nDisplay = n != null ? String(n) : '暂无';
  const blockingUnknown = Boolean(um?.blocksPublish || um?.hasCritical);
  const choicePrimary = inst?.intelCenter?.choiceSet?.primaryId || inst?.intelCenter?.memo?.choiceSet?.primaryId;

  const checks = [
    { id: 'dissent', ok: against, label: against ? '有反对' : '缺反对' },
    { id: 'triggers', ok: triggers, label: triggers ? '有触发器' : '缺触发器' },
    { id: 'n', ok: nOk, label: n != null ? (nOk ? `n=${n}` : `n不足(${n})`) : 'n暂无·不阻断过程' },
    { id: 'unknown', ok: !blockingUnknown, label: blockingUnknown ? '关键缺口阻断' : '无关键阻断缺口' },
  ];
  const okCount = checks.filter((c) => c.ok).length;
  const processReady = against && triggers && nOk && !blockingUnknown;
  let band = '不可发布过程';
  if (processReady) band = '过程就绪';
  else if (against && triggers) band = '过程部分就绪';
  else if (against || triggers) band = '过程薄弱';

  return {
    version: PROCESS_VERSION,
    processReady,
    band,
    okCount,
    checkCount: checks.length,
    checks,
    n,
    nDisplay,
    choicePrimary: choicePrimary || null,
    display: `${band} · ${okCount}/${checks.length} · n ${nDisplay}`,
    dataSource: 'intel-process-learning',
    method: 'live-readiness-pre-outcome',
  };
}

function attachProcessReadinessToInstruments(instruments) {
  return (instruments || []).map((inst) => {
    if (!inst?.intelCenter) return inst;
    const readiness = assessLiveProcessReadiness(inst);
    return {
      ...inst,
      intelCenter: {
        ...inst.intelCenter,
        processReadiness: readiness,
      },
    };
  });
}

/**
 * Pack 级过程正确记分牌（归档结果 + 当日就绪）
 */
function buildProcessScorecard(report, instruments, weights) {
  const live = (instruments || []).map((i) => i.intelCenter?.processReadiness).filter(Boolean);
  const readyN = live.filter((r) => r.processReady).length;
  const partialN = live.filter((r) => r.band === '过程部分就绪').length;
  const weakN = live.filter((r) => r.band === '过程薄弱' || r.band === '不可发布过程').length;

  const outcomeRows = (report?.rows || [])
    .filter((r) => r.scored)
    .slice(-12)
    .map((r) => {
      let tag = 'unscored';
      if (r.scored && r.directionHit && r.processCorrect) tag = 'dir_hit_proc_ok';
      else if (r.scored && r.directionHit === false && r.processCorrect) tag = 'dir_miss_proc_ok';
      else if (r.scored && r.directionHit && !r.processCorrect) tag = 'dir_hit_proc_bad';
      else if (r.scored && r.directionHit === false && !r.processCorrect) tag = 'dir_miss_proc_bad';
      return {
        claimId: r.claimId,
        instrumentId: r.instrumentId,
        asOf: r.asOf,
        tag,
        tagLabel:
          tag === 'dir_hit_proc_ok'
            ? '方向对·过程对'
            : tag === 'dir_miss_proc_ok'
              ? '方向错·过程对'
              : tag === 'dir_hit_proc_bad'
                ? '方向对·过程烂'
                : tag === 'dir_miss_proc_bad'
                  ? '方向错·过程烂'
                  : '未计分',
        directionHit: r.directionHit,
        processCorrect: r.processCorrect,
        forwardPct: r.forwardPct,
        nDisplay: r.n != null ? String(r.n) : '暂无',
        stateKey: r.stateKey || null,
      };
    });

  const weightNudges = Object.entries(weights?.byStateKey || {})
    .filter(([, v]) => v?.available && v.multiplier != null && v.multiplier !== 1)
    .map(([key, v]) => ({
      stateKey: key,
      multiplier: v.multiplier,
      n: v.n,
      nDisplay: v.nDisplay || String(v.n),
      processDisplay: v.processDisplay || '暂无',
      dirHitDisplay: v.dirHitDisplay || '暂无',
      live: true,
    }))
    .slice(0, 8);

  const pending = getPendingWeightProposal();
  const pendingChanges = (pending.materialChanges || []).slice(0, 8);

  const notReady = (instruments || [])
    .filter((i) => i.intelCenter?.processReadiness && !i.intelCenter.processReadiness.processReady)
    .slice(0, 8)
    .map((i) => ({
      instrumentId: i.id,
      instrumentName: i.name,
      display: i.intelCenter.processReadiness.display,
      missing: (i.intelCenter.processReadiness.checks || []).filter((c) => !c.ok).map((c) => c.label),
    }));

  return {
    version: PROCESS_VERSION,
    available: true,
    live: {
      readyN,
      partialN,
      weakN,
      total: live.length,
      readyDisplay: live.length ? `${readyN}/${live.length}` : '暂无',
    },
    outcome: {
      directionHit: report?.directionHit || '暂无',
      processCorrect: report?.processCorrect || '暂无',
      bothGood: report?.bothGood ?? null,
      dirWrongProcessRight: report?.dirWrongProcessRight ?? null,
      dirWrongProcessRightDisplay: report?.dirWrongProcessRightDisplay || '暂无',
      sampleN: report?.sampleN ?? null,
      sampleDisplay: report?.sampleN != null ? String(report.sampleN) : '暂无',
      horizonDays: report?.horizonDays ?? null,
      rows: outcomeRows,
    },
    weightNudges,
    weightProposal: pending,
    pendingWeightChanges: pendingChanges,
    notReady,
    display: `过程OS 就绪 ${live.length ? `${readyN}/${live.length}` : '暂无'} · 归档过程 ${report?.processCorrect || '暂无'} · 方向错过程对 ${report?.dirWrongProcessRightDisplay || '暂无'}${
      pending.pendingApproval ? ` · 权提案待审 ${pending.materialCount}` : ''
    }${
      pending.analystContribution?.display ? ` · ${pending.analystContribution.display}` : ''
    }`,
    note: '过程正确 ≠ 方向命中；归档须真实日 K actual，缺失不计分；权变更须人审后落盘；标注仅进提案',
    dataSource: 'intel-process-learning',
    method: 'live-readiness+archive-outcome+human-ack+analyst-signals',
  };
}

module.exports = {
  PROCESS_VERSION,
  WEIGHTS_FILE,
  PROPOSAL_FILE,
  ANALYST_SIGNAL_FILE,
  ANALYST_WEIGHT_N_GATE,
  evaluateArchivedClaims,
  scoreProcessCorrect,
  loadPlaybookWeights,
  loadWeightProposal,
  lookupProcessMultiplier,
  enrichArchiveFields,
  tryUpdatePlaybookWeights,
  proposePlaybookWeights,
  getPendingWeightProposal,
  approvePlaybookWeights,
  rejectPlaybookWeights,
  ingestAnalystWeightSignal,
  aggregateAnalystWeightHints,
  assessLiveProcessReadiness,
  attachProcessReadinessToInstruments,
  buildProcessScorecard,
};
