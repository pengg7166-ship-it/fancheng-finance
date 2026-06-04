# 在 GitHub 创建空仓库（首次备份前必做）

远程地址应为：**https://github.com/gaotianze/fancheng-finance.git**  
当前检测：该页面若打开为 **404**，说明仓库尚未创建，请按下列步骤操作（约 2 分钟）。

## 1. 登录 GitHub

1. 浏览器打开 [https://github.com/login](https://github.com/login)
2. 使用账号 **gaotianze**（或你计划使用的账号）登录

## 2. 新建仓库

1. 打开 [https://github.com/new](https://github.com/new)（或右上角 **+** → **New repository**）
2. **Repository name** 填写：`fancheng-finance`（必须与本地 remote 一致）
3. **Description**（可选）：例如 `梵澄金融桌面端源码`
4. **Public** 或 **Private**：按需选择（私有仅你可见）
5. **不要勾选**：
   - ❌ Add a README file
   - ❌ Add .gitignore
   - ❌ Choose a license  
   （必须保持**完全空仓库**，否则首次 `git push` 可能冲突）
6. 点击绿色按钮 **Create repository**

## 3. 创建成功后的页面

创建成功后，GitHub 会显示 “Quick setup” 页面，其中应出现类似：

`https://github.com/gaotianze/fancheng-finance.git`

**不要**在该页执行 “echo … >> README” 等初始化命令；本地已有完整代码。

## 4. 在本机推送

1. 进入目录：`E:\FanchengFinance\source\fancheng-finance`
2. 双击 **`推送到GitHub.bat`**
3. 若弹出登录窗口：
   - 推荐使用 **Git Credential Manager** 浏览器登录 GitHub
   - 或在终端按提示输入 **Personal Access Token**（不是登录密码）

## 5. 验证

浏览器打开 [https://github.com/gaotianze/fancheng-finance](https://github.com/gaotianze/fancheng-finance)  
应能看到 `main` 分支与项目文件。

## 常见问题

| 现象 | 处理 |
|------|------|
| 404 | 仓库未创建或仓库名/用户名不对，回到第 2 步 |
| Authentication failed | 在终端完成 GitHub 登录或配置 PAT |
| rejected (fetch first) | 远程被误加了 README，到 GitHub 仓库 Settings 删除仓库后重建空仓，或联系维护者处理 |
| Connection reset / 网络错误 | 检查代理/VPN，稍后重试 `推送到GitHub.bat` |

本地 remote 已配置为：

```
origin  https://github.com/gaotianze/fancheng-finance.git
```