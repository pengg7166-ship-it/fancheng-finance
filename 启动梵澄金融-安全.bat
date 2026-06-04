@echo off
chcp 65001 >nul
title 梵澄金融 - 安全启动
set "EXE=E:\FanchengFinance\app\win-unpacked\FanchengFinance.exe"
if not exist "%EXE%" (
  echo 未找到: %EXE%
  echo 请先运行「更新梵澄金融.bat」完成打包与同步。
  pause
  exit /b 1
)
start "" "%EXE%"
exit /b 0
