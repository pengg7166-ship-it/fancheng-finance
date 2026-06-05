const TAB_KEYS = ['indices', 'commodities', 'macro', 'forex', 'policy', 'geopolitics', 'climate', 'outlook', 'fed', 'boj', 'treasury', 'xinhua'];
const TAB_LABELS = {
  indices: '全球指数',
  commodities: '大宗商品',
  macro: '中美宏观',
  forex: '外汇',
  policy: '政策雷达',
  geopolitics: '地缘政治',
  climate: '天气气候',
  outlook: '大宗走势研判',
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
const OUTLOOK_INSTRUMENT_ROW_HEIGHT = 72;
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
const VIRTUAL_OVERSCAN = 4;
const VIRTUAL_MAX_ROWS = 32;
const FILTER_DEBOUNCE_MS = 450;
const OUTLOOK_DEBOUNCE_MS = 800;

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
let outlookSelectedInstrumentId = null;
let outlookBacktestRunning = false;
let outlookLongrunRunning = false;
let outlookBacktestSummaryCache = null;
let outlookLongrunSummaryCache = null;
const OUTLOOK_PRICE_PATCH_MIN_MS = 1000;
const outlookPricePatchAtById = new Map();

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
let rafWorkQueue = [];
let rafWorkScheduled = false;
let rafLoopId = null;
let rendererPaused = false;
let panelInitObserver = null;
const virtualListRegistry = new WeakMap();
const CHUNK_DOM_SIZE = 20;

const FRED_APPLY_URL = 'https://fredaccount.stlouisfed.org/apikeys';
const STOOQ_APPLY_URL = 'https://stooq.pl/q/d/?s=^dax&get_apikey';

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
  pendingRenderData = null;
  renderAllScheduled = false;
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
  if (rendererPaused) {
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
  if (rendererPaused) return;
  if (fn) rafWorkQueue.push(fn);
  if (rafWorkScheduled) return;
  rafWorkScheduled = true;
  rafLoopId = requestAnimationFrame(processRafQueue);
}

function scheduleIdleWork(fn) {
  scheduleRafWork(fn);
}

function destroyVirtualList(scrollEl) {
  const state = virtualListRegistry.get(scrollEl);
  if (!state) return;
  state.destroy?.();
  virtualListRegistry.delete(scrollEl);
  scrollEl.dataset.virtualMounted = '';
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
      scheduleRafWork(() => applyIncrementalDataUpdate(pending));
    } else {
      scheduleRafWork(() => executeRenderAll(pending));
    }
  }
}

function bindWindowFocusHandlers() {
  const onFocusChange = (focused) => {
    if (focused) resumeRendererWork();
    else pauseRendererWork();
  };
  if (window.fancheng?.onWindowFocusChanged) {
    window.fancheng.onWindowFocusChanged(({ focused }) => onFocusChange(Boolean(focused)));
  }
  document.addEventListener('visibilitychange', () => onFocusChange(!document.hidden));
  window.addEventListener('blur', () => onFocusChange(false));
  window.addEventListener('focus', () => onFocusChange(true));
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

  return `<article class="policy-commodity-row policy-commodity-row-geo policy-commodity-row-${dir}" data-link="${escapeAttr(item.link || '')}" data-geo-id="${escapeAttr(item.id || '')}">
    <div class="pcol pcol-stars">${renderPolicyStars(item.stars)}</div>
    <div class="pcol pcol-commodities"><span class="reading-row-badge reading-badge-geo">地缘</span></div>
    <div class="pcol pcol-dir"><span class="policy-dir-pill policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span></div>
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

  return `<article class="policy-commodity-row policy-commodity-row-stars-${n} policy-commodity-row-${dir}" data-policy-id="${escapeAttr(item.id)}" data-link="${escapeAttr(item.link)}">
    <div class="pcol pcol-stars">${renderPolicyStars(item.stars)}</div>
    <div class="pcol pcol-commodities">${commodityBadges}</div>
    <div class="pcol pcol-dir"><span class="policy-dir-pill policy-direction-${dir}">${escapeHtml(item.directionLabel || '中性')}</span></div>
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

function outlookDirectionClass(dir) {
  if (dir === 'bullish') return 'outlook-direction-bullish';
  if (dir === 'bearish') return 'outlook-direction-bearish';
  return 'outlook-direction-neutral';
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
      const actions = panel?.querySelector('.outlook-toolbar-actions');
      const badges = actions?.querySelectorAll('.outlook-hit-rate, .outlook-hit-rate-longrun');
      const html = renderOutlookHitRateBadge(window.__outlookCacheStats);
      if (badges?.length) badges.forEach((b) => b.remove());
      actions?.insertAdjacentHTML('beforeend', html);
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
    const hitEl = panel?.querySelector('.outlook-hit-rate');
    if (hitEl && window.__outlookCacheStats) hitEl.outerHTML = renderOutlookHitRateBadge(window.__outlookCacheStats);
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
  const overall = summary?.overallHitRate != null ? `${Math.round(summary.overallHitRate * 100)}%` : '—';
  const samples = summary?.sampleHitRates || {};
  const fmt = (r) => (r?.hitRate != null ? `${Math.round(r.hitRate * 100)}%` : '—');
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
  const o30 = summary?.overallHitRate30d != null ? `${Math.round(summary.overallHitRate30d * 100)}%` : '—';
  const o60 = summary?.overallHitRate60d != null ? `${Math.round(summary.overallHitRate60d * 100)}%` : '—';
  body.innerHTML = `<p class="outlook-backtest-overall">整体 30d ${o30} · 60d ${o60} · ${summary?.instrumentCount ?? 0} 品种</p>${renderOutlookBacktestSectorTable(summary)}`;
  modal.hidden = false;
}

function setupOutlookBacktestListeners(panel) {
  if (!window.fancheng?.onOutlookBacktestProgress || panel.dataset.backtestListener === '1') return;
  panel.dataset.backtestListener = '1';
  window.fancheng.onOutlookBacktestProgress((progress) => {
    window.__outlookBacktestProgress = progress;
    const slot = panel.querySelector('.outlook-backtest-progress-slot');
    if (slot) slot.innerHTML = renderOutlookBacktestProgress(progress);
  });
}

function renderOutlookHorizonCell(h) {
  if (!h) return '<span class="outlook-horizon-empty">—</span>';
  return `<div class="outlook-horizon-cell ${outlookDirectionClass(h.direction)}">
    <span class="outlook-dir-arrow" aria-hidden="true">${escapeHtml(h.directionArrow || '→')}</span>
    <span class="outlook-dir-label">${escapeHtml(h.directionLabel || '震荡')}</span>
    <span class="outlook-stars" title="置信度">${escapeHtml(h.starsHtml || '')}</span>
    <p class="outlook-commentary">${escapeHtml(h.commentary || '')}</p>
  </div>`;
}

function getOutlookBaseRange(inst) {
  return inst?.scenarios?.base || inst?.nextDayRangePct || {};
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
  if (!sc?.base) return '';
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
  return `<p class="outlook-latency-line">双速通道：即时权重 ${wI} · 滞后权重 ${wD} · 状态 <strong>${escapeHtml(state)}</strong>${inst.instantScore != null ? ` · 即时分${inst.instantScore >= 0 ? '+' : ''}${Number(inst.instantScore).toFixed(2)}` : ''}${inst.delayedScore != null ? ` · 滞后分${inst.delayedScore >= 0 ? '+' : ''}${Number(inst.delayedScore).toFixed(2)}` : ''}</p>`;
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

function renderOutlookPredictionBoxes(inst) {
  if (inst.outlookPending) {
    return '<div class="outlook-pred-pending">行情待加载</div>';
  }
  const base = inst.scenarios?.base || inst.nextDayRangePct || {};
  const stress = inst.scenarios?.stress;
  const volPm = inst.nextDayRangePct?.expectedMovePct ?? inst.nextDayRangePct?.halfWidth;
  const stressVol =
    stress?.expectedMovePct ?? stress?.halfWidth ?? (volPm != null ? Number(volPm) * 1.35 : null);
  const mid = base.mid != null ? formatOutlookPctSign(base.mid, 3) : '—';
  const deltaMidHtml =
    inst.changeDelta?.deltaMid != null
      ? `<span class="outlook-pred-delta-mid">较上次 Δ${inst.changeDelta.deltaMid >= 0 ? '+' : ''}${Number(inst.changeDelta.deltaMid).toFixed(2)}%</span>`
      : '';
  const rationaleLine = inst.rationaleSummary
    ? `<span class="outlook-rationale-mini" title="${escapeAttr(inst.predictionRationale || inst.rationaleSummary)}">缘由摘要 ${escapeHtml(inst.rationaleSummary)}</span>`
    : '';
  const volLine =
    volPm != null
      ? `<span class="outlook-vol-line">预测波动 ±${Number(volPm).toFixed(2)}%</span>`
      : '';
  const stressVolLine =
    stressVol != null
      ? `<span class="outlook-vol-line outlook-vol-line-extreme">预测波动 ±${Number(stressVol).toFixed(2)}%</span>`
      : '';
  const envHit =
    inst.envBacktestHitRate != null
      ? `<span class="outlook-env-hit-rate" title="历史同类环境方向命中率">同类环境 ${Math.round(inst.envBacktestHitRate * 100)}%</span>`
      : '';
  const smoothBox = `<div class="outlook-pred-box outlook-pred-smooth">
    <span class="outlook-pred-box-title">平滑预测</span>
    <span class="outlook-pred-box-range">${formatOutlookRangePct(base)}</span>
    <span class="outlook-pred-box-mid">中心 ${escapeHtml(mid)}</span>
    ${envHit}
    ${deltaMidHtml}
    ${volLine}
    ${rationaleLine}
  </div>`;
  const stressRange = stress ? formatOutlookRangePct(stress) : formatOutlookRangePct(base);
  const stressBadge = inst.scenarios?.stressTriggered
    ? '<span class="outlook-pred-trigger on">突变触发</span>'
    : '<span class="outlook-pred-trigger off">未触发</span>';
  const extremeBox = `<div class="outlook-pred-box outlook-pred-extreme">
    <span class="outlook-pred-box-title">极端预测</span>
    <span class="outlook-pred-box-range">${stressRange}</span>
    ${stressVolLine}
    ${stressBadge}
  </div>`;
  return `<div class="outlook-pred-boxes">${smoothBox}${extremeBox}</div>`;
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

function renderOutlookSectorHitBadges(stats) {
  const bySector = stats?.longRunBySector;
  if (!bySector) return '';
  const target = stats?.hitRateTarget ?? 0.7;
  return Object.entries(bySector)
    .map(([id, s]) => {
      const pct = s.hitRate != null ? Math.round(s.hitRate * 100) : null;
      const gap = s.hitRate != null ? Math.round((target - s.hitRate) * 100) : null;
      const cls = pct == null ? 'empty' : pct >= 70 ? 'hit-target' : pct >= 55 ? 'hit-mid' : 'hit-low';
      const title =
        pct != null
          ? `${s.label || id} 长周期 ${pct}% · 目标70% · 差距${gap >= 0 ? '+' : ''}${gap}pp`
          : `${s.label || id} 暂无回测`;
      return `<span class="outlook-sector-hit ${cls}" data-sector="${escapeAttr(id)}" title="${escapeAttr(title)}">${escapeHtml(s.label || id)} ${pct != null ? pct + '%' : '—'}</span>`;
    })
    .join('');
}

function renderOutlookHitRateBadge(stats) {
  const target = stats?.hitRateTarget ?? 0.7;
  const longRun = stats?.longRunHitRate;
  const gapOverall = longRun != null ? Math.round((target - longRun) * 100) : null;
  const longRunBadge =
    longRun != null
      ? `<span class="outlook-hit-rate outlook-hit-rate-longrun${longRun >= target ? ' hit-target' : ''}" title="2019→今 walk-forward · 目标70% · 差距${gapOverall >= 0 ? '+' : ''}${gapOverall}pp">长周期 ${Math.round(longRun * 100)}% / 目标70%</span>`
      : '';
  const sectorBadges = renderOutlookSectorHitBadges(stats);
  const bt30 = stats?.backtestHitRate30d;
  const bt60 = stats?.backtestHitRate60d;
  if (bt30 != null || bt60 != null) {
    const p30 = bt30 != null ? Math.round(bt30 * 100) : '—';
    const p60 = bt60 != null ? Math.round(bt60 * 100) : '—';
    return `${longRunBadge}${sectorBadges}<span class="outlook-hit-rate outlook-hit-rate-backtest" title="walk-forward回测方向命中率">回测 30d ${p30}% · 60d ${p60}%</span>`;
  }
  if (longRunBadge || sectorBadges) return `${longRunBadge}${sectorBadges}`;
  const hit = stats?.directionHitRate7d;
  if (!hit || hit.total < 1) {
    return '<span class="outlook-hit-rate outlook-hit-rate-empty" title="运行回测或近7日校验后显示">回测命中率 — · 目标70%</span>';
  }
  const pct = Math.round((hit.rate ?? 0) * 100);
  return `<span class="outlook-hit-rate" title="近7日方向命中 ${hit.hits}/${hit.total}">近7日 ${pct}%</span>`;
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
  const sample = inst.backtestSampleLast10;
  const eraTable = renderOutlookLongrunEraTable(inst.backtestByEra ? { byEra: inst.backtestByEra } : outlookLongrunSummaryCache);
  if (hitLong == null && hit30 == null && !sample?.length && !outlookLongrunSummaryCache?.byEra) {
    return '<p class="outlook-accuracy-empty">运行「运行回测」或「长周期 2019至今」后显示 walk-forward 历史命中率</p>';
  }
  const longPct = hitLong != null ? `${Math.round(hitLong * 100)}%` : '—';
  const pct30 = hit30 != null ? `${Math.round(hit30 * 100)}%` : '—';
  const gap = inst.backtestAvgGapPct != null ? formatOutlookPctSign(inst.backtestAvgGapPct) : '—';
  const longRange =
    inst.backtestLongrunStart && inst.backtestLongrunEnd
      ? `${inst.backtestLongrunStart}→${inst.backtestLongrunEnd}`
      : '2019→今';
  const sampleRows = (sample || [])
    .slice(-10)
    .map(
      (d) =>
        `<tr><td>${escapeHtml(String(d.date || '').slice(0, 10))}</td><td>${escapeHtml(d.predictedDir || '—')}</td><td>${d.actualReturn != null ? formatOutlookPctSign(d.actualReturn) : '—'}</td><td>${d.hitDirection ? '✓' : d.hitDirection === false ? '✗' : '—'}</td></tr>`
    )
    .join('');
  return `<div class="outlook-historical-backtest">
    <ul class="outlook-historical-stats">
      <li>长周期 ${escapeHtml(longRange)} 方向命中 <strong>${longPct}</strong>${inst.backtestLongrunTotal ? ` <span class="outlook-hit-sample">(${inst.backtestLongrunHits}/${inst.backtestLongrunTotal})</span>` : ''}</li>
      <li>近30日方向命中 <strong>${pct30}</strong></li>
      <li>预测中心平均差距 <strong>${gap}</strong></li>
    </ul>
    <h6 class="outlook-era-subhead">时代分段（COVID / 加息 / 俄乌 / 反内卷 / 2026地缘）</h6>
    ${eraTable}
    ${sampleRows ? `<table class="outlook-accuracy-table outlook-backtest-sample"><thead><tr><th>日期</th><th>预测</th><th>实际</th><th>命中</th></tr></thead><tbody>${sampleRows}</tbody></table>` : ''}
  </div>`;
}

function renderOutlookToolbar(source, sectors, sectorCounts, activeSector) {
  const stamp = source.liveRefreshedAt || source.updatedAt;
  const stampLabel = stamp ? formatDate(stamp) : '—';
  return `<div class="outlook-toolbar">
    ${renderOutlookSectorTabs(sectors, activeSector, sectorCounts)}
    <div class="outlook-toolbar-actions">
      <span class="outlook-toolbar-stamp">研判更新 ${escapeHtml(stampLabel)}</span>
      <button type="button" class="btn-link outlook-toolbar-backtest" data-action="run-outlook-backtest"${outlookBacktestRunning ? ' disabled' : ''} title="近60日 walk-forward">运行回测</button>
      <button type="button" class="btn-link outlook-toolbar-longrun" data-action="run-outlook-longrun-backtest"${outlookLongrunRunning || outlookBacktestRunning ? ' disabled' : ''} title="2019→今 walk-forward，首次约需数分钟">长周期 2019至今</button>
      <button type="button" class="btn-link outlook-toolbar-archive" data-action="open-outlook-history-global">研判存档</button>
      <button type="button" class="btn-link outlook-toolbar-daily-compare" data-action="open-outlook-daily-compare">每日对照</button>
      <button type="button" class="btn-link outlook-toolbar-calibration" data-action="open-outlook-calibration" title="板块权重与命中率">板块校准</button>
      ${renderOutlookHitRateBadge(source.stats)}
      <span class="outlook-backtest-progress-slot">${renderOutlookBacktestProgress(window.__outlookBacktestProgress)}</span>
    </div>
  </div>`;
}

function renderOutlookYesterdayArchiveRow(inst) {
  const ya = inst.yesterdayArchive;
  if (!ya || ya.predictedMid == null) return '';
  const hit = ya.hitDirection ? '✓' : ya.hitDirection === false ? '✗' : '—';
  const hitClass = ya.hitDirection ? 'hit' : ya.hitDirection === false ? 'miss' : '';
  return `<tr class="outlook-accuracy-yesterday">
    <td>昨日存档 ${escapeHtml(ya.date || '')}</td>
    <td>${escapeHtml(formatOutlookPctSign(ya.predictedMid))}</td>
    <td>${ya.actualPct != null ? escapeHtml(formatOutlookPctSign(ya.actualPct)) : '待收盘'}</td>
    <td>${ya.gapPct != null ? escapeHtml(formatOutlookPctSign(ya.gapPct)) : '—'}</td>
    <td class="outlook-accuracy-hit ${hitClass}">${hit}</td>
  </tr>`;
}

function renderOutlookAccuracyTable(inst) {
  const records = inst.accuracyRecords || [];
  const pending = inst.pendingPrediction;
  const yesterdayRow = renderOutlookYesterdayArchiveRow(inst);
  if (!records.length && !pending && !yesterdayRow) {
    return '<p class="outlook-accuracy-empty">等待收盘校验：实质变更存档后将自动比对预测中心 vs 实际涨跌幅</p>';
  }
  const rows = records
    .slice(0, 5)
    .map((r) => {
      const ts = r.predictTs ? formatDate(r.predictTs) : '—';
      const hit = r.hitDirection ? '✓' : '✗';
      const hitClass = r.hitDirection ? 'hit' : 'miss';
      return `<tr>
        <td>${escapeHtml(ts)}</td>
        <td>${escapeHtml(formatOutlookPctSign(r.predictedMid))}</td>
        <td>${escapeHtml(formatOutlookPctSign(r.actualPct))}</td>
        <td>${escapeHtml(formatOutlookPctSign(r.gapPct))}</td>
        <td class="outlook-accuracy-hit ${hitClass}">${hit}</td>
      </tr>`;
    })
    .join('');
  const pendingRow = pending
    ? `<tr class="outlook-accuracy-pending"><td>${escapeHtml(pending.predictTs ? formatDate(pending.predictTs) : '—')}</td><td>${escapeHtml(formatOutlookPctSign(pending.predictedMid))}</td><td colspan="2">等待收盘校验</td><td>—</td></tr>`
    : '';
  return `<table class="outlook-accuracy-table">
    <thead><tr><th>预测时间</th><th>预测中心%</th><th>实际%</th><th>差距</th><th>方向</th></tr></thead>
    <tbody>${yesterdayRow}${rows}${pendingRow}</tbody>
  </table>`;
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
    <h5>研判逻辑</h5>
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

function renderOutlookDetailPanel(inst) {
  if (!inst) {
    return '<div class="outlook-detail-panel outlook-detail-panel-hint"><p class="empty-state">点击品种查看<strong>预测缘由</strong>与<strong>历史对照</strong>；打开页后将自动选中首行</p></div>';
  }
  return `<div class="outlook-detail-panel" data-outlook-detail-for="${escapeAttr(inst.id)}">
    <header class="outlook-detail-panel-head">
      <h4 class="outlook-detail-panel-title">${escapeHtml(inst.name || inst.id)} · 研判详情</h4>
      <span class="outlook-judgement-stamp">研判 ${escapeHtml(inst.judgementUpdatedDisplay || '')}</span>
      ${renderOutlookRegimeBadge(inst)}
      <button type="button" class="btn-link outlook-history-btn" data-action="open-outlook-history" data-instrument="${escapeAttr(inst.id)}">研判存档</button>
      <button type="button" class="btn-link outlook-detail-close" data-action="close-outlook-detail">收起</button>
    </header>
    <div class="outlook-detail-panel-grid">
      <div class="outlook-detail-panel-col outlook-detail-col-scenarios">
        ${renderOutlookScenariosTable(inst)}
        ${renderOutlookChangeDelta(inst)}
      </div>
      <div class="outlook-detail-panel-col outlook-detail-col-rationale">
        ${renderOutlookPhilosophyBlock(inst)}
        <h5>预测缘由</h5>
        <p class="outlook-prediction-rationale">${escapeHtml(inst.predictionRationale || inst.rationale || '—')}</p>
        <h5>历史对照</h5>
        ${renderOutlookHistoricalBlock(inst)}
        ${renderOutlookLatencyBlock(inst)}
        ${inst.profileSummary ? `<p class="outlook-profile-summary">${escapeHtml(inst.profileSummary)}</p>` : ''}
      </div>
      <div class="outlook-detail-panel-col outlook-detail-col-accuracy">
        <h5>历史回测</h5>
        ${renderOutlookHistoricalBacktestBlock(inst)}
        <h5>预测校验</h5>
        ${renderOutlookAccuracyTable(inst)}
        <h5>因子贡献</h5>
        ${renderOutlookFactorBreakdownTable(inst) || '<p class="outlook-accuracy-empty">因子数据积累中</p>'}
      </div>
    </div>
  </div>`;
}

function findOutlookInstrument(instrumentId) {
  const list = window.__outlookCacheInstruments || [];
  return list.find((i) => i.id === instrumentId) || null;
}

function updateOutlookDetailPanel(panel, instrumentId) {
  if (!panel) return;
  const slot = panel.querySelector('.outlook-detail-slot');
  if (!slot) return;
  const inst = instrumentId ? findOutlookInstrument(instrumentId) : null;
  slot.innerHTML = renderOutlookDetailPanel(inst);
  slot.hidden = false;
  panel.querySelectorAll('.outlook-instrument-row').forEach((row) => {
    const on = row.dataset.outlookInstrument === instrumentId;
    row.classList.toggle('outlook-instrument-selected', on);
    const btn = row.querySelector('.outlook-instrument-main');
    if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
  if (inst && window.fancheng?.getOutlookHistory) {
    void window.fancheng.getOutlookHistory(inst.id, 14).then((data) => {
      if (!data || data.error || outlookSelectedInstrumentId !== inst.id) return;
      inst.accuracyRecords = data.accuracyRecords || inst.accuracyRecords;
      inst.pendingPrediction = data.pendingPrediction ?? inst.pendingPrediction;
      const col = slot.querySelector('.outlook-detail-col-accuracy');
      if (col) {
        const table = col.querySelector('.outlook-accuracy-table');
        const empty = col.querySelector('.outlook-accuracy-empty');
        const html = renderOutlookAccuracyTable(inst);
        if (table) table.outerHTML = html;
        else if (empty) empty.outerHTML = html;
        else {
          const h5 = col.querySelector('h5');
          if (h5?.nextElementSibling) h5.insertAdjacentHTML('afterend', html);
        }
      }
    });
  }
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

function renderOutlookRationaleBrief(inst) {
  const sum =
    inst.rationaleSummary || (inst.predictionRationale || '').split('\n')[0]?.trim().slice(0, 40) || '—';
  return `<span class="outlook-rationale-brief" title="${escapeAttr(inst.predictionRationale || sum)}"><span class="outlook-rationale-icon" aria-hidden="true">ℹ</span> ${escapeHtml(sum)}</span>`;
}

function ensureOutlookDefaultSelection(instruments) {
  if (outlookSelectedInstrumentId) return;
  const visible =
    outlookSectorFilter === 'all'
      ? instruments
      : (instruments || []).filter((i) => i.sector === outlookSectorFilter);
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
  if (cap?.score == null) return '<span class="outlook-cap-badge outlook-cap-flat">—</span>';
  const score = cap?.score ?? 0;
  const tier = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
  const subs = cap.subMetrics || {};
  const subParts = [
    subs.volumeRatio5d != null ? `量比5d ${subs.volumeRatio5d}` : '',
    subs.oiChangePct != null ? `持仓${subs.oiChangePct > 0 ? '+' : ''}${subs.oiChangePct}%` : '',
    subs.intradayRangePct != null ? `振幅${subs.intradayRangePct}%` : '',
  ].filter(Boolean);
  return `<span class="outlook-cap-badge outlook-cap-${tier}" title="${escapeAttr(subParts.join(' · '))}">资金关注 ${score}/100</span>`;
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
    ${renderOutlookScenariosTable(inst)}
    <p class="outlook-rationale">${escapeHtml(inst.rationale || '')}</p>
    ${inst.profileSummary ? `<p class="outlook-profile-summary">${escapeHtml(inst.profileSummary)}</p>` : ''}
    <div class="outlook-detail-grid">
      <div class="outlook-detail-block">
        <h5>因子贡献分解</h5>
        ${renderOutlookFactorBreakdownTable(inst)}
      </div>
      <div class="outlook-detail-block">
        <h5>资金关注 ${cap?.score != null ? `${cap.score}/100` : '—'}</h5>
        <ul class="outlook-indicator-list">
          <li>量比5日：${cap?.subMetrics?.volumeRatio5d ?? vol.ratio ?? '—'}</li>
          <li>量比20日：${cap?.subMetrics?.volumeRatio20d ?? '—'}</li>
          <li>持仓变化：${cap?.subMetrics?.oiChangePct != null ? `${cap.subMetrics.oiChangePct > 0 ? '+' : ''}${cap.subMetrics.oiChangePct}%` : oi.deltaPct != null ? `${oi.deltaPct > 0 ? '+' : ''}${oi.deltaPct}%` : oi.display || '—'}</li>
          <li>成交额代理：${cap?.subMetrics?.turnoverProxy != null ? cap.subMetrics.turnoverProxy.toLocaleString('zh-CN') : '—'}</li>
          <li>盘中振幅：${cap?.subMetrics?.intradayRangePct ?? '—'}%</li>
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
    return `<div class="outlook-price-box" data-outlook-price-for="${escapeAttr(inst.id)}">
      <div class="outlook-price-val">${Number(inst.price).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</div>
      ${inst.unit ? `<div class="outlook-price-unit">${escapeHtml(inst.unit)}</div>` : ''}
      <div class="outlook-chg-box ${chgClass}">${escapeHtml(chgText)}</div>
    </div>`;
  }
  return `<div class="outlook-price-box outlook-price-box-missing" data-outlook-price-for="${escapeAttr(inst.id)}">
    <div class="outlook-price-val outlook-price-missing">—</div>
    ${inst.priceReason ? `<div class="outlook-price-reason">${escapeHtml(inst.priceReason)}</div>` : ''}
    <div class="outlook-chg-box chg-flat">—</div>
  </div>`;
}

function mergeCommoditiesPricesIntoOutlookCache(commodities) {
  const quoteMap = flattenCommoditiesLiveMap(commodities);
  if (!quoteMap.size || !window.__outlookCacheInstruments?.length) return false;
  let changed = false;
  window.__outlookCacheInstruments = window.__outlookCacheInstruments.map((inst) => {
    const q = quoteMap.get(normCommodityId(inst.id));
    if (!q || q.price == null || Number.isNaN(Number(q.price))) return inst;
    const price = q.price;
    const changePct = q.changePct;
    const unit = q.unit || inst.unit;
    if (inst.price === price && inst.changePct === changePct && inst.unit === unit && !inst.outlookPending) {
      return inst;
    }
    changed = true;
    return {
      ...inst,
      price,
      changePct,
      unit,
      outlookPending: false,
      priceReason: inst.priceReason === '行情未加载' || inst.priceReason === '报价不可用' ? null : inst.priceReason,
    };
  });
  return changed;
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

function updateOutlookPriceCells(commoditiesOrInstruments, options = {}) {
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

const refreshOutlookOnPricePatchDebounced = debounce(() => {
  if (window.fancheng?.fetchOutlookLive) void refreshOutlookLive({ force: false });
}, OUTLOOK_DEBOUNCE_MS);

function applyCommoditiesLiveToOutlook(commodities) {
  if (!commodities || commodities.error) return;
  window.__preloadedCommoditiesLive = commodities;
  const changed = mergeCommoditiesPricesIntoOutlookCache(commodities);
  updateOutlookPriceCells(commodities, { batch: true, flash: true });
  if (changed) refreshOutlookOnPricePatchDebounced();
}

function renderOutlookInstrumentRow(inst) {
  const techTags = renderOutlookTechTags(inst);
  const selected = outlookSelectedInstrumentId === inst.id;
  const priceHtml = renderOutlookPriceBox(inst);

  return `<article class="outlook-instrument-row ${outlookDirectionClass(inst.direction)}${selected ? ' outlook-instrument-selected' : ''}${inst.insufficientData ? ' outlook-insufficient-data' : ''}${inst.secondaryDominates ? ' outlook-secondary-warning' : ''}" data-outlook-instrument="${escapeAttr(inst.id)}" data-outlook-sector="${escapeAttr(inst.sector || 'all')}">
    <button type="button" class="outlook-instrument-main" data-action="select-outlook-instrument" aria-expanded="${selected ? 'true' : 'false'}">
      <div class="outlook-inst-col outlook-inst-name">
        <span class="outlook-inst-title">${renderOutlookPrimaryDriverChip(inst)}${escapeHtml(inst.name || inst.id)}${inst.secondaryDominates ? '<span class="outlook-secondary-warn-badge" title="次矛盾权重异常偏高">⚠次矛盾</span>' : ''}${inst.insufficientData ? '<span class="outlook-insufficient-badge">数据不足·观望</span>' : ''}</span>
        <span class="outlook-inst-ex">${escapeHtml(inst.exchange || '')}</span>
      </div>
      <div class="outlook-inst-col outlook-inst-price">${priceHtml}</div>
      <div class="outlook-inst-col outlook-inst-predict">
        ${renderOutlookPredictionBoxes(inst)}
      </div>
      <div class="outlook-inst-col outlook-inst-rationale">${renderOutlookRationaleBrief(inst)}</div>
      <div class="outlook-inst-col outlook-inst-cap">
        ${renderOutlookCapitalBadge(inst)}
      </div>
      <div class="outlook-inst-col outlook-inst-dir">
        <span class="outlook-dir-arrow">${escapeHtml(inst.directionArrow || '→')}</span>
        <span class="outlook-dir-label">${escapeHtml(inst.directionLabel || '震荡')}</span>
        <span class="outlook-stars" title="置信度（含波动稳定性）">${escapeHtml(inst.starsHtml || '')}</span>
        <span class="outlook-composite-score" title="综合分">${escapeHtml(inst.compositeScoreDisplay || (inst.compositeScore != null ? `${inst.compositeScore >= 0 ? '+' : ''}${Number(inst.compositeScore).toFixed(2)}` : ''))}</span>
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
  return `<article class="outlook-factor-card ${outlookDirectionClass(f.direction)}" data-outlook-factor="${escapeAttr(f.id)}">
    <header class="outlook-factor-head">
      <span class="outlook-factor-icon">${escapeHtml(f.icon || '')}</span>
      <span class="outlook-factor-label">${escapeHtml(f.label || '')}</span>
      <span class="outlook-dir-arrow outlook-factor-arrow">${escapeHtml(f.directionArrow || '→')}</span>
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
  const hasData = source?.instruments?.length || source?.categories?.length;
  if (!hasData) return false;
  const hasRows = panel.querySelector('.outlook-instrument-row');
  if (hasData && !hasRows) return true;
  return false;
}

function applyOutlookSectorFilter(panel, sector = outlookSectorFilter) {
  if (!panel) return;
  const rows = panel.querySelectorAll('.outlook-instrument-row');
  let visible = 0;
  rows.forEach((row) => {
    const rowSector = row.dataset.outlookSector || '';
    const show = sector === 'all' || rowSector === sector;
    row.hidden = !show;
    if (show) visible += 1;
  });
  const emptyEl = panel.querySelector('.outlook-sector-empty');
  if (emptyEl) emptyEl.hidden = visible > 0;
}

function getOutlookCachedSource() {
  if (!window.__outlookCacheCategories?.length && !window.__outlookCacheInstruments?.length) return null;
  return {
    categories: window.__outlookCacheCategories,
    instruments: window.__outlookCacheInstruments,
    factors: window.__outlookCacheFactors,
    framework: window.__outlookCacheFramework,
    stats: window.__outlookCacheStats,
    dataLabel: '大宗商品走势研判 · 逐品种多因子 · 次日波动区间',
    liveRefreshedAt: window.__outlookCacheLiveAt,
    updatedAt: window.__outlookCacheUpdatedAt,
  };
}

function cacheOutlookSource(source) {
  if (!source) return;
  if (source.error) window.__outlookLoadError = source.error;
  if (!source.categories?.length && !source.instruments?.length) return;
  window.__outlookCacheCategories = source.categories;
  window.__outlookCacheInstruments = outlookBacktestSummaryCache
    ? mergeBacktestIntoOutlookInstruments(source.instruments, outlookBacktestSummaryCache)
    : source.instruments;
  window.__outlookCacheFactors = source.factors;
  window.__outlookCacheFramework = source.framework;
  window.__outlookCacheStats = source.stats;
  window.__outlookCacheLiveAt = source.liveRefreshedAt || source.updatedAt;
  window.__outlookCacheUpdatedAt = source.updatedAt;
  window.__outlookLoadError = null;
  window.__outlookEmptyReady = false;
}

function isOutlookPanelPlaceholder(panel) {
  return Boolean(panel && !panel.querySelector('.outlook-panel'));
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
  const panel = document.getElementById('panel-outlook');
  if (!panel) return;
  const hasData = source?.instruments?.length || source?.categories?.length;

  if (hasData) {
    cacheOutlookSource(source);
    if (outlookPanelNeedsFullMount(panel, source) || !panel.querySelector('.outlook-panel')) {
      replaceSinglePanel('outlook', source);
      setupOutlookPanel();
      applyOutlookSectorFilter(document.getElementById('panel-outlook'), outlookSectorFilter);
    } else if (isActivePanel('outlook')) {
      refreshOutlookPanelSectionsDebounced(panel, source);
      applyOutlookSectorFilter(panel, outlookSectorFilter);
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
    if (isActivePanel('outlook')) mountOutlookPanel({ _placeholder: 'empty' });
    return;
  }
  try {
    const outlook = await window.fancheng.fetchOutlookLive(options);
    if (outlook?.error) {
      window.__outlookLoadError = outlook.error;
      if (isActivePanel('outlook')) mountOutlookPanel(outlook);
      return;
    }
    if (outlook?.instruments?.length || outlook?.categories?.length) {
      applyOutlookLiveData(outlook);
      return;
    }
    window.__outlookEmptyReady = true;
    if (isActivePanel('outlook')) mountOutlookPanel({ _placeholder: 'empty', ...outlook });
  } catch (err) {
    window.__outlookLoadError = localizeUiMessage(err.message || '研判刷新失败');
    if (isActivePanel('outlook')) mountOutlookPanel({ error: window.__outlookLoadError });
  }
}

async function activateOutlookTab() {
  if (window.fancheng?.bootstrapOutlookDaily) {
    void window.fancheng.bootstrapOutlookDaily();
  }
  void loadOutlookBacktestSummaryCache();
  void loadOutlookLongrunSummaryCache().then((lr) => {
    if (lr?.instruments?.length && window.__outlookCacheInstruments?.length) {
      window.__outlookCacheInstruments = mergeLongrunIntoOutlookInstruments(window.__outlookCacheInstruments, lr);
    }
    if (lr && window.__outlookCacheStats) {
      window.__outlookCacheStats.longRunHitRate = lr.overallHitRate;
      window.__outlookCacheStats.longRunByEra = lr.byEra;
    }
  });
  const panelEarly = document.getElementById('panel-outlook');
  if (panelEarly) setupOutlookBacktestListeners(panelEarly);
  const cached = getOutlookCachedSource();
  const startupCommodities = window.__startupSources?.commodities || window.__preloadedCommoditiesLive;
  const hasCommodityQuotes = startupCommodities?.exchanges?.some((ex) =>
    (ex.items || []).some((item) => item.price != null)
  );
  if ((!cached?.instruments?.length || (cached.instruments.length < 60 && hasCommodityQuotes)) && hasCommodityQuotes) {
    await refreshOutlookLive({ force: true });
    return;
  }
  if (cached?.instruments?.length || cached?.categories?.length) {
    mountOutlookPanel(cached);
    if (startupCommodities) applyCommoditiesLiveToOutlook(startupCommodities);
    const mounted = document.getElementById('panel-outlook');
    if (mounted?.querySelector('.outlook-instrument-row') || mounted?.querySelector('.outlook-panel')) {
      void refreshOutlookLive({ force: false });
      return;
    }
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
  try {
    await refreshOutlookLive({ force: true });
  } finally {
    clearTimeout(slowTimer);
  }
}

function renderOutlookPanel(source) {
  const hasData = source.instruments?.length || source.categories?.length;
  const liveTag = source.liveRefreshedAt
    ? `<span class="policy-live-tag policy-live-badge outlook-live-tag"><span class="policy-live-dot"></span>实时 ${formatDate(source.liveRefreshedAt)}</span>`
    : '';
  const regimeTag =
    source.globalRegime && source.globalRegime !== 'neutral'
      ? `<span class="outlook-global-regime">${escapeHtml(source.globalRegimeLabel || source.globalRegime)}</span>`
      : '';

  if (!hasData) {
    return renderOutlookPlaceholder(source);
  }

  window.__outlookCacheCategories = source.categories;
  window.__outlookCacheInstruments = source.instruments;
  window.__outlookCacheFactors = source.factors;
  window.__outlookCacheFramework = source.framework;
  window.__outlookCacheStats = source.stats;

  const instruments = source.instruments || [];
  ensureOutlookDefaultSelection(instruments);
  const sectorCounts = countOutlookInstrumentsBySector(instruments);
  const sectors = source.sectors || source.framework?.sectors || [];
  const instrumentRows = instruments.map(renderOutlookInstrumentRow).join('');
  const factorCards = (source.factors || []).map(renderOutlookFactorCard).join('');
  const categoryCards = (source.categories || []).map(renderOutlookCategoryCard).join('');
  const selectedInst = outlookSelectedInstrumentId ? findOutlookInstrument(outlookSelectedInstrumentId) : null;
  const hitRateNote = renderOutlookHitRateBadge(source.stats);

  return `<div class="panel ${activeTab === 'outlook' ? 'active' : ''}" id="panel-outlook" role="tabpanel">
    <div class="policy-panel policy-reading-v2 outlook-panel">
      <div class="outlook-core-header-strip">
        <div class="outlook-core-banner">
          <span class="outlook-core-banner-icon" aria-hidden="true">◆</span>
          <span class="outlook-core-banner-text">核心研判 · 全板块数据汇入</span>
        </div>
        <span class="outlook-core-ribbon" aria-label="核心功能">CORE</span>
      </div>
      <header class="policy-reading-head">
        <div class="policy-reading-head-main">
          <h2 class="policy-reading-title">${escapeHtml(source.dataLabel || '大宗走势研判')}</h2>
          ${renderOutlookStatsInline(source.stats)}
        </div>
        ${liveTag}${regimeTag}
      </header>
      ${renderOutlookMacroStrip(source.factors)}
      <section class="outlook-section outlook-section-primary">
        <div class="outlook-section-head">
          <h3 class="outlook-section-title">逐品种研判 · 平滑/极端双框预测</h3>
          <span class="outlook-section-meta">${instruments.length} 品种 · 点击行查看下方详情</span>
        </div>
        ${renderOutlookToolbar(source, sectors, sectorCounts, outlookSectorFilter)}
        <div class="outlook-table-wrap">
          <div class="outlook-instrument-head-row" aria-hidden="true">
            <span>品种</span><span>现价</span><span>次日预测</span><span>预测依据</span><span>资金关注</span><span>方向·综合分</span><span>技术标签</span><span></span>
          </div>
          <div class="outlook-instrument-list" data-outlook-instrument-count="${instruments.length}">${instrumentRows}</div>
        </div>
        <p class="outlook-sector-empty empty-state" hidden>当前板块暂无品种数据</p>
        <div class="outlook-detail-slot">${renderOutlookDetailPanel(selectedInst)}</div>
      </section>
      <section class="outlook-section outlook-section-secondary">
        <h3 class="outlook-section-title">四大类 outlook 参考</h3>
        <div class="outlook-category-grid">${categoryCards}</div>
      </section>
      <p class="policy-note outlook-note outlook-core-tagline">核心研判 · 全板块数据汇入 · v1.25.0 回测校准 · ${hitRateNote}${source.stats?.todayArchiveCount != null ? ` · 今日存档 ${source.stats.todayArchiveCount} 条` : ''} · 仅供参考</p>
    </div>
  </div>`;
}

function refreshOutlookPanelSections(panel, source) {
  if (!panel || !isActivePanel('outlook')) return;
  const data = source || {
    categories: window.__outlookCacheCategories || [],
    instruments: window.__outlookCacheInstruments || [],
    factors: window.__outlookCacheFactors || [],
    framework: window.__outlookCacheFramework,
    stats: window.__outlookCacheStats,
    dataLabel: '大宗商品走势研判 · 逐品种多因子 · 次日波动区间',
  };
  if (!data.instruments?.length && !data.categories?.length) return;

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
  if (hitRateEl && data.stats?.directionHitRate7d) {
    hitRateEl.outerHTML = renderOutlookHitRateBadge(data.stats);
  }

  const instList = panel.querySelector('.outlook-instrument-list');
  if (instList && data.instruments?.length) {
    const hash = hashListInputs([
      'outlook-inst',
      data.instruments
        .map(
          (i) =>
            `${i.id}:${i.direction}:${i.regime}:${i.latencyState}:${i.judgementUpdatedAt}:${i.scenarios?.base?.low}:${i.scenarios?.base?.high}:${i.compositeScore}:${i.predictionRationale}`
        )
        .join(','),
    ]);
    if (instList.dataset.listHash !== hash) {
      instList.dataset.listHash = hash;
      instList.innerHTML = data.instruments.map(renderOutlookInstrumentRow).join('');
      instList.dataset.outlookInstrumentCount = String(data.instruments.length);
      updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
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
  if (data?.sources?.commodities) {
    applyCommoditiesLiveToOutlook(data.sources.commodities);
  }
  if (!data?.sources?.outlook?.instruments?.length && !data?.sources?.outlook?.categories?.length) {
    if (window.fancheng?.fetchOutlookLive) void refreshOutlookLive({ force: false });
    return;
  }
  applyOutlookLiveData(data.sources.outlook);
}, OUTLOOK_DEBOUNCE_MS);

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
      const selectBtn = e.target.closest('[data-action="select-outlook-instrument"]');
      if (!selectBtn) return;
      e.preventDefault();
      const row = selectBtn.closest('.outlook-instrument-row');
      const id = row?.dataset?.outlookInstrument;
      if (!id) return;
      outlookSelectedInstrumentId = id;
      updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
    });
  }
  applyOutlookSectorFilter(panel, outlookSectorFilter);
  if (outlookSelectedInstrumentId) updateOutlookDetailPanel(panel, outlookSelectedInstrumentId);
}

function applyOutlookLiveData(source) {
  if (source?.error) {
    window.__outlookLoadError = source.error;
    if (isActivePanel('outlook') && !rendererPaused) mountOutlookPanel(source);
    return;
  }
  if (!source?.instruments?.length && !source?.categories?.length) return;

  cacheOutlookSource(source);

  if (!isActivePanel('outlook')) {
    updateNavTabBadge('outlook', source.instruments?.length || source.categories?.length);
    return;
  }
  if (rendererPaused) return;

  mountOutlookPanel(source);

  const stamp = source.liveRefreshedAt || source.updatedAt;
  const panel = document.getElementById('panel-outlook');
  if (source.instruments?.length) {
    updateOutlookPriceCells(source.instruments, { batch: true, force: true, flash: true });
  } else if (window.__preloadedCommoditiesLive) {
    applyCommoditiesLiveToOutlook(window.__preloadedCommoditiesLive);
  }
  const liveTag = panel?.querySelector('.outlook-live-tag');
  if (liveTag && stamp) {
    liveTag.innerHTML = `<span class="policy-live-dot"></span>实时 ${formatDate(stamp)}`;
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
      <p class="policy-note">数据来源：中国政府网 · 新华社 · 人民网 · SEC · 美联储 · Federal Register · 大宗关联政策独立列示 · 点击条目打开原文 · 星级为系统自动评估</p>
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
    window.__outlookCacheCategories = source.categories;
    window.__outlookCacheInstruments = source.instruments;
    window.__outlookCacheFactors = source.factors;
    window.__outlookCacheFramework = source.framework;
    window.__outlookCacheStats = source.stats;
  }
  if (key === 'indices') return renderIndicesPanel(source);
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
        <div class="macro-groups">${renderMacroGroups(source)}</div>
      </div>
    </div>`;
  }

  if (key === 'forex') return renderForexPanel(source);
  if (key === 'policy') return renderPolicyPanel(source);
  if (key === 'geopolitics') return renderGeopoliticsPanel(source);
  if (key === 'climate') return renderClimatePanel(source);
  if (key === 'outlook') return renderOutlookPanel(source);

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
  const stamp = source.liveRefreshedAt || source.updatedAt;
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

function applyIncrementalDataUpdate(data, { fromCache = false } = {}) {
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
      mountOutlookPanel(sources.outlook);
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
      ? `本地缓存 ${formatDate(data.fetchedAt)} · 后台更新中…`
      : `正在加载数据… ${formatDate(data.fetchedAt)}`;
  } else if (data.partial && hasIndexData(data)) {
    $('#lastUpdated').textContent = `指数已就绪 ${formatDate(data.fetchedAt)} · 其余数据后台加载中…`;
  } else if (!fromCache && data.fetchedAt) {
    $('#lastUpdated').textContent = `后台更新 ${formatDate(data.fetchedAt)}`;
  }
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
  if (
    existingOutlook?.querySelector('.outlook-instrument-row') &&
    !(incomingOutlook?.instruments?.length)
  ) {
    savedOutlook = existingOutlook;
    savedOutlook.remove();
  }

  panels.innerHTML = TAB_KEYS.map((key) => {
    if (key === 'outlook' && savedOutlook) {
      return renderOutlookPlaceholder({});
    }
    return renderPanel(key, data.sources[key] || {});
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

function renderAll(data) {
  if (rendererPaused) {
    pendingRenderData = data;
    return;
  }
  pendingRenderData = data;
  if (renderAllScheduled) return;
  renderAllScheduled = true;
  scheduleRafWork(() => {
    renderAllScheduled = false;
    const payload = pendingRenderData;
    pendingRenderData = null;
    if (payload) executeRenderAll(payload);
  });
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
    return;
  }
  banner.textContent = `部分数据源获取失败：${errors.map((e) => `${TAB_LABELS[e.key] || e.key}（${localizeUiMessage(e.message)}）`).join('；')}`;
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
    if (hasIndexData(data)) indicesRendered = true;
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
    scheduleRafWork(() => applyIncrementalDataUpdate(data, { fromCache }));
  } else {
    renderAll(data);
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
      ? `本地缓存 ${formatDate(data.fetchedAt)} · 后台更新中…`
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
  if (!panel || !source?.items?.length || !isActivePanel('policy') || rendererPaused) return;

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

  const stamp = source.liveRefreshedAt || source.updatedAt;
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
  if (rendererPaused) return;

  const panel = document.getElementById('panel-geopolitics');
  if (panel) refreshGeopoliticsPanelSectionsDebounced(panel, source);

  const stamp = source.liveRefreshedAt || source.updatedAt;
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
  if (rendererPaused) return;

  const panel = document.getElementById('panel-climate');
  if (panel) refreshClimatePanelSectionsDebounced(panel, source);

  const stamp = source.liveRefreshedAt || source.updatedAt;
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

  refreshTimer = setInterval(() => loadData(true), refreshIntervalMs);
  liveRefreshTimer = setInterval(refreshLive, Math.max(quoteRefreshMs, 45000));
  // 政策/地缘/气候/外汇/央行实时推送由主进程 push loop + on*Live 处理，避免重复 IPC 拉取
}

function switchTab(key) {
  if (key === activeTab) return;
  cancelPendingPanelRenders();
  activeTab = key;
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

function updateIndicesCards(source) {
  if (!source?.regions) return;
  for (const region of source.regions) {
    for (const idx of region.indices || []) {
      if (!idx.id) continue;
      const card = document.querySelector(`.index-card-clickable[data-index-id="${idx.id}"]`);
      if (card) {
        const active = card.classList.contains('index-card-active');
        card.outerHTML = renderIndexCard(idx);
        if (active) {
          document
            .querySelector(`.index-card-clickable[data-index-id="${idx.id}"]`)
            ?.classList.add('index-card-active');
        }
      }
    }
  }
  setupIndexCards();
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
  if (activeTab !== 'indices' && activeTab !== 'commodities' && activeTab !== 'macro') return;
  isLiveRefreshing = true;
  const badge = $('#liveBadge');
  badge?.classList.remove('hidden');

  try {
    if (activeTab === 'indices') {
      const quotes = await window.fancheng.fetchIndicesLive();
      if (!quotes.error && quotes.regions) {
        updateIndicesCards(quotes);
      }

      if (currentKlines.length > 0) {
        const updated = await window.fancheng.refreshIndexKline(
          selectedIndexId,
          selectedTimeframe,
          currentKlines
        );
        if (!updated.error) {
          applyKlineData(updated, true);
        }
      }
    } else if (activeTab === 'commodities') {
      await window.CommoditiesUI.refreshLive();
    } else if (activeTab === 'macro') {
      await refreshMacroLive();
    }

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
}

function closeSettings() {
  $('#settingsModal').classList.add('hidden');
}

async function loadSettingsForm() {
  const cfg = await window.fancheng.getConfig();
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

  const saved = await window.fancheng.saveConfig(partial);
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
      saved.fredApiKeyConfigured && saved.stooqApiKeyConfigured
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
}

async function applyCacheFallback() {
  try {
    const snapshot = await withTimeout(window.fancheng.getStartupSnapshot(), 5000, null);
    if (snapshot?.allData?.sources && hasIndexData(snapshot.allData)) {
      window.__preloadedCommoditiesLive = snapshot.commoditiesLive || window.__preloadedCommoditiesLive;
      return applyStartupDataSafe(snapshot.allData, { fromCache: true });
    }
  } catch {
    // ignore
  }
  return false;
}

async function loadIndicesQuick(cfg = {}) {
  if (typeof window.fancheng.fetchIndicesQuick !== 'function') return false;
  try {
    const indices = await withTimeout(window.fancheng.fetchIndicesQuick(), 20000, null);
    if (!indices || indices.error) return false;
    if (!indices.regions?.some((r) => r.indices?.length)) return false;
    return applyStartupDataSafe(buildDataFromIndices(indices, cfg), {
      fromCache: Boolean(indices.fromCache),
    });
  } catch {
    return false;
  }
}

async function fetchDataInBackground(force = false) {
  try {
    const data = await withTimeout(
      window.fancheng.fetchAll({ force, fast: !force }),
      force ? 45000 : 35000,
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
    $('#errorBanner')?.classList.add('hidden');
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
  showIndicesLoading();

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

    let applied = false;

    const pushed = await waitForStartupPush(800);
    if (pushed?.sources && hasIndexData(pushed)) {
      window.__preloadedCommoditiesLive = pushed.commoditiesLive;
      applied = applyStartupDataSafe(pushed, { fromCache: true });
    }

    if (!applied) {
      const snapshot = await withTimeout(window.fancheng.getStartupSnapshot(), 10000, null);
      if (snapshot?.allData?.sources && hasIndexData(snapshot.allData)) {
        window.__preloadedCommoditiesLive = snapshot.commoditiesLive;
        window.__preloadedForexLive = snapshot.forexLive;
        applied = applyStartupDataSafe(snapshot.allData, { fromCache: true });
      }
    }

    if (!applied) {
      applied = await loadIndicesQuick(cfg);
    }

    if (!applied) {
      showIndicesLoading();
      $('#lastUpdated').textContent = '正在连接数据源…';
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
        if (activeTab === 'commodities' && window.CommoditiesUI?.mergeLiveData) {
          window.CommoditiesUI.mergeLiveData(commodities);
        }
      });
    }

    if (window.fancheng.onIndicesLive) {
      window.fancheng.onIndicesLive((indices) => {
        if (!indices?.regions?.some((r) => r.indices?.length)) return;
        if (isActivePanel('indices')) {
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
        if (!data?.sources) return;
        applyStartupDataSafe(data);
        showErrors(data.errors || []);
        $('#lastUpdated').textContent = `后台更新 ${formatDate(data.fetchedAt)}`;
        if (activeTab === 'forex' && data.sources?.forex?.pairs?.length) {
          applyForexLiveData(data.sources.forex);
        }
        if (activeTab === 'policy' && data.sources?.policy?.items?.length) {
          window.__policyCacheItems = data.sources.policy.items;
          applyPolicyLiveData(data.sources.policy);
        }
        if (activeTab === 'geopolitics' && data.sources?.geopolitics?.items?.length) {
          window.__geoCacheItems = data.sources.geopolitics.items;
          applyGeopoliticsLiveData(data.sources.geopolitics);
        }
        if (activeTab === 'climate' && data.sources?.climate?.items?.length) {
          window.__climateCacheItems = data.sources.climate.items;
          applyClimateLiveData(data.sources.climate);
        }
        refreshOutlookOnDataRefreshedDebounced(data);
        if (activeTab === 'fed' && hasCentralBankLivePayload(data.sources?.fed)) {
          applyFedLiveData(data.sources.fed);
        }
        if (activeTab === 'boj' && hasCentralBankLivePayload(data.sources?.boj)) {
          applyBojLiveData(data.sources.boj);
        }
        $('#errorBanner')?.classList.add('hidden');
      });
    }

    if (window.fancheng.onStartupData) {
      window.fancheng.onStartupData((data) => {
        if (!data?.sources || !hasIndexData(data)) return;
        applyStartupDataSafe(data, { fromCache: true });
        $('#errorBanner')?.classList.add('hidden');
      });
    }

    startAutoRefresh();
    bindWindowFocusHandlers();
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

    fetchDataInBackground(false);

    if (!cfg.fredApiKeyConfigured) {
      setTimeout(openSettings, 1500);
    }
  } catch (err) {
    hideLoadingOverlay();
    showIndicesLoading();
    $('#errorBanner').textContent = `初始化异常：${localizeUiMessage(err.message)}`;
    $('#errorBanner').classList.remove('hidden');
    fetchDataInBackground(false);
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

document.addEventListener('DOMContentLoaded', () => {
  updateAppVersionLabel();
  setupTabs();
  setupSettings();
  $('#refreshBtn').addEventListener('click', () => loadData(false, { force: true }));

  setTimeout(hideLoadingOverlay, 2500);
  bootstrapApp();
});
