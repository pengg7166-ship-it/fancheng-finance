/**
 * 情报中心 · 证伪执行器（构想 §47 / §24 / §40）
 * 对照真实合证 / OI / 价格评估触发器；驱动命题状态流转。
 * 禁止散文假判：缺数据 → pending/unknown，不计 falsified。
 */
const fs = require('fs');
const path = require('path');
const { getIntelDir, appendJsonl, readJsonl, recordRevision } = require('./intel-memory');
const { CONFIDENCE_LEVELS } = require('./intel-claim-library');

const EXECUTOR_VERSION = 'v2.89.20-museum-intake';

const STATUS = {
  draft: 'draft',
  active: 'active',
  watch: 'watch',
  falsifying: 'falsifying',
  falsified: 'falsified',
  expired: 'expired',
  superseded: 'superseded',
};

function statesDir() {
  const dir = getIntelDir();
  if (!dir) return null;
  const d = path.join(dir, 'claim-states');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function statePath(claimId) {
  const d = statesDir();
  if (!d || !claimId) return null;
  const safe = String(claimId).replace(/[^\w.-]+/g, '_');
  return path.join(d, `${safe}.json`);
}

function loadClaimState(claimId) {
  const fp = statePath(claimId);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function saveClaimState(state) {
  const fp = statePath(state?.claimId);
  if (!fp) return false;
  fs.writeFileSync(fp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  return true;
}

function snapshotBaseline(inst, claim, asOf) {
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const cap = inst?.capitalAttention || inst?.factors?.capitalAttention;
  const jointLabel = sf?.primaryLabel || sf?.primaryRegime || cap?.jointWithInventory || null;
  return {
    asOf: asOf || claim?.baselineDate,
    side: claim?.side || 'flat',
    structureBias: sf?.structureBias || null,
    primaryRegime: sf?.primaryRegime || null,
    jointLabel: jointLabel && jointLabel !== '暂无' ? jointLabel : null,
    jointAvailable: Boolean(sf?.available || (jointLabel && jointLabel !== '暂无' && jointLabel !== '—')),
    price: inst?.price ?? null,
    changePct: inst?.changePct ?? null,
    oi1wPct: cap?.horizons?.oi1wPct ?? null,
    oi1mPct: cap?.horizons?.oi1mPct ?? null,
    direction: inst?.direction || null,
    stateKey: claim?.stateKey || inst?.intelligenceKernel?.stateKey || null,
  };
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);
}

/**
 * 结构证伪：对照基线合证 / 结构偏向
 * @returns {{ hit: boolean, pending: boolean, strength: number, reason: string, dataSource: string, tag: string }|null}
 */
function evaluateStructurePredicate(claim, inst, baseline) {
  const sf = inst?.factors?.inventory?.stockFlowJoint;
  const cap = inst?.capitalAttention || {};
  const jointLabel = sf?.primaryLabel || sf?.primaryRegime || cap?.jointWithInventory || null;
  const liveBias = sf?.structureBias || null;
  const liveRegime = sf?.primaryRegime || null;
  const side = claim?.side || baseline?.side || 'flat';

  const hasLive =
    Boolean(sf?.available) ||
    (jointLabel && jointLabel !== '暂无' && jointLabel !== '—');

  if (!hasLive && !baseline?.jointAvailable) {
    return {
      hit: false,
      pending: true,
      strength: 0,
      reason: '合证数据不足 · 暂不计分',
      dataSource: 'missing',
      tag: 'data_lag',
    };
  }

  // 1) regime / joint label 相对基线翻转
  if (baseline?.primaryRegime && liveRegime && baseline.primaryRegime !== liveRegime) {
    const baseBullish = /destock|去库/.test(String(baseline.primaryRegime + baseline.jointLabel));
    const baseBearish = /build|累库/.test(String(baseline.primaryRegime + baseline.jointLabel));
    const liveBullish = /destock|去库/.test(String(liveRegime + (jointLabel || '')));
    const liveBearish = /build|累库/.test(String(liveRegime + (jointLabel || '')));

    if ((side === 'bull' && baseBullish && liveBearish) || (side === 'bear' && baseBearish && liveBullish)) {
      return {
        hit: true,
        pending: false,
        strength: 0.85,
        reason: `合证 regime 翻转 ${baseline.primaryRegime}→${liveRegime}`,
        dataSource: sf?.dataSource || 'stock-flow-joint',
        tag: 'regime_flip',
        n: sf?.sampleN ?? null,
      };
    }
    if ((side === 'bull' && liveBearish) || (side === 'bear' && liveBullish)) {
      return {
        hit: true,
        pending: false,
        strength: 0.7,
        reason: `合证与命题方向对立 · 现 ${liveRegime || jointLabel}`,
        dataSource: sf?.dataSource || 'stock-flow-joint',
        tag: 'regime_oppose',
        n: sf?.sampleN ?? null,
      };
    }
    // 同向但 regime 变了 → 弱警告
    return {
      hit: false,
      pending: false,
      strength: 0.35,
      warning: true,
      reason: `合证标签变化 ${baseline.primaryRegime}→${liveRegime}（未对立）`,
      dataSource: sf?.dataSource || 'stock-flow-joint',
      tag: 'regime_drift',
    };
  }

  // 2) structureBias 对立
  if (baseline?.structureBias && liveBias) {
    if (side === 'bull' && liveBias === 'bear') {
      return {
        hit: true,
        pending: false,
        strength: 0.8,
        reason: `结构偏向对立：基线 ${baseline.structureBias} → 现 bear`,
        dataSource: sf?.dataSource || 'stock-flow-joint',
        tag: 'structure_oppose',
      };
    }
    if (side === 'bear' && liveBias === 'bull') {
      return {
        hit: true,
        pending: false,
        strength: 0.8,
        reason: `结构偏向对立：基线 ${baseline.structureBias} → 现 bull`,
        dataSource: sf?.dataSource || 'stock-flow-joint',
        tag: 'structure_oppose',
      };
    }
    if (
      (side === 'bull' || side === 'bear') &&
      baseline.structureBias !== 'mixed' &&
      liveBias === 'mixed'
    ) {
      return {
        hit: false,
        pending: false,
        strength: 0.45,
        warning: true,
        reason: '结构偏向由明确转为混合 · 证伪进行中',
        dataSource: sf?.dataSource || 'stock-flow-joint',
        tag: 'structure_soften',
      };
    }
  }

  // 3) 无基线 regime 时：用 live 与命题 side 直接对照
  if (!baseline?.primaryRegime && !baseline?.structureBias) {
    if (side === 'bull' && liveBias === 'bear') {
      return {
        hit: true,
        pending: false,
        strength: 0.65,
        reason: '命题偏多但合证结构偏空',
        dataSource: sf?.dataSource || 'capitalAttention.joint',
        tag: 'live_oppose',
      };
    }
    if (side === 'bear' && liveBias === 'bull') {
      return {
        hit: true,
        pending: false,
        strength: 0.65,
        reason: '命题偏空但合证结构偏多',
        dataSource: sf?.dataSource || 'capitalAttention.joint',
        tag: 'live_oppose',
      };
    }
  }

  // 4) 仅有 joint 文案标签时：相对基线标签对立
  const baseLabel = String(baseline?.jointLabel || '');
  const liveLabel = String(jointLabel || '');
  if (baseLabel && liveLabel && baseLabel !== liveLabel) {
    const baseBull = /去库/.test(baseLabel) && !/累库/.test(baseLabel);
    const baseBear = /累库/.test(baseLabel);
    const liveBull = /去库/.test(liveLabel) && !/累库/.test(liveLabel);
    const liveBear = /累库/.test(liveLabel);
    if ((side === 'bull' && baseBull && liveBear) || (side === 'bear' && baseBear && liveBull)) {
      return {
        hit: true,
        pending: false,
        strength: 0.75,
        reason: `合证标签翻转 ${baseLabel}→${liveLabel}`,
        dataSource: sf?.dataSource || 'capitalAttention.joint',
        tag: 'joint_label_flip',
      };
    }
    if ((side === 'bull' && liveBear) || (side === 'bear' && liveBull)) {
      return {
        hit: true,
        pending: false,
        strength: 0.7,
        reason: `合证标签与命题对立 · ${liveLabel}`,
        dataSource: sf?.dataSource || 'capitalAttention.joint',
        tag: 'joint_label_oppose',
      };
    }
  }

  // 5) 资金态度强对立（辅助，不单独满分证伪）
  const att = cap?.attitudeScore;
  if (att != null && Number.isFinite(Number(att))) {
    if (side === 'bull' && att < -0.15) {
      return {
        hit: false,
        pending: false,
        strength: 0.4,
        warning: true,
        reason: `资金态度偏空(${cap.attitudeLabel || att}) · 证伪进行中`,
        dataSource: cap.dataSource || 'capital-attitude',
        tag: 'capital_oppose',
      };
    }
    if (side === 'bear' && att > 0.15) {
      return {
        hit: false,
        pending: false,
        strength: 0.4,
        warning: true,
        reason: `资金态度偏多(${cap.attitudeLabel || att}) · 证伪进行中`,
        dataSource: cap.dataSource || 'capital-attitude',
        tag: 'capital_oppose',
      };
    }
  }

  // 6) 基差/期限结构与命题对立
  const basis = inst?.factors?.basis || inst?.basis;
  if (basis?.available && basis.side && basis.side !== 'flat') {
    if (side === 'bull' && basis.side === 'bear') {
      return {
        hit: false,
        pending: false,
        strength: 0.5,
        warning: true,
        reason: `基差/期限结构偏空(${basis.label || basis.structure}) · 证伪进行中`,
        dataSource: basis.dataSource || 'term-structure',
        tag: 'basis_oppose',
        n: basis.sampleN ?? null,
      };
    }
    if (side === 'bear' && basis.side === 'bull') {
      return {
        hit: false,
        pending: false,
        strength: 0.5,
        warning: true,
        reason: `基差/期限结构偏多(${basis.label || basis.structure}) · 证伪进行中`,
        dataSource: basis.dataSource || 'term-structure',
        tag: 'basis_oppose',
        n: basis.sampleN ?? null,
      };
    }
  }

  return {
    hit: false,
    pending: false,
    strength: 0,
    reason: '结构条件未触发',
    dataSource: sf?.dataSource || 'structure-eval',
    tag: 'ok',
  };
}

/**
 * 价格反馈证伪（战术层辅助）：价格相对命题方向连续背离
 */
function evaluatePricePredicate(claim, inst, baseline) {
  if (claim?.horizon !== 'tactical') {
    return { hit: false, pending: false, strength: 0, reason: '非战术层跳过', auxiliary: true, tag: 'skip' };
  }
  const changePct = inst?.changePct;
  if (changePct == null || !Number.isFinite(Number(changePct))) {
    return { hit: false, pending: true, strength: 0, reason: '价格缺失', dataSource: 'missing', tag: 'data_lag' };
  }
  const vol = inst?.smoothedVol?.sigma20 ?? inst?.nextDayRangePct?.halfWidth ?? 1.5;
  const side = claim?.side || 'flat';
  const thr = Math.max(0.8, Number(vol) * 0.6);

  if (side === 'bull' && changePct < -thr) {
    return {
      hit: true,
      pending: false,
      strength: 0.55,
      reason: `战术偏多但日跌 ${changePct.toFixed(2)}% 超阈值 ${thr.toFixed(1)}%`,
      dataSource: inst.priceReason || 'quote',
      tag: 'price_oppose',
      auxiliary: true,
    };
  }
  if (side === 'bear' && changePct > thr) {
    return {
      hit: true,
      pending: false,
      strength: 0.55,
      reason: `战术偏空但日涨 ${changePct.toFixed(2)}% 超阈值 ${thr.toFixed(1)}%`,
      dataSource: inst.priceReason || 'quote',
      tag: 'price_oppose',
      auxiliary: true,
    };
  }

  // 相对基线价格背离（若有基线价）
  if (baseline?.price != null && inst?.price != null && baseline.price > 0) {
    const movePct = ((inst.price - baseline.price) / baseline.price) * 100;
    if (side === 'bull' && movePct < -thr * 1.5) {
      return {
        hit: false,
        pending: false,
        strength: 0.5,
        warning: true,
        reason: `自基线累计 ${movePct.toFixed(2)}% · 与多头命题背离`,
        dataSource: 'baseline-price',
        tag: 'price_drift',
        auxiliary: true,
      };
    }
    if (side === 'bear' && movePct > thr * 1.5) {
      return {
        hit: false,
        pending: false,
        strength: 0.5,
        warning: true,
        reason: `自基线累计 +${movePct.toFixed(2)}% · 与空头命题背离`,
        dataSource: 'baseline-price',
        tag: 'price_drift',
        auxiliary: true,
      };
    }
  }

  return { hit: false, pending: false, strength: 0, reason: '价格反馈未触发', tag: 'ok', auxiliary: true };
}

/**
 * 过期：validUntil 已过且结构未被证实延续
 */
function evaluateExpiry(claim, asOf, structureEval) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  if (!claim?.validUntil) {
    return { hit: false, pending: true, reason: '无有效期', tag: 'no_deadline' };
  }
  const left = daysBetween(today, claim.validUntil);
  if (left == null) return { hit: false, pending: true, reason: '日期无效', tag: 'bad_date' };
  if (left >= 0) {
    return { hit: false, pending: false, daysLeft: left, reason: `剩余 ${left} 日`, tag: 'within_window' };
  }
  // 已过期：若结构仍支持命题则 expired（时效失效），若已对立则走 falsified 由 structure 处理
  if (structureEval?.hit) {
    return { hit: false, pending: false, daysLeft: left, reason: '已过期且结构已对立·归证伪', tag: 'expired_but_falsified' };
  }
  return {
    hit: true,
    pending: false,
    daysLeft: left,
    strength: 0.6,
    reason: `超过有效期 ${claim.validUntil} 未获结构确认`,
    tag: 'expired',
    dataSource: 'claim.validUntil',
  };
}

function museumHasIntake(claimId, types = ['falsified', 'falsified_detail']) {
  if (!claimId) return false;
  const rows = readJsonl('failure-museum.jsonl', 500);
  return rows.some((r) => r.claimId === claimId && types.includes(r.type));
}

function alreadyInMuseum(claimId) {
  return museumHasIntake(claimId, ['falsified', 'falsified_detail']);
}

/**
 * 证伪/过期 → 博物馆原子入馆（单条 JSONL，禁止双写；缺数据不入馆）
 * @returns {{ written: boolean, alreadyPresent: boolean, claimId: string, entry?: object }}
 */
function writeMuseumIntake({
  claim,
  inst,
  trigger,
  tags,
  baseline,
  structureEval,
  priceEval,
  status,
  asOf,
  heal = false,
} = {}) {
  if (!claim?.claimId) {
    return { written: false, alreadyPresent: false, claimId: null, reason: 'no_claim' };
  }
  const intakeType = status === STATUS.expired ? 'expired' : 'falsified';
  const checkTypes = intakeType === 'expired' ? ['expired'] : ['falsified', 'falsified_detail'];
  if (museumHasIntake(claim.claimId, checkTypes)) {
    return { written: false, alreadyPresent: true, claimId: claim.claimId };
  }
  const day = asOf || new Date().toISOString().slice(0, 10);
  const entry = {
    type: intakeType,
    claimId: claim.claimId,
    instrumentId: inst?.id || claim.instrumentId || null,
    instrumentName: inst?.name || null,
    statement: claim.statement || null,
    falsifiedAt: day,
    trigger: trigger || (intakeType === 'expired' ? 'clock_expired' : 'falsified'),
    tags: Array.isArray(tags) ? tags : [],
    baseline: baseline || null,
    structureEval: structureEval
      ? { hit: structureEval.hit, pending: structureEval.pending, reason: structureEval.reason, tag: structureEval.tag }
      : null,
    priceEval: priceEval
      ? { hit: priceEval.hit, pending: priceEval.pending, reason: priceEval.reason, tag: priceEval.tag }
      : null,
    museumWritten: true,
    intakeClosed: true,
    heal: Boolean(heal),
    version: EXECUTOR_VERSION,
    dataSource: 'intel-falsification-executor',
    method: 'falsify→museum-atomic-intake',
  };
  appendJsonl('failure-museum.jsonl', entry);
  return { written: true, alreadyPresent: false, claimId: claim.claimId, entry };
}

/**
 * 主入口：评估并返回更新后的 claim + evaluation 审计包
 */
function evaluateAndApplyFalsification(claim, inst, clock, { asOf, persist = true } = {}) {
  if (!claim?.claimId) {
    return {
      claim: null,
      evaluation: { available: false, reason: 'no_claim', version: EXECUTOR_VERSION },
    };
  }

  const today = asOf || new Date().toISOString().slice(0, 10);
  let state = loadClaimState(claim.claimId);
  const isNew = !state;

  if (!state) {
    state = {
      claimId: claim.claimId,
      instrumentId: claim.instrumentId || inst?.id,
      horizon: claim.horizon,
      statement: claim.statement,
      side: claim.side,
      status: claim.status,
      confidence: claim.confidence,
      baselineDate: claim.baselineDate || today,
      validUntil: claim.validUntil,
      baseline: snapshotBaseline(inst, claim, today),
      progressHits: [],
      version: EXECUTOR_VERSION,
    };
  } else if (state.status === STATUS.falsified || state.status === STATUS.expired) {
    // 终态：若引擎派生出同 id 新命题但 side/statement 大变 → superseded 旧、允许新生命周期需新 claimId
    // 入馆愈合：终态但博物馆无记录时补写（不造假触发器，沿用存档 lastTrigger）
    let museumIntake = {
      written: false,
      alreadyPresent:
        state.status === STATUS.falsified
          ? alreadyInMuseum(claim.claimId)
          : museumHasIntake(claim.claimId, ['expired']),
      claimId: claim.claimId,
    };
    if (persist && !museumIntake.alreadyPresent) {
      museumIntake = writeMuseumIntake({
        claim: { ...claim, statement: state.statement || claim.statement, instrumentId: state.instrumentId },
        inst: inst || { id: state.instrumentId },
        trigger: state.lastTrigger,
        tags: state.tags || [],
        baseline: state.baseline,
        structureEval: state.lastEvals?.structureEval,
        priceEval: state.lastEvals?.priceEval,
        status: state.status,
        asOf: today,
        heal: true,
      });
    }
    return {
      claim: {
        ...claim,
        status: state.status,
        confidence: state.status === STATUS.falsified ? CONFIDENCE_LEVELS.falsifying : claim.confidence,
        falsifiedAt: state.falsifiedAt || null,
        expiredAt: state.expiredAt || null,
        falsifyTrigger: state.lastTrigger || null,
        falsifyTags: state.tags || [],
      },
      evaluation: {
        version: EXECUTOR_VERSION,
        available: true,
        terminal: true,
        status: state.status,
        lastTrigger: state.lastTrigger || null,
        museumWritten: museumIntake.written || museumIntake.alreadyPresent,
        museumIntake,
        display:
          state.status === STATUS.falsified
            ? `已证伪 · ${state.lastTrigger || '—'}`
            : `已过期 · ${state.expiredAt || claim.validUntil}`,
        dataSource: 'intel-falsification-executor',
        method: 'terminal+museum-heal',
      },
    };
  }

  // side 相对存档翻转 → 旧命题 superseded（新方向应由新 claim 表达；同 id 则标记改口）
  if (state.side && claim.side && state.side !== claim.side && state.side !== 'flat' && claim.side !== 'flat') {
    if (persist) {
      recordRevision(
        { statement: state.statement, confidence: state.confidence, side: state.side, status: state.status },
        { ...claim, status: STATUS.superseded },
        'side_flip',
        'direction_revision'
      );
      state.status = STATUS.superseded;
      state.supersededAt = today;
      state.supersedeReason = `方向 ${state.side}→${claim.side}`;
      saveClaimState(state);
    }
  }

  const baseline = state.baseline || snapshotBaseline(inst, claim, state.baselineDate);
  const structureEval = evaluateStructurePredicate(claim, inst, baseline);
  const priceEval = evaluatePricePredicate(claim, inst, baseline);
  const expiryEval = evaluateExpiry(claim, today, structureEval);

  const hits = [];
  if (structureEval.hit) hits.push({ clock: 'structure', ...structureEval });
  if (priceEval.hit && claim.horizon === 'tactical') hits.push({ clock: 'price_feedback', ...priceEval });
  if (expiryEval.hit) hits.push({ clock: 'expiry', ...expiryEval });

  const warnings = [structureEval, priceEval].filter((e) => e.warning && !e.hit);

  let nextStatus = claim.status === 'draft' ? 'draft' : state.status || claim.status || STATUS.active;
  let nextConfidence = claim.confidence;
  let lastTrigger = null;
  let tags = [];

  // 强度聚合
  const maxHitStrength = hits.length ? Math.max(...hits.map((h) => h.strength || 0)) : 0;
  const maxWarnStrength = warnings.length ? Math.max(...warnings.map((w) => w.strength || 0)) : 0;

  if (hits.some((h) => h.tag === 'expired') && !hits.some((h) => h.clock === 'structure')) {
    nextStatus = STATUS.expired;
    lastTrigger = expiryEval.reason;
    tags = ['expired'];
  } else if (maxHitStrength >= 0.65 || (hits.length >= 2 && maxHitStrength >= 0.5)) {
    nextStatus = STATUS.falsified;
    lastTrigger = hits.map((h) => h.reason).join('；');
    tags = [...new Set(hits.map((h) => h.tag))];
    nextConfidence = CONFIDENCE_LEVELS.falsifying;
  } else if (maxHitStrength >= 0.4 || maxWarnStrength >= 0.4 || hits.length === 1) {
    nextStatus = STATUS.falsifying;
    lastTrigger = (hits[0] || warnings[0])?.reason || '证伪信号累积中';
    tags = [...new Set([...(hits.map((h) => h.tag) || []), ...(warnings.map((w) => w.tag) || [])])];
    nextConfidence = CONFIDENCE_LEVELS.falsifying;
  } else if (nextStatus === STATUS.falsifying && maxHitStrength < 0.3 && maxWarnStrength < 0.3) {
    // 信号消退 → 回 watch
    nextStatus = STATUS.watch;
    nextConfidence = claim.confidence === CONFIDENCE_LEVELS.falsifying ? CONFIDENCE_LEVELS.weak : claim.confidence;
  }

  if (nextStatus === STATUS.draft && claim.status !== 'draft') {
    nextStatus = claim.status;
  }

  const progressHits = [...(state.progressHits || [])];
  for (const h of hits) {
    progressHits.push({ at: today, ...h });
  }
  for (const w of warnings) {
    if (w.strength >= 0.4) progressHits.push({ at: today, warning: true, ...w });
  }

  const updatedClaim = {
    ...claim,
    status: nextStatus,
    confidence: nextStatus === STATUS.falsified || nextStatus === STATUS.falsifying
      ? CONFIDENCE_LEVELS.falsifying
      : nextConfidence,
    baselineDate: state.baselineDate || claim.baselineDate,
    falsifyTrigger: lastTrigger,
    falsifyTags: tags,
    falsifiedAt: nextStatus === STATUS.falsified ? today : null,
    expiredAt: nextStatus === STATUS.expired ? today : null,
    falsifyProgress: {
      hitCount: hits.length,
      warnCount: warnings.length,
      maxStrength: Math.max(maxHitStrength, maxWarnStrength, 0),
      recent: progressHits.slice(-5),
    },
  };

  if (persist) {
    const prevStatus = state.status;
    state = {
      ...state,
      statement: claim.statement,
      side: claim.side,
      status: nextStatus,
      confidence: updatedClaim.confidence,
      validUntil: claim.validUntil,
      baseline: isNew ? baseline : state.baseline,
      progressHits: progressHits.slice(-30),
      lastTrigger,
      tags,
      falsifiedAt: updatedClaim.falsifiedAt,
      expiredAt: updatedClaim.expiredAt,
      lastEvalAt: today,
      lastEvals: { structureEval, priceEval, expiryEval },
      version: EXECUTOR_VERSION,
    };
    saveClaimState(state);

    if (prevStatus !== nextStatus) {
      recordRevision(
        { statement: state.statement, confidence: state.confidence, side: state.side, status: prevStatus },
        updatedClaim,
        lastTrigger || `status ${prevStatus}→${nextStatus}`,
        nextStatus === STATUS.falsified
          ? 'falsification'
          : nextStatus === STATUS.expired
            ? 'expiry'
            : 'status_revision'
      );
    }

  }

  let museumIntake = { written: false, alreadyPresent: false, claimId: claim.claimId };
  if (persist && (nextStatus === STATUS.falsified || nextStatus === STATUS.expired)) {
    museumIntake = writeMuseumIntake({
      claim: updatedClaim,
      inst,
      trigger: lastTrigger,
      tags,
      baseline,
      structureEval,
      priceEval,
      status: nextStatus,
      asOf: today,
      heal: false,
    });
  }

  const display =
    nextStatus === STATUS.falsified
      ? `已证伪 · ${lastTrigger || '—'}`
      : nextStatus === STATUS.falsifying
        ? `证伪进行中 · ${lastTrigger || '信号累积'}`
        : nextStatus === STATUS.expired
          ? `已过期 · ${claim.validUntil}`
          : clock?.display || '监测中';

  return {
    claim: updatedClaim,
    evaluation: {
      version: EXECUTOR_VERSION,
      available: true,
      status: nextStatus,
      terminal: nextStatus === STATUS.falsified || nextStatus === STATUS.expired,
      structureEval,
      priceEval,
      expiryEval,
      hits,
      warnings,
      lastTrigger,
      tags,
      baselineDate: state.baselineDate,
      daysSinceBaseline: daysBetween(state.baselineDate, today),
      museumWritten: museumIntake.written || museumIntake.alreadyPresent,
      museumIntake,
      display,
      dataSource: 'intel-falsification-executor',
      method: 'structure+price+expiry→museum-atomic',
    },
  };
}

function listFalsifiedClaims(limit = 50) {
  return readJsonl('failure-museum.jsonl', limit * 2)
    .filter((r) => r.type === 'falsified' || r.type === 'falsified_detail')
    .reverse()
    .slice(0, limit);
}

module.exports = {
  EXECUTOR_VERSION,
  STATUS,
  evaluateAndApplyFalsification,
  evaluateStructurePredicate,
  evaluatePricePredicate,
  evaluateExpiry,
  loadClaimState,
  saveClaimState,
  snapshotBaseline,
  listFalsifiedClaims,
  writeMuseumIntake,
  museumHasIntake,
  alreadyInMuseum,
};
