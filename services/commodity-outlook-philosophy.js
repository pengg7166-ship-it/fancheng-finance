/**
 * 大宗走势研判哲学层 — Price = Supply/Demand × Financial Environment
 * 所有板块数据汇入 outlook；主矛盾/次矛盾分级；原油之母传导
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const PHILOSOPHY_VERSION = 'v1.26.0';

const SUPPLY_SIDE_KEYWORDS = [
  '增产', '扩产', '库存高企', '供应过剩', '累库', '进口大增', '投放', '复产', '产能释放',
  'supply surplus', 'inventory build', 'output increase',
];
const DEMAND_SIDE_KEYWORDS = [
  '减产', '去库存', '去库', '短缺', '供不应求', '抢运', '补库', '需求回暖',
  'destocking', 'shortage', 'demand recovery',
];

/** 供需状态：供强需弱 | 均衡 | 供弱需强 */
const SD_STATES = {
  supplyStrong: 'supplyStrong', // 供强需弱
  balanced: 'balanced',
  demandStrong: 'demandStrong', // 供弱需强
};

const SD_STATE_LABELS = {
  supplyStrong: '供强需弱',
  balanced: '供需均衡',
  demandStrong: '供弱需强',
};

const FINANCE_LABELS = {
  loose: '金融宽松',
  neutral: '金融中性',
  tight: '金融紧缩',
};

/**
 * SD×Finance 矩阵（用户范式）
 * | SD state   | loose                          | tight                    |
 * |------------|--------------------------------|--------------------------|
 * | 供强需弱   | 偏弱；小涨/震荡、幅度有限      | 明显走弱                 |
 * | 供弱需强   | 大幅走强（08/20 Fed放水范式）  | 偏强但涨幅受限           |
 */
const SD_FINANCE_MATRIX = {
  supplyStrong: {
    loose: { score: -0.12, bias: 'bearish', note: '宽松环境下小涨/震荡，幅度有限、不强势' },
    neutral: { score: -0.32, bias: 'bearish', note: '供需压制，震荡偏弱' },
    tight: { score: -0.62, bias: 'bearish', note: '紧缩环境下明显走弱' },
  },
  balanced: {
    loose: { score: 0.12, bias: 'bullish', note: '流动性支撑，温和偏多' },
    neutral: { score: 0, bias: 'neutral', note: '供需与金融均中性' },
    tight: { score: -0.18, bias: 'bearish', note: '金融收紧，温和承压' },
  },
  demandStrong: {
    loose: { score: 0.72, bias: 'bullish', note: '08/20 Fed放水范式：大幅走强', paradigm0820: true },
    neutral: { score: 0.38, bias: 'bullish', note: '需求主导，偏强' },
    tight: { score: 0.22, bias: 'bullish', note: '偏强但涨幅受限（金融环境制约）' },
  },
};

/** 政策事件画像 → 品种主矛盾 */
const POLICY_EVENT_PROFILES = [
  {
    id: 'supplySideReform',
    label: '供给侧改革',
    keywords: ['供给侧', '供给侧改革', '侧供给', '产能淘汰', 'supply-side reform'],
    instruments: ['zc', 'ZC', 'jm', 'sc', 'fu'],
    defaultDirection: 'bullish',
  },
  {
    id: 'antiInvolution',
    label: '反内卷',
    keywords: ['反内卷', '内卷', '减产自律', '去产能'],
    instruments: ['FG', 'ps', 'jm', 'lc'],
    defaultDirection: 'bullish',
  },
  {
    id: 'indonesiaExport',
    label: '印尼出口管制',
    keywords: ['印尼', '出口禁令', '出口管制', 'Indonesia export', 'nickel ban', 'palm export ban'],
    instruments: ['ni', 'p'],
    defaultDirection: 'bullish',
  },
];

/** 地缘区域 → 品种 */
const GEO_REGION_MAP = [
  { keywords: ['俄乌', '乌克兰', 'Ukraine', 'Russia war', '黑海'], instruments: ['sc', 'fu', 'WH', 'c', 'm'], label: '俄乌' },
  { keywords: ['伊朗', '霍尔木兹', '中东', 'OPEC', '红海', '胡塞'], instruments: ['sc', 'fu', 'lu', 'bu'], label: '中东能源' },
  { keywords: ['台海', '南海', 'Taiwan Strait'], instruments: ['sc', 'cu', 'bc'], label: '亚太供应链' },
];

/** 灾害物流 → 矿山/产区 */
const CLIMATE_DISASTER_MAP = [
  { keywords: ['洪灾', '洪水', '暴雨', '汛情'], regions: ['河南', '山西', '陕西', '内蒙', '河北'], commodities: ['zc', 'ZC', 'jm', 'i', 'j'], spikeDays: 2 },
  { keywords: ['道路', '交通中断', '物流', '停产', '矿山'], regions: [], commodities: ['zc', 'ZC', 'jm', 'i', 'cu', 'ni'], spikeDays: 3 },
  { keywords: ['干旱', '霜冻', '寒潮'], regions: [], commodities: ['c', 'm', 'y', 'p', 'CF', 'SR', 'WH'], spikeDays: 5 },
];

const SECONDARY_FACTOR_CAP = 0.15;
const PRIMARY_STRONG_SECONDARY_CAP = 0.1;
const PRIMARY_STRONG_THRESHOLD = 0.35;
const WEIGHT_PRICE_FEEDBACK = { min: 0.22, max: 0.28, default: 0.25 };
const WEIGHT_CAPITAL_SENTIMENT = { min: 0.18, max: 0.22, default: 0.2 };

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function classifySdState(score) {
  if (score >= 0.18) return SD_STATES.demandStrong;
  if (score <= -0.18) return SD_STATES.supplyStrong;
  return SD_STATES.balanced;
}

function textIncludesAny(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.some((kw) => {
    const k = String(kw).toLowerCase();
    return k.length >= 2 && (lower.includes(k) || String(text).includes(kw));
  });
}

function itemRelevantToInstrument(item, instrumentId, aliases = []) {
  const norm = normalizeCommodityId(instrumentId);
  if ((item.commodities || []).some((c) => normalizeCommodityId(c.id) === norm)) return true;
  const text = `${item.title || ''} ${item.summary || ''} ${item.commodityImpactSummary || ''}`;
  if (aliases.some((a) => textIncludesAny(text, [a]))) return true;
  return textIncludesAny(text, [instrumentId]);
}

function findForexPair(forexSource, id) {
  if (forexSource?.pairs?.length) {
    const hit = forexSource.pairs.find((p) => p.id === id);
    if (hit) return hit;
  }
  for (const g of forexSource?.groups || []) {
    const hit = (g.pairs || []).find((p) => p.id === id);
    if (hit) return hit;
  }
  return null;
}

function findIndicator(indicators, id) {
  return (indicators || []).find((i) => i.id === id);
}

function findUsIndices(indicesSource) {
  const usIds = new Set(['sp500', 'dji', 'ixic']);
  const out = [];
  for (const region of indicesSource?.regions || []) {
    for (const idx of region.indices || []) {
      if (usIds.has(idx.id)) out.push(idx);
    }
  }
  return out;
}

function scoreMacroChina(macroSource) {
  const groups = macroSource?.groups || [];
  let score = 0;
  let hits = 0;
  for (const g of groups) {
    if (g.id !== 'cn' && g.group !== 'cn' && !/中国|cn/i.test(g.name || g.id || '')) continue;
    for (const ind of g.indicators || []) {
      const chg = parseFloat(ind.change ?? ind.changePct ?? ind.mom);
      if (Number.isNaN(chg)) continue;
      hits += 1;
      const name = `${ind.name || ''} ${ind.id || ''}`;
      if (/pmi|景气|制造/i.test(name)) score += clamp(chg / 3, -0.25, 0.25);
      else if (/cpi|ppi|物价/i.test(name)) score += clamp(-chg / 5, -0.15, 0.15);
      else if (/信贷|社融|m2|货币/i.test(name)) score += clamp(chg / 8, -0.2, 0.2);
      else score += clamp(chg / 10, -0.1, 0.1);
    }
  }
  if (hits === 0) return { score: 0, summary: '宏观中国数据暂缺', hits: 0 };
  const s = clamp(score, -1, 1);
  return {
    score: s,
    hits,
    summary: s > 0.15 ? '中国宏观偏暖，内需品种获支撑' : s < -0.15 ? '中国宏观偏冷，工业需求承压' : '中国宏观中性',
  };
}

/**
 * 供需评估：政策/气候/地缘/库存/OI/资讯 + 宏观中国
 * @returns {{ score: number, state: string, stateLabel: string, components: object, summary: string }}
 */
function assessSupplyDemand(instrument, policy, climate, geo, inventory, news, macroChina = null) {
  const id = instrument.id || instrument;
  const aliases = instrument.newsAliases || instrument.aliases || [];
  const sector = instrument.sector || 'metals';
  const isAgri = sector === 'agriculture';

  let supplyPressure = 0;
  let demandSupport = 0;
  let weight = 0;

  const ingestItems = (items, w, dirField = 'direction') => {
    for (const item of (items || []).slice(0, 40)) {
      if (!itemRelevantToInstrument(item, id, aliases)) continue;
      const stars = (item.stars || 2) / 5;
      const itemW = w * stars;
      const dir = item[dirField] || 'neutral';
      if (dir === 'bullish') demandSupport += itemW;
      else if (dir === 'bearish') supplyPressure += itemW;
      weight += itemW;
    }
  };

  ingestItems(policy?.items, 1.0);
  ingestItems(geo?.items, 0.85);
  ingestItems(climate?.items, isAgri ? 1.1 : 0.65);

  for (const item of (policy?.items || []).slice(0, 30)) {
    if (!itemRelevantToInstrument(item, id, aliases)) continue;
    const text = `${item.title || ''} ${item.summary || ''}`;
    if (textIncludesAny(text, SUPPLY_SIDE_KEYWORDS)) {
      supplyPressure += 0.45;
      weight += 0.35;
    }
    if (textIncludesAny(text, DEMAND_SIDE_KEYWORDS)) {
      demandSupport += 0.45;
      weight += 0.35;
    }
  }

  const inv = inventory || {};
  if (inv.deltaPct != null) {
    const oiW = 0.65;
    if (inv.deltaPct > 2) supplyPressure += oiW * 0.55;
    else if (inv.deltaPct > 1) supplyPressure += oiW * 0.35;
    else if (inv.deltaPct < -2) demandSupport += oiW * 0.55;
    else if (inv.deltaPct < -1) demandSupport += oiW * 0.35;
    weight += oiW;
  }
  if (inv.volumeRatio != null) {
    const vr = inv.volumeRatio;
    if (vr > 1.35) {
      demandSupport += 0.28;
      if (inv.deltaPct > 0.5) supplyPressure += 0.12;
    } else if (vr < 0.72) supplyPressure += 0.18;
    weight += 0.32;
  }
  if (inv.oiBuildDays != null && inv.oiBuildDays >= 3) {
    supplyPressure += 0.25;
    weight += 0.2;
  }

  if (news?.score != null && Math.abs(news.score) > 0.05) {
    const nw = (news.weight || 1) * 0.5;
    if (news.score > 0) demandSupport += nw * Math.abs(news.score);
    else supplyPressure += nw * Math.abs(news.score);
    weight += nw;
  }

  const china = macroChina || { score: 0 };
  if (china.score) {
    demandSupport += Math.max(0, china.score) * 0.45;
    supplyPressure += Math.max(0, -china.score) * 0.35;
    weight += 0.4;
  }

  const raw = weight > 0 ? (demandSupport - supplyPressure) / weight : 0;
  const score = clamp(raw, -1, 1);
  const state = classifySdState(score);
  return {
    score: +score.toFixed(4),
    state,
    stateLabel: SD_STATE_LABELS[state],
    components: {
      demandSupport: +demandSupport.toFixed(3),
      supplyPressure: +supplyPressure.toFixed(3),
      macroChina: china.score ?? 0,
      weight: +weight.toFixed(3),
    },
    summary: `${SD_STATE_LABELS[state]}（${score >= 0 ? '+' : ''}${score.toFixed(2)}）`,
  };
}

function computeDffTrend(fed) {
  const dffRow = findIndicator(fed?.indicators, 'DFF');
  const dff = parseFloat(dffRow?.value);
  const chg = parseFloat(dffRow?.change ?? dffRow?.changePct);
  if (Number.isNaN(dff)) return { dff: null, trend: 0 };
  let trend = 0;
  if (!Number.isNaN(chg)) {
    if (chg <= -0.15) trend += 0.18;
    else if (chg >= 0.15) trend -= 0.18;
  }
  return { dff, trend };
}

function computeM2YoYProxy(fed) {
  const m2 = findIndicator(fed?.indicators, 'M2SL');
  const chg = parseFloat(m2?.change ?? m2?.changePct ?? m2?.yoy);
  if (Number.isNaN(chg)) return { yoyProxy: null, score: 0 };
  let score = 0;
  if (chg >= 6) score += 0.14;
  else if (chg >= 3) score += 0.08;
  else if (chg <= 0) score -= 0.1;
  return { yoyProxy: chg, score };
}

function applyFinanceRegimeHysteresis(rawScore, prevRegime = 'neutral') {
  const ENTER_LOOSE = 0.26;
  const EXIT_LOOSE = 0.14;
  const ENTER_TIGHT = -0.26;
  const EXIT_TIGHT = -0.14;
  let regime = prevRegime || 'neutral';

  if (regime === 'loose') {
    if (rawScore <= EXIT_LOOSE && rawScore <= ENTER_TIGHT) regime = 'tight';
    else if (rawScore <= EXIT_LOOSE) regime = 'neutral';
  } else if (regime === 'tight') {
    if (rawScore >= EXIT_TIGHT && rawScore >= ENTER_LOOSE) regime = 'loose';
    else if (rawScore >= EXIT_TIGHT) regime = 'neutral';
  } else if (rawScore >= ENTER_LOOSE) {
    regime = 'loose';
  } else if (rawScore <= ENTER_TIGHT) {
    regime = 'tight';
  } else {
    regime = 'neutral';
  }

  return regime;
}

/**
 * 金融环境：DFF趋势 + M2 YoY代理 + VIX + DXY + 美股 → loose|neutral|tight（带滞后）
 */
function assessFinancialEnvironment(fed, boj, forex, indices, options = {}) {
  let score = 0;
  const parts = [];

  const { dff, trend: dffTrend } = computeDffTrend(fed);
  const vix = parseFloat(findIndicator(fed?.indicators, 'VIXCLS')?.value);
  const { yoyProxy: m2YoY, score: m2Score } = computeM2YoYProxy(fed);
  const spread = parseFloat(findIndicator(fed?.indicators, 'T10Y2Y')?.value);

  if (!Number.isNaN(dff)) {
    if (dff <= 1.5) score += 0.35;
    else if (dff <= 2.5) score += 0.12;
    else if (dff >= 5) score -= 0.38;
    else if (dff >= 4) score -= 0.22;
    parts.push(`FFR ${dff.toFixed(2)}%`);
  }
  score += dffTrend;
  if (dffTrend !== 0) parts.push(`FFR趋势${dffTrend > 0 ? '↓' : '↑'}`);
  score += m2Score;
  if (m2YoY != null) parts.push(`M2 YoY代理 ${m2YoY >= 0 ? '+' : ''}${m2YoY.toFixed(1)}%`);
  if (!Number.isNaN(spread) && spread < -0.2) score -= 0.12;

  const dxy = findForexPair(forex, 'dxy');
  const dxyChg = Number(dxy?.changePct) || 0;
  if (dxyChg > 0.2) score -= 0.15;
  else if (dxyChg < -0.2) score += 0.12;
  if (dxy) parts.push(`DXY ${dxyChg >= 0 ? '+' : ''}${dxyChg.toFixed(2)}%`);

  const usIdx = findUsIndices(indices);
  const avgChg = usIdx.length ? usIdx.reduce((s, i) => s + (Number(i.changePct) || 0), 0) / usIdx.length : 0;
  const vixSafe = Number.isNaN(vix) ? 20 : vix;
  score += clamp(avgChg / 2.5, -0.2, 0.2);
  if (vixSafe > 26) score -= 0.18;
  else if (vixSafe < 18) score += 0.08;
  parts.push(`VIX ${vixSafe.toFixed(1)}`);

  const bojInd = boj?.indicators || [];
  const rateRow =
    bojInd.find((i) => /隔夜|拆借|政策利率|rate/i.test(i.name)) ||
    bojInd.find((i) => i.id === 'IRSTCI01JPM156N');
  const bojRate = parseFloat(rateRow?.value);
  if (!Number.isNaN(bojRate) && bojRate <= 0) score += 0.12;
  else if (!Number.isNaN(bojRate) && bojRate >= 0.75) score -= 0.06;

  const riskAppetite = computeGlobalRiskAppetite(indices, fed);
  score += riskAppetite.modifier;

  score = clamp(score, -1, 1);
  const prevRegime = options.prevRegime || 'neutral';
  const regime = applyFinanceRegimeHysteresis(score, prevRegime);

  return {
    regime,
    regimeLabel: FINANCE_LABELS[regime],
    score: +score.toFixed(4),
    dffTrend,
    m2YoYProxy: m2YoY,
    riskAppetite,
    summary:
      regime === 'loose'
        ? '流动性宽松（低利率/弱美元/风险偏好）'
        : regime === 'tight'
          ? '金融紧缩（高利率/强美元/恐慌偏高）'
          : '金融环境中性',
    detail: parts.join(' · '),
    bojRate: Number.isNaN(bojRate) ? null : bojRate,
  };
}

function computeGlobalRiskAppetite(indices, fed) {
  const usIdx = findUsIndices(indices);
  const avgChg = usIdx.length ? usIdx.reduce((s, i) => s + (Number(i.changePct) || 0), 0) / usIdx.length : 0;
  const vix = parseFloat(findIndicator(fed?.indicators, 'VIXCLS')?.value);
  const vixSafe = Number.isNaN(vix) ? 20 : vix;
  let modifier = 0;
  let label = '风险偏好中性';
  if (avgChg > 0.3 && vixSafe < 22) {
    modifier = 0.1;
    label = '风险偏好回升';
  } else if (avgChg < -0.4 && vixSafe > 24) {
    modifier = -0.14;
    label = '避险情绪升温';
  } else if (vixSafe > 28) {
    modifier = -0.1;
    label = '恐慌压制风险资产';
  }
  return { modifier: +modifier.toFixed(4), label, vix: vixSafe, usAvgChange: +avgChg.toFixed(3) };
}

/**
 * SD×Finance 矩阵查表
 */
function combineSdFinance(sdScore, finance) {
  const state = typeof sdScore === 'object' ? sdScore.state || classifySdState(sdScore.score ?? 0) : classifySdState(sdScore);
  const sdVal = typeof sdScore === 'object' ? sdScore.score ?? 0 : sdScore;
  const finRegime = finance?.regime || 'neutral';
  const cell = SD_FINANCE_MATRIX[state]?.[finRegime] || SD_FINANCE_MATRIX.balanced.neutral;
  const alignmentBoost = Math.sign(sdVal) === Math.sign(finance?.score ?? 0) ? 0.04 : -0.03;
  const score = clamp(cell.score + alignmentBoost, -1, 1);
  return {
    score: +score.toFixed(4),
    bias: cell.bias,
    note: cell.note,
    paradigm0820: Boolean(cell.paradigm0820),
    state,
    stateLabel: SD_STATE_LABELS[state],
    financeRegime: finRegime,
    financeLabel: FINANCE_LABELS[finRegime],
    combinedLabel: `${SD_STATE_LABELS[state]}+${FINANCE_LABELS[finRegime]}`,
    matrixCell: cell,
  };
}

function policyPrimaryContradiction(instrumentId, policyItems = []) {
  const norm = normalizeCommodityId(instrumentId);
  let best = null;
  for (const profile of POLICY_EVENT_PROFILES) {
    const instrumentMatch = profile.instruments.some((id) => normalizeCommodityId(id) === norm);
    if (!instrumentMatch) continue;
    for (const item of policyItems) {
      const text = `${item.title || ''} ${item.summary || ''}`;
      if (!textIncludesAny(text, profile.keywords)) continue;
      const stars = item.stars || 2;
      const dir = item.direction || profile.defaultDirection || 'neutral';
      const w = stars / 5;
      if (!best || w > best.weight) {
        best = {
          profileId: profile.id,
          label: profile.label,
          title: (item.title || '').slice(0, 60),
          direction: dir,
          weight: w,
          isPrimary: true,
        };
      }
    }
  }
  return best;
}

function assessPolicyForInstrument(instrumentId, policyItems = [], macroChinaScore = 0) {
  const primary = policyPrimaryContradiction(instrumentId, policyItems);
  let score = 0;
  let weight = 0;
  const norm = normalizeCommodityId(instrumentId);

  for (const item of (policyItems || []).slice(0, 50)) {
    const relevant = itemRelevantToInstrument(item, instrumentId);
    const text = `${item.title || ''} ${item.summary || ''}`;
    const genericChina = !relevant && textIncludesAny(text, ['国务院', '发改委', '工信部', '央行', '财政部', '宏观']);
    if (!relevant && !genericChina) continue;
    const stars = (item.stars || 2) / 5;
    const isPrimaryHit = primary && textIncludesAny(text, POLICY_EVENT_PROFILES.find((p) => p.id === primary.profileId)?.keywords || []);
    const w = stars * (isPrimaryHit ? 1.0 : genericChina ? 0.35 : relevant ? 0.7 : 0.2);
    const dir = item.direction || 'neutral';
    if (dir === 'bullish') score += w;
    else if (dir === 'bearish') score -= w;
    weight += w;
  }

  if (!primary && Math.abs(macroChinaScore) > 0.1) {
    score += macroChinaScore * 0.4;
    weight += 0.35;
  }

  const normalized = weight > 0 ? clamp(score / weight, -1, 1) : 0;
  return {
    score: +normalized.toFixed(4),
    primary,
    isPrimaryMatch: Boolean(primary),
    summary: primary ? `主矛盾：${primary.label}` : weight > 0 ? '政策次要传导' : '政策信号平淡',
  };
}

function climateDurationFactor(sector, eventType = 'default') {
  if (sector === 'agriculture') {
    return eventType === 'disaster' ? 0.85 : 0.72; // half-life 5-7d → slower decay
  }
  if (sector === 'energy' || sector === 'black') return eventType === 'disaster' ? 0.45 : 0.35;
  return eventType === 'disaster' ? 0.55 : 0.4;
}

function assessClimateForInstrument(instrumentId, sector, climateItems = []) {
  const norm = normalizeCommodityId(instrumentId);
  let score = 0;
  let weight = 0;
  let disasterHit = false;
  const duration = climateDurationFactor(sector, 'default');

  for (const item of (climateItems || []).slice(0, 35)) {
    const text = `${item.title || ''} ${item.summary || ''}`;
    let relevant = itemRelevantToInstrument(item, instrumentId);
    for (const map of CLIMATE_DISASTER_MAP) {
      if (textIncludesAny(text, map.keywords)) {
        if (map.commodities.some((c) => normalizeCommodityId(c) === norm)) {
          relevant = true;
          disasterHit = true;
        }
        if (map.regions.length && map.regions.some((r) => text.includes(r))) {
          if (map.commodities.some((c) => normalizeCommodityId(c) === norm)) relevant = true;
        }
      }
    }
    if (!relevant) continue;
    const stars = (item.stars || 2) / 5;
    const dur = disasterHit ? climateDurationFactor(sector, 'disaster') : duration;
    const w = stars * dur;
    const dir = item.direction || 'neutral';
    if (dir === 'bullish') score += w;
    else if (dir === 'bearish') score -= w;
    weight += w;
  }

  return {
    score: weight > 0 ? +clamp(score / weight, -1, 1).toFixed(4) : 0,
    durationFactor: disasterHit ? climateDurationFactor(sector, 'disaster') : duration,
    disasterHit,
    summary: disasterHit ? '灾害物流短期冲击' : weight > 0 ? '气候传导' : '气候扰动有限',
  };
}

function assessGeoForInstrument(instrumentId, geoItems = []) {
  const norm = normalizeCommodityId(instrumentId);
  let score = 0;
  let weight = 0;
  let regionLabel = null;
  let highStar = false;

  for (const item of (geoItems || []).slice(0, 35)) {
    const text = `${item.title || ''} ${item.summary || ''}`;
    let relevant = itemRelevantToInstrument(item, instrumentId);
    for (const map of GEO_REGION_MAP) {
      if (textIncludesAny(text, map.keywords) && map.instruments.some((id) => normalizeCommodityId(id) === norm)) {
        relevant = true;
        regionLabel = map.label;
      }
    }
    if (!relevant) continue;
    const stars = item.stars || 2;
    if (stars >= 4) highStar = true;
    const w = (stars / 5) * (stars >= 4 ? 1.2 : 1);
    const dir = item.direction || 'bullish';
    if (dir === 'bullish') score += w;
    else if (dir === 'bearish') score -= w;
    weight += w;
  }

  return {
    score: weight > 0 ? +clamp(score / weight, -1, 1).toFixed(4) : 0,
    highStar,
    regionLabel,
    summary: highStar ? `地缘供应冲击${regionLabel ? `（${regionLabel}）` : ''}` : weight > 0 ? '地缘溢价' : '地缘平稳',
  };
}

function getCrudeChangePct(commoditiesSource) {
  const find = (id) => {
    for (const ex of commoditiesSource?.exchanges || []) {
      for (const item of ex.items || []) {
        if (normalizeCommodityId(item.id) === normalizeCommodityId(id)) return item;
      }
    }
    return null;
  };
  const sc = find('sc');
  if (sc?.changePct != null) return Number(sc.changePct);
  const fu = find('fu');
  if (fu?.changePct != null) return Number(fu.changePct);
  return 0;
}

/**
 * 原油之母 — 化工强传导，其他大宗弱/慢 uplift
 */
function computeOilMotherEffect(crudeChange, sector, instrumentId = null) {
  const chg = Number(crudeChange) || 0;
  const id = normalizeCommodityId(instrumentId || '');
  if (id === 'sc' || id === 'fu' || id === 'lu' || id === 'bu') {
    return {
      score: +clamp(chg / 2.5, -1, 1).toFixed(4),
      strength: 'direct',
      label: '原油直接',
      applicable: true,
    };
  }
  if (sector === 'chemical' || sector === 'energy') {
    return {
      score: +clamp(chg / 3.2, -0.85, 0.85).toFixed(4),
      strength: 'strong',
      label: '化工链强传导',
      applicable: true,
    };
  }
  return {
    score: +clamp(chg / 8, -0.28, 0.28).toFixed(4),
    strength: 'weak',
    label: '间接缓慢 uplift',
    applicable: Math.abs(chg) > 0.5,
  };
}

function computeCapitalSentiment(technical, liveQuote, sectorVolumeRank = null, vix = null, sector = null) {
  const vol5 = technical?.volume?.ratio ?? 1;
  const oiDelta = technical?.oi?.deltaPct;
  const priceChg = technical?.intraday?.changePct ?? liveQuote?.changePct ?? 0;

  let score = 0;
  if (oiDelta != null) score += clamp(oiDelta / 8, -0.45, 0.45);
  if (vol5 > 1.2) score += clamp((vol5 - 1) * 0.35, 0, 0.35);
  else if (vol5 < 0.8) score -= 0.12;
  if (sectorVolumeRank != null) score += clamp((1 - sectorVolumeRank) * 0.25, 0, 0.25);
  if (priceChg > 0 && oiDelta > 0) score += 0.08;
  else if (priceChg < 0 && oiDelta > 0) score -= 0.1;

  const vixSafe = vix != null && !Number.isNaN(Number(vix)) ? Number(vix) : null;
  if (vixSafe != null) {
    const sectorVixSens =
      sector === 'precious' || sector === 'energy' ? 1.15 : sector === 'agriculture' ? 0.85 : 1;
    if (vixSafe > 28) score -= 0.12 * sectorVixSens;
    else if (vixSafe < 16) score += 0.06 * sectorVixSens;
  }

  const normalized = clamp(score, -1, 1);
  const weight =
    Math.abs(normalized) > 0.25
      ? WEIGHT_CAPITAL_SENTIMENT.max
      : Math.abs(normalized) > 0.1
        ? WEIGHT_CAPITAL_SENTIMENT.default
        : WEIGHT_CAPITAL_SENTIMENT.min;
  return {
    score: +normalized.toFixed(4),
    weight,
    summary:
      normalized > 0.15 ? '资金净流入/增仓' : normalized < -0.15 ? '资金流出/减仓' : '资金情绪中性',
  };
}

/**
 * 现价反馈 — 与 SD×Finance 方向一致性
 */
function computePriceFeedback(changePct, sdFinanceCombined) {
  const chg = Number(changePct);
  if (changePct == null || Number.isNaN(chg)) {
    return { score: 0, weight: WEIGHT_PRICE_FEEDBACK.default, aligned: null, summary: '现价待加载' };
  }
  const priceScore = clamp(chg / 2.8, -1, 1);
  const expected = sdFinanceCombined?.score ?? 0;
  const aligned = Math.sign(priceScore) === Math.sign(expected) || Math.abs(expected) < 0.08;
  let score = priceScore * 0.55;
  if (aligned) score += Math.sign(expected) * 0.12;
  else score *= 0.65;
  const weight =
    Math.abs(chg) > 1.2 ? WEIGHT_PRICE_FEEDBACK.max : Math.abs(chg) > 0.4 ? WEIGHT_PRICE_FEEDBACK.default : WEIGHT_PRICE_FEEDBACK.min;
  return {
    score: +clamp(score, -1, 1).toFixed(4),
    weight,
    aligned,
    changePct: chg,
    summary: aligned ? '现价与研判方向一致' : '现价与研判背离',
  };
}

/**
 * 主矛盾 / 次矛盾分级；次矛盾方向影响上限 15%（无主料时放开）
 */
function rankFactors(instrument, factorBag) {
  const {
    sdFinance,
    policy,
    geo,
    climate,
    oil,
    capitalSentiment,
    priceFeedback,
    boj,
    finance,
  } = factorBag;

  const candidates = [];

  candidates.push({
    id: 'sdFinance',
    label: `供需×金融（${sdFinance?.combinedLabel || '—'}）`,
    score: sdFinance?.score ?? 0,
    tier: 'primary',
    weight: 0.32,
    chip: sdFinance?.combinedLabel,
  });

  if (policy?.isPrimaryMatch && policy.primary) {
    candidates.push({
      id: 'policyPrimary',
      label: `政策主矛盾：${policy.primary.label}`,
      score: policy.score,
      tier: 'primary',
      weight: 0.18,
      chip: policy.primary.label,
    });
  } else if (Math.abs(policy?.score ?? 0) > 0.12) {
    candidates.push({
      id: 'policy',
      label: '政策（次要）',
      score: policy.score,
      tier: 'secondary',
      weight: 0.08,
      downweighted: true,
    });
  }

  if (geo?.highStar || Math.abs(geo?.score ?? 0) > 0.2) {
    candidates.push({
      id: 'geo',
      label: geo.highStar ? `地缘供应冲击${geo.regionLabel ? `·${geo.regionLabel}` : ''}` : '地缘',
      score: geo.score,
      tier: geo.highStar ? 'primary' : 'secondary',
      weight: geo.highStar ? 0.14 : 0.07,
      downweighted: !geo.highStar,
    });
  }

  if (climate?.disasterHit || (instrument.sector === 'agriculture' && Math.abs(climate?.score ?? 0) > 0.15)) {
    candidates.push({
      id: 'climate',
      label: climate.disasterHit ? '灾害物流' : '气候',
      score: climate.score,
      tier: climate.disasterHit ? 'primary' : 'secondary',
      weight: climate.disasterHit ? 0.12 : 0.06,
    });
  }

  if (oil?.applicable && Math.abs(oil.score) > 0.05) {
    candidates.push({
      id: 'oilMother',
      label: `原油传导·${oil.label}`,
      score: oil.score,
      tier: oil.strength === 'strong' || oil.strength === 'direct' ? 'primary' : 'secondary',
      weight: oil.strength === 'strong' ? 0.15 : oil.strength === 'direct' ? 0.2 : 0.06,
    });
  }

  if (Math.abs(boj ?? 0) > 0.1) {
    candidates.push({
      id: 'boj',
      label: '日央行流动性',
      score: boj,
      tier: 'secondary',
      weight: 0.06,
      downweighted: true,
    });
  }

  candidates.push({
    id: 'capitalSentiment',
    label: '资金情绪',
    score: capitalSentiment?.score ?? 0,
    tier: 'primary',
    weight: capitalSentiment?.weight ?? WEIGHT_CAPITAL_SENTIMENT.default,
  });

  candidates.push({
    id: 'priceFeedback',
    label: '现价反馈',
    score: priceFeedback?.score ?? 0,
    tier: 'primary',
    weight: priceFeedback?.weight ?? WEIGHT_PRICE_FEEDBACK.default,
  });

  const primary = candidates.filter((c) => c.tier === 'primary').sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight));
  const secondary = candidates.filter((c) => c.tier === 'secondary').sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const hasPrimary = primary.length > 0;
  const primaryMaxAbs = primary.reduce((m, f) => Math.max(m, Math.abs(f.score ?? 0)), 0);
  let secondaryCap = hasPrimary ? SECONDARY_FACTOR_CAP : 0.35;
  if (primaryMaxAbs > PRIMARY_STRONG_THRESHOLD) secondaryCap = PRIMARY_STRONG_SECONDARY_CAP;
  let secondaryUsed = 0;
  const secondaryCapped = secondary.map((s) => {
    const raw = s.score * s.weight;
    const room = Math.max(0, secondaryCap - secondaryUsed);
    const capped = Math.sign(raw) * Math.min(Math.abs(raw), room);
    secondaryUsed += Math.abs(capped);
    return { ...s, effective: +capped.toFixed(4), capped: Math.abs(raw) > Math.abs(capped) };
  });

  const primaryChip = primary[0]
    ? `主矛盾：${primary[0].chip || primary[0].label}`
    : `主矛盾：${sdFinance?.combinedLabel || '供需×金融'}`;
  const secondaryChip =
    secondaryCapped.find((s) => s.capped) || secondaryCapped[0]
      ? `次矛盾：${(secondaryCapped.find((s) => s.capped) || secondaryCapped[0]).label}${secondaryCapped.some((s) => s.capped) ? '（权重降）' : ''}`
      : null;

  const secondaryDominates =
    hasPrimary &&
    secondaryCapped.reduce((s, f) => s + Math.abs(f.effective ?? 0), 0) >
      primary.reduce((s, f) => s + Math.abs(f.score * f.weight), 0) * 0.85;

  return {
    primary,
    secondary: secondaryCapped,
    primaryChip,
    secondaryChip,
    secondaryCap,
    primaryMaxAbs: +primaryMaxAbs.toFixed(4),
    secondaryDominates,
  };
}

function buildPhilosophyComposite(ranked, factorBag) {
  let sum = 0;
  let wSum = 0;
  const contributions = {};

  for (const f of ranked.primary) {
    const v = f.score * f.weight;
    contributions[f.id] = +v.toFixed(4);
    sum += v;
    wSum += f.weight;
  }
  for (const f of ranked.secondary) {
    const v = f.effective ?? f.score * f.weight;
    contributions[f.id] = +v.toFixed(4);
    sum += v;
    wSum += f.weight * (f.capped ? 0.5 : 1);
  }

  const composite = wSum > 0 ? clamp(sum / Math.max(wSum * 0.85, 0.5), -1, 1) : 0;
  return {
    score: +composite.toFixed(4),
    contributions,
  };
}

function evaluateInstrumentPhilosophy(ctx) {
  const {
    meta,
    profile,
    spec,
    sources,
    technical,
    liveQuote,
    newsImpact,
    sectorVolumeRank,
    changePct,
  } = ctx;

  const macroChina = scoreMacroChina(sources.macro);
  const inventory = {
    deltaPct: technical?.oi?.deltaPct,
    volumeRatio: technical?.volume?.ratio,
  };

  const sd = assessSupplyDemand(
    { id: meta.id, sector: spec.sector, newsAliases: profile.newsAliases },
    sources.policy,
    sources.climate,
    sources.geopolitics,
    inventory,
    newsImpact,
    macroChina
  );

  let financePrev = 'neutral';
  try {
    financePrev = require('./commodity-outlook-calibration').getFinanceRegimeState().regime;
  } catch {
    financePrev = 'neutral';
  }
  const finance = assessFinancialEnvironment(sources.fed, sources.boj, sources.forex, sources.indices, {
    prevRegime: financePrev,
  });
  if (!ctx.skipRegimePersistence) {
    try {
      require('./commodity-outlook-calibration').persistFinanceRegime(finance.regime);
    } catch {
      // ignore persistence errors
    }
  }
  const sdFinance = combineSdFinance(sd, finance);

  const policy = assessPolicyForInstrument(meta.id, sources.policy?.items, macroChina.score);
  const climate = assessClimateForInstrument(meta.id, spec.sector, sources.climate?.items);
  const geo = assessGeoForInstrument(meta.id, sources.geopolitics?.items);

  const crudeChange = getCrudeChangePct(sources.commodities);
  const oil = computeOilMotherEffect(crudeChange, spec.sector, meta.id);

  const vixForCapital = parseFloat(
    (sources.fed?.indicators || []).find((i) => i.id === 'VIXCLS')?.value
  );
  const capitalSentiment = computeCapitalSentiment(
    technical,
    liveQuote,
    sectorVolumeRank,
    Number.isNaN(vixForCapital) ? null : vixForCapital,
    spec.sector
  );
  const priceFeedback = computePriceFeedback(changePct ?? liveQuote?.changePct, sdFinance);

  const bojScore = (() => {
    const bojInd = sources.boj?.indicators || [];
    const rateRow = bojInd.find((i) => /隔夜|拆借|政策利率|rate/i.test(i.name));
    const rate = parseFloat(rateRow?.value);
    if (Number.isNaN(rate)) return 0;
    if (rate <= 0) return 0.35;
    if (rate <= 0.5) return 0.2;
    return -0.08;
  })();

  const ranked = rankFactors(
    { id: meta.id, sector: spec.sector },
    { sdFinance, policy, geo, climate, oil, capitalSentiment, priceFeedback, boj: bojScore, finance }
  );

  const composite = buildPhilosophyComposite(ranked, {
    sdFinance,
    policy,
    geo,
    climate,
    oil,
    capitalSentiment,
    priceFeedback,
  });

  let compositeScore = composite.score;
  const evm = ctx.eventMultipliers;
  if (evm) {
    if (evm.oilSpillover && evm.oilSpillover !== 1 && oil?.applicable) {
      compositeScore = clamp(compositeScore + (oil.score ?? 0) * (evm.oilSpillover - 1) * 0.08, -1, 1);
    }
    if (evm.capitalSentiment && evm.capitalSentiment !== 1) {
      compositeScore = clamp(compositeScore * (0.85 + evm.capitalSentiment * 0.15), -1, 1);
    }
  }

  const paradigmHint =
    sdFinance.paradigm0820 && finance.regime === 'loose'
      ? '08/20范式：供弱需强+联储放水 → 大幅走强'
      : sdFinance.state === SD_STATES.supplyStrong && finance.regime === 'tight'
        ? '供强需弱+紧缩 → 明显走弱'
        : null;

  return {
    version: PHILOSOPHY_VERSION,
    supplyDemand: sd,
    financialEnvironment: finance,
    sdFinance,
    policy,
    climate,
    geo,
    oilMother: oil,
    capitalSentiment,
    priceFeedback,
    boj: { score: bojScore, summary: finance.bojRate != null ? `日央行利率 ${finance.bojRate}%` : '日央行' },
    macroChina,
    ranked,
    compositeScore: +compositeScore.toFixed(4),
    contributions: composite.contributions,
    secondaryDominates: ranked.secondaryDominates,
    paradigmHint,
    logicSummary: [
      `供需：${sd.summary}`,
      `金融：${finance.regimeLabel}（${finance.score >= 0 ? '+' : ''}${finance.score.toFixed(2)}）`,
      `组合：${sdFinance.note}`,
      paradigmHint,
    ]
      .filter(Boolean)
      .join('；'),
  };
}

module.exports = {
  PHILOSOPHY_VERSION,
  SD_FINANCE_MATRIX,
  SD_STATE_LABELS,
  FINANCE_LABELS,
  POLICY_EVENT_PROFILES,
  SECONDARY_FACTOR_CAP,
  assessSupplyDemand,
  assessFinancialEnvironment,
  applyFinanceRegimeHysteresis,
  computeDffTrend,
  computeM2YoYProxy,
  combineSdFinance,
  policyPrimaryContradiction,
  climateDurationFactor,
  computeOilMotherEffect,
  computeCapitalSentiment,
  computePriceFeedback,
  computeGlobalRiskAppetite,
  rankFactors,
  evaluateInstrumentPhilosophy,
  getCrudeChangePct,
  scoreMacroChina,
};
