/**
 * 情报中心 · 静默日 + 自信刹车纪律板（构想 §70 / §77）
 * 静默仅当日差物质变更=0 且无 Interrupt；刹车板展示降档清单与配额。
 * v2.89.18：假静默风险闭环 — 检测→升档 P0→清单→人确认→归档；不翻转 quietDay 真值。
 */
const { appendJsonl, readJsonl, getIntelDir } = require('./intel-memory');
const { computeQuietStreak, DIFF_VERSION } = require('./intel-daily-diff');
const fs = require('fs');
const path = require('path');

const QUIET_BRAKE_VERSION = 'v2.89.18-false-quiet-loop';
const BRAKE_ARCHIVE = 'confidence-brake-archive.jsonl';
const FALSE_QUIET_ARCHIVE = 'false-quiet-loop.jsonl';
const FALSE_QUIET_STATE = 'false-quiet-state.json';

function reasonsFingerprint(reasons) {
  return (reasons || []).slice().sort().join('|') || 'none';
}

function loadFalseQuietState() {
  const dir = getIntelDir();
  if (!dir) return null;
  const fp = path.join(dir, FALSE_QUIET_STATE);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function saveFalseQuietState(state) {
  const dir = getIntelDir();
  if (!dir) return false;
  fs.writeFileSync(path.join(dir, FALSE_QUIET_STATE), JSON.stringify(state, null, 2), 'utf8');
  return true;
}

/**
 * 指挥官确认假静默已复核（闭环 ack）
 */
function ackFalseQuietRisk(opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const reasons = opts.reasons || [];
  const resolution = opts.resolution || 'reviewed';
  const note = opts.note || null;
  const fp = reasonsFingerprint(reasons.length ? reasons : opts.fingerprint ? [opts.fingerprint] : []);
  const prev = loadFalseQuietState() || {};
  const entry = {
    type: 'false_quiet_ack',
    asOf,
    resolution,
    note,
    reasons,
    fingerprint: fp,
    ackedAt: new Date().toISOString(),
    version: QUIET_BRAKE_VERSION,
  };
  try {
    appendJsonl(FALSE_QUIET_ARCHIVE, entry);
  } catch {
    // ignore
  }
  const state = {
    version: QUIET_BRAKE_VERSION,
    asOf,
    status: 'acknowledged',
    resolution,
    fingerprint: fp,
    note,
    ackedAt: entry.ackedAt,
    prevStatus: prev.status || null,
  };
  saveFalseQuietState(state);
  return { ok: true, state, entry };
}

function buildFalseQuietLoop({
  dailyDiff,
  falseQuietRisk,
  falseQuietReasons,
  interruptN,
  asOf,
  persist,
} = {}) {
  const reasons = falseQuietReasons || [];
  const fp = reasonsFingerprint(reasons);
  const state = loadFalseQuietState();
  const sameDayAck =
    state?.asOf === asOf &&
    state?.status === 'acknowledged' &&
    (state.fingerprint === fp || !reasons.length);

  let status = 'clear';
  if (falseQuietRisk) {
    status = sameDayAck ? 'acknowledged' : 'open';
  } else if (state?.asOf === asOf && state?.status === 'acknowledged') {
    status = 'resolved';
  }

  const checklist = [];
  if (falseQuietRisk || status === 'acknowledged') {
    const surpriseN = dailyDiff?.changes?.surpriseTop?.length || 0;
    checklist.push({
      id: 'review_surprise',
      label: surpriseN > 0 ? `复核高惊讶桶 ${surpriseN}` : '复核高惊讶桶（今日 0）',
      done: status === 'acknowledged' || status === 'resolved',
      n: surpriseN || null,
      nDisplay: surpriseN ? String(surpriseN) : '暂无',
    });
    checklist.push({
      id: 'review_interrupt',
      label: interruptN > 0 ? `复核 Interrupt ${interruptN}` : '复核 Interrupt（今日 0）',
      done: status === 'acknowledged' || status === 'resolved',
      n: interruptN || null,
      nDisplay: interruptN ? String(interruptN) : '暂无',
    });
    checklist.push({
      id: 'confirm_material',
      label: '确认物质变更是否漏记（或接受日差静默标）',
      done: status === 'acknowledged' || status === 'resolved',
      n: dailyDiff?.materialChanges ?? null,
      nDisplay: dailyDiff?.materialChanges != null ? String(dailyDiff.materialChanges) : '暂无',
    });
  }

  if (persist && falseQuietRisk && status === 'open') {
    try {
      const recent = readJsonl(FALSE_QUIET_ARCHIVE, 30)
        .reverse()
        .find((r) => r.type === 'false_quiet_open' && r.asOf === asOf && r.fingerprint === fp);
      if (!recent) {
        appendJsonl(FALSE_QUIET_ARCHIVE, {
          type: 'false_quiet_open',
          asOf: asOf || null,
          reasons,
          fingerprint: fp,
          interruptN: interruptN || 0,
          surpriseTopN: dailyDiff?.changes?.surpriseTop?.length || 0,
          materialChanges: dailyDiff?.materialChanges ?? null,
          at: new Date().toISOString(),
          version: QUIET_BRAKE_VERSION,
        });
      }
    } catch {
      // ignore
    }
  }

  const mustRead = [];
  if (status === 'open') {
    mustRead.push('假静默开环：禁止当静默日躺平 — 先复核惊讶/打断/物质桶');
    if (reasons.length) mustRead.push(`原因：${reasons.join('、')}`);
  } else if (status === 'acknowledged') {
    mustRead.push(`假静默已确认 · ${state?.resolution || 'reviewed'}`);
  } else if (status === 'resolved') {
    mustRead.push('假静默环已关闭（风险消失或已确认）');
  }

  const recent = readJsonl(FALSE_QUIET_ARCHIVE, 20).reverse().slice(0, 6);

  return {
    version: QUIET_BRAKE_VERSION,
    asOf: asOf || null,
    status,
    statusLabel:
      status === 'open'
        ? '开环·待确认'
        : status === 'acknowledged'
          ? '已确认'
          : status === 'resolved'
            ? '已关闭'
            : '无假静默',
    fingerprint: fp,
    reasons,
    checklist,
    mustRead,
    commanderOverride: status === 'open',
    canAck: status === 'open',
    ack: sameDayAck
      ? {
          resolution: state.resolution,
          ackedAt: state.ackedAt,
          note: state.note || null,
        }
      : null,
    recent,
    display:
      status === 'clear'
        ? '假静默闭环 · 无开环'
        : `假静默闭环 · ${
            status === 'open' ? '开环待确认' : status === 'acknowledged' ? '已确认' : '已关闭'
          }${reasons.length ? ` · ${reasons.join('/')}` : ''}`,
    note: '不翻转 quietDay 真值；开环时指挥官强制复核清单',
    dataSource: 'intel-quiet-brake-board',
    method: 'detect→P0→checklist→ack→archive',
  };
}

function buildQuietBrakeBoard({ dailyDiff, confidenceBrake, interrupts = [], asOf, persist } = {}) {
  const interruptN = (interrupts || []).length;
  const material = dailyDiff?.materialChanges;
  const surpriseTopN = dailyDiff?.changes?.surpriseTop?.length || 0;
  const falseQuietReasons = [];
  if (dailyDiff?.available === true && dailyDiff?.quietDay === true) {
    if (surpriseTopN > 0) falseQuietReasons.push(`高惊讶 ${surpriseTopN}`);
    if (interruptN > 0) falseQuietReasons.push(`Interrupt ${interruptN}`);
  }
  const falseQuietRisk = falseQuietReasons.length > 0;

  const quietEligible =
    dailyDiff?.available === true &&
    material === 0 &&
    surpriseTopN === 0 &&
    interruptN === 0;

  const quietStreak = computeQuietStreak(asOf, 21);
  const brake = confidenceBrake || { active: false, downgraded: [], strongCount: 0, cap: null };
  const downgraded = (brake.downgraded || []).map((d) => ({
    instrumentId: d.id,
    instrumentName: d.name || d.id,
    text: `${d.name || d.id} · 强结构→弱结构（刹车）`,
  }));

  const falseQuietLoop = buildFalseQuietLoop({
    dailyDiff,
    falseQuietRisk,
    falseQuietReasons,
    interruptN,
    asOf,
    persist,
  });

  const questions = [];
  if (falseQuietRisk && falseQuietLoop.status === 'open') {
    questions.push({
      priority: 'P0',
      score: 55,
      instrumentId: null,
      instrumentName: '全市场',
      question: `假静默开环：日差标静默但存在 ${falseQuietReasons.join('、')} — 必须复核物质桶后确认`,
      reasons: ['静默纪律', 'falseQuietLoop', 'open', ...falseQuietReasons],
      dataSource: 'intel-quiet-brake-board',
      falseQuietLoop: true,
    });
  } else if (falseQuietRisk && falseQuietLoop.status === 'acknowledged') {
    questions.push({
      priority: 'P2',
      score: 28,
      instrumentId: null,
      instrumentName: '全市场',
      question: `假静默已确认（${falseQuietLoop.ack?.resolution || 'reviewed'}）· 持续盯物质桶`,
      reasons: ['静默纪律', 'falseQuietLoop', 'acknowledged'],
      dataSource: 'intel-quiet-brake-board',
      falseQuietLoop: true,
    });
  }
  if (brake.active && downgraded.length) {
    questions.push({
      priority: 'P2',
      score: 30,
      instrumentId: downgraded[0].instrumentId,
      instrumentName: downgraded[0].instrumentName,
      question: `自信刹车已降档 ${downgraded.length}：是否复核证据 lane / n，而非强推 Top5？`,
      reasons: ['置信刹车', 'discipline'],
      dataSource: 'intel-quiet-brake-board',
    });
  }
  if (quietStreak.streak != null && quietStreak.streak >= 3) {
    questions.push({
      priority: 'P3',
      score: 22,
      instrumentId: null,
      instrumentName: '全市场',
      question: `连续静默 ${quietStreak.streak} 日：是真无事，还是日差漏记剧本/定价/红队？`,
      reasons: ['静默纪律', 'streak'],
      dataSource: 'intel-quiet-brake-board',
    });
  }
  if (dailyDiff?.available === false) {
    questions.push({
      priority: 'P2',
      score: 28,
      instrumentId: null,
      instrumentName: '全市场',
      question: '无前日快照 · 静默不可判定 — 是否先完成日差基线？',
      reasons: ['静默纪律', 'no_snapshot'],
      dataSource: 'intel-quiet-brake-board',
    });
  }

  if (persist && brake.active && downgraded.length) {
    try {
      appendJsonl(BRAKE_ARCHIVE, {
        type: 'confidence_brake',
        asOf: asOf || null,
        strongCount: brake.strongCount,
        strongAfter: brake.strongAfter,
        cap: brake.cap,
        downgradedCount: downgraded.length,
        downgradedIds: downgraded.map((d) => d.instrumentId),
        version: QUIET_BRAKE_VERSION,
      });
    } catch {
      // ignore
    }
  }

  const recentBrake = readJsonl(BRAKE_ARCHIVE, 20).reverse().slice(0, 8);

  const displayParts = [];
  if (quietEligible) {
    displayParts.push(
      quietStreak.streak > 0 ? `静默日 · 连续 ${quietStreak.streak} 日` : '静默日 · 物质变更 0'
    );
  } else if (dailyDiff?.available === false) {
    displayParts.push('静默·待校验（无前日快照）');
  } else {
    displayParts.push(
      material != null ? `非静默 · 物质变更 ${material}` : `非静默 · ${dailyDiff?.summary || '—'}`
    );
  }
  if (falseQuietRisk) {
    displayParts.push(`假静默风险 · ${falseQuietReasons.join('/')}`);
  }
  if (falseQuietLoop.status === 'open') {
    displayParts.push('闭环开环·待确认');
  } else if (falseQuietLoop.status === 'acknowledged') {
    displayParts.push('闭环已确认');
  }
  if (brake.active) {
    displayParts.push(
      `刹车 ${brake.strongCount}→${brake.strongAfter ?? brake.cap} · 降档 ${downgraded.length}`
    );
  } else {
    displayParts.push(
      brake.strongCount != null
        ? `强结构 ${brake.strongCount}/${brake.cap ?? '—'}（未触顶）`
        : '刹车未激活'
    );
  }

  return {
    version: QUIET_BRAKE_VERSION,
    diffVersion: DIFF_VERSION,
    asOf: asOf || null,
    quietEligible,
    quietDay: quietEligible,
    falseQuietRisk,
    falseQuietReasons,
    falseQuietLoop,
    materialChanges: material ?? null,
    materialDisplay: material != null ? String(material) : '暂无',
    interruptCount: interruptN,
    quietStreak,
    quietReason: quietEligible
      ? dailyDiff?.quietReason || '物质变更=0 且无 Interrupt'
      : dailyDiff?.available === false
        ? '无前日快照 · 不可判定静默'
        : falseQuietRisk
          ? `假静默风险 · ${falseQuietReasons.join('、')}`
          : interruptN
            ? `有 Interrupt ${interruptN} · 禁止静默`
            : material
              ? `物质变更 ${material}`
              : dailyDiff?.quietReason || '非静默',
    brake: {
      active: Boolean(brake.active),
      strongCount: brake.strongCount ?? null,
      strongAfter: brake.strongAfter ?? null,
      cap: brake.cap ?? null,
      downgradedCount: downgraded.length,
      downgraded: downgraded.slice(0, 16),
      note: brake.note || null,
    },
    recentBrake,
    questions: questions.sort((a, b) => b.score - a.score).slice(0, 8),
    dailyDiffSummary: dailyDiff?.summary || null,
    display: displayParts.join(' · '),
    note: '假静默不翻转 quietDay；开环须确认清单后 ack',
    dataSource: 'intel-quiet-brake-board',
    method: 'material-diff+false-quiet-loop+brake-cap+streak',
  };
}

function enrichQuestionQueueWithQuietBrake(queue, board) {
  if (!queue || !board?.questions?.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId || ''}|${q.question}`));
  const extra = [];
  for (const q of board.questions) {
    const key = `${q.instrumentId || ''}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P2',
      priorityLabel: q.falseQuietLoop ? '假静默闭环' : '静默/刹车',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      falseQuietLoop: Boolean(q.falseQuietLoop),
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  let p0 = [...(queue.p0 || [])];
  if (board.falseQuietLoop?.status === 'open') {
    const fqQ =
      board.questions.find((q) => q.falseQuietLoop && q.priority === 'P0')?.question ||
      '假静默开环：复核物质桶后确认';
    if (!p0.some((x) => x.falseQuietLoop)) {
      p0 = [
        {
          instrumentId: null,
          instrumentName: '全市场',
          question: fqQ,
          priority: 'P0',
          score: 55,
          reasons: ['falseQuietLoop'],
          falseQuietLoop: true,
        },
        ...p0,
      ].slice(0, 5);
    }
  }
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    p0,
    p0Count: p0.length,
    quietBrakeInjected: extra.length,
    version: `${queue.version || ''}+quietbrake`,
  };
}

module.exports = {
  QUIET_BRAKE_VERSION,
  buildQuietBrakeBoard,
  enrichQuestionQueueWithQuietBrake,
  buildFalseQuietLoop,
  ackFalseQuietRisk,
  loadFalseQuietState,
};
