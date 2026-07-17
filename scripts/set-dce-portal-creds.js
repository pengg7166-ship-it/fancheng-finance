#!/usr/bin/env node
/**
 * 写入大商所 API 凭证（避免对话泄露）。
 * 用法：
 *   node scripts/set-dce-portal-creds.js --key YOUR_KEY --secret YOUR_SECRET
 * 或从文件两行读写：第1行 key，第2行 secret
 *   node scripts/set-dce-portal-creds.js --file tmp/dce-creds.txt
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../services/config');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--key') out.key = argv[++i];
    else if (a === '--secret') out.secret = argv[++i];
    else if (a === '--file') out.file = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
let key = args.key;
let secret = args.secret;
if (args.file) {
  const lines = fs
    .readFileSync(path.resolve(args.file), 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  key = lines[0];
  secret = lines[1];
}

if (!key || !secret) {
  console.error('需要 --key/--secret 或 --file（两行：key\\nsecret）');
  process.exit(1);
}

config.init(path.join(os.homedir(), 'AppData', 'Roaming', 'fancheng-finance'));
const prev = config.readConfig().dcePortalApi || {};
config.writeConfig({
  dcePortalApi: {
    ...prev,
    enabled: true,
    baseUrl: prev.baseUrl || 'http://www.dce.com.cn',
    appKey: key,
    appSecret: secret,
    authPath: '/dceapi/cms/auth/accessToken',
    noticePath: '/dceapi/cms/info/articleByPage',
    siteId: 5,
    pageSize: prev.pageSize || 15,
    rateLimitPerMin: prev.rateLimitPerMin || 30,
    columnIds: prev.columnIds || ['244', '1076', '245'],
  },
});
console.log('已写入 dcePortalApi · keyLen=', key.length, 'secretLen=', secret.length);
console.log('下一步: node scripts/_verify-dce-portal-api.js');
