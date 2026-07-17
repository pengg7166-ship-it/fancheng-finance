# 大商所 API · 最优接入方案（dceapiv1.0）

## 一键录入（推荐）

门户打开「我的 API 信息」→ 点 **复制** → 运行：

```bash
cd F:\FanchengFinance\source\fancheng-finance
node scripts/setup-dce-portal-interactive.js
```

弹窗粘贴 **完整** API key / secret（含 `&` `^` `%`），脚本会立即验登录并拉公告。

手工文件方式：

```bash
# tmp/dce-creds.txt 两行：key / secret
node scripts/set-dce-portal-creds.js --file tmp/dce-creds.txt
node scripts/_verify-dce-portal-api.js
```

---

## 官方契约（已代码对齐）

| 能力 | 方法 | Path |
|------|------|------|
| 登录 | POST | `/dceapi/cms/auth/accessToken` |
| 业务/活动公告、今日提示 | POST | `/dceapi/cms/info/articleByPage` |
| 当前交易日 | GET | `/dceapi/forward/publicweb/maxTradeDate` |
| 仓单日报 | POST | `/dceapi/forward/publicweb/dailystat/wbillWeeklyQuotes` |
| 日行情（定主力约） | POST | `/dceapi/forward/publicweb/dailystat/dayQuotes` |
| 日成交持仓排名 | POST | `/dceapi/forward/publicweb/dailystat/memberDealPosi` |

公告栏目：`244` / `1076` / `245` · `siteId=5`  
仓单/持仓默认品种（关注池∩大商所）：`i jm m y p eg jd lh`

工程加固：Token **磁盘缓存**、每分钟限流、`402/501` 自动刷新/退避。  
落盘：

- `cache/dce-portal-token.json` / `dce-portal-market.json`
- `history/warehouse-receipts/{id}-daily.json`（与 SHFE 同路径，`exchange: DCE`）
- `cache/dce-member-posi/{id}-{yyyymmdd}.json`

日同步类型：`dce_warehouse`（`daily-data-sync`）。当日仓单未出时**回退上一交易日**，空品种标 `empty`，不填假值。会员持仓用 **max OI 合约**（禁止 `contractId=all`）。

---

## 当前状态

库存短板闭环（`v1.56.19-inventory-gaps-closed`）：

- DCE 仓单深度回填 + 会员持仓结构特征
- CZCE Excel 仓单 / GFEX JSON 仓单 → 同路径 `warehouse-receipts`
- 矛盾矩阵：显性库存 / 基差 / 会员集中度；假说写入 registry 并可日更证伪
- 高矛盾 → 交易姿态降档（观望 / 试仓上限）
- 显性库存（铁矿港口 / 铜社会）走 CSV 导入：`scripts/fetch-sector-fundamentals.js --import …`

```bash
node scripts/_verify-dce-portal-api.js
node scripts/backfill-exchange-warehouse-deep.js
```

若登录仍 `402`，几乎总是 **凭证粘贴不准**（截图里 `l`/`I`/`1` 易混）。请用上面的交互脚本重新粘贴，申请/重置后等约 1 分钟再生效。
