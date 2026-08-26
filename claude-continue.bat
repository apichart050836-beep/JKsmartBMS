@echo off
REM Resumes the most recent Claude Code session in this project.
REM Usage: double-click, or run claude-continue.bat from anywhere.

cd /d "%~dp0"
claude --continue
pause
