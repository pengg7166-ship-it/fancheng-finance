/**
 * 36 品种 · 资讯覆盖度审计（只读真实池，不造假）
 */
const fs = require('fs');
const path = require('path');
const { listUserFocusMeta, getFocusSector } = require('./user-focus-symbols');
const { normalizeCommodityId, detectCommodityTags } = require('./policy-commodity-map');
const { isOpinionTitle } = require('./opinion-news');
const dailyClose = require('./daily-close-sync');
const { isStale } = require('./daily-data-sync');
const { getDataDir } = require('./data-paths');
const diskCache = require('./disk-cache');

const COVERAGE_VERSION = 'v1.56.9-coverage-audit';
const { exchangeNoticeMatchesSymbol } = require('./exchange-symbol-match');

const SECTOR_POLICY_KEYWORDS = {
  precious: ['贵金属', '黄金', '白银', 'bullion', '铂金', '钯金'],
  metals: ['有色', '电解铜', '电解铝', '铜', '铝', '锌', '镍', '锡', '铅'],
  newenergy: ['新能源', '光伏', '锂电', '硅', '锂', '多晶硅', '碳酸锂'],
  black: ['黑色', '钢铁', '粗钢', '铁矿', '焦煤', '螺纹', '玻璃'],
  energy: ['原油', '石油', '油气', 'OPEC', '能源', '燃料油'],
  chemical: ['化工', '石化', '聚酯', '甲醇', '橡胶', 'PTA', '乙二醇', '纯碱', '玻璃'],
  agriculture: ['农产品', '粮食', '豆粕', '油脂', '棉花', '白糖', '猪肉', '鸡蛋', '菜籽'],
};

const LAYER_LABELS = {
  flash: '快讯',
  policy: '政策',
  opinion: '观点',
  intl: '国际',
  exchange: '交易所',
  close: '收盘价',
};

const SECTOR_LAYERS = {
  precious: ['flash', 'policy', 'opinion', 'intl', 'close'],
  metals: ['flash', 'policy', 'opinion', 'intl', 'close'],
  newenergy: ['flash', 'policy', 'opinion', 'close'],
  black: ['flash', 'policy', 'opinion', 'close'],
  energy: ['flash', 'policy', 'opinion', 'intl', 'close'],
  chemical: ['flash', 'policy', 'opinion', 'close'],
  agriculture: ['flash', 'policy', 'opinion', 'intl', 'close'],
};

const INTL_SYMBOLS = new Set(['sc', 'fu', 'cu', 'al', 'au', 'ag', 'm', 'y', 'p', 'cf', 'sr']);

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function withinHours(dateStr, hours) {
  const d = parseDate(dateStr);
  if (!d) return false;
  return Date.now() - d.getTime() <= hours * 60 * 60 * 1000;
}

function withinDays(dateStr, days) {
  const d = parseDate(dateStr);
  if (!d) return false;
  return Date.now() - d.getTime() <= days * 24 * 60 * 60 * 1000;
}

function itemText(item) {
  return `${item.title || ''} ${item.summary || ''} ${item.sourceName || item.source || ''}`;
}

function itemMatchesSector(item, sector) {
  const kws = SECTOR_POLICY_KEYWORDS[sector] || [];
  if (!kws.length) return false;
  const text = itemText(item);
  return kws.some((kw) => text.includes(kw));
}

function findLayerHit(pool, sym, sector, withinFn, sectorFallback = false) {
  const id = normalizeCommodityId(sym);
  const symbolHit = pool.find((it) => withinFn(it) && itemMatchesSymbol(it, id));
  if (symbolHit) return { hit: symbolHit, scope: 'symbol' };
  if (!sectorFallback) return { hit: null, scope: null };
  const sectorHit = pool.find((it) => withinFn(it) && itemMatchesSector(it, sector));
  if (sectorHit) return { hit: sectorHit, scope: 'sector' };
  return { hit: null, scope: null };
}

function itemMatchesSymbol(item, sym) {
  const id = normalizeCommodityId(sym);
  const text = itemText(item);
  const tags = detectCommodityTags(text).map((t) => normalizeCommodityId(t.id));
  if (tags.includes(id)) return true;
  if (item.commodityTags?.map(normalizeCommodityId).includes(id)) return true;
  if (item.symbols?.map(normalizeCommodityId).includes(id)) return true;
  return false;
}

function readJsonPool(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const row = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return row.items || row.candidates || row.data?.items || row.headlines || [];
  } catch {
    return [];
  }
}

function collectPools() {
  const pools = { flash: [], policy: [], opinion: [], exchange: [] };
  const dataDir = getDataDir();
  if (dataDir) {
    pools.flash.push(
      ...readJsonPool(path.join(dataDir, 'history', 'flash-news-inbox.json')),
      ...readJsonPool(path.join(dataDir, 'news-fast.json'))
    );
    pools.policy.push(...readJsonPool(path.join(dataDir, 'policy-radar.json')));
  }
  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    const policy = diskCache.readStale('policy-radar.json')?.data?.items;
    if (policy?.length) pools.policy.push(...policy);
    const fast = diskCache.readStale('news-fast.json')?.items;
    if (fast?.length) pools.flash.push(...fast);
    const global = diskCache.readStale('news-global.json')?.items;
    if (global?.length) pools.intl = global;
  } catch {
  }

  for (const item of [...pools.flash, ...pools.policy]) {
    const text = itemText(item);
    if (item.contentType === 'opinion' || isOpinionTitle(item.title)) pools.opinion.push(item);
    if (/交易所|限仓|保证金|持仓限额|中金所|上期所|大商所|郑商所|广期所|能源中心/.test(text)) pools.exchange.push(item);
  }
  try {
    const { getCachedExchangeNoticeBundle } = require('./exchange-notice-fetcher');
    const bundle = getCachedExchangeNoticeBundle();
    if (bundle?.items?.length) pools.exchange.push(...bundle.items);
  } catch {
    // ignore
  }
  pools.intl = pools.intl || [];
  return pools;
}

function layerStatus(layer, sym, pools, sector = 'other') {
  const id = normalizeCommodityId(sym);
  switch (layer) {
    case 'close': {
      dailyClose.initDiskCache?.();
      const latest = dailyClose.getLatestBarClose(id);
      const ok = latest?.tradeDate && latest.close > 0 && !isStale(latest.tradeDate, 2);
      return { ok, sample: latest?.tradeDate || null, note: ok ? '≤2交易日' : '滞后或缺失' };
    }
    case 'intl': {
      if (!INTL_SYMBOLS.has(id)) return { ok: true, sample: '—', note: '非跨境主品种' };
      const { hit, scope } = findLayerHit(
        pools.intl || [],
        id,
        sector,
        (it) => withinDays(it.pubDate || it.publishedAt, 7),
        false
      );
      return { ok: !!hit, sample: hit?.title?.slice(0, 40) || null, note: hit ? '7日内' : '暂无', scope };
    }
    case 'flash': {
      const { hit, scope } = findLayerHit(
        pools.flash,
        id,
        sector,
        (it) => withinHours(it.pubDate || it.fetchedAt || it.publishedAt, 72),
        false
      );
      return { ok: !!hit, sample: hit?.title?.slice(0, 40) || null, note: hit ? '72h内' : '暂无', scope };
    }
    case 'policy': {
      const { hit, scope } = findLayerHit(
        pools.policy,
        id,
        sector,
        (it) => withinDays(it.pubDate || it.publishedAt, 14),
        true
      );
      const note = hit ? (scope === 'sector' ? '板块级14日内' : '14日内') : '暂无';
      return { ok: !!hit, sample: hit?.title?.slice(0, 40) || null, note, scope };
    }
    case 'opinion': {
      const { hit, scope } = findLayerHit(
        pools.opinion,
        id,
        sector,
        (it) => withinDays(it.pubDate || it.publishedAt || it.fetchedAt, 7),
        true
      );
      const note = hit ? (scope === 'sector' ? '板块级7日内' : '7日内') : '暂无';
      return { ok: !!hit, sample: hit?.title?.slice(0, 40) || null, note, scope };
    }
    case 'exchange': {
      const pool = (() => {
        try {
          const { getCachedExchangeNoticeBundle } = require('./exchange-notice-fetcher');
          const bundle = getCachedExchangeNoticeBundle();
          return bundle?.items?.length ? bundle.items : pools.exchange;
        } catch {
          return pools.exchange;
        }
      })();
      const hit = pool.find((it) => {
        if (!withinDays(it.pubDate || it.publishedAt || it.fetchedAt, 30)) return false;
        return exchangeNoticeMatchesSymbol(it, id).match;
      });
      if (hit) {
        const { scope } = exchangeNoticeMatchesSymbol(hit, id);
        const mirror = hit.exchangeMirror ? '镜像' : '直连';
        const scopeNote = scope === 'product-name' ? '品名' : scope === 'symbol' ? '品种' : scope || '—';
        return { ok: true, sample: hit.title?.slice(0, 40) || null, note: `${mirror}·${scopeNote}·30日内`, scope };
      }
      return { ok: false, sample: null, note: '暂无' };
    }
    default:
      return { ok: false, sample: null, note: '—' };
  }
}

function auditNewsCoverage() {
  const pools = collectPools();
  const symbols = listUserFocusMeta();
  const rows = symbols.map((meta) => {
    const sector = getFocusSector(meta.id);
    const required = SECTOR_LAYERS[sector] || SECTOR_LAYERS.chemical;
    const layers = {};
    let okN = 0;
    for (const layer of ['flash', 'policy', 'opinion', 'intl', 'exchange', 'close']) {
      const requiredLayer = required.includes(layer) || layer === 'exchange';
      const st = layerStatus(layer, meta.id, pools, sector);
      const effectiveOk = !requiredLayer ? true : st.ok;
      if (requiredLayer && st.ok) okN += 1;
      layers[layer] = { ...st, required: requiredLayer, label: LAYER_LABELS[layer] };
    }
    const reqTotal = required.length + 1;
    return {
      id: meta.id,
      name: meta.name,
      sector,
      sectorLabel: meta.sectorLabel,
      layers,
      coveragePct: Math.round((okN / reqTotal) * 100),
      gaps: Object.entries(layers)
        .filter(([k, v]) => v.required && !v.ok)
        .map(([k]) => LAYER_LABELS[k]),
    };
  });

  const summary = {
    version: COVERAGE_VERSION,
    symbolCount: rows.length,
    avgCoveragePct: Math.round(rows.reduce((s, r) => s + r.coveragePct, 0) / rows.length),
    fullCoverage: rows.filter((r) => r.gaps.length === 0).length,
    poolSizes: {
      flash: pools.flash.length,
      policy: pools.policy.length,
      opinion: pools.opinion.length,
      intl: (pools.intl || []).length,
      exchange: pools.exchange.length,
    },
    exchangeNotice: (() => {
      try {
        const { getCachedExchangeNoticeBundle } = require('./exchange-notice-fetcher');
        const { countExchangeHitsBySymbol } = require('./exchange-symbol-match');
        const bundle = getCachedExchangeNoticeBundle();
        if (!bundle?.stats) return null;
        const symIds = symbols.map((s) => s.id);
        const symHits = countExchangeHitsBySymbol(bundle.items || [], symIds);
        return {
          total: bundle.stats.total,
          direct: bundle.stats.direct,
          mirror: bundle.stats.mirror,
          byExchange: bundle.stats.byExchange,
          symbolHits: symHits.symbolHits,
          symbolTotal: symIds.length,
          symbolHitPct: symIds.length ? Math.round((symHits.symbolHits / symIds.length) * 100) : null,
          dcePortal: bundle.dcePortal || null,
          fetchedAt: bundle.fetchedAt || null,
          version: bundle.version || null,
        };
      } catch {
        return null;
      }
    })(),
    auditedAt: new Date().toISOString(),
  };

  return { summary, rows };
}

function persistCoverageAudit(result) {
  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    diskCache.write('news-coverage-audit.json', { data: result, savedAt: Date.now() });
  } catch {
    // ignore
  }
}

function readCachedCoverageAudit({ maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
  try {
    if (!diskCache.getRoot?.()) diskCache.init(getDataDir());
    const row = diskCache.readStale('news-coverage-audit.json');
    if (!row?.data?.summary) return null;
    const age = row.savedAt ? Date.now() - row.savedAt : Infinity;
    return { ...row.data, cached: true, cacheAgeMs: age, stale: age > maxAgeMs };
  } catch {
    return null;
  }
}

module.exports = {
  COVERAGE_VERSION,
  auditNewsCoverage,
  persistCoverageAudit,
  readCachedCoverageAudit,
  LAYER_LABELS,
};
