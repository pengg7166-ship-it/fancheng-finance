#!/usr/bin/env node
/**
 * 拉取 7×24 快讯候选 → data/history/flash-news-inbox.json
 * 用法: node scripts/fetch-flash-news.js [--alerts-only] [--no-append]
 */
const {
  fetchAllFlashNews,
  getFlashNewsInbox,
  getInboxPath,
  FETCHER_VERSION,
} = require('../services/flash-news-fetcher');
const { getEnabledFlashSources } = require('../services/flash-news-sources');

function parseArgs(argv) {
  return {
    alertsOnly: argv.includes('--alerts-only'),
    noAppend: argv.includes('--no-append'),
    json: argv.includes('--json'),
  };
}

function printReport(result) {
  console.log('=== 梵澄金融 · 快讯抓取 ===');
  console.log(`引擎: ${FETCHER_VERSION} | 启用源: ${getEnabledFlashSources().length}`);
  console.log(`时间: ${result.fetchedAt}`);
  console.log(`Inbox: ${result.inboxPath}`);
  console.log(`本次抓取: ${result.stats.totalFetched} 条 | 新增 inbox: ${result.addedToInbox} | 累计: ${result.inboxTotal}`);
  console.log(`窗口(本次): 24h=${result.stats.last24h} | 7d=${result.stats.last7d}`);
  console.log('');
  console.log('各源状态 (本次抓取 / 24h / 7d):');
  for (const r of result.sourceResults) {
    const stat = result.stats.bySource[r.sourceId] || {};
    const status = r.ok ? 'OK' : 'FAIL';
    const err = r.error ? ` — ${r.error}` : '';
    console.log(
      `  [${status}] ${r.sourceName}: ${r.count} 条 | 24h=${stat.last24h ?? '-'} | 7d=${stat.last7d ?? '-'}${err}`
    );
    if (!r.ok && r.fallbackNote) console.log(`         回退: ${r.fallbackNote}`);
  }
  console.log('');
  console.log('说明: 候选写入 flash-news-inbox.json，不会自动合并 news-tagged.csv');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const minKeywordHits = args.alertsOnly ? 1 : 0;

  const result = await fetchAllFlashNews({
    sources: getEnabledFlashSources(),
    minKeywordHits,
    appendInbox: !args.noAppend,
    respectRateLimit: true,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  const inbox = getFlashNewsInbox();
  if (!args.json) {
    console.log(`待核验 pending: ${inbox.pendingCount} | 关键词命中: ${inbox.candidates.filter((c) => c.keywordHits?.length).length}`);
  }
}

main().catch((err) => {
  console.error('fetch-flash-news 失败:', err.message || err);
  process.exit(1);
});
