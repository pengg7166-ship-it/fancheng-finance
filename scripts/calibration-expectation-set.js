const { assessCommodityImpact, classifyTierFromDimensions } = require('../services/focus-impact-dimensions');

const CALIBRATION_SET = [
  { id: 'U1', label: '国常会稳外贸', text: '国常会研究部署稳定外贸稳外资工作，多措并举扩大开放', expect: '拒收' },
  { id: 'U2', label: 'OFAC制裁', text: '[公告] OFAC制裁行动公告', expect: 'sector' },
  { id: 'U3', label: '央行增持黄金', text: '中国人民银行连续第三个月增持黄金储备', expect: 'sector' },
  { id: 'U4', label: '美伊→加息预期', text: '周末美伊冲突升级后，美联储加息概率重新抬升，能源通胀担忧再度侵蚀年内按兵不动的市场假设', expect: 'global' },
  { id: 'U5', label: '期货有色日报', text: '光大期货：7月13日有色金属日报', expect: 'feed' },
  { id: 'U6', label: '韩国股指熔断', text: '韩国综合股价指数暴跌触发熔断机制 交易暂停20分钟', expect: '拒收' },
  { id: 'U7', label: '美股熔断', text: '标普500指数暴跌触发熔断机制，美股交易暂停', expect: 'global' },
  { id: 'B1', label: '美联储降息至零', text: '美联储紧急宣布将政策利率下调至零，以释放流动性应对危机', expect: 'global' },
  { id: 'B2', label: '全面加征关税', text: '特朗普政府宣布对主要贸易伙伴全面加征关税，全球市场避险情绪升温', expect: 'global' },
  { id: 'U8', label: '工业硅内卷', text: '工业硅 | 暴跌55%仍不见底！2026光伏巨头放血大内卷，谁能熬过这场硅业至暗时刻？', expect: 'sector' },
  { id: 'U9', label: '纯碱深跌', text: '纯碱期货主力合约暴跌8%，跌至近三年低位，市场情绪低迷', expect: 'sector' },
  { id: 'U10', label: '反内卷政策', text: '国务院常务会议部署反内卷工作，推动玻璃、光伏、多晶硅等行业减产自律', expect: 'sector' },
  { id: 'U12', label: '螺纹深跌', text: '螺纹钢期货主力合约暴跌6%，跌至年内低位，黑色系情绪承压', expect: 'sector' },
  { id: 'U13', label: 'PTA反内卷', text: 'PTA行业反内卷减产自律倡议发布，聚酯链产能出清预期升温', expect: 'sector' },
  { id: 'U14', label: '沪铜库存', text: 'LME铜库存降至近三年低位，沪铜获AI数据中心需求支撑预期', expect: 'sector', watch: 'high' },
  { id: 'U15', label: '锌暴跌', text: '沪锌期货连续下跌，跌幅扩大至年内低位', expect: 'sector', watch: 'no' },
];

console.log('当前引擎判定（请你逐条确认或纠正）\n');
for (const c of CALIBRATION_SET) {
  const dim = assessCommodityImpact(c.text, {});
  const cls = classifyTierFromDimensions(dim, c.text, {});
  const review = dim.expectationReview || dim.relevance;
  const tier = cls?.tier || '拒收';
  const okTier = !c.expect || tier === c.expect || (c.expect === '拒收' && !cls);
  const okWatch =
    c.watch === undefined ||
    (c.watch === 'high' && review?.watchPriority === 'high') ||
    (c.watch === 'no' && review?.watchPriority !== 'high');
  const ok = okTier && okWatch;
  const flag = ok ? 'OK' : 'FAIL';
  console.log(`[${c.id}] ${c.label} ${flag}${!ok && c.expect ? ' expect=' + c.expect : ''}${!okWatch && c.watch ? ' watch=' + c.watch : ''}`);
  console.log(`  标题: ${c.text.slice(0, 56)}${c.text.length > 56 ? '…' : ''}`);
  console.log(`  判定: ${cls?.tier || '拒收'} | 质量${review?.expectationMagnitude ?? '—'} | 宽${dim.width} 广${dim.breadth} 时${dim.durationLabel}${c.expect ? ` | 要求${c.expect}` : ''}`);
  if (review?.rejectReason) console.log(`  拒因: ${review.rejectReason}`);
  console.log(`  通道: ${(review?.channels || []).join(', ') || '—'}`);
  if (review?.watchPriority) console.log(`  关注: ${review.watchPriority}${review.watchReason ? ` (${review.watchReason})` : ''}`);
  console.log('');
}
