/**
 * 新闻标注 CSV 历史事实校验与修正
 * 依据公开史料核对日期、品种标签、source_tier，输出 verification report
 */
const fs = require('fs');
const path = require('path');
const newsTagged = require('./news-tagged-loader');
const { normalizeTags, normalizeSourceTier } = require('./news-tag-normalize');

/** @typedef {{ row: number, status: 'ok'|'corrected'|'removed'|'added', title: string, oldDate?: string, newDate?: string, field?: string, oldValue?: string, newValue?: string, source: string }} ReportEntry */

/**
 * 按 date|title 或 event_id 匹配的日期修正（newDate 为 null 表示删除行）
 * source: 公开出处简述
 */
const DATE_FIXES = [
  {
    match: { date: '2020-03-16', title: '美联储紧急降息至零' },
    newDate: '2020-03-15',
    source: 'Fed FOMC emergency statement 2020-03-15 (Sunday); funds rate 0–0.25%',
  },
  {
    match: { date: '2020-04-13', title: 'OPEC+史诗级减产' },
    newDate: '2020-04-12',
    source: 'OPEC 10th Extraordinary Ministerial Meeting finalized 9.7mb/d cut on 2020-04-12',
  },
  {
    match: { date: '2022-04-10', title: '印尼棕榈油出口禁令' },
    newDate: '2022-04-28',
    source: 'Indonesia MOT Reg 22/2022; export ban effective 2022-04-28 (announced 2022-04-27)',
  },
  {
    match: { date: '2020-01-12', title: '印尼镍矿出口限制' },
    newDate: '2020-01-01',
    source: 'MEMR Reg 11/2019 effective 2020-01-01; MOT Reg 96/2019',
  },
  {
    match: { date: '2023-10-01', title: '巴以冲突爆发' },
    newDate: '2023-10-07',
    source: 'Hamas Operation Al-Aqsa Flood began 2023-10-07',
  },
  {
    match: { date: '2023-10-01', title: '巴以冲突升级' },
    newDate: '2023-10-07',
    source: 'Hamas-led attack on Israel 2023-10-07; markets reacted Oct 8–9',
  },
  {
    match: { date: '2025-07-15', title: '反内卷政策预期' },
    remove: true,
    source: 'Duplicate of 2025-07-01 中央财经委第六次会议',
  },
  {
    match: { date: '2025-12-12', title: '美联储年内最后一次降息落地' },
    newDate: '2025-12-10',
    source: 'FOMC statement 2025-12-10; Dec 2025 third cut (not Dec 18)',
  },
  {
    match: { date: '2025-12-18', title: '美联储年内最后一次降息落地' },
    remove: true,
    source: 'Duplicate of FOMC 2025-12-10 third cut',
  },
  {
    match: { date: '2025-12-18', title: '美联储12月第三次降息' },
    newDate: '2025-12-10',
    source: 'FOMC statement 2025-12-10 (corrected from 2025-12-18)',
  },
  {
    match: { date: '2025-07-01', title: '反内卷政策预期' },
    remove: true,
    source: 'Duplicate of 中央强调反内卷 2025-07-01 CCFEA 6th meeting',
  },
  {
    match: { date: '2025-07-01', title: '反内卷政策密集落地期启动' },
    remove: true,
    source: 'Merged into 中央强调反内卷、规范无序竞争 2025-07-01',
  },
  {
    match: { date: '2025-12-01', title: '美联储12月第三次降息' },
    remove: true,
    source: 'Duplicate of FOMC 2025-12-10 third 2025 cut',
  },
  {
    match: { date: '2025-09-01', title: '美联储9月降息落地' },
    newDate: '2025-09-18',
    source: 'FOMC statement 2025-09-17; effective 2025-09-18',
  },
  {
    match: { date: '2026-01-29', title: '美联储1月议息会议暂停降息' },
    newDate: '2026-01-28',
    source: 'FOMC Jan 27-28 2026; statement 2026-01-28 held 3.5-3.75%',
  },
  {
    match: { date: '2025-08-15', title: '中国粗钢产量自2020年来首次跌破10亿吨' },
    newDate: '2026-01-19',
    source: 'NBS official 2025 crude steel 9.61亿吨 released 2026-01-19 (not Aug projection)',
  },
  {
    match: { date: '2023-12-14', title: '红海危机爆发' },
    newDate: '2023-12-15',
    source: 'Houthi first major Red Sea attacks mid-Dec 2023',
  },
  {
    match: { date: '2024-01-02', title: '集运欧线期货涨停' },
    newDate: '2024-01-12',
    source: 'EC2404 limit-up amid Red Sea rerouting escalation Jan 2024',
  },
  {
    match: { date: '2023-08-01', title: '远兴能源纯碱一线投产' },
    newDate: '2023-06-28',
    source: 'Yuanxing Energy first natural-alkali line commissioning ~2023-06-28',
  },
  {
    match: { date: '2023-01-01', title: '远兴能源投产预期' },
    remove: true,
    source: 'Superseded by 远兴能源纯碱一线投产 2023-06-28',
  },
  {
    match: { date: '2025-01-01', title: '碳酸锂减产联盟成立' },
    remove: true,
    source: 'Duplicate catalyst; keep 2025-07-15 碳酸锂减产联盟成立',
  },
  {
    match: { date: '2026-03-17', title: '美联储3月FOMC维持利率不变' },
    newDate: '2026-03-18',
    source: 'FOMC meeting Mar 18-19 2026; statement typically day 2',
  },
  {
    match: { date: '2020-01-01', title: '印尼镍矿出口限制' },
    remove: true,
    source: 'Duplicate of 印尼宣布禁止镍矿原矿出口 on 2020-01-01 (MEMR Reg 11/2019)',
  },
  {
    match: { date: '2022-05-01', title: '印度禁止小麦出口' },
    newDate: '2022-05-13',
    source: 'India DGFT Notification 13/2022-23; export ban effective 2022-05-13',
  },
  {
    match: { date: '2022-05-10', title: '印度禁止小麦出口' },
    newDate: '2022-05-13',
    source: 'India DGFT Notification 13/2022-23; export ban effective 2022-05-13',
  },
  {
    match: { date: '2024-09-19', title: '美联储降息50bp' },
    newDate: '2024-09-18',
    source: 'FOMC statement 2024-09-18; first 50bp cut of cycle',
  },
  {
    match: { date: '2024-11-05', title: '特朗普胜选' },
    newDate: '2024-11-06',
    source: 'AP/BBC called 2024 US presidential race for Trump on 2024-11-06',
  },
  {
    match: { date: '2023-11-15', title: '美联储停止加息信号' },
    newDate: '2023-11-01',
    source: 'FOMC 2023-11-01 held target range 5.25–5.50%; skipped hike (pause signal)',
  },
  {
    match: { date: '2022-05-15', title: '印度禁止小麦出口' },
    newDate: '2022-05-13',
    source: 'India DGFT Notification 13/2022-23; export ban effective 2022-05-13',
  },
  {
    match: { date: '2022-07-01', title: '欧盟对俄原油禁运生效' },
    newDate: '2022-12-05',
    source: 'EU seaborne Russian crude embargo effective 2022-12-05 (Council Decision)',
  },
  {
    match: { date: '2023-02-05', title: '土耳其地震影响港口' },
    newDate: '2023-02-06',
    source: 'Turkey-Syria earthquakes main shock 2023-02-06; Ceyhan port disrupted',
  },
  {
    match: { date: '2024-07-20', title: '特朗普枪击事件避险' },
    newDate: '2024-07-13',
    source: 'Trump assassination attempt Butler PA 2024-07-13',
  },
  {
    match: { date: '2024-01-17', title: '红海危机持续发酵' },
    remove: true,
    source: 'Merged into 2023-12-15 红海危机爆发 + 2024-01-12 集运欧线期货涨停',
  },
  {
    match: { date: '2025-04-01', title: '欧盟对华电动车关税落地' },
    remove: true,
    source: 'Duplicate; definitive EU BEV duties effective 2024-10-30 (Reg 2024/2754)',
  },
  {
    match: { date: '2024-06-10', title: '欧盟电动车临时关税' },
    newDate: '2024-07-05',
    source: 'EU provisional BEV countervailing duties effective 2024-07-05 (Reg 2024/1866)',
  },
  {
    match: { date: '2025-09-17', title: '美联储9月降息落地' },
    newDate: '2025-09-18',
    source: 'FOMC statement 2025-09-17; funds rate effective 2025-09-18',
  },
];

/** 标签 / source_tier 字段修正（按 date+title 或 title 子串） */
const FIELD_FIXES = [
  {
    match: { date: '2023-08-24', title: '日本核污水排海' },
    commodity_tags: 'c;fu',
    notes: '福岛核处理水排海；水产/食盐情绪，贵金属关联弱（已剔除 ag）',
    source: 'IAEA/新华社 2023-08-24 排海启动；ag 与事件无直接关联',
  },
  {
    match: { date: '2020-03-15', title: '美联储紧急降息至零' },
    source_tier: 'macro',
    event_id: 'fed_emergency_cut_2020',
    notes: 'FOMC 2020-03-15 紧急降息至 0–0.25% 并启动 QE',
    source: 'Federal Reserve FOMC statement 2020-03-15',
  },
  {
    match: { title: 'OPEC+史诗级减产' },
    source_tier: 'policy',
    notes: 'OPEC+ 2020-04-12 视频会议敲定减产 970 万桶/日，5 月 1 日起执行',
    source: 'OPEC press release 2020-04-12',
  },
  {
    match: { date: '2022-04-28', title: '印尼棕榈油出口禁令' },
    notes: '总统佐科 2022-04-27 宣布，MOT Reg 22/2022 自 2022-04-28 生效',
    source: 'Indonesia Cabinet Secretariat 2022-04-27',
  },
  {
    match: { date: '2020-01-01', title: '印尼宣布禁止镍矿原矿出口' },
    notes: 'MEMR Reg 11/2019 自 2020-01-01 生效，全面禁止镍矿出口',
    source: 'Indonesia ESDM / WTO DS592',
  },
  {
    match: { date: '2020-03-23', title: '美联储无限QE' },
    source_tier: 'macro',
    event_id: 'fed_unlimited_qe_2020',
    notes: 'FOMC 2020-03-23 宣布无上限购债（QE）以支撑市场流动性',
    source: 'Federal Reserve FOMC statement 2020-03-23',
  },
  {
    match: { date: '2022-05-13', title: '印度禁止小麦出口' },
    commodity_tags: 'c',
    notes: '全球小麦供应收紧；强麦WH流动性低，映射至玉米c',
    source: 'India wheat export ban 2022-05-13; WH→c per catalog liquidity',
  },
  {
    match: { date: '2022-09-26', title: '北溪管道爆炸' },
    commodity_tags: 'sc;pg',
    notes: '北溪1/2泄漏 2022-09-26；欧洲天然气危机加剧',
    source: 'Swedish/Danish seismology reports 2022-09-26',
  },
  {
    match: { date: '2024-09-18', title: '美联储降息50bp' },
    event_id: 'fed_cut_50bp_2024',
    notes: 'FOMC 2024-09-18 降息50bp，开启宽松周期',
    source: 'Federal Reserve FOMC statement 2024-09-18',
  },
  {
    match: { date: '2023-11-01', title: '美联储停止加息信号' },
    event_id: 'fed_pause_2023_11',
    notes: 'FOMC 2023-11-01 维持利率不变，紧缩周期暂停',
    source: 'Federal Reserve FOMC statement 2023-11-01',
  },
  {
    match: { date: '2025-07-01', title: '中央强调反内卷、规范无序竞争' },
    commodity_tags: 'FG;ps;jm;lc;SA;rb;hc',
    notes: '中央财经委第六次会议 2025-07-01，反内卷升格为年度治理重点',
    source: 'China Daily 2025-07-14 / Mysteel 2025-07-01',
  },
  {
    match: { date: '2025-12-10', title: '美联储12月第三次降息' },
    event_id: 'fed_cut_dec2025',
    notes: 'FOMC 2025-12-10 降息25bp；年内第三次降息，目标区间 3.5-3.75%',
    source: 'Federal Reserve FOMC statement 2025-12-10',
  },
  {
    match: { date: '2026-01-28', title: '美联储1月议息会议暂停降息' },
    event_id: 'fed_pause_jan2026',
    notes: 'FOMC 2026-01-28 维持利率 3.5-3.75%，2025年三次降息后首次暂停',
    source: 'Federal Reserve FOMC statement 2026-01-28',
  },
  {
    match: { date: '2026-01-19', title: '中国粗钢产量自2020年来首次跌破10亿吨' },
    notes: '国家统计局 2026-01-19：2025年粗钢产量9.61亿吨，同比降4.4%，自2020年来首次低于10亿吨',
    source: 'NBS 2026-01-19 / Caixin / CISA',
  },
  {
    match: { date: '2025-12-24', title: '黄金白银同步创历史新高' },
    notes: 'Kitco/Reuters 2025-12-24：现货黄金盘中突破4500美元/盎司（ATH $4525），白银 $72.7',
    source: 'Kitco 2025-12-24; Reuters spot gold $4525.19',
  },
  {
    match: { titleIncludes: '期货市场新增14个特定品种' },
    title: '期货市场新增14个特定品种对外开放',
    commodity_tags: 'lc;ni;PF;PR;PX;ru;lu;bc;TA',
    event_id: 'china_futures_open_2026',
    notes: 'CSRC 2026-01-23：镍/碳酸锂/瓶片/短纤/PX/PTA/20号胶/低硫燃料油/国际铜等14个品种纳入特定品种',
    source: 'Xinhua/gov.cn 2026-01-23 CSRC specific domestic products expansion',
  },
  {
    match: { date: '2024-08-01', title: '特朗普关税政策冲击' },
    title: '特朗普竞选期关税言论',
    event_id: 'trump_tariff_rhetoric_2024',
    notes: '2024年竞选期贸易摩擦言论，出口需求预期承压（非正式加征）',
    source: '2024 campaign rhetoric vs 2025-02-01 formal tariff policy',
  },
  {
    match: { date: '2025-02-01', title: '特朗普关税政策' },
    event_id: 'trump_tariff_implementation_2025',
    notes: '2025年正式关税/贸易政策落地，全球贸易与需求前景走弱（区别于2024竞选言论）',
    source: '2025 Trump administration trade policy implementation',
  },
  {
    match: { date: '2024-10-30', title: '欧盟对华电动车关税落地' },
    title: '欧盟对华电动车正式关税生效',
    event_id: 'eu_ev_tariff_definitive_2024',
    notes: 'EU Reg 2024/2754 终裁反补贴税自2024-10-30生效，为期5年',
    source: 'EU Commission Implementing Regulation 2024/2754 effective 2024-10-30',
  },
  {
    match: { date: '2024-07-05', title: '欧盟电动车临时关税' },
    event_id: 'eu_ev_tariff_provisional_2024',
    notes: 'EU Reg 2024/1866 临时反补贴税自2024-07-05生效（为期4个月）',
    source: 'EU Commission press release 2024-07-04; provisional duties from 2024-07-05',
  },
  {
    match: { date: '2026-05-22', title: '山西沁源煤矿瓦斯爆炸事故' },
    event_id: 'shanxi_mine_blast_2026',
    notes: '2026-05-22 沁源留神峪煤矿瓦斯爆炸，国务院成立调查组（82人遇难）',
    source: '新华社/人民网 2026-05-22~28',
  },
  {
    match: { titleIncludes: '中央经济工作会议定调深化' },
    title: '中央经济工作会议定调深化反内卷',
    event_id: 'china_anti_involution_cewc_2025',
    notes: '2025年CEWC公报：深入整治内卷式竞争，写入2026年经济工作方向',
    source: '新华社 2025-12-26 中央经济工作会议公报',
  },
];

/** WH（强麦）在俄乌粮价事件中映射为流动性更高的谷物合约 */
const WH_TITLE_PATTERNS = [/俄乌/, /乌克兰/, /黑海.*谷/, /粮食/, /Russia.*Ukraine/i];

/** 缺失的重大历史事件 */
const ADDITIONS = [
  {
    date: '2016-12-09',
    title: '中央经济工作会议强调供给侧结构性改革',
    commodity_tags: 'rb;i;jm;ZC;al',
    direction: 'bullish',
    stars: '4',
    source_tier: 'policy',
    event_id: 'china_supply_side_2016_cewc',
    notes: '2016年CEWC将去产能列为五大任务之首，黑色系供给收缩预期强化',
    source: '新华社 2016-12-09 中央经济工作会议公报',
  },
  {
    date: '2019-09-30',
    title: '非洲猪瘟致生猪存栏见底',
    commodity_tags: 'lh;m',
    direction: 'bullish',
    stars: '5',
    source_tier: 'climate',
    event_id: 'asf_peak_2019',
    notes: 'USDA/MARA：生猪存栏2019Q3见底（约3.07亿头），猪价2019年10月见顶',
    source: 'USDA ERS Amber Waves Feb 2020; MDPI Sustainability 2022',
  },
];

function rowKey(row) {
  return `${row.date}|${row.title}`;
}

function matches(row, match) {
  if (match.date && row.date !== match.date) return false;
  if (match.title && row.title !== match.title) return false;
  if (match.titleIncludes && !String(row.title).includes(match.titleIncludes)) return false;
  if (match.event_id && row.event_id !== match.event_id) return false;
  return true;
}

function normalizeRow(row) {
  const ctx = { title: row.title, notes: row.notes || '' };
  return {
    date: String(row.date).slice(0, 10),
    title: String(row.title).trim(),
    commodity_tags: normalizeTags(row.commodity_tags, ctx),
    direction: (row.direction || 'neutral').toLowerCase(),
    stars: String(Math.max(1, Math.min(5, parseInt(row.stars, 10) || 3))),
    source_tier: normalizeSourceTier(row.source_tier),
    event_id: String(row.event_id || '').trim(),
    notes: String(row.notes || '').trim(),
  };
}

function fixWhTags(row, report, rowNum) {
  if (!row.commodity_tags || !WH_TITLE_PATTERNS.some((p) => p.test(row.title))) return row;
  const tags = row.commodity_tags.split(';').filter((t) => t.toLowerCase() !== 'wh');
  if (!row.commodity_tags.split(';').some((t) => t.toLowerCase() === 'wh')) return row;
  const grain = ['c', 'm', 'y', 'p'];
  for (const g of grain) {
    if (!tags.includes(g)) tags.push(g);
  }
  const newTags = tags.join(';');
  if (newTags !== row.commodity_tags) {
    report.push({
      row: rowNum,
      status: 'corrected',
      title: row.title,
      field: 'commodity_tags',
      oldValue: row.commodity_tags,
      newValue: newTags,
      source: 'WH(强麦)流动性低；俄乌粮价冲击映射至 c;m;y;p',
    });
    row.commodity_tags = newTags;
  }
  return row;
}

/**
 * @param {object[]} rows
 * @param {{ dryRun?: boolean }} opts
 */
function verifyAndCorrectRows(rows, opts = {}) {
  /** @type {ReportEntry[]} */
  const report = [];
  const removed = [];
  let working = rows.map((r, i) => ({ ...normalizeRow(r), _line: i + 2 }));

  // Date fixes & removals
  for (const fix of DATE_FIXES) {
    const idx = working.findIndex((r) => matches(r, fix.match));
    if (idx < 0) continue;
    const row = working[idx];
    if (fix.remove) {
      report.push({
        row: row._line,
        status: 'removed',
        title: row.title,
        oldDate: row.date,
        source: fix.source,
      });
      removed.push(row);
      working.splice(idx, 1);
      continue;
    }
    if (fix.newDate && row.date !== fix.newDate) {
      report.push({
        row: row._line,
        status: 'corrected',
        title: row.title,
        oldDate: row.date,
        newDate: fix.newDate,
        source: fix.source,
      });
      row.date = fix.newDate;
    }
  }

  // Field fixes (after date moves so match keys stay valid)
  for (const fix of FIELD_FIXES) {
    const targets = working.filter((r) => matches(r, fix.match));
    for (const row of targets) {
    for (const field of ['title', 'commodity_tags', 'source_tier', 'notes', 'direction', 'stars', 'event_id']) {
      if (fix[field] == null) continue;
      const oldVal = row[field];
      let newVal = fix[field];
      if (field === 'commodity_tags') {
        newVal = normalizeTags(newVal, { title: row.title, notes: fix.notes || row.notes });
      }
      if (field === 'source_tier') newVal = normalizeSourceTier(newVal);
      if (String(oldVal) !== String(newVal)) {
        report.push({
          row: row._line,
          status: 'corrected',
          title: row.title,
          field,
          oldValue: String(oldVal),
          newValue: String(newVal),
          source: fix.source,
        });
        row[field] = newVal;
      }
    }
    }
  }

  // WH tag mapping
  working = working.map((row) => {
    const copy = { ...row };
    fixWhTags(copy, report, copy._line);
    return copy;
  });

  // Dedupe date+title after date moves
  const seen = new Map();
  const deduped = [];
  for (const row of working) {
    const key = rowKey(row);
    if (seen.has(key)) {
      const prev = seen.get(key);
      report.push({
        row: row._line,
        status: 'removed',
        title: row.title,
        oldDate: row.date,
        source: `Duplicate of row ${prev._line} after date correction`,
      });
      continue;
    }
    seen.set(key, row);
    deduped.push(row);
  }
  working = deduped;

  // Add missing epoch events
  const existingKeys = new Set(working.map(rowKey));
  for (const add of ADDITIONS) {
    const norm = normalizeRow(add);
    const key = rowKey(norm);
    if (existingKeys.has(key)) continue;
    // Skip if same event_id already present on nearby date
    if (add.event_id && working.some((r) => r.event_id === add.event_id)) continue;
  }
  for (const add of ADDITIONS) {
    const norm = normalizeRow(add);
    const key = rowKey(norm);
    if (existingKeys.has(key)) continue;
    if (add.event_id && working.some((r) => r.event_id === add.event_id)) continue;
    working.push({ ...norm, _line: null });
    existingKeys.add(key);
    report.push({
      row: null,
      status: 'added',
      title: norm.title,
      newDate: norm.date,
      source: add.source,
    });
  }

  // Mark unchanged rows (sample only in summary — full ok list optional)
  const correctedTitles = new Set(
    report.filter((e) => e.status !== 'ok').map((e) => e.title)
  );

  const finalRows = working
    .map(({ _line, ...rest }) => rest)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const summary = {
    inputRows: rows.length,
    outputRows: finalRows.length,
    corrected: report.filter((e) => e.status === 'corrected').length,
    removed: report.filter((e) => e.status === 'removed').length,
    added: report.filter((e) => e.status === 'added').length,
    unchanged: finalRows.length - report.filter((e) => e.status === 'added').length,
    correctedTitles: [...correctedTitles],
  };

  return { rows: finalRows, report, summary };
}

function getReportPath() {
  return path.join(newsTagged.getHistoryDir(), 'news-verification-report.json');
}

function getVerifiedPath() {
  return path.join(newsTagged.getHistoryDir(), 'news-tagged-verified.csv');
}

/**
 * 校验 news-tagged.csv → 写 verified + report → 可选替换原文件
 */
function runVerification({ replace = true, dryRun = false } = {}) {
  const inputPath = newsTagged.getNewsTaggedPath();
  const { rows: inputRows } = newsTagged.loadNewsTagged({ force: true });
  const { rows, report, summary } = verifyAndCorrectRows(inputRows);

  const verifiedPath = getVerifiedPath();
  const reportPath = getReportPath();
  const payload = {
    generatedAt: new Date().toISOString(),
    inputPath,
    verifiedPath,
    summary,
    entries: report,
  };

  if (!dryRun) {
    fs.writeFileSync(verifiedPath, newsTagged.rowsToCsv(rows), 'utf8');
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
    if (replace) {
      const taggedPath = newsTagged.getNewsTaggedPath();
      if (fs.existsSync(taggedPath)) {
        fs.copyFileSync(taggedPath, `${taggedPath}.pre-verify-${Date.now()}.bak`);
      }
      fs.copyFileSync(verifiedPath, taggedPath);
      newsTagged.loadNewsTagged({ force: true });
    }
  }

  return { ...payload, rows };
}

module.exports = {
  DATE_FIXES,
  FIELD_FIXES,
  ADDITIONS,
  verifyAndCorrectRows,
  runVerification,
  getReportPath,
  getVerifiedPath,
};
