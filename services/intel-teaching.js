/**
 * 情报中心 · 教学层（构想 §78）
 * 教用户如何读当前情报状态；不编造行情结论。
 */
const TEACH_VERSION = 'v2.89.26-teaching';

const LESSONS = [
  {
    id: 'read_memo',
    when: () => true,
    title: '先读备忘录，不看箭头',
    body: '顺序：主判断 → 选择集 → 三支撑 → 一反对 → Unknown Map → 触发器。缺反对的结论不得当 Interrupt。',
  },
  {
    id: 'staff_face',
    when: () => true,
    title: '幕僚面 ≠ 算命面',
    body: '先读备忘录与门禁。信念为不可判定/分歧/证伪中，或弱结构未过 Top5 门禁时：方向箭头与交易指导仅参考，禁止当指令。可行动仅强/弱+门禁。',
  },
  {
    id: 'page_tone_staff',
    when: (ctx) =>
      Boolean(ctx.pageToneBoard?.display) ||
      (ctx.stats?.pageToneArrowHidden || 0) > 0 ||
      (ctx.stats?.pageToneStaff || 0) > 0,
    title: '列表默认幕僚气质，不是方向表',
    body: '行首是观望/备忘录/信念/方案，不是▲▼。红绿底已退场；仅可行动时允许淡色方向辅标。先读 Hub 交付与备忘录。',
  },
  {
    id: 'outlook_memo_primary',
    when: () => true,
    title: '详情先读备忘录硬模板，价格只是参考',
    body: '判断→三支撑→一反对→Unknown→触发器→建议动作。价格/情景折叠在「参考」里，不是主输出。扩展上下文（双轨/剧本/三轴）在折叠区。',
  },
  {
    id: 'contradiction_matrix',
    when: (ctx) =>
      (ctx.contradictionBoard?.counts?.instruments || 0) > 0 ||
      (ctx.stats?.contradictionInstruments || 0) > 0 ||
      (ctx.contradictionBoard?.counts?.withConflict || 0) > 0,
    title: '矛盾矩阵看主矛盾×反对力，不看单轴定调',
    body: 'Hub「矛盾矩阵」汇总主矛盾、反对力与轴冲突 n。缺反对标暂无并进 P1；仓单轴须合证，禁止单独定调。',
  },
  {
    id: 'shift_voice',
    when: (ctx) =>
      Boolean(ctx.shiftVoice?.voiceId) ||
      Boolean(ctx.shift?.voiceId) ||
      Boolean(ctx.statsDisplay?.shiftVoiceLine),
    title: '班次不同，文风不同',
    body: '开盘前清单式、盘中短可行动、收盘后完整复盘、周末还债。同一数据只改叙述气质与截断，不改数值。盘中禁长文；周末禁 Interrupt。',
  },
  {
    id: 'release_product_path',
    when: (ctx) =>
      Boolean(ctx.researchCompile?.releaseId) ||
      Boolean(ctx.releaseProductBoard?.display) ||
      Boolean(ctx.statsDisplay?.releaseLine),
    title: '发行对照看物质 diff，不只看版本号',
    body: '每次 pack 是一次发行：releaseId 快照可回滚对照。产品主路径=今日相对上版的物质 what-changed；模块版本 Δ 只是辅线。无上版快照时显示暂无，禁止假装昨日对照。',
  },
  {
    id: 'face_delivery_rail',
    when: (ctx) =>
      Boolean(ctx.faceContractBoard?.contractOk) ||
      Boolean(ctx.faceViews?.decision?.deliveryBrief) ||
      (ctx.stats?.faceRailOk || 0) > 0,
    title: '三面孔是分轨交付，不是三个 CSS 页签',
    body: '决策：diff+P0+打断；研究：冲击/债务/剧本全追溯；执行：仅证伪/误定价/触发器。切换面孔应换交付简报与省略块，详情也按面孔投影。',
  },
  {
    id: 'weight_human_ack',
    when: (ctx) =>
      Boolean(ctx.processScorecard?.weightProposal?.pendingApproval) ||
      Boolean(ctx.processLearning?.weightProposal?.pendingApproval) ||
      Boolean(ctx.stats?.weightProposalPending) ||
      (ctx.stats?.analystWeightMaterial || 0) > 0,
    title: '过程权变更必须人审',
    body: '归档打分与分析师标注都可生成权提案，禁止静默写入 process-playbook-weights。待审时核对 n（过程≥20 / 标注≥5）与乘数差，再批准或驳回。',
  },
  {
    id: 'header_denominators',
    when: (ctx) => Boolean(ctx.statsDisplay?.deepAttention || ctx.stats?.instrumentCount),
    title: '抬头计数要带分母 k/N',
    body: '深算、证伪中、内外分裂、mispriced 等须相对品种覆盖面，禁止裸整数掩盖样本面。机制用 活·休眠·n不足 三态行。',
  },
  {
    id: 'mechanism_board',
    when: (ctx) =>
      (ctx.mechanismBoard?.counts?.liveActive || ctx.mechanismBoard?.counts?.live || 0) +
        (ctx.mechanismBoard?.counts?.empiricalReady || 0) +
        (ctx.mechanismBoard?.counts?.pendingInsufficientN || 0) +
        (ctx.mechanismBoard?.counts?.pending || 0) >
      0,
    title: '机制边三态：活 / 实证休眠 / n不足',
    body: '活=真激活；实证休眠=有 n≥20+corr 但源冲击不足，不是「无实证」；n不足禁止当活边或编 corr。活边=0 时先看休眠与 n 不足分母。',
  },
  {
    id: 'mechanism_honesty',
    when: (ctx) =>
      (ctx.mechanismBoard?.counts?.honestyDenied || 0) > 0 ||
      (ctx.shockGraph?.mechanismHonestyDenied || 0) > 0 ||
      (ctx.stats?.mechanismHonestyDenied || 0) > 0,
    title: '相关不是成本传导',
    body: 'cost/替代/套利先验若只有滞后相关、无基差/合证/事件，展示必须降为「滞后共动」，禁止写成本传导。补结构证据后才恢复因果话术。',
  },
  {
    id: 'debt_ops',
    when: (ctx) =>
      (ctx.debtBoard?.opsPlan?.pendingRunnable || 0) > 0 ||
      (ctx.debtBoard?.weeklyMustPay || []).some((d) => d.opsRunnable),
    title: 'mustPay 要真还债',
    body: '滞后类债务可点「执行本周必还」触发 sync 并复核；合证/基差/门禁类标人工或 partial，禁止文案假装还清。到期日与 owner 写在周计划上。',
  },
  {
    id: 'memo_retrieval',
    when: () => true,
    title: '备忘录要读检索，不只现场字段',
    body: '决策备忘录含档案/博物馆/同构召回。有命中看 match 与 n；无命中显示「暂无先例」，禁止把空检索当「历史支持」。',
  },
  {
    id: 'meta_intelligence',
    when: (ctx) =>
      (ctx.metaIntelligence?.counts?.total || 0) > 0 ||
      (ctx.stats?.metaBlindSpots || 0) > 0 ||
      ctx.metaIntelligence?.severity === 'clear',
    title: '先看元智能盲区，再信结论',
    body: '元智能板自审：合证/滞后/缺反对/无 n/机制诚实/检索空/权待审等。clear 只代表暂无可审计盲区，不代表全知。临界/高盲区时降档行动。',
  },
  {
    id: 'meta_debt_bridge',
    when: (ctx) =>
      (ctx.metaIntelligence?.debtBridge?.pendingRunnable || 0) > 0 ||
      (ctx.stats?.metaOpsRunnable || 0) > 0,
    title: '元智能盲区要能还债，不只写 remedy',
    body: '合证/滞后等盲区挂 ops：可点「还债」走 sync+复核；注入 mustPay。合证类只标 partial，禁止文案假装还清。',
  },
  {
    id: 'false_quiet_risk',
    when: (ctx) =>
      Boolean(ctx.quietBrakeBoard?.falseQuietRisk) ||
      Boolean(ctx.stats?.falseQuietRisk) ||
      ctx.quietBrakeBoard?.falseQuietLoop?.status === 'open',
    title: '假静默必须闭环：检测→P0→确认',
    body: '日差标静默但有 Interrupt/高惊讶时开环：升 P0、强制清单，确认后归档。不翻转 quietDay 真值；无前日快照则静默不可判定。',
  },
  {
    id: 'evidence_triad',
    when: (ctx) =>
      Boolean(ctx.evidenceTriadBoard?.display) ||
      (ctx.stats?.evidenceTriadHotSoft || 0) > 0 ||
      (ctx.stats?.evidenceTriadColdHard || 0) > 0,
    title: '证据看三轴：温度·硬度·贴合',
    body: '温度=是否对齐最新交易日；硬度=源分级/多源印证；贴合=是否打中命题机制。热而软防叙事绑架；硬而冷禁装新；贴合假进噪音仓。禁止混成单一强度分。',
  },
  {
    id: 'memory_replay',
    when: (ctx) =>
      Boolean(ctx.memoryReplayBoard?.display) ||
      (ctx.stats?.memoryLibraryN || 0) > 0 ||
      (ctx.memoryReplayBoard?.sampleTimelines || []).length > 0,
    title: '记忆层要能检索回放，不是日志堆',
    body: '命题存档/改口履历/失效博物馆可按关键词·品种·claimId 检索，并可回放单命题时间线。无命中显示暂无，禁止编造先例。',
  },
  {
    id: 'n_required',
    when: (ctx) => ctx.claim?.n == null || ctx.claim?.n < 20,
    title: '没有样本量 n 就降信任',
    body: '命中率必须带 n。n&lt;20 时权重最多启发式，场景格概率带会标「暂无/启发式」。',
  },
  {
    id: 'dual_split',
    when: (ctx) => ctx.dual?.regime === 'split' || (ctx.dualBoard?.counts?.split || 0) > 0,
    title: '内外分裂 ≠ 单向行情',
    body: '共振才谈趋势可持续；分裂时选择集偏 C，Interrupt 门禁阻断。优先想套利/波动/政策窗口，置信封顶「叙事分歧」。',
  },
  {
    id: 'attention',
    when: (ctx) => ctx.attention?.computeMode === 'skip' || ctx.attention?.depth === 'silent',
    title: '静默品种不要当深度结论',
    body: '今日真配额下该品种为 skip/lite，复用缓存或轻量体检，不是全市场同等深算。',
  },
  {
    id: 'attention_ration',
    when: (ctx) =>
      (ctx.attentionRationBoard?.counts?.full != null && ctx.attentionRationBoard.counts.full <= 12) ||
      ctx.attentionBudget?.trueRationing === true,
    title: '算力跟问题价值走，不跟品种数走',
    body: '深算硬窗 8–12；lite/skip 必须真跳过红队/惊喜/场景。省算力板带 full/lite/skip 与 N，禁止事后贴标冒充配额。',
  },
  {
    id: 'falsifying',
    when: (ctx) => ctx.claim?.status === 'falsifying' || ctx.claim?.confidence === '证伪进行中',
    title: '证伪进行中：先反对后方向',
    body: '触发器已部分命中。优先核对合证/基差是否相对基线翻转，而不是加仓叙事。',
  },
  {
    id: 'process_vs_dir',
    when: (ctx) => ctx.processLearning?.dirWrongProcessRight > 0 || ctx.processScorecard?.outcome?.dirWrongProcessRight > 0,
    title: '方向错也可能过程对',
    body: '过程 KPI 看反对/触发器/n 是否齐全。方向错但过程对时，不应简单降过程权。',
  },
  {
    id: 'process_ready',
    when: (ctx) => (ctx.processScorecard?.live?.weakN || 0) > 0,
    title: '过程未就绪先还债',
    body: '缺反对、缺触发器或关键 Unknown 缺口时，选择集应偏 C（追踪），不要把弱过程当可行动。',
  },
  {
    id: 'calendar',
    when: (ctx) => ctx.calendarImminent,
    title: '发布窗口读三态',
    body: '发布前看定价了什么；发布后看 surprise；T+3/5/10 看结构是否跟上价格。',
  },
  {
    id: 'calendar_follow',
    when: (ctx) => (ctx.calendarFollow || 0) > 0,
    title: '结构未跟上 = 叙事透支候选',
    body: '日历跟进窗里价格与合证背离时进 P2。样本 scored 为 0 不计分，标暂无。',
  },
  {
    id: 'isomorphic',
    when: (ctx) => (ctx.isomorphicBoard?.counts?.strong || 0) > 0 || (ctx.isomorphicBoard?.counts?.watching || 0) > 0,
    title: '同构要看路径 n，不只主题标签',
    body: '强同构=日K路径 pearson≥0.55 且带 n；era 非定日只记主题。强同构监视 watchSignals，勿把弱相似当复刻。',
  },
  {
    id: 'isomorphic_path_replay',
    when: (ctx) => (ctx.isomorphicBoard?.counts?.pathReplays || 0) > 0 || (ctx.isomorphicPathReplays || 0) > 0,
    title: '同构回放看 hist/recent 窗口，不插值',
    body: '路径回放附真实日K稀疏收盘与窗口起止；缺棒不计分。战役级对照是 pearson 回放，不是合成K或故事复刻。',
  },
  {
    id: 'shock_path',
    when: (ctx) => (ctx.shockActive || 0) > 0,
    title: '冲击路径要看 corr 与 n',
    body: '活冲击图边带滞后相关与样本量。无 n 的边不会激活——这是诚实，不是缺失美化。',
  },
  {
    id: 'shock_dynamics',
    when: (ctx) =>
      (ctx.shockDynamicsBoard?.counts?.awaiting || 0) > 0 ||
      (ctx.shockDynamicsBoard?.counts?.watchSources || 0) > 0 ||
      (ctx.shockDynamicsBoard?.transmissionHit && !ctx.shockDynamicsBoard.transmissionHit.deferred),
    title: '冲击是动力学，不是静态边表',
    body: '点火→待验证→确认/未兑现；盯盘按 lag 排序。传导命中必须带 n；弹性 β 不足标暂无，禁止把 corr 当已验证传导。',
  },
  {
    id: 'shock_edge_verify',
    when: (ctx) =>
      (ctx.shockDynamicsBoard?.counts?.edgeVerifyReady || 0) > 0 || (ctx.shockDynEdgeVerify || 0) > 0,
    title: '边活化要按史命中降权',
    body: '验证档案 n≥5 才可用命中率阻尼激活度；n 不足标暂无，禁止静默把低命中边当强传导。',
  },
  {
    id: 'sharp_claim',
    when: (ctx) =>
      (ctx.claimSharpnessBoard?.counts?.soft || 0) > 0 ||
      (ctx.claimSharpnessBoard?.counts?.missingAgainst || 0) > 0 ||
      (ctx.claimSharpnessBoard?.counts?.sharp || 0) > 0,
    title: '命题必须是可证伪原子，不是套话',
    body: '每条命题要有原子谓词、可观测与「则证伪」。套话压 watch；期号随 side/原子核变化。缺反对不得当强可行动。',
  },
  {
    id: 'scenario_evidence_bound',
    when: (ctx) =>
      (ctx.scenarioLatticeBoard?.counts?.scriptedHeavy || 0) > 0 ||
      (ctx.scenarioLatticeBoard?.counts?.calibrated || 0) > 0 ||
      (ctx.stats?.scenarioScriptedHeavy || 0) > 0,
    title: '场景格要绑证据，不能按多空填 A/B/C',
    body: '每个情景须有触发器/证据绑定；脚本占位禁止赋权。校准权须 n≥20，且仍不是客观概率。',
  },
  {
    id: 'multihop',
    when: (ctx) => (ctx.multiHopBoard?.counts?.total || 0) > 0,
    title: '多跳是乘积不是新相关',
    body: '2 跳 pathCorr = 跳 corr 乘积，n 取 min。半激活/结构链不等于活传导；滞后链进 P3。禁止把多跳当成假单边 corr。',
  },
  {
    id: 'resonance',
    when: (ctx) => (ctx.resonanceBoard?.counts?.diverge || 0) > 0 || (ctx.resonanceBoard?.counts?.lagging || 0) > 0,
    title: '跨品种分化/滞后是问题不是噪音',
    body: '正相关机制下命题对立 = 分化；价格已动对侧未跟 = 滞后。两者进 P3，不要假装全板块同向。',
  },
  {
    id: 'unknown_map',
    when: (ctx) => (ctx.unknownBoard?.totalGaps || 0) > 0,
    title: 'Unknown Map 是一等输出',
    body: '关键缺口带最短补齐路径与置信降档。禁止用假数填洞；还债优先于新叙事。',
  },
  {
    id: 'narrative_ahead',
    when: (ctx) => (ctx.narrativeContagion?.counts?.ahead || 0) > 0,
    title: '叙事超前于结构 = 绑架风险',
    body: 'spreading/peak 但合证未跟时，优先质疑故事而非加仓。传染分必须带 tagged n。',
  },
  {
    id: 'narrative_transmission',
    when: (ctx) => (ctx.narrativeContagion?.counts?.transmissionEdges || 0) > 0,
    title: '叙事传染看跨品种滞后，不看关键词热度',
    body: '种子→采纳的滞后日数与 R₀(采纳/种子·带 n) 才是流行病学。单品种标题词涨只能叫热度，不能叫传染。',
  },
  {
    id: 'narrative_compartment',
    when: (ctx) =>
      (ctx.narrativeContagion?.compartmentCounts?.active || 0) > 0 ||
      (ctx.narrativeContagion?.counts?.seeds || 0) > 0,
    title: '仓室计数不是微分方程 SIR',
    body: '种子/采纳/扩散/疲劳是离散仓室快照；禁止把 compartmentCounts 当成连续时间 SIR 拟合结果。',
  },
  {
    id: 'narrative_sir_ceiling',
    when: (ctx) =>
      ctx.narrativeContagion?.sirCensus?.available ||
      ctx.narrativeContagion?.sirCeiling ||
      (ctx.stats?.sirCensusAvailable || 0) > 0,
    title: '叙事上限=离散 S/I/R + 滞后 n，拒绝 ODE',
    body: 'S/I/R 是日切仓室；中位滞后须 n≥2。sirCeiling.odeFitted 恒为 false——曲线不是拟合传播方程。',
  },
  {
    id: 'shock_edge_catalog',
    when: (ctx) =>
      (ctx.shockGraph?.edgeCatalog?.counts?.catalog || 0) > 0 ||
      (ctx.stats?.edgeCatalogVerified || 0) > 0,
    title: '边图库只收录已评估候选边',
    body: '图库=候选边 corr/n + 验证命中；不发明新边。验证 n 不足命中标暂无。',
  },
  {
    id: 'shared_mechanism_chain',
    when: (ctx) =>
      (ctx.mechanismBoard?.counts?.sharedChainsWithN || 0) > 0 ||
      (ctx.stats?.sharedMechChains || 0) > 0,
    title: '共享机制链看跨品种覆盖，不看散文复述',
    body: '同机制先验下的边聚成链；覆盖=真实评估环数。无 corr/n 标暂无，禁止当独立因果引擎。',
  },
  {
    id: 'commander_workbar',
    when: (ctx) => Boolean(ctx.commanderWorkbar?.available) || (ctx.stats?.commanderPending || 0) > 0,
    title: '指挥条绑定五键与真实待办',
    body: '决策面工作条汇总打断/债/权审/假静默待办。这是指挥体验加深，不是独立 OS。',
  },
  {
    id: 'face_shell_layout',
    when: (ctx) =>
      Boolean(ctx.faceContractBoard?.shellsDiffer) ||
      (ctx.stats?.shellsDiffer || 0) > 0 ||
      Boolean(ctx.shellLayout?.shellLayoutId),
    title: '三面孔是三套壳，不是同文三藏',
    body: '决策 cmd-brief / 研究 lab-depth / 执行 trigger-strip。壳布局不同才算分轨；仍是 Hub 内三壳，不是三套独立应用。',
  },
  {
    id: 'commander_order_queue',
    when: (ctx) =>
      (ctx.commanderWorkbar?.orderQueue?.pending || 0) > 0 ||
      (ctx.stats?.commanderOrders || 0) > 0,
    title: '下令队列绑定真实 ops',
    body: '决策壳下令队列复用打断确认/债运维/权审/假静默 ack。禁止另起假按钮总线。',
  },
  {
    id: 'anti_pattern_board',
    when: (ctx) =>
      (ctx.antiPatternBoard?.counts?.hitRows || 0) > 0 ||
      (ctx.stats?.antiPatternHits || 0) > 0,
    title: '反模式板看今日违规，不只看规则文档',
    body: '假数/缺 n/相关当因果/叙事超前等仅当 pack 真命中才列。零命中显示暂无，禁止编造示例。',
  },
  {
    id: 'llm_boundary',
    when: (ctx) =>
      Boolean(ctx.llmBoundaryBoard?.outputGate) || (ctx.stats?.llmBoundaryReady || 0) > 0,
    title: 'LLM 只润色，数值以结构化为准',
    body: '输出侧硬拦编造价格/裸%/无溯源命中率；拦检失败回退规则文案。这是策略门禁，不是进程级沙箱。',
  },
  {
    id: 'prediction_quality_debt',
    when: (ctx) =>
      Boolean(ctx.qualityDebtBoard?.display) ||
      Boolean(ctx.stats?.qualityDebtHit) ||
      (ctx.qualityDebtBoard?.sampleDebt?.undersampled || []).length > 0 ||
      (ctx.qualityDebtBoard?.repayment?.items || []).length > 0,
    title: '质量债：工程 PASS ≠ 预测变准',
    body: '方向命中与过程正确必须分开带 n；欠样/校准缺口/还债动作公开。禁止宣称命中已提升；还债靠扩样本与重校准。',
  },
  {
    id: 'evidence_stale',
    when: (ctx) => (ctx.evidenceFreshnessBoard?.blockingCount || 0) > 0 || (ctx.evidenceFreshnessBoard?.staleInstrumentCount || 0) > 0,
    title: '陈旧证据不能撑 Interrupt',
    body: '关键证据严重滞后时打断门禁降档。缺失 lag 标暂无，不假装新鲜。',
  },
  {
    id: 'horizon_conflict',
    when: (ctx) => (ctx.horizonConflictBoard?.counts?.conflict || 0) > 0,
    title: '三尺度冲突禁止合成箭头',
    body: '战术与结构对立时分开表述；选择集偏 C（追踪）。不要加权出一个假「综合方向」。',
  },
  {
    id: 'museum_intake',
    when: (ctx) =>
      (ctx.museumBoard?.counts?.todayIntake || 0) > 0 ||
      (ctx.museumBoard?.todayIntake?.todayN || 0) > 0 ||
      (ctx.stats?.museumTodayIntake || 0) > 0,
    title: '证伪必须真写入博物馆',
    body: '状态落到 falsified/expired 时原子写入 failure-museum.jsonL（单条、可愈合）。Hub 看「今日入馆 n」；空日显示 0，禁止编造入馆。',
  },
  {
    id: 'museum_review',
    when: (ctx) => (ctx.museumBoard?.counts?.entries || 0) > 0 || (ctx.museumBoard?.counts?.activeWarnings || 0) > 0,
    title: '失效博物馆是复盘资产不是耻辱墙',
    body: '每条证伪带来触发器与教训分型。现役命题落在近90日失效品种上时进 P2。重复证伪并入本周必还债务。',
  },
  {
    id: 'analyst_weight_ack',
    when: (ctx) =>
      Boolean(ctx.processScorecard?.weightProposal?.analystContribution?.signalN) ||
      (ctx.stats?.analystWeightSignals || 0) > 0 ||
      (ctx.processScorecard?.weightProposal?.analystContribution?.materialWithAnalyst || 0) > 0,
    title: '标注可改权提案，但不能静默落盘',
    body: '可靠/噪音/操纵标注写入权重信号；n≥5 才进 playbook 权提案。批准/驳回前生效权不变。可靠性表可即时调硬度，过程权必须人审。',
  },
  {
    id: 'debt_weekly',
    when: (ctx) => (ctx.debtBoard?.weeklyMustPay?.length || 0) > 0,
    title: '问题债务要按周还',
    body: '优先还阻断发布项（滞后/合证/关键 Unknown）。博物馆重复证伪也进 mustPay。不还债的系统会慢慢学会说谎。',
  },
  {
    id: 'shift_discipline',
    when: (ctx) => Boolean(ctx.shift?.id || ctx.shiftDiscipline?.shiftId || ctx.shiftVoice?.voiceId),
    title: '班次不同，权限与文风都不同',
    body: '盘中禁长文、只盯证伪/打断；周末禁 Interrupt、优先博物馆与还债。Hub 标题与导语随班次文风切换，数值不变。',
  },
  {
    id: 'interrupt_channel',
    when: (ctx) =>
      (ctx.interruptChannel?.pendingCount || 0) > 0 ||
      (ctx.interruptChannel?.shiftDeniedCount || 0) > 0 ||
      Boolean(ctx.interruptChannel?.commandDeck?.active),
    title: 'Interrupt 是指挥通道，不是列表闪一下',
    body: '指挥台：待确认→确认归档 / 消音4h。催办超时升档。OS 通知仅在 Electron 真派发后记账；否则只认 Hub+文件回执。班次拒投记 shift_denied。',
  },
  {
    id: 'anti_manipulation',
    when: (ctx) =>
      (ctx.antiManipulationBoard?.counts?.total || 0) > 0 ||
      (ctx.stats?.manipulationFlagged || 0) > 0 ||
      (ctx.stats?.manipulationWatching || 0) > 0,
    title: '反操纵：人工硬旗 + 自动观察',
    body: '人工 manipulation_risk 硬阻断 Interrupt/Top5。自动扫描叙事超前/新闻单源/放量故事等可观察信号：多信号硬旗，单信号仅降新闻硬度并待人审。禁止操纵评分。',
  },
  {
    id: 'face_compute',
    when: (ctx) => Boolean(ctx.faceComputeBoard?.display),
    title: '面孔升档不是三遍全算',
    body: '决策主算；研究/执行只对升档名单补跑 full（有上限）。算力台账落盘可审计；接近全市场升档会触发完整性告警。',
  },
  {
    id: 'evidence_audit',
    when: (ctx) => (ctx.evidenceAuditBoard?.counts?.problemInstruments || 0) > 0,
    title: '证据 DSL 要可审计',
    body: '每条证据看类型/方向/源/n。active 命题缺 against 进 P1；假数据模式 critical。n 缺失标暂无，不填假样本。',
  },
  {
    id: 'red_team_ingest',
    when: (ctx) => (ctx.redTeamBoard?.counts?.dissentDebt || 0) > 0 || (ctx.redTeamBoard?.counts?.ingestedTotal || 0) > 0,
    title: '红队反对必须入库，找不到就标债',
    body: '红队论据写入 Evidence DSL against。仍无 against 标 dissentDebt 并降为 watch，禁止编造反对句撑门禁。',
  },
  {
    id: 'playbook_statemachine',
    when: (ctx) =>
      (ctx.playbookBoard?.transitionCount || 0) > 0 ||
      (ctx.playbookBoard?.switchedCount || 0) > 0 ||
      (ctx.playbookBoard?.regimeFlipCount || 0) > 0 ||
      (ctx.stats?.playbookRegimeFlips || 0) > 0,
    title: '合证 regime 是剧本，不是改权标签',
    body: '进入结构剧本注入默认反对/证伪触发/时钟；离开强制 what-changed。过程权须 n≥20 且族匹配；剧本外禁止套用该桶校准权。',
  },
  {
    id: 'playbook_regime_script',
    when: (ctx) =>
      (ctx.playbookBoard?.withRegimePack || 0) > 0 ||
      (ctx.playbookBoard?.regimeFlipCount || 0) > 0 ||
      (ctx.stats?.playbookRegimePacks || 0) > 0,
    title: '剧本切换要换触发器，不只换名字',
    body: 'RP-DESTOCK / RP-BUILD 等脚本包决定默认证伪与反对。看到 regime 翻转时，先核对主矛盾与时钟是否已换包。',
  },
  {
    id: 'quiet_discipline',
    when: (ctx) =>
      Boolean(ctx.quietBrakeBoard?.quietDay) ||
      ctx.dailyDiff?.available === false ||
      (ctx.quietBrakeBoard?.quietStreak?.streak || 0) >= 2,
    title: '静默要靠物质变更，不是靠少问',
    body: '无前日快照时静默不可判定。剧本/定价/红队/刹车/缺口任一变化都不算静默。连续静默要复核日差是否漏记。',
  },
  {
    id: 'confidence_brake',
    when: (ctx) => Boolean(ctx.quietBrakeBoard?.brake?.active || ctx.confidenceBrake?.active),
    title: '强结构超额必刹车',
    body: '全市场「强结构」超配额强制降弱结构。降档进日差与刹车归档，不靠口头谦虚。',
  },
  {
    id: 'memo_export',
    when: (ctx) => (ctx.externalBriefBoard?.counts?.withMemo || 0) > 0,
    title: '备忘录是可导出的最小发布单元',
    body: '复制/导出用硬模板：主判断+三支撑+一反对+触发器+Unknown+动作。门禁未过必须带诚实声明，禁止空字段填假。',
  },
  {
    id: 'analyst_journal',
    when: (ctx) =>
      (ctx.analystJournalBoard?.counts?.total || 0) > 0 ||
      (ctx.analystJournalBoard?.counts?.liveFrozen || 0) > 0 ||
      (ctx.analystJournalBoard?.counts?.liveVetoed || 0) > 0,
    title: '人 Δ 要进日记板，不只点按钮',
    body: '冻结/否决/剧本覆写/操纵标注进跨品种日记。现役否决阻断发布；无人标注但有现役冻结要例行复核。',
  },
  {
    id: 'pricing_clock',
    when: (ctx) =>
      (ctx.pricingClockBoard?.counts?.mispriced || 0) > 0 ||
      (ctx.pricingClockBoard?.counts?.clockDue || 0) > 0 ||
      (ctx.pricingClockBoard?.counts?.clockExpired || 0) > 0,
    title: '定价背离与证伪时钟是指挥官面',
    body: 'mispriced 优先红队+深度；时钟过期先改命题状态。已定价禁重复利好打断。daysLeft 缺失标暂无。',
  },
  {
    id: 'weight_honesty',
    when: (ctx) => true,
    title: '场景权不是客观概率',
    body: 'n&lt;20 或未校准时场景/选择权必须为「暂无」，禁止 w=0.xx。已校准也须带 n，且注明仍非客观概率。',
  },
  {
    id: 'interrupt_n',
    when: (ctx) =>
      (ctx.interruptChannel?.pendingCount || 0) > 0 ||
      (ctx.kpis?.panels || []).length > 0 ||
      Boolean(ctx.kpis?.interruptQuality),
    title: 'Interrupt 与 KPI 必须亮样本量 n',
    body: '打断行：score · surprise n · 门槛 n≥20（n=暂无则不合格）。KPI 面板一律 a/b 或「暂无」，方向命中禁止裸 %。过程正确优先于方向命中。',
  },
];

function buildTeachingPack(ctx = {}) {
  const lessons = LESSONS.filter((l) => {
    try {
      return l.when(ctx);
    } catch {
      return false;
    }
  }).slice(0, 5);

  return {
    version: TEACH_VERSION,
    lessonCount: lessons.length,
    lessons: lessons.map((l) => ({ id: l.id, title: l.title, body: l.body })),
    display: lessons.length ? `教学 ${lessons.length} 条 · ${lessons[0].title}` : '教学·暂无上下文',
    dataSource: 'intel-teaching',
    method: 'context-triggered-lessons',
  };
}

function buildTeachingForInstrument(inst, pack) {
  return buildTeachingPack({
    claim: inst?.intelCenter?.primaryClaim,
    dual: inst?.intelCenter?.dualNarrative,
    attention: inst?.intelCenter?.attention,
    processLearning: pack?.processLearning,
    calendarImminent: (pack?.intelligenceCalendar?.imminentCount || 0) > 0,
    shockActive: pack?.shockGraph?.activeCount || 0,
  });
}

module.exports = {
  TEACH_VERSION,
  LESSONS,
  buildTeachingPack,
  buildTeachingForInstrument,
};
