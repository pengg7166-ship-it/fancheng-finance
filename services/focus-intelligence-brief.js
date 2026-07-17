/**
 * 关注品种 · 战场情报简报（多维度）
 * 仅使用引擎真实字段 + 可追溯新闻；缺失标「暂无」/「待校验」
 */
const { readCachedKlines } = require('./commodity-technical-analyzer');
const { loadCachedWebNews } = require('./focus-anysearch-news');
const { buildPolicyNewsItems } = require('./focus-news-articles');
const { getPinnedForSymbol } = require('./focus-impact-pins');

const BRIEF_VERSION = 'v2.57.0-intel-center';

function fmtPct(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function computeRsi14(closes) {
  if (!closes || closes.length < 15) return null;
  const slice = closes.slice(-15);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

function pickNewsLines(inst, webNews, limit = 3) {
  const lines = [];
  const newsFactor = inst.factors?.news;
  if (newsFactor?.hits?.length) {
    for (const h of newsFactor.hits.slice(0, limit)) {
      if (h?.title) lines.push({ text: h.title, source: h.source || 'news-pool', at: h.publishedAt || null });
    }
  }
  if (webNews?.items?.length) {
    for (const item of webNews.items.slice(0, limit)) {
      if (item?.title && !lines.some((l) => l.text === item.title)) {
        lines.push({
          text: item.title,
          source: item.source || 'anysearch',
          at: item.publishedAt || item.fetchedAt || null,
        });
      }
    }
  }
  return lines.slice(0, limit);
}

function buildPolicySupplyBlock(inst, newsPack) {
  const phil = inst.philosophy;
  const policy = phil?.policy;
  const ranked = phil?.ranked?.primary?.find((p) => p?.id === 'policy') || phil?.ranked?.primary?.[0];
  const items = [];
  const pinned = getPinnedForSymbol(inst.id).slice(0, 3);
  for (const p of pinned) {
    const daysLeft = Math.max(0, Math.ceil((new Date(p.pinUntil).getTime() - Date.now()) / 86400000));
    items.push({
      label: '置顶要闻',
      value: p.title,
      newsId: p.newsId,
      tier: '重点',
      impactTag: `置顶${daysLeft}天`,
      url: p.url,
      summary: p.summary,
      source: p.source,
      at: p.publishedAt,
      relevance: p.impactScore / 100,
      impactNote: `影响强度 ${p.impactScore}/100 · 停留至 ${p.pinUntil?.slice(0, 10) || '—'}`,
      clickable: Boolean(p.newsId),
      pinned: true,
    });
  }
  if (policy?.logicSummary) items.push({ label: '政策逻辑', value: policy.logicSummary, source: 'philosophy.policy', clickable: false });
  else if (ranked?.label) items.push({ label: '主导矛盾', value: ranked.label, source: 'philosophy.ranked', clickable: false });

  const newsItems = (newsPack?.items || []).filter((n) => n.label === '要闻' && n.clickable !== false);
  if (newsItems.length) {
    for (const n of newsItems) items.push(n);
  } else if (!pinned.length && !items.some((i) => i.label === '政策逻辑' || i.label === '主导矛盾')) {
    items.push({
      label: '要闻',
      value: '暂无品种相关资讯（已剔除低关联宏观规则，非猜测填充）',
      source: 'focus-news-articles',
      clickable: false,
    });
  } else if (!newsItems.length && !pinned.length) {
    items.push({
      label: '要闻',
      value: '暂无品种要闻（政策逻辑见上，待资讯验证）',
      source: 'focus-news-articles',
      clickable: false,
    });
  }

  const hasNews = newsItems.length > 0 || pinned.length > 0;
  const hasPolicyLogic = items.some((i) => i.label === '政策逻辑' || i.label === '主导矛盾');
  return {
    status: hasNews || hasPolicyLogic ? (hasNews ? 'ok' : '待资讯') : '暂无',
    items,
    articles: hasNews ? newsPack?.articles || [] : [],
    dataSource: 'philosophy|news|anysearch|focus-news-articles',
    hasNews,
    hasPolicyLogic,
    hasPolicyEvidence: hasNews || hasPolicyLogic,
  };
}

function assessEvidence(dimensions) {
  const ps = dimensions.policySupply || {};
  const corroborated = ['technical', 'capital', 'inventorySpot'].filter(
    (k) => dimensions[k]?.status === 'ok' && (dimensions[k]?.items?.length || 0) > 0
  ).length;
  return {
    hasPolicyEvidence: Boolean(ps.hasPolicyEvidence),
    hasNews: Boolean(ps.hasNews),
    hasPolicyLogic: Boolean(ps.hasPolicyLogic),
    corroborated,
  };
}

function buildQualifiedDirection(inst, evidence) {
  const raw = inst.directionLabel || '震荡';
  const tier = inst.directionTier || '';
  const isStrong = /强多|强空/.test(raw) || tier === 'strong_bullish' || tier === 'strong_bearish';
  if (isStrong && !evidence.hasPolicyEvidence) {
    if (/强多|strong_bullish/i.test(`${raw} ${tier}`)) {
      return { label: '偏多(待资讯证实)', raw, downgraded: true, basis: '技术/资金偏多，政策资讯未验证' };
    }
    return { label: '偏空(待资讯证实)', raw, downgraded: true, basis: '技术/资金偏空，政策资讯未验证' };
  }
  if (!evidence.hasPolicyEvidence && evidence.corroborated < 2) {
    return { label: '震荡(证据不足)', raw, downgraded: true, basis: `仅${evidence.corroborated}个维度有数据，政策资讯缺失` };
  }
  return { label: raw, raw, downgraded: false, basis: null };
}

function detectLongTermPin(inst, evidence) {
  if (!evidence?.hasPolicyEvidence) return null;
  const label = inst.directionLabel || '';
  const tier = inst.directionTier || '';
  const lt = inst.longTermGuidance;
  const strong =
    /强多/.test(label) ||
    /强空/.test(label) ||
    tier === 'strong_bullish' ||
    tier === 'strong_bearish';
  if (!strong || !lt?.pilot) return null;
  const side = /空|bear/i.test(label) || tier === 'strong_bearish' ? 'bear' : 'bull';
  return {
    pinned: true,
    side,
    label: side === 'bull' ? '长线强烈看多' : '长线强烈看空',
    reason: lt.thesisStatus?.status || lt.entry?.reason || label,
    dataSource: 'longTermGuidance|direction|policy-verified',
  };
}

function buildWatchThesis(inst, dims, longTermPin, evidence, qualified) {
  const hooks = [];
  if (!evidence.hasPolicyEvidence) hooks.push('政策资讯待验证');
  const mainContra = dims.intelligence?.items?.find((i) => i.label === '主矛盾');
  if (mainContra?.value && mainContra.value !== '暂无') {
    hooks.push(`主矛盾 ${String(mainContra.value).slice(0, 36)}`);
  }
  const oppose = dims.intelligence?.items?.find((i) => i.label === '反对意见');
  if (oppose?.value && /结论脆弱/.test(oppose.value)) {
    hooks.push('对侧证据不足·结论脆弱');
  } else if (oppose?.value && oppose.value !== '暂无') {
    hooks.push(`反对 ${String(oppose.value).slice(0, 32)}`);
  }
  const policyNews = dims.policySupply.items.find((i) => i.label === '要闻' && i.clickable !== false);
  const policyHead = dims.policySupply.items.find((i) => i.label === '政策逻辑' || i.label === '主导矛盾');
  if (policyNews) hooks.push(policyNews.value.slice(0, 40));
  else if (policyHead) hooks.push(policyHead.value.slice(0, 40));
  const tech = dims.technical.items.find((i) => i.label === '走势配合');
  if (tech?.value && tech.value !== '中性') hooks.push(tech.value);
  const cap = dims.capital.items.find((i) => i.label === '资金关注');
  if (cap) hooks.push(cap.value.split('·')[0].trim());
  if (longTermPin) hooks.unshift(longTermPin.label);
  if (qualified?.downgraded && qualified.basis) hooks.push(qualified.basis);
  if (!hooks.length) {
    const score = inst.compositeScore != null ? `综合分 ${inst.compositeScore >= 0 ? '+' : ''}${Number(inst.compositeScore).toFixed(2)}` : null;
    return score || '波动与矛盾待进一步确认';
  }
  return hooks.slice(0, 5).join(' · ');
}

function buildInferenceNote(inst, evidence, qualified) {
  const dims = [];
  if (evidence.hasPolicyEvidence) dims.push('政策/资讯');
  if (evidence.corroborated >= 1) dims.push('技术');
  if (inst.capitalAttention?.score != null) dims.push('资金');
  const basis = dims.length ? `推断依据：${dims.join(' + ')}` : '推断依据不足';
  if (qualified.downgraded) {
    return `${basis} · 结论已降档，非凭空捏造`;
  }
  return `${basis} · 由可用维度推断，非单一因子`;
}

function buildTechnicalBlock(inst) {
  const tech = inst.factors?.technical;
  const vol = inst.factors?.volume;
  const items = [];
  if (!tech?.hasEnough) {
    return { status: '待校验', items: [{ label: '说明', value: 'K线样本不足', source: tech?.sourceNote || 'technical' }], dataSource: 'factors.technical' };
  }
  const ma = tech.maStack;
  if (ma?.alignmentLabel) {
    items.push({
      label: 'MA组合',
      value: [ma.alignmentLabel, ma.crossLabel].filter(Boolean).join(' · ') || ma.alignmentLabel,
      source: 'maStack',
    });
  }
  const boll = tech.boll;
  if (boll?.position) {
    const posMap = { upper: '上轨附近', lower: '下轨附近', middle: '中轨附近' };
    items.push({ label: 'BOLL', value: posMap[boll.position] || boll.position, source: 'bollinger' });
  }
  const bars = readCachedKlines(inst.id);
  const closes = (bars || []).map((b) => b.close).filter((c) => !Number.isNaN(c));
  const rsi = computeRsi14(closes);
  if (rsi != null) items.push({ label: 'RSI14', value: String(rsi), source: 'kline-derived' });

  const dir = inst.directionLabel || '震荡';
  const maAlign = ma?.alignment;
  let alignNote = '中性';
  if (maAlign === 'bullish' && /多|bull/i.test(dir)) alignNote = '技术面配合偏多';
  else if (maAlign === 'bearish' && /空|bear/i.test(dir)) alignNote = '技术面配合偏空';
  else if (maAlign && maAlign !== 'mixed') alignNote = '技术面与方向分歧';
  items.push({ label: '走势配合', value: alignNote, source: 'derived' });

  if (vol?.ratio != null) {
    items.push({ label: '量比', value: `${vol.ratio}× (${vol.label || '成交量'})`, source: 'volume' });
  }
  return { status: items.length ? 'ok' : '待校验', items, dataSource: 'factors.technical' };
}

function buildCapitalBlock(inst) {
  const cap = inst.capitalAttention;
  const oi = inst.factors?.oi;
  const tg = inst.tradingGuidance;
  const items = [];
  if (cap?.score != null) {
    items.push({
      label: '资金关注',
      value: `${cap.score}/100 · ${cap.label || cap.tier || ''}${
        cap.rank != null ? ` · 第${cap.rank}/${cap.rankOf}` : ''
      }`.trim(),
      source: cap.dataSource || 'capitalAttention',
    });
  } else if (cap?.available === false) {
    items.push({
      label: '资金关注',
      value: '暂无',
      source: cap.reason || cap.dataSource || 'missing',
    });
  }
  if (cap?.attitudeLabel) {
    items.push({
      label: '资金态度',
      value: `${cap.attitudeLabel}${cap.attitudeNote ? ` · ${cap.attitudeNote}` : ''}`,
      source: cap.dataSource || 'capital-attitude',
    });
  }
  if (cap?.horizons && (cap.horizons.oi1wPct != null || cap.horizons.oi1mPct != null || cap.horizons.oi3mPct != null)) {
    const h = cap.horizons;
    const bits = [];
    if (h.oi1wPct != null) bits.push(`1周${h.oi1wPct > 0 ? '+' : ''}${Number(h.oi1wPct).toFixed(1)}%`);
    if (h.oi1mPct != null) bits.push(`1月${h.oi1mPct > 0 ? '+' : ''}${Number(h.oi1mPct).toFixed(1)}%`);
    if (h.oi3mPct != null) bits.push(`3月${h.oi3mPct > 0 ? '+' : ''}${Number(h.oi3mPct).toFixed(1)}%`);
    items.push({
      label: '持仓多周期',
      value: bits.join(' · '),
      source: 'history/trading-oi',
    });
  }
  if (cap?.jointWithInventory) {
    items.push({
      label: '仓单·资金合证',
      value: cap.jointWithInventory,
      source: 'stock-flow-joint',
    });
  }
  if (tg?.phase) items.push({ label: '资金阶段', value: tg.phase, source: 'tradingGuidance' });
  if (oi?.current != null) {
    items.push({
      label: '持仓',
      value: oi.deltaPct != null ? `${oi.current} (Δ${fmtPct(oi.deltaPct)})` : String(oi.current),
      source: 'oi',
    });
  } else if (oi?.label) {
    items.push({ label: '持仓', value: oi.label, source: 'oi' });
  }
  if (!items.length) return { status: '暂无', items: [], dataSource: 'capitalAttention' };
  return { status: 'ok', items, dataSource: 'capitalAttention|oi|attitude' };
}

/**
 * 旧缓存可能无 intelligenceKernel / philosophy：优先用已存内核；
 * 否则用真实哲学重算；再否则用方向+合证+资金表面字段做可审计降级（不造假数）。
 */
function resolveIntelligenceKernel(inst) {
  if (inst?.intelligenceKernel?.available && inst.intelligenceKernel.mainContradiction) {
    return inst.intelligenceKernel;
  }
  try {
    const intel = require('./outlook-intelligence-kernel');
    let phil = inst.philosophy
      ? {
          ranked: inst.philosophy.ranked,
          sdFinance: inst.philosophy.sdFinance,
          secondaryDominates: inst.philosophy.secondaryDominates,
          contributions: inst.philosophy.contributions || null,
        }
      : null;

    if (!phil?.ranked?.primary?.length && !phil?.sdFinance) {
      try {
        const philosophy = require('./commodity-outlook-philosophy');
        const { getCachedAllData } = require('./data-fetcher');
        const sources = getCachedAllData?.() || {};
        const meta = { id: inst.id, name: inst.name, exchange: inst.exchange };
        const profile = require('./commodity-instrument-profiles').getInstrumentProfile(inst.id);
        if (profile && inst.factors?.technical) {
          const live = philosophy.evaluateInstrumentPhilosophy({
            meta,
            profile,
            spec: { id: inst.id, sector: inst.sector, bucket: inst.bucket },
            sources,
            technical: inst.factors.technical,
            liveQuote: { price: inst.price, changePct: inst.changePct },
            newsImpact: inst.factors?.news || { score: 0, shock: 0, hitCount: 0, hits: [] },
            sectorVolumeRank: null,
            changePct: inst.changePct,
            skipRegimePersistence: true,
          });
          phil = live;
        }
      } catch {
        // fall through to surface stub
      }
    }

    if (!phil?.ranked?.primary?.length && !phil?.sdFinance) {
      const score = inst.compositeScore != null ? Number(inst.compositeScore) : null;
      const label = inst.directionLabel || '震荡';
      phil = {
        ranked: {
          primary: [
            {
              id: 'cached_direction',
              label: `研判方向(${label})`,
              score: Number.isFinite(score) ? score : 0,
              weight: 0.28,
            },
          ],
          primaryChip: label,
        },
        sdFinance: Number.isFinite(score)
          ? { score, combinedLabel: label }
          : null,
        secondaryDominates: false,
        _degraded: true,
      };
    }

    const kernel = intel.evaluateIntelligenceKernel({
      phil,
      stockFlow: (() => {
        if (inst.factors?.inventory?.stockFlowJoint?.available) {
          return inst.factors.inventory.stockFlowJoint;
        }
        try {
          return require('./inventory-capital-joint').buildStockFlowJoint(
            inst.id,
            String(inst.judgementUpdatedAt || new Date().toISOString()).slice(0, 10)
          );
        } catch {
          return null;
        }
      })(),
      jointSignal:
        inst.factors?.inventory?.jointSignal ||
        inst.capitalAttention?.jointSignal ||
        null,
      capitalAttention: inst.capitalAttention || null,
      technical: inst.factors?.technical || null,
      newsImpact: inst.factors?.news || null,
      regime: inst.regime || null,
      baseBlend: inst.calibrationWeights || null,
      sourceLaneCount: inst.dataQuality ?? null,
      inventoryFactor: inst.factors?.inventory || null,
    });
    if (phil?._degraded && kernel) {
      kernel.degraded = true;
      kernel.note = (kernel.note ? `${kernel.note} · ` : '') + '哲学层缓存缺失·以研判方向+合证/资金表面字段降级';
      if (kernel.summary) kernel.summary = `${kernel.summary} · 降级`;
    }
    return kernel;
  } catch (err) {
    return {
      available: false,
      reason: err?.message || 'intel_resolve_failed',
      version: 'v1.56.26-intel-kernel',
    };
  }
}

function buildIntelligenceBlock(inst) {
  const ic = inst?.intelCenter;
  const memo = ic?.memo;
  if (memo?.available) {
    const items = [
      { label: '主矛盾', value: memo.headline || '暂无', source: 'intel-memo' },
      { label: '定价状态', value: memo.pricingState || '待校验', source: 'intel-pricing-state' },
      { label: '证伪时钟', value: ic.clock?.display || '—', source: 'intel-falsification-clock' },
      {
        label: '支持证据',
        value: (memo.support || []).map((s) => s.summary).slice(0, 3).join('；') || '暂无',
        source: 'intel-evidence-dsl',
      },
      {
        label: '反对意见',
        value: (memo.oppose || []).map((s) => s.summary).slice(0, 2).join('；') || '暂无',
        source: 'intel-evidence-dsl',
        tone: 'dissent',
      },
      {
        label: '改口条件',
        value: (memo.triggers || []).slice(0, 2).join('；') || '暂无',
        source: 'intel-claim-library',
      },
      {
        label: '推送层级',
        value: ic.pushTier?.tierLabel || '静默',
        source: 'intel-push-tier',
      },
      {
        label: '未知缺口',
        value: memo.unknownMap?.display || '暂无关键缺口',
        source: 'intel-memo',
      },
      {
        label: '红队',
        value: ic.redTeam?.display || '暂无',
        source: 'intel-red-team',
        tone: ic.redTeam?.forceDowngrade ? 'dissent' : undefined,
      },
      {
        label: '尺度协同',
        value: ic.horizonCoordination?.headline || '暂无',
        source: 'intel-horizon-coordination',
      },
      {
        label: '叙事阶段',
        value: ic.narrative?.display || '暂无',
        source: 'intel-narrative-epidemiology',
      },
      {
        label: '命题状态',
        value: ic.primaryClaim?.status || '暂无',
        source: 'intel-falsification-executor',
      },
      {
        label: '证伪触发',
        value: ic.primaryClaim?.falsifyTrigger || ic.falsifyEval?.display || ic.clock?.display || '监测中',
        source: 'intel-falsification-executor',
        tone: ic.primaryClaim?.status === 'falsified' || ic.primaryClaim?.status === 'falsifying' ? 'dissent' : undefined,
      },
    ];
    return {
      status: 'ok',
      items,
      kernel: inst.intelligenceKernel || ic.primaryClaim || null,
      intelCenter: { version: ic.version, memo, pricingState: ic.pricingState, pushTier: ic.pushTier },
      dataSource: 'focus-intelligence-brief|intel-center',
    };
  }

  const kernel = resolveIntelligenceKernel(inst);
  if (!kernel?.available) {
    return {
      status: '暂无',
      items: [
        {
          label: '情报内核',
          value: kernel?.reason === 'philosophy_missing' ? '主矛盾暂无 · 待哲学层' : '暂无',
          source: kernel?.reason || 'missing',
        },
      ],
      kernel: kernel || null,
      dataSource: 'outlook-intelligence-kernel',
    };
  }
  const mc = kernel.mainContradiction || {};
  const dissent = kernel.dissent || {};
  const sideLabel =
    mc.side === 'bull' ? '偏多' : mc.side === 'bear' ? '偏空' : mc.side === 'flat' ? '震荡' : '暂无';
  const items = [
    {
      label: '主矛盾',
      value: mc.available
        ? `${mc.label || '—'} · ${sideLabel}${mc.score != null ? ` (${mc.score > 0 ? '+' : ''}${mc.score})` : ''}`
        : '暂无',
      source: mc.source || 'philosophy.ranked.primary',
    },
    {
      label: '状态键',
      value: kernel.stateKey || '暂无',
      source: 'intel-kernel-state',
    },
  ];
  const support = (dissent.supportingEvidence || []).filter(Boolean);
  const oppose = (dissent.opposingEvidence || []).filter(Boolean);
  items.push({
    label: '支持证据',
    value: support.length ? support.slice(0, 3).join('；') : '暂无',
    source: dissent.dataSource || 'forced-dissent',
  });
  items.push({
    label: '反对意见',
    value: oppose.length ? oppose.slice(0, 4).join('；') : '反对意见:暂无对侧硬证据 · 结论脆弱',
    source: dissent.dataSource || 'forced-dissent',
    tone: 'dissent',
  });
  const flips = (dissent.flipConditions || []).filter(Boolean);
  if (flips.length) {
    items.push({
      label: '改口条件',
      value: flips.slice(0, 2).join('；'),
      source: 'forced-dissent',
    });
  }
  if (kernel.conviction?.scale != null) {
    items.push({
      label: '置信缩放',
      value: `×${kernel.conviction.scale}${
        kernel.conviction.notes?.length ? ` · ${kernel.conviction.notes.slice(0, 2).join('、')}` : ''
      }`,
      source: 'intel-conviction',
    });
  }
  if (kernel.conditionalWeights?.rationale?.length) {
    items.push({
      label: '权重理由',
      value: kernel.conditionalWeights.rationale.slice(0, 2).join('；'),
      source: 'state-conditional-blend',
    });
  }
  return {
    status: 'ok',
    items,
    kernel: {
      version: kernel.version,
      summary: kernel.summary || null,
      stateKey: kernel.stateKey || null,
      mainContradiction: mc,
      dissent: {
        lean: dissent.lean,
        supportingEvidence: support.slice(0, 6),
        opposingEvidence: oppose.slice(0, 6),
        dissentStrength: dissent.dissentStrength,
        flipConditions: flips.slice(0, 4),
      },
      conviction: kernel.conviction || null,
      conditionalWeights: kernel.conditionalWeights
        ? {
            philosophyWeight: kernel.conditionalWeights.philosophyWeight,
            adaptiveWeight: kernel.conditionalWeights.adaptiveWeight,
            factorWeight: kernel.conditionalWeights.factorWeight,
            stateKey: kernel.conditionalWeights.stateKey,
          }
        : null,
    },
    dataSource: kernel.dataSource || 'outlook-intelligence-kernel',
  };
}

function buildInventorySpotBlock(inst) {
  const inv = inst.factors?.inventory;
  const profile = inst.factors?.profile;
  const wh = inv?.warehouse;
  const items = [];
  if (wh?.level != null) {
    items.push({
      label: `仓单(${wh.exchange || '—'})`,
      value:
        wh.changeDod != null
          ? `${wh.level} · Δ${wh.changeDod}${wh.date ? ` · ${wh.date}` : ''}`
          : `${wh.level}${wh.date ? ` · ${wh.date}` : ''}`,
      source: wh.source || inv?.dataSource || 'warehouse',
    });
  } else if (inv?.label || inv?.score != null) {
    items.push({
      label: '库存/供需',
      value: inv.label || (inv.score != null ? `score ${inv.score}` : '—'),
      source: inv.dataSource || 'inventory-factor',
    });
  } else {
    items.push({ label: '仓单', value: '暂无', source: inv?.dataSource || 'missing' });
  }
  try {
    const feat = require('./member-oi-features').loadMemberOiFeatures(inst.id);
    if (feat?.available) {
      const conc =
        feat.buyTop5Share != null ? ` ·买Top5${(feat.buyTop5Share * 100).toFixed(0)}%` : '';
      items.push({
        label: '会员持仓',
        value: `买Δ${feat.buySub ?? '—'} / 卖Δ${feat.sellSub ?? '—'} · ${feat.contractId || ''}${conc}`,
        source: feat.dataSource || 'member-oi',
      });
    } else {
      items.push({
        label: '会员持仓',
        value: '暂无',
        source: feat?.reason || feat?.dataSource || 'member-oi',
      });
    }
  } catch {
    // optional
  }
  try {
    const visible = inst.factors?.inventory?.visibleInventory;
    if (visible?.available && visible.level != null) {
      items.push({
        label: visible.label || '显性库存',
        value: `${visible.level}${visible.unit || ''}${
          visible.changeWow != null ? ` ·Δ${visible.changeWow}` : ''
        }${visible.date ? ` ·${visible.date}` : ''}`,
        source: visible.dataSource || 'sector-fundamentals',
      });
    } else if (visible && !visible.available) {
      items.push({
        label: visible.label || '显性库存',
        value: '暂无',
        source: visible.reason || 'missing',
      });
    }
  } catch {
    // optional
  }
  if (profile?.supplyDemandType) {
    items.push({ label: '供需类型', value: profile.supplyDemandType, source: 'instrument-profile' });
  }
  if (inst.changePct != null) {
    items.push({ label: '现货/盘面', value: fmtPct(inst.changePct), source: inst.priceSource || 'live-quote' });
  } else if (inst.price != null) {
    items.push({ label: '现价', value: String(inst.price), source: inst.priceSource || 'quote' });
  }
  if (inst.latencyLabel) {
    items.push({ label: '现货反应', value: inst.latencyLabel, source: 'latency-channel' });
  }
  const hasReal = items.some((i) => i.value && i.value !== '暂无' && i.value !== '—');
  if (!hasReal) return { status: '暂无', items, dataSource: 'inventory|spot' };
  return { status: 'ok', items, dataSource: 'inventory|spot|dce-member' };
}

function buildRankReasons(inst, dims, evidence, qualified) {
  const reasons = [];
  if (evidence.hasNews) reasons.push('品种要闻已验证');
  else if (evidence.hasPolicyLogic) reasons.push('政策逻辑可追溯');
  if (dims.technical.items.some((i) => i.value?.includes('配合'))) reasons.push('技术面同向');
  if (inst.capitalAttention?.score >= 65) reasons.push('资金关注偏高');
  if (inst.tradingGuidance?.phase === '升温') reasons.push('资金阶段升温');
  if (detectLongTermPin(inst, evidence)) reasons.push('长线方向强烈(有政策/资讯支撑)');
  if (qualified?.downgraded) reasons.push('方向已降档(缺资讯)');
  if (inst.regimeGate?.gated) reasons.push('RegimeGate 抑制交易');
  if (inst.tradingGuidance?.posture === '禁止') reasons.push('风控禁止开仓');
  if (inst.contradictionMatrix?.conflictCount > 0) {
    reasons.push(`矛盾矩阵 ${inst.contradictionMatrix.conflictCount} 组`);
  }
  const intelItems = dims.intelligence?.items || [];
  const mainItem = intelItems.find((i) => i.label === '主矛盾');
  if (mainItem?.value && mainItem.value !== '暂无') {
    reasons.push(`主矛盾 ${String(mainItem.value).slice(0, 28)}`);
  }
  const dissentItem = intelItems.find((i) => i.label === '反对意见');
  if (dissentItem?.value && !/暂无对侧硬证据/.test(dissentItem.value)) {
    reasons.push('存在强制反对意见');
  } else if (dissentItem?.value && /结论脆弱/.test(dissentItem.value)) {
    reasons.push('对侧证据不足·结论脆弱');
  }
  return reasons.length ? reasons : ['多维评分靠前(证据有限)'];
}

function buildBattleIntel(inst, options = {}) {
  const webNews = options.webNews || loadCachedWebNews(inst.id);
  const newsPack = buildPolicyNewsItems(inst, { webNews, outlookPayload: options.outlookPayload });
  const intelligence = buildIntelligenceBlock(inst);
  const dimensions = {
    intelligence,
    policySupply: buildPolicySupplyBlock(inst, newsPack),
    technical: buildTechnicalBlock(inst),
    capital: buildCapitalBlock(inst),
    inventorySpot: buildInventorySpotBlock(inst),
  };
  const evidence = assessEvidence(dimensions);
  const qualifiedDirection = buildQualifiedDirection(inst, evidence);
  const longTermPin = detectLongTermPin(inst, evidence);
  const watchThesis = buildWatchThesis(inst, dimensions, longTermPin, evidence, qualifiedDirection);
  const rankReasons = buildRankReasons(inst, dimensions, evidence, qualifiedDirection);
  const inferenceNote = buildInferenceNote(inst, evidence, qualifiedDirection);
  const posture = inst.tradingGuidance?.posture || '暂无';
  let executionNote =
    posture === '禁止' || posture === '观望'
      ? `执行建议：${posture}（关注矛盾演化，非盲目追单）`
      : `执行建议：${posture}${inst.tradingGuidance?.position?.note ? ` · ${inst.tradingGuidance.position.note}` : ''}`;
  if (qualifiedDirection.downgraded) {
    executionNote += ` · ${qualifiedDirection.basis}`;
  }
  if (intelligence?.kernel?.conviction?.scale != null && intelligence.kernel.conviction.scale < 0.7) {
    executionNote += ` · 情报置信×${intelligence.kernel.conviction.scale}（反对意见/主矛盾约束）`;
  }

  let contradictionMatrix = null;
  let competingHypotheses = [];
  try {
    const cm = require('./contradiction-matrix');
    const enrichedInst = { ...inst, qualifiedDirection };
    contradictionMatrix = cm.buildContradictionMatrix(enrichedInst);
    competingHypotheses = contradictionMatrix.competingHypotheses || [];
    cm.persistCompetingHypotheses?.(contradictionMatrix);
  } catch {
    // optional lane
  }

  return {
    version: BRIEF_VERSION,
    symbol: inst.id,
    name: inst.name,
    watchThesis,
    executionNote,
    rankReasons,
    inferenceNote,
    qualifiedDirection,
    evidence,
    longTermPin,
    dimensions,
    intelligenceKernel: intelligence.kernel || null,
    contradictionMatrix,
    competingHypotheses,
    newsFetchedAt: webNews?.fetchedAt || null,
    newsSource: webNews?.dataSource || null,
    asOf: inst.judgementUpdatedAt || new Date().toISOString(),
    dataSource: 'focus-intelligence-brief|outlook-intelligence-kernel',
  };
}

function attachIntelToRankedRows(rankedRows, instrumentMap, outlookPayload = {}) {
  return rankedRows.map((row) => {
    const inst = instrumentMap.get(String(row.symbol).toLowerCase());
    if (!inst) return { ...row, intel: null };
    const intel = buildBattleIntel(inst, { outlookPayload });
    return {
      ...row,
      bias: intel.qualifiedDirection?.label || row.bias,
      directionLabel: intel.qualifiedDirection?.label || row.bias,
      watchThesis: intel.watchThesis,
      executionNote: intel.executionNote,
      inferenceNote: intel.inferenceNote,
      rankReasons: intel.rankReasons,
      longTermPin: intel.longTermPin,
      intel,
    };
  });
}

function buildTop5IntelPackage(instruments = [], outlookPayload = {}) {
  const map = new Map(instruments.map((i) => [String(i.id).toLowerCase(), i]));
  const { pickTop5, pickMajorOpportunities, rankFocusInstruments } = require('./focus-opportunity-ranker');
  const ranked = rankFocusInstruments(instruments, { outlook: outlookPayload });
  const withIntel = attachIntelToRankedRows(ranked, map, outlookPayload);
  withIntel.sort((a, b) => {
    if (Boolean(a.longTermPin?.pinned) !== Boolean(b.longTermPin?.pinned)) return a.longTermPin?.pinned ? -1 : 1;
    if (a.isMajorOpportunity !== b.isMajorOpportunity) return a.isMajorOpportunity ? -1 : 1;
    return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
  });
  const top5 = withIntel.slice(0, 5).map((r, idx) => ({ ...r, rank: idx + 1 }));
  const majorOpportunities = withIntel.filter((r) => r.isMajorOpportunity || r.longTermPin);
  return { top5, majorOpportunities, ranked: withIntel };
}

module.exports = {
  BRIEF_VERSION,
  buildBattleIntel,
  attachIntelToRankedRows,
  buildTop5IntelPackage,
  detectLongTermPin,
  resolveIntelligenceKernel,
  buildIntelligenceBlock,
};
