async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, html: await r.text() };
}

function listLinks(html, filter) {
  return [...html.matchAll(/<a[^>]+href="(\/en[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({
      href: m[1],
      text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((l) => l.text && (!filter || filter.test(l.href) || filter.test(l.text)));
}

(async () => {
  const market = await fetchHtml('https://www.boj.or.jp/en/statistics/market/index.htm');
  console.log('market links:');
  listLinks(market.html, /forex|call|tona|rate|yield|bond|ir/i)
    .slice(0, 20)
    .forEach((l) => console.log(l.text, '->', l.href));

  const mpm = await fetchHtml('https://www.boj.or.jp/en/mopo/mpmdeci/index.htm');
  console.log('\nmpmdeci snippets:');
  const text = mpm.html.replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const pat of [/Policy Rate[\s\S]{0,200}/i, /0\.\d+%/g, /Interest Rate[\s\S]{0,150}/i]) {
    const m = text.match(pat);
    if (m) console.log(m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
  }
  console.log('\nmpmdeci table rows:');
  const rows = mpm.html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows.slice(0, 15)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    );
    if (cells.filter(Boolean).length >= 2) console.log(cells.join(' | '));
  }

  const boj = await fetchHtml('https://www.boj.or.jp/en/statistics/boj/index.htm');
  console.log('\nboj stats links:');
  listLinks(boj.html, /balance|asset|sheet|bs/i)
    .slice(0, 15)
    .forEach((l) => console.log(l.text, '->', l.href));
})().catch(console.error);
