/**
 * 大宗研判变更存档 — JSONL 日文件 + 品种 latest 快照（异步写入，不阻塞渲染）
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const MATERIAL_SCORE_DELTA = 0.05;
const MATERIAL_MID_DELTA_PCT = 0.15;
const BATCH_MIN_MS = 60 * 1000;

const lastWriteByInstrument = new Map();
const pendingAppendQueue = [];
let flushTimer = null;

function getOutlookHistoryRoot() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const root = path.join(dataDir, 'outlook-history');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'outlook-snapshots'), { recursive: true });
  return root;
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function snapshotPath(instrumentId) {
  const root = getOutlookHistoryRoot();
  if (!root) return null;
  const safe = String(instrumentId || 'unknown').replace(/[^\w.-]/gi, '_');
  const dir = path.join(root, 'outlook-snapshots', safe);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'latest.json');
}

function readLatestSnapshot(instrumentId) {
  const fp = snapshotPath(instrumentId);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function directionKey(inst) {
  return inst.directionTier || inst.direction || inst.directionLabel || 'neutral';
}

function extractMid(inst) {
  const base = inst.scenarios?.base || inst.nextDayRangePct;
  return base?.mid ?? null;
}

function isMaterialChange(prev, next) {
  if (!prev) return true;
  const scoreDelta = Math.abs((next.compositeScore ?? 0) - (prev.compositeScore ?? 0));
  if (scoreDelta >= MATERIAL_SCORE_DELTA) return true;
  if (directionKey(prev) !== directionKey(next)) return true;
  const prevMid = prev.baseRange?.mid ?? prev.mid;
  const nextMid = next.baseRange?.mid ?? extractMid(next);
  if (prevMid != null && nextMid != null && Math.abs(nextMid - prevMid) >= MATERIAL_MID_DELTA_PCT) {
    return true;
  }
  if ((prev.regime || '') !== (next.regime || '')) return true;
  if ((prev.latencyState || '') !== (next.latencyState || '')) return true;
  return false;
}

function buildReasonTags(prev, next, inst) {
  const tags = [];
  const prevHits = prev?.newsHits?.length ?? 0;
  const nextHits = (inst.factors?.news?.hits || inst.newsHits || []).length;
  if (nextHits > prevHits) tags.push(`资讯+${nextHits - prevHits}条`);
  else if (nextHits !== prevHits) tags.push(`资讯${nextHits}条`);

  const oi = inst.factors?.oi?.deltaPct ?? inst.oiDeltaPct;
  const prevOi = prev?.oiDeltaPct;
  if (oi != null && (prevOi == null || Math.abs(oi - prevOi) >= 1)) {
    tags.push(`持仓${oi > 0 ? '+' : ''}${oi.toFixed(1)}%`);
  }

  const shock = inst.volForecast?.shockVol ?? inst.shockVol;
  const prevShock = prev?.shockVol;
  if (shock != null && prevShock != null && shock > prevShock * 1.25 && shock > 0.2) {
    tags.push('波动突变');
  } else if (shock != null && shock > 0.35) {
    tags.push('波动突变');
  }

  if ((prev?.regime || '') !== (inst.regime || '')) {
    tags.push(`环境→${inst.regimeLabel || inst.regime}`);
  }

  const latency = inst.latencyState || next.latencyState;
  const prevLatency = prev?.latencyState;
  if (latency && prevLatency && latency !== prevLatency) {
    tags.push(`反射→${inst.latencyLabel || latency}`);
  }

  const price = inst.price;
  const prevPrice = prev?.price;
  if (price != null && prevPrice != null && prevPrice > 0) {
    const chg = ((price - prevPrice) / prevPrice) * 100;
    if (Math.abs(chg) >= 0.25) tags.push(`现价${chg > 0 ? '+' : ''}${chg.toFixed(2)}%`);
  }

  return tags.length ? tags : ['综合因子更新'];
}

function buildSnapshotRecord(inst, prev, dataVersion) {
  const base = inst.scenarios?.base || inst.nextDayRangePct || {};
  const newsHits = (inst.factors?.news?.hits || []).slice(0, 8).map((h) => ({
    id: h.id || h.title,
    title: (h.title || '').slice(0, 120),
    stars: h.stars,
    direction: h.direction,
  }));

  const record = {
    ts: inst.judgementUpdatedAt || new Date().toISOString(),
    instrumentId: inst.id,
    price: inst.price,
    compositeScore: inst.compositeScore,
    directionLabel: inst.directionLabel,
    directionTier: inst.directionTier || inst.direction,
    baseRange: { low: base.low, mid: base.mid, high: base.high },
    scenarios: inst.scenarios,
    factorBreakdown: inst.factorBreakdown,
    wInstant: inst.wInstant,
    wDelayed: inst.wDelayed,
    instantScore: inst.instantScore,
    delayedScore: inst.delayedScore,
    latencyState: inst.latencyState,
    latencyLabel: inst.latencyLabel,
    volForecast: inst.volForecast || {
      baseline: inst.smoothedVol?.volForecastPct,
      shockVol: inst.shockVol,
      composite: inst.compositeVolPct,
    },
    shockVol: inst.shockVol ?? inst.volForecast?.shockVol,
    newsHits,
    regime: inst.regime,
    regimeLabel: inst.regimeLabel,
    dataVersion: dataVersion || inst.dataVersion || null,
  };

  if (prev) {
    record.deltaScore = +((record.compositeScore ?? 0) - (prev.compositeScore ?? 0)).toFixed(3);
    const prevMid = prev.baseRange?.mid ?? prev.mid;
    const nextMid = record.baseRange?.mid;
    if (prevMid != null && nextMid != null) {
      record.deltaMid = +(nextMid - prevMid).toFixed(3);
    }
    record.reasonTags = buildReasonTags(prev, record, inst);
  }

  return record;
}

function queueAppend(record) {
  pendingAppendQueue.push(record);
  if (!flushTimer) {
    flushTimer = setTimeout(flushPendingWrites, 0);
  }
}

function flushPendingWrites() {
  flushTimer = null;
  const root = getOutlookHistoryRoot();
  if (!root || !pendingAppendQueue.length) return;

  const batch = pendingAppendQueue.splice(0, pendingAppendQueue.length);
  const byDay = new Map();
  for (const rec of batch) {
    const day = todayKey(new Date(rec.ts));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(rec);
  }

  for (const [day, records] of byDay) {
    const jsonl = path.join(root, `${day}.jsonl`);
    const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFile(jsonl, lines, { encoding: 'utf8' }, () => {});
  }

  for (const rec of batch) {
    const fp = snapshotPath(rec.instrumentId);
    if (!fp) continue;
    fs.writeFile(fp, JSON.stringify(rec, null, 0), { encoding: 'utf8' }, () => {});
  }
}

/**
 * 批量记录研判变更（主进程调用，异步落盘）
 */
function recordOutlookSnapshots(instruments, { dataVersion } = {}) {
  const root = getOutlookHistoryRoot();
  if (!root || !Array.isArray(instruments)) return { recorded: 0, root };

  let recorded = 0;
  const now = Date.now();

  for (const inst of instruments) {
    if (!inst?.id || inst.outlookPending) continue;

    const prev = readLatestSnapshot(inst.id);
    const record = buildSnapshotRecord(inst, prev, dataVersion);
    const material = isMaterialChange(prev, record);

    const lastMs = lastWriteByInstrument.get(inst.id) || 0;
    if (!material && now - lastMs < BATCH_MIN_MS) continue;

    if (material || now - lastMs >= BATCH_MIN_MS) {
      if (prev) {
        const prevMid = prev.baseRange?.mid ?? prev.mid;
        const newMid = record.baseRange?.mid;
        if (prevMid != null && newMid != null) {
          record.deltaMid = +(newMid - prevMid).toFixed(3);
        }
        record.deltaScore = +((record.compositeScore ?? 0) - (prev.compositeScore ?? 0)).toFixed(3);
        record.reasonTags = buildReasonTags(prev, record, inst);
      }
      queueAppend(record);
      lastWriteByInstrument.set(inst.id, now);
      recorded += 1;
    }
  }

  return { recorded, root };
}

function countTodayArchiveEntries() {
  const root = getOutlookHistoryRoot();
  if (!root) return 0;
  const fp = path.join(root, `${todayKey()}.jsonl`);
  if (!fs.existsSync(fp)) return 0;
  try {
    return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function readJsonlForDays(instrumentId, days) {
  const root = getOutlookHistoryRoot();
  if (!root) return [];

  const out = [];
  const maxDays = Math.max(1, Math.min(days || 7, 90));
  const cursor = new Date();

  for (let i = 0; i < maxDays; i += 1) {
    const day = todayKey(cursor);
    const fp = path.join(root, `${day}.jsonl`);
    if (fs.existsSync(fp)) {
      try {
        const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const row = JSON.parse(line);
            if (!instrumentId || row.instrumentId === instrumentId) out.push(row);
          } catch {
            // skip bad line
          }
        }
      } catch {
        // skip file
      }
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  out.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return out;
}

function getOutlookHistory(instrumentId, days = 7) {
  const root = getOutlookHistoryRoot();
  const rows = readJsonlForDays(instrumentId, days);
  const latest = instrumentId ? readLatestSnapshot(instrumentId) : null;
  return {
    root,
    instrumentId: instrumentId || null,
    days,
    latest,
    todayCount: countTodayArchiveEntries(),
    changes: rows.slice(0, 500),
  };
}

function exportOutlookHistory(instrumentId, days = 30) {
  const data = getOutlookHistory(instrumentId, days);
  const root = getOutlookHistoryRoot();
  if (!root) return { error: '数据目录不可用', path: null };

  const safe = String(instrumentId || 'all').replace(/[^\w.-]/gi, '_');
  const exportDir = path.join(root, 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  const outPath = path.join(exportDir, `${safe}-${todayKey()}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2),
    'utf8'
  );
  return { path: outPath, count: data.changes.length, ...data };
}

function attachChangeDelta(inst) {
  const prev = readLatestSnapshot(inst.id);
  if (!prev) {
    inst.changeDelta = null;
    return inst;
  }
  const mid = extractMid(inst);
  const prevMid = prev.baseRange?.mid ?? prev.mid;
  inst.changeDelta = {
    deltaScore: +((inst.compositeScore ?? 0) - (prev.compositeScore ?? 0)).toFixed(3),
    deltaMid: mid != null && prevMid != null ? +(mid - prevMid).toFixed(3) : null,
    prevDirection: prev.directionLabel || prev.directionTier,
    prevRegime: prev.regime,
    prevLatencyState: prev.latencyState,
    regimeChanged: (prev.regime || '') !== (inst.regime || ''),
    latencyChanged: (prev.latencyState || '') !== (inst.latencyState || ''),
    reasonTags: [],
  };
  inst.changeDelta.reasonTags = buildReasonTags(prev, inst.changeDelta, inst);
  return inst;
}

module.exports = {
  getOutlookHistoryRoot,
  readLatestSnapshot,
  isMaterialChange,
  recordOutlookSnapshots,
  countTodayArchiveEntries,
  getOutlookHistory,
  exportOutlookHistory,
  attachChangeDelta,
};
