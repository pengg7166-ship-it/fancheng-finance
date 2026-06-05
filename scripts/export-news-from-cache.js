/**
 * 从应用磁盘缓存导出近期新闻标题 → CSV 起步文件
 * 用法: node scripts/export-news-from-cache.js [--out path.csv]
 *
 * 缓存位置（E 盘优先）: FanchengFinance/data/cache/ 或 userData/cache/
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const diskCache = require('../services/disk-cache');
const { getUserDataDir, getDataDir } = require('../services/data-paths');
const newsTagged = require('../services/news-tagged-loader');

const CACHE_FILES = [
  { key: 'policy-radar.json', source_tier: 'policy', itemsPath: 'data.items' },
  { key: 'geopolitics-radar.json', source_tier: 'geo', itemsPath: 'data.items' },
  { key: 'climate-radar.json', source_tier: 'climate', itemsPath: 'data.items' },
  { key: 'news-fast.json', source_tier: 'commodity', itemsPath: 'items' },
  { key: 'news-global.json', source_tier: 'commodity', itemsPath: 'items' },
];

function getNested(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), obj);
}

function normDateFromItem(item) {
  const raw = item.pubDate || item.date || item.publishedAt || item.time || '';
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = String(raw).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function tagsFromItem(item) {
  if (item.commodities?.length) {
    return item.commodities.map((c) => c.id || c).join(';');
  }
  if (item.commodityTags?.length) return item.commodityTags.join(';');
  return '';
}

function inferDirection(item) {
  if (item.direction) return item.direction;
  const s = item.sentiment || item.score;
  if (typeof s === 'number') {
    if (s > 0.15) return 'bullish';
    if (s < -0.15) return 'bearish';
  }
  return 'neutral';
}

function readCacheItems(key, itemsPath) {
  const stored = diskCache.readStale(key);
  if (!stored) return [];
  return getNested(stored, itemsPath) || [];
}

function main() {
  const outArg = process.argv.indexOf('--out');
  const defaultOut = path.join(newsTagged.getHistoryDir(), `news-from-cache-${new Date().toISOString().slice(0, 10)}.csv`);
  const outPath = outArg >= 0 ? process.argv[outArg + 1] : defaultOut;

  diskCache.init(getUserDataDir() || getDataDir() || path.join(process.cwd(), 'data'));

  const rows = [];
  const seen = new Set();

  for (const spec of CACHE_FILES) {
    const items = readCacheItems(spec.key, spec.itemsPath);
    for (const item of items) {
      const date = normDateFromItem(item);
      const title = (item.title || '').trim();
      if (!date || !title) continue;
      const key = `${date}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        date,
        title,
        commodity_tags: tagsFromItem(item),
        direction: inferDirection(item),
        stars: item.stars || 2,
        source_tier: spec.source_tier,
        event_id: '',
        notes: `cache:${spec.key}`,
      });
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, newsTagged.rowsToCsv(rows), 'utf8');

  console.log(`缓存根目录: ${diskCache.getRoot() || '(未初始化)'}`);
  console.log(`导出 ${rows.length} 条 → ${outPath}`);
  if (rows.length === 0) {
    console.log('\n提示: 缓存为空。请先运行梵澄金融桌面版并完成一次「刷新数据」，或参考 docs/NEWS_DATA_SOLUTIONS.md Tier B/C。');
  } else {
    console.log('\n可用 merge 合并: node scripts/merge-user-news-csv.js', outPath);
  }
}

main();
