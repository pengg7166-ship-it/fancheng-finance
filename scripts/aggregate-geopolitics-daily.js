/**
 * Patch 7 — aggregate news-tagged geo rows → geopolitics-daily.json
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/aggregate-geopolitics-daily.js
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const newsTagged = require('../services/news-tagged-loader');
const { saveGeopoliticsDailySeries } = require('../services/geopolitics-daily-aggregator');

function main() {
  newsTagged.loadNewsTagged({ force: true });
  const { payload, jsonPath } = saveGeopoliticsDailySeries({ forceReload: true });

  const summary = {
    ok: true,
    file: jsonPath,
    version: payload.version,
    sourceRowCount: payload.sourceRowCount,
    geoSourceRowCount: payload.geoSourceRowCount,
    daysWithGeoNews: payload.daysWithGeoNews,
    startDate: payload.startDate,
    endDate: payload.endDate,
    directionCounts: payload.directionCounts,
    first: payload.series.slice(0, 3),
    last: payload.series.slice(-3),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
