/**
 * News walk-forward coverage probe — AG/AU days with news hits (philosophy layer)
 * Usage: FANCHENG_DATA_DRIVE=E node scripts/probe-news-walkforward-coverage.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const backtest = require('../services/commodity-outlook-backtest');
const newsTagged = require('../services/news-tagged-loader');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const historicalContext = require('../services/commodity-outlook-historical-context');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { computeNewsStats } = require('../services/news-tag-expansion');

const FROM = '2023-01-01';
const TO = '2026-12-31';
const IDS = ['au', 'ag'];

function loadBars(id) {
  const k = readCachedKlines(id);
  if (k.length >= 60) return k;
  const fp = path.join(getDataDir(), 'history/trading', `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

async function probeCoverage() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const stats = computeNewsStats(newsTagged.loadNewsTagged().rows, { minDate: '2019-01-01' });
  const weights = calibration.getCompositeWeights();
  const byId = {};

  for (const id of IDS) {
    const spec = INSTRUMENT_REGISTRY.find((s) => s.id === id);
    const bars = loadBars(id);
    let scored = 0;
    let withNews = 0;
    let basisWithNews = 0;
    let basisTotal = 0;
    let prev = 'neutral';

    for (let t = 60; t < bars.length - 3; t += 1) {
      const d = String(bars[t].date || bars[t].time).slice(0, 10);
      if (d < FROM || d > TO) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row || !row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
      scored += 1;
      const meta = require('../services/commodities-catalog').getCommodityMeta(id);
      const profile = require('../services/commodity-instrument-profiles').getInstrumentProfile(id);
      const news = newsTagged.scoreNewsForInstrumentAtDate(meta, profile, d);
      if (news.hitCount > 0) withNews += 1;
      if (row.marketRegime === 'basis') {
        basisTotal += 1;
        if (news.hitCount > 0) basisWithNews += 1;
      }
      prev = row.financeRegimeNext || prev;
    }

    byId[id] = {
      scored,
      daysWithNewsHits: withNews,
      newsHitPct: scored ? +((withNews / scored) * 100).toFixed(2) : null,
      basisScored: basisTotal,
      basisWithNewsHits: basisWithNews,
      basisNewsHitPct: basisTotal ? +((basisWithNews / basisTotal) * 100).toFixed(2) : null,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    window: { from: FROM, to: TO },
    newsTaggedStats: stats,
    coverage: byId,
    wiringNote: 'hitCount>0 means philosophy newsImpact non-zero on that scored day; logistic uses philosophyScore not raw news',
  };
}

probeCoverage()
  .then((payload) => {
    const out = path.join(__dirname, '..', '_probe-news-walkforward-coverage.json');
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
