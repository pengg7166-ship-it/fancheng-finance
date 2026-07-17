/**
 * 情报中心 · 幕僚面 vs 算命面（构想 §1 / §71 / §44）
 * 信念未达可行动时：备忘录+门禁为强面；方向箭头/交易指导降为「参考」，禁止当指令。
 * 禁止用假信念抬升 fortune chrome。
 */
const STAFF_FACE_VERSION = 'v2.89.0-staff-face';

const BELIEF = {
  strong: '强结构',
  weak: '弱结构',
  divided: '叙事分歧',
  unknown: '不可判定',
  falsifying: '证伪进行中',
};

const MODE = {
  command: 'command',
  brief: 'brief',
  observe: 'observe',
};

const MODE_LABEL = {
  command: '可行动幕僚',
  brief: '备忘录优先',
  observe: '观望·禁算命面',
};

function resolveStaffFace(ic = {}) {
  const belief = ic.beliefLevel || ic.primaryClaim?.confidence || BELIEF.unknown;
  const status = ic.primaryClaim?.status || null;
  const memoOk = Boolean(ic.memo?.available);
  const memoGate = ic.gates?.memo?.pass === true || ic.memo?.publishable === true;
  const top5Gate = ic.gates?.top5?.pass === true;
  const reasons = [];

  let mode = MODE.observe;
  let fortuneChromeAllowed = false;

  if (status === 'falsified' || status === 'expired') {
    mode = MODE.observe;
    fortuneChromeAllowed = false;
    reasons.push(status === 'falsified' ? '已证伪' : '已过期');
  } else if (status === 'falsifying' || belief === BELIEF.falsifying) {
    mode = MODE.observe;
    fortuneChromeAllowed = false;
    reasons.push('证伪进行中');
  } else if (belief === BELIEF.unknown) {
    mode = MODE.observe;
    fortuneChromeAllowed = false;
    reasons.push('信念不可判定');
  } else if (belief === BELIEF.divided) {
    mode = MODE.brief;
    fortuneChromeAllowed = false;
    reasons.push('叙事分歧·禁方向指令');
  } else if (belief === BELIEF.strong && (top5Gate || memoGate)) {
    mode = MODE.command;
    fortuneChromeAllowed = true;
    reasons.push(top5Gate ? '强结构·Top5门禁过' : '强结构·备忘录门禁过');
  } else if (belief === BELIEF.weak && top5Gate) {
    mode = MODE.command;
    fortuneChromeAllowed = true;
    reasons.push('弱结构·Top5门禁过');
  } else if (belief === BELIEF.strong || belief === BELIEF.weak || memoOk) {
    mode = MODE.brief;
    fortuneChromeAllowed = false;
    reasons.push(
      belief === BELIEF.strong
        ? '强结构·门禁未过'
        : belief === BELIEF.weak
          ? '弱结构·未过可行动门禁'
          : '仅备忘录·非指令'
    );
  } else {
    mode = MODE.observe;
    fortuneChromeAllowed = false;
    reasons.push('情报未就绪');
  }

  const banner =
    mode === MODE.command
      ? null
      : mode === MODE.brief
        ? '幕僚面：先读备忘录与门禁。方向/交易指导仅为参考，非指令。'
        : '观望面：信念未达可行动或证伪中。方向箭头与交易指导已降权，禁止当指令。';

  return {
    version: STAFF_FACE_VERSION,
    mode,
    modeLabel: MODE_LABEL[mode],
    fortuneChromeAllowed,
    directionPrimary: fortuneChromeAllowed,
    guidanceCommand: fortuneChromeAllowed,
    belief,
    status,
    memoGate,
    top5Gate,
    reasons,
    banner,
    display: `${MODE_LABEL[mode]} · ${belief}${reasons[0] ? ` · ${reasons[0]}` : ''}`,
    note: 'fortuneChrome 仅强/弱+门禁；分歧/不可判定/证伪中一律降权',
    dataSource: 'intel-staff-face',
    method: 'belief+gates→staff|fortune',
  };
}

module.exports = {
  STAFF_FACE_VERSION,
  BELIEF,
  MODE,
  MODE_LABEL,
  resolveStaffFace,
};
