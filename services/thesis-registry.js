/**
 * 机构/市场命题注册—持久'JSONL，可审计 CRUD
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataDir } = require('./data-paths');
const { normalizeCommodityId } = require('./policy-commodity-map');

const REGISTRY_VERSION = 'v1.56.22-stock-flow-joint';
const REGISTRY_DIR_NAME = 'thesis-registry';
const REGISTRY_FILE = 'theses.jsonl';
const SEED_FILE = path.join(__dirname, '..', 'data', 'thesis-registry-seed.jsonl');

function getRegistryDir() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const dir = path.join(dataDir, REGISTRY_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRegistryPath() {
  const dir = getRegistryDir();
  return dir ? path.join(dir, REGISTRY_FILE) : null;
}

function hashUrl(url) {
  return crypto.createHash('sha256').update(String(url || '')).digest('hex').slice(0, 16);
}

function readAllTheses() {
  const fp = getRegistryPath();
  if (!fp || !fs.existsSync(fp)) {
    ensureSeedData();
    if (!fs.existsSync(fp)) return [];
  }
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

function writeAllTheses(theses) {
  const fp = getRegistryPath();
  if (!fp) return false;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const body = theses.map((t) => JSON.stringify(t)).join('\n') + (theses.length ? '\n' : '');
  fs.writeFileSync(fp, body, 'utf8');
  return true;
}

function ensureSeedData() {
  const fp = getRegistryPath();
  if (!fp) return;
  if (fs.existsSync(fp) && fs.statSync(fp).size > 0) return;
  if (!fs.existsSync(SEED_FILE)) return;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.copyFileSync(SEED_FILE, fp);
}

function normalizeThesis(raw) {
  const sourceUrl = raw.sourceUrl || raw.url || null;
  const id = raw.id || `thesis-${hashUrl(sourceUrl || raw.claim)}`;
  const linkedTags = raw.linkedTags || raw.linkedThemes || [];
  const extractedBy = raw.extractedBy || raw.method || 'manual';
  const status = raw.status || 'active';
  return {
    id,
    who: raw.who || '未知来源',
    when: raw.when || raw.fetchedAt || null,
    claim: raw.claim || '',
    horizon: raw.horizon || null,
    falsify: raw.falsify || null,
    falsifyRules: raw.falsifyRules || null,
    status,
    linkedSymbols: (raw.linkedSymbols || []).map((s) => normalizeCommodityId(s)),
    linkedTags,
    linkedThemes: linkedTags,
    sourceTier: raw.sourceTier || 'D',
    sourceUrl,
    url: sourceUrl,
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
    extractedBy,
    method: extractedBy,
    seed: raw.seed === true,
  };
}

function upsertThesis(thesis) {
  const t = normalizeThesis(thesis);
  const all = readAllTheses();
  const idx = all.findIndex((x) => x.id === t.id || (t.url && x.url === t.url));
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...t, updatedAt: new Date().toISOString() };
  } else {
    all.push({ ...t, createdAt: new Date().toISOString() });
  }
  writeAllTheses(all);
  return t;
}

function deleteThesis(id) {
  const all = readAllTheses().filter((t) => t.id !== id);
  writeAllTheses(all);
  return all.length;
}

function queryActiveTheses(filters = {}) {
  const { theme, symbol, tags, limit = 100 } = filters;
  let list = readAllTheses().filter(
    (t) => t.status === 'active' || t.status === 'partially_realized' || t.status === 'partial'
  );
  const tagFilter = tags || (theme ? [theme] : null);
  if (tagFilter?.length) {
    list = list.filter((t) => {
      const thesisTags = t.linkedTags || t.linkedThemes || [];
      return tagFilter.some(
        (tag) =>
          thesisTags.some((x) => String(x).toLowerCase().includes(String(tag).toLowerCase())) ||
          String(t.claim || '').toLowerCase().includes(String(tag).toLowerCase())
      );
    });
  } else if (theme) {
    const th = String(theme).toLowerCase();
    list = list.filter(
      (t) =>
        t.linkedTags?.some((x) => String(x).toLowerCase().includes(th)) ||
        t.linkedThemes?.some((x) => String(x).toLowerCase().includes(th)) ||
        String(t.claim || '').toLowerCase().includes(th)
    );
  }
  if (symbol) {
    const sid = normalizeCommodityId(symbol);
    list = list.filter((t) => !t.linkedSymbols?.length || t.linkedSymbols.includes(sid));
  }
  return list.slice(0, limit);
}

function getActiveTheses(tagsOrFilters) {
  if (Array.isArray(tagsOrFilters)) return queryActiveTheses({ tags: tagsOrFilters });
  return queryActiveTheses(tagsOrFilters || {});
}

function getNarrativeHeat(tag = 'macro_equity_bubble', hours = 72) {
  const keywords =
    tag === 'macro_equity_bubble'
      ? /bubble|泡沫|hard landing|equity bubble|美股泡沫|AI concentration/i
      : new RegExp(String(tag).replace(/_/g, '|'), 'i');
  const nh = countNarrativeMentions(keywords, hours);
  const count = nh.count ?? 0;
  const bubbleTalk = count >= 6 ? 'hot' : count >= 3 ? 'warming' : 'cold';
  return {
    bubbleTalk,
    mentionCount72h: nh.count,
    asOf: new Date().toISOString(),
    n: nh.n,
    hits: nh.hits,
  };
}

function evaluateThesisAgainstPrices(thesisOrId, priceCtx = {}) {
  const id = typeof thesisOrId === 'string' ? thesisOrId : thesisOrId?.id;
  if (!id) return null;
  const all = readAllTheses();
  const thesis = all.find((t) => t.id === id);
  if (!thesis) return null;
  const priceBySymbol = priceCtx.priceBySymbol || priceCtx;
  const os = checkPriceTargetOvershoot(thesis, priceBySymbol);
  if (os) return setThesisStatus(id, 'overshoot', { overshootMeta: os });
  return thesis;
}

function countNarrativeMentions(keywords, hours = 72) {
  const since = Date.now() - hours * 3600 * 1000;
  const re = keywords instanceof RegExp ? keywords : new RegExp(keywords, 'i');
  const active = readAllTheses().filter(
    (t) => t.status === 'active' || t.status === 'partially_realized' || t.status === 'partial'
  );
  const hits = active.filter((t) => {
    if (!re.test(`${t.claim} ${t.who}`)) return false;
    const when = t.fetchedAt || t.when;
    if (!when) return true;
    return new Date(when).getTime() >= since;
  });
  return { count: hits.length, n: active.length, hits };
}

/**
 * 简'overshoot 检测：claim 中含价位且现价已超越
 */
function checkPriceTargetOvershoot(thesis, priceBySymbol = {}) {
  if (!thesis?.claim || !thesis.linkedSymbols?.length) return null;
  const priceMatch = thesis.claim.match(/(\d{3,5})\s*(美元|USD|\/oz|\/盎司)?/i);
  if (!priceMatch) return null;
  const target = parseFloat(priceMatch[1]);
  if (Number.isNaN(target)) return null;
  for (const sym of thesis.linkedSymbols) {
    const px = priceBySymbol[normalizeCommodityId(sym)];
    if (px == null) continue;
    if (/上方|突破|target|目标/i.test(thesis.claim) && px >= target * 1.02) {
      return { status: 'overshoot', symbol: sym, target, price: px };
    }
    if (/下方|跌破|floor/i.test(thesis.claim) && px <= target * 0.98) {
      return { status: 'overshoot', symbol: sym, target, price: px };
    }
  }
  return null;
}

function setThesisStatus(id, status, meta = {}) {
  const all = readAllTheses();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  all[idx] = {
    ...all[idx],
    status,
    statusUpdatedAt: new Date().toISOString(),
    ...meta,
  };
  writeAllTheses(all);
  return all[idx];
}

/** @param {string|object} thesisOrId @param {string|object} statusOrPriceCtx */
function updateThesisStatus(thesisOrId, statusOrPriceCtx = {}, meta = {}) {
  if (typeof statusOrPriceCtx === 'string') {
    const id = typeof thesisOrId === 'string' ? thesisOrId : thesisOrId?.id;
    return setThesisStatus(id, statusOrPriceCtx, meta);
  }
  return evaluateThesisAgainstPrices(thesisOrId, statusOrPriceCtx);
}

function refreshOvershootStatuses(priceBySymbol = {}) {
  const all = readAllTheses();
  let changed = 0;
  for (const t of all) {
    if (t.status !== 'active' && t.status !== 'partially_realized' && t.status !== 'partial') continue;
    const os = checkPriceTargetOvershoot(t, priceBySymbol);
    if (os) {
      t.status = 'overshoot';
      t.overshootMeta = os;
      t.statusUpdatedAt = new Date().toISOString();
      changed += 1;
    }
  }
  if (changed) writeAllTheses(all);
  return { changed, total: all.length };
}

/**
 * 对立假说日更证伪：摆动价位 + 仓单·资金多周期合证。
 * ctx: { priceBySymbol, warehouseBySymbol?, asOf? }
 * 仓单日增减不能单独证伪；须合证对立结构，否则仅记滞后/证据不足。
 */
function refreshHypothesisFalsifyStatuses(ctx = {}) {
  const priceBySymbol = ctx.priceBySymbol || {};
  const asOf = String(ctx.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  let buildStockFlowJoint = null;
  try {
    buildStockFlowJoint = require('./inventory-capital-joint').buildStockFlowJoint;
  } catch {
    buildStockFlowJoint = null;
  }
  const all = readAllTheses();
  let changed = 0;
  for (const t of all) {
    if (!String(t.id || '').startsWith('hyp-')) continue;
    if (t.status === 'falsified' || t.status === 'archived' || t.status === 'overshoot') continue;
    if (t.status !== 'active' && t.status !== 'partial' && t.status !== 'partially_realized') continue;
    const rules = t.falsifyRules || {};
    const side = rules.side || (String(t.id).includes('short') ? 'short' : 'long');
    const sym = (t.linkedSymbols || []).map((s) => normalizeCommodityId(s))[0];
    if (!sym) continue;
    const px = priceBySymbol[sym];
    const baseline = rules.baselinePrice != null ? Number(rules.baselinePrice) : null;
    if (px == null || baseline == null || !Number.isFinite(baseline) || baseline <= 0) continue;

    const dropPct = Number(rules.priceDropPct) || 3.5;
    const risePct = Number(rules.priceRisePct) || 3.5;
    let priceHit = false;
    let reason = null;
    if (side === 'long' && px <= baseline * (1 - dropPct / 100)) {
      priceHit = true;
      reason = `price<=baseline-${dropPct}% (${px} vs ${baseline})`;
    }
    if (side === 'short' && px >= baseline * (1 + risePct / 100)) {
      priceHit = true;
      reason = `price>=baseline+${risePct}% (${px} vs ${baseline})`;
    }
    if (!priceHit) continue;

    const requireJoint = rules.requireStockFlowJoint !== false;
    let falsified = false;
    let jointMeta = null;
    if (requireJoint && typeof buildStockFlowJoint === 'function') {
      const joint = buildStockFlowJoint(sym, asOf);
      jointMeta = joint?.available
        ? {
            structureBias: joint.structureBias,
            coherence: joint.coherence,
            primaryLabel: joint.primaryLabel,
            priceMayLag: joint.priceMayLag,
          }
        : { available: false, reason: joint?.reason };
      if (!joint?.available) {
        // 合证不足：不证伪，避免日仓单独定罪
        t.status = 'partial';
        t.falsifyMeta = {
          reason: 'price_hit_but_joint_insufficient',
          price: px,
          baseline,
          joint: jointMeta,
          at: new Date().toISOString(),
        };
        t.statusUpdatedAt = new Date().toISOString();
        changed += 1;
        continue;
      }
      if (side === 'long') {
        if (joint.opposesLong) {
          falsified = true;
          reason = `${reason}|joint_opposes_long:${joint.primaryLabel}`;
        } else if (joint.supportsLong || joint.priceMayLag) {
          t.status = 'partial';
          t.falsifyMeta = {
            reason: 'price_hit_but_structure_still_supports_or_lags',
            price: px,
            baseline,
            joint: jointMeta,
            at: new Date().toISOString(),
          };
          t.statusUpdatedAt = new Date().toISOString();
          changed += 1;
          continue;
        } else {
          t.status = 'partial';
          t.falsifyMeta = {
            reason: 'price_hit_joint_mixed',
            price: px,
            baseline,
            joint: jointMeta,
            at: new Date().toISOString(),
          };
          t.statusUpdatedAt = new Date().toISOString();
          changed += 1;
          continue;
        }
      } else {
        if (joint.opposesShort) {
          falsified = true;
          reason = `${reason}|joint_opposes_short:${joint.primaryLabel}`;
        } else if (joint.supportsShort || joint.priceMayLag) {
          t.status = 'partial';
          t.falsifyMeta = {
            reason: 'price_hit_but_structure_still_supports_or_lags',
            price: px,
            baseline,
            joint: jointMeta,
            at: new Date().toISOString(),
          };
          t.statusUpdatedAt = new Date().toISOString();
          changed += 1;
          continue;
        } else {
          t.status = 'partial';
          t.falsifyMeta = {
            reason: 'price_hit_joint_mixed',
            price: px,
            baseline,
            joint: jointMeta,
            at: new Date().toISOString(),
          };
          t.statusUpdatedAt = new Date().toISOString();
          changed += 1;
          continue;
        }
      }
    } else {
      // 旧规则回退：不再用单日仓单 changeDod 翻转换证伪
      falsified = true;
    }

    if (falsified) {
      t.status = 'falsified';
      t.falsifyMeta = { reason, price: px, baseline, joint: jointMeta, at: new Date().toISOString() };
      t.statusUpdatedAt = new Date().toISOString();
      changed += 1;
    }
  }
  if (changed) writeAllTheses(all);
  return { changed, total: all.length };
}

/**
 * 合成刷新：超预期目标 + 对立假说证伪
 */
function refreshThesisStatuses(ctx = {}) {
  const overshoot = refreshOvershootStatuses(ctx.priceBySymbol || {});
  const falsify = refreshHypothesisFalsifyStatuses(ctx);
  return { overshoot, falsify };
}

function dedupeByUrl(candidates) {
  const existing = new Set(
    readAllTheses()
      .map((t) => t.sourceUrl || t.url)
      .filter(Boolean)
  );
  const seen = new Set();
  return candidates.filter((c) => {
    const url = c.sourceUrl || c.url;
    if (!url) return true;
    if (existing.has(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

module.exports = {
  REGISTRY_VERSION,
  getRegistryPath,
  ensureSeedData,
  readAllTheses,
  upsertThesis,
  deleteThesis,
  queryActiveTheses,
  getActiveTheses,
  getNarrativeHeat,
  countNarrativeMentions,
  checkPriceTargetOvershoot,
  updateThesisStatus,
  refreshOvershootStatuses,
  refreshHypothesisFalsifyStatuses,
  refreshThesisStatuses,
  dedupeByUrl,
  hashUrl,
};
