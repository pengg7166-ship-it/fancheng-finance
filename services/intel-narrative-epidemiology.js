/**
 * 情报中心 · 叙事流行病学（构想 §22）
 * 不只是关键词热度：用 news-tagged 真实日期做主题×品种首见时序，
 * 推导种子→采纳滞后、R₀(采纳/种子)、相位；n=0 标暂无，禁止用 shock 冒充传染分。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const NARRATIVE_VERSION = 'v2.89.23-narrative-sir-ceiling';

const THEME_PATTERNS = [
  { id: 'destock', label: '去库叙事', re: /去库|库存下降|低库存|去库存/ },
  { id: 'production_cut', label: '减产叙事', re: /减产|限产|检修|供应收紧/ },
  { id: 'stimulus', label: '刺激叙事', re: /刺激|宽松|降准|降息|基建/ },
  { id: 'geo', label: '地缘叙事', re: /地缘|制裁|冲突|封锁|战争|OFAC/ },
  { id: 'weather', label: '天气叙事', re: /天气|干旱|降雨|洪涝|霜冻/ },
  { id: 'policy', label: '政策叙事', re: /政策|监管|关税|收储|抛储/ },
];

const DEFAULT_LOOKBACK_DAYS = 21;
const DEFAULT_MAX_LAG_DAYS = 14;
const DEFAULT_RECOVERY_WINDOW_DAYS = 14;

let _newsCache = null;
let _newsCacheAt = 0;
let _dynCache = { asOf: null, lookback: null, maxLag: null, data: null, at: 0 };

function loadNewsTaggedRows() {
  const now = Date.now();
  if (_newsCache && now - _newsCacheAt < 10 * 60 * 1000) return _newsCache;
  const dataDir = getDataDir();
  const fp = dataDir ? path.join(dataDir, 'history', 'news-tagged.csv') : null;
  if (!fp || !fs.existsSync(fp)) {
    _newsCache = [];
    _newsCacheAt = now;
    return _newsCache;
  }
  try {
    const lines = fs.readFileSync(fp, 'utf8').split(/\n/).filter(Boolean);
    const rows = [];
    const seen = new Set();
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split(',');
      if (parts.length < 3) continue;
      const date = String(parts[0] || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const title = String(parts[1] || '').trim();
      const dedupeKey = `${date}|${title.slice(0, 80)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const tags = String(parts[2] || '')
        .split(/[;|]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      rows.push({ date, title, tags });
    }
    _newsCache = rows;
    _newsCacheAt = now;
    return rows;
  } catch {
    _newsCache = [];
    _newsCacheAt = now;
    return _newsCache;
  }
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

function countThemesForInstrument(instrumentId, asOf, windowDays) {
  const id = String(instrumentId || '').toLowerCase();
  const rows = loadNewsTaggedRows();
  const counts = {};
  let n = 0;
  for (const t of THEME_PATTERNS) counts[t.id] = 0;
  for (const r of rows) {
    const d = daysBetween(r.date, asOf);
    if (d < 0 || d > windowDays) continue;
    if (id && r.tags.length && !r.tags.includes(id) && !r.tags.some((t) => t === id)) {
      continue;
    }
    if (id && r.tags.length === 0) continue;
    n += 1;
    for (const t of THEME_PATTERNS) {
      if (t.re.test(r.title)) counts[t.id] += 1;
    }
  }
  return { counts, n, windowDays };
}

function classifyNewsThemes(news) {
  const hits = news?.hits || [];
  const themes = {};
  const seen = new Set();
  for (const h of hits) {
    const text = `${h.title || ''} ${h.summary || ''}`.trim();
    const key = text.slice(0, 96);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const t of THEME_PATTERNS) {
      if (t.re.test(text)) themes[t.id] = (themes[t.id] || 0) + 1;
    }
  }
  return themes;
}

/** 近期 vs 前期真实增速；缺样本返回 null */
function growthRate(recent, prior) {
  if (recent == null || prior == null) return null;
  if (prior === 0 && recent === 0) return 0;
  if (prior === 0) return null; // 不可造「无穷增速」
  return +((recent - prior) / prior).toFixed(3);
}

/**
 * 主题×品种首见时序 → 跨品种传染边与 R₀
 * R₀ = 滞后窗内采纳品种数 / 种子数；单品种无跨传时 R₀=暂无
 */
function computeThemeTransmissionDynamics(asOfInput, opts = {}) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxLagDays = opts.maxLagDays ?? DEFAULT_MAX_LAG_DAYS;
  const rows = opts.rows || loadNewsTaggedRows();

  /** @type {Record<string, Record<string, { first: string, last: string, n: number }>>} */
  const timeline = {};
  for (const r of rows) {
    const d = daysBetween(r.date, asOf);
    if (d < 0 || d > lookbackDays) continue;
    for (const th of THEME_PATTERNS) {
      if (!th.re.test(r.title)) continue;
      if (!timeline[th.id]) timeline[th.id] = {};
      for (const id of r.tags) {
        if (!timeline[th.id][id]) timeline[th.id][id] = { first: r.date, last: r.date, n: 0 };
        const e = timeline[th.id][id];
        e.n += 1;
        if (r.date < e.first) e.first = r.date;
        if (r.date > e.last) e.last = r.date;
      }
    }
  }

  const byTheme = {};
  const edges = [];

  for (const th of THEME_PATTERNS) {
    const map = timeline[th.id] || {};
    const infected = Object.entries(map)
      .map(([id, e]) => ({ id, first: e.first, last: e.last, n: e.n }))
      .sort((a, b) => a.first.localeCompare(b.first) || b.n - a.n);
    if (!infected.length) continue;

    const seedFirst = infected[0].first;
    const seeds = infected.filter((i) => i.first === seedFirst);
    const seedIds = new Set(seeds.map((s) => s.id));
    const primarySeed = seeds[0].id;

    for (const i of infected) {
      if (seedIds.has(i.id)) {
        i.role = seeds.length > 1 ? 'co-seed' : 'seed';
        i.lagFromSeedDays = 0;
        i.seedId = primarySeed;
      } else {
        const lag = daysBetween(seedFirst, i.first);
        i.lagFromSeedDays = lag;
        i.seedId = primarySeed;
        i.role = lag > 0 && lag <= maxLagDays ? 'adopter' : 'late';
      }
      i.infectionAgeDays = daysBetween(i.first, asOf);
    }

    const adopters = infected.filter((i) => i.role === 'adopter');
    const seedCount = seeds.length;
    const adopterCount = adopters.length;
    let R0 = null;
    let R0Display = '暂无';
    if (seedCount >= 1 && infected.length >= 2 && adopterCount >= 0) {
      // 至少 2 品种才谈跨传；采纳可为 0（同日共种子无滞后采纳）
      if (adopterCount > 0) {
        R0 = +(adopterCount / seedCount).toFixed(2);
        R0Display = `${R0} (${adopterCount}/${seedCount})`;
      } else if (seeds.length >= 2) {
        R0Display = `暂无滞后采纳 (共种子${seeds.length})`;
      } else {
        R0Display = '暂无（无滞后采纳）';
      }
    } else if (infected.length === 1) {
      R0Display = '暂无（单品种·无跨传）';
    }

    // 滞后统计：仅真实采纳滞后，n<2 标暂无（禁止假均值）
    const lagVals = adopters.map((a) => a.lagFromSeedDays).filter((d) => d != null && Number.isFinite(d));
    let lagStats = {
      available: false,
      nAdopters: lagVals.length,
      nDisplay: lagVals.length ? String(lagVals.length) : '暂无',
      medianLagDays: null,
      meanLagDays: null,
      maxLagDays: null,
      lagStatsDisplay: '暂无',
      method: 'theme-first-seen-lag-stats',
      dataSource: 'news-tagged.csv',
    };
    if (lagVals.length >= 2) {
      const sorted = [...lagVals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 ? sorted[mid] : +((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1);
      const mean = +(lagVals.reduce((s, v) => s + v, 0) / lagVals.length).toFixed(1);
      const maxLag = Math.max(...lagVals);
      lagStats = {
        ...lagStats,
        available: true,
        medianLagDays: median,
        meanLagDays: mean,
        maxLagDays: maxLag,
        lagStatsDisplay: `中位滞后 ${median}日 (n=${lagVals.length})`,
      };
    } else if (lagVals.length === 1) {
      lagStats = {
        ...lagStats,
        nAdopters: 1,
        nDisplay: '1',
        lagStatsDisplay: '暂无（采纳 n<2）',
        note: '单采纳不做中位滞后',
      };
    }

    for (const a of adopters) {
      const nFrom = map[a.seedId]?.n ?? null;
      const seedFirst = map[a.seedId]?.first || null;
      edges.push({
        themeId: th.id,
        themeLabel: th.label,
        from: a.seedId,
        to: a.id,
        lagDays: a.lagFromSeedDays,
        seedFirst,
        adopterFirst: a.first,
        nFrom,
        nTo: a.n,
        nDisplay: nFrom != null ? `${nFrom}→${a.n}` : `暂无→${a.n}`,
        display: `${a.seedId}→${a.id} · ${th.label} · 滞后${a.lagFromSeedDays}日 · 首见${seedFirst || '暂无'}→${a.first} · n ${nFrom != null ? nFrom : '暂无'}→${a.n}`,
        dataSource: 'news-tagged.csv',
        method: 'theme-first-seen-lag-transmission',
      });
    }

    const recentAdopters = adopters.filter((a) => daysBetween(a.first, asOf) <= 3).length;
    const totalN = infected.reduce((s, i) => s + i.n, 0);

    byTheme[th.id] = {
      themeId: th.id,
      themeLabel: th.label,
      infected,
      seeds: seeds.map((s) => s.id),
      seedCount,
      adopterCount,
      lateCount: infected.filter((i) => i.role === 'late').length,
      instrumentCount: infected.length,
      R0,
      R0Display,
      lagStats,
      recentAdopters,
      totalN,
      nDisplay: String(totalN),
      spreading: adopterCount >= 1 && infected.length >= 2,
      display: `${th.label} · 感染${infected.length} · R₀ ${R0Display}${
        lagStats.available ? ` · ${lagStats.lagStatsDisplay}` : ''
      }${recentAdopters ? ` · 近3日新采纳${recentAdopters}` : ''} · n=${totalN}`,
    };
  }

  edges.sort((a, b) => a.lagDays - b.lagDays || (b.nTo || 0) - (a.nTo || 0));

  return {
    version: NARRATIVE_VERSION,
    asOf,
    lookbackDays,
    maxLagDays,
    byTheme,
    themes: Object.values(byTheme).sort(
      (a, b) => b.instrumentCount - a.instrumentCount || b.totalN - a.totalN
    ),
    edges,
    counts: {
      themes: Object.keys(byTheme).length,
      multiInstrument: Object.values(byTheme).filter((t) => t.instrumentCount >= 2).length,
      edges: edges.length,
      withR0: Object.values(byTheme).filter((t) => t.R0 != null).length,
      infectedInstruments: new Set(
        Object.values(byTheme).flatMap((t) => t.infected.map((i) => i.id))
      ).size,
    },
    note: 'R₀=滞后窗内采纳数/种子数；仅来自 news-tagged 首见日期，非关键词热度分',
    dataSource: 'news-tagged.csv',
    method: 'theme-first-seen-lag-transmission',
  };
}

function getThemeTransmissionDynamics(asOfInput, opts = {}) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxLagDays = opts.maxLagDays ?? DEFAULT_MAX_LAG_DAYS;
  const now = Date.now();
  if (
    !opts.rows &&
    _dynCache.data &&
    _dynCache.asOf === asOf &&
    _dynCache.lookback === lookbackDays &&
    _dynCache.maxLag === maxLagDays &&
    now - _dynCache.at < 10 * 60 * 1000
  ) {
    return _dynCache.data;
  }
  const data = computeThemeTransmissionDynamics(asOf, opts);
  if (!opts.rows) {
    _dynCache = { asOf, lookback: lookbackDays, maxLag: maxLagDays, data, at: now };
  }
  return data;
}

/**
 * 离散 S/I/R 仓室快照（非微分方程、不拟合 β/γ）
 * S=跨传主题中尚未首见；I=感染年龄≤恢复窗；R=疲劳/超窗/late
 */
function buildDiscreteSirCensus(dynamics, instruments, asOf, opts = {}) {
  const recoveryWindowDays = opts.recoveryWindowDays ?? DEFAULT_RECOVERY_WINDOW_DAYS;
  const universe = new Set(
    (instruments || [])
      .map((i) => String(i?.id || '').toLowerCase())
      .filter(Boolean)
  );
  const multiThemes = Object.values(dynamics?.byTheme || {}).filter((t) => t.instrumentCount >= 2);
  const infectedIds = new Set();
  const infectiousIds = new Set();
  const recoveredIds = new Set();

  for (const th of multiThemes) {
    for (const i of th.infected || []) {
      const id = String(i.id || '').toLowerCase();
      if (!id) continue;
      infectedIds.add(id);
      const age = i.infectionAgeDays;
      const isLate = i.role === 'late';
      if (isLate || (age != null && age > recoveryWindowDays)) {
        recoveredIds.add(id);
      } else {
        infectiousIds.add(id);
      }
    }
  }

  // R 优先于 I（超窗从 I 移出）
  for (const id of recoveredIds) infectiousIds.delete(id);

  let S = 0;
  if (multiThemes.length && universe.size) {
    for (const id of universe) {
      if (!infectedIds.has(id)) S += 1;
    }
  } else {
    S = null;
  }

  const I = infectiousIds.size;
  const R = recoveredIds.size;
  const nUniverse = universe.size || null;
  const available = multiThemes.length > 0 && nUniverse != null && nUniverse > 0;

  const byTheme = multiThemes.slice(0, 8).map((th) => {
    const themeInfected = new Set((th.infected || []).map((i) => String(i.id).toLowerCase()));
    let sTheme = 0;
    if (universe.size) {
      for (const id of universe) {
        if (!themeInfected.has(id)) sTheme += 1;
      }
    }
    let iTheme = 0;
    let rTheme = 0;
    for (const i of th.infected || []) {
      const age = i.infectionAgeDays;
      if (i.role === 'late' || (age != null && age > recoveryWindowDays)) rTheme += 1;
      else iTheme += 1;
    }
    return {
      themeId: th.themeId,
      themeLabel: th.themeLabel,
      S: universe.size ? sTheme : null,
      I: iTheme,
      R: rTheme,
      lagStats: th.lagStats || null,
      R0Display: th.R0Display || '暂无',
      nDisplay: th.nDisplay || '暂无',
    };
  });

  const lagThemes = multiThemes
    .filter((t) => t.lagStats?.available)
    .sort((a, b) => (a.lagStats.medianLagDays || 99) - (b.lagStats.medianLagDays || 99));
  const lagSummary =
    lagThemes.length > 0
      ? lagThemes
          .slice(0, 3)
          .map((t) => `${t.themeLabel} ${t.lagStats.lagStatsDisplay}`)
          .join(' · ')
      : '暂无';

  return {
    available,
    S: available ? S : null,
    I: available ? I : null,
    R: available ? R : null,
    nUniverse: nUniverse ?? null,
    nDisplay: available ? String(nUniverse) : '暂无',
    recoveryWindowDays,
    byTheme,
    lagSummary,
    display: available
      ? `离散SIR S${S}·I${I}·R${R} (宇宙n=${nUniverse} · 恢复${recoveryWindowDays}日)`
      : '离散SIR 暂无（跨传主题或品种宇宙不足）',
    note: 'S/I/R=日切仓室快照；拒绝 ODE/β/γ 拟合',
    method: 'discrete-sir-census',
    dataSource: 'news-tagged.csv',
    odeFitted: false,
    differentialEq: false,
  };
}

function buildSirCeiling(sirCensus) {
  return {
    odeFitted: false,
    differentialEq: false,
    method: sirCensus?.method || 'discrete-sir-census',
    censusAvailable: Boolean(sirCensus?.available),
    display: sirCensus?.available
      ? `叙事上限 · ${sirCensus.display}`
      : '叙事上限 · 离散仓室就绪 · ODE 拒绝',
    note: '诚实上限=离散仓室+滞后统计；拒绝微分方程 SIR 拟合',
    dataSource: 'intel-narrative-epidemiology',
  };
}

function resolveTransmissionForInstrument(instrumentId, themeId, dynamics, asOf) {
  const id = String(instrumentId || '').toLowerCase();
  if (!themeId || !dynamics?.byTheme?.[themeId]) {
    return {
      role: 'unknown',
      roleLabel: '传播角色暂无',
      seedId: null,
      lagFromSeedDays: null,
      infectionAgeDays: null,
      R0: null,
      R0Display: '暂无',
      themeId: themeId || null,
      n: null,
      nDisplay: '暂无',
    };
  }
  const th = dynamics.byTheme[themeId];
  const entry = th.infected.find((i) => i.id === id);
  if (!entry) {
    return {
      role: th.instrumentCount >= 2 ? 'susceptible' : 'unknown',
      roleLabel: th.instrumentCount >= 2 ? '未感染（主题跨传中）' : '传播角色暂无',
      seedId: th.seeds[0] || null,
      lagFromSeedDays: null,
      infectionAgeDays: null,
      R0: th.R0,
      R0Display: th.R0Display,
      themeId,
      n: null,
      nDisplay: '暂无',
    };
  }
  const roleLabel =
    entry.role === 'seed'
      ? '种子'
      : entry.role === 'co-seed'
        ? '共种子'
        : entry.role === 'adopter'
          ? '采纳者'
          : entry.role === 'late'
            ? '晚期出现'
            : '未知';
  return {
    role: entry.role,
    roleLabel,
    seedId: entry.seedId,
    lagFromSeedDays: entry.lagFromSeedDays,
    infectionAgeDays: entry.infectionAgeDays ?? daysBetween(entry.first, asOf),
    firstSeen: entry.first,
    R0: th.R0,
    R0Display: th.R0Display,
    themeId,
    n: entry.n,
    nDisplay: String(entry.n),
  };
}

function assessNarrativeEpidemiology(inst, asOfInput) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const news = inst?.factors?.news;
  const liveThemes = classifyNewsThemes(news);

  const w1 = countThemesForInstrument(inst?.id, asOf, 1);
  const w3 = countThemesForInstrument(inst?.id, asOf, 3);
  const w7 = countThemesForInstrument(inst?.id, asOf, 7);

  // 近期 3d vs 前期 4d（7d 窗内除去近 3d）真实比，不做 4/3 伪缩放
  const recent3 = w3.n;
  const prior4 = Math.max(0, w7.n - w3.n);
  const velocity = w7.n >= 3 ? growthRate(recent3, prior4) : null;

  const taggedThemes = Object.fromEntries(Object.entries(w3.counts).filter(([, c]) => c > 0));
  const dominantTheme = Object.entries({ ...liveThemes, ...taggedThemes }).sort(
    (a, b) => b[1] - a[1]
  )[0];

  const liveHits = news?.hitCount ?? 0;
  const sampleN = w7.n;
  const hasTagged = sampleN > 0;
  const themeId = dominantTheme ? dominantTheme[0] : null;
  const dynamics = getThemeTransmissionDynamics(asOf);
  const transmission = resolveTransmissionForInstrument(inst?.id, themeId, dynamics, asOf);

  let phase = 'dormant';
  let label = '萌芽/无';

  // 相位：tagged n + 速度 + 跨品种采纳；禁止用 shock 抬到 spreading/peak
  const crossSpread =
    hasTagged &&
    transmission.role === 'adopter' &&
    transmission.lagFromSeedDays != null &&
    transmission.lagFromSeedDays <= 7 &&
    w3.n >= 1;

  if (!hasTagged && liveHits === 0) {
    phase = 'dormant';
    label = '萌芽/无';
  } else if (hasTagged && velocity != null && velocity >= 1.2 && w3.n >= 3) {
    phase = 'spreading';
    label = '扩散·传染加速';
  } else if (crossSpread) {
    phase = 'spreading';
    label = '扩散·跨品种传染';
  } else if (
    hasTagged &&
    w3.n >= 4 &&
    velocity != null &&
    velocity > -0.2 &&
    velocity < 0.5 &&
    prior4 >= 2
  ) {
    phase = 'peak';
    label = '高峰·增速放缓';
  } else if (
    hasTagged &&
    ((velocity != null && velocity < -0.3 && w7.n >= 3) ||
      (velocity != null && velocity < -0.15 && w3.n >= 2 && prior4 > recent3))
  ) {
    phase = 'fatigue';
    label = '疲劳';
  } else if (hasTagged || liveHits >= 1) {
    phase = 'emerging';
    label = hasTagged ? '萌芽' : '萌芽·仅直播（无 tagged n）';
  }

  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const structureFollows =
    sf?.available && sf.structureBias && sf.structureBias !== 'flat' && sf.structureBias !== 'mixed';
  const narrativeAhead = (phase === 'spreading' || phase === 'peak') && !structureFollows;

  let alert = null;
  const pricing = inst?.intelCenter?.pricingState?.state;
  if (narrativeAhead && pricing !== 'mispriced') alert = '故事加速但合证未跟 — 警惕叙事绑架';
  if (phase === 'fatigue' && pricing === 'priced-in') alert = '叙事疲劳且已定价 — 利好出尽风险';

  // score：仅 velocity；禁止 shock 冒充分数
  let score = null;
  if (hasTagged && velocity != null) score = Math.min(1, Math.abs(velocity) / 2);

  const txBit =
    transmission.role === 'seed' || transmission.role === 'co-seed'
      ? ` · ${transmission.roleLabel} R₀ ${transmission.R0Display}`
      : transmission.role === 'adopter'
        ? ` · 自${transmission.seedId}滞后${transmission.lagFromSeedDays}日采纳`
        : '';

  return {
    version: NARRATIVE_VERSION,
    phase,
    label,
    score,
    scoreDisplay: score == null ? '暂无' : score.toFixed(2),
    hitCount: liveHits || w3.n,
    themeCount:
      Object.keys(liveThemes).length || Object.values(w3.counts).filter((c) => c > 0).length,
    themes: Object.keys(liveThemes).length ? liveThemes : w3.counts,
    dominantTheme: dominantTheme ? { id: dominantTheme[0], count: dominantTheme[1] } : null,
    contagion: {
      n1d: w1.n,
      n3d: w3.n,
      n7d: w7.n,
      prior4d: prior4,
      velocity,
      velocityDisplay:
        velocity == null ? '暂无' : `${velocity > 0 ? '+' : ''}${(velocity * 100).toFixed(0)}%`,
      nDisplay: hasTagged ? String(sampleN) : '暂无',
      dataSource: hasTagged ? 'news-tagged.csv' : 'missing',
      deduped: true,
    },
    transmission: {
      ...transmission,
      lookbackDays: dynamics.lookbackDays,
      maxLagDays: dynamics.maxLagDays,
      method: 'theme-first-seen-lag-transmission',
    },
    narrativeAhead,
    narrativeAheadLabel: narrativeAhead ? '叙事超前于结构' : null,
    alert,
    display: `${label}${narrativeAhead ? ' · 叙事超前于结构' : ''}${txBit}${
      velocity != null && hasTagged
        ? ` · 速度${velocity > 0 ? '+' : ''}${(velocity * 100).toFixed(0)}% (n=${sampleN})`
        : hasTagged
          ? ` · n=${sampleN}`
          : ' · 传染暂无'
    }`,
    n: hasTagged ? sampleN : null,
    nDisplay: hasTagged ? String(sampleN) : '暂无',
    dataSource: 'intel-narrative-epidemiology',
    method: 'first-seen-transmission+window-velocity',
  };
}

function buildSectorNarrativeHeatmap(instruments, asOf) {
  const bySector = {};
  for (const inst of instruments || []) {
    const n = inst?.intelCenter?.narrative || assessNarrativeEpidemiology(inst, asOf);
    if (n.phase === 'dormant') continue;
    const sec = inst.sector || 'other';
    if (!bySector[sec]) bySector[sec] = { count: 0, peak: 0, ahead: 0, spreading: 0 };
    bySector[sec].count += 1;
    if (n.phase === 'peak') bySector[sec].peak += 1;
    if (n.phase === 'spreading') bySector[sec].spreading += 1;
    if (n.narrativeAhead) bySector[sec].ahead += 1;
  }
  return {
    version: NARRATIVE_VERSION,
    sectors: bySector,
    dataSource: 'intel-narrative-epidemiology',
  };
}

/**
 * Pack 级叙事传染板：跨品种传播路径 + 主题簇 + 超前于结构
 * 仅用 tagged 首见日期与窗计数；禁止用 shock 冒充传染。
 */
function buildNarrativeContagionBoard(instruments, asOfInput) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dynamics = getThemeTransmissionDynamics(asOf);
  const rows = [];
  const themeClusters = {};
  const nameById = {};
  for (const inst of instruments || []) {
    if (inst?.id) nameById[String(inst.id).toLowerCase()] = inst.name || inst.id;
  }

  for (const inst of instruments || []) {
    const n = inst?.intelCenter?.narrative || assessNarrativeEpidemiology(inst, asOf);
    if (!n || n.phase === 'dormant') continue;
    if (n.n == null && n.phase === 'emerging' && (n.hitCount || 0) === 0) continue;

    const themeId = n.dominantTheme?.id || null;
    const themeLabel = themeId
      ? THEME_PATTERNS.find((t) => t.id === themeId)?.label || themeId
      : '主题暂无';

    const row = {
      instrumentId: inst.id,
      instrumentName: inst.name,
      sector: inst.sector || 'other',
      phase: n.phase,
      phaseLabel: n.label,
      themeId,
      themeLabel,
      narrativeAhead: !!n.narrativeAhead,
      alert: n.alert || null,
      n: n.n ?? null,
      nDisplay: n.nDisplay || '暂无',
      velocityDisplay: n.contagion?.velocityDisplay || '暂无',
      scoreDisplay: n.scoreDisplay || '暂无',
      transmissionRole: n.transmission?.role || 'unknown',
      transmissionRoleLabel: n.transmission?.roleLabel || '传播角色暂无',
      lagFromSeedDays: n.transmission?.lagFromSeedDays ?? null,
      seedId: n.transmission?.seedId || null,
      R0Display: n.transmission?.R0Display || '暂无',
      display: n.display,
      dataSource: n.dataSource,
    };
    rows.push(row);

    if (themeId && n.n != null && n.n >= 1) {
      if (!themeClusters[themeId]) {
        themeClusters[themeId] = {
          themeId,
          themeLabel,
          instruments: [],
          aheadCount: 0,
          spreadingCount: 0,
          peakCount: 0,
          totalN: 0,
        };
      }
      const c = themeClusters[themeId];
      c.instruments.push({
        id: inst.id,
        name: inst.name,
        phase: n.phase,
        n: n.n,
        ahead: !!n.narrativeAhead,
        role: n.transmission?.role || null,
      });
      c.totalN += n.n;
      if (n.narrativeAhead) c.aheadCount += 1;
      if (n.phase === 'spreading') c.spreadingCount += 1;
      if (n.phase === 'peak') c.peakCount += 1;
    }
  }

  const clusters = Object.values(themeClusters)
    .map((c) => {
      const dyn = dynamics.byTheme[c.themeId];
      return {
        ...c,
        instrumentCount: c.instruments.length,
        spreading: c.instrumentCount >= 2 && c.spreadingCount + c.peakCount >= 1,
        R0: dyn?.R0 ?? null,
        R0Display: dyn?.R0Display || '暂无',
        seedIds: dyn?.seeds || [],
        adopterCount: dyn?.adopterCount ?? null,
        nDisplay: String(c.totalN),
        display: `${c.themeLabel} · ${c.instruments.length} 品种 · R₀ ${dyn?.R0Display || '暂无'} · n=${c.totalN}${
          c.aheadCount ? ` · 超前${c.aheadCount}` : ''
        }`,
      };
    })
    .sort((a, b) => b.instrumentCount - a.instrumentCount || b.totalN - a.totalN);

  const ahead = rows.filter((r) => r.narrativeAhead);
  const spreading = rows.filter((r) => r.phase === 'spreading' || r.phase === 'peak');
  const fatigue = rows.filter((r) => r.phase === 'fatigue');
  const seeds = rows.filter((r) => r.transmissionRole === 'seed' || r.transmissionRole === 'co-seed');
  const adopters = rows.filter((r) => r.transmissionRole === 'adopter');

  const transmissionEdges = (dynamics.edges || []).slice(0, 16).map((e) => ({
    ...e,
    fromName: nameById[e.from] || e.from,
    toName: nameById[e.to] || e.to,
    lagDisplay: e.lagDays != null ? `${e.lagDays}日` : '暂无',
    display: `${nameById[e.from] || e.from}→${nameById[e.to] || e.to} · ${e.themeLabel} · 滞后${e.lagDays != null ? e.lagDays : '暂无'}日 · n ${e.nDisplay}`,
  }));

  const questions = ahead.slice(0, 6).map((r) => ({
    priority: 'P2',
    score: 32,
    instrumentId: r.instrumentId,
    instrumentName: r.instrumentName,
    question: `${r.instrumentName}：叙事「${r.themeLabel}」超前于合证 — ${r.alert || '是否叙事绑架'}？`,
    reasons: ['叙事传染板', `phase=${r.phase}`, `n=${r.nDisplay}`, `角色=${r.transmissionRoleLabel}`],
    narrativePhase: r.phase,
    dataSource: 'intel-narrative-epidemiology',
  }));

  for (const c of clusters.filter((x) => x.spreading || (x.adopterCount || 0) >= 1).slice(0, 4)) {
    const lead = c.instruments.find((i) => i.role === 'seed' || i.role === 'co-seed') || c.instruments[0];
    questions.push({
      priority: 'P3',
      score: 26,
      instrumentId: lead.id,
      instrumentName: lead.name,
      question: `主题「${c.themeLabel}」跨 ${c.instrumentCount} 品种传染 R₀ ${c.R0Display} (n=${c.nDisplay}) — 结构是否跟上？`,
      reasons: ['叙事跨品种传染', `R0=${c.R0Display}`, ...c.instruments.slice(0, 3).map((i) => i.id)],
      themeId: c.themeId,
      dataSource: 'intel-narrative-epidemiology',
    });
  }

  for (const e of transmissionEdges.slice(0, 4)) {
    questions.push({
      priority: 'P3',
      score: 22,
      instrumentId: e.to,
      instrumentName: e.toName,
      question: `${e.fromName}→${e.toName}：「${e.themeLabel}」滞后 ${e.lagDays} 日传染 (n ${e.nDisplay}) — 是成本传导还是叙事跟风？`,
      reasons: ['叙事感染路径', e.display],
      themeId: e.themeId,
      dataSource: 'intel-narrative-epidemiology',
    });
  }

  const compartmentCounts = {
    active: rows.length,
    seeds: seeds.length,
    adopters: adopters.length,
    spreading: spreading.length,
    fatigue: fatigue.length,
    susceptibleThemes: dynamics.counts.multiInstrument,
    note: '仓室计数=种子/采纳/扩散/疲劳；非微分方程 SIR',
    method: 'discrete-compartment-counts',
  };
  const sirCensus = buildDiscreteSirCensus(dynamics, instruments, asOf, {
    recoveryWindowDays: DEFAULT_RECOVERY_WINDOW_DAYS,
  });
  const sirCeiling = buildSirCeiling(sirCensus);
  const sir = {
    ...compartmentCounts,
    ...sirCensus,
    ceiling: sirCeiling,
    note: sirCensus.note || compartmentCounts.note,
    method: sirCensus.method,
  };

  return {
    version: NARRATIVE_VERSION,
    asOf,
    rows: rows.slice(0, 40),
    ahead: ahead.slice(0, 12),
    spreading: spreading.slice(0, 12),
    fatigue: fatigue.slice(0, 8),
    seeds: seeds.slice(0, 8),
    adopters: adopters.slice(0, 12),
    clusters: clusters.slice(0, 10),
    transmission: {
      lookbackDays: dynamics.lookbackDays,
      maxLagDays: dynamics.maxLagDays,
      edges: transmissionEdges,
      themes: (dynamics.themes || []).slice(0, 8).map((t) => ({
        themeId: t.themeId,
        themeLabel: t.themeLabel,
        instrumentCount: t.instrumentCount,
        R0: t.R0,
        R0Display: t.R0Display,
        seedIds: t.seeds,
        adopterCount: t.adopterCount,
        nDisplay: t.nDisplay,
        lagStats: t.lagStats || null,
        display: t.display,
      })),
      counts: dynamics.counts,
      method: dynamics.method,
      dataSource: dynamics.dataSource,
    },
    compartmentCounts,
    sirCensus,
    sirCeiling,
    sir,
    questions,
    counts: {
      active: rows.length,
      ahead: ahead.length,
      spreading: spreading.length,
      fatigue: fatigue.length,
      clusters: clusters.length,
      multiInstrumentThemes: clusters.filter((c) => c.instrumentCount >= 2).length,
      transmissionEdges: transmissionEdges.length,
      seeds: seeds.length,
      adopters: adopters.length,
      themesWithR0: dynamics.counts.withR0,
      sirAvailable: sirCensus.available ? 1 : 0,
      lagStatsReady: Object.values(dynamics.byTheme || {}).filter((t) => t.lagStats?.available).length,
    },
    display:
      transmissionEdges.length || ahead.length || clusters.filter((c) => c.spreading).length
        ? `叙事板 传染边${transmissionEdges.length} · 超前${ahead.length} · 扩散/高峰${spreading.length} · R₀主题${dynamics.counts.withR0}${
            sirCensus.available ? ` · ${sirCensus.display}` : ''
          }`
        : rows.length
          ? `叙事板 活跃${rows.length} · 暂无显著跨品种传染${sirCensus.available ? ` · ${sirCensus.display}` : ''}`
          : '叙事板 暂无（tagged n 不足）',
    note: '传染边/R₀/离散SIR 来自 news-tagged 首见；拒绝 ODE；无 n 不标 spreading/peak',
    dataSource: 'intel-narrative-epidemiology',
    method: 'first-seen-transmission+discrete-sir-census+ahead-gate',
  };
}

function enrichQuestionQueueWithNarrative(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P3',
      priorityLabel:
        q.priority === 'P2' ? '叙事超前' : /滞后|传染|R₀|R0/.test(q.question || '') ? '叙事传染路径' : '叙事主题簇',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      narrativePhase: q.narrativePhase || null,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 18);
  return {
    ...queue,
    all,
    deepQueue: deep,
    narrativeInjected: extra.length,
    version: `${queue.version || ''}+narrative`,
  };
}

module.exports = {
  NARRATIVE_VERSION,
  THEME_PATTERNS,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MAX_LAG_DAYS,
  DEFAULT_RECOVERY_WINDOW_DAYS,
  assessNarrativeEpidemiology,
  buildSectorNarrativeHeatmap,
  buildNarrativeContagionBoard,
  buildDiscreteSirCensus,
  buildSirCeiling,
  enrichQuestionQueueWithNarrative,
  countThemesForInstrument,
  growthRate,
  computeThemeTransmissionDynamics,
  getThemeTransmissionDynamics,
  resolveTransmissionForInstrument,
  loadNewsTaggedRows,
};
