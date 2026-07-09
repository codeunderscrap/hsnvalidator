@echo off
echo ===================================================
echo Starting MiniMines HSN Reconciliation Engine...
echo ===================================================

echo Starting Backend Server...
start "MiniMines Backend" cmd /c "cd backend && call venv\Scripts\activate.bat && python -m uvicorn api.main:app --reload --port 8000"

echo Starting Frontend Server...
start "MiniMines Frontend" cmd /c "cd frontend && npm run dev"

echo.
echo Both servers are starting! 
echo The website should open automatically, or you can go to:
echo http://localhost:5173
echo.
timeout /t 5
start http://localhost:5173
