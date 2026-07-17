/**
 * 情报中心 · 可执行选择集（构想 §35）
 * 输出 A/B/C 带真实触发器的策略选择，而非单点方向。
 * 禁止假概率：仅当 scenario 权重已校准才附带 weight；否则标「暂无」。
 */
const CHOICE_VERSION = 'v2.87.0-choice-weight-honesty';

function pickFalsifyTrigger(claim, clock) {
  const fromClaim = (claim?.triggers || []).find((t) => t.type === 'falsify');
  if (fromClaim?.condition) return { text: fromClaim.condition, source: 'claim.trigger' };
  if (claim?.falsifyTrigger) return { text: claim.falsifyTrigger, source: 'claim.falsifyTrigger' };
  if (clock?.evaluation?.display) return { text: clock.evaluation.display, source: 'falsify-clock' };
  if (clock?.display) return { text: clock.display, source: 'falsify-clock' };
  return { text: null, source: null };
}

function pickUpgradeTrigger(claim) {
  const fromClaim = (claim?.triggers || []).find((t) => t.type === 'upgrade' || t.type === 'reinforce');
  if (fromClaim?.condition) return { text: fromClaim.condition, source: 'claim.trigger' };
  return { text: null, source: null };
}

function buildStructuralTriggers(inst) {
  const out = [];
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  if (sf?.available && sf.primaryLabel) {
    out.push({
      id: 'stock_flow',
      text: `合证翻转离开「${sf.primaryLabel}」`,
      source: 'stock-flow-joint',
      available: true,
    });
  } else {
    out.push({
      id: 'stock_flow',
      text: null,
      source: 'stock-flow-joint',
      available: false,
      note: '合证暂无',
    });
  }

  const basis = inst?.basis || inst?.factors?.basis || inst?.termStructure;
  if (basis?.available !== false && (basis?.structure || basis?.structureLabel)) {
    out.push({
      id: 'basis',
      text: `期限结构离开「${basis.structureLabel || basis.structure}」`,
      source: 'term-basis',
      available: true,
    });
  }

  const dual = inst?.dualNarrative || inst?.intelCenter?.dualNarrative;
  if (dual?.regime === 'split') {
    out.push({
      id: 'dual',
      text: '内外叙事由分裂转为共振或单边确认',
      source: 'dual-narrative',
      available: true,
    });
  }

  const iso = inst?.intelCenter?.isomorphicBoard;
  if (iso?.preferWatchSignals && iso?.best?.watchSignals?.length) {
    out.push({
      id: 'isomorphic',
      text: `同构「${iso.best.label}」监视：${iso.best.watchSignals.slice(0, 2).join(' / ')}`,
      source: 'isomorphic-board',
      available: true,
      nDisplay: iso.best.pathNDisplay || '暂无',
    });
  }

  const oi = inst?.capitalAttention?.horizons;
  if (oi?.oi1mPct != null && Number.isFinite(Number(oi.oi1mPct))) {
    const sign = Number(oi.oi1mPct) >= 0 ? '增仓' : '减仓';
    out.push({
      id: 'oi_1m',
      text: `持仓1月由${sign}(${Number(oi.oi1mPct).toFixed(1)}%)掉头`,
      source: 'capital-attitude',
      available: true,
      nDisplay: oi.sampleN != null ? String(oi.sampleN) : '暂无',
    });
  }

  return out;
}

function weightFor(scenarioLattice, scenarioId) {
  const sc = (scenarioLattice?.scenarios || []).find((s) => s.id === scenarioId);
  if (!scenarioLattice?.weightsCalibrated) {
    return { weight: null, band: '暂无', calibrated: false };
  }
  if (sc?.weight == null) return { weight: null, band: '暂无', calibrated: true };
  return {
    weight: sc.weight,
    band: sc.probabilityBand || null,
    calibrated: true,
  };
}

/**
 * @returns {object} choiceSet
 */
function buildChoiceSet(inst, claim, pricingState, clock, scenarioLattice, horizonCoordination) {
  const side = claim?.side || 'flat';
  const belief = claim?.confidence || '不可判定';
  const ps = pricingState?.state;
  const hz = horizonCoordination || inst?.intelCenter?.horizonCoordination;
  const dual = inst?.dualNarrative || inst?.intelCenter?.dualNarrative;
  const structural = buildStructuralTriggers(inst);
  const falsify = pickFalsifyTrigger(claim, clock);
  const upgrade = pickUpgradeTrigger(claim);
  const sfReady = structural.find((t) => t.id === 'stock_flow')?.available;

  const wBase = weightFor(scenarioLattice, 'base');
  const wFalsify = weightFor(scenarioLattice, 'falsify');
  const wRange = weightFor(scenarioLattice, 'range');

  // —— C：追踪/不下注（默认兜底）——
  const optionC = {
    id: 'C',
    label: '观望/追踪',
    stance: 'monitor',
    why:
      !claim || belief === '不可判定' || ps === 'unknown'
        ? '证据或定价不足 · 不下注'
        : ps === 'priced-in'
          ? '利好/利空或已定价 · 耐心等待新触发'
          : claim.status === 'falsifying'
            ? '证伪进行中 · 先追踪对立证据'
            : '作为缺数据/单源叙事时的默认动作',
    enterWhen: [
      !sfReady ? '合证仍不可用' : null,
      belief === '不可判定' ? '信念不可判定' : null,
      claim?.n == null ? '历史样本 n 暂无' : null,
      '叙事单源或关键缺口未补齐',
    ].filter(Boolean),
    exitWhen: ['关键证据补齐且命题回 active', '合证可用且门禁通过'],
    weight: wRange.weight,
    weightBand: wRange.band,
    dataBound: true,
  };

  // —— A：趋势/结构跟随 ——
  let optionA;
  if (side === 'bull') {
    optionA = {
      id: 'A',
      label: '趋势跟随（偏多结构）',
      stance: 'follow',
      why: claim?.statement || '基准命题延续',
      enterWhen: [
        upgrade.text || '合证/基差与命题同向强化',
        sfReady ? structural.find((t) => t.id === 'stock_flow')?.text?.replace('翻转离开', '维持') : null,
        ps === 'mispriced' ? '误定价未收敛前可跟结构' : null,
      ].filter(Boolean),
      exitWhen: [falsify.text, ...structural.filter((t) => t.available && t.text).map((t) => t.text)].filter(Boolean),
      weight: wBase.weight,
      weightBand: wBase.band,
      dataBound: Boolean(claim?.claimId),
    };
  } else if (side === 'bear') {
    optionA = {
      id: 'A',
      label: '防御/偏空观察',
      stance: 'defend',
      why: claim?.statement || '基准命题延续',
      enterWhen: [
        upgrade.text || '压制结构延续（合证/期限）',
        sfReady ? '合证维持空头结构标签' : null,
      ].filter(Boolean),
      exitWhen: [falsify.text, ...structural.filter((t) => t.available && t.text).map((t) => t.text)].filter(Boolean),
      weight: wBase.weight,
      weightBand: wBase.band,
      dataBound: Boolean(claim?.claimId),
    };
  } else {
    optionA = {
      id: 'A',
      label: '突破跟随',
      stance: 'breakout',
      why: '主矛盾未明 · 仅在放量突破后启用',
      enterWhen: [upgrade.text || '放量突破区间 + 合证同向'],
      exitWhen: [falsify.text || '突破失败收回区间', '合证仍不可用则撤回'],
      weight: weightFor(scenarioLattice, 'upside').weight,
      weightBand: weightFor(scenarioLattice, 'upside').band,
      dataBound: Boolean(claim?.claimId),
    };
  }

  // —— B：均值回归 / 对立 ——
  const optionB = {
    id: 'B',
    label: side === 'bear' ? '反弹博弈' : side === 'bull' ? '均值回归' : '区间操作',
    stance: 'mean_revert',
    why:
      claim?.status === 'falsifying' || claim?.status === 'falsified'
        ? '主命题失效路径已激活'
        : '冲高回落 / 贴水走阔 / 持仓掉头时启用',
    enterWhen: [
      falsify.text,
      structural.find((t) => t.id === 'oi_1m')?.text,
      structural.find((t) => t.id === 'basis')?.text,
      '叙事热度见顶或疲劳',
    ].filter(Boolean),
    exitWhen: [upgrade.text || '对立触发撤回且基准结构恢复', '证伪时钟回到绿/黄以下'],
    weight: wFalsify.weight,
    weightBand: wFalsify.band,
    dataBound: Boolean(falsify.text || structural.some((t) => t.available)),
  };

  // 缺触发器时诚实标注
  for (const opt of [optionA, optionB, optionC]) {
    if (!opt.enterWhen.length) {
      opt.enterWhen = ['暂无明确进入条件 · 待校验'];
      opt.dataBound = false;
    }
    if (!opt.exitWhen.length) {
      opt.exitWhen = ['暂无明确退出条件 · 待校验'];
    }
  }

  // 推荐主方案（非方向箭头）
  let primaryId = 'C';
  let primaryReason = '默认追踪';
  if (claim?.publishBlocked || belief === '不可判定' || ps === 'unknown') {
    primaryId = 'C';
    primaryReason = '不可发布或定价未知 · 强制追踪';
  } else if (claim?.status === 'falsified') {
    primaryId = 'B';
    primaryReason = '命题已证伪 · 对立/改口路径优先';
  } else if (claim?.status === 'falsifying') {
    primaryId = 'C';
    primaryReason = '证伪进行中 · 先追踪再下注';
  } else if (hz?.preferChoiceC || hz?.hasConflict) {
    primaryId = 'C';
    primaryReason = `三尺度冲突 · ${hz.headline || '禁止合成单箭头'} · 偏追踪`;
    optionC.why = primaryReason;
    optionC.enterWhen = [
      hz.headline || '尺度冲突',
      ...(hz.conflicts || []).slice(0, 2).map((c) => c.display),
      '分尺度表述后再考虑 A/B',
    ].filter(Boolean);
  } else if (dual?.regime === 'split') {
    primaryId = 'C';
    primaryReason = `内外叙事分裂 · ${dual.regimeLabel || 'split'} · 偏追踪（禁合成方向）`;
    optionC.why = primaryReason;
    optionC.enterWhen = [
      dual.display || '内外分裂',
      '套利/波动/政策窗口待确认',
      '内外共振或单边确认后再考虑 A',
    ].filter(Boolean);
    optionB.enterWhen = [
      ...(optionB.enterWhen || []),
      '若确认套利/均值回归窗口可启用 B',
    ];
  } else if (ps === 'priced-in' && (wBase.weight == null || wBase.weight < 0.45)) {
    primaryId = 'C';
    primaryReason = '或已定价且基准权不足 · 观望';
  } else if (claim?.status === 'active' || claim?.status === 'watch') {
    primaryId = 'A';
    primaryReason = '命题有效 · 以结构跟随为主方案';
  }

  // 强路径同构：写入监视信号，不强制改主方案
  const isoBoard = inst?.intelCenter?.isomorphicBoard;
  if (isoBoard?.preferWatchSignals && isoBoard?.best?.watchSignals?.length) {
    const sig = isoBoard.best.watchSignals.slice(0, 2).join(' / ');
    optionA.enterWhen = [...(optionA.enterWhen || []), `同构监视兑现：${sig}`];
    optionC.enterWhen = [...(optionC.enterWhen || []), '同构路径强相似但信号未兑现 · 继续追踪'];
  }

  const options = [optionA, optionB, optionC];
  const primary = options.find((o) => o.id === primaryId) || optionC;

  const triggerInventory = [
    falsify.text
      ? { role: 'falsify', text: falsify.text, source: falsify.source, available: true }
      : { role: 'falsify', text: null, source: null, available: false, note: '暂无证伪触发器' },
    upgrade.text
      ? { role: 'upgrade', text: upgrade.text, source: upgrade.source, available: true }
      : { role: 'upgrade', text: null, source: null, available: false, note: '暂无强化触发器' },
    ...structural.map((t) => ({
      role: 'structural',
      id: t.id,
      text: t.text,
      source: t.source,
      available: t.available,
      note: t.note || null,
      nDisplay: t.nDisplay || null,
    })),
  ];

  const missingTriggers = triggerInventory.filter((t) => !t.available).length;

  return {
    version: CHOICE_VERSION,
    available: true,
    claimId: claim?.claimId || null,
    side,
    belief,
    pricingState: ps || null,
    primaryId,
    primary,
    options,
    triggerInventory,
    missingTriggers,
    weightsCalibrated: Boolean(scenarioLattice?.weightsCalibrated),
    n: scenarioLattice?.n ?? claim?.n ?? null,
    nDisplay: scenarioLattice?.nDisplay || (claim?.n != null ? String(claim.n) : '暂无'),
    display: `选择集 ${primaryId}:${primary.label} · 触发缺口 ${missingTriggers}${
      hz?.hasConflict ? ' · 尺度冲突偏C' : ''
    }${dual?.regime === 'split' ? ' · 内外分裂偏C' : ''}${isoBoard?.preferWatchSignals ? ' · 同构监视' : ''}`,
    horizonConflict: hz?.hasConflict
      ? { headline: hz.headline, severity: hz.severity, preferChoiceC: true }
      : null,
    dualSplit:
      dual?.regime === 'split'
        ? {
            regimeLabel: dual.regimeLabel,
            preferChoiceC: true,
            blockInterrupt: true,
            display: dual.display,
            nDisplay: dual.external?.nDisplay || dual.domestic?.nDisplay || '暂无',
          }
        : null,
    isomorphic: isoBoard?.preferWatchSignals
      ? {
          label: isoBoard.best?.label,
          pathTier: isoBoard.best?.pathTier,
          pathNDisplay: isoBoard.best?.pathNDisplay,
          watchSignals: isoBoard.best?.watchSignals || [],
        }
      : null,
    note: scenarioLattice?.weightsCalibrated
      ? '权重经 stateKey 校准 · 仍非客观概率'
      : '权重暂无（n不足）· 仅触发器驱动选择 · 禁止当概率',
    dataSource: 'intel-choice-set',
    method: 'trigger-bound-ABC',
  };
}

module.exports = {
  CHOICE_VERSION,
  buildChoiceSet,
  buildStructuralTriggers,
  weightFor,
};
