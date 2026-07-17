/**
 * 广期所仓单日报 — 官方 JSON
 * POST http://www.gfex.com.cn/u/interfacesWebTdWbillWeeklyQuotes/loadList
 * body: gen_date=YYYYMMDD
 */
const http = require('http');

const GFEX_WR_VERSION = 'v1.56.19-gfex-warehouse';
const FOCUS_VARIETIES = Object.freeze(['si', 'lc', 'ps', 'pt', 'pd']);

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

function postForm(path, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const req = http.request(
      {
        hostname: 'www.gfex.com.cn',
        path,
        method: 'POST',
        family: 4,
        timeout: 25000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'FanchengFinance/1.56 (GFEX warehouse)',
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, text, json });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function summarizeGfexRows(rows) {
  const bySym = {};
  for (const row of rows || []) {
    const sym = String(row.varietyOrder || '').toLowerCase().trim();
    if (!sym) continue;
    if (!bySym[sym]) bySym[sym] = { qty: 0, diff: 0, n: 0 };
    const q = Number(row.wbillQty);
    const d = Number(row.diff);
    if (Number.isFinite(q)) {
      bySym[sym].qty += q;
      bySym[sym].n += 1;
    }
    if (Number.isFinite(d)) bySym[sym].diff += d;
  }
  const totals = {};
  for (const [sym, v] of Object.entries(bySym)) {
    if (!v.n) continue;
    totals[sym] = { warehouse_receipt: v.qty, change_dod: v.diff };
  }
  return totals;
}

async function fetchGfexWarehouseDay(tradeDate) {
  const ymd = String(tradeDate).replace(/\D/g, '');
  const res = await postForm('/u/interfacesWebTdWbillWeeklyQuotes/loadList', { gen_date: ymd });
  if (res.status !== 200 || !res.json || String(res.json.code) !== '0') {
    return {
      tradeDate: ymd,
      empty: true,
      error: res.json?.msg || `HTTP ${res.status}`,
      totals: {},
    };
  }
  const totals = summarizeGfexRows(res.json.data || []);
  return {
    tradeDate: ymd,
    empty: !Object.keys(totals).length,
    totals,
    dataSource: 'gfex-official',
    method: 'interfacesWebTdWbillWeeklyQuotes',
  };
}

function persistGfexTotals(dayResult, varieties = FOCUS_VARIETIES) {
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
        exchange: 'GFEX',
        unit: '手',
        source: 'gfex-official',
      },
    ];
    const existing = wh.loadExistingRows(id);
    const merged = wh.mergeWarehouseRows(existing.rows, incoming);
    const fp = wh.saveWarehouseFile(id, merged.rows, {
      exchange: 'GFEX',
      source: 'gfex-official',
      label: `${id.toUpperCase()} 注册仓单 (GFEX)`,
    });
    results.push({
      varietyId: id,
      status: 'ok',
      date: dateIso,
      totalQty: slot.warehouse_receipt,
      rowCount: merged.rowCount,
      file: fp,
    });
  }
  return { status: 'ok', results };
}

async function scrapeGfexWarehouseReceipts(options = {}) {
  const varieties = (options.instruments || FOCUS_VARIETIES).map((s) => String(s).toLowerCase());
  let end = options.endDate ? toYyyymmdd(options.endDate) : toYyyymmdd(new Date().toISOString().slice(0, 10));
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
      const day = await fetchGfexWarehouseDay(cursor);
      if (!day.empty) {
        days.push({ tradeDate: cursor, persist: persistGfexTotals(day, varieties) });
        filled += 1;
      }
    } catch (err) {
      errors.push({ tradeDate: cursor, message: err.message });
    }
    cursor = priorYyyymmdd(cursor, 1);
    await new Promise((r) => setTimeout(r, options.rateMs ?? 350));
  }
  return {
    version: GFEX_WR_VERSION,
    endDate: end,
    lookback,
    target,
    daysFilled: filled,
    days,
    errors: errors.length ? errors : undefined,
    dataSource: 'gfex-official',
  };
}

module.exports = {
  GFEX_WR_VERSION,
  FOCUS_VARIETIES,
  fetchGfexWarehouseDay,
  scrapeGfexWarehouseReceipts,
  persistGfexTotals,
};
