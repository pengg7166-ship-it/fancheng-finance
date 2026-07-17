/** 利好兑现 — Fed 降息锚点 T-5..T+5 + classifyMacroPricedIn 探针 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { loadSeries, analyzePricedInWindow } = require('./validate-philosophy-historical-fit');
const philosophy = require('../services/commodity-outlook-philosophy');
const newsTagged = require('../services/news-tagged-loader');

const FOMC_CUTS = [
  { date: '2019-07-31', eventId: 'fomc_20190731', title: '美联储 FOMC 降息 25bp', stars: 4 },
  { date: '2019-09-18', eventId: 'fomc_20190918', title: '美联储 FOMC 降息 25bp', stars: 4 },
  { date: '2019-10-30', eventId: 'fomc_20191030', title: '美联储 FOMC 降息 25bp', stars: 4 },
  { date: '2024-09-18', eventId: 'fomc_20240918', title: '美联储 FOMC 降息 50bp', stars: 4 },
  { date: '2025-09-17', eventId: 'fomc_20250917', title: '美联储 FOMC 降息(日历)', stars: 4 },
  { date: '2025-10-29', eventId: 'fomc_20251029', title: '美联储 FOMC 降息(日历)', stars: 4 },
  { date: '2025-12-10', eventId: 'fomc_20251210', title: '美联储 FOMC 降息(日历)', stars: 4 },
];

function main() {
  newsTagged.loadNewsTagged();
  const au = loadSeries('au');
  const ag = loadSeries('ag');
  const rows = [];

  for (const ev of FOMC_CUTS) {
    const event = { ...ev, direction: 'bullish', notes: ev.title };
    const priorRows = newsTagged.getPriorRowsBeforeDate?.(ev.date) || [];
    const priorOcc = philosophy.countPriorEventOccurrences(
      priorRows,
      philosophy.inferEventType(event),
      ev.date
    );
    const pricedIn = philosophy.classifyMacroPricedIn(event, au, priorRows, {
      sector: 'precious',
      instrumentId: 'au',
      asOfDate: ev.date,
      priorOccurrences: priorOcc,
    });
    const auW = analyzePricedInWindow(au, ev.date);
    const agW = analyzePricedInWindow(ag, ev.date);
    rows.push({
      date: ev.date,
      pricedInLikely: pricedIn.pricedInLikely,
      directionFlip: pricedIn.directionFlip,
      cutExpectNews: pricedIn.cutExpectNewsCount,
      preRunAu: auW?.preRunT5toT1,
      au: auW?.fromEventDay,
      ag: agW?.fromEventDay,
    });
  }

  console.log(JSON.stringify(rows, null, 2));
}

main();
