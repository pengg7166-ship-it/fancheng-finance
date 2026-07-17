/**
 * 情报中心 · 真同构 K 路径回放
 * 用磁盘日 K 收益路径相似度，升级主题级 canonical；禁止合成 bar。
 */
const CANONICAL_K_VERSION = 'v2.89.22-isomorphic-k-replay';

function parseEraWindow(era) {
  if (!era || typeof era !== 'string') return null;
  const m = era.match(/(\d{4}-\d{2})(?:~\d{4}-\d{2})?/);
  if (!m) return null;
  // '2020-02~2020-04' or '2023'
  const range = era.match(/(\d{4}-\d{2})~(\d{4}-\d{2})/);
  if (range) {
    return { start: `${range[1]}-01`, end: `${range[2]}-28` };
  }
  const year = era.match(/^(\d{4})$/);
  if (year) {
    return { start: `${year[1]}-01-01`, end: `${year[1]}-12-31` };
  }
  const ym = era.match(/^(\d{4}-\d{2})/);
  if (ym) {
    return { start: `${ym[1]}-01`, end: `${ym[1]}-28` };
  }
  return null;
}

function loadReturnPath(instrumentId, start, end, maxBars = 40) {
  try {
    const { readCachedKlines } = require('./commodity-technical-analyzer');
    const klines = (readCachedKlines(instrumentId) || [])
      .map((k) => ({
        date: String(k.date || k.day || '').slice(0, 10),
        close: Number(k.close ?? k.c ?? 0),
      }))
      .filter((b) => b.date && b.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    const inWin = klines.filter((b) => b.date >= start && b.date <= end);
    if (inWin.length < 8) return null;

    const slice = inWin.slice(-maxBars);
    const rets = [];
    for (let i = 1; i < slice.length; i += 1) {
      const prev = slice[i - 1].close;
      const cur = slice[i].close;
      if (prev > 0) rets.push((cur - prev) / prev);
    }
    if (rets.length < 6) return null;
    return {
      rets,
      closes: slice.map((b) => ({ date: b.date, close: +b.close.toFixed(4) })),
      n: rets.length,
      start: slice[0].date,
      end: slice[slice.length - 1].date,
      dataSource: 'readCachedKlines',
    };
  } catch {
    return null;
  }
}

function loadRecentReturnPath(instrumentId, length, asOf) {
  try {
    const { readCachedKlines } = require('./commodity-technical-analyzer');
    let klines = (readCachedKlines(instrumentId) || [])
      .map((k) => ({
        date: String(k.date || k.day || '').slice(0, 10),
        close: Number(k.close ?? k.c ?? 0),
      }))
      .filter((b) => b.date && b.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (asOf) klines = klines.filter((b) => b.date <= asOf);
    if (klines.length < length + 2) return null;
    const slice = klines.slice(-(length + 1));
    const rets = [];
    for (let i = 1; i < slice.length; i += 1) {
      const prev = slice[i - 1].close;
      const cur = slice[i].close;
      if (prev > 0) rets.push((cur - prev) / prev);
    }
    if (rets.length < 6) return null;
    return {
      rets,
      closes: slice.map((b) => ({ date: b.date, close: +b.close.toFixed(4) })),
      n: rets.length,
      start: slice[0].date,
      end: slice[slice.length - 1].date,
      dataSource: 'readCachedKlines',
    };
  } catch {
    return null;
  }
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 6) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx <= 0 || dy <= 0) return null;
  return +(num / Math.sqrt(dx * dy)).toFixed(4);
}

/**
 * 对单个 case 计算路径相似度；era 无法解析或 K 不足 → null（诚实暂无）
 */
function computePathSimilarity(instrumentId, caseDef, asOf) {
  const win = parseEraWindow(caseDef?.era);
  if (!win) {
    return {
      available: false,
      reason: 'era_not_dated',
      display: '路径回放·era 非定日窗口',
      dataSource: 'intel-isomorphic-k',
    };
  }

  const hist = loadReturnPath(instrumentId, win.start, win.end, 40);
  if (!hist) {
    return {
      available: false,
      reason: 'historical_path_insufficient',
      display: '历史窗口日K不足',
      era: caseDef.era,
      dataSource: 'readCachedKlines',
    };
  }

  const recent = loadRecentReturnPath(instrumentId, hist.n, asOf);
  if (!recent) {
    return {
      available: false,
      reason: 'recent_path_insufficient',
      display: '近期日K不足',
      dataSource: 'readCachedKlines',
    };
  }

  const corr = pearson(hist.rets, recent.rets);
  if (corr == null) {
    return {
      available: false,
      reason: 'corr_undefined',
      display: '路径相关不可算',
      n: hist.n,
      dataSource: 'readCachedKlines',
    };
  }

  const score = Math.max(0, corr); // 负相关不当作同构
  // 稀疏收盘序列仅用于回放对照（真实日K），禁止插值填缺
  const histCloses = (hist.closes || []).filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 8)) === 0 || i === arr.length - 1).slice(0, 10);
  const recentCloses = (recent.closes || []).filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 8)) === 0 || i === arr.length - 1).slice(0, 10);
  return {
    available: true,
    score: +score.toFixed(4),
    corr,
    n: Math.min(hist.n, recent.n),
    nDisplay: String(Math.min(hist.n, recent.n)),
    histWindow: { start: hist.start, end: hist.end, n: hist.n },
    recentWindow: { start: recent.start, end: recent.end, n: recent.n },
    pathReplay: {
      available: true,
      histWindow: { start: hist.start, end: hist.end, n: hist.n },
      recentWindow: { start: recent.start, end: recent.end, n: recent.n },
      histCloses,
      recentCloses,
      pathTier: score >= 0.55 ? 'strong' : score >= 0.25 ? 'weak' : 'none',
      nDisplay: String(Math.min(hist.n, recent.n)),
      display: `${hist.start}→${hist.end} vs ${recent.start}→${recent.end} · n=${Math.min(hist.n, recent.n)}`,
      dataSource: 'readCachedKlines',
      method: 'pearson-return-path-replay',
    },
    display:
      score >= 0.55
        ? `路径同构 ${(score * 100).toFixed(0)}% (n=${Math.min(hist.n, recent.n)})`
        : `路径弱相似 ${(score * 100).toFixed(0)}% (n=${Math.min(hist.n, recent.n)})`,
    dataSource: 'readCachedKlines',
    method: 'pearson-return-path',
    version: CANONICAL_K_VERSION,
  };
}

module.exports = {
  CANONICAL_K_VERSION,
  parseEraWindow,
  computePathSimilarity,
  pearson,
};
