/**
 * 预期交易 · 情报因子聚合
 * 政策/资讯 → 供需预期（长/短）→ 库存·产量·消费 · 命题叙事 · 定价程度
 * 供 Cursor 与置顶资讯共用，禁止编造缺失字段
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { todaySessionDate } = require('./focus-read-state');
const { mergeOutlookWithSources } = require('./outlook-context-merge');
const { detectExpectationSurprise } = require('./focus-surprise-radar');

const FACTOR_VERSION = 'v1.55.0-fundamentals-lane';

function safeRequire(mod) {
  try {
    return require(mod);
  } catch {
    return null;
  }
}

function latestWarehouseSnapshot(symbol, barDate) {
  const wh = safeRequire('./shfe-warehouse-fetcher');
  if (!wh) return null;
  const id = normalizeCommodityId(symbol);
  const d = barDate || todaySessionDate();
  let row = wh.getWarehouseReceiptAtDate?.(id, d);
  if (!row?.warehouseReceipt) {
    const rows = wh.loadWarehouseRows?.(id);
    if (rows?.length) {
      const last = rows[rows.length - 1];
      row = {
        date: String(last.date || '').slice(0, 10),
        warehouseReceipt: last.warehouse_receipt != null ? Number(last.warehouse_receipt) : null,
        changeDod: last.change_dod != null ? Number(last.change_dod) : null,
        source: last.source || 'shfe-official',
        exchange: last.exchange || (String(last.source || '').includes('dce') ? 'DCE' : 'SHFE'),
      };
    }
  }
  if (!row) return null;
  return {
    date: row.date,
    level: row.warehouseReceipt,
    changeDod: row.changeDod,
    unit: row.unit || '吨',
    exchange: row.exchange || 'SHFE',
    dataSource: row.source || 'shfe-warehouse-fetcher',
  };
}

function latestLmeSnapshot(symbol, barDate) {
  const lme = safeRequire('./lme-inventory-fetcher');
  if (!lme?.metalForInstrument?.(symbol)) return null;
  const slot = lme.getInventoryAtDate?.(symbol, barDate || todaySessionDate());
  if (!slot) return null;
  return {
    weekEnding: slot.weekEnding,
    metal: slot.metal,
    levelTonnes: slot.inventoryTonnes,
    changeWow: slot.changeWow,
    dataSource: slot.source || 'lme-inventory-fetcher',
  };
}

function summarizeFundamentals(sources = {}, symbols = []) {
  const lane = sources.fundamentals;
  if (!lane?.indicators?.length) return { available: false, items: [], dataSource: 'missing' };

  const symSet = new Set((symbols || []).map(normalizeCommodityId));
  const rows = [];
  for (const ind of lane.indicators) {
    const tags = (ind.commodities || []).map((c) => normalizeCommodityId(c));
    if (symSet.size && !tags.some((t) => symSet.has(t))) continue;
    rows.push({
      id: ind.id,
      name: ind.name,
      value: ind.value ?? null,
      changePct: ind.changePct ?? null,
      category: ind.category,
      date: ind.date,
      note: ind.note || null,
      dataSource: ind.dataSource || lane.dataSource || 'commodity-fundamentals-fetcher',
    });
  }

  const commodityRows =
    symSet.size && lane.commodities
      ? (lane.commodities[[...symSet][0]]?.indicators || [])
      : [];

  const merged = rows.length ? rows : commodityRows;
  return {
    available: merged.length > 0,
    items: merged.slice(0, 6),
    version: lane.version,
    pending: Boolean(lane.pending),
    dataSource: 'commodity-fundamentals-fetcher',
  };
}

function summarizeMacroProduction(sources = {}) {
  const macro = sources.macro;
  if (!macro) return { available: false, items: [] };
  const rows = [];
  for (const g of macro.groups || []) {
    for (const ind of g.indicators || []) {
      if (ind.category !== 'production' && !/产出|零售|开工|消费|产量|PMI|工业/.test(ind.name || '')) continue;
      rows.push({
        id: ind.id,
        name: ind.name,
        value: ind.value ?? null,
        change: ind.change ?? ind.changePct ?? null,
        group: g.id || g.name,
        dataSource: ind.source || 'macro-fetcher',
      });
    }
  }
  return {
    available: rows.length > 0,
    items: rows.slice(0, 8),
    dataSource: 'macro-fetcher',
  };
}

function summarizePolicyLane(sources = {}, symbols = []) {
  const items = (sources.policy?.items || []).slice(0, 40);
  const symSet = new Set((symbols || []).map(normalizeCommodityId));
  const hits = [];
  for (const item of items) {
    const tags = (item.commodities || []).map((c) => normalizeCommodityId(c.id || c));
    if (symSet.size && !tags.some((t) => symSet.has(t))) continue;
    hits.push({
      title: item.title,
      stars: item.stars,
      direction: item.direction,
      department: item.departmentName || item.departmentId,
      dataSource: item.source || 'policy-fetcher',
    });
    if (hits.length >= 5) break;
  }
  return { count: hits.length, items: hits, dataSource: 'policy-fetcher' };
}

function loadActiveTheses(symbols = []) {
  const reg = safeRequire('./thesis-registry');
  if (!reg) return [];
  reg.ensureSeedData?.();
  const all = reg.getActiveTheses?.() || reg.queryActiveTheses?.() || [];
  const symSet = new Set((symbols || []).map(normalizeCommodityId));
  return all
    .filter((t) => {
      if (!symSet.size) return true;
      return (t.linkedSymbols || []).some((s) => symSet.has(normalizeCommodityId(s)));
    })
    .slice(0, 4)
    .map((t) => ({
      id: t.id,
      title: t.title || t.claim?.slice(0, 80),
      status: t.status,
      linkedSymbols: t.linkedSymbols,
      dataSource: 'thesis-registry',
    }));
}

function findOutlookInstrument(outlookPayload, symbol) {
  const id = normalizeCommodityId(symbol);
  const exchanges = outlookPayload?.commodities?.exchanges || outlookPayload?.exchanges || [];
  for (const ex of exchanges) {
    const hit = (ex.items || ex.instruments || []).find((i) => normalizeCommodityId(i.id) === id);
    if (hit) return hit;
  }
  const flat = outlookPayload?.instruments || outlookPayload?.commodityOutlook?.instruments;
  if (Array.isArray(flat)) return flat.find((i) => normalizeCommodityId(i.id) === id) || null;
  return null;
}

function assessPricedInDegree(item, outlookPayload = {}) {
  const symbols = item.symbols || (item.primarySymbol ? [item.primarySymbol] : []);
  if (!symbols.length) return { degree: null, label: '暂无品种对照', dataSource: 'expectation-factors' };

  const dir = item.direction;
  if (!dir || dir === 'neutral') return { degree: null, label: '方向中性', dataSource: 'expectation-factors' };

  let aligned = 0;
  let checked = 0;
  const evidence = [];

  for (const sym of symbols.slice(0, 4)) {
    const inst = findOutlookInstrument(outlookPayload, sym);
    const chg = inst?.changePct ?? inst?.changePercent;
    if (chg == null) continue;
    checked += 1;
    const bullishMove = chg > 0.25;
    const bearishMove = chg < -0.25;
    if ((dir === 'bullish' && bullishMove) || (dir === 'bearish' && bearishMove)) {
      aligned += 1;
      evidence.push(`${sym} 日内${chg > 0 ? '+' : ''}${chg.toFixed(2)}% 与资讯同向`);
    } else if ((dir === 'bullish' && bearishMove) || (dir === 'bearish' && bullishMove)) {
      evidence.push(`${sym} 日内${chg > 0 ? '+' : ''}${chg.toFixed(2)}% 与资讯背离`);
    }
  }

  if (!checked) return { degree: null, label: '现价待校验', evidence, dataSource: 'expectation-factors' };

  const ratio = aligned / checked;
  const degree = Math.round(ratio * 100);
  let label = '部分定价';
  if (degree >= 75) label = '预期已大部分反映';
  else if (degree <= 25) label = '预期未充分反映/存在惊喜';
  return { degree, label, evidence, dataSource: 'expectation-factors' };
}

function assessPinExpectationGap(item, outlookPayload = {}) {
  const symbols = item.symbols || (item.primarySymbol ? [item.primarySymbol] : []);
  if (!symbols.length) return null;
  let gapMod;
  try {
    gapMod = require('./expectation-gap');
  } catch {
    return null;
  }
  const gaps = [];
  for (const sym of symbols.slice(0, 3)) {
    const inst = findOutlookInstrument(outlookPayload, sym);
    if (!inst) continue;
    const theses = loadActiveTheses([sym]);
    const gap = gapMod.computeExpectationGap(
      {
        price: inst.price ?? inst.liveQuote?.price,
        changePct: inst.changePct,
        capitalAttention: inst.capitalAttention,
        tradingGuidance: inst.tradingGuidance,
        macroSynthesis: { activeTheses: theses },
      },
      { activeTheses: theses, tradingGuidance: inst.tradingGuidance }
    );
    gaps.push({ symbol: normalizeCommodityId(sym), ...gap });
  }
  if (!gaps.length) return { available: false, items: [], dataSource: 'expectation-gap' };
  const primary = gaps[0];
  return {
    available: true,
    primary,
    items: gaps,
    dataSource: 'expectation-gap',
    method: 'narrative-price-thesis+priced-in',
  };
}

/**
 * 单品种预期因子包（Cursor / 每日分析）
 */
function buildInstrumentExpectationContext(inst, outlookPayload = {}) {
  if (!inst) return null;
  const merged = mergeOutlookWithSources(outlookPayload);
  const sym = normalizeCommodityId(inst.id);
  const barDate = todaySessionDate();
  const inv = inst.factors?.inventory || null;

  return {
    version: FACTOR_VERSION,
    sessionDate: barDate,
    instrumentId: sym,
    expectationHorizons: {
      near: '日内~3日（资金/OI/仓单）',
      swing: '3日~2周（政策/天气/检修）',
      structural: '2周+（产业规划/关税/收储制度）',
    },
    inventory: inv || {
      warehouse: latestWarehouseSnapshot(sym, barDate),
      lme: latestLmeSnapshot(sym, barDate),
      oi: inst.factors?.oi || null,
      score: null,
      dataSource: inv?.dataSource || 'pending',
    },
    productionConsumption: {
      macro: summarizeMacroProduction(merged.sources || merged),
      fundamentals: summarizeFundamentals(merged.sources || merged, [sym]),
    },
    policy: summarizePolicyLane(merged.sources || merged, [sym]),
    theses: loadActiveTheses([sym]),
    newsFactor: inst.factors?.news
      ? {
          score: inst.factors.news.score,
          hitCount: inst.factors.news.hitCount,
          summary: inst.factors.news.summary,
          dataSource: 'commodity-outlook-engine',
        }
      : null,
    philosophy: inst.philosophy?.logicSummary
      ? { summary: inst.philosophy.logicSummary, dataSource: 'commodity-outlook-philosophy' }
      : null,
    dataSource: 'focus-expectation-factors',
  };
}

/**
 * 置顶资讯 · 预期对照（政策/资讯 vs 盘面定价程度）
 */
function buildPinExpectationContext(item, outlookPayload = {}) {
  const merged = mergeOutlookWithSources(outlookPayload);
  const symbols = item.symbols || (item.primarySymbol ? [item.primarySymbol] : []);
  const barDate = todaySessionDate();
  const inventorySnapshots = symbols.slice(0, 4).map((sym) => ({
    symbol: normalizeCommodityId(sym),
    warehouse: latestWarehouseSnapshot(sym, barDate),
    lme: latestLmeSnapshot(sym, barDate),
  }));

  const pricedIn = assessPricedInDegree(item, merged);
  const pricedInEngine = assessPinExpectationGap(item, merged);
  let newsPool = [];
  try {
    const { collectReleaseNewsPool } = require('./release-data-surprise');
    newsPool = collectReleaseNewsPool();
  } catch {
    // ignore
  }
  const surprise = detectExpectationSurprise(item, merged, pricedIn, { newsPool });
  const fundamentals = summarizeFundamentals(merged.sources || merged, symbols);

  return {
    version: FACTOR_VERSION,
    sessionDate: barDate,
    impactTier: item.impactTier,
    impactDimensions: item.impactDimensions || null,
    expectationReview:
      item.impactDimensions?.expectationReview ||
      item.impactDimensions?.relevance ||
      item.expectationReview ||
      null,
    pricedIn,
    pricedInEngine,
    surprise,
    inventorySnapshots: inventorySnapshots.filter((r) => r.warehouse || r.lme),
    productionConsumption: {
      macro: summarizeMacroProduction(merged.sources || merged),
      fundamentals,
    },
    policyLane: summarizePolicyLane(merged.sources || merged, symbols),
    activeTheses: loadActiveTheses(symbols),
    marketLogic:
      '市场持续交易预期：政策/资讯 → 供需预期（长短期）→ 库存/产量/消费 → 价格；须对照 surprise 雷达、pricedIn 与仓单变化判断惊喜或已定价',
    dataSource: 'focus-expectation-factors',
  };
}

module.exports = {
  FACTOR_VERSION,
  buildInstrumentExpectationContext,
  buildPinExpectationContext,
  assessPricedInDegree,
  latestWarehouseSnapshot,
  latestLmeSnapshot,
  summarizeMacroProduction,
  summarizeFundamentals,
  assessPinExpectationGap,
};
