/**
 * 大宗研判变更存档 — JSONL 日文件 + 品种 latest 快照 + 预测校验
 */
const fs = require('fs');
const path = require('path');
const diskCache = require('./disk-cache');
const { getDataDir } = require('./data-paths');

const MATERIAL_SCORE_DELTA = 0.05;
const MATERIAL_MID_DELTA_PCT = 0.15;
const BATCH_MIN_MS = 60 * 1000;
const RESOLVE_MIN_MS = 4 * 60 * 60 * 1000;

const lastWriteByInstrument = new Map();
const pendingAppendQueue = [];
const pendingAccuracyQueue = [];
let flushTimer = null;

function getOutlookHistoryRoot() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const root = path.join(dataDir, 'outlook-history');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'outlook-snapshots'), { recursive: true });
  fs.mkdirSync(path.join(root, 'daily'), { recursive: true });
  fs.mkdirSync(path.join(root, 'daily-compare'), { recursive: true });
  return root;
}

function dayKeyOffset(days = 0, base = new Date()) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return todayKey(d);
}

function getDailyDir(day = todayKey()) {
  const root = getOutlookHistoryRoot();
  return root ? path.join(root, 'daily', day) : null;
}

function getDailySummaryPath(day = todayKey()) {
  const dir = getDailyDir(day);
  return dir ? path.join(dir, 'summary.json') : null;
}

function readDailySummary(day) {
  const fp = getDailySummaryPath(day);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function buildDailyInstrumentEntry(inst) {
  const base = inst.scenarios?.base || inst.nextDayRangePct || {};
  return {
    id: inst.id,
    name: inst.name,
    predictedLow: base.low ?? null,
    predictedMid: base.mid ?? null,
    predictedHigh: base.high ?? null,
    direction: inst.directionTier || inst.direction || null,
    directionLabel: inst.directionLabel || null,
    compositeScore: inst.compositeScore ?? null,
    priceAtPredict: inst.price ?? null,
    ts: inst.judgementUpdatedAt || new Date().toISOString(),
  };
}

function writeDailySnapshot(instruments, day = todayKey()) {
  const root = getOutlookHistoryRoot();
  if (!root || !Array.isArray(instruments) || !instruments.length) {
    return { wrote: false, path: null, day };
  }

  const dir = getDailyDir(day);
  const fp = path.join(dir, 'summary.json');
  if (fs.existsSync(fp)) return { wrote: false, path: fp, day, count: instruments.length };

  const rows = instruments.filter((i) => i?.id && !i.outlookPending).map(buildDailyInstrumentEntry);
  const payload = {
    date: day,
    savedAt: new Date().toISOString(),
    instrumentCount: rows.length,
    instruments: rows,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return { wrote: true, path: fp, day, count: rows.length };
}

function computeDayReturnPct(bars, day) {
  if (!bars?.length) return null;
  const sorted = [...bars].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const idx = sorted.findIndex((b) => String(b.date) === day);
  if (idx <= 0) return null;
  const prev = sorted[idx - 1];
  const cur = sorted[idx];
  if (!prev?.close || !cur?.close) return null;
  return +(((cur.close - prev.close) / prev.close) * 100).toFixed(3);
}

function computeHitFromMid(predictedMid, actualPct, predictedLow, predictedHigh) {
  return computeHitDirection(predictedMid, actualPct, predictedLow, predictedHigh);
}

function resolveYesterdayPredictions(referenceDay = todayKey()) {
  const root = getOutlookHistoryRoot();
  if (!root) return { resolved: 0, path: null };

  const yday = dayKeyOffset(-1, new Date(`${referenceDay}T12:00:00`));
  const summary = readDailySummary(yday);
  if (!summary?.instruments?.length) {
    return { resolved: 0, path: null, yday, reason: 'no_yesterday_summary' };
  }

  const rows = [];
  let hits = 0;
  let total = 0;

  for (const row of summary.instruments) {
    const bars = readKlineBarsFromCache(row.id);
    const actualPct = computeDayReturnPct(bars, yday);
    if (actualPct == null) {
      rows.push({ ...row, actualPct: null, gapPct: null, hitDirection: null });
      continue;
    }
    const predictedMid = Number(row.predictedMid);
    const gapPct = +(actualPct - predictedMid).toFixed(3);
    const hitDirection = computeHitFromMid(
      predictedMid,
      actualPct,
      row.predictedLow,
      row.predictedHigh
    );
    total += 1;
    if (hitDirection) hits += 1;
    rows.push({
      id: row.id,
      name: row.name,
      predictedMid: row.predictedMid,
      actualPct,
      gapPct,
      hitDirection,
    });
  }

  const compareDir = path.join(root, 'daily-compare');
  fs.mkdirSync(compareDir, { recursive: true });
  const outPath = path.join(compareDir, `${referenceDay}.json`);
  const payload = {
    date: referenceDay,
    yday,
    resolvedAt: new Date().toISOString(),
    hitRate: total > 0 ? +(hits / total).toFixed(3) : null,
    hits,
    total,
    rows,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  return { resolved: total, path: outPath, yday, hits, total, hitRate: payload.hitRate };
}

function getDailyCompare(dateA, dateB) {
  const a = readDailySummary(dateA);
  const b = readDailySummary(dateB);
  const ydayResolved = resolveYesterdayPredictions(dateB);
  const compareFile = path.join(getOutlookHistoryRoot() || '', 'daily-compare', `${dateB}.json`);
  let actualById = new Map();
  if (fs.existsSync(compareFile)) {
    try {
      const cmp = JSON.parse(fs.readFileSync(compareFile, 'utf8'));
      for (const r of cmp.rows || []) {
        if (r.id) actualById.set(r.id, r);
      }
    } catch {
      // ignore
    }
  }

  const mapA = new Map((a?.instruments || []).map((i) => [i.id, i]));
  const mapB = new Map((b?.instruments || []).map((i) => [i.id, i]));
  const ids = [...new Set([...mapA.keys(), ...mapB.keys()])].sort((x, y) =>
    String(mapA.get(x)?.name || x).localeCompare(String(mapA.get(y)?.name || y), 'zh-CN')
  );

  const rows = ids.map((id) => {
    const prev = mapA.get(id);
    const cur = mapB.get(id);
    const actual = actualById.get(id);
    const yMid = prev?.predictedMid ?? null;
    const yActual = actual?.actualPct ?? null;
    const yGap = actual?.gapPct ?? (yActual != null && yMid != null ? +(yActual - yMid).toFixed(3) : null);
    const tMid = cur?.predictedMid ?? null;
    const hit = actual?.hitDirection;
    return {
      id,
      name: cur?.name || prev?.name || id,
      yesterdayPredictedMid: yMid,
      yesterdayActualPct: yActual,
      yesterdayGapPct: yGap,
      todayPredictedMid: tMid,
      directionHit: hit,
    };
  });

  return {
    dateA,
    dateB,
    rows,
    aggregateHitRate: ydayResolved.hitRate ?? null,
    comparePath: ydayResolved.path,
    summaryPathA: getDailySummaryPath(dateA),
    summaryPathB: getDailySummaryPath(dateB),
  };
}

function bootstrapDailyOutlook(instruments) {
  const root = getOutlookHistoryRoot();
  if (!root) return { ok: false };

  const today = todayKey();
  const yday = dayKeyOffset(-1);
  let snapshot = { wrote: false, path: getDailySummaryPath(today) };

  if (instruments?.length) {
    snapshot = writeDailySnapshot(instruments, today);
  } else {
    const cached = readDailySummary(today);
    if (!cached) {
      const { getCachedCommodityOutlookSource } = require('./commodity-outlook-engine');
      const src = getCachedCommodityOutlookSource();
      if (src?.instruments?.length) snapshot = writeDailySnapshot(src.instruments, today);
    }
  }

  const resolved = resolveYesterdayPredictions(today);
  return {
    ok: true,
    root,
    dailyDir: getDailyDir(today),
    summaryPath: snapshot.path || getDailySummaryPath(today),
    snapshotWrote: snapshot.wrote,
    resolved,
  };
}

function getYesterdayArchiveCompare(instrumentId) {
  const today = todayKey();
  const yday = dayKeyOffset(-1);
  const summary = readDailySummary(yday);
  const row = summary?.instruments?.find((i) => i.id === instrumentId);
  if (!row) return null;

  const comparePath = path.join(getOutlookHistoryRoot() || '', 'daily-compare', `${today}.json`);
  let actualPct = null;
  let gapPct = null;
  let hitDirection = null;
  if (fs.existsSync(comparePath)) {
    try {
      const cmp = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
      const hit = (cmp.rows || []).find((r) => r.id === instrumentId);
      if (hit) {
        actualPct = hit.actualPct;
        gapPct = hit.gapPct;
        hitDirection = hit.hitDirection;
      }
    } catch {
      // ignore
    }
  }
  if (actualPct == null) {
    const bars = readKlineBarsFromCache(instrumentId);
    actualPct = computeDayReturnPct(bars, yday);
    if (actualPct != null && row.predictedMid != null) {
      gapPct = +(actualPct - row.predictedMid).toFixed(3);
      hitDirection = computeHitFromMid(row.predictedMid, actualPct, row.predictedLow, row.predictedHigh);
    }
  }

  return {
    date: yday,
    predictedMid: row.predictedMid,
    actualPct,
    gapPct,
    hitDirection,
  };
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function snapshotDir(instrumentId) {
  const root = getOutlookHistoryRoot();
  if (!root) return null;
  const safe = String(instrumentId || 'unknown').replace(/[^\w.-]/gi, '_');
  const dir = path.join(root, 'outlook-snapshots', safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshotPath(instrumentId) {
  const dir = snapshotDir(instrumentId);
  return dir ? path.join(dir, 'latest.json') : null;
}

function accuracyPath(instrumentId) {
  const dir = snapshotDir(instrumentId);
  return dir ? path.join(dir, 'accuracy.jsonl') : null;
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

function readAccuracyRecords(instrumentId, limit = 50) {
  const fp = accuracyPath(instrumentId);
  if (!fp || !fs.existsSync(fp)) return [];
  try {
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    const rows = [];
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        // skip
      }
    }
    rows.sort((a, b) => String(b.predictTs).localeCompare(String(a.predictTs)));
    return limit ? rows.slice(0, limit) : rows;
  } catch {
    return [];
  }
}

function hasResolvedPredictTs(instrumentId, predictTs) {
  return readAccuracyRecords(instrumentId, 200).some((r) => r.predictTs === predictTs);
}

function directionKey(inst) {
  return inst.directionTier || inst.direction || inst.directionLabel || 'neutral';
}

function extractMid(inst) {
  const base = inst.scenarios?.base || inst.nextDayRangePct;
  return base?.mid ?? null;
}

function extractPredictionFields(inst) {
  const base = inst.scenarios?.base || inst.nextDayRangePct || {};
  return {
    predictedMid: base.mid ?? null,
    predictedLow: base.low ?? null,
    predictedHigh: base.high ?? null,
    priceAtPredict: inst.price ?? null,
  };
}

function isMaterialChange(prev, next) {
  if (!prev) return true;
  const scoreDelta = Math.abs((next.compositeScore ?? 0) - (prev.compositeScore ?? 0));
  if (scoreDelta >= MATERIAL_SCORE_DELTA) return true;
  if (directionKey(prev) !== directionKey(next)) return true;
  const prevMid = prev.baseRange?.mid ?? prev.mid ?? prev.predictedMid;
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

function readKlineBarsFromCache(instrumentId) {
  const key = `klines/commodity-${String(instrumentId || '').toLowerCase()}-day.json`;
  const cached = diskCache.readStale(key);
  return cached?.data?.klines || [];
}

function findNextDailyBar(bars, predictDay) {
  if (!bars?.length) return null;
  const sorted = [...bars].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const bar of sorted) {
    if (String(bar.date) > predictDay && bar.close > 0) return bar;
  }
  return null;
}

function computeHitDirection(predictedMid, actualPct, predictedLow, predictedHigh) {
  const pm = Number(predictedMid);
  const ap = Number(actualPct);
  if (Number.isNaN(pm) || Number.isNaN(ap)) return false;
  if (Math.abs(pm) >= 0.06) {
    return (pm > 0 && ap > 0) || (pm < 0 && ap < 0);
  }
  const low = Number(predictedLow);
  const high = Number(predictedHigh);
  if (!Number.isNaN(low) && !Number.isNaN(high)) {
    return ap >= low && ap <= high;
  }
  return Math.abs(ap) <= 0.35;
}

function tryResolvePrediction(prevSnapshot, inst) {
  if (prevSnapshot?.predictedMid == null || prevSnapshot.priceAtPredict == null) return null;
  if (hasResolvedPredictTs(inst.id, prevSnapshot.ts)) return null;

  const predictTs = prevSnapshot.ts;
  const predictMs = new Date(predictTs).getTime();
  if (Number.isNaN(predictMs)) return null;

  const nowMs = Date.now();
  const predictDay = String(predictTs).slice(0, 10);

  let actualPct = null;
  let resolveTs = null;
  let resolveSource = null;

  const bars = readKlineBarsFromCache(inst.id);
  const nextBar = findNextDailyBar(bars, predictDay);
  if (nextBar?.close > 0 && prevSnapshot.priceAtPredict > 0) {
    actualPct = ((nextBar.close - prevSnapshot.priceAtPredict) / prevSnapshot.priceAtPredict) * 100;
    resolveTs = `${nextBar.date}T15:00:00.000Z`;
    resolveSource = 'kline_close';
  } else if (nowMs - predictMs >= RESOLVE_MIN_MS && inst.price != null && prevSnapshot.priceAtPredict > 0) {
    actualPct = ((inst.price - prevSnapshot.priceAtPredict) / prevSnapshot.priceAtPredict) * 100;
    resolveTs = inst.judgementUpdatedAt || new Date().toISOString();
    resolveSource = 'price_delta';
  }

  if (actualPct == null) return null;

  const predictedMid = Number(prevSnapshot.predictedMid);
  const gapPct = +(actualPct - predictedMid).toFixed(3);

  return {
    instrumentId: inst.id,
    predictTs,
    resolveTs,
    resolveSource,
    predictedMid,
    predictedLow: prevSnapshot.predictedLow ?? null,
    predictedHigh: prevSnapshot.predictedHigh ?? null,
    priceAtPredict: prevSnapshot.priceAtPredict,
    actualPct: +actualPct.toFixed(3),
    gapPct,
    hitDirection: computeHitDirection(
      predictedMid,
      actualPct,
      prevSnapshot.predictedLow,
      prevSnapshot.predictedHigh
    ),
  };
}

function queueAccuracyAppend(record) {
  pendingAccuracyQueue.push(record);
  if (!flushTimer) {
    flushTimer = setTimeout(flushPendingWrites, 0);
  }
}

function buildSnapshotRecord(inst, prev, dataVersion) {
  const base = inst.scenarios?.base || inst.nextDayRangePct || {};
  const prediction = extractPredictionFields(inst);
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
    ...prediction,
    scenarios: inst.scenarios,
    factorBreakdown: inst.factorBreakdown,
    predictionRationale: inst.predictionRationale || null,
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
    dataQuality: inst.dataQuality ?? null,
    insufficientData: inst.insufficientData ?? false,
    dataVersion: dataVersion || inst.dataVersion || null,
  };

  if (prev) {
    record.deltaScore = +((record.compositeScore ?? 0) - (prev.compositeScore ?? 0)).toFixed(3);
    const prevMid = prev.baseRange?.mid ?? prev.mid ?? prev.predictedMid;
    const nextMid = record.baseRange?.mid ?? record.predictedMid;
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
  if (!root) return;

  const batch = pendingAppendQueue.splice(0, pendingAppendQueue.length);
  const accuracyBatch = pendingAccuracyQueue.splice(0, pendingAccuracyQueue.length);

  if (batch.length) {
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

  if (accuracyBatch.length) {
    const byInst = new Map();
    for (const rec of accuracyBatch) {
      if (!byInst.has(rec.instrumentId)) byInst.set(rec.instrumentId, []);
      byInst.get(rec.instrumentId).push(rec);
    }
    for (const [instrumentId, records] of byInst) {
      const fp = accuracyPath(instrumentId);
      if (!fp) continue;
      const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.appendFile(fp, lines, { encoding: 'utf8' }, () => {});
    }
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
    const accuracyRecord = prev ? tryResolvePrediction(prev, inst) : null;
    if (accuracyRecord) queueAccuracyAppend(accuracyRecord);

    const record = buildSnapshotRecord(inst, prev, dataVersion);
    const material = isMaterialChange(prev, record);

    const lastMs = lastWriteByInstrument.get(inst.id) || 0;
    if (!material && now - lastMs < BATCH_MIN_MS) continue;

    if (material || now - lastMs >= BATCH_MIN_MS) {
      if (prev) {
        const prevMid = prev.baseRange?.mid ?? prev.mid ?? prev.predictedMid;
        const newMid = record.baseRange?.mid ?? record.predictedMid;
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

function getPendingPrediction(instrumentId) {
  const latest = readLatestSnapshot(instrumentId);
  if (latest?.predictedMid == null || latest.priceAtPredict == null) return null;
  if (hasResolvedPredictTs(instrumentId, latest.ts)) return null;
  return latest;
}

function getDirectionHitRate7d(instrumentId = null) {
  const root = getOutlookHistoryRoot();
  if (!root) return { rate: null, hits: 0, total: 0 };

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let hits = 0;
  let total = 0;

  const snapshotsRoot = path.join(root, 'outlook-snapshots');
  if (!fs.existsSync(snapshotsRoot)) return { rate: null, hits: 0, total: 0 };

  const dirs = instrumentId
    ? [path.join(snapshotsRoot, String(instrumentId).replace(/[^\w.-]/gi, '_'))]
    : fs.readdirSync(snapshotsRoot).map((d) => path.join(snapshotsRoot, d));

  for (const dir of dirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const fp = path.join(dir, 'accuracy.jsonl');
    if (!fs.existsSync(fp)) continue;
    try {
      const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const row = JSON.parse(line);
          const resolveMs = new Date(row.resolveTs || row.predictTs).getTime();
          if (Number.isNaN(resolveMs) || resolveMs < cutoff) continue;
          total += 1;
          if (row.hitDirection) hits += 1;
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  return {
    rate: total > 0 ? +(hits / total).toFixed(3) : null,
    hits,
    total,
  };
}

function getOutlookHistory(instrumentId, days = 7) {
  const root = getOutlookHistoryRoot();
  const rows = readJsonlForDays(instrumentId, days);
  const latest = instrumentId ? readLatestSnapshot(instrumentId) : null;
  const accuracyRecords = instrumentId ? readAccuracyRecords(instrumentId, 20) : [];
  const pending =
    instrumentId && latest && !hasResolvedPredictTs(instrumentId, latest.ts) && latest.predictedMid != null
      ? {
          predictTs: latest.ts,
          predictedMid: latest.predictedMid,
          status: 'pending',
        }
      : null;

  return {
    root,
    instrumentId: instrumentId || null,
    days,
    latest,
    todayCount: countTodayArchiveEntries(),
    changes: rows.slice(0, 500),
    accuracyRecords: accuracyRecords.slice(0, 5),
    pendingPrediction: pending,
    directionHitRate7d: getDirectionHitRate7d(instrumentId),
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
    inst.accuracyRecords = readAccuracyRecords(inst.id, 5);
    inst.pendingPrediction = null;
    inst.yesterdayArchive = getYesterdayArchiveCompare(inst.id);
    return inst;
  }
  const mid = extractMid(inst);
  const prevMid = prev.baseRange?.mid ?? prev.mid ?? prev.predictedMid;
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
  inst.accuracyRecords = readAccuracyRecords(inst.id, 5);
  inst.pendingPrediction =
    !hasResolvedPredictTs(inst.id, prev.ts) && prev.predictedMid != null
      ? { predictTs: prev.ts, predictedMid: prev.predictedMid, status: 'pending' }
      : null;
  inst.yesterdayArchive = getYesterdayArchiveCompare(inst.id);
  return inst;
}

module.exports = {
  getOutlookHistoryRoot,
  readLatestSnapshot,
  readAccuracyRecords,
  isMaterialChange,
  recordOutlookSnapshots,
  countTodayArchiveEntries,
  getOutlookHistory,
  exportOutlookHistory,
  attachChangeDelta,
  getDirectionHitRate7d,
  tryResolvePrediction,
  todayKey,
  dayKeyOffset,
  getDailySummaryPath,
  getDailyDir,
  readDailySummary,
  writeDailySnapshot,
  resolveYesterdayPredictions,
  getDailyCompare,
  bootstrapDailyOutlook,
  getYesterdayArchiveCompare,
};
