/**
 * Pre-flight health check for deployed app.asar before user launches.
 * Usage: node scripts/verify-asar-health.js [path-to-app.asar]
 */
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const { getAppDir } = require('../services/data-paths');
const appDir = process.env.FANCHENG_APP_ROOT
  ? path.join(process.env.FANCHENG_APP_ROOT, 'app', 'win-unpacked', 'resources', 'app.asar')
  : null;
const DEFAULT_ASAR = appDir && fs.existsSync(appDir)
  ? appDir
  : path.join(getAppDir() || 'F:/FanchengFinance/app/win-unpacked', 'resources', 'app.asar');

const REQUIRED_NM = [
  'node_modules/xml2js/lib/xml2js.js',
  'node_modules/rss-parser/index.js',
];

const REQUIRED_UI = [
  'src/app.js',
  'src/index.html',
  'src/commodities.js',
  'electron/preload.js',
];

const REQUIRED_SERVICES = [
  'services/data-fetcher.js',
  'services/commodity-outlook-engine.js',
  'services/market-regime-classifier.js',
  'services/next-day-range-predictor.js',
  'services/cross-vol-magnitude.js',
  'electron/main.js',
  'package.json',
];

function norm(p) {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function asarHas(asarPath, rel) {
  const want = norm(rel);
  return asar.listPackage(asarPath).some((e) => norm(e) === want);
}

function loadPatchClosure() {
  try {
    const patch = require(path.join(ROOT, '_patch-cross-vol-asar.js'));
    return patch.resolvePatchFileList().files;
  } catch {
    return REQUIRED_SERVICES.filter((f) => f.startsWith('services/'));
  }
}

function checkBackups(asarPath) {
  const dir = path.dirname(asarPath);
  if (!fs.existsSync(dir)) return { count: 0, totalMb: 0 };
  const baks = fs.readdirSync(dir).filter((f) => /^app\.bak-.*\.asar$/i.test(f));
  let total = 0;
  for (const f of baks) {
    try {
      total += fs.statSync(path.join(dir, f)).size;
    } catch {
      // ignore
    }
  }
  return { count: baks.length, totalMb: +(total / 1024 / 1024).toFixed(1) };
}

function main() {
  const asarPath = process.argv[2] || process.env.FANCHENG_ASAR || DEFAULT_ASAR;
  const issues = [];
  const ok = [];

  console.log('=== Fancheng Finance asar health check ===');
  console.log('target:', asarPath);

  if (!fs.existsSync(asarPath)) {
    console.error('FAIL: app.asar not found');
    process.exit(1);
  }

  const stat = fs.statSync(asarPath);
  const sizeMb = +(stat.size / 1024 / 1024).toFixed(2);
  console.log(`size: ${sizeMb} MB · mtime: ${stat.mtime.toISOString()}`);
  if (sizeMb < 2) {
    issues.push(`asar 仅 ${sizeMb} MB，可能打包不完整`);
  } else {
    ok.push(`asar 体积 ${sizeMb} MB`);
  }

  let version = '?';
  try {
    const pkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString());
    version = pkg.version || '?';
    ok.push(`package.json version ${version}`);
  } catch (e) {
    issues.push(`无法读取 package.json: ${e.message}`);
  }

  for (const rel of REQUIRED_NM) {
    if (asarHas(asarPath, rel)) ok.push(rel);
    else issues.push(`缺少依赖: ${rel}`);
  }

  for (const rel of REQUIRED_UI) {
    if (asarHas(asarPath, rel)) ok.push(rel);
    else issues.push(`缺少 UI 文件: ${rel}`);
  }

  for (const rel of REQUIRED_SERVICES) {
    if (asarHas(asarPath, rel)) ok.push(rel);
    else issues.push(`缺少核心文件: ${rel}`);
  }

  const closure = loadPatchClosure();
  const missingChain = closure.filter((rel) => !asarHas(asarPath, rel));
  if (missingChain.length) {
    issues.push(`precious/range 依赖链缺失 ${missingChain.length} 个文件`);
    for (const m of missingChain.slice(0, 12)) issues.push(`  - ${m}`);
    if (missingChain.length > 12) issues.push(`  ... 另有 ${missingChain.length - 12} 个`);
  } else {
    ok.push(`precious/range 依赖链 ${closure.length} 个文件齐全`);
  }

  const backups = checkBackups(asarPath);
  if (backups.count > 5) {
    issues.push(`备份 asar 过多 (${backups.count} 个, ~${backups.totalMb} MB)，建议清理旧 app.bak-*.asar`);
  } else if (backups.count > 0) {
    ok.push(`备份 ${backups.count} 个 (~${backups.totalMb} MB)`);
  }

  try {
    const mainJs = asar.extractFile(asarPath, 'electron/main.js').toString();
    const climateRequire =
      /const \{ fetchClimateLive, refreshClimateInBackground \} = require\('\.\.\/services\/climate-fetcher'\);/g;
    const climateRequireCount = (mainJs.match(climateRequire) || []).length;
    if (climateRequireCount > 1) {
      issues.push(`electron/main.js 重复 require climate-fetcher (${climateRequireCount} 次)`);
    } else if (!/uncaughtException/.test(mainJs)) {
      issues.push('electron/main.js 缺少 uncaughtException 崩溃日志 handler');
    } else {
      ok.push('electron/main.js 结构正常（单条 climate require + crash handler）');
    }
    if (!/TAB_PUSH_STEPS/.test(mainJs)) {
      issues.push('main 未包含 tab-aware push 过滤（可能为旧版 asar）');
    }

    const engine = asar.extractFile(asarPath, 'services/commodity-outlook-engine.js').toString();
    if (!/getCrossVolMagnitude|crossVolMagnitude/.test(engine)) {
      issues.push('engine 未包含 cross-vol 集成（可能为旧版 asar）');
    }
    if (!/highLowPrediction|predictNextDayRange/.test(engine)) {
      issues.push('engine 未包含次日高低点预测（可能为旧版 asar）');
    }
    const appJs = asar.extractFile(asarPath, 'src/app.js').toString();
    if (!/outlook-next-day-range-compact|getOutlookHighLow/.test(appJs)) {
      issues.push('UI 未包含次日高低点展示（需要热补丁或重新部署）');
    }
    if (!/outlook-range-compare|renderOutlookRangeCompareCompact|resolveOutlookRangeCompare/.test(appJs)) {
      issues.push('UI 未包含次日预测 vs 实际对比块（需要 v1.35.1 热补丁）');
    }
    if (!/OUTLOOK_UI_VERSION = '1\.35\.(1|2)'|enrichOutlookInstrumentClientSide|renderOutlookGateBadges/.test(appJs)) {
      issues.push('UI 未包含 v1.35.x 研判 enrich/gate 展示（可能为旧版 asar）');
    }
    if (!/slimOutlookPayloadForDisk|OUTLOOK_DISK_AUDIT_RECORD_LIMIT/.test(engine)) {
      issues.push('engine 未包含 outlook 磁盘缓存瘦身（需要 v1.35.2）');
    }
    if (!/setRendererState|notifyRendererState/.test(appJs)) {
      issues.push('UI 缺少 tab-aware 推送状态同步（可能为旧版 asar）');
    }
  } catch (e) {
    issues.push(`内容特征检查失败: ${e.message}`);
  }

  console.log('\n--- OK ---');
  for (const line of ok) console.log('✓', line);

  const critical = issues.filter((line) => /缺少/.test(line));
  const warnings = issues.filter((line) => !/缺少/.test(line));

  if (warnings.length) {
    console.log('\n--- WARNINGS ---');
    for (const line of warnings) console.log('!', line);
  }

  if (critical.length) {
    console.log('\n--- CRITICAL ---');
    for (const line of critical) console.log('✗', line);
    console.log('\n建议: 关闭 FanchengFinance.exe 后重新 npm run build 并 sync');
    process.exit(2);
  }

  console.log('\nPASS — 可以安全启动');
  process.exit(0);
}

main();
