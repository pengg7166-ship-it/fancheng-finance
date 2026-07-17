# 大商所（DCE）对外门户 API · 探测文档

> 探测时间：**2026-07-13**（UTC+8）  
> 探针脚本：`scripts/_probe-dce-portal-api.js`  
> 数据完整性约束：探测结果如实记录；**未获官方凭证前不得伪造大商所公告条目**。

---

## 1. 背景：两套「API」不要混淆

| 类型 | 用途 | 协议 | 是否适合抓公告 |
|------|------|------|----------------|
| **对外门户 API**（2025-12 上线） | 通知公告、日/周/月行情、统计、业务参数 | HTTP REST（需注册申请） | ✅ **官方最优路径** |
| **DCEIS V60 会员接口** | 会员交易、行情前置 | TCP + TradeAPI/QuotAPI | ❌ 交易专用，非公告 |

对外门户 API 据 [中证网 2025-12-23 报道](https://www.cs.com.cn/zzqh2020/202512/t20251223_6529768.html)：

- 面向**对外门户注册用户免费开放**
- 数据与对外门户公开源**同步更新**
- 文档含调用说明、参数规范、示例代码（**须登录门户后查看**）
- 单账户 **每分钟调用次数受限**（防带宽/资源占用）

**申请入口**

1. 大商所门户网站 → **数据服务 → 数据工具 → API 服务**
2. 大商所对外门户客户端 → **数据 → 工具 → 数据申请 → API 服务**

---

## 2. 本项目探测结论（摘要）

在本机 Node 环境（`http-client` + 标准 UA）下：

| 结论 | 说明 |
|------|------|
| **官网 HTML 全灭** | `www.dce.com.cn` 多条路径统一 **HTTP 412**（WAF/反爬） |
| **HTTPS 不稳定** | `https://www.dce.com.cn` 多次 **ECONNRESET** |
| **RSS 已下线** | `http://www.dce.com.cn/dce/rss/rss.xml` → **404** |
| **匿名 REST 不存在** | 猜测的 `/publicweb/api/notice/list` 等路径无公开无凭证响应 |
| **当前生产策略** | `exchange-notice-fetcher` 对大商所走 **镜像**（东财/新浪/资讯池关键词），标注 `exchangeMirror: true` |

```
直连可用：中金所 10 · 广期所 25（2026-07-13 实测）
大商所：  0 直连 · 仅镜像（官网 412）
```

---

## 3. 探测命令

```bash
# 需 Node（本仓库环境示例）
$env:Path = "F:\FanchengFinance\tools\node-v22;" + $env:Path
$env:FANCHENG_DATA_DRIVE = 'F'
cd F:\FanchengFinance\source\fancheng-finance
node scripts/_probe-dce-portal-api.js
```

相关旧探针（对照）：

```bash
node scripts/_probe-exchange-notice-apis.js   # 多交易所横评
node scripts/_probe-exchange-api2.js        # 东财/上期所猜测 API
node scripts/_probe-policy-strengthen.js    # 含 dce-notice HTML + dce-rss
```

---

## 4. 探测路径明细（2026-07-13 实测）

### 4.1 对外门户 / 官网 HTML

| ID | URL | HTTP | 耗时 | 公告可解析 |
|----|-----|------|------|------------|
| `publicweb-notice-index` | `http://www.dce.com.cn/publicweb/notice/notice_index.html` | **412** | ~300ms | ❌ |
| `publicweb-home` | `http://www.dce.com.cn/publicweb/` | **412** | ~200ms | ❌ |
| `publicweb-api-doc` | `http://www.dce.com.cn/publicweb/api/` | **412** | ~80ms | ❌ |
| `publicweb-api-doc2` | `http://www.dce.com.cn/publicweb/datacenter/api/` | **412** | ~80ms | ❌ |
| `publicweb-notice-https` | `https://www.dce.com.cn/publicweb/notice/notice_index.html` | 连接重置 | ~20s | ❌ |

### 4.2 旧版频道（历史路径）

| ID | URL | HTTP | 说明 |
|----|-----|------|------|
| `legacy-channel-226` | `http://www.dce.com.cn/dce/channel/list/226.html` | **412** | 曾用于政策 HTML 抓取 |
| `legacy-channel-227` | `http://www.dce.com.cn/dce/channel/list/227.html` | **412** | 同上 |
| `legacy-notice` | `http://www.dce.com.cn/dalianshangpin/xwgg93/index.html` | **412** | 旧新闻公告 |

### 4.3 RSS

| ID | URL | HTTP | 说明 |
|----|-----|------|------|
| `rss-xml` | `http://www.dce.com.cn/dce/rss/rss.xml` | **404** | 已不可用 |
| `rss-xml-https` | `https://www.dce.com.cn/dce/rss/rss.xml` | ECONNRESET | 不可用 |

### 4.4 无凭证 REST 猜测（勿用于生产）

以下路径为根据 `publicweb` 命名惯例的**猜测**，无官方文档佐证；匿名探测均失败：

| 猜测 URL | 预期 |
|----------|------|
| `http://www.dce.com.cn/publicweb/api/notice/list` | 需登录 + API Key |
| `http://www.dce.com.cn/publicweb/notice/list` | 同上 |
| `https://www.dce.com.cn/publicweb/api/v1/notice` | HTTPS 不稳定 |
| `http://www.dce.com.cn/publicweb/datacenter/notice/list` | 412 / 需凭证 |

> **真实 endpoint、Header、签名方式仅以门户内「API 服务」官方文档为准。**

### 4.5 镜像对照（非官方）

| 源 | URL | 用途 |
|----|-----|------|
| 东财期货专栏 | `np-listapi.eastmoney.com/...column=350` | 期货新闻，**非**交易所公告专栏 |
| 东财商品 7×24 | `np-weblist.eastmoney.com/...fastColumn=106` | 关键词过滤「大商所」 |
| 新浪期货 roll | `feed.mix.sina.com.cn/...lid=2516` | 关键词过滤 |

镜像命中须满足 `exchange-notice-fetcher` 严格门控（中文交易所名 + 公告/限仓等），标注 `exchangeMirror: true`。

---

## 5. HTTP 412 说明

**Precondition Failed** 在本场景表现为大商所 WAF/反自动化策略：

- 无浏览器 Cookie / 会话
- 数据中心 IP 特征
- 缺少门户要求的请求头（具体以官方文档为准）

**不建议**通过伪造 Cookie、绕过 WAF 等方式强爬官网 HTML——稳定性差且可能违反使用条款。

**合规最优路径**：注册对外门户 → 申请 API → 使用官方 REST + 限速。

---

## 6. 接入梵澄金融的推荐方案

### 阶段 A — 当前（无 API 凭证）✅ 已落地

```
exchange-notice-fetcher
  ├─ 直连：中金所 / 广期所 HTML
  ├─ 镜像：快讯池 + 政策池 + 新浪 roll + 东财快讯
  └─ 大商所：仅镜像（含「大商所」关键词的真实转载）
```

覆盖看板展示：`交易所公告 N · 直连 X · 镜像 Y · 大商所 …`

### 阶段 B — 获得官方 API 后（待实施）

1. **配置**（`services/config.js`，示例字段，名称以官方文档为准）  
   ```js
   dcePortalApi: {
     enabled: false,
     baseUrl: '',        // 官方文档 Base URL
     appId: '',
     appSecret: '',      // 或 token
     rateLimitPerMin: 30 // 按账户配额填写
   }
   ```

2. **新模块** `services/dce-portal-api-fetcher.js`  
   - 仅调用官方文档列出的公告接口  
   - 返回字段映射：`title` / `link` / `pubDate` / `dataSource: 'dce-portal-api'`  
   - `exchangeMirror: false`，`exchangeLabel: '大商所'`  
   - 失败返回空数组，**不补假数据**

3. **并入** `exchange-notice-fetcher.fetchExchangeNoticeBundle()`  
   - 优先级：**官方 API > 镜像**  
   - 去重：`dedupeItems` 已优先保留非镜像

4. **调度**  
   - 建议 ≤ 官方每分钟限额；公告类 **5–10 分钟** 轮询即可  
   - 与 `focus-impact-scheduler` 每 6 轮 `fetchExchangeNoticeBundle` 对齐

5. **审计**  
   - `news-coverage-audit` 的 `exchangeNotice` stats 增加 `dceApi: true/false`  
   - deploy 前 `node scripts/_verify-exchange-notice.js` 须有大商所直连样本

### 阶段 C — 凭证申请清单（需人工）

- [ ] 注册大商所对外门户账户  
- [ ] 申请 API 服务并下载接口文档 PDF/HTML  
- [ ] 记录：Base URL、认证方式（API Key / OAuth / 签名）、公告接口 path、分页参数、频率限制  
- [ ] 将 **测试环境 Key** 写入本机 `config`（勿提交 git）  
- [ ] 运行 `node scripts/_probe-dce-portal-api.js --with-credentials`（待脚本扩展）

---

## 7. 与上期所 / 郑商所 / 海关 对照

| 交易所/机构 | 直连 HTML | 官方 API | 本项目状态 |
|-------------|-----------|----------|------------|
| 中金所 | ✅ HTTP | — | 直连 10 条 |
| 广期所 | ✅ `jysgg/list.shtml` | — | 直连 25 条 |
| **大商所** | ❌ 412 | ✅ 需注册（2025-12） | **仅镜像** |
| 上期所 | ❌ JS 壳 | — | 镜像 |
| 郑商所 | ❌ 301/跳转 | — | 镜像 |
| 海关 | ❌ 412 | — | 政策源另途 |

---

## 8. 数据完整性检查清单

接入大商所 API 或新增镜像源时：

- [ ] 每条公告是否有 `dataSource` / `method` / `exchangeMirror`？  
- [ ] 镜像是否标注「镜像」而非冒充官网？  
- [ ] fetch 失败是否返回空（非 `|| '--'` 占位）？  
- [ ] 覆盖审计 `exchange` 层样本是否可追溯？  
- [ ] 是否遵守官方每分钟调用上限？

---

## 9. 参考链接

| 资源 | URL |
|------|-----|
| 大商所官网 | http://www.dce.com.cn/ |
| 对外门户公告页（当前 412） | http://www.dce.com.cn/publicweb/notice/notice_index.html |
| API 服务报道（中证网） | https://www.cs.com.cn/zzqh2020/202512/t20251223_6529768.html |
| 本项目交易所聚合 | `services/exchange-notice-fetcher.js` |
| 覆盖看板统计 | `services/news-coverage-audit.js` → `summary.exchangeNotice` |

---

## 10. 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-07-13 | v1.0 | 初版：412/RSS404 实测 + 官方 API 申请路径 + 接入规划 |
