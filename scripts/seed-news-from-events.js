/**
 * 从 commodity-outlook-event-calendar HISTORICAL_EVENTS + 关键日事件 → news-tagged.csv
 * 用法: node scripts/seed-news-from-events.js [--force]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const eventCalendar = require('../services/commodity-outlook-event-calendar');
const newsTagged = require('../services/news-tagged-loader');

/** 关键单日/短周期事件（可手工扩展） */
const PINPOINT_EVENTS = [
  {
    date: '2016-02-04',
    title: '国务院发布钢铁行业化解过剩产能意见',
    commodity_tags: 'rb;i;jm;ZC',
    direction: 'bullish',
    stars: 4,
    source_tier: 'policy',
    event_id: 'china_supply_side_2016',
    notes: '供给侧改革启动，黑色系供给收缩预期',
  },
  {
    date: '2019-05-10',
    title: '美国对2000亿美元中国商品加征关税至25%',
    commodity_tags: 'cu;sc;rb',
    direction: 'bearish',
    stars: 4,
    source_tier: 'geo',
    event_id: 'us_china_tariff_2019',
    notes: '贸易战升级，工业金属与能化承压',
  },
  {
    date: '2020-01-01',
    title: '印尼宣布禁止镍矿原矿出口',
    commodity_tags: 'ni;ss',
    direction: 'bullish',
    stars: 5,
    source_tier: 'policy',
    event_id: 'indonesia_nickel_ban_2020',
    notes: '镍供应冲击，不锈钢原料紧张',
  },
  {
    date: '2020-03-09',
    title: '全球疫情恐慌，原油与风险资产暴跌',
    commodity_tags: 'sc;fu;au;cu;rb',
    direction: 'bearish',
    stars: 5,
    source_tier: 'geo',
    event_id: 'covid_crash_mar2020',
    notes: 'COVID 冲击日；黄金相对抗跌可单独标注 bullish',
  },
  {
    date: '2020-03-15',
    title: '美联储紧急降息至零并重启 QE',
    commodity_tags: 'au;ag;sc',
    direction: 'bullish',
    stars: 5,
    source_tier: 'macro',
    event_id: 'fed_emergency_cut_2020',
    notes: '流动性泛滥，贵金属与原油反弹',
  },
  {
    date: '2020-04-20',
    title: 'WTI 五月合约首次负油价',
    commodity_tags: 'sc;fu',
    direction: 'bearish',
    stars: 5,
    source_tier: 'commodity',
    event_id: 'wti_negative_2020',
    notes: '储油危机，能化极度悲观后反转',
  },
  {
    date: '2021-10-19',
    title: '发改委连发调控煤炭价格政策',
    commodity_tags: 'ZC;jm;rb',
    direction: 'bearish',
    stars: 4,
    source_tier: 'policy',
    event_id: 'china_coal_cap_2021',
    notes: '动力煤/焦煤政策顶',
  },
  {
    date: '2022-02-24',
    title: '俄罗斯对乌克兰发动特别军事行动',
    commodity_tags: 'sc;fu;c;m;WH',
    direction: 'bullish',
    stars: 5,
    source_tier: 'geo',
    event_id: 'ru_ukraine_invade',
    notes: '能源/粮食供应冲击',
  },
  {
    date: '2022-03-16',
    title: '美联储开启加息周期（FOMC+25bp）',
    commodity_tags: 'au;ag;cu',
    direction: 'bearish',
    stars: 4,
    source_tier: 'macro',
    event_id: 'fed_hike_cycle_start',
    notes: '实际利率上行压制贵金属',
  },
  {
    date: '2022-06-20',
    title: '印尼进一步收紧镍产品出口政策',
    commodity_tags: 'ni',
    direction: 'bullish',
    stars: 4,
    source_tier: 'policy',
    event_id: 'indonesia_nickel_2022',
    notes: '镍二次供应冲击',
  },
  {
    date: '2023-03-08',
    title: '硅谷银行倒闭引发金融恐慌',
    commodity_tags: 'au;ag;cu',
    direction: 'bullish',
    stars: 3,
    source_tier: 'macro',
    event_id: 'svb_crisis_2023',
    notes: '避险买盘，随后 Fed 预期转向',
  },
  {
    date: '2024-03-19',
    title: '日本央行结束负利率政策',
    commodity_tags: 'au;ni;cu',
    direction: 'bearish',
    stars: 4,
    source_tier: 'macro',
    event_id: 'boj_nirp_exit_day',
    notes: '日元走强，贵金属承压',
  },
  {
    date: '2024-09-18',
    title: '美联储开启降息周期（FOMC-50bp）',
    commodity_tags: 'au;cu;sc',
    direction: 'bullish',
    stars: 4,
    source_tier: 'macro',
    event_id: 'fed_cut_sep2024',
    notes: '宽松预期支撑大宗',
  },
  {
    date: '2025-07-01',
    title: '中央强调反内卷、规范无序竞争',
    commodity_tags: 'FG;ps;jm;lc;SA',
    direction: 'bullish',
    stars: 4,
    source_tier: 'policy',
    event_id: 'china_anti_involution_2025',
    notes: '供给纪律，化工/光伏链受益',
  },
];

/** 主要 FOMC 决议日（2019–2025，结构化 macro 新闻） */
const FOMC_DATES = [
  ['2019-01-30', 'hold'], ['2019-03-20', 'hold'], ['2019-05-01', 'hold'], ['2019-07-31', 'cut25'],
  ['2019-09-18', 'cut25'], ['2019-10-30', 'cut25'], ['2019-12-11', 'hold'],
  ['2020-03-03', 'cut50'], ['2020-03-15', 'cut100'], ['2020-03-19', 'qe'],
  ['2022-03-16', 'hike25'], ['2022-05-04', 'hike50'], ['2022-06-15', 'hike75'],
  ['2022-07-27', 'hike75'], ['2022-09-21', 'hike75'], ['2022-11-02', 'hike75'],
  ['2022-12-14', 'hike50'], ['2023-02-01', 'hike25'], ['2023-03-22', 'hike25'],
  ['2023-05-03', 'hike25'], ['2023-07-26', 'hike25'], ['2023-09-20', 'hold'],
  ['2023-11-01', 'hold'], ['2023-12-13', 'hold'],
  ['2024-09-18', 'cut50'], ['2024-11-07', 'cut25'], ['2024-12-18', 'cut25'],
  ['2025-01-29', 'hold'],
];

const FOMC_LABELS = {
  hold: '美联储 FOMC 维持利率不变',
  cut25: '美联储 FOMC 降息 25bp',
  cut50: '美联储 FOMC 降息 50bp',
  cut100: '美联储 FOMC 紧急大幅降息',
  hike25: '美联储 FOMC 加息 25bp',
  hike50: '美联储 FOMC 加息 50bp',
  hike75: '美联储 FOMC 加息 75bp',
  qe: '美联储 FOMC 宣布 QE 与零利率',
};

const FOMC_DIRECTION = {
  hold: 'neutral',
  cut25: 'bullish',
  cut50: 'bullish',
  cut100: 'bullish',
  hike25: 'bearish',
  hike50: 'bearish',
  hike75: 'bearish',
  qe: 'bullish',
};

function inferDirectionFromEvent(ev) {
  const regime = ev.regimes || {};
  if (regime.geo === 'supply_shock' || regime.supply === 'tight') return 'bullish';
  if (regime.demand === 'collapsed' || regime.finance === 'tight') return 'bearish';
  if (regime.chinaPolicy === 'anti_involution' || regime.supply === 'discipline') return 'bullish';
  if (regime.finance === 'loose' || regime.finance === 'loose_extreme') return 'bullish';
  return 'neutral';
}

function eventToRow(ev, dateOverride = null) {
  const date = dateOverride || ev.start;
  const tags = (ev.affectedIds || []).join(';') || (ev.affectedSectors || []).join(';');
  return {
    date: String(date).slice(0, 10),
    title: ev.label,
    commodity_tags: tags,
    direction: inferDirectionFromEvent(ev),
    stars: ev.affectedIds?.length ? 4 : 3,
    source_tier: ev.regimes?.geo && ev.regimes.geo !== 'neutral' ? 'geo' : ev.regimes?.chinaPolicy && ev.regimes.chinaPolicy !== 'neutral' ? 'policy' : 'macro',
    event_id: ev.id,
    notes: `由 event-calendar 自动生成；区间 ${ev.start} ~ ${ev.end || '持续'}`,
  };
}

function fomcToRows() {
  return FOMC_DATES.map(([date, action]) => ({
    date,
    title: FOMC_LABELS[action] || `美联储 FOMC 决议 (${action})`,
    commodity_tags: 'au;ag;cu;sc',
    direction: FOMC_DIRECTION[action] || 'neutral',
    stars: action.startsWith('hike') || action.startsWith('cut') ? 4 : 3,
    source_tier: 'macro',
    event_id: `fomc_${date.replace(/-/g, '')}`,
    notes: 'FOMC 决议日；来源：Fed 公开日程',
  }));
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.date}|${row.title}|${row.event_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function main() {
  const force = process.argv.includes('--force');
  const outPath = newsTagged.getNewsTaggedPath();

  if (!force && fs.existsSync(outPath)) {
    const existing = newsTagged.loadNewsTagged({ force: true });
    console.log(`已存在 ${outPath}（${existing.rows.length} 行）。加 --force 覆盖种子数据。`);
    return;
  }

  const rows = [];
  for (const ev of eventCalendar.HISTORICAL_EVENTS) {
    rows.push(eventToRow(ev));
    if (ev.end && ev.end !== ev.start && ev.end < '2099-01-01') {
      rows.push(eventToRow(ev, ev.end));
    }
  }
  rows.push(...PINPOINT_EVENTS);
  rows.push(...fomcToRows());

  const merged = dedupeRows(rows);
  newsTagged.writeNewsTaggedCsv(merged, { backup: false });

  const repoHistory = path.join(process.cwd(), 'data', 'history');
  fs.mkdirSync(repoHistory, { recursive: true });
  const repoCsv = path.join(repoHistory, 'news-tagged.csv');
  const repoTemplate = path.join(repoHistory, 'news-tagged.template.csv');
  fs.writeFileSync(repoCsv, newsTagged.rowsToCsv(merged), 'utf8');

  const templateRows = merged.slice(0, 8);
  fs.writeFileSync(newsTagged.getNewsTaggedTemplatePath(), newsTagged.rowsToCsv(templateRows), 'utf8');
  fs.writeFileSync(repoTemplate, newsTagged.rowsToCsv(templateRows), 'utf8');

  console.log(`已写入 ${outPath}（${merged.length} 行）`);
  console.log(`仓库副本 ${repoCsv}`);
  console.log(`模板示例 ${repoTemplate}（${templateRows.length} 行）`);
  console.log('\n下一步:');
  console.log('  1. 用 Excel 打开 CSV，按 docs/NEWS_DATA_SOLUTIONS.md 补充重大事件日');
  console.log('  2. node scripts/merge-user-news-csv.js your-additions.csv');
  console.log('  3. node scripts/tune-sector-weights-longrun.js  # 重跑长周期回测');
}

main();
