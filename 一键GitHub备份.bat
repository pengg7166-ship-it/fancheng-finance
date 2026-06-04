@echo off
chcp 65001 >nul
setlocal
cd /d "E:\FanchengFinance\source\fancheng-finance"

echo ============================================================
echo   梵澄金融 - 一键 GitHub 备份
echo   目标: https://github.com/gaotianze/fancheng-finance
echo ============================================================
echo.
echo [步骤 1/3] 在浏览器创建空仓库（若已创建可跳过）
echo   打开: https://github.com/new?name=fancheng-finance
echo   Repository name = fancheng-finance
echo   不要勾选 README / .gitignore / license
echo   点击 Create repository
echo.
start "" "https://github.com/new?name=fancheng-finance"
echo.
echo 按回车表示已在 GitHub 创建好空仓库
pause
echo.
echo [步骤 2/3] 正在推送到 origin main ...
git push -u origin main
set PUSH_ERR=%ERRORLEVEL%
echo.
echo [步骤 3/3] 结果
if %PUSH_ERR% neq 0 (
  echo [失败] git push 未成功（错误码 %PUSH_ERR%）
  echo   - 仓库 404: 先完成步骤 1
  echo   - 登录失败: 见 配置Git凭据说明.md
  echo   - 网络错误: 检查代理/VPN 后重试
  echo.
  git branch -vv
  pause
  exit /b 1
)
echo [成功] 代码已推送到 GitHub
echo   https://github.com/gaotianze/fancheng-finance
git branch -vv
echo.
pause
exit /b 0
