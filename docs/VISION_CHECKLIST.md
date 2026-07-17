# Fancheng Finance · Vision Master Checklist

**Audit date:** 2026-07-02  
**Release target:** `v1.42.0-integrated-spec`  
**Legend:** ✅ IMPLEMENTED · ⚠️ PARTIAL · ❌ MISSING

---

## P0 — Core product vision

| Item | Status | Evidence / notes |
|------|--------|------------------|
| Long-term trading north star (max return, min risk; entry/stop timing) | ✅ | `long-term-trading-guidance.js` — entry readiness, stop ladder, R:R, `riskOfEarlyStop`; philosophy anchor in UI |
| 大宗走势研判 → 长线指导 tab (not scalping primary) | ✅ | `src/index.html` tab label · `src/app.js` `outlook: '大宗走势研判 · 长线指导'` |
| Remove 预测点位 entirely | ✅ | No matches in `src/`; list uses **风险边界** column |
| Remove quant trading tab/module | ✅ | Removed from `src/index.html` / `electron/main.js`; legacy `app.js`/`index.html` at repo root are stale |
| Four layers: bias → phase → posture → execution — **UI labels 四层** | ✅ | `renderOutlookFourLayerStrip()` in `src/app.js` + CSS `outlook-four-layer-strip` |
| Posture 7 states with logicChain | ✅ | `POSTURES` in `outlook-trading-guidance.js`; every build pushes `logicChain` |
| Phase from capitalAttention + vol percentile | ✅ | `derivePhase()` |
| 1% risk budget position sizing | ✅ | `RISK_BUDGET_PCT = 1`, `derivePosition()` |
| 90s pilot guidance refresh | ✅ | `outlook-live-refresh.js` `QUOTE_INTERVAL_MS = 90s`; `patchOutlookPricesFromCommodities` → `refreshPilotGuidance` |
| Pilot symbols AG,AU,LC,CU,SC,RB,I,HC — full guidance | ✅ | `PILOT_SYMBOLS` set |
| Non-pilot: honest stub (暂无), NOT fake guidance | ✅ | `stub-non-pilot` in guidance services + UI stubs + pilot scope note |
| 风险边界 not 目标价 for range display | ✅ | Main list header `风险边界` in `src/app.js` |
| Chan → 结构状态 only, structure for stops | ✅ | `renderOutlookChanStructureBlock` · stops use `chanStructureHints` in LT guidance |
| Three-slot → collapsed 高级·日内 only | ✅ | `renderOutlookSlotSnapshotCompare` — `<details>` summary `三时段快照对照（高级 · 日内）` |

---

## P1 — Thesis & macro narrative layer

| Item | Status | Evidence / notes |
|------|--------|------------------|
| Thesis registry (JSONL) with falsify, status, linked symbols | ✅ | `thesis-registry.js` |
| Auto thesis fetch (anysearch/news fallback) on schedule | ⚠️ | `thesis-fetch-scheduler.js` + `data-fetcher.js` `scheduleThesisFetchIfDue()` — **requires anysearch API / runtime.conf** |
| Seed theses: silver, US equity bubble, Japan carry | ✅ | `data/thesis-registry-seed.jsonl` — 4 seeds including `seed-silver-narrative-120`, `seed-jpy-carry-unwind`, `seed-us-equity-bubble-2025` |
| thesis-synthesis max 0.15 weight per thesis | ✅ | `MAX_THESIS_BIAS_CONTRIBUTION = 0.15` |
| Narrative overshoot → phase 退潮 | ✅ | `derivePhase()` checks `overshoot` theses; `thesis-registry.checkPriceTargetOvershoot` |
| Active theses UI in outlook detail | ✅ | `renderOutlookActiveThesesBlock()` |

---

## P2 — Global liquidity / risk

| Item | Status | Evidence / notes |
|------|--------|------------------|
| 10 observables pack for US bubble / liquidity | ✅ | `global-liquidity-risk.js` — `trimmedObs = observables.slice(0, 10)` |
| L1/L2/L3 shock tiers with **correct L2 mapping** | ✅ | **Fixed v1.41:** `regime=deleveraging` for L2; `REGIME_TO_TIER` + `REGIME_TO_TIER_FROM_RISK`; `refreshPilotGuidance` inlined in facade |
| Posture caps per pilot symbol by tier | ✅ | `POSTURE_CAPS` decision table |
| Global liquidity命题 strip in UI | ✅ | `renderOutlookGlobalLiquidityStrip()` |
| Macro synthesis integrated into guidance + AI brief | ✅ | `buildMacroSynthesis` → per-symbol caps; `aiMacroBrief` on outlook payload |

---

## P3 — Long-term guidance

| Item | Status | Evidence / notes |
|------|--------|------------------|
| longTermGuidance: entry, stop ladder, hold, R:R | ✅ | `long-term-trading-guidance.js` |
| riskOfEarlyStop flag for LT stops | ✅ | `assessRiskOfEarlyStop()` |
| Thesis falsify levels in hard stop | ✅ | `resolveThesisFalsifyLevel()` |
| minHoldDays suggestion | ✅ | `deriveHoldGuidance()` + `MIN_HOLD_DAYS_BY_PHASE` |

---

## P4 — AI fusion

| Item | Status | Evidence / notes |
|------|--------|------------------|
| fancheng-ai-fusion.js service | ✅ | `services/fancheng-ai-fusion.js` |
| Instrument brief + macro brief | ✅ | `buildInstrumentBrief`, `buildMacroBrief` |
| Q&A patterns in Chinese | ✅ | `matchQuestionPattern()` — 7+ patterns |
| UI: 梵澄研判助手 · AI 融合 panel | ✅ | `renderOutlookAiFusionBlock()` |
| UI: AI 宏观解读 collapsible | ✅ | `renderOutlookMacroAiBrief()` `<details>` |
| Optional LLM env vars | ✅ | `FANCHENG_LLM_API_URL`, `FANCHENG_LLM_API_KEY`, `FANCHENG_LLM_MODEL` |
| aiFusion on 90s refresh | ✅ | `refreshPilotGuidance()` → `attachInstrumentAiFusion` |
| Footer: 结论来自结构化数据 | ✅ | `outlook-ai-fusion-footer` / `outlook-macro-ai-footer` |

---

## P5 — Cross-tab information synthesis

| Item | Status | Evidence / notes |
|------|--------|------------------|
| AI/macro brief references fed/geo/policy/weather when in macro hydrate | ✅ | **Enhanced v1.41:** `extractMacroHydrateSnippets()` — fed, geo, policy, climate, macro |
| Per-instrument brief mentions relevant macro theses | ✅ | `macroSynthesis.activeTheses` in instrument brief |
| NOT just display walls — synthesis into brief/guidance | ✅ | Structured briefs + logicChain-driven guidance |

---

## P6 — Data integrity & UX trust

| Item | Status | Evidence / notes |
|------|--------|------------------|
| logicChain on all guidance | ✅ | Trading + LT + global risk + thesis synthesis |
| confidence with n or null | ✅ | `deriveConfidence()` — `n` from backtest or null |
| Version visible in UI (latest) | ✅ | `OUTLOOK_UI_VERSION` + footer `getAppVersion()` from `package.json` |
| Sync package.json version + README headline | ✅ | `1.41.0` / `v1.41.0-vision-complete` |
| Smoke tests: long-term, thesis-risk, ai-fusion | ✅ | All pass (2026-07-02 audit run) |

---

## P7 — Performance

| Item | Status | Evidence / notes |
|------|--------|------------------|
| Pilot-only heavy async loading | ✅ | `loadOutlookDetailAsyncData` returns early for non-pilot |
| No full engine rebuild on 90s tick | ✅ | Quote cycle patches prices + `refreshPilotGuidance` only; full recompute 5min |
| Posture hysteresis / debounce | ✅ | **Added v1.41:** `applyPostureHysteresis` — 2 consecutive phase OR 5min before downgrade |

---

## P8 — Deferred / scope notes

| Item | Status | Evidence / notes |
|------|--------|------------------|
| Client-only price merge triggers guidance refresh | ✅ | `patchOutlookPricesFromCommodities` with `refreshGuidance` on pilot |
| longTermGuidance ALL 74 symbols OR pilot UI note | ✅ | Pilot-only by design; UI note **完整长线指导仅试点品种** |

---

## P9 — Integrated spec v1.42 (Constitution v2)

| Item | Status | Evidence / notes |
|------|--------|------------------|
| Max 3 concurrent long-term positions — portfolio gate | ✅ | `portfolio-gate.js` · `portfolio-holdings-store.js` · IPC get/set |
| Dynamic regime A/B/C/D (not fixed Tier A metals) | ✅ | `commodity-regime-classifier.js` |
| Capital sediment / attention threshold | ✅ | `deriveWatchLevel` · W0-W4 in `research-pool.js` |
| Two-stage scout → phase confirm 加仓 | ✅ | W2-W4 + posture 试仓/加仓 in guidance |
| phase weight > single bar; 退潮/证伪 exits | ✅ | existing `derivePhase` + integrated overshoot → 减仓 |
| Global risk L2+ limits total exposure | ✅ | `computePortfolioGate` · `applyPortfolioGateToPosture` |
| logicChain + expandable audit; counter-thesis | ✅ | integratedSpec.logicChain · `buildCounterThesis` mandatory |
| Narrative overshoot → 减仓/退潮 | ✅ | `expectation-gap.js` + posture adjustment |
| Decision one-pager first screen; depth collapsed | ✅ | `renderOutlookDecisionOnePager` · `<details>` macro/factors |
| No data = 暂无, never fake | ✅ | all new services return null/待校验 |
| Regime B/C high score when表观/技术差 | ✅ | `multi-dimensional-scoring.js` regime boost |
| Playbooks PB-I/LH/FG + D0-D3 | ✅ | `data/playbooks.json` · `policy-playbook-engine.js` |
| Daily Brief 三答 + pool + top5 | ✅ | `daily-brief-synthesis.js` · 1h cache |
| Research pool JSONL | ✅ | `research-pool/pool.jsonl` on FANCHENG_DATA_DRIVE |
| Detail: regime/W/D/playbook all symbols | ✅ | `renderOutlookIntegratedBadges` · non-pilot AI lite |
| Divergence holder alert banner | ✅ | `renderOutlookDivergenceBanner` |
| Smoke integrated spec | ✅ | `scripts/smoke-integrated-spec.js` |
| Version v1.42.0-integrated-spec | ✅ | package.json · engine · UI · services |

---

## P10 — Advanced spec v1.43.0-advanced

| Item | Status | Evidence / notes |
|------|--------|------------------|
| Correlation cluster gate (≤2 effective bets same cluster) | ✅ | `portfolio-correlation-gate.js` · wired in `portfolio-gate.js` |
| Macro master clock (5 clocks + 3-line brief) | ✅ | `macro-master-clock.js` · `daily-brief-synthesis.js` · UI strip |
| Exchange hard policy tracker (margin/limit > rhetoric) | ✅ | `exchange-hard-policy.js` · seed JSON · auto W2 |
| Industry profit proxy (Regime B W3 gate) | ✅ | `industry-profit-proxy.js` · honest 待校验 |
| Term structure bias (contango/backwardation) | ✅ | `term-structure-bias.js` · P0 instruments |
| Seasonality calendar | ✅ | `data/seasonality-calendar.json` · `seasonality-hints.js` |
| Behavior override tracking | ✅ | `behavior-override-log.js` · IPC · brief mention if n≥5 |
| Information rhythm (90s silent unless W2/D2/O2) | ✅ | `src/app.js` `outlookWatchLevelsChanged` |
| Second-order expectation (priced-in degree) | ✅ | `expectation-gap.js` · `fancheng-ai-fusion.js` |
| Cross-market ratio hints (GSR, oil-copper) | ✅ | `macro-master-clock.js` crossMarket lite |
| Geo narrative half-life decay | ✅ | `geo-narrative-decay.js` |
| PB-BLACK-2015 playbook (供给侧改革+棚改) | ✅ | `data/playbooks.json` · linked I/RB/JM/J/HC |
| Slippage / thin liquidity flag | ✅ | `slippage-detector.js` · AP known · Regime D cap |
| O2 二次反弹·快钱 (narrative overshoot bounce) | ✅ | `research-pool.js` O2 · integrated posture rules |
| Smoke advanced v143 | ✅ | `scripts/smoke-advanced-v143.js` |
| Version v1.43.0-advanced | ✅ | package.json 1.43.0 · engine · UI · services |

---

## P11 — Discipline v1.44.0-discipline

| Item | Status | Evidence / notes |
|------|--------|------------------|
| Pre-mortem gate (3 failure paths + ack) | ✅ | `pre-mortem-gate.js` · `pre-mortem-ack-store.js` · UI modal |
| Block 采纳试仓 until pre-mortem ack | ✅ | `src/app.js` behavior-adopt-scout · IPC ack store |
| Margin stress test (+2% bump) | ✅ | `margin-stress-test.js` · `quant-trading-margin.js` · 待校验 honest |
| China holiday gap calendar | ✅ | `data/china-holiday-gaps.json` · `holiday-gap-calendar.js` |
| Daily brief holiday line after master clock | ✅ | `daily-brief-synthesis.js` buildThreeAnswers |
| One-pager margin + holiday sections | ✅ | `renderOutlookDisciplineOnePagerSections` |
| Playbook decision tree (3 questions) | ✅ | `playbook-decision-tree.js` · integrated badge |
| Thesis auto-retirement (falsified / overshoot+30d) | ✅ | `thesis-retirement.js` · outlook engine + fetch |
| Archived theses excluded from pool triggers | ✅ | `research-pool-auto-trigger.js` filter |
| AI fusion pre-mortem in risks | ✅ | `fancheng-ai-fusion.js` buildInstrumentBrief |
| Smoke discipline v144 | ✅ | `scripts/smoke-discipline-v144.js` |
| Version v1.44.0-discipline | ✅ | package.json 1.44.0 · engine · UI · services |

---

## P12 — Opponent playbooks v1.45.0-opponent-playbooks

| Item | Status | Evidence / notes |
|------|--------|------------------|
| PB-OPP-001 对手盘未竭 (Capitulation Gate) | ✅ | `opponent-capitulation.js` · OI+price+phase · motto |
| PB-SQUEEZE 挤仓 T1-T5 | ✅ | `policy-playbook-engine.js` detectSqueeze · slippage+hard-policy |
| PB-LIQ-CRISIS L3 覆盖 | ✅ | detectLiqCrisis · portfolio effective bets ≤1 |
| Decision tree Q0 (L3 first) | ✅ | `playbook-decision-tree.js` Q0 → PB-LIQ-CRISIS |
| Overlay PB-OPP-001 / PB-SQUEEZE | ✅ | Q1-Q3 + overlay on non-L3 |
| Integrated opponentStatus + squeezeStage | ✅ | `integrated-spec-attach.js` |
| Pre-mortem squeeze stop failure T2+ | ✅ | `pre-mortem-gate.js` |
| Daily brief 对手盘状态 line | ✅ | `daily-brief-synthesis.js` opponentStatusLine |
| UI badges 对手盘/新 playbook IDs | ✅ | `src/app.js` renderOutlookIntegratedBadges |
| Smoke opponent v145 | ✅ | `scripts/smoke-opponent-v145.js` |
| Version v1.45.0-opponent-playbooks | ✅ | package.json 1.45.0 · engine · UI · services |

---

## P13 — Retail-adapted HF v1.46.0-retail-hf

| Item | Status | Evidence / notes |
|------|--------|------------------|
| RETAIL_RULES disadvantage registry | ✅ | `retail-hf-strategy.js` · 8 explicit rules |
| Factor map net exposure + hedge degree | ✅ | `buildFactorExposure()` · follower not gross |
| Follow signal phase/OI/master clock | ✅ | `deriveFollowSignal()` · youAreFollowing vs accidentalConcentration |
| Event decay T+0/T+5/T+10 | ✅ | `event-decay.js` · W cap + stale→观望 |
| Carry/roll hint 1-3 months | ✅ | `term-structure-bias.js` `buildCarryRollHint` · 待校验 honest |
| Weekly red team letter | ✅ | `red-team-weekly.js` · IPC `get-red-team-weekly` |
| Retail convexity + exit liquidity | ✅ | `assessRetailPositionQuality()` · longTerm positionPctCap |
| Portfolio gate same-factor 3rd block | ✅ | `portfolio-gate.js` hedgeDegree < 30 |
| Integrated retailHf attach | ✅ | `integrated-spec-attach.js` factorExposure/convexity/violations |
| Daily brief factor + carry lines | ✅ | `daily-brief-synthesis.js` |
| AI fusion retail rules in brief | ✅ | `fancheng-ai-fusion.js` |
| UI badges 跟随·就绪/勿扎堆/事件衰减 | ✅ | `src/app.js` renderOutlookIntegratedBadges |
| Philosophy doc | ✅ | `docs/RETAIL_HF_PHILOSOPHY.md` |
| Smoke retail-hf v146 | ✅ | `scripts/smoke-retail-hf-v146.js` |
| Version v1.46.0-retail-hf | ✅ | package.json 1.46.0 · engine · UI · services |

---

## P14 — Retail discipline v1.47.0-retail-discipline

| Item | Status | Evidence / notes |
|------|--------|------------------|
| No-Trade Day + teaching | ✅ | `no-trade-day.js` · L2+/hedge/decay/W3/L3 → NO_NEW_TRADES |
| Daily brief top line + Top5 teaching | ✅ | `daily-brief-synthesis.js` · one-pager banner |
| Retail Trap Score 派发区 | ✅ | `retail-trap-score.js` · ≥70 badge · pre-mortem path |
| Re-entry cooldown 7d | ✅ | `re-entry-cooldown.js` + store · IPC log/get |
| Core/Tactical 2+1 slots | ✅ | `core-tactical-slots.js` · portfolio-gate · UI 核心/快钱 |
| Pain Memory playbook | ✅ | `pain-memory-playbook.js` · pain.jsonl · IPC CRUD |
| Integrated attach trap+pain | ✅ | `integrated-spec-attach.js` posture gates |
| retail-hf distributionTrapHigh | ✅ | `retail-hf-strategy.js` |
| Smoke retail-discipline v147 | ✅ | `scripts/smoke-retail-discipline-v147.js` |
| Version v1.47.0-retail-discipline | ✅ | package.json 1.47.0 · engine · UI · services |

---

## Fixes applied in v1.41.0-vision-complete

1. **L2 tier facade** — `deleveraging` regime; `REGIME_TO_TIER` + `resolvePostureCap` fallback; `refreshPilotGuidance` bug in `global-risk-regime.js`
2. **四层 UI strip** — explicit Bias / Phase / Posture / Execution labels
3. **Narrative overshoot → 退潮** — in `derivePhase()`
4. **Posture hysteresis** — downgrade debounce
5. **AI brief macro hydrate** — fed/geo/policy/climate tags from hydrated sources
6. **Silver narrative seed** — `seed-silver-narrative-120`
7. **Version sync** — `package.json`, README, all service/UI version constants
8. **Non-pilot UI** — pilot scope note + explicit 暂无 stubs

---

## Remaining honest gaps (not code-fixable in-repo)

| Gap | Why |
|-----|-----|
| Thesis auto-fetch live results | Needs **anysearch** `runtime.conf` + API credentials; falls back to news pool |
| LLM-enhanced answers | Needs `FANCHENG_LLM_*` env vars; rule-based synthesis works without |
| longTermGuidance for all 74 symbols | Intentionally pilot-only; expanding requires per-sector calibration |
| Data quality audit criticals | Pre-existing: closing freshness (67/74), outlook cache stale vs calendar, FG band width — run `node scripts/run-data-quality-audit.js` after market sync |
| Packaged app reflects changes | Requires `npm run build` / asar repack for production `.exe` |
| Root `app.js` / `index.html` | Legacy duplicates still contain quant tab — **not** used by Electron (`src/` is canonical) |

---

## Test commands

```bash
node scripts/smoke-integrated-spec.js
node scripts/smoke-advanced-v143.js
node scripts/smoke-ai-fusion.js
node scripts/smoke-long-term-guidance.js
node scripts/smoke-thesis-risk.js
node scripts/smoke-opponent-v145.js
node scripts/smoke-discipline-v144.js
node scripts/smoke-retail-hf-v146.js
node scripts/smoke-retail-discipline-v147.js
node scripts/run-data-quality-audit.js
```

**Last smoke run:** 2026-07-03 — retail-hf v146 + opponent + discipline smokes.
