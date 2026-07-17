/**
 * 情报中心 · 证据新鲜度门禁（构想 §36 / 数据实时性）
 * 对照日历滞后与证据 freshness；严重滞后可阻断 Interrupt，禁止用陈旧证据装新。
 */
const EVIDENCE_FRESH_VERSION = 'v2.75.0-evidence-freshness';

const CRITICAL_TYPES = new Set(['warehouse_joint', 'price', 'basis', 'term_structure', 'capital', 'oi']);

function lagFromEvidence(ev) {
  const lag = ev?.freshness?.lagDays;
  if (lag != null && Number.isFinite(Number(lag))) return Number(lag);
  return null;
}

function assessEvidenceFreshness(inst, asOfInput) {
  const asOf = String(asOfInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const claim = inst?.intelCenter?.primaryClaim;
  const list = [
    ...(claim?.evidenceFor || []),
    ...(claim?.evidenceAgainst || []),
  ];

  const staleness = inst?.calendarStaleness;
  const calendarLag = staleness?.lagDays ?? staleness?.daysBehind ?? null;

  const items = [];
  for (const ev of list) {
    if (!ev) continue;
    const lag = lagFromEvidence(ev);
    const type = ev.evidenceType || ev.type || 'unknown';
    const critical = CRITICAL_TYPES.has(type);
    let status = 'ok';
    if (lag == null && ev.freshness?.label === '待校验') status = 'unknown';
    else if (lag == null) status = 'unknown';
    else if (lag > 3) status = 'stale_severe';
    else if (lag > 1) status = 'stale';
    else status = 'fresh';

    items.push({
      evidenceType: type,
      summary: String(ev.summary || '').slice(0, 48),
      lagDays: lag,
      lagDisplay: lag != null ? String(lag) : '暂无',
      freshnessLabel: ev.freshness?.label || '暂无',
      status,
      critical,
      direction: ev.direction || null,
      dataSource: ev.dataSource || '暂无',
    });
  }

  if (calendarLag != null && calendarLag > 1) {
    items.push({
      evidenceType: 'calendar',
      summary: '品种日历/收盘滞后',
      lagDays: calendarLag,
      lagDisplay: String(calendarLag),
      freshnessLabel: calendarLag > 3 ? '严重滞后' : '滞后',
      status: calendarLag > 3 ? 'stale_severe' : 'stale',
      critical: true,
      dataSource: 'calendarStaleness',
    });
  }

  const stale = items.filter((i) => i.status === 'stale' || i.status === 'stale_severe');
  const severe = items.filter((i) => i.status === 'stale_severe');
  const unknown = items.filter((i) => i.status === 'unknown');
  const criticalStale = stale.filter((i) => i.critical);
  const blocksInterrupt = criticalStale.some((i) => i.status === 'stale_severe') || (calendarLag != null && calendarLag > 3);

  return {
    version: EVIDENCE_FRESH_VERSION,
    asOf,
    instrumentId: inst?.id || null,
    itemCount: items.length,
    items: items.slice(0, 16),
    stale,
    severe,
    unknown,
    criticalStale,
    blocksInterrupt,
    calendarLag,
    calendarLagDisplay: calendarLag != null ? String(calendarLag) : '暂无',
    display: blocksInterrupt
      ? `证据新鲜度·阻断 Interrupt · 严重滞后 ${severe.length}`
      : criticalStale.length
        ? `证据新鲜度·关键滞后 ${criticalStale.length} · 未知 ${unknown.length}`
        : items.length
          ? `证据新鲜度·可用 ${items.length - stale.length}/${items.length}`
          : '证据新鲜度·暂无条目',
    note: '缺失 lag 标暂无，不伪造新鲜',
    dataSource: 'intel-evidence-freshness',
    method: 'evidence-freshness+calendar-lag',
  };
}

function buildEvidenceFreshnessBoard(instruments, asOf) {
  const rows = [];
  for (const inst of instruments || []) {
    const report =
      inst?.intelCenter?.evidenceFreshness || assessEvidenceFreshness(inst, asOf);
    if (!report?.itemCount && !report?.calendarLag) continue;
    if (!report.stale?.length && !report.blocksInterrupt && !(report.unknown?.length > 0)) continue;
    rows.push({
      instrumentId: inst.id,
      instrumentName: inst.name,
      display: report.display,
      blocksInterrupt: report.blocksInterrupt,
      staleCount: report.stale?.length || 0,
      severeCount: report.severe?.length || 0,
      calendarLagDisplay: report.calendarLagDisplay,
      criticalTypes: (report.criticalStale || []).map((s) => s.evidenceType).slice(0, 4),
    });
  }

  rows.sort(
    (a, b) =>
      (b.blocksInterrupt ? 1 : 0) - (a.blocksInterrupt ? 1 : 0) ||
      b.severeCount - a.severeCount ||
      b.staleCount - a.staleCount
  );

  return {
    version: EVIDENCE_FRESH_VERSION,
    asOf: asOf || null,
    rows: rows.slice(0, 20),
    blockingCount: rows.filter((r) => r.blocksInterrupt).length,
    staleInstrumentCount: rows.length,
    display: rows.length
      ? `证据新鲜度 滞后品种 ${rows.length} · 阻断 Interrupt ${rows.filter((r) => r.blocksInterrupt).length}`
      : '证据新鲜度 暂无显著滞后',
    note: '严重滞后关键证据时 Interrupt 门禁降档',
    dataSource: 'intel-evidence-freshness',
    method: 'pack-aggregate',
  };
}

function applyFreshnessToInterruptGate(inst, gates) {
  const fresh = inst?.intelCenter?.evidenceFreshness;
  if (!fresh?.blocksInterrupt || !gates) return gates;
  const interrupt = gates.interrupt || {};
  if (interrupt.pass === false) {
    return {
      ...gates,
      interrupt: {
        ...interrupt,
        blockedReasons: [...new Set([...(interrupt.blockedReasons || []), '证据严重滞后'])],
        freshnessBlocked: true,
      },
    };
  }
  return {
    ...gates,
    interrupt: {
      ...interrupt,
      pass: false,
      blockedReasons: [...new Set([...(interrupt.blockedReasons || []), '证据严重滞后'])],
      freshnessBlocked: true,
      passBeforeFreshness: interrupt.pass === true,
    },
  };
}

module.exports = {
  EVIDENCE_FRESH_VERSION,
  assessEvidenceFreshness,
  buildEvidenceFreshnessBoard,
  applyFreshnessToInterruptGate,
};
