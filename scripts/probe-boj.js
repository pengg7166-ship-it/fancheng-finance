async function probe(name, url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await r.text();
  console.log(`\n=== ${name} ${r.status} ${html.length} ===`);
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows.slice(0, 10)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const href = row.match(/href="([^"]+)"/i)?.[1] || '';
    if (cells.length) console.log(cells.join(' | '), href.slice(0, 80));
  }
}

(async () => {
  await probe('press', 'https://www.boj.or.jp/en/announcements/press/index.htm');
  await probe('fx', 'https://www.boj.or.jp/en/statistics/market/forex/fxdaily/fxlist/index.htm');
  await probe('mrate', 'https://www.boj.or.jp/en/statistics/market/others/mrate/index.htm');
  await probe('ms', 'https://www.boj.or.jp/en/statistics/money/ms/index.htm');
  await probe('cpi', 'https://www.boj.or.jp/en/statistics/sj/sj/index.htm');
})().catch((e) => console.error(e));
