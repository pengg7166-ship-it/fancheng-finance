# 7×24 快讯源集成说明

梵澄金融快讯抓取写入 `data/history/flash-news-inbox.json`，**不会**自动合并到 `news-tagged.csv`，需人工核验后再导入。

## 命令

```bash
npm run fetch-flash-news
# 仅保留命中关键词（美联储/关税/煤矿等）的条目
npm run fetch-flash-news -- --alerts-only
```

Electron 内：设置 → **7×24 快讯抓取** → 立即抓取；或开启「启动后自动抓取」。

## 已连接源（2026-06-07 实测）

| 源 | 方式 | 状态 | 说明 |
|---|---|---|---|
| 东方财富·7×24 | API `getFastNewsList` biz=web_724 | ✅ | 50 条/次，需 `sortEnd=` 空 |
| 东方财富·商品快讯 | API fastColumn=106 | ✅ | 商品/期货相关 |
| 东方财富·期货专栏 | API column=350 | ✅ | 期货专栏新闻 |
| 金十数据 | API flash-api.jin10.com | ✅ | 需 x-app-id 头 |
| 华尔街见闻 | API wallstcn lives | ✅ | 全球直播 channel |
| CNBC 头条/全球 | RSS | ✅ | 公开 feed |
| 美联储·新闻稿 | RSS press_all.xml | ✅ | FOMC/货币政策相关 |
| 新华社·财经/国际 | RSS | ✅ | 官方中文 |
| Federal Register·Fed/USTR | JSON API | ✅ | 规章/公告，替代 ustr.gov RSS |
| 财联社 | API + 签名 | ⚠️ | 本环境 HTTP 404；见手动回退 |
| 彭博·市场 | RSS | ⚠️ | 国内常超时（10s），不爬付费墙 |
| Reuters 头条/商业 | RSS | ⚠️ | feeds.reuters.com 超时/拒绝 |
| 美国国务院 RSS | RSS | ❌ | 返回非 RSS HTML，已禁用 |
| 白宫 / USTR RSS / gov.cn / 矿山安监 | — | ❌ | 无稳定公开接口，见手动 |

**最近一次 `npm run fetch-flash-news`（2026-06-07）**：298 条抓取，274 条写入 inbox；24h 窗口 210 条，关键词命中 59 条。

## 需手动 / 粘贴回退

1. **财联社** `https://www.cls.cn/telegraph` — 复制标题后通过 IPC `add-manual-flash-news` 或后续 CSV 工具写入。
2. **国家矿山安全监察局** — 煤矿/矿难类，手动粘贴。
3. **Bloomberg / Reuters 正文** — 仅用 RSS 标题；付费正文不抓取。

手动粘贴示例（DevTools 或脚本）：

```javascript
await window.fancheng.addManualFlashNews({
  entries: [{ title: '【财联社】某某煤矿停产整顿', link: 'https://www.cls.cn/...' }],
  sourceLabel: '财联社·手动',
});
```

## 关键词告警

注册于 `services/flash-news-sources.js` → `FLASH_ALERT_KEYWORDS`：

- **fed** — 美联储、FOMC、Powell…
- **tariff** — 关税、Section 301/232、USTR、贸易战
- **coal** — 煤矿、煤炭、矿难、安监
- **oil** — 原油、OPEC、霍尔木兹、红海
- **macro** — 非农、CPI、降息/加息
- **sanction** — 制裁、OFAC、实体清单
- **china-policy** — 国务院、发改委、央行、商务部…

命中关键词的条目会写入 `keywordHits`；商品标签由 `policy-commodity-map.detectCommodityTags` 映射到 `commodityTags`（如 tariff→cu/al，coal→ZC/j/jm）。

## Inbox 字段

```json
{
  "id": "md5(title+pubDate)",
  "title": "...",
  "pubDate": "ISO8601",
  "sourceId": "jin10",
  "keywordHits": ["fed"],
  "commodityTags": ["sc", "au"],
  "status": "pending",
  "verifyNote": "未合并至 news-tagged.csv，需人工核验"
}
```

## 速率限制

- 源间间隔 600–1500ms（见各源 `rateLimitMs`）
- 后台默认每 10 分钟最多抓一次（设置可调，最小 5 分钟）
- 不并发轰炸同一域名

## 下一步（用户）

1. 运行 `npm run fetch-flash-news`，打开 `data/history/flash-news-inbox.json` 审阅 `pending` 条目。
2. 财联社/煤矿类：浏览器复制标题 → 手动粘贴队列。
3. 确认无误后，将选中行手工追加到 `news-tagged.csv` 或现有 merge 脚本（**不要**自动合并）。
4. 海外 Reuters/Bloomberg 若需稳定访问，可在有代理的环境运行抓取脚本，或将 RSS 标题粘贴入库。
