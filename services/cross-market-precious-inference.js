/**

 * 跨境贵金属传导推—COMEX + 伦敦现货 '上期所 au/ag 点位

 *

 * 预测目标：相对前一'**收盘'* 的点位变动（——千克），非结算价'
 * AU：伦敦金（溢价锚' COMEX GC 隔夜变动（回退单序列）+ 离岸 CNH

 * AG：伦敦银（溢价锚' COMEX SI 隔夜变动（回退单序列；不再用金价代理）+ 离岸 CNH
 *
 * **生产汇率口径（用户决'2026-06-13 · 用离岸）**：跨境传导默'
 * `cnh-midrate-daily.json`（离'USDCNH）；仅探'调试可设 `FANCHENG_FX_ONSHORE=1` 改读在岸 DEXCHUS'
 */

const fs = require('fs');

const path = require('path');

const crossAsset = require('./commodity-cross-asset-regime');

const { getDataDir } = require('./data-paths');

const { loadHistoryBars, COMEX_CONFIG } = require('./cross-market-precious-fetcher');



const INFERENCE_VERSION = 'v0.2-comex-silver';



/** 期望落盘路径（相'data/history/'*/

const DATA_FILES = {

  londonGold: 'fred-london-gold-daily.json',

  londonSilver: 'fred-london-silver-daily.json',

  comexGold: 'comex-gc-daily.json',

  comexSilver: 'comex-si-daily.json',

  cnh: 'cnh-midrate-daily.json',

  cnhFallback: 'fred-dexchus-daily.json',

  gldHoldings: 'precious-etf-holdings-daily.json',

  shfeAu: 'trading/au.json',

  shfeAg: 'trading/ag.json',

};



const TROY_OZ_GRAMS = crossAsset.TROY_OZ_GRAMS;

const GRAMS_PER_KG = 1000;

const FX_ONSHORE_ENV = 'FANCHENG_FX_ONSHORE';



let intlSeriesCache = null;



/** 推断层汇率来源标—默认离岸 CNH，回退或在'env 时为 DEXCHUS */

function formatFxSourceLabel(cnhMeta) {

  if (process.env[FX_ONSHORE_ENV] === '1') return '在岸DEXCHUS';

  const kind = cnhMeta?.kind || '';

  if (kind === 'dexchus_proxy' || kind === 'dexchus_onshore') return '在岸DEXCHUS';

  return '离岸USDCNH';

}



/** 生产默认离岸 CNH（cnh-midrate-daily.json）；'FANCHENG_FX_ONSHORE=1 时改'fred-dexchus-daily.json */

function resolveFxSeries(ctx) {

  if (process.env[FX_ONSHORE_ENV] === '1') {

    const onshore = loadHistoryBars(DATA_FILES.cnhFallback);

    if (onshore.bars.length >= 20) {

      return {

        bars: onshore.bars,

        meta: {

          ...onshore,

          kind: 'dexchus_onshore',

          proxy: false,

          label: '在岸DEXCHUS',

        },

      };

    }

  }

  return { bars: ctx.cnh, meta: ctx.cnhMeta };

}



function historyDir() {

  return path.join(getDataDir() || 'E:\\FanchengFinance\\data', 'history');

}



function normDate(d) {

  if (d instanceof Date && !Number.isNaN(d.getTime())) {

    return d.toISOString().slice(0, 10);

  }

  return String(d || '').slice(0, 10);

}



function lookupCloseOnOrBefore(bars, date) {

  const d = normDate(date);

  let last = null;

  for (const row of bars) {

    if (row.date <= d) last = row.close;

    else break;

  }

  return last;

}



function lookupDateOnOrBefore(bars, date) {

  const d = normDate(date);

  let last = null;

  for (const row of bars) {

    if (row.date <= d) last = row.date;

    else break;

  }

  return last;

}



function loadTradingBars(instrumentId) {

  const fp = path.join(historyDir(), 'trading', `${String(instrumentId).toLowerCase()}.json`);

  if (!fs.existsSync(fp)) return [];

  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));

  const series = Array.isArray(raw) ? raw : raw.series || [];

  return series

    .map((r) => ({

      date: normDate(r.date),

      open: Number(r.open ?? r.close ?? 0),

      close: Number(r.close ?? r.price ?? 0),

    }))

    .filter((b) => b.close > 0 && b.date)

    .sort((a, b) => a.date.localeCompare(b.date));

}



function ensureIntlSeriesLoaded() {

  if (intlSeriesCache) return intlSeriesCache;

  const overlay = crossAsset.ensureAuOverlaySeriesLoaded();

  const comexGold = loadHistoryBars(DATA_FILES.comexGold);

  const comexSilver = loadHistoryBars(DATA_FILES.comexSilver);

  const londonSilver = loadHistoryBars(DATA_FILES.londonSilver);



  intlSeriesCache = {

    ...overlay,

    comexGold: comexGold.bars,

    comexGoldMeta: comexGold,

    comexSilver: comexSilver.bars,

    comexSilverMeta: comexSilver,

    londonSilver: londonSilver.bars,

    londonSilverMeta: londonSilver,

  };

  return intlSeriesCache;

}



function resetIntlSeriesCache() {

  intlSeriesCache = null;

}



/**

 * 国际美元/盎司 '上期所隐含人民币价'
 * @param {'au'|'ag'} instrumentId 'au: '克；ag: '千克

 */

function impliedShfePrice(intlUsdOz, cnhRate, instrumentId = 'au') {

  if (!intlUsdOz || !cnhRate) return null;

  const rmbPerGram = (intlUsdOz * cnhRate) / TROY_OZ_GRAMS;

  return instrumentId === 'ag' ? rmbPerGram * GRAMS_PER_KG : rmbPerGram;

}



/** 沪金/沪银相对伦敦+CNH 的溢价（%）'复用 cross-asset 公式 */

function computePremiumPct(shfeClose, intlUsdOz, cnhRate, instrumentId = 'au') {

  const implied = impliedShfePrice(intlUsdOz, cnhRate, instrumentId);

  if (!implied || !shfeClose) return null;

  return ((shfeClose / implied) - 1) * 100;

}



/** 溢价锚定伦敦现货；隔夜变动优'COMEX 主力（AU/AG 同一套结构） */
function pickIntlSeries(ctx, instrumentId = 'au') {
  const id = String(instrumentId).toLowerCase();
  const isAg = id === 'ag';

  const london = isAg
    ? ctx.londonSilver?.length >= 20
      ? ctx.londonSilver
      : null
    : ctx.intlGold?.length >= 20
      ? ctx.intlGold
      : null;
  const comex = isAg
    ? ctx.comexSilver?.length >= 20
      ? ctx.comexSilver
      : null
    : ctx.comexGold?.length >= 20
      ? ctx.comexGold
      : null;

  if (!london && !comex) {
    return { levelBars: null, deltaBars: null, source: 'missing', meta: null };
  }

  const londonKey = isAg ? 'london_silver' : 'london_gold';
  const comexKey = isAg ? 'comex_si' : 'comex_gc';
  const comboKey = isAg ? 'london_silver+comex_si' : 'london_gold+comex_gc';
  const londonMeta = isAg ? ctx.londonSilverMeta : ctx.intlGoldMeta;
  const comexMeta = isAg ? ctx.comexSilverMeta : ctx.comexGoldMeta;

  return {
    levelBars: london || comex,
    deltaBars: comex || london,
    source: london && comex ? comboKey : london ? londonKey : comexKey,
    meta: londonMeta?.rowCount ? londonMeta : comexMeta,
  };
}



/**

 * 隔夜国际变动 '隐含 SHFE 点位预测（相对前收）

 *

 * @param {string} date '预测日（'T-1 国际收盘推算 T 日相'T-1 SHFE 收的变动'
 * @param {'au'|'ag'} instrumentId

 */

function inferPointChangeFromClose(date, instrumentId = 'au', context = {}) {

  const d = normDate(date);

  const betaBasis = context.betaBasis ?? 0.15;

  const ctx = { ...ensureIntlSeriesLoaded(), ...context };



  const shfeBars = loadTradingBars(instrumentId);

  const picked = pickIntlSeries(ctx, instrumentId);

  if (!picked.levelBars || !picked.deltaBars) {
    const gateReason =
      instrumentId === 'ag' ? 'missing_london_or_comex_silver' : 'missing_london_or_comex_gold';
    return insufficient(gateReason, instrumentId, d);
  }

  const intlLevelBars = picked.levelBars;
  const intlDeltaBars = picked.deltaBars;
  const intlSource = picked.source;
  const intlMeta = picked.meta;



  const prevDate = lookupDateOnOrBefore(shfeBars, shiftDate(d, 1));

  if (!prevDate) {

    return insufficient('missing_prev_shfe', instrumentId, d);

  }



  const shfePrev = lookupCloseOnOrBefore(shfeBars, prevDate);

  const { bars: cnhBars, meta: cnhMeta } = resolveFxSeries(ctx);

  const cnhPrev = lookupCloseOnOrBefore(cnhBars, prevDate);

  const cnhNow = lookupCloseOnOrBefore(cnhBars, d);



  const intlLevelPrev = lookupCloseOnOrBefore(intlLevelBars, prevDate);

  const intlLevelNow = lookupCloseOnOrBefore(intlLevelBars, d);

  const intlDeltaPrev = lookupCloseOnOrBefore(intlDeltaBars, prevDate);

  const intlDeltaNow = lookupCloseOnOrBefore(intlDeltaBars, d);



  if (!shfePrev || !cnhPrev || !cnhNow || !intlLevelPrev || !intlLevelNow || !intlDeltaPrev || !intlDeltaNow) {

    return insufficient('missing_aligned_bars', instrumentId, d);

  }



  const impliedPrev = impliedShfePrice(intlLevelPrev, cnhPrev, instrumentId);

  const impliedNowLevel = impliedShfePrice(intlLevelNow, cnhNow, instrumentId);

  const impliedNowDelta = impliedShfePrice(intlDeltaNow, cnhNow, instrumentId);

  const deltaImplied = impliedNowDelta - impliedPrev;

  const impliedIntlOnly = impliedShfePrice(intlDeltaNow, cnhPrev, instrumentId);

  const intlContribution =

    impliedIntlOnly != null && impliedPrev != null ? impliedIntlOnly - impliedPrev : null;

  const fxContribution =

    impliedNowDelta != null && impliedIntlOnly != null ? impliedNowDelta - impliedIntlOnly : null;



  const premPrev = computePremiumPct(shfePrev, intlLevelPrev, cnhPrev, instrumentId);

  const premNow = computePremiumPct(shfePrev, intlLevelNow, cnhNow, instrumentId);

  const deltaPrem = premPrev != null && premNow != null ? premNow - premPrev : 0;

  const basisAdj = betaBasis * deltaPrem * (impliedPrev / 100);



  const predictedDelta = deltaImplied + basisAdj;

  const predictedClose = shfePrev + predictedDelta;



  return {

    version: INFERENCE_VERSION,

    date: d,

    instrumentId,

    target: 'close_delta_from_prev_close',

    shfePrevClose: shfePrev,

    predictedDelta: +predictedDelta.toFixed(4),

    predictedClose: +predictedClose.toFixed(4),

    components: {

      deltaImplied: +deltaImplied.toFixed(4),

      basisAdj: +basisAdj.toFixed(4),

      intlLevelPrev,

      intlLevelNow,

      intlDeltaPrev,

      intlDeltaNow,

      cnhPrev,

      cnhNow,

      intlContribution: intlContribution != null ? +intlContribution.toFixed(4) : null,

      fxContribution: fxContribution != null ? +fxContribution.toFixed(4) : null,

      premiumPctPrev: premPrev != null ? +premPrev.toFixed(3) : null,

      impliedNowLevel: impliedNowLevel != null ? +impliedNowLevel.toFixed(4) : null,

    },

    dataSources: {

      intl: intlSource,

      intlFile: intlMeta?.file || null,

      cnh:

        cnhMeta.kind === 'dexchus_proxy' || cnhMeta.kind === 'dexchus_onshore'

          ? 'dexchus'

          : 'cnh_midrate',

      fxSourceLabel: formatFxSourceLabel(cnhMeta),

      comexGold: ctx.comexGoldMeta?.rowCount ? DATA_FILES.comexGold : 'missing',

      comexSilver: ctx.comexSilverMeta?.rowCount ? DATA_FILES.comexSilver : 'missing',

      londonSilver: ctx.londonSilverMeta?.rowCount ? DATA_FILES.londonSilver : 'missing',

    },

    gated: false,

  };

}



/**

 * 夜盘开盘缺口推—用「SHFE 前收 '国际隔夜变动」估算开盘价

 */

function inferOpenGap(date, instrumentId = 'au', context = {}) {

  const point = inferPointChangeFromClose(date, instrumentId, context);

  if (point.gated) return point;



  const shfeBars = loadTradingBars(instrumentId);

  const open = lookupCloseOnOrBefore(

    shfeBars.map((b) => ({ date: b.date, close: b.open })),

    date,

  );

  const actualGap = open != null ? open - point.shfePrevClose : null;



  return {

    ...point,

    target: 'open_gap_from_prev_close',

    predictedOpen: point.predictedClose,

    actualOpen: open,

    openGapError: actualGap != null ? +(point.predictedClose - open).toFixed(4) : null,

  };

}



function shiftDate(date, days) {

  const dt = new Date(normDate(date));

  dt.setDate(dt.getDate() - days);

  return normDate(dt);

}



function insufficient(gateReason, instrumentId, date) {

  return {

    version: INFERENCE_VERSION,

    date,

    instrumentId,

    gated: true,

    gateReason,

    predictedDelta: null,

    predictedClose: null,

  };

}



module.exports = {

  INFERENCE_VERSION,

  DATA_FILES,

  COMEX_CONFIG,

  TROY_OZ_GRAMS,

  impliedShfePrice,

  computePremiumPct,

  formatFxSourceLabel,

  resolveFxSeries,

  pickIntlSeries,

  inferPointChangeFromClose,

  inferOpenGap,

  loadTradingBars,

  ensureIntlSeriesLoaded,

  resetIntlSeriesCache,

};


