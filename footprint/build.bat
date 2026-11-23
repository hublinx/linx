@echo off
REM Build footprint.exe on Windows. Requires Python 3.8+ with pip.
REM Double-click this file, or run it from a terminal.

echo === footprint: building standalone EXE ===

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found on PATH. Install from https://www.python.org/downloads/
    echo         and tick "Add Python to PATH" during setup.
    pause
    exit /b 1
)

echo Installing PyInstaller (if needed)...
python -m pip install --upgrade pyinstaller || (
    echo [ERROR] Could not install PyInstaller.
    pause
    exit /b 1
)

echo Building...
python -m PyInstaller --onefile --console --name footprint footprint.py

if exist dist\footprint.exe (
    echo.
    echo === DONE ===
    echo Your EXE is at:  %cd%\dist\footprint.exe
    echo Try it:          dist\footprint.exe history
) else (
    echo [ERROR] Build failed. See messages above.
)
pause
