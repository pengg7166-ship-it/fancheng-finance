#!/usr/bin/env node
/** Smoke: debt mustPay → sync/verify ops loop (vision §61 / v2.89.3) */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();
const disk = require('../services/disk-cache');
if (!disk.getRoot()) disk.init('F:/FanchengFinance/data');

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    fails += 1;
  } else console.log('OK', msg);
}

async function main() {
  const {
    DEBT_OPS_VERSION,
    OPS_BY_TYPE,
    planForDebt,
    buildDebtOpsPreview,
    attachDebtOpsPlan,
    verifyAfterOp,
    runDebtOpsLoop,
    enrichMustPayItem,
  } = require('../services/intel-debt-ops');
  const { buildDebtBoard } = require('../services/intel-debt-board');
  const { ORCHESTRATOR_VERSION, buildIntelCenterPack } = require('../services/intel-orchestrator');
  const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

  assert(DEBT_OPS_VERSION.includes('debt-ops'), DEBT_OPS_VERSION);
  assert(ORCHESTRATOR_VERSION.includes('2.89.3') || ORCHESTRATOR_VERSION.includes('debt-ops'), ORCHESTRATOR_VERSION);
  assert(TEACH_VERSION.includes('2.89.3'), TEACH_VERSION);
  assert(LESSONS.some((l) => l.id === 'debt_ops'), 'lesson debt_ops');
  assert(OPS_BY_TYPE.stale_data.runnable === true, 'stale runnable');
  assert(OPS_BY_TYPE.basis_gap.runnable === false, 'basis manual');
  assert(OPS_BY_TYPE.gate_blocked.runnable === false, 'gate manual');

  const stalePlan = planForDebt({ type: 'stale_data', instrumentId: 'rb', instrumentName: '螺纹' });
  assert(stalePlan.action === 'sync_instrument_close', stalePlan.action);
  assert(stalePlan.runnable === true, 'stale plan runnable');

  const boardStub = {
    weeklyMustPay: [
      { type: 'stale_data', instrumentId: 'rb', instrumentName: '螺纹', impact: 'high', label: '数据滞后' },
      { type: 'basis_gap', instrumentId: 'cu', instrumentName: '铜', impact: 'high', label: '基差缺口' },
      { type: 'joint_gap', instrumentId: 'i', instrumentName: '铁矿', impact: 'high', label: '合证缺口' },
    ],
    weeklyPlan: { mustPay: [], note: '测' },
    display: '问题债务·测',
    version: 'debt-test',
    method: 'debt',
  };

  const preview = buildDebtOpsPreview(boardStub, { asOf: '2026-07-17', maxItems: 3 });
  assert(preview.pendingRunnable === 2, `runnable=${preview.pendingRunnable}`);
  assert(preview.pendingManual === 1, `manual=${preview.pendingManual}`);
  assert(preview.mustPay.every((d) => d.owner && d.dueBy && d.opsLabel), 'owner/due/opsLabel');

  const attached = attachDebtOpsPlan(boardStub, { asOf: '2026-07-17' });
  assert(attached.opsPlan?.pendingRunnable === 2, 'attached opsPlan');
  assert(String(attached.version).includes('ops'), attached.version);
  assert(attached.weeklyPlan?.dueBy, 'weekly dueBy');
  assert(attached.weeklyPlan?.owner, 'weekly owner');

  const jointVerify = verifyAfterOp(
    { type: 'joint_gap', instrumentId: 'i' },
    { ok: true, sync: { status: 'ok', endDate: '2026-07-16' } }
  );
  assert(jointVerify.cleared === false, 'joint never fake-cleared');
  assert(jointVerify.status === 'partial', jointVerify.status);

  const manualVerify = verifyAfterOp({ type: 'basis_gap', instrumentId: 'cu' }, { ok: false });
  assert(manualVerify.status === 'manual', manualVerify.status);
  assert(manualVerify.cleared === false, 'manual not cleared');

  const dry = await runDebtOpsLoop({
    debtBoard: attached,
    maxItems: 2,
    dryRun: true,
    asOf: '2026-07-17',
    persist: false,
  });
  assert(dry.dryRun === true, 'dryRun');
  assert(dry.attempted === 2, `attempted=${dry.attempted}`);
  assert(dry.results.every((r) => r.verify?.status === 'dryRun'), 'dry verify');
  assert(dry.cleared === 0, 'dry cleared=0');

  const enriched = enrichMustPayItem(
    { type: 'n_missing', instrumentId: 'au', label: 'n不足' },
    '2026-07-17'
  );
  assert(enriched.opsRunnable === false, 'n_missing manual');
  assert(enriched.owner === 'analyst', enriched.owner);

  const pack = buildIntelCenterPack(
    [
      {
        id: 'rb',
        name: '螺纹',
        calendarStaleness: { lagDays: 5 },
      },
    ],
    { asOf: '2026-07-17', persist: false }
  );
  assert(pack.debtBoard?.opsPlan, 'pack has opsPlan');
  assert(pack.debtBoard?.weeklyPlan?.owner, 'pack weekly owner');
  assert(!pack.debtBoard?.opsLoop || pack.debtBoard.opsLoop.deferred, 'pack does not auto-sync');

  const emptyBoard = buildDebtBoard([]);
  const emptyAttached = attachDebtOpsPlan(emptyBoard, { asOf: '2026-07-17' });
  assert(emptyAttached.opsPlan?.display, emptyAttached.opsPlan?.display);

  if (fails) {
    console.error(`\n${fails} FAIL(s)`);
    process.exit(1);
  }
  console.log('\nPASS smoke-intel-debt-ops');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
