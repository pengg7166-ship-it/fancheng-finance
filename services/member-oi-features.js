/**
 * 会员持仓结构特征（集中度 / TopN / 多空净增减）
 * 数据源：大商所门户 / 上期所 pm.dat / 郑商所 Holding.xlsx；不编造席位。
 */
const MEMBER_OI_VERSION = 'v1.56.21-gfex-member-rank';

function sumField(list, field) {
  let s = 0;
  for (const row of list || []) {
    const n = Number(row?.[field]);
    if (Number.isFinite(n)) s += n;
  }
  return s;
}

function topShare(list, field, n = 5) {
  const rows = (list || [])
    .map((r) => ({ name: r.buyAbbr || r.sellAbbr || r.qtyAbbr || '', qty: Number(r[field]) || 0 }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty);
  const total = rows.reduce((s, r) => s + r.qty, 0);
  if (!total) return { share: null, top: [], total: 0 };
  const top = rows.slice(0, n);
  const share = top.reduce((s, r) => s + r.qty, 0) / total;
  return { share: +share.toFixed(4), top, total };
}

function hhi(list, field) {
  const rows = (list || []).map((r) => Number(r[field]) || 0).filter((n) => n > 0);
  const total = rows.reduce((s, n) => s + n, 0);
  if (!total) return null;
  let score = 0;
  for (const n of rows) {
    const p = n / total;
    score += p * p;
  }
  return +score.toFixed(6);
}

function deriveMemberOiFeatures(memberRow) {
  if (!memberRow || memberRow.empty || memberRow.error) {
    return {
      version: MEMBER_OI_VERSION,
      available: false,
      reason: memberRow?.error || (memberRow?.empty ? 'empty' : 'missing'),
      note: memberRow?.note || undefined,
      dataSource: memberRow?.dataSource || undefined,
    };
  }
  const data = memberRow.data || {};
  const buyList = data.buyFutureList || [];
  const sellList = data.sellFutureList || [];
  const buyTop5 = topShare(buyList, 'todayBuyQty', 5);
  const sellTop5 = topShare(sellList, 'todaySellQty', 5);
  const buySub = memberRow.buySub != null ? Number(memberRow.buySub) : Number(data.buySub);
  const sellSub = memberRow.sellSub != null ? Number(memberRow.sellSub) : Number(data.sellSub);
  const netSub =
    Number.isFinite(buySub) && Number.isFinite(sellSub) ? buySub - sellSub : null;

  return {
    version: MEMBER_OI_VERSION,
    available: true,
    varietyId: memberRow.varietyId,
    tradeDate: memberRow.tradeDate,
    contractId: memberRow.contractId,
    buySub: Number.isFinite(buySub) ? buySub : null,
    sellSub: Number.isFinite(sellSub) ? sellSub : null,
    netSub,
    todayBuyQty: memberRow.todayBuyQty ?? data.todayBuyQty ?? null,
    todaySellQty: memberRow.todaySellQty ?? data.todaySellQty ?? null,
    buyTop5Share: buyTop5.share,
    sellTop5Share: sellTop5.share,
    buyHhi: hhi(buyList, 'todayBuyQty'),
    sellHhi: hhi(sellList, 'todaySellQty'),
    buyTopNames: buyTop5.top.slice(0, 3).map((t) => t.name).filter(Boolean),
    sellTopNames: sellTop5.top.slice(0, 3).map((t) => t.name).filter(Boolean),
    dataSource: memberRow.dataSource || 'dce-portal-api',
    method: 'member-oi-features',
  };
}

function resolveExchangeId(meta) {
  if (meta?.exchangeId) return String(meta.exchangeId).toLowerCase();
  const short = String(meta?.exchange || '');
  if (/大商|DCE/i.test(short)) return 'dce';
  if (/郑商|CZCE|ZCE/i.test(short)) return 'zce';
  if (/能源|INE/i.test(short)) return 'ine';
  if (/上期|SHFE/i.test(short)) return 'shfe';
  if (/广期|GFEX/i.test(short)) return 'gfex';
  return '';
}

function loadMemberOiFeatures(varietyId) {
  const id = String(varietyId || '').toLowerCase();
  try {
    const { getCommodityMeta } = require('./commodities-catalog');
    const meta = getCommodityMeta(id);
    const exId = resolveExchangeId(meta);

    if (exId === 'dce') {
      const dce = require('./dce-portal-api-fetcher');
      return deriveMemberOiFeatures(dce.loadLatestMemberPosi?.(id));
    }

    if (exId === 'shfe' || exId === 'ine') {
      const shfe = require('./shfe-member-ranking-fetcher');
      const row = shfe.loadLatestMemberPosi?.(id);
      if (!row) {
        return {
          version: MEMBER_OI_VERSION,
          available: false,
          reason: 'missing_cache',
          exchange: exId,
          instrumentId: id,
          note: '上期/能源会员排名尚未落盘；请跑日更 member_ranking',
        };
      }
      return deriveMemberOiFeatures(row);
    }

    if (exId === 'zce') {
      const czce = require('./czce-member-ranking-fetcher');
      const row = czce.loadLatestMemberPosi?.(id);
      if (!row) {
        return {
          version: MEMBER_OI_VERSION,
          available: false,
          reason: 'missing_cache',
          exchange: exId,
          instrumentId: id,
          note: '郑商所会员排名尚未落盘；请跑日更 member_ranking',
        };
      }
      return deriveMemberOiFeatures(row);
    }

    if (exId === 'gfex') {
      const gfex = require('./gfex-member-ranking-fetcher');
      const row = gfex.loadLatestMemberPosi?.(id);
      if (!row) {
        return {
          version: MEMBER_OI_VERSION,
          available: false,
          reason: 'missing_cache',
          exchange: exId,
          instrumentId: id,
          note: '广期所会员排名尚未落盘；请跑日更 member_ranking',
        };
      }
      return deriveMemberOiFeatures(row);
    }

    return {
      version: MEMBER_OI_VERSION,
      available: false,
      reason: 'no_free_member_ranking_source',
      exchange: exId || meta?.exchange || null,
      instrumentId: id,
      note: '该交易所暂无稳定免费会员排名源；UI 显示暂无，不编造',
    };
  } catch (err) {
    return { version: MEMBER_OI_VERSION, available: false, reason: err.message, instrumentId: id };
  }
}

module.exports = {
  MEMBER_OI_VERSION,
  deriveMemberOiFeatures,
  loadMemberOiFeatures,
  topShare,
  hhi,
  sumField,
};
