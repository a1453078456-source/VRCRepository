@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CuteImage - rebuild thumbnails
cd /d "%~dp0"

rem Pick the first Python that actually has Pillow installed.
set "PY="
for %%C in ("py" "python" "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe") do (
  if not defined PY (
    "%%~C" -c "import PIL" >nul 2>nul
    if not errorlevel 1 set "PY=%%~C"
  )
)

if not defined PY goto nopillow

echo [CuteImage] Python: %PY%
echo [CuteImage] Building thumbnails and assets\data.js ...
echo.
"%PY%" "tools\build_gallery.py"
if errorlevel 1 goto buildfail
echo.
echo Done. Refresh the gallery page in your browser.
pause
exit /b 0

:buildfail
echo.
echo [CuteImage] Something went wrong while building.
echo Check the message above, then try again.
pause
exit /b 1

:nopillow
echo.
echo [CuteImage] A Python with the Pillow library was not found.
echo.
echo The gallery still works: new images are shown with the original files,
echo only without the faster thumbnails.
echo.
echo To enable thumbnail rebuilding, install Pillow:
echo     python -m pip install pillow
echo.
pause
exit /b 1
