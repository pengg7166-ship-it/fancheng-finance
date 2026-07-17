/**
 * Build news/basis labeling assistance artifacts (priority queue, user template, AG basis review).
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E node scripts/build-labeling-assistance.js
 *   ... [--oos-from 2023-01-01] [--top-n 80]
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getDataDir } = require('../services/data-paths');
const archive = require('../services/direction-prediction-archive');
const newsTagged = require('../services/news-tagged-loader');
const { readInbox } = require('../services/flash-news-fetcher');
const {
  isRelevantFlashCandidate,
  enrichFlashText,
} = require('../services/news-tag-expansion');

const OOS_FROM = process.env.LABEL_OOS_FROM || '2023-01-01';
const INSTRUMENTS = ['ag', 'au'];
const TOP_N = parseInt(process.env.LABEL_TOP_N || '80', 10);

const LABELS_DIR = () => path.join(getDataDir(), 'history', 'labels');
const PRIORITY_CSV = () => path.join(LABELS_DIR(), 'labeling-queue-priority.csv');
const USER_TEMPLATE_CSV = () => path.join(LABELS_DIR(), 'user-news-basis-label-template.csv');
const AG_BASIS_REVIEW_CSV = () => path.join(LABELS_DIR(), 'ag-basis-label-review.csv');
const AUDIT_TEMPLATE = () =>
  path.join(LABELS_DIR(), 'user-ag-basis-audit-template.csv');
const BUILD_REPORT = () => path.join(LABELS_DIR(), 'labeling-assistance-report.json');

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseSimpleCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cols[i] || '').trim();
    });
    return row;
  });
}

function loadDirectionT1Misses(instrumentId, fromDate) {
  const misses = [];
  for (const rec of archive.readArchiveLines(instrumentId)) {
    const d = String(rec.baselineDate || '').slice(0, 10);
    if (d < fromDate) continue;
    if (rec.status !== 'complete') continue;
    if (!rec.actualDir || rec.actualDir === 'neutral') continue;
    if (!rec.predictedDir || rec.predictedDir === 'neutral') continue;
    if (rec.hitDirection === true) continue;
    misses.push({
      date: d,
      instrumentId,
      predDir: rec.predictedDir,
      actualDir: rec.actualDir,
      logisticPUp: rec.logisticPUp ?? rec.ensemblePUp ?? '',
      missType: 'direction_t1',
    });
  }
  return misses;
}

function loadAgBasisMisses() {
  const fp = AUDIT_TEMPLATE();
  if (!fs.existsSync(fp)) return [];
  return parseSimpleCsv(fs.readFileSync(fp, 'utf8')).map((r) => ({
    date: r.date,
    instrumentId: 'ag',
    predDir: r.pred_dir,
    actualDir: r.actualDirT3,
    term_z: r.term_z_score,
    wh_chg: r.warehouseReceipt_chg_5d,
    regime_source: r.regime_source,
    failure_mode: r.failure_mode,
    missType: 'ag_basis_t3',
  }));
}

function suggestTagType(row) {
  const modes = String(row.failure_mode || row.missReason || '');
  if (modes.includes('warehouse_supply_up')) return 'warehouse';
  if (modes.includes('warehouse_demand_down')) return 'warehouse';
  if (modes.includes('oi_proxy_mislabel')) return 'basis';
  if (row.flashPolicy) return 'policy';
  if (row.flashGeo) return 'geo';
  if (row.missType === 'ag_basis_t3') return 'basis';
  if (row.missType === 'direction_t1') return 'supply';
  return 'policy';
}

function suggestRegime(row) {
  const src = row.regime_source || row.currentRegime || '';
  const termZ = Number(row.term_z ?? row.term_z_score);
  if (src === 'oi_proxy') {
    if (Number.isFinite(termZ) && Math.abs(termZ) >= 2) return 'term_structure';
    return 'skip_oi_proxy';
  }
  if (src === 'term_structure') return 'term_structure';
  return 'review';
}

function buildFlashByDate(fromDate) {
  const byDate = new Map();
  try {
    const inbox = readInbox();
    for (const c of inbox.candidates) {
      if (!isRelevantFlashCandidate(c)) continue;
      const pub = String(c.pubDate || '').slice(0, 10);
      if (!pub || pub < fromDate) continue;
      const { source_tier, text } = enrichFlashText(c);
      const entry = byDate.get(pub) || { policy: [], geo: [], titles: [] };
      if (source_tier === 'policy' || source_tier === 'macro') entry.policy.push(c);
      if (source_tier === 'geo') entry.geo.push(c);
      entry.titles.push(String(c.title || '').slice(0, 80));
      byDate.set(pub, entry);
    }
  } catch (_) {
    /* inbox optional */
  }
  return byDate;
}

function hasNewsOnDate(date, instrumentId) {
  const { byDate } = newsTagged.loadNewsTagged();
  const rows = byDate.get(date) || [];
  const id = instrumentId.toLowerCase();
  return rows.some((r) => new RegExp(`(^|;|,)(${id})(;|,|$)`, 'i').test(r.commodity_tags || ''));
}

function priorityScore(entry) {
  let score = 0;
  if (entry.agBasisMiss) score += 10;
  if (entry.directionMiss) score += 5;
  if (entry.agBasisMiss && entry.directionMiss) score += 8;
  const modes = String(entry.failure_mode || '');
  if (modes.includes('warehouse_supply_up')) score += 4;
  if (modes.includes('oi_proxy_mislabel')) score += 3;
  if (entry.flashPolicy) score += 2;
  if (entry.flashGeo) score += 2;
  if (!entry.hasExistingNews) score += 1;
  return score;
}

function buildPriorityQueue(flashByDate) {
  const byKey = new Map();

  for (const m of loadAgBasisMisses()) {
    const key = `${m.date}|ag`;
    const flash = flashByDate.get(m.date);
    byKey.set(key, {
      date: m.date,
      instrumentId: 'ag',
      agBasisMiss: true,
      directionMiss: false,
      failure_mode: m.failure_mode,
      regime_source: m.regime_source,
      term_z: m.term_z,
      wh_chg: m.wh_chg,
      predDir: m.predDir,
      actualDir: m.actualDir,
      flashPolicy: Boolean(flash?.policy?.length),
      flashGeo: Boolean(flash?.geo?.length),
      flashTitles: (flash?.titles || []).slice(0, 2).join(' | '),
      hasExistingNews: hasNewsOnDate(m.date, 'ag'),
    });
  }

  for (const id of INSTRUMENTS) {
    for (const m of loadDirectionT1Misses(id, OOS_FROM)) {
      const key = `${m.date}|${id}`;
      const flash = flashByDate.get(m.date);
      const existing = byKey.get(key) || {
        date: m.date,
        instrumentId: id,
        agBasisMiss: false,
        directionMiss: false,
        failure_mode: '',
        regime_source: '',
        flashPolicy: Boolean(flash?.policy?.length),
        flashGeo: Boolean(flash?.geo?.length),
        flashTitles: (flash?.titles || []).slice(0, 2).join(' | '),
        hasExistingNews: hasNewsOnDate(m.date, id),
      };
      existing.directionMiss = true;
      existing.predDir = existing.predDir || m.predDir;
      existing.actualDir = existing.actualDir || m.actualDir;
      existing.logisticPUp = m.logisticPUp;
      if (!existing.failure_mode) {
        existing.failure_mode = m.predDir === 'bullish' && m.actualDir === 'bearish'
          ? 'wrong_sign_bull'
          : m.predDir === 'bearish' && m.actualDir === 'bullish'
            ? 'wrong_sign_bear'
            : 'direction_t1_miss';
      }
      byKey.set(key, existing);
    }
  }

  const queue = [...byKey.values()]
    .map((e) => {
      const score = priorityScore(e);
      const missReason = [
        e.agBasisMiss ? 'ag_basis_t3' : '',
        e.directionMiss ? 'direction_t1' : '',
        e.failure_mode || '',
      ]
        .filter(Boolean)
        .join('+');
      return {
        ...e,
        priority_score: score,
        missReason,
        suggested_tag_type: suggestTagType(e),
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score || a.date.localeCompare(b.date));

  return queue;
}

function semiAutoTemplateRow(entry) {
  const modes = String(entry.failure_mode || '');
  const wh = Number(entry.wh_chg);
  const id = entry.instrumentId;
  const label = id === 'ag' ? '沪银' : '沪金';

  if (modes.includes('warehouse_supply_up') && Number.isFinite(wh) && wh > 0) {
    return {
      date: entry.date,
      instrumentId: id,
      eventType: 'warehouse',
      direction: 'bear',
      title: `${label}仓单5日增${wh.toFixed(2)}%（basis miss复核）`,
      notes: `自动生成：warehouse_supply_up；pred=${entry.predDir} actual=${entry.actualDir}；请确认或改写`,
      source_tier: 'commodity',
      stars: wh >= 5 ? '4' : '3',
      commodities: id,
      _prefilled: 'warehouse_auto',
    };
  }

  if (entry.flashPolicy && entry.flashTitles) {
    return {
      date: entry.date,
      instrumentId: id,
      eventType: 'policy',
      direction: entry.actualDir === 'bearish' ? 'bear' : entry.actualDir === 'bullish' ? 'bull' : 'neutral',
      title: `[待确认] ${entry.flashTitles.slice(0, 60)}`,
      notes: `flash-inbox 政策/宏观候选；miss=${entry.missReason}；请核验标题与方向`,
      source_tier: 'policy',
      stars: '3',
      commodities: id,
      _prefilled: 'flash_policy',
    };
  }

  if (modes.includes('oi_proxy_mislabel')) {
    return {
      date: entry.date,
      instrumentId: id,
      eventType: 'basis',
      direction: entry.actualDir === 'bearish' ? 'bear' : 'bull',
      title: `AG basis OI代理误标日（term_z=${entry.term_z || '?'})`,
      notes: `oi_proxy_mislabel；建议在 ag-basis-label-review.csv 确认 regime；新闻可选填`,
      source_tier: 'commodity',
      stars: '3',
      commodities: 'ag',
      _prefilled: 'basis_review',
    };
  }

  return {
    date: entry.date,
    instrumentId: id,
    eventType: suggestTagType(entry),
    direction:
      entry.actualDir === 'bearish' ? 'bear' : entry.actualDir === 'bullish' ? 'bull' : 'neutral',
    title: '',
    notes: `优先队列 score=${entry.priority_score}；${entry.missReason}；请填写标题`,
    source_tier: 'commodity',
    stars: '3',
    commodities: id,
    _prefilled: 'queue_only',
  };
}

function buildUserTemplate(priorityQueue) {
  const header =
    'date,instrumentId,eventType,direction,title,notes,source_tier,stars,commodities';
  const instructionRow = [
    '#说明',
    '见 docs/NEWS_BASIS_LABELING_GUIDE.md',
    'policy/geo/supply/basis/warehouse',
    'bull/bear/neutral',
    '必填若合并',
    '可选备注',
    'policy/geo/commodity/macro',
    '1-5',
    'ag;au 等',
  ];

  const top = priorityQueue.slice(0, TOP_N);
  const lines = [header, instructionRow.map(csvEscape).join(',')];
  for (const entry of top) {
    const row = semiAutoTemplateRow(entry);
    lines.push(
      [
        row.date,
        row.instrumentId,
        row.eventType,
        row.direction,
        row.title,
        row.notes,
        row.source_tier,
        row.stars,
        row.commodities,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return { csv: `${lines.join('\n')}\n`, rowCount: top.length, prefilled: top.filter((e) => e) };
}

function buildAgBasisReview() {
  const misses = loadAgBasisMisses();
  const header =
    'sessionDate,currentRegime,suggestedRegime,warehouse_chg,term_z,oi_tag,user_confirm,notes';
  const lines = [header];
  for (const m of misses) {
    const suggested = suggestRegime(m);
    const notes =
      m.failure_mode.includes('oi_proxy_mislabel')
        ? 'term_z未达±2却走OI代理；建议 skip_oi_proxy'
        : m.failure_mode.includes('warehouse_supply_up')
          ? '仓单上行+实际看跌；可补 warehouse bear 标签'
          : '';
    lines.push(
      [
        m.date,
        m.regime_source,
        suggested,
        m.wh_chg,
        m.term_z,
        m.regime_source === 'oi_proxy' ? 'oi_proxy_active' : '',
        '',
        notes,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return { csv: `${lines.join('\n')}\n`, rowCount: misses.length };
}

function main() {
  fs.mkdirSync(LABELS_DIR(), { recursive: true });
  newsTagged.loadNewsTagged({ force: true });

  const flashByDate = buildFlashByDate(OOS_FROM);
  const priorityQueue = buildPriorityQueue(flashByDate);

  const priorityHeader = 'date,instrument,priority_score,miss_reason,suggested_tag_type,ag_basis_miss,direction_t1_miss,has_existing_news,flash_policy,flash_geo,pred_dir,actual_dir,failure_mode';
  const priorityLines = [priorityHeader];
  for (const e of priorityQueue) {
    priorityLines.push(
      [
        e.date,
        e.instrumentId,
        e.priority_score,
        e.missReason,
        e.suggested_tag_type,
        e.agBasisMiss ? 1 : 0,
        e.directionMiss ? 1 : 0,
        e.hasExistingNews ? 1 : 0,
        e.flashPolicy ? 1 : 0,
        e.flashGeo ? 1 : 0,
        e.predDir || '',
        e.actualDir || '',
        e.failure_mode || '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  fs.writeFileSync(PRIORITY_CSV(), `${priorityLines.join('\n')}\n`, 'utf8');

  const template = buildUserTemplate(priorityQueue);
  fs.writeFileSync(USER_TEMPLATE_CSV(), template.csv, 'utf8');

  const basisReview = buildAgBasisReview();
  fs.writeFileSync(AG_BASIS_REVIEW_CSV(), basisReview.csv, 'utf8');

  const stats = {
    oosFrom: OOS_FROM,
    topN: TOP_N,
    priorityQueueTotal: priorityQueue.length,
    agBasisMissDays: priorityQueue.filter((e) => e.agBasisMiss).length,
    directionT1MissDays: priorityQueue.filter((e) => e.directionMiss).length,
    overlapDays: priorityQueue.filter((e) => e.agBasisMiss && e.directionMiss).length,
    needsUserInput: priorityQueue.filter((e) => !e.hasExistingNews).length,
    warehouseSuggest: priorityQueue.filter((e) =>
      String(e.failure_mode).includes('warehouse_supply_up'),
    ).length,
    oiProxySuggest: priorityQueue.filter((e) =>
      String(e.failure_mode).includes('oi_proxy_mislabel'),
    ).length,
    flashPolicyFlagged: priorityQueue.filter((e) => e.flashPolicy).length,
    templatePrefilledRows: template.rowCount,
    agBasisReviewRows: basisReview.rowCount,
    paths: {
      priorityCsv: PRIORITY_CSV(),
      userTemplateCsv: USER_TEMPLATE_CSV(),
      agBasisReviewCsv: AG_BASIS_REVIEW_CSV(),
    },
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(BUILD_REPORT(), JSON.stringify(stats, null, 2), 'utf8');
  console.log(JSON.stringify(stats, null, 2));
  return stats;
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  buildPriorityQueue,
  semiAutoTemplateRow,
  suggestRegime,
  PRIORITY_CSV,
  USER_TEMPLATE_CSV,
  AG_BASIS_REVIEW_CSV,
};
