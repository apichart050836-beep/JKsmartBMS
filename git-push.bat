@echo off
REM Stages every change (new/modified/deleted files), commits, and pushes
REM to GitHub main. Run from anywhere - it cd's into the repo itself.
REM Usage: git-push.bat "your commit message"  (message is optional)

cd /d "%~dp0"

git add -A

if "%~1"=="" (
    set MSG=Update %date% %time%
) else (
    set MSG=%~1
)

git commit -m "%MSG%"
if errorlevel 1 (
    echo Nothing new to commit - still checking for unpushed commits...
)

git pull --rebase origin main
if errorlevel 1 (
    echo.
    echo *** git pull --rebase FAILED - see errors above ***
    pause
    exit /b 1
)

git push origin main
if errorlevel 1 (
    echo.
    echo *** git push FAILED - see errors above ***
    pause
    exit /b 1
)

echo.
echo Done.
pause
