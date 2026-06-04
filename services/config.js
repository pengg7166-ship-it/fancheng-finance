const fs = require('fs');
const path = require('path');

let configPath = null;

const DEFAULTS = {
  fredApiKey: '',
  stooqApiKey: '',
  refreshIntervalMinutes: 5,
  quoteRefreshSeconds: 30,
  forexRefreshSeconds: 10,
  policyRefreshSeconds: 30,
};

function init(userDataPath) {
  configPath = path.join(userDataPath, 'config.json');
  loadEnvFile();
}

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    // ignore invalid .env
  }
}

function readConfig() {
  if (!configPath) return { ...DEFAULTS };
  try {
    if (fs.existsSync(configPath)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULTS };
}

function writeConfig(partial) {
  const next = { ...readConfig(), ...partial };
  if (configPath) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
  }
  return next;
}

function getFredApiKey() {
  const cfg = readConfig();
  return (
    (cfg.fredApiKey && cfg.fredApiKey.trim()) ||
    process.env.FRED_API_KEY ||
    'demo'
  );
}

function isFredApiKeyConfigured() {
  const key = getFredApiKey();
  return key && key !== 'demo';
}

function getStooqApiKey() {
  const cfg = readConfig();
  return (
    (cfg.stooqApiKey && cfg.stooqApiKey.trim()) ||
    process.env.STOOQ_API_KEY ||
    ''
  );
}

function isStooqApiKeyConfigured() {
  return Boolean(getStooqApiKey());
}

module.exports = {
  init,
  readConfig,
  writeConfig,
  getFredApiKey,
  isFredApiKeyConfigured,
  getStooqApiKey,
  isStooqApiKeyConfigured,
};
