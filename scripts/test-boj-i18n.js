global.window = { BojI18n: null };
require('../src/boj-i18n.js');

const samples = [
  'Opening Remarks at the 2026 BOJ-IMES Conference Hosted by the Institute for Monetary and Economic Studies, Bank of Japan',
  "'Economic Activity, Prices, and Monetary Policy in Japan' (Speech at a Meeting with Local Leaders in Fukuoka)",
  "Remarks by Executive Director KAMIYAMA at the AIMA Japan Annual Forum 2026 on May 14 (Promoting the Evolution and Stability of Japan's Financial System)",
  '(IMES Newsletter) 2026 BOK/ERI - BOJ/IMES Joint Research Workshop',
  'UEDA Kazuo, Governor',
  'KOEDA Junko, Member of the Policy Board',
  'HIMINO Ryozo, Deputy Governor',
];

for (const t of samples) {
  console.log('IN:', t.slice(0, 70));
  console.log('ZH:', window.BojI18n.translateTitle(t) || window.BojI18n.translateSpeaker(t));
  console.log('---');
}
