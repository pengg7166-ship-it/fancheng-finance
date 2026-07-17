# 量化交易 · 基本面 + 缠论 S/R 架构

> Phase 1（v1.34.8 权重不变）— 替代 Model C 硬 gate 导致的过度过滤（3 年仅 8–22 笔）

## 变量层 / 常量层（产品分工）

梵澄量化采用 **[变量层 vs 常量层](./PRODUCT_PHILOSOPHY_VARIABLE_CONSTANT.md)** 产品哲学：

- **变量层**（每日演化）：outlook 研判 → 哲学 filter → quant gate 注入方向；alpha 来自政策、新闻、情绪、量价等综合，**不是**固定模板堆叠。  
- **常量层**（执行纪律）：缠论 S/R 入场、品种锁定 SL/盈利保护、`CHAN_EXIT_PATH=5m` 退出、沉淀资金池过滤；保证可执行与可审计，**本身不产生 alpha**。

`fundamental_chan` 即该分工的代码化身：哲学方向为主 gate，五法则软评分，执行规则锁定。下文「哲学原则」「原则栈」是常量层之上的变量层与桥接细节。

## 哲学原则（权威）

1. **基本面为主，五法则为辅** — 大宗走势研判 / 哲学 filter 方向是主信号；五法则仅加分/减分，仿真不作硬拦截
2. **按预测方向在 S/R 入场** — 看涨 → 在 5m/15m/1h 最近支撑开多；看跌 → 在最近阻力开空
3. **止损** — 品种相关；**沪金 au 已锁定 500 元/手**；**ag 已锁定 300 元/手（20 元/千克）**；**rb 已锁定 3 价格点**（见下表）
4. **止盈** — 同周期阻力（多）/ 支撑（空）；缠论 S/R 近似
5. **无阻力则持有** — 直至价格跌破下一支撑（同 TF）→  trailing 止盈
6. **盈利保护** — 持仓盈利时调整 trailing 支撑：**au 500 元/手**；**ag 400 元/手（SL×4/3）**；**rb 4 价格点**
7. **频次** — 每品种每 baselineDate 最多 1 次往返
8. **贵金属佣金优化** — au/ag 佣金已按方正中期标准建模（不减费率）；`QUANT_PRECIOUS_MIN_RR`（默认 2.0）跳过 R:R 不足的 setup，降低止损 churn 与佣金拖累
9. **Trail 扩展** — `CHAN_TRAIL_ARM_RATIO`（默认 0.67）缩放 trail 盈利保护距离；路径触及半阈值即提前 arm（POINT_CONFIG au 500¥/手不变）

## 原则栈（执行顺序）

```
哲学/研判方向 (filterPass + bullish|bearish)
    ↓ 主 gate（fundamental_chan 模式放行）
缠论多周期 S/R 入场 (5m → 15m → 1h 优先)
    ↓ 等待 touch 支撑/阻力
五法则评分 → sizeMultiplier（0.7–1.0×，非硬 block）
    ↓
区间带 band → sim: advisory + 0.9×；live: 硬 block
    ↓
Model C / OI → live 徽章 only（sim 不依赖交集）
```

## 模式开关

| `QUANT_MODE` | 说明 |
|--------------|------|
| `fundamental_chan` | **新默认（探针/回测）** — 研判方向驱动 + 日内 S/R |
| `model_c_gate` | Legacy — Model C 交集 + 五法则硬 gate |

### 沉淀资金过滤（用户规则）

| 项 | 值 |
|----|-----|
| 下限 | **40 亿元**（`MIN_DEPOSIT_YUAN = 4e9`） |
| 公式 | `openInterest × close × multiplier` |
| 数据源 | 日 K（`history/trading/{id}.json` 或 `klines/commodity-{id}-day.json`）最近一根含 OI 的 bar |
| 应用点 | `getFundamentalChanPool()`、`quant-trading-simulator.runBacktest` 默认池、探针脚本 |

无 OI 或估算沉淀资金低于 40 亿的品种从 fundamental_chan 池剔除；排除名单与数值见探针日志 `[deposit-filter]` 或 summary JSON `depositFilter.excluded`。

### 永久黑名单（`QUANT_INSTRUMENT_BLACKLIST`）

| 品种 | 原因 |
|------|------|
| **ec** | TP 定价 bug；2023–2025 探针 −179k 拖累（排除后 +25.9%→+43.8%） |

池级过滤，与沉淀资金过滤独立；探针/回测/simulator 默认池均经 `getFundamentalChanPool()`。**Archive（2026-06-25 P0 探针后）**：`trades.jsonl` 已由 `probe-fundamental-chan-quant.js` 全量替换为 **10,028** 笔（56 品种、ec 仍黑名单；243a9d49 修复 20:55 夜盘收市与 S/R 方向）。`_quant-trading-backtest-summary.json` 仍为 pre-P0 **+97.96% / 10,212** 快照；UI 若读该文件需另跑 `run-quant-trading-backtest.js` 或改读 `_probe-fundamental-chan-quant-summary.json`。

原始池（仅 K 线 ≥60）可用 `getFundamentalChanPool({ skipDepositFilter: true })` 或 `getFundamentalChanPoolRaw()` 查看（约 72 品种）；沉淀资金过滤后约 57 品种，黑名单后约 **56** 品种（2026-06 数据快照，随 OI/价格变动）。

```powershell
$env:QUANT_MODE = 'fundamental_chan'
$env:FANCHENG_DATA_DRIVE = 'E'
node scripts/probe-fundamental-chan-quant.js
```

## 入场 / 止损 / 止盈规则

| 步骤 | 多 | 空 |
|------|----|----|
| 信号 | 哲学 filter 通过 + 方向看涨 | 同理看跌 |
| 入场 TF | 依序尝试 5m → 15m → 1h | 同左 |
| 入场价 | 最近支撑 | 最近阻力 |
| 止损 | entry − SL 距离 | entry + SL 距离 |
| 止盈 | 同 TF 阻力 | 同 TF 支撑 |
| 无 TP 位 | 持有至跌破 trailing 支撑（盈利保护豁免） | 对称 |

### 点值约定

#### 沪金 au（已锁定，2026-06-18）

| 参数 | 值 | 价格距离 | 说明 |
|------|-----|----------|------|
| `stopLossYuan` | **500 元/手** | **0.5 元/克** | `500 ÷ multiplier(1000)` |
| `profitExemptYuan` | **500 元/手** | **0.5 元/克** | 多单：支撑下移 0.5；空单：支撑上移 0.5 |

换算：`价格距离 = 元/手 ÷ 合约乘数`；沪金 1 手 = 1000 克，报价元/克，故 500 元/手 = 0.5 元/克价格波动。

旧默认（3 ticks × 0.02 = 0.06 元/克 SL，4 ticks = 0.08 盈利保护）已废弃。

#### ag（已锁定，用户确认 2026-06-18）

| 参数 | 值 | 价格距离 | 说明 |
|------|-----|----------|------|
| `stopLossYuan` | **300 元/手** | **20 元/千克** | `300 ÷ multiplier(15)` |
| `profitExemptYuan` | **400 元/手** | **≈26.67 元/千克** | SL×4/3（保持原 3:4 价格点比例） |

#### rb（已锁定，用户已确认 2026-06-18）

| 品种 | 乘数 | SL | 等价元/手 | 盈利保护 | 等价元/手 | 备注 |
|------|------|-----|-----------|----------|-----------|------|
| **rb** | 10 吨/手 | **3 元/吨** | **30 元/手** | 4 元/吨 | **40 元/手** | `unit: 'price'`，3 价格点 |
| **cu** | 5 吨/手 | 3 ticks = **30 元/吨** | 150 元/手 | 40 元/吨 | 200 元/手 | tick 模式；未纳入 live P0 |

配置：`services/chan-multitf-levels.js` → `POINT_CONFIG`

### 调参（2026-06-25）

| 变量 | 默认 | 说明 |
|------|------|------|
| `QUANT_PRECIOUS_MIN_RR` | `2.0` | au/ag 最低 reward:risk；`0` 关闭 |
| `CHAN_TRAIL_ARM_RATIO` | `0.67` | trail 盈利保护距离缩放（au 500¥/手配置不变） |

## 研判方向如何喂给量化

1. `commodity-outlook-backtest.predictAtBarIndexHistorical` 产出 `philosophyFilter` + `predictedDir`
2. `trading-rules-quant-gate.evaluateFundamentalChanGate`：
   - 主方向 = `philosophyFilter.effectivePhilosophyDir` 或 outlook `predictedDir`
   - **不要求** Model C `sameSign` / `tradableForSim`
3. `quant-trading-simulator.simulateFundamentalChanTrade`：
   - `chan-multitf-levels.findEntryLevel` + `simulateIntradayExit`

## 缠论简化（诚实说明）

| 完整缠论 | Phase 1 实现 |
|----------|--------------|
| 笔、段、中枢 | **未实现** — pivot high/low 聚类 |
| 多级别联立 | 5m/15m/1h **独立**检测，按 TF 优先选入场 |
| 实时分钟 K | **多数品种无** — 见数据节 |

## 数据可用性（E 盘）

| 数据 | 路径 | au/ag/rb | 用途 |
|------|------|----------|------|
| 日 K | `data/klines/commodity-{id}-day.json` | ✅ 全历史 (~1806) | S/R pivot、session OHLC 路径 |
| 小时 K | `data/klines/commodity-{id}-hour.json` | ✅ tick 2023–2025 + EM 近 ~1 年 | 1h S/R、5m/15m 派生 fallback |
| 15m / 5m | `commodity-{id}-15m.json` / `-5m.json` | ✅ tick 2023–2025（84k+ 5m bars） | 缠论多周期入场优先数据源 |
| 日 K 代理 | `history/trading/{id}.json` | ✅ | 方向审计同源 |

**Tick 分钟/小时回填**（全品种 catalog 默认，2023-01-01–2025-12-31；P0 au/ag/rb 已完成）：

```powershell
$env:FANCHENG_DATA_DRIVE = 'E'
npm run backfill-tick-intraday
# 或仅 P0：node scripts/backfill-tick-intraday.js --instruments au,ag,rb --from 2023-01-01 --to 2025-12-31
```

**日更 EM 增量**（P0 = au/ag/rb/cu；与 tick 历史合并，不覆盖 2023–2025）：

```powershell
$env:FANCHENG_DATA_DRIVE = 'E'
node scripts/sync-intraday-klines.js
# 或纳入日更：daily-data-sync 步骤 intraday_klines（TTL 1h）
```

**OOS 探针基线**（2023–2025，634 trades）：

| 快照 | 文件 | return | 说明 |
|------|------|--------|------|
| tick 回填前 | `_probe-fundamental-chan-quant-summary-pre-tick-backfill.json` | +168.26% | EM-only 分钟 K，偏乐观 |
| tick 回填后 | `_probe-fundamental-chan-quant-summary.json` | **-2.34%** | 真实 tick 分钟 K，当前基线 |

```powershell
FANCHENG_DATA_DRIVE=E node scripts/probe-fundamental-chan-quant.js
```

**Fallback 链（入场 S/R）**：5m/15m 缓存 → hour 派生 → session 日 bar OHLC 四段路径。

**Exit 路径**（`CHAN_EXIT_PATH`，默认 `5m`）：5m tick bar 序列 → hour 派生 → 日 K OHLC 四段代理。强制日 K 代理：`CHAN_EXIT_PATH=daily` 或 `CHAN_FORCE_DAILY_PROXY=1`。调试日志：`CHAN_EXIT_PATH_LOG=1`。

**合并规则**：`source=tick-zips-sync` 的 bar 在 EM ~1 年窗口外保留；窗口内 EM 增量覆盖；日更 `intraday_klines` 不会整文件替换 tick 历史。

## Phase 计划

| Phase | 内容 | 状态 |
|-------|------|------|
| **1** | 架构 + gate 重构 + 日 K 代理 intraday + 探针 | ✅ 当前 |
| **2** | 5m/15m/1h 真实 K 线抓取与缓存 | ✅ P0 同步已实现 |
| **3** | 笔/段级缠论 S/R；live daemon 日内挂单逻辑 | 待做 |
| **4** | UI 实时 S/R 图；用户可配 SL/TP 点值 | 待做 |

## 相关文件

- `services/quant-trading-margin.js` — 合约规格、**沉淀资金池过滤**
- `services/chan-multitf-levels.js` — S/R + intraday 仿真
- `services/trading-rules-quant-gate.js` — `QUANT_MODE`
- `services/quant-trading-simulator.js` — 双模式仿真
- `scripts/probe-fundamental-chan-quant.js` — OOS 探针
- [QUANT_TRADING.md](./QUANT_TRADING.md) — 运维 / UI / 存档
