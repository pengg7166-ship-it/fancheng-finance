# 配置 Git 凭据（GitHub 推送登录）

推送时若出现 **Authentication failed**、**403** 或反复要求密码，请按本说明操作。**GitHub 已不支持用登录密码推送**，请用 **Git Credential Manager（GCM）浏览器登录** 或 **Personal Access Token（PAT）**。

## 方式 A：Git Credential Manager（推荐）

1. 确认已安装 Git for Windows（自带 GCM）。
2. 在项目目录执行：
   ```bat
   cd /d E:\FanchengFinance\source\fancheng-finance
   git push -u origin main
   ```
3. 若弹出 GCM 或浏览器窗口：选择 **Sign in with your browser**，使用 **gaotianze** 登录并授权。
4. 成功后双击 **`一键GitHub备份.bat`** 或 **`推送到GitHub.bat`**。

## 方式 B：Personal Access Token（PAT）

1. 登录 GitHub（账号 **gaotianze**）。
2. 打开 [https://github.com/settings/tokens](https://github.com/settings/tokens)
3. **Generate new token (classic)**
4. **Note**：如 `fancheng-finance-push`
5. **Scopes**：勾选 **`repo`**
6. 生成后复制 token（仅显示一次，勿写入代码库）
7. 再次 `git push -u origin main`：
   - **Username**：`gaotianze`
   - **Password**：粘贴 **PAT**（不是 GitHub 密码）

## 清除错误凭据

1. **控制面板** → **凭据管理器** → **Windows 凭据**
2. 删除 `git:https://github.com` 相关项
3. 重新 push，按方式 A 或 B 登录

## 验证

```bat
git branch -vv
```

`main` 应显示 `[origin/main]`。

## 安全

勿将 PAT 写入脚本或提交到 Git；凭据仅在本机交互输入保存。