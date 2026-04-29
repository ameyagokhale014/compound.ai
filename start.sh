#!/bin/bash
# Kill anything on port 8000 first
lsof -ti:8000 | xargs kill -9 2>/dev/null

cd "$(dirname "$0")"

# Start backend
source venv/bin/activate
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 &
cd ..

# Start frontend
cd frontend && npm run dev &

echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:5177 (or next available port)"
wait
