/**
 * 8 年交易数据导入 — 校验 + 写入 history/trading/
 *
 * 用法:
 *   node scripts/import-trading-data.js <file.csv|file.json> [--instrument cu] [--dry-run]
 *
 * 期望列（CSV 表头，大小写不敏感）:
 *   date          YYYY-MM-DD 交易日
 *   instrument    合约代码，如 cu, rb, sc（也可用 instrument_id / symbol）
 *   price         收盘价或 settlement（也可用 close / settle）
 *   volume        成交量（手，可选）
 *   oi            持仓量 open interest（可选，也可用 open_interest）
 *
 * 多合约文件: 每行带 instrument 列；单合约文件: 加 --instrument cu
 *
 * 输出: {dataDir}/history/trading/{instrument}.json
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { getDataDir } = require('../services/data-paths');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');

const ALIAS = {
  date: ['date', 'trade_date', 'datetime', 'time'],
  instrument: ['instrument', 'instrument_id', 'symbol', 'code', 'contract'],
  price: ['price', 'close', 'settle', 'settlement', 'close_price'],
  volume: ['volume', 'vol', 'turnover_volume'],
  oi: ['oi', 'open_interest', 'openinterest', 'hold'],
};

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history', 'trading');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function mapHeader(headers) {
  const norm = headers.map(normHeader);
  const out = {};
  for (const [field, aliases] of Object.entries(ALIAS)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx >= 0) out[field] = idx;
  }
  return out;
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else cur += c;
  }
  fields.push(cur);
  return fields;
}

function parseCsvFile(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  const colMap = mapHeader(headers);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const get = (field) => {
      const idx = colMap[field];
      return idx != null ? (cols[idx] || '').trim() : '';
    };
    rows.push({
      date: get('date').slice(0, 10),
      instrument: get('instrument').toLowerCase(),
      price: parseFloat(get('price')),
      volume: parseFloat(get('volume')) || null,
      oi: parseFloat(get('oi')) || null,
    });
  }
  return rows;
}

function loadInput(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');
  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed.rows || parsed.data || parsed.series || [];
    return arr.map((r) => ({
      date: String(r.date || r.trade_date || '').slice(0, 10),
      instrument: String(r.instrument || r.instrument_id || r.symbol || '').toLowerCase(),
      price: Number(r.price ?? r.close ?? r.settle),
      volume: r.volume != null ? Number(r.volume) : null,
      oi: r.oi != null ? Number(r.oi) : r.open_interest != null ? Number(r.open_interest) : null,
    }));
  }
  return parseCsvFile(raw);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const instArg = (() => {
    const i = args.indexOf('--instrument');
    return i >= 0 ? args[i + 1] : null;
  })();
  const fileArg = args.find((a) => !a.startsWith('--') && a !== instArg);

  if (!fileArg) {
    console.log(`
梵澄金融 — 8 年交易数据导入

用法:
  node scripts/import-trading-data.js <你的文件.csv|json> [--instrument cu] [--dry-run]

期望列:
  date, instrument, price, volume, oi

示例 CSV:
  date,instrument,price,volume,oi
  2018-01-02,cu,52800,123456,89012
  2018-01-03,cu,53100,98765,90123

存放位置:
  E:\\FanchengFinance\\data\\history\\trading\\{instrument}.json

详见 docs/TRADING_DATA_IMPORT.md
`);
    process.exit(0);
  }

  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error('文件不存在:', filePath);
    process.exit(1);
  }

  let rows = loadInput(filePath);
  if (instArg) {
    rows = rows.map((r) => ({ ...r, instrument: instArg.toLowerCase() }));
  }

  const errors = [];
  const knownIds = new Set(INSTRUMENT_REGISTRY.map((s) => String(s.id).toLowerCase()));
  const byInst = new Map();

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errors.push(`行 ${i + 1}: date 无效`);
    if (!r.instrument) errors.push(`行 ${i + 1}: 缺少 instrument（或用 --instrument 指定）`);
    if (!Number.isFinite(r.price) || r.price <= 0) errors.push(`行 ${i + 1}: price 无效`);
    if (r.instrument && !knownIds.has(r.instrument)) {
      console.warn(`  警告: 未知合约 ${r.instrument}（仍将导入）`);
    }
    if (!byInst.has(r.instrument)) byInst.set(r.instrument, []);
    byInst.get(r.instrument).push({
      date: r.date,
      price: r.price,
      volume: r.volume,
      openInterest: r.oi,
    });
  }

  if (errors.length) {
    console.error('校验失败:\n' + errors.slice(0, 20).join('\n'));
    process.exit(1);
  }

  const outDir = getHistoryDir();
  console.log(`解析 ${rows.length} 行，${byInst.size} 个合约`);
  console.log(`输出目录: ${outDir}`);

  for (const [inst, series] of byInst) {
    series.sort((a, b) => a.date.localeCompare(b.date));
    const payload = {
      instrumentId: inst,
      source: path.basename(filePath),
      importedAt: new Date().toISOString(),
      rowCount: series.length,
      from: series[0]?.date,
      to: series[series.length - 1]?.date,
      series,
    };
    const outPath = path.join(outDir, `${inst}.json`);
    console.log(`  ${inst}: ${series.length} 行 (${payload.from} ~ ${payload.to})`);
    if (!dryRun) {
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    }
  }

  if (dryRun) console.log('\n[dry-run] 未写入文件');
  else console.log('\n导入完成。可运行 npm run fetch-all-history 与长周期回测验证。');
}

main();
