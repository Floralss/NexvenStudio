@echo off
chcp 65001 >nul
title NexVen Studio Site
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found!
    pause
    exit /b 1
)

echo Starting site at http://127.0.0.1:5050
python site_app.py
pause
