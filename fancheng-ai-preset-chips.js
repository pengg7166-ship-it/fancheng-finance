/**
 * AI fusion preset question chips — shared by renderer (app.js) and Node (fancheng-ai-fusion).
 * v1.47.0-retail-discipline
 */
(function presetChipsFactory(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.FanchengAiPresetChips = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildPresetChips() {
  const PRESET_CHIPS = Object.freeze([
    { id: 'posture', label: '为什么是这个 posture？', question: '为什么是这个 posture？', group: '品种', hub: true },
    { id: 'longEntry', label: '现在适合长线开仓吗？', question: '现在适合长线开仓吗？', group: '品种', hub: true },
    { id: 'globalRisk', label: '全球风险有何影响？', question: '全球风险对本品有什么影响？', group: '宏观', hub: true },
    { id: 'noTrade', label: '今天 no-trade 吗？', question: '今天 no-trade 吗？', group: '纪律', hub: true },
    { id: 'retailTrap', label: '派发区风险大吗？', question: '派发区风险大吗？', group: '纪律', hub: true },
    { id: 'backtest', label: '回测置信如何？', question: '回测置信如何？', group: '品种', hub: true },
    { id: 'painMemory', label: '有痛苦记忆吗？', question: '有痛苦记忆吗？', group: '纪律', hub: false },
    { id: 'opponent', label: '对手盘怎样？', question: '对手盘怎样？', group: '品种', hub: false },
    { id: 'playbook', label: 'playbook 阶段？', question: 'playbook 阶段？', group: '品种', hub: false },
    { id: 'coreTactical', label: '三槽快钱超标？', question: '三槽快钱超标？', group: '纪律', hub: false },
    { id: 'stop', label: '止损逻辑是什么？', question: '止损逻辑是什么？', group: '品种', hub: false },
    { id: 'theses', label: '宏观命题是什么？', question: '当前活跃命题是什么？', group: '宏观', hub: false },
  ]);

  const DETAIL_CHIP_IDS = Object.freeze([
    'noTrade',
    'retailTrap',
    'painMemory',
    'coreTactical',
    'posture',
    'longEntry',
    'backtest',
    'opponent',
    'playbook',
    'stop',
    'globalRisk',
    'theses',
  ]);

  const GROUP_ORDER = Object.freeze(['纪律', '品种', '宏观']);

  function getHubPresetChips() {
    return PRESET_CHIPS.filter((c) => c.hub);
  }

  function getDetailPresetChips() {
    const byId = new Map(PRESET_CHIPS.map((c) => [c.id, c]));
    return DETAIL_CHIP_IDS.map((id) => byId.get(id)).filter(Boolean);
  }

  function getDetailPresetChipsByGroup() {
    const chips = getDetailPresetChips();
    const grouped = new Map(GROUP_ORDER.map((g) => [g, []]));
    for (const chip of chips) {
      const list = grouped.get(chip.group) || [];
      list.push(chip);
      grouped.set(chip.group, list);
    }
    return GROUP_ORDER.map((group) => ({ group, chips: grouped.get(group) || [] })).filter((g) => g.chips.length);
  }

  return {
    PRESET_CHIPS,
    DETAIL_CHIP_IDS,
    GROUP_ORDER,
    getHubPresetChips,
    getDetailPresetChips,
    getDetailPresetChipsByGroup,
  };
});
