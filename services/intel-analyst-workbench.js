/**
 * 情报中心 · 分析师工作台闭环（构想 §55 / §38）
 * 标注 → reliability 回写 → 问题队列 boost → 门禁/证据硬度
 */
const fs = require('fs');
const path = require('path');
const { getIntelDir, appendJsonl, readJsonl } = require('./intel-memory');

const WORKBENCH_VERSION = 'v2.89.20-ann-weight-bridge';

const ANNOTATION_TYPES = {
  noise: { label: '噪音', reliabilityDelta: -0.2, targetDefault: 'news' },
  reliable: { label: '可靠', reliabilityDelta: 0.15, targetDefault: 'news' },
  manipulation_risk: { label: '操纵风险', reliabilityDelta: -0.35, targetDefault: 'news' },
  freeze_claim: { label: '冻结命题', blocksPublish: true },
  pin_trigger: { label: '关键触发器', priorityBoost: 25 },
  canonical_pin: { label: '指定同构 case', note: '进入同构监视', priorityBoost: 10 },
  playbook_pin: { label: '指定 Playbook', note: '覆写决策树主剧本', requiresTarget: true },
  playbook_clear: { label: '清除 Playbook 覆写', note: '恢复决策树自动匹配' },
  veto: { label: '否决', blocksPublish: true, requiresReason: true },
};

function reliabilityPath() {
  const dir = getIntelDir();
  if (!dir) return null;
  return path.join(dir, 'analyst-reliability.json');
}

function loadReliabilityTable() {
  const fp = reliabilityPath();
  if (!fp || !fs.existsSync(fp)) {
    return { version: WORKBENCH_VERSION, byInstrument: {}, updatedAt: null };
  }
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { version: WORKBENCH_VERSION, byInstrument: {}, updatedAt: null };
  }
}

function saveReliabilityTable(table) {
  const fp = reliabilityPath();
  if (!fp) return false;
  fs.writeFileSync(
    fp,
    JSON.stringify({ ...table, version: WORKBENCH_VERSION, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  return true;
}

function rebuildReliabilityFromAnnotations() {
  const all = readJsonl('analyst-annotations.jsonl', 2000);
  const byInstrument = {};
  for (const a of all) {
    const id = a.instrumentId;
    if (!id) continue;
    if (!byInstrument[id]) {
      byInstrument[id] = { targets: {}, priorityBoost: 0, frozen: false, vetoed: false, canonicalPinned: false };
    }
    const row = byInstrument[id];
    const def = ANNOTATION_TYPES[a.annotationType];
    if (!def) continue;
    if (a.annotationType === 'freeze_claim') row.frozen = true;
    if (a.annotationType === 'veto') row.vetoed = true;
    if (a.annotationType === 'canonical_pin') row.canonicalPinned = true;
    if (def.priorityBoost) row.priorityBoost += def.priorityBoost;
    if (def.reliabilityDelta != null) {
      const target = a.target || def.targetDefault || 'global';
      if (!row.targets[target]) row.targets[target] = { delta: 0, n: 0 };
      row.targets[target].delta += def.reliabilityDelta;
      row.targets[target].n += 1;
      row.targets[target].delta = Math.max(-0.8, Math.min(0.8, row.targets[target].delta));
    }
  }
  const table = { version: WORKBENCH_VERSION, byInstrument, updatedAt: new Date().toISOString() };
  saveReliabilityTable(table);
  return table;
}

function getReliabilityAdjustment(instrumentId, evidenceType = 'global') {
  const table = loadReliabilityTable();
  const row = table.byInstrument?.[instrumentId];
  if (!row) return { delta: 0, n: 0, available: false };
  const t = row.targets?.[evidenceType] || row.targets?.global;
  if (!t) return { delta: 0, n: 0, available: false, priorityBoost: row.priorityBoost || 0 };
  return {
    delta: t.delta,
    n: t.n,
    available: true,
    priorityBoost: row.priorityBoost || 0,
    frozen: row.frozen,
    vetoed: row.vetoed,
  };
}

function applyReliabilityToEvidenceList(evidenceList, instrumentId) {
  if (!evidenceList?.length || !instrumentId) return evidenceList || [];
  return evidenceList.map((e) => {
    const adj = getReliabilityAdjustment(instrumentId, e.evidenceType || 'global');
    if (!adj.available || !adj.delta) return e;
    const base = e.reliability?.score != null ? e.reliability.score : e.hardness != null ? e.hardness : 0.5;
    const next = Math.max(0.05, Math.min(0.99, base + adj.delta));
    return {
      ...e,
      reliability: {
        ...(e.reliability || {}),
        score: +next.toFixed(3),
        analystAdjusted: true,
        analystDelta: adj.delta,
        analystN: adj.n,
        label: next >= 0.75 ? '高' : next >= 0.5 ? '中' : '低',
      },
      hardness: +next.toFixed(3),
      analystReliabilityNote: `分析师Δ ${adj.delta > 0 ? '+' : ''}${adj.delta} (n=${adj.n})`,
    };
  });
}

function recordAnnotation(payload) {
  const { instrumentId, claimId, type, target, reason, analyst = 'local', stateKey } = payload || {};
  if (!instrumentId || !type || !ANNOTATION_TYPES[type]) {
    return { ok: false, error: 'invalid_annotation' };
  }
  if (ANNOTATION_TYPES[type].requiresReason && !(reason && String(reason).trim())) {
    return { ok: false, error: 'reason_required' };
  }
  if (ANNOTATION_TYPES[type].requiresTarget && !(target && String(target).trim())) {
    return { ok: false, error: 'target_required' };
  }
  const def = ANNOTATION_TYPES[type];
  const record = {
    type: 'analyst_annotation',
    annotationType: type,
    instrumentId: String(instrumentId).toLowerCase(),
    claimId: claimId || null,
    stateKey: stateKey || null,
    target: target || def.targetDefault || null,
    reason: reason || null,
    analyst,
    reliabilityDelta: def.reliabilityDelta ?? null,
    priorityBoost: def.priorityBoost ?? null,
    version: WORKBENCH_VERSION,
  };
  appendJsonl('analyst-annotations.jsonl', record);
  const table = rebuildReliabilityFromAnnotations();

  // 标注 → 权重信号 → 仅提案待人审（不静默落盘生效权）
  let weightSignal = { ingested: false, reason: 'skipped' };
  let weightProposal = null;
  try {
    const {
      ingestAnalystWeightSignal,
      proposePlaybookWeights,
      getPendingWeightProposal,
    } = require('./intel-process-learning');
    weightSignal = ingestAnalystWeightSignal(record);
    if (weightSignal.ingested) {
      proposePlaybookWeights({ sampleN: null, note: 'analyst-annotation-refresh' });
      weightProposal = getPendingWeightProposal();
    }
  } catch (err) {
    weightSignal = { ingested: false, reason: err.message };
  }

  return {
    ok: true,
    record,
    reliability: table.byInstrument[record.instrumentId] || null,
    weightSignal,
    weightProposal,
  };
}

function loadAnnotationsForInstrument(instrumentId, limit = 20) {
  const all = readJsonl('analyst-annotations.jsonl', 800);
  const id = String(instrumentId || '').toLowerCase();
  return all.filter((a) => String(a.instrumentId).toLowerCase() === id).slice(-limit);
}

function applyAnnotationsToIntel(inst) {
  const id = inst?.id;
  const anns = loadAnnotationsForInstrument(id);
  const table = loadReliabilityTable();
  const row = table.byInstrument?.[id] || {};

  if (!anns.length && !row.priorityBoost && !row.frozen && !row.vetoed) {
    return {
      applied: false,
      annotations: [],
      effects: [],
      priorityBoost: 0,
      reliabilityTargets: {},
      display: '无标注',
      dataSource: 'intel-analyst-workbench',
    };
  }

  const effects = [];
  let manipulationN = 0;
  for (const a of anns.slice(-8)) {
    const def = ANNOTATION_TYPES[a.annotationType];
    if (!def) continue;
    if (a.annotationType === 'manipulation_risk') manipulationN += 1;
    effects.push({
      type: a.annotationType,
      label: def.label,
      reason: a.reason,
      target: a.target,
      reliabilityDelta: a.reliabilityDelta,
    });
  }

  const newsDelta = row.targets?.news?.delta;
  const manipulationRisk =
    manipulationN > 0 || (newsDelta != null && newsDelta <= -0.3);

  return {
    applied: true,
    annotations: anns.slice(-5),
    effects,
    frozen: Boolean(row.frozen),
    vetoed: Boolean(row.vetoed),
    canonicalPinned: Boolean(row.canonicalPinned),
    manipulationRisk,
    manipulationN,
    newsReliabilityDelta: newsDelta ?? null,
    priorityBoost: row.priorityBoost || 0,
    reliabilityTargets: row.targets || {},
    display:
      effects.map((e) => e.label).join('、') ||
      (row.frozen ? '冻结' : manipulationRisk ? '操纵风险' : '无标注'),
    dataSource: 'intel-analyst-workbench',
    method: 'annotation→reliability-table',
    version: WORKBENCH_VERSION,
  };
}

function buildWorkbenchSummary(instruments) {
  const table = loadReliabilityTable();
  const all = readJsonl('analyst-annotations.jsonl', 200);
  const recent = all.slice(-10).reverse();
  const frozenIds = Object.entries(table.byInstrument || {})
    .filter(([, v]) => v.frozen)
    .map(([k]) => k);

  return {
    version: WORKBENCH_VERSION,
    annotationTypes: ANNOTATION_TYPES,
    recentAnnotations: recent,
    frozenCount: frozenIds.length,
    frozenInstruments: frozenIds,
    instrumentAdjustments: Object.keys(table.byInstrument || {}).length,
    dataSource: 'intel-analyst-workbench',
  };
}

module.exports = {
  WORKBENCH_VERSION,
  ANNOTATION_TYPES,
  recordAnnotation,
  loadAnnotationsForInstrument,
  applyAnnotationsToIntel,
  applyReliabilityToEvidenceList,
  getReliabilityAdjustment,
  rebuildReliabilityFromAnnotations,
  loadReliabilityTable,
  buildWorkbenchSummary,
};
