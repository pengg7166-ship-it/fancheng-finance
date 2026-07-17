/**
 * 哲学五支柱 × 历史锚点事件 — T+1/3/5/10/20、冲击后回撤、趋势持续
 * 输出 docs/philosophy-historical-fit-stats.json
 */
const fs = require('fs');
const path = require('path');

const TRADING_DIR = path.join('E:\\FanchengFinance', 'data', 'history', 'trading');
const OUT_JSON = path.join(__dirname, '..', 'docs', 'philosophy-historical-fit-stats.json');

/** @type {Array<{id:string,label:string,date:string,archetype:string,philosophyPillars:string[],eventId?:string,instruments:string[]}>} */
const ANCHOR_EVENTS = [
  // shock_event
  { id: 'tariff_2019', label: '2019贸易战关税25%', date: '2019-05-10', archetype: 'shock_event', philosophyPillars: ['事件vs叙事', '剧震后回调', '经验衰减'], eventId: 'us_china_tariff_2019', instruments: ['cu', 'sc', 'rb'] },
  { id: 'ru_ukraine_2022', label: '2022俄乌冲突', date: '2022-02-24', archetype: 'shock_event', philosophyPillars: ['事件vs叙事', '剧震后回调', '单边攻城'], eventId: 'ru_ukraine_invade', instruments: ['cu', 'sc', 'rb'] },
  { id: 'tariff_2025', label: '2025关税落地', date: '2025-02-01', archetype: 'shock_event', philosophyPillars: ['事件vs叙事', '剧震后回调'], eventId: 'trump_tariff_implementation_2025', instruments: ['cu', 'sc', 'rb'] },
  { id: 'tariff_2025_au', label: '2025关税沪金套利冲高', date: '2025-02-03', archetype: 'shock_event', philosophyPillars: ['事件vs叙事', '地缘升级'], eventId: 'trump_tariff_202502_au', instruments: ['au', 'ag'] },
  { id: 'us_iran_2026', label: '2026美以伊地缘', date: '2026-01-01', archetype: 'shock_event', philosophyPillars: ['事件vs叙事', '剧震后回调', '地缘升级'], eventId: 'us_iran_israel_2026', instruments: ['sc', 'fu', 'cu'] },
  // narrative
  { id: 'ai_narrative_2023', label: 'AI/算力叙事启动', date: '2023-11-30', archetype: 'narrative', philosophyPillars: ['事件vs叙事', '单边攻城'], eventId: 'ai_datacenter_narrative', instruments: ['cu', 'al', 'au'] },
  { id: 'ai_copper_2024', label: '数据中心铜需求叙事', date: '2024-03-01', archetype: 'narrative', philosophyPillars: ['事件vs叙事', '单边攻城'], eventId: 'ai_copper_demand_2024', instruments: ['cu', 'al', 'au'] },
  { id: 'nickel_ban_2020', label: '印尼镍矿出口禁令(供应叙事)', date: '2020-01-01', archetype: 'narrative', philosophyPillars: ['事件vs叙事', '单边攻城'], eventId: 'indonesia_nickel_ban_2020', instruments: ['ni', 'ss'] },
  // macro_repeat
  { id: 'fed_cut_201907', label: 'Fed2019首次降息', date: '2019-07-31', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_20190731', instruments: ['au', 'ag'] },
  { id: 'fed_cut_201909', label: 'Fed2019第二次降息', date: '2019-09-18', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_20190918', instruments: ['au', 'ag'] },
  { id: 'fed_cut_201910', label: 'Fed2019第三次降息', date: '2019-10-30', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_20191030', instruments: ['au', 'ag'] },
  { id: 'fed_cut_202409', label: 'Fed2024降息周期开启', date: '2024-09-18', archetype: 'macro_repeat', philosophyPillars: ['经验衰减', '利好兑现'], eventId: 'fomc_20240918', instruments: ['au', 'ag', 'cu'] },
  { id: 'fomc_hawkish_dot_202406', label: '2024-06鹰派点阵弱数据反弹', date: '2024-06-12', archetype: 'macro_repeat', philosophyPillars: ['经验衰减', '剧震后回调'], eventId: 'fomc_20240612_au', instruments: ['au', 'ag'] },
  { id: 'hawkish_cut_202412', label: '2024-12鹰派降息卖事实', date: '2024-12-18', archetype: 'macro_repeat', philosophyPillars: ['利好兑现'], eventId: 'fomc_20241218_au', instruments: ['au', 'ag'] },
  { id: 'iran_strike_202404', label: '2024伊朗导弹袭以(沪金)', date: '2024-04-15', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '剧震后回调'], eventId: 'iran_strike_20240413_au', instruments: ['au', 'ag'] },
  { id: 'fed_cut_202411', label: 'Fed2024第二次降息', date: '2024-11-07', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_20241107', instruments: ['au', 'ag'] },
  // 利好兑现 — Fed 降息落地（T-5..T+5）
  { id: 'priced_in_202509', label: 'Fed2025-09降息(日历)', date: '2025-09-17', archetype: 'macro_repeat', philosophyPillars: ['利好兑现'], eventId: 'fomc_20250917', instruments: ['au', 'ag'] },
  { id: 'priced_in_202510', label: 'Fed2025-10降息(日历)', date: '2025-10-29', archetype: 'macro_repeat', philosophyPillars: ['利好兑现'], eventId: 'fomc_20251029', instruments: ['au', 'ag'] },
  { id: 'priced_in_202512', label: 'Fed2025-12降息(日历)', date: '2025-12-11', archetype: 'macro_repeat', philosophyPillars: ['利好兑现'], eventId: 'fed_cut_dec2025_au', instruments: ['au', 'ag'] },
  { id: 'fomc_hold_jan2025', label: 'Fed2025-01按兵不动(沪金)', date: '2025-01-29', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_hold_jan2025_au', instruments: ['au', 'ag'] },
  { id: 'fomc_hold_mar2025', label: 'Fed2025-03按兵不动(沪金)', date: '2025-03-19', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_hold_mar2025_au', instruments: ['au', 'ag'] },
  { id: 'fomc_hold_may2025', label: 'Fed2025-05按兵不动(沪金)', date: '2025-05-07', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_hold_may2025_au', instruments: ['au', 'ag'] },
  { id: 'hawkish_hold_post_geo_202603', label: '2026鹰派暂停(地缘后)', date: '2026-03-18', archetype: 'macro_repeat', philosophyPillars: ['利好兑现', '剧震后回调'], eventId: 'fomc_hawkish_hold_20260318', instruments: ['au', 'ag'] },
  { id: 'fomc_pivot_202303', label: '2023FOMC鹰转鸽(删持续加息)', date: '2023-03-22', archetype: 'macro_repeat', philosophyPillars: ['经验衰减', '事件vs叙事'], eventId: 'fomc_20230322', instruments: ['au', 'ag'] },
  { id: 'fomc_priced_in_202305', label: '2023FOMC加息日买预期卖事实', date: '2023-05-03', archetype: 'macro_repeat', philosophyPillars: ['利好兑现'], eventId: 'fomc_20230503', instruments: ['au', 'ag'] },
  { id: 'fomc_last_hike_202307', label: '2023FOMC末次加息(周期峰值)', date: '2023-07-26', archetype: 'macro_repeat', philosophyPillars: ['经验衰减'], eventId: 'fomc_20230726', instruments: ['au', 'ag'] },
  { id: 'fomc_dovish_202312', label: '2023FOMC鸽派点阵(3降2024)', date: '2023-12-13', archetype: 'macro_repeat', philosophyPillars: ['经验衰减', '事件vs叙事'], eventId: 'fomc_20231213', instruments: ['au', 'ag'] },
  { id: 'svb_crisis_202303', label: '2023SVB银行危机', date: '2023-03-13', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '事件vs叙事'], eventId: 'svb_crisis_20230313', instruments: ['au', 'ag'] },
  { id: 'israel_hamas_202310', label: '2023巴以冲突', date: '2023-10-09', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '剧震后回调'], eventId: 'israel_hamas_20231009', instruments: ['au', 'ag'] },
  { id: 'venezuela_maduro_202601', label: '2026委内瑞拉黑天鹅', date: '2026-01-05', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '事件vs叙事'], eventId: 'venezuela_maduro_202601', instruments: ['au', 'ag'] },
  { id: 'iran_strike_202603', label: '2026美以伊(沪金)', date: '2026-03-02', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '剧震后回调', '利好兑现'], eventId: 'iran_strike_20260302', instruments: ['au', 'ag'] },
  // agri_climate — 粮食供应/产量路径（news-tagged 俄乌粮食 + 经典气候日 K 验证）
  { id: 'grain_ukraine', label: '俄乌粮食供应冲击', date: '2022-02-24', archetype: 'agri_climate', philosophyPillars: ['农产品气候', '事件vs叙事'], eventId: 'ru_ukraine_supply', instruments: ['c', 'm', 'WH'] },
  { id: 'india_wheat_ban', label: '印度小麦出口禁令', date: '2022-05-13', archetype: 'agri_climate', philosophyPillars: ['农产品气候'], eventId: 'india_wheat_export_ban_2022', instruments: ['c', 'm', 'WH'] },
  { id: 'brazil_drought_2021', label: '巴西干旱(二茬玉米)', date: '2021-07-15', archetype: 'agri_climate', philosophyPillars: ['农产品气候'], eventId: 'brazil_drought_2021', instruments: ['c', 'm', 'SR'] },
  { id: 'us_drought_2022', label: '美国中西部干旱', date: '2022-06-20', archetype: 'agri_climate', philosophyPillars: ['农产品气候'], eventId: 'us_midwest_drought_2022', instruments: ['c', 'm', 'SR'] },
  // geo_escalation
  { id: 'ru_ukraine_energy', label: '俄乌能源供应', date: '2022-02-24', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '剧震后回调', '经验衰减'], eventId: 'ru_ukraine_supply', instruments: ['sc', 'fu', 'ec'] },
  { id: 'red_sea_2024', label: '红海航运中断', date: '2024-01-12', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '剧震后回调'], eventId: 'red_sea_houthi_2024', instruments: ['sc', 'fu', 'ec'] },
  { id: 'hormuz_2024', label: '霍尔木兹海峡紧张', date: '2024-04-14', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '剧震后回调'], eventId: 'hormuz_tension_2024', instruments: ['sc', 'fu', 'lu'] },
  { id: 'us_iran_geo_2026', label: '2026美以伊(能源)', date: '2026-01-01', archetype: 'geo_escalation', philosophyPillars: ['地缘升级', '剧震后回调'], eventId: 'us_iran_israel_2026', instruments: ['sc', 'fu', 'ec'] },
];

function loadSeries(instrumentId) {
  const fp = path.join(TRADING_DIR, `${instrumentId}.json`);
  if (!fs.existsSync(fp)) return [];
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const series = Array.isArray(raw) ? raw : raw.series || [];
  return series
    .map((r) => ({
      date: String(r.date).slice(0, 10),
      close: Number(r.close ?? r.price ?? 0),
      high: Number(r.high ?? r.close ?? r.price ?? 0),
      low: Number(r.low ?? r.close ?? r.price ?? 0),
    }))
    .filter((b) => b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function findBarIndex(bars, dateStr) {
  let idx = bars.findIndex((b) => b.date >= dateStr);
  if (idx < 0) return bars.length - 1;
  if (bars[idx].date > dateStr && idx > 0) {
    const prev = bars[idx - 1];
    if (Math.abs(new Date(prev.date) - new Date(dateStr)) <= Math.abs(new Date(bars[idx].date) - new Date(dateStr))) {
      idx -= 1;
    }
  }
  return idx;
}

function pctRet(from, to) {
  if (!from || !to) return null;
  return +(((to - from) / from) * 100).toFixed(2);
}

function analyzeInstrument(bars, eventDate) {
  const idx = findBarIndex(bars, eventDate);
  if (idx < 0 || idx >= bars.length) return null;
  const base = bars[idx].close;
  const offsets = [1, 3, 5, 10, 20, 60];
  const returns = {};
  for (const n of offsets) {
    const target = bars[Math.min(idx + n, bars.length - 1)]?.close;
    returns[`t${n}`] = pctRet(base, target);
  }

  const window = bars.slice(idx, Math.min(idx + 21, bars.length));
  let peakIdx = 0;
  let troughIdx = 0;
  for (let i = 0; i < window.length; i += 1) {
    if (window[i].close >= window[peakIdx].close) peakIdx = i;
    if (window[i].close <= window[troughIdx].close) troughIdx = i;
  }
  const peak = window[peakIdx].close;
  const trough = window[troughIdx].close;
  const upMag = pctRet(base, peak);
  const downMag = pctRet(base, trough);
  const spikeDir = (upMag ?? 0) >= Math.abs(downMag ?? 0) ? 'up' : 'down';
  const spikeMag = spikeDir === 'up' ? upMag : downMag;
  const spikeBarIdx = spikeDir === 'up' ? peakIdx : troughIdx;

  let maxAdverseAfterSpike = null;
  let postShockPhase = 'consolidation';
  if (spikeDir === 'up' && spikeBarIdx < window.length - 1) {
    const spikePrice = window[spikeBarIdx].close;
    const minAfter = Math.min(...window.slice(spikeBarIdx).map((b) => b.close));
    maxAdverseAfterSpike = pctRet(spikePrice, minAfter);
    const retrace = spikePrice > base ? (spikePrice - minAfter) / (spikePrice - base) : 0;
    if (retrace >= 0.35) postShockPhase = 'pullback';
  } else if (spikeDir === 'down' && spikeBarIdx < window.length - 1) {
    const spikePrice = window[spikeBarIdx].close;
    const maxAfter = Math.max(...window.slice(spikeBarIdx).map((b) => b.close));
    maxAdverseAfterSpike = pctRet(spikePrice, maxAfter);
    const bounce = base > spikePrice ? (maxAfter - spikePrice) / (base - spikePrice) : 0;
    if (bounce >= 0.35) postShockPhase = 'bounce';
  }

  const t5 = returns.t5;
  let trendDurationDays = 0;
  if (t5 != null) {
    const sign = Math.sign(t5);
    for (let i = idx + 1; i < Math.min(idx + 120, bars.length); i += 1) {
      const r = pctRet(base, bars[i].close);
      if (sign > 0 && r >= t5 * 0.5) trendDurationDays = i - idx;
      else if (sign < 0 && r <= t5 * 0.5) trendDurationDays = i - idx;
      else if (sign !== 0 && Math.sign(r) !== sign) break;
    }
  }

  return {
    eventDate: bars[idx].date,
    base,
    ...returns,
    spikeDir,
    spikeMag,
    spikeDay: spikeBarIdx,
    maxAdverseAfterSpike,
    postShockPhase,
    trendDurationDays,
    barsAvailable: bars.length - idx,
  };
}

function analyzePricedInWindow(bars, eventDate) {
  const idx = findBarIndex(bars, eventDate);
  if (idx < 0 || idx >= bars.length) return null;
  const base = bars[idx].close;
  const preStart = Math.max(0, idx - 5);
  const preEnd = Math.max(0, idx - 1);
  const preRun =
    preEnd >= preStart && bars[preStart]?.close
      ? pctRet(bars[preStart].close, bars[preEnd].close)
      : null;
  const window = {};
  for (const off of [-5, -3, -1, 0, 1, 3, 5]) {
    const j = idx + off;
    if (j < 0 || j >= bars.length) {
      window[`t${off >= 0 ? '+' : ''}${off}`] = null;
      continue;
    }
    window[`t${off >= 0 ? '+' : ''}${off}`] = pctRet(base, bars[j].close);
  }
  return { preRunT5toT1: preRun, fromEventDay: window, eventIdx: idx };
}

function main() {
  const cache = {};
  const allInst = [...new Set(ANCHOR_EVENTS.flatMap((e) => e.instruments))];
  for (const id of allInst) cache[id] = loadSeries(id);

  const results = ANCHOR_EVENTS.map((ev) => {
    const instruments = {};
    for (const inst of ev.instruments) {
      const stats = cache[inst]?.length ? analyzeInstrument(cache[inst], ev.date) : null;
      instruments[inst] = stats;
      if (ev.philosophyPillars?.includes('利好兑现') && cache[inst]?.length) {
        instruments[inst] = { ...stats, pricedInWindow: analyzePricedInWindow(cache[inst], ev.date) };
      }
    }
    return { ...ev, instruments };
  });

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`Wrote ${OUT_JSON} (${results.length} events)`);
  return results;
}

if (require.main === module) main();
module.exports = { ANCHOR_EVENTS, analyzeInstrument, analyzePricedInWindow, loadSeries };
