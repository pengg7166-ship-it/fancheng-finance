/**
 * 历史验证：事件冲击 vs 叙事主题 — T+1/T+5/T+20 收益、冲击后回撤、趋势持续
 */
const fs = require('fs');
const path = require('path');

const TRADING_DIR = path.join('E:\\FanchengFinance', 'data', 'history', 'trading');
const INSTRUMENTS = ['cu', 'au', 'ag', 'sc', 'al'];

const CASES = [
  { id: 'trade_war_2019', label: '2018-19贸易战升级', date: '2019-05-10', archetype: 'shock_event', eventId: 'us_china_tariff_2019' },
  { id: 'trade_war_2018', label: '2018贸易战首轮关税', date: '2018-07-06', archetype: 'shock_event', eventId: 'us_china_tariff_2018' },
  { id: 'ru_ukraine_2022', label: '俄乌冲突2022', date: '2022-02-24', archetype: 'shock_event', eventId: 'ru_ukraine_invade' },
  { id: 'tariff_2025', label: '2025特朗普关税落地', date: '2025-02-01', archetype: 'shock_event', eventId: 'trump_tariff_implementation_2025' },
  { id: 'us_iran_2026', label: '2026美以伊地缘', date: '2026-01-01', archetype: 'shock_event', eventId: 'us_iran_israel_2026' },
  { id: 'ai_narrative_2023', label: 'AI/算力叙事启动(ChatGPT后)', date: '2023-01-01', archetype: 'narrative_theme', eventId: 'ai_datacenter_narrative' },
  { id: 'ai_narrative_2024', label: 'AI基建/数据中心铜需求叙事', date: '2024-03-01', archetype: 'narrative_theme', eventId: 'ai_copper_demand_2024' },
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
      idx = idx - 1;
    }
  }
  return idx;
}

function pctRet(from, to) {
  if (!from || !to) return null;
  return +(((to - from) / from) * 100).toFixed(2);
}

function analyzeCase(bars, eventDate) {
  const idx = findBarIndex(bars, eventDate);
  if (idx < 0 || idx >= bars.length) return null;
  const base = bars[idx].close;
  const t1 = bars[idx + 1]?.close;
  const t5 = bars[Math.min(idx + 5, bars.length - 1)]?.close;
  const t20 = bars[Math.min(idx + 20, bars.length - 1)]?.close;

  const window = bars.slice(idx, Math.min(idx + 21, bars.length));
  let peakIdx = 0;
  let troughIdx = 0;
  for (let i = 0; i < window.length; i += 1) {
    if (window[i].close >= window[peakIdx].close) peakIdx = i;
    if (window[i].close <= window[troughIdx].close) troughIdx = i;
  }
  const peak = window[peakIdx].close;
  const trough = window[troughIdx].close;
  const spikeDir = pctRet(base, peak) >= Math.abs(pctRet(base, trough) || 0) ? 'up' : 'down';
  const spikeMag = spikeDir === 'up' ? pctRet(base, peak) : pctRet(base, trough);

  let maxDrawdownAfterSpike = null;
  let pullbackBounce = null;
  if (spikeDir === 'up' && peakIdx < window.length - 1) {
    const afterPeak = window.slice(peakIdx);
    const minAfter = Math.min(...afterPeak.map((b) => b.close));
    maxDrawdownAfterSpike = pctRet(peak, minAfter);
    if (afterPeak.length > 2) {
      pullbackBounce = pctRet(minAfter, afterPeak[afterPeak.length - 1].close);
    }
  } else if (spikeDir === 'down' && troughIdx < window.length - 1) {
    const afterTrough = window.slice(troughIdx);
    const maxAfter = Math.max(...afterTrough.map((b) => b.close));
    maxDrawdownAfterSpike = pctRet(trough, maxAfter);
    if (afterTrough.length > 2) {
      pullbackBounce = pctRet(trough, afterTrough[afterTrough.length - 1].close);
    }
  }

  const t60 = bars[Math.min(idx + 60, bars.length - 1)]?.close;
  const trendDurationDays = (() => {
    const initialMove = pctRet(base, t5);
    if (initialMove == null) return 0;
    const sign = Math.sign(initialMove);
    let days = 0;
    for (let i = idx + 1; i < Math.min(idx + 120, bars.length); i += 1) {
      const r = pctRet(base, bars[i].close);
      if (sign > 0 && r >= initialMove * 0.5) days = i - idx;
      else if (sign < 0 && r <= initialMove * 0.5) days = i - idx;
      else if (sign !== 0 && Math.sign(r) !== sign) break;
    }
    return days;
  })();

  return {
    eventDate: bars[idx].date,
    base,
    t1: pctRet(base, t1),
    t5: pctRet(base, t5),
    t20: pctRet(base, t20),
    t60: pctRet(base, t60),
    spikeDir,
    spikeMag,
    spikeDay: peakIdx,
    maxPullbackAfterSpike: maxDrawdownAfterSpike,
    bounceAfterPullback: pullbackBounce,
    trendDurationDays,
    barsAvailable: bars.length - idx,
  };
}

function main() {
  const data = {};
  for (const inst of INSTRUMENTS) {
    data[inst] = loadSeries(inst);
  }

  const results = [];
  for (const c of CASES) {
    const row = { ...c, instruments: {} };
    for (const inst of INSTRUMENTS) {
      const bars = data[inst];
      row.instruments[inst] = bars.length ? analyzeCase(bars, c.date) : null;
    }
    results.push(row);
  }

  const outPath = path.join(__dirname, '..', 'docs', 'event-vs-narrative-stats.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main();
