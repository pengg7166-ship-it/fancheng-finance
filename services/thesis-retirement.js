/**
 * Thesis auto-retirement — falsified / overshoot+30d stale -> archived
 */
const thesisRegistry = require('./thesis-registry');

const RETIREMENT_VERSION = 'v1.44.0-discipline';
const STALE_DAYS = 30;

function nowIso() {
  return new Date().toISOString();
}

function daysSince(iso) {
  if (!iso) return Infinity;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return Infinity;
  return (Date.now() - ts) / (24 * 3600 * 1000);
}

function shouldArchiveThesis(thesis) {
  if (!thesis) return { archive: false };
  if (thesis.status === 'falsified') return { archive: true, reason: 'falsified' };
  if (thesis.status === 'overshoot') {
    const last = thesis.statusUpdatedAt || thesis.updatedAt || thesis.fetchedAt;
    if (daysSince(last) >= STALE_DAYS) return { archive: true, reason: 'overshoot-stale-30d' };
  }
  return { archive: false };
}

function runThesisRetirement(options = {}) {
  thesisRegistry.ensureSeedData?.();
  const all = thesisRegistry.readAllTheses();
  const archived = [];
  let changed = 0;
  for (const t of all) {
    if (t.status === 'archived') continue;
    const activeStatuses = ['active', 'partially_realized', 'partial', 'overshoot', 'falsified'];
    if (!activeStatuses.includes(t.status)) continue;
    const { archive, reason } = shouldArchiveThesis(t);
    if (!archive) continue;
    t.status = 'archived';
    t.archivedAt = nowIso();
    t.archiveReason = reason;
    t.retiredBy = 'thesis-retirement';
    archived.push({ id: t.id, reason });
    changed += 1;
  }
  if (changed && !options.dryRun) {
    const fp = thesisRegistry.getRegistryPath?.();
    if (fp) {
      const body = all.map((x) => JSON.stringify(x)).join('\n') + (all.length ? '\n' : '');
      require('fs').writeFileSync(fp, body, 'utf8');
    }
  }
  return {
    changed,
    archived,
    staleDays: STALE_DAYS,
    version: RETIREMENT_VERSION,
    dataSource: 'thesis-retirement',
    method: 'falsified-or-overshoot-stale',
    asOf: nowIso(),
  };
}

function filterActiveThesesForDisplay(theses = []) {
  return theses.filter((t) => t.status !== 'archived');
}

module.exports = {
  RETIREMENT_VERSION,
  STALE_DAYS,
  runThesisRetirement,
  shouldArchiveThesis,
  filterActiveThesesForDisplay,
};
