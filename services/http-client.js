const https = require('https');
const http = require('http');
const { URL } = require('url');

let electronFetchCache;
let proxyAgentCache = null;

const CN_HOST_RE = /\.(gov\.cn|com\.cn|cn)$/i;
const CN_BRAND_RE = /(eastmoney|sina|jin10|cls\.cn|wallstreetcn|100ppi|mofcom|ndrc|gov\.cn)/i;

function getOverseasProxyUrl() {
  const env = process.env.FANCHENG_OVERSEAS_PROXY || process.env.HTTPS_PROXY || '';
  if (env.trim()) return env.trim();
  try {
    const { readConfig } = require('./config');
    const cfg = readConfig();
    if (cfg.overseasProxyEnabled === false) return '';
    return String(cfg.overseasProxyUrl || '').trim();
  } catch {
    return '';
  }
}

function shouldUseOverseasProxy(url, options = {}) {
  if (options.useOverseasProxy === false) return false;
  const proxy = getOverseasProxyUrl();
  if (!proxy) return false;
  if (options.useOverseasProxy === true) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (CN_HOST_RE.test(host) || CN_BRAND_RE.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function getProxyDispatcher() {
  const proxy = getOverseasProxyUrl();
  if (!proxy) return null;
  if (!proxyAgentCache) {
    const { ProxyAgent } = require('undici');
    proxyAgentCache = new ProxyAgent(proxy);
  }
  return proxyAgentCache;
}

async function fetchViaProxy(url, options = {}) {
  const { fetch: undiciFetch } = require('undici');
  const timeout = options.timeout ?? 30000;
  const dispatcher = getProxyDispatcher();
  const res = await undiciFetch(url, {
    dispatcher,
    headers: options.headers,
    method: options.method || 'GET',
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function getElectronFetch() {
  if (electronFetchCache !== undefined) return electronFetchCache;
  try {
    const { app, net } = require('electron');
    if (app?.isReady?.() && typeof net.fetch === 'function') {
      electronFetchCache = net.fetch.bind(net);
      return electronFetchCache;
    }
  } catch {
    // 非 Electron 主进程
  }
  electronFetchCache = null;
  return null;
}

function requestIPv4(url, options = {}) {
  const timeout = options.timeout ?? 30000;
  const u = new URL(url);

  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: options.method || 'GET',
        headers: options.headers || {},
        family: 4,
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.end();
  });
}

async function fetchWithFallback(url, options = {}) {
  const timeout = options.timeout ?? 30000;

  if (shouldUseOverseasProxy(url, options)) {
    try {
      const res = await fetchViaProxy(url, options);
      if (res.ok) return res;
    } catch {
      // 代理失败则回退直连
    }
  }

  const electronFetch = getElectronFetch();

  if (electronFetch) {
    try {
      const res = await electronFetch(url, {
        headers: options.headers,
        method: options.method || 'GET',
      });
      if (res.ok) return res;
    } catch {
      // 继续尝试 Node fetch
    }
  }

  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeout),
    });
    if (res.ok) return res;
  } catch {
    // IPv6/undici 失败时改用 IPv4
  }

  return requestIPv4(url, options);
}

async function fetchJson(url, options = {}) {
  const retries = options.retries ?? 3;
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetchWithFallback(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

async function fetchText(url, options = {}) {
  const retries = options.retries ?? 1;
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetchWithFallback(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

module.exports = {
  fetchJson,
  fetchText,
  fetchWithFallback,
  requestIPv4,
  getOverseasProxyUrl,
  shouldUseOverseasProxy,
};
