/**
 * 情报中心 · 定价状态层
 * unpriced / partial / priced-in / mispriced — 证据驱动，禁止默认价掩盖。
 */
const PRICING_VERSION = 'v2.86.0-pricing-state';

function assessPricingState(inst, claim) {
  const gap = inst?.expectationGap || inst?.factors?.expectationGap;
  const news = inst?.factors?.news;
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const kernel = inst?.intelligenceKernel;
  const changePct = inst?.changePct;
  const side = claim?.side || 'flat';

  let state = 'partial';
  let rationale = [];
  let score = 0.5;

  if (gap?.pricedIn === true) {
    state = 'priced-in';
    score = 0.85;
    rationale.push('预期差标已定价');
  } else if (gap?.overshoot === true) {
    state = 'mispriced';
    score = 0.75;
    rationale.push('价格超涨/超跌于结构');
  }

  const structBull = sf?.structureBias === 'bull' || side === 'bull';
  const structBear = sf?.structureBias === 'bear' || side === 'bear';
  const priceUp = changePct != null && changePct > 0.5;
  const priceDown = changePct != null && changePct < -0.5;

  if (structBull && priceDown) {
    state = 'mispriced';
    score = 0.8;
    rationale.push('结构偏多但价格下跌');
  } else if (structBear && priceUp) {
    state = 'mispriced';
    score = 0.8;
    rationale.push('结构偏空但价格上涨');
  } else if ((structBull && !priceUp && !priceDown) || (structBear && !priceDown && !priceUp)) {
    if (state !== 'priced-in') {
      state = 'unpriced';
      score = 0.7;
      rationale.push('结构变化尚未充分反映于价格');
    }
  }

  if (news?.shock != null && news.shock > 0.6 && state === 'unpriced') {
    rationale.push(`新闻冲击 ${news.shockDisplay || news.shock}`);
  }

  if (kernel?.dissent?.dissentStrength >= 0.6 && state !== 'mispriced') {
    state = state === 'priced-in' ? 'partial' : 'mispriced';
    rationale.push('强制反对意见强');
    score = Math.max(score, kernel.dissent.dissentStrength);
  }

  if (!sf?.available && !gap && changePct == null) {
    return {
      version: PRICING_VERSION,
      state: 'unknown',
      stateLabel: '待校验',
      score: null,
      rationale: ['关键结构/价格证据不足'],
      dataSource: 'missing',
      actionHint: '等待数据补齐',
    };
  }

  const labels = {
    unpriced: '未定价',
    partial: '部分定价',
    'priced-in': '已定价',
    mispriced: '定价背离',
    unknown: '待校验',
  };

  const actionHints = {
    unpriced: '可提高关注，允许战术推送',
    partial: '观察剩余 surprise 空间',
    'priced-in': '禁止重复利好推送',
    mispriced: '红队+深度队列优先',
    unknown: '暂不建议方向结论',
  };

  return {
    version: PRICING_VERSION,
    state,
    stateLabel: labels[state] || '待校验',
    score: score != null ? +score.toFixed(3) : null,
    rationale: rationale.length ? rationale : ['结构与价格大致同向'],
    dataSource: [sf?.dataSource, gap?.dataSource, 'price'].filter(Boolean).join('+') || 'intel-pricing-state',
    actionHint: actionHints[state] || '观望',
  };
}

module.exports = {
  PRICING_VERSION,
  assessPricingState,
};
