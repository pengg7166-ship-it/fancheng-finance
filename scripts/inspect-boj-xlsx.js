const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function downloadXlsx() {
  const page = await fetch('https://www.boj.or.jp/en/statistics/market/short/mutan/index.htm', {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
  });
  const html = await page.text();
  const href = html.match(/href="(\/en\/statistics\/market\/short\/mutan\/[^"]+\.xlsx)"/i)?.[1];
  const xr = await fetch('https://www.boj.or.jp' + href, { headers: { 'User-Agent': 'FanchengFinance/1.0' } });
  const buf = Buffer.from(await xr.arrayBuffer());
  const out = path.join(__dirname, 'boj-sample.xlsx');
  fs.writeFileSync(out, buf);
  console.log('saved', out, buf.length);
  try {
    const dir = path.join(__dirname, 'boj-xlsx');
    fs.mkdirSync(dir, { recursive: true });
    execSync(`tar -xf "${out}" -C "${dir}"`, { stdio: 'inherit' });
    const shared = fs.readFileSync(path.join(dir, 'xl', 'sharedStrings.xml'), 'utf8');
    const sheet = fs.readFileSync(path.join(dir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
    console.log('\nsharedStrings sample:\n', shared.slice(0, 1500));
    console.log('\nsheet sample:\n', sheet.slice(0, 2000));
  } catch (e) {
    console.log('extract failed', e.message);
  }
}

downloadXlsx().catch(console.error);
