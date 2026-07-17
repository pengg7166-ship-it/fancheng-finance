/**
 * 贵金属板'P0 数据加载 '实际利率、伦敦金、CNH 溢价、ETF 持仓（stub'
 * 路径均相'FANCHENG_DATA_DRIVE/data/history/
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const fredHistory = require('./fred-history-fetcher');
const crossAsset = require('./commodity-cross-asset-regime');

/** P0 序列文件（已就绪'*/
const PRECIOUS_P0_FILES = {
  real10y: 'fred-real10y-daily.json',
  londonGold: 'fred-london-gold-daily.json',
  cnhMidrate: 'cnh-midrate-daily.json',
  cnhFallback: 'fred-dexchus-daily.json',
  /** P1 'GLD 日持仓（user-import+gap-fill'*/
  etfHoldings: 'precious-etf-holdings-daily.json',
  /** P0 'SLV 白银 ETF 日持仓（'user-slv-holdings.csv 导入'*/
  slvHoldings: 'slv-etf-holdings-daily.json',
};

function historyPath(filename) {
  return path.join(fredHistory.getHistoryDir(), filename);
}

function loadLocalSeries(filename) {
  const fp = historyPath(filename);
  if (!fs.existsSync(fp)) return { bars: [], meta: { file: filename, exists: false } };
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const bars = raw.data || raw.series || (Array.isArray(raw) ? raw : []);
  return {
    bars: bars.map((r) => ({
      date: String(r.date).slice(0, 10),
      close: r.value ?? r.close,
    })),
    meta: { file: filename, exists: true, rowCount: bars.length, source: raw.source },
  };
}

/**
 * 加载贵金'P0 上下文（回测/walk-forward 用）
 * ETF 未落盘时返回 gldProxyNote，不阻断引擎
 */
function loadPreciousP0Context(asOfDate) {
  const real10y = loadLocalSeries(PRECIOUS_P0_FILES.real10y);
  const londonGold = loadLocalSeries(PRECIOUS_P0_FILES.londonGold);
  let cnh = loadLocalSeries(PRECIOUS_P0_FILES.cnhMidrate);
  if (cnh.bars.length < 20) {
    cnh = loadLocalSeries(PRECIOUS_P0_FILES.cnhFallback);
    cnh.meta.proxy = true;
  }
  const etf = loadLocalSeries(PRECIOUS_P0_FILES.etfHoldings);

  const auOverlay = crossAsset.computeAuSpotCnhOverlay(asOfDate, {});

  return {
    asOfDate,
    files: PRECIOUS_P0_FILES,
    real10y: real10y.meta,
    londonGold: londonGold.meta,
    cnh: cnh.meta,
    etf: etf.meta.exists
      ? etf.meta
      : {
          exists: false,
          stub: true,
          proxyPath: 'history/precious-etf-holdings-daily.json',
          proxyNote:
            'P1：可接 GLD/IAU 份额/tonnage 序列（FRED/雅虎/Stooq）写入 stub 文件；引擎暂用 real10y+london+CNH 溢价',
          gldTickerProxy: 'GLD',
        },
    auSpotCnhOverlay: {
      gated: auOverlay.gated,
      dataSources: auOverlay.dataSources,
      premiumChg5: auOverlay.premiumChg5,
    },
  };
}

module.exports = {
  PRECIOUS_P0_FILES,
  loadPreciousP0Context,
  loadLocalSeries,
};
