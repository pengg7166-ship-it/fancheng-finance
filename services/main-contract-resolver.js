/**
 * 主力合约解析 '东方财富全市场合约列'+ 持仓'OI)优先、成交量次之'
 * 对齐无限易「M」标记主力，替代 delivery-calendar 固定换月偏移'
 */
const { fetchJson } = require('./http-client');
const diskCache = require('./disk-cache');
const { getCommodityMeta } = require('./commodities-catalog');
const { resolveDeliveryMonth, CONTRACT_MONTHS } = require('./delivery-calendar');
const { INSTRUMENT_REGISTRY } = require('./commodity-outlook-engine');

function deliveryMonthToYymm(deliveryMonth) {
  if (!deliveryMonth) return '';
  const parts = String(deliveryMonth).split('-');
  if (parts.length < 2) return '';
  return `${String(parts[0]).slice(-2)}${parts[1]}`;
}

function formatContractCode(instrumentId, yymm, exchangeId) {
  const id = String(instrumentId || '').toLowerCase();
  if (!yymm) return id;
  if (String(exchangeId || '').toLowerCase() === 'zce') {
    const mm = yymm.slice(2);
    const yearDigit = String(parseInt(yymm.slice(0, 2), 10) % 10);
    return `${String(getCommodityMeta(id)?.id || id).toUpperCase()}${yearDigit}${mm}`;
  }
  return `${id}${yymm}`;
}

const CACHE_KEY = 'main-contract-map.json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_STALE_MS = 24 * 60 * 60 * 1000;

/** Eastmoney clist fs 'exchangeId */
const EM_MARKETS = [
  { fs: 'm:113', exchangeId: 'shfe', secidPrefix: '113' },
  { fs: 'm:114', exchangeId: 'dce', secidPrefix: '114' },
  { fs: 'm:115', exchangeId: 'zce', secidPrefix: '115' },
  { fs: 'm:142', exchangeId: 'ine', secidPrefix: '142' },
  { fs: 'm:225', exchangeId: 'gfex', secidPrefix: '225' },
];

const CLIST_FIELDS = 'f12,f14,f47,f49';
const ENRICH_BATCH = 8;
const ENRICH_DELAY_MS = 80;

let refreshPromise = null;

function normDate(d) {
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return String(d || '').slice(0, 10);
}

function parseMetric(v) {
  if (v == null || v === '-' || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isContinuousContract(code, name) {
  const n = String(name || '');
  if (/主连|次主连|指数/.test(n)) return true;
  const c = String(code || '');
  if (/^[a-zA-Z]{1,4}[mMsS]$/.test(c) && !/\d/.test(c)) return true;
  if (/^[a-zA-Z]{2,4}s$/i.test(c) && !/\d/.test(c)) return true;
  return false;
}

/** ZCE: CF609 / TA609 'instrumentId + delivery YYYY-MM */
function parseZceContract(code) {
  const m = String(code || '').toUpperCase().match(/^([A-Z]+)(\d{3,4})$/);
  if (!m) return null;
  const suffix = m[2];
  let y;
  let mo;
  if (suffix.length === 3) {
    y = 2020 + parseInt(suffix[0], 10);
    mo = parseInt(suffix.slice(1), 10);
  } else {
    y = 2000 + parseInt(suffix.slice(0, 2), 10);
    mo = parseInt(suffix.slice(2), 10);
  }
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return { instrumentId: m[1], deliveryMonth: `${y}-${String(mo).padStart(2, '0')}` };
}

/** SHFE/DCE/INE/GFEX: au2608 / sc2609 'instrumentId + delivery */
function parseStandardContract(code) {
  const m = String(code || '').toLowerCase().match(/^([a-z]{1,3})(\d{4})$/);
  if (!m) return null;
  const y = 2000 + parseInt(m[2].slice(0, 2), 10);
  const mo = parseInt(m[2].slice(2), 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return { instrumentId: m[1], deliveryMonth: `${y}-${String(mo).padStart(2, '0')}` };
}

function parseContractRow(code, exchangeId) {
  if (exchangeId === 'zce') return parseZceContract(code);
  return parseStandardContract(code);
}

function toInfinitraderCode(contractCode, exchangeId) {
  const code = String(contractCode || '').trim();
  if (!code) return null;
  if (exchangeId === 'zce') return code.toUpperCase();
  return code.toLowerCase();
}

function rankScore(oi, vol) {
  return oi * 1_000_000 + vol;
}

function pickBestCandidate(candidates) {
  if (!candidates?.length) return null;
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const score = rankScore(c.oi || 0, c.vol || 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}

async function fetchEastmoneyClist(fs) {
  const rows = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total && page <= 10) {
    const url =
      `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=100&po=1&np=1` +
      `&fltt=2&invt=2&fid=f49&fs=${encodeURIComponent(fs)}&fields=${CLIST_FIELDS}`;
    const raw = await fetchJson(url, { timeout: 25000, retries: 2 });
    const diff = raw?.data?.diff || [];
    total = Number(raw?.data?.total) || diff.length;
    rows.push(...diff);
    if (!diff.length) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 100));
  }
  return rows;
}

async function fetchContractMetrics(secidPrefix, contractCode) {
  const secid = `${secidPrefix}.${String(contractCode).toUpperCase()}`;
  const url =
    `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}` +
    '&fields=f47,f49,f57,f58';
  try {
    const raw = await fetchJson(url, { timeout: 15000, retries: 1 });
    const d = raw?.data;
    if (!d) return null;
    return {
      contractCode: String(d.f57 || contractCode),
      name: d.f58 || null,
      oi: parseMetric(d.f49),
      vol: parseMetric(d.f47),
    };
  } catch {
    return null;
  }
}

function deliveryMonthToZceCode(instrumentId, deliveryMonth) {
  const parts = String(deliveryMonth || '').split('-');
  if (parts.length < 2) return null;
  const y = parseInt(parts[0], 10);
  const mo = parts[1];
  if (!Number.isFinite(y)) return null;
  return `${String(instrumentId).toUpperCase()}${y % 10}${mo}`;
}

function lookupSector(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
  return spec?.sector || 'agriculture';
}

function candidateMonthsForInstrument(instrumentId, asOfDate) {
  const id = String(instrumentId || '').toLowerCase();
  const sector = lookupSector(id);
  const months = CONTRACT_MONTHS[id] || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const asOf = normDate(asOfDate || new Date());
  const picks = new Set();
  for (let offset = 0; offset <= 4; offset += 1) {
    const d = new Date(`${asOf}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + offset);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth() + 1;
    let pick = months.find((mo) => mo >= m);
    if (pick == null) {
      y += 1;
      pick = months[0];
    }
    picks.add(`${y}-${String(pick).padStart(2, '0')}`);
  }
  const delivery = resolveDeliveryMonth(asOf, sector, id);
  if (delivery) picks.add(delivery);
  return [...picks];
}

function buildCandidateCodes(instrumentId, exchangeId, asOfDate) {
  const id = String(instrumentId || '').toLowerCase();
  const meta = getCommodityMeta(id);
  const ex = exchangeId || meta?.exchangeId || 'shfe';
  const months = candidateMonthsForInstrument(id, asOfDate);
  const codes = [];
  for (const dm of months) {
    if (ex === 'zce') {
      const zce = deliveryMonthToZceCode(meta?.id || id, dm);
      if (zce) codes.push(zce);
    } else {
      const yymm = deliveryMonthToYymm(dm);
      if (yymm) codes.push(formatContractCode(id, yymm, ex));
    }
  }
  return [...new Set(codes)];
}

async function enrichInstrumentCandidates(instrumentId, exchangeId, secidPrefix, candidates) {
  const out = [];
  for (let i = 0; i < candidates.length; i += ENRICH_BATCH) {
    const batch = candidates.slice(i, i + ENRICH_BATCH);
    const rows = await Promise.all(
      batch.map((code) => fetchContractMetrics(secidPrefix, code)),
    );
    for (const row of rows) {
      if (!row) continue;
      const parsed = parseContractRow(row.contractCode, exchangeId);
      if (!parsed) continue;
      out.push({
        instrumentId: parsed.instrumentId.toLowerCase(),
        contractCode: row.contractCode,
        deliveryMonth: parsed.deliveryMonth,
        oi: row.oi,
        vol: row.vol,
        source: 'eastmoney_quote',
      });
    }
    if (i + ENRICH_BATCH < candidates.length) {
      await new Promise((r) => setTimeout(r, ENRICH_DELAY_MS));
    }
  }
  return out.filter((r) => String(r.instrumentId).toLowerCase() === String(instrumentId).toLowerCase());
}

function buildMapFromClistRows(allRows) {
  /** @type {Map<string, object[]>} */
  const byInstrument = new Map();

  for (const row of allRows) {
    const code = row.f12;
    const name = row.f14;
    if (!code || isContinuousContract(code, name)) continue;

    const exchangeId = row._exchangeId;
    const parsed = parseContractRow(code, exchangeId);
    if (!parsed) continue;

    const instKey = parsed.instrumentId.toLowerCase();
    const oi = parseMetric(row.f49);
    const vol = parseMetric(row.f47);
    const entry = {
      instrumentId: instKey,
      contractCode: String(code),
      deliveryMonth: parsed.deliveryMonth,
      oi,
      vol,
      source: 'eastmoney_clist',
      exchangeId,
      secidPrefix: row._secidPrefix,
    };

    if (!byInstrument.has(instKey)) byInstrument.set(instKey, []);
    byInstrument.get(instKey).push(entry);
  }

  return byInstrument;
}

async function buildMainContractMap() {
  const allRows = [];
  for (const market of EM_MARKETS) {
    const diff = await fetchEastmoneyClist(market.fs);
    for (const row of diff) {
      allRows.push({ ...row, _exchangeId: market.exchangeId, _secidPrefix: market.secidPrefix });
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const grouped = buildMapFromClistRows(allRows);
  const contracts = {};
  const needsEnrich = [];

  for (const [instKey, rows] of grouped.entries()) {
    const best = pickBestCandidate(rows);
    if (best) {
      const meta = getCommodityMeta(instKey);
      contracts[instKey] = {
        instrumentId: instKey,
        contractCode: best.contractCode,
        infinitraderSymbol: toInfinitraderCode(best.contractCode, meta?.exchangeId || best.exchangeId),
        deliveryMonth: best.deliveryMonth,
        openInterest: best.oi,
        volume: best.vol,
        isMainContract: true,
        contractSource: 'eastmoney_oi',
      };
    } else {
      needsEnrich.push({
        instKey,
        exchangeId: rows[0]?.exchangeId || getCommodityMeta(instKey)?.exchangeId,
        secidPrefix: rows[0]?.secidPrefix,
      });
    }
  }

  const asOfDate = normDate(new Date());
  for (const item of needsEnrich) {
    const meta = getCommodityMeta(item.instKey);
    const market = EM_MARKETS.find((m) => m.exchangeId === (item.exchangeId || meta?.exchangeId))
      || (meta?.exchangeId === 'ine' ? EM_MARKETS.find((m) => m.fs === 'm:142') : null)
      || (meta?.exchangeId === 'gfex' ? EM_MARKETS.find((m) => m.fs === 'm:225') : null);
    if (!market) continue;
    const codes = buildCandidateCodes(item.instKey, meta?.exchangeId || item.exchangeId, asOfDate);
    const enriched = await enrichInstrumentCandidates(
      item.instKey,
      meta?.exchangeId || item.exchangeId,
      market.secidPrefix,
      codes,
    );
    const best = pickBestCandidate(enriched);
    if (best) {
      contracts[item.instKey] = {
        instrumentId: item.instKey,
        contractCode: best.contractCode,
        infinitraderSymbol: toInfinitraderCode(best.contractCode, meta?.exchangeId || item.exchangeId),
        deliveryMonth: best.deliveryMonth,
        openInterest: best.oi,
        volume: best.vol,
        isMainContract: true,
        contractSource: 'eastmoney_oi',
      };
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    contractCount: Object.keys(contracts).length,
    contracts,
  };
}

function readCachedMap(maxAgeMs = CACHE_TTL_MS) {
  const stored = diskCache.read(CACHE_KEY, maxAgeMs);
  if (stored?.data?.contracts) return stored.data;
  const stale = diskCache.read(CACHE_KEY, CACHE_STALE_MS) || diskCache.readStale(CACHE_KEY);
  return stale?.data?.contracts ? stale.data : null;
}

function getMainContractSync(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  const map = readCachedMap(CACHE_STALE_MS);
  return map?.contracts?.[id] || null;
}

async function ensureMainContractMap({ force = false } = {}) {
  if (!force) {
    const fresh = readCachedMap(CACHE_TTL_MS);
    if (fresh?.contracts && Object.keys(fresh.contracts).length > 20) return fresh;
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = buildMainContractMap()
    .then((data) => {
      diskCache.write(CACHE_KEY, { data });
      return data;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * Resolve main contract for forward export / 无限'
 * Falls back to delivery-calendar only when ALLOW_DELIVERY_CALENDAR_FALLBACK=1.
 */
async function resolveMainContract(instrumentId, asOfDate, opts = {}) {
  const id = String(instrumentId || '').toLowerCase();
  let map = readCachedMap(CACHE_TTL_MS);
  if (!map?.contracts?.[id]) {
    map = await ensureMainContractMap({ force: opts.force === true });
  }

  let main = map?.contracts?.[id];
  if (!main && opts.enrich !== false) {
    const meta = getCommodityMeta(id);
    if (meta) {
      const market = EM_MARKETS.find((m) => m.exchangeId === meta.exchangeId)
        || (meta.exchangeId === 'ine' ? EM_MARKETS.find((m) => m.fs === 'm:142') : null)
        || (meta.exchangeId === 'gfex' ? EM_MARKETS.find((m) => m.fs === 'm:225') : null);
      if (market) {
        const codes = buildCandidateCodes(id, meta.exchangeId, asOfDate);
        const enriched = await enrichInstrumentCandidates(id, meta.exchangeId, market.secidPrefix, codes);
        const best = pickBestCandidate(enriched);
        if (best) {
          main = {
            instrumentId: id,
            contractCode: best.contractCode,
            infinitraderSymbol: toInfinitraderCode(best.contractCode, meta.exchangeId),
            deliveryMonth: best.deliveryMonth,
            openInterest: best.oi,
            volume: best.vol,
            isMainContract: true,
            contractSource: 'eastmoney_oi',
          };
        }
      }
    }
  }

  if (main) return main;

  if (process.env.ALLOW_DELIVERY_CALENDAR_FALLBACK === '1') {
    const meta = getCommodityMeta(id);
    const deliveryMonth = resolveDeliveryMonth(normDate(asOfDate), meta?.sector || 'agriculture', id);
    const yymm = deliveryMonthToYymm(deliveryMonth);
    const contractCode = formatContractCode(id, yymm, meta?.exchangeId);
    return {
      instrumentId: id,
      contractCode,
      infinitraderSymbol: toInfinitraderCode(contractCode, meta?.exchangeId),
      deliveryMonth,
      isMainContract: false,
      contractSource: 'delivery_calendar_fallback',
    };
  }

  return null;
}

module.exports = {
  ensureMainContractMap,
  getMainContractSync,
  resolveMainContract,
  buildMainContractMap,
  parseContractRow,
  isContinuousContract,
  toInfinitraderCode,
};
