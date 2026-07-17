/**

 * L1 市场 regime 分类—五态骨架（v1.34'
 * trend | range | event | seasonal | basis

 */

const fs = require('fs');

const path = require('path');

const {
  analyzeTrendStructure,
  computeTrendStrengthProxy,
} = require('./trend-structure-analyzer');

const { computeOiBehaviorAtBar } = require('./oi-behavior-features');

const { getDataDir } = require('./data-paths');
const { shouldSkipOiProxy } = require('./basis-regime-overrides');



const REGIME_VERSION = 'v1.34.2';



const REGIME_IDS = ['trend', 'range', 'event', 'seasonal', 'basis'];



const REGIME_LABELS = {

  trend: '趋势',

  range: '震荡',

  event: '高波动事件市',

  seasonal: '季节性主导市',

  basis: '基差修复',

};



/** 农产品季节性窗口（'日，北半球） */

const SEASONAL_WINDOWS = [

  { id: 'planting', start: '03-15', end: '05-31', sectors: ['agriculture'] },

  { id: 'harvest', start: '09-01', end: '11-30', sectors: ['agriculture'] },

];



/** 无期限结构数据时 OI+价格背离代理窗口 */

const BASIS_PROXY_LOOKBACK = 5;

const BASIS_Z_THRESHOLD = 2;

const BASIS_PROXY_RATIO_THRESHOLD = 0.4;

/** A5 实验：AG 仅允'term_structure 进入 basis 桶（禁用 oi_proxy fallback'*/
function agBasisDisableOiProxy() {
  const v = process.env.AG_BASIS_DISABLE_OI_PROXY;
  return v === '1' || v === 'true';
}

/** Experiment #1：AG OI-proxy 部分收紧（term 有数据但 |z|<2 时不 OI 代理；禁用单'proxy'*/
function agBasisStrictOiProxy() {
  const v = process.env.AG_BASIS_STRICT_OI_PROXY;
  return v === '1' || v === 'true';
}

function isAgBlockedOiProxyBasis(instrumentId, basisSignal, barDate) {
  const isAg = String(instrumentId || '').toLowerCase() === 'ag';
  if (!isAg || !basisSignal) return false;
  if (shouldSkipOiProxy(instrumentId, barDate)) return true;
  const fromTerm = basisSignal.source === 'term_structure';
  if (agBasisDisableOiProxy()) return !fromTerm;
  if (!agBasisStrictOiProxy()) return false;
  if (fromTerm) return false;
  if (basisSignal.source === 'oi_price_proxy_single') return true;
  const ts = loadTermStructureForDate(instrumentId, barDate);
  return ts != null;
}

const _termStructureCache = new Map();



function parseMonthDay(dateStr) {

  if (!dateStr || dateStr.length < 10) return null;

  return dateStr.slice(5, 10);

}



function inSeasonalWindow(barDate, sector) {

  const md = parseMonthDay(barDate);

  if (!md) return false;

  return SEASONAL_WINDOWS.some(

    (w) => w.sectors.includes(sector) && md >= w.start && md <= w.end,

  );

}



function loadTermStructureForDate(instrumentId, barDate) {

  if (!instrumentId || !barDate) return null;

  const id = String(instrumentId).toLowerCase();

  const cacheKey = id;

  if (!_termStructureCache.has(cacheKey)) {

    const dataDir = getDataDir();

    if (!dataDir) {

      _termStructureCache.set(cacheKey, null);

      return null;

    }

    const fp = path.join(dataDir, 'history', 'term-structure', `${id}-daily.json`);

    if (!fs.existsSync(fp)) {

      _termStructureCache.set(cacheKey, null);

      return null;

    }

    try {

      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));

      const rows = Array.isArray(raw) ? raw : raw.series || raw.data || [];

      _termStructureCache.set(cacheKey, rows);

    } catch {

      _termStructureCache.set(cacheKey, null);

      return null;

    }

  }

  const rows = _termStructureCache.get(cacheKey);

  if (!rows?.length) return null;

  const d = String(barDate).slice(0, 10);

  const row = rows.find((r) => String(r.date || r.barDate).slice(0, 10) === d);

  if (!row) return null;

  const spread = row.spread_near_far ?? row.spreadPct ?? row.spread;

  const zScore = row.z_score ?? row.zScore ?? null;

  if (zScore != null) return { spreadPct: spread, zScore: Number(zScore), source: 'term_structure' };

  if (spread == null) return null;

  return { spreadPct: Number(spread), zScore: null, source: 'term_structure' };

}



/**

 * OI+价格背离代理：增仓下'/ 减仓上涨 频次 —zScore

 * 期限结构 stub 未就绪时用于 basis_repair 检'
 */

function computeBasisRepairProxy(bars, barIndex, lookback = BASIS_PROXY_LOOKBACK) {

  if (!Array.isArray(bars) || barIndex < 1) return null;



  const start = Math.max(1, barIndex - lookback + 1);

  let divergenceDays = 0;

  let windowDays = 0;



  for (let i = start; i <= barIndex; i += 1) {

    windowDays += 1;

    const beh = computeOiBehaviorAtBar(bars, i);

    if (beh.behavior_tag === '增仓下跌' || beh.behavior_tag === '减仓上涨') {

      divergenceDays += 1;

    }

  }



  if (windowDays === 0) return null;

  const ratio = divergenceDays / windowDays;

  if (ratio < BASIS_PROXY_RATIO_THRESHOLD) return null;



  const zScore = ratio >= 0.6 ? 2.2 : ratio >= 0.5 ? 2.0 : 1.8;

  return {

    zScore,

    divergenceDays,

    windowDays,

    ratio: +ratio.toFixed(3),

    source: 'oi_price_proxy',

  };

}



/**

 * 合并真实基差'OI 代理；优'term-structure，缺失时'proxy

 */

function resolveBasisSignal(ctx = {}) {

  const { basis, bars, barIndex, instrumentId, barDate, oiBehavior } = ctx;



  if (basis?.zScore != null && Math.abs(basis.zScore) >= BASIS_Z_THRESHOLD) {

    return { ...basis, source: basis.source || 'explicit' };

  }



  const ts = loadTermStructureForDate(instrumentId, barDate);

  if (ts?.zScore != null && Math.abs(ts.zScore) >= BASIS_Z_THRESHOLD) {

    return ts;

  }



  const oiBeh = oiBehavior || (bars && barIndex != null ? computeOiBehaviorAtBar(bars, barIndex) : null);

  if (oiBeh?.behavior_tag && (oiBeh.price_down_oi_up || oiBeh.price_up_oi_down)) {

    const singleDay = { zScore: 2.0, divergenceDays: 1, windowDays: 1, source: 'oi_price_proxy_single' };

    if (Math.abs(singleDay.zScore) >= BASIS_Z_THRESHOLD) return singleDay;

  }



  const proxy = bars && barIndex != null ? computeBasisRepairProxy(bars, barIndex) : null;

  if (proxy?.zScore != null && Math.abs(proxy.zScore) >= BASIS_Z_THRESHOLD) return proxy;



  return ts || proxy || basis || null;

}



/**

 * @param {object} ctx

 * @param {string} ctx.barDate

 * @param {string} [ctx.sector]

 * @param {string} [ctx.instrumentId]

 * @param {number} [ctx.barIndex]

 * @param {Array} [ctx.klines]

 * @param {Array} [ctx.bars] '全量 bars（basis 代理'
 * @param {object} [ctx.technical] 'commodity-technical-analyzer 输出

 * @param {object} [ctx.newsImpact] '{ shock, hitCount, archetype }

 * @param {object} [ctx.basis] '{ spreadPct, zScore } Phase 1 数据就绪后填'
 * @param {object} [ctx.oiBehavior] 'computeOiBehaviorAtBar 输出

 */

function classifyMarketRegime(ctx = {}) {

  const {

    barDate,

    sector = 'unknown',

    instrumentId,

    barIndex,

    klines = [],

    bars = klines,

    technical = {},

    newsImpact = {},

    basis = null,

    oiBehavior = technical.oiBehavior,

  } = ctx;



  const reasons = [];

  let regime = 'range';



  const volRegime = technical.smoothedVol?.regime || technical.volRegime;

  const shock = newsImpact.shock ?? 0;

  const archetype = newsImpact.archetype || newsImpact.newsArchetype;

  const isShockDay =

    shock >= 0.35 || archetype === 'shock_event' || (newsImpact.hitCount ?? 0) > 0;



  const basisSignal = resolveBasisSignal({

    basis,

    bars,

    barIndex,

    instrumentId,

    barDate,

    oiBehavior,

  });



  if (isShockDay && volRegime === 'high') {

    regime = 'event';

    reasons.push('shock_event+high_vol');

  } else {

    const wouldBeBasis =

      basisSignal?.zScore != null && Math.abs(basisSignal.zScore) >= BASIS_Z_THRESHOLD;

    const isAg = String(instrumentId || '').toLowerCase() === 'ag';

    const basisFromTermOnly = basisSignal?.source === 'term_structure';

    const agOiProxyBlocked = isAgBlockedOiProxyBasis(instrumentId, basisSignal, barDate);



    if (wouldBeBasis && !agOiProxyBlocked) {

      regime = 'basis';

      reasons.push(basisFromTermOnly ? 'basis_z>=2' : 'basis_repair_oi_proxy');

    } else if (inSeasonalWindow(barDate, sector)) {

      regime = 'seasonal';

      reasons.push('seasonal_window');

      if (agOiProxyBlocked) reasons.push('ag_basis_oi_proxy_blocked');

    } else {

      if (agOiProxyBlocked) reasons.push('ag_basis_oi_proxy_blocked');

      const ts = klines.length ? analyzeTrendStructure(klines, 'medium') : null;

      const adxProxy =
        technical.adx ??
        technical.trendStrength ??
        (klines.length ? computeTrendStrengthProxy(klines) : null);

      const lowVol = volRegime === 'low';
      const maMixed =
        technical.maStack?.alignment === 'mixed' ||
        technical.maStack?.alignmentLabel === '均线交织';

      if (
        ts?.ok &&
        (ts.stepBias?.includes('bull') || ts.stepBias?.includes('bear')) &&
        ts.trendPhase !== 'consolidation'
      ) {
        regime = 'trend';
        reasons.push('step_structure');
      } else if (lowVol || (adxProxy != null && adxProxy < 20)) {
        regime = 'range';
        reasons.push('low_vol_or_adx');
      } else if (ts?.trendPhase === 'consolidation') {
        regime = 'range';
        reasons.push('consolidation');
      } else if (maMixed && Math.abs(Number(technical.techScore ?? 0)) < 0.22) {
        regime = 'range';
        reasons.push('ma_mixed_weak');
      } else {
        regime = 'trend';
        reasons.push('default_momentum');
      }

    }

  }



  return {

    regime,

    regimeLabel: REGIME_LABELS[regime] || regime,

    reasons,

    basisSignal: basisSignal

      ? {

          source: basisSignal.source,

          zScore: basisSignal.zScore ?? null,

          divergenceDays: basisSignal.divergenceDays ?? null,

        }

      : null,

    version: REGIME_VERSION,

  };

}



module.exports = {

  REGIME_VERSION,

  REGIME_IDS,

  REGIME_LABELS,

  SEASONAL_WINDOWS,

  BASIS_Z_THRESHOLD,

  computeBasisRepairProxy,

  resolveBasisSignal,

  agBasisDisableOiProxy,

  agBasisStrictOiProxy,

  isAgBlockedOiProxyBasis,

  classifyMarketRegime,

};

