/**
 * Verify DeepSeek macro data (real10y + PMI) against authoritative sources.
 * Usage: node scripts/verify-macro-data.js
 */
const fs = require('fs');
const path = require('path');
const { fetchJson, fetchText } = require('../services/http-client');
const { getDataDir } = require('../services/data-paths');

const EM_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const EM_HEADERS = { Referer: 'https://data.eastmoney.com/' };

const DEEPSEEK_REAL10Y = {
  '2025-01': 2.06, '2025-02': 2.03, '2025-03': 1.86, '2025-04': 1.67,
  '2025-05': 1.67, '2025-06': 1.87, '2025-07': 1.66, '2025-08': 1.57,
  '2025-09': 1.57, '2025-10': 1.55, '2025-11': 1.61, '2025-12': 1.46,
  '2026-01': 1.67, '2026-02': 1.75, '2026-03': 1.47, '2026-04': 1.59, '2026-05': 1.63,
};

const DEEPSEEK_PMI = {
  cn: {
    '2025-01': 49.1, '2025-02': 50.2, '2025-03': 50.5, '2025-04': 49.0, '2025-05': 49.5,
    '2025-06': 49.7, '2025-07': 49.3, '2025-08': 49.4, '2025-09': 49.8, '2025-10': 49.0,
    '2025-11': 49.2, '2025-12': 50.1, '2026-01': 49.3, '2026-02': 49.0, '2026-03': 50.4,
    '2026-04': 50.3, '2026-05': 50.0,
  },
  us: {
    '2025-02': 50.3, '2025-03': 49.0, '2025-04': 50.0, '2025-05': 48.7, '2025-06': 49.0,
    '2025-08': 47.9, '2025-09': 48.7, '2025-10': 48.3, '2025-11': 48.1, '2025-12': 47.9,
    '2026-01': 52.6, '2026-02': 52.4, '2026-03': 52.7, '2026-04': 52.7, '2026-05': 54.0,
  },
  ez: {
    '2025-12': 48.8, '2026-01': 51.5, '2026-03': 51.9, '2026-04': 50.9, '2026-05': 50.3,
  },
};

function historyDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'history');
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function monthKey(timeStr) {
  const s = String(timeStr || '');
  const m = s.match(/(\d{4})[-年](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  return s.slice(0, 7);
}

async function fetchChinaPmiHistory() {
  const params = new URLSearchParams({
    reportName: 'RPT_ECONOMY_PMI',
    columns: 'REPORT_DATE,TIME,MAKE_INDEX,MAKE_SAME',
    pageSize: '30',
    pageNumber: '1',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB',
  });
  const json = await fetchJson(`${EM_BASE}?${params}`, {
    timeout: 15000,
    headers: EM_HEADERS,
    retries: 2,
  });
  if (!json.success || !json.result?.data?.length) {
    throw new Error(json.message || 'China PMI fetch failed');
  }
  const out = {};
  for (const row of json.result.data) {
    const mk = monthKey(row.TIME || row.REPORT_DATE);
    if (mk >= '2025-01' && mk <= '2026-05') {
      out[mk] = parseFloat(row.MAKE_INDEX);
    }
  }
  return out;
}

function loadFredReal10yMonthly() {
  const p = path.join(historyDir(), 'fred-real10y-daily.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const out = {};
  for (const row of raw.series || []) {
    if (row.date.endsWith('-01') && row.date >= '2025-01-01') {
      out[row.date.slice(0, 7)] = round2(row.value);
    }
  }
  return { source: 'FRED REAINTRATREARAT10Y', data: out, file: p };
}

/** ISM from Trading Economics public table (no API key) */
async function fetchIsmFromTradingEconomics() {
  const url = 'https://tradingeconomics.com/united-states/manufacturing-pmi';
  const html = await fetchText(url, { timeout: 20000, retries: 1 });
  const out = {};
  // Table rows like: Jan 2026,52.6,52.4,...
  const re = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})[^0-9]*?(\d{2}\.\d)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const mk = `${m[1]}-${months[m[0].slice(0, 3)]}`;
    if (mk >= '2025-01' && mk <= '2026-05') out[mk] = parseFloat(m[2]);
  }
  return out;
}

/** Eurozone PMI from Trading Economics */
async function fetchEzFromTradingEconomics() {
  const url = 'https://tradingeconomics.com/euro-area/manufacturing-pmi';
  const html = await fetchText(url, { timeout: 20000, retries: 1 });
  const out = {};
  const re = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})[^0-9]*?(\d{2}\.\d)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const mk = `${m[1]}-${months[m[0].slice(0, 3)]}`;
    if (mk >= '2025-01' && mk <= '2026-05') out[mk] = parseFloat(m[2]);
  }
  return out;
}

function compareSeries(label, deepseek, actual, source, tolerance = 0.05) {
  const rows = [];
  const allKeys = new Set([...Object.keys(deepseek), ...Object.keys(actual)]);
  for (const mk of [...allKeys].sort()) {
    const ds = deepseek[mk];
    const act = actual[mk];
    let status = '待核实';
    if (act == null && ds == null) continue;
    if (act == null) {
      status = ds == null ? 'skip' : '待核实(无权威源)';
    } else if (ds == null) {
      status = 'verified_only_actual';
    } else {
      const diff = Math.abs(round2(ds) - round2(act));
      status = diff <= tolerance ? 'verified' : 'corrected';
    }
    rows.push({
      month: mk,
      deepseek: ds ?? null,
      actual: act ?? null,
      diff: act != null && ds != null ? round2(act - ds) : null,
      status,
      source,
    });
  }
  return rows;
}

async function main() {
  console.log('=== Macro Data Verification ===\n');

  const fred = loadFredReal10yMonthly();
  const real10yRows = compareSeries('real10y', DEEPSEEK_REAL10Y, fred.data, fred.source);
  console.log('Real10y:', real10yRows.filter((r) => r.status !== 'skip').length, 'rows');
  real10yRows.forEach((r) => {
    if (r.status !== 'skip') console.log(`  ${r.month} DS=${r.deepseek} ACT=${r.actual} ${r.status}`);
  });

  let cnPmi = {};
  try {
    cnPmi = await fetchChinaPmiHistory();
    console.log('\nChina PMI fetched:', Object.keys(cnPmi).length, 'months');
  } catch (e) {
    console.error('China PMI error:', e.message);
  }

  let usPmi = {};
  try {
    usPmi = await fetchIsmFromTradingEconomics();
    console.log('US ISM fetched:', Object.keys(usPmi).length, 'months', usPmi);
  } catch (e) {
    console.error('US ISM error:', e.message);
  }

  let ezPmi = {};
  try {
    ezPmi = await fetchEzFromTradingEconomics();
    console.log('Eurozone PMI fetched:', Object.keys(ezPmi).length, 'months', ezPmi);
  } catch (e) {
    console.error('Eurozone PMI error:', e.message);
  }

  const cnRows = compareSeries('cn_pmi', DEEPSEEK_PMI.cn, cnPmi, 'NBS via Eastmoney', 0.05);
  const usRows = compareSeries('us_pmi', DEEPSEEK_PMI.us, usPmi, 'ISM via TradingEconomics', 0.05);
  const ezRows = compareSeries('ez_pmi', DEEPSEEK_PMI.ez, ezPmi, 'HCOB via TradingEconomics', 0.05);

  const report = {
    generatedAt: new Date().toISOString(),
    real10y: { rows: real10yRows, source: fred.source },
    pmi: { cn: cnRows, us: usRows, ez: ezRows },
    authoritative: { cnPmi, usPmi, ezPmi, real10y: fred.data },
  };

  const outPath = path.join(process.cwd(), 'docs', 'macro-verification-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\nReport written:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
