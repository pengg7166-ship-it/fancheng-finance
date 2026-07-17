/**
 * 发布日 · 数据 surprise 雷达（EIA 库存 / WASDE 农产品）
 * 对照真实 fundamentals 与盘面，不合成 actual
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getActiveReleaseEvents } = require('./commodity-release-calendar');

const RELEASE_SURPRISE_VERSION = 'v1.56.7-release-surprise';

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

function priceDirection(changePct) {
  if (changePct == null || Number.isNaN(changePct)) return 'neutral';
  if (changePct > 0.25) return 'bullish';
  if (changePct < -0.25) return 'bearish';
  return 'neutral';
}

/** 库存上升 → 利空油价；库存下降 → 利多 */
function inventoryFundamentalDirection(changePct) {
  if (changePct == null || Number.isNaN(changePct)) return 'neutral';
  if (changePct > 0.35) return 'bearish';
  if (changePct < -0.35) return 'bullish';
  return 'neutral';
}

function buildSurpriseResult({ release, level, label, score, evidence, tradable, symbols, dataLane }) {
  return {
    version: RELEASE_SURPRISE_VERSION,
    releaseId: release.id,
    releaseName: release.name,
    releaseDate: release.releaseDate,
    phase: release.phase,
    level,
    label,
    score,
    evidence: evidence.slice(0, 8),
    tradable,
    symbols,
    dataLane,
    dataSource: 'release-data-surprise',
    method: release.method,
  };
}

function assessEiaReleaseSurprise(release, fundamentals, outlookPayload) {
  const indicators = fundamentals?.indicators || [];
  const crude = indicators.find((i) => i.id === 'WCESTUS1');
  if (!crude || crude.changePct == null) {
    return buildSurpriseResult({
      release,
      level: 'unknown',
      label: 'EIA 库存数据待校验',
      score: null,
      evidence: ['WCESTUS1 周度库存暂无或 changePct 缺失'],
      tradable: false,
      symbols: release.symbols || ['sc', 'fu'],
      dataLane: crude?.dataSource || 'missing',
    });
  }

  const dataDir = inventoryFundamentalDirection(crude.changePct);
  const evidence = [
    `${crude.name} 周变动 ${crude.changePct > 0 ? '+' : ''}${crude.changePct}%（${crude.date || '—'} · ${crude.dataSource || 'eia'})`,
  ];

  const symbolReads = [];
  let mismatchN = 0;
  let alignN = 0;

  for (const sym of (release.symbols || ['sc', 'fu']).slice(0, 4)) {
    const inst = findInstrument(outlookPayload, sym);
    const chg = inst?.changePct ?? inst?.changePercent;
    const pDir = priceDirection(chg);
    if (chg == null) {
      evidence.push(`${sym} 盘面涨跌幅暂无`);
      continue;
    }
    symbolReads.push({ sym, changePct: chg, priceDir: pDir });
    if (dataDir !== 'neutral' && pDir !== 'neutral') {
      if (pDir === dataDir) {
        alignN += 1;
        evidence.push(`${sym.toUpperCase()} ${chg > 0 ? '+' : ''}${Number(chg).toFixed(2)}% 已与库存方向一致`);
      } else {
        mismatchN += 1;
        evidence.push(
          `${sym.toUpperCase()} ${chg > 0 ? '+' : ''}${Number(chg).toFixed(2)}% vs EIA ${dataDir === 'bullish' ? '去库利多' : '累库利空'} · 背离`
        );
      }
    }
  }

  if (dataDir === 'neutral') {
    return buildSurpriseResult({
      release,
      level: 'surprise_moderate',
      label: 'EIA 库存变动温和 · 方向不强',
      score: 45,
      evidence,
      tradable: false,
      symbols: symbolReads.map((r) => r.sym),
      dataLane: crude.dataSource,
    });
  }

  if (mismatchN > 0 && alignN === 0) {
    return buildSurpriseResult({
      release,
      level: 'surprise_high',
      label: 'EIA 发布后 · 库存与盘面背离',
      score: 88,
      evidence,
      tradable: true,
      symbols: symbolReads.map((r) => r.sym),
      dataLane: crude.dataSource,
    });
  }

  if (alignN > 0 && mismatchN === 0) {
    return buildSurpriseResult({
      release,
      level: 'priced_in',
      label: 'EIA 库存冲击已反映于盘面',
      score: 22,
      evidence,
      tradable: false,
      symbols: symbolReads.map((r) => r.sym),
      dataLane: crude.dataSource,
    });
  }

  return buildSurpriseResult({
    release,
    level: 'surprise_moderate',
    label: 'EIA 发布后 · 部分品种仍有余量',
    score: 58,
    evidence,
    tradable: mismatchN > 0,
    symbols: symbolReads.map((r) => r.sym),
    dataLane: crude.dataSource,
  });
}

function assessWasdeReleaseSurprise(release, outlookPayload, newsItems = []) {
  const agSymbols = (release.symbols || ['m', 'y', 'p']).slice(0, 5);
  const evidence = [];
  const wasdeNews = (newsItems || []).filter((n) =>
    /WASDE|美国农业部|供需报告|期末库存/i.test(`${n.title || ''} ${n.summary || ''}`)
  );
  if (wasdeNews.length) {
    evidence.push(`相关资讯 ${wasdeNews.length} 条（待与盘面核对）`);
  } else {
    evidence.push('发布窗口内暂无 WASDE 标题快讯');
  }

  let aligned = 0;
  let checked = 0;
  for (const sym of agSymbols) {
    const inst = findInstrument(outlookPayload, sym);
    const chg = inst?.changePct ?? inst?.changePercent;
    if (chg == null) continue;
    checked += 1;
    const hit = wasdeNews.some((n) => {
      const tags = n.symbols || [];
      return tags.map(normalizeCommodityId).includes(normalizeCommodityId(sym));
    });
    if (hit && Math.abs(chg) > 0.4) aligned += 1;
    evidence.push(`${sym.toUpperCase()} ${chg > 0 ? '+' : ''}${Number(chg).toFixed(2)}%`);
  }

  if (!checked) {
    return buildSurpriseResult({
      release,
      level: 'unknown',
      label: 'WASDE 发布日 · 盘面待校验',
      score: null,
      evidence,
      tradable: false,
      symbols: agSymbols,
      dataLane: 'wasde-window',
    });
  }

  const level = wasdeNews.length && aligned < checked * 0.5 ? 'surprise_moderate' : wasdeNews.length ? 'priced_in' : 'unknown';
  return buildSurpriseResult({
    release,
    level,
    label:
      level === 'surprise_moderate'
        ? 'WASDE 发布日 · 资讯与盘面部分脱节'
        : level === 'priced_in'
          ? 'WASDE 相关资讯已在盘面体现'
          : 'WASDE 发布日 · 待更多资讯',
    score: level === 'surprise_moderate' ? 62 : level === 'priced_in' ? 28 : null,
    evidence,
    tradable: level === 'surprise_moderate',
    symbols: agSymbols,
    dataLane: 'wasde-news-vs-price',
  });
}

function assessReleaseDataSurprise(release, fundamentals, outlookPayload, newsItems = []) {
  if (!release?.id) return null;
  switch (release.id) {
    case 'eia-weekly':
      return assessEiaReleaseSurprise(release, fundamentals, outlookPayload);
    case 'wasde':
      return assessWasdeReleaseSurprise(release, outlookPayload, newsItems);
    default:
      return null;
  }
}

function buildActiveReleaseSurprises(fundamentals, outlookPayload, newsItems = []) {
  const active = getActiveReleaseEvents();
  return active
    .map((release) => assessReleaseDataSurprise(release, fundamentals, outlookPayload, newsItems))
    .filter(Boolean);
}

function collectReleaseNewsPool() {
  const pool = [];
  try {
    const { getGlobalNewsPoolSync } = require('./commodities-news');
    pool.push(...(getGlobalNewsPoolSync() || []));
  } catch {
    // ignore
  }
  try {
    const { getCachedExchangeNoticeBundle } = require('./exchange-notice-fetcher');
    const bundle = getCachedExchangeNoticeBundle();
    if (bundle?.items?.length) pool.push(...bundle.items);
  } catch {
    // ignore
  }
  try {
    const diskCache = require('./disk-cache');
    const { getDataDir } = require('./data-paths');
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    const policy = diskCache.readStale('policy-radar.json')?.data?.items;
    if (policy?.length) pool.push(...policy);
  } catch {
    // ignore
  }
  return pool;
}

function mergeNewsSurpriseWithRelease(baseSurprise, releaseSurprise) {
  if (!releaseSurprise || releaseSurprise.level === 'unknown') return baseSurprise;
  if (!baseSurprise) return releaseSurprise;

  const rank = { surprise_high: 4, divergent: 3, surprise_moderate: 2, priced_in: 1, unknown: 0 };
  const baseR = rank[baseSurprise.level] || 0;
  const relR = rank[releaseSurprise.level] || 0;

  if (relR > baseR) {
    return {
      ...baseSurprise,
      level: releaseSurprise.level,
      label: `${releaseSurprise.label} · ${baseSurprise.label}`,
      score: Math.max(baseSurprise.score || 0, releaseSurprise.score || 0),
      evidence: [...releaseSurprise.evidence, '—', ...(baseSurprise.evidence || [])].slice(0, 8),
      tradable: baseSurprise.tradable || releaseSurprise.tradable,
      releaseSurprise,
      dataSource: 'focus-surprise-radar+release-data-surprise',
    };
  }

  return {
    ...baseSurprise,
    releaseSurprise,
    evidence: [...(baseSurprise.evidence || []), ...(releaseSurprise.evidence || []).slice(0, 2)].slice(0, 8),
  };
}

module.exports = {
  RELEASE_SURPRISE_VERSION,
  assessReleaseDataSurprise,
  buildActiveReleaseSurprises,
  collectReleaseNewsPool,
  mergeNewsSurpriseWithRelease,
  inventoryFundamentalDirection,
};
