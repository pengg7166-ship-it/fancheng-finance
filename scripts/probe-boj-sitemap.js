async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, html: await r.text() };
}

function extractLinks(html, prefix = '/en') {
  const links = [...html.matchAll(new RegExp(`href="(${prefix}[^"#]+)"`, 'gi'))].map((m) => m[1]);
  return [...new Set(links)];
}

(async () => {
  const { status, html } = await fetchHtml('https://www.boj.or.jp/en/sitemap.htm');
  console.log('sitemap', status, html.length);
  const links = extractLinks(html);
  const keys = ['press', 'stat', 'rate', 'forex', 'tona', 'call', 'cpi', 'money', 'release', 'mpm', 'policy', 'announce'];
  for (const k of keys) {
    const found = links.filter((l) => l.toLowerCase().includes(k)).slice(0, 8);
    if (found.length) {
      console.log('\n' + k);
      found.forEach((l) => console.log(' ', l));
    }
  }

  const home = await fetchHtml('https://www.boj.or.jp/en/');
  console.log('\nhome', home.status, home.html.length);
  const homeLinks = extractLinks(home.html).filter((l) =>
    /press|stat|rate|forex|release|mpm|policy|announce/i.test(l)
  );
  homeLinks.slice(0, 25).forEach((l) => console.log(' ', l));
})().catch(console.error);
