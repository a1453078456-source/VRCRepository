@echo off
chcp 65001 >nul
title lll 的小站
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 goto nops

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
goto done

:nops
echo.
echo [lll 的小站] 没找到 Windows PowerShell，改为直接打开 index.html ...
start "" "%~dp0index.html"

:done
if errorlevel 1 pause