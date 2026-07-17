# 梵澄金融

全球指数、大宗商品、中美宏观、外汇、政策雷达、地缘政治、美联储、日本央行、新华社等信息聚合桌面应用。

**当前版本：v1.42.0-integrated-spec**（源码目录：`E:\FanchengFinance\source\fancheng-finance`）

## 功能

- **全球指数 / 大宗商品 / 中美宏观 / 外汇**
- **政策雷达**：部委政策 + 大宗关联（国内/境外资讯 + **地缘深度分析**）
- **地缘政治**：五大区域、四维竞争、逻辑链与学者引述，品种标签可跳转大宗关联
- **美联储 / 日本央行 / 美国财政部 / 新华社**
- 数据默认存于 `E:\FanchengFinance\data`，程序运行于 `E:\FanchengFinance\app\win-unpacked`

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

## 文档

产品哲学（变量层研判 vs 常量层执行）：[`docs/PRODUCT_PHILOSOPHY_VARIABLE_CONSTANT.md`](docs/PRODUCT_PHILOSOPHY_VARIABLE_CONSTANT.md)

## 数据来源

| 来源 | 数据类型 | 接口 |
|------|----------|------|
| 美联储 | 经济指标 | FRED API |
| 美联储 | 新闻公告 | federalreserve.gov RSS |
| 美国财政部 | 债务/利率 | fiscaldata.treasury.gov |
| 美国财政部 | 新闻公告 | treasury.gov RSS |
| 新华社 | 财经新闻 | xinhuanet.com RSS |
