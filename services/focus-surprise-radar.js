/**
 * 预期差雷达 · 资讯方向 vs 盘面定价 vs 基本面代理
 * 主动发现「市场还没定价」或「已透支」的惊喜/陷阱，不依赖用户指令
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { fundamentalsScoreForSymbol } = require('./commodity-fundamentals-fetcher');

const SURPRISE_VERSION = 'v1.56.7-surprise-radar';

function newsDirection(item) {
  const d = item.direction || item.impactDimensions?.direction;
  if (d === 'bullish' || d === 'bearish') return d;
  const score = item.impactScore ?? item.impactDimensions?.compositeScore;
  if (score > 0.15) return 'bullish';
  if (score < -0.15) return 'bearish';
  return 'neutral';
}

function pricedInLabel(degree) {
  if (degree == null) return 'unknown';
  if (typeof degree === 'string') return degree;
  if (degree >= 75) return 'high';
  if (degree <= 25) return 'low';
  return 'partial';
}

/**
 * @returns {{ level, label, score, evidence, tradable, dataSource }}
 * level: surprise_high | surprise_moderate | priced_in | divergent | unknown
 */
function detectExpectationSurprise(item, outlookPayload = {}, pricedIn = {}, options = {}) {
  const base = detectExpectationSurpriseCore(item, outlookPayload, pricedIn);
  if (options.skipReleaseMerge) return base;
  try {
    const { mergeNewsSurpriseWithRelease, buildActiveReleaseSurprises } = require('./release-data-surprise');
    const fundamentals = outlookPayload?.sources?.fundamentals || outlookPayload?.fundamentals;
    const newsPool = options.newsPool || [];
    const active = buildActiveReleaseSurprises(fundamentals, outlookPayload, newsPool);
    const text = `${item?.title || ''} ${item?.summary || ''}`;
    const hit = active.find(
      (rel) =>
        rel &&
        (new RegExp(rel.releaseName, 'i').test(text) ||
          (rel.releaseId === 'eia-weekly' && /EIA|原油库存|石油库存/i.test(text)) ||
          (rel.releaseId === 'wasde' && /WASDE|美国农业部/i.test(text)))
    );
    if (hit) return mergeNewsSurpriseWithRelease(base, hit);
    const postRelease = active.filter((r) => r.phase === 'post_release');
    if (postRelease.length && item.contentType !== 'opinion') {
      const syms = (item.symbols || (item.primarySymbol ? [item.primarySymbol] : [])).map(normalizeCommodityId);
      const symHit = postRelease.find((rel) =>
        (rel.symbols || []).some((s) => syms.includes(normalizeCommodityId(s)))
      );
      if (symHit) return mergeNewsSurpriseWithRelease(base, symHit);
    }
  } catch {
    // ignore
  }
  return base;
}

function detectExpectationSurpriseCore(item, outlookPayload = {}, pricedIn = {}) {
  const evidence = [];
  const symbols = (item.symbols || (item.primarySymbol ? [item.primarySymbol] : [])).map(normalizeCommodityId);
  const dir = newsDirection(item);
  const sources = outlookPayload.sources || outlookPayload;

  if (dir === 'neutral' || !symbols.length) {
    return {
      version: SURPRISE_VERSION,
      level: 'unknown',
      label: '方向中性或品种待对照',
      score: null,
      evidence: ['资讯方向或品种映射不足'],
      tradable: false,
      dataSource: 'focus-surprise-radar',
    };
  }

  let priceAligned = 0;
  let priceChecked = 0;
  let fundAligned = 0;
  let fundChecked = 0;

  for (const sym of symbols.slice(0, 4)) {
    const inst = findInstrument(outlookPayload, sym);
    const chg = inst?.changePct ?? inst?.changePercent;
    if (chg != null) {
      priceChecked += 1;
      const bullish = chg > 0.25;
      const bearish = chg < -0.25;
      if ((dir === 'bullish' && bullish) || (dir === 'bearish' && bearish)) priceAligned += 1;
      else if ((dir === 'bullish' && bearish) || (dir === 'bearish' && bullish)) {
        evidence.push(`${sym} 现价${chg > 0 ? '+' : ''}${chg.toFixed(2)}% 与资讯${dir === 'bullish' ? '利多' : '利空'}背离`);
      }
    }

    const fund = fundamentalsScoreForSymbol(sym, sources.fundamentals);
    if (fund.hits?.length) {
      fundChecked += 1;
      const fundDir = fund.score > 0.03 ? 'bullish' : fund.score < -0.03 ? 'bearish' : 'neutral';
      if (fundDir !== 'neutral') {
        if (fundDir === dir) fundAligned += 1;
        else evidence.push(`${sym} 基本面代理${fundDir === 'bullish' ? '偏多' : '偏空'} vs 资讯${dir === 'bullish' ? '利多' : '利空'}`);
        for (const h of fund.hits.slice(0, 2)) {
          evidence.push(`${h.name} 变动${h.changePct != null ? (h.changePct > 0 ? '+' : '') + h.changePct + '%' : '—'}`);
        }
      }
    }
  }

  const pi = pricedInLabel(pricedIn.degree);
  let level = 'unknown';
  let label = '待校验';
  let score = 50;
  let tradable = false;

  const priceRatio = priceChecked ? priceAligned / priceChecked : null;

  if (pi === 'low' || (priceRatio != null && priceRatio <= 0.25)) {
    level = 'surprise_high';
    label = '预期差大 · 资讯未充分定价';
    score = 85;
    tradable = true;
    evidence.push('盘面尚未同步资讯方向，存在交易惊喜窗口');
  } else if (pi === 'high' || (priceRatio != null && priceRatio >= 0.75)) {
    level = 'priced_in';
    label = '预期已反映 · 警惕利好出尽/利空钝化';
    score = 20;
    evidence.push('盘面已与资讯同向，关注反转或二阶效应');
  } else if (priceRatio != null && priceRatio < 0.5 && fundChecked && fundAligned < fundChecked) {
    level = 'divergent';
    label = '价基背离 · 资讯与基本面代理不一致';
    score = 70;
    tradable = true;
    evidence.push('资讯方向与产量/库存/投资代理背离，需甄别真假冲击');
  } else {
    level = 'surprise_moderate';
    label = '部分定价 · 仍有残余预期空间';
    score = 55;
    tradable = pi !== 'high';
  }

  return {
    version: SURPRISE_VERSION,
    level,
    label,
    score,
    evidence: evidence.slice(0, 6),
    tradable,
    newsDirection: dir,
    pricedInTier: pi,
    dataSource: 'focus-surprise-radar',
  };
}

function findInstrument(outlookPayload, symbol) {
  const id = normalizeCommodityId(symbol);
  const exchanges = outlookPayload?.commodities?.exchanges || outlookPayload?.exchanges || [];
  for (const ex of exchanges) {
    const hit = (ex.items || ex.instruments || []).find((i) => normalizeCommodityId(i.id) === id);
    if (hit) return hit;
  }
  const flat = outlookPayload?.instruments;
  if (Array.isArray(flat)) return flat.find((i) => normalizeCommodityId(i.id) === id) || null;
  return null;
}

module.exports = {
  SURPRISE_VERSION,
  detectExpectationSurprise,
  newsDirection,
};
