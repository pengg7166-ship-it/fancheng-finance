/**
 * P0 上期所注册仓单 '官方 dailystock.dat / stockdata HTML
 * 落盘: {dataDir}/history/warehouse-receipts/{id}-daily.json
 * 消费: commodity-outlook-backtest flatRow.warehouseReceipt
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { getDataDir } = require('./data-paths');

const DEFAULT_START = '2019-01-01';
const OUT_SUBDIR = 'warehouse-receipts';
const P0_INSTRUMENTS = [
  'cu', 'al', 'au', 'ag', 'zn', 'ni', 'pb', 'sn', 'rb', 'hc', 'ss', 'ao',
  // expand: official warehouse on SHFE/INE pages — no fake fills
  'ru', 'fu', 'bu', 'sp', 'br', 'ad', 'wr',
  'sc', 'lu', 'bc', 'nr',
];
const DEFAULT_RATE_MS = 450;

const INSTRUMENT_VARNAMES = {
  cu: 'COPPER',
  al: 'ALUMINIUM',
  zn: 'ZINC',
  ni: 'NICKEL',
  pb: 'LEAD',
  sn: 'TIN',
  rb: '螺纹钢$$STEEL REBAR',
  hc: '热轧卷板$$HOT ROLLED COIL',
  ss: '不锈钢$$STAINLESS STEEL',
  ao: '氧化铝$$ALUMINA',
  au: '黄金$$GOLD',
  ag: '白银$$SILVER',
  ru: '天然橡胶$$NATURAL RUBBER',
  fu: '燃料油$$FUEL OIL',
  bu: '石油沥青$$BITUMEN',
  sp: '纸浆$$PULP',
  br: '丁二烯橡胶$$BUTADIENE RUBBER',
  ad: '铸造铝合金$$CAST ALUMINUM ALLOY',
  wr: '线材$$WIRE ROD',
  sc: '原油$$CRUDE OIL',
  lu: '低硫燃料油$$LOW SULFUR FUEL OIL',
  bc: '国际铜$$COPPER(BC)',
  nr: '20号胶$$TSR 20',
};

const INSTRUMENT_HTML_LABELS = {
  cu: '铜',
  al: '铝',
  zn: '锌',
  ni: '镍',
  pb: '铅',
  sn: '锡',
  rb: '螺纹钢(仓库)',
  hc: '热轧卷板(仓库)',
  ss: '不锈钢(仓库)',
  ao: '氧化铝(仓库)',
  au: '黄金',
  ag: '白银',
  ru: '天然橡胶',
  fu: '燃料油',
  bu: '石油沥青(仓库)',
  sp: '纸浆(仓库)',
  br: '丁二烯橡胶(仓库)',
  ad: '铸造铝合金',
  wr: '线材',
  sc: '中质含硫原油',
  lu: '低硫燃料油(仓库)',
  bc: '铜(BC)',
  nr: '20号胶',
};

const SHFE_REFERER = 'https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/';
const SHFE_HOME = SHFE_REFERER;

const SHFE_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  Referer: SHFE_REFERER,
};

const WR_CHG5D_INSTRUMENTS = new Set([
  'cu', 'al', 'au', 'ag', 'zn', 'ni', 'pb', 'sn', 'rb', 'hc', 'ss', 'ao',
  'ru', 'fu', 'bu', 'sp', 'br', 'ad', 'wr',
  'sc', 'lu', 'bc', 'nr',
  // DCE
  'i', 'jm', 'm', 'y', 'p', 'eg', 'jd', 'lh',
  'a', 'b', 'c', 'cs', 'l', 'v', 'pp', 'j', 'eb', 'pg', 'rr', 'lg',
  // CZCE focus
  'sa', 'fg', 'cf', 'sr', 'ta', 'ma', 'oi', 'rm',
  'sf', 'sm', 'ap', 'cj', 'ur', 'pf', 'pk', 'sh', 'px', 'pr', 'cy', 'rs',
  // GFEX focus
  'si', 'lc', 'ps', 'pt', 'pd',
]);

const DCE_WR_INSTRUMENTS = Object.freeze([
  'i', 'jm', 'm', 'y', 'p', 'eg', 'jd', 'lh',
  'a', 'b', 'c', 'cs', 'l', 'v', 'pp', 'j', 'eb', 'pg', 'rr', 'lg',
]);
const CZCE_WR_INSTRUMENTS = Object.freeze([
  'sa', 'fg', 'cf', 'sr', 'ta', 'ma', 'oi', 'rm',
  'sf', 'sm', 'ap', 'cj', 'ur', 'pf', 'pk', 'sh', 'px', 'pr', 'cy', 'rs',
]);
const GFEX_WR_INSTRUMENTS = Object.freeze(['si', 'lc', 'ps', 'pt', 'pd']);

/** Warehouse scrape calendar: AU/AG have extra session days vs CU/al SHFE calendar. */
const WR_CALENDAR_INSTRUMENT = {
  au: 'au',
  ag: 'ag',
};
const DEFAULT_WR_CALENDAR_INSTRUMENT = 'cu';

const _rowCache = new Map();
let _shfeCookieJar = '';
let _shfeCookieAt = 0;
const SHFE_COOKIE_TTL_MS = 5 * 60 * 1000;

function normDate(d) {
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return String(d || '').slice(0, 10);
}

function toYyyymmdd(dateStr) {
  return normDate(dateStr).replace(/-/g, '');
}

function fromYyyymmdd(yyyymmdd) {
  const s = String(yyyymmdd || '');
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function outPath(instrumentId) {
  return path.join(getHistoryDir(), OUT_SUBDIR, `${String(instrumentId).toLowerCase()}-daily.json`);
}

function legacyUrl(yyyymmdd) {
  return `https://www.shfe.com.cn/data/tradedata/future/dailydata/${yyyymmdd}dailystock.dat`;
}

function newHtmlUrl(yyyymmdd, exchange = 'shfe') {
  const ex = exchange === 'ine' ? 'ine' : 'shfe';
  return `https://www.shfe.com.cn/data/tradedata/future/stockdata/dailystock_${yyyymmdd}/ZH/${ex}/all.html`;
}

const INE_WAREHOUSE_IDS = new Set(['sc', 'lu', 'bc', 'nr', 'ec']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeCookies(existing, incoming) {
  const jar = new Map();
  for (const part of String(existing || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const [k] = part.split('=');
    if (k) jar.set(k, part);
  }
  for (const part of String(incoming || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const [k] = part.split('=');
    if (k) jar.set(k, part);
  }
  return [...jar.values()].join('; ');
}

function decompressBody(buf, encoding) {
  if (encoding === 'gzip') return zlib.gunzipSync(buf);
  if (encoding === 'deflate') return zlib.inflateSync(buf);
  if (encoding === 'br') return zlib.brotliDecompressSync(buf);
  return buf;
}

function requestShfeUrl(url, cookies = '', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      ...SHFE_BROWSER_HEADERS,
      ...extraHeaders,
      ...(cookies ? { Cookie: cookies } : {}),
    };
    https.get(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        headers,
        family: 4,
        timeout: 45000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          let buf = Buffer.concat(chunks);
          try {
            buf = decompressBody(buf, res.headers['content-encoding']);
          } catch {
            // keep raw body
          }
          const setCookie = (res.headers['set-cookie'] || [])
            .map((c) => c.split(';')[0])
            .join('; ');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: buf.toString('utf8'),
            cookies: setCookie,
          });
        });
      }
    ).on('error', reject).on('timeout', function onTimeout() {
      this.destroy(new Error('请求超时'));
    });
  });
}

async function ensureShfeCookies(force = false) {
  const now = Date.now();
  if (!force && _shfeCookieJar && now - _shfeCookieAt < SHFE_COOKIE_TTL_MS) {
    return _shfeCookieJar;
  }

  let cookies = '';
  for (let i = 0; i < 2; i += 1) {
    const home = await requestShfeUrl(SHFE_HOME, cookies);
    cookies = mergeCookies(cookies, home.cookies);
    await sleep(120);
  }

  _shfeCookieJar = cookies;
  _shfeCookieAt = now;
  return cookies;
}

async function fetchShfeText(url) {
  const cookies = await ensureShfeCookies();
  const res = await requestShfeUrl(url, cookies);
  return {
    ok: res.ok,
    status: res.status,
    text: res.text,
  };
}

function isWafHtml(text) {
  const t = String(text || '');
  return (
    t.includes('WEB 应用防火')
    || t.includes('safeline_bot_challenge')
    || t.includes('js-challenge')
  );
}

function hex2binary(hex) {
  let out = '';
  for (let i = 0; i < hex.length; i += 1) {
    const e = parseInt(hex[i], 16).toString(2);
    out += '0'.repeat(4 - e.length) + e;
  }
  return out;
}

function binSha1(prefix, suffix) {
  const hash = crypto.createHash('sha1').update(prefix + suffix).digest('hex');
  return hex2binary(hash);
}

function solveJsChallenge(prefix, leadingZeroBit, maxTries = 5000000) {
  for (let cnt = 0; cnt < maxTries; cnt += 1) {
    const suffix = cnt.toString(16);
    const hash = binSha1(prefix, suffix);
    if (hash.slice(0, leadingZeroBit) === '0'.repeat(leadingZeroBit)) {
      return suffix;
    }
  }
  return null;
}

function parseChallenge(html) {
  const prefixMatch = html.match(/var prefix = '([^']+)'/);
  const bitMatch = html.match(/var leading_zero_bit = (\d+)/);
  if (!prefixMatch || !bitMatch) return null;
  return { prefix: prefixMatch[1], leadingZeroBit: parseInt(bitMatch[1], 10) };
}

function extractSafelineCookie(setCookieHeader) {
  const parts = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader].filter(Boolean);
  for (const c of parts) {
    const m = String(c).match(/safeline_bot_challenge=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

async function fetchWithWafBypass(url, cookies = '') {
  let jar = cookies;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await requestShfeUrl(url, jar);
    jar = mergeCookies(jar, res.cookies);

    if (res.status === 200 && !isWafHtml(res.text) && res.text.length > 500) {
      return { ok: true, text: res.text, cookies: jar, status: res.status };
    }

    const challenge = parseChallenge(res.text || '');
    if (!challenge) {
      return { ok: false, text: res.text, cookies: jar, status: res.status, error: 'no-challenge' };
    }

    const safeline = extractSafelineCookie(res.cookies ? [res.cookies] : []);
    if (!safeline) {
      const cookieMatch = jar.match(/safeline_bot_challenge=([^;]+)/);
      if (!cookieMatch) {
        return { ok: false, error: 'no safeline cookie', status: res.status };
      }
    }

    const token = safeline || (jar.match(/safeline_bot_challenge=([^;]+)/) || [])[1];
    const suffix = solveJsChallenge(challenge.prefix, challenge.leadingZeroBit);
    if (!suffix) {
      return { ok: false, error: 'challenge unsolved', challenge };
    }

    jar = mergeCookies(jar, `safeline_bot_challenge_ans=${token}${suffix}`);
    await sleep(150);
  }
  return { ok: false, error: 'max attempts' };
}

function parseInstrumentFromHtml(html, instrumentId) {
  const label = INSTRUMENT_HTML_LABELS[String(instrumentId).toLowerCase()];
  if (!label) return null;

  const dateMatch = String(html).match(/(\d{4}-\d{2}-\d{2})\s+\d{4}/);
  const date = dateMatch?.[1];
  if (!date) return null;

  const marker = `<div class="cell">${label}</div>`;
  const startIdx = html.indexOf(marker);
  if (startIdx < 0) return null;

  const section = html.slice(startIdx, startIdx + 12000);
  const tableEnd = section.indexOf('</table>');
  const block = tableEnd >= 0 ? section.slice(0, tableEnd) : section;

  const totalMatch = block.match(
    /<td colspan="2">总计<\/td>\s*<td>([\d,]+)<\/td>\s*<td>(-?[\d,]+)<\/td>/
  );
  if (totalMatch) {
    return {
      date,
      warehouse_receipt: parseInt(totalMatch[1].replace(/,/g, ''), 10),
      change_dod: parseInt(totalMatch[2].replace(/,/g, ''), 10),
    };
  }

  const rows = [...block.matchAll(/<td>([\d,]+)<\/td>\s*<td>(-?[\d,]+)<\/td>/g)];
  if (!rows.length) return null;

  if (rows.length === 1) {
    return {
      date,
      warehouse_receipt: parseInt(rows[0][1].replace(/,/g, ''), 10),
      change_dod: parseInt(rows[0][2].replace(/,/g, ''), 10),
    };
  }

  let wr = 0;
  let chg = 0;
  for (const m of rows) {
    wr += parseInt(m[1].replace(/,/g, ''), 10) || 0;
    chg += parseInt(m[2].replace(/,/g, ''), 10) || 0;
  }
  return { date, warehouse_receipt: wr, change_dod: chg };
}

function parseInstrumentsFromHtml(html, instrumentIds) {
  const instruments = {};
  for (const id of instrumentIds) {
    const row = parseInstrumentFromHtml(html, id);
    if (!row) continue;
    instruments[id] = {
      date: row.date,
      instrument_id: id,
      warehouse_receipt: row.warehouse_receipt,
      change_dod: row.change_dod,
      exchange: 'SHFE',
      unit: '1',
      source: 'shfe-official',
    };
  }
  if (!Object.keys(instruments).length) return null;
  const date = Object.values(instruments)[0].date;
  return { date, instruments };
}

function extractJsonFromHtml(text) {
  const t = String(text || '').trim();
  if (!t || isWafHtml(t)) return null;
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }

  const scriptMatch = t.match(/<script[^>]*>\s*(\{[\s\S]*?"o_cursor"[\s\S]*?\})\s*<\/script>/i);
  if (scriptMatch) {
    try {
      return JSON.parse(scriptMatch[1]);
    } catch {
      // fall through
    }
  }

  const varMatch = t.match(/(?:var|let|const)\s+\w+\s*=\s*(\{[\s\S]*?"o_cursor"[\s\S]*?\});/i);
  if (varMatch) {
    try {
      return JSON.parse(varMatch[1]);
    } catch {
      return null;
    }
  }

  return null;
}

function resolveRowInstrumentId(row) {
  const varId = String(row?.VARID || row?.varid || '').toLowerCase();
  if (varId && varId.length <= 4) return varId;

  const name = String(row?.VARNAME || row?.varname || '');
  for (const [id, label] of Object.entries(INSTRUMENT_VARNAMES)) {
    if (name === label) return id;
  }
  if (name.includes('COPPER') && !name.includes('(BC)')) return 'cu';
  if (name.includes('ALUMINIUM') || name.includes('ALUMINUM')) {
    if (!name.includes('Oxide')) return 'al';
  }
  if (name.includes('ZINC')) return 'zn';
  if (name.includes('NICKEL')) return 'ni';
  if (name.includes('LEAD')) return 'pb';
  if (name.includes('TIN')) return 'sn';
  if (name.includes('REBAR') || name.includes('螺纹')) return 'rb';
  if (name.includes('HOT ROLLED') || name.includes('热轧')) return 'hc';
  if (name.includes('STAINLESS') || name.includes('不锈钢')) return 'ss';
  if (name.includes('ALUMINA') || name.includes('氧化铝')) return 'ao';
  if (name.includes('GOLD')) return 'au';
  if (name.includes('SILVER')) return 'ag';
  if (name.includes('NATURAL RUBBER') || name.includes('天然橡胶')) return 'ru';
  if (name.includes('FUEL OIL') && !name.includes('LOW')) return 'fu';
  if (name.includes('BITUMEN') || name.includes('沥青')) return 'bu';
  if (name.includes('PULP') || name.includes('纸浆')) return 'sp';
  if (name.includes('BUTADIENE') || name.includes('丁二烯')) return 'br';
  if (name.includes('CAST ALUMINUM') || name.includes('铸造铝')) return 'ad';
  if (name.includes('WIRE ROD') || name.includes('线材')) return 'wr';
  if (name.includes('CRUDE OIL') || name.includes('原油')) return 'sc';
  if (name.includes('LOW SULFUR') || name.includes('低硫')) return 'lu';
  if (name.includes('COPPER(BC)') || name.includes('国际铜')) return 'bc';
  if (name.includes('TSR') || name.includes('20号胶') || name.includes('NO.20')) return 'nr';
  return null;
}

function rowsForInstrument(rows, instrumentId) {
  const id = String(instrumentId).toLowerCase();
  return (rows || []).filter((r) => resolveRowInstrumentId(r) === id);
}

function pickInstrumentTotal(rows, instrumentId) {
  const items = rowsForInstrument(rows, instrumentId);
  if (!items.length) return null;

  const grand = items.find((r) => {
    if (String(r.ROWSTATUS) !== '2') return false;
    const abbr = String(r.WHABBRNAME || '');
    return abbr === '总计$$Total' || abbr.split('$$')[0] === '总计';
  });
  if (grand) {
    return {
      warehouse_receipt: Number(grand.WRTWGHTS) || 0,
      change_dod: Number(grand.WRTCHANGE) || 0,
      unit: grand.WGHTUNIT || null,
    };
  }

  const leaf = items.filter((r) => String(r.ROWSTATUS) === '0');
  if (!leaf.length) return null;

  return {
    warehouse_receipt: leaf.reduce((sum, r) => sum + (Number(r.WRTWGHTS) || 0), 0),
    change_dod: leaf.reduce((sum, r) => sum + (Number(r.WRTCHANGE) || 0), 0),
    unit: leaf[0].WGHTUNIT || null,
  };
}

function parseDailyStockPayload(payload, instrumentIds) {
  const rows = payload?.o_cursor;
  const tradingDay = payload?.o_tradingday || payload?.report_date;
  if (!Array.isArray(rows) || !tradingDay) return null;

  const date = fromYyyymmdd(String(tradingDay).slice(0, 8));
  if (!date) return null;

  const out = {};
  for (const id of instrumentIds) {
    const picked = pickInstrumentTotal(rows, id);
    if (!picked) continue;
    out[id] = {
      date,
      instrument_id: id,
      warehouse_receipt: picked.warehouse_receipt,
      change_dod: picked.change_dod,
      exchange: 'SHFE',
      unit: picked.unit,
      source: 'shfe-official',
    };
  }

  return Object.keys(out).length ? { date, instruments: out } : null;
}

async function fetchDailyStockViaWafBypass(yyyymmdd, instrumentIds = P0_INSTRUMENTS) {
  const ids = (instrumentIds || []).map((s) => String(s).toLowerCase());
  const shfeIds = ids.filter((id) => !INE_WAREHOUSE_IDS.has(id));
  const ineIds = ids.filter((id) => INE_WAREHOUSE_IDS.has(id));
  await ensureShfeCookies(true);

  const merged = { instruments: {}, date: null };
  let lastMeta = null;

  for (const [ex, subset] of [
    ['shfe', shfeIds],
    ['ine', ineIds],
  ]) {
    if (!subset.length) continue;
    const url = newHtmlUrl(yyyymmdd, ex);
    const res = await fetchWithWafBypass(url);
    lastMeta = { format: 'waf-bypass', url, httpStatus: res.status, error: res.error };
    if (!res.ok) continue;

    const json = extractJsonFromHtml(res.text);
    if (json?.o_cursor) {
      const parsed = parseDailyStockPayload(json, subset);
      if (parsed?.instruments) {
        Object.assign(merged.instruments, parsed.instruments);
        merged.date = parsed.date || merged.date;
        lastMeta = { format: 'waf-bypass-json', url, payload: json, httpStatus: 200 };
      }
      continue;
    }

    const htmlParsed = parseInstrumentsFromHtml(res.text, subset);
    if (htmlParsed?.instruments && Object.keys(htmlParsed.instruments).length) {
      Object.assign(merged.instruments, htmlParsed.instruments);
      merged.date = htmlParsed.date || merged.date;
      lastMeta = { format: 'waf-bypass-html', url, htmlParsed, httpStatus: 200 };
    }
  }

  if (Object.keys(merged.instruments).length) {
    return {
      format: lastMeta?.format || 'waf-bypass-merged',
      url: lastMeta?.url,
      htmlParsed: { date: merged.date, instruments: merged.instruments },
      payload: lastMeta?.payload,
      httpStatus: 200,
    };
  }

  return {
    format: 'waf-bypass-unparsed',
    url: lastMeta?.url || newHtmlUrl(yyyymmdd, 'shfe'),
    httpStatus: lastMeta?.httpStatus || 0,
    error: lastMeta?.error || 'no o_cursor or html rows',
  };
}

async function fetchNewHtmlWithHeaderTricks(yyyymmdd) {
  const neu = newHtmlUrl(yyyymmdd);
  const headerVariants = [
    { label: 'default', headers: {} },
    { label: 'xhr', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json,text/plain,*/*' } },
    { label: 'no-cookie', headers: { Cookie: '' }, skipCookies: true },
    { label: 'navigate', headers: { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' } },
  ];

  for (const variant of headerVariants) {
    try {
      let cookies = '';
      if (!variant.skipCookies) {
        cookies = await ensureShfeCookies();
      }
      const res = await requestShfeUrl(neu, variant.skipCookies ? '' : cookies, variant.headers);
      const text = res.text;
      if (res.status !== 200) continue;
      if (isWafHtml(text)) continue;
      const json = extractJsonFromHtml(text);
      if (json?.o_cursor) {
        return {
          format: `new-html-${variant.label}`,
          url: neu,
          payload: json,
          httpStatus: res.status,
        };
      }
    } catch {
      // try next header variant
    }
  }

  return null;
}

async function fetchDailyStockRaw(yyyymmdd, instrumentIds = P0_INSTRUMENTS) {
  const legacy = legacyUrl(yyyymmdd);
  try {
    const res = await fetchShfeText(legacy);
    const text = res.text;
    if (res.status === 200 && text.length > 200) {
      try {
        const json = JSON.parse(text);
        if (json?.o_cursor) {
          return { format: 'legacy-dat', url: legacy, payload: json, httpStatus: res.status };
        }
      } catch {
        const embedded = extractJsonFromHtml(text);
        if (embedded?.o_cursor) {
          return { format: 'legacy-embedded', url: legacy, payload: embedded, httpStatus: res.status };
        }
      }
    }
    if (res.status !== 404) {
      return { format: 'legacy-fail', url: legacy, httpStatus: res.status, error: `HTTP ${res.status}` };
    }
  } catch (err) {
    // fall through to new URL
  }

  const neu = newHtmlUrl(yyyymmdd);
  const headerAttempt = await fetchNewHtmlWithHeaderTricks(yyyymmdd);
  if (headerAttempt?.payload) return headerAttempt;

  try {
    const res = await fetchShfeText(neu);
    const text = res.text;
    if (res.status !== 200) {
      const bypass = await fetchDailyStockViaWafBypass(yyyymmdd, instrumentIds);
      if (bypass.payload || bypass.htmlParsed) return bypass;
      return { format: 'new-fail', url: neu, httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    if (isWafHtml(text)) {
      const bypass = await fetchDailyStockViaWafBypass(yyyymmdd, instrumentIds);
      if (bypass.payload || bypass.htmlParsed) return bypass;
      return { format: 'new-waf', url: neu, httpStatus: res.status, error: 'WAF' };
    }
    const json = extractJsonFromHtml(text);
    if (json?.o_cursor) {
      return { format: 'new-html', url: neu, payload: json, httpStatus: res.status };
    }
    const bypass = await fetchDailyStockViaWafBypass(yyyymmdd, instrumentIds);
    if (bypass.payload || bypass.htmlParsed) return bypass;
    return { format: 'new-unparsed', url: neu, httpStatus: res.status, error: 'no o_cursor' };
  } catch (err) {
    const bypass = await fetchDailyStockViaWafBypass(yyyymmdd, instrumentIds);
    if (bypass.payload || bypass.htmlParsed) return bypass;
    return { format: 'error', url: neu, error: err.message };
  }
}

function loadTradingBars(instrumentId = 'cu', startDate = DEFAULT_START) {
  const fp = path.join(getHistoryDir(), 'trading', `${String(instrumentId).toLowerCase()}.json`);
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const series = Array.isArray(raw) ? raw : raw.series || raw.klines || [];
    return series.filter((r) => {
      const d = normDate(r.date || r.time);
      return d && d >= startDate;
    });
  } catch {
    return [];
  }
}

function loadTradingDates(instrumentId = 'cu', startDate = DEFAULT_START) {
  const fp = path.join(getHistoryDir(), 'trading', `${String(instrumentId).toLowerCase()}.json`);
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const series = Array.isArray(raw) ? raw : raw.series || raw.klines || [];
    return series
      .map((r) => normDate(r.date || r.time))
      .filter((d) => d && d >= startDate)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function tradingCalendarInstrumentId(instrumentId) {
  const id = String(instrumentId).toLowerCase();
  return WR_CALENDAR_INSTRUMENT[id] || DEFAULT_WR_CALENDAR_INSTRUMENT;
}

function loadInstrumentTradingDates(instrumentId, startDate, endDate) {
  const calId = tradingCalendarInstrumentId(instrumentId);
  return loadTradingDates(calId, startDate).filter((d) => d <= endDate);
}

function buildScrapeTradingSchedule(instruments, startDate, endDate) {
  const ids = [...new Set((instruments || []).map((s) => String(s).toLowerCase()))];
  const calendarByInstrument = {};
  const datesByCalendar = {};
  const tradingDatesByInstrument = {};

  for (const id of ids) {
    const calId = tradingCalendarInstrumentId(id);
    calendarByInstrument[id] = calId;
    if (!datesByCalendar[calId]) {
      datesByCalendar[calId] = loadTradingDates(calId, startDate).filter((d) => d <= endDate);
    }
    tradingDatesByInstrument[id] = datesByCalendar[calId];
  }

  for (const [calId, dates] of Object.entries(datesByCalendar)) {
    if (!dates.length) {
      throw new Error(`无法'history/trading/${calId}.json 读取交易日历`);
    }
  }

  const dateSet = new Set();
  for (const id of ids) {
    for (const d of tradingDatesByInstrument[id]) dateSet.add(d);
  }

  return {
    tradingDates: [...dateSet].sort((a, b) => a.localeCompare(b)),
    tradingDatesByInstrument,
    calendarByInstrument,
    datesByCalendar,
  };
}

function listMissingWarehouseDates(instrumentId, startDate = DEFAULT_START, endDate = normDate(new Date())) {
  const id = String(instrumentId).toLowerCase();
  const existing = loadExistingRows(id);
  const tradingDays = loadInstrumentTradingDates(id, startDate, endDate);
  const missingDates = tradingDays.filter((d) => !existing.dates.has(d));
  return {
    instrumentId: id,
    calendarInstrument: tradingCalendarInstrumentId(id),
    startDate,
    endDate,
    tradingDays: tradingDays.length,
    filled: tradingDays.length - missingDates.length,
    missingCount: missingDates.length,
    missingDates,
  };
}

const WR_SOURCE_PRIORITY = {
  'shfe-official': 3,
  'dce-portal-api': 3,
  'czce-official': 3,
  'gfex-official': 3,
  'user-import-spdr': 2,
  'user-import': 1,
  macromicro: 1,
};

function sourcePriority(source) {
  return WR_SOURCE_PRIORITY[String(source || '').toLowerCase()] ?? 1;
}

function mergeWarehouseRows(existingRows, incomingRows) {
  const byDate = new Map();
  let added = 0;
  let skippedOverlap = 0;
  let replaced = 0;

  for (const row of existingRows || []) {
    const d = normDate(row.date);
    if (!d) continue;
    byDate.set(d, { ...row, date: d });
  }

  for (const row of incomingRows || []) {
    const d = normDate(row.date);
    if (!d) continue;
    const existing = byDate.get(d);
    if (!existing) {
      byDate.set(d, { ...row, date: d });
      added += 1;
      continue;
    }
    const incPri = sourcePriority(row.source);
    const existPri = sourcePriority(existing.source);
    if (incPri > existPri) {
      byDate.set(d, { ...row, date: d });
      replaced += 1;
    } else {
      skippedOverlap += 1;
    }
  }

  const rows = [...byDate.values()].sort((a, b) => normDate(a.date).localeCompare(normDate(b.date)));
  const sourceCounts = {};
  for (const row of rows) {
    const s = row.source || 'unknown';
    sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  }
  return { rows, added, replaced, skippedOverlap, rowCount: rows.length, sourceCounts };
}

function loadExistingRows(instrumentId) {
  const fp = outPath(instrumentId);
  if (!fs.existsSync(fp)) return { rows: [], dates: new Set() };
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || raw.series || [];
    const dates = new Set(rows.map((r) => normDate(r.date)));
    return { rows, dates, meta: raw };
  } catch {
    return { rows: [], dates: new Set() };
  }
}

function saveWarehouseFile(instrumentId, rows, meta = {}) {
  const id = String(instrumentId).toLowerCase();
  const fp = outPath(id);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const sorted = [...rows].sort((a, b) => normDate(a.date).localeCompare(normDate(b.date)));
  const payload = {
    instrumentId: id,
    label: `${id.toUpperCase()} 注册仓单`,
    freq: 'daily',
    source: 'shfe-official',
    exchange: 'SHFE',
    updated: new Date().toISOString(),
    startDate: sorted.length ? normDate(sorted[0].date) : null,
    endDate: sorted.length ? normDate(sorted[sorted.length - 1].date) : null,
    rowCount: sorted.length,
    schema: {
      date: 'YYYY-MM-DD',
      warehouse_receipt: '注册仓单量（官方 WRTWGHTS',
      change_dod: '日变/WRTCHANGE',
      exchange: 'SHFE',
    },
    ...meta,
    data: sorted,
  };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  _rowCache.delete(id);
  return fp;
}

async function scrapeWarehouseReceipts(options = {}) {
  const instruments = (options.instruments || P0_INSTRUMENTS).map((s) => String(s).toLowerCase());
  const startDate = options.startDate || DEFAULT_START;
  const endDate = options.endDate || normDate(new Date());
  const force = Boolean(options.force);
  const rateMs = options.rateMs ?? DEFAULT_RATE_MS;
  const dryRun = Boolean(options.dryRun);
  const schedule = buildScrapeTradingSchedule(instruments, startDate, endDate);
  const { tradingDates, tradingDatesByInstrument, calendarByInstrument, datesByCalendar } = schedule;
  const tradingDateSets = {};
  for (const id of instruments) {
    tradingDateSets[id] = new Set(tradingDatesByInstrument[id]);
  }

  const perInstrument = {};
  for (const id of instruments) {
    const existing = loadExistingRows(id);
    // force = 强制重抓窗口内日期并覆盖同日；禁止清空历史（防误 truncate）
    perInstrument[id] = {
      rows: [...existing.rows],
      dates: force ? new Set() : new Set(existing.dates),
      skippedExisting: 0,
      fetched: 0,
      misses: 0,
      errors: [],
      _existingBefore: existing.rows.length,
    };
    if (force) {
      // 仅清空窗口内 dates，窗口外历史行保留在 rows 中
      const keepDates = new Set(
        existing.rows
          .map((r) => normDate(r.date))
          .filter((d) => d && (d < startDate || d > endDate))
      );
      perInstrument[id].dates = keepDates;
      perInstrument[id].rows = existing.rows.filter((r) => {
        const d = normDate(r.date);
        return d && (d < startDate || d > endDate);
      });
    }
  }

  if (dryRun) {
    const gaps = instruments.map((id) => listMissingWarehouseDates(id, startDate, endDate));
    return {
      dryRun: true,
      instruments,
      startDate,
      endDate,
      force,
      tradingDays: tradingDates.length,
      calendars: calendarByInstrument,
      calendarDayCounts: Object.fromEntries(
        Object.entries(datesByCalendar).map(([calId, dates]) => [calId, dates.length])
      ),
      gaps,
      results: gaps.map((g) => ({
        instrumentId: g.instrumentId,
        status: g.missingCount ? 'gaps' : 'complete',
        calendarInstrument: g.calendarInstrument,
        tradingDays: g.tradingDays,
        filled: g.filled,
        missingCount: g.missingCount,
        missingDates: g.missingDates,
      })),
      dayFetches: 0,
      dayMisses: 0,
    };
  }

  let dayFetches = 0;
  let dayMisses = 0;

  for (const date of tradingDates) {
    const ymd = toYyyymmdd(date);
    const instrumentsToFetch = instruments.filter(
      (id) => tradingDateSets[id].has(date) && !perInstrument[id].dates.has(date)
    );
    if (!instrumentsToFetch.length) {
      for (const id of instruments) {
        if (tradingDateSets[id].has(date)) perInstrument[id].skippedExisting += 1;
      }
      continue;
    }

    const raw = await fetchDailyStockRaw(ymd, instrumentsToFetch);
    dayFetches += 1;
    if (!raw?.payload && !raw?.htmlParsed) {
      dayMisses += 1;
      if (raw?.error && perInstrument[instrumentsToFetch[0]].errors.length < 8) {
        perInstrument[instrumentsToFetch[0]].errors.push({ date, instruments: instrumentsToFetch, ...raw });
      }
      await sleep(rateMs);
      continue;
    }

    const parsed = raw.payload
      ? parseDailyStockPayload(raw.payload, instrumentsToFetch)
      : raw.htmlParsed;
    if (!parsed) {
      dayMisses += 1;
      await sleep(rateMs);
      continue;
    }

    for (const id of instrumentsToFetch) {
      const slot = perInstrument[id];
      const row = parsed.instruments[id];
      if (!row) {
        slot.misses += 1;
        continue;
      }
      if (slot.dates.has(date)) {
        slot.skippedExisting += 1;
        continue;
      }
      slot.rows.push(row);
      slot.dates.add(date);
      slot.fetched += 1;
    }

    await sleep(rateMs);
  }

  const results = [];
  for (const id of instruments) {
    const slot = perInstrument[id];
    if (slot.rows.length < 5) {
      results.push({
        instrumentId: id,
        status: 'insufficient',
        rowCount: slot.rows.length,
        fetched: slot.fetched,
        misses: slot.misses,
        errors: slot.errors.slice(0, 5),
      });
      continue;
    }

    const file = saveWarehouseFile(id, slot.rows, {
      scrapeStats: {
        tradingDays: tradingDatesByInstrument[id].length,
        calendarInstrument: calendarByInstrument[id],
        unionTradingDays: tradingDates.length,
        dayFetches,
        dayMisses,
        fetched: slot.fetched,
        misses: slot.misses,
        skippedExisting: slot.skippedExisting,
      },
    });

    results.push({
      instrumentId: id,
      status: 'ok',
      file,
      rowCount: slot.rows.length,
      startDate: normDate(slot.rows.sort((a, b) => a.date.localeCompare(b.date))[0]?.date),
      endDate: normDate(slot.rows.sort((a, b) => a.date.localeCompare(b.date))[slot.rows.length - 1]?.date),
      fetched: slot.fetched,
      misses: slot.misses,
      skippedExisting: slot.skippedExisting,
    });
  }

  return {
    results,
    instruments,
    tradingDays: tradingDates.length,
    calendars: calendarByInstrument,
    calendarDayCounts: Object.fromEntries(
      Object.entries(datesByCalendar).map(([calId, dates]) => [calId, dates.length])
    ),
    dayFetches,
    dayMisses,
    startDate,
    endDate,
  };
}

function loadWarehouseRows(instrumentId) {
  const id = String(instrumentId).toLowerCase();
  if (_rowCache.has(id)) return _rowCache.get(id);

  const fp = outPath(id);
  if (!fs.existsSync(fp)) {
    _rowCache.set(id, null);
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || raw.series || [];
    _rowCache.set(id, rows);
    return rows;
  } catch {
    _rowCache.set(id, null);
    return null;
  }
}

function getWarehouseReceiptAtDate(instrumentId, barDate) {
  const rows = loadWarehouseRows(instrumentId);
  if (!rows?.length) return null;
  const d = normDate(barDate);
  const row = rows.find((r) => normDate(r.date) === d);
  if (!row) return null;

  return {
    date: d,
    instrumentId: String(instrumentId).toLowerCase(),
    warehouseReceipt: row.warehouse_receipt != null ? Number(row.warehouse_receipt) : null,
    changeDod: row.change_dod != null ? Number(row.change_dod) : null,
    exchange: row.exchange || (String(row.source || '').includes('dce') ? 'DCE' : 'SHFE'),
    unit: row.unit || null,
    source: row.source || 'shfe-official',
  };
}

/**
 * 仓单相对 N 根日线前回溯的涨跌幅（交易日行，非自然日）。
 * @returns {{ pct, delta, cur, past, pastDate, lookbackRows } | null}
 */
function getWarehouseReceiptChgNdAtDate(instrumentId, barDate, lookbackRows = 5) {
  const id = String(instrumentId).toLowerCase();
  const n = Math.max(1, Math.min(320, Number(lookbackRows) || 5));
  const rows = loadWarehouseRows(id);
  if (!rows?.length) return null;

  const d = normDate(barDate);
  let idx = rows.findIndex((r) => normDate(r.date) === d);
  if (idx < 0) {
    // 用最近不超过目标日的仓单日
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (normDate(rows[i].date) <= d) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return null;

  const cur = rows[idx].warehouse_receipt;
  if (cur == null) return null;

  const pastIdx = idx - n;
  if (pastIdx < 0) return null;

  const past = rows[pastIdx].warehouse_receipt;
  if (past == null || !Number.isFinite(Number(past))) return null;

  const delta = Number(cur) - Number(past);
  const denom = Math.max(Math.abs(Number(past)), 1);
  const pct = (delta / denom) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > 500) return null;
  return {
    pct: +pct.toFixed(4),
    delta: +delta.toFixed(4),
    cur: Number(cur),
    past: Number(past),
    pastDate: normDate(rows[pastIdx].date),
    asOfDate: normDate(rows[idx].date),
    lookbackRows: n,
  };
}

function getWarehouseReceiptChg5dAtDate(instrumentId, barDate) {
  const id = String(instrumentId).toLowerCase();
  if (!WR_CHG5D_INSTRUMENTS.has(id)) return null;
  const slot = getWarehouseReceiptChgNdAtDate(id, barDate, 5);
  return slot?.pct ?? null;
}

module.exports = {
  DEFAULT_START,
  OUT_SUBDIR,
  P0_INSTRUMENTS,
  DCE_WR_INSTRUMENTS,
  CZCE_WR_INSTRUMENTS,
  GFEX_WR_INSTRUMENTS,
  WR_SOURCE_PRIORITY,
  legacyUrl,
  newHtmlUrl,
  extractJsonFromHtml,
  parseDailyStockPayload,
  pickInstrumentTotal,
  fetchDailyStockRaw,
  fetchDailyStockViaWafBypass,
  fetchWithWafBypass,
  parseInstrumentFromHtml,
  parseInstrumentsFromHtml,
  solveJsChallenge,
  scrapeWarehouseReceipts,
  saveWarehouseFile,
  mergeWarehouseRows,
  loadExistingRows,
  loadTradingDates,
  loadTradingBars,
  tradingCalendarInstrumentId,
  loadInstrumentTradingDates,
  buildScrapeTradingSchedule,
  listMissingWarehouseDates,
  WR_CALENDAR_INSTRUMENT,
  DEFAULT_WR_CALENDAR_INSTRUMENT,
  loadWarehouseRows,
  getWarehouseReceiptAtDate,
  getWarehouseReceiptChgNdAtDate,
  getWarehouseReceiptChg5dAtDate,
  WR_CHG5D_INSTRUMENTS,
  resolveRowInstrumentId,
  rowsForInstrument,
  isWafHtml,
  ensureShfeCookies,
  fetchShfeText,
  requestShfeUrl,
  mergeCookies,
};
