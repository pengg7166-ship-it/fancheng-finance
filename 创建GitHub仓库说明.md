# 在 GitHub 创建空仓库（首次备份前必做）

## 最快方式（推荐）

**双击 一键GitHub备份.bat**：会自动打开 [新建仓库（名称已预填 fancheng-finance）](https://github.com/new?name=fancheng-finance)，按提示创建**空仓库**后按回车，脚本会执行 `git push -u origin main` 并显示结果。

**仓库已经存在时**（例如 GitHub 提示「此账户中已存在 fancheng-finance」）：**不必再点「创建存储库」**，直接双击 **推送到GitHub.bat** 即可（可跳过浏览器步骤）。

远程地址应为：**https://github.com/pengg7166-ship-it/fancheng-finance.git**  
若误配为 `gaotianze` 等其他用户名，打开仓库页会 **404**。

## GitHub 中文界面对照

| 中文 | 英文 |
|------|------|
| 创建存储库 | Create repository |
| 新建存储库 | New repository |
| 存储库名称 | Repository name |

右上角头像旁显示的用户名即为 **owner**（本仓库为 **pengg7166-ship-it**，不是 gaotianze）。

## 1. 登录 GitHub

1. 浏览器打开 [https://github.com/login](https://github.com/login)
2. 使用你创建仓库的账号登录（本机当前为 **pengg7166-ship-it**）

## 2. 新建仓库（仅首次、且尚未存在时）

1. 打开 [https://github.com/new](https://github.com/new)（或右上角 **+** → **New repository** / **新建存储库**）
2. **Repository name** / **存储库名称** 填写：`fancheng-finance`（必须与本地 remote 一致）
3. **Description**（可选）：例如 `梵澄金融桌面端源码`
4. **Public** 或 **Private**：按需选择（私有仅你可见）
5. **不要勾选**：
   - Add a README file
   - Add .gitignore
   - Choose a license  
   （必须保持**完全空仓库**，否则首次 `git push` 可能冲突）
6. 点击绿色按钮 **创建存储库**（英文界面：**Create repository**）

若创建页报错「此账户中已存在 fancheng-finance」，说明仓库已建好，关闭页面即可，改用 **推送到GitHub.bat**。

## 3. 创建成功后的页面

创建成功后，GitHub 会显示 “Quick setup” 页面，其中应出现类似：

`https://github.com/pengg7166-ship-it/fancheng-finance.git`

**不要**在该页执行 “echo … >> README” 等初始化命令；本地已有完整代码。

## 4. 在本机推送

1. 进入目录：`E:\FanchengFinance\source\fancheng-finance`
2. 双击 **`推送到GitHub.bat`**
3. 若弹出登录窗口：
   - 推荐使用 **Git Credential Manager** 浏览器登录 GitHub
   - 或在终端按提示输入 **Personal Access Token**（不是登录密码）

## 5. 验证

浏览器打开 [https://github.com/pengg7166-ship-it/fancheng-finance](https://github.com/pengg7166-ship-it/fancheng-finance)  
应能看到 `main` 分支与项目文件。

## 常见问题

| 现象 | 处理 |
|------|------|
| 404 | remote 用户名不对（常见误配 gaotianze）或仓库未创建，见下文修改 remote |
| 「此账户中已存在 fancheng-finance」 | 正常，仓库已有，直接 **推送到GitHub.bat** |
| Authentication failed | 在终端完成 GitHub 登录或配置 PAT |
| rejected (fetch first) | 远程被误加了 README，到 GitHub 仓库 Settings 删除仓库后重建空仓，或联系维护者处理 |
| Connection reset / 网络错误 | 检查代理/VPN，稍后重试 `推送到GitHub.bat` |

本地 remote 已配置为：

```
origin  https://github.com/pengg7166-ship-it/fancheng-finance.git
```

## 用户名或 remote 不对

1. GitHub 右上角头像 → **Your profile** 查看登录名（本仓库为 **pengg7166-ship-it**）。
2. 修改 remote：

```bat
cd /d E:\FanchengFinance\source\fancheng-finance
git remote set-url origin https://github.com/你的用户名/fancheng-finance.git
git remote -v
```

3. GitHub 仓库名须为 **fancheng-finance**，与 `git remote -v` 一致。
