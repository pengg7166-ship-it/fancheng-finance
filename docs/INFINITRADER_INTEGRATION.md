# 梵澄金融 × 无限易模拟 — 接入指南

> **安全：** 模拟账号密码仅在无限易客户端内输入，**切勿**写入仓库、bat 或脚本。聊天中暴露过的密码请尽快修改。

## 当前状态

| 能力 | 状态 |
|------|------|
| 大宗走势研判 + 量化 gate | ✅ 本地完整 |
| 纸面仿真 / 9,726 笔 baseline | ✅ |
| 自动 CTP / 无限易下单 | ⚠️ PythonGO 策略已提供，需用户在无限易内部署 |
| **每日信号 outbox** | ✅ `scripts/export-daily-signals.js` |
| daemon 56 品种池 + gateOut | ✅ 已修复 |

## 今日工作流（手动 + 信号文件）

### 1. 无限易模拟登录

1. 打开 **无限易模拟 Beta x64**
2. 选择与您账号匹配的仿真站点（QuantFair / SimNow / 经纪商仿真）
3. 在客户端内输入账号密码（不要写入梵澄配置）

### 2. 启动梵澄金融

```text
E:\FanchengFinance\启动梵澄金融-安全.bat
```

看盘：**大宗走势研判**（方向、可交易徽章）→ **量化交易**（S/R、止损、仿真成交）。

### 3. 导出当日待执行信号（outbox）

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
$env:QUANT_MODE = "fundamental_chan"
node scripts/export-daily-signals.js
```

仅严格 live 徽章（保守）：

```powershell
node scripts/export-daily-signals.js --live-tier-only
```

指定 baseline 日：

```powershell
node scripts/export-daily-signals.js --date 2026-06-25
```

产出目录：`E:\FanchengFinance\data\outbox\signals\`

**诚实说明（重要）：**

- **56 品种池 ≠ 56 条信号/日。** `export-daily-signals.js` 遍历 `getFundamentalChanPool()`（当前 **56** 个品种），但只写出 **quant gate 通过** 且 **有明确方向** 的品种；多数交易日 outbox 可能 **0 条或个位数**。
- **合约月份** 由 `main-contract-resolver` 按东方财富 OI/成交量选 **主力合约**（无限易 M 标记），**不是** `delivery-calendar` 固定偏移。
- **勿将 `fixtures/sample-signals.jsonl` 复制到 outbox 目录** — 该文件仅供 loader CLI 本地校验；生产 outbox 必须来自 `export-daily-signals.js`。
- 日 K 未同步到 baseline 日时导出为空；baseline 须 ≤ 本地 K 线最新交易日（当前约 **2026-06-16**），且须存在 **下一交易日** bar（forward signal 的 `sessionDate`）。

全池 56 品种首次导出约 **10–30 分钟**（逐品种跑 outlook 链）；可用 `--id au,ag,rb` 快速试跑。

| 文件 | 内容 |
|------|------|
| `signals-YYYY-MM-DD.jsonl` | 每行一条 forward signal |
| `signals-YYYY-MM-DD-manifest.json` | 摘要 |

信号 JSON 关键字段：

- `infinitraderSymbol` / `contractCode` — 无限易合约搜索（**主力合约**，东财 OI 解析；SHFE/DCE 小写如 `au2608`，郑商所大写如 `CF609`）
- `direction` — long / short
- `entryHint.price` / `stopLoss.price` — 参考价与止损
- `gates.tradableForLive` — 是否 strict live 子集

### 4. 在无限易执行

1. 打开 outbox JSONL，按 `infinitraderSymbol` 订阅行情
2. 夜盘前（~20:50）对照 `direction` + `entryHint` + `stopLoss` 挂限价/条件单
3. 模拟盘建议先用 **1 手** 验证
4. 郑商所（zce）注意 **大写** 合约代码（如 `CF608`，1 位年 + 2 位月）

### 5. 盘后对照

- 无限易成交 vs 梵澄仿真 `trades.jsonl`
- 历史成交 CSV：`E:\交易记录\`（UI 导出）
- PythonGO 成交 JSONL：`E:\FanchengFinance\data\outbox\sim-trades\infinitrader-trades.jsonl`

---

## 收益率检验（无限易模拟 × 梵澄）

> **目的唯一：** 验证集成后能否在 forward 窗口内**盈利**，而非复现本地回测 **+102.26% / 9,726 笔**。

### 能验证什么 / 不能验证什么

| 类别 | 说明 |
|------|------|
| **不能** | 在无限易模拟中复现本地 **+102%**（2023–2025 全样本）。本地含 5m intraday 触价退出、统一滑点假设、历史主力连续合约；PythonGO 为 **限价入场 + tick 止损**，无 5m TP/收盘规则。 |
| **不能** | 用单日 DryRun 日志判断长期收益率。 |
| **能** | **Forward**：每日 outbox → 无限易成交 → 账户权益曲线 vs 同期梵澄 paper daemon。 |
| **能** | **短窗对照**：同一 `baselineDate` 的 outbox 信号 vs 本地 `simulateTrade` / daemon 写入的 `trades.jsonl`（方向、笔数、入场价偏差）。 |
| **能** | **执行质量**：滑点、成交率、止损触发是否与 `trades.jsonl` 的 `slippageTicks` / `exitType` 同量级。 |

### 建议指标

| 指标 | 本地来源 | 无限易来源 |
|------|----------|------------|
| 收益率 % | `trades.jsonl` 汇总 / daemon `capitalAfter` | 模拟账户权益 ÷ 初始资金 |
| 胜率 | archive `hit` / pnl>0 | 平仓盈亏笔数比 |
| 成交笔数 | 按 `--from/--to` 过滤 archive | 成交 CSV 或 PythonGO JSONL |
| 滑点 | `slippageTicks` 字段 | 成交价 − `entryHint.price` |
| 信号一致率 | outbox `direction` | 无限易开仓方向 + memo `fancheng:{id}:{date}` |

### 对账脚本

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"

# 仅看本地 paper 窗口（daemon/回测 archive）
node scripts/reconcile-sim-pnl.js --from 2026-06-20 --to 2026-06-26

# 叠加无限易导出 CSV（客户端 → 成交记录 → 导出 UTF-8）
node scripts/reconcile-sim-pnl.js --from 2026-06-20 --to 2026-06-26 `
  --sim-csv E:\交易记录\无限易成交.csv `
  --out E:\FanchengFinance\data\outbox\sim-trades\reconcile-report.json
```

### 如何判断「集成有效、能赚钱」

1. **技术集成 OK**：PythonGO 重载无报错；DryRun 日志合约/方向/价格与 outbox 一致；Live 1 手能成交且 JSONL 有记录。
2. **执行 faithful OK**（2–4 周 forward）：无限易成交笔数 ≈ outbox 可交易信号数（±未成交限价）；方向一致率 **>90%**；平均入场滑点 **≤ 本地假设 + 2 tick**。
3. **盈利 OK**（同一 forward 窗口）：模拟账户 **累计收益率 > 0** 且不低于同期梵澄 paper daemon 的 **50%**（允许执行损耗）；若连续 2 周跑输 daemon **>5pp**，先查未成交/止损/合约换月，再谈策略。

评估期建议 **≥2 周、最好 4 周**；**不要用 1 个交易日**下结论。

---

## 操作手册（收益率检验专用）

### 阶段 A：环境（一次性）

#### A1. PythonGO v2 运行环境（官方）

参考：[安装运行环境](https://infinitrader.quantdo.com.cn/pythongo_v2/python_install)

1. 确认无限易版本号为 **`v2` 开头**（64 位）→ 下载 **64 位** PythonGO 安装包。
2. 解压得到 `python-3.12.*.exe`、`requirements.txt`、`安装依赖.exe` 等。
3. 运行 **Python 3.12** 安装程序；若提示 `Disable path length limit`，请点击。
4. 双击 **安装依赖.exe**（360 拦截选允许；失败则用 **安装依赖-备用.bat**）。
5. 无限易客户端：**量化 → PythonGO** → 打开 **策略引擎** → 切换版本为 **v2**。

#### A2. 策略文件部署

```powershell
cd E:\FanchengFinance\source\fancheng-finance
powershell -ExecutionPolicy Bypass -File scripts/deploy-pythongo.ps1
```

策略目录（与 `demo/`、`ctaTemplate.py` 同级）：

- `%APPDATA%\InfiniTrader_SimulationBetaX64\pyStrategy\`
- （若用其他实例）`%APPDATA%\InfiniTrader_QhFangzhengzhongqi\pyStrategy\`

**重载：** PythonGO → **策略管理** → **重载** → 列表中出现 **`fancheng_outbox_strategy`**（不在 demo 子目录）。

重载失败见 `scripts/infinitrader-pythongo/TROUBLESHOOT.md`（常见：`CtaTemplate` 旧版 → 已改为 `BaseStrategy` v2）。

#### A3. 模拟登录与实例

1. 打开 **无限易模拟 Beta x64**，在客户端内登录（账号如 `18035825630`；**密码勿写入任何文件**）。
2. **实例管理 → 新建实例** → 策略 `fancheng_outbox_strategy`。
3. 参数：`outbox路径`、`DryRun演练=1`、`最大手数=1`、`成交日志路径`（默认即可）。

### 阶段 B：每日工作流

| 时间 | 动作 |
|------|------|
| **~15:05**（日盘收市后） | 导出当日 outbox（见 §3） |
| **15:05–20:50** | 可选：本地 paper daemon `--watch`（独立对照组） |
| **~20:50**（夜盘前） | PythonGO：**DryRun=1** 运行 → 核对 `[梵澄]` 日志 |
| 核对通过后 | `DryRun演练=0`，**最大手数=1**，点击 **运行** |
| **次日 / 周末** | 导出无限易成交 CSV；运行 `reconcile-sim-pnl.js` |

```powershell
$env:FANCHENG_DATA_DRIVE = "E"
$env:QUANT_MODE = "fundamental_chan"
node scripts/export-daily-signals.js
# 保守：node scripts/export-daily-signals.js --live-tier-only
```

### 阶段 C：PnL 跟踪

| 数据源 | 路径 / 方式 |
|--------|-------------|
| 无限易账户权益 | 客户端资金栏 / 结算单 |
| 梵澄 paper | `E:\FanchengFinance\data\history\quant-trading-archive\trades.jsonl` |
| PythonGO 成交 | `E:\FanchengFinance\data\outbox\sim-trades\infinitrader-trades.jsonl` |
| 无限易导出 | `E:\交易记录\`（UTF-8 CSV） |
| 对账报告 | `node scripts/reconcile-sim-pnl.js ... --out ...` |

### 阶段 D：评估期

- **最短 2 周** forward（含夜盘 + 换月周）。
- 每周记录：收益率、笔数、胜率、信号一致率、未成交限价单数。
- 第 4 周汇总：与 daemon 同期对比，决定是否加大手数或继续 DryRun 排查。

---

## 纸面 daemon（可选，与无限易独立）

```powershell
$env:FANCHENG_DATA_DRIVE = "E"
$env:QUANT_MODE = "fundamental_chan"
node scripts/quant-trading-daemon.js --watch
```

窗口：15:00–15:30 / 20:50–21:10（CN）。写入 E 盘 archive，**不向无限易发单**。

## 自动化路径（PythonGO 自动下单）

已实现：**PythonGO 策略**读取 `data/outbox/signals/*.jsonl` 并自动挂限价单 + tick 止损监控。

| 文件 | 说明 |
|------|------|
| `scripts/infinitrader-pythongo/fancheng_outbox_strategy.py` | 无限易策略主类 |
| `scripts/infinitrader-pythongo/signal_loader.py` | JSONL 加载 / 过滤 / 去重 |
| `scripts/infinitrader-pythongo/README.md` | 安装与参数说明 |
| `scripts/export-pythongo-config.js` | 生成本地 config（无账号密码） |

### 快速部署（无限易）

1. **导出 outbox**（见上文 §3）。
2. 可选：`node scripts/export-pythongo-config.js` 生成 `pythongo_config.json`。
3. 将 `signal_loader.py` + `fancheng_outbox_strategy.py` 复制到无限易 PythonGO 策略目录（或运行 `scripts/deploy-pythongo.ps1`）。
4. 新建策略实例，参数建议：
   - `outbox路径` = `E:\FanchengFinance\data\outbox\signals`
   - `DryRun演练` = **1**（首次只打日志）
   - `仅Live徽章` = 1（保守）或 0（含 sim 徽章）
   - `最大手数` = **1**
   - `成交日志路径` = `E:\FanchengFinance\data\outbox\sim-trades\infinitrader-trades.jsonl`
5. 核对日志中的合约/价格后，将 `DryRun演练` 改为 **0**，夜盘前点击运行。

### 策略行为摘要

- 读取最新 `signals-*.jsonl`，按 `instrumentId + baselineDate` 去重。
- 有效 `entryHint.price` → 限价 `buy`/`short`；无效 entry 跳过。
- `stopLoss.price` 在 `onTick` 中监控，触发时 `auto_close_position`（需客户端在线）。
- `on_trade` 追加 JSONL 成交日志（供 `reconcile-sim-pnl.js`）。
- 所有日志带 `[梵澄]` 前缀。

### 收益率对账

```powershell
node scripts/reconcile-sim-pnl.js --from 2026-06-20 --to 2026-06-26 --sim-log E:\FanchengFinance\data\outbox\sim-trades\infinitrader-trades.jsonl
```

详见上文 **「收益率检验」** 章节。

### 本地校验（无需无限易）

```powershell
cd scripts/infinitrader-pythongo
python signal_loader.py --fixture fixtures/sample-signals.jsonl
python signal_loader.py --outbox E:\FanchengFinance\data\outbox\signals
```

### 后续

1. **ZMQ / 文件夹轮询** — outbox 变更热更新
2. **Phase 3** — 盘中 5m S/R 触价 watcher + 执行层

## 相关文档

- `docs/HANDOFF_2026-06-25.md` — baseline 运维
- `docs/JOINQUANT_INTEGRATION.md` — 外部执行层（历史回放范例）
- `docs/QUANT_TRADING_FUNDAMENTAL_CHAN.md` — 策略架构
