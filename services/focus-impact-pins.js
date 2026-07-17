/**
 * 重大政策/资讯 · 分级置顶
 * 分级依据：宽度（波及面）× 广度（冲击深度）× 时长（可持续）— 见 focus-impact-dimensions.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getExternalRoot } = require('./data-paths');
const {
  detectCommodityTags,
  normalizeCommodityId,
} = require('./policy-commodity-map');
const { hasDirectSymbolMention, isUsRegulatoryNewsItem } = require('./commodities-news');
const { getCommodityMeta } = require('./commodities-catalog');
const { getInstrumentProfile } = require('./commodity-instrument-profiles');
const { getNewsKeywords } = require('./commodities-news');
const {
  assessCommodityImpact,
  classifyTierFromDimensions,
  dimensionsPassTierGate,
  pinDaysFromDuration,
  formatDimensionsSummary,
  isRoutineMarketWrap,
  isEnforcementNoise,
  isGlobalSystemic,
} = require('./focus-impact-dimensions');

const PIN_VERSION = 'v1.56.2-content-type';
const POOL_LIMIT = 320;
const { polishNewsFields, isSyntheticNewsText } = require('./focus-news-zh');
const { isOpinionTitle } = require('./opinion-news');
const { assessOpinionLogic, opinionSectorEligible } = require('./opinion-logic-gate');
const {
  assessNewsSourceQuality,
  meetsTierSourceFloor,
  blendRankingScore,
} = require('./focus-news-source-quality');
const TTL_MS = {
  global: 7 * 24 * 60 * 60 * 1000,
  sector: 7 * 24 * 60 * 60 * 1000,
  symbol: 3 * 24 * 60 * 60 * 1000,
  feed: 24 * 60 * 60 * 1000,
};

/** 新闻等级：由三维评估推导，minScore 仅作展示排序参考 */
const IMPACT_GRADE = {
  global: { label: '全市场重大影响', board: 1, minWidth: 72, minBreadth: 55 },
  sector: { label: '板块重大影响', board: 2, minWidth: 28, minBreadth: 50 },
  symbol: { label: '单品种要闻', board: 3, minBreadth: 36 },
  feed: { label: '快讯跟踪', board: 4, maxBreadth: 42 },
};

const SECTOR_LABELS = {
  precious: '贵金属',
  metals: '有色',
  black: '黑色',
  agriculture: '农产品',
  chemical: '化工',
  energy: '能化',
};

const SECTOR_KEYWORDS = {
  precious: ['贵金属', '黄金', '白银', '金价', '银价', 'bullion', 'gold', 'silver'],
  metals: ['有色', '铜', '铝', '锌', '镍', '电解铜', 'copper', 'aluminium'],
  black: ['黑色', '钢铁', '粗钢', '铁矿石', '焦煤', '焦炭', 'rebar', 'iron ore'],
  agriculture: ['农产品', '粮食', '大豆', '玉米', '棉花', '白糖', '猪价', '菜油', '菜籽'],
  chemical: ['化工', '石化', '炼化', '纯碱', '玻璃', '甲醇', '聚酯', '反内卷'],
  energy: ['原油', '石油', 'OPEC', '油气', '燃料油', 'crude', 'petroleum'],
};


function itemImpactText(item) {
  return `${item.title || ''} ${item.summary || ''} ${item.titleEn || ''}`;
}

function reassessItemDimensions(item) {
  const text = itemImpactText(item);
  return assessCommodityImpact(text, {
    sectors: item.sectors,
    symbols: item.symbols,
    stars: item.stars,
  }, SECTOR_KEYWORDS);
}

const GLOBAL_STALE_MS = 60 * 24 * 60 * 60 * 1000;

function pinsRoot() {
  let root = getExternalRoot();
  if (!root) {
    const candidates = [
      process.env.FANCHENG_DATA_DIR,
      process.env.FANCHENG_APP_ROOT,
      'F:\\FanchengFinance',
      'E:\\FanchengFinance',
    ].filter(Boolean);
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      const probe = path.join(resolved, 'focus-analysis', 'impact-pins', 'global.json');
      if (fs.existsSync(probe)) {
        root = resolved;
        break;
      }
    }
  }
  if (!root) return null;
  const dir = path.join(root, 'focus-analysis', 'impact-pins');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'symbols'), { recursive: true });
  return dir;
}

function pinFile(tier) {
  const dir = pinsRoot();
  if (!dir) return null;
  if (tier === 'symbol') return null;
  return path.join(dir, `${tier}.json`);
}

function symbolPinFile(sym) {
  const dir = pinsRoot();
  if (!dir) return null;
  return path.join(dir, 'symbols', `${normalizeCommodityId(sym)}.json`);
}

function makeNewsId(item) {
  const key = `${item.url || item.link || ''}|${item.title || item.titleEn || ''}|${item.source || ''}`;
  return crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
}

function loadPinStore(tier, symbol) {
  const fp = tier === 'symbol' ? symbolPinFile(symbol) : pinFile(tier);
  if (!fp || !fs.existsSync(fp)) return { version: PIN_VERSION, tier, items: [], updatedAt: null };
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { version: PIN_VERSION, tier, items: [], updatedAt: null };
  }
}

function savePinStore(tier, payload, symbol) {
  const fp = tier === 'symbol' ? symbolPinFile(symbol) : pinFile(tier);
  if (!fp) return null;
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}


function isSyntheticPinTitle(title) {
  return isSyntheticNewsText(title);
}

function isValidGlobalPin(item) {
  if (!item?.newsId) return false;
  const text = itemImpactText(item);
  if (isStaleForGlobalPin(item)) return false;
  if (isSyntheticPinTitle(item.title) && !/关税|制裁|OFAC|USTR|tariff|sanction/i.test(text)) return false;
  const dim = reassessItemDimensions(item);
  return dimensionsPassTierGate(dim, 'global');
}

function isValidSectorPin(item) {
  if (!item?.newsId) return false;
  const text = itemImpactText(item);
  if (!item.sectors?.length) return false;
  if (isSyntheticPinTitle(item.title) && !/关税|制裁|反内卷|限产|减产|tariff|sanction/i.test(text)) return false;
  const dim = reassessItemDimensions(item);
  return dimensionsPassTierGate(dim, 'sector');
}

function isValidFeedPin(item) {
  if (!item?.newsId) return false;
  const dim = reassessItemDimensions(item);
  if (dim.isNoise) return false;
  if (dimensionsPassTierGate(dim, 'global') || dimensionsPassTierGate(dim, 'sector')) return false;
  return dimensionsPassTierGate(dim, 'feed');
}

function isValidSymbolPin(item) {
  if (!item?.newsId) return false;
  const text = itemImpactText(item);
  if (isEnforcementNoise(text)) return false;
  if (isSyntheticPinTitle(item.title)) return false;
  const dim = reassessItemDimensions(item);
  if (!dimensionsPassTierGate(dim, 'symbol')) return false;
  return Boolean(item.primarySymbol || item.symbols?.length);
}

function inferPublishedAgeMs(raw) {
  const t = raw.publishedAt || raw.pubDate || raw.date;
  if (t) {
    const ms = new Date(t).getTime();
    if (!Number.isNaN(ms)) return Date.now() - ms;
  }
  const url = String(raw.url || raw.link || '');
  const m =
    url.match(/\/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/) || url.match(/\/(20\d{2})-(\d{1,2})\/(\d{1,2})\//);
  if (m) {
    const ms = new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`).getTime();
    if (!Number.isNaN(ms)) return Date.now() - ms;
  }
  return null;
}

function isStaleForGlobalPin(raw) {
  const age = inferPublishedAgeMs(raw);
  if (age == null) return false;
  if (age > 365 * 24 * 60 * 60 * 1000) return true;
  const blob = `${raw.title || ''} ${raw.summary || ''} ${raw.titleEn || ''}`;
  if (/加征|提高.*关税|tariff rate|全面制裁|sanction|禁运|embargo|贸易战|trade war/i.test(blob)) return false;
  return age > GLOBAL_STALE_MS;
}

function refreshPinPresentation(item, rawFallback = null) {
  if (!item) return item;
  const raw = rawFallback || item;
  const polished = polishNewsFields({ ...item, ...raw, titleEn: raw.titleEn || item.titleEn });
  const dim = reassessItemDimensions({ ...item, ...polished });
  return {
    ...item,
    title: polished.title,
    summary: polished.summary || item.summary,
    summaryIsEnglish: polished.summaryIsEnglish === true,
    impactDimensions: dim,
    impactScore: dim.compositeScore,
    impactSummary: formatDimensionsSummary(dim),
  };
}

function detectContentType(raw, text) {
  if (raw.contentType === 'opinion' || isOpinionTitle(text)) return 'opinion';
  if (raw.contentType) return raw.contentType;
  if (/证监会|交易所|限仓|保证金|持仓限额|交割细则|自律监管/.test(text) && /公告|通知|办法|措施/.test(text)) {
    return 'exchange-rule';
  }
  if (
    /(花旗|高盛|摩根士丹利|摩根大通|瑞银|巴克莱|国泰君安|中信期货|永安期货|华泰期货).{0,16}(认为|预计|预测|目标价|看多|看空|上调|下调)/.test(
      text
    )
  ) {
    return 'opinion';
  }
  if (/研报|分析师|机构观点|首席.{0,8}(看好|看空|预测)|机构.{0,6}上调|机构.{0,6}下调/.test(text)) {
    return 'opinion';
  }
  if (raw.departmentId && ['gov', 'mofcom', 'ndrc', 'customs', 'nea', 'mara', 'miit', 'pboc', 'csrc'].includes(raw.departmentId)) {
    return 'policy';
  }
  if (raw.sourceId && /^(gov-cn|mofcom|ndrc|miit|mara|cffex)/.test(raw.sourceId)) return 'policy';
  return 'news';
}

function classifyImpactTier(item, text) {
  const dim = assessCommodityImpact(
    text,
    {
      commodities: item.commodities,
      stars: item.stars,
      sourceName: item.sourceName || item.source,
      source: item.source,
      url: item.url || item.link,
      feedId: item.feedId,
      department: item.department,
      departmentName: item.departmentName,
    },
    SECTOR_KEYWORDS
  );
  const classified = classifyTierFromDimensions(dim, text, item);
  if (!classified) return null;
  if (classified.tier === 'global' && item && isStaleForGlobalPin(item)) return null;

  const contentType = detectContentType(item, text);
  classified.contentType = contentType;
  if (contentType === 'opinion') {
    const mag = dim.expectationReview?.expectationMagnitude ?? dim.expectationMagnitude ?? 0;
    const logic = assessOpinionLogic(text, {
      title: item.title,
      url: item.url || item.link,
    });
    classified.opinionLogic = logic;
    if (opinionSectorEligible(logic, mag) && dim.relevance?.eligibleSector) {
      if (classified.tier === 'feed') classified.tier = 'sector';
    } else if (!logic.sufficient || !opinionSectorEligible(logic, mag)) {
      classified.tier = 'feed';
    } else if (classified.tier === 'global') {
      classified.tier = 'sector';
    }
  }
  if (contentType === 'exchange-rule' && /限仓|保证金|持仓限额|涨跌停|提保/.test(text)) {
    if (classified.tier === 'feed') classified.tier = 'sector';
  }

  if (classified.tier === 'symbol' && classified.symbols?.length) {
    const sym = normalizeCommodityId(classified.symbols[0]);
    const meta = getCommodityMeta(sym);
    const profile = getInstrumentProfile(sym) || {};
    const keywords = [...new Set([...(profile.newsAliases || []), ...getNewsKeywords(meta)])];
    if (!hasDirectSymbolMention(text, meta, keywords)) return null;
    classified.primarySymbol = sym;
  }

  return classified;
}

function pinTtlMs(tier, dimensions, text = '') {
  let days = pinDaysFromDuration(dimensions?.duration || 'intraday', tier);
  const blob = String(text || '');
  const channels = dimensions?.expectationReview?.channels || dimensions?.relevance?.channels || [];
  const highWatch =
    channels.some((id) =>
      ['sectorInvolution', 'sectorCrashRebound', 'antiInvolutionWatch', 'sanctionMetals'].includes(id)
    ) || /反内卷|暴跌|深跌|历史低位|内卷/i.test(blob);
  if (tier === 'sector' && (/OFAC|制裁|sanction|实体清单/i.test(blob) || highWatch)) {
    days = Math.max(days, 10);
  }
  return days * 24 * 60 * 60 * 1000;
}

function normalizeCandidate(raw) {
  const polished = polishNewsFields(raw);
  const title = polished.title;
  const text = `${title} ${polished.summary || ''} ${raw.summaryEn || ''} ${raw.abstract || ''} ${raw.titleEn || ''}`;
  if (!title || title.length < 8) return null;
  if (isUsRegulatoryNewsItem(raw) && !/关税|制裁|tariff|sanction|commodity|大宗/.test(text)) return null;
  if (isEnforcementNoise(text)) return null;

  const classified = classifyImpactTier(raw, text);
  if (!classified) return null;
  const dim = classified.dimensions;
  if (dim?.relevance && !dim.relevance.commodityRelevant) return null;

  const sq = dim.sourceQuality || assessNewsSourceQuality(raw);
  const mag = dim.expectationReview?.expectationMagnitude ?? dim.expectationMagnitude ?? 0;
  if (!meetsTierSourceFloor(classified.tier, sq, mag)) return null;

  const rankingScore = dim.combinedQuality ?? blendRankingScore(mag, sq.score);
  const contentType = classified.contentType || detectContentType(raw, text);
  const watchPriority =
    classified.tier === 'sector' && dim.expectationReview?.watchPriority === 'high' ? 'high' : null;
  const watchReason = dim.expectationReview?.watchReason || null;
  const now = Date.now();
  return {
    newsId: makeNewsId(raw),
    title,
    titleEn: raw.titleEn || null,
    summary: polished.summary || String(raw.summary || raw.summaryEn || raw.abstract || '').slice(0, 600),
    summaryIsEnglish: polished.summaryIsEnglish === true,
    url: raw.url || raw.link || null,
    source: raw.sourceName || raw.source || '情报池',
    publishedAt: raw.pubDate || raw.publishedAt || raw.date || null,
    direction: raw.direction || 'neutral',
    stars: raw.stars || 2,
    impactTier: classified.tier,
    contentType,
    opinionLabel: contentType === 'opinion' ? '机构观点' : contentType === 'exchange-rule' ? '交易所规则' : null,
    opinionLogic: classified.opinionLogic || null,
    impactScore: rankingScore,
    rankingScore,
    sourceQuality: sq,
    impactDimensions: dim,
    impactSummary: formatDimensionsSummary(dim),
    watchPriority,
    watchReason,
    sectors: classified.sectors,
    symbols: classified.symbols,
    primarySymbol: classified.primarySymbol || null,
    pinUntil: new Date(now + pinTtlMs(classified.tier, dim, text)).toISOString(),
    firstSeenAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    professionalViews: [],
    cursorBrief: null,
    dataSource: raw.source || raw.sourceName || 'impact-scan',
    isNew: true,
  };
}

function mergePinItems(existing = [], incoming = []) {
  const map = new Map();
  const now = Date.now();
  for (const item of existing) {
    if (!item?.newsId) continue;
    if (item.pinUntil && new Date(item.pinUntil).getTime() < now) continue;
    map.set(item.newsId, { ...item, isNew: false });
  }
  const newAlerts = [];
  for (const item of incoming) {
    if (!item?.newsId) continue;
    const prev = map.get(item.newsId);
    if (!prev) {
      map.set(item.newsId, item);
      if (item.isNew) newAlerts.push(item);
      continue;
    }
    const pinUntil = new Date(Math.max(new Date(prev.pinUntil).getTime(), new Date(item.pinUntil).getTime())).toISOString();
    map.set(item.newsId, {
      ...prev,
      ...item,
      pinUntil,
      firstSeenAt: prev.firstSeenAt || item.firstSeenAt,
      lastSeenAt: new Date(now).toISOString(),
      professionalViews: prev.professionalViews?.length ? prev.professionalViews : item.professionalViews,
      cursorBrief: prev.cursorBrief || item.cursorBrief,
      isNew: false,
    });
  }
  const items = [...map.values()].sort((a, b) => {
    const tb = new Date(b.publishedAt || b.firstSeenAt).getTime();
    const ta = new Date(a.publishedAt || a.firstSeenAt).getTime();
    if (tb !== ta) return tb - ta;
    return (b.rankingScore || b.impactScore || 0) - (a.rankingScore || a.impactScore || 0);
  });
  return { items, newAlerts };
}

function readJsonNewsFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const row = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return row.items || row.headlines || row.news || row.candidates || row.alerts || [];
  } catch {
    return [];
  }
}

function readFlashInboxFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const row = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    const manual = Array.isArray(row.manualQueue) ? row.manualQueue : [];
    return [...candidates, ...manual];
  } catch {
    return [];
  }
}

function collectFastNewsFromCache() {
  try {
    const newsMod = require('./commodities-news');
    newsMod.initNewsCacheFromDisk?.();
    if (typeof newsMod.getFastNewsPoolSync === 'function') {
      return newsMod.getFastNewsPoolSync();
    }
    const diskCache = require('./disk-cache');
    const stale = diskCache.readStale('news-fast.json');
    return stale?.items || [];
  } catch {
    return [];
  }
}

function dedupeNewsPool(rows = []) {
  const seen = new Set();
  const out = [];
  for (const raw of rows) {
    if (!raw) continue;
    const title = String(raw.title || raw.headline || '').trim();
    const link = String(raw.link || raw.url || '').trim();
    const key = link || title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function collectMacroOfficialNews(sources = {}) {
  return [
    ...(sources.fed?.news || sources.fed?.items || []),
    ...(sources.treasury?.news || sources.treasury?.items || []),
    ...(sources.boj?.news || sources.boj?.items || []),
  ];
}

function collectFocusWebNewsPool() {
  const root = getExternalRoot();
  if (!root) return [];
  const dir = path.join(root, 'focus-analysis', 'web-news');
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  try {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).slice(0, 40)) {
      const row = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      rows.push(...(row.items || []));
    }
  } catch {
    // ignore
  }
  return rows;
}

function collectCandidatePool(outlookPayload = {}) {
  let sources = outlookPayload?.sources || {};
  try {
    const { getCachedAllData } = require('./data-fetcher');
    const cached = getCachedAllData();
    if (cached?.sources) sources = { ...sources, ...cached.sources };
  } catch {
    // ignore
  }

  const pools = [];

  pools.push(...collectMacroOfficialNews(sources).slice(0, 50));

  const root = getExternalRoot();
  if (root) {
    const dataDir = path.join(root, 'data');
    pools.push(
      ...readJsonNewsFile(path.join(dataDir, 'news-global.json')).slice(0, 80),
      ...readJsonNewsFile(path.join(dataDir, 'policy-radar.json')).slice(0, 40),
      ...readFlashInboxFile(path.join(dataDir, 'history', 'flash-news-inbox.json'))
        .filter((c) => c.contentType === 'opinion' || isOpinionTitle(c.title))
        .slice(0, 40),
      ...readFlashInboxFile(path.join(dataDir, 'history', 'flash-news-inbox.json')).slice(0, 80),
      ...readJsonNewsFile(path.join(dataDir, 'news-fast.json')).slice(0, 40)
    );
  }

  pools.push(...collectFastNewsFromCache().slice(0, 60));
  pools.push(...collectFocusWebNewsPool().slice(0, 40));

  pools.push(
    ...(sources.policy?.items || []).slice(0, 120),
    ...(sources.geopolitics?.items || []).slice(0, 50),
    ...(sources.climate?.items || []).slice(0, 40),
    ...(sources.fed?.items || sources.fed?.news || []).slice(0, 30),
    ...(sources.xinhua?.news || sources.xinhua?.items || []).slice(0, 40)
  );

  try {
    const diskCache = require('./disk-cache');
    const { getDataDir } = require('./data-paths');
    if (!diskCache.getRoot()) {
      const dataDir = getDataDir();
      if (dataDir) diskCache.init(dataDir);
    }
    const newsMod = require('./commodities-news');
    newsMod.initNewsCacheFromDisk?.();
    const global = newsMod.getGlobalNewsPoolSync();
    const extra = Array.isArray(global) ? global : [...(global?.items || [])];
    pools.push(...extra.slice(0, 80));
  } catch {
    // ignore
  }

  return dedupeNewsPool(pools).slice(0, POOL_LIMIT);
}

function guardedPinSave(tier, payload, symbol, previousItems, poolSize) {
  const prev = previousItems || [];
  const next = payload.items || [];
  if (next.length === 0 && prev.length > 0 && poolSize === 0) {
    console.warn(`[impact-pins] 保留 ${tier} 既有 ${prev.length} 条，跳过空池覆盖`);
    return prev;
  }
  savePinStore(tier, payload, symbol);
  return next;
}

function scanAndMergeImpactPins(outlookPayload = {}) {
  const pool = collectCandidatePool(outlookPayload).sort((a, b) => {
    const sa = assessNewsSourceQuality(a).score;
    const sb = assessNewsSourceQuality(b).score;
    return sb - sa;
  });
  const globalIncoming = [];
  const sectorIncoming = [];
  const feedIncoming = [];
  const symbolIncoming = new Map();

  for (const raw of pool) {
    const row = normalizeCandidate(raw);
    if (!row) continue;
    if (row.impactTier === 'global') globalIncoming.push(row);
    else if (row.impactTier === 'sector') sectorIncoming.push(row);
    else if (row.impactTier === 'feed') feedIncoming.push(row);
    else if (row.impactTier === 'symbol' && row.primarySymbol) {
      const sym = row.primarySymbol;
      if (!symbolIncoming.has(sym)) symbolIncoming.set(sym, []);
      symbolIncoming.get(sym).push(row);
    }
  }

  const globalStore = loadPinStore('global');
  const prunedGlobal = (globalStore.items || []).filter(isValidGlobalPin).map((item) => refreshPinPresentation(item));
  const globalMerged = mergePinItems(prunedGlobal, globalIncoming);
  const globalSaved = guardedPinSave(
    'global',
    {
      version: PIN_VERSION,
      tier: 'global',
      updatedAt: new Date().toISOString(),
      items: globalMerged.items,
    },
    null,
    prunedGlobal,
    pool.length
  );
  globalMerged.items = globalSaved;

  const sectorStore = loadPinStore('sector');
  const prunedSector = (sectorStore.items || []).filter(isValidSectorPin).map((item) => refreshPinPresentation(item));
  const sectorMerged = mergePinItems(prunedSector, sectorIncoming);
  sectorMerged.items = guardedPinSave(
    'sector',
    {
      version: PIN_VERSION,
      tier: 'sector',
      updatedAt: new Date().toISOString(),
      items: sectorMerged.items,
    },
    null,
    prunedSector,
    pool.length
  );

  const feedStore = loadPinStore('feed');
  const prunedFeed = (feedStore.items || []).filter(isValidFeedPin).map((item) => refreshPinPresentation(item));
  const feedMerged = mergePinItems(prunedFeed, feedIncoming);
  feedMerged.items = guardedPinSave(
    'feed',
    {
      version: PIN_VERSION,
      tier: 'feed',
      updatedAt: new Date().toISOString(),
      items: feedMerged.items.slice(0, 12),
    },
    null,
    prunedFeed,
    pool.length
  ).slice(0, 12);

  const symbolAlerts = [];
  for (const [sym, rows] of symbolIncoming) {
    const store = loadPinStore('symbol', sym);
    const pruned = (store.items || []).filter(isValidSymbolPin).map((item) => refreshPinPresentation(item));
    const merged = mergePinItems(pruned, rows.map((row) => refreshPinPresentation(row)));
    savePinStore('symbol', {
      version: PIN_VERSION,
      tier: 'symbol',
      symbol: sym,
      updatedAt: new Date().toISOString(),
      items: merged.items,
    }, sym);
    symbolAlerts.push(...merged.newAlerts);
  }

  const allNew = [...globalMerged.newAlerts, ...sectorMerged.newAlerts, ...symbolAlerts];
  return {
    version: PIN_VERSION,
    scannedAt: new Date().toISOString(),
    poolSize: pool.length,
    globalCount: globalMerged.items.length,
    sectorCount: sectorMerged.items.length,
    feedCount: feedMerged.items.length,
    newAlerts: allNew,
  };
}

function getPinnedGlobal() {
  pruneImpactPinsOnce();
  return (loadPinStore('global').items || []).filter(isValidGlobalPin);
}

function getPinnedSector() {
  pruneImpactPinsOnce();
  return (loadPinStore('sector').items || []).filter(isValidSectorPin);
}

function getPinnedFeed() {
  pruneImpactPinsOnce();
  return (loadPinStore('feed').items || []).filter(isValidFeedPin);
}

let impactPinsPruned = false;

function pruneImpactPinsOnce() {
  if (impactPinsPruned) return;
  impactPinsPruned = true;
  for (const [tier, validate] of [
    ['global', isValidGlobalPin],
    ['sector', isValidSectorPin],
    ['feed', isValidFeedPin],
  ]) {
    const store = loadPinStore(tier);
    const prev = store.items || [];
    const next = prev.filter(validate).map((item) => refreshPinPresentation(item));
    if (next.length !== prev.length) {
      savePinStore(tier, { ...store, items: next, updatedAt: new Date().toISOString() });
      console.log(`[impact-pins] pruned ${tier}: ${prev.length} → ${next.length}`);
    }
  }
}

function getPinnedForSymbol(symbol) {
  const sym = normalizeCommodityId(symbol);
  return loadPinStore('symbol', sym).items || [];
}

function sectorLabel(id) {
  return SECTOR_LABELS[id] || id;
}

module.exports = {
  PIN_VERSION,
  IMPACT_GRADE,
  TTL_MS,
  SECTOR_LABELS,
  scanAndMergeImpactPins,
  collectCandidatePool,
  getPinnedGlobal,
  getPinnedSector,
  getPinnedFeed,
  getPinnedForSymbol,
  pruneImpactPinsOnce,
  sectorLabel,
  loadPinStore,
  savePinStore,
  refreshPinPresentation,
  isValidGlobalPin,
  isValidSectorPin,
  isValidFeedPin,
  isValidSymbolPin,
  isRoutineMarketWrap,
  isGlobalSystemic,
  reassessItemDimensions,
};
