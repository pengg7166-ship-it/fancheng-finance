/**

 * 叙事 vs 价格 vs 命题目标 'overshoot/underpriced/gap + priced-in degree

 */

const GAP_VERSION = 'v1.44.0-discipline';



function nowIso() {

  return new Date().toISOString();

}



function parseTargetFromThesis(theses = []) {

  for (const t of theses) {

    const claim = t.claim || '';

    const m = claim.match(/(\d+(?:\.\d+)?)\s*(?:元|美元|\/吨|%)/);

    if (m) return { value: Number(m[1]), source: 'thesis-registry:claim', thesisId: t.id };

    if (t.targetPrice != null) return { value: Number(t.targetPrice), source: 'thesis-registry:targetPrice', thesisId: t.id };

  }

  return null;

}



function computePricedInDegree(ref, theses, att, phase) {

  if (ref == null) return { degree: 'unknown', score: null, evidence: ['基准价暂无'] };

  const evidence = [];

  let score = 50;



  const overshootThesis = theses.find((t) => t.status === 'overshoot' || t.overshootMeta);

  if (overshootThesis) {

    score = 85;

    evidence.push('命题已标 overshoot · 预期充分定价');

  }



  const target = parseTargetFromThesis(theses);

  if (target?.value != null) {

    const diffPct = ((ref - target.value) / target.value) * 100;

    if (diffPct > 5) {

      score = Math.max(score, 75 + Math.min(diffPct, 15));

      evidence.push(`现价超目'${diffPct.toFixed(1)}% · 定价偏高`);

    } else if (diffPct < -5) {

      score = Math.min(score, 25);

      evidence.push(`现价低于目标 ${Math.abs(diffPct).toFixed(1)}% · 定价偏低`);

    } else {

      evidence.push(`接近命题目标 · 定价中性`);

    }

  }



  if (att != null) {

    if (att >= 75 && (phase === '拥挤' || phase === '升温')) {

      score = Math.max(score, att);

      evidence.push(`资金 ${att} + phase ${phase} · 叙事'price-in`);

    } else if (att < 35) {

      score = Math.min(score, 30);

      evidence.push(`资金 ${att} 偏低 · 预期未充分定价`);

    }

  }



  let degree = 'partial';

  if (score >= 75) degree = 'high';

  else if (score <= 30) degree = 'low';

  else if (score >= 55) degree = 'moderate-high';



  return { degree, score: Math.round(score), evidence };

}



/**

 * @returns {{ gap: string, narrativeVsPrice: string|null, vsThesisTarget: string|null, pricedInDegree: object, overshootBounceEligible: boolean, evidence: string[], dataSource: string, method: string, asOf: string }}

 */

function computeExpectationGap(inst, context = {}) {

  const asOf = nowIso();

  const evidence = [];

  const ref = inst?.price ?? inst?.highLowPrediction?.baseClose ?? null;

  const theses = inst?.macroSynthesis?.activeTheses || context.activeTheses || [];

  const att = inst?.capitalAttention?.score;

  const phase = context.tradingGuidance?.phase || inst?.tradingGuidance?.phase;

  const priorHigh = inst?.recentHigh ?? inst?.highLowPrediction?.predictedHigh ?? null;



  if (ref == null) {

    return {

      gap: 'unknown',

      narrativeVsPrice: null,

      vsThesisTarget: null,

      pricedInDegree: { degree: 'unknown', score: null, evidence: ['现价/基准暂无'] },

      overshootBounceEligible: false,

      evidence: ['现价/基准暂无'],

      dataSource: 'expectation-gap',

      method: 'narrative-price-thesis+priced-in',

      version: GAP_VERSION,

      asOf,

    };

  }



  let gap = 'aligned';

  let narrativeVsPrice = 'aligned';



  const overshootThesis = theses.find((t) => t.status === 'overshoot' || t.overshootMeta);

  if (overshootThesis) {

    gap = 'overshoot';

    narrativeVsPrice = 'overshoot';

    evidence.push(`命题 overshoot · ${(overshootThesis.claim || '').slice(0, 60)}`);

  } else if (att != null && att >= 75 && phase === '拥挤') {

    gap = 'overshoot';

    narrativeVsPrice = 'narrative-ahead-of-price';

    evidence.push(`叙事/资金 ${att} 拥挤 · 警惕 overshoot`);

  } else if (att != null && att < 35 && phase === '冷淡') {

    gap = 'underpriced';

    narrativeVsPrice = 'under-attention';

    evidence.push(`资金 ${att} 冷淡 · 潜在 underpriced`);

  }



  const target = parseTargetFromThesis(theses);

  let vsThesisTarget = null;

  if (target?.value != null) {

    const diffPct = ((ref - target.value) / target.value) * 100;

    vsThesisTarget = `${diffPct >= 0 ? '+' : '-'}${diffPct.toFixed(1)}% vs 命题目标 ${target.value}`;

    evidence.push(vsThesisTarget);

    if (diffPct > 8 && gap === 'aligned') gap = 'overshoot';

    if (diffPct < -8 && gap === 'aligned') gap = 'underpriced';

  } else {

    evidence.push('命题目标价待校验');

  }



  const pricedInDegree = computePricedInDegree(ref, theses, att, phase);

  evidence.push(...(pricedInDegree.evidence || []));



  const overshootBounceEligible =

    (gap === 'overshoot' || overshootThesis) &&

    (phase === '退潮' || phase === '冷淡') &&

    att != null &&

    att >= 40 &&

    att <= 65;



  if (overshootBounceEligible) {

    evidence.push('O2 二次反弹·快钱 eligible · 通常不破前高');

    if (priorHigh != null) evidence.push(`前高 ceiling=${priorHigh}`);

  }



  return {

    gap,

    narrativeVsPrice,

    vsThesisTarget,

    pricedInDegree,

    overshootBounceEligible,

    priorHighCeiling: priorHigh,

    refPrice: ref,

    evidence,

    dataSource: 'expectation-gap',

    method: 'narrative-price-thesis+priced-in',

    version: GAP_VERSION,

    asOf,

  };

}



module.exports = {

  GAP_VERSION,

  computeExpectationGap,

  computePricedInDegree,

};

