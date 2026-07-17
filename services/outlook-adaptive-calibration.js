/**
 * 自适应校准 '时代 regime 权重 + 哲学规则反测调参（非静态固化）
 * 市场逻辑一直在变化：反测找原因 '建议调整 '安全应用 / 待用户确'
 */
const fs = require('fs');
const path = require('path');
const eventCalendar = require('./commodity-outlook-event-calendar');
const calibration = require('./commodity-outlook-calibration');

const ADAPTIVE_VERSION = 'v1.32.2';
const PERFORMANCE_GATE_PP = 0.05;
const MACRO_DECOUPLE_DATE = '2026-01-28';

/** 用户可读时代别名 '内部 era id（与 event-calendar BACKTEST_ERAS 对齐'*/
const ADAPTIVE_EPOCH_ALIASES = {
  '2019_trade': '2019',
  '2020_covid': '2020_covid',
  '2021_recovery': '2021',
  '2022_inflation_russia': '2022_hike_ru',
  '2023_recovery': '2023_2024',
  '2025_2026_tariff_iran_decouple': '2025_2026',
};

const EPOCH_LABELS = {
  '2019': '2019 贸易',
  '2020_covid': '2020 疫情',
  '2021': '2021 复苏',
  '2022_hike_ru': '2022 通胀+俄乌',
  '2023_2024': '2023-2024 高利',
  '2025_2026': '2025-2026 关税/伊朗/脱钩',
};

const SECTOR_LABELS = calibration.SECTOR_LABELS || {};

function aliasForEra(eraId) {
  for (const [alias, id] of Object.entries(ADAPTIVE_EPOCH_ALIASES)) {
    if (id === eraId) return alias;
  }
  return eraId;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function getReportJsonPath() {
  const { getDataDir } = require('./data-paths');
  const base = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(base, 'history', 'adaptive-calibration-report.json');
}

function getReportMdPath() {
  return path.join(process.cwd(), 'docs', 'ADAPTIVE_CALIBRATION.md');
}

/**
 * @param {object} summary 'longrun summary (loadLongrunSummary)
 */
function analyzeBacktestFailures(summary) {
  if (!summary) {
    return { ok: false, error: 'longrun 回测摘要', failures: [] };
  }

  const globalHit = summary.overallHitRate ?? 0;
  const gateThreshold = globalHit - PERFORMANCE_GATE_PP;
  const failures = [];

  for (const [eraId, stats] of Object.entries(summary.byEra || {})) {
    const hitRate = stats.hitRate;
    if (hitRate == null) continue;
    const gapPp = +(hitRate - globalHit).toFixed(4);
    if (gapPp < -0.03) {
      failures.push({
        kind: 'era',
        eraId,
        alias: aliasForEra(eraId),
        label: stats.label || EPOCH_LABELS[eraId] || eraId,
        hitRate,
        globalHit,
        gapPp,
        hits: stats.hits,
        total: stats.total,
        severity: hitRate < gateThreshold ? 'high' : 'medium',
        reason:
          hitRate < gateThreshold
            ? `时代命中'${(hitRate * 100).toFixed(1)}% 低于全量 ${(globalHit * 100).toFixed(1)}% 超过 ${PERFORMANCE_GATE_PP * 100}pp，哲学权重应下调`
            : `时代偏弱 ${(gapPp * 100).toFixed(1)}pp，需审视板块分权`,
      });
    }
  }

  for (const [sector, stats] of Object.entries(summary.bySector || {})) {
    const hitRate = stats.hitRate;
    if (hitRate == null) continue;
    const gapPp = +(hitRate - globalHit).toFixed(4);
    if (gapPp < -0.02) {
      failures.push({
        kind: 'sector',
        sector,
        label: SECTOR_LABELS[sector] || sector,
        hitRate,
        globalHit,
        gapPp,
        hits: stats.hits,
        total: stats.total,
        severity: gapPp < -0.04 ? 'high' : 'medium',
        reason: `板块 ${SECTOR_LABELS[sector] || sector} 长周'${(hitRate * 100).toFixed(1)}% 拖累全量`,
      });
    }
  }

  const instruments = (summary.instruments || [])
    .filter((i) => i.hitRate != null && i.total >= 80)
    .sort((a, b) => a.hitRate - b.hitRate)
    .slice(0, 8);
  for (const inst of instruments) {
    if (inst.hitRate >= globalHit - 0.08) continue;
    failures.push({
      kind: 'instrument',
      instrumentId: inst.id,
      name: inst.name,
      sector: inst.sector,
      hitRate: inst.hitRate,
      globalHit,
      gapPp: +(inst.hitRate - globalHit).toFixed(4),
      hits: inst.hits,
      total: inst.total,
      severity: inst.hitRate < 0.48 ? 'high' : 'medium',
      reason: `${inst.name || inst.id} 命中'${(inst.hitRate * 100).toFixed(1)}% 明显低于均值`,
    });
  }

  const matrixWeak = Object.entries(summary.byMatrix || {})
    .filter(([, s]) => s.hitRate != null && s.total >= 100 && s.hitRate < globalHit - 0.1)
    .sort((a, b) => a[1].hitRate - b[1].hitRate);
  for (const [cell, stats] of matrixWeak.slice(0, 3)) {
    failures.push({
      kind: 'matrix',
      matrixCell: cell,
      hitRate: stats.hitRate,
      globalHit,
      gapPp: +(stats.hitRate - globalHit).toFixed(4),
      hits: stats.hits,
      total: stats.total,
      severity: 'high',
      reason: `供需×金融矩阵格'{cell}」仅 ${(stats.hitRate * 100).toFixed(1)}%，哲学锲合规则可能不适配`,
    });
  }

  const precious = summary.bySector?.precious;
  const au = (summary.instruments || []).find((i) => i.id === 'au');
  if (precious?.hitRate != null && precious.hitRate < globalHit - 0.01) {
    failures.push({
      kind: 'philosophy_rule',
      ruleId: 'macro-priced-in-sell-fact',
      sector: 'precious',
      hitRate: precious.hitRate,
      auHitRate: au?.hitRate ?? null,
      severity: 'medium',
      reason:
        '贵金属板块偏弱，买预期卖事实（priced_in）可能对 FOMC/地缘利好过于激进；沪金 AU 命中' +
        (au?.hitRate != null ? ` ${(au.hitRate * 100).toFixed(1)}%` : '偏低'),
    });
  }

  if (summary.periodTo >= MACRO_DECOUPLE_DATE || summary.byEra?.['2025_2026']) {
    failures.push({
      kind: 'philosophy_rule',
      ruleId: 'oil_gold_negative_coupling',
      severity: 'medium',
      reason:
        '2026-01-28 后油金分化（油涨金跌），固定负相关链条失效；应弱化 inflation_oil_drag 对贵金属压制',
      anchorDate: MACRO_DECOUPLE_DATE,
    });
  }

  failures.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
  });

  return {
    ok: true,
    globalHit,
    gateThreshold,
    runAt: summary.runAt,
    periodFrom: summary.periodFrom,
    periodTo: summary.periodTo,
    failures,
  };
}

/**
 * @param {ReturnType<typeof analyzeBacktestFailures>} analysis
 */
function proposeAdjustments(analysis) {
  if (!analysis?.ok) return { adjustments: [], pending: [] };

  const adjustments = [];
  const pending = [];
  const cal = calibration.loadCalibration();
  const globalHit = analysis.globalHit;

  const eraFailures = (analysis.failures || []).filter((f) => f.kind === 'era');
  const worstEra = eraFailures.length
    ? eraFailures.reduce((a, b) => (a.hitRate < b.hitRate ? a : b))
    : null;

  for (const f of analysis.failures) {
    const isWorstEra = worstEra && f.kind === 'era' && f.eraId === worstEra.eraId && f.gapPp < -0.04;
    if (f.kind === 'era' && (f.severity === 'high' || isWorstEra)) {
      const eraId = f.eraId;
      const cur = cal.epochWeights?.[eraId] || {};
      const curPhil = cur.philosophyWeight ?? 0.55;
      const targetPhil = clamp(curPhil - 0.06, 0.42, 0.58);
      const gateMult = clamp(0.82 + (f.hitRate - (globalHit - 0.12)) * 2, 0.78, 0.92);

      adjustments.push({
        id: `epoch-${eraId}-philosophy-gate`,
        epoch: eraId,
        alias: f.alias,
        safe: isWorstEra || f.severity === 'high',
        applied: false,
        delta: {
          epochWeights: {
            [eraId]: {
              philosophyWeight: targetPhil,
              adaptiveWeight: cur.adaptiveWeight ?? 0.28,
              factorWeight: +(1 - targetPhil - (cur.adaptiveWeight ?? 0.28)).toFixed(3),
            },
          },
          adaptiveEpochs: {
            [eraId]: {
              alias: f.alias,
              label: f.label,
              philosophyMultiplier: +gateMult.toFixed(3),
              performanceGateApplied: f.severity === 'high',
              worstEraApplied: !!isWorstEra,
              reason: f.reason,
            },
          },
        },
        reason: `${f.label}：哲学分'${curPhil}'{targetPhil}，乘数'{gateMult.toFixed(2)}'{isWorstEra ? '最差时' : 'performance gate'}）`,
      });
    } else if (f.kind === 'era' && f.severity === 'medium' && !isWorstEra) {
      pending.push({
        id: `epoch-${f.eraId}-review`,
        epoch: f.eraId,
        reason: f.reason,
        suggestion: '建议 walk-forward 子集重跑网格搜索 epoch 权重，暂不自动改',
      });
    } else if (f.kind === 'sector' && f.severity === 'high') {
      pending.push({
        id: `sector-${f.sector}-grid`,
        sector: f.sector,
        reason: f.reason,
        suggestion: `板块 ${f.label} 需单独网格搜索 philosophy/adaptive/factor 三元权重（当'gap ${(f.gapPp * 100).toFixed(1)}pp）`,
      });
    } else if (f.kind === 'philosophy_rule' && f.ruleId === 'macro-priced-in-sell-fact') {
      adjustments.push({
        id: 'precious-priced-in-soften',
        epoch: '2025_2026',
        alias: '2025_2026_tariff_iran_decouple',
        safe: true,
        applied: false,
        delta: {
          adaptiveEpochs: {
            '2025_2026': {
              ruleOverrides: {
                'macro-priced-in-sell-fact': { bullishScoreMult: 0.85, directionFlipThreshold: 0.35 },
              },
            },
            '2023_2024': {
              ruleOverrides: {
                'macro-priced-in-sell-fact': { bullishScoreMult: 0.88 },
              },
            },
          },
        },
        reason: '贵金属 priced_in 卖事实略软化(0.7→0.85)，避免 FOMC 落地后过度翻转',
      });
    } else if (f.kind === 'philosophy_rule' && f.ruleId === 'oil_gold_negative_coupling') {
      adjustments.push({
        id: 'oil-gold-decouple-post-2026',
        epoch: '2025_2026',
        safe: true,
        applied: false,
        delta: {
          adaptiveEpochs: {
            '2025_2026': {
              ruleOverrides: {
                oil_gold_negative_coupling: 0.35,
                oil_gold_decouple_from: MACRO_DECOUPLE_DATE,
              },
            },
          },
        },
        reason: '2026-01-28 后油金脱钩：inflation_oil_drag 压制系数 1.0→0.35',
      });
    } else if (f.kind === 'instrument') {
      pending.push({
        id: `inst-${f.instrumentId}`,
        instrumentId: f.instrumentId,
        reason: f.reason,
        suggestion: '单品种阈值/流动性标记需人工确认，不自动改写',
      });
    } else if (f.kind === 'matrix') {
      pending.push({
        id: `matrix-${f.matrixCell}`,
        reason: f.reason,
        suggestion: '矩阵格观望规则或主矛盾阈值需哲学层单独验',
      });
    }
  }

  return { adjustments, pending, version: ADAPTIVE_VERSION };
}

function deepMergeEpochPatch(target, patch) {
  const out = { ...target };
  for (const [eraId, entry] of Object.entries(patch || {})) {
    out[eraId] = {
      ...(out[eraId] || {}),
      ...entry,
      ruleOverrides: {
        ...(out[eraId]?.ruleOverrides || {}),
        ...(entry.ruleOverrides || {}),
      },
      sectorOverrides: {
        ...(out[eraId]?.sectorOverrides || {}),
        ...(entry.sectorOverrides || {}),
      },
    };
  }
  return out;
}

/**
 * @param {string} epoch 'era id or alias
 * @param {object} adjustments 'merged delta from proposeAdjustments
 * @param {{ dryRun?: boolean }} opts
 */
function applyEpochPatch(epoch, adjustments, opts = {}) {
  const eraId = ADAPTIVE_EPOCH_ALIASES[epoch] || epoch;
  const cal = calibration.loadCalibration(true);
  const now = new Date().toISOString();

  const epochWeightPatch = adjustments.epochWeights?.[eraId] || adjustments.epochWeights || {};
  const adaptivePatch = adjustments.adaptiveEpochs?.[eraId] || adjustments.adaptiveEpochs || {};

  const nextEpochWeights = {
    ...(cal.epochWeights || {}),
    [eraId]: {
      ...(cal.epochWeights?.[eraId] || {}),
      ...epochWeightPatch,
      label: cal.epochWeights?.[eraId]?.label || EPOCH_LABELS[eraId],
      updatedAt: now,
    },
  };

  const nextAdaptiveEpochs = deepMergeEpochPatch(cal.adaptiveEpochs || {}, {
    [eraId]: {
      ...adaptivePatch,
      alias: adaptivePatch.alias || aliasForEra(eraId),
      label: adaptivePatch.label || EPOCH_LABELS[eraId],
      lastPatchedAt: now,
    },
  });

  const patch = {
    epochWeights: nextEpochWeights,
    adaptiveEpochs: nextAdaptiveEpochs,
    adaptiveMeta: {
      version: ADAPTIVE_VERSION,
      lastRecalibratedAt: now.slice(0, 10),
      lastRecalibratedIso: now,
      performanceGatePp: PERFORMANCE_GATE_PP,
    },
  };

  if (opts.dryRun) return { ...cal, ...patch };

  return calibration.saveCalibration(patch);
}

function mergeAdjustmentDeltas(adjustments) {
  const merged = { epochWeights: {}, adaptiveEpochs: {} };
  for (const adj of adjustments) {
    if (!adj.safe) continue;
    for (const [eraId, ew] of Object.entries(adj.delta?.epochWeights || {})) {
      merged.epochWeights[eraId] = { ...(merged.epochWeights[eraId] || {}), ...ew };
    }
    merged.adaptiveEpochs = deepMergeEpochPatch(merged.adaptiveEpochs, adj.delta?.adaptiveEpochs || {});
  }
  return merged;
}

function applySafeAdjustments(proposal) {
  const safe = (proposal.adjustments || []).filter((a) => a.safe);
  const merged = mergeAdjustmentDeltas(safe);
  const cal = calibration.loadCalibration(true);
  const now = new Date().toISOString();

  const next = calibration.saveCalibration({
    epochWeights: { ...(cal.epochWeights || {}), ...merged.epochWeights },
    adaptiveEpochs: deepMergeEpochPatch(cal.adaptiveEpochs || {}, merged.adaptiveEpochs),
    adaptiveMeta: {
      version: ADAPTIVE_VERSION,
      lastRecalibratedAt: now.slice(0, 10),
      lastRecalibratedIso: now,
      performanceGatePp: PERFORMANCE_GATE_PP,
      appliedAdjustmentIds: safe.map((a) => a.id),
    },
  });

  for (const adj of safe) adj.applied = true;
  return { calibration: next, applied: safe };
}

function getOilGoldCouplingScale(date) {
  const d = String(date || '').slice(0, 10);
  if (d < MACRO_DECOUPLE_DATE) return 1;
  const cal = calibration.loadCalibration();
  const eraId = eventCalendar.classifyEpoch(d);
  const override =
    cal.adaptiveEpochs?.[eraId]?.ruleOverrides?.oil_gold_negative_coupling ??
    cal.adaptiveEpochs?.['2025_2026']?.ruleOverrides?.oil_gold_negative_coupling;
  return override != null ? Number(override) : 0.35;
}

function getPricedInOverride(sector, date) {
  const eraId = eventCalendar.classifyEpoch(date || new Date().toISOString().slice(0, 10));
  const cal = calibration.loadCalibration();
  const rules = cal.adaptiveEpochs?.[eraId]?.ruleOverrides || {};
  return rules['macro-priced-in-sell-fact'] || null;
}

function buildMarkdownReport({ analysis, proposal, applied }) {
  const lines = [];
  const gh = analysis.globalHit != null ? `${(analysis.globalHit * 100).toFixed(1)}%` : '';
  lines.push('# 自适应校准报告');
  lines.push('');
  lines.push(`> 生成'{new Date().toISOString().slice(0, 19).replace('T', ' ')} · 版本 ${ADAPTIVE_VERSION}`);
  lines.push('');
  lines.push('## 本次命中');
  lines.push('');
  lines.push(`| 指标 | 数'|`);
  lines.push(`|------|------|`);
  lines.push(`| 全量 longrun | **${gh}** |`);
  lines.push(`| 回测区间 | ${analysis.periodFrom || ''} '${analysis.periodTo || ''} |`);
  lines.push(`| 回测时间 | ${analysis.runAt ? analysis.runAt.slice(0, 10) : ''} |`);
  lines.push(`| Performance gate | 时代 < 全量 '${PERFORMANCE_GATE_PP * 100}pp |`);
  lines.push('');

  lines.push('## 拖累板块 / 时代');
  lines.push('');
  const drag = (analysis.failures || []).filter((f) => f.kind === 'era' || f.kind === 'sector');
  if (!drag.length) {
    lines.push('无明显时段/板块拖累');
  } else {
    for (const f of drag) {
      const name = f.label || f.sector || f.eraId;
      const hr = f.hitRate != null ? `${(f.hitRate * 100).toFixed(1)}%` : '';
      const gap = f.gapPp != null ? `${(f.gapPp * 100).toFixed(1)}pp` : '';
      lines.push(`- **${name}** ${hr}'{gap}）'${f.reason}`);
    }
  }
  lines.push('');

  lines.push('## 原因分析');
  lines.push('');
  const rules = (analysis.failures || []).filter((f) => f.kind === 'philosophy_rule' || f.kind === 'matrix');
  for (const f of rules) {
    lines.push(`- ${f.reason}`);
  }
  const inst = (analysis.failures || []).filter((f) => f.kind === 'instrument').slice(0, 5);
  if (inst.length) {
    lines.push('');
    lines.push('**拖累品种（样本≥80）**');
    for (const f of inst) {
      lines.push(`- ${f.name || f.instrumentId} ${(f.hitRate * 100).toFixed(1)}%`);
    }
  }
  lines.push('');

  lines.push('## 建议调整');
  lines.push('');
  for (const adj of proposal.adjustments || []) {
    const tag = adj.safe ? '可安全应' : '需谨慎';
    lines.push(`- [${tag}] **${adj.id}**'{adj.reason}`);
  }
  for (const p of proposal.pending || []) {
    lines.push(`- [待确认] **${p.id}**'{p.suggestion}`);
  }
  lines.push('');

  lines.push('## 已应用 / 待确认');
  lines.push('');
  const appliedList = (applied?.applied || []).filter((a) => a.applied);
  if (appliedList.length) {
    lines.push('### 已自动应用（安全项）');
    for (const a of appliedList) {
      lines.push(`- '${a.id}'{a.reason}`);
    }
  } else {
    lines.push('### 已自动应');
    lines.push('- （本次无安全项写入，dry-run）');
  }
  lines.push('');
  if ((proposal.pending || []).length) {
    lines.push('### 待用户确');
    for (const p of proposal.pending) {
      lines.push(`- '${p.id}'{p.suggestion}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('*反测时找原因并调整；避免一套逻辑用到底*');
  return lines.join('\n');
}

function writeReports(report) {
  const jsonPath = getReportJsonPath();
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const mdPath = getReportMdPath();
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, report.markdown || buildMarkdownReport(report), 'utf8');

  return { jsonPath, mdPath };
}

module.exports = {
  ADAPTIVE_VERSION,
  ADAPTIVE_EPOCH_ALIASES,
  EPOCH_LABELS,
  PERFORMANCE_GATE_PP,
  MACRO_DECOUPLE_DATE,
  analyzeBacktestFailures,
  proposeAdjustments,
  applyEpochPatch,
  applySafeAdjustments,
  mergeAdjustmentDeltas,
  getOilGoldCouplingScale,
  getPricedInOverride,
  buildMarkdownReport,
  writeReports,
  getReportJsonPath,
  getReportMdPath,
  aliasForEra,
};
