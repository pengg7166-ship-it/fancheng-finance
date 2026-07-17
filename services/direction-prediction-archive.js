/**
 * 方向预测审计存档 'T+1 'KPI · CN session 21:00'5:00 锚点
 * 存储：{dataDir}/history/direction-prediction-archive/{instrumentId}-daily.jsonl
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const diskCache = require('./disk-cache');
const cnSession = require('./cn-futures-session-calendar');
const { directionTierClass } = require('./commodity-instrument-profiles');
const {
  computeT1Direction,
  hitDirection,
  directionFromReturnPct,
  LABELS_VERSION,
} = require('./outlook-labels');
const directionT1Scoring = require('./direction-t1-scoring');
const philosophyFilter = require('./philosophy-direction-filter');
const modelCGate = require('./model-c-intersection-gate');

const ARCHIVE_SUBDIR = path.join('history', 'direction-prediction-archive');
const MODEL_VERSION =
  process.env.DIRECTION_ARCHIVE_MODEL_VERSION || 'v1.34.8-ag-cu-spread+basis-term';
/** 方向审计存档起始日（E 'history/trading K 线约 2017-12-11 起） */
const ARCHIVE_START_DATE = '2017-12-11';
const VERIFY_HORIZON = 1;
/** 方向审计 UI 目标命中率（'neutral 计分'*/
const DIRECTION_HIT_TARGET = 0.75;

const DIR_ZH = {
  bullish: '看涨',
  bearish: '看跌',
  neutral: '中',
};

function getArchiveRoot() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const root = path.join(dataDir, ARCHIVE_SUBDIR);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getArchivePath(instrumentId) {
  const root = getArchiveRoot();
  if (!root) return null;
  return path.join(root, `${String(instrumentId || '').toLowerCase()}-daily.jsonl`);
}

function normBarDate(bar) {
  return cnSession.normBarDate(bar);
}

function readArchiveLines(instrumentId) {
  const fp = getArchivePath(instrumentId);
  if (!fp || !fs.existsSync(fp)) return [];
  return fs
    .readFileSync(fp, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
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

function writeArchiveLines(instrumentId, records) {
  const fp = getArchivePath(instrumentId);
  if (!fp) return { wrote: false, path: null, count: 0 };
  const sorted = [...records].sort((a, b) =>
    String(a.baselineDate).localeCompare(String(b.baselineDate))
  );
  const body = sorted.map((r) => JSON.stringify(r)).join('\n') + (sorted.length ? '\n' : '');
  fs.writeFileSync(fp, body, 'utf8');
  return { wrote: true, path: fp, count: sorted.length };
}

function readKlineBars(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  const dataDir = getDataDir();
  if (dataDir) {
    for (const key of [id, id.toUpperCase()]) {
      const fp = path.join(dataDir, 'history', 'trading', `${key}.json`);
      if (!fs.existsSync(fp)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const bars = (Array.isArray(raw) ? raw : raw.series || [])
          .filter((b) => b.date && b.close > 0)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (bars.length) return bars;
      } catch {
        // try cache
      }
    }
  }
  const key = `klines/commodity-${id}-day.json`;
  const cached = diskCache.readStale(key);
  return (cached?.data?.klines || [])
    .filter((b) => b.date && b.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function normalizePredictedDir(raw, tierHint) {
  const primary = raw || tierHint;
  if (!primary) return 'neutral';
  const s = String(primary).toLowerCase();
  if (s === 'bullish' || s === 'bearish' || s === 'neutral') return s;

  const fromTier = directionTierClass(tierHint || raw);
  if (fromTier !== 'neutral') return fromTier;

  const text = String(raw || tierHint || '');
  const tierText = String(tierHint || raw || '');
  if (/强多|偏多|看涨|↑↑|↑/.test(text) && !/偏空|看跌|强空|↓/.test(text)) return 'bullish';
  if (/强空|偏空|看跌|↓↓|↓/.test(text) && !/偏多|看涨|强多|↑/.test(text)) return 'bearish';
  if (/震荡|中性|观望|整理/.test(text)) return 'neutral';

  if (/回踩|待突破/.test(text)) {
    const ctx = directionTierClass(tierHint);
    if (ctx !== 'neutral') return ctx;
    if (/bull|多|涨|↑/.test(tierText)) return 'bullish';
    if (/bear|空|跌|↓/.test(tierText)) return 'bearish';
  }

  return directionTierClass(raw) || 'neutral';
}

function predictedDirLabel(dir, tierLabel, tier) {
  if (tierLabel && /[\u4e00-\u9fff]/.test(String(tierLabel))) return String(tierLabel);
  if (tier === 'strong_bullish') return '强多';
  if (tier === 'strong_bearish') return '强空';
  return DIR_ZH[dir] || DIR_ZH.neutral;
}

function resolveActualT1(bars, baselineDate) {
  if (!bars?.length || !baselineDate) return { status: 'pending' };
  const sorted = [...bars].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const idx = sorted.findIndex((b) => normBarDate(b) === String(baselineDate).slice(0, 10));
  if (idx < 0) return { status: 'pending', reason: 'no_baseline_bar' };

  const target = cnSession.getNextSessionTarget(sorted, idx);
  if (idx + VERIFY_HORIZON >= sorted.length) {
    return {
      status: 'pending',
      reason: 'await_t1',
      sessionDate: target?.nextBarDate ?? null,
      baselineDate: String(baselineDate).slice(0, 10),
    };
  }

  const t1 = computeT1Direction(sorted, idx);
  const baselineClose = Number(sorted[idx].close);
  let sessionReturnPct = null;
  if (target?.nextBarDate && baselineClose > 0) {
    const nextIdx = sorted.findIndex((b) => normBarDate(b) === target.nextBarDate);
    if (nextIdx >= 0) {
      sessionReturnPct = +(
        ((Number(sorted[nextIdx].close) - baselineClose) / baselineClose) *
        100
      ).toFixed(4);
    }
  }

  const actualReturnPct = sessionReturnPct ?? t1.returnPct;
  const actualDir = directionFromReturnPct(actualReturnPct);

  return {
    status: 'complete',
    actualReturnPct,
    actualDir,
    verifyDate: target?.nextBarDate ?? t1.barDateEnd,
    sessionDate: target?.nextBarDate ?? null,
    sessionReturnPct,
    baselineClose,
  };
}

/** @deprecated 别名 '审计已切'T+1 */
function resolveActualT3(bars, baselineDate) {
  return resolveActualT1(bars, baselineDate);
}

function archiveRecordKey(record) {
  const day = String(record?.baselineDate || '').slice(0, 10);
  const slot = record?.predictionSlot || 'legacy';
  return `${day}|${slot}`;
}

function buildDirectionRecord({
  instrumentId,
  baselineDate,
  predictedDir,
  predictedTier,
  predictedDirLabel: labelOverride,
  source = 'daily-summary',
  predictTs = null,
  predictionSlot = null,
  predictionSlotLabel = null,
  sessionDate = null,
  bars = null,
  philosophyFilterOut = null,
  modelCOut = null,
}) {
  const id = String(instrumentId || '').toLowerCase();
  const day = String(baselineDate || '').slice(0, 10);
  if (!id || !day || day < ARCHIVE_START_DATE) return null;

  const dir = normalizePredictedDir(predictedDir, predictedTier);
  const klines = bars || readKlineBars(id);
  const actual = resolveActualT1(klines, day);
  const hit =
    actual.status === 'complete'
      ? hitDirection(dir, actual.actualDir)
      : null;

  const record = {
    instrumentId: id,
    baselineDate: day,
    sessionDate: sessionDate ?? actual.sessionDate ?? null,
    verifyDate: actual.verifyDate ?? null,
    predictedDir: dir,
    predictedTier: predictedTier || predictedDir || dir,
    predictedDirLabel: predictedDirLabel(dir, labelOverride, predictedTier),
    actualReturnPct: actual.actualReturnPct ?? null,
    actualDir: actual.actualDir ?? null,
    sessionReturnPct: actual.sessionReturnPct ?? null,
    hitDirection: hit,
    horizon: VERIFY_HORIZON,
    status: actual.status === 'complete' ? 'complete' : 'pending',
    anchor: 'cn-session-21:00-05:00',
    labelsVersion: LABELS_VERSION,
    modelVersion: recordModelVersion(),
    source,
    predictTs,
    predictionSlot: predictionSlot || null,
    predictionSlotLabel: predictionSlotLabel || null,
    recordedAt: new Date().toISOString(),
  };

  let out = record;
  if (philosophyFilterOut) {
    out = philosophyFilter.attachFilterToArchiveRecord(out, philosophyFilterOut);
  }
  if (modelCOut) {
    out = modelCGate.attachModelCToArchiveRecord(out, modelCOut);
  }
  return out;
}

function recordModelVersion() {
  return process.env.DIRECTION_ARCHIVE_MODEL_VERSION || MODEL_VERSION;
}

function bulkMergeRecords(instrumentId, newRecords, opts = {}) {
  const preserveSources = opts.preserveSources || PRODUCTION_SOURCES_DEFAULT;
  const existing = readArchiveLines(instrumentId);
  const byDay = new Map(existing.map((r) => [archiveRecordKey(r), r]));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const rec of newRecords) {
    const day = archiveRecordKey(rec);
    const prev = byDay.get(day);
    if (prev && preserveSources.has(prev.source) && !opts.force) {
      skipped += 1;
      continue;
    }
    if (prev) {
      byDay.set(day, {
        ...prev,
        ...rec,
        recordedAt: prev.recordedAt || rec.recordedAt,
        updatedAt: new Date().toISOString(),
      });
      updated += 1;
    } else {
      byDay.set(day, rec);
      added += 1;
    }
  }

  const merged = [...byDay.values()];
  const write = writeArchiveLines(instrumentId, merged);
  return { added, updated, skipped, count: merged.length, path: write.path };
}

const PRODUCTION_SOURCES_DEFAULT = new Set(['daily-summary', 'outlook-jsonl', 'slot-snapshot']);

function upsertRecord(record) {
  if (!record?.instrumentId || !record?.baselineDate) {
    return { recorded: false, reason: 'missing_fields' };
  }
  const existing = readArchiveLines(record.instrumentId);
  const key = archiveRecordKey(record);
  const idx = existing.findIndex((r) => archiveRecordKey(r) === key);
  const merged =
    idx >= 0
      ? {
          ...existing[idx],
          ...record,
          recordedAt: existing[idx].recordedAt || record.recordedAt,
          updatedAt: new Date().toISOString(),
        }
      : record;
  if (idx >= 0) existing[idx] = merged;
  else existing.push(merged);
  const write = writeArchiveLines(record.instrumentId, existing);
  return { recorded: true, updated: idx >= 0, path: write.path, record: merged };
}

function enrichAuditRecord(record = {}) {
  const dir = normalizePredictedDir(record.predictedDir, record.predictedTier);
  const neutralReasons = record.neutralReasons?.length
    ? record.neutralReasons
    : record.neutralReason
      ? [record.neutralReason]
      : [];
  return {
    ...record,
    predictedDir: dir,
    predictedDirLabel: predictedDirLabel(dir, record.predictedDirLabel, record.predictedTier),
    actualDirLabel: record.actualDir ? DIR_ZH[record.actualDir] || record.actualDir : null,
    hitLabel:
      record.hitDirection === true ? '' : record.hitDirection === false ? '' : '',
    auditNeutralReason: neutralReasons.length ? neutralReasons.join(' · ') : null,
    auditFilterPass: record.filterPass ?? null,
  };
}

function loadArchive(instrumentId, dateRange = {}) {
  const from = dateRange.from ? String(dateRange.from).slice(0, 10) : ARCHIVE_START_DATE;
  const to = dateRange.to ? String(dateRange.to).slice(0, 10) : null;
  return readArchiveLines(instrumentId)
    .filter((r) => {
      const d = r.baselineDate;
      if (!d || d < from) return false;
      if (to && d > to) return false;
      return true;
    })
    .map(enrichAuditRecord);
}

function loadArchiveForAudit(instrumentId) {
  return loadArchive(instrumentId)
    .sort((a, b) => String(b.baselineDate).localeCompare(String(a.baselineDate)));
}

function getDirectionStats(instrumentId, dateRange = {}, slotFilter = null) {
  let rows = loadArchive(instrumentId, dateRange);
  if (slotFilter) {
    rows = rows.filter((r) => {
      const slot = r.predictionSlot || 'pre-night';
      return slot === slotFilter;
    });
  }
  const scored = rows.filter(
    (r) => r.predictedDir && r.predictedDir !== 'neutral' && r.actualDir && r.hitDirection != null
  );
  const hits = scored.filter((r) => r.hitDirection).length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  const hitRate = scored.length ? +(hits / scored.length).toFixed(4) : null;
  const gated = directionT1Scoring.computeGatedStats(rows);
  return {
    instrumentId: String(instrumentId || '').toLowerCase(),
    count: rows.length,
    scored: scored.length,
    pending,
    hitRate,
    hits,
    meetsTarget: hitRate != null ? hitRate >= DIRECTION_HIT_TARGET : null,
    gatedScored: gated.scored,
    gatedHits: gated.hits,
    gatedHitRate: gated.hitRate,
    gatedMeetsTarget: gated.meetsTarget,
    targetHitRate: DIRECTION_HIT_TARGET,
    startDate: rows.length ? rows[rows.length - 1].baselineDate : null,
    endDate: rows.length ? rows[0].baselineDate : null,
    horizon: VERIFY_HORIZON,
    modelVersion: recordModelVersion(),
  };
}

function recordFromDailyEntry(entry, day) {
  if (!entry?.id) return { recorded: false, reason: 'no_id' };
  const record = buildDirectionRecord({
    instrumentId: entry.id,
    baselineDate: day,
    predictedDir: entry.direction,
    predictedTier: entry.direction,
    predictedDirLabel: entry.directionLabel,
    source: 'daily-summary',
    predictTs: entry.ts || null,
    predictionSlot: entry.predictionSlot || null,
    predictionSlotLabel: entry.predictionSlotLabel || null,
    sessionDate: entry.sessionDate || null,
  });
  if (!record) return { recorded: false, reason: 'before_start' };
  return upsertRecord(record);
}

function recordFromSlotEntry(entry, { baselineDate, slotMeta } = {}) {
  if (!entry?.id || !slotMeta?.id) return { recorded: false, reason: 'no_id_or_slot' };
  const day = String(baselineDate || entry.sessionDate || '').slice(0, 10);
  const record = buildDirectionRecord({
    instrumentId: entry.id,
    baselineDate: day,
    predictedDir: entry.direction,
    predictedTier: entry.direction,
    predictedDirLabel: entry.directionLabel,
    source: 'slot-snapshot',
    predictTs: entry.predictTs || slotMeta.predictTs || null,
    predictionSlot: slotMeta.id,
    predictionSlotLabel: slotMeta.label,
    sessionDate: entry.sessionDate || day,
  });
  if (!record) return { recorded: false, reason: 'before_start' };
  return upsertRecord(record);
}

function recordNeedsRescore(row, rescore = false) {
  if (rescore) return true;
  return needsPendingRefresh(row);
}

/** 仅待校验/缺实际'非中性未计分 '中'complete 且已'actual 则跳'*/
function needsPendingRefresh(row) {
  if (row.horizon !== VERIFY_HORIZON) return true;
  if (row.status === 'pending') return true;
  if (row.status === 'complete') {
    if (row.actualReturnPct == null && row.actualDir == null) return true;
    const dir = normalizePredictedDir(row.predictedDir, row.predictedTier);
    if (dir !== 'neutral' && row.hitDirection == null) return true;
    return false;
  }
  return true;
}

function mergeRefreshedRecord(prev, rebuilt) {
  const merged = {
    ...prev,
    ...rebuilt,
    recordedAt: prev.recordedAt || rebuilt.recordedAt,
    updatedAt: new Date().toISOString(),
    source: prev.source || rebuilt.source,
  };
  for (const key of [
    'filterPass',
    'neutralReason',
    'neutralReasons',
    'effectivePhilosophyDir',
    'tradableForLive',
    'liveStrategyTier',
    'modelCGatePass',
    'schemaVersion',
    'ensemblePUp',
    'logisticPUp',
  ]) {
    if (prev[key] != null && rebuilt[key] == null) merged[key] = prev[key];
  }
  return merged;
}

function refreshInstrument(instrumentId, bars = null, opts = {}) {
  const rescore = opts.rescore === true;
  const lookbackDays = opts.lookbackDays ?? null;
  const cutoff =
    lookbackDays != null
      ? cnSession.shiftCalendarDate(todayKey(), -Math.max(1, lookbackDays))
      : null;
  const existing = readArchiveLines(instrumentId);
  if (!existing.length) return { refreshed: 0, path: getArchivePath(instrumentId) };
  const klines = bars || readKlineBars(instrumentId);
  const byDay = new Map(existing.map((r) => [archiveRecordKey(r), r]));
  let refreshed = 0;

  for (const row of existing) {
    if (cutoff && row.baselineDate < cutoff) continue;
    if (!recordNeedsRescore(row, rescore)) continue;
    const rebuilt = buildDirectionRecord({
      instrumentId,
      baselineDate: row.baselineDate,
      predictedDir: row.predictedDir,
      predictedTier: row.predictedTier,
      predictedDirLabel: row.predictedDirLabel,
      source: row.source || 'archive-refresh',
      predictTs: row.predictTs,
      predictionSlot: row.predictionSlot,
      predictionSlotLabel: row.predictionSlotLabel,
      sessionDate: row.sessionDate,
      bars: klines,
    });
    if (!rebuilt) continue;
    byDay.set(archiveRecordKey(row), mergeRefreshedRecord(row, rebuilt));
    refreshed += 1;
  }

  if (refreshed > 0) {
    writeArchiveLines(instrumentId, [...byDay.values()]);
  }
  return { refreshed, path: getArchivePath(instrumentId) };
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** outlook 刷新时轻量回—仅近 N 'pending/缺实'*/
function refreshPendingInstrument(instrumentId, bars = null, opts = {}) {
  const lookbackDays = opts.lookbackDays ?? 21;
  return refreshInstrument(instrumentId, bars, { lookbackDays, rescore: false });
}

function refreshPendingForInstruments(instruments = [], opts = {}) {
  let refreshed = 0;
  let skipped = 0;
  for (const inst of instruments) {
    const id = inst?.id || inst;
    if (!id) continue;
    const existing = readArchiveLines(String(id).toLowerCase());
    const lookbackDays = opts.lookbackDays ?? 21;
    const cutoff = cnSession.shiftCalendarDate(todayKey(), -Math.max(1, lookbackDays));
    const hasPending = existing.some(
      (r) => r.baselineDate >= cutoff && needsPendingRefresh(r)
    );
    if (!hasPending) {
      skipped += 1;
      continue;
    }
    const r = refreshPendingInstrument(String(id).toLowerCase(), null, opts);
    refreshed += r.refreshed || 0;
  }
  return { refreshed, skipped, count: instruments.length };
}

function attachDirectionAuditRecords(inst, opts = {}) {
  if (!inst?.id) return inst;
  const limit = opts.limit ?? 42;
  const from = opts.from ?? null;
  try {
    inst.directionAuditStats = getDirectionStats(inst.id, from ? { from } : {});
    inst.directionAuditRecords = loadArchive(inst.id, from ? { from } : {})
      .sort((a, b) => String(b.baselineDate || b.sessionDate || '').localeCompare(String(a.baselineDate || a.sessionDate || '')))
      .slice(0, limit);
  } catch {
    inst.directionAuditStats = inst.directionAuditStats || null;
    inst.directionAuditRecords = inst.directionAuditRecords || [];
  }
  return inst;
}

function mergePhilosophyFilterFields(record, filterOut) {
  return philosophyFilter.attachFilterToArchiveRecord(record, filterOut);
}

function mergeModelCFields(record, modelCOut) {
  return modelCGate.attachModelCToArchiveRecord(record, modelCOut);
}

module.exports = {
  ARCHIVE_START_DATE,
  ARCHIVE_SUBDIR,
  MODEL_VERSION,
  VERIFY_HORIZON,
  DIRECTION_HIT_TARGET,
  DIR_ZH,
  getArchiveRoot,
  getArchivePath,
  readKlineBars,
  normalizePredictedDir,
  predictedDirLabel,
  resolveActualT1,
  resolveActualT3,
  recordNeedsRescore,
  buildDirectionRecord,
  upsertRecord,
  bulkMergeRecords,
  PRODUCTION_SOURCES_DEFAULT,
  readArchiveLines,
  writeArchiveLines,
  enrichAuditRecord,
  loadArchive,
  loadArchiveForAudit,
  getDirectionStats,
  recordFromDailyEntry,
  recordFromSlotEntry,
  archiveRecordKey,
  refreshInstrument,
  refreshPendingInstrument,
  refreshPendingForInstruments,
  needsPendingRefresh,
  attachDirectionAuditRecords,
  directionFromReturnPct,
  hitDirection,
  mergePhilosophyFilterFields,
  mergeModelCFields,
};
