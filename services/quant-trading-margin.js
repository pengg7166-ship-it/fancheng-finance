/**
 * 合约规格与保证金 — 国内期货主力连续合约仿真参数
 */
const futuresSpecs = require('./futures-contract-specs');
const directionArchive = require('./direction-prediction-archive');
const { getBarOi } = require('./oi-behavior-features');

const MARGIN_SOURCE_LABEL =
  '各交易所合约规则 + 仿真保证金率（交易所基准约 8–14%，此处取经纪商常见加收后）';

const CONTRACT_SPECS = futuresSpecs.CONTRACT_SPECS;

const TRADABLE_INSTRUMENTS = {
  au: { enabled: true, rationale: 'sim_balanced ~57% 命中（n=7）；贵金属核心品种，与 ag 组合提升样本' },
  ag: { enabled: true, rationale: 'sim_balanced ~80% 命中（n=15），探针池内最高；主力仿真品种' },
  rb: { enabled: true, rationale: 'sim_balanced OOS ~66.7% 方向命中（n=3），audit_relaxed tier；扩大样本量，螺纹钢流动性好' },
  cu: { enabled: false, rationale: 'sim_balanced ~42.9% 命中（n=7），低于 60% 门槛；暂不纳入 live P0' },
};

const DEFAULT_POOL = Object.entries(TRADABLE_INSTRUMENTS)
  .filter(([, v]) => v.enabled)
  .map(([k]) => k);

const MIN_FUNDAMENTAL_CHAN_BARS = 60;
const MIN_DEPOSIT_YUAN = 4e9;
const QUANT_INSTRUMENT_BLACKLIST = ['ec'];
const DEPOSIT_FORMULA = 'openInterest × close × multiplier（日 K 最近一根含 OI 的 bar）';

function getContractSpec(instrumentId) {
  return futuresSpecs.getContractSpec(instrumentId);
}

function calcNotional(price, instrumentId, lots = 1) {
  const spec = getContractSpec(instrumentId);
  if (!spec) return 0;
  return Number(price) * spec.multiplier * Math.max(1, lots);
}

function calcMarginRequired(price, instrumentId, lots = 1) {
  const spec = getContractSpec(instrumentId);
  if (!spec) return 0;
  return calcNotional(price, instrumentId, lots) * spec.marginRate;
}

function applySlippage(price, instrumentId, direction, ticks = 1) {
  const spec = getContractSpec(instrumentId);
  if (!spec || !ticks) return price;
  const adj = spec.tickSize * ticks;
  if (direction === 'long') return price + adj;
  if (direction === 'short') return price - adj;
  return price;
}

function getTradablePool() {
  return [...DEFAULT_POOL];
}

function getLatestDepositSnapshot(instrumentId, bars) {
  const spec = getContractSpec(instrumentId);
  if (!spec || !bars?.length) return null;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const oi = getBarOi(bars[i]);
    const close = Number(bars[i]?.close);
    if (oi == null || !(close > 0)) continue;
    return {
      depositYuan: oi * close * spec.multiplier,
      oi,
      close,
      multiplier: spec.multiplier,
      date: String(bars[i].date).slice(0, 10),
    };
  }
  return null;
}

function calcMarketDepositYuan(instrumentId, bars) {
  const snap = getLatestDepositSnapshot(instrumentId, bars || directionArchive.readKlineBars(instrumentId));
  return snap?.depositYuan ?? null;
}

function formatDepositYi(yuan) {
  if (yuan == null || Number.isNaN(yuan)) return '—';
  return `${(yuan / 1e8).toFixed(2)}亿`;
}

function getDepositFilterReport(baseIds, minYuan = MIN_DEPOSIT_YUAN) {
  const kept = [];
  const excluded = [];
  for (const id of baseIds) {
    const bars = directionArchive.readKlineBars(id);
    const snap = getLatestDepositSnapshot(id, bars);
    if (!snap || snap.depositYuan < minYuan) {
      excluded.push({
        id,
        depositYuan: snap?.depositYuan ?? null,
        date: snap?.date ?? null,
        oi: snap?.oi ?? null,
        close: snap?.close ?? null,
        multiplier: snap?.multiplier ?? null,
        reason: snap ? 'below_min' : 'no_oi',
      });
      continue;
    }
    kept.push({ id, ...snap });
  }
  kept.sort((a, b) => b.depositYuan - a.depositYuan);
  excluded.sort((a, b) => (b.depositYuan ?? 0) - (a.depositYuan ?? 0));
  return { kept: kept.map((k) => k.id), keptDetail: kept, excluded, minYuan };
}

function logDepositFilter(report) {
  const { kept, excluded, minYuan } = report;
  console.log(
    `[deposit-filter] min=${formatDepositYi(minYuan)} kept=${kept.length} excluded=${excluded.length} formula=${DEPOSIT_FORMULA}`
  );
  for (const row of excluded) {
    const parts = [
      row.id,
      `deposit=${formatDepositYi(row.depositYuan)}`,
      row.date ? `asOf=${row.date}` : null,
      row.reason === 'no_oi' ? 'reason=no_oi' : null,
    ].filter(Boolean);
    console.log(`  excluded: ${parts.join(' · ')}`);
  }
}

function getFundamentalChanPoolRaw() {
  const { INSTRUMENT_REGISTRY } = require('./commodity-outlook-engine');
  const seen = new Set();
  const out = [];
  for (const spec of INSTRUMENT_REGISTRY) {
    const id = String(spec.id).toLowerCase();
    if (seen.has(id)) continue;
    if (!getContractSpec(id)) continue;
    const bars = directionArchive.readKlineBars(spec.id);
    if (bars.length < MIN_FUNDAMENTAL_CHAN_BARS) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function applyInstrumentBlacklist(ids) {
  const blocked = new Set(QUANT_INSTRUMENT_BLACKLIST);
  return ids.filter((id) => !blocked.has(id));
}

function getTradablePoolByDeposit(minYuan = MIN_DEPOSIT_YUAN, basePool) {
  const base = basePool || getFundamentalChanPoolRaw();
  const report = getDepositFilterReport(base, minYuan);
  logDepositFilter(report);
  return report.kept;
}

function getFundamentalChanPool(opts = {}) {
  const raw = getFundamentalChanPoolRaw();
  if (opts.skipDepositFilter) return applyInstrumentBlacklist(raw);
  const minYuan = opts.minDepositYuan ?? MIN_DEPOSIT_YUAN;
  const report = getDepositFilterReport(raw, minYuan);
  if (opts.logFilter !== false) logDepositFilter(report);
  return applyInstrumentBlacklist(report.kept);
}

function getInstrumentRationale(instrumentId) {
  return TRADABLE_INSTRUMENTS[String(instrumentId || '').toLowerCase()] || null;
}

module.exports = {
  MARGIN_SOURCE_LABEL,
  CONTRACT_SPECS,
  TRADABLE_INSTRUMENTS,
  DEFAULT_POOL,
  MIN_FUNDAMENTAL_CHAN_BARS,
  MIN_DEPOSIT_YUAN,
  QUANT_INSTRUMENT_BLACKLIST,
  DEPOSIT_FORMULA,
  getContractSpec,
  calcNotional,
  calcMarginRequired,
  applySlippage,
  calcMarketDepositYuan,
  getDepositFilterReport,
  logDepositFilter,
  getTradablePool,
  getFundamentalChanPoolRaw,
  getTradablePoolByDeposit,
  getFundamentalChanPool,
  getInstrumentRationale,
};
