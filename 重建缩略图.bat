@echo off
setlocal EnableExtensions
chcp 65001 >nul
title lll个人网站 - 重建素材
cd /d "%~dp0"

rem 找一个真的装了 Pillow 的 Python。
set "PY="
for %%C in ("py" "python" "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe") do (
  if not defined PY (
    "%%~C" -c "import PIL" >nul 2>nul
    if not errorlevel 1 set "PY=%%~C"
  )
)

if not defined PY goto nopillow

echo [lll个人网站] Python: %PY%
echo [lll个人网站] 正在重建缩略图、图集清单、个人简介和文章 ...
echo.
"%PY%" "tools\build_gallery.py"
if errorlevel 1 goto buildfail
"%PY%" "tools\build_content.py"
if errorlevel 1 goto buildfail
echo.
echo 完成。刷新浏览器就能看到新的图集、简介和文章。
pause
exit /b 0

:buildfail
echo.
echo [lll个人网站] 重建的时候出了点问题，看看上面的报错再试一次。
pause
exit /b 1

:nopillow
echo.
echo [lll个人网站] 没有找到装了 Pillow 的 Python。
echo.
echo 图集仍然可以看：新图片会直接用原图显示，只是没有更快的缩略图。
echo 个人简介和文章也不会更新。
echo.
echo 想启用「重建素材」的话，先装一下 Pillow：
echo     python -m pip install pillow
echo.
pause
exit /b 1