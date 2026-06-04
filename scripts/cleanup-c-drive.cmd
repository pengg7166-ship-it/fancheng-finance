@echo off
chcp 65001 >nul
set ROOT=C:\Users\Gao\Projects\fancheng-finance
echo Cleaning old build folders on C: ...
for %%D in (dist-v162 dist-v163 dist-v164 dist-v165 dist-v166 dist-v167 dist-v170 dist-v171 dist-v172 dist-v173 dist-v174 dist-out _asar-check _v183 _check-v181 _asar-v180 _pkg-extract) do (
  if exist "%ROOT%\%%D" (
    echo   rmdir %%D
    rmdir /s /q "%ROOT%\%%D" 2>nul
  )
)
if exist "C:\Users\Gao\Projects\fancheng-finance-backups" (
  echo Moving backups to E:...
  if not exist "E:\FanchengFinance\backups" mkdir "E:\FanchengFinance\backups"
  move /Y "C:\Users\Gao\Projects\fancheng-finance-backups\*.zip" "E:\FanchengFinance\backups\" 2>nul
)
echo Done.
pause
