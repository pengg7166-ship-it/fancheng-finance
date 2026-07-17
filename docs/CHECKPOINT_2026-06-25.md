# Checkpoint 2026-06-25 — Quant production baseline

**Handoff (copy to new chat):** [`docs/HANDOFF_2026-06-25.md`](./HANDOFF_2026-06-25.md)  
**Production launch:** `E:\FanchengFinance\启动梵澄金融-安全.bat` · **weights:** v1.34.8  
**Workspace:** `E:\FanchengFinance\source\fancheng-finance`  
**Data root:** `E:\FanchengFinance\data` (`FANCHENG_DATA_DRIVE=E`) · **exports:** `E:\交易记录`  
**Window:** 2023-01-01 → 2025-12-31 · **mode:** `fundamental_chan`

## Current baseline (preserve)

| Metric | Value |
|--------|-------|
| Return | **+102.26%** (`102.261%` in JSON) |
| Trades | **9,726** |
| Win rate | **47.15%** |
| Max drawdown | **2.40%** |
| Initial / final capital | 1,000,000 → 2,022,609.85 CNY |

**Pool:** deposit filter **≥40亿** → 57 kept / 15 excluded from raw 72 · permanent blacklist **`ec`** → **56 instruments** traded.  
**Exit path:** 5m intraday cache (`fallback=5m15m-cache`).  
**Precious:** AU **+8,940** (65 trades, 66.15% win) · AG **+19,021** (71 trades, 63.38% win).

**Exit mix (latest probe):** stop_loss 6479 · take_profit 2632 · trail_support_break 351 · session_close 264 · avg hold ~85 min.

## Metric timeline (same window unless noted)

| Stage | Scope | Return % | Trades | Win % | Max DD % |
|-------|--------|----------|--------|-------|----------|
| Daily-proxy smoke | 3 inst | +168.26 | — | — | — |
| Regression | intraday bug | −2.34 | — | — | — |
| Pre-backfill proxy | 72 inst | +2078.18 | — | — | — |
| Post zip flush | 72 inst | +399.00 | — | — | — |
| Post ZCE-fix tick | 72 inst | +292.26 | ~12,757 | ~45.9 | — |
| 2026-06-21 baseline | 72 inst | +56.74 | 12,907 | 45.91 | — |
| Deposit ≥40亿 | 57 inst | +25.90 | 10,566 | 47.86 | 12.57 |
| 56 inst + 5m exit | ec out | +97.96 | 10,212 | 47.09 | 1.50 |
| P0 fixes (`243a9d49`) | 56 inst | +97.37 | 10,028 | 47.00 | 2.47 |
| **Precious + trail (current)** | 56 inst | **+102.26** | **9,726** | **47.15** | **2.40** |

## Tuning knobs (env)

| Variable | Baseline value | Notes |
|----------|----------------|-------|
| `FANCHENG_DATA_DRIVE` | `E` | Data on `E:\FanchengFinance\data` |
| `QUANT_MODE` | `fundamental_chan` | Probe + sim mode |
| `PHILOSOPHY_FILTER_V2` | `1` | Set by probe script |
| `MODEL_C_LIVE_TIER` | `high_hit` | Probe default |
| `MODEL_C_SIM_TIER` | `sim_relaxed` | Probe default |
| `QUANT_PRECIOUS_MIN_RR` | **2.0** | au/ag min R:R gate |
| `CHAN_TRAIL_ARM_RATIO` | **0.67** | Trail arming vs profit-exempt |
| `CHAN_EXIT_PATH` | **5m** | 5m tick exit path (default) |
| `QUANT_EXCLUDE_IDS` | (optional) | Ad-hoc; `ec` is permanent in code |

**Code constants:** `MIN_DEPOSIT_YUAN=4e9` · `QUANT_INSTRUMENT_BLACKLIST=['ec']` in `services/quant-trading-margin.js`.

## Patches applied (session)

- **P0:** night 20:55 session-close fix · S/R directional alignment · asar patched (git **243a9d49**).
- **`_patch-quant-trading-asar.js`** re-run — embedded UI summary **102.261% / 9726**.
- Archive `trades.jsonl` synced at **2026-06-25 ~16:54** (replaces 10,028 / 10,212 prior runs).

## Key artifacts

| Path | Role |
|------|------|
| `_probe-fundamental-chan-quant-summary.json` | Probe summary (`generatedAt` 2026-06-25T08:54:16Z) |
| `_quant-trading-backtest-summary.json` | App/backtest mirror of baseline |
| `E:\FanchengFinance\data\history\quant-trading-archive\trades.jsonl` | **9,726** trade rows |
| `E:\FanchengFinance\data\history\trading\tick-intraday-progress.json` | Tick backfill **721** zips processed |
| `_analyze-trades-readthrough.json` | Stale (**10,212** trades) — re-run after probe |
| `_analyze-quant-return-diagnosis.json` | Pre-precious diagnosis — re-run optional |

## Open items

- **trail ~3.6%** of exits (`trail_support_break` 351/9726); optional probe `CHAN_TRAIL_ARM_RATIO=0.5`
- **`_analyze-*.json` stale** — re-run `_analyze-trades-readthrough.js` + `_analyze-quant-return-diagnosis.js`

## Tomorrow — first command

```powershell
cd E:\FanchengFinance\source\fancheng-finance
npm run audit-tick-inventory
```

Then re-probe (snapshot summary first):

```powershell
Copy-Item _probe-fundamental-chan-quant-summary.json _probe-fundamental-chan-quant-summary-pre-rerun.json -ErrorAction SilentlyContinue
$env:FANCHENG_DATA_DRIVE = "E"
$env:QUANT_MODE = "fundamental_chan"
$env:QUANT_PRECIOUS_MIN_RR = "2.0"
$env:CHAN_TRAIL_ARM_RATIO = "0.67"
node scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy 2>&1 | Tee-Object -FilePath _probe-fundamental-chan-quant-out.txt
```

App restart (dev):

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
npm start
```

**No git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"** for this checkpoint (state save only).
