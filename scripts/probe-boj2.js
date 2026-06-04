async function probe(name, url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await r.text();
  console.log(`\n=== ${name} ${r.status} ${html.length} ===`);
  if (r.status !== 200) return;
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows.slice(0, 10)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) =>
        m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);
    const href = row.match(/href="([^"]+)"/i)?.[1] || '';
    if (cells.length) console.log(cells.join(' | '), href.slice(0, 90));
  }
  if (!rows.length) {
    const links = [...html.matchAll(/<a[^>]+href="(\/en[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .slice(0, 8)
      .map((m) => `${m[2].replace(/<[^>]+>/g, '').trim()} -> ${m[1]}`);
    links.forEach((l) => console.log(l));
  }
}

(async () => {
  await probe('press', 'https://www.boj.or.jp/en/about/press/index.htm');
  await probe('mpmdeci', 'https://www.boj.or.jp/en/mopo/mpmdeci/index.htm');
  await probe('market', 'https://www.boj.or.jp/en/statistics/market/index.htm');
  await probe('money', 'https://www.boj.or.jp/en/statistics/money/index.htm');
  await probe('boj', 'https://www.boj.or.jp/en/statistics/boj/index.htm');
  await probe('release', 'https://www.boj.or.jp/en/about/release_2026/index.htm');
})().catch(console.error);
