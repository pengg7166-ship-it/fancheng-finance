const diskCache = require('./disk-cache');
const { initDataCacheFromDisk, getCachedAllData, scheduleBackgroundRefresh, flushDataCacheToDisk } = require('./data-fetcher');
const { isFredApiKeyConfigured } = require('./config');
const { initNewsCacheFromDisk, flushNewsCacheToDisk, warmNewsCache } = require('./commodities-news');
const { getCachedCommoditiesLive, refreshCommoditiesLiveInBackground } = require('./commodities-fetcher');
const { getCachedMacroSource, fetchMacroSource } = require('./macro-fetcher');
const { getCachedForexSource, fetchForexSource } = require('./forex-fetcher');
const {
  getCachedPolicySource,
  fetchPolicySource,
} = require('./policy-fetcher');
const { getCachedBojSource, fetchBojSource, ensureBojPayloadLocalized } = require('./boj-fetcher');
const { fetchClimateSource } = require('./climate-fetcher');
const { getCachedFedSpeeches } = require('./cb-speeches');
const { getCachedFedIndicators } = require('./fed-indicators-fetcher');
const { refreshFedInBackground } = require('./data-fetcher');

const DISK_CACHE_KEY = 'all-data.json';

function warmAllCaches(userDataPath) {
  diskCache.init(userDataPath);
  initDataCacheFromDisk();
  initNewsCacheFromDisk();
}

function readAllDataFromDisk() {
  const stale = diskCache.readStale(DISK_CACHE_KEY);
  if (!stale?.payload?.sources) return null;
  const payload = {
    sources: stale.payload.sources,
    errors: stale.payload.errors || [],
    fetchedAt:
      stale.payload.fetchedAt ||
      new Date(stale.savedAt || stale._mtime || Date.now()).toISOString(),
    fredApiKeyConfigured: isFredApiKeyConfigured(),
    fromCache: true,
  };
  if (payload.sources.boj) {
    payload.sources = {
      ...payload.sources,
      boj: ensureBojPayloadLocalized(payload.sources.boj),
    };
  }
  if (payload.sources.fed) {
    const fedSpeeches = getCachedFedSpeeches();
    const fedIndicators = getCachedFedIndicators();
    let fed = payload.sources.fed;
    if (fedSpeeches.length && !fed.speeches?.length) {
      fed = { ...fed, speeches: fedSpeeches };
    }
    if (fedIndicators?.length && !fed.indicators?.length) {
      fed = { ...fed, indicators: fedIndicators };
    }
    if (fed !== payload.sources.fed) {
      payload.sources = { ...payload.sources, fed };
    }
  }
  return payload;
}

function getStartupSnapshot() {
  let allData = getCachedAllData();
  if (!allData?.sources?.indices?.regions?.some((r) => r.indices?.length)) {
    const fromDisk = readAllDataFromDisk();
    if (fromDisk) allData = fromDisk;
  }
  const commoditiesLive = getCachedCommoditiesLive();
  const macroLive = getCachedMacroSource();
  const forexLive = getCachedForexSource();
  const policyLive = getCachedPolicySource();
  const bojLive = getCachedBojSource();
  if (allData?.sources) {
    if (bojLive) {
      allData = {
        ...allData,
        sources: {
          ...allData.sources,
          boj: ensureBojPayloadLocalized(bojLive),
        },
      };
    } else if (allData.sources.boj) {
      allData = {
        ...allData,
        sources: {
          ...allData.sources,
          boj: ensureBojPayloadLocalized(allData.sources.boj),
        },
      };
    }
    if (allData.sources.fed) {
      const fedSpeeches = getCachedFedSpeeches();
      const fedIndicators = getCachedFedIndicators();
      let fed = allData.sources.fed;
      if (fedSpeeches.length && !fed.speeches?.length) {
        fed = { ...fed, speeches: fedSpeeches };
      }
      if (fedIndicators?.length && !fed.indicators?.length) {
        fed = { ...fed, indicators: fedIndicators };
      }
      if (fed !== allData.sources.fed) {
        allData = {
          ...allData,
          sources: { ...allData.sources, fed },
        };
      }
    }
  }
  const hasCache =
    Boolean(allData) ||
    diskCache.has(DISK_CACHE_KEY) ||
    Boolean(macroLive) ||
    Boolean(forexLive) ||
    Boolean(policyLive) ||
    Boolean(bojLive);

  return {
    hasCache,
    allData,
    commoditiesLive,
    macroLive,
    forexLive,
    policyLive,
    bojLive,
    cacheRoot: diskCache.getRoot(),
  };
}

function getPushStartupPayload() {
  const snap = getStartupSnapshot();
  return snap.allData?.sources ? snap.allData : null;
}

function prefetchKlinesInBackground() {
  const tasks = [
    { fn: './history-fetcher', id: 'sp500', type: 'index' },
    { fn: './history-fetcher', id: 'nasdaq', type: 'index' },
    { fn: './commodities-history-fetcher', id: 'cu', type: 'commodity' },
    { fn: './commodities-history-fetcher', id: 'rb', type: 'commodity' },
    { fn: './commodities-history-fetcher', id: 'au', type: 'commodity' },
    { fn: './commodities-history-fetcher', id: 'i', type: 'commodity' },
  ];

  tasks.forEach((task, index) => {
    setTimeout(() => {
      try {
        const mod = require(task.fn);
        if (task.type === 'index') {
          mod.fetchIndexHistory(task.id, 'day').catch(() => {});
        } else {
          mod.fetchCommodityHistory(task.id, 'day').catch(() => {});
        }
      } catch {
        // ignore
      }
    }, index * 2500);
  });
}

function prefetchAfterStartup() {
  scheduleBackgroundRefresh();
  setTimeout(() => refreshCommoditiesLiveInBackground(), 2000);
  setTimeout(() => warmNewsCache(), 4000);
  prefetchKlinesInBackground();
  setTimeout(() => fetchMacroSource().catch(() => {}), 12000);
  setTimeout(() => fetchForexSource().catch(() => {}), 14000);
  setTimeout(() => fetchPolicySource().catch(() => {}), 16000);
  setTimeout(() => fetchClimateSource().catch(() => {}), 22000);
  setTimeout(() => refreshFedInBackground(), 6000);
  setTimeout(() => fetchBojSource().catch(() => {}), 9000);
}

function flushAllCaches() {
  flushDataCacheToDisk();
  flushNewsCacheToDisk();
  const live = getCachedCommoditiesLive();
  if (live) {
    diskCache.write('commodities-live.json', { data: live });
  }
}

module.exports = {
  warmAllCaches,
  getStartupSnapshot,
  getPushStartupPayload,
  prefetchAfterStartup,
  flushAllCaches,
};
