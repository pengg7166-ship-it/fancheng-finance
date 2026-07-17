/**
 * 情报中心 · 证据温度三轴（构想 §72）
 * 温度(fresh) / 硬度(reliable) / 贴合(relevant) 分轴展示，禁止混成单一强度分。
 * 缺失标「暂无」；热而软、硬而冷、贴合假等模式可审计。
 */
const TRIAD_VERSION = 'v2.89.19-evidence-triad';

const MECHANISM_AFFINITY = {
  warehouse_joint: ['inventory', 'oi', 'warehouse_joint', 'capital', 'regime'],
  inventory: ['inventory', 'warehouse_joint', 'oi'],
  basis: ['basis', 'term_structure', 'foreign'],
  term_structure: ['term_structure', 'basis'],
  capital: ['capital', 'oi', 'warehouse_joint'],
  news: ['news', 'macro', 'policy', 'expectation_gap'],
  philosophy: ['philosophy', 'regime', 'expectation_gap'],
  foreign: ['foreign', 'basis', 'macro'],
  price: ['price', 'technical', 'expectation_gap'],
  technical: ['technical', 'price'],
  macro: ['macro', 'policy', 'news'],
  policy: ['policy', 'macro', 'news'],
  oi: ['oi', 'capital', 'warehouse_joint'],
  regime: ['regime', 'warehouse_joint', 'philosophy'],
  expectation_gap: ['expectation_gap', 'price', 'news'],
};

function axisDisplay(score, label, pending) {
  if (pending || score == null || !Number.isFinite(Number(score))) {
    return { score: null, label: label || '暂无', display: '暂无' };
  }
  const s = Math.max(0, Math.min(1, Number(score)));
  return {
    score: +s.toFixed(3),
    label: label || (s >= 0.75 ? '高' : s >= 0.5 ? '中' : s >= 0.3 ? '低' : '弱'),
    display: `${label || '轴'} ${s.toFixed(2)}`,
  };
}

function scoreTemperature(ev) {
  const fresh = ev?.freshness;
  if (fresh?.score != null && Number.isFinite(Number(fresh.score))) {
    return axisDisplay(fresh.score, fresh.label || null);
  }
  if (ev?.temperature != null && Number.isFinite(Number(ev.temperature))) {
    return axisDisplay(ev.temperature, null);
  }
  const lag = fresh?.lagDays;
  if (lag == null) return axisDisplay(null, '暂无', true);
  if (lag <= 0) return axisDisplay(1, '最新');
  if (lag <= 1) return axisDisplay(0.85, 'T+1');
  if (lag <= 3) return axisDisplay(0.55, '滞后');
  return axisDisplay(0.25, '严重滞后');
}

function scoreHardness(ev) {
  const rel = ev?.reliability;
  if (rel?.score != null && Number.isFinite(Number(rel.score))) {
    return axisDisplay(rel.score, rel.label || (rel.tier ? `源${rel.tier}` : null));
  }
  if (ev?.hardness != null && Number.isFinite(Number(ev.hardness))) {
    return axisDisplay(ev.hardness, null);
  }
  return axisDisplay(null, '暂无', true);
}

function scoreRelevance(ev, claim) {
  if (ev?.relevant === false) {
    return axisDisplay(0.12, '噪音仓');
  }
  if (!claim) {
    return axisDisplay(null, '暂无', true);
  }
  const type = ev?.evidenceType || ev?.type || 'unknown';
  const stmt = String(claim.statement || claim.mechanism || '').toLowerCase();
  const mech = String(claim.mechanism || '').toLowerCase();
  let score = 0.45;
  let label = '一般贴合';

  // 结构类命题 ↔ 合证/基差/仓单
  if (/合证|去库|累库|库存|仓单|基差|升水|贴水/.test(stmt + mech)) {
    if (['warehouse_joint', 'inventory', 'basis', 'term_structure', 'oi'].includes(type)) {
      score = 0.88;
      label = '机制贴合';
    } else if (type === 'news') {
      score = 0.35;
      label = '叙事弱贴';
    }
  }
  // 资金/持仓
  if (/资金|持仓|增仓|减仓|会员/.test(stmt + mech)) {
    if (['capital', 'oi', 'warehouse_joint'].includes(type)) {
      score = Math.max(score, 0.82);
      label = '机制贴合';
    }
  }
  // 外盘/内外
  if (/外盘|内外|lme|伦铜|套利/.test(stmt + mech)) {
    if (['foreign', 'basis'].includes(type)) {
      score = Math.max(score, 0.85);
      label = '机制贴合';
    }
  }

  const links = ev?.links || [];
  if (links.length) {
    score = Math.min(1, score + 0.08);
  }
  if (type === 'news' && score < 0.5 && !links.length) {
    score = 0.28;
    label = '贴合待证';
  }

  // 与主证据类型亲和
  const forTypes = (claim.evidenceFor || []).map((e) => e.evidenceType).filter(Boolean);
  for (const t of forTypes.slice(0, 3)) {
    const aff = MECHANISM_AFFINITY[t] || [];
    if (aff.includes(type)) {
      score = Math.max(score, 0.7);
      label = label === '一般贴合' ? '同链贴合' : label;
    }
  }

  return axisDisplay(score, label);
}

function classifyPattern(temp, hard, rel) {
  const t = temp.score;
  const h = hard.score;
  const r = rel.score;
  if (t == null && h == null && r == null) return null;
  // 热而软：温度高、硬度低 → 叙事绑架风险
  if (t != null && h != null && t >= 0.7 && h < 0.45) {
    return { id: 'hot_soft', label: '热而软', severity: 'high', note: '温度高硬度低 · 防叙事绑架' };
  }
  // 硬而冷：可靠但过期
  if (t != null && h != null && h >= 0.7 && t < 0.45) {
    return { id: 'cold_hard', label: '硬而冷', severity: 'medium', note: '硬度高但过期 · 禁装新' };
  }
  // 贴合假：硬度尚可但贴合低
  if (h != null && r != null && h >= 0.55 && r < 0.35) {
    return { id: 'off_topic', label: '贴合假', severity: 'medium', note: '可靠但不打中机制 · 进噪音仓' };
  }
  // 三轴皆弱
  if (
    (t == null || t < 0.4) &&
    (h == null || h < 0.4) &&
    (r == null || r < 0.4)
  ) {
    return { id: 'weak_triad', label: '三轴偏弱', severity: 'low', note: '温度/硬度/贴合均弱或暂无' };
  }
  return null;
}

function assessEvidenceTriadItem(ev, claim) {
  const temperature = scoreTemperature(ev);
  const hardness = scoreHardness(ev);
  const relevance = scoreRelevance(ev, claim);
  const pattern = classifyPattern(temperature, hardness, relevance);
  return {
    evidenceType: ev?.evidenceType || ev?.type || 'unknown',
    summary: String(ev?.summary || '').slice(0, 48) || '暂无',
    direction: ev?.direction || null,
    dataSource: ev?.dataSource || '暂无',
    nDisplay: ev?.nDisplay || (ev?.n != null ? String(ev.n) : '暂无'),
    temperature,
    hardness,
    relevance,
    pattern,
    display: `温 ${temperature.display} · 硬 ${hardness.display} · 贴 ${relevance.display}${
      pattern ? ` · ${pattern.label}` : ''
    }`,
  };
}

/**
 * 单品种三轴评估
 */
function assessEvidenceTriad(inst, asOfInput) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const claim = inst?.intelCenter?.primaryClaim;
  const list = [...(claim?.evidenceFor || []), ...(claim?.evidenceAgainst || [])];
  const items = list.filter(Boolean).map((ev) => assessEvidenceTriadItem(ev, claim));

  const patterns = items.map((i) => i.pattern).filter(Boolean);
  const hotSoft = items.filter((i) => i.pattern?.id === 'hot_soft');
  const coldHard = items.filter((i) => i.pattern?.id === 'cold_hard');
  const offTopic = items.filter((i) => i.pattern?.id === 'off_topic');

  const avg = (key) => {
    const vals = items.map((i) => i[key]?.score).filter((v) => v != null);
    if (!vals.length) return null;
    return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3);
  };

  const blocksInterrupt =
    hotSoft.length >= 2 ||
    (hotSoft.length >= 1 && items.some((i) => i.evidenceType === 'news' && i.pattern?.id === 'hot_soft')) ||
    coldHard.filter((i) => ['warehouse_joint', 'basis', 'price', 'capital'].includes(i.evidenceType))
      .length >= 1;

  return {
    version: TRIAD_VERSION,
    asOf,
    instrumentId: inst?.id || null,
    instrumentName: inst?.name || null,
    itemCount: items.length,
    items: items.slice(0, 12),
    averages: {
      temperature: avg('temperature'),
      hardness: avg('hardness'),
      relevance: avg('relevance'),
      temperatureDisplay: avg('temperature') != null ? String(avg('temperature')) : '暂无',
      hardnessDisplay: avg('hardness') != null ? String(avg('hardness')) : '暂无',
      relevanceDisplay: avg('relevance') != null ? String(avg('relevance')) : '暂无',
    },
    patterns: {
      hotSoft: hotSoft.length,
      coldHard: coldHard.length,
      offTopic: offTopic.length,
      total: patterns.length,
    },
    hotSoft: hotSoft.slice(0, 4),
    coldHard: coldHard.slice(0, 4),
    offTopic: offTopic.slice(0, 4),
    blocksInterrupt,
    display: !items.length
      ? '证据三轴 · 暂无条目'
      : blocksInterrupt
        ? `证据三轴 · 门禁警示 · 热软${hotSoft.length}/冷硬${coldHard.length}`
        : patterns.length
          ? `证据三轴 · 模式 ${patterns.length} · 温${avg('temperature') ?? '暂无'}/硬${avg('hardness') ?? '暂无'}/贴${avg('relevance') ?? '暂无'}`
          : `证据三轴 · ${items.length} 条 · 温${avg('temperature') ?? '暂无'}/硬${avg('hardness') ?? '暂无'}/贴${avg('relevance') ?? '暂无'}`,
    note: '三轴分开展示；禁止混成单一强度分。缺失=暂无。',
    dataSource: 'intel-evidence-triad',
    method: 'temperature+hardness+relevance',
  };
}

function buildEvidenceTriadBoard(instruments, asOf) {
  const rows = [];
  for (const inst of instruments || []) {
    const report = inst?.intelCenter?.evidenceTriad || assessEvidenceTriad(inst, asOf);
    if (!report?.itemCount) continue;
    if (
      !report.blocksInterrupt &&
      !(report.patterns?.total > 0) &&
      !(report.hotSoft?.length || report.coldHard?.length)
    ) {
      // 仍收录有完整三轴均值的前排，便于研究面孔
      if ((report.averages?.temperature == null && report.averages?.hardness == null) || rows.length > 12) {
        continue;
      }
    }
    rows.push({
      instrumentId: inst.id,
      instrumentName: inst.name,
      display: report.display,
      blocksInterrupt: report.blocksInterrupt,
      hotSoft: report.patterns?.hotSoft || 0,
      coldHard: report.patterns?.coldHard || 0,
      offTopic: report.patterns?.offTopic || 0,
      averages: report.averages,
      topPattern: report.hotSoft?.[0]?.pattern || report.coldHard?.[0]?.pattern || report.offTopic?.[0]?.pattern || null,
    });
  }

  rows.sort(
    (a, b) =>
      (b.blocksInterrupt ? 1 : 0) - (a.blocksInterrupt ? 1 : 0) ||
      b.hotSoft - a.hotSoft ||
      b.coldHard - a.coldHard
  );

  const hotSoftN = rows.reduce((s, r) => s + (r.hotSoft || 0), 0);
  const coldHardN = rows.reduce((s, r) => s + (r.coldHard || 0), 0);

  return {
    version: TRIAD_VERSION,
    asOf: asOf || null,
    rows: rows.slice(0, 20),
    blockingCount: rows.filter((r) => r.blocksInterrupt).length,
    patternInstrumentCount: rows.length,
    counts: {
      hotSoft: hotSoftN,
      coldHard: coldHardN,
      instruments: rows.length,
    },
    display: rows.length
      ? `证据三轴 品种 ${rows.length} · 热软 ${hotSoftN} · 冷硬 ${coldHardN} · 阻断级 ${rows.filter((r) => r.blocksInterrupt).length}`
      : '证据三轴 · 暂无显著模式',
    note: '温度≠硬度≠贴合；热而软禁止当硬证据推 Interrupt',
    dataSource: 'intel-evidence-triad',
    method: 'pack-aggregate-triad',
  };
}

function applyTriadToInterruptGate(inst, gates) {
  const triad = inst?.intelCenter?.evidenceTriad;
  if (!triad?.blocksInterrupt || !gates) return gates;
  const interrupt = gates.interrupt || {};
  const reason = '证据三轴·热软/冷硬警示';
  if (interrupt.pass === false) {
    return {
      ...gates,
      interrupt: {
        ...interrupt,
        blockedReasons: [...new Set([...(interrupt.blockedReasons || []), reason])],
        triadBlocked: true,
      },
    };
  }
  return {
    ...gates,
    interrupt: {
      ...interrupt,
      pass: false,
      blockedReasons: [...new Set([...(interrupt.blockedReasons || []), reason])],
      triadBlocked: true,
      passBeforeTriad: interrupt.pass === true,
    },
  };
}

module.exports = {
  TRIAD_VERSION,
  assessEvidenceTriad,
  assessEvidenceTriadItem,
  buildEvidenceTriadBoard,
  applyTriadToInterruptGate,
  scoreTemperature,
  scoreHardness,
  scoreRelevance,
};
