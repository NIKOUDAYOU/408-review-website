@echo off
chcp 65001 >nul
title B站免费翻译代理 (Index-Translate) - 408 总结网站
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  python "%~dp0tools\bilibili_translate_proxy.py" --port 8080
  goto :end
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0tools\bilibili_translate_proxy.py" --port 8080
  goto :end
)

echo.
echo [提示] 未检测到 Python 3。
echo 请先安装 Python 3 (https://www.python.org/downloads/) 或在网页「翻译设置」中使用免代理免费翻译 / 自定义 API。
echo.
:end
pause
