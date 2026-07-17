/**
 * Pain Memory — user playbook entries matched to current context.
 * Storage: {FANCHENG}/pain-memory/pain.jsonl
 * v1.47.0-retail-discipline
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getExternalRoot } = require('./data-paths');
const { normalizeCommodityId } = require('./policy-commodity-map');

const PAIN_VERSION = 'v1.47.0-retail-discipline';

function storeDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'pain-memory');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storePath() {
  const dir = storeDir();
  return dir ? path.join(dir, 'pain.jsonl') : null;
}

function nowIso() {
  return new Date().toISOString();
}

function readEntries() {
  const fp = storePath();
  if (!fp || !fs.existsSync(fp)) return [];
  return fs
    .readFileSync(fp, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeEntry(record) {
  const fp = storePath();
  if (!fp) return { ok: false, error: 'pain-memory path unavailable' };
  fs.appendFileSync(fp, `${JSON.stringify(record)}\n`, 'utf8');
  return { ok: true, entry: record };
}

function addPainEntry(entry = {}) {
  const symbol = normalizeCommodityId(entry.symbol);
  if (!symbol) return { ok: false, error: 'symbol required' };
  const id = entry.id || `pain-${symbol}-${Date.now().toString(36)}`;
  const record = {
    id,
    symbol,
    date: entry.date || nowIso().slice(0, 10),
    story: entry.story || null,
    lesson: entry.lesson || '',
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : entry.tags ? [String(entry.tags)] : [],
    playbookMatch: entry.playbookMatch || null,
    dataSource: 'pain-memory-playbook',
    version: PAIN_VERSION,
    createdAt: nowIso(),
  };
  if (!record.lesson) return { ok: false, error: 'lesson required' };
  return writeEntry(record);
}

function listPainEntries(limit = 100) {
  return readEntries()
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
    .slice(0, limit);
}

function deletePainEntry(id) {
  const fp = storePath();
  if (!fp || !id) return { ok: false, error: 'id required' };
  const entries = readEntries().filter((e) => e.id !== id);
  fs.writeFileSync(fp, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf8');
  return { ok: true, deleted: id };
}

function contextTags(inst) {
  const spec = inst?.integratedSpec || {};
  const tags = [];
  const div = spec.divergence?.level;
  if (div) tags.push(div);
  if (spec.expectationGap?.gap === 'overshoot') tags.push('overshoot');
  if (spec.watchLevel) tags.push(spec.watchLevel);
  if (spec.playbook?.id) tags.push(spec.playbook.id);
  if (spec.regime?.regime) tags.push(`R${spec.regime.regime}`);
  if (spec.retailTrap?.highTrap) tags.push('trap');
  return tags;
}

/**
 * Match pain entries to instrument context.
 */
function matchPainEntries(inst, entries = null) {
  const sym = normalizeCommodityId(inst?.id);
  const all = entries || listPainEntries(200);
  const ctxTags = contextTags(inst);
  const matches = [];

  for (const e of all) {
    let score = 0;
    if (normalizeCommodityId(e.symbol) === sym) score += 3;
    const entryTags = (e.tags || []).map(String);
    for (const t of entryTags) {
      if (ctxTags.some((c) => c.toLowerCase() === t.toLowerCase() || c.includes(t))) score += 2;
    }
    if (e.playbookMatch && inst?.integratedSpec?.playbook?.id === e.playbookMatch) score += 2;
    if (score >= 2) {
      matches.push({ ...e, matchScore: score, fusionLine: `与您的 ${e.id} 相似：${e.lesson}` });
    }
  }

  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches.slice(0, 3);
}

function buildPainFusionLine(matches) {
  if (!matches?.length) return null;
  return matches[0].fusionLine;
}

module.exports = {
  PAIN_VERSION,
  addPainEntry,
  listPainEntries,
  deletePainEntry,
  matchPainEntries,
  buildPainFusionLine,
  contextTags,
  storePath,
};
