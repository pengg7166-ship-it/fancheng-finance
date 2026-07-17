/**
 * 全球流动性 · Cursor 每日专业研判
 * 覆盖：美国资本市场/银行业、日本汇率资产、亚欧主要经济体
 */
const fs = require('fs');
const path = require('path');
const { getExternalRoot } = require('./data-paths');
const { todaySessionDate } = require('./focus-read-state');
const {
  analyzeWithCursor,
  isCursorConfigured,
  LIQUIDITY_DAILY_PROMPT,
  parseLiquidityDailySections,
} = require('./cursor-llm-client');

const LIQUIDITY_DAILY_VERSION = 'v1.51.0-liquidity-daily';
const CACHE_TTL_MS = 20 * 60 * 60 * 1000;

function cachePath(sessionDate = todaySessionDate()) {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'focus-analysis', 'liquidity-daily');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionDate}.json`);
}

function loadCachedLiquidityDaily(sessionDate = todaySessionDate()) {
  const fp = cachePath(sessionDate);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const age = Date.now() - new Date(row.generatedAt || 0).getTime();
    if (age > CACHE_TTL_MS) return { ...row, stale: true };
    return row;
  } catch {
    return null;
  }
}

function buildLiquidityContext(outlookPayload = {}) {
  const gr = outlookPayload.globalLiquidityRisk || outlookPayload.globalRisk || {};
  const sources = outlookPayload.sources || {};
  const fed = sources.fed || sources.federalReserve || {};
  const forex = sources.forex || {};
  const indices = sources.indices || sources.usIndices || {};
  return {
    sessionDate: todaySessionDate(),
    globalLiquidityRisk: {
      tier: gr.tier || gr.liquidityShockTier || null,
      regime: gr.regime || gr.globalRiskRegime || null,
      summary: gr.summary || null,
      observables: (gr.observables || []).slice(0, 12),
      narrativeHeat: gr.narrativeHeat || null,
      components: gr.components || null,
    },
    marketSnapshots: {
      usIndices: indices.items?.slice?.(0, 8) || indices.slice?.(0, 8) || null,
      forex: forex.items?.slice?.(0, 10) || forex.rates?.slice?.(0, 10) || null,
      fedHeadlines: fed.items?.slice?.(0, 6) || fed.news?.slice?.(0, 6) || null,
    },
    instructions: [
      '必须分别评述：美国资本市场、美国银行业/信用、日本汇率与资产、亚洲主要经济体、欧洲主要经济体',
      '缺失数据写「暂无」，禁止编造点位或政策',
      '给出对大宗商品流动性的传导路径（可证伪）',
    ],
  };
}

async function generateLiquidityDailyBrief(outlookPayload = {}, options = {}) {
  const sessionDate = todaySessionDate();
  if (!options.force) {
    const cached = loadCachedLiquidityDaily(sessionDate);
    if (cached && !cached.stale && cached.text) return cached;
  }
  if (!isCursorConfigured()) {
    return {
      version: LIQUIDITY_DAILY_VERSION,
      sessionDate,
      text: null,
      error: '未配置 CURSOR_API_KEY',
      pending: true,
      dataSource: 'focus-liquidity-daily-cursor',
    };
  }
  const context = buildLiquidityContext(outlookPayload);
  const raw = await analyzeWithCursor(LIQUIDITY_DAILY_PROMPT, context);
  const sections = parseLiquidityDailySections(raw.text);
  const payload = {
    version: LIQUIDITY_DAILY_VERSION,
    sessionDate,
    text: raw.text,
    sections,
    model: raw.model,
    error: raw.error || null,
    generatedAt: new Date().toISOString(),
    dataSource: raw.dataSource || 'cursor',
  };
  const fp = cachePath(sessionDate);
  if (fp) fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

module.exports = {
  LIQUIDITY_DAILY_VERSION,
  loadCachedLiquidityDaily,
  generateLiquidityDailyBrief,
  buildLiquidityContext,
};
