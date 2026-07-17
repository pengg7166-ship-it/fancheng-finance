/**
 * Sector-batch T+1 unified probe with crash-safe progress file.
 * Usage: FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=3072 node scripts/probe-t1-unified-sectors.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const SECTORS = ['precious', 'metals', 'black', 'energy', 'chemical', 'agriculture'];
const PROGRESS = path.join(process.cwd(), '_t1-unified-retrain-progress.json');
const SECTOR_DIR = path.join(process.cwd(), 'data', 'exports', 't1-unified-probe-sectors');
const MERGED = path.join(process.cwd(), 'data', 'exports', 't1-unified-probe-report.json');
const MERGED_TXT = path.join(process.cwd(), '_t1-unified-probe-out.txt');

function loadProgress() {
  if (!fs.existsSync(PROGRESS)) return { phaseA: 'done', phaseB: 'done', phaseC: {}, sectors: {} };
  return JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
}

function saveProgress(p) {
  p.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2), 'utf8');
}

function pct(h, s) {
  return s ? +((h / s) * 100).toFixed(2) : null;
}

function mergeSectorReports(sectorFiles) {
  const reports = sectorFiles.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const first = reports[0];

  function mergeSummaries(key, subkey) {
    let rawHits = 0;
    let rawScored = 0;
    let gatedHits = 0;
    let gatedScored = 0;
    const perInstrument = [];
    const bySector = {};

    for (const r of reports) {
      const block = r[key]?.[subkey];
      if (!block) continue;
      rawHits += block.overall.raw.hits;
      rawScored += block.overall.raw.scored;
      gatedHits += block.overall.gated.hits;
      gatedScored += block.overall.gated.scored;
      perInstrument.push(...(block.perInstrument || []));
      Object.assign(bySector, block.bySector || {});
    }

    const auAgRows = perInstrument.filter((x) => x.instrumentId === 'au' || x.instrumentId === 'ag');
    let auRawHits = 0;
    let auRawScored = 0;
    let auGatedHits = 0;
    let auGatedScored = 0;
    for (const x of auAgRows) {
      auRawHits += x.raw.hits;
      auRawScored += x.raw.scored;
      auGatedHits += x.gated.hits;
      auGatedScored += x.gated.scored;
    }

    return {
      overall: {
        raw: { hits: rawHits, scored: rawScored, hitRatePct: pct(rawHits, rawScored) },
        gated: { hits: gatedHits, scored: gatedScored, hitRatePct: pct(gatedHits, gatedScored) },
      },
      auAg: {
        raw: { hits: auRawHits, scored: auRawScored, hitRatePct: pct(auRawHits, auRawScored) },
        gated: { hits: auGatedHits, scored: auGatedScored, hitRatePct: pct(auGatedHits, auGatedScored) },
      },
      bySector,
      perInstrument,
      instrumentCount: perInstrument.length,
    };
  }

  const prodFull = mergeSummaries('production', 'full');
  const prodOos = mergeSummaries('production', 'oos');
  const expFull = mergeSummaries('experiment', 'full');
  const expOos = mergeSummaries('experiment', 'oos');

  const delta = (a, b) => (a != null && b != null ? +(b - a).toFixed(2) : null);
  const comparison = {
    oosRawOverallPp: delta(prodOos.overall.raw.hitRatePct, expOos.overall.raw.hitRatePct),
    oosGatedOverallPp: delta(prodOos.overall.gated.hitRatePct, expOos.overall.gated.hitRatePct),
    oosGatedAuAgPp: delta(prodOos.auAg.gated.hitRatePct, expOos.auAg.gated.hitRatePct),
  };

  const config = require('../services/t1-unified-config').loadConfig();
  const baselines = config.scoring?.baselines || {};
  const minN = config.scoring?.gateMinScored ?? 200;
  const beatPp = config.scoring?.gateBeatBaselinePp ?? 2;
  const target = config.scoring?.targetHitRatePct ?? 75;
  const oos = expOos.overall.raw;
  const oosAuAg = expOos.auAg.gated;
  const beatRaw = oos?.hitRatePct != null && oos.scored >= minN && oos.hitRatePct >= (baselines.t1RawOverallPct ?? 52.11) + beatPp;
  const reach75 = oos?.hitRatePct != null && oos.scored >= minN && oos.hitRatePct >= target;
  const beatAuAg = oosAuAg?.hitRatePct != null && oosAuAg.scored >= 100 && oosAuAg.hitRatePct >= (baselines.t1GatedAuAgPct ?? 54.28) + beatPp;
  const gate = { passed: beatRaw || reach75 || beatAuAg, beatRaw, reach75, beatAuAg };

  return {
    generatedAt: new Date().toISOString(),
    horizon: 1,
    mergedFromSectors: reports.map((r) => r.window?.sector).filter(Boolean),
    instrumentCount: prodFull.instrumentCount,
    window: { from: first.window?.from, to: first.window?.to, oosFrom: first.window?.oosFrom, oosTo: first.window?.oosTo },
    production: { full: prodFull, oos: prodOos },
    experiment: { full: expFull, oos: expOos },
    comparison,
    gate,
    deployRecommendation: gate.passed
      ? 'EXPERIMENT_PASSED — document deploy steps; do NOT overwrite production v1.34.8 without explicit approval'
      : 'GATE_FAIL — keep production v1.34.8',
  };
}

function formatTxt(payload) {
  const lines = [];
  lines.push('=== T+1 Unified Experiment Probe (merged sectors) ===');
  lines.push(`OOS: ${payload.window.oosFrom} → ${payload.window.oosTo}`);
  lines.push(`Instruments: ${payload.instrumentCount}`);
  lines.push('');
  lines.push('--- Production v1.34.8 OOS ---');
  lines.push(`Raw: ${payload.production.oos.overall.raw.hitRatePct}% (n=${payload.production.oos.overall.raw.scored})`);
  lines.push(`Gated: ${payload.production.oos.overall.gated.hitRatePct}% (n=${payload.production.oos.overall.gated.scored})`);
  lines.push(`Au+Ag gated: ${payload.production.oos.auAg.gated.hitRatePct}% (n=${payload.production.oos.auAg.gated.scored})`);
  lines.push('');
  lines.push('--- Experiment OOS ---');
  lines.push(`Raw: ${payload.experiment.oos.overall.raw.hitRatePct}% (n=${payload.experiment.oos.overall.raw.scored})`);
  lines.push(`Gated: ${payload.experiment.oos.overall.gated.hitRatePct}% (n=${payload.experiment.oos.overall.gated.scored})`);
  lines.push(`Au+Ag gated: ${payload.experiment.oos.auAg.gated.hitRatePct}% (n=${payload.experiment.oos.auAg.gated.scored})`);
  lines.push('');
  lines.push('--- Delta (experiment − production) ---');
  lines.push(JSON.stringify(payload.comparison, null, 2));
  lines.push('');
  lines.push(`Gate: ${payload.gate.passed ? 'PASS' : 'FAIL'}`);
  lines.push(`Deploy: ${payload.deployRecommendation}`);
  return lines.join('\n');
}

function main() {
  fs.mkdirSync(SECTOR_DIR, { recursive: true });
  const progress = loadProgress();
  progress.phaseC = progress.phaseC || { status: 'in_progress', startedAt: new Date().toISOString() };
  progress.sectors = progress.sectors || {};

  for (const sector of SECTORS) {
    const outFile = path.join(SECTOR_DIR, `${sector}.json`);
    if (progress.sectors[sector]?.status === 'done' && fs.existsSync(outFile)) {
      console.log(`skip ${sector} (already done)`);
      continue;
    }

    console.log(`\n=== probe sector: ${sector} ===`);
    progress.sectors[sector] = { status: 'running', startedAt: new Date().toISOString() };
    saveProgress(progress);

    const env = { ...process.env, FANCHENG_DATA_DRIVE: process.env.FANCHENG_DATA_DRIVE || 'E', NODE_OPTIONS: '--max-old-space-size=3072' };
    const r = spawnSync(
      process.execPath,
      ['scripts/probe-t1-unified-experiment.js', '--sector', sector, '--oos-from', '2023-01-01', '--oos-to', '2025-12-31'],
      { env, cwd: process.cwd(), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    );

    if (r.status !== 0) {
      progress.sectors[sector] = { status: 'failed', error: (r.stderr || r.stdout || '').slice(-500), at: new Date().toISOString() };
      saveProgress(progress);
      console.error(`FAILED ${sector}:`, r.stderr || r.stdout);
      process.exit(1);
    }

    const probeOut = path.join(process.cwd(), 'data', 'exports', 't1-unified-probe-report.json');
    if (!fs.existsSync(probeOut)) throw new Error(`missing probe output for ${sector}`);
    const report = JSON.parse(fs.readFileSync(probeOut, 'utf8'));
    report.window = { ...report.window, sector };
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

    progress.sectors[sector] = {
      status: 'done',
      instrumentCount: report.instrumentCount,
      oosRaw: report.experiment?.oos?.overall?.raw?.hitRatePct,
      oosGated: report.experiment?.oos?.overall?.gated?.hitRatePct,
      completedAt: new Date().toISOString(),
    };
    saveProgress(progress);
    console.log(`done ${sector}:`, progress.sectors[sector]);
  }

  const sectorFiles = SECTORS.map((s) => path.join(SECTOR_DIR, `${s}.json`)).filter((f) => fs.existsSync(f));
  const merged = mergeSectorReports(sectorFiles);
  fs.writeFileSync(MERGED, JSON.stringify(merged, null, 2), 'utf8');
  fs.writeFileSync(MERGED_TXT, formatTxt(merged), 'utf8');

  progress.phaseC = { status: 'done', completedAt: new Date().toISOString(), mergedReport: MERGED };
  saveProgress(progress);
  console.log('\n' + formatTxt(merged));
  console.log('\nWrote', MERGED);
}

main();
