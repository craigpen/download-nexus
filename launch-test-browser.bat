@echo off
setlocal
title Download Nexus - Test Browser Launcher

echo ========================================================
echo   Download Nexus - Starting Test Browser with Debug Port
echo ========================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your PATH. Please install Node.js to use this script.
    pause
    exit /b 1
)

:: Run the launcher script passing any additional command-line parameters
node "%~dp0scripts\launch-browser.js" %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Test browser process exited with error code %ERRORLEVEL%.
    pause
)
