/**
 * 仓单 × 资金（持仓）多周期合证解读
 * 仓单禁止单独定多空；须与持仓同窗口对照。缺失标暂无，不编造。
 * horizon: 1w≈5 / 1m≈21 / 3m≈63 / 1y≈252 交易日行。
 */
const fs = require('fs');
const path = require('path');

const JOINT_VERSION = 'v1.56.22-stock-flow-joint';

const HORIZONS = Object.freeze([
  { key: '1w', label: '近1周', rows: 5, deadbandPct: 0.8 },
  { key: '1m', label: '近1月', rows: 21, deadbandPct: 1.2 },
  { key: '3m', label: '近3月', rows: 63, deadbandPct: 2.0 },
  { key: '1y', label: '近1年', rows: 252, deadbandPct: 4.0 },
]);

/** instrumentId → { bars, byDate } — 避免 walk-forward 每 bar 重读盘 */
const _oiSeriesCache = new Map();
/** `${id}|${asOf}` → joint 结果（同 bar 内 inventory+capital 共用） */
const _jointAtDateCache = new Map();
const JOINT_CACHE_MAX = 8000;

function signBucket(pct, deadband) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const v = Number(pct);
  if (Math.abs(v) <= deadband) return 'flat';
  return v > 0 ? 'up' : 'down';
}

function loadOiSeriesCached(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  if (!id) return null;
  if (_oiSeriesCache.has(id)) return _oiSeriesCache.get(id);
  let packed = null;
  try {
    const { getDataDir } = require('./data-paths');
    const dataDir = getDataDir() || path.join(process.cwd(), 'data');
    const candidates = [
      path.join(dataDir, 'history', 'trading', `${id}.json`),
      path.join(dataDir, 'history', 'trading', `${id.toUpperCase()}.json`),
    ];
    const fp = candidates.find((p) => fs.existsSync(p));
    if (!fp) {
      _oiSeriesCache.set(id, null);
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const series = Array.isArray(raw) ? raw : raw.series || [];
    const bars = series
      .map((b) => ({
        date: String(b.date || '').slice(0, 10),
        openInterest: Math.round(Number(b.openInterest ?? b.oi) || 0),
      }))
      .filter((b) => b.date && b.openInterest > 0);
    const byDate = new Map(bars.map((b, i) => [b.date, i]));
    packed = { bars, byDate };
  } catch {
    packed = null;
  }
  _oiSeriesCache.set(id, packed);
  return packed;
}

function getOiChgNdAtDate(instrumentId, barDate, lookbackRows = 5) {
  const id = String(instrumentId || '').toLowerCase();
  const n = Math.max(1, Math.min(320, Number(lookbackRows) || 5));
  const packed = loadOiSeriesCached(id);
  if (!packed?.bars?.length) return null;
  const bars = packed.bars;
  const d = String(barDate || '').slice(0, 10);
  let idx = packed.byDate.has(d) ? packed.byDate.get(d) : -1;
  if (idx < 0) {
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      if (bars[i].date <= d) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return null;
  const pastIdx = idx - n;
  if (pastIdx < 0) return null;
  const cur = bars[idx].openInterest;
  const past = bars[pastIdx].openInterest;
  if (!(cur > 0) || !(past > 0)) return null;
  const delta = cur - past;
  const pct = (delta / Math.max(past, 1)) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > 500) return null;
  return {
    pct: +pct.toFixed(4),
    delta,
    cur,
    past,
    pastDate: bars[pastIdx].date,
    asOfDate: bars[idx].date,
    lookbackRows: n,
  };
}

function classifyRegime(whDir, oiDir) {
  if (!whDir || !oiDir) return { code: 'insufficient', label: '仓单/资金缺一侧 · 暂不合证' };
  if (whDir === 'flat' && oiDir === 'flat') return { code: 'flat', label: '库存资金均持平' };
  if (whDir === 'flat' && oiDir === 'up') {
    return { code: 'flat_oi_up', label: '仓单持平+增仓', structureBias: 'mixed', note: '仓单未变、仅资金入场 · 待库存确认' };
  }
  if (whDir === 'flat' && oiDir === 'down') {
    return { code: 'flat_oi_down', label: '仓单持平+减仓', structureBias: 'mixed', note: '仓单未变、资金离场 · 待库存确认' };
  }
  if (whDir === 'down' && oiDir === 'up') {
    return { code: 'destock_oi_up', label: '去库+增仓', structureBias: 'bull', note: '紧库存叠加资金确认' };
  }
  if (whDir === 'up' && oiDir === 'up') {
    return { code: 'build_oi_up', label: '累库+增仓', structureBias: 'bear', note: '资金配合累库，供给压力可验证' };
  }
  if (whDir === 'down' && oiDir === 'down') {
    return {
      code: 'destock_oi_down',
      label: '去库+减仓',
      structureBias: 'mixed',
      note: '库存紧但资金离场 · 价格可能滞后',
    };
  }
  if (whDir === 'up' && oiDir === 'down') {
    return {
      code: 'build_oi_down',
      label: '累库+减仓',
      structureBias: 'mixed',
      note: '累库缺少资金确认 · 不宜单独看空',
    };
  }
  if (whDir === 'down') {
    return { code: 'destock_oi_flat', label: '去库·持仓持平', structureBias: 'mixed', note: '待资金确认' };
  }
  if (whDir === 'up') {
    return { code: 'build_oi_flat', label: '累库·持仓持平', structureBias: 'mixed', note: '待资金确认' };
  }
  return { code: 'oi_only', label: '仅持仓变化', structureBias: 'mixed', note: '仓单侧不足' };
}

function buildHorizonSlot(symbol, asOf, hz) {
  let wh = null;
  try {
    const whMod = require('./shfe-warehouse-fetcher');
    wh = whMod.getWarehouseReceiptChgNdAtDate?.(symbol, asOf, hz.rows);
  } catch {
    wh = null;
  }
  const oi = getOiChgNdAtDate(symbol, asOf, hz.rows);
  const whDir = signBucket(wh?.pct, hz.deadbandPct);
  const oiDir = signBucket(oi?.pct, hz.deadbandPct * 0.8);
  const regime = classifyRegime(whDir, oiDir);
  let oiStale = false;
  if (wh?.asOfDate && oi?.asOfDate) {
    const gap = (Date.parse(wh.asOfDate) - Date.parse(oi.asOfDate)) / 86400000;
    if (Number.isFinite(gap) && gap > 10) oiStale = true;
  }
  return {
    key: hz.key,
    label: hz.label,
    lookbackRows: hz.rows,
    warehousePct: wh?.pct ?? null,
    warehouseDelta: wh?.delta ?? null,
    warehousePastDate: wh?.pastDate ?? null,
    warehouseAsOf: wh?.asOfDate ?? null,
    oiPct: oi?.pct ?? null,
    oiDelta: oi?.delta ?? null,
    oiPastDate: oi?.pastDate ?? null,
    oiAsOf: oi?.asOfDate ?? null,
    oiStale,
    warehouseDir: whDir,
    oiDir,
    regime: regime.code,
    regimeLabel: oiStale ? `${regime.label}·持仓滞后` : regime.label,
    structureBias: regime.structureBias || null,
    note: oiStale
      ? `${regime.note || ''} · 持仓序列滞后于仓单日（>${10}日）`.trim()
      : regime.note || null,
    jointAvailable: Boolean(whDir && oiDir),
  };
}

function buildStockFlowJoint(symbol, asOfDate) {
  const id = String(symbol || '').toLowerCase();
  const asOf = String(asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!id) return { version: JOINT_VERSION, available: false, reason: 'missing_symbol' };

  const cacheKey = `${id}|${asOf}`;
  if (_jointAtDateCache.has(cacheKey)) return _jointAtDateCache.get(cacheKey);

  const horizons = {};
  for (const hz of HORIZONS) horizons[hz.key] = buildHorizonSlot(id, asOf, hz);

  // 归因：1m/1y 结构偏置 IC 优于 1w；优先有仓单方向的窗口
  const primaryKeys = ['1m', '1y', '3m', '1w'];
  const usable = primaryKeys
    .map((k) => horizons[k])
    .filter((h) => h && h.warehousePct != null && h.oiPct != null);

  let member = null;
  try {
    const feat = require('./member-oi-features').loadMemberOiFeatures(id);
    if (feat?.available) {
      member = {
        netSub: feat.netSub,
        buySub: feat.buySub,
        sellSub: feat.sellSub,
        tradeDate: feat.tradeDate,
        contractId: feat.contractId,
        dataSource: feat.dataSource,
      };
    }
  } catch {
    member = null;
  }

  if (!usable.length) {
    const insufficient = {
      version: JOINT_VERSION,
      available: false,
      reason: 'insufficient_horizon_pair',
      instrumentId: id,
      asOf,
      horizons,
      member,
      note: '仓单与持仓尚未在同一窗口对齐 · 暂不合证定调',
      dataSource: 'warehouse+trading-oi',
      method: 'stock-flow-joint',
    };
    if (_jointAtDateCache.size >= JOINT_CACHE_MAX) _jointAtDateCache.clear();
    _jointAtDateCache.set(cacheKey, insufficient);
    return insufficient;
  }

  // 归因：1m/1y 优先；有明确仓单方向的窗口优于「仓单持平仅持仓」
  const withWhDir = usable.find((h) => h.warehouseDir && h.warehouseDir !== 'flat');
  const primary = withWhDir || usable[0];
  const m1 = horizons['1m'];
  const m3 = horizons['3m'];
  let coherence = 'single';
  let structureBias = primary.structureBias || 'mixed';
  const pair = [m1, m3].filter((h) => h && h.structureBias && h.warehouseDir && h.warehouseDir !== 'flat');
  if (pair.length === 2) {
    if (pair[0].structureBias === pair[1].structureBias) coherence = '1m_3m_agree';
    else if (pair[0].structureBias === 'mixed' || pair[1].structureBias === 'mixed') coherence = 'partial';
    else coherence = '1m_3m_diverge';
    if (coherence === '1m_3m_agree') structureBias = pair[0].structureBias;
  } else if (m3?.structureBias && primary.key !== '3m' && m3.warehouseDir && m3.warehouseDir !== 'flat') {
    coherence = 'partial';
  }

  const supportsLong =
    structureBias === 'bull' &&
    (coherence === '1m_3m_agree' || coherence === 'single' || coherence === 'partial');
  const opposesLong =
    structureBias === 'bear' && (coherence === '1m_3m_agree' || coherence === 'single');

  const displayParts = [];
  for (const k of ['1w', '1m', '3m', '1y']) {
    const h = horizons[k];
    if (!h || (h.warehousePct == null && h.oiPct == null)) continue;
    const whTxt =
      h.warehousePct != null ? `仓${h.warehousePct > 0 ? '+' : ''}${h.warehousePct.toFixed(1)}%` : '仓—';
    const oiTxt = h.oiPct != null ? `资${h.oiPct > 0 ? '+' : ''}${h.oiPct.toFixed(1)}%` : '资—';
    displayParts.push(`${h.label}${whTxt}/${oiTxt}·${h.regimeLabel}`);
  }

  const result = {
    version: JOINT_VERSION,
    available: true,
    instrumentId: id,
    asOf,
    primaryHorizon: primary.key,
    primaryRegime: primary.regime,
    primaryLabel: primary.regimeLabel,
    structureBias,
    coherence,
    supportsLong,
    opposesLong,
    supportsShort: opposesLong,
    opposesShort: supportsLong,
    priceMayLag:
      structureBias === 'mixed' ||
      coherence === '1m_3m_diverge' ||
      primary.oiStale === true ||
      /减仓|待资金|滞后/.test(primary.note || ''),
    horizons,
    member,
    display: displayParts.slice(0, 3).join('；') || primary.regimeLabel,
    note: primary.note || null,
    dataSource: 'warehouse+trading-oi+member',
    method: 'stock-flow-joint',
  };
  if (_jointAtDateCache.size >= JOINT_CACHE_MAX) _jointAtDateCache.clear();
  _jointAtDateCache.set(cacheKey, result);
  return result;
}

module.exports = {
  JOINT_VERSION,
  HORIZONS,
  buildStockFlowJoint,
  getOiChgNdAtDate,
  classifyRegime,
  signBucket,
};
