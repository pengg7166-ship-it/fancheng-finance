/**
 * 情报中心 · 标准战役库（canonical cases）
 * 真实历史锚点 + 磁盘日 K 路径回放 — 不合成价格。
 */
const { computePathSimilarity } = require('./intel-isomorphic-k');

const CANONICAL_VERSION = 'v2.89.22-canonical-replay';

/** 案例元数据：仅标签与机制，数值须运行时从磁盘 K 验证 */
const CANONICAL_CASES = [
  {
    id: 'covid_liquidity_2020',
    label: '2020 疫情流动性冲击',
    instruments: ['sc', 'cu', 'au'],
    themes: ['liquidity', 'risk_off'],
    mechanism: '宏观流动性→商品共振',
    era: '2020-02~2020-04',
    watchSignals: ['VIX飙升', '美元流动性', '原油暴跌'],
  },
  {
    id: 'black_stimulus_2023',
    label: '黑色政策刺激段',
    instruments: ['rb', 'i', 'hc', 'jm'],
    themes: ['policy', 'stimulus'],
    mechanism: '政策→地产链→黑色需求',
    era: '2023-01~2023-03',
    watchSignals: ['政策表述', '螺纹持仓', '铁矿基差'],
  },
  {
    id: 'oil_supply_shock',
    label: '原油供给冲击传导',
    instruments: ['sc', 'fu', 'bu', 'ta', 'pp'],
    themes: ['geo', 'supply'],
    mechanism: '地缘/供给→能化成本链',
    era: '2022-02~2022-04',
    watchSignals: ['地缘溢价', '裂解价差', '化工利润'],
  },
  {
    id: 'precious_real_rate_flip',
    label: '贵金属实际利率翻转',
    instruments: ['au', 'ag'],
    themes: ['macro', 'real_rates'],
    mechanism: '实际利率→贵金属定价',
    era: '2022-03~2022-06',
    watchSignals: ['美债实际利率', '美元', 'ETF持仓'],
  },
  {
    id: 'cu_destock_2021',
    label: '铜去库紧供给段',
    instruments: ['cu', 'al', 'ni'],
    themes: ['destock', 'supply'],
    mechanism: '库存去化→近月结构→金属链',
    era: '2021-03~2021-05',
    watchSignals: ['显性库存', '升贴水', '冶炼干扰'],
  },
  {
    id: 'palm_weather_narrative',
    label: '棕榈天气叙事 vs 库存',
    instruments: ['p', 'y'],
    themes: ['weather', 'substitute'],
    mechanism: '天气叙事→油脂替代',
    era: 'recurring',
    watchSignals: ['产地降雨', '库存兑现', '豆棕价差'],
  },
];

function similarityScore(inst, caseDef) {
  let score = 0;
  const reasons = [];

  if (caseDef.instruments.includes(inst?.id)) {
    score += 0.35;
    reasons.push('品种命中');
  }

  const sectorMap = {
    ferrous: ['rb', 'i', 'hc', 'jm', 'j'],
    energy: ['sc', 'fu', 'lu', 'bu'],
    chemical: ['ta', 'ma', 'pp', 'l', 'v'],
    precious: ['au', 'ag'],
    oilseed: ['p', 'y', 'm'],
  };
  const instSector = inst?.sector;
  const caseSectors = Object.entries(sectorMap).filter(([, ids]) =>
    caseDef.instruments.some((id) => ids.includes(id))
  );
  if (caseSectors.some(([s]) => s === instSector)) {
    score += 0.15;
    reasons.push('板块同构');
  }

  const kernel = inst?.intelligenceKernel;
  const stateKey = kernel?.stateKey || '';
  if (caseDef.themes.includes('geo') && /geo/i.test(stateKey)) {
    score += 0.25;
    reasons.push('地缘 stateKey');
  }
  if (caseDef.themes.includes('policy') && /policy/i.test(stateKey)) {
    score += 0.25;
    reasons.push('政策 stateKey');
  }

  const news = inst?.factors?.news;
  if (news?.shock > 0.5 && caseDef.themes.includes('weather') && /天气|降雨|干旱/.test(news.summary || '')) {
    score += 0.2;
    reasons.push('天气叙事');
  }

  return { score: +score.toFixed(3), reasons };
}

function matchCanonicalCases(inst, { threshold = 0.35, limit = 2, asOf } = {}) {
  const id = inst?.id;
  const day = asOf || new Date().toISOString().slice(0, 10);

  const matches = CANONICAL_CASES.map((c) => {
    const sim = similarityScore(inst, c);
    const path = id ? computePathSimilarity(id, c, day) : { available: false, reason: 'no_id' };
    let score = sim.score;
    const reasons = [...sim.reasons];
    if (path?.available && path.score != null) {
      // 路径相关加权；不足不抬分
      score = +(score + path.score * 0.4).toFixed(3);
      if (path.score >= 0.55) reasons.push(path.display);
      else if (path.n != null) reasons.push(`路径弱相似 n=${path.n}`);
    } else if (path?.reason === 'era_not_dated') {
      reasons.push('路径·era非定日');
    } else if (path?.reason) {
      reasons.push('路径·暂无');
    }
    return {
      ...c,
      similarity: score,
      themeScore: sim.score,
      matchReasons: reasons,
      pathSimilarity: path,
    };
  })
    .filter((m) => m.similarity >= threshold || (m.pathSimilarity?.available && m.pathSimilarity.score >= 0.55))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  const bestPath = matches.find((m) => m.pathSimilarity?.available)?.pathSimilarity || null;
  const inWatch =
    matches.length > 0 &&
    (matches.some((m) => m.themeScore >= threshold) ||
      matches.some((m) => m.pathSimilarity?.available && m.pathSimilarity.score >= 0.55));

  return {
    version: CANONICAL_VERSION,
    instrumentId: id,
    matches,
    pathSimilarity: bestPath,
    inIsomorphicWatch: inWatch,
    display:
      matches.length > 0
        ? `同构监视 · ${matches
            .map((m) => {
              const p =
                m.pathSimilarity?.available && m.pathSimilarity.score >= 0.55
                  ? ` · ${m.pathSimilarity.display}`
                  : '';
              return `${m.label}${p}`;
            })
            .join(' / ')}`
        : '暂无同构 case',
    dataSource: 'intel-canonical-cases+isomorphic-k',
    method: 'theme+instrument+stateKey+kline-path',
  };
}

function buildCanonicalWatchList(instruments, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const watching = (instruments || [])
    .map((inst) => ({
      inst,
      match: inst.intelCenter?.canonicalCases || matchCanonicalCases(inst, { asOf }),
    }))
    .filter((x) => x.match.inIsomorphicWatch)
    .sort((a, b) => (b.match.matches[0]?.similarity ?? 0) - (a.match.matches[0]?.similarity ?? 0))
    .slice(0, 8);

  return {
    version: CANONICAL_VERSION,
    count: watching.length,
    items: watching.map((w) => {
      const best = w.match.matches?.[0];
      const path = best?.pathSimilarity;
      return {
        instrumentId: w.inst.id,
        instrumentName: w.inst.name,
        cases: w.match.matches.map((m) => m.label),
        similarity: best?.similarity,
        pathScore: path?.available ? path.score : null,
        pathNDisplay: path?.nDisplay || (path?.n != null ? String(path.n) : '暂无'),
        pathTier:
          path?.available && path.score >= 0.55
            ? 'strong'
            : path?.available && path.score >= 0.25
              ? 'weak'
              : path?.reason === 'era_not_dated'
                ? 'undated'
                : 'none',
        display: w.match.display,
      };
    }),
    dataSource: 'intel-canonical-cases',
  };
}

module.exports = {
  CANONICAL_VERSION,
  CANONICAL_CASES,
  matchCanonicalCases,
  buildCanonicalWatchList,
};
