async function probe(name, url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await r.text();
  console.log(`\n=== ${name} ${r.status} ${html.length} ===`);
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows.slice(0, 12)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) =>
        m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);
    if (cells.length) console.log(cells.join(' | '));
  }
  if (!rows.length) {
    const dl = [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)].slice(0, 5);
    dl.forEach((m) =>
      console.log(
        m[1].replace(/<[^>]+>/g, '').trim(),
        '=>',
        m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
      )
    );
  }
}

(async () => {
  await probe('mutan', 'https://www.boj.or.jp/en/statistics/market/short/mutan/index.htm');
  await probe('tankirate', 'https://www.boj.or.jp/en/statistics/market/short/tankirate/index.htm');
  await probe('fxdaily', 'https://www.boj.or.jp/en/statistics/market/forex/fxdaily/index.htm');
  await probe('jikko', 'https://www.boj.or.jp/en/statistics/market/forex/jikko/index.htm');
  await probe('cabs', 'https://www.boj.or.jp/en/statistics/boj/other/cabs/index.htm');
  await probe('mpmdeci', 'https://www.boj.or.jp/en/mopo/mpmdeci/index.htm');
})().catch(console.error);
