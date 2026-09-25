@echo off
rem Launch the pack workshop: packaged exe if present, otherwise the dev build.
cd /d "%~dp0"
if exist "dist\win-unpacked\PackWorkshop.exe" (
  start "" "%~dp0dist\win-unpacked\PackWorkshop.exe"
  exit /b
)
if not exist "out\main\index.js" call npm run build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
