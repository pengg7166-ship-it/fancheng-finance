const fs = require('fs');
const path = require('path');

(async () => {
  const r = await fetch('https://www.boj.or.jp/en/mopo/mpmdeci/index.htm', {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
  });
  const html = await r.text();
  const links = [...html.matchAll(/href="(\/en\/mopo[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }))
    .filter((l) => l.text.length > 5);
  console.log('mpm links', links.slice(0, 20));

  const deci = await fetch('https://www.boj.or.jp/en/mopo/mpmdeci/2025/index.htm', {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
  });
  console.log('2025', deci.status);
  if (deci.status === 200) {
    const h = await deci.text();
    const rows = h.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows.slice(0, 10)) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      );
      if (cells.length >= 2) console.log(cells.join(' | '));
    }
  }
})().catch(console.error);
