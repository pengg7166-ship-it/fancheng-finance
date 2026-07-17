/**
 * 情报中心 · 每日 what-changed Diff OS（构想 §40）
 * v2.84：宽快照 + 物质变更桶；禁止无快照假静默掩盖 playbook/定价/红队/刹车。
 */
const fs = require('fs');
const path = require('path');
const { getIntelDir } = require('./intel-memory');

const DIFF_VERSION = 'v2.84.0-daily-diff-os';

function snapshotPath(date) {
  const dir = getIntelDir();
  if (!dir) return null;
  const daily = path.join(dir, 'daily-snapshots');
  fs.mkdirSync(daily, { recursive: true });
  return path.join(daily, `${date}.json`);
}

function slimInstrument(i) {
  const claim = i?.intelCenter?.primaryClaim;
  const pb = i?.intelCenter?.playbook;
  const um = i?.intelCenter?.memo?.unknownMap || i?.intelCenter?.unknownMap;
  const criticalGaps = (um?.gaps || []).filter((g) => g.severity === 'critical' || g.blocksPublish);
  return {
    id: i.id,
    name: i.name,
    direction: i.direction,
    directionLabel: i.directionLabel,
    compositeScore: i.compositeScore,
    stateKey: i.intelligenceKernel?.stateKey || claim?.stateKey || null,
    claimId: claim?.claimId || null,
    issueId: claim?.issueId || null,
    claimStatement: claim?.statement || null,
    claimStatus: claim?.status || null,
    falsifyTrigger: claim?.falsifyTrigger || null,
    confidence: claim?.confidence || i?.intelCenter?.beliefLevel || null,
    beliefLevel: i?.intelCenter?.beliefLevel || claim?.confidence || null,
    pricingState: i?.intelCenter?.pricingState?.state || null,
    pushTier: i?.intelCenter?.pushTier?.tier || null,
    surprise: i?.intelCenter?.surprise?.composite ?? null,
    playbookId: pb?.activeId || claim?.playbookId || null,
    playbookStage: pb?.stage || claim?.playbookStage || null,
    redTeamIngested: claim?.redTeamIngested || 0,
    redTeamForce: Boolean(i?.intelCenter?.redTeam?.forceDowngrade),
    dissentDebt: Boolean(claim?.dissentDebt),
    confidenceBrakeForced: Boolean(
      i?.intelCenter?.confidenceBrakeForced || claim?.confidenceBrakeForced
    ),
    unknownCritical: criticalGaps.length,
    unknownCriticalLabels: criticalGaps
      .slice(0, 3)
      .map((g) => g.label || g.id || g.type)
      .filter(Boolean),
  };
}

function saveDailySnapshot(instruments, packMeta, date) {
  const fp = snapshotPath(date || new Date().toISOString().slice(0, 10));
  if (!fp) return false;
  const slim = (instruments || []).map(slimInstrument);
  fs.writeFileSync(
    fp,
    JSON.stringify(
      {
        version: DIFF_VERSION,
        date: date || new Date().toISOString().slice(0, 10),
        instrumentCount: slim.length,
        instruments: slim,
        pack: packMeta || {},
        savedAt: new Date().toISOString(),
        method: 'wide-snapshot-diff-os',
        dataSource: 'intel-daily-diff',
      },
      null,
      2
    ),
    'utf8'
  );
  return fp;
}

function loadDailySnapshot(date) {
  const fp = snapshotPath(date);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function emptyChanges() {
  return {
    newClaims: [],
    claimSwaps: [],
    upgraded: [],
    downgraded: [],
    falsified: [],
    directionFlips: [],
    regimeFlips: [],
    pricingFlips: [],
    playbookTransitions: [],
    redTeamIngests: [],
    brakeForced: [],
    surpriseTop: [],
    newGaps: [],
  };
}

function materialChangeCount(changes) {
  return (
    (changes.newClaims?.length || 0) +
    (changes.claimSwaps?.length || 0) +
    (changes.directionFlips?.length || 0) +
    (changes.regimeFlips?.length || 0) +
    (changes.upgraded?.length || 0) +
    (changes.downgraded?.length || 0) +
    (changes.falsified?.length || 0) +
    (changes.pricingFlips?.length || 0) +
    (changes.playbookTransitions?.length || 0) +
    (changes.redTeamIngests?.length || 0) +
    (changes.brakeForced?.length || 0) +
    (changes.newGaps?.length || 0)
  );
}

function diffSnapshots(prev, curr) {
  if (!prev?.instruments || !curr?.instruments) {
    return { available: false, reason: 'missing_snapshot', version: DIFF_VERSION };
  }
  const prevMap = new Map(prev.instruments.map((i) => [i.id, i]));
  const changes = emptyChanges();

  for (const c of curr.instruments) {
    const p = prevMap.get(c.id);
    if (!p) {
      changes.newClaims.push({
        id: c.id,
        name: c.name,
        claimId: c.claimId,
        confidence: c.confidence,
      });
      continue;
    }

    if (p.claimId && c.claimId && p.claimId !== c.claimId) {
      changes.claimSwaps.push({
        id: c.id,
        name: c.name,
        from: p.claimId,
        to: c.claimId,
        text: `${c.name} · 命题 ${String(p.claimId).slice(-8)}→${String(c.claimId).slice(-8)}`,
      });
    }

    if (p.direction !== c.direction) {
      changes.directionFlips.push({
        id: c.id,
        name: c.name,
        from: p.directionLabel,
        to: c.directionLabel,
      });
    }

    if (p.stateKey !== c.stateKey && (p.stateKey || c.stateKey)) {
      changes.regimeFlips.push({
        id: c.id,
        name: c.name,
        from: p.stateKey || '暂无',
        to: c.stateKey || '暂无',
      });
    }

    if (p.pricingState !== c.pricingState && (p.pricingState || c.pricingState)) {
      changes.pricingFlips.push({
        id: c.id,
        name: c.name,
        from: p.pricingState || '暂无',
        to: c.pricingState || '暂无',
        text: `${c.name} · 定价 ${p.pricingState || '暂无'}→${c.pricingState || '暂无'}`,
      });
    }

    if (p.playbookId !== c.playbookId && (p.playbookId || c.playbookId)) {
      changes.playbookTransitions.push({
        id: c.id,
        name: c.name,
        from: p.playbookId || '暂无',
        to: c.playbookId || '暂无',
        fromStage: p.playbookStage || null,
        toStage: c.playbookStage || null,
        text: `${c.name} · 剧本 ${p.playbookId || '暂无'}→${c.playbookId || '暂无'}`,
      });
    } else if (
      p.playbookStage !== c.playbookStage &&
      p.playbookId &&
      p.playbookId === c.playbookId &&
      (p.playbookStage || c.playbookStage)
    ) {
      changes.playbookTransitions.push({
        id: c.id,
        name: c.name,
        from: c.playbookId,
        to: c.playbookId,
        fromStage: p.playbookStage || '暂无',
        toStage: c.playbookStage || '暂无',
        text: `${c.name} · ${c.playbookId} 阶段 ${p.playbookStage || '暂无'}→${c.playbookStage || '暂无'}`,
      });
    }

    if (p.confidence !== c.confidence && (p.confidence || c.confidence)) {
      const order = ['不可判定', '证伪进行中', '叙事分歧', '弱结构', '强结构'];
      const pi = order.indexOf(p.confidence);
      const ci = order.indexOf(c.confidence);
      const row = { id: c.id, name: c.name, from: p.confidence, to: c.confidence };
      if (ci > pi) changes.upgraded.push(row);
      else if (ci < pi) changes.downgraded.push(row);
      else if (pi < 0 || ci < 0) changes.downgraded.push(row);
    }

    if (c.claimStatus === 'falsified' && p.claimStatus !== 'falsified') {
      changes.falsified.push({
        id: c.id,
        name: c.name,
        trigger: c.falsifyTrigger || '—',
        from: p.claimStatus,
      });
    }
    if (c.claimStatus === 'falsifying' && p.claimStatus !== 'falsifying') {
      changes.downgraded.push({
        id: c.id,
        name: c.name,
        from: p.claimStatus || p.confidence,
        to: '证伪进行中',
      });
    }

    const ingestedNow = (c.redTeamIngested || 0) > (p.redTeamIngested || 0);
    const forceNew = c.redTeamForce && !p.redTeamForce;
    const debtNew = c.dissentDebt && !p.dissentDebt;
    if (ingestedNow || forceNew || debtNew) {
      changes.redTeamIngests.push({
        id: c.id,
        name: c.name,
        ingested: c.redTeamIngested || 0,
        force: Boolean(c.redTeamForce),
        debt: Boolean(c.dissentDebt),
        text: debtNew
          ? `${c.name} · 红队反对债务`
          : `${c.name} · 红队入库+${c.redTeamIngested || 0}${forceNew ? ' · 强制降档' : ''}`,
      });
    }

    if (c.confidenceBrakeForced && !p.confidenceBrakeForced) {
      changes.brakeForced.push({
        id: c.id,
        name: c.name,
        text: `${c.name} · 自信刹车降档`,
      });
    }

    const prevCrit = p.unknownCritical || 0;
    const currCrit = c.unknownCritical || 0;
    if (currCrit > prevCrit) {
      changes.newGaps.push({
        id: c.id,
        name: c.name,
        from: prevCrit,
        to: currCrit,
        labels: c.unknownCriticalLabels || [],
        text: `${c.name} · Unknown 关键缺口 ${prevCrit}→${currCrit}${
          c.unknownCriticalLabels?.length ? ` · ${c.unknownCriticalLabels.join('/')}` : ''
        }`,
        dataSource: 'unknown-map',
      });
    }

    if ((c.surprise ?? 0) > 0.5) {
      changes.surpriseTop.push({
        id: c.id,
        name: c.name,
        surprise: c.surprise,
        pushTier: c.pushTier,
      });
    }
  }

  changes.surpriseTop.sort((a, b) => (b.surprise ?? 0) - (a.surprise ?? 0));
  changes.surpriseTop = changes.surpriseTop.slice(0, 5);

  const material = materialChangeCount(changes);
  const quietDay = material === 0 && changes.surpriseTop.length === 0;

  return {
    version: DIFF_VERSION,
    available: true,
    date: curr.date,
    prevDate: prev.date,
    materialChanges: material,
    quietDay,
    quietReason: quietDay
      ? '无命题/剧本/定价/regime/置信/证伪/红队/刹车/缺口物质变化'
      : null,
    changes,
    summary: buildDiffSummary(changes, material),
    note: '静默仅当物质变更=0；宽快照含剧本/定价/红队/刹车/Unknown',
    dataSource: 'intel-daily-diff',
    method: 'wide-snapshot-material-diff',
  };
}

function buildDiffSummary(changes, material) {
  const parts = [];
  if (changes.falsified.length) parts.push(`证伪${changes.falsified.length}`);
  if (changes.claimSwaps.length) parts.push(`命题换${changes.claimSwaps.length}`);
  if (changes.playbookTransitions.length) parts.push(`剧本${changes.playbookTransitions.length}`);
  if (changes.pricingFlips.length) parts.push(`定价${changes.pricingFlips.length}`);
  if (changes.regimeFlips.length) parts.push(`regime${changes.regimeFlips.length}`);
  if (changes.directionFlips.length) parts.push(`方向${changes.directionFlips.length}`);
  if (changes.upgraded.length) parts.push(`升级${changes.upgraded.length}`);
  if (changes.downgraded.length) parts.push(`降级${changes.downgraded.length}`);
  if (changes.redTeamIngests.length) parts.push(`红队${changes.redTeamIngests.length}`);
  if (changes.brakeForced.length) parts.push(`刹车${changes.brakeForced.length}`);
  if (changes.newGaps.length) parts.push(`缺口${changes.newGaps.length}`);
  if (changes.surpriseTop.length) parts.push(`高惊讶${changes.surpriseTop.length}`);
  if (!parts.length) return material === 0 ? '今日无显著结构变化' : `物质变更 ${material}`;
  return parts.join(' · ');
}

function buildDailyDiff(instruments, opts = {}) {
  const today = opts.date || new Date().toISOString().slice(0, 10);
  const persist = opts.persist !== false;
  const packMeta = {
    p0Count: instruments?.filter((i) => i.intelCenter?.question?.priority === 'P0').length ?? 0,
    interruptCount:
      instruments?.filter((i) => i.intelCenter?.pushTier?.tier === 'interrupt').length ?? 0,
    ...(opts.packMeta || {}),
  };

  const curr = {
    date: today,
    instruments: (instruments || []).map(slimInstrument),
  };

  let prev = null;
  if (opts.prevDate) prev = loadDailySnapshot(opts.prevDate);
  else {
    const dir = getIntelDir();
    if (dir) {
      const daily = path.join(dir, 'daily-snapshots');
      if (fs.existsSync(daily)) {
        const files = fs
          .readdirSync(daily)
          .filter((f) => f.endsWith('.json') && f < `${today}.json`)
          .sort();
        if (files.length) prev = loadDailySnapshot(files[files.length - 1].replace('.json', ''));
      }
    }
  }

  const diff = prev
    ? diffSnapshots(prev, curr)
    : {
        version: DIFF_VERSION,
        available: false,
        reason: 'no_prev_snapshot',
        quietDay: false,
        quietReason: '无前日快照 · 不可判定静默',
        materialChanges: null,
        changes: emptyChanges(),
        summary: '无前日快照 · 待校验',
        dataSource: 'intel-daily-diff',
      };

  if (persist) {
    saveDailySnapshot(instruments, packMeta, today);
    const outPath = getIntelDir() ? path.join(getIntelDir(), 'daily-diff', `${today}.json`) : null;
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        JSON.stringify({ ...diff, packMeta, generatedAt: new Date().toISOString() }, null, 2),
        'utf8'
      );
      return { ...diff, outPath, packMeta };
    }
  }

  return { ...diff, packMeta };
}

function loadLatestDailyDiff() {
  const dir = getIntelDir();
  if (!dir) return null;
  const daily = path.join(dir, 'daily-diff');
  if (!fs.existsSync(daily)) return null;
  const files = fs.readdirSync(daily).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(daily, files[files.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

function listDailyDiffFiles(limit = 30) {
  const dir = getIntelDir();
  if (!dir) return [];
  const daily = path.join(dir, 'daily-diff');
  if (!fs.existsSync(daily)) return [];
  return fs
    .readdirSync(daily)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(daily, f), 'utf8'));
        return {
          date: j.date || f.replace('.json', ''),
          quietDay: Boolean(j.quietDay),
          materialChanges: j.materialChanges ?? null,
          available: j.available !== false,
          summary: j.summary || null,
        };
      } catch {
        return { date: f.replace('.json', ''), quietDay: false, available: false };
      }
    });
}

function computeQuietStreak(asOf, limit = 14) {
  const files = listDailyDiffFiles(limit);
  if (!files.length) {
    return { streak: null, nDisplay: '暂无', note: '无日差归档', dataSource: 'intel-daily-diff' };
  }
  let streak = 0;
  for (const f of files) {
    if (asOf && f.date > asOf) continue;
    if (!f.available) break;
    if (f.quietDay) streak += 1;
    else break;
  }
  return {
    streak: streak > 0 ? streak : 0,
    nDisplay: String(streak),
    sampleN: files.filter((f) => f.available).length,
    note: streak > 0 ? `连续静默 ${streak} 日` : '今日非静默或无连续',
    dataSource: 'intel-daily-diff',
    method: 'daily-diff-quiet-streak',
  };
}

module.exports = {
  DIFF_VERSION,
  slimInstrument,
  saveDailySnapshot,
  loadDailySnapshot,
  diffSnapshots,
  buildDailyDiff,
  loadLatestDailyDiff,
  listDailyDiffFiles,
  computeQuietStreak,
  materialChangeCount,
  emptyChanges,
};
