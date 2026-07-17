/**
 * 原油 vs 贵金属 2026-01-28 起分化分析
 * 国内主力 (sc/fu/au/ag) + FRED Brent/WTI (+ 可选伦敦金)
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = 'E:/FanchengFinance/data/history';
const TRADING_DIR = path.join(DATA_DIR, 'trading');
const NEWS_PATH = path.join(DATA_DIR, 'news-tagged.csv');
const OUT_JSON = path.join(DATA_DIR, 'analysis', 'oil-pm-divergence-2026.json');
const ANCHOR = '2026-01-28';

function loadSeries(id) {
  const fp = path.join(TRADING_DIR, `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const series = Array.isArray(raw) ? raw : raw.series || raw.klines || [];
  return series
    .map((r) => ({ date: String(r.date || r.time).slice(0, 10), close: Number(r.close ?? r.price ?? 0) }))
    .filter((b) => b.close > 0 && b.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function loadFredSeries(filename) {
  const fp = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fp)) return { bars: [], meta: null };
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const bars = (raw.series || [])
    .map((r) => ({ date: String(r.date).slice(0, 10), close: Number(r.value) }))
    .filter((b) => b.close > 0 && b.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { bars, meta: { seriesId: raw.seriesId, source: raw.source, rowCount: raw.rowCount } };
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]; sxx += xs[i] ** 2; syy += ys[i] ** 2; sxy += xs[i] * ys[i];
  }
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? null : (n * sxy - sx * sy) / den;
}

function dailyReturns(bars) {
  const map = new Map();
  for (let i = 1; i < bars.length; i++) {
    map.set(bars[i].date, (bars[i].close - bars[i - 1].close) / bars[i - 1].close);
  }
  return map;
}

function alignDates(...seriesList) {
  const sets = seriesList.map((s) => new Set(s.map((b) => b.date)));
  let common = [...sets[0]];
  for (let i = 1; i < sets.length; i++) {
    common = common.filter((d) => sets[i].has(d));
  }
  return common.sort();
}

function rollingCorr(dates, retMaps, idA, idB, window, endIdx) {
  if (endIdx < window) return null;
  const xs = [];
  const ys = [];
  for (let i = endIdx - window + 1; i <= endIdx; i++) {
    const d = dates[i];
    const a = retMaps[idA].get(d);
    const b = retMaps[idB].get(d);
    if (a == null || b == null) return null;
    xs.push(a);
    ys.push(b);
  }
  return pearson(xs, ys);
}

function pctFromAnchor(bars, anchorDate) {
  const idx = bars.findIndex((b) => b.date >= anchorDate);
  if (idx < 0) return null;
  const base = bars[idx].close;
  const last = bars[bars.length - 1];
  return {
    anchorDate: bars[idx].date,
    anchorClose: base,
    latestDate: last.date,
    latestClose: last.close,
    pct: ((last.close - base) / base) * 100,
  };
}

function loadNews(from, to) {
  const text = fs.readFileSync(NEWS_PATH, 'utf8');
  const lines = text.trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const date = parts[0];
    if (date >= from && date <= to) {
      out.push({ date, title: parts[1], instruments: parts[2], sentiment: parts[3], category: parts[5] || '' });
    }
  }
  return out;
}

function returnCorrOverlap(barsA, barsB, from, to) {
  const retA = dailyReturns(barsA);
  const retB = dailyReturns(barsB);
  const dates = alignDates(barsA, barsB).filter((d) => d >= from && d <= to);
  const xs = [];
  const ys = [];
  for (const d of dates) {
    const a = retA.get(d);
    const b = retB.get(d);
    if (a == null || b == null) continue;
    xs.push(a);
    ys.push(b);
  }
  return { returnCorr: pearson(xs, ys), overlapDays: xs.length, from, to };
}

const sc = loadSeries('sc');
const fu = loadSeries('fu');
const au = loadSeries('au');
const ag = loadSeries('ag');
const { bars: brent, meta: brentMeta } = loadFredSeries('fred-brent-daily.json');
const { bars: wti, meta: wtiMeta } = loadFredSeries('fred-wti-daily.json');
const { bars: londonGold, meta: londonGoldMeta } = loadFredSeries('fred-london-gold-daily.json');

const domestic = { sc, fu, au, ag };
const external = { brent, wti, londonGold };
const allSeries = { ...domestic, ...external };

const windowDates = alignDates(sc, fu, au, ag).filter((d) => d >= ANCHOR);
const retMaps = {};
for (const [id, bars] of Object.entries(allSeries)) {
  if (bars.length) retMaps[id] = dailyReturns(bars);
}

const anchorIdx = {};
for (const [id, bars] of Object.entries(allSeries)) {
  if (!bars.length) continue;
  const i = bars.findIndex((b) => b.date >= ANCHOR);
  anchorIdx[id] = i >= 0 ? i : 0;
}

const normalized = {};
for (const d of windowDates) {
  normalized[d] = {};
  for (const [id, bars] of Object.entries(allSeries)) {
    if (!bars.length || anchorIdx[id] == null) continue;
    const i = bars.findIndex((b) => b.date === d);
    if (i < 0) continue;
    const base = bars[anchorIdx[id]].close;
    normalized[d][id] = +((bars[i].close / base) * 100).toFixed(2);
  }
}

const corrSeries = [];
for (let i = 0; i < windowDates.length; i++) {
  const d = windowDates[i];
  corrSeries.push({
    date: d,
    sc_au_10: rollingCorr(windowDates, retMaps, 'sc', 'au', 10, i),
    sc_au_20: rollingCorr(windowDates, retMaps, 'sc', 'au', 20, i),
    fu_ag_10: rollingCorr(windowDates, retMaps, 'fu', 'ag', 10, i),
    fu_ag_20: rollingCorr(windowDates, retMaps, 'fu', 'ag', 20, i),
    brent_au_10: brent.length ? rollingCorr(windowDates, retMaps, 'brent', 'au', 10, i) : null,
    brent_au_20: brent.length ? rollingCorr(windowDates, retMaps, 'brent', 'au', 20, i) : null,
    wti_ag_10: wti.length ? rollingCorr(windowDates, retMaps, 'wti', 'ag', 10, i) : null,
    wti_ag_20: wti.length ? rollingCorr(windowDates, retMaps, 'wti', 'ag', 20, i) : null,
  });
}

const divergences = [];
for (const d of windowDates) {
  const scR = retMaps.sc.get(d);
  const auR = retMaps.au.get(d);
  const fuR = retMaps.fu.get(d);
  const agR = retMaps.ag.get(d);
  const brentR = retMaps.brent?.get(d);
  const wtiR = retMaps.wti?.get(d);
  if (scR == null || auR == null) continue;
  const oilUpGoldDown = scR > 0.002 && auR < -0.002;
  const oilDownGoldUp = scR < -0.002 && auR > 0.002;
  if (oilUpGoldDown || oilDownGoldUp) {
    divergences.push({
      date: d,
      type: oilUpGoldDown ? 'oil_up_gold_down' : 'oil_down_gold_up',
      scPct: +(scR * 100).toFixed(3),
      auPct: +(auR * 100).toFixed(3),
      fuPct: fuR != null ? +(fuR * 100).toFixed(3) : null,
      agPct: agR != null ? +(agR * 100).toFixed(3) : null,
      brentPct: brentR != null ? +(brentR * 100).toFixed(3) : null,
      wtiPct: wtiR != null ? +(wtiR * 100).toFixed(3) : null,
    });
  }
}

function groupEpisodes(dates, gapDays = 3) {
  if (!dates.length) return [];
  const episodes = [];
  let start = dates[0];
  let end = dates[0];
  let types = new Set([dates[0].type]);
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1].date);
    const cur = new Date(dates[i].date);
    const gap = (cur - prev) / 86400000;
    if (gap <= gapDays) {
      end = dates[i].date;
      types.add(dates[i].type);
    } else {
      episodes.push({ from: start.date, to: end, types: [...types] });
      start = dates[i];
      end = dates[i].date;
      types = new Set([dates[i].type]);
    }
  }
  episodes.push({ from: start.date, to: end, types: [...types] });
  return episodes;
}

const episodes = groupEpisodes(divergences);

function periodStats(from, to) {
  const sub = windowDates.filter((d) => d >= from && d <= to);
  if (sub.length < 5) return null;
  const cum = (id) => {
    const rs = sub.map((d) => retMaps[id]?.get(d)).filter((v) => v != null);
    return rs.length ? +((rs.reduce((p, r) => p * (1 + r), 1) - 1) * 100).toFixed(2) : null;
  };
  const endIdx = windowDates.indexOf(sub[sub.length - 1]);
  return {
    from,
    to,
    days: sub.length,
    scPct: cum('sc'),
    fuPct: cum('fu'),
    auPct: cum('au'),
    agPct: cum('ag'),
    brentPct: cum('brent'),
    wtiPct: cum('wti'),
    sc_au_corr20: rollingCorr(windowDates, retMaps, 'sc', 'au', 20, endIdx),
    fu_ag_corr20: rollingCorr(windowDates, retMaps, 'fu', 'ag', 20, endIdx),
    brent_au_corr20: brent.length ? rollingCorr(windowDates, retMaps, 'brent', 'au', 20, endIdx) : null,
    wti_ag_corr20: wti.length ? rollingCorr(windowDates, retMaps, 'wti', 'ag', 20, endIdx) : null,
    divergenceDays: divergences.filter((x) => x.date >= from && x.date <= to).length,
  };
}

const PERIOD_NARRATIVES = {
  '2026-01-28|2026-02-09': 'Fed暂停降息·实际利率重定价；银高Beta去杠杆（资金面/宏观）',
  '2026-02-10|2026-02-19': 'CPI超预期+关税预期；短窗同向震荡（消息/情绪）',
  '2026-02-20|2026-02-27': '122条关税/SCOTUS IEEPA；落地前分化暂缓（政策）',
  '2026-02-28|': '伊朗/霍尔木兹地缘→油溢价；金未跟涨（地缘 vs 降息）',
};

const periods = [
  periodStats('2026-01-28', '2026-02-09'),
  periodStats('2026-02-10', '2026-02-19'),
  periodStats('2026-02-20', '2026-02-27'),
  periodStats('2026-02-28', windowDates[windowDates.length - 1]),
  periodStats(ANCHOR, windowDates[windowDates.length - 1]),
].filter(Boolean).map((p) => ({
  ...p,
  narrative:
    PERIOD_NARRATIVES[`${p.from}|${p.to}`] ||
    PERIOD_NARRATIVES[`${p.from}|`] ||
    (p.from === ANCHOR && p.to === windowDates[windowDates.length - 1] ? '全样本：宏观分轨定价' : null),
}));

const news = loadNews(ANCHOR, windowDates[windowDates.length - 1]);

const proxyValidation = {
  brentVsSc: returnCorrOverlap(brent, sc, '2025-01-01', '2025-12-31'),
  wtiVsFu: returnCorrOverlap(wti, fu, '2025-01-01', '2025-12-31'),
  brentVsSc2026: returnCorrOverlap(brent, sc, ANCHOR, windowDates[windowDates.length - 1]),
  wtiVsFu2026: returnCorrOverlap(wti, fu, ANCHOR, windowDates[windowDates.length - 1]),
};

const mapping = {
  brent: { fred: 'DCOILBRENTEU', file: 'fred-brent-daily.json', proxy: 'sc', meta: brentMeta },
  wti: { fred: 'DCOILWTICO', file: 'fred-wti-daily.json', proxy: 'fu', meta: wtiMeta },
  london_gold: { fred: 'GOLDAMGBD228NLBM', file: 'fred-london-gold-daily.json', proxy: 'au', meta: londonGoldMeta, optional: true },
  comex_gold: { proxy: 'au', note: 'SHFE AU 沪金，COMEX 联动' },
  comex_silver: { proxy: 'ag', note: 'SHFE AG 沪银，COMEX 联动' },
};

const decoupleThreshold = 0.18;
const linkedDays = corrSeries.filter((c) => c.brent_au_20 != null && Math.abs(c.brent_au_20) >= decoupleThreshold).length;
const decoupleDays = corrSeries.filter((c) => c.brent_au_20 != null && Math.abs(c.brent_au_20) < decoupleThreshold).length;

const result = {
  generatedAt: new Date().toISOString(),
  anchor: ANCHOR,
  latestDate: windowDates[windowDates.length - 1],
  mapping,
  proxyValidation,
  dataRange: Object.fromEntries(
    Object.entries(allSeries)
      .filter(([, bars]) => bars.length)
      .map(([id, bars]) => [id, { first: bars[0].date, last: bars[bars.length - 1].date, bars: bars.length }])
  ),
  cumulativeFromAnchor: Object.fromEntries(
    Object.entries(allSeries)
      .filter(([, bars]) => bars.length)
      .map(([id, bars]) => [id, pctFromAnchor(bars, ANCHOR)])
  ),
  normalizedDaily: normalized,
  corrSeries,
  divergenceDays: divergences,
  divergenceEpisodes: episodes,
  periodTable: periods.filter(Boolean),
  newsInWindow: news,
  regimeHint: {
    decoupleThreshold,
    linkedDays,
    decoupleDays,
    dominantRegime: decoupleDays > linkedDays ? 'oil_gold_decouple' : 'linked',
  },
  summary: {
    totalDays: windowDates.length,
    divergenceDayCount: divergences.length,
    divergencePct: +((divergences.length / windowDates.length) * 100).toFixed(1),
    avgScAuCorr20: (() => {
      const v = corrSeries.map((c) => c.sc_au_20).filter((x) => x != null);
      return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(4) : null;
    })(),
    avgBrentAuCorr20: (() => {
      const v = corrSeries.map((c) => c.brent_au_20).filter((x) => x != null);
      return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(4) : null;
    })(),
    avgWtiAgCorr20: (() => {
      const v = corrSeries.map((c) => c.wti_ag_20).filter((x) => x != null);
      return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(4) : null;
    })(),
    lastScAuCorr20: corrSeries[corrSeries.length - 1]?.sc_au_20,
    lastBrentAuCorr20: corrSeries[corrSeries.length - 1]?.brent_au_20,
    lastFuAgCorr20: corrSeries[corrSeries.length - 1]?.fu_ag_20,
    lastWtiAgCorr20: corrSeries[corrSeries.length - 1]?.wti_ag_20,
  },
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary, null, 2));
console.log('\n--- proxyValidation ---');
console.log(JSON.stringify(proxyValidation, null, 2));
console.log('\n--- periodTable ---');
console.log(JSON.stringify(result.periodTable, null, 2));
console.log('\n--- cumulative ---');
console.log(JSON.stringify(result.cumulativeFromAnchor, null, 2));
