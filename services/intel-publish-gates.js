/**
 * 情报中心 · 发布门禁
 * 工程 accept ≠ 对外强结论；Top5/Interrupt/深报走不同档位。
 * v2.66：并入分析师否决/冻结/操纵风险/新闻硬度。
 */
const { CONFIDENCE_LEVELS } = require('./intel-claim-library');
const { manipulationGateChecks } = require('./intel-anti-manipulation');

const GATE_VERSION = 'v2.79.0-gates-dual';

const GATE_PROFILES = {
  top5: {
    minLanes: 3,
    minEvidenceFor: 2,
    requireDissent: true,
    requireTriggers: true,
    minConfidence: 'weak',
    requireFresh: true,
    requireN: true,
    minN: 15,
  },
  interrupt: {
    minLanes: 4,
    minEvidenceFor: 2,
    requireDissent: true,
    requireTriggers: true,
    minConfidence: 'weak',
    requireFresh: true,
    requireN: true,
    minN: 20,
  },
  deepBrief: {
    minLanes: 3,
    minEvidenceFor: 1,
    requireDissent: true,
    requireTriggers: false,
    minConfidence: 'weak',
    requireFresh: false,
    requireN: false,
  },
  memo: {
    minLanes: 2,
    minEvidenceFor: 1,
    requireDissent: true,
    requireTriggers: true,
    minConfidence: 'unknown',
    requireFresh: false,
    requireN: false,
  },
};

function confidenceRank(c) {
  const order = [
    CONFIDENCE_LEVELS.unknown,
    CONFIDENCE_LEVELS.falsifying,
    CONFIDENCE_LEVELS.divided,
    CONFIDENCE_LEVELS.weak,
    CONFIDENCE_LEVELS.strong,
  ];
  return order.indexOf(c);
}

function evaluatePublishGate(inst, claim, clock, pricingState, profileName = 'memo', extra = {}) {
  const profile = GATE_PROFILES[profileName] || GATE_PROFILES.memo;
  const checks = [];
  let pass = true;
  let cappedConfidence = null;

  const lanes = inst?.dataQuality ?? 0;
  checks.push({
    id: 'lanes',
    label: '数据源路数',
    pass: lanes >= profile.minLanes,
    value: `${lanes}/9`,
    required: `≥${profile.minLanes}`,
  });
  if (!checks[checks.length - 1].pass) pass = false;

  const evFor = claim?.evidenceFor?.length ?? 0;
  checks.push({
    id: 'evidence_for',
    label: '支撑证据',
    pass: evFor >= profile.minEvidenceFor,
    value: String(evFor),
    required: `≥${profile.minEvidenceFor}`,
  });
  if (!checks[checks.length - 1].pass) pass = false;

  const evAgainst = claim?.evidenceAgainst?.length ?? 0;
  if (profile.requireDissent) {
    checks.push({
      id: 'dissent',
      label: '反对证据',
      pass: evAgainst >= 1,
      value: evAgainst ? String(evAgainst) : '暂无',
      required: '≥1',
    });
    if (!checks[checks.length - 1].pass) pass = false;
  }

  const trig = claim?.triggers?.length ?? 0;
  if (profile.requireTriggers) {
    checks.push({
      id: 'triggers',
      label: '证伪触发器',
      pass: trig >= 1 && Boolean(claim?.validUntil || clock?.nextCheckpoint),
      value: trig ? String(trig) : '暂无',
      required: '≥1+有效期',
    });
    if (!checks[checks.length - 1].pass) pass = false;
  }

  const confOk =
    confidenceRank(claim?.confidence) >=
    confidenceRank(profile.minConfidence === 'weak' ? CONFIDENCE_LEVELS.weak : CONFIDENCE_LEVELS.unknown);
  checks.push({
    id: 'confidence',
    label: '置信档位',
    pass: confOk,
    value: claim?.confidence || '暂无',
    required: profile.minConfidence,
  });
  if (!confOk) pass = false;

  if (profile.requireFresh) {
    const lag = inst?.calendarStaleness?.lagDays ?? inst?.calendarStaleness?.daysBehind ?? 0;
    const freshOk = lag <= 1 || inst?.calendarStaleness == null;
    checks.push({
      id: 'freshness',
      label: '数据新鲜度',
      pass: freshOk,
      value: lag != null ? `滞后${lag}日` : '待校验',
      required: '≤1日或未知',
    });
    if (!freshOk) pass = false;
  }

  if (profile.requireN) {
    const minN = profile.minN ?? 20;
    const nOk = claim?.n != null && claim.n >= minN;
    checks.push({
      id: 'n',
      label: '历史样本 n',
      pass: nOk,
      value: claim?.n != null ? claim.nDisplay || String(claim.n) : '暂无',
      required: `≥${minN}`,
    });
    if (!nOk) pass = false;
  }

  const consistencyOk = !(inst?.insufficientData && profileName === 'interrupt');
  checks.push({
    id: 'consistency',
    label: '一致性',
    pass: consistencyOk,
    value: inst?.insufficientData ? '数据不足' : 'ok',
    required: '非不足',
  });
  if (!consistencyOk) pass = false;

  if (claim?.status === 'falsified' || claim?.status === 'expired' || claim?.publishBlocked) {
    if (profileName === 'top5' || profileName === 'interrupt') {
      checks.push({
        id: 'not_falsified',
        label: '命题未证伪',
        pass: false,
        value: claim.status,
        required: '非 falsified/expired',
      });
      pass = false;
    }
  }

  if (claim?.status === 'falsifying' && profileName === 'interrupt') {
    checks.push({
      id: 'not_falsifying',
      label: '非证伪进行中',
      pass: false,
      value: 'falsifying',
      required: 'active/watch',
    });
    pass = false;
  }

  // 内外叙事分裂：禁止 Interrupt；Top5 仅置信封顶「叙事分歧」（不硬阻断）
  const dual =
    extra.dualNarrative ||
    inst?.dualNarrative ||
    inst?.intelCenter?.dualNarrative ||
    inst?.factors?.dualNarrative ||
    null;
  if (dual?.regime === 'split') {
    const interruptBlock = profileName === 'interrupt';
    checks.push({
      id: 'dual_not_split',
      label: '内外非分裂',
      pass: !interruptBlock,
      value: dual.regimeLabel || 'split',
      required: interruptBlock ? '共振或单边确认' : profileName === 'top5' ? 'Top5置信封顶' : '—',
      nDisplay: dual.external?.nDisplay || dual.domestic?.nDisplay || '暂无',
    });
    if (interruptBlock) pass = false;
    if (!cappedConfidence || confidenceRank('叙事分歧') < confidenceRank(cappedConfidence)) {
      cappedConfidence = '叙事分歧';
    }
  }

  const analyst = extra.analyst || inst?.intelCenter?.analyst || null;
  const signals = extra.antiManipulation || inst?.intelCenter?.antiManipulation || null;
  const manip = manipulationGateChecks(claim, analyst, signals, profileName);
  for (const c of manip.checks) {
    checks.push(c);
    if (!c.pass) pass = false;
  }
  if (manip.maxConfidence) cappedConfidence = manip.maxConfidence;

  let maxConfidence = pass ? claim?.confidence || CONFIDENCE_LEVELS.weak : CONFIDENCE_LEVELS.unknown;
  if (cappedConfidence && confidenceRank(cappedConfidence) < confidenceRank(maxConfidence)) {
    maxConfidence = cappedConfidence;
  }

  return {
    version: GATE_VERSION,
    profile: profileName,
    pass,
    checks,
    maxConfidence,
    blockedReasons: checks.filter((c) => !c.pass).map((c) => c.label),
    dataSource: 'intel-publish-gates',
  };
}

function evaluateAllGates(inst, claim, clock, pricingState, extra = {}) {
  const gates = {};
  for (const name of Object.keys(GATE_PROFILES)) {
    gates[name] = evaluatePublishGate(inst, claim, clock, pricingState, name, extra);
  }
  return gates;
}

module.exports = {
  GATE_VERSION,
  GATE_PROFILES,
  evaluatePublishGate,
  evaluateAllGates,
};
