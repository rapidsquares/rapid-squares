@echo off
title Rapid Squares - live server
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get it from https://nodejs.org ^(the LTS version^), then try again.
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created server\.env from the example.
  echo Open server\.env in Notepad, fill in your Supabase values, save it, then run this again.
  start notepad ".env"
  pause
  exit /b 1
)
echo Checking your settings...
call npm run check
if errorlevel 1 (
  pause
  exit /b 1
)
echo Starting Rapid Squares at http://localhost:3000 ...
start "" http://localhost:3000
call npm start
pause
