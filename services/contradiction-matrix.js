/**
 * 矛盾矩阵 + 对立假说（多 / 空）
 * 轴：价格 / 仓单·资金合证 / 显性库存 / 持仓 / 会员 / 期限结构 / 研判 / 预期差
 * 仓单禁止单独定调；须 1w/1m/3m(/1y) 与持仓合证。缺失标「暂无」。
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const MATRIX_VERSION = 'v1.56.22-stock-flow-joint';

/** 长线证伪：半个月～月级波动门槛，而非日内噪声 */
const SWING_PRICE_DROP_PCT = 3.5;
const SWING_PRICE_RISE_PCT = 3.5;

function sideFromSigned(n, deadband = 0) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (Math.abs(v) <= deadband) return 'flat';
  return v > 0 ? 'bull' : 'bear';
}

function labelSide(side) {
  if (side === 'bull') return '多头';
  if (side === 'bear') return '空头';
  if (side === 'flat') return '中性';
  return '暂无';
}

function structureBiasToSide(bias) {
  if (bias === 'bull') return 'bull';
  if (bias === 'bear') return 'bear';
  if (bias === 'mixed') return 'flat';
  return null;
}

function loadStockFlow(symbol, asOf) {
  try {
    return require('./inventory-capital-joint').buildStockFlowJoint(symbol, asOf);
  } catch {
    return { available: false, reason: 'joint_module_unavailable' };
  }
}

function axisFromInst(inst, stockFlow) {
  const inv = inst?.factors?.inventory;
  const wh = inv?.warehouse;
  const visible = inv?.visibleInventory;
  const oi = inst?.technical?.oi || inv?.oi || inst?.oi;
  const gap = inst?.expectationGap || inst?.factors?.expectationGap;
  const dirRaw = inst?.qualifiedDirection?.label || inst?.bias || inst?.directionLabel || '';
  let dirSide = null;
  if (/偏多|看多|多头|强多/.test(dirRaw)) dirSide = 'bull';
  else if (/偏空|看空|空头|强空/.test(dirRaw)) dirSide = 'bear';
  else if (/震荡|中性|观望/.test(dirRaw)) dirSide = 'flat';

  // 仓单轴：只展示合证后的结构偏向；无合证则 side=null（禁止用 DoD 单读定多空）
  let whSide = null;
  let whValue = null;
  let whSource = wh?.source || inv?.dataSource || 'missing';
  if (stockFlow?.available) {
    whSide = structureBiasToSide(stockFlow.structureBias);
    whValue = stockFlow.display;
    whSource = stockFlow.dataSource;
  } else if (wh?.level != null) {
    whValue = `${wh.level}${wh.changeDod != null ? ` (日Δ${wh.changeDod})` : ''} ·待合证`;
    whSource = `${wh?.source || 'warehouse'}|awaiting_joint`;
  }

  const visibleSide =
    visible?.changeWow != null && Number.isFinite(Number(visible.changeWow))
      ? sideFromSigned(-Number(visible.changeWow), Math.max(0.1, Math.abs(Number(visible.level) || 0) * 0.002))
      : null;

  const priceSide = sideFromSigned(inst?.changePct, 0.15);

  // 持仓轴：优先多周期合证里的 1m OI；否则用即时 deltaPct
  let oiSide = null;
  let oiValue = null;
  let oiSource = 'missing';
  const oi1m = stockFlow?.horizons?.['1m']?.oiPct;
  if (oi1m != null && Number.isFinite(Number(oi1m))) {
    oiSide = sideFromSigned(Number(oi1m), 1.0);
    oiValue = `1m Δ${Number(oi1m).toFixed(2)}%`;
    oiSource = 'trading-oi-1m';
  } else if (oi?.deltaPct != null) {
    oiSide = sideFromSigned(oi.deltaPct, 0.5);
    oiValue = `Δ${Number(oi.deltaPct).toFixed(2)}%`;
    oiSource = 'oi';
  } else if (oi?.current != null) {
    oiValue = String(oi.current);
    oiSource = 'oi-level-only';
  }

  let gapSide = null;
  if (gap?.gap != null && Number.isFinite(Number(gap.gap))) {
    gapSide = sideFromSigned(Number(gap.gap), 0.05);
  } else if (gap?.overshoot === true) {
    gapSide = 'bear';
  } else if (gap?.pricedIn === true) {
    gapSide = 'flat';
  }

  return [
    {
      key: 'price',
      label: '价格',
      side: priceSide,
      value:
        inst?.changePct != null
          ? `${Number(inst.changePct).toFixed(2)}%`
          : inst?.price != null
            ? String(inst.price)
            : null,
      dataSource: inst?.priceSource || (inst?.changePct != null ? 'live-quote' : 'missing'),
    },
    {
      key: 'warehouse',
      label: '仓单·资金合证',
      side: whSide,
      value: whValue,
      dataSource: whSource,
      joint: stockFlow?.available
        ? {
            structureBias: stockFlow.structureBias,
            coherence: stockFlow.coherence,
            primaryRegime: stockFlow.primaryRegime,
            priceMayLag: stockFlow.priceMayLag,
            note: stockFlow.note,
          }
        : null,
    },
    {
      key: 'visibleInventory',
      label: '显性库存',
      side: visibleSide,
      value:
        visible?.available && visible.level != null
          ? `${visible.level}${visible.unit || ''}${visible.changeWow != null ? ` (Δ${visible.changeWow})` : ''} · ${visible.label || ''}`
          : null,
      dataSource: visible?.dataSource || 'missing',
    },
    {
      key: 'oi',
      label: '持仓',
      side: oiSide,
      value: oiValue,
      dataSource: oiSource,
    },
    {
      key: 'direction',
      label: '研判',
      side: dirSide,
      value: dirRaw || null,
      dataSource: inst?.qualifiedDirection ? 'qualifiedDirection' : dirRaw ? 'bias' : 'missing',
    },
    {
      key: 'expectation',
      label: '预期差',
      side: gapSide,
      value:
        gap?.gap != null
          ? String(gap.gap)
          : gap?.label || (gap?.overshoot ? 'overshoot' : gap?.pricedIn ? 'priced-in' : null),
      dataSource: gap?.dataSource || (gap ? 'expectation-gap' : 'missing'),
    },
  ];
}

function enrichWithMemberPosi(axes, symbol) {
  try {
    const { loadMemberOiFeatures } = require('./member-oi-features');
    const feat = loadMemberOiFeatures(symbol);
    if (!feat?.available) {
      axes.push({
        key: 'memberOi',
        label: '会员持仓',
        side: null,
        value: null,
        dataSource: feat?.reason || 'missing',
      });
      return;
    }
    const side = sideFromSigned(feat.netSub, Math.max(50, Math.abs(Number(feat.buySub) || 0) * 0.02));
    const conc =
      feat.buyTop5Share != null ? `买Top5 ${(feat.buyTop5Share * 100).toFixed(1)}%` : '';
    axes.push({
      key: 'memberOi',
      label: '会员持仓',
      side,
      value: `净Δ${feat.netSub ?? '—'} · ${conc} · ${feat.contractId || ''}`.trim(),
      dataSource: feat.dataSource,
      tradeDate: feat.tradeDate || null,
      features: feat,
    });
  } catch {
    axes.push({
      key: 'memberOi',
      label: '会员持仓',
      side: null,
      value: null,
      dataSource: 'missing',
    });
  }
}

function enrichWithTermStructure(axes, symbol) {
  try {
    const term = require('./term-structure-fetcher');
    const today = new Date().toISOString().slice(0, 10);
    let slot = term.getTermStructureAtDate?.(symbol, today);
    if (!slot || slot.spreadPct == null) {
      const rows = term.loadTermStructureRows?.(symbol);
      if (rows?.length) {
        const last = rows[rows.length - 1];
        const spreadPct = last.spread_pct ?? last.spreadPct ?? null;
        slot = {
          spreadPct: spreadPct != null ? Number(spreadPct) : null,
          zScore: last.z_score ?? last.zScore ?? null,
          source: last.source || 'term_structure',
          date: String(last.date || '').slice(0, 10),
        };
      }
    }
    if (!slot || slot.spreadPct == null) {
      axes.push({
        key: 'basis',
        label: '期限结构',
        side: null,
        value: null,
        dataSource: 'missing',
      });
      return;
    }
    const side = sideFromSigned(-Number(slot.spreadPct), 0.15);
    axes.push({
      key: 'basis',
      label: '期限结构',
      side,
      value: `价差 ${Number(slot.spreadPct).toFixed(2)}%${
        slot.zScore != null ? ` · z${Number(slot.zScore).toFixed(2)}` : ''
      }${slot.date ? ` · ${slot.date}` : ''}`,
      dataSource: slot.source || 'term-structure',
    });
  } catch {
    axes.push({
      key: 'basis',
      label: '期限结构',
      side: null,
      value: null,
      dataSource: 'missing',
    });
  }
}

function buildPairs(axes) {
  const withSide = axes.filter((a) => a.side && a.side !== 'flat');
  const cells = [];
  for (let i = 0; i < withSide.length; i += 1) {
    for (let j = i + 1; j < withSide.length; j += 1) {
      const a = withSide[i];
      const b = withSide[j];
      const conflict = a.side !== b.side;
      cells.push({
        a: a.key,
        b: b.key,
        aLabel: a.label,
        bLabel: b.label,
        aSide: a.side,
        bSide: b.side,
        relation: conflict ? '矛盾' : '同向',
        conflict,
      });
    }
  }
  return cells;
}

function buildCompetingHypotheses(inst, axes, cells, stockFlow) {
  const symbol = normalizeCommodityId(inst?.id || inst?.symbol || '');
  const name = inst?.name || symbol.toUpperCase();
  const conflicts = cells.filter((c) => c.conflict);
  const visible = axes.find((a) => a.key === 'visibleInventory');
  const basis = axes.find((a) => a.key === 'basis');
  const member = axes.find((a) => a.key === 'memberOi');

  const longEvidence = [];
  const shortEvidence = [];
  for (const ax of axes) {
    if (ax.side === 'bull' && ax.value) longEvidence.push(`${ax.label}:${ax.value}`);
    if (ax.side === 'bear' && ax.value) shortEvidence.push(`${ax.label}:${ax.value}`);
  }
  if (stockFlow?.available && stockFlow.display) {
    const tag = `合证(${stockFlow.primaryHorizon}):${stockFlow.primaryLabel}`;
    if (stockFlow.supportsLong && !longEvidence.some((e) => e.includes('合证'))) {
      longEvidence.unshift(tag);
    }
    if (stockFlow.supportsShort && !shortEvidence.some((e) => e.includes('合证'))) {
      shortEvidence.unshift(tag);
    }
  }

  const price = inst?.price != null ? Number(inst.price) : null;
  const jointOk = Boolean(stockFlow?.available);

  const longFalsify = [];
  const shortFalsify = [];
  if (price != null) {
    longFalsify.push(
      `摆动收盘跌破 ${price} 的 ${SWING_PRICE_DROP_PCT}%（约半个月～月级）且 1m/3m 仓单·资金合证转为「累库+增仓」`
    );
    shortFalsify.push(
      `摆动收盘涨破 ${price} 的 ${SWING_PRICE_RISE_PCT}% 且 1m/3m 仓单·资金合证转为「去库+增仓」`
    );
  } else {
    longFalsify.push('摆动级别失守且合证转为累库+增仓');
    shortFalsify.push('摆动级别突破且合证转为去库+增仓');
  }

  if (jointOk) {
    longFalsify.push(
      '近1月或近3月仓单显著累库且持仓同步增仓（资金配合累库），价格无力跟涨；仅仓单累库、持仓未配合则标待对照不证伪'
    );
    shortFalsify.push(
      '近1月或近3月仓单显著去库且持仓同步增仓（资金确认紧库存），价格拒跌失效；仅仓单去库、持仓离场则可能价格滞后'
    );
    if (stockFlow.priceMayLag) {
      longFalsify.push('合证分歧/资金离场时仅记「价格滞后待兑现」，禁止用日增减强行解释');
      shortFalsify.push('合证分歧/资金离场时仅记「价格滞后待兑现」，禁止用日增减强行解释');
    }
  } else {
    longFalsify.push('仓单·资金合证数据不足 · 证伪条件待对照（不据单日仓单定罪）');
    shortFalsify.push('仓单·资金合证数据不足 · 证伪条件待对照（不据单日仓单定罪）');
  }

  if (visible?.value) {
    longFalsify.push('显性库存相对上周显著累库且周度持仓未收缩配合');
    shortFalsify.push('显性库存相对上周显著去库且周度持仓扩张配合');
  }
  if (member?.value) {
    longFalsify.push('会员净增减与 1m 合证同时转空头结构');
    shortFalsify.push('会员净增减与 1m 合证同时转多头结构');
  }
  if (basis?.value) {
    longFalsify.push('期限结构由贴水转升水且价格走弱，并与累库+增仓合证同向');
    shortFalsify.push('期限结构由升水转贴水且价格走强，并与去库+增仓合证同向');
  }

  const commonRules = {
    priceDropPct: SWING_PRICE_DROP_PCT,
    priceRisePct: SWING_PRICE_RISE_PCT,
    baselinePrice: price,
    requireStockFlowJoint: true,
    requireWarehouseReversal: false,
    horizons: ['1m', '3m'],
    method: 'stock-flow-joint-falsify',
  };

  return [
    {
      id: `hyp-long-${symbol}`,
      side: 'long',
      label: '多头假说',
      claim:
        longEvidence.length > 0
          ? `${name} 多头假说：${longEvidence.slice(0, 3).join('；')}`
          : `${name} 多头假说：证据不足（待校验）`,
      falsify: longFalsify.join('；'),
      falsifyRules: { ...commonRules, side: 'long' },
      evidence: longEvidence,
      status: longEvidence.length ? 'active' : 'pending',
      linkedSymbols: symbol ? [symbol] : [],
      who: '矛盾矩阵',
      sourceTier: 'C',
      dataSource: 'contradiction-matrix',
      method: 'stock-flow-joint-evidence',
      extractedBy: 'contradiction-matrix',
      stockFlowSummary: stockFlow?.available
        ? {
            structureBias: stockFlow.structureBias,
            coherence: stockFlow.coherence,
            primaryLabel: stockFlow.primaryLabel,
            priceMayLag: stockFlow.priceMayLag,
          }
        : null,
    },
    {
      id: `hyp-short-${symbol}`,
      side: 'short',
      label: '空头假说',
      claim:
        shortEvidence.length > 0
          ? `${name} 空头假说：${shortEvidence.slice(0, 3).join('；')}`
          : `${name} 空头假说：证据不足（待校验）`,
      falsify: shortFalsify.join('；'),
      falsifyRules: { ...commonRules, side: 'short' },
      evidence: shortEvidence,
      status: shortEvidence.length ? 'active' : 'pending',
      linkedSymbols: symbol ? [symbol] : [],
      who: '矛盾矩阵',
      sourceTier: 'C',
      dataSource: 'contradiction-matrix',
      method: 'stock-flow-joint-evidence',
      extractedBy: 'contradiction-matrix',
      stockFlowSummary: stockFlow?.available
        ? {
            structureBias: stockFlow.structureBias,
            coherence: stockFlow.coherence,
            primaryLabel: stockFlow.primaryLabel,
            priceMayLag: stockFlow.priceMayLag,
          }
        : null,
    },
  ].map((h) => ({
    ...h,
    conflictCount: conflicts.length,
    conflictSummary: conflicts.length
      ? conflicts
          .slice(0, 3)
          .map((c) => `${c.aLabel}/${c.bLabel}`)
          .join('、')
      : '暂无显著矛盾',
  }));
}

function buildContradictionMatrix(inst, options = {}) {
  const symbol = normalizeCommodityId(inst?.id || inst?.symbol || '');
  const asOf =
    inst?.factors?.inventory?.warehouse?.date ||
    inst?.judgementAsOf ||
    new Date().toISOString().slice(0, 10);
  const stockFlow = loadStockFlow(symbol, asOf);
  const axes = axisFromInst(inst, stockFlow);
  if (options.includeMemberOi !== false) enrichWithMemberPosi(axes, symbol);
  if (options.includeBasis !== false) enrichWithTermStructure(axes, symbol);
  const cells = buildPairs(axes);
  const conflicts = cells.filter((c) => c.conflict);
  const available = axes.filter((a) => a.value != null && a.side != null).length;
  const competingHypotheses = buildCompetingHypotheses(inst, axes, cells, stockFlow);

  let summary = '暂无';
  if (available < 2) summary = '轴数据不足 · 待校验';
  else if (stockFlow?.available && stockFlow.priceMayLag) {
    summary = `合证${stockFlow.primaryLabel} · 价格或滞后 · ${conflicts.length}组矛盾`;
  } else if (!conflicts.length) summary = `信号同向（${available}轴）`;
  else summary = `${conflicts.length} 组矛盾 · 优先观察合证证伪`;

  const postureHint =
    conflicts.length >= 4 ? '观望' : conflicts.length >= 2 ? '试仓上限' : null;

  return {
    version: MATRIX_VERSION,
    symbol,
    summary,
    availableAxes: available,
    conflictCount: conflicts.length,
    postureHint,
    stockFlow: stockFlow?.available
      ? {
          available: true,
          display: stockFlow.display,
          structureBias: stockFlow.structureBias,
          coherence: stockFlow.coherence,
          primaryHorizon: stockFlow.primaryHorizon,
          primaryLabel: stockFlow.primaryLabel,
          priceMayLag: stockFlow.priceMayLag,
          note: stockFlow.note,
          dataSource: stockFlow.dataSource,
          method: stockFlow.method,
        }
      : {
          available: false,
          reason: stockFlow?.reason || 'missing',
          note: stockFlow?.note || '仓单·资金合证暂无',
        },
    axes: axes.map((a) => ({
      ...a,
      sideLabel: labelSide(a.side),
      display: a.value != null ? a.value : '暂无',
    })),
    cells,
    competingHypotheses,
    asOf: inst?.judgementUpdatedAt || new Date().toISOString(),
    dataSource: 'contradiction-matrix',
  };
}

function persistCompetingHypotheses(matrix) {
  if (!matrix?.competingHypotheses?.length) return { upserted: 0 };
  let upserted = 0;
  try {
    const reg = require('./thesis-registry');
    for (const h of matrix.competingHypotheses) {
      if (h.status === 'pending' && !(h.evidence || []).length) continue;
      reg.upsertThesis({
        id: h.id,
        who: h.who || '矛盾矩阵',
        claim: h.claim,
        falsify: h.falsify,
        falsifyRules: h.falsifyRules,
        status: h.status === 'pending' ? 'active' : h.status,
        linkedSymbols: h.linkedSymbols,
        sourceTier: h.sourceTier || 'C',
        extractedBy: h.extractedBy || 'contradiction-matrix',
        method: h.method,
        dataSource: h.dataSource,
        conflictCount: h.conflictCount,
        seed: false,
      });
      upserted += 1;
    }
  } catch {
    return { upserted: 0, error: 'thesis-registry_unavailable' };
  }
  return { upserted };
}

function attachContradictionToIntel(intel, inst) {
  const matrix = buildContradictionMatrix(inst);
  persistCompetingHypotheses(matrix);
  return {
    ...intel,
    contradictionMatrix: matrix,
    competingHypotheses: matrix.competingHypotheses,
  };
}

module.exports = {
  MATRIX_VERSION,
  buildContradictionMatrix,
  persistCompetingHypotheses,
  attachContradictionToIntel,
  sideFromSigned,
  SWING_PRICE_DROP_PCT,
  SWING_PRICE_RISE_PCT,
};
