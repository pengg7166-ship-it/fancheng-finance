/**
 * Patch 7 — validate geopolitics-daily.json vs news-tagged geo rows
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/probe-geopolitics-daily.js [--rebuild]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const newsTagged = require('../services/news-tagged-loader');
const {
  buildGeopoliticsDailySeries,
  saveGeopoliticsDailySeries,
  loadGeopoliticsDailyPayload,
  isGeoRow,
} = require('../services/geopolitics-daily-aggregator');

function parseArgs() {
  return { rebuild: process.argv.includes('--rebuild') };
}

function tradingDaysPerYear(y) {
  if (y === 2026) return 110;
  if (y === 2019 || y === 2020) return 244;
  return 245;
}

function yearCoverage(dates, fromYear = 2019, toYear = 2026) {
  const byYear = {};
  for (let y = fromYear; y <= toYear; y += 1) {
    byYear[y] = { rows: 0, estDays: tradingDaysPerYear(y), pct: 0 };
  }
  for (const d of dates) {
    const y = +String(d).slice(0, 10).slice(0, 4);
    if (y >= fromYear && y <= toYear) byYear[y].rows += 1;
  }
  for (const y of Object.keys(byYear)) {
    const { rows, estDays } = byYear[y];
    byYear[y].pct = estDays ? +Math.min(100, (rows / estDays) * 100).toFixed(1) : 0;
  }
  return byYear;
}

function main() {
  const { rebuild } = parseArgs();
  newsTagged.loadNewsTagged({ force: true });
  const { rows } = newsTagged.loadNewsTagged();
  const geoRows = rows.filter(isGeoRow);
  const geoDates = [...new Set(geoRows.map((r) => String(r.date).slice(0, 10)))].sort();

  if (rebuild) {
    saveGeopoliticsDailySeries({ forceReload: true });
  }

  const built = buildGeopoliticsDailySeries({ forceReload: true });
  const loaded = loadGeopoliticsDailyPayload({ force: true });

  const series = loaded.series.length ? loaded.series : built.series;
  const dates = series.map((r) => r.date);
  const mismatchDays = geoDates.filter((d) => !series.some((r) => r.date === d));

  const payload = {
    probedAt: new Date().toISOString(),
    dataDrive: process.env.FANCHENG_DATA_DRIVE || 'E',
    dataDir: getDataDir(),
    newsTagged: {
      path: newsTagged.getNewsTaggedPath(),
      totalRows: rows.length,
      geoRows: geoRows.length,
      geoUniqueDays: geoDates.length,
    },
    geopoliticsDaily: {
      path: loaded.jsonPath,
      exists: !loaded.missing,
      version: loaded.payload?.version || built.version,
      daysWithGeoNews: series.length,
      startDate: dates[0] || null,
      endDate: dates[dates.length - 1] || null,
      directionCounts: series.reduce(
        (acc, row) => {
          acc[row.direction] = (acc[row.direction] || 0) + 1;
          return acc;
        },
        { bullish: 0, bearish: 0, neutral: 0 }
      ),
      coverageByYear: yearCoverage(dates),
      avgGeoShock: series.length
        ? +(series.reduce((a, r) => a + Math.abs(r.geoShock || 0), 0) / series.length).toFixed(4)
        : null,
      maxGeoShock: series.length ? Math.max(...series.map((r) => Math.abs(r.geoShock || 0))) : null,
    },
    validation: {
      ok: mismatchDays.length === 0 && series.length === geoDates.length,
      missingDays: mismatchDays.slice(0, 10),
      extraDays: series.filter((r) => !geoDates.includes(r.date)).map((r) => r.date).slice(0, 10),
    },
    sample: {
      first: series.slice(0, 3),
      last: series.slice(-3),
    },
  };

  const outJson = path.join(__dirname, '..', '_probe-geopolitics-daily-out.json');
  const outTxt = path.join(__dirname, '..', '_probe-geopolitics-daily-out.txt');
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const lines = [
    '=== Geopolitics Daily Probe (Patch 7) ===',
    `news-tagged: ${payload.newsTagged.totalRows} rows · geo ${payload.newsTagged.geoRows} (${payload.newsTagged.geoUniqueDays} days)`,
    `geopolitics-daily: ${payload.geopoliticsDaily.daysWithGeoNews} days · ${payload.geopoliticsDaily.startDate} .. ${payload.geopoliticsDaily.endDate}`,
    `validation: ${payload.validation.ok ? 'OK' : 'MISMATCH'} · file ${loaded.jsonPath}`,
    `direction: bullish ${payload.geopoliticsDaily.directionCounts.bullish || 0} · bearish ${payload.geopoliticsDaily.directionCounts.bearish || 0} · neutral ${payload.geopoliticsDaily.directionCounts.neutral || 0}`,
    `avg |geoShock|: ${payload.geopoliticsDaily.avgGeoShock} · max |geoShock|: ${payload.geopoliticsDaily.maxGeoShock}`,
  ];
  fs.writeFileSync(outTxt, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nWrote ${outJson}`);
}

main();
