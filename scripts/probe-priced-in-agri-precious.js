/** 品种分化 — 贵金属利好兑现 + 农产品减产恐慌探针 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { loadSeries, analyzeInstrument } = require('./validate-philosophy-historical-fit');
const philosophy = require('../services/commodity-outlook-philosophy');
const newsTagged = require('../services/news-tagged-loader');

const AGRI_ANCHORS = [
  {
    date: '2022-05-13',
    eventId: 'india_wheat_export_ban_2022',
    title: '印度小麦出口禁令',
    notes: '印度宣布小麦出口禁令·全球粮食供应收紧',
    direction: 'bullish',
    stars: 4,
    instruments: ['m', 'rm', 'c'],
  },
  {
    date: '2021-07-15',
    eventId: 'brazil_drought_2021',
    title: '巴西干旱二茬玉米',
    notes: '巴西干旱导致玉米单产下调·减产预期',
    direction: 'bullish',
    stars: 4,
    instruments: ['SR', 'c', 'm'],
  },
  {
    date: '2022-06-20',
    eventId: 'us_midwest_drought_2022',
    title: '美国中西部干旱',
    notes: '干旱确认·玉米大豆产量下调',
    direction: 'bullish',
    stars: 4,
    instruments: ['c', 'm', 'SR'],
  },
  {
    date: '2022-02-24',
    eventId: 'ru_ukraine_supply',
    title: '俄乌粮食供应冲击',
    notes: '黑海粮食出口受阻·小麦玉米短缺',
    direction: 'bullish',
    stars: 5,
    instruments: ['m', 'c', 'WH'],
  },
];

const FOMC_CUTS = [
  { date: '2019-10-30', eventId: 'fomc_20191030', title: '美联储 FOMC 降息 25bp', stars: 4 },
  { date: '2024-09-18', eventId: 'fomc_20240918', title: '美联储 FOMC 降息 50bp', stars: 4 },
];

function main() {
  newsTagged.loadNewsTagged();
  const out = { philosophy: philosophy.PHILOSOPHY_VERSION, agri: [], precious: [] };

  for (const anchor of AGRI_ANCHORS) {
    const event = { ...anchor, summary: anchor.notes };
    const priorRows = newsTagged.getPriorRowsBeforeDate?.(anchor.date) || [];
    for (const inst of anchor.instruments) {
      const bars = loadSeries(inst);
      const klines = bars.map((b) => ({ date: b.date, close: b.close, high: b.high, low: b.low }));
      const assess = philosophy.assessPricedInVsPanic(event, klines, 'agriculture', inst, priorRows, {
        asOfDate: anchor.date,
      });
      const stats = bars.length ? analyzeInstrument(bars, anchor.date) : null;
      out.agri.push({
        date: anchor.date,
        inst,
        path: assess.path,
        panic: assess.panicShortageLikely,
        pricedIn: assess.pricedInLikely,
        mult: assess.bullishScoreMult,
        t5: stats?.t5,
        t20: stats?.t20,
        rationale: assess.rationale,
      });
    }
  }

  for (const ev of FOMC_CUTS) {
    const event = { ...ev, direction: 'bullish', notes: ev.title };
    const priorRows = newsTagged.getPriorRowsBeforeDate?.(ev.date) || [];
    for (const inst of ['au', 'ag']) {
      const bars = loadSeries(inst);
      const klines = bars.map((b) => ({ date: b.date, close: b.close, high: b.high, low: b.low }));
      const assess = philosophy.assessPricedInVsPanic(event, klines, 'precious', inst, priorRows, {
        asOfDate: ev.date,
        priorOccurrences: philosophy.countPriorEventOccurrences(
          priorRows,
          philosophy.inferEventType(event),
          ev.date
        ),
      });
      const stats = bars.length ? analyzeInstrument(bars, ev.date) : null;
      out.precious.push({
        date: ev.date,
        inst,
        path: assess.path,
        pricedIn: assess.pricedInLikely,
        flip: assess.directionFlip,
        mult: assess.bullishScoreMult,
        t5: stats?.t5,
        t20: stats?.t20,
      });
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
