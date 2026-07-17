/**
 * 反模式 / 反目标看板（构想 §31/62）
 * 聚合本 pack 真实违规信号；零命中显示「暂无」，禁止编造示例。
 */
const ANTI_PATTERN_VERSION = 'v2.89.24-anti-pattern-board';

const CATALOG_DEF = [
  {
    id: 'fake_data_risk',
    label: '假数据风险',
    antiGoal: '禁止为填界面而造假数',
    severity: 'critical',
  },
  {
    id: 'missing_n',
    label: '样本量缺失',
    antiGoal: '禁止裸 % / 无 n 计分',
    severity: 'high',
  },
  {
    id: 'corr_as_causal',
    label: '相关当因果',
    antiGoal: 'corr≠成本传导',
    severity: 'high',
  },
  {
    id: 'narrative_ahead',
    label: '叙事超前结构',
    antiGoal: '禁止叙事绑架加仓',
    severity: 'high',
  },
  {
    id: 'soft_claim_overreach',
    label: '弱证强说',
    antiGoal: '软证不得当强可行动',
    severity: 'medium',
  },
  {
    id: 'missing_against',
    label: '单边命题',
    antiGoal: '缺反对不得强确信',
    severity: 'medium',
  },
  {
    id: 'museum_repeat_risk',
    label: '失效重蹈',
    antiGoal: '博物馆警告须先读',
    severity: 'medium',
  },
];

function pushHit(bucket, hit) {
  bucket.push(hit);
}

/**
 * @param {object} pack
 * @param {object[]} [instruments]
 */
function buildAntiPatternBoard(pack, instruments, opts = {}) {
  const asOf = opts.asOf || pack?.asOf || null;
  const hits = [];
  const byType = {};
  for (const d of CATALOG_DEF) byType[d.id] = [];

  const ev = pack?.evidenceAuditBoard || {};
  for (const row of ev.top || ev.rows || []) {
    const id = row.instrumentId || row.id || null;
    const name = row.instrumentName || row.name || id || '—';
    const issues = row.issues || [];
    for (const iss of issues) {
      const iid = iss.id || iss;
      if (iid === 'fake_suspect') {
        pushHit(byType.fake_data_risk, {
          typeId: 'fake_data_risk',
          instrumentId: id,
          instrumentName: name,
          detail: iss.label || row.display || '假数据嫌疑',
          dataSource: 'evidenceAuditBoard',
          method: 'evidence-fake-suspect',
        });
      }
      if (iid === 'all_n_missing' || iid === 'missing_n') {
        pushHit(byType.missing_n, {
          typeId: 'missing_n',
          instrumentId: id,
          instrumentName: name,
          detail: iss.label || 'n 暂无',
          dataSource: 'evidenceAuditBoard',
          method: 'evidence-missing-n',
        });
      }
      if (iid === 'missing_against') {
        pushHit(byType.missing_against, {
          typeId: 'missing_against',
          instrumentId: id,
          instrumentName: name,
          detail: iss.label || '缺反对证据',
          dataSource: 'evidenceAuditBoard',
          method: 'evidence-missing-against',
        });
      }
    }
  }
  if ((ev.counts?.missingAgainst || 0) > 0 && !byType.missing_against.length) {
    pushHit(byType.missing_against, {
      typeId: 'missing_against',
      instrumentId: null,
      instrumentName: '跨品种',
      detail: `缺反对 ${ev.counts.missingAgainst}`,
      dataSource: 'evidenceAuditBoard',
      method: 'evidence-counts',
      nDisplay: String(ev.counts.missingAgainst),
    });
  }

  const mech = pack?.mechanismBoard || {};
  for (const e of mech.honestyDenied || []) {
    pushHit(byType.corr_as_causal, {
      typeId: 'corr_as_causal',
      instrumentId: e.to || e.from || null,
      instrumentName: e.label || `${e.from}→${e.to}`,
      detail: e.display || '仅滞后相关·禁止因果话术',
      dataSource: 'mechanismBoard',
      method: 'mechanism-honesty',
      nDisplay: e.nDisplay || (e.n != null ? String(e.n) : '暂无'),
    });
  }

  const manip = pack?.antiManipulationBoard || {};
  for (const r of manip.flagged || manip.top || manip.watching || []) {
    const signals = r.autoSignals || r.signals || [];
    const hasAhead = signals.some((s) => /narrative_ahead|ahead/i.test(String(s?.id || s)));
    const soft =
      r.softWatch ||
      signals.some((s) => /news_only|soft/i.test(String(s?.id || s))) ||
      (manip.watching || []).includes(r);
    if (hasAhead || r.flagged) {
      pushHit(byType.narrative_ahead, {
        typeId: 'narrative_ahead',
        instrumentId: r.instrumentId || r.id,
        instrumentName: r.instrumentName || r.name || r.instrumentId,
        detail: r.display || r.summary || '叙事超前/操纵旗',
        dataSource: 'antiManipulationBoard',
        method: 'anti-manip',
        nDisplay: r.nDisplay || '暂无',
      });
    }
    if (soft && !hasAhead) {
      pushHit(byType.soft_claim_overreach, {
        typeId: 'soft_claim_overreach',
        instrumentId: r.instrumentId || r.id,
        instrumentName: r.instrumentName || r.name,
        detail: r.display || '软证监视',
        dataSource: 'antiManipulationBoard',
        method: 'anti-manip-soft-watch',
        nDisplay: r.nDisplay || '暂无',
      });
    }
  }

  const narr = pack?.narrativeContagion || {};
  for (const r of narr.ahead || []) {
    pushHit(byType.narrative_ahead, {
      typeId: 'narrative_ahead',
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      detail: r.display || `${r.themeLabel || ''} 超前`,
      dataSource: 'narrativeContagion',
      method: 'narrative-ahead',
      nDisplay: r.nDisplay || '暂无',
    });
  }

  const sharp = pack?.claimSharpnessBoard || {};
  const softRows = Array.isArray(sharp.soft)
    ? sharp.soft
    : Array.isArray(sharp.softClaims)
      ? sharp.softClaims
      : Array.isArray(sharp.rows)
        ? sharp.rows.filter((r) => r.soft || r.tier === 'soft')
        : [];
  for (const r of softRows) {
    pushHit(byType.soft_claim_overreach, {
      typeId: 'soft_claim_overreach',
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      detail: r.display || '套话/软命题',
      dataSource: 'claimSharpnessBoard',
      method: 'claim-soft',
    });
  }

  const museum = pack?.museumBoard || {};
  for (const w of museum.activeWarnings || []) {
    pushHit(byType.museum_repeat_risk, {
      typeId: 'museum_repeat_risk',
      instrumentId: w.instrumentId,
      instrumentName: w.instrumentName || w.instrumentId,
      detail: w.display || w.lesson?.label || w.statement || '博物馆警告',
      dataSource: 'museumBoard',
      method: 'museum-active-warning',
    });
  }

  // instruments fallback: per-inst antiManip / honesty
  for (const inst of instruments || []) {
    const am = inst?.intelCenter?.antiManipulation;
    if (am?.flagged || am?.narrativeAhead) {
      pushHit(byType.narrative_ahead, {
        typeId: 'narrative_ahead',
        instrumentId: inst.id,
        instrumentName: inst.name,
        detail: am.display || '叙事超前/操纵旗',
        dataSource: 'instrument.antiManipulation',
        method: 'inst-anti-manip',
      });
    }
  }

  const catalog = [];
  for (const def of CATALOG_DEF) {
    const list = byType[def.id] || [];
    // dedupe by instrumentId+detail
    const seen = new Set();
    const uniq = [];
    for (const h of list) {
      const k = `${h.instrumentId || ''}|${h.detail || ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(h);
    }
    byType[def.id] = uniq;
    if (!uniq.length) continue;
    catalog.push({
      ...def,
      hitN: uniq.length,
      nDisplay: String(uniq.length),
      samples: uniq.slice(0, 5).map((h) => ({
        instrumentId: h.instrumentId,
        instrumentName: h.instrumentName,
        detail: h.detail,
        nDisplay: h.nDisplay || '暂无',
      })),
      dataSource: uniq[0]?.dataSource || 'intel-anti-pattern-board',
      method: 'anti-pattern-aggregate',
    });
    for (const h of uniq) hits.push(h);
  }

  const critical = catalog.filter((c) => c.severity === 'critical').reduce((s, c) => s + c.hitN, 0);
  const high = catalog.filter((c) => c.severity === 'high').reduce((s, c) => s + c.hitN, 0);
  const medium = catalog.filter((c) => c.severity === 'medium').reduce((s, c) => s + c.hitN, 0);

  const questions = catalog
    .filter((c) => c.severity === 'critical' || c.severity === 'high')
    .slice(0, 6)
    .map((c) => {
      const lead = c.samples[0];
      return {
        priority: c.severity === 'critical' ? 'P1' : 'P2',
        score: c.severity === 'critical' ? 40 : 28,
        instrumentId: lead?.instrumentId || null,
        instrumentName: lead?.instrumentName || c.label,
        question: `反模式「${c.label}」命中 n=${c.nDisplay} — ${c.antiGoal}？`,
        reasons: ['anti-pattern-board', c.id],
        dataSource: 'intel-anti-pattern-board',
      };
    });

  const hitTypes = catalog.length;
  const available = hitTypes > 0;

  return {
    version: ANTI_PATTERN_VERSION,
    asOf,
    available,
    catalog,
    catalogDefined: CATALOG_DEF.map((d) => ({ id: d.id, label: d.label, antiGoal: d.antiGoal })),
    hits: hits.slice(0, 40),
    bySeverity: { critical, high, medium },
    counts: {
      catalogDefined: CATALOG_DEF.length,
      hitTypes,
      hitRows: hits.length,
      instrumentsTouched: new Set(hits.map((h) => h.instrumentId).filter(Boolean)).size,
      critical,
      high,
      medium,
    },
    questions,
    display: available
      ? `反模式 命中类型${hitTypes} · 行${hits.length} · critical${critical}/high${high}`
      : '反模式 · 暂无命中（本 pack）',
    emptyReason: available ? null : '本 pack 无已定义反模式命中',
    note: '仅聚合真实板信号；零命中标暂无；禁止编造示例',
    method: 'anti-pattern-aggregate',
    dataSource: 'intel-anti-pattern-board',
  };
}

function enrichQuestionQueueWithAntiPattern(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({ ...q, source: 'anti-pattern-board' });
  }
  if (!extra.length) return queue;
  return {
    ...queue,
    all: [...(queue.all || []), ...extra],
    p1: [...(queue.p1 || []), ...extra.filter((q) => q.priority === 'P1')].slice(0, 12),
    p2: [...(queue.p2 || []), ...extra.filter((q) => q.priority === 'P2')].slice(0, 16),
    version: `${queue.version || ''}+antiPattern`,
  };
}

module.exports = {
  ANTI_PATTERN_VERSION,
  CATALOG_DEF,
  buildAntiPatternBoard,
  enrichQuestionQueueWithAntiPattern,
};
