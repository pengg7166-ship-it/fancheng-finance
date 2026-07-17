# 梵澄金融 / Cursor Agent 崩溃复盘（2026-06-15）

本文档汇总桌面应用闪退、Cursor Agent 中断、整机卡死的根因与预防措施。

---

## 1. 根因对照表

| 崩溃类型 | 频率/证据 | 根因 | 修复状态 |
|----------|-----------|------|----------|
| 启动弹窗 `Cannot find module 'xml2js'` | 多次（v1.13.x 部署期） | `app.asar` 打包不完整，缺少 `node_modules` | v1.13.3 完整 build 已修复；重下载旧安装包会复发 |
| 启动弹窗 `Cannot find module 'market-regime-classifier'` 等 | 热补丁后偶发 | 只打进部分 `services/*.js`，遗漏传递依赖 | `_patch-cross-vol-asar.js` 已加依赖闭包扫描 |
| 梵澄金融「未响应」/浏览卡顿 | 用户多次反馈 | 主进程同步加载 20+ 模块 + 8 路推送循环争用 | v1.13.2 推送错峰；本次加 lazy-load + 异常兜底 |
| Cursor Agent `aborted` | 极频繁（f3797578、部署子任务等） | **用户手动中断** 或 **整机断电/卡死** 导致子任务被杀 | 非 Agent 软件 bug；减少并行重任务 |
| 整机闪退/黑屏（Event 41） | 6/9 两次（f800c5fb 诊断） | **意外断电/硬复位**，非蓝屏、非 Node OOM | 建议 UPS；长跑前 `keep-awake` |
| 16GB 内存吃满 / Cursor AppHang | 04377fb2 诊断 | 多条 `longrun` + 多 Agent 并行 + `NODE_OPTIONS=8192` | **禁止**并行重训练；一次只跑一个 longrun |
| bat 报错 `找不到文件 "\" \""` | v1.13.3 前 | 启动脚本引号错误 | `启动梵澄金融-安全.bat` 已修复 |
| 重下载安装包后功能回退 | 用户「重新下载好几次」 | 官方包 **不含** 源码热补丁（高低点 UI、cross-vol 链） | 重下载后必须 **重新 patch 或 build** |
| 当前 E 盘 asar 仅 ~3.8MB | 2026-06-15 体检 | 极瘦包：仅打包了少量 `node_modules`（有 xml2js 但缺大量传递文件） | 长期应用 `npm run build` 整包替换；热补丁只更新 services |

---

## 2. 为什么「重新下载」往往解决不了问题

1. **安装包是快照，不是源码**  
   从 GitHub/网盘下的 `win-unpacked` 是某次 `electron-builder` 产物，不含你本地后来改的 `services/*.js`。

2. **热补丁在 E 盘 asar 里，不在安装器里**  
   开发流程是：`源码改 → node _patch-cross-vol-asar.js → 写入 E:\FanchengFinance\app\...\app.asar`。  
   重新下载会 **覆盖** 这个 asar，导致：
   - 旧问题回来（xml2js 若包仍不完整）
   - 新功能消失（次日高低点、market-regime 等）

3. **Agent 崩溃 ≠ 应用崩溃**  
   对话里大量 `aborted` 是 Cursor 子任务被中断（断电、卡死、用户点停止），重下桌面应用 **不能** 修复 Cursor 会话中断。

4. **正确流程**  
   - 只修启动/依赖：完整 `npm run build` → 复制到 E 盘  
   - 要最新研判功能：在源码目录 `node _patch-cross-vol-asar.js`  
   - 启动前：`node scripts/verify-asar-health.js`

---

## 3. 技术细节

### 3.1 启动 require 链（重）

```
electron/main.js
  → services/data-fetcher.js
      → rss-parser → xml2js  (缺则秒崩)
      → services/commodity-outlook-engine.js
          → 20+ services（cross-vol、precious-point、next-day-range…）
```

`main.js` 原先 **无** `uncaughtException` / `unhandledRejection` 处理，任一顶层 `require` 失败即进程退出。

### 3.2 热补丁脆弱点

| 补丁脚本 | 写入 asar 的内容 |
|----------|------------------|
| `_patch-cross-vol-asar.js` | precious/range 链 + `app.js` + CSS |
| `_patch-release.js` | 版本/发布相关 |
| `_patch-shortcuts.js` | 快捷方式 |
| `scripts/_patch-a5-fullwindow.js` | 探测窗口 |

补丁只替换列出的文件；若 `next-day-range-predictor.js` 新增 `require('./intraday-range-predictor')` 但未列入补丁列表，运行时才会 `Cannot find module`。

**现已支持**：`scanRequireClosure()` 从入口文件自动遍历 `require('./…')` 闭包。

### 3.3 Agent / 长跑与内存

- `tune-sector-weights-longrun.js` + `NODE_OPTIONS=--max-old-space-size=8192` 单进程即可占 8GB+
- 同时开 2–3 个 Agent 各跑子任务 ≈ 再开 2–3 个 node → 16GB 机器极易卡死
- Windows Event 41 = 内核来不及写日志的硬关机，常见于断电或长按电源，**不是** JS 堆 OOM（OOM 通常有 exit code 134 / heap out of memory 日志）

---

## 4. 已落地的代码防护（2026-06-15）

| 文件 | 改动 |
|------|------|
| `electron/main.js` | `uncaughtException` / `unhandledRejection` 日志；outlook 模块加载失败降级 |
| `services/data-fetcher.js` | `commodity-outlook-engine` 延迟加载 + 降级空数据 |
| `services/commodity-outlook-engine.js` | cross-vol / precious / next-day-range 可选链 lazy require |
| `_patch-cross-vol-asar.js` | 依赖闭包自动扫描 + 导出 `resolvePatchFileList` |
| `scripts/verify-asar-health.js` | 启动前 asar 体检 |

---

## 5. 用户可操作清单

### 安全启动（推荐顺序）

1. 任务管理器确认无残留 `FanchengFinance.exe`
2. 在源码目录执行：
   ```powershell
   cd E:\FanchengFinance\source\fancheng-finance
   node scripts/verify-asar-health.js
   ```
3. 若 FAIL：先 `node _patch-cross-vol-asar.js` 或完整 build，再重复步骤 2
4. 启动：`启动梵澄金融-安全.bat` 或直接运行  
   `E:\FanchengFinance\app\win-unpacked\FanchengFinance.exe`

### 重新下载安装包之后

1. **不要** 假设新功能还在 — 必须重新 patch 或 build  
2. 运行 `node _patch-cross-vol-asar.js`（约 1 分钟，会自动备份 `app.bak-*.asar`）  
3. `node scripts/verify-asar-health.js` 显示 PASS 后再打开应用

### 使用 Cursor Agent 时

- 一次只跑 **一个** 重任务（longrun / 全品种 probe）
- 睡眠、离开前：停止所有 node 长跑 + 结束多余 Agent 会话
- 16GB 机器避免 `NODE_OPTIONS=8192` 与多个 Agent 并行
- 有条件加 **UPS**，Event 41 多为断电

### 清理磁盘（可选）

`E:\FanchengFinance\app\win-unpacked\resources\` 下保留最近 1–2 个 `app.bak-*.asar` 即可，其余可删。

---

## 6. 相关 transcript 索引

- xml2js / bat / v1.13.3 部署中断：主会话 `1ce3fcfb` 约 1816–1847 行
- Event 41 断电诊断：`f800c5fb-12c7-4df5-8805-678eb82a4927`
- 16GB 并行 OOM/AppHang：`04377fb2-a18e-4b6b-9886-03b4407246bf`
- 高低点 UI 中断：`f3797578-e245-4d0c-8b04-d38b9d3acf80`（`status: aborted`）

---

*维护：每次新增 `services/*.js` 并被 outlook 链引用后，运行 patch 脚本会自动扩展闭包；若新增 npm 依赖，必须完整 `npm run build`。*
