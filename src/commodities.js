/** 大宗商品 Tab UI — 左侧列表 + 行情条 + K 线 + 资讯 */
const CommoditiesUI = (() => {
  let selectedId = 'cu';
  let selectedExchange = 'all';
  let searchQuery = '';
  let selectedTimeframe = 'day';
  let historyCache = {};
  let currentKlines = [];
  let klineOffset = 0;
  const klineViewCount = 120;
  let liveData = null;
  let allItems = [];
  let newsCache = {};
  let isRefreshing = false;

  const EXCHANGE_TABS = [
    { id: 'all', label: '全部' },
    { id: 'shfe', label: '上期所' },
    { id: 'dce', label: '大商所' },
    { id: 'zce', label: '郑商所' },
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => root.querySelectorAll(sel);

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

  function formatPrice(price) {
    if (price == null || Number.isNaN(price)) return '—';
    if (price >= 10000) return formatNumber(price, 0);
    if (price >= 1000) return formatNumber(price, 1);
    if (price >= 100) return formatNumber(price, 2);
    return formatNumber(price, 2);
  }

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

  function localize(msg) {
    return typeof window.localizeText === 'function' ? window.localizeText(msg) : msg;
  }

  function getSelectedItem() {
    return allItems.find((i) => i.id === selectedId) || null;
  }

  function getFilteredItems() {
    let items = allItems;
    if (selectedExchange !== 'all') {
      items = items.filter((i) => i.exchangeId === selectedExchange);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          (i.sinaSymbol || '').toLowerCase().includes(q)
      );
    }
    return items;
  }

  function renderPanelShell(activeTab) {
    return `<div class="panel ${activeTab === 'commodities' ? 'active' : ''}" id="panel-commodities" role="tabpanel">
      <div class="commodities-layout">
        <aside class="commodities-sidebar">
          <div class="commodities-sidebar-head">
            <h3 class="commodities-sidebar-title"><span class="dot dot-commodities"></span>品种列表</h3>
            <p id="commoditiesStats" class="commodities-stats"></p>
          </div>
          <div class="commodities-exchange-tabs" id="commodityExchangeTabs" role="tablist">
            ${EXCHANGE_TABS.map(
              (t) =>
                `<button type="button" class="commodities-ex-tab${t.id === selectedExchange ? ' active' : ''}" data-ex="${t.id}" role="tab">${t.label}</button>`
            ).join('')}
          </div>
          <div class="commodities-search-wrap">
            <input id="commoditySearch" class="commodities-search" type="search" placeholder="搜索品种名称或代码…" autocomplete="off" />
          </div>
          <div id="commoditiesList" class="commodities-list" role="listbox">
            <div class="chart-loading">正在加载行情…</div>
          </div>
        </aside>

        <div class="commodities-body">
          <header id="commodityQuoteBar" class="commodity-quote-bar">
            <div class="chart-loading">请选择左侧品种</div>
          </header>

          <div class="commodities-body-split">
            <section class="commodities-chart-area">
              <div class="commodities-chart-toolbar">
                <div class="kline-tabs" id="commodityKlineTabs" role="tablist">
                  <button type="button" class="kline-tab" data-tf="year">年K</button>
                  <button type="button" class="kline-tab" data-tf="month">月K</button>
                  <button type="button" class="kline-tab" data-tf="week">周K</button>
                  <button type="button" class="kline-tab active" data-tf="day">日K</button>
                  <button type="button" class="kline-tab" data-tf="hour">小时K</button>
                </div>
              </div>
              <div id="commodityHistorySummary" class="history-summary commodities-kline-summary"></div>
              <div class="kline-scroll-row">
                <label for="commodityKlineScroll">时间轴</label>
                <input id="commodityKlineScroll" type="range" min="0" max="0" value="0" />
                <span id="commodityKlineScrollLabel" class="kline-scroll-label"></span>
              </div>
              <div id="commodityHistoryChart" class="history-chart commodities-chart">
                <div class="chart-loading">选择品种以加载 K 线…</div>
              </div>
              <details class="kline-table-wrap" id="commodityKlineTableWrap">
                <summary>查看完整开高低收量数据</summary>
                <div class="kline-table-scroll">
                  <table class="kline-table" id="commodityKlineTable"></table>
                </div>
              </details>
            </section>

            <aside class="commodities-news-panel">
              <h3 class="commodities-news-title"><span class="dot dot-commodities"></span>关联资讯</h3>
              <p class="commodities-news-sources" id="commodityNewsSources"></p>
              <div id="commodityNewsList" class="commodities-news-list">
                <div class="chart-loading">加载资讯中…</div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderListRow(item) {
    const active = item.id === selectedId ? ' commodities-list-row-active' : '';
    if (!item.available) {
      return `<button type="button" class="commodities-list-row commodities-list-row-na${active}" data-commodity-id="${escapeAttr(item.id)}" role="option" aria-selected="${item.id === selectedId}">
        <span class="commodities-list-name">${escapeHtml(item.name)}</span>
        <span class="commodities-list-price">—</span>
        <span class="commodities-list-pct">停盘</span>
      </button>`;
    }
    const up = item.change >= 0;
    return `<button type="button" class="commodities-list-row${active}" data-commodity-id="${escapeAttr(item.id)}" role="option" aria-selected="${item.id === selectedId}">
      <span class="commodities-list-name">${escapeHtml(item.name)}</span>
      <span class="commodities-list-price">${formatPrice(item.price)}</span>
      <span class="commodities-list-pct ${up ? 'change-up' : 'change-down'}">${up ? '+' : ''}${formatNumber(item.changePct, 2)}%</span>
    </button>`;
  }

  function renderQuoteBar(item) {
    const bar = $('#commodityQuoteBar');
    if (!bar) return;
    if (!item) {
      bar.innerHTML = '<div class="empty-state">请选择左侧品种</div>';
      return;
    }
    if (!item.available) {
      bar.innerHTML = `<div class="commodity-quote-main">
        <div><span class="commodity-quote-name">${escapeHtml(item.name)}</span><span class="commodity-quote-ex">${escapeHtml(item.exchange)}</span></div>
        <div class="commodity-quote-na">暂无行情数据</div>
      </div>`;
      return;
    }
    const up = item.change >= 0;
    bar.innerHTML = `<div class="commodity-quote-main">
      <div class="commodity-quote-title">
        <span class="commodity-quote-name">${escapeHtml(item.name)}</span>
        <span class="commodity-quote-ex">${escapeHtml(item.exchange)}</span>
        <span class="commodity-quote-code">${escapeHtml(item.sinaSymbol || item.id)}</span>
        ${item.priceReason ? `<span class="commodity-close-badge">${escapeHtml(item.priceReason)}${item.closingDate ? ` ${escapeHtml(item.closingDate)}` : ''}</span>` : ''}
      </div>
      <div class="commodity-quote-price ${up ? 'change-up' : 'change-down'}">${formatPrice(item.price)}</div>
      <div class="commodity-quote-change ${up ? 'change-up' : 'change-down'}">
        ${up ? '▲' : '▼'} ${formatNumber(Math.abs(item.change))}
        <span>（${up ? '+' : ''}${formatNumber(item.changePct, 2)}%）</span>
      </div>
    </div>
    <div class="commodity-quote-details">
      <span>开盘 <b>${formatPrice(item.open)}</b></span>
      <span>最高 <b class="change-up">${formatPrice(item.high)}</b></span>
      <span>最低 <b class="change-down">${formatPrice(item.low)}</b></span>
      <span>成交量 <b>${formatNumber(item.volume, 0)}</b></span>
      <span>持仓量 <b>${formatNumber(item.openInterest, 0)}</b></span>
      <span class="commodity-quote-unit">${escapeHtml(item.unit || '')}</span>
    </div>`;
  }

  function renderList() {
    const listEl = $('#commoditiesList');
    if (!listEl) return;

    const items = getFilteredItems();
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state">未找到匹配品种</div>';
      return;
    }

    listEl.innerHTML = items.map(renderListRow).join('');
    setupListRows();
  }

  function setupListRows() {
    $$('.commodities-list-row').forEach((row) => {
      row.addEventListener('click', () => selectCommodity(row.dataset.commodityId));
    });
  }

  function setupExchangeTabs() {
    $$('#commodityExchangeTabs .commodities-ex-tab').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        selectedExchange = btn.dataset.ex;
        $$('#commodityExchangeTabs .commodities-ex-tab').forEach((b) =>
          b.classList.toggle('active', b.dataset.ex === selectedExchange)
        );
        renderList();
      });
    });
  }

  function setupSearch() {
    const input = $('#commoditySearch');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('input', () => {
      searchQuery = input.value;
      renderList();
    });
  }

  function cacheKey(id, tf) {
    return `${id}:${tf}`;
  }

  function renderKlineChart() {
    const chartEl = $('#commodityHistoryChart');
    if (!chartEl || !currentKlines.length) return;

    const maxOffset = Math.max(0, currentKlines.length - klineViewCount);
    if (klineOffset > maxOffset) klineOffset = maxOffset;

    drawKlineChart(chartEl, currentKlines, {
      height: 340,
      viewCount: klineViewCount,
      offset: klineOffset,
    });

    const slider = $('#commodityKlineScroll');
    const label = $('#commodityKlineScrollLabel');
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
    const table = $('#commodityKlineTable');
    const wrap = $('#commodityKlineTableWrap');
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
        `<p class="kline-table-note">表格展示最近 500 条，完整数据共 ${klines.length} 条</p>`
      );
    }
  }

  function applyKlineData(data, keepScroll = false) {
    const summaryEl = $('#commodityHistorySummary');
    const chartEl = $('#commodityHistoryChart');
    const prevOffset = klineOffset;
    const wasAtEnd = prevOffset >= Math.max(0, currentKlines.length - klineViewCount);

    currentKlines = data.klines || [];
    historyCache[cacheKey(selectedId, selectedTimeframe)] = data;

    if (keepScroll && wasAtEnd) {
      klineOffset = Math.max(0, currentKlines.length - klineViewCount);
    } else if (!keepScroll) {
      klineOffset = Math.max(0, currentKlines.length - klineViewCount);
    }

    const s = data.summary;
    const up = s.totalReturnPct >= 0;
    if (summaryEl) {
      summaryEl.innerHTML = `<span class="history-range">${s.startDate} → ${s.endDate}</span>
        <span class="history-return ${up ? 'change-up' : 'change-down'}">累计 ${up ? '+' : ''}${formatNumber(s.totalReturnPct, 2)}%</span>
        <span class="history-meta">${s.bars} 根 · 20年高 ${formatNumber(s.high20y, 2)} · 20年低 ${formatNumber(s.low20y, 2)}</span>
        ${data.sourceNote ? `<span class="history-note">${escapeHtml(data.sourceNote)}</span>` : ''}`;
    }

    if (chartEl) {
      chartEl.innerHTML = '';
      drawChartNow(true);
    }
    const deferTable = () => renderKlineTable(currentKlines);
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(deferTable, { timeout: 2000 });
    } else {
      setTimeout(deferTable, 0);
    }
  }

  async function loadHistory(id, timeframe = selectedTimeframe) {
    const chartEl = $('#commodityHistoryChart');
    const summaryEl = $('#commodityHistorySummary');
    if (!chartEl) return;

    chartEl.innerHTML = '<div class="chart-loading">正在加载 K 线…</div>';
    if (summaryEl) summaryEl.innerHTML = '';

    try {
      const key = cacheKey(id, timeframe);
      let data = historyCache[key];
      if (!data) {
        data = await window.fancheng.fetchCommodityHistory(id, timeframe);
        if (data.error) throw new Error(data.error);
        historyCache[key] = data;
      }
      applyKlineData(data, false);
    } catch (err) {
      currentKlines = [];
      chartEl.innerHTML = `<div class="chart-empty">${escapeHtml(localize(err.message))}</div>`;
    }
  }

  function renderNewsSection(title, items, emptyHint) {
    if (!items?.length) {
      return `<section class="commodities-news-group">
        <h4 class="commodities-news-group-title">${escapeHtml(title)} <span class="commodities-news-count">0</span></h4>
        <p class="commodities-news-empty">${escapeHtml(emptyHint || '暂无')}</p>
      </section>`;
    }
    return `<section class="commodities-news-group">
      <h4 class="commodities-news-group-title">${escapeHtml(title)} <span class="commodities-news-count">${items.length}</span></h4>
      <ul class="news-list commodities-news-compact">${items
        .map(
          (item) => `<li class="news-item commodity-news-item" data-link="${escapeAttr(item.link)}">
            <div class="news-title">${escapeHtml(item.title)}</div>
            <div class="news-meta">
              <span>${formatDate(item.pubDate)}</span>
              <span class="news-source-tag">${escapeHtml(item.sourceName || '')}</span>
            </div>
            ${item.summary ? `<div class="news-summary">${escapeHtml(item.summary)}</div>` : ''}
          </li>`
        )
        .join('')}</ul>
    </section>`;
  }

  function renderNews(data) {
    const listEl = $('#commodityNewsList');
    const srcEl = $('#commodityNewsSources');
    if (!listEl) return;

    if (data.error) {
      listEl.innerHTML = `<div class="empty-state">${escapeHtml(localize(data.error))}</div>`;
      return;
    }

    if (srcEl) {
      const c = data.counts || {};
      srcEl.textContent = `来源：${(data.sources || []).slice(0, 8).join(' · ')}${(data.sources || []).length > 8 ? ' 等' : ''} · 共抓取 ${c.total || 0} 条`;
    }

    const sections = [
      ['品种相关', data.related, '暂无与该品种直接相关的报道'],
      ['生意社·现货产业', data.industry, '暂无生意社现货资讯'],
      ['期货要闻', data.futures, '暂无期货频道要闻'],
      ['彭博/CNBC·全球', data.global, data.globalLoading ? '全球资讯后台加载中…' : '暂无全球资讯（境外源需网络可达）'],
      ['宏观财经', data.macro, '暂无宏观要闻'],
    ];

    const hasAny = sections.some((s) => s[1]?.length);
    if (!hasAny) {
      listEl.innerHTML = '<div class="empty-state">暂无资讯，请稍后刷新</div>';
      return;
    }

    listEl.innerHTML = sections.map(([title, items, hint]) => renderNewsSection(title, items, hint)).join('');

    $$('.commodity-news-item', listEl).forEach((el) => {
      el.addEventListener('click', () => {
        const link = el.dataset.link;
        if (link) window.fancheng.openExternal(link);
      });
    });
  }

  async function loadNews(id, { forceRefresh = false } = {}) {
    const listEl = $('#commodityNewsList');
    const srcEl = $('#commodityNewsSources');

    if (newsCache[id] && !forceRefresh) {
      renderNews(newsCache[id]);
      return;
    }

    if (listEl) listEl.innerHTML = '<div class="chart-loading">正在加载资讯…</div>';

    const safetyTimer = setTimeout(() => {
      if (selectedId !== id || newsCache[id]) return;
      if (listEl) {
        listEl.innerHTML = '<div class="empty-state">网络较慢，资讯仍在后台加载…</div>';
      }
      if (srcEl) srcEl.textContent = '后台加载中';
    }, 3500);

    try {
      const fetchFn = forceRefresh
        ? window.fancheng.refreshCommodityNews
        : window.fancheng.fetchCommodityNews;
      const data = await Promise.race([
        fetchFn(id),
        new Promise((resolve) =>
          setTimeout(() => resolve({ error: '资讯加载超时，请稍后切换品种或刷新' }), 10000)
        ),
      ]);

      clearTimeout(safetyTimer);

      if (data.error) {
        if (newsCache[id] && selectedId === id) renderNews(newsCache[id]);
        else if (selectedId === id) renderNews(data);
        return;
      }

      newsCache[id] = data;
      if (selectedId === id) renderNews(data);

      if ((data.fromCache || data.partial) && selectedId === id) {
        window.fancheng
          .refreshCommodityNews(id)
          .then((refreshed) => {
            if (!refreshed?.error && selectedId === id) {
              newsCache[id] = refreshed;
              renderNews(refreshed);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      clearTimeout(safetyTimer);
      if (selectedId === id) renderNews({ error: err.message });
    }
  }

  function selectCommodity(id) {
    if (!id) return;
    selectedId = id;
    klineOffset = 0;

    $$('.commodities-list-row').forEach((row) => {
      const on = row.dataset.commodityId === id;
      row.classList.toggle('commodities-list-row-active', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    renderQuoteBar(getSelectedItem());
    loadHistory(id, selectedTimeframe);
    loadNews(id);
  }

  function setupKlineTabs() {
    $$('#commodityKlineTabs .kline-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedTimeframe = btn.dataset.tf;
        $$('#commodityKlineTabs .kline-tab').forEach((b) =>
          b.classList.toggle('active', b.dataset.tf === selectedTimeframe)
        );
        klineOffset = 0;
        loadHistory(selectedId, selectedTimeframe);
      });
    });
    $$('#commodityKlineTabs .kline-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tf === selectedTimeframe)
    );

    const slider = $('#commodityKlineScroll');
    if (slider) {
      slider.addEventListener('input', () => {
        klineOffset = parseInt(slider.value, 10) || 0;
        drawChartNow(true);
      });
    }
  }

  function flattenLiveData(data) {
    return (data.exchanges || []).flatMap((ex) =>
      (ex.items || []).map((item) => ({ ...item, exchangeId: ex.id }))
    );
  }

  function updateStats(data) {
    const statsEl = $('#commoditiesStats');
    if (statsEl && data.stats) {
      statsEl.textContent = `${data.stats.success}/${data.stats.total} 个有行情`;
    }
  }

  function patchLivePrices() {
    allItems.forEach((item) => {
      const row = document.querySelector(
        `.commodities-list-row[data-commodity-id="${item.id}"]`
      );
      if (!row || !item.available) return;
      const up = item.change >= 0;
      const priceEl = row.querySelector('.commodities-list-price');
      const pctEl = row.querySelector('.commodities-list-pct');
      if (priceEl) priceEl.textContent = formatPrice(item.price);
      if (pctEl) {
        pctEl.textContent = `${up ? '+' : ''}${formatNumber(item.changePct, 2)}%`;
        pctEl.className = `commodities-list-pct ${up ? 'change-up' : 'change-down'}`;
      }
    });
    renderQuoteBar(getSelectedItem());
  }

  let initialized = false;
  let uiBound = false;
  let chartMounted = false;
  let lastChartDrawAt = 0;
  let lastPricePatchAt = 0;
  const CHART_IDLE_MIN_MS = 60000;
  const PRICE_IDLE_MIN_MS = 60000;

  function isCommoditiesTabActive() {
    const panel = $('#panel-commodities');
    return Boolean(panel?.classList.contains('active'));
  }

  function isUserIdle() {
    return typeof window.isUserIdle === 'function' && window.isUserIdle();
  }

  function destroyChart() {
    const chartEl = $('#commodityHistoryChart');
    if (chartEl) {
      chartEl.innerHTML = '<div class="chart-loading">K 线已暂停（切回本页恢复）</div>';
    }
    chartMounted = false;
  }

  function drawChartNow(force = false) {
    if (!isCommoditiesTabActive() || !currentKlines.length) return;
    const now = Date.now();
    if (!force && isUserIdle() && now - lastChartDrawAt < CHART_IDLE_MIN_MS) return;
    lastChartDrawAt = now;
    renderKlineChart();
    chartMounted = true;
  }

  function isListStale() {
    const listEl = $('#commoditiesList');
    return !listEl || Boolean(listEl.querySelector('.chart-loading'));
  }

  function isListPopulated() {
    return !isListStale() && allItems.length > 0;
  }

  function bindUiOnce() {
    if (uiBound) return;
    uiBound = true;
    setupExchangeTabs();
    setupSearch();
    setupKlineTabs();
  }

  function applyLiveDataToUi(data) {
    if (data.error) {
      const listEl = $('#commoditiesList');
      if (listEl) listEl.innerHTML = `<div class="empty-state">${escapeHtml(localize(data.error))}</div>`;
      return;
    }

    liveData = data;
    allItems = flattenLiveData(data);
    updateStats(data);
    renderList();
    renderQuoteBar(getSelectedItem());
  }

  function mergeLiveData(data) {
    if (data.error) return;
    liveData = data;
    allItems = flattenLiveData(data);
    updateStats(data);
    if (isListStale()) renderList();
    else if (isCommoditiesTabActive()) {
      const now = Date.now();
      if (isUserIdle() && now - lastPricePatchAt < PRICE_IDLE_MIN_MS) return;
      lastPricePatchAt = now;
      patchLivePrices();
    }
  }

  async function loadLive(options = {}) {
    try {
      const data = await window.fancheng.fetchCommoditiesLive(options);
      applyLiveDataToUi(data);
      return data;
    } catch (err) {
      applyLiveDataToUi({ error: err.message });
      return null;
    }
  }

  async function ensureInit(preloadedLive) {
    const stale = isListStale();

    if (initialized && !stale) {
      if (preloadedLive) mergeLiveData(preloadedLive);
      return;
    }

    if (window.fancheng?.warmCommodityNewsCache) {
      window.fancheng.warmCommodityNewsCache();
    }
    bindUiOnce();

    if (preloadedLive) {
      applyLiveDataToUi(preloadedLive);
    } else if (!liveData || stale) {
      await loadLive();
    } else {
      applyLiveDataToUi(liveData);
    }

    if (!getSelectedItem() && allItems.length) {
      selectedId = allItems.find((i) => i.available)?.id || allItems[0].id;
    }
    if (stale || !initialized) {
      selectCommodity(selectedId);
    }
    initialized = true;
  }

  async function refreshLive() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const data = await window.fancheng.fetchCommoditiesLive({ force: true });
      if (!data.error) mergeLiveData(data);

      if (currentKlines.length > 0) {
        const updated = await window.fancheng.refreshCommodityKline(
          selectedId,
          selectedTimeframe,
          currentKlines
        );
        if (!updated.error) applyKlineData(updated, true);
      }
    } catch {
      // 静默
    } finally {
      isRefreshing = false;
    }
  }

  function resetCache() {
    historyCache = {};
    newsCache = {};
    if (window.fancheng?.invalidateCommodityNewsCache) {
      window.fancheng.invalidateCommodityNewsCache();
    }
  }

  function onTabActivated() {
    if (!isCommoditiesTabActive()) return;
    if (window.fancheng?.warmCommodityNewsCache) {
      window.fancheng.warmCommodityNewsCache();
    }
    if (isListStale()) {
      ensureInit(window.__preloadedCommoditiesLive);
    } else if (!isUserIdle()) {
      loadLive();
    }
    if (currentKlines.length && !chartMounted) {
      drawChartNow(true);
    }
  }

  function onTabHidden() {
    destroyChart();
  }

  return {
    renderPanelShell,
    init: ensureInit,
    ensureInit,
    refreshLive,
    mergeLiveData,
    resetCache,
    onTabActivated,
    onTabHidden,
    focusCommodity: selectCommodity,
    isListPopulated,
  };
})();

window.CommoditiesUI = CommoditiesUI;
