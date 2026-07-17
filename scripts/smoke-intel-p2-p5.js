#!/usr/bin/env node
/** Smoke: analyst reliability loop + term basis + surprise n */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();

const {
  recordAnnotation,
  applyReliabilityToEvidenceList,
  getReliabilityAdjustment,
  rebuildReliabilityFromAnnotations,
} = require('../services/intel-analyst-workbench');
const { attachTermBasisToInstrument } = require('../services/intel-term-basis');
const { computeSurpriseVector } = require('../services/intel-surprise');
const { evaluateAllGates } = require('../services/intel-publish-gates');
const { buildClaimsFromInstrument, pickPrimaryClaim } = require('../services/intel-claim-library');

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    fails += 1;
  } else console.log('OK', msg);
}

// 1) analyst annotation → reliability
const ann = recordAnnotation({
  instrumentId: 'cu',
  type: 'noise',
  target: 'news',
  reason: 'smoke',
});
assert(ann.ok, 'recordAnnotation ok');
rebuildReliabilityFromAnnotations();
const adj = getReliabilityAdjustment('cu', 'news');
assert(adj.available && adj.delta < 0, `reliability delta negative: ${adj.delta}`);

const ev = applyReliabilityToEvidenceList(
  [{ evidenceType: 'news', reliability: { score: 0.7 }, hardness: 0.7, summary: 'x' }],
  'cu'
);
assert(ev[0].reliability.analystAdjusted === true, 'evidence reliability adjusted');

// 2) term basis
const withBasis = attachTermBasisToInstrument({ id: 'cu', name: '沪铜', sector: 'metals' });
assert(withBasis.basis?.available === true, `basis available: ${withBasis.basis?.label}`);
assert(withBasis.basis?.sampleN > 100, `basis n=${withBasis.basis?.sampleN}`);

// 3) surprise n from klines
const { getCachedCommodityOutlookSource } = require('../services/commodity-outlook-engine');
const pack = getCachedCommodityOutlookSource();
const cu = (pack?.instruments || []).find((i) => i.id === 'cu') || withBasis;
const enriched = attachTermBasisToInstrument(cu);
const surprise = computeSurpriseVector(enriched, { state: 'partial' });
assert(surprise.version.includes('surprise-n'), `surprise version ${surprise.version}`);
const priceDim = surprise.dimensions?.find((d) => d.dimension === 'price');
assert(priceDim?.n == null || priceDim.n >= 20 || priceDim.dataSource === 'insufficient_n', `price dim n=${priceDim?.n}`);

// 4) claims with basis evidence + gates requireN
const claims = buildClaimsFromInstrument(enriched, new Date().toISOString().slice(0, 10));
const primary = pickPrimaryClaim(claims);
assert(primary?.claimId, 'primary claim');
const hasBasisEv = [...(primary.evidenceFor || []), ...(primary.evidenceAgainst || [])].some(
  (e) => e.evidenceType === 'basis' || e.evidenceType === 'term_structure'
);
assert(hasBasisEv || enriched.basis?.available, 'basis evidence path');

const gates = evaluateAllGates(enriched, primary, { nextCheckpoint: primary.validUntil }, { state: 'partial' });
assert(gates.interrupt.checks.some((c) => c.id === 'n'), 'interrupt gate has n check');
assert(Object.prototype.hasOwnProperty.call(gates.top5.checks.find((c) => c.id === 'n') || {}, 'pass'), 'top5 n check');

if (fails) {
  console.error(`FAILED ${fails}`);
  process.exit(1);
}
console.log('PASS: analyst+basis+surprise-n smoke');
process.exit(0);
