/**
 * 回填方向预测审计存档（T+1 · daily summary + outlook jsonl）
 *
 * v1（默认）:
 *   FANCHENG_DATA_DRIVE=E node scripts/backfill-direction-prediction-archive.js --id au --id ag
 *
 * v2（哲学 filter + Model C 重放 · Step 5）:
 *   FANCHENG_DATA_DRIVE=E node scripts/backfill-direction-prediction-archive.js --schema v2 --id au --id ag --from 2023-01-01 --to 2025-12-31 --force
 *
 * 全品种 v2 回填:
 *   FANCHENG_DATA_DRIVE=E node scripts/backfill-direction-prediction-archive.js --schema v2 --from 2019-01-01 --force
 *
 * --rescore  强制按 T+1 重算已有存档（T+3→T+1 迁移时必用）
 * --dry-run  v2 模式下仅统计、不写 jsonl
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');
const { getAllCommodities } = require('../services/commodities-catalog');
const archive = require('../services/direction-prediction-archive');
const cnSession = require('../services/cn-futures-session-calendar');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const historicalContext = require('../services/commodity-outlook-historical-context');
const newsTagged = require('../services/news-tagged-loader');
const philosophyFilter = require('../services/philosophy-direction-filter');
const modelCGate = require('../services/model-c-intersection-gate');

const V2_MODEL_VERSION = 'v2-philosophy-filter+model-c';
const WR_SKIP = new Set(['wr']);
const rawArgs = process.argv.slice(2);
const CLI_IDS = [];
let FROM = archive.ARCHIVE_START_DATE;
let TO = new Date().toISOString().slice(0, 10);
let RESCORE = false;
let SCHEMA_V2 = false;
let DRY_RUN = false;
let FORCE = false;

for (let i = 0; i < rawArgs.length; i += 1) {
  const a = rawArgs[i];
  if (a === '--rescore') {
    RESCORE = true;
    continue;
  }
  if (a === '--dry-run') {
    DRY_RUN = true;
    continue;
  }
  if (a === '--force') {
    FORCE = true;
    continue;
  }
  if (a === '--schema' && rawArgs[i + 1]) {
    SCHEMA_V2 = String(rawArgs[i + 1]).toLowerCase() === 'v2';
    i += 1;
    continue;
  }
  if (a.startsWith('--schema=')) {
    SCHEMA_V2 = a.slice(9).toLowerCase() === 'v2';
    continue;
  }
  if (a === '--id' && rawArgs[i + 1]) {
    CLI_IDS.push(String(rawArgs[i + 1]).toLowerCase());
    i += 1;
    continue;
  }
  if (a.startsWith('--id=')) {
    CLI_IDS.push(a.slice(5).toLowerCase());
    continue;
  }
  if (a === '--from' && rawArgs[i + 1]) {
    FROM = rawArgs[i + 1];
    i += 1;
    continue;
  }
  if (a === '--to' && rawArgs[i + 1]) {
    TO = rawArgs[i + 1];
    i += 1;
  }
}

function normBarDate(bar) {
  return cnSession.normBarDate(bar);
}

function findSpec(id) {
  return INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === String(id).toLowerCase());
}

function resolveNeutralReasons(record) {
  if (record.neutralReasons?.length) return record.neutralReasons;
  if (record.neutralReason) return [record.neutralReason];
  return [];
}

function summarizeV2Records(records) {
  const stats = {
    total: records.length,
    schemaV2: 0,
    filterPass: 0,
    neutral: 0,
    neutralWithReason: 0,
    neutralMissingReason: 0,
    intersectionKpiEligible: 0,
    tradableForKpi: 0,
    neutralReasons: {},
  };
  for (const rec of records) {
    if ((rec.schemaVersion || 1) >= 2) stats.schemaV2 += 1;
    if (rec.filterPass === true) stats.filterPass += 1;
    if (rec.predictedDir === 'neutral') {
      stats.neutral += 1;
      const reasons = resolveNeutralReasons(rec);
      if (reasons.length) stats.neutralWithReason += 1;
      else stats.neutralMissingReason += 1;
      for (const reason of reasons) {
        stats.neutralReasons[reason] = (stats.neutralReasons[reason] || 0) + 1;
      }
    }
    if (rec.intersectionKpiEligible === true) stats.intersectionKpiEligible += 1;
    if (rec.tradableForKpi === true) stats.tradableForKpi += 1;
  }
  stats.filterPassPct = stats.total ? +((stats.filterPass / stats.total) * 100).toFixed(2) : null;
  stats.neutralReasonCoveragePct = stats.neutral
    ? +((stats.neutralWithReason / stats.neutral) * 100).toFixed(2)
    : null;
  return stats;
}

function getOutlookHistoryRoot() {
  const dataDir = getDataDir();
  return dataDir ? path.join(dataDir, 'outlook-history') : null;
}

function listDailySummaryDays(from, to) {
  const root = getOutlookHistoryRoot();
  if (!root) return [];
  const dailyRoot = path.join(root, 'daily');
  if (!fs.existsSync(dailyRoot)) return [];
  return fs
    .readdirSync(dailyRoot)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from && d <= to)
    .sort();
}

function readDailySummary(day) {
  const fp = path.join(getOutlookHistoryRoot(), 'daily', day, 'summary.json');
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function loadBars(id) {
  return archive.readKlineBars(id);
}

function isActiveInstrument(bars) {
  if (!bars?.length) return false;
  return bars.slice(-20).some((b) => (b.volume ?? b.vol ?? 0) > 0);
}

function resolveTargetIds() {
  if (CLI_IDS.length) return CLI_IDS;
  return getAllCommodities()
    .map((m) => String(m.id).toLowerCase())
    .filter((id) => !WR_SKIP.has(id));
}

/** 从 outlook jsonl 提取每日末次方向快照（补 daily summary 缺失日） */
function collectJsonlDailyDirections(instrumentId, from, to) {
  const root = getOutlookHistoryRoot();
  if (!root) return new Map();
  const id = String(instrumentId).toLowerCase();
  const byDay = new Map();

  for (const name of fs.readdirSync(root).filter((f) => f.endsWith('.jsonl')).sort()) {
    const day = name.replace('.jsonl', '');
    if (day < from || day > to) continue;
    const fp = path.join(root, name);
    try {
      const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const row = JSON.parse(line);
          if (String(row.instrumentId || '').toLowerCase() !== id) continue;
          const ts = row.ts || `${day}T12:00:00.000Z`;
          const prev = byDay.get(day);
          if (!prev || String(ts).localeCompare(String(prev.ts)) > 0) {
            byDay.set(day, {
              id,
              direction: row.directionTier || row.direction,
              directionLabel: row.directionLabel,
              ts,
            });
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip file
    }
  }
  return byDay;
}

function backfillInstrumentV2(id) {
  process.env.PHILOSOPHY_FILTER_V2 = '1';
  process.env.MODEL_C_V2 = '1';
  process.env.DIRECTION_ARCHIVE_MODEL_VERSION = V2_MODEL_VERSION;

  const spec = findSpec(id);
  if (!spec) return { id, error: 'unknown_instrument' };

  const bars = loadBars(id);
  if (bars.length < 60) return { id, error: 'insufficient_bars', n: bars.length };
  if (!isActiveInstrument(bars)) return { id, error: 'inactive', n: bars.length };

  const weights = calibration.getCompositeWeights();
  let prevFinance = 'neutral';
  const newRecords = [];

  for (let t = 60; t < bars.length - 1; t += 1) {
    const day = normBarDate(bars[t]);
    if (day < FROM || day > TO) continue;

    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prevFinance, {
      philosophyFilterV2: true,
      modelCV2: true,
    });
    if (!row?.philosophyFilter) continue;
    prevFinance = row.financeRegimeNext || prevFinance;

    let record = archive.buildDirectionRecord({
      instrumentId: id,
      baselineDate: day,
      predictedDir: row.predictedDir,
      predictedTier: row.predictedDir,
      source: 'backfill-v2',
      bars,
      philosophyFilterOut: row.philosophyFilter,
      modelCOut: row.modelC,
    });
    if (!record) continue;

    if (record.predictedDir === 'neutral' && !resolveNeutralReasons(record).length) {
      record = {
        ...record,
        neutralReason: row.modelC?.neutralReason || row.philosophyFilter?.neutralReason || 'unknown_filter_fail',
        neutralReasons: row.modelC?.neutralReasons?.length
          ? row.modelC.neutralReasons
          : [row.modelC?.neutralReason || row.philosophyFilter?.neutralReason || 'unknown_filter_fail'],
      };
    }

    newRecords.push(record);
  }

  const v2Stats = summarizeV2Records(newRecords);
  let merge = { added: 0, updated: 0, skipped: 0, count: 0, path: archive.getArchivePath(id) };

  if (!DRY_RUN && newRecords.length) {
    merge = archive.bulkMergeRecords(id, newRecords, { force: FORCE || true });
  }

  const stats = DRY_RUN ? null : archive.getDirectionStats(id, { from: FROM, to: TO });
  return {
    id,
    mode: 'v2',
    dryRun: DRY_RUN,
    replayed: newRecords.length,
    merge,
    v2Stats,
    rows: stats?.count ?? newRecords.length,
    scored: stats?.scored ?? null,
    hitRate: stats?.hitRate ?? null,
    path: merge.path,
    startDate: FROM,
    endDate: TO,
  };
}

function backfillInstrument(id) {
  if (SCHEMA_V2) return backfillInstrumentV2(id);
  const bars = loadBars(id);
  if (bars.length < 30) return { id, error: 'insufficient_bars', n: bars.length };
  if (!isActiveInstrument(bars)) return { id, error: 'inactive', n: bars.length };

  const days = listDailySummaryDays(FROM, TO);
  const jsonlByDay = collectJsonlDailyDirections(id, FROM, TO);
  let recorded = 0;
  let updated = 0;
  const seenDays = new Set();

  for (const day of days) {
    const summary = readDailySummary(day);
    const entry = summary?.instruments?.find(
      (i) => String(i.id).toLowerCase() === id
    );
    if (entry) {
      const result = archive.recordFromDailyEntry(entry, day);
      if (result.recorded) {
        recorded += 1;
        if (result.updated) updated += 1;
      }
      seenDays.add(day);
    }
  }

  for (const [day, entry] of jsonlByDay.entries()) {
    if (seenDays.has(day)) continue;
    const record = archive.buildDirectionRecord({
      instrumentId: id,
      baselineDate: day,
      predictedDir: entry.direction,
      predictedTier: entry.direction,
      predictedDirLabel: entry.directionLabel,
      source: 'outlook-jsonl',
      predictTs: entry.ts,
      bars,
    });
    if (!record) continue;
    const result = archive.upsertRecord(record);
    if (result.recorded) {
      recorded += 1;
      if (result.updated) updated += 1;
    }
    seenDays.add(day);
  }

  const refresh = archive.refreshInstrument(id, bars, { rescore: RESCORE });
  const stats = archive.getDirectionStats(id);
  const pathOut = archive.getArchivePath(id);

  return {
    id,
    recorded,
    updated,
    refreshed: refresh.refreshed,
    rows: stats.count,
    scored: stats.scored,
    hitRate: stats.hitRate,
    hits: stats.hits,
    pending: stats.pending,
    path: pathOut,
    startDate: stats.startDate,
    endDate: stats.endDate,
  };
}

async function main() {
  if (SCHEMA_V2) {
    diskCache.init(getDataDir());
    await historicalContext.ensureFredDailyCache();
    newsTagged.loadNewsTagged({ force: true });
  }

  const ids = resolveTargetIds();
  console.log('=== DIRECTION PREDICTION ARCHIVE BACKFILL ===');
  console.log(
    'from',
    FROM,
    'to',
    TO,
    'instruments',
    ids.length,
    'schema',
    SCHEMA_V2 ? 'v2' : 'v1',
    'rescore',
    RESCORE,
    'dryRun',
    DRY_RUN,
    'force',
    SCHEMA_V2 ? FORCE || true : FORCE
  );
  if (SCHEMA_V2) {
    console.log(
      `PHILOSOPHY_FILTER_V2=1 MODEL_C_V2=1 · filter ${philosophyFilter.FILTER_VERSION} · gate ${modelCGate.GATE_VERSION}`
    );
  }

  const results = [];
  for (const id of ids) {
    const row = backfillInstrument(id);
    results.push(row);
    if (row.error) console.log(id, 'SKIP', row.error);
    else if (row.mode === 'v2') {
      const s = row.v2Stats || {};
      console.log(
        id,
        'replayed',
        row.replayed,
        DRY_RUN ? '(dry-run)' : `merged +${row.merge?.added} ~${row.merge?.updated}`,
        'filterPass',
        `${s.filterPassPct ?? '—'}%`,
        'neutralReasonCoverage',
        `${s.neutralReasonCoveragePct ?? '—'}%`,
        'intersectionKpi',
        s.intersectionKpiEligible ?? 0
      );
      if (s.neutralReasons && Object.keys(s.neutralReasons).length) {
        console.log('  neutralReasons:', JSON.stringify(s.neutralReasons));
      }
      if (s.neutralMissingReason) {
        console.warn('  WARN neutralMissingReason', s.neutralMissingReason);
      }
    } else {
      console.log(
        id,
        'rows',
        row.rows,
        'scored',
        row.scored,
        'hitRate',
        row.hitRate != null ? `${Math.round(row.hitRate * 100)}%` : '—',
        `(${row.hits}/${row.scored})`,
        'pending',
        row.pending
      );
    }
  }

  const ok = results.filter((r) => !r.error);
  const totalRows = ok.reduce((s, r) => s + (r.replayed ?? r.rows ?? 0), 0);
  console.log('\n=== SUMMARY ===');
  console.log('instruments ok', ok.length, '/', results.length);
  console.log('total archive rows', totalRows);
  if (SCHEMA_V2) {
    const agg = summarizeV2Records(
      ok.flatMap((r) => {
        if (DRY_RUN || !r.path || !fs.existsSync(r.path)) return [];
        return archive.readArchiveLines(r.id).filter((rec) => rec.baselineDate >= FROM && rec.baselineDate <= TO);
      })
    );
    if (DRY_RUN) {
      const dryAgg = { total: 0, schemaV2: 0, filterPass: 0, neutralReasons: {} };
      for (const r of ok) {
        const s = r.v2Stats || {};
        dryAgg.total += s.total || 0;
        dryAgg.schemaV2 += s.schemaV2 || 0;
        dryAgg.filterPass += s.filterPass || 0;
        for (const [k, v] of Object.entries(s.neutralReasons || {})) {
          dryAgg.neutralReasons[k] = (dryAgg.neutralReasons[k] || 0) + v;
        }
      }
      console.log('v2 dry-run replay total', dryAgg.total, 'schemaV2', dryAgg.schemaV2);
      console.log('neutralReasons aggregate', JSON.stringify(dryAgg.neutralReasons, null, 2));
    } else if (agg.total) {
      console.log('v2 window schemaV2', agg.schemaV2, '/', agg.total);
      console.log('neutralReasons aggregate', JSON.stringify(agg.neutralReasons, null, 2));
    }
  }
  console.log('archive root', archive.getArchiveRoot());
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { backfillInstrument, backfillInstrumentV2, resolveTargetIds, summarizeV2Records };
