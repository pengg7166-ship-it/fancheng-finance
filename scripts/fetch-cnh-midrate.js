/**

 * 离岸 USDCNH 日频中间价/收盘价 — 自动抓取

 * 目标: {dataDir}/history/cnh-midrate-daily.json + cnh-midrate-daily.csv

 *

 * 用法:

 *   node scripts/fetch-cnh-midrate.js

 *   node scripts/fetch-cnh-midrate.js --import path/to/usdcnh.csv

 */

const fs = require('fs');

const path = require('path');

const { getDataDir } = require('../services/data-paths');

const { saveCnhMidrateFiles, DEFAULT_START } = require('../services/cnh-midrate-fetcher');



const OUT_FILE = 'cnh-midrate-daily.json';



function getHistoryDir() {

  const dataDir = getDataDir() || path.join(process.cwd(), 'data');

  const dir = path.join(dataDir, 'history');

  fs.mkdirSync(dir, { recursive: true });

  return dir;

}



function parseSimpleCsv(text) {

  const lines = text.trim().split(/\r?\n/);

  const rows = [];

  for (const line of lines) {

    const [date, value] = line.split(/[,;\t]/).map((s) => s.trim());

    if (!date || date === 'date' || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;

    const v = parseFloat(value);

    if (!Number.isNaN(v)) rows.push({ date: date.slice(0, 10), value: v });

  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));

}



function writeCsv(filePath, series) {

  const lines = ['date,value', ...series.map((r) => `${r.date},${r.value}`)];

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

}



async function main() {

  const importArg = process.argv.find((a) => a.startsWith('--import='));

  const importPath = importArg ? importArg.slice('--import='.length) : process.argv[3];

  const outPath = path.join(getHistoryDir(), OUT_FILE);



  if (importPath && fs.existsSync(importPath)) {

    const rows = parseSimpleCsv(fs.readFileSync(importPath, 'utf8')).filter((r) => r.date >= DEFAULT_START);

    const updated = new Date().toISOString();

    const payload = {

      seriesId: 'USDCNH_MID',

      label: '离岸人民币中间价(USDCNH)',

      freq: 'daily',

      source: 'user-import',

      updated,

      fetchedAt: updated,

      startDate: DEFAULT_START,

      endDate: rows.length ? rows[rows.length - 1].date : null,

      series: rows,

      rowCount: rows.length,

      note: '用户导入；列格式 date,value',

    };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

    writeCsv(path.join(getHistoryDir(), 'cnh-midrate-daily.csv'), rows);

    console.log(`Wrote ${rows.length} rows → ${outPath}`);

    return;

  }



  console.log('Fetching USDCNH mid/close series...');

  const { payload, jsonPath, csvPath, onshorePayload, spread } = await saveCnhMidrateFiles();



  console.log('\n=== CNH 抓取结果 ===');

  console.log(`数据源: ${payload.source}`);

  console.log(`说明: ${payload.label}`);

  console.log(`行数: ${payload.rowCount}`);

  console.log(`日期: ${payload.series[0]?.date} → ${payload.series[payload.series.length - 1]?.date}`);

  console.log(`JSON: ${jsonPath}`);

  console.log(`CSV:  ${csvPath}`);

  if (payload.manualUrl) console.log(`手动下载: ${payload.manualUrl}`);



  if (payload.sourceAttempts?.length) {

    console.log('\n源探测:');

    for (const a of payload.sourceAttempts) {

      console.log(`  ${a.ok ? '✓' : '✗'} ${a.source}${a.ok ? ` (${a.rows} rows)` : ''}${a.error ? ` — ${a.error}` : ''}`);

    }

  }



  if (onshorePayload) {

    console.log(`\n在岸对比: ${onshorePayload.source} (${onshorePayload.rowCount} rows)`);

    if (spread) {

      console.log(`CNH-CNY 价差(均值): ${spread.avgSpreadCnhMinusCny} (近30日 ${spread.recent30dAvgSpread})`);

    }

  }

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


