@echo off
chcp 65001 >nul
title CuteImage
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 goto nops

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
goto done

:nops
echo.
echo [CuteImage] Windows PowerShell not found, opening index.html directly...
start "" "%~dp0index.html"

:done
if errorlevel 1 pause
