# 梵澄金融

美联储、美国财政部、新华社实时信息聚合桌面应用。

## 功能

- **美联储**：FRED 关键经济指标（利率、国债收益率、汇率、失业率、CPI）+ 官方新闻 RSS
- **美国财政部**：联邦债务、国债利率等 Fiscal Data API 数据 + 官方新闻 RSS
- **新华社**：财经要闻 RSS 实时推送
- 每 5 分钟自动刷新，支持手动刷新
- 中文界面，点击新闻可在浏览器中打开原文

## 运行

**方式一：已打包版本（推荐）**

双击安装包：

```
dist\梵澄金融 Setup 1.0.0.exe
```

或免安装直接运行：

```
dist\win-unpacked\梵澄金融.exe
```

也可双击项目根目录的 `运行已打包版本.bat`。

**方式二：开发模式**

```bash
npm install
npm start
```

开发模式（打开 DevTools）：

```bash
npm run dev
```

## 打包（Windows）

已配置国内镜像（`.npmrc`），直接执行：

```bash
npm run build
```

安装包输出：`dist\梵澄金融 Setup 1.0.0.exe`  
便携版目录：`dist\win-unpacked\`

## 配置 FRED API Key

1. 打开 [FRED 账号注册/登录](https://fredaccount.stlouisfed.org/login/secureLogin.aspx)
2. 登录后进入 [API Keys 页面](https://fredaccount.stlouisfed.org/apikeys) 申请 Key（免费）
3. 在应用内点击 **⚙ 设置**，粘贴 Key 并保存

也可在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```
FRED_API_KEY=你的32位密钥
```

## 技术栈

- Electron
- rss-parser（RSS 新闻）
- FRED API / Treasury Fiscal Data API（公开数据）

## 数据来源

| 来源 | 数据类型 | 接口 |
|------|----------|------|
| 美联储 | 经济指标 | FRED API |
| 美联储 | 新闻公告 | federalreserve.gov RSS |
| 美国财政部 | 债务/利率 | fiscaldata.treasury.gov |
| 美国财政部 | 新闻公告 | treasury.gov RSS |
| 新华社 | 财经新闻 | xinhuanet.com RSS |
