/**
 * 情报中心 · 备忘录导出 / 对外简报单元（构想 §75 / §63②）
 * 硬模板 → markdown/plain；门禁未过标「不可对外强结论」，禁止编造字段填空。
 */
const MEMO_EXPORT_VERSION = 'v2.89.4-memo-export';

function line(s) {
  return s == null || s === '' ? '暂无' : String(s);
}

function formatSupport(list) {
  if (!list?.length) return ['- 暂无'];
  return list.map((s, i) => {
    const n = s.n && s.n !== '暂无' ? ` · n=${s.n}` : '';
    const src = s.dataSource ? ` 〔${s.dataSource}〕` : '';
    return `- (${i + 1}) ${line(s.summary)}${n}${src}`;
  });
}

function formatOppose(list) {
  if (!list?.length) return ['- 暂无反对 · 结论脆弱'];
  return list.map((s) => {
    const src = s.dataSource ? ` 〔${s.dataSource}〕` : '';
    return `- ${line(s.summary)}${src}`;
  });
}

function formatUnknown(um) {
  if (!um) return ['- 暂无'];
  const gaps = um.gaps || [];
  if (!gaps.length) return [`- ${line(um.display)}`];
  return gaps.slice(0, 6).map((g) => {
    const path = g.shortestPath || g.remedy || '暂无';
    return `- ${line(g.label)} · ${line(g.impact)} · 补齐 ${path}`;
  });
}

function formatRetrieval(ret) {
  if (!ret) return ['- 检索暂无'];
  if (!ret.available) return [`- ${line(ret.display || '暂无先例')}`];
  const lines = [`- ${line(ret.display)} · 命中 n=${line(ret.nDisplay)}`];
  for (const h of ret.archive?.hits || []) {
    lines.push(
      `- 档案 · ${line(h.match)} · ${line(h.statement).slice(0, 64)} · n=${line(h.nDisplay)} 〔claims-archive〕`
    );
  }
  for (const h of ret.museum?.hits || []) {
    lines.push(
      `- 博物馆 · ${line(h.lessonLabel)} · ${line(h.statement).slice(0, 64)} 〔failure-museum〕`
    );
  }
  for (const h of ret.isomorphic?.hits || []) {
    lines.push(
      `- 同构 · ${line(h.label)} · ${line(h.pathTierLabel || h.match)} · 路径n=${line(h.pathNDisplay)}`
    );
  }
  return lines.length > 1 ? lines : [`- ${line(ret.display)}`];
}

/**
 * 从品种 intelCenter 生成最小可发布导出单元
 */
function exportMemoUnit(inst, opts = {}) {
  const ic = inst?.intelCenter;
  const memo = ic?.memo;
  const asOf = opts.asOf || null;
  const name = inst?.name || inst?.id || '—';
  const id = inst?.id || null;

  if (!memo?.available) {
    return {
      version: MEMO_EXPORT_VERSION,
      available: false,
      instrumentId: id,
      instrumentName: name,
      reason: memo?.reason || ic?.reason || 'no_memo',
      publishable: false,
      markdown: `# ${name} · 决策备忘录\n\n暂无 · ${memo?.reason || '命题未构建'}\n`,
      plain: `${name} 决策备忘录：暂无`,
      honesty: ['备忘录不可用 · 禁止对外强结论'],
      dataSource: 'intel-memo-export',
      method: 'hard-template-export',
    };
  }

  const publishable = memo.publishable === true;
  const honesty = [];
  if (!publishable) honesty.push('门禁未过 · 仅供内部研判，不可对外强结论');
  if (!(memo.oppose || []).length) honesty.push('缺反对证据 · 结论脆弱');
  if (!memo.n || memo.n === '暂无') honesty.push('样本量 n 暂无');
  if (ic?.confidenceBrakeForced) honesty.push('自信刹车已降档');
  if (ic?.primaryClaim?.dissentDebt) honesty.push('红队反对债务未清');
  if (memo.claimStatus === 'falsified') honesty.push('命题已证伪');
  if (memo.claimStatus === 'falsifying') honesty.push('证伪进行中');

  const triggers = (memo.triggers || []).length
    ? (memo.triggers || []).map((t) => `- ${line(t)}`)
    : ['- 暂无'];
  const action = memo.suggestedAction;
  const choiceLine = memo.choiceSet?.display || action?.label || '暂无';

  const md = [
    `# ${name} · 决策备忘录`,
    asOf ? `日期：${asOf}` : null,
    `品种：${id || '—'} · claim ${memo.claimId || '—'} · issue ${memo.issueId || '—'}`,
    `发布：${publishable ? '可发布（门禁通过）' : '不可对外强结论（门禁未过）'}`,
    '',
    '## 主判断',
    line(memo.headline),
    line(memo.oneLiner),
    '',
    '## 三支撑',
    ...formatSupport(memo.support),
    '',
    '## 一反对',
    ...formatOppose(memo.oppose),
    '',
    '## 检索召回（档案·博物馆·同构）',
    ...formatRetrieval(memo.retrieval),
    '',
    '## 证伪触发器',
    ...triggers,
    memo.validUntil ? `有效期：${memo.validUntil}` : '有效期：暂无',
    '',
    '## Unknown Map',
    ...formatUnknown(memo.unknownMap),
    '',
    '## 建议动作 / 选择集',
    `- ${line(choiceLine)}`,
    action?.condition ? `- 条件：${action.condition}` : null,
    action?.why ? `- 理由：${action.why}` : null,
    memo.n ? `- 样本 n：${memo.n}` : '- 样本 n：暂无',
    '',
    '## 诚实声明',
    ...(honesty.length ? honesty.map((h) => `- ${h}`) : ['- 门禁通过 · 仍须带 n 与反对证据阅读']),
    '',
    `_导出 ${MEMO_EXPORT_VERSION} · 源 ${memo.dataSource || 'intel-memo'}_`,
  ]
    .filter((x) => x != null)
    .join('\n');

  const plain = [
    `${name}｜${line(memo.headline)}`,
    line(memo.oneLiner),
    `支撑：${(memo.support || []).map((s) => s.summary).filter(Boolean).join('；') || '暂无'}`,
    `反对：${(memo.oppose || []).map((s) => s.summary).filter(Boolean).join('；') || '暂无'}`,
    `检索：${memo.retrieval?.display || '暂无'} · n=${memo.retrieval?.nDisplay || '暂无'}`,
    `触发：${(memo.triggers || []).join('；') || '暂无'}`,
    `动作：${action?.label || '暂无'}`,
    `n=${memo.n || '暂无'} · ${publishable ? '可发布' : '不可强结论'}`,
    honesty.length ? `注意：${honesty.join('；')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    version: MEMO_EXPORT_VERSION,
    available: true,
    instrumentId: id,
    instrumentName: name,
    claimId: memo.claimId || null,
    issueId: memo.issueId || null,
    asOf,
    publishable,
    headline: memo.headline,
    oneLiner: memo.oneLiner,
    markdown: md,
    plain,
    honesty,
    nDisplay: memo.n || '暂无',
    claimStatus: memo.claimStatus || null,
    dataSource: 'intel-memo-export',
    method: 'hard-template-export',
  };
}

function buildExternalBriefBoard(instruments, opts = {}) {
  const asOf = opts.asOf || null;
  const units = [];
  for (const inst of instruments || []) {
    const memo = inst?.intelCenter?.memo;
    if (!memo?.available) continue;
    const unit = exportMemoUnit(inst, { asOf });
    units.push({
      instrumentId: unit.instrumentId,
      instrumentName: unit.instrumentName,
      claimId: unit.claimId,
      publishable: unit.publishable,
      headline: unit.headline,
      oneLiner: unit.oneLiner,
      nDisplay: unit.nDisplay,
      honestyCount: (unit.honesty || []).length,
      markdown: unit.markdown,
      plain: unit.plain,
      honesty: unit.honesty,
      display: `${unit.instrumentName} · ${unit.publishable ? '可发布' : '内部'} · ${String(unit.headline || '').slice(0, 36)}`,
    });
  }

  const publishable = units.filter((u) => u.publishable);
  const internal = units.filter((u) => !u.publishable);
  // 优先可发布，再按打断/P0 近似：保留前序（instruments 已是注意力排序）
  const top = [...publishable, ...internal].slice(0, opts.limit || 8);

  return {
    version: MEMO_EXPORT_VERSION,
    asOf,
    counts: {
      withMemo: units.length,
      publishable: publishable.length,
      internalOnly: internal.length,
    },
    top,
    questions: internal.slice(0, 4).map((u) => ({
      priority: 'P2',
      score: 26,
      instrumentId: u.instrumentId,
      instrumentName: u.instrumentName,
      question: `${u.instrumentName}：备忘录门禁未过 — ${(u.honesty || [])[0] || '补反对/触发/n'}？`,
      reasons: ['对外简报', 'gate'],
      dataSource: 'intel-memo-export',
    })),
    display: units.length
      ? `对外简报 可发布 ${publishable.length}/${units.length} · 导出单元 ${top.length}`
      : '对外简报 暂无备忘录',
    note: '导出不编造字段；门禁未过必须带诚实声明',
    dataSource: 'intel-memo-export',
    method: 'pack-level-export-board',
  };
}

function enrichQuestionQueueWithMemoExport(queue, board) {
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
      priorityLabel: '对外简报',
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
    memoExportInjected: extra.length,
    version: `${queue.version || ''}+memoexport`,
  };
}

module.exports = {
  MEMO_EXPORT_VERSION,
  exportMemoUnit,
  buildExternalBriefBoard,
  enrichQuestionQueueWithMemoExport,
};
