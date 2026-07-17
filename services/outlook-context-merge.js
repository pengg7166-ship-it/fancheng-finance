/**
 * 将 data-fetcher 全量 sources 合并进 outlook 缓存，供 Cursor / 置顶资讯预期因子使用
 */
function mergeOutlookWithSources(outlook = {}) {
  if (!outlook || typeof outlook !== 'object') return { sources: {} };
  let sources = outlook.sources;
  if (sources?.fundamentals?.indicators?.length && sources?.policy?.items?.length) {
    return outlook;
  }
  try {
    const { getCachedAllData } = require('./data-fetcher');
    const cached = getCachedAllData()?.sources || {};
    if (!Object.keys(cached).length) return outlook;
    sources = { ...cached, ...(outlook.sources || {}) };
    if (!sources.fundamentals?.indicators?.length) {
      try {
        const { getCachedFundamentalsSource } = require('./commodity-fundamentals-fetcher');
        const fund = getCachedFundamentalsSource();
        if (fund?.indicators?.length) sources.fundamentals = fund;
      } catch {
        // optional
      }
    }
    return { ...outlook, sources };
  } catch {
    return outlook;
  }
}

module.exports = { mergeOutlookWithSources };
