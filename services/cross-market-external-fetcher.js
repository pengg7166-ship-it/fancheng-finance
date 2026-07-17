/**
 * 跨境外盘日频抓取（新浪 Global Futures）
 * 落盘 history/*-daily.json；缺失不造假。贵金属仍可由 cross-market-precious-fetcher 维护。
 */
const fs = require('fs');
const path = require('path');
const { fetchSinaGlobalFuturesDaily } = require('./cross-market-precious-fetcher');
const { getHistoryDir, DEFAULT_START } = require('./fred-history-fetcher');

const EXTERNAL_SERIES_VERSION = 'v2.62.0-external-map';

/**
 * 可抓取的外盘序列目录（仅实测可用符号）
 * role: direct=同品种锚点；cost=成本链锚点（须在展示中标明）
 */
const EXTERNAL_SERIES_CATALOG = Object.freeze({
  'comex-hg-daily.json': { sinaSymbol: 'HG', label: 'COMEX铜 HG', seriesId: 'HG', role: 'direct' },
  'lme-cad-daily.json': { sinaSymbol: 'CAD', label: 'LME铜 CAD', seriesId: 'CAD', role: 'direct' },
  'lme-ahd-daily.json': { sinaSymbol: 'AHD', label: 'LME铝 AHD', seriesId: 'AHD', role: 'direct' },
  'lme-zsd-daily.json': { sinaSymbol: 'ZSD', label: 'LME锌 ZSD', seriesId: 'ZSD', role: 'direct' },
  'lme-pbd-daily.json': { sinaSymbol: 'PBD', label: 'LME铅 PBD', seriesId: 'PBD', role: 'direct' },
  'lme-nid-daily.json': { sinaSymbol: 'NID', label: 'LME镍 NID', seriesId: 'NID', role: 'direct' },
  'lme-snd-daily.json': { sinaSymbol: 'SND', label: 'LME锡 SND', seriesId: 'SND', role: 'direct' },
  'comex-cl-daily.json': { sinaSymbol: 'CL', label: 'WTI CL', seriesId: 'CL', role: 'direct' },
  'ice-oil-daily.json': { sinaSymbol: 'OIL', label: 'Brent OIL', seriesId: 'OIL', role: 'direct' },
  'nymex-ng-daily.json': { sinaSymbol: 'NG', label: '天然气 NG', seriesId: 'NG', role: 'direct' },
  'nymex-ho-daily.json': { sinaSymbol: 'HO', label: '取暖油 HO', seriesId: 'HO', role: 'cost' },
  'cbot-s-daily.json': { sinaSymbol: 'S', label: 'CBOT大豆 S', seriesId: 'S', role: 'direct' },
  'cbot-bo-daily.json': { sinaSymbol: 'BO', label: 'CBOT豆油 BO', seriesId: 'BO', role: 'direct' },
  'cbot-sm-daily.json': { sinaSymbol: 'SM', label: 'CBOT豆粕 SM', seriesId: 'SM', role: 'direct' },
  'cbot-c-daily.json': { sinaSymbol: 'C', label: 'CBOT玉米 C', seriesId: 'C', role: 'direct' },
  'cbot-w-daily.json': { sinaSymbol: 'W', label: 'CBOT小麦 W', seriesId: 'W', role: 'direct' },
  'cbot-rs-daily.json': { sinaSymbol: 'RS', label: 'CBOT菜籽 RS', seriesId: 'RS', role: 'direct' },
  'ice-ct-daily.json': { sinaSymbol: 'CT', label: 'ICE棉花 CT', seriesId: 'CT', role: 'direct' },
  'bmd-fcpo-daily.json': { sinaSymbol: 'FCPO', label: 'BMD棕榈 FCPO', seriesId: 'FCPO', role: 'direct' },
  'sgx-fef-daily.json': { sinaSymbol: 'FEF', label: 'SGX铁矿 FEF', seriesId: 'FEF', role: 'direct' },
  'tocom-rss3-daily.json': { sinaSymbol: 'RSS3', label: 'RSS3橡胶', seriesId: 'RSS3', role: 'direct' },
  'cme-le-daily.json': { sinaSymbol: 'LE', label: 'CME活牛 LE', seriesId: 'LE', role: 'direct' },
  'spot-xau-daily.json': { sinaSymbol: 'XAU', label: '伦敦金现 XAU', seriesId: 'XAU', role: 'direct' },
  'spot-xag-daily.json': { sinaSymbol: 'XAG', label: '伦敦银现 XAG', seriesId: 'XAG', role: 'direct' },
});

function seriesFilePath(filename) {
  return path.join(getHistoryDir(), filename);
}

function loadLocalSeries(filename) {
  const p = seriesFilePath(filename);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return null;
}

function saveLocalSeries(filename, payload) {
  const dir = getHistoryDir();
  fs.mkdirSync(dir, { recursive: true });
  const fp = seriesFilePath(filename);
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return fp;
}

async function fetchAndCacheExternalSeries(filename, { startDate = DEFAULT_START, force = false } = {}) {
  const cfg = EXTERNAL_SERIES_CATALOG[filename];
  if (!cfg) throw new Error(`Unknown external series file: ${filename}`);

  if (!force) {
    const local = loadLocalSeries(filename);
    if (local?.series?.length >= 50) {
      return { ...local, fromCache: true, jsonPath: seriesFilePath(filename), file: filename };
    }
  }

  const series = await fetchSinaGlobalFuturesDaily(cfg.sinaSymbol, startDate);
  if (series.length < 20) {
    throw new Error(`${cfg.sinaSymbol} 日频不足 (${series.length})`);
  }

  const payload = {
    seriesId: cfg.seriesId,
    label: cfg.label,
    freq: 'daily',
    source: 'sina-global-futures',
    role: cfg.role,
    startDate,
    fetchedAt: new Date().toISOString(),
    series,
    rowCount: series.length,
    version: EXTERNAL_SERIES_VERSION,
  };
  const jsonPath = saveLocalSeries(filename, payload);
  return { ...payload, fromCache: false, jsonPath, file: filename };
}

async function fetchAllExternalSeries({ startDate = DEFAULT_START, force = false, files = null } = {}) {
  const list = files || Object.keys(EXTERNAL_SERIES_CATALOG);
  const results = [];
  const errors = [];
  for (const file of list) {
    try {
      const r = await fetchAndCacheExternalSeries(file, { startDate, force });
      results.push({
        file,
        ok: true,
        rows: r.rowCount,
        fromCache: r.fromCache,
        label: r.label,
        last: r.series?.[r.series.length - 1] || null,
      });
    } catch (err) {
      errors.push({ file, ok: false, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 280));
  }
  return {
    version: EXTERNAL_SERIES_VERSION,
    ok: errors.length === 0,
    fetched: results.length,
    failed: errors.length,
    results,
    errors,
    dataDir: getHistoryDir(),
  };
}

function listCachedExternalCoverage() {
  const out = [];
  for (const [file, cfg] of Object.entries(EXTERNAL_SERIES_CATALOG)) {
    const local = loadLocalSeries(file);
    out.push({
      file,
      label: cfg.label,
      sinaSymbol: cfg.sinaSymbol,
      role: cfg.role,
      cached: Boolean(local?.series?.length),
      rows: local?.series?.length || 0,
      lastDate: local?.series?.length ? local.series[local.series.length - 1].date : null,
    });
  }
  return out;
}

module.exports = {
  EXTERNAL_SERIES_VERSION,
  EXTERNAL_SERIES_CATALOG,
  fetchAndCacheExternalSeries,
  fetchAllExternalSeries,
  listCachedExternalCoverage,
  seriesFilePath,
};
