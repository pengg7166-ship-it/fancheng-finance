async function dumpLists(url, name) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await r.text();
  console.log(`\n=== ${name} ===`);
  const lists = html.match(/<ul[\s\S]*?<\/ul>/gi) || [];
  for (const ul of lists.slice(0, 5)) {
    const items = [...ul.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    );
    if (items.some((t) => t.length > 20)) {
      console.log('UL:', items.slice(0, 5).join('\n  '));
    }
  }
  const divs = [...html.matchAll(/<div class="[^"]*list[^"]*"[\s\S]*?<\/div>/gi)].slice(0, 3);
  divs.forEach((d) => console.log('DIV', d[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)));
}

(async () => {
  await dumpLists('https://www.boj.or.jp/en/mopo/mpmdeci/index.htm', 'mpmdeci');
  // Try downloading small xlsx for call rate
  const xlsxUrl = 'https://www.boj.or.jp/en/statistics/market/short/mutan/mutan.xlsx';
  const urls = [
    'https://www.boj.or.jp/en/statistics/market/short/mutan/mutan.xlsx',
    'https://www.boj.or.jp/statistics/market/short/mutan/mutan.xlsx',
  ];
  for (const u of urls) {
    const r = await fetch(u, { headers: { 'User-Agent': 'FanchengFinance/1.0' } });
    console.log('\nxlsx', u, r.status, r.headers.get('content-type'));
  }
  // follow latest mutan link
  const page = await fetch('https://www.boj.or.jp/en/statistics/market/short/mutan/index.htm', {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
  });
  const html = await page.text();
  const href = html.match(/href="(\/en\/statistics\/market\/short\/mutan\/[^"]+\.xlsx)"/i)?.[1];
  console.log('latest xlsx href', href);
  if (href) {
    const xr = await fetch('https://www.boj.or.jp' + href, { headers: { 'User-Agent': 'FanchengFinance/1.0' } });
    console.log('download', xr.status, xr.headers.get('content-length'));
    const buf = Buffer.from(await xr.arrayBuffer());
    console.log('bytes', buf.length, buf.slice(0, 4).toString('hex'));
  }
})().catch(console.error);
