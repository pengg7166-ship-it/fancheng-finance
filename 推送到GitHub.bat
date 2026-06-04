@echo off
chcp 65001 >nul
setlocal
cd /d "E:\FanchengFinance\source\fancheng-finance"
echo 正在推送到 https://github.com/pengg7166-ship-it/fancheng-finance.git ...
echo 仓库已存在时直接本脚本即可；首次需空仓库时请先运行: 一键GitHub备份.bat
echo.
git push -u origin main
if errorlevel 1 (
  echo.
  echo [失败] 推送未完成。
  echo - GitHub 404: 创建GitHub仓库说明.md 或检查 remote 用户名是否为 pengg7166-ship-it
  echo - 登录失败: 配置Git凭据说明.md
  git branch -vv
  pause
  exit /b 1
)
echo.
echo [成功] https://github.com/pengg7166-ship-it/fancheng-finance
git branch -vv
exit /b 0
