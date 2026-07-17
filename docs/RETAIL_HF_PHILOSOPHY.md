# Retail-Adapted Hedge Fund Philosophy

**Version:** `v1.46.0-retail-hf`  
**Core motto:** **Follow, Don't Lead（跟随，不主导）**

---

## Why adaptation is mandatory

Wall Street and hedge funds operate with structural advantages:

- **Capital scale** — can amplify price moves, squeeze shorts, and absorb slippage
- **Information latency** — co-location, prime broker flows, inventory visibility
- **Risk infrastructure** — gross/net books, options overlays, prime brokerage leverage

Personal investors **cannot replicate** these edges. Copying HF playbooks (lead squeezes, fight policy narratives, hold crowded factors) **inverts** the edge — retail becomes liquidity **for** institutions.

Fancheng Finance down-shifts HF concepts into **follower guardrails**, not alpha clones.

---

## Ten retail-adapted rules

| # | Rule | HF original | Retail adaptation |
|---|------|-------------|-------------------|
| 1 | **Follow, don't lead** | Initiate squeeze / trend | Only enter after phase/OI/master-clock confirms institutions moved |
| 2 | **Net exposure, not gross book** | Long-short factor neutrality | Track net factor concentration; block 3rd same-factor slot |
| 3 | **Confirm, not predict** | Event-driven front-running | W2 tiny scout only; W3+ after phase 升温 |
| 4 | **No fight D2 policy** | Trade the headline | Follow phase/capital when policy vs flow diverges |
| 5 | **Exit crowded distribution** | Ride momentum to exit | 拥挤 + opponent exhausted → reduce, don't add |
| 6 | **L3 mandatory delever** | Crisis alpha | Cap gross; effective bets ≤1 |
| 7 | **Slippage half size** | Pay spread for speed | Scout size ×0.5 on severe slippage symbols |
| 8 | **Max 3 independent bets** | Multi-book diversification | Already enforced by portfolio gate |
| 9 | **No heroic top/bottom** | Narrative optionality | Ban pure narrative full size; require stop + scout |
| 10 | **Event decay** | T+0 edge harvesting | Policy/news weight decays T+0→T+5→T+10; stale without price confirm → 观望 |

---

## Code anchors

| Module | Role |
|--------|------|
| `services/retail-hf-strategy.js` | `RETAIL_RULES`, factor exposure, convexity, rule violations |
| `services/event-decay.js` | Event age → edge weight; W/posture caps |
| `services/term-structure-bias.js` | `buildCarryRollHint` — honest 待校验 if no curve |
| `services/red-team-weekly.js` | Adversarial weekly letter (structured data only) |
| `services/portfolio-gate.js` | Same-factor 3rd slot block when hedgeDegree < 30 |
| `services/integrated-spec-attach.js` | Per-instrument `retailHf` attachment |
| `services/daily-brief-synthesis.js` | Factor line + carry line + follow advice |

---

## UI honesty

- Missing curve / OI / event age → **待校验** / **暂无**, never synthetic fill
- Hit rates and playbook confidence always show **n** where applicable
- Badges: **跟随·就绪** · **勿扎堆** · **事件衰减**

---

*Constitution appendix — embedded in `retail-hf-strategy.js` header comment.*
