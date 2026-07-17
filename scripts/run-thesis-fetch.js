#!/usr/bin/env node
/**
 * Manual thesis registry fetch
 * Usage: node scripts/run-thesis-fetch.js [--force] [--theme us_equity_bubble]
 */
const args = process.argv.slice(2);
const force = args.includes('--force');
const themeIdx = args.indexOf('--theme');
const themes = themeIdx >= 0 && args[themeIdx + 1] ? [args[themeIdx + 1]] : undefined;

async function main() {
  const scheduler = require('../services/thesis-fetch-scheduler');
  const registry = require('../services/thesis-registry');
  registry.ensureSeedData();
  const result = await scheduler.runThesisFetch({ force, themes });
  console.log(JSON.stringify(result, null, 2));
  const status = scheduler.getThesisFetchStatus();
  console.log('\nStatus:', JSON.stringify(status, null, 2));
  console.log('\nRegistry path:', registry.getRegistryPath());
  console.log('Active theses:', registry.queryActiveTheses({ limit: 20 }).length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
