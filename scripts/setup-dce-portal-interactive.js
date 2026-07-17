#!/usr/bin/env node
/**
 * 大商所 API 凭证可视化录入（Windows InputBox）+ 立即验登录
 * 最优路径：门户点「复制」→ 粘贴到弹窗 → 本地写入 → 验证
 */
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const config = require('../services/config');

function inputBox(title, prompt, defaultValue = '') {
  const ps = `
Add-Type -AssemblyName Microsoft.VisualBasic
$r = [Microsoft.VisualBasic.Interaction]::InputBox(@'
${prompt.replace(/'/g, "''")}
'@, '${title.replace(/'/g, "''")}', '${String(defaultValue).replace(/'/g, "''")}')
[Console]::Out.Write($r)
`;
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8', windowsHide: true }
  );
  return String(out || '').trim();
}

config.init(path.join(os.homedir(), 'AppData', 'Roaming', 'fancheng-finance'));
const prev = config.readConfig().dcePortalApi || {};

console.log('请在弹窗中粘贴门户「我的 API 信息」的 Key / Secret（点过复制最好）…');
const key = inputBox('大商所 API', '粘贴 API key：', prev.appKey || '');
if (!key) {
  console.error('已取消：未填写 API key');
  process.exit(1);
}
const secret = inputBox('大商所 API', '粘贴 API secret（完整字符，含 & ^ % 等）：', '');
if (!secret) {
  console.error('已取消：未填写 API secret');
  process.exit(1);
}

config.writeConfig({
  dcePortalApi: {
    ...prev,
    enabled: true,
    baseUrl: 'http://www.dce.com.cn',
    appKey: key,
    appSecret: secret,
    authPath: '/dceapi/cms/auth/accessToken',
    noticePath: '/dceapi/cms/info/articleByPage',
    siteId: 5,
    pageSize: 15,
    rateLimitPerMin: 25,
    columnIds: ['244', '1076', '245'],
    varieties: ['i', 'jm', 'm', 'y', 'p', 'eg', 'jd', 'lh'],
    fetchWarehouse: true,
    fetchMemberPosi: true,
  },
});

console.log('已写入 · keyLen=', key.length, 'secretLen=', secret.length);
console.log('开始验证登录…');

const {
  getDcePortalConfig,
  fetchAccessToken,
  fetchDcePortalNotices,
  DCE_PORTAL_VERSION,
} = require('../services/dce-portal-api-fetcher');

(async () => {
  try {
    const auth = await fetchAccessToken(getDcePortalConfig(), { force: true });
    console.log('登录 OK ·', DCE_PORTAL_VERSION, '· source=', auth.source, 'expiresIn=', auth.expiresIn);
    const r = await fetchDcePortalNotices();
    console.log('公告条数:', r.items?.length || 0);
    if (r.market) console.log('市场包:', JSON.stringify(r.market));
    if (r.error) {
      console.error('拉取错误:', r.error);
      process.exitCode = 1;
    } else {
      (r.items || []).slice(0, 5).forEach((it) => console.log(' ·', it.title?.slice(0, 60)));
      console.log('\n完成。请重启 FanchengFinance.exe');
    }
  } catch (err) {
    console.error('登录失败:', err.message || err);
    console.error('请在门户重置 API 后重跑本脚本，或确认粘贴无空格/缺字。');
    process.exitCode = 1;
  }
})();
