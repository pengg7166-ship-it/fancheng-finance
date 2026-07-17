/**
 * 郑商所仓单日报 — 官方 DFSStaticFiles Excel（非 REST）
 * URL: /cn/DFSStaticFiles/Future/{yyyy}/{yyyymmdd}/FutureDataWhsheet.xls|xlsx
 * 落盘复用 history/warehouse-receipts/{id}-daily.json（exchange: CZCE）
 * 失败返回 empty/暂无，不造假。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const CZCE_WR_VERSION = 'v1.56.19-czce-warehouse';
const FOCUS_VARIETIES = Object.freeze([
  'sa', 'fg', 'cf', 'sr', 'ta', 'ma', 'oi', 'rm',
  'sf', 'sm', 'cj', 'ur', 'pf', 'px', 'sh', 'pr', 'cy', 'pk', 'rs', 'ap',
]);

function fromYyyymmdd(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function toYyyymmdd(iso) {
  return String(iso || '').slice(0, 10).replace(/-/g, '');
}

function priorYyyymmdd(yyyymmdd, days = 1) {
  const iso = fromYyyymmdd(yyyymmdd);
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return toYyyymmdd(d.toISOString().slice(0, 10));
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        rejectUnauthorized: false,
        timeout: 30000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: '*/*',
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          resolve(requestBuffer(next, redirects + 1));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            buf: Buffer.concat(chunks),
            url,
            contentType: res.headers['content-type'] || '',
          })
        );
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function sheetUrl(tradeDate) {
  const ymd = String(tradeDate).replace(/\D/g, '');
  const yyyy = ymd.slice(0, 4);
  const ext = Number(ymd) > 20251101 ? 'xlsx' : 'xls';
  return `https://www.czce.com.cn/cn/DFSStaticFiles/Future/${yyyy}/${ymd}/FutureDataWhsheet.${ext}`;
}

function isExcelBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  const hex = buf.slice(0, 4).toString('hex');
  return hex === 'd0cf11e0' || hex === '504b0304';
}

function extractVarietyCode(cell0) {
  const s = String(cell0 || '');
  const tagged = s.match(/品种[：:]\s*[^\n]*?([A-Za-z]{1,4})\b/);
  if (tagged) return tagged[1].toLowerCase();
  const all = s.match(/[A-Za-z]{1,4}/g);
  return all?.length ? all[all.length - 1].toLowerCase() : null;
}

function parseCzceWorkbook(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const sections = {};
  let current = null;
  for (const row of rows) {
    const cell0 = String(row[0] ?? '').trim();
    if (/^品种/.test(cell0)) {
      current = extractVarietyCode(cell0);
      if (current) sections[current] = { header: null, rows: [] };
      continue;
    }
    if (!current || !sections[current]) continue;
    if (!sections[current].header) {
      sections[current].header = row.map((c) => String(c || '').trim());
      continue;
    }
    sections[current].rows.push(row);
  }

  const totals = {};
  for (const [sym, sec] of Object.entries(sections)) {
    const headers = (sec.header || []).map((h) => String(h));
    const qtyIdxs = headers
      .map((h, i) => (/仓单数量/.test(h) ? i : -1))
      .filter((i) => i >= 0);
    const qtyIdx = qtyIdxs[0] >= 0 ? qtyIdxs[0] : headers.findIndex((h) => /仓单量|今日仓单/.test(h));
    const chgIdx = headers.findIndex((h) => /当日增减|增减/.test(h));
    let grandQty = null;
    let grandChg = null;
    let subtotalQty = 0;
    let subtotalChg = 0;
    let subtotalN = 0;
    let rowQty = 0;
    let rowChg = 0;
    let rowN = 0;
    for (const r of sec.rows) {
      const label = String(r[0] ?? '');
      const takeQty = () => {
        if (qtyIdxs.length > 1) {
          return qtyIdxs.reduce((s, i) => {
            const n = parseFloat(String(r[i] || '').replace(/,/g, ''));
            return s + (Number.isFinite(n) ? n : 0);
          }, 0);
        }
        const n = parseFloat(String(r[qtyIdx >= 0 ? qtyIdx : 5] || '').replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
      };
      const takeChg = () => {
        const n = parseFloat(String(r[chgIdx >= 0 ? chgIdx : 6] || '').replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
      };
      if (/总计|合计/.test(label) && !/小计/.test(label)) {
        const q = takeQty();
        const c = takeChg();
        if (q != null) {
          grandQty = q;
          grandChg = c;
        }
        continue;
      }
      if (/小计/.test(label)) {
        const q = takeQty();
        const c = takeChg();
        if (q != null) {
          subtotalQty += q;
          subtotalN += 1;
        }
        if (c != null) subtotalChg += c;
        continue;
      }
      const q = takeQty();
      const c = takeChg();
      if (q != null) {
        rowQty += q;
        rowN += 1;
      }
      if (c != null) rowChg += c;
    }
    if (grandQty != null) {
      totals[sym] = { warehouse_receipt: grandQty, change_dod: grandChg };
    } else if (rowN > 0) {
      totals[sym] = { warehouse_receipt: rowQty, change_dod: rowChg };
    } else if (subtotalN > 0) {
      totals[sym] = { warehouse_receipt: subtotalQty, change_dod: subtotalChg };
    }
  }
  return totals;
}

/** 官方代码 → 关注池符号 */
const CZCE_CODE_ALIASES = Object.freeze({
  pta: 'ta',
});

function mapFocusTotals(totals, varieties = FOCUS_VARIETIES) {
  const out = {};
  for (const id of varieties) {
    if (totals[id]) out[id] = totals[id];
  }
  for (const [from, to] of Object.entries(CZCE_CODE_ALIASES)) {
    if (totals[from] && varieties.includes(to) && !out[to]) out[to] = totals[from];
  }
  return out;
}

async function fetchCzceWarehouseDay(tradeDate) {
  const ymd = String(tradeDate).replace(/\D/g, '');
  const url = sheetUrl(ymd);
  const res = await requestBuffer(url);
  if (!isExcelBuffer(res.buf)) {
    return {
      tradeDate: ymd,
      empty: true,
      status: res.status,
      reason: res.buf.toString('utf8', 0, 80).includes('无数据') ? 'no_data' : `HTTP ${res.status}`,
      url,
      totals: {},
    };
  }
  const totalsRaw = parseCzceWorkbook(res.buf);
  const totals = mapFocusTotals(totalsRaw, FOCUS_VARIETIES);
  // keep raw codes too for debugging/extra instruments
  for (const [k, v] of Object.entries(totalsRaw)) {
    if (!totals[k]) totals[k] = v;
  }
  return {
    tradeDate: ymd,
    empty: !Object.keys(totalsRaw).length,
    status: res.status,
    url,
    totals,
    totalsRaw,
    dataSource: 'czce-official',
    method: 'DFSStaticFiles-FutureDataWhsheet',
  };
}

function persistCzceTotals(dayResult, varieties = FOCUS_VARIETIES) {
  const wh = require('./shfe-warehouse-fetcher');
  const dateIso = fromYyyymmdd(dayResult.tradeDate);
  const results = [];
  if (!dateIso) return { status: 'failed', reason: 'bad_date', results };
  for (const id of varieties) {
    const slot = dayResult.totals?.[id];
    if (!slot || slot.warehouse_receipt == null) {
      results.push({ varietyId: id, status: 'empty', tradeDate: dayResult.tradeDate });
      continue;
    }
    const incoming = [
      {
        date: dateIso,
        instrument_id: id,
        warehouse_receipt: Number(slot.warehouse_receipt),
        change_dod: slot.change_dod != null ? Number(slot.change_dod) : null,
        exchange: 'CZCE',
        unit: '手',
        source: 'czce-official',
      },
    ];
    const existing = wh.loadExistingRows(id);
    const merged = wh.mergeWarehouseRows(existing.rows, incoming);
    const fp = wh.saveWarehouseFile(id, merged.rows, {
      exchange: 'CZCE',
      source: 'czce-official',
      label: `${id.toUpperCase()} 注册仓单 (CZCE)`,
      schema: {
        date: 'YYYY-MM-DD',
        warehouse_receipt: '仓单数量合计',
        change_dod: '当日增减合计',
        exchange: 'CZCE',
      },
    });
    results.push({
      varietyId: id,
      status: 'ok',
      date: dateIso,
      totalQty: slot.warehouse_receipt,
      totalDiff: slot.change_dod,
      rowCount: merged.rowCount,
      file: fp,
    });
  }
  return { status: 'ok', results };
}

async function scrapeCzceWarehouseReceipts(options = {}) {
  const varieties = (options.instruments || FOCUS_VARIETIES).map((s) => String(s).toLowerCase());
  let end = options.endDate ? toYyyymmdd(options.endDate) : null;
  if (!end) {
    const d = new Date();
    end = toYyyymmdd(d.toISOString().slice(0, 10));
  }
  const deep = options.deep === true || options.force === true;
  const lookback = Math.min(200, Math.max(1, Number(options.lookbackDays) || (deep ? 120 : 15)));
  const target = Math.min(lookback, Math.max(1, Number(options.targetDays) || (deep ? 80 : 10)));
  let isHoliday = () => false;
  try {
    isHoliday = require('./cn-trading-calendar').isCnHolidayDate;
  } catch {
    // optional
  }

  let cursor = end;
  let filled = 0;
  const days = [];
  const errors = [];
  for (let step = 0; step < lookback && filled < target; step += 1) {
    const iso = fromYyyymmdd(cursor);
    if (iso && isHoliday(iso)) {
      cursor = priorYyyymmdd(cursor, 1);
      continue;
    }
    try {
      const day = await fetchCzceWarehouseDay(cursor);
      if (!day.empty && Object.keys(day.totals || {}).length) {
        const persist = persistCzceTotals(day, varieties);
        days.push({ tradeDate: cursor, persist });
        filled += 1;
      }
    } catch (err) {
      errors.push({ tradeDate: cursor, message: err.message });
    }
    cursor = priorYyyymmdd(cursor, 1);
    await new Promise((r) => setTimeout(r, options.rateMs ?? 400));
  }

  return {
    version: CZCE_WR_VERSION,
    endDate: end,
    lookback,
    target,
    daysFilled: filled,
    days,
    errors: errors.length ? errors : undefined,
    dataSource: 'czce-official',
  };
}

module.exports = {
  CZCE_WR_VERSION,
  FOCUS_VARIETIES,
  fetchCzceWarehouseDay,
  scrapeCzceWarehouseReceipts,
  persistCzceTotals,
  sheetUrl,
  parseCzceWorkbook,
  mapFocusTotals,
  CZCE_CODE_ALIASES,
  extractVarietyCode,
};
