@echo off
chcp 65001 >nul
title 梵澄金融 - 迁移到 E 盘
echo.
echo 将把程序、缓存、配置、备份迁移到 E:\FanchengFinance
echo 并清理 C 盘上约 10GB+ 的旧版打包文件。
echo.
echo 请先关闭梵澄金融，然后按任意键继续...
pause >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\migrate-to-e-drive.ps1"
echo.
pause
