/** 上期所、大商所、郑商所全部上市品种（主力连续合约） */
const COMMODITY_EXCHANGES = [
  {
    id: 'shfe',
    name: '上海期货交易所',
    short: '上期所',
    eastmoneyPrefix: '113',
    items: [
      { id: 'cu', name: '沪铜', unit: '元/吨', sinaSymbol: 'CU0', global: ['LME copper', 'copper', '铜'] },
      { id: 'al', name: '沪铝', unit: '元/吨', sinaSymbol: 'AL0', global: ['aluminum', '铝'] },
      { id: 'zn', name: '沪锌', unit: '元/吨', sinaSymbol: 'ZN0', global: ['zinc', '锌'] },
      { id: 'pb', name: '沪铅', unit: '元/吨', sinaSymbol: 'PB0', global: ['lead', '铅'] },
      { id: 'ni', name: '沪镍', unit: '元/吨', sinaSymbol: 'NI0', global: ['nickel', '镍'] },
      { id: 'sn', name: '沪锡', unit: '元/吨', sinaSymbol: 'SN0', global: ['tin', '锡'] },
      { id: 'au', name: '沪金', unit: '元/克', sinaSymbol: 'AU0', global: ['gold', '黄金', 'COMEX gold'] },
      { id: 'ag', name: '沪银', unit: '元/千克', sinaSymbol: 'AG0', global: ['silver', '白银'] },
      { id: 'rb', name: '螺纹钢', unit: '元/吨', sinaSymbol: 'RB0', global: ['steel rebar', '螺纹钢', 'iron ore'] },
      { id: 'hc', name: '热轧卷板', unit: '元/吨', sinaSymbol: 'HC0', global: ['hot rolled coil', '热卷'] },
      { id: 'ss', name: '不锈钢', unit: '元/吨', sinaSymbol: 'SS0', global: ['stainless steel', '不锈钢'] },
      { id: 'wr', name: '线材', unit: '元/吨', sinaSymbol: 'WR0', global: ['wire rod', '线材'] },
      { id: 'fu', name: '燃料油', unit: '元/吨', sinaSymbol: 'FU0', global: ['fuel oil', '燃料油', 'Brent crude'] },
      { id: 'bu', name: '沥青', unit: '元/吨', sinaSymbol: 'BU0', global: ['bitumen', '沥青'] },
      { id: 'ru', name: '天然橡胶', unit: '元/吨', sinaSymbol: 'RU0', global: ['rubber', '橡胶', 'TSR20'] },
      { id: 'sp', name: '纸浆', unit: '元/吨', sinaSymbol: 'SP0', global: ['pulp', '纸浆'] },
      { id: 'ao', name: '氧化铝', unit: '元/吨', sinaSymbol: 'AO0', global: ['alumina', '氧化铝'] },
      { id: 'br', name: '丁二烯橡胶', unit: '元/吨', sinaSymbol: 'BR0', global: ['synthetic rubber', '合成橡胶'] },
      { id: 'ad', name: '铸造铝合金', unit: '元/吨', sinaSymbol: 'AD0', global: ['cast aluminum alloy', '铝合金'] },
    ],
  },
  {
    id: 'ine',
    name: '上海国际能源交易中心',
    short: '上期能源',
    eastmoneyPrefix: '113',
    items: [
      { id: 'sc', name: '原油', unit: '元/桶', sinaSymbol: 'SC0', global: ['crude oil', 'WTI', 'Brent', 'OPEC', '石油', 'petroleum'] },
      { id: 'lu', name: '低硫燃料油', unit: '元/吨', sinaSymbol: 'LU0', global: ['low sulfur fuel oil', 'LSFO', '船燃', 'marine fuel'] },
      { id: 'bc', name: '国际铜', unit: '元/吨', sinaSymbol: 'BC0', global: ['LME copper', '国际铜', 'copper', 'COMEX copper'] },
      { id: 'ec', name: '集运指数(欧线)', unit: '点', sinaSymbol: 'EC0', global: ['container freight', 'shipping', '欧线', '集运'] },
    ],
  },
  {
    id: 'dce',
    name: '大连商品交易所',
    short: '大商所',
    eastmoneyPrefix: '114',
    items: [
      { id: 'a', name: '豆一', unit: '元/吨', sinaSymbol: 'A0', global: ['soybean', '大豆', 'CBOT soybean'] },
      { id: 'b', name: '豆二', unit: '元/吨', sinaSymbol: 'B0', global: ['soybean', '大豆'] },
      { id: 'c', name: '玉米', unit: '元/吨', sinaSymbol: 'C0', global: ['corn', '玉米', 'CBOT corn'] },
      { id: 'cs', name: '玉米淀粉', unit: '元/吨', sinaSymbol: 'CS0', global: ['corn starch', '淀粉'] },
      { id: 'm', name: '豆粕', unit: '元/吨', sinaSymbol: 'M0', global: ['soybean meal', '豆粕'] },
      { id: 'y', name: '豆油', unit: '元/吨', sinaSymbol: 'Y0', global: ['soybean oil', '豆油'] },
      { id: 'p', name: '棕榈油', unit: '元/吨', sinaSymbol: 'P0', global: ['palm oil', '棕榈油', 'BMD palm'] },
      { id: 'l', name: '聚乙烯', unit: '元/吨', sinaSymbol: 'L0', global: ['polyethylene', 'PE', '塑料'] },
      { id: 'v', name: 'PVC', unit: '元/吨', sinaSymbol: 'V0', global: ['PVC', '聚氯乙烯'] },
      { id: 'pp', name: '聚丙烯', unit: '元/吨', sinaSymbol: 'PP0', global: ['polypropylene', 'PP', '丙烯'] },
      { id: 'j', name: '焦炭', unit: '元/吨', sinaSymbol: 'J0', global: ['coke', '焦炭', 'coking coal'] },
      { id: 'jm', name: '焦煤', unit: '元/吨', sinaSymbol: 'JM0', global: ['coking coal', '焦煤'] },
      { id: 'i', name: '铁矿石', unit: '元/吨', sinaSymbol: 'I0', global: ['iron ore', '铁矿石', 'SGX iron ore'] },
      { id: 'eg', name: '乙二醇', unit: '元/吨', sinaSymbol: 'EG0', global: ['ethylene glycol', '乙二醇', 'MEG'] },
      { id: 'eb', name: '苯乙烯', unit: '元/吨', sinaSymbol: 'EB0', global: ['styrene', '苯乙烯'] },
      { id: 'pg', name: '液化石油气', unit: '元/吨', sinaSymbol: 'PG0', global: ['LPG', '丙烷', 'propane'] },
      { id: 'jd', name: '鸡蛋', unit: '元/500千克', sinaSymbol: 'JD0', global: ['eggs', '鸡蛋'] },
      { id: 'lh', name: '生猪', unit: '元/吨', sinaSymbol: 'LH0', global: ['live hog', '生猪', 'pork'] },
      { id: 'rr', name: '粳米', unit: '元/吨', sinaSymbol: 'RR0', global: ['japonica rice', '粳米'] },
      { id: 'lg', name: '原木', unit: '元/立方米', sinaSymbol: 'LG0', global: ['timber', '原木', '木材'] },
    ],
  },
  {
    id: 'zce',
    name: '郑州商品交易所',
    short: '郑商所',
    eastmoneyPrefix: '115',
    items: [
      { id: 'CF', name: '棉花', unit: '元/吨', sinaSymbol: 'CF0', global: ['cotton', '棉花', 'ICE cotton'] },
      { id: 'SR', name: '白糖', unit: '元/吨', sinaSymbol: 'SR0', global: ['sugar', '白糖', 'ICE sugar'] },
      { id: 'TA', name: 'PTA', unit: '元/吨', sinaSymbol: 'TA0', global: ['PTA', '对苯二甲酸', '聚酯'] },
      { id: 'OI', name: '菜籽油', unit: '元/吨', sinaSymbol: 'OI0', global: ['rapeseed oil', '菜油'] },
      { id: 'MA', name: '甲醇', unit: '元/吨', sinaSymbol: 'MA0', global: ['methanol', '甲醇'] },
      { id: 'FG', name: '玻璃', unit: '元/吨', sinaSymbol: 'FG0', global: ['glass', '玻璃'] },
      { id: 'RM', name: '菜粕', unit: '元/吨', sinaSymbol: 'RM0', global: ['rapeseed meal', '菜粕'] },
      { id: 'SF', name: '硅铁', unit: '元/吨', sinaSymbol: 'SF0', global: ['ferrosilicon', '硅铁'] },
      { id: 'SM', name: '锰硅', unit: '元/吨', sinaSymbol: 'SM0', global: ['silicomanganese', '锰硅'] },
      { id: 'AP', name: '苹果', unit: '元/吨', sinaSymbol: 'AP0', global: ['apple', '苹果'] },
      { id: 'CJ', name: '红枣', unit: '元/吨', sinaSymbol: 'CJ0', global: ['jujube', '红枣'] },
      { id: 'UR', name: '尿素', unit: '元/吨', sinaSymbol: 'UR0', global: ['urea', '尿素'] },
      { id: 'SA', name: '纯碱', unit: '元/吨', sinaSymbol: 'SA0', global: ['soda ash', '纯碱'] },
      { id: 'PF', name: '短纤', unit: '元/吨', sinaSymbol: 'PF0', global: ['polyester staple', '短纤'] },
      { id: 'PK', name: '花生', unit: '元/吨', sinaSymbol: 'PK0', global: ['peanut', '花生'] },
      { id: 'SH', name: '烧碱', unit: '元/吨', sinaSymbol: 'SH0', global: ['caustic soda', '烧碱'] },
      { id: 'PX', name: '对二甲苯', unit: '元/吨', sinaSymbol: 'PX0', global: ['PX', '对二甲苯', 'paraxylene'] },
      { id: 'PR', name: '瓶片', unit: '元/吨', sinaSymbol: 'PR0', global: ['PET bottle chip', '瓶级聚酯'] },
      { id: 'CY', name: '棉纱', unit: '元/吨', sinaSymbol: 'CY0', global: ['cotton yarn', '棉纱'] },
      { id: 'RS', name: '油菜籽', unit: '元/吨', sinaSymbol: 'RS0', global: ['rapeseed', '油菜籽'] },
      { id: 'WH', name: '强麦', unit: '元/吨', sinaSymbol: 'WH0', global: ['wheat', '强麦'] },
      { id: 'PM', name: '普麦', unit: '元/吨', sinaSymbol: 'PM0', global: ['wheat', '普麦'] },
      { id: 'RI', name: '早籼稻', unit: '元/吨', sinaSymbol: 'RI0', global: ['early rice', '早籼稻'] },
      { id: 'LR', name: '晚籼稻', unit: '元/吨', sinaSymbol: 'LR0', global: ['late rice', '晚籼稻'] },
      { id: 'JR', name: '粳稻', unit: '元/吨', sinaSymbol: 'JR0', global: ['japonica rice', '粳稻'] },
      { id: 'ZC', name: '动力煤', unit: '元/吨', sinaSymbol: 'ZC0', global: ['thermal coal', '动力煤', 'coal'] },
    ],
  },
  {
    id: 'gfex',
    name: '广州期货交易所',
    short: '广期所',
    eastmoneyPrefix: '142',
    items: [
      { id: 'si', name: '工业硅', unit: '元/吨', sinaSymbol: 'SI0', global: ['silicon metal', '工业硅', 'silicon', '光伏'] },
      { id: 'lc', name: '碳酸锂', unit: '元/吨', sinaSymbol: 'LC0', global: ['lithium carbonate', '碳酸锂', 'lithium', 'battery metal'] },
      { id: 'ps', name: '多晶硅', unit: '元/吨', sinaSymbol: 'PS0', global: ['polysilicon', '多晶硅', 'solar', '硅料'] },
      { id: 'pt', name: '铂金', unit: '元/克', sinaSymbol: 'PT0', global: ['platinum', '铂金', 'PGM', '氢能'] },
      { id: 'pd', name: '钯金', unit: '元/克', sinaSymbol: 'PD0', global: ['palladium', '钯金', 'PGM', '尾气催化'] },
    ],
  },
];

function enrichItem(exchange, item) {
  const codeForEm =
    exchange.id === 'zce' ? item.sinaSymbol.replace(/0$/, '').toUpperCase() : item.id.toLowerCase();
  return {
    ...item,
    exchangeId: exchange.id,
    exchange: exchange.short,
    exchangeName: exchange.name,
    sinaQuote: `nf_${item.sinaSymbol}`,
    eastmoneySecid: `${exchange.eastmoneyPrefix}.${codeForEm}888`,
    keywords: [item.name, item.id, item.sinaSymbol.replace(/0$/, ''), ...(item.global || [])],
  };
}

function getAllCommodities() {
  return COMMODITY_EXCHANGES.flatMap((ex) => ex.items.map((item) => enrichItem(ex, item)));
}

function getCommodityMeta(commodityId) {
  const id = String(commodityId || '');
  const lower = id.toLowerCase();
  for (const ex of COMMODITY_EXCHANGES) {
    const item = ex.items.find((i) => i.id === id || i.id.toLowerCase() === lower);
    if (item) return enrichItem(ex, item);
  }
  if (lower === 'sc') {
    const ineEx = COMMODITY_EXCHANGES.find((e) => e.id === 'ine');
    const item = ineEx?.items.find((i) => i.id === 'sc');
    if (item) return enrichItem(ineEx, item);
  }
  return null;
}

function listCommodityCatalogFlat() {
  return getAllCommodities().map((c) => ({
    id: c.id,
    name: c.name,
    exchangeId: c.exchangeId,
    exchange: c.exchange,
    exchangeName: c.exchangeName,
    unit: c.unit,
    sinaSymbol: c.sinaSymbol,
  }));
}

function listCommodityExchanges() {
  return COMMODITY_EXCHANGES.map((ex) => ({
    id: ex.id,
    name: ex.name,
    short: ex.short,
    count: ex.items.length,
    items: ex.items.map((item) => {
      const meta = enrichItem(ex, item);
      return { id: meta.id, name: meta.name, exchange: meta.exchange, sinaSymbol: meta.sinaSymbol };
    }),
  }));
}

function listCommoditiesWithHistory() {
  return getAllCommodities().map((c) => ({
    id: c.id,
    name: c.name,
    exchange: c.exchange,
    exchangeId: c.exchangeId,
    unit: c.unit,
  }));
}

module.exports = {
  COMMODITY_EXCHANGES,
  getAllCommodities,
  getCommodityMeta,
  listCommodityExchanges,
  listCommoditiesWithHistory,
  listCommodityCatalogFlat,
};
