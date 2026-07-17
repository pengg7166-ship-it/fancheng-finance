# 聚宽 JoinQuant 对接（路径 A：成交回放）

> 本仓库**无内置 JQ 适配器**。最快验证方式：本地 probe 锁定 baseline → 导出回放 CSV → 在 JQ 研究环境按时间戳回放。

## 1. 本地锁定 baseline

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
npm run audit-tick-inventory

$env:QUANT_MODE = "fundamental_chan"
$env:QUANT_PRECIOUS_MIN_RR = "2.0"
$env:CHAN_TRAIL_ARM_RATIO = "0.67"
$env:CHAN_EXIT_PATH = "5m"
node scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy
```

对齐：`_probe-fundamental-chan-quant-summary.json` → **+102.261% / 9,726 笔**。

## 2. 导出 JQ 回放包

```powershell
$env:FANCHENG_DATA_DRIVE = "E"
node scripts/export-trades-joinquant.js
# 或指定目录：
node scripts/export-trades-joinquant.js --out E:\交易记录\joinquant
```

产出（默认 `data/exports/joinquant/`）：

| 文件 | 用途 |
|------|------|
| `quant-trades-joinquant-YYYY-MM-DD.csv` | 9,726 笔回放信号（含 `jq_symbol_continuous` / `jq_symbol_specific`） |
| `joinquant-symbol-map-YYYY-MM-DD.json` | 56 品种 → JQ 代码对照 + baseline 摘要 |
| `joinquant-replay-template-YYYY-MM-DD.py` | JQ 研究环境粘贴模板 |

可选 env：

- `JQ_CONTRACT_STYLE=8888`（默认）或 `9999` — 主力连续后缀
- `JQ_SYMBOL_MODE` — 预留；CSV 同时含 continuous 与 specific 列

## 3. 聚宽侧操作

1. 登录 [joinquant.com](https://www.joinquant.com)，确认**国内期货**日 K / 分钟 K 数据权限。
2. 研究环境批量验证 56 品种 `get_price('AU8888.XSGE', frequency='5m', ...)` 在 2023–2025 是否有数据。
3. 将 CSV 上传 JQ 研究环境（或复制到 JQ 可读路径）。
4. 用模板 Python 按 `entry_time` / `exit_time` 回放 `order`；手续费尽量对齐 `services/quant-trading-fees.js`（方正中期）。
5. 对比维度：**总 PnL、笔数、分品种 PnL**（不要只比总收益 %）。

## 4. 合约映射规则

| 本地 `exchangeId` | JQ 后缀 | 示例 |
|-------------------|---------|------|
| shfe | `.XSGE` | `au` → `AU8888.XSGE` |
| dce | `.XDCE` | `i` → `I8888.XDCE` |
| zce | `.XZCE` | `cf` → `CF8888.XZCE` |
| ine | `.XINE` | `sc` → `SC8888.XINE` |
| gfex | `.XGFEX` | `lc` → `LC8888.XGFEX` |

**注意：** 本地 5m tick 退出（bar 内 O→L→H→C 触价、trail、夜盘日历）在 JQ **不能开箱复现**。回放验证的是 JQ 执行层与费率；要独立复现 +102% 需移植 `chan-multitf-levels.js` 等（路径 C，数周级）。

## 5. 合理预期

| 方式 | 与 +102.26% 可比性 |
|------|-------------------|
| CSV 回放（路径 A） | 验证费率/滑点/合约代码；PnL 差 >5–10% 查映射 |
| 混合信号导出（路径 B） | 逐步逼近；需另建每日信号 CSV |
| 全量 Python 移植（路径 C） | 唯一可追求数字对齐的路径 |

## 6. 相关文件

- `scripts/export-trades-joinquant.js` — 导出脚本
- `services/commodities-catalog.js` — 交易所元数据
- `docs/HANDOFF_2026-06-25.md` — 当前 baseline 运维
- `docs/QUANT_TRADING_FUNDAMENTAL_CHAN.md` — 策略架构
