/**
 * 资金态度 / 资金关注度（仅真实持仓·成交·会员）
 * 资讯可假、短线 K 线可滞后；持仓增减与会员结构视为品种「终极态度」。
 * 缺失分量 → null / 暂无，禁止用默认仓位填充。
 */
const CAPITAL_ATTITUDE_VERSION = 'v1.56.24-capital-attitude';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function absPctScore(pct, scale = 3.5, cap = 28) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  return clamp(Math.abs(Number(pct)) * scale + (Math.abs(Number(pct)) >= 2 ? 4 : 0), 0, cap);
}

function stanceFromOi(oi1w, oi1m, oi3m) {
  const primary = oi1m ?? oi1w ?? oi3m;
  if (primary == null) return { stance: null, label: '暂无', note: '持仓序列不足' };
  const m = Number(oi1m);
  const w = Number(oi1w);
  const q = Number(oi3m);
  if (Number.isFinite(m) && m >= 2 && (!Number.isFinite(w) || w >= -1)) {
    return { stance: 'inflow', label: '资金涌入', note: `近1月持仓+${m.toFixed(1)}%` };
  }
  if (Number.isFinite(m) && m <= -2 && (!Number.isFinite(w) || w <= 1)) {
    return { stance: 'outflow', label: '资金撤退', note: `近1月持仓${m.toFixed(1)}%` };
  }
  if (Number.isFinite(q) && Math.abs(q) >= 8 && Number.isFinite(m) && Math.sign(q) === Math.sign(m)) {
    return {
      stance: m > 0 ? 'inflow' : 'outflow',
      label: m > 0 ? '中期增仓' : '中期减仓',
      note: `近3月持仓${q.toFixed(1)}% · 近1月同向`,
    };
  }
  if (Number.isFinite(m) && Math.abs(m) < 1.2) {
    return { stance: 'neutral', label: '资金观望', note: '近1月持仓近似持平' };
  }
  return {
    stance: primary > 0 ? 'mild_in' : 'mild_out',
    label: primary > 0 ? '温和增仓' : '温和减仓',
    note: `主窗口持仓${Number(primary).toFixed(1)}%`,
  };
}

function computeCapitalAttitude(options = {}) {
  const id = String(options.instrumentId || '').toLowerCase();
  const asOf = String(options.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const technical = options.technical || {};
  const liveQuote = options.liveQuote || {};
  const sectorVolumeRank = options.sectorVolumeRank;

  const vol5 = technical.volume?.ratio;
  const vol20 = technical.volume?.ratio20 ?? vol5;
  const price = Number(liveQuote.price) || Number(technical.price) || 0;
  const volume = Number(liveQuote.volume) || technical.volume?.todayVolume || 0;
  const turnover = price > 0 && volume > 0 ? price * volume : null;
  const rangePct = technical.intraday?.rangePct;

  let oi1w = null;
  let oi1m = null;
  let oi3m = null;
  let oiAsOf = null;
  let oiSource = 'missing';
  try {
    const { getOiChgNdAtDate } = require('./inventory-capital-joint');
    if (id) {
      const w = getOiChgNdAtDate(id, asOf, 5);
      const m = getOiChgNdAtDate(id, asOf, 21);
      const q = getOiChgNdAtDate(id, asOf, 63);
      oi1w = w?.pct ?? null;
      oi1m = m?.pct ?? null;
      oi3m = q?.pct ?? null;
      oiAsOf = m?.asOfDate || w?.asOfDate || q?.asOfDate || null;
      if (oi1w != null || oi1m != null || oi3m != null) oiSource = 'history/trading-oi';
      // Dead/illiquid contracts: do not treat years-old OI as "current attitude"
      if (oiAsOf) {
        const lagDays = (Date.parse(asOf) - Date.parse(oiAsOf)) / 86400000;
        if (Number.isFinite(lagDays) && lagDays > 90) {
          oi1w = null;
          oi1m = null;
          oi3m = null;
          oiSource = 'history/trading-oi-stale';
        }
      }
    }
  } catch {
    // keep missing
  }

  const oiDod = technical.oi?.deltaPct;
  if (oiDod != null && Number.isFinite(Number(oiDod)) && oi1w == null && oi1m == null) {
    oi1w = Number(oiDod);
    oiSource = 'technical.oi.deltaPct';
  }

  let member = null;
  try {
    if (id) {
      const feat = require('./member-oi-features').loadMemberOiFeatures(id);
      if (feat?.available) {
        member = {
          netSub: feat.netSub,
          buyTop5Share: feat.buyTop5Share,
          sellTop5Share: feat.sellTop5Share,
          tradeDate: feat.tradeDate,
          contractId: feat.contractId,
          dataSource: feat.dataSource,
        };
      }
    }
  } catch {
    member = null;
  }

  let stockFlow = null;
  try {
    if (id) stockFlow = require('./inventory-capital-joint').buildStockFlowJoint(id, asOf);
  } catch {
    stockFlow = null;
  }

  const parts = [];
  let raw = 0;
  let weightUsed = 0;

  const s1m = absPctScore(oi1m, 3.2, 30);
  const s1w = absPctScore(oi1w, 2.8, 22);
  const s3m = absPctScore(oi3m, 1.6, 18);
  if (s1m != null) {
    raw += s1m;
    weightUsed += 1;
    parts.push({ source: 'oi_1m_pct', value: oi1m, scorePart: s1m });
  }
  if (s1w != null) {
    raw += s1w * 0.75;
    weightUsed += 0.75;
    parts.push({ source: 'oi_1w_pct', value: oi1w, scorePart: +(s1w * 0.75).toFixed(2) });
  }
  if (s3m != null) {
    raw += s3m * 0.55;
    weightUsed += 0.55;
    parts.push({ source: 'oi_3m_pct', value: oi3m, scorePart: +(s3m * 0.55).toFixed(2) });
  }

  if (vol5 != null && Number.isFinite(Number(vol5))) {
    const vs = clamp((Number(vol5) - 0.75) * 18 + ((Number(vol20) || Number(vol5)) - 0.75) * 10, 0, 28);
    raw += vs;
    weightUsed += 0.8;
    parts.push({ source: 'volume_ratio', value: Number(vol5), scorePart: +vs.toFixed(2) });
  }
  if (turnover != null && turnover > 0) {
    const ts = clamp(Math.log10(turnover + 1) * 2.4 - 3, 0, 18);
    raw += ts;
    weightUsed += 0.5;
    parts.push({ source: 'turnover_proxy', value: Math.round(turnover), scorePart: +ts.toFixed(2) });
  }
  if (rangePct != null && Number.isFinite(Number(rangePct))) {
    const rs = clamp(Number(rangePct) * 3, 0, 12);
    raw += rs;
    weightUsed += 0.35;
    parts.push({ source: 'intraday_range', value: Number(rangePct), scorePart: +rs.toFixed(2) });
  }
  if (sectorVolumeRank != null && Number.isFinite(Number(sectorVolumeRank))) {
    const rk = clamp((1 - Number(sectorVolumeRank)) * 10, 0, 10);
    raw += rk;
    weightUsed += 0.3;
    parts.push({ source: 'sector_volume_rank', value: Number(sectorVolumeRank), scorePart: +rk.toFixed(2) });
  }
  if (member?.netSub != null && Number.isFinite(Number(member.netSub))) {
    const ms = clamp(Math.log10(Math.abs(Number(member.netSub)) + 1) * 3.5, 0, 12);
    raw += ms;
    weightUsed += 0.4;
    parts.push({ source: 'member_net_sub', value: member.netSub, scorePart: +ms.toFixed(2) });
  }

  const oiAvailable = oi1w != null || oi1m != null || oi3m != null;
  if (!oiAvailable && vol5 == null && !member) {
    const stale = oiSource === 'history/trading-oi-stale';
    let jointNote = null;
    if (stockFlow?.available) {
      jointNote = `${stockFlow.primaryLabel}${stockFlow.priceMayLag ? ' ·价格或滞后' : ''}`;
    }
    return {
      version: CAPITAL_ATTITUDE_VERSION,
      available: false,
      score: null,
      display: '暂无',
      label: '暂无',
      attitude: null,
      attitudeLabel: '暂无',
      attitudeNote: stale
        ? `持仓序列停更（asOf ${oiAsOf}）· 不作当前态度`
        : '持仓/成交/会员均不足，不作虚假关注度',
      contribution: 0,
      reason: stale ? 'oi_series_stale' : 'oi_volume_member_missing',
      instrumentId: id || null,
      asOf,
      oiAsOf: oiAsOf || null,
      // Always emit horizon slots so UI/验收可读「暂无」，禁止省略字段。
      horizons: { oi1wPct: null, oi1mPct: null, oi3mPct: null },
      jointWithInventory: jointNote,
      stockFlowBias: stockFlow?.structureBias || null,
      member: null,
      subMetrics: {
        oi1wPct: null,
        oi1mPct: null,
        oi3mPct: null,
        oiChangePct: null,
      },
      dataSource: stale ? oiSource : 'missing',
      method: 'capital-attitude',
      note: stale
        ? `持仓序列停更（asOf ${oiAsOf}）· 不作当前态度`
        : '持仓/成交/会员均不足，不作虚假关注度',
    };
  }

  let score = clamp(Math.round(raw), 0, 100);
  if (!oiAvailable) {
    score = Math.min(score, 48);
    parts.push({ source: 'cap_without_oi', value: 48, scorePart: 0 });
  }
  if (weightUsed < 0.5) {
    return {
      version: CAPITAL_ATTITUDE_VERSION,
      available: false,
      score: null,
      display: '暂无',
      label: '待校验',
      attitude: null,
      attitudeLabel: '待校验',
      attitudeNote: '分量权重不足',
      contribution: 0,
      reason: 'insufficient_weight',
      instrumentId: id || null,
      asOf,
      oiAsOf: oiAsOf || null,
      horizons: { oi1wPct: oi1w, oi1mPct: oi1m, oi3mPct: oi3m },
      jointWithInventory: stockFlow?.available
        ? `${stockFlow.primaryLabel}${stockFlow.priceMayLag ? ' ·价格或滞后' : ''}`
        : null,
      stockFlowBias: stockFlow?.structureBias || null,
      member,
      parts,
      subMetrics: {
        oi1wPct: oi1w,
        oi1mPct: oi1m,
        oi3mPct: oi3m,
      },
      dataSource: oiSource,
      method: 'capital-attitude',
    };
  }

  const attitude = stanceFromOi(oi1w, oi1m, oi3m);
  if (oiSource === 'history/trading-oi-stale' && attitude.stance == null) {
    attitude.label = '暂无';
    attitude.note = `持仓序列停更（asOf ${oiAsOf}）· 不作当前态度`;
  }
  let jointNote = null;
  let jointSignal = null;
  if (stockFlow?.available) {
    jointNote = `${stockFlow.primaryLabel}${stockFlow.priceMayLag ? ' ·价格或滞后' : ''}`;
  }
  try {
    const { jointDecisionDelta } = require('./stock-flow-joint-signal');
    jointSignal = jointDecisionDelta(stockFlow);
  } catch {
    jointSignal = null;
  }

  // 归因：态度 stance IC 为负；关注度仅排名。方向合证增量由 computeInventoryScore 统一注入，此处 contribution=0 防双计
  const contribution = 0;
  const label =
    score >= 72 ? '高关注' : score >= 55 ? '偏高' : score >= 40 ? '中性' : score >= 25 ? '偏低' : '冷淡';

  return {
    version: CAPITAL_ATTITUDE_VERSION,
    available: true,
    score,
    display: `${score}/100`,
    label,
    tier: label,
    contribution: 0,
    attitude: attitude.stance,
    attitudeLabel: attitude.label,
    attitudeNote: attitude.note,
    jointWithInventory: jointNote,
    stockFlowBias: stockFlow?.structureBias || null,
    jointSignal: jointSignal
      ? {
          delta: jointSignal.delta,
          reason: jointSignal.reason,
          regime: jointSignal.regime,
          coherence: jointSignal.coherence,
          version: jointSignal.version,
        }
      : null,
    instrumentId: id || null,
    asOf,
    oiAsOf,
    horizons: { oi1wPct: oi1w, oi1mPct: oi1m, oi3mPct: oi3m },
    member,
    subMetrics: {
      volumeRatio5d: vol5 != null ? +Number(vol5).toFixed(2) : null,
      volumeRatio20d: vol20 != null ? +Number(vol20).toFixed(2) : null,
      oiChangePct: oiDod != null ? +Number(oiDod).toFixed(2) : oi1w,
      oi1wPct: oi1w,
      oi1mPct: oi1m,
      oi3mPct: oi3m,
      turnoverProxy: turnover != null ? Math.round(turnover) : null,
      intradayRangePct: rangePct != null ? +Number(rangePct).toFixed(2) : null,
      sectorVolumeRank: sectorVolumeRank != null ? +Number(sectorVolumeRank).toFixed(2) : null,
      memberNetSub: member?.netSub ?? null,
    },
    parts,
    dataSource: [oiSource, vol5 != null ? 'volume' : null, member ? 'member-oi' : null, stockFlow?.available ? 'stock-flow-joint' : null]
      .filter(Boolean)
      .join('|'),
    method: 'capital-attitude-multi-horizon',
    note: !oiAvailable
      ? '无持仓序列时关注度已压顶，不作终极态度'
      : '关注度仅排名；合证方向增量经 inventory/stock-flow-joint-signal 入决策（防双计）',
  };
}

function rankCapitalAttention(entries) {
  const ranked = (entries || [])
    .filter((e) => e && e.score != null && Number.isFinite(Number(e.score)))
    .map((e) => ({ ...e }))
    .sort((a, b) => Number(b.score) - Number(a.score));
  ranked.forEach((e, i) => {
    e.rank = i + 1;
    e.rankOf = ranked.length;
    e.percentile = ranked.length > 1 ? +((1 - i / (ranked.length - 1)) * 100).toFixed(1) : 100;
  });
  return ranked;
}

module.exports = {
  CAPITAL_ATTITUDE_VERSION,
  computeCapitalAttitude,
  rankCapitalAttention,
  stanceFromOi,
};
