/**
 * Cursor 模型客户端 — 大宗走势研判 AI 分析唯一入口
 * 优先 @cursor/sdk 本地 Agent；其次 Cursor Cloud Agents API；最后可选 OpenAI 兼容代理
 * 须配置 CURSOR_API_KEY；禁止无模型时编造分析文本
 */
const path = require('path');
const { readConfig, maskSecret } = require('./config');

const CURSOR_CLIENT_VERSION = 'v1.56.26-intel-kernel';
const DEFAULT_CURSOR_MODEL = 'composer-2.5';
const DEFAULT_PROXY_URL = 'http://127.0.0.1:8765/v1';
const CLOUD_API_BASE = 'https://api.cursor.com/v1';
const TERMINAL_RUN_STATUSES = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);
const AGENT_SESSION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CLOUD_CONCURRENCY = 3;

const ANALYSIS_SYSTEM_PROMPT = `你是梵澄金融大宗走势研判分析师。分析须接近专业研报：论据可溯、多周期对照、逻辑链闭合。
用户 JSON 含 instrument、intelligenceKernel（主矛盾/反对意见/改口条件/置信）、capitalAttention（资金关注/态度/持仓1w·1m·3m）、stockFlow/仓单合证、expectationFactors 等。
情报逻辑：政策/资讯 → 供需预期 → 库存/产量/消费 → 资金态度合证 → 价格；价格可能滞后，资金是品种终极态度。
你必须：
1. 仅根据 JSON 结构化数据分析，禁止编造价格、仓位、产量、事件或宏观数据；缺失写「暂无」或「待校验」
2. 【基本面】须写清对比窗口（相对上周/上月/三月/同比，有数字才写），禁止只有口号无对照
3. 【资金态度】优先引用 capitalAttention.attitudeLabel、horizons（持仓增减）、jointWithInventory；资讯与短线 K 线不足时，以资金与合证为准；无持仓数据则明确「资金态度暂无」
4. 【主矛盾与反对意见】若有 intelligenceKernel：必须点明 mainContradiction.label/side；必须写出至少一条 opposingEvidence（没有则写「对侧证据暂无·结论脆弱」）；若有 flipConditions 须写入可证伪/改口条件；conviction.scale<0.7 时结论须降档、不得写成高确信
5. 仓位建议与 posture/position/bias 一致
6. 中文三段：【基本面】【资金与走势】【操作建议】（操作建议中须含主矛盾一句 + 反对意见一句）`;

const TOP5_DEEP_BRIEF_PROMPT = `你是梵澄金融「大宗走势研判」Top5 战场深度解读官。写作标准对齐专业品种研报：核心观点 → 基本面（库存/供应/需求多窗口对照）→ 宏观 → 资金态度合证 → 策略与证伪。
用户 JSON 已聚合：battleIntel（含 dimensions.intelligence 主矛盾/反对意见）、intelligenceKernel、capitalAttention、矛盾矩阵合证、全网新闻、交易指导、哲学 Gate、RegimeGate、波动预测等。
你必须：
1. 仅根据 JSON 字段解读，禁止编造政策、产能、价格、库存、新闻标题
2. 缺失必须写「暂无」或「待校验」，不得猜测填充
3. 库存/仓单禁止单独定调，须与资金（持仓多周期/会员/资金关注）合证；点明「资金是终极态度」
4. 作战建议须与 tradingGuidance.posture/position/bias 一致
5. 引用事实时保持克制，对照 1周/1月/3月（及 JSON 中同比）若有则写出
6. 【矛盾风险】段必须：写出主矛盾（intelligenceKernel.mainContradiction 或 battleIntel.dimensions.intelligence）；必须列出反对意见（opposingEvidence，至少一条）；必须写出改口/证伪条件（flipConditions）；不得只写「有风险」空话
7. 中文，严格分六段（段首标记不可省略）：
【政策产能】政策出台、大厂检修/复产/产能调控、市场情绪催化
【技术面】MA/BOLL/RSI/量比；注明若与资金背离则以后者为优先参考
【资金持仓】资金关注分、态度（涌入/撤退/观望）、持仓1周/1月/3月、会员净增减、是否与仓单合证
【库存现货成本】库存/仓单多窗口 + 现货/成本；须写「与资金是否同向」
【矛盾风险】主矛盾 · 反对意见 · 改口条件 · RegimeGate/Phil/Q Gate
【作战建议】做多/做空/观望、仓位节奏、触发条件与止损（1段内说完；置信低须观望优先）`;

const IMPACT_BRIEF_PROMPT = `你是梵澄金融「重大政策/资讯」研判官。用户 JSON 含：impactTier、impactDimensions（宽/广/时三维）、expectationReview（预期传导审查/质量分）、govPolicy、expectationFactors（surprise预期差雷达/pricedIn/pricedInEngine命题定价/仓单库存/productionConsumption.fundamentals产量消费/政策池/命题）、headline、professionalViews、globalRisk。

情报网逻辑（必须遵循）：
政策/资讯 → 市场形成什么新预期 → 预期变化幅度=质量 → 供需预期（长短期）→ 库存/产量/消费 → 价格。
不要求正文出现「大宗商品」字样；须识别二阶传导（例：美联储降息→流动性释放→风险资产上涨；贸易战→衰退/避险预期→抛售风险资产）。

你必须：
1. 先读 expectationReview：quality/expectationMagnitude 与 narrative.primary，说明「市场会形成什么预期」，禁止只复述标题
2. 在【价格传导】写清二阶传导链，并对 headline.symbols 各品种差异化影响（例：厄尔尼诺→东南亚干旱→棕榈/橡胶/白糖减产预期；巴西洪涝若不在大豆主产区→豆粕可能冲高回落）
3. 优先对照 expectationFactors.surprise：若 level=surprise_high 强调预期差交易窗口；若 priced_in 警惕利好出尽
4. 对照 pricedIn 与 pricedInEngine（命题/资金定价）是否一致，不一致须点明
5. 若 headline.watchPriority=high：反内卷/深跌品种强调筑底博弈；若为 strategic-cu（沪铜）则强调供需/库存/矿山/AI需求链，**勿按反内卷框架解读铜**
6. 若有 govPolicy，说明中国政府干预对国内定价/供需的传导
6. 若有 fundamentals 指标（EIA库存/黑色投资代理），说明与资讯方向是否共振或背离
7. 若有 inventorySnapshots/仓单，须与资金（持仓增减/资金态度）合证后再判断方向；禁止仓单单独定罪
8. 仅根据 JSON 事实研判，禁止编造价格、政策细则、仓位
9. 中文五段：【事件要点】【价格传导】【机构观点】【矛盾风险】【研判摘要】`;

const LIQUIDITY_DAILY_PROMPT = `你是梵澄金融全球流动性日度研判官。用户 JSON 含 globalLiquidityRisk、marketSnapshots（美股/外汇/联储新闻等）。
你必须：
1. 仅根据 JSON 数据，禁止编造指数点位、利率、汇率
2. 缺失写「暂无」或「待校验」
3. 中文，严格六段（每段必须出现，无数据也要写暂无）：
【美国资本市场】美股/信用/波动率/VIX 等对风险偏好的含义
【美国银行业】银行板块、信用利差、融资条件（数据缺失则说明）
【日本】日元汇率、日股/日债对套息与亚洲风险偏好的影响
【亚洲经济体】中国/韩国/印度等汇率与资产反应（仅基于所给数据）
【欧洲经济体】欧央行/欧元区资产/英镑等（仅基于所给数据）
【大宗流动性结论】以上如何传导至大宗商品流动性与波动，给出可证伪判断`;

const NEWS_ARTICLE_BRIEF_PROMPT = `你是梵澄金融新闻解读员。用户 JSON 含 headline（title/titleEn/url/source/symbols/impactScore）。
你必须：
1. 仅根据 JSON 已有字段解读，禁止编造价格、利率、政策细则
2. 用中文写 4 段，每段 1-3 句：
【事件】说明发生了什么（可翻译 titleEn 含义）
【大宗关联】symbols 标注品种可能受什么传导；无品种则写「暂无直接品种标签」
【客观边界】数据缺失或仅为执法/个案公告时，写明与宏观定价关联有限
【阅读提示】建议用户如何交叉验证，禁止「必然涨跌」`;

let sdkModule = null;
let sdkLoadAttempted = false;

/** @type {Array<{ id: string, busy: boolean, lastUsedAt: number }>} */
const warmCloudAgents = [];
let cloudInflight = 0;
/** @type {Array<() => void>} */
const cloudWaitQueue = [];

function getCloudConcurrencyLimit() {
  const cfg = readConfig();
  const raw = Number(cfg.cursorConcurrency ?? process.env.FANCHENG_CURSOR_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(6, Math.floor(raw));
  return DEFAULT_CLOUD_CONCURRENCY;
}

function pruneWarmAgents() {
  const now = Date.now();
  for (let i = warmCloudAgents.length - 1; i >= 0; i -= 1) {
    const entry = warmCloudAgents[i];
    if (entry.busy) continue;
    if (now - entry.lastUsedAt > AGENT_SESSION_TTL_MS) warmCloudAgents.splice(i, 1);
  }
}

async function acquireCloudSlot() {
  const limit = getCloudConcurrencyLimit();
  if (cloudInflight < limit) {
    cloudInflight += 1;
    return;
  }
  await new Promise((resolve) => cloudWaitQueue.push(resolve));
  cloudInflight += 1;
}

function releaseCloudSlot() {
  cloudInflight = Math.max(0, cloudInflight - 1);
  const next = cloudWaitQueue.shift();
  if (next) next();
}

function applyCursorEnvFromConfig(cfg = {}) {
  const key = (cfg.cursorApiKey || process.env.CURSOR_API_KEY || '').trim();
  const model = (cfg.cursorModel || process.env.FANCHENG_CURSOR_MODEL || DEFAULT_CURSOR_MODEL).trim();
  const proxyUrl = (cfg.cursorApiUrl || process.env.FANCHENG_CURSOR_API_URL || '').trim();
  const timeoutMs = Number(cfg.cursorTimeoutMs || process.env.FANCHENG_CURSOR_TIMEOUT_MS) || 120000;
  if (key) process.env.CURSOR_API_KEY = key;
  if (model) process.env.FANCHENG_CURSOR_MODEL = model;
  if (proxyUrl) process.env.FANCHENG_CURSOR_API_URL = proxyUrl;
  process.env.FANCHENG_CURSOR_TIMEOUT_MS = String(timeoutMs);
}

function isCursorConfigured() {
  applyCursorEnvFromConfig(readConfig());
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

function getCursorConfig() {
  applyCursorEnvFromConfig(readConfig());
  return {
    configured: isCursorConfigured(),
    model: process.env.FANCHENG_CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL,
    proxyUrl: process.env.FANCHENG_CURSOR_API_URL?.trim() || '',
    timeoutMs: Number(process.env.FANCHENG_CURSOR_TIMEOUT_MS) || 120000,
    concurrency: getCloudConcurrencyLimit(),
    keyMasked: maskSecret(process.env.CURSOR_API_KEY || ''),
    provider: 'cursor',
    version: CURSOR_CLIENT_VERSION,
  };
}

function tryLoadCursorSdk() {
  if (sdkLoadAttempted) return sdkModule;
  sdkLoadAttempted = true;
  try {
    sdkModule = require('@cursor/sdk');
  } catch {
    sdkModule = null;
  }
  return sdkModule;
}

function getCursorAuthHeader() {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) return null;
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

function shouldUseCursorProxy() {
  const raw = (process.env.FANCHENG_CURSOR_API_URL || '').trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost') return false;
  } catch {
    return false;
  }
  return true;
}

async function analyzeWithCursorSdk(systemPrompt, userPayload) {
  const sdk = tryLoadCursorSdk();
  if (!sdk?.Agent?.prompt) return null;
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) return null;
  const modelId = process.env.FANCHENG_CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
  const prompt = `${systemPrompt}\n\n---\n结构化数据（JSON）：\n${JSON.stringify(userPayload, null, 2)}`;
  const timeoutMs = Number(process.env.FANCHENG_CURSOR_TIMEOUT_MS) || 120000;
  const result = await Promise.race([
    sdk.Agent.prompt(prompt, {
      apiKey,
      model: { id: modelId },
      local: { cwd: path.join(__dirname, '..') },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Cursor SDK timeout')), timeoutMs)),
  ]);
  const text = result?.result || result?.text || null;
  return text ? String(text).trim() : null;
}

async function pollCloudRunResult(agentId, runId, auth, timeoutMs) {
  const started = Date.now();
  let intervalMs = 800;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${CLOUD_API_BASE}/agents/${agentId}/runs/${runId}`, {
      method: 'GET',
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(Math.min(15000, timeoutMs)),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Cursor Cloud run HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`);
    }
    const data = await res.json();
    if (TERMINAL_RUN_STATUSES.has(data.status)) {
      if (data.status === 'FINISHED' && data.result) return String(data.result).trim();
      throw new Error(data.result || `Cursor Cloud run ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    intervalMs = Math.min(2500, Math.floor(intervalMs * 1.35));
  }
  throw new Error('Cursor Cloud 分析超时');
}

async function createCloudAgentRun(auth, model, prompt, timeoutMs) {
  const createRes = await fetch(`${CLOUD_API_BASE}/agents`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: { text: prompt },
      model: { id: model },
    }),
    signal: AbortSignal.timeout(Math.min(60000, timeoutMs)),
  });
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Cursor Cloud HTTP ${createRes.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`);
  }
  const created = await createRes.json();
  const agentId = created?.agent?.id;
  const runId = created?.run?.id;
  if (!agentId || !runId) throw new Error('Cursor Cloud 未返回 agent/run');
  return { agentId, runId };
}

async function createCloudFollowUpRun(agentId, auth, prompt, timeoutMs) {
  const res = await fetch(`${CLOUD_API_BASE}/agents/${agentId}/runs`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: { text: prompt } }),
    signal: AbortSignal.timeout(Math.min(60000, timeoutMs)),
  });
  if (res.status === 409) return { busy: true, runId: null };
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Cursor Cloud follow-up HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`);
  }
  const data = await res.json();
  const runId = data?.run?.id || data?.id;
  if (!runId) throw new Error('Cursor Cloud follow-up 未返回 run');
  return { busy: false, runId };
}

async function waitForAgentIdle(agentId, auth, timeoutMs) {
  const started = Date.now();
  let intervalMs = 800;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${CLOUD_API_BASE}/agents/${agentId}/runs`, {
      method: 'GET',
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(Math.min(15000, timeoutMs)),
    });
    if (!res.ok) return;
    const data = await res.json();
    const runs = Array.isArray(data?.runs) ? data.runs : Array.isArray(data) ? data : [];
    const active = runs.some((run) => run?.status && !TERMINAL_RUN_STATUSES.has(run.status));
    if (!active) return;
    await new Promise((r) => setTimeout(r, intervalMs));
    intervalMs = Math.min(2500, Math.floor(intervalMs * 1.35));
  }
}

async function runCloudPrompt(auth, model, prompt, timeoutMs, options = {}) {
  pruneWarmAgents();
  const reuseAllowed = options.reuseAgent !== false;
  const limit = getCloudConcurrencyLimit();
  let entry = reuseAllowed ? warmCloudAgents.find((a) => !a.busy) : null;

  if (entry && reuseAllowed) {
    entry.busy = true;
    try {
      let followUp = await createCloudFollowUpRun(entry.id, auth, prompt, timeoutMs);
      if (followUp.busy) {
        await waitForAgentIdle(entry.id, auth, Math.min(timeoutMs, 45000));
        followUp = await createCloudFollowUpRun(entry.id, auth, prompt, timeoutMs);
      }
      if (!followUp.busy && followUp.runId) {
        const text = await pollCloudRunResult(entry.id, followUp.runId, auth, timeoutMs);
        entry.lastUsedAt = Date.now();
        return { text, method: 'cursor-cloud-followup', agentId: entry.id };
      }
    } catch {
      const idx = warmCloudAgents.indexOf(entry);
      if (idx >= 0) warmCloudAgents.splice(idx, 1);
      entry = null;
    } finally {
      if (entry) entry.busy = false;
    }
  }

  const { agentId, runId } = await createCloudAgentRun(auth, model, prompt, timeoutMs);
  const text = await pollCloudRunResult(agentId, runId, auth, timeoutMs);
  if (reuseAllowed) {
    const existing = warmCloudAgents.find((a) => a.id === agentId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      existing.busy = false;
    } else if (warmCloudAgents.filter((a) => Date.now() - a.lastUsedAt <= AGENT_SESSION_TTL_MS).length < limit) {
      warmCloudAgents.push({ id: agentId, busy: false, lastUsedAt: Date.now() });
    }
  }
  return { text, method: 'cursor-cloud-agent', agentId };
}

async function analyzeWithCursorCloud(systemPrompt, userPayload, options = {}) {
  const auth = getCursorAuthHeader();
  if (!auth) return null;
  const model = process.env.FANCHENG_CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
  const timeoutMs = Number(process.env.FANCHENG_CURSOR_TIMEOUT_MS) || 120000;
  const prompt = `${systemPrompt}\n\n---\n结构化数据（JSON）：\n${JSON.stringify(userPayload, null, 2)}`;

  await acquireCloudSlot();
  try {
    const result = await runCloudPrompt(auth, model, prompt, timeoutMs, options);
    return result;
  } finally {
    releaseCloudSlot();
  }
}

async function analyzeWithCursorProxy(systemPrompt, userPayload) {
  if (!shouldUseCursorProxy()) return null;
  const baseUrl = process.env.FANCHENG_CURSOR_API_URL.trim().replace(/\/$/, '');
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.FANCHENG_CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
  const timeoutMs = Number(process.env.FANCHENG_CURSOR_TIMEOUT_MS) || 120000;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Cursor proxy HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || data?.content || null;
  return text ? String(text).trim() : null;
}

/**
 * @returns {{ text: string|null, method: string, provider: string, model: string, error?: string }}
 */
async function analyzeWithCursor(systemPrompt, userPayload, options = {}) {
  applyCursorEnvFromConfig(readConfig());
  if (!isCursorConfigured()) {
    return {
      text: null,
      method: 'unconfigured',
      provider: 'cursor',
      model: DEFAULT_CURSOR_MODEL,
      error: '未配置 CURSOR_API_KEY',
    };
  }
  const {
    composeBoundedSystemPrompt,
    gateLlmText,
  } = require('./intel-llm-boundary');
  const model = process.env.FANCHENG_CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
  const bounded = composeBoundedSystemPrompt(
    'narrative_polish',
    options.systemPrompt || systemPrompt || ANALYSIS_SYSTEM_PROMPT
  );
  const prompt = bounded.systemPrompt;

  const applyGate = (text, method) => {
    if (!text) return { text: null, method, provider: 'cursor', model };
    const gated = gateLlmText(text, userPayload);
    if (!gated.used) {
      return {
        text: null,
        method: `${method}+boundary-blocked`,
        provider: 'cursor',
        model,
        error: `LLM boundary blocked: ${(gated.boundary?.reasons || []).join(',')}`,
        boundary: gated.boundary,
      };
    }
    return { text: gated.text, method, provider: 'cursor', model, boundary: gated.boundary };
  };

  try {
    const sdkText = await analyzeWithCursorSdk(prompt, userPayload);
    if (sdkText) {
      return applyGate(sdkText, 'cursor-sdk-agent');
    }
  } catch (err) {
    if (options.sdkOnly) {
      return { text: null, method: 'cursor-sdk-error', provider: 'cursor', model, error: err.message };
    }
  }

  try {
    const cloudResult = await analyzeWithCursorCloud(prompt, userPayload, options);
    if (cloudResult?.text) {
      return applyGate(cloudResult.text, cloudResult.method || 'cursor-cloud-agent');
    }
  } catch (err) {
    if (!shouldUseCursorProxy()) {
      return { text: null, method: 'cursor-cloud-error', provider: 'cursor', model, error: err.message };
    }
  }

  if (shouldUseCursorProxy()) {
    try {
      const proxyText = await analyzeWithCursorProxy(prompt, userPayload);
      if (proxyText) {
        return applyGate(proxyText, 'cursor-proxy-chat');
      }
      return { text: null, method: 'cursor-proxy-empty', provider: 'cursor', model, error: 'Cursor 代理返回空' };
    } catch (err) {
      return { text: null, method: 'cursor-error', provider: 'cursor', model, error: err.message };
    }
  }

  return {
    text: null,
    method: 'cursor-unavailable',
    provider: 'cursor',
    model,
    error: 'Cursor Cloud 分析失败，请检查 API Key 或网络',
  };
}

function parseAnalysisSections(text) {
  if (!text) {
    return {
      fundamentalAnalysis: null,
      trendAnalysis: null,
      positionAdvice: null,
      raw: null,
    };
  }
  const sections = { fundamentalAnalysis: null, trendAnalysis: null, positionAdvice: null, raw: text };
  const fundMatch = text.match(/【基本面】([\s\S]*?)(?=【走势】|【操作建议】|$)/);
  const trendMatch = text.match(/【走势】([\s\S]*?)(?=【操作建议】|$)/);
  const posMatch = text.match(/【操作建议】([\s\S]*?)$/);
  if (fundMatch) sections.fundamentalAnalysis = fundMatch[1].trim();
  if (trendMatch) sections.trendAnalysis = trendMatch[1].trim();
  if (posMatch) sections.positionAdvice = posMatch[1].trim();
  if (!sections.fundamentalAnalysis && !sections.trendAnalysis && !sections.positionAdvice) {
    sections.fundamentalAnalysis = text;
  }
  return sections;
}

function parseTop5DeepSections(text) {
  if (!text) {
    return {
      policySupply: null,
      technical: null,
      capital: null,
      inventorySpot: null,
      riskConflict: null,
      battleAdvice: null,
      raw: null,
    };
  }
  const sections = {
    policySupply: null,
    technical: null,
    capital: null,
    inventorySpot: null,
    riskConflict: null,
    battleAdvice: null,
    raw: text,
  };
  const patterns = [
    ['policySupply', /【政策产能】([\s\S]*?)(?=【技术面】|【资金持仓】|【库存现货成本】|【矛盾风险】|【作战建议】|$)/],
    ['technical', /【技术面】([\s\S]*?)(?=【资金持仓】|【库存现货成本】|【矛盾风险】|【作战建议】|$)/],
    ['capital', /【资金持仓】([\s\S]*?)(?=【库存现货成本】|【矛盾风险】|【作战建议】|$)/],
    ['inventorySpot', /【库存现货成本】([\s\S]*?)(?=【矛盾风险】|【作战建议】|$)/],
    ['riskConflict', /【矛盾风险】([\s\S]*?)(?=【作战建议】|$)/],
    ['battleAdvice', /【作战建议】([\s\S]*?)$/],
  ];
  for (const [key, re] of patterns) {
    const m = text.match(re);
    if (m) sections[key] = m[1].trim();
  }
  if (!sections.policySupply && !sections.battleAdvice) {
    sections.policySupply = text;
  }
  return sections;
}

function parseImpactBriefSections(text) {
  if (!text) {
    return { event: null, transmission: null, views: null, risk: null, summary: null, raw: null };
  }
  const sections = { event: null, transmission: null, views: null, risk: null, summary: null, raw: text };
  const patterns = [
    ['event', /【事件要点】([\s\S]*?)(?=【价格传导】|【机构观点】|【矛盾风险】|【研判摘要】|$)/],
    ['transmission', /【价格传导】([\s\S]*?)(?=【机构观点】|【矛盾风险】|【研判摘要】|$)/],
    ['views', /【机构观点】([\s\S]*?)(?=【矛盾风险】|【研判摘要】|$)/],
    ['risk', /【矛盾风险】([\s\S]*?)(?=【研判摘要】|$)/],
    ['summary', /【研判摘要】([\s\S]*?)$/],
  ];
  for (const [key, re] of patterns) {
    const m = text.match(re);
    if (m) sections[key] = m[1].trim();
  }
  return sections;
}

function parseLiquidityDailySections(text) {
  if (!text) {
    return {
      usMarkets: null,
      usBanking: null,
      japan: null,
      asia: null,
      europe: null,
      commodityLiq: null,
      raw: null,
    };
  }
  const sections = {
    usMarkets: null,
    usBanking: null,
    japan: null,
    asia: null,
    europe: null,
    commodityLiq: null,
    raw: text,
  };
  const patterns = [
    ['usMarkets', /【美国资本市场】([\s\S]*?)(?=【美国银行业】|【日本】|【亚洲经济体】|【欧洲经济体】|【大宗流动性结论】|$)/],
    ['usBanking', /【美国银行业】([\s\S]*?)(?=【日本】|【亚洲经济体】|【欧洲经济体】|【大宗流动性结论】|$)/],
    ['japan', /【日本】([\s\S]*?)(?=【亚洲经济体】|【欧洲经济体】|【大宗流动性结论】|$)/],
    ['asia', /【亚洲经济体】([\s\S]*?)(?=【欧洲经济体】|【大宗流动性结论】|$)/],
    ['europe', /【欧洲经济体】([\s\S]*?)(?=【大宗流动性结论】|$)/],
    ['commodityLiq', /【大宗流动性结论】([\s\S]*?)$/],
  ];
  for (const [key, re] of patterns) {
    const m = text.match(re);
    if (m) sections[key] = m[1].trim();
  }
  return sections;
}

function resetCloudAgentPool() {
  warmCloudAgents.length = 0;
}

module.exports = {
  CURSOR_CLIENT_VERSION,
  ANALYSIS_SYSTEM_PROMPT,
  TOP5_DEEP_BRIEF_PROMPT,
  IMPACT_BRIEF_PROMPT,
  LIQUIDITY_DAILY_PROMPT,
  NEWS_ARTICLE_BRIEF_PROMPT,
  DEFAULT_CURSOR_MODEL,
  applyCursorEnvFromConfig,
  isCursorConfigured,
  getCursorConfig,
  getCloudConcurrencyLimit,
  analyzeWithCursor,
  parseAnalysisSections,
  parseTop5DeepSections,
  parseImpactBriefSections,
  parseLiquidityDailySections,
  resetCloudAgentPool,
};
