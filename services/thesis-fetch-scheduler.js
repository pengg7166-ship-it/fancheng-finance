/**
 * 命题自动抓取调度 'anysearch CLI 'commodities-news 降级
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const thesisRegistry = require('./thesis-registry');
const { getGlobalNewsPoolSync } = require('./commodities-news');

const execFileAsync = promisify(execFile);
const FETCH_VERSION = 'v1.37-global-risk';
const FETCH_INTERVAL_MS = 4 * 3600 * 1000;

const SEARCH_QUERY_PACK = Object.freeze([
  'US equity bubble recession Fed liquidity 2026',
  'stock market crash risk institutional view',
  'yen carry trade unwind USDJPY',
  'silver gold institutional target',
]);

const THEMES = Object.freeze({
  macro_equity_bubble: {
    queries: [SEARCH_QUERY_PACK[0], SEARCH_QUERY_PACK[1]],
    linkedTags: ['macro_equity_bubble', 'liquidity'],
    linkedSymbols: ['au', 'ag'],
  },
  carry_trade: {
    queries: [SEARCH_QUERY_PACK[2]],
    linkedTags: ['liquidity', 'carry_trade'],
    linkedSymbols: ['au', 'ag', 'lc'],
  },
  precious_narrative: {
    queries: [SEARCH_QUERY_PACK[3]],
    linkedTags: ['precious_narrative', 'macro_equity_bubble'],
    linkedSymbols: ['au', 'ag'],
  },
});

let lastFetchAt = 0;
let fetchPromise = null;
let queryRotationIndex = 0;

function resolveAnysearchCli() {
  const skillDir = path.join(__dirname, '..', '.cursor', 'skills', 'anysearch');
  const jsCli = path.join(skillDir, 'scripts', 'anysearch_cli.js');
  if (fs.existsSync(jsCli)) {
    return { cmd: process.execPath, argsPrefix: [jsCli], skillDir };
  }
  const runtimeConf = path.join(skillDir, 'runtime.conf');
  if (fs.existsSync(runtimeConf)) {
    const raw = fs.readFileSync(runtimeConf, 'utf8').trim();
    const parts = raw.split(/\s+/);
    if (parts.length >= 1) return { cmd: parts[0], argsPrefix: parts.slice(1), skillDir };
  }
  const pyCli = path.join(skillDir, 'scripts', 'anysearch_cli.py');
  if (fs.existsSync(pyCli)) {
    return { cmd: process.platform === 'win32' ? 'python' : 'python3', argsPrefix: [pyCli], skillDir };
  }
  return null;
}

async function runAnysearchSearch(query, maxResults = 5) {
  const cli = resolveAnysearchCli();
  if (!cli) return null;
  const args = [...(cli.argsPrefix || []), 'search', query, '--max_results', String(maxResults)];
  try {
    const { stdout } = await execFileAsync(cli.cmd, args, {
      timeout: 45000,
      cwd: cli.skillDir,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (err) {
    return { error: err.message, degraded: true };
  }
}

function extractThesisFromResult(item, themeConfig) {
  const title = item.title || item.name || '';
  const snippet = item.snippet || item.description || item.content || '';
  const sourceUrl = item.url || item.link || null;
  if (!title && !snippet) return null;
  const claim = [title, snippet].filter(Boolean).join(' · ').slice(0, 500);
  if (claim.length < 20) return null;
  return {
    who: item.source || item.site || 'web-search',
    claim,
    horizon: null,
    falsify: null,
    status: 'active',
    linkedSymbols: themeConfig.linkedSymbols || [],
    linkedTags: themeConfig.linkedTags || [],
    sourceTier: 'B',
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    extractedBy: 'rules',
  };
}

function extractFromNewsItem(item, themeConfig) {
  const title = item.title || '';
  const summary = item.summary || '';
  const text = `${title} ${summary}`;
  if (text.length < 25) return null;
  return {
    who: item.source || 'commodities-news',
    claim: text.slice(0, 500),
    linkedSymbols: themeConfig.linkedSymbols || [],
    linkedTags: themeConfig.linkedTags || [],
    sourceTier: 'C',
    sourceUrl: item.url || item.link || null,
    fetchedAt: item.publishedAt || new Date().toISOString(),
    extractedBy: 'rules',
  };
}

function rotatedQueries(themeConfig) {
  const base = themeConfig.queries || [];
  if (!base.length) return [];
  const offset = queryRotationIndex % base.length;
  return [...base.slice(offset), ...base.slice(0, offset)].slice(0, 2);
}

async function fetchThemeTheses(themeId) {
  const themeConfig = THEMES[themeId];
  if (!themeConfig) return { themeId, candidates: [], source: 'none' };

  const candidates = [];
  let source = 'news-fallback';

  for (const query of rotatedQueries(themeConfig)) {
    const result = await runAnysearchSearch(query, 4);
    if (result?.results?.length) {
      source = 'anysearch';
      for (const item of result.results) {
        const t = extractThesisFromResult(item, themeConfig);
        if (t) candidates.push(t);
      }
    } else if (result?.error) {
      source = 'degraded';
    }
  }

  if (!candidates.length) {
    const news = getGlobalNewsPoolSync?.() || [];
    const tagPattern = (themeConfig.linkedTags || []).join('|').replace(/_/g, '|');
    const re = new RegExp(tagPattern || themeId.replace(/_/g, '|'), 'i');
    for (const item of news.slice(0, 80)) {
      if (!re.test(`${item.title} ${item.summary}`)) continue;
      const t = extractFromNewsItem(item, themeConfig);
      if (t) candidates.push(t);
      if (candidates.length >= 5) break;
    }
  }

  return { themeId, candidates, source };
}

async function runThesisFetch(options = {}) {
  if (fetchPromise && !options.force) return fetchPromise;

  const run = async () => {
    thesisRegistry.ensureSeedData();
    const { runThesisRetirement } = require('./thesis-retirement');
    runThesisRetirement();
    queryRotationIndex = (queryRotationIndex + 1) % SEARCH_QUERY_PACK.length;
    const results = [];
    let ingested = 0;
    const themeIds = options.themes || Object.keys(THEMES);

    for (const themeId of themeIds) {
      const { candidates, source } = await fetchThemeTheses(themeId);
      const deduped = thesisRegistry.dedupeByUrl(candidates);
      for (const c of deduped) {
        thesisRegistry.upsertThesis(c);
        ingested += 1;
      }
      results.push({ themeId, source, candidateCount: candidates.length, ingested: deduped.length });
    }

    lastFetchAt = Date.now();

    let autoPool = null;
    try {
      const { evaluateAutoPoolTriggers } = require('./research-pool-auto-trigger');
      autoPool = evaluateAutoPoolTriggers({ theses: thesisRegistry.getActiveTheses() });
    } catch (err) {
      autoPool = { error: err?.message || String(err) };
    }

    return {
      version: FETCH_VERSION,
      ok: true,
      ingested,
      themes: results,
      queryPack: SEARCH_QUERY_PACK,
      fetchedAt: new Date().toISOString(),
      anysearchConfigured: Boolean(resolveAnysearchCli()),
      autoPool,
    };
  };

  fetchPromise = run().finally(() => {
    fetchPromise = null;
  });
  return fetchPromise;
}

function scheduleThesisFetchIfDue(options = {}) {
  const force = options.force === true;
  if (!force && lastFetchAt && Date.now() - lastFetchAt < FETCH_INTERVAL_MS) {
    return null;
  }
  return runThesisFetch({ force }).catch((err) => ({
    ok: false,
    error: err.message,
    fetchedAt: new Date().toISOString(),
  }));
}

function getThesisFetchStatus() {
  return {
    lastFetchAt: lastFetchAt ? new Date(lastFetchAt).toISOString() : null,
    intervalMs: FETCH_INTERVAL_MS,
    anysearchConfigured: Boolean(resolveAnysearchCli()),
    themes: Object.keys(THEMES),
    queryPack: SEARCH_QUERY_PACK,
  };
}

module.exports = {
  FETCH_VERSION,
  SEARCH_QUERY_PACK,
  THEMES,
  FETCH_INTERVAL_MS,
  runThesisFetch,
  scheduleThesisFetchIfDue,
  getThesisFetchStatus,
  fetchThemeTheses,
};
