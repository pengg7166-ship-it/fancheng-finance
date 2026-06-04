const crypto = require('crypto');
const Parser = require('rss-parser');
const { fetchText, fetchJson } = require('./http-client');
const diskCache = require('./disk-cache');
const {
  POLICY_DEPARTMENTS,
  POLICY_RSS_FEEDS,
  GOV_CN_POLICY,
  POLICY_FETCH_KEYWORDS,
  getDepartmentById,
} = require('./policy-sources');
const {
  US_POLICY_DEPARTMENTS,
  US_POLICY_RSS_FEEDS,
  US_FEDERAL_REGISTER_AGENCIES,
  US_POLICY_FETCH_KEYWORDS,
  getUsDepartmentById,
  buildFederalRegisterUrl,
} = require('./policy-us-sources');
const { scorePolicyItem } = require('./policy-scorer');
const { translateUsPolicyItems } = require('./policy-us-translator');
const { getCachedGeopoliticsSource } = require('./geopolitics-fetcher');
const { buildCommodityIntelligence } = require('./policy-commodity-intelligence');
const { getFastNewsPool, getGlobalNewsPoolSync, warmNewsCache } = require('./commodities-news');

const POLICY_DISK_KEY = 'policy-radar.json';
const POLICY_DISK_TTL_MS = 60 * 1000;
const RSS_TIMEOUT_MS = 8000;
const FR_TIMEOUT_MS = 15000;

const parser = new Parser({
  timeout: RSS_TIMEOUT_MS,
  headers: {
    'User-Agent': 'FanchengFinance/1.6 (Desktop App; contact@fancheng.local)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

const FR_HEADERS = {
  'User-Agent': 'FanchengFinance/1.6 (Desktop App; contact@fancheng.local)',
  Accept: 'application/json',
};

let liveRefreshPromise = null;

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashPolicy(item) {
  return crypto
    .createHash('md5')
    .update(`${item.region}|${item.title}|${item.link}|${item.pubDate}`)
    .digest('hex');
}

function isCnPolicyRelevant(text) {
  if (!text) return false;
  return POLICY_FETCH_KEYWORDS.some((k) => text.includes(k));
}

function isUsPolicyRelevant(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return US_POLICY_FETCH_KEYWORDS.some((k) => {
    const lk = k.toLowerCase();
    return lower.includes(lk) || text.includes(k);
  });
}

function classifyCnDepartment(title, summary, defaultDepartmentId) {
  if (defaultDepartmentId && defaultDepartmentId !== 'general') {
    return defaultDepartmentId;
  }
  const text = `${title} ${summary}`;
  for (const dept of POLICY_DEPARTMENTS) {
    if (dept.keywords.some((k) => text.includes(k))) return dept.id;
  }
  if (/国务院|国务院办公厅/.test(text)) return 'gov';
  return defaultDepartmentId || 'gov';
}

function classifyUsDepartment(title, summary, defaultDepartmentId) {
  if (defaultDepartmentId && defaultDepartmentId !== 'us-exec') {
    return defaultDepartmentId;
  }
  const text = `${title} ${summary}`;
  const lower = text.toLowerCase();
  for (const dept of US_POLICY_DEPARTMENTS) {
    if (
      dept.keywords.some((k) => {
        const lk = k.toLowerCase();
        return lower.includes(lk) || text.includes(k);
      })
    ) {
      return dept.id;
    }
  }
  return defaultDepartmentId || 'us-exec';
}

function resolveDepartmentMeta(region, departmentId) {
  if (region === 'us') {
    const dept = getUsDepartmentById(departmentId);
    return {
      departmentName: dept?.name || '美国综合',
      departmentShort: dept?.shortName || '综合',
    };
  }
  const dept = getDepartmentById(departmentId);
  return {
    departmentName: dept?.name || '综合',
    departmentShort: dept?.shortName || '综合',
  };
}

function normalizeItem(raw) {
  const region = raw.region || 'cn';
  const title = stripHtml(raw.title);
  const summary = stripHtml(raw.summary).slice(0, 280);
  const departmentId =
    region === 'us'
      ? classifyUsDepartment(title, summary, raw.departmentId)
      : classifyCnDepartment(title, summary, raw.departmentId);
  const meta = resolveDepartmentMeta(region, departmentId);
  const scored = scorePolicyItem({
    title,
    summary,
    departmentId,
    sourceId: raw.sourceId,
    region,
  });

  const docTypeLabel = raw.documentType ? `[${raw.documentType}] ` : '';

  return {
    id: hashPolicy({ title, link: raw.link, pubDate: raw.pubDate, region }),
    region,
    regionLabel: region === 'us' ? '美国' : '中国',
    title,
    summary: summary ? summary : raw.abstract ? stripHtml(raw.abstract).slice(0, 280) : '',
    link: raw.link,
    pubDate: raw.pubDate || '',
    sourceId: raw.sourceId,
    sourceName: raw.sourceName,
    documentType: raw.documentType || '',
    departmentId,
    departmentName: meta.departmentName,
    departmentShort: meta.departmentShort,
    displayTitle: `${docTypeLabel}${title}`.trim(),
    ...scored,
  };
}

async function fetchRssFeed(feed, { region, relevanceFn }) {
  const urls = [feed.url, ...(feed.fallbackUrls || [])];
  for (const url of urls) {
    try {
      const parsed = await Promise.race([
        parser.parseURL(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('RSS 超时')), RSS_TIMEOUT_MS)),
      ]);
      return (parsed.items || [])
        .slice(0, feed.limit || 50)
        .map((item) => ({
          title: item.title,
          summary: item.contentSnippet || item.summary || item.content || '',
          link: item.link || '',
          pubDate: item.pubDate || item.isoDate || '',
          sourceId: feed.id,
          sourceName: feed.name,
          departmentId: feed.departmentId,
          region,
        }))
        .filter((item) => relevanceFn(`${item.title} ${item.summary}`));
    } catch {
      // try next
    }
  }
  return [];
}

async function fetchGovCnPolicies() {
  const html = await fetchText(`${GOV_CN_POLICY.url}?_=${Date.now()}`, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    retries: 2,
  });

  const items = [];
  const re = /href="(https:\/\/www\.gov\.cn\/zhengce\/content\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && items.length < 25) {
    const title = stripHtml(m[2]);
    if (!title) continue;
    items.push({
      title,
      summary: '',
      link: m[1],
      pubDate: extractDateFromGovLink(m[1]),
      sourceId: GOV_CN_POLICY.id,
      sourceName: GOV_CN_POLICY.name,
      departmentId: GOV_CN_POLICY.defaultDepartment,
      region: 'cn',
    });
  }
  return items;
}

function extractDateFromGovLink(link) {
  const m = link.match(/content_(\d{4})(\d{2})/);
  if (!m) return '';
  return `${m[1]}-${m[2]}-01T00:00:00+08:00`;
}

async function fetchFederalRegisterAgency(agency) {
  const url = buildFederalRegisterUrl(agency.slug, agency.limit || 15);
  try {
    const json = await fetchJson(url, { timeout: FR_TIMEOUT_MS, headers: FR_HEADERS, retries: 1 });
    return (json.results || [])
      .map((doc) => {
        const docType = doc.type || '';
        const abstract = stripHtml(doc.abstract || doc.action || '').slice(0, 280);
        return {
          title: doc.title || '',
          summary: abstract,
          abstract,
          link: doc.html_url || doc.pdf_url || '',
          pubDate: doc.publication_date ? `${doc.publication_date}T12:00:00Z` : '',
          sourceId: agency.id,
          sourceName: 'Federal Register',
          departmentId: agency.departmentId,
          documentType: docType,
          region: 'us',
        };
      })
      .filter((item) => item.title && isUsPolicyRelevant(`${item.title} ${item.summary}`));
  } catch {
    return [];
  }
}

async function fetchCnPolicyRaw() {
  const tasks = [
    fetchGovCnPolicies(),
    ...POLICY_RSS_FEEDS.map((feed) =>
      fetchRssFeed(feed, { region: 'cn', relevanceFn: isCnPolicyRelevant })
    ),
  ];
  const results = await Promise.allSettled(tasks);
  const merged = [];
  for (const result of results) {
    if (result.status === 'fulfilled') merged.push(...result.value);
  }
  return merged;
}

async function fetchUsPolicyRaw() {
  const tasks = [
    ...US_POLICY_RSS_FEEDS.map((feed) =>
      fetchRssFeed(feed, { region: 'us', relevanceFn: isUsPolicyRelevant })
    ),
    ...US_FEDERAL_REGISTER_AGENCIES.map((agency) => fetchFederalRegisterAgency(agency)),
  ];
  const results = await Promise.allSettled(tasks);
  const merged = [];
  for (const result of results) {
    if (result.status === 'fulfilled') merged.push(...result.value);
  }
  return merged;
}

async function fetchAllPolicyRaw() {
  const [cnItems, usItems] = await Promise.all([fetchCnPolicyRaw(), fetchUsPolicyRaw()]);
  return [...cnItems, ...usItems];
}

function dedupeAndSort(items) {
  const map = new Map();
  for (const raw of items) {
    const item = normalizeItem(raw);
    const key = item.id;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => {
    const starDiff = b.stars - a.stars;
    if (starDiff !== 0) return starDiff;
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });
}

function buildDepartmentGroups(items, regionFilter = null) {
  const filtered = regionFilter ? items.filter((i) => i.region === regionFilter) : items;
  const departments =
    regionFilter === 'us'
      ? US_POLICY_DEPARTMENTS
      : regionFilter === 'cn'
        ? POLICY_DEPARTMENTS
        : [...POLICY_DEPARTMENTS, ...US_POLICY_DEPARTMENTS];

  const groups = departments
    .map((dept) => ({
      id: dept.id,
      label: dept.shortName,
      name: dept.name,
      region: dept.id.startsWith('us-') ? 'us' : 'cn',
      items: filtered.filter((i) => i.departmentId === dept.id),
    }))
    .filter((g) => g.items.length);

  const knownIds = new Set(departments.map((d) => d.id));
  const unassigned = filtered.filter((i) => !knownIds.has(i.departmentId));
  if (unassigned.length) {
    groups.push({
      id: 'other',
      label: '其他',
      name: '其他来源',
      region: regionFilter || 'all',
      items: unassigned,
    });
  }
  return groups;
}

function buildStats(items) {
  const highImpact = items.filter((i) => i.stars >= 4);
  const cnItems = items.filter((i) => i.region === 'cn');
  const usItems = items.filter((i) => i.region === 'us');
  return {
    total: items.length,
    highImpact: highImpact.length,
    departments: buildDepartmentGroups(items).length,
    cn: {
      total: cnItems.length,
      highImpact: cnItems.filter((i) => i.stars >= 4).length,
    },
    us: {
      total: usItems.length,
      highImpact: usItems.filter((i) => i.stars >= 4).length,
    },
  };
}

const POLICY_PAYLOAD_ITEM_LIMIT = 150;

async function fetchPolicyRadar() {
  const rawItems = await fetchAllPolicyRaw();
  let items = dedupeAndSort(rawItems);
  items = await translateUsPolicyItems(items);
  items = items.slice(0, POLICY_PAYLOAD_ITEM_LIMIT);
  const groups = buildDepartmentGroups(items);
  const stats = buildStats(items);

  return { items, groups, stats };
}

async function fetchPolicySource() {
  warmNewsCache();
  const { items, groups, stats } = await fetchPolicyRadar();
  const [fastPool] = await Promise.all([
    getFastNewsPool().catch(() => []),
  ]);
  const globalPool = getGlobalNewsPoolSync();
  const geoItems = getCachedGeopoliticsSource()?.items || [];
  const commodityIntelFull = buildCommodityIntelligence(items, fastPool, globalPool, geoItems);
  const commodityIntel = {
    catalog: commodityIntelFull.catalog,
    summary: commodityIntelFull.summary,
    updatedAt: commodityIntelFull.updatedAt,
    geoFeeds: Object.fromEntries(
      Object.entries(commodityIntelFull.feeds || {}).map(([id, feed]) => [
        id,
        { geoNews: (feed.geoNews || []).slice(0, 8) },
      ])
    ),
  };

  const payload = {
    key: 'policy',
    name: '政策雷达',
    items,
    groups,
    stats,
    commodityIntel,
    news: [],
    indicators: [],
    dataLabel: '中美部委政策与产业影响雷达',
    updatedAt: new Date().toISOString(),
    liveRefreshedAt: new Date().toISOString(),
  };

  diskCache.write(POLICY_DISK_KEY, { data: payload });
  persistPolicyToAllData(payload);
  return payload;
}

function persistPolicyToAllData(payload) {
  try {
    const stale = diskCache.readStale('all-data.json');
    if (stale?.payload?.sources) {
      diskCache.write('all-data.json', {
        payload: {
          ...stale.payload,
          sources: { ...stale.payload.sources, policy: payload },
          fetchedAt: new Date().toISOString(),
        },
        savedAt: Date.now(),
      });
    }
  } catch {
    // ignore
  }
}

function getCachedPolicySource() {
  const stored =
    diskCache.read(POLICY_DISK_KEY, POLICY_DISK_TTL_MS) ||
    diskCache.readStale(POLICY_DISK_KEY);
  return stored?.data || null;
}

function refreshPolicyLiveInBackground() {
  if (liveRefreshPromise) return liveRefreshPromise;
  liveRefreshPromise = fetchPolicySource()
    .catch(() => null)
    .finally(() => {
      liveRefreshPromise = null;
    });
  return liveRefreshPromise;
}

async function fetchPolicyLive({ force = true } = {}) {
  if (!force) {
    const cached = getCachedPolicySource();
    if (cached?.items?.length) {
      refreshPolicyLiveInBackground();
      return { ...cached, fromCache: true };
    }
  }
  return fetchPolicySource();
}

module.exports = {
  fetchPolicySource,
  fetchPolicyLive,
  getCachedPolicySource,
  refreshPolicyLiveInBackground,
  fetchPolicyRadar,
  fetchCnPolicyRaw,
  fetchUsPolicyRaw,
};
