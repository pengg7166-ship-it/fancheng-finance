# 郑商所（CZCE）公告抓取 · 探测文档

> 探测时间：**2026-07-13**（UTC+8）  
> 探针：`scripts/_probe-czce-portal-api.js`、`scripts/_probe-czce-raw-http.js`  
> 报告：`docs/czce-portal-probe-report.json`

---

## 1. 结论（一句话）

**郑商所官网 HTTP 一律 301 跳 HTTPS，HTTPS 统一 412（WAF）；无类似大商所「对外门户 REST API」的公开公告接口。ZCEAPI 为会员交易接口，不向普通资讯应用开放。当前仅可走镜像，标注 `exchangeMirror: true`。**

与大商所对比：

| | 大商所 DCE | 郑商所 CZCE |
|---|-----------|-------------|
| HTTP 直连 | 412 | 301 → HTTPS |
| HTTPS | 不稳定 / 412 | **412** |
| 公开 REST 公告 API | ✅ 2025-12 上线（需注册） | ❌ 无对等公开服务 |
| 交易 API | DCEIS V60（会员） | ZCEAPI（会员/开发商备案） |
| 本项目现状 | 镜像，明天可注册 API | **仅镜像** |

---

## 2. 探测链路（实测）

```
http://www.czce.com.cn/cn/ysgg/jysgg/index.htm
    │ 301 Location: https://www.czce.com.cn/cn/ysgg/jysgg/index.htm
    ▼
https://www.czce.com.cn/...
    │ HTTP 412 + WAF 页面（~2.6KB HTML 壳）
    ▼
    无法解析公告列表
```

| 路径 | 结果 |
|------|------|
| `…/jysgg/index.htm` | 301 → HTTPS → **412** |
| `…/jysgg/list.htm` | 301 → **412** |
| `https://…` 直连 | **412** |
| `http://czce.com.cn/…`（无 www） | 超时 / 重置 |
| RSS 猜测 | 301 → **412** |
| REST 猜测 `/cn/api/notice/list` | 301 / **412** |
| 东财快讯 106 专栏 | 有数据，**0 条**含「郑商所」关键词（窗口内） |

---

## 3. ZCEAPI ≠ 公告 REST

郑商所 **ZCEAPI** 是远程**交易/行情**编程接口（对话流、私有流、广播流），面向：

- 会员单位
- 行情转发单位
- **备案软件开发商**（填写申请表、审核后发放加密 SDK）

广播流虽含「交易所公告信息」，但须**登录交易前置/FENS**，不是给资讯聚合用的匿名 HTTP API。

联系方式（官方通知摘录）：安政伟 · 0371-65612010 · zwan@czce.com.cn

**不适合**梵澄金融资讯层直接对接（需会员席位 + 验收，且为二进制协议非 REST）。

---

## 4. 本项目当前策略 ✅

```
exchange-notice-fetcher
  ├─ 直连：中金所、广期所
  ├─ 大商所 / 上期所 / 郑商所：镜像
  └─ 郑商所镜像条件：标题含「郑商所|郑州商品交易所」+ 公告/限仓/保证金等
```

覆盖看板 `exchangeNotice` 统计中，郑商所条目计入 **镜像**，不冒充官网直连。

---

## 5. 可行回退（无需注册）— v1.56.9 已增强

| 源 | 说明 | 标注 |
|----|------|------|
| **东财期货首页** `futures.eastmoney.com` | 解析公告链接 + 品种推断郑商所 | `eastmoney-futures-home` |
| **东财搜索** | `郑商所 通知/公告/保证金` 等关键词 | `eastmoney-search` |
| 东财快讯 106/102/107 | 多专栏并行 | `eastmoney-fast-*` |
| 新浪期货 roll 2516–2520 | 多 lid 并行 | `sina-roll-*` |
| 快讯 / 政策池 | 历史转载 | `flash-policy-pool` |

识别增强：`关于动力煤期货…公告` 等无「郑商所」字样时，经 **品种→交易所** 映射标注为郑商所镜像。

---

## 6. 若未来要提升郑商所覆盖

优先级建议：

1. **镜像质量** — 扩大东财/新浪轮询 + 财联社期货频道人工核验后入库  
2. **大商所 API 经验复用** — 若郑商所日后推出公开数据 API，按 `dce-portal-api-fetcher` 同模式接入  
3. **会员级 ZCEAPI** — 仅当机构有郑商所会员/开发商资质时评估，成本高、非资讯应用主路径  

**暂不建议**：强爬 HTTPS 412、伪造 Cookie 绕过 WAF。

---

## 7. 探测命令

```bash
node scripts/_probe-czce-portal-api.js
node scripts/_probe-czce-raw-http.js      # 查看 301→412 链
node scripts/_verify-exchange-notice.js   # 聚合结果
```

---

## 8. 五所覆盖一览（2026-07-13）

| 交易所 | 直连 | 说明 |
|--------|------|------|
| 中金所 | ✅ | HTML |
| 广期所 | ✅ | `jysgg/list.shtml` 解析 |
| 大商所 | ❌ | 412；**明天可注册对外门户 API** |
| 上期所 | ❌ | JS 壳 |
| **郑商所** | ❌ | **301→HTTPS→412**；仅镜像 |

---

## 9. 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-07-13 | v1.0 | 301→412 链实测 + ZCEAPI 区分说明 |
