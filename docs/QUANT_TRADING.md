# 量化交易模块

仿真交易基于 **Model C sim_relaxed** 交集信号（纸面/回测），**live_high_hit** 仅作「可交易」徽章标注。T+1 隔夜持仓，本金 100 万 RMB。

> **基本面 + 缠论 S/R（Phase 1 新架构）**：见 [QUANT_TRADING_FUNDAMENTAL_CHAN.md](./QUANT_TRADING_FUNDAMENTAL_CHAN.md)。`QUANT_MODE=fundamental_chan` 以研判方向为主、五法则评分、日内 S/R 入场。

> **五法则 Quant Gate（Legacy model_c_gate）**：live/sim 放行须叠加研判方向、五法则 ≥N 票、区间带可交易与 Model C/OI 交集 — 见 [TRADING_RULES_FIVE_LAWS.md](./TRADING_RULES_FIVE_LAWS.md)。

## 信号分层（双 tier）

| Tier | 用途 | 参数概要 | OOS 2023–2025 |
|------|------|----------|---------------|
| **sim_relaxed** | 回测、daemon 纸面（**默认**） | N5/T4 · 五法则评分加成 · **band soft pass** | **22 笔 · +3.55% · 73%** |
| **sim_balanced** | 较严五法则 gate | N5/T4 · 五法则 ≥2/3 · event 须 turtle\|dolphin | ~8 笔 · ~62% 命中 |
| **live_high_hit** | UI「可交易」徽章、严格实盘 | N4–5/T4 · vol≥1.05 · minPhil=0.12 | ~0.9% 信号日 · ~70% 命中 |

**为何曾只有 9 笔成交？** 旧版回测与 daemon 均使用 `live_high_hit` + 仅 au/ag 池 + `tradableForLive` 四重过滤（交集 + 资金流 + 背离 + 置信度），3 年 OOS 仅约 19 个可交易日，bar 回放后更少。**样本不足以评估策略**；现改为 sim_relaxed 驱动仿真（五法则软 gate），live_high_hit 保留为严格可交易徽章。

环境变量：

```
QUANT_MODE=fundamental_chan   # 研判方向 + 缠论 S/R（探针默认）
QUANT_MODE=model_c_gate       # Legacy Model C 硬 gate
MODEL_C_SIM_TIER=sim_relaxed      # 回测 / daemon 纸面（默认）
MODEL_C_SIM_TIER=sim_balanced     # 较严五法则 gate（对比探针）
MODEL_C_LIVE_TIER=high_hit        # 可交易徽章 tier（默认）
QUANT_BAND_SIM_MODE=soft          # sim_relaxed 区间带放宽（默认 soft）
QUANT_BAND_SIM_MODE=strict        # 与 sim_balanced 同：band miss 禁止开仓
QUANT_BAND_SIM_MODE=partial       # 仅部分命中（一侧）放行，0.75× 仓位
QUANT_BAND_SIM_MODE=off           # sim 完全忽略 band miss（不推荐）
```

### sim vs live 区间带策略（2026-06-18）

| Tier | band miss | 行为 |
|------|-----------|------|
| **live_high_hit** | 是 | **硬阻断**，禁止开仓 / 无「可交易」徽章 |
| **sim_balanced** | 是 | **硬阻断**（与 live 一致） |
| **sim_relaxed** | 是 | **软放行**：0.6× 仓位，`bandSoftPass=true`；全命中 1.0× |
| **sim_relaxed** | 部分命中 | `partial` 模式：0.75× 仓位（探针与 `soft` 等效于当前样本） |

探针 au/ag/rb 2023–2025：`soft` 22 笔 +3.55% 73% vs 严格 band 15 笔 +1.93% 67%；Model C only 23 笔 +4.38%。

## 品种池

| 品种 | 纳入 | sim_balanced 依据 |
|------|------|-------------------|
| **au** 沪金 | ✅ | ~57% 命中（n=7）；贵金属核心 |
| **ag** 沪银 | ✅ | ~80% 命中（n=15）；主力品种 |
| **rb** 螺纹钢 | ✅ | ~67% 命中（n=3）；扩大样本 |
| **cu** 沪铜 | ❌ | ~43% 命中，低于 60% 门槛 |

## 交易规则

- **做多**：21:00 夜盘开仓 → 次日 15:00 平仓；**做空**相反
- **信号时点**：baselineDate 日 15:00 收盘后 Quant Gate 确认 `tradableForSim`（哲学 + 五法则 + 区间带 + Model C）；band miss 在 sim_relaxed 下软放行并缩仓
- **入场价**：下一交易日 bar `open`（代理 21:00 夜盘开盘）+ 1 tick 滑点
- **出场价**：sessionDate 日 bar `close`（15:00 收盘）− 1 tick 滑点
- **仓位**：按哲学/方向置信度 1–3 手，单笔不超过可用保证金 35%
- **频次**：每品种每 baselineDate 最多 1 次往返

## 费用与保证金

- **手续费**：方正中期期货 [2026-04-27 标准](https://www.founderfu.com/fzzqqh_2019/details_256_87628.html)
- **保证金**：`services/quant-trading-margin.js` — SHFE 合约乘数 + 仿真保证金率
- **日历**：`services/cn-futures-session-calendar.js` — 日 K date = 日盘自然日

## 存档

```
{FANCHENG_DATA_DRIVE}:\FanchengFinance\data\history\quant-trading-archive\
  trades.jsonl          # UI 读取，成交按时间新→旧排序
  au-trades.jsonl
  ag-trades.jsonl
  rb-trades.jsonl
  quant-trading-daemon-state.json
  quant-trading-daemon.log
```

## 桌面 UI — 「量化交易」标签页

汇总卡片、成交明细表（**最新在上**）、品种筛选。IPC：`get-quant-trading-archive` · `get-quant-trading-summary`

## 后台自动交易（应用关闭时）

| 方式 | 说明 |
|------|------|
| **任务计划** | `scripts/install-quant-trading-task.ps1` → 每日 **15:05**、**20:55** |
| **常驻 watch** | `node scripts/quant-trading-daemon.js --watch` |

推荐环境（daemon 与回测一致）：

```
FANCHENG_DATA_DRIVE=E
PHILOSOPHY_FILTER_V2=1
MODEL_C_V2=1
MODEL_C_SIM_TIER=sim_relaxed
MODEL_C_LIVE_TIER=high_hit
```

### 手动运行

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = 'E'
$env:MODEL_C_SIM_TIER = 'sim_balanced'
node scripts/quant-trading-daemon.js --live --force
```

## 运行回测

```powershell
$env:FANCHENG_DATA_DRIVE = 'E'
$env:MODEL_C_SIM_TIER = 'sim_balanced'
node scripts/run-quant-trading-backtest.js --from 2023-01-01 --to 2025-12-31
```

输出：`_quant-trading-backtest-summary.json` + 写入 quant-trading-archive。

## 生产部署（v1.34.8）

```
node _patch-quant-trading-asar.js
```

Model C 权重文件（E 盘）不会被 patch 修改。
