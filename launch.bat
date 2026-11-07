@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
if errorlevel 1 (
    echo [Frontline Tactics 3D] Fehler beim Ausfuehren des Launchers.
    pause
)
