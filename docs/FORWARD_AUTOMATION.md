# Forward 模拟盘自动化 · 信号导出

> Gate 层 v1.34.8 · `QUANT_MODE=fundamental_chan` · outbox → `DemoFanchengOutbox`  
> **策略完整规格**：[STRATEGY_SPEC.md](./STRATEGY_SPEC.md)（三时段区间 + 缠论入场 + 5 笔上限）

## 做什么

在**交易日**三个时点自动：**同步数据 → 导出 outbox 信号**（不改动无限易执行层）。

| 时点 (CN) | 任务名 | `--slot` | 用途 |
|-----------|--------|----------|------|
| **20:58** | `FanchengFinance-ForwardExport-Night` | `night_prep` | 21:00 夜盘前 |
| **08:58** | `FanchengFinance-ForwardExport-Day` | `day_prep` | 09:00 日盘前 |
| **01:28** | `FanchengFinance-ForwardExport-Early` | `early_morning` | 夜盘凌晨段（贵金属等 ~01:30 前） |

非交易日（按 `history/trading/cu.json` 日历）自动 **skip**，写日志不报错。

## 一次性安装（Windows 任务计划）

```powershell
cd E:\FanchengFinance\source\fancheng-finance
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-forward-export-task.ps1
```

卸载：

```powershell
.\scripts\install-forward-export-task.ps1 -Remove
```

**前提：** PC 已登录、Node.js 在 PATH、`FANCHENG_DATA_DRIVE=E`（安装脚本会注入任务环境）。

## 每档自动步骤

编排入口：`scripts/forward-export-pipeline.js` → `services/forward-export-pipeline.js`

1. **交易日判断** — `cu` 日 K 日历；周日 20:58 若周一有 bar 仍跑
2. **幂等** — 同 slot + 同日 45 分钟内不重复写 outbox
3. **锁** — `data/history/.forward-export-lock.json`（与 daily-sync 锁独立）
4. **数据同步**
   - `trading_klines` + `trading_json`（全活跃池）
   - P0 分钟 K：`au/ag/rb/cu` 的 `hour/15m/5m`（`sync-intraday-klines` 同源）
5. **导出** — 按 `--slot` 读 **三时段 slot-snapshot**（见 STRATEGY_SPEC §3），Chan 入场价校验在预测区间内；导出前刷新 **主力合约映射**（东财 OI）；baseline 按 CN 时间自动（15:00 后含当日 bar）
6. **产出** — `E:\FanchengFinance\data\outbox\signals\signals-YYYY-MM-DD-{slot}.jsonl`  
   例：`signals-2026-06-29-night_prep.jsonl`、`…-day_prep.jsonl`、`…-early_morning.jsonl`

日志：`E:\FanchengFinance\data\logs\forward-export.jsonl`  
状态：`E:\FanchengFinance\data\history\forward-export-state.json`

## 手动 / 试跑

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"

# 仅看编排（不写 outbox、不拉网时可加 --skip-sync）
node scripts/forward-export-pipeline.js --dry-run --slot night_prep

# 快速试 P0（首次 export 仍可能较慢，建议先 warm cache）
node scripts/forward-export-pipeline.js --dry-run --slot day_prep --id au,ag,rb,cu

# 强制跑（忽略交易日 / 幂等）
node scripts/forward-export-pipeline.js --force --slot night_prep
```

首次全池导出慢 → 先按 [FORWARD_CHECKPOINT.md](./FORWARD_CHECKPOINT.md) 预热 `warm-finance-prefix.js`。

## 仍需手动

| 项 | 说明 |
|----|------|
| **大宗走势研判** | 在梵澄金融 App 内**主动刷新**该页；export **优先读** `outlook-history/slot-snapshots/`，无快照时回退 `commodity-outlook-v4.json`。Gate 方向仍由引擎 + history/trading 重算。 |
| **无限易重载** | 任务**不会**打开无限易。新 jsonl 写入后：PythonGO → 策略管理 → **重载** `demo/DemoFanchengOutbox`（策略读**最新** jsonl）。若策略已在跑且会自动扫目录，可省略重载（以你本地行为为准）。 |
| **DryRun / 开 sim** | GUI：`dryRun=1` 验证 → 再 `maxLots=1`、`max_entries_per_instrument=5` live sim |
| **止盈** | DemoFanchengOutbox **仅自动止损**；TP / 移动止损见本地 sim，无限易需手动 |
| **策略文件更新** | 仅改 Python 时：`powershell -File scripts/deploy-pythongo.ps1` |

## 明早 checklist（首个模拟交易日）

1. 昨晚 20:58 任务成功 → 查 `forward-export.jsonl` 有 `night_prep` + `signalCount`
2. 08:50 前打开梵澄金融，**刷新大宗走势研判**
3. 08:58 任务跑完 → outbox 有新 `signals-*.jsonl`（合约应为 **au2608** 等，非 au2510）
4. 无限易：**重载** DemoFanchengOutbox → `dryRun=1` → **运行**
5. 对照 outbox 方向 / 合约 / 止损价

## 与现有任务关系

| 任务 | 时间 | 作用 |
|------|------|------|
| `FanchengFinance-DailyDataSync` | 07:30 | 全量日更（宏观/新闻等）兜底 |
| `FanchengFinance-QuantTrading` | 15:05 / 20:55 | 纸面 daemon 归档 |
| **ForwardExport ×3** | 01:28 / 08:58 / 20:58 | **forward outbox**（本方案） |

07:30 日更与 session 导出互补，不冲突。

## 架构（不变）

- **变量层 / Gate**：大宗走势研判 + v1.34.8 logistic / philosophy filter
- **技术层**：缠论 5m / 15m / 1h（`chan-multitf-levels`）
- **执行层**：`DemoFanchengOutbox` 读 outbox，止盈止损逻辑未改

---

*2026-06-28 · forward session automation*
