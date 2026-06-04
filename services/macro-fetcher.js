const { fetchJson } = require('./http-client');
const { fetchFredBatch } = require('./fred-client');
const diskCache = require('./disk-cache');

const EM_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const EM_TOKEN = '894050c76af8597a853f5b408b759f5d';
const EM_HEADERS = { Referer: 'https://data.eastmoney.com/' };
const JIN10_SHIBOR = 'https://cdn.jin10.com/data_center/reports/il_1.json';
const MACRO_DISK_KEY = 'macro-indicators.json';
const MACRO_DISK_TTL_MS = 15 * 60 * 1000;

/** 宏观子分类标签（中美通用） */
const MACRO_CATEGORY_LABELS = {
  prices: '物价',
  rates: '利率',
  sentiment: '景气与信心',
  production: '生产消费',
  trade: '贸易',
  money: '货币信贷',
  markets: '市场',
  employment: '就业',
};

/** 美国宏观 — FRED */
const US_FRED_SERIES = [
  { id: 'VIXCLS', name: 'VIX 恐慌指数', unit: '', group: 'us', category: 'markets', live: true },
  { id: 'DFF', name: '联邦基金利率（隔夜拆借）', unit: '%', group: 'us', category: 'rates', live: true },
  { id: 'SOFR', name: 'SOFR 担保隔夜融资利率', unit: '%', group: 'us', category: 'rates', live: true },
  { id: 'OBFR', name: 'OBFR 银行隔夜融资利率', unit: '%', group: 'us', category: 'rates', live: true },
  { id: 'IORR', name: '超额准备金利率 (IORR)', unit: '%', group: 'us', category: 'rates' },
  { id: 'DPRIME', name: '银行 prime 贷款利率', unit: '%', group: 'us', category: 'rates' },
  { id: 'MORTGAGE30US', name: '30 年期抵押贷款利率', unit: '%', group: 'us', category: 'rates' },
  { id: 'CPIAUCSL', name: 'CPI 消费者物价指数', unit: '指数', group: 'us', category: 'prices' },
  { id: 'CPILFESL', name: '核心 CPI（剔除食品能源）', unit: '指数', group: 'us', category: 'prices' },
  { id: 'PPIACO', name: 'PPI 生产者物价指数', unit: '指数', group: 'us', category: 'prices' },
  { id: 'PCEPI', name: 'PCE 个人消费物价指数', unit: '指数', group: 'us', category: 'prices' },
  { id: 'UMCSENT', name: '密歇根消费者信心指数', unit: '指数', group: 'us', category: 'sentiment' },
  { id: 'UNRATE', name: '失业率', unit: '%', group: 'us', category: 'employment' },
  { id: 'PAYEMS', name: '非农就业人数', unit: '千人', group: 'us', category: 'employment' },
  { id: 'INDPRO', name: '工业产出指数', unit: '指数', group: 'us', category: 'production' },
  { id: 'RSAFS', name: '零售销售', unit: '百万美元', group: 'us', category: 'production' },
  { id: 'HOUST', name: '新屋开工', unit: '千套', group: 'us', category: 'production' },
  { id: 'DGS10', name: '10 年期国债收益率', unit: '%', group: 'us', category: 'rates', live: true },
  { id: 'DGS2', name: '2 年期国债收益率', unit: '%', group: 'us', category: 'rates', live: true },
  { id: 'T10Y2Y', name: '10年-2年利差', unit: '%', group: 'us', category: 'rates', live: true },
  { id: 'DEXCHUS', name: '美元/人民币汇率', unit: '人民币', group: 'us', category: 'markets', live: true },
  { id: 'DTWEXBGS', name: '美元指数（广义）', unit: '指数', group: 'us', category: 'markets', live: true },
  { id: 'M2SL', name: 'M2 货币供应量', unit: '十亿美元', group: 'us', category: 'money' },
  { id: 'WALCL', name: '美联储资产负债表', unit: '百万美元', group: 'us', category: 'money' },
];

const US_LIVE_IDS = US_FRED_SERIES.filter((s) => s.live).map((s) => s.id);

async function fetchEastmoneyRows(reportName, columns, { pageSize = 3, token } = {}) {
  const params = new URLSearchParams({
    reportName,
    columns,
    pageSize: String(pageSize),
    pageNumber: '1',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB',
  });
  if (token) params.set('token', token);
  const json = await fetchJson(`${EM_BASE}?${params}`, {
    timeout: 12000,
    headers: EM_HEADERS,
    retries: 2,
  });
  if (!json.success || !json.result?.data?.length) {
    throw new Error(json.message || '东方财富宏观数据获取失败');
  }
  return json.result.data;
}

function cnRow(
  name,
  value,
  date,
  { unit = '', change = null, group = 'cn', note = '', category = 'production' } = {}
) {
  return {
    name,
    value: value == null ? null : String(value),
    date: date || '',
    change,
    unit,
    group,
    note,
    category,
  };
}

function pctChange(current, previous) {
  if (current == null || previous == null || Number.isNaN(current) || Number.isNaN(previous)) {
    return null;
  }
  return (current - previous).toFixed(2);
}

async function fetchChinaShibor() {
  const json = await fetchJson(`${JIN10_SHIBOR}?_=${Date.now()}`, {
    timeout: 12000,
    headers: { Referer: 'https://datacenter.jin10.com/' },
    retries: 2,
  });
  const dates = Object.keys(json.values || {}).sort();
  if (!dates.length) return [];
  const latestDate = dates[dates.length - 1];
  const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
  const latest = json.values[latestDate];
  const prev = prevDate ? json.values[prevDate] : null;

  const map = [
    ['O/N', 'SHIBOR 隔夜'],
    ['1W', 'SHIBOR 1周'],
    ['1M', 'SHIBOR 1月'],
    ['3M', 'SHIBOR 3月'],
    ['1Y', 'SHIBOR 1年'],
  ];

  return map
    .filter(([key]) => latest?.[key]?.[0])
    .map(([key, label]) => {
      const val = parseFloat(latest[key][0]);
      const prevVal = prev?.[key]?.[0] ? parseFloat(prev[key][0]) : null;
      return cnRow(label, val.toFixed(4), latestDate, {
        unit: '%',
        change: prevVal != null ? pctChange(val, prevVal) : latest[key][1] || null,
        note: 'live',
        category: 'rates',
      });
    });
}

async function fetchChinaReserveRatio() {
  const params = new URLSearchParams({
    reportName: 'RPT_ECONOMY_DEPOSIT_RESERVE',
    columns:
      'REPORT_DATE,PUBLISH_DATE,TRADE_DATE,INTEREST_RATE_BB,INTEREST_RATE_BA,INTEREST_RATE_SB,INTEREST_RATE_SA',
    pageSize: '1',
    pageNumber: '1',
    sortColumns: 'PUBLISH_DATE,TRADE_DATE',
    sortTypes: '-1,-1',
    source: 'WEB',
    client: 'WEB',
    token: EM_TOKEN,
  });
  const json = await fetchJson(`${EM_BASE}?${params}`, {
    timeout: 12000,
    headers: EM_HEADERS,
    retries: 2,
  });
  const row = json.result?.data?.[0];
  if (!row) return [];

  const date = (row.TRADE_DATE || row.PUBLISH_DATE || '').slice(0, 10);
  return [
    cnRow('存款准备金率（大型金融机构）', row.INTEREST_RATE_BA, date, {
      unit: '%',
      category: 'rates',
    }),
    cnRow('存款准备金率（中小金融机构）', row.INTEREST_RATE_SA, date, {
      unit: '%',
      category: 'rates',
    }),
  ].filter((i) => i.value != null);
}

async function fetchChinaLpr() {
  const params = new URLSearchParams({
    reportName: 'RPTA_WEB_RATE',
    columns: 'TRADE_DATE,LPR1Y,LPR5Y,RATE_1,RATE_2',
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    token: EM_TOKEN,
    pageSize: '2',
    pageNumber: '1',
    source: 'WEB',
    client: 'WEB',
  });
  const json = await fetchJson(`${EM_BASE}?${params}`, {
    timeout: 12000,
    headers: EM_HEADERS,
    retries: 2,
  });
  const rows = json.result?.data || [];
  if (!rows.length) return [];

  const latest = rows[0];
  const prev = rows[1];
  const date = (latest.TRADE_DATE || '').slice(0, 10);

  return [
    cnRow('LPR 1年期（贷款报价）', latest.LPR1Y, date, {
      unit: '%',
      change: prev ? pctChange(latest.LPR1Y, prev.LPR1Y) : null,
      category: 'rates',
    }),
    cnRow('LPR 5年期（贷款报价）', latest.LPR5Y, date, {
      unit: '%',
      change: prev ? pctChange(latest.LPR5Y, prev.LPR5Y) : null,
      category: 'rates',
    }),
    cnRow('1年期贷款基准利率（参考）', latest.RATE_1, date, {
      unit: '%',
      change: prev ? pctChange(latest.RATE_1, prev.RATE_1) : null,
      category: 'rates',
    }),
    cnRow('5年期贷款基准利率（参考）', latest.RATE_2, date, {
      unit: '%',
      change: prev ? pctChange(latest.RATE_2, prev.RATE_2) : null,
      category: 'rates',
    }),
  ].filter((i) => i.value != null);
}

async function fetchChinaMacroBatch() {
  const indicators = [];

  const tasks = await Promise.allSettled([
    fetchEastmoneyRows(
      'RPT_ECONOMY_CPI',
      'REPORT_DATE,TIME,NATIONAL_SAME,NATIONAL_BASE,NATIONAL_SEQUENTIAL'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_PPI',
      'REPORT_DATE,TIME,BASE_SAME,BASE,BASE_ACCUMULATE'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_PMI',
      'REPORT_DATE,TIME,MAKE_INDEX,MAKE_SAME,NMAKE_INDEX,NMAKE_SAME'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_FAITH_INDEX',
      'REPORT_DATE,TIME,CONSUMERS_FAITH_INDEX,FAITH_INDEX_SAME,CONSUMERS_EXPECT_INDEX'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_GDP',
      'REPORT_DATE,TIME,DOMESTICL_PRODUCT_BASE,SUM_SAME'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_CURRENCY_SUPPLY',
      'REPORT_DATE,TIME,BASIC_CURRENCY,BASIC_CURRENCY_SAME,BASIC_CURRENCY_SEQUENTIAL,CURRENCY,CURRENCY_SAME,CURRENCY_SEQUENTIAL,FREE_CASH,FREE_CASH_SAME,FREE_CASH_SEQUENTIAL'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_CUSTOMS',
      'REPORT_DATE,TIME,EXIT_BASE_SAME,IMPORT_BASE_SAME,EXIT_BASE,IMPORT_BASE'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_TOTAL_RETAIL',
      'REPORT_DATE,TIME,RETAIL_TOTAL,RETAIL_TOTAL_SAME,RETAIL_TOTAL_SEQUENTIAL'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_INDUS_GROW',
      'REPORT_DATE,TIME,BASE_SAME,BASE_ACCUMULATE'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_ASSET_INVEST',
      'REPORT_DATE,TIME,BASE,BASE_SAME,BASE_SEQUENTIAL,BASE_ACCUMULATE'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_RMB_LOAN',
      'REPORT_DATE,TIME,RMB_LOAN,RMB_LOAN_SAME,RMB_LOAN_SEQUENTIAL,RMB_LOAN_ACCUMULATE'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_FOREX_DEPOSIT',
      'REPORT_DATE,TIME,BASE,BASE_SAME,BASE_SEQUENTIAL,BASE_ACCUMULATE'
    ),
    fetchEastmoneyRows(
      'RPT_ECONOMY_GOODS_INDEX',
      'REPORT_DATE,TIME,BASE,BASE_SAME,BASE_SEQUENTIAL'
    ),
    fetchChinaShibor(),
    fetchChinaLpr(),
    fetchChinaReserveRatio(),
  ]);

  const [
    cpiR,
    ppiR,
    pmiR,
    faithR,
    gdpR,
    moneyR,
    customsR,
    retailR,
    indusR,
    investR,
    loanR,
    depositR,
    goodsR,
    shiborR,
    lprR,
    reserveR,
  ] = tasks;

  if (cpiR.status === 'fulfilled' && cpiR.value[0]) {
    const r = cpiR.value[0];
    const p = cpiR.value[1];
    indicators.push(
      cnRow('CPI 同比', r.NATIONAL_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.NATIONAL_SAME, p.NATIONAL_SAME) : null,
        category: 'prices',
      }),
      cnRow('CPI 环比', r.NATIONAL_SEQUENTIAL, r.TIME || r.REPORT_DATE, {
        unit: '%',
        category: 'prices',
      })
    );
  }

  if (ppiR.status === 'fulfilled' && ppiR.value[0]) {
    const r = ppiR.value[0];
    const p = ppiR.value[1];
    indicators.push(
      cnRow('PPI 同比', r.BASE_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.BASE_SAME, p.BASE_SAME) : null,
        category: 'prices',
      })
    );
  }

  if (goodsR.status === 'fulfilled' && goodsR.value[0]) {
    const r = goodsR.value[0];
    const p = goodsR.value[1];
    indicators.push(
      cnRow('企业商品价格指数', r.BASE, r.TIME || r.REPORT_DATE, {
        unit: '指数',
        change: p ? pctChange(r.BASE, p.BASE) : null,
        category: 'prices',
      }),
      cnRow('企业商品价格指数同比', r.BASE_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        category: 'prices',
      })
    );
  }

  if (pmiR.status === 'fulfilled' && pmiR.value[0]) {
    const r = pmiR.value[0];
    const p = pmiR.value[1];
    indicators.push(
      cnRow('制造业 PMI', r.MAKE_INDEX, r.TIME || r.REPORT_DATE, {
        unit: '指数',
        change: p ? pctChange(r.MAKE_INDEX, p.MAKE_INDEX) : null,
        category: 'sentiment',
      }),
      cnRow('非制造业 PMI', r.NMAKE_INDEX, r.TIME || r.REPORT_DATE, {
        unit: '指数',
        category: 'sentiment',
      })
    );
  }

  if (faithR.status === 'fulfilled' && faithR.value[0]) {
    const r = faithR.value[0];
    const p = faithR.value[1];
    indicators.push(
      cnRow('消费者信心指数', r.CONSUMERS_FAITH_INDEX, r.TIME || r.REPORT_DATE, {
        unit: '指数',
        change: p ? pctChange(r.CONSUMERS_FAITH_INDEX, p.CONSUMERS_FAITH_INDEX) : null,
        category: 'sentiment',
      }),
      cnRow('消费者预期指数', r.CONSUMERS_EXPECT_INDEX, r.TIME || r.REPORT_DATE, {
        unit: '指数',
        category: 'sentiment',
      })
    );
  }

  if (gdpR.status === 'fulfilled' && gdpR.value[0]) {
    const r = gdpR.value[0];
    indicators.push(
      cnRow('GDP 同比增速', r.SUM_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        category: 'production',
      })
    );
  }

  if (indusR.status === 'fulfilled' && indusR.value[0]) {
    const r = indusR.value[0];
    const p = indusR.value[1];
    indicators.push(
      cnRow('工业增加值同比', r.BASE_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.BASE_SAME, p.BASE_SAME) : null,
        category: 'production',
      }),
      cnRow('工业增加值累计同比', r.BASE_ACCUMULATE, r.TIME || r.REPORT_DATE, {
        unit: '%',
        category: 'production',
      })
    );
  }

  if (retailR.status === 'fulfilled' && retailR.value[0]) {
    const r = retailR.value[0];
    const p = retailR.value[1];
    indicators.push(
      cnRow('社会消费品零售总额同比', r.RETAIL_TOTAL_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.RETAIL_TOTAL_SAME, p.RETAIL_TOTAL_SAME) : null,
        category: 'production',
      })
    );
  }

  if (investR.status === 'fulfilled' && investR.value[0]) {
    const r = investR.value[0];
    const p = investR.value[1];
    indicators.push(
      cnRow('固定资产投资同比', r.BASE_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.BASE_SAME, p.BASE_SAME) : null,
        category: 'production',
      })
    );
  }

  if (customsR.status === 'fulfilled' && customsR.value[0]) {
    const r = customsR.value[0];
    const p = customsR.value[1];
    indicators.push(
      cnRow('出口金额同比', r.EXIT_BASE_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.EXIT_BASE_SAME, p.EXIT_BASE_SAME) : null,
        category: 'trade',
      }),
      cnRow('进口金额同比', r.IMPORT_BASE_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.IMPORT_BASE_SAME, p.IMPORT_BASE_SAME) : null,
        category: 'trade',
      })
    );
  }

  if (moneyR.status === 'fulfilled' && moneyR.value[0]) {
    const r = moneyR.value[0];
    const p = moneyR.value[1];
    indicators.push(
      cnRow('M2 同比', r.BASIC_CURRENCY_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.BASIC_CURRENCY_SAME, p.BASIC_CURRENCY_SAME) : null,
        category: 'money',
      }),
      cnRow('M1 同比', r.CURRENCY_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.CURRENCY_SAME, p.CURRENCY_SAME) : null,
        category: 'money',
      }),
      cnRow('M0 同比', r.FREE_CASH_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        category: 'money',
      }),
      cnRow('M2 余额', r.BASIC_CURRENCY, r.TIME || r.REPORT_DATE, {
        unit: '亿元',
        category: 'money',
      })
    );
  }

  if (loanR.status === 'fulfilled' && loanR.value[0]) {
    const r = loanR.value[0];
    const p = loanR.value[1];
    indicators.push(
      cnRow('新增人民币贷款（当月）', r.RMB_LOAN, r.TIME || r.REPORT_DATE, {
        unit: '亿元',
        change: p ? pctChange(r.RMB_LOAN, p.RMB_LOAN) : null,
        category: 'money',
      }),
      cnRow('新增人民币贷款同比', r.RMB_LOAN_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        category: 'money',
      })
    );
  }

  if (depositR.status === 'fulfilled' && depositR.value[0]) {
    const r = depositR.value[0];
    const p = depositR.value[1];
    indicators.push(
      cnRow('本外币存款余额同比', r.BASE_SAME, r.TIME || r.REPORT_DATE, {
        unit: '%',
        change: p ? pctChange(r.BASE_SAME, p.BASE_SAME) : null,
        category: 'money',
      })
    );
  }

  if (shiborR.status === 'fulfilled') indicators.push(...shiborR.value);
  if (lprR.status === 'fulfilled') indicators.push(...lprR.value);
  if (reserveR.status === 'fulfilled') indicators.push(...reserveR.value);

  return indicators.filter((i) => i.value != null && i.value !== '');
}

async function fetchUsMacroIndicators(seriesList = US_FRED_SERIES) {
  const rows = await fetchFredBatch(seriesList);
  return rows.map((r) => ({
    name: r.name,
    value: r.value,
    date: r.date,
    change: r.change,
    unit: r.unit,
    group: r.group || 'us',
    category: r.category || 'production',
    seriesId: r.id,
    live: Boolean(r.live),
  }));
}

function buildGroups(allIndicators) {
  const us = allIndicators.filter((i) => i.group === 'us');
  const cn = allIndicators.filter((i) => i.group === 'cn');
  return [
    { id: 'us', label: '美国', indicators: us },
    { id: 'cn', label: '中国', indicators: cn },
  ];
}

async function fetchMacroIndicators({ liveOnly = false } = {}) {
  if (liveOnly) {
    const liveUs = US_FRED_SERIES.filter((s) => s.live);
    const [usLive, shibor] = await Promise.all([
      fetchUsMacroIndicators(liveUs),
      fetchChinaShibor().catch(() => []),
    ]);
    return buildGroups([...usLive, ...shibor]);
  }

  const [us, cn] = await Promise.all([
    fetchUsMacroIndicators(US_FRED_SERIES),
    fetchChinaMacroBatch(),
  ]);

  return buildGroups([...us, ...cn]);
}

async function fetchMacroSource() {
  const groups = await fetchMacroIndicators();
  const indicators = groups.flatMap((g) => g.indicators);

  const payload = {
    key: 'macro',
    name: '中美宏观',
    groups,
    indicators,
    news: [],
    dataLabel: '投资决策核心宏观指标',
    updatedAt: new Date().toISOString(),
  };

  diskCache.write(MACRO_DISK_KEY, { data: payload });
  return payload;
}

function getCachedMacroSource() {
  const stored = diskCache.read(MACRO_DISK_KEY, MACRO_DISK_TTL_MS) || diskCache.readStale(MACRO_DISK_KEY);
  return stored?.data || null;
}

async function fetchMacroLive() {
  const cached = getCachedMacroSource();
  const liveGroups = await fetchMacroIndicators({ liveOnly: true });
  const liveMap = new Map(
    liveGroups.flatMap((g) => g.indicators).map((i) => [i.name, i])
  );

  if (!cached?.groups) {
    const fresh = await fetchMacroSource();
    return { ...fresh, liveRefreshedAt: new Date().toISOString() };
  }

  const mergedGroups = cached.groups.map((group) => ({
    ...group,
    indicators: group.indicators.map((ind) => {
      const live = liveMap.get(ind.name);
      return live ? { ...ind, ...live } : ind;
    }),
  }));

  const payload = {
    ...cached,
    groups: mergedGroups,
    indicators: mergedGroups.flatMap((g) => g.indicators),
    updatedAt: new Date().toISOString(),
    liveRefreshedAt: new Date().toISOString(),
  };

  diskCache.write(MACRO_DISK_KEY, { data: payload });
  return payload;
}

module.exports = {
  fetchMacroSource,
  fetchMacroLive,
  getCachedMacroSource,
  fetchMacroIndicators,
  US_FRED_SERIES,
  US_LIVE_IDS,
  MACRO_CATEGORY_LABELS,
};
