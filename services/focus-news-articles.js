/**
 * 关注品种 · 新闻文章索引与全文（应用内阅读，不外跳浏览器）
 * 优先品种相关、可影响价格/情绪的要闻；禁止用「关联XX」占位当正文
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getExternalRoot } = require('./data-paths');
const { getCommodityMeta } = require('./commodities-catalog');
const { getInstrumentProfile } = require('./commodity-instrument-profiles');
const { normalizeCommodityId } = require('./policy-commodity-map');
const { getFocusMeta } = require('./user-focus-symbols');
const { getNewsKeywords, scoreNewsItem, hasDirectSymbolMention } = require('./commodities-news');
const { loadCachedWebNews, extractAnysearchUrl } = require('./focus-anysearch-news');
const { todaySessionDate } = require('./focus-read-state');

const ARTICLE_VERSION = 'v1.51.2-readable-body';
const BODY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BODY_CHARS = 180;
const MIN_RELEVANCE_DIRECT = 0.28;
const MIN_RELEVANCE_TAG = 0.42;
const MIN_RELEVANCE_OTHER = 0.5;

const BODY_SOURCE_ZH = {
  cache: '缓存',
  'anysearch-extract': '全网提取',
  'http-fetch': '网页抓取',
  'composed-en-summary': '摘要汇编',
  'title-only': '仅标题',
  preview: '预览',
  missing: '缺失',
  'zh-translated': '中文化',
};

const DIRECTION_ZH = { bullish: '偏多', bearish: '偏空', neutral: '中性' };

const NEWS_SOURCE_TIER = {
  policy: 0.85,
  geo: 1.05,
  climate: 0.95,
  commodity: 1.35,
  macro: 0.6,
  default: 0.9,
};

function parseNewsTime(article) {
  const t = article?.publishedAt || article?.at || article?.pubDate || article?.fetchedAt;
  if (!t) return 0;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function bodySourceLabel(src) {
  return BODY_SOURCE_ZH[src] || src || '未知';
}

function isBlockedScrapeBody(text) {
  const t = String(text || '');
  if (t.length < 80) return false;
  if (/Request Access|Due to aggressive automated scraping|programmatic access to these sites is limited/i.test(t)) {
    return true;
  }
  if (/FederalRegister\.gov\/developer|CAPTCHA|human user/i.test(t) && /scraping|automated/i.test(t)) {
    return true;
  }
  if (/\{"imports":\s*\{/.test(t) && /node_modules|webpack/.test(t)) return true;
  return false;
}

function isMostlyEnglishText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (t.match(/[a-zA-Z]/g) || []).length;
  return latin > 40 && cjk < Math.max(12, latin * 0.15);
}

async function translateBodyToZh(text, options = {}) {
  const { translateEnToZh } = require('./policy-us-translator');
  const { isAcceptableChinese } = require('./policy-en-zh-dict');
  const src = String(text || '').trim();
  if (!src) return '';
  if (isAcceptableChinese(src) && !isMostlyEnglishText(src)) return src;
  if (isGarbageTranslatedBody(src)) return '';

  const ctx = { ...(options.context || {}), mode: 'body' };
  const maxLen = options.maxLen || 8000;
  const truncated = src.slice(0, maxLen);

  // 按段落翻译，避免 320 字切块时每块都退化成「美国机构：政策公告」
  const paragraphs = truncated
    .split(/\n{2,}|(?:\.\s+(?=[A-Z]))|(?:。\s*)/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 24);
  const chunks = paragraphs.length ? paragraphs : [truncated];

  const out = [];
  for (const chunk of chunks.slice(0, 24)) {
    let zh = await translateEnToZh(chunk, ctx, { force: options.force === true });
    if (!zh || !isAcceptableChinese(zh) || isGarbageTranslatedBody(zh) || zh === chunk) {
      const local = require('./policy-en-zh-dict').translateRegulatoryTitleLocal(chunk);
      zh = isAcceptableChinese(local) && !isGarbageTranslatedBody(local) ? local : '';
    }
    if (zh && !isGarbageTranslatedBody(zh)) out.push(zh);
  }

  const joined = out.join('\n\n').trim();
  if (joined.length >= 60 && !isGarbageTranslatedBody(joined)) return joined;
  return '';
}

function toChineseTitle(item) {
  const { translateRegulatoryTitleLocal, isAcceptableChinese } = require('./policy-en-zh-dict');
  const raw = String(item.displayTitle || item.title || item.titleEn || '').trim();
  if (!raw) return '无标题';
  if (isAcceptableChinese(raw) && !/\b(Proposed Rule|Final Rule|Notice|CFTC|SEC|OFAC)\b/i.test(raw)) {
    return raw;
  }
  const docLabel = item.documentTypeLabel || '';
  const local = translateRegulatoryTitleLocal(item.titleEn || raw);
  if (isAcceptableChinese(local)) {
    return docLabel && !local.startsWith('[') ? `[${docLabel}] ${local}` : local;
  }
  if (docLabel) return `[${docLabel}] ${raw}`;
  return raw;
}

function toChineseSummary(item) {
  const { translateRegulatoryTitleLocal, isAcceptableChinese } = require('./policy-en-zh-dict');
  const zh = String(item.summary || item.snippet || item.intro || '').trim();
  if (zh && !isSyntheticSummary(zh) && isAcceptableChinese(zh)) return zh;
  const en = String(item.summaryEn || item.abstract || item.titleEn || '').trim();
  if (!en) return '';
  if (en.length > 20) {
    const local = translateRegulatoryTitleLocal(en);
    if (isAcceptableChinese(local) && !isSyntheticSummary(local) && local.length > 12) return local;
  }
  const local = translateRegulatoryTitleLocal(en);
  return isAcceptableChinese(local) && !isSyntheticSummary(local) ? local : '';
}

function isLowRelevanceUsRegulatory(raw, directMention, matchScore) {
  const title = `${raw.title || ''} ${raw.titleEn || ''}`.toLowerCase();
  const isUsReg =
    raw.region === 'us' ||
    /federal register|cftc|sec |ofac|treasury|proposed rule|final rule/i.test(
      `${title} ${raw.source || ''} ${raw.sourceName || ''}`
    );
  if (!isUsReg) return false;
  if (directMention && matchScore >= 5) return false;
  if ((raw.stars || 0) >= 4 && matchScore >= 7) return false;
  if (isGenericPolicyTitle(raw.title) || isGenericPolicyTitle(raw.titleEn)) return true;
  if (!directMention && matchScore < 8) return true;
  return false;
}

function isUsRegulatoryArticle(article) {
  const blob = `${article?.source || ''} ${article?.url || ''} ${article?.titleEn || ''} ${article?.bucket || ''}`;
  return /联邦公报|federalregister|federal register|cftc|sec |ofac|treasury/i.test(blob) || article?.bucket === 'policy';
}

function qualifiesForDisplay(article) {
  if (!article?.title) return false;
  if (article.bucket === 'commodity' && (article.dataSource === 'anysearch' || article.dataSource === '全网检索')) {
    return article.matchScore >= 5;
  }
  if (isUsRegulatoryArticle(article)) {
    return article.directMention && article.matchScore >= 10;
  }
  if (article.directMention && article.matchScore >= 8) return true;
  if (article.tier === '重点' && article.bucket === 'commodity') return true;
  return false;
}

function articlesRoot() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'focus-analysis', 'news-articles');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function articleBodyPath(newsId) {
  const dir = articlesRoot();
  if (!dir) return null;
  return path.join(dir, 'bodies', `${newsId}.json`);
}

function articleIndexPath(symbol) {
  const dir = articlesRoot();
  if (!dir) return null;
  return path.join(dir, `${normalizeCommodityId(symbol)}-index.json`);
}

function makeNewsId(item) {
  const key = `${item.url || item.link || ''}|${item.title || item.titleEn || ''}|${item.source || ''}`;
  return crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGarbageTranslatedBody(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const unique = new Set(lines);
    if (unique.size === 1 && lines[0].length < 48) return true;
    const generic = lines.filter((l) => /^美国机构：政策公告$/.test(l) || /^美联储：政策公告$/.test(l)).length;
    if (generic >= 3 && generic / lines.length >= 0.6) return true;
  }
  if (/^(美国机构：政策公告\n?)+$/.test(t)) return true;
  return false;
}

function extractHtmlMainText(html, url = '') {
  const raw = String(html || '');
  if (!raw) return '';
  if (/federalreserve\.gov/i.test(url)) {
    const m =
      raw.match(/<div[^>]*id="article"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      raw.match(/<div[^>]*class="[^"]*press-release[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (m?.[1]) {
      const text = stripHtml(m[1]);
      if (text.length >= 80) return text;
    }
  }
  return stripHtml(raw);
}

function isSyntheticSummary(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^(美联储|美国机构|财政部|SEC|CFTC|OFAC|USTR)[：:]\s*[\u4e00-\u9fff]{2,12}$/.test(t)) return true;
  if (/^(美联储|美国机构).{0,8}(政策公告|公告)$/.test(t)) return true;
  if (/^.+：.{0,24}（关联[^）]{4,}）\s*$/.test(t)) return true;
  if (t.length < 90 && /（关联[^）]+）/.test(t) && !/[。；！?]/.test(t)) return true;
  if (/^关联：/.test(t) && t.length < 100) return true;
  return false;
}

function isSyntheticTitle(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (isSyntheticSummary(t)) return true;
  if (/^美联储：政策公告/.test(t) && t.length < 28) return true;
  return false;
}

function isGenericPolicyTitle(title) {
  const t = String(title || '').trim();
  return /^(拟议规则|最终规则|公告|proposed rule|final rule|notice|enforcement action)$/i.test(t);
}

function tierFromRelevance(relevance, tagHit, directMention, matchScore) {
  if ((tagHit && directMention) || matchScore >= 12 || relevance >= 0.85) return '重点';
  if (directMention || matchScore >= 7 || relevance >= 0.55) return '相关';
  return '宏观';
}

function buildImpactNote(raw, meta, sym) {
  const parts = [];
  const dir = raw.direction || raw.directionLabel;
  if (dir && dir !== 'neutral') parts.push(`情绪方向：${DIRECTION_ZH[dir] || dir}`);
  if (raw.stars >= 4) parts.push('政策星级高 · 关注定价/供需');
  else if (raw.stars >= 3) parts.push('产业链边际变化');
  if (raw.impactSummary && !isSyntheticSummary(raw.impactSummary)) {
    parts.push(raw.impactSummary.slice(0, 120));
  }
  if (raw.timingLabel) parts.push(`时效：${raw.timingLabel}`);
  const name = meta?.name || sym;
  if (name) parts.push(`审视要点：该消息对 ${name} 供需/成本/贸易渠道是否有传导`);
  return parts.join(' · ');
}

function resolveIntelSources(outlookPayload = {}) {
  try {
    const { getCachedAllData } = require('./data-fetcher');
    const cached = getCachedAllData();
    if (cached?.sources) return cached.sources;
  } catch {
    // ignore
  }
  return outlookPayload?.sources || {};
}

function collectOutlookNewsPools() {
  try {
    const newsMod = require('./commodities-news');
    newsMod.initNewsCacheFromDisk?.();
    const global = newsMod.getGlobalNewsPoolSync();
    return Array.isArray(global) ? global : [...(global?.items || [])];
  } catch {
    return [];
  }
}

function classifyNewsBucket(item, sources) {
  if (item._newsBucket) return item._newsBucket;
  const src = String(item.source || item.sourceName || '').toLowerCase();
  const text = `${item.title || ''} ${item.summary || ''}`;
  if (item.category === 'policy' || /policy|gov|fed|treasury|ofac|制裁|政策/.test(src + text)) return 'policy';
  if (/geo|地缘|war|冲突/.test(src + text)) return 'geo';
  if (/climate|天气|干旱|洪水/.test(src + text)) return 'climate';
  if (/期货|大宗|commodity|futures|新浪|东财|生意社/.test(src + text)) return 'commodity';
  return 'macro';
}

function getNewsKeywordsForMeta(meta, profile) {
  return [...new Set([...getNewsKeywords(meta), ...(profile?.newsAliases || [])])];
}

function normalizePoolItem(item, bucket, meta) {
  const url = item.url || item.link || null;
  const titleEn = item.titleEn || (item.region === 'us' ? item.title : '') || '';
  const summaryEn = item.summaryEn || item.abstract || item.snippet || '';
  const summaryZh = toChineseSummary({ ...item, summaryEn });
  const displayTitle = toChineseTitle({ ...item, titleEn, summaryEn });
  return {
    newsId: makeNewsId({ url, title: displayTitle, source: item.source || item.sourceName }),
    title: displayTitle,
    titleEn: titleEn || null,
    url,
    summary: summaryZh ? summaryZh.slice(0, 800) : '',
    summaryEn: summaryEn ? String(summaryEn).slice(0, 1200) : null,
    abstract: item.abstract ? String(item.abstract).slice(0, 800) : null,
    source: item.sourceName || item.source || '情报池',
    publishedAt: item.pubDate || item.publishedAt || item.date || item.lastSeenAt || null,
    stars: item.stars || 2,
    direction: item.direction || 'neutral',
    bucket: bucket || classifyNewsBucket(item),
    dataSource: item.source || item.sourceName || 'news-pool',
    impactSummary: item.impactSummary || null,
    impactNote: buildImpactNote(item, meta),
    documentType: item.documentTypeLabel || item.documentType || null,
  };
}

async function fetchUrlPlainText(url) {
  if (!url) return { ok: false, text: null, error: 'no-url' };
  if (/federalregister\.gov/i.test(url)) {
    return { ok: false, text: null, error: 'federalregister-blocked' };
  }
  try {
    const { fetchText } = require('./http-client');
    const html = await fetchText(url, { timeout: 20000, retries: 1 });
    const text = extractHtmlMainText(html, url);
    if (isBlockedScrapeBody(text)) return { ok: false, text, error: 'blocked-scrape' };
    if (text.length < MIN_BODY_CHARS) return { ok: false, text, error: 'too-short' };
    return { ok: true, text: text.slice(0, 14000), dataSource: 'http-fetch' };
  } catch (err) {
    return { ok: false, text: null, error: err.message || String(err) };
  }
}

function collectRankedNewsArticles(inst, options = {}) {
  invalidateStaleNewsCaches();
  const sym = normalizeCommodityId(inst?.id);
  const meta = getCommodityMeta(sym) || { id: sym, name: inst?.name || getFocusMeta(sym).name };
  const profile = getInstrumentProfile(sym) || {};
  const keywords = getNewsKeywordsForMeta(meta, profile);
  const sources = resolveIntelSources(options.outlookPayload || {});
  const newsPools = collectOutlookNewsPools();
  const webNews = options.webNews || loadCachedWebNews(sym, { allowStale: true });

  const intelPools = [
    ...(sources.policy?.items || []).map((i) => ({ ...i, _newsBucket: 'policy' })),
    ...(sources.geopolitics?.items || []).map((i) => ({ ...i, _newsBucket: 'geo' })),
    ...(sources.climate?.items || []).map((i) => ({ ...i, _newsBucket: 'climate' })),
    ...(sources.xinhua?.news || sources.xinhua?.items || []).map((i) => ({ ...i, _newsBucket: 'macro' })),
    ...(newsPools || []).map((i) => ({ ...i, _newsBucket: classifyNewsBucket(i, sources) })),
  ];

  const scored = [];
  const seen = new Set();

  for (const item of webNews?.items || []) {
    if (!item?.title) continue;
    const titleText = `${item.title} ${item.snippet || ''}`;
    const directMention = hasDirectSymbolMention(titleText, meta, keywords);
    const matchScore = scoreNewsItem(item, keywords, meta);
    if (!directMention && matchScore < 5) continue;
    const normalized = normalizePoolItem(
      {
        title: item.title,
        url: item.url,
        summary: item.snippet,
        snippet: item.snippet,
        source: item.source || '全网检索',
        pubDate: item.publishedAt || item.lastSeenAt,
        stars: directMention ? 4 : 3,
      },
      'commodity',
      meta
    );
    if (seen.has(normalized.newsId)) continue;
    seen.add(normalized.newsId);
    scored.push({
      ...normalized,
      relevance: directMention ? 0.92 : 0.78,
      matchScore: matchScore + (directMention ? 10 : 6),
      tier: directMention ? '重点' : '相关',
      rankScore: directMention ? 1.25 : 0.95,
      tagHit: true,
      directMention,
      hasSubstance: Boolean(item.snippet?.length > 30 || item.url),
      bodyStatus: item.url ? 'url-pending' : item.snippet ? 'summary' : 'title-only',
      dataSource: 'anysearch',
    });
  }

  for (const raw of intelPools.slice(0, 200)) {
    const text = `${raw.title || ''} ${raw.titleEn || ''} ${raw.summary || ''} ${raw.summaryEn || ''} ${raw.abstract || ''}`;
    const tagHit = raw.commodities?.some((c) => normalizeCommodityId(c.id) === sym);
    const directMention = hasDirectSymbolMention(text, meta, keywords);
    const matchScore = scoreNewsItem(
      { title: raw.title || raw.titleEn, summary: raw.summary || raw.summaryEn || raw.abstract },
      keywords,
      meta
    );

    if (isLowRelevanceUsRegulatory(raw, directMention, matchScore)) continue;

    let relevance = 0;
    if (directMention) relevance = Math.min(0.5 + matchScore / 20, 1);
    else if (tagHit) relevance = Math.min(0.32 + matchScore / 26, 0.7);
    else relevance = matchScore / 24;

    const minRel = directMention ? MIN_RELEVANCE_DIRECT : tagHit ? MIN_RELEVANCE_TAG : MIN_RELEVANCE_OTHER;
    if (relevance < minRel) continue;

    const genericOnly =
      (isGenericPolicyTitle(raw.title) || isGenericPolicyTitle(raw.titleEn)) &&
      !directMention &&
      matchScore < 8;
    if (genericOnly) continue;

    if (raw._newsBucket === 'policy' && !directMention && matchScore < 7) continue;
    if (raw._newsBucket === 'macro' && !directMention && !tagHit) continue;

    const normalized = normalizePoolItem(raw, raw._newsBucket, meta);
    if (seen.has(normalized.newsId)) continue;
    seen.add(normalized.newsId);

    const bucket = normalized.bucket;
    const tierWeight = NEWS_SOURCE_TIER[bucket] || NEWS_SOURCE_TIER.default;
    const rankScore =
      relevance * tierWeight * ((normalized.stars || 2) / 5) * (directMention ? 1.35 : tagHit ? 0.75 : 0.5);

    const hasSubstance =
      (normalized.summary && normalized.summary.length >= 30 && !isSyntheticSummary(normalized.summary)) ||
      Boolean(normalized.url);

    scored.push({
      ...normalized,
      relevance: +relevance.toFixed(2),
      matchScore,
      tier: tierFromRelevance(relevance, tagHit, directMention, matchScore),
      rankScore: +rankScore.toFixed(4),
      tagHit: Boolean(tagHit),
      directMention,
      hasSubstance,
      bodyStatus: hasSubstance ? (normalized.url ? 'url-pending' : 'summary') : 'title-only',
    });
  }

  scored.sort((a, b) => {
    const tb = parseNewsTime(b);
    const ta = parseNewsTime(a);
    if (tb !== ta) return tb - ta;
    if (a.directMention !== b.directMention) return a.directMention ? -1 : 1;
    return b.rankScore - a.rankScore;
  });

  const articles = scored.filter(qualifiesForDisplay).slice(0, options.limit || 12);
  saveArticleIndex(sym, articles);
  return { symbol: sym, articles, version: ARTICLE_VERSION, asOf: new Date().toISOString() };
}

function saveArticleIndex(symbol, articles) {
  const fp = articleIndexPath(symbol);
  if (!fp) return null;
  const payload = {
    version: ARTICLE_VERSION,
    symbol: normalizeCommodityId(symbol),
    sessionDate: todaySessionDate(),
    updatedAt: new Date().toISOString(),
    articles,
  };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function invalidateStaleNewsCaches() {
  const dir = articlesRoot();
  if (!dir || !fs.existsSync(dir)) return { cleared: 0 };
  let cleared = 0;
  const bodiesDir = path.join(dir, 'bodies');
  if (fs.existsSync(bodiesDir)) {
    for (const file of fs.readdirSync(bodiesDir).filter((f) => f.endsWith('.json'))) {
      try {
        const row = JSON.parse(fs.readFileSync(path.join(bodiesDir, file), 'utf8'));
        if (isGarbageTranslatedBody(row.body)) {
          fs.unlinkSync(path.join(bodiesDir, file));
          cleared += 1;
        }
      } catch {
        // ignore
      }
    }
  }
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('-index.json')) continue;
    const fp = path.join(dir, file);
    try {
      const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (row.version !== ARTICLE_VERSION) {
        fs.unlinkSync(fp);
        cleared += 1;
      }
    } catch {
      try {
        fs.unlinkSync(fp);
        cleared += 1;
      } catch {
        // ignore
      }
    }
  }
  return { cleared, version: ARTICLE_VERSION };
}

function loadArticleIndex(symbol) {
  const fp = articleIndexPath(symbol);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function loadCachedArticleBody(newsId) {
  const fp = articleBodyPath(newsId);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (isGarbageTranslatedBody(row.body)) {
      fs.unlinkSync(fp);
      return null;
    }
    if (
      row.bodySource === 'composed-en-summary' &&
      row.body &&
      !/【事件】|【Cursor 解读】/.test(row.body) &&
      /【原文标题】/.test(row.body)
    ) {
      fs.unlinkSync(fp);
      return null;
    }
    const age = Date.now() - new Date(row.fetchedAt || 0).getTime();
    if (Number.isNaN(age) || age > BODY_CACHE_TTL_MS) return { ...row, stale: true };
    return row;
  } catch {
    return null;
  }
}

function saveArticleBody(newsId, payload) {
  const fp = articleBodyPath(newsId);
  if (!fp) return null;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function findArticleInIndex(symbol, newsId) {
  const index = loadArticleIndex(symbol);
  return index?.articles?.find((a) => a.newsId === newsId) || null;
}

function findArticleByNewsId(newsId) {
  const id = String(newsId || '').trim();
  if (!id) return null;
  try {
    const { getPinnedGlobal, getPinnedSector } = require('./focus-impact-pins');
    const { listUserFocusSymbols } = require('./user-focus-symbols');
    const pin = [...getPinnedGlobal(), ...getPinnedSector()].find((p) => p.newsId === id);
    if (pin) {
      return {
        ...pin,
        tier: '重点',
        directMention: Boolean(pin.primarySymbol || pin.symbols?.length),
        bucket: pin.impactTier,
        impactNote: pin.impactNote || (pin.impactScore != null ? `影响强度 ${pin.impactScore}/100` : null),
        departmentShort: /federal reserve|美联储/i.test(`${pin.source} ${pin.url}`) ? '美联储' : undefined,
      };
    }
    for (const sym of listUserFocusSymbols()) {
      const hit = findArticleInIndex(sym, id);
      if (hit) return hit;
    }
  } catch {
    // ignore
  }
  return null;
}

function buildCommodityContextLine(article) {
  const { getCommodityMeta } = require('./commodities-catalog');
  const names = (article.symbols || [])
    .slice(0, 8)
    .map((id) => getCommodityMeta(id)?.name || id)
    .filter(Boolean);
  if (!names.length) return null;
  return `关联品种：${names.join('、')}`;
}

async function resolveArticleSummaryZh(article) {
  const summary = toChineseSummary(article);
  if (summary && !isSyntheticSummary(summary)) return summary;
  const titleEn = String(article.titleEn || '').trim();
  if (titleEn.length < 16) return '';
  const { translateEnToZh, translateViaMyMemory } = require('./policy-us-translator');
  const { isAcceptableChinese } = require('./policy-en-zh-dict');
  const { translateNewsOffline } = require('./offline-translate');
  const ctx = { departmentShort: article.departmentShort, mode: 'body' };

  if (/federalreserve\.gov|美联储/i.test(`${article.url || ''} ${article.source || ''}`)) {
    const fedZh = translateNewsOffline(titleEn);
    if (hasSubstantiveChinese(fedZh) && fedZh.length > 16 && !isSyntheticSummary(fedZh)) return fedZh;
  }

  let zh = await translateViaMyMemory(titleEn.slice(0, 380));
  if (!hasSubstantiveChinese(zh) || isSyntheticSummary(zh)) {
    zh = await translateEnToZh(titleEn, ctx, { force: false });
  }
  if (!hasSubstantiveChinese(zh) || isSyntheticSummary(zh)) {
    zh = translateNewsOffline(titleEn);
  }
  if (hasSubstantiveChinese(zh) && zh.length > 16 && !isSyntheticSummary(zh)) return zh;
  return titleEn;
}

function latinRatio(text) {
  const t = String(text || '');
  const latin = (t.match(/[a-zA-Z]/g) || []).length;
  return latin / Math.max(1, t.length);
}

function hasSubstantiveChinese(text) {
  const cjk = (String(text || '').match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk >= 10;
}

async function maybeCursorNewsBrief(article) {
  try {
    const { analyzeWithCursor, isCursorConfigured, NEWS_ARTICLE_BRIEF_PROMPT } = require('./cursor-llm-client');
    if (!isCursorConfigured()) return null;
    const { getCommodityMeta } = require('./commodities-catalog');
    const context = {
      headline: {
        title: article.title,
        titleEn: article.titleEn,
        summary: article.summary,
        url: article.url,
        source: article.source,
        publishedAt: article.publishedAt,
        symbols: (article.symbols || []).map((id) => ({
          id,
          name: getCommodityMeta(id)?.name || id,
        })),
        impactScore: article.impactScore,
        impactTier: article.impactTier || article.bucket,
      },
      constraints: ['仅根据 headline 已有字段', '禁止编造价格/政策细节', '执法个案须注明与宏观定价关联有限'],
    };
    const raw = await analyzeWithCursor(NEWS_ARTICLE_BRIEF_PROMPT, context);
    const text = String(raw?.text || '').trim();
    if (!text || text.length < 40) return null;
    return text.slice(0, 1200);
  } catch {
    return null;
  }
}

async function buildReadableArticleBody(article, options = {}) {
  const blocks = [];
  const eventText = await resolveArticleSummaryZh(article);
  if (eventText) {
    const label = hasSubstantiveChinese(eventText) ? '【事件】' : '【事件（译文/原文）】';
    blocks.push(`${label}${eventText}`);
  }

  const commodityCtx = buildCommodityContextLine(article);
  if (commodityCtx) blocks.push(`【品种关联】${commodityCtx}`);

  if (article.impactNote && !/^影响强度\s*\d+\/100$/.test(String(article.impactNote).trim())) {
    blocks.push(`【影响审视】${article.impactNote}`);
  } else if (article.impactScore != null) {
    blocks.push(
      `【影响审视】系统评估影响强度 ${article.impactScore}/100（基于标题/来源/品种标签，非价格预测）`
    );
  }

  if (options.includeCursor !== false) {
    const cursorBrief = await maybeCursorNewsBrief(article);
    if (cursorBrief) blocks.push(`【Cursor 解读】\n${cursorBrief}`);
  }

  const titleEn = String(article.titleEn || '').trim();
  if (titleEn && eventText && eventText !== titleEn && !eventText.includes(titleEn.slice(0, 24))) {
    blocks.push(`【原文标题】${titleEn}`);
  } else if (titleEn && !eventText) {
    blocks.push(`【原文标题】${titleEn}`);
  }

  if (!blocks.length) {
    blocks.push('【说明】原文站点限制抓取；暂无可用全文，请结合来源链接交叉验证，勿单凭标题交易。');
  }
  return blocks.join('\n\n');
}

async function finalizeBodyZh(rawBody, article) {
  let body = String(rawBody || '').trim();
  if (!body) return { body: null, bodySource: 'missing' };
  if (isGarbageTranslatedBody(body)) {
    body = await buildReadableArticleBody(article);
    return { body: body || null, bodySource: 'composed-en-summary', blocked: true };
  }
  if (isBlockedScrapeBody(body)) {
    body = await buildReadableArticleBody(article);
    return { body: body || null, bodySource: 'composed-en-summary', blocked: true };
  }
  if (isMostlyEnglishText(body)) {
    const ctx = {
      departmentShort: article.departmentShort,
      departmentName: article.departmentName,
      documentTypeLabel: article.documentType,
      commodities: (article.symbols || []).map((id) => ({ id, name: id })),
    };
    const zh = await translateBodyToZh(body, { context: ctx });
    if (zh && zh.length >= 40 && !isGarbageTranslatedBody(zh)) {
      return { body: zh, bodySource: 'zh-translated' };
    }
    const fallback = await buildReadableArticleBody(article);
    if (fallback.length >= 40) {
      return { body: fallback, bodySource: 'composed-en-summary', blocked: true };
    }
  }
  return { body, bodySource: null };
}

async function fetchArticleFullBody(article, options = {}) {
  if (!article) return { body: null, bodySource: 'missing', error: 'article-not-found', bodyIncomplete: true };

  if (!options.force) {
    const cached = loadCachedArticleBody(article.newsId);
    if (
      cached &&
      !cached.stale &&
      cached.body &&
      cached.body.length >= MIN_BODY_CHARS &&
      !isBlockedScrapeBody(cached.body)
    ) {
      return {
        body: cached.body,
        bodySource: cached.bodySource || 'cache',
        bodyFetchedAt: cached.fetchedAt,
        ok: true,
        bodyIncomplete: Boolean(cached.bodyIncomplete),
      };
    }
  }

  let rawBody = null;
  let bodySource = 'missing';
  let extractError = null;

  if (article.url) {
    const extracted = await extractAnysearchUrl(article.url);
    const extractedText = extracted.ok && extracted.content ? stripHtml(extracted.content) : '';
    if (extractedText.length >= MIN_BODY_CHARS && !isBlockedScrapeBody(extractedText)) {
      rawBody = extractedText.slice(0, 14000);
      bodySource = 'anysearch-extract';
    } else if (!/federalregister\.gov/i.test(article.url)) {
      const direct = await fetchUrlPlainText(article.url);
      if (direct.ok && direct.text && !isBlockedScrapeBody(direct.text)) {
        rawBody = direct.text;
        bodySource = direct.dataSource;
      } else if (direct.error) {
        extractError = direct.error === 'blocked-scrape' ? '目标站点限制自动抓取' : direct.error;
      }
    } else {
      extractError = '联邦公报需通过全网提取，当前未能获取正文';
    }
  }

  if (!rawBody) {
    const composed = await buildReadableArticleBody(article);
    if (composed.length >= 60) {
      rawBody = composed;
      bodySource = 'composed-en-summary';
    }
  }

  const finalized = await finalizeBodyZh(rawBody, article);
  const body = finalized.body;
  if (finalized.bodySource) bodySource = finalized.bodySource;

  if (body && body.length >= 60 && !isGarbageTranslatedBody(body)) {
    const payload = {
      newsId: article.newsId,
      body,
      bodySource,
      fetchedAt: new Date().toISOString(),
      url: article.url || null,
      bodyIncomplete: bodySource === 'composed-en-summary' || bodySource === 'title-only' || bodySource === 'zh-translated',
    };
    saveArticleBody(article.newsId, payload);
    return {
      body,
      bodySource,
      fetchedAt: payload.fetchedAt,
      ok: true,
      bodyIncomplete: payload.bodyIncomplete,
      extractError,
    };
  }

  const minimal = article.summary || article.title || null;
  return {
    body: minimal,
    bodySource: 'title-only',
    fetchedAt: new Date().toISOString(),
    ok: Boolean(minimal),
    bodyIncomplete: true,
    extractError: extractError || '正文未能完整拉取，请稍后重试',
  };
}

async function getFocusNewsArticle(symbol, newsId, options = {}) {
  const sym = normalizeCommodityId(symbol);
  let article = sym && sym !== 'global' ? findArticleInIndex(sym, newsId) : null;
  if (!article) article = findArticleByNewsId(newsId);
  if (!article && options.inst) {
    const pack = collectRankedNewsArticles(options.inst, { ...options, outlookPayload: options.outlookPayload });
    article = pack.articles.find((a) => a.newsId === newsId) || null;
  }
  if (!article && options.outlookPayload?.instruments) {
    const inst = options.outlookPayload.instruments.find((i) => normalizeCommodityId(i.id) === sym);
    if (inst) {
      const pack = collectRankedNewsArticles(inst, { outlookPayload: options.outlookPayload });
      article = pack.articles.find((a) => a.newsId === newsId) || null;
    }
  }
  if (!article) {
    try {
      const { getPinnedGlobal, getPinnedSector, getPinnedForSymbol } = require('./focus-impact-pins');
      const pin = [...getPinnedGlobal(), ...getPinnedSector(), ...getPinnedForSymbol(sym)].find(
        (p) => p.newsId === newsId
      );
      if (pin) {
        article = {
          ...pin,
          tier: '重点',
          directMention: true,
          bucket: pin.impactTier,
          impactNote: pin.impactNote || `影响强度 ${pin.impactScore}/100`,
        };
      }
    } catch {
      // ignore
    }
  }
  if (!article) {
    return { error: '新闻未找到或已过期，请刷新情报', newsId, symbol: sym };
  }

  const full = options.previewOnly
    ? {
        body: article.summary || null,
        bodySource: 'preview',
        ok: Boolean(article.summary || article.title),
        bodyIncomplete: true,
      }
    : await fetchArticleFullBody(article, options);

  const displayTitle = toChineseTitle(article);
  const displaySummary = (await resolveArticleSummaryZh(article)) || '';

  return {
    version: ARTICLE_VERSION,
    symbol: sym,
    article: {
      ...article,
      title: displayTitle,
      summary: displaySummary,
      body: full.body,
      bodySource: full.bodySource,
      bodySourceLabel: bodySourceLabel(full.bodySource),
      bodyFetchedAt: full.fetchedAt || null,
      bodyIncomplete: full.bodyIncomplete !== false,
      extractError: full.extractError || full.error || null,
    },
    dataSource: 'focus-news-articles',
  };
}

function buildPolicyNewsItems(inst, options = {}) {
  const pack = collectRankedNewsArticles(inst, { ...options, limit: 10 });
  const items = [];
  const displayArticles = pack.articles.filter(qualifiesForDisplay).slice(0, 6);

  if (!displayArticles.length) {
    return { items: [], articles: [], hasVerifiedNews: false };
  }

  for (const a of displayArticles) {
    const impactTag = a.directMention ? '直命中' : a.tier;
    items.push({
      label: '要闻',
      value: a.title,
      newsId: a.newsId,
      tier: a.tier,
      impactTag,
      url: a.url,
      summary: a.summary,
      source: a.source,
      at: a.publishedAt,
      relevance: a.relevance,
      impactNote: a.impactNote,
      clickable: true,
    });
  }
  return { items, articles: pack.articles, hasVerifiedNews: items.length > 0 };
}

module.exports = {
  ARTICLE_VERSION,
  makeNewsId,
  isSyntheticSummary,
  bodySourceLabel,
  collectRankedNewsArticles,
  loadArticleIndex,
  getFocusNewsArticle,
  buildPolicyNewsItems,
  fetchArticleFullBody,
  invalidateStaleNewsCaches,
};
