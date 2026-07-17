/**
 * 关注品种 · AnySearch 全网新闻（30min 缓存）
 * 缺失 API Key 时使用匿名额度；失败不编造标题
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getExternalRoot } = require('./data-paths');
const { getFocusMeta } = require('./user-focus-symbols');
const { normalizeCommodityId } = require('./policy-commodity-map');

const execFileAsync = promisify(execFile);
const NEWS_TTL_MS = 30 * 60 * 1000;
const CACHE_VERSION = 'v1.50.5';

const CLI_CANDIDATES = [
  path.join(__dirname, '..', '.cursor', 'skills', 'anysearch', 'scripts', 'anysearch_cli.js'),
  path.join(__dirname, '..', '..', '.cursor', 'skills', 'anysearch', 'scripts', 'anysearch_cli.js'),
];

function newsDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'focus-analysis', 'web-news');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newsFilePath(symbol) {
  const dir = newsDir();
  if (!dir) return null;
  const sym = normalizeCommodityId(symbol);
  return path.join(dir, `${sym}.json`);
}

function loadCachedWebNews(symbol, options = {}) {
  const fp = newsFilePath(symbol);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const age = Date.now() - new Date(row.fetchedAt || 0).getTime();
    if (!options.allowStale && (Number.isNaN(age) || age > NEWS_TTL_MS)) return { ...row, stale: true };
    return row;
  } catch {
    return null;
  }
}

function saveWebNews(symbol, payload) {
  const fp = newsFilePath(symbol);
  if (!fp) return null;
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function resolveCli() {
  const skillDir = path.join(__dirname, '..', '.cursor', 'skills', 'anysearch');
  const jsCli = path.join(skillDir, 'scripts', 'anysearch_cli.js');
  if (fs.existsSync(jsCli)) return { cli: jsCli, cwd: skillDir };
  const runtimeConf = path.join(skillDir, 'runtime.conf');
  if (fs.existsSync(runtimeConf)) {
    const raw = fs.readFileSync(runtimeConf, 'utf8');
    const m = raw.match(/anysearch_cli\.js/);
    if (m) {
      const line = raw.split('\n').find((l) => l.includes('anysearch_cli.js'));
      if (line) {
        const parts = line.replace(/^Command:\s*/i, '').trim().split(/\s+/);
        const jsPath = parts.find((p) => p.endsWith('anysearch_cli.js'));
        if (jsPath && fs.existsSync(jsPath)) return { cli: jsPath, cwd: path.dirname(jsPath) };
      }
    }
  }
  for (const p of CLI_CANDIDATES) {
    if (fs.existsSync(p)) return { cli: p, cwd: path.dirname(p) };
  }
  const absRoots = [
    'F:/FanchengFinance/source/fancheng-finance',
    'E:/FanchengFinance/source/fancheng-finance',
  ];
  for (const root of absRoots) {
    const p = path.join(root, '.cursor', 'skills', 'anysearch', 'scripts', 'anysearch_cli.js');
    if (fs.existsSync(p)) return { cli: p, cwd: path.dirname(p) };
  }
  return null;
}

function cleanNewsTitle(raw) {
  let title = String(raw || '').trim();
  title = title.replace(/^###\s*\d+\.\s*/, '');
  title = title.replace(/^#+\s*/, '');
  title = title.replace(/\s*-\s*\*\*URL\*\*.*$/i, '');
  title = title.replace(/\s*-\s*https?:\/\/\S+.*$/i, '');
  return title.trim();
}

function parseMarkdownAnysearch(text) {
  const items = [];
  const blocks = text.split(/\n(?=###\s*\d+\.)/);
  for (const block of blocks) {
    const head = block.match(/^###\s*\d+\.\s*(.+?)(?:\n|$)/);
    if (!head) continue;
    const title = cleanNewsTitle(head[1]);
    if (!title || title.startsWith('Search Results')) continue;
    const urlMatch = block.match(/-\s*\*\*URL\*\*:\s*(\S+)/i) || block.match(/https?:\/\/\S+/);
    const url = urlMatch ? (urlMatch[1] || urlMatch[0]).replace(/[),.;]+$/, '') : null;
    const snippetLine = block
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('- **URL') && l.length > 30);
    items.push({
      title: title.slice(0, 200),
      url,
      snippet: snippetLine ? snippetLine.slice(0, 240) : null,
      source: 'anysearch',
      publishedAt: null,
    });
    if (items.length >= 8) break;
  }
  return items;
}

function parseSearchOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const results = data?.results || data?.items || data?.data?.results || [];
    if (Array.isArray(results) && results.length) {
      return results
        .map((r) => ({
          title: cleanNewsTitle(r.title || r.name || r.snippet || null),
          url: r.url || r.link || null,
          snippet: r.snippet || r.description || null,
          source: r.source || 'anysearch',
          publishedAt: r.published_at || r.date || null,
        }))
        .filter((r) => r.title);
    }
  } catch {
    // fall through
  }
  if (text.includes('### 1.')) {
    const mdItems = parseMarkdownAnysearch(text);
    if (mdItems.length) return mdItems;
  }
  return text
    .split('\n')
    .map((line) => cleanNewsTitle(line))
    .filter((line) => line.length > 12 && !line.startsWith('Search Results'))
    .slice(0, 6)
    .map((title) => ({ title, source: 'anysearch-text', url: null, snippet: null }));
}

async function searchAnyNews(query, options = {}) {
  const resolved = resolveCli();
  if (!resolved) return { ok: false, error: 'anysearch-cli-missing', items: [] };
  const node = process.execPath;
  const maxResults = options.maxResults || 8;
  try {
    const { stdout } = await execFileAsync(
      node,
      [resolved.cli, 'search', query, '--max_results', String(maxResults)],
      {
        timeout: 45000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        cwd: resolved.cwd,
      }
    );
    return { ok: true, items: parseSearchOutput(stdout) };
  } catch (err) {
    return { ok: false, error: err.message || String(err), items: [] };
  }
}

async function extractAnysearchUrl(url) {
  const resolved = resolveCli();
  if (!resolved || !url) return { ok: false, error: 'missing-url-or-cli', content: null };
  const node = process.execPath;
  try {
    const { stdout } = await execFileAsync(node, [resolved.cli, 'extract', url], {
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      cwd: resolved.cwd,
    });
    const text = String(stdout || '').trim();
    return { ok: Boolean(text), content: text || null, dataSource: 'anysearch-extract' };
  } catch (err) {
    return { ok: false, error: err.message || String(err), content: null };
  }
}

function buildSearchQueries(symbol) {
  const meta = getFocusMeta(symbol);
  const name = meta?.name || symbol;
  const year = new Date().getFullYear();
  return [
    `${name} 期货 政策 产能 检修 复产 库存 现货 ${year}`,
    `${name} 期货 市场 供需 价格 最新 ${year}`,
  ];
}

function parseItemTime(item) {
  const t = item?.publishedAt || item?.lastSeenAt || item?.fetchedAt;
  if (!t) return 0;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function mergeWebNewsItems(previous = [], incoming = [], fetchedAt) {
  const map = new Map();
  const stamp = fetchedAt || new Date().toISOString();
  for (const item of [...incoming, ...previous]) {
    if (!item?.title) continue;
    const key = (item.url || item.title).toLowerCase().trim();
    if (!key) continue;
    const existing = map.get(key);
    const row = {
      ...existing,
      ...item,
      title: item.title,
      url: item.url || existing?.url || null,
      snippet: item.snippet || existing?.snippet || null,
      firstSeenAt: existing?.firstSeenAt || item.firstSeenAt || stamp,
      lastSeenAt: stamp,
      publishedAt: item.publishedAt || existing?.publishedAt || existing?.firstSeenAt || stamp,
    };
    map.set(key, row);
  }
  return [...map.values()]
    .sort((a, b) => parseItemTime(b) - parseItemTime(a))
    .slice(0, 24);
}

async function fetchWebNewsForSymbol(symbol, options = {}) {
  const sym = normalizeCommodityId(symbol);
  const cached = loadCachedWebNews(sym, { allowStale: true });
  if (!options.force && cached && !cached.stale && cached.items?.length) return cached;

  const queries = buildSearchQueries(sym);
  const merged = [];
  const seen = new Set();
  for (const query of queries) {
    const result = await searchAnyNews(query, { maxResults: 8 });
    for (const item of result.items || []) {
      const key = (item.url || item.title || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...item, query, publishedAt: item.publishedAt || null });
    }
  }

  const fetchedAt = new Date().toISOString();
  const previousItems = cached?.items || [];
  const items =
    merged.length > 0
      ? mergeWebNewsItems(previousItems, merged, fetchedAt)
      : previousItems.length > 0
        ? mergeWebNewsItems(previousItems, [], fetchedAt)
        : [];

  const payload = {
    version: CACHE_VERSION,
    symbol: sym,
    queries,
    fetchedAt,
    ok: items.length > 0,
    error: items.length ? null : merged.length ? null : previousItems.length ? null : 'no-results',
    refreshedNew: merged.length,
    items,
    dataSource: merged.length ? 'anysearch' : previousItems.length ? 'anysearch-cache' : 'anysearch-empty',
  };
  if (items.length) saveWebNews(sym, payload);
  return payload;
}

async function refreshWebNewsForSymbols(symbols = [], options = {}) {
  const list = [...new Set(symbols.map((s) => normalizeCommodityId(s)).filter(Boolean))];
  const results = [];
  const concurrency = options.concurrency || 2;
  let idx = 0;
  async function worker() {
    while (idx < list.length) {
      const i = idx++;
      const sym = list[i];
      try {
        const row = await fetchWebNewsForSymbol(sym, { force: options.force === true });
        results.push(row);
      } catch (err) {
        results.push({ symbol: sym, ok: false, error: err.message, items: [] });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
  return results;
}

module.exports = {
  NEWS_TTL_MS,
  CACHE_VERSION,
  loadCachedWebNews,
  fetchWebNewsForSymbol,
  refreshWebNewsForSymbols,
  extractAnysearchUrl,
  resolveCli,
};
