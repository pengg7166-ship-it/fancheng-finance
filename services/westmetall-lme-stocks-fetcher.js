/**
 * Westmetall 公开 LME 库存表（免费、可审计）
 * https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Cu_cash&year=YYYY
 * 非付费 API；每行 date + cash + 3m + stock，取 stock 列。
 */
const { fetchText } = require('./http-client');

const WM_VERSION = 'v1.56.21-westmetall-lme';

const METAL_FIELDS = {
  copper: 'LME_Cu_cash',
  aluminum: 'LME_Al_cash',
  aluminium: 'LME_Al_cash',
  zinc: 'LME_Zn_cash',
  nickel: 'LME_Ni_cash',
  lead: 'LME_Pb_cash',
  tin: 'LME_Sn_cash',
};

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseWestmetallDate(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2})\.\s*([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const dd = String(m[1]).padStart(2, '0');
  const mm = String(mon).padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function parseStockNumber(raw) {
  const n = parseFloat(String(raw || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseYearTableHtml(html, metal) {
  const rows = [];
  const re =
    /<tr[^>]*>\s*<td[^>]*>(\d{1,2}\.\s*[A-Za-z]+\s+\d{4})<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const week_ending = parseWestmetallDate(match[1]);
    const inventory_tonnes = parseStockNumber(match[4]);
    if (!week_ending || inventory_tonnes == null) continue;
    rows.push({
      week_ending,
      metal,
      inventory_tonnes,
      change_wow: null,
      source: 'westmetall',
    });
  }
  return rows;
}

async function fetchMetalYear(metal, year, field) {
  const url = `https://www.westmetall.com/en/markdaten.php?action=table&field=${field}&year=${year}`;
  const html = await fetchText(url, {
    timeout: 45000,
    retries: 2,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  return parseYearTableHtml(html, metal);
}

/**
 * @param {string} metal copper|aluminum|zinc|nickel|lead|tin
 * @param {{ startYear?: number, endYear?: number }} [options]
 */
async function scrapeWestmetallLmeStocks(metal = 'copper', options = {}) {
  const m = String(metal || 'copper').toLowerCase();
  const canon = m === 'aluminium' ? 'aluminum' : m;
  const field = METAL_FIELDS[canon] || METAL_FIELDS[m];
  if (!field) {
    return { version: WM_VERSION, status: 'failed', reason: 'unsupported_metal', metal: m };
  }

  const endYear = options.endYear || new Date().getFullYear();
  const startYear = options.startYear || Math.max(2019, endYear - 7);
  const byWeek = new Map();
  const yearStats = [];

  for (let y = startYear; y <= endYear; y += 1) {
    try {
      const rows = await fetchMetalYear(canon, y, field);
      yearStats.push({ year: y, rows: rows.length, ok: true });
      for (const row of rows) byWeek.set(row.week_ending, row);
    } catch (err) {
      yearStats.push({ year: y, rows: 0, ok: false, error: err.message });
    }
  }

  const rows = [...byWeek.values()].sort((a, b) => a.week_ending.localeCompare(b.week_ending));
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].change_wow == null) {
      rows[i].change_wow = +(rows[i].inventory_tonnes - rows[i - 1].inventory_tonnes).toFixed(2);
    }
  }

  if (!rows.length) {
    return {
      version: WM_VERSION,
      status: 'empty',
      metal: canon,
      field,
      yearStats,
      dataSource: 'westmetall-html-table',
    };
  }

  return {
    version: WM_VERSION,
    status: 'ok',
    metal: canon,
    field,
    rows,
    latest: rows[rows.length - 1],
    startDate: rows[0].week_ending,
    endDate: rows[rows.length - 1].week_ending,
    rowCount: rows.length,
    yearStats,
    source: 'westmetall',
    label: `Westmetall LME ${canon} stocks`,
    manualUrl: `https://www.westmetall.com/en/markdaten.php?action=table&field=${field}`,
    dataSource: 'westmetall-html-table',
    method: 'yearly-table-scrape',
  };
}

async function scrapeAllWestmetallLmeStocks(options = {}) {
  const metals = options.metals || ['copper', 'aluminum', 'zinc', 'nickel', 'lead', 'tin'];
  const out = {};
  for (const metal of metals) {
    out[metal] = await scrapeWestmetallLmeStocks(metal, options);
  }
  return { version: WM_VERSION, metals: out };
}

module.exports = {
  WM_VERSION,
  METAL_FIELDS,
  parseWestmetallDate,
  parseYearTableHtml,
  scrapeWestmetallLmeStocks,
  scrapeAllWestmetallLmeStocks,
};
