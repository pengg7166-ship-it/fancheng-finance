async function probe(name, url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FanchengFinance/1.0' } });
  const html = await r.text();
  console.log(`\n=== ${name} ${r.status} ===`);
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows.slice(0, 12)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const href = row.match(/href="([^"]+)"/i)?.[1] || '';
    if (cells.length >= 2) console.log(cells.join(' | '), href.slice(0, 80));
  }
}

(async () => {
  await probe('state', 'https://www.boj.or.jp/en/mopo/mpmdeci/state_2026/index.htm');
  await probe('mpr', 'https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026/index.htm');
})().catch(console.error);
