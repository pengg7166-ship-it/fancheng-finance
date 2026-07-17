/**
 * 情报中心 · 检索层（构想 §4）
 * 备忘录不是现场字段堆砌：从 claims-archive / failure-museum / 同构 召回先例。
 * 无命中标「暂无」；禁止编造归档或假相似度。
 */
const { readJsonl, loadFailureMuseum } = require('./intel-memory');

const RETRIEVAL_VERSION = 'v2.89.4-retrieval';

function normId(id) {
  return String(id || '').toLowerCase();
}

function scoreArchiveHit(snap, claim) {
  if (!snap || snap.type !== 'claim_snapshot') return 0;
  let s = 1;
  if (claim?.stateKey && snap.stateKey && snap.stateKey === claim.stateKey) s += 3;
  if (claim?.playbookId && snap.playbookId && snap.playbookId === claim.playbookId) s += 2;
  if (claim?.side && snap.side && snap.side === claim.side) s += 1;
  if (claim?.horizon && snap.horizon && snap.horizon === claim.horizon) s += 1;
  if (claim?.confidence && snap.confidence && snap.confidence === claim.confidence) s += 0.5;
  return s;
}

function classifyMuseumLesson(entry) {
  const trig = String(entry.trigger || entry.reason || '');
  const st = String(entry.status || entry.type || '');
  if (/clock|过期|expired|时效/i.test(trig) || st === 'expired') {
    return { id: 'expired', label: '时效失效' };
  }
  if (/合证|结构|基差|库存|stock.?flow/i.test(trig)) {
    return { id: 'structure_flip', label: '结构翻转证伪' };
  }
  if (/叙事|新闻|shock|surprise/i.test(trig)) {
    return { id: 'narrative_break', label: '叙事证伪' };
  }
  if (/侧|side|方向|改口/i.test(trig)) {
    return { id: 'direction_revision', label: '方向改口' };
  }
  return { id: 'falsified', label: '证伪归档' };
}

function retrieveArchivePrecedents(inst, claim, opts = {}) {
  const limit = opts.archiveLimit || 800;
  const topN = opts.topN || 3;
  const id = normId(inst?.id);
  if (!id) return { hits: [], n: 0, nDisplay: '暂无', available: false };

  const archives = readJsonl('claims-archive.jsonl', limit);
  const scored = [];
  for (let i = archives.length - 1; i >= 0; i -= 1) {
    const a = archives[i];
    if (!a || a.type !== 'claim_snapshot') continue;
    if (normId(a.instrumentId) !== id) continue;
    if (claim?.claimId && a.claimId === claim.claimId) continue;
    const score = scoreArchiveHit(a, claim);
    if (score <= 0) continue;
    scored.push({
      claimId: a.claimId || null,
      statement: a.statement || a.memoHeadline || '暂无陈述',
      status: a.status || null,
      confidence: a.confidence || null,
      side: a.side || null,
      stateKey: a.stateKey || null,
      n: a.n != null ? a.n : null,
      nDisplay: a.nDisplay || (a.n != null ? String(a.n) : '暂无'),
      recordedAt: a.recordedAt || null,
      score,
      match:
        claim?.stateKey && a.stateKey === claim.stateKey
          ? '同 stateKey'
          : claim?.playbookId && a.playbookId === claim.playbookId
            ? '同剧本'
            : claim?.side && a.side === claim.side
              ? '同方向'
              : '同品种',
      dataSource: 'claims-archive',
    });
  }

  scored.sort(
    (a, b) => b.score - a.score || String(b.recordedAt || '').localeCompare(String(a.recordedAt || ''))
  );
  const seen = new Set();
  const hits = [];
  for (const h of scored) {
    const key = h.claimId || `${h.statement}|${h.recordedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(h);
    if (hits.length >= topN) break;
  }

  return {
    hits,
    n: hits.length,
    nDisplay: hits.length ? String(hits.length) : '暂无',
    available: hits.length > 0,
    dataSource: 'claims-archive',
  };
}

function retrieveMuseumPrecedents(inst, claim, opts = {}) {
  const topN = opts.topN || 3;
  const id = normId(inst?.id);
  const museum = loadFailureMuseum(opts.museumLimit || 80);
  const hits = [];

  for (const m of museum) {
    if (!m) continue;
    const sameInst = id && normId(m.instrumentId) === id;
    const sameState = claim?.stateKey && m.stateKey && String(m.stateKey) === String(claim.stateKey);
    if (!sameInst && !sameState) continue;
    const lesson = classifyMuseumLesson(m);
    hits.push({
      claimId: m.claimId || null,
      statement: m.statement || '暂无',
      trigger: m.trigger || null,
      falsifiedAt: m.falsifiedAt || (m.recordedAt || '').slice(0, 10) || null,
      lessonId: lesson.id,
      lessonLabel: lesson.label,
      match: sameInst ? '同品种证伪' : '同 stateKey 证伪',
      dataSource: 'failure-museum',
    });
    if (hits.length >= topN) break;
  }

  const review = opts.museumReview;
  if (review?.warning && hits.length < topN) {
    const w = review.warning;
    const dup = hits.some((h) => h.claimId && h.claimId === w.claimId);
    if (!dup) {
      hits.push({
        claimId: w.claimId || null,
        statement: w.display || w.statement || '邻近警告',
        trigger: w.trigger || null,
        falsifiedAt: w.falsifiedAt || null,
        lessonId: 'warning',
        lessonLabel: '现役邻近警告',
        match: '博物馆警告',
        dataSource: 'failure-museum-board',
      });
    }
  }

  return {
    hits,
    n: hits.length,
    nDisplay: hits.length ? String(hits.length) : '暂无',
    available: hits.length > 0,
    reviewDisplay: review?.display || null,
    dataSource: 'failure-museum',
  };
}

function retrieveIsomorphicPrecedents(inst, opts = {}) {
  const topN = opts.topN || 3;
  const hits = [];

  const iso = opts.isomorphic || inst?.intelCenter?.isomorphicBoard;
  if (iso?.best) {
    hits.push({
      caseId: iso.best.caseId || iso.best.label,
      label: iso.best.label || '同构',
      pathTier: iso.best.pathTier || null,
      pathTierLabel: iso.best.pathTierLabel || null,
      pathNDisplay: iso.best.pathNDisplay || '暂无',
      pathScore: iso.best.pathScore != null ? iso.best.pathScore : null,
      watchSignals: iso.best.watchSignals || [],
      match: iso.best.pathTier === 'strong' ? '路径强同构' : iso.best.pathTierLabel || '同构监视',
      dataSource: 'intel-isomorphic-board',
    });
  }

  const canonical = opts.canonicalCases || inst?.intelCenter?.canonicalCases;
  for (const m of canonical?.matches || []) {
    if (hits.length >= topN) break;
    const label = m.label || m.id;
    if (hits.some((h) => h.label === label || h.caseId === m.id)) continue;
    const path = m.pathSimilarity;
    const pathN = path?.nDisplay || (path?.n != null ? String(path.n) : '暂无');
    hits.push({
      caseId: m.id || label,
      label,
      pathTier:
        path?.available && path.score >= 0.55
          ? 'strong'
          : path?.available && path.score >= 0.25
            ? 'weak'
            : 'theme',
      pathTierLabel: path?.display || (path?.available ? `路径分 ${path.score}` : '主题命中'),
      pathNDisplay: pathN,
      pathScore: path?.available ? path.score : null,
      watchSignals: m.watchSignals || [],
      match: path?.available ? 'canonical+路径' : 'canonical 主题',
      dataSource: 'intel-canonical-cases',
    });
  }

  return {
    hits: hits.slice(0, topN),
    n: Math.min(hits.length, topN),
    nDisplay: hits.length ? String(Math.min(hits.length, topN)) : '暂无',
    available: hits.length > 0,
    dataSource: 'isomorphic+canonical',
  };
}

/**
 * 为备忘录构建检索包
 */
function retrieveForMemo(inst, claim, opts = {}) {
  const archive = retrieveArchivePrecedents(inst, claim, opts);
  const museum = retrieveMuseumPrecedents(inst, claim, opts);
  const isomorphic = retrieveIsomorphicPrecedents(inst, opts);

  const total =
    (archive.available ? archive.n : 0) +
    (museum.available ? museum.n : 0) +
    (isomorphic.available ? isomorphic.n : 0);

  const parts = [];
  if (archive.available) parts.push(`档案 ${archive.n}`);
  if (museum.available) parts.push(`博物馆 ${museum.n}`);
  if (isomorphic.available) parts.push(`同构 ${isomorphic.n}`);

  return {
    version: RETRIEVAL_VERSION,
    available: total > 0,
    archive,
    museum,
    isomorphic,
    totalHits: total,
    nDisplay: total > 0 ? String(total) : '暂无',
    display:
      total > 0
        ? `检索召回 · ${parts.join(' · ')}`
        : '检索 · 暂无先例（档案/博物馆/同构均无命中）',
    note: '仅磁盘真实归档与同构板；无命中不编造',
    dataSource: 'intel-retrieval',
    method: 'archive+museum+isomorphic',
  };
}

function attachRetrievalToMemo(memo, retrieval) {
  if (!memo || memo.available === false) {
    return memo
      ? {
          ...memo,
          retrieval: retrieval || {
            version: RETRIEVAL_VERSION,
            available: false,
            display: '检索 · 暂无',
            nDisplay: '暂无',
            dataSource: 'intel-retrieval',
          },
        }
      : memo;
  }
  return {
    ...memo,
    retrieval,
    method: memo.method ? `${memo.method}+retrieval` : 'minimum-publishable-unit+retrieval',
  };
}

/**
 * Pack 阶段：在 iso/博物馆挂载后刷新各品种检索
 */
function attachRetrievalToInstruments(instruments, opts = {}) {
  return (instruments || []).map((inst) => {
    const ic = inst?.intelCenter;
    if (!ic?.memo?.available && !ic?.primaryClaim) return inst;
    const retrieval = retrieveForMemo(inst, ic.primaryClaim, {
      ...opts,
      canonicalCases: ic.canonicalCases,
      isomorphic: ic.isomorphicBoard,
      museumReview: ic.museumReview,
    });
    const memo = attachRetrievalToMemo(ic.memo, retrieval);
    return {
      ...inst,
      intelCenter: {
        ...ic,
        memo,
        retrieval,
      },
    };
  });
}

module.exports = {
  RETRIEVAL_VERSION,
  retrieveForMemo,
  retrieveArchivePrecedents,
  retrieveMuseumPrecedents,
  retrieveIsomorphicPrecedents,
  attachRetrievalToMemo,
  attachRetrievalToInstruments,
  scoreArchiveHit,
};
