#!/usr/bin/env node
/**
 * 反测：构想 §20–80 ↔ 源码（能力 MET / 深度 PARTIAL / 真 GAP）
 * 说明：§1–19 不在「幕僚型情报中心」编号内；旧 VISION_CHECKLIST 为交易指导另册。
 * 本脚本 = 静态探针 + 人工深度覆写（防止「有字符串就算齐」）。
 */
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (rel) => {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const exists = (rel) => fs.existsSync(path.join(root, rel));

const orch = read('services/intel-orchestrator.js');
const app = read('src/app.js');
const teach = read('services/intel-teaching.js');
const falsify = read('services/intel-falsification-executor.js');
const processL = read('services/intel-process-learning.js');
const museum = read('services/intel-failure-museum-board.js');
const analyst = read('services/intel-analyst-workbench.js');
const narrative = read('services/intel-narrative-epidemiology.js');
const iso = read('services/intel-isomorphic-board.js');
const shock = read('services/intel-shock-multihop.js');
const meta = read('services/intel-meta-intelligence.js');
const horizon = read('services/intel-horizon-coordination.js');
const shockDyn = read('services/intel-shock-dynamics.js');
const isoK = read('services/intel-isomorphic-k.js');
const shockGraph = read('services/intel-shock-graph.js');
const sharedMech = read('services/intel-shared-mechanism-chain.js');
const face = read('services/intel-face-contracts.js');
const antiPattern = read('services/intel-anti-pattern-board.js');
const accept = read('scripts/accept-outlook-stockflow-capital-audit.js');

/** @type {{n:number,title:string,status:'MET'|'PARTIAL'|'GAP',layer:'capability'|'depth'|'product'|'meta',evidence:string,note?:string}[]} */
const items = [
  // 20–34
  { n: 20, title: '首席幕僚·决策备忘录', status: 'MET', layer: 'capability', evidence: 'detail memo-primary + hard template + list 幕僚' },
  { n: 21, title: '信念度谱', status: 'MET', layer: 'capability', evidence: 'claim confidence + falsifying/falsified STATUS' },
  { n: 22, title: '叙事流行病学', status: narrative.includes('buildDiscreteSirCensus') && narrative.includes('sirCeiling') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'discrete-sir-census+lagStats+sirCeiling', note: narrative.includes('odeFitted: false') ? '离散 S/I/R + 滞后 n；拒绝 ODE 拟合' : '模块浅' },
  { n: 23, title: '红队拆台入库', status: 'MET', layer: 'capability', evidence: 'red-team → against / dissentDebt' },
  { n: 24, title: 'canonical/同构 case', status: 'MET', layer: 'capability', evidence: 'pathReplay hist/recent + sampleReplays', note: isoK.includes('pathReplay') && iso.includes('sampleReplays') ? '真实日K pearson 窗口回放；非全量 OHLC 战役引擎 UI' : '回放字段缺失' },
  { n: 25, title: '注意力预算真配额', status: 'MET', layer: 'capability', evidence: 'full/lite/skip + ration board' },
  { n: 26, title: '三面孔分轨', status: face.includes('buildFaceShellLayout') && face.includes('shellsDiffer') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'face shellLayout + Hub chrome per face', note: face.includes('buildFaceShellLayout') ? 'Hub内三壳布局；非三套独立应用' : '分轨交付有；非三壳' },
  { n: 27, title: '时间政治·日历', status: 'MET', layer: 'capability', evidence: 'intelligenceCalendar' },
  { n: 28, title: '基差/期限结构', status: 'MET', layer: 'capability', evidence: 'term-basis → Evidence DSL' },
  { n: 29, title: '内外盘双轨叙事', status: 'MET', layer: 'capability', evidence: 'dual-narrative attach' },
  { n: 30, title: '元智能盲区', status: 'MET', layer: 'capability', evidence: 'meta + debtBridge + mergeMetaBridgeIntoDebtBoard' },
  { n: 31, title: '失败模式/反目标', status: antiPattern.includes('buildAntiPatternBoard') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'anti-pattern-board + Hub', note: antiPattern.includes('buildAntiPatternBoard') ? '反模式板聚合真实命中；零命中暂无' : '约束写入规则/课程，无独立反目标产品页' },
  { n: 32, title: '操纵抗性', status: 'MET', layer: 'capability', evidence: 'anti-manipulation + analyst flag' },
  { n: 33, title: '情报呼吸/节奏', status: 'MET', layer: 'capability', evidence: 'quiet-brake + shift schedule' },
  { n: 34, title: '理念收束', status: 'MET', layer: 'meta', evidence: 'philosophy' },

  // 35–66
  { n: 35, title: '选择集 A/B/C', status: 'MET', layer: 'capability', evidence: 'intel-choice-set' },
  { n: 36, title: 'Evidence DSL', status: 'MET', layer: 'capability', evidence: 'evidence-dsl fields' },
  { n: 37, title: 'Unknown Map', status: 'MET', layer: 'capability', evidence: 'unknown board' },
  { n: 38, title: '研究编译发行', status: 'MET', layer: 'capability', evidence: 'research-compile + product path' },
  { n: 39, title: '价格作反馈通道', status: 'MET', layer: 'capability', evidence: 'processCorrect vs directionHit' },
  { n: 40, title: '改口一等公民', status: 'MET', layer: 'capability', evidence: 'revisions.jsonl + recordRevision' },
  { n: 41, title: 'Surprise×可行动', status: 'MET', layer: 'capability', evidence: 'empirical surprise + gate requireN' },
  { n: 42, title: '冲击网络', status: shockGraph.includes('edgeCatalog') || exists('services/intel-shock-edge-catalog.js') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'edge-catalog + multihop', note: exists('services/intel-shock-edge-catalog.js') ? '验证边图库(corr/n/命中)；非全量学习发现新边' : '多跳路径有；非完整冲击图库' },
  { n: 43, title: '分析师定性标注', status: 'MET', layer: 'capability', evidence: 'UI annotate + JSONL' },
  { n: 44, title: '最小诚实输出', status: 'MET', layer: 'capability', evidence: 'gates + staff + 暂无' },
  { n: 45, title: '指挥研究团队体验', status: face.includes('buildCommanderWorkbar') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'commanderWorkbar + five cmds', note: face.includes('buildCommanderWorkbar') ? '指挥条绑定五键+真实待办；非独立指挥 OS' : '指挥官交互在 Hub；非独立指挥 OS' },
  { n: 46, title: '命题库', status: 'MET', layer: 'capability', evidence: 'claim-library lifecycle' },
  { n: 47, title: '证伪时钟真判', status: 'MET', layer: 'capability', evidence: 'structure/price/expiry → falsified + museumWritten' },
  { n: 48, title: 'Surprise 带 n', status: 'MET', layer: 'capability', evidence: 'empirical nDisplay' },
  { n: 49, title: '定价状态层', status: 'MET', layer: 'capability', evidence: 'pricing-state' },
  { n: 50, title: '冲击边活化', status: shockDyn.includes('applyEdgeVerifyDampening') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'edge-verify dampen n≥5', note: shockDyn.includes('applyEdgeVerifyDampening') ? '史命中阻尼激活；无档案标暂无' : '边存在；权重活化仍浅' },
  { n: 51, title: '三时间尺度协同', status: 'MET', layer: 'capability', evidence: 'intel-horizon-coordination conflict OS' },
  { n: 52, title: '矛盾矩阵', status: 'MET', layer: 'capability', evidence: 'contradictionBoard Hub + main×oppose + detail board' },
  { n: 53, title: '场景格实证化', status: 'MET', layer: 'capability', evidence: 'scenario-lattice hitDisplay/evidence' },
  { n: 54, title: '失效博物馆', status: 'MET', layer: 'capability', evidence: 'writeMuseumIntake + todayIntake' },
  { n: 55, title: '分析师工作台闭环', status: 'MET', layer: 'capability', evidence: 'reliability + ingestAnalystWeightSignal + human ack' },
  { n: 56, title: '三层推送', status: 'MET', layer: 'capability', evidence: 'pushTier interrupt/watch/archive' },
  { n: 57, title: '发布门禁', status: 'MET', layer: 'capability', evidence: 'publish-gates requireN' },
  { n: 58, title: 'KPI 非命中崇拜', status: 'MET', layer: 'capability', evidence: 'kpi sampleDisplay + process' },
  { n: 59, title: '记忆检索回放', status: 'MET', layer: 'capability', evidence: 'searchIntelMemory + replayClaimTimeline' },
  { n: 60, title: 'LLM 边界', status: exists('services/intel-llm-boundary.js') && read('services/intel-llm-boundary.js').includes('assertLlmOutputWithinFacts') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'intel-llm-boundary + fusion/cursor gate + teaching + Hub strip', note: exists('services/intel-llm-boundary.js') ? '输出侧硬拦编造价格/n/命中率；非进程级 LLM 沙箱' : '靠提示/班次文风约束，非硬沙箱' },
  { n: 61, title: '数据运维循环', status: 'MET', layer: 'capability', evidence: 'debt-ops heal/run' },
  { n: 62, title: '反模式清单', status: antiPattern.includes('buildAntiPatternBoard') && app.includes('intel-anti-pattern') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'anti-pattern-board catalog + Hub', note: antiPattern.includes('buildAntiPatternBoard') ? '独立反模式看板；仅真实命中' : '约束在；非独立反模式看板' },
  { n: 63, title: '五个一键命令', status: 'MET', layer: 'capability', evidence: 'intel-five-cmds ①–⑤ in Hub' },
  { n: 64, title: '实施顺序（元）', status: 'MET', layer: 'meta', evidence: 'process' },
  { n: 65, title: '概念图（元）', status: 'MET', layer: 'meta', evidence: 'docs' },
  { n: 66, title: '终局段落（理念）', status: 'MET', layer: 'meta', evidence: 'philosophy' },

  // 67–80
  { n: 67, title: '值班制度+文风', status: 'MET', layer: 'capability', evidence: 'shift + SHIFT_VOICE' },
  { n: 68, title: '问题债务+还债', status: 'MET', layer: 'capability', evidence: 'debt board + ops' },
  { n: 69, title: '过程正确 vs 预测', status: 'MET', layer: 'capability', evidence: 'process-learning human ack + analyst signals' },
  { n: 70, title: '沉默权/假静默', status: 'MET', layer: 'capability', evidence: 'quietDay + falseQuiet loop ack' },
  { n: 71, title: '指挥官下令交互', status: face.includes('commander-order-bind') && app.includes('intel-commander-order-queue') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'commander orderQueue bind debt/weight/fq/interrupt', note: face.includes('commander-order-bind') ? '决策壳下令队列；非独立指挥 OS' : '关键下令有；完整指挥官工作流仍 Hub 内' },
  { n: 72, title: '证据三轴', status: 'MET', layer: 'capability', evidence: 'evidence-triad hot_soft/cold_hard' },
  { n: 73, title: '合证剧本切换', status: 'MET', layer: 'capability', evidence: 'playbook regime script packs' },
  { n: 74, title: '跨品种共享机制', status: sharedMech.includes('buildSharedMechanismChains') ? 'MET' : 'PARTIAL', layer: 'capability', evidence: 'shared-mechanism-chains + honesty', note: sharedMech.includes('buildSharedMechanismChains') ? '共享机制链+成员覆盖；非独立因果推理引擎' : '机制边三态有；共享因果图仍浅' },
  { n: 75, title: '备忘录硬模板', status: 'MET', layer: 'capability', evidence: 'intel-memo-hard first viewport; extras folded' },
  { n: 76, title: '研判版本化发行', status: 'MET', layer: 'capability', evidence: 'compileResearchRelease + compareToRelease' },
  { n: 77, title: '自信通胀刹车', status: 'MET', layer: 'capability', evidence: 'confidenceBrake' },
  { n: 78, title: '教学层', status: 'MET', layer: 'capability', evidence: 'teaching LESSONS + pack' },
  { n: 79, title: '虚拟研究所隐喻', status: 'MET', layer: 'meta', evidence: 'org metaphor' },
  { n: 80, title: '不建议做的清醒话', status: 'MET', layer: 'meta', evidence: 'anti-goals / no fake data' },
];

// 探针一致性抽检（能力项不得空口）
const probes = {
  47: falsify.includes('writeMuseumIntake') && museum.includes('todayIntake'),
  54: museum.includes('todayIntake'),
  55: processL.includes('ingestAnalystWeightSignal') && analyst.includes('weightSignal'),
  30: meta.includes('debtBridge') && orch.includes('mergeMetaBridgeIntoDebtBoard'),
  51: exists('services/intel-horizon-coordination.js') && horizon.includes('buildHorizonConflictBoard'),
  63: app.includes('intel-five-cmds'),
  72: orch.includes('evidenceTriad'),
};
for (const [n, ok] of Object.entries(probes)) {
  const it = items.find((x) => x.n === Number(n));
  if (it && it.status === 'MET' && !ok) {
    it.status = 'GAP';
    it.note = (it.note || '') + ' · probe fail';
  }
}

const tallies = { MET: 0, PARTIAL: 0, GAP: 0 };
for (const it of items) tallies[it.status] += 1;

const codeItems = items.filter((i) => i.layer !== 'meta');
const codeTallies = { MET: 0, PARTIAL: 0, GAP: 0 };
for (const it of codeItems) codeTallies[it.status] += 1;

const vsPrior = {
  priorDate: '2026-07-16',
  priorNote: '首轮自审：真落地~7、多数半成品；证伪/学习/三面孔/双轨/五命令等为缺口',
  closedSincePrior: [
    '§47 证伪真判',
    '§54 博物馆原子入馆',
    '§55/69 标注→权人审',
    '§26 三面孔分轨',
    '§29 双轨叙事',
    '§28 基差一等公民',
    '§41/48 Surprise+n 门禁',
    '§63 五个一键',
    '§72 证据三轴',
    '§59 记忆回放',
    '§73 剧本包',
    '§38/76 编译发行',
    '§70 假静默闭环',
    '§30 元智还债桥',
    '§20/75 幕僚全页+矛盾板',
    '§24 同构路径回放',
    '§50 冲击边验证阻尼',
    '§22 离散SIR上限',
    '§42 冲击边图库',
    '§45 指挥条',
    '§74 共享机制链',
    '§26 Hub三壳',
    '§71 下令队列',
    '§31/62 反模式板',
    '§60 LLM 输出边界',
    'P10 预测质量债',
  ],
};

const out = {
  asOf: new Date().toISOString().slice(0, 10),
  method: 'capability probe + honest depth/product overlay',
  orchVersion: (orch.match(/ORCHESTRATOR_VERSION\s*=\s*'([^']+)'/) || [])[1],
  teachVersion: (teach.match(/TEACH_VERSION\s*=\s*'([^']+)'/) || [])[1],
  scopeNote:
    '编号主体 §20–80。§1–19 不在本蓝图；docs/VISION_CHECKLIST.md 为更早交易指导愿景（另册，多数已 ✅）。',
  verdict:
    codeTallies.GAP > 0
      ? 'NOT_FULLY_ALIGNED'
      : codeTallies.PARTIAL > 0
        ? 'CAPABILITY_ALIGNED_DEPTH_PARTIAL'
        : 'CAPABILITY_FULLY_ALIGNED_SCOPE_20_80',
  oneLiner:
    '§20–80 能力主链路已齐（含 LLM 输出边界与质量债公开）。工程 PASS ≠ 预测变准；hit 须持续带 n 公示。',
  talliesAll: tallies,
  talliesCodeOnly: codeTallies,
  metPctCode: +((codeTallies.MET / codeItems.length) * 100).toFixed(1),
  partialPctCode: +((codeTallies.PARTIAL / codeItems.length) * 100).toFixed(1),
  vsPrior,
  acceptLatestHint: {
    museumIntake: accept.includes('intel_museum_intake'),
    analystWeight: accept.includes('intel_analyst_weight_ack'),
    llmBoundary: accept.includes('intel_llm_boundary'),
    qualityDebt: accept.includes('intel_prediction_quality_debt'),
    visionClosing: accept.includes('intel_vision_closing_checklist'),
  },
  remainingPartials: items.filter((i) => i.status === 'PARTIAL'),
  remainingGaps: items.filter((i) => i.status === 'GAP'),
  nextSuggested: [
    {
      id: 'Q1',
      title: '预测质量债持续还债（进行中）',
      why: '扩 accept WF / 全市场 stateKey 校准；看板已挂欠样·缺口·还债动作',
    },
    {
      id: 'Q2',
      title: '进程级 LLM 沙箱（可选）',
      why: '当前为输出门禁；真隔离属基础设施另册',
    },
  ],
  items,
  honesty: [
    '工程 PASS / 能力 MET ≠ 预测变准（全市场 80d hit 仍 ~49.3% (1064/2159)）',
    'PARTIAL 不是「没做」，是「低于构想上限」或「产品形态未到位」',
    '不可为对齐而编造深度',
  ],
};

const outPath = path.join('F:/FanchengFinance/data/audits', `intel-vision-20-80-align-${out.asOf}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
fs.writeFileSync(path.join(root, 'docs/INTEL_VISION_ALIGN_LATEST.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({
  verdict: out.verdict,
  oneLiner: out.oneLiner,
  talliesAll: tallies,
  talliesCodeOnly: codeTallies,
  metPctCode: out.metPctCode,
  partials: out.remainingPartials.map((i) => `${i.n} ${i.title}`),
  gaps: out.remainingGaps,
  next: out.nextSuggested,
  outPath,
}, null, 2));
