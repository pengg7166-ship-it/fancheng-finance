/**
 * 大宗研判顶部板块 · ①全球 ②板块 ③流动性 ④快讯
 * ①② 展示前须完成 Cursor 解读（配置可用时）
 */
const fs = require('fs');
const path = require('path');
const { getExternalRoot } = require('./data-paths');
const { todaySessionDate } = require('./focus-read-state');
const { polishNewsFields } = require('./focus-news-zh');
const {
  scanAndMergeImpactPins,
  getPinnedGlobal,
  getPinnedSector,
  getPinnedFeed,
  getPinnedForSymbol,
  sectorLabel,
  loadPinStore,
  savePinStore,
  refreshPinPresentation,
  PIN_VERSION,
  IMPACT_GRADE,
} = require('./focus-impact-pins');
const { searchAnyNews } = require('./focus-anysearch-news');
const {
  analyzeWithCursor,
  isCursorConfigured,
  getCloudConcurrencyLimit,
  IMPACT_BRIEF_PROMPT,
  parseImpactBriefSections,
} = require('./cursor-llm-client');
const { buildPinExpectationContext, FACTOR_VERSION } = require('./focus-expectation-factors');
const { mergeOutlookWithSources } = require('./outlook-context-merge');
const {
  generateLiquidityDailyBrief,
  loadCachedLiquidityDaily,
  LIQUIDITY_DAILY_VERSION,
} = require('./focus-liquidity-daily-cursor');

const HEADLINES_VERSION = 'v1.55.0-headlines-surprise';

function alertsFile() {
  const root = getExternalRoot();
  if (!root) return null;
  return path.join(root, 'focus-analysis', 'impact-pins', 'alerts.json');
}

function loadUnreadAlerts() {
  const fp = alertsFile();
  if (!fp || !fs.existsSync(fp)) return [];
  try {
    const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return (row.items || []).filter((a) => !a.read);
  } catch {
    return [];
  }
}

function markImpactAlertsRead(newsIds = []) {
  const fp = alertsFile();
  if (!fp || !fs.existsSync(fp)) return { ok: false };
  try {
    const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const ids = new Set((newsIds || []).filter(Boolean));
    const items = (row.items || []).map((item) =>
      ids.size === 0 || ids.has(item.newsId) ? { ...item, read: true } : item
    );
    fs.writeFileSync(fp, JSON.stringify({ ...row, items, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { ok: true, unread: items.filter((i) => !i.read).length };
  } catch {
    return { ok: false };
  }
}

function pushAlerts(newItems = []) {
  if (!newItems.length) return;
  const fp = alertsFile();
  if (!fp) return;
  const prev = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : { items: [] };
  const seen = new Set((prev.items || []).map((i) => i.newsId));
  const merged = [...(prev.items || [])];
  for (const item of newItems) {
    if (seen.has(item.newsId)) continue;
    merged.unshift({
      newsId: item.newsId,
      title: item.title,
      impactTier: item.impactTier,
      impactScore: item.impactScore,
      at: new Date().toISOString(),
      read: false,
    });
  }
  fs.writeFileSync(fp, JSON.stringify({ items: merged.slice(0, 40), updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

function polishHeadlineItem(item) {
  if (!item) return item;
  const refreshed = refreshPinPresentation(item);
  const polished = polishNewsFields({ ...item, ...refreshed });
  return {
    ...refreshed,
    title: polished.title,
    summary: polished.summary || refreshed.summary,
    summaryIsEnglish: polished.summaryIsEnglish === true,
    impactGrade: IMPACT_GRADE[item.impactTier]?.board || null,
    impactSummary: item.impactSummary || null,
    impactDimensions: item.impactDimensions || null,
  };
}

async function fetchProfessionalViews(item) {
  if (item.professionalViews?.length >= 3) return item.professionalViews;
  const q = `${item.title} 大宗商品 机构解读 影响 专业分析`;
  const result = await searchAnyNews(q, { maxResults: 6 });
  return (result.items || [])
    .filter((r) => r.title && r.title !== item.title)
    .slice(0, 5)
    .map((r) => {
      const polished = polishNewsFields(r);
      return {
        title: polished.title || r.title,
        snippet: polished.summary || r.snippet || '',
        url: r.url || null,
        source: r.source || 'anysearch',
      };
    });
}

function cursorBriefStale(item) {
  const brief = item.cursorBrief;
  if (!brief?.text) return true;
  if (brief.factorVersion !== FACTOR_VERSION) return true;
  const dim = item.impactDimensions || {};
  const hash = `${dim.width}|${dim.breadth}|${dim.durationLabel}|${dim.govPolicy?.score ?? ''}|${item.impactScore ?? ''}`;
  if (brief.impactHash && brief.impactHash !== hash) return true;
  const age = Date.now() - new Date(brief.generatedAt || 0).getTime();
  if (age > 6 * 60 * 60 * 1000) return true;
  return false;
}

async function ensureCursorBriefForItem(item, outlookPayload = {}) {
  const merged = mergeOutlookWithSources(outlookPayload);
  if (item.cursorBrief?.text && !cursorBriefStale(item)) return item.cursorBrief;
  if (!isCursorConfigured()) {
    return { text: null, error: '未配置 CURSOR_API_KEY', pending: true };
  }
  const dim = item.impactDimensions || {};
  const impactHash = `${dim.width}|${dim.breadth}|${dim.durationLabel}|${dim.govPolicy?.score ?? ''}|${item.impactScore ?? ''}`;
  const context = {
    sessionDate: todaySessionDate(),
    impactTier: item.impactTier,
    impactScore: item.impactScore,
    impactDimensions: item.impactDimensions,
    expectationReview:
      item.impactDimensions?.expectationReview || item.impactDimensions?.relevance || null,
    impactSummary: item.impactSummary,
    govPolicy: item.impactDimensions?.govPolicy || item.govPolicy || null,
    expectationFactors: buildPinExpectationContext(item, merged),
    headline: {
      title: item.title,
      summary: item.summary,
      source: item.source,
      url: item.url,
      direction: item.direction,
      sectors: item.sectors,
      symbols: item.symbols,
      watchPriority: item.watchPriority || item.impactDimensions?.expectationReview?.watchPriority || null,
    },
    professionalViews: item.professionalViews || [],
    globalRisk: merged?.globalLiquidityRisk || merged?.globalRisk || null,
  };
  const raw = await analyzeWithCursor(IMPACT_BRIEF_PROMPT, context);
  const sections = parseImpactBriefSections(raw.text);
  return {
    text: raw.text,
    sections,
    model: raw.model,
    error: raw.error || null,
    generatedAt: new Date().toISOString(),
    factorVersion: FACTOR_VERSION,
    impactHash,
    dataSource: raw.dataSource || 'cursor',
  };
}

async function enrichPinItem(item, outlookPayload) {
  const merged = mergeOutlookWithSources(outlookPayload);
  const views = await fetchProfessionalViews(item);
  const expectationFactors = buildPinExpectationContext(item, merged);
  const cursorBrief = await ensureCursorBriefForItem({ ...item, professionalViews: views }, merged);
  return { ...item, professionalViews: views, cursorBrief, expectationFactors };
}

/** ①② 板块：对全部合格条目强制 Cursor 解读，不漏条 */
async function enrichAllPins(tier, outlookPayload = {}) {
  const store = loadPinStore(tier);
  const items = store.items || [];
  if (!items.length) return [];
  if (!isCursorConfigured()) {
    return items.map((item) => ({
      ...item,
      cursorBrief: item.cursorBrief || { text: null, error: '未配置 CURSOR_API_KEY', pending: true },
    }));
  }

  const concurrency = Math.min(4, getCloudConcurrencyLimit());
  const enriched = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      const needsEnrich = cursorBriefStale(item) || item.cursorBrief?.error;
      if (!needsEnrich && item.cursorBrief?.text) {
        enriched[i] = item;
        continue;
      }
      try {
        enriched[i] = await enrichPinItem(item, outlookPayload);
      } catch {
        enriched[i] = {
          ...item,
          cursorBrief: { text: null, error: 'Cursor 解读失败', pending: true },
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  const map = new Map(enriched.filter(Boolean).map((i) => [i.newsId, i]));
  const merged = items.map((i) => map.get(i.newsId) || i);
  savePinStore(tier, { ...store, items: merged, updatedAt: new Date().toISOString() });
  return merged;
}

function readImpactHeadlinesFromDisk() {
  const globalItems = getPinnedGlobal().map(polishHeadlineItem);
  const sectorItems = getPinnedSector().map(polishHeadlineItem);
  const feedItems = getPinnedFeed().map(polishHeadlineItem);
  const liquidity = loadCachedLiquidityDaily();
  return {
    version: HEADLINES_VERSION,
    pinVersion: PIN_VERSION,
    sessionDate: todaySessionDate(),
    asOf: new Date().toISOString(),
    alerts: loadUnreadAlerts(),
    global: {
      title: '全市场重大影响',
      pinDays: 7,
      grade: 1,
      items: globalItems,
      empty: globalItems.length === 0,
    },
    sector: {
      title: '板块重大影响',
      pinDays: 7,
      grade: 2,
      items: sectorItems.map((i) => ({ ...i, sectorLabels: (i.sectors || []).map(sectorLabel) })),
      empty: sectorItems.length === 0,
    },
    feed: {
      title: '快讯跟踪',
      pinDays: 1,
      grade: 4,
      items: feedItems,
      empty: feedItems.length === 0,
    },
    liquidityDaily: liquidity?.text
      ? liquidity
      : {
          version: LIQUIDITY_DAILY_VERSION,
          sessionDate: todaySessionDate(),
          text: null,
          pending: true,
          dataSource: 'focus-liquidity-daily-cursor',
        },
    cursorConfigured: isCursorConfigured(),
    loading: false,
    dataSource: 'focus-outlook-headlines',
    readOnly: true,
  };
}

async function buildOutlookHeadlinesPackage(outlookPayload = {}, options = {}) {
  const merged = mergeOutlookWithSources(outlookPayload);
  const readOnly = options.readOnly === true || (options.fast === true && options.skipScan !== false);
  const scan =
    options.skipScan || readOnly ? null : scanAndMergeImpactPins(merged);
  if (scan?.newAlerts?.length) pushAlerts(scan.newAlerts);

  let globalItems = getPinnedGlobal().map(polishHeadlineItem);
  let sectorItems = getPinnedSector().map(polishHeadlineItem);
  const feedItems = getPinnedFeed().map(polishHeadlineItem);

  let liquidity = loadCachedLiquidityDaily();
  if (readOnly) {
    return readImpactHeadlinesFromDisk();
  }
  const fastOnly = options.fast === true || options.enrichCursor === false;
  if (fastOnly) {
    return {
      version: HEADLINES_VERSION,
      pinVersion: PIN_VERSION,
      sessionDate: todaySessionDate(),
      asOf: new Date().toISOString(),
      scan,
      alerts: loadUnreadAlerts(),
      global: { title: '全市场重大影响', pinDays: 7, grade: 1, items: globalItems, empty: globalItems.length === 0 },
      sector: {
        title: '板块重大影响',
        pinDays: 7,
        grade: 2,
        items: sectorItems.map((i) => ({ ...i, sectorLabels: (i.sectors || []).map(sectorLabel) })),
        empty: sectorItems.length === 0,
      },
      feed: { title: '快讯跟踪', pinDays: 1, grade: 4, items: feedItems, empty: feedItems.length === 0 },
      liquidityDaily: liquidity?.text
        ? liquidity
        : { version: LIQUIDITY_DAILY_VERSION, sessionDate: todaySessionDate(), text: null, pending: true, dataSource: 'focus-liquidity-daily-cursor' },
      cursorConfigured: isCursorConfigured(),
      loading: true,
      dataSource: 'focus-outlook-headlines',
    };
  }

  const shouldGenLiquidity =
    options.forceLiquidity === true ||
    (isCursorConfigured() && (!liquidity?.text || liquidity.stale === true));
  if (shouldGenLiquidity) {
    liquidity = await generateLiquidityDailyBrief(merged, { force: options.forceLiquidity === true });
  } else if (!liquidity?.text) {
    liquidity = {
      version: LIQUIDITY_DAILY_VERSION,
      sessionDate: todaySessionDate(),
      text: null,
      pending: true,
      error: isCursorConfigured() ? null : '未配置 CURSOR_API_KEY',
      dataSource: 'focus-liquidity-daily-cursor',
    };
  }

  if (options.enrichCursor !== false) {
    if (globalItems.length) {
      globalItems = (await enrichAllPins('global', merged)).map(polishHeadlineItem);
    }
    if (sectorItems.length) {
      sectorItems = (await enrichAllPins('sector', merged)).map(polishHeadlineItem);
    }
  }

  return {
    version: HEADLINES_VERSION,
    pinVersion: PIN_VERSION,
    sessionDate: todaySessionDate(),
    asOf: new Date().toISOString(),
    scan,
    alerts: loadUnreadAlerts(),
    global: {
      title: '全市场重大影响',
      pinDays: 7,
      grade: 1,
      items: globalItems,
      empty: globalItems.length === 0,
    },
    sector: {
      title: '板块重大影响',
      pinDays: 7,
      grade: 2,
      items: sectorItems.map((i) => ({
        ...i,
        sectorLabels: (i.sectors || []).map(sectorLabel),
      })),
      empty: sectorItems.length === 0,
    },
    feed: {
      title: '快讯跟踪',
      pinDays: 1,
      grade: 4,
      items: feedItems,
      empty: feedItems.length === 0,
    },
    liquidityDaily: liquidity,
    cursorConfigured: isCursorConfigured(),
    loading: false,
    dataSource: 'focus-outlook-headlines',
  };
}

module.exports = {
  HEADLINES_VERSION,
  buildOutlookHeadlinesPackage,
  readImpactHeadlinesFromDisk,
  getPinnedForSymbol,
  enrichPinItem,
  enrichAllPins,
  loadUnreadAlerts,
  markImpactAlertsRead,
  polishHeadlineItem,
};
