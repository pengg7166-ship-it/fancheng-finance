/**
 * 界面中文本地化（渲染进程）
 */
function localizeText(message) {
  if (!message) return '未知错误';

  const map = {
    'FRED API Key': '美联储数据接口密钥',
    'FRED API': '美联储数据接口',
    'FRED 数据已连接': '美联储经济数据已连接',
    'FRED 已连接': '美联储经济数据已连接',
    'fetch failed': '网络连接失败',
    'socket hang up': '网络连接被中断',
    'ERR_EMPTY_RESPONSE': '数据服务器无响应',
    'connect ETIMEDOUT': '连接超时，请检查网络',
    'ETIMEDOUT': '连接超时',
    'Network request failed': '网络请求失败',
    'Stooq': '欧洲历史数据',
    'apikey': '接口密钥',
    'OHLCV': '开高低收量',
    'HTTP': '网络',
  };

  let out = String(message);
  for (const [en, zh] of Object.entries(map)) {
    out = out.split(en).join(zh);
  }

  const exact = {
    'K线数据源暂时不可用，请稍后重试': 'K线数据源暂时不可用，请稍后重试',
    '欧洲等地指数 K 线需配置历史数据密钥，请在设置中填写':
      '欧洲等地指数 K 线需配置历史数据密钥，请在设置中填写',
    '历史数据密钥无效或已过期，请重新申请': '历史数据密钥无效或已过期，请重新申请',
  };
  for (const [key, zh] of Object.entries(exact)) {
    if (out.includes(key)) return zh;
  }

  if (/^FRED API \d+$/.test(out)) {
    return `美联储数据接口错误（${out.replace('FRED API ', '')}）`;
  }
  if (/^HTTP \d+$/.test(out)) {
    return `网络请求失败（${out.replace('HTTP ', '')}）`;
  }

  const latin = (out.match(/[a-zA-Z]/g) || []).length;
  const cjk = (out.match(/[\u4e00-\u9fff]/g) || []).length;
  if (latin > 8 && latin > cjk) {
    return '操作失败，请检查网络或稍后重试';
  }

  return out;
}

if (typeof window !== 'undefined') {
  window.localizeText = localizeText;
}
