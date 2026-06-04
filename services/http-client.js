const https = require('https');
const http = require('http');
const { URL } = require('url');

let electronFetchCache;

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
};
