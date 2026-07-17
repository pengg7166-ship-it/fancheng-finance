# 鍝插杩囨护鍣ㄦ灦鏋勮鑼?鈥?鏂瑰悜棰勬祴绯荤粺锛堢敤鎴风‘璁ょ増锛?

> **鐗堟湰**锛歷1.0 路 **閿佸畾鏃ユ湡**锛?026-06-17  
> **鐘舵€?*锛氭灦鏋勫喅绛栧凡纭 路 **鐢熶骇浠ｇ爜/鏉冮噸涓嶅彉**锛堝綋鍓?`v1.34.8-ag-cu-spread+basis-term`锛? 
> **閰嶅**锛歔T1 缁熶竴绠＄嚎](./T1_UNIFIED_PIPELINE.md) 路 [閫昏緫妗嗘灦](./FANCHENG_LOGIC_FRAMEWORK.md) 路 [椤圭洰鎭㈠鐘舵€乚(./PROJECT_RECOVERY_STATUS.md) 路 [浜嬩欢 vs 鍙欎簨](./PHILOSOPHY_EVENT_VS_NARRATIVE.md) 路 [璺ㄨ祫浜(./PHILOSOPHY_CROSS_ASSET.md)

---

## 涓€銆佹牳蹇冩灦鏋勫喅绛?

### 1.1 鍝插 = 杩囨护鍣紙闈炲急 logistic 鐗瑰緛锛?

| 缁村害 | 褰撳墠 v1.34.8 | 鐩爣鏋舵瀯 |
|------|--------------|----------|
| 鍝插瑙掕壊 | `philosophyScore` 浣滀负 18 缁?logistic **杩炵画鐗瑰緛** | **鐙珛杩囨护鍣?*锛氬厛浜у嚭鍝插鏂瑰悜涓庣疆淇″害锛屽啀鍐冲畾鏄惁鏀捐浜ゆ槗淇″彿 |
| 涓?ML 鍏崇郴 | 鍝插鍒嗕笌 momentum/OI/regime 鍚屾潈杩?`pUp` | 鍝插 **涓嶇洿鎺ヨ繘 logistic 绯绘暟**锛沴ogistic 浠呰礋璐ｃ€屼环鏍?鎶€鏈?flow銆嶆柟鍚戝瓙妯″瀷 |
| 瑙傛湜璇箟 | `philosophyBlendWeight` 鏀剁缉 composite | **鏄惧紡 `filterPass: false`** + `neutralReason` 鏋氫妇锛屾瘡鏃ュ繀鐣欏璁¤ |

**鍘熷垯**锛氬摬瀛﹀眰鍥炵瓟銆屽畯瑙?渚涢渶/浜嬩欢閫昏緫鏄惁鏀寔璇ユ柟鍚戙€嶏紱ML 灞傚洖绛斻€岀洏闈㈡槸鍚﹀凡瀹氫环璇ユ柟鍚戙€嶃€備簩鑰?**浜ら泦** 鎵嶄骇鐢?live 鍙氦鏄撲俊鍙枫€?

### 1.2 鍙屾ā鍨?C锛圖irection + Volume/OI锛?

```
Model C = DirectionModel 鈭?VolumeOIModel
```

| 瀛愭ā鍨?| 杈撳叆 | 杈撳嚭 | 鐢ㄩ€?|
|--------|------|------|------|
| **DirectionModel** | 浠锋牸鍔ㄩ噺銆佹湡闄愮粨鏋勩€乧ross-market銆乺egime one-hot 绛夛紙**涓嶅惈 philosophyScore**锛?| `dirModel.pUp` / `dirModel.direction` | 鐩橀潰鏂瑰悜鍊欓€?|
| **VolumeOIModel** | OI 鍙樺寲鏂瑰悜銆佹垚浜ら噺鍒嗕綅銆佸浠?鍑忎粨琛屼负鏍囩 | `flowModel.direction` / `flowModel.confidence` | 璧勯噾楠岃瘉 |
| **浜ら泦 Gate** | 涓ゆā鍨嬪悓鍚?**涓?* 鍝插 `filterPass` | `tradableSignal` | **浠?live 浜ゆ槗** 浣跨敤 |

**璁粌 / 鍥炴祴**锛?
- 涓よ矾 **鍒嗗埆 walk-forward 璁″垎**锛堝悇鑷?hitRate銆乻cored n锛?
- 棰濆鎶ュ憡 **浜ら泦 KPI**锛坄intersectionHitRate`銆乣intersectionScored`锛?
- 涓€ф棩 **浠嶅啓鍏?archive**锛岄檮 `neutralReason`锛屼緵 backtest 瀹¤銆屾湰鍙氦鏄撲絾鏈斁琛屻€嶇殑 counterfactual

### 1.3 姣忔棩杈撳嚭瑕佹眰

| 鍦烘櫙 | 蹇呴』杈撳嚭 | 璇存槑 |
|------|----------|------|
| 楂樼疆淇′氦闆?| `predictedDir` + `filterPass: true` | live 鍙氦鏄?|
| 鍝插/flow 浠讳竴鍚﹀喅 | `predictedDir: neutral` + `filterPass: false` + `neutralReason[]` | **涓嶅彲鐪佺暐** |
| 闅忔満娓歌蛋绐楀彛 | `filterPass: false` + `neutralReason: random_walk_divergence` | 瑙?搂2.3 |
| 鏀跨瓥鏃?| 鎸夋斂绛栬鍒欓泦澶勭悊锛?*涓嶇敤浠撳崟** | 瑙?搂2.1 |

---

## 浜屻€丵1 鈥?鍝插璇箟涓庣壒娈婃棩瑙勫垯

### 2.1 鎯呯华 vs 闀挎湡绌洪棿

- **鍏佽**锛氱煭鏈?sentiment **鍋忓**锛屼絾闀挎湡 upside **鏈夐檺**锛坧riced-in / 鍙欎簨灏侀《锛?
- 缂栫爜锛歚philosophyDirection` 鍙笌 `philosophyHorizon` 鍒嗙 鈥?T+1 鍙?bull锛孴+20 cap 鏍囪 `upsideLimited: true`
- priced-in 鍒ゅ畾瑙?搂3

### 2.2 鏀跨瓥鏃ワ紙Policy Day锛?

**瀹氫箟锛堢敤鎴风‘璁わ級**锛?*鍏ㄩ儴璁″叆** 鈥?涓嶉檺 FOMC/澶锛涘浗鍐呭伐涓氭斂绛栵紙宸ヤ俊閮ㄣ€佸彂鏀瑰銆佸浗鍔￠櫌甯稿姟浼氥€佷骇涓氳鍒掋€佺幆淇濋檺浜х瓑锛夊嚒 `news-tagged.csv` 鍙爣 `eventType=policy` 鐨?**鍧囩畻鏀跨瓥鏃?*銆?

| 瑙勫垯 | 琛屼负 |
|------|------|
| 鏁版嵁婧?| `news-tagged.csv` 路 `eventType=policy` 路 澶氶儴闂?broad 鏍囩 |
| 浠撳崟 | **鏀跨瓥鏃ョ鐢ㄤ粨鍗曞洜瀛?*锛坄warehouseWeight=0`锛?|
| 鍝插 | 璧?**鏀跨瓥涓撶敤瑙勫垯闆?*锛堜笌 event 鏃ャ€佸父鏃ュ垎绂伙級 |
| 涓?logistic | 浠撳崟鐗瑰緛鍦ㄦ斂绛栨棩 **mask 涓?0**锛岄伩鍏嶄笌 v1.34.8 璁粌鍒嗗竷鍐茬獊 |

### 2.3 浜嬩欢鏃ワ紙Event Day锛?

- 涓庢斂绛栨棩 **鐙珛瑙勫垯闆?*锛坄shock_event` / `geo` / `supply` 绛夛級
- 鍙傝€冿細[PHILOSOPHY_EVENT_VS_NARRATIVE.md](./PHILOSOPHY_EVENT_VS_NARRATIVE.md)
- 鍐插嚮鍚庣浉浣嶏紙`postShockPhase`锛夈€佸埡婵€琛板噺鐓у父锛?*涓嶄笌鏀跨瓥鏃ユ贩鐢ㄤ粨鍗曢€昏緫**

### 2.4 浠撳崟锛圵arehouse Receipts锛?

| 瑙勫垯 | 璇存槑 |
|------|------|
| 鏂瑰悜璇箟 | 浠撳崟 **涓婅** 鈫?鍙氦鍓查噺澧炲姞 鈫?**鍘嬪埗浜ゅ壊鏈?杩戞湀浠锋牸** |
| 涓诲姏鍚堢害鏉冮噸 | **鏈夐檺鏉冮噸** 鈥?涓诲姏澶氫负闈炰氦鍓叉湀锛屼粨鍗曞涓诲姏 **闄嶆潈** |
| 鍙傝€冨€?| 鍙?**浜ゅ壊鏈堢獥鍙ｅ唴 MAX**锛堥潪绠€鍗曞綋鏃ュ€硷級 |
| 鏀跨瓥鏃?| **瀹屽叏鍏抽棴**锛堣 搂2.2锛?|

### 2.5 浜ゅ壊鏈堢獥鍙?鈥?M-1 鍏ㄦ潈閲?ramp锛堢敤鎴风‘璁わ級

```
鏃堕棿杞达紙浠ヤ氦鍓叉湀 M 涓轰緥锛夛細
  鈥? M-2 鍙婃洿鏃?    M-1              M锛堜氦鍓叉湀锛?
      浣?闆舵潈閲? 鈫? 鍏ㄦ潈閲?ramp  鈫? 缁存寔 MAX 鍙傝€?
```

| 椤?| 瑙勫垯 |
|----|------|
| **M-1 璧峰** | 浠庝氦鍓叉湀 **鍓嶄竴涓湀绗竴涓氦鏄撴棩** 璧凤紝浠撳崟鏉冮噸 **绾挎€?鍙伴樁 ramp 鑷?100%** |
| 浜ゅ壊鏈?M | 浣跨敤绐楀彛鍐?**浠撳崟 MAX** 浣滀负鍙傝€冨€?|
| 鏈夎壊涓诲姏 | 涓诲姏鍚堢害閫氬父涓?**娆℃湀**锛堜緥锛氬綋鍓嶆椂娈典富鍔?**娌摐 2607** = 2026-07 浜ゅ壊锛夆啋 浠撳崟鏉冮噸椤绘寜 **瀹為檯浜ゅ壊鏈?* 瀵归綈锛岄潪鎸変富鍔涗唬鐮佸瓧闈?|

**瀹炵幇鎻愮ず**锛歚commodity-instrument-profiles` 鎴栫嫭绔?`delivery-calendar.js` 缁存姢 `{instrumentId, contractMonth, deliveryMonth, isMain}`锛屼粨鍗曟潈閲嶅嚱鏁?`warehouseWeight(asOfDate, deliveryMonth)` 鍦?M-1 鍓嶄负 0~30%锛孧-1 鍐?ramp 鑷?1.0銆?

---

## 涓夈€丵2 鈥?杩囨护鍣ㄨ涓?

| 鍘熷垯 | 璇存槑 |
|------|------|
| 鍝插鍗?filter | 鍝插鏂瑰悜涓?ML/flow 涓嶄竴鑷?鈫?**neutral**锛岄潪寮鸿鎶樹腑 |
| 闅忔満娈靛彲瑙傛湜 | 鐩橀潰銆岄殢鏈烘父璧般€嶆 **鍏佽 neutral** |
| 姣忔棩蹇呭垎鏋?| **姣忎釜浜ゆ槗鏃?* 椤讳骇鍑?`philosophyMeta` + `neutralReason`锛堣嫢鏈夛級锛岀姝?silent skip |
| 闅忔満娓歌蛋绐楀彛锛堢敤鎴风‘璁わ級 | 褰?**鏈€杩?N 鏃?* 瀹為檯鏂瑰悜 **鍙嶅涓庡摬瀛︽柟鍚戣儗绂?* 鏃惰Е鍙?filter 鈥?**涓嶇敤 ADX** |

**闅忔満娓歌蛋 filter 浼唬鐮?*锛?

```
divergenceCount = count(last N days where sign(actualReturn) != sign(philosophyDirection))
if divergenceCount >= threshold: filterPass = false; neutralReason += 'random_walk_divergence'
```

鍙傛暟 `N`銆乣threshold` 寰?walk-forward 缃戞牸锛堝缓璁?N鈭坽3,5,7}锛宼hreshold鈭坽3,4,5}锛夈€?

---

## 鍥涖€丵3 鈥?pricedIn 鏈€浼樺悎鎴?

**pricedIn** = 甯傚満鏄惁 **宸插厖鍒嗗畾浠?* 鍝插鏂瑰悜锛堜拱棰勬湡鍗栦簨瀹烇級銆?

鍚堟垚 **pricedInScore 鈭?[0,1]**锛堣秺楂?= 瓒?priced-in锛屽簲闄嶆潈鎴?flip锛夛細

| 鍒嗛噺 | 鏁版嵁婧?| 鏉冮噸寤鸿 |
|------|--------|----------|
| 浠锋牸/璺ㄥ競鍙嶅簲 | T-5~T-1 鍚屽悜棰勬定/璺岋紱CMX/LME/CNH 5d 涓庡摬瀛﹀悓鍚?| 0.35 |
| 閲忚兘/OI | OI 鎻愬墠澧炰粨銆乿olume spike 涓庡摬瀛﹀悓鍚?| 0.30 |
| 鏂伴椈閲嶅/鍙欎簨寤堕暱 | `eventStimulusDecay`銆乭eadline 閲嶅璁℃暟銆乣narrativeExtendCap` | 0.35 |

**杈撳嚭**锛?
- `pricedIn.mode`: `none` | `partial` | `full`
- `pricedIn.directionFlip`: 鏄惁瑙﹀彂鍗栦簨瀹炵炕鍚戯紙AU/AG 閬靛惊 era_split锛?025_2026 **浠?neutral 涓嶇炕绌?*锛?
- 鎺ュ叆鐐癸細`evaluateInstrumentPhilosophy` **涔嬪悗**銆乫ilter **涔嬪墠** 鈥?璋冩暣 `philosophyConfidence` 鑰岄潪鐩存帴鏀?logistic 鐗瑰緛

---

## 浜斻€丵4鈥換5 鈥?Model C 涓庢湁鏁堣祫閲戜俊鍙?

### 5.1 鍐崇瓥椤哄簭锛堢敤鎴风‘璁わ級

```
1. 鍝插 filter 鈫?philosophyDirection, filterPass
2. DirectionModel 鈫?dirCandidate
3. VolumeOIModel 鈫?flowCandidate
4. 鑻?filterPass && dirCandidate == flowCandidate == philosophyDirection
      鈫?tradableSignal
   鍚﹀垯 鈫?neutral + neutralReason
```

### 5.2 鏈夋晥璧勯噾淇″彿瀹氫箟

**Valid fund signal** 褰撲笖浠呭綋锛?

1. **OI 鍙樺寲鏂瑰悜** 涓?**鍝插鏂瑰悜** 鍚屽悜锛坄sign(oi_chg) == sign(philosophyDirection)`锛?
2. **鎴愪氦閲?+ OI** 杈惧埌鏉垮潡闃堝€硷紙娌跨敤/鎵╁睍 `price_down_oi_up` 绛夎涓烘爣绛撅級
3. 闈?policy 鏃ヤ粨鍗曞惁鍐炽€侀潪 random_walk 绐楀彛

涓嶆弧瓒?鈫?`flowModel.confidence` 浣庝簬 gate 鈫?浜ら泦澶辫触銆?

### 5.3 涓庡綋鍓?v1.34.8 宸紓

| 椤?| v1.34.8 | Model C |
|----|---------|---------|
| OI 鍥犲瓙 | logistic 18 缁翠箣涓€ | **鐙珛 flow 瀛愭ā鍨?* + 鍝插瀵归綈闂ㄦ帶 |
| 鍝插 | `philosophyScore` 杩炵画鍊?| **绂绘暎鏂瑰悜 filter** |
| AG 缂╂斁 | `AG_PHILOSOPHY_SCALE=0.45` | 淇濈暀涓?filter 缃俊搴﹁皟鑺傦紝**涓嶈繘 logistic** |

---

## 鍏€丵6 鈥?鍙欎簨绐楀彛涓庤法甯傚満鏄犲皠

### 6.1 T+1 鍙欎簨鍏佽 3鈥? 鏃?

- 鏂伴椈鍙欎簨锛坄narrative_theme`锛夊 T+1 鏂瑰悜鐨勫奖鍝嶇獥鍙ｏ細**3鈥? 涓氦鏄撴棩**
- 涓?shock锛?鈥? 鏃ワ級鍖哄垎锛涜秴杩?5 鏃ユ棤鏂?headline 鈫?鍙欎簨鏉冮噸琛板噺
- 鍙傝€?`narrativeExtendCap` 鏉垮潡宸紓锛圓U/AG/CU/AL 鍚勫紓锛?

### 6.2 璺ㄥ競鍦?鈫?鍥藉唴鏄犲皠

| 绂诲哺/鍥介檯 | 鍥藉唴鐩爣 | 鐢ㄩ€?|
|-----------|----------|------|
| **CMX 閲?閾?* | **AU / AG** | 鍥介檯璐甸噾灞炴柟鍚戦棬鎺?|
| **LME 鏈夎壊** | **CU / AL / ZN / NI 鈥?* | 鏈夎壊娴峰 lead |
| **绂诲哺 CNH** | 鍏ㄥ搧绉?FX 杈呰瘉 | 婧环/璐€奸摼锛?*涓嶅崟鐙彔鏂瑰悜**锛堟勃閲戣鍒欙細鍥介檯閲戝悓鍚戞椂鎵嶅井璋冿級 |

璇﹁ [PHILOSOPHY_CROSS_ASSET.md](./PHILOSOPHY_CROSS_ASSET.md)銆?

---

## 涓冦€丵7 鈥?鏉垮潡鍩烘湰闈㈣緭鍏?

鍝插 filter 鐨?**sector fundamentals** 杈撳叆锛圠2 鍝佺鍝插閿插悎灞傦級锛?

### 7.1 璐甸噾灞烇紙AU / AG锛?

| 鍥犲瓙 | 鏉ユ簮 |
|------|------|
| 瀹為檯鍒╃巼 / Fed 璺緞 | FRED DFF銆乺eal10y |
| CNH + 浼︽暒閲?overlay | `computeAuSpotCnhOverlay`锛堜粎 AU live锛?|
| CMX 閲戦摱 5d 鏂瑰悜 | cross-market lead |
| ETF 鎸佷粨鍙樺寲 | GLD/SLV stub |
| 璺ㄨ祫浜?regime | 鑲￠噾鍚屾 / 閬块櫓 / 娌瑰帇 |

### 7.2 鏈夎壊锛圕U / AL / ZN / NI 鈥︼級

| 鍥犲瓙 | 鏉ユ簮 |
|------|------|
| LME 搴撳瓨 / 鍥藉唴绀句細搴撳瓨 | `inventory/`锛堝緟琛ワ級 |
| 鏈熼檺缁撴瀯 / 鍩哄樊 | `term-structure/` |
| 浠撳崟锛堜氦鍓叉湀 M-1 ramp锛?| `warehouse-receipts/` |
| LME 浠锋牸 lead | cross-market |
| 寮€宸?/ 涓嬫父闇€姹?proxy | PMI銆佺數缃戞姇璧勬柊闂绘爣绛?|

### 7.3 榛戣壊锛圧B / HC / I / J / JM 鈥︼級

| 鍥犲瓙 | 鏉ユ簮 |
|------|------|
| 閾佺熆娓彛搴撳瓨 | Mysteel / 鐢熸剰绀?|
| 鐒︾叅鐒︾偔搴撳瓨 | 娓彛 + 閽㈠巶 |
| 楂樼倝寮€宸ャ€佽灪绾硅〃闇€ | 鍛ㄥ害鈫掓棩棰戝墠濉?|
| 鏈熼檺缁撴瀯 | 鍗疯灪浠峰樊銆佹湀闂翠环宸?|
| 鏀跨瓥闄愪骇 | news-tagged policy |

### 7.4 鍖栧伐锛圡A / TA / EG / PP 鈥︼級

| 鍥犲瓙 | 鏉ユ簮 |
|------|------|
| **鎴愭湰** | 鍘熸补锛圫C/FU锛夈€佺叅銆佸ぉ鐒舵皵璺緞 |
| **寮€宸ョ巼** | 鍛ㄥ害浜ц兘鍒╃敤鐜?|
| **搴撳瓨** | 鍘傚簱 + 娓彛 / 浜ゆ槗鎵€浠撳崟 |

### 7.5 鍐滀骇鍝侊紙M / Y / P / SR / CF 鈥︼級

| 鍥犲瓙 | 鏉ユ簮 |
|------|------|
| 澶╂皵 / 鏀跨瓥 / 搴撳瓨 | USDA銆佸彂鏀瑰銆佷氦鏄撴墍浠撳崟 |
| 鍘熸补瀵规补鑴傞摼 | SC 5d 鈫?妫曟/璞嗘补/绯?|
| 缇?涓滃崡浜?biodiesel 鏀跨瓥 | news-tagged policy + `agri_yield_path` |
| 瀛ｈ妭绐楀彛 | planting / harvest regime |

---

## 鍏€丩1鈫扡4 绠＄嚎锛圡ermaid锛?

```mermaid
flowchart TB
  subgraph L0["L0 鏁版嵁"]
    D1[鏃?K / OI / 鎴愪氦閲廬
    D2[news-tagged.csv]
    D3[FRED / CNH / CMX / LME]
    D4[浠撳崟 / 鏈熼檺缁撴瀯 / 鏉垮潡鍩烘湰闈
    D5[浜ゅ壊鏈堟棩鍘哴
  end

  subgraph L1["L1 鏃ュ瀷鍒嗙被"]
    E1{鏀跨瓥鏃?<br/>eventType=policy}
    E2{浜嬩欢鏃?<br/>shock/geo/supply}
    E3{浜ゅ壊鏈?M-1?<br/>warehouse ramp}
    E4{闅忔満娓歌蛋绐楀彛?<br/>N 鏃ュ摬瀛﹁儗绂粆
  end

  subgraph L2["L2 鍝插閿插悎 + pricedIn"]
    P1[SD脳Finance 鐭╅樀<br/>鏉垮潡 fundamentals]
    P2[assessPricedIn<br/>浠锋牸+OI+鏂伴椈閲嶅]
    P3[鏀跨瓥/浜嬩欢/甯告棩<br/>涓夊瑙勫垯闆哴
    P4[浠撳崟 MAX @ 浜ゅ壊鏈?br/>涓诲姏闄嶆潈]
    P5[philosophyDirection<br/>philosophyConfidence]
  end

  subgraph L3["L3 璺ㄨ祫浜?lead"]
    C1[CMX鈫扐U/AG]
    C2[LME鈫掓湁鑹瞉
    C3[CNH FX 杈呰瘉]
    C4[3鈥? 鏃ュ彊浜嬬獥鍙
  end

  subgraph L4["L4 Model C 璇勫垎"]
    M1[DirectionModel<br/>鏃?philosophy 鐗瑰緛]
    M2[VolumeOIModel<br/>OI 鏂瑰悜 + 闃堝€糫
    F1{鍝插 filterPass?}
    F2{dir 鈭?flow<br/>鈭?philosophy?}
    OUT1[tradableSignal]
    OUT2[neutral + neutralReason]
  end

  subgraph L5["L5 瀹¤ / KPI"]
    K1[鍒嗗埆璁″垎 dir / flow]
    K2[浜ら泦 KPI]
    K3[direction-prediction-archive<br/>姣忔棩涓€琛屽惈 neutral]
  end

  D1 & D2 & D3 & D4 & D5 --> L1
  L1 --> L2
  L2 --> L3
  L3 --> L4
  L1 --> P3
  E1 -->|绂佺敤浠撳崟| P4
  E3 --> P4
  P1 & P2 & P3 & P4 --> P5
  P5 --> F1
  C1 & C2 & C3 & C4 --> M1
  D1 --> M1 & M2
  M1 & M2 --> F2
  F1 --> F2
  F2 -->|鏄瘄 OUT1
  F2 -->|鍚 OUT2
  OUT1 & OUT2 --> L5
```

---

## 涔濄€佸疄鐜颁紭鍏堢骇锛堝叚姝ワ級

| 姝?| 鍐呭 | 浜у嚭 | 渚濊禆 |
|----|------|------|------|
| **1** | 鍝插灞?**filter 鍖?* | `philosophyDirection` / `filterPass` / `neutralReason` 浠?`evaluateInstrumentPhilosophy` 瀵煎嚭锛?*鍋滄**鍚?logistic 浼?`philosophyScore`锛堟柊绠＄嚎锛?| 鏃?|

### Step 1 瀹炵幇鐘舵€侊紙2026-06-17锛?

| 椤?| 鐘舵€?| 璇存槑 |
|----|------|------|
| `services/philosophy-direction-filter.js` | 鉁?| 鏀跨瓥鏃?broad 妫€娴嬨€佷簨浠舵棩鐙珛璺緞锛坧laybook stub锛夈€丮-1 浠撳崟 ramp銆乣philosophy_divergence` filter |
| 瀹為獙寮€鍏?| 鉁?| `PHILOSOPHY_FILTER_V2=1`锛堥粯璁?off锛夛紱鐢熶骇 v1.34.8 鏉冮噸涓嶅彉 |
| backtest / T1 probe 鎺ュ叆 | 鉁?| `commodity-outlook-backtest.js` 路 `probe-t1-unified-experiment.js` 浠撳崟 mask + 鏂瑰悜 neutral gate |
| archive v2 瀛楁 | 鉁?| `direction-prediction-archive.js` 路 `mergePhilosophyFilterFields` / `attachFilterToArchiveRecord` |
| 鎺㈤拡 | 鉁?| `scripts/probe-philosophy-filter-v2.js`锛坅u/ag/cu/rb 路 2023鈥?025锛?|
| pricedIn 涓夊垎閲?| 鈴?Step 3 | Step 1 stub锛汼tep 3 宸插疄鐜颁笁鍒嗛噺鍚堟垚 |
| Model C 鍙岃矾 | 鉁?Step 4 | `direction-model-v2.js` 路 `volume-oi-flow-model.js` 路 `model-c-intersection-gate.js` |
| logistic 鍘?philosophy | 鉁?Step 4 (inference) | DirectionModel 鎺ㄧ悊 zero philosophyScore锛涚敓浜ф潈閲嶄笉鍙?|

**鍚敤瀹為獙璺緞**锛?

```powershell
$env:FANCHENG_DATA_DRIVE='E'
$env:PHILOSOPHY_FILTER_V2='1'
$env:MODEL_C_V2='1'
# 鍙€夛細PHILOSOPHY_DIVERGENCE_LOOKBACK_N=5  PHILOSOPHY_DIVERGENCE_THRESHOLD=4
node scripts/probe-philosophy-filter-v2.js
node scripts/probe-model-c-v2.js
node scripts/probe-philosophy-filter-model-c-grid.js
node scripts/probe-t1-unified-experiment.js --oos-from 2023-01-01 --oos-to 2025-12-31
```

| **2** | 鏃ュ瀷瑙勫垯闆?| 鏀跨瓥鏃?broad 鏍囩 + 浠撳崟 mask锛涗簨浠舵棩鐙珛璺緞锛汳-1 浠撳崟 ramp + 浜ゅ壊鏈?MAX | 姝?1 |

### Step 2 瀹炵幇鐘舵€侊紙2026-06-17锛?

| 椤?| 鐘舵€?| 璇存槑 |
|----|------|------|
| 浜嬩欢鏃ユ敹绱?| 鉁?| 鍝佺鐩稿叧 geo/supply/shock 鏂伴椈 **鎴?* `regime=event`锛涚Щ闄ゆ硾鍖?`newsImpact.shock` / `dominantArchetype` 鍏ㄩ噺瑙﹀彂 |
| `delivery-calendar.js` | 鉁?| `CONTRACT_MONTHS` + 鏉垮潡 roll lead 鈫?`resolveDeliveryMonth`锛涙浛浠ｅ浐瀹?monthOffset |
| 鏀跨瓥鏃?playbook | 鉁?| `applyPolicyPlaybook` 路 瀹忚/鏀跨瓥鍙欎簨浼樺厛 路 `dayType: policy` 路 浠撳崟 mask |
| 鏉垮潡 playbook stub | 鉁?| `SECTOR_PLAYBOOK` precious/metals/black/chemical/agriculture 路 `sectorPlaybook` 鍏冩暟鎹?|
| 浜嬩欢 playbook | 鉁?| `applyEventPlaybook` 路 shock phase 瑙勫垯璺緞 路 涓?policy/routine 鍒嗙 |
| 鎺㈤拡 | 鉁?| `scripts/probe-philosophy-filter-v2.js` 鈥?event day 璁℃暟搴旀樉钁椾綆浜?100% |
| pricedIn 涓夊垎閲?| 鉁?Step 3 | 瑙?Step 3 鐘舵€?|
| Model C 鍙岃矾 | 鉁?Step 4 | 瑙?Step 4 鐘舵€?|
| **3** | pricedIn 缁熶竴 | `pricedInScore` 涓夊垎閲忓悎鎴愶紱鎺ュ叆 filter 缃俊搴?| 姝?1 |

### Step 3 瀹炵幇鐘舵€侊紙2026-06-17锛?

| 椤?| 鐘舵€?| 璇存槑 |
|----|------|------|
| `assessPricedInSynthesis` | 鉁?| 涓夊垎閲忥細priceCross(0.35) + volumeOi(0.30) + newsRepeat(0.35) 鈫?蟺鈭圼0,1] |
| 浠锋牸/璺ㄥ競 | 鉁?| AU/AG锛歚cross-market-precious-inference` + COMEX 5d锛汣U锛歞omestic 5d + cu momentum |
| 閲忚兘/OI | 鉁?| 20d 鎴愪氦閲忓熀绾?+ OI 鏂瑰悜涓庡摬瀛﹀悓鍚?|
| 鏂伴椈閲嶅 | 鉁?| `philosophyFit.stimulus` / `narrativeExtend` / `pricedIn.pricedInLikely` |
| 缃俊闂ㄦ帶 | 鉁?| `philosophyConfidence = |score|/0.5 脳 (1-蟺)^伪`锛沗effectivePhilosophyDir` 缁?damp 閲嶇畻 |
| Playbook 闂ㄦ帶 | 鉁?| `pullback_neutral_gate` 鈫?`event_pullback`锛沺olicy 鍐茬獊闄嶇疆淇★紱`priced_in_full` |
| 鎺㈤拡鎵╁睍 | 鉁?| 蟺 鍒嗗竷銆佹寜 dayType 鍧囧€笺€丼tep 2 baseline 瀵圭収琛?|
| Model C 鍙岃矾 | 鉁?Step 4 | 瑙?Step 4 鐘舵€?|
| **4** | Model C 鍙岃矾 | `DirectionModel` 璁粌鑴氭湰 + `VolumeOIModel` 瑙勫垯/杞婚噺妯″瀷锛涗氦闆?gate | 姝?1鈥? |

### Step 4 瀹炵幇鐘舵€侊紙2026-06-17锛?

| 椤?| 鐘舵€?| 璇存槑 |
|----|------|------|
| `services/direction-model-v2.js` | 鉁?| 鐢熶骇鏉冮噸 + `philosophyScore=0` 鎺ㄧ悊锛涗笉 overwrite weights |
| `services/volume-oi-flow-model.js` | 鉁?| OI 鏂瑰悜 + 鎴愪氦閲?OI 闃堝€?路 `validFundSignal` |
| `services/model-c-intersection-gate.js` | 鉁?| filter 鈭?dir 鈭?flow 鍚屽悜 路 `intersectionSignal` |
| 瀹為獙寮€鍏?| 鉁?| `MODEL_C_V2=1`锛堥渶 `PHILOSOPHY_FILTER_V2=1`锛?|
| backtest 鎺ュ叆 | 鉁?| `commodity-outlook-backtest.js` 路 `modelC` 瀛楁 |
| archive v2 瀛楁 | 鉁?| `dirModel` / `flowModel` / `intersectionSignal` 路 `mergeModelCFields` |
| 鎺㈤拡 | 鉁?| `scripts/probe-model-c-v2.js`锛坅u/ag/cu/rb 路 2023鈥?025 鍥涜矾 KPI锛?|
| live UI | 鈴?| 鏂囨。鍖栵紱鐢熶骇 UI 浠嶇敤 v1.34.8 鍗曟ā鍨?|
| **5** | Archive schema v2 | `direction-prediction-archive` 鎵╁睍瀛楁锛沚ackfill 鑴氭湰锛沀I 灞曠ず neutralReason | 姝?4 |

### Step 5 瀹炵幇鐘舵€侊紙2026-06-17锛?

| 椤?| 鐘舵€?| 璇存槑 |
|----|------|------|
| `--schema v2` backfill | 鉁?| `scripts/backfill-direction-prediction-archive.js` 路 PHILOSOPHY_FILTER_V2 + MODEL_C_V2 閲嶆斁 |
| v2 瀹¤瀛楁 | 鉁?| `filterPass` 路 `neutralReason`/`neutralReasons` 路 `dirModel`/`flowModel` 路 `intersectionKpiEligible` |
| 涓€ф棩 reason 瑕嗙洊 | 鉁?| Model C gate fallback + backfill 鏍￠獙 `neutralReasonCoveragePct` |
| UI 瀹¤鍒?| 鉁?| `src/app.js` Filter 鍒?+ 棰勬祴鍒?tooltip锛坴2 瀛樺湪鏃舵樉绀猴紱v1 鍚戝悗鍏煎锛?|
| 鎺㈤拡 / 鏍锋湰鍥炲～ | 鉁?| au/ag 2023鈥?025 鏍锋湰鍛戒护瑙?搂鍗佷竴 |
| **6** | Walk-forward 浜ら泦 KPI | `probe-philosophy-filter-model-c-grid.js` 路 gate 鈮?5% @ n鈮?0 | 姝?5 |

### Step 6 瀹炵幇鐘舵€侊紙2026-06-17锛?

| 椤?| 鐘舵€?| 璇存槑 |
|----|------|------|
| 闃堝€肩綉鏍兼帰閽?| 鉁?| `scripts/probe-philosophy-filter-model-c-grid.js` 鈥?鍗曢亶缂撳瓨 + 63/189 combo 蹇壂 |
| 缃戞牸杞?| 鉁?| divergence N鈭坽3,5,7} 脳 T鈭坽3,4,5} 路 flow vol鈭坽1.1,1.15,1.2} 路 oi鈭坽0.06,0.08,0.1} 路 鍙€?伪鈭坽1,1.25,1.5} |
| OOS 绐楀彛 | 鉁?| au/ag/cu/rb 路 2023-01-01 鈫?2025-12-31 |
| 浜у嚭 | 鉁?| `_probe-model-c-grid-out.json` 路 `_probe-model-c-grid-run.txt` |
| **Gate** | 鉂?**FAIL** | **0/189** combo 杈?intersection **鈮?5%** 涓?**n鈮?0** |
| 鏈€浣?Pareto (n鈮?0) | 鈥?| 鏃?combo 杈惧埌 n鈮?0 |
| 鏈€浣?tradeoff | 馃搳 | **max n**锛歚N5_T4_vol1.1_oi0.06_a1` 鈫?n=**30** hit=**66.67%** 路 au+ag n=21 hit=**71.43%** |
| 鏈€楂?hit (any n) | 馃搳 | `N5_T4_vol1.2_oi0.06_a1.25` 鈫?n=22 hit=**68.18%** |
| 鐢熶骇 deploy | 鉂?| **涓?justified** 鈥?淇濇寔 v1.34.8 鏉冮噸锛涘疄楠岃矾寰勫彲璇曟帹鑽?env |

**瀹為獙璺緞鎺ㄨ崘 env**锛堢綉鏍?max-n 瑙掔偣锛岄潪鐢熶骇锛夛細

```powershell
$env:FANCHENG_DATA_DRIVE='E'
$env:PHILOSOPHY_FILTER_V2='1'
$env:MODEL_C_V2='1'
$env:PHILOSOPHY_DIVERGENCE_LOOKBACK_N='5'
$env:PHILOSOPHY_DIVERGENCE_THRESHOLD='4'
$env:FLOW_MODEL_MIN_VOL_RATIO='1.1'
$env:FLOW_MODEL_MIN_OI_CHG_PCT='0.06'
$env:PHILOSOPHY_PRICED_IN_ALPHA='1'
node scripts/probe-model-c-v2.js
```

```powershell
# 瀹屾暣缃戞牸锛堝惈 pricedIn 伪锛?
node scripts/probe-philosophy-filter-model-c-grid.js --include-alpha
```

### Relaxed flow threshold experiment锛?026-06-17锛?
鍦?**N5/T4** 鍝插鍙戞暎涓嶅彉鍓嶆彁涓嬶紝鐢?`--relaxed` 鎵洿瀹?flow 杞达紙vol鈭坽0.7鈥?.1} 路 oi鈭坽0.02鈥?.06}锛?0 combo锛夋崲浜ら泦鏍锋湰閲忋€備骇鍑猴細`_probe-model-c-grid-relaxed-out.json` 路 `_probe-model-c-grid-relaxed-run.txt`銆?
| 鐩爣 | 缃戞牸锛堝揩鎵?replay锛?| 鍏ㄩ摼璺?`probe-model-c-v2.js` |
|------|---------------------|-------------------------------|
| **n鈮?0** | 鉁?`vol=0.8, oi=0.02` 鈫?**n=42** hit=**64.29%**锛坅u+ag 31 @ 70.97%锛?| 鉂?鏈€楂?**n=38**锛坄vol=0.7` hit=57.89%锛?|
| **hit鈮?0%**锛堝洓鍝佸悎璁★級 | 鉂?鏃?combo | 鉁?`vol=1.05, oi=0.02` 鈫?**n=27** hit=**70.37%** |
| **max n** | `vol=0.7` 鈫?**n=48** hit=58.33% | `vol=0.7` 鈫?n=38 hit=57.89% |
| **Gate 75% @ n鈮?0** | 鉂?0/30 | 鉂?|

**Pareto锛堢綉鏍硷紝max n @ min hit锛?*锛氣墺60% 鈫?vol=0.8/oi=0.02 (n=42)锛涒墺65% 鈫?vol=1.0/oi=0.02 (n=35)锛涒墺70% 鈫?鏃犮€?
**瀹為獙 env锛堢浉瀵?Step 6 涓ユ牸 `vol=1.1, oi=0.06`锛?*锛?
- **鍋忔牱鏈噺**锛歚FLOW_MODEL_MIN_VOL_RATIO=0.8` 路 `FLOW_MODEL_MIN_OI_CHG_PCT=0.02`锛堢綉鏍?n=42 @ 64%锛?- **鍋忓懡涓巼**锛歚FLOW_MODEL_MIN_VOL_RATIO=1.05` 路 `FLOW_MODEL_MIN_OI_CHG_PCT=0.02`锛堟帰閽?n=27 @ 70.4%锛?- 浠嶄繚鎸?`PHILOSOPHY_DIVERGENCE_LOOKBACK_N=5` 路 `PHILOSOPHY_DIVERGENCE_THRESHOLD=4`

```powershell
node scripts/probe-philosophy-filter-model-c-grid.js --relaxed
```


### 贵金属细网格（2026-06-17）

仅 **au + ag**，OOS **2023-01-01～2025-12-31**，哲学发散 **N∈{3…7} × T∈{2…6}** 与 flow **vol∈{0.75…1.15} × oi∈{0.01…0.06}** 全笛卡尔积（**1368** combo，α=1.0）。脚本：`scripts/probe-precious-model-c-grid.js`；产出：`_probe-precious-model-c-grid-out.json` · `_probe-precious-model-c-grid-run.txt`。

| 指标（au+ag 聚合，快路径 replay） | 最优 combo | n | hit% |
|----------------------------------|------------|---|------|
| Max intersection n | N4/T4 · vol=0.75 · oi=0.01 | **34** | 67.65 |
| Max n @ hit≥65% | 同上 | 34 | 67.65 |
| Max n @ hit≥70% | N4/T4 · vol=0.8 · oi=0.01 | 31 | 70.97 |
| Max n @ hit≥75% | N4/T4 · vol=1.05 · oi≥0.01 | 24 | **75.00** |
| Best hit @ n≥20 | N4/T4 · vol=1.05 · oi=0.01 | 24 | 75.00 |
| Best hit @ n≥30 | N4/T4 · vol=0.8 · oi=0.01 | 31 | 70.97 |
| Best hit @ n≥40 | — | — | — |
| **Gate 75% @ n≥40** | **0 / 1368** | max n=34 | — |

**对照**：relaxed **N5/T4 · vol=0.8/oi=0.02** → au+ag **n=31 @ 70.97%**；Step6 严格 **N5/T4 · vol=1.1/oi=0.06** → **n=21 @ 71.43%**。细网格无 combo **Pareto 支配** relaxed。

**全链路复核**（`probe-model-c-v2.js --id au --id ag`）：max-n 格点 **n=25 @ 68%**；relaxed **n=22 @ 72.73%**；75% 格点 **n=19 @ 73.68%**。α 二阶段未改善 75% 档样本量。

**结论**：未达 live gate；**未**对 au/ag 单独重刷 direction archive v2。全品种实验基线仍为 **FLOW 0.8/0.02 · N5/T4**。
**鍏绠＄嚎鎬荤粨锛?026-06-17锛?*

| 姝?| 鐘舵€?| 鍏抽敭缁撹 |
|----|------|----------|
| 1 鍝插 filter 鍖?| 鉁?| `filterPass` / `neutralReason` 瀹為獙璺緞鍙敤 |
| 2 鏃ュ瀷瑙勫垯闆?| 鉁?| policy/event 鍒嗙 路 M-1 浠撳崟 ramp |
| 3 pricedIn 涓夊垎閲?| 鉁?| 蟺 闃诲凹缃俊搴?|
| 4 Model C 鍙岃矾 | 鉁?| dir / flow / intersection 涓夊垎 KPI |
| 5 Archive v2 | 鉁?| backfill + UI 瀹¤鍒?|
| **6 浜ら泦缃戞牸** | 鉁?**gate fail** | 浜ら泦鏍锋湰杩囩█锛坢ax n鈮?0锛夛紱hit 涓婇檺 ~68鈥?1%锛坅u+ag锛壜?**鏈揪 live 75% 鐩爣** |

**绂佹**锛氬湪鏈€氳繃姝?6 gate 鍓?overwrite `outlook-logistic-weights.json` 鎴?deploy asar銆?

---

## 鍗併€佷笌 v1.34.8 / T1 瀹為獙宸窛琛?

| 鑳藉姏 | v1.34.8 鐢熶骇 | T1 unified 瀹為獙 | 鏈灦鏋勭洰鏍?|
|------|--------------|-----------------|------------|
| 鍝插瑙掕壊 | logistic 鐗瑰緛 (~18 缁? | 鍚屽乏锛堜粎 retrain au+ag锛?| **鐙珛 filter** |
| 妯″瀷缁撴瀯 | 鍗?logistic head | 鍗?head 路 鏇?conservative | **Direction + Flow 鍙屾ā鍨?鈭?* |
| OOS T+1 raw锛?023鈥?5锛?| **51.9%** (n=4615) | 50.0% (n=346) | 浜ら泦瀛愰泦 **鈮?5%** 涓?live 鐩爣 |
| OOS 浜ら泦 KPI锛堟 6 缃戞牸锛?| 鈥?| 鈥?| **best n=30 路 hit=66.7%**锛坅u+ag 71.4%锛壜?**gate fail** |
| 鏂瑰悜鍙戝嚭鐜?| ~92% 琛屾湁鏂瑰悜 | ~7.5% | 鍙帶锛歠ilter 鏄惧紡 neutral |
| 鏀跨瓥鏃ヤ粨鍗?| 鏈?mask | 鏈?mask | **policy 鏃?warehouse=0** |
| 浠撳崟浜ゅ壊鏈?| 5d chg 鍏ㄦ椂娈靛悓鏉?| 鍚屽乏 | **M-1 ramp + MAX** |
| pricedIn | 瑙勫垯 `pricedInBullishMult` | 鍚屽乏 | **涓夊垎閲?pricedInScore** |
| 闅忔満娈靛鐞?| ADX/娉㈠姩闅愬紡 | 鍚屽乏 | **N 鏃ュ摬瀛﹁儗绂?filter** |
| 姣忔棩 audit | 鏈?archive 路 缂?neutralReason | 鍚屽乏 | **neutral 鏃ュ繀濉?reason** |
| 浜ゅ弶 KPI | 鍗曚竴 hitRate | gated + raw | **dir / flow / intersection 涓夊垎** |
| T1 gate | 鈥?| **GATE_FAIL** | 鏂扮绾跨嫭绔?gate锛屼笉娣风敤 T1 鏉冮噸 |

---

## 鍗佷竴銆乣direction-prediction-archive` Schema 鎵╁睍

鍦ㄧ幇鏈?`{instrumentId, baselineDate, predictedDir, 鈥` 鍩虹涓?**鏂板**锛坴2 瀛楁锛屽悜鍚庡吋瀹癸級锛?

```json
{
  "schemaVersion": 2,
  "predictedDir": "neutral",
  "filterPass": false,
  "neutralReason": ["philosophy_flow_mismatch", "random_walk_divergence"],
  "philosophyDirection": "bullish",
  "philosophyConfidence": 0.62,
  "dirModel": {
    "direction": "bullish",
    "pUp": 0.58,
    "confidence": 0.16
  },
  "flowModel": {
    "direction": "bearish",
    "oiChgDir": -1,
    "volumePctile": 0.72,
    "confidence": 0.21,
    "validFundSignal": false
  },
  "intersectionSignal": null,
  "dayType": "policy",
  "pricedIn": {
    "score": 0.71,
    "mode": "partial",
    "components": {
      "priceCross": 0.8,
      "volumeOi": 0.65,
      "newsRepeat": 0.68
    }
  },
  "warehouseContext": {
    "deliveryMonth": "2026-07",
    "weight": 0.0,
    "referenceMax": 142580,
    "policyDayMasked": true
  },
  "narrativeWindowDays": 4,
  "randomWalkFilter": {
    "lookbackN": 5,
    "divergenceCount": 4,
    "triggered": true
  },
  "tradableForKpi": false,
  "intersectionKpiEligible": false
}
```

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `filterPass` | boolean | 鍝插 + Model C 浜ら泦鏄惁閫氳繃 |
| `neutralReason` | string[] | 鏋氫妇锛歚philosophy_flow_mismatch` 路 `random_walk_divergence` 路 `priced_in_full` 路 `policy_day_neutral` 路 `warehouse_delivery_low_weight` 路 `narrative_expired` 路 `cross_market_conflict` 路 `low_flow_confidence` |
| `philosophyDirection` | `bullish\|bearish\|neutral` | 杩囨护鍣ㄦ柟鍚?|
| `dirModel` / `flowModel` | object | 鍙屽瓙妯″瀷杈撳嚭 |
| `intersectionSignal` | dir \| null | 浠?`filterPass` 鏃堕潪 null |
| `dayType` | `routine\|policy\|event` | L1 鏃ュ瀷 |
| `tradableForKpi` | boolean | 鏄惁璁″叆 live 浜ら泦 KPI |
| `intersectionKpiEligible` | boolean | 鍥炴祴浜ら泦鏍锋湰鏍囪 |

**鍥炲～**锛?

```powershell
# 鏍锋湰楠岃瘉锛坅u/ag 路 2023鈥?025锛?
$env:FANCHENG_DATA_DRIVE='E'
node scripts/backfill-direction-prediction-archive.js --schema v2 --id au --id ag --from 2023-01-01 --to 2025-12-31 --force

# 骞茶窇锛堜笉鍐?jsonl锛屼粎缁熻 neutralReason 鍒嗗竷锛?
node scripts/backfill-direction-prediction-archive.js --schema v2 --id au --id ag --from 2023-01-01 --to 2025-12-31 --dry-run

# 鍏ㄥ搧绉?v2 鍥炲～
node scripts/backfill-direction-prediction-archive.js --schema v2 --from 2019-01-01 --force
```

UI 鍙樻洿鍦?`src/app.js` / `reading-layout.css` 鈥?闇€閲嶅惎 Electron 搴旂敤鍚庣敓鏁堬紙鏈?patch app.asar锛夈€?

---

## 鍗佷簩銆並PI 璁″垎鍙ｅ緞锛堥攣瀹氾級

| 鍙ｅ緞 | 鏉′欢 | 鐢ㄩ€?|
|------|------|------|
| **Raw dir** | `dirModel.direction != neutral` | 鏂瑰悜瀛愭ā鍨嬭瘖鏂?|
| **Raw flow** | `flowModel.validFundSignal` | 璧勯噾瀛愭ā鍨嬭瘖鏂?|
| **Intersection** | `filterPass && intersectionSignal != neutral` | **live 鐩爣 鈮?5%** |
| **Philosophy-only** | `philosophyDirection != neutral` | 鍝插灞傚崟娴?|
| **Audit coverage** | 鎵€鏈変氦鏄撴棩鍧囨湁 archive 琛?| backtest 鍙鐜?|

---

## 鍗佷笁銆佸紑鏀惧弬鏁帮紙寰?walk-forward锛?

| 鍙傛暟 | 鍊欓€夎寖鍥?| 澶囨敞 |
|------|----------|------|
| `randomWalk.lookbackN` | 3, 5, 7 | 涓嶇敤 ADX |
| `randomWalk.divergenceThreshold` | 3, 4, 5 | 涓?N 鑱斿悎缃戞牸 |
| `narrativeWindowDays` | 3鈥? | T+1 鍥哄畾 4 涓哄垵濮嬪€?|
| `flowModel.minOiPctile` | 鏉垮潡鍒嗕綅 | 涓?behavior_tag 瀵归綈 |
| `pricedIn.fullThreshold` | 0.65鈥?.75 | 瑙﹀彂 full priced-in |
| `warehouse.rampCurve` | linear / step | M-1 鍐?|

---

## 鍗佸洓銆佺浉鍏虫枃浠讹紙瀹炵幇鏃?touch锛?

| 妯″潡 | 褰撳墠 | 鐩爣鍙樻洿 |
|------|------|----------|
| `services/commodity-outlook-philosophy.js` | composite + philosophyScore | 瀵煎嚭 filter 瀛楁 + pricedIn v2 |
| `services/direction-prediction-archive.js` | T+1 鍩虹 schema | v2 鎵╁睍瀛楁 |
| `scripts/train-outlook-logistic*.js` | 鍚?philosophy 鐗瑰緛 | 鏂拌剼鏈?**鎺掗櫎** philosophy |
| `scripts/probe-t1-unified-experiment.js` | 鍗曟ā鍨嬪鐓?| 鏂?probe 涓夊垎 KPI |
| `data/history/news-tagged.csv` | policy 鏍囩 | 鎵?broad 鍥藉唴宸ヤ笟鏀跨瓥 |

---

*鐢ㄦ埛鏋舵瀯纭 路 2026-06-17 路 瀹炵幇鍓嶉』閲嶈鏈枃涓?[T1_UNIFIED_PIPELINE.md](./T1_UNIFIED_PIPELINE.md) gate 缁撹*
---

## 回填记录（archive v2）

- **2026-06-17**：全品种 direction-prediction-archive **schema v2** 回填（--from 2019-01-01 --force），流模型阈值 **FLOW_MODEL_MIN_VOL_RATIO=0.8**、**FLOW_MODEL_MIN_OI_CHG_PCT=0.02**（较默认放宽）；65/73 品种成功，8 跳过（inactive / insufficient_bars）。日志：_backfill-direction-archive-v2-relaxed-run.txt；汇总：_backfill-direction-archive-v2-relaxed-summary.json。贵金属细网格待后续单独跑。

---

## 实盘策略：高命中低频次（2026-06-17）

用户已接受 **「高命中、低频次」** Model C 交集信号作为实验实盘策略（非生产 v1.34.8 默认路径）。

| 维度 | audit_relaxed（存档/回测基线） | live_high_hit（可交易） |
|------|-------------------------------|-------------------------|
| 哲学发散 | N5/T4 | 贵金属 N4/T4 · 其它 N5/T4 |
| Flow vol | 0.8 | 1.05 |
| Flow oi | 0.02 | 贵金属 0.01 · 其它 0.02 |
| 预期信号率 | ~3–5% 交集日 | **~1–2%** 可交易日 |
| 目标命中 | ~65–70% | **~70–75%** |

**模块**：`services/model-c-live-strategy.js` · manifest `data/outlook-models/model-c-live-strategy.json`

**Archive 字段**：`tradableForLive` · `liveStrategyTier` · `strategyMode` · `liveTierPreset`

**启用（桌面 App 实验 · 需重启）**：

```powershell
$env:FANCHENG_DATA_DRIVE='E'
$env:PHILOSOPHY_FILTER_V2='1'
$env:MODEL_C_V2='1'
$env:MODEL_C_LIVE_TIER='high_hit'
# 无需手动设置 6 个阈值 env — live strategy 模块集中注入
npm start
```

**探针**：

```powershell
FANCHENG_DATA_DRIVE=E node scripts/probe-model-c-live-strategy.js
```

产出：`_probe-model-c-live-strategy-summary.json` · `_probe-model-c-live-strategy-out.txt`

**UI**：方向审计表在 v2 存档含 `tradableForLive` 时显示 **可交易** chip（tooltip：高命中低频次 · 交集信号）。

> **五法则扩展（规划）**：Model C 交集 gate 之上将叠加五法则投票与次日区间带 gate — 规格见 [TRADING_RULES_FIVE_LAWS.md](./TRADING_RULES_FIVE_LAWS.md)（v0.1 用户确认 · 生产权重不变）。

