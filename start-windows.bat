@echo off
title Rapid Squares - local server
cd /d "%~dp0"
echo Starting Rapid Squares...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
if errorlevel 1 (
  echo.
  echo Something went wrong - see the message above.
  pause
)
