@echo off
cd /d "%~dp0"

echo === Qiu Build ===

echo ^>^> Cleaning old builds...
if exist "dist" rmdir /s /q "dist"

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

call npm install
if %errorlevel% neq 0 (
  echo npm install failed
  pause
  exit /b 1
)

echo ^>^> Compiling...
call npx electron-vite build
if %errorlevel% neq 0 (
  echo Compile failed
  pause
  exit /b 1
)

echo ^>^> Packaging...
call npx electron-builder
if %errorlevel% neq 0 (
  echo Package failed
  pause
  exit /b 1
)

echo ^>^> Done! Portable exe at dist\Qiu *.exe
pause
