/**
 * 交易所公告 ↔ 品种映射（品种级覆盖审计）
 */
const { getCommodityMeta } = require('./commodities-catalog');
const { normalizeCommodityId, detectCommodityTags } = require('./policy-commodity-map');

const EXCHANGE_LABEL_TO_ID = {
  广期所: 'gfex',
  中金所: 'cffex',
  上期所: 'shfe',
  大商所: 'dce',
  郑商所: 'zce',
  能源中心: 'ine',
};

const EXCHANGE_ID_TO_LABEL = Object.fromEntries(
  Object.entries(EXCHANGE_LABEL_TO_ID).map(([label, id]) => [id, label])
);

const HARD_RULE_RE = /限仓|持仓限额|交易限额|保证金|手续费|涨跌停|提保|扩板/i;

function itemText(item) {
  return `${item.title || ''} ${item.summary || ''} ${item.sourceName || item.source || ''}`;
}

function itemMatchesSymbolTags(item, sym) {
  const id = normalizeCommodityId(sym);
  const text = itemText(item);
  const tags = detectCommodityTags(text).map((t) => normalizeCommodityId(t.id));
  if (tags.includes(id)) return true;
  if (item.commodityTags?.map((t) => normalizeCommodityId(t.id || t)).includes(id)) return true;
  if (item.symbols?.map(normalizeCommodityId).includes(id)) return true;
  return false;
}

function enrichExchangeNoticeSymbols(item) {
  const text = itemText(item);
  const tags = detectCommodityTags(text);
  const symbols = [
    ...new Set([
      ...(item.symbols || []).map(normalizeCommodityId),
      ...tags.map((t) => normalizeCommodityId(t.id)),
    ]),
  ].filter(Boolean);
  return {
    ...item,
    symbols,
    commodityTags: item.commodityTags?.length ? item.commodityTags : tags,
  };
}

/**
 * @returns {{ match: boolean, scope?: 'symbol'|'product-name'|'exchange-rule' }}
 */
function exchangeNoticeMatchesSymbol(item, sym) {
  if (!item?.title) return { match: false };
  const id = normalizeCommodityId(sym);
  const enriched = enrichExchangeNoticeSymbols(item);

  if (itemMatchesSymbolTags(enriched, id)) {
    return { match: true, scope: 'symbol' };
  }

  const meta = getCommodityMeta(id);
  if (!meta) return { match: false };

  const text = itemText(enriched);
  if (meta.name && meta.name.length >= 2 && text.includes(meta.name)) {
    return { match: true, scope: 'product-name' };
  }

  const itemExId = EXCHANGE_LABEL_TO_ID[enriched.exchangeLabel];
  if (!itemExId || itemExId !== meta.exchangeId) {
    return { match: false };
  }

  if (HARD_RULE_RE.test(text) && enriched.symbols?.map(normalizeCommodityId).includes(id)) {
    return { match: true, scope: 'exchange-rule' };
  }

  if (/《[^》]*?(商品|期货)交易所[^》]*》/.test(text) && enriched.symbols?.length) {
    if (enriched.symbols.map(normalizeCommodityId).includes(id)) {
      return { match: true, scope: 'exchange-doc' };
    }
  }

  return { match: false };
}

function countExchangeHitsBySymbol(items, symbols) {
  const stats = { symbolHits: 0, byScope: {} };
  for (const sym of symbols) {
    const hit = items.find((it) => exchangeNoticeMatchesSymbol(it, sym).match);
    if (hit) {
      stats.symbolHits += 1;
      const { scope } = exchangeNoticeMatchesSymbol(hit, sym);
      stats.byScope[scope] = (stats.byScope[scope] || 0) + 1;
    }
  }
  return stats;
}

module.exports = {
  EXCHANGE_LABEL_TO_ID,
  EXCHANGE_ID_TO_LABEL,
  enrichExchangeNoticeSymbols,
  exchangeNoticeMatchesSymbol,
  itemMatchesSymbolTags,
  countExchangeHitsBySymbol,
};
