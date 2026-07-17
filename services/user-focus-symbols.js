/**
 * 用户关注品种池 — 大宗走势研判核心覆盖范围
 * 每日分析、Top5 推荐、重大机会标记均以此池为准
 */
const { getCommodityMeta } = require('./commodities-catalog');
const { normalizeCommodityId } = require('./policy-commodity-map');

const FOCUS_VERSION = 'v1.56.15-cu-strategic-watch';

/** 用户指定 36 品种（顺序即默认展示优先级） */
const USER_FOCUS_SYMBOL_IDS = Object.freeze([
  'au', 'ag', 'pt', 'pd',           // 贵金属
  'cu', 'al', 'zn', 'pb', 'ni', 'sn', 'ao', // 有色
  'si', 'ps', 'lc',                 // 广期所新能源
  'rb', 'i', 'jm', 'fg', 'sa',      // 黑色/建材（含纯碱）
  'sc', 'fu',                       // 能源
  'ta', 'br', 'ru', 'nr', 'eg', 'ma', // 化工
  'm', 'y', 'rm', 'oi', 'p',        // 油脂油料
  'cf', 'sr', 'jd', 'lh',           // 软商品/养殖
]);

/**
 * 深跌 / 反内卷须高度关注（不含铜、锌）
 */
const REBOUND_WATCH_SYMBOL_IDS = Object.freeze([
  'si', 'ps', 'lc',
  'fg', 'sa',
  'rb', 'i', 'jm',
  'ta', 'ma', 'eg',
  'al', 'ao',
]);

/** 战略高度关注（非反内卷）— 沪铜供需/库存/矿山/AI需求链 */
const STRATEGIC_WATCH_SYMBOL_IDS = Object.freeze(['cu']);

const USER_FOCUS_SET = new Set(USER_FOCUS_SYMBOL_IDS);

/** 板块分组（用于 UI 筛选） */
const FOCUS_SECTOR_MAP = Object.freeze({
  au: 'precious', ag: 'precious', pt: 'precious', pd: 'precious',
  cu: 'metals', al: 'metals', zn: 'metals', pb: 'metals', ni: 'metals', sn: 'metals', ao: 'metals',
  si: 'newenergy', ps: 'newenergy', lc: 'newenergy',
  rb: 'black', i: 'black', jm: 'black', fg: 'black', sa: 'chemical',
  sc: 'energy', fu: 'energy',
  ta: 'chemical', br: 'chemical', ru: 'chemical', nr: 'chemical', eg: 'chemical', ma: 'chemical',
  m: 'agriculture', y: 'agriculture', rm: 'agriculture', oi: 'agriculture', p: 'agriculture',
  cf: 'agriculture', sr: 'agriculture', jd: 'agriculture', lh: 'agriculture',
});

const FOCUS_SECTOR_LABELS = Object.freeze({
  precious: '贵金属',
  metals: '有色金属',
  newenergy: '新能源',
  black: '黑色建材',
  energy: '能源',
  chemical: '化工',
  agriculture: '农产品',
});

function isUserFocusSymbol(instrumentId) {
  return USER_FOCUS_SET.has(normalizeCommodityId(instrumentId));
}

function isReboundWatchSymbol(instrumentId) {
  return REBOUND_WATCH_SYMBOL_IDS.includes(normalizeCommodityId(instrumentId));
}

function isStrategicWatchSymbol(instrumentId) {
  return STRATEGIC_WATCH_SYMBOL_IDS.includes(normalizeCommodityId(instrumentId));
}

function listUserFocusSymbols() {
  return [...USER_FOCUS_SYMBOL_IDS];
}

function getFocusSector(symbol) {
  return FOCUS_SECTOR_MAP[normalizeCommodityId(symbol)] || 'other';
}

function getFocusMeta(symbol) {
  const id = normalizeCommodityId(symbol);
  const meta = getCommodityMeta(id);
  return {
    id,
    name: meta?.name || id.toUpperCase(),
    exchange: meta?.exchange || '',
    unit: meta?.unit || '',
    sector: getFocusSector(id),
    sectorLabel: FOCUS_SECTOR_LABELS[getFocusSector(id)] || '其他',
  };
}

function listUserFocusMeta() {
  return USER_FOCUS_SYMBOL_IDS.map(getFocusMeta);
}

function filterToUserFocus(instruments = []) {
  return instruments.filter((i) => isUserFocusSymbol(i?.id));
}

function sortByFocusOrder(instruments = []) {
  const order = new Map(USER_FOCUS_SYMBOL_IDS.map((id, idx) => [id, idx]));
  return [...instruments].sort((a, b) => {
    const ai = order.get(normalizeCommodityId(a?.id)) ?? 999;
    const bi = order.get(normalizeCommodityId(b?.id)) ?? 999;
    return ai - bi;
  });
}

module.exports = {
  FOCUS_VERSION,
  USER_FOCUS_SYMBOL_IDS,
  USER_FOCUS_SET,
  REBOUND_WATCH_SYMBOL_IDS,
  STRATEGIC_WATCH_SYMBOL_IDS,
  FOCUS_SECTOR_MAP,
  FOCUS_SECTOR_LABELS,
  isUserFocusSymbol,
  isReboundWatchSymbol,
  isStrategicWatchSymbol,
  listUserFocusSymbols,
  getFocusSector,
  getFocusMeta,
  listUserFocusMeta,
  filterToUserFocus,
  sortByFocusOrder,
};
