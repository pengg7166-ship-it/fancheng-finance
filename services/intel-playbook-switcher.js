/**
 * 情报中心 · Playbook 切换器（构想 §73）
 * 合证 regime = 结构剧本（脚本包）；政策决策树 = 叠加层。
 * 进入剧本：注入默认反对/证伪触发/时钟模板；离开：强制 what-changed。
 * 过程权仅在「剧本族匹配且 n≥20」时允许；禁止无 n 改权。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { runPlaybookDecisionTree } = require('./playbook-decision-tree');
const { loadPlaybooks } = require('./policy-playbook-engine');
const { lookupProcessMultiplier, loadPlaybookWeights } = require('./intel-process-learning');
const { loadAnnotationsForInstrument } = require('./intel-analyst-workbench');

const PLAYBOOK_SWITCH_VERSION = 'v2.89.13-regime-script-pack';
const SNAPSHOT_FILE = 'playbook-state-snapshot.json';

/**
 * 合证 regime → 结构剧本脚本包（非假数据：条件模板 + 可审计 dataSource）
 */
const REGIME_SCRIPT_PACKS = Object.freeze({
  destock_oi_up: {
    id: 'RP-DESTOCK-OI-UP',
    title: '去库+增仓·紧库存',
    sideHint: 'bull',
    allowFamilies: ['destock_oi_up'],
    mainContradiction: '库存去化与增仓共振 → 紧库存交易偏多',
    oppositionDefault: '若合证翻转为累库或增仓打断去库，则对侧成立',
    falsifyHorizonDays: 10,
    enterNote: '进入紧库存剧本：默认证伪=合证翻转；权重仅限 destock_oi_up 族',
    exitNote: '离开紧库存剧本：禁止继续套用去库+增仓校准权',
    triggers: [
      { type: 'falsify', predicate: 'stock_flow_regime_flip', condition: '合证离开 destock_oi_up' },
      { type: 'upgrade', predicate: 'regime_reinforce', condition: '去库延续且基差/近月配合' },
    ],
  },
  build_oi_up: {
    id: 'RP-BUILD-OI-UP',
    title: '累库+增仓·抛压',
    sideHint: 'bear',
    allowFamilies: ['build_oi_up'],
    mainContradiction: '累库与增仓共振 → 抛压/承压交易偏空',
    oppositionDefault: '若合证翻转为去库或增仓消退，则对侧成立',
    falsifyHorizonDays: 10,
    enterNote: '进入抛压剧本：默认证伪=合证翻转；权重仅限 build_oi_up 族',
    exitNote: '离开抛压剧本：禁止继续套用累库+增仓校准权',
    triggers: [
      { type: 'falsify', predicate: 'stock_flow_regime_flip', condition: '合证离开 build_oi_up' },
      { type: 'upgrade', predicate: 'regime_reinforce', condition: '累库延续且近月贴水扩大' },
    ],
  },
  destock_oi_down: {
    id: 'RP-DESTOCK-OI-DOWN',
    title: '去库+减仓·修复犹豫',
    sideHint: 'flat',
    allowFamilies: ['destock_oi_down'],
    mainContradiction: '去库但减仓 → 修复未获资金确认，禁止强趋势',
    oppositionDefault: '若增仓回流确认去库，可升级；若转累库则证伪偏多叙事',
    falsifyHorizonDays: 7,
    enterNote: '进入犹豫剧本：默认观望，禁止强结构',
    exitNote: '离开犹豫剧本：须重绑证伪时钟',
    triggers: [
      { type: 'falsify', predicate: 'stock_flow_regime_flip', condition: '合证离开 destock_oi_down' },
      { type: 'upgrade', predicate: 'capital_confirm', condition: '减仓转为增仓且去库延续' },
    ],
  },
  build_oi_down: {
    id: 'RP-BUILD-OI-DOWN',
    title: '累库+减仓·抛压缓解',
    sideHint: 'flat',
    allowFamilies: ['build_oi_down'],
    mainContradiction: '累库但减仓 → 抛压缓解，空头叙事弱化',
    oppositionDefault: '若增仓回流确认累库，空头可升级；若转去库则证伪偏空叙事',
    falsifyHorizonDays: 7,
    enterNote: '进入抛压缓解剧本：默认降档，禁止强空',
    exitNote: '离开缓解剧本：须重绑证伪时钟',
    triggers: [
      { type: 'falsify', predicate: 'stock_flow_regime_flip', condition: '合证离开 build_oi_down' },
      { type: 'upgrade', predicate: 'capital_confirm', condition: '减仓转为增仓且累库延续' },
    ],
  },
});

function getIntelDir() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const dir = path.join(dataDir, 'intel-center');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadPlaybookSnapshot() {
  const dir = getIntelDir();
  if (!dir) return null;
  const fp = path.join(dir, SNAPSHOT_FILE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function savePlaybookSnapshot(board, asOf) {
  const dir = getIntelDir();
  if (!dir || !board) return false;
  const byInstrument = {};
  for (const row of board.rows || []) {
    byInstrument[row.instrumentId] = {
      activeId: row.activeId,
      stage: row.stage,
      switchSource: row.switchSource,
      stateKey: row.stateKey,
      regimeKey: row.regimeKey || null,
      regimePlaybookId: row.regimePlaybookId || null,
      policyPlaybookId: row.policyPlaybookId || null,
    };
  }
  fs.writeFileSync(
    path.join(dir, SNAPSHOT_FILE),
    JSON.stringify(
      {
        version: PLAYBOOK_SWITCH_VERSION,
        asOf: asOf || new Date().toISOString().slice(0, 10),
        savedAt: new Date().toISOString(),
        byInstrument,
        method: 'playbook-state-snapshot',
        dataSource: 'intel-playbook-switcher',
      },
      null,
      2
    ),
    'utf8'
  );
  return true;
}

function catalogPlaybooks() {
  try {
    return (loadPlaybooks() || []).map((p) => ({
      id: p.id,
      title: p.title || p.id,
      stage: p.stage || null,
    }));
  } catch {
    return [];
  }
}

function readPinnedPlaybook(instrumentId) {
  const anns = loadAnnotationsForInstrument(instrumentId, 40);
  for (let i = anns.length - 1; i >= 0; i -= 1) {
    const a = anns[i];
    if (a.annotationType === 'playbook_pin' && a.target) {
      return { playbookId: String(a.target), reason: a.reason || null, analyst: a.analyst || 'local' };
    }
    if (a.annotationType === 'playbook_clear') return null;
  }
  return null;
}

function extractRegimeKey(inst) {
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  if (!sf?.available) return null;
  const key = sf.primaryRegime || null;
  if (!key || key === 'insufficient' || key === 'flat' || key === 'oi_only') return null;
  return String(key);
}

function lookupScriptPack(regimeKey) {
  if (!regimeKey) return null;
  return REGIME_SCRIPT_PACKS[regimeKey] || null;
}

function familyFromStateKey(stateKey) {
  const parts = String(stateKey || '').split('|');
  const joint = parts[1] || '';
  if (!joint || joint === 'joint_off' || joint === 'joint_soft') return null;
  if (joint === 'joint_on') return 'build_oi_up';
  if (joint === 'joint_mixed') return 'joint_mixed';
  return joint;
}

function addDaysIso(asOf, days) {
  const d = new Date(`${asOf || new Date().toISOString().slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/**
 * 解析当前品种 playbook 上下文；结构剧本优先于政策树标签。
 * overrideId 仍可钉政策/结构 id（分析师覆写）。
 */
function resolvePlaybookContext(inst, opts = {}) {
  const tree = runPlaybookDecisionTree(inst, opts.treeContext || {});
  const autoPolicyId = tree.primaryPlaybook && tree.primaryPlaybook !== '—' ? tree.primaryPlaybook : null;
  const pinned = opts.overrideId ? null : readPinnedPlaybook(inst?.id);
  const overrideId = opts.overrideId || pinned?.playbookId || null;

  const regimeKey = extractRegimeKey(inst);
  const scriptPack = lookupScriptPack(regimeKey);
  const autoRegimeId = scriptPack?.id || null;

  // 覆写可钉 RP-* 或 PB-*；无覆写时结构剧本优先作为 activeId
  let activeId = null;
  let switchSource = 'none';
  if (overrideId) {
    activeId = overrideId;
    switchSource = opts.overrideId ? 'session' : 'analyst_pin';
  } else if (autoRegimeId) {
    activeId = autoRegimeId;
    switchSource = 'regime_script_pack';
  } else if (autoPolicyId) {
    activeId = autoPolicyId;
    switchSource = 'decision_tree';
  }

  const catalog = catalogPlaybooks();
  const regimeMeta = scriptPack
    ? { id: scriptPack.id, title: scriptPack.title }
    : null;
  const policyMeta = catalog.find((p) => p.id === (overrideId && String(overrideId).startsWith('PB-') ? overrideId : autoPolicyId)) ||
    (autoPolicyId ? { id: autoPolicyId, title: tree.primaryPlaybookTitle || autoPolicyId } : null);

  const packByActiveId = Object.values(REGIME_SCRIPT_PACKS).find((p) => p.id === activeId);
  const activeMeta =
    (scriptPack && activeId === scriptPack.id && regimeMeta) ||
    catalog.find((p) => p.id === activeId) ||
    (packByActiveId ? { id: packByActiveId.id, title: packByActiveId.title } : null) ||
    { id: activeId, title: activeId };

  const activeTitle = activeMeta.title || activeId || '暂无';

  const switched = Boolean(
    overrideId &&
      ((autoRegimeId && overrideId !== autoRegimeId) ||
        (autoPolicyId && overrideId !== autoPolicyId))
  );

  const alternatives = [
    ...(autoRegimeId ? [{ id: autoRegimeId, role: 'regime', title: scriptPack.title }] : []),
    ...(autoPolicyId ? [{ id: autoPolicyId, role: 'auto', title: tree.primaryPlaybookTitle || autoPolicyId }] : []),
    ...(tree.overlayPlaybooks || []).map((id) => ({ id, role: 'overlay', title: id })),
    ...(tree.alternativesRejected || []).slice(0, 4).map((id) => ({ id, role: 'rejected', title: id })),
  ].filter((a, i, arr) => a.id && arr.findIndex((x) => x.id === a.id) === i);

  const stateKey = inst?.intelligenceKernel?.stateKey || inst?.intelCenter?.primaryClaim?.stateKey || null;
  const family = familyFromStateKey(stateKey) || regimeKey;
  const weightKey = activeId && stateKey ? `${stateKey}|${activeId}` : stateKey;
  let processWeight = lookupProcessMultiplier(weightKey);
  if (!processWeight.available && stateKey) {
    processWeight = lookupProcessMultiplier(stateKey);
  }

  const weightsFile = loadPlaybookWeights();
  const pbRow = activeId ? weightsFile.byStateKey?.[`${stateKey}|${activeId}`] : null;
  const weightN = processWeight.n ?? pbRow?.n ?? null;
  const nOk = weightN != null && weightN >= 20;
  const familyInPack =
    !scriptPack ||
    !family ||
    (scriptPack.allowFamilies || []).includes(family) ||
    family === regimeKey;
  const weightAllowed = Boolean(nOk && familyInPack);

  // 相对快照的 regime 翻转（两侧皆有合证才算真翻转；单侧缺失=数据缺口，不冒充换剧本）
  const prior = opts.priorSnapshot || (!opts.skipPrior ? loadPlaybookSnapshot() : null);
  const prev = prior?.byInstrument?.[inst?.id];
  let regimeFlip = null;
  if (prev?.regimeKey && regimeKey && prev.regimeKey !== regimeKey) {
    const prevRp = prev.regimePlaybookId || null;
    const curRp = scriptPack?.id || null;
    regimeFlip = {
      fromRegime: prev.regimeKey,
      toRegime: regimeKey,
      fromPack: prevRp || '暂无',
      toPack: curRp || '暂无',
      whatChanged: `合证regime翻转 ${prev.regimeKey}→${regimeKey}`,
      leftPack: prevRp && prevRp !== curRp ? prevRp : null,
      enteredPack: curRp && curRp !== prevRp ? curRp : null,
    };
  }

  return {
    version: PLAYBOOK_SWITCH_VERSION,
    available: Boolean(activeId),
    activeId,
    activeTitle,
    stage: tree.stage || null,
    autoId: autoRegimeId || autoPolicyId,
    autoTitle: scriptPack?.title || tree.primaryPlaybookTitle || autoPolicyId,
    autoRegimeId,
    autoPolicyId,
    policyPlaybookId: autoPolicyId,
    regimeKey,
    regimePlaybookId: scriptPack?.id || null,
    scriptPack: scriptPack
      ? {
          id: scriptPack.id,
          title: scriptPack.title,
          sideHint: scriptPack.sideHint,
          mainContradiction: scriptPack.mainContradiction,
          enterNote: scriptPack.enterNote,
          allowFamilies: scriptPack.allowFamilies,
          falsifyHorizonDays: scriptPack.falsifyHorizonDays,
        }
      : null,
    overrideId: overrideId || null,
    pinned: pinned || null,
    switched,
    switchSource,
    overlays: tree.overlayPlaybooks || [],
    alternatives,
    confidence: tree.confidence ?? null,
    confidenceDisplay: tree.confidence != null ? `${Math.round(tree.confidence * 100)}%` : '暂无',
    n: weightN,
    nDisplay: processWeight.nDisplay || (weightN != null ? String(weightN) : '暂无'),
    processMultiplier: weightAllowed ? processWeight.multiplier : 1,
    processWeight: weightAllowed
      ? processWeight
      : {
          ...processWeight,
          available: false,
          note: !familyInPack
            ? '剧本族不匹配·禁止套用该桶权'
            : weightN == null
              ? 'n暂无·不改权'
              : `n=${weightN}<20·不改权`,
        },
    weightGate: {
      allowed: weightAllowed,
      n: weightN,
      nDisplay: weightN != null ? String(weightN) : '暂无',
      familyInPack,
      family: family || null,
      note: weightAllowed
        ? '过程权可用（族匹配）'
        : !familyInPack
          ? '剧本外禁止套用该桶校准权'
          : 'n不足禁止改过程权',
    },
    regimeFlip,
    whatChanged: regimeFlip?.whatChanged || null,
    stateKey,
    tree: {
      badge: tree.badge,
      q0: tree.q0,
      logicChain: (tree.logicChain || []).slice(0, 6),
      dataSource: tree.dataSource,
    },
    catalog: catalog.slice(0, 24),
    display: activeId
      ? [
          `剧本 ${activeId}`,
          scriptPack ? `合证 ${regimeKey}` : null,
          autoPolicyId && activeId !== autoPolicyId ? `政策 ${autoPolicyId}` : null,
          switched ? `覆写自 ${autoRegimeId || autoPolicyId}` : null,
          tree.stage || null,
          weightAllowed ? `过程权×${processWeight.multiplier} (n=${weightN})` : '过程权暂无',
          regimeFlip ? '·regime翻转' : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'Playbook 暂无匹配',
    dataSource: 'intel-playbook-switcher',
    method: 'regime-script-pack+decision-tree+analyst-pin+n-gate+family-gate',
  };
}

/**
 * 真正换剧本：注入脚本包默认反对/触发器/时钟；离开时写 what-changed。
 * 禁止造假行情；模板标 dataSource=regime-script-pack，n=暂无。
 */
function applyScriptPackToClaim(claim, playbookCtx, asOf) {
  if (!claim) return claim;
  const pack =
    (playbookCtx?.regimeKey && REGIME_SCRIPT_PACKS[playbookCtx.regimeKey]) ||
    Object.values(REGIME_SCRIPT_PACKS).find((p) => p.id === playbookCtx?.scriptPack?.id) ||
    null;
  const flip = playbookCtx?.regimeFlip;

  let out = {
    ...claim,
    playbookId: playbookCtx?.activeId || claim.playbookId,
    playbookStage: playbookCtx?.stage || claim.playbookStage,
    playbookSwitched: Boolean(playbookCtx?.switched),
    regimePlaybookId: playbookCtx?.regimePlaybookId || null,
    policyPlaybookId: playbookCtx?.policyPlaybookId || null,
    regimeKey: playbookCtx?.regimeKey || null,
  };

  if (pack) {
    out.playbookScriptPack = {
      id: pack.id,
      title: pack.title,
      sideHint: pack.sideHint,
      mainContradiction: pack.mainContradiction,
      enterNote: pack.enterNote,
      dataSource: 'regime-script-pack',
    };

    // 缺反对 → 注入剧本默认反对（条件模板，非假数）
    if (!(out.evidenceAgainst || []).length && pack.oppositionDefault) {
      out.evidenceAgainst = [
        {
          summary: pack.oppositionDefault,
          dataSource: 'regime-script-pack',
          nDisplay: '暂无',
          role: 'playbook-default-opposition',
          method: 'script-pack-enter',
        },
      ];
      out.playbookInjectedAgainst = true;
    }

    // 合并剧本触发器（去重 condition）
    const existing = out.triggers || [];
    const seen = new Set(existing.map((t) => t.condition));
    const injected = [];
    for (const t of pack.triggers || []) {
      if (seen.has(t.condition)) continue;
      injected.push({
        ...t,
        dataSource: 'regime-script-pack',
        playbookBound: true,
      });
      seen.add(t.condition);
    }
    if (injected.length) {
      out.triggers = [...injected, ...existing].slice(0, 6);
      out.playbookInjectedTriggers = injected.length;
    }

    if (!out.validUntil && pack.falsifyHorizonDays) {
      const until = addDaysIso(asOf || out.baselineDate, pack.falsifyHorizonDays);
      if (until) {
        out.validUntil = until;
        out.playbookClockTemplate = {
          days: pack.falsifyHorizonDays,
          dataSource: 'regime-script-pack',
        };
      }
    }

    if (!out.otherwiseFalsify && pack.oppositionDefault) {
      out.otherwiseFalsify = pack.oppositionDefault;
    }
  }

  if (flip) {
    out.regimeFlip = true;
    out.whatChanged = flip.whatChanged;
    out.playbookTransition = {
      kind: 'regime_flip',
      from: flip.fromPack,
      to: flip.toPack,
      fromRegime: flip.fromRegime,
      toRegime: flip.toRegime,
      leftNote:
        flip.leftPack &&
        Object.values(REGIME_SCRIPT_PACKS).find((p) => p.id === flip.leftPack)?.exitNote,
      enterNote:
        flip.enteredPack &&
        Object.values(REGIME_SCRIPT_PACKS).find((p) => p.id === flip.enteredPack)?.enterNote,
      dataSource: 'playbook-state-snapshot',
    };
    // 离开旧剧本：若仍挂着旧族过程权标记，清除（禁止剧本外套权）
    if (!playbookCtx.weightGate?.allowed) {
      out.processMultiplier = undefined;
      out.playbookWeightBlocked = true;
    }
  }

  if (
    playbookCtx?.weightGate?.allowed &&
    playbookCtx.processMultiplier != null &&
    playbookCtx.processMultiplier !== 1
  ) {
    out.processMultiplier = playbookCtx.processMultiplier;
  } else if (playbookCtx && !playbookCtx.weightGate?.allowed) {
    out.playbookWeightBlocked = true;
    out.playbookWeightBlockReason = playbookCtx.weightGate?.note || '剧本/ n 门禁';
  }

  return out;
}

function applyPlaybookToClaim(claim, playbookCtx, asOf) {
  if (!claim || !playbookCtx?.activeId) return claim;
  return applyScriptPackToClaim(claim, playbookCtx, asOf);
}

function buildPlaybookBoard(instruments, opts = {}) {
  const prior = opts.skipSnapshot ? null : loadPlaybookSnapshot();
  const byId = {};
  let switched = 0;
  let withPb = 0;
  let withRegime = 0;
  let regimeFlipCount = 0;
  const rows = [];
  const transitions = [];
  const questions = [];

  for (const inst of instruments || []) {
    const pb = inst.intelCenter?.playbook;
    if (!pb?.activeId) continue;
    withPb += 1;
    if (pb.regimePlaybookId) withRegime += 1;
    if (pb.switched) switched += 1;
    const id = pb.activeId;
    if (!byId[id]) byId[id] = { id, title: pb.activeTitle, count: 0, switched: 0 };
    byId[id].count += 1;
    if (pb.switched) byId[id].switched += 1;

    const prev = prior?.byInstrument?.[inst.id];
    let transition = null;

    // 优先：合证 regime 翻转 = 真剧本切换（两侧皆有 regime，且至少一侧有结构包）
    if (prev?.regimeKey && pb.regimeKey && prev.regimeKey !== pb.regimeKey) {
      const fromPackId = prev.regimePlaybookId || lookupScriptPack(prev.regimeKey)?.id || null;
      const toPackId = pb.regimePlaybookId || lookupScriptPack(pb.regimeKey)?.id || null;
      if (fromPackId || toPackId) {
        regimeFlipCount += 1;
        transition = {
          kind: 'regime_flip',
          from: fromPackId || prev.activeId || '暂无',
          to: toPackId || pb.activeId || '暂无',
          fromStage: prev.stage || null,
          toStage: pb.stage || null,
          fromRegime: prev.regimeKey,
          toRegime: pb.regimeKey,
          reason: `合证regime翻转 ${prev.regimeKey}→${pb.regimeKey}`,
          stateKey: pb.stateKey || null,
        };
        transitions.push({
          instrumentId: inst.id,
          instrumentName: inst.name || inst.id,
          ...transition,
          text: `${inst.name || inst.id} · regime ${prev.regimeKey}→${pb.regimeKey} · ${
            fromPackId || prev.activeId || '—'
          }→${toPackId || pb.activeId || '—'}`,
          nDisplay: pb.nDisplay || '暂无',
          weightAllowed: pb.weightGate?.allowed !== false,
          dataSource: 'playbook-state-snapshot',
        });
      }
    } else if (prev?.regimeKey && !pb.regimeKey) {
      transition = {
        kind: 'regime_data_gap',
        from: prev.regimePlaybookId || prev.activeId || '暂无',
        to: pb.activeId || '暂无',
        fromRegime: prev.regimeKey,
        toRegime: null,
        reason: '合证暂无·不记为剧本翻转',
        stateKey: pb.stateKey || null,
      };
      questions.push({
        priority: 'P2',
        score: 26,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：前日结构剧本 ${prev.regimeKey} 今日合证暂无 — 数据缺口还是真离开？`,
        reasons: ['剧本状态机', 'regime_data_gap'],
        dataSource: 'intel-playbook-switcher',
      });
    } else if (prev?.activeId && prev.activeId !== pb.activeId) {
      transition = {
        kind: 'active_switch',
        from: prev.activeId,
        to: pb.activeId,
        fromStage: prev.stage || null,
        toStage: pb.stage || null,
        reason: pb.switched ? `覆写 ${pb.switchSource}` : '决策树/状态切换',
        stateKey: pb.stateKey || null,
      };
      transitions.push({
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        ...transition,
        text: `${inst.name || inst.id} · ${prev.activeId}→${pb.activeId}${
          prev.stage && pb.stage && prev.stage !== pb.stage ? ` · ${prev.stage}→${pb.stage}` : ''
        }`,
        nDisplay: pb.nDisplay || '暂无',
        weightAllowed: pb.weightGate?.allowed !== false,
        dataSource: 'playbook-state-snapshot',
      });
    } else if (prev?.stage && pb.stage && prev.stage !== pb.stage && prev.activeId === pb.activeId) {
      transition = {
        kind: 'stage_migrate',
        from: pb.activeId,
        to: pb.activeId,
        fromStage: prev.stage,
        toStage: pb.stage,
        reason: '同剧本阶段迁移',
        stateKey: pb.stateKey || null,
      };
      transitions.push({
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        ...transition,
        text: `${inst.name || inst.id} · ${pb.activeId} 阶段 ${prev.stage}→${pb.stage}`,
        nDisplay: pb.nDisplay || '暂无',
        dataSource: 'playbook-state-snapshot',
      });
    }

    rows.push({
      instrumentId: inst.id,
      instrumentName: inst.name || inst.id,
      activeId: pb.activeId,
      activeTitle: pb.activeTitle,
      stage: pb.stage,
      switchSource: pb.switchSource,
      switched: Boolean(pb.switched),
      stateKey: pb.stateKey || null,
      regimeKey: pb.regimeKey || null,
      regimePlaybookId: pb.regimePlaybookId || null,
      policyPlaybookId: pb.policyPlaybookId || null,
      nDisplay: pb.nDisplay || '暂无',
      weightGate: pb.weightGate || null,
      transition,
      display: pb.display,
      scriptPackTitle: pb.scriptPack?.title || null,
    });

    if (pb.switched && (!pb.n || pb.n < 20)) {
      questions.push({
        priority: 'P2',
        score: 28,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：剧本覆写至 ${pb.activeId} 但过程权 n=${pb.nDisplay || '暂无'} — 是否仅标签不改权？`,
        reasons: ['剧本状态机', 'n不足'],
        dataSource: 'intel-playbook-switcher',
      });
    }
    if (transition?.kind === 'regime_flip') {
      questions.push({
        priority: 'P1',
        score: 48,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：合证剧本翻转 ${transition.fromRegime}→${transition.toRegime} — 主矛盾/证伪时钟是否已换包？`,
        reasons: ['剧本状态机', 'regime_flip', 'what-changed'],
        dataSource: 'intel-playbook-switcher',
      });
    } else if (transition && transition.from !== transition.to) {
      questions.push({
        priority: 'P2',
        score: 32,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：剧本切换 ${transition.from}→${transition.to} — 状态键/主矛盾是否同步？`,
        reasons: ['剧本状态机', 'transition'],
        dataSource: 'intel-playbook-switcher',
      });
    }
    if (pb.scriptPack && pb.weightGate && pb.weightGate.familyInPack === false) {
      questions.push({
        priority: 'P2',
        score: 30,
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        question: `${inst.name || inst.id}：当前在剧本 ${pb.activeId} 外仍见权桶族 — 已禁止套用？`,
        reasons: ['剧本状态机', 'family-gate'],
        dataSource: 'intel-playbook-switcher',
      });
    }
  }

  const top = Object.values(byId).sort((a, b) => b.count - a.count).slice(0, 8);
  const board = {
    version: PLAYBOOK_SWITCH_VERSION,
    asOf: opts.asOf || null,
    withPlaybook: withPb,
    withRegimePack: withRegime,
    switchedCount: switched,
    transitionCount: transitions.length,
    regimeFlipCount,
    top,
    rows: rows.slice(0, 40),
    transitions: transitions.slice(0, 16),
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 10),
    comparedTo: prior?.asOf || null,
    display: regimeFlipCount
      ? `剧本状态机 结构包${withRegime}/${withPb} · regime翻转${regimeFlipCount} · 覆写${switched}${
          prior?.asOf ? ` · 较${prior.asOf}` : ''
        }`
      : transitions.length
        ? `剧本状态机 结构包${withRegime}/${withPb} · 转移${transitions.length} · 覆写${switched}${
            prior?.asOf ? ` · 较${prior.asOf}` : ''
          }`
        : withPb
          ? `Playbook 结构包${withRegime}/${withPb} · 覆写${switched} · 主 ${top[0]?.id || '—'} · 暂无转移`
          : 'Playbook 暂无',
    note: '合证regime=结构剧本；进入注入反对/触发/时钟；离开强制what-changed；过程权须 n≥20 且族匹配',
    dataSource: 'intel-playbook-switcher',
    method: 'regime-script-pack+snapshot-transition+family-gate',
  };

  if (opts.persist !== false) {
    try {
      savePlaybookSnapshot(board, opts.asOf);
      board.snapshotSaved = true;
    } catch {
      board.snapshotSaved = false;
    }
  }

  return board;
}

function enrichQuestionQueueWithPlaybook(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P2',
      priorityLabel: q.reasons?.includes('regime_flip') ? '合证剧本翻转' : '剧本状态机',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: q.priority === 'P1' ? 'watch' : 'watch',
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    playbookInjected: extra.length,
    version: `${queue.version || ''}+playbook`,
  };
}

module.exports = {
  PLAYBOOK_SWITCH_VERSION,
  REGIME_SCRIPT_PACKS,
  resolvePlaybookContext,
  applyPlaybookToClaim,
  applyScriptPackToClaim,
  buildPlaybookBoard,
  enrichQuestionQueueWithPlaybook,
  readPinnedPlaybook,
  catalogPlaybooks,
  loadPlaybookSnapshot,
  savePlaybookSnapshot,
  extractRegimeKey,
  lookupScriptPack,
  familyFromStateKey,
};
