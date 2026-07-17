#!/usr/bin/env node
const { buildReleaseCalendar } = require('../services/commodity-release-calendar');

const cal = buildReleaseCalendar({ daysAhead: 21 });
console.log('=== 数据发布日历 ===\n');
console.log(`版本: ${cal.summary.version}`);
console.log(`基准日: ${cal.summary.asOf} | 未来 ${cal.summary.daysAhead} 天 | 共 ${cal.summary.total} 项`);
if (cal.summary.nextRelease) {
  console.log(`下一项: ${cal.summary.nextRelease.name} · ${cal.summary.nextRelease.releaseDate} · ${cal.summary.nextRelease.releaseAtLocal}`);
}
console.log(`临近窗口(24h): ${cal.summary.imminentCount}\n`);
for (const r of cal.releases) {
  const tag = r.imminent ? '⚡' : ' ';
  const est = r.estimated ? ' [预估/窗口]' : '';
  console.log(`${tag} ${r.releaseDate}  ${r.name}${est}`);
  console.log(`    北京时间 ${r.releaseAtLocal || '—'} · ${r.method} · ${r.dataSource}`);
  if (r.note) console.log(`    ${r.note}`);
  if (r.hoursUntil != null && r.hoursUntil >= 0) console.log(`    T+${r.hoursUntil}h`);
  console.log('');
}
