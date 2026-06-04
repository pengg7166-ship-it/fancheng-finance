@echo off
chcp 65001 >nul
setlocal
cd /d "E:\FanchengFinance\source\fancheng-finance"
echo 正在推送到 https://github.com/gaotianze/fancheng-finance.git ...
git push -u origin main
if errorlevel 1 (
  echo.
  echo [失败] 推送未完成。
  echo - 若 GitHub 上仍是 404，请先阅读：创建GitHub仓库说明.md
  echo - 若提示登录，请在当前窗口完成 GitHub 凭据验证后重试。
  pause
  exit /b 1
)
echo.
echo [成功] https://github.com/gaotianze/fancheng-finance
exit /b 0