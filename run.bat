@echo off
setlocal
cd /d "%~dp0"

echo Working directory: %cd%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found - installing it now, this needs a few minutes...
  echo.

  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  ) else (
    echo winget not available - downloading the installer directly instead...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/latest-v22.x/' -OutFile '%TEMP%\nodejs-index.html'; $m = Select-String -Path '%TEMP%\nodejs-index.html' -Pattern 'node-v22\.[0-9.]+-x64\.msi' | Select-Object -First 1; $file = $m.Matches[0].Value; Invoke-WebRequest -Uri ('https://nodejs.org/dist/latest-v22.x/' + $file) -OutFile '%TEMP%\node-installer.msi'"
    msiexec /i "%TEMP%\node-installer.msi" /quiet /norestart
  )

  echo.
  echo ============================================================
  echo  Node.js was just installed. Windows needs a fresh terminal
  echo  to pick up the new PATH - close this window and run
  echo  run.bat again to continue.
  echo ============================================================
  pause
  exit /b 0
)

echo Node version:
node -v
echo (Backend requires Node 22.5 or newer - node:sqlite won't load on older versions)
echo.

if not exist node_modules (
  echo Installing frontend dependencies, first run on this machine...
  call npm install
)

if not exist server\node_modules (
  echo Installing backend dependencies, first run on this machine...
  pushd server
  call npm install
  popd
)

if not exist server\.env (
  echo.
  echo ============================================================
  echo  WARNING: server\.env is missing.
  echo  The backend cannot start without it - copy it over from the
  echo  original machine ^(server\.env^), it is not included in
  echo  the zip automatically.
  echo ============================================================
  echo.
  pause
)

start "BMS Backend" cmd /k "cd /d "%~dp0server" && npm run dev"
call npm run dev
pause
