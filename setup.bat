@echo off
echo ===================================================
echo Setting up MiniMines HSN Engine Dependencies...
echo ===================================================

echo.
echo Installing Backend Python Dependencies...
cd backend
python -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
cd ..

echo.
echo Installing Frontend Node Dependencies...
cd frontend
npm install
cd ..

echo.
echo ===================================================
echo Setup Complete! You can now double-click start.bat
echo ===================================================
pause
