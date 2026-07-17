/**
 * 情报中心 · Intelligence Calendar（构想 §27）
 * 不是「有数据提醒」，而是：发布前定价了什么 → 发布后 surprise → 3/5/10 日结构是否跟上。
 * 仅用真实 release 日历 / 仓单落盘 / 日 K；缺失标「暂无」。
 */
const {
  buildReleaseCalendar,
  getReleasePhase,
  RELEASE_DEFS,
} = require('./commodity-release-calendar');
const { resolveDeliveryMonth } = require('./delivery-calendar');

const INTEL_CAL_VERSION = 'v2.78.0-calendar-follow-os';

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function parseYmd(ymd) {
  const d = new Date(`${normDate(ymd)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}

function addDays(ymd, n) {
  const d = parseYmd(ymd);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function findInst(instruments, symbol) {
  const id = String(symbol || '').toLowerCase();
  return (instruments || []).find((i) => String(i.id).toLowerCase() === id) || null;
}

/** 发布前：市场已定价什么（命题 / 定价状态 / 内外） */
function buildPreReleaseIntel(release, instruments) {
  const symbols = release.symbols || [];
  const rows = [];
  for (const sym of symbols.slice(0, 6)) {
    const inst = findInst(instruments, sym);
    if (!inst) {
      rows.push({ symbol: sym, available: false, display: `${sym}·暂无品种` });
      continue;
    }
    const ic = inst.intelCenter || {};
    const claim = ic.primaryClaim;
    const pricing = ic.pricingState?.state || null;
    const dual = ic.dualNarrative?.regime || null;
    rows.push({
      symbol: sym,
      name: inst.name,
      available: Boolean(claim?.claimId),
      claimId: claim?.claimId || null,
      claimStatus: claim?.status || null,
      confidence: claim?.confidence || ic.beliefLevel || null,
      statement: claim?.statement ? String(claim.statement).slice(0, 72) : null,
      pricingState: pricing,
      dualRegime: dual,
      display: claim?.statement
        ? `${inst.name}·${claim.confidence || '—'}·定价${pricing || '待校验'}`
        : `${inst.name}·命题暂无`,
      dataSource: 'intel-center+claim',
    });
  }

  const pricedIn = rows.filter((r) => r.pricingState === 'priced-in').length;
  const mispriced = rows.filter((r) => r.pricingState === 'mispriced').length;
  const unknown = rows.filter((r) => !r.available || r.pricingState === 'unknown').length;

  let marketPricedLabel = '暂无';
  if (rows.some((r) => r.available)) {
    if (mispriced > pricedIn) marketPricedLabel = '盘面尚未充分定价（mispriced 占优）';
    else if (pricedIn > 0 && mispriced === 0) marketPricedLabel = '盘面似已定价（priced-in）';
    else if (unknown === rows.length) marketPricedLabel = '定价状态不足 · 待校验';
    else marketPricedLabel = '定价混合 · 需事件验证';
  }

  return {
    phase: 'pre',
    marketPricedLabel,
    instrumentReads: rows,
    display: `发布前 · ${marketPricedLabel}`,
    dataSource: 'intel-intelligence-calendar',
  };
}

/** 发布后 surprise（复用 release-data-surprise；无 fundamentals 则诚实暂无） */
function buildPostReleaseIntel(release, instruments, fundamentals, newsItems) {
  const phase = getReleasePhase(release);
  if (!['post_release', 'in_window', 'passed'].includes(phase) && (release.hoursUntil == null || release.hoursUntil > 0)) {
    return {
      phase: 'post',
      available: false,
      display: '尚未发布 · surprise 待触发',
      dataSource: 'pending',
    };
  }

  try {
    const { assessReleaseDataSurprise } = require('./release-data-surprise');
    const outlookPayload = { instruments };
    const surprise = assessReleaseDataSurprise(release, fundamentals || null, outlookPayload, newsItems || []);
    if (!surprise) {
      return { phase: 'post', available: false, display: '该发布类型暂无 surprise 评估', dataSource: 'missing' };
    }
    return {
      phase: 'post',
      available: surprise.level !== 'unknown',
      surprise,
      display: surprise.label || '发布后·待校验',
      level: surprise.level,
      score: surprise.score,
      nEvidence: surprise.evidence?.length || 0,
      dataSource: surprise.dataSource || 'release-data-surprise',
    };
  } catch (err) {
    return {
      phase: 'post',
      available: false,
      display: 'surprise 评估失败·待校验',
      error: err.message,
      dataSource: 'error',
    };
  }
}

function loadReturnSince(instrumentId, fromDate, toDate) {
  try {
    const { readCachedKlines } = require('./commodity-technical-analyzer');
    const bars = (readCachedKlines(instrumentId) || [])
      .map((k) => ({
        date: String(k.date || k.day || '').slice(0, 10),
        close: Number(k.close ?? k.c ?? 0),
      }))
      .filter((b) => b.date && b.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const from = bars.filter((b) => b.date <= fromDate).pop();
    const to = bars.filter((b) => b.date <= toDate).pop();
    if (!from || !to || !(from.close > 0)) return { pct: null, n: 0, from: null, to: null };
    const inRange = bars.filter((b) => b.date >= from.date && b.date <= to.date);
    return {
      pct: +(((to.close - from.close) / from.close) * 100).toFixed(4),
      n: inRange.length,
      from: from.date,
      to: to.date,
      dataSource: 'readCachedKlines',
    };
  } catch {
    return { pct: null, n: 0, from: null, to: null, dataSource: 'missing' };
  }
}

function structureSide(inst) {
  const sf = inst?.factors?.inventory?.stockFlowJoint || inst?.intelCenter?._enrichedInstrument?.factors?.inventory?.stockFlowJoint;
  const bias = sf?.structureBias || inst?.intelCenter?.primaryClaim?.side || null;
  if (bias === 'bull' || bias === 'bear' || bias === 'flat') return bias;
  return null;
}

/**
 * 发布后 horizon 日：价格是否与结构同向
 */
function assessFollowThrough(release, instruments, asOf, horizonDays) {
  const releaseDate = normDate(release.releaseDate);
  const end = addDays(releaseDate, horizonDays);
  if (!end) return { available: false, display: '日期无效', horizonDays };

  const daysSince = daysBetween(releaseDate, asOf);
  if (daysSince == null || daysSince < horizonDays) {
    return {
      available: false,
      pending: true,
      horizonDays,
      daysSince,
      display: `T+${horizonDays} 尚未满（已过 ${daysSince ?? '—'} 日）`,
      dataSource: 'pending',
    };
  }

  const reads = [];
  let agree = 0;
  let disagree = 0;
  let scored = 0;

  for (const sym of (release.symbols || []).slice(0, 5)) {
    const inst = findInst(instruments, sym);
    const ret = loadReturnSince(sym, releaseDate, end);
    if (ret.pct == null || ret.n < 2) {
      reads.push({ symbol: sym, available: false, display: `${sym}·日K不足` });
      continue;
    }
    const struct = inst ? structureSide(inst) : null;
    const priceSide = ret.pct > 0.35 ? 'bull' : ret.pct < -0.35 ? 'bear' : 'flat';
    let align = null;
    if (struct && struct !== 'flat' && priceSide !== 'flat') {
      scored += 1;
      align = struct === priceSide;
      if (align) agree += 1;
      else disagree += 1;
    }
    reads.push({
      symbol: sym,
      available: true,
      returnPct: ret.pct,
      n: ret.n,
      nDisplay: String(ret.n),
      structureSide: struct,
      priceSide,
      align,
      display: `${sym} ${ret.pct > 0 ? '+' : ''}${ret.pct.toFixed(2)}% · 结构${struct || '暂无'}${
        align == null ? '' : align ? '·跟上' : '·未跟上'
      }`,
      dataSource: ret.dataSource,
    });
  }

  let verdict = '暂无';
  if (scored === 0) verdict = '结构样本不足 · 不计分';
  else if (agree > disagree) verdict = `结构跟上价格 ${agree}/${scored}`;
  else if (disagree > agree) verdict = `结构未跟上 ${disagree}/${scored}`;
  else verdict = `结构与价格分歧 ${agree}/${scored}`;

  return {
    available: scored > 0 || reads.some((r) => r.available),
    pending: false,
    horizonDays,
    agree,
    disagree,
    scored,
    nDisplay: scored > 0 ? `${agree}/${scored}` : '暂无',
    verdict,
    reads,
    display: `T+${horizonDays} · ${verdict}`,
    dataSource: 'readCachedKlines+stock-flow',
    method: 'structure-vs-price-follow',
  };
}

function enrichReleaseEvent(release, instruments, asOf, { fundamentals, newsItems } = {}) {
  const phase = getReleasePhase(release);
  const pre = buildPreReleaseIntel(release, instruments);
  const post = buildPostReleaseIntel(release, instruments, fundamentals, newsItems);
  const follow3 = assessFollowThrough(release, instruments, asOf, 3);
  const follow5 = assessFollowThrough(release, instruments, asOf, 5);
  const follow10 = assessFollowThrough(release, instruments, asOf, 10);

  let intelPhase = 'upcoming';
  if (phase === 'pre_release' || (release.hoursUntil != null && release.hoursUntil >= 0 && release.hoursUntil <= 48)) {
    intelPhase = 'pre';
  } else if (phase === 'post_release' || phase === 'in_window') {
    intelPhase = 'post';
  } else if (phase === 'passed') {
    if (follow3.pending === false && follow3.available) intelPhase = 'follow';
    else intelPhase = 'post';
  }

  const question =
    intelPhase === 'pre'
      ? `${release.name} 发布前：市场定价了什么？${pre.marketPricedLabel}`
      : intelPhase === 'post'
        ? `${release.name} 发布后：${post.display}`
        : `${release.name} 跟进：${follow5.display || follow3.display}`;

  return {
    eventId: `${release.id}-${release.releaseDate}`,
    type: 'data_release',
    ...release,
    intelPhase,
    pre,
    post,
    followThrough: { d3: follow3, d5: follow5, d10: follow10 },
    question,
    dataSource: 'intel-intelligence-calendar',
  };
}

/** 仓单：以上一次落盘日为锚，下一交易日为「待校验」窗口（不伪造公布时刻） */
function buildWarehouseEvents(instruments, asOf, daysAhead) {
  const events = [];
  const seen = new Set();
  try {
    const wh = require('./shfe-warehouse-fetcher');
    for (const inst of instruments || []) {
      const id = String(inst.id || '').toLowerCase();
      if (!id || seen.has(id)) continue;
      const rows = wh.loadWarehouseRows?.(id);
      if (!rows?.length) continue;
      const last = rows[rows.length - 1];
      const lastDate = normDate(last.date || last.weekEnding);
      if (!lastDate) continue;
      seen.add(id);
      const lag = daysBetween(lastDate, asOf);
      if (lag == null) continue;
      // 已滞后 ≥1 日：标为待更新；前瞻：asOf+1 作为下一仓单观察窗
      const nextObserve = addDays(asOf, 1);
      if (!nextObserve || daysBetween(asOf, nextObserve) > daysAhead) continue;
      events.push({
        eventId: `warehouse-${id}-${nextObserve}`,
        type: 'warehouse',
        id: `warehouse-${id}`,
        name: `${inst.name || id} 仓单观察`,
        agency: last.exchange || 'SHFE/DCE',
        releaseDate: nextObserve,
        releaseAt: null,
        releaseAtLocal: '交易所日更·确切时刻以官网为准',
        estimated: true,
        confidence: 'observe-window',
        method: 'warehouse-last-print+next-session',
        dataSource: last.source || 'shfe-warehouse-fetcher',
        symbols: [id],
        lastWarehouseDate: lastDate,
        lagDays: lag,
        hoursUntil: lag <= 0 ? 12 : lag * 24,
        imminent: lag >= 1 && lag <= 2,
        intelPhase: lag >= 1 ? 'pre' : 'follow',
        pre: {
          phase: 'pre',
          marketPricedLabel: `上次仓单 ${lastDate}（滞后 ${lag} 日）`,
          instrumentReads: [
            {
              symbol: id,
              name: inst.name,
              available: true,
              display: `仓单 ${last.warehouse_receipt ?? last.warehouseReceipt ?? '—'} · Δ ${
                last.change_dod ?? last.changeDod ?? '—'
              }`,
              dataSource: 'warehouse',
            },
          ],
          display: `仓单观察 · 上次 ${lastDate}`,
          dataSource: 'shfe-warehouse-fetcher',
        },
        post: { phase: 'post', available: false, display: '日更后对照合证', dataSource: 'pending' },
        followThrough: null,
        question: `${inst.name}：仓单是否相对 ${lastDate} 翻转？合证是否确认？`,
      });
    }
  } catch {
    // warehouse optional
  }
  return events.slice(0, 12);
}

/** 交割月临近窗口 */
function buildDeliveryEvents(instruments, asOf, daysAhead) {
  const events = [];
  for (const inst of (instruments || []).slice(0, 40)) {
    const id = String(inst.id || '').toLowerCase();
    const ym = resolveDeliveryMonth(asOf, inst.sector, id);
    if (!ym) continue;
    const firstDay = `${ym}-01`;
    const daysTo = daysBetween(asOf, firstDay);
    if (daysTo == null || daysTo < 0 || daysTo > daysAhead) continue;
    events.push({
      eventId: `delivery-${id}-${ym}`,
      type: 'delivery',
      id: `delivery-${id}`,
      name: `${inst.name || id} 交割月 ${ym}`,
      releaseDate: firstDay,
      releaseAtLocal: '交割月首日',
      estimated: false,
      confidence: 'contract-month',
      method: 'delivery-calendar',
      dataSource: 'delivery-calendar',
      symbols: [id],
      hoursUntil: daysTo * 24,
      imminent: daysTo <= 5,
      intelPhase: daysTo <= 5 ? 'pre' : 'upcoming',
      pre: {
        phase: 'pre',
        marketPricedLabel: '展期/交割窗口临近',
        instrumentReads: [
          {
            symbol: id,
            available: Boolean(inst.intelCenter?.primaryClaim),
            display: inst.intelCenter?.primaryClaim?.statement?.slice(0, 64) || `${inst.name}·命题暂无`,
          },
        ],
        display: `交割月 ${ym} · ${daysTo} 日后`,
        dataSource: 'delivery-calendar',
      },
      post: { phase: 'post', available: false, display: '交割后结构再验', dataSource: 'pending' },
      followThrough: null,
      question: `${inst.name}：交割月 ${ym} 临近，基差/持仓是否异常？`,
    });
  }
  return events.slice(0, 8);
}

/**
 * @param {object[]} instruments — 含 intelCenter
 * @param {{ asOf?: string, daysAhead?: number, lookbackDays?: number, fundamentals?: object, newsItems?: object[] }} [opts]
 */
function buildIntelligenceCalendar(instruments, opts = {}) {
  const asOf = normDate(opts.asOf || new Date().toISOString().slice(0, 10));
  const daysAhead = opts.daysAhead ?? 14;
  const lookbackDays = opts.lookbackDays ?? 12;

  const cal = buildReleaseCalendar({
    daysAhead: daysAhead + lookbackDays,
    asOfDate: asOf,
    lookbackDays,
  });
  const pastAndFuture = (cal.releases || []).filter((r) => {
    const d = daysBetween(asOf, r.releaseDate);
    if (d == null) return false;
    return d >= -lookbackDays && d <= daysAhead;
  });

  const releaseEvents = pastAndFuture.map((r) =>
    enrichReleaseEvent(r, instruments, asOf, {
      fundamentals: opts.fundamentals,
      newsItems: opts.newsItems,
    })
  );

  const warehouseEvents = buildWarehouseEvents(instruments, asOf, Math.min(daysAhead, 5));
  const deliveryEvents = buildDeliveryEvents(instruments, asOf, daysAhead);

  const events = [...releaseEvents, ...warehouseEvents, ...deliveryEvents].sort((a, b) => {
    const da = a.releaseDate || '';
    const db = b.releaseDate || '';
    return da.localeCompare(db);
  });

  const imminent = events.filter((e) => e.imminent || e.intelPhase === 'pre');
  const followWatch = events.filter(
    (e) =>
      e.followThrough &&
      (e.followThrough.d3?.pending === false ||
        e.followThrough.d5?.pending === false ||
        e.followThrough.d10?.pending === false)
  );
  const postActive = events.filter((e) => e.intelPhase === 'post');

  return {
    version: INTEL_CAL_VERSION,
    asOf,
    daysAhead,
    lookbackDays,
    eventCount: events.length,
    imminentCount: imminent.length,
    postCount: postActive.length,
    followCount: followWatch.length,
    events,
    imminent: imminent.slice(0, 8),
    followWatch: followWatch.slice(0, 6),
    next: events.find((e) => daysBetween(asOf, e.releaseDate) >= 0) || null,
    display: `情报日历 ${events.length} 项 · 临近/发布前 ${imminent.length} · 跟进观察 ${followWatch.length}`,
    releaseDefs: Object.keys(RELEASE_DEFS),
    dataSource: 'intel-intelligence-calendar',
    method: 'pre-price+post-surprise+structure-follow',
  };
}

/**
 * 从日历跟进窗提取结构未跟上 / 发布前定价问句 → 问题队列
 */
function buildCalendarFollowQuestions(calendar) {
  const questions = [];
  if (!calendar) return questions;

  for (const ev of calendar.imminent || []) {
    if (ev.intelPhase !== 'pre' && !ev.imminent) continue;
    questions.push({
      priority: 'P2',
      score: ev.type === 'data_release' ? 34 : ev.type === 'delivery' ? 26 : 22,
      instrumentId: (ev.symbols || [])[0] || null,
      instrumentName: (ev.symbols || [])[0] || ev.name,
      symbols: ev.symbols || [],
      question: ev.question || `${ev.name}：发布前市场定价了什么？`,
      reasons: ['情报日历', ev.intelPhase || 'pre', ev.type],
      calendarPhase: 'pre',
      eventId: ev.eventId,
      dataSource: 'intel-intelligence-calendar',
    });
  }

  for (const ev of calendar.followWatch || []) {
    const ft = ev.followThrough || {};
    for (const key of ['d5', 'd3', 'd10']) {
      const f = ft[key];
      if (!f || f.pending || !f.available || f.scored === 0) continue;
      if ((f.disagree || 0) <= (f.agree || 0)) continue;
      const sym = (ev.symbols || [])[0] || null;
      questions.push({
        priority: 'P2',
        score: 32 + (key === 'd5' ? 4 : key === 'd10' ? 2 : 0),
        instrumentId: sym,
        instrumentName: sym || ev.name,
        symbols: ev.symbols || [],
        question: `${ev.name} ${f.display}：价格与结构背离，叙事是否透支？`,
        reasons: ['情报日历跟进', f.verdict, `n=${f.nDisplay || '暂无'}`],
        calendarPhase: 'follow',
        eventId: ev.eventId,
        followHorizon: f.horizonDays,
        nDisplay: f.nDisplay || '暂无',
        dataSource: 'intel-intelligence-calendar',
      });
      break; // 每个事件一条主跟进问
    }
  }

  for (const ev of calendar.events || []) {
    if (ev.intelPhase !== 'post' || !ev.post?.available) continue;
    if (ev.post.level === 'unknown' || !ev.post.surprise) continue;
    const sym = (ev.symbols || [])[0] || null;
    questions.push({
      priority: 'P2',
      score: 30,
      instrumentId: sym,
      instrumentName: sym || ev.name,
      symbols: ev.symbols || [],
      question: ev.question || `${ev.name} 发布后：${ev.post.display}`,
      reasons: ['情报日历', 'post-surprise', ev.post.level || ''],
      calendarPhase: 'post',
      eventId: ev.eventId,
      dataSource: 'intel-intelligence-calendar',
    });
  }

  return questions.sort((a, b) => b.score - a.score).slice(0, 14);
}

function enrichQuestionQueueWithCalendar(queue, calendar) {
  const qs = buildCalendarFollowQuestions(calendar);
  if (!queue || !qs.length) return queue;
  const existing = new Set((queue.all || []).map((q) => `${q.instrumentId}|${q.question}`));
  const extra = [];
  for (const q of qs) {
    if (!q.instrumentId) continue;
    const key = `${q.instrumentId}|${q.question}`;
    if (existing.has(key)) continue;
    extra.push({
      instrumentId: q.instrumentId,
      instrumentName: q.instrumentName,
      sector: null,
      priority: q.priority || 'P2',
      priorityLabel: q.calendarPhase === 'follow' ? '日历跟进' : '情报日历',
      score: q.score,
      question: q.question,
      reasons: q.reasons,
      claimId: null,
      pushTier: 'watch',
      calendarPhase: q.calendarPhase,
      eventId: q.eventId,
      nDisplay: q.nDisplay,
    });
  }
  const all = [...(queue.all || []), ...extra].sort((a, b) => b.score - a.score);
  const deep = all.filter((i) => ['P0', 'P1', 'P2', 'P3'].includes(i.priority)).slice(0, 16);
  return {
    ...queue,
    all,
    deepQueue: deep,
    calendarInjected: extra.length,
    version: `${queue.version || ''}+calendar`,
  };
}

module.exports = {
  INTEL_CAL_VERSION,
  buildIntelligenceCalendar,
  buildPreReleaseIntel,
  buildPostReleaseIntel,
  assessFollowThrough,
  enrichReleaseEvent,
  buildCalendarFollowQuestions,
  enrichQuestionQueueWithCalendar,
};
