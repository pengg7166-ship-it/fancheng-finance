/**
 * 情报中心 · Evidence DSL 全链路审计（构想 §36）
 * 扫描命题证据：类型/方向/源/n/新鲜度；缺反对、无 n、假填充嫌疑 → 诚实标出。
 * 禁止用审计本身生成假证据。
 */
const { EVIDENCE_VERSION, EVIDENCE_TYPES } = require('./intel-evidence-dsl');

const EVIDENCE_AUDIT_VERSION = 'v2.82.0-evidence-audit';

const FAKE_PATTERNS = [/generateFake/i, /\bmock\b/i, /\bdummy\b/i, /synthetic/i, /占位价/];

function auditOneEvidence(ev, ctx = {}) {
  const issues = [];
  if (!ev) {
    return { ok: false, issues: ['空证据'], severity: 'high' };
  }
  if (!ev.evidenceType || !EVIDENCE_TYPES.includes(ev.evidenceType)) {
    issues.push('evidenceType 非法或缺失');
  }
  if (!['for', 'against', 'neutral'].includes(ev.direction)) {
    issues.push('direction 非法');
  }
  if (!ev.dataSource || ev.dataSource === 'missing') {
    issues.push('dataSource 缺失');
  }
  if (ev.n == null && (!ev.nDisplay || ev.nDisplay === '暂无')) {
    issues.push('n 暂无');
  }
  if (!ev.summary || ev.summary === '暂无') {
    issues.push('summary 暂无');
  }
  const blob = `${ev.summary || ''}|${ev.dataSource || ''}|${JSON.stringify(ev.links || [])}`;
  for (const re of FAKE_PATTERNS) {
    if (re.test(blob)) {
      issues.push('疑似假数据标记');
      break;
    }
  }
  if (ev.freshness?.label === '严重滞后' || (ev.freshness?.lagDays != null && ev.freshness.lagDays > 3)) {
    issues.push('新鲜度严重滞后');
  }
  const high = issues.some((i) => /假数据|非法|缺失/.test(i) && !/n 暂无|summary/.test(i));
  return {
    ok: issues.length === 0,
    issues,
    severity: issues.some((i) => /假数据/.test(i))
      ? 'critical'
      : high
        ? 'high'
        : issues.length
          ? 'medium'
          : 'ok',
    evidenceType: ev.evidenceType,
    direction: ev.direction,
    nDisplay: ev.nDisplay || (ev.n != null ? String(ev.n) : '暂无'),
    dataSource: ev.dataSource || '暂无',
    claimId: ev.claimId || ctx.claimId || null,
  };
}

function auditInstrumentEvidence(inst) {
  const claim = inst?.intelCenter?.primaryClaim;
  if (!claim?.claimId) {
    return {
      instrumentId: inst?.id,
      instrumentName: inst?.name,
      available: false,
      reason: '无主命题',
      forCount: 0,
      againstCount: 0,
      issues: [],
    };
  }

  const forList = claim.evidenceFor || [];
  const againstList = claim.evidenceAgainst || [];
  const all = [...forList, ...againstList];
  const audits = all.map((e) => auditOneEvidence(e, { claimId: claim.claimId }));
  const issues = [];

  if (['active', 'watch'].includes(claim.status) && againstList.length < 1) {
    issues.push({
      id: 'missing_against',
      label: '缺反对证据',
      severity: 'high',
      detail: 'active/watch 命题强制至少 1 条 against',
    });
  }
  if (forList.length < 1 && ['active', 'watch'].includes(claim.status)) {
    issues.push({
      id: 'missing_for',
      label: '缺支撑证据',
      severity: 'high',
      detail: 'active/watch 命题缺 for',
    });
  }

  const noN = audits.filter((a) => (a.issues || []).includes('n 暂无')).length;
  const fake = audits.filter((a) => a.severity === 'critical');
  const badType = audits.filter((a) => (a.issues || []).some((i) => /evidenceType/.test(i)));

  if (fake.length) {
    issues.push({
      id: 'fake_suspect',
      label: '疑似假数据',
      severity: 'critical',
      detail: `${fake.length} 条证据命中假数据模式`,
      nDisplay: String(fake.length),
    });
  }
  if (noN === all.length && all.length > 0) {
    issues.push({
      id: 'all_n_missing',
      label: '证据全无 n',
      severity: 'medium',
      detail: `${all.length} 条均无样本量`,
      nDisplay: String(all.length),
    });
  }
  if (badType.length) {
    issues.push({
      id: 'bad_type',
      label: '类型非法',
      severity: 'high',
      detail: `${badType.length} 条`,
    });
  }

  const byType = {};
  for (const e of all) {
    const t = e.evidenceType || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  }

  return {
    instrumentId: inst.id,
    instrumentName: inst.name || inst.id,
    available: true,
    claimId: claim.claimId,
    claimStatus: claim.status,
    forCount: forList.length,
    againstCount: againstList.length,
    evidenceCount: all.length,
    noNCount: noN,
    byType,
    audits: audits.slice(0, 12),
    issues,
    ok: issues.filter((i) => i.severity === 'critical' || i.severity === 'high').length === 0,
    display:
      issues.length === 0
        ? `${inst.name || inst.id} · 证据 for${forList.length}/against${againstList.length} · 合规`
        : `${inst.name || inst.id} · 证据问题 ${issues.length} · for${forList.length}/against${againstList.length}`,
    dataSource: 'intel-evidence-audit',
  };
}

/**
 * @param {object[]} instruments
 */
function buildEvidenceAuditBoard(instruments, opts = {}) {
  const rows = [];
  const questions = [];
  const typeCoverage = {};
  for (const t of EVIDENCE_TYPES) typeCoverage[t] = 0;

  let critical = 0;
  let missingAgainst = 0;
  let withEvidence = 0;
  let totalEvidence = 0;
  let noNEvidence = 0;

  for (const inst of instruments || []) {
    const row = auditInstrumentEvidence(inst);
    if (!row.available) continue;
    withEvidence += 1;
    totalEvidence += row.evidenceCount;
    noNEvidence += row.noNCount || 0;
    for (const [t, n] of Object.entries(row.byType || {})) {
      typeCoverage[t] = (typeCoverage[t] || 0) + n;
    }
    if (row.issues?.length) {
      rows.push(row);
      if (row.issues.some((i) => i.severity === 'critical')) critical += 1;
      if (row.issues.some((i) => i.id === 'missing_against')) {
        missingAgainst += 1;
        questions.push({
          priority: 'P1',
          score: 42,
          instrumentId: row.instrumentId,
          instrumentName: row.instrumentName,
          question: `${row.instrumentName}：主命题缺反对证据 — 红队/合证对侧是否可补？`,
          reasons: ['Evidence DSL 审计', '缺 against'],
          dataSource: 'intel-evidence-audit',
        });
      }
      if (row.issues.some((i) => i.id === 'fake_suspect')) {
        questions.push({
          priority: 'P0',
          score: 95,
          instrumentId: row.instrumentId,
          instrumentName: row.instrumentName,
          question: `${row.instrumentName}：证据链疑似假数据标记 — 立即下架并追查 dataSource`,
          reasons: ['Evidence DSL 审计', 'critical'],
          dataSource: 'intel-evidence-audit',
        });
      }
      if (row.issues.some((i) => i.id === 'all_n_missing')) {
        questions.push({
          priority: 'P3',
          score: 18,
          instrumentId: row.instrumentId,
          instrumentName: row.instrumentName,
          question: `${row.instrumentName}：证据全无 n — 能否挂上真实样本量？`,
          reasons: ['Evidence DSL 审计', 'n 暂无'],
          dataSource: 'intel-evidence-audit',
        });
      }
    }
  }

  rows.sort((a, b) => {
    const sev = { critical: 3, high: 2, medium: 1 };
    const sa = Math.max(0, ...(a.issues || []).map((i) => sev[i.severity] || 0));
    const sb = Math.max(0, ...(b.issues || []).map((i) => sev[i.severity] || 0));
    return sb - sa;
  });

  const typesPresent = Object.entries(typeCoverage).filter(([, n]) => n > 0).length;

  return {
    version: EVIDENCE_AUDIT_VERSION,
    evidenceDslVersion: EVIDENCE_VERSION,
    asOf: opts.asOf || null,
    rows: rows.slice(0, 24),
    top: rows.slice(0, 12),
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 12),
    typeCoverage,
    typesPresent,
    typesTotal: EVIDENCE_TYPES.length,
    counts: {
      instrumentsAudited: withEvidence,
      problemInstruments: rows.length,
      critical,
      missingAgainst,
      totalEvidence,
      noNEvidence,
      typesPresent,
    },
    display: critical
      ? `证据审计 critical ${critical} · 缺反对 ${missingAgainst} · 问题品种 ${rows.length}`
      : missingAgainst
        ? `证据审计 缺反对 ${missingAgainst} · 问题 ${rows.length} · 类型覆盖 ${typesPresent}/${EVIDENCE_TYPES.length}`
        : rows.length
          ? `证据审计 问题 ${rows.length} · 证据条 ${totalEvidence} · 类型 ${typesPresent}/${EVIDENCE_TYPES.length}`
          : `证据审计 合规 · 已扫 ${withEvidence} 品种 · 类型 ${typesPresent}/${EVIDENCE_TYPES.length}`,
    note: 'n 缺失标暂无；假数据模式 critical 阻断叙事',
    dataSource: 'intel-evidence-audit',
    method: 'claim-evidence-dsl-scan',
  };
}

function enrichQuestionQueueWithEvidenceAudit(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P2',
      priorityLabel: '证据审计',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: q.priority === 'P0' ? 'interrupt' : 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    evidenceAuditInjected: extra.length,
    version: `${queue.version || ''}+evidence-audit`,
  };
}

module.exports = {
  EVIDENCE_AUDIT_VERSION,
  auditOneEvidence,
  auditInstrumentEvidence,
  buildEvidenceAuditBoard,
  enrichQuestionQueueWithEvidenceAudit,
};
