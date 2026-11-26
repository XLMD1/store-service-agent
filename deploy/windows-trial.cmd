@echo off
setlocal
cd /d "%~dp0.."
set "APP_CONFIG_FILE=%CD%\.local\dev.json"
if not defined PG_BIN set "PG_BIN=%ProgramFiles%\PostgreSQL\18\bin"
if not exist "%PG_BIN%\pg_ctl.exe" (
  echo Install PostgreSQL 18 tools or set PG_BIN first.
  goto failed
)
if /i "%~1"=="setup" goto setup
if /i "%~1"=="owner" goto owner
if not exist "%APP_CONFIG_FILE%" (
  echo Run deploy\windows-trial.cmd setup first.
  goto failed
)
"%PG_BIN%\pg_ctl.exe" status -D ".local\postgres" >nul 2>&1
if errorlevel 1 (
  "%PG_BIN%\pg_ctl.exe" start -w -D ".local\postgres" -l ".local\postgres.log" || goto failed
)
echo Open http://127.0.0.1:8000 on this PC. Keep this window open.
".venv\Scripts\python.exe" -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-proxy-headers --no-access-log
exit /b %errorlevel%
:setup
if not exist ".venv\Scripts\python.exe" (
  py -3.12 -m venv .venv || goto failed
)
".venv\Scripts\python.exe" -m pip install -r requirements.lock || goto failed
if not exist "%APP_CONFIG_FILE%" (
  ".venv\Scripts\python.exe" scripts\setup_local_postgres.py || goto failed
)
"%PG_BIN%\pg_ctl.exe" status -D ".local\postgres" >nul 2>&1
if errorlevel 1 (
  "%PG_BIN%\pg_ctl.exe" start -w -D ".local\postgres" -l ".local\postgres.log" || goto failed
)
".venv\Scripts\python.exe" -m alembic upgrade head || goto failed
echo For a new installation, run deploy\windows-trial.cmd owner, then deploy\windows-trial.cmd
exit /b 0
:owner
".venv\Scripts\python.exe" -m app.cli init-owner || goto failed
exit /b 0
:failed
echo Setup or startup did not complete. Review the message above.
pause
exit /b 1
