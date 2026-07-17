#!/usr/bin/env node
/**
 * 抓取扩展外盘日频 → data/history/*
 * 用法: FANCHENG_DATA_DRIVE=F node scripts/fetch-cross-market-external.js [--force]
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const { fetchAllExternalSeries } = require('../services/cross-market-external-fetcher');

async function main() {
  const force = process.argv.includes('--force');
  const result = await fetchAllExternalSeries({ force });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.fetched === 0) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
