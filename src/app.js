const TAB_KEYS = ['indices', 'commodities', 'macro', 'forex', 'policy', 'geopolitics', 'climate', 'outlook', 'fed', 'boj', 'treasury', 'xinhua'];
const TAB_LABELS = {
  indices: '全球指数',
  commodities: '大宗商品',
  macro: '中美宏观',
  forex: '外汇',
  policy: '政策雷达',
  geopolitics: '地缘政治',
  climate: '天气气候',
  outlook: '大宗走势研判 · Cursor 分析',
  fed: '美联储',
  boj: '日本央行',
  treasury: '美国财政部',
  xinhua: '新华社',
};
const DOT_CLASS = {
  indices: 'dot-indices',
  commodities: 'dot-commodities',
  macro: 'dot-macro',
  forex: 'dot-forex',
  policy: 'dot-policy',
  geopolitics: 'dot-geopolitics',
  climate: 'dot-climate',
  outlook: 'dot-outlook',
  fed: 'dot-fed',
  boj: 'dot-boj',
  treasury: 'dot-treasury',
  xinhua: 'dot-xinhua',
};

const CLIMATE_DISPLAY_LIMIT = 80;
const GEO_DISPLAY_LIMIT = 80;
const POLICY_DISPLAY_LIMIT = 80;
const OUTLOOK_INSTRUMENT_LIMIT = 32;
const OUTLOOK_INSTRUMENT_ROW_HEIGHT = 96;
const OUTLOOK_UI_VERSION = 'v2.61.0-intel-stage';
const USER_FOCUS_SYMBOL_IDS = [
  'au', 'ag', 'pt', 'pd', 'cu', 'al', 'zn', 'pb', 'ni', 'sn', 'ao',
  'si', 'ps', 'lc', 'rb', 'i', 'jm', 'fg', 'sa', 'sc', 'fu', 'ta', 'br', 'ru', 'nr',
  'eg', 'ma', 'm', 'y', 'rm', 'oi', 'p', 'cf', 'sr', 'jd', 'lh',
];
const USER_FOCUS_SET = new Set(USER_FOCUS_SYMBOL_IDS);
let focusDashboardCache = null;
let focusCoverageCache = null;
let focusReleaseCalCache = null;
let outlookHeadlinesCache = null;
let outlookHeadlinesLoadInFlight = false;
const OUTLOOK_DAILY_BRIEF_CACHE_MS = 60 * 60 * 1000;
const PHILOSOPHY_EPIGRAPH_FALLBACK =
  '在一个变化的世界里，结论只是一时的，并不是恒定不变的，变才是世界的主要部分';
let philosophyManifestCache = null;
const OUTLOOK_PREDICTION_SLOTS = [
  { id: 'pre-night', label: '20:55夜盘前' },
  { id: 'pre-day', label: '08:55日盘前' },
  { id: 'pre-afternoon', label: '13:25午盘前' },
];

async function ensurePhilosophyManifest() {
  if (philosophyManifestCache) return philosophyManifestCache;
  if (window.fancheng?.getPhilosophyManifest) {
    const data = await window.fancheng.getPhilosophyManifest();
    if (data && !data.error) {
      philosophyManifestCache = data;
      return data;
    }
  }
  philosophyManifestCache = {
    epigraph: PHILOSOPHY_EPIGRAPH_FALLBACK,
    principles: [
      { id: 'change_first', title: '变化优先', summary: '结论具时效性，随数据持续校正' },
      { id: 'outlook_anchor', title: '研判为纲', summary: '大宗走势研判定方向' },
      { id: 'chan_method', title: '缠论为术', summary: '多周期 K 线作入场印证' },
      { id: 'slot_correction', title: '时段校正', summary: '20:55 / 08:55 / 13:25 三槽' },
      { id: 'empirical_check', title: '实证对照', summary: '预测 vs 实际 · 复盘' },
      { id: 'gate_humility', title: '审慎 gate', summary: 'Phil 过滤 · 环境 disagree 则观望' },
    ],
    strategyStack: [],
  };
  return philosophyManifestCache;
}

function getPhilosophyEpigraph() {
  return philosophyManifestCache?.epigraph || PHILOSOPHY_EPIGRAPH_FALLBACK;
}

function buildClientPhilosophyAnchor(inst) {
  if (inst?.philosophyAnchor?.lines?.length) return inst.philosophyAnchor;
  const gateLabels = OUTLOOK_GATE_NEUTRAL_LABELS;
  const p = inst?.philosophy;
  const pf = inst?.philosophyFilter;
  const lines = [];
  lines.push({
    principleId: 'change_first',
    title: '变化优先',
    text: inst?.judgementUpdatedDisplay
      ? `结论具时效性 · 上次更新 ${inst.judgementUpdatedDisplay}${inst.changeDelta ? ' · 较上次有变更' : ''}`
      : '结论随数据滚动刷新，不作恒定断言',
  });
  if (p?.sdFinance?.note || p?.logicSummary) {
    lines.push({
      principleId: 'outlook_anchor',
      title: '研判为纲',
      text: (p.sdFinance?.note || p.logicSummary || '').slice(0, 160),
    });
  }
  const hasTech = (inst?.techBadges || []).some((b) =>
    /缠|结构|S\/R|支撑|阻力|chan/i.test(String(b.label || b.id || ''))
  );
  lines.push({
    principleId: 'chan_method',
    title: '缠论为术',
    text: hasTech ? '多周期结构已出现 · 入场须与研判同向' : '研判定方向 · 缠论 S/R 作入场印证',
  });
  lines.push({
    principleId: 'slot_correction',
    title: '时段校正',
    text: '三槽 20:55 / 08:55 / 13:25 持续校正',
  });
  if (pf) {
    lines.push({
      principleId: 'gate_humility',
      title: '审慎 gate',
      text: pf.filterPass
        ? 'Phil✓ 环境与哲学方向一致'
        : `Phil·过滤 · ${gateLabels[pf.neutralReason] || pf.neutralReason || '观望'}`,
      pass: pf.filterPass !== false,
    });
  }
  return { epigraph: getPhilosophyEpigraph(), lines };
}

function renderPhilosophyEpigraphHtml(extraClass = '') {
  return `<blockquote class="fancheng-philosophy-epigraph${extraClass ? ` ${extraClass}` : ''}">${escapeHtml(getPhilosophyEpigraph())}</blockquote>`;
}

function renderPhilosophyAnchorBlock(inst) {
  const anchor = buildClientPhilosophyAnchor(inst);
  if (!anchor?.lines?.length) return '';
  const rows = anchor.lines
    .map((line) => {
      const passCls =
        line.principleId === 'gate_humility'
          ? line.pass === false
            ? ' outlook-phil-anchor-block'
            : ' outlook-phil-anchor-pass'
          : '';
      return `<li class="outlook-phil-anchor-row${passCls}"><span class="outlook-phil-anchor-principle">${escapeHtml(line.title)}</span><span class="outlook-phil-anchor-text">${escapeHtml(line.text)}</span></li>`;
    })
    .join('');
  return `<div class="outlook-philosophy-anchor-block">
    ${renderOutlookSectionHead('哲学锚点', 'philAnchor', inst.id)}
    <p class="outlook-philosophy-anchor-note">结论具时效性 · 变才是主部 · 下列为当前品种与六原则的对应</p>
    <ul class="outlook-phil-anchor-list">${rows}</ul>
    <button type="button" class="btn-link outlook-philosophy-link" data-action="open-philosophy">阅读完整梵澄哲学 →</button>
  </div>`;
}

function formatChanStructurePrice(inst, price) {
  if (window.PriceTick) {
    return window.PriceTick.formatPriceForInstrument(inst?.id, price);
  }
  if (price == null || Number.isNaN(Number(price))) return '—';
  return String(Number(price));
}

function isOutlookPilotInstrument(inst) {
  const id = String(inst?.id || '').toLowerCase();
  return (
    inst?.tradingGuidance?.pilot === true ||
    inst?.longTermGuidance?.pilot === true ||
    USER_FOCUS_SET.has(id)
  );
}

function isUserFocusInstrument(inst) {
  return USER_FOCUS_SET.has(String(inst?.id || '').toLowerCase());
}

function getFocusAnalysisForInstrument(instOrId) {
  const id = typeof instOrId === 'string' ? instOrId : instOrId?.id;
  if (!id) return null;
  const key = String(id).toLowerCase();
  const fromInst = typeof instOrId === 'object' ? instOrId?.__focusAnalysis : null;
  if (fromInst?.analysis) return fromInst;
  const fromDash = focusDashboardCache?.instruments?.find((r) => String(r.symbol).toLowerCase() === key);
  if (fromDash?.analysis) return { analysis: fromDash.analysis, generatedAt: fromDash.generatedAt };
  return null;
}

function renderOutlookEntryReadinessBadge(inst) {
  const lt = inst?.longTermGuidance;
  if (!lt?.pilot || !lt.entry?.readiness) return '';
  const readiness = lt.entry.readiness;
  const labels = { ready: '入场·就绪', approaching: '入场·等待', 'not-ready': '入场·未就绪', missed: '入场·错过' };
  const label = labels[readiness] || readiness;
  return `<span class="outlook-entry-badge outlook-entry-${escapeAttr(readiness)}" title="${escapeAttr(lt.entry.reason || '')}">${escapeHtml(label)}</span>`;
}

function renderOutlookL2EnsembleStrip(inst) {
  const l2 = inst?.l2Live;
  if (!l2 || l2.error) return '';
  const confPct = l2.confidence != null ? `${Math.round(l2.confidence * 100)}%` : '—';
  const backend = l2.backend || 'stub';
  const blended =
    l2.blendedComposite != null
      ? `${l2.blendedComposite >= 0 ? '+' : ''}${Number(l2.blendedComposite).toFixed(2)}`
      : '—';
  const appliedNote = l2.directionApplied
    ? ' · <span class="outlook-l2-applied" title="L2 融合分已反馈至 headline 方向">已反馈方向层</span>'
    : '';
  const sf = inst?.intelCenter?.staffFace;
  const asRef = sf && sf.fortuneChromeAllowed === false;
  const body = `<div class="outlook-l2-ensemble-head">L2 Ensemble · ${escapeHtml(l2.version || 'v1.48')}${appliedNote}</div>
    <div class="outlook-l2-ensemble-grid">
      <span><strong>${escapeHtml(l2.directionLabel || '—')}</strong> · P(up) ${escapeHtml(String(l2.pUp ?? '—'))}</span>
      <span>置信 ${escapeHtml(confPct)} · 后端 ${escapeHtml(backend)}</span>
      <span>融合分 ${escapeHtml(blended)} · 权重 ${escapeHtml(String((l2.blendWeight ?? 0.25) * 100))}%</span>
    </div>
    <p class="outlook-l2-ensemble-summary">${escapeHtml(l2.logicSummary || '')}</p>`;
  if (asRef) {
    return `<details class="outlook-l2-ensemble-strip outlook-fortune-ref-details" role="note" aria-label="L2 ensemble 参考">
      <summary>L2 Ensemble · 参考（非方向指令）</summary>
      ${body}
    </details>`;
  }
  return `<div class="outlook-l2-ensemble-strip" role="note" aria-label="L2 ensemble">
    ${body}
  </div>`;
}

function renderOutlookFourLayerStrip(inst) {
  const tg = inst?.tradingGuidance;
  if (!tg?.pilot) return '';
  const timing = tg.timing;
  const timingText =
    timing && typeof timing === 'object'
      ? `${timing.action || '—'} @ ${timing.slot || '—'}`
      : timing || '—';
  const pos = tg.position;
  const execText =
    pos?.pct != null && pos.invalidate != null
      ? `${pos.pct}% 风险预算 · 失效 ${formatOutlookPriceValue(pos.invalidate, inst)}`
      : pos?.note || '待校验';
  return `<div class="outlook-four-layer-strip" role="group" aria-label="研判四层">
    <div class="outlook-four-layer-head">研判四层</div>
    <div class="outlook-four-layer-grid">
      <div class="outlook-four-layer-cell" data-layer="bias"><span class="outlook-four-layer-label">第一层 · Bias</span><strong>${escapeHtml(tg.bias || '—')}</strong></div>
      <div class="outlook-four-layer-cell" data-layer="phase"><span class="outlook-four-layer-label">第二层 · Phase</span><strong>${escapeHtml(tg.phase || '—')}</strong></div>
      <div class="outlook-four-layer-cell" data-layer="posture"><span class="outlook-four-layer-label">第三层 · Posture</span><strong>${escapeHtml(tg.posture || '—')}</strong></div>
      <div class="outlook-four-layer-cell" data-layer="execution"><span class="outlook-four-layer-label">第四层 · Execution</span><strong>${escapeHtml(timingText)}</strong><span class="outlook-four-layer-sub">${escapeHtml(execText)}</span></div>
    </div>
  </div>`;
}

function renderOutlookPilotScopeNote(inst) {
  if (isUserFocusInstrument(inst) || isOutlookPilotInstrument(inst)) return '';
  const spec = inst?.integratedSpec;
  const regimeLine = spec?.regime ? `Regime ${spec.regime.regime}（${spec.regime.label}）` : 'Regime 待校验';
  return `<div class="outlook-pilot-scope-note" role="note">
    <p><strong>非关注品种</strong> · ${escapeHtml(regimeLine)} · W${escapeHtml(spec?.watchLevel || '0')} · 完整指导仅覆盖用户关注池 ${USER_FOCUS_SYMBOL_IDS.length} 品种。</p>
  </div>`;
}

function renderOutlookNonPilotGuidanceStub(inst) {
  const tg = inst?.tradingGuidance;
  if (tg?.pilot) return '';
  if (tg?.method === 'stub-non-pilot' || !isOutlookPilotInstrument(inst)) {
    return `<div class="outlook-non-pilot-stub">
      <p>交易指导 · <strong>暂无</strong>（非试点品种）</p>
    </div>`;
  }
  return '';
}

function renderOutlookLongTermGuidanceBlock(inst) {
  const lt = inst?.longTermGuidance;
  if (!lt?.pilot) {
    if (lt?.method === 'stub-non-pilot' || !isOutlookPilotInstrument(inst)) {
      return `<div class="outlook-longterm-guidance-block outlook-longterm-stub">
        ${renderOutlookSectionHead('长线交易指导', 'longTermGuidance', inst.id)}
        <p class="outlook-lt-stub">暂无 · 完整长线指导仅试点品种</p>
      </div>`;
    }
    return '';
  }
  const entry = lt.entry || {};
  const stop = lt.stop || {};
  const hold = lt.hold || {};
  const readiness = entry.readiness || 'not-ready';
  const readinessLabels = {
    ready: '就绪',
    approaching: '接近',
    'not-ready': '未就绪',
    missed: '已错过',
  };
  const conditions = (entry.conditions || [])
    .map(
      (c) =>
        `<li class="outlook-lt-condition${c.met ? ' met' : ''}"><span class="outlook-lt-cond-icon">${c.met ? '✓' : '○'}</span> ${escapeHtml(c.label)} · ${escapeHtml(c.evidence || '')} <span class="outlook-lt-cond-src">${escapeHtml(c.dataSource || '')}</span></li>`
    )
    .join('');
  const zone = entry.suggestedEntryZone;
  const zoneLine =
    zone?.low != null && zone?.high != null
      ? `<p class="outlook-lt-zone"><strong>建议入场区</strong> ${formatOutlookPriceValue(zone.low, inst)} ~ ${formatOutlookPriceValue(zone.high, inst)} <span class="outlook-lt-zone-note">（结构/区间 · 非点预测）</span></p>`
      : '<p class="outlook-lt-zone"><strong>建议入场区</strong> 待校验</p>';
  const fmtStop = (v) => (v != null ? formatOutlookPriceValue(v, inst) : '待校验');
  const stopLadder = `<div class="outlook-lt-stop-ladder">
    <div class="outlook-lt-stop-row"><span class="outlook-lt-stop-label">硬止损</span><span class="outlook-lt-stop-val">${fmtStop(stop.hardStop)}</span><span class="outlook-lt-stop-type">${escapeHtml(stop.stopType || '—')}</span></div>
    <div class="outlook-lt-stop-row"><span class="outlook-lt-stop-label">软预警</span><span class="outlook-lt-stop-val">${fmtStop(stop.softStop)}</span><span class="outlook-lt-stop-rationale">${escapeHtml(stop.softRationale || '—')}</span></div>
    <div class="outlook-lt-stop-row"><span class="outlook-lt-stop-label">移动止损</span><span class="outlook-lt-stop-val">${fmtStop(stop.trailingStop)}</span><span class="outlook-lt-stop-rationale">${escapeHtml(stop.trailingMethod || '')} ${escapeHtml(stop.trailingRationale || '')}</span></div>
  </div>`;
  const earlyCls = stop.riskOfEarlyStop ? ` outlook-lt-early-${escapeAttr(stop.riskOfEarlyStop)}` : '';
  const rr = lt.rewardRisk;
  const rrLine =
    rr?.ratio != null
      ? `<p class="outlook-lt-rr"><strong>盈亏比</strong> ${escapeHtml(String(rr.ratio))}:1 · 目标区 ${formatOutlookPriceValue(rr.targetZone?.low, inst)} ~ ${formatOutlookPriceValue(rr.targetZone?.high, inst)} <span class="outlook-lt-rr-method">${escapeHtml(rr.method || '')}</span></p>`
      : '';
  const capLine =
    lt.globalRiskCap
      ? `<p class="outlook-lt-cap"><strong>流动性上限</strong> ${escapeHtml(lt.globalRiskCap)}</p>`
      : '';
  const positionCapLine =
    lt.positionPctCap != null
      ? `<p class="outlook-lt-position-cap"><strong>散户仓位 cap</strong> ${escapeHtml(String(lt.positionPctCap))}%${lt.scoutSizeMultiplier != null && lt.scoutSizeMultiplier < 1 ? ` · scout×${escapeHtml(String(lt.scoutSizeMultiplier))}` : ''}</p>`
      : '';
  const carryLine = inst.integratedSpec?.carryRoll?.carryLine
    ? `<p class="outlook-lt-carry"><strong>展期/持有</strong> ${escapeHtml(inst.integratedSpec.carryRoll.carryLine)}</p>`
    : '';
  const chainRows = (stop.logicChain || [])
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.layer || '')}</td><td>${escapeHtml(String(c.conclusion ?? ''))}</td><td>${escapeHtml(c.evidence || '')}</td><td>${escapeHtml(c.dataSource || '')}</td></tr>`
    )
    .join('');
  return `<div class="outlook-longterm-guidance-block">
    ${renderOutlookSectionHead('长线交易指导', 'longTermGuidance', inst.id)}
    <div class="outlook-lt-header">
      <span class="outlook-lt-readiness outlook-lt-readiness-${escapeAttr(readiness)}" title="${escapeAttr(entry.reason || '')}">${escapeHtml(readinessLabels[readiness] || readiness)}</span>
      <span class="outlook-lt-horizon">${escapeHtml(lt.horizon || 'weeks-to-months')}</span>
    </div>
    <p class="outlook-lt-entry-reason">${escapeHtml(entry.reason || '—')}</p>
    ${zoneLine}
    <ul class="outlook-lt-conditions">${conditions || '<li>条件待校验</li>'}</ul>
    <h6 class="outlook-lt-subhead">止损阶梯</h6>
    <p class="outlook-lt-stop-rationale-main">${escapeHtml(stop.rationale || '待校验')}</p>
    ${stopLadder}
    <p class="outlook-lt-early-risk${earlyCls}"><strong>过早止损风险</strong> ${escapeHtml(stop.riskOfEarlyStop || '—')}</p>
    <h6 class="outlook-lt-subhead">持仓耐心</h6>
    <p class="outlook-lt-hold">最短持有建议 <strong>${hold.minHoldDays != null ? `${hold.minHoldDays} 天` : '—'}</strong> · 命题 <strong>${escapeHtml(hold.thesisStatus || '—')}</strong>${hold.thesisEvidence ? ` · ${escapeHtml(hold.thesisEvidence)}` : ''}</p>
    <p class="outlook-lt-scale">${hold.addPoint != null ? `加仓参考 ${formatOutlookPriceValue(hold.addPoint, inst)}` : '加仓参考 待校验'} · ${hold.reducePoint != null ? `减仓参考 ${formatOutlookPriceValue(hold.reducePoint, inst)}` : '减仓参考 待校验'}</p>
    ${rrLine}${capLine}${positionCapLine}${carryLine}
    <details class="outlook-lt-chain-details">
      <summary>逻辑链 (${(stop.logicChain || []).length})</summary>
      <table class="outlook-lt-chain-table">
        <thead><tr><th>层</th><th>结论</th><th>证据</th><th>来源</th></tr></thead>
        <tbody>${chainRows || '<tr><td colspan="4">暂无</td></tr>'}</tbody>
      </table>
    </details>
    <p class="outlook-lt-meta">${escapeHtml(lt.method || '')} · ${escapeHtml(lt.version || '')} · ${escapeHtml(lt.asOf ? formatDate(lt.asOf) : '')}</p>
    ${readiness === 'ready' ? `<p class="outlook-lt-premortem-note">长线就绪 · 试仓/入场前须完成<a href="#" data-action="open-pre-mortem" data-instrument="${escapeAttr(inst.id)}" data-posture="试仓">事前验尸</a></p>` : ''}
  </div>`;
}

function updateLlmStatusIndicators() {
  const html = renderLlmStatusSpan();
  document.querySelectorAll('[data-llm-status]').forEach((el) => {
    el.outerHTML = html;
  });
}

function renderLlmStatusSpan() {
  const cursor = window.__cursorStatus;
  const s = window.__llmStatus;
  if (cursor?.configured) {
    const model = cursor.model ? ` · ${cursor.model}` : '';
    return `<span class="outlook-ai-fusion-llm-status llm-configured cursor-configured" data-llm-status>Cursor 已连接${escapeHtml(model)}</span>`;
  }
  if (!s) {
    return '<span class="outlook-ai-fusion-llm-status" data-llm-status>Cursor 检测中…</span>';
  }
  if (s.cursor?.configured) {
    const model = s.cursor.model ? ` · ${s.cursor.model}` : '';
    return `<span class="outlook-ai-fusion-llm-status llm-configured cursor-configured" data-llm-status>Cursor 已连接${escapeHtml(model)}</span>`;
  }
  return '<span class="outlook-ai-fusion-llm-status cursor-unconfigured" data-llm-status>Cursor 未配置 · 请设置 CURSOR_API_KEY</span>';
}

async function setupLlmStatusIndicator() {
  if (window.fancheng?.getCursorStatus) {
    try {
      window.__cursorStatus = await window.fancheng.getCursorStatus();
    } catch {
      window.__cursorStatus = { configured: false };
    }
  }
  if (window.fancheng?.getLlmStatus) {
    try {
      window.__llmStatus = await window.fancheng.getLlmStatus();
    } catch {
      window.__llmStatus = { configured: false, model: null, providerHint: null };
    }
  }
  updateLlmStatusIndicators();
  const panel = document.getElementById('panel-outlook');
  if (panel?.querySelector('.outlook-ai-assistant-hub')) {
    void hydrateOutlookAiFusionHub(panel);
  }
}

function renderOutlookCursorAnalysisBlock(inst) {
  if (!isUserFocusInstrument(inst)) return '';
  const cached = getFocusAnalysisForInstrument(inst);
  const a = cached?.analysis || {};
  const focusRow = focusDashboardCache?.instruments?.find(
    (r) => String(r.symbol).toLowerCase() === String(inst.id).toLowerCase()
  );
  const tg = inst.tradingGuidance;
  const posLine =
    tg?.posture && tg?.position?.pct != null
      ? `${tg.posture} · ${tg.position.pct}% 风险预算`
      : tg?.posture || '暂无';
  const badges = [];
  if (focusRow?.isMajorOpportunity) badges.push('<span class="outlook-badge outlook-badge-major">★ 重大机会</span>');
  if (focusRow?.isTop5) badges.push(`<span class="outlook-badge outlook-badge-top5">Top${focusRow.top5Rank}</span>`);
  if (focusRow && !focusRow.read) badges.push('<span class="outlook-badge outlook-badge-unread">未读</span>');

  const section = (title, content, key) => {
    const text = content?.trim();
    if (!text) {
      return `<div class="outlook-cursor-section outlook-cursor-section-empty" data-section="${key}">
        <h6 class="outlook-cursor-section-title">${escapeHtml(title)}</h6>
        <p class="outlook-cursor-section-body">暂无 · 点击「重新生成」获取 Cursor 分析</p>
      </div>`;
    }
    return `<div class="outlook-cursor-section" data-section="${key}">
      <h6 class="outlook-cursor-section-title">${escapeHtml(title)}</h6>
      <div class="outlook-cursor-section-body">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
    </div>`;
  };

  const loading = inst.__focusAnalysisLoading;
  const err = a.error && !a.text ? a.error : null;
  const meta = a.model
    ? `${a.provider || 'cursor'} · ${a.model} · ${a.method || ''}`
    : cached?.generatedAt
      ? `缓存 · ${formatDate(cached.generatedAt)}`
      : '';

  return `<div class="outlook-cursor-analysis-block" data-cursor-analysis-for="${escapeAttr(inst.id)}">
    ${renderOutlookSectionHead('Cursor 每日分析', 'cursorAnalysis', inst.id)}
    <div class="outlook-cursor-analysis-head">
      ${badges.join('')}
      <span class="outlook-cursor-structured-posture" title="引擎结构化 posture">引擎 posture：<strong>${escapeHtml(posLine)}</strong></span>
      <button type="button" class="btn-link outlook-cursor-regen-btn" data-action="regen-focus-analysis" data-instrument="${escapeAttr(inst.id)}">${loading ? '生成中…' : '重新生成'}</button>
    </div>
    ${loading ? '<p class="outlook-cursor-loading">Cursor 分析生成中，请稍候…</p>' : ''}
    ${err ? `<p class="outlook-cursor-error">${escapeHtml(err)}</p>` : ''}
    <div class="outlook-cursor-sections">
      ${section('基本面分析', a.fundamentalAnalysis, 'fundamental')}
      ${section('走势分析', a.trendAnalysis, 'trend')}
      ${section('操作建议（做多/做空/仓位）', a.positionAdvice, 'position')}
    </div>
    ${a.text && (!a.fundamentalAnalysis || !a.trendAnalysis) ? `<details class="outlook-cursor-raw"><summary>完整分析原文</summary><pre class="outlook-cursor-raw-text">${escapeHtml(a.text)}</pre></details>` : ''}
    <p class="outlook-cursor-meta">${escapeHtml(meta)} · 分析仅基于真实结构化数据，禁止编造</p>
    ${renderLlmStatusSpan()}
  </div>`;
}

function renderOutlookAiFusionBlock(inst) {
  if (isUserFocusInstrument(inst)) {
    const cursorBlock = renderOutlookCursorAnalysisBlock(inst);
    const chips = renderOutlookAiFusionDetailChips(inst);
    return `${cursorBlock}
    <div class="outlook-ai-fusion-block outlook-ai-fusion-qa-only" data-ai-fusion-for="${escapeAttr(inst.id)}">
      ${renderOutlookSectionHead('Cursor 追问', 'aiFusion', inst.id)}
      <div class="outlook-ai-fusion-qa">
        <div class="outlook-ai-fusion-chips-wrap">${chips}</div>
        <div class="outlook-ai-fusion-input-row">
          <input type="text" class="outlook-ai-fusion-input" placeholder="向 Cursor 追问当前品种…" data-instrument="${escapeAttr(inst.id)}" aria-label="Cursor 追问" />
          <button type="button" class="btn-link outlook-ai-fusion-ask-btn" data-action="ask-fancheng-ai-submit" data-instrument="${escapeAttr(inst.id)}">提问</button>
        </div>
        <div class="outlook-ai-fusion-answer" hidden></div>
      </div>
      <p class="outlook-ai-fusion-footer">追问由 Cursor 模型基于结构化数据回答，非规则模板</p>
    </div>`;
  }
  const spec = inst?.integratedSpec;
  const brief = inst?.aiFusion?.instrumentBrief;
  const counter = brief?.counterThesis || inst?.aiFusion?.counterThesis;
  if (!brief && !spec) {
    return `<div class="outlook-ai-fusion-block">
      ${renderOutlookSectionHead('梵澄研判助手 · AI 融合', 'aiFusion', inst.id)}
      <p class="outlook-ai-fusion-empty">摘要待校验</p>
      <p class="outlook-ai-fusion-footer">结论来自梵澄结构化数据，非独立预测</p>
      ${renderLlmStatusSpan()}
    </div>`;
  }
  if (!brief) {
    const ctPoints = (counter?.points || []).map((p) => `<li>${escapeHtml(p.text)}</li>`).join('');
    return `<div class="outlook-ai-fusion-block">
      ${renderOutlookSectionHead('梵澄研判助手 · AI 融合', 'aiFusion', inst.id)}
      <p class="outlook-ai-fusion-empty">结构化摘要待校验 · integrated spec 已就绪</p>
      ${ctPoints ? `<h6 class="outlook-ai-fusion-subhead">反证（必选）</h6><ul class="outlook-ai-fusion-counter">${ctPoints}</ul>` : ''}
      ${renderLlmStatusSpan()}
    </div>`;
  }
  const keyRows = (brief.keyPoints || [])
    .map(
      (kp) =>
        `<li class="outlook-ai-fusion-point">${escapeHtml(kp.text)} <span class="outlook-ai-fusion-cite" title="${escapeAttr(kp.citation?.source || '')}">[${escapeHtml(kp.citation?.field || '—')}]</span></li>`
    )
    .join('');
  const riskRows = (brief.risks || [])
    .map(
      (r) =>
        `<li class="outlook-ai-fusion-risk">${escapeHtml(r.text)} <span class="outlook-ai-fusion-cite" title="${escapeAttr(r.citation?.source || '')}">[${escapeHtml(r.citation?.field || '—')}]</span></li>`
    )
    .join('');
  const citeRows = (brief.citations || [])
    .slice(0, 20)
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.field || '')}</td><td>${escapeHtml(String(c.value ?? '—'))}</td><td>${escapeHtml(c.source || '')}</td></tr>`
    )
    .join('');
  const chips = renderOutlookAiFusionDetailChips(inst);
  const counterRows = (counter?.points || [])
    .map((p) => `<li class="outlook-ai-fusion-counter-point">${escapeHtml(p.text)}</li>`)
    .join('');
  return `<div class="outlook-ai-fusion-block" data-ai-fusion-for="${escapeAttr(inst.id)}">
    ${renderOutlookSectionHead('梵澄研判助手 · AI 融合', 'aiFusion', inst.id)}
    <p class="outlook-ai-fusion-summary">${escapeHtml(brief.summary || '—')}</p>
    <p class="outlook-ai-fusion-action"><strong>行动建议</strong> ${escapeHtml(brief.actionAdvice || '暂无')}</p>
    ${keyRows ? `<h6 class="outlook-ai-fusion-subhead">要点</h6><ul class="outlook-ai-fusion-points">${keyRows}</ul>` : ''}
    ${riskRows ? `<h6 class="outlook-ai-fusion-subhead">风险</h6><ul class="outlook-ai-fusion-risks">${riskRows}</ul>` : ''}
    <details class="outlook-ai-fusion-counter-details">
      <summary>反证 Counter-thesis（必选）</summary>
      <ul class="outlook-ai-fusion-counter">${counterRows || '<li>暂无强反证 · 跟踪 falsify</li>'}</ul>
      ${counter?.summary ? `<p class="outlook-ai-fusion-counter-summary">${escapeHtml(counter.summary)}</p>` : ''}
    </details>
    <div class="outlook-ai-fusion-qa">
      <div class="outlook-ai-fusion-chips-wrap">${chips}</div>
      <div class="outlook-ai-fusion-input-row">
        <input type="text" class="outlook-ai-fusion-input" placeholder="提问当前品种研判…" data-instrument="${escapeAttr(inst.id)}" aria-label="AI 融合问答" />
        <button type="button" class="btn-link outlook-ai-fusion-ask-btn" data-action="ask-fancheng-ai-submit" data-instrument="${escapeAttr(inst.id)}">提问</button>
      </div>
      <div class="outlook-ai-fusion-answer" hidden></div>
    </div>
    <details class="outlook-ai-fusion-citations">
      <summary>引用来源 (${(brief.citations || []).length})</summary>
      <table class="outlook-ai-fusion-cite-table">
        <thead><tr><th>字段</th><th>值</th><th>来源</th></tr></thead>
        <tbody>${citeRows || '<tr><td colspan="3">暂无</td></tr>'}</tbody>
      </table>
    </details>
    <p class="outlook-ai-fusion-meta">${escapeHtml(brief.method || '')} · ${escapeHtml(brief.version || OUTLOOK_UI_VERSION)} · ${escapeHtml(brief.asOf ? formatDate(brief.asOf) : '')}</p>
    <p class="outlook-ai-fusion-footer">结论来自梵澄结构化数据，非独立预测</p>
    ${renderLlmStatusSpan()}
  </div>`;
}

function resolveOutlookInstrumentId(symbolOrId) {
  if (!symbolOrId) return null;
  const key = String(symbolOrId).toLowerCase();
  const list = window.__outlookCacheInstruments || [];
  const hit = list.find(
    (i) => i.id === key || String(i.symbol || '').toLowerCase() === key || String(i.name || '').toLowerCase() === key
  );
  return hit?.id || key;
}

function ensureOutlookEmpiricalVisible(panel) {
  const empirical = panel?.querySelector('.outlook-empirical-collapsed');
  if (empirical && !empirical.open) empirical.open = true;
}

function scrollToOutlookAiFusion(panel, instrumentId) {
  if (!panel) return;
  ensureOutlookEmpiricalVisible(panel);
  const id = instrumentId || outlookSelectedInstrumentId;
  const block =
    (id && panel.querySelector(`.outlook-ai-fusion-block[data-ai-fusion-for="${id}"]`)) ||
    panel.querySelector('.outlook-ai-fusion-block');
  if (block) block.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resolveOutlookMacroBrief(source) {
  const cached = source?.aiMacroBrief || window.__outlookCacheAiMacroBrief;
  if (cached?.summary) return cached;
  return null;
}

function resolveOutlookHubInstrument(source, selectedInst) {
  if (selectedInst?.id) return selectedInst;
  const instruments = source?.instruments || window.__outlookCacheInstruments || [];
  const holdings = (window.__portfolioHoldings || []).map((h) => String(h).toLowerCase()).filter(Boolean);
  const preferred = [...holdings, 'au'];
  for (const pid of preferred) {
    const hit = instruments.find((i) => String(i.id).toLowerCase() === pid && !i.outlookPending);
    if (hit) return hit;
  }
  const visible =
    outlookSectorFilter === 'all'
      ? instruments
      : instruments.filter((i) => i.sector === outlookSectorFilter);
  return visible.find((i) => !i.outlookPending) || visible[0] || instruments[0] || null;
}

function resolveOutlookInstrumentPreviewSummary(inst) {
  const brief = inst?.aiFusion?.instrumentBrief;
  if (brief?.summary) return brief.summary;
  const tg = inst?.tradingGuidance;
  if (tg?.pilot && tg.posture) {
    const bias = tg.bias ? ` · ${tg.bias}` : '';
    const phase = tg.phase ? ` · ${tg.phase}` : '';
    return `${inst.name || inst.id} · posture ${tg.posture}${bias}${phase} · 结构化摘要`;
  }
  const spec = inst?.integratedSpec;
  if (spec?.regime) {
    return `${inst.name || inst.id} · regime ${spec.regime.regime} · W${spec.watchLevel || '0'} · 展开详情可问答`;
  }
  return null;
}

function resolveFanchengAiPresetChipsApi() {
  return window.FanchengAiPresetChips || null;
}

function renderFanchengAiChipButton(inst, chip, extraClass = '') {
  const cls = ['outlook-ai-fusion-chip', extraClass].filter(Boolean).join(' ');
  return `<button type="button" class="${cls}" data-action="ask-fancheng-ai-chip" data-instrument="${escapeAttr(inst.id)}" data-question="${escapeAttr(chip.question)}" title="${escapeAttr(chip.question)}">${escapeHtml(chip.label)}</button>`;
}

function renderOutlookAiFusionDetailChips(inst) {
  const api = resolveFanchengAiPresetChipsApi();
  const grouped = api?.getDetailPresetChipsByGroup?.() || [];
  if (!grouped.length) {
    const fallback = ['为什么是这个 posture？', '现在适合长线开仓吗？', '全球风险有何影响？', '止损逻辑是什么？'];
    return `<div class="outlook-ai-fusion-chips">${fallback.map((q) => `<button type="button" class="outlook-ai-fusion-chip" data-action="ask-fancheng-ai-chip" data-instrument="${escapeAttr(inst.id)}" data-question="${escapeAttr(q)}">${escapeHtml(q)}</button>`).join('')}</div>`;
  }
  return `<div class="outlook-ai-fusion-chips-grid">${grouped
    .map(
      (g) =>
        `<div class="outlook-ai-fusion-chip-group"><span class="outlook-ai-fusion-chip-group-label">${escapeHtml(g.group)}</span><div class="outlook-ai-fusion-chips">${g.chips.map((chip) => renderFanchengAiChipButton(inst, chip)).join('')}</div></div>`
    )
    .join('')}</div>`;
}

function renderOutlookAiHubPresetChips(inst) {
  if (!inst?.id) return '';
  const api = resolveFanchengAiPresetChipsApi();
  const chips = api?.getHubPresetChips?.() || [
    { label: '全球风险有何影响？', question: '全球风险有何影响？' },
    { label: '为什么是这个 posture？', question: '为什么是这个 posture？' },
    { label: '现在适合长线开仓吗？', question: '现在适合长线开仓吗？' },
  ];
  return `<div class="outlook-ai-assistant-chips outlook-ai-assistant-chips-hub">${chips
    .map((chip) => renderFanchengAiChipButton(inst, chip, 'outlook-ai-assistant-chip'))
    .join('')}</div>`;
}

function renderOutlookMacroSummaryHtml(macroBrief, source) {
  if (macroBrief?.summary) {
    const llmTag = macroBrief.method === 'llm-augmented' ? ' · LLM 润色' : '';
    return `${escapeHtml(macroBrief.summary)}${llmTag ? `<span class="outlook-ai-assistant-method">${escapeHtml(llmTag)}</span>` : ''}`;
  }
  const gr = source?.globalLiquidityRisk || source?.globalRisk || window.__outlookCacheGlobalRisk;
  if (!gr) {
    return '<span class="outlook-ai-assistant-pending">全球风险数据暂无 · 宏观 AI 待校验</span>';
  }
  return '<span class="outlook-ai-assistant-loading">宏观 AI 摘要加载中…</span>';
}

function renderOutlookAiAssistantHub(source, selectedInst) {
  const macroBrief = resolveOutlookMacroBrief(source);
  const inst = resolveOutlookHubInstrument(source, selectedInst);
  const instPreview = inst ? resolveOutlookInstrumentPreviewSummary(inst) : null;
  const macroSummary = renderOutlookMacroSummaryHtml(macroBrief, source);
  const instBlock = inst
    ? `<div class="outlook-ai-assistant-instrument">
        <h4 class="outlook-ai-assistant-inst-head">${escapeHtml(inst.name || inst.id)} · 品种 AI 摘要</h4>
        <p class="outlook-ai-assistant-inst-summary">${instPreview ? escapeHtml(instPreview) : '摘要加载中…'}</p>
        <button type="button" class="btn-link outlook-ai-assistant-jump" data-action="scroll-to-ai-fusion" data-instrument="${escapeAttr(inst.id)}">展开完整 AI 融合与问答 ↓</button>
      </div>`
    : `<p class="outlook-ai-assistant-hint">品种列表加载中…</p>`;
  const qaBlock = inst
    ? `<div class="outlook-ai-assistant-qa">
        ${renderOutlookAiHubPresetChips(inst)}
        <div class="outlook-ai-assistant-answer" hidden></div>
      </div>`
    : '';
  return `<section class="outlook-ai-assistant-hub" aria-label="梵澄研判助手">
    <header class="outlook-ai-assistant-head">
      <h3 class="outlook-ai-assistant-title">梵澄研判助手 · AI 融合</h3>
      ${renderLlmStatusSpan()}
    </header>
    <div class="outlook-ai-assistant-grid">
      <div class="outlook-ai-assistant-col outlook-ai-assistant-col-macro">
        <h4 class="outlook-ai-assistant-subhead">宏观 AI 解读</h4>
        <p class="outlook-ai-assistant-macro-summary" data-macro-summary>${macroSummary}</p>
        ${macroBrief?.actionAdvice ? `<p class="outlook-ai-assistant-macro-action"><strong>宏观含义</strong> ${escapeHtml(macroBrief.actionAdvice)}</p>` : ''}
      </div>
      <div class="outlook-ai-assistant-col outlook-ai-assistant-col-inst">${instBlock}</div>
    </div>
    ${qaBlock}
    <p class="outlook-ai-assistant-footer">结论来自梵澄结构化数据，非独立预测 · LLM 可在设置中配置</p>
  </section>`;
}

async function hydrateOutlookAiFusionHub(panel, source) {
  if (!panel) return;
  let data = source || getOutlookCachedSource() || {};
  let gr = data.globalLiquidityRisk || data.globalRisk || window.__outlookCacheGlobalRisk;
  let brief = resolveOutlookMacroBrief(data);
  const augmentLlm = Boolean(window.__llmStatus?.configured);

  if (!gr && window.fancheng?.fetchOutlookLive) {
    const live = await window.fancheng.fetchOutlookLive({ force: false });
    if (live && !live.error) {
      data = { ...data, ...live };
      gr = live.globalLiquidityRisk || live.globalRisk;
      window.__outlookCacheGlobalRisk = gr || window.__outlookCacheGlobalRisk;
      window.__outlookCacheAiMacroBrief = live.aiMacroBrief || window.__outlookCacheAiMacroBrief;
      if (live.instruments?.length) window.__outlookCacheInstruments = live.instruments;
    }
  }

  if (!brief?.summary && window.fancheng?.getMacroAiBrief && gr) {
    const result = await window.fancheng.getMacroAiBrief({ augmentLlm: false });
    if (result?.brief?.summary) {
      brief = result.brief;
      window.__outlookCacheAiMacroBrief = brief;
    }
  } else if (brief?.summary && augmentLlm && brief.method !== 'llm-augmented' && window.fancheng?.getMacroAiBrief) {
    const result = await window.fancheng.getMacroAiBrief({ augmentLlm: true });
    if (result?.brief?.summary) {
      brief = result.brief;
      window.__outlookCacheAiMacroBrief = brief;
    }
  }

  const inst = resolveOutlookHubInstrument(data, outlookSelectedInstrumentId ? findOutlookInstrument(outlookSelectedInstrumentId) : null);
  if (inst && !inst.aiFusion?.instrumentBrief?.summary && window.fancheng?.getFanchengAiBrief) {
    const result = await window.fancheng.getFanchengAiBrief(inst.id);
    if (result?.aiFusion?.instrumentBrief && !result.error) {
      inst.aiFusion = result.aiFusion;
      inst.tradingGuidance = inst.tradingGuidance || findOutlookInstrument(inst.id)?.tradingGuidance;
      const list = window.__outlookCacheInstruments || [];
      const idx = list.findIndex((i) => i.id === inst.id);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          aiFusion: result.aiFusion,
          tradingGuidance: list[idx].tradingGuidance || inst.tradingGuidance,
        };
      }
      if (outlookSelectedInstrumentId === inst.id) {
        refreshOutlookDetailPanelContent(panel, findOutlookInstrument(inst.id) || inst);
      }
    }
  }

  refreshOutlookAiAssistantHub(panel, { ...data, aiMacroBrief: brief || data.aiMacroBrief });
  const macroBriefEl = panel.querySelector('.outlook-macro-ai-brief');
  if (macroBriefEl && brief) {
    macroBriefEl.outerHTML = renderOutlookMacroAiBrief({ aiMacroBrief: brief });
  }
}

function refreshOutlookAiAssistantHub(panel, source) {
  if (!panel) return;
  const data = source || { aiMacroBrief: window.__outlookCacheAiMacroBrief };
  const selectedInst = outlookSelectedInstrumentId ? findOutlookInstrument(outlookSelectedInstrumentId) : null;
  const html = renderOutlookAiAssistantHub(data, selectedInst);
  const hub = panel.querySelector('.outlook-ai-assistant-hub');
  if (hub) hub.outerHTML = html;
  else {
    const onePager = panel.querySelector('.outlook-decision-one-pager');
    if (onePager) onePager.insertAdjacentHTML('afterend', html);
  }
}

function renderOutlookMacroAiBrief(source) {
  const brief = resolveOutlookMacroBrief(source);
  if (!brief?.summary) {
    const gr = source?.globalLiquidityRisk || source?.globalRisk || window.__outlookCacheGlobalRisk;
    if (!gr) {
      return `<details class="outlook-macro-ai-brief outlook-macro-ai-brief-missing">
      <summary>AI 宏观解读 · 待校验</summary>
      <p class="outlook-macro-ai-empty">全球风险数据暂无</p>
    </details>`;
    }
    return `<details class="outlook-macro-ai-brief outlook-macro-ai-brief-missing">
      <summary>AI 宏观解读 · 加载中</summary>
      <p class="outlook-macro-ai-empty">宏观 brief 生成中…</p>
    </details>`;
  }
  const keyRows = (brief.keyPoints || [])
    .map((kp) => `<li>${escapeHtml(kp.text)}</li>`)
    .join('');
  const riskRows = (brief.risks || [])
    .map((r) => `<li class="outlook-macro-ai-risk">${escapeHtml(r.text)}</li>`)
    .join('');
  return `<details class="outlook-macro-ai-brief">
    <summary>AI 宏观解读 · ${escapeHtml(brief.method || 'structured-synthesis')}</summary>
    <p class="outlook-macro-ai-summary">${escapeHtml(brief.summary || '—')}</p>
    ${keyRows ? `<ul class="outlook-macro-ai-points">${keyRows}</ul>` : ''}
    ${riskRows ? `<ul class="outlook-macro-ai-risks">${riskRows}</ul>` : ''}
    <p class="outlook-macro-ai-action"><strong>宏观含义</strong> ${escapeHtml(brief.actionAdvice || '暂无')}</p>
    <p class="outlook-macro-ai-footer">结论来自梵澄结构化数据，非独立预测 · ${escapeHtml(brief.asOf ? formatDate(brief.asOf) : '')}</p>
  </details>`;
}

function renderOutlookPostureBadge(inst) {
  const tg = inst?.tradingGuidance;
  if (!tg?.pilot || !tg.posture) return '';
  const sf = inst?.intelCenter?.staffFace;
  if (sf && sf.fortuneChromeAllowed === false) {
    return `<span class="outlook-posture-badge outlook-posture-ref" data-posture="${escapeAttr(tg.posture)}" title="参考姿态·非指令 · ${escapeAttr(sf.display || '')}">参·${escapeHtml(tg.posture)}</span>`;
  }
  return `<span class="outlook-posture-badge" data-posture="${escapeAttr(tg.posture)}" title="交易指导 · ${escapeAttr(tg.phase || '')} · ${escapeAttr(tg.bias || '')}">${escapeHtml(tg.posture)}</span>`;
}

function renderImpactDimensionsBadge(item) {
  const dim = item.impactDimensions;
  const govTag = dim?.govPolicy?.label
    ? `<span class="outlook-headline-gov-tag" title="中国政府干预评估">${escapeHtml(dim.govPolicy.label)}</span>`
    : '';
  if (!dim) return item.impactSummary ? `<span class="outlook-headline-score" title="三维影响评估">${escapeHtml(item.impactSummary)}</span>${govTag}` : '';
  return `<span class="outlook-headline-dimensions" title="宽度=波及面 · 广度=冲击深度 · 时长=可持续 · 政府干预=部委政策力度">
    ${govTag}
    <span class="outlook-headline-dim">宽 ${dim.width}</span>
    <span class="outlook-headline-dim">${escapeHtml(dim.widthLabel || '')}</span>
    <span class="outlook-headline-dim-sep">·</span>
    <span class="outlook-headline-dim">广 ${dim.breadth}</span>
    <span class="outlook-headline-dim">${escapeHtml(dim.breadthLabel || '')}</span>
    <span class="outlook-headline-dim-sep">·</span>
    <span class="outlook-headline-dim">时 ${escapeHtml(dim.durationLabel || '—')}</span>
  </span>`;
}

function renderExpectationSurpriseBadge(item) {
  const s = item.expectationFactors?.surprise;
  if (!s?.label) return '';
  const cls =
    s.level === 'surprise_high'
      ? 'outlook-surprise-high'
      : s.level === 'priced_in'
        ? 'outlook-surprise-priced'
        : s.level === 'divergent'
          ? 'outlook-surprise-divergent'
          : 'outlook-surprise-moderate';
  return `<span class="outlook-headline-surprise ${cls}" title="${escapeAttr((s.evidence || []).join(' · '))}">预期差 · ${escapeHtml(s.label)}</span>`;
}

function renderFundamentalsHint(item) {
  const fund = item.expectationFactors?.productionConsumption?.fundamentals;
  if (!fund?.available || !fund.items?.length) return '';
  const hint = fund.items
    .slice(0, 2)
    .map((i) => `${i.name} ${i.value ?? '—'}${i.changePct != null ? ` (${i.changePct > 0 ? '+' : ''}${i.changePct}%)` : ''}`)
    .join(' · ');
  return `<span class="outlook-headline-fundamentals" title="品种基本面第八车道">${escapeHtml(hint)}</span>`;
}

function renderSourceQualityBadge(item) {
  const sq = item.sourceQuality || item.impactDimensions?.sourceQuality;
  if (!sq?.score) return '';
  const cls =
    sq.tier === 'official' || sq.tier === 'institutional'
      ? 'outlook-source-high'
      : sq.tier === 'noise'
        ? 'outlook-source-low'
        : 'outlook-source-mid';
  return `<span class="outlook-headline-source-quality ${cls}" title="${escapeAttr(sq.evidence || sq.tierLabel || '')}">来源 ${sq.score} · ${escapeHtml(sq.tierLabel || sq.tier)}</span>`;
}

function renderWatchPriorityBadge(item) {
  const high =
    item.watchPriority === 'high' ||
    item.impactDimensions?.expectationReview?.watchPriority === 'high';
  if (!high) return '';
  return '<span class="outlook-headline-watch-high" title="深跌/反内卷或沪铜战略关注">高度关注</span>';
}

function renderExpectationReviewStrip(item) {
  const review = item.impactDimensions?.expectationReview || item.impactDimensions?.relevance;
  if (!review?.expectationMagnitude && !review?.quality) return '';
  const mag = review.expectationMagnitude ?? review.contentMagnitude;
  const combined = review.quality ?? item.rankingScore;
  const narrative = review.narrative?.primary;
  const channels = (review.channels || []).join('、');
  const title = narrative ? `预期：${narrative}` : channels ? `传导通道：${channels}` : '';
  const combinedNote = combined && combined !== mag ? ` · 综合${combined}` : '';
  return `<span class="outlook-headline-expectation" title="${escapeAttr(title)}">预期 ${mag}${combinedNote}${channels ? ` · ${escapeHtml(channels)}` : ''}</span>`;
}

function renderExpectationNarrativeBlock(item) {
  const review = item.impactDimensions?.expectationReview || item.impactDimensions?.relevance;
  const narrative = review?.narrative?.primary;
  if (!narrative) return '';
  const climate = review.narrative?.climateNote;
  return `<p class="outlook-headline-expectation-narrative"><strong>预期传导</strong> ${escapeHtml(narrative)}${climate ? `<span class="outlook-headline-climate-note"> · ${escapeHtml(climate)}</span>` : ''}</p>`;
}

function renderImpactNewsCard(item, tierLabel) {
  if (!item) return '';
  const views = (item.professionalViews || [])
    .slice(0, 4)
    .map(
      (v) =>
        `<li class="outlook-headline-view"><span class="outlook-headline-view-src">${escapeHtml(v.source || '来源')}</span> ${escapeHtml(String(v.title).slice(0, 90))}${v.snippet ? ` — ${escapeHtml(String(v.snippet).slice(0, 100))}` : ''}</li>`
    )
    .join('');
  const cursor = item.cursorBrief;
  const cursorText = cursor?.sections?.summary || cursor?.sections?.event || cursor?.text || '';
  const cursorExtra = cursor?.sections?.transmission
    ? `<p class="outlook-headline-cursor-transmission"><strong>传导</strong> ${escapeHtml(String(cursor.sections.transmission).slice(0, 280))}</p>`
    : '';
  const cursorBlock = cursor?.text
    ? `<div class="outlook-headline-cursor"><strong>Cursor 研判</strong>${cursor.model ? `<span class="outlook-headline-cursor-model">${escapeHtml(cursor.model)}</span>` : ''}<div class="outlook-headline-cursor-body">${escapeHtml(String(cursorText).slice(0, 800))}</div>${cursorExtra}</div>`
    : cursor?.error
      ? `<div class="outlook-headline-cursor-pending">${escapeHtml(cursor.error)}</div>`
      : `<div class="outlook-headline-cursor-pending"><span class="spinner inline-spinner"></span> Cursor 解读生成中…</div>`;
  const sym = item.primarySymbol || (item.symbols || [])[0] || 'global';
  const openBtn = item.newsId
    ? `<button type="button" class="outlook-headline-read" data-action="open-focus-news" data-news-id="${escapeAttr(item.newsId)}" data-focus-symbol="${escapeAttr(sym)}">阅读全文</button>`
    : '';
  return `<article class="outlook-headline-card">
    <header class="outlook-headline-card-head">
      <span class="outlook-headline-tier">${escapeHtml(tierLabel)}</span>
      ${renderImpactDimensionsBadge(item)}
      ${renderSourceQualityBadge(item)}
      ${renderExpectationReviewStrip(item)}
      ${renderWatchPriorityBadge(item)}
      ${renderExpectationSurpriseBadge(item)}
      ${renderFundamentalsHint(item)}
      <span class="outlook-headline-until">置顶至 ${escapeHtml((item.pinUntil || '').slice(0, 10) || '—')}</span>
    </header>
    <h4 class="outlook-headline-title">${escapeHtml(item.title)}</h4>
    ${item.summary ? `<p class="outlook-headline-summary">${escapeHtml(String(item.summary).slice(0, 220))}${item.summaryIsEnglish ? ' <span class="outlook-headline-en-note">（英文摘要）</span>' : ''}</p>` : ''}
    ${renderExpectationNarrativeBlock(item)}
    ${views ? `<ul class="outlook-headline-views"><li class="outlook-headline-views-label">专业人士观点</li>${views}</ul>` : '<p class="outlook-headline-empty-views">专业人士观点 · 检索中或暂无</p>'}
    ${cursorBlock}
  <footer class="outlook-headline-foot">${openBtn}<span class="outlook-headline-src">${escapeHtml(item.source || '')} · ${item.publishedAt ? escapeHtml(formatDate(item.publishedAt)) : ''}</span></footer>
  </article>`;
}

function renderFeedNewsCard(item) {
  if (!item) return '';
  const sym = item.primarySymbol || (item.symbols || [])[0] || 'global';
  const openBtn = item.newsId
    ? `<button type="button" class="outlook-headline-read" data-action="open-focus-news" data-news-id="${escapeAttr(item.newsId)}" data-focus-symbol="${escapeAttr(sym)}">阅读</button>`
    : '';
  return `<article class="outlook-headline-card outlook-headline-card-feed">
    <header class="outlook-headline-card-head">
      <span class="outlook-headline-tier outlook-headline-tier-feed">快讯</span>
      ${renderImpactDimensionsBadge(item)}
    </header>
    <h4 class="outlook-headline-title">${escapeHtml(item.title)}</h4>
    ${item.summary ? `<p class="outlook-headline-summary">${escapeHtml(String(item.summary).slice(0, 160))}</p>` : ''}
    <footer class="outlook-headline-foot">${openBtn}<span class="outlook-headline-src">${escapeHtml(item.source || '')}</span></footer>
  </article>`;
}

function renderOutlookHeadlinesStack(headlines, source) {
  const h = headlines || outlookHeadlinesCache;
  const loading = h?.loading === true && !h?.global?.items?.length && !h?.feed?.items?.length;
  const alerts = h?.alerts || [];
  const alertBanner =
    alerts.length > 0
      ? `<div class="outlook-impact-alert" role="alert">⚠ 新检测到 ${alerts.length} 条重大影响资讯（${escapeHtml(alerts[0].title?.slice(0, 48) || '')}…）</div>`
      : '';
  const globalItems = h?.global?.items || [];
  const sectorItems = h?.sector?.items || [];
  const feedItems = h?.feed?.items || [];
  const liq = h?.liquidityDaily;
  const globalBody = globalItems.length
    ? globalItems.map((i) => renderImpactNewsCard(i, '全市场')).join('')
    : loading
      ? '<p class="outlook-headline-board-empty">正在加载重大影响资讯…</p>'
      : '<p class="outlook-headline-board-empty">暂无全市场重大影响 · 宽≥72·广≥55·时≥3天（关税/制裁/国常会/央行等系统性干预）</p>';
  const sectorBody = sectorItems.length
    ? sectorItems.map((i) => renderImpactNewsCard(i, (i.sectorLabels || []).join('、') || '板块')).join('')
    : loading
      ? '<p class="outlook-headline-board-empty">正在扫描板块重大影响…</p>'
      : '<p class="outlook-headline-board-empty">暂无板块重大影响 · 发改委/商务部/农业农村部等政府干预（收储·限价·限产）或实质供需事件</p>';
  const feedBody = feedItems.length
    ? feedItems.map((i) => renderFeedNewsCard(i)).join('')
    : loading
      ? '<p class="outlook-headline-board-empty">正在加载快讯…</p>'
      : '<p class="outlook-headline-board-empty">暂无快讯跟踪 · 日内盘面/外盘日评等短时效资讯（1 天）</p>';
  const liqSections = liq?.sections || {};
  const liqBody = liq?.text
    ? `<div class="outlook-liquidity-cursor-sections">
      ${['usMarkets', 'usBanking', 'japan', 'asia', 'europe', 'commodityLiq']
        .map((k) => {
          const labels = { usMarkets: '美国资本市场', usBanking: '美国银行业', japan: '日本', asia: '亚洲经济体', europe: '欧洲经济体', commodityLiq: '大宗流动性结论' };
          const val = liqSections[k];
          return val ? `<section><h5>${labels[k]}</h5><p>${escapeHtml(val).replace(/\n/g, '<br>')}</p></section>` : '';
        })
        .join('')}
    </div>`
    : liq?.error
      ? `<p class="outlook-headline-board-empty">${escapeHtml(liq.error)}</p>`
      : liq?.pending
        ? '<p class="outlook-headline-board-empty">全球流动性 Cursor 日更研判生成中…</p>'
        : '<p class="outlook-headline-board-empty">暂无全球流动性日更研判 · 点击「刷新」或等待后台生成</p>';
  return `<div class="outlook-headlines-stack" data-outlook-headlines-version="${escapeAttr(h?.version || '')}">
    ${alertBanner}
    ${renderOutlookGlobalLiquidityStrip(source)}
    <section class="outlook-headline-board outlook-headline-board-global">
      <header class="outlook-headline-board-head"><h3>① 全市场重大影响 <span class="outlook-headline-pin-hint">宽≥72·国常会/央行/全面制裁 · 须 Cursor 解读</span></h3>
      <button type="button" class="outlook-btn outlook-btn-sm" data-action="refresh-outlook-headlines">刷新</button></header>
      <div class="outlook-headline-board-body">${globalBody}</div>
    </section>
    <section class="outlook-headline-board outlook-headline-board-sector">
      <header class="outlook-headline-board-head"><h3>② 板块重大影响 <span class="outlook-headline-pin-hint">政府干预（收储/限价/限产）· 宽28-71 · 须 Cursor 解读</span></h3></header>
      <div class="outlook-headline-board-body">${sectorBody}</div>
    </section>
    <section class="outlook-headline-board outlook-headline-board-liquidity">
      <header class="outlook-headline-board-head"><h3>③ 全球流动性 · Cursor 日更 <span class="outlook-headline-pin-hint">美欧日亚资本市场/汇率/银行</span></h3></header>
      <div class="outlook-headline-board-body">${liqBody}</div>
    </section>
    <details class="outlook-headline-board outlook-headline-board-feed">
      <summary class="outlook-headline-board-head"><h3>④ 快讯跟踪 <span class="outlook-headline-pin-hint">日内/短时效 · 宽低或广低 · 保留 1 天</span></h3></summary>
      <div class="outlook-headline-board-body">${feedBody}</div>
    </details>
  </div>`;
}

async function loadOutlookHeadlines(options = {}) {
  if (!window.fancheng?.getOutlookHeadlines) return null;
  outlookHeadlinesLoadInFlight = true;
  try {
    const data = await window.fancheng.getOutlookHeadlines({
      skipScan: options.skipScan === true,
      runScan: options.runScan === true,
      enrichCursor: options.enrichCursor !== false,
      forceLiquidity: options.forceLiquidity === true,
      fast: options.fast !== false,
    });
    if (data?.error) {
      console.warn('[outlook-headlines]', data.error);
      return null;
    }
    outlookHeadlinesCache = data;
    return data;
  } catch (err) {
    console.warn('[outlook-headlines]', err);
    return null;
  } finally {
    outlookHeadlinesLoadInFlight = false;
  }
}

function applyOutlookHeadlinesFromPayload(headlines) {
  if (!headlines) return;
  outlookHeadlinesCache = headlines;
  outlookHeadlinesLoadInFlight = false;
  const panel = document.getElementById('panel-outlook');
  if (panel?.querySelector('.outlook-headlines-slot')) {
    paintOutlookHeadlinesAndDashboard(panel);
  }
}

function bindOutlookHeadlinesListener() {
  if (!window.fancheng?.onOutlookHeadlinesUpdated || window.__outlookHeadlinesBound) return;
  window.__outlookHeadlinesBound = true;
  window.fancheng.onOutlookHeadlinesUpdated((payload) => {
    if (payload?.headlines) {
      applyOutlookHeadlinesFromPayload(payload.headlines);
      return;
    }
    const p = document.getElementById('panel-outlook');
    const slot = p?.querySelector('.outlook-headlines-slot');
    if (slot && outlookHeadlinesCache) {
      slot.innerHTML = renderOutlookHeadlinesStack(outlookHeadlinesCache, {
        globalLiquidityRisk: window.__outlookCacheGlobalRisk,
      });
    }
  });
  window.fancheng.onOutlookImpactAlert?.((payload) => {
    if (!payload?.alerts?.length) return;
    const p = document.getElementById('panel-outlook');
    const stack = p?.querySelector('.outlook-headlines-stack');
    if (!stack || stack.querySelector('.outlook-impact-alert')) return;
    stack.insertAdjacentHTML(
      'afterbegin',
      `<div class="outlook-impact-alert" role="alert">⚠ 新检测 ${payload.alerts.length} 条重大影响资讯</div>`
    );
  });
}

function paintOutlookHeadlinesAndDashboard(panel) {
  if (!panel?.isConnected) return;
  const source = {
    globalLiquidityRisk: window.__outlookCacheGlobalRisk,
    globalRisk: window.__outlookCacheGlobalRisk,
  };
  const headlinesSlot = panel.querySelector('.outlook-headlines-slot');
  if (headlinesSlot) {
    headlinesSlot.innerHTML = renderOutlookHeadlinesStack(outlookHeadlinesCache, source);
  }
  const dashSlot = panel.querySelector('.outlook-focus-dashboard-slot');
  if (dashSlot && focusDashboardCache?.instruments?.length) {
    dashSlot.innerHTML = renderFocusDashboardSection(focusDashboardCache);
  }
  const covSlot = panel.querySelector('.outlook-focus-coverage-slot');
  if (covSlot) {
    covSlot.innerHTML = renderFocusCoverageSection(focusCoverageCache);
  }
  const relSlot = panel.querySelector('.outlook-focus-release-slot');
  if (relSlot) {
    relSlot.innerHTML = renderFocusReleaseCalendarSection(focusReleaseCalCache);
  }
}

function ensureOutlookHeadlinesAndDashboard(panel, options = {}) {
  if (!panel?.querySelector('.outlook-panel')) return;
  const insts = window.__outlookCacheInstruments || [];
  if (insts.length && (!focusDashboardCache?.instruments?.length || focusDashboardCache?.localPreview)) {
    seedFocusDashboardFromOutlook(insts);
    paintOutlookHeadlinesAndDashboard(panel);
  }
  const needHeadlines =
    options.force === true ||
    !outlookHeadlinesCache ||
    (!outlookHeadlinesCache?.global?.items?.length && !outlookHeadlinesCache?.feed?.items?.length);
  const needDash =
    options.force === true ||
    !focusDashboardCache?.instruments?.length ||
    focusDashboardCache?.localPreview === true;

  if (needHeadlines) {
    void loadOutlookHeadlines({
      skipScan: options.skipScan !== true,
      enrichCursor: options.enrichCursor !== false,
      forceLiquidity: options.forceLiquidity === true || !outlookHeadlinesCache?.liquidityDaily?.text,
    }).then(() => paintOutlookHeadlinesAndDashboard(panel));
  } else {
    paintOutlookHeadlinesAndDashboard(panel);
  }

  if (needDash) {
    void loadFocusDashboard({ generate: false, force: options.force === true }).then((dash) => {
      if (!panel.isConnected) return;
      if (dash) {
        focusDashboardCache = dash;
        paintOutlookHeadlinesAndDashboard(panel);
        remountOutlookInstrumentList(panel, window.__outlookCacheInstruments, { immediate: true, skipSkeleton: true });
        startTop5DeepBriefLiveRefresh(panel, { force: false });
        startFocusAnalysisLiveRefresh(panel, { force: false });
      }
      if (options.generate !== false) {
        void loadFocusDashboard({ generate: true, force: false }).then((full) => {
          if (!panel.isConnected || !full) return;
          focusDashboardCache = full;
          paintOutlookHeadlinesAndDashboard(panel);
          startTop5DeepBriefLiveRefresh(panel, { force: false });
        });
      }
    });
  }

  void loadFocusCoverageAudit({ force: options.force === true }).then((audit) => {
    if (!panel.isConnected || !audit) return;
    focusCoverageCache = audit;
    const covSlot = panel.querySelector('.outlook-focus-coverage-slot');
    if (covSlot) covSlot.innerHTML = renderFocusCoverageSection(audit);
  });

  void loadFocusReleaseCalendar({ force: options.force === true }).then((cal) => {
    if (!panel.isConnected || !cal) return;
    focusReleaseCalCache = cal;
    const relSlot = panel.querySelector('.outlook-focus-release-slot');
    if (relSlot) relSlot.innerHTML = renderFocusReleaseCalendarSection(cal);
  });
}

function renderOutlookGlobalLiquidityStrip(source) {
  const gr = source?.globalLiquidityRisk || source?.globalRisk;
  if (!gr) {
    return `<div class="outlook-global-liquidity-strip outlook-global-liquidity-missing" role="status">
      <span class="outlook-gl-label">全球流动性</span>
      <span class="outlook-gl-tier">L? 待校验</span>
      <span class="outlook-gl-meta">regime 暂无</span>
    </div>`;
  }
  const tier = gr.tier || gr.liquidityShockTier || 'L0';
  const regime = gr.regime || gr.globalRiskRegime || 'normal';
  const heat = gr.narrativeHeat || {};
  const bubbleTalk = heat.bubbleTalk || 'cold';
  const heatCount = heat.mentionCount72h != null ? heat.mentionCount72h : gr.narrativeHeat;
  const heatN = heat.n != null ? ` n=${heat.n}` : gr.narrativeHeatN != null ? ` n=${gr.narrativeHeatN}` : '';
  const regimeCls = regime === 'shock' ? 'shock' : regime === 'tightening' ? 'tightening' : 'normal';
  const keyObs = (gr.observables || [])
    .filter((o) => o.status === 'green' || o.status === 'yellow' || o.status === 'red')
    .slice(0, 5);
  const obsChips = keyObs.length
    ? keyObs
        .map((o) => {
          const val =
            o.value != null
              ? typeof o.value === 'number'
                ? o.value
                : String(o.value).slice(0, 18)
              : '—';
          return `<span class="outlook-gl-obs-chip outlook-gl-status-${escapeAttr(o.status)}" title="${escapeAttr(o.label)} · ${escapeAttr(o.dataSource || '')}">${escapeHtml(o.label.split(' ')[0])} ${escapeHtml(String(val))}</span>`;
        })
        .join('')
    : `<span class="outlook-gl-obs-chip outlook-gl-status-null">observables 待校验</span>`;
  return `<div class="outlook-global-liquidity-strip outlook-global-liquidity-${regimeCls}" role="status" title="${escapeAttr(gr.summary || '')}">
    <span class="outlook-gl-label">全球流动性</span>
    <span class="outlook-gl-tier" data-tier="${escapeAttr(tier)}">${escapeHtml(tier)}</span>
    <span class="outlook-gl-regime" data-regime="${escapeAttr(regime)}">${escapeHtml(regime)}</span>
    <span class="outlook-gl-obs-chips">${obsChips}</span>
    <span class="outlook-gl-heat">叙事 ${escapeHtml(bubbleTalk)}${heatCount != null ? ` · ${escapeHtml(String(heatCount))}条/72h` : ''}${escapeHtml(heatN)}</span>
    <span class="outlook-gl-version">${escapeHtml(OUTLOOK_UI_VERSION)}</span>
  </div>`;
}

function renderOutlookIntegratedBadges(inst) {
  const spec = inst?.integratedSpec;
  if (!spec) return '';
  const regime = spec.regime?.regime || '—';
  const wl = spec.watchLevel || 'W0';
  const dl = spec.divergence?.level || 'D0';
  const pb = spec.playbook?.id ? `${spec.playbook.id}·${spec.playbook.stage || '—'}` : '—';
  const primaryPb = spec.primaryPlaybookBadge || spec.playbookDecisionTree?.badge;
  const primaryPbBadge = primaryPb
    ? `<span class="outlook-int-badge outlook-int-primary-playbook" title="${escapeAttr(spec.playbookDecisionTree?.logicChain?.map((c) => c.evidence).join(' · ') || '')}">${escapeHtml(primaryPb)}</span>`
    : '';
  const o2Badge = wl === 'O2' ? `<span class="outlook-int-badge outlook-int-o2" title="二次反弹·快钱 · 不恋战">O2</span>` : '';
  const slipBadge = spec.slippage?.flag
    ? `<span class="outlook-int-badge outlook-int-slippage" title="${escapeAttr((spec.slippage.evidence || []).join(' · '))}">${escapeHtml(spec.slippage.flag)}</span>`
    : '';
  const pricedIn = spec.expectationGap?.pricedInDegree?.degree;
  const pricedBadge = pricedIn && pricedIn !== 'unknown'
    ? `<span class="outlook-int-badge outlook-int-priced-in" title="priced-in ${escapeHtml(String(spec.expectationGap.pricedInDegree.score ?? '—'))}">π-${escapeHtml(pricedIn)}</span>`
    : '';
  const opp = spec.opponentStatus;
  const oppBadge = opp?.status === '待校验'
    ? `<span class="outlook-int-badge outlook-int-opponent-pending" title="OI 待校验">对手盘: 待校验</span>`
    : opp?.label && opp.status !== 'overridden'
      ? `<span class="outlook-int-badge outlook-int-opponent" title="${escapeAttr(opp.motto || '')}">${escapeHtml(opp.label)}</span>`
      : opp?.status === 'overridden'
        ? `<span class="outlook-int-badge outlook-int-opponent-override" title="PB-LIQ-CRISIS 覆盖">对手盘: L3覆盖</span>`
        : '';
  const overlayIds = spec.playbookDecisionTree?.overlayPlaybooks || [];
  const universalBadges = (spec.universalPlaybooks || [])
    .filter((p) => ['PB-OPP-001', 'PB-SQUEEZE', 'PB-LIQ-CRISIS'].includes(p.id))
    .map((p) => `<span class="outlook-int-badge outlook-int-universal-pb" title="${escapeAttr(p.narrativeZh || p.title || '')}">${escapeHtml(p.id)}·${escapeHtml(p.stage || '—')}</span>`)
    .join('');
  const overlayBadge = overlayIds.length && !universalBadges
    ? overlayIds.map((id) => `<span class="outlook-int-badge outlook-int-overlay-pb">${escapeHtml(id)}</span>`).join('')
    : universalBadges;
  const retail = spec.retailHf;
  const retailFollowBadge = retail?.badges?.followReady
    ? `<span class="outlook-int-badge outlook-int-retail-follow" title="机构/phase先动，个人W3才试仓">${escapeHtml(retail.badges.followReady)}</span>`
    : retail?.ruleViolations?.count
      ? `<span class="outlook-int-badge outlook-int-retail-violation" title="${escapeAttr((retail.ruleViolations.violations || []).map((v) => v.detail).join(' · '))}">规则偏离</span>`
      : '';
  const noCrowdBadge = retail?.badges?.noCrowd || (spec.retailHf?.factorExposure?.accidentalConcentration?.length ? '勿扎堆' : null);
  const noCrowdHtml = noCrowdBadge
    ? `<span class="outlook-int-badge outlook-int-retail-nocrowd" title="因子扎堆风险">${escapeHtml(typeof noCrowdBadge === 'string' ? noCrowdBadge : '勿扎堆')}</span>`
    : '';
  const eventDecayBadge = spec.eventDecay?.badge || retail?.badges?.eventDecay
    ? `<span class="outlook-int-badge outlook-int-event-decay" title="${escapeAttr((spec.eventDecay?.evidence || []).join(' · '))}">事件衰减</span>`
    : '';
  const trapBadge = spec.retailTrap?.badge
    ? `<span class="outlook-int-badge outlook-int-trap" title="trap=${escapeAttr(String(spec.retailTrap.score ?? '—'))} · ${escapeAttr((spec.retailTrap.components || []).map((c) => c.evidence).join(' · '))}">${escapeHtml(spec.retailTrap.badge)}</span>`
    : spec.retailTrap?.score != null && !spec.retailTrap.insufficientInputs
      ? `<span class="outlook-int-badge outlook-int-trap-mid" title="trap=${escapeHtml(String(spec.retailTrap.score))}">trap ${escapeHtml(String(spec.retailTrap.score))}</span>`
      : '';
  return `<span class="outlook-int-badge outlook-int-regime-${escapeAttr(regime)}" title="${escapeAttr((spec.regime?.reasons || []).join(' · '))}">R${escapeHtml(regime)}</span>
    <span class="outlook-int-badge outlook-int-watch${wl === 'O2' ? ' outlook-int-watch-o2' : ''}" title="关注级别">${escapeHtml(wl)}</span>
    ${o2Badge}
    <span class="outlook-int-badge outlook-int-div-${escapeAttr(dl)}" title="${escapeAttr((spec.divergence?.evidence || []).join(' · '))}">${escapeHtml(dl)}</span>
    <span class="outlook-int-badge outlook-int-playbook" title="${escapeAttr(spec.playbook?.narrativeZh || '')}">${escapeHtml(pb)}</span>
    ${primaryPbBadge}
    ${oppBadge}${overlayBadge}
    ${retailFollowBadge}${noCrowdHtml}${eventDecayBadge}${trapBadge}
    ${slipBadge}${pricedBadge}`;
}

function renderOutlookMasterClockStrip(brief) {
  const clock = brief?.masterClock;
  if (!clock?.summaryThreeLines?.length) return '';
  const lines = clock.summaryThreeLines.map((l) => `<span class="outlook-clock-line">${escapeHtml(l)}</span>`).join('');
  const conflict = clock.conflict ? ' outlook-master-clock-conflict' : '';
  return `<div class="outlook-master-clock-strip${conflict}" role="status" aria-label="宏观主时钟">
    <span class="outlook-master-clock-label">主时钟</span>${lines}
  </div>`;
}

function snapshotOutlookWatchLevels(instruments = []) {
  const snap = {};
  for (const inst of instruments || []) {
    const id = String(inst.id).toLowerCase();
    snap[id] = {
      w: inst.integratedSpec?.watchLevel || 'W0',
      d: inst.integratedSpec?.divergence?.level || 'D0',
    };
  }
  return snap;
}

function outlookWatchLevelsChanged(prev, next) {
  if (!prev || !next) return true;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const p = prev[k] || {};
    const n = next[k] || {};
    const alertLevels = new Set(['W2', 'O2', 'D2', 'D3']);
    if (p.w !== n.w && (alertLevels.has(p.w) || alertLevels.has(n.w))) return true;
    if (p.d !== n.d && (alertLevels.has(p.d) || alertLevels.has(n.d))) return true;
  }
  return false;
}

function renderOutlookDivergenceBanner(inst) {
  const div = inst?.integratedSpec?.divergence;
  if (!div?.holderAlert) return '';
  const held = (window.__portfolioHoldings || []).includes(String(inst.id).toLowerCase());
  if (!held) return '';
  return `<div class="outlook-divergence-alert" role="alert">
    <strong>持有者告警</strong> · ${escapeHtml(div.level)} ${escapeHtml(div.label)} — 优先减仓/退潮 · ${escapeHtml((div.evidence || []).slice(0, 2).join(' · '))}
  </div>`;
}

function renderOutlookHoldingsEditor(instruments = [], coreTactical = null) {
  const held = window.__portfolioHoldings || [];
  const ctMap = new Map((coreTactical?.slots || []).map((s) => [String(s.symbol || '').toLowerCase(), s]));
  const slots = [0, 1, 2].map((idx) => {
    const val = held[idx] || '';
    const ct = val ? ctMap.get(String(val).toLowerCase()) : null;
    const slotLabel = ct?.slotLabel ? `<span class="outlook-slot-type-label">${escapeHtml(ct.slotLabel)}</span>` : '';
    const opts = (instruments || [])
      .map((i) => {
        const selected = String(i.id).toLowerCase() === String(val).toLowerCase() ? ' selected' : '';
        return `<option value="${escapeAttr(i.id)}"${selected}>${escapeHtml(i.name || i.id)}</option>`;
      })
      .join('');
    return `<label class="outlook-holdings-slot">槽${idx + 1}${slotLabel}
      <select class="outlook-holdings-select" data-holdings-slot="${idx}" data-action="portfolio-holdings-slot">
        <option value="">— 空 —</option>
        ${opts}
      </select>
    </label>`;
  }).join('');
  return `<div class="outlook-holdings-editor">
    <span class="outlook-holdings-label">持仓编辑（最多3槽）</span>
    ${slots}
    <button type="button" class="btn-link" data-action="save-portfolio-holdings">保存持仓</button>
  </div>`;
}

function renderOutlookPainMemoryEditor() {
  return `<details class="outlook-pain-memory-editor">
    <summary>痛苦记忆 · 个人 playbook</summary>
    <form class="outlook-pain-memory-form" data-action="pain-memory-form">
      <label>品种 <input type="text" name="symbol" placeholder="cu" required /></label>
      <label>教训 <input type="text" name="lesson" placeholder="拥挤时追多被派发…" required /></label>
      <label>标签 <input type="text" name="tags" placeholder="D2,overshoot,O2" /></label>
      <button type="submit" class="btn-link">保存</button>
    </form>
    <ul class="outlook-pain-memory-list" data-pain-list></ul>
  </details>`;
}

function renderOutlookNoTradeBanner(noTradeDay) {
  if (!noTradeDay?.noTradeDay) return '';
  const reasons = (noTradeDay.reasons || []).map((r) => r.text).join(' · ');
  const teaching = (noTradeDay.teachingLines || [])
    .slice(0, 5)
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join('');
  return `<div class="outlook-no-trade-banner" role="status">
    <p class="outlook-no-trade-top">${escapeHtml(noTradeDay.topLine || '今日系统建议：不新开仓（follow 模式）')}</p>
    ${reasons ? `<p class="outlook-no-trade-reasons">${escapeHtml(reasons)}</p>` : ''}
    ${teaching ? `<details class="outlook-no-trade-teaching"><summary>Top5 为何不 scout</summary><ul>${teaching}</ul></details>` : ''}
  </div>`;
}

function renderOutlookDisciplineOnePagerSections(brief) {
  const ms = brief?.marginStress;
  const hg = brief?.holidayGap || brief?.threeAnswers?.holidayGap;
  if (!ms && (!hg || hg.riskLevel === 'none')) return '';
  const stressRows = (ms?.perSymbol || [])
    .map((r) => {
      const cur = r.currentMarginYuan != null ? `${Math.round(r.currentMarginYuan / 1000)}k` : '待校验';
      const st = r.stressedMarginYuan != null ? `${Math.round(r.stressedMarginYuan / 1000)}k` : '待校验';
      const lvl = r.level || r.status || '—';
      return `<tr><td>${escapeHtml(String(r.symbol).toUpperCase())}</td><td>${escapeHtml(String(r.lots ?? 1))}</td><td>${escapeHtml(cur)}</td><td>${escapeHtml(st)}</td><td class="outlook-margin-level-${escapeAttr(lvl)}">${escapeHtml(lvl)}</td></tr>`;
    })
    .join('');
  const port = ms?.portfolio;
  const portLine =
    port?.status === 'verified'
      ? `组合 stressed ${port.stressedMarginYuan != null ? Math.round(port.stressedMarginYuan / 1000) + 'k' : '—'} · +${port.marginBumpPct}% 保证金率`
      : '组合保证金 待校验';
  const hgLine =
    hg?.upcoming && hg.riskLevel !== 'none'
      ? `<p class="outlook-holiday-gap-warn outlook-holiday-gap-${escapeAttr(hg.riskLevel)}">假期缺口 · ${escapeHtml(hg.briefLine || '—')}</p>`
      : `<p class="outlook-holiday-gap-ok">${escapeHtml(hg?.briefLine || '10 日内无重大假期缺口')}</p>`;
  return `<div class="outlook-discipline-sections">
    <h4>保证金压力测试</h4>
    <table class="outlook-margin-stress-table"><thead><tr><th>品种</th><th>手数</th><th>当前</th><th>+2% stressed</th><th>级别</th></tr></thead>
    <tbody>${stressRows || '<tr><td colspan="5">暂无持仓 · 保存持仓后显示</td></tr>'}</tbody></table>
    <p class="outlook-margin-portfolio">${escapeHtml(portLine)}</p>
    <h4>假期缺口</h4>
    ${hgLine}
  </div>`;
}

function resolveOutlookBacktestSummaryLine(brief, source) {
  if (brief?.backtestSummaryLine) return brief.backtestSummaryLine;
  const stats = source?.stats || window.__outlookCacheStats;
  const summary = outlookBacktestSummaryCache;
  const rate30 = stats?.backtestHitRate30d ?? summary?.overallHitRate30d;
  const rate60 = stats?.backtestHitRate60d ?? summary?.overallHitRate60d;
  if (rate30 == null && rate60 == null) return '待运行回测';
  const p30 = fmtHitWithSample(rate30, stats?.backtestHits30d ?? summary?.hits30d, stats?.backtestTotal30d ?? summary?.total30d);
  const p60 = fmtHitWithSample(rate60, stats?.backtestHits60d ?? summary?.hits60d, stats?.backtestTotal60d ?? summary?.total60d);
  if (p30 === '—' && p60 === '—') return '待运行回测';
  return `walk-forward 回测 · 30d ${p30 === '—' ? '暂无' : p30} · 60d ${p60 === '—' ? '暂无' : p60}`;
}

function findOutlookInstBySymbol(symbol, instruments) {
  if (!symbol) return null;
  const sym = String(symbol).toLowerCase();
  return (instruments || []).find((i) => String(i.id).toLowerCase() === sym) || null;
}

function mapOutlookPostureDisplay(posture) {
  const map = { 观望: '观望', 试仓: '轻仓', 持有: '标准', 加仓: '重仓' };
  if (!posture || posture === '暂无') return '—';
  return map[posture] || posture;
}

function buildOutlookSlotWhyLine(inst, top5Entry) {
  if (!inst && top5Entry) {
    const pb = top5Entry.playbookMatch?.id;
    return `Top${top5Entry.rank} · R${top5Entry.regime || '—'} · ${top5Entry.posture || '—'}${pb ? ` · ${pb}` : ''}${top5Entry.priorityScore != null ? ` · score ${top5Entry.priorityScore}` : ''}`;
  }
  if (!inst) return null;
  const spec = inst.integratedSpec;
  const parts = [];
  const regime = spec?.regime?.regime;
  if (regime) parts.push(`R${regime}${spec.regime.label ? ` · ${spec.regime.label}` : ''}`);
  const pb = spec?.playbook?.id;
  if (pb) parts.push(`${pb}${spec.playbook.stage ? `·${spec.playbook.stage}` : ''}`);
  if (spec?.priorityScore != null) parts.push(`池 score ${spec.priorityScore}`);
  if (top5Entry?.rank) parts.push(`Top${top5Entry.rank}`);
  const treeBadge = spec?.playbookDecisionTree?.badge;
  if (treeBadge && !pb) parts.push(String(treeBadge).split('·')[0].trim());
  return parts.length ? parts.join(' · ') : null;
}

function buildOutlookSlotPostureRationale(inst, gate) {
  const tg = inst?.tradingGuidance;
  const spec = inst?.integratedSpec;
  const held = (gate?.holdings || window.__portfolioHoldings || []).map((h) => String(h).toLowerCase());
  const sym = String(inst?.id || '').toLowerCase();
  const parts = [];
  if (tg?.phase && tg.phase !== '暂无') parts.push(`phase·${tg.phase}`);
  if (tg?.bias && tg.bias !== '暂无') parts.push(tg.bias);
  const regimeReason = spec?.regime?.reasons?.[0];
  if (regimeReason) parts.push(String(regimeReason).slice(0, 48));
  const treeEv = spec?.playbookDecisionTree?.logicChain?.find((c) => c.evidence)?.evidence;
  if (treeEv) parts.push(String(treeEv).slice(0, 48));
  else if (spec?.playbook?.narrativeZh) parts.push(String(spec.playbook.narrativeZh).slice(0, 48));
  if (gate?.capNewScout && sym && !held.includes(sym)) {
    parts.push(gate.capReason || '组合门禁限制新开');
  }
  return parts.length ? parts.join(' · ') : '姿态依据待校验';
}

function buildOutlookSlotFlagsHtml(inst) {
  const spec = inst?.integratedSpec;
  if (!spec) return '';
  const flags = [];
  const trap = spec.retailTrap;
  if (trap?.highTrap) {
    flags.push({ cls: 'outlook-slot-flag-trap', text: `派发区 · trap ${trap.score ?? '—'}` });
  } else if (trap?.score != null && !trap.insufficientInputs && trap.score >= 50) {
    flags.push({ cls: 'outlook-slot-flag-trap-mid', text: `trap ${trap.score}` });
  }
  const pain =
    spec.painMemory?.fusionLine ||
    (spec.painMemory?.matches?.length ? spec.painMemory.matches[0].lesson : null);
  if (pain) flags.push({ cls: 'outlook-slot-flag-pain', text: `痛苦记忆 · ${String(pain).slice(0, 36)}` });
  const opp = spec.opponentStatus;
  if (opp?.noChase) {
    flags.push({ cls: 'outlook-slot-flag-distribution', text: `派发区 · ${opp.label || '禁追'}` });
  }
  const retail = spec.retailHf;
  if (retail?.badges?.followReady) {
    flags.push({ cls: 'outlook-slot-flag-follow', text: retail.badges.followReady });
  }
  if (spec.divergence?.holderAlert) {
    flags.push({ cls: 'outlook-slot-flag-div', text: `${spec.divergence.level} 持有者告警` });
  }
  if (!flags.length) return '';
  return `<div class="outlook-slot-flags">${flags
    .map((f) => `<span class="outlook-slot-flag ${f.cls}">${escapeHtml(f.text)}</span>`)
    .join('')}</div>`;
}

function buildOutlookSlotBacktestLine(inst) {
  const hit30 = inst?.backtestHitRate30d;
  const n = inst?.backtestTotal30d;
  const hits = inst?.backtestHits30d;
  if (hit30 == null) {
    return '<span class="outlook-slot-backtest outlook-slot-backtest-missing">回测置信 待运行</span>';
  }
  return `<span class="outlook-slot-backtest">回测 30d ${escapeHtml(fmtHitWithSample(hit30, hits, n))}</span>`;
}

function buildOutlookEmptySlotReason(slotIndex, gate, brief) {
  const noTrade = brief?.noTradeDay;
  if (noTrade?.noTradeDay) return noTrade.topLine || '今日 follow 模式 · 系统建议不新开仓';
  if (gate?.slotsFree <= 0) return '三槽已满 · 腾槽后方可新开';
  if (gate?.capNewScout) return gate.capReason || '组合门禁 · 新开试仓受限';
  if (gate?.clusterGate?.capNewScout) {
    return gate.clusterGate.capReason || '相关性簇门禁 · 不宜加第三同类槽';
  }
  const used = gate?.slotsUsed ?? 0;
  const sugIdx = slotIndex - 1 - used;
  const suggestions = gate?.suggestions || [];
  const sug = sugIdx >= 0 ? suggestions[sugIdx] : suggestions[0];
  if (sug) {
    return `空槽 · 研究池可考虑 ${sug.name || sug.symbol}（R${sug.regime || '—'} · score ${sug.priorityScore ?? '—'}）`;
  }
  return '空槽 · 尚无 scout 放行品种或 research pool 待校验';
}

function renderOutlookSlotsNarrative(brief, gate, gr) {
  const clock = brief?.masterClock;
  const regimeLine =
    clock?.summaryThreeLines?.slice(0, 2).join(' · ') ||
    (brief?.threeAnswers?.happened ? String(brief.threeAnswers.happened).slice(0, 120) : null) ||
    (gr ? `全球 ${gr.tier || 'L?'} · regime ${gr.regime || 'normal'}` : null) ||
    '宏观 regime 待校验';
  const maxPos = gate?.maxPositions || 3;
  const slotsFree = gate?.slotsFree ?? Math.max(0, maxPos - (gate?.slotsUsed ?? 0));
  const limitWhy = gate?.capReason
    ? gate.capReason
    : '个人 3 仓纪律 · 核心≤2 + 快钱≤1 · 因子对冲度≥30%';
  const followLine =
    brief?.followAdvice || brief?.factorLine || brief?.threeAnswers?.factorLine || '机构跟随 待校验';
  const noTrade = brief?.noTradeDay?.noTradeDay;
  const openLine = noTrade
    ? '今日可开仓 0 · no-trade day'
    : `今日可开仓 ${slotsFree}/${maxPos}${gate?.capNewScout && slotsFree > 0 ? '（门禁收紧）' : ''}`;
  return `<div class="outlook-slots-narrative" role="status">
    <p class="outlook-slots-narrative-regime"><strong>当前环境</strong> ${escapeHtml(regimeLine)}</p>
    <p class="outlook-slots-narrative-open"><strong>${escapeHtml(openLine)}</strong> · ${escapeHtml(limitWhy)}</p>
    <p class="outlook-slots-narrative-follow"><strong>机构跟随</strong> ${escapeHtml(followLine)}</p>
  </div>`;
}

function formatOutlookLlmNarrativeParagraphs(text) {
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function renderOutlookSanDaSection(brief) {
  const ta = brief.threeAnswers || {};
  const ruleGrid = `<div class="outlook-san-da-rule-grid">
      <div class="outlook-san-da-item"><span class="outlook-san-da-q">发生了什么</span><p>${escapeHtml(ta.happened || '暂无')}</p></div>
      <div class="outlook-san-da-item"><span class="outlook-san-da-q">怎么了</span><p>${escapeHtml(ta.soWhat || '暂无')}</p></div>
      <div class="outlook-san-da-item"><span class="outlook-san-da-q">为什么</span><p>${escapeHtml(ta.why || '暂无')}</p></div>
    </div>`;

  if (brief.llmNarrative) {
    const badgeClass =
      brief.llmMethod === 'llm-augmented' ? 'outlook-san-da-badge-llm' : 'outlook-san-da-badge-rule';
    const badgeText = brief.llmMethod === 'llm-augmented' ? 'llm-augmented' : brief.llmMethod || 'structured-synthesis';
    return `<div class="outlook-san-da outlook-san-da-llm">
      <header class="outlook-san-da-header">
        <h4 class="outlook-san-da-title">晨间三答</h4>
        <span class="outlook-san-da-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
      </header>
      <div class="outlook-san-da-narrative">${formatOutlookLlmNarrativeParagraphs(brief.llmNarrative)}</div>
      <details class="outlook-san-da-rule-draft">
        <summary>规则三答底稿</summary>
        ${ruleGrid}
      </details>
    </div>`;
  }

  return `<div class="outlook-san-da">
    <header class="outlook-san-da-header">
      <h4 class="outlook-san-da-title">晨间三答</h4>
      <span class="outlook-san-da-badge outlook-san-da-badge-rule">structured-synthesis</span>
    </header>
    ${ruleGrid}
  </div>`;
}

function renderOutlookSlotDecisionBriefCard() {
  return `<div class="outlook-slot-decision-brief" data-slot-decision-brief aria-live="polite">
    <header class="outlook-slot-decision-brief-header">
      <h4 class="outlook-slot-decision-brief-title">今日三槽解读</h4>
      <span class="outlook-slot-decision-brief-badge" data-slot-brief-method>加载中…</span>
    </header>
    <p class="outlook-slot-decision-brief-body" data-slot-brief-narrative>解读生成中…</p>
    <details class="outlook-slot-decision-brief-cites hidden" data-slot-brief-cites>
      <summary>引用来源</summary>
      <ul class="outlook-slot-decision-brief-cite-list" data-slot-brief-cite-list></ul>
    </details>
  </div>`;
}

function renderOutlookSlotDecisionBriefContent(result) {
  if (!result || result.error) {
    return {
      narrative: result?.error || '三槽解读暂无',
      badge: '—',
      badgeClass: 'outlook-slot-brief-method-missing',
      citations: [],
      ruleBasedNarrative: null,
      method: null,
    };
  }
  const method = result.method === 'llm-augmented' ? 'llm-augmented' : 'structured-synthesis';
  return {
    narrative: result.narrative || '暂无',
    badge: method === 'llm-augmented' ? 'llm-augmented' : 'structured-synthesis',
    badgeClass: method === 'llm-augmented' ? 'outlook-slot-brief-method-llm' : 'outlook-slot-brief-method-rule',
    citations: result.citations || [],
    ruleBasedNarrative: result.ruleBasedNarrative || null,
    method,
  };
}

function applyOutlookSlotDecisionBriefDom(container, result) {
  if (!container) return;
  const content = renderOutlookSlotDecisionBriefContent(result);
  const narrativeEl = container.querySelector('[data-slot-brief-narrative]');
  const badgeEl = container.querySelector('[data-slot-brief-method]');
  const citesEl = container.querySelector('[data-slot-brief-cites]');
  const citeList = container.querySelector('[data-slot-brief-cite-list]');
  const existingRule = container.querySelector('.outlook-slot-decision-brief-rule');
  if (existingRule) existingRule.remove();

  if (narrativeEl) narrativeEl.textContent = content.narrative;
  if (badgeEl) {
    badgeEl.textContent = content.badge;
    badgeEl.className = `outlook-slot-decision-brief-badge ${content.badgeClass}`;
  }
  if (citeList && citesEl) {
    if (content.citations.length) {
      citeList.innerHTML = content.citations
        .map(
          (c) =>
            `<li><code>${escapeHtml(c.field || '—')}</code> · ${escapeHtml(String(c.value ?? '—'))} <small>${escapeHtml(c.source || '')}</small></li>`
        )
        .join('');
      citesEl.classList.remove('hidden');
    } else {
      citeList.innerHTML = '';
      citesEl.classList.add('hidden');
    }
  }
  if (content.ruleBasedNarrative && content.method === 'llm-augmented') {
    container.insertAdjacentHTML(
      'beforeend',
      `<details class="outlook-slot-decision-brief-rule"><summary>规则底稿</summary><p>${escapeHtml(content.ruleBasedNarrative)}</p></details>`
    );
  }
}

async function hydrateOutlookSlotDecisionBrief(panel, { force = false } = {}) {
  const container = panel?.querySelector('[data-slot-decision-brief]');
  if (!container || !window.fancheng?.getSlotDecisionBrief) return;
  const now = Date.now();
  if (
    !force &&
    window.__outlookSlotDecisionBrief &&
    now - (window.__outlookSlotDecisionBriefAt || 0) < OUTLOOK_DAILY_BRIEF_CACHE_MS
  ) {
    applyOutlookSlotDecisionBriefDom(container, window.__outlookSlotDecisionBrief);
    return;
  }
  const narrativeEl = container.querySelector('[data-slot-brief-narrative]');
  const badgeEl = container.querySelector('[data-slot-brief-method]');
  if (narrativeEl) narrativeEl.textContent = '解读生成中…';
  if (badgeEl) {
    badgeEl.textContent = '加载中…';
    badgeEl.className = 'outlook-slot-decision-brief-badge';
  }
  const result = await window.fancheng.getSlotDecisionBrief({ force });
  if (result && !result.error) {
    window.__outlookSlotDecisionBrief = result;
    window.__outlookSlotDecisionBriefAt = now;
  }
  applyOutlookSlotDecisionBriefDom(container, result);
}

function renderOutlookGateSlotCard(slot, ctx) {
  const { instruments, gate, brief, top5Map } = ctx;
  const sym = slot.symbol;
  const inst = findOutlookInstBySymbol(sym, instruments);
  const top5Entry = sym ? top5Map.get(String(sym).toLowerCase()) : null;
  const typeLabel = slot.slotLabel || (slot.slotType === 'core' ? '核心' : slot.slotType === 'tactical' ? '快钱' : '');

  if (!sym) {
    const reason = buildOutlookEmptySlotReason(slot.slot, gate, brief);
    return `<article class="outlook-gate-slot outlook-gate-slot-empty">
      <header><span class="outlook-gate-slot-num">槽 ${slot.slot}</span>${typeLabel ? `<span class="outlook-gate-slot-type">${escapeHtml(typeLabel)}</span>` : ''}</header>
      <p class="outlook-gate-slot-name">— 空 —</p>
      <p class="outlook-gate-slot-empty-reason">${escapeHtml(reason)}</p>
    </article>`;
  }

  const postureRaw = slot.posture || inst?.tradingGuidance?.posture || '暂无';
  const postureDisplay = mapOutlookPostureDisplay(postureRaw);
  const whyLine = buildOutlookSlotWhyLine(inst, top5Entry) || '待校验';
  const rationale = buildOutlookSlotPostureRationale(inst, gate);

  return `<article class="outlook-gate-slot outlook-gate-slot-filled" data-slot-symbol="${escapeAttr(sym)}">
    <header>
      <span class="outlook-gate-slot-num">槽 ${slot.slot}</span>
      ${typeLabel ? `<span class="outlook-gate-slot-type">${escapeHtml(typeLabel)}</span>` : ''}
      ${slot.watchLevel ? `<span class="outlook-gate-slot-wl">${escapeHtml(slot.watchLevel)}</span>` : ''}
    </header>
    <p class="outlook-gate-slot-name">${escapeHtml(slot.name || sym.toUpperCase())}</p>
    <p class="outlook-gate-slot-posture-row"><strong>${escapeHtml(postureDisplay)}</strong>${postureRaw !== postureDisplay && postureRaw !== '暂无' ? ` <span class="outlook-gate-slot-posture-raw">(${escapeHtml(postureRaw)})</span>` : ''}</p>
    <p class="outlook-gate-slot-rationale">${escapeHtml(rationale)}</p>
    <p class="outlook-gate-slot-why"><span class="outlook-gate-slot-why-label">为何此品</span> ${escapeHtml(whyLine)}</p>
    ${buildOutlookSlotBacktestLine(inst)}
    ${buildOutlookSlotFlagsHtml(inst)}
    ${slot.holdWarn ? `<p class="outlook-gate-slot-hold-warn">${escapeHtml(slot.holdWarn)}</p>` : ''}
  </article>`;
}

function renderOutlookDecisionOnePager(source) {
  const brief = source?.dailyBrief || window.__outlookCacheDailyBrief;
  const gr = source?.globalLiquidityRisk || source?.globalRisk;
  const instruments = source?.instruments || window.__outlookCacheInstruments || [];
  if (!brief?.threeAnswers) {
    return `<section class="outlook-decision-one-pager outlook-decision-one-pager-loading">
      <h3 class="outlook-one-pager-title">决策 One-Pager · Daily Brief</h3>
      <div class="outlook-san-da outlook-san-da-loading">
        <p class="outlook-san-da-loading-text">晨间简报生成中…</p>
      </div>
    </section>`;
  }
  const ta = brief.threeAnswers;
  const poolRows = (brief.researchPool || [])
    .map((r) => {
      const sym = r.symbol || r.id || '';
      const label = r.name || sym;
      return `<tr class="outlook-pool-row" data-action="select-outlook-from-pool" data-instrument="${escapeAttr(sym)}" tabindex="0" role="button" title="点击查看 ${escapeAttr(label)} AI 研判">
        <td>${escapeHtml(label)}</td><td>${escapeHtml(r.regime)}</td><td>${escapeHtml(r.watchLevel)}</td><td>${escapeHtml(r.divergenceLevel)}</td><td>${escapeHtml(r.playbook)}${r.playbookStage !== '—' ? `·${escapeHtml(r.playbookStage)}` : ''}</td><td>${r.priorityScore != null ? escapeHtml(String(r.priorityScore)) : '—'}</td>
      </tr>`;
    })
    .join('');
  const top5Rows = (brief.top5 || [])
    .map(
      (t) =>
        `<li><strong>${t.rank}. ${escapeHtml(t.name)}</strong> · score ${t.priorityScore != null ? escapeHtml(String(t.priorityScore)) : '—'} · R${escapeHtml(t.regime)} · ${escapeHtml(t.posture)}${t.playbookMatch?.id ? ` · ${escapeHtml(t.playbookMatch.id)}` : ''}</li>`
    )
    .join('');
  const gate = brief.portfolioGate || {};
  const coreTactical = brief.coreTactical || gate.coreTactical;
  const ctWarn = coreTactical?.briefLine
    ? `<p class="outlook-core-tactical-warn">${escapeHtml(coreTactical.briefLine)}</p>`
    : '';
  const top5Map = new Map(
    (brief.top5 || []).map((t) => [String(t.symbol || t.id || '').toLowerCase(), t])
  );
  const slotSource = coreTactical?.slots?.length ? coreTactical.slots : gate.slotAdvice || [];
  const slotCtx = { instruments, gate, brief, top5Map };
  const slotCards = slotSource.map((s) => renderOutlookGateSlotCard(s, slotCtx)).join('');
  const painLine = brief.painFusionLine
    ? `<p class="outlook-pain-fusion-line">${escapeHtml(brief.painFusionLine)}</p>`
    : '';
  const dissent = (brief.counterThesis?.dissent || []).map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  const cachedTag = brief.cached ? ' · 缓存' : '';
  const clusterWarn = brief.clusterWarning
    ? `<p class="outlook-gate-cluster-warn">⚠ ${escapeHtml(brief.clusterWarning)}</p>`
    : '';
  const behaviorWarn = brief.behaviorPatterns?.patternWarning
    ? `<p class="outlook-behavior-warn">${escapeHtml(brief.behaviorPatterns.patternWarning)}</p>`
    : '';
  const factorLine = brief.factorLine || brief.threeAnswers?.factorLine
    ? `<p class="outlook-retail-factor-line">${escapeHtml(brief.factorLine || brief.threeAnswers.factorLine)}</p>`
    : '';
  const carryLine = brief.carryLine || brief.threeAnswers?.carryLine
    ? `<p class="outlook-retail-carry-line">${escapeHtml(brief.carryLine || brief.threeAnswers.carryLine)}</p>`
    : '';
  const redTeam = brief.redTeamWeekly;
  const redTeamBlock = redTeam?.sections?.length
    ? `<details class="outlook-red-team-weekly">
      <summary>红队周报 · ${escapeHtml(redTeam.weekKey || '')}</summary>
      ${redTeam.sections.map((s) => `<h5>${escapeHtml(s.title)}</h5><ul>${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`).join('')}
    </details>`
    : '';
  const backtestLine = resolveOutlookBacktestSummaryLine(brief, source);
  return `<section class="outlook-decision-one-pager" aria-label="决策 One-Pager">
    <h3 class="outlook-one-pager-title">决策 One-Pager · Daily Brief <span class="outlook-one-pager-ver">${escapeHtml(brief.version || OUTLOOK_UI_VERSION)}${escapeHtml(cachedTag)}</span></h3>
    <p class="outlook-backtest-summary-line">${escapeHtml(backtestLine)}</p>
    ${renderOutlookNoTradeBanner(brief.noTradeDay)}
    ${renderOutlookMasterClockStrip(brief)}
    ${factorLine}${carryLine}${painLine}
    ${renderOutlookSanDaSection(brief)}
    <div class="outlook-one-pager-grid">
      <div class="outlook-one-pager-col">
        <h4>研究池</h4>
        <table class="outlook-pool-table"><thead><tr><th>品种</th><th>Regime</th><th>W</th><th>D</th><th>Playbook</th><th>Score</th></tr></thead>
        <tbody>${poolRows || '<tr><td colspan="6">暂无</td></tr>'}</tbody></table>
      </div>
      <div class="outlook-one-pager-col outlook-one-pager-col-slots">
        <h4>三槽决策 · 组合门禁 ${gate.slotsUsed != null ? `(${gate.slotsUsed}/${gate.maxPositions || 3})` : ''} · 核心≤2 / 快钱≤1</h4>
        ${renderOutlookSlotsNarrative(brief, gate, gr)}
        ${renderOutlookSlotDecisionBriefCard()}
        <div class="outlook-gate-slots outlook-gate-slots-rich">${slotCards}</div>
        ${ctWarn}
        ${gate.capNewScout ? `<p class="outlook-gate-cap-warn">${escapeHtml(gate.capReason || '新开试仓受限')}</p>` : ''}
        ${clusterWarn}
        ${behaviorWarn}
        ${renderOutlookHoldingsEditor(instruments, coreTactical)}
        <h4 class="outlook-top5-subhead">Top 5 多 regime 优先（研究池参考）</h4>
        <ol class="outlook-top5-list">${top5Rows || '<li>暂无</li>'}</ol>
        ${renderOutlookDisciplineOnePagerSections(brief)}
        ${renderOutlookPainMemoryEditor()}
      </div>
    </div>
    <details class="outlook-counter-thesis-block">
      <summary>反证 / Counter-thesis（必选）</summary>
      <ul class="outlook-counter-thesis-list">${dissent || '<li>暂无</li>'}</ul>
      <p class="outlook-counter-thesis-summary">${escapeHtml(brief.counterThesis?.summary || '—')}</p>
    </details>
    <p class="outlook-one-pager-meta">${escapeHtml(brief.method || '')} · ${escapeHtml(brief.asOf ? formatDate(brief.asOf) : '')} · 全球 ${escapeHtml(gr?.tier || 'L?')}</p>
    ${redTeamBlock}
  </section>`;
}

async function loadPainMemoryList(panel) {
  const listEl = panel?.querySelector('[data-pain-list]');
  if (!listEl || !window.fancheng?.listPainEntries) return;
  const data = await window.fancheng.listPainEntries(20);
  const entries = data?.entries || [];
  listEl.innerHTML = entries.length
    ? entries.map((e) => `<li>${escapeHtml(String(e.symbol).toUpperCase())} · ${escapeHtml(e.lesson || '')} <small>${escapeHtml((e.tags || []).join(','))}</small></li>`).join('')
    : '<li>暂无 · 添加您的教训以匹配当前 context</li>';
}

async function ensureOutlookDailyBrief(source, { force = false } = {}) {
  const now = Date.now();
  if (!force && window.__outlookCacheDailyBrief && now - (window.__outlookDailyBriefAt || 0) < OUTLOOK_DAILY_BRIEF_CACHE_MS) {
    return window.__outlookCacheDailyBrief;
  }
  if (source?.dailyBrief?.threeAnswers) {
    window.__outlookCacheDailyBrief = source.dailyBrief;
    window.__outlookDailyBriefAt = now;
    return source.dailyBrief;
  }
  if (window.fancheng?.getDailyBrief) {
    const brief = await window.fancheng.getDailyBrief();
    if (brief && !brief.error) {
      window.__outlookCacheDailyBrief = brief;
      window.__outlookDailyBriefAt = now;
      return brief;
    }
  }
  return window.__outlookCacheDailyBrief || null;
}

async function loadPortfolioHoldingsFromStore() {
  if (!window.fancheng?.getPortfolioHoldings) return;
  const data = await window.fancheng.getPortfolioHoldings();
  if (data?.holdings) window.__portfolioHoldings = data.holdings;
}

async function savePortfolioHoldingsFromUi(panel) {
  const selects = panel?.querySelectorAll('.outlook-holdings-select') || [];
  const holdings = [];
  selects.forEach((sel) => {
    const v = sel.value?.trim();
    if (v && !holdings.includes(v)) holdings.push(v);
  });
  if (window.fancheng?.setPortfolioHoldings) {
    const result = await window.fancheng.setPortfolioHoldings(holdings);
    if (result?.holdings) window.__portfolioHoldings = result.holdings;
    window.__outlookDailyBriefAt = 0;
    window.__outlookSlotDecisionBriefAt = 0;
    void refreshOutlookLive({ force: false });
  }
}

function ensurePreMortemModal(panel) {
  let modal = panel?.querySelector('.outlook-pre-mortem-modal');
  if (modal || !panel) return modal;
  modal = document.createElement('div');
  modal.className = 'outlook-pre-mortem-modal outlook-backtest-modal outlook-history-modal hidden';
  modal.innerHTML = `<div class="outlook-history-dialog outlook-backtest-dialog" role="dialog" aria-labelledby="pre-mortem-title">
    <header><h4 id="pre-mortem-title">事前验尸 · 试仓前必读</h4><button type="button" class="outlook-history-close" data-action="close-pre-mortem">×</button></header>
    <div class="outlook-pre-mortem-body"></div>
    <footer class="outlook-pre-mortem-footer">
      <label class="outlook-pre-mortem-ack-label"><input type="checkbox" class="outlook-pre-mortem-checkbox" /> 我已阅读上述失败路径</label>
      <button type="button" class="btn-primary outlook-pre-mortem-confirm" data-action="confirm-pre-mortem" disabled>确认并继续</button>
    </footer>
  </div>`;
  panel.appendChild(modal);
  return modal;
}

async function openPreMortemModal(panel, instId, { postureIntent = '试仓', onConfirm = null } = {}) {
  if (!window.fancheng?.getPreMortem) return { ok: false, error: 'IPC 不可用' };
  const pm = await window.fancheng.getPreMortem(instId, postureIntent);
  if (pm?.error) return { ok: false, error: pm.error };
  const ackCheck = window.fancheng.checkPreMortemAck
    ? await window.fancheng.checkPreMortemAck(pm.signalId)
    : { acknowledged: false };
  if (ackCheck?.acknowledged) {
    return { ok: true, alreadyAcked: true, preMortem: pm };
  }
  const modal = ensurePreMortemModal(panel);
  if (!modal) return { ok: false, error: 'modal 不可用' };
  const body = modal.querySelector('.outlook-pre-mortem-body');
  const paths = (pm.failurePaths || [])
    .map(
      (fp, idx) =>
        `<div class="outlook-pre-mortem-path"><h5>${idx + 1}. ${escapeHtml(fp.title)}</h5><p>${escapeHtml(fp.scenario)}</p><p class="outlook-pre-mortem-cite">[${escapeHtml(fp.citation?.source || '—')}]</p></div>`
    )
    .join('');
  body.innerHTML = `<p class="outlook-pre-mortem-meta">${escapeHtml(String(instId).toUpperCase())} · posture ${escapeHtml(postureIntent)} · ${escapeHtml(pm.playbookId || '无剧本')}</p>${paths}`;
  const checkbox = modal.querySelector('.outlook-pre-mortem-checkbox');
  const confirmBtn = modal.querySelector('.outlook-pre-mortem-confirm');
  checkbox.checked = false;
  confirmBtn.disabled = true;
  modal.dataset.instrument = instId;
  modal.dataset.signalId = pm.signalId;
  modal.dataset.posture = postureIntent;
  modal.dataset.playbookId = pm.playbookId || '';
  modal.__onConfirm = onConfirm;
  checkbox.onchange = () => {
    confirmBtn.disabled = !checkbox.checked;
  };
  modal.classList.remove('hidden');
  modal.hidden = false;
  return { ok: true, preMortem: pm, modal };
}

async function handleBehaviorAdoptScout(panel, instId, suggestedPosture) {
  const open = await openPreMortemModal(panel, instId, {
    postureIntent: '试仓',
    onConfirm: async () => {
      if (!window.fancheng?.logBehaviorOverride) return;
      await window.fancheng.logBehaviorOverride({
        symbol: instId,
        suggestedPosture: suggestedPosture || '观望',
        userAction: '采纳',
        userPosture: '试仓',
        note: 'pre-mortem-ack',
      });
    },
  });
  if (open?.alreadyAcked && open.onConfirm !== false) {
    if (window.fancheng?.logBehaviorOverride) {
      await window.fancheng.logBehaviorOverride({
        symbol: instId,
        suggestedPosture: suggestedPosture || '观望',
        userAction: '采纳',
        userPosture: '试仓',
        note: 'pre-mortem-cached-ack',
      });
    }
  }
  return open;
}

async function confirmPreMortemModal(panel) {
  const modal = panel?.querySelector('.outlook-pre-mortem-modal');
  if (!modal) return;
  const checkbox = modal.querySelector('.outlook-pre-mortem-checkbox');
  if (!checkbox?.checked) return;
  const entry = {
    signalId: modal.dataset.signalId,
    symbol: modal.dataset.instrument,
    posture: modal.dataset.posture || '试仓',
    playbookId: modal.dataset.playbookId || null,
  };
  if (window.fancheng?.savePreMortemAck) {
    await window.fancheng.savePreMortemAck(entry);
  }
  const onConfirm = modal.__onConfirm;
  if (typeof onConfirm === 'function') await onConfirm();
  modal.classList.add('hidden');
  modal.hidden = true;
}

function renderOutlookGlobalLiquidityDetail(gr) {
  if (!gr) {
    return `<details class="outlook-global-liquidity-detail">
      <summary>全球流动性 · 待校验</summary>
      <p class="outlook-gl-empty">暂无 globalLiquidityRisk 载荷</p>
    </details>`;
  }
  const rows = (gr.observables || [])
    .map((o) => {
      const status = o.status || 'null';
      const val = o.value != null ? escapeHtml(String(o.value)) : '暂无';
      return `<tr class="outlook-gl-obs-row outlook-gl-status-${escapeAttr(status)}">
        <td>${escapeHtml(o.label || o.id)}</td>
        <td>${val}</td>
        <td><span class="outlook-gl-status-dot" data-status="${escapeAttr(status)}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(o.dataSource || '—')}</td>
      </tr>`;
    })
    .join('');
  const chainRows = (gr.logicChain || [])
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.layer || '')}</td><td>${escapeHtml(c.conclusion || '')}</td><td>${escapeHtml(c.evidence || '')}</td></tr>`
    )
    .join('');
  const tier = gr.tier || gr.liquidityShockTier || 'L0';
  const regime = gr.regime || gr.globalRiskRegime || 'normal';
  return `<details class="outlook-global-liquidity-detail" open>
    <summary>全球流动性 · ${escapeHtml(tier)} · ${escapeHtml(regime)}</summary>
    <p class="outlook-gl-summary">${escapeHtml(gr.summary || '')}</p>
    <table class="outlook-gl-obs-table">
      <thead><tr><th>指标</th><th>值</th><th>状态</th><th>来源</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">暂无</td></tr>'}</tbody>
    </table>
    <details class="outlook-gl-chain-details">
      <summary>逻辑链 (${(gr.logicChain || []).length})</summary>
      <table class="outlook-gl-chain-table">
        <thead><tr><th>层</th><th>结论</th><th>证据</th></tr></thead>
        <tbody>${chainRows || '<tr><td colspan="3">暂无</td></tr>'}</tbody>
      </table>
    </details>
  </details>`;
}

function renderContradictionMatrixBlock(matrix, { compact = false } = {}) {
  if (!matrix) return '';
  const main = matrix.mainContradiction && matrix.mainContradiction !== '暂无'
    ? `<p class="outlook-cmatrix-main"><strong>主矛盾</strong> ${escapeHtml(matrix.mainContradiction)}${
        matrix.stateKey ? ` · <span class="outlook-cmatrix-state">${escapeHtml(matrix.stateKey)}</span>` : ''
      }</p>`
    : `<p class="outlook-cmatrix-main"><strong>主矛盾</strong> 暂无</p>`;
  const dissent =
    matrix.forcedDissent && matrix.forcedDissent !== '暂无'
      ? `<p class="outlook-cmatrix-dissent"><strong>反对力</strong> ${escapeHtml(String(matrix.forcedDissent).slice(0, compact ? 120 : 240))}</p>`
      : `<p class="outlook-cmatrix-dissent"><strong>反对力</strong> 暂无</p>`;
  const axes = (matrix.axes || [])
    .map((a) => {
      const sideCls = a.side ? `side-${escapeAttr(a.side)}` : 'side-miss';
      return `<li class="outlook-cmatrix-axis ${sideCls}"><span class="outlook-cmatrix-k">${escapeHtml(a.label)}</span> <em>${escapeHtml(a.sideLabel || '暂无')}</em> <span>${escapeHtml(a.display || '暂无')}</span></li>`;
    })
    .join('');
  const conflicts = (matrix.cells || [])
    .filter((c) => c.conflict)
    .slice(0, compact ? 3 : 8)
    .map((c) => `<li>${escapeHtml(c.aLabel)}(${escapeHtml(labelSideCn(c.aSide))}) × ${escapeHtml(c.bLabel)}(${escapeHtml(labelSideCn(c.bSide))})</li>`)
    .join('');
  const hyps = (matrix.competingHypotheses || [])
    .map((h) => {
      const falsify = h.falsify
        ? `<span class="outlook-hyp-falsify">证伪：${escapeHtml(String(h.falsify).slice(0, compact ? 160 : 320))}</span>`
        : '';
      return `<li class="outlook-hyp-item outlook-hyp-${escapeAttr(h.side || '')}">
        <strong>${escapeHtml(h.label || h.side || '假说')}</strong>
        <p class="outlook-hyp-claim">${escapeHtml(String(h.claim || '').slice(0, compact ? 120 : 200))}</p>
        ${falsify}
      </li>`;
    })
    .join('');
  const sf = matrix.stockFlow;
  const sfLine =
    sf?.available && sf.display
      ? `<p class="outlook-cmatrix-stockflow">合证：${escapeHtml(String(sf.display).slice(0, compact ? 160 : 280))}${
          sf.priceMayLag ? ' · 价格或滞后' : ''
        }</p>`
      : `<p class="outlook-cmatrix-stockflow">合证：${escapeHtml(sf?.note || sf?.reason || '暂无')}</p>`;
  return `<div class="outlook-contradiction-matrix-block${compact ? ' compact' : ' board'}">
    ${main}
    ${dissent}
    <p class="outlook-cmatrix-summary">${escapeHtml(matrix.summary || '暂无')} · 矛盾对 n=${escapeHtml(String(matrix.conflictCount ?? '暂无'))} · ${escapeHtml(matrix.dataSource || '')}</p>
    ${sfLine}
    <ul class="outlook-cmatrix-axes">${axes || '<li>轴数据暂无</li>'}</ul>
    ${conflicts ? `<ul class="outlook-cmatrix-conflicts"><li class="outlook-cmatrix-conflicts-h">矛盾对</li>${conflicts}</ul>` : '<p class="outlook-cmatrix-noc">暂无显著矛盾对</p>'}
    ${hyps ? `<ul class="outlook-hyp-list">${hyps}</ul>` : ''}
  </div>`;
}

let intelCenterFace = 'decision'; // decision | research | execution

/** 面孔升档补跑：合并 slim/full overlay 到品种详情（不改缓存原件） */
function mergeIntelFaceOverlay(instrumentId, face) {
  const id = typeof instrumentId === 'object' ? instrumentId?.id : instrumentId;
  if (!id || !face || face === 'decision') return null;
  const pack = window.__outlookCacheIntelCenterPack;
  const full = pack?._faceFullOverlays?.[face]?.[id];
  const slim = pack?.facePromoteFull?.[face]?.overlays?.[id] || pack?.faceViews?.[face]?.faceRetriage?.overlays?.[id];
  const base = (window.__outlookCacheInstruments || []).find((i) => i.id === id);
  if (!base) return null;
  if (full && !full.reusedFull) {
    return {
      ...base,
      intelCenter: {
        ...full,
        attention: full.attention || base.intelCenter?.attention,
        _facePromoteApplied: true,
        _facePromoteFace: face,
      },
    };
  }
  if (!slim) return null;
  return {
    ...base,
    intelCenter: {
      ...(base.intelCenter || {}),
      beliefLevel: slim.beliefLevel ?? base.intelCenter?.beliefLevel,
      summary: slim.summary ?? base.intelCenter?.summary,
      attention: slim.attention || base.intelCenter?.attention,
      pushTier: slim.pushTier
        ? { ...(base.intelCenter?.pushTier || {}), tier: slim.pushTier }
        : base.intelCenter?.pushTier,
      primaryClaim: base.intelCenter?.primaryClaim
        ? {
            ...base.intelCenter.primaryClaim,
            status: slim.claimStatus || base.intelCenter.primaryClaim.status,
            claimId: slim.claimId || base.intelCenter.primaryClaim.claimId,
            issueId: slim.issueId || base.intelCenter.primaryClaim.issueId,
            mechanismDepthDisplay:
              slim.mechanismDepthDisplay || base.intelCenter.primaryClaim.mechanismDepthDisplay,
          }
        : base.intelCenter?.primaryClaim,
      memo: {
        ...(base.intelCenter?.memo || {}),
        headline: slim.memoHeadline || base.intelCenter?.memo?.headline,
        mechanismDepthDisplay:
          slim.mechanismDepthDisplay || base.intelCenter?.memo?.mechanismDepthDisplay,
      },
      claimTree: slim.claimTreeDisplay
        ? { ...(base.intelCenter?.claimTree || {}), display: slim.claimTreeDisplay }
        : base.intelCenter?.claimTree,
      _facePromoteApplied: true,
      _facePromoteFace: face,
      _facePromoteReused: !!slim.reusedFull,
    },
  };
}

function renderIntelCenterHub(pack) {
  if (!pack?.version) {
    return `<section class="intel-center-hub intel-center-hub-empty" aria-label="情报中心">
      <h3 class="intel-center-title">情报中心 · 幕僚线</h3>
      <p class="intel-center-quiet">情报包构建中或暂不可用 · 待校验</p>
    </section>`;
  }
  // 打断真通道：有新通知则派发系统通知（同 pack 版本只派一次）
  try {
    const notes = pack.interruptChannel?.freshNotifications;
    const ver = pack.version + ':' + (pack.interruptChannel?.updatedAt || pack.asOf || '');
    if (notes?.length && window.__intelInterruptNotifiedVer !== ver && window.fancheng?.dispatchIntelInterruptNotifications) {
      window.__intelInterruptNotifiedVer = ver;
      void window.fancheng.dispatchIntelInterruptNotifications(notes);
    }
  } catch {
    // ignore
  }
  const face = intelCenterFace || 'decision';
  const faceView = pack.faceViews?.[face] || {};
  const view = { ...pack, ...faceView };
  const stats = view.stats || {};
  const sd = view.statsDisplay || {};
  const diff = view.dailyDiff || {};
  const queue = view.questionQueue || {};
  const shift = view.shift || {};
  const debt = view.debtBoard || {};
  const meta = view.metaIntelligence || pack.metaIntelligence || {};
  const kpis = view.kpis || {};
  const quiet = view.quietDay || diff.quietDay;
  const p0 = (queue.p0 || [])
    .map(
      (q) =>
        `<li class="intel-p0-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId)}" tabindex="0" role="button"><strong>${escapeHtml(q.instrumentName)}</strong> · ${escapeHtml(q.question)}</li>`
    )
    .join('');
  const interrupts = ((view.interruptChannel?.queue?.length ? view.interruptChannel.queue : null) || view.interrupts || [])
    .map((i) => {
      const id = i.instrumentId || i.id;
      const name = i.instrumentName || i.name;
      const state = i.stateLabel || i.lifecycle || '';
      const head = i.headline || '';
      const scoreBit =
        i.scoreDisplay && i.scoreDisplay !== '暂无'
          ? ` · score ${escapeHtml(i.scoreDisplay)}`
          : i.score != null
            ? ` · score ${escapeHtml(String(i.score))}`
            : ' · score 暂无';
      const nBit = ` · ${escapeHtml(
        i.nGateDisplay ||
          (i.surpriseNDisplay && i.surpriseNDisplay !== '暂无'
            ? `surprise n=${i.surpriseNDisplay}`
            : i.surpriseN != null
              ? `surprise n=${i.surpriseN}`
              : 'n=暂无·门槛≥20')
      )}`;
      const reasonBit = i.interruptReason
        ? ` · <span class="intel-ich-reason">${escapeHtml(String(i.interruptReason).slice(0, 36))}</span>`
        : (i.reasons || [])[0]
          ? ` · <span class="intel-ich-reason">${escapeHtml(String(i.reasons[0]).slice(0, 36))}</span>`
          : '';
      return `<li><button type="button" class="btn-link intel-interrupt-btn" data-action="select-outlook-instrument" data-instrument="${escapeAttr(id)}">${escapeHtml(name)}</button> · ${escapeHtml(head.slice(0, 40))}${scoreBit}${nBit}${reasonBit}${state ? ` <span class="intel-ich-state">${escapeHtml(state)}</span>` : ''}${i.redTeam ? ` <span class="intel-rt-hint">${escapeHtml(String(i.redTeam).slice(0, 24))}</span>` : ''}${i.key ? ` <button type="button" class="intel-ich-ack" data-action="intel-ack-interrupt" data-key="${escapeAttr(i.key)}">确认</button> <button type="button" class="intel-ich-mute" data-action="intel-mute-interrupt" data-key="${escapeAttr(i.key)}" data-mute-hours="4">消音4h</button>` : ''}</li>`;
    })
    .join('');
  const shockPaths = (view.shockGraph?.topPaths || [])
    .slice(0, 6)
    .map((p) => `<li class="intel-shock-path${p.pending ? ' pending' : ''}">${escapeHtml(p.text)}${p.pending ? '' : ''}</li>`)
    .join('');
  const shockEmpty =
    !shockPaths && (view.shockGraph?.pendingCount || 0) > 0
      ? '<li>暂无激活路径 · 有待校验边</li>'
      : !shockPaths
        ? '<li>暂无激活传导路径</li>'
        : '';
  const shockDyn = view.shockDynamicsBoard || pack.shockDynamicsBoard || view.shockGraph?.dynamics;
  const shockDynLine = shockDyn?.display
    ? `<p class="intel-shock-dyn-line"><strong>冲击动力学</strong> ${escapeHtml(shockDyn.display)}${
        shockDyn.transmissionHit?.display && shockDyn.transmissionHit.display !== '暂无'
          ? ` · 传导 ${escapeHtml(shockDyn.transmissionHit.display)}`
          : ''
      }${
        shockDyn.counts?.edgeVerifyReady
          ? ` · 边验证档${escapeHtml(String(shockDyn.counts.edgeVerifyReady))}`
          : ''
      }</p>`
    : '';
  const shockWatchItems = (shockDyn?.watchOrder?.watchlists || [])
    .slice(0, 3)
    .map((w) => {
      const lead = (w.targets || [])[0];
      const hitBit =
        lead?.edgeVerifyHit && lead.edgeVerifyHit !== '暂无'
          ? ` · 史命中 ${escapeHtml(lead.edgeVerifyHit)}`
          : '';
      return `<li class="intel-shock-watch" data-action="select-outlook-instrument" data-instrument="${escapeAttr(w.sourceId || '')}" tabindex="0" role="button">${escapeHtml(w.display || '')}${hitBit}</li>`;
    })
    .join('');
  const shockAwaitItems = (shockDyn?.awaiting || [])
    .slice(0, 5)
    .map(
      (e) =>
        `<li class="intel-shock-await" data-action="select-outlook-instrument" data-instrument="${escapeAttr(e.to || '')}" tabindex="0" role="button">${escapeHtml(e.display || `${e.from}→${e.to}`)}</li>`
    )
    .join('');
  const edgeCatalog = view.shockGraph?.edgeCatalog || pack.shockGraph?.edgeCatalog;
  const edgeCatalogLine = edgeCatalog?.display
    ? `<p class="intel-edge-catalog-line"><strong>边图库</strong> ${escapeHtml(edgeCatalog.display)}</p>`
    : '';
  const edgeCatalogItems = (edgeCatalog?.sampleCatalog || edgeCatalog?.topVerified || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-edge-catalog-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.to || r.from || '')}" tabindex="0" role="button">${escapeHtml(r.display || r.label || `${r.from}→${r.to}`)}</li>`
    )
    .join('');
  const sharedMech = view.mechanismBoard?.sharedChains || pack.mechanismBoard?.sharedChains;
  const sharedMechLine = sharedMech?.display
    ? `<p class="intel-shared-mech-line"><strong>共享机制链</strong> ${escapeHtml(sharedMech.display)}</p>`
    : '';
  const sharedMechItems = (sharedMech?.top || sharedMech?.chains || [])
    .slice(0, 5)
    .map((c) => `<li class="intel-shared-mech-item">${escapeHtml(c.display || c.label || '—')}</li>`)
    .join('');
  const commanderBar = view.commanderWorkbar || pack.commanderWorkbar;
  const commanderLine =
    face === 'decision' && commanderBar?.display
      ? `<p class="intel-commander-workbar" data-commander-workbar="1"><strong>指挥条</strong> ${escapeHtml(commanderBar.display)}</p>`
      : '';
  const orderQueue = commanderBar?.orderQueue;
  const orderQueueItems = (orderQueue?.items || commanderBar?.orders || [])
    .slice(0, 6)
    .map((o) => {
      const btns = (o.actions || [])
        .map((a) => {
          if (a.action === 'intel-ack-interrupt') {
            return `<button type="button" class="intel-order-btn" data-action="intel-ack-interrupt" data-key="${escapeAttr(a.key || '')}">${escapeHtml(a.label || '确认')}</button>`;
          }
          if (a.action === 'intel-mute-interrupt') {
            return `<button type="button" class="intel-order-btn" data-action="intel-mute-interrupt" data-key="${escapeAttr(a.key || '')}" data-mute-hours="${escapeAttr(String(a.muteHours || 4))}">${escapeHtml(a.label || '消音')}</button>`;
          }
          if (a.action === 'intel-debt-ops-run') {
            return `<button type="button" class="intel-order-btn" data-action="intel-debt-ops-run" data-max="${escapeAttr(String(a.max || 3))}">${escapeHtml(a.label || '执行')}</button>`;
          }
          if (a.action === 'intel-debt-ops-dry') {
            return `<button type="button" class="intel-order-btn" data-action="intel-debt-ops-dry" data-max="${escapeAttr(String(a.max || 3))}">${escapeHtml(a.label || '演练')}</button>`;
          }
          if (a.action === 'intel-weight-approve') {
            return `<button type="button" class="intel-order-btn" data-action="intel-weight-approve" data-proposal-id="${escapeAttr(a.proposalId || '')}">${escapeHtml(a.label || '批准')}</button>`;
          }
          if (a.action === 'intel-weight-reject') {
            return `<button type="button" class="intel-order-btn" data-action="intel-weight-reject" data-proposal-id="${escapeAttr(a.proposalId || '')}">${escapeHtml(a.label || '驳回')}</button>`;
          }
          if (a.action === 'intel-ack-false-quiet') {
            return `<button type="button" class="intel-order-btn" data-action="intel-ack-false-quiet" data-resolution="${escapeAttr(a.resolution || 'reviewed')}">${escapeHtml(a.label || '确认')}</button>`;
          }
          return '';
        })
        .filter(Boolean)
        .join(' ');
      return `<li class="intel-commander-order" data-order-kind="${escapeAttr(o.kind || '')}">${escapeHtml(o.label || o.kind || '下令')}${btns ? ` · ${btns}` : ''}</li>`;
    })
    .join('');
  const orderQueueBlock =
    face === 'decision'
      ? `<div class="intel-commander-order-queue" id="intel-cell-commander-orders" data-commander-orders="1">
      <p class="intel-order-queue-line"><strong>下令队列</strong> ${escapeHtml(orderQueue?.display || '下令队列 暂无')}</p>
      ${orderQueueItems ? `<ul class="intel-order-queue-list">${orderQueueItems}</ul>` : '<p class="intel-empty">暂无待下令</p>'}
    </div>`
      : '';
  const shellLayout = view.shellLayout || pack.faceContractBoard?.shells?.[face] || null;
  const shellLayoutId = shellLayout?.shellLayoutId || (face === 'research' ? 'lab-depth' : face === 'execution' ? 'trigger-strip' : 'cmd-brief');
  const antiPat = view.antiPatternBoard || pack.antiPatternBoard;
  const antiPatLine = antiPat?.display
    ? `<p class="intel-anti-pattern-line"><strong>反模式</strong> ${escapeHtml(antiPat.display)}</p>`
    : '';
  const llmBound = view.llmBoundaryBoard || pack.llmBoundaryBoard;
  const llmBoundLine = llmBound?.display
    ? `<p class="intel-llm-boundary-line"><strong>LLM边界</strong> ${escapeHtml(llmBound.display)}${
        llmBound.hardSandbox === false ? ' · 非进程沙箱' : ''
      }</p>`
    : '';
  const qDebt = view.qualityDebtBoard || pack.qualityDebtBoard;
  const qualityDebtLine = qDebt?.display
    ? `<p class="intel-quality-debt-line"><strong>质量债</strong> ${escapeHtml(qDebt.display)}</p>`
    : '';
  const qualityDebtCalibLine = qDebt?.calibrationGaps?.display
    ? `<p class="intel-quality-debt-calib"><strong>校准缺口</strong> ${escapeHtml(qDebt.calibrationGaps.display)}</p>`
    : '';
  const qualityDebtItems = [
    ...(qDebt?.sampleDebt?.undersampled || []).map(
      (u) =>
        `<li class="intel-quality-debt-item">欠样 ${escapeHtml(u.name || u.id || '—')} · scored=${escapeHtml(String(u.scored ?? '暂无'))} · ${escapeHtml(u.hitDisplay || '暂无')}</li>`
    ),
    ...(qDebt?.sampleDebt?.skipped || []).map(
      (s) =>
        `<li class="intel-quality-debt-item">跳过 ${escapeHtml(s.name || s.id || '—')} · ${escapeHtml(s.remedy || '暂无')}</li>`
    ),
  ]
    .slice(0, face === 'research' ? 8 : 2)
    .join('');
  const qualityDebtRepayItems = (qDebt?.repayment?.items || [])
    .slice(0, face === 'research' ? 8 : 3)
    .map(
      (a) =>
        `<li class="intel-quality-debt-repay">${escapeHtml(a.title || a.action || '—')} · ${escapeHtml(a.hitDisplay || '暂无')}${
          a.scored != null ? ` · n=${escapeHtml(String(a.scored))}` : ''
        }</li>`
    )
    .join('');
  const antiPatItems = (antiPat?.catalog || antiPat?.hits || [])
    .slice(0, face === 'research' ? 8 : 3)
    .map((c) => {
      if (c.label && c.hitN != null) {
        return `<li class="intel-anti-pattern-item severity-${escapeAttr(c.severity || 'medium')}" data-action="select-outlook-instrument" data-instrument="${escapeAttr((c.samples || [])[0]?.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(c.label)} · n=${escapeHtml(c.nDisplay || String(c.hitN))} · ${escapeHtml(c.antiGoal || '')}</li>`;
      }
      return `<li class="intel-anti-pattern-item">${escapeHtml(c.detail || c.instrumentName || '—')}</li>`;
    })
    .join('');
  const resonance = view.resonanceBoard || pack.resonanceBoard;
  const resonanceLine = resonance?.display
    ? `<p class="intel-resonance-line"><strong>共振板</strong> ${escapeHtml(resonance.display)}</p>`
    : '';
  const resonanceItems = (resonance?.top || [])
    .slice(0, 6)
    .map((p) => {
      const cls = p.regime === 'diverge' ? ' diverge' : p.regime === 'lagging' ? ' lagging' : p.pending ? ' pending' : '';
      return `<li class="intel-resonance-item${cls}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(p.to || '')}" tabindex="0" role="button">${escapeHtml(p.text || `${p.label} · ${p.regimeLabel}`)}</li>`;
    })
    .join('');
  const resonanceQs = (resonance?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const narr = view.narrativeContagion || pack.narrativeContagion;
  const narrLine = narr?.display
    ? `<p class="intel-narr-line"><strong>叙事板</strong> ${escapeHtml(narr.display)}</p>`
    : '';
  const narrAheadItems = (narr?.ahead || [])
    .slice(0, 5)
    .map(
      (r) =>
        `<li class="intel-narr-ahead" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId)} · ${escapeHtml(r.themeLabel || '')} · n ${escapeHtml(r.nDisplay || '暂无')}${r.transmissionRoleLabel ? ` · ${escapeHtml(r.transmissionRoleLabel)}` : ''}</li>`
    )
    .join('');
  const narrClusters = (narr?.clusters || [])
    .slice(0, 4)
    .map((c) => `<li class="intel-narr-cluster">${escapeHtml(c.display || c.themeLabel)}</li>`)
    .join('');
  const narrTxEdges = (narr?.transmission?.edges || [])
    .slice(0, 6)
    .map(
      (e) =>
        `<li class="intel-narr-tx" data-action="select-outlook-instrument" data-instrument="${escapeAttr(e.to || '')}" tabindex="0" role="button">${escapeHtml(e.display || `${e.from}→${e.to}`)}${
          e.lagDisplay ? ` · ${escapeHtml(e.lagDisplay)}` : e.lagDays != null ? ` · 滞后${escapeHtml(String(e.lagDays))}日` : ''
        }</li>`
    )
    .join('');
  const narrCompartment =
    narr?.compartmentCounts?.note || narr?.sir?.note || narr?.sirCensus?.display
      ? `<p class="intel-narr-compartment"><strong>仓室计数</strong> 种${escapeHtml(String(narr.compartmentCounts?.seeds ?? narr.sir?.seeds ?? 0))}·采${escapeHtml(String(narr.compartmentCounts?.adopters ?? narr.sir?.adopters ?? 0))}·扩${escapeHtml(String(narr.compartmentCounts?.spreading ?? narr.sir?.spreading ?? 0))} · ${escapeHtml(narr.compartmentCounts?.note || narr.sir?.note || '')}</p>`
      : '';
  const narrSir =
    narr?.sirCensus || narr?.sirCeiling
      ? `<p class="intel-narr-sir"><strong>离散SIR</strong> ${escapeHtml(narr.sirCensus?.display || '暂无')}${
          narr.sirCensus?.lagSummary && narr.sirCensus.lagSummary !== '暂无'
            ? ` · ${escapeHtml(narr.sirCensus.lagSummary)}`
            : ''
        }${
          narr.sirCeiling?.note
            ? ` · ${escapeHtml(String(narr.sirCeiling.note).slice(0, 36))}`
            : ''
        }</p>`
      : '';
  const narrR0 = (narr?.transmission?.themes || [])
    .filter((t) => t.R0 != null || (t.instrumentCount || 0) >= 2)
    .slice(0, 4)
    .map((t) => `<li class="intel-narr-r0">${escapeHtml(t.display || `${t.themeLabel} · R₀ ${t.R0Display || '暂无'}`)}</li>`)
    .join('');
  const freshBoard = view.evidenceFreshnessBoard || pack.evidenceFreshnessBoard;
  const freshLine = freshBoard?.display
    ? `<p class="intel-fresh-line"><strong>证据新鲜度</strong> ${escapeHtml(freshBoard.display)}</p>`
    : '';
  const freshItems = (freshBoard?.rows || [])
    .slice(0, 5)
    .map(
      (r) =>
        `<li class="intel-fresh-item${r.blocksInterrupt ? ' block' : ''}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId)} · ${escapeHtml(r.display || '')}</li>`
    )
    .join('');
  const triadBoard = view.evidenceTriadBoard || pack.evidenceTriadBoard;
  const triadLine = triadBoard?.display
    ? `<p class="intel-triad-line"><strong>证据三轴</strong> ${escapeHtml(triadBoard.display)}</p>`
    : '';
  const triadItems = (triadBoard?.rows || [])
    .slice(0, 6)
    .map((r) => {
      const avg = r.averages || {};
      return `<li class="intel-triad-item${r.blocksInterrupt ? ' block' : ''}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId)} · 温${escapeHtml(avg.temperatureDisplay || '暂无')}/硬${escapeHtml(avg.hardnessDisplay || '暂无')}/贴${escapeHtml(avg.relevanceDisplay || '暂无')}${r.topPattern ? ` · ${escapeHtml(r.topPattern.label || '')}` : ''}</li>`;
    })
    .join('');
  const cmatrixBoard = view.contradictionBoard || pack.contradictionBoard;
  const cmatrixLine = cmatrixBoard?.display
    ? `<p class="intel-cmatrix-line"><strong>矛盾矩阵</strong> ${escapeHtml(cmatrixBoard.display)}</p>`
    : '';
  const cmatrixItems = (cmatrixBoard?.rows || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-cmatrix-item${!r.opposingAvailable ? ' miss-oppose' : ''}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId)} · ${escapeHtml((r.mainContradiction || '暂无').slice(0, 28))} · 反对 ${escapeHtml((r.opposingForce || '暂无').slice(0, 24))} · n=${escapeHtml(r.nDisplay || '0')}</li>`
    )
    .join('');
  const cmatrixQs = (cmatrixBoard?.questions || [])
    .slice(0, 3)
    .map(
      (q) =>
        `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`
    )
    .join('');
  const memBoard = view.memoryReplayBoard || pack.memoryReplayBoard;
  const memLine = memBoard?.display
    ? `<p class="intel-mem-line"><strong>记忆回放</strong> ${escapeHtml(memBoard.display)}</p>`
    : '';
  const memTimelines = (memBoard?.sampleTimelines || [])
    .slice(0, 4)
    .map(
      (t) =>
        `<li class="intel-mem-tl" data-action="intel-memory-replay" data-claim-id="${escapeAttr(t.claimId || '')}" tabindex="0" role="button">${escapeHtml((t.claimId || '').slice(0, 28))} · n=${escapeHtml(t.nDisplay || '暂无')}${t.latestStatus ? ` · ${escapeHtml(t.latestStatus)}` : ''}</li>`
    )
    .join('');
  const memRevs = (memBoard?.recentRevisions || [])
    .slice(0, 4)
    .map(
      (r) =>
        `<li class="intel-mem-rev" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentId || '—')} · ${escapeHtml(r.revisionType || '')} · ${escapeHtml((r.statement || r.reason || '').slice(0, 36))}</li>`
    )
    .join('');
  const memSearchBox = `<div class="intel-mem-search" data-intel-mem-search="1">
    <input type="search" class="intel-mem-q" placeholder="${escapeAttr(memBoard?.searchHint || '检索存档/改口/博物馆')}" aria-label="记忆检索" />
    <button type="button" class="intel-mem-search-btn" data-action="intel-memory-search">检索</button>
    <ul class="intel-mem-hits" id="intel-mem-hits"></ul>
  </div>`;
  const hzBoard = view.horizonConflictBoard || pack.horizonConflictBoard;
  const hzLine = hzBoard?.display
    ? `<p class="intel-hz-line"><strong>尺度冲突板</strong> ${escapeHtml(hzBoard.display)}</p>`
    : '';
  const hzItems = (hzBoard?.conflictRows || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-hz-item${r.severity === 'high' ? ' high' : ''}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId)} · ${escapeHtml(r.headline || r.display || '')}</li>`
    )
    .join('');
  const hzQs = (hzBoard?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const mhBoard = view.multiHopBoard || pack.multiHopBoard || view.shockGraph?.multiHop;
  const mhLine = mhBoard?.display
    ? `<p class="intel-mh-line"><strong>多跳冲击</strong> ${escapeHtml(mhBoard.display)}</p>`
    : '';
  const mhItems = (mhBoard?.top || mhBoard?.lagging || [])
    .slice(0, 6)
    .map((p) => {
      const cls = p.lagging ? ' lagging' : p.status === 'live' ? ' live' : p.pending ? ' pending' : '';
      return `<li class="intel-mh-item${cls}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(p.to || '')}" tabindex="0" role="button">${escapeHtml(p.text || `${p.from}→${p.via}→${p.to}`)}</li>`;
    })
    .join('');
  const mhQs = (mhBoard?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const mechBoard = view.mechanismBoard || pack.mechanismBoard;
  const mechLine = mechBoard?.display
    ? `<p class="intel-mech-line"><strong>机制图</strong> ${escapeHtml(mechBoard.display)}</p>`
    : '';
  const mechBuckets = (mechBoard?.buckets || [])
    .slice(0, 5)
    .map((b) => `<li class="intel-mech-bucket">${escapeHtml(b.display || b.label)}</li>`)
    .join('');
  const mechLive = (mechBoard?.liveActive || mechBoard?.live || [])
    .slice(0, 6)
    .map((e) => `<li class="intel-mech-live">${escapeHtml(e.text || e.label || '')}</li>`)
    .join('');
  const mechDormant = (mechBoard?.empiricalReady || [])
    .slice(0, 5)
    .map((e) => `<li class="intel-mech-dormant">${escapeHtml(e.text || e.label || '')}</li>`)
    .join('');
  const mechInsuffN = (mechBoard?.pendingInsufficientN || [])
    .slice(0, 5)
    .map((e) => `<li class="intel-mech-insuff">${escapeHtml(e.text || e.label || '')}</li>`)
    .join('');
  // 兼容旧包：无三态时回退合并 pending
  const mechPending =
    !mechDormant && !mechInsuffN
      ? (mechBoard?.pending || [])
          .slice(0, 5)
          .map((e) => `<li class="intel-mech-pending">${escapeHtml(e.text || e.label || '')}</li>`)
          .join('')
      : '';
  const mechThin = (mechBoard?.thinClaims || [])
    .slice(0, 4)
    .map(
      (r) =>
        `<li class="intel-mech-thin" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.text || '')}</li>`
    )
    .join('');
  const mechQs = (mechBoard?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const pcBoard = view.pricingClockBoard || pack.pricingClockBoard;
  const pcLine = pcBoard?.display
    ? `<p class="intel-pc-line"><strong>定价/时钟</strong> ${escapeHtml(pcBoard.display)}</p>`
    : '';
  const pcMis = (pcBoard?.mispriced || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-pc-mis" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.text || '')}</li>`
    )
    .join('');
  const pcDue = (pcBoard?.clockDue || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-pc-due" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.text || '')}</li>`
    )
    .join('');
  const pcQs = (pcBoard?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const diffSummary =
    diff.voiceSummary || diff.summary || (quiet ? '今日无显著结构变化' : '—');
  const quietCls = quiet ? ' intel-quiet-day' : '';
  const debtLine = debt.display ? `<p class="intel-debt-line">${escapeHtml(debt.display)}</p>` : '';
  const kpiLine = kpis.display ? `<p class="intel-kpi-line">${escapeHtml(kpis.display)}</p>` : '';
  const kpiIq = kpis.interruptQuality;
  const kpiIqLine = kpiIq?.nOkDisplay
    ? `<p class="intel-kpi-interrupt-n"><strong>打断n门槛</strong> ${escapeHtml(kpiIq.nOkDisplay)}${
        kpiIq.missingDisplay ? ` · ${escapeHtml(kpiIq.missingDisplay)}` : ''
      }</p>`
    : '';
  const kpiPanels = (kpis.panels || [])
    .map(
      (p) =>
        `<li class="intel-kpi-panel-item"><strong>${escapeHtml(p.label)}</strong> ${escapeHtml(p.value)}${
          p.sampleDisplay ? ` <span class="intel-kpi-n">${escapeHtml(p.sampleDisplay)}</span>` : ''
        }${p.gateDisplay ? ` <span class="intel-kpi-gate">${escapeHtml(p.gateDisplay)}</span>` : ''}</li>`
    )
    .join('');
  const kpiPanelHtml = kpiPanels
    ? `<ul class="intel-kpi-panels">${kpiPanels}</ul>${kpiIqLine}${
        kpis.directionHit
          ? `<p class="intel-kpi-dir">方向命中 ${escapeHtml(kpis.directionHit.archiveDisplay || '暂无')}${
              kpis.directionHit.nDisplay && kpis.directionHit.nDisplay !== '暂无'
                ? ` · n=${escapeHtml(kpis.directionHit.nDisplay)}`
                : ' · n=暂无'
            }${kpis.directionHit.deferred ? ' · deferred' : ''}</p>`
          : ''
      }`
    : '';
  const shiftVoice = view.shiftVoice || pack.shiftVoice;
  const voiceTitles = shiftVoice?.sectionTitles || view.shiftContract?.sectionTitles || {};
  const shiftVoiceLine = shiftVoice?.hubLead
    ? `<p class="intel-shift-voice-line"><strong>班次文风</strong> ${escapeHtml(shiftVoice.hubLead)}${
        shiftVoice.voiceLabel ? ` · ${escapeHtml(shiftVoice.voiceLabel)}` : ''
      }</p>`
    : '';
  const shiftLine = shift.display ? `<span class="intel-shift-badge">${escapeHtml(shift.display)}</span>` : '';
  const statsHeader = `${shiftLine} P0 ${escapeHtml(sd.p0 ?? String(stats.p0 ?? 0))} · 深算 ${escapeHtml(
    sd.deepAttention ?? String(stats.deepAttention ?? '—')
  )} · 议题证伪中 ${escapeHtml(sd.issuesFalsifying ?? String(stats.issuesFalsifying ?? 0))} · 内外分裂 ${escapeHtml(
    sd.dualSplit ?? String(stats.dualSplit ?? 0)
  )} · 证伪中 ${escapeHtml(sd.falsifying ?? String(stats.falsifying ?? 0))} · 已证伪 ${escapeHtml(
    sd.falsified ?? String(stats.falsified ?? 0)
  )} · mispriced ${escapeHtml(sd.mispriced ?? String(stats.mispriced ?? 0))}${
    sd.mechanismLine ? ` · 机制 ${escapeHtml(sd.mechanismLine)}` : ''
  }${sd.staffLine ? ` · 幕僚 ${escapeHtml(sd.staffLine)}` : ''}${
    sd.pageToneLine ? ` · ${escapeHtml(sd.pageToneLine)}` : ''
  }${sd.releaseLine ? ` · ${escapeHtml(sd.releaseLine)}` : ''}${
    sd.shiftVoiceLine ? ` · ${escapeHtml(sd.shiftVoiceLine)}` : ''
  }${sd.interruptNLine ? ` · 打断n ${escapeHtml(sd.interruptNLine)}` : ''}${
    sd.triadLine ? ` · ${escapeHtml(sd.triadLine)}` : ''
  }${sd.memoryLine ? ` · ${escapeHtml(sd.memoryLine)}` : ''}${
    sd.weightProposalPending
      ? ` · <span class="intel-weight-pending-badge">${escapeHtml(sd.weightProposalPending)}</span>`
      : ''
  }${sd.falseQuietRisk ? ` · <span class="intel-qb-risk-badge">${escapeHtml(sd.falseQuietRisk)}</span>` : ''}${
    sd.metaOps ? ` · <span class="intel-meta-ops-badge">${escapeHtml(sd.metaOps)}</span>` : ''
  }${
    sd.metaBlind ? ` · <span class="intel-meta-badge">${escapeHtml(sd.metaBlind)}</span>` : ''
  }`;
  const metaLine = meta.display
    ? `<p class="intel-meta-line intel-meta-${escapeAttr(meta.severity || 'clear')}"><strong>元智能</strong> ${escapeHtml(meta.display)}</p>`
    : '';
  const metaItems = (meta.top || meta.spots || [])
    .slice(0, 6)
    .map((s) => {
      const id = s.instruments?.[0]?.instrumentId || '';
      const opsBtn =
        s.opsRunnable && id
          ? ` <button type="button" class="intel-meta-ops-btn" data-action="intel-debt-ops-run" data-instrument="${escapeAttr(id)}" data-debt-type="${escapeAttr(s.debtType || '')}" data-max="1" data-prefer-meta="1">还债</button>`
          : s.opsAction === 'ack_false_quiet'
            ? ` <button type="button" class="intel-fq-ack-btn" data-action="intel-ack-false-quiet" data-resolution="reviewed">确认假静默</button>`
            : s.opsLabel
              ? ` <span class="intel-meta-ops-tag">${escapeHtml(s.opsLabel)}</span>`
              : '';
      return `<li class="intel-meta-spot sev-${escapeAttr(s.severity || 'medium')}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(id)}" tabindex="0" role="button"><strong>${escapeHtml(s.label)}</strong> · n=${escapeHtml(s.nDisplay || '暂无')}${s.remedy ? ` · ${escapeHtml(s.remedy)}` : ''}${opsBtn}</li>`;
    })
    .join('');
  const metaBridge = meta.debtBridge;
  const metaBridgeLine = metaBridge?.display
    ? `<p class="intel-meta-bridge-line"><strong>还债桥</strong> ${escapeHtml(metaBridge.display)}</p>`
    : '';
  const metaBridgeBtns =
    (metaBridge?.pendingRunnable || 0) > 0
      ? `<p class="intel-meta-ops-actions"><button type="button" class="intel-debt-ops-btn" data-action="intel-debt-ops-run" data-max="3" data-prefer-meta="1">执行元智可还（最多3）</button></p>`
      : '';
  const metaQs = (meta.questions || [])
    .slice(0, 4)
    .map(
      (q) =>
        `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`
    )
    .join('');
  const canonicalItems = (view.isomorphicBoard?.top || view.canonicalWatch?.items || [])
    .slice(0, 6)
    .map((c) => {
      const id = c.instrumentId || '';
      const name = c.instrumentName || id;
      const pathBit =
        c.best?.pathTierLabel || c.pathTier
          ? ` · ${escapeHtml(c.best?.pathTierLabel || (c.pathTier === 'strong' ? '路径强同构' : c.pathTier === 'weak' ? '弱相似' : '主题'))}`
          : '';
      const nBit =
        (c.best?.pathNDisplay || c.pathNDisplay) && (c.best?.pathNDisplay || c.pathNDisplay) !== '暂无'
          ? ` n=${escapeHtml(c.best?.pathNDisplay || c.pathNDisplay)}`
          : '';
      return `<li class="intel-iso-item${c.best?.pathTier === 'strong' || c.pathTier === 'strong' ? ' strong' : ''}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(id)}" tabindex="0" role="button">${escapeHtml(name)} · ${escapeHtml((c.best?.label || (c.cases || []).join('/')) || c.display || '—')}${pathBit}${nBit}</li>`;
    })
    .join('');
  const isoBoard = view.isomorphicBoard || pack.isomorphicBoard;
  const isoLine = isoBoard?.display
    ? `<p class="intel-iso-line"><strong>同构板</strong> ${escapeHtml(isoBoard.display)}</p>`
    : '';
  const isoReplayItems = (isoBoard?.sampleReplays || [])
    .slice(0, 5)
    .map((r) => {
      const score =
        r.pathScore != null && Number.isFinite(Number(r.pathScore))
          ? ` · 路径分 ${escapeHtml(String(Number(r.pathScore).toFixed(2)))}`
          : '';
      const nBit =
        r.pathNDisplay && r.pathNDisplay !== '暂无' ? ` · n=${escapeHtml(r.pathNDisplay)}` : '';
      return `<li class="intel-iso-replay" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId || '—')} · ${escapeHtml(r.caseLabel || r.caseId || '回放')}${score}${nBit}${r.display ? ` · ${escapeHtml(String(r.display).slice(0, 36))}` : ''}</li>`;
    })
    .join('');
  const isoQs = (isoBoard?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const calFollowItems = ((view.intelligenceCalendar || pack.intelligenceCalendar)?.followWatch || [])
    .slice(0, 4)
    .map((ev) => {
      const ft = ev.followThrough?.d5 || ev.followThrough?.d3 || ev.followThrough?.d10;
      return `<li class="intel-cal-follow" data-action="select-outlook-instrument" data-instrument="${escapeAttr((ev.symbols || [])[0] || '')}" tabindex="0" role="button">${escapeHtml(ev.name || '')} · ${escapeHtml(ft?.display || ev.intelPhase || '跟进')}</li>`;
    })
    .join('');
  const museumItems = (view.museumBoard?.entries || view.failureMuseumRecent || [])
    .slice(0, 6)
    .map((f) => {
      const lesson = f.lesson?.label ? ` · ${escapeHtml(f.lesson.label)}` : '';
      const nBit = f.daysAgoDisplay && f.daysAgoDisplay !== '暂无' ? ` · ${escapeHtml(f.daysAgoDisplay)}日前` : '';
      return `<li class="intel-museum-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(f.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(f.instrumentName || f.instrumentId || '—')}${lesson} · ${escapeHtml((f.statement || f.trigger || f.text || '').slice(0, 40))}${nBit}</li>`;
    })
    .join('');
  const museumBoardView = view.museumBoard || pack.museumBoard;
  const museumLine = museumBoardView?.display
    ? `<p class="intel-museum-line"><strong>失效博物馆</strong> ${escapeHtml(museumBoardView.display)}</p>`
    : '';
  const museumIntake = museumBoardView?.todayIntake;
  const museumIntakeLine = museumIntake?.display
    ? `<p class="intel-museum-intake-line"><strong>今日入馆</strong> ${escapeHtml(museumIntake.display)}</p>`
    : '';
  const museumIntakeItems = (museumIntake?.rows || [])
    .slice(0, 4)
    .map(
      (r) =>
        `<li class="intel-museum-intake-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.text || r.instrumentName || '—')}</li>`
    )
    .join('');
  const museumWarnItems = (museumBoardView?.activeWarnings || [])
    .slice(0, 4)
    .map(
      (w) =>
        `<li class="intel-museum-warn" data-action="select-outlook-instrument" data-instrument="${escapeAttr(w.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(w.display || '')}</li>`
    )
    .join('');
  const museumQs = (museumBoardView?.questions || [])
    .slice(0, 3)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const museumLessons = (museumBoardView?.lessons || [])
    .slice(0, 4)
    .map((l) => `<li class="intel-museum-lesson">${escapeHtml(l.label || l.id)} · n=${escapeHtml(l.nDisplay || String(l.n || 0))}</li>`)
    .join('');
  const revisionItems = (view.museumBoard?.revisions || view.revisionsRecent || [])
    .slice(0, 5)
    .map((r) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentId || '—')} · ${escapeHtml(r.revisionType || '改口')}</li>`)
    .join('');
  const brakeNote = view.confidenceBrake?.active
    ? `<p class="intel-brake-note">${escapeHtml(view.confidenceBrake.note || `自信通胀刹车 · 强结构 ${view.confidenceBrake.strongCount}→${view.confidenceBrake.strongAfter ?? view.confidenceBrake.cap}`)}${
        view.confidenceBrake.downgraded?.length
          ? ` · 降档 ${view.confidenceBrake.downgraded
              .slice(0, 4)
              .map((d) => d.name || d.id)
              .join('、')}`
          : ''
      }</p>`
    : '';
  const qb = view.quietBrakeBoard || pack.quietBrakeBoard;
  const qbFalseRisk = Boolean(qb?.falseQuietRisk);
  const fqLoop = qb?.falseQuietLoop;
  const qbLine = qb?.display
    ? `<p class="intel-qb-line${qbFalseRisk ? ' intel-qb-false-risk' : ''}${
        fqLoop?.commanderOverride ? ' intel-fq-open' : ''
      }"><strong>静默/刹车</strong> ${escapeHtml(qb.display)}${
        qbFalseRisk
          ? ` <span class="intel-qb-risk-badge">假静默风险${
              (qb.falseQuietReasons || []).length
                ? ` · ${escapeHtml((qb.falseQuietReasons || []).join('/'))}`
                : ''
            }</span>`
          : ''
      }${fqLoop?.statusLabel ? ` · <span class="intel-fq-status">${escapeHtml(fqLoop.statusLabel)}</span>` : ''}</p>`
    : '';
  const fqMust = (fqLoop?.mustRead || [])
    .map((m) => `<li class="intel-fq-must">${escapeHtml(m)}</li>`)
    .join('');
  const fqCheck = (fqLoop?.checklist || [])
    .map(
      (c) =>
        `<li class="intel-fq-check${c.done ? ' done' : ''}">${escapeHtml(c.label)} · n=${escapeHtml(c.nDisplay || '暂无')}</li>`
    )
    .join('');
  const fqPanel =
    fqLoop && fqLoop.status && fqLoop.status !== 'clear'
      ? `<div class="intel-fq-loop${fqLoop.commanderOverride ? ' open' : ''}">
      <p class="intel-fq-loop-line"><strong>假静默闭环</strong> ${escapeHtml(fqLoop.display || fqLoop.statusLabel || '')}</p>
      ${fqMust ? `<ul class="intel-fq-must-list">${fqMust}</ul>` : ''}
      ${fqCheck ? `<ul class="intel-fq-check-list">${fqCheck}</ul>` : ''}
      ${
        fqLoop.canAck
          ? `<p class="intel-fq-actions"><button type="button" class="intel-fq-ack-btn" data-action="intel-ack-false-quiet" data-resolution="reviewed">已复核并确认</button> <button type="button" class="intel-fq-ack-btn" data-action="intel-ack-false-quiet" data-resolution="material_miss">确认漏记物质</button></p>`
          : ''
      }
    </div>`
      : '';
  const qbBrakeItems = (qb?.brake?.downgraded || [])
    .slice(0, 6)
    .map(
      (d) =>
        `<li class="intel-qb-brake-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(d.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(d.text || d.instrumentName || '')}</li>`
    )
    .join('');
  const qbQs = (qb?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const briefBoard = view.externalBriefBoard || pack.externalBriefBoard;
  const briefLine = briefBoard?.display
    ? `<p class="intel-brief-line"><strong>对外简报</strong> ${escapeHtml(briefBoard.display)}</p>`
    : '';
  const briefItems = (briefBoard?.top || [])
    .slice(0, 5)
    .map(
      (u) =>
        `<li class="intel-brief-item${u.publishable ? ' pub' : ' internal'}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(u.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(u.display || u.headline || '')}${
          u.nDisplay && u.nDisplay !== '暂无' ? ` · n=${escapeHtml(u.nDisplay)}` : ''
        }</li>`
    )
    .join('');
  const journalBoard = view.analystJournalBoard || pack.analystJournalBoard;
  const journalLine = journalBoard?.display
    ? `<p class="intel-journal-line"><strong>分析师日记</strong> ${escapeHtml(journalBoard.display)}</p>`
    : '';
  const journalToday = (journalBoard?.today || journalBoard?.recent || [])
    .slice(0, 6)
    .map(
      (e) =>
        `<li class="intel-journal-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(e.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(e.text || '')}</li>`
    )
    .join('');
  const journalFrozen = (journalBoard?.liveFrozen || [])
    .slice(0, 4)
    .map(
      (e) =>
        `<li class="intel-journal-frozen" data-action="select-outlook-instrument" data-instrument="${escapeAttr(e.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(e.text || e.instrumentName || '')}</li>`
    )
    .join('');
  const diffBuckets = (() => {
    const ch = diff.changes || {};
    const parts = [];
    const pushList = (key, label, cls) => {
      const rows = ch[key] || [];
      if (!rows.length) return;
      parts.push(
        `<h5 class="intel-sub-h">${escapeHtml(label)} ${rows.length}</h5><ul class="intel-flip-list ${cls}">${rows
          .slice(0, 6)
          .map((r) => {
            const text = r.text || `${r.name || r.id || ''} ${r.from != null ? `${r.from}→${r.to}` : ''}`.trim();
            return `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.id || r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(text)}</li>`;
          })
          .join('')}</ul>`
      );
    };
    pushList('falsified', '证伪', 'intel-falsified-list');
    pushList('claimSwaps', '命题换', 'intel-claim-swap-list');
    pushList('playbookTransitions', '剧本', 'intel-pb-diff-list');
    pushList('pricingFlips', '定价', 'intel-pricing-diff-list');
    pushList('regimeFlips', 'regime', 'intel-regime-diff-list');
    pushList('redTeamIngests', '红队', 'intel-rt-diff-list');
    pushList('brakeForced', '刹车', 'intel-brake-diff-list');
    pushList('newGaps', '缺口', 'intel-gap-diff-list');
    if (ch.directionFlips?.length) {
      parts.push(
        `<details class="intel-dir-flips"><summary>方向翻转 ${ch.directionFlips.length}（次要）</summary><ul class="intel-flip-list">${ch.directionFlips
          .map((f) => `<li>${escapeHtml(f.name)} ${escapeHtml(f.from)}→${escapeHtml(f.to)}</li>`)
          .join('')}</ul></details>`
      );
    }
    return parts.join('');
  })();
  const teach = view.teaching;
  const teachLine = teach?.lessonCount
    ? `<p class="intel-teach-line"><strong>教学</strong> ${escapeHtml(teach.display || '')}</p>`
    : '';
  const teachItems = (teach?.lessons || [])
    .slice(0, 4)
    .map((l) => `<li><strong>${escapeHtml(l.title)}</strong> · ${escapeHtml(l.body)}</li>`)
    .join('');
  const contractLine = view.shiftContract?.deliveryContract
    ? `<p class="intel-contract-line"><strong>班次契约</strong> ${escapeHtml(view.shiftContract.outputStyle || '')} · ${escapeHtml(view.shiftContract.deliveryContract)}</p>`
    : '';
  const faceContractLine = view.faceContract?.deliveryContract
    ? `<p class="intel-face-contract-line"><strong>面孔契约</strong> ${escapeHtml(view.faceContract.label)} · ${escapeHtml(view.faceContract.deliveryContract)} · ${escapeHtml(view.faceContract.tone || '')}${
        view.faceContract.rail ? ' · 分轨交付' : ''
      }</p>`
    : '';
  const deliveryBrief = view.deliveryBrief || pack.faceViews?.[face]?.deliveryBrief;
  const deliveryBriefLine = deliveryBrief?.headline
    ? `<p class="intel-face-delivery-brief"><strong>交付简报</strong> ${escapeHtml(deliveryBrief.headline)}</p>${
        (deliveryBrief.mustRead || []).length
          ? `<ul class="intel-face-must-read">${deliveryBrief.mustRead
              .slice(0, 4)
              .map((m) => `<li>${escapeHtml(m)}</li>`)
              .join('')}</ul>`
          : ''
      }${
        (deliveryBrief.omitted || []).length
          ? `<p class="intel-face-omitted">本面省略：${escapeHtml(deliveryBrief.omitted.slice(0, 6).join(' · '))}</p>`
          : ''
      }`
    : '';
  const faceRailBoard = pack.faceContractBoard;
  const faceRailLine = faceRailBoard?.display
    ? `<p class="intel-face-rail-line"><strong>分轨审计</strong> ${escapeHtml(faceRailBoard.display)}${
        faceRailBoard.contractOk === false ? ' · 待校验' : ''
      }</p>`
    : '';
  const pageToneBoard = view.pageToneBoard || pack.pageToneBoard;
  const pageToneLine = pageToneBoard?.display
    ? `<p class="intel-page-tone-line"><strong>页面气质</strong> ${escapeHtml(pageToneBoard.display)}</p>`
    : '';
  const compile = view.researchCompile || pack.researchCompile;
  const releaseBoard = pack.releaseProductBoard || compile?.productBoard;
  const productPath = compile?.productPath || releaseBoard?.productPath;
  const compileLine = compile?.releaseId
    ? `<p class="intel-compile-line"><strong>研究发行</strong> ${escapeHtml(compile.display || compile.releaseId)}${
        productPath?.available ? ` · ${escapeHtml((productPath.headline || '').slice(0, 72))}` : ''
      }</p>`
    : '';
  const productMustRead = (productPath?.mustRead || [])
    .slice(0, 4)
    .map((m) => `<li class="intel-release-must">${escapeHtml(m)}</li>`)
    .join('');
  const productTop = (productPath?.topLines || [])
    .slice(0, 5)
    .map(
      (t) =>
        `<li class="intel-release-top" data-action="select-outlook-instrument" data-instrument="${escapeAttr(t.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(t.bucket || '')} · ${escapeHtml((t.text || '').slice(0, 48))}</li>`
    )
    .join('');
  const rollbackItems = (releaseBoard?.rollbackCandidates || compile?.recent || [])
    .filter((r) => r.releaseId && r.releaseId !== compile?.releaseId)
    .slice(0, 5)
    .map(
      (r) =>
        `<li class="intel-release-rollback"><code>${escapeHtml(r.releaseId)}</code> · ${escapeHtml(r.asOf || '')}${
          r.materialChanges != null ? ` · 物质${escapeHtml(String(r.materialChanges))}` : ''
        }</li>`
    )
    .join('');
  const compilePanel = compile?.releaseId
    ? `<details class="intel-compile-panel" open><summary>发行对照 ${escapeHtml(compile.releaseId)}</summary>
      <p class="intel-compile-meta">input ${escapeHtml(compile.inputDigestDisplay || '暂无')}${
        compile.previousReleaseId ? ` · 上版 ${escapeHtml(compile.previousReleaseId)}` : ' · 上版 暂无'
      }${compile.snapshotSaved ? ' · 快照已落盘' : ''}</p>
      ${productMustRead ? `<h6 class="intel-sub-h">产品主路径（今日←上版）</h6><ul class="intel-release-must-list">${productMustRead}</ul>` : ''}
      ${productTop ? `<h6 class="intel-sub-h">物质变更摘录</h6><ul class="intel-release-top-list">${productTop}</ul>` : ''}
      ${
        compile.vsPrev?.changed?.length
          ? `<h6 class="intel-sub-h">模块版本 Δ</h6><ul class="intel-compile-diff">${compile.vsPrev.changed
              .slice(0, 8)
              .map(
                (c) =>
                  `<li><code>${escapeHtml(c.key)}</code> ${escapeHtml(String(c.from))} → ${escapeHtml(String(c.to))}</li>`
              )
              .join('')}</ul>`
          : `<p class="intel-compile-meta">${escapeHtml(compile.vsPrev?.display || '暂无模块对照')}</p>`
      }
      ${
        compile.compare?.available
          ? `<p class="intel-compile-compare"><strong>指定对照</strong> ${escapeHtml(compile.compare.display || '')}</p>`
          : ''
      }
      ${
        compile.versionLines?.length
          ? `<details class="intel-compile-vers-wrap"><summary>模块版本表</summary><ul class="intel-compile-vers">${compile.versionLines
              .map((v) => `<li>${escapeHtml(v.key)} · ${escapeHtml(String(v.version))}</li>`)
              .join('')}</ul></details>`
          : ''
      }
      ${
        rollbackItems
          ? `<h6 class="intel-sub-h">可回滚对照（只读）</h6><ul class="intel-compile-recent">${rollbackItems}</ul>`
          : ''
      }
    </details>`
    : '';
  const unknownBoard = view.unknownBoard || pack.unknownBoard;
  const unknownLine = unknownBoard?.display
    ? `<p class="intel-unknown-board-line"><strong>Unknown 板</strong> ${escapeHtml(unknownBoard.display)}</p>`
    : '';
  const unknownPayItems = (unknownBoard?.paydown || [])
    .slice(0, 6)
    .map(
      (p) =>
        `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(p.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(p.instrumentName || p.instrumentId || '—')} · ${escapeHtml(p.label)} · ${escapeHtml(p.path || '')}</li>`
    )
    .join('');
  const faceAttn = view.attentionBudget;
  const faceAttnLine =
    faceAttn?.display && faceAttn.faceId
      ? `<p class="intel-face-attn-line"><strong>面孔配额</strong> ${escapeHtml(faceAttn.display)}</p>`
      : '';
  const faceRetriage = view.faceRetriage;
  const appliedFull = faceRetriage?.appliedFull || pack.facePromoteFull?.[face]?.appliedFull;
  const faceRetriageLine = faceRetriage?.display
    ? `<p class="intel-face-retriage-line"><strong>面孔再配额</strong> ${escapeHtml(faceRetriage.display)}${
        faceRetriage.promote?.length
          ? ` · 升档 ${faceRetriage.promote
              .slice(0, 4)
              .map((p) => p.instrumentName || p.instrumentId)
              .join('、')}`
          : ''
      }${
        appliedFull?.display
          ? ` · <span class="intel-promote-applied">${escapeHtml(appliedFull.display)}</span>`
          : ''
      }</p>`
    : '';
  const fcBoard = view.faceComputeBoard || pack.faceComputeBoard;
  const faceComputeLine = fcBoard?.display
    ? `<p class="intel-face-compute-line"><strong>算力台账</strong> ${escapeHtml(fcBoard.display)}${
        fcBoard.integrityOk === false ? ' · 完整性告警' : ''
      }</p>`
    : '';
  const faceComputeItems = fcBoard?.faces
    ? ['decision', 'research', 'execution']
        .map((fid) => {
          const f = fcBoard.faces[fid];
          if (!f) return '';
          return `<li class="intel-face-compute-item${f.capped ? ' capped' : ''}">${escapeHtml(fid)} · ${escapeHtml(f.display || '')}${
            f.promoteApplied != null ? ` · 升${f.promoteApplied}` : ''
          }</li>`;
        })
        .filter(Boolean)
        .join('')
    : '';
  const evAudit = view.evidenceAuditBoard || pack.evidenceAuditBoard;
  const evAuditLine = evAudit?.display
    ? `<p class="intel-ev-audit-line"><strong>证据审计</strong> ${escapeHtml(evAudit.display)}</p>`
    : '';
  const evAuditItems = (evAudit?.top || [])
    .slice(0, 5)
    .map(
      (r) =>
        `<li class="intel-ev-audit-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.display || '')}</li>`
    )
    .join('');
  const evAuditQs = (evAudit?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const rtBoard = view.redTeamBoard || pack.redTeamBoard;
  const rtBoardLine = rtBoard?.display
    ? `<p class="intel-rt-board-line"><strong>红队闭环</strong> ${escapeHtml(rtBoard.display)}</p>`
    : '';
  const rtBoardItems = (rtBoard?.top || [])
    .slice(0, 5)
    .map(
      (r) =>
        `<li class="intel-rt-board-item${r.dissentDebt ? ' debt' : ''}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.display || '')}</li>`
    )
    .join('');
  const rtBoardQs = (rtBoard?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const manipBoard = view.antiManipulationBoard || pack.antiManipulationBoard;
  const manipCount = pack.stats?.manipulationFlagged || manipBoard?.counts?.flagged || 0;
  const manipWatch = pack.stats?.manipulationWatching || manipBoard?.counts?.watching || 0;
  const manipLine = manipBoard?.display
    ? `<p class="intel-manip-line"><strong>操纵纪律</strong> ${escapeHtml(manipBoard.display)}</p>`
    : manipCount > 0 || manipWatch > 0
      ? `<p class="intel-manip-line"><strong>操纵纪律</strong> 硬旗 ${manipCount} · 观察 ${manipWatch}</p>`
      : '';
  const manipItems = (manipBoard?.top || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-manip-item${r.blockInterrupt ? ' hard' : ' soft'}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId || '—')} · ${escapeHtml(r.display || '')} · n=${escapeHtml(r.nDisplay || '暂无')}</li>`
    )
    .join('');
  const manipQs = (manipBoard?.questions || [])
    .slice(0, 4)
    .map(
      (q) =>
        `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`
    )
    .join('');
  const pbBoard = view.playbookBoard || pack.playbookBoard;
  const pbLine = pbBoard?.display
    ? `<p class="intel-pb-line"><strong>Playbook</strong> ${escapeHtml(pbBoard.display)}</p>`
    : '';
  const pbTransitions = (pbBoard?.transitions || [])
    .slice(0, 6)
    .map(
      (t) =>
        `<li class="intel-pb-transition${t.kind === 'regime_flip' ? ' regime-flip' : ''}" data-action="select-outlook-instrument" data-instrument="${escapeAttr(t.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(t.text || `${t.from}→${t.to}`)}</li>`
    )
    .join('');
  const pbQs = (pbBoard?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const issueBoard = view.issueBoard;
  const issueLine = issueBoard?.display
    ? `<p class="intel-issue-line"><strong>议题板</strong> ${escapeHtml(issueBoard.display)}</p>`
    : '';
  const issueItems = (issueBoard?.falsifying || issueBoard?.issues || [])
    .slice(0, 6)
    .map((it) => {
      const parent = it.parentIssueId ? `<span class="intel-issue-parent">↳${escapeHtml(it.parentIssueId)}</span> ` : '';
      return `<li class="intel-issue-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(it.instrumentId || '')}" tabindex="0" role="button">${parent}<code>${escapeHtml(it.issueId || '')}</code> · ${escapeHtml(it.status || '')} · ${escapeHtml((it.statement || '').slice(0, 36))}${it.nDisplay && it.nDisplay !== '暂无' ? ` · n=${escapeHtml(it.nDisplay)}` : ''}</li>`;
    })
    .join('');
  const claimSharpBoard = view.claimSharpnessBoard || pack.claimSharpnessBoard;
  const claimSharpLine = claimSharpBoard?.display
    ? `<p class="intel-claim-sharp-line"><strong>命题锐度</strong> ${escapeHtml(claimSharpBoard.display)}</p>`
    : '';
  const claimSharpItems = (claimSharpBoard?.rows || [])
    .slice(0, 5)
    .map(
      (r) =>
        `<li class="intel-claim-sharp-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.display || '')}</li>`
    )
    .join('');
  const scenBoard = view.scenarioLatticeBoard || pack.scenarioLatticeBoard;
  const scenBoardLine = scenBoard?.display
    ? `<p class="intel-scen-board-line"><strong>场景板</strong> ${escapeHtml(scenBoard.display)}</p>`
    : '';
  const scenBoardItems = (scenBoard?.rows || [])
    .slice(0, 4)
    .map(
      (r) =>
        `<li class="intel-scen-board-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.display || '')}</li>`
    )
    .join('');
  const attn = view.attentionBudget;
  const attnLine = attn?.display
    ? `<p class="intel-attn-line"><strong>注意力预算</strong> ${escapeHtml(attn.display)}${
        attn.deep?.length
          ? ` · 深算: ${attn.deep
              .slice(0, 6)
              .map((d) => d.instrumentName)
              .join('、')}`
          : ''
      }</p>`
    : '';
  const rationBoard = view.attentionRationBoard || pack.attentionRationBoard;
  const rationLine = rationBoard?.display
    ? `<p class="intel-attn-ration-line"><strong>省算力</strong> ${escapeHtml(rationBoard.display)}${
        rationBoard.savingsDisplay && rationBoard.savingsDisplay !== '暂无'
          ? ` · ${escapeHtml(rationBoard.savingsDisplay)}`
          : ''
      }</p>`
    : '';
  const rationWakeItems = (rationBoard?.wakePromotions || [])
    .slice(0, 4)
    .map(
      (w) =>
        `<li class="intel-attn-wake" data-action="select-outlook-instrument" data-instrument="${escapeAttr(w.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(w.instrumentName || w.instrumentId)} · skip→lite · ${escapeHtml((w.reasons || []).slice(0, 2).join('·') || '异常唤醒')}</li>`
    )
    .join('');
  const dualLine =
    (view.dualBoard?.counts?.split || view.dualSplitCount || 0) > 0
      ? `<p class="intel-dual-line"><strong>内外分裂</strong> ${escapeHtml(String(view.dualBoard?.counts?.split ?? view.dualSplitCount))} 品种 · 选择集偏C · Interrupt阻断</p>`
      : '';
  const dualBoardView = view.dualBoard || pack.dualBoard;
  const dualBoardLine = dualBoardView?.display
    ? `<p class="intel-dual-board-line"><strong>双叙事板</strong> ${escapeHtml(dualBoardView.display)}</p>`
    : '';
  const dualSplitItems = (dualBoardView?.split || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-dual-split-item" data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.text || r.display || '')}</li>`
    )
    .join('');
  const dualQs = (dualBoardView?.questions || [])
    .slice(0, 4)
    .map((q) => `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(q.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(q.question)}</li>`)
    .join('');
  const cal = view.intelligenceCalendar;
  const calLine = cal?.display
    ? `<p class="intel-cal-line"><strong>情报日历</strong> ${escapeHtml(cal.display)}${
        cal.next ? ` · 下一项 ${escapeHtml(cal.next.name || '')} ${escapeHtml(cal.next.releaseDate || '')}` : ''
      }</p>`
    : '';
  const proc = view.processLearning;
  const scorecard = view.processScorecard || pack.processScorecard;
  const procLine = scorecard?.display
    ? `<p class="intel-proc-line"><strong>过程OS</strong> ${escapeHtml(scorecard.display)}</p>`
    : proc?.directionHit
      ? `<p class="intel-proc-line"><strong>过程学习</strong> 方向 ${escapeHtml(proc.directionHit)} · 过程 ${escapeHtml(proc.processCorrect || '—')} · ${escapeHtml(proc.dirWrongProcessRightDisplay || '')}</p>`
      : '';
  const procOutcomeItems = (scorecard?.outcome?.rows || [])
    .slice(0, 5)
    .map(
      (r) =>
        `<li class="intel-proc-row tag-${escapeAttr(r.tag || '')}">${escapeHtml(r.instrumentId || '—')} · ${escapeHtml(r.tagLabel || '')} · n ${escapeHtml(r.nDisplay || '暂无')}</li>`
    )
    .join('');
  const procNotReady = (scorecard?.notReady || [])
    .slice(0, 4)
    .map(
      (r) =>
        `<li data-action="select-outlook-instrument" data-instrument="${escapeAttr(r.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(r.instrumentName || r.instrumentId)} · ${escapeHtml((r.missing || []).join('、') || r.display || '')}</li>`
    )
    .join('');
  const procPanel = scorecard?.available !== false && scorecard?.display
    ? `<details class="intel-proc-panel"${scorecard.weightProposal?.pendingApproval ? ' open' : ''}><summary>过程正确记分牌${
        scorecard.weightProposal?.pendingApproval
          ? ` · <span class="intel-weight-pending-badge">权待审 ${escapeHtml(String(scorecard.weightProposal.materialCount ?? 0))}</span>`
          : ''
      }</summary>
      <p class="intel-proc-meta">就绪 ${escapeHtml(scorecard.live?.readyDisplay || '暂无')} · 归档过程 ${escapeHtml(scorecard.outcome?.processCorrect || '暂无')} · 样本 ${escapeHtml(scorecard.outcome?.sampleDisplay || '暂无')}</p>
      ${procOutcomeItems ? `<ul class="intel-proc-outcomes">${procOutcomeItems}</ul>` : ''}
      ${procNotReady ? `<h6 class="intel-sub-h">未就绪</h6><ul class="intel-proc-notready">${procNotReady}</ul>` : ''}
      ${
        scorecard.weightNudges?.length
          ? `<h6 class="intel-sub-h">已生效权(n≥20)</h6><ul class="intel-proc-weights">${scorecard.weightNudges
              .map(
                (w) =>
                  `<li>${escapeHtml(w.stateKey)} ×${escapeHtml(String(w.multiplier))} · 过程 ${escapeHtml(w.processDisplay)} · n ${escapeHtml(w.nDisplay)}</li>`
              )
              .join('')}</ul>`
          : ''
      }
      ${
        scorecard.weightProposal?.pendingApproval
          ? `<div class="intel-weight-proposal" data-proposal-id="${escapeAttr(scorecard.weightProposal.proposalId || '')}">
              <h6 class="intel-sub-h">权提案待人审 · 未写入生效文件</h6>
              <p class="intel-weight-proposal-note">${escapeHtml(scorecard.weightProposal.note || scorecard.weightProposal.display || '')}</p>
              ${
                scorecard.weightProposal.analystContribution?.display
                  ? `<p class="intel-weight-analyst-line"><strong>标注→权</strong> ${escapeHtml(scorecard.weightProposal.analystContribution.display)}</p>`
                  : ''
              }
              <ul class="intel-weight-proposal-list">${(scorecard.pendingWeightChanges || scorecard.weightProposal.materialChanges || [])
                .slice(0, 8)
                .map(
                  (c) =>
                    `<li>${escapeHtml(c.stateKey)} · ${escapeHtml(String(c.from))}→${escapeHtml(String(c.to))} · 过程 ${escapeHtml(c.processDisplay || '暂无')} · n ${escapeHtml(c.nDisplay || '暂无')}${
                      c.analystInformed ? ' · 含标注' : ''
                    }</li>`
                )
                .join('')}</ul>
              <div class="intel-weight-ack-bar">
                <button type="button" class="intel-weight-ack-btn" data-action="intel-weight-approve" data-proposal-id="${escapeAttr(scorecard.weightProposal.proposalId || '')}">批准落盘</button>
                <button type="button" class="intel-weight-ack-btn intel-weight-reject" data-action="intel-weight-reject" data-proposal-id="${escapeAttr(scorecard.weightProposal.proposalId || '')}">驳回</button>
              </div>
            </div>`
          : scorecard.weightProposal?.display
            ? `<p class="intel-weight-proposal-idle">${escapeHtml(scorecard.weightProposal.display)}${
                scorecard.weightProposal.analystContribution?.display
                  ? ` · ${escapeHtml(scorecard.weightProposal.analystContribution.display)}`
                  : ''
              }</p>`
            : ''
      }
      <p class="intel-proc-note">${escapeHtml(scorecard.note || '')}</p>
    </details>`
    : '';
  const ich = view.interruptChannel || pack.interruptChannel;
  const deck = ich?.commandDeck || {};
  const ichLine = ich?.display
    ? `<p class="intel-ich-line"><strong>打断通道</strong> ${escapeHtml(ich.display)}${
        ich.shiftDenyReason ? ` · ${escapeHtml(ich.shiftDenyReason)}` : ''
      }</p>`
    : '';
  const cmdDeckHtml =
    deck.active || (ich?.pendingCount || 0) > 0
      ? `<div class="intel-cmd-deck${deck.escalatedCount ? ' escalated' : ''}" id="intel-cmd-deck" aria-label="打断指挥台">
      <div class="intel-cmd-deck-head">
        <strong>指挥台</strong>
        <span>${escapeHtml(deck.display || ich.display || '待办')}</span>
        ${deck.escalatedCount ? `<span class="intel-cmd-deck-esc">催办 ${escapeHtml(String(deck.escalatedCount))}</span>` : ''}
      </div>
      ${
        deck.next
          ? `<p class="intel-cmd-deck-next">下一单 · <button type="button" class="btn-link" data-action="select-outlook-instrument" data-instrument="${escapeAttr(deck.next.instrumentId || '')}">${escapeHtml(deck.next.instrumentName || deck.next.instrumentId || '—')}</button> · ${escapeHtml((deck.next.headline || '').slice(0, 48))} · <span class="intel-ich-state">${escapeHtml(deck.next.stateLabel || '')}</span> · 通道 ${escapeHtml((deck.next.channels || []).join('+') || 'hub+file')} · surprise n=${escapeHtml(deck.next.surpriseNDisplay || '暂无')}</p>`
          : '<p class="intel-cmd-deck-next">暂无下一单</p>'
      }
      <div class="intel-cmd-deck-actions">
        ${
          deck.next?.key
            ? `<button type="button" class="intel-cmd-deck-btn" data-action="intel-ack-interrupt" data-key="${escapeAttr(deck.next.key)}">确认已阅</button>
        <button type="button" class="intel-cmd-deck-btn intel-cmd-deck-mute" data-action="intel-mute-interrupt" data-key="${escapeAttr(deck.next.key)}" data-mute-hours="4">消音4小时</button>
        <button type="button" class="intel-cmd-deck-btn" data-action="select-outlook-instrument" data-instrument="${escapeAttr(deck.next.instrumentId || '')}">打开备忘录</button>`
            : ''
        }
      </div>
      ${deck.note ? `<p class="intel-cmd-deck-note">${escapeHtml(deck.note)}</p>` : ''}
    </div>`
      : '';
  const ichDeliveryItems = (ich?.recentDeliveries || [])
    .slice(0, 4)
    .map(
      (d) =>
        `<li class="intel-ich-delivery">${escapeHtml(d.title || d.key || '—')} · ${escapeHtml((d.channels || []).join('+') || 'file')} · ${escapeHtml((d.channelNote || '').slice(0, 28))}</li>`
    )
    .join('');
  const ichDeniedItems = (ich?.shiftDenied || [])
    .slice(0, 4)
    .map(
      (d) =>
        `<li class="intel-ich-denied" data-action="select-outlook-instrument" data-instrument="${escapeAttr(d.instrumentId || '')}" tabindex="0" role="button">${escapeHtml(d.instrumentName || d.instrumentId || '—')} · ${escapeHtml(d.denyReason || '班次拒投')}</li>`
    )
    .join('');
  const disc = view.shiftDiscipline || pack.shiftDiscipline;
  const discLine = disc?.display
    ? `<p class="intel-disc-line"><strong>班次纪律</strong> ${escapeHtml(disc.display)}</p>`
    : '';
  const discRules = (disc?.rules || [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li class="intel-disc-rule${r.allowed ? ' ok' : ' no'}">${escapeHtml(r.label)} · ${r.allowed ? '允' : '禁'} · ${escapeHtml(r.detail || '')}</li>`
    )
    .join('');
  const discViolations = (disc?.violations || [])
    .slice(0, 4)
    .map((v) => `<li class="intel-disc-viol">${escapeHtml(v.label)} · n=${escapeHtml(v.nDisplay || String(v.count || 0))} · ${escapeHtml(v.detail || '')}</li>`)
    .join('');
  const ichItems = (ich?.queue || [])
    .slice(0, 4)
    .map(
      (it) =>
        `<li class="intel-ich-item"><button type="button" class="btn-link" data-action="select-outlook-instrument" data-instrument="${escapeAttr(it.instrumentId || '')}">${escapeHtml(it.instrumentName || it.instrumentId || '—')}</button> · ${escapeHtml((it.headline || '').slice(0, 40))} <button type="button" class="intel-ich-ack" data-action="intel-ack-interrupt" data-key="${escapeAttr(it.key || '')}">确认</button> <button type="button" class="intel-ich-mute" data-action="intel-mute-interrupt" data-key="${escapeAttr(it.key || '')}" data-mute-hours="4">消音4h</button></li>`
    )
    .join('');
  const calItems = (cal?.imminent || cal?.events || [])
    .slice(0, 5)
    .map((ev) => {
      const phase =
        ev.intelPhase === 'pre' ? '发布前' : ev.intelPhase === 'post' ? '发布后' : ev.intelPhase === 'follow' ? '跟进' : '前瞻';
      const detail =
        ev.intelPhase === 'pre'
          ? ev.pre?.marketPricedLabel || ev.pre?.display
          : ev.intelPhase === 'post'
            ? ev.post?.display
            : ev.followThrough?.d5?.display || ev.followThrough?.d3?.display || ev.question;
      return `<li class="intel-cal-item intel-cal-${escapeAttr(ev.intelPhase || '')}" data-action="select-outlook-instrument" data-instrument="${escapeAttr((ev.symbols || [])[0] || '')}" tabindex="0" role="button"><span class="intel-cal-date">${escapeHtml(ev.releaseDate || '')}</span> <strong>${escapeHtml(ev.name || '')}</strong> · ${escapeHtml(phase)} · ${escapeHtml((detail || '').slice(0, 48))}</li>`;
    })
    .join('');

  const faceTabs = `
    <div class="intel-face-tabs" role="tablist" aria-label="情报面孔">
      <button type="button" class="intel-face-tab${face === 'decision' ? ' active' : ''}" data-action="intel-face" data-face="decision">决策者</button>
      <button type="button" class="intel-face-tab${face === 'research' ? ' active' : ''}" data-action="intel-face" data-face="research">研究员</button>
      <button type="button" class="intel-face-tab${face === 'execution' ? ' active' : ''}" data-action="intel-face" data-face="execution">执行者</button>
    </div>`;

  const fiveCmds =
    face === 'execution'
      ? ''
      : `
    <div class="intel-five-cmds" role="toolbar" aria-label="五个一键">
      <button type="button" class="intel-cmd-btn" data-action="intel-cmd-p0" title="今日 P0 三问">① 今日P0</button>
      <button type="button" class="intel-cmd-btn" data-action="intel-cmd-memo" title="主矛盾+反对+触发器">② 备忘录</button>
      <button type="button" class="intel-cmd-btn" data-action="intel-cmd-shock" title="冲击路径">③ 冲击图</button>
      <button type="button" class="intel-cmd-btn" data-action="intel-cmd-revisions" title="本周改口与证伪">④ 改口复盘</button>
      <button type="button" class="intel-cmd-btn" data-action="intel-cmd-actionable" title="可行动高 surprise">⑤ 可行动</button>
    </div>
    ${face === 'decision' ? commanderLine : ''}`;

  const decisionShellChrome =
    face === 'decision' ? `${orderQueueBlock}${face === 'decision' ? cmdDeckHtml : ''}` : '';
  const researchShellChrome = '';
  const execShellChrome = '';
  const shellChrome =
    face === 'decision' ? decisionShellChrome : face === 'research' ? researchShellChrome : execShellChrome;

  const decisionGrid = `
    <div class="intel-center-grid intel-face-panel" data-face-panel="decision">
      <div class="intel-center-cell intel-cell-what-changed" id="intel-cell-what-changed">
        <h4>${escapeHtml(voiceTitles.whatChanged || '今日什么变了')}</h4>
        <p class="intel-diff-summary">${escapeHtml(diffSummary)}${
          diff.materialChanges != null ? ` · 物质 ${escapeHtml(String(diff.materialChanges))}` : ''
        }${diff.prevDate ? ` · 较 ${escapeHtml(diff.prevDate)}` : ''}</p>
        ${qbLine}
        ${fqPanel}
        ${diffBuckets || '<p class="intel-empty-diff">暂无物质变更桶 · 待校验</p>'}
        ${qbBrakeItems ? `<h5 class="intel-sub-h">刹车降档</h5><ul class="intel-qb-brake-list">${qbBrakeItems}</ul>` : ''}
        ${productMustRead && face === 'decision' ? `<h5 class="intel-sub-h">发行主路径</h5><ul class="intel-release-must-list">${productMustRead}</ul>` : ''}
        ${productTop && face === 'decision' ? `<ul class="intel-release-top-list">${productTop}</ul>` : ''}
        ${compileLine}
        ${qbQs ? `<h5 class="intel-sub-h">静默/刹车问</h5><ul class="intel-qb-q">${qbQs}</ul>` : ''}
        ${quiet ? `<p class="intel-quiet-note">${escapeHtml(qb?.quietReason || view.quietReason || '静默日 · 无 Interrupt 权限')}</p>` : ''}
        ${diff.available === false ? `<p class="intel-quiet-pending">${escapeHtml(diff.quietReason || diff.summary || '无前日快照 · 静默待校验')}</p>` : ''}
      </div>
      <div class="intel-center-cell intel-cell-p0" id="intel-cell-p0">
        <h4>${escapeHtml(voiceTitles.p0 || '今日 P0 问题')}</h4>
        <ol class="intel-p0-list">${p0 || '<li class="intel-empty">暂无 P0 · 今日无紧急证伪/翻转</li>'}</ol>
      </div>
      <div class="intel-center-cell intel-cell-calendar" id="intel-cell-calendar">
        <h4>${escapeHtml(voiceTitles.calendar || '情报日历')}</h4>
        <p class="intel-diff-summary">${escapeHtml(cal?.display || '构建中')}</p>
        <ul class="intel-cal-list">${calItems || '<li>暂无临近发布/仓单/交割窗</li>'}</ul>
        ${calFollowItems ? `<h5 class="intel-sub-h">结构跟进</h5><ul class="intel-cal-follow-list">${calFollowItems}</ul>` : ''}
      </div>
      <div class="intel-center-cell intel-cell-interrupt" id="intel-cell-actionable">
        <h4>${escapeHtml(voiceTitles.interrupt || '打断 / 可行动')}</h4>
        ${ichLine}
        <ul class="intel-interrupt-list">${interrupts || '<li>暂无 · surprise×可行动性不足或 n 不足</li>'}</ul>
        ${ichDeliveryItems ? `<h5 class="intel-sub-h">投递回执</h5><ul class="intel-ich-delivery-list">${ichDeliveryItems}</ul>` : ''}
        ${ichDeniedItems ? `<h5 class="intel-sub-h">班次拒投</h5><ul class="intel-ich-denied-list">${ichDeniedItems}</ul>` : ''}
        ${ich?.deliveryNote ? `<p class="intel-ich-note">${escapeHtml(ich.deliveryNote)}</p>` : ''}
      </div>
      <div class="intel-center-cell intel-cell-meta" id="intel-cell-meta">
        <h4>元智能 · 系统盲区</h4>
        ${metaLine || '<p class="intel-diff-summary">自审构建中</p>'}
        ${metaBridgeLine}
        ${metaBridgeBtns}
        <ul class="intel-meta-list">${metaItems || '<li>暂无可审计盲区（不代表全知）</li>'}</ul>
        ${metaQs ? `<h5 class="intel-sub-h">自审问</h5><ul class="intel-meta-q">${metaQs}</ul>` : ''}
        ${meta.note ? `<p class="intel-meta-note">${escapeHtml(meta.note)}</p>` : ''}
      </div>
    </div>`;

  const researchGrid = `
    <div class="intel-center-grid intel-face-panel" data-face-panel="research">
      <div class="intel-center-cell intel-cell-shock" id="intel-cell-shock">
        <h4>冲击 / 共振 / 叙事 / 尺度 / 多跳 / 机制 / 矛盾</h4>
        ${shockDynLine}${edgeCatalogLine}${resonanceLine}${narrLine}${narrSir}${freshLine}${triadLine}${cmatrixLine}${memLine}${hzLine}${mhLine}${mechLine}${sharedMechLine}
        <ul class="intel-shock-list">${shockPaths || shockEmpty}</ul>
        ${shockWatchItems ? `<h5 class="intel-sub-h">冲击盯盘序</h5><ul class="intel-shock-watch-list">${shockWatchItems}</ul>` : ''}
        ${shockAwaitItems ? `<h5 class="intel-sub-h">传导待验证</h5><ul class="intel-shock-await-list">${shockAwaitItems}</ul>` : ''}
        ${edgeCatalogItems ? `<h5 class="intel-sub-h">边图库</h5><ul class="intel-edge-catalog-list">${edgeCatalogItems}</ul>` : ''}
        ${sharedMechItems ? `<h5 class="intel-sub-h">共享机制链</h5><ul class="intel-shared-mech-list">${sharedMechItems}</ul>` : ''}
        ${mechBuckets ? `<h5 class="intel-sub-h">机制分桶</h5><ul class="intel-mech-buckets">${mechBuckets}</ul>` : ''}
        ${mechLive ? `<h5 class="intel-sub-h">活边</h5><ul class="intel-mech-live-list">${mechLive}</ul>` : ''}
        ${mechDormant ? `<h5 class="intel-sub-h">实证休眠</h5><ul class="intel-mech-dormant-list">${mechDormant}</ul>` : ''}
        ${mechInsuffN ? `<h5 class="intel-sub-h">n不足</h5><ul class="intel-mech-insuff-list">${mechInsuffN}</ul>` : ''}
        ${mechPending ? `<h5 class="intel-sub-h">待校验边</h5><ul class="intel-mech-pending-list">${mechPending}</ul>` : ''}
        ${mechThin ? `<h5 class="intel-sub-h">机制链薄</h5><ul class="intel-mech-thin-list">${mechThin}</ul>` : ''}
        ${mechQs ? `<h5 class="intel-sub-h">机制问</h5><ul class="intel-mech-q">${mechQs}</ul>` : ''}
        ${resonanceItems ? `<h5 class="intel-sub-h">跨品种定调</h5><ul class="intel-resonance-list">${resonanceItems}</ul>` : ''}
        ${resonanceQs ? `<h5 class="intel-sub-h">P3 共振问</h5><ul class="intel-resonance-q">${resonanceQs}</ul>` : ''}
        ${mhItems ? `<h5 class="intel-sub-h">多跳路径</h5><ul class="intel-mh-list">${mhItems}</ul>` : ''}
        ${mhQs ? `<h5 class="intel-sub-h">多跳问</h5><ul class="intel-mh-q">${mhQs}</ul>` : ''}
        ${narrAheadItems ? `<h5 class="intel-sub-h">叙事超前</h5><ul class="intel-narr-list">${narrAheadItems}</ul>` : ''}
        ${narrCompartment}
        ${narrSir}
        ${narrTxEdges ? `<h5 class="intel-sub-h">传染路径</h5><ul class="intel-narr-tx-list">${narrTxEdges}</ul>` : ''}
        ${narrR0 ? `<h5 class="intel-sub-h">主题 R₀</h5><ul class="intel-narr-r0-list">${narrR0}</ul>` : ''}
        ${narrClusters ? `<h5 class="intel-sub-h">主题簇</h5><ul class="intel-narr-clusters">${narrClusters}</ul>` : ''}
        ${hzItems ? `<h5 class="intel-sub-h">尺度冲突</h5><ul class="intel-hz-list">${hzItems}</ul>` : ''}
        ${hzQs ? `<h5 class="intel-sub-h">尺度问</h5><ul class="intel-hz-q">${hzQs}</ul>` : ''}
        ${freshItems ? `<h5 class="intel-sub-h">证据滞后</h5><ul class="intel-fresh-list">${freshItems}</ul>` : ''}
        ${triadItems ? `<h5 class="intel-sub-h">温度·硬度·贴合</h5><ul class="intel-triad-list">${triadItems}</ul>` : ''}
        ${cmatrixLine}
        ${cmatrixItems ? `<h5 class="intel-sub-h">主矛盾×反对力</h5><ul class="intel-cmatrix-list">${cmatrixItems}</ul>` : ''}
        ${cmatrixQs ? `<h5 class="intel-sub-h">矛盾问</h5><ul class="intel-cmatrix-q">${cmatrixQs}</ul>` : ''}
        ${memLine ? `<h5 class="intel-sub-h">记忆检索回放</h5>${memSearchBox}` : ''}
        ${memTimelines ? `<ul class="intel-mem-tl-list">${memTimelines}</ul>` : ''}
        ${memRevs ? `<ul class="intel-mem-rev-list">${memRevs}</ul>` : ''}
        ${isoLine}${dualBoardLine}
        ${canonicalItems ? `<h5 class="intel-sub-h">同构监视</h5><ul class="intel-canonical-list">${canonicalItems}</ul>` : ''}
        ${isoReplayItems ? `<h5 class="intel-sub-h">路径回放</h5><ul class="intel-iso-replay-list">${isoReplayItems}</ul>` : ''}
        ${isoQs ? `<h5 class="intel-sub-h">同构问</h5><ul class="intel-iso-q">${isoQs}</ul>` : ''}
        ${dualSplitItems ? `<h5 class="intel-sub-h">内外分裂</h5><ul class="intel-dual-split-list">${dualSplitItems}</ul>` : ''}
        ${dualQs ? `<h5 class="intel-sub-h">双轨问</h5><ul class="intel-dual-q">${dualQs}</ul>` : ''}
        ${evAuditLine}
        ${evAuditItems ? `<h5 class="intel-sub-h">证据问题</h5><ul class="intel-ev-audit-list">${evAuditItems}</ul>` : ''}
        ${evAuditQs ? `<h5 class="intel-sub-h">证据问</h5><ul class="intel-ev-audit-q">${evAuditQs}</ul>` : ''}
        ${rtBoardLine}
        ${rtBoardItems ? `<h5 class="intel-sub-h">红队反对</h5><ul class="intel-rt-board-list">${rtBoardItems}</ul>` : ''}
        ${rtBoardQs ? `<h5 class="intel-sub-h">红队问</h5><ul class="intel-rt-board-q">${rtBoardQs}</ul>` : ''}
      </div>
      <div class="intel-center-cell intel-cell-memory" id="intel-cell-revisions">
        <h4>${escapeHtml(voiceTitles.museum || '失效博物馆 / 改口')}</h4>
        ${museumLine}
        <ul class="intel-museum-list">${museumItems || '<li>暂无证伪记录</li>'}</ul>
        ${museumIntakeLine}
        ${museumIntakeItems ? `<ul class="intel-museum-intake-list">${museumIntakeItems}</ul>` : ''}
        ${museumWarnItems ? `<h5 class="intel-sub-h">现役邻近警告</h5><ul class="intel-museum-warn-list">${museumWarnItems}</ul>` : ''}
        ${museumLessons ? `<h5 class="intel-sub-h">教训分型</h5><ul class="intel-museum-lesson-list">${museumLessons}</ul>` : ''}
        ${museumQs ? `<h5 class="intel-sub-h">博物馆问</h5><ul class="intel-museum-q">${museumQs}</ul>` : ''}
        <ul class="intel-revision-list">${revisionItems || ''}</ul>
      </div>
      <div class="intel-center-cell intel-cell-debt">
        <h4>${escapeHtml(voiceTitles.debt || '问题债务 / Unknown / 议题')}</h4>
        <p class="intel-debt-summary">${escapeHtml(debt.display || '扫描中')}</p>
        ${debt.opsPlan?.display ? `<p class="intel-debt-ops-line">${escapeHtml(debt.opsPlan.display)}</p>` : ''}
        ${debt.opsLast?.display ? `<p class="intel-debt-ops-last">上次：${escapeHtml(debt.opsLast.display)}</p>` : ''}
        ${debt.weeklyMustPay?.length ? `<ul class="intel-debt-pay">${debt.weeklyMustPay.map((d) => `<li>${escapeHtml(d.instrumentName || d.instrumentId)} · ${escapeHtml(d.label || d.type)}${d.opsLabel ? ` · ${escapeHtml(d.opsLabel)}` : ''}${d.opsRunnable ? ' · 可执行' : ' · 须人工'}${d.dueBy ? ` · 到期 ${escapeHtml(d.dueBy)}` : ''}${d.owner ? ` · ${escapeHtml(d.owner)}` : ''}${d.nDisplay ? ` · n=${escapeHtml(String(d.nDisplay))}` : ''}</li>`).join('')}</ul>` : ''}
        ${debt.opsPlan?.pendingRunnable > 0 ? `<p class="intel-debt-ops-actions"><button type="button" class="intel-debt-ops-btn" data-action="intel-debt-ops-run" data-max="3">执行本周必还（最多3）</button> <button type="button" class="intel-debt-ops-btn intel-debt-ops-dry" data-action="intel-debt-ops-dry" data-max="3">演练</button></p>` : ''}
        ${debt.weeklyPlan?.note ? `<p class="intel-debt-plan-note">${escapeHtml(debt.weeklyPlan.note)}</p>` : ''}
        ${unknownLine}
        ${unknownPayItems ? `<ul class="intel-unknown-pay">${unknownPayItems}</ul>` : ''}
        ${issueLine}
        <ul class="intel-issue-list">${issueItems || '<li>暂无议题归档</li>'}</ul>
        ${claimSharpLine}
        ${claimSharpItems ? `<h5 class="intel-sub-h">待锐化/软模板</h5><ul class="intel-claim-sharp-list">${claimSharpItems}</ul>` : ''}
        ${scenBoardLine}
        ${scenBoardItems ? `<h5 class="intel-sub-h">场景脚本偏重</h5><ul class="intel-scen-board-list">${scenBoardItems}</ul>` : ''}
        ${briefLine}
        ${briefItems ? `<h5 class="intel-sub-h">可导出简报</h5><ul class="intel-brief-list">${briefItems}</ul>` : ''}
        ${journalLine}
        ${journalToday ? `<h5 class="intel-sub-h">近期标注</h5><ul class="intel-journal-list">${journalToday}</ul>` : ''}
        ${journalFrozen ? `<h5 class="intel-sub-h">现役冻结</h5><ul class="intel-journal-frozen-list">${journalFrozen}</ul>` : ''}
        ${pbLine}${kpiLine}
        ${kpiPanelHtml}
        ${pbTransitions ? `<h5 class="intel-sub-h">剧本转移</h5><ul class="intel-pb-transition-list">${pbTransitions}</ul>` : ''}
        ${pbQs ? `<h5 class="intel-sub-h">剧本问</h5><ul class="intel-pb-q">${pbQs}</ul>` : ''}
        ${faceComputeLine}
        ${faceComputeItems ? `<ul class="intel-face-compute-list">${faceComputeItems}</ul>` : ''}
        ${rationLine}
        ${rationWakeItems ? `<h5 class="intel-sub-h">静默唤醒</h5><ul class="intel-attn-wake-list">${rationWakeItems}</ul>` : ''}
        ${procPanel}
        ${compilePanel}
      </div>
    </div>`;

  const execGrid = `
    <div class="intel-center-grid intel-face-panel" data-face-panel="execution">
      <div class="intel-center-cell">
        <h4>证伪时钟 / 触发器</h4>
        <p class="intel-diff-summary">点选品种后在决策备忘录查看触发器与有效期。已证伪 ${stats.falsified ?? 0} · 证伪中 ${stats.falsifying ?? 0}</p>
        <ul class="intel-interrupt-list">${interrupts || '<li>暂无打断级改口</li>'}</ul>
      </div>
      <div class="intel-center-cell">
        <h4>定价状态优先</h4>
        ${pcLine || `<p class="intel-diff-summary">mispriced ${stats.mispriced ?? 0} · 优先红队与深度队列</p>`}
        ${pcMis ? `<h5 class="intel-sub-h">定价背离</h5><ul class="intel-pc-mis-list">${pcMis}</ul>` : ''}
        ${pcDue ? `<h5 class="intel-sub-h">证伪临近</h5><ul class="intel-pc-due-list">${pcDue}</ul>` : ''}
        ${pcQs ? `<h5 class="intel-sub-h">定价/时钟问</h5><ul class="intel-pc-q">${pcQs}</ul>` : ''}
        <ol class="intel-p0-list">${p0 || '<li class="intel-empty">暂无 P0</li>'}</ol>
      </div>
      <div class="intel-center-cell">
        <h4>班次纪律 / 反操纵</h4>
        ${discLine || `<p class="intel-diff-summary">${escapeHtml(shift.display || '—')} · ${escapeHtml(shift.tone || view.shiftContract?.tone || '')}</p>`}
        ${view.shiftContract ? `<p class="intel-contract-line">契约 ${escapeHtml(view.shiftContract.deliveryContract)} · 风格 ${escapeHtml(view.shiftContract.outputStyle)}</p>` : ''}
        ${discRules ? `<ul class="intel-disc-rules">${discRules}</ul>` : ''}
        ${discViolations ? `<h5 class="intel-sub-h">违规处置</h5><ul class="intel-disc-viol-list">${discViolations}</ul>` : ''}
        ${(disc?.discipline || []).length ? `<p class="intel-disc-tags">${escapeHtml((disc.discipline || []).join(' · '))}</p>` : ''}
        ${manipLine}
        ${manipItems ? `<ul class="intel-manip-list">${manipItems}</ul>` : ''}
        ${manipQs ? `<h5 class="intel-sub-h">操纵问</h5><ul class="intel-manip-q">${manipQs}</ul>` : ''}
        ${faceContractLine}
        ${quiet ? '<p class="intel-quiet-note">静默日 · 执行层以观望为主</p>' : ''}
      </div>
    </div>`;

  const activeFaceGrid =
    face === 'research' ? researchGrid : face === 'execution' ? execGrid : decisionGrid;

  return `<section class="intel-center-hub${quietCls}" aria-label="情报中心" id="intel-center-hub-root" data-intel-pack-ver="${escapeAttr(pack.version || '')}" data-intel-face="${escapeAttr(face)}" data-intel-face-rail="1" data-intel-shell="${escapeAttr(shellLayoutId)}" data-shift-voice="${escapeAttr(shiftVoice?.voiceId || view.shiftContract?.voiceId || '')}">
    <header class="intel-center-head intel-shell-head">
      <h3 class="intel-center-title">情报中心 · ${escapeHtml(face === 'research' ? '研究壳' : face === 'execution' ? '执行壳' : '决策壳')} <span class="intel-center-ver">${escapeHtml(pack.version || '')}</span></h3>
      <span class="intel-center-stats">${statsHeader}</span>
    </header>
    ${faceTabs}
    ${faceContractLine}${deliveryBriefLine}${faceRailLine}${pageToneLine}${shiftVoiceLine}
    ${fiveCmds}
    ${shellChrome}
    ${face === 'research' ? `${faceAttnLine}${faceRetriageLine}${faceComputeLine}${rationLine}${evAuditLine}${antiPatLine}${llmBoundLine}${qualityDebtLine}${qualityDebtCalibLine}${rtBoardLine}${compileLine}${unknownLine}${resonanceLine}${narrLine}${narrCompartment}${narrSir}${edgeCatalogLine}${sharedMechLine}${freshLine}${triadLine}${cmatrixLine}${memLine}${hzLine}${mhLine}${mechLine}${isoLine}${dualBoardLine}${museumLine}${attnLine}${dualLine}${calLine}${procLine}${pbLine}${issueLine}${claimSharpLine}${scenBoardLine}${briefLine}${journalLine}${debtLine}${teachLine}` : face === 'execution' ? `${pcLine}${ichLine}${discLine}${manipLine}${contractLine}${qbLine}${brakeNote}` : `${faceAttnLine}${calLine}${ichLine}${metaLine}${qbLine}${brakeNote}${contractLine}${antiPatLine}${llmBoundLine}${qualityDebtLine}${commanderLine}${teachLine}`}
    ${face === 'research' && teachItems ? `<ul class="intel-teach-list">${teachItems}</ul>` : ''}
    ${face === 'research' && antiPatItems ? `<ul class="intel-anti-pattern-list">${antiPatItems}</ul>` : ''}
    ${face === 'decision' && antiPatItems ? `<ul class="intel-anti-pattern-list intel-anti-pattern-strip">${antiPatItems}</ul>` : ''}
    ${face === 'research' && qualityDebtItems ? `<ul class="intel-quality-debt-list">${qualityDebtItems}</ul>` : ''}
    ${face === 'research' && qualityDebtRepayItems ? `<ul class="intel-quality-debt-repay-list">${qualityDebtRepayItems}</ul>` : ''}
    ${ichItems && face !== 'research' ? `<ul class="intel-ich-list" id="intel-ich-list">${ichItems}</ul>` : ''}
    ${activeFaceGrid}
  </section>`;
}

function renderIntelCenterMemoBlock(inst) {
  const ic = inst?.intelCenter;
  const memo = ic?.memo;
  const sf = ic?.staffFace;
  const staffBanner = sf?.banner
    ? `<p class="intel-staff-banner intel-staff-${escapeAttr(sf.mode || 'observe')}" title="${escapeAttr(sf.display || '')}">${escapeHtml(sf.banner)}</p>`
    : '';
  const staffCls = sf?.mode ? ` intel-memo-staff-${escapeAttr(sf.mode)}` : '';
  if (!memo?.available) {
    return `<div class="intel-memo-block intel-memo-unavailable${staffCls}">
      ${renderOutlookSectionHead('决策备忘录', 'intelMemo', inst?.id)}
      ${staffBanner}
      <p class="intel-memo-empty">暂无 · ${escapeHtml(memo?.reason || ic?.reason || '命题未构建')}</p>
    </div>`;
  }
  const support = (memo.support || [])
    .map((s) => `<li><span class="intel-ev-for">+</span> ${escapeHtml(s.summary)} <span class="intel-ev-src">${escapeHtml(s.dataSource || '')}${s.n && s.n !== '暂无' ? ` · n=${escapeHtml(s.n)}` : ''}</span></li>`)
    .join('');
  const oppose = (memo.oppose || [])
    .map((s) => `<li><span class="intel-ev-against">−</span> ${escapeHtml(s.summary)} <span class="intel-ev-src">${escapeHtml(s.dataSource || '')}${s.n && s.n !== '暂无' ? ` · n=${escapeHtml(String(s.n))}` : s.nDisplay && s.nDisplay !== '暂无' ? ` · n=${escapeHtml(String(s.nDisplay))}` : ' · n=暂无'}</span></li>`)
    .join('');
  const triggers = (memo.triggers || []).map((t) => `<li class="intel-trigger">${escapeHtml(t)}</li>`).join('');
  const gaps = (() => {
    const um = memo.unknownMap || ic.unknownMap;
    if (!um) return '';
    const items = (um.gaps || []).slice(0, 6);
    if (!items.length && um.display) {
      return `<p class="intel-unknown">${escapeHtml(um.display)}</p>`;
    }
    if (!items.length) return '';
    const lis = items
      .map((g) => {
        const path = g.shortestPath || g.remedy || '暂无';
        return `<li class="intel-unknown-item impact-${escapeAttr(g.impact || 'low')}"><strong>${escapeHtml(g.label)}</strong> · ${escapeHtml(g.impact || '')} · 补齐 ${escapeHtml(path)}${g.etaHint ? ` · ${escapeHtml(g.etaHint)}` : ''}</li>`;
      })
      .join('');
    return `<div class="intel-unknown-map"><p class="intel-unknown-head"><strong>Unknown Map</strong> ${escapeHtml(um.display || '')}${um.confidenceHaircutDisplay ? ` · ${escapeHtml(um.confidenceHaircutDisplay)}` : ''}</p><ul class="intel-unknown-list">${lis}</ul>${
      um.nextAction
        ? `<p class="intel-unknown-next">下一步：${escapeHtml(um.nextAction.path || um.nextAction.label || '—')}</p>`
        : ''
    }</div>`;
  })();
  const push = ic.pushTier;
  const pushCls = push?.tier ? ` intel-push-${escapeAttr(push.tier)}` : '';
  const gate = memo.publishable ? '可发布' : '门禁未过';
  const memoExport = ic.memoExport;
  const exportBtns = `<div class="intel-memo-export-bar">
    <button type="button" class="intel-memo-export-btn" data-action="intel-memo-copy-plain" data-instrument="${escapeAttr(inst.id)}" title="复制纯文本简报">复制简报</button>
    <button type="button" class="intel-memo-export-btn" data-action="intel-memo-copy-md" data-instrument="${escapeAttr(inst.id)}" title="复制 Markdown">复制 MD</button>
    ${memoExport?.publishable === false ? '<span class="intel-memo-export-warn">门禁未过 · 仅内部</span>' : ''}
    ${memoExport?.honesty?.length ? `<span class="intel-memo-export-honesty">${escapeHtml(memoExport.honesty[0])}</span>` : ''}
  </div>`;
  const scenarios = (ic.scenarioLattice?.scenarios || [])
    .slice(0, 4)
    .map((s) => {
      const band = s.probabilityBand || '暂无';
      const calibrated = ic.scenarioLattice?.weightsCalibrated === true && !s.scripted;
      const w =
        calibrated && s.weight != null
          ? ` · 权 ${(Number(s.weight) * 100).toFixed(0)}%`
          : ' · 权 暂无';
      const bindN = (s.evidenceBindings || []).length;
      const bindBit = s.scripted
        ? ' · 脚本占位'
        : bindN
          ? ` · 绑证${bindN}`
          : '';
      const trig = s.trigger ? ` · 触发 ${String(s.trigger).slice(0, 28)}` : '';
      const aff = s.affectedDisplay && s.affectedDisplay !== '波及暂无' ? ` · ${s.affectedDisplay}` : '';
      return `<li class="${s.scripted ? 'intel-scen-scripted' : ''}"><strong>${escapeHtml(s.label)}</strong> · ${escapeHtml(band)}${escapeHtml(w)}${escapeHtml(bindBit)}${escapeHtml(trig)}${escapeHtml(aff)} · ${escapeHtml((s.description || '—').slice(0, 40))}</li>`;
    })
    .join('');
  const scenarioMeta = ic.scenarioLattice
    ? `<p class="intel-scenario-meta">场景权 n=${escapeHtml(ic.scenarioLattice.nDisplay || '暂无')}${
        ic.scenarioLattice.weightsCalibrated ? ' · 已校准' : ' · 未校准·禁止当概率'
      } · 绑证${escapeHtml(String(ic.scenarioLattice.boundCount ?? '—'))} · 脚本${escapeHtml(
        String(ic.scenarioLattice.scriptedCount ?? '—')
      )} · ${escapeHtml(ic.scenarioLattice.note || '')}</p>`
    : '';
  const redTeam = ic.redTeam;
  const redTeamHtml = redTeam?.available
    ? `<div class="intel-red-team"><h6>红队</h6><p class="intel-rt-display">${escapeHtml(redTeam.display || '—')}</p><ul class="intel-rt-args">${(redTeam.arguments || []).map((a) => `<li>${escapeHtml(a.summary)} <span class="intel-ev-src">${escapeHtml(a.dataSource || '')}${a.n ? ` · n=${a.n}` : ''}</span></li>`).join('')}</ul></div>`
    : '';
  const horizon = ic.horizonCoordination;
  const horizonHtml = horizon?.hasConflict
    ? `<div class="intel-horizon-conflict-block"><p class="intel-horizon-conflict"><strong>尺度冲突</strong> ${escapeHtml(horizon.display || horizon.headline || '—')}</p>${
        (horizon.conflicts || [])
          .slice(0, 3)
          .map((c) => `<p class="intel-horizon-detail">${escapeHtml(c.display)} · ${escapeHtml(c.actionHint || c.resolution || '')}</p>`)
          .join('')
      }${
        horizon.claimsByHorizon
          ? `<ul class="intel-horizon-sides">${['tactical', 'structural', 'paradigm']
              .map((h) => {
                const s = horizon.claimsByHorizon[h];
                if (!s) return `<li>${escapeHtml(h)}：暂无</li>`;
                return `<li>${escapeHtml(h)}：${escapeHtml(s.sideLabel || s.side || '—')} · ${escapeHtml(s.confidence || '')} · n ${escapeHtml(s.nDisplay || '暂无')}</li>`;
              })
              .join('')}</ul>`
          : ''
      }</div>`
    : horizon?.headline
      ? `<p class="intel-horizon-ok">${escapeHtml(horizon.display || horizon.headline)}</p>`
      : '';
  const multiHop = ic.multiHop;
  const multiHopHtml = multiHop?.display && multiHop.display !== '暂无多跳'
    ? `<p class="intel-mh-memo${multiHop.laggingCount > 0 ? ' lagging' : ''}"><strong>多跳</strong> ${escapeHtml(multiHop.display)}${
        (multiHop.asSink || multiHop.asSource || [])
          .slice(0, 2)
          .map((p) => ` · ${escapeHtml(p.text || '')}`)
          .join('') || ''
      }</p>`
    : '';
  const narrative = ic.narrative;
  const narrativeHtml = narrative?.phase && narrative.phase !== 'dormant'
    ? `<p class="intel-narrative intel-narrative-${escapeAttr(narrative.phase)}">叙事 ${escapeHtml(narrative.display || narrative.label || '—')}${narrative.contagion?.nDisplay && narrative.contagion.nDisplay !== '暂无' ? ` · 窗 n=${escapeHtml(narrative.contagion.nDisplay)}` : ''}${narrative.transmission?.roleLabel && narrative.transmission.roleLabel !== '传播角色暂无' ? ` · ${escapeHtml(narrative.transmission.roleLabel)}${narrative.transmission.R0Display && narrative.transmission.R0Display !== '暂无' ? ` R₀ ${escapeHtml(narrative.transmission.R0Display)}` : ''}` : ''}${narrative.alert ? ` · ${escapeHtml(narrative.alert)}` : ''}</p>`
    : '';
  const canonical = ic.canonicalCases;
  const canonicalHtml = canonical?.inIsomorphicWatch
    ? `<p class="intel-canonical">${escapeHtml(canonical.display || '')}</p>`
    : '';
  const dual = ic.dualNarrative;
  const dualHtml = dual?.available
    ? `<p class="intel-dual-narrative intel-dual-${escapeAttr(dual.regime || '')}"><strong>内外双轨</strong> ${escapeHtml(dual.display || '—')}${
        dual.macroClimate?.available ? ` · 宏观 ${escapeHtml((dual.macroClimate.display || '').slice(0, 64))}` : ''
      }</p>`
    : dual?.mapped === false
      ? `<p class="intel-dual-narrative intel-dual-unmapped"><strong>内外双轨</strong> 本品种无外盘锚点</p>`
      : '';
  const pb = ic.playbook;
  const pbAlts = (pb?.alternatives || [])
    .filter((a) => a.role !== 'rejected')
    .slice(0, 5)
    .map(
      (a) =>
        `<button type="button" class="intel-pb-btn${a.id === pb.activeId ? ' active' : ''}" data-action="intel-playbook-pin" data-instrument="${escapeAttr(inst.id)}" data-playbook="${escapeAttr(a.id)}" title="指定 ${escapeAttr(a.id)}">${escapeHtml(a.id)}</button>`
    )
    .join('');
  const pbHtml = pb?.available
    ? `<div class="intel-playbook-block"><p class="intel-playbook-line"><strong>Playbook</strong> ${escapeHtml(pb.display || '—')}</p>${
        pb.scriptPack
          ? `<p class="intel-pb-script">结构包 ${escapeHtml(pb.scriptPack.title || pb.scriptPack.id)} · ${escapeHtml(
              pb.scriptPack.mainContradiction || pb.scriptPack.enterNote || ''
            )}</p>`
          : ''
      }${
        pb.regimeFlip || pb.whatChanged
          ? `<p class="intel-pb-flip"><strong>what-changed</strong> ${escapeHtml(pb.whatChanged || '合证regime翻转')}</p>`
          : ''
      }${
        pb.weightGate && pb.weightGate.allowed === false
          ? `<p class="intel-pb-weight-gate">过程权门禁 · ${escapeHtml(pb.weightGate.note || '暂无')}</p>`
          : ''
      }${
        pbAlts ? `<div class="intel-pb-switcher">${pbAlts}<button type="button" class="intel-pb-btn" data-action="intel-playbook-clear" data-instrument="${escapeAttr(inst.id)}">恢复自动</button></div>` : ''
      }</div>`
    : '';
  const tree = ic.claimTree;
  const treeHtml = tree?.display
    ? `<p class="intel-claim-tree"><strong>命题树</strong> ${escapeHtml(tree.display)}${
        ic.primaryClaim?.epochDisplay ? ` · ${escapeHtml(ic.primaryClaim.epochDisplay)}` : ''
      }${ic.primaryClaim?.sharp === true ? ' · 锐利' : ic.primaryClaim?.sharpness === 'soft' ? ' · 软模板' : ''}${
        tree.byHorizon
          ? ` · ${['paradigm', 'structural', 'tactical']
              .map((h) => {
                const n = tree.byHorizon[h];
                if (!n) return null;
                return `${h.slice(0, 3)}:${n.available === false ? '暂无' : n.status || '—'}`;
              })
              .filter(Boolean)
              .join(' / ')}`
          : ''
      }</p>`
    : '';
  const atomicLine = ic.primaryClaim?.atomic?.predicate
    ? `<p class="intel-claim-atomic"><strong>原子</strong> ${escapeHtml(ic.primaryClaim.atomic.predicate)}${
        ic.primaryClaim.atomic.observable?.value != null
          ? ` · 观测 ${escapeHtml(String(ic.primaryClaim.atomic.observable.value))}`
          : ''
      }${
        ic.primaryClaim.otherwiseFalsify
          ? ` · ${escapeHtml(ic.primaryClaim.otherwiseFalsify)}`
          : ''
      }</p>`
    : '';
  const mechLinks = (memo.mechanismLinks || ic.primaryClaim?.mechanismLinks || [])
    .map((l) => `${l.step}:${l.available ? l.label : '暂无'}`)
    .join(' → ');
  const mechHtml =
    memo.mechanismChain || mechLinks
      ? `<p class="intel-mech-line"><strong>机制链</strong> ${escapeHtml(mechLinks || memo.mechanismChain || '—')} · 深度 ${escapeHtml(
          memo.mechanismDepthDisplay || ic.primaryClaim?.mechanismDepthDisplay || '暂无'
        )}</p>`
      : '';
  const manip = ic.antiManipulation;
  const manipHtml = manip?.flagged
    ? `<p class="intel-manip-flag"><strong>操纵纪律</strong> ${escapeHtml(manip.display || '硬旗生效')}${
        (manip.autoSignals || []).length
          ? ` · 自动 ${(manip.autoSignals || []).map((s) => s.label).slice(0, 2).join('/')}`
          : ''
      }</p>`
    : manip?.softWatch || manip?.autoSuspect
      ? `<p class="intel-manip-flag soft"><strong>操纵观察</strong> ${escapeHtml(manip.display || '待人审')}</p>`
      : '';
  const attn = ic.attention;
  const attnHtml = attn?.display
    ? `<p class="intel-attn-depth"><strong>注意力</strong> ${escapeHtml(attn.display)}</p>`
    : '';
  const res = ic.resonance;
  const resonanceHtml = res?.display
    ? `<p class="intel-resonance-memo"><strong>跨品种</strong> ${escapeHtml(res.display)}${
        res.diverge?.[0] ? ` · ${escapeHtml(res.diverge[0].reason || res.diverge[0].label || '')}` : ''
      }</p>`
    : '';
  const procReady = ic.processReadiness;
  const procReadyHtml = procReady?.display
    ? `<p class="intel-proc-ready${procReady.processReady ? ' ok' : ' weak'}"><strong>过程就绪</strong> ${escapeHtml(procReady.display)}</p>`
    : '';
  const narrIc = ic.narrative;
  const narrHtml = narrIc?.narrativeAhead
    ? `<p class="intel-narr-memo ahead"><strong>叙事</strong> ${escapeHtml(narrIc.display || '超前于结构')}</p>`
    : narrIc?.display && narrIc.phase !== 'dormant'
      ? `<p class="intel-narr-memo"><strong>叙事</strong> ${escapeHtml(narrIc.display)}</p>`
      : '';
  const freshIc = ic.evidenceFreshness;
  const freshHtml = freshIc?.display
    ? `<p class="intel-fresh-memo${freshIc.blocksInterrupt ? ' block' : ''}"><strong>证据新鲜度</strong> ${escapeHtml(freshIc.display)}</p>`
    : '';
  const triadIc = ic.evidenceTriad;
  const triadHtml = triadIc?.display
    ? `<p class="intel-triad-memo${triadIc.blocksInterrupt ? ' block' : ''}"><strong>证据三轴</strong> ${escapeHtml(triadIc.display)}${
        triadIc.averages
          ? ` · 温${escapeHtml(triadIc.averages.temperatureDisplay || '暂无')}/硬${escapeHtml(triadIc.averages.hardnessDisplay || '暂无')}/贴${escapeHtml(triadIc.averages.relevanceDisplay || '暂无')}`
          : ''
      }</p>`
    : '';
  const choiceSet = ic.choiceSet || memo.choiceSet;
  const choiceHtml = choiceSet?.options?.length
    ? `<div class="intel-choice-set" aria-label="可执行选择集">
      <p class="intel-choice-head"><strong>选择集</strong> ${escapeHtml(choiceSet.display || '')} · n ${escapeHtml(choiceSet.nDisplay || '暂无')}</p>
      <ul class="intel-choice-list">${choiceSet.options
        .map((o) => {
          const primary = o.id === choiceSet.primaryId ? ' primary' : '';
          const enter = (o.enterWhen || []).slice(0, 2).map((t) => escapeHtml(t)).join('；');
          const exit = (o.exitWhen || []).slice(0, 2).map((t) => escapeHtml(t)).join('；');
          const w =
            o.weightBand && o.weightBand !== '暂无'
              ? ` · 权 ${escapeHtml(o.weightBand)}`
              : ' · 权 暂无';
          return `<li class="intel-choice-opt${primary}"><span class="intel-choice-id">${escapeHtml(o.id)}</span> <strong>${escapeHtml(o.label)}</strong>${w}<br/><span class="intel-choice-why">${escapeHtml(o.why || '')}</span><br/><span class="intel-choice-trig">进：${enter || '暂无'} · 出：${exit || '暂无'}</span></li>`;
        })
        .join('')}</ul>
      <p class="intel-choice-note">${escapeHtml(choiceSet.note || '')}</p>
    </div>`
    : '';

  return `<div class="intel-memo-block intel-memo-staff-page${staffCls}" data-memo-primary="1">
    ${renderOutlookSectionHead('决策备忘录 · 情报中心', 'intelMemo', inst.id)}
    ${staffBanner}
    ${exportBtns}
    <div class="intel-memo-hard" data-hard-template="1">
      <div class="intel-memo-head">
        <span class="intel-belief">${escapeHtml(ic.beliefLevel || '—')}</span>
        ${sf?.modeLabel ? `<span class="intel-staff-mode intel-staff-${escapeAttr(sf.mode || '')}" title="${escapeAttr(sf.display || '')}">${escapeHtml(sf.modeLabel)}</span>` : ''}
        <span class="intel-claim-status intel-status-${escapeAttr(ic.primaryClaim?.status || '')}">${escapeHtml(ic.primaryClaim?.status || '—')}</span>
        <span class="intel-pricing intel-pricing-${escapeAttr(ic.pricingState?.state || 'unknown')}">${escapeHtml(memo.pricingState || '待校验')}</span>
        <span class="intel-clock">${escapeHtml(ic.clock?.display || memo.falsifyTrigger || '—')}</span>
        <span class="intel-push-tier${pushCls}">${escapeHtml(push?.tierLabel || '静默')}</span>
        <span class="intel-gate" title="${escapeAttr((memo.gateProfile?.blockedReasons || []).join('、'))}">${escapeHtml(gate)}</span>
      </div>
      <p class="intel-memo-headline">${escapeHtml(memo.headline || '—')}</p>
      <p class="intel-memo-oneliner">${escapeHtml(memo.oneLiner || '')}</p>
      <div class="intel-memo-cols">
        <div class="intel-memo-col">
          <h6>三支撑</h6>
          <ul class="intel-ev-list">${support || '<li>暂无</li>'}</ul>
        </div>
        <div class="intel-memo-col">
          <h6>一反对</h6>
          <ul class="intel-ev-list intel-ev-against-list">${oppose || '<li>暂无 · 门禁将阻断 Interrupt</li>'}</ul>
        </div>
      </div>
      <div class="intel-memo-triggers">
        <h6>触发器 · 有效期至 ${escapeHtml(memo.validUntil || '—')}</h6>
        <ul>${triggers || '<li>暂无</li>'}</ul>
      </div>
      ${gaps}
      <p class="intel-memo-action"><strong>建议动作</strong> ${escapeHtml(memo.suggestedAction?.label || choiceSet?.primary?.label || '—')} · ${escapeHtml(memo.suggestedAction?.condition || memo.suggestedAction?.why || '')}</p>
    </div>
    <details class="intel-memo-extras">
      <summary>扩展上下文（双轨/剧本/三轴/检索/工作台）</summary>
    ${
      ic?.faceProjection?.note
        ? `<p class="intel-face-proj-note"><strong>面孔投影</strong> ${escapeHtml(ic.faceProjection.label || '')} · ${escapeHtml(ic.faceProjection.note)}</p>`
        : ''
    }
    ${
      memo.whatChanged
        ? `<p class="intel-memo-what-changed"><strong>what-changed</strong> ${escapeHtml(memo.whatChanged)}</p>`
        : ''
    }
    ${dualHtml}${pbHtml}${treeHtml}${atomicLine}${mechHtml}${manipHtml}${attnHtml}${resonanceHtml}${procReadyHtml}${narrHtml}${freshHtml}${triadHtml}
    ${choiceHtml}
    ${(() => {
      const ret = memo.retrieval || ic.retrieval;
      if (!ret) return '';
      const arch = (ret.archive?.hits || [])
        .map(
          (h) =>
            `<li class="intel-ret-arch"><span class="intel-ret-tag">档案</span> ${escapeHtml(h.match || '')} · ${escapeHtml((h.statement || '').slice(0, 56))} · n=${escapeHtml(h.nDisplay || '暂无')}</li>`
        )
        .join('');
      const mus = (ret.museum?.hits || [])
        .map(
          (h) =>
            `<li class="intel-ret-mus"><span class="intel-ret-tag">馆</span> ${escapeHtml(h.lessonLabel || '')} · ${escapeHtml((h.statement || '').slice(0, 56))}${h.falsifiedAt ? ` · ${escapeHtml(h.falsifiedAt)}` : ''}</li>`
        )
        .join('');
      const iso = (ret.isomorphic?.hits || [])
        .map(
          (h) =>
            `<li class="intel-ret-iso"><span class="intel-ret-tag">同构</span> ${escapeHtml(h.label || '')} · ${escapeHtml(h.pathTierLabel || h.match || '')} · 路径n=${escapeHtml(h.pathNDisplay || '暂无')}</li>`
        )
        .join('');
      const body = arch || mus || iso
        ? `<ul class="intel-retrieval-list">${arch}${mus}${iso}</ul>`
        : `<p class="intel-retrieval-empty">暂无先例</p>`;
      return `<div class="intel-retrieval-block" aria-label="检索召回"><p class="intel-retrieval-head"><strong>检索召回</strong> ${escapeHtml(ret.display || '')} · n=${escapeHtml(ret.nDisplay || '暂无')}</p>${body}</div>`;
    })()}
    ${horizonHtml}${multiHopHtml}${narrativeHtml}${canonicalHtml}
    ${redTeamHtml}
    ${scenarios ? `<details class="intel-scenarios"><summary>场景格</summary>${scenarioMeta}<ul>${scenarios}</ul></details>` : ''}
    ${renderIntelAnalystWorkbench(inst)}
    <p class="intel-memo-meta">issue ${escapeHtml(ic.primaryClaim?.issueId || '—')} · claim ${escapeHtml(memo.claimId || '—')} · release ${escapeHtml(ic.releaseId || '—')} · n ${escapeHtml(memo.n || '暂无')} · surprise n ${escapeHtml(ic.surprise?.nDisplay || '暂无')} · ${escapeHtml(memo.method || '')}${ic.confidenceBrakeForced ? ' · 自信刹车降档' : ''}${ic.primaryClaim?.manipulationDowngraded ? ' · 操纵降档' : ''}</p>
    </details>
  </div>`;
}

function renderIntelAnalystWorkbench(inst) {
  const ic = inst?.intelCenter;
  const claimId = ic?.primaryClaim?.claimId || '';
  const id = inst?.id || '';
  const display = ic?.analyst?.display || '无标注';
  const types = [
    ['reliable', '可靠'],
    ['noise', '噪音'],
    ['manipulation_risk', '操纵风险'],
    ['pin_trigger', '置顶触发器'],
    ['freeze_claim', '冻结'],
    ['veto', '否决'],
  ];
  const btns = types
    .map(
      ([t, label]) =>
        `<button type="button" class="intel-ann-btn" data-action="intel-annotate" data-instrument="${escapeAttr(id)}" data-claim="${escapeAttr(claimId)}" data-ann-type="${escapeAttr(t)}">${escapeHtml(label)}</button>`
    )
    .join('');
  const basis = ic?.basis || inst?.basis || inst?.factors?.basis;
  const basisLine = basis?.available
    ? `<p class="intel-basis-line"><strong>基差/期限</strong> ${escapeHtml(basis.label || '—')} · n=${escapeHtml(basis.nDisplay || '暂无')}</p>`
    : `<p class="intel-basis-line"><strong>基差/期限</strong> 暂无</p>`;
  return `<div class="intel-analyst-workbench">
    <h6>分析师工作台 · ${escapeHtml(display)}</h6>
    ${basisLine}
    <div class="intel-ann-btns">${btns}</div>
    <p class="intel-ann-hint">否决须填写理由（浏览器 prompt）；标注回写 reliability；可靠/噪音/操纵进权信号（n≥5 待人审，不静默改生效权）</p>
  </div>`;
}

function renderIntelCenterRowBadges(inst) {
  const ic = inst?.intelCenter;
  if (!ic?.available && !ic?.memo) return '';
  const push = ic.pushTier?.tier;
  const pricing = ic.pricingState?.state;
  const parts = [];
  const belief = ic.beliefLevel;
  if (belief) {
    const short =
      belief === '强结构' ? '强' : belief === '弱结构' ? '弱' : belief === '叙事分歧' ? '分歧' : belief === '不可判定' ? '不可判' : belief === '证伪进行中' ? '证伪中' : null;
    if (short) parts.push(`<span class="intel-badge intel-badge-belief" title="${escapeAttr(belief)}">${escapeHtml(short)}</span>`);
  }
  if (ic.staffFace?.mode && ic.staffFace.fortuneChromeAllowed === false) {
    parts.push(
      `<span class="intel-badge intel-badge-staff-${escapeAttr(ic.staffFace.mode)}" title="${escapeAttr(ic.staffFace.display || '')}">${escapeHtml(
        ic.staffFace.mode === 'observe' ? '观望面' : '备忘录面'
      )}</span>`
    );
  }
  if (push === 'interrupt') parts.push('<span class="intel-badge intel-badge-interrupt" title="打断级">打断</span>');
  else if (push === 'watch') parts.push('<span class="intel-badge intel-badge-watch" title="关注">关注</span>');
  if (pricing === 'mispriced') parts.push('<span class="intel-badge intel-badge-mispriced" title="定价背离">≠价</span>');
  if (ic.question?.priority === 'P0') parts.push('<span class="intel-badge intel-badge-p0" title="P0问题">P0</span>');
  if (ic.primaryClaim?.status === 'falsified') parts.push('<span class="intel-badge intel-badge-falsified" title="已证伪">已证伪</span>');
  else if (ic.primaryClaim?.status === 'falsifying') parts.push('<span class="intel-badge intel-badge-falsifying" title="证伪进行中">证伪中</span>');
  if (ic.antiManipulation?.flagged) parts.push('<span class="intel-badge intel-badge-manip" title="操纵硬旗">操纵</span>');
  else if (ic.antiManipulation?.softWatch || ic.antiManipulation?.autoSuspect)
    parts.push('<span class="intel-badge intel-badge-manip-soft" title="操纵观察">操纵观</span>');
  if (ic.dualBoard?.blockInterrupt || ic.dualNarrative?.regime === 'split') {
    parts.push('<span class="intel-badge intel-badge-dual-exec" title="内外分裂·禁Interrupt">内外裂</span>');
  } else if (ic.dualNarrative?.regime === 'resonate') {
    parts.push('<span class="intel-badge intel-badge-dual-resonate" title="内外共振">共振</span>');
  }
  if (ic.museumReview?.warning) {
    parts.push('<span class="intel-badge intel-badge-museum" title="失效博物馆现役邻近">馆警</span>');
  }
  if (ic.attention?.depth === 'deep') parts.push('<span class="intel-badge intel-badge-deep" title="今日深算">深</span>');
  if (ic.narrative?.narrativeAhead) parts.push('<span class="intel-badge intel-badge-narrative" title="叙事超前">叙</span>');
  if (ic.redTeam?.forceDowngrade) parts.push('<span class="intel-badge intel-badge-redteam" title="红队降档">红</span>');
  if (ic.choiceSet?.primaryId) {
    parts.push(
      `<span class="intel-badge intel-badge-choice" title="${escapeAttr(ic.choiceSet.display || '选择集')}">${escapeHtml(ic.choiceSet.primaryId)}</span>`
    );
  }
  if (ic.unknownMap?.hasCritical || ic.memo?.unknownMap?.hasCritical) {
    parts.push('<span class="intel-badge intel-badge-unknown" title="Unknown Map 关键缺口">缺</span>');
  }
  if (ic.resonance?.diverge?.length) {
    parts.push('<span class="intel-badge intel-badge-diverge" title="跨品种分化">分化</span>');
  } else if (ic.resonance?.lagging?.length) {
    parts.push('<span class="intel-badge intel-badge-lag" title="跨品种滞后">滞后</span>');
  }
  if (ic.processReadiness && !ic.processReadiness.processReady) {
    parts.push('<span class="intel-badge intel-badge-proc-weak" title="过程未就绪">过程弱</span>');
  } else if (ic.processReadiness?.processReady) {
    parts.push('<span class="intel-badge intel-badge-proc-ok" title="过程就绪">过程</span>');
  }
  if (ic.narrative?.narrativeAhead) {
    parts.push('<span class="intel-badge intel-badge-narr-ahead" title="叙事超前于结构">叙超</span>');
  }
  if (ic.evidenceFreshness?.blocksInterrupt) {
    parts.push('<span class="intel-badge intel-badge-fresh-block" title="证据严重滞后">证滞</span>');
  }
  if (ic.horizonCoordination?.hasConflict) {
    parts.push('<span class="intel-badge intel-badge-hz-conflict" title="三尺度冲突">尺度</span>');
  }
  if (ic.multiHop?.laggingCount > 0) {
    parts.push('<span class="intel-badge intel-badge-mh-lag" title="多跳滞后">多跳滞</span>');
  } else if (ic.multiHop?.liveCount > 0) {
    parts.push('<span class="intel-badge intel-badge-mh-live" title="活多跳">多跳</span>');
  }
  if (ic.isomorphicBoard?.strongCount > 0) {
    parts.push('<span class="intel-badge intel-badge-iso-strong" title="路径强同构">同构</span>');
  } else if (ic.canonicalCases?.inIsomorphicWatch) {
    parts.push('<span class="intel-badge intel-badge-canonical" title="同构监视">同构</span>');
  }
  return parts.join('');
}

function labelSideCn(side) {
  if (side === 'bull') return '多';
  if (side === 'bear') return '空';
  if (side === 'flat') return '中';
  return '—';
}

function renderOutlookActiveThesesBlock(inst) {
  const tg = inst?.tradingGuidance;
  if (!tg?.pilot) return '';
  const theses = inst?.macroSynthesis?.activeTheses || [];
  const hyps = inst?.competingHypotheses || inst?.contradictionMatrix?.competingHypotheses || [];
  const matrixHtml = inst?.contradictionMatrix
    ? renderContradictionMatrixBlock(inst.contradictionMatrix, { compact: true })
    : '';
  if (!theses.length && !hyps.length && !matrixHtml) {
    return `<div class="outlook-active-theses-block">
      ${renderOutlookSectionHead('活跃命题', 'activeTheses', inst.id)}
      <p class="outlook-thesis-empty">暂无 · registry 待抓取</p>
    </div>`;
  }
  const rows = theses
    .map((t) => {
      const seedTag = t.seed ? ' <span class="outlook-thesis-seed">seed</span>' : '';
      const falsify = t.falsify ? `<p class="outlook-thesis-falsify">证伪：${escapeHtml(String(t.falsify).slice(0, 120))}</p>` : '';
      const url = t.url ? `<a href="${escapeAttr(t.url)}" target="_blank" rel="noopener noreferrer" class="outlook-thesis-link">来源</a>` : '来源待校验';
      return `<li class="outlook-thesis-item">
        <span class="outlook-thesis-tier tier-${escapeAttr(t.sourceTier || 'D')}">${escapeHtml(t.sourceTier || 'D')}</span>
        <strong>${escapeHtml(t.who || '—')}</strong>${seedTag}
        <p class="outlook-thesis-claim">${escapeHtml((t.claim || '').slice(0, 160))}</p>
        ${falsify}
        <span class="outlook-thesis-meta">${url} · ${escapeHtml(t.fetchedAt ? formatDate(t.fetchedAt) : '—')}</span>
      </li>`;
    })
    .join('');
  const hypRows = hyps
    .map((h) => {
      const falsify = h.falsify ? `<p class="outlook-thesis-falsify">证伪：${escapeHtml(String(h.falsify).slice(0, 120))}</p>` : '';
      return `<li class="outlook-thesis-item outlook-hyp-${escapeAttr(h.side || '')}">
        <span class="outlook-thesis-tier tier-C">${escapeHtml(h.side === 'long' ? '多' : h.side === 'short' ? '空' : 'C')}</span>
        <strong>${escapeHtml(h.label || '对立假说')}</strong>
        <p class="outlook-thesis-claim">${escapeHtml(String(h.claim || '').slice(0, 160))}</p>
        ${falsify}
        <span class="outlook-thesis-meta">${escapeHtml(h.dataSource || 'contradiction-matrix')}</span>
      </li>`;
    })
    .join('');
  return `<div class="outlook-active-theses-block">
    ${renderOutlookSectionHead('活跃命题 / 对立假说', 'activeTheses', inst.id)}
    ${matrixHtml}
    <ul class="outlook-thesis-list">${hypRows}${rows || (!hypRows ? '<li class="outlook-thesis-empty">registry 暂无</li>' : '')}</ul>
  </div>`;
}

function renderOutlookTradingGuidanceBlock(inst) {
  const tg = inst?.tradingGuidance;
  if (!tg?.pilot) return '';
  const sf = inst?.intelCenter?.staffFace;
  const asRef = sf && sf.fortuneChromeAllowed === false;
  const conf = tg.confidence;
  const confLine =
    conf?.hitRate != null && conf?.n != null
      ? `${conf.level} · 回测 ${Math.round(conf.hitRate * 100)}% (${conf.hits ?? '?'}/${conf.n})`
      : conf?.level
        ? `${conf.level} · 样本待积累`
        : '置信 暂无';
  const pos = tg.position;
  const posLine =
    pos?.pct != null && pos.invalidate != null
      ? `账户风险 ${pos.pct}% · 失效 ${formatOutlookPriceValue(pos.invalidate, inst)}${pos.note ? ` · ${escapeHtml(pos.note)}` : ''}`
      : pos?.note || '待校验';
  const alerts = (tg.alerts || [])
    .map(
      (a) =>
        `<li class="outlook-tg-alert outlook-tg-alert-${escapeAttr(a.type)}${a.triggered ? ' triggered' : ''}"><span class="outlook-tg-alert-type">${escapeHtml(a.type)}</span> ${a.triggered ? '●' : '○'} ${escapeHtml(a.reason || a.condition || '')}</li>`
    )
    .join('');
  const chainId = `outlook-tg-chain-${escapeAttr(inst.id)}`;
  const chainRows = (tg.logicChain || [])
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.layer || '')}</td><td>${escapeHtml(c.conclusion || '')}</td><td>${escapeHtml(c.evidence || '')}</td><td>${escapeHtml(c.dataSource || '')}</td></tr>`
    )
    .join('');
  const capLine =
    tg.globalRiskCap && tg.uncappedPosture && tg.uncappedPosture !== tg.posture
      ? `<p class="outlook-tg-cap"><strong>流动性上限</strong> ${escapeHtml(tg.globalRiskCap)} 已应用（原 ${escapeHtml(tg.uncappedPosture)}${tg.globalRiskCapTier ? ` · ${escapeHtml(tg.globalRiskCapTier)}` : ''}）</p>`
      : tg.globalRiskCap
        ? `<p class="outlook-tg-cap"><strong>流动性上限</strong> ${escapeHtml(tg.globalRiskCap)} · 未触发</p>`
        : '';
  const thesisLine =
    tg.thesisBiasContribution != null
      ? `<p class="outlook-tg-thesis">命题 bias 贡献 ${tg.thesisBiasContribution >= 0 ? '+' : ''}${escapeHtml(String(tg.thesisBiasContribution))}${tg.thesisBiasN != null ? ` · n=${tg.thesisBiasN}` : ''}</p>`
      : '';
  const suggested = tg.posture || '—';
  const overrideBlock =
    !asRef && suggested !== '试仓'
      ? `<div class="outlook-behavior-override" data-instrument="${escapeAttr(inst.id)}">
          <span class="outlook-behavior-label">行为覆盖</span>
          <button type="button" class="btn-link outlook-behavior-adopt" data-action="behavior-adopt-scout" data-instrument="${escapeAttr(inst.id)}" data-suggested="${escapeAttr(suggested)}">采纳试仓</button>
          <button type="button" class="btn-link outlook-behavior-ignore" data-action="behavior-ignore-posture" data-instrument="${escapeAttr(inst.id)}" data-suggested="${escapeAttr(suggested)}">忽略建议</button>
        </div>`
      : '';
  const preMortemHint = inst.integratedSpec?.preMortem?.failurePaths?.length
    ? `<details class="outlook-pre-mortem-inline"><summary>事前验尸 (${inst.integratedSpec.preMortem.failurePaths.length})</summary><ol class="outlook-pre-mortem-list">${inst.integratedSpec.preMortem.failurePaths.map((fp) => `<li><strong>${escapeHtml(fp.title)}</strong> · ${escapeHtml(fp.scenario)}</li>`).join('')}</ol></details>`
    : '';
  const body = `<div class="outlook-tg-summary">
      <span class="outlook-tg-posture" data-posture="${escapeAttr(tg.posture || '')}">${escapeHtml(tg.posture || '—')}</span>
      <span class="outlook-tg-conf" title="置信度">${escapeHtml(confLine)}</span>
    </div>
    <p class="outlook-tg-meta">阶段 <strong>${escapeHtml(tg.phase || '—')}</strong> · 偏向 <strong>${escapeHtml(tg.bias || '—')}</strong> · 时机 ${escapeHtml(tg.timing?.action || '—')} @ ${escapeHtml(tg.timing?.slot || '—')}</p>
    ${capLine}${thesisLine}${overrideBlock}${preMortemHint}
    <p class="outlook-tg-position"><strong>仓位</strong> ${posLine}</p>
    <ul class="outlook-tg-alerts">${alerts}</ul>
    <details class="outlook-tg-chain-details">
      <summary>逻辑链 (${(tg.logicChain || []).length})</summary>
      <table class="outlook-tg-chain-table" id="${chainId}">
        <thead><tr><th>层</th><th>结论</th><th>证据</th><th>来源</th></tr></thead>
        <tbody>${chainRows || '<tr><td colspan="4">暂无</td></tr>'}</tbody>
      </table>
    </details>`;

  if (asRef) {
    return `<details class="outlook-trading-guidance-block outlook-trading-guidance-ref">
      <summary>交易指导 · 参考（非指令） · ${escapeHtml(sf.modeLabel || '降权')}</summary>
      <p class="outlook-tg-ref-note">${escapeHtml(sf.banner || '信念未达可行动 · 指导仅作参考')}</p>
      ${body}
    </details>`;
  }

  return `<div class="outlook-trading-guidance-block outlook-trading-guidance-intraday">
    ${renderOutlookSectionHead('交易指导 · 日内/波段', 'tradingGuidance', inst.id)}
    ${body}
  </div>`;
}

function renderOutlookChanStructureBlock(inst) {
  const tg = inst?.tradingGuidance;
  const postureImpact =
    tg?.pilot && tg.posture
      ? `<p class="outlook-chan-posture-impact">对 posture 影响：<strong>${escapeHtml(tg.posture)}</strong>${inst.chanStructureHints?.length ? '' : ' · 结构数据加载后可细化'}</p>`
      : '';
  if (inst?.chanStructureLoading) {
    return `<div class="outlook-chan-structure-block">
      ${renderOutlookSectionHead('结构状态', 'chanStructure', inst.id)}
      <p class="outlook-chan-structure-note">多周期 S/R 印证 posture · 与 sim 执行层同源逻辑（只读）</p>
      ${postureImpact}
      <p class="outlook-chan-structure-loading">加载多周期结构…</p>
    </div>`;
  }
  const hints = inst?.chanStructureHints;
  if (!hints?.length) return postureImpact ? `<div class="outlook-chan-structure-block">${renderOutlookSectionHead('结构状态', 'chanStructure', inst.id)}${postureImpact}</div>` : '';
  const ref = inst?.price ?? inst?.highLowPrediction?.baseClose ?? null;
  const dir = inst?.directionLabel || inst?.directionTier || '';
  const rows = hints
    .map((h) => {
      const sup = h.support != null ? formatChanStructurePrice(inst, h.support) : '—';
      const res = h.resistance != null ? formatChanStructurePrice(inst, h.resistance) : '—';
      const src = h.dataSource && h.dataSource !== 'none' ? h.dataSource : '无数据';
      return `<tr>
        <th scope="row">${escapeHtml(h.tf || h.tfKey || '')}</th>
        <td class="outlook-chan-support">${sup}</td>
        <td class="outlook-chan-resistance">${res}</td>
        <td>${escapeHtml(h.summary || '—')}</td>
        <td class="outlook-chan-source">${escapeHtml(src)}</td>
      </tr>`;
    })
    .join('');
  const refLine =
    ref != null
      ? `现价 ${formatChanStructurePrice(inst, ref)}${dir ? ` · 研判 ${escapeHtml(dir)}` : ''}`
      : '现价待加载';
  return `<div class="outlook-chan-structure-block">
    ${renderOutlookSectionHead('结构状态', 'chanStructure', inst.id)}
    <p class="outlook-chan-structure-note">多周期 S/R 印证 posture · ${refLine}</p>
    ${postureImpact}
    <table class="outlook-chan-structure-table">
      <thead><tr><th>周期</th><th>支撑</th><th>阻力</th><th>结构</th><th>数据源</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderPhilosophyFilterInLogic(inst) {
  const pf = inst?.philosophyFilter;
  if (!pf) return '';
  const reason = OUTLOOK_GATE_NEUTRAL_LABELS[pf.neutralReason] || pf.neutralReason;
  if (pf.filterPass === false) {
    return `<p class="outlook-philosophy-filter-note outlook-philosophy-filter-block">Phil·过滤 · ${escapeHtml(reason || '观望')} — 环境 disagree，研判展示方向已中性化</p>`;
  }
  return `<p class="outlook-philosophy-filter-note outlook-philosophy-filter-pass">Phil✓ 哲学 gate 通过 · ${escapeHtml((pf.philosophySummary || '').slice(0, 80))}</p>`;
}

function renderPhilosophyModalContent(manifest) {
  const m = manifest || philosophyManifestCache || {};
  const principles = (m.principles || [])
    .map(
      (p) =>
        `<section class="philosophy-modal-principle"><h4>${escapeHtml(p.title)}</h4><p>${escapeHtml(p.summary || '')}</p></section>`
    )
    .join('');
  const stack = (m.strategyStack || [])
    .map(
      (s) =>
        `<li><strong>${escapeHtml(s.layer)}</strong> · ${escapeHtml(s.name)} — ${escapeHtml(s.role || '')}</li>`
    )
    .join('');
  const env = m.envFlags
    ? Object.entries(m.envFlags)
        .map(
          ([k, v]) =>
            `<li><code>${escapeHtml(k)}</code> = ${escapeHtml(v.default || '—')} · ${escapeHtml(v.description || '')}</li>`
        )
        .join('')
    : '';
  return `<div class="philosophy-modal-body-inner">
    <blockquote class="fancheng-philosophy-epigraph philosophy-modal-epigraph">${escapeHtml(m.epigraph || PHILOSOPHY_EPIGRAPH_FALLBACK)}</blockquote>
    <div class="philosophy-modal-principles">${principles}</div>
    ${stack ? `<h4 class="philosophy-modal-subhead">策略栈</h4><ul class="philosophy-modal-stack">${stack}</ul>` : ''}
    ${env ? `<h4 class="philosophy-modal-subhead">环境变量</h4><ul class="philosophy-modal-env">${env}</ul>` : ''}
    <p class="philosophy-modal-doc-hint">完整文档：<code>docs/FANCHENG_PHILOSOPHY.md</code> · manifest <code>data/fancheng-philosophy-v1.json</code></p>
  </div>`;
}

function openPhilosophyModal() {
  const modal = document.getElementById('philosophyModal');
  if (!modal) return;
  const body = modal.querySelector('.philosophy-modal-scroll');
  if (body) {
    void ensurePhilosophyManifest().then((m) => {
      body.innerHTML = renderPhilosophyModalContent(m);
    });
  }
  modal.classList.remove('hidden');
}

function closePhilosophyModal() {
  document.getElementById('philosophyModal')?.classList.add('hidden');
}

function setupPhilosophyModal() {
  document.getElementById('philosophyModalClose')?.addEventListener('click', closePhilosophyModal);
  document.getElementById('philosophyModalBackdrop')?.addEventListener('click', closePhilosophyModal);
  document.getElementById('philosophyFooterLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    openPhilosophyModal();
  });
  document.getElementById('philosophySettingsLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeSettings();
    openPhilosophyModal();
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="open-philosophy"]');
    if (btn) {
      e.preventDefault();
      openPhilosophyModal();
    }
  });
}

function policyPhilosophyThemeTag(item) {
  const dir = item?.direction || item?.directionLabel;
  if (!dir || dir === 'neutral') return '';
  const globalRegime = window.__outlookCacheStats?.globalRegime || window.__outlookCacheFramework?.globalRegime;
  if (!globalRegime || globalRegime === 'neutral') return '';
  const bullish = dir === 'bullish' || item.directionLabel === '偏多';
  const bearish = dir === 'bearish' || item.directionLabel === '偏空';
  const regimeBull = /bull|risk_on|偏多/i.test(String(globalRegime));
  const regimeBear = /bear|risk_off|偏空/i.test(String(globalRegime));
  if ((bullish && regimeBull) || (bearish && regimeBear)) {
    return '<span class="policy-philosophy-tag policy-philosophy-align" title="与当前研判环境同向">Phil·契</span>';
  }
  if ((bullish && regimeBear) || (bearish && regimeBull)) {
    return '<span class="policy-philosophy-tag policy-philosophy-contra" title="与当前研判环境异向">Phil·异</span>';
  }
  return '';
}

const OUTLOOK_LIST_SKELETON_ROWS = 6;
const OUTLOOK_SECTOR_LABELS = {
  all: '全部',
  energy: '能源',
  chemical: '化工',
  black: '黑色',
  metals: '有色新能源',
  precious: '贵金属',
  agriculture: '农产品',
};
const VIRTUAL_ROW_ESTIMATE = 112;
const OUTLOOK_ROW_HEIGHT = 112;
const VIRTUAL_OVERSCAN = 4;
const VIRTUAL_MAX_ROWS = 32;
const FILTER_DEBOUNCE_MS = 450;
const OUTLOOK_DEBOUNCE_MS = 800;
const MIN_RENDER_INTERVAL_MS = 2000;
const MACRO_LIVE_INTERVAL_MS = 3 * 60 * 1000;

let activeTab = 'indices';
let selectedIndexId = 'sp500';
let selectedTimeframe = 'day';
let historyCache = {};
let historyIndexList = [];
let klineOffset = 0;
let klineViewCount = 120;
let currentKlines = [];
let refreshTimer = null;
let liveRefreshTimer = null;
let refreshIntervalMs = 5 * 60 * 1000;
let quoteRefreshMs = 30 * 1000;
let forexRefreshMs = 10 * 1000;
let forexLiveTimer = null;
let policyRefreshMs = 30 * 1000;
let policyLiveTimer = null;
let bojLiveTimer = null;
let fedLiveTimer = null;
let bojRefreshMs = 30 * 1000;
let fedRefreshMs = 30 * 1000;
let policyFilterDept = 'all';
let policyFilterRegion = 'all';
let policyMinStars = 0;
let policyFilterCommodityId = 'all';
let policyCommodityExchangeFilter = 'shfe';
let policyViewMode = 'all';
let geoFilterRegion = 'all';
let geoFilterDimension = 'all';
let geoFilterCountry = 'all';
let geoMinStars = 0;
let geoViewMode = 'all';
let geoLiveTimer = null;
let climateFilterRegion = 'all';
let climateFilterCategory = 'all';
let climateMinStars = 0;
let climateViewMode = 'all';
let climateLiveTimer = null;
let policyCommodityNewsLoading = null;
let outlookSectorFilter = 'all';
let outlookSlotFilter = 'all';
let outlookSelectedInstrumentId = null;
const outlookDetailSectionState = new Map();
let outlookBacktestRunning = false;
let outlookLongrunRunning = false;
let outlookBacktestSummaryCache = null;
let outlookLongrunSummaryCache = null;
const OUTLOOK_PRICE_PATCH_MIN_MS = 1000;
const OUTLOOK_LIGHT_REFRESH_MS = 45000;
const OUTLOOK_FULL_REFRESH_MS = 5 * 60 * 1000;
const OUTLOOK_STALE_CACHE_MS = 60 * 60 * 1000;
const outlookPricePatchAtById = new Map();
let outlookLiveTimer = null;
let outlookLastFullRefreshAt = 0;

const POLICY_EXCHANGE_LABELS = {
  shfe: '上期所',
  dce: '大商所',
  zce: '郑商所',
  ine: '上期能源',
  gfex: '广期所',
};
const cbPanelTab = { fed: 'timeline', boj: 'timeline' };
let isLiveRefreshing = false;
let panelsInitialized = false;
let pendingRenderData = null;
let renderAllScheduled = false;
let renderAllThrottleTimer = null;
let lastIncrementalRenderAt = 0;
let incrementalRenderQueued = null;
let scrollPerfBound = false;
let rafWorkQueue = [];
let rafWorkScheduled = false;
let rafLoopId = null;
let pendingOutlookListMount = null;
let rendererPaused = false;
let scrollInteractionActive = false;
let lastUserActivityAt = Date.now();
const USER_IDLE_MS = 30000;
let panelInitObserver = null;
const virtualListRegistry = new WeakMap();
const CHUNK_DOM_SIZE = 20;

const FRED_APPLY_URL = 'https://fredaccount.stlouisfed.org/apikeys';
const STOOQ_APPLY_URL = 'https://stooq.pl/q/d/?s=^dax&get_apikey';
const CURSOR_APPLY_URL = 'https://cursor.com/dashboard/integrations';

function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  const wrapped = (...args) => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, wait);
    }
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  wrapped.flush = (...args) => {
    wrapped.cancel();
    last = Date.now();
    fn(...args);
  };
  return wrapped;
}

function shouldProcessLiveDomUpdate() {
  return !rendererPaused && !scrollInteractionActive && !document.hidden && !isUserIdle();
}

function shouldProcessOutlookLiveUpdate() {
  return !rendererPaused && !document.hidden;
}

function isUserIdle() {
  return Date.now() - lastUserActivityAt > USER_IDLE_MS;
}

function markUserActivity() {
  const wasIdle = isUserIdle();
  lastUserActivityAt = Date.now();
  if (wasIdle) notifyRendererState({ idle: false });
}

function bindUserActivityTracking() {
  if (bindUserActivityTracking.bound) return;
  bindUserActivityTracking.bound = true;
  const onActivity = () => markUserActivity();
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    document.addEventListener(type, onActivity, { capture: true, passive: true });
  }
  setInterval(() => {
    notifyRendererState({ idle: isUserIdle() });
  }, 5000);
}

window.isUserIdle = isUserIdle;

function notifyRendererState(patch = {}) {
  window.fancheng?.setRendererState?.({
    activeTab,
    scrolling: scrollInteractionActive,
    hidden: document.hidden,
    ...patch,
  });
}

function bindScrollPerfHints() {
  if (scrollPerfBound) return;
  scrollPerfBound = true;
  let scrollTimer = null;
  const onScroll = () => {
    document.body.classList.add('is-scrolling');
    if (!scrollInteractionActive) {
      scrollInteractionActive = true;
      notifyRendererState({ scrolling: true });
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      document.body.classList.remove('is-scrolling');
      scrollInteractionActive = false;
      notifyRendererState({ scrolling: false });
      refreshMountedVirtualLists();
      retryPendingOutlookListMount();
    }, 280);
  };
  document.addEventListener(
    'scroll',
    onScroll,
    { capture: true, passive: true }
  );
}

function hashListInputs(parts) {
  return parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('|');
}

function limitDisplayItems(items, limit) {
  if (!items?.length || items.length <= limit) return items || [];
  return items.slice(0, limit);
}

function isActivePanel(key) {
  return activeTab === key;
}

function updateNavTabBadge(key, count) {
  const tab = document.querySelector(`.tab[data-tab="${key}"]`);
  if (!tab) return;
  if (!count) {
    tab.removeAttribute('data-live-count');
    return;
  }
  tab.dataset.liveCount = count > 99 ? '99+' : String(count);
}

function cancelPendingPanelRenders() {
  refreshPolicyPanelSectionsDebounced.cancel?.();
  refreshGeopoliticsPanelSectionsDebounced.cancel?.();
  refreshClimatePanelSectionsDebounced.cancel?.();
  applyIncrementalDataUpdateThrottled.cancel?.();
  pendingRenderData = null;
  renderAllScheduled = false;
  incrementalRenderQueued = null;
  if (renderAllThrottleTimer) {
    clearTimeout(renderAllThrottleTimer);
    renderAllThrottleTimer = null;
  }
  rafWorkQueue.length = 0;
  if (rafLoopId != null) {
    cancelAnimationFrame(rafLoopId);
    rafLoopId = null;
  }
  rafWorkScheduled = false;
  for (const scrollEl of document.querySelectorAll('[data-virtual-mounted="1"]')) {
    const state = virtualListRegistry.get(scrollEl);
    if (state?.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
  }
}

function processRafQueue() {
  rafLoopId = null;
  rafWorkScheduled = false;
  if (rendererPaused || scrollInteractionActive) {
    rafWorkQueue.length = 0;
    return;
  }
  const batch = rafWorkQueue.splice(0, 2);
  for (const fn of batch) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
  if (rafWorkQueue.length) {
    rafWorkScheduled = true;
    rafLoopId = requestAnimationFrame(processRafQueue);
  }
}

function scheduleRafWork(fn) {
  if (rendererPaused || scrollInteractionActive) return;
  if (fn) rafWorkQueue.push(fn);
  if (rafWorkScheduled) return;
  rafWorkScheduled = true;
  rafLoopId = requestAnimationFrame(processRafQueue);
}

function scheduleIdleWork(fn) {
  if (rendererPaused || scrollInteractionActive || !fn) return;
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => scheduleRafWork(fn), { timeout: 2500 });
    return;
  }
  scheduleRafWork(fn);
}

function destroyVirtualList(scrollEl) {
  const state = virtualListRegistry.get(scrollEl);
  if (!state) return;
  state.destroy?.();
  virtualListRegistry.delete(scrollEl);
  scrollEl.dataset.virtualMounted = '';
}

function refreshMountedVirtualLists() {
  document.querySelectorAll('[data-virtual-mounted="1"]').forEach((el) => {
    const state = virtualListRegistry.get(el);
    state?.update?.();
  });
}

function retryPendingOutlookListMount() {
  const job = pendingOutlookListMount;
  if (!job?.panel || !document.body.contains(job.panel)) {
    pendingOutlookListMount = null;
    refreshMountedVirtualLists();
    return;
  }
  remountOutlookInstrumentList(job.panel, job.instruments, { immediate: true });
}

function mountVirtualReadingList(scrollEl, items, renderRow, { listClass = 'policy-reading-list', moreHint = '' } = {}) {
  if (!scrollEl) return;
  destroyVirtualList(scrollEl);
  if (!items?.length) {
    scrollEl.innerHTML = '<div class="empty-state policy-feed-empty">当前筛选条件下暂无数据</div>';
    return;
  }

  const rowHeight = VIRTUAL_ROW_ESTIMATE;
  const totalHeight = items.length * rowHeight;
  scrollEl.innerHTML = '';
  const spacer = document.createElement('div');
  spacer.className = 'virtual-list-spacer';
  spacer.style.height = `${totalHeight}px`;
  spacer.style.position = 'relative';

  const windowEl = document.createElement('div');
  windowEl.className = 'virtual-list-window';
  windowEl.style.position = 'absolute';
  windowEl.style.top = '0';
  windowEl.style.left = '0';
  windowEl.style.right = '0';

  const listEl = document.createElement('div');
  listEl.className = listClass;
  windowEl.appendChild(listEl);
  spacer.appendChild(windowEl);
  scrollEl.appendChild(spacer);
  if (moreHint) scrollEl.insertAdjacentHTML('beforeend', moreHint);

  const state = {
    items,
    renderRow,
    listEl,
    windowEl,
    scrollEl,
    start: -1,
    end: -1,
    raf: null,
  };

  const update = () => {
    if (!document.body.contains(scrollEl) || rendererPaused) return;
    const scrollTop = scrollEl.scrollTop;
    const viewH = scrollEl.clientHeight || 560;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN);
    const visibleCount = Math.ceil(viewH / rowHeight) + VIRTUAL_OVERSCAN * 2;
    const end = Math.min(items.length, start + Math.max(VIRTUAL_MAX_ROWS, visibleCount));

    if (start === state.start && end === state.end && listEl.childElementCount === end - start) return;
    state.start = start;
    state.end = end;
    windowEl.style.transform = `translateY(${start * rowHeight}px)`;

    const frag = document.createDocumentFragment();
    const tmp = document.createElement('div');
    for (let i = start; i < end; i++) {
      tmp.innerHTML = renderRow(items[i], i + 1);
      if (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
    }
    listEl.replaceChildren(frag);
  };
  state.update = update;

  const onScroll = () => {
    if (state.raf || rendererPaused) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = null;
      update();
    });
  };

  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  state.destroy = () => {
    scrollEl.removeEventListener('scroll', onScroll);
    if (state.raf) cancelAnimationFrame(state.raf);
  };

  virtualListRegistry.set(scrollEl, state);
  scrollEl.dataset.virtualMounted = '1';
  update();
}

function getOutlookVisibleInstruments(instruments, sector = outlookSectorFilter) {
  if (!instruments?.length) return [];
  if (sector === 'all') return instruments;
  return instruments.filter((i) => (i.sector || 'all') === sector);
}

function outlookInstrumentContentSig(inst) {
  const hl = inst.highLowPrediction || inst.nextDayRange;
  const rc = inst.rangeComparison;
  const ya = inst.yesterdayArchive;
  return [
    inst.id,
    inst.direction,
    inst.regime,
    inst.latencyState,
    inst.judgementUpdatedAt,
    hl?.predictedHigh,
    hl?.predictedLow,
    rc?.actualHigh,
    rc?.actualLow,
    rc?.bandHit,
    rc?.compareLabel,
    ya?.actualHigh,
    ya?.bandHit,
    inst.scenarios?.stressTriggered,
    inst.compositeScore,
    inst.predictionRationale,
    inst.rationaleSummary,
    inst.starsHtml,
    inst.directionLabel,
    inst.tradingGuidance?.posture,
    inst.tradingGuidance?.phase,
    inst.tradingGuidance?.alerts?.map((a) => (a.triggered ? '1' : '0')).join(''),
    inst.longTermGuidance?.entry?.readiness,
  ].join(':');
}

function hashOutlookInstrumentsContent(instruments) {
  return hashListInputs([
    'outlook-content',
    outlookSectorFilter,
    instruments.map(outlookInstrumentContentSig).join('|'),
  ]);
}

function scrollVirtualOutlookToInstrument(listEl, instrumentId) {
  if (!listEl || !instrumentId) return;
  const state = virtualListRegistry.get(listEl);
  const items = state?.items;
  if (!items?.length) return;
  const idx = items.findIndex((i) => i.id === instrumentId);
  if (idx < 0) return;
  const viewH = listEl.clientHeight || 560;
  const targetScroll = Math.max(0, idx * OUTLOOK_ROW_HEIGHT - viewH / 2 + OUTLOOK_ROW_HEIGHT / 2);
  if (Math.abs(listEl.scrollTop - targetScroll) > OUTLOOK_ROW_HEIGHT) {
    listEl.scrollTop = targetScroll;
  }
  state.update?.();
}

function mountVirtualOutlookList(listEl, instruments) {
  if (!listEl) return;
  const allItems = enrichOutlookInstrumentsClientSide(instruments || []);
  const items = getOutlookVisibleInstruments(allItems);
  destroyVirtualList(listEl);
  if (!items.length) {
    listEl.innerHTML = '<div class="empty-state outlook-sector-empty">当前板块暂无品种数据</div>';
    listEl.dataset.contentHash = 'empty';
    listEl.dataset.outlookListMounted = '';
    listEl.dataset.virtualMounted = '';
    return;
  }

  const rowHeight = OUTLOOK_ROW_HEIGHT;
  const totalHeight = items.length * rowHeight;
  listEl.innerHTML = '';
  const spacer = document.createElement('div');
  spacer.className = 'virtual-list-spacer';
  spacer.style.height = `${totalHeight}px`;
  spacer.style.position = 'relative';

  const windowEl = document.createElement('div');
  windowEl.className = 'virtual-list-window';
  windowEl.style.position = 'absolute';
  windowEl.style.top = '0';
  windowEl.style.left = '0';
  windowEl.style.right = '0';
  spacer.appendChild(windowEl);
  listEl.appendChild(spacer);

  const state = { start: -1, end: -1, raf: null, items, allItems };

  const update = () => {
    if (!document.body.contains(listEl) || rendererPaused) return;
    const scrollTop = listEl.scrollTop;
    const viewH = listEl.clientHeight || 560;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN);
    const visibleCount = Math.ceil(viewH / rowHeight) + VIRTUAL_OVERSCAN * 2;
    const end = Math.min(items.length, start + Math.max(VIRTUAL_MAX_ROWS, visibleCount));

    if (start === state.start && end === state.end && windowEl.childElementCount === end - start) return;
    state.start = start;
    state.end = end;
    windowEl.style.transform = `translateY(${start * rowHeight}px)`;

    const frag = document.createDocumentFragment();
    const tmp = document.createElement('div');
    for (let i = start; i < end; i++) {
      try {
        tmp.innerHTML = renderOutlookInstrumentRow(items[i]);
        if (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
      } catch (err) {
        console.error('outlook row render failed', items[i]?.id, err);
      }
    }
    windowEl.replaceChildren(frag);
    if (isActivePanel('outlook')) {
      const panel = document.getElementById('panel-outlook');
      const visibleIds = items.slice(start, end).map((inst) => inst.id);
      refreshOutlookFocusAnalysisCells(panel, visibleIds);
    }
  };
  state.update = update;

  const onScroll = () => {
    if (state.raf || rendererPaused) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = null;
      update();
    });
  };

  listEl.addEventListener('scroll', onScroll, { passive: true });
  state.destroy = () => {
    listEl.removeEventListener('scroll', onScroll);
    if (state.raf) cancelAnimationFrame(state.raf);
  };

  virtualListRegistry.set(listEl, state);
  listEl.dataset.outlookListMounted = '1';
  listEl.dataset.virtualMounted = '1';
  listEl.dataset.outlookInstrumentCount = String(items.length);
  listEl.dataset.contentHash = hashOutlookInstrumentsContent(allItems);
  update();
  if (outlookSelectedInstrumentId) {
    scrollVirtualOutlookToInstrument(listEl, outlookSelectedInstrumentId);
  }
}

function renderOutlookListSkeleton(count = OUTLOOK_LIST_SKELETON_ROWS) {
  return Array.from({ length: count }, () =>
    '<div class="outlook-instrument-row outlook-list-skeleton-row" aria-hidden="true"><div class="outlook-list-skeleton-bar"></div></div>'
  ).join('');
}

function revealOutlookDeferredSections(panel) {
  panel?.querySelectorAll('.outlook-section-deferred[hidden]').forEach((el) => {
    el.hidden = false;
  });
}

function remountOutlookInstrumentList(panel, instruments, options = {}) {
  const listEl = panel?.querySelector('.outlook-instrument-list');
  if (!listEl || !instruments?.length) return;
  const visible = getOutlookVisibleInstruments(instruments);
  const contentHash = hashOutlookInstrumentsContent(instruments);
  if (
    !options.force &&
    listEl.dataset.contentHash === contentHash &&
    listEl.dataset.virtualMounted === '1'
  ) {
    revealOutlookDeferredSections(panel);
    pendingOutlookListMount = null;
    return;
  }

  pendingOutlookListMount = { panel, instruments };

  const doMount = () => {
    if (!document.body.contains(listEl)) return;
    mountVirtualOutlookList(listEl, instruments);
    listEl.classList.remove('outlook-list-loading');
    applyOutlookSectorFilter(panel, outlookSectorFilter);
    revealOutlookDeferredSections(panel);
    pendingOutlookListMount = null;
    scheduleIdleWork(() => {
      if (!isActivePanel('outlook')) return;
      ensureOutlookDefaultSelection(instruments);
      if (outlookSelectedInstrumentId) {
        updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
      }
      startFocusAnalysisLiveRefresh(panel, { force: false });
    });
    const emptyEl = panel.querySelector('.outlook-sector-empty');
    if (emptyEl) emptyEl.hidden = visible.length > 0;
  };

  if (!options.skipSkeleton) {
    listEl.classList.add('outlook-list-loading');
    listEl.innerHTML = renderOutlookListSkeleton();
  }

  if (options.immediate || (!rendererPaused && !scrollInteractionActive)) {
    if (options.immediate) {
      doMount();
    } else {
      scheduleRafWork(doMount);
    }
    return;
  }

  setTimeout(() => {
    if (pendingOutlookListMount?.panel === panel) doMount();
  }, 320);
}

function pauseRendererWork() {
  if (rendererPaused) return;
  rendererPaused = true;
  cancelPendingPanelRenders();
}

function resumeRendererWork() {
  if (!rendererPaused) return;
  rendererPaused = false;
  const pending = pendingRenderData;
  if (pending) {
    pendingRenderData = null;
    if (panelsInitialized) {
      scheduleRafWork(() => applyIncrementalDataUpdateImpl(pending));
    } else {
      scheduleRafWork(() => executeRenderAll(pending));
    }
  }
  retryPendingOutlookListMount();
}

function bindWindowFocusHandlers() {
  const onHiddenChange = (hidden) => {
    notifyRendererState({ hidden });
    if (hidden) pauseRendererWork();
    else resumeRendererWork();
  };
  if (window.fancheng?.onWindowFocusChanged) {
    window.fancheng.onWindowFocusChanged(({ focused }) => notifyRendererState({ hidden: !focused }));
  }
  document.addEventListener('visibilitychange', () => onHiddenChange(document.hidden));
}

function initPanelSetup(key) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel || panel.dataset.panelSetup === '1') return;
  panel.dataset.panelSetup = '1';
  if (key === 'policy') {
    setupPolicyPanel();
    if (isActivePanel('policy')) {
      refreshPolicyPanelSections(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
        commodityIntel: window.__policyCommodityIntel,
      });
    }
  } else if (key === 'geopolitics') {
    setupGeopoliticsPanel();
    if (isActivePanel('geopolitics')) refreshGeopoliticsPanelSections(panel);
  } else if (key === 'climate') {
    setupClimatePanel();
    if (isActivePanel('climate')) refreshClimatePanelSections(panel);
  } else if (key === 'outlook') {
    setupOutlookPanel();
    if (isActivePanel('outlook')) void activateOutlookTab();
  } else if (key === 'fed') setupCentralBankPanel('fed');
  else if (key === 'boj') setupCentralBankPanel('boj');
  else if (key === 'commodities' && window.CommoditiesUI?.ensureInit) {
    window.CommoditiesUI.ensureInit(window.__preloadedCommoditiesLive);
  } else if (key === 'commodities' && window.CommoditiesUI?.init) {
    window.CommoditiesUI.init();
  }
}

function wireDeferredPanelSetup() {
  setupFocusNewsReaderDelegation();
  initPanelSetup(activeTab);
  const panelsRoot = $('#panels');
  if (!panelsRoot) return;
  if (panelInitObserver) panelInitObserver.disconnect();
  if (typeof IntersectionObserver === 'undefined') {
    for (const key of TAB_KEYS) {
      if (key !== activeTab) initPanelSetup(key);
    }
    return;
  }
  panelInitObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const key = entry.target.id?.replace(/^panel-/, '');
        if (key) initPanelSetup(key);
        panelInitObserver.unobserve(entry.target);
      }
    },
    { root: panelsRoot, rootMargin: '80px 0px', threshold: 0.01 }
  );
  for (const key of TAB_KEYS) {
    if (key === activeTab) continue;
    const panel = document.getElementById(`panel-${key}`);
    if (panel && panel.dataset.panelSetup !== '1') panelInitObserver.observe(panel);
  }
}

function setListHtmlBatched(container, rowHtmlStrings, wrapperClass, moreHint = '') {
  if (!container) return;
  const hash = hashListInputs([wrapperClass, rowHtmlStrings.length, rowHtmlStrings[0], rowHtmlStrings.at(-1)]);
  if (container.dataset.listHash === hash) return;
  container.dataset.listHash = hash;
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = wrapperClass;
  container.appendChild(wrapper);
  if (!rowHtmlStrings.length) {
    if (moreHint) container.insertAdjacentHTML('beforeend', moreHint);
    return;
  }
  if (rowHtmlStrings.length <= CHUNK_DOM_SIZE) {
    wrapper.innerHTML = rowHtmlStrings.join('');
    if (moreHint) container.insertAdjacentHTML('beforeend', moreHint);
    return;
  }
  let i = 0;
  const appendChunk = () => {
    const end = Math.min(i + CHUNK_DOM_SIZE, rowHtmlStrings.length);
    const frag = document.createDocumentFragment();
    const tmp = document.createElement('div');
    for (; i < end; i++) {
      tmp.innerHTML = rowHtmlStrings[i];
      if (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
    }
    wrapper.appendChild(frag);
    if (i < rowHtmlStrings.length) requestAnimationFrame(appendChunk);
    else if (moreHint) container.insertAdjacentHTML('beforeend', moreHint);
  };
  requestAnimationFrame(appendChunk);
}

/** 日本央行新闻中文化（内嵌于 app.js，确保打包后一定生效） */
const BOJ_I18N = (function () {
  const EXACT = [
    ['Opening Remarks at the 2026 BOJ-IMES Conference Hosted by the Institute for Monetary and Economic Studies, Bank of Japan', '2026年日本央行-IMES会议开幕致辞（金融研究所主办）'],
    ['"Economic Activity, Prices, and Monetary Policy in Japan" (Speech at a Meeting with Local Leaders in Fukuoka)', '「日本的经济活动、物价与货币政策」地方领导人会议演讲（福冈）'],
    ["'Economic Activity, Prices, and Monetary Policy in Japan' (Speech at a Meeting with Local Leaders in Fukuoka)", '「日本的经济活动、物价与货币政策」地方领导人会议演讲（福冈）'],
    ['"Singleness of Money and the Role of Central Banks" (Speech at the Japan Society of Monetary Economics)', '「货币单一性与中央银行的作用」日本货币经济学会演讲'],
    ["'Singleness of Money and the Role of Central Banks' (Speech at the Japan Society of Monetary Economics)", '「货币单一性与中央银行的作用」日本货币经济学会演讲'],
    ["Remarks by Executive Director KAMIYAMA at the AIMA Japan Annual Forum 2026 on May 14 (Promoting the Evolution and Stability of Japan's Financial System)", '执行理事神田真之在 AIMA 日本年度论坛演讲（2026年5月14日）：推动日本金融体系演进与稳定'],
    ['(IMES Newsletter) 2026 BOK/ERI - BOJ/IMES Joint Research Workshop', '（IMES 通讯）2026年韩国银行/经济研究院 — 日本央行/IMES 联合研究研讨会'],
    ['Call for Papers: 8th Conference on Nontraditional Data, Machine Learning, and Natural Language Processing in Macroeconomics (ECONDAT 2026 Fall Meeting)', '征文通知：第八届宏观经济学非传统数据、机器学习与自然语言处理会议（ECONDAT 2026 秋季会议）'],
    ['Opening Remarks by Executive Director KAMIYAMA at the 10th Meeting of the Liaison and Coordination Committee on Central Bank Digital Currency on February 2, 2026 (Points Forming Lines, Evolving to Surfaces)', '执行理事神田真之在央行数字货币联络协调委员会第十次会议开幕致辞（2026年2月2日）'],
    ['(IMES Newsletter) 2025 BOJ-IMES Finance Workshop', '（IMES 通讯）2025年日本央行-IMES 金融研讨会'],
  ];
  const PHRASES = [
    ['Statement on Monetary Policy', '货币政策声明'],
    ['Opening Remarks at the', '开幕致辞：'],
    ['Opening Remarks by Executive Director', '执行理事开幕致辞：'],
    ['Opening Remarks by', '开幕致辞：'],
    ['Opening Remarks', '开幕致辞'],
    ['Remarks by Executive Director', '执行理事讲话：'],
    ['Remarks by', '讲话：'],
    ['Speech at a Meeting with Local Leaders in', '地方领导人会议演讲（'],
    ['Speech at the Japan Society of Monetary Economics', '日本货币经济学会演讲'],
    ['Economic Activity, Prices, and Monetary Policy in Japan', '日本的经济活动、物价与货币政策'],
    ['Singleness of Money and the Role of Central Banks', '货币单一性与中央银行的作用'],
    ['Hosted by the Institute for Monetary and Economic Studies', '（金融研究所主办）'],
    ['Member of the Policy Board', '政策委员会委员'],
    ['Deputy Governor', '副行长'],
    ['Executive Director', '执行理事'],
    ['Bank of Japan', '日本央行'],
    ['Monetary Policy', '货币政策'],
    ['Joint Research Workshop', '联合研究研讨会'],
    ['Annual Forum', '年度论坛'],
    ['IMES Newsletter', 'IMES 通讯'],
    ['Financial System', '金融体系'],
    ['Promoting the Evolution and Stability of', '推动日本金融体系演进与稳定：'],
    ['Call for Papers', '征文通知'],
    ['Workshop', '研讨会'],
    ['Governor', '行长'],
    ['Japan', '日本'],
  ];
  const PEOPLE = [
    ['UEDA Kazuo, Governor', '植田和男（行长）'],
    ['UEDA Kazuo', '植田和男'],
    ['KOEDA Junko, Member of the Policy Board', '小手保充（政策委员会委员）'],
    ['KOEDA Junko', '小手保充'],
    ['HIMINO Ryozo, Deputy Governor', '冰见亮三（副行长）'],
    ['HIMINO Ryozo', '冰见亮三'],
    ['TAMURA Naoki, Member of the Policy Board', '田村直树（政策委员会委员）'],
    ['TAMURA Naoki', '田村直树'],
    ['Executive Director KAMIYAMA', '执行理事神田真之'],
    ['KAMIYAMA', '神田真之'],
  ];
  const CITIES = [['Fukuoka', '福冈'], ['Hyogo', '兵库'], ['Tokyo', '东京'], ['Osaka', '大阪']];
  const SORTED_EXACT = [...EXACT].sort((a, b) => b[0].length - a[0].length);
  const SORTED_PHRASES = [...PHRASES].sort((a, b) => b[0].length - a[0].length);
  const SORTED_PEOPLE = [...PEOPLE].sort((a, b) => b[0].length - a[0].length);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const norm = (t) => String(t || '').replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201c\u201d\u2033]/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const latin = (t) => (String(t).match(/\b[a-zA-Z]{3,}\b/g) || []).filter((w) => !/^(of|in|on|at|to|for|with|by|the|and|or|a|an)$/i.test(w)).length;
  const cjk = (t) => (String(t).match(/[\u4e00-\u9fff]/g) || []).length;
  const needs = (t) => latin(norm(t)) >= 2;
  const pdfSuffix = (t) => { const m = String(t).match(/(\[PDF[^\]]*\])/i); return m ? ` ${m[1]}` : ''; };
  const apply = (text) => {
    let out = String(text || '');
    for (const [en, zh] of SORTED_PEOPLE) out = out.replace(new RegExp(esc(en), 'gi'), zh);
    for (const [en, zh] of SORTED_PHRASES) out = out.replace(new RegExp(esc(en), 'gi'), zh);
    for (const [en, zh] of CITIES) out = out.replace(new RegExp(`\\b${esc(en)}\\b`, 'gi'), zh);
    return out.replace(/"\s*/g, '「').replace(/\s*"/g, '」').replace(/'\s*/g, '「').replace(/\s*'/g, '」').replace(/\(\s*/g, '（').replace(/\s*\)/g, '）').replace(/\s+/g, ' ').trim();
  };
  const findExact = (text) => {
    const n = norm(text); const lower = n.toLowerCase();
    for (const [en, zh] of SORTED_EXACT) if (lower === en.toLowerCase()) return zh;
    const wo = n.replace(/\s*\[PDF[^\]]*\]/gi, '').trim();
    for (const [en, zh] of SORTED_EXACT) if (wo.toLowerCase() === en.toLowerCase()) return zh + pdfSuffix(n);
    return null;
  };
  const classify = (t) => {
    const s = t.toLowerCase();
    if (/statement on monetary policy/.test(s)) return '货币政策声明';
    if (/opening remarks/.test(s)) return '开幕致辞';
    if (/speech at/.test(s)) return '演讲';
    if (/remarks by/.test(s)) return '讲话';
    if (/newsletter/.test(s)) return '通讯';
    if (/workshop/.test(s)) return '研讨会';
    return '公告';
  };
  function translateTitle(text) {
    const n = norm(text);
    if (!needs(n)) return n;
    const exact = findExact(n);
    if (exact) return exact;
    const partial = apply(n.replace(/\[PDF[^\]]*\]/gi, '').trim());
    if (cjk(partial) >= 4 && latin(partial) < latin(n)) return partial + pdfSuffix(n);
    return `日本央行：${classify(n)}${pdfSuffix(n)}`;
  }
  function translateSpeaker(text) {
    const n = norm(text);
    if (!needs(n)) return n;
    const exact = findExact(n);
    if (exact) return exact;
    const partial = apply(n);
    return cjk(partial) >= 2 ? partial : n;
  }
  function localizeNews(news) {
    return (news || []).map((item) => ({
      ...item,
      title: translateTitle(item.title),
      summary: item.summary ? translateSpeaker(item.summary) : '',
    }));
  }
  function localizeSource(source) {
    if (!source) return source;
    return { ...source, news: localizeNews(source.news) };
  }
  return { translateTitle, translateSpeaker, localizeNews, localizeSource, needsTranslation: needs };
})();

/** 央行官员讲话中文化（内嵌 app.js，渲染层强制生效） */
const CB_SPEECH_I18N = (function () {
  const FED_EXACT = [
    ['A Framework for Practical Monetary Policy Decision Making', '实用货币政策决策框架'],
    ['Global Economic Developments and the U.S. Economy', '全球经济形势与美国就业'],
    ['The Opportunities and Risks AI Presents for the Economy and Financial System', '人工智能对经济和金融体系带来的机遇与风险'],
    ['Efficient and Effective Central Banking: Beyond the Balance Sheet', '高效央行运作：超越资产负债表'],
    ['When Regulation Reshapes Markets: The Migration of Corporate Lending', '监管重塑市场：企业贷款迁移趋势'],
    ['Perspectives on Tokenization and Implications for the Financial System', '代币化视角及其对金融体系的影响'],
    ['A Coordinated Approach to Consumer Fraud Protection', '消费者欺诈防护的协调机制'],
    ['Artificial Intelligence in the Financial System', '人工智能在金融体系中的应用'],
    ['Modernizing Federal Reserve Operations in the 21st Century', '二十一世纪美联储运作现代化'],
    ['One Transitory Shock After Another', '一轮又一轮的暂时性冲击'],
    ['Policy Risks Have Changed', '政策风险已发生变化'],
    ['Measuring Financial Health', '衡量金融健康状况'],
    ['Update On Federal Reserve Bank Operations', '美联储银行业务运作更新'],
    ['Acceptance Remarks', '接受致辞'],
    ['Opening Remarks', '开幕致辞'],
    ['Remarks', '讲话'],
    ['Speech', '演讲'],
    ['Testimony', '国会听证证词'],
  ];
  const FED_PHRASES = [
    ['Monetary Policy Decision Making', '货币政策决策'],
    ['Monetary Policy', '货币政策'],
    ['Global Economic Developments', '全球经济形势'],
    ['U.S. Economy', '美国经济'],
    ['Financial System', '金融体系'],
    ['Financial Health', '金融健康状况'],
    ['Central Banking', '中央银行运作'],
    ['Balance Sheet', '资产负债表'],
    ['Corporate Lending', '企业贷款'],
    ['Federal Reserve Bank Operations', '美联储银行业务运作'],
    ['Federal Reserve', '美联储'],
    ['Interest Rates', '利率'],
    ['Interest Rate', '利率'],
    ['Exchange Rate', '汇率'],
    ['Inflation', '通胀'],
    ['Tokenization', '代币化'],
    ['Artificial Intelligence', '人工智能'],
    ['Consumer Fraud Protection', '消费者欺诈防护'],
    ['Regulation Reshapes Markets', '监管重塑市场'],
    ['Policy Risks', '政策风险'],
    ['Transitory Shock', '暂时性冲击'],
    ['Economic Outlook', '经济展望'],
    ['Labor Market', '劳动力市场'],
    ['Price Stability', '物价稳定'],
    ['Financial Conditions', '金融条件'],
  ];
  const FED_OFFICIALS = [
    ['Michelle Bowman', '鲍曼（理事）'],
    ['Bowman', '鲍曼（理事）'],
    ['Philip Jefferson', '杰斐逊（副主席）'],
    ['Jefferson', '杰斐逊（副主席）'],
    ['Michael Barr', '巴尔（副主席）'],
    ['Barr', '巴尔（副主席）'],
    ['Christopher Waller', '沃勒（理事）'],
    ['Waller', '沃勒（理事）'],
    ['Lisa Cook', '库克（理事）'],
    ['Jerome Powell', '鲍威尔（主席）'],
    ['Powell', '鲍威尔（主席）'],
  ];
  const SORTED_FED_EXACT = [...FED_EXACT].sort((a, b) => b[0].length - a[0].length);
  const SORTED_FED_PHRASES = [...FED_PHRASES].sort((a, b) => b[0].length - a[0].length);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const latin = (t) => (String(t).match(/\b[a-zA-Z]{3,}\b/g) || []).filter((w) => !/^(of|in|on|at|to|for|with|by|the|and|or|a|an)$/i.test(w)).length;
  const cjk = (t) => (String(t).match(/[\u4e00-\u9fff]/g) || []).length;
  const needs = (t) => latin(norm(t)) >= 2;
  const findFedExact = (text) => {
    const lower = norm(text).toLowerCase();
    for (const [en, zh] of SORTED_FED_EXACT) if (lower === en.toLowerCase()) return zh;
    return null;
  };
  const applyFed = (text) => {
    let out = String(text || '');
    for (const [en, zh] of FED_OFFICIALS) out = out.replace(new RegExp(`\\b${esc(en)}\\b`, 'gi'), zh);
    for (const [en, zh] of SORTED_FED_PHRASES) out = out.replace(new RegExp(esc(en), 'gi'), zh);
    return out.replace(/:\s*/g, '：').replace(/\(\s*/g, '（').replace(/\s*\)/g, '）').replace(/\s+/g, ' ').trim();
  };
  const classifyFed = (t) => {
    const s = t.toLowerCase();
    if (/monetary policy|interest rate|inflation/.test(s)) return '货币政策讲话';
    if (/exchange rate|currency|dollar/.test(s)) return '汇率政策讲话';
    if (/financial system|banking|regulation/.test(s)) return '金融体系讲话';
    if (/economy|economic|outlook/.test(s)) return '经济展望讲话';
    return '政策讲话';
  };
  function translateFedTitle(text) {
    const n = norm(text);
    if (!needs(n)) return n;
    const exact = findFedExact(n);
    if (exact) return exact;
    const partial = applyFed(n);
    if (cjk(partial) >= 4 && latin(partial) < latin(n)) return partial;
    return `美联储${classifyFed(n)}`;
  }
  function translateOfficial(name, bank) {
    const n = norm(name);
    if (!needs(n)) return n;
    if (bank === 'boj') return BOJ_I18N.translateSpeaker(n);
    return applyFed(n) || n;
  }
  function localizeSpeech(item, bank) {
    if (!item) return item;
    const title =
      bank === 'boj' ? BOJ_I18N.translateTitle(item.title) : translateFedTitle(item.title);
    const officialDisplay = translateOfficial(item.officialDisplay || item.official || '', bank);
    return { ...item, title, officialDisplay };
  }
  function localizeSpeeches(speeches, bank) {
    return (speeches || []).map((item) => localizeSpeech(item, bank));
  }
  function needsSpeechTranslation(text) {
    return needs(text);
  }
  return { localizeSpeeches, localizeSpeech, translateFedTitle, needsSpeechTranslation };
})();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatOutlookJudgementTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '';
  }
}

/** Prefer the freshest outlook timestamp — stale liveRefreshedAt must not regress the header. */
function resolveOutlookDisplayStamp(source) {
  if (!source) return null;
  const candidates = [source.updatedAt, source.liveRefreshedAt, source.generatedAt];
  let best = 0;
  let bestIso = null;
  for (const c of candidates) {
    if (!c) continue;
    const t = new Date(c).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= best) {
      best = t;
      bestIso = c;
    }
  }
  return bestIso || source.updatedAt || source.liveRefreshedAt || null;
}

function localizeUiMessage(message) {
  return typeof window.localizeText === 'function' ? window.localizeText(message) : message || '未知错误';
}

function formatIndicatorValue(ind) {
  if (ind.formatted) return ind.value;
  const v = String(ind.value);
  if (!ind.unit || ind.unit === '指数') return v;
  if (ind.unit === '%') return `${v}%`;
  if (ind.unit === '人民币') return `${v} 人民币/美元`;
  return `${v}${ind.unit ? ` ${ind.unit}` : ''}`;
}

function setupNewsItems(root = document) {
  root.querySelectorAll('.news-item, .cb-speech-item, .reading-row').forEach((el) => {
    el.addEventListener('click', () => {
      const link = el.dataset.link;
      if (link) window.fancheng.openExternal(link);
    });
  });
}

function getCbTab(key) {
  return cbPanelTab[key] || 'timeline';
}

function renderIndicatorKpiStrip(indicators) {
  if (!indicators?.length) {
    return '<div class="cb-kpi-strip empty-state">暂无指标数据</div>';
  }
  return `<div class="cb-kpi-strip">${indicators
    .map((ind) => {
      const changeHtml =
        ind.change != null
          ? `<span class="cb-kpi-change ${parseFloat(ind.change) >= 0 ? 'change-up' : 'change-down'}">${parseFloat(ind.change) >= 0 ? '▲' : '▼'}${Math.abs(parseFloat(ind.change))}</span>`
          : '';
      return `<div class="cb-kpi-card" title="${escapeAttr(ind.name)}">
        <span class="cb-kpi-label">${escapeHtml(ind.name)}</span>
        <span class="cb-kpi-value">${escapeHtml(formatIndicatorValue(ind))}</span>
        <span class="cb-kpi-meta">${ind.date ? formatDate(ind.date) : ''}${changeHtml}</span>
      </div>`;
    })
    .join('')}</div>`;
}

function renderReadingNewsRows(news, { locale, startIndex = 1 } = {}) {
  const items = locale === 'boj' ? BOJ_I18N.localizeNews(news || []) : news;
  if (!items?.length) {
    return '<div class="empty-state">暂无公告新闻</div>';
  }
  return `<ul class="reading-list">${items
    .map((item, i) => {
      const dateStr = item.pubDate ? formatDate(item.pubDate) : '';
      const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;
      return `<li class="reading-row reading-row-news" data-link="${escapeAttr(item.link)}" data-idx="${i}">
        <span class="reading-row-idx">${startIndex + i}</span>
        <time class="reading-row-date">${escapeHtml(shortDate)}</time>
        <div class="reading-row-main">
          <span class="reading-row-badge reading-badge-news">公告</span>
          <h4 class="reading-row-title">${escapeHtml(item.title)}</h4>
          ${item.summary ? `<p class="reading-row-summary">${escapeHtml(item.summary)}</p>` : ''}
        </div>
        <span class="reading-row-action" aria-hidden="true">↗</span>
      </li>`;
    })
    .join('')}</ul>`;
}

function renderReadingSpeechRows(speeches, { bank, startIndex = 1 } = {}) {
  const items = CB_SPEECH_I18N.localizeSpeeches(speeches, bank);
  if (!items?.length) {
    return '<div class="empty-state">暂无货币政策/汇率相关官员讲话</div>';
  }
  return `<ul class="reading-list">${items
    .map((item, i) => {
      const stars = Math.max(1, Math.min(5, item.stars || 1));
      const dateStr = item.pubDate ? formatDate(item.pubDate) : '';
      const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;
      return `<li class="reading-row reading-row-speech reading-stars-${stars}" data-link="${escapeAttr(item.link)}" data-idx="${i}">
        <span class="reading-row-idx">${startIndex + i}</span>
        <time class="reading-row-date">${escapeHtml(shortDate)}</time>
        <div class="reading-row-main">
          <div class="reading-row-head">
            ${renderPolicyStars(stars)}
            <span class="reading-row-badge reading-badge-speech">讲话</span>
            <span class="reading-row-official">${escapeHtml(item.officialDisplay || item.official || '央行官员')}</span>
            <span class="reading-row-topic">${escapeHtml(item.topicLabel || '政策沟通')}</span>
          </div>
          <h4 class="reading-row-title">${escapeHtml(item.title)}</h4>
          ${item.impactHint ? `<p class="reading-row-summary">${escapeHtml(item.impactHint)}</p>` : ''}
        </div>
        <span class="reading-row-action" aria-hidden="true">↗</span>
      </li>`;
    })
    .join('')}</ul>`;
}

function renderCentralBankTimeline(speeches, news, { bank } = {}) {
  const speechItems = CB_SPEECH_I18N.localizeSpeeches(speeches, bank).map((item) => ({
    kind: 'speech',
    pubDate: item.pubDate,
    link: item.link,
    item,
  }));
  const newsItems = (bank === 'boj' ? BOJ_I18N.localizeNews(news || []) : news || []).map((item) => ({
    kind: 'news',
    pubDate: item.pubDate,
    link: item.link,
    item,
  }));
  const merged = [...speechItems, ...newsItems].sort(
    (a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0)
  );
  if (!merged.length) {
    return '<div class="empty-state">暂无动态，请稍后刷新</div>';
  }
  return `<ul class="reading-list">${merged
    .map((row, i) => {
      const dateStr = row.pubDate ? formatDate(row.pubDate) : '';
      const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;
      if (row.kind === 'speech') {
        const item = row.item;
        const stars = Math.max(1, Math.min(5, item.stars || 1));
        return `<li class="reading-row reading-row-speech reading-stars-${stars}" data-link="${escapeAttr(row.link)}" data-idx="${i}">
          <span class="reading-row-idx">${i + 1}</span>
          <time class="reading-row-date">${escapeHtml(shortDate)}</time>
          <div class="reading-row-main">
            <div class="reading-row-head">
              ${renderPolicyStars(stars)}
              <span class="reading-row-badge reading-badge-speech">讲话</span>
              <span class="reading-row-official">${escapeHtml(item.officialDisplay || item.official || '央行官员')}</span>
            </div>
            <h4 class="reading-row-title">${escapeHtml(item.title)}</h4>
          </div>
          <span class="reading-row-action" aria-hidden="true">↗</span>
        </li>`;
      }
      const item = row.item;
      return `<li class="reading-row reading-row-news" data-link="${escapeAttr(row.link)}" data-idx="${i}">
        <span class="reading-row-idx">${i + 1}</span>
        <time class="reading-row-date">${escapeHtml(shortDate)}</time>
        <div class="reading-row-main">
          <span class="reading-row-badge reading-badge-news">公告</span>
          <h4 class="reading-row-title">${escapeHtml(item.title)}</h4>
          ${item.summary ? `<p class="reading-row-summary">${escapeHtml(item.summary)}</p>` : ''}
        </div>
        <span class="reading-row-action" aria-hidden="true">↗</span>
      </li>`;
    })
    .join('')}</ul>`;
}

function renderCentralBankReadingTabs(key, source) {
  const tab = getCbTab(key);
  const speechCount = source.speeches?.length || 0;
  const newsCount = source.news?.length || 0;
  const timelineCount = speechCount + newsCount;
  const tabs = [
    { id: 'timeline', label: '时间线', count: timelineCount },
    { id: 'speeches', label: '官员讲话', count: speechCount },
    { id: 'news', label: '公告新闻', count: newsCount },
  ];
  const tabBar = tabs
    .map(
      (t) =>
        `<button type="button" class="cb-reading-tab ${tab === t.id ? 'active' : ''}" data-cb-tab="${t.id}" data-bank="${key}">${t.label}<span class="cb-tab-count">${t.count}</span></button>`
    )
    .join('');

  const locale = key === 'boj' ? 'boj' : undefined;
  const panes = tabs
    .map((t) => {
      let body = '';
      if (t.id === 'timeline') body = renderCentralBankTimeline(source.speeches, source.news, { bank: key });
      else if (t.id === 'speeches') body = renderReadingSpeechRows(source.speeches, { bank: key });
      else body = renderReadingNewsRows(source.news, { locale });
      return `<div class="cb-reading-pane ${tab === t.id ? 'active' : ''}" data-cb-pane="${t.id}">${body}</div>`;
    })
    .join('');

  return `<div class="cb-reading-tabs">${tabBar}</div><div class="cb-reading-panes">${panes}</div>`;
}

function renderCentralBankPanel(key, source) {
  const payload = key === 'boj' ? localizeBojSource(source) : source;
  const liveTag = payload.liveRefreshedAt
    ? `<span class="${key === 'fed' ? 'fed' : 'boj'}-live-tag">实时 ${formatDate(payload.liveRefreshedAt)}</span>`
    : '';
  const note =
    key === 'boj'
      ? '数据来源：日本央行官网 · 圣路易斯联储 FRED · 新浪财经 · 无担保隔夜拆借利率为官方 XLSX 速报'
      : '数据来源：美联储 RSS · 圣路易斯联储 FRED · 财政部 · 新浪财经';
  const panelClass = key === 'boj' ? 'boj-panel cb-reading-panel' : 'fed-panel cb-reading-panel';

  return `<div class="panel ${key === activeTab ? 'active' : ''}" id="panel-${key}" role="tabpanel" data-cb-bank="${key}">
    <div class="${panelClass}">
      <header class="cb-reading-head">
        <div class="cb-reading-head-text">
          <h2 class="cb-reading-title">${escapeHtml(TAB_LABELS[key])}</h2>
          <p class="cb-reading-sub">关键指标一览 · 时间线阅读 · 点击条目打开原文</p>
        </div>
        ${liveTag}
      </header>
      <section class="cb-kpi-section">
        <h3 class="cb-section-label"><span class="dot ${DOT_CLASS[key]}"></span>关键经济指标</h3>
        ${renderIndicatorKpiStrip(payload.indicators)}
      </section>
      <section class="cb-reading-section">
        <h3 class="cb-section-label"><span class="dot ${DOT_CLASS[key]}"></span>政策动态</h3>
        ${renderCentralBankReadingTabs(key, payload)}
      </section>
      <p class="cb-reading-note">${note}</p>
    </div>
  </div>`;
}

function setupCentralBankPanel(key) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;

  panel.querySelectorAll('.cb-reading-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.cbTab || 'timeline';
      cbPanelTab[key] = tab;
      panel.querySelectorAll('.cb-reading-tab').forEach((b) =>
        b.classList.toggle('active', b.dataset.cbTab === tab)
      );
      panel.querySelectorAll('.cb-reading-pane').forEach((p) =>
        p.classList.toggle('active', p.dataset.cbPane === tab)
      );
    });
  });
  setupNewsItems(panel);
}

function renderIndicators(indicators) {
  if (!indicators?.length) {
    return '<div class="empty-state">暂无指标数据</div>';
  }

  return `<ul class="indicator-list">${indicators
    .map((ind) => {
      const changeHtml =
        ind.change != null
          ? `<span class="${parseFloat(ind.change) >= 0 ? 'change-up' : 'change-down'}">${parseFloat(ind.change) >= 0 ? '▲' : '▼'} ${Math.abs(parseFloat(ind.change))}</span>`
          : '';
      return `<li class="indicator-item">
        <span class="indicator-name">${escapeHtml(ind.name)}</span>
        <div class="indicator-value">
          <div class="value">${escapeHtml(formatIndicatorValue(ind))}</div>
          <div class="meta">${ind.date ? formatDate(ind.date) : ''} ${changeHtml}</div>
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

function localizeBojSource(source) {
  if (!source) return source;
  return BOJ_I18N.localizeSource(source);
}

function repatchBojNewsInDom() {
  const panel = document.getElementById('panel-boj');
  if (!panel) return;
  panel.querySelectorAll('.news-item, .reading-row-news').forEach((el) => {
    const titleEl = el.querySelector('.news-title, .reading-row-title');
    const summaryEl = el.querySelector('.news-summary, .reading-row-summary');
    if (titleEl && BOJ_I18N.needsTranslation(titleEl.textContent)) {
      titleEl.textContent = BOJ_I18N.translateTitle(titleEl.textContent);
    }
    if (summaryEl && BOJ_I18N.needsTranslation(summaryEl.textContent)) {
      summaryEl.textContent = BOJ_I18N.translateSpeaker(summaryEl.textContent);
    }
  });
}

function renderNews(news, { locale } = {}) {
  const items = locale === 'boj' ? BOJ_I18N.localizeNews(news || []) : news;
  if (!items?.length) {
    return '<div class="empty-state">暂无新闻，请稍后刷新</div>';
  }

  return `<ul class="news-list">${items
    .map(
      (item, i) => `<li class="news-item" data-link="${escapeAttr(item.link)}" data-idx="${i}">
        <div class="news-title">${escapeHtml(item.title)}</div>
        <div class="news-meta">
          <span>${formatDate(item.pubDate)}</span>
        </div>
        ${item.summary ? `<div class="news-summary">${escapeHtml(item.summary)}</div>` : ''}
      </li>`
    )
    .join('')}</ul>`;
}

function renderCbSpeeches(speeches, { bank } = {}) {
  const items = CB_SPEECH_I18N.localizeSpeeches(speeches, bank);
  if (!items?.length) {
    return '<div class="empty-state">暂无货币政策/汇率相关官员讲话</div>';
  }

  return `<ul class="cb-speech-list">${items
    .map((item) => {
      const stars = Math.max(1, Math.min(5, item.stars || 1));
      return `<li class="cb-speech-item cb-speech-stars-${stars}" data-link="${escapeAttr(item.link)}">
        <div class="cb-speech-head">
          ${renderPolicyStars(stars)}
          <span class="cb-speech-official">${escapeHtml(item.officialDisplay || item.official || '央行官员')}</span>
          <span class="cb-speech-topic">${escapeHtml(item.topicLabel || '政策沟通')}</span>
        </div>
        <div class="cb-speech-title">${escapeHtml(item.title)}</div>
        <div class="cb-speech-meta">
          <span>${formatDate(item.pubDate)}</span>
          ${item.impactHint ? `<span class="cb-speech-hint">${escapeHtml(item.impactHint)}</span>` : ''}
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

function renderCbSpeechesSection(speeches, { bank } = {}) {
  return `<section class="section cb-speeches-section cb-speeches-${bank || 'fed'}">
      <div class="section-header"><span class="dot ${bank === 'boj' ? DOT_CLASS.boj : DOT_CLASS.fed}"></span>官员货币政策与汇率讲话</div>
      <div class="section-body">${renderCbSpeeches(speeches, { bank })}</div>
    </section>`;
}

function repatchCbSpeechesInDom(bank) {
  const panel = document.getElementById(`panel-${bank}`);
  if (!panel) return;
  panel.querySelectorAll('.cb-speech-item, .reading-row-speech').forEach((el) => {
    const titleEl = el.querySelector('.cb-speech-title, .reading-row-title');
    const officialEl = el.querySelector('.cb-speech-official, .reading-row-official');
    if (titleEl && CB_SPEECH_I18N.needsSpeechTranslation(titleEl.textContent)) {
      titleEl.textContent =
        bank === 'boj'
          ? BOJ_I18N.translateTitle(titleEl.textContent)
          : CB_SPEECH_I18N.translateFedTitle(titleEl.textContent);
    }
    if (officialEl && CB_SPEECH_I18N.needsSpeechTranslation(officialEl.textContent)) {
      officialEl.textContent = CB_SPEECH_I18N.localizeSpeech(
        { officialDisplay: officialEl.textContent },
        bank
      ).officialDisplay;
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function formatNumber(num, digits = 2) {
  if (num == null || Number.isNaN(num)) return '—';
  return Number(num).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function renderIndexCard(idx) {
  const up = idx.change >= 0;
  const changeClass = up ? 'change-up' : 'change-down';
  const arrow = up ? '▲' : '▼';
  const staleBadge = idx.stale
    ? '<span class="index-stale-badge" title="数据源仅提供昨收">昨收</span>'
    : '';
  const errorBadge = idx.error
    ? `<span class="index-error-badge" title="${escapeAttr(idx.error)}">异常</span>`
    : '';
  return `<div class="index-card index-card-clickable${idx.stale ? ' index-card-stale' : ''}" data-index-id="${escapeAttr(idx.id)}" role="button" tabindex="0" title="查看20年走势">
    <div class="index-card-head">
      <span class="index-name">${escapeHtml(idx.name)}${staleBadge}${errorBadge}</span>
      <span class="index-market">${escapeHtml(idx.market)}</span>
    </div>
    <div class="index-price">${formatNumber(idx.price, idx.price >= 1000 ? 2 : 2)}</div>
    <div class="index-change ${changeClass}">
      ${arrow} ${formatNumber(Math.abs(idx.change), 2)}
      <span class="index-pct">（${up ? '+' : ''}${formatNumber(idx.changePct, 2)}%）</span>
      ${idx.changeNote ? `<span class="index-note">${escapeHtml(idx.changeNote)}</span>` : ''}
    </div>
  </div>`;
}

function renderIndicesPanel(source) {
  const regions = source.regions || [];
  const hasData = regions.some((r) => r.indices?.length);

  if (!hasData) {
    if (indicesLoading) {
      return `<div class="panel ${activeTab === 'indices' ? 'active' : ''}" id="panel-indices" role="tabpanel">
        <div class="empty-state index-empty"><div class="spinner inline-spinner"></div> 正在加载指数…</div>
      </div>`;
    }
    return `<div class="panel ${activeTab === 'indices' ? 'active' : ''}" id="panel-indices" role="tabpanel">
      <div class="empty-state index-empty">暂无指数数据，请检查网络后刷新</div>
    </div>`;
  }

  const stats = source.indexStats;
  const statsHtml = stats
    ? `<div class="index-stats">已加载 ${stats.success} / ${stats.total} 个指数${stats.failed ? `，${stats.failed} 个暂不可用` : ''}</div>`
    : '';

  const regionsHtml = regions
    .filter((r) => r.indices?.length)
    .map(
      (region) => `<section class="index-region">
        <h3 class="index-region-title"><span class="dot dot-indices"></span>${escapeHtml(region.name)}</h3>
        <div class="index-grid">${region.indices.map(renderIndexCard).join('')}</div>
      </section>`
    )
    .join('');

  return `<div class="panel ${activeTab === 'indices' ? 'active' : ''}" id="panel-indices" role="tabpanel">
    ${statsHtml}
    <div class="indices-wrap">${regionsHtml}</div>
    <section class="history-section">
      <div class="history-header">
        <h3 class="index-region-title"><span class="dot dot-indices"></span>K 线走势（近 20 年）</h3>
        <div class="history-controls">
          <label for="historySelect" class="sr-only">选择指数</label>
          <select id="historySelect" class="history-select"></select>
        </div>
      </div>
      <div class="kline-tabs" id="klineTabs" role="tablist">
        <button type="button" class="kline-tab" data-tf="year">年K</button>
        <button type="button" class="kline-tab" data-tf="month">月K</button>
        <button type="button" class="kline-tab active" data-tf="day">日K</button>
        <button type="button" class="kline-tab" data-tf="hour">小时K</button>
      </div>
      <div id="historySummary" class="history-summary"></div>
      <div class="kline-scroll-row">
        <label for="klineScroll">时间轴</label>
        <input id="klineScroll" type="range" min="0" max="0" value="0" />
        <span id="klineScrollLabel" class="kline-scroll-label"></span>
      </div>
      <div id="historyChart" class="history-chart">
        <div class="chart-loading">正在加载K线数据…</div>
      </div>
      <details class="kline-table-wrap" id="klineTableWrap">
        <summary>查看完整开高低收量数据</summary>
        <div class="kline-table-scroll">
          <table class="kline-table" id="klineTable"></table>
        </div>
      </details>
    </section>
  </div>`;
}

const MACRO_CATEGORY_ORDER = [
  'rates',
  'prices',
  'money',
  'trade',
  'production',
  'sentiment',
  'employment',
  'markets',
];

const MACRO_CATEGORY_LABELS = {
  rates: '利率',
  prices: '物价',
  money: '货币信贷',
  trade: '贸易',
  production: '生产消费',
  sentiment: '景气与信心',
  employment: '就业',
  markets: '市场',
};

function renderForexCard(pair) {
  const up = pair.change >= 0;
  const changeClass = up ? 'change-up' : 'change-down';
  const arrow = up ? '▲' : '▼';
  const digits = pair.decimals ?? (pair.price >= 100 ? 2 : 4);
  const timeLabel = pair.quoteTime ? ` ${pair.quoteTime}` : '';
  return `<div class="forex-card" data-forex-id="${escapeAttr(pair.id)}">
    <div class="forex-card-head">
      <span class="forex-name">${escapeHtml(pair.name)}</span>
      <span class="forex-code">${escapeHtml(pair.code)}</span>
    </div>
    <div class="forex-price">${formatNumber(pair.price, digits)}</div>
    <div class="forex-change ${changeClass}">
      ${arrow} ${formatNumber(Math.abs(pair.change), digits)}
      <span class="forex-pct">（${up ? '+' : ''}${formatNumber(pair.changePct, 2)}%）</span>
    </div>
    <div class="forex-meta">${pair.tradeDate ? escapeHtml(String(pair.tradeDate).slice(0, 10)) : ''}${escapeHtml(timeLabel)}</div>
  </div>`;
}

function renderForexGroups(source) {
  const groups = source.groups || [];
  if (!groups.length && source.pairs?.length) {
    return `<div class="forex-grid">${source.pairs.map(renderForexCard).join('')}</div>`;
  }
  return groups
    .map(
      (group) => `<section class="forex-group">
        <h3 class="forex-group-title"><span class="dot dot-forex"></span>${escapeHtml(group.label)}</h3>
        <div class="forex-grid">${(group.pairs || []).map(renderForexCard).join('')}</div>
      </section>`
    )
    .join('');
}

function renderPolicyStars(stars) {
  const n = Math.max(1, Math.min(5, stars || 1));
  return `<span class="policy-stars policy-stars-${n}" title="影响程度 ${n}/5"><span class="policy-stars-fill">${'★'.repeat(n)}</span><span class="policy-stars-empty">${'☆'.repeat(5 - n)}</span></span>`;
}

function getFilteredPolicyItemsForView(items) {
  let list = filterBasePolicyItems(items || []);
  if (policyViewMode === 'commodity') {
    return [];
  }
  if (policyViewMode === 'all') {
    list = list.filter((item) => !item.commodities?.length);
  } else if (policyViewMode === 'high') {
    list = list.filter((item) => item.stars >= 4);
  }
  return list.sort((a, b) => {
    const starDiff = b.stars - a.stars;
    if (starDiff !== 0) return starDiff;
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });
}

function renderPolicyReadingCard(item, index) {
  const commodityTags = (item.commodities || [])
    .map(
      (c) =>
        `<button type="button" class="policy-tag policy-tag-commodity" data-commodity-id="${escapeAttr(c.id)}">${escapeHtml(c.name)}</button>`
    )
    .join('');
  const n = Math.max(1, Math.min(5, item.stars || 1));
  const dir = item.direction || 'neutral';
  const isCommodity = Boolean(item.commodities?.length);
  const dateStr = item.pubDate ? formatDate(item.pubDate) : '';
  const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;

  return `<article class="policy-reading-row policy-card-stars-${n} ${isCommodity ? 'policy-reading-row-commodity' : ''}" data-policy-id="${escapeAttr(item.id)}" data-link="${escapeAttr(item.link)}" data-stars="${n}">
    <span class="reading-row-idx">${index}</span>
    <time class="reading-row-date">${escapeHtml(shortDate)}</time>
    <div class="policy-reading-main">
      <div class="policy-reading-meta">
        ${renderPolicyStars(item.stars)}
        ${policyPhilosophyThemeTag(item)}
        <span class="policy-region policy-region-${item.region || 'cn'}">${escapeHtml(item.regionLabel || '中国')}</span>
        <span class="policy-dept-pill">${escapeHtml(item.departmentShort || item.departmentName)}</span>
        <span class="policy-tag policy-tag-direction policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span>
        ${isCommodity ? '<span class="reading-row-badge reading-badge-commodity">大宗</span>' : ''}
      </div>
      <h3 class="policy-reading-row-title">${escapeHtml(item.title)}</h3>
      ${item.summary ? `<p class="policy-reading-summary">${escapeHtml(item.summary)}</p>` : ''}
      ${item.impactSummary ? `<p class="policy-reading-impact policy-impact-${dir}"><strong>影响：</strong>${escapeHtml(item.impactSummary)}</p>` : ''}
      ${commodityTags ? `<div class="policy-tags">${commodityTags}</div>` : ''}
    </div>
    <span class="reading-row-action" aria-hidden="true">↗</span>
  </article>`;
}

function renderPolicyReadingList(items) {
  if (!items.length) {
    return '<div class="empty-state policy-feed-empty">当前筛选条件下暂无政策</div>';
  }
  return '<div class="virtual-list-pending" aria-hidden="true"></div>';
}

function renderPolicyDeptChips(source) {
  const groups = (source.groups || []).filter(
    (g) => policyFilterRegion === 'all' || g.region === policyFilterRegion || g.region === 'all'
  );
  const allCount = filterBasePolicyItems(source.items || []).length;
  const chips = [
    `<button type="button" class="policy-dept-btn ${policyFilterDept === 'all' ? 'active' : ''}" data-dept="all">全部 <span>${allCount}</span></button>`,
    ...groups.map((g) => {
      const count =
        policyFilterRegion === 'all'
          ? g.items?.length || 0
          : g.items?.filter((i) => i.region === policyFilterRegion).length || 0;
      const prefix = policyFilterRegion === 'all' && g.region ? (g.region === 'us' ? '🇺🇸 ' : '🇨🇳 ') : '';
      return `<button type="button" class="policy-dept-btn ${policyFilterDept === g.id ? 'active' : ''}" data-dept="${escapeAttr(g.id)}">${prefix}${escapeHtml(g.label)} <span>${count}</span></button>`;
    }),
  ];
  return chips.join('');
}

function renderPolicyViewTabs(source) {
  const items = source.items || [];
  const allCount = filterBasePolicyItems(items).length;
  const commodityCount = filterBasePolicyItems(items).filter((i) => i.commodities?.length).length;
  const highCount = filterBasePolicyItems(items).filter((i) => i.stars >= 4).length;
  const tabs = [
    { id: 'all', label: '全部', count: allCount },
    { id: 'commodity', label: '大宗关联', count: commodityCount },
    { id: 'high', label: '高影响 ≥4星', count: highCount },
  ];
  return tabs
    .map(
      (t) =>
        `<button type="button" class="policy-view-tab ${policyViewMode === t.id ? 'active' : ''}" data-view="${t.id}">${t.label}<span class="cb-tab-count">${t.count}</span></button>`
    )
    .join('');
}

function renderPolicyStatsInline(stats, items) {
  if (!stats) return '';
  const commodityTotal = (items || []).filter((i) => i.commodities?.length).length;
  return `<div class="policy-stats-inline">
    <span><strong>${stats.total}</strong> 监测</span>
    <span class="policy-stat-warn-inline"><strong>${stats.highImpact}</strong> 高影响</span>
    <button type="button" class="policy-stat-commodity-inline" data-action="jump-commodity"><strong>${commodityTotal}</strong> 大宗关联</button>
    <span>🇨🇳 ${stats.cn?.total ?? '—'}</span>
    <span>🇺🇸 ${stats.us?.total ?? '—'}</span>
  </div>`;
}

function filterBasePolicyItems(items) {
  if (!items?.length) return [];
  return items.filter((item) => {
    if (policyFilterRegion !== 'all' && item.region !== policyFilterRegion) return false;
    if (policyFilterDept !== 'all' && item.departmentId !== policyFilterDept) return false;
    if (item.stars < policyMinStars) return false;
    return true;
  });
}

function getCommodityPolicyItems(items) {
  return filterBasePolicyItems(items)
    .filter((item) => item.commodities?.length)
    .filter(
      (item) =>
        policyFilterCommodityId === 'all' ||
        item.commodities.some((c) => normCommodityId(c.id) === normCommodityId(policyFilterCommodityId))
    )
    .sort((a, b) => {
      const starDiff = b.stars - a.stars;
      if (starDiff !== 0) return starDiff;
      return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
    });
}

function getGeneralPolicyItems(items) {
  return filterBasePolicyItems(items)
    .filter((item) => !item.commodities?.length)
    .sort((a, b) => {
      const starDiff = b.stars - a.stars;
      if (starDiff !== 0) return starDiff;
      return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
    });
}

function getPolicyCommodityIntel(source) {
  return source?.commodityIntel || window.__policyCommodityIntel || null;
}

function normCommodityId(id) {
  return String(id || '').toLowerCase();
}

function getMasterCommodityCatalog() {
  return window.__commodityMasterCatalog || [];
}

async function ensureCommodityMasterCatalog() {
  if (getMasterCommodityCatalog().length) return getMasterCommodityCatalog();
  if (typeof window.fancheng?.fetchCommodityCatalog !== 'function') return [];
  const list = await window.fancheng.fetchCommodityCatalog();
  if (Array.isArray(list) && list.length) {
    window.__commodityMasterCatalog = list;
  }
  return getMasterCommodityCatalog();
}

function buildFullCommodityCatalog(source) {
  const master = getMasterCommodityCatalog();
  if (!master.length) return getCommodityCatalogFallback(source);

  const intel = getPolicyCommodityIntel(source);
  const intelMap = new Map((intel?.catalog || []).map((c) => [normCommodityId(c.id), c]));
  const policyItems = filterBasePolicyItems(source?.items || []);

  return master.map((m) => {
    const fromIntel = intelMap.get(normCommodityId(m.id));
    let policyCount = fromIntel?.policyCount ?? 0;
    if (!policyCount) {
      policyCount = policyItems.filter((p) =>
        p.commodities?.some((c) => normCommodityId(c.id) === normCommodityId(m.id))
      ).length;
    }
    const cached = window.__commodityNewsCache?.[m.id];
    const cnNewsCount = cached?.cn?.length ?? fromIntel?.cnNewsCount ?? 0;
    const globalNewsCount = cached?.global?.length ?? fromIntel?.globalNewsCount ?? 0;
    const geoNewsCount =
      fromIntel?.geoNewsCount ??
      (window.__geoCacheItems || []).filter((i) =>
        i.commodities?.some((c) => normCommodityId(c.id) === normCommodityId(m.id))
      ).length;
    return {
      ...m,
      exchangeLabel: POLICY_EXCHANGE_LABELS[m.exchangeId] || m.exchange,
      policyCount,
      cnNewsCount,
      globalNewsCount,
      geoNewsCount,
      totalCount: policyCount + cnNewsCount + globalNewsCount + geoNewsCount,
    };
  });
}

function getCommodityCatalogFallback(source) {
  const map = new Map();
  for (const item of filterBasePolicyItems(source?.items || [])) {
    for (const c of item.commodities || []) {
      if (!map.has(c.id)) {
        map.set(c.id, {
          id: c.id,
          name: c.name,
          exchangeId: '',
          exchange: '',
          exchangeLabel: '',
          policyCount: 0,
          cnNewsCount: 0,
          globalNewsCount: 0,
          totalCount: 0,
        });
      }
      const row = map.get(c.id);
      row.policyCount += 1;
      row.totalCount += 1;
    }
  }
  return [...map.values()];
}

function getCommodityCatalog(source) {
  const full = buildFullCommodityCatalog(source);
  return full.length ? full : getCommodityCatalogFallback(source);
}

function flattenCommodityNews(data) {
  if (!data || data.error) return { cn: [], global: [] };
  const cn = [
    ...(data.related || []),
    ...(data.industry || []),
    ...(data.futures || []),
    ...(data.macro || []),
    ...(data.general || []),
  ];
  const global = data.global || [];
  const seenCn = new Set();
  const seenGl = new Set();
  return {
    cn: cn.filter((item) => {
      const k = (item.link || item.title || '').toLowerCase();
      if (!k || seenCn.has(k)) return false;
      seenCn.add(k);
      return true;
    }),
    global: global.filter((item) => {
      const k = (item.link || item.title || '').toLowerCase();
      if (!k || seenGl.has(k)) return false;
      seenGl.add(k);
      return true;
    }),
    partial: Boolean(data.partial),
    fromCache: Boolean(data.fromCache),
    fetchedAt: data.fetchedAt,
  };
}

function isGarbledGlobalTitle(title) {
  const s = String(title || '');
  if (/于[a-z]{2,}|美联储公告摘要:[A-Za-z]{5,}|美联储人事任命公告:[A-Za-z]{5,}|mkesfirst|于clud/i.test(s)) {
    return true;
  }
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin > 6 && latin > cjk;
}

async function loadPolicyCommodityNews(commodityId, { force = false } = {}) {
  if (!commodityId || commodityId === 'all') return;
  const cached = window.__commodityNewsCache?.[commodityId];
  if (!force && cached?.global?.some((i) => isGarbledGlobalTitle(i.title))) {
    force = true;
  }
  if (!force && cached?.global?.length && cached.global.every((i) => isGarbledGlobalTitle(i.title))) {
    force = true;
  }
  policyCommodityNewsLoading = commodityId;
  const panel = document.getElementById('panel-policy');
  if (panel) refreshPolicyCommodityZoneOnly(panel);

  try {
    const fetchFn = force ? window.fancheng.refreshCommodityNews : window.fancheng.fetchCommodityNews;
    const data = await fetchFn(commodityId);
    if (data?.error) throw new Error(data.error);
    const parsed = flattenCommodityNews(data);
    window.__commodityNewsCache = window.__commodityNewsCache || {};
    window.__commodityNewsCache[commodityId] = parsed;
  } catch (err) {
    window.__commodityNewsCache = window.__commodityNewsCache || {};
    window.__commodityNewsCache[commodityId] = {
      cn: [],
      global: [],
      error: err?.message || '资讯加载失败',
    };
  } finally {
    policyCommodityNewsLoading = null;
    if (panel) {
      refreshPolicyPanelSections(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
        commodityIntel: window.__policyCommodityIntel,
      });
    }
  }
}

function refreshPolicyCommodityZoneOnly(panel) {
  const zone = panel?.querySelector('#policy-commodity-zone');
  if (!zone) return;
  zone.outerHTML = renderPolicyCommoditySection({
    items: window.__policyCacheItems || [],
    commodityIntel: window.__policyCommodityIntel,
  });
}

async function initPolicyCommodityPanel() {
  await ensureCommodityMasterCatalog();
  const catalog = buildFullCommodityCatalog({ items: window.__policyCacheItems });
  if (!catalog.length) return;

  if (policyFilterCommodityId === 'all') {
    const inExchange =
      policyCommodityExchangeFilter === 'all'
        ? catalog
        : catalog.filter((c) => c.exchangeId === policyCommodityExchangeFilter);
    const first = inExchange[0] || catalog[0];
    if (first) {
      policyFilterCommodityId = first.id;
      policyCommodityExchangeFilter = first.exchangeId || policyCommodityExchangeFilter;
      await loadPolicyCommodityNews(first.id);
    }
  } else if (!window.__commodityNewsCache?.[policyFilterCommodityId]) {
    await loadPolicyCommodityNews(policyFilterCommodityId);
  }
}

function selectCommodityInExchange(exchangeId, commodityId) {
  policyCommodityExchangeFilter = exchangeId;
  policyFilterCommodityId = commodityId;
  loadPolicyCommodityNews(commodityId);
}

function filterCatalogByExchange(catalog) {
  if (policyCommodityExchangeFilter === 'all') return catalog;
  return catalog.filter((c) => c.exchangeId === policyCommodityExchangeFilter);
}

function getCommodityIntelFeed(intel, commodityId) {
  if (!intel) return { policies: [], cnNews: [], globalNews: [], geoNews: [], counts: { total: 0 } };
  if (commodityId === 'all') return null;
  const id = normCommodityId(commodityId);
  const feed =
    intel.feeds?.[commodityId] ||
    intel.feeds?.[Object.keys(intel.feeds || {}).find((k) => k.toLowerCase() === id)];
  const geoFeed =
    intel.geoFeeds?.[commodityId] ||
    intel.geoFeeds?.[Object.keys(intel.geoFeeds || {}).find((k) => k.toLowerCase() === id)];
  return {
    policies: feed?.policies || [],
    cnNews: feed?.cnNews || [],
    globalNews: feed?.globalNews || [],
    geoNews: geoFeed?.geoNews || feed?.geoNews || [],
    counts: feed?.counts || { total: 0 },
  };
}

function getCommodityZoneRows(source) {
  const allItems = source.items || [];

  if (policyFilterCommodityId !== 'all') {
    const policies = getCommodityPolicyItems(allItems).filter((p) =>
      p.commodities?.some((c) => normCommodityId(c.id) === normCommodityId(policyFilterCommodityId))
    );
    const cached = window.__commodityNewsCache?.[policyFilterCommodityId];
    const intel = getPolicyCommodityIntel(source);
    const feed = getCommodityIntelFeed(intel, policyFilterCommodityId);

    let cnNews = (cached?.cn || []).map((n) => ({ ...n, intelType: 'cn' }));
    let globalNews = (cached?.global || []).map((n) => ({ ...n, intelType: 'global' }));
    let geoNews = (window.__geoCacheItems || [])
      .filter((i) => i.commodities?.some((c) => normCommodityId(c.id) === normCommodityId(policyFilterCommodityId)))
      .map((n) => ({ ...n, intelType: 'geo' }));

    if (!cnNews.length && feed?.cnNews?.length) {
      cnNews = feed.cnNews.map((n) => ({ ...n, intelType: 'cn' }));
    }
    if (!globalNews.length && feed?.globalNews?.length) {
      globalNews = feed.globalNews.map((n) => ({ ...n, intelType: 'global' }));
    }
    if (!geoNews.length && feed?.geoNews?.length) {
      geoNews = feed.geoNews.map((n) => ({ ...n, intelType: 'geo' }));
    }

    return {
      policies,
      cnNews,
      globalNews,
      geoNews,
      loading: policyCommodityNewsLoading === policyFilterCommodityId,
      error: cached?.error,
    };
  }

  return {
    policies: getCommodityPolicyItems(allItems),
    cnNews: [],
    globalNews: [],
    geoNews: [],
    loading: false,
    error: null,
  };
}

function renderCommodityExchangeTabs(catalog) {
  const master = getMasterCommodityCatalog().length ? getMasterCommodityCatalog() : catalog;
  const exchanges = [
    { id: 'shfe', label: '上期所' },
    { id: 'ine', label: '上期能源' },
    { id: 'dce', label: '大商所' },
    { id: 'zce', label: '郑商所' },
    { id: 'gfex', label: '广期所' },
  ];
  return exchanges
    .map((ex) => {
      const count = master.filter((c) => c.exchangeId === ex.id).length;
      return `<button type="button" class="policy-exchange-tab ${policyCommodityExchangeFilter === ex.id ? 'active' : ''}" data-exchange="${ex.id}">${ex.label}<span>${count}</span></button>`;
    })
    .join('');
}

function renderPolicyCommodityChipsGrid(source) {
  const catalog = filterCatalogByExchange(getCommodityCatalog(source));

  const chips = catalog.map((c) => {
    const count = c.totalCount || 0;
    const cn = c.cnNewsCount || 0;
    const gl = c.globalNewsCount || 0;
    const geo = c.geoNewsCount || 0;
    const active = policyFilterCommodityId === c.id;
    return `<button type="button" class="policy-commodity-chip ${active ? 'active' : ''}" data-commodity="${escapeAttr(c.id)}" title="${escapeAttr(c.exchangeLabel || c.exchange || '')} · 政策${c.policyCount || 0} · 地缘${geo}">${escapeHtml(c.name)}<span class="policy-chip-meta">${cn ? `<i cn>${cn}</i>` : ''}${gl ? `<i gl>${gl}</i>` : ''}${geo ? `<i geo>${geo}</i>` : ''}${c.policyCount ? `<b p>${c.policyCount}</b>` : ''}</span></button>`;
  });
  return chips.length ? chips.join('') : '<div class="policy-commodity-empty policy-commodity-empty-inline">该交易所暂无品种配置</div>';
}

function renderCommodityGeoRow(item, index) {
  const dateStr = item.pubDate ? formatDate(item.pubDate) : '';
  const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;
  const dir = item.direction || 'neutral';
  const dims = (item.dimensions || [])
    .slice(0, 2)
    .map((d) => escapeHtml(d.shortLabel || d.label))
    .join('·');
  const scholar = item.analysis?.scholarRefs?.[0];
  const scholarLine = scholar
    ? `${scholar.name}：${String(scholar.quote).slice(0, 56)}…`
    : '';
  const logic = item.analysis?.logicChain?.[1]?.text || item.commodityImpactSummary || item.impactSummary || '';
  const claimLead = String(logic || '')
    .replace(/\s+/g, ' ')
    .slice(0, 28);
  const dirLead = claimLead
    ? `<span class="policy-claim-lead" title="${escapeAttr(logic)}">${escapeHtml(claimLead)}${claimLead.length >= 28 ? '…' : ''}</span><span class="policy-dir-pill policy-dir-pill-secondary policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span>`
    : `<span class="policy-dir-pill policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span>`;

  return `<article class="policy-commodity-row policy-commodity-row-geo policy-commodity-row-${dir}" data-link="${escapeAttr(item.link || '')}" data-geo-id="${escapeAttr(item.id || '')}">
    <div class="pcol pcol-stars">${renderPolicyStars(item.stars)}</div>
    <div class="pcol pcol-commodities"><span class="reading-row-badge reading-badge-geo">地缘</span></div>
    <div class="pcol pcol-dir">${dirLead}</div>
    <div class="pcol pcol-dept"><span class="policy-tag policy-tag-type">${escapeHtml(dims || '四维竞争')}</span></div>
    <div class="pcol pcol-title">
      <strong>${escapeHtml(item.title || '')}</strong>
      ${logic ? `<span class="pcol-impact">${escapeHtml(logic)}</span>` : ''}
      ${scholarLine ? `<span class="pcol-scholar">📚 ${escapeHtml(scholarLine)}</span>` : ''}
    </div>
    <div class="pcol pcol-time">${escapeHtml(shortDate || '—')}</div>
  </article>`;
}

function renderCommodityNewsRow(item, index) {
  const type = item.intelType === 'global' ? 'global' : 'cn';
  const typeLabel = type === 'global' ? '境外' : '国内';
  const dateStr = item.pubDate ? formatDate(item.pubDate) : '';
  const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;

  return `<article class="policy-commodity-row policy-commodity-row-news policy-commodity-row-${type}" data-link="${escapeAttr(item.link || '')}">
    <div class="pcol pcol-stars"><span class="reading-row-idx">${index}</span></div>
    <div class="pcol pcol-commodities"><span class="reading-row-badge reading-badge-${type === 'global' ? 'speech' : 'news'}">${typeLabel}资讯</span></div>
    <div class="pcol pcol-dir"><span class="policy-dir-pill policy-direction-neutral">${escapeHtml(item.sourceName || '资讯')}</span></div>
    <div class="pcol pcol-dept"><span class="policy-tag policy-tag-type">${type === 'global' ? '境外' : '国内'}</span></div>
    <div class="pcol pcol-title"><strong>${escapeHtml(item.title || '')}</strong>${item.summary ? `<span class="pcol-impact">${escapeHtml(item.summary)}</span>` : ''}</div>
    <div class="pcol pcol-time">${escapeHtml(shortDate || '—')}</div>
  </article>`;
}

function renderCommodityIntelBlock(title, desc, rows, emptyText, { loading = false, error = '', rowRenderer = null } = {}) {
  if (loading) {
    return `<div class="policy-commodity-subblock">
      <header class="policy-commodity-subhead"><h4>${title}</h4><span class="policy-loading-dot">加载中</span></header>
      <div class="policy-commodity-empty policy-commodity-empty-inline">正在从多源抓取${title}…</div>
    </div>`;
  }
  if (error && !rows.length) {
    return `<div class="policy-commodity-subblock">
      <header class="policy-commodity-subhead"><h4>${title}</h4><span>—</span></header>
      <div class="policy-commodity-empty policy-commodity-empty-inline">${escapeHtml(error)}</div>
    </div>`;
  }
  if (!rows.length) {
    return `<div class="policy-commodity-subblock">
      <header class="policy-commodity-subhead"><h4>${title}</h4><span>0</span></header>
      <div class="policy-commodity-empty policy-commodity-empty-inline">${emptyText}</div>
    </div>`;
  }
  const renderRow = rowRenderer || renderCommodityNewsRow;
  return `<div class="policy-commodity-subblock">
    <header class="policy-commodity-subhead"><h4>${title}</h4><span>${rows.length}</span></header>
    <p class="policy-commodity-subdesc">${desc}</p>
    <div class="policy-commodity-rows">${rows.map((r, i) => renderRow(r, i + 1)).join('')}</div>
  </div>`;
}

function renderPolicyCommodityRow(item) {
  const dir = item.direction || 'neutral';
  const commodityBadges = (item.commodities || [])
    .map(
      (c) =>
        `<button type="button" class="policy-commodity-badge" data-commodity-id="${escapeAttr(c.id)}">${escapeHtml(c.name)}</button>`
    )
    .join('');
  const n = Math.max(1, Math.min(5, item.stars || 1));
  // claim-first：方向栏以影响摘要领衔，方向标签次之（非箭头主导）
  const claimLead = String(item.impactSummary || item.commodityImpactSummary || item.analysis?.logicChain?.[1]?.text || '')
    .replace(/\s+/g, ' ')
    .slice(0, 28);
  const dirLead = claimLead
    ? `<span class="policy-claim-lead" title="${escapeAttr(item.impactSummary || claimLead)}">${escapeHtml(claimLead)}${claimLead.length >= 28 ? '…' : ''}</span><span class="policy-dir-pill policy-dir-pill-secondary policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span>`
    : `<span class="policy-dir-pill policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span>`;

  return `<article class="policy-commodity-row policy-commodity-row-stars-${n} policy-commodity-row-${dir}" data-policy-id="${escapeAttr(item.id)}" data-link="${escapeAttr(item.link)}">
    <div class="pcol pcol-stars">${renderPolicyStars(item.stars)}</div>
    <div class="pcol pcol-commodities">${commodityBadges}</div>
    <div class="pcol pcol-dir">${dirLead}</div>
    <div class="pcol pcol-dept">
      <span class="policy-region policy-region-${item.region || 'cn'}">${escapeHtml(item.regionLabel || '')}</span>
      <span>${escapeHtml(item.departmentShort || item.departmentName)}</span>
    </div>
    <div class="pcol pcol-title">
      <strong>${escapeHtml(item.title)}</strong>
      <span class="pcol-impact">${escapeHtml(item.impactSummary || '')}</span>
    </div>
    <div class="pcol pcol-time">${item.pubDate ? formatDate(item.pubDate) : '—'}</div>
  </article>`;
}

function renderPolicyCommoditySection(source) {
  const intel = getPolicyCommodityIntel(source);
  const { policies, cnNews, globalNews, geoNews, loading, error } = getCommodityZoneRows(source);
  const master = getMasterCommodityCatalog();
  const catalog = getCommodityCatalog(source);
  const summary = intel?.summary;
  const totalInView = policies.length + cnNews.length + globalNews.length + geoNews.length;
  const selectedMeta =
    policyFilterCommodityId !== 'all'
      ? catalog.find((c) => normCommodityId(c.id) === normCommodityId(policyFilterCommodityId))
      : null;
  const exchangeLabel = POLICY_EXCHANGE_LABELS[policyCommodityExchangeFilter] || policyCommodityExchangeFilter;

  const policyRows = policies.length
    ? policies.map(renderPolicyCommodityRow).join('')
    : '<div class="policy-commodity-empty policy-commodity-empty-inline">该品种暂无监管政策匹配 · 请查看下方海内外资讯</div>';

  const subtitle = selectedMeta
    ? `${exchangeLabel} · ${selectedMeta.name} · 政策 ${policies.length} · 国内 ${cnNews.length} · 境外 ${globalNews.length} · 地缘 ${geoNews.length}`
    : `请先选择交易所与具体品种（共 ${master.length || catalog.length} 个上市品种）`;

  const refreshBtn =
    policyFilterCommodityId !== 'all'
      ? `<button type="button" class="policy-commodity-refresh" data-action="refresh-commodity-news" data-commodity="${escapeAttr(policyFilterCommodityId)}">刷新该品种资讯</button>`
      : '';

  return `<section class="policy-commodity-zone" id="policy-commodity-zone">
    <div class="policy-zone-grid" aria-hidden="true"></div>
    <div class="policy-zone-radar" aria-hidden="true"></div>
    <header class="policy-zone-head policy-zone-head-commodity">
      <div class="policy-zone-title-wrap">
        <span class="policy-zone-kicker">COMMODITY LINKAGE · FULL COVERAGE</span>
        <h3 class="policy-zone-title">大宗关联政策与资讯</h3>
        <p class="policy-zone-desc">${subtitle}</p>
        ${summary ? `<p class="policy-zone-stats-mini">全市场 ${master.length || summary.commodityCount} 品种 · 上期所/大商所/郑商所/上期能源/广期所 · 选品种即加载海内外资讯</p>` : `<p class="policy-zone-stats-mini">全市场 ${master.length || catalog.length} 品种 · 五交易所完整覆盖</p>`}
      </div>
      <div class="policy-zone-meta">
        <span class="policy-zone-count">${loading ? '…' : totalInView}</span>
        <span class="policy-zone-count-label">${loading ? '加载中' : '条在列'}</span>
      </div>
    </header>
    <div class="policy-exchange-tabs">${renderCommodityExchangeTabs(catalog)}</div>
    <div class="policy-commodity-chips policy-commodity-chips-grid">${renderPolicyCommodityChipsGrid(source)}</div>
    <p class="policy-chip-legend">${exchangeLabel} 品种 · <i cn>国内</i> · <i gl>境外</i> · <i geo>地缘</i> · <b p>政策</b> ${refreshBtn}</p>
    <div class="policy-commodity-board">
      <div class="policy-commodity-subblock">
        <header class="policy-commodity-subhead policy-commodity-subhead-policy"><h4>监管与产业政策</h4><span>${policies.length}</span></header>
        <div class="policy-commodity-table-head">
          <span>影响</span>
          <span>关联品种</span>
          <span>方向</span>
          <span>机构</span>
          <span>政策与研判</span>
          <span>时间</span>
        </div>
        <div class="policy-commodity-rows">${policyRows}</div>
      </div>
      ${renderCommodityIntelBlock(
        '国内资讯',
        '东方财富检索 · 新浪/东财期货 · 生意社 · 新华社财经 · 产业链快讯',
        cnNews,
        '暂无国内资讯 · 点击「刷新该品种资讯」重新抓取',
        { loading, error }
      )}
      ${renderCommodityIntelBlock(
        '境外资讯',
        'CNBC · 彭博 · Investing.com · OilPrice · 离线中文化',
        globalNews,
        '暂无境外资讯 · 境外源后台加载中，可点击刷新重试',
        { loading, error }
      )}
      ${renderCommodityIntelBlock(
        '地缘深度分析',
        '四维竞争 · 逻辑链 · 学者引述 · 与品种影响同步',
        geoNews,
        '暂无关联地缘分析 · 可在「地缘政治」页查看或切换其他品种',
        { loading, error, rowRenderer: renderCommodityGeoRow }
      )}
    </div>
  </section>`;
}

function renderPolicyCard(item) {
  const commodityTags = (item.commodities || [])
    .map(
      (c) =>
        `<button type="button" class="policy-tag policy-tag-commodity" data-commodity-id="${escapeAttr(c.id)}">${escapeHtml(c.name)}</button>`
    )
    .join('');
  const typeTags = (item.policyTypeLabels || [])
    .slice(0, 2)
    .map((t) => `<span class="policy-tag policy-tag-type">${escapeHtml(t)}</span>`)
    .join('');

  const n = Math.max(1, Math.min(5, item.stars || 1));
  const dir = item.direction || 'neutral';

  return `<article class="policy-card policy-card-stars-${n}" data-policy-id="${escapeAttr(item.id)}" data-link="${escapeAttr(item.link)}" data-stars="${n}">
    <div class="policy-card-accent" aria-hidden="true"></div>
    <div class="policy-card-inner">
      <header class="policy-card-top">
        <div class="policy-card-badges">
          ${renderPolicyStars(item.stars)}
          <span class="policy-region policy-region-${item.region || 'cn'}">${escapeHtml(item.regionLabel || '中国')}</span>
          <span class="policy-dept-pill">${escapeHtml(item.departmentShort || item.departmentName)}</span>
          ${item.documentTypeLabel ? `<span class="policy-doc-type">${escapeHtml(item.documentTypeLabel)}</span>` : item.documentType ? `<span class="policy-doc-type">${escapeHtml(item.documentType)}</span>` : ''}
        </div>
        <time class="policy-date">${item.pubDate ? formatDate(item.pubDate) : ''}</time>
      </header>
      <div class="policy-card-content">
        <h3 class="policy-title">${escapeHtml(item.title)}</h3>
        ${item.titleEn && item.titleEn !== item.title ? `<p class="policy-title-en">${escapeHtml(item.titleEn)}</p>` : ''}
        ${item.summary ? `<p class="policy-summary">${escapeHtml(item.summary)}</p>` : ''}
      </div>
      <div class="policy-impact-box policy-impact-${dir}">
        <span class="policy-impact-label">影响研判</span>
        <p class="policy-impact">${escapeHtml(item.impactSummary || '')}</p>
      </div>
      <footer class="policy-card-footer">
        <div class="policy-tags">
          <span class="policy-tag policy-tag-direction policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span>
          <span class="policy-tag policy-tag-timing">${escapeHtml(item.timingLabel || '')}</span>
          ${typeTags}
          ${commodityTags}
        </div>
        <span class="policy-meta">${escapeHtml(item.sourceName || '')}</span>
      </footer>
    </div>
  </article>`;
}

function renderPolicyList(source) {
  const items = getGeneralPolicyItems(source.items || []);
  if (!items.length) {
    return '<div class="empty-state policy-feed-empty">暂无其他综合政策，大宗关联项请见上方专区</div>';
  }
  return `<div class="policy-list">${items.map((i) => renderPolicyCard(i)).join('')}</div>`;
}

function renderPolicyFeedZone(source) {
  const count = getGeneralPolicyItems(source.items || []).length;
  return `<section class="policy-feed-zone">
    <header class="policy-zone-head policy-zone-head-feed">
      <div class="policy-zone-title-wrap">
        <span class="policy-zone-kicker">POLICY FEED</span>
        <h3 class="policy-zone-title">综合政策流</h3>
        <p class="policy-zone-desc">不含大宗直接关联的一般政策与监管动态</p>
      </div>
      <span class="policy-feed-count">${count} 条</span>
    </header>
    <div class="policy-main">${renderPolicyList(source)}</div>
  </section>`;
}

function refreshPolicyPanelSections(panel, source) {
  if (!panel || !source || !isActivePanel('policy')) return;
  const fullSource = {
    ...source,
    items: source.items || window.__policyCacheItems || [],
    commodityIntel: source.commodityIntel || window.__policyCommodityIntel,
  };

  const statsEl = panel.querySelector('.policy-stats-inline');
  const deptList = panel.querySelector('.policy-dept-list');
  const viewTabs = panel.querySelector('.policy-view-tabs');
  const commodityZone = panel.querySelector('#policy-commodity-zone');
  const feedHead = panel.querySelector('.policy-feed-divider');
  const scroll = panel.querySelector('.policy-reading-scroll');

  if (statsEl && fullSource.stats) {
    statsEl.outerHTML = renderPolicyStatsInline(fullSource.stats, fullSource.items);
  }
  if (deptList) deptList.innerHTML = renderPolicyDeptChips(fullSource);
  if (viewTabs) viewTabs.innerHTML = renderPolicyViewTabs(fullSource);
  if (commodityZone) {
    commodityZone.outerHTML = renderPolicyCommoditySection(fullSource);
  }
  if (feedHead) {
    feedHead.outerHTML = renderPolicyFeedDivider(fullSource);
  }
  if (scroll) {
    if (policyViewMode === 'commodity') {
      const hint =
        '<div class="policy-commodity-view-hint">大宗关联政策见上方专区，可按品种筛选</div>';
      if (scroll.dataset.listHash !== 'commodity') {
        scroll.innerHTML = hint;
        scroll.dataset.listHash = 'commodity';
      }
    } else {
      const listItems = limitDisplayItems(getFilteredPolicyItemsForView(fullSource.items), POLICY_DISPLAY_LIMIT);
      const moreHint =
        fullSource.items.length > listItems.length
          ? `<p class="policy-note">已展示 ${listItems.length} / ${fullSource.items.length} 条，请使用筛选缩小范围</p>`
          : '';
      const listHash = hashListInputs([
        'policy',
        policyViewMode,
        policyFilterDept,
        policyFilterRegion,
        policyMinStars,
        listItems.length,
        listItems[0]?.id,
        listItems.at(-1)?.id,
      ]);
      if (!listItems.length) {
        scroll.innerHTML = '<div class="empty-state policy-feed-empty">当前筛选条件下暂无政策</div>';
        scroll.dataset.listHash = 'empty';
        destroyVirtualList(scroll);
      } else if (scroll.dataset.listHash !== listHash) {
        scroll.dataset.listHash = listHash;
        scroll.scrollTop = 0;
        const mount = () =>
          mountVirtualReadingList(scroll, listItems, renderPolicyReadingCard, {
            listClass: 'policy-reading-list',
            moreHint,
          });
        if (listItems.length > 50) scheduleRafWork(mount);
        else mount();
      }
    }
    scroll.classList.toggle('policy-reading-scroll-hidden', policyViewMode === 'commodity');
  }
  panel.querySelector('#policy-commodity-zone')?.classList.toggle(
    'policy-commodity-zone-focus',
    policyViewMode === 'commodity'
  );
  panel.querySelectorAll('.policy-view-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === policyViewMode)
  );
  updateNavTabBadge('policy', null);
}

const refreshPolicyPanelSectionsDebounced = debounce(refreshPolicyPanelSections, FILTER_DEBOUNCE_MS);

function renderPolicyFeedDivider(source) {
  if (policyViewMode === 'commodity') return '';
  const count = getFilteredPolicyItemsForView(source.items || []).length;
  const label =
    policyViewMode === 'high'
      ? '高影响政策（≥4 星）'
      : '综合政策流';
  const desc =
    policyViewMode === 'high'
      ? '高星级监管与产业政策，含部分大宗关联项'
      : '不含大宗直接关联的一般政策与监管动态';
  return `<div class="policy-feed-divider">
    <div>
      <h3 class="policy-feed-divider-title">${label}</h3>
      <p class="policy-feed-divider-desc">${desc}</p>
    </div>
    <span class="policy-feed-divider-count">${count} 条</span>
  </div>`;
}

function scrollPolicyCommodityZone(panel, { switchView = true } = {}) {
  if (switchView) {
    policyViewMode = 'commodity';
    refreshPolicyPanelSections(panel, {
      items: window.__policyCacheItems || [],
      groups: window.__policyCacheGroups || [],
      stats: window.__policyCacheStats,
      commodityIntel: window.__policyCommodityIntel,
    });
  }
  const zone = panel.querySelector('#policy-commodity-zone');
  zone?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!switchView && zone) {
    zone.classList.add('policy-commodity-zone-focus');
    setTimeout(() => zone.classList.remove('policy-commodity-zone-focus'), 2200);
  }
}

function jumpPolicyCommodityFromGeo(commodityId) {
  jumpPolicyCommodityFromClimate(commodityId);
}

function jumpPolicyCommodityFromClimate(commodityId) {
  const id = commodityId;
  if (!id) return;
  switchTab('policy');
  policyViewMode = 'commodity';
  policyFilterCommodityId = id;
  const meta = buildFullCommodityCatalog({
    items: window.__policyCacheItems,
    commodityIntel: window.__policyCommodityIntel,
  }).find((c) => normCommodityId(c.id) === normCommodityId(id));
  if (meta?.exchangeId) policyCommodityExchangeFilter = meta.exchangeId;
  initPolicyCommodityPanel().then(() => {
    loadPolicyCommodityNews(id);
    const panel = document.getElementById('panel-policy');
    if (!panel) return;
    refreshPolicyPanelSections(panel, {
      items: window.__policyCacheItems || [],
      groups: window.__policyCacheGroups || [],
      stats: window.__policyCacheStats,
      commodityIntel: window.__policyCommodityIntel,
    });
    scrollPolicyCommodityZone(panel, { switchView: false });
  });
}

function patchPolicyCommodityIntelFromGeo(source) {
  if (!source?.commodityLinkage?.feeds) return;
  const linkage = source.commodityLinkage;
  const geoFeeds = Object.fromEntries(
    Object.entries(linkage.feeds).map(([id, feed]) => [id, { geoNews: (feed.geoNews || []).slice(0, 8) }])
  );
  const prev = window.__policyCommodityIntel || {};
  const catalogById = new Map((linkage.topCommodities || []).map((c) => [normCommodityId(c.id), c]));
  const catalog = (prev.catalog || []).map((c) => {
    const linked = catalogById.get(normCommodityId(c.id));
    return linked ? { ...c, geoNewsCount: linked.geoNewsCount ?? c.geoNewsCount } : c;
  });
  window.__policyCommodityIntel = {
    ...prev,
    catalog: catalog.length ? catalog : prev.catalog,
    geoFeeds: { ...(prev.geoFeeds || {}), ...geoFeeds },
    updatedAt: linkage.updatedAt || prev.updatedAt,
  };
}

function patchPolicyCommodityIntelFromClimate(source) {
  if (!source?.commodityLinkage?.feeds) return;
  const linkage = source.commodityLinkage;
  const climateFeeds = Object.fromEntries(
    Object.entries(linkage.feeds).map(([id, feed]) => [
      id,
      { climateNews: (feed.climateNews || []).slice(0, 8) },
    ])
  );
  const prev = window.__policyCommodityIntel || {};
  const catalogById = new Map((linkage.topCommodities || []).map((c) => [normCommodityId(c.id), c]));
  const catalog = (prev.catalog || []).map((c) => {
    const linked = catalogById.get(normCommodityId(c.id));
    return linked
      ? { ...c, climateNewsCount: linked.climateNewsCount ?? c.climateNewsCount }
      : c;
  });
  window.__policyCommodityIntel = {
    ...prev,
    catalog: catalog.length ? catalog : prev.catalog,
    climateFeeds: { ...(prev.climateFeeds || {}), ...climateFeeds },
    updatedAt: linkage.updatedAt || prev.updatedAt,
  };
}

function renderPolicySidebar(source) {
  const groups = (source.groups || []).filter(
    (g) => policyFilterRegion === 'all' || g.region === policyFilterRegion || g.region === 'all'
  );
  const visibleGroups = groups.filter((g) =>
    policyFilterRegion === 'all' ? g.items?.length : g.items?.some((i) => i.region === policyFilterRegion)
  );
  const allCount = filterBasePolicyItems(source.items || []).length;
  const deptButtons = [
    `<button type="button" class="policy-dept-btn ${policyFilterDept === 'all' ? 'active' : ''}" data-dept="all">全部 <span>${allCount}</span></button>`,
    ...visibleGroups.map((g) => {
      const count =
        policyFilterRegion === 'all'
          ? g.items.length
          : g.items.filter((i) => i.region === policyFilterRegion).length;
      if (!count) return '';
      const prefix = policyFilterRegion === 'all' && g.region ? (g.region === 'us' ? '🇺🇸 ' : '🇨🇳 ') : '';
      return `<button type="button" class="policy-dept-btn ${policyFilterDept === g.id ? 'active' : ''}" data-dept="${escapeAttr(g.id)}">${prefix}${escapeHtml(g.label)} <span>${count}</span></button>`;
    }),
  ]
    .filter(Boolean)
    .join('');

  const sidebarTitle =
    policyFilterRegion === 'us' ? '美国联邦机构' : policyFilterRegion === 'cn' ? '中国部委' : '机构 / 部委';

  return `<aside class="policy-sidebar">
    <div class="policy-sidebar-head">
      <h3 class="policy-sidebar-title">${sidebarTitle}</h3>
      <span class="policy-sidebar-count">${allCount}</span>
    </div>
    <div class="policy-dept-list">${deptButtons}</div>
  </aside>`;
}

function renderInfluenceStars(n) {
  const stars = Math.max(1, Math.min(5, Number(n) || 1));
  return `<span class="geo-influence-stars" title="国际影响力 ${stars} 星">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>`;
}

function renderGeoNewsStars(n) {
  const stars = Math.max(1, Math.min(5, Number(n) || 1));
  return `<span class="policy-stars policy-stars-${stars}" title="事件影响 ${stars} 星">${'★'.repeat(stars)}</span>`;
}

function filterBaseGeoItems(items) {
  let list = items || [];
  if (geoFilterRegion !== 'all') {
    list = list.filter((i) => i.region === geoFilterRegion);
  }
  if (geoFilterCountry !== 'all') {
    list = list.filter((i) => i.countries?.some((c) => c.id === geoFilterCountry));
  }
  if (geoFilterDimension !== 'all') {
    list = list.filter((i) => i.dimensions?.some((d) => d.id === geoFilterDimension));
  }
  if (geoMinStars >= 3) {
    list = list.filter((i) => (i.stars || 0) >= geoMinStars);
  }
  if (geoViewMode === 'high') {
    list = list.filter((i) => (i.stars || 0) >= 4);
  }
  return list;
}

function renderGeopoliticsFrameworkBar(source) {
  const dims = source.framework?.dimensions || source.catalog?.dimensions || [];
  if (!dims.length) return '';
  const allCount = (source.items || []).length;
  const chips = [
    `<button type="button" class="geo-dimension-btn ${geoFilterDimension === 'all' ? 'active' : ''}" data-geo-dimension="all">四维全部 <span>${allCount}</span></button>`,
    ...dims.map((d) => {
      const active = geoFilterDimension === d.id;
      return `<button type="button" class="geo-dimension-btn geo-dim-${d.id} ${active ? 'active' : ''}" data-geo-dimension="${escapeAttr(d.id)}" title="${escapeAttr(d.description || '')}">${d.icon} ${escapeHtml(d.shortLabel || d.label)} <span>${d.count || 0}</span></button>`;
    }),
  ];
  return `<div class="geo-framework-bar">
    <p class="geo-framework-intro">${escapeHtml(source.framework?.logicModel || '事件 → 机制 → 外溢')}</p>
    <div class="geo-dimension-list">${chips.join('')}</div>
  </div>`;
}

function renderGeopoliticsAnalysisBlock(analysis) {
  if (!analysis) return '';
  const dimTags = (analysis.dimensions || [])
    .map(
      (d) =>
        `<span class="geo-dim-tag geo-dim-tag-${d.id}">${d.icon || ''} ${escapeHtml(d.shortLabel || d.label)}</span>`
    )
    .join('');
  const chain = (analysis.logicChain || [])
    .map(
      (c) =>
        `<li class="geo-logic-step"><span class="geo-logic-label">${escapeHtml(c.label)}</span>${escapeHtml(c.text)}</li>`
    )
    .join('');
  const scholars = (analysis.scholarRefs || [])
    .map(
      (s) =>
        `<figure class="geo-scholar-quote">
          <blockquote>「${escapeHtml(s.quote)}」</blockquote>
          <figcaption>— ${escapeHtml(s.name)}，${escapeHtml(s.role)} · ${escapeHtml(s.work)} <em>(${escapeHtml(s.relevance)})</em></figcaption>
        </figure>`
    )
    .join('');
  return `<div class="geo-analysis-block">
    ${dimTags ? `<div class="geo-dim-tags">${dimTags}</div>` : ''}
    ${chain ? `<ol class="geo-logic-chain">${chain}</ol>` : ''}
    ${scholars ? `<div class="geo-scholar-block">${scholars}</div>` : ''}
    ${analysis.impactLine ? `<p class="geo-impact-line"><strong>可观察影响：</strong>${escapeHtml(analysis.impactLine)}</p>` : ''}
  </div>`;
}

function renderGeopoliticsStatsInline(stats, items) {
  const s = stats || {};
  const total = s.total ?? items?.length ?? 0;
  const high = s.highImpact ?? items?.filter((i) => i.stars >= 4).length ?? 0;
  const commentary = s.withAnalysis ?? items?.filter((i) => i.analysis).length ?? 0;
  return `<div class="policy-stats-inline geo-stats-inline">
    <span>追踪 <b>${total}</b> 条</span>
    <span>高影响 <b>${high}</b></span>
    <span>深度分析 <b>${commentary}</b></span>
    <span>覆盖国家 <b>${s.countriesTracked ?? '—'}</b></span>
  </div>`;
}

function renderGeopoliticsRegionBar() {
  const regions = [
    { id: 'all', label: '全部', flag: '🌐' },
    { id: 'asia', label: '亚洲', flag: '🌏' },
    { id: 'americas', label: '美洲', flag: '🌎' },
    { id: 'europe', label: '欧洲', flag: '🇪🇺' },
    { id: 'africa', label: '非洲', flag: '🌍' },
    { id: 'oceania', label: '澳洲', flag: '🌊' },
    { id: 'global', label: '多边', flag: '🔗' },
  ];
  return regions
    .map(
      (r) =>
        `<button type="button" class="policy-region-btn geo-region-btn ${geoFilterRegion === r.id ? 'active' : ''}" data-geo-region="${r.id}">${r.flag} ${r.label}</button>`
    )
    .join('');
}

function renderGeopoliticsCountryChips(source) {
  const catalog = source.catalog?.countries || [];
  const index = source.countryIndex || [];
  const inRegion =
    geoFilterRegion === 'all' ? catalog : catalog.filter((c) => c.region === geoFilterRegion);
  const sorted = [...inRegion].sort((a, b) => b.baseInfluence - a.baseInfluence || a.name.localeCompare(b.name, 'zh'));
  const withCount = sorted.map((c) => {
    const row = index.find((i) => i.id === c.id);
    return { ...c, newsCount: row?.count || 0 };
  });
  const top = withCount.filter((c) => c.newsCount > 0).slice(0, 14);
  const chips = [
    `<button type="button" class="policy-dept-btn geo-country-btn ${geoFilterCountry === 'all' ? 'active' : ''}" data-geo-country="all">全部国家</button>`,
    ...top.map(
      (c) =>
        `<button type="button" class="policy-dept-btn geo-country-btn ${geoFilterCountry === c.id ? 'active' : ''}" data-geo-country="${escapeAttr(c.id)}" title="影响力 ${c.baseInfluence} 星">${c.flag} ${escapeHtml(c.name)} ${renderInfluenceStars(c.baseInfluence)} <span>${c.newsCount}</span></button>`
    ),
  ];
  return chips.join('');
}

function renderGeopoliticsViewTabs(source) {
  const items = source.items || [];
  const allCount = filterBaseGeoItems(items).length;
  const highCount = filterBaseGeoItems(items).filter((i) => i.stars >= 4).length;
  const tabs = [
    { id: 'all', label: '全部动态', count: allCount },
    { id: 'high', label: '高影响 ≥4星', count: highCount },
    { id: 'catalog', label: '国家影响力目录', count: source.catalog?.countries?.length || 0 },
  ];
  return tabs
    .map(
      (t) =>
        `<button type="button" class="policy-view-tab geo-view-tab ${geoViewMode === t.id ? 'active' : ''}" data-geo-view="${t.id}">${t.label}<span class="cb-tab-count">${t.count}</span></button>`
    )
    .join('');
}

function renderGeopoliticsReadingCard(item, index) {
  const n = Math.max(1, Math.min(5, item.stars || 1));
  const dateStr = item.pubDate ? formatDate(item.pubDate) : '';
  const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;
  const countryTags = (item.countries || [])
    .slice(0, 4)
    .map(
      (c) =>
        `<span class="geo-country-tag" title="影响力 ${c.baseInfluence} 星">${c.flag} ${escapeHtml(c.name)} ${renderInfluenceStars(c.baseInfluence)}</span>`
    )
    .join('');
  const topicTags = (item.topics || [])
    .map((t) => `<span class="policy-tag geo-topic-tag">${escapeHtml(t.label)}</span>`)
    .join('');
  const dimTags = (item.dimensions || [])
    .slice(0, 3)
    .map(
      (d) =>
        `<span class="geo-dim-tag geo-dim-tag-${d.id}">${d.icon || ''} ${escapeHtml(d.shortLabel || d.label)}</span>`
    )
    .join('');
  const commodityTags = (item.commodities || [])
    .slice(0, 4)
    .map(
      (c) =>
        `<button type="button" class="geo-commodity-tag policy-tag policy-tag-commodity" data-commodity-id="${escapeAttr(c.id)}" title="跳转政策雷达·大宗关联">${escapeHtml(c.name)}</button>`
    )
    .join('');

  return `<article class="policy-reading-row geo-reading-row policy-card-stars-${n}" data-geo-id="${escapeAttr(item.id)}" data-link="${escapeAttr(item.link)}" data-stars="${n}">
    <span class="reading-row-idx">${index}</span>
    <time class="reading-row-date">${escapeHtml(shortDate)}</time>
    <div class="policy-reading-main">
      <div class="policy-reading-meta">
        ${renderGeoNewsStars(item.stars)}
        <span class="geo-region-pill">${escapeHtml(item.regionFlag || '')} ${escapeHtml(item.regionLabel || '全球')}</span>
        ${dimTags ? `<span class="geo-dim-inline">${dimTags}</span>` : ''}
        ${item.analysis ? '<span class="reading-row-badge geo-badge-commentary">深度分析</span>' : ''}
      </div>
      <h3 class="policy-reading-row-title">${escapeHtml(item.title)}</h3>
      ${item.summary ? `<p class="policy-reading-summary">${escapeHtml(item.summary)}</p>` : ''}
      ${item.analysis ? renderGeopoliticsAnalysisBlock(item.analysis) : ''}
      ${countryTags ? `<div class="geo-country-tags">${countryTags}</div>` : ''}
      ${commodityTags ? `<div class="geo-commodity-tags policy-tags">${commodityTags}</div>` : ''}
      ${topicTags ? `<div class="policy-tags">${topicTags}</div>` : ''}
      <p class="geo-source-line">${escapeHtml(item.sourceName || '来源未知')}</p>
    </div>
    <span class="reading-row-action" aria-hidden="true">↗</span>
  </article>`;
}

function renderGeopoliticsReadingList(items) {
  if (!items.length) {
    return '<div class="empty-state policy-feed-empty">当前筛选条件下暂无地缘动态</div>';
  }
  return '<div class="virtual-list-pending" aria-hidden="true"></div>';
}

function renderGeopoliticsCountryCatalog(source) {
  const catalog = source.catalog?.countries || [];
  const regions = source.catalog?.regions || [];
  const byRegion = regions.map((region) => {
    const countries = catalog
      .filter((c) => c.region === region.id)
      .sort((a, b) => b.baseInfluence - a.baseInfluence || a.name.localeCompare(b.name, 'zh'));
    if (!countries.length) return '';
    const rows = countries
      .map(
        (c) =>
          `<tr class="geo-catalog-row" data-geo-country="${escapeAttr(c.id)}">
            <td>${c.flag}</td>
            <td>${escapeHtml(c.name)}</td>
            <td>${renderInfluenceStars(c.baseInfluence)}</td>
            <td><button type="button" class="geo-catalog-filter-btn" data-geo-country="${escapeAttr(c.id)}">筛选</button></td>
          </tr>`
      )
      .join('');
    return `<section class="geo-catalog-section">
      <h4 class="geo-catalog-region">${region.flag} ${escapeHtml(region.label)} <span>${countries.length} 国</span></h4>
      <table class="geo-catalog-table"><thead><tr><th></th><th>国家/地区</th><th>国际影响力</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  });
  return `<div class="geo-catalog-wrap">${byRegion.join('')}</div>`;
}

function renderGeopoliticsPanel(source) {
  const hasData = source.items?.length;
  const liveTag = source.liveRefreshedAt
    ? `<span class="policy-live-tag policy-live-badge geo-live-tag"><span class="policy-live-dot"></span>实时 ${formatDate(source.liveRefreshedAt)}</span>`
    : '';

  if (!hasData) {
    return `<div class="panel ${activeTab === 'geopolitics' ? 'active' : ''}" id="panel-geopolitics" role="tabpanel">
      <div class="empty-state">正在加载地缘政治数据…</div>
    </div>`;
  }

  window.__geoCacheItems = source.items;
  window.__geoCacheStats = source.stats;
  window.__geoCacheCatalog = source.catalog;
  window.__geoCountryIndex = source.countryIndex;
  window.__geoCacheFramework = source.framework;

  const filtered = filterBaseGeoItems(source.items).sort((a, b) => {
    const starDiff = (b.stars || 0) - (a.stars || 0);
    if (starDiff !== 0) return starDiff;
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });

  const body =
    geoViewMode === 'catalog'
      ? renderGeopoliticsCountryCatalog(source)
      : renderGeopoliticsReadingList(filtered);

  return `<div class="panel ${activeTab === 'geopolitics' ? 'active' : ''}" id="panel-geopolitics" role="tabpanel">
    <div class="policy-panel policy-reading-v2 geo-panel">
      <header class="policy-reading-head">
        <div class="policy-reading-head-main">
          <h2 class="policy-reading-title">${escapeHtml(source.dataLabel || '地缘政治')}</h2>
          ${renderGeopoliticsStatsInline(source.stats, source.items)}
        </div>
        ${liveTag}
      </header>
      ${renderGeopoliticsFrameworkBar(source)}
      <div class="policy-reading-toolbar">
        <div class="policy-toolbar-row">
          <div class="policy-region-bar geo-region-bar">${renderGeopoliticsRegionBar()}</div>
          <div class="policy-filter-group">
            <button type="button" class="policy-filter-btn geo-filter-btn ${geoMinStars >= 3 ? 'active' : ''}" data-geo-filter="stars3">≥3 星</button>
            <button type="button" class="policy-filter-btn geo-filter-btn ${geoMinStars >= 4 ? 'active' : ''}" data-geo-filter="stars4">≥4 星</button>
          </div>
        </div>
        <div class="policy-dept-list geo-country-list">${renderGeopoliticsCountryChips(source)}</div>
      </div>
      <div class="policy-view-tabs geo-view-tabs">${renderGeopoliticsViewTabs(source)}</div>
      <div class="policy-reading-scroll geo-reading-scroll">${body}</div>
      <p class="policy-note geo-note">四维竞争：意识形态 · 军事 · 政治 · 经济｜逻辑链：事件→机制→外溢｜学者引述来自公开著作观点摘要，仅供分析框架参考，不代表立场判断</p>
    </div>
  </div>`;
}

function refreshGeopoliticsPanelSections(panel, source) {
  if (!panel || !isActivePanel('geopolitics')) return;
  const data = source || {
    items: window.__geoCacheItems || [],
    stats: window.__geoCacheStats,
    catalog: window.__geoCacheCatalog,
    framework: window.__geoCacheFramework,
    countryIndex: window.__geoCountryIndex || [],
  };
  const headMain = panel.querySelector('.policy-reading-head-main');
  if (headMain) {
    const statsEl = headMain.querySelector('.geo-stats-inline');
    if (statsEl) statsEl.outerHTML = renderGeopoliticsStatsInline(data.stats, data.items);
  }
  const frameworkBar = panel.querySelector('.geo-framework-bar');
  if (frameworkBar) {
    frameworkBar.outerHTML = renderGeopoliticsFrameworkBar(data);
  } else {
    panel.querySelector('.policy-reading-head')?.insertAdjacentHTML(
      'afterend',
      renderGeopoliticsFrameworkBar(data)
    );
  }
  const regionBar = panel.querySelector('.geo-region-bar');
  if (regionBar) regionBar.innerHTML = renderGeopoliticsRegionBar();
  const countryList = panel.querySelector('.geo-country-list');
  if (countryList) countryList.innerHTML = renderGeopoliticsCountryChips(data);
  const viewTabs = panel.querySelector('.geo-view-tabs');
  if (viewTabs) viewTabs.innerHTML = renderGeopoliticsViewTabs(data);
  const scroll = panel.querySelector('.geo-reading-scroll');
  if (scroll) {
    const filtered = filterBaseGeoItems(data.items || []).sort((a, b) => {
      const starDiff = (b.stars || 0) - (a.stars || 0);
      if (starDiff !== 0) return starDiff;
      return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
    });
    if (geoViewMode === 'catalog') {
      const catalogHtml = renderGeopoliticsCountryCatalog(data);
      const hash = hashListInputs(['catalog', geoFilterRegion, geoFilterCountry, catalogHtml.length]);
      if (scroll.dataset.listHash !== hash) {
        scroll.innerHTML = catalogHtml;
        scroll.dataset.listHash = hash;
      }
    } else {
      const limited = limitDisplayItems(filtered, GEO_DISPLAY_LIMIT);
      const moreHint =
        filtered.length > limited.length
          ? `<p class="policy-note geo-note">已展示 ${limited.length} / ${filtered.length} 条，请使用筛选缩小范围</p>`
          : '';
      const listHash = hashListInputs([
        'geo',
        geoViewMode,
        geoFilterRegion,
        geoFilterDimension,
        geoFilterCountry,
        geoMinStars,
        limited.length,
        limited[0]?.id,
        limited.at(-1)?.id,
      ]);
      if (!limited.length) {
        scroll.innerHTML = '<div class="empty-state policy-feed-empty">当前筛选条件下暂无地缘动态</div>';
        scroll.dataset.listHash = 'empty';
        destroyVirtualList(scroll);
      } else if (scroll.dataset.listHash !== listHash) {
        scroll.dataset.listHash = listHash;
        scroll.scrollTop = 0;
        const mount = () =>
          mountVirtualReadingList(scroll, limited, renderGeopoliticsReadingCard, {
            listClass: 'policy-reading-list geo-reading-list',
            moreHint,
          });
        if (limited.length > 50) scheduleRafWork(mount);
        else mount();
      }
    }
  }
  updateNavTabBadge('geopolitics', null);
}

const refreshGeopoliticsPanelSectionsDebounced = debounce(refreshGeopoliticsPanelSections, FILTER_DEBOUNCE_MS);

function filterBaseClimateItems(items) {
  let list = items || [];
  if (climateFilterRegion !== 'all') {
    list = list.filter((i) => i.region === climateFilterRegion);
  }
  if (climateFilterCategory !== 'all') {
    list = list.filter(
      (i) =>
        i.primaryCategoryId === climateFilterCategory ||
        i.dimensions?.some((d) => d.id === climateFilterCategory)
    );
  }
  if (climateMinStars >= 3) list = list.filter((i) => (i.stars || 0) >= climateMinStars);
  if (climateViewMode === 'high') list = list.filter((i) => (i.stars || 0) >= 4);
  return list;
}

function renderClimateFrameworkBar(source) {
  const dims = source.framework?.dimensions || source.catalog?.dimensions || [];
  if (!dims.length) return '';
  const allCount = (source.items || []).length;
  const chips = [
    `<button type="button" class="climate-dimension-btn ${climateFilterCategory === 'all' ? 'active' : ''}" data-climate-category="all">传导全部 <span>${allCount}</span></button>`,
    ...dims.map((d) => {
      const active = climateFilterCategory === d.id;
      return `<button type="button" class="climate-dimension-btn climate-dim-${d.id} ${active ? 'active' : ''}" data-climate-category="${escapeAttr(d.id)}" title="${escapeAttr(d.description || '')}">${d.icon} ${escapeHtml(d.shortLabel || d.label)} <span>${d.count || 0}</span></button>`;
    }),
  ];
  return `<div class="climate-framework-bar geo-framework-bar">
    <p class="climate-framework-intro geo-framework-intro">${escapeHtml(source.framework?.logicModel || '气候事件 → 传导 → 品种')}</p>
    <div class="climate-dimension-list geo-dimension-list">${chips.join('')}</div>
  </div>`;
}

function renderClimateAnalysisBlock(analysis) {
  if (!analysis) return '';
  const chain = (analysis.logicChain || [])
    .map(
      (c) =>
        `<li class="climate-logic-step"><span class="climate-logic-label">${escapeHtml(c.label)}</span>${escapeHtml(c.text)}</li>`
    )
    .join('');
  return `<div class="climate-analysis-block">
    ${chain ? `<ol class="climate-logic-chain">${chain}</ol>` : ''}
    ${analysis.transmission ? `<p class="climate-transmission"><strong>传导：</strong>${escapeHtml(analysis.transmission)}</p>` : ''}
    ${analysis.impactLine ? `<p class="climate-impact-line geo-impact-line"><strong>品种：</strong>${escapeHtml(analysis.impactLine)}</p>` : ''}
  </div>`;
}

function renderClimateStatsInline(stats, items) {
  const s = stats || {};
  const total = s.total ?? items?.length ?? 0;
  const high = s.highImpact ?? items?.filter((i) => i.stars >= 4).length ?? 0;
  const linked = s.commodityLinked ?? items?.filter((i) => i.commodityLinked).length ?? 0;
  return `<div class="policy-stats-inline climate-stats-inline">
    <span>追踪 <b>${total}</b> 条</span>
    <span>高影响 <b>${high}</b></span>
    <span>大宗关联 <b>${linked}</b></span>
  </div>`;
}

function renderClimateRegionBar() {
  const regions = [
    { id: 'all', label: '全部', flag: '🌐' },
    { id: 'domestic', label: '国内', flag: '🇨🇳' },
    { id: 'international', label: '国际', flag: '🌍' },
    { id: 'asia', label: '亚洲', flag: '🌏' },
    { id: 'americas', label: '美洲', flag: '🌎' },
    { id: 'europe', label: '欧洲', flag: '🇪🇺' },
    { id: 'global', label: '全球', flag: '🔗' },
  ];
  return regions
    .map(
      (r) =>
        `<button type="button" class="policy-region-btn climate-region-btn ${climateFilterRegion === r.id ? 'active' : ''}" data-climate-region="${r.id}">${r.flag} ${r.label}</button>`
    )
    .join('');
}

function renderClimateViewTabs(source) {
  const items = source.items || [];
  const allCount = filterBaseClimateItems(items).length;
  const highCount = filterBaseClimateItems(items).filter((i) => i.stars >= 4).length;
  const tabs = [
    { id: 'all', label: '全部动态', count: allCount },
    { id: 'high', label: '高影响 ≥4星', count: highCount },
  ];
  return tabs
    .map(
      (t) =>
        `<button type="button" class="policy-view-tab climate-view-tab ${climateViewMode === t.id ? 'active' : ''}" data-climate-view="${t.id}">${t.label}<span class="cb-tab-count">${t.count}</span></button>`
    )
    .join('');
}

function renderClimateReadingCard(item, index) {
  const n = Math.max(1, Math.min(5, item.stars || 1));
  const dateStr = item.pubDate ? formatDate(item.pubDate) : '';
  const shortDate = dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;
  const dimTags = (item.dimensions || [])
    .slice(0, 3)
    .map(
      (d) =>
        `<span class="climate-dim-tag climate-dim-tag-${d.id} geo-dim-tag">${d.icon || ''} ${escapeHtml(d.shortLabel || d.label)}</span>`
    )
    .join('');
  const eventTags = (item.eventTypes || [])
    .map((e) => `<span class="policy-tag climate-event-tag">${escapeHtml(e.label)}</span>`)
    .join('');
  const commodityTags = (item.commodities || [])
    .slice(0, 5)
    .map(
      (c) =>
        `<button type="button" class="climate-commodity-tag geo-commodity-tag policy-tag policy-tag-commodity" data-commodity-id="${escapeAttr(c.id)}" title="跳转政策雷达·大宗关联">${escapeHtml(c.name)}</button>`
    )
    .join('');
  const dirClass =
    item.direction === 'bullish'
      ? 'climate-direction-bullish'
      : item.direction === 'bearish'
        ? 'climate-direction-bearish'
        : '';

  return `<article class="policy-reading-row climate-reading-row policy-card-stars-${n}" data-climate-id="${escapeAttr(item.id)}" data-link="${escapeAttr(item.link)}" data-stars="${n}">
    <span class="reading-row-idx">${index}</span>
    <time class="reading-row-date">${escapeHtml(shortDate)}</time>
    <div class="policy-reading-main">
      <div class="policy-reading-meta">
        ${renderGeoNewsStars(item.stars)}
        <span class="climate-region-pill">${escapeHtml(item.regionFlag || '')} ${escapeHtml(item.regionLabel || '全球')}</span>
        ${item.eventTypeLabel ? `<span class="policy-tag climate-event-tag">${escapeHtml(item.eventTypeLabel)}</span>` : ''}
        ${item.directionLabel ? `<span class="policy-tag ${dirClass}" title="影响方向">${escapeHtml(item.directionLabel)}</span>` : ''}
        ${dimTags ? `<span class="climate-dim-inline">${dimTags}</span>` : ''}
        ${item.analysis ? '<span class="reading-row-badge climate-badge-analysis">传导分析</span>' : ''}
      </div>
      <h3 class="policy-reading-row-title">${escapeHtml(item.title)}</h3>
      ${item.summary ? `<p class="policy-reading-summary">${escapeHtml(item.summary)}</p>` : ''}
      ${item.analysis ? renderClimateAnalysisBlock(item.analysis) : ''}
      ${commodityTags ? `<div class="climate-commodity-tags policy-tags">${commodityTags}</div>` : ''}
      ${eventTags ? `<div class="policy-tags">${eventTags}</div>` : ''}
      <p class="climate-source-line geo-source-line">${escapeHtml(item.sourceName || '来源未知')}</p>
    </div>
    <span class="reading-row-action" aria-hidden="true">↗</span>
  </article>`;
}

function renderClimateReadingList(items) {
  if (!items.length) {
    return '<div class="empty-state policy-feed-empty">当前筛选条件下暂无气候动态</div>';
  }
  return '<div class="virtual-list-pending" aria-hidden="true"></div>';
}

function renderClimatePanel(source) {
  const hasData = source.items?.length;
  const liveTag = source.liveRefreshedAt
    ? `<span class="policy-live-tag policy-live-badge climate-live-tag"><span class="policy-live-dot"></span>实时 ${formatDate(source.liveRefreshedAt)}</span>`
    : '';

  if (!hasData) {
    return `<div class="panel ${activeTab === 'climate' ? 'active' : ''}" id="panel-climate" role="tabpanel">
      <div class="empty-state">正在加载天气气候数据…</div>
    </div>`;
  }

  window.__climateCacheItems = source.items;
  window.__climateCacheStats = source.stats;
  window.__climateCacheFramework = source.framework;

  const filtered = filterBaseClimateItems(source.items).sort((a, b) => {
    const starDiff = (b.stars || 0) - (a.stars || 0);
    if (starDiff !== 0) return starDiff;
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });

  return `<div class="panel ${activeTab === 'climate' ? 'active' : ''}" id="panel-climate" role="tabpanel">
    <div class="policy-panel policy-reading-v2 climate-panel">
      <header class="policy-reading-head">
        <div class="policy-reading-head-main">
          <h2 class="policy-reading-title">${escapeHtml(source.dataLabel || '天气气候')}</h2>
          ${renderClimateStatsInline(source.stats, source.items)}
        </div>
        ${liveTag}
      </header>
      ${renderClimateFrameworkBar(source)}
      <div class="policy-reading-toolbar">
        <div class="policy-toolbar-row">
          <div class="policy-region-bar climate-region-bar">${renderClimateRegionBar()}</div>
          <div class="policy-filter-group">
            <button type="button" class="policy-filter-btn climate-filter-btn ${climateMinStars >= 3 ? 'active' : ''}" data-climate-filter="stars3">≥3 星</button>
            <button type="button" class="policy-filter-btn climate-filter-btn ${climateMinStars >= 4 ? 'active' : ''}" data-climate-filter="stars4">≥4 星</button>
          </div>
        </div>
      </div>
      <div class="policy-view-tabs climate-view-tabs">${renderClimateViewTabs(source)}</div>
      <div class="policy-reading-scroll climate-reading-scroll">${renderClimateReadingList(filtered)}</div>
      <p class="policy-note climate-note">农业 · 矿山物流 · 宏观政经｜逻辑链：气候事件→传导→大宗商品｜品种标签可跳转政策雷达大宗专区</p>
    </div>
  </div>`;
}

function refreshClimatePanelSections(panel, source) {
  if (!panel || !isActivePanel('climate')) return;
  const data = source || {
    items: window.__climateCacheItems || [],
    stats: window.__climateCacheStats,
    framework: window.__climateCacheFramework,
  };
  const headMain = panel.querySelector('.policy-reading-head-main');
  if (headMain) {
    const statsEl = headMain.querySelector('.climate-stats-inline');
    if (statsEl) statsEl.outerHTML = renderClimateStatsInline(data.stats, data.items);
  }
  const frameworkBar = panel.querySelector('.climate-framework-bar');
  if (frameworkBar) {
    frameworkBar.outerHTML = renderClimateFrameworkBar(data);
  } else {
    panel.querySelector('.policy-reading-head')?.insertAdjacentHTML(
      'afterend',
      renderClimateFrameworkBar(data)
    );
  }
  const regionBar = panel.querySelector('.climate-region-bar');
  if (regionBar) regionBar.innerHTML = renderClimateRegionBar();
  const viewTabs = panel.querySelector('.climate-view-tabs');
  if (viewTabs) viewTabs.innerHTML = renderClimateViewTabs(data);
  const scroll = panel.querySelector('.climate-reading-scroll');
  if (scroll) {
    const filtered = filterBaseClimateItems(data.items || []).sort((a, b) => {
      const starDiff = (b.stars || 0) - (a.stars || 0);
      if (starDiff !== 0) return starDiff;
      return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
    });
    const limited = limitDisplayItems(filtered, CLIMATE_DISPLAY_LIMIT);
    const moreHint =
      filtered.length > limited.length
        ? `<p class="policy-note climate-note">已展示 ${limited.length} / ${filtered.length} 条，请使用筛选缩小范围</p>`
        : '';
    const listHash = hashListInputs([
      'climate',
      climateViewMode,
      climateFilterRegion,
      climateFilterCategory,
      climateMinStars,
      limited.length,
      limited[0]?.id,
      limited.at(-1)?.id,
    ]);
    if (!limited.length) {
      scroll.innerHTML = '<div class="empty-state policy-feed-empty">当前筛选条件下暂无气候动态</div>';
      scroll.dataset.listHash = 'empty';
      destroyVirtualList(scroll);
    } else if (scroll.dataset.listHash !== listHash) {
      scroll.dataset.listHash = listHash;
      scroll.scrollTop = 0;
      const mount = () =>
        mountVirtualReadingList(scroll, limited, renderClimateReadingCard, {
          listClass: 'policy-reading-list climate-reading-list',
          moreHint,
        });
      if (limited.length > 50) scheduleRafWork(mount);
      else mount();
    }
  }
  updateNavTabBadge('climate', null);
}

const refreshClimatePanelSectionsDebounced = debounce(refreshClimatePanelSections, FILTER_DEBOUNCE_MS);

function outlookDirectionClassForInst(inst) {
  return outlookRowToneClassForInst(inst);
}

function outlookDirectionClass(dir) {
  if (dir === 'bullish') return 'outlook-direction-bullish';
  if (dir === 'bearish') return 'outlook-direction-bearish';
  return 'outlook-direction-neutral';
}

/** 与 services/intel-page-tone 对齐：行底默认幕僚面，禁止红绿主路径 */
function outlookRowToneClassForInst(inst) {
  const sf = inst?.intelCenter?.staffFace;
  const fortuneOk = Boolean(sf?.fortuneChromeAllowed);
  const mode = sf?.mode || (inst?.intelCenter?.primaryClaim || inst?.intelCenter?.memo ? 'brief' : 'observe');
  const parts = ['outlook-staff-surface', `outlook-staff-${mode}`];
  if (!fortuneOk) {
    parts.push('outlook-direction-neutral', 'outlook-staff-muted');
  } else {
    parts.push('outlook-fortune-aux');
    const dir = inst?.direction;
    if (dir === 'bullish') parts.push('outlook-direction-bullish-aux');
    else if (dir === 'bearish') parts.push('outlook-direction-bearish-aux');
    else parts.push('outlook-direction-neutral');
  }
  return parts.join(' ');
}

/** 列表「研判」列：命题/备忘录领衔，箭头永不做主路径 */
function buildOutlookStaffListLead(inst) {
  const ic = inst?.intelCenter;
  const sf = ic?.staffFace;
  const fortuneOk = Boolean(sf?.fortuneChromeAllowed);
  const hasIntel = Boolean(ic?.available || ic?.primaryClaim || ic?.memo);
  if (!hasIntel) {
    return {
      lead: '情报待建',
      tip: '尚无命题/备忘录 · 方向不作为结论',
      showArrow: false,
      arrow: '·',
      directionLabel: null,
      fortuneOk: false,
    };
  }
  const st = ic?.primaryClaim?.status;
  const belief = ic?.beliefLevel || ic?.primaryClaim?.confidence;
  const pricing = ic?.pricingState?.state;
  const choiceId = ic?.choiceSet?.primaryId;
  let lead;
  if (sf?.mode === 'observe') lead = '观望';
  else if (sf?.mode === 'brief') lead = '备忘录';
  else if (st === 'falsified') lead = '已证伪';
  else if (st === 'falsifying') lead = '证伪中';
  else if (choiceId) lead = `方案${choiceId}`;
  else if (belief && belief !== '不可判定') lead = belief;
  else if (pricing === 'mispriced') lead = '误定价';
  else if (ic?.memo?.oneLiner) lead = String(ic.memo.oneLiner).slice(0, 12);
  else lead = belief || '命题';
  return {
    lead,
    tip: sf?.display || ic?.memo?.headline || ic?.primaryClaim?.statement || '幕僚面：命题/备忘录优先于方向箭头',
    showArrow: fortuneOk,
    arrow: fortuneOk ? inst?.directionArrow || '→' : '·',
    directionLabel: fortuneOk ? inst?.directionLabel || null : null,
    fortuneOk,
  };
}

function mergeBacktestIntoOutlookInstruments(instruments, summary) {
  if (!instruments?.length || !summary?.instruments?.length) return instruments;
  const byId = new Map(summary.instruments.map((r) => [String(r.id).toLowerCase(), r]));
  return instruments.map((inst) => {
    const hit = byId.get(String(inst.id).toLowerCase());
    if (!hit) return inst;
    return {
      ...inst,
      backtestHitRate30d: hit.hitRate30d ?? inst.backtestHitRate30d,
      backtestHitRate60d: hit.hitRate60d ?? inst.backtestHitRate60d,
      backtestHits30d: hit.hits30d ?? inst.backtestHits30d,
      backtestTotal30d: hit.total30d ?? inst.backtestTotal30d,
      backtestHits60d: hit.hits60d ?? inst.backtestHits60d,
      backtestTotal60d: hit.total60d ?? inst.backtestTotal60d,
      backtestHitRateLongrun: hit.hitRate ?? hit.hitRateLongrun ?? inst.backtestHitRateLongrun,
      backtestAvgGapPct: hit.avgGapPct ?? inst.backtestAvgGapPct,
      backtestSampleLast10: hit.sampleLast10,
    };
  });
}

function mergeLongrunIntoOutlookInstruments(instruments, summary) {
  if (!instruments?.length || !summary?.instruments?.length) return instruments;
  const byId = new Map(summary.instruments.map((r) => [String(r.id).toLowerCase(), r]));
  return instruments.map((inst) => {
    const hit = byId.get(String(inst.id).toLowerCase());
    if (!hit) return inst;
    return {
      ...inst,
      backtestHitRateLongrun: hit.hitRate ?? inst.backtestHitRateLongrun,
      backtestLongrunHits: hit.hits,
      backtestLongrunTotal: hit.total,
      backtestLongrunStart: hit.startDate,
      backtestLongrunEnd: hit.endDate,
    };
  });
}

async function loadOutlookLongrunSummaryCache() {
  if (!window.fancheng?.getOutlookLongrunSummary) return null;
  const data = await window.fancheng.getOutlookLongrunSummary();
  if (data?.error) return null;
  outlookLongrunSummaryCache = data.summary || null;
  return outlookLongrunSummaryCache;
}

async function loadOutlookBacktestSummaryCache() {
  if (!window.fancheng?.getOutlookBacktestSummary) return null;
  const data = await window.fancheng.getOutlookBacktestSummary();
  if (data?.error) return null;
  outlookBacktestSummaryCache = data.summary || null;
  return outlookBacktestSummaryCache;
}

async function runOutlookLongrunBacktestUi(panel) {
  if (outlookLongrunRunning || outlookBacktestRunning || !window.fancheng?.runOutlookBacktest) return;
  outlookLongrunRunning = true;
  window.__outlookBacktestProgress = { phase: 'init', pct: 0, message: '启动长周期回测…', mode: 'longrun-2019' };
  const slot = panel?.querySelector('.outlook-backtest-progress-slot');
  if (slot) slot.innerHTML = renderOutlookBacktestProgress(window.__outlookBacktestProgress);
  const btn = panel?.querySelector('[data-action="run-outlook-longrun-backtest"]');
  if (btn) btn.disabled = true;

  try {
    const summary = await window.fancheng.runOutlookBacktest({ mode: 'longrun-2019', force: true });
    if (summary?.error) {
      window.__outlookBacktestProgress = { phase: 'error', pct: 0, message: summary.error };
    } else {
      outlookLongrunSummaryCache = summary;
      window.__outlookBacktestProgress = {
        phase: 'done',
        pct: 100,
        message: `长周期回测完成 · ${summary.runtimeEstimate || ''}`,
      };
      if (window.__outlookCacheInstruments?.length) {
        window.__outlookCacheInstruments = mergeLongrunIntoOutlookInstruments(
          window.__outlookCacheInstruments,
          summary
        );
      }
      if (window.__outlookCacheStats) {
        window.__outlookCacheStats.longRunHitRate = summary.overallHitRate;
        window.__outlookCacheStats.longRunHits = summary.hits;
        window.__outlookCacheStats.longRunTotal = summary.total;
        window.__outlookCacheStats.longRunByEra = summary.byEra;
        window.__outlookCacheStats.longRunBySector = summary.bySector;
      }
      showOutlookLongrunResultsModal(summary);
      if (outlookSelectedInstrumentId) updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
    }
  } catch (err) {
    window.__outlookBacktestProgress = { phase: 'error', pct: 0, message: err?.message || '长周期回测失败' };
  } finally {
    outlookLongrunRunning = false;
    if (btn) btn.disabled = false;
    if (slot) slot.innerHTML = renderOutlookBacktestProgress(window.__outlookBacktestProgress);
    const hitEl = panel?.querySelector('.outlook-hit-rate, .outlook-hit-rate-longrun');
    if (hitEl && window.__outlookCacheStats) {
      replaceOutlookHitRateBadges(panel, window.__outlookCacheStats);
    }
  }
}

async function runOutlookBacktestUi(panel) {
  if (outlookBacktestRunning || !window.fancheng?.runOutlookBacktest) return;
  outlookBacktestRunning = true;
  window.__outlookBacktestProgress = { phase: 'init', pct: 0, message: '启动回测…' };
  const slot = panel?.querySelector('.outlook-backtest-progress-slot');
  if (slot) slot.innerHTML = renderOutlookBacktestProgress(window.__outlookBacktestProgress);
  const btn = panel?.querySelector('[data-action="run-outlook-backtest"]');
  if (btn) btn.disabled = true;

  try {
    const summary = await window.fancheng.runOutlookBacktest({ days: 60 });
    if (summary?.error) {
      window.__outlookBacktestProgress = { phase: 'error', pct: 0, message: summary.error };
    } else {
      outlookBacktestSummaryCache = summary;
      window.__outlookBacktestProgress = { phase: 'done', pct: 100, message: '回测完成' };
      if (window.__outlookCacheInstruments?.length) {
        window.__outlookCacheInstruments = mergeBacktestIntoOutlookInstruments(
          window.__outlookCacheInstruments,
          summary
        );
      }
      if (window.__outlookCacheStats) {
      window.__outlookCacheStats.backtestHitRate30d = summary.overallHitRate30d;
      window.__outlookCacheStats.backtestHitRate60d = summary.overallHitRate60d;
      window.__outlookCacheStats.backtestHits30d = summary.hits30d;
      window.__outlookCacheStats.backtestTotal30d = summary.total30d;
      window.__outlookCacheStats.backtestHits60d = summary.hits60d;
      window.__outlookCacheStats.backtestTotal60d = summary.total60d;
      }
      showOutlookBacktestResultsModal(summary);
      void refreshOutlookLive({ force: true });
    }
  } catch (err) {
    window.__outlookBacktestProgress = { phase: 'error', pct: 0, message: err?.message || '回测失败' };
  } finally {
    outlookBacktestRunning = false;
    if (btn) btn.disabled = false;
    if (slot) slot.innerHTML = renderOutlookBacktestProgress(window.__outlookBacktestProgress);
    if (panel && window.__outlookCacheStats) {
      replaceOutlookHitRateBadges(panel, window.__outlookCacheStats);
    }
  }
}

function renderOutlookLongrunEraTable(summary) {
  const byEra = summary?.byEra || outlookLongrunSummaryCache?.byEra;
  if (!byEra) return '<p class="outlook-accuracy-empty">暂无时代分段数据</p>';
  const rows = Object.entries(byEra)
    .map(([, era]) => {
      const pct = era.hitRate != null ? `${Math.round(era.hitRate * 100)}%` : '—';
      return `<tr><td>${escapeHtml(era.label || '')}</td><td>${pct}</td><td>${era.hits ?? '—'}/${era.total ?? '—'}</td></tr>`;
    })
    .join('');
  return `<table class="outlook-backtest-era-table">
    <thead><tr><th>宏观时代</th><th>方向命中率</th><th>样本</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function showOutlookLongrunResultsModal(summary) {
  const panel = document.getElementById('panel-outlook');
  if (!panel) return;
  let modal = panel.querySelector('.outlook-longrun-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'outlook-longrun-modal outlook-backtest-modal outlook-history-modal';
    modal.innerHTML =
      '<div class="outlook-history-dialog outlook-backtest-dialog"><header><h4>长周期回测 2019- · 时代命中率</h4><button type="button" class="outlook-history-close" data-action="close-outlook-longrun">×</button></header><div class="outlook-backtest-body"></div></div>';
    panel.appendChild(modal);
  }
  const body = modal.querySelector('.outlook-backtest-body');
  const overall = fmtHitWithSample(summary?.overallHitRate, summary?.hits, summary?.total);
  const samples = summary?.sampleHitRates || {};
  const fmt = (r) => fmtHitWithSample(r?.hitRate, r?.hits, r?.total);
  body.innerHTML = `<p class="outlook-backtest-overall">2019→今 整体 ${overall} · ${summary?.instrumentCount ?? 0} 品种 · 耗时 ${escapeHtml(summary?.runtimeEstimate || '—')}</p>
    <p class="outlook-backtest-samples">au ${fmt(samples.au)} · cu ${fmt(samples.cu)} · sc ${fmt(samples.sc)} · FG ${fmt(samples.FG)}</p>
    ${renderOutlookLongrunEraTable(summary)}
    ${renderOutlookBacktestSectorTable(summary.bySector ? { bySector: Object.fromEntries(Object.entries(summary.bySector).map(([k, v]) => [k, { hitRate30d: v.hitRate, hitRate60d: null, total60d: v.total }])) } : null)}`;
  modal.hidden = false;
}

function showOutlookBacktestResultsModal(summary) {
  const panel = document.getElementById('panel-outlook');
  if (!panel) return;
  let modal = panel.querySelector('.outlook-backtest-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'outlook-backtest-modal outlook-history-modal';
    modal.innerHTML =
      '<div class="outlook-history-dialog outlook-backtest-dialog"><header><h4>回测结果 · 板块命中率</h4><button type="button" class="outlook-history-close" data-action="close-outlook-backtest">×</button></header><div class="outlook-backtest-body"></div></div>';
    panel.appendChild(modal);
  }
  const body = modal.querySelector('.outlook-backtest-body');
  const o30 = fmtHitWithSample(summary?.overallHitRate30d, summary?.hits30d, summary?.total30d);
  const o60 = fmtHitWithSample(summary?.overallHitRate60d, summary?.hits60d, summary?.total60d);
  body.innerHTML = `<p class="outlook-backtest-overall">整体 30d ${o30} · 60d ${o60} · ${summary?.instrumentCount ?? 0} 品种</p>${renderOutlookBacktestSectorTable(summary)}`;
  modal.hidden = false;
}

function setupOutlookBacktestListeners(panel) {
  if (panel.dataset.backtestListener === '1') return;
  panel.dataset.backtestListener = '1';
  if (window.fancheng?.onOutlookBacktestProgress) {
    window.fancheng.onOutlookBacktestProgress((progress) => {
      window.__outlookBacktestProgress = progress;
      const slot = panel.querySelector('.outlook-backtest-progress-slot');
      if (slot) slot.innerHTML = renderOutlookBacktestProgress(progress);
    });
  }
  if (window.fancheng?.onOutlookSlotCaptured) {
    window.fancheng.onOutlookSlotCaptured((payload) => {
      window.__outlookSlotCaptureMeta = payload;
      const strip = panel.querySelector('.outlook-slot-capture-strip');
      if (strip && payload?.predictionSlotLabel) {
        strip.textContent = `时段快照 ${payload.predictionSlotLabel}`;
        strip.hidden = false;
      }
      if (outlookSelectedInstrumentId) updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
    });
  }
}

function renderOutlookHorizonCell(h) {
  if (!h) return '<span class="outlook-horizon-empty">—</span>';
  const commentary = h.commentary || h.directionLabel || '暂无';
  return `<div class="outlook-horizon-cell outlook-horizon-staff ${outlookDirectionClass(h.direction)}-aux">
    <span class="outlook-horizon-lead" title="${escapeAttr(commentary)}">${escapeHtml(String(commentary).slice(0, 36))}</span>
    <span class="outlook-dir-label outlook-dir-label-secondary">${escapeHtml(h.directionLabel || '震荡')}</span>
    <span class="outlook-dir-arrow outlook-dir-arrow-muted" aria-hidden="true">${escapeHtml(h.directionArrow || '·')}</span>
    <span class="outlook-stars" title="置信度">${escapeHtml(h.starsHtml || '')}</span>
  </div>`;
}

function getOutlookBaseRange(inst) {
  return inst?.scenarios?.base || inst?.nextDayRangePct || {};
}

function outlookPriceTick(instId) {
  return window.PriceTick?.getTickSize(instId) ?? 1;
}

function roundOutlookPriceToTick(instId, price) {
  if (window.PriceTick) return window.PriceTick.roundPriceToTick(instId, price);
  if (price == null || Number.isNaN(Number(price))) return null;
  return Number(price);
}

function looksLikeOutlookPctBand(high, low, baseClose) {
  if (window.PriceTick) return window.PriceTick.looksLikePctBand(high, low, baseClose);
  return false;
}

function getOutlookPctRangeClient(inst) {
  if (!inst || inst.outlookPending) return null;
  const pct = inst.nextDayRangePct;
  if (pct?.low != null && pct?.high != null && pct?.mid != null) return pct;
  const base = inst.scenarios?.base;
  if (base?.low != null && base?.high != null) {
    return {
      low: base.low,
      mid: base.mid ?? null,
      high: base.high,
      bias: base.bias,
      expectedMovePct: inst.nextDayRangePct?.expectedMovePct ?? null,
    };
  }
  return null;
}

function deriveOutlookVolatilityDisplay(inst) {
  const src = inst?.nextDayPrediction || inst?.highLowPrediction || inst?.nextDayRange;
  if (src?.predictedHigh != null && src?.predictedLow != null) {
    return {
      mode: 'absolute',
      predictedHigh: roundOutlookPriceToTick(inst?.id, src.predictedHigh),
      predictedLow: roundOutlookPriceToTick(inst?.id, src.predictedLow),
      baseClose: src.baseClose ?? inst.closingPrice ?? inst.price,
      baselineDate: src.baselineDate || inst.closingDate,
      confidence: src.confidence,
      method: src.method || src.dataSource,
      unit: src.unit || inst?.unit,
    };
  }
  const pct = getOutlookPctRangeClient(inst);
  if (!pct) return null;
  const base = inst.price ?? inst.closingPrice ?? null;
  if (base != null && base > 0) {
    const lowRaw = base * (1 + Number(pct.low) / 100);
    const highRaw = base * (1 + Number(pct.high) / 100);
    const predictedLow = roundOutlookPriceToTick(inst?.id, Math.min(lowRaw, highRaw));
    const predictedHigh = roundOutlookPriceToTick(inst?.id, Math.max(lowRaw, highRaw));
    if (predictedLow != null && predictedHigh != null) {
      return {
        mode: 'pct-derived',
        pct,
        predictedLow,
        predictedHigh,
        baseClose: base,
        baselineDate: inst.closingDate || (inst.judgementUpdatedAt ? String(inst.judgementUpdatedAt).slice(0, 10) : null),
        confidence: inst.confidence,
        method: 'nextDayRangePct',
        unit: inst?.unit,
      };
    }
  }
  return { mode: 'pct', pct, baseClose: base, confidence: inst.confidence, method: 'nextDayRangePct' };
}

function getNextDayPrediction(inst) {
  const display = deriveOutlookVolatilityDisplay(inst);
  if (!display) return null;
  if (display.mode === 'pct') {
    return {
      pctOnly: true,
      pct: display.pct,
      baseClose: display.baseClose,
      baselineDate: display.baselineDate,
      confidence: display.confidence,
      method: display.method,
      track: 'pct-volatility',
      sessionScope: 'next-trading-day-pct',
    };
  }
  return {
    ...display,
    track: 'daily',
    sessionScope: display.mode === 'pct-derived' ? 'pct-volatility-derived' : 'full-next-trading-day',
    predictedHigh: display.predictedHigh,
    predictedLow: display.predictedLow,
  };
}

function getOutlookHighLow(inst) {
  return getNextDayPrediction(inst);
}

function formatOutlookPriceValue(n, inst) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const base = inst?.highLowPrediction?.baseClose ?? inst?.price;
  if (looksLikeOutlookPctBand(n, n, base)) return '—';
  if (window.PriceTick) return window.PriceTick.formatPriceForInstrument(inst?.id, n);
  return String(Number(n));
}

function formatOutlookHighLowRange(hl, inst) {
  if (!hl) return '—';
  const unit = hl.unit || inst?.unit || '';
  const hi = formatOutlookPriceValue(Math.max(hl.predictedHigh, hl.predictedLow), inst);
  const lo = formatOutlookPriceValue(Math.min(hl.predictedHigh, hl.predictedLow), inst);
  return `${hi} ~ ${lo}${unit ? ` ${unit}` : ''}`;
}

function getOutlookExtremeHighLow(inst) {
  const hl = getOutlookHighLow(inst);
  if (!hl) return null;
  const stress = inst.scenarios?.stress;
  const triggered = Boolean(inst.scenarios?.stressTriggered);
  if (!triggered) return null;

  const baseline = hl.baseClose ?? inst.price;
  if (baseline == null || baseline <= 0) return null;

  if (stress?.low != null && stress?.high != null) {
    const lowPct = Number(stress.low);
    const highPct = Number(stress.high);
    if (Number.isNaN(lowPct) || Number.isNaN(highPct)) return null;
    const lo = baseline * (1 + Math.min(lowPct, highPct) / 100);
    const hi = baseline * (1 + Math.max(lowPct, highPct) / 100);
    return {
      predictedLow: roundOutlookPriceToTick(inst?.id, lo),
      predictedHigh: roundOutlookPriceToTick(inst?.id, hi),
      unit: hl.unit || inst.unit,
    };
  }

  const mid = (hl.predictedHigh + hl.predictedLow) / 2;
  const halfSpread = ((hl.predictedHigh - hl.predictedLow) / 2) * 1.35;
  return {
    predictedLow: roundOutlookPriceToTick(inst?.id, mid - halfSpread),
    predictedHigh: roundOutlookPriceToTick(inst?.id, mid + halfSpread),
    unit: hl.unit || inst.unit,
  };
}

function formatOutlookRangePct(range) {
  if (!range) return '—';
  const low = Number(range.low);
  const high = Number(range.high);
  if (Number.isNaN(low) || Number.isNaN(high)) return '—';
  const sign = (n, digits = 2) => (n > 0 ? '+' : '') + n.toFixed(digits);
  return `${sign(low)}% ~ ${sign(high)}%`;
}

function formatOutlookScenarioRow(key, sc) {
  if (!sc) return '';
  const labels = { base: '基准', bull: '偏多', bear: '偏空', stress: '突变' };
  const extraClass = key === 'stress' ? ' outlook-scenario-stress' : '';
  return `<tr class="outlook-scenario-row outlook-scenario-${key}${extraClass}">
    <td>${escapeHtml(labels[key] || key)}</td>
    <td>${formatOutlookRangePct(sc)}</td>
    <td class="outlook-scenario-score">${escapeHtml(sc.score != null ? `${sc.score >= 0 ? '+' : ''}${Number(sc.score).toFixed(2)}` : '—')}</td>
    <td>${escapeHtml(sc.bias === 'bullish' ? '偏多' : sc.bias === 'bearish' ? '偏空' : '震荡')}</td>
  </tr>`;
}

function renderOutlookScenariosTable(inst) {
  const sc = inst.scenarios;
  if (!sc?.base && !inst.nextDayRangePct) return '';
  const rows = ['base', 'bull', 'bear', 'stress']
    .map((k) => formatOutlookScenarioRow(k, sc[k]))
    .filter(Boolean)
    .join('');
  return `<div class="outlook-scenarios-block">
    <h5>多情景次日区间</h5>
    <table class="outlook-scenarios-table">
      <thead><tr><th>情景</th><th>区间</th><th>分</th><th>偏向</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${sc.stressTriggered ? '<p class="outlook-scenario-note">突变情景已触发（高星资讯或波动&gt;1.5×EMA）</p>' : ''}
  </div>`;
}

function renderOutlookChangeDelta(inst) {
  const d = inst.changeDelta;
  if (!d) return '<p class="outlook-change-delta outlook-change-delta-empty">暂无较上次变更记录</p>';
  const scorePart =
    d.deltaScore != null
      ? `综合分 ${d.deltaScore >= 0 ? '+' : ''}${Number(d.deltaScore).toFixed(2)}`
      : '';
  const midPart = d.deltaMid != null ? `区间中心 ${d.deltaMid >= 0 ? '+' : ''}${Number(d.deltaMid).toFixed(2)}%` : '';
  const latencyPart =
    d.latencyChanged && inst.latencyLabel ? `反射 ${inst.latencyLabel}` : '';
  const tags = (d.reasonTags || []).map((t) => escapeHtml(t)).join(' · ');
  return `<p class="outlook-change-delta"><strong>较上次 Δ</strong> ${[scorePart, midPart, latencyPart].filter(Boolean).join(' · ')}${tags ? ` · ${tags}` : ''}</p>`;
}

function renderOutlookLatencyBlock(inst) {
  if (inst.latencyState == null && inst.wInstant == null) return '';
  const wI = inst.wInstant != null ? `${(inst.wInstant * 100).toFixed(0)}%` : '—';
  const wD = inst.wDelayed != null ? `${(inst.wDelayed * 100).toFixed(0)}%` : '—';
  const state = inst.latencyLabel || inst.latencyState || '—';
  return `<div class="outlook-latency-wrap">${renderOutlookSectionHead('双速通道', 'latency', inst.id)}<p class="outlook-latency-line">即时权重 ${wI} · 滞后权重 ${wD} · 状态 <strong>${escapeHtml(state)}</strong>${inst.instantScore != null ? ` · 即时分${inst.instantScore >= 0 ? '+' : ''}${Number(inst.instantScore).toFixed(2)}` : ''}${inst.delayedScore != null ? ` · 滞后分${inst.delayedScore >= 0 ? '+' : ''}${Number(inst.delayedScore).toFixed(2)}` : ''}</p></div>`;
}

function renderOutlookRegimeBadge(inst) {
  if (!inst.regime || inst.regime === 'neutral') return '';
  const changed = inst.changeDelta?.regimeChanged;
  return `<span class="outlook-regime-badge${changed ? ' outlook-regime-changed' : ''}" title="${escapeAttr((inst.regimeTriggers || []).join(' · '))}">${escapeHtml(inst.regimeLabel || inst.regime)}${changed ? ' Δ' : ''}</span>`;
}

function formatOutlookRangeSubtext(range) {
  if (!range) return '';
  const mid = Number(range.mid);
  const sign = (n, digits = 2) => (n > 0 ? '+' : '') + n.toFixed(digits);
  const parts = [];
  if (range.volForecastSubline) parts.push(range.volForecastSubline);
  else if (range.volForecastDisplay) parts.push(range.volForecastDisplay);
  if (!Number.isNaN(mid)) parts.push(`中心 ${sign(mid)}%`);
  if (range.expectedMoveDisplay) parts.push(range.expectedMoveDisplay);
  return parts.join(' · ');
}

function formatOutlookRangeCappedNote(range) {
  if (!range?.rangeCapped) return '';
  return range.rangeCappedNote || '区间已按历史上限校准';
}

function formatOutlookRangeBias(range, compositeScore) {
  if (!range) return '';
  const absScore = Math.abs(Number(compositeScore) || 0);
  if (absScore > 0.12 && range.bias && range.bias !== 'neutral') {
    return `${range.biasArrow || ''} ${range.biasLabel || ''}`.trim();
  }
  if (absScore <= 0.12) {
    return `${range.biasArrow || '→'} 震荡`;
  }
  return `${range.biasArrow || ''} ${range.biasLabel || '震荡'}`.trim();
}

function formatOutlookPctSign(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function formatOutlookPriceDelta(n, inst) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const abs = formatOutlookPriceValue(Math.abs(v), inst);
  if (v > 0) return `+${abs}`;
  if (v < 0) return `−${abs}`;
  return abs;
}

function resolveSlotRangeCompare(inst) {
  const rc = inst?.rangeComparison;
  const ya = inst?.yesterdayArchive;
  const ash = inst?.actualSessionHighLow;
  const sessionDate =
    window.__outlookSlotCaptureMeta?.sessionDate || new Date().toISOString().slice(0, 10);
  const activeSlot =
    inst?.listSlotContext?.slotId ||
    window.__outlookSlotCaptureMeta?.predictionSlot ||
    'pre-night';
  const slotAudit = (inst.rangeAuditRecords || []).find(
    (r) => r.sessionDate === sessionDate && r.predictionSlot === activeSlot
  );
  const slotSnap = inst.listSlotContext?.entry;
  const hl = getNextDayPrediction(inst);

  const predictedHigh =
    slotSnap?.predictedHigh ?? slotAudit?.predHigh ?? hl?.predictedHigh ?? null;
  const predictedLow =
    slotSnap?.predictedLow ?? slotAudit?.predLow ?? hl?.predictedLow ?? null;

  let actualHigh = slotAudit?.actualHigh ?? rc?.actualHigh ?? ash?.actualHigh ?? ya?.actualHigh ?? null;
  let actualLow = slotAudit?.actualLow ?? rc?.actualLow ?? ash?.actualLow ?? ya?.actualLow ?? null;
  let status = slotAudit?.status ?? rc?.status ?? ash?.status ?? (actualHigh != null && actualLow != null ? 'complete' : 'pending');
  let highError = slotAudit?.deviationHigh ?? slotAudit?.highError ?? rc?.highError ?? ya?.highError ?? null;
  let lowError = slotAudit?.deviationLow ?? slotAudit?.lowError ?? rc?.lowError ?? ya?.lowError ?? null;
  let bandHit = slotAudit?.bandHit ?? rc?.bandHit ?? ya?.bandHit ?? null;
  let compareClass = rc?.compareClass ?? null;
  let compareLabel = rc?.compareLabel ?? slotAudit?.bandHitLabel ?? ya?.bandHitLabel ?? null;
  const slotLabel =
    inst.listSlotContext?.slotLabel ||
    slotAudit?.predictionSlotLabel ||
    window.__outlookSlotCaptureMeta?.predictionSlotLabel ||
    null;

  if (actualHigh != null && actualLow != null && predictedHigh != null && predictedLow != null) {
    if (highError == null) highError = +(Number(actualHigh) - Number(predictedHigh)).toFixed(4);
    if (lowError == null) lowError = +(Number(actualLow) - Number(predictedLow)).toFixed(4);
    if (bandHit == null) {
      bandHit = Number(actualHigh) <= Number(predictedHigh) && Number(actualLow) >= Number(predictedLow);
    }
    if (!compareClass) {
      compareClass = bandHit ? 'range-compare-hit' : 'range-compare-miss';
    }
    if (!compareLabel) {
      compareLabel = bandHit ? (status === 'intraday' ? '盘中·命中' : '命中') : status === 'intraday' ? '盘中·未中' : '未中';
    }
  } else if (!compareLabel) {
    compareClass = compareClass || 'range-compare-pending';
    compareLabel = ash?.label || rc?.compareLabel || '待校验';
  }

  if (predictedHigh == null && predictedLow == null) return null;

  return {
    predictedHigh,
    predictedLow,
    actualHigh,
    actualLow,
    status,
    highError,
    lowError,
    bandHit,
    compareClass: compareClass || 'range-compare-pending',
    compareLabel: compareLabel || '待校验',
    unit: hl?.unit || inst?.unit || '',
    slotLabel,
  };
}

/** Main list + daily track: next trading day only — never slot snapshots. */
function resolveOutlookRangeCompare(inst) {
  const hl = getNextDayPrediction(inst);
  if (!hl?.predictedHigh && !hl?.predictedLow) return null;

  const rc = inst?.rangeComparison;
  const ya = inst?.yesterdayArchive;
  const ash = inst?.actualSessionHighLow;

  const predictedHigh = hl.predictedHigh;
  const predictedLow = hl.predictedLow;
  let actualHigh = rc?.actualHigh ?? ash?.actualHigh ?? ya?.actualHigh ?? null;
  let actualLow = rc?.actualLow ?? ash?.actualLow ?? ya?.actualLow ?? null;
  let status = rc?.status ?? ash?.status ?? (actualHigh != null && actualLow != null ? 'complete' : 'pending');
  let highError = rc?.highError ?? ya?.highError ?? null;
  let lowError = rc?.lowError ?? ya?.lowError ?? null;
  let bandHit = rc?.bandHit ?? ya?.bandHit ?? null;
  let compareClass = rc?.compareClass ?? null;
  let compareLabel = rc?.compareLabel ?? ya?.bandHitLabel ?? null;

  if (actualHigh != null && actualLow != null && predictedHigh != null && predictedLow != null) {
    if (highError == null) highError = +(Number(actualHigh) - Number(predictedHigh)).toFixed(4);
    if (lowError == null) lowError = +(Number(actualLow) - Number(predictedLow)).toFixed(4);
    if (bandHit == null) {
      bandHit = Number(actualHigh) <= Number(predictedHigh) && Number(actualLow) >= Number(predictedLow);
    }
    if (!compareClass) {
      compareClass = bandHit ? 'range-compare-hit' : 'range-compare-miss';
    }
    if (!compareLabel) {
      compareLabel = bandHit ? (status === 'intraday' ? '盘中·命中' : '命中') : status === 'intraday' ? '盘中·未中' : '未中';
    }
  } else if (!compareLabel) {
    compareClass = compareClass || 'range-compare-pending';
    compareLabel = ash?.label || rc?.compareLabel || '待校验';
  }

  return {
    predictedHigh,
    predictedLow,
    actualHigh,
    actualLow,
    status,
    highError,
    lowError,
    bandHit,
    compareClass: compareClass || 'range-compare-pending',
    compareLabel: compareLabel || '待校验',
    unit: hl.unit || inst?.unit || '',
    slotLabel: null,
  };
}

function renderOutlookDailyPredictionCell(inst) {
  if (inst.outlookPending) {
    return '<div class="outlook-pred-pending">行情待加载</div>';
  }
  const hl = getNextDayPrediction(inst);
  if (!hl) return '<div class="outlook-pred-pending">—</div>';
  if (hl.pctOnly && hl.pct) {
    const range = formatOutlookRangePct(hl.pct);
    const move =
      hl.pct.expectedMovePct != null
        ? `<span class="outlook-pred-conf">±${escapeHtml(String(hl.pct.expectedMovePct))}%</span>`
        : '';
    return `<div class="outlook-pred-daily outlook-pred-pct"><div class="outlook-pred-daily-range">${escapeHtml(range)}</div><div class="outlook-pred-daily-meta"><span class="outlook-pred-base">百分比情景</span>${move}</div></div>`;
  }
  const range = hl.predictedHigh != null && hl.predictedLow != null ? formatOutlookHighLowRange(hl, inst) : formatOutlookRangePct(hl.pct);
  const base = hl.baseClose ?? inst.closingPrice ?? inst.price;
  const baseHint =
    base != null
      ? `<span class="outlook-pred-base" title="基准 ${hl.baselineDate || inst.closingDate || ''}">基${formatOutlookPriceValue(base, inst)}</span>`
      : hl.mode === 'pct-derived' || hl.method === 'nextDayRangePct'
        ? '<span class="outlook-pred-base">pct→价</span>'
        : '';
  const conf = hl.confidence
    ? `<span class="outlook-pred-conf">置信 ${escapeHtml(hl.confidence)}</span>`
    : '';
  return `<div class="outlook-pred-daily"><div class="outlook-pred-daily-range">${escapeHtml(range)}</div><div class="outlook-pred-daily-meta">${baseHint}${conf}</div></div>`;
}

function renderOutlookSlotRangeCompareCompact(inst) {
  const cmp = resolveSlotRangeCompare(inst);
  if (!cmp) return '';

  const fmt = (n) => (n != null ? formatOutlookPriceValue(n, inst) : '—');
  const pending = cmp.status === 'pending' || cmp.actualHigh == null || cmp.actualLow == null;
  const unitSuffix = cmp.unit ? ` ${cmp.unit}` : '';

  const actualLine = pending
    ? `<span class="outlook-rc-actual outlook-rc-pending">实际高 — / 实际低 — <em>待校验</em></span>`
    : `<span class="outlook-rc-actual">实际高 <strong>${fmt(cmp.actualHigh)}</strong> / 实际低 <strong>${fmt(cmp.actualLow)}</strong>${unitSuffix}</span>`;

  const predLine = `<span class="outlook-rc-pred">预测高 <strong>${fmt(cmp.predictedHigh)}</strong> / 预测低 <strong>${fmt(cmp.predictedLow)}</strong>${unitSuffix}${cmp.slotLabel ? ` <em class="outlook-rc-slot-label">${escapeHtml(cmp.slotLabel)}</em>` : ''}</span>`;

  const deltaLine = pending
    ? ''
    : `<span class="outlook-rc-delta">Δ高 ${formatOutlookPriceDelta(cmp.highError, inst)} · Δ低 ${formatOutlookPriceDelta(cmp.lowError, inst)}</span>`;

  const hitBadge = `<span class="outlook-rc-hit outlook-audit-band-tag ${escapeAttr(cmp.compareClass)}">${escapeHtml(cmp.compareLabel)}</span>`;

  return `<div class="outlook-range-compare ${escapeAttr(cmp.compareClass)}">
    ${actualLine}
    ${predLine}
    <div class="outlook-rc-footer">${deltaLine}${hitBadge}</div>
  </div>`;
}

function renderOutlookAuditHlCell(value, hit) {
  const cls = hit === true ? 'hit' : hit === false ? 'miss' : 'pending';
  const text = value != null && value !== '' ? String(value) : '—';
  return `<span class="outlook-audit-hl ${cls}">${escapeHtml(text)}</span>`;
}

function renderOutlookAuditReasonTags(tags) {
  if (!tags?.length) return '—';
  return tags
    .slice(0, 3)
    .map((t) => `<span class="outlook-audit-reason-tag">${escapeHtml(t)}</span>`)
    .join('');
}

function outlookPredictTsMs(row) {
  if (!row) return 0;
  if (row.predictTs) {
    const t = new Date(row.predictTs).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (row.date) {
    const t = new Date(`${String(row.date).slice(0, 10)}T12:00:00`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function buildSortedOutlookAccuracyEntries(inst, limit = 5) {
  const entries = [];
  const seen = new Set();

  for (const r of inst.accuracyRecords || []) {
    const ts = outlookPredictTsMs(r);
    const key = `${ts}:${r.predictedMid ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ kind: 'resolved', record: r, ts });
  }

  if (inst.pendingPrediction?.predictedMid != null) {
    entries.push({ kind: 'pending', record: inst.pendingPrediction, ts: outlookPredictTsMs(inst.pendingPrediction) });
  }

  const ya = inst.yesterdayArchive;
  if (ya?.predictedMid != null) {
    const ts = outlookPredictTsMs({ date: ya.date });
    const duplicate = entries.some(
      (e) =>
        e.kind !== 'yesterday' &&
        Math.abs(e.ts - ts) < 86400000 &&
        e.record?.predictedMid === ya.predictedMid
    );
    if (!duplicate) entries.push({ kind: 'yesterday', record: ya, ts });
  }

  entries.sort((a, b) => b.ts - a.ts);
  return entries.slice(0, limit);
}

function renderOutlookAccuracyRow(entry) {
  const { kind, record: r } = entry;
  if (kind === 'yesterday') {
    const hit = r.hitDirection ? '✓' : r.hitDirection === false ? '✗' : '—';
    const hitClass = r.hitDirection ? 'hit' : r.hitDirection === false ? 'miss' : '';
    return `<tr class="outlook-accuracy-yesterday">
      <td>昨日存档 ${escapeHtml(r.date || '')}</td>
      <td>${renderOutlookAuditSlotCell(r)}</td>
      <td>${escapeHtml(formatOutlookPctSign(r.predictedMid))}</td>
      <td>${r.actualPct != null ? escapeHtml(formatOutlookPctSign(r.actualPct)) : '待收盘'}</td>
      <td>${r.gapPct != null ? escapeHtml(formatOutlookPctSign(r.gapPct)) : '—'}</td>
      <td class="outlook-accuracy-hit ${hitClass}">${hit}</td>
    </tr>`;
  }
  if (kind === 'pending') {
    return `<tr class="outlook-accuracy-pending"><td>${escapeHtml(r.predictTs ? formatDate(r.predictTs) : '—')}</td><td>${renderOutlookAuditSlotCell(r)}</td><td>${escapeHtml(formatOutlookPctSign(r.predictedMid))}</td><td colspan="2">等待收盘校验</td><td>—</td></tr>`;
  }
  const ts = r.predictTs ? formatDate(r.predictTs) : '—';
  const hit = r.hitDirection ? '✓' : '✗';
  const hitClass = r.hitDirection ? 'hit' : 'miss';
  return `<tr>
    <td>${escapeHtml(ts)}</td>
    <td>${renderOutlookAuditSlotCell(r)}</td>
    <td>${escapeHtml(formatOutlookPctSign(r.predictedMid))}</td>
    <td>${escapeHtml(formatOutlookPctSign(r.actualPct))}</td>
    <td>${escapeHtml(formatOutlookPctSign(r.gapPct))}</td>
    <td class="outlook-accuracy-hit ${hitClass}">${hit}</td>
  </tr>`;
}

function outlookSectionContentHash(key, inst) {
  if (!inst) return '';
  switch (key) {
    case 'philAnchor':
      return hashListInputs([
        'anch',
        inst.philosophyAnchor?.lines?.map((l) => l.text).join('|'),
        inst.philosophyFilter?.filterPass,
        inst.judgementUpdatedDisplay,
      ]);
    case 'philosophy':
      return hashListInputs(['phil', inst.philosophy?.logicSummary, inst.philosophy?.ranked?.primary?.length]);
    case 'rationale':
      return hashListInputs(['rat', inst.predictionRationale || inst.rationale || '']);
    case 'historical':
      return hashListInputs(['hist', inst.historicalContext?.regimeMatchSummary, inst.historicalContext?.avgNextDayPct]);
    case 'factors':
      return hashListInputs(['fac', (inst.factorBreakdownDisplay || []).map((r) => `${r.label}:${r.value}`).join('|')]);
    case 'latency':
      return hashListInputs(['lat', inst.latencyState, inst.wInstant, inst.wDelayed]);
    case 'rangeVerify':
      return hashListInputs(['rng', (inst.rangeAuditRecords || []).slice(0, 9).map((r) => `${r.sessionDate}:${r.bandHit}`).join('|')]);
    case 'dirVerify':
      return hashListInputs(['dir', (inst.directionAuditRecords || []).slice(0, 9).map((r) => `${r.baselineDate}:${r.hitDirection}`).join('|')]);
    case 'slotSnapshots':
      return hashListInputs(['snap', (inst.slotSnapshotsForSession || []).map((s) => s.predictionSlot).join('|')]);
    case 'tradingGuidance':
      return hashListInputs([
        'tg',
        inst.tradingGuidance?.posture,
        inst.tradingGuidance?.phase,
        inst.tradingGuidance?.alerts?.map((a) => `${a.type}:${a.triggered}`).join('|'),
      ]);
    case 'longTermGuidance':
      return hashListInputs([
        'lt',
        inst.longTermGuidance?.entry?.readiness,
        inst.longTermGuidance?.stop?.hardStop,
        inst.longTermGuidance?.stop?.softStop,
        inst.longTermGuidance?.stop?.trailingStop,
        inst.longTermGuidance?.hold?.thesisStatus,
      ]);
    default:
      return '';
  }
}

function touchOutlookDetailSection(instId, sectionKey, inst) {
  if (!instId || !sectionKey) return;
  const mapKey = `${instId}:${sectionKey}`;
  const contentHash = outlookSectionContentHash(sectionKey, inst);
  const prev = outlookDetailSectionState.get(mapKey);
  outlookDetailSectionState.set(mapKey, {
    updatedAt: Date.now(),
    contentHash,
    changed: Boolean(prev && prev.contentHash && prev.contentHash !== contentHash),
  });
}

function renderOutlookSectionTimestamp(sectionKey, instId) {
  const state = outlookDetailSectionState.get(`${instId}:${sectionKey}`);
  if (!state?.updatedAt) return '';
  const label = formatDate(state.updatedAt);
  const changedCls = state.changed ? ' outlook-section-changed' : '';
  const delta = state.changed ? ' · 较上次更新' : '';
  return `<span class="outlook-section-ts${changedCls}" title="本节最后刷新时间">更新 ${escapeHtml(label)}${delta}</span>`;
}

function renderOutlookSectionHead(title, sectionKey, instId) {
  return `<h5 class="outlook-section-head">${escapeHtml(title)}${renderOutlookSectionTimestamp(sectionKey, instId)}</h5>`;
}

function filterRecordsBySlot(records, slotId) {
  const slotSpecific = (records || []).filter((r) => r.predictionSlot === slotId);
  if (slotSpecific.length) return slotSpecific;
  // Daily/legacy captures (no slot tag) map to 20:55 pre-night column
  if (slotId === 'pre-night') {
    return (records || []).filter((r) => !r.predictionSlot);
  }
  return [];
}

function filterOutlookAuditBySlot(records) {
  if (!outlookSlotFilter || outlookSlotFilter === 'all') return records || [];
  return filterRecordsBySlot(records, outlookSlotFilter);
}

function computeRangeStatsFromRecords(records) {
  const scored = (records || []).filter((r) => r.bandHit != null);
  const bandHits = scored.filter((r) => r.bandHit).length;
  return {
    count: scored.length,
    bandHitRate: scored.length ? bandHits / scored.length : null,
  };
}

function computeDirectionStatsFromRecords(records) {
  const scored = (records || []).filter(
    (r) => r.hitDirection != null && r.status !== 'pending' && r.predictedDir !== 'neutral'
  );
  const hits = scored.filter((r) => r.hitDirection).length;
  return {
    count: scored.length,
    hitRate: scored.length ? hits / scored.length : null,
  };
}

function outlookVerifySlotColClass(slotId) {
  if (!outlookSlotFilter || outlookSlotFilter === 'all') return 'outlook-verify-slot-col';
  return outlookSlotFilter === slotId
    ? 'outlook-verify-slot-col outlook-verify-slot-active'
    : 'outlook-verify-slot-col outlook-verify-slot-dim';
}

const OUTLOOK_VERIFY_AUDIT_ROW_LIMIT = 8;

function renderOutlookRangeAuditRows(inst, records, limit = OUTLOOK_VERIFY_AUDIT_ROW_LIMIT) {
  return records
    .slice(0, limit)
    .map((r) => {
      const date = String(r.sessionDate || r.baselineDate || '').slice(0, 10);
      const hiPred = formatOutlookPriceValue(r.predHigh, inst);
      const loPred = formatOutlookPriceValue(r.predLow, inst);
      const hiAct = formatOutlookPriceValue(r.actualHigh, inst);
      const loAct = formatOutlookPriceValue(r.actualLow, inst);
      const devHi = r.deviationHigh ?? r.highError;
      const devLo = r.deviationLow ?? r.lowError;
      const devHiCell =
        devHi != null ? formatOutlookPriceDelta(devHi, inst) : '—';
      const devLoCell =
        devLo != null ? formatOutlookPriceDelta(devLo, inst) : '—';
      return `<tr class="${r.bandHit ? 'outlook-audit-row-hit' : 'outlook-audit-row-miss'}">
        <td>${escapeHtml(date || '—')}${r.sessionWindowLabel ? `<span class="outlook-audit-window-hint" title="校验窗口">${escapeHtml(r.sessionWindowLabel)}</span>` : ''}</td>
        <td>${renderOutlookAuditHlCell(`${hiPred}~${loPred}`, r.highHit && r.lowHit)}</td>
        <td>${renderOutlookAuditHlCell(`${hiAct}~${loAct}`, r.bandHit)}</td>
        <td class="outlook-audit-dev">${escapeHtml(devHiCell)}</td>
        <td class="outlook-audit-dev">${escapeHtml(devLoCell)}</td>
        <td class="outlook-accuracy-hit ${r.bandHit ? 'hit' : 'miss'}">${r.bandHit ? '✓' : '✗'}</td>
      </tr>`;
    })
    .join('');
}

function renderOutlookRangeAuditSlotColumn(inst, slot) {
  const allRecords = [...(inst.rangeAuditRecords || [])].sort((a, b) => {
    const da = String(a.sessionDate || a.baselineDate || a.predictTs || '');
    const db = String(b.sessionDate || b.baselineDate || b.predictTs || '');
    return db.localeCompare(da);
  });
  const records = filterRecordsBySlot(allRecords, slot.id);
  const stats = inst.rangeAuditStatsBySlot?.[slot.id] || computeRangeStatsFromRecords(records);
  const hitPct = stats?.bandHitRate != null ? `${Math.round(stats.bandHitRate * 100)}%` : '—';
  const windowLabel =
    inst.slotSessionWindowLabels?.[slot.id] ||
    records[0]?.sessionWindowLabel ||
    '—';
  const statsLine = stats?.count
    ? `<p class="outlook-range-audit-stats">命中率 <strong>${hitPct}</strong> <span class="outlook-hit-sample">(${stats.count})</span></p>`
    : '<p class="outlook-range-audit-stats">命中率 <strong>—</strong></p>';
  const windowLine = `<p class="outlook-verify-session-window" title="预测与实际均对照此交易窗口">窗口 <strong>${escapeHtml(windowLabel)}</strong></p>`;
  const rows = renderOutlookRangeAuditRows(inst, records);
  const table = `<table class="outlook-accuracy-audit-table outlook-verify-slot-table">
    <thead><tr><th>日期</th><th>预测 H~L</th><th>实际 H~L</th><th>Δ高</th><th>Δ低</th><th>带</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">暂无</td></tr>'}</tbody>
  </table>`;
  return `<div class="${outlookVerifySlotColClass(slot.id)}" data-verify-slot="${escapeAttr(slot.id)}">
    <header class="outlook-verify-slot-head">${escapeHtml(slot.label)}</header>
    ${windowLine}
    ${statsLine}
    ${table}
  </div>`;
}

function renderOutlookRangeAuditTable(inst) {
  const hasAny = (inst.rangeAuditRecords || []).length || inst.rangeAuditStats?.count;
  if (!hasAny) {
    return '<p class="outlook-accuracy-empty">区间预测存档积累中；收盘后将自动比对预测 high/low vs 实际</p>';
  }
  const cols = OUTLOOK_PREDICTION_SLOTS.map((slot) => renderOutlookRangeAuditSlotColumn(inst, slot)).join('');
  return `<div class="outlook-verify-slot-grid" role="group" aria-label="区间校验三时段">${cols}</div>`;
}

function renderOutlookDirectionAuditRow(r) {
  const date = String(r.sessionDate || r.baselineDate || '').slice(0, 10);
  const pending = r.status === 'pending' || (r.actualReturnPct == null && r.actualDir == null);
  if (pending) {
    return `<tr class="outlook-accuracy-pending">
      <td>${escapeHtml(date || '—')}</td>
      <td>${escapeHtml(r.predictedDirLabel || '—')}</td>
      <td colspan="2">待收盘</td>
      <td class="outlook-accuracy-hit">—</td>
    </tr>`;
  }
  const hitClass = r.hitDirection ? 'hit' : r.hitDirection === false ? 'miss' : '';
  const hitMark = r.hitLabel || (r.hitDirection ? '✓' : r.hitDirection === false ? '✗' : '—');
  return `<tr>
    <td>${escapeHtml(date || '—')}</td>
    <td>${escapeHtml(r.predictedDirLabel || '—')}</td>
    <td>${r.actualReturnPct != null ? escapeHtml(formatOutlookPctSign(r.actualReturnPct)) : escapeHtml(r.actualDirLabel || '—')}</td>
    <td>${r.gapPct != null ? escapeHtml(formatOutlookPctSign(r.gapPct)) : '—'}</td>
    <td class="outlook-accuracy-hit ${hitClass}">${hitMark}</td>
  </tr>`;
}

function renderOutlookDirectionAuditSlotColumn(inst, slot) {
  const allRecords = [...(inst.directionAuditRecords || inst.accuracyRecords || [])].sort((a, b) => {
    const da = String(a.sessionDate || a.baselineDate || a.predictTs || '');
    const db = String(b.sessionDate || b.baselineDate || b.predictTs || '');
    return db.localeCompare(da);
  });
  const records = filterRecordsBySlot(allRecords, slot.id);
  const stats = inst.directionAuditStatsBySlot?.[slot.id] || computeDirectionStatsFromRecords(records);
  const hitPct = stats?.hitRate != null ? `${Math.round(stats.hitRate * 100)}%` : stats?.gatedHitRate != null ? `${Math.round(stats.gatedHitRate * 100)}%` : '—';
  const sampleN = stats?.scored ?? stats?.count ?? records.length;
  const statsLine = sampleN
    ? `<p class="outlook-range-audit-stats">T+1命中 <strong>${hitPct}</strong> <span class="outlook-hit-sample">(${sampleN})</span></p>`
    : '<p class="outlook-range-audit-stats">T+1命中 <strong>—</strong></p>';
  const rows = records.slice(0, OUTLOOK_VERIFY_AUDIT_ROW_LIMIT).map((r) => renderOutlookDirectionAuditRow(r)).join('');
  const table = `<table class="outlook-accuracy-table outlook-verify-slot-table">
    <thead><tr><th>日期</th><th>预测</th><th>实际(T+1)</th><th>差距</th><th>方向</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">暂无</td></tr>'}</tbody>
  </table>`;
  return `<div class="${outlookVerifySlotColClass(slot.id)}" data-verify-slot="${escapeAttr(slot.id)}">
    <header class="outlook-verify-slot-head">${escapeHtml(slot.label)}</header>
    ${statsLine}
    ${table}
  </div>`;
}

function renderOutlookDirectionAuditTable(inst) {
  const cols = OUTLOOK_PREDICTION_SLOTS.map((slot) => renderOutlookDirectionAuditSlotColumn(inst, slot)).join('');
  return `<div class="outlook-verify-slot-grid" role="group" aria-label="方向校验三时段">${cols}</div>`;
}

function renderOutlookVerifySummaryStrip(inst) {
  const cards = OUTLOOK_PREDICTION_SLOTS.map((slot) => {
    const allRange = [...(inst.rangeAuditRecords || [])];
    const rangeRecords = filterRecordsBySlot(allRange, slot.id);
    const rangeStats = inst.rangeAuditStatsBySlot?.[slot.id] || computeRangeStatsFromRecords(rangeRecords);
    const rangePct =
      rangeStats?.bandHitRate != null ? `${Math.round(rangeStats.bandHitRate * 100)}%` : '—';
    const rangeN = rangeStats?.count ?? 0;

    const allDir = [...(inst.directionAuditRecords || inst.accuracyRecords || [])];
    const dirRecords = filterRecordsBySlot(allDir, slot.id);
    const dirStats = inst.directionAuditStatsBySlot?.[slot.id] || computeDirectionStatsFromRecords(dirRecords);
    const dirPct = dirStats?.hitRate != null ? `${Math.round(dirStats.hitRate * 100)}%` : '—';
    const dirN = dirStats?.scored ?? dirStats?.count ?? dirRecords.length;

    const snap = (inst.slotSnapshotsForSession || []).find((s) => s.predictionSlot === slot.id);
    const snapEntry = snap?.instruments?.find((i) => i.id === inst.id);
    const snapMid =
      snapEntry?.predictedMid != null ? formatOutlookPctSign(snapEntry.predictedMid) : null;
    const snapDir = snapEntry?.directionLabel || snapEntry?.direction || null;

    return `<div class="${outlookVerifySlotColClass(slot.id)} outlook-verify-summary-card" data-verify-slot="${escapeAttr(slot.id)}">
      <header class="outlook-verify-slot-head">${escapeHtml(slot.label)}</header>
      <div class="outlook-verify-summary-metrics">
        <div class="outlook-verify-metric outlook-verify-metric-range">
          <span class="outlook-verify-metric-label">区间命中</span>
          <strong class="outlook-verify-metric-value">${escapeHtml(rangePct)}</strong>
          ${rangeN ? `<span class="outlook-hit-sample">n=${rangeN}</span>` : ''}
        </div>
        <div class="outlook-verify-metric outlook-verify-metric-dir">
          <span class="outlook-verify-metric-label">方向 T+1</span>
          <strong class="outlook-verify-metric-value">${escapeHtml(dirPct)}</strong>
          ${dirN ? `<span class="outlook-hit-sample">n=${dirN}</span>` : ''}
        </div>
      </div>
      ${snapMid || snapDir ? `<p class="outlook-verify-snap-line">${snapMid ? `中心 <strong>${escapeHtml(snapMid)}</strong>` : ''}${snapMid && snapDir ? ' · ' : ''}${snapDir ? escapeHtml(snapDir) : ''}</p>` : ''}
    </div>`;
  }).join('');
  return `<div class="outlook-verify-summary-strip" role="group" aria-label="三时段校验摘要">${cards}</div>`;
}

function renderOutlookVerifyPanel(inst) {
  return '';
  touchOutlookDetailSection(inst.id, 'dirVerify', inst);
  const exportBtn = `<button type="button" class="btn-link outlook-verify-slot-export" data-action="export-outlook-slot-compare" data-instrument-id="${escapeAttr(inst.id)}" title="导出本品种三时段预测/实际/偏离 CSV">下载三时段对照 CSV</button>`;
  return `<div class="outlook-verify-panel">
    ${renderOutlookSectionHead('预测校验 · 三时段对照', 'rangeVerify', inst.id)}
    <div class="outlook-verify-export-row">${exportBtn}</div>
    ${renderOutlookVerifySummaryStrip(inst)}
    <div class="outlook-verify-section outlook-verify-section-range">
      <h6 class="outlook-verify-subhead">区间 high / low · 预测带 vs 实际</h6>
      ${renderOutlookSlotRangeCompareCompact(inst)}
      ${renderOutlookRangeAuditTable(inst)}
    </div>
    <div class="outlook-verify-section outlook-verify-section-dir">
      <h6 class="outlook-verify-subhead">方向中心 · T+1 收盘校验</h6>
      ${renderOutlookAccuracyTable(inst)}
    </div>
  </div>`;
}

function renderOutlookSlotSnapshotCompare(inst) {
  return '';
  const snaps = inst.slotSnapshotsForSession || [];
  if (!snaps.length) return '';
  const cols = OUTLOOK_PREDICTION_SLOTS.map((slot) => {
    const snap = snaps.find((s) => s.predictionSlot === slot.id);
    const entry = snap?.instruments?.find((i) => i.id === inst.id);
    if (!entry) {
      return `<div class="${outlookVerifySlotColClass(slot.id)} outlook-slot-snap-empty">
        <header class="outlook-verify-slot-head">${escapeHtml(slot.label)}</header>
        <p class="outlook-accuracy-empty">暂无快照</p>
      </div>`;
    }
    const hi = formatOutlookPriceValue(entry.predictedHigh, inst);
    const lo = formatOutlookPriceValue(entry.predictedLow, inst);
    const mid = entry.predictedMid != null ? formatOutlookPctSign(entry.predictedMid) : '—';
    const lateTag = entry.isLateCapture
      ? `<span class="outlook-slot-late-tag" title="补抓 · 已回溯 ${escapeAttr(entry.captureSource || '')} @ ${escapeAttr(entry.lookupTs || '')}">补抓</span>`
      : '';
    return `<div class="${outlookVerifySlotColClass(slot.id)}">
      <header class="outlook-verify-slot-head">${escapeHtml(slot.label)}${lateTag}</header>
      <p class="outlook-slot-snap-summary">中心 <strong>${escapeHtml(mid)}</strong></p>
      <p class="outlook-slot-snap-range">${escapeHtml(hi)} ~ ${escapeHtml(lo)}</p>
      <p class="outlook-slot-snap-dir">${escapeHtml(entry.directionLabel || entry.direction || '—')}</p>
    </div>`;
  }).join('');
  return `<details class="outlook-slot-snapshot-compare-wrap">
    <summary class="outlook-slot-snapshot-summary">三时段快照对照（高级 · 日内）</summary>
    <div class="outlook-slot-snapshot-compare">
    ${renderOutlookSectionHead('三时段快照对照', 'slotSnapshots', inst.id)}
    <div class="outlook-verify-slot-grid outlook-slot-snap-grid">${cols}</div>
  </div>
  </details>`;
}

function renderOutlookSlotBadge(inst) {
  const label = inst?.predictionSlotLabel || window.__outlookSlotCaptureMeta?.predictionSlotLabel;
  if (!label) return '';
  return `<span class="outlook-slot-badge" title="固定时段预测标签">${escapeHtml(label)}</span>`;
}

function renderOutlookSlotFilterTabs() {
  const slots = [
    { id: 'all', label: '全部时段' },
    { id: 'pre-night', label: '20:55夜盘前' },
    { id: 'pre-day', label: '08:55日盘前' },
    { id: 'pre-afternoon', label: '13:25午盘前' },
  ];
  return `<div class="outlook-slot-tabs" role="tablist" aria-label="预测时段对照">
    ${slots
      .map((s) => {
        const on = outlookSlotFilter === s.id;
        return `<button type="button" class="outlook-slot-tab${on ? ' active' : ''}" data-outlook-slot="${escapeAttr(s.id)}" role="tab" aria-selected="${on}">${escapeHtml(s.label)}</button>`;
      })
      .join('')}
  </div>`;
}

function renderOutlookSlotCaptureStrip(stats) {
  const meta = stats?.slotCapture || window.__outlookSlotCaptureMeta;
  if (!meta?.predictionSlotLabel) return '';
  return `<span class="outlook-slot-capture-strip" title="今日最近固定时段快照">时段快照 ${escapeHtml(meta.predictionSlotLabel)}</span>`;
}

function renderOutlookAuditSlotCell(record) {
  const label = record?.predictionSlotLabel || record?.predictionSlot;
  return label ? escapeHtml(label) : '—';
}

function ensureFocusDashboardRows(instruments = []) {
  const list = filterUserFocusInstruments(instruments);
  if (!list.length) return;
  if (!focusDashboardCache) {
    focusDashboardCache = {
      version: OUTLOOK_UI_VERSION,
      sessionDate: new Date().toISOString().slice(0, 10),
      cursorConfigured: Boolean(window.__cursorStatus?.configured),
      focusCount: 0,
      top5: [],
      majorOpportunities: [],
      instruments: [],
    };
  }
  for (const inst of list) {
    const sym = String(inst.id).toLowerCase();
    let row = focusDashboardCache.instruments.find((r) => String(r.symbol).toLowerCase() === sym);
    if (!row) {
      row = {
        symbol: sym,
        name: inst.name,
        exchange: inst.exchange,
        price: inst.price ?? null,
        directionLabel: inst.directionLabel,
        posture: inst.tradingGuidance?.posture || '暂无',
        analysis: null,
        generatedAt: null,
      };
      focusDashboardCache.instruments.push(row);
    }
  }
  focusDashboardCache.focusCount = focusDashboardCache.instruments.length;
}

function applyFocusTop5DeepLiveUpdate(payload) {
  if (payload?.kind !== 'top5-deep') return false;
  const symbol = String(payload?.symbol || '').toLowerCase();
  const result = payload?.result;
  if (!symbol || !result) return false;
  if (!focusDashboardCache?.top5?.length) return false;
  const idx = focusDashboardCache.top5.findIndex((t) => String(t.symbol).toLowerCase() === symbol);
  if (idx < 0) return false;
  focusDashboardCache.top5[idx] = {
    ...focusDashboardCache.top5[idx],
    deepBrief: result.deepBrief || null,
    deepBriefGeneratedAt: result.generatedAt || payload.generatedAt || null,
    deepBriefPending: false,
  };
  if (!isActivePanel('outlook')) return true;
  const panel = document.getElementById('panel-outlook');
  if (!panel) return true;
  const slot = panel.querySelector('.outlook-focus-dashboard-slot');
  if (slot && focusDashboardCache) slot.innerHTML = renderFocusDashboardSection(focusDashboardCache);
  refreshTop5DeepBriefProgressUI(panel);
  return true;
}

function applyFocusAnalysisLiveUpdate(payload) {
  if (applyFocusTop5DeepLiveUpdate(payload)) return;
  const symbol = String(payload?.symbol || '').toLowerCase();
  const result = payload?.result;
  if (!symbol || !result) return;
  const inst = findOutlookInstrument(symbol);
  if (inst) {
    inst.__focusAnalysisPending = false;
    inst.__focusAnalysis = result;
  }
  ensureFocusDashboardRows(inst ? [inst] : []);
  const row = focusDashboardCache?.instruments?.find((r) => String(r.symbol).toLowerCase() === symbol);
  if (row && result.analysis) {
    row.analysis = result.analysis;
    row.generatedAt = result.generatedAt || payload.generatedAt || null;
  }
  if (!isActivePanel('outlook')) return;
  const panel = document.getElementById('panel-outlook');
  if (!panel) return;
  refreshOutlookFocusAnalysisCells(panel, [symbol]);
  refreshFocusAnalysisProgressUI(panel);
  if (outlookSelectedInstrumentId === symbol) {
    refreshOutlookDetailPanelContent(panel, findOutlookInstrument(symbol) || inst);
  }
}

function refreshOutlookFocusAnalysisCells(panel, instrumentIds = null) {
  if (!panel) return;
  const ids =
    instrumentIds ||
    [...panel.querySelectorAll('.outlook-instrument-row:not([hidden])')].map(
      (row) => row.dataset.outlookInstrument
    );
  for (const id of ids) {
    if (!id) continue;
    const rowEl = panel.querySelector(`.outlook-instrument-row[data-outlook-instrument="${CSS.escape(id)}"]`);
    if (!rowEl) continue;
    const inst = findOutlookInstrument(id);
    if (!inst) continue;
    const cell = rowEl.querySelector('.outlook-inst-col.outlook-inst-predict');
    if (cell) cell.innerHTML = renderOutlookPredictionBoxes(inst);
  }
}

let focusAnalysisLiveState = null;

let top5DeepBriefLiveState = null;

function stopTop5DeepBriefLiveRefresh() {
  top5DeepBriefLiveState = null;
}

function refreshTop5DeepBriefProgressUI(panel) {
  if (!panel) return;
  const bar = panel.querySelector('[data-focus-top5-deep-progress]');
  if (!bar) return;
  const top5 = focusDashboardCache?.top5 || [];
  const done = top5.filter((t) => t.deepBrief?.text).length;
  const pending = top5.filter((t) => t.deepBriefPending).length;
  const total = top5.length;
  if (!total) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const pct = total ? Math.round(((done + pending * 0.5) / total) * 100) : 0;
  bar.querySelector('[data-focus-top5-deep-progress-fill]')?.style.setProperty('width', `${pct}%`);
  const label = bar.querySelector('[data-focus-top5-deep-progress-label]');
  if (label) {
    label.textContent =
      pending > 0 ? `Cursor 深度解读 ${done}/${total} · 生成中` : `Cursor 深度解读 ${done}/${total}`;
  }
}

function startTop5DeepBriefLiveRefresh(panel, options = {}) {
  if (!panel || !window.fancheng?.generateTop5DeepBrief) return;
  const cursorReady = focusDashboardCache?.cursorConfigured || window.__cursorStatus?.configured;
  if (!cursorReady) return;
  const top5 = focusDashboardCache?.top5 || [];
  if (!top5.length) return;
  const pending = top5.filter((t) => {
    if (options.force) return true;
    return !t.deepBrief?.text;
  });
  if (!pending.length) {
    refreshTop5DeepBriefProgressUI(panel);
    return;
  }

  stopTop5DeepBriefLiveRefresh();
  const configuredConcurrency = Number(window.__cursorStatus?.concurrency);
  const concurrency =
    Number.isFinite(configuredConcurrency) && configuredConcurrency >= 1
      ? Math.min(3, Math.floor(configuredConcurrency))
      : 2;
  const state = {
    panel,
    queue: pending.map((t) => t.symbol),
    active: 0,
    concurrency,
    force: options.force === true,
    cancelled: false,
  };
  top5DeepBriefLiveState = state;
  for (const sym of state.queue) {
    const row = focusDashboardCache.top5.find((t) => String(t.symbol).toLowerCase() === String(sym).toLowerCase());
    if (row) row.deepBriefPending = true;
  }
  const slot = panel.querySelector('.outlook-focus-dashboard-slot');
  if (slot && focusDashboardCache) slot.innerHTML = renderFocusDashboardSection(focusDashboardCache);
  refreshTop5DeepBriefProgressUI(panel);

  const pump = () => {
    if (!top5DeepBriefLiveState || top5DeepBriefLiveState.cancelled || top5DeepBriefLiveState !== state) return;
    if (!panel.isConnected) {
      stopTop5DeepBriefLiveRefresh();
      return;
    }
    while (state.active < state.concurrency && state.queue.length) {
      const sym = state.queue.shift();
      state.active += 1;
      void window.fancheng
        .generateTop5DeepBrief(sym, { force: state.force })
        .then((result) => {
          if (state.cancelled || top5DeepBriefLiveState !== state) return;
          const row = focusDashboardCache?.top5?.find(
            (t) => String(t.symbol).toLowerCase() === String(sym).toLowerCase()
          );
          if (row) {
            row.deepBriefPending = false;
            if (result?.error) {
              row.deepBrief = { text: null, error: result.error };
            } else if (result?.deepBrief) {
              row.deepBrief = result.deepBrief;
              row.deepBriefGeneratedAt = result.generatedAt;
            }
          }
          const slotEl = panel.querySelector('.outlook-focus-dashboard-slot');
          if (slotEl && focusDashboardCache) slotEl.innerHTML = renderFocusDashboardSection(focusDashboardCache);
          refreshTop5DeepBriefProgressUI(panel);
        })
        .finally(() => {
          if (top5DeepBriefLiveState !== state) return;
          state.active -= 1;
          pump();
        });
    }
  };
  pump();
}

function stopFocusAnalysisLiveRefresh() {
  focusAnalysisLiveState = null;
  stopTop5DeepBriefLiveRefresh();
}

function startFocusAnalysisLiveRefresh(panel, options = {}) {
  if (!panel || !window.fancheng?.generateFocusAnalysis) return;
  const cursorReady = window.__cursorStatus?.configured;
  if (!cursorReady) {
    void window.fancheng.getCursorStatus?.().then((st) => {
      window.__cursorStatus = st;
      if (st?.configured) startFocusAnalysisLiveRefresh(panel, options);
    });
    return;
  }
  ensureFocusDashboardRows(window.__outlookCacheInstruments || []);
  const instruments = filterUserFocusInstruments(window.__outlookCacheInstruments || []);
  const pending = instruments.filter((inst) => {
    if (options.force) return true;
    const cached = getFocusAnalysisForInstrument(inst);
    return !cached?.analysis?.text;
  });
  if (!pending.length) return;

  stopFocusAnalysisLiveRefresh();
  const configuredConcurrency = Number(window.__cursorStatus?.concurrency);
  const defaultConcurrency =
    Number.isFinite(configuredConcurrency) && configuredConcurrency >= 1
      ? Math.min(6, Math.floor(configuredConcurrency))
      : 3;
  const state = {
    panel,
    queue: pending.slice(),
    active: 0,
    concurrency: options.concurrency || defaultConcurrency,
    force: options.force === true,
    cancelled: false,
  };
  focusAnalysisLiveState = state;
  refreshFocusAnalysisProgressUI(panel);

  const pump = () => {
    if (!focusAnalysisLiveState || focusAnalysisLiveState.cancelled || focusAnalysisLiveState !== state) return;
    if (!panel.isConnected) {
      stopFocusAnalysisLiveRefresh();
      return;
    }
    while (state.active < state.concurrency && state.queue.length) {
      const inst = state.queue.shift();
      state.active += 1;
      inst.__focusAnalysisPending = true;
      refreshOutlookFocusAnalysisCells(panel, [inst.id]);
      void window.fancheng
        .generateFocusAnalysis(inst.id, { force: state.force })
        .then((result) => {
          if (state.cancelled || focusAnalysisLiveState !== state) return;
          inst.__focusAnalysisPending = false;
          const sym = String(inst.id).toLowerCase();
          ensureFocusDashboardRows([inst]);
          const row = focusDashboardCache?.instruments?.find((r) => String(r.symbol).toLowerCase() === sym);
          if (result?.error) {
            inst.__focusAnalysis = { analysis: { error: result.error, text: null } };
            if (row) row.analysis = inst.__focusAnalysis.analysis;
          } else if (result) {
            inst.__focusAnalysis = result;
            if (row) {
              row.analysis = result.analysis;
              row.generatedAt = result.generatedAt;
            }
          }
          refreshOutlookFocusAnalysisCells(panel, [inst.id]);
          refreshFocusAnalysisProgressUI(panel);
          if (outlookSelectedInstrumentId === inst.id) {
            refreshOutlookDetailPanelContent(panel, findOutlookInstrument(inst.id) || inst);
          }
        })
        .finally(() => {
          if (focusAnalysisLiveState !== state) return;
          state.active -= 1;
          pump();
        });
    }
  };
  pump();
}

function renderOutlookPredictionBoxes(inst) {
  if (!isUserFocusInstrument(inst)) return '';
  const cached = getFocusAnalysisForInstrument(inst);
  const dash = focusDashboardCache?.instruments?.find(
    (r) => String(r.symbol).toLowerCase() === String(inst?.id || '').toLowerCase()
  );
  const a = cached?.analysis || dash?.analysis;
  if (inst.__focusAnalysisPending || inst.__focusAnalysisLoading) {
    return `<div class="outlook-analysis-brief outlook-analysis-loading">Cursor 分析生成中…</div>`;
  }
  if (!a?.text && !a?.positionAdvice) {
    const configured = focusDashboardCache?.cursorConfigured || window.__cursorStatus?.configured;
    const err = a?.error || (configured ? '分析排队中…' : '待配置 CURSOR_API_KEY');
    const cls = a?.error ? 'outlook-analysis-error' : 'outlook-analysis-pending';
    return `<div class="outlook-analysis-brief ${cls}">${escapeHtml(err)}</div>`;
  }
  const pos = a.positionAdvice || a.text?.slice(0, 120) || '暂无';
  return `<div class="outlook-analysis-brief"><span class="outlook-analysis-pos-label">操作建议</span> ${escapeHtml(String(pos).slice(0, 160))}${String(pos).length > 160 ? '…' : ''}</div>`;
}

function renderOutlookMacroStrip(factors) {
  if (!factors?.length) return '';
  const chips = factors
    .map(
      (f) =>
        `<span class="outlook-macro-chip ${outlookDirectionClass(f.direction)}" title="${escapeAttr(f.detail || f.summary || '')}">${escapeHtml(f.icon || '')} ${escapeHtml(f.label || f.id)} <span class="outlook-macro-chip-arrow">${escapeHtml(f.directionArrow || '→')}</span></span>`
    )
    .join('');
  return `<div class="outlook-macro-strip-wrap"><div class="outlook-macro-strip" role="list">${chips}</div></div>`;
}

function fmtHitWithSample(rate, hits, total) {
  if (rate == null) return '—';
  const pct = Math.round(rate * 100);
  if (hits != null && total != null && total > 0) return `${pct}% (${hits}/${total})`;
  return `${pct}%`;
}

function renderOutlookSectorHitBadges(stats) {
  const bySector = stats?.longRunBySector;
  if (!bySector) return '';
  const target = stats?.hitRateTarget ?? 0.7;
  return Object.entries(bySector)
    .map(([id, s]) => {
      const pct = s.hitRate != null ? Math.round(s.hitRate * 100) : null;
      const gap = s.hitRate != null ? Math.round((target - s.hitRate) * 100) : null;
      const cls = pct == null ? 'empty' : pct >= 70 ? 'hit-target' : pct >= 55 ? 'hit-mid' : 'hit-low';
      const sample = s.total != null && s.total > 0 ? ` n=${s.total}` : '';
      const title =
        pct != null
          ? `${s.label || id} 长周期 ${pct}% (${s.hits ?? '?'}/${s.total ?? '?'}) · 目标70% · 差距${gap >= 0 ? '+' : ''}${gap}pp`
          : `${s.label || id} 暂无回测`;
      return `<span class="outlook-sector-hit ${cls}" data-sector="${escapeAttr(id)}" title="${escapeAttr(title)}">${escapeHtml(s.label || id)} ${pct != null ? pct + '%' + sample : '—'}</span>`;
    })
    .join('');
}

function renderOutlookHitRateBadge(_stats) {
  return '';
}

function replaceOutlookHitRateBadges(panel, stats) {
  if (!panel || !stats) return;
  panel.querySelectorAll('.outlook-hit-rate, .outlook-sector-hit').forEach((el) => el.remove());
  const actions = panel.querySelector('.outlook-toolbar-actions');
  const progressSlot = actions?.querySelector('.outlook-backtest-progress-slot');
  const html = renderOutlookHitRateBadge(stats);
  if (progressSlot) progressSlot.insertAdjacentHTML('beforebegin', html);
  else if (actions) actions.insertAdjacentHTML('beforeend', html);
  panel.querySelectorAll('.outlook-core-tagline .outlook-hit-rate, .outlook-core-tagline .outlook-sector-hit').forEach((el) => el.remove());
}

function renderOutlookCalibrationModalBody(calibration) {
  const sw = calibration?.sectorWeights || {};
  const target = calibration?.hitRateTarget ?? 0.7;
  const rows = Object.entries(sw)
    .map(([sector, w]) => {
      const hit = w.hitRate != null ? `${Math.round(w.hitRate * 100)}%` : '—';
      const gap = w.hitRate != null ? `${Math.round((target - w.hitRate) * 100)}pp` : '—';
      return `<tr>
        <td>${escapeHtml(sector)}</td>
        <td>${(w.philosophyWeight * 100).toFixed(0)}%</td>
        <td>${(w.adaptiveWeight * 100).toFixed(0)}%</td>
        <td>${(w.factorWeight * 100).toFixed(0)}%</td>
        <td>${w.directionBull ?? '—'}</td>
        <td>${hit}</td>
        <td>${gap}</td>
      </tr>`;
    })
    .join('');
  return `<p class="outlook-calibration-intro">板块分权 v1.27 · 网格搜索长周期2019回测 · 目标命中率 <strong>70%</strong></p>
    <table class="outlook-calibration-table">
      <thead><tr><th>板块</th><th>哲学</th><th>自适应</th><th>因子</th><th>方向阈</th><th>回测命中</th><th>距70%</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">运行长周期回测后生成</td></tr>'}</tbody>
    </table>`;
}

function openOutlookCalibrationModal(panel, stats) {
  if (!panel) return;
  let modal = panel.querySelector('.outlook-calibration-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'outlook-calibration-modal outlook-backtest-modal outlook-history-modal';
    modal.innerHTML =
      '<div class="outlook-history-dialog outlook-backtest-dialog"><header><h4>板块权重校准 v1.27</h4><button type="button" class="outlook-history-close" data-action="close-outlook-calibration">×</button></header><div class="outlook-calibration-body"></div></div>';
    panel.appendChild(modal);
  }
  const body = modal.querySelector('.outlook-calibration-body');
  if (body) {
    body.innerHTML = renderOutlookCalibrationModalBody({
      sectorWeights: stats?.sectorWeights,
      hitRateTarget: stats?.hitRateTarget,
    });
  }
  modal.removeAttribute('hidden');
}

function renderOutlookBacktestProgress(progress) {
  if (!progress || progress.phase === 'idle') return '';
  const pct = progress.pct ?? 0;
  return `<div class="outlook-backtest-progress" role="status">
    <span class="outlook-backtest-progress-label">${escapeHtml(progress.message || '回测中…')}</span>
    <progress max="100" value="${pct}"></progress>
    <span class="outlook-backtest-progress-pct">${pct}%</span>
  </div>`;
}

function renderOutlookBacktestSectorTable(summary) {
  if (!summary?.bySector) return '<p class="outlook-accuracy-empty">暂无板块回测数据</p>';
  const rows = Object.entries(summary.bySector)
    .map(([sector, s]) => {
      const r30 = s.hitRate30d != null ? `${Math.round(s.hitRate30d * 100)}%` : '—';
      const r60 = s.hitRate60d != null ? `${Math.round(s.hitRate60d * 100)}%` : '—';
      return `<tr><td>${escapeHtml(sector)}</td><td>${r30}</td><td>${r60}</td><td>${s.total60d ?? '—'}</td></tr>`;
    })
    .join('');
  return `<table class="outlook-backtest-sector-table">
    <thead><tr><th>板块</th><th>30d命中</th><th>60d命中</th><th>样本</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderOutlookHistoricalBacktestBlock(inst) {
  const hitLong = inst.backtestHitRateLongrun;
  const hit30 = inst.backtestHitRate30d;
  const hit60 = inst.backtestHitRate60d;
  const eraTable = renderOutlookLongrunEraTable(inst.backtestByEra ? { byEra: inst.backtestByEra } : outlookLongrunSummaryCache);
  if (hitLong == null && hit30 == null && hit60 == null && !outlookLongrunSummaryCache?.byEra) {
    return '<p class="outlook-accuracy-empty">运行「运行回测」或「长周期 2019至今」后显示 walk-forward 历史命中率</p>';
  }
  const longPct =
    hitLong != null
      ? fmtHitWithSample(hitLong, inst.backtestLongrunHits, inst.backtestLongrunTotal)
      : '暂无';
  const pct30 =
    hit30 != null ? fmtHitWithSample(hit30, inst.backtestHits30d, inst.backtestTotal30d) : '暂无';
  const pct60 =
    hit60 != null ? fmtHitWithSample(hit60, inst.backtestHits60d, inst.backtestTotal60d) : '暂无';
  const gap = inst.backtestAvgGapPct != null ? formatOutlookPctSign(inst.backtestAvgGapPct) : '暂无';
  const longRange =
    inst.backtestLongrunStart && inst.backtestLongrunEnd
      ? `${inst.backtestLongrunStart}→${inst.backtestLongrunEnd}`
      : '2019→今';
  return `<div class="outlook-historical-backtest">
    <ul class="outlook-historical-stats">
      <li>长周期 ${escapeHtml(longRange)} 方向命中 <strong>${longPct}</strong></li>
      <li>近30日方向命中 <strong>${pct30}</strong></li>
      <li>近60日方向命中 <strong>${pct60}</strong></li>
      <li>预测中心平均差距 <strong>${gap}</strong></li>
    </ul>
    <h6 class="outlook-era-subhead">时代分段（COVID / 加息 / 俄乌 / 反内卷 / 2026地缘）</h6>
    ${eraTable}
  </div>`;
}

function renderOutlookToolbar(source, sectors, sectorCounts, activeSector) {
  const stamp = resolveOutlookDisplayStamp(source);
  const stampLabel = stamp ? formatDate(stamp) : '—';
  return `<div class="outlook-toolbar">
    ${renderOutlookSectorTabs(sectors, activeSector, sectorCounts)}
    ${renderOutlookSlotFilterTabs()}
    <div class="outlook-toolbar-actions">
      <span class="outlook-toolbar-stamp">研判更新 ${escapeHtml(stampLabel)}</span>
      ${renderOutlookSlotCaptureStrip(source.stats)}
      <details class="outlook-toolbar-backtest-collapsed">
        <summary class="btn-link">高级 · 回测</summary>
        <button type="button" class="btn-link outlook-toolbar-backtest" data-action="run-outlook-backtest"${outlookBacktestRunning ? ' disabled' : ''} title="近60日 walk-forward">运行回测</button>
        <button type="button" class="btn-link outlook-toolbar-longrun" data-action="run-outlook-longrun-backtest"${outlookLongrunRunning || outlookBacktestRunning ? ' disabled' : ''} title="2019→今 walk-forward">长周期 2019至今</button>
      </details>
      <button type="button" class="btn-link outlook-toolbar-archive" data-action="open-outlook-history-global">研判存档</button>
      <button type="button" class="btn-link outlook-toolbar-daily-compare" data-action="open-outlook-daily-compare">每日对照</button>
      <button type="button" class="btn-link outlook-toolbar-verify-export" data-action="export-outlook-verification-all" title="导出全部品种方向/区间检验 CSV">一键下载复盘</button>
      <button type="button" class="btn-link outlook-toolbar-slot-export" data-action="export-outlook-slot-compare-all" title="导出全部品种×三时段预测/实际/偏离">下载次日预测对照</button>
      <button type="button" class="btn-link outlook-toolbar-calibration" data-action="open-outlook-calibration" title="板块权重与命中率">板块校准</button>
      ${renderOutlookHitRateBadge(source.stats)}
      <span class="outlook-backtest-progress-slot">${renderOutlookBacktestProgress(window.__outlookBacktestProgress)}</span>
    </div>
  </div>`;
}

function renderOutlookAccuracyTable(inst) {
  const hasDirData =
    (inst.directionAuditRecords || []).length ||
    (inst.accuracyRecords || []).some((r) => r.predictionSlot) ||
    Object.values(inst.directionAuditStatsBySlot || {}).some((s) => s?.count > 0);
  if (!hasDirData) {
    return '<p class="outlook-accuracy-empty">等待收盘校验：固定时段快照后将自动比对预测中心 vs 实际涨跌幅</p>';
  }
  return renderOutlookDirectionAuditTable(inst);
}

function renderOutlookPhilosophyBlock(inst) {
  const p = inst.philosophy;
  if (!p) return '';
  const sd = p.supplyDemand;
  const fin = p.financialEnvironment;
  const sf = p.sdFinance;
  const primaryList = (p.ranked?.primary || [])
    .slice(0, 4)
    .map(
      (f) =>
        `<li class="outlook-philosophy-factor outlook-philosophy-primary"><span class="outlook-primary-chip">主</span> ${escapeHtml(f.label)} <span class="outlook-philosophy-weight">${escapeHtml(`${(f.score >= 0 ? '+' : '')}${Number(f.score).toFixed(2)}`)}</span></li>`
    )
    .join('');
  const secondaryList = (p.ranked?.secondary || [])
    .slice(0, 3)
    .map(
      (f) =>
        `<li class="outlook-philosophy-factor outlook-philosophy-secondary${f.capped ? ' outlook-philosophy-downweighted' : ''}">${escapeHtml(f.label)}${f.capped ? ' <span class="outlook-secondary-note">权重降</span>' : ''}</li>`
    )
    .join('');
  const oilBlock =
    p.oilMother?.applicable && Math.abs(p.oilMother.score) > 0.03
      ? `<p class="outlook-oil-spillover">原油传导：${escapeHtml(p.oilMother.label)} ${p.oilMother.score >= 0 ? '+' : ''}${Number(p.oilMother.score).toFixed(2)}</p>`
      : '';
  const paradigm =
    p.paradigmHint || sf?.paradigm0820
      ? `<p class="outlook-paradigm-hint">${escapeHtml(p.paradigmHint || '08/20范式：宽松+供弱需强')}</p>`
      : '';
  return `<div class="outlook-philosophy-block">
    ${renderOutlookSectionHead('研判逻辑', 'philosophy', inst.id)}
    <p class="outlook-philosophy-timeliness">结论具时效性 · 变才是主部${inst.judgementUpdatedDisplay ? ` · 上次更新 ${escapeHtml(inst.judgementUpdatedDisplay)}` : ''}</p>
    ${renderPhilosophyFilterInLogic(inst)}
    <div class="outlook-philosophy-matrix">
      <p><strong>供需判断</strong> ${escapeHtml(sd?.stateLabel || '—')}（${escapeHtml(sd?.summary || '')}）</p>
      <p><strong>金融环境</strong> ${escapeHtml(fin?.regimeLabel || '—')} · ${escapeHtml(fin?.summary || '')}</p>
      <p><strong>组合结论</strong> ${escapeHtml(sf?.note || p.logicSummary || '—')}</p>
      ${paradigm}
    </div>
    <ul class="outlook-philosophy-factors">${primaryList}${secondaryList}</ul>
    ${p.primaryChip ? `<p class="outlook-contradiction-chip outlook-primary-contradiction">${escapeHtml(p.primaryChip)}</p>` : ''}
    ${p.secondaryChip ? `<p class="outlook-contradiction-chip outlook-secondary-contradiction">${escapeHtml(p.secondaryChip)}</p>` : ''}
    ${oilBlock}
    ${p.boj?.summary ? `<p class="outlook-boj-line">日央行：${escapeHtml(p.boj.summary)}</p>` : ''}
  </div>`;
}

function renderOutlookPrimaryDriverChip(inst) {
  const p = inst.philosophy;
  if (!p?.primaryDriverId) return '';
  const isPrimary = p.primaryDriverId === 'sdFinance' || p.policy?.isPrimaryMatch;
  if (!isPrimary && p.ranked?.primary?.length === 0) return '';
  return '<span class="outlook-driver-chip" title="主矛盾驱动">主</span>';
}

function renderOutlookHistoricalBlock(inst) {
  const hc = inst.historicalContext;
  if (!hc) return '<p class="outlook-accuracy-empty">历史对照数据积累中</p>';
  return `<div class="outlook-historical-block">
    <p class="outlook-historical-regime">${escapeHtml(hc.regimeMatchSummary || '—')}</p>
    <ul class="outlook-historical-stats">
      <li>近60日类似波动 <strong>${hc.similarDays60 ?? '—'}</strong> 天</li>
      <li>60日最大波幅 <strong>${hc.maxAbsReturn60 != null ? `${hc.maxAbsReturn60}%` : '—'}</strong></li>
      <li>20日平均波幅 <strong>${hc.avgAbsReturn20 != null ? `${hc.avgAbsReturn20}%` : '—'}</strong></li>
      <li>同类次日均涨跌 <strong>${hc.avgNextDayPct != null ? formatOutlookPctSign(hc.avgNextDayPct) : '—'}</strong></li>
      <li>是否常出现：<strong>${hc.oftenAppears ? '较常出现' : '少见'}</strong></li>
    </ul>
    <p class="outlook-historical-precedent">${escapeHtml(hc.precedentSummary || '')}</p>
  </div>`;
}

function renderCrossMarketIntlTable(inst) {
  const rows = inst?.intlFuturesDisplay;
  if (!rows?.length) return '';
  const body = rows
    .map((r) => {
      const closeText =
        r.close != null && !Number.isNaN(Number(r.close))
          ? Number(r.close).toLocaleString('zh-CN', { maximumFractionDigits: r.label.includes('CNH') ? 4 : 2 })
          : '—';
      return `<tr><td>${escapeHtml(r.label)}</td><td class="outlook-intl-close">${escapeHtml(closeText)}</td><td>${escapeHtml(r.tradeDate || '—')}</td></tr>`;
    })
    .join('');
  return `<div class="outlook-intl-futures-wrap">
    ${renderOutlookSectionHead('外盘参考 · 收盘价', 'intlFutures', inst.id)}
    <table class="outlook-intl-futures-table">
      <thead><tr><th>品种</th><th>收盘价</th><th>日期</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function renderOutlookDetailPanel(inst) {
  if (!inst) {
    return '<div class="outlook-detail-panel outlook-detail-panel-hint"><p class="empty-state">点击品种查看<strong>预测缘由</strong>与<strong>历史对照</strong>；打开页后将自动选中首行</p></div>';
  }
  for (const key of ['philAnchor', 'longTermGuidance', 'tradingGuidance', 'activeTheses', 'philosophy', 'rationale', 'historical', 'factors', 'latency', 'chanStructure']) {
    touchOutlookDetailSection(inst.id, key, inst);
  }
  const sf = inst.intelCenter?.staffFace;
  const title = sf
    ? `${escapeHtml(inst.name || inst.id)} · 幕僚详情`
    : `${escapeHtml(inst.name || inst.id)} · 研判详情`;
  const scenariosBlock = `<details class="outlook-fortune-ref-details outlook-scenarios-demoted">
        <summary>价格/情景参考（非幕僚主输出）</summary>
        ${renderOutlookScenariosTable(inst)}
        ${renderOutlookDailyPredictionCell(inst)}
        ${renderOutlookChangeDelta(inst)}
      </details>`;
  const longTerm = renderOutlookLongTermGuidanceBlock(inst);
  const longTermWrapped = longTerm
      ? `<details class="outlook-fortune-ref-details"><summary>中长期指导 · 参考（非指令）</summary>${longTerm}</details>`
      : '';
  const l2 = renderOutlookL2EnsembleStrip(inst);
  const l2Wrapped = l2
      ? `<details class="outlook-fortune-ref-details"><summary>L2 方向带 · 参考（非指令）</summary>${l2}</details>`
      : '';

  const matrixFull =
    inst?.contradictionMatrix || inst?.intelCenter?.contradictionMatrix
      ? `<div class="outlook-cmatrix-detail-wrap">
      ${renderOutlookSectionHead('矛盾矩阵', 'contradictionMatrix', inst.id)}
      ${renderContradictionMatrixBlock(inst.contradictionMatrix || inst.intelCenter.contradictionMatrix, { compact: false })}
    </div>`
      : '';

  return `<div class="outlook-detail-panel outlook-detail-staff-page${sf?.mode ? ` outlook-detail-staff-${escapeAttr(sf.mode)}` : ''}" data-outlook-detail-for="${escapeAttr(inst.id)}" data-staff-page="1">
    <header class="outlook-detail-panel-head">
      <h4 class="outlook-detail-panel-title">${title}</h4>
      <span class="outlook-judgement-stamp">研判 ${escapeHtml(inst.judgementUpdatedDisplay || '')}</span>
      ${sf?.modeLabel ? `<span class="intel-staff-mode intel-staff-${escapeAttr(sf.mode)}" title="${escapeAttr(sf.display || '')}">${escapeHtml(sf.modeLabel)}</span>` : ''}
      ${renderOutlookRegimeBadge(inst)}
      ${renderOutlookIntegratedBadges(inst)}
      <button type="button" class="btn-link outlook-history-btn" data-action="open-outlook-history" data-instrument="${escapeAttr(inst.id)}">研判存档</button>
      <button type="button" class="btn-link outlook-detail-close" data-action="close-outlook-detail">收起</button>
    </header>
    <div class="outlook-detail-panel-grid outlook-detail-staff-grid">
      <div class="outlook-detail-area outlook-detail-area-memo-primary">
        ${renderIntelCenterMemoBlock(inst)}
        ${matrixFull}
      </div>
      <div class="outlook-detail-area outlook-detail-area-analysis">
        ${scenariosBlock}
        ${renderOutlookDivergenceBanner(inst)}
        ${renderOutlookGlobalLiquidityDetail(window.__outlookCacheGlobalRisk)}
        ${renderCrossMarketIntlTable(inst)}
        ${renderOutlookPilotScopeNote(inst)}
        ${renderOutlookActiveThesesBlock(inst)}
        ${renderPhilosophyAnchorBlock(inst)}
        ${longTermWrapped}
        ${renderOutlookAiFusionBlock(inst)}
        ${renderOutlookFourLayerStrip(inst)}
        ${l2Wrapped}
        ${renderOutlookFiveLawsChips(inst)}
        ${renderOutlookNonPilotGuidanceStub(inst)}
        ${renderOutlookTradingGuidanceBlock(inst)}
        ${renderOutlookChanStructureBlock(inst)}
        ${renderOutlookPhilosophyBlock(inst)}
        ${renderOutlookSectionHead('预测缘由', 'rationale', inst.id)}
        <p class="outlook-prediction-rationale">${escapeHtml(inst.predictionRationale || inst.rationale || '—')}</p>
        ${renderOutlookSectionHead('历史对照', 'historical', inst.id)}
        ${renderOutlookHistoricalBlock(inst)}
        ${renderOutlookLatencyBlock(inst)}
        ${inst.profileSummary ? `<p class="outlook-profile-summary">${escapeHtml(inst.profileSummary)}</p>` : ''}
        ${isUserFocusInstrument(inst) ? '' : `<h5 class="outlook-backtest-inline-head">历史回测</h5>${renderOutlookHistoricalBacktestBlock(inst)}`}
        ${renderOutlookSectionHead('因子贡献', 'factors', inst.id)}
        ${renderOutlookFactorBreakdownTable(inst) || '<p class="outlook-accuracy-empty">因子数据积累中</p>'}
      </div>
    </div>
  </div>`;
}

function findOutlookInstrument(instrumentId) {
  const list = window.__outlookCacheInstruments || [];
  return list.find((i) => i.id === instrumentId) || null;
}

function refreshOutlookDetailPanelContent(panel, inst) {
  if (!panel || !inst?.id) return;
  const slot = panel.querySelector('.outlook-detail-slot');
  if (!slot) return;
  const current = slot.querySelector(`[data-outlook-detail-for="${inst.id}"]`);
  if (!current) {
    slot.innerHTML = renderOutlookDetailPanel(inst);
    return;
  }
  slot.innerHTML = renderOutlookDetailPanel(inst);
}

async function handleFanchengAiQuestion(panel, instrumentId, question) {
  const q = String(question || '').trim();
  if (!q || !instrumentId) return;
  const block = panel?.querySelector(`.outlook-ai-fusion-block[data-ai-fusion-for="${instrumentId}"]`);
  const answerEl =
    block?.querySelector('.outlook-ai-fusion-answer') ||
    panel?.querySelector('.outlook-ai-assistant-answer');
  if (answerEl) {
    answerEl.hidden = false;
    answerEl.innerHTML = '<p class="outlook-ai-fusion-answer-loading">分析中…</p>';
  }
  let result;
  if (window.fancheng?.askFanchengAi) {
    result = await window.fancheng.askFanchengAi(q, instrumentId);
  } else {
    result = { error: 'IPC 不可用' };
  }
  if (!answerEl) return;
  if (result?.error) {
    answerEl.innerHTML = `<p class="outlook-ai-fusion-answer-error">${escapeHtml(result.error)}</p>`;
    return;
  }
  const citeCount = (result.citations || []).length;
  const conf = result.confidence || '—';
  const unknowns = (result.unknowns || []).length ? ` · 未知项 ${result.unknowns.join(', ')}` : '';
  const provider = result.provider === 'cursor' ? ` · Cursor${result.model ? ` ${result.model}` : ''}` : '';
  answerEl.innerHTML = `<p class="outlook-ai-fusion-answer-text"><strong>Q:</strong> ${escapeHtml(q)}</p>
    <p class="outlook-ai-fusion-answer-text"><strong>A:</strong> ${escapeHtml(result.answer || '暂无')}</p>
    <p class="outlook-ai-fusion-answer-meta">置信 ${escapeHtml(conf)} · 引用 ${citeCount} · ${escapeHtml(result.method || '')}${escapeHtml(provider)}${escapeHtml(unknowns)}</p>`;
}

async function regenerateFocusAnalysisForInstrument(panel, instrumentId) {
  if (!instrumentId || !window.fancheng?.generateFocusAnalysis) return;
  const inst = findOutlookInstrument(instrumentId);
  if (!inst) return;
  inst.__focusAnalysisLoading = true;
  refreshOutlookDetailPanelContent(panel, inst);
  const result = await window.fancheng.generateFocusAnalysis(instrumentId, { force: true });
  inst.__focusAnalysisLoading = false;
  if (result?.error) {
    inst.__focusAnalysis = { analysis: { error: result.error, text: null } };
  } else if (result) {
    inst.__focusAnalysis = result;
    const sym = String(instrumentId).toLowerCase();
    if (focusDashboardCache?.instruments) {
      const row = focusDashboardCache.instruments.find((r) => String(r.symbol).toLowerCase() === sym);
      if (row) {
        row.analysis = result.analysis;
        row.generatedAt = result.generatedAt;
      }
    }
    refreshOutlookFocusAnalysisCells(panel, [instrumentId]);
  }
  if (outlookSelectedInstrumentId === instrumentId) {
    refreshOutlookDetailPanelContent(panel, findOutlookInstrument(instrumentId) || inst);
  }
}

function loadOutlookDetailAsyncData(inst, panel) {
  if (!inst?.id) return;
  if (!isUserFocusInstrument(inst) && !isOutlookPilotInstrument(inst)) return;
  const sessionDate =
    inst.predictionSessionDate ||
    window.__outlookSlotCaptureMeta?.sessionDate ||
    new Date().toISOString().slice(0, 10);
  const tasks = [];
  if (isUserFocusInstrument(inst) && window.fancheng?.generateFocusAnalysis) {
    const cached = getFocusAnalysisForInstrument(inst);
    if (!cached?.analysis?.text) {
      inst.__focusAnalysisLoading = true;
      refreshOutlookDetailPanelContent(panel, inst);
    }
    tasks.push(
      window.fancheng.generateFocusAnalysis(inst.id, { force: false }).then((result) => {
        if (!result || result.error || outlookSelectedInstrumentId !== inst.id) return;
        inst.__focusAnalysis = result;
        inst.__focusAnalysisLoading = false;
        if (result.analysis) {
          const sym = String(inst.id).toLowerCase();
          if (focusDashboardCache?.instruments) {
            const row = focusDashboardCache.instruments.find((r) => String(r.symbol).toLowerCase() === sym);
            if (row) row.analysis = result.analysis;
          }
        }
      })
    );
  }
  if (!isUserFocusInstrument(inst) && window.fancheng?.getDirectionPredictionArchive) {
    tasks.push(
      window.fancheng.getDirectionPredictionArchive(inst.id, {}).then((data) => {
        if (!data || data.error || outlookSelectedInstrumentId !== inst.id) return;
        inst.directionAuditRecords = data.records || [];
        if (data.stats) inst.directionAuditStats = data.stats;
      })
    );
  }
      if (window.fancheng?.getOutlookSlotSnapshots) {
    tasks.push(
      window.fancheng.getOutlookSlotSnapshots(sessionDate).then((data) => {
        if (!data || data.error || outlookSelectedInstrumentId !== inst.id) return;
        inst.slotSnapshotsForSession = data.snapshots || [];
        window.__outlookSlotSnapshotsBySession = window.__outlookSlotSnapshotsBySession || {};
        window.__outlookSlotSnapshotsBySession[sessionDate] = data.snapshots || [];
      })
    );
  }
  if (window.fancheng?.getOutlookHistory) {
    tasks.push(
      window.fancheng.getOutlookHistory(inst.id, 14).then((data) => {
        if (!data || data.error || outlookSelectedInstrumentId !== inst.id) return;
        inst.accuracyRecords = data.accuracyRecords || inst.accuracyRecords;
        inst.pendingPrediction = data.pendingPrediction ?? inst.pendingPrediction;
      })
    );
  }
  if (window.fancheng?.getChanStructureHints) {
    inst.chanStructureLoading = true;
    const refPrice = inst.price ?? inst.highLowPrediction?.baseClose ?? null;
    tasks.push(
      window.fancheng.getChanStructureHints(inst.id, refPrice, sessionDate).then((data) => {
        if (!data || data.error || outlookSelectedInstrumentId !== inst.id) return;
        inst.chanStructureHints = data.hints || [];
        inst.chanStructureMeta = { version: data.version, refPrice: data.refPrice };
        inst.chanStructureLoading = false;
      })
    );
  }
  if (window.fancheng?.getFanchengAiBrief && !isUserFocusInstrument(inst)) {
    tasks.push(
      window.fancheng.getFanchengAiBrief(inst.id).then((result) => {
        if (!result || result.error || outlookSelectedInstrumentId !== inst.id) return;
        if (result.aiFusion?.instrumentBrief) inst.aiFusion = result.aiFusion;
      })
    );
  }
  if (!tasks.length) return;
  void Promise.all(tasks).then(() => {
    if (outlookSelectedInstrumentId !== inst.id) return;
    refreshOutlookDetailPanelContent(panel, findOutlookInstrument(inst.id) || inst);
  });
}

/** 品种详情按面孔投影（与 services/intel-face-contracts.projectInstrumentForFace 对齐） */
function projectOutlookInstrumentForFace(inst, faceId) {
  if (!inst?.intelCenter) return inst;
  const face = faceId || 'decision';
  const ic = inst.intelCenter;
  if (face === 'research') {
    return {
      ...inst,
      intelCenter: {
        ...ic,
        faceProjection: { faceId: 'research', label: '研究员', mode: 'full', note: '研究面完整' },
      },
    };
  }
  if (face === 'decision') {
    return {
      ...inst,
      intelCenter: {
        ...ic,
        scenarioLattice: ic.scenarioLattice
          ? {
              display: ic.scenarioLattice.display,
              nDisplay: ic.scenarioLattice.nDisplay,
              weightsCalibrated: ic.scenarioLattice.weightsCalibrated,
              truncatedByFace: true,
            }
          : ic.scenarioLattice,
        redTeam: ic.redTeam
          ? { display: ic.redTeam.display, available: ic.redTeam.available, truncatedByFace: true }
          : ic.redTeam,
        faceProjection: {
          faceId: 'decision',
          label: '决策者',
          mode: 'memo-first',
          note: '决策面：备忘录+门禁优先',
        },
      },
    };
  }
  // execution
  const claim = ic.primaryClaim
    ? {
        claimId: ic.primaryClaim.claimId,
        statement: ic.primaryClaim.statement,
        status: ic.primaryClaim.status,
        side: ic.primaryClaim.side,
        confidence: ic.primaryClaim.confidence,
        triggers: ic.primaryClaim.triggers,
        validUntil: ic.primaryClaim.validUntil,
        falsifyTrigger: ic.primaryClaim.falsifyTrigger,
        otherwiseFalsify: ic.primaryClaim.otherwiseFalsify,
        nDisplay: ic.primaryClaim.nDisplay,
        playbookId: ic.primaryClaim.playbookId,
        regimePlaybookId: ic.primaryClaim.regimePlaybookId,
        atomic: ic.primaryClaim.atomic,
        epochDisplay: ic.primaryClaim.epochDisplay,
      }
    : null;
  return {
    ...inst,
    intelCenter: {
      ...ic,
      primaryClaim: claim,
      clock: ic.clock,
      pricingState: ic.pricingState,
      memo: ic.memo
        ? {
            available: ic.memo.available,
            headline: ic.memo.headline,
            oneLiner: ic.memo.oneLiner,
            triggers: ic.memo.triggers,
            validUntil: ic.memo.validUntil,
            suggestedAction: ic.memo.suggestedAction,
            oppose: ic.memo.oppose,
            publishable: ic.memo.publishable,
            truncatedByFace: true,
          }
        : ic.memo,
      choiceSet: ic.choiceSet
        ? {
            primary: ic.choiceSet.primary,
            primaryId: ic.choiceSet.primaryId,
            display: ic.choiceSet.display,
            truncatedByFace: true,
          }
        : null,
      scenarioLattice: null,
      redTeam: null,
      narrative: null,
      surprise: ic.surprise
        ? { nDisplay: ic.surprise.nDisplay, bucket: ic.surprise.bucket, truncatedByFace: true }
        : null,
      faceProjection: {
        faceId: 'execution',
        label: '执行者',
        mode: 'triggers-only',
        note: '执行面：证伪时钟/触发器/误定价',
      },
    },
  };
}

function updateOutlookDetailPanel(panel, instrumentId, { defer = false } = {}) {
  if (!panel) return;
  const slot = panel.querySelector('.outlook-detail-slot');
  if (!slot) return;
  const id =
    instrumentId && typeof instrumentId === 'object' ? instrumentId.id : instrumentId;
  const render = () => {
    if (!document.body.contains(panel)) return;
    let inst = id ? findOutlookInstrument(id) : null;
    if (inst && intelCenterFace && intelCenterFace !== 'decision') {
      const merged = mergeIntelFaceOverlay(id, intelCenterFace);
      if (merged) inst = merged;
    }
    if (inst && intelCenterFace) {
      inst = projectOutlookInstrumentForFace(inst, intelCenterFace);
    }
    slot.innerHTML = renderOutlookDetailPanel(inst);
    slot.hidden = false;
    panel.querySelectorAll('.outlook-instrument-row').forEach((row) => {
      const on = row.dataset.outlookInstrument === id;
      row.classList.toggle('outlook-instrument-selected', on);
      const btn = row.querySelector('.outlook-instrument-main');
      if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    const listEl = panel.querySelector('.outlook-instrument-list');
    if (listEl && id) scrollVirtualOutlookToInstrument(listEl, id);
    if (inst) loadOutlookDetailAsyncData(inst, panel);
    refreshOutlookAiAssistantHub(panel);
  };
  if (defer) scheduleIdleWork(render);
  else render();
}

function renderOutlookTechBadge(b) {
  const trendClass = b.trend === 'up' ? 'outlook-badge-up' : b.trend === 'down' ? 'outlook-badge-down' : 'outlook-badge-flat';
  return `<span class="outlook-tech-badge ${trendClass}">${escapeHtml(b.label || '')}</span>`;
}

function renderOutlookTechTags(inst, { maxVisible = null } = {}) {
  const badges = inst.techBadges || [];
  if (!badges.length) {
    return '<div class="outlook-tech-tags"><span class="outlook-tech-badge outlook-badge-flat">待数据</span></div>';
  }
  const limit = maxVisible != null ? maxVisible : badges.length;
  const visible = badges.slice(0, limit);
  const rest = badges.length - visible.length;
  const more =
    rest > 0
      ? `<span class="outlook-tech-more" title="${escapeAttr(badges.slice(limit).map((b) => b.label).join(' · '))}">+${rest}</span>`
      : '';
  return `<div class="outlook-tech-tags">${visible.map(renderOutlookTechBadge).join('')}${more}</div>`;
}

function buildOutlookRationaleSummary(inst) {
  if (inst?.rationaleSummary) return inst.rationaleSummary;
  const full = inst?.predictionRationale || inst?.rationale || '';
  if (full) {
    return full.split('\n').find((line) => line.trim())?.trim().slice(0, 48) || '';
  }
  const parts = [];
  const sv = inst?.smoothedVol || inst?.factors?.technical?.smoothedVol;
  if (sv?.regimeLabel) parts.push(sv.regimeLabel);
  if (sv?.volForecastPct != null) parts.push(`σ预测${Number(sv.volForecastPct).toFixed(2)}%`);
  if (inst?.regimeLabel && inst.regime !== 'neutral') parts.push(inst.regimeLabel);
  const news = inst?.factors?.news;
  if (news?.hitCount) parts.push(`资讯${news.hitCount}条`);
  const qg = inst?.quantGate;
  if (qg && !qg.tradableForSim && qg.neutralReasons?.[0]) {
    parts.push(String(qg.neutralReasons[0]).slice(0, 12));
  }
  const pf = inst?.philosophyFilter;
  if (pf?.filterPass === false && pf.neutralReason) {
    parts.push(OUTLOOK_GATE_NEUTRAL_LABELS[pf.neutralReason] || pf.neutralReason);
  }
  if (inst?.latencyLabel) parts.push(inst.latencyLabel);
  const cap = inst?.capitalAttention || inst?.factors?.capitalAttention;
  if (cap?.score != null) parts.push(`资金${cap.score}`);
  return parts.filter(Boolean).join(' · ').slice(0, 48);
}

function renderOutlookRationaleBrief(inst) {
  const full = inst.predictionRationale || inst.rationale || '';
  const sum = buildOutlookRationaleSummary(inst) || (inst.outlookPending ? '行情待加载' : '—');
  return `<span class="outlook-rationale-brief" title="${escapeAttr(full || sum)}"><span class="outlook-rationale-icon" aria-hidden="true">ℹ</span> ${escapeHtml(sum)}</span>`;
}

function ensureOutlookDefaultSelection(instruments, { defer = false } = {}) {
  if (outlookSelectedInstrumentId) return;
  if (defer) {
    scheduleIdleWork(() => ensureOutlookDefaultSelection(instruments, { defer: false }));
    return;
  }
  const holdings = (window.__portfolioHoldings || []).map((h) => String(h).toLowerCase()).filter(Boolean);
  const preferred = [...holdings, 'au'];
  const visible =
    outlookSectorFilter === 'all'
      ? instruments
      : (instruments || []).filter((i) => i.sector === outlookSectorFilter);
  for (const pid of preferred) {
    const hit = visible.find((i) => String(i.id).toLowerCase() === pid && !i.outlookPending);
    if (hit?.id) {
      outlookSelectedInstrumentId = hit.id;
      return;
    }
  }
  const first = visible.find((i) => !i.outlookPending) || visible[0] || instruments?.[0];
  if (first?.id) outlookSelectedInstrumentId = first.id;
}

function renderOutlookFactorBreakdownTable(inst) {
  const rows = inst.factorBreakdownDisplay || inst.factors?.factorBreakdownDisplay || [];
  if (!rows.length) return '';
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 0.01);
  const tableRows = rows
    .map((r) => {
      const pct = Math.round((Math.abs(r.value) / maxAbs) * 100);
      const barClass = r.value >= 0 ? 'outlook-factor-bar-pos' : 'outlook-factor-bar-neg';
      return `<tr class="outlook-factor-row">
        <td class="outlook-factor-name">${escapeHtml(r.label)}</td>
        <td class="outlook-factor-val ${r.value >= 0 ? 'pos' : 'neg'}">${escapeHtml(r.display)}</td>
        <td class="outlook-factor-bar-cell"><span class="outlook-factor-bar ${barClass}" style="width:${pct}%"></span></td>
      </tr>`;
    })
    .join('');
  return `<table class="outlook-factor-table"><thead><tr><th>因子</th><th>贡献</th><th></th></tr></thead><tbody>${tableRows}</tbody></table>`;
}

function renderOutlookCapitalBadge(inst) {
  const cap = inst.capitalAttention || inst.factors?.capitalAttention;
  if (cap?.score == null) {
    return `<span class="outlook-cap-badge outlook-cap-flat" title="${escapeAttr(cap?.reason || cap?.note || '暂无')}">资金关注 暂无</span>`;
  }
  const score = cap.score;
  const tier = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
  const h = cap.horizons || {};
  const subParts = [
    cap.attitudeLabel || '',
    h.oi1wPct != null ? `1周持仓${h.oi1wPct > 0 ? '+' : ''}${Number(h.oi1wPct).toFixed(1)}%` : '',
    h.oi1mPct != null ? `1月持仓${h.oi1mPct > 0 ? '+' : ''}${Number(h.oi1mPct).toFixed(1)}%` : '',
    h.oi3mPct != null ? `3月持仓${h.oi3mPct > 0 ? '+' : ''}${Number(h.oi3mPct).toFixed(1)}%` : '',
    cap.jointWithInventory || '',
    cap.rank != null ? `关注度第${cap.rank}/${cap.rankOf}` : '',
    cap.dataSource || '',
  ].filter(Boolean);
  const att = cap.attitudeLabel ? ` · ${cap.attitudeLabel}` : '';
  return `<span class="outlook-cap-badge outlook-cap-${tier}" title="${escapeAttr(subParts.join(' · '))}">资金关注 ${score}/100${escapeHtml(att)}</span>`;
}

function renderOutlookInstrumentDetail(inst) {
  const f = inst.factors || {};
  const newsHits = (f.news?.hits || [])
    .map(
      (h) =>
        `<li class="outlook-news-hit ${outlookDirectionClass(h.direction)}"><span class="outlook-news-dir">${escapeHtml(h.direction === 'bullish' ? '↑' : h.direction === 'bearish' ? '↓' : '→')}</span> ${escapeHtml(h.title || '')} <span class="outlook-news-src">${escapeHtml(h.source || '')}${h.bucket ? ` · ${escapeHtml(h.bucket)}` : ''}</span></li>`
    )
    .join('');
  const newsHeadline = f.news?.topTitle || f.news?.hits?.[0]?.title
    ? `<p class="outlook-news-top">资讯冲击 ${escapeHtml(f.news.shockDisplay || f.news.summary || '')} · ${escapeHtml(String(f.news.hitCount || 0))} 条命中 · ${escapeHtml((f.news.topTitle || f.news.hits[0].title).slice(0, 72))}${(f.news.topTitle || f.news.hits[0].title).length > 72 ? '…' : ''}</p>`
    : `<p class="outlook-news-top">${escapeHtml(f.news?.summary || '暂无资讯命中')}</p>`;
  const tech = f.technical || {};
  const ma = tech.maStack || {};
  const boll = tech.boll || {};
  const vol = f.volume || {};
  const oi = f.oi || {};
  const cap = inst.capitalAttention || f.capitalAttention;
  const profile = f.profile || {};
  const sv = inst.smoothedVol || tech.smoothedVol || {};
  const volDetail = sv.volForecastPct != null
    ? `<li>平滑波动：σ20 ${sv.sigma20 ?? '—'}% · EMA10 ${sv.volEma10 ?? '—'}% · EMA20 ${sv.volEma20 ?? '—'}% · 预测 ${sv.volForecastPct}%${sv.prevForecastPct != null ? ` · 昨日 ${sv.prevForecastPct}%` : ''}</li>`
    : '';

  const historyCount = inst.historyChangeCount != null ? inst.historyChangeCount : '';
  return `<div class="outlook-instrument-detail" hidden>
    <div class="outlook-detail-toolbar">
      <span class="outlook-judgement-stamp">研判更新 ${escapeHtml(inst.judgementUpdatedDisplay || '')}</span>
      ${renderOutlookRegimeBadge(inst)}
      <button type="button" class="btn-link outlook-history-btn" data-action="open-outlook-history" data-instrument="${escapeAttr(inst.id)}">研判存档${historyCount ? ` (${historyCount})` : ''}</button>
    </div>
    ${renderOutlookChangeDelta(inst)}
    ${renderOutlookLatencyBlock(inst)}
    <p class="outlook-rationale">${escapeHtml(inst.rationale || '')}</p>
    ${inst.profileSummary ? `<p class="outlook-profile-summary">${escapeHtml(inst.profileSummary)}</p>` : ''}
    <div class="outlook-detail-grid">
      <div class="outlook-detail-block">
        <h5>因子贡献分解</h5>
        ${renderOutlookFactorBreakdownTable(inst)}
      </div>
      <div class="outlook-detail-block">
        <h5>资金关注 ${cap?.score != null ? `${cap.score}/100` : '暂无'}${
          cap?.attitudeLabel ? ` · ${escapeHtml(cap.attitudeLabel)}` : ''
        }${cap?.rank != null ? ` · 第${cap.rank}/${cap.rankOf}` : ''}</h5>
        <ul class="outlook-indicator-list">
          <li>资金态度：${
            cap?.attitudeLabel
              ? `${escapeHtml(cap.attitudeLabel)}${cap.attitudeNote ? ` · ${escapeHtml(cap.attitudeNote)}` : ''}`
              : '暂无'
          }</li>
          <li>持仓1周：${
            cap?.horizons?.oi1wPct != null
              ? `${cap.horizons.oi1wPct > 0 ? '+' : ''}${Number(cap.horizons.oi1wPct).toFixed(1)}%`
              : '暂无'
          }</li>
          <li>持仓1月：${
            cap?.horizons?.oi1mPct != null
              ? `${cap.horizons.oi1mPct > 0 ? '+' : ''}${Number(cap.horizons.oi1mPct).toFixed(1)}%`
              : '暂无'
          }</li>
          <li>持仓3月：${
            cap?.horizons?.oi3mPct != null
              ? `${cap.horizons.oi3mPct > 0 ? '+' : ''}${Number(cap.horizons.oi3mPct).toFixed(1)}%`
              : '暂无'
          }</li>
          <li>仓单·资金合证：${cap?.jointWithInventory ? escapeHtml(cap.jointWithInventory) : '暂无'}</li>
          <li>量比5日：${cap?.subMetrics?.volumeRatio5d ?? vol.ratio ?? '—'}</li>
          <li>量比20日：${cap?.subMetrics?.volumeRatio20d ?? '—'}</li>
          <li>成交额代理：${cap?.subMetrics?.turnoverProxy != null ? cap.subMetrics.turnoverProxy.toLocaleString('zh-CN') : '—'}</li>
          <li>数据源：${escapeHtml(cap?.dataSource || '—')}</li>
        </ul>
      </div>
      <div class="outlook-detail-block">
        <h5>技术指标</h5>
        <ul class="outlook-indicator-list">
          <li>MA5/10/20/60：${[ma.ma5, ma.ma10, ma.ma20, ma.ma60].map((v) => (v != null ? Number(v).toFixed(1) : '—')).join(' / ')}</li>
          <li>BOLL：上 ${boll.upper ?? '—'} · 中 ${boll.mid ?? '—'} · 下 ${boll.lower ?? '—'} · 带宽 ${boll.bandwidth ?? '—'}%</li>
          <li>量比：${vol.ratio ?? '—'}（${escapeHtml(vol.label || '—')}）</li>
          <li>持仓：${oi.display || (oi.deltaPct != null ? `${oi.deltaPct > 0 ? '+' : ''}${oi.deltaPct}%` : '—')}（${escapeHtml(oi.label || '—')}）</li>
          ${volDetail}
          <li>品种特性：${escapeHtml(profile.volatilityTier || '—')} · ${escapeHtml(profile.supplyDemandType || '—')}${sv.regimeLabel ? ` · ${escapeHtml(sv.regimeLabel)}` : ''}</li>
        </ul>
      </div>
      <div class="outlook-detail-block">
        <h5>资讯命中</h5>
        ${newsHeadline}
        <ul class="outlook-news-hits">${newsHits || '<li class="outlook-news-hit">暂无 headline</li>'}</ul>
      </div>
    </div>
    ${inst.sourceNote ? `<p class="outlook-source-note">${escapeHtml(inst.sourceNote)}</p>` : ''}
  </div>`;
}

function flattenCommoditiesLiveMap(commodities) {
  const map = new Map();
  for (const ex of commodities?.exchanges || []) {
    for (const item of ex.items || []) {
      if (item?.id) map.set(normCommodityId(item.id), item);
    }
  }
  return map;
}

function renderOutlookPriceBox(inst) {
  if (inst.price != null && !Number.isNaN(Number(inst.price))) {
    const chgClass =
      inst.changePct != null && !Number.isNaN(Number(inst.changePct))
        ? Number(inst.changePct) >= 0
          ? 'chg-up'
          : 'chg-down'
        : 'chg-flat';
    const chgText =
      inst.changePct != null && !Number.isNaN(Number(inst.changePct))
        ? `${inst.changePct >= 0 ? '+' : ''}${Number(inst.changePct).toFixed(2)}%`
        : '—';
    const closeBadge =
      inst.priceReason === '收盘价' || inst.priceReason === '昨收' || inst.isLivePrice === false
        ? `<span class="outlook-close-badge" title="${escapeAttr(inst.closingDate ? `${inst.priceReason || '收盘'} ${inst.closingDate}` : inst.priceReason || '收盘价')}">${escapeHtml(inst.priceReason || '收盘')}</span>`
        : inst.isLivePrice === true
          ? '<span class="outlook-live-price-badge" title="盘中实时报价">实时</span>'
          : '';
    return `<div class="outlook-price-box" data-outlook-price-for="${escapeAttr(inst.id)}">
      <div class="outlook-price-val">${Number(inst.price).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</div>
      ${inst.unit ? `<div class="outlook-price-unit">${escapeHtml(inst.unit)}</div>` : ''}
      ${closeBadge}
      <div class="outlook-chg-box ${chgClass}">${escapeHtml(chgText)}</div>
    </div>`;
  }
  return `<div class="outlook-price-box outlook-price-box-missing" data-outlook-price-for="${escapeAttr(inst.id)}">
    <div class="outlook-price-val outlook-price-missing">—</div>
    ${inst.priceReason ? `<div class="outlook-price-reason">${escapeHtml(inst.priceReason)}</div>` : ''}
    <div class="outlook-chg-box chg-flat">—</div>
  </div>`;
}

function mergeCommoditiesPricesIntoOutlookCache(commodities, stampIso) {
  const quoteMap = flattenCommoditiesLiveMap(commodities);
  if (!quoteMap.size || !window.__outlookCacheInstruments?.length) return false;
  const iso = stampIso || commodities?.fetchedAt || commodities?.liveRefreshedAt || new Date().toISOString();
  const display = formatOutlookJudgementTime(iso);
  let changed = false;
  window.__outlookCacheInstruments = window.__outlookCacheInstruments.map((inst) => {
    const q = quoteMap.get(normCommodityId(inst.id));
    if (!q || q.price == null || Number.isNaN(Number(q.price))) return inst;
    const price = q.price;
    const changePct = q.changePct;
    const unit = q.unit || inst.unit;
    const isLivePrice = q.isLivePrice ?? inst.isLivePrice;
    const priceReason = q.priceReason ?? inst.priceReason;
    const closingPrice = q.closingPrice ?? inst.closingPrice;
    const closingDate = q.closingDate ?? inst.closingDate;
    if (
      inst.price === price &&
      inst.changePct === changePct &&
      inst.unit === unit &&
      inst.isLivePrice === isLivePrice &&
      inst.priceReason === priceReason &&
      inst.judgementUpdatedDisplay === display &&
      !inst.outlookPending
    ) {
      return inst;
    }
    changed = true;
    return {
      ...inst,
      price,
      changePct,
      unit,
      isLivePrice,
      priceReason:
        priceReason === '行情未加载' || priceReason === '报价不可用' ? null : priceReason,
      closingPrice,
      closingDate,
      outlookPending: false,
      judgementUpdatedAt: iso,
      judgementUpdatedDisplay: display,
    };
  });
  if (changed || stampIso) window.__outlookCacheLiveAt = iso;
  return changed || Boolean(stampIso);
}

function refreshOutlookDetailLiveTimestamps() {
  if (!outlookSelectedInstrumentId) return;
  const panel = document.getElementById('panel-outlook');
  if (!panel) return;
  const inst = findOutlookInstrument(outlookSelectedInstrumentId);
  if (!inst) return;
  refreshOutlookDetailPanelContent(panel, inst);
}

function applyOutlookQuotesLiveUpdate(payload) {
  const commodities = payload?.commodities;
  if (!commodities?.exchanges?.length) return;
  const stamp = payload?.liveRefreshedAt || commodities.fetchedAt || commodities.liveRefreshedAt;

  const prevWatchSnap = window.__outlookWatchSnapshot || null;
  window.__preloadedCommoditiesLive = commodities;
  mergeCommoditiesPricesIntoOutlookCache(commodities, stamp);

  if (payload?.outlook?.instruments?.length) {
    const nextSnap = snapshotOutlookWatchLevels(payload.outlook.instruments);
    const watchChanged = outlookWatchLevelsChanged(prevWatchSnap, nextSnap);
    cacheOutlookSource(payload.outlook, { silentRefresh: !watchChanged });
    window.__outlookWatchSnapshot = nextSnap;
  }

  if (stamp) {
    updateOutlookToolbarStamp(stamp);
    if (isActivePanel('outlook')) {
      $('#lastUpdated').textContent = `研判实时 ${formatDate(stamp)}`;
    }
  }

  if (!isActivePanel('outlook')) {
    updateNavTabBadge('outlook', window.__outlookCacheInstruments?.length || null);
    return;
  }
  if (!shouldProcessOutlookLiveUpdate()) return;

  updateOutlookPriceCells(commodities, { batch: true, force: true, flash: false });
  refreshOutlookDetailLiveTimestamps();
}

function patchOutlookPriceCell(row, inst, { flash = false } = {}) {
  const col = row.querySelector('.outlook-inst-price');
  if (!col) return;
  const prevBox = col.querySelector('.outlook-price-box');
  const prevVal = prevBox?.querySelector('.outlook-price-val')?.textContent?.trim();
  col.innerHTML = renderOutlookPriceBox(inst);
  if (flash && prevVal && inst.price != null) {
    const nextVal = Number(inst.price).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    if (prevVal !== nextVal) {
      const box = col.querySelector('.outlook-price-box');
      box?.classList.add('outlook-price-flash');
      setTimeout(() => box?.classList.remove('outlook-price-flash'), 450);
    }
  }
}

function updateOutlookToolbarStamp(stamp) {
  if (!stamp) return;
  window.__outlookCacheLiveAt = stamp;
  if (!isActivePanel('outlook')) return;
  const panel = document.getElementById('panel-outlook');
  const stampEl = panel?.querySelector('.outlook-toolbar-stamp');
  if (stampEl) stampEl.textContent = `研判更新 ${formatDate(stamp)}`;
  const liveTag = panel?.querySelector('.outlook-live-tag');
  if (liveTag) {
    liveTag.innerHTML = `<span class="policy-live-dot"></span>实时 ${formatDate(stamp)}`;
  }
}

function updateOutlookPriceCells(commoditiesOrInstruments, options = {}) {
  if (!isActivePanel('outlook') || !shouldProcessOutlookLiveUpdate()) return;
  const panel = document.getElementById('panel-outlook');
  if (!panel?.querySelector('.outlook-instrument-row')) return;

  const quoteMap =
    commoditiesOrInstruments?.exchanges != null
      ? flattenCommoditiesLiveMap(commoditiesOrInstruments)
      : null;
  const instruments = commoditiesOrInstruments?.exchanges
    ? window.__outlookCacheInstruments
    : commoditiesOrInstruments;
  if (!instruments?.length) return;

  const now = Date.now();
  const batch = options.batch === true;
  const throttleMs = options.throttleMs ?? OUTLOOK_PRICE_PATCH_MIN_MS;

  for (const inst of instruments) {
    const id = normCommodityId(inst.id);
    if (!batch && !options.force && now - (outlookPricePatchAtById.get(id) || 0) < throttleMs) {
      continue;
    }
    const quote = quoteMap?.get(id);
    const patchInst = quote
      ? {
          ...inst,
          price: quote.price,
          changePct: quote.changePct,
          unit: quote.unit || inst.unit,
          isLivePrice: quote.isLivePrice ?? inst.isLivePrice,
          priceReason: quote.priceReason ?? inst.priceReason,
          closingPrice: quote.closingPrice ?? inst.closingPrice,
          closingDate: quote.closingDate ?? inst.closingDate,
          outlookPending: quote.price == null,
        }
      : inst;
    if (patchInst.price == null && patchInst.changePct == null && !patchInst.priceReason) continue;

    const row = panel.querySelector(
      `.outlook-instrument-row[data-outlook-instrument="${escapeAttr(inst.id)}"]`
    );
    if (!row || row.hidden) continue;

    patchOutlookPriceCell(row, patchInst, { flash: options.flash !== false });
    outlookPricePatchAtById.set(id, now);
  }
}


function applyCommoditiesLiveToOutlook(commodities) {
  applyOutlookQuotesLiveUpdate({ commodities, liveRefreshedAt: commodities?.fetchedAt || commodities?.liveRefreshedAt });
}

function renderOutlookInstrumentHitStrip(_inst) {
  return '';
}

function renderOutlookFiveLawsChips(inst) {
  const gate = inst?.quantGate;
  const fl = gate?.fiveLaws;
  if (!fl?.votes?.length) return '';
  const lawLabels = {
    turtle: '海龟',
    dolphin: '海豚',
    oneTwoThree: '1-2-3',
    volatility: '波动',
    oscillation: '摆荡',
  };
  const chips = fl.votes
    .map((v) => {
      const label = lawLabels[v.law] || v.law;
      let dir = '—';
      let cls = 'neutral';
      if (v.direction === 'long') {
        dir = '多';
        cls = 'bull';
      } else if (v.direction === 'short') {
        dir = '空';
        cls = 'bear';
      } else if (v.state === 'active') {
        dir = '中';
      }
      const inactive = v.state === 'inactive' ? ' inactive' : '';
      return `<span class="outlook-five-law-chip outlook-five-law-${cls}${inactive}" title="${escapeAttr(v.reason || v.law || '')}">${escapeHtml(label)} ${escapeHtml(dir)}</span>`;
    })
    .join('');
  const aligned =
    fl.alignedCount != null && fl.requiredVotes != null
      ? `<span class="outlook-five-law-meta">票 ${fl.alignedCount}/${fl.requiredVotes}</span>`
      : '';
  let bandBadge = '<span class="outlook-band-chip unknown">区间待校验</span>';
  if (gate.bandTradable === true) bandBadge = '<span class="outlook-band-chip ok">区间可交易</span>';
  else if (gate.bandTradable === false) bandBadge = '<span class="outlook-band-chip miss">区间未命中</span>';
  return `<div class="outlook-five-laws-strip" role="group" aria-label="五法则">
    <div class="outlook-five-laws-head">五法则 · ${escapeHtml(fl.regime || gate.volatilityRegime || '—')}</div>
    <div class="outlook-five-laws-chips">${chips}${aligned}${bandBadge}</div>
  </div>`;
}

function renderOutlookInstrumentRow(inst) {
  if (!inst?.id) return '';
  const techTags = renderOutlookTechTags(inst, { maxVisible: 3 });
  const selected = outlookSelectedInstrumentId === inst.id;
  const priceHtml = renderOutlookPriceBox(inst);
  const gateBadges = renderOutlookGateBadges(inst);

  const focusBadges = renderFocusRowBadges(inst.id);
  const intelBadges = renderIntelCenterRowBadges(inst);
  const focusRow = focusDashboardCache?.instruments?.find(
    (r) => String(r.symbol).toLowerCase() === String(inst.id).toLowerCase()
  );
  const pinnedCls = focusRow?.isMajorOpportunity ? ' outlook-row-major' : '';

  return `<article class="outlook-instrument-row ${outlookDirectionClassForInst(inst)}${selected ? ' outlook-instrument-selected' : ''}${inst.insufficientData ? ' outlook-insufficient-data' : ''}${inst.secondaryDominates ? ' outlook-secondary-warning' : ''}${pinnedCls}${
    inst.intelCenter?.staffFace?.mode ? ` outlook-staff-${escapeAttr(inst.intelCenter.staffFace.mode)}` : ''
  }" data-outlook-instrument="${escapeAttr(inst.id)}" data-outlook-sector="${escapeAttr(inst.sector || 'all')}">
    <button type="button" class="outlook-instrument-main" data-action="select-outlook-instrument" aria-expanded="${selected ? 'true' : 'false'}">
      <div class="outlook-inst-col outlook-inst-name">
        <span class="outlook-inst-title">${renderOutlookPrimaryDriverChip(inst)}${gateBadges}${intelBadges}${focusBadges}${escapeHtml(inst.name || inst.id)}${inst.secondaryDominates ? '<span class="outlook-secondary-warn-badge" title="次矛盾权重异常偏高">⚠次矛盾</span>' : ''}${inst.insufficientData ? '<span class="outlook-insufficient-badge">数据不足·观望</span>' : ''}</span>
        <span class="outlook-inst-ex">${escapeHtml(inst.exchange || '')}</span>
      </div>
      <div class="outlook-inst-col outlook-inst-price">${priceHtml}</div>
      <div class="outlook-inst-col outlook-inst-predict">
        ${renderOutlookPredictionBoxes(inst)}
        ${renderOutlookInstrumentHitStrip(inst)}
      </div>
      <div class="outlook-inst-col outlook-inst-rationale">${renderOutlookRationaleBrief(inst)}</div>
      <div class="outlook-inst-col outlook-inst-cap">
        ${renderOutlookCapitalBadge(inst)}
      </div>
      <div class="outlook-inst-col outlook-inst-dir outlook-inst-staff" aria-label="幕僚研判">
        ${(() => {
          const leadInfo = buildOutlookStaffListLead(inst);
          const fortuneOk = leadInfo.fortuneOk;
          return `<span class="outlook-claim-lead" title="${escapeAttr(leadInfo.tip)}"><span class="outlook-claim-status">${escapeHtml(
            leadInfo.lead
          )}</span>${
            leadInfo.showArrow
              ? `<span class="outlook-dir-arrow outlook-dir-arrow-secondary" aria-hidden="true">${escapeHtml(leadInfo.arrow)}</span>`
              : `<span class="outlook-dir-arrow outlook-dir-arrow-muted" aria-hidden="true">·</span>`
          }</span>${
            leadInfo.directionLabel
              ? `<span class="outlook-dir-label outlook-dir-label-aux">${escapeHtml(leadInfo.directionLabel)}</span>`
              : ''
          }`;
        })()}
        ${renderOutlookPostureBadge(inst)}
        ${renderOutlookEntryReadinessBadge(inst)}
        <span class="outlook-stars${inst.intelCenter?.staffFace?.fortuneChromeAllowed === false ? ' outlook-stars-muted' : ''}" title="置信度（含波动稳定性）">${escapeHtml(inst.starsHtml || '')}</span>
        <span class="outlook-composite-score${inst.intelCenter?.staffFace?.fortuneChromeAllowed === false ? ' outlook-score-muted' : ''}" title="综合分">${escapeHtml(inst.compositeScoreDisplay || (inst.compositeScore != null ? `${inst.compositeScore >= 0 ? '+' : ''}${Number(inst.compositeScore).toFixed(2)}` : ''))}</span>
        ${inst.changeDelta?.deltaScore != null ? `<span class="outlook-delta-score" title="较上次综合分">Δ分${inst.changeDelta.deltaScore >= 0 ? '+' : ''}${Number(inst.changeDelta.deltaScore).toFixed(2)}</span>` : ''}
        ${inst.latencyLabel ? `<span class="outlook-latency-chip outlook-latency-${escapeAttr(inst.latencyState || 'sync')}" title="双速反射">${escapeHtml(inst.latencyLabel)}</span>` : ''}
      </div>
      <div class="outlook-inst-col outlook-inst-badges">${techTags}</div>
      <span class="outlook-expand-icon" aria-hidden="true">${selected ? '▾' : '▸'}</span>
    </button>
  </article>`;
}

function renderOutlookCategoryCard(cat) {
  return `<article class="outlook-category-card" data-outlook-bucket="${escapeAttr(cat.id)}">
    <header class="outlook-category-head">
      <span class="outlook-category-icon">${escapeHtml(cat.icon || '')}</span>
      <h3 class="outlook-category-name">${escapeHtml(cat.name || '')}</h3>
    </header>
    <div class="outlook-horizon-grid">
      <div class="outlook-horizon-col">
        <h4 class="outlook-horizon-label">短期</h4>
        ${renderOutlookHorizonCell(cat.short)}
      </div>
      <div class="outlook-horizon-col">
        <h4 class="outlook-horizon-label">中期</h4>
        ${renderOutlookHorizonCell(cat.medium)}
      </div>
      <div class="outlook-horizon-col">
        <h4 class="outlook-horizon-label">长期</h4>
        ${renderOutlookHorizonCell(cat.long)}
      </div>
    </div>
  </article>`;
}

function renderOutlookFactorCard(f) {
  const lead = String(f.summary || f.detail || f.directionLabel || '暂无').slice(0, 28);
  return `<article class="outlook-factor-card ${outlookDirectionClass(f.direction)}" data-outlook-factor="${escapeAttr(f.id)}">
    <header class="outlook-factor-head">
      <span class="outlook-factor-icon">${escapeHtml(f.icon || '')}</span>
      <span class="outlook-factor-label">${escapeHtml(f.label || '')}</span>
      <span class="outlook-factor-lead" title="${escapeAttr(f.summary || '')}">${escapeHtml(lead)}</span>
      <span class="outlook-dir-arrow outlook-factor-arrow outlook-dir-arrow-secondary" aria-hidden="true">${escapeHtml(f.directionArrow || '→')}</span>
    </header>
    <div class="outlook-factor-meta">
      <span class="outlook-dir-label">${escapeHtml(f.directionLabel || '')}</span>
      <span class="outlook-stars">${escapeHtml(f.starsHtml || '')}</span>
    </div>
    <p class="outlook-factor-summary">${escapeHtml(f.summary || '')}</p>
    ${f.detail ? `<p class="outlook-factor-detail">${escapeHtml(f.detail)}</p>` : ''}
  </article>`;
}

function renderOutlookStatsInline(stats) {
  if (!stats) return '';
  return `<div class="policy-stats-inline outlook-stats-inline">
    <span>${escapeHtml(stats.dataQualityLabel || '')}</span>
    <span>${stats.instrumentCount || 0} 品种</span>
    <span>${stats.factorCount || 7} 宏观因子</span>
  </div>`;
}

function renderOutlookSectorTabs(sectors, activeSector = 'all', instrumentCounts = {}) {
  const defs = [{ id: 'all', name: '全部', icon: '📋' }, ...(sectors || [])];
  return `<div class="outlook-sector-tabs" role="tablist" aria-label="品种板块">
    ${defs
      .map((s) => {
        const count =
          s.id === 'all'
            ? Object.values(instrumentCounts).reduce((n, v) => n + v, 0)
            : instrumentCounts[s.id] || 0;
        const label = OUTLOOK_SECTOR_LABELS[s.id] || s.name || s.id;
        return `<button type="button" class="outlook-sector-tab${activeSector === s.id ? ' active' : ''}" data-outlook-sector="${escapeAttr(s.id)}" role="tab" aria-selected="${activeSector === s.id}">${escapeHtml(s.icon || '')} ${escapeHtml(label)}${count ? ` (${count})` : ''}</button>`;
      })
      .join('')}
  </div>`;
}

function countOutlookInstrumentsBySector(instruments) {
  const counts = {};
  for (const inst of instruments || []) {
    const sector = inst.sector || 'all';
    counts[sector] = (counts[sector] || 0) + 1;
  }
  return counts;
}

function outlookPanelNeedsFullMount(panel, source) {
  if (!panel) return true;
  if (isOutlookPanelPlaceholder(panel)) return true;
  if (panel.dataset.outlookUiVersion !== OUTLOOK_UI_VERSION) return true;
  const listEl = panel.querySelector('.outlook-instrument-list');
  if (listEl && listEl.dataset.outlookListMounted !== '1' && listEl.dataset.virtualMounted !== '1') return true;
  const hasData = source?.instruments?.length || source?.categories?.length;
  if (!hasData) return false;
  if (hasData && listEl && !listEl.querySelector('.outlook-instrument-row')) return true;
  return false;
}

function applyOutlookSectorFilter(panel, sector = outlookSectorFilter) {
  if (!panel) return;
  const instruments = window.__outlookCacheInstruments || [];
  const visible = getOutlookVisibleInstruments(instruments, sector);
  const emptyEl = panel.querySelector('.outlook-sector-empty');
  if (emptyEl) emptyEl.hidden = visible.length > 0;
  const listEl = panel.querySelector('.outlook-instrument-list');
  if (listEl?.dataset.virtualMounted === '1') {
    const expectedHash = hashOutlookInstrumentsContent(instruments);
    if (listEl.dataset.contentHash !== expectedHash) {
      remountOutlookInstrumentList(panel, instruments, { immediate: true, skipSkeleton: true, force: true });
    } else {
      listEl.dataset.outlookInstrumentCount = String(visible.length);
    }
    return;
  }
  const rows = panel.querySelectorAll('.outlook-instrument-row');
  let visibleCount = 0;
  rows.forEach((row) => {
    const rowSector = row.dataset.outlookSector || '';
    const show = sector === 'all' || rowSector === sector;
    row.hidden = !show;
    if (show) visibleCount += 1;
  });
  if (emptyEl) emptyEl.hidden = visibleCount > 0;
  if (listEl) {
    listEl.dataset.contentHash = hashOutlookInstrumentsContent(visible);
  }
}

function getOutlookCachedSource() {
  if (!window.__outlookCacheCategories?.length && !window.__outlookCacheInstruments?.length) return null;
  return {
    categories: window.__outlookCacheCategories,
    instruments: window.__outlookCacheInstruments,
    factors: window.__outlookCacheFactors,
    framework: window.__outlookCacheFramework,
    stats: window.__outlookCacheStats,
    dataLabel: '大宗商品走势研判 · 逐品种多因子 · 次日波动情景',
    liveRefreshedAt: window.__outlookCacheLiveAt,
    updatedAt: window.__outlookCacheUpdatedAt,
  };
}

const OUTLOOK_GATE_NEUTRAL_LABELS = {
  philosophy_neutral: '哲学中性',
  philosophy_divergence: '哲学发散',
  event_pullback: '事件回撤',
  policy_day_neutral: '政策日',
  cross_market_conflict: '跨境冲突',
  priced_in_full: '利好兑现',
  low_philosophy_confidence: '置信不足',
};

function attachOutlookListSlotContext(instruments, snapshots, sessionDate) {
  if (!instruments?.length) return instruments || [];
  const slotOrder = ['pre-night', 'pre-day', 'pre-afternoon'];
  const latestSlot =
    window.__outlookSlotCaptureMeta?.predictionSlot ||
    [...(snapshots || [])].sort((a, b) => String(b.predictTs).localeCompare(String(a.predictTs)))[0]
      ?.predictionSlot ||
    'pre-night';
  const activeSlot = outlookSlotFilter && outlookSlotFilter !== 'all' ? outlookSlotFilter : latestSlot;
  const snap = (snapshots || []).find((s) => s.predictionSlot === activeSlot);
  const slotMeta = OUTLOOK_PREDICTION_SLOTS.find((s) => s.id === activeSlot);

  return instruments.map((inst) => {
    const entry = snap?.instruments?.find((i) => String(i.id).toLowerCase() === String(inst.id).toLowerCase());
    const audit = (inst.rangeAuditRecords || []).find(
      (r) => r.sessionDate === sessionDate && r.predictionSlot === activeSlot
    );
    return {
      ...inst,
      listSlotContext: {
        slotId: activeSlot,
        slotLabel: slotMeta?.shortLabel || snap?.predictionSlotLabel || activeSlot,
        sessionDate,
        entry: entry || null,
        audit: audit || null,
      },
    };
  });
}

function loadOutlookSlotSnapshotsGlobal(sessionDate) {
  const day = sessionDate || window.__outlookSlotCaptureMeta?.sessionDate || new Date().toISOString().slice(0, 10);
  if (!window.fancheng?.getOutlookSlotSnapshots) return Promise.resolve(null);
  return window.fancheng.getOutlookSlotSnapshots(day).then((data) => {
    if (!data || data.error) return null;
    window.__outlookSlotSnapshotsBySession = window.__outlookSlotSnapshotsBySession || {};
    window.__outlookSlotSnapshotsBySession[day] = data.snapshots || [];
    if (data.latest) window.__outlookSlotCaptureMeta = { ...window.__outlookSlotCaptureMeta, ...data.latest, sessionDate: day };
    const list = window.__outlookCacheInstruments;
    if (list?.length) {
      window.__outlookCacheInstruments = attachOutlookListSlotContext(list, data.snapshots, day);
      const panel = document.getElementById('panel-outlook');
      if (panel && isActivePanel('outlook')) {
        remountOutlookInstrumentList(panel, window.__outlookCacheInstruments, { immediate: true, skipSkeleton: true });
        applyOutlookSectorFilter(panel, outlookSectorFilter);
      }
    }
    return data;
  });
}

function enrichOutlookInstrumentClientSide(inst) {
  if (!inst) return inst;
  const enriched = { ...inst };
  const display = deriveOutlookVolatilityDisplay(enriched);
  if (
    display &&
    (display.mode === 'pct-derived' || display.mode === 'absolute') &&
    display.predictedHigh != null &&
    display.predictedLow != null
  ) {
    enriched.highLowPrediction = {
      ...(enriched.highLowPrediction || {}),
      predictedHigh: display.predictedHigh,
      predictedLow: display.predictedLow,
      baseClose: display.baseClose ?? enriched.highLowPrediction?.baseClose,
      baselineDate: display.baselineDate ?? enriched.highLowPrediction?.baselineDate,
      method: display.method,
      dataSource: display.method,
    };
  }
  if (!enriched.rangeComparison || enriched.rangeComparison.actualHigh == null) {
    const built = resolveOutlookRangeCompare(enriched);
    if (built) enriched.rangeComparison = { ...(enriched.rangeComparison || {}), ...built };
  }
  const rationaleFull = enriched.predictionRationale || enriched.rationale || '';
  enriched.rationaleSummary = buildOutlookRationaleSummary(enriched) || enriched.rationaleSummary || '';
  if (!enriched.rationaleSummary && rationaleFull) {
    enriched.rationaleSummary =
      rationaleFull.split('\n').find((line) => line.trim())?.trim().slice(0, 48) || '';
  }
  return enriched;
}

function enrichOutlookInstrumentsClientSide(instruments) {
  if (!instruments?.length) return instruments || [];
  return filterUserFocusInstruments(instruments).map(enrichOutlookInstrumentClientSide);
}

function renderOutlookGateBadges(inst) {
  const parts = [];
  const pf = inst.philosophyFilter;
  if (pf) {
    if (pf.filterPass === false) {
      const reason = OUTLOOK_GATE_NEUTRAL_LABELS[pf.neutralReason] || pf.neutralReason || '过滤';
      parts.push(
        `<span class="outlook-gate-badge outlook-gate-block" title="哲学 Gate：${escapeAttr(reason)}">Phil·${escapeHtml(String(reason).slice(0, 4))}</span>`
      );
    } else {
      parts.push('<span class="outlook-gate-badge outlook-gate-pass" title="哲学 Gate 通过">Phil✓</span>');
    }
  }
  const qg = inst.quantGate;
  if (qg) {
    if (qg.tradableForSim) {
      parts.push('<span class="outlook-gate-badge outlook-gate-pass" title="Quant Gate 可交易">Q✓</span>');
    } else {
      const reason = qg.neutralReasons?.[0] || '拦截';
      parts.push(
        `<span class="outlook-gate-badge outlook-gate-block" title="Quant Gate：${escapeAttr(reason)}">Q·${escapeHtml(String(reason).slice(0, 4))}</span>`
      );
    }
  }
  if (!parts.length) return '';
  return `<span class="outlook-gate-badges">${parts.join('')}</span>`;
}

function cacheOutlookSource(source, options = {}) {
  if (!source) return;
  if (source.error) window.__outlookLoadError = source.error;
  if (!source.instruments?.length) return;
  window.__outlookCacheCategories = source.categories;
  const rawInstruments = enrichOutlookInstrumentsClientSide(source.instruments);
  window.__outlookCacheInstruments = outlookBacktestSummaryCache
    ? mergeBacktestIntoOutlookInstruments(rawInstruments, outlookBacktestSummaryCache)
    : rawInstruments;
  window.__outlookCacheFactors = source.factors;
  window.__outlookCacheFramework = source.framework;
  window.__outlookCacheStats = source.stats;
  window.__outlookCacheGlobalRisk = source.globalLiquidityRisk || source.globalRisk || null;
  window.__outlookCacheAiMacroBrief = source.aiMacroBrief || window.__outlookCacheAiMacroBrief || null;
  if (!options.silentRefresh && source.dailyBrief) {
    window.__outlookCacheDailyBrief = source.dailyBrief;
    window.__outlookDailyBriefAt = Date.now();
  } else if (!options.silentRefresh) {
    window.__outlookCacheDailyBrief = source.dailyBrief || window.__outlookCacheDailyBrief || null;
  }
  if (source.instruments?.length) {
    window.__outlookWatchSnapshot = snapshotOutlookWatchLevels(source.instruments);
  }
  window.__outlookCacheLiveAt = resolveOutlookDisplayStamp(source);
  window.__outlookCacheUpdatedAt = source.updatedAt;
  window.__outlookLoadError = null;
  window.__outlookEmptyReady = false;
}

function isOutlookPanelPlaceholder(panel) {
  return Boolean(panel && !panel.querySelector('.outlook-panel'));
}

function renderOutlookDetailSlotHint() {
  return '<div class="outlook-detail-panel outlook-detail-panel-hint"><p class="empty-state">点击品种查看 <strong>Cursor 每日分析</strong>（基本面 · 走势 · 仓位建议）；重大机会品种带 ★ 标记并置顶</p></div>';
}

function cacheOutlookPanelSource(source) {
  if (!source?.categories?.length && !source?.instruments?.length) return;
  window.__outlookCacheCategories = source.categories;
  window.__outlookCacheInstruments = enrichOutlookInstrumentsClientSide(source.instruments);
  window.__outlookCacheFactors = source.factors;
  window.__outlookCacheFramework = source.framework;
  window.__outlookCacheStats = source.stats;
  window.__outlookCacheGlobalRisk = source.globalLiquidityRisk || source.globalRisk || null;
  window.__outlookCacheAiMacroBrief = source.aiMacroBrief || window.__outlookCacheAiMacroBrief || null;
}

function renderOutlookLazyShell(source = {}) {
  cacheOutlookPanelSource(source);
  const count = source?.instruments?.length || window.__outlookCacheInstruments?.length || 0;
  const hint = count ? `${count} 品种已缓存 · 打开标签加载详情` : '正在加载大宗走势研判…';
  return `<div class="panel ${activeTab === 'outlook' ? 'active' : ''}" id="panel-outlook" role="tabpanel" data-outlook-lazy="1">
    <div class="empty-state outlook-empty-state"><div class="spinner inline-spinner"></div> ${escapeHtml(hint)}</div>
  </div>`;
}

function renderOutlookPlaceholder(source = {}) {
  const err = source.error || window.__outlookLoadError;
  if (err) {
    return `<div class="panel ${activeTab === 'outlook' ? 'active' : ''}" id="panel-outlook" role="tabpanel">
      <div class="empty-state outlook-empty-state">
        <p>大宗走势研判加载失败：${escapeHtml(localizeUiMessage(err))}</p>
        <button type="button" class="btn-secondary" data-action="retry-outlook">重试</button>
      </div>
    </div>`;
  }
  if (source._placeholder === 'empty' || window.__outlookEmptyReady) {
    return `<div class="panel ${activeTab === 'outlook' ? 'active' : ''}" id="panel-outlook" role="tabpanel">
      <div class="empty-state outlook-empty-state">
        <p>数据积累中，指数/外汇/政策等源就绪后将生成研判。</p>
        <button type="button" class="btn-secondary" data-action="retry-outlook">刷新研判</button>
      </div>
    </div>`;
  }
  return `<div class="panel ${activeTab === 'outlook' ? 'active' : ''}" id="panel-outlook" role="tabpanel">
    <div class="empty-state outlook-empty-state"><div class="spinner inline-spinner"></div> 正在加载大宗走势研判…</div>
  </div>`;
}

function mountOutlookPanel(source) {
  if (source?.stats?.slotCapture) {
    window.__outlookSlotCaptureMeta = source.stats.slotCapture;
  }
  const panel = document.getElementById('panel-outlook');
  if (!panel) return;
  const hasData = Boolean(source?.instruments?.length);

  if (hasData) {
    cacheOutlookSource(source);
    scheduleIdleWork(() => {
      void loadPortfolioHoldingsFromStore().then(() => ensureOutlookDailyBrief(source));
    });
    setTimeout(() => void loadOutlookSlotSnapshotsGlobal(window.__outlookSlotCaptureMeta?.sessionDate), 3500);
    if (outlookPanelNeedsFullMount(panel, source) || !panel.querySelector('.outlook-panel')) {
      replaceSinglePanel('outlook', source);
      setupOutlookPanel();
      const mounted = document.getElementById('panel-outlook');
      if (mounted) {
        remountOutlookInstrumentList(mounted, source.instruments, {
          immediate: true,
          skipSkeleton: Boolean(source.fromCache || getOutlookCachedSource()?.instruments?.length),
        });
      }
      applyOutlookSectorFilter(mounted, outlookSectorFilter);
      paintOutlookHeadlinesAndDashboard(mounted);
    } else if (isActivePanel('outlook')) {
      refreshOutlookPanelSectionsDebounced(panel, source);
      applyOutlookSectorFilter(panel, outlookSectorFilter);
      ensureOutlookHeadlinesAndDashboard(panel);
    }
    return;
  }

  if (!isActivePanel('outlook')) return;
  replaceSinglePanel('outlook', source || { _placeholder: 'empty' });
  setupOutlookPanel();
}

async function refreshOutlookLive(options = {}) {
  if (!window.fancheng?.fetchOutlookLive) {
    window.__outlookEmptyReady = true;
    if (isActivePanel('outlook') && !getOutlookCachedSource()?.instruments?.length) {
      mountOutlookPanel({ _placeholder: 'empty' });
    }
    return;
  }
  const cachedBefore = getOutlookCachedSource();
  const panel = document.getElementById('panel-outlook');
  if (options.force && panel && isActivePanel('outlook')) {
    panel.classList.add('outlook-refreshing');
    const stampEl = panel.querySelector('.outlook-toolbar-stamp');
    if (stampEl) stampEl.textContent = '研判更新中…';
  }
  try {
    const outlook = await window.fancheng.fetchOutlookLive(options);
    if (outlook?.error && !(outlook?.instruments?.length || outlook?.categories?.length)) {
      window.__outlookLoadError = outlook.error;
      if (cachedBefore?.instruments?.length || cachedBefore?.categories?.length) {
        if (isActivePanel('outlook')) mountOutlookPanel(cachedBefore);
        return;
      }
      if (isActivePanel('outlook')) mountOutlookPanel(outlook);
      return;
    }
    if (outlook?.instruments?.length || outlook?.categories?.length) {
      applyOutlookLiveData(outlook);
      return;
    }
    if (cachedBefore?.instruments?.length || cachedBefore?.categories?.length) {
      if (isActivePanel('outlook')) mountOutlookPanel(cachedBefore);
      return;
    }
    window.__outlookEmptyReady = true;
    if (isActivePanel('outlook')) mountOutlookPanel({ _placeholder: 'empty', ...outlook });
  } catch (err) {
    window.__outlookLoadError = localizeUiMessage(err.message || '研判刷新失败');
    if (cachedBefore?.instruments?.length || cachedBefore?.categories?.length) {
      if (isActivePanel('outlook')) mountOutlookPanel(cachedBefore);
      return;
    }
    if (isActivePanel('outlook')) mountOutlookPanel({ error: window.__outlookLoadError });
  } finally {
    panel?.classList.remove('outlook-refreshing');
  }
}

async function loadOutlookDiskCacheFirst() {
  if (getOutlookCachedSource()?.instruments?.length) return getOutlookCachedSource();
  if (!window.fancheng?.fetchOutlookLive) return null;
  try {
    const outlook = await window.fancheng.fetchOutlookLive({ force: false });
    if (outlook?.instruments?.length || outlook?.categories?.length) {
      cacheOutlookSource(outlook);
      return getOutlookCachedSource();
    }
  } catch {
    // ignore
  }
  return null;
}

async function activateOutlookTab() {
  let panelEarly = document.getElementById('panel-outlook');
  const memCached = getOutlookCachedSource();
  if (memCached?.instruments?.length && panelEarly && !panelEarly.querySelector('.outlook-panel')) {
    mountOutlookPanel({ ...memCached, fromCache: true });
    panelEarly = document.getElementById('panel-outlook');
  }
  if (panelEarly && isOutlookPanelPlaceholder(panelEarly)) {
    void loadOutlookHeadlines({ skipScan: true, enrichCursor: true, fast: true }).then(() => {
      paintOutlookHeadlinesAndDashboard(panelEarly);
    });
  }
  if (panelEarly?.dataset.outlookLazy === '1') {
    const cachedLazy = getOutlookCachedSource();
    if (cachedLazy?.instruments?.length || cachedLazy?.categories?.length) {
      mountOutlookPanel({ ...cachedLazy, fromCache: true });
      panelEarly = document.getElementById('panel-outlook');
    }
  }
  if (window.fancheng?.bootstrapOutlookDaily) {
    void window.fancheng.bootstrapOutlookDaily();
  }
  scheduleIdleWork(() => {
    setTimeout(() => {
      void loadOutlookBacktestSummaryCache().then((summary) => {
        if (!summary || !window.__outlookCacheInstruments?.length) return;
        window.__outlookCacheInstruments = mergeBacktestIntoOutlookInstruments(
          window.__outlookCacheInstruments,
          summary
        );
        const panel = document.getElementById('panel-outlook');
        if (panel && isActivePanel('outlook')) {
          const hitEl = panel.querySelector('.outlook-hit-rate');
          if (hitEl && window.__outlookCacheStats) {
            replaceOutlookHitRateBadges(panel, window.__outlookCacheStats);
          }
        }
      });
    }, 2500);
    setTimeout(() => {
      void loadOutlookLongrunSummaryCache().then((lr) => {
        if (lr?.instruments?.length && window.__outlookCacheInstruments?.length) {
          window.__outlookCacheInstruments = mergeLongrunIntoOutlookInstruments(
            window.__outlookCacheInstruments,
            lr
          );
        }
        if (lr && window.__outlookCacheStats) {
          window.__outlookCacheStats.longRunHitRate = lr.overallHitRate;
          window.__outlookCacheStats.longRunByEra = lr.byEra;
        }
      });
    }, 4000);
  });
  if (panelEarly) setupOutlookBacktestListeners(panelEarly);

  let cached = await loadOutlookDiskCacheFirst();
  const startupCommodities = window.__startupSources?.commodities || window.__preloadedCommoditiesLive;
  const hasCommodityQuotes = startupCommodities?.exchanges?.some((ex) =>
    (ex.items || []).some((item) => item.price != null)
  );

  if (cached?.instruments?.length || cached?.categories?.length) {
    const outlookPanel = document.getElementById('panel-outlook');
    if (!outlookPanel?.querySelector('.outlook-panel')) {
      mountOutlookPanel({ ...cached, fromCache: true });
    } else {
      ensureOutlookHeadlinesAndDashboard(outlookPanel);
    }
    if (startupCommodities) applyCommoditiesLiveToOutlook(startupCommodities);
    void refreshOutlookLive({ force: false });
    startOutlookLiveTimer({ deferFirstRefresh: true });
    return;
  }

  const panel = document.getElementById('panel-outlook');
  if (panel && isOutlookPanelPlaceholder(panel)) {
    replaceSinglePanel('outlook', {});
  }
  const slowTimer = setTimeout(() => {
    if (!isActivePanel('outlook')) return;
    const p = document.getElementById('panel-outlook');
    if (p && isOutlookPanelPlaceholder(p) && !getOutlookCachedSource()?.instruments?.length) {
      window.__outlookEmptyReady = true;
      mountOutlookPanel({ _placeholder: 'empty' });
    }
  }, 2000);
  void refreshOutlookLive({ force: Boolean(hasCommodityQuotes) }).finally(() => {
    clearTimeout(slowTimer);
    startOutlookLiveTimer();
  });
}

function filterUserFocusInstruments(instruments = []) {
  return instruments.filter((i) => USER_FOCUS_SET.has(String(i?.id || '').toLowerCase()));
}

function countFocusAnalysisProgress() {
  const instruments = filterUserFocusInstruments(window.__outlookCacheInstruments || []);
  const total = instruments.length || focusDashboardCache?.focusCount || USER_FOCUS_SYMBOL_IDS.length;
  let ready = 0;
  let pending = 0;
  for (const inst of instruments) {
    const cached = getFocusAnalysisForInstrument(inst);
    if (cached?.analysis?.text) {
      ready += 1;
      continue;
    }
    if (inst.__focusAnalysisPending || inst.__focusAnalysisLoading) pending += 1;
  }
  const state = focusAnalysisLiveState;
  if (state && !state.cancelled) {
    pending = Math.max(pending, state.active + state.queue.length);
  }
  return { total, ready, pending, remaining: Math.max(0, total - ready) };
}

function renderFocusAnalysisProgressHtml() {
  const { total, ready, pending } = countFocusAnalysisProgress();
  if (!total) return '';
  const pct = Math.min(100, Math.round((ready / total) * 100));
  const pendingTag = pending
    ? `<span class="outlook-focus-progress-pending">生成中 ${pending}</span>`
    : ready >= total
      ? `<span class="outlook-focus-progress-pending" style="animation:none;color:#68d391">已全部完成</span>`
      : '';
  return `<div class="outlook-focus-analysis-progress" role="status" aria-live="polite">
    <span class="outlook-focus-progress-label">Cursor 分析 ${ready}/${total}</span>
    <div class="outlook-focus-progress-track" aria-hidden="true"><div class="outlook-focus-progress-fill" style="width:${pct}%"></div></div>
    ${pendingTag}
  </div>`;
}

function refreshFocusAnalysisProgressUI(panel) {
  const root = panel || document.getElementById('panel-outlook');
  const slot = root?.querySelector('.outlook-focus-analysis-progress');
  if (!slot) return;
  slot.outerHTML = renderFocusAnalysisProgressHtml();
}

function renderFocusIntelDimension(dimKey, dim, symbol) {
  if (!dim?.items?.length) return '';
  const labelMap = {
    intelligence: '主矛盾·反对',
    policySupply: '政策产能',
    technical: '技术面',
    capital: '资金',
    inventorySpot: '库存现货',
  };
  const policyNewsRows = dimKey === 'policySupply' ? dim.items.filter((i) => i.clickable && i.newsId) : dim.items;
  const displayItems = dimKey === 'policySupply' ? dim.items : dim.items;

  const rows = displayItems
    .slice(0, 6)
    .map((item) => {
      if (item.clickable && item.newsId && dimKey === 'policySupply') {
        const tier = item.tier ? `<span class="outlook-intel-news-tier outlook-intel-news-tier-${escapeAttr(item.tier)}">${escapeHtml(item.tier)}</span>` : '';
        const hit = item.impactTag === '直命中' ? `<span class="outlook-focus-news-hit">直命中</span>` : '';
        const timeHint = item.at ? `<span class="outlook-intel-news-time">${escapeHtml(formatDate(item.at))}</span>` : '';
        return `<li class="outlook-intel-news-row">
          <button type="button" class="outlook-intel-news-link" data-action="open-focus-news" data-news-id="${escapeAttr(item.newsId)}" data-focus-symbol="${escapeAttr(symbol)}" title="应用内阅读全文 · ${escapeAttr(item.source || '')}">
            ${tier}${hit}${timeHint}<span class="outlook-intel-dim-k">${escapeHtml(item.label)}</span>
            <span class="outlook-intel-news-title">${escapeHtml(String(item.value).slice(0, 100))}${String(item.value).length > 100 ? '…' : ''}</span>
            <span class="outlook-intel-news-open" aria-hidden="true">阅读 ›</span>
          </button>
        </li>`;
      }
      return `<li class="${item.tone === 'dissent' ? 'outlook-intel-dissent' : ''}"><span class="outlook-intel-dim-k">${escapeHtml(item.label)}</span> ${escapeHtml(String(item.value).slice(0, 120))}${String(item.value).length > 120 ? '…' : ''}</li>`;
    })
    .join('');
  const articleCount = dim.articles?.length;
  const countHint = dimKey === 'policySupply' && articleCount ? ` · ${articleCount}条可阅` : '';
  const newsNote = dimKey === 'policySupply' && dim.hasNews === false ? ' · 待资讯' : '';
  return `<div class="outlook-intel-dim outlook-intel-dim-${escapeAttr(dimKey)}">
    <h5 class="outlook-intel-dim-title">${escapeHtml(labelMap[dimKey] || dimKey)} <em class="outlook-intel-dim-status">${escapeHtml(dim.status || '')}${escapeHtml(countHint)}${escapeHtml(newsNote)}</em></h5>
    <ul class="outlook-intel-dim-list">${rows}</ul>
  </div>`;
}

function setupFocusNewsReaderDelegation() {
  if (window.__focusNewsReaderBound) return;
  window.__focusNewsReaderBound = true;
  document.addEventListener(
    'click',
    (e) => {
      const openBtn = e.target.closest('[data-action="open-focus-news"]');
      if (openBtn) {
        e.preventDefault();
        e.stopPropagation();
        const sym = openBtn.dataset.focusSymbol;
        const newsId = openBtn.dataset.newsId;
        if (sym && newsId) void openFocusNewsModal(sym, newsId);
        else console.warn('[focus-news] missing symbol/newsId', sym, newsId);
        return;
      }
      const closeBtn = e.target.closest('[data-action="close-focus-news"]');
      if (closeBtn) {
        e.preventDefault();
        closeFocusNewsModal();
      }
    },
    true
  );
}

function ensureFocusNewsModal() {
  let modal = document.getElementById('outlook-focus-news-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'outlook-focus-news-modal';
  modal.className = 'outlook-focus-news-modal outlook-history-modal hidden';
  modal.hidden = true;
  modal.innerHTML = `<div class="outlook-focus-news-dialog outlook-history-dialog" role="dialog" aria-labelledby="focus-news-title">
    <header class="outlook-focus-news-head">
      <h4 id="focus-news-title" class="outlook-focus-news-title">新闻全文</h4>
      <button type="button" class="outlook-history-close" data-action="close-focus-news" aria-label="关闭">×</button>
    </header>
    <div class="outlook-focus-news-meta" data-focus-news-meta></div>
    <div class="outlook-focus-news-body" data-focus-news-body><p class="empty-state">加载中…</p></div>
    <footer class="outlook-focus-news-foot">
      <span data-focus-news-source></span>
      <button type="button" class="outlook-btn outlook-btn-sm" data-action="close-focus-news">关闭</button>
    </footer>
  </div>`;
  document.body.appendChild(modal);
  return modal;
}

async function openFocusNewsModal(symbol, newsId) {
  const modal = ensureFocusNewsModal();
  if (!modal) return;
  if (!window.fancheng?.getFocusNewsArticle) {
    const bodyEl = modal.querySelector('[data-focus-news-body]');
    if (bodyEl) bodyEl.innerHTML = '<p class="outlook-focus-news-error">阅读功能未就绪，请完全退出并重启梵澄金融（v1.50.2+）</p>';
    modal.classList.remove('hidden');
    modal.hidden = false;
    return;
  }
  const titleEl = modal.querySelector('.outlook-focus-news-title');
  const metaEl = modal.querySelector('[data-focus-news-meta]');
  const bodyEl = modal.querySelector('[data-focus-news-body]');
  const sourceEl = modal.querySelector('[data-focus-news-source]');
  if (titleEl) titleEl.textContent = '新闻加载中…';
  if (metaEl) metaEl.innerHTML = '';
  if (bodyEl) bodyEl.innerHTML = '<div class="spinner inline-spinner"></div> 正在获取并翻译正文…';
  if (sourceEl) sourceEl.textContent = '';
  modal.classList.remove('hidden');
  modal.hidden = false;

  const data = await window.fancheng.getFocusNewsArticle(symbol, newsId, { previewOnly: false, force: false });
  if (data?.error) {
    if (titleEl) titleEl.textContent = '新闻加载失败';
    if (bodyEl) bodyEl.innerHTML = `<p class="outlook-focus-news-error">${escapeHtml(localizeUiMessage(data.error))}</p>`;
    return;
  }
  const a = data.article || {};
  if (titleEl) titleEl.textContent = a.title || '新闻';
  if (metaEl) {
    const bits = [
      a.tier ? `<span class="outlook-intel-news-tier outlook-intel-news-tier-${escapeAttr(a.tier)}">${escapeHtml(a.tier)}</span>` : '',
      a.directMention ? '<span class="outlook-focus-news-hit">品种直命中</span>' : '',
      a.source ? `<span>来源 ${escapeHtml(a.source)}</span>` : '',
      a.publishedAt ? `<span>${escapeHtml(formatDate(a.publishedAt))}</span>` : '',
      a.relevance != null ? `<span>相关度 ${escapeHtml(String(a.relevance))}</span>` : '',
      a.bodySourceLabel || a.bodySource ? `<span>正文来源 ${escapeHtml(a.bodySourceLabel || a.bodySource)}</span>` : '',
    ].filter(Boolean);
    metaEl.innerHTML = bits.join(' · ');
  }
  const impactBlock = a.impactNote
    ? `<section class="outlook-focus-news-section outlook-focus-news-impact"><h5>品种影响审视</h5><p>${escapeHtml(a.impactNote)}</p></section>`
    : '';
  const summaryText = a.summary && !/（关联[^）]+）\s*$/.test(a.summary) ? a.summary : '';
  const summaryBlock = summaryText
    ? `<section class="outlook-focus-news-section"><h5>摘要</h5><p>${escapeHtml(summaryText).replace(/\n/g, '<br>')}</p></section>`
    : '';
  const bodyText = a.body || (a.extractError ? `正文拉取失败：${a.extractError}` : '暂无正文');
  const incompleteWarn = a.bodyIncomplete
    ? `<p class="outlook-focus-news-incomplete">⚠ 正文不完整或原文站点限制抓取；已展示中文摘要与影响审视，请结合来源交叉验证，勿单凭标题交易。</p>`
    : '';
  const bodyBlock = `<section class="outlook-focus-news-section outlook-focus-news-full"><h5>全文</h5>${incompleteWarn}<div class="outlook-focus-news-content">${escapeHtml(bodyText).replace(/\n/g, '<br>')}</div></section>`;
  if (bodyEl) bodyEl.innerHTML = `${impactBlock}${summaryBlock}${bodyBlock}`;
  if (sourceEl) {
    const urlNote = a.url ? `原文链接（未外跳）：${a.url}` : '无 URL · 来自情报池摘要';
    sourceEl.textContent = `${urlNote} · 数据可追溯，禁止编造`;
  }
}

function closeFocusNewsModal() {
  const modal = document.getElementById('outlook-focus-news-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.hidden = true;
}

function renderFocusTop5CursorDeepBlock(t) {
  const d = t.deepBrief;
  if (t.deepBriefPending) {
    return `<div class="outlook-top5-cursor outlook-top5-cursor-pending">Cursor 深度解读生成中…</div>`;
  }
  if (!d?.text && !d?.policySupply && !d?.battleAdvice) {
    const err = d?.error;
    const hint = err || (focusDashboardCache?.cursorConfigured ? '深度解读排队中…' : '待配置 CURSOR_API_KEY');
    return `<div class="outlook-top5-cursor outlook-top5-cursor-pending">${escapeHtml(hint)}</div>`;
  }
  if (d.error && !d.text && !d.battleAdvice) {
    return `<div class="outlook-top5-cursor outlook-top5-cursor-error">${escapeHtml(d.error)}</div>`;
  }
  const sections = [
    ['政策产能', d.policySupply],
    ['技术面', d.technical],
    ['资金持仓', d.capital],
    ['库存现货', d.inventorySpot],
    ['矛盾风险', d.riskConflict],
    ['作战建议', d.battleAdvice],
  ];
  const body = sections
    .filter(([, text]) => text?.trim())
    .map(
      ([title, text]) =>
        `<div class="outlook-top5-cursor-sec"><h6 class="outlook-top5-cursor-sec-title">${escapeHtml(title)}</h6><div class="outlook-top5-cursor-sec-body">${escapeHtml(text).replace(/\n/g, '<br>')}</div></div>`
    )
    .join('');
  const meta = d.model
    ? `Cursor · ${escapeHtml(d.model)} · ${escapeHtml(d.method || '')}`
    : t.deepBriefGeneratedAt
      ? `缓存 · ${formatDate(t.deepBriefGeneratedAt)}`
      : '';
  return `<details class="outlook-top5-cursor" open>
    <summary class="outlook-top5-cursor-summary">Cursor 深度解读 <span class="outlook-top5-cursor-meta">${meta}</span></summary>
    <div class="outlook-top5-cursor-body">${body || `<p>${escapeHtml(d.text || '暂无')}</p>`}</div>
    <p class="outlook-top5-cursor-foot">基于 battleIntel + 全链路研判数据 · 禁止编造</p>
  </details>`;
}

function renderFocusTop5Card(t) {
  const intel = t.intel;
  const pinBanner = t.longTermPin?.pinned
    ? `<div class="outlook-top5-pin-banner outlook-top5-pin-${escapeAttr(t.longTermPin.side)}">${escapeHtml(t.longTermPin.label)} · ${escapeHtml(t.longTermPin.reason || '')}</div>`
    : '';
  const reasons = (t.rankReasons || [])
    .slice(0, 4)
    .map((r) => `<span class="outlook-top5-reason-chip">${escapeHtml(r)}</span>`)
    .join('');
  const dims = intel?.dimensions
    ? ['intelligence', 'policySupply', 'technical', 'capital', 'inventorySpot']
        .map((k) => renderFocusIntelDimension(k, intel.dimensions[k], t.symbol))
        .join('')
    : '';
  const newsAt = intel?.newsFetchedAt ? `新闻 ${formatDate(intel.newsFetchedAt)}` : '新闻待拉取';
  return `<li class="outlook-top5-item${t.isMajorOpportunity ? ' major' : ''}${t.longTermPin?.pinned ? ' longterm-pin' : ''}" data-focus-symbol="${escapeAttr(t.symbol)}">
    <div class="outlook-top5-head">
      <strong class="outlook-top5-rank">${t.rank}. ${escapeHtml(t.name)}</strong>
      <span class="outlook-top5-dir ${outlookDirectionClass(t.bias)}">${escapeHtml(t.bias || t.directionLabel || '震荡')}</span>
      <span class="outlook-top5-score" title="多维机会评分">机会 ${t.priorityScore != null ? escapeHtml(String(t.priorityScore)) : '—'}</span>
    </div>
    ${pinBanner}
    <p class="outlook-top5-thesis">${escapeHtml(t.watchThesis || '待校验')}</p>
    ${t.inferenceNote ? `<p class="outlook-top5-inference">${escapeHtml(t.inferenceNote)}</p>` : ''}
    <div class="outlook-top5-reasons">${reasons}</div>
    <p class="outlook-top5-execution">${escapeHtml(t.executionNote || '')}</p>
    <div class="outlook-top5-intel-grid">${dims}</div>
    ${t.intel?.contradictionMatrix ? renderContradictionMatrixBlock(t.intel.contradictionMatrix, { compact: true }) : ''}
    ${renderFocusTop5CursorDeepBlock(t)}
    <p class="outlook-top5-intel-meta">${escapeHtml(newsAt)} · ${escapeHtml(intel?.dataSource || 'focus-intelligence-brief')}</p>
  </li>`;
}

function buildLocalIntelDim(label, value, extraItems = []) {
  const items = [];
  if (value && value !== '暂无' && value !== '—') {
    items.push({ label, value: String(value).slice(0, 140) });
  }
  for (const item of extraItems) {
    if (item?.value) items.push(item);
  }
  if (!items.length) items.push({ label, value: '待校验' });
  return { status: items.length > 1 ? '' : '待校验', items: items.slice(0, 6) };
}

function buildLocalBattleIntel(inst) {
  const phil = inst.philosophy;
  const spec = inst.integratedSpec || {};
  const policyRow = phil?.ranked?.primary?.find((p) => p?.id === 'policy') || phil?.ranked?.primary?.[0];
  const tech = inst.technical || spec.technical;
  const cap = inst.capitalAttention;
  const basis = inst.basis || inst.warehouse;
  return {
    dimensions: {
      policySupply: buildLocalIntelDim(
        '政策',
        policyRow?.summary || policyRow?.label || phil?.policy?.headline,
        phil?.policy?.items?.slice(0, 2).map((i) => ({ label: i.label || '政策', value: i.value || i.text })) || []
      ),
      technical: buildLocalIntelDim('技术', tech?.summary || tech?.label || spec.regime?.label),
      capital: buildLocalIntelDim(
        '资金',
        cap?.attitudeLabel
          ? `${cap.attitudeLabel}${cap.score != null ? ` · ${cap.score}/100` : ''}${
              cap.horizons?.oi1mPct != null
                ? ` · 1月持仓${cap.horizons.oi1mPct > 0 ? '+' : ''}${Number(cap.horizons.oi1mPct).toFixed(1)}%`
                : ''
            }`
          : cap?.summary || (cap?.score != null ? `关注度 ${cap.score}` : null),
        [
          cap?.attitudeNote ? { label: '态度', value: cap.attitudeNote } : null,
          cap?.jointWithInventory ? { label: '合证', value: cap.jointWithInventory } : null,
          cap?.rank != null ? { label: '排名', value: `第${cap.rank}/${cap.rankOf}` } : null,
        ].filter(Boolean)
      ),
      inventorySpot: buildLocalIntelDim('库存', basis?.summary || basis?.label),
    },
    dataSource: 'client-preview',
    newsFetchedAt: null,
  };
}

function buildLocalFocusDashboardFromOutlook(instruments = []) {
  const focus = filterUserFocusInstruments(instruments);
  if (!focus.length) return null;
  const ranked = focus
    .map((inst) => {
      const spec = inst.integratedSpec || {};
      const score = spec.priorityScore ?? inst.priorityScore ?? null;
      const intel = buildLocalBattleIntel(inst);
      const regime = spec.regime?.regime || '';
      const watch = spec.watchLevel || '';
      const pb = spec.playbook?.id || '';
      const isMajor = score != null && score >= 0.68;
      return {
        symbol: String(inst.id).toLowerCase(),
        name: inst.name || String(inst.id).toUpperCase(),
        exchange: inst.exchange,
        priorityScore: score,
        bias: inst.directionLabel || '震荡',
        directionLabel: inst.directionLabel || '震荡',
        watchThesis:
          intel.watchThesis ||
          spec.playbook?.narrativeZh?.slice(0, 140) ||
          inst.tradingGuidance?.bias ||
          '待校验',
        rankReasons: [regime ? `R${regime}` : null, watch ? `${watch}` : null, pb || null]
          .filter(Boolean)
          .slice(0, 4),
        executionNote: inst.tradingGuidance?.posture
          ? `执行建议：${inst.tradingGuidance.posture}`
          : '执行建议：待校验',
        isMajorOpportunity: isMajor,
        longTermPin: spec.longTermPin || null,
        intel,
        deepBriefPending: true,
      };
    })
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const top5 = ranked.slice(0, 5).map((row, idx) => ({ ...row, rank: idx + 1 }));
  const majorOpportunities = ranked.filter((r) => r.isMajorOpportunity || r.longTermPin?.pinned);
  const rows = focus.map((inst) => {
    const sym = String(inst.id).toLowerCase();
    const rank = top5.find((t) => t.symbol === sym);
    const major = majorOpportunities.find((m) => m.symbol === sym);
    return {
      symbol: sym,
      name: inst.name,
      exchange: inst.exchange,
      price: inst.price ?? null,
      directionLabel: inst.directionLabel,
      posture: inst.tradingGuidance?.posture || '暂无',
      position: inst.tradingGuidance?.position || null,
      priorityScore: inst.integratedSpec?.priorityScore ?? rank?.priorityScore ?? null,
      top5Rank: rank?.rank ?? null,
      isTop5: Boolean(rank),
      isMajorOpportunity: Boolean(major),
      opportunityTier: major ? 'major' : rank ? 'elevated' : 'normal',
      pinned: Boolean(major?.longTermPin?.pinned),
      read: false,
      analysis: inst.__focusAnalysis?.analysis || {
        text: null,
        error: window.__cursorStatus?.configured ? '分析同步中…' : '待配置 CURSOR_API_KEY',
      },
      generatedAt: inst.__focusAnalysis?.generatedAt || null,
    };
  });
  return {
    version: OUTLOOK_UI_VERSION,
    sessionDate: new Date().toISOString().slice(0, 10),
    cursorConfigured: Boolean(window.__cursorStatus?.configured),
    focusCount: focus.length,
    top5,
    majorOpportunities,
    pinned: majorOpportunities.map((m) => m.symbol),
    instruments: rows,
    localPreview: true,
    dataSource: 'client-outlook-preview',
    generatedAt: new Date().toISOString(),
  };
}

function seedFocusDashboardFromOutlook(instruments = []) {
  const local = buildLocalFocusDashboardFromOutlook(instruments);
  if (!local) return null;
  if (!focusDashboardCache?.instruments?.length || focusDashboardCache.localPreview) {
    focusDashboardCache = local;
  }
  return focusDashboardCache;
}

async function loadFocusReleaseCalendar(options = {}) {
  if (!window.fancheng?.getCommodityReleaseCalendar) return null;
  try {
    const cal = await window.fancheng.getCommodityReleaseCalendar({
      force: options.force === true,
      daysAhead: 14,
    });
    if (cal?.error) {
      console.warn('[release-calendar]', cal.error);
      return focusReleaseCalCache;
    }
    focusReleaseCalCache = cal;
    return cal;
  } catch (err) {
    console.warn('[release-calendar]', err);
    return focusReleaseCalCache;
  }
}

function renderFocusReleaseCalendarSection(cal) {
  if (!cal?.summary) {
    return `<section class="outlook-section outlook-focus-release outlook-focus-release-empty">
      <h3 class="outlook-section-title">数据发布日历</h3>
      <p class="empty-state">发布日历加载中…</p>
    </section>`;
  }
  const s = cal.summary;
  const imminent = cal.imminent || [];
  const imminentHtml = imminent.length
    ? `<div class="outlook-release-alert" role="status">⚡ 24h 内发布窗口：${imminent.map((r) => escapeHtml(r.name)).join(' · ')}</div>`
    : '';
  const rows = (cal.releases || []).slice(0, 10);
  const listHtml = rows
    .map((r) => {
      const est = r.estimated ? '<span class="outlook-release-est">窗口/规则</span>' : '';
      const imm = r.imminent ? '<span class="outlook-release-imminent">临近</span>' : '';
      const sym = (r.symbols || []).slice(0, 4).map((x) => x.toUpperCase()).join('/') || '—';
      return `<li class="outlook-release-item${r.imminent ? ' is-imminent' : ''}">
        <span class="outlook-release-date">${escapeHtml(r.releaseDate)}</span>
        <span class="outlook-release-name">${escapeHtml(r.name)}</span>
        ${imm}${est}
        <span class="outlook-release-time" title="${escapeAttr(r.method || '')}">${escapeHtml(r.releaseAtLocal || '待公布')}</span>
        <span class="outlook-release-syms">${escapeHtml(sym)}</span>
      </li>`;
    })
    .join('');
  const next = s.nextRelease;
  const nextLine = next
    ? `下一项 <strong>${escapeHtml(next.name)}</strong> · ${escapeHtml(next.releaseDate)} · ${escapeHtml(next.releaseAtLocal || '—')}`
    : '暂无即将发布项';
  const surprises = cal.releaseSurprises || [];
  const surpriseHtml = surprises.length
    ? `<div class="outlook-release-surprise-block" role="status">
      <h4 class="outlook-release-surprise-head">发布日 surprise 雷达</h4>
      <ul class="outlook-release-surprise-list">${surprises
        .map((s) => {
          const lvl =
            s.level === 'surprise_high'
              ? 'high'
              : s.level === 'priced_in'
                ? 'priced'
                : s.level === 'divergent'
                  ? 'div'
                  : 'mod';
          return `<li class="outlook-release-surprise-item level-${lvl}">
            <span class="outlook-release-surprise-name">${escapeHtml(s.releaseName || s.releaseId || '—')}</span>
            <span class="outlook-release-surprise-label">${escapeHtml(s.label || '待校验')}</span>
            <span class="outlook-release-surprise-ev">${escapeHtml((s.evidence || [])[0] || '—')}</span>
          </li>`;
        })
        .join('')}</ul>
    </div>`
    : '';
  return `<section class="outlook-section outlook-focus-release" role="region" aria-label="数据发布日历">
    <div class="outlook-section-head">
      <h3 class="outlook-section-title">数据发布日历</h3>
      <button type="button" class="outlook-btn outlook-btn-sm" data-action="refresh-release-calendar" title="刷新 EIA/WASDE/国统局窗口">刷新</button>
    </div>
    ${imminentHtml}
    ${surpriseHtml}
    <p class="outlook-release-next">${nextLine}</p>
    <ol class="outlook-release-list">${listHtml || '<li class="empty-state">暂无</li>'}</ol>
    <p class="outlook-focus-note">EIA 周三 10:30 ET · WASDE 来自 USDA 2026 日历 · 国统局为 9–15 日窗口（确切日期待官网）· ${escapeHtml(s.version || '')}</p>
  </section>`;
}

function renderFocusCoverageLayerDots(layers) {
  const order = ['flash', 'policy', 'opinion', 'intl', 'exchange', 'close'];
  return order
    .map((key) => {
      const layer = layers?.[key];
      if (!layer?.required) return '';
      const cls = layer.ok ? 'ok' : layer.scope === 'sector' ? 'sector' : 'miss';
      const title = `${layer.label || key} · ${layer.note || '—'}`;
      return `<span class="outlook-cov-dot ${cls}" title="${escapeAttr(title)}"></span>`;
    })
    .join('');
}

function renderFocusCoverageSection(audit) {
  if (!audit?.summary) {
    return `<section class="outlook-section outlook-focus-coverage outlook-focus-coverage-empty">
      <h3 class="outlook-section-title">${USER_FOCUS_SYMBOL_IDS.length} 品种 · 资讯覆盖度</h3>
      <p class="empty-state">覆盖审计加载中或暂无缓存…</p>
    </section>`;
  }
  const s = audit.summary;
  const pool = s.poolSizes || {};
  const ex = s.exchangeNotice;
  const exLine = ex
    ? `<span class="outlook-cov-exchange-stats" title="交易所公告聚合 · ${escapeAttr(ex.fetchedAt || '待抓取')}">
        交易所公告 <strong>${ex.total ?? '—'}</strong>
        <span class="outlook-cov-ex-direct">直连 ${ex.direct ?? '—'}</span>
        <span class="outlook-cov-ex-mirror">镜像 ${ex.mirror ?? '—'}</span>
        ${ex.symbolHitPct != null ? `<span class="outlook-cov-ex-symhit">品种命中 ${ex.symbolHits}/${ex.symbolTotal} (${ex.symbolHitPct}%)</span>` : ''}
        ${ex.dcePortal?.awaitingRegistration ? '<span class="outlook-cov-ex-dce-pending">大商所API待注册</span>' : ''}
        ${ex.byExchange?.广期所 != null ? `<span class="outlook-cov-ex-gfex">广期所 ${ex.byExchange.广期所}</span>` : ''}
        ${ex.byExchange?.郑商所 != null ? `<span class="outlook-cov-ex-czce">郑商所 ${ex.byExchange.郑商所}</span>` : ''}
        ${ex.byExchange?.大商所 != null ? `<span class="outlook-cov-ex-dce">大商所 ${ex.byExchange.大商所}</span>` : ''}
        ${ex.byExchange?.上期所 != null ? `<span class="outlook-cov-ex-shfe">上期所 ${ex.byExchange.上期所}</span>` : ''}
        ${ex.byExchange?.中金所 != null ? `<span class="outlook-cov-ex-cffex">中金所 ${ex.byExchange.中金所}</span>` : ''}
      </span>`
    : '<span class="outlook-cov-exchange-stats muted">交易所公告 待抓取</span>';
  const fillPct = Math.max(0, Math.min(100, s.avgCoveragePct || 0));
  const fullN = s.fullCoverage != null ? s.fullCoverage : '—';
  const symN = s.symbolCount != null ? s.symbolCount : '—';
  const auditedAt = s.auditedAt ? new Date(s.auditedAt).toLocaleString('zh-CN', { hour12: false }) : '—';
  const cacheTag = audit.cached ? '<span class="outlook-focus-sync-tag">缓存</span>' : '';
  const rows = [...(audit.rows || [])].sort((a, b) => (a.coveragePct || 0) - (b.coveragePct || 0));
  const rowHtml = rows
    .map((r) => {
      const gaps = r.gaps?.length ? escapeHtml(r.gaps.join('、')) : '—';
      return `<tr class="outlook-cov-row" data-focus-symbol="${escapeAttr(r.id)}">
        <td class="outlook-cov-sym"><code>${escapeHtml(r.id)}</code> ${escapeHtml(r.name || '')}</td>
        <td class="outlook-cov-pct">${r.coveragePct != null ? `${r.coveragePct}%` : '—'}</td>
        <td class="outlook-cov-dots">${renderFocusCoverageLayerDots(r.layers)}</td>
        <td class="outlook-cov-gaps">${gaps}</td>
      </tr>`;
    })
    .join('');
  return `<section class="outlook-section outlook-focus-coverage" role="region" aria-label="${USER_FOCUS_SYMBOL_IDS.length}品种资讯覆盖度">
    <div class="outlook-section-head">
      <h3 class="outlook-section-title">${USER_FOCUS_SYMBOL_IDS.length} 品种 · 资讯覆盖度</h3>
      ${cacheTag}
      <button type="button" class="outlook-btn outlook-btn-sm" data-action="refresh-coverage-audit" title="重新审计真实资讯池">刷新审计</button>
    </div>
    <div class="outlook-cov-summary" role="status">
      <div class="outlook-focus-progress-track outlook-cov-progress"><div class="outlook-focus-progress-fill" style="width:${fillPct}%"></div></div>
      <span class="outlook-cov-summary-text">均覆盖 <strong>${s.avgCoveragePct != null ? `${s.avgCoveragePct}%` : '—'}</strong> · 满分 <strong>${fullN}/${symN}</strong></span>
      <span class="outlook-cov-pools">快讯 ${pool.flash ?? '—'} · 政策 ${pool.policy ?? '—'} · 观点 ${pool.opinion ?? '—'} · 国际 ${pool.intl ?? '—'}</span>
      ${exLine}
    </div>
    <p class="outlook-cov-legend"><span class="outlook-cov-dot ok"></span>命中 <span class="outlook-cov-dot sector"></span>板块级 <span class="outlook-cov-dot miss"></span>缺口 · 快讯/政策/观点/国际/交易所/收盘</p>
    <div class="outlook-cov-table-wrap">
      <table class="outlook-cov-table">
        <thead><tr><th>品种</th><th>覆盖</th><th>六层</th><th>缺口</th></tr></thead>
        <tbody>${rowHtml || '<tr><td colspan="4">暂无</td></tr>'}</tbody>
      </table>
    </div>
    <p class="outlook-focus-note">只读真实池 · 板块级政策/观点已标注 · 审计 ${escapeHtml(auditedAt)} · ${escapeHtml(s.version || '')}</p>
  </section>`;
}

async function loadFocusCoverageAudit(options = {}) {
  if (!window.fancheng?.getNewsCoverageAudit) return null;
  try {
    const audit = await window.fancheng.getNewsCoverageAudit({
      force: options.force === true,
    });
    if (audit?.error) {
      console.warn('[coverage-audit]', audit.error);
      return focusCoverageCache;
    }
    focusCoverageCache = audit;
    return audit;
  } catch (err) {
    console.warn('[coverage-audit]', err);
    return focusCoverageCache;
  }
}

function renderFocusDashboardSection(dashboard) {
  if (!dashboard?.instruments?.length) {
    const fallback = seedFocusDashboardFromOutlook(window.__outlookCacheInstruments || []);
    if (fallback) dashboard = fallback;
  }
  if (!dashboard?.instruments?.length) {
    const pending = (window.__outlookCacheInstruments || []).length > 0;
    return `<section class="outlook-section outlook-focus-dashboard outlook-focus-empty">
      <h3 class="outlook-section-title">关注品种 · 战场情报</h3>
      <p class="empty-state">${pending ? '<span class="spinner inline-spinner"></span> 战场情报同步中…' : '看板加载中或 outlook 未就绪'}</p>
    </section>`;
  }
  const cursorTag = dashboard.cursorConfigured
    ? `<span class="outlook-cursor-badge configured" title="Cursor 模型">Cursor · ${escapeHtml(dashboard.instruments[0]?.analysis?.model || 'composer-2.5')}</span>`
    : `<span class="outlook-cursor-badge unconfigured" title="请在 config.json 或 .env 配置 CURSOR_API_KEY">Cursor 未配置</span>`;
  const top5Html = (dashboard.top5 || []).map((t) => renderFocusTop5Card(t)).join('');
  const majorHtml = (dashboard.majorOpportunities || [])
    .map(
      (m) =>
        `<span class="outlook-major-chip${m.longTermPin?.pinned ? ' outlook-major-longterm' : ''}" data-focus-symbol="${escapeAttr(m.symbol)}" title="${escapeAttr(m.watchThesis || m.longTermPin?.label || '重大机会')}">★ ${escapeHtml(m.name)}${m.longTermPin?.pinned ? ` · ${escapeHtml(m.longTermPin.label)}` : ''}</span>`
    )
    .join('');
  const syncTag = dashboard.localPreview
    ? '<span class="outlook-focus-sync-tag" title="已用研判缓存结构预览，完整情报同步中">结构预览 · 同步中</span>'
    : '';
  return `<section class="outlook-section outlook-focus-dashboard">
    <div class="outlook-section-head">
      <h3 class="outlook-section-title">关注品种 · 战场情报（${dashboard.focusCount}）</h3>
      ${syncTag}
      ${cursorTag}
      <button type="button" class="outlook-btn outlook-btn-sm" data-action="refresh-focus-dashboard" title="刷新多维情报与 Cursor 分析">刷新情报</button>
    </div>
    ${renderFocusAnalysisProgressHtml()}
    <div class="outlook-focus-top5-deep-progress" data-focus-top5-deep-progress hidden>
      <div class="outlook-focus-progress-track"><div class="outlook-focus-progress-fill" data-focus-top5-deep-progress-fill style="width:0%"></div></div>
      <span class="outlook-focus-progress-label" data-focus-top5-deep-progress-label>Cursor 深度解读 0/5</span>
    </div>
    <div class="outlook-focus-top5-block">
      <h4 class="outlook-top5-subhead">今日最值得跟踪 Top 5 <span class="outlook-top5-subhint">主矛盾·反对意见 · 政策·技术·资金·库存现货 · Cursor 深度解读</span></h4>
      <ol class="outlook-top5-list outlook-top5-list-intel">${top5Html || '<li>暂无</li>'}</ol>
    </div>
    ${majorHtml ? `<div class="outlook-major-opportunities" role="list">${majorHtml}</div>` : ''}
    <p class="outlook-focus-note">情报来自引擎结构化数据 + 新闻池 + AnySearch（30min）· 缺失显示「暂无/待校验」· ${escapeHtml(dashboard.sessionDate || '')}</p>
  </section>`;
}

function renderFocusRowBadges(instId) {
  const row = focusDashboardCache?.instruments?.find(
    (r) => String(r.symbol).toLowerCase() === String(instId || '').toLowerCase()
  );
  if (!row) return '';
  const badges = [];
  if (row.pinned || row.isMajorOpportunity) badges.push('<span class="outlook-badge outlook-badge-major" title="重大机会">★ 重大机会</span>');
  if (row.isTop5 && row.top5Rank) badges.push(`<span class="outlook-badge outlook-badge-top5" title="Top5">Top${row.top5Rank}</span>`);
  if (!row.read) badges.push('<span class="outlook-badge outlook-badge-unread" title="未读">未读</span>');
  else badges.push('<span class="outlook-badge outlook-badge-read" title="已读">已读</span>');
  return badges.join('');
}

async function loadFocusDashboard(options = {}) {
  if (!window.fancheng?.getFocusDashboard) {
    return seedFocusDashboardFromOutlook(window.__outlookCacheInstruments || []);
  }
  try {
    const dash = await window.fancheng.getFocusDashboard({
      force: options.force === true,
      generate: options.generate !== false,
      instruments: window.__outlookCacheInstruments || [],
      globalRisk: window.__outlookCacheGlobalRisk || null,
    });
    if (dash?.error) {
      const local = seedFocusDashboardFromOutlook(window.__outlookCacheInstruments || []);
      if (local) return local;
      console.warn('[focus-dashboard]', dash.error);
      return null;
    }
    focusDashboardCache = { ...dash, localPreview: false };
    return focusDashboardCache;
  } catch (err) {
    const local = seedFocusDashboardFromOutlook(window.__outlookCacheInstruments || []);
    if (local) return local;
    console.warn('[focus-dashboard]', err);
    return null;
  }
}

function renderOutlookPanel(source) {
  const hasData = Boolean(source.instruments?.length);
  const hasCategoriesOnly = !hasData && Boolean(source.categories?.length);
  const liveTag = source.liveRefreshedAt
    ? `<span class="policy-live-tag policy-live-badge outlook-live-tag"><span class="policy-live-dot"></span>实时 ${formatDate(source.liveRefreshedAt)}</span>`
    : '';
  const regimeTag =
    source.globalRegime && source.globalRegime !== 'neutral'
      ? `<span class="outlook-global-regime">${escapeHtml(source.globalRegimeLabel || source.globalRegime)}</span>`
      : '';

  if (!hasData) {
    if (hasCategoriesOnly) {
      return `<div class="panel ${activeTab === 'outlook' ? 'active' : ''}" id="panel-outlook" role="tabpanel">
        <div class="empty-state outlook-empty-state">
          <p>品种列表缓存异常（仅宏观分类、无逐品种数据），正在重新计算…</p>
          <button type="button" class="btn-secondary" data-action="retry-outlook">立即刷新研判</button>
        </div>
      </div>`;
    }
    return renderOutlookPlaceholder(source);
  }

  window.__outlookCacheCategories = source.categories;
  window.__outlookCacheInstruments = enrichOutlookInstrumentsClientSide(source.instruments);
  window.__outlookCacheFactors = source.factors;
  window.__outlookCacheFramework = source.framework;
  window.__outlookCacheStats = source.stats;
  window.__outlookCacheGlobalRisk = source.globalLiquidityRisk || source.globalRisk || null;
  window.__outlookCacheAiMacroBrief = source.aiMacroBrief || window.__outlookCacheAiMacroBrief || null;
  window.__outlookCacheDailyBrief = source.dailyBrief || window.__outlookCacheDailyBrief || null;
  window.__outlookCacheIntelCenterPack = source.intelCenterPack || window.__outlookCacheIntelCenterPack || null;
  if (source.dailyBrief) window.__outlookDailyBriefAt = Date.now();

  const instruments = filterUserFocusInstruments(source.instruments || []);
  ensureOutlookDefaultSelection(instruments, { defer: true });
  seedFocusDashboardFromOutlook(instruments);
  const sectorCounts = countOutlookInstrumentsBySector(instruments);
  const sectors = source.sectors || source.framework?.sectors || [];
  const factorCards = (source.factors || []).map(renderOutlookFactorCard).join('');
  const categoryCards = (source.categories || []).map(renderOutlookCategoryCard).join('');

  return `<div class="panel ${activeTab === 'outlook' ? 'active' : ''}" id="panel-outlook" role="tabpanel" data-outlook-ui-version="${OUTLOOK_UI_VERSION}">
    <div class="policy-panel policy-reading-v2 outlook-panel outlook-intel-stage">
      <div class="outlook-core-header-strip">
        <div class="outlook-core-banner">
          <span class="outlook-core-banner-icon" aria-hidden="true">◆</span>
          <span class="outlook-core-banner-text">情报中心 · 主矛盾 / 证伪 / 内外双轨 / 注意力预算</span>
        </div>
        <span class="outlook-core-ribbon" aria-label="情报中心">INTEL</span>
      </div>
      <header class="policy-reading-head">
        <div class="policy-reading-head-main">
          <h2 class="policy-reading-title">大宗走势研判 · 情报中心</h2>
          ${renderOutlookStatsInline(source.stats)}
        </div>
        ${liveTag}${regimeTag}
      </header>
      <div class="intel-center-hub-slot intel-center-hub-stage">${renderIntelCenterHub(source.intelCenterPack)}</div>
      ${renderPhilosophyEpigraphHtml('outlook-epigraph')}
      <details class="outlook-secondary-stack">
        <summary>决策一页纸 / AI 助手</summary>
        ${renderOutlookDecisionOnePager(source)}
        ${renderOutlookAiAssistantHub(source, null)}
      </details>
      <details class="outlook-secondary-stack">
        <summary>头条 / 焦点看板 / 覆盖 / 日历</summary>
        <div class="outlook-headlines-slot">${renderOutlookHeadlinesStack(outlookHeadlinesCache, source)}</div>
        <div class="outlook-focus-dashboard-slot">${renderFocusDashboardSection(focusDashboardCache)}</div>
        <div class="outlook-focus-coverage-slot">${renderFocusCoverageSection(focusCoverageCache)}</div>
        <div class="outlook-focus-release-slot">${renderFocusReleaseCalendarSection(focusReleaseCalCache)}</div>
      </details>
      <details class="outlook-depth-collapsed">
        <summary>深度研判 · 宏观 AI / 因子带（折叠）</summary>
        ${renderOutlookMacroAiBrief(source)}
        ${renderOutlookMacroStrip(source.factors)}
      </details>
      <section class="outlook-section outlook-section-primary">
        <div class="outlook-section-head">
          <h3 class="outlook-section-title">关注品种 · 命题列表</h3>
          <span class="outlook-section-meta">${instruments.length} 品种 · 深算优先 · 点击行看备忘录硬模板</span>
        </div>
        ${renderOutlookToolbar(source, sectors, sectorCounts, outlookSectorFilter)}
        <div class="outlook-table-wrap">
          <div class="outlook-instrument-head-row" aria-hidden="true">
            <span>品种</span><span>现价</span><span>Cursor 分析</span><span>研判依据</span><span>资金关注</span><span>幕僚</span><span>技术标签</span><span></span>
          </div>
          <div class="outlook-instrument-list" data-outlook-instrument-count="${instruments.length}"></div>
        </div>
        <p class="outlook-sector-empty empty-state" hidden>当前板块暂无品种数据</p>
        <div class="outlook-detail-slot">${renderOutlookDetailSlotHint()}</div>
      </section>
      <section class="outlook-section outlook-section-secondary outlook-section-deferred" hidden>
        <h3 class="outlook-section-title">四大类 outlook 参考</h3>
        <div class="outlook-category-grid">${categoryCards}</div>
      </section>
      <p class="policy-note outlook-note outlook-core-tagline">情报中心 · ${OUTLOOK_UI_VERSION}${source.framework?.intelCenterVersion ? ` · pack ${escapeHtml(source.framework.intelCenterVersion)}` : ''}${source.framework?.version ? ` · engine ${escapeHtml(source.framework.version)}` : ''} · 禁止假数据 · 仅供参考</p>
    </div>
  </div>`;
}

function refreshOutlookPanelSections(panel, source, options = {}) {
  if (!panel || !isActivePanel('outlook')) return;
  const data = source || {
    categories: window.__outlookCacheCategories || [],
    instruments: window.__outlookCacheInstruments || [],
    factors: window.__outlookCacheFactors || [],
    framework: window.__outlookCacheFramework,
    stats: window.__outlookCacheStats,
    dataLabel: '大宗商品走势研判 · 逐品种多因子 · 次日波动情景',
  };
  if (!data.instruments?.length && !data.categories?.length) return;

  window.__outlookCacheGlobalRisk = data.globalLiquidityRisk || data.globalRisk || window.__outlookCacheGlobalRisk;
  window.__outlookCacheAiMacroBrief = data.aiMacroBrief || window.__outlookCacheAiMacroBrief;
  if (!options.silentRefresh) {
    window.__outlookCacheDailyBrief = data.dailyBrief || window.__outlookCacheDailyBrief;
  }

  const onePager = panel.querySelector('.outlook-decision-one-pager');
  if (onePager && !options.silentRefresh) {
    onePager.outerHTML = renderOutlookDecisionOnePager(data);
    void hydrateOutlookSlotDecisionBrief(panel);
  }

  const intelHub = panel.querySelector('.intel-center-hub-slot');
  if (intelHub && data.intelCenterPack) {
    intelHub.innerHTML = renderIntelCenterHub(data.intelCenterPack);
  }

  if (!options.silentRefresh) {
    refreshOutlookAiAssistantHub(panel, data);
    void hydrateOutlookAiFusionHub(panel, data);
  }

  const headlinesSlot = panel.querySelector('.outlook-headlines-slot');
  if (headlinesSlot) {
    if (outlookHeadlinesCache?.global?.items?.length || outlookHeadlinesCache?.feed?.items?.length) {
      headlinesSlot.innerHTML = renderOutlookHeadlinesStack(outlookHeadlinesCache, data);
    } else if (!outlookHeadlinesLoadInFlight) {
      ensureOutlookHeadlinesAndDashboard(panel, { skipScan: false });
    }
  } else {
    const glStrip = panel.querySelector('.outlook-global-liquidity-strip');
    if (glStrip) glStrip.outerHTML = renderOutlookGlobalLiquidityStrip(data);
  }

  const macroAiBrief = panel.querySelector('.outlook-macro-ai-brief');
  if (macroAiBrief) {
    macroAiBrief.outerHTML = renderOutlookMacroAiBrief(data);
  } else {
    const glStripAfter = panel.querySelector('.outlook-global-liquidity-strip');
    if (glStripAfter && data.aiMacroBrief) {
      glStripAfter.insertAdjacentHTML('afterend', renderOutlookMacroAiBrief(data));
    }
  }

  const headMain = panel.querySelector('.policy-reading-head-main');
  if (headMain) {
    const statsEl = headMain.querySelector('.outlook-stats-inline');
    if (statsEl) statsEl.outerHTML = renderOutlookStatsInline(data.stats);
  }

  const frameworkIntro = panel.querySelector('.outlook-framework-intro');
  if (frameworkIntro && data.framework?.logicModel) {
    frameworkIntro.textContent = data.framework.logicModel;
  }

  const sectionMeta = panel.querySelector('.outlook-section-meta');
  if (sectionMeta && data.instruments?.length) {
    sectionMeta.textContent = `${data.instruments.length} 品种 · 点击行查看下方详情`;
  }

  const hitRateEl = panel.querySelector('.outlook-hit-rate');
  if (hitRateEl && data.stats) {
    replaceOutlookHitRateBadges(panel, data.stats);
  }

  const instList = panel.querySelector('.outlook-instrument-list');
  if (instList && data.instruments?.length) {
    const contentHash = hashOutlookInstrumentsContent(data.instruments);
    if (instList.dataset.contentHash !== contentHash) {
      remountOutlookInstrumentList(panel, data.instruments);
      if (outlookSelectedInstrumentId) {
        updateOutlookDetailPanel(panel, outlookSelectedInstrumentId, { defer: true });
      }
    } else {
      updateOutlookPriceCells(data.instruments, { batch: true, force: true, flash: false });
      if (outlookSelectedInstrumentId) {
        const inst = findOutlookInstrument(outlookSelectedInstrumentId);
        if (inst) refreshOutlookDetailPanelContent(panel, inst);
      }
    }
  }

  const sectorTabs = panel.querySelector('.outlook-sector-tabs');
  if (sectorTabs && data.instruments?.length) {
    const sectors = data.sectors || data.framework?.sectors || [];
    sectorTabs.outerHTML = renderOutlookSectorTabs(
      sectors,
      outlookSectorFilter,
      countOutlookInstrumentsBySector(data.instruments)
    );
  }
  applyOutlookSectorFilter(panel, outlookSectorFilter);
  updateOutlookPriceCells(data.instruments, { batch: true, force: true, flash: false });

  const stamp = resolveOutlookDisplayStamp(data);
  if (stamp) updateOutlookToolbarStamp(stamp);

  const catGrid = panel.querySelector('.outlook-category-grid');
  if (catGrid && data.categories?.length) {
    const hash = hashListInputs(['outlook-cat', data.categories.map((c) => `${c.id}:${c.short?.direction}`).join(',')]);
    if (catGrid.dataset.listHash !== hash) {
      catGrid.dataset.listHash = hash;
      catGrid.innerHTML = data.categories.map(renderOutlookCategoryCard).join('');
    }
  }

  const factorGrid = panel.querySelector('.outlook-factor-grid');
  if (factorGrid) {
    const hash = hashListInputs(['outlook-fac', data.factors?.map((f) => `${f.id}:${f.direction}`).join(',')]);
    if (factorGrid.dataset.listHash !== hash) {
      factorGrid.dataset.listHash = hash;
      factorGrid.innerHTML = (data.factors || []).map(renderOutlookFactorCard).join('');
    }
  }

  updateNavTabBadge('outlook', data.instruments?.length || data.categories?.length || null);
}

const refreshOutlookPanelSectionsDebounced = debounce(refreshOutlookPanelSections, OUTLOOK_DEBOUNCE_MS);

const refreshOutlookOnDataRefreshedDebounced = debounce((data) => {
  if (!isActivePanel('outlook') || !shouldProcessLiveDomUpdate()) return;
  const outlook = data?.sources?.outlook;
  if (outlook?.instruments?.length || outlook?.categories?.length) return;
  if (window.fancheng?.fetchOutlookLive) void refreshOutlookLive({ force: false });
}, OUTLOOK_DEBOUNCE_MS);

async function exportOutlookVerificationAllUi(panel, triggerBtn) {
  if (!window.fancheng?.exportOutlookVerificationAll) return;
  const prevLabel = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = '导出中…';
  }
  try {
    const result = await window.fancheng.exportOutlookVerificationAll();
    if (result?.error) {
      window.fancheng.showNotification?.({ title: '导出失败', body: localizeUiMessage(result.error) });
      return;
    }
    const msg = `已导出 ${result.instruments ?? '—'} 品种 · ${result.count ?? 0} 行`;
    window.fancheng.showNotification?.({ title: '复盘 CSV 已保存', body: msg });
    if (result.path && window.fancheng.showItemInFolder) {
      window.fancheng.showItemInFolder(result.path);
    }
    const slot = panel?.querySelector('.outlook-backtest-progress-slot');
    if (slot) {
      slot.innerHTML = `<span class="outlook-export-status" title="${escapeAttr(result.path || '')}">${escapeHtml(msg)}</span>`;
      setTimeout(() => {
        if (slot.querySelector('.outlook-export-status')) slot.innerHTML = '';
      }, 12000);
    }
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = prevLabel || '一键下载复盘';
    }
  }
}

async function exportOutlookSlotCompareUi(panel, triggerBtn, instrumentId) {
  const api = instrumentId
    ? window.fancheng?.exportOutlookSlotComparisonForInstrument
    : window.fancheng?.exportOutlookSlotComparisonAll;
  if (!api) return;
  const prevLabel = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = '导出中…';
  }
  try {
    const sessionDate =
      window.__outlookSlotCaptureMeta?.sessionDate || new Date().toISOString().slice(0, 10);
    const result = instrumentId
      ? await api(instrumentId, { sessionDate })
      : await api(null, { sessionDate });
    if (result?.error) {
      window.fancheng.showNotification?.({ title: '导出失败', body: localizeUiMessage(result.error) });
      return;
    }
    const msg = instrumentId
      ? `已导出 ${instrumentId.toUpperCase()} · ${result.count ?? 0} 行`
      : `已导出 ${result.instruments ?? '—'} 品种 · ${result.count ?? 0} 行`;
    window.fancheng.showNotification?.({ title: '三时段对照 CSV 已保存', body: msg });
    if (result.path && window.fancheng.showItemInFolder) {
      window.fancheng.showItemInFolder(result.path);
    }
    const slot = panel?.querySelector('.outlook-backtest-progress-slot');
    if (slot) {
      slot.innerHTML = `<span class="outlook-export-status" title="${escapeAttr(result.path || '')}">${escapeHtml(msg)}</span>`;
      setTimeout(() => {
        if (slot.querySelector('.outlook-export-status')) slot.innerHTML = '';
      }, 12000);
    }
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = prevLabel || (instrumentId ? '下载三时段对照 CSV' : '下载次日预测对照');
    }
  }
}

async function openOutlookDailyCompareModal() {
  if (!window.fancheng?.getOutlookDailyCompare) return;
  const panel = document.getElementById('panel-outlook');
  let modal = panel?.querySelector('.outlook-daily-compare-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'outlook-daily-compare-modal';
    modal.innerHTML = `<div class="outlook-daily-compare-dialog">
      <header><h4>每日对照</h4><button type="button" class="outlook-daily-compare-close" data-action="close-outlook-daily-compare">×</button></header>
      <div class="outlook-daily-compare-controls">
        <label>对照日 <input type="date" class="outlook-daily-date-a" /></label>
        <label>今日 <input type="date" class="outlook-daily-date-b" /></label>
        <button type="button" class="btn-link" data-action="reload-outlook-daily-compare">刷新</button>
      </div>
      <div class="outlook-daily-compare-body"></div>
    </div>`;
    panel?.querySelector('.outlook-panel')?.appendChild(modal);
  }
  const body = modal.querySelector('.outlook-daily-compare-body');
  const inputA = modal.querySelector('.outlook-daily-date-a');
  const inputB = modal.querySelector('.outlook-daily-date-b');
  const today = new Date();
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (inputB && !inputB.value) inputB.value = fmt(today);
  if (inputA && !inputA.value) inputA.value = fmt(y);
  modal.hidden = false;
  if (body) body.innerHTML = '<div class="spinner inline-spinner"></div> 加载每日对照…';

  const load = async () => {
    const dateA = inputA?.value || fmt(y);
    const dateB = inputB?.value || fmt(today);
    const data = await window.fancheng.getOutlookDailyCompare(dateA, dateB);
    if (data?.error) {
      if (body) body.textContent = localizeUiMessage(data.error);
      return;
    }
    const hitPct =
      data.aggregateHitRate != null ? `${Math.round(data.aggregateHitRate * 100)}%` : '—';
    const rows = (data.rows || [])
      .map((r) => {
        const hit = r.directionHit === true ? '✓' : r.directionHit === false ? '✗' : '—';
        return `<tr>
          <td>${escapeHtml(r.name || r.id)}</td>
          <td>${escapeHtml(formatOutlookPctSign(r.yesterdayPredictedMid))}</td>
          <td>${escapeHtml(formatOutlookPctSign(r.yesterdayActualPct))}</td>
          <td>${escapeHtml(formatOutlookPctSign(r.yesterdayGapPct))}</td>
          <td>${escapeHtml(formatOutlookPctSign(r.todayPredictedMid))}</td>
          <td>${hit}</td>
        </tr>`;
      })
      .join('');
    if (body) {
      body.innerHTML = `<p class="outlook-daily-compare-meta">昨日方向命中率 <strong>${hitPct}</strong>${data.comparePath ? ` · ${escapeHtml(data.comparePath)}` : ''}</p>
        <table class="outlook-daily-compare-table">
          <thead><tr><th>品种</th><th>昨日预测中心%</th><th>昨日实际%</th><th>误差</th><th>今日预测中心%</th><th>方向命中</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">暂无对照数据，请先积累每日快照</td></tr>'}</tbody>
        </table>`;
    }
  };
  modal.dataset.loadHandler = '1';
  if (!modal.dataset.bound) {
    modal.dataset.bound = '1';
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="reload-outlook-daily-compare"]')) {
        e.preventDefault();
        void load();
      }
    });
    inputA?.addEventListener('change', () => void load());
    inputB?.addEventListener('change', () => void load());
  }
  await load();
}

async function openOutlookHistoryModal(instrumentId) {
  if (!instrumentId || !window.fancheng?.getOutlookHistory) return;
  const panel = document.getElementById('panel-outlook');
  let modal = panel?.querySelector('.outlook-history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'outlook-history-modal';
    modal.innerHTML = '<div class="outlook-history-dialog"><header><h4></h4><button type="button" class="outlook-history-close" data-action="close-outlook-history">×</button></header><div class="outlook-history-body"></div></div>';
    panel?.querySelector('.outlook-panel')?.appendChild(modal);
  }
  const title = modal.querySelector('h4');
  const body = modal.querySelector('.outlook-history-body');
  if (title) title.textContent = `${instrumentId} · 研判存档 · 最近 20 条`;
  if (body) body.innerHTML = '<div class="spinner inline-spinner"></div> 加载存档…';
  modal.hidden = false;

  const data = await window.fancheng.getOutlookHistory(instrumentId, 14);
  if (data?.error) {
    if (body) body.textContent = localizeUiMessage(data.error);
    return;
  }
  const rows = (data.changes || []).slice(0, 20);
  if (!rows.length) {
    if (body) body.innerHTML = '<p class="empty-state">暂无研判变更记录</p>';
    return;
  }
  if (body) {
    body.innerHTML = `<ul class="outlook-history-list">${rows
      .map((r) => {
        const ts = r.ts ? formatDate(r.ts) : '—';
        const tags = (r.reasonTags || []).map((t) => escapeHtml(t)).join(' · ');
        const range = r.baseRange ? formatOutlookRangePct(r.baseRange) : '—';
        const dScore = r.deltaScore != null ? ` Δ分${r.deltaScore >= 0 ? '+' : ''}${r.deltaScore}` : '';
        const latency = r.latencyLabel || r.latencyState ? ` · ${escapeHtml(r.latencyLabel || r.latencyState)}` : '';
        return `<li><span class="outlook-history-ts">${escapeHtml(ts)}</span> <span class="outlook-history-dir">${escapeHtml(r.directionLabel || '')}</span> <span class="outlook-history-range">${range}</span>${dScore ? `<span class="outlook-history-delta">${escapeHtml(dScore.trim())}</span>` : ''}${latency}${tags ? `<span class="outlook-history-tags">${tags}</span>` : ''}</li>`;
      })
      .join('')}</ul>${data.root ? `<p class="outlook-archive-path">${escapeHtml(data.root)}</p>` : ''}`;
  }
}

function setupOutlookPanel() {
  const panel = document.getElementById('panel-outlook');
  if (!panel) return;
  setupFocusNewsReaderDelegation();
  setupOutlookBacktestListeners(panel);
  if (panel.dataset.outlookSetup !== '1') {
    panel.dataset.outlookSetup = '1';
    panel.addEventListener('click', (e) => {
      const sectorBtn = e.target.closest('[data-outlook-sector]');
      if (sectorBtn?.classList.contains('outlook-sector-tab')) {
        e.preventDefault();
        outlookSectorFilter = sectorBtn.dataset.outlookSector || 'all';
        panel.querySelectorAll('.outlook-sector-tab').forEach((btn) => {
          const on = btn.dataset.outlookSector === outlookSectorFilter;
          btn.classList.toggle('active', on);
          btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        applyOutlookSectorFilter(panel, outlookSectorFilter);
        return;
      }
      const slotBtn = e.target.closest('[data-outlook-slot]');
      if (slotBtn?.classList.contains('outlook-slot-tab')) {
        e.preventDefault();
        outlookSlotFilter = slotBtn.dataset.outlookSlot || 'all';
        panel.querySelectorAll('.outlook-slot-tab').forEach((btn) => {
          const on = btn.dataset.outlookSlot === outlookSlotFilter;
          btn.classList.toggle('active', on);
          btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const sessionDate =
          window.__outlookSlotCaptureMeta?.sessionDate || new Date().toISOString().slice(0, 10);
        const snaps = window.__outlookSlotSnapshotsBySession?.[sessionDate] || [];
        if (window.__outlookCacheInstruments?.length) {
          window.__outlookCacheInstruments = attachOutlookListSlotContext(
            window.__outlookCacheInstruments,
            snaps,
            sessionDate
          );
          remountOutlookInstrumentList(panel, window.__outlookCacheInstruments, { immediate: true, skipSkeleton: true });
          applyOutlookSectorFilter(panel, outlookSectorFilter);
        }
        if (outlookSelectedInstrumentId) updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
        return;
      }
      const majorChip = e.target.closest('.outlook-major-chip');
      if (majorChip?.dataset?.focusSymbol) {
        e.preventDefault();
        outlookSelectedInstrumentId = majorChip.dataset.focusSymbol;
        updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
        refreshOutlookAiAssistantHub(panel);
        const row = panel.querySelector(`[data-outlook-instrument="${outlookSelectedInstrumentId}"]`);
        row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      const regenBtn = e.target.closest('[data-action="regen-focus-analysis"]');
      if (regenBtn) {
        e.preventDefault();
        const id = regenBtn.dataset.instrument || outlookSelectedInstrumentId;
        if (id) void regenerateFocusAnalysisForInstrument(panel, id);
        return;
      }
      const refreshHeadlinesBtn = e.target.closest('[data-action="refresh-outlook-headlines"]');
      if (refreshHeadlinesBtn) {
        e.preventDefault();
        refreshHeadlinesBtn.disabled = true;
        void loadOutlookHeadlines({ enrichCursor: true, forceLiquidity: true, runScan: true }).then(() => {
          refreshHeadlinesBtn.disabled = false;
          const slot = panel.querySelector('.outlook-headlines-slot');
          if (slot) {
            slot.innerHTML = renderOutlookHeadlinesStack(outlookHeadlinesCache, {
              globalLiquidityRisk: window.__outlookCacheGlobalRisk,
            });
          }
        });
        return;
      }
      const refreshFocusBtn = e.target.closest('[data-action="refresh-focus-dashboard"]');
      if (refreshFocusBtn) {
        e.preventDefault();
        refreshFocusBtn.disabled = true;
        refreshFocusBtn.textContent = '刷新中…';
        void loadFocusDashboard({ force: true, generate: true }).then((dash) => {
          refreshFocusBtn.disabled = false;
          refreshFocusBtn.textContent = '刷新情报';
          if (dash) {
            focusDashboardCache = dash;
            const slot = panel.querySelector('.outlook-focus-dashboard-slot');
            if (slot) slot.innerHTML = renderFocusDashboardSection(dash);
            remountOutlookInstrumentList(panel, window.__outlookCacheInstruments, { immediate: true, skipSkeleton: true });
            startTop5DeepBriefLiveRefresh(panel, { force: true });
            startFocusAnalysisLiveRefresh(panel, { force: true });
          }
        });
        return;
      }
      const refreshCovBtn = e.target.closest('[data-action="refresh-coverage-audit"]');
      if (refreshCovBtn) {
        e.preventDefault();
        refreshCovBtn.disabled = true;
        refreshCovBtn.textContent = '审计中…';
        void loadFocusCoverageAudit({ force: true }).then((audit) => {
          refreshCovBtn.disabled = false;
          refreshCovBtn.textContent = '刷新审计';
          if (audit) {
            focusCoverageCache = audit;
            const slot = panel.querySelector('.outlook-focus-coverage-slot');
            if (slot) slot.innerHTML = renderFocusCoverageSection(audit);
          }
        });
        return;
      }
      const refreshRelBtn = e.target.closest('[data-action="refresh-release-calendar"]');
      if (refreshRelBtn) {
        e.preventDefault();
        refreshRelBtn.disabled = true;
        refreshRelBtn.textContent = '刷新中…';
        void loadFocusReleaseCalendar({ force: true }).then((cal) => {
          refreshRelBtn.disabled = false;
          refreshRelBtn.textContent = '刷新';
          if (cal) {
            focusReleaseCalCache = cal;
            const slot = panel.querySelector('.outlook-focus-release-slot');
            if (slot) slot.innerHTML = renderFocusReleaseCalendarSection(cal);
          }
        });
        return;
      }
      const covRow = e.target.closest('.outlook-cov-row[data-focus-symbol]');
      if (covRow?.dataset?.focusSymbol) {
        e.preventDefault();
        outlookSelectedInstrumentId = covRow.dataset.focusSymbol;
        updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
        refreshOutlookAiAssistantHub(panel);
        const row = panel.querySelector(`[data-outlook-instrument="${outlookSelectedInstrumentId}"]`);
        row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      const retryBtn = e.target.closest('[data-action="retry-outlook"]');
      if (retryBtn) {
        e.preventDefault();
        window.__outlookLoadError = null;
        window.__outlookEmptyReady = false;
        replaceSinglePanel('outlook', {});
        void refreshOutlookLive({ force: true });
        return;
      }
      const historyBtn = e.target.closest('[data-action="open-outlook-history"]');
      if (historyBtn) {
        e.preventDefault();
        void openOutlookHistoryModal(historyBtn.dataset.instrument);
        return;
      }
      const closeHistory = e.target.closest('[data-action="close-outlook-history"]');
      if (closeHistory) {
        e.preventDefault();
        panel.querySelector('.outlook-history-modal')?.setAttribute('hidden', '');
        return;
      }
      const openNewsBtn = e.target.closest('[data-action="open-focus-news"]');
      if (openNewsBtn) {
        e.preventDefault();
        const sym = openNewsBtn.dataset.focusSymbol;
        const newsId = openNewsBtn.dataset.newsId;
        if (sym && newsId) void openFocusNewsModal(sym, newsId);
        return;
      }
      const closeNewsBtn = e.target.closest('[data-action="close-focus-news"]');
      if (closeNewsBtn) {
        e.preventDefault();
        closeFocusNewsModal();
        return;
      }
      const globalArchive = e.target.closest('[data-action="open-outlook-history-global"]');
      if (globalArchive) {
        e.preventDefault();
        const firstVisible = panel.querySelector('.outlook-instrument-row:not([hidden])');
        const id = outlookSelectedInstrumentId || firstVisible?.dataset?.outlookInstrument;
        if (id) void openOutlookHistoryModal(id);
        return;
      }
      const dailyCompare = e.target.closest('[data-action="open-outlook-daily-compare"]');
      if (dailyCompare) {
        e.preventDefault();
        void openOutlookDailyCompareModal();
        return;
      }
      const verifyExport = e.target.closest('[data-action="export-outlook-verification-all"]');
      if (verifyExport) {
        e.preventDefault();
        void exportOutlookVerificationAllUi(panel, verifyExport);
        return;
      }
      const slotExportAll = e.target.closest('[data-action="export-outlook-slot-compare-all"]');
      if (slotExportAll) {
        e.preventDefault();
        void exportOutlookSlotCompareUi(panel, slotExportAll, null);
        return;
      }
      const slotExportOne = e.target.closest('[data-action="export-outlook-slot-compare"]');
      if (slotExportOne) {
        e.preventDefault();
        void exportOutlookSlotCompareUi(panel, slotExportOne, slotExportOne.dataset.instrumentId || outlookSelectedInstrumentId);
        return;
      }
      const runLongrun = e.target.closest('[data-action="run-outlook-longrun-backtest"]');
      if (runLongrun) {
        e.preventDefault();
        void runOutlookLongrunBacktestUi(panel);
        return;
      }
      const runBacktest = e.target.closest('[data-action="run-outlook-backtest"]');
      if (runBacktest) {
        e.preventDefault();
        void runOutlookBacktestUi(panel);
        return;
      }
      const closeLongrun = e.target.closest('[data-action="close-outlook-longrun"]');
      if (closeLongrun) {
        e.preventDefault();
        panel.querySelector('.outlook-longrun-modal')?.setAttribute('hidden', '');
        return;
      }
      const closeBacktest = e.target.closest('[data-action="close-outlook-backtest"]');
      if (closeBacktest) {
        e.preventDefault();
        panel.querySelector('.outlook-backtest-modal')?.setAttribute('hidden', '');
        return;
      }
      const closeDailyCompare = e.target.closest('[data-action="close-outlook-daily-compare"]');
      if (closeDailyCompare) {
        e.preventDefault();
        panel.querySelector('.outlook-daily-compare-modal')?.setAttribute('hidden', '');
        return;
      }
      const openCalibration = e.target.closest('[data-action="open-outlook-calibration"]');
      if (openCalibration) {
        e.preventDefault();
        openOutlookCalibrationModal(panel, window.__outlookCacheStats);
        return;
      }
      const closeCalibration = e.target.closest('[data-action="close-outlook-calibration"]');
      if (closeCalibration) {
        e.preventDefault();
        panel.querySelector('.outlook-calibration-modal')?.setAttribute('hidden', '');
        return;
      }
      const closeDetail = e.target.closest('[data-action="close-outlook-detail"]');
      if (closeDetail) {
        e.preventDefault();
        outlookSelectedInstrumentId = null;
        updateOutlookDetailPanel(panel, null);
        return;
      }
      const intelFace = e.target.closest('[data-action="intel-face"]');
      if (intelFace) {
        e.preventDefault();
        intelCenterFace = intelFace.dataset.face || 'decision';
        const hub = panel.querySelector('#intel-center-hub-root');
        const pack = window.__outlookCacheIntelCenterPack;
        if (hub && pack) hub.outerHTML = renderIntelCenterHub(pack);
        if (outlookSelectedInstrumentId) {
          updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
        }
        return;
      }
      const cmdP0 = e.target.closest('[data-action="intel-cmd-p0"]');
      if (cmdP0) {
        e.preventDefault();
        intelCenterFace = 'decision';
        const pack = window.__outlookCacheIntelCenterPack;
        const hub = panel.querySelector('#intel-center-hub-root');
        if (hub && pack) hub.outerHTML = renderIntelCenterHub(pack);
        panel.querySelector('#intel-cell-p0')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const first = pack?.questionQueue?.p0?.[0];
        if (first?.instrumentId) {
          outlookSelectedInstrumentId = first.instrumentId;
          const inst = (window.__outlookCacheInstruments || []).find((i) => i.id === first.instrumentId);
          if (inst) updateOutlookDetailPanel(panel, inst);
        }
        return;
      }
      const cmdMemo = e.target.closest('[data-action="intel-cmd-memo"]');
      if (cmdMemo) {
        e.preventDefault();
        const pack = window.__outlookCacheIntelCenterPack;
        const id = outlookSelectedInstrumentId || pack?.questionQueue?.p0?.[0]?.instrumentId || pack?.interrupts?.[0]?.id;
        if (id) {
          outlookSelectedInstrumentId = id;
          const inst = (window.__outlookCacheInstruments || []).find((i) => i.id === id);
          if (inst) updateOutlookDetailPanel(panel, inst);
          const text =
            inst?.intelCenter?.memoExport?.plain ||
            pack?.externalBriefBoard?.top?.find((u) => u.instrumentId === id)?.plain ||
            '';
          if (text && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(
              () => {
                const hint = panel.querySelector('.intel-memo-export-bar');
                if (hint) {
                  const note = document.createElement('span');
                  note.className = 'intel-memo-copied';
                  note.textContent = '已复制简报';
                  hint.appendChild(note);
                  setTimeout(() => note.remove(), 2000);
                }
              },
              () => {}
            );
          }
        }
        panel.querySelector('.intel-memo-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const copyPlain = e.target.closest('[data-action="intel-memo-copy-plain"]');
      const copyMd = e.target.closest('[data-action="intel-memo-copy-md"]');
      if (copyPlain || copyMd) {
        e.preventDefault();
        const iid = (copyPlain || copyMd).getAttribute('data-instrument');
        const inst = (window.__outlookCacheInstruments || []).find((i) => i.id === iid);
        const pack = window.__outlookCacheIntelCenterPack;
        const unit =
          inst?.intelCenter?.memoExport ||
          pack?.externalBriefBoard?.top?.find((u) => u.instrumentId === iid) ||
          null;
        const text = copyMd ? unit?.markdown : unit?.plain;
        if (!text) return;
        const mark = () => {
          const bar = (copyPlain || copyMd).closest('.intel-memo-export-bar');
          if (!bar) return;
          const note = document.createElement('span');
          note.className = 'intel-memo-copied';
          note.textContent = copyMd ? '已复制 MD' : '已复制简报';
          bar.appendChild(note);
          setTimeout(() => note.remove(), 2000);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(mark, () => {});
        }
        return;
      }
      const cmdShock = e.target.closest('[data-action="intel-cmd-shock"]');
      if (cmdShock) {
        e.preventDefault();
        intelCenterFace = 'research';
        const pack = window.__outlookCacheIntelCenterPack;
        const hub = panel.querySelector('#intel-center-hub-root');
        if (hub && pack) hub.outerHTML = renderIntelCenterHub(pack);
        panel.querySelector('#intel-cell-shock')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const cmdRev = e.target.closest('[data-action="intel-cmd-revisions"]');
      if (cmdRev) {
        e.preventDefault();
        intelCenterFace = 'research';
        const pack = window.__outlookCacheIntelCenterPack;
        const hub = panel.querySelector('#intel-center-hub-root');
        if (hub && pack) hub.outerHTML = renderIntelCenterHub(pack);
        panel.querySelector('#intel-cell-revisions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const cmdAct = e.target.closest('[data-action="intel-cmd-actionable"]');
      if (cmdAct) {
        e.preventDefault();
        intelCenterFace = 'decision';
        const pack = window.__outlookCacheIntelCenterPack;
        const hub = panel.querySelector('#intel-center-hub-root');
        if (hub && pack) hub.outerHTML = renderIntelCenterHub(pack);
        panel.querySelector('#intel-cmd-deck')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        panel.querySelector('#intel-cell-actionable')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const first =
          pack?.interruptChannel?.commandDeck?.next ||
          pack?.interruptChannel?.queue?.[0] ||
          pack?.interrupts?.[0] ||
          pack?.top5Candidates?.[0];
        if (first?.instrumentId || first?.id) {
          outlookSelectedInstrumentId = first.instrumentId || first.id;
          const inst = (window.__outlookCacheInstruments || []).find(
            (i) => i.id === outlookSelectedInstrumentId
          );
          if (inst) updateOutlookDetailPanel(panel, inst);
        }
        return;
      }
      const ackBtn = e.target.closest('[data-action="intel-ack-interrupt"]');
      if (ackBtn && window.fancheng?.ackIntelInterrupt) {
        e.preventDefault();
        const key = ackBtn.dataset.key;
        if (key) {
          void window.fancheng.ackIntelInterrupt({ key }).then((res) => {
            ackBtn.closest('li')?.remove();
            const pack = window.__outlookCacheIntelCenterPack;
            if (pack?.interruptChannel && res?.ok) {
              pack.interruptChannel.pendingCount = res.remaining;
              pack.interruptChannel.archivedToday = res.archivedToday ?? pack.interruptChannel.archivedToday;
              pack.interruptChannel.display = `打断通道 待确认 ${res.remaining} · 今日通知 ${pack.interruptChannel.notifiedToday || 0}/${pack.interruptChannel.maxDaily || 3} · 已归档 ${res.archivedToday ?? '—'}`;
              if (pack.interruptChannel.commandDeck) {
                pack.interruptChannel.commandDeck.pendingCount = res.remaining;
                pack.interruptChannel.commandDeck.active = res.remaining > 0;
                pack.interruptChannel.commandDeck.display =
                  res.remaining > 0 ? `指挥台 · 待确认 ${res.remaining}` : '指挥台 · 暂无待办';
              }
              const line = panel.querySelector('.intel-ich-line');
              if (line) line.innerHTML = `<strong>打断通道</strong> ${escapeHtml(pack.interruptChannel.display)}`;
              const deckEl = panel.querySelector('#intel-cmd-deck');
              if (deckEl && res.remaining === 0) deckEl.remove();
              else if (deckEl && pack) {
                const hub = panel.querySelector('#intel-center-hub-root');
                if (hub) hub.outerHTML = renderIntelCenterHub(pack);
              }
            }
          });
        }
        return;
      }
      const muteBtn = e.target.closest('[data-action="intel-mute-interrupt"]');
      if (muteBtn && window.fancheng?.muteIntelInterrupt) {
        e.preventDefault();
        const key = muteBtn.dataset.key;
        const muteHours = Number(muteBtn.dataset.muteHours) || 4;
        if (key) {
          void window.fancheng.muteIntelInterrupt({ key, muteHours }).then((res) => {
            if (res?.ok) {
              muteBtn.closest('li')?.remove();
              const pack = window.__outlookCacheIntelCenterPack;
              if (pack?.interruptChannel) {
                pack.interruptChannel.pendingCount = res.remaining;
                pack.interruptChannel.display = `打断通道 待确认 ${res.remaining} · 已消音 ${muteHours}h`;
                const hub = panel.querySelector('#intel-center-hub-root');
                if (hub) hub.outerHTML = renderIntelCenterHub(pack);
              }
            } else {
              window.alert(res?.error || '消音失败');
            }
          });
        }
        return;
      }
      const pbPin = e.target.closest('[data-action="intel-playbook-pin"]');
      if (pbPin && window.fancheng?.recordIntelAnalystAnnotation) {
        e.preventDefault();
        void window.fancheng
          .recordIntelAnalystAnnotation({
            instrumentId: pbPin.dataset.instrument,
            type: 'playbook_pin',
            target: pbPin.dataset.playbook,
            reason: `指定 Playbook ${pbPin.dataset.playbook}`,
          })
          .then((res) => {
            if (res?.ok) {
              const hint = panel.querySelector('.intel-playbook-line');
              if (hint) hint.insertAdjacentHTML('afterend', '<p class="intel-pb-saved">已保存覆写 · 下次深算生效</p>');
            }
          });
        return;
      }
      const pbClear = e.target.closest('[data-action="intel-playbook-clear"]');
      if (pbClear && window.fancheng?.recordIntelAnalystAnnotation) {
        e.preventDefault();
        void window.fancheng
          .recordIntelAnalystAnnotation({
            instrumentId: pbClear.dataset.instrument,
            type: 'playbook_clear',
            reason: '清除 Playbook 覆写',
          })
          .then((res) => {
            if (res?.ok) {
              const hint = panel.querySelector('.intel-playbook-line');
              if (hint) hint.insertAdjacentHTML('afterend', '<p class="intel-pb-saved">已清除覆写 · 恢复决策树</p>');
            }
          });
        return;
      }
      const annBtn = e.target.closest('[data-action="intel-annotate"]');
      if (annBtn && window.fancheng?.recordIntelAnalystAnnotation) {
        e.preventDefault();
        const type = annBtn.dataset.annType;
        let reason = null;
        if (type === 'veto') {
          reason = window.prompt('否决理由（必填）') || '';
          if (!String(reason).trim()) return;
        }
        void window.fancheng
          .recordIntelAnalystAnnotation({
            instrumentId: annBtn.dataset.instrument,
            claimId: annBtn.dataset.claim,
            type,
            target: type === 'noise' || type === 'reliable' || type === 'manipulation_risk' ? 'news' : null,
            reason,
          })
          .then((res) => {
            if (res?.ok) {
              annBtn.classList.add('intel-ann-done');
              annBtn.title = '已记录';
            } else if (res?.error) {
              window.alert(res.error);
            }
          });
        return;
      }
      const weightApprove = e.target.closest('[data-action="intel-weight-approve"]');
      if (weightApprove && window.fancheng?.approveIntelProcessWeights) {
        e.preventDefault();
        const note = window.prompt('批准备注（可选）') || '';
        void window.fancheng
          .approveIntelProcessWeights({
            proposalId: weightApprove.dataset.proposalId || null,
            actor: 'analyst',
            note: String(note).trim() || null,
          })
          .then((res) => {
            if (res?.ok) {
              weightApprove.classList.add('intel-ann-done');
              const bar = weightApprove.closest('.intel-weight-ack-bar');
              if (bar) bar.insertAdjacentHTML('afterend', '<p class="intel-weight-ack-ok">已批准落盘 · 生效权已更新</p>');
            } else {
              window.alert(res?.error || '批准失败');
            }
          });
        return;
      }
      const weightReject = e.target.closest('[data-action="intel-weight-reject"]');
      if (weightReject && window.fancheng?.rejectIntelProcessWeights) {
        e.preventDefault();
        const reason = window.prompt('驳回理由（建议填写）') || '';
        void window.fancheng
          .rejectIntelProcessWeights({
            proposalId: weightReject.dataset.proposalId || null,
            actor: 'analyst',
            reason: String(reason).trim() || null,
          })
          .then((res) => {
            if (res?.ok) {
              weightReject.classList.add('intel-ann-done');
              const bar = weightReject.closest('.intel-weight-ack-bar');
              if (bar) bar.insertAdjacentHTML('afterend', '<p class="intel-weight-ack-ok">已驳回 · 生效权未改</p>');
            } else {
              window.alert(res?.error || '驳回失败');
            }
          });
        return;
      }
      const debtOpsRun = e.target.closest('[data-action="intel-debt-ops-run"]');
      const debtOpsDry = e.target.closest('[data-action="intel-debt-ops-dry"]');
      if ((debtOpsRun || debtOpsDry) && window.fancheng?.runIntelDebtOps) {
        e.preventDefault();
        e.stopPropagation();
        const btn = debtOpsRun || debtOpsDry;
        const dryRun = Boolean(debtOpsDry);
        const maxItems = Number(btn.dataset.max) || 3;
        const instrumentId = btn.dataset.instrument || null;
        const debtType = btn.dataset.debtType || null;
        const preferMeta = btn.dataset.preferMeta === '1';
        btn.disabled = true;
        const prevLabel = btn.textContent;
        btn.textContent = dryRun ? '演练中…' : '还债中…';
        void window.fancheng
          .runIntelDebtOps({ maxItems, dryRun, instrumentId, debtType, preferMeta })
          .then((res) => {
            const host = btn.closest('.intel-debt-ops-actions, .intel-meta-ops-actions') || btn.parentElement;
            if (res?.ok && res.report) {
              const msg = escapeHtml(res.report.display || '完成');
              if (host) {
                host.insertAdjacentHTML(
                  'afterend',
                  `<p class="intel-debt-ops-ok">${msg}${res.report.partial ? ` · 部分 ${res.report.partial}（须重算）` : ''}</p>`
                );
              }
              if (!dryRun && typeof window.refreshOutlookIntelCenter === 'function') {
                void window.refreshOutlookIntelCenter();
              }
            } else {
              window.alert(res?.error || '债务运维失败');
            }
          })
          .finally(() => {
            btn.disabled = false;
            btn.textContent = prevLabel || (dryRun ? '演练' : '执行本周必还（最多3）');
          });
        return;
      }
      const fqAck = e.target.closest('[data-action="intel-ack-false-quiet"]');
      if (fqAck && window.fancheng?.ackIntelFalseQuiet) {
        e.preventDefault();
        e.stopPropagation();
        const resolution = fqAck.dataset.resolution || 'reviewed';
        fqAck.disabled = true;
        void window.fancheng
          .ackIntelFalseQuiet({ resolution })
          .then((res) => {
            if (res?.ok) {
              fqAck.classList.add('intel-ann-done');
              const host = fqAck.closest('.intel-fq-loop') || fqAck.parentElement;
              if (host) {
                host.insertAdjacentHTML('beforeend', '<p class="intel-fq-ack-ok">假静默已确认入档</p>');
              }
              if (typeof window.refreshOutlookIntelCenter === 'function') {
                void window.refreshOutlookIntelCenter();
              }
            } else {
              window.alert(res?.error || '确认失败');
            }
          })
          .finally(() => {
            fqAck.disabled = false;
          });
        return;
      }
      const memSearch = e.target.closest('[data-action="intel-memory-search"]');
      if (memSearch && window.fancheng?.searchIntelMemory) {
        e.preventDefault();
        e.stopPropagation();
        const box = memSearch.closest('[data-intel-mem-search]');
        const input = box?.querySelector('.intel-mem-q');
        const hitsEl = box?.querySelector('.intel-mem-hits') || document.getElementById('intel-mem-hits');
        const q = (input?.value || '').trim();
        memSearch.disabled = true;
        void window.fancheng
          .searchIntelMemory({ q, limit: 12 })
          .then((res) => {
            if (!hitsEl) return;
            if (!res?.ok) {
              hitsEl.innerHTML = `<li class="intel-mem-miss">${escapeHtml(res?.error || '检索失败')}</li>`;
              return;
            }
            const hits = res.result?.hits || [];
            if (!hits.length) {
              hitsEl.innerHTML = `<li class="intel-mem-miss">${escapeHtml(res.result?.display || '暂无命中')}</li>`;
              return;
            }
            hitsEl.innerHTML = hits
              .map(
                (h) =>
                  `<li class="intel-mem-hit" data-action="intel-memory-replay" data-claim-id="${escapeAttr(h.claimId || '')}" tabindex="0" role="button"><strong>${escapeHtml(h.kindLabel || h.kind || '')}</strong> · ${escapeHtml((h.statement || '').slice(0, 48))} · n=${escapeHtml(h.nDisplay || '暂无')}</li>`
              )
              .join('');
          })
          .finally(() => {
            memSearch.disabled = false;
          });
        return;
      }
      const memReplay = e.target.closest('[data-action="intel-memory-replay"]');
      if (memReplay && window.fancheng?.replayIntelMemoryClaim) {
        e.preventDefault();
        e.stopPropagation();
        const claimId = memReplay.dataset.claimId;
        if (!claimId) return;
        void window.fancheng.replayIntelMemoryClaim({ claimId }).then((res) => {
          const host = memReplay.closest('.intel-center-cell') || memReplay.parentElement;
          if (!res?.ok) {
            window.alert(res?.error || '回放失败');
            return;
          }
          const tl = res.timeline;
          const events = (tl?.events || [])
            .slice(-8)
            .map(
              (ev) =>
                `<li><span class="intel-mem-kind">${escapeHtml(ev.kindLabel || ev.kind || '')}</span> · ${escapeHtml((ev.at || '').slice(0, 19))} · ${escapeHtml((ev.statement || ev.reason || ev.trigger || '').slice(0, 40))}</li>`
            )
            .join('');
          if (host) {
            const old = host.querySelector('.intel-mem-replay-panel');
            if (old) old.remove();
            host.insertAdjacentHTML(
              'beforeend',
              `<div class="intel-mem-replay-panel"><p><strong>回放</strong> ${escapeHtml(tl?.display || claimId)} · n=${escapeHtml(tl?.nDisplay || '暂无')}</p><ul>${events || '<li>暂无事件</li>'}</ul></div>`
            );
          }
        });
        return;
      }
      const saveHoldings = e.target.closest('[data-action="save-portfolio-holdings"]');
      if (saveHoldings) {
        e.preventDefault();
        void savePortfolioHoldingsFromUi(panel);
        return;
      }
      const adoptScout = e.target.closest('[data-action="behavior-adopt-scout"]');
      if (adoptScout) {
        e.preventDefault();
        void handleBehaviorAdoptScout(panel, adoptScout.dataset.instrument, adoptScout.dataset.suggested);
        return;
      }
      const ignorePosture = e.target.closest('[data-action="behavior-ignore-posture"]');
      if (ignorePosture && window.fancheng?.logBehaviorOverride) {
        e.preventDefault();
        void window.fancheng.logBehaviorOverride({
          symbol: ignorePosture.dataset.instrument,
          suggestedPosture: ignorePosture.dataset.suggested,
          userAction: '忽略',
          userPosture: null,
        });
        return;
      }
      const openPreMortem = e.target.closest('[data-action="open-pre-mortem"]');
      if (openPreMortem) {
        e.preventDefault();
        void openPreMortemModal(panel, openPreMortem.dataset.instrument, {
          postureIntent: openPreMortem.dataset.posture || '试仓',
        });
        return;
      }
      const confirmPreMortem = e.target.closest('[data-action="confirm-pre-mortem"]');
      if (confirmPreMortem) {
        e.preventDefault();
        void confirmPreMortemModal(panel);
        return;
      }
      const closePreMortem = e.target.closest('[data-action="close-pre-mortem"]');
      if (closePreMortem) {
        e.preventDefault();
        panel.querySelector('.outlook-pre-mortem-modal')?.classList.add('hidden');
        return;
      }
      const aiChip = e.target.closest('[data-action="ask-fancheng-ai-chip"]');
      if (aiChip) {
        e.preventDefault();
        const instId = aiChip.dataset.instrument || outlookSelectedInstrumentId;
        const question = aiChip.dataset.question || '';
        void handleFanchengAiQuestion(panel, instId, question);
        return;
      }
      const aiSubmit = e.target.closest('[data-action="ask-fancheng-ai-submit"]');
      if (aiSubmit) {
        e.preventDefault();
        const instId = aiSubmit.dataset.instrument || outlookSelectedInstrumentId;
        const input = panel.querySelector(`.outlook-ai-fusion-input[data-instrument="${instId}"]`);
        void handleFanchengAiQuestion(panel, instId, input?.value || '');
        return;
      }
      const scrollAi = e.target.closest('[data-action="scroll-to-ai-fusion"]');
      if (scrollAi) {
        e.preventDefault();
        const id = resolveOutlookInstrumentId(scrollAi.dataset.instrument) || outlookSelectedInstrumentId;
        if (id && id !== outlookSelectedInstrumentId) {
          outlookSelectedInstrumentId = id;
          updateOutlookDetailPanel(panel, id);
        }
        requestAnimationFrame(() => scrollToOutlookAiFusion(panel, id));
        return;
      }
      const poolRow = e.target.closest('[data-action="select-outlook-from-pool"]');
      if (poolRow) {
        e.preventDefault();
        const id = resolveOutlookInstrumentId(poolRow.dataset.instrument);
        if (!id) return;
        outlookSelectedInstrumentId = id;
        updateOutlookDetailPanel(panel, id);
        refreshOutlookAiAssistantHub(panel);
        requestAnimationFrame(() => scrollToOutlookAiFusion(panel, id));
        return;
      }
      const selectBtn = e.target.closest('[data-action="select-outlook-instrument"]');
      if (!selectBtn) return;
      e.preventDefault();
      const row = selectBtn.closest('.outlook-instrument-row');
      const id = row?.dataset?.outlookInstrument;
      if (!id) return;
      outlookSelectedInstrumentId = id;
      if (window.fancheng?.markFocusAnalysisRead) {
        void window.fancheng.markFocusAnalysisRead(id).then(() => {
          void loadFocusDashboard({ generate: true }).then((dash) => {
            if (dash) {
              focusDashboardCache = dash;
              const slot = panel.querySelector('.outlook-focus-dashboard-slot');
              if (slot) slot.innerHTML = renderFocusDashboardSection(dash);
              remountOutlookInstrumentList(panel, window.__outlookCacheInstruments, { immediate: true, skipSkeleton: true });
            }
          });
        });
      }
      updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
      refreshOutlookAiAssistantHub(panel);
    });
    panel.addEventListener('submit', (e) => {
      const painForm = e.target.closest('[data-action="pain-memory-form"]');
      if (!painForm) return;
      e.preventDefault();
      const fd = new FormData(painForm);
      const tagsRaw = fd.get('tags')?.toString().trim();
      const tags = tagsRaw ? tagsRaw.split(/[,，\s]+/).filter(Boolean) : [];
      if (window.fancheng?.addPainEntry) {
        void window.fancheng
          .addPainEntry({
            symbol: fd.get('symbol')?.toString().trim(),
            lesson: fd.get('lesson')?.toString().trim(),
            tags,
          })
          .then(() => {
            painForm.reset();
            window.__outlookDailyBriefAt = 0;
            void loadPainMemoryList(panel);
            void refreshOutlookLive({ force: false });
          });
      }
    });
  }
  void loadPainMemoryList(panel);
  applyOutlookSectorFilter(panel, outlookSectorFilter);
  if (outlookSelectedInstrumentId) updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
  void hydrateOutlookAiFusionHub(panel);
  ensureOutlookHeadlinesAndDashboard(panel);
  bindOutlookHeadlinesListener();
}

function applyOutlookLiveData(source) {
  if (source?.error) {
    window.__outlookLoadError = source.error;
    if (!(source?.instruments?.length || source?.categories?.length)) {
      const cached = getOutlookCachedSource();
      if (cached?.instruments?.length || cached?.categories?.length) return;
    }
    if (isActivePanel('outlook') && !rendererPaused) mountOutlookPanel(source);
    return;
  }
  if (!source?.instruments?.length && !source?.categories?.length) {
    if (source?.computing && getOutlookCachedSource()?.instruments?.length) return;
    return;
  }

  cacheOutlookSource(source);
  if (source.instruments?.length) {
    seedFocusDashboardFromOutlook(source.instruments);
  }

  const stamp = resolveOutlookDisplayStamp(source);
  if (stamp) updateOutlookToolbarStamp(stamp);

  if (!isActivePanel('outlook')) {
    updateNavTabBadge('outlook', source.instruments?.length || source.categories?.length);
    return;
  }
  if (rendererPaused) return;

  const panel = document.getElementById('panel-outlook');
  if (panel?.querySelector('.outlook-panel')) {
    refreshOutlookPanelSectionsDebounced(panel, source);
  } else {
    mountOutlookPanel(source);
  }

  if (source.instruments?.length && shouldProcessOutlookLiveUpdate()) {
    updateOutlookPriceCells(source.instruments, { batch: true, force: true, flash: true });
    refreshOutlookDetailLiveTimestamps();
  } else if (window.__preloadedCommoditiesLive && shouldProcessOutlookLiveUpdate()) {
    applyCommoditiesLiveToOutlook(window.__preloadedCommoditiesLive);
  }
  if (stamp) {
    $('#lastUpdated').textContent = `研判实时 ${formatDate(stamp)}`;
  }
}

function renderPolicyPanel(source) {
  const hasData = source.items?.length;
  const liveTag = source.liveRefreshedAt
    ? `<span class="policy-live-tag policy-live-badge"><span class="policy-live-dot"></span>实时 ${formatDate(source.liveRefreshedAt)}</span>`
    : '';

  if (!hasData) {
    return `<div class="panel ${activeTab === 'policy' ? 'active' : ''}" id="panel-policy" role="tabpanel">
      <div class="empty-state">正在加载政策数据…</div>
    </div>`;
  }

  const filtered = limitDisplayItems(getFilteredPolicyItemsForView(source.items), POLICY_DISPLAY_LIMIT);

  return `<div class="panel ${activeTab === 'policy' ? 'active' : ''}" id="panel-policy" role="tabpanel">
    <div class="policy-panel policy-reading-v2">
      <header class="policy-reading-head">
        <div class="policy-reading-head-main">
          <h2 class="policy-reading-title">${escapeHtml(source.dataLabel || '政策雷达')}</h2>
          ${renderPolicyStatsInline(source.stats, source.items)}
        </div>
        ${liveTag}
      </header>
      <div class="policy-reading-toolbar">
        <div class="policy-toolbar-row">
          <div class="policy-region-bar">
            <button type="button" class="policy-region-btn ${policyFilterRegion === 'all' ? 'active' : ''}" data-region="all">全部</button>
            <button type="button" class="policy-region-btn ${policyFilterRegion === 'cn' ? 'active' : ''}" data-region="cn"><span class="policy-flag">🇨🇳</span>中国</button>
            <button type="button" class="policy-region-btn ${policyFilterRegion === 'us' ? 'active' : ''}" data-region="us"><span class="policy-flag">🇺🇸</span>美国</button>
          </div>
          <div class="policy-filter-group">
            <button type="button" class="policy-filter-btn ${policyMinStars >= 3 ? 'active' : ''}" data-filter="stars3">≥3 星</button>
            <button type="button" class="policy-filter-btn ${policyMinStars >= 4 ? 'active' : ''}" data-filter="stars4">≥4 星</button>
            <button type="button" class="policy-jump-commodity" data-action="jump-commodity">大宗专区 ↓</button>
          </div>
        </div>
        <div class="policy-dept-list">${renderPolicyDeptChips(source)}</div>
      </div>
      ${renderPolicyCommoditySection(source)}
      <div class="policy-view-tabs">${renderPolicyViewTabs(source)}</div>
      ${renderPolicyFeedDivider(source)}
      <div class="policy-reading-scroll ${policyViewMode === 'commodity' ? 'policy-reading-scroll-hidden' : ''}">${policyViewMode === 'commodity' ? '<div class="policy-commodity-view-hint">大宗关联政策见上方专区，可按品种筛选</div>' : renderPolicyReadingList(filtered)}</div>
      <p class="policy-note">数据来源：中国政府网 · 新华社 · 人民网 · SEC · 美联储 · Federal Register · 大宗关联政策独立列示 · Phil·契/异 对照研判环境 · <button type="button" class="btn-link" data-action="open-philosophy">梵澄哲学</button> · 点击条目打开原文 · 星级为系统自动评估</p>
    </div>
  </div>`;
}

function renderForexPanel(source) {
  const hasData = source.pairs?.length || source.groups?.some((g) => g.pairs?.length);
  const liveTag = source.liveRefreshedAt
    ? `<span class="forex-live-tag">实时 ${formatDate(source.liveRefreshedAt)}</span>`
    : '';

  if (!hasData) {
    return `<div class="panel ${activeTab === 'forex' ? 'active' : ''}" id="panel-forex" role="tabpanel">
      <div class="empty-state">暂无外汇数据，请检查网络后刷新</div>
    </div>`;
  }

  const stats = source.stats;
  const statsHtml = stats
    ? `<div class="forex-stats">已加载 ${stats.success} / ${stats.total} 个报价${stats.failed ? `，${stats.failed} 个暂不可用` : ''}</div>`
    : '';

  return `<div class="panel ${activeTab === 'forex' ? 'active' : ''}" id="panel-forex" role="tabpanel">
    <div class="forex-panel">
      <div class="forex-panel-head">
        <h2 class="forex-panel-title">${escapeHtml(source.dataLabel || '外汇实时汇率')}</h2>
        ${liveTag}
      </div>
      ${statsHtml}
      <div class="forex-groups">${renderForexGroups(source)}</div>
      <p class="forex-note">数据来源：新浪财经 · 报价为市场参考价，1 单位美元兑换目标货币数量</p>
    </div>
  </div>`;
}

function renderMacroCategorySections(indicators) {
  if (!indicators?.length) return renderIndicators(indicators);

  const buckets = new Map();
  for (const ind of indicators) {
    const key = ind.category || 'production';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(ind);
  }

  const orderedKeys = [
    ...MACRO_CATEGORY_ORDER.filter((k) => buckets.has(k)),
    ...[...buckets.keys()].filter((k) => !MACRO_CATEGORY_ORDER.includes(k)),
  ];

  if (orderedKeys.length <= 1) return renderIndicators(indicators);

  return orderedKeys
    .map((key) => {
      const label = MACRO_CATEGORY_LABELS[key] || key;
      return `<div class="macro-category">
        <h4 class="macro-category-title">${escapeHtml(label)}</h4>
        ${renderIndicators(buckets.get(key))}
      </div>`;
    })
    .join('');
}

function renderMacroGroups(source) {
  const groups = source.groups || [];
  if (!groups.length) return renderIndicators(source.indicators || []);

  return groups
    .map((group) => {
      const body = renderMacroCategorySections(group.indicators);
      return `<section class="macro-group">
        <h3 class="macro-group-title"><span class="dot ${group.id === 'us' ? 'dot-fed' : 'dot-macro-cn'}"></span>${escapeHtml(group.label)}</h3>
        ${body}
      </section>`;
    })
    .join('');
}

function renderPanel(key, source) {
  if (key === 'policy' && source?.items) {
    window.__policyCacheItems = source.items;
    if (source.commodityIntel) window.__policyCommodityIntel = source.commodityIntel;
  }
  if (key === 'geopolitics' && source?.items) {
    window.__geoCacheItems = source.items;
    window.__geoCacheStats = source.stats;
    window.__geoCacheCatalog = source.catalog;
    window.__geoCountryIndex = source.countryIndex;
  }
  if (key === 'climate' && source?.items) {
    window.__climateCacheItems = source.items;
    window.__climateCacheStats = source.stats;
    window.__climateCacheFramework = source.framework;
  }
  if (key === 'outlook' && (source?.categories?.length || source?.instruments?.length)) {
    cacheOutlookPanelSource(source);
  }
  if (key === 'commodities') return window.CommoditiesUI.renderPanelShell(activeTab);

  if (key === 'macro') {
    const liveTag = source.liveRefreshedAt
      ? `<span class="macro-live-tag">实时 ${formatDate(source.liveRefreshedAt)}</span>`
      : '';
    return `<div class="panel ${key === activeTab ? 'active' : ''}" id="panel-${key}" role="tabpanel">
      <div class="macro-panel">
        <div class="macro-panel-head">
          <h2 class="macro-panel-title">${escapeHtml(source.dataLabel || '中美宏观指标')}</h2>
          ${liveTag}
        </div>
        <p class="macro-philosophy-hint">宏观数据汇入<strong>大宗走势研判</strong>变量层 · 结论随新数据校正 · <button type="button" class="btn-link" data-action="open-philosophy">梵澄哲学</button></p>
        <div class="macro-groups">${renderMacroGroups(source)}</div>
      </div>
    </div>`;
  }

  if (key === 'forex') return renderForexPanel(source);
  if (key === 'policy') return renderPolicyPanel(source);
  if (key === 'geopolitics') return renderGeopoliticsPanel(source);
  if (key === 'climate') return renderClimatePanel(source);
  if (key === 'outlook') {
    if (key !== activeTab) return renderOutlookLazyShell(source);
    return renderOutlookPanel(source);
  }

  if (key === 'boj') {
    return renderCentralBankPanel('boj', source);
  }

  if (key === 'fed') {
    return renderCentralBankPanel('fed', source);
  }

  const hasIndicators = key !== 'xinhua';
  const liveTag =
    (key === 'fed' || key === 'treasury') && source.liveRefreshedAt
      ? `<span class="${key === 'fed' ? 'fed' : 'treasury'}-live-tag">实时 ${formatDate(source.liveRefreshedAt)}</span>`
      : '';
  const indicatorSection = hasIndicators
    ? `<section class="section">
        <div class="section-header"><span class="dot ${DOT_CLASS[key]}"></span>${source.dataLabel || '关键数据'}</div>
        <div class="section-body">${renderIndicators(source.indicators)}</div>
      </section>`
    : '';

  const newsSection = `<section class="section" ${hasIndicators ? '' : 'style="grid-column: 1 / -1"'}>
      <div class="section-header"><span class="dot ${DOT_CLASS[key]}"></span>${hasIndicators ? '最新公告与新闻' : source.dataLabel || '财经要闻'}</div>
      <div class="section-body">${renderNews(source.news)}</div>
    </section>`;

  return `<div class="panel ${key === activeTab ? 'active' : ''}" id="panel-${key}" role="tabpanel">
    ${liveTag ? `<div class="cb-panel-head"><h2 class="cb-panel-title">${escapeHtml(TAB_LABELS[key] || key)}</h2>${liveTag}</div>` : ''}
    <div class="panel-grid" style="${hasIndicators ? '' : 'grid-template-columns: 1fr'}">
      ${indicatorSection}
      ${newsSection}
    </div>
  </div>`;
}

function replaceSinglePanel(key, source) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return false;
  const wasActive = activeTab === key;
  const html = renderPanel(key, source || {});
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  const newPanel = wrap.firstElementChild;
  if (!newPanel) return false;
  panel.replaceWith(newPanel);
  newPanel.classList.toggle('active', wasActive);
  setupNewsItems(newPanel);
  if (key === 'policy') setupPolicyPanel();
  if (key === 'geopolitics') setupGeopoliticsPanel();
  if (key === 'climate') setupClimatePanel();
  if (key === 'outlook') setupOutlookPanel();
  if (key === 'fed') setupCentralBankPanel('fed');
  if (key === 'boj') {
    repatchBojNewsInDom();
    setupCentralBankPanel('boj');
  }
  if (key === 'indices') setupIndexCards();
  if (key === 'fed' || key === 'boj') repatchCbSpeechesInDom(key);
  return true;
}

function updateMacroPanel(source) {
  if (!source?.groups) return;
  const panel = document.getElementById('panel-macro');
  if (!panel) return;
  const groupsEl = panel.querySelector('.macro-groups');
  const liveTag = panel.querySelector('.macro-live-tag');
  if (groupsEl) groupsEl.innerHTML = renderMacroGroups(source);
  const stamp = resolveOutlookDisplayStamp(source);
  if (liveTag && stamp) {
    liveTag.textContent = `实时 ${formatDate(stamp)}`;
  } else if (stamp) {
    panel.querySelector('.macro-panel-head')?.insertAdjacentHTML(
      'beforeend',
      `<span class="macro-live-tag">实时 ${formatDate(stamp)}</span>`
    );
  }
}

function cachePolicySource(source) {
  if (!source?.items?.length) return;
  window.__policyCacheItems = source.items;
  if (source.groups) window.__policyCacheGroups = source.groups;
  if (source.stats) window.__policyCacheStats = source.stats;
  if (source.commodityIntel) window.__policyCommodityIntel = source.commodityIntel;
}

function cacheGeopoliticsSource(source) {
  if (!source?.items?.length) return;
  window.__geoCacheItems = source.items;
  if (source.stats) window.__geoCacheStats = source.stats;
  if (source.catalog) window.__geoCacheCatalog = source.catalog;
  if (source.countryIndex) window.__geoCountryIndex = source.countryIndex;
  if (source.framework) window.__geoCacheFramework = source.framework;
}

function cacheClimateSource(source) {
  if (!source?.items?.length) return;
  window.__climateCacheItems = source.items;
  if (source.stats) window.__climateCacheStats = source.stats;
  if (source.framework) window.__climateCacheFramework = source.framework;
}

function applyIncrementalDataUpdateImpl(data, { fromCache = false } = {}) {
  const sources = data?.sources;
  if (!sources) return;

  if (sources.policy?.items?.length) cachePolicySource(sources.policy);
  if (sources.geopolitics?.items?.length) {
    cacheGeopoliticsSource(sources.geopolitics);
    patchPolicyCommodityIntelFromGeo(sources.geopolitics);
  }
  if (sources.climate?.items?.length) {
    cacheClimateSource(sources.climate);
    patchPolicyCommodityIntelFromClimate(sources.climate);
  }

  if (rendererPaused) {
    if (!isActivePanel('policy') && sources.policy?.items?.length) {
      updateNavTabBadge('policy', sources.policy.items.length);
    }
    if (!isActivePanel('geopolitics') && sources.geopolitics?.items?.length) {
      updateNavTabBadge('geopolitics', sources.geopolitics.items.length);
    }
    if (!isActivePanel('climate') && sources.climate?.items?.length) {
      updateNavTabBadge('climate', sources.climate.items.length);
    }
    if (sources.outlook?.instruments?.length || sources.outlook?.categories?.length) {
      cacheOutlookSource(sources.outlook);
    }
    if (!isActivePanel('outlook') && sources.outlook?.instruments?.length) {
      updateNavTabBadge('outlook', sources.outlook.instruments.length);
    } else if (!isActivePanel('outlook') && sources.outlook?.categories?.length) {
      updateNavTabBadge('outlook', sources.outlook.categories.length);
    }
    pendingRenderData = data;
    return;
  }

  if (!isActivePanel('policy') && sources.policy?.items?.length) {
    updateNavTabBadge('policy', sources.policy.items.length);
  }
  if (!isActivePanel('geopolitics') && sources.geopolitics?.items?.length) {
    updateNavTabBadge('geopolitics', sources.geopolitics.items.length);
  }
  if (!isActivePanel('climate') && sources.climate?.items?.length) {
    updateNavTabBadge('climate', sources.climate.items.length);
  }
  if (sources.outlook?.instruments?.length || sources.outlook?.categories?.length) cacheOutlookSource(sources.outlook);
  if (!isActivePanel('outlook') && sources.outlook?.instruments?.length) {
    updateNavTabBadge('outlook', sources.outlook.instruments.length);
  } else if (!isActivePanel('outlook') && sources.outlook?.categories?.length) {
    updateNavTabBadge('outlook', sources.outlook.categories.length);
  }

  if (hasIndexData(data)) {
    if (isActivePanel('indices')) {
      const panel = document.getElementById('panel-indices');
      if (panel?.querySelector('.index-grid')) {
        updateIndicesCards(sources.indices);
      } else if (panel) {
        replaceSinglePanel('indices', sources.indices);
      }
    } else {
      const count = sources.indices?.regions?.reduce((n, r) => n + (r.indices?.length || 0), 0);
      if (count) updateNavTabBadge('indices', count);
    }
  }

  if (sources.macro?.groups) {
    if (isActivePanel('macro')) {
      const panel = document.getElementById('panel-macro');
      if (panel?.querySelector('.macro-groups')) updateMacroPanel(sources.macro);
      else if (panel) replaceSinglePanel('macro', sources.macro);
    }
  }

  if (sources.forex?.pairs?.length) {
    if (isActivePanel('forex')) {
      const panel = document.getElementById('panel-forex');
      if (panel?.querySelector('.forex-groups')) applyForexLiveData(sources.forex);
      else if (panel) replaceSinglePanel('forex', sources.forex);
    }
  }

  if (sources.policy?.items?.length && isActivePanel('policy')) {
    const panel = document.getElementById('panel-policy');
    if (panel?.querySelector('.policy-reading-v2')) {
      refreshPolicyPanelSectionsDebounced(panel, sources.policy);
    }
  }

  if (sources.geopolitics?.items?.length && isActivePanel('geopolitics')) {
    const panel = document.getElementById('panel-geopolitics');
    if (panel?.querySelector('.geo-reading-scroll')) {
      refreshGeopoliticsPanelSectionsDebounced(panel, sources.geopolitics);
    }
  }

  if (sources.climate?.items?.length && isActivePanel('climate')) {
    const panel = document.getElementById('panel-climate');
    if (panel?.querySelector('.climate-reading-scroll')) {
      refreshClimatePanelSectionsDebounced(panel, sources.climate);
    }
  }

  if (sources.outlook?.instruments?.length || sources.outlook?.categories?.length) {
    if (isActivePanel('outlook')) {
      const panel = document.getElementById('panel-outlook');
      if (panel?.querySelector('.outlook-panel')) {
        refreshOutlookPanelSectionsDebounced(panel, sources.outlook);
      } else {
        mountOutlookPanel(sources.outlook);
      }
    } else {
      cacheOutlookSource(sources.outlook);
      updateNavTabBadge('outlook', sources.outlook.instruments?.length || sources.outlook.categories?.length);
    }
  }

  if (sources.fed && hasCentralBankLivePayload(sources.fed) && isActivePanel('fed')) {
    const panel = document.getElementById('panel-fed');
    if (panel?.querySelector('.cb-reading-v2')) applyFedLiveData(sources.fed);
  }

  if (sources.boj && hasCentralBankLivePayload(sources.boj) && isActivePanel('boj')) {
    const localized = localizeBojSource(sources.boj);
    const panel = document.getElementById('panel-boj');
    if (panel?.querySelector('.cb-reading-v2')) applyBojLiveData(localized);
  }

  if (isActivePanel('treasury') || isActivePanel('xinhua')) {
    for (const key of ['treasury', 'xinhua']) {
      if (!isActivePanel(key)) continue;
      const src = sources[key];
      if (!src?.news?.length && !src?.indicators?.length) continue;
      const panel = document.getElementById(`panel-${key}`);
      if (panel && panel.querySelector('.section')) replaceSinglePanel(key, src);
    }
  }

  if (isActivePanel('policy') && policyViewMode === 'commodity') {
    const policyPanel = document.getElementById('panel-policy');
    if (policyPanel) {
      refreshPolicyPanelSectionsDebounced(policyPanel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
        commodityIntel: window.__policyCommodityIntel,
      });
    }
  }

  if (fromCache) {
    $('#lastUpdated').textContent = hasIndexData(data)
      ? `本地缓存 ${formatDate(data.fetchedAt)} · 点击刷新更新`
      : `正在加载数据… ${formatDate(data.fetchedAt)}`;
  } else if (data.partial && hasIndexData(data)) {
    $('#lastUpdated').textContent = `指数已就绪 ${formatDate(data.fetchedAt)} · 点击刷新加载其余数据`;
  } else if (!fromCache && data.fetchedAt) {
    $('#lastUpdated').textContent = `已更新 ${formatDate(data.fetchedAt)}`;
  }
}

const applyIncrementalDataUpdateThrottled = throttle(
  (data, options) => applyIncrementalDataUpdateImpl(data, options),
  MIN_RENDER_INTERVAL_MS
);

function scheduleIncrementalUpdate(data, options = {}) {
  if (options.immediate) {
    applyIncrementalDataUpdateThrottled.flush(data, options);
    return;
  }
  applyIncrementalDataUpdateThrottled(data, options);
}

function renderStartupPanel(key, source) {
  if (key !== activeTab && key === 'outlook') {
    return renderOutlookLazyShell(source);
  }
  return renderPanel(key, source);
}

function executeRenderAll(data) {
  const panels = $('#panels');
  if (!panels) return;

  let savedCommodities = null;
  let savedOutlook = null;
  const existingCommodities = panels.querySelector('#panel-commodities');
  if (existingCommodities && window.CommoditiesUI?.isListPopulated?.()) {
    savedCommodities = existingCommodities;
    savedCommodities.remove();
  }
  const existingOutlook = panels.querySelector('#panel-outlook');
  const incomingOutlook = data.sources?.outlook;
  const incomingHasOutlook =
    incomingOutlook?.instruments?.length || incomingOutlook?.categories?.length;
  if (
    existingOutlook?.querySelector('.outlook-instrument-row') &&
    !incomingHasOutlook
  ) {
    savedOutlook = existingOutlook;
    savedOutlook.remove();
  } else if (
    activeTab === 'outlook' &&
    !incomingHasOutlook &&
    getOutlookCachedSource()?.instruments?.length
  ) {
    data = {
      ...data,
      sources: {
        ...data.sources,
        outlook: getOutlookCachedSource(),
      },
    };
  }

  panels.innerHTML = TAB_KEYS.map((key) => {
    if (key === 'outlook' && savedOutlook) {
      return renderOutlookPlaceholder({});
    }
    return renderStartupPanel(key, data.sources[key] || {});
  }).join('');
  panels.classList.remove('hidden');
  panelsInitialized = true;

  if (savedCommodities) {
    const placeholder = panels.querySelector('#panel-commodities');
    if (placeholder) placeholder.replaceWith(savedCommodities);
    savedCommodities.classList.toggle('active', activeTab === 'commodities');
  }

  if (savedOutlook) {
    const placeholder = panels.querySelector('#panel-outlook');
    if (placeholder) placeholder.replaceWith(savedOutlook);
    savedOutlook.classList.toggle('active', activeTab === 'outlook');
  }

  setupNewsItems(panels);
  repatchBojNewsInDom();
  repatchCbSpeechesInDom('fed');
  repatchCbSpeechesInDom('boj');

  setupIndexCards();
  setupHistorySection();
  wireDeferredPanelSetup();
}

function renderAll(data, { immediate = false } = {}) {
  if (rendererPaused) {
    pendingRenderData = data;
    return;
  }
  pendingRenderData = data;
  const run = () => {
    renderAllScheduled = false;
    if (renderAllThrottleTimer) {
      clearTimeout(renderAllThrottleTimer);
      renderAllThrottleTimer = null;
    }
    const payload = pendingRenderData;
    pendingRenderData = null;
    if (payload) executeRenderAll(payload);
  };
  if (immediate) {
    run();
    return;
  }
  if (renderAllScheduled) return;
  const elapsed = Date.now() - lastIncrementalRenderAt;
  if (elapsed >= MIN_RENDER_INTERVAL_MS) {
    renderAllScheduled = true;
    lastIncrementalRenderAt = Date.now();
    scheduleRafWork(run);
    return;
  }
  renderAllScheduled = true;
  renderAllThrottleTimer = setTimeout(() => {
    lastIncrementalRenderAt = Date.now();
    scheduleRafWork(run);
  }, MIN_RENDER_INTERVAL_MS - elapsed);
}

function setupIndexCards() {
  $$('.index-card-clickable').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.indexId;
      if (id) selectHistoryIndex(id);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectHistoryIndex(card.dataset.indexId);
      }
    });
  });
}

async function setupHistorySection() {
  try {
    historyIndexList = await window.fancheng.listIndicesHistory();
  } catch {
    historyIndexList = [];
  }

  const select = $('#historySelect');
  if (!select) return;

  select.innerHTML = historyIndexList
    .map(
      (i) =>
        `<option value="${escapeAttr(i.id)}" ${i.id === selectedIndexId ? 'selected' : ''}>${escapeHtml(i.name)}（${escapeHtml(i.market)}）</option>`
    )
    .join('');

  select.onchange = () => selectHistoryIndex(select.value);
  setupKlineTabs();
  await loadIndexHistory(selectedIndexId, selectedTimeframe);
}

function setupKlineTabs() {
  $$('.kline-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedTimeframe = btn.dataset.tf;
      $$('.kline-tab').forEach((b) => b.classList.toggle('active', b.dataset.tf === selectedTimeframe));
      klineOffset = 0;
      loadIndexHistory(selectedIndexId, selectedTimeframe);
    });
  });
  $$('.kline-tab').forEach((b) => b.classList.toggle('active', b.dataset.tf === selectedTimeframe));

  const slider = $('#klineScroll');
  if (slider) {
    slider.addEventListener('input', () => {
      klineOffset = parseInt(slider.value, 10) || 0;
      renderKlineChart();
    });
  }
}

function selectHistoryIndex(indexId) {
  if (!indexId) return;
  selectedIndexId = indexId;
  klineOffset = 0;
  const select = $('#historySelect');
  if (select) select.value = indexId;
  $$('.index-card-clickable').forEach((c) =>
    c.classList.toggle('index-card-active', c.dataset.indexId === indexId)
  );
  loadIndexHistory(indexId, selectedTimeframe);
}

function cacheKey(indexId, timeframe) {
  return `${indexId}:${timeframe}`;
}

function renderKlineChart() {
  const chartEl = $('#historyChart');
  if (!chartEl || !currentKlines.length) return;

  const maxOffset = Math.max(0, currentKlines.length - klineViewCount);
  if (klineOffset > maxOffset) klineOffset = maxOffset;

  drawKlineChart(chartEl, currentKlines, {
    height: 380,
    viewCount: klineViewCount,
    offset: klineOffset,
  });

  const slider = $('#klineScroll');
  const label = $('#klineScrollLabel');
  if (slider) {
    slider.max = String(maxOffset);
    slider.value = String(klineOffset);
  }
  if (label && currentKlines.length) {
    const start = currentKlines[klineOffset]?.date || '';
    const endIdx = Math.min(klineOffset + klineViewCount - 1, currentKlines.length - 1);
    const end = currentKlines[endIdx]?.date || '';
    label.textContent = `${start} → ${end}（共 ${currentKlines.length} 根）`;
  }
}

function renderKlineTable(klines) {
  const wrap = $('#klineTableWrap');
  const table = $('#klineTable');
  if (!table) return;
  wrap?.querySelector('.kline-table-note')?.remove();
  const rows = [...klines].reverse().slice(0, 500);
  table.innerHTML = `<thead><tr>
    <th>时间</th><th>开盘</th><th>最高</th><th>最低</th><th>收盘</th><th>成交量</th>
  </tr></thead><tbody>${rows
    .map(
      (b) => `<tr>
        <td>${escapeHtml(b.date)}</td>
        <td>${formatNumber(b.open, 2)}</td>
        <td>${formatNumber(b.high, 2)}</td>
        <td>${formatNumber(b.low, 2)}</td>
        <td>${formatNumber(b.close, 2)}</td>
        <td>${formatNumber(b.volume, 0)}</td>
      </tr>`
    )
    .join('')}</tbody>`;
  if (klines.length > 500 && wrap) {
    wrap.insertAdjacentHTML(
      'beforeend',
      `<p class="kline-table-note">表格展示最近 500 条，完整数据共 ${klines.length} 条（可通过导出查看全部）</p>`
    );
  }
}

async function loadIndexHistory(indexId, timeframe = selectedTimeframe) {
  const chartEl = $('#historyChart');
  const summaryEl = $('#historySummary');
  if (!chartEl) return;

  chartEl.innerHTML = '<div class="chart-loading">正在加载K线数据（数据量较大，请稍候）…</div>';
  if (summaryEl) summaryEl.innerHTML = '';

  const oldNote = document.querySelector('.kline-table-note');
  if (oldNote) oldNote.remove();

  try {
    const key = cacheKey(indexId, timeframe);
    let data = historyCache[key];
    if (!data) {
      data = await window.fancheng.fetchIndexHistory(indexId, timeframe);
      if (data.error) throw new Error(data.error);
      historyCache[key] = data;
    }

    currentKlines = data.klines || [];
    applyKlineData(data, false);
  } catch (err) {
    currentKlines = [];
    chartEl.innerHTML = `<div class="chart-empty">${escapeHtml(localizeUiMessage(err.message))}</div>`;
  }
}

function showErrors(errors) {
  const banner = $('#errorBanner');
  if (!errors?.length) {
    banner.classList.add('hidden');
    banner.classList.remove('warning-banner');
    banner.classList.add('error-banner');
    return;
  }
  banner.textContent = `部分数据源获取失败：${errors.map((e) => `${TAB_LABELS[e.key] || e.key}（${localizeUiMessage(e.message)}）`).join('；')}`;
  banner.classList.remove('error-banner');
  banner.classList.add('warning-banner');
  banner.classList.remove('hidden');
}

let isLoadingData = false;
let indicesLoading = true;
let indicesRendered = false;
let loadingSafetyTimer = null;

function finishLoading(silent) {
  isLoadingData = false;
  if (loadingSafetyTimer) {
    clearTimeout(loadingSafetyTimer);
    loadingSafetyTimer = null;
  }
  if (!silent) {
    $('#loading')?.classList.add('hidden');
    const btn = $('#refreshBtn');
    if (btn) btn.disabled = false;
  }
}

function emptySources() {
  return {
    indices: {
      regions: [],
      indexStats: { total: 0, success: 0, failed: 0 },
      dataLabel: '主流大盘指数',
    },
    macro: { news: [], indicators: [], groups: [], dataLabel: '投资决策核心宏观指标' },
    forex: { news: [], indicators: [], groups: [], pairs: [], dataLabel: '美元指数与主要货币对实时汇率' },
    policy: { news: [], indicators: [], groups: [], items: [], dataLabel: '中美部委政策与产业影响雷达' },
    geopolitics: { news: [], indicators: [], items: [], dataLabel: '全球地缘政治与四维竞争雷达' },
    climate: { news: [], indicators: [], items: [], dataLabel: '全球天气气候与大宗传导雷达' },
    fed: { news: [], indicators: [], dataLabel: '关键经济指标（圣路易斯联储）' },
    boj: { news: [], indicators: [], dataLabel: '日本货币政策与核心指标（日本央行 · FRED · 新浪）' },
    treasury: { news: [], indicators: [], dataLabel: '国债与汇率参考' },
    xinhua: { news: [], dataLabel: '财经要闻' },
  };
}

function hideLoadingOverlay() {
  $('#loading')?.classList.add('hidden');
  const btn = $('#refreshBtn');
  if (btn) btn.disabled = false;
  isLoadingData = false;
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function hasIndexData(data) {
  return Boolean(data?.sources?.indices?.regions?.some((r) => r.indices?.length));
}

function buildDataFromIndices(indices, cfg = {}) {
  return {
    sources: {
      ...emptySources(),
      indices: {
        key: 'indices',
        name: '全球指数',
        news: [],
        indicators: [],
        regions: indices.regions || [],
        indexStats: indices.indexStats,
        dataLabel: '主流大盘指数',
        updatedAt: indices.updatedAt || new Date().toISOString(),
      },
    },
    errors: [],
    fetchedAt: indices.fetchedAt || new Date().toISOString(),
    fredApiKeyConfigured: Boolean(cfg.fredApiKeyConfigured),
    partial: true,
  };
}

function showIndicesLoading() {
  indicesLoading = true;
  const panels = $('#panels');
  if (!panels) return;
  panels.classList.remove('hidden');
  panels.innerHTML = `<div class="panel active" id="panel-indices" role="tabpanel">
    <div class="empty-state index-empty"><div class="spinner inline-spinner"></div> 正在加载指数…</div>
  </div>`;
}

function applyStartupDataSafe(data, options = {}) {
  try {
    applyStartupData(data, options);
    if (hasIndexData(data)) {
      indicesRendered = true;
      hideLoadingOverlay();
    }
    return true;
  } catch (err) {
    console.error('applyStartupData failed', err);
    try {
      if (hasIndexData(data)) {
        const panels = $('#panels');
        if (panels) {
          panels.classList.remove('hidden');
          panels.innerHTML = TAB_KEYS.map((key) =>
            key === 'indices' ? renderIndicesPanel(data.sources.indices) : `<div class="panel" id="panel-${key}"></div>`
          ).join('');
          setupIndexCards();
          indicesLoading = false;
          indicesRendered = true;
          panelsInitialized = true;
          return true;
        }
      }
    } catch (fallbackErr) {
      console.error('indices fallback failed', fallbackErr);
    }
    $('#errorBanner').textContent = `界面渲染失败：${localizeUiMessage(err.message)}`;
    $('#errorBanner').classList.remove('hidden');
    return false;
  }
}

function waitForStartupPush(timeoutMs = 800) {
  return new Promise((resolve) => {
    if (typeof window.fancheng?.onStartupData !== 'function') {
      resolve(null);
      return;
    }
    let settled = false;
    const off = window.fancheng.onStartupData((payload) => {
      if (settled) return;
      settled = true;
      off?.();
      resolve(payload);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      off?.();
      resolve(null);
    }, timeoutMs);
  });
}

function applyStartupData(data, { fromCache = false, forceFullRender = false } = {}) {
  const prevIndex = selectedIndexId;
  const prevTf = selectedTimeframe;

  if (data?.sources) {
    window.__startupSources = { ...(window.__startupSources || {}), ...data.sources };
  }
  if (window.__preloadedCommoditiesLive?.exchanges?.length) {
    window.__startupSources = {
      ...(window.__startupSources || {}),
      commodities: window.__preloadedCommoditiesLive,
    };
  }

  if (hasIndexData(data)) indicesLoading = false;

  if (data?.sources?.boj) {
    data = {
      ...data,
      sources: {
        ...data.sources,
        boj: localizeBojSource(data.sources.boj),
      },
    };
  }

  if (panelsInitialized && !forceFullRender) {
    scheduleIncrementalUpdate(data, { fromCache });
  } else {
    renderAll(data, { immediate: forceFullRender });
  }
  showErrors(data.errors || []);

  if (data?.sources?.fed && !data.sources.fed.speeches?.length) {
    refreshFedLive();
  }
  if (data?.sources?.boj && !data.sources.boj.speeches?.length) {
    refreshBojLive();
  }

  selectedIndexId = prevIndex;
  selectedTimeframe = prevTf;

  const indicesReady = hasIndexData(data);

  if (fromCache) {
    $('#lastUpdated').textContent = indicesReady
      ? `本地缓存 · 点击刷新更新`
      : `正在加载数据… ${formatDate(data.fetchedAt)}`;
  } else if (data.partial && indicesReady) {
    $('#lastUpdated').textContent = `指数已就绪 ${formatDate(data.fetchedAt)} · 其余数据后台加载中…`;
  } else if (data.partial) {
    $('#lastUpdated').textContent = `正在加载指数… ${formatDate(data.fetchedAt)}`;
  } else {
    $('#lastUpdated').textContent = indicesReady
      ? `全量更新 ${formatDate(data.fetchedAt)}`
      : `更新完成 ${formatDate(data.fetchedAt)} · 部分指数暂不可用`;
  }

  const hint = $('#fredHint');
  if (!data.fredApiKeyConfigured) {
    hint.innerHTML = '美联储指标需配置数据接口密钥 · <a id="openSettingsLink">点击设置</a>';
    $('#openSettingsLink')?.addEventListener('click', openSettings);
  } else {
    hint.textContent = '美联储经济数据已连接';
  }
}

async function loadData(silent = false, { force = false } = {}) {
  if (isLoadingData && !force) return;
  const btn = $('#refreshBtn');

  if (force && !silent) {
    isLoadingData = true;
    btn.disabled = true;
    $('#loading').classList.remove('hidden');
    $('#loading p').textContent = '正在刷新…';
    loadingSafetyTimer = setTimeout(() => finishLoading(false), 15000);
  }

  await fetchDataInBackground(force);

  if (force && !silent) finishLoading(false);
}

function applyForexLiveData(forex) {
  if (!forex?.pairs?.length || !isActivePanel('forex')) return;
  const panel = document.getElementById('panel-forex');
  if (!panel) return;

  let updated = 0;
  for (const pair of forex.pairs) {
    const card = panel.querySelector(`[data-forex-id="${pair.id}"]`);
    if (!card) continue;
    updated += 1;
    const digits = pair.decimals ?? (pair.price >= 100 ? 2 : 4);
    const up = pair.change >= 0;
    const changeClass = up ? 'change-up' : 'change-down';
    const arrow = up ? '▲' : '▼';
    const timeLabel = pair.quoteTime ? ` ${pair.quoteTime}` : '';

    const priceEl = card.querySelector('.forex-price');
    const changeEl = card.querySelector('.forex-change');
    const metaEl = card.querySelector('.forex-meta');
    if (priceEl) priceEl.textContent = formatNumber(pair.price, digits);
    if (changeEl) {
      changeEl.className = `forex-change ${changeClass}`;
      changeEl.innerHTML = `${arrow} ${formatNumber(Math.abs(pair.change), digits)}
      <span class="forex-pct">（${up ? '+' : ''}${formatNumber(pair.changePct, 2)}%）</span>`;
    }
    if (metaEl) {
      metaEl.textContent = `${pair.tradeDate ? String(pair.tradeDate).slice(0, 10) : ''}${timeLabel}`;
    }
    card.classList.add('forex-card-flash');
    setTimeout(() => card.classList.remove('forex-card-flash'), 600);
  }

  if (!updated) {
    const groupsEl = panel.querySelector('.forex-groups');
    if (groupsEl) groupsEl.innerHTML = renderForexGroups(forex);
  }

  const liveTag = panel.querySelector('.forex-live-tag');
  const stamp = forex.liveRefreshedAt || forex.fetchedAt || new Date().toISOString();
  if (liveTag) {
    liveTag.textContent = `实时 ${formatDate(stamp)}`;
  } else {
    panel.querySelector('.forex-panel-head')?.insertAdjacentHTML(
      'beforeend',
      `<span class="forex-live-tag">实时 ${formatDate(stamp)}</span>`
    );
  }

  if (activeTab === 'forex') {
    $('#lastUpdated').textContent = `外汇实时 ${formatDate(stamp)}`;
  }
}

function stopPolicyLiveTimer() {
  if (policyLiveTimer) clearInterval(policyLiveTimer);
  policyLiveTimer = null;
}

function startPolicyLiveTimer() {
  stopPolicyLiveTimer();
  if (activeTab !== 'policy') return;
  refreshPolicyLive();
  policyLiveTimer = setInterval(refreshPolicyLive, policyRefreshMs);
}

function applyPolicyLiveData(source) {
  const panel = document.getElementById('panel-policy');
  if (!panel || !source?.items?.length || !isActivePanel('policy') || !shouldProcessLiveDomUpdate()) return;

  const prevIds = window.__policyKnownIds || new Set();
  const newIds = new Set();
  for (const item of source.items) {
    if (!prevIds.has(item.id)) newIds.add(item.id);
  }
  window.__policyKnownIds = new Set(source.items.map((i) => i.id));
  window.__policyCacheItems = source.items;
  window.__policyCacheGroups = source.groups;
  window.__policyCacheStats = source.stats;
  if (source.commodityIntel) window.__policyCommodityIntel = source.commodityIntel;

  refreshPolicyPanelSectionsDebounced(panel, source);

  const stamp = resolveOutlookDisplayStamp(source);
  const liveTag = panel.querySelector('.policy-live-tag');
  if (liveTag && stamp) {
    liveTag.innerHTML = `<span class="policy-live-dot"></span>实时 ${formatDate(stamp)}`;
  } else if (stamp) {
    panel.querySelector('.policy-reading-head')?.insertAdjacentHTML(
      'beforeend',
      `<span class="policy-live-tag policy-live-badge"><span class="policy-live-dot"></span>实时 ${formatDate(stamp)}</span>`
    );
  }

  if (newIds.size && prevIds.size) {
    panel.querySelectorAll('.policy-reading-row, .policy-commodity-row').forEach((card) => {
      if (newIds.has(card.dataset.policyId)) {
        card.classList.add('policy-card-new');
        setTimeout(() => card.classList.remove('policy-card-new'), 2500);
      }
    });
  }

  if (activeTab === 'policy' && stamp) {
    $('#lastUpdated').textContent = `政策实时 ${formatDate(stamp)}`;
  }
}

async function refreshPolicyLive() {
  if (!window.fancheng?.fetchPolicyLive) return;
  try {
    const policy = await window.fancheng.fetchPolicyLive({ force: true });
    if (policy?.error || !policy?.items?.length) return;
    applyPolicyLiveData(policy);
  } catch {
    // 静默
  }
}

function setupPolicyPanel() {
  const panel = document.getElementById('panel-policy');
  if (!panel || panel.dataset.policyBound === '1') return;
  panel.dataset.policyBound = '1';

  panel.addEventListener('click', (e) => {
    const jumpBtn = e.target.closest('[data-action="jump-commodity"]');
    if (jumpBtn) {
      scrollPolicyCommodityZone(panel, { switchView: false });
      return;
    }

    const regionBtn = e.target.closest('.policy-region-btn');
    if (regionBtn) {
      policyFilterRegion = regionBtn.dataset.region || 'all';
      policyFilterDept = 'all';
      policyFilterCommodityId = 'all';
      panel.querySelectorAll('.policy-region-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.region === policyFilterRegion)
      );
      refreshPolicyPanelSectionsDebounced(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
      });
      return;
    }

    const deptBtn = e.target.closest('.policy-dept-btn');
    if (deptBtn) {
      policyFilterDept = deptBtn.dataset.dept || 'all';
      panel.querySelectorAll('.policy-dept-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.dept === policyFilterDept)
      );
      refreshPolicyPanelSectionsDebounced(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
      });
      return;
    }

    const filterBtn = e.target.closest('.policy-filter-btn');
    if (filterBtn) {
      const filter = filterBtn.dataset.filter;
      if (filter === 'stars3') policyMinStars = policyMinStars >= 3 ? 0 : 3;
      else if (filter === 'stars4') policyMinStars = policyMinStars >= 4 ? 0 : 4;
      panel.querySelectorAll('.policy-filter-btn').forEach((b) => {
        const f = b.dataset.filter;
        b.classList.toggle('active', (f === 'stars3' && policyMinStars >= 3) || (f === 'stars4' && policyMinStars >= 4));
      });
      refreshPolicyPanelSectionsDebounced(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
      });
      return;
    }

    const viewBtn = e.target.closest('.policy-view-tab');
    if (viewBtn) {
      policyViewMode = viewBtn.dataset.view || 'all';
      if (policyViewMode === 'commodity') {
        scrollPolicyCommodityZone(panel);
        return;
      }
      policyFilterCommodityId = 'all';
      refreshPolicyPanelSectionsDebounced(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
      });
      return;
    }

    const refreshNewsBtn = e.target.closest('[data-action="refresh-commodity-news"]');
    if (refreshNewsBtn) {
      const id = refreshNewsBtn.dataset.commodity;
      if (id) loadPolicyCommodityNews(id, { force: true });
      return;
    }

    const exchangeBtn = e.target.closest('.policy-exchange-tab');
    if (exchangeBtn) {
      policyCommodityExchangeFilter = exchangeBtn.dataset.exchange || 'shfe';
      const catalog = buildFullCommodityCatalog({
        items: window.__policyCacheItems,
        commodityIntel: window.__policyCommodityIntel,
      });
      const filtered = catalog.filter((c) => c.exchangeId === policyCommodityExchangeFilter);
      if (filtered.length) {
        policyFilterCommodityId = filtered[0].id;
        loadPolicyCommodityNews(filtered[0].id);
      }
      refreshPolicyPanelSectionsDebounced(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
        commodityIntel: window.__policyCommodityIntel,
      });
      return;
    }

    const chipBtn = e.target.closest('.policy-commodity-chip');
    if (chipBtn) {
      const id = chipBtn.dataset.commodity;
      if (!id) return;
      policyFilterCommodityId = id;
      const meta = buildFullCommodityCatalog({ items: window.__policyCacheItems }).find(
        (c) => normCommodityId(c.id) === normCommodityId(id)
      );
      if (meta?.exchangeId) policyCommodityExchangeFilter = meta.exchangeId;
      loadPolicyCommodityNews(id);
      refreshPolicyPanelSectionsDebounced(panel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
        commodityIntel: window.__policyCommodityIntel,
      });
      return;
    }

    const commodityTag = e.target.closest('.policy-tag-commodity, .policy-commodity-badge');
    if (commodityTag) {
      e.stopPropagation();
      const id = commodityTag.dataset.commodityId;
      if (id) {
        switchTab('commodities');
        window.CommoditiesUI?.focusCommodity?.(id);
      }
      return;
    }

    const row = e.target.closest('.policy-reading-row, .policy-card, .policy-commodity-row');
    if (row?.dataset.link) window.fancheng.openExternal(row.dataset.link);
  });
}

function stopGeopoliticsLiveTimer() {
  if (geoLiveTimer) clearInterval(geoLiveTimer);
  geoLiveTimer = null;
}

function startGeopoliticsLiveTimer() {
  stopGeopoliticsLiveTimer();
  if (activeTab !== 'geopolitics') return;
  refreshGeopoliticsLive();
  geoLiveTimer = setInterval(refreshGeopoliticsLive, policyRefreshMs);
}

function applyGeopoliticsLiveData(source) {
  if (!source?.items?.length) return;

  window.__geoCacheItems = source.items;
  window.__geoCacheStats = source.stats;
  window.__geoCacheCatalog = source.catalog;
  window.__geoCountryIndex = source.countryIndex;
  window.__geoCacheFramework = source.framework;
  patchPolicyCommodityIntelFromGeo(source);

  if (!isActivePanel('geopolitics')) {
    updateNavTabBadge('geopolitics', source.items.length);
    return;
  }
  if (rendererPaused || scrollInteractionActive) return;

  const panel = document.getElementById('panel-geopolitics');
  if (panel) refreshGeopoliticsPanelSectionsDebounced(panel, source);

  const stamp = resolveOutlookDisplayStamp(source);
  const liveTag = panel?.querySelector('.geo-live-tag');
  if (liveTag && stamp) {
    liveTag.innerHTML = `<span class="policy-live-dot"></span>实时 ${formatDate(stamp)}`;
  }

  if (stamp) {
    $('#lastUpdated').textContent = `地缘实时 ${formatDate(stamp)}`;
  }

  if (isActivePanel('policy') && policyViewMode === 'commodity') {
    const policyPanel = document.getElementById('panel-policy');
    if (policyPanel) {
      refreshPolicyPanelSectionsDebounced(policyPanel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
        commodityIntel: window.__policyCommodityIntel,
      });
    }
  }
}

async function refreshGeopoliticsLive() {
  if (!window.fancheng?.fetchGeopoliticsLive) return;
  try {
    const geo = await window.fancheng.fetchGeopoliticsLive({ force: true });
    if (geo?.error || !geo?.items?.length) return;
    applyGeopoliticsLiveData(geo);
  } catch {
    // 静默
  }
}

function setupGeopoliticsPanel() {
  const panel = document.getElementById('panel-geopolitics');
  if (!panel || panel.dataset.geoBound === '1') return;
  panel.dataset.geoBound = '1';

  panel.addEventListener('click', (e) => {
    const regionBtn = e.target.closest('[data-geo-region]');
    if (regionBtn) {
      geoFilterRegion = regionBtn.dataset.geoRegion || 'all';
      geoFilterCountry = 'all';
      refreshGeopoliticsPanelSectionsDebounced(panel);
      return;
    }

    const dimBtn = e.target.closest('[data-geo-dimension]');
    if (dimBtn) {
      geoFilterDimension = dimBtn.dataset.geoDimension || 'all';
      refreshGeopoliticsPanelSectionsDebounced(panel);
      return;
    }

    const countryBtn = e.target.closest('[data-geo-country]');
    if (countryBtn && !e.target.closest('.geo-catalog-table')) {
      geoFilterCountry = countryBtn.dataset.geoCountry || 'all';
      if (geoViewMode === 'catalog' && countryBtn.classList.contains('geo-catalog-filter-btn')) {
        geoViewMode = 'all';
      }
      panel.querySelectorAll('.geo-country-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.geoCountry === geoFilterCountry)
      );
      refreshGeopoliticsPanelSectionsDebounced(panel);
      return;
    }

    const filterBtn = e.target.closest('[data-geo-filter]');
    if (filterBtn) {
      const filter = filterBtn.dataset.geoFilter;
      if (filter === 'stars3') geoMinStars = geoMinStars >= 3 ? 0 : 3;
      else if (filter === 'stars4') geoMinStars = geoMinStars >= 4 ? 0 : 4;
      panel.querySelectorAll('[data-geo-filter]').forEach((b) => {
        const f = b.dataset.geoFilter;
        b.classList.toggle('active', (f === 'stars3' && geoMinStars >= 3) || (f === 'stars4' && geoMinStars >= 4));
      });
      refreshGeopoliticsPanelSectionsDebounced(panel);
      return;
    }

    const viewBtn = e.target.closest('[data-geo-view]');
    if (viewBtn) {
      geoViewMode = viewBtn.dataset.geoView || 'all';
      refreshGeopoliticsPanelSectionsDebounced(panel);
      return;
    }

    const catalogBtn = e.target.closest('.geo-catalog-filter-btn');
    if (catalogBtn) {
      geoFilterCountry = catalogBtn.dataset.geoCountry || 'all';
      geoViewMode = 'all';
      refreshGeopoliticsPanelSectionsDebounced(panel);
      return;
    }

    const geoCommodityTag = e.target.closest('.geo-commodity-tag');
    if (geoCommodityTag) {
      e.stopPropagation();
      jumpPolicyCommodityFromGeo(geoCommodityTag.dataset.commodityId);
      return;
    }

    const row = e.target.closest('.geo-reading-row');
    if (row?.dataset.link) window.fancheng.openExternal(row.dataset.link);
  });
}

function stopClimateLiveTimer() {
  if (climateLiveTimer) clearInterval(climateLiveTimer);
  climateLiveTimer = null;
}

function startClimateLiveTimer() {
  stopClimateLiveTimer();
  if (activeTab !== 'climate') return;
  refreshClimateLive();
  climateLiveTimer = setInterval(refreshClimateLive, policyRefreshMs);
}

function applyClimateLiveData(source) {
  if (!source?.items?.length) return;

  window.__climateCacheItems = source.items;
  window.__climateCacheStats = source.stats;
  window.__climateCacheFramework = source.framework;
  patchPolicyCommodityIntelFromClimate(source);

  if (!isActivePanel('climate')) {
    updateNavTabBadge('climate', source.items.length);
    return;
  }
  if (rendererPaused || scrollInteractionActive) return;

  const panel = document.getElementById('panel-climate');
  if (panel) refreshClimatePanelSectionsDebounced(panel, source);

  const stamp = resolveOutlookDisplayStamp(source);
  const liveTag = panel?.querySelector('.climate-live-tag');
  if (liveTag && stamp) {
    liveTag.innerHTML = `<span class="policy-live-dot"></span>实时 ${formatDate(stamp)}`;
  }

  if (stamp) {
    $('#lastUpdated').textContent = `气候实时 ${formatDate(stamp)}`;
  }

  if (isActivePanel('policy') && policyViewMode === 'commodity') {
    const policyPanel = document.getElementById('panel-policy');
    if (policyPanel) {
      refreshPolicyPanelSectionsDebounced(policyPanel, {
        items: window.__policyCacheItems || [],
        groups: window.__policyCacheGroups || [],
        stats: window.__policyCacheStats,
        commodityIntel: window.__policyCommodityIntel,
      });
    }
  }
}

async function refreshClimateLive() {
  if (!window.fancheng?.fetchClimateLive) return;
  try {
    const climate = await window.fancheng.fetchClimateLive({ force: true });
    if (climate?.error || !climate?.items?.length) return;
    applyClimateLiveData(climate);
  } catch {
    // 静默
  }
}

function setupClimatePanel() {
  const panel = document.getElementById('panel-climate');
  if (!panel || panel.dataset.climateBound === '1') return;
  panel.dataset.climateBound = '1';

  panel.addEventListener('click', (e) => {
    const regionBtn = e.target.closest('[data-climate-region]');
    if (regionBtn) {
      climateFilterRegion = regionBtn.dataset.climateRegion || 'all';
      refreshClimatePanelSectionsDebounced(panel);
      return;
    }

    const catBtn = e.target.closest('[data-climate-category]');
    if (catBtn) {
      climateFilterCategory = catBtn.dataset.climateCategory || 'all';
      refreshClimatePanelSectionsDebounced(panel);
      return;
    }

    const filterBtn = e.target.closest('[data-climate-filter]');
    if (filterBtn) {
      const filter = filterBtn.dataset.climateFilter;
      if (filter === 'stars3') climateMinStars = climateMinStars >= 3 ? 0 : 3;
      else if (filter === 'stars4') climateMinStars = climateMinStars >= 4 ? 0 : 4;
      panel.querySelectorAll('[data-climate-filter]').forEach((b) => {
        const f = b.dataset.climateFilter;
        b.classList.toggle(
          'active',
          (f === 'stars3' && climateMinStars >= 3) || (f === 'stars4' && climateMinStars >= 4)
        );
      });
      refreshClimatePanelSectionsDebounced(panel);
      return;
    }

    const viewBtn = e.target.closest('[data-climate-view]');
    if (viewBtn) {
      climateViewMode = viewBtn.dataset.climateView || 'all';
      refreshClimatePanelSectionsDebounced(panel);
      return;
    }

    const commodityTag = e.target.closest('.climate-commodity-tag');
    if (commodityTag) {
      e.stopPropagation();
      jumpPolicyCommodityFromClimate(commodityTag.dataset.commodityId);
      return;
    }

    const row = e.target.closest('.climate-reading-row');
    if (row?.dataset.link) window.fancheng.openExternal(row.dataset.link);
  });
}

function stopOutlookLiveTimer() {
  if (outlookLiveTimer) clearInterval(outlookLiveTimer);
  outlookLiveTimer = null;
}

function startOutlookLiveTimer(options = {}) {
  stopOutlookLiveTimer();
  if (activeTab !== 'outlook') return;
  outlookLastFullRefreshAt = Date.now();
  const firstRefresh = () => scheduleIdleWork(() => void refreshOutlookLive({ force: false }));
  if (options.deferFirstRefresh) {
    setTimeout(firstRefresh, 8000);
  } else {
    scheduleIdleWork(firstRefresh);
  }
  outlookLiveTimer = setInterval(() => {
    if (document.hidden || activeTab !== 'outlook' || rendererPaused) return;
    const needFull = Date.now() - outlookLastFullRefreshAt > OUTLOOK_FULL_REFRESH_MS;
    scheduleIdleWork(() => {
      void refreshOutlookLive({ force: needFull }).then(() => {
        if (needFull) outlookLastFullRefreshAt = Date.now();
      });
    });
  }, OUTLOOK_LIGHT_REFRESH_MS);
}

function stopForexLiveTimer() {
  if (forexLiveTimer) clearInterval(forexLiveTimer);
  forexLiveTimer = null;
}

function startForexLiveTimer() {
  stopForexLiveTimer();
  if (activeTab !== 'forex') return;
  refreshForexLive();
  forexLiveTimer = setInterval(refreshForexLive, forexRefreshMs);
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  // v1.34.11: full loadData auto-refresh disabled — manual refresh button only
  liveRefreshTimer = setInterval(() => {
    if (document.hidden || rendererPaused || activeTab !== 'macro') return;
    refreshMacroLive();
  }, MACRO_LIVE_INTERVAL_MS);
}

function switchTab(key) {
  if (key === activeTab) return;
  if (activeTab === 'outlook' && key !== 'outlook') {
    stopOutlookLiveTimer();
  }
  if (activeTab === 'commodities' && key !== 'commodities') {
    window.CommoditiesUI?.onTabHidden?.();
  }
  cancelPendingPanelRenders();
  activeTab = key;
  notifyRendererState({ activeTab: key });
  updateNavTabBadge(key, null);
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === key));
  let panel = document.getElementById(`panel-${key}`);
  if (!panel && key !== 'indices') {
    const panels = $('#panels');
    if (panels) {
      panels.classList.remove('hidden');
      const placeholder = renderPanel(key, {});
      panels.insertAdjacentHTML('beforeend', placeholder);
      panel = document.getElementById(`panel-${key}`);
    }
  }
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${key}`));
  const showLive =
    key === 'indices' ||
    key === 'commodities' ||
    key === 'macro' ||
    key === 'forex' ||
    key === 'policy' ||
    key === 'geopolitics' ||
    key === 'climate' ||
    key === 'outlook' ||
    key === 'fed' ||
    key === 'boj';
  $('#liveBadge')?.classList.toggle('hidden', !showLive);
  initPanelSetup(key);
  if (key === 'commodities') window.CommoditiesUI.onTabActivated();
  if (key === 'macro') refreshMacroLive();
  if (key === 'policy') {
    initPolicyCommodityPanel().then(() => {
      const policyPanel = document.getElementById('panel-policy');
      if (policyPanel) {
        refreshPolicyPanelSections(policyPanel, {
          items: window.__policyCacheItems || [],
          groups: window.__policyCacheGroups || [],
          stats: window.__policyCacheStats,
          commodityIntel: window.__policyCommodityIntel,
        });
      }
    });
  } else if (key === 'geopolitics') {
    refreshGeopoliticsPanelSections(document.getElementById('panel-geopolitics'));
  } else if (key === 'climate') {
    refreshClimatePanelSections(document.getElementById('panel-climate'));
  } else if (key === 'outlook') {
    void activateOutlookTab();
  }
  if (key === 'fed') {
    repatchCbSpeechesInDom('fed');
  }
  if (key === 'boj') {
    repatchBojNewsInDom();
    repatchCbSpeechesInDom('boj');
  }
}

async function refreshForexLive() {
  if (!window.fancheng?.fetchForexLive) return;
  try {
    const forex = await window.fancheng.fetchForexLive({ force: true });
    if (forex?.error || !forex?.pairs?.length) return;
    applyForexLiveData(forex);
  } catch {
    // 静默
  }
}

function updateForexCards(source) {
  applyForexLiveData(source);
}

async function refreshMacroLive() {
  if (!window.fancheng?.fetchMacroLive) return;
  try {
    const macro = await window.fancheng.fetchMacroLive();
    if (macro?.error || !macro?.groups) return;
    const panel = document.getElementById('panel-macro');
    if (!panel) return;
    const groupsEl = panel.querySelector('.macro-groups');
    const liveTag = panel.querySelector('.macro-live-tag');
    if (groupsEl) groupsEl.innerHTML = renderMacroGroups(macro);
    if (liveTag && macro.liveRefreshedAt) {
      liveTag.textContent = `实时 ${formatDate(macro.liveRefreshedAt)}`;
    } else if (macro.liveRefreshedAt) {
      panel.querySelector('.macro-panel-head')?.insertAdjacentHTML(
        'beforeend',
        `<span class="macro-live-tag">实时 ${formatDate(macro.liveRefreshedAt)}</span>`
      );
    }
  } catch {
    // 静默
  }
}

function stopBojLiveTimer() {
  if (bojLiveTimer) clearInterval(bojLiveTimer);
  bojLiveTimer = null;
}

function stopFedLiveTimer() {
  if (fedLiveTimer) clearInterval(fedLiveTimer);
  fedLiveTimer = null;
}

function startBojLiveTimer() {
  stopBojLiveTimer();
  if (activeTab !== 'boj') return;
  ensureCentralBankData('boj');
  refreshBojLive();
  bojLiveTimer = setInterval(refreshBojLive, bojRefreshMs);
}

function startFedLiveTimer() {
  stopFedLiveTimer();
  if (activeTab !== 'fed') return;
  ensureCentralBankData('fed');
  refreshFedLive();
  fedLiveTimer = setInterval(refreshFedLive, fedRefreshMs);
}

function applyCentralBankPanelData(key, source) {
  if (!isActivePanel(key)) return;
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;

  const payload = key === 'boj' ? localizeBojSource(source) : source;
  const kpiStrip = panel.querySelector('.cb-kpi-strip');
  const speechesPane = panel.querySelector('[data-cb-pane="speeches"]');
  const newsPane = panel.querySelector('[data-cb-pane="news"]');
  const timelinePane = panel.querySelector('[data-cb-pane="timeline"]');

  if (kpiStrip && payload.indicators?.length) {
    kpiStrip.outerHTML = renderIndicatorKpiStrip(payload.indicators);
  }
  if (speechesPane) {
    speechesPane.innerHTML = renderReadingSpeechRows(payload.speeches || [], { bank: key });
  }
  if (newsPane) {
    newsPane.innerHTML = renderReadingNewsRows(payload.news, {
      locale: key === 'boj' ? 'boj' : undefined,
    });
  }
  if (timelinePane) {
    timelinePane.innerHTML = renderCentralBankTimeline(payload.speeches, payload.news, { bank: key });
  }

  panel.querySelectorAll('.cb-reading-tab').forEach((btn) => {
    const countEl = btn.querySelector('.cb-tab-count');
    if (!countEl) return;
    if (btn.dataset.cbTab === 'speeches') countEl.textContent = String(payload.speeches?.length || 0);
    if (btn.dataset.cbTab === 'news') countEl.textContent = String(payload.news?.length || 0);
    if (btn.dataset.cbTab === 'timeline') {
      countEl.textContent = String((payload.speeches?.length || 0) + (payload.news?.length || 0));
    }
  });

  setupNewsItems(panel);
  if (key === 'boj') repatchBojNewsInDom();
  repatchCbSpeechesInDom(key);

  const stamp = payload.liveRefreshedAt || payload.updatedAt;
  const liveClass = key === 'fed' ? 'fed-live-tag' : 'boj-live-tag';
  const liveTag = panel.querySelector(`.${liveClass}`);
  if (liveTag && stamp) {
    liveTag.textContent = `实时 ${formatDate(stamp)}`;
  } else if (stamp) {
    panel.querySelector('.cb-reading-head')?.insertAdjacentHTML(
      'beforeend',
      `<span class="${liveClass}">实时 ${formatDate(stamp)}</span>`
    );
  }

  if (activeTab === key && stamp) {
    $('#lastUpdated').textContent = `${TAB_LABELS[key]}实时 ${formatDate(stamp)}`;
  }
}

function applyBojLiveData(source) {
  applyCentralBankPanelData('boj', source);
}

function applyFedLiveData(source) {
  applyCentralBankPanelData('fed', source);
}

async function ensureCentralBankData(key) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;
  const missingSpeeches =
    panel.querySelector('[data-cb-pane="speeches"]') && !panel.querySelector('.reading-row-speech');
  const missingIndicators = panel.querySelector('.cb-kpi-strip') && !panel.querySelector('.cb-kpi-card');
  if (missingSpeeches || missingIndicators) {
    if (key === 'fed') await refreshFedLive();
    if (key === 'boj') await refreshBojLive();
    return;
  }
  if (panel.querySelector('.cb-kpi-card')) return;
  if (key === 'fed' && window.fancheng?.fetchFedLive) {
    try {
      const data = await window.fancheng.fetchFedLive();
      if (!data?.error) applyFedLiveData(data);
    } catch {
      // 静默
    }
  }
  if (key === 'boj' && window.fancheng?.fetchBojLive) {
    try {
      const data = await window.fancheng.fetchBojLive();
      if (!data?.error) applyBojLiveData(data);
    } catch {
      // 静默
    }
  }
}

function hasCentralBankLivePayload(source) {
  return Boolean(source?.news?.length || source?.indicators?.length || source?.speeches?.length);
}

async function refreshFedLive() {
  if (!window.fancheng?.fetchFedLive) return;
  try {
    const fed = await window.fancheng.fetchFedLive();
    if (fed?.error) return;
    if (hasCentralBankLivePayload(fed)) applyFedLiveData(fed);
  } catch {
    // 静默
  }
}

async function refreshBojLive() {
  if (!window.fancheng?.fetchBojLive) return;
  try {
    const boj = await window.fancheng.fetchBojLive();
    if (boj?.error) return;
    if (hasCentralBankLivePayload(boj)) applyBojLiveData(boj);
  } catch {
    // 静默
  }
}

function patchIndexCard(card, idx) {
  if (!card || !idx) return false;
  const up = idx.change >= 0;
  const changeClass = up ? 'change-up' : 'change-down';
  card.classList.toggle('index-card-stale', Boolean(idx.stale));
  const nameEl = card.querySelector('.index-name');
  if (nameEl) {
    const staleBadge = idx.stale
      ? '<span class="index-stale-badge" title="数据源仅提供昨收">昨收</span>'
      : '';
    const errorBadge = idx.error
      ? `<span class="index-error-badge" title="${escapeAttr(idx.error)}">异常</span>`
      : '';
    nameEl.innerHTML = `${escapeHtml(idx.name)}${staleBadge}${errorBadge}`;
  }
  const marketEl = card.querySelector('.index-market');
  if (marketEl) marketEl.textContent = idx.market || '';
  const priceEl = card.querySelector('.index-price');
  if (priceEl) priceEl.textContent = formatNumber(idx.price, 2);
  const changeEl = card.querySelector('.index-change');
  if (changeEl) {
    changeEl.className = `index-change ${changeClass}`;
    const arrow = up ? '▲' : '▼';
    changeEl.innerHTML = `${arrow} ${formatNumber(Math.abs(idx.change), 2)}
      <span class="index-pct">（${up ? '+' : ''}${formatNumber(idx.changePct, 2)}%）</span>
      ${idx.changeNote ? `<span class="index-note">${escapeHtml(idx.changeNote)}</span>` : ''}`;
  }
  return true;
}

function updateIndicesCards(source) {
  if (!source?.regions) return;
  for (const region of source.regions) {
    for (const idx of region.indices || []) {
      if (!idx.id) continue;
      const card = document.querySelector(`.index-card-clickable[data-index-id="${idx.id}"]`);
      if (card && patchIndexCard(card, idx)) continue;
      if (card) {
        const active = card.classList.contains('index-card-active');
        card.outerHTML = renderIndexCard(idx);
        if (active) {
          document
            .querySelector(`.index-card-clickable[data-index-id="${idx.id}"]`)
            ?.classList.add('index-card-active');
        }
        setupIndexCards();
      }
    }
  }
}

function applyKlineData(data, keepScroll = false) {
  const chartEl = $('#historyChart');
  const summaryEl = $('#historySummary');
  if (!data?.klines?.length) return;

  const prevOffset = klineOffset;
  const wasAtEnd = prevOffset >= Math.max(0, currentKlines.length - klineViewCount);

  currentKlines = data.klines;
  const key = cacheKey(selectedIndexId, selectedTimeframe);
  historyCache[key] = data;

  if (keepScroll && wasAtEnd) {
    klineOffset = Math.max(0, currentKlines.length - klineViewCount);
  } else if (!keepScroll) {
    klineOffset = Math.max(0, currentKlines.length - klineViewCount);
  }

  const s = data.summary;
  const up = s.totalReturnPct >= 0;
  if (summaryEl) {
    summaryEl.innerHTML = `<span class="history-name">${escapeHtml(data.name)} · ${escapeHtml(s.timeframeLabel)}</span>
      <span class="history-range">${s.startDate} → ${s.endDate}</span>
      <span class="history-return ${up ? 'change-up' : 'change-down'}">
        累计 ${up ? '+' : ''}${formatNumber(s.totalReturnPct, 2)}%
      </span>
      <span class="history-meta">${s.bars} 根K线 · 20年最高 ${formatNumber(s.high20y, 2)} · 20年最低 ${formatNumber(s.low20y, 2)}</span>`;
  }

  if (chartEl) {
    chartEl.innerHTML = '';
    renderKlineChart();
  }
  renderKlineTable(currentKlines);
}

async function refreshLive() {
  if (isLiveRefreshing) return;
  if (activeTab !== 'macro') return;
  isLiveRefreshing = true;
  try {
    await refreshMacroLive();
    $('#lastUpdated').textContent = `实时更新 ${formatDate(new Date().toISOString())}`;
  } catch {
    // 静默失败，下次再试
  } finally {
    isLiveRefreshing = false;
  }
}

function setupTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function openSettings() {
  $('#settingsModal').classList.remove('hidden');
  loadSettingsForm();
  const body = $('#settingsModal')?.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
}

function closeSettings() {
  $('#settingsModal').classList.add('hidden');
}

async function loadSettingsForm() {
  const cfg = await window.fancheng.getConfig();
  if (cfg?.error) {
    applyCursorSettingsStatus(cfg);
    return;
  }
  $('#refreshInterval').value = cfg.refreshIntervalMinutes || 5;
  $('#quoteRefreshSeconds').value = cfg.quoteRefreshSeconds || 30;
  $('#forexRefreshSeconds').value = cfg.forexRefreshSeconds || 10;
  $('#policyRefreshSeconds').value = cfg.policyRefreshSeconds || 30;
  const status = $('#fredKeyStatus');
  if (cfg.fredApiKeyConfigured) {
    status.textContent = `已配置密钥：${cfg.fredApiKeyMasked}`;
    status.className = 'settings-status ok';
    $('#fredApiKeyInput').placeholder = '留空则保留现有密钥，输入新密钥可替换';
  } else {
    status.textContent = '尚未配置，部分美联储指标可能无法显示';
    status.className = 'settings-status warn';
    $('#fredApiKeyInput').placeholder = '粘贴 32 位接口密钥';
  }
  $('#fredApiKeyInput').value = '';

  const stooqStatus = $('#stooqKeyStatus');
  if (cfg.stooqApiKeyConfigured) {
    stooqStatus.textContent = `已配置密钥：${cfg.stooqApiKeyMasked}`;
    stooqStatus.className = 'settings-status ok';
    $('#stooqApiKeyInput').placeholder = '留空则保留现有密钥，输入新密钥可替换';
  } else {
    stooqStatus.textContent = '尚未配置，欧洲等地指数 K 线无法加载';
    stooqStatus.className = 'settings-status warn';
    $('#stooqApiKeyInput').placeholder = '粘贴历史数据接口密钥';
  }
  $('#stooqApiKeyInput').value = '';

  const llmStatus = $('#llmKeyStatus');
  if (cfg.llmConfigured) {
    llmStatus.textContent = `已配置 · ${cfg.llmModel || '默认模型'}${cfg.llmApiKeyMasked ? ` · ${cfg.llmApiKeyMasked}` : ''}`;
    llmStatus.className = 'settings-status ok';
    $('#llmApiKeyInput').placeholder = '留空则保留现有密钥';
  } else {
    llmStatus.textContent = '未配置时将使用规则模式（结构化摘要，无 LLM 润色）';
    llmStatus.className = 'settings-status warn';
    $('#llmApiKeyInput').placeholder = '粘贴 API 密钥';
  }
  $('#llmApiUrlInput').value = cfg.llmApiUrl || 'https://api.deepseek.com/v1/chat/completions';
  $('#llmModelInput').value = cfg.llmModel || 'deepseek-chat';
  $('#llmApiKeyInput').value = '';

  const cursorStatus = $('#cursorKeyStatus');
  applyCursorSettingsStatus(cfg);
  applyOverseasProxySettingsStatus(cfg);
}

function applyOverseasProxySettingsStatus(cfg) {
  const status = $('#overseasProxyStatus');
  if (!status) return;
  if (cfg?.error) {
    status.textContent = `读取配置失败：${cfg.error}`;
    status.className = 'settings-status warn';
    return;
  }
  const enabled = cfg.overseasProxyEnabled !== false;
  if (cfg.overseasProxyConfigured && enabled) {
    status.textContent = `已配置：${cfg.overseasProxyUrlMasked || '（已设置）'} · 国际源走代理`;
    status.className = 'settings-status ok';
    if ($('#overseasProxyUrlInput')) {
      $('#overseasProxyUrlInput').placeholder = '留空则保留现有地址，输入新地址可替换';
    }
  } else if (cfg.overseasProxyUrl?.trim() && !enabled) {
    status.textContent = '代理地址已保存但未启用';
    status.className = 'settings-status warn';
  } else {
    status.textContent = '未配置时 EIA / USDA / IEA 等国际源走直连（可能超时）';
    status.className = 'settings-status warn';
    if ($('#overseasProxyUrlInput')) {
      $('#overseasProxyUrlInput').placeholder = 'http://user:pass@host:port';
    }
  }
  if ($('#overseasProxyEnabledInput')) {
    $('#overseasProxyEnabledInput').checked = enabled;
  }
  if ($('#overseasProxyUrlInput')) $('#overseasProxyUrlInput').value = '';
}

function collectCursorConfigPartial() {
  const partial = {};
  const cursorKey = $('#cursorApiKeyInput')?.value?.trim();
  if (cursorKey) partial.cursorApiKey = cursorKey;
  const cursorModel = $('#cursorModelInput')?.value?.trim();
  if (cursorModel) partial.cursorModel = cursorModel;
  const cursorUrlInput = $('#cursorApiUrlInput');
  if (cursorUrlInput) {
    const cursorUrl = cursorUrlInput.value.trim();
    partial.cursorApiUrl = cursorUrl;
  }
  const concRaw = Number($('#cursorConcurrencyInput')?.value);
  if (Number.isFinite(concRaw) && concRaw >= 1) {
    partial.cursorConcurrency = Math.min(6, Math.floor(concRaw));
  }
  return partial;
}

function applyCursorSettingsStatus(cfg) {
  const cursorStatus = $('#cursorKeyStatus');
  if (!cursorStatus) return;
  if (cfg?.error) {
    cursorStatus.textContent = `读取配置失败：${cfg.error}`;
    cursorStatus.className = 'settings-status warn';
    return;
  }
  if (cfg.cursorConfigured) {
    const conc = cfg.cursorConcurrency ?? window.__cursorStatus?.concurrency ?? 3;
    cursorStatus.textContent = `Cursor 已配置 · ${cfg.cursorModel || 'composer-2.5'} · 并发 ${conc}${cfg.cursorApiKeyMasked ? ` · ${cfg.cursorApiKeyMasked}` : ''}`;
    cursorStatus.className = 'settings-status ok';
    if ($('#cursorApiKeyInput')) $('#cursorApiKeyInput').placeholder = '留空则保留现有密钥';
  } else {
    cursorStatus.textContent = '未配置时大宗走势研判无法生成 Cursor 分析';
    cursorStatus.className = 'settings-status warn';
    if ($('#cursorApiKeyInput')) $('#cursorApiKeyInput').placeholder = '粘贴 CURSOR_API_KEY（crsr_...）';
  }
  if ($('#cursorModelInput')) $('#cursorModelInput').value = cfg.cursorModel || 'composer-2.5';
  if ($('#cursorApiUrlInput')) $('#cursorApiUrlInput').value = cfg.cursorApiUrl || '';
  if ($('#cursorConcurrencyInput')) {
    $('#cursorConcurrencyInput').value = String(cfg.cursorConcurrency ?? window.__cursorStatus?.concurrency ?? 3);
  }
  if ($('#cursorApiKeyInput')) $('#cursorApiKeyInput').value = '';
}

async function saveCursorSettings({ testAfter = false, closeModal = false } = {}) {
  const cursorStatus = $('#cursorKeyStatus');
  const partial = collectCursorConfigPartial();
  const cfgBefore = await window.fancheng.getConfig();
  if (cfgBefore?.error) {
    if (cursorStatus) {
      cursorStatus.textContent = `读取配置失败：${cfgBefore.error}`;
      cursorStatus.className = 'settings-status warn';
    }
    return { ok: false, error: cfgBefore.error };
  }
  if (!partial.cursorApiKey && !cfgBefore.cursorConfigured) {
    if (cursorStatus) {
      cursorStatus.textContent = '请先粘贴 Cursor API Key（crsr_...）';
      cursorStatus.className = 'settings-status warn';
    }
    $('#cursorApiKeyInput')?.focus();
    return { ok: false, error: '未填写 Cursor API Key' };
  }
  if (cursorStatus) {
    cursorStatus.textContent = '正在保存 Cursor 配置…';
    cursorStatus.className = 'settings-status';
  }
  const saved = await window.fancheng.saveConfig(partial);
  if (saved?.error) {
    if (cursorStatus) {
      cursorStatus.textContent = `保存失败：${saved.error}`;
      cursorStatus.className = 'settings-status warn';
    }
    window.fancheng.showNotification?.({ title: '梵澄金融', body: `Cursor 配置保存失败：${saved.error}` });
    return { ok: false, error: saved.error };
  }
  applyCursorSettingsStatus(saved);
  void window.fancheng.getCursorStatus?.().then((st) => {
    if (st) window.__cursorStatus = st;
  });
  void setupLlmStatusIndicator();
  if (closeModal) closeSettings();
  window.fancheng.showNotification?.({
    title: '梵澄金融',
    body: saved.cursorConfigured ? 'Cursor 密钥已保存' : 'Cursor 配置已更新',
  });
  if (testAfter && window.fancheng.testCursorConnection) {
    if (cursorStatus) {
      cursorStatus.textContent = '测试 Cursor 连接中…';
      cursorStatus.className = 'settings-status';
    }
    const result = await window.fancheng.testCursorConnection();
    if (result?.ok) {
      if (cursorStatus) {
        cursorStatus.textContent = `Cursor 连接成功 · ${result.model || 'composer-2.5'}${result.email ? ` · ${result.email}` : ''}`;
        cursorStatus.className = 'settings-status ok';
      }
    } else if (cursorStatus) {
      cursorStatus.textContent = result?.error || 'Cursor 连接失败';
      cursorStatus.className = 'settings-status warn';
    }
    return { ok: Boolean(result?.ok), saved, test: result };
  }
  return { ok: true, saved };
}

async function saveSettings() {
  const partial = {
    refreshIntervalMinutes: Math.max(
      1,
      Math.min(60, parseInt($('#refreshInterval').value, 10) || 5)
    ),
    quoteRefreshSeconds: Math.max(
      10,
      Math.min(300, parseInt($('#quoteRefreshSeconds').value, 10) || 30)
    ),
    forexRefreshSeconds: Math.max(
      5,
      Math.min(60, parseInt($('#forexRefreshSeconds').value, 10) || 10)
    ),
    policyRefreshSeconds: Math.max(
      15,
      Math.min(300, parseInt($('#policyRefreshSeconds').value, 10) || 30)
    ),
  };
  const key = $('#fredApiKeyInput').value.trim();
  if (key) partial.fredApiKey = key;
  const stooqKey = $('#stooqApiKeyInput').value.trim();
  if (stooqKey) partial.stooqApiKey = stooqKey;
  const llmUrl = $('#llmApiUrlInput').value.trim();
  if (llmUrl) partial.llmApiUrl = llmUrl;
  const llmKey = $('#llmApiKeyInput').value.trim();
  if (llmKey) partial.llmApiKey = llmKey;
  const llmModel = $('#llmModelInput').value.trim();
  if (llmModel) partial.llmModel = llmModel;
  Object.assign(partial, collectCursorConfigPartial());
  const proxyUrl = $('#overseasProxyUrlInput')?.value?.trim();
  if (proxyUrl) partial.overseasProxyUrl = proxyUrl;
  if ($('#overseasProxyEnabledInput')) {
    partial.overseasProxyEnabled = $('#overseasProxyEnabledInput').checked;
  }

  const saved = await window.fancheng.saveConfig(partial);
  if (saved?.error) {
    window.fancheng.showNotification?.({
      title: '梵澄金融',
      body: `设置保存失败：${saved.error}`,
    });
    applyCursorSettingsStatus(saved);
    return;
  }
  void setupLlmStatusIndicator();
  refreshIntervalMs = saved.refreshIntervalMinutes * 60 * 1000;
  quoteRefreshMs = saved.quoteRefreshSeconds * 1000;
  forexRefreshMs = (saved.forexRefreshSeconds || 10) * 1000;
  policyRefreshMs = (saved.policyRefreshSeconds || 30) * 1000;
  startAutoRefresh();
  closeSettings();
  await loadData(false, { force: true });
  window.fancheng.showNotification({
    title: '梵澄金融',
    body:
      saved.cursorConfigured
        ? saved.fredApiKeyConfigured && saved.stooqApiKeyConfigured && saved.llmConfigured
          ? '设置已保存，Cursor 与全部数据源已连接'
          : '设置已保存，Cursor 已连接'
        : saved.fredApiKeyConfigured && saved.stooqApiKeyConfigured && saved.llmConfigured
        ? '设置已保存，全部数据源与 LLM 已连接'
        : saved.llmConfigured
          ? '设置已保存，LLM 已连接'
          : saved.fredApiKeyConfigured && saved.stooqApiKeyConfigured
        ? '设置已保存，全部数据源已连接'
        : saved.stooqApiKeyConfigured
          ? '设置已保存，欧洲指数 K 线已连接'
          : saved.fredApiKeyConfigured
            ? '设置已保存，美联储数据已连接'
            : '设置已保存',
  });
}

function setupSettings() {
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsBackdrop').addEventListener('click', closeSettings);
  $('#settingsSaveBtn').addEventListener('click', saveSettings);
  $('#fredApplyBtn').addEventListener('click', () => {
    window.fancheng.openExternal(FRED_APPLY_URL);
  });
  $('#stooqApplyBtn').addEventListener('click', () => {
    window.fancheng.openExternal(STOOQ_APPLY_URL);
  });
  $('#cursorApplyBtn')?.addEventListener('click', () => {
    window.fancheng.openExternal(CURSOR_APPLY_URL);
  });
  $('#cursorSaveBtn')?.addEventListener('click', () => {
    void saveCursorSettings({ testAfter: false });
  });
  $('#cursorTestBtn')?.addEventListener('click', async () => {
    await saveCursorSettings({ testAfter: true });
  });
  $('#llmTestBtn')?.addEventListener('click', async () => {
    const llmStatus = $('#llmKeyStatus');
    if (!llmStatus) return;
    llmStatus.textContent = '测试连接中…';
    llmStatus.className = 'settings-status';
    const partial = {};
    const llmUrl = $('#llmApiUrlInput').value.trim();
    if (llmUrl) partial.llmApiUrl = llmUrl;
    const llmKey = $('#llmApiKeyInput').value.trim();
    if (llmKey) partial.llmApiKey = llmKey;
    const llmModel = $('#llmModelInput').value.trim();
    if (llmModel) partial.llmModel = llmModel;
    if (Object.keys(partial).length) await window.fancheng.saveConfig(partial);
    const res = await window.fancheng.testLlmConnection?.();
    if (res?.ok) {
      llmStatus.textContent = `连接成功 · ${res.model || ''} · ${res.sample || 'OK'}`;
      llmStatus.className = 'settings-status ok';
      void setupLlmStatusIndicator();
    } else {
      llmStatus.textContent = res?.error || '连接失败';
      llmStatus.className = 'settings-status warn';
    }
  });
}

let startupPushBuffer = null;
let bootstrapRetryCount = 0;

function bindEarlyStartupPushListener() {
  if (typeof window.fancheng?.onStartupData !== 'function') return;
  window.fancheng.onStartupData((data) => {
    if (data?.outlookHeadlines) applyOutlookHeadlinesFromPayload(data.outlookHeadlines);
    if (!data?.sources || !hasIndexData(data)) return;
    startupPushBuffer = data;
    if (!indicesRendered) {
      applyStartupDataSafe(data, { fromCache: true, forceFullRender: false });
      $('#errorBanner')?.classList.add('hidden');
    }
  });
}

async function tryStartupCachePaths(cfg = {}) {
  if (startupPushBuffer?.sources && hasIndexData(startupPushBuffer)) {
    return applyStartupDataSafe(startupPushBuffer, { fromCache: true, forceFullRender: false });
  }

  if (typeof window.fancheng.getCachedIndices === 'function') {
    const indices = await withTimeout(window.fancheng.getCachedIndices(), 1200, null);
    if (indices?.regions?.some((r) => r.indices?.length)) {
      return applyStartupDataSafe(buildDataFromIndices(indices, cfg), {
        fromCache: true,
        forceFullRender: false,
      });
    }
  }

  const snapshot = await withTimeout(window.fancheng.getStartupSnapshot(), 3000, null);
  if (snapshot?.outlookLive?.instruments?.length || snapshot?.outlookLive?.categories?.length) {
    cacheOutlookSource(snapshot.outlookLive);
  }
  if (snapshot?.allData?.sources && hasIndexData(snapshot.allData)) {
    window.__preloadedCommoditiesLive = snapshot.commoditiesLive;
    window.__preloadedForexLive = snapshot.forexLive;
    const merged = { ...snapshot.allData };
    if (!merged.sources.outlook && snapshot.outlookLive?.instruments?.length) {
      merged.sources = { ...merged.sources, outlook: snapshot.outlookLive };
    }
    return applyStartupDataSafe(merged, { fromCache: true, forceFullRender: false });
  }

  if (typeof window.fancheng.fetchIndicesQuick === 'function') {
    const indices = await withTimeout(
      window.fancheng.fetchIndicesQuick({ cacheOnly: true }),
      1200,
      null
    );
    if (indices?.regions?.some((r) => r.indices?.length)) {
      return applyStartupDataSafe(buildDataFromIndices(indices, cfg), {
        fromCache: Boolean(indices.fromCache),
        forceFullRender: false,
      });
    }
  }

  return false;
}

async function finishBootstrapWithCacheOrWarning(cfg = {}) {
  const applied = await applyCacheFallback();
  if (applied) {
    indicesLoading = false;
    $('#lastUpdated').textContent = '本地缓存 · 点击刷新更新';
    $('#errorBanner').textContent = '网络较慢，已显示本地缓存';
    $('#errorBanner').classList.remove('hidden');
    return true;
  }
  showIndicesLoading();
  $('#lastUpdated').textContent = '暂无缓存，请点击刷新';
  return false;
}

function scheduleBackgroundIndicesRefresh(delayMs = 4000) {
  setTimeout(async () => {
    if (!window.fancheng?.fetchIndicesLive) return;
    try {
      const indices = await withTimeout(window.fancheng.fetchIndicesLive(), 25000, null);
      if (!indices?.regions?.some((r) => r.indices?.length)) return;
      if (isActivePanel('indices') && shouldProcessLiveDomUpdate()) {
        updateIndicesCards(indices);
      }
      if (indicesRendered) {
        $('#lastUpdated').textContent = `指数已更新 ${formatDate(indices.liveRefreshedAt || indices.fetchedAt || new Date().toISOString())}`;
      }
    } catch {
      // 静默
    }
  }, delayMs);
}

async function applyCacheFallback() {
  try {
    const snapshot = await withTimeout(window.fancheng.getStartupSnapshot(), 3000, null);
    if (snapshot?.allData?.sources && hasIndexData(snapshot.allData)) {
      window.__preloadedCommoditiesLive = snapshot.commoditiesLive || window.__preloadedCommoditiesLive;
      return applyStartupDataSafe(snapshot.allData, { fromCache: true, forceFullRender: false });
    }
    if (typeof window.fancheng.getCachedIndices === 'function') {
      const indices = await withTimeout(window.fancheng.getCachedIndices(), 1200, null);
      if (indices?.regions?.some((r) => r.indices?.length)) {
        return applyStartupDataSafe(buildDataFromIndices(indices, {}), {
          fromCache: true,
          forceFullRender: false,
        });
      }
    }
  } catch {
    // ignore
  }
  return false;
}

async function loadIndicesQuick(cfg = {}) {
  if (typeof window.fancheng.fetchIndicesQuick !== 'function') return false;
  try {
    const indices = await withTimeout(
      window.fancheng.fetchIndicesQuick({ cacheOnly: true }),
      1500,
      null
    );
    if (!indices || indices.error) return false;
    if (!indices.regions?.some((r) => r.indices?.length)) return false;
    return applyStartupDataSafe(buildDataFromIndices(indices, cfg), {
      fromCache: Boolean(indices.fromCache),
      forceFullRender: false,
    });
  } catch {
    return false;
  }
}

async function fetchDataInBackground(force = false) {
  if (!force) {
    indicesLoading = false;
    return;
  }
  try {
    const data = await withTimeout(
      window.fancheng.fetchAll({ force: true }),
      120000,
      null
    );
    if (!data) {
      await applyCacheFallback();
      if (!indicesRendered) {
        $('#lastUpdated').textContent = '加载超时，请点击刷新';
      }
      indicesLoading = false;
      return;
    }
    if (data?.error) {
      await applyCacheFallback();
      if (!indicesRendered) {
        $('#errorBanner').textContent = localizeUiMessage(data.error);
        $('#errorBanner').classList.remove('hidden');
      }
      indicesLoading = false;
      return;
    }
    if (!data.partial && !data.fromCache && force) {
      historyCache = {};
      window.CommoditiesUI?.resetCache?.();
    }
    applyStartupDataSafe(data, { fromCache: data.fromCache, forceFullRender: force });
    showErrors(data.errors || []);
    indicesLoading = false;
    if (!data.errors?.length) {
      $('#errorBanner')?.classList.add('hidden');
    }
  } catch (err) {
    await applyCacheFallback();
    if (!indicesRendered) {
      $('#errorBanner').textContent = `加载失败：${localizeUiMessage(err.message)}`;
      $('#errorBanner').classList.remove('hidden');
    }
    indicesLoading = false;
  }
}

async function bootstrapApp() {
  hideLoadingOverlay();
  bindEarlyStartupPushListener();

  let bootstrapDeadline = null;
  const scheduleBootstrapRetry = (cfg) => {
    if (bootstrapDeadline) clearTimeout(bootstrapDeadline);
    bootstrapDeadline = setTimeout(async () => {
      if (indicesRendered) return;
      if (bootstrapRetryCount >= 2) {
        await finishBootstrapWithCacheOrWarning(cfg);
        return;
      }
      bootstrapRetryCount += 1;
      $('#lastUpdated').textContent = '加载较慢，正在重试…';
      const applied = await tryStartupCachePaths(cfg);
      if (applied) {
        indicesLoading = false;
        scheduleBackgroundIndicesRefresh(2000);
        return;
      }
      scheduleBootstrapRetry(cfg);
    }, 8000);
  };

  try {
    const cfg = await withTimeout(window.fancheng.getConfig(), 5000, {});
    refreshIntervalMs = ((cfg.refreshIntervalMinutes || 5) * 60 * 1000);
    quoteRefreshMs = Math.max((cfg.quoteRefreshSeconds || 30) * 1000, 45000);
    forexRefreshMs = ((cfg.forexRefreshSeconds || 10) * 1000);
    policyRefreshMs = ((cfg.policyRefreshSeconds || 30) * 1000);
    fedRefreshMs = policyRefreshMs;
    bojRefreshMs = policyRefreshMs;

    ensureCommodityMasterCatalog().catch(() => {});
    window.fancheng.warmCommodityNewsCache?.().catch(() => {});

    let applied = await tryStartupCachePaths(cfg);

    if (!applied) {
      applied = await loadIndicesQuick(cfg);
    }

    if (!applied) {
      showIndicesLoading();
      $('#lastUpdated').textContent = '正在连接数据源…';
      scheduleBootstrapRetry(cfg);
    } else {
      scheduleBackgroundIndicesRefresh(5000);
    }

    if (window.fancheng.onPolicyLive) {
      window.fancheng.onPolicyLive((policy) => {
        if (!policy?.items?.length) return;
        window.__policyCacheItems = policy.items;
        if (policy.commodityIntel) window.__policyCommodityIntel = policy.commodityIntel;
        if (isActivePanel('policy')) applyPolicyLiveData(policy);
        else updateNavTabBadge('policy', policy.items.length);
      });
    }

    if (window.fancheng.onGeopoliticsLive) {
      window.fancheng.onGeopoliticsLive((geo) => {
        if (!geo?.items?.length) return;
        applyGeopoliticsLiveData(geo);
      });
    }

    if (window.fancheng.onClimateLive) {
      window.fancheng.onClimateLive((climate) => {
        if (!climate?.items?.length) return;
        applyClimateLiveData(climate);
      });
    }

    if (window.fancheng.onOutlookQuotesUpdated) {
      window.fancheng.onOutlookQuotesUpdated((payload) => {
        applyOutlookQuotesLiveUpdate(payload);
      });
    }

    if (window.fancheng.onOutlookDataUpdated) {
      window.fancheng.onOutlookDataUpdated((outlook) => {
        if (!outlook?.instruments?.length && !outlook?.categories?.length) return;
        applyOutlookLiveData(outlook);
      });
    }

    if (window.fancheng.onFocusIntelUpdated) {
      window.fancheng.onFocusIntelUpdated(() => {
        if (!isActivePanel('outlook')) return;
        void loadFocusDashboard({ generate: true }).then((dash) => {
          if (!dash) return;
          const panel = document.getElementById('panel-outlook');
          const slot = panel?.querySelector('.outlook-focus-dashboard-slot');
          if (slot) slot.innerHTML = renderFocusDashboardSection(dash);
        });
      });
    }

    if (window.fancheng.onFocusAnalysisUpdated) {
      window.fancheng.onFocusAnalysisUpdated((payload) => {
        applyFocusAnalysisLiveUpdate(payload);
      });
    }

    if (window.fancheng.onOutlookLive) {
      window.fancheng.onOutlookLive((outlook) => {
        if (!outlook?.instruments?.length && !outlook?.categories?.length) return;
        applyOutlookLiveData(outlook);
      });
    }

    if (window.fancheng.onCommoditiesLive) {
      window.fancheng.onCommoditiesLive((commodities) => {
        if (!commodities?.exchanges?.length) return;
        applyCommoditiesLiveToOutlook(commodities);
        if (
          activeTab === 'commodities' &&
          shouldProcessLiveDomUpdate() &&
          window.CommoditiesUI?.mergeLiveData
        ) {
          window.CommoditiesUI.mergeLiveData(commodities);
        }
      });
    }

    if (window.fancheng.onIndicesLive) {
      window.fancheng.onIndicesLive((indices) => {
        if (!indices?.regions?.some((r) => r.indices?.length)) return;
        if (isActivePanel('indices') && shouldProcessLiveDomUpdate()) {
          updateIndicesCards(indices);
        } else {
          const count = indices.regions.reduce((n, r) => n + (r.indices?.length || 0), 0);
          if (count) updateNavTabBadge('indices', count);
        }
      });
    }

    if (window.fancheng.onFedLive) {
      window.fancheng.onFedLive((fed) => {
        if (!hasCentralBankLivePayload(fed)) return;
        if (isActivePanel('fed')) applyFedLiveData(fed);
      });
    }

    if (window.fancheng.onBojLive) {
      window.fancheng.onBojLive((boj) => {
        if (!hasCentralBankLivePayload(boj)) return;
        if (isActivePanel('boj')) applyBojLiveData(boj);
      });
    }

    if (window.fancheng.onForexLive) {
      window.fancheng.onForexLive((forex) => {
        if (!forex?.pairs?.length) return;
        if (isActivePanel('forex')) applyForexLiveData(forex);
      });
    }

    if (window.fancheng.onDataRefreshed) {
      window.fancheng.onDataRefreshed((data) => {
        setTimeout(() => {
          if (!data?.sources) return;
          window.__startupSources = { ...(window.__startupSources || {}), ...data.sources };
          if (data.sources.commodities) {
            scheduleIdleWork(() => applyCommoditiesLiveToOutlook(data.sources.commodities));
          }
          showErrors(data.errors || []);
          $('#lastUpdated').textContent = `已更新 ${formatDate(data.fetchedAt)}`;
          $('#errorBanner')?.classList.add('hidden');
        }, 0);
      });
    }

    startAutoRefresh();
    bindWindowFocusHandlers();
    bindScrollPerfHints();
    bindUserActivityTracking();
    notifyRendererState();
    if (
      activeTab === 'indices' ||
      activeTab === 'commodities' ||
      activeTab === 'macro' ||
      activeTab === 'forex' ||
      activeTab === 'policy' ||
      activeTab === 'fed' ||
      activeTab === 'boj'
    ) {
      $('#liveBadge')?.classList.remove('hidden');
    }

    if (!cfg.fredApiKeyConfigured) {
      setTimeout(openSettings, 1500);
    }
  } catch (err) {
    hideLoadingOverlay();
    showIndicesLoading();
    $('#errorBanner').textContent = `初始化异常：${localizeUiMessage(err.message)}`;
    $('#errorBanner').classList.remove('hidden');
  } finally {
    if (bootstrapDeadline) clearTimeout(bootstrapDeadline);
  }
}

async function updateAppVersionLabel() {
  const versionEl = document.getElementById('appVersion');
  if (!versionEl || !window.fancheng?.getAppVersion) return;
  try {
    const version = await window.fancheng.getAppVersion();
    if (version && !version.error) versionEl.textContent = `v${version}`;
  } catch {
    // keep index.html fallback label
  }
}

let dataQualityDetailOpen = false;

function formatDataQualityDetail(status) {
  const lines = [`状态: ${status.label || '—'}`];
  if (status.latestCloseDate) lines.push(`最新收盘: ${status.latestCloseDate}`);
  const failed = (status.checks || []).filter((c) => !c.passed);
  if (failed.length) {
    lines.push('未通过:');
    for (const c of failed.slice(0, 12)) {
      lines.push(`  · [${c.severity}] ${c.name}`);
    }
  } else if (status.checks?.length) {
    lines.push(`全部 ${status.checks.length} 项检测通过`);
  }
  return lines.join('\n');
}

function humanizeDataQualityLabel(status = {}) {
  let label = status.label || (status.ok ? '数据 OK' : '数据异常');
  if (/数据检测失败|数据检测暂时不可用/i.test(label) && /ENOENT|chdir|app\.asar/i.test(label)) {
    return status.ok ? '数据 OK' : '数据 OK · 部分检测跳过';
  }
  if (/ · ENOENT:/i.test(label) || / · chdir /i.test(label)) {
    return status.ok ? '数据 OK' : '数据 OK · 部分检测跳过';
  }
  return label;
}

function applyDataQualityStatus(status = {}) {
  const btn = document.getElementById('dataQualityIndicator');
  const labelEl = document.getElementById('dataQualityLabel');
  if (!btn || !labelEl) return;

  const level = status.healing ? 'critical' : status.level || (status.ok ? 'ok' : 'critical');
  btn.classList.remove('level-ok', 'level-warning', 'level-critical');
  btn.classList.add(`level-${level}`);
  labelEl.textContent = humanizeDataQualityLabel(status);
  btn.title = formatDataQualityDetail(status);
}

function setupDataQualityIndicator() {
  const btn = document.getElementById('dataQualityIndicator');
  if (!btn || !window.fancheng) return;

  applyDataQualityStatus({ label: '数据检测中…', level: 'warning' });

  window.fancheng.getDataQualityStatus?.().then((status) => {
    if (status && !status.error) applyDataQualityStatus(status);
  });

  window.fancheng.onDataQualityStatus?.((status) => {
    applyDataQualityStatus(status);
  });

  btn.addEventListener('click', async () => {
    dataQualityDetailOpen = !dataQualityDetailOpen;
    if (dataQualityDetailOpen) {
      const status = await window.fancheng.getDataQualityStatus?.();
      if (status && !status.error) {
        alert(formatDataQualityDetail(status));
      }
      dataQualityDetailOpen = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('error', (ev) => {
    console.error('[FanchengFinance] renderer error:', ev.error?.stack || ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    console.error('[FanchengFinance] unhandled rejection:', ev.reason);
  });

  updateAppVersionLabel();
  setupDataQualityIndicator();
  void setupLlmStatusIndicator();
  void ensurePhilosophyManifest();
  setupPhilosophyModal();
  setupTabs();
  setupSettings();
  bindOutlookHeadlinesListener();
  $('#refreshBtn').addEventListener('click', () => loadData(false, { force: true }));

  setTimeout(() => {
    if (!indicesRendered) hideLoadingOverlay();
  }, 1200);
  if (!window.fancheng) {
    hideLoadingOverlay();
    const panels = $('#panels');
    if (panels) {
      panels.classList.remove('hidden');
      panels.innerHTML =
        '<div class="panel active"><div class="empty-state">应用桥接未就绪，请完全退出后重新安装最新版。</div></div>';
    }
    $('#lastUpdated').textContent = '启动异常 · 请重新安装';
    $('#errorBanner').textContent = 'preload 未加载：界面无法连接主进程';
    $('#errorBanner').classList.remove('hidden');
    return;
  }
  bootstrapApp();
});
