/**
 * 全品种次日 high/low 区间校准覆盖率汇总
 * FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/probe-all-range-coverage-summary.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const { getAllCommodities } = require('../services/commodities-catalog');
const { getInstrumentProfile } = require('../services/commodity-instrument-profiles');
const { getDataDir } = require('../services/data-paths');
const { predictNextDayHighLowFromBars } = require('../services/intraday-range-predictor');
const cnSession = require('../services/cn-futures-session-calendar');
const preciousCal = require('../services/precious-range-calibration');
const nonferrousCal = require('../services/nonferrous-range-calibration');
const blackCal = require('../services/black-range-calibration');
const energyCal = require('../services/energy-range-calibration');
const chemicalCal = require('../services/chemical-range-calibration');
const agriCal = require('../services/agricultural-range-calibration');
const shippingCal = require('../services/shipping-range-calibration');

const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';
const COVERAGE_TARGET = 75;
const VOLUME_LOOKBACK = 20;
const MIN_BARS = 30;

const SECTOR_CN = {
  precious: '贵金属',
  metals: '有色',
  black: '黑色',
  chemical: '化工',
  energy: '能源',
  agriculture: '农产品',
};

function sectorLabel(id, sectorEn) {
  if (String(id).toLowerCase() === 'ec') return '航运';
  if (String(id).toUpperCase() === 'ZC') return '其它';
  return SECTOR_CN[sectorEn] || '其它';
}

function calFileFor(id) {
  const lid = String(id).toLowerCase();
  if (lid === 'au' || lid === 'ag') return 'precious-range-calibration-v1.json';
  if (lid === 'ec') return 'shipping-range-calibration-v1.json';
  if (nonferrousCal.CALIBRATED_IDS.includes(lid)) return 'nonferrous-range-calibration-v1.json';
  if (blackCal.CALIBRATED_IDS.includes(lid)) return 'black-range-calibration-v1.json';
  if (energyCal.CALIBRATED_IDS.includes(lid)) return 'energy-range-calibration-v1.json';
  if (chemicalCal.CALIBRATED_IDS.includes(lid)) return 'chemical-range-calibration-v1.json';
  if (agriCal.CALIBRATED_IDS.includes(lid)) return 'agricultural-range-calibration-v1.json';
  return '—';
}

function isCalibrated(id) {
  const lid = String(id).toLowerCase();
  if (lid === 'au' || lid === 'ag') {
    const m = preciousCal.loadCalParams?.()?.metrics;
    return !!(m?.au || m?.ag || preciousCal.getInstrumentCal?.('au'));
  }
  if (shippingCal.isCalibrated(lid)) return true;
  if (nonferrousCal.isCalibrated(lid)) return true;
  if (blackCal.isCalibrated(lid)) return true;
  if (energyCal.isCalibrated(lid)) return true;
  if (chemicalCal.isCalibrated(lid)) return true;
  if (agriCal.isCalibrated(lid)) return true;
  return false;
}

function predMethod(id) {
  const lid = String(id).toLowerCase();
  if (lid === 'au' || lid === 'ag') return 'precious-range';
  if (shippingCal.isCalibrated(lid)) return 'shipping-range-calibrated';
  if (nonferrousCal.isCalibrated(lid)) return 'nonferrous-range-calibrated';
  if (blackCal.isCalibrated(lid)) return 'black-range-calibrated';
  if (energyCal.isCalibrated(lid)) return 'energy-range-calibrated';
  if (chemicalCal.isCalibrated(lid)) return 'chemical-range-calibrated';
  if (agriCal.isCalibrated(lid)) return 'agricultural-range-calibrated';
  return 'default';
}

function loadBars(id) {
  const base = getDataDir() || 'E:\\FanchengFinance\\data';
  const candidates = [id, id.toUpperCase(), id.toLowerCase()];
  const seen = new Set();
  for (const key of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    const fp = path.join(base, 'history', 'trading', `${key}.json`);
    if (!fs.existsSync(fp)) continue;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return (Array.isArray(raw) ? raw : raw.series || [])
      .filter((b) => b.date && Number(b.close) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  return [];
}

function barVolume(bar) {
  return Number(bar.volume ?? bar.vol ?? bar.turnoverVol ?? 0) || 0;
}

function assessTrading(id) {
  const bars = loadBars(id);
  if (bars.length < MIN_BARS) {
    return { active: false, reason: 'no_data', bars: bars.length, hasFile: bars.length > 0 };
  }
  const recent = bars.slice(-VOLUME_LOOKBACK);
  const maxVol = Math.max(...recent.map(barVolume));
  if (maxVol <= 0) {
    return { active: false, reason: 'zero_volume', bars: bars.length, hasFile: true };
  }
  return { active: true, reason: null, bars: bars.length, hasFile: true };
}

function withinBand(actualHigh, actualLow, predLow, predHigh) {
  return actualHigh <= predHigh && actualLow >= predLow;
}

function probeInstrument(id) {
  const bars = loadBars(id);
  if (bars.length < MIN_BARS) {
    return { id, error: 'insufficient_bars', n: bars.length };
  }

  let within = 0;
  let scored = 0;

  for (let i = 20; i < bars.length - 1; i += 1) {
    const asOf = cnSession.normBarDate(bars[i]);
    if (asOf < TEST_FROM || asOf > TEST_TO) continue;
    const pair = cnSession.getSessionPair(bars, i);
    if (!pair) continue;

    const pred = predictNextDayHighLowFromBars({
      instrumentId: id,
      klines: bars.slice(0, i + 1),
      asOfDate: asOf,
    });
    if (!pred || pred.highDelta == null || pred.lowDelta == null) continue;

    if (withinBand(pair.target.high, pair.target.low, pred.predictedLow, pred.predictedHigh)) within += 1;
    scored += 1;
  }

  const rangeCoveragePct = scored ? +((within / scored) * 100).toFixed(2) : null;
  return {
    id,
    calibrated: isCalibrated(id),
    scored,
    rangeCoveragePct,
    method: predMethod(id),
  };
}

function statusFor(row) {
  if (row.skipReason === 'wr') return '— WR跳过';
  if (row.skipReason === 'no_volume') return '⛔无成交跳过';
  if (row.rangeCoveragePct == null) return '⛔无成交跳过';
  if (row.rangeCoveragePct >= COVERAGE_TARGET) return '✅已校准≥75%';
  return '⚠️未校准';
}

function pad(s, w) {
  const str = String(s ?? '');
  return str.length >= w ? str : str + ' '.repeat(w - str.length);
}

function main() {
  const commodities = getAllCommodities();
  const rows = [];

  for (const meta of commodities) {
    const id = meta.id;
    const profile = getInstrumentProfile(id);
    const sector = sectorLabel(id, profile.sector);
    const name = meta.name || profile.name || id;
    const calFile = calFileFor(id);

    if (String(id).toLowerCase() === 'wr') {
      rows.push({
        id,
        name,
        sector,
        oosSamples: null,
        rangeCoveragePct: null,
        status: '— WR跳过',
        calFile,
        skipReason: 'wr',
        method: null,
      });
      continue;
    }

    const trading = assessTrading(id);
    if (!trading.active) {
      rows.push({
        id,
        name,
        sector,
        oosSamples: null,
        rangeCoveragePct: null,
        status: '⛔无成交跳过',
        calFile,
        skipReason: 'no_volume',
        skipDetail: trading.reason,
        barsTotal: trading.bars,
        method: null,
      });
      continue;
    }

    process.stderr.write(`probing ${id}...\n`);
    const probe = probeInstrument(id);
    const row = {
      id,
      name,
      sector,
      oosSamples: probe.scored ?? null,
      rangeCoveragePct: probe.rangeCoveragePct ?? null,
      status: null,
      calFile,
      calibrated: probe.calibrated,
      method: probe.method,
      error: probe.error || null,
    };
    row.status = statusFor(row);
    rows.push(row);
  }

  const active = rows.filter((r) => !r.skipReason);
  const excluded = rows.filter((r) => r.skipReason);
  const hit = active.filter((r) => r.rangeCoveragePct != null && r.rangeCoveragePct >= COVERAGE_TARGET);
  const miss = active.filter((r) => r.rangeCoveragePct != null && r.rangeCoveragePct < COVERAGE_TARGET);
  const noScore = active.filter((r) => r.rangeCoveragePct == null);

  const sectorBreakdown = {};
  for (const r of rows) {
    if (!sectorBreakdown[r.sector]) {
      sectorBreakdown[r.sector] = { total: 0, hit: 0, miss: 0, excluded: 0, wr: 0 };
    }
    const s = sectorBreakdown[r.sector];
    s.total += 1;
    if (r.skipReason === 'wr') s.wr += 1;
    else if (r.skipReason === 'no_volume') s.excluded += 1;
    else if (r.rangeCoveragePct != null && r.rangeCoveragePct >= COVERAGE_TARGET) s.hit += 1;
    else if (r.rangeCoveragePct != null) s.miss += 1;
  }

  const payload = {
    version: 'probe-all-range-coverage-summary-v1',
    generatedAt: new Date().toISOString(),
    testFrom: TEST_FROM,
    testTo: TEST_TO,
    coverageTargetPct: COVERAGE_TARGET,
    rules: {
      excludeWr: true,
      excludeZeroVolume: true,
      volumeLookbackBars: VOLUME_LOOKBACK,
    },
    aggregate: {
      catalogTotal: rows.length,
      activeCounted: active.length,
      hit75OrAbove: hit.length,
      below75: miss.length,
      noScoreActive: noScore.length,
      excludedNoVolume: excluded.filter((r) => r.skipReason === 'no_volume').length,
      excludedWr: excluded.filter((r) => r.skipReason === 'wr').length,
      excludedTotal: excluded.length,
    },
    sectorBreakdown,
    instruments: rows,
  };

  const jsonOut = path.join(process.cwd(), '_probe-all-range-coverage-summary.json');
  fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [];
  lines.push('全品种次日 high/low 区间校准覆盖率汇总');
  lines.push(`生成时间: ${payload.generatedAt}`);
  lines.push(`OOS窗口: ${TEST_FROM} ~ ${TEST_TO} · 目标覆盖率 ≥ ${COVERAGE_TARGET}%`);
  lines.push(`规则: WR 不纳入 · 近 ${VOLUME_LOOKBACK} 根 K 线无成交量/无数据不纳入`);
  lines.push('');
  lines.push(
    `${pad('品种', 6)} | ${pad('名称', 10)} | ${pad('板块', 6)} | ${pad('OOS样本', 8)} | ${pad('覆盖率%', 8)} | ${pad('状态', 14)} | 校准文件`,
  );
  lines.push('-'.repeat(100));

  for (const r of rows.sort((a, b) => {
    const so = { 贵金属: 1, 有色: 2, 黑色: 3, 化工: 4, 能源: 5, 农产品: 6, 航运: 7, 其它: 8 };
    const ds = (so[a.sector] || 9) - (so[b.sector] || 9);
    if (ds !== 0) return ds;
    return String(a.id).localeCompare(String(b.id));
  })) {
    lines.push(
      `${pad(r.id, 6)} | ${pad(r.name, 10)} | ${pad(r.sector, 6)} | ${pad(r.oosSamples ?? '—', 8)} | ${pad(r.rangeCoveragePct != null ? r.rangeCoveragePct.toFixed(2) : '—', 8)} | ${pad(r.status, 14)} | ${r.calFile}`,
    );
  }

  lines.push('');
  lines.push('=== 汇总统计 ===');
  lines.push(`catalog 品种总数: ${payload.aggregate.catalogTotal}`);
  lines.push(`纳入统计(active): ${payload.aggregate.activeCounted}`);
  lines.push(`≥75% 已达标: ${payload.aggregate.hit75OrAbove}`);
  lines.push(`<75% 待补: ${payload.aggregate.below75}`);
  lines.push(`排除(无成交/无数据): ${payload.aggregate.excludedNoVolume}`);
  lines.push(`排除(WR): ${payload.aggregate.excludedWr}`);
  lines.push('');
  lines.push('=== 板块分布 ===');
  for (const [sec, s] of Object.entries(sectorBreakdown).sort()) {
    lines.push(
      `${sec}: 共${s.total} · 达标${s.hit} · 未达标${s.miss} · 无成交跳过${s.excluded} · WR跳过${s.wr}`,
    );
  }

  const txtOut = path.join(process.cwd(), '_probe-all-range-coverage-summary.txt');
  fs.writeFileSync(txtOut, lines.join('\n'), 'utf8');

  console.log(lines.join('\n'));
  console.log(`\nWrote ${jsonOut}`);
  console.log(`Wrote ${txtOut}`);
}

main();
