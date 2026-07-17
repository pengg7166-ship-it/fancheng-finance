/**
 * Canonical merge: seeds(58) + user batches 1–8 → news-tagged.csv
 * 用法: node scripts/merge-all-user-news-final.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const newsTagged = require('../services/news-tagged-loader');
const { normalizeTags, normalizeSourceTier } = require('../services/news-tag-normalize');
const {
  dedupeSimilar,
  mergeTags,
  pickRicher,
  titleSimilarity,
  normalizeTitleKey,
} = require('./news-dedupe-utils');

function resolveHistoryDir() {
  const candidates = [
    process.env.FANCHENG_HISTORY_DIR,
    path.join('E:', 'FanchengFinance', 'data', 'history'),
    newsTagged.getHistoryDir(),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'news-tagged.csv.bak-1780708367909'))) return dir;
    if (fs.existsSync(path.join(dir, 'news-tagged.csv'))) return dir;
  }
  return newsTagged.getHistoryDir();
}

const historyDir = resolveHistoryDir();
const SEED_PATH = path.join(historyDir, 'news-tagged.csv.bak-1780708367909');

const BATCH_FILES = [
  { label: 'batch1', path: path.join(historyDir, 'user-news-import.csv') },
  { label: 'batch2', path: path.join(historyDir, 'user-news-batch2.csv') },
  { label: 'batch3', path: path.join(historyDir, 'user-news-batch3.csv') },
  { label: 'batch4', path: path.join(historyDir, 'user-news-batch4.csv') },
  { label: 'batch5', path: path.join(historyDir, 'user-news-batch5.csv') },
  { label: 'batch6', path: path.join(historyDir, 'user-news-batch6.csv') },
  { label: 'batch7', path: path.join(historyDir, 'user-news-batch7.csv') },
  { label: 'batch8', path: path.join(historyDir, 'user-news-batch8.csv') },
  { label: 'au_batch1', path: path.join(historyDir, 'user-au-events-batch1.csv') },
  { label: 'au_batch2', path: path.join(historyDir, 'user-au-events-batch2.csv') },
  { label: 'au_batch3', path: path.join(historyDir, 'user-au-events-batch3.csv') },
  { label: 'au_batch4', path: path.join(historyDir, 'user-au-events-batch4.csv') },
  { label: 'au_batch5', path: path.join(historyDir, 'user-au-events-batch5.csv') },
];

function parseTsvOrCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes('date') && header.includes('title');
  const start = hasHeader ? 1 : 0;
  const cols = hasHeader
    ? header
    : ['date', 'title', 'commodity_tags', 'direction', 'stars', 'source_tier', 'notes'];
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const parts = lines[i].split(delim);
    const row = {};
    for (let j = 0; j < cols.length; j += 1) {
      row[cols[j]] = (parts[j] || '').trim();
    }
    if (!row.date || !row.title) continue;
    rows.push(row);
  }
  return rows;
}

function parseSpecialDate(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4}-\d{2})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[3]}`;
  return s.slice(0, 10);
}

function normalizeRow(raw) {
  const ctx = { title: raw.title, notes: raw.notes || '' };
  let tags = normalizeTags(raw.commodity_tags, ctx);
  // W/XT not in catalog — strip from tags, note preserved in notes
  tags = tags
    .split(';')
    .filter((t) => t && t !== 'w' && t !== 'xt')
    .join(';');
  return {
    date: parseSpecialDate(raw.date),
    title: String(raw.title).trim().replace(/^"|"$/g, ''),
    commodity_tags: tags,
    direction: (raw.direction || 'neutral').toLowerCase(),
    stars: String(Math.max(1, Math.min(5, parseInt(raw.stars, 10) || 3))),
    source_tier: normalizeSourceTier(raw.source_tier),
    event_id: String(raw.event_id || '').trim(),
    notes: String(raw.notes || '').trim(),
  };
}

/** Pre-merge row transforms per batch rules */
function preprocessBatchRows(label, rows) {
  let out = rows.map(normalizeRow);

  if (label === 'batch4') {
    out = out.map((r) => {
      if (r.date === '2023-12-14' && r.title.includes('红海')) {
        return { ...r, date: '2023-12-15', notes: `${r.notes}（首波袭击约2023-12-15）` };
      }
      if (r.date === '2023-08-01' && r.title.includes('远兴')) {
        return { ...r, date: '2023-06-28', notes: `${r.notes}（一线投产日约2023-06-28）` };
      }
      if (r.date === '2025-12-01' && r.title.includes('美联储12月')) {
        return { ...r, date: '2025-12-18', title: '美联储12月第三次降息', notes: r.notes };
      }
      if (r.commodity_tags.includes('PTA')) {
        return { ...r, commodity_tags: r.commodity_tags.replace(/PTA/gi, 'TA') };
      }
      return r;
    });
    // Merge 2026-01-23 futures opening duplicates
    const jan23 = out.filter((r) => r.date === '2026-01-23' && /期货|对外开放|完税|聚酯/.test(r.title));
    if (jan23.length > 1) {
      const merged = jan23.reduce((acc, r) => pickRicher(acc, r), jan23[0]);
      merged.title = '期货市场新增14个特定品种正式实施';
      merged.commodity_tags = mergeTags(
        'lc;ni;pf;pr;px;nr;lu;bc;ta',
        jan23.map((r) => r.commodity_tags).join(';')
      );
      merged.notes =
        '镍/碳酸锂/瓶片/短纤/PX/PTA等全面对外开放，国际化定价深化（合并batch4四条重复）';
      out = out.filter((r) => !jan23.includes(r));
      out.push(merged);
    }
    // Skip LC减产 2025-01-01 — batch2 has 2025-07-15
    out = out.filter((r) => !(r.date === '2025-01-01' && r.title.includes('减产联盟')));
  }

  if (label === 'batch5') {
    out = out.map((r) => {
      if (r.date === '2025-12-12' && r.title.includes('美联储')) {
        return { ...r, date: '2025-12-18', notes: `${r.notes}（FOMC声明日2025-12-18）` };
      }
      if (r.date === '2025-12-24' && r.title.includes('4500')) {
        return {
          ...r,
          notes: `${r.notes}【用户情景价，待核实：2025-12现货金约2650美元/盎司量级】`,
        };
      }
      if (r.date === '2026-01-29') {
        return { ...r, date: '2026-01-29', notes: `${r.notes}（FOMC 2026-01-28/29）` };
      }
      return r;
    });
    // Dedupe 2025-07-01 anti-involution vs seeds/import
    out = out.filter(
      (r) => !(r.date === '2025-07-01' && r.title.includes('反内卷') && r.title.includes('密集'))
    );
  }

  if (label === 'batch6') {
    out = out.map((r) => {
      if (r.date === '2026-03-06-10' || (r.title.includes('108美元') && r.date.startsWith('2026-03'))) {
        if (r.title.includes('108')) {
          return { ...r, date: '2026-03-10', notes: r.notes };
        }
      }
      if (r.date === '2026-03-17' && r.title.includes('FOMC')) {
        return {
          ...r,
          date: '2026-03-18',
          title: '美联储3月FOMC维持利率不变',
          notes: `${r.notes}（FOMC会议2026-03-18/19，声明日3-18）`,
        };
      }
      if (r.date === '2026-02-28' && /哈梅内伊|伊朗|咆哮/.test(r.title + r.notes)) {
        return {
          ...r,
          notes: `${r.notes}【地缘情景/待核实：哈梅内伊遇袭说法未见权威确认，保留用户时间线】`,
        };
      }
      if (r.date === '2026-06-03' && r.notes.includes('4500')) {
        return {
          ...r,
          notes: `${r.notes}【用户情景价，待核实】`,
        };
      }
      if (r.title.includes('战略性矿产') && r.notes.includes('钨')) {
        return {
          ...r,
          notes: `${r.notes}（W/XT无期货合约，仅政策备注）`,
        };
      }
      return r;
    });
    // Merge 2026-06-16 Fed rows into max 3 distinct (already 3 — keep)
  }

  if (label === 'batch7') {
    out = out.map((r) => {
      if (r.date === '2025-09-01' && /美联储9月降息/.test(r.title)) {
        return {
          ...r,
          date: '2025-09-18',
          notes: `${r.notes}（FOMC 2025-09-17声明，利率2025-09-18生效）`,
        };
      }
      if (r.date === '2025-11-01' && /特朗普.*胜选/.test(r.title)) {
        return {
          ...r,
          date: '2024-11-06',
          title: '特朗普胜选',
          notes: `${r.notes}（校正：胜选日2024-11-06，非2025-11-01）`,
        };
      }
      if (r.date === '2026-03-17' && /FOMC|美联储/.test(r.title)) {
        return {
          ...r,
          date: '2026-03-18',
          title: '美联储3月FOMC维持利率不变',
          notes: `${r.notes}（FOMC会议2026-03-18/19，声明日3-18；与batch6合并）`,
        };
      }
      if (r.date === '2026-01-29' && /美联储1月/.test(r.title)) {
        return { ...r, notes: `${r.notes}（FOMC 2026-01-28/29）` };
      }
      if (r.date === '2025-12-24' || (r.notes && r.notes.includes('150%'))) {
        return { ...r, notes: `${r.notes}【白银涨幅150%等待核实，Kitco/Reuters口径不一】` };
      }
      if (r.title.includes('AI') && r.notes.includes('2.9万亿')) {
        return { ...r, notes: `${r.notes}【待核实：2.9万亿美元AI投资规模为行业预测口径】` };
      }
      if (r.date === '2026-03-25' && /铜.*零加工费/.test(r.title)) {
        return {
          ...r,
          notes: `${r.notes}（早于batch6 2026-05-13零加工费阶段，保留双催化剂）`,
        };
      }
      if (r.date === '2026-04-01' && r.title.includes('野村')) {
        return {
          ...r,
          notes: `${r.notes}（早于batch6 2026-05-21野村倒戈，保留预警节点）`,
        };
      }
      if (r.date === '2026-05-10' && r.title.includes('国储')) {
        return {
          ...r,
          notes: `${r.notes}（早于batch6 2026-05-21落地，W/XT无期货合约）`,
        };
      }
      return r;
    });
  }

  if (label === 'au_batch1' || label === 'au_batch2' || label === 'au_batch3' || label === 'au_batch4' || label === 'au_batch5') {
    out = out.map((r) => {
      if (r.date === '2026-02-28' && /伊朗|以色列|strike/i.test(r.title + r.notes)) {
        return { ...r, date: '2026-03-02', notes: `${r.notes}（周末2/28→沪金交易日3/2）` };
      }
      if (r.date === '2023-10-07' && /巴以|以色列|hamas/i.test(r.title + r.notes)) {
        return { ...r, date: '2023-10-09', notes: `${r.notes}（周末10/7→沪金交易日10/9）` };
      }
      if (r.date === '2025-02-01' && /关税|tariff/i.test(r.title + r.notes)) {
        return { ...r, date: '2025-02-03', notes: `${r.notes}（周末2/1→沪金交易日2/3）` };
      }
      if (r.date === '2024-04-13' && /伊朗|以色列/i.test(r.title + r.notes)) {
        return { ...r, date: '2024-04-15', notes: `${r.notes}（周末4/13→沪金交易日4/15）` };
      }
      if (r.date === '2024-11-05' && /特朗普|大选/i.test(r.title + r.notes)) {
        return { ...r, notes: `${r.notes}（胜选日11/5·沪金交易日11/6）` };
      }
      if (r.date === '2026-01-29' && /FOMC|美联储|鹰派暂停/i.test(r.title + r.notes)) {
        return { ...r, notes: `${r.notes}（FOMC 2026-01-28/29·与2026-01-28油金macro_regime_shift并存）` };
      }
      return r;
    });
  }

  if (label === 'batch8') {
    out = out.map((r) => {
      // Fed statement dates (batch8 authoritative)
      if (r.event_id === 'fed_cut_sep2025' || (r.date === '2025-09-17' && /9月.*降息/.test(r.title))) {
        return {
          ...r,
          date: '2025-09-17',
          notes: `${r.notes}（FOMC声明日2025-09-17，利率2025-09-18生效）`,
        };
      }
      if (r.event_id === 'fomc_20260319' || (r.date === '2026-03-19' && /3月.*FOMC/.test(r.title))) {
        return {
          ...r,
          date: '2026-03-19',
          title: '美联储3月FOMC维持利率不变',
          notes: `${r.notes}（校正：FOMC Mar 18–19 2026，声明日3-19）`,
        };
      }
      if (r.event_id === 'fomc_20260429' || (r.date === '2026-04-29' && /4月.*FOMC/.test(r.title))) {
        return {
          ...r,
          date: '2026-04-29',
          title: '美联储4月FOMC维持利率不变',
          notes: `${r.notes}（校正：FOMC Apr 28–29 2026，声明日4-29）`,
        };
      }
      if (r.date === '2026-01-28' && r.event_id === 'fed_pause_jan2026') {
        return { ...r, date: '2026-01-28', notes: `${r.notes}（FOMC Jan 27–28 2026）` };
      }
      // Tariff chain dates
      if (r.date === '2025-04-09' && /34%/.test(r.title + r.notes)) {
        return { ...r, notes: `${r.notes}（对华追加对等关税，24%暂缓）` };
      }
      if (r.date === '2025-05-28' && /CIT|国际贸易法院/.test(r.title)) {
        return { ...r, direction: 'bullish', notes: `${r.notes}（关税司法挑战，阶段性利好贸易预期）` };
      }
      if (r.date === '2026-02-20' && /最高法院|SCOTUS|IEEPA不授权/.test(r.title + r.notes)) {
        return { ...r, direction: 'bullish', notes: `${r.notes}（IEEPA关税违宪，贸易紧张边际缓和）` };
      }
      if (r.date === '2026-02-20' && /第122条|122条/.test(r.title + r.notes)) {
        return { ...r, direction: 'bearish', notes: `${r.notes}（IEEPA终止但122条10%接续，冲击型落地）` };
      }
      // 沁源事故链 — merge notes into canonical title on import
      if (r.date === '2026-05-22' && /沁源|留神峪/.test(r.title + r.notes)) {
        return {
          ...r,
          title: '山西沁源煤矿特大事故及调查升级',
          notes: `${r.notes}（batch8权威：留神峪5·22瓦斯爆炸，与batch5/6/7合并）`,
        };
      }
      if (/shanxi_mine_blast_2026/.test(r.event_id) && r.date !== '2026-05-22') {
        return {
          ...r,
          notes: `${r.notes}（5·22事故链节点，与2026-05-22主行rich-merge）`,
        };
      }
      // Iran dedupe hints
      if (r.date === '2026-06-01' && /伊朗议长|协议须保障/.test(r.title)) {
        return {
          ...r,
          notes: `${r.notes}（与batch7美伊第三轮和谈同日不同角度，均保留）`,
        };
      }
      return r;
    });
    // Skip duplicate 2026-06-02 Hormuz — batch7/batch6 already have
    out = out.filter(
      (r) => !(r.date === '2026-06-02' && /霍尔木兹|海峡通行/.test(r.title + r.notes))
    );
  }

  return out;
}

/** batch4 校正：2025-12-11 用户AU锚点取代 batch1 的 2025-12-10 同 event_id */
function supersedeAuDecCutDate(rows) {
  const removedLog = [];
  const dec10Idx = rows.findIndex((r) => r.date === '2025-12-10' && r.event_id === 'fed_cut_dec2025_au');
  const dec11Idx = rows.findIndex((r) => r.date === '2025-12-11' && r.event_id === 'fed_cut_dec2025_au');
  if (dec10Idx < 0 && dec11Idx < 0) return { rows, removed: 0, removedLog };

  if (dec10Idx >= 0 && dec11Idx >= 0) {
    const merged = { ...pickRicher(rows[dec10Idx], rows[dec11Idx]), date: '2025-12-11' };
    const filtered = rows.filter((_, i) => i !== dec10Idx && i !== dec11Idx);
    filtered.push(merged);
    removedLog.push({
      date: '2025-12-10',
      title: rows[dec10Idx].title,
      reason: 'merged into au_batch4 2025-12-11 FOMC声明日',
    });
    return { rows: filtered, removed: 1, removedLog };
  }

  if (dec10Idx >= 0 && /batch4校正12-11|12-11/.test(rows[dec10Idx].notes || '')) {
    const updated = [...rows];
    updated[dec10Idx] = { ...rows[dec10Idx], date: '2025-12-11' };
    removedLog.push({
      date: '2025-12-10',
      title: rows[dec10Idx].title,
      reason: 'date corrected to 2025-12-11 (au_batch4)',
    });
    return { rows: updated, removed: 0, removedLog };
  }

  return { rows, removed: 0, removedLog };
}

function isAuUserAnchorRow(row) {
  const blob = `${row.notes || ''}${row.event_id || ''}${row.title || ''}`;
  return /用户AU锚点|fomc_hawkish_hold_|fomc_dovish_pivot_|warsh_chair_|_au\b/i.test(blob);
}

/** Drop batch6/7 FOMC rows superseded by batch8 authoritative statement dates */
function dropSupersededFomc(rows) {
  const hasDateTitle = (date, pat) => rows.some((r) => r.date === date && pat.test(r.title));
  const removedLog = [];
  const filtered = rows.filter((r) => {
    if (isAuUserAnchorRow(r)) return true;
    if (
      r.date === '2026-03-18' &&
      /3月.*FOMC|FOMC.*3月|美联储3月/.test(r.title) &&
      hasDateTitle('2026-03-19', /3月.*FOMC|FOMC.*3月|美联储3月/)
    ) {
      removedLog.push({ date: r.date, title: r.title, reason: 'superseded by batch8 2026-03-19 FOMC' });
      return false;
    }
    if (
      r.date === '2026-04-28' &&
      /4月.*FOMC|FOMC.*4月|美联储4月/.test(r.title) &&
      hasDateTitle('2026-04-29', /4月.*FOMC|FOMC.*4月|美联储4月/)
    ) {
      removedLog.push({ date: r.date, title: r.title, reason: 'superseded by batch8 2026-04-29 FOMC' });
      return false;
    }
    return true;
  });
  return { rows: filtered, removed: rows.length - filtered.length, removedLog };
}

function rowsToBatchCsv(rows) {
  const header = 'date,title,commodity_tags,direction,stars,source_tier,event_id,notes';
  const esc = (s) => {
    const v = String(s || '');
    return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [header, ...rows.map((r) =>
    [r.date, esc(r.title), r.commodity_tags, r.direction, r.stars, r.source_tier, r.event_id || '', esc(r.notes)].join(',')
  )].join('\n') + '\n';
}

function main() {
  if (!fs.existsSync(SEED_PATH)) {
    console.error('种子不存在:', SEED_PATH);
    process.exit(1);
  }

  const seeds = newsTagged.parseCsv(fs.readFileSync(SEED_PATH, 'utf8')).map(normalizeRow);
  let allRows = [...seeds];
  const batchCounts = { seeds: seeds.length };

  for (const { label, path: filePath } of BATCH_FILES) {
    if (!fs.existsSync(filePath)) {
      const rawPath = path.join(historyDir, `_batch${label.replace('batch', '')}-raw.tsv`);
      if (fs.existsSync(rawPath)) {
        const raw = fs.readFileSync(rawPath, 'utf8');
        const parsed = preprocessBatchRows(label, parseTsvOrCsv(raw));
        fs.writeFileSync(filePath, rowsToBatchCsv(parsed));
        console.log(`Created ${label} from raw (${parsed.length} rows) → ${filePath}`);
      }
    }
    if (!fs.existsSync(filePath)) {
      console.warn(`跳过 ${label}: ${filePath}`);
      continue;
    }
    const incoming = preprocessBatchRows(label, parseTsvOrCsv(fs.readFileSync(filePath, 'utf8')));
    batchCounts[label] = incoming.length;
    const before = allRows.length;
    for (const row of incoming) {
      let idx = allRows.findIndex((r) => r.date === row.date && r.title === row.title);
      if (idx < 0 && row.event_id) {
        idx = allRows.findIndex((r) => r.event_id && r.event_id === row.event_id);
      }
      if (idx < 0 && /^au_batch/.test(label) && /^fomc_/.test(row.event_id || '')) {
        idx = allRows.findIndex((r) => r.date === row.date && /fomc/i.test(`${r.event_id}${r.title}`));
      }
      if (idx >= 0) {
        allRows[idx] = pickRicher(allRows[idx], row);
      } else {
        allRows.push(row);
      }
    }
    console.log(`${label}: +${allRows.length - before} net (${incoming.length} input)`);
  }

  const { rows: deduped, removed, removedLog } = dedupeSimilar(allRows);
  const auDecDrop = supersedeAuDecCutDate(deduped);
  const fomcDrop = dropSupersededFomc(auDecDrop.rows);
  const finalPreVerify = fomcDrop.rows;
  const totalRemoved = removed + auDecDrop.removed + fomcDrop.removed;
  const allRemovedLog = [...removedLog, ...auDecDrop.removedLog, ...fomcDrop.removedLog];
  const outPath = path.join(historyDir, 'news-tagged.csv');
  fs.writeFileSync(outPath, newsTagged.rowsToCsv(finalPreVerify), 'utf8');
  newsTagged.loadNewsTagged({ force: true });

  const { verifyAndCorrectRows } = require('../services/news-history-verifier');
  const { rows: verified, report, summary } = verifyAndCorrectRows(finalPreVerify);
  fs.writeFileSync(outPath, newsTagged.rowsToCsv(verified), 'utf8');
  fs.writeFileSync(path.join(historyDir, 'news-tagged-verified.csv'), newsTagged.rowsToCsv(verified), 'utf8');
  fs.writeFileSync(
    path.join(historyDir, 'news-verification-report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        inputPath: outPath,
        summary,
        entries: report,
      },
      null,
      2
    ),
    'utf8'
  );
  newsTagged.loadNewsTagged({ force: true });

  console.log(`\nPre-verify merge → ${outPath} (${finalPreVerify.length} rows, deduped ${totalRemoved})`);
  console.log('\nVerify summary:', JSON.stringify(summary, null, 2));

  const mergeReport = {
    batchCounts,
    preVerifyRows: finalPreVerify.length,
    dedupedRemoved: totalRemoved,
    dedupedLog: allRemovedLog,
    finalRows: summary.outputRows,
    verify: summary,
  };
  fs.writeFileSync(path.join(historyDir, 'merge-all-report.json'), JSON.stringify(mergeReport, null, 2));

  // Flash inbox → news-tagged（增量）
  let flashReport = null;
  try {
    const { main: mergeFlash } = require('./merge-flash-into-news');
    console.log('\n--- Flash inbox 合并 ---');
    flashReport = mergeFlash();
    mergeReport.flash = flashReport;
    fs.writeFileSync(path.join(historyDir, 'merge-all-report.json'), JSON.stringify(mergeReport, null, 2));
  } catch (err) {
    console.warn('Flash 合并跳过:', err.message || err);
  }

  return mergeReport;
}

if (require.main === module) {
  main();
}

module.exports = { main, preprocessBatchRows, dedupeSimilar, parseTsvOrCsv, normalizeRow, titleSimilarity, normalizeTitleKey };
