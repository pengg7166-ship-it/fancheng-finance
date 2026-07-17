# 梵澄金融 · 产品哲学：变量层与常量层

> **定位**：梵澄金融的核心产品方向，不是某次回测调参结论，而是「什么该每天变、什么该固定不变」的分工原则。  
> **关联文档**：[会话交接 HANDOFF](./HANDOFF_2026-06-25.md) · [量化 fundamental_chan 架构](./QUANT_TRADING_FUNDAMENTAL_CHAN.md) · [无限易接入](./INFINITRADER_INTEGRATION.md)

---

## 一、用户洞察：为什么「固定策略模板」会失败

大宗商品与宏观环境每天都在变：政策口径、突发新闻、情绪、持仓结构、跨资产联动——**真正带来超额认知的是对这些信息的持续综合**，而不是一套写死在代码里的「若 A 则 B」模板。

历史上常见的失败模式：

1. **把研判当成常量** — 用 2023 年有效的规则硬套 2025 年的 regime，命中率平台化甚至倒退。  
2. **把执行当成 alpha** — 反复堆叠 MACD、固定均线、更多硬 gate，笔数骤降，却误以为是「更严谨」。  
3. **两层混淆** — 该每日更新的方向判断被冻结；该稳定不变的止损、入场纪律却被参数网格反复改动，系统既不可审计也不可执行。

梵澄金融的正确分工是：

| 层次 | 本质 | 是否每日演化 | 目标 |
|------|------|--------------|------|
| **变量层** | 投资逻辑 / 方向研判 | **是** | 解释「今天为何偏多/偏空/观望」 |
| **常量层** | 执行纪律 / 可下单性 | **否**（规则固定，参数按品种锁定） | 保证「给定方向后，如何一致地入场、止损、退出」 |

**常量层不产生 alpha，但缺少它变量层无法落地；变量层才是长期竞争力的来源。**

---

## 二、变量层 ↔ 常量层：代码模块映射

| 组件 | 层级 | 模块 / 路径 | 说明 |
|------|------|-------------|------|
| 政策 / 新闻 / 地缘 / 宏观数据 | 变量 | `services/news-*`、`docs/FLASH_NEWS_SOURCES.md`、RSS 聚合 | 研判输入，持续扩充与校验 |
| 大宗走势研判（outlook） | 变量 | `services/commodity-outlook-backtest.js`、`predictAtBarIndexHistorical` | 多引擎合成方向、logicSummary |
| 哲学 filter | 变量 | `services/philosophy-direction-filter.js`、`PHILOSOPHY_FILTER_V2` | 政策/事件/叙事过滤；`filterPass` + `effectivePhilosophyDir` |
| Model C / 量价验证 | 变量（仿真软、live 徽章） | `direction-model-v2.js`、`volume-oi-flow-model.js`、`model-c-intersection-gate.js` | fundamental_chan 下**不硬拦截** sim；live 仍作交叉验证徽章 |
| Quant gate（方向注入） | 变量→执行桥 | `services/trading-rules-quant-gate.js` → `evaluateFundamentalChanGate` | 把当日研判方向传给仿真/信号，而非另起一套固定模板 |
| 五法则 | **软常量** | `services/trading-rules-five-laws.js` | fundamental_chan：**加分/减分、sizeMultiplier**，不作 sim 硬 block |
| 缠论 S/R 入场 | 常量 | `services/chan-multitf-levels.js` → `findEntryLevel` | 5m→15m→1h 支撑/阻力 touch，与方向无关的**几何规则** |
| 止损 / 盈利保护 | 常量 | `chan-multitf-levels.js` → `POINT_CONFIG` | au/ag/rb 等品种点值**用户锁定**，非网格搜索对象 |
| 5m 退出路径 | 常量 | `CHAN_EXIT_PATH=5m`、`simulateIntradayExit` | tick 5m bar 序列上的止损/止盈/trail/收市 |
| 沉淀资金池 | 常量 | `quant-trading-margin.js` → `MIN_DEPOSIT_YUAN` | ≥40 亿流动性过滤，与当日观点无关 |
| 品种黑名单 | 常量 | `QUANT_INSTRUMENT_BLACKLIST`（如 `ec`） | 已知定价/TP bug，永久剔除 |
| 仿真 / 存档 | 常量执行回放 | `quant-trading-simulator.js`、`quant-trading-archive.js` | 9,726 笔 baseline 是**同一套执行规则**下的结果 |
| 信号 outbox | 常量格式输出 | `scripts/export-daily-signals.js` → `data/outbox/signals/` | 把变量层结论格式化为可执行行，不改变逻辑 |
| 无限易 PythonGO | 常量执行（外部） | `scripts/infinitrader-pythongo/` | CTP 侧下单模板；策略逻辑仍来自梵澄信号 |

**数据流（简化）**：

```
政策·新闻·量价·regime …
        ↓  变量层（每日变）
outlook → philosophy filter → quant gate（方向）
        ↓  常量层（规则固定）
S/R 入场 → SL / TP / trail → 5m exit → 存档 / outbox → （可选）PythonGO
```

---

## 三、`fundamental_chan` 如何体现这一分工

`QUANT_MODE=fundamental_chan` 是当前 baseline 模式（2023–2025：**+102.26%** · **9,726** 笔，见 [HANDOFF](./HANDOFF_2026-06-25.md)）。它**刻意**做了三层分离：

### 1. 变量层为主 gate

- 主方向来自 `philosophyFilter.effectivePhilosophyDir` 或 outlook `predictedDir`。  
- **不要求** legacy Model C `sameSign` / `tradableForSim` 才能仿真——避免「固定交集模板」把有效观点滤光。  
- Model C 在 live 路径保留**徽章**意义：交叉验证，而非第二套 alpha。

### 2. 五法则为辅（软）

- 评分影响 `sizeMultiplier`（约 0.7–1.0×），**不是** sim 硬拦截。  
- 与旧 `model_c_gate` 模式对比：后者把五法则 + Model C 交集当硬门槛，3 年仅 8–22 笔，属于典型的「把常量层当 alpha」误判。

### 3. 执行常量锁定

- **入场**：按预测方向在 5m/15m/1h 最近 S/R touch。  
- **止损 / 盈利保护**：au 500 元/手、ag 300/400、rb 3/4 价格点等——**用户确认后写入 `POINT_CONFIG`，非优化变量**。  
- **退出**：`CHAN_EXIT_PATH=5m` 统一 intraday 路径。  
- **池过滤**：沉淀资金 ≥40 亿 + `ec` 黑名单——流动性与安全常量，不参与「找 alpha」。

因此：**回测收益主要来自变量层方向质量 × 常量层纪律执行**；改 SL 几个 tick 或再加一条固定指标，不是产品主路径。

---

## 四、当前成熟度（2026-06）

| 层次 | 状态 | 说明 |
|------|------|------|
| **变量层** | **较强** | outlook + philosophy filter v2 已接入探针与 archive；新闻/flash/regime 持续扩充；T+3 / ensemble 路线在 [v1.34 路线图](./FANCHENG_V134_ROADMAP.md) |
| **常量层 · 仿真** | **较完整** | fundamental_chan 全池探针、tick 5m 退出、archive/UI 成交表、费用与保证金建模 |
| **常量层 · 实盘桥** | **部分** | 每日 `export-daily-signals.js` outbox ✅；daemon 56 品种 gateOut ✅；无限易 **PythonGO 需用户部署** ⚠️；自动 CTP 下单未默认开启 |
| **需避免的方向** | — | 继续堆叠固定策略模板、硬 gate 交集、以执行参数网格替代研判升级 |

---

## 五、产品路线图（对齐变量/常量，而非堆模板）

以下优先级与「变量强、执行通」一致；**不是**「再加 N 个固定指标模板」。

### 变量层（核心竞争力）

1. **研判质量** — T+3 标签、regime 五态、L2 ensemble；哲学层稳定为 M1 输入而非唯一 alpha。  
2. **数据闭环** — OI、term structure、库存、新闻去重与 `priced_in` / 事件窗口（见 [PHILOSOPHY_FILTER_ARCHITECTURE.md](./PHILOSOPHY_FILTER_ARCHITECTURE.md)）。  
3. **可审计** — 每个交易日 outlook archive 保留 `philosophyMeta`、`neutralReason`；量化 gate 只消费方向，不复制一套平行逻辑。

### 常量层（执行通、纪律稳）

1. **信号 → 下单** — 完善 outbox 契约；PythonGO / 无限易模拟跑通全链路（见 [INFINITRADER_INTEGRATION.md](./INFINITRADER_INTEGRATION.md)）。  
2. **Live daemon** — 日内 S/R 触达与 5m exit 与回测同源，避免「回测一套、实盘一套」。  
3. **UI 透明** — 量化面板展示执行规则来源；研判面板展示变量层结论——两层不混谈。

### 明确不做（与旧路径切割）

- 不以「Model C 硬交集 + 五法则 hard block」作为 sim 默认（legacy `model_c_gate` 仅作对照）。  
- 不把 Chan SL/TP 点值当作 longrun 网格的主优化对象。  
- 不引入与 outlook 平行的第二套「固定模板策略库」作为产品卖点。

---

## 六、阅读顺序建议

| 读者目标 | 文档 |
|----------|------|
| 快速恢复生产 baseline | [HANDOFF_2026-06-25.md](./HANDOFF_2026-06-25.md) |
| 量化架构与 SL/5m/池规则 | [QUANT_TRADING_FUNDAMENTAL_CHAN.md](./QUANT_TRADING_FUNDAMENTAL_CHAN.md) |
| 无限易 / outbox / PythonGO | [INFINITRADER_INTEGRATION.md](./INFINITRADER_INTEGRATION.md) |
| 研判逻辑分层 | [FANCHENG_LOGIC_FRAMEWORK.md](./FANCHENG_LOGIC_FRAMEWORK.md) |
| 哲学 filter 细节 | [PHILOSOPHY_FILTER_ARCHITECTURE.md](./PHILOSOPHY_FILTER_ARCHITECTURE.md) |

---

*本文档随产品方向演进更新；具体数值 baseline 以 HANDOFF 与探针 JSON 为准。*
