/**
 * 情报中心 · 场景格（证据绑权重，构想 §35/53）
 * 互斥情景：基准 / 上行 / 证伪 / 横盘 / 外生。
 * 权重仅当 stateKey 校准 n≥20 才给数值档；触发器·描述·动作须绑真实证据，禁止纯 side 脚本冒充概率。
 */
const { lookupCalibratedWeights } = require('./intel-statekey-weights');
const { lookupProcessMultiplier } = require('./intel-process-learning');

const SCENARIO_VERSION = 'v2.89.12-evidence-bound-lattice';

function clamp01(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.max(0, Math.min(1, Number(n)));
}

function evidenceSnippet(e) {
  if (!e) return null;
  return {
    summary: e.summary || e.label || e.condition || null,
    dataSource: e.dataSource || e.source || 'unknown',
    n: e.n ?? null,
    nDisplay: e.nDisplay || (e.n != null ? String(e.n) : '暂无'),
    evidenceType: e.evidenceType || e.kind || null,
  };
}

/** 候选冲击下游（机制先验边，非激活分） */
function resolveAffectedInstruments(inst) {
  const id = String(inst?.id || '').toLowerCase();
  if (!id) return { items: [], nDisplay: '暂无', dataSource: 'missing' };
  let edges = [];
  try {
    edges = require('./intel-shock-graph').CANDIDATE_EDGES || [];
  } catch {
    edges = [];
  }
  const items = edges
    .filter((e) => String(e.from || '').toLowerCase() === id)
    .slice(0, 6)
    .map((e) => ({
      id: e.to,
      label: e.label || `${e.from}→${e.to}`,
      mechanismPrior: e.mechanism || null,
      note: '候选机制边·非已验证传导',
    }));
  const sector = inst.sector
    ? { id: `sector:${inst.sector}`, label: `同板块 ${inst.sector}`, mechanismPrior: 'sector', note: '板块提示' }
    : null;
  if (!items.length && sector) items.push(sector);
  return {
    items,
    nDisplay: items.length ? String(items.length) : '暂无',
    dataSource: items.length ? 'shock-candidate-edges' : 'missing',
  };
}

/**
 * 按情景 id 绑定真实触发器 / 证据 / 动作；无绑定时 scripted=true
 */
function bindScenarioContent(scenarioId, inst, claim, pricingState, clock) {
  const side = claim?.side || 'flat';
  const forEv = (claim?.evidenceFor || []).map(evidenceSnippet).filter((x) => x?.summary);
  const againstEv = (claim?.evidenceAgainst || []).map(evidenceSnippet).filter((x) => x?.summary);
  const atomic = claim?.atomic || null;
  const falsifyTriggers = (claim?.triggers || []).filter((t) => t.type === 'falsify');
  const upgradeTriggers = (claim?.triggers || []).filter(
    (t) => t.type === 'upgrade' || t.type === 'reinforce'
  );
  const affected = resolveAffectedInstruments(inst);
  const ps = pricingState?.state;
  const dual = inst?.dualNarrative || inst?.intelCenter?.dualNarrative;
  const narrative = inst?.intelCenter?.narrative;

  if (scenarioId === 'base') {
    const bindings = [];
    if (atomic?.observable?.value != null) {
      bindings.push({
        summary: `原子观测 ${atomic.observable.value}`,
        dataSource: atomic.observable.dataSource || 'atomic',
        nDisplay: atomic.observable.nDisplay || '暂无',
        role: 'observable',
      });
    }
    for (const e of forEv.slice(0, 2)) bindings.push({ ...e, role: 'for' });
    const scripted = bindings.length === 0 && !claim?.statement;
    return {
      description: claim?.statement || '当前命题延续（陈述暂无）',
      trigger: null,
      triggerSource: null,
      action: {
        id: ps === 'priced-in' || ps === 'unknown' ? 'C' : 'A',
        label: ps === 'priced-in' || ps === 'unknown' ? '观望/追踪' : side === 'bear' ? '防御观察' : '结构跟随',
        condition: claim?.otherwiseFalsify
          ? `未触发：${claim.otherwiseFalsify}`
          : pricingState?.actionHint || '命题延续条件仍在',
        evidenceBound: !scripted,
      },
      evidenceBindings: bindings,
      affectedInstruments: affected.items,
      affectedDisplay: affected.nDisplay === '暂无' ? '波及暂无' : `波及候选 ${affected.nDisplay}`,
      scripted,
      scriptedReason: scripted ? '无证据/陈述可绑' : null,
    };
  }

  if (scenarioId === 'upside') {
    const upTrig = upgradeTriggers[0] || null;
    const narrOk = narrative?.phase === 'spreading' || narrative?.phase === 'peak' || narrative?.narrativeAhead;
    const bindings = [];
    if (upTrig) {
      bindings.push({
        summary: upTrig.condition,
        dataSource: upTrig.dataSource || 'claim.trigger',
        nDisplay: '暂无',
        role: 'upgrade',
      });
    }
    if (narrOk) {
      bindings.push({
        summary: narrative.alert || `叙事 ${narrative.phase || 'ahead'}`,
        dataSource: 'narrative-epidemiology',
        nDisplay: narrative.nDisplay || narrative.contagion?.nDisplay || '暂无',
        role: 'narrative',
      });
    }
    if (ps === 'mispriced') {
      bindings.push({
        summary: pricingState?.display || '定价背离',
        dataSource: 'pricing-state',
        nDisplay: '暂无',
        role: 'pricing',
      });
    }
    const scripted = bindings.length === 0;
    return {
      description: scripted
        ? '上行强化 · 暂无升级触发/叙事/误定价绑定（脚本占位·无权）'
        : side === 'bear'
          ? '空头证伪或结构缓和超预期'
          : '结构/资金/叙事共振超预期',
      trigger: upTrig?.condition || (narrOk ? `叙事${narrative.phase}` : null) || (ps === 'mispriced' ? 'mispriced' : null),
      triggerSource: upTrig?.dataSource || (narrOk ? 'narrative' : ps === 'mispriced' ? 'pricing' : null),
      action: {
        id: 'A',
        label: '趋势跟随',
        condition: upTrig?.condition || (narrOk ? '叙事加速且合证未反证' : '—'),
        evidenceBound: !scripted,
      },
      evidenceBindings: bindings,
      affectedInstruments: affected.items,
      affectedDisplay: affected.nDisplay === '暂无' ? '波及暂无' : `波及候选 ${affected.nDisplay}`,
      scripted,
      scriptedReason: scripted ? '无 upgrade/叙事/mispriced 证据' : null,
    };
  }

  if (scenarioId === 'falsify') {
    const ft = falsifyTriggers[0] || null;
    const otherwise = claim?.otherwiseFalsify || atomic?.otherwiseFalsify || null;
    const bindings = [];
    if (otherwise) {
      bindings.push({
        summary: otherwise,
        dataSource: 'atomic.otherwiseFalsify',
        nDisplay: claim?.nDisplay || '暂无',
        role: 'otherwiseFalsify',
      });
    }
    if (ft) {
      bindings.push({
        summary: ft.condition,
        dataSource: ft.dataSource || 'claim.trigger',
        nDisplay: '暂无',
        role: 'falsify-trigger',
      });
    }
    for (const e of againstEv.slice(0, 2)) bindings.push({ ...e, role: 'against' });
    if (clock?.aggregate?.level === 'red' || clock?.evaluation?.status === 'falsifying') {
      bindings.push({
        summary: clock.display || clock.evaluation?.display || '证伪时钟红',
        dataSource: 'falsify-clock',
        nDisplay: '暂无',
        role: 'clock',
      });
    }
    const scripted = bindings.length === 0;
    return {
      description: scripted
        ? '主命题证伪 · 暂无证伪句/反对/时钟绑定（脚本占位·无权）'
        : '证伪时钟或结构对立兑现',
      trigger: otherwise || ft?.condition || clock?.display || null,
      triggerSource: otherwise ? 'atomic' : ft?.dataSource || 'falsify-clock',
      action: {
        id: 'B',
        label: '减仓/改口',
        condition: otherwise || ft?.condition || '—',
        evidenceBound: !scripted,
      },
      evidenceBindings: bindings,
      affectedInstruments: affected.items,
      affectedDisplay: affected.nDisplay === '暂无' ? '波及暂无' : `波及候选 ${affected.nDisplay}`,
      scripted,
      scriptedReason: scripted ? '无证伪句/反对/时钟' : null,
    };
  }

  if (scenarioId === 'range') {
    const bindings = [];
    if (ps === 'priced-in') {
      bindings.push({
        summary: pricingState?.display || '已定价',
        dataSource: 'pricing-state',
        nDisplay: '暂无',
        role: 'pricing',
      });
    }
    if (dual?.regime === 'split') {
      bindings.push({
        summary: dual.display || '内外分裂',
        dataSource: 'dual-narrative',
        nDisplay: dual.nDisplay || '暂无',
        role: 'dual',
      });
    }
    if (narrative?.phase === 'fatigue') {
      bindings.push({
        summary: `叙事疲劳 n=${narrative.nDisplay || narrative.contagion?.nDisplay || '暂无'}`,
        dataSource: 'narrative-epidemiology',
        nDisplay: narrative.nDisplay || '暂无',
        role: 'narrative',
      });
    }
    if (claim?.confidence === '叙事分歧' || claim?.confidence === '不可判定') {
      bindings.push({
        summary: `信念 ${claim.confidence}`,
        dataSource: 'claim.confidence',
        nDisplay: claim.nDisplay || '暂无',
        role: 'belief',
      });
    }
    const scripted = bindings.length === 0;
    return {
      description: scripted
        ? '横盘消耗 · 暂无已定价/分裂/疲劳绑定（脚本占位·无权）'
        : '叙事疲劳、已定价或内外分歧下的横盘消耗',
      trigger: bindings[0]?.summary || null,
      triggerSource: bindings[0]?.dataSource || null,
      action: {
        id: 'C',
        label: '忍耐/降档',
        condition: bindings[0]?.summary || '无强化触发',
        evidenceBound: !scripted,
      },
      evidenceBindings: bindings,
      affectedInstruments: affected.items.slice(0, 3),
      affectedDisplay: affected.nDisplay === '暂无' ? '波及暂无' : `波及候选 ${affected.nDisplay}`,
      scripted,
      scriptedReason: scripted ? '无定价/双叙事/疲劳证据' : null,
    };
  }

  // exogenous
  const shock = Number(inst?.factors?.news?.shock);
  const hitN = Number(inst?.factors?.news?.hitCount) || 0;
  const hasShock = Number.isFinite(shock) && Math.abs(shock) > 0.5;
  return {
    description: hasShock
      ? `外生冲击代理 shock=${shock.toFixed(2)} · 须多源印证后才赋权`
      : '外生冲击占位',
    trigger: hasShock ? `news.shock=${shock.toFixed(2)}` : null,
    triggerSource: 'news',
    action: { id: 'C', label: '等待印证', condition: '源分级不足则降权', evidenceBound: false },
    evidenceBindings: hasShock
      ? [
          {
            summary: `新闻冲击 ${shock.toFixed(2)}`,
            dataSource: 'news',
            nDisplay: hitN ? String(hitN) : '暂无',
            role: 'news-shock',
          },
        ]
      : [],
    affectedInstruments: affected.items,
    affectedDisplay: affected.nDisplay === '暂无' ? '波及暂无' : `波及候选 ${affected.nDisplay}`,
    scripted: !hasShock,
    scriptedReason: hasShock ? null : '无 news.shock',
    evidenceBound: false,
  };
}

function buildActionSet(side, pricingState, weights, calibrated, boundPrimary) {
  const ps = pricingState?.state;
  const w = (key) => (calibrated && weights ? weights[key] ?? null : null);
  const baseW = w('base');
  if (boundPrimary?.action) {
    return {
      primary: {
        ...boundPrimary.action,
        weight: baseW,
        reason: boundPrimary.action.condition,
      },
      alternatives: [],
      evidenceBound: boundPrimary.action.evidenceBound !== false,
    };
  }
  if (ps === 'unknown' || (ps === 'priced-in' && (baseW == null || baseW < 0.45))) {
    return {
      primary: {
        id: 'C',
        label: '观望/追踪',
        reason: pricingState?.actionHint || '证据或定价不足',
        weight: baseW,
      },
      alternatives: [],
      evidenceBound: false,
    };
  }
  if (side === 'bull') {
    return {
      primary: { id: 'A', label: '趋势跟随', condition: '结构延续+基差配合', weight: w('base') },
      alternatives: [
        { id: 'B', label: '均值回归', condition: '冲高回落+贴水扩大', weight: w('falsify') },
        { id: 'C', label: '观望', condition: '数据缺失或单源叙事', weight: w('range') },
      ],
      evidenceBound: false,
      scripted: true,
    };
  }
  if (side === 'bear') {
    return {
      primary: { id: 'A', label: '防御/偏空观察', condition: '结构压制延续', weight: w('base') },
      alternatives: [
        { id: 'B', label: '反弹博弈', condition: '超卖+叙事疲劳', weight: w('upside') },
        { id: 'C', label: '观望', condition: '证伪时钟未到期', weight: w('range') },
      ],
      evidenceBound: false,
      scripted: true,
    };
  }
  return {
    primary: { id: 'C', label: '震荡区间内', condition: '主矛盾未明朗', weight: w('range') },
    alternatives: [
      { id: 'A', label: '突破跟随', condition: '放量突破区间', weight: w('upside') },
      { id: 'B', label: '区间操作', condition: '波动率收敛', weight: w('base') },
    ],
    evidenceBound: false,
    scripted: true,
  };
}

/**
 * 从真实校准/时钟/定价推导未归一化权重；样本不足 → null
 */
function parseCalHitRate(cal) {
  if (!cal) return null;
  if (cal.hitRate != null && Number.isFinite(Number(cal.hitRate))) return Number(cal.hitRate);
  const m = String(cal.hitDisplay || '').match(/([\d.]+)\s*%/);
  if (m) return Number(m[1]) / 100;
  return null;
}

function deriveRawWeights(inst, claim, pricingState, clock) {
  const stateKey = claim?.stateKey || inst?.intelligenceKernel?.stateKey;
  const cal = stateKey ? lookupCalibratedWeights(stateKey) : null;
  const proc = lookupProcessMultiplier(stateKey);
  const n = cal?.n ?? claim?.n ?? null;
  const nOk = n != null && n >= 20;
  const hitRate = parseCalHitRate(cal);
  // lookup 已过 minN/lift；有桶即视为可校准（hitDisplay 可解析则用其，否则中性 0.5）
  const calibrated = Boolean(nOk && cal);

  let base = 0.35;
  let upside = 0.2;
  let falsify = 0.25;
  let range = 0.2;
  const evidence = [];

  if (calibrated) {
    const hr = hitRate != null ? hitRate : 0.5;
    base = 0.25 + hr * 0.45;
    evidence.push({
      source: 'statekey-cal',
      n,
      hitRate: hr,
      hitDisplay: cal.hitDisplay || null,
      nDisplay: String(n),
    });
  } else {
    evidence.push({ source: 'statekey-cal', n: n ?? null, note: 'n不足·权重启发式降档' });
  }

  if (proc?.available && proc.multiplier != null) {
    base *= proc.multiplier;
    evidence.push({ source: 'process-learn', multiplier: proc.multiplier, n: proc.n });
  }

  const clockLevel = clock?.aggregate?.level || clock?.evaluation?.status;
  if (clockLevel === 'red' || claim?.status === 'falsifying' || claim?.status === 'falsified') {
    falsify = Math.max(falsify, 0.4);
    base *= 0.7;
    evidence.push({ source: 'falsify-clock', level: clockLevel || claim?.status });
  }

  const ps = pricingState?.state;
  if (ps === 'mispriced') {
    upside = sideBoost(claim?.side, 'mispriced_upside', upside);
    falsify = Math.max(falsify, 0.3);
    evidence.push({ source: 'pricing', state: ps });
  } else if (ps === 'priced-in') {
    range = Math.max(range, 0.35);
    base *= 0.85;
    evidence.push({ source: 'pricing', state: ps });
  }

  const dual = inst?.dualNarrative || inst?.intelCenter?.dualNarrative;
  if (dual?.regime === 'split') {
    range = Math.max(range, 0.35);
    base *= 0.8;
    evidence.push({ source: 'dual-narrative', regime: 'split' });
  }

  const narrative = inst?.intelCenter?.narrative;
  if (narrative?.phase === 'peak' || narrative?.narrativeAhead) {
    upside = Math.max(upside, 0.28);
    evidence.push({ source: 'narrative', phase: narrative.phase });
  }
  if (narrative?.phase === 'fatigue') {
    range = Math.max(range, 0.32);
    evidence.push({ source: 'narrative', phase: 'fatigue' });
  }

  return {
    raw: { base, upside, falsify, range },
    n,
    nOk,
    nDisplay: n != null ? String(n) : '暂无',
    evidence,
    calibrated: Boolean(nOk && cal),
  };
}

function sideBoost(side, kind, current) {
  if (kind === 'mispriced_upside') {
    return Math.max(current, side === 'flat' ? 0.3 : 0.25);
  }
  return current;
}

function normalizeWeights(raw) {
  const keys = ['base', 'upside', 'falsify', 'range'];
  let sum = 0;
  for (const k of keys) sum += Math.max(0, Number(raw[k]) || 0);
  if (sum <= 0) return null;
  const out = {};
  for (const k of keys) {
    out[k] = +((Math.max(0, Number(raw[k]) || 0) / sum)).toFixed(3);
  }
  return out;
}

function bandLabel(w, calibrated, nDisplay, scripted) {
  if (scripted) {
    return nDisplay && nDisplay !== '暂无' ? `暂无·未绑证据 · n=${nDisplay}` : '暂无·未绑证据';
  }
  if (!calibrated || w == null) {
    return nDisplay && nDisplay !== '暂无' ? `暂无 · n=${nDisplay}` : '暂无';
  }
  const nBit = nDisplay && nDisplay !== '暂无' ? ` · n=${nDisplay}` : '';
  if (w >= 0.4) return `偏高 ${(w * 100).toFixed(0)}%${nBit}`;
  if (w >= 0.25) return `中 ${(w * 100).toFixed(0)}%${nBit}`;
  return `低 ${(w * 100).toFixed(0)}%${nBit}`;
}

function buildScenarioLattice(inst, claim, pricingState, clock) {
  const side = claim?.side || 'flat';

  const derived = deriveRawWeights(inst, claim, pricingState, clock);
  const calibrated = derived.calibrated;
  const weights = calibrated ? normalizeWeights(derived.raw) : null;
  const heuristicRaw = !calibrated ? normalizeWeights(derived.raw) : null;

  const ids = ['base', 'upside', 'falsify', 'range'];
  const labels = {
    base: '基准延续',
    upside: side === 'bear' ? '空头证伪反弹' : '上行强化',
    falsify: '主命题证伪',
    range: '横盘消耗',
  };

  const scenarios = ids.map((id) => {
    const bound = bindScenarioContent(id, inst, claim, pricingState, clock);
    // 脚本占位：禁止给数值权（即便已校准）——避免假概率
    const allowWeight = calibrated && !bound.scripted;
    const w = allowWeight && weights ? weights[id] ?? null : null;
    return {
      id,
      label: labels[id],
      weight: w,
      probabilityBand: bandLabel(w, calibrated, derived.nDisplay, bound.scripted),
      description: bound.description,
      trigger: bound.trigger,
      triggerSource: bound.triggerSource,
      action: bound.action,
      evidenceBindings: bound.evidenceBindings,
      evidenceBound: !bound.scripted && (bound.evidenceBindings?.length > 0 || id === 'base'),
      scripted: bound.scripted,
      scriptedReason: bound.scriptedReason,
      affectedInstruments: bound.affectedInstruments,
      affectedDisplay: bound.affectedDisplay,
      nDisplay: derived.nDisplay,
    };
  });

  const shock = Number(inst?.factors?.news?.shock);
  if (Number.isFinite(shock) && Math.abs(shock) > 0.5) {
    const exo = bindScenarioContent('exogenous', inst, claim, pricingState, clock);
    scenarios.push({
      id: 'exogenous',
      label: '外生冲击',
      weight: null,
      probabilityBand: '暂无（单源·未赋权）',
      description: exo.description,
      trigger: exo.trigger,
      triggerSource: exo.triggerSource,
      action: exo.action,
      evidenceBindings: exo.evidenceBindings,
      evidenceBound: false,
      scripted: exo.scripted,
      affectedInstruments: exo.affectedInstruments,
      affectedDisplay: exo.affectedDisplay,
      nDisplay: '暂无',
    });
  }

  const scriptedCount = scenarios.filter((s) => s.scripted).length;
  const boundCount = scenarios.filter((s) => s.evidenceBound).length;
  const weightSum = scenarios
    .filter((s) => s.weight != null)
    .reduce((s, x) => s + Number(x.weight), 0);
  const exclusiveOk =
    !calibrated ||
    scenarios.filter((s) => s.weight != null).length === 0 ||
    (weightSum >= 0.97 && weightSum <= 1.03);

  const baseBound = scenarios.find((s) => s.id === 'base');

  return {
    version: SCENARIO_VERSION,
    claimId: claim?.claimId,
    scenarios: scenarios.slice(0, 5),
    weights: calibrated
      ? Object.fromEntries(
          ['base', 'upside', 'falsify', 'range'].map((k) => [
            k,
            scenarios.find((s) => s.id === k && !s.scripted)?.weight ?? null,
          ])
        )
      : null,
    heuristicRaw: heuristicRaw
      ? { ...heuristicRaw, note: '仅审计用·禁止当客观概率', nDisplay: derived.nDisplay }
      : null,
    weightsCalibrated: calibrated,
    n: derived.n,
    nDisplay: derived.nDisplay,
    weightEvidence: derived.evidence,
    actionSet: buildActionSet(side, pricingState, weights, calibrated, baseBound),
    mutuallyExclusive: true,
    exclusiveOk,
    weightSum: calibrated ? +weightSum.toFixed(3) : null,
    scriptedCount,
    boundCount,
    counts: {
      scenarios: scenarios.length,
      scripted: scriptedCount,
      evidenceBound: boundCount,
      withWeight: scenarios.filter((s) => s.weight != null).length,
    },
    note: calibrated
      ? `校准权 n=${derived.nDisplay} · 绑证${boundCount} · 脚本${scriptedCount}（脚本情景无权）· 仍非客观概率`
      : `n=${derived.nDisplay}·不足20 · 权暂无 · 绑证${boundCount} · 脚本${scriptedCount}`,
    display: calibrated
      ? `场景格 已校准 n=${derived.nDisplay} · 绑证${boundCount}/${scenarios.length} · 脚本${scriptedCount}`
      : `场景格 未校准 n=${derived.nDisplay} · 绑证${boundCount}/${scenarios.length} · 权暂无`,
    dataSource: 'intel-scenario-lattice',
    method: 'evidence-bound+calibrated-weights+anti-script',
    trueEvidenceBound: true,
  };
}

/**
 * Pack 级场景格诚实板
 */
function buildScenarioLatticeBoard(instruments, asOfInput) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const rows = [];
  let calibrated = 0;
  let scriptedHeavy = 0;
  let exclusiveFail = 0;
  let scored = 0;

  for (const inst of instruments || []) {
    const lat = inst?.intelCenter?.scenarioLattice;
    if (!lat) continue;
    scored += 1;
    if (lat.weightsCalibrated) calibrated += 1;
    if ((lat.scriptedCount || 0) >= 2) scriptedHeavy += 1;
    if (lat.exclusiveOk === false) exclusiveFail += 1;
    if (!lat.weightsCalibrated || (lat.scriptedCount || 0) >= 2 || lat.exclusiveOk === false) {
      rows.push({
        instrumentId: inst.id,
        instrumentName: inst.name,
        display: `${inst.name} · ${lat.display || ''}`,
        nDisplay: lat.nDisplay || '暂无',
        scriptedCount: lat.scriptedCount || 0,
        boundCount: lat.boundCount || 0,
        weightsCalibrated: !!lat.weightsCalibrated,
      });
    }
  }

  const questions = rows
    .filter((r) => r.scriptedCount >= 2 || !r.weightsCalibrated)
    .slice(0, 6)
    .map((r) => ({
      priority: 'P3',
      score: 20,
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      question: `${r.instrumentName}：场景格脚本${r.scriptedCount}·校准${r.weightsCalibrated ? '是' : '否'} (n=${r.nDisplay}) — 是否缺触发器/反对以致 A/B/C 空转？`,
      reasons: ['场景格诚实板', r.display],
      dataSource: 'intel-scenario-lattice',
    }));

  return {
    version: SCENARIO_VERSION,
    asOf,
    rows: rows.slice(0, 20),
    questions,
    counts: {
      scored,
      calibrated,
      scriptedHeavy,
      exclusiveFail,
    },
    nDisplay: scored ? String(scored) : '暂无',
    display: scored
      ? `场景板 校准${calibrated}/${scored} · 脚本偏重${scriptedHeavy} · 互斥异常${exclusiveFail}`
      : '场景板 暂无',
    note: '校准≠客观概率；脚本情景必须无权',
    dataSource: 'intel-scenario-lattice',
    method: 'pack-scenario-honesty',
  };
}

function enrichQuestionQueueWithScenarioLattice(queue, board) {
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
      priority: q.priority || 'P3',
      priorityLabel: '场景格脚本',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 18);
  return {
    ...queue,
    all,
    deepQueue: deep,
    scenarioLatticeInjected: extra.length,
    version: `${queue.version || ''}+scenario`,
  };
}

module.exports = {
  SCENARIO_VERSION,
  buildScenarioLattice,
  buildActionSet,
  deriveRawWeights,
  normalizeWeights,
  bindScenarioContent,
  resolveAffectedInstruments,
  buildScenarioLatticeBoard,
  enrichQuestionQueueWithScenarioLattice,
};
