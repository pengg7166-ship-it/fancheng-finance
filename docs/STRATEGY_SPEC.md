# 策略规格 · 三时段 export + 缠论入场

> 与 `QUANT_MODE=fundamental_chan`、forward-export 自动化、`DemoFanchengOutbox` 对齐。  
> 自动化细节见 [FORWARD_AUTOMATION.md](./FORWARD_AUTOMATION.md)。

## 1. 分层

| 层 | 职责 | 代码 |
|----|------|------|
| **变量层 / 基本盘** | 大宗走势研判方向 + 三时段预测区间 | `commodity-outlook-engine`、slot-snapshots |
| 技术层 | 缠论 S/R 结构入场 | `chan-multitf-levels.js` + `entry-philosophy-map.js` |
| **Gate** | 五法则 + Model C + 区间 advisory | `trading-rules-quant-gate.js` |
| **执行层** | 56 池筛选、1 手、最多 5 笔/品种/时段 | `DemoFanchengOutbox.py`（`on_bar_touch` 或 `fixed_limit`） |

## 2. 定时 export（CN）

| 时刻 | forward `--slot` | outlook 预测槽 | 产出文件名示例 |
|------|------------------|----------------|----------------|
| **20:58** | `night_prep` | `pre-night` (20:55) | `signals-YYYY-MM-DD-night_prep.jsonl` |
| **08:58** | `day_prep` | `pre-day` (08:55) | `signals-YYYY-MM-DD-day_prep.jsonl` |
| **01:28** | `early_morning` | `pre-night`（同 session 夜盘/凌晨段） | `signals-YYYY-MM-DD-early_morning.jsonl` |

App 内三时段捕获时刻为 **20:55 / 08:55 / 13:25**（`outlook-prediction-slots.js`）。  
`13:25 pre-afternoon` 用于 UI 校验与存档；forward **01:28** 段复用当 session 的 **pre-night** 区间（贵金属 21:00–02:30）。

## 3. 三时段预测数据路径

用户刷新「大宗走势研判」后，App 写入：

```
{FANCHENG_DATA_DRIVE}/FanchengFinance/data/outlook-history/slot-snapshots/{sessionDate}/{slotId}.json
```

- `slotId`: `pre-night` | `pre-day` | `pre-afternoon`
- 每文件含 `instruments[]`：`predictedLow` / `predictedHigh` / `direction` 等

**刷新流程**（路径与 export 一致，无需额外配置）：

1. 打开梵澄金融 App（electron 启动 `outlook-slot-scheduler`，每分钟检测 CN 时间）
2. 进入「大宗走势研判」页并**刷新**（更新 `commodity-outlook-v4.json` 内存/磁盘缓存）
3. 到达捕获时刻 **20:55 / 08:55 / 13:25** 时 scheduler 自动调用 `captureOutlookPredictionSnapshot` 写入上表目录
4. 若 App 未运行错过时刻，可用 `scripts/capture-outlook-slot.js` 或 `backfill-slot-snapshots-from-history.js` 补抓

**Export 读取顺序**（`services/outlook-slot-export.js`）：

1. 上表 slot-snapshot（按 forward slot 映射）
2. 回退 `commodity-outlook-v4.json`（用户数据目录 cache，App 刷新后更新）
3. 仍无区间时，Chan 层回退 `intraday-range-predictor`（非三时段口径，manifest 会标注 `rangeSource`）

## 4. 入场规则（用户哲学 · 2026-07-01）

**方向判断（最难）**：大宗走势研判定多空；期货 **做多做空均可**。

| 条件 | 行为 |
|------|------|
| 日线 **或** 大级别 neutral | **不做** |
| 日线与大级别 **同向** | **仅日内** 5m/15m/1h（不做日 K 大级别入场） |
| 日线与大级别 **冲突** | **跟日线** 做日内；TP/SL 规则不变 |

| 研判层级 | 方向来源 | 入场策略 | 扫描周期 |
|----------|----------|----------|----------|
| **日线** | 三时段 **slot-snapshot** `direction` | 逢低/逢高 | 5m → 15m → 1h |
| **大级别** | `horizons.medium`（1–4 周） | 仅作门控，不单独开日 K 仓 | — |

- **日线方向**：`outlook-slot-export` 读 slot-snapshot 的 `direction`（**非** composite 单独）
- **大级别方向**：`commodity-outlook-v4` 单品种 `medium.direction`
- **filterPass=false**：仍信任 gate **大宗主方向** `primaryDirection`，不单独阻断 export
- **五法则**：逢低/逢高 export **必须** `fiveLaws.pass === true`

**入场价必须来自结构，predLow/predHigh 仅作区间过滤：**

1. 做多：现价 **下方** 最近支撑（`nearestLevelBelow`），须 reachable（≤ `CHAN_ENTRY_MAX_ATR_RATIO`×ATR20，默认 **2.5**）
2. 做空：现价 **上方** 最近阻力（`nearestLevelAbove`），同上偏差门控
3. 各周期均无有效 S/R → **跳过该品种**（`no_valid_sr_level`），**禁止** predLow/predHigh 机械 fallback
4. 拒绝 `range-fallback-only` / `daily-proxy` / `no-structure` 弱数据源；无真实分钟/小时 K 时不合成 daily-proxy

**止损**（`chan-multitf-levels` POINT_CONFIG + 乘数）：

- **导出池全品种**：默认 **300 元/手** per-instrument 固定止损（`resolvePointDistance` 默认）；显式配置优先
  - au 500 元/手、ag 300 元/手、rb 3 元/吨、cu/ni/sn 300 元/手等
- 做多：止损在入场价 **下方**；做空：止损在入场价 **上方**
- 已达配置 SL 宽度的品种 **跳过** ATR 窄止损过滤

**止盈**：同周期 S/R 对面位（jsonl `entryHint.takeProfitHint`）；**无限易侧仍须手动或后续实现 TP 单**

## 5. 执行常量

- 池：56 品种 `getFundamentalChanPool()`
- 每笔 **1 手**（`lotsSuggested: 1`）
- 同 `instrumentId + sessionDate + exportSlot` 最多 **5 笔**（jsonl 可含多条 `signalKey`；export 按 5m/15m/1h + 额外 S/R 去重后写入）
- **默认** `OUTBOX_RUNTIME_MODE=on_bar_touch`：export 输出方向+止损规则+outlook，**无限易 runtime** 用 live 5m/15m/1h K 线检测结构触价后发 GFD
- legacy `fixed_limit`：`OUTBOX_RUNTIME_MODE=fixed_limit`，export 含 `entryHint.price`，策略 `on_start` 直接挂限价
- GFD 限价等触价（`use_market_order=0`）

## 6. 用户操作清单

1. PC 在线，已安装 forward-export 计划任务（见 FORWARD_AUTOMATION.md）
2. **每个 export 时点前** 打开梵澄金融 → **刷新「大宗走势研判」**（更新 v4 缓存并触发 slot 快照调度）
3. 确认 `data/outlook-history/slot-snapshots/{今日 sessionDate}/` 有对应 `pre-night.json` / `pre-day.json`
4. 任务跑完后检查 `data/outbox/signals/signals-*-{slot}.jsonl`
5. 无限易：**重载** `DemoFanchengOutbox` → 设置 `session_date` + `export_slot` 匹配当前槽 jsonl（或留空用 mtime 最新）→ `K线触价模式=1`（on_bar_touch）→ `dryRun=0` → `maxLots=1`
6. **验证执行（勿反复重启）**：`Get-Content E:\FanchengFinance\data\outbox\sim-trades\strategy-heartbeat.json` 看 `lastTickTime` / `netPositions` / `lastAction` / `touchEntryCount` / `runtimeMode`

## 7. Export 质量门（写 jsonl 前）

| 规则 | 槽位 | 行为 |
|------|------|------|
| 无夜盘品种 | `night_prep` / `early_morning` | 跳过（lh/ap/jd 等） |
| 滑点谨慎名单 | 夜盘槽 | `sn`/`pg` 跳过 |
| 滑点谨慎名单 | `day_prep` | 每品种最多 1 笔（signalSeq≥1 跳过） |
| 哲学 filter | 全部（strict） | `filterPass !== true` **且** 无 `primaryDirection` 时跳过 |
| 五法则 | 全部（strict） | `fiveLaws.pass !== true` 跳过（逢低/逢高须确认） |
| 研判强度 | 全部（strict） | \|compositeScore\| < 0.12 跳过 |
| 弱入场源 | 全部（strict） | `range-fallback-only` / `daily-proxy` / `no-structure` 一律跳过 |
| 入场过远 | 全部（strict） | 入场价距现价 > `CHAN_ENTRY_MAX_ATR_RATIO`×ATR20 跳过 |
| 止损过窄 | 未达配置 SL 宽度 | 止损距 < 0.35×ATR(20) 跳过 |
| 固定止损品种 | 全部导出池 | 默认 300 元/手；显式 POINT_CONFIG 优先（跳过 ATR 窄止损门） |

配置：`services/outbox-export-filters.js` · `OUTBOX_STOP_MIN_ATR_RATIO` · `OUTBOX_STRICT_GATES=0` 可关闭 strict 门。

## 8. 已知限制

| 项 | 说明 |
|----|------|
| 无限易 TP | 策略仅自动止损；止盈/移动止损在本地 sim，实盘需手动 |
| on_bar K 线 | 依赖 PythonGO `KLineGenerator`（M5/M15/H1）；历史 K 线 ≤30 天；S/R 为 pivot 聚类近似 |
| fixed_limit 回退 | `OUTBOX_RUNTIME_MODE=fixed_limit` + 策略 `K线触价模式=0` 恢复旧行为 |
| 多笔 Chan 入场 | on_bar_touch：runtime 5m→15m→1h 触价最多 5 笔；fixed_limit：export 预计算 entryHint |
| pre-afternoon | UI/存档 13:25 独立槽；01:28 export 不单独读 pre-afternoon |
| 重启对账 | `on_start` 从柜台持仓恢复已发单键；心跳文件供外部巡检 |

---

*2026-07-01 · slot-snapshot 日线 + medium 门控 + 仅日内入场 + 全池固定 SL*

---

## 9. DemoMaCross1020 — 纯 MA 金叉/死叉（无限易独立策略）

> 与 outbox / 缠论 export **完全分离**；在无限易 5m K 线上自算 MA10/MA20，仅供模拟测试。
> **支持 74 主力全池**：每品种独立 K 线 / MA / 持仓（单品种 max_lots=1）。

| 规则 | 实现 |
|------|------|
| 周期 | 默认 `5m`（`KLineGenerator` style=M5） |
| 做多 | MA10 上穿 MA20（收盘判定金叉）→ 买 1 手 |
| 做空 | MA10 下穿 MA20（收盘判定死叉）→ 卖 1 手 |
| 止损 | 入场价 ± `stop_points` × `price_tick`（默认 3 点） |
| 止盈 | 后续 K 线 **low ≤ MA10 ≤ high** 触线后，挂 TP = MA10 ∓ `tp_offset_points`（默认 2 点）；tick 触价平仓 |
| 仓位 | **每品种** 同时仅 1 笔；持仓中不反手 |

**合约配置（三选一，优先级：instrument_ids > instrument_id > use_all_main）**

| 参数 | 默认 | 说明 |
|------|------|------|
| `use_all_main` | `0` | `1` = 从数据盘加载全部主力（见下） |
| `instrument_ids` | *(空)* | 逗号/分号分隔，如 `rb2610,au2608` 或 `SHFE:rb2610;DCE:m2609` |
| `instrument_id` | *(空)* | 单合约 legacy，如 `rb2610`（须配 `exchange`） |
| `exchange` | *(空)* | 单交易所缺省；`instrument_ids` 含 `EXCHANGE:symbol` 时可留空 |
| `max_instruments` | `74` | 订阅上限（交易所限制时可改 `56` 等） |
| `main_contract_map_path` | *(空)* | 自定义 JSON；默认读 `E:\FanchengFinance\data\main-contracts-pythongo.json` |

**主力映射刷新（全池前必做）**

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
node scripts/export-ma-cross-instruments.js
# 可选: --max 56  或  --force-main  强制刷新东财 OI
```

输出：`E:\FanchengFinance\data\main-contracts-pythongo.json`（含 exchange + infinitraderSymbol × 74）。
策略启动时 StraLog 打印 `已订阅 N/M 合约` 及订阅列表前 8 项。

**参数要点**

- `points_as_price=0`（默认）：「点」= 最小变动价位 tick 的倍数（如 rb tick=1 → 3 点 = 3 元）
- `points_as_price=1`：stop/tp 参数为绝对价差（元）
- `price_tick=0`：按合约前缀自动推断；务必与交易所最小变动价一致
- 首次运行 **`dry_run=1`**，确认 StraLog 后再改 `0`

**实例参考**：`scripts/infinitrader-pythongo/instances/pp1.json`（`use_all_main=1`, `dry_run=1`）

**部署**：`powershell -ExecutionPolicy Bypass -File scripts/deploy-pythongo.ps1` → 无限易 PythonGO 重载 → `demo/DemoMaCross1020`

**文件**：`scripts/infinitrader-pythongo/DemoMaCross1020.py` · `scripts/export-ma-cross-instruments.js`

**已知限制**：MA 基于 KLineGenerator 收盘 K（≤30 天历史）；止盈在触 MA10 的 **收盘 K 线** 后才挂出；74 合约同时订阅可能受柜台/模拟盘连接数限制，可用 `max_instruments` 分批。

