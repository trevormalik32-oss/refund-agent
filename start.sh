#!/bin/bash
# start.sh — Run both backend and frontend concurrently

set -e
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "🔁  Loopp Refund Agent — Startup"
echo "================================"

# Check for .env
if [ ! -f "$ROOT_DIR/backend/.env" ]; then
  echo "⚠️  No .env file found in backend/."
  echo "    Copy backend/.env.example → backend/.env and add your ANTHROPIC_API_KEY"
  exit 1
fi

# Check Python
command -v python3 >/dev/null 2>&1 || { echo "❌ python3 not found"; exit 1; }

# Backend setup
echo ""
echo "📦  Installing Python dependencies..."
cd "$ROOT_DIR/backend"
pip install -q -r requirements.txt

echo ""
echo "🚀  Starting FastAPI backend on http://localhost:8000 ..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend setup
echo ""
echo "📦  Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install --silent

echo ""
echo "🎨  Starting React frontend on http://localhost:3000 ..."
npm start &
FRONTEND_PID=$!

echo ""
echo "✅  Both services started."
echo "    Frontend: http://localhost:3000"
echo "    Backend:  http://localhost:8000"
echo "    API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both."

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" INT TERM
wait
