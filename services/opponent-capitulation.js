/**
 * PB-OPP-001 对手盘未竭 (Capitulation Gate)
 * Motto: 空头不死多头不止 / 多头不死空头不止
 * OI 须来自真实 instrument 数据；缺失 → 待校验，禁止假 sideNotDead
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const OPPONENT_VERSION = 'v1.45.0-opponent-playbooks';
const MOTTO = '空头不死多头不止 / 多头不死空头不止';

function nowIso() {
  return new Date().toISOString();
}

function extractOiDeltaPct(inst) {
  const techOi = inst?.factors?.technical?.oi ?? inst?.technical?.oi;
  if (techOi?.deltaPct != null && Number.isFinite(Number(techOi.deltaPct))) {
    return Number(techOi.deltaPct);
  }
  const capOi = inst?.capitalAttention?.subMetrics?.oiChangePct;
  if (capOi != null && Number.isFinite(Number(capOi))) return Number(capOi);
  const flowOi = inst?.flowModel?.oiChangePct;
  if (flowOi != null && Number.isFinite(Number(flowOi))) return Number(flowOi);
  return null;
}

function extractPriceDirection(inst, tg) {
  const changePct = inst?.changePct ?? inst?.factors?.technical?.changePct ?? inst?.factors?.technical?.intraday?.changePct;
  if (changePct != null && Number.isFinite(Number(changePct))) {
    const n = Number(changePct);
    if (n > 0.05) return 'up';
    if (n < -0.05) return 'down';
    return 'flat';
  }
  if (tg?.bias === '偏多') return 'up';
  if (tg?.bias === '偏空') return 'down';
  return 'unknown';
}

function deriveTrendSide(tg) {
  const phase = tg?.phase;
  if (tg?.bias === '偏多' || phase === '升温' || phase === '拥挤') return 'bull';
  if (tg?.bias === '偏空' || phase === '退潮') return 'bear';
  return 'neutral';
}

function mapOpponentLabel(side) {
  const map = {
    shortNotDead: '空头未死',
    shortCapitulated: '空头已竭',
    longNotDead: '多头未死',
    longCapitulated: '多头已竭',
  };
  return map[side] || null;
}

/**
 * @param {object} inst
 * @param {object} context '{ tradingGuidance, divergence, liqCrisis }'
 */
function evaluateOpponentCapitulation(inst, context = {}) {
  const asOf = nowIso();
  const tg = context.tradingGuidance || inst?.tradingGuidance;
  const divergence = context.divergence;
  const liqCrisis = context.liqCrisis;
  const sym = normalizeCommodityId(inst?.id || context.symbol);
  const oiDeltaPct = extractOiDeltaPct(inst);
  const phase = tg?.phase;
  const priceDir = extractPriceDirection(inst, tg);
  const trendSide = deriveTrendSide(tg);
  const evidence = [];
  const base = {
    motto: MOTTO,
    playbookId: 'PB-OPP-001',
    symbol: sym,
    oiDeltaPct,
    phase: phase || '暂无',
    priceDirection: priceDir,
    trendSide,
    dataSource: 'opponent-capitulation',
    method: 'oi+price+phase',
    version: OPPONENT_VERSION,
    asOf,
  };

  if (liqCrisis?.active) {
    return {
      ...base,
      status: 'overridden',
      label: '对手盘: L3覆盖',
      opponentSide: null,
      sideNotDead: null,
      capitulated: null,
      postureCap: null,
      blockReduceLongOnHighPrice: false,
      blockReduceShortOnLowPrice: false,
      noChase: true,
      evidence: ['PB-LIQ-CRISIS 覆盖 PB-OPP-001'],
    };
  }

  if (oiDeltaPct == null) {
    return {
      ...base,
      status: '待校验',
      label: '对手盘: 待校验',
      opponentSide: null,
      sideNotDead: null,
      capitulated: null,
      postureCap: null,
      blockReduceLongOnHighPrice: false,
      blockReduceShortOnLowPrice: false,
      noChase: false,
      evidence: ['OI 缺失 · 禁止推断 sideNotDead'],
    };
  }

  const oiUp = oiDeltaPct > 0;
  const oiDown = oiDeltaPct < 0;
  const priceUp = priceDir === 'up';
  const priceDown = priceDir === 'down';
  const notEbb = phase !== '退潮';
  const isEbb = phase === '退潮';

  let opponentSide = null;

  if (trendSide === 'bull') {
    if (priceUp && oiUp && notEbb) {
      opponentSide = 'shortNotDead';
      evidence.push('多头趋势 · 价涨+OI增+非退潮 → 空头未死');
    } else if (priceUp && oiDown && isEbb) {
      opponentSide = 'shortCapitulated';
      evidence.push('多头趋势尾声 · 价涨+OI减+退潮 → 空头已竭');
    }
  } else if (trendSide === 'bear') {
    if (priceDown && oiUp && notEbb) {
      opponentSide = 'longNotDead';
      evidence.push('空头趋势 · 价跌+OI增+非退潮 → 多头未死');
    } else if (priceDown && oiDown && isEbb) {
      opponentSide = 'longCapitulated';
      evidence.push('空头趋势尾声 · 价跌+OI减+退潮 → 多头已竭');
    }
  }

  if ((divergence?.level === 'D2' || divergence?.level === 'D3') && sym === 'i') {
    evidence.push('D2 政策背离 · 铁矿案例 · 信任 phase/资本而非单一政策 headline');
    if (trendSide === 'bull' && priceUp && oiUp) {
      opponentSide = 'shortNotDead';
      evidence.push('铁矿 D2 override → 空头未死（政策偏空但价格/OI 仍强）');
    }
  }

  const label = opponentSide ? `对手盘: ${mapOpponentLabel(opponentSide)}` : '对手盘: 中性';
  const sideNotDead = opponentSide === 'shortNotDead' || opponentSide === 'longNotDead';
  const capitulated = opponentSide === 'shortCapitulated' || opponentSide === 'longCapitulated';

  let postureCap = null;
  let blockReduceLongOnHighPrice = false;
  let blockReduceShortOnLowPrice = false;
  let noChase = false;

  if (opponentSide === 'shortNotDead') {
    blockReduceLongOnHighPrice = true;
    evidence.push('勿仅因价高减多 · 空头未死');
  } else if (opponentSide === 'longNotDead') {
    blockReduceShortOnLowPrice = true;
    evidence.push('勿仅因价低减空 · 多头未死');
  } else if (opponentSide === 'shortCapitulated' || opponentSide === 'longCapitulated') {
    postureCap = '减仓';
    noChase = true;
    evidence.push('对手盘已竭 · 减仓/不追');
  }

  if (!evidence.length) evidence.push(`OI ${oiDeltaPct > 0 ? '+' : ''}${oiDeltaPct}% · phase=${phase || '—'} · 无明确对手盘信号`);

  return {
    ...base,
    status: opponentSide ? 'detected' : 'neutral',
    label,
    opponentSide,
    sideNotDead,
    capitulated,
    postureCap,
    blockReduceLongOnHighPrice,
    blockReduceShortOnLowPrice,
    noChase,
    evidence,
  };
}

function buildOpponentBriefLine(opponentStatus) {
  if (!opponentStatus) return null;
  if (opponentStatus.status === '待校验') return '对手盘: 待校验';
  if (opponentStatus.status === 'overridden') return '对手盘: L3覆盖';
  return opponentStatus.label || null;
}

module.exports = {
  OPPONENT_VERSION,
  MOTTO,
  evaluateOpponentCapitulation,
  extractOiDeltaPct,
  buildOpponentBriefLine,
  mapOpponentLabel,
};
