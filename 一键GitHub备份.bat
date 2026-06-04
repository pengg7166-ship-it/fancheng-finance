@echo off
chcp 65001 >nul
setlocal
cd /d "E:\FanchengFinance\source\fancheng-finance"

echo ============================================================
echo   梵澄金融 - 一键 GitHub 备份
echo   目标: https://github.com/pengg7166-ship-it/fancheng-finance
echo ============================================================
echo.
echo [步骤 1/3] 在浏览器创建空仓库（若已创建可跳过）
echo   打开: https://github.com/new?name=fancheng-finance
echo   Repository name = fancheng-finance
echo   不要勾选 README / .gitignore / license
echo   中文界面点绿色按钮「创建存储库」（英文为 Create repository）
echo   若提示「此账户中已存在 fancheng-finance」说明仓库已有，直接按回车跳过本步
echo.
rundll32 url.dll,FileProtocolHandler "https://github.com/new?name=fancheng-finance"
echo.
echo 按回车表示已在 GitHub 创建好空仓库（或仓库本来就存在）
pause
echo.
echo [步骤 2/3] 正在推送到 origin main ...
git push -u origin main
set PUSH_ERR=%ERRORLEVEL%
echo.
echo [步骤 3/3] 结果
if %PUSH_ERR% neq 0 (
  echo [失败] git push 未成功（错误码 %PUSH_ERR%）
  echo   - 仓库 404: 检查 remote 是否为 pengg7166-ship-it，见 创建GitHub仓库说明.md
  echo   - 登录失败: 见 配置Git凭据说明.md
  echo   - 网络错误: 检查代理/VPN 后重试
  echo.
  git branch -vv
  pause
  exit /b 1
)
echo [成功] 代码已推送到 GitHub
echo   https://github.com/pengg7166-ship-it/fancheng-finance
git branch -vv
echo.
pause
exit /b 0
