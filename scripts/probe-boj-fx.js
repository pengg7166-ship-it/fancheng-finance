async function probe(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FanchengFinance/1.0' } });
  const html = await r.text();
  console.log(url, r.status);
  const href = html.match(/href="(\/en\/statistics\/market\/forex\/jikko\/[^"]+\.xlsx)"/i)?.[1];
  console.log('xlsx', href);
}

(async () => {
  await probe('https://www.boj.or.jp/en/statistics/market/forex/jikko/index.htm');
  const list = await fetch('https://www.boj.or.jp/en/statistics/market/forex/jikko/jikko/index.htm', {
    headers: { 'User-Agent': 'FanchengFinance/1.0' },
  });
  console.log('sub', list.status);
})().catch(console.error);
