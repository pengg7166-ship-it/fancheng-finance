#!/usr/bin/env node
/** Smoke require for thesis/risk modules */
const modules = [
  '../services/global-risk-regime',
  '../services/thesis-registry',
  '../services/thesis-fetch-scheduler',
  '../services/thesis-synthesis',
  '../services/outlook-trading-guidance',
  '../services/long-term-trading-guidance',
];

let failed = 0;
for (const mod of modules) {
  try {
    const m = require(mod);
    console.log('OK', mod, Object.keys(m).slice(0, 6).join(', '));
  } catch (err) {
    failed += 1;
    console.error('FAIL', mod, err.message);
  }
}

const { computeGlobalRiskRegime } = require('../services/global-risk-regime');
const gr = computeGlobalRiskRegime({}, {});
console.log('\nGlobal risk (empty sources):', gr.globalRiskRegime, gr.okCount + '/' + gr.observableTotal);

const registry = require('../services/thesis-registry');
registry.ensureSeedData();
console.log('Seed theses:', registry.queryActiveTheses().length);

const { buildMacroSynthesis } = require('../services/thesis-synthesis');
const synth = buildMacroSynthesis({ globalRisk: gr, instruments: [] });
console.log('Macro synthesis active:', synth.macroSynthesis?.activeThesisCount);

const { resolvePostureCap } = require('../services/outlook-trading-guidance');
console.log('AG cap L3:', resolvePostureCap('ag', { globalRiskRegime: 'shock', liquidityShockTier: 'L3' }));

process.exit(failed ? 1 : 0);
