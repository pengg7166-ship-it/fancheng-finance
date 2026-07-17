#!/usr/bin/env node
/**
 * Probe market data APIs: Sina/East Money live fetch + CTP front TCP reachability.
 * Logs JSONL to data/logs/api-probe.jsonl (or FANCHENG_DATA_DRIVE equivalent).
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { fetchText } = require('../services/http-client');
const { parseSinaFuturesLine } = require('../services/commodities-fetcher');
const { fetchCommodityHistory } = require('../services/commodities-history-fetcher');
const { getDataDir } = require('../services/data-paths');

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const SAMPLE_IDS = ['fg', 'au', 'cu'];
const SINA_CODES = { fg: 'FG0', au: 'AU0', cu: 'CU0' };

const CTP_TARGETS = [
  { label: 'founder_sim_md', host: '222.247.36.30', port: 33443, note: '方正中期仿真行情' },
  { label: 'founder_sim_md_alt', host: '58.20.35.94', port: 33443, note: '方正中期仿真行情备用' },
  { label: 'founder_sim_td', host: '222.247.36.30', port: 33437, note: '方正中期仿真交易' },
  { label: 'live_east_md', host: '101.230.85.33', port: 21413, note: '实盘华东主行情' },
  { label: 'live_east5_md', host: '101.230.117.249', port: 31413, note: '实盘华东五期行情' },
  { label: 'simnow_telecom1_md', host: '180.168.146.187', port: 10131, note: 'SimNow电信1行情' },
  { label: 'simnow_telecom2_md', host: '180.168.146.187', port: 10111, note: 'SimNow电信2行情' },
  { label: 'simnow_mobile_md', host: '218.202.237.33', port: 10112, note: 'SimNow移动行情' },
];

function logPath() {
  const dataDir = getDataDir();
  if (!dataDir) return path.join(process.cwd(), 'data', 'logs', 'api-probe.jsonl');
  return path.join(dataDir, 'logs', 'api-probe.jsonl');
}

function appendLog(entry) {
  const fp = logPath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
  fs.appendFileSync(fp, `${line}\n`, 'utf8');
  return line;
}

function tcpProbe(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ ok: false, error: 'timeout', ms: timeoutMs });
    }, timeoutMs);
    const started = Date.now();
    sock.on('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve({ ok: true, ms: Date.now() - started });
    });
    sock.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, ms: Date.now() - started });
    });
  });
}

async function probeSinaLive() {
  const codes = SAMPLE_IDS.map((id) => `nf_${SINA_CODES[id]}`);
  const url = `https://hq.sinajs.cn/list=${codes.join(',')}`;
  const results = [];
  try {
    const text = await fetchText(url, { headers: SINA_HEADERS, timeout: 20000, retries: 2 });
    for (const id of SAMPLE_IDS) {
      const sym = SINA_CODES[id];
      const re = new RegExp(`hq_str_nf_${sym}="([^"]*)"`);
      const m = text.match(re);
      const parsed = m ? parseSinaFuturesLine(m[1]) : null;
      results.push({
        id,
        source: 'sina_hq.sinajs.cn',
        ok: Boolean(parsed),
        quote: parsed
          ? {
              price: parsed.price,
              changePct: +parsed.changePct.toFixed(3),
              volume: parsed.volume,
              openInterest: parsed.openInterest,
              updatedAt: parsed.updatedAt,
            }
          : null,
      });
    }
    return { source: 'sina', ok: results.some((r) => r.ok), results };
  } catch (err) {
    return { source: 'sina', ok: false, error: err.message, results };
  }
}

async function probeEastMoneyDaily() {
  const results = [];
  for (const id of SAMPLE_IDS) {
    try {
      const data = await fetchCommodityHistory(id, 'day', { force: true });
      const bars = data.klines || [];
      const last = bars[bars.length - 1];
      results.push({
        id,
        source: data.source || 'eastmoney',
        ok: Boolean(last),
        bar: last
          ? { date: String(last.date).slice(0, 10), close: Number(last.close), bars: bars.length }
          : null,
      });
    } catch (err) {
      results.push({ id, source: 'eastmoney', ok: false, error: err.message });
    }
  }
  return { source: 'eastmoney_daily', ok: results.some((r) => r.ok), results };
}

async function probeCtpTcp() {
  const results = [];
  for (const t of CTP_TARGETS) {
    const r = await tcpProbe(t.host, t.port);
    results.push({ ...t, ...r });
  }
  return { source: 'ctp_tcp', ok: results.some((r) => r.ok), results };
}

async function main() {
  console.log('Market data API probe');
  console.log('Log file:', logPath());
  console.log('---');

  const summary = { probes: [] };

  const sina = await probeSinaLive();
  console.log('\n[Sina live]');
  for (const r of sina.results || []) {
    console.log(`  ${r.id}:`, r.ok ? JSON.stringify(r.quote) : r.error || 'no data');
  }
  summary.probes.push(sina);
  appendLog({ probe: 'sina_live', ...sina });

  const em = await probeEastMoneyDaily();
  console.log('\n[East Money daily K]');
  for (const r of em.results || []) {
    console.log(`  ${r.id}:`, r.ok ? JSON.stringify(r.bar) : r.error || 'no bars');
  }
  summary.probes.push(em);
  appendLog({ probe: 'eastmoney_daily', ...em });

  const ctp = await probeCtpTcp();
  console.log('\n[CTP TCP reachability]');
  for (const r of ctp.results || []) {
    console.log(`  ${r.label} ${r.host}:${r.port}:`, r.ok ? `REACHABLE (${r.ms}ms)` : `FAIL ${r.error}`);
  }
  summary.probes.push(ctp);
  appendLog({ probe: 'ctp_tcp', ...ctp });

  console.log('\n---');
  console.log('Summary:', {
    sinaOk: sina.ok,
    eastMoneyOk: em.ok,
    ctpAnyReachable: ctp.ok,
    ctpReachable: (ctp.results || []).filter((r) => r.ok).map((r) => `${r.host}:${r.port}`),
  });

  appendLog({ probe: 'summary', ...summary });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
