const { isFredApiKeyConfigured } = require('./config');
const { fetchJson, fetchText } = require('./http-client');

const HTTP_TIMEOUT_MS = 12000;
const FRED_CSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://fred.stlouisfed.org/',
  Accept: 'text/csv,*/*',
};

let fredApiCooldownUntil = 0;

function isFredApiInCooldown() {
  return Date.now() < fredApiCooldownUntil;
}

function markFredApiCooldown(err) {
  const message = String(err?.message || '');
  if (/HTTP 429|HTTP 403|HTTP 400/.test(message)) {
    fredApiCooldownUntil = Date.now() + 15 * 60 * 1000;
  }
}

function parseFredCsvObservations(text, { limit = 5 } = {}) {
  const lines = text.trim().split(/\r?\n/).slice(1);
  const observations = [];
  for (let i = lines.length - 1; i >= 0 && observations.length < limit; i -= 1) {
    const comma = lines[i].indexOf(',');
    if (comma === -1) continue;
    const date = lines[i].slice(0, comma).trim();
    const value = lines[i].slice(comma + 1).trim();
    if (!date || !value || value === '.') continue;
    observations.push({ date, value });
  }
  return observations;
}

function observationsToSeries(observations, source) {
  if (!observations.length) return null;
  const latest = observations[0];
  const previous = observations[1];
  const change =
    previous && previous.value !== '.'
      ? (parseFloat(latest.value) - parseFloat(previous.value)).toFixed(4)
      : null;
  return {
    value: latest.value,
    date: latest.date,
    change,
    source,
  };
}

async function fetchFredSeriesCsv(seriesId, { limit = 5 } = {}) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const text = await fetchText(url, {
    timeout: HTTP_TIMEOUT_MS,
    retries: 2,
    headers: FRED_CSV_HEADERS,
  });
  const observations = parseFredCsvObservations(text, { limit });
  return observationsToSeries(observations, 'fred-csv');
}

async function fetchFredSeriesApi(seriesId, { limit = 5 } = {}) {
  const { getFredApiKey } = require('./config');
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', getFredApiKey());
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', String(limit));

  const json = await fetchJson(url.toString(), { timeout: HTTP_TIMEOUT_MS, retries: 1 });
  const observations = (json.observations || []).filter((o) => o.value !== '.');
  return observationsToSeries(observations, 'fred-api');
}

async function fetchFredSeries(seriesId, { limit = 5 } = {}) {
  if (isFredApiKeyConfigured() && !isFredApiInCooldown()) {
    try {
      const data = await fetchFredSeriesApi(seriesId, { limit });
      if (data?.value != null) return data;
    } catch (err) {
      markFredApiCooldown(err);
    }
  }

  try {
    const data = await fetchFredSeriesCsv(seriesId, { limit });
    if (data?.value != null) return data;
  } catch {
    // CSV 不可用时返回 null，由上层备用数据源处理
  }

  return null;
}

async function fetchFredBatch(seriesList) {
  const out = [];
  for (const s of seriesList) {
    try {
      const data = await fetchFredSeries(s.id);
      if (data?.value != null) out.push({ ...s, ...data });
    } catch {
      // 单条失败跳过
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return out;
}

module.exports = {
  fetchFredSeries,
  fetchFredBatch,
};
