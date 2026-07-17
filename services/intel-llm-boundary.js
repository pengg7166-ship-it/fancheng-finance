/**
 * LLM 边界策略（构想 §60）
 * 输出侧硬拦编造价格/裸%/无溯源命中率；LLM 仅允许叙述润色。
 * 非 OS/进程级硬沙箱。
 */
const LLM_BOUNDARY_VERSION = 'v2.89.25-llm-boundary';

const ALLOWED_ROLES = [
  'narrative_polish',
  'section_label',
  'how_to_read',
  'macro_summary',
  'qa_explain',
  'daily_brief_tone',
  'slot_explain',
];

const FORBIDDEN_NUMERIC_KINDS = [
  'invented_price',
  'bare_pct',
  'invented_hit_rate',
  'invented_n',
  'posture_change',
];

const BOUNDARY_SYSTEM_SUFFIX =
  '【边界硬约束】只根据 JSON 结构化数据回答；禁止编造价格、止损、posture、命中率或样本量 n；缺失必须写「暂无」；命中率若出现必须保留 (hits/n) 且数字须来自 JSON。';

function collectAllowedNumbers(facts) {
  const set = new Set();
  const add = (v) => {
    if (v == null || v === '' || v === '暂无') return;
    const n = Number(v);
    if (Number.isFinite(n)) {
      set.add(String(n));
      set.add(n.toFixed(0));
      set.add(n.toFixed(1));
      set.add(n.toFixed(2));
    }
    const s = String(v);
    const m = s.match(/([\d.]+)\s*%\s*\((\d+)\s*\/\s*(\d+)\)/);
    if (m) {
      set.add(m[1]);
      set.add(m[2]);
      set.add(m[3]);
      set.add(`${m[1]}%`);
    }
    for (const x of s.match(/-?\d+(?:\.\d+)?/g) || []) set.add(x);
  };
  const walk = (obj, depth = 0) => {
    if (obj == null || depth > 6) return;
    if (typeof obj === 'number' || typeof obj === 'string') {
      add(obj);
      return;
    }
    if (Array.isArray(obj)) {
      for (const x of obj.slice(0, 40)) walk(x, depth + 1);
      return;
    }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (/close|price|hit|rate|nDisplay|sample|pct|baseClose|change/i.test(k)) add(v);
        walk(v, depth + 1);
      }
    }
  };
  walk(facts);
  return set;
}

/**
 * @param {string} text
 * @param {object} facts — structured JSON the model was given
 * @returns {{ ok: boolean, blocked: boolean, reasons: string[], sanitized: string|null, method: string }}
 */
function assertLlmOutputWithinFacts(text, facts = {}) {
  const raw = String(text || '').trim();
  if (!raw) {
    return {
      ok: false,
      blocked: true,
      reasons: ['empty_output'],
      sanitized: null,
      method: 'llm-boundary-empty',
      dataSource: 'intel-llm-boundary',
    };
  }

  const allowed = collectAllowedNumbers(facts);
  const reasons = [];

  // bare % without (hits/n)
  const barePct = raw.match(/(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*%(?!\s*\()/g) || [];
  for (const bp of barePct) {
    const num = bp.replace(/\s*%/, '');
    if (!allowed.has(num) && !allowed.has(`${num}%`)) {
      reasons.push(`bare_pct:${bp.trim()}`);
    } else if (!/\d+\s*%\s*\(\d+\s*\/\s*\d+\)/.test(raw) && /命中|准确|胜率/.test(raw)) {
      reasons.push(`bare_pct_as_hit:${bp.trim()}`);
    }
  }

  // hit-like patterns with numbers not in facts
  const hitLike = [...raw.matchAll(/([\d.]+)\s*%\s*\((\d+)\s*\/\s*(\d+)\)/g)];
  for (const m of hitLike) {
    if (!allowed.has(m[1]) || !allowed.has(m[2]) || !allowed.has(m[3])) {
      reasons.push(`invented_hit_rate:${m[0]}`);
    }
  }

  // price-like: 4+ digit numbers with 元/点/价 not in allowlist
  const priceLike = [...raw.matchAll(/(?:价格|收盘|现价|点位|止损|止盈)[^\d]{0,6}(\d{3,}(?:\.\d+)?)/g)];
  for (const m of priceLike) {
    if (!allowed.has(m[1])) reasons.push(`invented_price:${m[1]}`);
  }

  // large standalone numbers that look like prices (optional soft)
  const bigNums = [...raw.matchAll(/(?<![\d./])(\d{4,}(?:\.\d+)?)(?![\d/%])/g)];
  for (const m of bigNums) {
    if (!allowed.has(m[1]) && !allowed.has(String(Number(m[1])))) {
      // only flag if context suggests price
      const idx = m.index || 0;
      const window = raw.slice(Math.max(0, idx - 12), idx + m[0].length + 4);
      if (/价|点|收|开|高|低|元/.test(window)) reasons.push(`invented_price:${m[1]}`);
    }
  }

  if (/建议\s*(改|调|换)\s*(仓|多|空|posture)|把 posture 改为/i.test(raw)) {
    reasons.push('posture_change');
  }

  const uniq = [...new Set(reasons)];
  if (uniq.length) {
    return {
      ok: false,
      blocked: true,
      reasons: uniq.slice(0, 12),
      sanitized: null,
      method: 'llm-boundary-block',
      dataSource: 'intel-llm-boundary',
      note: '输出含不可溯源数值·回退规则文案',
    };
  }

  return {
    ok: true,
    blocked: false,
    reasons: [],
    sanitized: raw,
    method: 'llm-boundary-pass',
    dataSource: 'intel-llm-boundary',
  };
}

function composeBoundedSystemPrompt(role = 'narrative_polish', basePrompt = '') {
  const roleOk = ALLOWED_ROLES.includes(role) ? role : 'narrative_polish';
  const base = String(basePrompt || '').trim();
  return {
    role: roleOk,
    systemPrompt: `${base}${base ? ' ' : ''}${BOUNDARY_SYSTEM_SUFFIX} 角色=${roleOk}。`,
    allowedRoles: ALLOWED_ROLES,
    forbiddenKinds: FORBIDDEN_NUMERIC_KINDS,
    version: LLM_BOUNDARY_VERSION,
    method: 'compose-bounded-system-prompt',
  };
}

function buildLlmBoundaryPolicy() {
  return {
    version: LLM_BOUNDARY_VERSION,
    allowedRoles: ALLOWED_ROLES,
    forbiddenNumericKinds: FORBIDDEN_NUMERIC_KINDS,
    hardSandbox: false,
    outputGate: true,
    note: '输出侧硬拦编造价格/裸%/无溯源 n；非进程级 LLM 沙箱',
    method: 'llm-boundary-policy',
    dataSource: 'intel-llm-boundary',
  };
}

/**
 * Hub 板：策略状态（本进程不统计实时拦截次数除非 opts.stats）
 */
function buildLlmBoundaryBoard(pack, opts = {}) {
  const policy = buildLlmBoundaryPolicy();
  const stats = opts.stats || pack?.llmBoundaryRuntime || null;
  const blockedN = stats?.blockedN ?? null;
  const passedN = stats?.passedN ?? null;
  const available = true;
  return {
    version: LLM_BOUNDARY_VERSION,
    asOf: opts.asOf || pack?.asOf || null,
    available,
    policy,
    hardSandbox: false,
    outputGate: true,
    counts: {
      blockedN: blockedN != null ? blockedN : null,
      passedN: passedN != null ? passedN : null,
      nDisplay:
        blockedN != null || passedN != null
          ? `拦${blockedN ?? '暂无'}/过${passedN ?? '暂无'}`
          : '暂无（本包未跑 LLM）',
    },
    display:
      blockedN != null && blockedN > 0
        ? `LLM边界 输出硬拦${blockedN} · 非进程沙箱`
        : 'LLM边界 输出侧硬拦就绪 · 非进程沙箱',
    note: policy.note,
    method: 'llm-boundary-board',
    dataSource: 'intel-llm-boundary',
  };
}

/**
 * Gate helper for call sites: returns text or null if blocked
 */
function gateLlmText(text, facts, opts = {}) {
  const check = assertLlmOutputWithinFacts(text, facts);
  if (check.ok) {
    return { text: check.sanitized, boundary: check, used: true };
  }
  return {
    text: opts.fallback != null ? opts.fallback : null,
    boundary: check,
    used: false,
  };
}

module.exports = {
  LLM_BOUNDARY_VERSION,
  ALLOWED_ROLES,
  FORBIDDEN_NUMERIC_KINDS,
  BOUNDARY_SYSTEM_SUFFIX,
  collectAllowedNumbers,
  assertLlmOutputWithinFacts,
  composeBoundedSystemPrompt,
  buildLlmBoundaryPolicy,
  buildLlmBoundaryBoard,
  gateLlmText,
};
