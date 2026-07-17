/**
 * 梵澄金融 · 产品哲学 manifest '单一事实来源
 * UI / outlook-engine / philosophy-filter 共用原则与版本'
 */
const fs = require('fs');
const path = require('path');

const MANIFEST_JSON_PATH = path.join(__dirname, '..', 'data', 'fancheng-philosophy-v1.json');

const FANCHENG_PHILOSOPHY = {
  version: 'v1',
  manifestVersion: '1.35.9',
  updatedAt: '2026-06-29',
  epigraph: '在一个变化的世界里，结论只是一时的，并不是恒定不变的，变才是世界的主要部分',
  principles: [
    {
      id: 'change_first',
      title: '变化优先',
      short: '变才是主',
      summary: '结论具时效性；系统随新数据、新时段、新事件持续校正，不作恒定断言',
    },
    {
      id: 'outlook_anchor',
      title: '研判为纲',
      short: '大宗走势研判',
      summary: '供需×金融环境、主矛盾分级、政策与跨境传导——理论基线定方向，其余模块围绕它展开',
    },
    {
      id: 'chan_method',
      title: '缠论为术',
      short: '多周·K线',
      summary: '缠论结构 + 5m/15m/1h 支撑阻力，在研判方向确立后寻找入场印证，不另起一套 alpha',
    },
    {
      id: 'slot_correction',
      title: '时段校正',
      short: '三槽预测',
      summary: '每日 20:55 / 08:55 / 13:25 固定快照，夜盘前、日盘前、午盘前持续校正同一 session 的判断',
    },
    {
      id: 'empirical_check',
      title: '实证对照',
      short: '预测 vs 实际',
      summary: '存档、三时段对照、方向/区间校验与复盘——用实际走势检验并修正下一版结论',
    },
    {
      id: 'gate_humility',
      title: '审慎 gate',
      short: 'Phil 过滤',
      summary: '当价格走势、跨品种 lead、政策叙事或利好兑现与哲学方向冲突时，宁可观望也不硬做',
    },
  ],
  strategyStack: [
    { layer: '变量', name: '大宗走势研判', role: '理论基线 · 方向与区' },
    { layer: '变量', name: '哲学 filter', role: '政策/事件/叙事 · Phil / Phil·过滤' },
    { layer: '常量', name: '缠论 S/R', role: '多周 touch 入场 · 止损纪律' },
    { layer: '常量', name: 'Quant gate', role: '方向注入 · 信号从属于研' },
  ],
  predictionSlots: [
    { id: 'pre-night', label: '20:55夜盘', shortLabel: '20:55' },
    { id: 'pre-day', label: '08:55日盘', shortLabel: '08:55' },
    { id: 'pre-afternoon', label: '13:25午盘', shortLabel: '13:25' },
  ],
  envFlags: {
    PHILOSOPHY_FILTER_V2: {
      default: '1',
      description: '哲学方向 filter v2；生产默认开',
    },
    QUANT_MODE: {
      default: 'fundamental_chan',
      description: '研判方向 + 缠论 S/R',
    },
  },
};

let manifestCache = null;

function loadManifestFromDisk() {
  try {
    if (fs.existsSync(MANIFEST_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(MANIFEST_JSON_PATH, 'utf8'));
    }
  } catch {
    // fall through
  }
  return null;
}

function getPhilosophyManifest() {
  if (!manifestCache) {
    manifestCache = loadManifestFromDisk() || FANCHENG_PHILOSOPHY;
  }
  return manifestCache;
}

function getPrinciple(id) {
  return getPhilosophyManifest().principles?.find((p) => p.id === id) || null;
}

function getGateNeutralLabels() {
  return {
    philosophy_neutral: '哲学中',
    philosophy_divergence: '哲学发散',
    event_pullback: '事件回撤',
    policy_day_neutral: '政策',
    cross_market_conflict: '跨境冲突',
    priced_in_full: '利好兑现',
    low_philosophy_confidence: '置信不足',
  };
}

/** 服务端：为品种详情生成哲学锚点对齐摘'*/
function buildInstrumentPhilosophyAnchor(inst = {}) {
  const manifest = getPhilosophyManifest();
  const lines = [];
  const p = inst.philosophy;
  const pf = inst.philosophyFilter;
  const gateLabels = getGateNeutralLabels();

  lines.push({
    principleId: 'change_first',
    title: '变化优先',
    text: inst.judgementUpdatedDisplay
      ? `结论具时效'· 上次更新 ${inst.judgementUpdatedDisplay}${inst.changeDelta ? ' · 较上次有变更' : ''}`
      : '结论随数据滚动刷新，不作恒定断言',
  });

  if (p?.sdFinance?.note || p?.logicSummary) {
    lines.push({
      principleId: 'outlook_anchor',
      title: '研判为纲',
      text: (p.sdFinance?.note || p.logicSummary || '').slice(0, 160),
    });
  }

  const hasTech = (inst.techBadges || inst.badges || []).some((b) =>
    /缠|结构|S\/R|支撑|阻力|chan/i.test(String(b.label || b.id || ''))
  );
  lines.push({
    principleId: 'chan_method',
    title: '缠论为术',
    text: hasTech
      ? '多周期结构标签已出现 · 入场须与研判方向同向'
      : '方向由研判定 · 缠论 S/R 作入场印证（5m/15m/1h）',
  });

  const slots = manifest.predictionSlots || FANCHENG_PHILOSOPHY.predictionSlots;
  lines.push({
    principleId: 'slot_correction',
    title: '时段校正',
    text: `三槽 ${slots.map((s) => s.shortLabel).join(' / ')} 持续校正`,
  });

  if (inst.accuracyRecords?.length || inst.directionAuditRecords?.length) {
    lines.push({
      principleId: 'empirical_check',
      title: '实证对照',
      text: '下方校验表对照预测 vs 实际 · 复盘驱动下一版校正',
    });
  }

  if (pf) {
    const reason = pf.filterPass
      ? 'Phil 环境与哲学方向一致'
      : `Phil·过滤 · ${gateLabels[pf.neutralReason] || pf.neutralReason || '观望'}`;
    lines.push({
      principleId: 'gate_humility',
      title: '审慎 gate',
      text: reason,
      pass: pf.filterPass !== false,
    });
  }

  return {
    epigraph: manifest.epigraph,
    version: manifest.version,
    manifestVersion: manifest.manifestVersion,
    lines,
  };
}

module.exports = {
  FANCHENG_PHILOSOPHY,
  MANIFEST_JSON_PATH,
  getPhilosophyManifest,
  getPrinciple,
  getGateNeutralLabels,
  buildInstrumentPhilosophyAnchor,
};
