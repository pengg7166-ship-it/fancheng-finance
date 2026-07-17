/**
 * 情报中心 · 红队强制反对入库闭环（构想 §红队 / Evidence DSL）
 * 红队论据 → Evidence DSL against 写入命题；不可审计则标债务，禁止编造反对。
 */
const { buildEvidence } = require('./intel-evidence-dsl');
const { appendJsonl, readJsonl } = require('./intel-memory');
const {
  RED_TEAM_VERSION,
  evaluateRedTeam,
  applyRedTeamToClaim,
  buildRedTeamArguments,
} = require('./intel-red-team');

const RED_LOOP_VERSION = 'v2.83.0-redteam-ingest';
const ARCHIVE_FILE = 'red-team-archive.jsonl';

function argToEvidence(arg, claimId) {
  if (!arg?.summary) return null;
  const typeMap = {
    kernel_dissent: 'regime',
    joint_contradiction: 'warehouse_joint',
    capital_contradiction: 'capital',
    historical_statekey: 'regime',
    failure_museum: 'regime',
    priced_in: 'expectation_gap',
    dual_split: 'foreign',
    horizon_conflict: 'regime',
  };
  const evidenceType = typeMap[arg.type] || 'regime';
  return buildEvidence({
    claimId,
    evidenceType,
    direction: 'against',
    strength: arg.strength ?? null,
    freshness: { score: 0.8, label: '红队当日', asOf: new Date().toISOString().slice(0, 10) },
    reliability: {
      score: arg.n != null && arg.n >= 20 ? 0.75 : 0.55,
      tier: arg.n != null && arg.n >= 20 ? 'B' : 'C',
      label: arg.n != null ? '红队+样本' : '红队启发式',
    },
    n: arg.n ?? null,
    summary: `[红队] ${arg.summary}`,
    dataSource: arg.dataSource || 'intel-red-team',
    links: [{ type: 'red_team', field: arg.type || 'argument' }],
  });
}

function evidenceKey(ev) {
  return `${ev?.evidenceType || ''}|${String(ev?.summary || '').slice(0, 48)}`;
}

/**
 * 将红队论据注入 claim.evidenceAgainst；返回更新后的 claim + 注入统计
 */
function ingestRedTeamDissent(claim, redTeam, opts = {}) {
  if (!claim) {
    return { claim, ingested: 0, alreadyHadAgainst: 0, dissentDebt: true, reason: 'no_claim' };
  }
  const existing = [...(claim.evidenceAgainst || [])];
  const before = existing.length;
  const keys = new Set(existing.map(evidenceKey));
  let ingested = 0;

  for (const arg of redTeam?.arguments || []) {
    const ev = argToEvidence(arg, claim.claimId);
    if (!ev) continue;
    const k = evidenceKey(ev);
    if (keys.has(k)) continue;
    keys.add(k);
    existing.push(ev);
    ingested += 1;
  }

  // 仍无 against：诚实债务，不编造反对句
  const dissentDebt = existing.length === 0;
  let next = {
    ...claim,
    evidenceAgainst: existing.slice(0, 6),
    redTeamIngested: ingested,
    redTeamAgainstCount: existing.length,
    dissentDebt,
  };

  if (redTeam?.downgradeTo) {
    next = applyRedTeamToClaim(next, redTeam);
  }

  // active 且仍无 against → 强制 watch（过程正确优先）
  if (dissentDebt && ['active', 'watch'].includes(next.status)) {
    next = {
      ...next,
      status: 'watch',
      confidence: next.confidence === '强结构' || next.confidence === '弱结构' ? '叙事分歧' : next.confidence,
      dissentDebtNote: '红队未产出可审计反对 · 禁止强结论',
    };
  }

  if (opts.persist && (ingested > 0 || redTeam?.forceDowngrade)) {
    try {
      appendJsonl(ARCHIVE_FILE, {
        type: 'red_team_ingest',
        claimId: claim.claimId,
        instrumentId: opts.instrumentId || null,
        ingested,
        againstAfter: existing.length,
        opposingStrength: redTeam?.opposingStrength ?? null,
        forceDowngrade: Boolean(redTeam?.forceDowngrade),
        dissentDebt,
        version: RED_LOOP_VERSION,
      });
    } catch {
      // ignore
    }
  }

  return {
    claim: next,
    ingested,
    alreadyHadAgainst: before,
    againstAfter: existing.length,
    dissentDebt,
    version: RED_LOOP_VERSION,
  };
}

function buildRedTeamBoard(instruments, opts = {}) {
  const rows = [];
  const questions = [];
  let ingestedTotal = 0;
  let debtCount = 0;
  let forceDowngrade = 0;

  for (const inst of instruments || []) {
    const rt = inst.intelCenter?.redTeam;
    const claim = inst.intelCenter?.primaryClaim;
    if (!rt && !claim) continue;
    const againstN = claim?.evidenceAgainst?.length || 0;
    const ingested = claim?.redTeamIngested || 0;
    const debt = Boolean(claim?.dissentDebt);
    if (ingested) ingestedTotal += ingested;
    if (debt) debtCount += 1;
    if (rt?.forceDowngrade) forceDowngrade += 1;

    if (!rt?.available && !debt && againstN > 0) continue;

    const row = {
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
      opposingStrength: rt?.opposingStrength ?? null,
      forceDowngrade: Boolean(rt?.forceDowngrade),
      ingested,
      againstCount: againstN,
      dissentDebt: debt,
      display: debt
        ? `${inst.name || inst.id} · 反对债务 · 红队未入库`
        : `${inst.name || inst.id} · 红队${rt?.opposingStrength != null ? ` ${(rt.opposingStrength * 100).toFixed(0)}%` : ''} · against ${againstN}${ingested ? ` · 入库+${ingested}` : ''}`,
      topArg: (rt?.arguments || [])[0]?.summary || null,
      dataSource: 'intel-red-team-loop',
    };
    rows.push(row);

    if (debt) {
      questions.push({
        priority: 'P1',
        score: 44,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：红队未产出可审计反对 — 合证/资金/历史命中能否补 against？`,
        reasons: ['红队入库闭环', 'dissentDebt'],
        dataSource: 'intel-red-team-loop',
      });
    } else if (rt?.forceDowngrade) {
      questions.push({
        priority: 'P2',
        score: 36,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：红队强制降档 — ${row.topArg || rt.display}？`,
        reasons: ['红队入库闭环', 'forceDowngrade'],
        dataSource: 'intel-red-team-loop',
      });
    }
  }

  rows.sort((a, b) => {
    if (a.dissentDebt !== b.dissentDebt) return a.dissentDebt ? -1 : 1;
    return (b.opposingStrength || 0) - (a.opposingStrength || 0);
  });

  const recent = readJsonl(ARCHIVE_FILE, 30).reverse().slice(0, 10);

  return {
    version: RED_LOOP_VERSION,
    redTeamVersion: RED_TEAM_VERSION,
    asOf: opts.asOf || null,
    rows: rows.slice(0, 20),
    top: rows.slice(0, 10),
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 10),
    recentArchive: recent,
    counts: {
      rows: rows.length,
      ingestedTotal,
      dissentDebt: debtCount,
      forceDowngrade,
    },
    display: debtCount
      ? `红队闭环 反对债务 ${debtCount} · 入库 ${ingestedTotal} · 强制降档 ${forceDowngrade}`
      : ingestedTotal || forceDowngrade
        ? `红队闭环 入库 ${ingestedTotal} · 强制降档 ${forceDowngrade}`
        : '红队闭环 暂无显著反对注入',
    note: '反对须可审计入库；找不到则标债务，禁止编造 against',
    dataSource: 'intel-red-team-loop',
    method: 'redteam-arg→evidence-dsl-against',
  };
}

function enrichQuestionQueueWithRedTeam(queue, board) {
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
      priority: q.priority || 'P1',
      priorityLabel: '红队闭环',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    redTeamInjected: extra.length,
    version: `${queue.version || ''}+redteam`,
  };
}

module.exports = {
  RED_LOOP_VERSION,
  argToEvidence,
  ingestRedTeamDissent,
  buildRedTeamBoard,
  enrichQuestionQueueWithRedTeam,
  evaluateRedTeam,
  buildRedTeamArguments,
};
