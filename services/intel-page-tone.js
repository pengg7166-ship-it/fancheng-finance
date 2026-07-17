/**
 * 情报中心 · 页面气质（构想 §20 / §71 · 第 16 条）
 * 默认幕僚面：列表/详情以命题·备忘录·信念领衔；方向箭头永不做主路径。
 * 仅 fortuneChromeAllowed 时允许淡色方向辅标，禁止红绿行底当「结论」。
 */
const PAGE_TONE_VERSION = 'v2.89.21-page-tone-staff-memo';

function buildStaffListLead(inst) {
  const ic = inst?.intelCenter;
  const sf = ic?.staffFace;
  const fortuneOk = Boolean(sf?.fortuneChromeAllowed);
  const hasIntel = Boolean(ic?.available || ic?.primaryClaim || ic?.memo);

  if (!hasIntel) {
    return {
      version: PAGE_TONE_VERSION,
      lead: '情报待建',
      tip: '尚无命题/备忘录 · 方向不作为结论',
      showArrow: false,
      arrow: '·',
      directionLabel: null,
      surface: 'pending',
      fortuneOk: false,
      method: 'no-intel→pending',
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

  const tip =
    sf?.display ||
    ic?.memo?.headline ||
    ic?.primaryClaim?.statement ||
    '幕僚面：命题/备忘录优先于方向箭头';

  return {
    version: PAGE_TONE_VERSION,
    lead,
    tip,
    // 即便可行动，箭头也只作辅标；不可行动则完全静音
    showArrow: fortuneOk,
    arrow: fortuneOk ? inst?.directionArrow || '→' : '·',
    directionLabel: fortuneOk ? inst?.directionLabel || null : null,
    surface: fortuneOk ? 'staff+fortune-aux' : 'staff',
    fortuneOk,
    mode: sf?.mode || null,
    method: 'memo|belief|choice→lead; arrow-aux-only',
    dataSource: 'intel-page-tone',
  };
}

/**
 * 行视觉：默认 staff-surface（无红绿底）；仅可行动时附加淡 fortune tint
 */
function resolveRowToneClass(inst) {
  const sf = inst?.intelCenter?.staffFace;
  const fortuneOk = Boolean(sf?.fortuneChromeAllowed);
  const mode = sf?.mode || 'observe';
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

function buildPageToneBoard(instruments, opts = {}) {
  let staffSurface = 0;
  let fortuneAux = 0;
  let pending = 0;
  let arrowHidden = 0;
  const samples = [];

  for (const inst of instruments || []) {
    const lead = buildStaffListLead(inst);
    if (lead.surface === 'pending') pending += 1;
    else if (lead.fortuneOk) fortuneAux += 1;
    else staffSurface += 1;
    if (!lead.showArrow) arrowHidden += 1;
    if (samples.length < 6) {
      samples.push({
        instrumentId: inst.id,
        instrumentName: inst.name || inst.id,
        lead: lead.lead,
        surface: lead.surface,
        showArrow: lead.showArrow,
      });
    }
  }

  const n = (instruments || []).length;
  const staffPct = n > 0 ? Math.round(((staffSurface + pending) / n) * 100) : null;

  return {
    version: PAGE_TONE_VERSION,
    asOf: opts.asOf || null,
    counts: {
      total: n,
      staffSurface,
      fortuneAux,
      pending,
      arrowHidden,
    },
    staffDominanceDisplay: staffPct != null ? `${staffPct}%` : '暂无',
    samples,
    display:
      n > 0
        ? `页面气质 幕僚面 ${staffSurface + pending}/${n} · 方向辅标 ${fortuneAux} · 箭头静音 ${arrowHidden}`
        : '页面气质 暂无品种',
    note: '列表默认命题/备忘录领衔；红绿底与主箭头已退场',
    dataSource: 'intel-page-tone',
    method: 'staff-lead+aux-arrow-gate',
  };
}

module.exports = {
  PAGE_TONE_VERSION,
  buildStaffListLead,
  resolveRowToneClass,
  buildPageToneBoard,
};
