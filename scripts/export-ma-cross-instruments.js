/**
 * Export main-contract list for DemoMaCross1020 (exchange + infinitrader symbol).
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/export-ma-cross-instruments.js
 *   FANCHENG_DATA_DRIVE=E node scripts/export-ma-cross-instruments.js --max 56
 *   FANCHENG_DATA_DRIVE=E node scripts/export-ma-cross-instruments.js --force-main
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const { getCommodityMeta } = require('../services/commodities-catalog');
const mainContract = require('../services/main-contract-resolver');

const EXCHANGE_ID_TO_PYGO = {
  shfe: 'SHFE',
  dce: 'DCE',
  zce: 'CZCE',
  cffex: 'CFFEX',
  ine: 'INE',
  gfex: 'GFEX',
};

/** 东财 map 有、commodities-catalog 暂未收录的品种 */
const FALLBACK_EXCHANGE_BY_PRODUCT = {
  op: 'shfe',
  fb: 'dce',
  bz: 'dce',
  bb: 'dce',
  pl: 'zce',
  nr: 'ine',
};

function parseArgs(argv) {
  const opts = { max: 74, forceMain: false, outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--max' && argv[i + 1]) opts.max = Math.max(1, parseInt(argv[++i], 10) || 74);
    else if (argv[i] === '--force-main') opts.forceMain = true;
    else if (argv[i] === '--out' && argv[i + 1]) opts.outPath = path.resolve(argv[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataDir = getDataDir();
  if (!dataDir) {
    console.error('data dir unavailable — set FANCHENG_DATA_DRIVE');
    process.exit(1);
  }

  let map = null;
  const cacheFile = path.join(dataDir, 'main-contract-map.json');
  if (!opts.forceMain && fs.existsSync(cacheFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (raw?.data?.contracts) map = raw.data;
    } catch {
      map = null;
    }
  }
  if (!map?.contracts) {
    map = await mainContract.ensureMainContractMap({ force: opts.forceMain });
  }

  const contracts = map?.contracts || {};
  const rows = [];
  const skipped = [];

  for (const [instKey, row] of Object.entries(contracts)) {
    const meta = getCommodityMeta(instKey);
    const exchangeId = meta?.exchangeId || FALLBACK_EXCHANGE_BY_PRODUCT[instKey];
    const pygoExchange = EXCHANGE_ID_TO_PYGO[exchangeId];
    const symbol = row.infinitraderSymbol || row.contractCode;
    if (!symbol || !pygoExchange) {
      skipped.push({ instrumentId: instKey, reason: 'missing_exchange_or_symbol' });
      continue;
    }
    rows.push({
      instrumentId: instKey,
      exchangeId,
      exchange: pygoExchange,
      infinitraderSymbol: symbol,
      contractCode: row.contractCode || symbol,
      deliveryMonth: row.deliveryMonth || null,
      contractSource: row.contractSource || null,
    });
  }

  rows.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
  const capped = rows.slice(0, opts.max);
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'main-contract-map.json',
    contractCount: capped.length,
    totalResolved: rows.length,
    maxInstruments: opts.max,
    skipped,
    instruments: capped,
  };

  const outPath = opts.outPath || path.join(dataDir, 'main-contracts-pythongo.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const outboxPath = path.join(dataDir, 'outbox', 'main-contracts-pythongo.json');
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true });
  fs.writeFileSync(outboxPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    written: outPath,
    outboxCopy: outboxPath,
    contractCount: capped.length,
    skipped: skipped.length,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
