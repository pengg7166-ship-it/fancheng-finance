# 哲学五支柱 × 历史锚点锲合（v1.31.2）

> 将用户思想（经验衰减、农产品气候、单边攻城/回踩突破、事件 vs 叙事、剧震后回调）与 `news-tagged.csv` 锚点事件 + `E:\FanchengFinance\data\history\trading\*.json` 日 K 实测涨跌幅对齐，并编码进 `fitPhilosophyToEvent()`。
>
> **软锲合原则（v1.31.2）**：思想无法精确数学表达——用历史锚点 T+5/T+20 **方向性锲合**，避免过紧公式。板块/品种乘数只做温和偏移；不确定时 `philosophyBlendWeight` 收缩分数、优先**观望**而非错方向。

数据来源：`data/history/news-tagged.csv`（317 行）+ 交易 JSON  
验证脚本：`node scripts/validate-philosophy-historical-fit.js` → `docs/philosophy-historical-fit-stats.json`

---

## 一、思想支柱 ↔ 引擎映射

| 支柱 | 历史规律（实测） | 引擎函数 / 参数 |
|------|------------------|-----------------|
| **经验衰减** | Fed 2019 三连降：AU T+20 从 +11.9% → -1.7% → -2.3% 递减 | `eventStimulusDecay` · `STIMULUS_DECAY_SCHEDULE` · `fitPhilosophy` macro `×0.82` 第 3 次起 |
| **农产品气候** | 干旱/禁令走产量路径；M 俄乌 T+20 +11% vs C 美国干旱 T+20 -7.9% | `EVENT_PATHS.agriClimateYield` · 不用 geo 衰减 · `yield_outcome×1.1` |
| **单边攻城/回踩** | 2022 SC 急涨后 `postShockPhase=pullback` · 台阶突破 ×1.08 | `trendStructureAnalyzer` · `breakoutAfterPullback` · `pullback_breakout×1.08` |
| **事件 vs 叙事** | 冲击 T+5 剧烈；叙事 CU AI T+20 +23.4% 持续 119 日 | `classifyNewsArchetype` · 叙事 `×1.18` · T+20 仍趋势 `×1.28` |
| **剧震后回调** | 2022 SC 峰值后最大逆向 -23.3%；AU/AG 方向不宜过度降级 | `postShockPhase` · 能源 `×0.78` · 贵金属 **×0.88** · `skipPullbackDirectionDowngrade` |
| **不确定观望** | 历史类比弱 / 台阶背离 / 次矛盾主导 | `philosophyBlendWeight` · `applyPhilosophyBlendDamping` · `philosophy-uncertain-watch` |
| **利好兑现** | 降息预期→金银先涨；FOMC落地 T+5 常转弱/回撤；2023+ 时代仅 2019/2020 走卖事实、2025_2026 不翻空 | `assessMacroFedPricedIn` · 时代内计数 · `directionFlipThreshold` · 仅强 flip 翻空 |
| **品种分化** | 农产品确定性减产≠卖事实；CU/AL叙事；SC/FU地缘重复衰减 | `INSTRUMENT_PRICED_IN_PROFILES` · `panic_shortage×1.12` |

---

## 品种分化 — 买预期卖事实 vs 确定性减产恐慌（v1.32.1）

> **普适**：买预期卖事实（Fed 降息→AU/AG 落地弱化/翻空）  
> **农产品例外**：SR/CF/A/M/RM 在**巨大确定性减产**（禁令/绝收/全球供应冲击）时恐慌抢货可延续偏多 — `agri_confirmed_shortage_panic`，**不**套用卖事实 flip  
> **轻微减产**：预涨 + 小幅/局部减产确认 → `inferYieldCutMagnitude=minor` · `agri_minor_yield_priced_in` · **flip偏空**（`minorFlip×0.76~0.8`）  
> **谣言阶段**：预涨 + 减产传闻已计价 → `agri_expectation_priced_in` 温和弱化（`rumorDamp×0.88~0.9`），不翻空

### 减产幅度分化（`inferYieldCutMagnitude`）

| 幅度 | 触发信号 | 预涨后落地 | 路径 |
|------|----------|------------|------|
| `severe` | 出口禁令、绝收、全球冲击、≥16% 减产表述 | 恐慌还可涨 | `agri_confirmed_shortage_panic` · `panic_shortage×1.10~1.14` |
| `minor` | 小幅/局部/≤15% 减产、单产略降 | **利好兑现偏空** | `agri_minor_yield_priced_in` · `agri_minor_priced×0.76~0.8` · flip bearish |
| `unknown` | 仅泛「减产」无幅度 | 沿用旧规则（谣言弱化或恐慌 extend） | 见下表 |

### 品种规则表

| 品种 | priced-in 行为 | 恐慌短缺行为 | 路径 ID |
|------|----------------|--------------|---------|
| AU / AG | Fed 降息落地 → 卖事实 / 观望 | N/A | `macro_priced_in` |
| SR / CF / A / M / RM | 轻微减产预涨 → **flip偏空** `×0.76~0.8` | **巨大减产 → 延续偏多** `×1.10~1.14` | `agri_minor_yield_priced_in` / `agri_confirmed_shortage_panic` |
| C | 谣言预涨 → 弱化 `×0.92` | 不走恐慌 extend | `agri_expectation_priced_in` |
| CU / AL | 叙事预涨 → 震荡弱化 `×0.92` | N/A（叙事长持） | `narrative_priced_in` |
| SC / FU | 地缘首冲击有效 | 霍尔木兹重复 → `geo_repeat×0.78~0.88` | `geo_repeat_decay` |

关键词（确定性减产）：减产、干旱、霜冻、单产下调、出口禁令、产量下调、确定性

### 历史锚点验证（日 K + 锚点事件）

| 事件 | 品种 | 引擎判定 | T+5 | T+20 | 结论 |
|------|------|----------|-----|------|------|
| 2022-05-13 印度小麦禁令 | M | `panic_shortage` | **+3.4%** | **+4.8%** | 禁令确认→豆粕偏强延续，非卖事实 |
| 2022-05-13 印度小麦禁令 | RM | `panic_shortage` | 待 K 线 | 待 K 线 | 菜粕同属蛋白链 |
| 2021-07-15 巴西干旱 | SR | `panic_shortage` | **+1.9%** | **+2.7%** | 糖独立路径·干旱确认后仍涨 |
| 2022-06-20 美干旱确认 | M/SR | `agri_expectation_priced_in`（盘前已回落） | M **-8.5%** / SR -1.4% | M -5.5% | 非全球禁令·预涨不足→弱化而非 panic extend |
| 2022-02-24 俄乌粮食 | M | `panic_shortage` | -2.7% | **+11.0%** | 滞后走强·出口替代逻辑 |

验证：`node scripts/probe-priced-in-agri-precious.js` · `node scripts/validate-philosophy-historical-fit.js`

---

## 二、锚点事件锲合表（按原型）

### shock_event — 重大冲击（CU / SC / RB）

| 事件 | 思想归类 | 实际盘面（代表品种） | T+5 | T+20 | 结论 | 引擎参数 |
|------|----------|------------------------|-----|------|------|----------|
| 2019-05-10 关税25% | 事件·剧震回调 | CU 震荡后走弱；SC 先涨后崩 | CU +0.3% / SC +5.4% | CU **-3.2%** / SC **-10.6%** | 工业金属短期震荡，能化 T+20 深跌 | `shock_first` · `post_shock_pullback` · `×0.78` |
| 2022-02-24 俄乌 | 事件·剧震·台阶 | SC 急涨 +14% T+5，峰值后 -23% 回撤 | SC **+14.1%** / CU +2.4% | SC **+21.5%** / RB +5.8% | 典型急涨→回撤；能源弹性最大 | `geo_escalation` · `post_shock_pullback` |
| 2025-02-01 关税落地 | 事件·需求担忧 | SC 持续走弱；CU 震荡偏多 | CU +2.0% / SC +3.4% | CU +2.4% / SC **-14.0%** | 关税下能化承压最明显 | 类比 `tariff_2025` · 方向降级 |
| 2026-01-01 美以伊 | 事件·地缘 | 数据截至 2025-12-23，待延伸 | — | — | 日历已接入，T+N 待补 | `us_iran_israel_2026` · geo `×1.4` |

### narrative — 叙事主题（CU / AL / AU）

| 事件 | 思想归类 | 实际盘面 | T+5 | T+20 | 结论 | 引擎参数 |
|------|----------|----------|-----|------|------|----------|
| 2023-11-30 AI算力叙事 | 叙事·长趋势 | CU/AL/AU 同步抬升，回撤浅 | CU **+18.7%** | CU **+23.4%** | 趋势 119 日；叙事 > 冲击型涨幅 | `narrative×1.18` · `narrative_extend×1.28` |
| 2024-03-01 铜需求叙事 | 叙事·台阶 | CU T+20 +6.2%，峰值后 -3.8% 回撤 | CU +3.5% | CU **+6.2%** | 叙事仍优于同类 shock 同期 | `ai_copper_demand_2024` 类比 |
| 2020-01-01 印尼镍禁令 | 供应叙事 | NI 短期反应滞后（定价已 front-run） | NI -2.9% | NI -6.0% | 政策叙事需区分「已计价」 | 叙事衰减下限 0.82 |

### macro_repeat — Fed 重复降息（AU / AG）

| 事件 | 思想归类 | 实际盘面 | T+5 | T+20 | 结论 | 引擎参数 |
|------|----------|----------|-----|------|------|----------|
| 2019-07-31 首次降息 | 经验衰减·首刺激 | AU/AG 强势 | AU **+5.7%** / AG +3.3% | AU **+11.9%** / AG **+13.9%** | 首次降息弹性最大 | `decay×1.0` |
| 2019-09-18 第二次 | 经验衰减 | 涨幅明显收窄 | AU +1.8% / AG +3.3% | AU -1.7% / AG -2.6% | 第 2 次刺激减弱 | `decay×0.7` |
| 2019-10-30 第三次 | 经验衰减 | 贵金属转震荡 | AU -1.0% / AG -1.6% | AU -2.3% / AG -4.9% | 三连降后利好出尽 | `decay×0.5` · `macro_decay×0.82` |
| 2024-09-18 降息重启 | 经验衰减 | AU T+20 +7.6% · AG +12.4% | AU +2.4% / AG +3.9% | AU **+7.6%** / AG **+12.4%** | 新周期首降仍有效 | `fed_cut_202409` 类比 |

### 利好兑现 — Fed 降息落地卖事实（AU / AG）

> 框架：降息**预期**阶段金银上涨；**实际**降息日若 T-5..T-1 已涨 +2% 或 30 日内「降息预期」资讯密集 → 落地易「卖事实」。

| 事件 | T-5..T-1 预涨 | 事件日 T0 | T+1 | T+3 | T+5 | 结论 | 引擎 |
|------|---------------|-----------|-----|-----|-----|------|------|
| 2019-07-31 首次降息 | AU +0.02% / AG +0.18% | T0 0% | AU -0.62% | AU +2.4% | AU **+5.66%** | 预涨极弱·首降仍有效 | 不 flip |
| 2019-09-18 第二次 | AU -0.43% / AG +0.41% | T0 0% | AU -0.17% | AU +0.69% | AU +1.8% | 同周期第2降·弹性衰减 | `priorOcc≥1` 观望 |
| 2019-10-30 第三次 | AU +0.22% / AG -1.1% | T0 0% | AU +0.22% | AU +1.0% | AU **-0.97%** | T+5 转负·典型卖事实 | `priorOcc≥2` flip偏空 |
| 2024-09-18 降息重启 | AU **+1.87%** / AG -5.6% | T0 0% | AU -0.18% | AU +1.58% | AU +2.36% | 30d内2条宽松预期·预涨 | `priced_in×0.72` 观望 |
| 2025-09-17 | AU +0.57% | T0 0% | AU -0.6% | AU -0.03% | AU +2.34% | 预涨弱·T+5仍反弹 | 待验证 |
| 2025-10-29 | AU -3.55%（前段已涨） | T0 0% | AU +0.62% | AU +1.71% | AU +0.65% | 事件前冲高后平 | 待验证 |
| 2025-12-10 | AU -0.30% | T0 0% | AU +0.21% | AU +2.23% | AU +2.23% | 落地后延续 | 待验证 |

验证：`node scripts/validate-philosophy-historical-fit.js` · 哲学 **v1.32.1** · `assessPricedInVsPanic(event, klines, sector, instrumentId)`

### 沪金 AU 用户锚点（batch1 · 2023–2026）

> 来源：`user-au-events-batch1.csv` + `user-au-events-batch2.csv` · 周末事件按沪金下一交易日对齐（10/9、3/2）

| 日期 | 类型 | 事件 | 当日 | 1月 | 哲学 |
|------|------|------|------|-----|------|
| 2023-03-13 | 银行危机 | SVB·Fed降息预期 | 现货+2.3%·沪金跳涨·420→448 | +6.8% | `geo_escalation` 避险 |
| 2023-03-22 | FOMC | 加息25bp删「持续加息」 | -0.1%·鹰转鸽 | +5.2% | `hawkish_pivot`·周期宽松预期 |
| 2023-05-03 | FOMC | 加息25bp+暂停暗示 | +0.7% buy rumor | +3.1% | `priced_in`·加息日卖事实 |
| 2023-07-26 | FOMC | 末次加息至5.25-5.50% | +0.4%·peak rates | +4.0% | `last_hike`·周期峰值→bullish |
| 2023-10-09 | 地缘 | 巴以（10/7→10/9） | 缺口+1.6%·448→472 | +7.2% Oct | `geo_escalation` |
| 2023-12-13 | FOMC | 维持+点阵3降2024 | +1.2%·破480 | +5.5% | `dovish_dot_plot`·鸽派 pivot |
| 2024-09-18 | FOMC | 首降50bp | 现货+0.3%·沪金微涨 | +4.5% Q4 | `priced_in_candidate`·2024首降仍有效 |
| 2024-11-05 | 地缘/政治 | 特朗普胜选 | +0.8% | +3.1% Nov | `geo_risk` |
| 2025-09-17 | FOMC | 降息25bp | 现货至3707回撤+0.2% | +5.0% | `priced_in`·repeat 弱化 |
| 2025-10-29 | FOMC | 降息25bp | +0.5% | +3.8% | `priced_in`·第2次 repeat |
| 2025-12-10 | FOMC | 第3次降息25bp | +0.62%·4252$·沪金跳空 | +4.2% | `priced_in`·2025_2026 不翻空 |
| 2026-01-05 | 地缘 | 委内瑞拉黑天鹅 | +2.6-2.7%·沪金+1.8% | +8.5% Jan | `geo_risk`·`macro_regime_shift` |
| 2026-03-02 | 地缘 | 美以袭伊（2/28→3/2） | 现货+2%+·沪金跳空 | **-10~-12%** Mar | 冲高后 `hawkish_hold_post_geo` |
| 2026-03-18 | FOMC | 鹰派暂停·点阵1降 | 震荡后暴跌·3/23历史第二差 | -8.5%至4月中 | **`hawkish_hold_post_geo` flip偏空** |

**关键用户洞察**：2026-02 地缘冲高（油金分化 `macro_regime_shift`）后，3/18 鹰派暂停非「落空反弹」而是**利好出尽转弱** — `assessMacroFedPricedIn` → `hawkishHoldPostGeo`（28日内地缘+预涨≥2% → `directionFlip=bearish`）。

### agri_climate — 产量路径（C / M / SR）

| 事件 | 思想归类 | 实际盘面 | T+5 | T+20 | 结论 | 引擎参数 |
|------|----------|----------|-----|------|------|----------|
| 2022-02-24 俄乌粮食 | 气候/供应·非 geo 衰减 | WH +10% T+5；M 滞后走强 | C +2.0% / WH **+10.0%** | M **+11.0%** / WH +12.9% | 粮食走产量缺口，非工业 geo 模板 | `agri_yield_path` |
| 2022-05-13 印度小麦禁令 | 农产品政策 | M +3.4% T+5 偏多；C 中性 | M **+3.4%** | M **+4.8%** | 出口禁令→替代品（豆粕）偏强 | `india_wheat_ban` 类比 |
| 2021-07-15 巴西干旱 | 气候→减产预期 | SR 逆势 +1.9% T+5 | C -3.7% / SR **+1.9%** | SR **+2.7%** | 品种分化；糖/软商品独立路径 | 不套 CU/SC 地缘衰减 |
| 2022-06-20 美国干旱 | 气候→产量 | C/M 同步下跌 | C **-3.7%** / M **-8.5%** | C **-7.9%** / M -5.5% | 干旱确认后趋势延续 59–104 日 | `yield_outcome×1.1` |

### geo_escalation — 地缘升级（SC / FU / EC）

| 事件 | 思想归类 | 实际盘面 | T+5 | T+20 | 结论 | 引擎参数 |
|------|----------|----------|-----|------|------|----------|
| 2022-02-24 俄乌能源 | 地缘·剧震回调 | SC T+5 +14% · 峰值后 -23% | SC **+14.1%** / FU **+9.4%** | SC +21.5% / FU **+26.2%** | 能源冲击+深回撤模板 | `post_shock_pullback` · `maxAdverse` 类比 |
| 2024-01-12 红海航运 | 地缘·运费 | SC/FU T+5 +10~11% 后回撤 | SC **+10.7%** / FU **+11.1%** | SC +2.5% / FU +6.7% | 冲击快、T+20 涨幅收敛 | `red_sea_2024` · 勿追高 |
| 2024-04-14 霍尔木兹紧张 | 地缘·假突破 | SC/FU T+20 转负 | SC -0.6% / FU -1.9% | SC **-7.3%** / FU **-5.2%** | 紧张未实质断供→利好出尽 | `hormuz_2024` · 方向降级 |

---

## 三、代码接线（v1.31.2）

| 模块 | 变更 |
|------|------|
| `commodity-outlook-philosophy.js` | `assessPricedInVsPanic()` · `INSTRUMENT_PRICED_IN_PROFILES` · `fitPhilosophyToEvent()` |
| `commodity-outlook-calibration.js` | `macro-priced-in-sell-fact` · `agri-panic-shortage-extend` · v1.32.1 |
| `evaluateInstrumentPhilosophy` | 调用 fit → 调整 `compositeScore` · `logicSummary` 含历史类比 |
| `commodity-outlook-engine.js` | `predictionRationale` 增加「历史锲合」行 · v1.31.0 |
| `commodity-outlook-backtest.js` | walk-forward 携带 `philosophyFit` · LONG_RUN v1.31.0 |
| `scripts/validate-philosophy-historical-fit.js` | 20 锚点 × T+1/3/5/10/20/60 + 冲击后逆向 + 趋势天数 |

### fitPhilosophyToEvent 返回

```javascript
{
  direction, stars, horizon,           // short | medium | long
  rationale,                           // 「类似2019关税后CU T+5 +0.3%·T+20 -3.2%」
  compositeMultiplier, shockPhase,
  analogue, stimulus, narrativeExtend,
  engineParams                         // 如 narrative_extend×1.28
}
```

---

## 四、回测

| 2024+ 五品种子集（cu/au/ag/sc/al） | v1.30.2 ~52% | **52.4%**（442/844，`probe-event-archetype-v130.js`） |
| 2024+ 八品种子集（+rb/c/m） | 52.1% | **52.2%**（652/1248，`probe-philosophy-fit-v131.js` v1.32.1） |
| 2024+ 贵金属+农产品子集（au/ag/c/m） | — | **53.1%**（285/536，探针子集） |
| 全量 longrun 2019+ | **57%**（v1.29 cached） | v1.31.1 **56.4%** → v1.31.2 软锲合回调 |

### v1.31.2 品种乘数（软锲合，非过拟合）

| 参数 | 默认/能源 | 贵金属 AU/AG | 有色 CU/AL |
|------|-----------|--------------|------------|
| `post_shock_pullback` | 0.78 | **0.88** | 0.82 |
| `narrative_extend` cap | 1.28 原始 | **1.15** | **1.25** |
| `philosophyBlendWeight` | 0.68 | 0.62–0.65 | 0.78 |

部署：`package.json` → **1.32.1** · 哲学 **v1.32.1** · 引擎 **v1.32.1**

---

*生成：validate-philosophy-historical-fit.js · 哲学版本 v1.32.1*
