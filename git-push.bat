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
    echo Nothing to commit.
    exit /b 0
)

git pull --rebase origin main
git push origin main
