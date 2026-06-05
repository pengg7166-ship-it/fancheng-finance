/**
 * 半自动：尝试从公开 RSS/页面抓取近期新闻标题（历史深度有限）
 * 用法: node scripts/backfill-news-headlines.js [--days 90] [--merge]
 *
 * 限制: 多数免费源仅保留约 30–90 天；8 年新闻须配合 seed + 手工标注（见 docs/NEWS_DATA_SOLUTIONS.md）
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const Parser = require('rss-parser');
const newsTagged = require('../services/news-tagged-loader');
const { POLICY_RSS_FEEDS } = require('../services/policy-sources');

const COMMODITY_RSS_FEEDS = [
  { id: 'xinhua-fortune', name: '新华社财经', url: 'http://www.news.cn/fortune/news_fortune.xml', source_tier: 'commodity' },
];

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'FanchengFinance/1.28 (backfill-news)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

function parseArgs() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  return {
    days: daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) || 90 : 90,
    merge: args.includes('--merge'),
  };
}

function cutoffDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function normPubDate(item) {
  const raw = item.pubDate || item.isoDate || item.published || '';
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

async function fetchRssFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    return (parsed.items || []).map((item) => ({
      date: normPubDate(item),
      title: (item.title || '').trim(),
      source_tier: feed.source_tier || 'policy',
      notes: `rss:${feed.name || feed.id}`,
    }));
  } catch (err) {
    console.warn(`  跳过 ${feed.name || feed.url}: ${err.message}`);
    return [];
  }
}

async function main() {
  const { days, merge } = parseArgs();
  const cutoff = cutoffDate(days);
  console.log(`抓取近 ${days} 天新闻（${cutoff} 起）…`);
  console.log('注意: 历史 8 年无法靠免费 RSS 全覆盖，仅作 Tier B 补充。\n');

  const feeds = [
    ...POLICY_RSS_FEEDS.map((f) => ({ ...f, source_tier: 'policy' })),
    ...COMMODITY_RSS_FEEDS,
  ];

  const all = [];
  for (const feed of feeds) {
    process.stdout.write(`  ${feed.name || feed.id}… `);
    const items = await fetchRssFeed(feed);
    const filtered = items.filter((i) => i.date && i.date >= cutoff && i.title);
    console.log(filtered.length);
    for (const item of filtered) {
      all.push({
        date: item.date,
        title: item.title,
        commodity_tags: '',
        direction: 'neutral',
        stars: 2,
        source_tier: item.source_tier,
        event_id: '',
        notes: item.notes,
      });
    }
  }

  const outPath = path.join(newsTagged.getHistoryDir(), `news-backfill-${new Date().toISOString().slice(0, 10)}.csv`);
  require('fs').writeFileSync(outPath, newsTagged.rowsToCsv(all), 'utf8');
  console.log(`\n写入 ${all.length} 条 → ${outPath}`);

  if (merge && all.length) {
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [path.join(__dirname, 'merge-user-news-csv.js'), outPath], { stdio: 'inherit' });
  } else {
    console.log('\n合并: node scripts/merge-user-news-csv.js', outPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
