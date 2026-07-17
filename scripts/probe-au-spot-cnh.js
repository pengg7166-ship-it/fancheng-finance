/**
 * 沪金 spot+CNH 溢价 overlay 探针 — 2023-2026 AU T+1 方向命中率
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const crossAsset = require('../services/commodity-cross-asset-regime');

diskCache.init(getDataDir() || 'E:\\FanchengFinance\\data');

const FROM = '2023-01-01';
const TO = '2026-12-31';
const TH = 0.08;

function dir(score) {
  if (score > TH) return 'bullish';
  if (score < -TH) return 'bearish';
  return 'neutral';
}

function act(retPct) {
  if (retPct > 0.05) return 'bullish';
  if (retPct < -0.05) return 'bearish';
  return 'neutral';
}

function main() {
  crossAsset.resetSeriesCache();
  const { au, oil, sp500 } = crossAsset.ensureSeriesLoaded();
  let aligned = crossAsset.alignSeries(au, oil, sp500);
  if (aligned.length < 80) aligned = crossAsset.alignOilAuOnly(au, oil);
  const overlayMeta = crossAsset.ensureAuOverlaySeriesLoaded();

  let baseH = 0;
  let baseT = 0;
  let withH = 0;
  let withT = 0;
  let overlayDays = 0;

  for (let i = 65; i < aligned.length - 1; i += 1) {
    const d = aligned[i].date;
    if (d < FROM || d > TO) continue;

    const regime = crossAsset.classifyCrossAssetRegime(d);
    const oilScore = Math.max(-1, Math.min(1, (aligned[i].oilRet || 0) * 50));
    const slice = aligned.slice(Math.max(0, i - 4), i + 1);
    const auC = slice.reduce((p, r) => p * (1 + r.auRet), 1) - 1;
    const oilC = slice.reduce((p, r) => p * (1 + r.oilRet), 1) - 1;
    const spC = slice.reduce((p, r) => p * (1 + r.spRet), 1) - 1;
    let score = -oilC * 2.5 + spC * 1.2 + auC * 0.5;
    score = Math.max(-1, Math.min(1, score));
    const adj = crossAsset.computePreciousCrossAssetAdjustment(regime, { compositeScore: score, oilScore });
    score = Math.max(-1, Math.min(1, score + adj.delta));

    const overlay = crossAsset.computeAuSpotCnhOverlay(d, { compositeScore: score });
    const scoreWith = Math.max(-1, Math.min(1, score + overlay.delta));

    const ret = aligned[i + 1].auRet * 100;
    const actual = act(ret);
    const p0 = dir(score);
    const p1 = dir(scoreWith);

    if (p0 !== 'neutral' && actual) {
      baseT += 1;
      if (p0 === actual) baseH += 1;
    }
    if (p1 !== 'neutral' && actual) {
      withT += 1;
      if (p1 === actual) withH += 1;
    }
    if (overlay.delta !== 0) overlayDays += 1;
  }

  const baseRate = baseT ? baseH / baseT : 0;
  const withRate = withT ? withH / withT : 0;
  const out = {
    generatedAt: new Date().toISOString(),
    window: { from: FROM, to: TO },
    crossAssetVersion: crossAsset.CROSS_ASSET_VERSION,
    dataSources: {
      intlGold: {
        rows: overlayMeta.intlGold.length,
        source: overlayMeta.intlGoldMeta.source,
        kind: overlayMeta.intlGold.length >= 20 ? 'london_gold' : 'au_correlation_proxy',
      },
      cnh: {
        rows: overlayMeta.cnh.length,
        source: overlayMeta.cnhMeta.source,
        kind: overlayMeta.cnhMeta.kind,
        proxy: overlayMeta.cnhMeta.proxy,
      },
      auBars: overlayMeta.au.length,
    },
    probeNote: '基线=AU动量+跨资产regime；对比叠加 spot+CNH overlay 后 AU T+1 方向',
    hitRate: {
      baseline: { hits: baseH, total: baseT, rate: +baseRate.toFixed(4) },
      withOverlay: { hits: withH, total: withT, rate: +withRate.toFixed(4) },
      deltaPp: +((withRate - baseRate) * 100).toFixed(2),
      overlayActiveDays: overlayDays,
    },
  };

  const outPath = path.join(__dirname, '..', 'docs', 'au-spot-cnh-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
}

main();
