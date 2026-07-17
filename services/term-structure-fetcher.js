/**
 * P0 期限结构 '主力连续（trading JSON）vs 远月合约（Sina 单合'K 线）
 * 落盘: {dataDir}/history/term-structure/{id}-daily.json
 * 消费: market-regime-classifier · commodity-outlook-backtest flatRow
 */
const fs = require('fs');
const path = require('path');
const { fetchJson } = require('./http-client');
const { getDataDir } = require('./data-paths');

const DEFAULT_START = '2019-01-01';
const OUT_SUBDIR = 'term-structure';
/** 关注池主品种期限结构（真实近月 vs 远月）；缺 trading 序列的会 insufficient，不假填 */
const P0_INSTRUMENTS = [
  'au', 'ag', 'sc', 'cu', 'al', 'zn', 'pb', 'ni', 'sn', 'rb', 'hc',
  'i', 'jm', 'm', 'y', 'p', 'ta', 'ma', 'fg', 'ru', 'fu', 'si', 'lc',
  'ao', 'eg', 'cf', 'sr', 'oi', 'rm', 'jd', 'lh', 'sa', 'nr', 'br',
];
const FAR_MONTH_OFFSET = 3;
const ZSCORE_WINDOW = 60;
const ZSCORE_MIN_SAMPLES = 20;

const CONTRACT_MONTHS = {
  cu: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  al: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  zn: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  pb: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ni: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  sn: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  au: [2, 4, 6, 8, 10, 12],
  ag: [2, 4, 6, 8, 10, 12],
  sc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  rb: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  hc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  i: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  jm: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  m: [1, 3, 5, 7, 8, 9, 11],
  y: [1, 3, 5, 7, 8, 9, 11],
  p: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ta: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ma: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  fg: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ru: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  fu: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  si: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  lc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ao: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  eg: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  cf: [1, 3, 5, 7, 9, 11],
  sr: [1, 3, 5, 7, 9, 11],
  oi: [1, 3, 5, 7, 9, 11],
  rm: [1, 3, 5, 7, 8, 9, 11],
  jd: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  lh: [1, 3, 5, 7, 9, 11],
  sa: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  nr: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  br: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn/futures/quotes/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const _sinaCache = new Map();
const _termRowCache = new Map();

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function outPath(instrumentId) {
  return path.join(getHistoryDir(), OUT_SUBDIR, `${String(instrumentId).toLowerCase()}-daily.json`);
}

function loadTradingNearSeries(instrumentId) {
  const fp = path.join(getHistoryDir(), 'trading', `${String(instrumentId).toLowerCase()}.json`);
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const series = Array.isArray(raw) ? raw : raw.series || raw.klines || [];
    return series
      .map((r) => ({
        date: normDate(r.date || r.time),
        close: Number(r.close ?? r.price ?? 0),
      }))
      .filter((b) => b.date >= DEFAULT_START && b.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function pickFarContractSymbol(instrumentId, dateStr) {
  const id = String(instrumentId).toLowerCase();
  const months = CONTRACT_MONTHS[id] || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const d = new Date(`${normDate(dateStr)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  const target = new Date(d);
  target.setUTCMonth(target.getUTCMonth() + FAR_MONTH_OFFSET);
  let y = target.getUTCFullYear();
  let m = target.getUTCMonth() + 1;

  let pickMonth = months.find((mo) => mo >= m);
  if (pickMonth == null) {
    y += 1;
    pickMonth = months[0];
  }

  const prefix = id.toUpperCase();
  const yy = String(y).slice(-2);
  const mm = String(pickMonth).padStart(2, '0');
  return `${prefix}${yy}${mm}`;
}

async function fetchSinaContractSeries(symbol) {
  const key = String(symbol).toUpperCase();
  if (_sinaCache.has(key)) return _sinaCache.get(key);

  const url = `https://stock2.finance.sina.com.cn/futures/api/json.php/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(key)}`;
  let rows = [];
  try {
    const raw = await fetchJson(url, { headers: SINA_HEADERS, timeout: 45000, retries: 2 });
    if (Array.isArray(raw)) {
      rows = raw
        .map((r) => ({
          date: normDate(r.d),
          close: Number(r.c),
        }))
        .filter((b) => b.date && b.close > 0);
    }
  } catch {
    rows = [];
  }

  const byDate = new Map(rows.map((r) => [r.date, r.close]));
  _sinaCache.set(key, byDate);
  return byDate;
}

function classifyStructure(spreadPct) {
  if (spreadPct == null || Number.isNaN(spreadPct)) return 'flat';
  if (spreadPct > 0.05) return 'backwardation';
  if (spreadPct < -0.05) return 'contango';
  return 'flat';
}

function computeRollingZScores(values, window = ZSCORE_WINDOW, minSamples = ZSCORE_MIN_SAMPLES) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) continue;
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1).filter((x) => x != null && !Number.isNaN(x));
    if (slice.length < minSamples) continue;
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    out[i] = std > 1e-9 ? (v - mean) / std : 0;
  }
  return out;
}

async function buildTermStructureSeries(instrumentId, { startDate = DEFAULT_START } = {}) {
  const id = String(instrumentId).toLowerCase();
  const nearSeries = loadTradingNearSeries(id).filter((b) => b.date >= startDate);
  if (nearSeries.length < 30) {
    return { instrumentId: id, rows: [], error: `trading 近月序列不足 (${nearSeries.length})` };
  }

  const farSymbols = new Set(nearSeries.map((b) => pickFarContractSymbol(id, b.date)).filter(Boolean));
  const farMaps = {};
  for (const sym of farSymbols) {
    farMaps[sym] = await fetchSinaContractSeries(sym);
    await new Promise((r) => setTimeout(r, 150));
  }

  const draft = [];
  for (const near of nearSeries) {
    const farContract = pickFarContractSymbol(id, near.date);
    if (!farContract) continue;
    const farClose = farMaps[farContract]?.get(near.date);
    if (farClose == null || farClose <= 0) continue;

    const spread = near.close - farClose;
    const spreadPct = (spread / near.close) * 100;
    draft.push({
      date: near.date,
      instrument_id: id,
      near_contract: `${id.toUpperCase()}M`,
      far_contract: farContract,
      near_close: +near.close.toFixed(4),
      far_close: +farClose.toFixed(4),
      spread_near_far: +spread.toFixed(4),
      spread_pct: +spreadPct.toFixed(4),
      structure_regime: classifyStructure(spreadPct),
      source: 'trading_json+sina',
    });
  }

  const spreadPcts = draft.map((r) => r.spread_pct);
  const zScores = computeRollingZScores(spreadPcts);
  const rows = draft.map((r, i) => ({
    ...r,
    z_score: zScores[i] != null ? +zScores[i].toFixed(4) : null,
    zScore: zScores[i] != null ? +zScores[i].toFixed(4) : null,
  }));

  return {
    instrumentId: id,
    rows,
    farSymbols: [...farSymbols],
    nearRows: nearSeries.length,
    alignedRows: rows.length,
  };
}

function saveTermStructureFile(instrumentId, rows, meta = {}) {
  const fp = outPath(instrumentId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const payload = {
    instrumentId: String(instrumentId).toLowerCase(),
    label: `${String(instrumentId).toUpperCase()} 近远月价差`,
    freq: 'daily',
    source: 'trading_json+sina',
    updated: new Date().toISOString(),
    startDate: rows.length ? rows[0].date : null,
    endDate: rows.length ? rows[rows.length - 1].date : null,
    rowCount: rows.length,
    schema: {
      date: 'YYYY-MM-DD',
      spread_near_far: '近月-远月价差（元',
      spread_pct: '价差/近月%',
      z_score: 'spread_pct 60d z',
      structure_regime: 'backwardation|contango|flat',
    },
    ...meta,
    data: rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  _termRowCache.delete(String(instrumentId).toLowerCase());
  return fp;
}

async function fetchAndSaveTermStructure(options = {}) {
  const ids = options.instruments || P0_INSTRUMENTS;
  const force = Boolean(options.force);
  const startDate = options.startDate || DEFAULT_START;
  const results = [];

  for (const id of ids) {
    const fp = outPath(id);
    if (!force && fs.existsSync(fp)) {
      try {
        const existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if ((existing.rowCount || existing.data?.length || 0) >= 30) {
          results.push({
            instrumentId: id,
            status: 'skipped',
            file: fp,
            rowCount: existing.rowCount || existing.data?.length || 0,
          });
          continue;
        }
      } catch {
        // rebuild
      }
    }

    const built = await buildTermStructureSeries(id, { startDate });
    if (built.rows.length < 20) {
      results.push({
        instrumentId: id,
        status: 'insufficient',
        error: built.error || `对齐行不'(${built.alignedRows || 0}/${built.nearRows || 0})`,
        farSymbols: built.farSymbols,
      });
      continue;
    }

    const file = saveTermStructureFile(id, built.rows, {
      farSymbols: built.farSymbols,
      nearRows: built.nearRows,
    });
    results.push({
      instrumentId: id,
      status: 'ok',
      file,
      rowCount: built.rows.length,
      startDate: built.rows[0].date,
      endDate: built.rows[built.rows.length - 1].date,
      farSymbols: built.farSymbols,
    });
  }

  return { results, instruments: ids };
}

function loadTermStructureRows(instrumentId) {
  const id = String(instrumentId).toLowerCase();
  if (_termRowCache.has(id)) return _termRowCache.get(id);

  const fp = outPath(id);
  if (!fs.existsSync(fp)) {
    _termRowCache.set(id, null);
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || raw.series || [];
    _termRowCache.set(id, rows);
    return rows;
  } catch {
    _termRowCache.set(id, null);
    return null;
  }
}

function getTermStructureAtDate(instrumentId, barDate) {
  const rows = loadTermStructureRows(instrumentId);
  if (!rows?.length) return null;
  const d = normDate(barDate);
  const row = rows.find((r) => normDate(r.date || r.barDate) === d);
  if (!row) return null;

  const spread = row.spread_near_far ?? row.spreadPct ?? row.spread;
  const spreadPct = row.spread_pct ?? row.spreadPct ?? null;
  const zScore = row.z_score ?? row.zScore ?? null;

  return {
    date: d,
    instrumentId: String(instrumentId).toLowerCase(),
    nearContract: row.near_contract || null,
    farContract: row.far_contract || null,
    nearClose: row.near_close ?? null,
    farClose: row.far_close ?? null,
    spreadNearFar: spread != null ? Number(spread) : null,
    spreadPct: spreadPct != null ? Number(spreadPct) : null,
    zScore: zScore != null ? Number(zScore) : null,
    structureRegime: row.structure_regime || classifyStructure(spreadPct),
    source: row.source || 'term_structure',
  };
}

/** spread_pct 5 日绝对变化（'real10y_chg_5d 同口径） */
function getTermStructureChg5dAtDate(instrumentId, barDate) {
  const id = String(instrumentId).toLowerCase();
  if (!P0_INSTRUMENTS.includes(id)) return null;

  const rows = loadTermStructureRows(id);
  if (!rows?.length) return null;

  const d = normDate(barDate);
  const idx = rows.findIndex((r) => normDate(r.date || r.barDate) === d);
  if (idx < 0) return null;

  const cur = rows[idx].spread_pct ?? rows[idx].spreadPct;
  if (cur == null) return null;

  const pastIdx = idx - 5;
  if (pastIdx < 0) return null;

  const past = rows[pastIdx].spread_pct ?? rows[pastIdx].spreadPct;
  if (past == null) return null;

  return +(Number(cur) - Number(past)).toFixed(4);
}

module.exports = {
  DEFAULT_START,
  OUT_SUBDIR,
  P0_INSTRUMENTS,
  pickFarContractSymbol,
  buildTermStructureSeries,
  fetchAndSaveTermStructure,
  saveTermStructureFile,
  loadTermStructureRows,
  getTermStructureAtDate,
  getTermStructureChg5dAtDate,
};
