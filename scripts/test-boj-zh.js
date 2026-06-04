const { translateBojTitle, translateBojSpeaker } = require('../services/boj-news-translator');

const titles = [
  'Opening Remarks at the 2026 BOJ-IMES Conference Hosted by the Institute for Monetary and Economic Studies, Bank of Japan',
  '"Economic Activity, Prices, and Monetary Policy in Japan" (Speech at a Meeting with Local Leaders in Fukuoka)',
  '"Singleness of Money and the Role of Central Banks" (Speech at the Japan Society of Monetary Economics)',
  "Remarks by Executive Director KAMIYAMA at the AIMA Japan Annual Forum 2026 on May 14 (Promoting the Evolution and Stability of Japan's Financial System)",
  '(IMES Newsletter) 2026 BOK/ERI - BOJ/IMES Joint Research Workshop',
  'Statement on Monetary Policy [PDF 92KB]',
];

for (const t of titles) {
  console.log('EN:', t);
  console.log('ZH:', translateBojTitle(t));
  console.log('---');
}

console.log('Speaker:', translateBojSpeaker('UEDA Kazuo, Governor'));
console.log('Speaker:', translateBojSpeaker('KOEDA Junko, Member of the Policy Board'));
