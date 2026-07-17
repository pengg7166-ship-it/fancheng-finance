# Forward 无限易 Checkpoint · 2026-06-30

> 三时段 export 管线已跑通；无限易 **live sim 已启动**（38 笔成交）。下一步：监控 sim 止损/止盈；**day_prep 08:58 gate 已修复**（2026-06-30）。

## Gate/变量层 · v1.34.8（2026-06-27）

| 项 | 值 |
|----|-----|
| **Gate 层版本** | `v1.34.8`（`services/outlook-gate-config.js`） |
| **logistic 权重** | **不变** · `v1.34.8-ag-cu-spread+basis-term` |
| **模式** | `QUANT_MODE=fundamental_chan` · `PHILOSOPHY_FILTER_V2=1` |
| **变更范围** | 仅变量层：哲学 filter → quant gate → 研判展示方向；**未改**无限易执行 / outbox 路径代码 |

**自动化（2026-06-28）**：交易日 01:28 / 08:58 / 20:58 Windows 任务已注册 ✓ → 见 [FORWARD_AUTOMATION.md](./FORWARD_AUTOMATION.md)。

## 状态快照

| 项 | 值 |
|----|-----|
| **数据盘** | `E:\FanchengFinance\data`（`FANCHENG_DATA_DRIVE=E`） |
| **Outbox** | `E:\FanchengFinance\data\outbox\signals\` |
| **Baseline** | **2026-06-26**（周五日 K）→ session **2026-06-29** |
| **最新 outbox** | `signals-2026-06-29-night_prep.jsonl` · **13 信号** / 45 skipped · ATR 门修复后 |
| **三时段 export** | `night_prep` ✓ 20 条 · `early_morning` 2026-06-30 跑完 0 条 · `day_prep` **08:58 被 skip**（见下） |
| **slot-snapshot** | `2026-06-29` pre-night/pre-day/pre-afternoon ✓ · `2026-06-30` pre-day ✓ · pre-night 仍指向 2026-06-29 20:55 |
| **策略加载** | `DemoFanchengOutbox` 按 **mtime 最新** jsonl → 当前 `signals-2026-06-29-night_prep.jsonl` |
| **合约** | 全为东财 OI 主力（m2609/ag2608/AP610 等）· **0 条 au2510 / 过期合约** |
| **日 K 同步** | `cu.json` lastDate **2026-06-29**（06-30 日 K 尚未入库，属 15:00 前正常态） |
| **策略部署** | `deploy-pythongo.ps1` → `InfiniTrader_SimulationBetaX64\pyStrategy\demo\DemoFanchengOutbox.py` ✓ |
| **无限易 sim** | **已运行** · `infinitrader-trades.jsonl` **38 笔**（22 开 / 16 平）· `dry_run: false` |
| **对账报告** | `E:\FanchengFinance\data\outbox\sim-trades\reconcile-forward-2026-06-30.json` |

## 三时段 export 明细

| Slot | 最近运行 | 结果 | outbox 文件 |
|------|----------|------|-------------|
| **20:58 night_prep** | 2026-06-30 修复后 | ✓ 13 信号 | `signals-2026-06-29-night_prep.jsonl` |
| **08:58 day_prep** | 2026-06-30 08:58 | ✗ skip `not_trading_day`（已修 gate，可 `--slot day_prep` 补跑） | 无 |
| **01:28 early_morning** | 2026-06-30 01:28 | ✓ 0 信号 | 无新文件 |

**day_prep skip 根因（已修）**：`shouldRunSlot('day_prep')` 原用 `cu.json` 当日 bar 判断交易日；08:58 时 bar 未入库会误判。现改为 `isTradingDayForDayPrep`：当日 bar 缺失时由上一交易日推断（周一查周五）。补跑：`node scripts/forward-export-pipeline.js --slot day_prep`。

## 无限易 sim 对账（2026-06-30）

```powershell
node scripts/reconcile-sim-pnl.js --from 2026-06-26 --to 2026-06-30 `
  --sim-log E:\FanchengFinance\data\outbox\sim-trades\infinitrader-trades.jsonl `
  --out E:\FanchengFinance\data\outbox\sim-trades\reconcile-forward-2026-06-30.json
```

| 指标 | 值 |
|------|-----|
| outbox 信号 | 20（night_prep · session 2026-06-29） |
| 无限易成交 | 38（8 合约 · 全部 ⊆ outbox） |
| 成交合约 | SA609, pg2608, sn2608, ag2608, m2609, fu2609, sc2608, AP610 |
| 方向 | long 22 / short 16（含止损平仓） |
| 合约校验 | ✓ 全为主力 · 无 au2510 |

**说明**：38 > 20 因同品种多笔 Chan 入场（如 AP610 signalSeq 0–2）及止损/再入场；不可期望复现本地 +102% archive（5m intraday sim vs 限价+tick 止损）。

## 命令速查

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"

# 三时段手动 export
node scripts/forward-export-pipeline.js --slot night_prep
node scripts/forward-export-pipeline.js --force --slot day_prep   # 日历 gate 未修复前

# 对账
node scripts/reconcile-sim-pnl.js --from 2026-06-26 --to 2026-06-30 `
  --sim-log E:\FanchengFinance\data\outbox\sim-trades\infinitrader-trades.jsonl

# 部署无限易策略
powershell -ExecutionPolicy Bypass -File scripts/deploy-pythongo.ps1

# 一键全平：先停 DemoFanchengOutbox → 重载 demo/DemoFlattenAll → DryRun=1 试跑 → DryRun=0 运行一次
```

## 无限易操作

1. PythonGO → 策略管理 → **重载** `demo/DemoFanchengOutbox`
2. 参数：`outboxPath=E:\FanchengFinance\data\outbox\signals` · `maxLots=1` · `max_entries_per_instrument=5`
3. sim 已在跑；新 jsonl 写入后**重载**或等策略自动扫目录
4. **止盈仍须手动**（策略仅自动止损）

## 合约过滤

**主力合约（M）**：outbox 的 `infinitraderSymbol` 由 `main-contract-resolver.js` 按东方财富 **持仓量 OI 优先**解析；Python 加载器拒绝 `isMainContract: false`。

## Export 质量门（2026-06-30）

`services/outbox-export-filters.js` 在写 jsonl 前过滤：

| 规则 | 说明 |
|------|------|
| **无夜盘** | `night_prep` / `early_morning` 跳过 `hasNightSession=false`（如 lh/ap/jd） |
| **滑点谨慎** | `sn`/`pg` 夜盘槽跳过；`day_prep` 每品种最多 1 笔 |
| **止损过窄** | 止损距 < 25% × ATR(20) 跳过；**已达 Chan 配置 SL 宽度**或 **cu/ni/sn 300元/手** 则跳过 ATR 门 |
| **cu/ni/sn** | 固定 **300 元/手** 止损（乘数见 `futures-contract-specs`）；跳过 ATR 门 |
| **strict export** | 哲学 filter + 五法则 + compositeScore + 禁 weak entry 源 |

反测脚本：`node scripts/analyze-sim-entry-quality.js`（2026-06-29 sim：16/16 平仓 ≤30min，sn/pg 命中滑点名单）。

## 策略可观测性（无需重启 PythonGO）

**策略运行正常判据**（运行后读两个 JSON，无需问人）：

```powershell
Get-Content E:\FanchengFinance\data\outbox\sim-trades\strategy-startup.json
Get-Content E:\FanchengFinance\data\outbox\sim-trades\strategy-heartbeat.json
```

| 文件 | 正常（真实 sim 发单） | 异常 |
|------|----------------------|------|
| **startup.json** | `mode":"live"` · `dryRun":false` · `readyForOrders":true` · `ordersSubmittedThisStart` ≥ 1 · `warnings`: [] | `dryRun":true` 或 `readyForOrders":false` 或 warnings 非空 |
| **heartbeat.json** | `dryRun":false` · `ordersSubmitted` ≥ 1 · `signalFile` 有值 · `errors`: [] · `ts` 每 ~5s 更新 | `dryRun":true`（演练）或 `ordersSubmitted":0` 且 `mode":"live"` |

心跳文件（每 ~5s 更新）关键字段：`mode`、`dryRun`、`signalFile`、`ordersSubmitted`、`dryRunSimulated`、`trading`、`lastAction`、`errors`。  
日志前缀 `[执行]`：发单 / 成交 / 止损 / 跳过原因。DryRun=1 时 StraLog 出现 `★★★ 演练模式`；DryRun=0 时出现 `★ 真实发单模式` 及 `真实发单 order=…`。

**on_start 对账**：重启后从 `get_all_position()` 恢复持仓与已发单键，避免重复开仓；持仓归零时解锁止损。DryRun 演练**不再**写入 `placed_keys`，切真实发单后可重试同一批信号。

## 下一步

1. **今晚 20:58** 确认 `night_prep` 任务成功 → 查 `forward-export.jsonl` + 新 `signals-*-night_prep.jsonl`
2. **08:58 day_prep** — gate 已修；今日可手动 `node scripts/forward-export-pipeline.js --slot day_prep` 补跑
3. **sim 监控** — 对照 outbox 止损价 vs 实际平仓；记录滑点
4. ~~可选~~ — ~~修复 day_prep gate~~ ✓ `isTradingDayForDayPrep`（`forward-export-pipeline.js`）

## 根因备忘

- export 0 条（baseline 日 K 末根尚无各品种 next session）：先 sync 或显式 `--date`；**stop_too_tight_vs_atr** 误杀 Chan 配置 SL → 已修 `outbox-export-filters.js`（配置 SL 宽度豁免 + 默认 0.25）。
- 56 池 ≠ 每日 56 信号；2026-06-29 night_prep 20/55 过 gate。
- day_prep 08:58 skip：~~`cu.json` lastDate 滞后~~ → 已用 `isTradingDayForDayPrep` 推断。

---

*更新：2026-07-01 · DemoFanchengOutbox 真实发单自检（startup.json + heartbeat 判据）*
