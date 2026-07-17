/**
 * 情报中心 · 内外盘双轨叙事（构想 §29）
 * 真实磁盘序列对比：内盘日 K vs COMEX/LME/CBOT/FRED 外盘；缺失标「暂无」，不造假。
 */
const { loadHistoryBars } = require('./cross-market-precious-fetcher');

const DUAL_VERSION = 'v2.79.0-dual-executable';

const f = (file, label, weight = 1, role = 'direct') => ({ file, label, weight, role });

/**
 * 品种 → 外盘锚点（优先 direct；cost=成本链，展示须标明）
 * 序列须已落盘；抓取见 cross-market-external-fetcher / scripts/fetch-cross-market-external.js
 */
const EXTERNAL_MAP = Object.freeze({
  // —— 贵金属 ——
  au: [
    f('comex-gc-daily.json', 'COMEX金', 1),
    f('spot-xau-daily.json', '伦敦金现XAU', 0.9),
    f('fred-london-gold-daily.json', 'FRED伦敦金', 0.85),
  ],
  ag: [
    f('comex-si-daily.json', 'COMEX银', 1),
    f('spot-xag-daily.json', '伦敦银现XAG', 0.9),
    f('fred-london-silver-daily.json', 'FRED伦敦银', 0.85),
  ],
  // —— 有色（LME/COMEX）——
  cu: [f('comex-hg-daily.json', 'COMEX铜HG', 1), f('lme-cad-daily.json', 'LME铜CAD', 0.95)],
  bc: [f('lme-cad-daily.json', 'LME铜CAD', 1), f('comex-hg-daily.json', 'COMEX铜HG', 0.95)],
  al: [f('lme-ahd-daily.json', 'LME铝AHD', 1)],
  ao: [f('lme-ahd-daily.json', 'LME铝(氧化铝成本)', 0.55, 'cost')],
  ad: [f('lme-ahd-daily.json', 'LME铝(合金成本)', 0.5, 'cost')],
  zn: [f('lme-zsd-daily.json', 'LME锌ZSD', 1)],
  pb: [f('lme-pbd-daily.json', 'LME铅PBD', 1)],
  ni: [f('lme-nid-daily.json', 'LME镍NID', 1)],
  sn: [f('lme-snd-daily.json', 'LME锡SND', 1)],
  ss: [f('lme-nid-daily.json', 'LME镍(不锈钢成本)', 0.55, 'cost')],
  // —— 能化 ——
  sc: [
    f('comex-cl-daily.json', 'WTI CL', 1),
    f('ice-oil-daily.json', 'Brent OIL', 0.95),
    f('fred-wti-daily.json', 'FRED WTI', 0.85),
    f('fred-brent-daily.json', 'FRED Brent', 0.8),
  ],
  fu: [f('ice-oil-daily.json', 'Brent OIL', 0.85), f('comex-cl-daily.json', 'WTI CL', 0.75)],
  lu: [f('ice-oil-daily.json', 'Brent OIL', 0.9), f('nymex-ho-daily.json', '取暖油HO', 0.55, 'cost')],
  bu: [f('comex-cl-daily.json', 'WTI(沥青成本)', 0.55, 'cost'), f('ice-oil-daily.json', 'Brent(沥青成本)', 0.5, 'cost')],
  pg: [f('nymex-ng-daily.json', '天然气NG', 1)],
  l: [f('comex-cl-daily.json', 'WTI(塑料成本)', 0.45, 'cost')],
  v: [f('comex-cl-daily.json', 'WTI(PVC成本)', 0.4, 'cost')],
  pp: [f('comex-cl-daily.json', 'WTI(PP成本)', 0.45, 'cost')],
  eg: [f('comex-cl-daily.json', 'WTI(乙二醇成本)', 0.45, 'cost')],
  eb: [f('comex-cl-daily.json', 'WTI(苯乙烯成本)', 0.4, 'cost')],
  TA: [f('comex-cl-daily.json', 'WTI(PTA成本)', 0.4, 'cost')],
  MA: [f('comex-cl-daily.json', 'WTI(甲醇成本)', 0.35, 'cost')],
  PX: [f('comex-cl-daily.json', 'WTI(PX成本)', 0.4, 'cost')],
  PF: [f('comex-cl-daily.json', 'WTI(短纤成本)', 0.35, 'cost')],
  PR: [f('comex-cl-daily.json', 'WTI(瓶片成本)', 0.35, 'cost')],
  // —— 黑色 ——
  i: [f('sgx-fef-daily.json', 'SGX铁矿FEF', 1)],
  rb: [f('sgx-fef-daily.json', 'SGX铁矿(螺纹成本)', 0.5, 'cost')],
  hc: [f('sgx-fef-daily.json', 'SGX铁矿(热卷成本)', 0.5, 'cost')],
  // —— 橡胶 ——
  ru: [f('tocom-rss3-daily.json', 'RSS3橡胶', 1)],
  nr: [f('tocom-rss3-daily.json', 'RSS3橡胶', 0.95)],
  br: [f('tocom-rss3-daily.json', 'RSS3(合成胶参照)', 0.4, 'cost')],
  // —— 油脂油料 / 谷物 ——
  a: [f('cbot-s-daily.json', 'CBOT大豆S', 1)],
  b: [f('cbot-s-daily.json', 'CBOT大豆S', 0.95)],
  y: [f('cbot-bo-daily.json', 'CBOT豆油BO', 1)],
  m: [f('cbot-sm-daily.json', 'CBOT豆粕SM', 1)],
  p: [f('bmd-fcpo-daily.json', 'BMD棕榈FCPO', 1)],
  c: [f('cbot-c-daily.json', 'CBOT玉米C', 1)],
  cs: [f('cbot-c-daily.json', 'CBOT玉米(淀粉成本)', 0.55, 'cost')],
  WH: [f('cbot-w-daily.json', 'CBOT小麦W', 1)],
  PM: [f('cbot-w-daily.json', 'CBOT小麦W', 0.9)],
  OI: [f('cbot-rs-daily.json', 'CBOT菜籽RS', 0.85), f('cbot-bo-daily.json', 'CBOT豆油(参照)', 0.45, 'cost')],
  RM: [f('cbot-rs-daily.json', 'CBOT菜籽(菜粕)', 0.7), f('cbot-sm-daily.json', 'CBOT豆粕(参照)', 0.5, 'cost')],
  RS: [f('cbot-rs-daily.json', 'CBOT菜籽RS', 1)],
  // —— 软商品 ——
  CF: [f('ice-ct-daily.json', 'ICE棉花CT', 1)],
  CY: [f('ice-ct-daily.json', 'ICE棉花(棉纱成本)', 0.55, 'cost')],
  // —— 畜牧（弱锚，诚实标注）——
  lh: [f('cme-le-daily.json', 'CME活牛(生猪弱锚)', 0.35, 'cost')],
});

const MACRO_CLIMATE = Object.freeze([
  { file: 'fred-dxy-daily.json', label: '美元指数', invertForRiskAssets: true },
  { file: 'fred-vixcls-daily.json', label: 'VIX', invertForRiskAssets: false },
  { file: 'fred-real10y-daily.json', label: '美债实际利率', invertForRiskAssets: true },
]);

function sideFromPct(pct, deadband = 0.15) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const v = Number(pct);
  if (Math.abs(v) <= deadband) return 'flat';
  return v > 0 ? 'bull' : 'bear';
}

function movePct(bars, lookback) {
  if (!bars?.length || bars.length < lookback + 1) return { pct: null, n: bars?.length || 0, asOf: null };
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 1 - lookback];
  if (!(last?.close > 0) || !(prev?.close > 0)) return { pct: null, n: bars.length, asOf: last?.date || null };
  return {
    pct: +(((last.close - prev.close) / prev.close) * 100).toFixed(4),
    n: bars.length,
    asOf: last.date,
    from: prev.date,
  };
}

function loadDomesticBars(instrumentId) {
  try {
    const { readCachedKlines } = require('./commodity-technical-analyzer');
    const klines = readCachedKlines(instrumentId) || [];
    return klines
      .map((k) => ({
        date: String(k.date || k.day || '').slice(0, 10),
        close: Number(k.close ?? k.c ?? 0),
      }))
      .filter((b) => b.date && b.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function loadExternalPrimary(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  // 郑商所等大小写：先精确再 lower
  const specs = EXTERNAL_MAP[instrumentId] || EXTERNAL_MAP[id] || EXTERNAL_MAP[String(instrumentId || '').toUpperCase()];
  if (!specs?.length) return null;

  for (const spec of specs) {
    const { bars, source, label, rowCount, proxy } = loadHistoryBars(spec.file);
    if (bars.length >= 20) {
      const role = spec.role || 'direct';
      const roleTag = role === 'cost' ? '·成本锚' : '';
      return {
        bars,
        source: source || spec.file,
        label: `${label || spec.label}${roleTag}`,
        file: spec.file,
        n: rowCount || bars.length,
        weight: spec.weight,
        role,
        proxy: Boolean(proxy),
      };
    }
  }
  return {
    bars: [],
    source: null,
    label: specs[0]?.label || '外盘',
    file: specs[0]?.file || null,
    n: 0,
    weight: specs[0]?.weight || 1,
    role: specs[0]?.role || 'direct',
    missing: true,
  };
}

function buildMacroClimate(asOf) {
  const legs = [];
  for (const m of MACRO_CLIMATE) {
    const { bars, source, rowCount } = loadHistoryBars(m.file);
    if (bars.length < 20) {
      legs.push({
        id: m.label,
        available: false,
        display: `${m.label}·暂无`,
        dataSource: m.file,
      });
      continue;
    }
    const filtered = asOf ? bars.filter((b) => b.date <= asOf) : bars;
    const m1 = movePct(filtered, 1);
    const m5 = movePct(filtered, 5);
    legs.push({
      id: m.label,
      available: m1.pct != null,
      movePct1d: m1.pct,
      movePct5d: m5.pct,
      side1d: sideFromPct(m1.pct),
      asOf: m1.asOf,
      n: rowCount || filtered.length,
      invertForRiskAssets: m.invertForRiskAssets,
      display:
        m1.pct != null
          ? `${m.label} 1d ${m1.pct > 0 ? '+' : ''}${m1.pct.toFixed(2)}%`
          : `${m.label}·暂无`,
      dataSource: source || m.file,
    });
  }
  const available = legs.filter((l) => l.available);
  return {
    available: available.length > 0,
    legs,
    n: available.reduce((s, l) => s + (l.n || 0), 0),
    display: available.length ? available.map((l) => l.display).join(' · ') : '外盘宏观·暂无',
    dataSource: 'fred-macro-climate',
  };
}

function buildDomesticNarrative(inst, domesticBars) {
  const m1 = movePct(domesticBars, 1);
  const m5 = movePct(domesticBars, 5);
  const drivers = [];
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  if (sf?.available && sf.primaryLabel) drivers.push(`合证:${sf.primaryLabel}`);
  const basis = inst?.basis || inst?.factors?.basis;
  if (basis?.available && basis.label) drivers.push(`基差:${basis.structure || basis.label}`);
  const news = inst?.factors?.news;
  if (news?.summary) drivers.push(`资讯:${String(news.summary).slice(0, 24)}`);
  const kernel = inst?.intelligenceKernel;
  if (kernel?.mainContradiction?.label) drivers.push(`主矛盾:${kernel.mainContradiction.label}`);

  const side = sideFromPct(m1.pct) || sideFromPct(inst?.changePct) || 'flat';
  const changeFallback = inst?.changePct != null ? +Number(inst.changePct).toFixed(4) : null;

  return {
    market: 'domestic',
    side,
    movePct1d: m1.pct != null ? m1.pct : changeFallback,
    movePct5d: m5.pct,
    asOf: m1.asOf || null,
    n: m1.n || (changeFallback != null ? 1 : 0),
    nDisplay: m1.n >= 20 ? String(m1.n) : m1.n ? String(m1.n) : changeFallback != null ? '报价1' : '暂无',
    drivers: drivers.slice(0, 4),
    label:
      m1.pct != null || changeFallback != null
        ? `内盘${side === 'bull' ? '偏多' : side === 'bear' ? '偏空' : '中性'} ${
            (m1.pct != null ? m1.pct : changeFallback) > 0 ? '+' : ''
          }${(m1.pct != null ? m1.pct : changeFallback).toFixed(2)}%`
        : '内盘·暂无',
    dataSource: m1.pct != null ? 'readCachedKlines' : changeFallback != null ? 'quote' : 'missing',
  };
}

function buildExternalNarrative(ext, asOf) {
  if (!ext || ext.missing || !ext.bars?.length) {
    return {
      market: 'external',
      available: false,
      side: null,
      movePct1d: null,
      movePct5d: null,
      n: 0,
      nDisplay: '暂无',
      label: '外盘锚点·暂无',
      role: ext?.role || null,
      sources: [],
      dataSource: 'missing',
    };
  }
  const bars = asOf ? ext.bars.filter((b) => b.date <= asOf) : ext.bars;
  const m1 = movePct(bars, 1);
  const m5 = movePct(bars, 5);
  const side = sideFromPct(m1.pct);
  return {
    market: 'external',
    available: m1.pct != null,
    side,
    movePct1d: m1.pct,
    movePct5d: m5.pct,
    asOf: m1.asOf,
    from: m1.from,
    n: ext.n || bars.length,
    nDisplay: String(ext.n || bars.length),
    role: ext.role || 'direct',
    label:
      m1.pct != null
        ? `${ext.label} ${side === 'bull' ? '偏多' : side === 'bear' ? '偏空' : '中性'} ${
            m1.pct > 0 ? '+' : ''
          }${m1.pct.toFixed(2)}%`
        : `${ext.label}·暂无近期变动`,
    sources: [{ file: ext.file, label: ext.label, source: ext.source, role: ext.role }],
    dataSource: ext.source || ext.file,
  };
}

function classifyRegime(domestic, external) {
  if (!external?.available && domestic?.movePct1d == null) {
    return { regime: 'insufficient', label: '内外均不足', splitScore: null };
  }
  if (!external?.available) {
    return { regime: 'domestic_only', label: '仅内盘可叙', splitScore: null };
  }
  if (domestic?.movePct1d == null) {
    return { regime: 'external_only', label: '仅外盘可叙', splitScore: null };
  }

  const d = domestic.side;
  const e = external.side;
  if (!d || !e || d === 'flat' || e === 'flat') {
    const absGap = Math.abs((domestic.movePct1d || 0) - (external.movePct1d || 0));
    if (absGap >= 1.2) {
      return { regime: 'split', label: '幅度分裂', splitScore: +Math.min(1, absGap / 3).toFixed(3) };
    }
    return { regime: 'resonate', label: '弱共振/中性', splitScore: +Math.min(1, absGap / 3).toFixed(3) };
  }
  if (d === e) {
    return {
      regime: 'resonate',
      label: '内外共振',
      splitScore: +Math.min(
        1,
        Math.abs((domestic.movePct1d || 0) - (external.movePct1d || 0)) / 4
      ).toFixed(3),
    };
  }
  return {
    regime: 'split',
    label: '内外叙事分裂',
    splitScore: +(
      0.55 +
      Math.min(0.45, Math.abs((domestic.movePct1d || 0) - (external.movePct1d || 0)) / 5)
    ).toFixed(3),
  };
}

/**
 * @param {object} inst
 * @param {string} [asOf]
 */
function assessDualNarrative(inst, asOf) {
  const id = String(inst?.id || '').toLowerCase();
  const day = asOf || new Date().toISOString().slice(0, 10);
  const domesticBars = loadDomesticBars(id);
  const domestic = buildDomesticNarrative(inst, domesticBars);
  const hasMap = Boolean(
    EXTERNAL_MAP[inst?.id] || EXTERNAL_MAP[id] || EXTERNAL_MAP[String(inst?.id || '').toUpperCase()]
  );
  const extRaw = hasMap ? loadExternalPrimary(inst?.id || id) : null;
  const external = hasMap
    ? buildExternalNarrative(extRaw, day)
    : {
        market: 'external',
        available: false,
        side: null,
        movePct1d: null,
        movePct5d: null,
        n: 0,
        nDisplay: '暂无',
        label: '本品种无外盘锚点',
        sources: [],
        dataSource: 'unmapped',
      };

  const climate = buildMacroClimate(day);
  const { regime, label, splitScore } = classifyRegime(domestic, external);

  const available = domestic.movePct1d != null || external.available || climate.available;
  const display = available
    ? `${label} · ${domestic.label} · ${external.label}`
    : '双轨叙事·暂无';

  return {
    version: DUAL_VERSION,
    available,
    instrumentId: id,
    asOf: day,
    regime,
    regimeLabel: label,
    splitScore,
    domestic,
    external,
    macroClimate: climate,
    mapped: hasMap,
    display,
    questionHint:
      regime === 'split'
        ? `${inst?.name || id}：内外叙事分裂 — 套利/波动窗口还是政策扰动？`
        : regime === 'resonate'
          ? null
          : !hasMap
            ? null
            : `${inst?.name || id}：外盘锚点不足，能否补序列？`,
    dataSource: 'intel-dual-narrative',
    method: 'domestic-klines-vs-external-series',
  };
}

function attachDualNarrativeToInstrument(inst, asOf) {
  if (!inst?.id) return inst;
  const dualNarrative = assessDualNarrative(inst, asOf);
  return {
    ...inst,
    dualNarrative,
    factors: {
      ...(inst.factors || {}),
      dualNarrative,
    },
  };
}

module.exports = {
  DUAL_VERSION,
  EXTERNAL_MAP,
  assessDualNarrative,
  attachDualNarrativeToInstrument,
  buildMacroClimate,
  mappedInstrumentIds: () => Object.keys(EXTERNAL_MAP),
};
