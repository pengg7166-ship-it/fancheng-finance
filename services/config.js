const fs = require('fs');
const path = require('path');
const os = require('os');
const { getUserDataDir, listWritableRoots, APP_FOLDER } = require('./data-paths');

let configPath = null;

const DEFAULTS = {
  fredApiKey: '',
  stooqApiKey: '',
  llmApiUrl: '',
  llmApiKey: '',
  llmModel: 'deepseek-chat',
  llmTimeoutMs: 30000,
  cursorApiKey: '',
  cursorModel: 'composer-2.5',
  cursorApiUrl: '',
  cursorTimeoutMs: 120000,
  cursorConcurrency: 3,
  refreshIntervalMinutes: 5,
  quoteRefreshSeconds: 30,
  forexRefreshSeconds: 10,
  policyRefreshSeconds: 30,
  overseasProxyUrl: '',
  overseasProxyEnabled: true,
  dcePortalApi: {
    enabled: false,
    baseUrl: '',
    appId: '',
    appKey: '',
    appSecret: '',
    token: '',
    noticePath: '',
    pageSize: 25,
    rateLimitPerMin: 30,
    authHeader: 'Authorization',
    authScheme: 'Bearer',
  },
};

function init(userDataPath) {
  configPath = path.join(userDataPath, 'config.json');
  loadEnvFile();
  migrateLlmFromEnvToConfig();
  migrateLocalhostCursorProxy();
  applyLlmEnvFromConfig(readConfigRaw());
}

function migrateLocalhostCursorProxy() {
  if (!configPath || !fs.existsSync(configPath)) return;
  try {
    const raw = readConfigRaw();
    const url = String(raw.cursorApiUrl || '').trim();
    if (!url) return;
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return;
    }
    if (host !== '127.0.0.1' && host !== 'localhost') return;
    const next = { ...raw, cursorApiUrl: '' };
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // non-fatal
  }
}

function migrateLlmFromEnvToConfig() {
  const raw = readConfigRaw();
  const url = process.env.FANCHENG_LLM_API_URL?.trim();
  const key = process.env.FANCHENG_LLM_API_KEY?.trim();
  const cursorKey = process.env.CURSOR_API_KEY?.trim();
  const needsLlm = !(raw.llmApiKey?.trim() && raw.llmApiUrl?.trim());
  const needsCursor = !(raw.cursorApiKey?.trim()) && cursorKey;
  if (!needsLlm && !needsCursor) return;
  if (!configPath) return;
  try {
    const next = { ...raw };
    if (needsLlm && url && key) {
      next.llmApiUrl = url;
      next.llmApiKey = key;
      next.llmModel = process.env.FANCHENG_LLM_MODEL?.trim() || raw.llmModel || 'deepseek-chat';
      next.llmTimeoutMs = Number(process.env.FANCHENG_LLM_TIMEOUT_MS) || raw.llmTimeoutMs || 30000;
    }
    if (needsCursor) {
      next.cursorApiKey = cursorKey;
      next.cursorModel = process.env.FANCHENG_CURSOR_MODEL?.trim() || raw.cursorModel || 'composer-2.5';
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // non-fatal
  }
}

function isPackagedApp() {
  try {
    const { app } = require('electron');
    return Boolean(app?.isPackaged);
  } catch {
    return false;
  }
}

function getEnvSearchPaths() {
  const paths = [];
  const userData = getUserDataDir();
  if (userData) paths.push(path.join(userData, '.env'));
  if (isPackagedApp() && process.execPath) {
    paths.push(path.join(path.dirname(process.execPath), '.env'));
  }
  paths.push(path.join(__dirname, '..', '.env'));
  return paths;
}

function parseEnvFile(envPath) {
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

function loadEnvFile() {
  for (const envPath of getEnvSearchPaths()) {
    parseEnvFile(envPath);
  }
}

function getAllUserDataConfigPaths() {
  const paths = new Set();
  if (configPath) paths.add(configPath);
  const active = getUserDataDir();
  if (active) paths.add(path.join(active, 'config.json'));
  try {
    for (const { root } of listWritableRoots()) {
      paths.add(path.join(root, 'userData', 'config.json'));
    }
  } catch {
    // non-fatal
  }
  paths.add(path.join(os.homedir(), 'AppData', 'Roaming', 'fancheng-finance', 'config.json'));
  if (process.env.FANCHENG_APP_ROOT) {
    paths.add(path.join(process.env.FANCHENG_APP_ROOT, 'userData', 'config.json'));
  }
  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    paths.add(path.join(`${letter}:\\`, APP_FOLDER, 'userData', 'config.json'));
  }
  return [...paths];
}

function syncCursorEnvFile(cursorApiKey) {
  if (!cursorApiKey?.trim()) return;
  const line = `CURSOR_API_KEY=${cursorApiKey.trim()}`;
  for (const cfgPath of getAllUserDataConfigPaths()) {
    const envPath = path.join(path.dirname(cfgPath), '.env');
    try {
      let text = '';
      if (fs.existsSync(envPath)) text = fs.readFileSync(envPath, 'utf8');
      if (/^CURSOR_API_KEY=/m.test(text)) {
        text = text.replace(/^CURSOR_API_KEY=.*$/m, line);
      } else {
        text = `${text.trim()}\n${line}\n`.replace(/^\n+/, '');
      }
      fs.mkdirSync(path.dirname(envPath), { recursive: true });
      fs.writeFileSync(envPath, text, 'utf8');
    } catch {
      // non-fatal
    }
  }
}

function readConfigRaw() {
  if (!configPath) return { ...DEFAULTS };
  try {
    if (fs.existsSync(configPath)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch {
    // fall through
  }
  return { ...DEFAULTS };
}

function applyLlmEnvFromConfig(cfg = {}) {
  const url = (cfg.llmApiUrl || process.env.FANCHENG_LLM_API_URL || '').trim();
  const key = (cfg.llmApiKey || process.env.FANCHENG_LLM_API_KEY || '').trim();
  const model = (cfg.llmModel || process.env.FANCHENG_LLM_MODEL || 'gpt-4o-mini').trim();
  const timeoutMs = Number(cfg.llmTimeoutMs || process.env.FANCHENG_LLM_TIMEOUT_MS) || 30000;
  if (url) process.env.FANCHENG_LLM_API_URL = url;
  if (key) process.env.FANCHENG_LLM_API_KEY = key;
  if (model) process.env.FANCHENG_LLM_MODEL = model;
  process.env.FANCHENG_LLM_TIMEOUT_MS = String(timeoutMs);

  const cursorKey = (cfg.cursorApiKey || process.env.CURSOR_API_KEY || '').trim();
  const cursorModel = (cfg.cursorModel || process.env.FANCHENG_CURSOR_MODEL || 'composer-2.5').trim();
  const cursorUrl = (cfg.cursorApiUrl || process.env.FANCHENG_CURSOR_API_URL || '').trim();
  const cursorTimeout = Number(cfg.cursorTimeoutMs || process.env.FANCHENG_CURSOR_TIMEOUT_MS) || 120000;
  if (cursorKey) process.env.CURSOR_API_KEY = cursorKey;
  if (cursorModel) process.env.FANCHENG_CURSOR_MODEL = cursorModel;
  if (cursorUrl) process.env.FANCHENG_CURSOR_API_URL = cursorUrl;
  process.env.FANCHENG_CURSOR_TIMEOUT_MS = String(cursorTimeout);
}

function isLlmConfigured() {
  const url = process.env.FANCHENG_LLM_API_URL?.trim();
  const key = process.env.FANCHENG_LLM_API_KEY?.trim();
  return Boolean(url && key);
}

function getLlmConfig() {
  return {
    url: process.env.FANCHENG_LLM_API_URL?.trim() || '',
    model: process.env.FANCHENG_LLM_MODEL?.trim() || 'gpt-4o-mini',
    timeoutMs: Number(process.env.FANCHENG_LLM_TIMEOUT_MS) || 30000,
  };
}

function isCursorConfigured() {
  applyLlmEnvFromConfig(readConfigRaw());
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

function getCursorConfig() {
  applyLlmEnvFromConfig(readConfigRaw());
  return {
    configured: isCursorConfigured(),
    model: process.env.FANCHENG_CURSOR_MODEL?.trim() || 'composer-2.5',
    proxyUrl: process.env.FANCHENG_CURSOR_API_URL?.trim() || '',
    timeoutMs: Number(process.env.FANCHENG_CURSOR_TIMEOUT_MS) || 120000,
    concurrency: (() => {
      const raw = Number(readConfigRaw().cursorConcurrency ?? process.env.FANCHENG_CURSOR_CONCURRENCY);
      return Number.isFinite(raw) && raw >= 1 ? Math.min(6, Math.floor(raw)) : 3;
    })(),
    keyMasked: maskSecret(process.env.CURSOR_API_KEY || ''),
  };
}

function readConfig() {
  const next = readConfigRaw();
  applyLlmEnvFromConfig(next);
  return next;
}

function writeConfig(partial) {
  const next = { ...readConfigRaw(), ...partial };
  const json = JSON.stringify(next, null, 2);
  let wrote = false;
  for (const targetPath of getAllUserDataConfigPaths()) {
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, json, 'utf8');
      wrote = true;
    } catch {
      // try next path
    }
  }
  if (!wrote && configPath) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, json, 'utf8');
  }
  if (partial.cursorApiKey?.trim()) syncCursorEnvFile(partial.cursorApiKey);
  applyLlmEnvFromConfig(next);
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

function getEiaApiKey() {
  const cfg = readConfig();
  return (cfg.eiaApiKey && cfg.eiaApiKey.trim()) || process.env.EIA_API_KEY?.trim() || '';
}

function isEiaApiKeyConfigured() {
  return Boolean(getEiaApiKey());
}

function maskSecret(value) {
  if (!value || typeof value !== 'string') return '';
  const v = value.trim();
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function maskProxyUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const v = url.trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.username) u.username = '••••';
    if (u.password) u.password = '••••';
    return u.toString();
  } catch {
    return maskSecret(v);
  }
}

function getOverseasProxyConfig() {
  const cfg = readConfig();
  const url = (cfg.overseasProxyUrl || process.env.FANCHENG_OVERSEAS_PROXY || '').trim();
  return {
    enabled: cfg.overseasProxyEnabled !== false && Boolean(url),
    url,
  };
}

module.exports = {
  init,
  loadEnvFile,
  getEnvSearchPaths,
  readConfig,
  writeConfig,
  readConfigRaw,
  applyLlmEnvFromConfig,
  getFredApiKey,
  isFredApiKeyConfigured,
  getStooqApiKey,
  isStooqApiKeyConfigured,
  getEiaApiKey,
  isEiaApiKeyConfigured,
  isLlmConfigured,
  getLlmConfig,
  isCursorConfigured,
  getCursorConfig,
  maskSecret,
  maskProxyUrl,
  getOverseasProxyConfig,
};
