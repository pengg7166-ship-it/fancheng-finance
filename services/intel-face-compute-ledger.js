/**
 * 情报中心 · 面孔升档真算力台账（构想 §25）
 * 记录 decision/research/execution 配额、升档补跑、复用；禁止「三遍全市场」叙事。
 * 台账落盘可审计；超额升档硬截断。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const {
  ATTENTION_VERSION,
  FACE_ATTENTION_POLICY,
  faceAttentionPolicy,
} = require('./intel-attention-budget');

const FACE_COMPUTE_VERSION = 'v2.82.0-face-compute-ledger';
const LEDGER_FILE = 'face-compute-ledger.json';

function getIntelDir() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const dir = path.join(dataDir, 'intel-center');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readLedger() {
  const dir = getIntelDir();
  if (!dir) return null;
  const fp = path.join(dir, LEDGER_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function writeLedger(payload) {
  const dir = getIntelDir();
  if (!dir || !payload) return false;
  fs.writeFileSync(path.join(dir, LEDGER_FILE), JSON.stringify(payload, null, 2), 'utf8');
  return true;
}

/**
 * 从 faceRetriage + attention 预算汇总真算力板
 */
function buildFaceComputeBoard({
  attentionBudget,
  attentionByFace,
  faceRetriage,
  instruments,
  asOf,
  persist = true,
} = {}) {
  const day = asOf || new Date().toISOString().slice(0, 10);
  const faces = {};
  const instrumentN = (instruments || []).length;

  for (const faceId of ['decision', 'research', 'execution']) {
    const policy = faceAttentionPolicy(faceId);
    const budget =
      faceId === 'decision'
        ? attentionBudget
        : attentionByFace?.byFace?.[faceId] || null;
    const rt = faceRetriage?.[faceId] || null;
    const applied = rt?.appliedFull || null;
    const promoteWanted = rt?.promoteCount ?? (rt?.promote || []).length;
    const appliedCount = applied?.appliedCount ?? 0;
    const maxPromote = faceId === 'execution' ? 6 : faceId === 'research' ? 8 : 0;
    const deepSlots = budget?.deepSlots ?? policy.deepSlots;
    const fullInPack = (instruments || []).filter(
      (i) => i.intelCenter?.attention?.computeMode === 'full'
    ).length;
    const liteN = (instruments || []).filter(
      (i) => i.intelCenter?.attention?.computeMode === 'lite'
    ).length;
    const skipN = (instruments || []).filter(
      (i) => i.intelCenter?.attention?.computeMode === 'skip'
    ).length;

    const capped = promoteWanted > maxPromote && maxPromote > 0;
    const honesty =
      faceId === 'decision'
        ? `主算面孔 · full ${budget?.deepCount ?? fullInPack}/${deepSlots} 槽`
        : `升档补跑 ${appliedCount}/${Math.min(promoteWanted, maxPromote || promoteWanted)} · 非全市场重算`;

    faces[faceId] = {
      faceId,
      policyNote: policy.note,
      deepSlots,
      shallowSlots: budget?.shallowSlots ?? policy.shallowSlots,
      deepCount: budget?.deepCount ?? null,
      shallowCount: budget?.shallowCount ?? null,
      silentCount: budget?.silentCount ?? null,
      promoteWanted,
      promoteApplied: appliedCount,
      maxPromote: maxPromote || null,
      capped,
      reusedFull: Object.values(rt?.overlays || {}).filter((o) => o?.reusedFull).length,
      promotedIds: applied?.promotedIds || [],
      display: honesty,
      trueRationing: true,
      method: applied?.method || budget?.method || 'face-compute',
    };
  }

  // 完整性：任何面孔宣称 applied ≈ instrumentN 视为造假嫌疑
  const integrityFails = [];
  for (const f of Object.values(faces)) {
    if (f.promoteApplied > 0 && instrumentN > 0 && f.promoteApplied >= instrumentN * 0.85) {
      integrityFails.push({
        faceId: f.faceId,
        reason: `升档补跑 ${f.promoteApplied}/${instrumentN} 接近全市场 · 违反真配额`,
      });
    }
    if (f.capped) {
      integrityFails.push({
        faceId: f.faceId,
        reason: `升档候选 ${f.promoteWanted} > 上限 ${f.maxPromote} · 已硬截断`,
      });
    }
  }

  const board = {
    version: FACE_COMPUTE_VERSION,
    attentionVersion: ATTENTION_VERSION,
    asOf: day,
    instrumentCount: instrumentN,
    faces,
    decisionDeep: faces.decision?.deepCount ?? null,
    researchApplied: faces.research?.promoteApplied ?? 0,
    executionApplied: faces.execution?.promoteApplied ?? 0,
    integrityOk: integrityFails.length === 0,
    integrityFails,
    counts: {
      decisionFull: faces.decision?.deepCount ?? 0,
      researchPromote: faces.research?.promoteApplied ?? 0,
      executionPromote: faces.execution?.promoteApplied ?? 0,
      integrityFails: integrityFails.length,
    },
    display: integrityFails.length
      ? `算力台账 完整性告警 ${integrityFails.length} · 决策深${faces.decision?.deepCount ?? '—'} · 研究升${faces.research?.promoteApplied ?? 0} · 执行升${faces.execution?.promoteApplied ?? 0}`
      : `算力台账 决策深${faces.decision?.deepCount ?? '—'}/${faces.decision?.deepSlots ?? '—'} · 研究升档${faces.research?.promoteApplied ?? 0} · 执行升档${faces.execution?.promoteApplied ?? 0} · 真配额`,
    note: '禁止三遍全市场深算；升档有上限并落盘',
    dataSource: 'intel-face-compute-ledger',
    method: 'face-slot+promote-cap+integrity',
    trueRationing: true,
  };

  if (persist) {
    try {
      const prior = readLedger();
      const history = Array.isArray(prior?.history) ? prior.history.slice(-13) : [];
      history.push({
        asOf: day,
        decisionDeep: board.decisionDeep,
        researchApplied: board.researchApplied,
        executionApplied: board.executionApplied,
        integrityOk: board.integrityOk,
        savedAt: new Date().toISOString(),
      });
      writeLedger({
        version: FACE_COMPUTE_VERSION,
        asOf: day,
        savedAt: new Date().toISOString(),
        board: {
          display: board.display,
          counts: board.counts,
          faces: Object.fromEntries(
            Object.entries(faces).map(([k, v]) => [
              k,
              {
                deepSlots: v.deepSlots,
                deepCount: v.deepCount,
                promoteWanted: v.promoteWanted,
                promoteApplied: v.promoteApplied,
                maxPromote: v.maxPromote,
                capped: v.capped,
              },
            ])
          ),
          integrityOk: board.integrityOk,
        },
        history,
        dataSource: 'intel-face-compute-ledger',
      });
      board.ledgerSaved = true;
    } catch {
      board.ledgerSaved = false;
    }
  }

  return board;
}

function loadFaceComputeLedger() {
  return readLedger();
}

module.exports = {
  FACE_COMPUTE_VERSION,
  FACE_ATTENTION_POLICY,
  buildFaceComputeBoard,
  loadFaceComputeLedger,
  readLedger,
  writeLedger,
};
