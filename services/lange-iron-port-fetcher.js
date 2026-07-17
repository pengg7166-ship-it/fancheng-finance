/**
 * 兰格钢铁网 · 铁矿石港口库存（34 主要港口周频）
 * 列表: https://luliao.lgmi.com/listinfo_pCpA_BB5A4_B24.htm
 * 口径标注 source=lange-34port，不可与 Mysteel 47港混用。
 * 仅解析公开正文中的「库存总量 / 较上周增减」，不全文造假。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { saveSeries, loadSeries } = require('./sector-fundamentals-loader');

const LANGE_VERSION = 'v1.56.20-lange-iron-port';
const LIST_URL = 'https://luliao.lgmi.com/listinfo_pCpA_BB5A4_B24.htm';
const SECTOR = 'black';
const METRIC = 'iron_port_inventory';

function getBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: 25000,
        rejectUnauthorized: false,
      },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
          res.resume();
          resolve(getBuffer(new URL(res.headers.location, url).href, redirects + 1));
          return;
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode || 0, buf: Buffer.concat(chunks), url }));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function decodeHtml(buf) {
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHref(href) {
  return String(href || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
}

function parseTitleDate(title) {
  const m = String(title || '').match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const nowY = new Date().getFullYear();
  const month = Number(m[1]);
  const day = Number(m[2]);
  // 文末跨年：若标题月明显大于当前月，视为去年
  let year = nowY;
  const curMonth = new Date().getMonth() + 1;
  if (month > curMonth + 2) year = nowY - 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseArticleBody(text) {
  const total =
    text.match(/全国\s*\d+\s*个主要港口铁矿石库存总量\s*([0-9]+(?:\.[0-9]+)?)\s*万吨/) ||
    text.match(/铁矿石库存总量\s*([0-9]+(?:\.[0-9]+)?)\s*万吨/) ||
    text.match(/库存总量\s*([0-9]+(?:\.[0-9]+)?)\s*万吨/);
  if (!total) return null;
  const value = Number(total[1]);
  if (!Number.isFinite(value)) return null;
  let changeWow = null;
  const chg = text.match(/较上周统计(增加|减少|持平)\s*([0-9]+(?:\.[0-9]+)?)?\s*万吨?/);
  if (chg) {
    if (chg[1] === '持平') changeWow = 0;
    else if (chg[2] != null) {
      const n = Number(chg[2]);
      if (Number.isFinite(n)) changeWow = chg[1] === '减少' ? -n : n;
    }
  }
  return { value, changeWow };
}

async function listPortInventoryArticles() {
  const res = await getBuffer(LIST_URL);
  if (res.status !== 200) throw new Error(`lange list HTTP ${res.status}`);
  const text = decodeHtml(res.buf);
  const items = [];
  const re = /<a[^>]+href=(?:"([^"]+)"|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(text))) {
    const href = cleanHref(m[1] || m[2] || '');
    const title = stripHtml(m[3]);
    if (!/铁矿石港口库存量/.test(title)) continue;
    if (!href) continue;
    items.push({
      title,
      href,
      url: new URL(href.replace(/^\/\//, 'https://'), LIST_URL).href,
      date: parseTitleDate(title),
    });
  }
  // 去重
  const seen = new Set();
  return items.filter((it) => {
    const key = it.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchArticleInventory(item) {
  const res = await getBuffer(item.url);
  if (res.status !== 200) {
    return { ...item, error: `HTTP ${res.status}`, available: false };
  }
  const text = stripHtml(decodeHtml(res.buf));
  const parsed = parseArticleBody(text);
  if (!parsed) {
    return { ...item, error: 'parse_miss', available: false };
  }
  const date =
    item.date ||
    (() => {
      const pub = text.match(/发表日期[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (!pub) return null;
      return `${pub[1]}-${String(pub[2]).padStart(2, '0')}-${String(pub[3]).padStart(2, '0')}`;
    })();
  if (!date) return { ...item, error: 'no_date', available: false };
  return {
    available: true,
    date,
    value: parsed.value,
    change_wow: parsed.changeWow,
    title: item.title,
    url: item.url,
    source: 'lange-34port',
    unit: '万吨',
    sample: '全国34主要港口',
    method: 'lange-html-article',
    dataSource: 'lange-lgmi',
  };
}

async function scrapeLangeIronPortInventory(options = {}) {
  const limit = Math.min(80, Math.max(1, Number(options.limit) || 24));
  const items = await listPortInventoryArticles();
  const sliced = items.slice(0, limit);
  const rows = [];
  const errors = [];
  for (const item of sliced) {
    try {
      const row = await fetchArticleInventory(item);
      if (row.available) {
        rows.push({
          date: row.date,
          value: row.value,
          change_wow: row.change_wow,
          url: row.url,
        });
      } else {
        errors.push({ url: item.url, error: row.error });
      }
    } catch (err) {
      errors.push({ url: item.url, error: err.message });
    }
    await new Promise((r) => setTimeout(r, options.rateMs ?? 400));
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  // 合并已有序列，避免砍掉更早历史
  const existing = loadSeries(SECTOR, METRIC);
  const byDate = new Map();
  for (const r of existing?.rows || []) {
    byDate.set(r.date, {
      date: r.date,
      value: r.value,
      change_wow: r.changeWow ?? r.change_wow ?? null,
    });
  }
  for (const r of rows) {
    byDate.set(r.date, r);
  }
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const saved = merged.length
    ? saveSeries(SECTOR, METRIC, merged, {
        unit: '万吨',
        source: 'lange-34port',
        note: '兰格34主要港口周频总量；非 Mysteel 47港口径',
        version: LANGE_VERSION,
      })
    : null;

  return {
    version: LANGE_VERSION,
    listed: items.length,
    fetched: rows.length,
    saved,
    latest: rows.length ? rows[rows.length - 1] : null,
    errors: errors.length ? errors : undefined,
    dataSource: 'lange-lgmi',
  };
}

module.exports = {
  LANGE_VERSION,
  LIST_URL,
  SECTOR,
  METRIC,
  listPortInventoryArticles,
  fetchArticleInventory,
  scrapeLangeIronPortInventory,
  parseArticleBody,
};
