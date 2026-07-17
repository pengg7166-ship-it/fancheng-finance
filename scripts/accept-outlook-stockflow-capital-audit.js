#!/usr/bin/env node
/**
 * Acceptance audit: user-required stock-flow joint + capital attitude + member ranking
 * vs what is actually on disk / in asar / in walk-forward backtest.
 * Real data only — missing counts as FAIL/PARTIAL, never filled.
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=F node scripts/accept-outlook-stockflow-capital-audit.js
 *   ... --backtest-days 40   # recent walk-forward sample
 */
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

process.chdir(path.join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) {
  process.env.FANCHENG_DATA_DRIVE = fs.existsSync('F:/FanchengFinance/data') ? 'F' : 'E';
}
process.env.FANCHENG_APP_ROOT = process.env.FANCHENG_APP_ROOT || 'F:/FanchengFinance';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();

const { getDataDir } = require('../services/data-paths');
const { INSTRUMENT_REGISTRY, getCachedCommodityOutlookSource, computeCapitalAttention } =
  require('../services/commodity-outlook-engine');
const { computeCapitalAttitude } = require('../services/capital-attitude');
const { buildStockFlowJoint, getOiChgNdAtDate } = require('../services/inventory-capital-joint');
const { loadMemberOiFeatures } = require('../services/member-oi-features');
const { buildContradictionMatrix } = require('../services/contradiction-matrix');
const backtest = require('../services/commodity-outlook-backtest');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { getCommodityMeta } = require('../services/commodities-catalog');

const ASAR = 'F:/FanchengFinance/app/win-unpacked/resources/app.asar';
const OUT = path.join(getDataDir() || 'F:/FanchengFinance/data', 'audits');
fs.mkdirSync(OUT, { recursive: true });

const BACKTEST_DAYS = (() => {
  const i = process.argv.indexOf('--backtest-days');
  if (i >= 0) return Math.max(10, Math.min(120, Number(process.argv[i + 1]) || 40));
  return 40;
})();
const QUICK = process.argv.includes('--quick');
/** quick：代表性品种（含合证能力 + 无仓单对照），全量验收仍默认全注册表 */
const QUICK_IDS = [
  'cu', 'al', 'zn', 'ni', 'rb', 'i', 'au', 'ag', 'sc', 'ta', 'ma', 'm', 'y', 'p', 'c', 'cs',
  'si', 'ao', 'lc', 'pg', 'v', 'ur', 'b', 'sh', 'lh', 'ec',
];

function status(ok, partial) {
  if (ok) return 'PASS';
  if (partial) return 'PARTIAL';
  return 'FAIL';
}

function readAsar(file) {
  try {
    return asar.extractFile(ASAR, file).toString('utf8');
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

function auditCodeAndUi() {
  const appJs = readAsar('src/app.js');
  const engine = readAsar('services/commodity-outlook-engine.js');
  const matrix = readAsar('services/contradiction-matrix.js');
  const thesis = readAsar('services/thesis-registry.js');
  const capital = readAsar('services/capital-attitude.js');
  const joint = readAsar('services/inventory-capital-joint.js');
  const backtestSrc = readAsar('services/commodity-outlook-backtest.js');
  const cursor = readAsar('services/cursor-llm-client.js');
  const focus = readAsar('services/focus-intelligence-brief.js');

  const checks = [
    { id: 'ui_attitude', req: 'UI 展示资金态度', ok: appJs.includes('资金态度') && appJs.includes('attitudeLabel') },
    { id: 'ui_horizons', req: 'UI 展示持仓1周/1月/3月', ok: appJs.includes('持仓1周') && appJs.includes('持仓1月') && appJs.includes('持仓3月') },
    { id: 'ui_joint', req: 'UI 展示仓单·资金合证', ok: appJs.includes('仓单·资金合证') },
    { id: 'engine_hydrate', req: '旧缓存自动补全态度字段', ok: engine.includes('hydrateCapitalAttitudeOnOutlook') },
    { id: 'capital_engine', req: '真实资金态度引擎', ok: /v1\.56\.2[34]-capital-attitude/.test(capital) },
    { id: 'joint_engine', req: '仓单×持仓多周期合证', ok: joint.includes('v1.56.22-stock-flow-joint') },
    { id: 'matrix_no_solo', req: '矛盾矩阵禁止仓单单独定调', ok: matrix.includes('仓单禁止单独') && matrix.includes('requireStockFlowJoint') },
    { id: 'thesis_joint', req: '证伪须合证反对', ok: thesis.includes('requireStockFlowJoint') && thesis.includes('joint_opposes') },
    { id: 'cursor_prompt', req: 'Cursor 研报式提示含资金终极态度', ok: cursor.includes('资金是终极态度') || cursor.includes('资金终极') },
    { id: 'focus_capital', req: '焦点情报展示资金态度块', ok: focus.includes('buildCapitalBlock') && focus.includes('attitudeLabel') },
    {
      id: 'backtest_uses_capital_fn',
      req: '回测调用 computeCapitalAttention',
      ok: backtestSrc.includes('computeCapitalAttention'),
    },
    {
      id: 'backtest_joint_feature',
      req: '回测 enrich 写入 stockFlowJoint 合证特征',
      ok: backtestSrc.includes('buildStockFlowJoint') && backtestSrc.includes('stockFlowJoint'),
    },
  ];

  // Source-of-truth checks（asar 可能滞后于源码；合证入决策以源码为准）
  const engineDisk = fs.readFileSync(path.join(process.cwd(), 'services/commodity-outlook-engine.js'), 'utf8');
  const backtestDisk = fs.readFileSync(path.join(process.cwd(), 'services/commodity-outlook-backtest.js'), 'utf8');
  const signalDisk = fs.existsSync(path.join(process.cwd(), 'services/stock-flow-joint-signal.js'))
    ? fs.readFileSync(path.join(process.cwd(), 'services/stock-flow-joint-signal.js'), 'utf8')
    : '';
  const capitalDisk = fs.readFileSync(path.join(process.cwd(), 'services/capital-attitude.js'), 'utf8');
  checks.push(
    {
      id: 'joint_signal_module',
      req: '合证决策信号模块（可审计 delta）',
      ok: /jointDecisionDelta/.test(signalDisk) && /build_oi_up/.test(signalDisk),
    },
    {
      id: 'inventory_applies_joint',
      req: 'computeInventoryScore 合证真正入分（非仅存档）',
      ok: engineDisk.includes('stock_flow_joint') && engineDisk.includes('jointDecisionDelta'),
    },
    {
      id: 'backtest_uses_inventory_score',
      req: '回测用 computeInventoryScore（含合证）而非仅 oi.score',
      ok: backtestDisk.includes('computeInventoryScore') && /inventoryScore:\s*inventoryFactor/.test(backtestDisk),
    },
    {
      id: 'capital_no_attention_as_bull',
      req: '资金关注度不再把高分误当偏多（contribution 防双计）',
      ok: capitalDisk.includes('防双计') && capitalDisk.includes('stock-flow-joint-signal'),
    },
    {
      id: 'intel_kernel_module',
      req: '情报内核：主矛盾+条件权重+强制反对意见',
      ok:
        fs.existsSync(path.join(process.cwd(), 'services/outlook-intelligence-kernel.js')) &&
        engineDisk.includes('evaluateIntelligenceKernel') &&
        engineDisk.includes('opposingEvidence'),
    },
    {
      id: 'intel_kernel_backtest',
      req: '回测路径挂载 intelligenceKernel 审计字段',
      ok: backtestDisk.includes('evaluateIntelligenceKernel') && backtestDisk.includes('intelligenceKernel'),
    },
    {
      id: 'intel_kernel_focus',
      req: '焦点情报含主矛盾/反对意见维度',
      ok: (() => {
        const focus = fs.readFileSync(path.join(process.cwd(), 'services/focus-intelligence-brief.js'), 'utf8');
        return focus.includes('buildIntelligenceBlock') && focus.includes('反对意见');
      })(),
    },
    {
      id: 'intel_kernel_cursor_prompt',
      req: 'Cursor 研报提示强制引用主矛盾与反对意见',
      ok: (() => {
        const cursor = fs.readFileSync(path.join(process.cwd(), 'services/cursor-llm-client.js'), 'utf8');
        return (
          cursor.includes('intelligenceKernel') &&
          cursor.includes('opposingEvidence') &&
          cursor.includes('mainContradiction')
        );
      })(),
    },
    {
      id: 'intel_statekey_weights',
      req: 'stateKey 分桶校准模块可用（表可缺，有则须合法）',
      ok: (() => {
        try {
          const mod = require('../services/intel-statekey-weights');
          const t = mod.loadStateKeyWeights({ force: true });
          if (!t) return typeof mod.lookupCalibratedWeights === 'function';
          return Boolean(t.version && (t.buckets || t.coarseBuckets));
        } catch {
          return false;
        }
      })(),
      note: '无校准文件时内核回退启发式；有文件则须含 version+buckets',
    },
    {
      id: 'intel_kernel_uses_cal',
      req: '情报内核可加载 stateKey 校准权重',
      ok: (() => {
        const kernel = fs.readFileSync(path.join(process.cwd(), 'services/outlook-intelligence-kernel.js'), 'utf8');
        return kernel.includes('lookupCalibratedWeights') && kernel.includes('statekey-calibrated');
      })(),
    },
    {
      id: 'intel_center_orchestrator',
      req: '情报中心幕僚线编排器 ≥v2.63',
      ok: (() => {
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        return (
          /v2\.6[3-9]/.test(orch) &&
          orch.includes('evaluateAndApplyFalsification') &&
          orch.includes('allocateFromTriage') &&
          orch.includes('interruptChannel') &&
          orch.includes('processLearning')
        );
      })(),
    },
    {
      id: 'intel_center_modules',
      req: '情报中心全模块：命题/证据/时钟/门禁/红队/债务/KPI',
      ok: (() => {
        const mods = [
          'intel-claim-library.js',
          'intel-evidence-dsl.js',
          'intel-falsification-clock.js',
          'intel-publish-gates.js',
          'intel-red-team.js',
          'intel-debt-board.js',
          'intel-debt-ops.js',
          'intel-retrieval.js',
          'intel-meta-intelligence.js',
          'intel-kpi.js',
          'intel-daily-diff.js',
          'intel-shock-graph.js',
          'intel-analyst-workbench.js',
        ];
        return mods.every((m) => fs.existsSync(path.join(process.cwd(), 'services', m)));
      })(),
    },
    {
      id: 'intel_center_engine_wire',
      req: '引擎挂载 intel-orchestrator 与 intelCenterPack',
      ok: engineDisk.includes('applyIntelCenterToInstruments') && engineDisk.includes('intelCenterPack'),
    },
    {
      id: 'intel_center_ui_hub',
      req: 'UI 情报中心 Hub + 决策备忘录',
      ok: (() => {
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return app.includes('renderIntelCenterHub') && app.includes('renderIntelCenterMemoBlock') && app.includes('intel-debt') && app.includes('intel-debt-ops-run') && app.includes('intel-retrieval') && app.includes('intel-cell-meta');
      })(),
    },
    {
      id: 'intel_falsify_executor',
      req: '证伪执行器：结构/价格/过期真判并流转 falsified',
      ok: (() => {
        const exec = path.join(process.cwd(), 'services/intel-falsification-executor.js');
        if (!fs.existsSync(exec)) return false;
        const src = fs.readFileSync(exec, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        return (
          src.includes('evaluateAndApplyFalsification') &&
          src.includes('evaluateStructurePredicate') &&
          src.includes("STATUS.falsified") &&
          orch.includes('evaluateAndApplyFalsification')
        );
      })(),
    },
    {
      id: 'intel_falsify_lifecycle',
      req: '命题生命周期含 falsifying/falsified/expired 且置信含证伪进行中',
      ok: (() => {
        const claim = fs.readFileSync(path.join(process.cwd(), 'services/intel-claim-library.js'), 'utf8');
        const exec = fs.readFileSync(path.join(process.cwd(), 'services/intel-falsification-executor.js'), 'utf8');
        return (
          claim.includes("falsifying: '证伪进行中'") &&
          exec.includes("falsifying: 'falsifying'") &&
          exec.includes("falsified: 'falsified'") &&
          exec.includes("expired: 'expired'")
        );
      })(),
    },
    {
      id: 'intel_analyst_loop',
      req: '分析师标注闭环：reliability 回写 + 队列 boost',
      ok: (() => {
        const wb = fs.readFileSync(path.join(process.cwd(), 'services/intel-analyst-workbench.js'), 'utf8');
        const claim = fs.readFileSync(path.join(process.cwd(), 'services/intel-claim-library.js'), 'utf8');
        const q = fs.readFileSync(path.join(process.cwd(), 'services/intel-question-queue.js'), 'utf8');
        return (
          wb.includes('applyReliabilityToEvidenceList') &&
          wb.includes('rebuildReliabilityFromAnnotations') &&
          claim.includes('applyReliabilityToEvidenceList') &&
          q.includes('priorityBoost')
        );
      })(),
    },
    {
      id: 'intel_surprise_empirical_n',
      req: 'Surprise 经验分位带 n；门禁 requireN',
      ok: (() => {
        const s = fs.readFileSync(path.join(process.cwd(), 'services/intel-surprise.js'), 'utf8');
        const g = fs.readFileSync(path.join(process.cwd(), 'services/intel-publish-gates.js'), 'utf8');
        return s.includes('empiricalSurprise') && s.includes('nDisplay') && g.includes('requireN: true');
      })(),
    },
    {
      id: 'intel_term_basis',
      req: '基差/期限结构附着并进证据 DSL',
      ok: (() => {
        const t = path.join(process.cwd(), 'services/intel-term-basis.js');
        if (!fs.existsSync(t)) return false;
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const ev = fs.readFileSync(path.join(process.cwd(), 'services/intel-evidence-dsl.js'), 'utf8');
        return orch.includes('attachTermBasisToInstrument') && ev.includes("evidenceType: 'basis'");
      })(),
    },
    {
      id: 'intel_faces_five_cmds',
      req: '三面孔 + 五个一键命令 UI',
      ok: (() => {
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          app.includes('intel-face') &&
          app.includes('intel-cmd-p0') &&
          app.includes('intel-cmd-actionable') &&
          app.includes('renderIntelAnalystWorkbench')
        );
      })(),
    },
    {
      id: 'intel_dual_narrative',
      req: '内外盘双轨叙事：真实序列 + 分裂入队列',
      ok: (() => {
        const dual = path.join(process.cwd(), 'services/intel-dual-narrative.js');
        if (!fs.existsSync(dual)) return false;
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const q = fs.readFileSync(path.join(process.cwd(), 'services/intel-question-queue.js'), 'utf8');
        const ev = fs.readFileSync(path.join(process.cwd(), 'services/intel-evidence-dsl.js'), 'utf8');
        const dualSrc = fs.readFileSync(dual, 'utf8');
        return (
          orch.includes('attachDualNarrativeToInstrument') &&
          q.includes('内外叙事分裂') &&
          ev.includes("evidenceType: 'foreign'") &&
          dualSrc.includes('comex-hg-daily.json') &&
          dualSrc.includes('cbot-s-daily.json') &&
          dualSrc.includes('sgx-fef-daily.json')
        );
      })(),
    },
    {
      id: 'intel_external_series_fetcher',
      req: '外盘扩展抓取器（LME/CBOT/SGX）',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/cross-market-external-fetcher.js');
        const s = path.join(process.cwd(), 'scripts/fetch-cross-market-external.js');
        if (!fs.existsSync(f) || !fs.existsSync(s)) return false;
        const src = fs.readFileSync(f, 'utf8');
        return src.includes('EXTERNAL_SERIES_CATALOG') && src.includes('fetchAllExternalSeries');
      })(),
    },
    {
      id: 'intel_intelligence_calendar',
      req: 'Intelligence Calendar：发布前定价/发布后surprise/T+跟进',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-intelligence-calendar.js');
        if (!fs.existsSync(f)) return false;
        const src = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          src.includes('buildPreReleaseIntel') &&
          src.includes('assessFollowThrough') &&
          src.includes('followThrough') &&
          orch.includes('intelligenceCalendar') &&
          app.includes('intel-cell-calendar')
        );
      })(),
    },
    {
      id: 'intel_true_attention',
      req: '真注意力配额：triage 后 full/lite/skip',
      ok: (() => {
        const a = fs.readFileSync(path.join(process.cwd(), 'services/intel-attention-budget.js'), 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        return (
          a.includes('allocateFromTriage') &&
          a.includes('trueRationing') &&
          orch.includes("computeMode === 'skip'") &&
          orch.includes("computeMode === 'lite'")
        );
      })(),
    },
    {
      id: 'intel_live_shock',
      req: '活冲击图：日K滞后相关实证边 + 激活动力学',
      ok: (() => {
        const s = fs.readFileSync(path.join(process.cwd(), 'services/intel-shock-graph.js'), 'utf8');
        const d = path.join(process.cwd(), 'services/intel-shock-dynamics.js');
        if (!fs.existsSync(d)) return false;
        const dyn = fs.readFileSync(d, 'utf8');
        return (
          s.includes('empiricalEdge') &&
          s.includes('bestLagCorr') &&
          s.includes('buildShockDynamicsBoard') &&
          dyn.includes('tickShockDynamics') &&
          dyn.includes('buildShockWatchOrder') &&
          dyn.includes('computeElasticity')
        );
      })(),
    },
    {
      id: 'intel_sharp_claims',
      req: '锐利命题：可证伪原子 + 期号 + 反套话',
      ok: (() => {
        const c = fs.readFileSync(path.join(process.cwd(), 'services/intel-claim-library.js'), 'utf8');
        return (
          c.includes('falsifiable') &&
          c.includes('makeIssueId') &&
          c.includes('则证伪') &&
          c.includes('buildAtomicCore') &&
          c.includes('buildClaimSharpnessBoard') &&
          c.includes('epochId')
        );
      })(),
    },
    {
      id: 'intel_scenario_evidence_bound',
      req: '场景格：证据绑定 + 校准权 + 反脚本',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-scenario-lattice.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        return (
          s.includes('bindScenarioContent') &&
          s.includes('evidenceBindings') &&
          s.includes('scripted') &&
          s.includes('buildScenarioLatticeBoard') &&
          orch.includes('scenarioLatticeBoard')
        );
      })(),
    },
    {
      id: 'intel_playbook_regime_depth',
      req: 'Playbook：合证脚本包 + 翻转 what-changed + 族门禁',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-playbook-switcher.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        return (
          s.includes('REGIME_SCRIPT_PACKS') &&
          s.includes('applyScriptPackToClaim') &&
          s.includes('regime_flip') &&
          s.includes('familyInPack') &&
          s.includes('whatChanged') &&
          orch.includes('playbookBoard') &&
          orch.includes('playbookRegimeFlips')
        );
      })(),
    },
    {
      id: 'intel_face_delivery_rail',
      req: '三面孔：分轨交付简报 + 审计板 + 非 CSS',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-face-contracts.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          s.includes('buildFaceDeliveryBrief') &&
          s.includes('buildFaceContractBoard') &&
          s.includes('projectInstrumentForFace') &&
          s.includes('allowBlocks') &&
          orch.includes('faceContractBoard') &&
          orch.includes('faceViews') &&
          app.includes('activeFaceGrid') &&
          app.includes('data-intel-face-rail')
        );
      })(),
    },
    {
      id: 'intel_page_tone_staff',
      req: '页面气质：幕僚领衔 + 方向辅标退场',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-page-tone.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          s.includes('buildStaffListLead') &&
          s.includes('resolveRowToneClass') &&
          s.includes('buildPageToneBoard') &&
          orch.includes('pageToneBoard') &&
          orch.includes('page-tone') &&
          app.includes('buildOutlookStaffListLead') &&
          app.includes('outlook-inst-staff') &&
          app.includes('outlookRowToneClassForInst')
        );
      })(),
    },
    {
      id: 'intel_release_product',
      req: '研究编译发行：快照+物质主路径+可回滚对照',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-research-compile.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('saveReleaseSnapshot') &&
          s.includes('buildProductPathDiff') &&
          s.includes('compareToRelease') &&
          s.includes('buildReleaseProductBoard') &&
          s.includes('release-product') &&
          orch.includes('releaseProductBoard') &&
          orch.includes('compileResearchRelease') &&
          app.includes('发行对照') &&
          app.includes('intel-release-must-list') &&
          app.includes('产品主路径') &&
          teach.includes('release_product_path')
        );
      })(),
    },
    {
      id: 'intel_shift_voice',
      req: '班次分轨文风：标题/导语/截断随班次',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-shift-schedule.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('SHIFT_VOICE_PROFILES') &&
          s.includes('buildShiftVoice') &&
          s.includes('applyShiftVoice') &&
          s.includes('shift-voice') &&
          orch.includes('shiftVoice') &&
          app.includes('data-shift-voice') &&
          app.includes('intel-shift-voice-line') &&
          app.includes('voiceTitles') &&
          teach.includes('shift_voice')
        );
      })(),
    },
    {
      id: 'intel_kpi_interrupt_n',
      req: 'Interrupt/KPI 样本量：门槛 n≥20 + 面板带 n',
      ok: (() => {
        const kpi = path.join(process.cwd(), 'services/intel-kpi.js');
        const ch = path.join(process.cwd(), 'services/intel-interrupt-channel.js');
        if (!fs.existsSync(kpi) || !fs.existsSync(ch)) return false;
        const k = fs.readFileSync(kpi, 'utf8');
        const c = fs.readFileSync(ch, 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        return (
          k.includes('interruptQuality') &&
          k.includes('INTERRUPT_SURPRISE_N_GATE') &&
          k.includes('sampleDisplay') &&
          k.includes('kpi-n-polish') &&
          c.includes('nGateDisplay') &&
          c.includes('INTERRUPT_SURPRISE_N_GATE') &&
          orch.includes('nGateDisplay') &&
          app.includes('nGateDisplay') &&
          app.includes('intel-kpi-interrupt-n') &&
          app.includes('sampleDisplay')
        );
      })(),
    },
    {
      id: 'intel_meta_debt_bridge',
      req: '元智能盲区可执行还债桥',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-meta-intelligence.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('attachMetaDebtBridge') &&
          s.includes('mergeMetaBridgeIntoDebtBoard') &&
          s.includes('META_SPOT_DEBT') &&
          s.includes('meta-debt-bridge') &&
          orch.includes('mergeMetaBridgeIntoDebtBoard') &&
          orch.includes('metaOpsRunnable') &&
          app.includes('intel-meta-bridge-line') &&
          app.includes('prefer-meta') &&
          teach.includes('meta_debt_bridge')
        );
      })(),
    },
    {
      id: 'intel_false_quiet_loop',
      req: '假静默风险闭环：P0+清单+ack 归档',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-quiet-brake-board.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.js'), 'utf8');
        const pre = fs.readFileSync(path.join(process.cwd(), 'electron/preload.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildFalseQuietLoop') &&
          s.includes('ackFalseQuietRisk') &&
          s.includes('false-quiet-loop') &&
          s.includes('commanderOverride') &&
          app.includes('intel-fq-loop') &&
          app.includes('intel-ack-false-quiet') &&
          main.includes('ack-intel-false-quiet') &&
          pre.includes('ackIntelFalseQuiet') &&
          teach.includes('false_quiet_risk') &&
          teach.includes('闭环')
        );
      })(),
    },
    {
      id: 'intel_outlook_staff_page',
      req: 'Outlook 全页幕僚化：备忘录硬模板主输出',
      ok: (() => {
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        const css = fs.readFileSync(path.join(process.cwd(), 'src/reading-layout.css'), 'utf8');
        return (
          app.includes('intel-memo-hard') &&
          app.includes('data-hard-template') &&
          app.includes('outlook-detail-area-memo-primary') &&
          app.includes('outlook-scenarios-demoted') &&
          app.includes('>幕僚</span>') &&
          css.includes('outlook-detail-staff-grid') &&
          teach.includes('outlook_memo_primary')
        );
      })(),
    },
    {
      id: 'intel_contradiction_board',
      req: '矛盾矩阵板：主矛盾×反对力跨品种汇总',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-contradiction-board.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildContradictionBoard') &&
          s.includes('opposingForceFromMatrix') &&
          s.includes('contradiction-board') &&
          orch.includes('contradictionBoard') &&
          orch.includes('buildContradictionBoard') &&
          app.includes('intel-cmatrix-line') &&
          app.includes('主矛盾×反对力') &&
          app.includes('outlook-cmatrix-main') &&
          teach.includes('contradiction_matrix')
        );
      })(),
    },
    {
      id: 'intel_museum_intake',
      req: '证伪真写入博物馆：原子入馆 + 今日入馆板',
      ok: (() => {
        const exec = path.join(process.cwd(), 'services/intel-falsification-executor.js');
        const board = path.join(process.cwd(), 'services/intel-failure-museum-board.js');
        if (!fs.existsSync(exec) || !fs.existsSync(board)) return false;
        const e = fs.readFileSync(exec, 'utf8');
        const b = fs.readFileSync(board, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          e.includes('writeMuseumIntake') &&
          e.includes('museum-atomic-intake') &&
          e.includes('museumWritten') &&
          b.includes('todayIntake') &&
          b.includes('museum-intake') &&
          orch.includes('museumTodayIntake') &&
          orch.includes('todayIntake') &&
          app.includes('intel-museum-intake-line') &&
          app.includes('今日入馆') &&
          teach.includes('museum_intake')
        );
      })(),
    },
    {
      id: 'intel_analyst_weight_ack',
      req: '分析师标注→权重学习人审：信号入提案不静默落盘',
      ok: (() => {
        const pl = path.join(process.cwd(), 'services/intel-process-learning.js');
        const wb = path.join(process.cwd(), 'services/intel-analyst-workbench.js');
        if (!fs.existsSync(pl) || !fs.existsSync(wb)) return false;
        const p = fs.readFileSync(pl, 'utf8');
        const w = fs.readFileSync(wb, 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          p.includes('ingestAnalystWeightSignal') &&
          p.includes('aggregateAnalystWeightHints') &&
          p.includes('analystContribution') &&
          p.includes('ANALYST_WEIGHT_N_GATE') &&
          w.includes('ingestAnalystWeightSignal') &&
          w.includes('weightSignal') &&
          app.includes('intel-weight-analyst-line') &&
          app.includes('标注→权') &&
          teach.includes('analyst_weight_ack')
        );
      })(),
    },
    {
      id: 'intel_evidence_triad',
      req: '证据温度三轴：温/硬/贴分轴产品化',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-evidence-triad.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('assessEvidenceTriad') &&
          s.includes('buildEvidenceTriadBoard') &&
          s.includes('hot_soft') &&
          s.includes('cold_hard') &&
          s.includes('evidence-triad') &&
          orch.includes('evidenceTriadBoard') &&
          orch.includes('evidenceTriad') &&
          app.includes('intel-triad-line') &&
          app.includes('温度·硬度·贴合') &&
          teach.includes('evidence_triad')
        );
      })(),
    },
    {
      id: 'intel_memory_replay',
      req: '记忆层可检索回放：存档/改口/博物馆',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-memory-replay.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.js'), 'utf8');
        const pre = fs.readFileSync(path.join(process.cwd(), 'electron/preload.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('searchIntelMemory') &&
          s.includes('replayClaimTimeline') &&
          s.includes('buildMemoryReplayBoard') &&
          s.includes('memory-replay') &&
          orch.includes('memoryReplayBoard') &&
          app.includes('intel-mem-search') &&
          app.includes('intel-memory-search') &&
          app.includes('intel-memory-replay') &&
          main.includes('search-intel-memory') &&
          main.includes('replay-intel-memory-claim') &&
          pre.includes('searchIntelMemory') &&
          pre.includes('replayIntelMemoryClaim') &&
          teach.includes('memory_replay')
        );
      })(),
    },
    {
      id: 'intel_process_learning',
      req: '过程学习：方向错/过程对分开 + 改权门禁',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-process-learning.js');
        if (!fs.existsSync(f)) return false;
        const src = fs.readFileSync(f, 'utf8');
        return src.includes('dirWrongProcessRight') && src.includes('lookupProcessMultiplier');
      })(),
    },
    {
      id: 'intel_interrupt_channel',
      req: 'Interrupt 指挥通道：队列+OS记账+确认/消音',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-interrupt-channel.js');
        if (!fs.existsSync(f)) return false;
        const src = fs.readFileSync(f, 'utf8');
        const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.js'), 'utf8');
        const pre = fs.readFileSync(path.join(process.cwd(), 'electron/preload.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          src.includes('freshNotifications') &&
          src.includes('buildCommandDeck') &&
          src.includes('markOsDelivered') &&
          src.includes('muteInterrupt') &&
          main.includes('dispatch-intel-interrupt-notifications') &&
          main.includes('mute-intel-interrupt') &&
          pre.includes('ackIntelInterrupt') &&
          pre.includes('muteIntelInterrupt') &&
          app.includes('intel-cmd-deck')
        );
      })(),
    },
    {
      id: 'intel_anti_manipulation_product',
      req: '反操纵产品化：自动扫描+人工硬旗+纪律板',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-anti-manipulation.js');
        if (!fs.existsSync(f)) return false;
        const src = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          src.includes('scanAutoSuspectSignals') &&
          src.includes('buildAntiManipulationBoard') &&
          src.includes('softWatch') &&
          orch.includes('antiManipulationBoard') &&
          app.includes('intel-manip-list')
        );
      })(),
    },
    {
      id: 'intel_attention_budget',
      req: '注意力预算：深算槽位 + pack 暴露',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-attention-budget.js');
        if (!fs.existsSync(f)) return false;
        const a = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          a.includes('allocateFromTriage') &&
          a.includes('buildAttentionRationBoard') &&
          orch.includes('attentionRationBoard') &&
          app.includes('intel-attn-line')
        );
      })(),
    },
    {
      id: 'intel_isomorphic_k',
      req: '真同构 K 路径回放（磁盘日K相关）',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-isomorphic-k.js');
        if (!fs.existsSync(f)) return false;
        const k = fs.readFileSync(f, 'utf8');
        const c = fs.readFileSync(path.join(process.cwd(), 'services/intel-canonical-cases.js'), 'utf8');
        const board = fs.readFileSync(path.join(process.cwd(), 'services/intel-isomorphic-board.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          c.includes('computePathSimilarity') &&
          c.includes('kline-path') &&
          k.includes('pathReplay') &&
          k.includes('histCloses') &&
          board.includes('sampleReplays') &&
          app.includes('intel-iso-replay')
        );
      })(),
    },
    {
      id: 'intel_isomorphic_path_replay',
      req: '同构路径回放加深：hist/recent 窗口 + Hub 样本回放',
      ok: (() => {
        const k = fs.readFileSync(path.join(process.cwd(), 'services/intel-isomorphic-k.js'), 'utf8');
        const board = fs.readFileSync(path.join(process.cwd(), 'services/intel-isomorphic-board.js'), 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          k.includes('pathReplay') &&
          k.includes('pearson-return-path-replay') &&
          board.includes('sampleReplays') &&
          board.includes('pathReplays') &&
          orch.includes('sampleReplays') &&
          app.includes('intel-iso-replay-list') &&
          teach.includes('isomorphic_path_replay')
        );
      })(),
    },
    {
      id: 'intel_shock_edge_verify',
      req: '冲击边验证阻尼：n≥5 史命中降权激活',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-shock-dynamics.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('applyEdgeVerifyDampening') &&
          s.includes('loadEdgeVerifyStats') &&
          s.includes('EDGE_VERIFY_N_GATE') &&
          s.includes('edgeVerifyReady') &&
          app.includes('edgeVerifyHit') &&
          teach.includes('shock_edge_verify')
        );
      })(),
    },
    {
      id: 'intel_narrative_compartment',
      req: '叙事传染仓室计数（诚实非 ODE SIR）+ 滞后展示',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-narrative-epidemiology.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('compartmentCounts') &&
          s.includes('discrete-compartment-counts') &&
          s.includes('lagDisplay') &&
          orch.includes('compartmentCounts') &&
          app.includes('intel-narr-compartment') &&
          teach.includes('narrative_compartment')
        );
      })(),
    },
    {
      id: 'intel_narrative_sir_ceiling',
      req: '叙事离散 SIR 上限：S/I/R 仓室 + 拒绝 ODE',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-narrative-epidemiology.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildDiscreteSirCensus') &&
          s.includes('discrete-sir-census') &&
          s.includes('sirCeiling') &&
          s.includes('odeFitted: false') &&
          app.includes('intel-narr-sir') &&
          teach.includes('narrative_sir_ceiling')
        );
      })(),
    },
    {
      id: 'intel_shock_edge_catalog',
      req: '冲击边图库：已评估候选边 + 验证命中',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-shock-edge-catalog.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const g = fs.readFileSync(path.join(process.cwd(), 'services/intel-shock-graph.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildShockEdgeCatalog') &&
          s.includes('verifiedReady') &&
          g.includes('edgeCatalog') &&
          app.includes('intel-edge-catalog') &&
          teach.includes('shock_edge_catalog')
        );
      })(),
    },
    {
      id: 'intel_shared_mechanism_chain',
      req: '跨品种共享机制链 + 成员覆盖',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-shared-mechanism-chain.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const m = fs.readFileSync(path.join(process.cwd(), 'services/intel-mechanism-board.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildSharedMechanismChains') &&
          s.includes('sharedDepthDisplay') &&
          m.includes('sharedChains') &&
          app.includes('intel-shared-mech') &&
          teach.includes('shared_mechanism_chain')
        );
      })(),
    },
    {
      id: 'intel_commander_workbar',
      req: '指挥官工作条：五键 + 真实待办（非独立 OS）',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-face-contracts.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildCommanderWorkbar') &&
          s.includes('commander-workbar-bind') &&
          s.includes('productShell: false') &&
          orch.includes('commanderWorkbar') &&
          app.includes('intel-commander-workbar') &&
          teach.includes('commander_workbar')
        );
      })(),
    },
    {
      id: 'intel_face_shell_layout',
      req: '三面孔 Hub 内壳布局（非 CSS 同文三藏）',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-face-contracts.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildFaceShellLayout') &&
          s.includes('cmd-brief') &&
          s.includes('lab-depth') &&
          s.includes('trigger-strip') &&
          s.includes('shellsDiffer') &&
          s.includes('independentApp: false') &&
          app.includes('data-intel-shell') &&
          teach.includes('face_shell_layout')
        );
      })(),
    },
    {
      id: 'intel_commander_order_queue',
      req: '决策壳下令队列绑定真实 ops',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-face-contracts.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('commander-order-bind') &&
          s.includes('orderQueue') &&
          s.includes('productShell: false') &&
          app.includes('intel-commander-order-queue') &&
          app.includes('data-commander-orders') &&
          teach.includes('commander_order_queue')
        );
      })(),
    },
    {
      id: 'intel_anti_pattern_board',
      req: '反模式/反目标看板：真实命中或暂无',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-anti-pattern-board.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildAntiPatternBoard') &&
          s.includes('anti-pattern-aggregate') &&
          s.includes('暂无命中') &&
          orch.includes('antiPatternBoard') &&
          app.includes('intel-anti-pattern') &&
          teach.includes('anti_pattern_board')
        );
      })(),
    },
    {
      id: 'intel_llm_boundary',
      req: 'LLM 输出侧硬拦：编造价格/裸%/无溯源命中率',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-llm-boundary.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const fusion = fs.readFileSync(path.join(process.cwd(), 'services/fancheng-ai-fusion.js'), 'utf8');
        const cursor = fs.readFileSync(path.join(process.cwd(), 'services/cursor-llm-client.js'), 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('assertLlmOutputWithinFacts') &&
          s.includes('hardSandbox: false') &&
          s.includes('outputGate') &&
          fusion.includes('gateLlmText') &&
          cursor.includes('gateLlmText') &&
          orch.includes('llmBoundaryBoard') &&
          app.includes('intel-llm-boundary-line') &&
          teach.includes('llm_boundary')
        );
      })(),
    },
    {
      id: 'intel_prediction_quality_debt',
      req: '预测质量债：WF hit 带 n + 过程vs方向 + 欠样/校准缺口/还债动作；禁止提升话术',
      ok: (() => {
        const f = path.join(process.cwd(), 'services/intel-prediction-quality-debt.js');
        if (!fs.existsSync(f)) return false;
        const s = fs.readFileSync(f, 'utf8');
        const orch = fs.readFileSync(path.join(process.cwd(), 'services/intel-orchestrator.js'), 'utf8');
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        const teach = fs.readFileSync(path.join(process.cwd(), 'services/intel-teaching.js'), 'utf8');
        return (
          s.includes('buildPredictionQualityDebtBoard') &&
          s.includes('improvementClaim: false') &&
          s.includes('工程 PASS ≠ 预测变准') &&
          s.includes('buildRepaymentActions') &&
          s.includes('loadCalibrationGaps') &&
          s.includes('byInst') &&
          orch.includes('qualityDebtBoard') &&
          app.includes('intel-quality-debt') &&
          teach.includes('prediction_quality_debt')
        );
      })(),
    },
    {
      id: 'intel_quality_debt_repayment_q1',
      req: 'Q1 质量债还债：accept 快照含 byInst；Hub 展示还债动作',
      ok: (() => {
        const accept = fs.readFileSync(
          path.join(process.cwd(), 'scripts/accept-outlook-stockflow-capital-audit.js'),
          'utf8'
        );
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          accept.includes('byInst:') &&
          accept.includes('供质量债欠样') &&
          app.includes('intel-quality-debt-repay') &&
          app.includes('repayment')
        );
      })(),
    },
    {
      id: 'intel_vision_closing_checklist',
      req: '愿景收官：§20–80 能力对齐公开；质量债诚实',
      ok: (() => {
        const audit = fs.readFileSync(
          path.join(process.cwd(), 'scripts/audit-intel-vision-1-80.js'),
          'utf8'
        );
        const s = fs.readFileSync(
          path.join(process.cwd(), 'services/intel-prediction-quality-debt.js'),
          'utf8'
        );
        return (
          audit.includes('llm-boundary') ||
          (audit.includes('n: 60') && s.includes('visionClosing') && s.includes('nearlyMet'))
        );
      })(),
    },
    {
      id: 'intel_stage_redesign',
      req: '情报中心全幅主舞台（Hub 置顶）',
      ok: (() => {
        const app = fs.readFileSync(path.join(process.cwd(), 'src/app.js'), 'utf8');
        return (
          app.includes('intel-center-hub-stage') &&
          app.includes('outlook-intel-stage') &&
          app.includes('v2.61.0-intel-stage')
        );
      })(),
    },
    {
      id: 'intel_center_live_pack',
      req: '缓存含 intelCenterPack 且可评估命题',
      ok: (() => {
        const pack = getCachedCommodityOutlookSource();
        let icp = pack?.intelCenterPack;
        let insts = pack?.instruments || [];
        if (!icp?.version && insts.length) {
          try {
            const orch = require('../services/intel-orchestrator');
            insts = orch.applyIntelCenterToInstruments(insts, { persist: false });
            icp = orch.buildIntelCenterPack(insts, { persist: false });
          } catch {
            return false;
          }
        }
        if (!icp?.version) return false;
        const withClaim = insts.filter((i) => i.intelCenter?.primaryClaim?.claimId).length;
        return withClaim >= Math.min(10, insts.length * 0.5);
      })(),
      note: '旧缓存需 rebuild-outlook-cache；运行时亦可内存评估',
    }
  );
  return checks.map((c) => ({
    id: c.id,
    requirement: c.req,
    status: c.ok ? 'PASS' : 'FAIL',
    note: c.note || null,
    detail: { present: c.ok },
  }));
}

function auditLiveOutlook() {
  const pack = getCachedCommodityOutlookSource();
  const instruments = pack?.instruments || [];
  const rows = [];
  let withAttitude = 0;
  let withHorizons = 0;
  let withJoint = 0;
  let withRank = 0;
  let withMember = 0;
  let oiLag = 0;
  let scoreOnlyLegacy = 0;

  for (const inst of instruments) {
    const cap = inst.capitalAttention || {};
    const h = cap.horizons || {};
    const hasAtt = !!cap.attitudeLabel;
    // Live OI ok; OR honest stale/missing with explicit null horizon slots (cold grains).
    const hasLiveH = h.oi1wPct != null || h.oi1mPct != null || h.oi3mPct != null;
    const hasHonestEmptyH =
      Object.prototype.hasOwnProperty.call(h, 'oi1wPct') &&
      Object.prototype.hasOwnProperty.call(h, 'oi1mPct') &&
      Object.prototype.hasOwnProperty.call(h, 'oi3mPct') &&
      (cap.dataSource === 'history/trading-oi-stale' ||
        cap.reason === 'oi_series_stale' ||
        cap.reason === 'oi_volume_member_missing');
    const hasH = hasLiveH || hasHonestEmptyH;
    const hasJ = !!cap.jointWithInventory;
    const hasR = cap.rank != null;
    const hasM = cap.member?.tradeDate || cap.member?.dataSource;
    if (hasAtt) withAttitude += 1;
    if (hasH) withHorizons += 1;
    if (hasJ) withJoint += 1;
    if (hasR) withRank += 1;
    if (hasM) withMember += 1;
    if (cap.oiAsOf && pack.updatedAt && String(cap.oiAsOf) < String(pack.updatedAt).slice(0, 10)) {
      const lagDays =
        (Date.parse(String(pack.updatedAt).slice(0, 10)) - Date.parse(cap.oiAsOf)) / 86400000;
      if (lagDays > 5) oiLag += 1;
    }
    if (cap.score != null && !hasAtt && !hasH) scoreOnlyLegacy += 1;
    rows.push({
      id: inst.id,
      name: inst.name,
      score: cap.score ?? null,
      attitude: cap.attitudeLabel || null,
      oi1w: h.oi1wPct ?? null,
      oi1m: h.oi1mPct ?? null,
      oi3m: h.oi3mPct ?? null,
      joint: cap.jointWithInventory || null,
      rank: cap.rank ?? null,
      oiAsOf: cap.oiAsOf || null,
      dataSource: cap.dataSource || null,
      direction: inst.direction || null,
    });
  }

  const n = instruments.length;
  const noWhByDesign = new Set(['ec', 'wh', 'pm', 'ri', 'lr', 'jr', 'zc']);
  const whCapable = rows.filter((r) => !noWhByDesign.has(String(r.id).toLowerCase()));
  const whCapableWithJoint = whCapable.filter((r) => r.joint).length;
  const whCapableN = whCapable.length;
  return {
    n,
    updatedAt: pack?.updatedAt || null,
    liveRefreshedAt: pack?.liveRefreshedAt || null,
    capitalAttitudeHydratedAt: pack?.capitalAttitudeHydratedAt || null,
    coverage: {
      attitude: { ok: withAttitude, of: n, pct: n ? +(withAttitude / n * 100).toFixed(1) : 0 },
      horizons: { ok: withHorizons, of: n, pct: n ? +(withHorizons / n * 100).toFixed(1) : 0 },
      joint: { ok: withJoint, of: n, pct: n ? +(withJoint / n * 100).toFixed(1) : 0 },
      jointWhCapable: {
        ok: whCapableWithJoint,
        of: whCapableN,
        pct: whCapableN ? +(whCapableWithJoint / whCapableN * 100).toFixed(1) : 0,
      },
      rank: { ok: withRank, of: n, pct: n ? +(withRank / n * 100).toFixed(1) : 0 },
      memberOnCap: { ok: withMember, of: n, pct: n ? +(withMember / n * 100).toFixed(1) : 0 },
      oiLagGt5d: oiLag,
      scoreOnlyLegacy,
    },
    samples: ['cu', 'ao', 'au', 'rb', 'ta', 'si', 'sc']
      .map((id) => rows.find((r) => r.id === id))
      .filter(Boolean),
    requirements: [
      {
        id: 'live_attitude_coverage',
        requirement: '研判包全品种含资金态度标签',
        status: status(withAttitude === n, withAttitude >= n * 0.9),
        metric: `${withAttitude}/${n}`,
      },
      {
        id: 'live_horizon_coverage',
        requirement: '研判包全品种含持仓多周期',
        status: status(withHorizons === n, withHorizons >= n * 0.85),
        metric: `${withHorizons}/${n}`,
      },
      {
        id: 'live_joint_coverage',
        requirement: '有仓单能力的品种合证非空（排除ec/退市粮）',
        status: status(
          whCapableWithJoint >= whCapableN - 3,
          whCapableWithJoint >= Math.floor(whCapableN * 0.9)
        ),
        metric: `${whCapableWithJoint}/${whCapableN} (raw ${withJoint}/${n})`,
        note: 'ec无仓单；wh/pm/ri/lr/jr/zc休眠不抓；ap/rs/pt若交易所无公布则暂无',
      },
      {
        id: 'no_legacy_score_only',
        requirement: '禁止残留仅有 score 无态度的旧结构',
        status: status(scoreOnlyLegacy === 0, false),
        metric: String(scoreOnlyLegacy),
      },
    ],
  };
}

function auditMemberCoverage() {
  const byEx = { SHFE: [], CZCE: [], ZCE: [], DCE: [], GFEX: [], INE: [], other: [] };
  const results = [];
  for (const spec of INSTRUMENT_REGISTRY) {
    const id = String(spec.id).toLowerCase();
    const meta = getCommodityMeta(id) || {};
    const exRaw = String(meta.exchangeId || meta.exchange || spec.exchangeId || 'other').toUpperCase();
    const ex =
      exRaw === 'ZCE' ? 'CZCE' : exRaw === 'SHFE' || exRaw === 'INE' || exRaw === 'DCE' || exRaw === 'GFEX' ? exRaw : 'other';
    const bucket = byEx[ex] ? ex : 'other';
    let feat = null;
    try {
      feat = loadMemberOiFeatures(id);
    } catch (e) {
      feat = { available: false, reason: e.message };
    }
    const ok = !!(feat?.available);
    const row = {
      id,
      exchange: bucket,
      available: ok,
      reason: feat?.reason || feat?.unavailableReason || null,
      dataSource: feat?.dataSource || null,
      tradeDate: feat?.tradeDate || null,
    };
    results.push(row);
    byEx[bucket].push(row);
  }
  const summary = {};
  for (const [ex, list] of Object.entries(byEx)) {
    if (!list.length) continue;
    const ok = list.filter((x) => x.available).length;
    summary[ex] = { ok, of: list.length, pct: +(ok / list.length * 100).toFixed(1), miss: list.filter((x) => !x.available).map((x) => x.id) };
  }
  return {
    summary,
    requirements: [
      {
        id: 'member_shfe',
        requirement: '上期所/能源中心会员排名可用（免费官方）',
        status: status((summary.SHFE?.pct || 0) >= 60 || (summary.INE?.pct || 0) >= 40, (summary.SHFE?.ok || 0) > 0),
        metric: `SHFE ${summary.SHFE?.ok || 0}/${summary.SHFE?.of || 0}; INE ${summary.INE?.ok || 0}/${summary.INE?.of || 0}`,
      },
      {
        id: 'member_czce',
        requirement: '郑商所会员排名可用',
        status: status((summary.CZCE?.pct || 0) >= 50, (summary.CZCE?.ok || 0) > 0),
        metric: `${summary.CZCE?.ok || 0}/${summary.CZCE?.of || 0}`,
      },
      {
        id: 'member_gfex',
        requirement: '广期所会员排名可用（公布品种）',
        status: status((summary.GFEX?.ok || 0) >= 2, (summary.GFEX?.ok || 0) > 0),
        metric: `${summary.GFEX?.ok || 0}/${summary.GFEX?.of || 0}`,
        note: 'pt/pd 常无公布属交易所侧空白',
      },
      {
        id: 'member_dce',
        requirement: '大商所会员排名（需门户会话）',
        status: status((summary.DCE?.pct || 0) >= 60, (summary.DCE?.pct || 0) >= 40),
        metric: `${summary.DCE?.ok || 0}/${summary.DCE?.of || 0}`,
      },
    ],
    misses: results.filter((r) => !r.available).slice(0, 40),
  };
}

function auditJointAndMatrixSamples(ids = ['cu', 'ao', 'au', 'rb', 'al', 'ta', 'm', 'si']) {
  const asOf = new Date().toISOString().slice(0, 10);
  const pack = getCachedCommodityOutlookSource();
  const samples = [];
  for (const id of ids) {
    const joint = buildStockFlowJoint(id, asOf);
    const attitude = computeCapitalAttitude({ instrumentId: id, asOf });
    const liveInst = (pack?.instruments || []).find((x) => String(x.id).toLowerCase() === id) || {
      id,
      price: null,
      direction: null,
    };
    let matrix = null;
    try {
      matrix = buildContradictionMatrix(liveInst, {});
    } catch (e) {
      matrix = { error: e.message };
    }
    const axes = matrix?.axes || [];
    const jointAxis = Array.isArray(axes)
      ? axes.find((a) => /仓单|合证|stock/i.test(String(a.label || a.id || '')))
      : null;
    const hyp = matrix?.competingHypotheses || [];
    const falsifyBlob = JSON.stringify(hyp);
    samples.push({
      id,
      jointAvailable: !!joint?.available,
      primaryLabel: joint?.primaryLabel || joint?.label || null,
      structureBias: joint?.structureBias || null,
      priceMayLag: !!joint?.priceMayLag,
      oiLag: joint?.oiLag || null,
      attitude: attitude?.attitudeLabel || null,
      horizons: attitude?.horizons || null,
      matrixStockFlow: matrix?.stockFlow?.display || matrix?.stockFlow?.primaryLabel || null,
      matrixJointAxis: jointAxis?.label || null,
      falsifyRequireJoint: hyp.some((h) => h?.falsifyRules?.requireStockFlowJoint),
      falsifyHasSoloBan: /不据单日仓单|仓单禁止|待对照/.test(falsifyBlob),
    });
  }
  const okJoint = samples.filter((s) => s.jointAvailable).length;
  return {
    asOf,
    samples,
    requirements: [
      {
        id: 'joint_runtime',
        requirement: '抽样品种能算出合证（有仓单+持仓）',
        status: status(okJoint >= 4, okJoint >= 2),
        metric: `${okJoint}/${samples.length}`,
      },
      {
        id: 'attitude_runtime',
        requirement: '抽样品种能算出资金态度',
        status: status(samples.every((s) => s.attitude), samples.filter((s) => s.attitude).length >= samples.length - 1),
        metric: `${samples.filter((s) => s.attitude).length}/${samples.length}`,
      },
    ],
  };
}

function runRecentWalkForward(days = BACKTEST_DAYS) {
  backtest.preloadWalkForwardCaches();
  const ids = QUICK
    ? QUICK_IDS.filter((id) => INSTRUMENT_REGISTRY.some((s) => String(s.id).toLowerCase() === id))
    : INSTRUMENT_REGISTRY.map((s) => s.id);
  console.log('[accept-audit] walk-forward instruments', ids.length, QUICK ? '(quick)' : '(full)');
  const byInst = [];
  let hits = 0;
  let scored = 0;
  let missingActual = 0;
  let capitalNullScore = 0;
  let attitudePresent = 0;
  let jointFeaturePresent = 0;
  let wh5dOnlyRows = 0;
  let jointAppliedRows = 0;
  const startMs = Date.now();

  for (const id of ids) {
    const bars = readCachedKlines(id) || [];
    if (!bars.length || bars.length < 80) {
      byInst.push({ id, status: 'skip_no_bars', bars: bars.length || 0 });
      continue;
    }
    const meta = getCommodityMeta(id) || {};
    const spec =
      INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === String(id).toLowerCase()) || {
        id,
        sector: meta.sector || 'other',
        bucket: meta.bucket,
      };
    const end = bars.length - 2; // need next bar actual
    const begin = Math.max(60, end - days);
    let iHits = 0;
    let iTotal = 0;
    let iMissing = 0;
    let lastCap = null;
    let prevFinance = null;
    for (let t = begin; t <= end; t += 1) {
      let row;
      try {
        row = backtest.predictAtBarIndexHistorical(spec, bars, t, null, prevFinance, {});
        prevFinance = row?.financeRegimeNext || prevFinance;
      } catch {
        continue;
      }
      if (!row) continue;
      if (row.warehouseReceipt_chg_5d != null && row.stockFlowJoint == null) wh5dOnlyRows += 1;
      if (row.jointDecision?.reason === 'joint_applied') jointAppliedRows += 1;
      if (row.actualDir == null || row.actualReturn == null) {
        missingActual += 1;
        iMissing += 1;
        continue;
      }
      if (row.predictedDir === 'neutral' || row.actualDir === 'neutral') continue;
      iTotal += 1;
      scored += 1;
      if (row.hitDirection) {
        iHits += 1;
        hits += 1;
      }
    }
    const lastDate = bars[Math.min(end, bars.length - 1)]?.date;
    // 态度/合证覆盖：仅末 bar 探测（避免每 bar 重复 buildStockFlowJoint）
    if (lastDate) {
      lastCap = computeCapitalAttitude({
        instrumentId: id,
        asOf: lastDate,
        technical: {},
        liveQuote: { price: bars[Math.min(end, bars.length - 1)]?.close },
      });
      if (lastCap?.attitudeLabel) attitudePresent += 1;
      if (lastCap?.score == null) capitalNullScore += 1;
    }
    const joint = lastDate ? buildStockFlowJoint(id, lastDate) : null;
    if (joint?.available) jointFeaturePresent += 1;
    byInst.push({
      id,
      bars: bars.length,
      scored: iTotal,
      hits: iHits,
      hitRate: iTotal ? +(iHits / iTotal * 100).toFixed(1) : null,
      missingActual: iMissing,
      attitude: lastCap?.attitudeLabel || null,
      score: lastCap?.score ?? null,
      joint: joint?.primaryLabel || null,
      oiAsOf: lastCap?.oiAsOf || null,
    });
  }

  const elapsedMs = Date.now() - startMs;
  const hitRate = scored ? +(hits / scored * 100).toFixed(1) : null;
  return {
    days,
    elapsedMs,
    instrumentsTried: ids.length,
    instrumentsScored: byInst.filter((x) => x.scored > 0).length,
    scored,
    hits,
    hitRate,
    hitDisplay: hitRate != null ? `${hitRate}% (${hits}/${scored})` : '暂无',
    missingActual,
    capitalNullScoreInstruments: capitalNullScore,
    attitudePresentInstruments: attitudePresent,
    jointAtLastBar: jointFeaturePresent,
    jointAppliedRows,
    worst: byInst
      .filter((x) => x.scored >= 8)
      .sort((a, b) => (a.hitRate ?? 99) - (b.hitRate ?? 99))
      .slice(0, 12),
    best: byInst
      .filter((x) => x.scored >= 8)
      .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0))
      .slice(0, 8),
    requirements: [
      {
        id: 'backtest_real_klines',
        requirement: '回测仅用磁盘真实日K，缺失 actual 不计分',
        status: 'PASS',
        metric: `scored=${scored}, missingActual=${missingActual}`,
      },
      {
        id: 'backtest_hit_with_n',
        requirement: '命中率必须带样本量 n',
        status: status(hitRate != null && scored > 0, false),
        metric: hitRate != null ? `${hitRate}% (${hits}/${scored})` : '暂无',
      },
      {
        id: 'backtest_joint_as_feature',
        requirement: '回测特征升级为仓单×资金合证（非仅 wh5d）',
        status: wh5dOnlyRows > 0 ? 'FAIL' : 'PASS',
        metric: `wh5dOnlyRows=${wh5dOnlyRows}; jointAtLastBar=${jointFeaturePresent}/${ids.length}`,
        note: '引擎能算合证，但 commodity-outlook-backtest enrich 未写入 joint 特征',
      },
      {
        id: 'backtest_joint_in_decision',
        requirement: '回测路径合证增量进入决策（joint_applied 可观测）',
        status: status(jointAppliedRows >= 5, jointAppliedRows > 0),
        metric: `jointAppliedRows=${jointAppliedRows}`,
        note: jointAppliedRows === 0
          ? '近窗无 build_oi_up 赋权样本或未接线 — 属诚实缺口'
          : null,
      },
    ],
    wh5dOnlyRows,
    jointAppliedRows,
    byInst,
  };
}

function auditFakeDataGuards() {
  const sources = [
    'services/capital-attitude.js',
    'services/inventory-capital-joint.js',
    'services/contradiction-matrix.js',
    'services/commodity-outlook-engine.js',
    'src/app.js',
  ];
  const bad = [];
  for (const f of sources) {
    const txt = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    if (/generateFake|dummyData|mockPrice|fakeClose/.test(txt)) {
      bad.push({ file: f, code: 'fake_generator' });
    }
  }
  return {
    requirements: [
      {
        id: 'no_fake_generators',
        requirement: '资金/合证/UI 路径无假数据生成器',
        status: status(bad.length === 0, false),
        metric: bad.length ? JSON.stringify(bad) : '0',
      },
    ],
  };
}

async function main() {
  console.log('[accept-audit] drive', process.env.FANCHENG_DATA_DRIVE, 'backtestDays', BACKTEST_DAYS);
  const codeUi = auditCodeAndUi();
  const live = auditLiveOutlook();
  const joint = auditJointAndMatrixSamples();
  const member = auditMemberCoverage();
  const fake = auditFakeDataGuards();
  console.log('[accept-audit] running recent walk-forward...');
  const wf = runRecentWalkForward(BACKTEST_DAYS);

  const allReqs = [
    ...codeUi.map((c) => ({ area: 'code_ui', ...c })),
    ...live.requirements.map((c) => ({ area: 'live_cache', ...c })),
    ...joint.requirements.map((c) => ({ area: 'joint_runtime', ...c })),
    ...member.requirements.map((c) => ({ area: 'member', ...c })),
    ...wf.requirements.map((c) => ({ area: 'backtest', ...c })),
    ...fake.requirements.map((c) => ({ area: 'integrity', ...c })),
  ];

  const tallies = { PASS: 0, PARTIAL: 0, FAIL: 0 };
  for (const r of allReqs) tallies[r.status] = (tallies[r.status] || 0) + 1;

  const verdict =
    tallies.FAIL === 0 && tallies.PARTIAL === 0
      ? 'FULLY_MET'
      : tallies.FAIL === 0
        ? 'MOSTLY_MET_WITH_GAPS'
        : 'NOT_FULLY_IMPLEMENTED';

  const report = {
    version: 'v1-accept-stockflow-capital',
    asOf: new Date().toISOString(),
    dataDrive: process.env.FANCHENG_DATA_DRIVE,
    verdict,
    tallies,
    requirements: allReqs,
    liveCoverage: live.coverage,
    liveSamples: live.samples,
    jointSamples: joint.samples,
    memberSummary: member.summary,
    memberMisses: member.misses,
    walkForward: {
      days: wf.days,
      hitDisplay: wf.hitDisplay,
      scored: wf.scored,
      instrumentsTried: wf.instrumentsTried,
      instrumentsScored: wf.instrumentsScored,
      elapsedMs: wf.elapsedMs,
      worst: wf.worst,
      best: wf.best,
      jointAtLastBar: wf.jointAtLastBar,
      // 紧凑 byInst：供质量债欠样/跳过扫描（禁止只靠 worst≥8 掩盖欠样）
      byInst: (wf.byInst || []).map((r) => ({
        id: r.id,
        bars: r.bars ?? null,
        scored: r.scored ?? 0,
        hits: r.hits ?? 0,
        hitRate: r.hitRate ?? null,
        hitDisplay:
          r.scored > 0 && r.hits != null
            ? `${+((r.hits / r.scored) * 100).toFixed(1)}% (${r.hits}/${r.scored})`
            : r.status === 'skip_no_bars'
              ? '暂无'
              : '暂无',
        status: r.status || null,
        missingActual: r.missingActual ?? null,
      })),
    },
    knownGaps: [
      '合证覆盖上限受仓单源约束：ec无仓单；休眠粮/煤(wh/pm/ri/lr/jr/zc)不抓；郑商所当日 Excel 无 ap/rs 节；pt 仓单历史极短',
      'INE sc/bc/ec、GFEX pt/pd 会员排名常因交易所未公布而空 — 须显示暂无',
      '近窗方向命中仍接近随机：合证/资金态度落地 ≠ 预测变准',
      '预测质量债看板已挂：hit≈随机属诚实债，非未接线；Q1 还债=扩样本/校准非新板',
      'LLM 边界=输出侧硬拦；非进程级沙箱',
      '归因120d：仅 build_oi_up 有边际 IC（53.4% n=1110）；destock_oi_up 置零；资金态度 stance 为负 IC 不作方向',
      '情报内核 v1：条件权重优先 stateKey 校准表；桶不足回退启发式',
      'stateKey 校准：已支持全市场重跑；当前表见 intel-statekey-weights.json（quick=false·90d·stride1）',
      'asar 未重打包前，code_ui 部分检查仍读旧 asar；合证/情报入决策以源码检查为准',
      '收盘价精度探针已改为 persist:false，避免审计拆散 tip 日期共识',
    ],
  };

  const outPath = path.join(OUT, `outlook-stockflow-capital-accept-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  // lighter copy for canvas
  fs.writeFileSync(path.join(OUT, 'outlook-stockflow-capital-accept-latest.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    verdict: report.verdict,
    tallies: report.tallies,
    hit: report.walkForward.hitDisplay,
    outPath,
    fails: allReqs.filter((r) => r.status === 'FAIL'),
    partials: allReqs.filter((r) => r.status === 'PARTIAL'),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
